#!/usr/bin/env python3
"""Dựng minh hoạ "Handio đang làm việc": hai tay rô-bốt gõ phím và cầm chuột, có chuyển động.
Hai bàn tay là ảnh gốc đã TÁCH NỀN (handio-work-left.webp, handio-work-right.webp, do cutout_work.py tạo);
bàn phím và chuột là vector dựng lại (phẳng, có đủ phím dưới bàn tay để tay trượt đi vẫn thấy phím; nút giữa chuột thỉnh thoảng sáng).
Chạy: python3 docs/brand/build_work.py   → handio-work.svg (nền trong suốt; chuyển động tự tắt khi bật "giảm chuyển động")."""
import base64, os

HERE = os.path.dirname(os.path.abspath(__file__))
VIEW = (0, 20, 1536, 980)  # x, y, rộng, cao: cánh tay tràn mép dưới và hai bên như tranh gốc
CANVAS = (1536, 1000)
ORANGE = "#F59E0B"          # màu nhấn thương hiệu ("io")
CLICK = (1154, 362)         # đầu ngón trỏ bấm chuột (vòng sóng đi cùng bàn tay phải)

# ---- Bàn phím trong hệ toạ độ của chính nó (nghiêng ANGLE độ so với tranh). Số đo và màu lấy từ tranh gốc.
ANGLE = -9.3
UNITS = 11                    # số cột (đơn vị phím) mỗi hàng
KEY_U0, KEY_U1, KEY_GAP = 93.0, 936.0, 12.0
KEY_V0, KEY_H, KEY_PITCH = 232.0, 52.0, 64.0
LAYOUT = [  # bề rộng mỗi phím theo đơn vị; mỗi hàng cộng đúng UNITS
    [1] * 11,
    [1.5] + [1] * 8 + [1.5],
    [2] + [1] * 8 + [1],
    [1.25] + [1] * 8 + [1.75],
    [1] + [1] * 4 + [3] + [1] * 3,
]
BODY = {"u0": 46, "u1": 982, "v0": 190, "v1": 584, "depth": 12, "rx": 34}      # thân (viền) + độ dày bên dưới
WELL = {"u0": 78, "u1": 950, "v0": 218, "v1": 556, "rx": 16}                  # lòng bàn phím (tối hơn viền)
COLORS = {"depth": "#0F2044", "rim": "#324369", "well": "#16284E", "key": "#5C74A4"}
KEY_RX = 9


def key_rows():
    """[(v, cao, [(u_trái, u_phải), ...])]: lưới đều, cách nhau KEY_GAP."""
    pitch = (KEY_U1 - KEY_U0 + KEY_GAP) / UNITS
    rows = []
    for r, units in enumerate(LAYOUT):
        assert abs(sum(units) - UNITS) < 1e-6, units
        u, spans = KEY_U0, []
        for n in units:
            spans.append((u, u + n * pitch - KEY_GAP))
            u += n * pitch
        rows.append((KEY_V0 + r * KEY_PITCH, KEY_H, spans))
    return rows


def keyboard():
    """(danh sách phần tử SVG, số phím). Mọi phần tử nằm trong <g transform="rotate(ANGLE)">."""
    b, w = BODY, WELL
    parts = [
        f'<rect x="{b["u0"]}" y="{b["v0"]}" width="{b["u1"] - b["u0"] + 4}" height="{b["v1"] - b["v0"] + b["depth"]}" rx="{b["rx"]}" fill="{COLORS["depth"]}"/>',
        f'<rect x="{b["u0"]}" y="{b["v0"]}" width="{b["u1"] - b["u0"]}" height="{b["v1"] - b["v0"]}" rx="{b["rx"]}" fill="{COLORS["rim"]}"/>',
        f'<rect x="{w["u0"]}" y="{w["v0"]}" width="{w["u1"] - w["u0"]}" height="{w["v1"] - w["v0"]}" rx="{w["rx"]}" fill="{COLORS["well"]}"/>',
    ]
    keys = [(u0, v, u1 - u0, h) for (v, h, spans) in key_rows() for (u0, u1) in spans]
    cand = [i for i, (u, v, w_, h) in enumerate(keys) if v < 420 and u < 700]  # phím sáng lên theo nhịp
    pick = {i: n for n, i in enumerate(cand[::2][:14])}
    for i, (u, v, w_, h) in enumerate(keys):
        r = f'<rect x="{u:.1f}" y="{v:.1f}" width="{w_:.1f}" height="{h:.1f}" rx="{KEY_RX}" fill="{COLORS["key"]}"/>'
        parts.append(f'<g class="key" style="--n:{pick[i]}">{r}</g>' if i in pick else r)
    return parts, len(keys)


