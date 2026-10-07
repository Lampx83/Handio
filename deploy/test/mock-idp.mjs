// Máy chủ OIDC GIẢ chỉ để kiểm thử (không dùng ở môi trường thật): discovery, authorize (tự đồng ý), token (có PKCE), jwks, refresh.
import http from "node:http";
import crypto from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

export async function startMockIdp({ port = 0, host = "127.0.0.1", issuerHost = "127.0.0.1", clientId = "test-client", clientSecret = "", ttlSeconds = 3600 } = {}) {
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  const codes = new Map();
  const refresh = new Map();
  const state = { requests: [], ttlSeconds, issuer: "", badNonce: false };
  const sign = (user, nonce, aud = clientId, extra = {}) =>
    new SignJWT({ preferred_username: user, name: user.split("@")[0], ...(nonce ? { nonce } : {}), ...extra })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(state.issuer).setAudience(aud).setSubject("sub-" + user)
      .setIssuedAt().setExpirationTime(Math.floor(Date.now() / 1000) + state.ttlSeconds)
      .sign(privateKey);
  const json = (res, code, body) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, state.issuer || "http://x");
    state.requests.push(req.method + " " + u.pathname);
    if (u.pathname === "/.well-known/openid-configuration")
      return json(res, 200, { issuer: state.issuer, authorization_endpoint: state.issuer + "/authorize", token_endpoint: state.issuer + "/token", jwks_uri: state.issuer + "/jwks", id_token_signing_alg_values_supported: ["RS256"], subject_types_supported: ["public"], response_types_supported: ["code"], code_challenge_methods_supported: ["S256"], scopes_supported: ["openid", "profile", "email", "offline_access"] });
    if (u.pathname === "/jwks") return json(res, 200, { keys: [jwk] });
    if (u.pathname === "/authorize") {
      const q = u.searchParams;
      if (q.get("client_id") !== clientId) return json(res, 400, { error: "bad client" });
      const code = crypto.randomBytes(12).toString("hex");
      codes.set(code, { user: q.get("login_hint") || "lan@neu.edu.vn", nonce: q.get("nonce"), challenge: q.get("code_challenge"), method: q.get("code_challenge_method"), redirect: q.get("redirect_uri") });
      const back = new URL(q.get("redirect_uri"));
      back.searchParams.set("code", code);
      if (q.get("state")) back.searchParams.set("state", q.get("state"));
      res.writeHead(302, { location: back.href });
      return res.end();
    }
    if (u.pathname === "/token" && req.method === "POST") {
      let raw = "";
      for await (const c of req) raw += c;
      const f = new URLSearchParams(raw);
      if (f.get("client_id") !== clientId) return json(res, 400, { error: "invalid_client" });
      if (clientSecret && f.get("client_secret") !== clientSecret && f.get("grant_type") === "authorization_code" && !f.get("code_verifier")) return json(res, 400, { error: "invalid_client" });
      if (f.get("grant_type") === "authorization_code") {
        const c = codes.get(f.get("code"));
        codes.delete(f.get("code"));
        if (!c) return json(res, 400, { error: "invalid_grant" });
        if (c.redirect !== f.get("redirect_uri")) return json(res, 400, { error: "invalid_grant", error_description: "redirect_uri" });
        if (c.challenge) {
          const v = f.get("code_verifier") || "";
          if (crypto.createHash("sha256").update(v).digest("base64url") !== c.challenge) return json(res, 400, { error: "invalid_grant", error_description: "PKCE" });
        }
        const rt = crypto.randomBytes(16).toString("hex");
        refresh.set(rt, c.user);
        return json(res, 200, { token_type: "Bearer", expires_in: state.ttlSeconds, access_token: "at-" + rt, refresh_token: rt, id_token: await sign(c.user, state.badNonce ? "sai-nonce" : c.nonce) });
      }
      if (f.get("grant_type") === "refresh_token") {
        const user = refresh.get(f.get("refresh_token"));
        if (!user) return json(res, 400, { error: "invalid_grant" });
        const rt = crypto.randomBytes(16).toString("hex");
        refresh.delete(f.get("refresh_token"));
        refresh.set(rt, user);
        return json(res, 200, { token_type: "Bearer", expires_in: state.ttlSeconds, access_token: "at-" + rt, refresh_token: rt, id_token: await sign(user) });
      }
      return json(res, 400, { error: "unsupported_grant_type" });
    }
    json(res, 404, { error: "not found" });
  });
  await new Promise((r) => server.listen(port, host, r));
  const p = server.address().port;
  state.issuer = `http://${issuerHost}:${p}`;
  return { issuer: state.issuer, port: p, clientId, state, sign, revokeAllRefresh: () => refresh.clear(), close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}
