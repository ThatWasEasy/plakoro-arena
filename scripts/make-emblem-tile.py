#!/usr/bin/env python3
"""Build the repeating mascot tile used as the main screen's background.

Run: npm run make-emblem-tile

Two things are baked into the image rather than done in CSS, and this script is why:

  - The tilt. A CSS rotation turns the whole lattice, which drags the drift direction along
    with it — the mascots and the travel would stop being independent. Rotating the artwork
    here leaves the lattice square, so the drift can be a true 45° in screen space.
  - The gap. `background-size` sets the drawn size and the repeat period at once, so CSS
    cannot space a repeating background at all. The breathing room has to be transparent
    pixels in the image.
  - The stagger. One cell holds two mascots, at a quarter and three quarters along both axes,
    so every other row lands half a step across — a brick course instead of a grid. A second
    offset background layer would do the same thing and cost a second layer.

Stdlib only — no Pillow on this machine. The PNG reader handles the 8-bit non-interlaced
subset the source happens to be, which is all it ever has to.
"""
import math
import struct
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE.parent / 'src' / 'assets' / 'gray-plakoro-mascot-emblem.png'
OUT = HERE.parent / 'src' / 'assets' / 'gray-plakoro-mascot-emblem-tile.png'

# Counter-clockwise, in screen terms. The emblem's own outline is already diagonal — the row
# of three dots is slanted in the source artwork — so judging this by eye against the original
# is unreliable. To check a change actually landed, compare the alpha mask's principal axis
# (image moments) rather than looking for a feature that was never straight to begin with.
ANGLE_DEG = -30

# Longest side of the artwork in the finished tile. Only sets the raster's resolution — how
# big a mascot actually appears is `--tile` in ModeSelect.vue.
ART_PX = 150

# Cell ÷ the artwork's longer side. The cell holds two mascets half a step apart, so the
# spacing people actually see is half this — 2.6 puts the nearest neighbour about twice the
# artwork's own size away, measured diagonally.
CELL_RATIO = 2.6


