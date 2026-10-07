// Đăng nhập SSO (OpenID Connect, luồng Authorization Code + PKCE, ứng dụng "public client") bằng TRÌNH DUYỆT HỆ THỐNG.
// Mô-đun thuần Node (không import electron) để kiểm thử được. Token chỉ nằm trong bộ nhớ và trong kho mã hoá của hệ điều hành.
import crypto from "node:crypto";
import http from "node:http";
import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";

export interface AuthConfig {
  /** URL issuer, vd https://login.microsoftonline.com/<tenant>/v2.0 */
  issuer: string;
  clientId: string;
  /** Miền email được phép (vd neu.edu.vn, st.neu.edu.vn). */
  domains: string[];
  scopes?: string;
  /** Tên máy trong redirect URI. Microsoft Entra yêu cầu "localhost" cho ứng dụng máy tính. */
  redirectHost?: string;
  /** Cho phép issuer http:// (chỉ để thử với máy chủ giả ở 127.0.0.1). */
  allowInsecureIssuer?: boolean;
  loginTimeoutMs?: number;
}

export interface AuthDeps {
  fetch: typeof fetch;
  /** Mở địa chỉ trong trình duyệt hệ thống. Bên gọi phải tự kiểm tra địa chỉ hợp lệ. */
  openExternal(url: string): Promise<void>;
  /** Kho lưu phiên (đã mã hoá phía bên gọi). null = xoá. */
  storage: { load(): Promise<string | null>; save(data: string | null): Promise<void> };
  now?(): number;
}

export interface AuthStatus {
  enabled: boolean;
  signedIn: boolean;
  email?: string;
  name?: string;
}

interface Session {
  email: string;
  name?: string;
  idToken: string;
  refreshToken?: string;
  /** Giây UNIX hết hạn của id_token. */
  exp: number;
}

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

const b64u = (b: Buffer): string => b.toString("base64url");
const REFRESH_MARGIN = 120; // làm mới token khi còn dưới 2 phút

export class AuthError extends Error {}

export function emailAllowed(email: string, domains: string[]): boolean {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  return at > 0 && domains.some((d) => e.slice(at + 1) === d.toLowerCase());
}

export class Auth {
  private session: Session | null = null;
  private disc: Discovery | null = null;
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
  private refreshing: Promise<boolean> | null = null;
  private listeners = new Set<(s: AuthStatus) => void>();
  private now: () => number;

  constructor(private cfg: AuthConfig, private deps: AuthDeps) {
    this.now = deps.now ?? (() => Date.now());
    const u = new URL(cfg.issuer);
    if (u.protocol !== "https:" && !(cfg.allowInsecureIssuer && /^(127\.0\.0\.1|localhost|\[::1\])$/.test(u.hostname))) throw new AuthError("Issuer phải là https://");
  }

