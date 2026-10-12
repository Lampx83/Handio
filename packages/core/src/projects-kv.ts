import type { Env } from "./env";
import { cleanProjectName, newId, type ChatMeta, type ChatStore, type ProjectHost, type ProjectInfo, type ProjectsState, type SavedChat } from "./projects";

/** Kho khoá–giá trị chuỗi (localStorage ở bản web; Map trong test). */
export interface KeyValue {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

const readJson = <T>(kv: KeyValue, key: string, fallback: T): T => {
  try {
    const v = kv.get(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};

const MAX_CHATS = 25;
const MAX_BYTES = 1_500_000;

/** Lịch sử trò chuyện trong một kho khoá–giá trị: mỗi dự án một khoá, giữ tối đa 25 cuộc và ~1,5 MB (bỏ cuộc cũ nhất). */
export class KvChatStore implements ChatStore {
  constructor(private kv: KeyValue, private prefix: string) {}
  private key = (projectId: string) => `${this.prefix}.${projectId}`;
  private all(projectId: string): SavedChat[] {
    return readJson<SavedChat[]>(this.kv, this.key(projectId), []);
  }
  private write(projectId: string, chats: SavedChat[]): void {
    let list = [...chats].sort((a, b) => b.updated - a.updated).slice(0, MAX_CHATS);
    let json = JSON.stringify(list);
    while (json.length > MAX_BYTES && list.length > 1) {
      list = list.slice(0, -1);
      json = JSON.stringify(list);
    }
    this.kv.set(this.key(projectId), json);
  }
  async list(projectId: string): Promise<ChatMeta[]> {
    return this.all(projectId).map(({ id, title, updated, turns, unfinished }) => ({ id, title, updated, turns, ...(unfinished ? { unfinished: true } : {}) }));
  }
  async load(projectId: string, id: string): Promise<SavedChat | null> {
    return this.all(projectId).find((c) => c.id === id) ?? null;
  }
  async save(projectId: string, chat: SavedChat): Promise<void> {
    this.write(projectId, [chat, ...this.all(projectId).filter((c) => c.id !== chat.id)]);
  }
  async remove(projectId: string, id: string): Promise<void> {
    this.write(projectId, this.all(projectId).filter((c) => c.id !== id));
  }
}

interface Registry {
  active: string;
  projects: ProjectInfo[];
}

/**
 * Danh sách dự án cho môi trường không có thư mục thật (bản web): mỗi dự án là một thư mục ảo riêng.
 * `makeEnv` dựng (hoặc nạp lại) thư mục ảo cho một dự án; `onRemove` xoá dữ liệu đã lưu của nó.
 */
export class KvProjectHost implements ProjectHost {
  private envs = new Map<string, Env>();
  constructor(
    private kv: KeyValue,
    private key: string,
    private defaults: { id: string; name: string },
    private makeEnv: (info: ProjectInfo) => Promise<Env>,
    private onRemove?: (info: ProjectInfo) => Promise<void>,
  ) {}

  private load(): Registry {
    const r = readJson<Registry | null>(this.kv, this.key, null);
    if (r && Array.isArray(r.projects) && r.projects.length) return r;
    const now = Date.now();
    return { active: this.defaults.id, projects: [{ id: this.defaults.id, name: this.defaults.name, created: now, lastUsed: now }] };
  }
  private save(r: Registry): void {
    this.kv.set(this.key, JSON.stringify(r));
  }

  async list(): Promise<ProjectsState> {
    const r = this.load();
    return { active: r.projects.some((p) => p.id === r.active) ? r.active : r.projects[0].id, projects: [...r.projects].sort((a, b) => b.lastUsed - a.lastUsed), canPick: false };
  }

  async open(id: string): Promise<Env> {
    const r = this.load();
    const info = r.projects.find((p) => p.id === id);
    if (!info) throw new Error("Không có dự án này.");
    let env = this.envs.get(id);
    if (!env) {
      env = await this.makeEnv(info);
      this.envs.set(id, env);
    }
    info.lastUsed = Date.now();
    r.active = id;
    this.save(r);
    return env;
  }

  async create(spec: { name: string }): Promise<{ info: ProjectInfo; env: Env }> {
    const r = this.load();
    const name = cleanProjectName(spec.name);
    if (!name) throw new Error("Hãy đặt tên cho dự án.");
    if (r.projects.some((p) => p.name.toLowerCase() === name.toLowerCase())) throw new Error(`Đã có dự án tên “${name}”.`);
    const now = Date.now();
    const info: ProjectInfo = { id: newId(), name, created: now, lastUsed: now };
    r.projects.push(info);
    r.active = info.id;
    this.save(r);
    const env = await this.makeEnv(info);
    this.envs.set(info.id, env);
    return { info, env };
  }

  async remove(id: string): Promise<void> {
    const r = this.load();
    const info = r.projects.find((p) => p.id === id);
    if (!info || r.projects.length <= 1) return;
    r.projects = r.projects.filter((p) => p.id !== id);
    if (r.active === id) r.active = r.projects[0].id;
    this.save(r);
    this.envs.delete(id);
    await this.onRemove?.(info);
  }

  async rename(id: string, name: string): Promise<void> {
    const r = this.load();
    const p = r.projects.find((x) => x.id === id);
    if (!p) return;
    p.name = cleanProjectName(name) || p.name;
    this.save(r);
  }
}
