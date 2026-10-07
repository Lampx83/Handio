import type { MemoryEnv } from "@neu/agent-core";

const DB = "neu-agent";
const STORE = "workspaces";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
const tx = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
};

/** Nạp thư mục ảo đã lưu trong IndexedDB. Trả về true nếu có dữ liệu. */
export async function restore(key: string, env: MemoryEnv): Promise<boolean> {
  try {
    const entries = await tx<{ path: string; data: Uint8Array }[] | undefined>("readonly", (s) => s.get(key));
    if (entries?.length) {
      env.importEntries(entries);
      return true;
    }
  } catch {
    /* IndexedDB không dùng được (chế độ riêng tư…): chạy không lưu bền */
  }
  return false;
}

/** Tự lưu sau mỗi thay đổi (gộp trong 400 ms). */
export function autosave(key: string, env: MemoryEnv): () => Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = async () => {
    try {
      await tx("readwrite", (s) => s.put(env.exportEntries(), key));
    } catch {
      /* bỏ qua */
    }
  };
  env.onChange = () => {
    clearTimeout(timer);
    timer = setTimeout(save, 400);
  };
  return save;
}

export async function wipe(key: string): Promise<void> {
  try {
    await tx("readwrite", (s) => s.delete(key));
  } catch {
    /* bỏ qua */
  }
}
