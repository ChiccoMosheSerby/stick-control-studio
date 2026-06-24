import s from "../styles/studio.module.scss";

// Note-region inset so structural dots never sit on the clef/time-sig (left) or final barline (right).
const LEFT = 0.16, RIGHT = 0.95;

// Real photo + highlight dot. If the note carries a detected x, snap to it; otherwise place it
// structurally by onset TIME (onsetQ/totalQ) so the dot stays in lockstep with the metronome for
// any rhythm — a quarter and a 16th get proportional horizontal gaps.
export default function Notation({ ex, cn, showNote, col, totalQ }) {
  let dotX = null;
  if (showNote) {
    if (cn.x != null) dotX = cn.x;
    else if (totalQ > 0) dotX = LEFT + (RIGHT - LEFT) * (cn.onsetQ / totalQ);
  }
  return (
    <div className={s.notation}>
      <img src={ex.img} alt={ex.name} draggable={false} />
      {dotX != null && (
        <div
          className={s.dot}
          style={{ left: dotX * 100 + "%", top: ex.noteY * 100 + "%", background: col, boxShadow: `0 0 0 2px ${col}` }}
        />
      )}
    </div>
  );
}
