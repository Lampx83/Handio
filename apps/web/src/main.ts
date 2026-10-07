import "@neu/agent-ui/style.css";
import { buildWorkSamples, LocalController, MemoryEnv, SAMPLE_PROJECT, type AgentController, type Profile, type Settings, type SettingsStore, type TrustStore } from "@neu/agent-core";
import { mountShell } from "@neu/agent-ui";
import { autosave, restore, wipe } from "./persist";
import { runJsSandbox } from "./sandbox";

const ls = {
  get: (k: string): string | null => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string): void => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* bỏ qua */
    }
  },
};

const store: SettingsStore = {
  load: async () => {
    try {
      return JSON.parse(ls.get("neu.settings") ?? "null");
    } catch {
      return null;
    }
  },
  save: async (s: Settings) => ls.set("neu.settings", JSON.stringify(s)),
};
const trust: TrustStore = {
  isTrusted: async (r) => (JSON.parse(ls.get("neu.trust") ?? "[]") as string[]).includes(r),
  setTrusted: async (r, t) => {
    const l = (JSON.parse(ls.get("neu.trust") ?? "[]") as string[]).filter((x) => x !== r);
    if (t) l.push(r);
    ls.set("neu.trust", JSON.stringify(l));
  },
};

async function mockAvailable(): Promise<boolean> {
  try {
    return (await fetch("/mock/v1/models", { method: "GET" })).ok;
  } catch {
    return false;
  }
}

/** Dựng một thư mục ảo: nạp từ IndexedDB, nếu trống thì nạp dữ liệu mẫu. */
async function makeEnv(root: string, key: string, seed: () => Promise<Record<string, string | Uint8Array>>) {
  const env = new MemoryEnv(root);
  const load = async () => {
    const files = await seed();
    for (const [p, c] of Object.entries(files)) {
      const abs = `${root}/${p}`;
      if (typeof c === "string") await env.writeText(abs, c);
      else await env.writeBytes(abs, c);
    }
  };
  if (!(await restore(key, env))) await load();
  const save = autosave(key, env);
  await save();
  const reset = async () => {
    for (const e of env.exportEntries()) await env.remove(e.path);
    await wipe(key);
    await load();
    await save();
  };
  return { env, reset };
}

async function main(): Promise<void> {
  const hasMock = await mockAvailable();
  // Đường dẫn tương đối theo trang (…/agent/ → …/agent/vllm/v1): nginx cùng nguồn chuyển tới gateway và tự gắn key
  const gateway = new URL("vllm/v1", document.baseURI).href;
  const presets = [{ label: "Máy chủ của Khoa (Qwen3.5)", baseUrl: gateway, model: "qwen3.5-35b-a3b-int4", needsKey: false }];
  if (hasMock) presets.push({ label: "Demo giả lập (không cần key)", baseUrl: new URL("mock/v1", document.baseURI).href, model: "mock-agent", needsKey: false });
  // Máy từng chạy bản cũ có thể còn địa chỉ cũ trong localStorage: chuyển về địa chỉ mới
  try {
    const cur = JSON.parse(ls.get("neu.settings") ?? "null");
    if (cur && /(^|\/)(vllm|mock)\/v1$/.test(cur.baseUrl ?? "") && cur.baseUrl !== gateway && !hasMock) ls.set("neu.settings", JSON.stringify({ ...cur, baseUrl: gateway }));
  } catch {
    /* bỏ qua */
  }
  if (ls.get("neu.settings") === null) ls.set("neu.settings", JSON.stringify({ baseUrl: gateway }));

  const code = await makeEnv("/workspace", "code", async () => SAMPLE_PROJECT);
  code.env.runJs = runJsSandbox;
  const work = await makeEnv("/work", "work", buildWorkSamples);

  const controllers: Partial<Record<Profile, AgentController>> = {
    code: await LocalController.create({ env: code.env, profile: "code", store, trust, realFs: false, presets, resetWorkspace: code.reset }),
    work: await LocalController.create({ env: work.env, profile: "work", store, trust, realFs: false, presets, resetWorkspace: work.reset }),
  };
  mountShell(document.getElementById("root")!, controllers, { productName: "NEU Agent", downloadsBase: new URL("download/", document.baseURI).href });
  (window as unknown as { __neu: unknown }).__neu = { controllers, code: code.env, work: work.env };
}

void main();
