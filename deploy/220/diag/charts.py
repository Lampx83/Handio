"""Biểu đồ SVG tĩnh và thành phần giao diện dùng chung cho trang quản trị (stats.py, pages.py). Chỉ dùng thư viện chuẩn; không script, không tài nguyên ngoài."""
import html
import re

import report as R

WD = ("T2", "T3", "T4", "T5", "T6", "T7", "CN")

# Bảng màu biểu đồ: c1 là màu chính (họ màu nhấn xanh NEU), c2…c6 phân loại dịu; thứ tự cố định, đã kiểm tra phân biệt được khi mù màu (cặp kề nhau) ở cả nền sáng lẫn tối.
CSS = R.CSS + """
:root{--c1:#2366c4;--c2:#1a9e6e;--c3:#e09a00;--c4:#d0402c;--c5:#7a5ccf;--c6:#cc5f9a;--bad:var(--err)}
@media (prefers-color-scheme:dark){:root{--c1:#4a8cf0;--c2:#1f9a6c;--c3:#bf8600;--c4:#d63f45;--c5:#8a72e0;--c6:#d0619c}}
nav.sec{position:sticky;top:52px;z-index:15;display:flex;gap:4px;overflow-x:auto;scrollbar-width:none;margin:0 -24px 6px;padding:8px 24px;background:color-mix(in srgb,var(--bg) 92%,transparent);backdrop-filter:blur(6px);border-bottom:1px solid var(--border)}
nav.sec::-webkit-scrollbar{display:none}nav.sec a{padding:4px 10px;border-radius:99px;color:var(--muted);text-decoration:none;font-size:13px;font-weight:500;white-space:nowrap}nav.sec a:hover{background:var(--panel2);color:var(--text)}
.status{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:99px;font-size:12.5px;font-weight:500;background:var(--panel);border:1px solid var(--border)}
.status::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--muted)}.status.good::before{background:var(--ok)}.status.bad::before{background:var(--err)}
.rng{display:inline-flex;background:var(--panel2);border:1px solid var(--border);border-radius:var(--r1);padding:2px;gap:2px}
.rng a{padding:4px 11px;border-radius:4px;color:var(--muted);text-decoration:none;font-size:13px;font-weight:500;white-space:nowrap}.rng a:hover{color:var(--text)}
.rng a.on{background:var(--panel);color:var(--text);box-shadow:var(--sh1);pointer-events:none}
h2{scroll-margin-top:110px;display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px;margin-top:36px}h2 small{font-weight:400;color:var(--muted);font-size:12.5px}
.ch line.mk{stroke:var(--c5);stroke-dasharray:2 2}.ch path.pv{fill:none;stroke:var(--muted);stroke-width:1.2;stroke-dasharray:3 2;opacity:.8}.ch circle.fl{fill:none;stroke:var(--err);stroke-width:1.6}
.tsearch{margin:6px 0 8px;width:min(100%,320px)}
table.sortable th[data-s]{cursor:pointer}table.sortable th[data-s]:hover{color:var(--text)}th[data-dir=asc]::after{content:" ▲";font-size:9px}th[data-dir=desc]::after{content:" ▼";font-size:9px}
td.hc{padding:0}td.hc span{display:block;padding:8px 12px;text-align:right;font-variant-numeric:tabular-nums}
.pill{display:inline-block;padding:1px 9px;border-radius:99px;font-size:12px;font-weight:500;background:var(--panel2)}.pill.good{background:var(--ok-soft);color:var(--ok)}.pill.bad{background:var(--err-soft);color:var(--err)}.pill.warn{background:var(--warn-soft);color:var(--warn)}
.hero{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px;margin:14px 0}
.hero .k{background:var(--panel);border:1px solid var(--border);border-radius:var(--r2);box-shadow:var(--sh1);padding:14px 16px 12px;position:relative;min-height:112px}
.hero .k span{color:var(--muted);font-size:12.5px;font-weight:500;display:block}.hero .k b{font-size:28px;line-height:1.15;font-weight:650;display:block;margin:4px 0 2px;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.hero .k i{font-style:normal;font-size:12px;color:var(--muted);display:block;padding-right:96px}.hero .k svg{position:absolute;right:14px;bottom:14px;width:84px;height:28px}
.up,.dn{font-weight:600}.up{color:var(--ok)}.dn{color:var(--err)}.up.inv{color:var(--err)}.dn.inv{color:var(--ok)}
.mini{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:10px;margin:10px 0}.mini div{background:var(--panel);border:1px solid var(--border);border-radius:var(--r1);padding:8px 12px}
.mini b{display:block;font-size:18px;font-weight:650;font-variant-numeric:tabular-nums}.mini span{font-size:12px;color:var(--muted)}.mini i{display:block;font-style:normal;font-size:12px;color:var(--muted)}
.card .mini{grid-template-columns:repeat(auto-fit,minmax(110px,1fr))}.card .mini div{background:var(--panel2);border-color:transparent}
main>h3{margin:26px 0 6px}main>h3+.note{margin-top:0}
.ins{list-style:none;margin:10px 0;padding:0;display:grid;gap:6px}.ins li{padding:8px 12px;border:1px solid var(--border);border-left:3px solid var(--accent);background:var(--panel);border-radius:var(--r1);font-size:13.5px}
.ins li.good{border-left-color:var(--ok)}.ins li.warn{border-left-color:var(--warn)}.ins li.bad{border-left-color:var(--err);background:var(--err-soft)}
.grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(340px,1fr))}.grid>.card{margin:0}
@media (max-width:520px){.grid{grid-template-columns:1fr}}
.card h3{margin:0 0 4px;font-size:13.5px;font-weight:600}.card h3 small{font-weight:400}.card .sub{color:var(--muted);font-size:12px;margin:0 0 6px}
.ch{width:100%;height:auto;display:block;margin-top:6px;overflow:visible}.ch rect.s1,.ch rect.hm{fill:var(--c1)}.ch rect.s2{fill:var(--c2)}.ch rect.s3{fill:var(--c3)}.ch rect.s4{fill:var(--c4)}.ch rect.s5{fill:var(--c5)}.ch rect.s6{fill:var(--c6)}
.ch path.ln{fill:none;stroke-width:1.6;stroke-linejoin:round;stroke-linecap:round}.ch path.s1{stroke:var(--c1)}.ch path.s2{stroke:var(--c2)}.ch path.s3{stroke:var(--c3)}.ch path.s4{stroke:var(--c4)}
.ch circle.s1{fill:var(--c1)}.ch circle.s2{fill:var(--c2)}.ch circle.s3{fill:var(--c3)}.ch circle.s4{fill:var(--c4)}.ch line{stroke:var(--border)}.ch text{fill:var(--muted);font-size:8.5px;font-variant-numeric:tabular-nums}
.flt{margin:8px 0}.flt input[type=radio]{position:absolute;opacity:0;pointer-events:none}.flt label{display:inline-block;border:1px solid var(--border);background:var(--panel);border-radius:99px;padding:3px 12px;margin:0 6px 6px 0;cursor:pointer;font-size:13px;font-weight:500;color:var(--muted)}
.flt label:hover{color:var(--text)}.flt input:checked+label{background:var(--accent-soft);border-color:var(--accent);color:var(--accent)}.flt input:focus-visible+label{outline:2px solid var(--accent);outline-offset:2px}
#f-bn:checked~.wrap tr.r:not(.st-bn),#f-ba:checked~.wrap tr.r:not(.st-ba),#f-bd:checked~.wrap tr.r:not(.st-bd),#f-near:checked~.wrap tr.r:not(.near),#f-err:checked~.wrap tr.r:not(.haserr){display:none}
details.sec{margin:12px 0;background:var(--panel);border:1px solid var(--border);border-radius:var(--r2);padding:8px 14px}details.sec>summary{cursor:pointer;font-weight:600;padding:4px 0;font-size:13.5px}
.ch a{cursor:pointer}.ch a:hover rect,.ch a:hover circle{opacity:.7}
.lg{display:flex;flex-wrap:wrap;gap:2px 12px;font-size:12px;color:var(--muted);margin:6px 0 0}.lg i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}
.pvb{background:none;border:1px dashed var(--muted)}.s1b{background:var(--c1)}.s2b{background:var(--c2)}.s3b{background:var(--c3)}.s4b{background:var(--c4)}.s5b{background:var(--c5)}.s6b{background:var(--c6)}
.hb{display:grid;grid-template-columns:minmax(70px,32%) 1fr auto;gap:6px 10px;align-items:center;font-size:13px;margin:4px 0 6px}.hb .t{height:8px;background:var(--panel2);border-radius:4px;overflow:hidden}.hb .t i{display:block;height:100%;background:var(--c1);border-radius:4px}
.hb .n{color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap;font-size:12.5px}.hb .l{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hb.bad .t i{background:var(--c4)}.hb.g .t i{background:var(--c2)}
.seg{display:flex;height:14px;border-radius:7px;overflow:hidden;margin:8px 0;background:var(--panel2);gap:2px}.seg i{display:block;height:100%}
.fn{display:grid;grid-template-columns:minmax(120px,38%) 1fr auto;gap:6px 10px;align-items:center;font-size:13px}.fn .t{height:18px;background:var(--panel2);border-radius:4px;overflow:hidden}.fn .t i{display:block;height:100%;background:var(--c1);border-radius:4px}.fn .n{color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums;font-size:12.5px}
.badge{display:inline-block;padding:1px 9px;border-radius:99px;font-size:12px;font-weight:500;background:var(--panel2)}.badge.bn{background:var(--accent-soft);color:var(--accent)}.badge.ba{background:var(--ok-soft);color:var(--ok)}.badge.bd{color:var(--muted)}
table.u td svg{width:70px;height:18px;display:block}table.u td,table.u th{white-space:nowrap}
.ok{color:var(--ok)}.bad{color:var(--err)}.hb.bad,.hb.g,.ins li.bad{color:var(--text)}
@media (max-width:640px){nav.sec{margin:0 -16px 6px;padding:8px 16px;top:52px}.hero{grid-template-columns:1fr 1fr}.hero .k{min-height:0}.hero .k svg{display:none}.hero .k i{padding-right:0}.hero .k b{font-size:22px}}"""


