"""Cut the official logo out of its white background without redrawing it.

- Crops away the grey screenshot strip on the left edge and surplus white.
- Soft colour-to-alpha against the measured background (#FCFCFC) so
  anti-aliased edges are preserved; solid pixels keep their exact colour.
- Writes amrison-logo.png (full logo) and amrison-logo-gold.png (gold swoosh
  only, used as a mask for the end-card glint), plus logo-geometry.json with
  the A / VENTURES split line and the measured swoosh centreline.

Usage: python -I scripts/prepare_logo.py
"""
import json, os, subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "brand", "amrison-logo-original.jpg")
OUT = os.path.join(ROOT, "assets", "brand")

BG = 252          # measured background level
NOISE = 10        # differences below this are JPEG noise -> transparent
SOLID = 120       # differences above this are fully opaque
PAD = 16

def probe(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                        "stream=width,height", "-of", "csv=p=0", path], capture_output=True, text=True, check=True)
    w, h = r.stdout.strip().split(",")
    return int(w), int(h)

W, H = probe(SRC)
raw = subprocess.run(["ffmpeg", "-v", "error", "-i", SRC, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                     capture_output=True, check=True).stdout

def px(x, y):
    i = (y * W + x) * 3
    return raw[i], raw[i + 1], raw[i + 2]

def diff(p):
    return max(BG - min(c, BG) for c in p)

# Bounding box of the logo (skip the 20px screenshot strip on the left)
xs, ys = [], []
for y in range(H):
    for x in range(20, W):
        if diff(px(x, y)) >= 40:
            xs.append(x); ys.append(y)
x0, x1 = max(20, min(xs) - PAD), min(W - 1, max(xs) + PAD)
y0, y1 = max(0, min(ys) - PAD), min(H - 1, max(ys) + PAD)
cw, ch = x1 - x0 + 1, y1 - y0 + 1

is_gold = lambda r, g, b: r > b + 50 and r > 120 and g > b
full, gold = bytearray(cw * ch * 4), bytearray(cw * ch * 4)
for y in range(ch):
    for x in range(cw):
        r, g, b = px(x0 + x, y0 + y)
        d = diff((r, g, b))
        if d <= NOISE:
            a = 0.0
        elif d >= SOLID:
            a = 1.0
        else:
            a = (d - NOISE) / (SOLID - NOISE)
        if 0 < a < 1:
            # un-blend from the white background so edges stay true to colour
            r, g, b = (max(0, min(255, round((c - BG * (1 - a)) / a))) for c in (r, g, b))
        i = (y * cw + x) * 4
        full[i:i + 4] = bytes((r, g, b, round(a * 255)))
        if a > 0 and is_gold(r, g, b):
            gold[i:i + 4] = bytes((255, 255, 255, round(a * 255)))

# Keep only the largest connected gold region (the swoosh); drops JPEG specks
seen, best = set(), []
for start in range(cw * ch):
    if start in seen or gold[start * 4 + 3] < 128:
        continue
    comp, stack = [], [start]
    seen.add(start)
    while stack:
        p = stack.pop()
        comp.append(p)
        x, y = p % cw, p // cw
        for q in (p - 1 if x else -1, p + 1 if x < cw - 1 else -1, p - cw, p + cw):
            if 0 <= q < cw * ch and q not in seen and gold[q * 4 + 3] >= 128:
                seen.add(q); stack.append(q)
    if len(comp) > len(best):
        best = comp
keep = set(best)
# Also keep the soft edge pixels directly bordering the swoosh
for p in best:
    for q in (p - 1, p + 1, p - cw, p + cw):
        keep.add(q)
for p in range(cw * ch):
    if p not in keep:
        gold[p * 4:p * 4 + 4] = b"\0\0\0\0"

def write_png(buf, name):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{cw}x{ch}",
                    "-i", "-", "-frames:v", "1", os.path.join(OUT, name)], input=bytes(buf), check=True)

write_png(full, "amrison-logo.png")
write_png(gold, "amrison-logo-gold.png")

# Geometry in cropped-logo pixel space
row_ink = [sum(1 for x in range(cw) if full[(y * cw + x) * 4 + 3] > 128) for y in range(ch)]
# Split = middle of the widest empty band between the A and the VENTURES lettering
bands, start = [], None
for y in range(ch // 3, ch):
    if row_ink[y] == 0 and start is None:
        start = y
    elif row_ink[y] != 0 and start is not None:
        bands.append((start, y - 1)); start = None
band = max(bands, key=lambda b: b[1] - b[0])
split = (band[0] + band[1]) // 2
vent_rows = [y for y in range(split, ch) if row_ink[y] > 0]

centre = []
for x in range(cw):
    col = [y for y in range(split) if gold[(y * cw + x) * 4 + 3] > 128]
    if col:
        centre.append([x, (min(col) + max(col)) / 2, max(col) - min(col) + 1])
a_rows = [y for y in range(split) if row_ink[y] > 0]

geo = {
    "width": cw, "height": ch, "crop": [x0, y0],
    "split": split, "aTop": a_rows[0], "aBottom": a_rows[-1],
    "venturesTop": vent_rows[0], "venturesBottom": vent_rows[-1],
    # every 8th column of the swoosh: [x, centreY, thickness]
    "swoosh": centre[::8] + [centre[-1]],
}
with open(os.path.join(OUT, "logo-geometry.json"), "w") as f:
    json.dump(geo, f, indent=1)
# Same data as a script, because the page is loaded from file:// where fetch() is blocked
with open(os.path.join(OUT, "logo-geometry.js"), "w") as f:
    f.write("window.LOGO_GEO = " + json.dumps(geo) + ";\n")
print(json.dumps({k: v for k, v in geo.items() if k != "swoosh"}))
print("swoosh samples", len(geo["swoosh"]), geo["swoosh"][0], geo["swoosh"][len(geo["swoosh"]) // 2], geo["swoosh"][-1])
