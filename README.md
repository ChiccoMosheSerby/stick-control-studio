# Stick Control Studio (MERN)

A drum-rudiment practice app for George Lawrence Stone's *Stick Control*. Import a sharp
photo of an exercise → it's straightened, cropped, centered and its noteheads detected →
practice with a metronome and a highlight that snaps onto each note, with per-exercise
progress tracking.

**Stack:** Vite + React + SCSS (client) · Node + Express (server) · MongoDB + Mongoose ·
image processing in the browser (canvas) on add.

## Structure
```
stick-control-studio/
  client/   Vite + React + SCSS frontend
  server/   Express + Mongoose API
```

## Prerequisites
- Node 18+
- MongoDB connection string (local `mongodb://127.0.0.1:27017/stickcontrol` or Atlas)

## Run (two terminals)

### Server
```bash
cd server
cp .env.example .env      # edit MONGO_URI if needed
npm install
npm run dev               # http://localhost:4001
```

### Client
```bash
cd client
npm install
npm run dev               # http://localhost:5174  (proxies /api -> :4001)
```

Open http://localhost:5173 → **Add images** → drop a sharp single-line exercise photo → **Fix & add**.

## How it works
- On add, the browser runs `fixAndDetect()` (deskew → crop → center → notehead detection)
  and posts the finished exercise (image + note positions + sticking) to the server.
- The server stores exercises and progress in MongoDB.
- The player schedules metronome clicks (Web Audio API) and snaps the highlight to each
  note's detected x position in time.

## Next steps
- **Sticking read**: `readSticking()` returns empty for now (falls back to alternating R/L).
  Wire it to a server route that calls a vision model or OCR — never put an API key in the browser.
- **Move CV to the server** (Python + OpenCV) for robustness; the browser version is best-effort.
- Add auth to scope exercises/progress per user.
