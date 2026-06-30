import { useRef, useLayoutEffect, useState, useEffect } from "react";
import { Renderer, Stave, StaveNote, Beam, Tuplet, Voice, Formatter, BarNote } from "vexflow";
import { resolveDur } from "../lib/rhythm.js";

// Staff.jsx — render a generated 2-bar rhythm line as real notation (VexFlow), then
// report the on-screen geometry of every note so the parent can sweep a playhead and
// drop tap-feedback markers exactly under the notes. Static render; geometry via callback.
const CODE = { quarter: "q", eighth: "8", "16th": "16", half: "h", whole: "w" };

// Build VexFlow tickables for one line, plus beam/tuplet groups and per-event metadata
// (onset in quarters + whether it's a rest), all in render order.
function build(piece) {
  const notes = [];          // tickables incl. BarNotes (what the Voice draws)
  const staveNotes = [];     // StaveNotes only, in event order (for geometry)
  const meta = [];           // { onsetQ, rest } aligned to staveNotes
  const beams = [], tuplets = [];
  let onsetQ = 0;

  (piece.measures || []).forEach((m, mi) => {
    if (mi > 0) notes.push(new BarNote());
    const evs = m.voices[0].events;
    let beatStart = 0, run = [], tripRun = [];
    const flushBeam = () => { if (run.length > 1) beams.push(new Beam(run)); run = []; };
    evs.forEach((e) => {
      const dur = e.dur ?? resolveDur(e.value, e.dots || 0, e.tuplet || null);
      const code = CODE[e.value] + (e.type === "rest" ? "r" : "");
      const sn = new StaveNote({ keys: ["b/4"], duration: code });
      notes.push(sn); staveNotes.push(sn); meta.push({ onsetQ, rest: e.type === "rest" });

      // beam runs of beamable notes (8/16) that live inside the same quarter beat
      const beamable = !e.rest && e.type !== "rest" && (e.value === "eighth" || e.value === "16th");
      const beat = Math.floor(onsetQ + 1e-6);
      if (beat !== beatStart) { flushBeam(); beatStart = beat; }
      if (beamable) run.push(sn); else flushBeam();

      if (e.tuplet) tripRun.push(sn);
      else if (tripRun.length) { tuplets.push(new Tuplet(tripRun, { num_notes: 3, notes_occupied: 2 })); tripRun = []; }
      onsetQ += dur;
    });
    flushBeam();
    if (tripRun.length) { tuplets.push(new Tuplet(tripRun, { num_notes: 3, notes_occupied: 2 })); tripRun = []; }
  });
  return { notes, staveNotes, meta, beams, tuplets, totalQ: onsetQ };
}

export default function Staff({ piece, onLayout }) {
  const hostRef = useRef(null);
  const [w, setW] = useState(0);
  const H = 132;

  // track container width so notation reflows responsively
  useEffect(() => {
    const el = hostRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el); setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el || !w || !piece) return;
    el.innerHTML = "";
    const renderer = new Renderer(el, Renderer.Backends.SVG);
    renderer.resize(w, H);
    const ctx = renderer.getContext();
    ctx.setFillStyle("#EDE6DD"); ctx.setStrokeStyle("#EDE6DD");

    const stave = new Stave(0, 18, w - 2);
    stave.addTimeSignature("4/4");
    stave.setContext(ctx).draw();

    const { notes, staveNotes, meta, beams, tuplets, totalQ } = build(piece);
    const voice = new Voice({ num_beats: Math.round(totalQ), beat_value: 4 }).setStrict(false);
    voice.addTickables(notes);
    new Formatter().joinVoices([voice]).format([voice], stave.getNoteEndX() - stave.getNoteStartX() - 16);
    voice.draw(ctx, stave);
    beams.forEach((b) => b.setContext(ctx).draw());
    tuplets.forEach((t) => t.setContext(ctx).draw());

    if (onLayout) {
      const marks = staveNotes.map((sn, i) => ({ onsetQ: meta[i].onsetQ, rest: meta[i].rest, x: sn.getAbsoluteX() }));
      onLayout({
        marks,
        totalQ,
        xStart: stave.getNoteStartX(),
        xEnd: stave.getNoteEndX(),
        top: 22, bottom: H - 16, width: w, height: H,
      });
    }
  }, [piece, w]);

  return <div ref={hostRef} style={{ width: "100%", height: H, position: "relative" }} />;
}
