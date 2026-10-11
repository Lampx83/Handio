// Trang cuộc trò chuyện được chia sẻ (quản trị viên). KHÔNG dùng innerHTML: mọi chữ hiển thị đều qua textContent.
(function () {
  "use strict";
  var API = "api/shares";
  var PAGE = 30;
  var $ = function (id) { return document.getElementById(id); };
  var items = [];
  var total = 0;
  var busy = false;

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
    var q = $("q").value.trim();
    if (q) p.push("q=" + encodeURIComponent(q));
    return API + "?" + p.join("&");
  }

  function tiles(d) {
    var t = $("stats");
    t.textContent = "";
    var views = items.reduce(function (a, x) { return a + (x.views || 0); }, 0);
    var owners = {};
    items.forEach(function (x) { owners[x.owner] = 1; });
    [[d.total, "cuộc trò chuyện được chia sẻ"], [Object.keys(owners).length, "người chia sẻ (trong danh sách đang xem)"], [views, "lượt xem (trong danh sách đang xem)"]].forEach(function (x) {
      var c = el("div", null, "tile");
      c.appendChild(el("b", String(x[0])));
      c.appendChild(el("span", x[1]));
      t.appendChild(c);
    });
  }

  function showConv(box, id) {
    if (box.firstChild) { box.textContent = ""; return; }
    box.appendChild(el("div", "Đang tải…", "muted"));
    call("GET", API + "?id=" + encodeURIComponent(id)).then(function (r) {
      box.textContent = "";
      if (!r.ok) { box.appendChild(el("div", r.message || "Không tải được.", "msg err")); return; }
      r.item.items.forEach(function (it) {
        var m = el("div", null, "m " + (it.k === "user" ? "u" : it.k === "tool" ? "c" : "a"));
        m.appendChild(el("div", it.k === "user" ? "Người dùng" : it.k === "assistant" ? "Hando" : "Công cụ " + (it.n || ""), "r"));
        m.appendChild(el("div", it.t)).style.whiteSpace = "pre-wrap";
        box.appendChild(m);
      });
    });
  }

  function card(it) {
    var c = el("div", null, "fb");
    var meta = el("div", null, "meta");
    meta.appendChild(el("b", it.title));
    meta.appendChild(el("span", it.owner));
    meta.appendChild(el("span", when(it.ts)));
    var tech = [it.profile && "tab " + it.profile, it.version && "v" + it.version, it.platform].filter(Boolean).join(" · ");
    if (tech) meta.appendChild(el("span", tech));
    meta.appendChild(el("span", it.nitems + " mục · " + Math.round(it.bytes / 1024) + " KB · " + it.views + " lượt xem · đã che " + it.redactions));
    c.appendChild(meta);
    var row = el("div", null, "row");
    row.style.marginTop = "8px";
    var conv = el("div", null, "conv");
    var view = el("button", "Xem / ẩn nội dung", "sm");
    view.type = "button";
    view.addEventListener("click", function () { showConv(conv, it.id); });
    var link = el("button", "Sao chép liên kết", "sm");
    link.type = "button";
    link.addEventListener("click", function () {
      var u = location.origin + location.pathname.replace(/admin\/shares\/?$/, "") + "share/" + it.id;
      (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(function () { msg("Đã sao chép liên kết."); }, function () { msg(u); });
    });
    var del = el("button", "Xoá", "sm");
    del.type = "button";
    del.addEventListener("click", function () {
      if (!window.confirm("Xoá hẳn cuộc trò chuyện chia sẻ này? Liên kết sẽ không còn dùng được.")) return;
      call("POST", API, { op: "delete", id: it.id }).then(function (r) {
        if (r.ok) { items = items.filter(function (x) { return x.id !== it.id; }); total -= 1; render(); msg("Đã xoá."); } else msg(r.message || "Không xoá được.", "err");
      });
    });
    row.appendChild(view);
    row.appendChild(link);
    row.appendChild(del);
    c.appendChild(row);
    c.appendChild(conv);
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

  $("reload").addEventListener("click", function () { load(false); });
  $("more").addEventListener("click", function () { load(true); });
  $("jsonl").addEventListener("click", function () { window.location.href = API + "?format=jsonl"; });
  var t = null;
  $("q").addEventListener("input", function () { clearTimeout(t); t = setTimeout(function () { load(false); }, 350); });
  load(false);
})();
