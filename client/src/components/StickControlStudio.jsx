import React, { useState, useRef, useEffect, useCallback } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { WheelGesturesPlugin } from "embla-carousel-wheel-gestures";
import s from "../styles/studio.module.scss";
import Notation from "./Notation.jsx";
import { flatten, fmt, durLabel, LEVELS, BLANK } from "../lib/helpers.js";
import { createPlayer } from "../lib/player.js";
import { TOPICS } from "../lib/topics.js";
import { api } from "../api.js";
import { useAuth } from "../lib/auth.jsx";

const C = { R: "#E8A33D", L: "#4FB0A5", F: "#B98AE0", ok: "#6FBF73", muted: "#8A7E73", text: "#EDE6DD", panel: "#1F1A17", bg: "#14110F" };
// Marker positions on /drum.png (% of the drum image). Both lit dots sit on the same
// horizontal line across the lower half of the two sticks; the L/R label is just below
// each dot. Left x is smaller than right x, so they read clearly as left vs right.
const STICKS = [
  { hand: "L", col: C.L, left: "42%", top: "62%" },
  { hand: "R", col: C.R, left: "61.5%", top: "62%" },
];
const sumSec = (p) => Object.values(p).reduce((a, v) => a + (v.sec || 0), 0);

// Persisted user preferences (tempo, repeats, click mode, volume) — survive reloads.
const SETTINGS_KEY = "scs:settings";
const loadSettings = () => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch { return {}; } };

