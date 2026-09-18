#!/usr/bin/env python3
"""BiRefNet mattes for the wolf frames (run with the AIOS venv python, which has rembg).
Stills:  matte.py stills            -> img/raw/wolf9/NN.matte.png
Clip:    matte.py clip N [step]     -> img/raw/wolfvid2/NN/mt_XXXX.png for every in_XXXX.png
Every `step`-th frame goes through the model; the frames between get a linear blend of the neighbours
(motion is subtle, so the edge moves under a pixel or two between samples)."""
import os, sys, numpy as np
from PIL import Image
from rembg import new_session, remove
ROOT = os.path.expanduser("~/Documents/wolf/img")
S = new_session("birefnet-general", providers=["CPUExecutionProvider"])

def matte(path):
    return remove(Image.open(path).convert("RGB"), session=S, only_mask=True)

if sys.argv[1] == "stills":
    for n in range(1, 11):
        p = f"{ROOT}/raw/wolf9/{n:02d}.png"
        if os.path.exists(p): matte(p).save(f"{ROOT}/raw/wolf9/{n:02d}.matte.png"); print("still", n, flush=True)
else:
    n = int(sys.argv[2]); step = int(sys.argv[3]) if len(sys.argv) > 3 else 2
    d = f"{ROOT}/raw/wolfvid2/{n:02d}"
    fs = sorted(f for f in os.listdir(d) if f.startswith("in_"))
    idx = list(range(0, len(fs), step))
    if idx[-1] != len(fs) - 1: idx.append(len(fs) - 1)
    got = {}
    for i in idx:
        got[i] = np.asarray(matte(f"{d}/{fs[i]}"), np.float32); print("clip", n, "frame", i + 1, "/", len(fs), flush=True)
    for i in range(len(fs)):
        if i in got: m = got[i]
        else:
            lo = max(j for j in idx if j < i); hi = min(j for j in idx if j > i); t = (i - lo) / (hi - lo)
            m = got[lo] * (1 - t) + got[hi] * t
        Image.fromarray(m.astype(np.uint8)).save(f"{d}/mt_{i + 1:04d}.png")
    print("done clip", n, flush=True)
