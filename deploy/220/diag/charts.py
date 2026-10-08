"""Biểu đồ SVG tĩnh và thành phần giao diện dùng chung cho trang quản trị (stats.py, pages.py). Chỉ dùng thư viện chuẩn; không script, không tài nguyên ngoài."""
import html

import report as R

WD = ("T2", "T3", "T4", "T5", "T6", "T7", "CN")

CSS = R.CSS + """
:root{--c1:#4a7bd0;--c2:#2f9e6f;--c3:#d69e2e;--c4:#d8554a;--c5:#8b6fd0;--c6:#2b9aa8;--ok:#2f855a;--bad:#c0362c}
@media (prefers-color-scheme:dark){:root{--c1:#6b9bf2;--c2:#48c78e;--c3:#e3b341;--c4:#ff7b72;--c5:#a78bfa;--c6:#4fc3d0;--ok:#48c78e;--bad:#ff7b72}}
html{scroll-behavior:smooth}main{max-width:1100px}a{color:var(--lo)}
nav.top{position:sticky;top:0;z-index:5;background:var(--bg);border-bottom:1px solid var(--line);margin:0 -16px 14px;padding:8px 16px;display:flex;flex-wrap:wrap;gap:4px 16px;align-items:center}
nav.top b{margin-right:6px}nav.top a{text-decoration:none;font-size:14px}nav.top a:hover{text-decoration:underline}
h2{scroll-margin-top:52px;border-bottom:1px solid var(--line);padding-bottom:4px;margin-top:34px}h2 small{font-weight:400;color:var(--mut);font-size:13px;margin-left:8px}
.pill{display:inline-block;padding:1px 9px;border-radius:99px;font-size:12px;background:var(--card);border:1px solid var(--line)}.pill.good{color:var(--ok)}.pill.bad{color:var(--bad)}.pill.warn{color:var(--c3)}
.hero{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin:12px 0}
.hero .k{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px;position:relative}
.hero .k span{color:var(--mut);font-size:12.5px;display:block}.hero .k b{font-size:28px;line-height:1.15;display:block}.hero .k i{font-style:normal;font-size:12px;color:var(--mut)}
.hero .k svg{position:absolute;right:10px;bottom:10px;width:84px;height:26px}
.up{color:var(--ok)}.dn{color:var(--bad)}.up.inv{color:var(--bad)}.dn.inv{color:var(--ok)}
.mini{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin:8px 0}.mini div{border:1px solid var(--line);border-radius:8px;padding:6px 10px}.mini b{display:block;font-size:17px}.mini span{font-size:12px;color:var(--mut)}
.ins{list-style:none;margin:8px 0;padding:0}.ins li{padding:5px 10px;margin:4px 0;border-left:4px solid var(--lo);background:var(--card);border-radius:0 6px 6px 0}
.ins li.good{border-left-color:var(--ok)}.ins li.warn{border-left-color:var(--c3)}.ins li.bad{border-left-color:var(--bad)}
.grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(340px,1fr))}
@media (max-width:520px){.grid{grid-template-columns:1fr}}
.card{min-width:0;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px}.card h3{margin:0 0 6px;font-size:14px}.card .sub{color:var(--mut);font-size:12px;margin:-2px 0 4px}
.ch{width:100%;height:auto;display:block}.ch rect.s1,.ch rect.hm{fill:var(--c1)}.ch rect.s2{fill:var(--c2)}.ch rect.s3{fill:var(--c3)}.ch rect.s4{fill:var(--c4)}.ch rect.s5{fill:var(--c5)}.ch rect.s6{fill:var(--c6)}
.ch path.ln{fill:none;stroke-width:1.6;stroke-linejoin:round}.ch path.s1{stroke:var(--c1)}.ch path.s2{stroke:var(--c2)}.ch path.s3{stroke:var(--c3)}.ch path.s4{stroke:var(--c4)}
.ch circle.s1{fill:var(--c1)}.ch circle.s2{fill:var(--c2)}.ch circle.s3{fill:var(--c3)}.ch circle.s4{fill:var(--c4)}.ch line{stroke:var(--line)}.ch text{fill:var(--mut);font-size:9px}
.flt{margin:8px 0}.flt input{position:absolute;opacity:0;pointer-events:none}.flt label{display:inline-block;border:1px solid var(--line);border-radius:99px;padding:2px 12px;margin:0 6px 6px 0;cursor:pointer;font-size:13px}
.flt input:checked+label{background:var(--c1);border-color:var(--c1);color:#fff}.flt input:focus-visible+label{outline:2px solid var(--c1);outline-offset:2px}
#f-bn:checked~.wrap tr.r:not(.st-bn),#f-ba:checked~.wrap tr.r:not(.st-ba),#f-bd:checked~.wrap tr.r:not(.st-bd),#f-near:checked~.wrap tr.r:not(.near),#f-err:checked~.wrap tr.r:not(.haserr){display:none}
details.sec{margin:10px 0}details.sec>summary{cursor:pointer;font-weight:600;padding:4px 0}
.ch a{cursor:pointer}.ch a:hover rect,.ch a:hover circle{opacity:.7}
.lg{display:flex;flex-wrap:wrap;gap:2px 12px;font-size:12px;color:var(--mut);margin:4px 0 0}.lg i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:-1px}
.s1b{background:var(--c1)}.s2b{background:var(--c2)}.s3b{background:var(--c3)}.s4b{background:var(--c4)}.s5b{background:var(--c5)}.s6b{background:var(--c6)}
.hb{display:grid;grid-template-columns:minmax(70px,32%) 1fr auto;gap:4px 8px;align-items:center;font-size:13.5px;margin-bottom:6px}.hb .t{height:10px;background:var(--line);border-radius:5px;overflow:hidden}.hb .t i{display:block;height:100%;background:var(--c1);border-radius:5px}
.hb .n{color:var(--mut);font-variant-numeric:tabular-nums;white-space:nowrap}.hb .l{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hb.bad .t i{background:var(--c4)}.hb.g .t i{background:var(--c2)}
.seg{display:flex;height:16px;border-radius:8px;overflow:hidden;margin:6px 0;background:var(--line)}.seg i{display:block;height:100%}
.fn{display:grid;grid-template-columns:minmax(120px,38%) 1fr auto;gap:5px 8px;align-items:center;font-size:13.5px}.fn .t{height:20px;background:var(--line);border-radius:4px;overflow:hidden}.fn .t i{display:block;height:100%;background:var(--c1);opacity:.85}.fn .n{color:var(--mut);white-space:nowrap}
.badge{display:inline-block;padding:0 8px;border-radius:99px;font-size:12px;border:1px solid var(--line)}.badge.bn{color:var(--c1)}.badge.ba{color:var(--ok)}.badge.bd{color:var(--mut)}
table.u td svg{width:70px;height:18px;display:block}table.u{font-size:13px}table.u td,table.u th{white-space:nowrap}.num{text-align:right;font-variant-numeric:tabular-nums}
small,.note{color:var(--mut);font-size:12.5px}code{font-size:13px}.ok{color:var(--ok)}.bad{color:var(--bad)}"""


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


