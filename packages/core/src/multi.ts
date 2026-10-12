// Nhiều dự án chạy CÙNG LÚC trong một tab: mỗi dự án có một LocalController riêng (phiên, tiến trình nền, lịch sử riêng).
// Chuyển dự án chỉ đổi "dự án đang xem": dự án cũ vẫn tiếp tục làm việc nền; sự kiện của nó được giữ lại (xin quyền, tiến trình)
// và đưa ra lại khi bạn quay về. Giao diện chỉ thấy MỘT dự án (đúng như một LocalController), nên UI/IPC không phải đổi hợp đồng.
import { LocalController, type ControllerOptions } from "./controller";
import { join } from "./path";
import { cleanProjectName, ID_RE, type ProjectHost, type ProjectsState } from "./projects";
import type { SessionEvent } from "./types";

/** Số dự án được làm việc cùng lúc (mỗi dự án một vòng gọi mô hình; đừng làm nghẽn máy chủ mô hình dùng chung). */
export const MAX_PARALLEL_PROJECTS = 3;

type Listener = (e: SessionEvent) => void;
type ProcEv = Extract<SessionEvent, { type: "proc" }>;

export async function createMultiProject(o: ControllerOptions & { projects: ProjectHost; /** Gọi sau khi tạo mỗi phiên dự án (dùng cho kiểm thử: thay mô hình giả). */ onChild?: (c: LocalController, projectId: string) => void }): Promise<LocalController> {
  const host = o.projects;
  const children = new Map<string, LocalController>();
  const listeners = new Set<Listener>();
  const finished = new Set<string>();
  const heldPerms = new Map<string, Map<string, SessionEvent>>();
  const heldProcs = new Map<string, Map<string, ProcEv>>();
  let activeId = "";
  let active!: LocalController;

  const fire = (e: SessionEvent): void => {
    for (const cb of [...listeners]) cb(e);
  };
  const background = (): { running: number; finished: number } => ({
    running: [...children].filter(([id, c]) => id !== activeId && c.isBusy()).length,
    finished: [...finished].filter((id) => id !== activeId).length,
  });
  const announce = (): void => fire({ type: "projects", ...background() });

  const wire = (id: string, c: LocalController): void => {
    c.onEvent((e) => {
      // giữ lại những gì giao diện cần dựng lại khi quay về dự án này
      if (e.type === "permission") {
        if (!heldPerms.has(id)) heldPerms.set(id, new Map());
        heldPerms.get(id)!.set(e.request.id, e);
      } else if (e.type === "permission_resolved") heldPerms.get(id)?.delete(e.id);
      else if (e.type === "proc") {
        if (!heldProcs.has(id)) heldProcs.set(id, new Map());
        heldProcs.get(id)!.set(e.id, e);
      }
      if (id === activeId) {
        fire(e);
        return;
      }
      // dự án chạy nền: chỉ báo tổng quan; nội dung của nó hiện khi bạn mở lại
      if (e.type === "turn_start") announce();
      else if (e.type === "turn_end") {
        if (!e.interrupted) finished.add(id);
        announce();
      } else if (e.type === "quota") fire(e);
    });
  };

  const childFor = async (id: string, env?: ControllerOptions["env"]): Promise<LocalController> => {
    let c = children.get(id);
    if (!c) {
      c = await LocalController.create({ ...o, env: env ?? (await host.open(id)) });
      children.set(id, c);
      wire(id, c);
      o.onChild?.(c, id);
    }
    return c;
  };

  const activate = (id: string, c: LocalController): void => {
    activeId = id;
    active = c;
    finished.delete(id);
    fire({ type: "reset" });
    for (const ev of heldPerms.get(id)?.values() ?? []) fire(ev); // yêu cầu quyền/câu hỏi đang chờ khi bạn vắng mặt
    for (const p of heldProcs.get(id)?.values() ?? []) if (p.state !== "exit") fire({ ...p, state: "start" });
    announce();
  };

  // dự án đang mở lúc khởi động
  const st0 = await host.list();
  activeId = st0.active;
  active = await LocalController.create(o);
  children.set(activeId, active);
  wire(activeId, active);
  o.onChild?.(active, activeId);

  const projectsState = async (): Promise<ProjectsState> => {
    const st = await host.list();
    const projects = await Promise.all(
      st.projects.map(async (p) => {
        const c = children.get(p.id);
        const running = !!c?.isBusy();
        const metas = o.chats ? await o.chats.list(p.id).catch(() => []) : [];
        const unfinished = metas.filter((m) => m.unfinished && !(running && c?.currentChatId() === m.id)).length;
        return { ...p, ...(running ? { running: true } : {}), ...(finished.has(p.id) && p.id !== activeId ? { finished: true } : {}), ...(unfinished ? { unfinished } : {}) };
      }),
    );
    return { ...st, projects, active: activeId };
  };

  const overrides: Record<string, unknown> = {
    onEvent(cb: Listener) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    async getState() {
      return { ...(await active.getState()), background: background() };
    },
    projectsState,
    async projectOpen(id: string) {
      if (!ID_RE.test(id) || id === activeId) return;
      const had = children.has(id);
      const c = await childFor(id);
      if (had) await host.open(id); // ghi nhớ "dự án đang mở" và giờ dùng gần nhất
      activate(id, c);
    },
    async projectCreate(spec: { name: string; instructions?: string }) {
      const name = cleanProjectName(spec.name ?? "");
      if (!name) return { error: "Hãy đặt tên cho dự án." };
      try {
        const { info, env } = await host.create({ name });
        const text = (spec.instructions ?? "").trim();
        if (text) await env.writeText(join(env.root, "AGENTS.md"), text.slice(0, 20000) + "\n");
        activate(info.id, await childFor(info.id, env));
        return { ok: true };
      } catch (e) {
        return { error: (e as Error).message };
      }
    },
    async projectPick() {
      if (!host.pick) return { error: "Bản này không chọn được thư mục trên máy." };
      try {
        const r = await host.pick();
        if (!r) return { ok: false };
        activate(r.info.id, children.get(r.info.id) ?? (await childFor(r.info.id, r.env)));
        return { ok: true };
      } catch (e) {
        return { error: (e as Error).message };
      }
    },
    async projectRemove(id: string) {
      if (!ID_RE.test(id)) return { error: "Mã dự án không hợp lệ." };
      const st = await host.list();
      if (st.projects.length <= 1) return { error: "Phải còn ít nhất một dự án." };
      const c = children.get(id);
      if (c) {
        c.dispose(); // dừng việc đang làm và tiến trình nền của dự án bị bỏ
        children.delete(id);
      }
      finished.delete(id);
      heldPerms.delete(id);
      heldProcs.delete(id);
      await host.remove(id);
      for (const m of (await o.chats?.list(id).catch(() => [])) ?? []) await o.chats?.remove(id, m.id);
      if (id === activeId) {
        const next = (await host.list()).projects[0];
        activate(next.id, await childFor(next.id));
      }
      return { ok: true };
    },
    async projectRename(id: string, name: string) {
      const n = cleanProjectName(name);
      if (!n || !ID_RE.test(id)) return;
      await host.rename(id, n);
      await children.get(id)?.projectRename(id, n); // cập nhật tên đang hiển thị trong phiên của dự án đó
    },
    async send(text: string) {
      const t = text.trim();
      const others = [...children].filter(([id, c]) => id !== activeId && c.isBusy()).length;
      if (!active.isBusy() && others >= MAX_PARALLEL_PROJECTS - 1 && t && !/^[/!]/.test(t)) {
        fire({ type: "notice", level: "warn", text: `Đang có ${others} dự án khác làm việc cùng lúc (tối đa ${MAX_PARALLEL_PROJECTS}). Hãy đợi một dự án xong rồi gửi tiếp.` });
        return;
      }
      return active.send(text);
    },
    respondPermission(id: string, res: Parameters<LocalController["respondPermission"]>[1]) {
      for (const c of children.values()) c.respondPermission(id, res); // mã yêu cầu là duy nhất: dự án không phải chủ sẽ bỏ qua
      for (const m of heldPerms.values()) m.delete(id);
    },
    async suspendForRestart() {
      let first: { projectId: string; chatId: string } | null = null;
      let mine: { projectId: string; chatId: string } | null = null;
      for (const [id, c] of children) {
        const at = await c.suspendForRestart().catch(() => null);
        if (!at) continue;
        first ??= at;
        if (id === activeId) mine = at;
      }
      return mine ?? first;
    },
    async resumeAfterRestart(at: { projectId: string; chatId: string }, text: string) {
      if (!ID_RE.test(at.projectId)) return false;
      if (activeId !== at.projectId) await (overrides.projectOpen as (id: string) => Promise<void>)(at.projectId);
      return active.resumeAfterRestart(at, text);
    },
    dispose() {
      for (const c of children.values()) c.dispose();
    },
  };

  return new Proxy({} as LocalController, {
    get(_t, prop: string) {
      if (prop in overrides) return overrides[prop];
      const v = (active as unknown as Record<string, unknown>)[prop];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(active) : v;
    },
    has(_t, prop: string) {
      return prop in overrides || prop in active;
    },
  });
}
