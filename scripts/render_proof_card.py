#!/usr/bin/env python3
"""LTX-QUASAR — render journey proof card.

1080x1350 (4:5) canvas, dark surface. The NUMBER is the subject: the handle
is a small byline, the metrics are the hero. Values are left-aligned with
their labels so the eye runs down one axis, and the canvas height is
computed from the content instead of being padded with dead space.

Every metric carries its unit, and the blocks are separated by a hairline so
the card groups into four readable units instead of one long run of text.

Usage: render_proof_card.py <stats.json> <out.png>
"""
import json, sys
from PIL import Image, ImageDraw, ImageFont

W, H = 1080, 1350
PAD = 80
UNIT_X = 250   # fixed secondary column for the unit text

FG = (250, 250, 250)
DIM = (172, 172, 172)
FAINT = (140, 140, 140)
VALUE = (255, 255, 255)
RULE = (48, 48, 48)
SURFACE = (14, 14, 14)

FB = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FR = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
_cache = {}


def font(size, bold=False):
    key = (size, bold)
    if key not in _cache:
        _cache[key] = ImageFont.truetype(FB if bold else FR, size)
    return _cache[key]


def build_legs(s):
    """Label, value, and the unit that tells the reader what it counts."""
    active_day = s.get("activeDay")
    return [
        ("TOTAL PRODUK", str(s.get("products", "")), "link aktif"),
        ("KATEGORI", str(s.get("categories", "")), "kelas produk"),
        ("KONTEN TERBIT", str(s.get("postsPublished", "")), "telah tayang"),
        ("HARI AKTIF", str(s.get("daysActive", "")), "dari %d hari" % active_day if active_day else ""),
    ]


def main():
    stats = json.load(open(sys.argv[1]))
    out = sys.argv[2]

    legs = [(l, v, u) for l, v, u in build_legs(stats) if v]

    img = Image.new("RGB", (W, H), SURFACE)
    d = ImageDraw.Draw(img)

    # ---- byline: small, so the numbers own the card ----
    y = PAD
    d.text((PAD, y), stats.get("handle", ""), font=font(42, True), fill=FG)
    y += 54
    d.text((PAD, y), stats.get("period", ""), font=font(30), fill=DIM)
    y += 54
    d.rectangle((PAD, y, W - PAD, y + 2), fill=RULE)
    y += 40

    # ---- metric blocks: label, value+unit, hairline between blocks ----
    LABEL_GAP = 6      # label -> value, tight inside a block
    INNER_GAP = 30     # value -> next block's label, the in-block rhythm
    BLOCK_GAP = 46     # hairline -> next label, the between-block rhythm

    for i, (label, value, unit) in enumerate(legs):
        d.text((PAD, y), label, font=font(29), fill=DIM)
        y += 42 + LABEL_GAP
        d.text((PAD, y), value, font=font(78, True), fill=VALUE)
        if unit:
            # fixed secondary column, so the units align down the card
            # regardless of how wide each number is
            d.text((PAD + UNIT_X, y + 40), unit, font=font(29), fill=FAINT)
        y += 78 + INNER_GAP
        if i < len(legs) - 1:
            d.rectangle((PAD, y, W - PAD, y + 1), fill=RULE)
            y += BLOCK_GAP

    # ---- footer: rule sits right under the last block ----
    fy = y - 24
    d.rectangle((PAD, fy, W - PAD, fy + 2), fill=RULE)
    d.text((PAD, fy + 22), "angka dari dashboard internal · bukan klaim penjualan",
           font=font(27), fill=FAINT)

    # ---- crop the canvas to what was actually drawn ----
    content_bottom = fy + 78
    canvas_h = min(H, content_bottom + PAD)

    out_img = img.crop((0, 0, W, canvas_h))
    out_img.save(out)
    print("rendered %s (%dx%d)" % (out, W, canvas_h))


if __name__ == "__main__":
    main()
