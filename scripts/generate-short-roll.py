#!/usr/bin/env python3
"""
Generate the "Short Roll Combinations (Single Beat Rolls)" exercises (book page 10 /
PDF page 12) as static assets — a new section after Triplets.

One-time, offline build tool. 2 columns x 12 rows = 24 exercises, numbered column-major
(left 1-12, right 13-24), cut time (¢). The rhythm is fixed per column; only the printed
R/L sticking varies:
  * LEFT  (1-12): each measure = 4 straight eighths + 8 sixteenths (the "single beat
    roll" on beat 2). 12 notes/measure, 24 notes / 24 letters per exercise.
  * RIGHT (13-24): each measure = 4 eighths + 7 sixteenths + a sixteenth REST (the roll
    releases one note early). 11 notes/measure, 22 notes / 22 letters per exercise.
Either measure fills cut time (4*0.5 + 8*0.25 = 4q ; 4*0.5 + 7*0.25 + 0.25 = 4q).

The player needs no changes: notes carry value "eighth"/"16th" and the release is a
{"type":"rest","value":"16th"} (no click, no dot).

Outputs:
  client/public/exercises/short-roll-single-001.png ... -024.png
  client/public/exercises/exercises.json   (MERGED: keeps everything else, replaces this section)
  scripts/_montage_verify_short_roll.png
  scripts/_stems_debug_short_roll.png       (--debug)

Requires: pymupdf pillow numpy anthropic   (+ ANTHROPIC_API_KEY / CLAUDE_MODEL)
Usage:    python scripts/generate-short-roll.py [--no-vision] [--debug]
"""
import os, sys, json, base64, io, re
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import fitz
from PIL import Image, ImageDraw

# ---------------------------------------------------------------- paths / config
ROOT       = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PDF_PATH   = os.path.join(ROOT, "StickControl.pdf")
OUT_DIR    = os.path.join(ROOT, "client", "public", "exercises")
MANIFEST   = os.path.join(OUT_DIR, "exercises.json")
ENV_PATH   = os.path.join(ROOT, "server", ".env")

DPI        = 300
PADT, PADB = 6, 8
TW, TH     = 1100, 200          # crop size (24 notes packed tighter than page 10 -> a bit wider)
FX0        = 0.03
NOTEHEAD_DX = -0.004

# Two near-identical sections (same rhythm, different sticking). Pick with --double.
#   single = PDF p12, Single Beat Rolls (beat-2 roll = single strokes)
#   double = PDF p13, Double Beat Rolls (beat-2 roll = double strokes); a "* N stroke open
#            roll" annotation sits under row 1, so it needs a tighter band-merge gap (24px)
#            to keep that annotation out of the row-1 band.
VARIANTS = {
    "single": dict(page=12, section="Short Roll Combinations (Single Beat Rolls)",
                   idprefix="short-roll-single", gap=60, sfx=""),
    "double": dict(page=13, section="Short Roll Combinations (Double Beat Rolls)",
                   idprefix="short-roll-double", gap=24, sfx="_double"),
}
CFG      = VARIANTS["double" if "--double" in sys.argv else "single"]
PAGE     = CFG["page"]
SECTION  = CFG["section"]
IDPREFIX = CFG["idprefix"]
GAP      = CFG["gap"]
SFX      = CFG["sfx"]

# Per-column rhythm. Each tuple is (count, note-value, is_rest); concatenated per measure.
# notes-per-measure = sum of counts where not rest.
LEFT_PATTERN  = [(4, "eighth", False), (8, "16th", False)]                       # 12 notes
RIGHT_PATTERN = [(4, "eighth", False), (7, "16th", False), (1, "16th", True)]    # 11 notes + rest
def notes_per_measure(pat): return sum(c for c, v, r in pat if not r)
# Right column needs more right margin in the crop so the rest + repeat barline aren't clipped.
COLS = {  # side -> (notes_per_exercise, pattern, FX1)
    "L": (2 * notes_per_measure(LEFT_PATTERN),  LEFT_PATTERN,  0.93),
    "R": (2 * notes_per_measure(RIGHT_PATTERN), RIGHT_PATTERN, 0.86),
}

