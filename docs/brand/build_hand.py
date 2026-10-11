#!/usr/bin/env python3
"""Hando — bàn tay VECTOR (SVG) 2D và 3D, có chuyển động. Một nguồn hình học, nhiều phiên bản:
  hand-{2d|3d}-{static|wave|offer|wiggle|count|working|done|breathe}.svg        (bàn tay trên nền ô vuông xanh = biểu tượng ứng dụng)
  hand-free-{2d|3d}-{...}.svg                                                    (bàn tay không nền, đặt lên mọi nền)
Chạy: python3 docs/brand/build_hand.py   (chỉ dùng thư viện chuẩn)
Hoạt hình bằng CSS trong SVG (chạy cả khi nhúng <img>), tắt khi người dùng chọn "giảm chuyển động".
"""
import json
import math
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
BLUE, BLUE2, DEEP, ORANGE, SKY = "#0B4A9E", "#1B7FD0", "#083A7D", "#F59E0B", "#E6EEF9"

# ---- hình học (hệ toạ độ 400 x 560, cổ tay ở khoảng (200, 400)). Bàn tay trái giơ lên, lòng bàn tay hướng người xem:
# từ trái sang phải: ngón cái, trỏ, giữa, áp út, út. Ngón là hình viên thuốc (capsule) hơi toả ra, thon dần về đầu ngón.
def _cap(p1, p2, w1, w2):
    """Đường viền viên thuốc thon: từ p1 (rộng w1) tới p2 (rộng w2), đầu tròn."""
    (x1, y1), (x2, y2) = p1, p2
    dx, dy = x2 - x1, y2 - y1
    L = math.hypot(dx, dy) or 1.0
    nx, ny = -dy / L, dx / L
    a = (x1 + nx * w1 / 2, y1 + ny * w1 / 2)
    b = (x2 + nx * w2 / 2, y2 + ny * w2 / 2)
    c = (x2 - nx * w2 / 2, y2 - ny * w2 / 2)
    d = (x1 - nx * w1 / 2, y1 - ny * w1 / 2)
    f = lambda q: f"{q[0]:.1f} {q[1]:.1f}"
    return f"M{f(a)} L{f(b)} A{w2 / 2:.1f} {w2 / 2:.1f} 0 0 0 {f(c)} L{f(d)} A{w1 / 2:.1f} {w1 / 2:.1f} 0 0 0 {f(a)} Z"


def _tip(p1, ang_deg, length):
    t = math.radians(ang_deg)
    return (p1[0] + length * math.sin(t), p1[1] - length * math.cos(t))


_fg = []
for name, base, ang, length, w1, w2 in [
    ("f1", (150, 262), -7, 124, 41, 35),    # trỏ
    ("f2", (191, 256), -1, 146, 42, 36),    # giữa
    ("f3", (232, 262), 5, 128, 40, 34),     # áp út
    ("f4", (268, 280), 13, 94, 36, 30),     # út
]:
    tip = _tip(base, ang, length)
    _fg.append((name, base, tip, w1, w2))
FINGERS = _fg
THUMB = ("th", (150, 350), _tip((150, 350), -40, 92), 46, 38)
PALM_D = "M124 292 C122 258 150 246 200 246 C252 246 280 258 278 292 C282 352 256 408 200 408 C144 408 120 352 124 292 Z"
ARM_D = "M152 392 L138 580 L262 580 L248 392 Z"
CUFF = (130, 432, 140, 48, 14)  # x, y, w, h, r
CHECK = "M168 318 L194 344 L238 294"
ORBIT = [  # huy hiệu quay quanh bàn tay khi "đang làm việc": mã, bút, tài liệu
    ("</>", -1), ("✎", 0), ("≡", 1),
]


def cap_path(fg):
    name, p1, p2, w1, w2 = fg
    return _cap(p1, p2, w1, w2)


def nail(fg, color):
    """Móng tay: elip nhỏ gần đầu ngón, xoay theo hướng ngón."""
    name, p1, p2, w1, w2 = fg
    dx, dy = p2[0] - p1[0], p2[1] - p1[1]
    L = math.hypot(dx, dy)
    ux, uy = dx / L, dy / L
    cx, cy = p2[0] - ux * w2 * 0.62, p2[1] - uy * w2 * 0.62
    ang = math.degrees(math.atan2(dx, -dy))
    return f'<ellipse cx="{cx:.1f}" cy="{cy:.1f}" rx="{w2 * 0.25:.1f}" ry="{w2 * 0.3:.1f}" transform="rotate({ang:.1f} {cx:.1f} {cy:.1f})" fill="{color}" opacity=".9"/>'


