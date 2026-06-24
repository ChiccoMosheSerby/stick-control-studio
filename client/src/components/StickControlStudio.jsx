import React, { useState, useRef, useEffect } from "react";
import s from "../styles/studio.module.scss";
import Notation from "./Notation.jsx";
import { flatten, fmt, durLabel, LEVELS, BLANK } from "../lib/helpers.js";
import { createPlayer } from "../lib/player.js";
import { api } from "../api.js";

const C = { R: "#E8A33D", L: "#4FB0A5", F: "#B98AE0", ok: "#6FBF73", muted: "#8A7E73", text: "#EDE6DD", panel: "#1F1A17", bg: "#14110F" };
const sumSec = (p) => Object.values(p).reduce((a, v) => a + (v.sec || 0), 0);

export default function StickControlStudio() {
  const [library, setLibrary] = useState([]);
  const [selId, setSelId] = useState(null);
  const [tempo, setTempo] = useState(76);
  const [repeats, setRepeats] = useState(20);
  const [subClicks, setSubClicks] = useState(true);
  const [volume, setVolume] = useState(0.8);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(-1);
  const [reps, setReps] = useState(0);
  const [progress, setProgress] = useState({});
  const [totalSec, setTotalSec] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const ex = library.find((e) => e.id === selId);
  const flat = ex ? flatten(ex) : [];
  const totalQ = flat.length ? flat[flat.length - 1].onsetQ + flat[flat.length - 1].dur : 1;  // for time-based dot placement
  const cn = ex && cur >= 0 ? flat[cur] : null;
  const showNote = cn && !cn.rest && cn.hand;
  const col = showNote ? (cn.hand === "R" ? C.R : cn.hand === "F" ? C.F : C.L) : C.muted;
  const pr = progress[selId] || BLANK;

  const playerRef = useRef(null), measRef = useRef(0), accRef = useRef(0);
  const tempoRef = useRef(76), repRef = useRef(20), subRef = useRef(true), volRef = useRef(0.8), selRef = useRef(null);
  useEffect(() => { tempoRef.current = tempo; }, [tempo]);
  useEffect(() => { repRef.current = repeats; }, [repeats]);
  useEffect(() => { subRef.current = subClicks; }, [subClicks]);
  useEffect(() => { volRef.current = volume; }, [volume]);
  useEffect(() => { selRef.current = selId; }, [selId]);

  // load library + progress from the server
  useEffect(() => { (async () => {
    try {
      const [lib, prog] = await Promise.all([api.getExercises(), api.getProgress()]);
      if (lib.length) { setLibrary(lib); setSelId(lib[0].id); }
      setProgress(prog); setTotalSec(sumSec(prog));
    } catch (e) { /* offline: start empty */ }
    setLoaded(true);
  })(); }, []);

  // persist progress (debounced)
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => { api.saveProgress(progress).catch(() => {}); }, 600);
    return () => clearTimeout(t);
  }, [progress, loaded]);

  // count practice time while playing
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setTotalSec((s2) => s2 + 1);
      setProgress((p) => { const id = selRef.current, c = p[id] || BLANK; return { ...p, [id]: { ...c, sec: (c.sec || 0) + 1 } }; });
    }, 1000);
    return () => clearInterval(t);
  }, [playing]);

  // ---- audio engine (durations drive timing; see lib/player.js) ----
  const credit = () => {
    const did = measRef.current - accRef.current; if (did <= 0) return; accRef.current = measRef.current; const id = selRef.current;
    setProgress((p) => { const c = p[id] || BLANK; return { ...p, [id]: { ...c, reps: (c.reps || 0) + did, bestTempo: Math.max(c.bestTempo || 0, tempoRef.current), done: c.done || measRef.current >= repRef.current } }; });
  };
  const ensurePlayer = () => {
    if (playerRef.current) return playerRef.current;
    playerRef.current = createPlayer({
      getTempo: () => tempoRef.current,
      getRepeats: () => repRef.current,
      getEveryNote: () => subRef.current,
      getVolume: () => volRef.current,
      onNote: (idx) => setCur(idx),
      onRepeat: (m) => { measRef.current = m; setReps(m); },
      onFinish: () => { setPlaying(false); credit(); setCur(-1); measRef.current = 0; accRef.current = 0; setReps(repRef.current); }
    });
    return playerRef.current;
  };
  const play = async () => { const e = library.find((x) => x.id === selRef.current); if (!e) return; setPlaying(true); await ensurePlayer().play(flatten(e)); };
  const pause = () => { setPlaying(false); if (playerRef.current) playerRef.current.stop(); credit(); };  // bank partial reps on pause
  const reset = () => { pause(); if (playerRef.current) playerRef.current.reset(); measRef.current = 0; accRef.current = 0; setCur(-1); setReps(0); };
  const pick = (id) => { reset(); setSelId(id); };
  useEffect(() => () => { if (playerRef.current) playerRef.current.stop(); }, []);

  const toggleDone = () => setProgress((p) => ({ ...p, [selId]: { ...(p[selId] || BLANK), done: !(p[selId] || BLANK).done } }));

  return (
    <div className={s.app}>
      <div className={s.container}>
        <div className={s.topbar}>
          <div className={s.label}>Stick Control · Studio</div>
          <div className={s.practiced}>Practiced <span className={s.mono}>{fmt(totalSec)}</span></div>
        </div>

        <div className={s.pickerRow}>
          {library.length > 0
            ? <select className={s.select} value={selId || ""} onChange={(e) => pick(e.target.value)}>
                {library.map((e) => { const d = (progress[e.id] || BLANK).done; return <option key={e.id} value={e.id}>{(d ? "✓ " : "") + e.name}</option>; })}
              </select>
            : <div className={s.pickerEmpty}>{loaded ? "No exercises found" : "Loading…"}</div>}
        </div>

        {!ex && loaded && (
          <div className={s.empty}>
            <div className={s.emptyTitle}>No exercise loaded</div>
            <div className={s.emptySub}>The exercise library didn't load — check that /exercises/exercises.json is served.</div>
          </div>
        )}

        {ex && (<>
          <div className={s.metaRow}>
            <div className={s.metaName}>{ex.name}</div>
            <div className={s.metaInfo}>
              <span className={s.metaSig}>{ex.timeSig}</span><span>{ex.meter} · {ex.noteValue}</span>
              {!ex.aligned && <span className={s.metaWarn}>· metronome only (sharper photo locks the dot)</span>}
            </div>
          </div>

          <div className={s.notationCard}><Notation ex={ex} cn={cn} showNote={showNote} col={col} totalQ={totalQ} /></div>

          <div className={s.transport}>
            <div className={s.repeatBox}>
              <span className={s.repeatLabel}>Repeat</span>
              <input className={s.repeatInput} type="number" min={1} value={repeats} onChange={(e) => setRepeats(Math.max(1, +e.target.value))} />
              <span className={s.repeatLabel}>×</span>
            </div>
            <button className={s.playBtn} onClick={playing ? pause : play}>{playing ? "Pause" : (reps > 0 ? "Resume" : "Play")}</button>
            <button className={s.resetBtn} onClick={reset}>Reset</button>
          </div>

          <div className={s.handRow}>
            <div className={s.handBox} style={{ background: showNote ? col : C.panel, color: showNote ? C.bg : C.muted }}>{showNote ? cn.hand : "–"}</div>
            <div className={s.counter}>
              <div className={s.count}>{Math.min(reps + (playing ? 1 : 0), repeats)}<span> / {repeats}</span></div>
              <div className={s.countLabel}>{durLabel(cn)}</div>
            </div>
          </div>

          <div className={s.card}>
            <div className={s.tempoHead}><span>Tempo (♩ = quarter)</span><span className="val" style={{ fontFamily: "ui-monospace, monospace", color: C.text }}>♩ = {tempo}</span></div>
            <input className={s.range} type="range" min={40} max={200} value={tempo} onChange={(e) => setTempo(+e.target.value)} />
            <div className={s.levels}>
              {LEVELS.map(([n, t]) => (
                <button key={n} className={`${s.levelBtn} ${tempo === t ? s.active : ""}`} onClick={() => setTempo(t)}>{n}<br /><span>{t}</span></button>
              ))}
            </div>
            <div className={s.tempoHead} style={{ marginTop: 16 }}><span>Click volume</span><span className="val" style={{ fontFamily: "ui-monospace, monospace", color: C.text }}>{Math.round(volume * 100)}%</span></div>
            <input className={s.range} type="range" min={0} max={100} value={Math.round(volume * 100)} onChange={(e) => setVolume(+e.target.value / 100)} />
          </div>

          <div className={s.clickToggle}>
            <button className={`${s.clickBtn} ${!subClicks ? s.active : ""}`} onClick={() => setSubClicks(false)}>Click: 1 · 2 · 3 · 4</button>
            <button className={`${s.clickBtn} ${subClicks ? s.active : ""}`} onClick={() => setSubClicks(true)}>Click: every note</button>
          </div>

          <div className={s.card}>
            <div className={s.progressHead}>
              <span className={s.progressTitle}>This exercise</span>
              <button className={`${s.doneBtn} ${pr.done ? s.on : ""}`} onClick={toggleDone}>{pr.done ? "✓ Done" : "Mark done"}</button>
            </div>
            <div className={s.stats}>
              <div><div className={s.statNum}>{pr.bestTempo || "–"}</div><div className={s.statLabel}>best ♩</div></div>
              <div><div className={s.statNum}>{pr.reps || 0}</div><div className={s.statLabel}>reps</div></div>
              <div><div className={s.statNum}>{fmt(pr.sec)}</div><div className={s.statLabel}>time</div></div>
            </div>
          </div>
        </>)}
      </div>
    </div>
  );
}
