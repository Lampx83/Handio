import fs from "node:fs/promises";
import path from "node:path";
import type { Settings, SettingsStore, TrustStore } from "@neu/agent-core";

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
      if (this.codec) out.keyEnc = this.codec.encrypt(key);
      else if (this.opts.persistKeyWithoutCodec !== false) out.key = key;
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
