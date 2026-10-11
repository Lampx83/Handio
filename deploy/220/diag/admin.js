// Trợ giúp cho các trang báo cáo của quản trị viên (tệp tĩnh do stats.py/report.py tạo). Chỉ đọc textContent và đổi thuộc tính: không chèn HTML, không chạy chuỗi lệnh, không gọi mạng.
// Chỉ làm ba việc: sắp xếp bảng (bấm tiêu đề cột), ô lọc cho bảng dài, và tự tải lại trang sau N giây (body[data-refresh]).
(function () {
  "use strict";

  var NUM = /^-?\d+(\.\d+)?$/;
  var THOUSANDS = /^\d{1,3}(\.\d{3})+$/;

  // Giá trị so sánh của một ô: số (nếu bắt đầu bằng số), ngược lại chữ; ô trống/"—" luôn xếp cuối.
  function key(td) {
    var t = (td.textContent || "").trim();
    if (!t || t === "—" || t === "-") return null;
    var first = t.split(/\s+/)[0].replace(/%$/, "").replace(/,/g, "");
    if (THOUSANDS.test(first)) first = first.replace(/\./g, "");
    if (NUM.test(first)) return parseFloat(first);
    return t.toLowerCase();
  }

  function cmp(a, b) {
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    if (typeof a === "number" && typeof b === "number") return a - b;
    if (typeof a === "number") return -1;
    if (typeof b === "number") return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  }

  function bodyRows(table) {
    var rows = [];
    for (var i = 0; i < table.rows.length; i++) {
      if (table.rows[i].querySelector("th")) continue;
      rows.push(table.rows[i]);
    }
    return rows;
  }

  function makeSortable(table) {
    var head = table.rows[0];
    if (!head) return;
    Array.prototype.forEach.call(head.cells, function (th, col) {
      var rows = bodyRows(table);
      if (!rows.some(function (r) { return r.cells[col] && (r.cells[col].textContent || "").trim() !== ""; })) return;   // cột chỉ có hình
      th.setAttribute("data-s", "1");
      th.title = "Bấm để sắp xếp";
      th.tabIndex = 0;
      var go = function () {
        var dir = th.getAttribute("data-dir") === "asc" ? "desc" : "asc";
        Array.prototype.forEach.call(head.cells, function (h) { h.removeAttribute("data-dir"); });
        th.setAttribute("data-dir", dir);
        var sign = dir === "asc" ? 1 : -1;
        var list = bodyRows(table).map(function (r, i) { return { r: r, k: r.cells[col] ? key(r.cells[col]) : null, i: i }; });
        list.sort(function (x, y) {
          if (x.k === null || y.k === null) return cmp(x.k, y.k) || x.i - y.i;   // ô trống luôn cuối, bất kể chiều
          return sign * cmp(x.k, y.k) || x.i - y.i;
        });
        var tb = rows[0] && rows[0].parentNode;
        list.forEach(function (x) { (x.r.parentNode || tb).appendChild(x.r); });
      };
      th.addEventListener("click", go);
      th.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    });
  }

  function makeFilter(table) {
    var rows = bodyRows(table);
    if (rows.length <= 12) return;
    var box = document.createElement("input");
    box.type = "search";
    box.className = "tsearch";
    box.placeholder = "Lọc bảng (mã, phiên bản, nền tảng…)";
    box.setAttribute("aria-label", "Lọc bảng");
    var holder = table.parentNode && table.parentNode.classList.contains("wrap") ? table.parentNode : table;
    holder.parentNode.insertBefore(box, holder);
    box.addEventListener("input", function () {
      var q = box.value.trim().toLowerCase();
      bodyRows(table).forEach(function (r) { r.hidden = !!q && (r.textContent || "").toLowerCase().indexOf(q) < 0; });
    });
  }

  function autoRefresh() {
    var secs = parseInt(document.body.getAttribute("data-refresh") || "0", 10);
    if (!(secs >= 60)) return;
    var t0 = Date.now();
    setInterval(function () {
      var a = document.activeElement;
      var typing = a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA");
      if (!document.hidden && !typing && Date.now() - t0 > secs * 1000) location.reload();
    }, 30000);
  }

  Array.prototype.forEach.call(document.querySelectorAll("table.sortable"), function (t) { makeSortable(t); makeFilter(t); });
  autoRefresh();
})();