def _frame(w, h, mx, labels, trim, unit=""):
    return '<text x="0" y="%d">%s</text><text x="%d" y="%d" text-anchor="end">%s</text><text x="%d" y="9" text-anchor="end">max %.3g%s</text>' % (h + 12, _e(labels[0][trim:]), w, h + 12, _e(labels[-1][trim:]), w, mx, unit)


def stack(series, labels, h=70, trim=5, unit="", links=None):
    """Cột chồng: series = [(tên, giá trị[], lớp màu)]."""
    n, w = len(labels), 300
    tot = [sum(s[1][i] or 0 for s in series) for i in range(n)]
    mx = max(tot) or 1
    bw = w / n
    o = ['<svg class="ch" viewBox="0 0 %d %d" role="img" aria-label="Biểu đồ cột %d cột, lớn nhất %g">' % (w, h + 16, n, mx)]
    for i in range(n):
        y = h
        for name, vals, cls in series:
            v = vals[i] or 0
            if v:
                bh = (h - 10) * v / mx
                y -= bh
                r = '<rect class="%s" x="%.1f" y="%.1f" width="%.1f" height="%.1f"><title>%s · %s: %g</title></rect>' % (cls, i * bw + 1, y, max(bw - 2, 1), max(bh, .6), _e(labels[i]), _e(name), v)
                o.append('<a href="%s">%s</a>' % (_e(links[i]), r) if links and links[i] else r)
    o.append(_frame(w, h, mx, labels, trim, unit) + "</svg>")
    return "".join(o)


def bars(vals, labels, errs=None, h=70, trim=5, links=None):
    if errs:
        return stack([("Không lỗi", [max(v - x, 0) for v, x in zip(vals, errs)], "s1"), ("Lỗi", errs, "s4")], labels, h, trim, links=links)
    return stack([("Giá trị", vals, "s1")], labels, h, trim, links=links)


def lines(series, labels, h=70, trim=5, unit="", links=None):
    """Đường: series = [(tên, giá trị[] (None = trống), lớp màu)]. Nối các điểm có dữ liệu."""
    n, w = len(labels), 300
    mx = max([v for _, vs, _ in series for v in vs if v is not None] or [1]) or 1
    o = ['<svg class="ch" viewBox="0 0 %d %d" role="img" aria-label="Biểu đồ đường %d ngày, lớn nhất %g%s"><line x1="0" y1="%d" x2="%d" y2="%d"/>' % (w, h + 16, n, mx, unit, h, w, h)]
    for name, vals, cls in series:
        pts = [(i * w / max(n - 1, 1), h - (h - 12) * v / mx - 1, v, labels[i]) for i, v in enumerate(vals) if v is not None]
        if len(pts) > 1:
            o.append('<path class="ln %s" d="M%s"/>' % (cls, " L".join("%.1f,%.1f" % p[:2] for p in pts)))
        for x, y, v, lab in pts:
            c = '<circle class="%s" cx="%.1f" cy="%.1f" r="%s"><title>%s · %s: %.3g%s</title></circle>' % (cls, x, y, "2.2" if len(pts) < 20 else "1.4", _e(lab), _e(name), v, unit)
            o.append('<a href="%s">%s</a>' % (_e(links[labels.index(lab)]), c) if links and links[labels.index(lab)] else c)
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


def table(cols, rows, cls="", raw=(), row_cls=None):
    th = "".join("<th>%s</th>" % _e(c) for c in cols)
    body = "".join('<tr%s>%s</tr>' % (' class="%s"' % _e(row_cls[i]) if row_cls and row_cls[i] else "", "".join("<td%s>%s</td>" % (' class="num"' if isinstance(c, (int, float)) else "", c if j in raw else _e(c)) for j, c in enumerate(r))) for i, r in enumerate(rows))
    return '<div class="wrap"><table class="%s"><tr>%s</tr>%s</table></div>' % (cls, th, body)