def _e(x):
    return html.escape(str(x))


def spark(vals, cls="s1"):
    n, mx = len(vals), max(vals) if vals else 0
    if n < 2 or mx == 0:
        return '<svg viewBox="0 0 84 26" aria-hidden="true"><line x1="0" y1="24" x2="84" y2="24" stroke="var(--line)"/></svg>'
    pts = [(i * 84 / (n - 1), 24 - 22 * v / mx) for i, v in enumerate(vals)]
    return '<svg viewBox="0 0 84 26" class="ch" aria-hidden="true"><path class="ln %s" d="M%s"/><circle class="%s" cx="%.1f" cy="%.1f" r="2"/></svg>' % (cls, " L".join("%.1f,%.1f" % p for p in pts), cls, pts[-1][0], pts[-1][1])


def strip(vals):
    n, mx = len(vals), max(vals) if vals else 0
    if not mx:
        return '<svg viewBox="0 0 70 18" aria-hidden="true"></svg>'
    bw = 70 / n
    return '<svg viewBox="0 0 70 18" class="ch" aria-hidden="true">' + "".join('<rect class="s1" x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="1"><title>%d lượt</title></rect>' % (i * bw + .5, 17 - 16 * v / mx, bw - 1, 16 * v / mx + .5, v) for i, v in enumerate(vals) if v) + "</svg>"


