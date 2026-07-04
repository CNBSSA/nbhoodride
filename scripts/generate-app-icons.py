#!/usr/bin/env python3
"""Generate PG Ride PWA and app-store icon assets from a single vector-style design."""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ICONS_DIR = ROOT / "client" / "public" / "icons"
SCREENSHOTS_DIR = ROOT / "client" / "public" / "screenshots"
STORE_DIR = ROOT / "store-listing"

BRAND = "#339AF0"
WHITE = "#FFFFFF"
DARK = "#1E3A5F"

ICON_SIZES = [72, 96, 128, 144, 152, 192, 384, 512, 1024]
SCREENSHOT_SIZE = (390, 844)


def hex_to_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    ):
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def draw_icon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    margin = max(4, size // 16)
    radius = size // 5
    draw.rounded_rectangle(
        (margin, margin, size - margin, size - margin),
        radius=radius,
        fill=hex_to_rgb(BRAND),
    )

    # Simple ride pin + road motif
    cx, cy = size // 2, size // 2
    pin_r = size // 6
    draw.ellipse(
        (cx - pin_r, cy - pin_r - size // 12, cx + pin_r, cy + pin_r - size // 12),
        fill=hex_to_rgb(WHITE),
    )
    triangle = [
        (cx, cy + pin_r + size // 10),
        (cx - pin_r // 2, cy + size // 16),
        (cx + pin_r // 2, cy + size // 16),
    ]
    draw.polygon(triangle, fill=hex_to_rgb(WHITE))

    road_y = cy + size // 5
    road_w = size // 3
    draw.rounded_rectangle(
        (cx - road_w, road_y, cx + road_w, road_y + size // 14),
        radius=max(2, size // 64),
        fill=hex_to_rgb(DARK),
    )

    font = load_font(max(12, size // 5))
    label = "PG"
    bbox = draw.textbbox((0, 0), label, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text(
        (cx - tw // 2, cy - th // 2 - size // 12),
        label,
        fill=hex_to_rgb(BRAND),
        font=font,
    )
    return img


def draw_screenshot(title: str, subtitle: str) -> Image.Image:
    w, h = SCREENSHOT_SIZE
    img = Image.new("RGB", (w, h), hex_to_rgb("#F8FAFC"))
    draw = ImageDraw.Draw(img)

    header_h = 120
    draw.rectangle((0, 0, w, header_h), fill=hex_to_rgb(BRAND))
    title_font = load_font(28)
    sub_font = load_font(16)
    draw.text((24, 36), "PG Ride", fill=hex_to_rgb(WHITE), font=title_font)
    draw.text((24, 72), subtitle, fill=hex_to_rgb(WHITE), font=sub_font)

    card_margin = 20
    card_top = header_h + 24
    card_h = h - card_top - 40
    draw.rounded_rectangle(
        (card_margin, card_top, w - card_margin, card_top + card_h),
        radius=20,
        fill=hex_to_rgb(WHITE),
        outline=hex_to_rgb("#E2E8F0"),
        width=2,
    )

    icon = draw_icon(96).resize((72, 72), Image.Resampling.LANCZOS)
    img.paste(icon, (card_margin + 24, card_top + 24), icon)

    body_font = load_font(22)
    draw.text((card_margin + 24, card_top + 120), title, fill=hex_to_rgb(DARK), font=body_font)

    for i in range(4):
        y = card_top + 190 + i * 56
        draw.rounded_rectangle(
            (card_margin + 24, y, w - card_margin - 24, y + 44),
            radius=12,
            fill=hex_to_rgb("#EFF6FF"),
        )

    return img


def main() -> None:
    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)
    STORE_DIR.mkdir(parents=True, exist_ok=True)

    for size in ICON_SIZES:
        icon = draw_icon(size)
        name = f"icon-{size}.png" if size != 1024 else "icon-1024-store.png"
        target = ICONS_DIR / name if size != 1024 else STORE_DIR / name
        icon.convert("RGB").save(target, "PNG", optimize=True)
        print(f"wrote {target.relative_to(ROOT)}")

    draw_screenshot("Book a community ride", "Safe rides from neighbors").save(
        SCREENSHOTS_DIR / "screen-rider.png", "PNG", optimize=True
    )
    draw_screenshot("Driver dashboard", "Go online and accept rides").save(
        SCREENSHOTS_DIR / "screen-driver.png", "PNG", optimize=True
    )
    print(f"wrote {SCREENSHOTS_DIR.relative_to(ROOT)}/screen-*.png")


if __name__ == "__main__":
    main()