MONTAGE    = os.path.join(ROOT, "scripts", f"_montage_verify_short_roll{SFX}.png")
STEMS_DBG  = os.path.join(ROOT, "scripts", f"_stems_debug_short_roll{SFX}.png")
CACHE_PATH = os.path.join(ROOT, "scripts", f"_sticking_cache_short_roll{SFX}.json")
GT_PATH    = os.path.join(ROOT, "scripts", f"{IDPREFIX}-sticking.json")  # per exercise num
USE_VISION = "--no-vision" not in sys.argv
DEBUG      = "--debug" in sys.argv

# ---------------------------------------------------------------- env
def load_env(path):
    env = {}
    if os.path.exists(path):
        for line in open(path):
            m = re.match(r'\s*([A-Z_]+)\s*=\s*(.*)\s*$', line)
            if m: env[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return env

ENV   = load_env(ENV_PATH)
KEY   = ENV.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_API_KEY")
MODEL = ENV.get("CLAUDE_MODEL") or "claude-opus-4-8"

# ---------------------------------------------------------------- image analysis
def render_page(doc, pno):
    pix = doc[pno - 1].get_pixmap(matrix=fitz.Matrix(DPI / 72, DPI / 72), colorspace=fitz.csGRAY)
    return np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width)

def row_bands(ink, H, gap=60):
    rs = ink.sum(axis=1); on = rs > rs.max() * 0.08
    raw = []; i = 0
    while i < H:
        if on[i]:
            j = i
            while j < H and on[j]: j += 1
            raw.append([i, j]); i = j
        else: i += 1
    merged = []
    for b in raw:
        if merged and b[0] - merged[-1][1] < gap: merged[-1][1] = b[1]
        else: merged.append(b)
    return [m for m in merged if m[1] - m[0] > 120]

def gutter_x(ink, W):
    cs = ink.sum(axis=0); lo, hi = int(W * 0.40), int(W * 0.60)
    return lo + int(np.argmin(cs[lo:hi]))

def _max_run(col):
    best = c = 0
    for v in col:
        if v: c += 1; best = max(best, c)
        else: c = 0
    return best

def notehead_row(ink, a, b, xl, xh):
    best = (-1, (a + b) // 2)
    for y in range(a + 30, b - 25):
        row = ink[y, xl:xh]
        if _max_run(row) > 55: continue
        c = int(row.sum())
        if c > best[0]: best = (c, y)
    return best[1]

def notehead_centers(ink, a, b, xl, xh, min_stem=28, top_skip=26, win=56):
    """Note x-centres by their stems in the beam zone; drop the clef/¢ (never up there)
    and barlines (verticals that continue below the notehead row)."""
    ny = notehead_row(ink, a, b, xl, xh)
    sub = ink[a + top_skip:a + top_skip + win]
    on = [_max_run(sub[:, x]) >= min_stem for x in range(xl, xh)]
    clusters = []; s = None
    for i, v in enumerate(on):
        if v:
            if s is None: s = i
        elif s is not None:
            clusters.append((xl + s, xl + i - 1)); s = None
    if s is not None: clusters.append((xl + s, xl + len(on) - 1))
    centers = []
    for c0, c1 in clusters:
        cx = (c0 + c1) // 2
        if _max_run(ink[ny + 10:b - 5, cx]) < 22: centers.append(cx)
    return centers, ny

def affine_crop(img, bx0, bx1, y0, y1, fx1):
    span = bx1 - bx0
    Wsrc = span / (fx1 - FX0)
    x0 = bx0 - FX0 * Wsrc
    region = img[y0:y1, max(0, int(round(x0))):int(round(x0 + Wsrc))]
    return Image.fromarray(region).resize((TW, TH))

# ---------------------------------------------------------------- vision sticking
def stick_prompt(n):
    return (f"This image is one line of snare-drum notation (eighth notes then a sixteenth-note "
            f"roll) with a sticking letter (each either R or L) printed under every note. There "
            f"are exactly {n} letters. Read them strictly left to right and return ONLY those {n} "
            f"letters as one uppercase string, no spaces, no other text.")

def read_sticking(client, png_bytes, n):
    b64 = base64.b64encode(png_bytes).decode(); letters = ""
    for _ in range(2):
        try:
            msg = client.messages.create(
                model=MODEL, max_tokens=80,
                messages=[{"role": "user", "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": b64}},
                    {"type": "text", "text": stick_prompt(n)},
                ]}],
            )
            txt = "".join(b.text for b in msg.content if b.type == "text")
            letters = re.sub(r"[^RL]", "", txt.upper())
            if len(letters) == n: return letters, True
        except Exception as e:
            print(f"   vision error: {e}")
    return letters, False

