# Stick Control Studio — MERN Build Handoff

## Project Overview

A drum-rudiment practice app for George Lawrence Stone's *Stick Control for the Snare Drummer*. Users import page photos → the app straightens, crops, and detects noteheads → each exercise displays the real book image with a moving highlight locked to each note, a click track (beat-only or every-note), a settable tempo, and per-exercise progress tracking (reps, best tempo, time).

**Stack Target**: MERN (Mongo/Express/React/Node), Vite frontend, SCSS modules, mobile-first. Image processing on the server via OpenCV/Python.

---

## Data Model

### Exercise

```javascript
{
  id: string,                    // unique; e.g. "page5_ex1"
  name: string,                  // display name
  img: string,                   // dataURL of deskewed, centered, cropped image
  noteY: number,                 // [0,1] vertical position of notehead row
  aligned: boolean,              // true if noteheads detected with confidence
  timeSig: string,               // display; e.g. "¢" (cut time)
  meter: string,                 // display; e.g. "cut time (2/2)"
  noteValue: string,             // display; e.g. "eighth notes"
  measureBeats: number,          // beats per measure (usually 4 or 2)
  beats: Beat[]
}
```

### Beat

Each quarter-note pulse. Contains `sub` (notes per beat) and `notes`.

```javascript
{
  sub: number,                   // subdivision: 1=whole, 2=eighths, 3=triplets, 4=sixteenths
  notes: Note[]                  // array of notes in this beat
}
```

### Note

```javascript
{
  x: number | null,              // [0,1] horizontal position; null = no highlight dot
  h: "R" | "L" | null,          // hand (Right/Left); null = rest
  rest: boolean                  // true if a rest
}
// Example: {x:0.1234, h:"R"}  → notehead at 12.34% across, played with Right stick
// Example: {h:"L"}             → left hand, no dot (tied note or grace)
// Example: {rest:true}         → rest
```

### Beat Structure in the Model

Stick Control page 1 (single-beat combinations) has 16 eighth notes = 8 beats of 2 eighths each:

```javascript
beats: [
  {sub:2, notes:[{x:0.0717, h:"R"}, {x:0.1666, h:"L"}]},
  {sub:2, notes:[{x:0.2151, h:"R"}, {x:0.2643, h:"L"}]},
  // … 8 beats total
]
```

Each beat's first note has `beatStart:true` (audio click on beat), first beat of measure has `measureStart:true` (accent). The `flatten()` function spreads these across all notes for the player.

---

## Deskew → Crop → Center → Detect Pipeline

### The Problem

Phone photos of notation are tilted, have margins, and noteheads are hard to locate pixel-accurately. Need:
1. Straighten the staff
2. Crop to content
3. Center the staff vertically
4. Find each notehead's horizontal position (x) and the staff row (noteY)

### The Solution (Server-Side, Python + OpenCV)

**Input**: Photo dataURL or file path.  
**Output**: `{img: dataURL, fr: [x0, x1, …], noteY: y, aligned: bool}`

#### Step 1: Grayscale + Adaptive Threshold (Dark Map)

```python
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(float)
mean = cv2.blur(gray, (kernel,kernel))
dark = (gray < mean - 8).astype(uint8)  # dark pixels
```

Creates a binary map of all dark ink (staff, noteheads, sticking letters, beams).

#### Step 2: Deskew via Shear Search

