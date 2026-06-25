import { useRef, useState, useEffect } from "react";
import s from "../styles/studio.module.scss";

// Note-region inset so structural dots never sit on the clef/time-sig (left) or final barline (right).
const LEFT = 0.16, RIGHT = 0.95;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Real photo + highlight dot. If the note carries a detected x, snap to it; otherwise place it
// structurally by onset TIME (onsetQ/totalQ) so the dot stays in lockstep with the metronome for
// any rhythm — a quarter and a 16th get proportional horizontal gaps.
//
// Long lines (the page-9 Triplet combinations: 4 or 8 measures in one strip) are wider than the
// card. We detect that on image load and switch to a scrolling strip rendered at the card's height
// — notes stay full size — then auto-scroll horizontally to keep the active note centered.
export default function Notation({ ex, cn, showNote, col, totalQ }) {
  const viewRef = useRef(null);
  const [wide, setWide] = useState(false);

  let dotX = null;
  if (showNote && cn) {
    if (cn.x != null) dotX = cn.x;
    else if (totalQ > 0) dotX = LEFT + (RIGHT - LEFT) * (cn.onsetQ / totalQ);
  }

  // keep the active dot in view; reset to the start when idle or when the strip fits.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !wide) return;
    const sw = view.scrollWidth, vw = view.clientWidth;
    const left = (dotX == null || sw <= vw + 1) ? 0 : clamp(dotX * sw - vw / 2, 0, sw - vw);
    view.scrollTo({ left, behavior: "smooth" });
  }, [dotX, wide]);

  const onImgLoad = (e) => {
    const img = e.currentTarget, box = viewRef.current;
    if (!img.naturalWidth || !box || !box.clientHeight) return;
    setWide(img.naturalWidth / img.naturalHeight > (box.clientWidth / box.clientHeight) * 1.05);
  };

  const dot = dotX != null && (
    <div className={s.dot}
      style={{ left: dotX * 100 + "%", top: ex.noteY * 100 + "%", background: col, boxShadow: `0 0 0 2px ${col}` }} />
  );

  if (wide) {
    return (
      <div ref={viewRef} className={`${s.notation} ${s.notationScroll}`}>
        <div className={s.strip}>
          <img src={ex.img} alt={ex.name} draggable={false} loading="lazy" onLoad={onImgLoad} />
          {dot}
        </div>
      </div>
    );
  }
  return (
    <div ref={viewRef} className={s.notation}>
      <img src={ex.img} alt={ex.name} draggable={false} loading="lazy" onLoad={onImgLoad} />
      {dot}
    </div>
  );
}
