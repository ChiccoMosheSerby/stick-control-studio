// tapEngine.js — Web Audio transport for the Tap Trainer.
// Like player.js it's a look-ahead scheduler, but tuned for tapping: it sounds only the
// metronome (the rhythm is the user's job), counts in, loops a line a fixed number of
// times, and exposes now() so the component can timestamp taps against the same clock.
// Tempo is snapshot at play() time, so the loop length is constant and scoring is simple.
export function createTapEngine({ getVolume, getListen, onCount, onFrame, onRepeat, onDone }) {
  let ctx, sched, raf;
  let clicks = [], ghosts = [], counts = [];   // precomputed absolute-time schedules
  let ci = 0, gi = 0;                            // next-to-schedule indices
  let loopStart = 0, loopSec = 0, reps = 0, endT = 0, lastIter = -1, countShown = -1;

  const vol = () => (getVolume ? getVolume() : 1);
  const click = (t, f, g) => {
    const a = g * vol();
    if (a <= 0.0001) return;
    const o = ctx.createOscillator(), gg = ctx.createGain();
    o.frequency.value = f;
    gg.gain.setValueAtTime(a, t);
    gg.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(gg).connect(ctx.destination);
    o.start(t); o.stop(t + 0.06);
  };

  const tick = () => {
    const horizon = ctx.currentTime + 0.12;
    while (ci < clicks.length && clicks[ci].t < horizon) { const c = clicks[ci++]; click(c.t, c.f, c.g); }
    while (gi < ghosts.length && ghosts[gi].t < horizon) { const c = ghosts[gi++]; if (getListen && getListen()) click(c.t, 760, 0.16); }
  };

  const draw = () => {
    const t = ctx.currentTime;
    // count-in display (1..n, then 0 once the line starts)
    let shown = 0;
    for (const c of counts) if (t >= c.t) shown = c.n;
    if (shown !== countShown) { countShown = shown; if (onCount) onCount(shown); }

    const pos = t - loopStart;                       // seconds into the line (negative during count-in)
    const iter = pos < 0 ? -1 : Math.min(reps - 1, Math.floor(pos / loopSec));
    if (onFrame) onFrame({ pos, iter });
    if (iter > lastIter) { lastIter = iter; if (iter > 0 && onRepeat) onRepeat(iter); }   // a loop just completed

    if (t >= endT) { if (onRepeat) onRepeat(reps); stopLoops(); if (onDone) onDone(); return; }
    raf = requestAnimationFrame(draw);
  };

  function stopLoops() { clearInterval(sched); cancelAnimationFrame(raf); }

  // timeline: flattenPiece output. Returns the scoring plan (absolute onset times).
  async function play(timeline, { tempo, countBeats = 4, repeats = 4, beatsPerBar = 4 }) {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    await ctx.resume();
    const beat = 60 / tempo;
    const last = timeline[timeline.length - 1];
    const loopQ = Math.round(last.onsetQ + last.dur);
    loopSec = loopQ * beat; reps = repeats;
    const t0 = ctx.currentTime + 0.15;               // count-in begins here
    loopStart = t0 + countBeats * beat;              // the line begins here
    endT = loopStart + reps * loopSec;
    lastIter = -1; countShown = -1; ci = 0; gi = 0;

    counts = [];
    for (let i = 0; i < countBeats; i++) counts.push({ t: t0 + i * beat, n: i + 1 });
    counts.push({ t: loopStart, n: 0 });

    clicks = [];
    for (let i = 0; i < countBeats; i++) clicks.push({ t: t0 + i * beat, f: i === 0 ? 1700 : 1100, g: i === 0 ? 0.5 : 0.38 });
    for (let r = 0; r < reps; r++)
      for (let q = 0; q < loopQ; q++)
        clicks.push({ t: loopStart + (r * loopQ + q) * beat, f: q % beatsPerBar === 0 ? 1700 : 1100, g: q % beatsPerBar === 0 ? 0.5 : 0.36 });

    const expected = [];                             // notes only, absolute times, for scoring + ghosts
    ghosts = [];
    for (let r = 0; r < reps; r++)
      for (const n of timeline) {
        if (n.rest) continue;
        const t = loopStart + r * loopSec + n.onsetQ * beat;
        expected.push({ key: `${r}:${n.onsetQ}`, q: n.onsetQ, t });
        ghosts.push({ t });
      }

    sched = setInterval(tick, 25);
    raf = requestAnimationFrame(draw);
    return { loopStart, loopSec, reps, loopQ, expected };
  }

  function stop() { stopLoops(); }
  function now() { return ctx ? ctx.currentTime : 0; }
  function blip() { if (ctx) click(ctx.currentTime + 0.001, 1500, 0.32); }   // tactile feedback on each tap
  return { play, stop, now, blip };
}
