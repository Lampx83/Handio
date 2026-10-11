#!/usr/bin/env python3
"""Tách nền tranh "tay rô-bốt gõ phím + cầm chuột" (nền bàn cờ giả, tay trắng trên nền gần trắng) thành các lớp có kênh trong suốt:
  handio-work.png        cả tranh (bàn phím + chuột + hai tay) trên nền trong suốt
  handio-work-left.webp  tay trái + cánh tay        (cùng khung 1536x1000, để dựng chuyển động)
  handio-work-right.webp chuột + tay phải + cánh tay
Cách cắt:
  - nền = các điểm xám trung tính nối với mép trên/trái/phải (không gieo từ mép dưới, nơi cánh tay bị cắt) + các mảng nền kín có ô bàn cờ;
  - bóc viền sáng 1–2 px sát mép; tay trái = vùng sáng/đèn xanh/vòng khớp tối, loại bàn phím; cánh tay lấy lại bằng hình bao lồi;
  - mép mềm (làm mờ 0,7 px rồi co nhẹ) để không còn viền trắng khi đặt lên nền tối.
Chạy (ngoài các phụ thuộc của dự án): python3 -m pip install numpy scipy pillow
  python3 docs/brand/cutout_work.py <anh-goc.png>"""
import os, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
IMG = sys.argv[1]
im=np.asarray(Image.open(IMG).convert('RGB')).astype(int)
# nội dung kết thúc ở y≈1000; dải dưới là viền trắng của ảnh
rows=np.where((np.abs(im[:,:,2]-im[:,:,0])>8).sum(axis=1)>20)[0]
Hc=int(rows.max())+1
im=im[:Hc]; H,W,_=im.shape
r,g,b=im[...,0],im[...,1],im[...,2]
chroma=np.maximum.reduce([abs(b-r),abs(b-g),abs(r-g)])
neutral=(chroma<=4)&(im.min(axis=2)>=205)
lab,n=ndi.label(neutral)
# gieo từ các mép trên/trái/phải (mép dưới là chỗ cánh tay bị cắt: không gieo, tránh rò vào cánh tay)
seed=set(np.unique(np.concatenate([lab[0],lab[:,0],lab[:,-1]])))-{0}
bg=np.isin(lab,list(seed))
# các mảng nền kín (giữa ngón cái và lòng bàn tay…): có ô xám nhạt của bàn cờ
for i in range(1,n+1):
    if i in seed: continue
    m=lab==i
    if m.sum()<20: continue
    v=im[...,0][m]
    if ((v>=230)&(v<=247)).mean()>=0.12: bg|=m
# bóc viền sáng 1–2 px còn dính ở mép ngoài (pha giữa viền xanh và bàn cờ)
for _ in range(2):
    edge=ndi.binary_dilation(bg)&~bg
    halo=edge&(im.min(axis=2)>=214)&(chroma<=12)
    bg|=halo
fg=~bg
# bàn tay trái: dùng mặt nạ "tay" (trắng/xanh/đèn/khớp tối) để loại bàn phím
cyan=(b>190)&(r<130)&(g>110)&(g-r>40)
bright=(im.min(axis=2)>=175)&fg
dark=(im.max(axis=2)<115)
hand=bright|cyan|(dark&ndi.binary_dilation(cyan,iterations=14))
hand=ndi.binary_closing(hand,iterations=2)
L=hand.copy(); L[:,700:]=False
light=(r>=125)&(b>=195)&fg
L=L|(light&ndi.binary_dilation(L,iterations=5))
L=ndi.binary_closing(L,iterations=3)
L=ndi.binary_fill_holes(L)
L&=fg
lab2,n2=ndi.label(L); sizes=ndi.sum(L,lab2,range(1,n2+1))
L=np.isin(lab2,[i+1 for i,s in enumerate(sizes) if s>1500])
R=fg.copy(); R[:,:1070]=False
R=ndi.binary_closing(R,iterations=2)&fg
lab3,n3=ndi.label(R); s3=ndi.sum(R,lab3,range(1,n3+1))
R=np.isin(lab3,[i+1 for i,s in enumerate(s3) if s>3000])
# cánh tay trái (hình lồi): dải trắng tinh bị nền "rò" vào qua đầu trên → lấy lại bằng hình bao lồi của các điểm SÁNG của cánh tay
from scipy.spatial import ConvexHull
lightpix=L&~dark&~cyan
lightpix[:745,:]=False; lightpix[:,430:]=False
ys,xs=np.nonzero(lightpix)
if len(xs)>100:
    pts=np.column_stack([xs,ys]); hull=pts[ConvexHull(pts).vertices]
    hm=Image.new('L',(W,H),0); ImageDraw.Draw(hm).polygon([tuple(p) for p in hull],fill=255)
    add=(np.asarray(hm)>0)&~L
    yy,xx=np.mgrid[0:H,0:W]
    limit=np.where(yy<800,372.0,372.0+(yy-800)*(33/80))  # mép phải của cánh tay: loại mảng nền bàn cờ lọt giữa cánh tay và vòng khớp
    L=L|(add&(xx<limit))