Rotate the dark map until staff lines (rows with many dark pixels) have maximum variance (they're spread across the height, not bunched).

```python
for slope in [-0.10, -0.05, …, 0.05, 0.10]:
    shifted = shear_transform(dark, slope)
    row_variance = np.var([sum(row) for row in shifted])
    if row_variance > best: best = (slope, variance)
```

Apply the best slope to both the dark map and the grayscale image.

#### Step 3: Content Bounding Box

Find rows and columns with >4% dark pixels; add padding (~6px); crop.

```python
rows_with_content = [y for y in range(H) if sum(dark[y]) > W*0.04]
cols_with_content = [x for x in range(W) if sum(dark[:,x]) > H*0.03]
bbox = crop(rows_with_content, cols_with_content, pad=6)
```

#### Step 4: Staff Line Removal

Identify staff lines (rows with >50% dark pixels). Mark them in a separate map `isStaff[]`.

#### Step 5: Find Notehead Row (Critical)

Within the **staff vertical span** (not the entire image), find the densest non-staff row:

```python
for y in range(staff_top, staff_bottom):
    if isStaff[y]: continue
    count = sum(dark[y])
    if count > max_count: max_count = count; notehead_row = y
```

All 16 noteheads in a single-beat sit on one pitch, so they form a single dense row. This is more reliable than guessing.

#### Step 6: Blob Detection (Notehead Peaks)

Remove staff lines from the dark map:
```python
noteheads_only = dark.copy()
for y in range(H):
    if isStaff[y]: noteheads_only[y] = 0
```

Use `scipy.ndimage.label()` to find connected components. Filter by area (40–200 pixels) and aspect ratio (width 7–34px, height ≤30px). Exclude columns 0–10% and 90–100% (clef, barline).

```python
labeled, n_blobs = ndimage.label(noteheads_only)
for blob_id in range(1, n_blobs+1):
    ys, xs = np.where(labeled == blob_id)
    w = xs.max() - xs.min()
    h = ys.max() - ys.min()
    area = len(xs)
    if area >= 40 and 7 <= w <= 34 and h <= 30 and xs.mean()/W not in [0.05, 0.95]:
        centers.append(xs.mean() / W)
```

#### Step 7: Render (Grayscale, Gentle Stretch)

Don't output a hard B&W threshold — it breaks noteheads. Instead, render the straightened grayscale with a gentle brightness stretch:

```python
lo = np.percentile(gray_deskewed, 6)
hi = np.percentile(gray_deskewed, 94)
stretched = (gray_deskewed - lo) / (hi - lo) * 255
```

This keeps the photo look while improving contrast enough for the browser to display clearly.

#### Step 8: Return

```python
return {
  "img": base64_png(stretched_grayscale),
  "fr": [x0, x1, …, x15],  # 16 positions, normalized to [0,1]
  "noteY": notehead_row / height,
  "aligned": len(fr) >= 13 and len(fr) <= 19
}
```

### In-Browser Fallback

The current app runs this in the browser (JavaScript) for immediate feedback, but it's best-effort:
- Fast (instant) but less robust
- Works well on sharp, straight photos
- May miss noteheads on tilted or low-contrast images

**Server is the right home** for this pipeline.

---

## Timing Math

A note's **onset time** in seconds is calculated as:

```
onset_in_beats = sum of (1/beat.sub) for all beats up to this note
onset_in_seconds = (onset_in_beats / 4) * (60 / tempo_BPM)
```

Because all tempos are given as ♩ (quarter-note = beat unit).

### Example: Cut Time, 16 Eighths at ♩=76

- 2 measures, 8 beats, 2 eighths per beat (sub=2)
- Beat 0, note 0: t = (0.5/2) * (60/76) ≈ 0.197s
- Beat 0, note 1: t = (1/2) * (60/76) ≈ 0.395s
- Beat 1, note 0: t = (1.5/2) * (60/76) ≈ 0.592s
- …
- Beat 7, note 1: t = (8/2) * (60/76) ≈ 3.158s (end)

The **scheduler** fires voice clicks (metronome tones) and pushes note indices into a queue; the **draw loop** polls the queue and updates the highlight to match the audio clock in real time.

---

## Component Architecture

### Frontend (React)

**StickControlStudio.jsx** (current, in `/mnt/user-data/outputs/`)
- State: `library[]`, `selId`, `tempo`, `repeats`, `playing`, `cur` (current note index), `progress{}`, `totalSec`
- Upload panel with multi-file drag-and-drop
- Real-image display (Notation component) with snapping highlight disc
- Metronome controls (beat-only vs. every-note, tempo slider, level presets)
- Play/Pause/Reset buttons
- Repeat counter and hand letter display (R/L large box)
- Per-exercise progress card (best tempo, reps, time, done toggle)
- Audio engine (Web Audio API scheduler + requestAnimationFrame draw loop)
- Persistence: `window.storage` (in-browser key-value store)

### New Server Endpoints (Node + Express)

#### `POST /api/exercises/import`
**Input**: Multipart form with image file(s).  
**Process**:
1. Receive image
2. Run deskew → crop → detect pipeline (Python service call or embedded)
3. Read R/L sticking (Claude Vision API or local OCR)
4. Build exercise object
5. Save to DB

**Output**:
```json
{
  "id": "ex_123",
  "name": "Exercise 1",
  "img": "url_to_stored_image_or_dataURL",
  "fr": [0.0717, 0.1666, …],
  "noteY": 0.505,
  "aligned": true,
  "sticking": "RLRLRLRLRLRLRLRL"
}
```

#### `GET /api/exercises`
List all exercises (for dropdown).

**Output**:
```json
[
  { "id": "ex_1", "name": "Page 1 · Ex 1", "aligned": true, … },
  { "id": "ex_2", "name": "Page 1 · Ex 2", "aligned": true, … }
]
```

#### `POST /api/progress`
Log reps, tempo, time for an exercise (called on Play finish).

**Input**:
```json
{
  "exerciseId": "ex_1",
  "reps": 20,
  "tempo": 92,
  "sec": 150,
  "done": true
}
```

#### `GET /api/progress/:exerciseId`
Retrieve progress for a single exercise or all.

---

## Database Schema

### Exercise (Mongo)

```javascript
{
  _id: ObjectId,
  id: string,
  name: string,
  img: string,                   // URL to stored image or embedded dataURL
  noteY: number,
  aligned: boolean,
  timeSig: string,
  meter: string,
  noteValue: string,
  measureBeats: number,
  beats: [{
    sub: number,
    notes: [{x: number, h: string, rest: boolean}]
  }],
  createdAt: Date,
  updatedAt: Date
}
```

### UserGoal (optional, for tracking practice sessions)

```javascript
{
  _id: ObjectId,
  userId: string,
  dailyMinutes: number,
  currentLevel: string,          // "Beginner", "Intermediate", etc.
  createdAt: Date
}
```

### ProgressLog (per-session record)

```javascript
{
  _id: ObjectId,
  userId: string,
  exerciseId: string,
  reps: number,
  bestTempo: number,
  sessionTime: number,           // seconds
  done: boolean,
  timestamp: Date
}
```

---

## Deployment & Image Processing

### Python Service (for deskew → crop → detect)

A lightweight service (Flask or FastAPI) that:
1. Receives a photo (multipart/form-data or base64 POST)
2. Runs the OpenCV/scipy pipeline
3. Returns JSON with `img`, `fr`, `noteY`, `aligned`

Can run in the same container or separately.

### Example (Flask):

```python
from flask import Flask, request, jsonify
import cv2, numpy as np
from scipy import ndimage
import base64

@app.route('/process-exercise', methods=['POST'])
def process_exercise():
    file = request.files['photo']
    img = cv2.imdecode(np.frombuffer(file.read(), np.uint8), cv2.IMREAD_GRAYSCALE)
    result = fix_and_detect(img)
    return jsonify(result)

def fix_and_detect(img):
    # [implement full pipeline here]
    return {
        "img": base64_encode_png(stretched_grayscale),
        "fr": fr,
        "noteY": noteY,
        "aligned": len(fr) >= 13 and len(fr) <= 19
    }
```

---

## Key Lessons Learned

### 1. **In-Browser CV is Best-Effort**
Notehead detection works reliably on clean, straight, high-contrast photos. Phone photos often miss or misalign. Server pipeline is the right home.

### 2. **Find Notehead Row Within the Staff**
Don't look for the densest row overall (that's usually a staff line). Look for the densest row *within the staff bounds* that isn't a staff line itself. All noteheads on a single-pitch line sit together.

