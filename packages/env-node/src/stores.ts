import fs from "node:fs/promises";
import path from "node:path";
import { ID_RE, type ChatMeta, type ChatStore, type SavedChat, type Settings, type SettingsStore, type TrustStore } from "@neu/agent-core";

export interface KeyCodec {
  encrypt(plain: string): string;
  decrypt(enc: string): string;
}

/** Lưu cài đặt dạng JSON; khoá API (nếu có) được mã hoá bằng `codec` (vd Electron safeStorage) và lưu ở trường riêng. */
export class JsonSettingsStore implements SettingsStore {
  /** `persistKeyWithoutCodec=false`: nếu hệ điều hành không có kho khoá để mã hoá thì KHÔNG ghi key ra đĩa (key chỉ sống trong phiên). */
  constructor(private file: string, private codec?: KeyCodec, private opts: { persistKeyWithoutCodec?: boolean } = {}) {}

  async load(): Promise<Partial<Settings> | null> {
    try {
      const raw = JSON.parse(await fs.readFile(this.file, "utf8")) as Partial<Settings> & { keyEnc?: string };
      const { keyEnc, ...rest } = raw;
      if (keyEnc && this.codec) {
        try {
          rest.key = this.codec.decrypt(keyEnc);
        } catch {
          /* khoá hỏng: bắt nhập lại */
        }
      }
      return rest;
    } catch {
      return null;
    }
  }

  async save(s: Settings): Promise<void> {
    const { key, ...rest } = s;
    const out: Record<string, unknown> = { ...rest };
    if (key) {
      if (this.codec) {
        try {
          out.keyEnc = this.codec.encrypt(key);
        } catch {
          /* kho khoá của hệ điều hành không dùng được: KHÔNG ghi key ra đĩa (key chỉ sống trong phiên) */
        }
      } else if (this.opts.persistKeyWithoutCodec !== false) out.key = key;
    }
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(out, null, 2), { mode: 0o600 });
  }
}

export class JsonTrustStore implements TrustStore {
  constructor(private file: string) {}
  private async read(): Promise<string[]> {
    try {
      const j = JSON.parse(await fs.readFile(this.file, "utf8"));
      return Array.isArray(j) ? j.filter((x) => typeof x === "string") : [];
    } catch {
      return [];
    }
  }
  async isTrusted(root: string): Promise<boolean> {
    return (await this.read()).includes(root);
  }
  async setTrusted(root: string, trusted: boolean): Promise<void> {
    const list = (await this.read()).filter((r) => r !== root);
    if (trusted) list.push(root);
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(list, null, 2), { mode: 0o600 });
  }
}

/** Lịch sử trò chuyện ở thư mục dữ liệu của ứng dụng (KHÔNG ghi vào thư mục dự án của người dùng): <dir>/<mã dự án>/<mã cuộc>.json. */
export class JsonChatStore implements ChatStore {
  constructor(private dir: string, private maxPerProject = 100) {}
  private folder(projectId: string): string {
    if (!ID_RE.test(projectId)) throw new Error("Mã dự án không hợp lệ");
    return path.join(this.dir, projectId);
  }
  private file(projectId: string, id: string): string {
    if (!ID_RE.test(id)) throw new Error("Mã cuộc trò chuyện không hợp lệ");
    return path.join(this.folder(projectId), id + ".json");
  }
  async list(projectId: string): Promise<ChatMeta[]> {
    let names: string[];
    try {
      names = await fs.readdir(this.folder(projectId));
    } catch {
      return [];
    }
    const out: ChatMeta[] = [];
    for (const n of names) {
      if (!n.endsWith(".json")) continue;
      try {
        const c = JSON.parse(await fs.readFile(path.join(this.folder(projectId), n), "utf8")) as SavedChat;
        out.push({ id: c.id, title: String(c.title ?? ""), updated: Number(c.updated) || 0, turns: Number(c.turns) || 0, ...(c.unfinished ? { unfinished: true } : {}), ...(typeof c.task === "string" && ID_RE.test(c.task) ? { task: c.task } : {}) });
      } catch {
        /* tệp hỏng: bỏ qua */
      }
    }
    return out;
  }
  async load(projectId: string, id: string): Promise<SavedChat | null> {
    try {
      const c = JSON.parse(await fs.readFile(this.file(projectId, id), "utf8")) as SavedChat;
      return c && c.id === id && Array.isArray(c.messages) ? c : null;
    } catch {
      return null;
    }
  }
  async save(projectId: string, chat: SavedChat): Promise<void> {
    const f = this.file(projectId, chat.id);
    await fs.mkdir(path.dirname(f), { recursive: true, mode: 0o700 });
    const tmp = f + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(chat), { mode: 0o600 });
    await fs.rename(tmp, f);
    const all = (await this.list(projectId)).sort((a, b) => b.updated - a.updated);
    for (const old of all.slice(this.maxPerProject)) await this.remove(projectId, old.id);
  }
  async remove(projectId: string, id: string): Promise<void> {
    await fs.rm(this.file(projectId, id), { force: true });
  }
}

const PACK_TEXT = /\.(md|json|txt|csv|html|css|js|mjs)$/i;

/**
 * Đọc các gói mở rộng (xem packages/core/src/packs.ts, docs/EXTENSIONS.md) từ thư mục trên đĩa: mỗi thư mục con của `dir` là một gói.
 * Chỉ đọc tệp chữ, giới hạn kích thước và số lượng; không theo liên kết tượng trưng. Thư mục không tồn tại thì bỏ qua.
 */
export async function readPackDirs(dir: string, origin: "org" | "user"): Promise<import("@neu/agent-core").RawPack[]> {
  const out: import("@neu/agent-core").RawPack[] = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const d of entries.filter((e) => e.isDirectory()).slice(0, 50)) {
    const files: Record<string, string> = {};
    let count = 0;
    const walk = async (abs: string, rel: string, depth: number): Promise<void> => {
      for (const e of await fs.readdir(abs, { withFileTypes: true }).catch(() => [])) {
        if (count > 400) return;
        const r = rel ? rel + "/" + e.name : e.name;
        if (e.isDirectory()) {
          if (depth < 4) await walk(path.join(abs, e.name), r, depth + 1);
        } else if (e.isFile() && PACK_TEXT.test(e.name)) {
          const p = path.join(abs, e.name);
          const st = await fs.stat(p).catch(() => null);
          if (st && st.size <= 100_000) {
            files[r] = await fs.readFile(p, "utf8");
            count++;
          }
        }
      }
    };
    await walk(path.join(dir, d.name), "", 0);
    out.push({ dir: d.name, origin, files });
  }
  return out;
}
