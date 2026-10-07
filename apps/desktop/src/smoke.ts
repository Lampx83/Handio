// Kiểm thử đầu-cuối của bản Desktop: điều khiển chính cửa sổ Electron như một người dùng, rồi kiểm tra trên ổ đĩa.
import type { BrowserWindow } from "electron";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { office, type LocalController, type Profile } from "@neu/agent-core";

interface Ctx {
  win: BrowserWindow;
  dir: string;
  mockUrl: string;
  controllers: Map<Profile, LocalController>;
  codeDir: string;
  workDir: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runSmoke(c: Ctx): Promise<number> {
  const checks: { name: string; ok: boolean; detail?: string }[] = [];
  const check = (name: string, ok: boolean, detail = "") => {
    checks.push({ name, ok, detail });
    console.log(`${ok ? "✔" : "✘"} ${name}${detail ? " — " + detail : ""}`);
  };
  const js = <T>(code: string): Promise<T> => c.win.webContents.executeJavaScript(code);
  const waitFor = async (code: string, ms = 60000): Promise<boolean> => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await js<boolean>(code)) return true;
      await sleep(150);
    }
    return false;
  };
  const shot = async (name: string) => {
    const img = await c.win.webContents.capturePage();
    await fs.writeFile(path.join(c.dir, name + ".png"), img.toPNG());
  };
  c.win.showInactive();
  c.win.setSize(1280, 860);

  try {
    await c.controllers.get("code")!.saveSettings({ baseUrl: c.mockUrl, model: "mock-agent" });
    check("giao diện hiện đủ hai tab", await waitFor(`document.querySelectorAll('.tab').length === 2 && !!document.querySelector('#panel-code .welcome')`, 15000));

    // tự bấm "Cho phép" như người dùng
    await js(`window.__approver = setInterval(() => document.querySelector('.panel:not([hidden]) .ask button.primary')?.click(), 120); 1`);
    const turn = async (panel: string, text: string) => {
      await js(`(() => { const t = document.querySelector('#panel-${panel} textarea'); t.value = ${JSON.stringify(text)}; t.dispatchEvent(new Event('input', {bubbles: true})); t.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true})); })()`);
      await sleep(400);
      return waitFor(`!document.querySelector('#panel-${panel} .working') && !document.querySelector('#panel-${panel} .ask')`, 90000);
    };

    // ---------------- tab Code: sửa lỗi thật, chạy `node` thật
    const stCode = await c.controllers.get("code")!.getState();
    check("Code: có công cụ chạy lệnh", stCode.capabilities.exec && stCode.capabilities.realFs);
    check("Code: dùng đúng thư mục thật", stCode.workspace === (await fs.realpath(c.codeDir)));
    check("Code: lượt chat 'sửa lỗi' hoàn tất", await turn("code", "Sửa lỗi trong hàm tính điểm trung bình"));
    const grades = await fs.readFile(path.join(c.codeDir, "src/grades.js"), "utf8");
    check("Code: file trên đĩa đã được sửa", /total \/ \(?scores\.length\)?;/.test(grades) && !grades.includes("+ 1"), grades.split("\n")[3]);
    let testOk = false;
    try {
      execFileSync("node", ["src/grades.test.js"], { cwd: c.codeDir, stdio: "pipe" });
      testOk = true;
    } catch {
      /* thất bại */
    }
    check("Code: bài kiểm tra chạy qua bằng node thật", testOk);
    check("Code: giao diện hiện thẻ lệnh + todo", await js<boolean>(`document.querySelectorAll('#panel-code .tool').length >= 5 && document.querySelectorAll('#panel-code .todo').length === 4`));
    await shot("01-code");

    // ---------------- tab Work: Excel thật
    await js(`document.querySelector('#tab-work').click(); 1`);
    const stWork = await c.controllers.get("work")!.getState();
    check("Work: KHÔNG có công cụ chạy lệnh", !stWork.capabilities.exec);
    check("Work: có xuất PDF nếu máy có LibreOffice", typeof stWork.capabilities.pdf === "boolean", String(stWork.capabilities.pdf));
    check("Work: thư mục mẫu đã nạp", (await fs.readdir(c.workDir)).includes("diem-hoc-phan.xlsx"));
    check("Work: tính điểm hoàn tất", await turn("work", "Tính điểm tổng kết từ file điểm và xếp loại"));
    const xl = path.join(c.workDir, "diem-tong-ket.xlsx");
    const sheets = await office.readXlsx(new Uint8Array(await fs.readFile(xl)));
    const stat = Object.fromEntries((sheets.find((s) => s.name === "Thống kê")?.text ?? "").split("\n").map((l) => /^\s*\d+ \| (.*?) \| ([\d.]+)/.exec(l)).filter(Boolean).map((m) => [m![1], +m![2]]));
    check("Work: file Excel mới đúng cấu trúc", sheets.map((s) => s.name).join() === "Tổng kết,Thống kê", sheets.map((s) => s.name).join());
    check("Work: thống kê khớp sĩ số 24", stat["Sĩ số"] === 24 && stat["Số SV Giỏi"] + stat["Số SV Khá"] + stat["Số SV Trung bình"] + stat["Số SV Yếu"] === 24, JSON.stringify(stat));
    const orig = await office.readXlsx(new Uint8Array(await fs.readFile(path.join(c.workDir, "diem-hoc-phan.xlsx"))));
    check("Work: file gốc không bị sửa", orig[0].text.includes("11230001") && !/\[=/.test(orig[0].text));
    await shot("02-work-xlsx");

    // ---------------- tab Work: Word thật
    check("Work: soạn biên bản hoàn tất", await turn("work", "Soạn biên bản từ ghi chú họp"));
    const bb = path.join(c.workDir, "bien-ban-hop-giao-ban-30-9-2026.docx");
    const bbText = await office.docxToMarkdown(new Uint8Array(await fs.readFile(bb)));
    check("Work: biên bản Word có quốc hiệu, bảng việc, chữ ký", /CỘNG HÒA XÃ HỘI/.test(bbText) && bbText.includes("| TT | Công việc") && /Nơi nhận/.test(bbText));
    await shot("03-work-docx");

    // ---------------- an toàn
    const escape = await c.controllers.get("work")!.downloadFile("../../etc/passwd");
    check("Work: không đọc được file ngoài thư mục", "error" in escape);
    const errs = await js<string[]>(`[...document.querySelectorAll('.notice.error')].map(e => e.textContent)`);
    check("không có thông báo lỗi trên giao diện", errs.length === 0, errs.join(" | "));
    const csp = await js<string>(`document.querySelector('meta[http-equiv="Content-Security-Policy"]').content`);
    check("giao diện có CSP chặt, không cho ra mạng", /connect-src 'none'/.test(csp) && /default-src 'none'/.test(csp));
    check("giao diện không có Node (sandbox)", await js<boolean>(`typeof require === 'undefined' && typeof process === 'undefined' && typeof window.neu.call === 'function'`));
    // ---------------- tấn công giả lập từ giao diện (coi như giao diện bị chiếm quyền)
    const atk = await js<Record<string, string>>(`(async () => {
      const r = {};
      r.href = location.href;
      try { await fetch('https://example.com/'); r.fetch = 'ALLOWED'; } catch (e) { r.fetch = 'blocked'; }
      try { await new Promise((ok, no) => { const x = new XMLHttpRequest(); x.open('GET', 'https://example.com/'); x.onload = ok; x.onerror = () => no(new Error('x')); x.send(); }); r.xhr = 'ALLOWED'; } catch (e) { r.xhr = 'blocked'; }
      try { await window.neu.call('code', 'exec', ['id']); r.badMethod = 'ALLOWED'; } catch (e) { r.badMethod = 'rejected'; }
      try { const v = await window.neu.call('code', 'readFile', ['../../../../etc/passwd']); r.read = JSON.stringify(v).includes('root:') ? 'LEAKED' : 'denied'; } catch (e) { r.read = 'denied'; }
      try { await window.neu.call('code', 'saveSettings', [{ permissions: { allow: ['bash'] } }]); r.settings = 'ALLOWED'; } catch (e) { r.settings = 'rejected'; }
      try { await window.neu.call('code', 'send', [123]); r.badArg = 'ALLOWED'; } catch (e) { r.badArg = 'rejected'; }
      location.href = 'https://example.com/';
      await new Promise((t) => setTimeout(t, 500));
      r.afterNav = location.href;
      return r;
    })()`);
    check("tấn công: giao diện bị huỷ mọi yêu cầu mạng (fetch/XHR)", atk.fetch === "blocked" && atk.xhr === "blocked", JSON.stringify([atk.fetch, atk.xhr]));
    check("tấn công: lệnh IPC không có trong danh sách bị từ chối", atk.badMethod === "rejected" && atk.badArg === "rejected");
    check("tấn công: không đọc được /etc/passwd qua IPC", atk.read === "denied", atk.read);
    check("tấn công: không thể đặt quy tắc cho phép qua cài đặt", atk.settings === "rejected");
    check("tấn công: không điều hướng được ra ngoài app://", atk.href.startsWith("app://main/") && atk.afterNav.startsWith("app://main/"), atk.afterNav);
    await js(`clearInterval(window.__approver); 1`);
  } catch (e) {
    check("kịch bản chạy không bị lỗi", false, (e as Error).stack ?? String(e));
  }
  await fs.writeFile(path.join(c.dir, "report.json"), JSON.stringify(checks, null, 2));
  const bad = checks.filter((x) => !x.ok).length;
  console.log(bad ? `\n${bad}/${checks.length} kiểm tra THẤT BẠI` : `\nTất cả ${checks.length} kiểm tra đạt`);
  return bad ? 1 : 0;
}