# làm sạch các mảnh tối lẻ bám mép ngón (bóng bàn phím): mở 2 px rồi đóng 1 px
Lc=ndi.binary_opening(L,structure=np.ones((3,3)),iterations=2)
L=ndi.binary_closing(Lc,iterations=1)&(L|ndi.binary_dilation(Lc,iterations=1))
# bóng tối mỏng bám mép ngón (khe giữa các ngón/bóng bàn phím) bị bỏ; vòng khớp dày thì giữ
yy0,xx0=np.mgrid[-4:5,-4:5]; disk=(xx0**2+yy0**2)<=16
Lbefore=L.copy()
darkL=L&dark
keepDark=ndi.binary_opening(darkL,structure=disk)
# giữ lại phần tối liên thông với vùng sáng của khớp (vòng khớp nằm kẹp giữa hai đốt)
L=(L&~dark)|keepDark
L=ndi.binary_closing(L,iterations=1)&(L|ndi.binary_dilation(L,iterations=1))
L[650:]=Lbefore[650:]  # vòng khớp cổ tay (mảnh) giữ nguyên
wrist=np.zeros_like(L); wrist[690:845,190:480]=True
L=L|(wrist&fg)  # vùng cổ tay: mọi điểm không phải nền là của rô-bốt (không có bàn phím ở đây)
def fill_small(m, maxarea=200):
    inv=~m; lab,n=ndi.label(inv)
    sizes=ndi.sum(inv,lab,range(1,n+1))
    border=set(np.unique(np.concatenate([lab[0],lab[-1],lab[:,0],lab[:,-1]])))
    for i,sz in enumerate(sizes,1):
        if sz<=maxarea and i not in border: m=m|(lab==i)
    return m
L=fill_small(L); R=fill_small(R)
def drop_small(m, minarea=700):
    lab,n=ndi.label(m); sizes=ndi.sum(m,lab,range(1,n+1))
    return np.isin(lab,[i+1 for i,sz in enumerate(sizes) if sz>=minarea])
L=drop_small(L); R=drop_small(R)



# ---------------------------------------------------------------- xuất các lớp có kênh trong suốt
def soft(mask):
    """Mặt nạ nhị phân → alpha mềm 0..255 (làm mờ rồi co nhẹ để mép sạch)."""
    a = ndi.gaussian_filter(mask.astype(float), 0.7)
    return (np.clip((a - 0.4) / 0.4, 0, 1) * 255).astype(np.uint8)


rgb = im.astype(np.uint8)
full = fg | L | R
lab_f, n_f = ndi.label(full)
full = np.isin(lab_f, [i + 1 for i, sz in enumerate(ndi.sum(full, lab_f, range(1, n_f + 1))) if sz >= 1000])  # bỏ chấm lẻ
for m_ in (full, L, R):
    m_[-2:, :] = False  # hai hàng cuối là viền cắt của ảnh gốc (có điểm tối)
def save(mask, name, **kw):
    out = np.dstack([rgb, soft(mask)])
    img = Image.fromarray(out, "RGBA")
    img.save(os.path.join(HERE, name), **kw)
    print("OK", name, os.path.getsize(os.path.join(HERE, name)) // 1024, "KB")


save(full, "handio-work.png", optimize=True)
save(L, "handio-work-left.webp", quality=92, alpha_quality=100, method=6)
save(R, "handio-work-right.webp", quality=92, alpha_quality=100, method=6)