CSS = """
.hand{transform-box:view-box;transform-origin:200px 380px}
.f{transform-box:fill-box;transform-origin:50% 100%}
.chk{stroke-dasharray:200;stroke-dashoffset:0}
.sp{opacity:0}
@keyframes wave{0%,100%{transform:rotate(0)}15%{transform:rotate(-16deg)}30%{transform:rotate(11deg)}45%{transform:rotate(-13deg)}60%{transform:rotate(8deg)}75%{transform:rotate(-4deg)}}
@keyframes offer{0%{transform:translateY(70px);opacity:0}30%{transform:translateY(-10px);opacity:1}45%{transform:translateY(4px)}60%,100%{transform:translateY(0);opacity:1}}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
@keyframes wig{0%,100%{transform:translateY(0)}50%{transform:translateY(-20px)}}
@keyframes cnt{0%,60%,100%{transform:translateY(0)}25%{transform:translateY(-34px)}}
@keyframes orbit{to{transform:rotate(360deg)}}
@keyframes counter{to{transform:rotate(-360deg)}}
@keyframes draw{0%{stroke-dashoffset:200}35%,100%{stroke-dashoffset:0}}
@keyframes pop{0%,100%{transform:scale(1)}20%{transform:scale(1.12)}40%{transform:scale(.98)}55%{transform:scale(1)}}
@keyframes breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.045)}}
@keyframes mouseHold{0%,100%{transform:scaleY(.62)}45%{transform:scaleY(.62)}50%{transform:scaleY(1)}95%{transform:scaleY(1)}}
@keyframes typeA{0%{transform:scaleY(.62) translateY(0)}45%{transform:scaleY(.62) translateY(0)}50%{transform:scaleY(1) translateY(0)}54%{transform:translateY(-16px)}58%{transform:translateY(0)}64%{transform:translateY(-16px)}68%{transform:translateY(0)}74%{transform:translateY(-16px)}78%{transform:translateY(0)}84%{transform:translateY(-16px)}88%{transform:translateY(0)}95%{transform:scaleY(1) translateY(0)}100%{transform:scaleY(.62) translateY(0)}}
@keyframes clickIdx{0%,100%{transform:scaleY(.62) translateY(0)}6%{transform:scaleY(.62) translateY(14px)}10%{transform:scaleY(.62) translateY(0)}20%{transform:scaleY(.62) translateY(14px)}24%{transform:scaleY(.62) translateY(0)}34%{transform:scaleY(.62) translateY(14px)}38%{transform:scaleY(.62) translateY(0)}45%{transform:scaleY(.62) translateY(0)}50%{transform:scaleY(1) translateY(0)}54%{transform:translateY(-16px)}58%{transform:translateY(0)}64%{transform:translateY(-16px)}68%{transform:translateY(0)}95%{transform:scaleY(1)}}
@keyframes btn{0%,100%{opacity:0}6%,10%{opacity:1}12%{opacity:0}20%,24%{opacity:1}26%{opacity:0}34%,38%{opacity:1}40%{opacity:0}}
@keyframes ripple{0%,100%{opacity:0;transform:scale(.5)}6%{opacity:.9;transform:scale(.7)}16%{opacity:0;transform:scale(1.5)}20%{opacity:.9;transform:scale(.7)}30%{opacity:0;transform:scale(1.5)}34%{opacity:.9;transform:scale(.7)}44%{opacity:0;transform:scale(1.5)}}
@keyframes mouseOn{0%,46%{opacity:1}50%,96%{opacity:0}100%{opacity:1}}
@keyframes kbdOn{0%,46%{opacity:0}50%,96%{opacity:1}100%{opacity:0}}
@keyframes keyHit{0%,100%{fill:#F6F9FE}8%,14%{fill:#F59E0B}22%{fill:#F6F9FE}}
@keyframes mouseSlide{0%,100%{transform:translate(0,0)}15%{transform:translate(10px,-6px)}30%{transform:translate(-8px,4px)}45%{transform:translate(0,0)}}
@keyframes twinkle{0%,100%{opacity:0;transform:scale(.4)}50%{opacity:1;transform:scale(1)}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
"""
ANIM = {
    "static": "",
    "wave": ".hand{animation:wave 2.4s ease-in-out infinite}",
    "offer": ".hand{animation:offer 3.6s cubic-bezier(.2,.9,.3,1.2) infinite}",
    "wiggle": ".f1{animation:wig 1.1s ease-in-out infinite}.f2{animation:wig 1.1s ease-in-out .12s infinite}.f3{animation:wig 1.1s ease-in-out .24s infinite}.f4{animation:wig 1.1s ease-in-out .36s infinite}.th{animation:wig 1.1s ease-in-out .48s infinite}",
    "count": ".f1{animation:cnt 2.2s ease-in-out infinite}.f2{animation:cnt 2.2s ease-in-out .18s infinite}.f3{animation:cnt 2.2s ease-in-out .36s infinite}.f4{animation:cnt 2.2s ease-in-out .54s infinite}.th{animation:cnt 2.2s ease-in-out .72s infinite}",
    "working": ".f2,.f3,.f4{animation:typeA 5.4s ease-in-out infinite}.f3{animation-delay:.08s}.f4{animation-delay:.16s}.f1{animation:clickIdx 5.4s ease-in-out infinite}.th{animation:none}.mouse{animation:mouseOn 5.4s linear infinite}.mousebody{animation:mouseSlide 5.4s ease-in-out infinite}.kbd{animation:kbdOn 5.4s linear infinite}.btn{animation:btn 5.4s linear infinite}.rip{transform-box:fill-box;transform-origin:center;animation:ripple 5.4s linear infinite}.key{animation:keyHit 5.4s linear infinite}.k2{animation-delay:.25s}.k3{animation-delay:.5s}.k4{animation-delay:.75s}.k5{animation-delay:1.0s}.k6{animation-delay:1.25s}",
    "done": ".hand{animation:pop 3s ease-in-out infinite}.chk{animation:draw 3s ease-in-out infinite}.sp{animation:twinkle 3s ease-in-out infinite}.sp2{animation-delay:.25s}.sp3{animation-delay:.5s}",
    "breathe": ".hand{animation:breathe 3.2s ease-in-out infinite}",
}


