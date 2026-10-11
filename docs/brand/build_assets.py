#!/usr/bin/env python3
"""Dựng chữ Handio (wordmark), logo ngang và banner, rồi CHÉP biểu tượng bàn tay đã chọn vào nơi ứng dụng dùng.
Bàn tay vector (2D/3D, chuyển động) do build_hand.py dựng; PNG do render.html + serve-render.py dựng (xem BRAND.md).
Chạy: python3 docs/brand/build_assets.py [--style 3d|2d]   (cần Pillow cho banner)"""
import os, shutil
from PIL import Image, ImageDraw, ImageFont, ImageChops

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
BLUE, BLUE2, DEEP, ORANGE, INK, PAPER = "#0B4A9E", "#1B7FD0", "#083A7D", "#F59E0B", "#1F2328", "#F6F6F3"

# ---------------------------------------------------------------- chữ "Handio": nét đều, đầu tròn; "io" màu cam (hand + I/O: giao việc vào, nhận kết quả ra)
def wordmark_paths():
    """Trả về (danh sách phần tử SVG, rộng, cao) trong hệ toạ độ cao 100, nét 14."""
    sw = 14
    x = 7
    parts = []

    def line(x1, y1, x2, y2, c):
        parts.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{c}"/>')

    def circle(cx, cy, r, c):
        parts.append(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="{c}"/>')
    blue = "currentColor"
    # H
    line(x, 7, x, 93, blue); line(x + 54, 7, x + 54, 93, blue); line(x, 50, x + 54, 50, blue)
    x += 54 + 26
    # a
    circle(x + 26, 67, 26, blue); line(x + 52, 41, x + 52, 93, blue)
    x += 52 + 26
    # n
    line(x, 41, x, 93, blue)
    parts.append(f'<path d="M{x} 62 C{x} 36 {x + 52} 36 {x + 52} 62 L{x + 52} 93" fill="none" stroke="{blue}"/>')
    x += 52 + 26
    # d
    circle(x + 26, 67, 26, blue); line(x + 52, 7, x + 52, 93, blue)
    x += 52 + 26
    # i (màu cam từ đây: "io"): thân + chấm
    line(x, 41, x, 93, ORANGE); line(x, 14, x, 14.01, ORANGE)
    x += 26
    # o
    circle(x + 26, 67, 26, ORANGE)
    x += 52 + 7
    return parts, x, 100, sw


def wordmark_svg(color="#0B4A9E", height=100):
    parts, w, h, sw = wordmark_paths()
    inner = "".join(parts)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" height="{height}" width="{round(w * height / h)}" role="img" aria-label="Handio" color="{color}">'
            f'<g stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round">{inner}</g></svg>\n')


def horizontal_svg(style="3d", color="#0B4A9E"):
    parts, w, h, sw = wordmark_paths()
    hand = open(os.path.join(HERE, f"hand-{style}-static.svg"), encoding="utf-8").read()
    inner = hand.split(">", 1)[1].rsplit("</svg>", 1)[0]  # bỏ thẻ <svg> ngoài, giữ defs + hình
    scale = 0.9
    total_w = 120 + 28 + w * scale
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {round(total_w)} 120" height="120" width="{round(total_w)}" role="img" aria-label="Handio — giúp bạn một tay" color="{color}">'
            f'<svg x="0" y="0" width="120" height="120" viewBox="0 0 1024 1024">{inner}</svg>'
            f'<g transform="translate(148 {round((120 - 100 * scale) / 2)}) scale({scale})" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round">{"".join(parts)}</g></svg>\n')