def fmt(v, unit=""):
    """Số gọn để đọc: 5340 ms -> '5.3 s', 15700000 -> '15.7 triệu', 2190 -> '2.2 nghìn' (không dùng dạng khoa học 1e+07)."""
    u = unit.strip()
    if u == "ms" and v >= 1000:
        v, u = v / 1000.0, "s"
    if abs(v) >= 1e6:
        s = ("%.1f" % (v / 1e6)).rstrip("0").rstrip(".") + " triệu"
    elif abs(v) >= 1e3:
        s = ("%.1f" % (v / 1e3)).rstrip("0").rstrip(".") + " nghìn"
    else:
        s = "%.3g" % v
        if "e" in s:
            s = "%.0f" % v
    return s + ("" if u == "%" else " ") + u if u else s


def _frame(w, h, mx, labels, trim, unit=""):
    return '<text x="0" y="%d">%s</text><text x="%d" y="%d" text-anchor="end">%s</text><text x="%d" y="9" text-anchor="end">max %s</text>' % (h + 12, _e(labels[0][trim:]), w, h + 12, _e(labels[-1][trim:]), w, _e(fmt(mx, unit)))


def _marks(marks, n, w, h):
    """Vạch đứng đánh dấu mốc (vd ngày một phiên bản mới xuất hiện): marks = {chỉ số cột: chú thích}."""
    return "".join('<line class="mk" x1="%.1f" y1="0" x2="%.1f" y2="%d"><title>%s</title></line>' % (i * w / n, i * w / n, h, _e(t)) for i, t in sorted((marks or {}).items()) if 0 < i < n)


