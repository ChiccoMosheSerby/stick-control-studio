// rhythm.js — duration math + timeline flattening (framework-agnostic ES module).
// Durations are in quarter-note beats (q). Timing always comes from durations, never pixels.
export const NOTE_DUR = { whole: 4, half: 2, quarter: 1, eighth: 0.5, "16th": 0.25, "32nd": 0.125, "64th": 0.0625 };

export function resolveDur(value, dots = 0, tuplet = null) {
  let d = NOTE_DUR[value];
  if (d == null) throw new Error("unknown value " + value);
  if (dots) d *= 2 - 1 / Math.pow(2, dots);
  if (tuplet) d *= tuplet.of / tuplet.n;
  return d;
}

export const measureQ = (ts) => ts.num * (4 / ts.den);
export const beatUnitQ = (ts) => 4 / ts.den;
export const qToSec = (q, tempoQuarter) => q * (60 / tempoQuarter);

// flatten measures -> voices -> events into a player timeline (sorted by onset)
export function flattenPiece(ex) {
  const out = [];
  const ts = ex.time || { num: 4, den: 4 };
  const bu = beatUnitQ(ts);
  const mlen = measureQ(ts);
  let measStartQ = 0;
  (ex.measures || []).forEach((m) => {
    (m.voices || [{ inst: "snare", events: m.events || [] }]).forEach((v) => {
      let vQ = measStartQ;
      (v.events || []).forEach((e) => {
        const dur = e.dur ?? resolveDur(e.value, e.dots || 0, e.tuplet || null);
        const rel = vQ - measStartQ, k = rel / bu;
        out.push({
          onsetQ: vQ, dur, value: e.value, tuplet: e.tuplet || null,   // value/tuplet threaded for labels + placement
          rest: e.type === "rest", hand: e.type === "rest" ? null : (e.hand || null),
          x: e.x ?? null, tie: !!e.tie, inst: v.inst || "snare",
          beatStart: Math.abs(k - Math.round(k)) < 1e-6, measureStart: Math.abs(rel) < 1e-6
        });
        vQ += dur;
      });
    });
    measStartQ += mlen;
  });
  return out.sort((a, b) => a.onsetQ - b.onsetQ);
}

export function measureIsComplete(events, ts) {
  const t = (events || []).reduce((s, e) => s + (e.dur ?? resolveDur(e.value, e.dots || 0, e.tuplet || null)), 0);
  return Math.abs(t - measureQ(ts)) < 1e-6;
}
