#!/usr/bin/env python3
"""
Generate the "Triplets" exercises (book page 8 / PDF page 10) as static assets.

One-time, offline build tool. Cuts exercises 1-24 into uniform PNG crops, reads the
printed R/L sticking with Claude vision, and MERGES them into the shared manifest the
app loads directly (preserving the Single Beat Combinations already there). No DB, no
admin UI, no runtime vision.

Sibling of generate-single-beat.py — same pipeline, two differences that matter:
  * the rhythm is eighth-note TRIPLETS, so each note carries tuplet {"n":3,"of":2};
  * 24 notes/exercise (2 measures x 12) instead of 16, so 24 R/L letters are read.

Outputs:
  client/public/exercises/triplet-001.png ... triplet-024.png
  client/public/exercises/exercises.json   (MERGED: drops old "Triplets", keeps the rest)
  scripts/_montage_verify_triplets.png      (crops with read sticking printed under each)
  scripts/_stems_debug_triplets.png         (crops with detected stem x's drawn, --debug)

Requires: pymupdf pillow numpy anthropic   (+ ANTHROPIC_API_KEY / CLAUDE_MODEL)
Usage:    python scripts/generate-triplets.py [--no-vision] [--debug]

Layout facts (PDF page 10): 2 columns x 12 rows = 24 exercises; cut time (2/2);
2 measures of 4 triplet-groups = 24 eighth-note-triplet notes = 24 printed R/L letters.
Numbering is column-major: left column = 1-12, right column = 13-24 -> triplet-NNN
matches the printed number.
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
MONTAGE    = os.path.join(ROOT, "scripts", "_montage_verify_triplets.png")
STEMS_DBG  = os.path.join(ROOT, "scripts", "_stems_debug_triplets.png")
ENV_PATH   = os.path.join(ROOT, "server", ".env")

PAGES      = [10]               # 1-based PDF page = Triplets (book page 8)
DPI        = 300
PADT, PADB = 6, 8               # px above beams/triplet-numbers and below sticking row
TW, TH     = 980, 200           # uniform crop size (a touch taller than single-beat for the "3"s)
# Per measure (cut time, 2 half-note beats): beat 1 = 4 straight eighths (no bracket),
# beat 2 = 6 eighth-note triplets (two "3" groups). 2 measures -> 20 notes / 20 R-L letters.
NOTES      = 20
STRAIGHT, TRIPLET = 4, 6        # notes in each half-beat group, repeated per measure
SECTION    = "Triplets"
# Each exercise's note-span [firstStem, lastStem] is affine-mapped to this fixed
# fraction of the output width, so beat-1 and beat-last land identically on all 24.
FX0, FX1   = 0.025, 0.93
NOTEHEAD_DX = -0.006            # noteheads sit just left of their (upward) stems

CACHE_PATH = os.path.join(ROOT, "scripts", "_sticking_cache_triplets.json")     # vision reuse
GT_PATH    = os.path.join(ROOT, "scripts", "triplet-sticking.json")             # authoritative (hand-verified)
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

def _max_run(col):
    best = c = 0
    for v in col:
        if v: c += 1; best = max(best, c)
        else: c = 0
    return best

def notehead_row(ink, a, b, xl, xh):
    """The y of the row the noteheads sit on: the densest row in the staff span whose
    longest continuous run is short (a staff line is one long run; a notehead row is
    ~24 short blobs -> high total ink, short max run)."""
    best = (-1, (a + b) // 2)
    for y in range(a + 30, b - 25):
        row = ink[y, xl:xh]
        if _max_run(row) > 55:  # staff line -> skip
            continue
        c = int(row.sum())
        if c > best[0]: best = (c, y)
    return best[1]

def notehead_centers(ink, a, b, xl, xh, min_stem=28, top_skip=26, win=56):
    """Center x of each NOTE, left to right, plus the notehead row y.

    We locate notes by their STEMS — clean, well-separated tall verticals in the beam zone
    just above the staff, one per note. This is far steadier than reading the noteheads
    themselves, which fragment at a single sampling row in this engraving. Two intruders
    reach into the stem band and must be removed:
      * the clef / ¢ symbol — they live down at the staff, never up in the beam zone, so
        a stem-zone search simply never sees them;
      * barlines (the centre barline, and edge repeat barlines) — these DO show as tall
        verticals, but unlike an up-stem they continue BELOW the notehead row through the
        lower staff. So we drop any vertical that has a long run beneath the head.
    """
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
        below = _max_run(ink[ny + 10:b - 5, cx])   # barline keeps going down; a stem stops
        if below < 22: centers.append(cx)
    return centers, ny

def affine_crop(img, beamX0, beamX1, y0, y1):
    """Map source [beamX0,beamX1] -> output [FX0,FX1]*TW so every crop's first/last
    note land at the same output fraction. Returns a TW x TH grayscale PIL image."""
    span = beamX1 - beamX0
    Wsrc = span / (FX1 - FX0)
    x0 = beamX0 - FX0 * Wsrc
    region = img[y0:y1, max(0, int(round(x0))):int(round(x0 + Wsrc))]
    return Image.fromarray(region).resize((TW, TH))

# ---------------------------------------------------------------- vision sticking
STICK_PROMPT = (
    "This image is one line of snare-drum notation with a sticking letter (each either R "
    "or L) printed under every note. There are exactly 20 letters. Read them strictly left "
    "to right and return ONLY those 20 letters as one uppercase string, no spaces, no other "
    "text. Example format: RLRLRLRLRLRLRLRLRLRL"
)

def read_sticking(client, png_bytes):
    b64 = base64.b64encode(png_bytes).decode()
    letters = ""
    for attempt in range(2):
        try:
            msg = client.messages.create(
                model=MODEL, max_tokens=80,
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
    return letters, False

# ---------------------------------------------------------------- exercise object
def build_exercise(num, img_rel, noteY, sticking, aligned, xs):
    MPER = STRAIGHT + TRIPLET     # 10 notes per measure
    def measure(hands, xslice):   # beat 1: 4 straight eighths; beat 2: 6 eighth-triplets
        def ev(i, tup):
            return {"type": "note", "value": "eighth", "dots": 0, "tuplet": tup,
                    "hand": (hands[i] if i < len(hands) else None), "x": xslice[i], "tie": False}
        events = [ev(i, None) for i in range(STRAIGHT)] + \
                 [ev(i, {"n": 3, "of": 2}) for i in range(STRAIGHT, MPER)]
        return {"voices": [{"inst": "snare", "stem": "up", "events": events}]}
    return {
        "id": f"triplet-{num:03d}",
        "name": f"Triplet · {num}",
        "section": SECTION,
        "img": img_rel,
        "noteY": round(noteY, 4),
        "aligned": aligned,
        "timeSig": "¢",
        "time": {"num": 2, "den": 2},
        "meter": "cut time (2/2)",
        "noteValue": "eighths + triplets",
        "measureBeats": 4,
        "measures": [measure(sticking[0:MPER], xs[0:MPER]),
                     measure(sticking[MPER:2 * MPER], xs[MPER:2 * MPER])],
    }

# ---------------------------------------------------------------- main
def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    doc = fitz.open(PDF_PATH)

    # This is a clean digital PDF render (not a photo): every row in a column is
    # pixel-identical. So we don't need flawless per-line detection — we take the
    # CONSENSUS note-span from the lines that detect exactly 24 noteheads and apply it
    # to every line in that column. Edge garbage (clef, ¢, repeat barlines) only spoils
    # the count on some lines; those lines still get the column's correct, clean span.
    lines = []        # (num, side, a, b, heads)  per exercise
    stem_counts = {}  # num -> detected notehead count (for the run report)
    page_noteY = None
    for pi, pg in enumerate(PAGES):
        img = render_page(doc, pg); H, W = img.shape; ink = (img < 128).astype(np.uint8)
        bands = row_bands(ink, H)
        assert len(bands) == 12, f"page {pg}: expected 12 row-bands, got {len(bands)}"
        g = gutter_x(ink, W)
        columns = [("L", 120, g - 10), ("R", g + 10, W - 30)]

        ny_fracs = []
        for r, (a, b) in enumerate(bands):
            for side, xl, xh in columns:
                heads, ny = notehead_centers(ink, a, b, xl, xh)
                assert heads, f"page {pg} row {r} {side}: no noteheads detected"
                num = pi * 24 + (r + 1 if side == "L" else r + 13)
                lines.append((num, side, a, b, heads))
                stem_counts[num] = len(heads)
                ny_fracs.append((ny - (a - PADT)) / ((b + PADB) - (a - PADT)))
        page_noteY = float(np.median(ny_fracs))   # uniform section -> one robust value
    page_img = img   # single page; keep for cropping

    good = sum(1 for n in stem_counts.values() if n == NOTES)
    print(f"notehead detection: {good}/24 lines gave exactly {NOTES} heads")
    off = {num: c for num, c in sorted(stem_counts.items()) if c != NOTES}
    if off: print(f"  lines off {NOTES} (use column consensus span): {off}")

    # consensus note-span per column from the clean (==24) lines -> bx0,bx1 for cropping.
    span = {}
    for side in ("L", "R"):
        clean = [hs for (num, sd, a, b, hs) in lines if sd == side and len(hs) == NOTES]
        assert clean, f"column {side}: no line detected exactly {NOTES} heads — cannot fix span"
        arr = np.array(clean)
        med = np.median(arr, axis=0)
        span[side] = (float(med[0]), float(med[-1]))
    # baked output-fractions (the highlight-dot x), from ALL clean lines, column-independent.
    note_fracs = []
    for (num, sd, a, b, hs) in lines:
        if len(hs) == NOTES:
            bx0, bx1 = span[sd]
            note_fracs.append([FX0 + (x - bx0) / (bx1 - bx0) * (FX1 - FX0) for x in hs])

    # build the crops using each column's consensus span (identical span -> aligned crops)
    cells = []        # (num, crop_PIL, noteY_frac)
    stem_fracs = {}   # num -> this line's detected head fractions under the consensus span
    for (num, sd, a, b, hs) in lines:
        bx0, bx1 = span[sd]
        crop = affine_crop(page_img, bx0, bx1, a - PADT, b + PADB)
        cells.append((num, crop, page_noteY))
        stem_fracs[num] = [FX0 + (x - bx0) / (bx1 - bx0) * (FX1 - FX0) for x in hs]
    cells.sort(key=lambda t: t[0])
    assert len(cells) == 24, f"expected 24 exercises, got {len(cells)}"

    # Baked x = the REAL notehead positions (median across all clean lines, identical for
    # all 24 by construction -> dot sits on each printed notehead AND is consistent).
    # Timing still comes from durations, so it stays metronome-locked. Falls back to even.
    if note_fracs:
        med = np.median(np.array(note_fracs), axis=0)
        XS = [round(min(max(float(v) + NOTEHEAD_DX, 0.0), 1.0), 4) for v in med]
    else:
        XS = [round(FX0 + i * (FX1 - FX0) / (NOTES - 1), 4) for i in range(NOTES)]
    print(f"{len(note_fracs)}/24 lines gave {NOTES} stems for the baked notehead x")

    if DEBUG:   # draw the BAKED dots (XS @ noteY) on each crop — exactly what the app shows
        C = 2; R = (len(cells) + C - 1) // C; pad = 10; cw = TW; ch = TH + 20
        M = Image.new("RGB", (C * (cw + pad) + pad, R * (ch + pad) + pad), "white")
        d = ImageDraw.Draw(M)
        dy = int(page_noteY * TH)
        for i, (num, crop, _) in enumerate(cells):
            rr, cc = divmod(i, C); px, py = pad + cc * (cw + pad), pad + rr * (ch + pad)
            im = crop.convert("RGB"); dd = ImageDraw.Draw(im)
            for fr in XS:                       # the actual highlight-dot positions, in red
                xx = int(fr * TW); dd.ellipse([xx - 5, dy - 5, xx + 5, dy + 5], outline=(230, 0, 0), width=2)
            M.paste(im, (px, py))
            d.text((px, py + TH + 2), f"{num:02d}: {stem_counts[num]} heads", fill="black")
        M.save(STEMS_DBG); print(f"Baked-dot debug montage -> {STEMS_DBG}")

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
        for num, _ in need_vision: sticking[num] = ("RL" * 10, False, "placeholder")

    # refresh cache with any newly read stickings
    for num, (letters, ok, src) in sticking.items():
        if ok and src == "vision": cache[str(num)] = letters
    json.dump(cache, open(CACHE_PATH, "w"), indent=0)

    # write PNGs + the new triplet exercise objects
    new_exs = []
    for num, crop, noteY in cells:
        fn = f"triplet-{num:03d}.png"
        crop.save(os.path.join(OUT_DIR, fn))
        letters, ok, _ = sticking[num]
        new_exs.append(build_exercise(num, f"/exercises/{fn}", noteY, letters, ok, XS))

    # MERGE into the shared manifest: keep every other section, replace "Triplets".
    existing = load_json(MANIFEST) if os.path.exists(MANIFEST) else []
    kept = [e for e in existing if e.get("section") != SECTION]
    merged = kept + new_exs
    with open(MANIFEST, "w") as f:
        json.dump(merged, f, ensure_ascii=False, indent=1)

    srcs = {}
    for _, _, s in sticking.values(): srcs[s] = srcs.get(s, 0) + 1
    bad = [n for n, (l, ok, s) in sticking.items() if not ok]
    print(f"\nWrote {len(new_exs)} Triplets exercises; manifest now has {len(merged)} total "
          f"({len(kept)} kept + {len(new_exs)} triplets).")
    print(f"noteY (per page): {sorted({m['noteY'] for m in new_exs})}")
    print(f"sticking sources: {srcs}")
    if bad: print(f"!! sticking failed {NOTES}xR/L for: {bad}")
    else:   print(f"All 24 stickings passed the {NOTES}xR/L length check.")

    # verification montage: crop + sticking under each (catches R<->L swaps by eye)
    C = 2; R = (len(cells) + C - 1) // C; pad = 10; cw = TW; ch = TH // 2 + 20
    M = Image.new("RGB", (C * (cw + pad) + pad, R * (ch + pad) + pad), "white")
    d = ImageDraw.Draw(M)
    for i, (num, crop, _) in enumerate(cells):
        rr, cc = divmod(i, C); px, py = pad + cc * (cw + pad), pad + rr * (ch + pad)
        M.paste(crop.convert("RGB").resize((cw, TH // 2)), (px, py))
        letters, ok, _ = sticking[num]
        # group as the rhythm reads: straight(4) triplet(6) | straight(4) triplet(6)
        g = STRAIGHT, STRAIGHT + TRIPLET, 2 * STRAIGHT + TRIPLET
        spaced = (f"{letters[:g[0]]} {letters[g[0]:g[1]]} | "
                  f"{letters[g[1]:g[1]+STRAIGHT]} {letters[g[1]+STRAIGHT:]}") if len(letters) == NOTES else letters
        d.text((px, py + TH // 2 + 2), f"{num:02d}: {spaced}{'' if ok else '  CHECK'}", fill="black")
    M.save(MONTAGE)
    print(f"Montage (with stickings) -> {MONTAGE}")

if __name__ == "__main__":
    main()
