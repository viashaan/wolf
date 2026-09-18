#!/usr/bin/env python3
"""Seedance clip (wolf on a plain plate) -> app loop with alpha.
Per frame: key the wolf against the plate colour measured once from the first frame, ladder-scale,
muted horizontal ghost, the same warm pool of light as the stills (fixed for the whole clip from the
first frame's bounds), light bloom, straight alpha. Frames go out as RGBA PNGs and are encoded as
HEVC with alpha (hvc1) for iOS Safari, plus a poster WebP. Usage: process_video2.py N raw.mp4"""
import os, sys, subprocess, shutil, numpy as np
from PIL import Image, ImageFilter
ROOT = os.path.expanduser("~/Documents/wolf/img")
ZOOM = {1: 1.04, 2: 1.02, 3: 0.97, 4: 0.98, 5: 1.00, 6: 1.03, 7: 1.06, 8: 1.10, 9: 1.14, 10: 1.18}
S = 1000; OUT = 720; FPS = 24
CENTRE = np.array([0x3E, 0x2E, 0x1C], np.float32) / 255
RIM    = np.array([0x22, 0x1A, 0x13], np.float32) / 255

def hblur(a, k):
    pad = k // 2; p = np.pad(a, ((0, 0), (pad, pad), (0, 0)), mode="edge")
    c = np.cumsum(p, axis=1); c = np.concatenate([np.zeros_like(c[:, :1]), c], axis=1)
    return (c[:, k:] - c[:, :-k]) / k

def plate_colour(img):
    a = np.asarray(img.convert("RGB"), np.float32)
    edge = np.concatenate([a[:40].reshape(-1, 3), a[-40:].reshape(-1, 3), a[:, :40].reshape(-1, 3), a[:, -40:].reshape(-1, 3)])
    return np.median(edge, axis=0)

def key(img, bg, mt=None):
    """Alpha = BiRefNet matte (solid silhouette, stable frame to frame) plus the tight chroma key for loose fur
    strands, but only within a few pixels of the matte so the plate never leaks."""
    from scipy import ndimage
    a = np.asarray(img.convert("RGB").filter(ImageFilter.GaussianBlur(0.6)), np.float32)
    d = np.sqrt(((a - bg) ** 2).sum(-1))
    chroma = np.clip((d - 7) / 10, 0, 1)
    m = np.asarray(mt.convert("L"), np.float32) / 255 if mt is not None else chroma
    # matte is trusted for the interior only; the outer band goes by plate-likeness so the matte's ring of plate drops out
    core = ndimage.binary_erosion(m > 0.5, iterations=3)
    near = ndimage.binary_dilation(m > 0.5, iterations=4)
    alpha = np.where(core, 1.0, np.clip((d - 6) / 14, 0, 1) * near).astype(np.float32)
    alpha = np.asarray(Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6)), np.float32) / 255
    alpha = np.clip((alpha - 0.12) / 0.88, 0, 1)                      # pull the edge in a hair
    rgb = np.asarray(img.convert("RGB"), np.float32) / 255
    a3 = alpha[..., None]; bgc = (bg / 255).astype(np.float32)
    rgb = np.where(a3 > 0, np.clip((rgb - bgc * (1 - a3)) / np.maximum(a3, 0.08), 0, 1), rgb)   # remove the plate mixed into edge pixels
    return rgb, a3

def pool(cy):
    y, x = np.mgrid[0:S, 0:S].astype(np.float32)
    r = np.sqrt(((x - S / 2) / (S * 0.50)) ** 2 + ((y - cy) / (S * 0.36)) ** 2)
    t = np.clip(r, 0, 1)[..., None]; t = t * t * (3 - 2 * t)
    col = CENTRE * (1 - t) + RIM * t
    a = 1 - np.clip((r - 0.28) / 0.72, 0, 1); a = a * a * (3 - 2 * a)
    return col, a[..., None]

def premultiply(path):
    """Safari composites HEVC alpha as premultiplied, so bake alpha into the colour before encoding."""
    a = np.asarray(Image.open(path).convert("RGBA"), np.float32) / 255
    a[..., :3] *= a[..., 3:4]
    Image.fromarray((a * 255).astype(np.uint8), "RGBA").save(path)

