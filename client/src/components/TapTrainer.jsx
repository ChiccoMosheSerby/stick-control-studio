import React, { useRef, useState, useEffect, useCallback } from "react";
import s from "../styles/studio.module.scss";
import Staff from "./Staff.jsx";
import { flattenPiece } from "../lib/rhythm.js";
import { generateLine, LEVELS, MAX_LEVEL, BASE_TEMPO, TEMPO_STEP, TEMPO_PASSES } from "../lib/tapGen.js";
import { createTapEngine } from "../lib/tapEngine.js";
import { scoreRound, passed, classify, WINDOWS } from "../lib/tapScore.js";

const REPS = 4;          // a round = the line tapped this many times
const MAX_TEMPO = 168;   // tempo stops climbing here
const GRADE_COL = { perfect: "var(--ok)", good: "var(--l)", ok: "var(--r)", extra: "#9b6b6b" };

// Tap Trainer — the app reads you a rhythm line (notes only), you tap it back in time with
// the metronome. Clears a round cleanly and it steps up: harder rhythms first, then, once
// the hardest division is mastered, the tempo starts climbing. Tap the pad, click, or hit space.
export default function TapTrainer({ volume, setVolume, bankPractice }) {
  const [level, setLevel] = useState(1);
  const [tempo, setTempo] = useState(BASE_TEMPO);
  const [piece, setPiece] = useState(() => generateLine(1));
  const [running, setRunning] = useState(false);
  const [countIn, setCountIn] = useState(0);
  const [markers, setMarkers] = useState([]);          // live per-tap feedback dots for the current loop
  const [result, setResult] = useState(null);          // last finished round's score
  const [status, setStatus] = useState("Press play, listen to the count, then tap the rhythm.");

  // refs the audio callbacks read (created once, must see fresh values)
  const engineRef = useRef(null);
  const planRef = useRef(null);                         // { loopStart, loopSec, loopQ, expected, beat }
  const layoutRef = useRef(null);                       // geometry from Staff
  const tapsRef = useRef([]);                           // absolute tap times for this round
  const modeRef = useRef("play");                       // "play" | "listen"
  const volRef = useRef(volume), levelRef = useRef(level), tempoRef = useRef(tempo), pieceRef = useRef(piece), runRef = useRef(false);
  const listenRef = useRef(false), contTimer = useRef(null), markerId = useRef(0), topStreakRef = useRef(0);
  const playheadRef = useRef(null), hiRef = useRef(null), nextRef = useRef(null);
  useEffect(() => { volRef.current = volume; }, [volume]);
  useEffect(() => { levelRef.current = level; }, [level]);
  useEffect(() => { tempoRef.current = tempo; }, [tempo]);
  useEffect(() => { pieceRef.current = piece; }, [piece]);

  // map a position in quarter-beats to a pixel x on the staff (interpolate between note heads)
  const qToX = useCallback((q) => {
    const L = layoutRef.current; if (!L) return 0;
    const m = L.marks; if (!m.length) return L.xStart;
    if (q <= m[0].onsetQ) return m[0].x;
    for (let i = 0; i < m.length - 1; i++) {
      if (q >= m[i].onsetQ && q < m[i + 1].onsetQ) {
        const f = (q - m[i].onsetQ) / (m[i + 1].onsetQ - m[i].onsetQ);
        return m[i].x + f * (m[i + 1].x - m[i].x);
      }
    }
    const last = m[m.length - 1], span = Math.max(0.001, L.totalQ - last.onsetQ);
    return last.x + Math.min(1, (q - last.onsetQ) / span) * (L.xEnd - last.x);
  }, []);

  // bank practice time while a real (non-listen) round is running
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => { if (modeRef.current === "play") bankPractice && bankPractice(1); }, 1000);
    return () => clearInterval(t);
  }, [running, bankPractice]);

  // build the engine once; callbacks pull live state from refs
  if (!engineRef.current) {
    engineRef.current = createTapEngine({
      getVolume: () => volRef.current,
      getListen: () => listenRef.current,
      onCount: (n) => setCountIn(n),
      onFrame: ({ pos, iter }) => {
        const plan = planRef.current, ph = playheadRef.current, hi = hiRef.current, nx = nextRef.current;
        if (!plan) return;
        const m = layoutRef.current?.marks || [];
        const firstNote = m.find((mk) => !mk.rest);
        // the next note ring uses visibility (its pulse animates opacity), playhead/highlight use opacity
        if (pos < 0) {                                   // count-in: park the "next" ring on the opening tap
          if (ph) ph.style.opacity = "0"; if (hi) hi.style.opacity = "0";
          if (nx && firstNote) { nx.style.visibility = "visible"; nx.style.transform = `translateX(${firstNote.x}px)`; }
          return;
        }
        const inLoop = pos - iter * plan.loopSec, q = inLoop / plan.beat;
        if (ph) { ph.style.opacity = "1"; ph.style.transform = `translateX(${qToX(q)}px)`; }
        // current = latest non-rest onset at/before the playhead; next = the upcoming tap target
        let act = null, next = null;
        for (const mk of m) {
          if (mk.rest) continue;
          if (mk.onsetQ <= q + 1e-6) act = mk; else if (!next) next = mk;
        }
        if (!next) next = firstNote;                     // past the last note -> next tap is the repeat's downbeat
        if (hi && act) { hi.style.opacity = "1"; hi.style.transform = `translateX(${act.x}px)`; }
        else if (hi) hi.style.opacity = "0";
        if (nx && next) { nx.style.visibility = "visible"; nx.style.transform = `translateX(${next.x}px)`; }
        else if (nx) nx.style.visibility = "hidden";
      },
      onRepeat: () => { setMarkers([]); },             // fresh feedback each loop -> always "following"
      onDone: finishRound,
    });
  }

  function startRound(mode = "play") {
    clearTimeout(contTimer.current);
    modeRef.current = mode; listenRef.current = mode === "listen";
    tapsRef.current = []; setMarkers([]); setResult(null); setCountIn(0);
    const pc = pieceRef.current;
    const timeline = flattenPiece(pc);
    const beat = 60 / tempoRef.current;
    const plan = engineRef.current.play(timeline, { tempo: tempoRef.current, countBeats: 4, repeats: mode === "listen" ? 1 : REPS, beatsPerBar: 4 });
    Promise.resolve(plan).then((p) => {
      planRef.current = { ...p, beat };
      // test-only hook: lets an automated harness tap on the audio clock (no effect in normal use)
      if (typeof window !== "undefined" && window.__SCS_TEST__) { window.__tapPlan = planRef.current; window.__tapNow = () => engineRef.current.now(); }
    });
    runRef.current = true; setRunning(true);
    setStatus(mode === "listen" ? "Listen…" : "Tap the rhythm with the click.");
  }

  function hideOverlays() {
    if (playheadRef.current) playheadRef.current.style.opacity = "0";
    if (hiRef.current) hiRef.current.style.opacity = "0";
    if (nextRef.current) nextRef.current.style.visibility = "hidden";
  }

  function stopRound() {
    clearTimeout(contTimer.current);
    engineRef.current.stop();
    runRef.current = false; setRunning(false); setCountIn(0);
    hideOverlays();
    setStatus("Stopped. Press play to go again.");
  }

  // called by the engine when all repeats finish
  function finishRound() {
    runRef.current = false; setRunning(false); setCountIn(0);
    hideOverlays();
    if (modeRef.current === "listen") { setStatus("Now you — press play and tap it back."); return; }

    const plan = planRef.current;
    const r = scoreRound(tapsRef.current, plan ? plan.expected : []);
    setResult(r);

    const pct = Math.round(r.accuracy * 100);
    if (passed(r)) {
      const lvl = levelRef.current, tmp = tempoRef.current;
      if (lvl < MAX_LEVEL) {
        // climb the complexity ladder first — one clean round per step, tempo stays put
        topStreakRef.current = 0;
        const next = lvl + 1; setLevel(next); levelRef.current = next;
        const np = generateLine(next); setPiece(np); pieceRef.current = np;
        setStatus(`Nice — ${pct}%. Level up: ${LEVELS[next - 1].label}.`);
      } else if (tmp < MAX_TEMPO) {
        // top complexity: nudge the tempo only after a couple of clean rounds in a row, so it
        // creeps up gently (the lines are already hard at this level)
        const streak = topStreakRef.current + 1;
        const np = generateLine(lvl); setPiece(np); pieceRef.current = np;
        if (streak >= TEMPO_PASSES) {
          topStreakRef.current = 0;
          const nt = Math.min(MAX_TEMPO, tmp + TEMPO_STEP); setTempo(nt); tempoRef.current = nt;
          setStatus(`Clean — ${pct}%. Nudging the tempo up: ♩ = ${nt}.`);
        } else {
          topStreakRef.current = streak;
          setStatus(`Clean — ${pct}%. One more solid round and the tempo edges up.`);
        }
      } else {
        const np = generateLine(lvl); setPiece(np); pieceRef.current = np;
        setStatus(`Maxed out — ${pct}%. Top level, top tempo. Keep going!`);
      }
      contTimer.current = setTimeout(() => startRound("play"), 1700);   // flow straight into the next round
    } else {
      topStreakRef.current = 0;   // a miss-heavy round breaks the streak toward the next tempo bump
      setStatus(`${pct}% — almost. Same line again when you're ready.`);
    }
  }

  // unmount: kill audio + any pending auto-continue
  useEffect(() => () => { clearTimeout(contTimer.current); if (engineRef.current) engineRef.current.stop(); }, []);

  // ---- tap capture: pad / click / space, all timestamped on the audio clock ----
  const onTap = useCallback(() => {
    if (!runRef.current || modeRef.current !== "play" || countIn > 0) return;
    const eng = engineRef.current, plan = planRef.current; if (!plan) return;
    eng.blip();
    const t = eng.now();
    tapsRef.current.push(t);
    // live grade against the nearest expected onset, for instant feedback
    let best = null, bestDt = Infinity;
    for (const e of plan.expected) { const dt = Math.abs(t - e.t); if (dt < bestDt) { bestDt = dt; best = e; } }
    const grade = best ? classify(bestDt * 1000) : null;
    const id = ++markerId.current;
    if (grade) setMarkers((mk) => [...mk, { id, x: qToX(best.q), grade }]);
    else {
      // an extra/way-off tap: drop it at the live playhead so the user sees the stray hit
      const x = playheadRef.current ? parseFloat((playheadRef.current.style.transform.match(/-?[\d.]+/) || [0])[0]) : 0;
      setMarkers((mk) => [...mk, { id, x, grade: "extra" }]);
    }
  }, [countIn, qToX]);

  // space bar taps too (ignore when typing in an input)
  useEffect(() => {
    const onKey = (e) => {
      if (e.code !== "Space" && e.key !== " ") return;
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      e.preventDefault(); onTap();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onTap]);

  const lvl = LEVELS[level - 1];
  const counts = result?.counts;

  return (
    <div className={s.tap}>
      {countIn > 0 && <div key={countIn} className={s.countIn} aria-hidden="true">{countIn}</div>}

      <div className={s.tapHead}>
        <div className={s.tapLevel}>
          <span className={s.tapLevelNum}>Level {level}<span> / {MAX_LEVEL}</span></span>
          <span className={s.tapLevelName}>{lvl.label}</span>
        </div>
        <div className={s.tapTempo}>♩ = {tempo}</div>
      </div>

      {/* progress through the complexity ladder, then a "max" flag once tempo is climbing */}
      <div className={s.tapLadder}>
        {LEVELS.map((L) => (
          <span key={L.id} className={`${s.tapStep} ${L.id < level ? s.done : ""} ${L.id === level ? s.cur : ""}`} title={L.label} />
        ))}
        {level === MAX_LEVEL && tempo > BASE_TEMPO && <span className={s.tapStep + " " + s.cur} title={`♩ = ${tempo}`} />}
      </div>

      <div className={s.notationCard}>
        <div className={s.tapStaffWrap}>
          <Staff piece={piece} onLayout={(l) => { layoutRef.current = l; }} />
          {/* overlays positioned in the same px space as the SVG */}
          {/* opacity/transform/visibility are driven imperatively in onFrame; kept OUT of
              React's style prop so per-tap re-renders don't reset them (start hidden via CSS) */}
          <div ref={nextRef} className={s.tapNext} />
          <div ref={hiRef} className={s.tapHighlight} />
          <div ref={playheadRef} className={s.tapPlayhead} />
          <div className={s.tapMarks}>
            {markers.map((mk) => (
              <span key={mk.id} className={s.tapMark} style={{ left: mk.x, background: GRADE_COL[mk.grade] }} />
            ))}
          </div>
        </div>
      </div>

      <div className={s.transport}>
        <button className={s.playBtn} onClick={running ? stopRound : () => startRound("play")}>{running ? "Stop" : "Play"}</button>
        <button className={s.demoBtn} onClick={() => startRound("listen")} disabled={running}
          title="Hear the line once — not scored">Listen</button>
        <button className={s.resetBtn} disabled={running}
          onClick={() => { const np = generateLine(level); setPiece(np); pieceRef.current = np; setResult(null); setStatus("New line at this level."); }}>New line</button>
      </div>

      {/* the big tap target: pointer covers mouse + touch + pen */}
      <button
        className={`${s.tapPad} ${running && countIn === 0 && modeRef.current === "play" ? s.live : ""}`}
        onPointerDown={(e) => { e.preventDefault(); onTap(); }}
        aria-label="Tap the rhythm">
        <span>{running && modeRef.current === "play" ? (countIn > 0 ? countIn : "TAP") : "TAP HERE"}</span>
        <small>tap · click · spacebar</small>
      </button>

      <div className={s.tapStatus}>{status}</div>

      {counts && (
        <div className={s.tapScore}>
          <div><div className={s.statNum} style={{ color: "var(--ok)" }}>{counts.perfect}</div><div className={s.statLabel}>perfect</div></div>
          <div><div className={s.statNum} style={{ color: "var(--l)" }}>{counts.good}</div><div className={s.statLabel}>good</div></div>
          <div><div className={s.statNum} style={{ color: "var(--r)" }}>{counts.ok}</div><div className={s.statLabel}>ok</div></div>
          <div><div className={s.statNum} style={{ color: "#9b6b6b" }}>{counts.miss}</div><div className={s.statLabel}>missed</div></div>
          <div><div className={s.statNum}>{Math.round(result.accuracy * 100)}<span style={{ fontSize: 13 }}>%</span></div><div className={s.statLabel}>accuracy</div></div>
        </div>
      )}

      <div className={s.card}>
        <div className={s.tempoHead}><span>Click volume</span><span className="val" style={{ fontFamily: "ui-monospace, monospace", color: "var(--text)" }}>{Math.round(volume * 100)}%</span></div>
        <input className={s.range} type="range" min={0} max={100} value={Math.round(volume * 100)} onChange={(e) => setVolume(+e.target.value / 100)} />
      </div>
    </div>
  );
}