def _prev_path(prev, n, w, h, mx):
    """Đường đứt nét của kỳ trước (cùng số cột, đặt cùng thang với kỳ hiện tại)."""
    pts = [((i + .5) * w / n, h - (h - 10) * v / mx) for i, v in enumerate(prev or []) if v is not None]
    return '<path class="pv" d="M%s"><title>Kỳ trước</title></path>' % " L".join("%.1f,%.1f" % p for p in pts) if len(pts) > 1 else ""


def stack(series, labels, h=70, trim=5, unit="", links=None, marks=None, prev=None):
    """Cột chồng: series = [(tên, giá trị[], lớp màu)]. marks: vạch mốc; prev: tổng của kỳ trước (đường đứt nét)."""
    n, w = len(labels), 300
    tot = [sum(s[1][i] or 0 for s in series) for i in range(n)]
    mx = max(tot + [v for v in (prev or []) if v is not None]) or 1
    bw = w / n
    o = ['<svg class="ch" viewBox="0 0 %d %d" role="img" aria-label="Biểu đồ cột %d cột, lớn nhất %s">' % (w, h + 16, n, _e(fmt(mx, unit)))]
    for i in range(n):
        y = h
        for name, vals, cls in series:
            v = vals[i] or 0
            if v:
                bh = (h - 10) * v / mx
                y -= bh
                r = '<rect class="%s" x="%.1f" y="%.1f" width="%.1f" height="%.1f"><title>%s · %s: %g</title></rect>' % (cls, i * bw + 1, y, max(bw - 2, 1), max(bh, .6), _e(labels[i]), _e(name), v)
                o.append('<a href="%s">%s</a>' % (_e(links[i]), r) if links and links[i] else r)
    o.append(_prev_path(prev, n, w, h, mx) + _marks(marks, n, w, h))
    o.append(_frame(w, h, mx, labels, trim, unit) + "</svg>")
    return "".join(o)


def bars(vals, labels, errs=None, h=70, trim=5, links=None, marks=None, prev=None):
    if errs:
        return stack([("Không lỗi", [max(v - x, 0) for v, x in zip(vals, errs)], "s1"), ("Lỗi", errs, "s4")], labels, h, trim, links=links, marks=marks, prev=prev)
    return stack([("Giá trị", vals, "s1")], labels, h, trim, links=links, marks=marks, prev=prev)


def lines(series, labels, h=70, trim=5, unit="", links=None, marks=None, prev=None, flags=None):
    """Đường: series = [(tên, giá trị[] (None = trống), lớp màu)]. Nối các điểm có dữ liệu.
    prev: giá trị kỳ trước (đường đứt nét); flags: tập chỉ số điểm bất thường (vòng đỏ); marks: vạch mốc."""
    n, w = len(labels), 300
    mx = max([v for _, vs, _ in series for v in vs if v is not None] + [v for v in (prev or []) if v is not None] or [1]) or 1
    o = ['<svg class="ch" viewBox="0 0 %d %d" role="img" aria-label="Biểu đồ đường %d điểm, lớn nhất %s"><line x1="0" y1="%d" x2="%d" y2="%d"/>' % (w, h + 16, n, _e(fmt(mx, unit)), h, w, h)]
    if prev:
        pp = [(i * w / max(n - 1, 1), h - (h - 12) * v / mx - 1) for i, v in enumerate(prev) if v is not None]
        if len(pp) > 1:
            o.append('<path class="pv" d="M%s"><title>Kỳ trước</title></path>' % " L".join("%.1f,%.1f" % p for p in pp))
    for name, vals, cls in series:
        pts = [(i * w / max(n - 1, 1), h - (h - 12) * v / mx - 1, v, labels[i], i) for i, v in enumerate(vals) if v is not None]
        if len(pts) > 1:
            o.append('<path class="ln %s" d="M%s"/>' % (cls, " L".join("%.1f,%.1f" % p[:2] for p in pts)))
        for x, y, v, lab, i in pts:
            c = '<circle class="%s" cx="%.1f" cy="%.1f" r="%s"><title>%s · %s: %s</title></circle>' % (cls, x, y, "2.2" if len(pts) < 20 else "1.4", _e(lab), _e(name), _e(fmt(v, unit)))
            o.append('<a href="%s">%s</a>' % (_e(links[i]), c) if links and links[i] else c)
            if flags and i in flags:
                o.append('<circle class="fl" cx="%.1f" cy="%.1f" r="4"><title>Bất thường: %s</title></circle>' % (x, y, _e(lab)))
    o.append(_marks(marks, n, w, h))
    o.append(_frame(w, h, mx, labels, trim, unit) + "</svg>")
    return "".join(o)