def run(n, src):
    z = ZOOM[n]; side = int(1220 * z * S / 1520)
    ox = (S - side) // 2; oy = max(0, min(S - side, (S - side) // 2 + int((1 - z) * 60 * S / 1520)))
    tmp = os.path.expanduser(f"~/Documents/wolf/img/raw/wolfvid2/{n:02d}"); os.makedirs(tmp, exist_ok=True)
    if not any(f.startswith("in_") for f in os.listdir(tmp)):   # keep extracted frames (and their mattes) between runs
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-vf", f"fps={FPS},scale={side}:{side}:flags=lanczos", f"{tmp}/in_%04d.png"], check=True)
    frames = sorted(f for f in os.listdir(tmp) if f.startswith("in_"))
    first = Image.open(f"{tmp}/{frames[0]}"); bg = plate_colour(first)
    def mt_for(f):
        p = f"{tmp}/mt_{f[3:]}"; return Image.open(p) if os.path.exists(p) else None
    _, a0 = key(first, bg, mt_for(frames[0])); rows = np.where(a0[..., 0].max(1) > 0.5)[0]
    cy = oy + (rows.min() + rows.max()) / 2 if len(rows) else S / 2
    pcol, pacc = pool(cy)
    grey_w = np.array([0.3, 0.59, 0.11], np.float32); warm = np.array([1.0, 0.86, 0.66], np.float32)
    ks = ((int(side * 0.16) | 1, min(int(side * 0.09), ox), 0.42), (int(side * 0.07) | 1, min(int(side * 0.04), ox), 0.30))
    for i, f in enumerate(frames):
        rgb, alpha = key(Image.open(f"{tmp}/{f}"), bg, mt_for(f))
        col = pcol.copy(); acc = pacc.copy()
        def over(lrgb, la, dx, gain):
            ys, xs = slice(oy, oy + side), slice(ox + dx, ox + dx + side)
            a = la * gain
            col[ys, xs] = col[ys, xs] * (1 - a) + lrgb * a
            acc[ys, xs] = acc[ys, xs] + a * (1 - acc[ys, xs])
        prem = rgb * alpha; grey = (prem @ grey_w)[..., None]
        for k, dx, gain in ks:
            g_rgb = hblur(prem * 0.45 + grey * 0.55, k) * warm; g_a = hblur(alpha, k)
            g_col = np.where(g_a > 1e-4, g_rgb / np.maximum(g_a, 1e-4), 0)
            over(g_col, g_a, dx, gain); over(g_col, g_a, -dx // 2, gain * 0.6)
        over(rgb, alpha, 0, 1.0)
        bright = np.clip((col.mean(-1, keepdims=True) - 0.55) / 0.45, 0, 1) * col * acc
        bl = np.asarray(Image.fromarray((np.clip(bright, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(18)), np.float32) / 255
        col = 1 - (1 - col) * (1 - bl * 0.35)
        out = np.concatenate([np.clip(col, 0, 1), np.clip(acc, 0, 1)], axis=-1)
        im = Image.fromarray((out * 255).astype(np.uint8), "RGBA").resize((OUT, OUT), Image.LANCZOS)
        os.makedirs(f"{tmp}/st", exist_ok=True); im.save(f"{tmp}/st/out_{i:04d}.png")   # straight alpha (WebM)
        im.save(f"{tmp}/out_{i:04d}.png"); premultiply(f"{tmp}/out_{i:04d}.png")       # premultiplied (HEVC, Safari)
    # ping-pong: play forward then back so the loop always closes through its own frames
    N = len(frames)
    for j in range(N - 2, 0, -1):
        k = N + (N - 2 - j)
        for sub in ("", "st/"):
            shutil.copy(f"{tmp}/{sub}out_{j:04d}.png", f"{tmp}/{sub}out_{k:04d}.png")
    encode(n, tmp)

def encode(n, tmp):
    dst = f"{ROOT}/wolf/{n:02d}.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", f"{tmp}/out_%04d.png",
                    "-c:v", "hevc_videotoolbox", "-pix_fmt", "bgra", "-alpha_quality", "0.85", "-q:v", "62", "-tag:v", "hvc1",
                    "-movflags", "+faststart", "-an", dst], check=True)
    VPX = "/Users/shaan_johari/Desktop/Shaan's AIOS/.venv/lib/python3.14/site-packages/imageio_ffmpeg/binaries/ffmpeg-macos-aarch64-v7.1"
    webm = f"{ROOT}/wolf/{n:02d}.webm"
    subprocess.run([VPX, "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", f"{tmp}/st/out_%04d.png",
                    "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-auto-alt-ref", "0", "-b:v", "0", "-crf", "32", "-row-mt", "1", "-deadline", "good", "-cpu-used", "2", "-an", webm], check=True)
    print(dst, os.path.getsize(dst) // 1024, "KB", webm, os.path.getsize(webm) // 1024, "KB")

if __name__ == "__main__":
    if sys.argv[1] == "reencode":     # premultiply existing out_ frames and re-encode
        for n in map(int, sys.argv[2:]):
            tmp = f"{ROOT}/raw/wolfvid2/{n:02d}"
            for f in sorted(os.listdir(tmp)):
                if f.startswith("out_"): premultiply(f"{tmp}/{f}")
            encode(n, tmp)
    else:
        run(int(sys.argv[1]), sys.argv[2])
