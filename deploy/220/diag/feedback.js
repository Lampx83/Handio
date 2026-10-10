// Trang góp ý của người dùng (quản trị viên). KHÔNG dùng innerHTML: mọi chữ hiển thị đều qua textContent.
(function () {
  "use strict";
  var API = "api/feedback";
  var PAGE = 50;
  var $ = function (id) { return document.getElementById(id); };
  var items = [];
  var total = 0;
  var busy = false;
  var KIND = { bug: "Báo lỗi", idea: "Đề xuất", praise: "Khen", other: "Khác" };
  var STATUS = { "new": "Mới", seen: "Đã xem", planned: "Sẽ làm", done: "Đã xong", wontfix: "Không làm" };

  function el(tag, text, cls) {
    var e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }
  function msg(text, kind) {
    var s = $("status");
    s.textContent = "";
    if (text) s.appendChild(el("div", text, "msg" + (kind ? " " + kind : "")));
  }
  function when(ts) {
    try { return new Date(ts * 1000).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false }); } catch (e) { return String(ts); }
  }
  function call(method, url, body) {
    var opt = { method: method, credentials: "same-origin", headers: { "X-Neu-Admin": "1" }, cache: "no-store" };
    if (body) {
      opt.headers["Content-Type"] = "application/json";
      opt.body = JSON.stringify(body);
    }
    return fetch(url, opt).then(function (r) {
      return r.json().catch(function () { return { ok: false, message: "Phản hồi không hợp lệ (" + r.status + ")." }; }).then(function (j) {
        if (r.status === 403) j = { ok: false, message: "Bạn không có quyền (cần là quản trị viên) hoặc phiên đăng nhập đã hết. Hãy tải lại trang." };
        if (r.status === 401 || r.redirected) j = { ok: false, message: "Phiên đăng nhập đã hết. Hãy tải lại trang." };
        return j;
      });
    }, function () { return { ok: false, message: "Không kết nối được máy chủ." }; });
  }
  function query(offset) {
    var p = ["limit=" + PAGE, "offset=" + offset];
    ["fstatus:status", "fkind:kind", "q:q"].forEach(function (x) {
      var a = x.split(":");
      var v = $(a[0]).value.trim();
      if (v) p.push(a[1] + "=" + encodeURIComponent(v));
    });
    return API + "?" + p.join("&");
  }

  function tiles(d) {
    var t = $("stats");
    t.textContent = "";
    var bs = d.by_status || {};
    var bk = d.by_kind || {};
    [[bs["new"] || 0, "góp ý mới chưa xem"], [bk.bug || 0, "báo lỗi (tất cả)"], [bk.idea || 0, "đề xuất (tất cả)"], [(bs.done || 0), "đã xong"]].forEach(function (x) {
      var c = el("div", null, "tile");
      c.appendChild(el("b", String(x[0])));
      c.appendChild(el("span", x[1]));
      t.appendChild(c);
    });
  }

  function card(it) {
    var c = el("div", null, "fb");
    var meta = el("div", null, "meta");
    meta.appendChild(el("span", KIND[it.kind] || it.kind, "tag " + it.kind));
    meta.appendChild(el("b", it.ident));
    meta.appendChild(el("span", when(it.ts)));
    var tech = [it.version && "v" + it.version, it.platform, it.tab && "tab " + it.tab, it.model].filter(Boolean).join(" · ");
    if (tech) meta.appendChild(el("span", tech));
    meta.appendChild(el("span", "#" + it.id));
    c.appendChild(meta);
    c.appendChild(el("div", it.text, "txt"));

    var row = el("div", null, "row");
    var st = document.createElement("select");
    st.setAttribute("aria-label", "Trạng thái góp ý " + it.id);
    Object.keys(STATUS).forEach(function (k) {
      var o = el("option", STATUS[k]);
      o.value = k;
      if (k === it.status) o.selected = true;
      st.appendChild(o);
    });
    var note = document.createElement("textarea");
    note.placeholder = "Ghi chú của quản trị (không bắt buộc)";
    note.maxLength = 1000;
    note.value = it.note || "";
    note.setAttribute("aria-label", "Ghi chú cho góp ý " + it.id);
    var save = el("button", "Lưu", "sm primary");
    save.type = "button";
    save.addEventListener("click", function () {
      save.disabled = true;
      call("POST", API, { op: "set", id: it.id, status: st.value, note: note.value }).then(function (r) {
        save.disabled = false;
        if (r.ok) { it.status = st.value; it.note = note.value; msg("Đã lưu góp ý #" + it.id + "."); } else msg(r.message || "Không lưu được.", "err");
      });
    });
    var del = el("button", "Xoá", "sm");
    del.type = "button";
    del.addEventListener("click", function () {
      if (!window.confirm("Xoá hẳn góp ý #" + it.id + "? Không khôi phục được.")) return;
      call("POST", API, { op: "delete", id: it.id }).then(function (r) {
        if (r.ok) { items = items.filter(function (x) { return x.id !== it.id; }); total -= 1; render(); msg("Đã xoá góp ý #" + it.id + "."); } else msg(r.message || "Không xoá được.", "err");
      });
    });
    row.appendChild(st);
    row.appendChild(save);
    row.appendChild(del);
    c.appendChild(row);
    c.appendChild(note);
    note.style.marginTop = "8px";
    return c;
  }

  function render() {
    var l = $("list");
    l.textContent = "";
    items.forEach(function (it) { l.appendChild(card(it)); });
    $("count").textContent = "(" + total + ")";
    $("none").hidden = items.length > 0;
    $("more").hidden = items.length >= total;
  }

  function load(append) {
    if (busy) return;
    busy = true;
    call("GET", query(append ? items.length : 0)).then(function (d) {
      busy = false;
      if (!d.ok) { msg(d.message || "Không tải được danh sách.", "err"); return; }
      msg("");
      items = append ? items.concat(d.items) : d.items;
      total = d.total;
      tiles(d);
      render();
    });
  }

  function csvCell(v) {
    var s = String(v == null ? "" : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;   // chống chèn công thức khi mở bằng Excel
    return '"' + s.replace(/"/g, '""') + '"';
  }
  function downloadCsv() {
    var u = query(0).replace("limit=" + PAGE, "limit=200");
    call("GET", u).then(function (d) {
      if (!d.ok) { msg(d.message || "Không xuất được.", "err"); return; }
      var rows = [["id", "thời điểm", "người gửi", "loại", "nội dung", "phiên bản", "nền tảng", "tab", "mô hình", "trạng thái", "ghi chú"]];
      d.items.forEach(function (i) { rows.push([i.id, when(i.ts), i.ident, KIND[i.kind] || i.kind, i.text, i.version, i.platform, i.tab, i.model, STATUS[i.status] || i.status, i.note]); });
      var blob = new Blob(["﻿" + rows.map(function (r) { return r.map(csvCell).join(","); }).join("\r\n")], { type: "text/csv;charset=utf-8" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "gop-y-neu-agent.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    });
  }

  $("reload").addEventListener("click", function () { load(false); });
  $("more").addEventListener("click", function () { load(true); });
  $("csv").addEventListener("click", downloadCsv);
  ["fstatus", "fkind"].forEach(function (id) { $(id).addEventListener("change", function () { load(false); }); });
  var t = null;
  $("q").addEventListener("input", function () { clearTimeout(t); t = setTimeout(function () { load(false); }, 350); });
  load(false);
})();
