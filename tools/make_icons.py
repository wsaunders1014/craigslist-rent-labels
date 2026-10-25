"""Render the Rent Labels icon as PNGs with no image libraries.

Shapes are defined in a 128-unit design space and rasterized with 4x4
supersampling for anti-aliasing. Usage: python3 tools/make_icons.py icons
"""
import math, os, struct, sys, zlib

PURPLE = (117, 67, 163)
PURPLE_DARK = (72, 34, 111)
WHITE = (255, 255, 255)
YELLOW = (255, 196, 57)


def rounded_rect(x, y, x0, y0, x1, y1, r):
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r and x0 <= x <= x1 and y0 <= y <= y1


def triangle(x, y, a, b, c):
    def side(p, q):
        return (x - q[0]) * (p[1] - q[1]) - (p[0] - q[0]) * (y - q[1])
    d1, d2, d3 = side(a, b), side(b, c), side(c, a)
    neg = d1 < 0 or d2 < 0 or d3 < 0
    pos = d1 > 0 or d2 > 0 or d3 > 0
    return not (neg and pos)


def circle(x, y, cx, cy, r):
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def color_at(x, y):
    """Color at a point in 128-unit design space, or None for transparent."""
    if not rounded_rect(x, y, 4, 4, 124, 124, 26):
        return None
    color = PURPLE
    # White map label with a tail pointing at the location.
    if rounded_rect(x, y, 20, 30, 108, 82, 14) or triangle(x, y, (52, 80), (76, 80), (64, 100)):
        color = WHITE
        # Two lines of "text": price, then bedrooms.
        if rounded_rect(x, y, 34, 43, 94, 53, 5) or rounded_rect(x, y, 34, 60, 76, 69, 4.5):
            color = PURPLE_DARK
    # Flag dot for possible rooms.
    if circle(x, y, 101, 31, 14):
        color = YELLOW if circle(x, y, 101, 31, 11) else PURPLE
    return color


def render(size, samples=4, pad=0):
    """pad: transparent pixels on each side (the Web Store wants 16 at 128 px)."""
    rows = []
    scale = 128 / (size - 2 * pad)
    for py in range(size):
        row = bytearray([0])  # PNG filter type 0
        for px in range(size):
            r = g = b = a = 0
            for sy in range(samples):
                for sx in range(samples):
                    x = (px - pad + (sx + 0.5) / samples) * scale
                    y = (py - pad + (sy + 0.5) / samples) * scale
                    c = color_at(x, y)
                    if c:
                        r += c[0]; g += c[1]; b += c[2]; a += 1
            n = samples * samples
            if a:
                row += bytes((round(r / a), round(g / a), round(b / a), round(255 * a / n)))
            else:
                row += bytes(4)
        rows.append(bytes(row))
    return b''.join(rows)


def png(size, pixels):
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    header = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header) + chunk(b'IDAT', zlib.compress(pixels, 9)) + chunk(b'IEND', b'')


if __name__ == '__main__':
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    for size in (16, 32, 48, 128):
        with open(os.path.join(out, f'icon{size}.png'), 'wb') as f:
            f.write(png(size, render(size, samples=8 if size <= 32 else 4, pad=16 if size == 128 else 0)))
    print('wrote', out)