def keyboard_svg(three):
    f = ' filter="url(#clay)"' if three else ""
    keys = ""
    n = 0
    for r in range(3):
        for c in range(9):
            x, y = 62 + c * 30.5, 500 + r * 24
            n += 1
            cls = f"key k{(n % 6) + 1}" if n % 4 == 0 else "key"
            keys += f'<rect class="{cls}" x="{x:.1f}" y="{y}" width="25" height="18" rx="4" fill="#F6F9FE"/>'
    keys += '<rect class="key k3" x="116" y="572" width="166" height="18" rx="4" fill="#F6F9FE"/>'
    return (f'<g class="kbd"><rect x="44" y="486" width="312" height="120" rx="18" fill="#C9D8EE"{f}/>{keys}</g>')


def mouse_svg(three):
    f = ' filter="url(#clay)"' if three else ""
    body = "M152 252 C152 204 248 204 248 252 L248 356 C248 408 152 408 152 356 Z"
    return (f'<g class="mouse"><path d="M200 200 C200 150 238 150 262 96" fill="none" stroke="#2D3648" stroke-width="7" stroke-linecap="round"/>'
            f'<g class="mousebody"><path d="{body}" fill="#2D3648"{f}/>'
            f'<clipPath id="mclip"><path d="{body}"/></clipPath>'
            f'<g clip-path="url(#mclip)"><path class="btn" d="M158 190 L200 190 L200 268 L158 268 Z" fill="{ORANGE}"/></g>'
            f'<path d="M200 214 L200 284 M154 284 L246 284" stroke="#6B7A96" stroke-width="5" stroke-linecap="round" fill="none"/>'
            f'<rect x="192" y="240" width="16" height="32" rx="8" fill="#9FB3CE"/>'
            f'<circle class="rip" cx="176" cy="252" r="28" fill="none" stroke="{ORANGE}" stroke-width="6"/></g></g>')


