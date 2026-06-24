#!/usr/bin/env python3
"""
Generate the "Single Beat Combinations" exercises as static assets.

One-time, offline build tool. Cuts exercises 1-72 (PDF pages 7-9 of the book) into
uniform PNG crops, reads the printed R/L sticking with Claude vision, and writes a
static manifest the app loads directly. No DB, no admin UI, no runtime vision.

Outputs:
  client/public/exercises/single-beat-001.png ... single-beat-072.png
  client/public/exercises/exercises.json
  scripts/_montage_verify.png   (crops with read sticking printed under each)

Requires: pymupdf pillow numpy anthropic   (+ ANTHROPIC_API_KEY / CLAUDE_MODEL)
Usage:    python scripts/generate-single-beat.py [--no-vision]

Layout facts (all three pages identical): 2 columns x 12 rows = 24 exercises/page;
cut time (2/2); 2 measures of 8 eighth-notes = 16 notes; 16 printed R/L letters.
Numbering is column-major: left column = lower numbers, right = higher
(p7: 1-12 / 13-24, p8: 25-48, p9: 49-72) -> single-beat-NNN matches the printed number.
"""
import os, sys, json, base64, io, re
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import fitz
from PIL import Image, ImageDraw

# ---------------------------------------------------------------- paths / config
ROOT       = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PDF_PATH   = os.path.expanduser("~/Desktop/Stick Control.pdf")
OUT_DIR    = os.path.join(ROOT, "client", "public", "exercises")
MONTAGE    = os.path.join(ROOT, "scripts", "_montage_verify.png")
ENV_PATH   = os.path.join(ROOT, "server", ".env")

PAGES      = [7, 8, 9]          # 1-based PDF pages = Single Beat Combinations
DPI        = 300
PADT, PADB = 6, 8               # px above beams / below sticking row
TW, TH     = 980, 184           # uniform crop size
NOTES      = 16                 # eighth-notes per exercise
# Each exercise's note-span [firstStem, lastStem] is affine-mapped to this fixed
# fraction of the output width, so beat-1 and beat-last land identically on all 72.
FX0, FX1   = 0.025, 0.93
NOTEHEAD_DX = -0.007            # noteheads sit just left of their (upward) stems

CACHE_PATH = os.path.join(ROOT, "scripts", "_sticking_cache.json")   # vision reuse
GT_PATH    = os.path.join(ROOT, "scripts", "single-beat-sticking.json")  # authoritative (hand-verified)
USE_VISION = "--no-vision" not in sys.argv

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
    mat = fitz.Matrix(DPI / 72, DPI / 72)
    pix = doc[pno - 1].get_pixmap(matrix=mat, colorspace=fitz.csGRAY)
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
        if merged and b[0] - merged[-1][1] < 60: merged[-1][1] = b[1]
        else: merged.append(b)
    return [m for m in merged if m[1] - m[0] > 120]

def gutter_x(ink, W):
    cs = ink.sum(axis=0); lo, hi = int(W * 0.40), int(W * 0.60)
    return lo + int(np.argmin(cs[lo:hi]))

def bridged_run(rowmask, xl, xh, gap=40):
    best = 0; s = None; last = None; g = 0
    for x in range(xl, xh):
        if rowmask[x]:
            if s is None: s = x
            last = x; g = 0
        else:
            if s is not None:
                g += 1
                if g > gap: best = max(best, last - s); s = None
    if s is not None: best = max(best, last - s)
    return best

def staff_y(ink, a, b, xl, xh):
    """Staff line row: widest continuous horizontal run, searched only in the staff
    band (skip the top beam zone and the bottom sticking-letter zone)."""
    best = (-1, a)
    for y in range(a + 45, b - 60):
        L = bridged_run(ink[y], xl, xh)
        if L > best[0]: best = (L, y)
    return best[1]

def _max_run(col):
    best = c = 0
    for v in col:
        if v: c += 1; best = max(best, c)
        else: c = 0
    return best

