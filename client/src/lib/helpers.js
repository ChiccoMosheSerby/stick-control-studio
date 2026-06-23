export const SUBLABEL = { 1: "rest", 2: "eighths", 3: "triplet", 4: "16ths", 6: "sextuplet" };
export const LEVELS = [["Beginner", 60], ["Developing", 76], ["Intermediate", 92], ["Advanced", 110], ["Expert", 130]];
export const BLANK = { sec: 0, reps: 0, bestTempo: 0, done: false };

// Spread beats[] into a flat list of notes with timing flags for the player.
export const flatten = (ex) =>
  ex.beats.flatMap((b, bi) =>
    b.notes.map((n, j) => ({
      x: n.rest ? null : (n.x ?? null),
      h: n.rest ? null : (n.h || null),
      rest: !!n.rest,
      sub: b.sub,
      beatStart: j === 0,
      measureStart: j === 0 && bi % ex.measureBeats === 0
    }))
  );

export const fmt = (s) => {
  s = Math.floor(s || 0);
  return Math.floor(s / 60) + "m " + String(s % 60).padStart(2, "0") + "s";
};