def legend(items):
    return '<div class="lg">' + "".join('<span><i class="%sb"></i>%s</span>' % (cls, _e(name)) for name, cls in items) + "</div>"


def heatmap(heat):
    mx = max(max(r) for r in heat) or 1
    cw, ch, left, top = 11, 11, 18, 10
    o = ['<svg class="ch" viewBox="0 0 %d %d" role="img" aria-label="Bản đồ nhiệt lượt làm việc theo thứ và giờ">' % (left + 24 * cw, top + 7 * ch + 2)]
    for h in range(0, 24, 3):
        o.append('<text x="%d" y="8">%02d</text>' % (left + h * cw, h))
    for d in range(7):
        o.append('<text x="0" y="%d">%s</text>' % (top + d * ch + 9, WD[d]))
        for h in range(24):
            v = heat[d][h]
            o.append('<rect class="hm" x="%d" y="%d" width="%d" height="%d" rx="2" fill-opacity="%.2f"><title>%s %02d:00 · %d lượt</title></rect>' % (left + h * cw + 1, top + d * ch + 1, cw - 2, ch - 2, .08 if not v else .2 + .8 * v / mx, WD[d], h, v))
    return "".join(o) + "</svg>"


def hbars(rows, cls=""):
    """rows = [(nhãn, giá trị, chú thích)]; độ dài thanh theo giá trị lớn nhất."""
    if not rows:
        return '<p class="note">Chưa có dữ liệu.</p>'
    mx = max(r[1] for r in rows) or 1
    return '<div class="hb %s">' % cls + "".join('<div class="l" title="%s">%s</div><div class="t"><i style="width:%.1f%%"></i></div><div class="n">%s</div>' % (_e(l), _e(l), 100 * v / mx, _e(note)) for l, v, note in rows) + "</div>"


def delta(cur, prev, inv=False, pct=False):
    if cur is None or prev is None:
        return ""
    if cur == prev:
        return "<i>bằng kỳ trước</i>"
    up = cur > prev
    txt = "mới" if prev == 0 else ("%+.1f điểm %%" % (100 * (cur - prev)) if pct else "%+.0f%%" % (100 * (cur - prev) / prev))
    return '<i><span class="%s%s">%s %s</span> so với kỳ trước</i>' % ("up" if up else "dn", " inv" if inv else "", "▲" if up else "▼", txt)


def hero(label, value, dl, sp):
    return '<div class="k"><span>%s</span><b>%s</b>%s%s</div>' % (_e(label), _e(value), sp, dl)


_N = r"[-+]?(?:\d{1,3}(?:\.\d{3})+|\d+(?:[.,]\d+)?)"
NUMLIKE = re.compile(r"^(?:%s(?:\s?(?:%%|s|ms|giây|triệu|nghìn))?|%s\s?/\s?%s(?:\s?(?:s|ms))?|[—-])$" % (_N, _N, _N))


def _is_num(c):
    return isinstance(c, (int, float)) or (isinstance(c, str) and bool(NUMLIKE.match(c.strip())))


def table(cols, rows, cls="", raw=(), row_cls=None):
    """Bảng có tiêu đề dính; cột toàn số (kể cả "12.5%", "3 / 9 s", "—") căn phải; không có hàng thì hiện trạng thái rỗng."""
    numc = [j not in raw and bool(rows) and all(_is_num(r[j]) for r in rows if j < len(r)) and any(_is_num(r[j]) and str(r[j]).strip() not in ("—", "-") for r in rows if j < len(r)) for j in range(len(cols))]
    th = "".join("<th%s>%s</th>" % (' class="num"' if numc[j] else "", _e(c)) for j, c in enumerate(cols))
    body = "".join('<tr%s>%s</tr>' % (' class="%s"' % _e(row_cls[i]) if row_cls and row_cls[i] else "", "".join("<td%s>%s</td>" % (' class="num"' if isinstance(c, (int, float)) or (j < len(numc) and numc[j]) else "", c if j in raw else _e(c)) for j, c in enumerate(r))) for i, r in enumerate(rows))
    if not rows:
        body = '<tr><td class="empty" colspan="%d">Chưa có dữ liệu.</td></tr>' % max(len(cols), 1)
    return '<div class="wrap"><table class="%s"><thead><tr>%s</tr></thead><tbody>%s</tbody></table></div>' % (cls, th, body)
