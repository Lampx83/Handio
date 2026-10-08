#!/usr/bin/env node
// Quản lý phiên bản NEU Agent: một nguồn sự thật cho số phiên bản + CHANGELOG.md. Chỉ dùng thư viện chuẩn của Node.
//   node scripts/version.mjs show                         in phiên bản ở mọi gói + package-lock + CHANGELOG
//   node scripts/version.mjs check                        kiểm tra mọi nơi cùng một phiên bản và CHANGELOG có mục cho phiên bản đó (thoát 1 nếu lệch)
//   node scripts/version.mjs bump <patch|minor|major|X.Y.Z[-hậu-tố]> [--allow-empty] [--date YYYY-MM-DD]
//        nâng phiên bản ở mọi gói + package-lock, chuyển mục "Chưa phát hành" của CHANGELOG thành mục phiên bản mới
//   node scripts/version.mjs notes [phiên-bản]            in ghi chú phát hành (từ CHANGELOG) của phiên bản, dạng văn bản thường (dùng cho latest.json)
// Không tự commit/tag/đẩy: in ra các lệnh tiếp theo để người phát hành chạy (xem docs/RELEASE.md).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const VERSION_RE = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})(?:-([0-9A-Za-z.]{1,16}))?$/;
export const UNRELEASED = "Chưa phát hành";

