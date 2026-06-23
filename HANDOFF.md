# Handoff — build this with Claude in VSCode

This folder is a complete, runnable MERN scaffold for **Stick Control Studio** plus the full
spec and the conversation that produced it. Hand the whole folder to Claude (or open it in
VSCode with the Claude extension) and it has everything needed to build/extend from zero.

## What's here
```
stick-control-studio/
  client/                 Vite + React + SCSS frontend (runnable)
  server/                 Express + Mongoose API (runnable)
  docs/
    PROJECT.md            Full build spec: data model, CV pipeline, timing math, API, schema
    conversation-session-1.txt   Earlier session (initial app exploration)
    conversation-session-2.txt   This session (studio build + every decision/pivot)
  reference/
    StickControlStudio.singlefile.jsx   The proven single-file app (Tailwind), for reference
  README.md               How to run client + server
  HANDOFF.md              This file
```

## Run it now
See `README.md`. Short version: `cd server && cp .env.example .env && npm i && npm run dev`,
then `cd client && npm i && npm run dev`, open http://localhost:5173.

## Suggested prompt to Claude in VSCode
> Read `docs/PROJECT.md` and `HANDOFF.md`. This is a Vite+React+SCSS client and an
> Express+Mongoose server for a drum practice app. Get it running against a local MongoDB,
> then help me: (1) move the deskew→crop→detect pipeline from the browser
> (`client/src/lib/fixAndDetect.js`) to a server-side Python/OpenCV service, (2) add a
> `/api/sticking` route that reads the R/L letters with a vision model or OCR (no API key in
> the browser), and (3) add user auth so exercises and progress are per-user.

## Build status
- **Done & working:** player (metronome + note-snapping highlight), tempo/levels, repeat count,
  per-exercise progress, multi-image import, browser-side fix+detect, full REST API + Mongo models.
- **Best-effort / to harden:** notehead detection in the browser is unreliable on marginal
  photos — the spec explains the robust server-side version. Sticking read is a stub
  (`readSticking()` returns "" → alternating R/L fallback).

## Key decisions (full reasoning in docs/conversation-session-2.txt)
- Real book image only — no drawn notation.
- Straighten the whole page first, THEN cut exercises (deskew-then-crop).
- Fixed 16-eighth rhythm for Stick Control single-beat pages → metronome always correct.
- Show the highlight dot ONLY when detection is confident; otherwise no dot (never a wrong one).
- Gentle grayscale (deskew/crop/center + brightness lift), not a hard B&W threshold.
- Don't reproduce the copyrighted book; the user photographs pages they own. Functional
  sticking (R/L) isn't copyrightable.
