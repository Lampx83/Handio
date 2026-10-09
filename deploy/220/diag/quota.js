// Trang hạn mức token (quản trị viên). KHÔNG dùng innerHTML: mọi chữ hiển thị đều qua textContent.
(function () {
  "use strict";
  var API = "api/quota";
  var $ = function (id) { return document.getElementById(id); };
  var data = null;
  var busy = false;
  var STEPS = [1000000, 5000000, 10000000];

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
  function num(n) { return n == null ? "—" : String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, "."); }
  function mil(n) { return (n / 1000000) + " triệu"; }
  function when(ts) {
    try { return new Date(ts * 1000).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false }); } catch (e) { return String(ts); }
  }
  function call(method, body) {
    var opt = { method: method, credentials: "same-origin", headers: { "X-Neu-Admin": "1" }, cache: "no-store" };
    if (body) {
      opt.headers["Content-Type"] = "application/json";
      opt.body = JSON.stringify(body);
    }
    return fetch(API, opt).then(function (r) {
      return r.json().catch(function () { return { ok: false, message: "Phản hồi không hợp lệ (" + r.status + ")." }; }).then(function (j) {
        if (r.status === 403) j = { ok: false, message: "Bạn không có quyền (cần là quản trị viên) hoặc phiên đăng nhập đã hết. Hãy tải lại trang." };
        if (r.status === 401 || r.redirected) j = { ok: false, message: "Phiên đăng nhập đã hết. Hãy tải lại trang." };
        return j;
      });
    }, function () { return { ok: false, message: "Không kết nối được máy chủ." }; });
  }

  var STATE = { over: ["Hết hạn mức", "over"], near: ["Gần hết", "near"], ok: ["Còn", "ok"], unlimited: ["Không giới hạn", "ok"] };

  function label(u) { return u.name || ("(chưa rõ) " + u.uid.slice(0, 8)); }

  function tiles(d) {
    var t = $("stats");
    t.textContent = "";
    [[d.over, "đã hết hạn mức hôm nay"], [d.near, "gần hết (từ 80%)"], [d.total, "người có dùng hôm nay"]].forEach(function (x) {
      var d1 = el("div", null, "tile");
      d1.appendChild(el("b", String(x[0])));
      d1.appendChild(el("span", x[1]));
      t.appendChild(d1);
    });
  }

  function grantBtn(u, amount, text) {
    var b = el("button", text, "sm");
    b.type = "button";
    b.title = amount ? "Cấp thêm " + num(amount) + " token cho " + label(u) + " trong hôm nay" : "Bỏ phần đã cấp thêm hôm nay";
    b.style.marginRight = "4px";
    b.addEventListener("click", function () { grant(u, amount); });
    return b;
  }

  function render() {
    var d = data;
    if (!d) return;
    tiles(d);
    var q = $("filter").value.trim().toLowerCase();
    var only = $("show").value === "alert";
    var list = d.users.filter(function (u) {
      if (only && u.state !== "over" && u.state !== "near") return false;
      return !q || label(u).toLowerCase().indexOf(q) >= 0;
    });
    $("count").textContent = "(" + list.length + ")";
    $("none").hidden = list.length > 0;
    var tb = $("users");
    tb.textContent = "";
    list.forEach(function (u) {
      var tr = el("tr");
      tr.appendChild(el("td", label(u), "mono"));
      tr.appendChild(el("td", u.tier === "student" ? "Sinh viên" : u.tier === "staff" ? "Giảng viên/cán bộ" : u.tier));
      var use = el("td", null, "num");
      use.appendChild(el("div", num(u.tokens) + " / " + (u.limit == null ? "không giới hạn" : num(u.limit))));
      if (u.pct != null) {
        var bar = el("div", null, "bar");
        var i = el("i", null, u.pct >= 100 ? "over" : "");
        i.style.width = Math.min(u.pct, 100) + "%";
        bar.appendChild(i);
        use.appendChild(bar);
      }
      tr.appendChild(use);
      var st = STATE[u.state] || [u.state, ""];
      var t3 = el("td");
      t3.appendChild(el("span", st[0] + (u.pct != null ? " " + u.pct + "%" : ""), "tag " + st[1]));
      tr.appendChild(t3);
      tr.appendChild(el("td", u.blocked ? String(u.blocked) : "0", "num"));
      var act = el("td", null, "act");
      if (u.limit != null) {
        STEPS.forEach(function (n) { act.appendChild(grantBtn(u, n, "+" + mil(n))); });
        if (u.extra) {
          act.appendChild(el("span", "đã thêm " + num(u.extra), "muted"));
          act.appendChild(document.createTextNode(" "));
          act.appendChild(grantBtn(u, 0, "Bỏ"));
        }
      } else act.appendChild(el("span", "—", "muted"));
      tr.appendChild(act);
      tb.appendChild(tr);
    });
    var ab = $("audit");
    ab.textContent = "";
    var aud = d.audit || [];
    $("noaudit").hidden = aud.length > 0;
    aud.slice(0, 30).forEach(function (a) {
      var tr = el("tr");
      tr.appendChild(el("td", when(a.ts)));
      tr.appendChild(el("td", a.actor));
      tr.appendChild(el("td", a.who || ("(chưa rõ) " + String(a.uid).slice(0, 8)), "mono"));
      tr.appendChild(el("td", a.add ? "+" + num(a.add) : "bỏ", "num"));
      tr.appendChild(el("td", num(a.total), "num"));
      ab.appendChild(tr);
    });
  }

  function load() {
    return call("GET").then(function (j) {
      if (!j.ok) { msg(j.message || "Không tải được dữ liệu.", "err"); return; }
      msg("");
      data = j;
      render();
    });
  }

  function grant(u, amount) {
    if (busy) return;
    var what = amount ? "Cấp thêm " + num(amount) + " token hôm nay cho " + label(u) + "?" : "Bỏ phần đã cấp thêm hôm nay của " + label(u) + "?";
    if (!window.confirm(what)) return;
    busy = true;
    call("POST", { op: "grant", uid: u.uid, amount: amount }).then(function (j) {
      busy = false;
      if (!j.ok) { msg(j.message || "Không thực hiện được.", "err"); return; }
      var ok = amount ? "Đã cấp thêm " + num(amount) + " token cho " + label(u) + " (tổng cấp thêm hôm nay: " + num(j.extra) + "). Có hiệu lực ngay." : "Đã bỏ phần cấp thêm của " + label(u) + ".";
      return load().then(function () { msg(ok); });
    });
  }

  $("reload").addEventListener("click", function () { load(); });
  $("show").addEventListener("change", render);
  $("filter").addEventListener("input", render);
  load();
})();
