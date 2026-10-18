#!/usr/bin/env node
// Kiểu chung của các trang công khai /agent/guide/ nằm ở deploy/220/guide-site.css. CSP của trang chỉ cho style nội tuyến
// (`style-src 'unsafe-inline'`, không 'self'), nên không dùng <link>: tệp được chép vào <style id="site-css"> của từng trang.
//   node scripts/guide-css.mjs           chép vào index.html, help.html, privacy.html (changelog.html: scripts/version.mjs tự chèn)
//   node scripts/guide-css.mjs --check   chỉ kiểm tra, lệch thì thoát mã 1
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CSS_FILE = "deploy/220/guide-site.css";
export const GUIDE_DIR = "deploy/220/guide-public";
export const PAGES = ["index.html", "help.html", "privacy.html"];
const BLOCK = /<style id="site-css">[\s\S]*?<\/style>/;

export function guideCss(root = ROOT) {
  return fs.readFileSync(path.join(root, CSS_FILE), "utf8").trim();
}

/** Thẻ <style> chứa kiểu chung (dùng cho trang sinh tự động). `</` bị chặn để CSS không đóng thẻ sớm. */
export function styleTag(css) {
  if (css.includes("</")) throw new Error(CSS_FILE + " không được chứa '</'");
  return `<style id="site-css">\n${css}\n</style>`;
}

/** Thay khối <style id="site-css"> trong một trang; trang không có khối thì báo lỗi. */
export function applyCss(html, css) {
  if (!BLOCK.test(html)) throw new Error('Trang thiếu <style id="site-css">');
  return html.replace(BLOCK, () => styleTag(css));
}

/** Danh sách trang lệch so với tệp kiểu chung. */
export function stalePages(root = ROOT) {
  const css = guideCss(root);
  return PAGES.filter((p) => {
    const html = fs.readFileSync(path.join(root, GUIDE_DIR, p), "utf8");
    return applyCss(html, css) !== html;
  });
}

function main(argv) {
  const css = guideCss();
  if (argv.includes("--check")) {
    const bad = stalePages();
    if (bad.length) {
      console.error(`Lệch với ${CSS_FILE}: ${bad.join(", ")}. Chạy: node scripts/guide-css.mjs`);
      return 1;
    }
    console.log("✓ Kiểu chung khớp ở mọi trang");
    return 0;
  }
  for (const p of PAGES) {
    const f = path.join(ROOT, GUIDE_DIR, p);
    const html = fs.readFileSync(f, "utf8");
    const out = applyCss(html, css);
    if (out !== html) fs.writeFileSync(f, out);
    console.log((out !== html ? "Đã cập nhật " : "Giữ nguyên ") + path.join(GUIDE_DIR, p));
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error("Lỗi: " + e.message);
    process.exitCode = 1;
  }
}