def draw_wordmark(img, x0, y0, height, color, accent):
    """Vẽ chữ Handio bằng PIL (khớp wordmark_paths)."""
    d = ImageDraw.Draw(img)
    k = height / 100.0
    sw = max(1, round(14 * k))

    def L(x1, y1, x2, y2, c):
        d.line([(x0 + x1 * k, y0 + y1 * k), (x0 + x2 * k, y0 + y2 * k)], fill=c, width=sw)
        for px, py in ((x1, y1), (x2, y2)):
            d.ellipse([x0 + px * k - sw / 2, y0 + py * k - sw / 2, x0 + px * k + sw / 2, y0 + py * k + sw / 2], fill=c)

    def C(cx, cy, r, c):
        d.ellipse([x0 + (cx - r) * k - sw / 2, y0 + (cy - r) * k - sw / 2, x0 + (cx + r) * k + sw / 2, y0 + (cy + r) * k + sw / 2], outline=c, width=sw)

    x = 7
    L(x, 7, x, 93, color); L(x + 54, 7, x + 54, 93, color); L(x, 50, x + 54, 50, color)
    x += 80
    C(x + 26, 67, 26, color); L(x + 52, 41, x + 52, 93, color)
    x += 78
    L(x, 41, x, 93, color)
    # vòm chữ n: xấp xỉ bằng cung tròn
    d.arc([x0 + (x) * k - sw / 2, y0 + 36 * k, x0 + (x + 52) * k + sw / 2, y0 + 88 * k], 180, 360, fill=color, width=sw)
    L(x + 52, 62, x + 52, 93, color)
    x += 78
    C(x + 26, 67, 26, color); L(x + 52, 7, x + 52, 93, color)
    x += 78
    L(x, 41, x, 93, accent); L(x, 14, x, 14.01, accent)
    x += 26
    C(x + 26, 67, 26, accent)
    return x0 + (x + 59) * k


def banner(path, style, w=1200, h=630):
    img = Image.new("RGBA", (w, h))
    d = ImageDraw.Draw(img)
    c1, c2 = (5, 32, 70), (10, 62, 130)
    for y in range(h):
        t = y / (h - 1)
        d.line([(0, y), (w, y)], fill=tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3)) + (255,))
    icon = Image.open(os.path.join(HERE, f"app-icon-{style}-512.png")).convert("RGBA").resize((330, 330), Image.LANCZOS)
    img.alpha_composite(icon, (80, 150))
    end = draw_wordmark(img, 450, 215, 130, (255, 255, 255), (245, 158, 11))
    try:
        f1 = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 46)
        f2 = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 30)
    except OSError:
        f1 = f2 = ImageFont.load_default()
    d = ImageDraw.Draw(img)
    d.text((454, 380), "Giúp bạn một tay.", font=f1, fill=(255, 255, 255))
    d.text((456, 450), "Làm việc văn phòng · Viết mã · Thiết kế", font=f2, fill=(205, 225, 250))
    d.text((456, 540), "Khoa Công nghệ thông tin · Trường Đại học Kinh tế Quốc dân", font=ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 24) if f1 != ImageFont.load_default() else f2, fill=(180, 205, 240))
    img.convert("RGB").save(path, "PNG", optimize=True)


def main():
    import sys
    style = "2d" if "--style" in sys.argv and sys.argv[sys.argv.index("--style") + 1] == "2d" else "3d"
    w = lambda name, text: open(os.path.join(HERE, name), "w", encoding="utf-8").write(text)
    w("wordmark.svg", wordmark_svg("#0B4A9E"))
    w("wordmark-white.svg", wordmark_svg("#FFFFFF"))
    w("logo-horizontal.svg", horizontal_svg(style, "#0B4A9E"))
    banner(os.path.join(HERE, "banner-1200x630.png"), style)
    cp = lambda src, dst: (os.makedirs(os.path.dirname(dst), exist_ok=True), shutil.copy(os.path.join(HERE, src), dst))
    cp(f"app-icon-{style}-1024.png", os.path.join(ROOT, "apps/desktop/build/icon.png"))
    cp(f"hand-{style}-static.svg", os.path.join(ROOT, "apps/desktop/build/icon.svg"))
    cp(f"app-icon-{style}-192.png", os.path.join(ROOT, "apps/web/icon-192.png"))
    cp(f"app-icon-{style}-512.png", os.path.join(ROOT, "apps/web/icon-512.png"))
    cp(f"hand-{style}-static.svg", os.path.join(ROOT, "apps/web/icon.svg"))
    gp = os.path.join(ROOT, "deploy/220/guide-public/img")
    cp(f"hand-{style}-static.svg", os.path.join(gp, "handio-mark.svg"))
    cp(f"hand-{style}-wave.svg", os.path.join(gp, "handio-wave.svg"))
    cp("banner-1200x630.png", os.path.join(gp, "handio-banner.png"))
    print("OK, phong cách:", style)


if __name__ == "__main__":
    main()
