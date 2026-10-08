import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error máy chủ OIDC giả chỉ dùng để kiểm thử (JS thuần)
import { startMockIdp } from "../../../deploy/test/mock-idp.mjs";
import { Auth, AuthError, emailAllowed, type AuthDeps } from "../src/auth";

interface Idp { issuer: string; clientId: string; state: { badNonce: boolean; ttlSeconds: number; requests: string[] }; sign(user: string, nonce?: string, aud?: string): Promise<string>; revokeAllRefresh(): void; close(): Promise<void> }
let idp: Idp;
beforeAll(async () => {
  idp = await startMockIdp({ clientId: "client-1" });
});
afterAll(() => idp.close());

/** “Trình duyệt” giả: mở địa chỉ đăng nhập, đi theo chuyển hướng tới 127.0.0.1 như người dùng thật. */
function deps(opts: { hint?: string; tamper?: (u: URL) => void; store?: { v: string | null }; clock?: { t: number } } = {}): AuthDeps & { store: { v: string | null }; opened: string[] } {
  const store = opts.store ?? { v: null };
  const opened: string[] = [];
  return {
    fetch: (...a) => fetch(...a),
    store, opened,
    now: opts.clock ? () => opts.clock!.t : undefined,
    storage: { load: async () => store.v, save: async (d) => void (store.v = d) },
    async openExternal(url) {
      opened.push(url);
      const u = new URL(url);
      if (opts.hint) u.searchParams.set("login_hint", opts.hint);
      const r = await fetch(u, { redirect: "manual" });
      const back = new URL(r.headers.get("location")!);
      opts.tamper?.(back);
      await fetch(back).catch(() => undefined);
    },
  };
}
const cfg = () => ({ issuer: idp.issuer, clientId: "client-1", domains: ["neu.edu.vn", "st.neu.edu.vn"], redirectHost: "127.0.0.1", allowInsecureIssuer: true, loginTimeoutMs: 5000 });

