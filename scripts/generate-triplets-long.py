#!/usr/bin/env python3
"""
Generate the long "Triplets" combination exercises (book page 9 / PDF page 11) as
static assets, continuing the Triplets section after the 24 short ones from page 10.

One-time, offline build tool. Page 11 has 12 full-width staff lines; every line is the
SAME shape — 4 measures = [10, 10, 10, 12] notes:
  * measures 1-3: beat 1 = 4 straight eighths, beat 2 = 6 eighth-note triplets  (10)
  * measure 4   : 4 triplet groups = 12 eighth-note triplets                    (12)
-> 42 notes / 42 R-L letters per line. Timing fills cut time exactly either way
(4*0.5 + 6/3 = 4q ; 12/3 = 4q).

The 12 lines group into 9 numbered exercises (some span two lines):
  ex1-4 = 1 line, ex5-7 = 2 lines, ex8-9 = 1 line.
A two-line exercise is one 8-measure phrase; we render it as ONE wide strip (the two
line crops concatenated horizontally) so the single-row player still works, and the app
auto-scrolls the strip to follow the highlight. These continue the Triplets numbering as
triplet-025 .. triplet-033 (book #1..#9 on the page).

Outputs:
  client/public/exercises/triplet-025.png ... triplet-033.png
  client/public/exercises/exercises.json   (MERGED: keeps everything else, replaces these)
  scripts/_montage_verify_triplets_long.png
  scripts/_stems_debug_triplets_long.png    (--debug)

Requires: pymupdf pillow numpy anthropic   (+ ANTHROPIC_API_KEY / CLAUDE_MODEL)
Usage:    python scripts/generate-triplets-long.py [--no-vision] [--debug]
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
MONTAGE    = os.path.join(ROOT, "scripts", "_montage_verify_triplets_long.png")
STEMS_DBG  = os.path.join(ROOT, "scripts", "_stems_debug_triplets_long.png")
ENV_PATH   = os.path.join(ROOT, "server", ".env")

PAGE       = 11
DPI        = 300
PADT, PADB = 6, 8
TW_LINE, TH = 2000, 200          # per-line crop size (wide -> app scrolls). 42 notes/line.
SECTION    = "Triplets"
START_NUM  = 25                  # continues page 10's triplet-001..024
FX0, FX1   = 0.02, 0.95
NOTEHEAD_DX = -0.003             # noteheads sit just left of their (upward) stems (in line frac)

# Which bands form each numbered exercise (0-based band indices, top to bottom).
EXERCISE_BANDS = [[0], [1], [2], [3], [4, 5], [6, 7], [8, 9], [10], [11]]
# Per-line measure shape: (straight-eighths, triplet-eighths) for each of the 4 measures.
LINE_GROUPS = [(4, 6), (4, 6), (4, 6), (0, 12)]
NOTES_PER_LINE = sum(s + t for s, t in LINE_GROUPS)   # 42

CACHE_PATH = os.path.join(ROOT, "scripts", "_sticking_cache_triplets_long.json")
GT_PATH    = os.path.join(ROOT, "scripts", "triplet-long-sticking.json")  # per-LINE (band) sticking
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

def row_bands(ink, H):
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
        if merged and b[0] - merged[-1][1] < 55: merged[-1][1] = b[1]
        else: merged.append(b)
    return [m for m in merged if m[1] - m[0] > 120]

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
        if _max_run(row) > 55: continue          # staff line
        c = int(row.sum())
        if c > best[0]: best = (c, y)
    return best[1]

def line_notes(ink, a, b, xl, xh, min_stem=28, top_skip=26, win=56):
    """Return (note_x_list, notehead_row_y). Notes are stems in the beam zone whose ink
    does NOT continue below the head (that test drops the clef, ¢, and every barline).
    Anything left of the first dropped vertical (the clef on line 1, or the opening
    barline) is excluded too, so leftover clef bits never count."""
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
    notes, bars = [], []
    for c0, c1 in clusters:
        cx = (c0 + c1) // 2
        below = _max_run(ink[ny + 10:b - 5, cx])
        (bars if below >= 22 else notes).append(cx)
    first_bar = bars[0] if bars else xl
    notes = [x for x in notes if x > first_bar]   # drop clef / pre-barline glyphs
    return notes, ny

def affine_crop(img, bx0, bx1, y0, y1):
    span = bx1 - bx0
    Wsrc = span / (FX1 - FX0)
    x0 = bx0 - FX0 * Wsrc
    region = img[y0:y1, max(0, int(round(x0))):int(round(x0 + Wsrc))]
    return Image.fromarray(region).resize((TW_LINE, TH))

# ---------------------------------------------------------------- vision sticking
STICK_PROMPT = (
    "This image is ONE line of snare-drum notation with a sticking letter (each either R "
    "or L) printed under every note. There are exactly 42 letters. Read them strictly left "
    "to right and return ONLY those 42 letters as one uppercase string, no spaces, no other "
    "text."
)

def read_sticking(client, png_bytes):
    b64 = base64.b64encode(png_bytes).decode()
    letters = ""
    for _ in range(2):
        try:
            msg = client.messages.create(
                model=MODEL, max_tokens=120,
                messages=[{"role": "user", "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": b64}},
                    {"type": "text", "text": STICK_PROMPT},
                ]}],
            )
            txt = "".join(b.text for b in msg.content if b.type == "text")
            letters = re.sub(r"[^RL]", "", txt.upper())
            if len(letters) == NOTES_PER_LINE: return letters, True
        except Exception as e:
            print(f"   vision error: {e}")
    return letters, False

# ---------------------------------------------------------------- exercise object
def line_measures(hands, xs):
    """4 measures for one line from its 42 (hand, x) notes, in the fixed LINE_GROUPS shape."""
    def ev(i, tup):
        return {"type": "note", "value": "eighth", "dots": 0, "tuplet": tup,
                "hand": (hands[i] if i < len(hands) else None), "x": xs[i], "tie": False}
    out = []; idx = 0
    for straight, trip in LINE_GROUPS:
        evs = [ev(idx + k, None) for k in range(straight)]
        idx += straight
        evs += [ev(idx + k, {"n": 3, "of": 2}) for k in range(trip)]
        idx += trip
        out.append({"voices": [{"inst": "snare", "stem": "up", "events": evs}]})
    return out

def build_exercise(num, img_rel, noteY, nlines, hands, xs):
    measures = []
    for li in range(nlines):
        seg = slice(li * NOTES_PER_LINE, (li + 1) * NOTES_PER_LINE)
        measures += line_measures(hands[seg], xs[seg])
    ok = len(hands) == nlines * NOTES_PER_LINE and set(hands) <= {"R", "L"}
    return {
        "id": f"triplet-{num:03d}",
        "name": f"Triplet · {num}",
        "section": SECTION,
        "img": img_rel,
        "noteY": round(noteY, 4),
        "aligned": ok,
        "timeSig": "¢",
        "time": {"num": 2, "den": 2},
        "meter": "cut time (2/2)",
        "noteValue": "eighths + triplets",
        "measureBeats": 4,
        "lines": nlines,                      # 2 -> wide strip; the app scrolls long ones
        "measures": measures,
    }

# ---------------------------------------------------------------- main
def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    doc = fitz.open(PDF_PATH)
    img = render_page(doc, PAGE); H, W = img.shape; ink = (img < 128).astype(np.uint8)
    bands = row_bands(ink, H)
    assert len(bands) == 12, f"page {PAGE}: expected 12 lines, got {len(bands)}"
    xl, xh = 120, W - 30

    # per-line detection
    line_x = []     # band -> [42 source-x]
    line_ny = []
    for k, (a, b) in enumerate(bands):
        notes, ny = line_notes(ink, a, b, xl, xh)
        line_x.append(notes); line_ny.append(ny)
        flag = "" if len(notes) == NOTES_PER_LINE else f"  << {len(notes)} (expected {NOTES_PER_LINE})"
        print(f"  band {k:2d}: {len(notes)} notes{flag}")
    bad = [k for k in range(12) if len(line_x[k]) != NOTES_PER_LINE]
    assert not bad, f"lines off {NOTES_PER_LINE} notes: {bad}"
    page_noteY = float(np.median([(line_ny[k] - (bands[k][0] - PADT)) /
                                  ((bands[k][1] + PADB) - (bands[k][0] - PADT)) for k in range(12)]))

    # per-line affine crop + per-line note output-fractions (within [FX0,FX1])
    line_crop, line_frac = [], []
    for k, (a, b) in enumerate(bands):
        xs = line_x[k]; bx0, bx1 = xs[0], xs[-1]
        line_crop.append(affine_crop(img, bx0, bx1, a - PADT, b + PADB))
        fr = [FX0 + (x - bx0) / (bx1 - bx0) * (FX1 - FX0) for x in xs]
        fr = [min(max(f + NOTEHEAD_DX, 0.0), 1.0) for f in fr]
        line_frac.append(fr)

    # sticking per LINE: ground truth > cache > vision
    def load_json(p): return json.load(open(p)) if os.path.exists(p) else {}
    GT, cache = load_json(GT_PATH), load_json(CACHE_PATH)
    def png_bytes(im):
        buf = io.BytesIO(); im.save(buf, "PNG"); return buf.getvalue()
    def valid(s): return isinstance(s, str) and len(s) == NOTES_PER_LINE and set(s) <= {"R", "L"}

    line_stick = {}; need = []
    for k in range(12):
        key = str(k)
        if valid(GT.get(key)):      line_stick[k] = GT[key]
        elif valid(cache.get(key)): line_stick[k] = cache[key]
        else:                       need.append(k)
    if need and USE_VISION:
        if not KEY: print("!! ANTHROPIC_API_KEY missing; use --no-vision."); sys.exit(1)
        import anthropic
        client = anthropic.Anthropic(api_key=KEY)
        print(f"Reading sticking via {MODEL} for {len(need)} lines...")
        def do(k):
            letters, okv = read_sticking(client, png_bytes(line_crop[k]))
            print(f"  band {k:2d}: {letters or '----'} {'' if okv else '<< CHECK'}")
            return k, letters, okv
        with ThreadPoolExecutor(max_workers=6) as ex:
            for k, letters, okv in ex.map(do, need):
                line_stick[k] = letters
                if okv: cache[str(k)] = letters
    elif need:
        for k in need: line_stick[k] = "RL" * (NOTES_PER_LINE // 2)
    json.dump(cache, open(CACHE_PATH, "w"), indent=0)

    # assemble the 9 exercises, concatenating 2-line strips horizontally
    new_exs = []
    for ei, bandset in enumerate(EXERCISE_BANDS):
        num = START_NUM + ei
        nlines = len(bandset)
        strip = Image.new("L", (TW_LINE * nlines, TH), 255)
        hands, xs = "", []
        for li, k in enumerate(bandset):
            strip.paste(line_crop[k], (li * TW_LINE, 0))
            hands += line_stick[k]
            xs += [round(li / nlines + f / nlines, 4) for f in line_frac[k]]
        fn = f"triplet-{num:03d}.png"
        strip.save(os.path.join(OUT_DIR, fn))
        new_exs.append(build_exercise(num, f"/exercises/{fn}", page_noteY, nlines, hands, list(xs)))

    # MERGE: keep everything except the page-11 ids we own; preserve page-10 triplets + single-beat
    owned = {f"triplet-{START_NUM + i:03d}" for i in range(len(EXERCISE_BANDS))}
    existing = load_json(MANIFEST) if os.path.exists(MANIFEST) else []
    kept = [e for e in existing if e.get("id") not in owned]
    merged = kept + new_exs
    with open(MANIFEST, "w") as f:
        json.dump(merged, f, ensure_ascii=False, indent=1)

    nbad = [e["id"] for e in new_exs if not e["aligned"]]
    print(f"\nWrote {len(new_exs)} long Triplets exercises; manifest now {len(merged)} total "
          f"({len(kept)} kept + {len(new_exs)}).")
    print(f"noteY: {page_noteY:.4f}")
    if nbad: print(f"!! sticking not valid for: {nbad}")
    else:    print("All lines have valid 42x R/L sticking.")

    # verification montage: each line crop (scaled) + its sticking grouped to read the rhythm
    def grouped(s):  # 4 6 | 4 6 | 4 6 | 12
        i = 0; parts = []
        for straight, trip in LINE_GROUPS:
            parts.append(s[i:i + straight] + ("·" + s[i + straight:i + straight + trip] if straight else s[i:i + trip]))
            i += straight + trip
        return " | ".join(p for p in parts)
    rows = []
    for k in range(12):
        rows.append((k, line_crop[k], line_stick[k]))
    cw = 1900; ch = 70 + 22
    M = Image.new("RGB", (cw + 20, (ch + 8) * 12 + 8), "white"); d = ImageDraw.Draw(M)
    for i, (k, crop, st) in enumerate(rows):
        y = 8 + i * (ch + 8)
        M.paste(crop.convert("RGB").resize((cw, 70)), (10, y))
        d.text((10, y + 72), f"band {k:2d}: {grouped(st)}", fill="black")
    M.save(MONTAGE); print(f"Montage -> {MONTAGE}")

    if DEBUG:
        dy = int(page_noteY * TH)
        M2 = Image.new("RGB", (TW_LINE + 20, (TH + 14) * 12 + 8), "white"); d = ImageDraw.Draw(M2)
        for k in range(12):
            y = 8 + k * (TH + 14)
            im = line_crop[k].convert("RGB"); dd = ImageDraw.Draw(im)
            for f in line_frac[k]:
                xx = int(f * TW_LINE); dd.ellipse([xx - 5, dy - 5, xx + 5, dy + 5], outline=(230, 0, 0), width=2)
            M2.paste(im, (10, y)); d.text((10, y + TH), f"band {k}: {len(line_x[k])} notes", fill="black")
        M2.save(STEMS_DBG); print(f"Debug -> {STEMS_DBG}")

if __name__ == "__main__":
    main()