def hand_svg(style="2d", anim="static", bg=True, size=512):
    three = style == "3d"
    white = "#FFFFFF"
    edge = "#BCD2F0"
    defs = [
        f'<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{BLUE}"/><stop offset="1" stop-color="{BLUE2}"/></linearGradient>',
        '<clipPath id="c"><rect width="1024" height="1024" rx="224"/></clipPath>',
        f'<linearGradient id="skin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#DCE8F8"/></linearGradient>',
    ]
    if three:
        defs.append(
            '<filter id="clay" x="-25%" y="-25%" width="150%" height="150%" color-interpolation-filters="sRGB">'
            '<feGaussianBlur in="SourceAlpha" stdDeviation="9" result="b"/>'
            '<feDiffuseLighting in="b" surfaceScale="10" diffuseConstant="1.15" lighting-color="#ffffff" result="d"><feDistantLight azimuth="235" elevation="58"/></feDiffuseLighting>'
            '<feComposite in="d" in2="SourceGraphic" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" result="lit"/>'
            '<feSpecularLighting in="b" surfaceScale="10" specularConstant="0.75" specularExponent="26" lighting-color="#ffffff" result="s"><feDistantLight azimuth="235" elevation="60"/></feSpecularLighting>'
            '<feComposite in="s" in2="lit" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="sum"/>'
            '<feComposite in="sum" in2="SourceAlpha" operator="in"/></filter>'
            '<filter id="shadow" x="-30%" y="-30%" width="160%" height="170%"><feGaussianBlur stdDeviation="14"/></filter>')
    fill = white
    f = ' filter="url(#clay)"' if three else ""
    parts = []
    if anim == "working":
        parts.append(keyboard_svg(three))
    parts.append(f'<path d="{ARM_D}" fill="{SKY if not three else "#E3ECFA"}"{f}/>')
    shade = "#CBDCF4"
    nail_c = "#E7F0FC" if not three else "#EDF3FE"
    allcaps = [(fg, cap_path(fg)) for fg in FINGERS + [THUMB]]
    # 1) MỘT khối liền: bàn tay = palm + các ngón (cùng màu; 3D chiếu sáng cả khối một lần cho đẹp và liền)
    def solid_of(items, with_palm):
        return (f'<path d="{PALM_D}" fill="{fill}"/>' if with_palm else "") + "".join(f'<g class="f {fg[0]}"><path d="{d}" fill="{fill}"/></g>' for fg, d in items)

    def outline_of(items, with_palm):
        o = f'<path d="{PALM_D}" fill="{edge}" stroke="{edge}" stroke-width="6" stroke-linejoin="round"/>' if with_palm else ""
        return o + "".join(f'<g class="f {fg[0]}"><path d="{d}" fill="{edge}" stroke="{edge}" stroke-width="6" stroke-linejoin="round"/></g>' for fg, d in items)

    def emit(items, with_palm):
        if three:
            parts.append(f'<g filter="url(#clay)">{solid_of(items, with_palm)}</g>')
        else:
            parts.append(f'<g class="outline">{outline_of(items, with_palm)}</g>')
            parts.append(f'<g>{solid_of(items, with_palm)}</g>')

    if anim == "working":
        emit([], True)                        # lòng bàn tay
        parts.append(mouse_svg(three))        # con chuột nằm giữa lòng bàn tay và các ngón
        emit(allcaps, False)                  # các ngón + ngón cái phủ lên: "cầm" công cụ
    else:
        emit(allcaps, True)
    # 2) kẽ ngón: đường tối mảnh giữa hai ngón liền kề + giữa ngón cái và ngón trỏ
    seam = "#B7CBE8" if not three else "#9DB4D6"
    for a, b in zip(FINGERS, FINGERS[1:]):
        (n1, p1, t1, w1, v1), (n2, p2, t2, w2, v2) = a, b
        mx, my = (p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2
        k = 0.52
        ex = (p1[0] + (t1[0] - p1[0]) * k + p2[0] + (t2[0] - p2[0]) * k) / 2
        ey = (p1[1] + (t1[1] - p1[1]) * k + p2[1] + (t2[1] - p2[1]) * k) / 2
        parts.append(f'<path d="M{mx:.1f} {my + 14:.1f} L{ex:.1f} {ey:.1f}" stroke="{seam}" stroke-width="4" stroke-linecap="round" fill="none" opacity=".85"/>')
    tx0, ty0 = THUMB[1]
    parts.append(f'<path d="M{tx0 + 6} {ty0 - 22} L{FINGERS[0][1][0] - 8} {FINGERS[0][1][1] + 26}" stroke="{seam}" stroke-width="4" stroke-linecap="round" fill="none" opacity=".8"/>')
    # 3) dải bóng phẳng bên phải mỗi ngón + móng (chỉ 2D; 3D có ánh sáng thật)
    for fg, d in allcaps:
        cid = f"cp_{fg[0]}"
        defs.append(f'<clipPath id="{cid}"><path d="{d}"/></clipPath>')
        name, p1, p2, w1, w2 = fg
        g = ""
        if not three:
            g += f'<g clip-path="url(#{cid})"><path d="M{p1[0] + w1 * .40:.1f} {p1[1]} L{p2[0] + w2 * .40:.1f} {p2[1]}" stroke="{shade}" stroke-width="{w1 * .36:.1f}" fill="none" stroke-linecap="round"/></g>'
        g += nail(fg, nail_c)
        parts.append(f'<g class="f {fg[0]}">{g}</g>')
    if not three:
        defs.append(f'<clipPath id="cp_palm"><path d="{PALM_D}"/></clipPath>')
        parts.append(f'<g clip-path="url(#cp_palm)"><path d="M120 392 C170 420 250 410 290 330 L290 420 L120 420 Z" fill="{shade}" opacity=".9"/></g>')
    cx, cy, cw, ch, cr = CUFF
    parts.append(f'<rect x="{cx}" y="{cy}" width="{cw}" height="{ch}" rx="{cr}" fill="{ORANGE}"{f}/>')
    chk_col = BLUE
    if anim != "working":  # đang cầm chuột thì không vẽ dấu tích
        parts.append(f'<path class="chk" d="{CHECK}" fill="none" stroke="{chk_col}" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"{f if three else ""}/>')
    hand = f'<g class="hand">{"".join(parts)}</g>'
    extra = ""
    if anim == "done":
        sp = ""
        for i, (sx, sy, r) in enumerate([(88, 120, 14), (318, 104, 11), (330, 250, 9)]):
            sp += f'<path class="sp sp{i + 1}" transform="translate({sx} {sy})" d="M0 -{r} L{r * .3:.1f} -{r * .3:.1f} L{r} 0 L{r * .3:.1f} {r * .3:.1f} L0 {r} L-{r * .3:.1f} {r * .3:.1f} L-{r} 0 L-{r * .3:.1f} -{r * .3:.1f} Z" fill="{ORANGE}" style="transform-box:fill-box;transform-origin:center"/>'
        extra = sp
    shadow = ""
    if three:
        shadow = '<ellipse cx="200" cy="560" rx="100" ry="13" fill="#000" opacity=".28" filter="url(#shadow)"/>'
    style_block = f"<style>{CSS}{ANIM[anim]}</style>"
    if bg:
        s = 2.08
        tx, ty = 512 - 186 * s, 62 - 94 * s
        inner = f'<g clip-path="url(#c)"><rect width="1024" height="1024" fill="url(#g)"/><g transform="translate({tx:.0f} {ty:.0f}) scale({s})">{shadow}{hand}{extra}</g></g>'
        vb, w = "0 0 1024 1024", size
    else:
        inner = f"{shadow}{hand}{extra}"
        vb, w = "40 80 340 540", size
    h = size if bg else round(size * 540 / 340)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" width="{w}" height="{h}" role="img" aria-label="Hando — bàn tay giúp bạn một tay">'
            f'<defs>{"".join(defs)}</defs>{style_block}{inner}</svg>\n')