export default function StickControlStudio() {
  const { user, logout } = useAuth();
  const [library, setLibrary] = useState([]);
  const [topicId, setTopicId] = useState(null);
  const [selId, setSelId] = useState(null);
  const [tempo, setTempo] = useState(() => loadSettings().tempo ?? 76);
  const [repeats, setRepeats] = useState(() => loadSettings().repeats ?? 20);
  const [subClicks, setSubClicks] = useState(() => loadSettings().subClicks ?? true);
  const [volume, setVolume] = useState(() => loadSettings().volume ?? 0.8);
  const [playing, setPlaying] = useState(false);
  const [demoing, setDemoing] = useState(false);        // preview playback: sound+visual, not counted
  const [advanceToken, setAdvanceToken] = useState(0);  // bump -> carousel advances to the next exercise
  const [countIn, setCountIn] = useState(0);            // 1..4 during the pre-roll count, 0 = none
  const [cur, setCur] = useState(-1);
  const [reps, setReps] = useState(0);
  const [progress, setProgress] = useState({});
  const [totalSec, setTotalSec] = useState(0);
  const [loaded, setLoaded] = useState(false);

  // topics: each section in the book is a topic; its exercises are the library rows
  // whose `section` matches. Every topic is selectable; one with no exercises yet
  // shows a "soon" placeholder instead of a carousel.
  const hasEx = (section) => library.some((e) => e.section === section);
  const topic = TOPICS.find((t) => t.id === topicId);
  const topicExercises = topic ? library.filter((e) => e.section === topic.section) : [];
  const available = topicExercises.length > 0;  // false -> show placeholders, keep layout

  // draggable topic strip (Embla — mirrors the ketolog carousel: drag on mouse/touch,
  // WheelGestures adds two-finger trackpad swipe)
  const [topicRef, topicApi] = useEmblaCarousel({ align: "start", dragFree: true, containScroll: "trimSnaps" }, [WheelGesturesPlugin()]);

  const ex = library.find((e) => e.id === selId);
  const flat = ex ? flatten(ex) : [];
  const totalQ = flat.length ? flat[flat.length - 1].onsetQ + flat[flat.length - 1].dur : 1;  // for time-based dot placement
  const cn = ex && cur >= 0 ? flat[cur] : null;
  const showNote = cn && !cn.rest && cn.hand;
  const col = showNote ? (cn.hand === "R" ? C.R : cn.hand === "F" ? C.F : C.L) : C.muted;
  const pr = progress[selId] || BLANK;
  const doneIds = new Set(Object.keys(progress).filter((k) => progress[k]?.done));  // for the ✓ on done exercises

  const playerRef = useRef(null), measRef = useRef(0), accRef = useRef(0);
  const demoRef = useRef(false), resumeRef = useRef(false), exListRef = useRef([]);
  exListRef.current = topicExercises;   // current topic's exercises, for auto-advance order
  const tempoRef = useRef(76), repRef = useRef(20), subRef = useRef(true), volRef = useRef(0.8), selRef = useRef(null);
  useEffect(() => { tempoRef.current = tempo; }, [tempo]);
  useEffect(() => { repRef.current = repeats; }, [repeats]);
  useEffect(() => { subRef.current = subClicks; }, [subClicks]);
  useEffect(() => { volRef.current = volume; }, [volume]);
  useEffect(() => { selRef.current = selId; }, [selId]);
  // persist preferences whenever they change
  useEffect(() => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ tempo, repeats, subClicks, volume })); } catch { /* storage unavailable */ }
  }, [tempo, repeats, subClicks, volume]);

  // load library + progress from the server
  useEffect(() => { (async () => {
    try {
      const [lib, prog] = await Promise.all([api.getExercises(), api.getProgress()]);
      if (lib.length) {
        setLibrary(lib);
        const first = TOPICS.find((t) => t.enabled && lib.some((e) => e.section === t.section));
        if (first) { setTopicId(first.id); setSelId(lib.find((e) => e.section === first.section).id); }
      }
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

  // count practice time while playing — but NOT during a demo (preview shouldn't bank time)
  useEffect(() => {
    if (!playing || demoing) return;
    const t = setInterval(() => {
      setTotalSec((s2) => s2 + 1);
      setProgress((p) => { const id = selRef.current, c = p[id] || BLANK; return { ...p, [id]: { ...c, sec: (c.sec || 0) + 1 } }; });
    }, 1000);
    return () => clearInterval(t);
  }, [playing, demoing]);

  // ---- audio engine (durations drive timing; see lib/player.js) ----
  const credit = () => {
    if (demoRef.current) return;   // a demo never banks reps/progress
    const did = measRef.current - accRef.current; if (did <= 0) return; accRef.current = measRef.current; const id = selRef.current;
    setProgress((p) => { const c = p[id] || BLANK; return { ...p, [id]: { ...c, reps: (c.reps || 0) + did, bestTempo: Math.max(c.bestTempo || 0, tempoRef.current), done: c.done || measRef.current >= repRef.current } }; });
  };
  const ensurePlayer = () => {
    if (playerRef.current) return playerRef.current;
    playerRef.current = createPlayer({
      getTempo: () => tempoRef.current,
      getRepeats: () => (demoRef.current ? 1 : repRef.current),   // demo plays a single pass
      getEveryNote: () => subRef.current,
      getVolume: () => volRef.current,
      onNote: (idx) => setCur(idx),
      onCount: (n) => setCountIn(n),   // pre-roll count display (1..4, then 0)
      onRepeat: (m) => { measRef.current = m; setReps(m); },
      onFinish: () => {
        if (playerRef.current) playerRef.current.reset();
        if (demoRef.current) {   // preview done: clean up, count nothing
          demoRef.current = false; setDemoing(false); setPlaying(false); setCur(-1);
          measRef.current = 0; accRef.current = 0; setReps(0); return;
        }
        credit();                                  // bank the completed reps + mark done
        measRef.current = 0; accRef.current = 0; setCur(-1);
        const list = exListRef.current, i = list.findIndex((e) => e.id === selRef.current);
        if (i >= 0 && i < list.length - 1) {       // auto-advance to the next exercise and keep playing
          resumeRef.current = true; setReps(0); setAdvanceToken((t) => t + 1);
        } else {                                    // last exercise in the topic: stop on a full count
          setPlaying(false); setReps(repRef.current);
        }
      }
    });
    return playerRef.current;
  };
  const play = async () => { const e = library.find((x) => x.id === selRef.current); if (!e) return; demoRef.current = false; setDemoing(false); setPlaying(true); await ensurePlayer().play(flatten(e), e.measureBeats || 4); };
  const demo = async () => {   // preview: hear + see the exercise once, nothing counted
    const e = library.find((x) => x.id === selRef.current); if (!e) return;
    if (playerRef.current) playerRef.current.reset();
    measRef.current = 0; accRef.current = 0; resumeRef.current = false; setReps(0);
    demoRef.current = true; setDemoing(true); setPlaying(true);
    await ensurePlayer().play(flatten(e), e.measureBeats || 4);
  };
  const pause = () => {
    if (playerRef.current) playerRef.current.stop();
    setCountIn(0);   // abandon any in-progress count-in
    if (demoRef.current) { demoRef.current = false; setDemoing(false); setPlaying(false); setCur(-1); measRef.current = 0; accRef.current = 0; setReps(0); return; }
    setPlaying(false); credit();   // bank partial reps on pause
  };
  const reset = () => { pause(); if (playerRef.current) playerRef.current.reset(); measRef.current = 0; accRef.current = 0; setCur(-1); setReps(0); };
  const pickExercise = useCallback((id) => { reset(); setSelId(id); }, []);
  // after an auto-advance lands on the next exercise, resume playback there
  useEffect(() => { if (resumeRef.current) { resumeRef.current = false; play(); } }, [selId]);
  const pickTopic = (id) => {
    if (id === topicId) return;
    reset(); setTopicId(id);
    const t = TOPICS.find((x) => x.id === id);
    const first = t && library.find((e) => e.section === t.section);
    setSelId(first ? first.id : null);  // empty topics have no exercise -> placeholder
    const i = TOPICS.findIndex((x) => x.id === id);
    if (topicApi && i >= 0) topicApi.scrollTo(i);  // pull the chosen chip into view
  };
  useEffect(() => () => { if (playerRef.current) playerRef.current.stop(); }, []);

  const toggleDone = () => setProgress((p) => ({ ...p, [selId]: { ...(p[selId] || BLANK), done: !(p[selId] || BLANK).done } }));
  const resetAllProgress = () => {
    if (!window.confirm("Reset all practice memory? This permanently clears reps, times, best tempos and done marks for every exercise.")) return;
    reset(); setProgress({}); setTotalSec(0);
    api.resetProgress().catch(() => {});  // clear server-side; an empty PUT only upserts, it can't delete
  };

  return (
    <div className={s.app}>
      {/* tempo-matched pre-roll count, big and centred near the top of the screen */}
      {countIn > 0 && <div key={countIn} className={s.countIn} aria-hidden="true">{countIn}</div>}
      <div className={s.container}>
        <div className={s.topbar}>
          <div className={s.brandRow}>
            <img src="/logo.png" alt="" width={26} height={22} />
            <span className={s.label}>Stick Control · Studio</span>
          </div>
          <div className={s.practiced}>
            <span>Practiced <span className={s.mono}>{fmt(totalSec)}</span></span>
            {user && (<>
              <span className={s.email}>{user.email}</span>
              <button className={s.signOut} onClick={() => { reset(); logout(); }}>Sign out</button>
            </>)}
          </div>
        </div>

        {library.length > 0
          ? <div className={s.topicEmbla} ref={topicRef}>
              <div className={s.topicTrack}>
                {TOPICS.map((t) => (
                  <div className={s.topicSlide} key={t.id}>
                    <button type="button"
                      className={`${s.topicChip} ${t.id === topicId ? s.active : ""} ${hasEx(t.section) ? "" : s.pending}`}
                      onClick={() => pickTopic(t.id)} title={t.name}>
                      {t.name}{!hasEx(t.section) && <span className={s.soon}>soon</span>}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          : <div className={s.pickerEmpty}>{loaded ? "No exercises found" : "Loading…"}</div>}

        {!topic && loaded && library.length === 0 && (
          <div className={s.empty}>
            <div className={s.emptyTitle}>No exercise loaded</div>
            <div className={s.emptySub}>The exercise library didn't load — check that /exercises/exercises.json is served.</div>
          </div>
        )}

        {/* A selected topic always renders the full layout. Topics not transcribed yet
            show placeholders with disabled controls, so the layout never jumps. */}
        {topic && (<>
          {available
            ? <ExerciseCarousel
                key={topic.id}
                exercises={topicExercises}
                currentId={selId}
                onPick={pickExercise}
                doneIds={doneIds}
                advanceToken={advanceToken}
                live={{ cn, showNote, col, totalQ }}
              />
            : <>
                {/* skeleton placeholder for a not-yet-transcribed topic — same elements and
                    heights as the live carousel (meta row, notation card, dots) so the UI never jumps */}
                <div className={s.metaRow}>
                  <div className={s.metaName}>{topic.name}</div>
                  <div className={s.metaInfo}><span className={s.skel} style={{ width: 96, height: 18 }} /></div>
                </div>
                <div className={s.notationCard}>
                  <div className={`${s.notation} ${s.skelNotation}`}>
                    <div className={s.skel} style={{ width: "94%" }} />
                    <div className={s.skel} style={{ width: "80%" }} />
                    <div className={s.skel} style={{ width: "88%" }} />
                    <div className={s.skelBadge}>
                      <span className={s.soonBadge}>soon</span>
                      <span className={s.soonSub}>Pages {topic.pdfPages[0]}–{topic.pdfPages[1]} — coming soon</span>
                    </div>
                  </div>
                </div>
                <div className={s.exDots}>
                  {Array.from({ length: 7 }).map((_, i) => <span key={i} className={`${s.exDot} ${i === 0 || i === 6 ? s.edge : ""}`} />)}
                </div>
              </>}

          <div className={s.transport}>
            <div className={s.repeatBox}>
              <span className={s.repeatLabel}>Repeat</span>
              <input className={s.repeatInput} type="number" min={1} value={repeats} disabled={!available} onChange={(e) => setRepeats(Math.max(1, +e.target.value))} />
              <span className={s.repeatLabel}>×</span>
            </div>
            <button className={s.playBtn} onClick={(playing && !demoing) ? pause : play} disabled={!available || demoing}>{(playing && !demoing) ? "Pause" : (reps > 0 ? "Resume" : "Play")}</button>
            <button className={s.demoBtn} onClick={demoing ? pause : demo} disabled={!available || (playing && !demoing)}
              title="Preview — hear and watch this exercise once (not counted toward progress)">{demoing ? "Stop" : "Demo"}</button>
            <button className={s.resetBtn} onClick={reset} disabled={!available || demoing}>Reset</button>
          </div>

          <div className={s.handRow}>
            <div className={s.drum}>
              <img className={s.drumImg} src="/drum.png" alt="snare drum" draggable={false} />
              {STICKS.map((st) => {
                const on = showNote && (cn.hand === st.hand || cn.hand === "F");
                return (
                  <div key={st.hand} className={s.stick} style={{ left: st.left, top: st.top }}>
                    {/* key={cur} remounts the dot each note so it re-blinks; the animation
                        decays to dim, so each strike is a short flash, not a held light */}
                    <span key={on ? cur : "off"} className={`${s.bead} ${on ? s.beadOn : ""}`}
                          style={on ? { background: st.col, boxShadow: `0 0 12px 4px ${st.col}` } : undefined} />
                    <span className={s.stickLabel} style={{ color: on ? st.col : C.muted }}>{st.hand}</span>
                  </div>
                );
              })}
            </div>
            <div className={s.counter}>
              <div className={s.count}>{Math.min(reps + (playing ? 1 : 0), repeats)}<span> / {repeats}</span></div>
              <div className={s.countLabel}>{durLabel(cn)}</div>
            </div>
            {/* beat counter: which quarter-note pulse of the bar we're on (1·2·3·4) */}
            <div className={s.beatRow}>
              {Array.from({ length: cn?.beats || 4 }).map((_, i) => (
                <span key={i} className={`${s.beatNum} ${cn && cn.beat === i + 1 ? s.beatOn : ""}`}>{i + 1}</span>
              ))}
            </div>
          </div>

          <div className={s.card}>
            <div className={s.tempoHead}><span>Tempo (♩ = quarter)</span><span className="val" style={{ fontFamily: "ui-monospace, monospace", color: C.text }}>♩ = {tempo}</span></div>
            <input className={s.range} type="range" min={40} max={200} value={tempo} disabled={!available} onChange={(e) => setTempo(+e.target.value)} />
            <div className={s.levels}>
              {LEVELS.map(([n, t]) => (
                <button key={n} className={`${s.levelBtn} ${tempo === t ? s.active : ""}`} disabled={!available} onClick={() => setTempo(t)}><span>{t}</span></button>
              ))}
            </div>
            <div className={s.tempoHead} style={{ marginTop: 16 }}><span>Click volume</span><span className="val" style={{ fontFamily: "ui-monospace, monospace", color: C.text }}>{Math.round(volume * 100)}%</span></div>
            <input className={s.range} type="range" min={0} max={100} value={Math.round(volume * 100)} disabled={!available} onChange={(e) => setVolume(+e.target.value / 100)} />
          </div>

          <div className={s.clickToggle}>
            <button className={`${s.clickBtn} ${!subClicks ? s.active : ""}`} disabled={!available} onClick={() => setSubClicks(false)}>Click: 1 · 2 · 3 · 4</button>
            <button className={`${s.clickBtn} ${subClicks ? s.active : ""}`} disabled={!available} onClick={() => setSubClicks(true)}>Click: every note</button>
          </div>

          <div className={s.card}>
            <div className={s.progressHead}>
              <span className={s.progressTitle}>This exercise</span>
              <button className={`${s.doneBtn} ${pr.done ? s.on : ""}`} disabled={!available} onClick={toggleDone}>{pr.done ? "✓ Done" : "Mark done"}</button>
            </div>
            <div className={s.stats}>
              <div><div className={s.statNum}>{pr.bestTempo || "–"}</div><div className={s.statLabel}>best ♩</div></div>
              <div><div className={s.statNum}>{pr.reps || 0}</div><div className={s.statLabel}>reps</div></div>
              <div><div className={s.statNum}>{fmt(pr.sec)}</div><div className={s.statLabel}>time</div></div>
            </div>
          </div>
        </>)}

        {loaded && library.length > 0 && (
          <div className={s.dangerZone}>
            <button className={s.resetAllBtn} onClick={resetAllProgress}>Reset all practice memory</button>
          </div>
        )}
      </div>
    </div>
  );
}

// One topic's exercises as a swipeable Embla carousel (same engine as ketolog).
// Full-width slides; swipe / drag / arrows move between exercises, no wrap-around.
// Remounted per topic (keyed by topic.id), so it always starts on the first exercise.
function ExerciseCarousel({ exercises, currentId, onPick, doneIds, advanceToken, live }) {
  const [emblaRef, emblaApi] = useEmblaCarousel({ align: "center", loop: false }, [WheelGesturesPlugin()]);
  const [sel, setSel] = useState(0);
  const exRef = useRef(exercises); exRef.current = exercises;   // stable across re-renders
  const pickRef = useRef(onPick); pickRef.current = onPick;
  const tokRef = useRef(advanceToken);                          // last-seen advance token

  useEffect(() => {
    if (!emblaApi) return;
    const onSelect = () => {
      const i = emblaApi.selectedScrollSnap();
      setSel(i);
      const e = exRef.current[i];
      if (e) pickRef.current(e.id);   // -> parent selId + resets playback
    };
    emblaApi.on("select", onSelect);
    return () => emblaApi.off("select", onSelect);
  }, [emblaApi]);

  // auto-advance: when the parent bumps advanceToken (an exercise hit its repeat count),
  // glide to the next exercise. Guard on a real change so topic re-mounts don't advance.
  useEffect(() => {
    if (advanceToken !== tokRef.current) { tokRef.current = advanceToken; if (emblaApi) emblaApi.scrollNext(); }
  }, [advanceToken, emblaApi]);

  const ex = exercises[sel] || exercises[0];

  // windowed bullets: a fixed run of dots centered on the current exercise. The
  // outermost dot shrinks when more exercises exist beyond the window's edge.
  const total = exercises.length;
  const W = Math.min(7, total);
  const start = Math.max(0, Math.min(sel - (W >> 1), total - W));
  const window = Array.from({ length: W }, (_, k) => start + k);
  return (
    <>
      <div className={s.metaRow}>
        <div className={s.metaName}>{ex.name}<span className={s.exPos}>{sel + 1} / {exercises.length}</span></div>
        <div className={s.metaInfo}>
          <span className={s.metaSig}>{ex.timeSig}</span><span>{ex.meter} · {ex.noteValue}</span>
          {!ex.aligned && <span className={s.metaWarn}>· metronome only (sharper photo locks the dot)</span>}
        </div>
      </div>

      <div className={s.carousel}>
        <div className={s.exEmbla} ref={emblaRef}>
          <div className={s.exTrack}>
            {exercises.map((e) => (
              <div className={s.exSlide} key={e.id}>
                <div className={s.notationCard}>
                  <Notation ex={e} {...(e.id === currentId ? live : {})} />
                  {doneIds.has(e.id) && <div className={s.doneCheck} aria-label="done">✓</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
        <button className={`${s.navBtn} ${s.navPrev}`} disabled={sel <= 0}
          onClick={() => emblaApi && emblaApi.scrollPrev()} aria-label="Previous exercise">‹</button>
        <button className={`${s.navBtn} ${s.navNext}`} disabled={sel >= exercises.length - 1}
          onClick={() => emblaApi && emblaApi.scrollNext()} aria-label="Next exercise">›</button>
      </div>

      <div className={s.exDots}>
        {window.map((i) => {
          const edge = (i === start && start > 0) || (i === start + W - 1 && start + W < total);
          return (
            <button key={i} aria-label={`Go to exercise ${i + 1}`}
              className={`${s.exDot} ${i === sel ? s.active : ""} ${doneIds.has(exercises[i].id) ? s.done : ""} ${edge ? s.edge : ""}`}
              onClick={() => emblaApi && emblaApi.scrollTo(i)} />
          );
        })}
      </div>
    </>
  );
}
