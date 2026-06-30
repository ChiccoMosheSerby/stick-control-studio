// tapGen.js — generate rhythm-only "lines" for the Tap Trainer.
// A line is a single 4/4 bar, built from one-beat rhythm cells drawn from a
// level-appropriate pool — kept to one bar so it always fits the notation width with
// no scrolling, then repeated each round. Notes carry NO hand (rhythm only). Output uses
// the same measures/voices/events schema as the book exercises, so flattenPiece() turns
// it into a player timeline and Staff.jsx renders it as real notation.

const note = (value, tuplet = null) => ({ type: "note", value, dots: 0, tuplet, hand: null });
const rest = (value, tuplet = null) => ({ type: "rest", value, dots: 0, tuplet, hand: null });
const TRIP = { n: 3, of: 2 };   // eighth-note triplet: 3 in the space of 2 eighths = 1 beat

// One-beat cells (each sums to exactly one quarter note).
const CELLS = {
  q:   () => [note("quarter")],
  "2e":  () => [note("eighth"), note("eighth")],
  er:    () => [rest("eighth"), note("eighth")],     // off-beat (syncopation)
  re:    () => [note("eighth"), rest("eighth")],
  "4s":  () => [note("16th"), note("16th"), note("16th"), note("16th")],
  e2s:   () => [note("eighth"), note("16th"), note("16th")],
  "2se": () => [note("16th"), note("16th"), note("eighth")],
  trip:  () => [note("eighth", TRIP), note("eighth", TRIP), note("eighth", TRIP)],
  qr:    () => [rest("quarter")],
};

// Difficulty ladder — complexity FIRST (these levels), tempo only after the top level.
export const LEVELS = [
  { id: 1, label: "Quarters",          pool: ["q", "q", "q", "qr"] },
  { id: 2, label: "Eighths",           pool: ["q", "2e", "2e", "qr"] },
  { id: 3, label: "Off-beats & rests", pool: ["q", "2e", "er", "re", "qr"] },
  { id: 4, label: "Sixteenths",        pool: ["q", "2e", "4s", "e2s", "2se", "er"] },
  { id: 5, label: "Triplets",          pool: ["q", "2e", "trip", "trip", "4s"] },
];
export const MAX_LEVEL = LEVELS.length;
export const BASE_TEMPO = 70;     // every complexity level is learned at this pulse first
export const TEMPO_STEP = 4;      // once the top level is cleared, the pulse climbs gently by this
export const TEMPO_PASSES = 2;    // ...and only after this many clean rounds in a row

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const cellNotes = (cell) => (CELLS[cell]() || []).filter((e) => e.type === "note").length;

// Build one 4-beat bar: pick 4 cells, forcing beat 1 to be a sounding note and
// avoiding back-to-back full-beat rests, so the line always reads cleanly.
function makeBar(pool) {
  const noteCells = pool.filter((c) => cellNotes(c) > 0);
  const beats = [];
  for (let b = 0; b < 4; b++) {
    let c = b === 0 ? pick(noteCells) : pick(pool);
    if (c === "qr" && (b === 0 || beats[b - 1] === "qr")) c = pick(noteCells);
    beats.push(c);
  }
  return beats;
}

// Generate a single-bar line for a level. Regenerates until it has enough sounding notes
// (a bar that's almost all rests isn't a useful tapping target).
export function generateLine(level) {
  const lvl = LEVELS.find((l) => l.id === level) || LEVELS[0];
  for (let tries = 0; tries < 12; tries++) {
    const events = makeBar(lvl.pool).flatMap((cell) => CELLS[cell]());
    const noteCount = events.filter((e) => e.type === "note").length;
    if (noteCount >= 3) {
      return { level: lvl.id, time: { num: 4, den: 4 }, measures: [{ voices: [{ inst: "snare", events }] }] };
    }
  }
  // fallback: a plain bar of quarters (only hit if RNG is pathological)
  const q4 = [note("quarter"), note("quarter"), note("quarter"), note("quarter")];
  return { level: lvl.id, time: { num: 4, den: 4 }, measures: [{ voices: [{ inst: "snare", events: q4 }] }] };
}
