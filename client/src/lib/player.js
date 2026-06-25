// player.js — Web Audio look-ahead scheduler with a separate UI tick that advances the
// highlight from a queue, so audio and visuals stay in sync regardless of frame rate.
// Plain JS; wrap in whatever UI framework you use. Timing comes from each note's `dur` (q).
export function createPlayer({ getTempo, getRepeats, getEveryNote, getVolume, onNote, onRepeat, onFinish, onCount }) {
  let ctx, sched, raf, nextT = 0, idx = 0, meas = 0, q = [], cq = [], countOsc = [], timeline = [];
  const vol = () => (getVolume ? getVolume() : 1);                 // 0..1 master gain over all clicks
  const click = (t, f, g) => {
    const a = g * vol();
    if (a <= 0.0001) return null;                                  // muted: nothing to play (exp ramp needs >0 start)
    const o = ctx.createOscillator(), gg = ctx.createGain();
    o.frequency.value = f;
    gg.gain.setValueAtTime(a, t);
    gg.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(gg).connect(ctx.destination);
    o.start(t); o.stop(t + 0.06);
    return o;
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
    while (cq.length && cq[0].time <= ctx.currentTime) { const c = cq.shift(); if (onCount) onCount(c.n); }
    while (q.length && q[0].time <= ctx.currentTime) { const e = q.shift(); onNote(e.idx); onRepeat(meas); }
    raf = requestAnimationFrame(draw);
  };
  // A tempo-matched count-in precedes the timeline: `countBeats` quarter-note clicks
  // (the "1" accented) so the player knows the pulse before the first note sounds.
  // Only at a true start though — resuming after a pause (idx/meas already advanced)
  // jumps straight back in with no count.
  async function play(piece, countBeats = 4) {
    timeline = piece;
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    await ctx.resume();
    const beats = (idx === 0 && meas === 0) ? countBeats : 0;   // count in only from the beginning
    const beat = 60 / getTempo(), t0 = ctx.currentTime + 0.12;
    cq = []; countOsc = [];
    for (let i = 0; i < beats; i++) {
      const t = t0 + i * beat;
      const o = click(t, i === 0 ? 1700 : 1100, i === 0 ? 0.55 : 0.4);   // click each count, accent the 1
      if (o) countOsc.push(o);                                            // so Pause can silence pending counts
      cq.push({ time: t, n: i + 1 });
    }
    nextT = t0 + beats * beat;             // first note lands on the beat after the count-in
    cq.push({ time: nextT, n: 0 });        // n=0 clears the on-screen count as notes begin
    sched = setInterval(tick, 25);
    raf = requestAnimationFrame(draw);
  }
  function stop() {
    clearInterval(sched); cancelAnimationFrame(raf); q = []; cq = [];
    countOsc.forEach((o) => { try { o.stop(); } catch (e) { /* already stopped */ } });
    countOsc = [];
  }
  function reset() { stop(); idx = 0; meas = 0; }
  // expose the current repeat index so the host can bank partial reps on pause
  return { play, stop, reset, meas: () => meas };
}