# ---------------------------------------------------------------- exercise object
def measure_obj(pattern, hands, xs):
    events = []; idx = 0
    for count, val, is_rest in pattern:
        for _ in range(count):
            if is_rest:
                events.append({"type": "rest", "value": val, "dots": 0, "tuplet": None})
            else:
                events.append({"type": "note", "value": val, "dots": 0, "tuplet": None,
                               "hand": hands[idx] if idx < len(hands) else None,
                               "x": xs[idx], "tie": False})
                idx += 1
    return {"voices": [{"inst": "snare", "stem": "up", "events": events}]}

def build_exercise(num, img_rel, noteY, side, sticking, xs):
    total, pattern, _ = COLS[side]
    npm = notes_per_measure(pattern)
    ok = len(sticking) == total and set(sticking) <= {"R", "L"}
    measures = [measure_obj(pattern, sticking[0:npm], xs[0:npm]),
                measure_obj(pattern, sticking[npm:2 * npm], xs[npm:2 * npm])]
    return {
        "id": f"{IDPREFIX}-{num:03d}",
        "name": f"Short Roll · {num}",
        "section": SECTION,
        "img": img_rel,
        "noteY": round(noteY, 4),
        "aligned": ok,
        "timeSig": "¢",
        "time": {"num": 2, "den": 2},
        "meter": "cut time (2/2)",
        "noteValue": "eighths + sixteenth rolls",
        "measureBeats": 4,
        "measures": measures,
    }

