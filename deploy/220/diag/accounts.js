// Trang quản lý tài khoản tên + mật khẩu (quản trị viên). KHÔNG dùng innerHTML: mọi chữ hiển thị đều qua textContent.
(function () {
  "use strict";
  var API = "api/accounts";
  var $ = function (id) { return document.getElementById(id); };
  var NAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
  var busy = false;

  function el(tag, text, cls) {
    var e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }
  function msg(text, kind) {
    if (!kind && /^Đã /.test(text || "")) kind = "ok";   // thông báo thành công ("Đã lưu…", "Đã xoá…") hiện màu xanh
    var s = $("status");
    s.textContent = "";
    if (!text) return;
    var d = el("div", text, "msg" + (kind ? " " + kind : ""));
    s.appendChild(d);
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

  var OPS = { add: "Tạo", passwd: "Đổi mật khẩu", remove: "Xoá", kick: "Huỷ mọi phiên" };
  function when(ts) {
    try { return new Date(ts * 1000).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false }); } catch (e) { return String(ts); }
  }

  function render(d) {
    var tb = $("users");
    tb.textContent = "";
    var users = d.users || [];
    $("count").textContent = "(" + users.length + (d.max ? "/" + d.max : "") + ")";
    $("none").hidden = users.length > 0;
    $("tbl").hidden = users.length === 0;
    users.forEach(function (u) {
      var tr = el("tr");
      tr.appendChild(el("td", u, "mono"));
      var td = el("td", null, "act");
      var chg = el("button", "Đổi mật khẩu", "sm");
      chg.type = "button";
      chg.addEventListener("click", function () { $("name").value = u; $("pw").value = ""; $("pw").focus(); msg("Nhập mật khẩu mới cho “" + u + "” rồi bấm Lưu."); });
      var del = el("button", "Xoá", "sm danger");
      del.type = "button";
      del.style.marginLeft = "6px";
      del.addEventListener("click", function () { remove(u); });
      td.appendChild(chg);
      td.appendChild(del);
      tr.appendChild(td);
      tb.appendChild(tr);
    });
    var ab = $("audit");
    ab.textContent = "";
    var au = d.audit || [];
    $("noaudit").hidden = au.length > 0;
    au.forEach(function (a) {
      var tr = el("tr");
      tr.appendChild(el("td", when(a.ts)));
      tr.appendChild(el("td", a.actor || "?"));
      tr.appendChild(el("td", OPS[a.op] || a.op));
      tr.appendChild(el("td", a.name || "—", "mono"));
      var ok = el("td");
      ok.appendChild(el("span", a.ok ? "Thành công" : "Thất bại", "tag" + (a.ok ? " ok" : " bad")));
      tr.appendChild(ok);
      ab.appendChild(tr);
    });
  }

  // ---------------------------------------------------------------- người đã dùng NEU Agent (web / Desktop)
  var KIND = { gv: "Giảng viên / cán bộ", sv: "Sinh viên", mk: "Tên + mật khẩu", khac: "Khác" };
  var PLAT = { web: ["Web", "web"], mac: ["Mac", "desk"], win: ["Windows", "desk"], linux: ["Linux", "desk"], khac: ["Khác", "desk"] };
  var seenAll = [];
  function tile(title, s) {
    var t = el("div", null, "tile");
    t.appendChild(el("span", title));
    t.appendChild(el("b", String(s.all)));
    t.appendChild(el("div", "Web " + s.web + " · Desktop " + s.desktop + (s.desktop ? " (Mac " + s.mac + ", Windows " + s.win + ")" : ""), "sub"));
    if (s.both) t.appendChild(el("span", s.both + " người dùng cả hai"));
    return t;
  }
  function renderSeen(seen) {
    var card = $("seen-card");
    if (!seen) { card.hidden = true; return; }
    card.hidden = false;
    seenAll = seen.users || [];
    $("seen-count").textContent = "(" + (seen.total || 0) + ")";
    var st = $("stats");
    st.textContent = "";
    var sm = seen.summary || {};
    [["d1", "24 giờ qua"], ["d7", "7 ngày qua"], ["d30", "30 ngày qua"]].forEach(function (p) { if (sm[p[0]]) st.appendChild(tile(p[1], sm[p[0]])); });
    paintSeen();
  }
  function paintSeen() {
    var q = $("filter").value.trim().toLowerCase();
    var rows = seenAll.filter(function (r) { return !q || r.email.toLowerCase().indexOf(q) >= 0 || (KIND[r.kind] || "").toLowerCase().indexOf(q) >= 0; });
    var tb = $("seen");
    tb.textContent = "";
    $("noseen").hidden = rows.length > 0;
    rows.slice(0, 500).forEach(function (r) {
      var tr = el("tr");
      tr.appendChild(el("td", r.email, "mono"));
      tr.appendChild(el("td", KIND[r.kind] || r.kind));
      var td = el("td");
      var box = el("span", null, "plats");
      Object.keys(r.plat || {}).sort().forEach(function (k) {
        var pl = PLAT[k] || PLAT.khac;
        var tag = el("span", pl[0], "tag " + pl[1]);
        tag.title = "Gần nhất " + when(r.plat[k].last) + " · " + r.plat[k].turns + " lượt";
        box.appendChild(tag);
      });
      td.appendChild(box);
      tr.appendChild(td);
      tr.appendChild(el("td", when(r.first)));
      tr.appendChild(el("td", when(r.last)));
      tr.appendChild(el("td", String(r.turns), "num"));
      var act = el("td");
      if (/^[0-9a-f]{8}$/.test(r.uid8 || "")) {
        var link = el("a", "Xem");
        link.href = "u-" + r.uid8 + ".html";
        link.title = "Trang hoạt động của tài khoản này (mã giả danh " + r.uid8 + "); chỉ có khi đã dùng trong 30 ngày";
        act.appendChild(link);
      }
      tr.appendChild(act);
      tb.appendChild(tr);
    });
  }
  function csvCell(v) {
    v = String(v == null ? "" : v);
    if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;  // chống chèn công thức khi mở bằng Excel
    return '"' + v.replace(/"/g, '""') + '"';
  }
  function downloadCsv() {
    var head = ["Tài khoản", "Loại", "Web", "Mac", "Windows", "Lần đầu", "Gần nhất", "Số lượt"];
    var lines = [head.map(csvCell).join(",")];
    seenAll.forEach(function (r) {
      var p = r.plat || {};
      lines.push([r.email, KIND[r.kind] || r.kind, p.web ? when(p.web.last) : "", p.mac ? when(p.mac.last) : "", p.win ? when(p.win.last) : "", when(r.first), when(r.last), r.turns].map(csvCell).join(","));
    });
    var blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "nguoi-dung-neu-agent.csv";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function load(quiet) {
    return call("GET").then(function (d) {
      if (!d.ok) { if (!quiet) msg(d.message || "Không tải được danh sách.", "err"); return; }
      render(d);
      renderSeen(d.seen);
    });
  }

  function lock(on) {
    busy = on;
    ["save", "gen", "kick", "reload"].forEach(function (id) { $(id).disabled = on; });
  }

  // Mật khẩu ngẫu nhiên dễ đọc (không có ký tự dễ nhầm), lấy từ bộ sinh ngẫu nhiên của trình duyệt
  function genPassword() {
    var abc = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    var out = [];
    var limit = 256 - (256 % abc.length);
    while (out.length < 16) {
      var b = new Uint8Array(32);
      crypto.getRandomValues(b);
      for (var i = 0; i < b.length && out.length < 16; i++) if (b[i] < limit) out.push(abc[b[i] % abc.length]);
    }
    return out.slice(0, 4).join("") + "-" + out.slice(4, 8).join("") + "-" + out.slice(8, 12).join("") + "-" + out.slice(12, 16).join("");
  }

  function showCreds(name, pw, created) {
    var box = $("shown");
    box.textContent = "";
    box.hidden = false;
    var m = el("div", null, "msg warn");
    m.appendChild(el("div", (created ? "Đã tạo tài khoản " : "Đã đổi mật khẩu của ") + name + ". Gửi thông tin này cho người dùng; mật khẩu KHÔNG xem lại được sau khi tải lại trang."));
    var row = el("div", null, "pw");
    row.appendChild(el("span", "Tên:", "muted"));
    row.appendChild(el("code", name));
    row.appendChild(el("span", "Mật khẩu:", "muted"));
    row.appendChild(el("code", pw));
    var cp = el("button", "Chép", "sm");
    cp.type = "button";
    cp.addEventListener("click", function () {
      var text = "Tên đăng nhập: " + name + "\nMật khẩu: " + pw + "\nĐăng nhập tại https://ai.neu.edu.vn/agent/";
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { cp.textContent = "Đã chép"; }, function () { cp.textContent = "Hãy bôi đen và chép tay"; });
    });
    row.appendChild(cp);
    m.appendChild(row);
    box.appendChild(m);
  }

  function save(ev) {
    ev.preventDefault();
    if (busy) return;
    var name = $("name").value.trim();
    var pw = $("pw").value;
    if (!NAME_RE.test(name)) return msg("Tên không hợp lệ: 3–32 ký tự gồm chữ thường, số, dấu . _ - (bắt đầu bằng chữ hoặc số).", "err");
    if (pw.length < 6) return msg("Mật khẩu phải từ 6 ký tự.", "err");
    msg("Đang lưu…");
    lock(true);
    call("POST", { op: "add", name: name, password: pw }).then(function (r) {
      lock(false);
      if (!r.ok) return msg(r.message || "Không lưu được.", "err");
      msg("");
      showCreds(name, pw, r.created !== false);
      $("name").value = "";
      $("pw").value = "";
      load(true);
    });
  }

  function remove(name) {
    if (busy) return;
    if (!confirm("Xoá tài khoản “" + name + "”?\n\nỨng dụng Desktop của người này bị chặn ngay; phiên trình duyệt đang mở có thể còn tới 8 giờ (dùng “Huỷ mọi phiên đăng nhập” nếu cần cắt ngay).")) return;
    lock(true);
    call("POST", { op: "remove", name: name }).then(function (r) {
      lock(false);
      msg(r.ok ? "Đã xoá tài khoản " + name + "." : (r.message || "Không xoá được."), r.ok ? "" : "err");
      $("shown").hidden = true;
      load(true);
    });
  }

  function kick() {
    if (busy) return;
    if (!confirm("Huỷ MỌI phiên đăng nhập trên trình duyệt?\n\nTất cả người dùng (kể cả bạn) sẽ phải đăng nhập lại.")) return;
    lock(true);
    call("POST", { op: "kick" }).then(function (r) {
      lock(false);
      msg(r.ok ? "Đã huỷ mọi phiên đăng nhập. Bạn cũng sẽ phải đăng nhập lại khi tải trang." : (r.message || "Không thực hiện được."), r.ok ? "" : "err");
      load(true);
    });
  }

  $("form").addEventListener("submit", save);
  $("gen").addEventListener("click", function () { $("pw").value = genPassword(); $("pw").focus(); $("pw").select(); });
  $("kick").addEventListener("click", kick);
  $("filter").addEventListener("input", paintSeen);
  $("csv").addEventListener("click", downloadCsv);
  $("reload").addEventListener("click", function () { msg(""); load(); });
  load();
})();
