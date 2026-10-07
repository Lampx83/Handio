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
    check("giao diện hiện đủ ba tab, Work đứng đầu", await waitFor(`[...document.querySelectorAll('.tab')].map((t) => t.textContent).join() === 'Work,Code,Design' && !!document.querySelector('#panel-code .welcome')`, 15000));
    check("mở app thì tab Work đang chọn", await js<boolean>(`document.querySelector('#tab-work').getAttribute('aria-selected') === 'true'`));
    await js(`document.querySelector('#tab-code').click(); 1`);

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

    // ---- Code: Thay đổi / hoàn tác / chạy thử (thật, trên thư mục thật)
    const code = c.controllers.get("code")!;
    check("Code: thẻ tổng kết cuối lượt báo 'đã chạy kiểm tra' (node thật)", await waitFor(`!!document.querySelector('#panel-code .sumcard .sc-v.ok')`, 8000));
    const ch1 = await code.changesList();
    check("Code: 'Thay đổi' liệt kê src/grades.js đã sửa (+1 −1)", ch1.length === 1 && ch1[0].path === "src/grades.js" && ch1[0].status === "modified" && ch1[0].added === 1 && ch1[0].removed === 1, JSON.stringify(ch1));
    check("Code: nút ± hiện số tệp đã đổi", await waitFor(`document.querySelector('.ct-wrap:not([hidden]) .chbtn:not([hidden]) .ch-n')?.textContent === '1'`, 4000), await js<string>(`document.querySelector('.ct-wrap:not([hidden]) .chbtn')?.outerHTML ?? 'không có nút'`));
    await code.send("!echo xin chao > smoke-tracked.txt");
    const ch2 = await code.changesList();
    check("Code: tệp do lệnh tự chạy tạo ra cũng được ghi nhận (tệp mới)", ch2.some((f) => f.path === "smoke-tracked.txt" && f.status === "new"), ch2.map((f) => f.path + ":" + f.status).join());
    check("Code: gợi ý chạy thử nhận ra bài kiểm tra của dự án mẫu", (await code.runSuggestions()).some((x) => x.command === "node src/grades.test.js"));
    const fixed = await fs.readFile(path.join(c.codeDir, "src/grades.js"), "utf8");
    const atk3 = await js<Record<string, string>>(`(async () => {
      const r = {};
      const call = async (k, m, a) => { try { const v = await window.neu.call('code', m, a); r[k] = JSON.stringify(v).slice(0, 200); } catch (e) { r[k] = 'rejected'; } };
      await call('revEtc', 'changesRevert', ['../../../../etc/passwd']);
      await call('revAbs', 'changesRevert', ['/etc/passwd']);
      await call('diffAbs', 'changeDiff', ['/etc/passwd']);
      await call('rewindBad', 'rewind', ['0', true]);
      await call('revObj', 'changesRevert', [{ path: 'x' }]);
      return r;
    })()`);
    check("tấn công: hoàn tác/diff với đường dẫn ngoài dự án không làm gì; tham số sai bị từ chối", /"reverted":\[\]/.test(atk3.revEtc) && /"reverted":\[\]/.test(atk3.revAbs) && /error/.test(atk3.diffAbs) && atk3.rewindBad === "rejected" && atk3.revObj === "rejected", JSON.stringify(atk3));
    const rv = await js<{ reverted: string[] }>(`window.neu.call('code', 'changesRevert', [])`);
    const gradesBack = await fs.readFile(path.join(c.codeDir, "src/grades.js"), "utf8");
    check("Code: 'Hoàn tác hết' khôi phục lỗi gốc và xoá tệp mới", rv.reverted.length === 2 && gradesBack.includes("scores.length + 1") && !(await fs.stat(path.join(c.codeDir, "smoke-tracked.txt")).catch(() => null)), rv.reverted.join());
    await fs.writeFile(path.join(c.codeDir, "src/grades.js"), fixed); // trả về bản đã sửa cho các bước sau

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

    // ---------------- tab Work: trích dẫn bấm xem được, khung xem tài liệu, quy trình của tôi
    check("Work: tóm tắt có trích dẫn hoàn tất", await turn("work", "Tóm tắt kế hoạch hội thảo"));
    check("Work: trích dẫn thành chip số, có hàng nguồn", await waitFor(`document.querySelectorAll('#panel-work .msg-ai .cite').length >= 3 && document.querySelectorAll('#panel-work .cite-src').length >= 3`, 8000));
    await js(`document.querySelector('#panel-work .msg-ai .cite').click(); 1`);
    check("Work: bấm chip mở khung xem tài liệu, tô sáng đúng đoạn", await waitFor(`(() => { const d = document.querySelector('#panel-work .dv'); return !!d && !d.hidden && d.querySelector('.dv-nm')?.textContent === 'ke-hoach-hoi-thao.docx' && !!d.querySelector('.hit'); })()`, 8000));
    check("Work: khung xem chỉ có chữ thuần (không có thẻ HTML sinh từ nội dung)", await js<boolean>(`!document.querySelector('#panel-work .dv-body script, #panel-work .dv-body img, #panel-work .dv-body iframe, #panel-work .dv-body a')`));
    await shot("03b-work-docview");
    const wk = await js<Record<string, string>>(`(async () => {
      const r = {};
      const call = async (k, m, a) => { try { const v = await window.neu.call('work', m, a); r[k] = JSON.stringify(v).slice(0, 160); } catch (e) { r[k] = 'rejected'; } };
      await call('cell', 'docView', ['diem-hoc-phan.xlsx', 'Điểm!B3']);
      await call('out', 'docView', ['../../../../etc/passwd']);
      await call('abs', 'docView', ['/etc/passwd']);
      await call('badArgs', 'docView', [{ p: 1 }]);
      await call('save', 'procedureSave', ['Tóm tắt kế hoạch', 'smoke']);
      await call('list', 'procedureList', []);
      await call('rmEvil', 'procedureRemove', ['../../AGENTS']);
      await call('rmEvil2', 'procedureRemove', ['a/b']);
      return r;
    })()`);
    check("Work: docView đọc đúng ô; đường dẫn ngoài dự án và tham số sai bị chặn", /"kind":"Excel".*"hit":true/.test(wk.cell) && /error/.test(wk.out) && /error/.test(wk.abs) && wk.badArgs === "rejected", JSON.stringify(wk));
    const procFile = path.join(c.workDir, ".neuagent", "commands", "tom-tat-ke-hoach.md");
    check("Work: lưu quy trình thành lệnh /tên trong dự án; xoá với tên có đường dẫn bị từ chối", /"ok":true/.test(wk.save) && (await fs.readFile(procFile, "utf8")).includes("$ARGUMENTS") && wk.list.includes("tom-tat-ke-hoach") && wk.rmEvil === "rejected" && wk.rmEvil2 === "rejected", JSON.stringify(wk));
    await js(`window.neu.call('work', 'procedureRemove', ['tom-tat-ke-hoach'])`);
    check("Work: xoá quy trình", !(await fs.stat(procFile).catch(() => null)));


    // ---------------- dự án (nhiều thư mục) và lịch sử trò chuyện
    const work = c.controllers.get("work")!;
    const userData = path.join(c.dir, "userData");
    const chats = await work.chatList();
    check("Work: cuộc trò chuyện được lưu sau mỗi lượt", chats.length >= 2, chats.map((x) => x.title).join(" | "));
    const chatFiles = await fs.readdir(path.join(userData, "chats", "default"));
    const mode = (await fs.stat(path.join(userData, "chats", "default", chatFiles[0]))).mode & 0o777;
    check("lịch sử lưu ở thư mục dữ liệu ứng dụng (quyền 600), không ghi vào thư mục dự án", chatFiles.length >= 2 && mode === 0o600 && !(await fs.readdir(c.workDir)).some((f) => f.includes("chat")), mode.toString(8));
    const created = await work.projectCreate({ name: "Hồ sơ smoke", instructions: "Luôn xưng hô trang trọng." });
    const stNew = await work.getState();
    check("Work: tạo dự án mới có thư mục riêng và AGENTS.md", "ok" in created && stNew.workspace.includes(path.join(c.dir, "projects", "work")) && (await fs.readFile(path.join(stNew.workspace, "AGENTS.md"), "utf8")).includes("trang trọng") && stNew.memoryFiles.includes("AGENTS.md"), stNew.workspace);
    check("Work: dự án mới chỉ có AGENTS.md và không lẫn lịch sử của dự án khác", (await work.listDir(".")).map((e) => e.name).join() === "AGENTS.md" && (await work.chatList()).length === 0);
    await js(`document.querySelector('#tab-work').click(); 1`);
    check("giao diện hiện tên dự án", await waitFor(`document.querySelector('#panel-work .projbtn .pj-nm')?.textContent === 'Hồ sơ smoke'`, 8000));
    await shot("04-work-project");
    await work.projectOpen("default");
    check("Work: quay lại dự án mẫu, tệp và lịch sử cũ còn nguyên", (await work.listDir(".")).some((e) => e.name === "diem-hoc-phan.xlsx") && (await work.chatList()).length >= 2);
    const removed = await work.projectRemove(stNew.projectId);
    check("Work: bỏ dự án khỏi danh sách KHÔNG xoá thư mục trên đĩa", "ok" in removed && !!(await fs.stat(path.join(stNew.workspace, "AGENTS.md")).catch(() => null)));
    const reopen = await work.chatOpen(chats[0].id);
    check("Work: mở lại cuộc trò chuyện cũ để làm tiếp", !("error" in reopen) && reopen.history.some((h) => h.kind === "user"));

    // ---------------- tab Design: xem trước cách ly + xuất PDF/PNG thật
    const design = c.controllers.get("design")!;
    const stD = await design.getState();
    check("Design: có công cụ file + Office, không có terminal, có xuất PDF/PNG", !stD.capabilities.exec && stD.capabilities.renderDesign && stD.commands.some((x) => x.name === "poster"));
    await js(`window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI)); document.querySelector('#tab-design').click(); 1`);
    check("Design: khung xem trước hiện poster mẫu trong iframe cách ly", await waitFor(`(() => { const f = document.querySelector('#panel-design .pv-frame'); return !!f && f.getAttribute('sandbox') === '' && f.srcdoc.includes('Trí tuệ nhân tạo'); })()`, 10000));
    await sleep(600);
    await shot("05-design");
    // đợi tới khi poster hiện trên màn hình (chụp sớm quá sẽ thấy nền)
    let top = { r: 0, g: 0, b: 0 };
    for (let i = 0; i < 15; i++) {
      const rect = await js<{ x: number; y: number; w: number; h: number; iw: number }>(`(() => { const r = document.querySelector('#panel-design .pv-frame').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, iw: innerWidth }; })()`);
      const img = await c.win.webContents.capturePage();
      const sz = img.getSize();
      const k = sz.width / rect.iw;
      const bmp = img.toBitmap();
      const j = (Math.round((rect.y + rect.h * 0.05) * k) * sz.width + Math.round((rect.x + rect.w * 0.9) * k)) * 4;
      top = { r: bmp[j + 2], g: bmp[j + 1], b: bmp[j] };
      if (top.b > top.r + 60) break;
      await sleep(400);
    }
    check("Design: poster thật sự được vẽ (vùng đầu màu xanh đậm, không trắng)", top.b > top.r + 60 && top.b < 250, JSON.stringify(top));
    const viol = await js<string[]>("window.__csp");
    check("Design: CSP không chặn bản xem trước (không vi phạm)", viol.length === 0, viol.join(" | "));
    const pdf = await design.exportDesign("poster-hoi-thao.html", "pdf", 794, 1123);
    const pdfBytes = "saved" in pdf ? await fs.readFile(path.join(stD.workspace, pdf.saved)) : Buffer.alloc(0);
    check("Design: xuất PDF thật", pdfBytes.subarray(0, 5).toString() === "%PDF-" && pdfBytes.length > 3000, "saved" in pdf ? `${pdf.saved} ${pdfBytes.length}B` : pdf.error);
    const png = await design.exportDesign("poster-hoi-thao.html", "png", 794, 1123);
    const pngBytes = "saved" in png ? await fs.readFile(path.join(stD.workspace, png.saved)) : Buffer.alloc(0);
    check("Design: xuất PNG đúng khổ 794 × 1123", pngBytes.subarray(1, 4).toString() === "PNG" && pngBytes.readUInt32BE(16) === 794 && pngBytes.readUInt32BE(20) === 1123, "saved" in png ? `${pngBytes.readUInt32BE(16)}x${pngBytes.readUInt32BE(20)}` : png.error);
    const { nativeImage: NI } = await import("electron");
    const pimg = "saved" in png ? NI.createFromPath(path.join(stD.workspace, png.saved)) : null;
    const pb = pimg?.toBitmap();
    const pat = (x: number, y: number) => (pb ? { r: pb[(y * 794 + x) * 4 + 2], g: pb[(y * 794 + x) * 4 + 1], b: pb[(y * 794 + x) * 4] } : { r: 0, g: 0, b: 0 });
    check("Design: ảnh PNG có nội dung thật (đầu poster xanh đậm, chân poster xanh navy)", !!pb && pat(700, 40).b > pat(700, 40).r + 60 && pat(30, 1100).b > 60 && pat(30, 1100).r < 40, JSON.stringify([pat(700, 40), pat(30, 1100)]));
    await fs.writeFile(path.join(stD.workspace, "doc.html"), '<!doctype html><body style="margin:0"><script>document.body.style.background="red"</script><img src="https://example.com/x.png" width="10" height="10"><div style="width:100px;height:50px;background:#00ff00"></div></body>');
    const evil = await design.exportDesign("doc.html", "png", 300, 100);
    const evilImg = "saved" in evil ? NI.createFromPath(path.join(stD.workspace, evil.saved)) : null;
    const eb = evilImg?.toBitmap();
    const ew = evilImg?.getSize().width ?? 1;
    const at = (x: number, y: number) => (eb ? { r: eb[(y * ew + x) * 4 + 2], g: eb[(y * ew + x) * 4 + 1], b: eb[(y * ew + x) * 4] } : { r: 0, g: 0, b: 0 });
    check("Design: khi xuất, script trong thiết kế KHÔNG chạy (nền trắng, khối xanh có)", !!eb && at(250, 80).r > 240 && at(250, 80).g > 240 && at(50, 20).g > 200 && at(50, 20).r < 40, JSON.stringify([at(250, 80), at(50, 20)]));
    check("Design: không xuất được tệp ngoài .html/.svg và ngoài thư mục", "error" in (await design.exportDesign("../../../etc/passwd", "pdf", 794)) && "error" in (await design.exportDesign("AGENTS.md", "pdf", 794)));
    const atk2 = await js<Record<string, string>>(`(async () => {
      const r = {};
      const bad = async (k, m, a) => { try { await window.neu.call('work', m, a); r[k] = 'ALLOWED'; } catch (e) { r[k] = 'rejected'; } };
      await bad('path', 'projectCreate', [{ name: 'x', path: '/etc' }]);
      await bad('open', 'projectOpen', ['../../etc']);
      await bad('chat', 'chatOpen', ['../../../x']);
      await bad('fmt', 'exportDesign', ['a.html', 'exe', 800]);
      return r;
    })()`);
    check("tấn công: IPC dự án/lịch sử/xuất không nhận đường dẫn hay tham số lạ", Object.values(atk2).every((v) => v === "rejected"), JSON.stringify(atk2));

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
