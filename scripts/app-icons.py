#!/usr/bin/env python3
"""Generates Decibel app icons (transparent background) from the vector geometry of
public/brand/decibel-mark-symmetric.png. Requires Pillow (pip install pillow).
Usage: python3 scripts/app-icons.py  (run from the repo root)"""
import os
from PIL import Image, ImageDraw

GREEN = (66, 200, 125, 255)
WHITE = (255, 255, 255, 255)
BG = (11, 11, 11, 255)
# Five rounded bars measured from the master mark, in units where the tallest bar = 920.
BARS = [(-393.5, 147, 286), (-211.0, 170, 552), (0.0, 183, 920), (211.0, 170, 552), (393.5, 147, 286)]
SPAN_W = 934.0  # total width of the symbol in the same units
SS = 8  # supersampling

def smooth(size, frac, color=GREEN, bg=None):
    """Symbol whose tallest bar is frac*size, centred, antialiased."""
    S = size * SS
    im = Image.new("RGBA", (S, S), bg or (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    k = frac * S / 920.0
    c = S / 2.0
    for cx, w, h in BARS:
        x0, x1 = c + (cx - w / 2) * k, c + (cx + w / 2) * k
        y0, y1 = c - h / 2 * k, c + h / 2 * k
        d.rounded_rectangle([x0, y0, x1, y1], radius=w * k / 2, fill=color)
    return im.resize((size, size), Image.BOX)

# Pixel-snapped layouts for tiny sizes: (bar widths, gap, heights) in whole pixels.
SNAP = {
    16: ([2, 2, 2, 2, 2], 1, [4, 8, 14, 8, 4]),
    24: ([3, 3, 4, 3, 3], 1, [6, 12, 20, 12, 6]),
    32: ([4, 4, 4, 4, 4], 1, [8, 14, 24, 14, 8]),
    48: ([6, 6, 6, 6, 6], 1, [10, 20, 34, 20, 10]),
}

def snapped(size, color=GREEN):
    widths, gap, heights = SNAP[size]
    S = size * SS
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    total = sum(widths) + gap * (len(widths) - 1)
    x = (size - total) // 2
    for w, h in zip(widths, heights):
        y = (size - h) // 2
        d.rounded_rectangle([x * SS, y * SS, (x + w) * SS - 1, (y + h) * SS - 1], radius=w * SS / 2, fill=color)
        x += w + gap
    return im.resize((size, size), Image.BOX)

DESKTOP_FRAC = 0.66
def desktop(size):
    return snapped(size) if size in SNAP else smooth(size, DESKTOP_FRAC)

def save(im, path):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    im.save(path, optimize=True)  # Pillow writes no C2PA / XMP / text chunks

def tauri_dir(d):
    for n, s in [("32x32.png", 32), ("64x64.png", 64), ("128x128.png", 128), ("128x128@2x.png", 256), ("icon.png", 512)]:
        save(desktop(s), f"{d}/{n}")
    ico = [desktop(s) for s in (16, 24, 32, 48, 64, 256)]
    ico[-1].save(f"{d}/icon.ico", format="ICO", sizes=[(i.width, i.height) for i in ico], append_images=ico[:-1])
    big = smooth(1024, DESKTOP_FRAC)
    big.save(f"{d}/icon.icns", format="ICNS", append_images=[desktop(s) for s in (16, 32, 64, 128, 256, 512)])
    if d.endswith("icons-symmetric"):
        for n, s in [("Square30x30Logo", 30), ("Square44x44Logo", 44), ("Square71x71Logo", 71), ("Square89x89Logo", 89),
                     ("Square107x107Logo", 107), ("Square142x142Logo", 142), ("Square150x150Logo", 150),
                     ("Square284x284Logo", 284), ("Square310x310Logo", 310), ("StoreLogo", 50)]:
            save(desktop(s), f"{d}/{n}.png")

# Android: adaptive foreground at 108dp, tallest bar 38dp (~58% of the 66dp safe zone).
FG_FRAC = 38 / 108
LEGACY_FRAC = 0.60
DENS = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
def android(res):
    for name, m in DENS.items():
        fg, legacy = round(108 * m), round(48 * m)
        save(smooth(fg, FG_FRAC), f"{res}/mipmap-{name}/ic_launcher_foreground.png")
        save(smooth(fg, FG_FRAC, WHITE), f"{res}/mipmap-{name}/ic_launcher_monochrome.png")
        lg = snapped(legacy) if legacy in SNAP else smooth(legacy, LEGACY_FRAC)
        save(lg, f"{res}/mipmap-{name}/ic_launcher.png")
        save(lg, f"{res}/mipmap-{name}/ic_launcher_round.png")
    os.makedirs(f"{res}/mipmap-anydpi-v26", exist_ok=True)
    xml = ('<?xml version="1.0" encoding="utf-8"?>\n'
           '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
           '  <background android:drawable="@color/ic_launcher_background"/>\n'
           '  <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n'
           '  <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>\n'
           '</adaptive-icon>\n')
    for n in ("ic_launcher.xml", "ic_launcher_round.xml"):
        open(f"{res}/mipmap-anydpi-v26/{n}", "w").write(xml)
    os.makedirs(f"{res}/values", exist_ok=True)
    open(f"{res}/values/ic_launcher_background.xml", "w").write(
        '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <color name="ic_launcher_background">#00000000</color>\n</resources>\n')

def svg(frac=0.72, bg=None, rx=0):
    k = frac * 512 / 920.0
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">']
    if bg:
        parts.append(f'<rect width="512" height="512" rx="{rx}" fill="{bg}"/>')
    parts.append('<g fill="#42c87d">')
    for cx, w, h in BARS:
        parts.append(f'<rect x="{256 + (cx - w / 2) * k:.2f}" y="{256 - h / 2 * k:.2f}" width="{w * k:.2f}" height="{h * k:.2f}" rx="{w * k / 2:.2f}"/>')
    parts.append('</g></svg>\n')
    return "".join(parts)

def notification_vector(path):
    # 24dp white-on-transparent status bar icon, tallest bar 18dp.
    k = 18 / 920.0
    d = []
    for cx, w, h in BARS:
        r = w * k / 2
        x0, x1 = 12 + (cx - w / 2) * k, 12 + (cx + w / 2) * k
        y0, y1 = 12 - h / 2 * k + r, 12 + h / 2 * k - r
        d.append(f"M{x0:.3f},{y0:.3f}A{r:.3f},{r:.3f} 0,0 1 {x1:.3f},{y0:.3f}V{y1:.3f}A{r:.3f},{r:.3f} 0,0 1 {x0:.3f},{y1:.3f}Z")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "w").write(
        '<vector xmlns:android="http://schemas.android.com/apk/res/android"\n'
        '    android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">\n'
        f'    <path android:fillColor="#FFFFFFFF" android:pathData="{"".join(d)}"/>\n</vector>\n')

def web(pub):
    b = f"{pub}/brand"
    save(smooth(1254, 920 / 1254), f"{b}/decibel-mark-symmetric.png")  # UI mask (same geometry, clean alpha, no C2PA)
    open(f"{b}/decibel-mark-symmetric.svg", "w").write(svg(920 / 1254))
    for s in (32, 180, 192, 512, 1024):
        save(desktop(s) if s != 180 else smooth(180, DESKTOP_FRAC), f"{b}/decibel-symmetric-icon-{s}.png")
    # Maskable must be opaque: dark tile, symbol inside the 80% safe circle.
    save(smooth(512, 0.42, bg=BG), f"{b}/decibel-symmetric-maskable-512.png")
    save(desktop(32), f"{pub}/favicon.png")
    save(smooth(180, DESKTOP_FRAC), f"{pub}/icons/apple-touch-icon.png")
    save(smooth(192, DESKTOP_FRAC), f"{pub}/icons/icon-192.png")
    save(smooth(512, DESKTOP_FRAC), f"{pub}/icons/icon-512.png")
    save(smooth(512, 0.42, bg=BG), f"{pub}/icons/maskable-512.png")
    open(f"{pub}/icons/icon.svg", "w").write(svg(DESKTOP_FRAC))
    open(f"{pub}/icons/maskable.svg", "w").write(svg(0.42, bg="#0b0b0b"))

if __name__ == "__main__":
    root = os.environ.get("ROOT", ".")
    tauri_dir(f"{root}/src-tauri/icons-symmetric")
    tauri_dir(f"{root}/src-tauri/icons")
    android(f"{root}/src-tauri/icons-symmetric/android")
    notification_vector(f"{root}/src-tauri/android-overlay/ic_stat_decibel.xml")
    web(f"{root}/public")
    print("Decibel icons regenerated")
