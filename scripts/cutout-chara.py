#!/usr/bin/env python3
"""Cut the character photos out of their white studio background.

The source JPEGs are opaque, which costs more than it looks: a figure on an opaque rectangle
cannot take a shadow (the shadow is cast by the rectangle, not the figure — the handbook shelf
had a grey box behind every cover until that was removed), cannot overlap anything, and on a
printed cover can only be composited with `multiply`, which rules out any light treatment.

Keyed by flooding inwards from the border rather than thresholding the whole image. The
difference matters: 吉利蛋 and 急凍鳥 are largely white, and a global threshold would punch
holes through them. Only white that is *connected to the edge* is background.

    python3 scripts/cutout-chara.py

Writes WebP with alpha to public/image/CHARA-cut/. Re-run when characters are added; existing
files are overwritten, so it is safe to run repeatedly.
"""
import pathlib
import sys

try:
    from PIL import Image, ImageFilter
except ImportError:
    sys.exit('需要 Pillow：python3 -m pip install --user pillow')

SRC = pathlib.Path('public/image/CHARA')
DEST = pathlib.Path('public/image/CHARA-cut')

# Working size. The cover shows the figure at roughly 60px wide on a phone and twice that on a
# desktop; 560 leaves room for a retina screen and for the figure to be enlarged later.
SIZE = 560
# How far from pure white still counts as background. Generous, because the studio paper picks
# up a little grey at the edges of the frame, but well clear of anything painted on a figure.
WHITE = 238
# Softens the key so the cut edge is not a staircase.
FEATHER = 1.1


def background_mask(img):
    """True where the pixel is background: whiteish *and* reachable from the border."""
    w, h = img.size
    px = img.convert('L').load()
    bg = bytearray(w * h)
    stack = []
    for x in range(w):
        for y in (0, h - 1):
            if px[x, y] >= WHITE:
                stack.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if px[x, y] >= WHITE:
                stack.append((x, y))
    while stack:
        x, y = stack.pop()
        if x < 0 or y < 0 or x >= w or y >= h:
            continue
        i = y * w + x
        if bg[i] or px[x, y] < WHITE:
            continue
        bg[i] = 1
        stack.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    return bg


def cut(path, dest):
    img = Image.open(path).convert('RGB')
    if max(img.size) > SIZE:
        img = img.resize((SIZE, round(SIZE * img.height / img.width)), Image.LANCZOS)
    w, h = img.size
    bg = background_mask(img)
    alpha = Image.frombytes('L', (w, h), bytes(0 if b else 255 for b in bg))
    alpha = alpha.filter(ImageFilter.GaussianBlur(FEATHER))
    out = img.convert('RGBA')
    out.putalpha(alpha)
    # Trim to what is actually left, so the figure fills its box instead of floating in the
    # studio's empty margins — which is most of why it looked small on the cover.
    box = out.getbbox()
    if box:
        out = out.crop(box)
    dest.parent.mkdir(parents=True, exist_ok=True)
    out.save(dest, 'WEBP', quality=86, method=6)
    return out.size


def main():
    if not SRC.is_dir():
        sys.exit(f'找不到 {SRC}')
    files = sorted(p for p in SRC.iterdir() if p.suffix.lower() in ('.jpg', '.jpeg', '.png'))
    total_in = total_out = 0
    for f in files:
        dest = DEST / (f.stem + '.webp')
        size = cut(f, dest)
        total_in += f.stat().st_size
        total_out += dest.stat().st_size
        print(f'  {f.stem:12} → {size[0]}x{size[1]}  {dest.stat().st_size / 1024:.0f}KB')
    print(f'\n{len(files)} 張：{total_in / 1048576:.1f}MB → {total_out / 1024:.0f}KB')
    print(f'輸出：{DEST}')


if __name__ == '__main__':
    main()
