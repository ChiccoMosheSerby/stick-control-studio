import s from "../styles/studio.module.scss";

// Real photo + highlight dot snapped onto the detected notehead (only when a position exists).
export default function Notation({ ex, cn, showNote, col }) {
  return (
    <div className={s.notation}>
      <img src={ex.img} alt={ex.name} draggable={false} />
      {showNote && cn.x != null && (
        <div
          className={s.dot}
          style={{ left: cn.x * 100 + "%", top: ex.noteY * 100 + "%", background: col, boxShadow: `0 0 0 2px ${col}` }}
        />
      )}
    </div>
  );
}
