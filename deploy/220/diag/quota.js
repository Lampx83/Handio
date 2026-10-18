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
  function gmsg(text, kind) { msg(text, kind, "gstatus"); }   // thông báo của mục Nhóm hiện ngay tại mục đó (trang dài)
  function msg(text, kind, where) {
    var s = $(where || "status");
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
      tr.appendChild(el("td", tierName(u.tier) + (u.group ? " · nhóm " + u.group : "")));
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
    renderPolicy(d.policy);
    renderGroups(d);
  }

  // ---------------------------------------------------------------- cấu hình theo bậc (chỉ xem) và nhóm tuỳ tạo
  var TAB_LABEL = { work: "Work", code: "Code", design: "Design" };
  var TABS = ["work", "code", "design"];
  function tierName(t) { return t === "student" ? "Sinh viên" : t === "staff" ? "Giảng viên/cán bộ" : t === "admin" ? "Quản trị" : String(t || ""); }
  function tabsText(v) { return v == null ? "cả ba" : v.length ? v.map(function (t) { return TAB_LABEL[t] || t; }).join(", ") : "không tab nào"; }
  function modelsText(v) { return v == null || v === "*" || (v.length === 1 && v[0] === "*") ? "mọi mô hình" : v.length ? v.join(", ") : "không mô hình nào"; }
  function tabLimitsText(v) {
    var k = v ? Object.keys(v) : [];
    return k.length ? k.map(function (t) { return (TAB_LABEL[t] || t) + " " + num(v[t]); }).join(", ") : "—";
  }

  function renderPolicy(p) {
    var tb = $("tiers");
    tb.textContent = "";
    $("nopolicy").hidden = !!p;
    if (!p) return;
    var names = {};
    [p.tiers, p.tabs, p.models, p.tab_limits].forEach(function (o) { Object.keys(o || {}).forEach(function (k) { names[k] = 1; }); });
    Object.keys(names).sort().forEach(function (t) {
      var tr = el("tr");
      tr.appendChild(el("td", tierName(t) + (t === p.default_tier ? " (mặc định)" : "")));
      tr.appendChild(el("td", p.tiers && p.tiers[t] != null ? num(p.tiers[t]) : "không giới hạn", "num"));
      tr.appendChild(el("td", tabsText(p.tabs ? p.tabs[t] : null)));
      tr.appendChild(el("td", modelsText(p.models ? p.models[t] : null)));
      tr.appendChild(el("td", tabLimitsText(p.tab_limits ? p.tab_limits[t] : null)));
      tb.appendChild(tr);
    });
    var dom = Object.keys(p.domains || {}).map(function (d) { return "@" + d + " → " + tierName(p.domains[d]); }).join(" · ");
    $("policy-note").textContent = "Chế độ: " + (p.mode === "observe" ? "chỉ đếm, không chặn" : "chặn khi hết") + ". Miền email: " + (dom || "—") +
      ". Đặt riêng: " + (p.overrides || 0) + " người. Đổi bằng quota.sh tier | tabs | models | tablimit trên máy 220 (xem docs/QUOTA.md).";
  }

  function groupSummary(g) {
    var parts = [];
    if (g.limit != null) parts.push("hạn mức " + (g.limit === "unlimited" ? "không giới hạn" : num(g.limit)));
    if (g.tabs != null) parts.push("tab " + tabsText(g.tabs));
    if (g.models != null) parts.push(modelsText(g.models));
    if (g.tab_limits != null) parts.push("theo tab: " + tabLimitsText(g.tab_limits));
    return parts.length ? parts.join(" · ") : "theo bậc";
  }

  function input(value, placeholder, label) {
    var i = el("input");
    i.value = value == null ? "" : String(value);
    i.placeholder = placeholder;
    i.setAttribute("aria-label", label);
    i.autocomplete = "off";
    i.spellcheck = false;
    return i;
  }

  function gpost(body, okText) {
    if (busy) return Promise.resolve(false);
    busy = true;
    return call("POST", body).then(function (j) {
      busy = false;
      if (!j.ok) { gmsg(j.message || "Không thực hiện được.", "err"); return false; }
      return load().then(function () { if (okText) gmsg(okText); return true; });
    });
  }

  function parseLimit(s) {
    s = s.trim().toLowerCase();
    if (!s) return { v: null };
    if (s === "unlimited" || s === "không giới hạn") return { v: "unlimited" };
    if (!/^[0-9][0-9.,]*$/.test(s)) return { err: "Hạn mức phải là số token, unlimited, hoặc để trống (theo bậc)." };
    return { v: parseInt(s.replace(/[.,]/g, ""), 10) };
  }

  function groupCard(g, open) {
    var box = el("details", null, "group");
    if (open) box.open = true;
    var sum = el("summary", g.name + " ");
    sum.appendChild(el("span", "· " + g.members.length + " người · " + groupSummary(g), "muted"));
    box.appendChild(sum);

    var grid = el("div", null, "grid");
    var lim = input(g.limit === "unlimited" ? "unlimited" : g.limit, "trống = theo bậc; số hoặc unlimited", "Hạn mức token/ngày của nhóm");
    grid.appendChild(el("label", "Hạn mức token/ngày"));
    grid.appendChild(lim);

    grid.appendChild(el("label", "Tab được dùng"));
    var tabsBox = el("div");
    var inherit = el("input");
    inherit.type = "checkbox";
    inherit.checked = g.tabs == null;
    var lb = el("label", null, "cb");
    lb.appendChild(inherit);
    lb.appendChild(document.createTextNode(" theo bậc"));
    tabsBox.appendChild(lb);
    var boxes = {};
    TABS.forEach(function (t) {
      var c = el("input");
      c.type = "checkbox";
      c.checked = g.tabs != null && g.tabs.indexOf(t) >= 0;
      c.disabled = inherit.checked;
      boxes[t] = c;
      var l = el("label", null, "cb");
      l.appendChild(c);
      l.appendChild(document.createTextNode(" " + TAB_LABEL[t]));
      tabsBox.appendChild(l);
    });
    inherit.addEventListener("change", function () { TABS.forEach(function (t) { boxes[t].disabled = inherit.checked; }); });
    grid.appendChild(tabsBox);

    var models = input(g.models ? g.models.join(", ") : "", "trống = theo bậc; tên cách nhau dấu phẩy; * = mọi mô hình", "Mô hình được dùng");
    grid.appendChild(el("label", "Mô hình"));
    grid.appendChild(models);

    var tl = {};
    TABS.forEach(function (t) {
      tl[t] = input(g.tab_limits && g.tab_limits[t] != null ? g.tab_limits[t] : "", "trống = không giới hạn riêng", "Hạn mức token/ngày của tab " + TAB_LABEL[t]);
      grid.appendChild(el("label", "Hạn mức tab " + TAB_LABEL[t]));
      grid.appendChild(tl[t]);
    });
    box.appendChild(grid);

    var save = el("button", "Lưu cấu hình nhóm", "primary sm");
    save.type = "button";
    save.addEventListener("click", function () {
      var changes = [];
      var l = parseLimit(lim.value);
      if (l.err) return gmsg(l.err, "err");
      if (JSON.stringify(l.v) !== JSON.stringify(g.limit == null ? null : g.limit)) changes.push({ field: "limit", value: l.v });
      var tv = inherit.checked ? null : TABS.filter(function (t) { return boxes[t].checked; });
      if (JSON.stringify(tv) !== JSON.stringify(g.tabs == null ? null : g.tabs)) changes.push({ field: "tabs", value: tv });
      var mv = models.value.split(/[\s,;]+/).filter(Boolean);
      mv = mv.length ? mv : null;
      if (JSON.stringify(mv) !== JSON.stringify(g.models == null ? null : g.models)) changes.push({ field: "models", value: mv });
      var tlv = {};
      for (var i = 0; i < TABS.length; i++) {
        var p = parseLimit(tl[TABS[i]].value);
        if (p.err || p.v === "unlimited") return gmsg("Hạn mức theo tab phải là số token hoặc để trống.", "err");
        if (p.v != null) tlv[TABS[i]] = p.v;
      }
      tlv = Object.keys(tlv).length ? tlv : null;
      if (JSON.stringify(tlv) !== JSON.stringify(g.tab_limits == null ? null : g.tab_limits)) changes.push({ field: "tab_limits", value: tlv });
      if (!changes.length) return gmsg("Không có gì thay đổi.");
      if (tv && !tv.length && !window.confirm("Nhóm " + g.name + " sẽ không được dùng tab nào. Tiếp tục?")) return;
      var run = function (k) {
        if (k >= changes.length) return gmsg("Đã lưu cấu hình nhóm " + g.name + ". Có hiệu lực từ yêu cầu kế tiếp.");
        gpost({ op: "group_set", name: g.name, field: changes[k].field, value: changes[k].value }).then(function (ok) { if (ok) run(k + 1); });
      };
      run(0);
    });
    box.appendChild(save);

    var hm = el("h2", "Thành viên (" + g.members.length + ")");
    hm.style.marginTop = "16px";
    box.appendChild(hm);
    var list = el("div", null, "members");
    g.members.slice(0, 1000).forEach(function (m) {
      var row = el("div");
      row.appendChild(el("span", m, "mono"));
      var rm = el("button", "Bỏ", "sm");
      rm.type = "button";
      rm.addEventListener("click", function () {
        if (window.confirm("Bỏ " + m + " khỏi nhóm " + g.name + "?")) gpost({ op: "group_remove", name: g.name, idents: [m] }, "Đã bỏ " + m + " khỏi nhóm " + g.name + ".");
      });
      row.appendChild(rm);
      list.appendChild(row);
    });
    if (!g.members.length) list.appendChild(el("div", "Chưa có ai.", "muted"));
    box.appendChild(list);
    var ta = el("textarea");
    ta.placeholder = "Dán email hoặc tên đăng nhập (cách nhau dấu phẩy, khoảng trắng hoặc xuống dòng; tối đa 500 mỗi lần)";
    ta.setAttribute("aria-label", "Thêm thành viên vào nhóm " + g.name);
    box.appendChild(ta);
    var row = el("div", null, "row");
    var add = el("button", "Thêm vào nhóm", "sm");
    add.type = "button";
    add.addEventListener("click", function () {
      if (!ta.value.trim()) return;
      gpost({ op: "group_add", name: g.name, idents: ta.value }, "Đã thêm vào nhóm " + g.name + ".").then(function (ok) { if (ok) ta.value = ""; });
    });
    row.appendChild(add);
    var del = el("button", "Xoá nhóm", "sm");
    del.type = "button";
    del.addEventListener("click", function () {
      if (window.confirm("Xoá nhóm " + g.name + " (" + g.members.length + " người)? Họ sẽ quay về cấu hình theo bậc.")) gpost({ op: "group_delete", name: g.name }, "Đã xoá nhóm " + g.name + ".");
    });
    row.appendChild(del);
    box.appendChild(row);
    return box;
  }

  var openGroups = {};
  function renderGroups(d) {
    var wrap = $("groups");
    Array.prototype.forEach.call(wrap.querySelectorAll("details.group"), function (x) { openGroups[x.getAttribute("data-name")] = x.open; });
    wrap.textContent = "";
    if (d.groups_error) wrap.appendChild(el("div", "Tệp nhóm (groups.json) đang hỏng: cổng hạn mức dùng bản đúng gần nhất và trang này không ghi đè. Sửa trên máy 220.", "msg err"));
    var gs = d.groups || [];
    $("nogroups").hidden = gs.length > 0 || !!d.groups_error;
    gs.forEach(function (g) {
      var c = groupCard(g, openGroups[g.name]);
      c.setAttribute("data-name", g.name);
      wrap.appendChild(c);
    });
    var ab = $("gaudit");
    ab.textContent = "";
    var OPS = { create: "tạo", "delete": "xoá", add: "thêm", remove: "bỏ", set: "đổi" };
    (d.groups_audit || []).forEach(function (a) {
      var tr = el("tr");
      tr.appendChild(el("td", when(a.ts)));
      tr.appendChild(el("td", a.actor));
      tr.appendChild(el("td", OPS[a.op] || a.op));
      tr.appendChild(el("td", a.group, "mono"));
      tr.appendChild(el("td", a.detail));
      ab.appendChild(tr);
    });
  }

  $("g-create").addEventListener("click", function () {
    var n = $("g-new").value.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(n)) return gmsg("Tên nhóm: 2–40 ký tự thường, số, - hoặc _ (ví dụ lop-k66-cntt).", "err");
    openGroups[n] = true;
    gpost({ op: "group_create", name: n }, "Đã tạo nhóm " + n + ". Thêm thành viên và đặt cấu hình bên dưới.").then(function (ok) { if (ok) $("g-new").value = ""; });
  });

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
