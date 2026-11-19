#!/usr/bin/env python3
"""Generate the full icon package from the approved mascot artwork.

Source:  brand/mascot-source-1024.png  (transparent 1024x1024 mascot, supplied by the project owner)
Output:  public/  (copied verbatim into dist/ by Vite)

Nothing is redrawn: every raster is a resampled crop of the source art, the SVG is a colour trace of the same
crop.  Run:  python3 scripts/make-icons.py   (needs Pillow; `pip install vtracer` for the SVG trace)
"""
import io, math, os, re, struct, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'brand', 'mascot-source-1024.png')
OUT = os.path.join(ROOT, 'public')
BG = (221, 248, 239, 255)          # pale mint-green, the brand background (#DDF8EF)
BG_HEX = '#DDF8EF'

src = Image.open(SRC).convert('RGBA')
assert src.size == (1024, 1024), src.size
bbox = src.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox()   # tight art bounds incl. shadow
art = src.crop(bbox)

# "Head" crop: body, antenna triangle and both arms, without legs/shadow -> reads better at 16-48 px.
HEAD_BOX = (20, 30, 985, 757)
head = src.crop(HEAD_BOX)

def paste_fit(canvas, im, frac=None, radius_frac=None, dy=0):
    """Centre `im` on `canvas`. frac = max share of canvas side; radius_frac = keep every opaque pixel inside a circle."""
    S = canvas.size[0]
    w, h = im.size
    if radius_frac is not None:
        a = im.getchannel('A').point(lambda v: 255 if v > 8 else 0)
        px = a.load(); cx, cy = w / 2, h / 2; far = 0.0
        step = 2
        for y in range(0, h, step):
            for x in range(0, w, step):
                if px[x, y]:
                    far = max(far, math.hypot(x - cx, y - cy))
        s = (radius_frac * S) / far
    else:
        s = frac * S / max(w, h)
    nw, nh = max(1, round(w * s)), max(1, round(h * s))
    r = im.resize((nw, nh), Image.LANCZOS)
    canvas.alpha_composite(r, ((S - nw) // 2, (S - nh) // 2 + dy))
    return canvas

def solid(size, im, **kw):
    c = Image.new('RGBA', (size, size), BG)
    return paste_fit(c, im, **kw)

def save(img, name, flatten=False):
    p = os.path.join(OUT, name)
    if flatten:                        # Apple touch icons must not contain transparency
        bg = Image.new('RGB', img.size, BG[:3]); bg.paste(img, mask=img.getchannel('A')); img = bg
    img.save(p, 'PNG', optimize=True)
    print('wrote', name, img.size)

os.makedirs(OUT, exist_ok=True)

# ---- master + "any" icons (solid background, mascot ~76% of the canvas) ----
master = solid(1024, art, frac=0.76)
save(master, 'icon-master.png')
for s, n in [(512, 'icon-512.png'), (192, 'icon-192.png')]:
    save(master.resize((s, s), Image.LANCZOS), n)

# ---- Apple touch icons (opaque, iOS rounds the corners itself) ----
for s, n in [(180, 'apple-touch-icon.png'), (167, 'apple-touch-icon-167.png'), (152, 'apple-touch-icon-152.png')]:
    save(master.resize((s, s), Image.LANCZOS), n, flatten=True)

# ---- maskable: full-bleed background, every art pixel inside the 80 % safe-zone circle (r = 0.40) ----
mask_big = solid(1024, art, radius_frac=0.36)       # 0.36 < 0.40 leaves margin for resampling
save(mask_big.resize((512, 512), Image.LANCZOS), 'icon-maskable-512.png')

# ---- favicons: head crop, tighter framing, rounded plate so it reads on dark and light tabs ----
def plate(size, frac, radius_frac=0.22, ss=4):
    S = size * ss
    c = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    from PIL import ImageDraw
    d = ImageDraw.Draw(c)
    d.rounded_rectangle((0, 0, S - 1, S - 1), radius=int(S * radius_frac), fill=BG)
    c = paste_fit(c, head, frac=frac)
    return c.resize((size, size), Image.LANCZOS)

fav = {16: plate(16, 0.96, 0.25), 32: plate(32, 0.94), 48: plate(48, 0.92)}
save(fav[16], 'favicon-16x16.png'); save(fav[32], 'favicon-32x32.png')

# ---- favicon.ico: three PNG-compressed images (16, 32, 48) ----
def build_ico(imgs):
    blobs = []
    for im in imgs:
        b = io.BytesIO(); im.save(b, 'PNG', optimize=True); blobs.append((im.size[0], b.getvalue()))
    head_ = struct.pack('<HHH', 0, 1, len(blobs)); off = 6 + 16 * len(blobs); entries = b''; data = b''
    for w, blob in blobs:
        entries += struct.pack('<BBBBHHII', w % 256, w % 256, 0, 0, 1, 32, len(blob), off + len(data)); data += blob
    return head_ + entries + data
open(os.path.join(OUT, 'favicon.ico'), 'wb').write(build_ico([fav[16], fav[32], fav[48]]))
print('wrote favicon.ico (16,32,48)')

# ---- favicon.svg: colour trace of the head crop on the same rounded plate ----
import vtracer, tempfile
with tempfile.TemporaryDirectory() as td:
    a, b = os.path.join(td, 'head.png'), os.path.join(td, 'head.svg')
    head.save(a)
    vtracer.convert_image_to_svg_py(a, b, colormode='color', hierarchical='stacked', mode='spline',
                                    filter_speckle=6, color_precision=5, layer_difference=28,
                                    corner_threshold=60, length_threshold=6.0, splice_threshold=45, path_precision=1)
    svg = open(b, encoding='utf-8').read()
hw, hh = head.size
paths = re.search(r'<svg[^>]*>(.*)</svg>', svg, re.S).group(1)
paths = re.sub(r'\s+', ' ', paths).strip()
frac = 0.94; s = frac * 64 / max(hw, hh); tx, ty = (64 - hw * s) / 2, (64 - hh * s) / 2
out = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">'
       f'<title>ToonBridge</title><rect width="64" height="64" rx="14" fill="{BG_HEX}"/>'
       f'<g transform="translate({tx:.2f} {ty:.2f}) scale({s:.5f})">{paths}</g></svg>')
open(os.path.join(OUT, 'favicon.svg'), 'w', encoding='utf-8').write(out)
print('wrote favicon.svg', len(out), 'bytes')
