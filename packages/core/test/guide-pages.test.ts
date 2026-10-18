import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

// Trang công khai /agent/guide/ (deploy/220/guide-public): tĩnh, CSP `default-src 'none'; img-src 'self'; style-src 'unsafe-inline'`.
// Kiểu chung ở deploy/220/guide-site.css được chép vào từng trang (scripts/guide-css.mjs); changelog.html sinh từ scripts/version.mjs.
const root = path.resolve(__dirname, "../../..");
const dir = path.join(root, "deploy/220/guide-public");
let G: any;
let V: any;
const pages: Record<string, string> = {};
beforeAll(async () => {
  G = await import(pathToFileURL(path.join(root, "scripts/guide-css.mjs")).href);
  V = await import(pathToFileURL(path.join(root, "scripts/version.mjs")).href);
  for (const p of ["index.html", "help.html", "privacy.html"]) pages[p] = fs.readFileSync(path.join(dir, p), "utf8");
  pages["changelog.html"] = V.changelogHtml(V.changelogData(fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8")));
});

describe("trang công khai /agent/guide/", () => {
  it("kiểu chung khớp deploy/220/guide-site.css ở mọi trang (chạy node scripts/guide-css.mjs nếu lệch)", () => {
    expect(G.stalePages(root)).toEqual([]);
    const css = G.guideCss(root);
    for (const [p, html] of Object.entries(pages)) expect(html.includes(G.styleTag(css)), p).toBe(true);
  });

  it("hợp CSP: không script, không tài nguyên ngoài, không trình xử lý sự kiện nội tuyến", () => {
    for (const [p, html] of Object.entries(pages)) {
      expect(html, p).not.toMatch(/<script|javascript:|<[a-z][^>]*\son[a-z]+\s*=|<link[^>]+stylesheet|<iframe|<object|<embed|<form/i);
      expect(html, p).not.toMatch(/\ssrc="(https?:)?\/\//i);
    }
    // CSS: không nạp gì từ ngoài (CSP chặn, và trang phải đọc được ngay)
    expect(G.guideCss(root)).not.toMatch(/@import|url\(|@font-face/i);
  });

  it("thương hiệu NEU: không dùng ảnh bàn tay Handio", () => {
    for (const [p, html] of Object.entries(pages)) expect(html, p).not.toMatch(/handio-hand|handio-wave|handio-banner|handio-mark-hand/);
  });

  it("truy cập: một h1, mọi ảnh có alt, có mô tả và Open Graph, liên kết # trỏ đúng id", () => {
    for (const [p, html] of Object.entries(pages)) {
      expect(html.match(/<h1[\s>]/g)?.length, p).toBe(1);
      for (const img of html.match(/<img\b[^>]*>/g) ?? []) expect(img, p).toMatch(/\salt="/);
      expect(html, p).toMatch(/<meta name="description" content="[^"]{20,}"/);
      expect(html, p).toMatch(/<meta property="og:title" content="[^"]+"/);
      expect(html, p).toMatch(/<html lang="vi">/);
      const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
      for (const m of html.matchAll(/href="#([^"]+)"/g)) expect(ids.has(m[1]), `${p}: #${m[1]}`).toBe(true);
    }
  });

  it("ảnh được tham chiếu đều có trong img/", () => {
    for (const [p, html] of Object.entries(pages))
      for (const m of html.matchAll(/(?:src|href)="(?:\/agent\/guide\/)?(img\/[^"]+)"/g)) expect(fs.existsSync(path.join(dir, m[1])), `${p}: ${m[1]}`).toBe(true);
  });

  it("trang giới thiệu giữ đủ nút tải, mã băm, đăng nhập và cách mở khi bị cảnh báo", () => {
    const html = pages["index.html"];
    for (const f of ["NEU-Agent-mac-arm64.dmg", "NEU-Agent-mac-x64.dmg", "NEU-Agent-win-x64.exe", "SHA256SUMS.txt"]) expect(html).toContain(`href="/agent/download/latest/${f}"`);
    expect(html).toContain('href="/agent/oauth2/sign_in?rd=/agent/"');
    expect(html).toMatch(/id="tai-ve"/);
    expect(html).toContain("<b>Vẫn mở</b>");
    expect(html).toContain("<b>Thông tin thêm</b> → <b>Vẫn chạy</b>");
    // phục vụ ở cả /agent/ lẫn /agent/guide/: đường dẫn nội bộ phải tuyệt đối
    expect(html).not.toMatch(/(?:src|href)="(?!\/|#|https:)/);
    for (const p of ["help.html", "changelog.html", "privacy.html"]) expect(html).toContain(`href="/agent/guide/${p}"`);
  });

  it("trang tài liệu dùng chung khung: thanh trên, mục lục, chân trang, đánh dấu trang hiện tại", () => {
    for (const p of ["help.html", "privacy.html", "changelog.html"]) {
      const html = pages[p];
      expect(html, p).toContain('class="site-head"');
      expect(html, p).toContain('class="site-foot"');
      expect(html, p).toMatch(/<nav class="toc[^"]*" aria-label=/);
      expect(html, p).toContain(`<a href="${p}" aria-current="page">`);
    }
  });
});