# ---- Chuột vector (toạ độ của tranh). Nằm DƯỚI bàn tay phải và di chuyển cùng bàn tay.
MOUSE = {
    "body": "M1228 203 C1150 203 1088 258 1086 335 C1085 430 1110 560 1160 650 C1190 705 1245 745 1290 735 C1330 700 1345 560 1346 420 C1347 330 1330 250 1280 218 C1262 208 1245 203 1228 203Z",
    "fill": ("#42568A", "#2A3C69", "#16264E", "#0E1C40"),   # từ trên xuống dưới
}


def mouse():
    stops = "".join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in zip(("0", ".3", ".65", "1"), MOUSE["fill"]))
    return (f'<defs><linearGradient id="mouseG" gradientUnits="userSpaceOnUse" x1="1200" y1="203" x2="1230" y2="740">{stops}</linearGradient></defs>'
            f'<path d="{MOUSE["body"]}" fill="url(#mouseG)"/>'
            '<path d="M1197 206 L1203 246 M1224 346 L1246 410" stroke="#031A42" stroke-width="6" stroke-linecap="round" fill="none"/>'
            '<g transform="rotate(-8 1216 296)"><rect x="1188" y="244" width="56" height="104" rx="28" fill="#0B1A3E"/>'
            '<rect class="wheel" x="1198" y="254" width="36" height="84" rx="18" fill="#5D77A9"/></g>')


def layer(name):
    data = base64.b64encode(open(os.path.join(HERE, name), "rb").read()).decode("ascii")
    return f'<image width="{CANVAS[0]}" height="{CANVAS[1]}" href="data:image/webp;base64,{data}"/>'


def main():
    kb, nkeys = keyboard()
    vx, vy, vw, vh = VIEW
    css = """<style>
.lh{animation:tap 5.6s ease-in-out infinite}
.rh{animation:drag 4.2s ease-in-out infinite}
.key{animation:keydown 2.8s ease-in-out infinite;animation-delay:calc(var(--n) * 0.17s)}
.key rect{animation:keyglow 2.8s ease-in-out infinite;animation-delay:calc(var(--n) * 0.17s)}
.ring{transform-box:fill-box;transform-origin:center;animation:ring 4.2s ease-out infinite;opacity:0}
.wheel{animation:wheel 5.2s ease-in-out infinite}
@keyframes tap{0%,100%{transform:translate(0,0)}4%{transform:translate(0,6px)}8%{transform:translate(0,0)}13%{transform:translate(0,5px)}18%{transform:translate(0,0)}28%{transform:translate(22px,0)}32%{transform:translate(22px,6px)}37%{transform:translate(22px,0)}42%{transform:translate(22px,5px)}47%{transform:translate(22px,0)}58%{transform:translate(-17px,15px)}62%{transform:translate(-17px,21px)}67%{transform:translate(-17px,15px)}72%{transform:translate(-17px,20px)}78%{transform:translate(-17px,15px)}90%{transform:translate(0,0)}}
@keyframes keydown{0%,22%,100%{transform:translateY(0)}6%,12%{transform:translateY(3px)}}
@keyframes keyglow{0%,22%,100%{fill:__KEY__}6%,12%{fill:#8FB8FF}}
@keyframes drag{0%,100%{transform:translate(0,0)}28%{transform:translate(9px,12px)}40%{transform:translate(9px,16px)}46%{transform:translate(9px,12px)}78%{transform:translate(3px,4px)}}
@keyframes wheel{0%,38%,52%,100%{fill:#5D77A9}44%,48%{fill:#7FE9FF}}
@keyframes ring{0%,36%{opacity:0;transform:scale(.2)}40%{opacity:.95;transform:scale(.5)}60%{opacity:0;transform:scale(1.6)}100%{opacity:0}}
@media (prefers-reduced-motion:reduce){.lh,.rh,.key,.key rect,.ring,.wheel{animation:none}}
</style>""".replace("__KEY__", COLORS["key"])
    ring = f'<g class="rh"><circle class="ring" cx="{CLICK[0]}" cy="{CLICK[1]}" r="42" fill="none" stroke="{ORANGE}" stroke-width="9"/></g>'
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vx} {vy} {vw} {vh}" width="{vw // 2}" height="{vh // 2}" role="img" '
           f'aria-label="Handio đang làm việc: một tay rô-bốt gõ phím, một tay rô-bốt cầm chuột">',
           css, f'<g transform="rotate({ANGLE})">', *kb, "</g>",
           '<g class="lh">', layer("handio-work-left.webp"), "</g>",
           '<g class="rh">', mouse(), layer("handio-work-right.webp"), "</g>", ring, "</svg>"]
    text = "\n".join(out) + "\n"
    open(os.path.join(HERE, "handio-work.svg"), "w", encoding="utf-8").write(text)
    print("OK", nkeys, "phím,", len(text.encode("utf-8")) // 1024, "KB")


if __name__ == "__main__":
    main()