def gallery():
    items = []
    for style in ("2d", "3d"):
        for a in ANIM:
            items.append((style, a))
    labels = {"static": "Tĩnh", "wave": "Vẫy tay chào", "offer": "Đưa tay giúp", "wiggle": "Gõ phím", "count": "Đếm ngón (đang tải)", "working": "Đang làm việc: cầm chuột bấm · gõ bàn phím", "done": "Xong việc", "breathe": "Nhịp thở (chờ)"}
    cards = ""
    for style, a in items:
        cards += (f'<figure><img src="hand-{style}-{a}.svg" alt="{style} {a}" width="200" height="200"><figcaption><b>{style.upper()}</b> · {labels[a]}'
                  f'<br><code>hand-{style}-{a}.svg</code></figcaption></figure>')
    free = ""
    for style in ("2d", "3d"):
        free += f'<figure class="free"><img src="hand-free-{style}-wave.svg" alt="" height="200"><figcaption><b>{style.upper()}</b> · không nền, vẫy tay</figcaption></figure>'
    return f"""<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hando — bàn tay vector 2D / 3D</title>
<style>:root{{--bg:#f6f6f3;--panel:#fff;--text:#1f2328;--muted:#6b7078;--line:#dedcd3;--accent:#0b4a9e}}
@media (prefers-color-scheme:dark){{:root{{--bg:#17181a;--panel:#1f2023;--text:#e8e6e1;--muted:#9a9ea6;--line:#34363b;--accent:#5b9bff}}}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}}
main{{max-width:1180px;margin:0 auto;padding:24px 16px 60px}}h1{{margin:0 0 4px}}.muted{{color:var(--muted)}}h2{{margin:26px 0 8px;font-size:18px}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}}
figure{{margin:0;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:12px;text-align:center}}
figure img{{display:block;margin:0 auto 8px;max-width:100%;height:auto}}figcaption{{font-size:13px;color:var(--muted)}}code{{font-size:12px}}
.free{{background:linear-gradient(135deg,#fff,#e9f1fd)}}.dark{{background:#0b1b33}}.dark figcaption{{color:#9fb6d6}}
@media (prefers-color-scheme:dark){{.free{{background:linear-gradient(135deg,#1f2023,#14243d)}}}}</style></head>
<body><main><h1>Hando — bàn tay giúp bạn một tay</h1>
<p class="muted">Bàn tay vector (SVG) có hai phong cách: <b>2D</b> phẳng, nét sạch (hợp biểu tượng nhỏ) và <b>3D</b> kiểu đất sét (tạo khối bằng ánh sáng SVG, vẫn là vector). Mỗi phong cách có 7 chuyển động; cánh tay có còng cam (màu "do"), dấu tích trong lòng bàn tay là "xong việc". Chuyển động tự tắt khi hệ điều hành bật "giảm chuyển động".</p>
<h2>Không nền (đặt lên mọi nền)</h2><div class="grid">{free}</div>
<h2>Biểu tượng ứng dụng (trên ô vuông xanh)</h2><div class="grid">{cards}</div>
<h2>Cỡ nhỏ</h2><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">
<figure><img src="hand-2d-static.svg" width="64" height="64" alt=""><img src="hand-2d-static.svg" width="32" height="32" alt=""><img src="hand-2d-static.svg" width="16" height="16" alt=""><figcaption>2D · 64 / 32 / 16 px</figcaption></figure>
<figure><img src="hand-3d-static.svg" width="64" height="64" alt=""><img src="hand-3d-static.svg" width="32" height="32" alt=""><img src="hand-3d-static.svg" width="16" height="16" alt=""><figcaption>3D · 64 / 32 / 16 px</figcaption></figure></div>
</main></body></html>
"""