# ---------------------------------------------------------------- main
def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    doc = fitz.open(PDF_PATH)
    img = render_page(doc, PAGE); H, W = img.shape; ink = (img < 128).astype(np.uint8)
    bands = row_bands(ink, H, GAP)
    assert len(bands) == 12, f"page {PAGE}: expected 12 row-bands, got {len(bands)}"
    g = gutter_x(ink, W)
    columns = [("L", 120, g - 10), ("R", g + 10, W - 30)]

    # detect every line
    lines = []          # (num, side, a, b, heads)
    counts = {}
    ny_fracs = []
    for r, (a, b) in enumerate(bands):
        for side, xl, xh in columns:
            heads, ny = notehead_centers(ink, a, b, xl, xh)
            num = (r + 1) if side == "L" else (r + 13)
            lines.append((num, side, a, b, heads)); counts[num] = len(heads)
            ny_fracs.append((ny - (a - PADT)) / ((b + PADB) - (a - PADT)))
    page_noteY = float(np.median(ny_fracs))

    for side in ("L", "R"):
        exp = COLS[side][0]
        good = sum(1 for (n, sd, *_ ) in lines if sd == side and counts[n] == exp)
        off = {n: counts[n] for (n, sd, *_ ) in lines if sd == side and counts[n] != exp}
        print(f"col {side}: {good}/12 lines == {exp} notes" + (f"  off: {off}" if off else ""))

    # per-column consensus note-span + baked output fractions (uniform layout per column)
    span, XS = {}, {}
    for side in ("L", "R"):
        exp, _, fx1 = COLS[side]
        clean = [hs for (n, sd, a, b, hs) in lines if sd == side and len(hs) == exp]
        assert clean, f"col {side}: no clean line with {exp} notes"
        arr = np.array(clean); med = np.median(arr, axis=0)
        span[side] = (float(med[0]), float(med[-1]))
        bx0, bx1 = span[side]
        fr = (med - bx0) / (bx1 - bx0) * (fx1 - FX0) + FX0
        XS[side] = [round(min(max(float(v) + NOTEHEAD_DX, 0.0), 1.0), 4) for v in fr]

    # crops (per-column consensus span -> aligned, clef on L1 falls in the left margin)
    cells = []
    for (num, side, a, b, hs) in lines:
        bx0, bx1 = span[side]; fx1 = COLS[side][2]
        crop = affine_crop(img, bx0, bx1, a - PADT, b + PADB, fx1)
        cells.append((num, side, crop))
    cells.sort(key=lambda t: t[0])

    # sticking: GT > cache > vision
    def load_json(p): return json.load(open(p)) if os.path.exists(p) else {}
    GT, cache = load_json(GT_PATH), load_json(CACHE_PATH)
    def png_bytes(im):
        buf = io.BytesIO(); im.save(buf, "PNG"); return buf.getvalue()
    def valid(s, n): return isinstance(s, str) and len(s) == n and set(s) <= {"R", "L"}

    sticking = {}; need = []
    for num, side, crop in cells:
        n = COLS[side][0]
        if valid(GT.get(str(num)), n):      sticking[num] = GT[str(num)]
        elif valid(cache.get(str(num)), n): sticking[num] = cache[str(num)]
        else:                               need.append((num, side, crop))
    if need and USE_VISION:
        if not KEY: print("!! ANTHROPIC_API_KEY missing; use --no-vision."); sys.exit(1)
        import anthropic
        client = anthropic.Anthropic(api_key=KEY)
        print(f"Reading sticking via {MODEL} for {len(need)} exercises...")
        def do(item):
            num, side, crop = item
            letters, okv = read_sticking(client, png_bytes(crop), COLS[side][0])
            print(f"  ex {num:2d} ({side}): {letters or '----'} {'' if okv else '<< CHECK'}")
            return num, letters, okv
        with ThreadPoolExecutor(max_workers=6) as ex:
            for num, letters, okv in ex.map(do, need):
                sticking[num] = letters
                if okv: cache[str(num)] = letters
    elif need:
        for num, side, _ in need: sticking[num] = "RL" * (COLS[side][0] // 2)
    json.dump(cache, open(CACHE_PATH, "w"), indent=0)

    # write PNGs + build exercise objects
    new_exs = []
    for num, side, crop in cells:
        fn = f"{IDPREFIX}-{num:03d}.png"
        crop.save(os.path.join(OUT_DIR, fn))
        new_exs.append(build_exercise(num, f"/exercises/{fn}", page_noteY, side, sticking[num], XS[side]))

    owned = {f"{IDPREFIX}-{i:03d}" for i in range(1, 25)}
    existing = load_json(MANIFEST) if os.path.exists(MANIFEST) else []
    kept = [e for e in existing if e.get("id") not in owned]
    merged = kept + new_exs
    with open(MANIFEST, "w") as f:
        json.dump(merged, f, ensure_ascii=False, indent=1)

    bad = [e["id"] for e in new_exs if not e["aligned"]]
    print(f"\nWrote {len(new_exs)} Short Roll exercises; manifest now {len(merged)} ({len(kept)} kept + {len(new_exs)}).")
    print(f"noteY {page_noteY:.4f}")
    print("bad sticking: " + (", ".join(bad) if bad else "none"))

    # montage: crop + sticking grouped 4 | rest
    def grouped(s, side):
        if side == "L": return f"{s[0:4]} {s[4:12]} | {s[12:16]} {s[16:24]}"
        return f"{s[0:4]} {s[4:11]} | {s[11:15]} {s[15:22]}"
    C = 2; rows = (len(cells) + C - 1) // C; pad = 10; cw = TW; ch = TH // 2 + 20
    M = Image.new("RGB", (C * (cw + pad) + pad, rows * (ch + pad) + pad), "white"); d = ImageDraw.Draw(M)
    for i, (num, side, crop) in enumerate(cells):
        rr, cc = divmod(i, C); px, py = pad + cc * (cw + pad), pad + rr * (ch + pad)
        M.paste(crop.convert("RGB").resize((cw, TH // 2)), (px, py))
        st = sticking[num]; sp = grouped(st, side) if len(st) == COLS[side][0] else st
        d.text((px, py + TH // 2 + 2), f"{num:02d}: {sp}", fill="black")
    M.save(MONTAGE); print(f"Montage -> {MONTAGE}")

    if DEBUG:
        dy = int(page_noteY * TH)
        C = 2; rows = (len(cells) + C - 1) // C; pad = 10; cw = TW; ch = TH + 18
        M2 = Image.new("RGB", (C * (cw + pad) + pad, rows * (ch + pad) + pad), "white"); d = ImageDraw.Draw(M2)
        for i, (num, side, crop) in enumerate(cells):
            rr, cc = divmod(i, C); px, py = pad + cc * (cw + pad), pad + rr * (ch + pad)
            im = crop.convert("RGB"); dd = ImageDraw.Draw(im)
            for f in XS[side]:
                xx = int(f * TW); dd.ellipse([xx - 5, dy - 5, xx + 5, dy + 5], outline=(230, 0, 0), width=2)
            M2.paste(im, (px, py)); d.text((px, py + TH), f"{num}: {counts[num]} notes", fill="black")
        M2.save(STEMS_DBG); print(f"Debug -> {STEMS_DBG}")

if __name__ == "__main__":
    main()
