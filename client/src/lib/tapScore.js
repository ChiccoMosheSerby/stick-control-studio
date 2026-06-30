// tapScore.js — match user taps to expected note onsets and grade a round.
// Everything is in absolute AudioContext seconds, so loop wrap-around never matters:
// the host builds the full list of expected onset times across all repeats, collects
// tap timestamps, and we greedily pair each tap to the nearest unused onset.

// Timing windows (ms). Generous enough for mouse/touch latency, tight enough to teach.
export const WINDOWS = { perfect: 45, good: 90, ok: 150 };

export const classify = (absMs) =>
  absMs <= WINDOWS.perfect ? "perfect" : absMs <= WINDOWS.good ? "good" : absMs <= WINDOWS.ok ? "ok" : null;

const SCORE = { perfect: 1, good: 0.8, ok: 0.5 };

// expected: [{ key, t }]  (t = absolute seconds)   taps: [tSeconds, ...]
// Greedy nearest-match within the ok window. A tap may match at most one onset and
// vice-versa; unmatched onsets are misses, unmatched taps are extras.
export function scoreRound(taps, expected) {
  const onsets = expected.map((e) => ({ ...e, hit: null }));   // hit = { dtMs, grade }
  const sortedTaps = [...taps].sort((a, b) => a - b);
  const extras = [];
  const okSec = WINDOWS.ok / 1000;

  for (const tap of sortedTaps) {
    let best = -1, bestDt = Infinity;
    for (let i = 0; i < onsets.length; i++) {
      if (onsets[i].hit) continue;
      const dt = Math.abs(tap - onsets[i].t);
      if (dt < bestDt) { bestDt = dt; best = i; }
    }
    if (best >= 0 && bestDt <= okSec) {
      const signed = (tap - onsets[best].t) * 1000;   // +late / -early, ms
      onsets[best].hit = { dtMs: signed, grade: classify(Math.abs(signed)) };
    } else {
      extras.push(tap);
    }
  }

  const hits = onsets.filter((o) => o.hit);
  const counts = { perfect: 0, good: 0, ok: 0, miss: onsets.length - hits.length, extra: extras.length };
  let raw = 0;
  for (const o of hits) { counts[o.hit.grade]++; raw += SCORE[o.hit.grade]; }

  // accuracy: credit for how cleanly notes were hit, lightly penalised for extra taps.
  const total = onsets.length || 1;
  const accuracy = Math.max(0, (raw - extras.length * 0.5) / total);
  return { onsets, counts, accuracy, total };
}

// A round passes on score alone: the accuracy percentage (the same number shown on screen)
// must be 80% or better. A stray miss or two still clears it.
export const PASS_PCT = 80;
export const scorePct = (round) => Math.round((round.accuracy || 0) * 100);
export const passed = (round) => round.total > 0 && scorePct(round) >= PASS_PCT;