def main():
    n = 0
    for style in ("2d", "3d"):
        for a in ANIM:
            open(os.path.join(HERE, f"hand-{style}-{a}.svg"), "w", encoding="utf-8").write(hand_svg(style, a, bg=True, size=512))
            open(os.path.join(HERE, f"hand-free-{style}-{a}.svg"), "w", encoding="utf-8").write(hand_svg(style, a, bg=False, size=340))
            n += 2
    open(os.path.join(HERE, "hand-gallery.html"), "w", encoding="utf-8").write(gallery())
    # biểu tượng nhỏ nhúng thẳng vào giao diện (id có tiền tố để không đụng id khác trong trang)
    mini = hand_svg("2d", "static", bg=False, size=64)
    mini = re.sub(r'<style>.*?</style>', "", mini, flags=re.S).replace('id="', 'id="hm-').replace("url(#", "url(#hm-")
    ts = os.path.join(HERE, "..", "..", "packages", "ui", "src", "brand-mark.generated.ts")
    open(ts, "w", encoding="utf-8").write("// Sinh bởi docs/brand/build_hand.py — KHÔNG sửa tay.\nexport const BRAND_MARK_SVG = " + json.dumps(mini, ensure_ascii=False) + ";\n")
    print("OK", n, "tệp SVG + hand-gallery.html")


if __name__ == "__main__":
    main()