def read_png(path):
    data = path.read_bytes()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', 'not a PNG'
    i, idat, hdr, pal, trns = 8, b'', None, None, None
    while i < len(data):
        length = struct.unpack('>I', data[i:i + 4])[0]
        kind, body = data[i + 4:i + 8], data[i + 8:i + 8 + length]
        i += 12 + length
        if kind == b'IHDR':
            hdr = struct.unpack('>IIBBBBB', body)
        elif kind == b'IDAT':
            idat += body
        elif kind == b'PLTE':
            pal = body
        elif kind == b'tRNS':
            trns = body
        elif kind == b'IEND':
            break

    w, h, depth, ctype, _, _, interlace = hdr
    assert depth == 8 and interlace == 0, f'unsupported PNG: depth={depth} interlace={interlace}'
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ctype]
    raw = zlib.decompress(idat)

    # Undo the per-scanline filters.
    rows, prev, pos = [], bytearray(w * channels), 0
    for _ in range(h):
        f = raw[pos]
        pos += 1
        line = bytearray(raw[pos:pos + w * channels])
        pos += w * channels
        for x in range(len(line)):
            a = line[x - channels] if x >= channels else 0
            b = prev[x]
            c = prev[x - channels] if x >= channels else 0
            if f == 1:
                line[x] = (line[x] + a) & 255
            elif f == 2:
                line[x] = (line[x] + b) & 255
            elif f == 3:
                line[x] = (line[x] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(line)
        prev = line

    # Everything becomes RGBA, so the rest of the script has one case to think about.
    px = bytearray(w * h * 4)
    for y in range(h):
        line = rows[y]
        for x in range(w):
            if ctype == 6:
                r, g, b, a = line[x * 4:x * 4 + 4]
            elif ctype == 2:
                r, g, b = line[x * 3:x * 3 + 3]
                a = 255
            elif ctype == 4:
                r = g = b = line[x * 2]
                a = line[x * 2 + 1]
            elif ctype == 0:
                r = g = b = line[x]
                a = 255
            else:
                idx = line[x]
                r, g, b = pal[idx * 3:idx * 3 + 3]
                a = trns[idx] if trns and idx < len(trns) else 255
            o = (y * w + x) * 4
            px[o:o + 4] = bytes((r, g, b, a))
    return w, h, px


def write_png(path, w, h, px):
    raw = b''.join(b'\x00' + bytes(px[y * w * 4:(y + 1) * w * 4]) for y in range(h))

    def chunk(kind, body):
        c = kind + body
        return struct.pack('>I', len(body)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

    path.write_bytes(
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
        + chunk(b'IDAT', zlib.compress(raw, 9))
        + chunk(b'IEND', b'')
    )


def opaque_bounds(w, h, px):
    """The artwork's real extent. The source is mostly empty margin, and padding measured from
    the canvas instead of from the shape would make the gap whatever the export happened to
    leave behind."""
    x0, y0, x1, y1 = w, h, -1, -1
    for y in range(h):
        for x in range(w):
            if px[(y * w + x) * 4 + 3] > 8:
                x0, y0 = min(x0, x), min(y0, y)
                x1, y1 = max(x1, x), max(y1, y)
    return x0, y0, x1, y1


def scale(w, h, px, longest):
    f = longest / max(w, h)
    nw, nh = max(1, round(w * f)), max(1, round(h * f))
    out = bytearray(nw * nh * 4)
    for y in range(nh):
        sy = min(h - 1, int(y / f))
        for x in range(nw):
            sx = min(w - 1, int(x / f))
            o, s = (y * nw + x) * 4, (sy * w + sx) * 4
            out[o:o + 4] = px[s:s + 4]
    return nw, nh, out


def rotate(w, h, px, degrees):
    """Bilinear, sampling backwards from each destination pixel — forwards would leave holes."""
    rad = math.radians(degrees)
    ca, sa = math.cos(rad), math.sin(rad)
    rw = int(math.ceil(w * abs(ca) + h * abs(sa)))
    rh = int(math.ceil(w * abs(sa) + h * abs(ca)))
    out = bytearray(rw * rh * 4)
    cx, cy = (w - 1) / 2, (h - 1) / 2
    for ry in range(rh):
        for rx in range(rw):
            dx, dy = rx - (rw - 1) / 2, ry - (rh - 1) / 2
            sx, sy = cx + dx * ca + dy * sa, cy - dx * sa + dy * ca
            ix, iy = math.floor(sx), math.floor(sy)
            if ix < 0 or iy < 0 or ix >= w - 1 or iy >= h - 1:
                continue
            fx, fy = sx - ix, sy - iy
            o = (ry * rw + rx) * 4
            for c in range(4):
                p00 = px[(iy * w + ix) * 4 + c]
                p10 = px[(iy * w + ix + 1) * 4 + c]
                p01 = px[((iy + 1) * w + ix) * 4 + c]
                p11 = px[((iy + 1) * w + ix + 1) * 4 + c]
                out[o + c] = int((p00 * (1 - fx) + p10 * fx) * (1 - fy)
                                 + (p01 * (1 - fx) + p11 * fx) * fy + 0.5)
    return rw, rh, out


def blit_wrapped(dst, cell, art, aw, ah, cx, cy):
    """Draw the artwork centred on (cx, cy), wrapping at the edges.

    Wrapping is what lets a mascot sit near a border without being clipped: the part that runs
    off one side reappears on the other, which is exactly where the neighbouring tile will put
    it anyway. Source-over, so the two copies in a cell cannot leave a hard seam if they ever
    do touch."""
    for y in range(ah):
        dy = (cy - ah // 2 + y) % cell
        for x in range(aw):
            sa = art[(y * aw + x) * 4 + 3]
            if not sa:
                continue
            dx = (cx - aw // 2 + x) % cell
            s, d = (y * aw + x) * 4, (dy * cell + dx) * 4
            if sa == 255:
                dst[d:d + 4] = art[s:s + 4]
                continue
            a = sa / 255
            for c in range(3):
                dst[d + c] = int(art[s + c] * a + dst[d + c] * (1 - a) + 0.5)
            dst[d + 3] = min(255, dst[d + 3] + sa)


def crop(w, h, px, x0, y0, x1, y1):
    cw, ch = x1 - x0 + 1, y1 - y0 + 1
    out = bytearray(cw * ch * 4)
    for y in range(ch):
        s = ((y + y0) * w + x0) * 4
        out[y * cw * 4:(y + 1) * cw * 4] = px[s:s + cw * 4]
    return cw, ch, out


def main():
    w, h, px = read_png(SRC)
    w, h, px = crop(w, h, px, *opaque_bounds(w, h, px))
    w, h, px = scale(w, h, px, ART_PX)
    w, h, px = rotate(w, h, px, ANGLE_DEG)
    # Cropped again after rotating: the rotation's own canvas is the corner-to-corner box, and
    # padding from that would wrap the gap around empty space the shape never reaches into.
    w, h, px = crop(w, h, px, *opaque_bounds(w, h, px))

    # Forced even. The two mascots sit at the quarter marks, and the drift relies on half a
    # cell mapping one onto the other exactly — with an odd cell the quarters round to a
    # half-pixel apart, the shift stops being a symmetry, and every loop ends in a visible jump.
    cell = round(max(w, h) * CELL_RATIO) // 2 * 2
    out = bytearray(cell * cell * 4)
    # Quarter and three-quarters along both axes. Rows then sit half a cell apart vertically
    # and half a cell apart horizontally — the offset course. Keeping the cell square also
    # keeps (-cell/2, +cell/2) a symmetry of the pattern, which is what lets the drift run at a
    # true 45° and still loop seamlessly.
    blit_wrapped(out, cell, px, w, h, cell // 4, cell // 4)
    blit_wrapped(out, cell, px, w, h, cell * 3 // 4, cell * 3 // 4)

    write_png(OUT, cell, cell, out)
    step = cell // 2
    print(f'{OUT.name}: {cell}x{cell} holding 2 mascots, artwork {w}x{h} at {ANGLE_DEG}°, '
          f'nearest neighbour {step}px apart diagonally, {OUT.stat().st_size / 1024:.1f}KB')


if __name__ == '__main__':
    main()