### 3. **Gentle Grayscale, Not Hard Threshold**
A harsh 0/255 black-and-white binarization can break notehead shapes and looks ugly. Better: straighten, crop, center, then output the grayscale with a gentle brightness stretch. Still easy to read, and users see the real photo.

### 4. **Fixed Rhythm for Single-Beat Pages**
Page 1 of Stick Control (24 exercises, all 16 eighth notes, sticking varies) means rhythm is **always** 16 eighths. Lock to that in the model, not auto-detect. The metronome is then always correct, and the highlight has 16 fixed beats regardless of detection quality.

### 5. **Exclude Clef & Barlines Early**
When filtering detected blobs, skip columns 0–10% (clef) and 90–100% (barlines). They're always there, always distract detection.

### 6. **Deskew Affects Both Maps**
When rotating to straighten, apply the same shear to both the grayscale (for display) and the dark map (for detection). Otherwise positions won't align with the rendered image.

### 7. **Unicode in JSX**
Text nodes in JSX can't use `\uXXXX` escape sequences — they render literally. Use actual Unicode characters (`·`, `♩`, `¢`) in the source file instead.

---

## Files & Structure

```
/mnt/user-data/outputs/
  StickControlStudio.jsx         [current React app, ready to drop into a Vite build]

/mnt/transcripts/
  2026-06-23-14-04-24-…          [full conversation with all decisions, pivots, code snippets]

PROJECT.md                        [this file]
```

