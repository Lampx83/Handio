import "@neu/agent-ui/style.css";
import { brandName, buildWorkSamples, createMultiProject, KvChatStore, setBrandName, KvProjectHost, LocalController, MemoryEnv, SAMPLE_DESIGN, SAMPLE_PROJECT, type AgentController, type Env, type Profile, type ProjectInfo, type RawPack, type Settings, type SettingsStore, type TrustStore } from "@neu/agent-core";
import { mountShell } from "@neu/agent-ui";
import { autosave, restore, wipe } from "./persist";
import { runJsSandbox } from "./sandbox";
import { shrinkImageBrowser } from "./image";

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

type Seed = () => Promise<Record<string, string | Uint8Array>>;

/**
 * Dự án trong trình duyệt: mỗi dự án là một thư mục ảo riêng, lưu trong IndexedDB (khoá `profile` cho dự án mẫu để giữ dữ liệu cũ,
 * `profile-<mã>` cho dự án tạo thêm). Chỉ dự án mẫu được nạp dữ liệu mẫu.
 */
function makeProjects(profile: Profile, root: string, legacySeed: Seed, legacyName: string, defaultName: string) {
  const keyOf = (info: ProjectInfo) => (info.id === "default" ? profile : `${profile}-${info.id}`);
  let cur: { info: ProjectInfo; env: MemoryEnv } | null = null;
  // Không còn nạp dữ liệu mẫu: dự án mới luôn trống. (legacySeed chỉ để dọn bản mẫu cũ đã nạp trước đây trong trình duyệt)
  const load = async (_info: ProjectInfo, _env: MemoryEnv) => {};
  const host = new KvProjectHost(
    { get: (k) => ls.get(k), set: (k, v) => ls.set(k, v) },
    `neu.projects.${profile}`,
    { id: "default", name: defaultName },
    async (info) => {
      const env = new MemoryEnv(root);
      if (!(await restore(keyOf(info), env))) await load(info, env);
      const save = autosave(keyOf(info), env);
      await save();
      if (profile === "code") env.runJs = runJsSandbox;
      env.shrinkImage = shrinkImageBrowser;
      cur = { info, env };
      return env as Env;
    },
    async (info) => wipe(keyOf(info)),
  );
  // ghi nhớ dự án đang mở để “Khôi phục dữ liệu mẫu” tác động đúng thư mục
  const open = host.open.bind(host);
  host.open = async (id) => {
    const env = await open(id);
    cur = { info: (await host.list()).projects.find((p) => p.id === id)!, env: env as MemoryEnv };
    return env;
  };
  const reset = async () => {
    if (!cur) return;
    for (const e of cur.env.exportEntries()) await cur.env.remove(e.path);
    await wipe(keyOf(cur.info));
    await load(cur.info, cur.env);
    await autosave(keyOf(cur.info), cur.env)();
  };
  /**
   * Dọn dữ liệu mẫu cũ MỘT lần: chỉ xoá tệp còn nguyên như bản mẫu (người dùng đã sửa/tạo thì giữ), rồi đổi tên dự án “mẫu”.
   */
  const dropSample = async () => {
    const before = (await host.list()).active;
    const env = (await host.open("default")) as MemoryEnv;
    for (const [p, c] of Object.entries(await legacySeed())) {
      const abs = `${root}/${p}`;
      try {
        const cur = await env.readBytes(abs);
        // văn bản: so từng byte; tệp Office (nén zip, có dấu thời gian nên mỗi lần dựng một khác): so kích thước, người dùng đã sửa thì kích thước hầu như chắc chắn đổi
        const want = typeof c === "string" ? new TextEncoder().encode(c) : c;
        const same = typeof c === "string" ? cur.length === want.length && cur.every((b, i) => b === want[i]) : Math.abs(cur.length - want.length) <= 2;
        if (same) await env.remove(abs);
      } catch {
        /* không có tệp này: bỏ qua */
      }
    }
    await autosave(keyOf({ id: "default" } as ProjectInfo), env)();
    const d = (await host.list()).projects.find((x) => x.id === "default");
    if (d && d.name === legacyName) await host.rename("default", defaultName);
    if (before !== "default") await host.open(before);
  };
  return { host, reset, dropSample };
}

/** Người đang đăng nhập (SSO do nginx + oauth2-proxy giữ). Ở máy phát triển (localhost) không có đăng nhập thì trả undefined. */
async function currentAccount(): Promise<{ email: string; name?: string; kind?: "microsoft" | "password"; logout(): void } | undefined> {
  try {
    const r = await fetch(new URL("oauth2/userinfo", document.baseURI), { cache: "no-store", credentials: "same-origin" });
    if (!r.ok || !/json/i.test(r.headers.get("content-type") ?? "")) return undefined;
    const j = (await r.json()) as { email?: string; preferredUsername?: string; user?: string };
    const email = j.email || j.preferredUsername || j.user;
    if (!email) return undefined;
    return { email, kind: j.email || j.preferredUsername ? "microsoft" : "password", logout: () => void (location.href = new URL("oauth2/sign_out?rd=" + encodeURIComponent(new URL(document.baseURI).pathname), document.baseURI).href) };
  } catch {
    return undefined;
  }
}