  status(): AuthStatus {
    return { enabled: true, signedIn: !!this.session, email: this.session?.email, name: this.session?.name };
  }
  onChange(cb: (s: AuthStatus) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  private emit(): void {
    for (const l of this.listeners) {
      try {
        l(this.status());
      } catch {
        /* bỏ qua */
      }
    }
  }

  private async discovery(): Promise<Discovery> {
    if (this.disc) return this.disc;
    const url = this.cfg.issuer.replace(/\/+$/, "") + "/.well-known/openid-configuration";
    const r = await this.deps.fetch(url, { redirect: "error" });
    if (!r.ok) throw new AuthError("Không lấy được cấu hình đăng nhập (" + r.status + ").");
    const d = (await r.json()) as Discovery;
    if (d.issuer !== this.cfg.issuer.replace(/\/+$/, "") && d.issuer !== this.cfg.issuer) throw new AuthError("Máy chủ đăng nhập trả issuer không khớp.");
    const secure = (s: string) => {
      const u = new URL(s);
      return u.protocol === "https:" || (!!this.cfg.allowInsecureIssuer && /^(127\.0\.0\.1|localhost)$/.test(u.hostname));
    };
    if (![d.authorization_endpoint, d.token_endpoint, d.jwks_uri].every((x) => typeof x === "string" && secure(x))) throw new AuthError("Cấu hình đăng nhập không an toàn.");
    this.disc = d;
    this.jwks = createRemoteJWKSet(new URL(d.jwks_uri), { [customFetch]: (u: string, o: RequestInit) => this.deps.fetch(u, { ...o, redirect: "error" }) });
    return d;
  }

  /** Kiểm tra id_token: chữ ký (JWKS), issuer, đối tượng (client id), hạn, nonce, miền email. */
  private async verify(idToken: string, nonce?: string): Promise<{ email: string; name?: string; exp: number }> {
    await this.discovery();
    const { payload } = await jwtVerify(idToken, this.jwks!, { issuer: this.disc!.issuer, audience: this.cfg.clientId, algorithms: ["RS256"], currentDate: new Date(this.now()) });
    if (nonce !== undefined && payload.nonce !== nonce) throw new AuthError("Phiên đăng nhập không khớp (nonce).");
    const email = String(payload.preferred_username ?? payload.email ?? "").toLowerCase();
    if (!emailAllowed(email, this.cfg.domains)) throw new AuthError("Tài khoản này không thuộc miền được phép (" + this.cfg.domains.map((d) => "@" + d).join(", ") + ").");
    return { email, name: typeof payload.name === "string" ? payload.name : undefined, exp: Number(payload.exp) };
  }

  private async persist(): Promise<void> {
    await this.deps.storage.save(this.session ? JSON.stringify(this.session) : null).catch(() => undefined);
  }

  /** Khôi phục phiên đã lưu (nếu còn hiệu lực hoặc làm mới được). */
  async init(): Promise<AuthStatus> {
    try {
      const raw = await this.deps.storage.load();
      const s = raw ? (JSON.parse(raw) as Session) : null;
      if (s && typeof s.idToken === "string" && typeof s.email === "string" && emailAllowed(s.email, this.cfg.domains)) {
        this.session = s;
        if (s.exp - this.now() / 1000 < REFRESH_MARGIN && !(await this.refresh())) this.session = null;
      }
    } catch {
      this.session = null;
    }
    this.emit();
    return this.status();
  }

  async login(): Promise<AuthStatus> {
    const d = await this.discovery();
    const verifier = b64u(crypto.randomBytes(48));
    const challenge = b64u(crypto.createHash("sha256").update(verifier).digest());
    const state = b64u(crypto.randomBytes(24));
    const nonce = b64u(crypto.randomBytes(24));
    const host = this.cfg.redirectHost ?? "localhost";

    // máy chủ cục bộ chỉ nghe 127.0.0.1, chỉ nhận đúng một đường dẫn /callback và đúng một lần
    let settle!: (v: { code?: string; error?: string }) => void;
    const result = new Promise<{ code?: string; error?: string }>((r) => (settle = r));
    const server = http.createServer((req, res) => {
      const u = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method !== "GET" || u.pathname !== "/callback") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        return void res.end("404");
      }
      const ok = !!u.searchParams.get("code") && u.searchParams.get("state") === state;
      res.writeHead(ok ? 200 : 400, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
      res.end(`<!doctype html><meta charset="utf-8"><title>NEU Agent</title><body style="font:16px system-ui;text-align:center;margin-top:20vh">${ok ? "✔ Đã đăng nhập. Bạn có thể đóng cửa sổ này và quay lại NEU Agent." : "Đăng nhập không thành công. Hãy quay lại NEU Agent và thử lại."}</body>`);
      if (u.searchParams.get("state") !== state) return settle({ error: "Phiên đăng nhập không khớp (state)." });
      settle(ok ? { code: u.searchParams.get("code")! } : { error: u.searchParams.get("error_description") || u.searchParams.get("error") || "Đăng nhập bị từ chối." });
    });
    await new Promise<void>((r, j) => {
      server.once("error", j);
      server.listen(0, "127.0.0.1", r);
    });
    const port = (server.address() as { port: number }).port;
    const redirect = `http://${host}:${port}/callback`;
    const timer = setTimeout(() => settle({ error: "Hết thời gian chờ đăng nhập." }), this.cfg.loginTimeoutMs ?? 5 * 60_000);
    try {
      const auth = new URL(d.authorization_endpoint);
      auth.search = new URLSearchParams({ client_id: this.cfg.clientId, response_type: "code", redirect_uri: redirect, response_mode: "query", scope: this.cfg.scopes ?? "openid profile email offline_access", state, nonce, code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account" }).toString();
      await this.deps.openExternal(auth.href);
      const r = await result;
      if (!r.code) throw new AuthError(r.error ?? "Đăng nhập không thành công.");
      const tok = await this.tokenRequest({ grant_type: "authorization_code", code: r.code, redirect_uri: redirect, code_verifier: verifier });
      const v = await this.verify(tok.id_token, nonce);
      this.session = { email: v.email, name: v.name, idToken: tok.id_token, refreshToken: tok.refresh_token, exp: v.exp };
      await this.persist();
      this.emit();
      return this.status();
    } finally {
      clearTimeout(timer);
      server.closeAllConnections?.();
      server.close();
    }
  }

  private async tokenRequest(params: Record<string, string>): Promise<{ id_token: string; refresh_token?: string }> {
    const d = await this.discovery();
    const body = new URLSearchParams({ client_id: this.cfg.clientId, scope: this.cfg.scopes ?? "openid profile email offline_access", ...params });
    const r = await this.deps.fetch(d.token_endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body, redirect: "error" });
    const j = (await r.json().catch(() => ({}))) as { id_token?: string; refresh_token?: string; error?: string; error_description?: string };
    if (!r.ok || !j.id_token) throw new AuthError(j.error === "invalid_grant" ? "Phiên đăng nhập đã hết hạn." : "Máy chủ đăng nhập từ chối (" + (j.error ?? r.status) + ").");
    return { id_token: j.id_token, refresh_token: j.refresh_token };
  }

  /** Làm mới id_token bằng refresh_token. Trả false (và đăng xuất) nếu không làm mới được. */
  private refresh(): Promise<boolean> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const s = this.session;
      if (!s?.refreshToken) return false;
      try {
        const tok = await this.tokenRequest({ grant_type: "refresh_token", refresh_token: s.refreshToken });
        const v = await this.verify(tok.id_token);
        this.session = { email: v.email, name: v.name ?? s.name, idToken: tok.id_token, refreshToken: tok.refresh_token ?? s.refreshToken, exp: v.exp };
        await this.persist();
        return true;
      } catch {
        return false;
      }
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  /** Token hiện có nếu còn hạn (không làm mới, không chờ): dùng cho việc nền như gửi số liệu chẩn đoán. */
  peekBearer(): string | null {
    return this.session && this.session.exp - this.now() / 1000 > 30 ? this.session.idToken : null;
  }

  /** id_token còn hạn để gửi dạng Bearer; tự làm mới. null nếu chưa/không còn đăng nhập. */
  async getBearer(): Promise<string | null> {
    if (!this.session) return null;
    if (this.session.exp - this.now() / 1000 < REFRESH_MARGIN) {
      if (!(await this.refresh())) {
        await this.logout();
        return null;
      }
    }
    return this.session?.idToken ?? null;
  }

  async logout(): Promise<void> {
    const had = !!this.session;
    this.session = null;
    await this.persist();
    if (had) this.emit();
  }
}
