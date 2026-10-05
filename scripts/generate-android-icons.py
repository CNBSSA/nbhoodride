#!/usr/bin/env python3
"""
Build the Android launcher icons from PG Ride's brand icon (work order #450).

Until 2026-10-05 every Android launcher icon was still Capacitor's default
placeholder (a blue cross on a grid); the web app and iOS already used the
brand mark, "PG." with the yellow dot and slider on the blue gradient. This
derives the whole Android set from the one source the web app and iOS use,
client/public/icons/icon-1024.png, so the three stay the same:

- Adaptive icons (Android 8+): a background layer that is the brand gradient,
  and a foreground layer that is the mark alone, scaled into the 66dp safe
  zone of the 108dp canvas, so no launcher mask (circle, squircle, teardrop)
  ever clips the "PG." or the dot.
- Legacy square and round icons for older launchers, the mark on the gradient.

Run: python3 scripts/generate-android-icons.py   (needs Pillow)
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "client" / "public" / "icons" / "icon-1024.png"
RES = ROOT / "android" / "app" / "src" / "main" / "res"

# Launcher icon sizes per density: legacy 48dp, adaptive layers 108dp.
DENSITIES = {"mdpi": 1.0, "hdpi": 1.5, "xhdpi": 2.0, "xxhdpi": 3.0, "xxxhdpi": 4.0}


def gradient_at(src: Image.Image):
    """The brand gradient runs diagonally: sample the clean top-left and bottom-right corners."""
    w, h = src.size
    c0 = src.getpixel((int(w * 0.03), int(h * 0.03)))[:3]
    c1 = src.getpixel((int(w * 0.97), int(h * 0.97)))[:3]

    def at(x: float, y: float) -> tuple[int, int, int]:
        t = max(0.0, min(1.0, (x + y) / 2.0))
        return tuple(round(a + (b - a) * t) for a, b in zip(c0, c1))

    return at


def gradient_image(size: int, at) -> Image.Image:
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            px[x, y] = at(x / (size - 1), y / (size - 1))
    return img


def extract_mark(src: Image.Image, at) -> Image.Image:
    """The mark (white text, yellow dot and slider) as RGBA on transparency."""
    w, h = src.size
    rgb = src.convert("RGB")
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    sp, op = rgb.load(), out.load()
    for y in range(h):
        for x in range(w):
            r, g, b = sp[x, y]
            br, bg, bb = at(x / (w - 1), y / (h - 1))
            # How far this pixel sits from the gradient behind it, 0..1.
            d = max(abs(r - br), abs(g - bg), abs(b - bb)) / 255.0
            if d < 0.06:
                continue
            a = min(1.0, (d - 0.06) / 0.30)
            # Un-blend the colour from the background so edges stay clean.
            def un(c, bc):
                return max(0, min(255, round((c - bc * (1 - a)) / a))) if a > 0 else c
            op[x, y] = (un(r, br), un(g, bg), un(b, bb), round(a * 255))
    return out.crop(out.getbbox())


def place(mark: Image.Image, canvas: int, fraction: float) -> Image.Image:
    """The mark centred on a transparent canvas, its longer side `fraction` of the canvas."""
    scale = canvas * fraction / max(mark.size)
    m = mark.resize((max(1, round(mark.width * scale)), max(1, round(mark.height * scale))), Image.LANCZOS)
    out = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    out.paste(m, ((canvas - m.width) // 2, (canvas - m.height) // 2), m)
    return out


def main() -> None:
    src = Image.open(SOURCE).convert("RGBA")
    at = gradient_at(src)
    mark = extract_mark(src, at)

    for name, k in DENSITIES.items():
        folder = RES / f"mipmap-{name}"
        folder.mkdir(parents=True, exist_ok=True)
        layer = round(108 * k)
        legacy = round(48 * k)

        # Adaptive layers: the mark fills ~58% of the 108dp canvas, inside the 66dp safe zone.
        place(mark, layer, 0.58).save(folder / "ic_launcher_foreground.png")
        gradient_image(layer, at).save(folder / "ic_launcher_background.png")

        # Legacy square: the brand icon itself, a rounded square like the launcher draws it.
        sq = Image.new("RGBA", (legacy, legacy), (0, 0, 0, 0))
        tile = gradient_image(legacy, at).convert("RGBA")
        tile.alpha_composite(place(mark, legacy, 0.80))
        r = round(legacy * 0.18)
        mask = Image.new("L", (legacy, legacy), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, legacy - 1, legacy - 1), radius=r, fill=255)
        sq.paste(tile, (0, 0), mask)
        sq.save(folder / "ic_launcher.png")

        # Legacy round: the mark smaller, so the circle never clips it.
        rnd = Image.new("RGBA", (legacy, legacy), (0, 0, 0, 0))
        tile = gradient_image(legacy, at).convert("RGBA")
        tile.alpha_composite(place(mark, legacy, 0.66))
        mask = Image.new("L", (legacy, legacy), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, legacy - 1, legacy - 1), fill=255)
        rnd.paste(tile, (0, 0), mask)
        rnd.save(folder / "ic_launcher_round.png")
        print(f"mipmap-{name}: legacy {legacy}px, adaptive layers {layer}px")


if __name__ == "__main__":
    main()
