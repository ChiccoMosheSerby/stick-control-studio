// player.js — Web Audio look-ahead scheduler with a separate UI tick that advances the
// highlight from a queue, so audio and visuals stay in sync regardless of frame rate.
// Plain JS; wrap in whatever UI framework you use. Timing comes from each note's `dur` (q).
export function createPlayer({ getTempo, getRepeats, getEveryNote, getVolume, onNote, onRepeat, onFinish }) {
  let ctx, sched, raf, nextT = 0, idx = 0, meas = 0, q = [], timeline = [];
  const vol = () => (getVolume ? getVolume() : 1);                 // 0..1 master gain over all clicks
  const click = (t, f, g) => {
    const a = g * vol();
    if (a <= 0.0001) return;                                       // muted: nothing to play (exp ramp needs >0 start)
    const o = ctx.createOscillator(), gg = ctx.createGain();
    o.frequency.value = f;
    gg.gain.setValueAtTime(a, t);
    gg.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(gg).connect(ctx.destination);
    o.start(t); o.stop(t + 0.06);
  };
  const voice = (t, n) => {
    // Flam grace note: a soft hit ~35ms before the main one (only when sounding every note).
    if (n.hand === "F" && getEveryNote() && !n.rest) click(Math.max(t - 0.035, ctx.currentTime), 900, 0.12);
    if (n.measureStart) click(t, 1700, 0.55);
    else if (n.quarterStart) click(t, 1100, 0.4);   // click every quarter (1·2·3·4), incl. cut time
    else if (getEveryNote() && !n.rest) click(t, 800, 0.15);
  };
  const tick = () => {
    while (nextT < ctx.currentTime + 0.12) {
      const n = timeline[idx];
      if (!n.tie) voice(nextT, n);                          // tied-into notes don't re-articulate
      q.push({ time: nextT, idx });
      nextT += n.dur * (60 / getTempo()); idx++;
      if (idx >= timeline.length) { idx = 0; meas++; if (meas >= getRepeats()) { stop(); onFinish(); return; } }
    }
  };
  const draw = () => {
    while (q.length && q[0].time <= ctx.currentTime) { const e = q.shift(); onNote(e.idx); onRepeat(meas); }
    raf = requestAnimationFrame(draw);
  };
  async function play(piece) {
    timeline = piece;
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    await ctx.resume();
    nextT = ctx.currentTime + 0.06;
    sched = setInterval(tick, 25);
    raf = requestAnimationFrame(draw);
  }
  function stop() { clearInterval(sched); cancelAnimationFrame(raf); q = []; }
  function reset() { stop(); idx = 0; meas = 0; }
  // expose the current repeat index so the host can bank partial reps on pause
  return { play, stop, reset, meas: () => meas };
}
