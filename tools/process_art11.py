#!/usr/bin/env python3
"""Round eleven: wolf + smear over a soft warm pool of light that fades out in the frame's own alpha.
No CSS mask needed: the rim colour is close to the app plate, the alpha reaches zero well inside the
frame, and the centre is lighter than the plate so it reads as light on the wolf, never a dark ring."""
import os, sys, numpy as np
from PIL import Image, ImageFilter
ROOT = os.path.expanduser("~/Documents/wolf/img")
ZOOM = {1: 1.04, 2: 1.02, 3: 0.97, 4: 0.98, 5: 1.00, 6: 1.03, 7: 1.06, 8: 1.10, 9: 1.14, 10: 1.18}
S = 1520; OUT = 1000
CENTRE = np.array([0x3E, 0x2E, 0x1C], np.float32) / 255   # warm pool under the wolf
RIM    = np.array([0x22, 0x1A, 0x13], np.float32) / 255   # near the plate tone, where alpha runs out

def hblur(a, k):
    pad = k // 2; p = np.pad(a, ((0, 0), (pad, pad), (0, 0)), mode="edge")
    c = np.cumsum(p, axis=1); c = np.concatenate([np.zeros_like(c[:, :1]), c], axis=1)
    return (c[:, k:] - c[:, :-k]) / k

def key(img):
    a = np.asarray(img.convert("RGB").filter(ImageFilter.GaussianBlur(0.8)), np.float32)
    edge = np.concatenate([a[:50].reshape(-1, 3), a[-50:].reshape(-1, 3), a[:, :50].reshape(-1, 3), a[:, -50:].reshape(-1, 3)])
    bg = np.median(edge, axis=0)
    d = np.sqrt(((a - bg) ** 2).sum(-1))
    alpha = np.clip((d - 22) / 40, 0, 1)
    alpha = np.asarray(Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.0)), np.float32) / 255
    return np.asarray(img.convert("RGB"), np.float32) / 255, alpha[..., None]

def grade(rgb):
    """Punch on the wolf only: black point down, S-curve, a little saturation, unsharp."""
    x = np.clip((rgb - 0.07) / 0.93, 0, 1)                       # deeper blacks
    x = np.where(x < 0.5, 0.5 * (2 * x) ** 1.35, 1 - 0.5 * (2 * (1 - x)) ** 1.35)   # S-curve
    lum = (x @ np.array([0.3, 0.59, 0.11], np.float32))[..., None]
    x = np.clip(lum + (x - lum) * 0.98, 0, 1)                    # saturation
    im = Image.fromarray((x * 255).astype(np.uint8))
    im = im.filter(ImageFilter.UnsharpMask(radius=2, percent=70, threshold=2))
    return np.asarray(im, np.float32) / 255

def contact_shadow(alpha, side):
    """Soft dark ellipse under the lowest point of the wolf."""
    a = alpha[..., 0]; rows = np.where(a.max(1) > 0.5)[0]; cols = np.where(a.max(0) > 0.5)[0]
    if not len(rows): return np.zeros_like(alpha)
    yb = rows.max(); cx = (cols.min() + cols.max()) / 2; w = (cols.max() - cols.min()) * 0.42
    y, x = np.mgrid[0:side, 0:side].astype(np.float32)
    r = np.sqrt(((x - cx) / w) ** 2 + ((y - yb) / (side * 0.035)) ** 2)
    sh = np.clip(1 - r, 0, 1) ** 1.5
    sh = np.asarray(Image.fromarray((sh * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(side * 0.02)), np.float32) / 255
    return sh[..., None] * 0.55

def pool(cy):
    """Elliptical pool centred on the wolf: colour CENTRE->RIM, alpha 1 -> 0 with a long smooth tail."""
    y, x = np.mgrid[0:S, 0:S].astype(np.float32)
    r = np.sqrt(((x - S / 2) / (S * 0.50)) ** 2 + ((y - cy) / (S * 0.36)) ** 2)   # 1.0 = rim
    t = np.clip(r, 0, 1)[..., None]; t = t * t * (3 - 2 * t)
    col = CENTRE * (1 - t) + RIM * t
    a = 1 - np.clip((r - 0.28) / 0.72, 0, 1); a = a * a * (3 - 2 * a)
    return col, a[..., None]

def stage(n, src, dst):
    img = Image.open(src).convert("RGB")
    z = ZOOM[n]; side = int(1220 * z)
    img = img.resize((side, side), Image.LANCZOS)
    rgb, alpha = key(img)
    rgb = grade(rgb)
    ox = (S - side) // 2; oy = max(0, min(S - side, (S - side) // 2 + int((1 - z) * 60)))
    ys_w = np.where(alpha[..., 0].max(1) > 0.5)[0]; cy = oy + (ys_w.min() + ys_w.max()) / 2 if len(ys_w) else S / 2
    col, acc = pool(cy); col = col.copy(); acc = acc.copy()
    def over(lrgb, la, dx, dy, gain):
        ys, xs = slice(oy + dy, oy + dy + side), slice(ox + dx, ox + dx + side)
        a = la * gain
        col[ys, xs] = col[ys, xs] * (1 - a) + lrgb * a
        acc[ys, xs] = acc[ys, xs] + a * (1 - acc[ys, xs])
    prem = rgb * alpha
    grey = (prem @ np.array([0.3, 0.59, 0.11], np.float32))[..., None]
    warm = np.array([1.0, 0.86, 0.66], np.float32)
    for k, dx, gain in ((int(side * 0.16) | 1, min(int(side * 0.09), ox), 0.42), (int(side * 0.07) | 1, min(int(side * 0.04), ox), 0.30)):
        g_rgb = hblur(prem * 0.45 + grey * 0.55, k) * warm; g_a = hblur(alpha, k)
        g_col = np.where(g_a > 1e-4, g_rgb / np.maximum(g_a, 1e-4), 0)
        over(g_col, g_a, dx, 0, gain); over(g_col, g_a, -dx // 2, 0, gain * 0.6)
    over(np.zeros_like(rgb) + np.array([0.06, 0.04, 0.03], np.float32), contact_shadow(alpha, side), 0, 0, 1.0)
    over(rgb, alpha, 0, 0, 1.0)
    bright = np.clip((col.mean(-1, keepdims=True) - 0.68) / 0.32, 0, 1) * col * acc
    bl = np.asarray(Image.fromarray((np.clip(bright, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(26)), np.float32) / 255
    col = 1 - (1 - col) * (1 - bl * 0.22)
    out = np.concatenate([np.clip(col, 0, 1), np.clip(acc, 0, 1)], axis=-1)
    Image.fromarray((out * 255).astype(np.uint8), "RGBA").resize((OUT, OUT), Image.LANCZOS).save(dst, "WEBP", quality=88, method=6)

src_dir = sys.argv[1] if len(sys.argv) > 1 else "wolf9"
for n in range(1, 11):
    p = f"{ROOT}/raw/{src_dir}/{n:02d}.png"
    if os.path.exists(p): stage(n, p, f"{ROOT}/wolf/{n:02d}.webp"); print("wolf", n)
