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
