// Kiểm tra chữ ký SAU khi đóng gói và ghi release/signing.json (trang tải dựa vào đây để nói đúng sự thật: đã ký hay chưa, ký bởi ai).
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const out = path.resolve("release");
const res = { mac: { signed: false, notarized: false, authority: "", teamId: "", detail: "" }, win: { signed: false, subject: "", detail: "" } };
const sh = (cmd, a) => { const r = spawnSync(cmd, a, { encoding: "utf8" }); return { ok: r.status === 0, out: (r.stdout || "") + (r.stderr || "") }; };

// ---- macOS (chỉ kiểm tra được trên macOS)
const apps = ["mac-arm64", "mac"].flatMap((d) => ["Hando.app", "NEU Agent.app"].map((n) => path.join(out, d, n))).filter((p) => fs.existsSync(p));
if (apps.length && process.platform === "darwin") {
  const app = apps[0];
  const info = sh("codesign", ["-dv", "--verbose=4", app]).out;
  const authority = (/Authority=(Developer ID Application:[^\n]+)/.exec(info) ?? [])[1] ?? "";
  const team = (/TeamIdentifier=([A-Z0-9]{10})/.exec(info) ?? [])[1] ?? "";
  const runtime = /flags=0x[0-9a-f]+\(.*runtime/.test(info);
  const strict = sh("codesign", ["--verify", "--deep", "--strict", app]);
  const assess = sh("spctl", ["--assess", "--type", "execute", "-vv", app]);
  const stapled = sh("xcrun", ["stapler", "validate", app]);
  res.mac = { signed: !!authority && strict.ok, notarized: assess.ok && /Notarized Developer ID/.test(assess.out) && stapled.ok, authority, teamId: team, hardenedRuntime: runtime, detail: assess.out.trim().split("\n")[0] };
  console.log(`macOS: ký=${res.mac.signed} notarize=${res.mac.notarized} ${authority || "(ad-hoc/không ký)"} ${res.mac.detail}`);
} else console.log("macOS: không có bản dựng hoặc không phải máy macOS → bỏ qua kiểm tra");

// ---- Windows
const exe = fs.existsSync(out) ? fs.readdirSync(out).find((f) => /-win-.*\.exe$/.test(f)) : undefined;
if (exe) {
  const f = path.join(out, exe);
  if (process.platform === "win32") {
    const r = sh("powershell", ["-NoProfile", "-Command", `$s=Get-AuthenticodeSignature -LiteralPath '${f.replace(/'/g, "''")}'; "$($s.Status)|$($s.SignerCertificate.Subject)"`]);
    const [status, subject] = r.out.trim().split("|");
    res.win = { signed: status === "Valid", subject: subject ?? "", detail: status };
  } else if (sh("osslsigncode", ["--version"]).ok) {
    const r = sh("osslsigncode", ["verify", "-in", f]);
    res.win = { signed: /Signature verification: ok/.test(r.out), subject: (/Subject: ([^\n]+)/.exec(r.out) ?? [])[1] ?? "", detail: r.out.includes("No signature found") ? "không có chữ ký" : "" };
  } else res.win.detail = "không kiểm tra được ở máy này (cần Windows hoặc osslsigncode)";
  console.log(`Windows: ký=${res.win.signed} ${res.win.subject} ${res.win.detail}`);
}
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "signing.json"), JSON.stringify(res, null, 2));
