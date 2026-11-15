#!/usr/bin/env python3
"""Renders a synthetic Sam's Club-style receipt for the /api/receipt tests.

Plain monospace text with receipt abbreviations, an instant-savings line, a "2 AT 1 FOR" quantity
line, totals, a VISA tender line and a FAKE membership number / phone / card digits (so the tests
can prove none of that is ever echoed back). Everything here is made up.

Writes, next to this script:
  sams-receipt-full.png   the whole receipt
  sams-receipt-1.png      top "screenshot"   (ends a few item lines into the overlap)
  sams-receipt-2.png      bottom "screenshot" (starts with the same few item lines)

Usage: python3 make-receipt.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"

ITEMS = [
    ("980012345 MM CHKN BRST 6.5LB", "17.94 N"),
    ("980045678 MM GRD BF 80/20 5LB", "24.48 N"),
    ("990011223 MM SHRD MOZZ 5LB", "15.98 N"),
    ("    INST SV MM SHRD MOZZ", "3.00-N"),
    ("980077889 MM SPAG 4PK", "5.48 N"),
    ("    2 AT 1 FOR 4.98", ""),
    ("980033221 MM GRN BNS 8CT", "9.96 N"),
    ("980055667 MM FF 6LB", "8.98 N"),
    ("980099001 MM HB BUNS 24CT", "5.98 N"),
    ("980011002 MM SHRD CHED 2.5LB", "9.48 N"),
    ("980022003 MM JSMN RICE 25LB", "19.98 N"),
    ("980033004 MM PNT BTR 2PK", "10.98 N"),
]


def money(s: str) -> float:
    s = s.split()[0]
    neg = s.endswith("-") or s.endswith("-N")
    return -float(s.rstrip("-N").rstrip("-")) if neg else float(s)


def lines() -> list[str]:
    subtotal = round(sum(money(p) for _, p in ITEMS if p), 2)
    tax = round(subtotal * 0.01, 2)
    total = round(subtotal + tax, 2)
    out = [
        "           SAM'S CLUB",
        "     CLUB 6421  ADDISON, IL",
        "      1 FAKE MEADOW RD",
        "      ADDISON IL 60101",
        "        (630) 555-0142",
        "",
        "11/12/26  14:32  TC# 9876 5432 1098",
        "MEMBER # 10123456789012345",
        "",
    ]
    for name, price in ITEMS:
        out.append(f"{name:<31}{price:>9}" if price else name)
    out += [
        "",
        f"{'SUBTOTAL':>31}{subtotal:>9.2f}",
        f"{'TAX 1.000%':>31}{tax:>9.2f}",
        f"{'TOTAL':>31}{total:>9.2f}",
        "",
        f"{'VISA TEND':<31}{total:>9.2f}",
        "VISA XXXXXXXXXXXX4821",
        "APPROVAL # 004211",
        f"{'CHANGE DUE':<31}{0:>9.2f}",
        f"{'INSTANT SAVINGS':<31}{3:>9.2f}",
        "# ITEMS SOLD 11",
        "",
        "   THANK YOU FOR SHOPPING, JEFF B.",
    ]
    return out


def render(text_lines: list[str]) -> Image.Image:
    font = ImageFont.truetype(FONT, 18)
    line_h = 26
    width = 40 * 11 + 48
    img = Image.new("L", (width, line_h * len(text_lines) + 48), 255)
    draw = ImageDraw.Draw(img)
    for i, line in enumerate(text_lines):
        draw.text((24, 24 + i * line_h), line, font=font, fill=20)
    return img


def main() -> None:
    all_lines = lines()
    full = render(all_lines)
    full.save(HERE / "sams-receipt-full.png", optimize=True)
    first_item = all_lines.index(next(l for l in all_lines if "CHKN BRST" in l))
    spag = all_lines.index(next(l for l in all_lines if "MM SPAG" in l))
    ff = all_lines.index(next(l for l in all_lines if "MM FF" in l))
    # Screenshot 1: header through the fries line; screenshot 2: from spaghetti to the end
    # (so SPAG / GRN BNS / FF are in both — the overlap the server must remove).
    render(all_lines[: ff + 1]).save(HERE / "sams-receipt-1.png", optimize=True)
    render(all_lines[spag:]).save(HERE / "sams-receipt-2.png", optimize=True)
    print("items start at line", first_item, "; wrote", ", ".join(p.name for p in sorted(HERE.glob("sams-receipt-*.png"))))


if __name__ == "__main__":
    main()