### To Use in VSCode

1. Create a new Vite + React project:
   ```bash
   npm create vite@latest stick-control -- --template react
   cd stick-control
   npm install
   ```

2. Copy `StickControlStudio.jsx` into `src/pages/` or `src/components/`.

3. Import and render it in `src/App.jsx`:
   ```javascript
   import StickControlStudio from './pages/StickControlStudio';
   export default function App() {
     return <StickControlStudio />;
   }
   ```

4. Install Tailwind (used in the component):
   ```bash
   npm install -D tailwindcss postcss autoprefixer
   npx tailwindcss init -p
   ```

5. Build the backend (Node + Express) with the image processing service.

6. Update the `window.storage` calls to POST to your server endpoints instead of (or alongside) the in-browser storage.

---

## Next Steps for the Build

1. **Set up the Python image-processing service** and integrate it behind the `/api/exercises/import` endpoint.
2. **Build the Express server** with CRUD routes for exercises and progress logging.
3. **Replace `window.storage` calls** with server API calls (`fetch`).
4. **Add a login/user system** to scope exercises and progress per user.
5. **Deploy**: Docker container with Node backend, Python service, and Mongo.

The core app logic (metronome, highlight, progress tracking) is already solid and ready to wire up to the real backend.

---

## Conversation & Decision Log

Full transcript in `/mnt/transcripts/`. Key decisions:

- **No drawn notation.** User wanted only the real book image; ditch SVG tracks.
- **Deskew-then-cut.** Alignment works best if you straighten the whole page first, then slice exercises. Not crop-then-deskew.
- **Fixed 16-eighth rhythm.** For Stick Control single-beat pages, lock to 16 eighths. Metronome and highlight are then always correct.
- **Dot only when confident.** If detection doesn't find 13–19 noteheads, don't guess — show no dot, just the metronome. Better than a wrong dot.
- **Gentle grayscale.** Hard B&W threshold breaks noteheads; render the straightened grayscale with a gentle stretch instead.

---

**Status**: App is feature-complete for local use. Ready for backend build.
