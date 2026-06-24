import { flattenPiece } from "./rhythm.js";

export const LEVELS = [["Beginner", 60], ["Developing", 76], ["Intermediate", 92], ["Advanced", 110], ["Expert", 130]];
export const BLANK = { sec: 0, reps: 0, bestTempo: 0, done: false };

const VAL_LABEL = { whole: "whole", half: "half", quarter: "quarter", eighth: "eighths", "16th": "16ths", "32nd": "32nds", "64th": "64ths" };
// Counter label for the current note — uses value/tuplet threaded through flattenPiece.
export const durLabel = (it) => {
  if (!it) return "repetitions";
  if (it.rest) return "rest";
  if (it.tuplet) return "triplet";
  return VAL_LABEL[it.value] || "notes";
};

// Back-compat: a legacy exercise has `beats:[{sub,notes:[{h,x,rest}]}]` and no `measures`.
// Synthesize cut-time measures of eighths so it still plays under the new player.
export function beatsToMeasures(ex) {
  if (ex.measures && ex.measures.length) return ex;
  if (!ex.beats || !ex.beats.length) return ex;
  const events = ex.beats.flatMap((b) => (b.notes || []).map((n) => ({
    type: n.rest ? "rest" : "note", value: "eighth", dots: 0, tuplet: null,
    hand: n.rest ? null : (n.h || null), x: n.x ?? null
  })));
  const measures = [];
  for (let i = 0; i < events.length; i += 8) measures.push({ voices: [{ inst: "snare", events: events.slice(i, i + 8) }] });
  return { ...ex, time: ex.time || { num: 2, den: 2 }, measures };
}

// Flatten an exercise (legacy or new) into the player timeline.
export const flatten = (ex) => flattenPiece(beatsToMeasures(ex));

export const fmt = (s) => {
  s = Math.floor(s || 0);
  return Math.floor(s / 60) + "m " + String(s % 60).padStart(2, "0") + "s";
};