def stem_centers(ink, a, xl, xh, min_stem=28):
    """Center x of each NOTE STEM — tall thin verticals (~40-60px) over each notehead.
    Tall vertical runs (>= min_stem) isolate stems from the clef curve, the staff line,
    and the short `*` footnote above ex1 (all too short). Returns one x per stem; for
    this section that is the 16 noteheads, left to right."""
    sub = ink[a + 2:a + 58]
    on = [_max_run(sub[:, x]) >= min_stem for x in range(xl, xh)]
    clusters = []; s = None
    for i, v in enumerate(on):
        if v:
            if s is None: s = i
        elif s is not None:
            clusters.append((xl + s, xl + i - 1)); s = None
    if s is not None: clusters.append((xl + s, xl + len(on) - 1))
    return [(c0 + c1) // 2 for c0, c1 in clusters]

def beam_extent(ink, a, b, xl, xh):
    """First/last note x (the outer stems)."""
    c = stem_centers(ink, a, xl, xh)
    return (c[0], c[-1]) if c else (None, None)

def affine_crop(img, beamX0, beamX1, y0, y1):
    """Map source [beamX0,beamX1] -> output [FX0,FX1]*TW so every crop's first/last
    note land at the same output fraction. Returns a TW x TH grayscale PIL image."""
    span = beamX1 - beamX0
    Wsrc = span / (FX1 - FX0)
    x0 = beamX0 - FX0 * Wsrc
    region = img[y0:y1, max(0, int(round(x0))):int(round(x0 + Wsrc))]
    # pad if the window runs past the page edge so width is exact before resize
    return Image.fromarray(region).resize((TW, TH))

# ---------------------------------------------------------------- vision sticking
STICK_PROMPT = (
    "This image is one line of snare-drum notation with sticking letters (each either "
    "R or L) printed under the notes. There are exactly 16 letters. Read them strictly "
    "left to right and return ONLY those 16 letters as one uppercase string, no spaces, "
    "no other text. Example format: RLRLRLRLRLRLRLRL"
)

def read_sticking(client, png_bytes):
    b64 = base64.b64encode(png_bytes).decode()
    for attempt in range(2):
        try:
            msg = client.messages.create(
                model=MODEL, max_tokens=64,
                messages=[{"role": "user", "content": [
                    {"type": "image", "source": {"type": "base64",
                        "media_type": "image/png", "data": b64}},
                    {"type": "text", "text": STICK_PROMPT},
                ]}],
            )
            txt = "".join(b.text for b in msg.content if b.type == "text")
            letters = re.sub(r"[^RL]", "", txt.upper())
            if len(letters) == NOTES:
                return letters, True
        except Exception as e:
            print(f"   vision error (attempt {attempt+1}): {e}")
    return (letters if 'letters' in dir() else ""), False

# ---------------------------------------------------------------- exercise object
def build_exercise(num, img_rel, noteY, sticking, aligned, xs):
    def measure(hands, xslice):
        return {"voices": [{"inst": "snare", "stem": "up", "events": [
            {"type": "note", "value": "eighth", "dots": 0, "tuplet": None,
             "hand": (hands[i] if i < len(hands) else None), "x": xslice[i], "tie": False}
            for i in range(8)
        ]}]}
    return {
        "id": f"single-beat-{num:03d}",
        "name": f"Single Beat · {num}",
        "section": "Single Beat Combinations",
        "img": img_rel,
        "noteY": round(noteY, 4),
        "aligned": aligned,
        "timeSig": "¢",
        "time": {"num": 2, "den": 2},
        "meter": "cut time (2/2)",
        "noteValue": "eighth notes",
        "measureBeats": 4,
        "measures": [measure(sticking[0:8], xs[0:8]), measure(sticking[8:16], xs[8:16])],
    }

# ---------------------------------------------------------------- main
def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    doc = fitz.open(PDF_PATH)

    # Each crop is affine-normalized so its note-span fills [FX0,FX1] of the output.
    # -> first/last note land at the same output fraction on all 72 (true alignment).
    cells = []   # (num, crop_PIL, noteY_frac)
    note_fracs = []   # per-cell: the 16 notehead output-fractions (for the highlight dot)
    for pi, pg in enumerate(PAGES):
        img = render_page(doc, pg); H, W = img.shape; ink = (img < 128).astype(np.uint8)
        bands = row_bands(ink, H)
        assert len(bands) == 12, f"page {pg}: expected 12 row-bands, got {len(bands)}"
        g = gutter_x(ink, W)
        columns = [("L", 120, g - 10), ("R", g + 10, W - 30)]
        assert len(columns) == 2

        # per-page median noteY (uniform section -> one value, robust to per-row noise)
        ny_fracs = []
        for a, b in bands:
            for side, xl, xh in columns:
                ny_fracs.append((staff_y(ink, a, b, xl, xh) - (a - PADT)) / ((b + PADB) - (a - PADT)))
        page_noteY = float(np.median(ny_fracs))

        for r, (a, b) in enumerate(bands):
            for side, xl, xh in columns:
                stems = stem_centers(ink, a, xl, xh)
                assert stems, f"page {pg} row {r} {side}: no stems detected"
                bx0, bx1 = stems[0], stems[-1]
                crop = affine_crop(img, bx0, bx1, a - PADT, b + PADB)
                num = pi * 24 + (r + 1 if side == "L" else r + 13)
                cells.append((num, crop, page_noteY))
                if len(stems) == NOTES:   # map this line's noteheads to output fractions
                    note_fracs.append([FX0 + (x - bx0) / (bx1 - bx0) * (FX1 - FX0) for x in stems])
    cells.sort(key=lambda t: t[0])
    assert len(cells) == 72, f"expected 72 exercises, got {len(cells)}"

    # Baked x = the REAL notehead positions (median across all lines, identical for all
    # 72 by construction -> dot sits on each printed notehead AND is consistent). Timing
    # still comes from durations, so it stays metronome-locked. Falls back to even spacing.
    if note_fracs:
        med = np.median(np.array(note_fracs), axis=0)
        XS = [round(min(max(float(v) + NOTEHEAD_DX, 0.0), 1.0), 4) for v in med]
    else:
        XS = [round(FX0 + i * (FX1 - FX0) / (NOTES - 1), 4) for i in range(NOTES)]
    print(f"{len(note_fracs)}/72 lines gave 16 stems; baked notehead x = {XS}")

    # sticking: ground-truth file (authoritative) > cache > vision. cache is saved so
    # crop geometry can be re-tuned without re-calling the API.
    def load_json(p): return json.load(open(p)) if os.path.exists(p) else {}
    GT    = load_json(GT_PATH)
    cache = load_json(CACHE_PATH)

    def png_bytes(im):
        buf = io.BytesIO(); im.save(buf, "PNG"); return buf.getvalue()

    def valid(s): return isinstance(s, str) and len(s) == NOTES and set(s) <= {"R", "L"}

    sticking = {}; need_vision = []
    for num, crop, _ in cells:
        if valid(GT.get(str(num))):      sticking[num] = (GT[str(num)], True, "gt")
        elif valid(cache.get(str(num))): sticking[num] = (cache[str(num)], True, "cache")
        else:                            need_vision.append((num, crop))

    if need_vision and USE_VISION:
        if not KEY:
            print("!! ANTHROPIC_API_KEY missing; run with --no-vision or set the key."); sys.exit(1)
        import anthropic
        client = anthropic.Anthropic(api_key=KEY)
        print(f"Reading sticking via {MODEL} for {len(need_vision)} exercises...")
        def do_read(item):
            num, crop = item
            letters, ok = read_sticking(client, png_bytes(crop))
            print(f"  ex {num:2d}: {letters or '----'} {'' if ok else '<< CHECK'}")
            return num, letters, ok
        with ThreadPoolExecutor(max_workers=6) as ex:
            for num, letters, ok in ex.map(do_read, need_vision):
                sticking[num] = (letters, ok, "vision")
    elif need_vision:
        for num, _ in need_vision: sticking[num] = ("RLRL" * 4, False, "placeholder")

    # refresh cache with any newly read stickings
    for num, (letters, ok, src) in sticking.items():
        if ok and src == "vision": cache[str(num)] = letters
    json.dump(cache, open(CACHE_PATH, "w"), indent=0)

    # write PNGs + manifest
    manifest = []
    for num, crop, noteY in cells:
        fn = f"single-beat-{num:03d}.png"
        crop.save(os.path.join(OUT_DIR, fn))
        letters, ok, _ = sticking[num]
        manifest.append(build_exercise(num, f"/exercises/{fn}", noteY, letters, ok, XS))
    with open(os.path.join(OUT_DIR, "exercises.json"), "w") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)

    srcs = {}
    for _, _, s in sticking.values(): srcs[s] = srcs.get(s, 0) + 1
    bad = [n for n, (l, ok, s) in sticking.items() if not ok]
    print(f"\nWrote {len(manifest)} exercises to {OUT_DIR}")
    print(f"noteY (per page): {sorted({m['noteY'] for m in manifest})}")
    print(f"sticking sources: {srcs}")
    if bad: print(f"!! sticking failed 16xR/L for: {bad}")
    else:   print("All 72 stickings passed the 16xR/L length check.")

    # verification montage: crop + sticking under each (catches R<->L swaps by eye)
    C = 4; R = (len(cells) + C - 1) // C; pad = 10; cw = TW // 2; ch = TH // 2 + 18
    M = Image.new("RGB", (C * (cw + pad) + pad, R * (ch + pad) + pad), "white")
    d = ImageDraw.Draw(M)
    for i, (num, crop, _) in enumerate(cells):
        rr, cc = divmod(i, C); px, py = pad + cc * (cw + pad), pad + rr * (ch + pad)
        M.paste(crop.convert("RGB").resize((cw, TH // 2)), (px, py))
        letters, ok, _ = sticking[num]
        d.text((px, py + TH // 2 + 2), f"{num:02d}: {letters}{'' if ok else '  CHECK'}", fill="black")
    M.save(MONTAGE)
    print(f"Montage (with stickings) -> {MONTAGE}")

if __name__ == "__main__":
    main()