export function bumpVersion(current, kind) {
  const m = VERSION_RE.exec(current);
  if (!m) throw new Error(`Phiên bản hiện tại không hợp lệ: ${current}`);
  if (VERSION_RE.test(kind)) return kind;
  const [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (kind === "major") return `${maj + 1}.0.0`;
  if (kind === "minor") return `${maj}.${min + 1}.0`;
  if (kind === "patch") return `${maj}.${min}.${pat + 1}`;
  throw new Error(`Cần patch | minor | major hoặc số phiên bản X.Y.Z (nhận: ${kind})`);
}

/** Tách CHANGELOG thành {unreleased, releases:[{version,date,body}]}; mỗi mục bắt đầu bằng "## [..]". */
export function parseChangelog(text) {
  const parts = text.split(/^(?=## \[)/m);
  const out = { head: parts[0] ?? "", unreleased: "", releases: [] };
  for (const sec of parts.slice(1)) {
    const m = /^## \[([^\]]+)\](?:\s*-\s*(\d{4}-\d{2}-\d{2}))?[^\n]*\n?([\s\S]*)$/.exec(sec);
    if (!m) continue;
    if (m[1] === UNRELEASED) out.unreleased = m[3].trim();
    else out.releases.push({ version: m[1], date: m[2] ?? "", body: m[3].trim() });
  }
  return out;
}

/** Chuyển nội dung "Chưa phát hành" thành mục của phiên bản mới; để lại mục "Chưa phát hành" rỗng. */
export function promoteChangelog(text, version, date, { allowEmpty = false } = {}) {
  const c = parseChangelog(text);
  if (c.releases.some((r) => r.version === version)) throw new Error(`CHANGELOG đã có mục cho ${version}`);
  if (!c.unreleased && !allowEmpty) throw new Error(`Mục "${UNRELEASED}" trong CHANGELOG.md đang trống: hãy ghi lại những gì đã đổi (hoặc dùng --allow-empty).`);
  const sections = [`## [${UNRELEASED}]\n`, `## [${version}] - ${date}\n\n${c.unreleased || "- Cập nhật bảo trì."}\n`, ...c.releases.map((r) => `## [${r.version}]${r.date ? ` - ${r.date}` : ""}\n\n${r.body}\n`)];
  return `${c.head.replace(/\s+$/, "")}\n\n${sections.join("\n")}`;
}

/** Ghi chú phát hành dạng văn bản thường (≤ 2000 ký tự) để đặt vào latest.json. */
export function notesFor(text, version) {
  const r = parseChangelog(text).releases.find((x) => x.version === version);
  if (!r) return "";
  return r.body
    .split("\n")
    .map((l) => l.replace(/^###\s*/, "").replace(/^\s*[-*]\s+/, "• ").replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1").trimEnd())
    .filter((l) => l.trim())
    .join("\n")
    .slice(0, 2000);
}

function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export function workspaceFiles(root) {
  const rootPkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const dirs = (rootPkg.workspaces ?? []).filter((d) => !d.includes("*"));
  return ["package.json", ...dirs.map((d) => path.join(d, "package.json"))];
}

export function readVersions(root) {
  const v = {};
  for (const f of workspaceFiles(root)) v[f] = JSON.parse(fs.readFileSync(path.join(root, f), "utf8")).version;
  const lockPath = path.join(root, "package-lock.json");
  if (fs.existsSync(lockPath)) {
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    v["package-lock.json"] = lock.packages?.[""]?.version ?? lock.version;
  }
  return v;
}

export function checkAll(root) {
  const problems = [];
  const v = readVersions(root);
  const main = v["package.json"];
  for (const [f, ver] of Object.entries(v)) if (ver !== main) problems.push(`${f} ở ${ver}, khác package.json (${main})`);
  if (!VERSION_RE.test(main)) problems.push(`Phiên bản không hợp lệ: ${main}`);
  const clPath = path.join(root, "CHANGELOG.md");
  if (!fs.existsSync(clPath)) problems.push("Thiếu CHANGELOG.md");
  else if (!parseChangelog(fs.readFileSync(clPath, "utf8")).releases.some((r) => r.version === main)) problems.push(`CHANGELOG.md chưa có mục cho ${main} (chạy: node scripts/version.mjs bump ...)`);
  return { version: main, problems };
}

export function applyBump(root, next) {
  for (const f of workspaceFiles(root)) {
    const p = path.join(root, f);
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    j.version = next;
    fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
  }
  const lockPath = path.join(root, "package-lock.json");
  if (fs.existsSync(lockPath)) {
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    lock.version = next;
    for (const key of ["", ...workspaceFiles(root).slice(1).map((f) => path.dirname(f))]) if (lock.packages?.[key]) lock.packages[key].version = next;
    fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");
  }
}

function main(argv) {
  const root = repoRoot();
  const [cmd, ...rest] = argv;
  const flag = (n) => rest.includes(n);
  const opt = (n) => (rest.includes(n) ? rest[rest.indexOf(n) + 1] : undefined);
  if (cmd === "show") {
    for (const [f, v] of Object.entries(readVersions(root))) console.log(`${v.padEnd(12)} ${f}`);
    return 0;
  }
  if (cmd === "check") {
    const r = checkAll(root);
    if (r.problems.length) {
      console.error(r.problems.map((p) => "✗ " + p).join("\n"));
      return 1;
    }
    console.log(`✓ Phiên bản ${r.version} nhất quán ở mọi gói và có trong CHANGELOG.md`);
    return 0;
  }
  if (cmd === "notes") {
    const v = rest[0] ?? readVersions(root)["package.json"];
    process.stdout.write(notesFor(fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8"), v) + "\n");
    return 0;
  }
  if (cmd === "bump") {
    const kind = rest.find((a) => !a.startsWith("--") && a !== opt("--date"));
    if (!kind) throw new Error("Thiếu loại nâng: patch | minor | major | X.Y.Z");
    const cur = readVersions(root)["package.json"];
    const next = bumpVersion(cur, kind);
    const order = (a, b) => {
      const x = VERSION_RE.exec(a);
      const y = VERSION_RE.exec(b);
      for (let i = 1; i <= 3; i++) if (Number(x[i]) !== Number(y[i])) return Number(x[i]) - Number(y[i]);
      return 0;
    };
    if (next === cur || order(next, cur) < 0) throw new Error(`Phiên bản mới (${next}) phải khác và cao hơn hiện tại (${cur})`);
    const date = opt("--date") ?? new Date().toISOString().slice(0, 10);
    const clPath = path.join(root, "CHANGELOG.md");
    const promoted = promoteChangelog(fs.readFileSync(clPath, "utf8"), next, date, { allowEmpty: flag("--allow-empty") });
    applyBump(root, next);
    fs.writeFileSync(clPath, promoted);
    console.log(`Đã nâng ${cur} → ${next} (mọi gói, package-lock, CHANGELOG.md).\nTiếp theo:\n  npm test && npm run typecheck\n  git add -A && git commit -m "Phát hành ${next}" && git tag v${next}\n  (dựng + ký + tải lên theo docs/RELEASE.md)`);
    return 0;
  }
  console.error("Cách dùng: node scripts/version.mjs show | check | notes [ver] | bump <patch|minor|major|X.Y.Z> [--allow-empty] [--date YYYY-MM-DD]");
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error("Lỗi: " + e.message);
    process.exitCode = 1;
  }
}