/** Hết phiên đăng nhập giữa chừng (máy chủ trả 401): tự đưa về trang đăng nhập, tối đa một lần mỗi 30 giây để không lặp vô hạn. */
const authFetch: typeof fetch = async (...a) => {
  const r = await fetch(...a);
  if (r.status === 401 && /\/vllm\//.test(String(a[0] instanceof Request ? a[0].url : a[0]))) {
    const last = Number(sessionStorage.getItem("neu.relogin") ?? 0);
    if (Date.now() - last > 30_000) {
      sessionStorage.setItem("neu.relogin", String(Date.now()));
      location.href = new URL("oauth2/sign_in?rd=" + encodeURIComponent(new URL(document.baseURI).pathname), document.baseURI).href;
    }
  }
  return r;
};

// Chrome/Edge cho cài bản web như một ứng dụng (cửa sổ riêng, biểu tượng riêng) mà không tải tệp thực thi nào
let installEvent: (Event & { prompt(): Promise<unknown> }) | null = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installEvent = e as typeof installEvent;
});

async function fetchOrgPacks(): Promise<RawPack[]> {
  try {
    const r = await authFetch(new URL("packs.json", document.baseURI).href);
    if (!r.ok || !(r.headers.get("content-type") ?? "").includes("json")) return [];
    const j = (await r.json()) as { packs?: { dir?: unknown; files?: unknown }[] };
    return (Array.isArray(j.packs) ? j.packs : []).filter((p) => typeof p.dir === "string" && p.files && typeof p.files === "object").map((p) => ({ dir: p.dir as string, origin: "org" as const, files: p.files as Record<string, string> }));
  } catch {
    return [];
  }
}

/** Tên hiển thị của nơi triển khai: tệp `brand.json` ({"name":"..."}) đặt cạnh ứng dụng; không có thì dùng tên mặc định. */
async function loadBrand(): Promise<void> {
  try {
    const r = await fetch(new URL("brand.json", document.baseURI), { cache: "no-store" });
    if (r.ok) setBrandName(((await r.json()) as { name?: unknown }).name);
  } catch {
    /* không có tệp: giữ tên mặc định */
  }
  document.title = brandName();
}

async function main(): Promise<void> {
  await loadBrand();
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

  // Gói mở rộng của tổ chức (docs/EXTENSIONS.md): packs.json sinh lúc dựng từ thư mục packs/. Không có thì chạy không có gói.
  const orgPacks = await fetchOrgPacks();
  const chats = (profile: Profile) => new KvChatStore({ get: (k) => ls.get(k), set: (k, v) => ls.set(k, v) }, `neu.chats.${profile}`);
  const make = async (profile: Profile, root: string, legacySeed: Seed, legacyName: string, defaultName: string): Promise<LocalController> => {
    const p = makeProjects(profile, root, legacySeed, legacyName, defaultName);
    if (ls.get("neu.nosample.v1") === null) await p.dropSample().catch(() => undefined);
    const st = await p.host.list();
    const env = await p.host.open(st.active);
    return createMultiProject({ env, profile, store, packs: async () => orgPacks, toolsBase: new URL(".", document.baseURI).href, defaults: { mode: "auto" }, trust, realFs: false, presets, fetchImpl: authFetch, diagnostics: { endpoint: new URL("diag", document.baseURI).href, version: "0.1.0", platform: "web", enabled: () => location.protocol === "https:" }, projects: p.host, chats: chats(profile) });
  };
  const controllers: Partial<Record<Profile, AgentController>> = {
    work: await make("work", "/work", buildWorkSamples, "Dự án mẫu", "Dự án của tôi"),
    code: await make("code", "/workspace", async () => SAMPLE_PROJECT, "Dự án mẫu", "Dự án của tôi"),
    design: await make("design", "/design", async () => SAMPLE_DESIGN, "Mẫu thiết kế", "Thiết kế của tôi"),
  };
  ls.set("neu.nosample.v1", "1");
  mountShell(document.getElementById("root")!, controllers, { productName: brandName(), downloadsBase: new URL("download/", document.baseURI).href, account: await currentAccount(), install: { available: () => !!installEvent, run: () => void installEvent?.prompt() } });
  (window as unknown as { __neu: unknown }).__neu = { controllers };
}

void main();
