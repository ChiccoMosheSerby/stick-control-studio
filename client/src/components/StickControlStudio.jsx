import React, { useState, useRef, useEffect, useCallback } from "react";
import s from "../styles/studio.module.scss";
import Notation from "./Notation.jsx";
import { fixAndDetect, readSticking } from "../lib/fixAndDetect.js";
import { flatten, fmt, SUBLABEL, LEVELS, BLANK } from "../lib/helpers.js";
import { api } from "../api.js";

const C = { R: "#E8A33D", L: "#4FB0A5", ok: "#6FBF73", muted: "#8A7E73", text: "#EDE6DD", panel: "#1F1A17", bg: "#14110F" };
const sumSec = (p) => Object.values(p).reduce((a, v) => a + (v.sec || 0), 0);

export default function StickControlStudio() {
  const [library, setLibrary] = useState([]);
  const [selId, setSelId] = useState(null);
  const [tempo, setTempo] = useState(76);
  const [repeats, setRepeats] = useState(20);
  const [subClicks, setSubClicks] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(-1);
  const [reps, setReps] = useState(0);
  const [progress, setProgress] = useState({});
  const [totalSec, setTotalSec] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [showImport, setShowImport] = useState(true);
  const [pending, setPending] = useState([]);
  const [busy, setBusy] = useState("");
  const fileRef = useRef(null);

  const ex = library.find((e) => e.id === selId);
  const flat = ex ? flatten(ex) : [];
  const cn = ex && cur >= 0 ? flat[cur] : null;
  const showNote = cn && !cn.rest && cn.h;
  const col = showNote ? (cn.h === "R" ? C.R : C.L) : C.muted;
  const pr = progress[selId] || BLANK;

  const ctxRef = useRef(null), schedRef = useRef(null), rafRef = useRef(null);
  const nextT = useRef(0), idxRef = useRef(0), measRef = useRef(0), qRef = useRef([]), accRef = useRef(0);
  const flatRef = useRef([]), tempoRef = useRef(76), repRef = useRef(20), subRef = useRef(true), selRef = useRef(null);
  useEffect(() => { tempoRef.current = tempo; }, [tempo]);
  useEffect(() => { repRef.current = repeats; }, [repeats]);
  useEffect(() => { subRef.current = subClicks; }, [subClicks]);
  useEffect(() => { selRef.current = selId; }, [selId]);

  // load library + progress from the server
  useEffect(() => { (async () => {
    try {
      const [lib, prog] = await Promise.all([api.getExercises(), api.getProgress()]);
      if (lib.length) { setLibrary(lib); setSelId(lib[0].id); setShowImport(false); }
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

  // ---- audio engine ----
  const ensure = async () => { if (!ctxRef.current) ctxRef.current = new (window.AudioContext || window.webkitAudioContext)(); await ctxRef.current.resume(); };
  const click = (t, f, g) => { const c = ctxRef.current, o = c.createOscillator(), gg = c.createGain(); o.frequency.value = f; gg.gain.setValueAtTime(g, t); gg.gain.exponentialRampToValueAtTime(0.0001, t + 0.05); o.connect(gg).connect(c.destination); o.start(t); o.stop(t + 0.06); };
  const voice = (t, n) => { if (n.measureStart) click(t, 1700, 0.55); else if (n.beatStart) click(t, 1100, 0.4); else if (subRef.current && !n.rest) click(t, 800, 0.15); };
  const scheduler = useCallback(() => {
    const c = ctxRef.current, Fl = flatRef.current; if (!Fl.length) return;
    while (nextT.current < c.currentTime + 0.12) {
      const n = Fl[idxRef.current]; voice(nextT.current, n); qRef.current.push({ time: nextT.current, idx: idxRef.current });
      nextT.current += (1 / n.sub) * (60 / tempoRef.current); idxRef.current++;
      if (idxRef.current >= Fl.length) { idxRef.current = 0; measRef.current++; if (measRef.current >= repRef.current) { finish(); return; } }
    }
  }, []);
  const draw = useCallback(() => {
    const c = ctxRef.current;
    if (c) while (qRef.current.length && qRef.current[0].time <= c.currentTime) { const e = qRef.current.shift(); setCur(e.idx); setReps(measRef.current); }
    rafRef.current = requestAnimationFrame(draw);
  }, []);
  const credit = () => {
    const did = measRef.current - accRef.current; if (did <= 0) return; accRef.current = measRef.current; const id = selRef.current;
    setProgress((p) => { const c = p[id] || BLANK; return { ...p, [id]: { ...c, reps: (c.reps || 0) + did, bestTempo: Math.max(c.bestTempo || 0, tempoRef.current), done: c.done || measRef.current >= repRef.current } }; });
  };
  const play = async () => { const e = library.find((x) => x.id === selRef.current); if (!e) return; await ensure(); flatRef.current = flatten(e); nextT.current = ctxRef.current.currentTime + 0.06; setPlaying(true); schedRef.current = setInterval(scheduler, 25); rafRef.current = requestAnimationFrame(draw); };
  const pause = () => { setPlaying(false); clearInterval(schedRef.current); cancelAnimationFrame(rafRef.current); qRef.current = []; credit(); };
  const finish = () => { pause(); setCur(-1); idxRef.current = 0; measRef.current = 0; accRef.current = 0; setReps(repeats); };
  const reset = () => { pause(); idxRef.current = 0; measRef.current = 0; accRef.current = 0; setCur(-1); setReps(0); };
  const pick = (id) => { reset(); setSelId(id); };
  useEffect(() => () => pause(), []);

  // ---- import ----
  const onFiles = (files) => {
    Array.from(files || []).forEach((f) => { const rd = new FileReader(); rd.onload = () => setPending((p) => [...p, { dataUrl: rd.result, b64: rd.result.split(",")[1], media: f.type || "image/png" }]); rd.readAsDataURL(f); });
  };
  const clearAll = async () => { pause(); setSelId(null); setLibrary([]); await api.clearExercises().catch(() => {}); };
  const addAll = async () => {
    if (!pending.length) return; const list = pending.slice(); const made = [];
    for (let k = 0; k < list.length; k++) {
      setBusy("Fixing & detecting " + (k + 1) + " / " + list.length + "…");
      const p = list[k]; let res = null; try { res = await fixAndDetect(p.dataUrl); } catch (e) { res = null; }
      let stick = ""; try { stick = await readSticking(p.b64, p.media); } catch (e) {}
      const idBase = "u_" + Date.now() + "_" + k; const nm = "Exercise " + (library.length + made.length + 1);
      const N = 16;                                  // Stick Control single-beat combos = 16 eighth notes
      const clean = res && res.fr.length >= 13 && res.fr.length <= 19;
      let pos = null;
      if (clean) { pos = res.fr.slice(); while (pos.length > N) pos.pop(); while (pos.length < N) { const d = pos.length > 1 ? pos[pos.length - 1] - pos[pos.length - 2] : 0.05; pos.push(Math.min(0.99, pos[pos.length - 1] + d)); } }
      if (stick.length < N) stick = (stick + "RLRLRLRLRLRLRLRLRLRLRLRLRLRLRLRL").slice(0, N);
      const beats = []; for (let i = 0; i < N; i += 2) { const a = { h: stick[i] }, b = { h: stick[i + 1] }; if (pos) { a.x = pos[i]; b.x = pos[i + 1]; } beats.push({ sub: 2, notes: [a, b] }); }
      const exNew = { id: idBase, name: nm, img: (res && res.img) ? res.img : p.dataUrl, aligned: clean, noteY: res ? res.noteY : 0.45, timeSig: "¢", meter: "cut time (2/2)", noteValue: "eighth notes", measureBeats: 4, beats };
      made.push(exNew);
      api.addExercise(exNew).catch(() => {});   // persist to server
    }
    setLibrary((l) => [...l, ...made]); setPending([]); setBusy(""); setShowImport(false); if (made[0]) pick(made[0].id);
  };

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
            : <div className={s.pickerEmpty}>No exercises — add images to begin</div>}
          <button className={`${s.btn} ${showImport ? s.active : ""}`} onClick={() => setShowImport((v) => !v)}>Add images</button>
          {library.length > 0 && <button className={s.btnGhost} onClick={clearAll}>Clear</button>}
        </div>

        {showImport && (
          <div className={s.importPanel}>
            <div className={`${s.dropzone} ${pending.length ? s.has : ""}`}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); onFiles(e.dataTransfer.files); }}>
              {pending.length
                ? <div className={s.thumbs}>{pending.map((p, i) => <img key={i} src={p.dataUrl} alt="" />)}</div>
                : <div className={s.dropHint}>Drop one or several sharp exercise images (one line each), or click.</div>}
              <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => onFiles(e.target.files)} />
            </div>
            <button className={s.addBtn} disabled={!pending.length || !!busy} onClick={addAll}>
              {busy || (pending.length ? "Fix & add " + pending.length + (pending.length > 1 ? " exercises" : " exercise") : "Add")}
            </button>
            <div className={s.hint}>On add, each image is straightened, cropped, centered and its noteheads detected — so it comes in aligned. Detection is best-effort in the browser; sharp, straight photos work best.</div>
          </div>
        )}

        {!ex && !busy && (
          <div className={s.empty}>
            <div className={s.emptyTitle}>No exercise loaded</div>
            <div className={s.emptySub}>Add sharp single-line images above — they're fixed and aligned on the way in.</div>
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

          <div className={s.notationCard}><Notation ex={ex} cn={cn} showNote={showNote} col={col} /></div>

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
            <div className={s.handBox} style={{ background: showNote ? col : C.panel, color: showNote ? C.bg : C.muted }}>{showNote ? cn.h : "–"}</div>
            <div className={s.counter}>
              <div className={s.count}>{Math.min(reps + (playing ? 1 : 0), repeats)}<span> / {repeats}</span></div>
              <div className={s.countLabel}>{cn ? (cn.rest ? "rest" : SUBLABEL[cn.sub]) : "repetitions"}</div>
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