describe("đăng nhập SSO (OIDC + PKCE) với máy chủ giả", () => {
  it("đăng nhập thành công: email giảng viên và sinh viên đều được; lưu phiên; có Bearer", async () => {
    for (const email of ["lan@neu.edu.vn", "11230001@st.neu.edu.vn"]) {
      const d = deps({ hint: email });
      const a = new Auth(cfg(), d);
      const st = await a.login();
      expect(st).toMatchObject({ enabled: true, signedIn: true, email });
      expect((await a.getBearer())!.split(".")).toHaveLength(3);
      expect(JSON.parse(d.store.v!).email).toBe(email);
      const u = new URL(d.opened[0]);
      expect(u.searchParams.get("code_challenge_method")).toBe("S256");
      expect(u.searchParams.get("response_type")).toBe("code");
      expect(u.searchParams.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
      expect(u.searchParams.get("state")!.length).toBeGreaterThan(20);
    }
  });

  it("từ chối tài khoản ngoài miền được phép", async () => {
    const a = new Auth(cfg(), deps({ hint: "ke-xau@gmail.com" }));
    await expect(a.login()).rejects.toThrow(/miền/);
    expect(a.status().signedIn).toBe(false);
    expect(await a.getBearer()).toBeNull();
  });

  it("từ chối khi state bị đánh tráo (chống giả mạo callback)", async () => {
    const a = new Auth(cfg(), deps({ tamper: (u) => u.searchParams.set("state", "gia-mao") }));
    await expect(a.login()).rejects.toThrow(/state/);
    expect(a.status().signedIn).toBe(false);
  });

  it("từ chối khi nonce trong id_token không khớp", async () => {
    idp.state.badNonce = true;
    try {
      await expect(new Auth(cfg(), deps()).login()).rejects.toThrow(/nonce/);
    } finally {
      idp.state.badNonce = false;
    }
  });

  it("máy chủ cục bộ chỉ nhận /callback; lỗi từ nhà cấp (access_denied) được báo", async () => {
    const d = deps();
    const a = new Auth(cfg(), { ...d, async openExternal(url) {
      const r = await fetch(new URL(url), { redirect: "manual" });
      const back = new URL(r.headers.get("location")!);
      expect((await fetch(new URL("/etc/passwd", back))).status).toBe(404);
      expect((await fetch(back, { method: "POST" })).status).toBe(404);
      back.searchParams.delete("code");
      back.searchParams.set("error", "access_denied");
      await fetch(back);
    } });
    await expect(a.login()).rejects.toThrow(/access_denied|từ chối/);
  });

  it("hết thời gian chờ thì dừng và đóng cổng", async () => {
    const a = new Auth({ ...cfg(), loginTimeoutMs: 300 }, { ...deps(), async openExternal() { /* người dùng không làm gì */ } });
    await expect(a.login()).rejects.toThrow(/thời gian/);
  });

  it("tự làm mới token khi sắp hết hạn; đăng xuất khi không làm mới được", async () => {
    const clock = { t: Date.now() };
    const d = deps({ clock });
    const a = new Auth(cfg(), d);
    await a.login();
    const first = await a.getBearer();
    clock.t += 3500 * 1000; // còn < 2 phút
    const second = await a.getBearer();
    expect(second).not.toBe(first);
    expect(idp.state.requests.filter((r) => r === "POST /token").length).toBeGreaterThanOrEqual(2);
    clock.t += 3500 * 1000;
    idp.revokeAllRefresh();
    expect(await a.getBearer()).toBeNull();
    expect(a.status().signedIn).toBe(false);
    expect(d.store.v).toBeNull();
  });

  it("khôi phục phiên đã lưu lúc mở app; phiên hỏng/ngoài miền bị bỏ", async () => {
    const d = deps();
    await new Auth(cfg(), d).login();
    const again = new Auth(cfg(), deps({ store: d.store }));
    expect((await again.init()).signedIn).toBe(true);
    const bad = new Auth(cfg(), deps({ store: { v: JSON.stringify({ email: "x@gmail.com", idToken: "a.b.c", exp: 9e9 }) } }));
    expect((await bad.init()).signedIn).toBe(false);
    expect((await new Auth(cfg(), deps({ store: { v: "không phải json" } })).init()).signedIn).toBe(false);
  });

  it("từ chối issuer http:// (trừ máy cục bộ khi cho phép) và issuer không khớp", async () => {
    expect(() => new Auth({ ...cfg(), issuer: "http://login.example.com/v2.0", allowInsecureIssuer: false }, deps())).toThrow(AuthError);
    expect(() => new Auth({ ...cfg(), issuer: "http://login.example.com/v2.0", allowInsecureIssuer: true }, deps())).toThrow(AuthError);
    await expect(new Auth({ ...cfg(), issuer: idp.issuer + "/khac" }, deps()).login()).rejects.toThrow();
  });

  it("emailAllowed so khớp đúng miền, không nhận miền con giả", () => {
    const d = ["neu.edu.vn", "st.neu.edu.vn"];
    expect(emailAllowed("A@NEU.EDU.VN", d)).toBe(true);
    expect(emailAllowed("a@st.neu.edu.vn", d)).toBe(true);
    for (const bad of ["a@evil.neu.edu.vn", "a@neu.edu.vn.evil.com", "a@xneu.edu.vn", "neu.edu.vn", "@neu.edu.vn", "", "a@gmail.com"]) expect(emailAllowed(bad, d), bad).toBe(false);
  });
});

/** Máy chủ giả mô phỏng form đăng nhập của oauth2-proxy: đúng → 302 + cookie phiên; sai → trang đăng nhập (200); “limited” → 429. */
async function fakeSignIn() {
  const seen: { path: string; method: string; body: string }[] = [];
  const srv = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ path: req.url ?? "", method: req.method ?? "", body });
      const f = new URLSearchParams(body);
      if (f.get("username") === "limited") return void res.writeHead(429).end("slow");
      if (req.method === "POST" && f.get("username") === "khach01" && f.get("password") === "mat-khau-dung-123") {
        res.writeHead(302, { Location: "/", "Set-Cookie": ["_neuagent_sso=PHIEN123; Path=/agent; Max-Age=28800; HttpOnly; SameSite=Lax", "_neuagent_sso_1=; Path=/agent; Max-Age=0", "khac=doc-hai; Path=/"] }).end();
      } else res.writeHead(200, { "Content-Type": "text/html" }).end("<form>Đăng nhập</form>");
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(srv.address() as { port: number }).port}/agent/oauth2/sign_in`;
  return { url, seen, close: () => new Promise<void>((r) => { srv.closeAllConnections?.(); srv.close(() => r()); }) };
}

describe("đăng nhập bằng tên + mật khẩu (tài khoản do quản trị tạo)", () => {
  const mk = async (opts: { store?: { v: string | null }; clock?: { t: number } } = {}) => {
    const fake = await fakeSignIn();
    const d = deps({ store: opts.store, clock: opts.clock });
    const a = new Auth({ ...cfg(), passwordLogin: { signInUrl: fake.url } }, d);
    return { a, d, fake };
  };

  it("đúng: giữ CHỈ cookie phiên của đăng nhập (không giữ mật khẩu, bỏ cookie lạ/rỗng), gửi cookie khi gọi máy chủ", async () => {
    const { a, d, fake } = await mk();
    const st = await a.loginPassword("khach01", "mat-khau-dung-123");
    expect(st).toMatchObject({ signedIn: true, email: "khach01", kind: "password", passwordLogin: true });
    expect(await a.getHeaders()).toEqual({ Cookie: "_neuagent_sso=PHIEN123" });
    expect(await a.getBearer()).toBeNull(); // không có Bearer cho tài khoản mật khẩu
    expect(a.peekHeaders()).toEqual({ Cookie: "_neuagent_sso=PHIEN123" });
    expect(d.store.v).not.toContain("mat-khau-dung-123");
    expect(d.store.v).not.toContain("doc-hai");
    expect(fake.seen).toHaveLength(1);
    expect(fake.seen[0]).toMatchObject({ method: "POST", path: "/agent/oauth2/sign_in" });
    await fake.close();
  });

  it("sai mật khẩu / sai tên: báo lỗi chung, không có phiên", async () => {
    const { a, fake } = await mk();
    await expect(a.loginPassword("khach01", "sai-mat-khau")).rejects.toThrow(/không đúng/);
    await expect(a.loginPassword("khong-co", "mat-khau-dung-123")).rejects.toThrow(/không đúng/);
    expect(a.status().signedIn).toBe(false);
    expect(await a.getHeaders()).toBeNull();
    await fake.close();
  });

  it("bị giới hạn tốc độ (429) thì báo chờ", async () => {
    const { a, fake } = await mk();
    await expect(a.loginPassword("limited", "mat-khau-dung-123")).rejects.toThrow(/quá nhiều lần/);
    await fake.close();
  });

  it("tên/mật khẩu không hợp lệ bị từ chối NGAY, không gửi gì ra mạng", async () => {
    const { a, fake } = await mk();
    for (const [u, p] of [["a b", "x"], ["../etc", "x"], ["", "x"], ["a".repeat(65), "x"], ["khach01", ""], ["khach01", "x".repeat(201)], ["khach01", "x\ny"], ["khach01", "x\u0000y"]]) await expect(a.loginPassword(u, p)).rejects.toThrow(/không hợp lệ/);
    expect(fake.seen).toHaveLength(0);
    await fake.close();
  });

  it("hết hạn phiên (8 giờ) thì tự đăng xuất và xoá phiên đã lưu", async () => {
    const clock = { t: Date.now() };
    const { a, d, fake } = await mk({ clock });
    await a.loginPassword("khach01", "mat-khau-dung-123");
    clock.t += 7 * 3600 * 1000;
    expect(await a.getHeaders()).not.toBeNull();
    clock.t += 2 * 3600 * 1000;
    expect(await a.getHeaders()).toBeNull();
    expect(a.status().signedIn).toBe(false);
    expect(d.store.v).toBeNull();
    await fake.close();
  });

  it("mở lại ứng dụng: phiên mật khẩu còn hạn được khôi phục; hết hạn thì không", async () => {
    const store = { v: null as string | null };
    const clock = { t: Date.now() };
    const first = await mk({ store, clock });
    await first.a.loginPassword("khach01", "mat-khau-dung-123");
    const again = new Auth({ ...cfg(), passwordLogin: { signInUrl: first.fake.url } }, deps({ store, clock }));
    expect((await again.init()).signedIn).toBe(true);
    clock.t += 9 * 3600 * 1000;
    const late = new Auth({ ...cfg(), passwordLogin: { signInUrl: first.fake.url } }, deps({ store, clock }));
    expect((await late.init()).signedIn).toBe(false);
    await first.fake.close();
  });

  it("tắt khi máy chủ không bật; chỉ gửi mật khẩu qua https (trừ máy cục bộ khi thử)", async () => {
    await expect(new Auth(cfg(), deps()).loginPassword("khach01", "x")).rejects.toThrow(/không bật/);
    const a = new Auth({ ...cfg(), allowInsecureIssuer: false, issuer: "https://login.microsoftonline.com/x/v2.0", passwordLogin: { signInUrl: "http://ai.neu.edu.vn/agent/oauth2/sign_in" } }, deps());
    await expect(a.loginPassword("khach01", "mat-khau-dung-123")).rejects.toThrow(/https/);
  });

  it("đăng nhập Microsoft cũ vẫn chạy và trạng thái nói rõ loại đăng nhập", async () => {
    const { a, fake } = await mk();
    const sso = new Auth({ ...cfg(), passwordLogin: { signInUrl: fake.url } }, deps({ hint: "lan@neu.edu.vn" }));
    expect(await sso.login()).toMatchObject({ kind: "microsoft", email: "lan@neu.edu.vn" });
    expect(await sso.getHeaders()).toHaveProperty("Authorization");
    void a;
    await fake.close();
  });
});
