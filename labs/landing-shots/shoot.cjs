// Chụp ảnh demo cho trang giới thiệu công khai từ BẢN WEB thật (mô hình giả lập, giao diện tối, 1280x800 @2x = 2560x1600).
// Chạy bởi run.mjs:  electron shoot.cjs <địa-chỉ-gốc> <thư-mục-ra>
const { app, BrowserWindow, nativeTheme } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const base = process.argv[process.argv.length - 3];
const out = process.argv[process.argv.length - 2];
const seed = JSON.parse(fs.readFileSync(process.argv[process.argv.length - 1], "utf8")); // { work: [{path, data(base64)}], code: [...], design: [...] }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
nativeTheme.themeSource = "dark";

app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 1280, height: 800, useContentSize: true, webPreferences: { backgroundThrottling: false } });
  const wc = w.webContents;
  const js = (code) => wc.executeJavaScript(code, true);
  const wait = async (cond, ms = 60000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await js(cond)) return true;
      await sleep(150);
    }
    throw new Error("hết giờ chờ: " + cond.slice(0, 90));
  };
  const shot = async (name) => {
    await sleep(500);
    fs.writeFileSync(path.join(out, name + ".png"), (await wc.capturePage()).toPNG());
    console.log("ĐÃ CHỤP", name);
  };
  const clickText = (sel, text) => js(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.textContent.trim().includes(${JSON.stringify(text)})); if (!e) return false; e.click(); return true; })()`);
  const turn = async (panel, text) => {
    await js(`(() => { const t = document.querySelector('#panel-${panel} textarea'); t.value = ${JSON.stringify(text)}; t.dispatchEvent(new Event('input', { bubbles: true })); t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); })()`);
    await sleep(500);
    await wait(`!document.querySelector('#panel-${panel} .working') && !document.querySelector('#panel-${panel} .ask')`, 90000);
  };

  // cùng nguồn với ứng dụng nhưng chưa chạy ứng dụng: nạp sẵn dữ liệu mẫu vào IndexedDB (bản web không còn tự nạp mẫu) rồi mới mở ứng dụng
  await w.loadURL(base + "/mock/v1/models");
  await js(`(async () => {
    const seed = ${JSON.stringify(seed)};
    localStorage.setItem("neu.nosample.v1", "1");
    localStorage.setItem("neu.settings", JSON.stringify({ baseUrl: location.origin + "/mock/v1", model: "mock-agent", mode: "auto", allowInsecureHttp: true }));
    await new Promise((res, rej) => {
      const r = indexedDB.open("neu-agent", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("workspaces");
      r.onerror = () => rej(r.error);
      r.onsuccess = () => {
        const tx = r.result.transaction("workspaces", "readwrite");
        const st = tx.objectStore("workspaces");
        for (const [k, list] of Object.entries(seed)) st.put(list.map((e) => ({ path: e.path, data: Uint8Array.from(atob(e.data), (c) => c.charCodeAt(0)) })), k);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      };
    });
    return 1;
  })()`);
  await w.loadURL(base + "/");
  await wait(`document.querySelectorAll('.tab').length === 3`);
  await sleep(1200);

  // 1) Work: tạo giấy mời từ danh sách khách mời
  await js(`document.querySelector('#tab-work').click(); 1`);
  await sleep(600);
  await turn("work", "Tạo giấy mời hội thảo mỗi khách mời một trang từ file danh sách khách mời");
  await shot("work");

  // 2) Học vibe coding: bài học, dự án mẫu (tab Code)
  await js(`document.querySelector('#tab-code').click(); 1`);
  await sleep(600);
  await turn("code", "Sửa lỗi trong hàm tính điểm trung bình");
  await shot("code");
  const learn = await clickText("button", "Học");
  if (learn) {
    await wait(`!!document.querySelector('dialog[open]')`, 8000);
    await sleep(700);
    // tab "Bài tập" (tab "Bài học" mở sẵn nhắc tên các công cụ khác, không đưa lên trang công khai)
    await clickText("dialog[open] button, dialog[open] [role=tab]", "Bài tập");
    await sleep(700);
    await clickText("dialog[open] button, dialog[open] li, dialog[open] [role=button]", "Tổng và trung bình");
    await sleep(900);
    await shot("hoc");
    await clickText("dialog[open] button, dialog[open] [role=tab]", "Dự án mẫu");
    await sleep(700);
    await shot("tao-du-an");
    await js(`document.querySelector('dialog[open]')?.close(); 1`);
  } else console.log("KHÔNG THẤY nút Học");

  // 3) Design: bản xem trước + chỉ vào để sửa
  await js(`document.querySelector('#tab-design').click(); 1`);
  await sleep(1500);
  await wait(`!!document.querySelector('#panel-design .pv-frame')`, 20000).catch(() => console.log("chưa có bản xem trước Design"));
  await sleep(800);
  await shot("design");
  if (await clickText("#panel-design .pv button", "Chỉ vào để sửa")) {
    await sleep(500);
    await js(`(() => { const f = document.querySelector('#panel-design .pv-frame'); const d = f && f.contentDocument; const el = d && (d.querySelector('h1') || d.querySelector('h2')); if (el) el.click(); return !!el; })()`);
    await sleep(700);
    await shot("chi-vao-de-sua");
  }

  // 4) Hướng dẫn 💡 (tab Work)
  await js(`document.querySelector('#tab-work').click(); 1`);
  await sleep(600);
  const bulb = await js(`(() => { const b = [...document.querySelectorAll('#panel-work button, .topbar button, header button')].find((x) => x.textContent.trim() === '💡'); if (!b) return false; b.click(); return true; })()`);
  if (bulb) {
    await wait(`!!document.querySelector('dialog[open]')`, 8000).catch(() => undefined);
    await sleep(700);
    await shot("huong-dan");
  } else console.log("KHÔNG THẤY nút 💡");
  app.exit(0);
}).catch((e) => {
  console.error("LỖI", e.message);
  app.exit(1);
});
