import React, { useState, useRef, useEffect, useCallback } from "react";

const SUBLABEL = {
  1: "rest",
  2: "eighths",
  3: "triplet",
  4: "16ths",
  6: "sextuplet",
};
const C = {
  bg: "#14110F",
  panel: "#1F1A17",
  panel2: "#241C12",
  border: "#2E2825",
  text: "#EDE6DD",
  muted: "#8A7E73",
  R: "#E8A33D",
  L: "#4FB0A5",
  ok: "#6FBF73",
};
const LEVELS = [
  ["Beginner", 60],
  ["Developing", 76],
  ["Intermediate", 92],
  ["Advanced", 110],
  ["Expert", 130],
];
const BLANK = { sec: 0, reps: 0, bestTempo: 0, done: false, last: 0 };
const flatten = (ex) =>
  ex.beats.flatMap((b, bi) =>
    b.notes.map((n, j) => ({
      x: n.rest ? null : (n.x ?? null),
      h: n.rest ? null : n.h || null,
      rest: !!n.rest,
      sub: b.sub,
      beatStart: j === 0,
      measureStart: j === 0 && bi % ex.measureBeats === 0,
    })),
  );
const fmt = (s) => {
  s = Math.floor(s || 0);
  return Math.floor(s / 60) + "m " + String(s % 60).padStart(2, "0") + "s";
};
const defaultBeats = () =>
  Array.from({ length: 8 }, () => ({ sub: 2, notes: [{}, {}] }));
const loadImg = (src) =>
  new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = src;
  });

// ---- in-browser fix + notehead detection (straighten, sharpen/threshold, center, detect) ----
async function fixAndDetect(dataUrl) {
  const img = await loadImg(dataUrl);
  const scale = Math.min(1, 1000 / img.naturalWidth);
  const W = Math.round(img.naturalWidth * scale),
    H = Math.round(img.naturalHeight * scale);
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;
  const gray = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++)
    gray[i] = px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11;
  // adaptive threshold via integral image (local mean)
  const integ = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += gray[y * W + x];
      integ[(y + 1) * (W + 1) + (x + 1)] = integ[y * (W + 1) + (x + 1)] + row;
    }
  }
  const r = Math.max(8, Math.round(W / 40));
  const dark = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - r),
        y0 = Math.max(0, y - r),
        x1 = Math.min(W, x + r),
        y1 = Math.min(H, y + r);
      const s =
        integ[y1 * (W + 1) + x1] -
        integ[y0 * (W + 1) + x1] -
        integ[y1 * (W + 1) + x0] +
        integ[y0 * (W + 1) + x0];
      dark[y * W + x] =
        gray[y * W + x] < s / ((x1 - x0) * (y1 - y0)) - 8 ? 1 : 0;
    }
  // deskew via shear search (vertical shift per column)
  let bestS = 0,
    bestV = -1;
  for (let sl = -0.1; sl <= 0.1001; sl += 0.01) {
    const rs = new Float64Array(H);
    for (let x = 0; x < W; x += 2) {
      const sh = Math.round((x - W / 2) * sl);
      for (let y = 0; y < H; y++) {
        const yy = y + sh;
        if (yy >= 0 && yy < H && dark[yy * W + x]) rs[y]++;
      }
    }
    let m = 0;
    for (let y = 0; y < H; y++) m += rs[y];
    m /= H;
    let v = 0;
    for (let y = 0; y < H; y++) {
      const d = rs[y] - m;
      v += d * d;
    }
    if (v > bestV) {
      bestV = v;
      bestS = sl;
    }
  }
  // straighten BOTH the dark map (for detection) and the grayscale (for display)
  const d2 = new Uint8Array(W * H);
  const g2 = new Float32Array(W * H);
  g2.fill(255);
  for (let x = 0; x < W; x++) {
    const sh = Math.round((x - W / 2) * bestS);
    for (let y = 0; y < H; y++) {
      const yy = y + sh;
      if (yy >= 0 && yy < H) {
        if (dark[yy * W + x]) d2[y * W + x] = 1;
        g2[y * W + x] = gray[yy * W + x];
      }
    }
  }
  // content bbox + staff rows
  const rowSum = new Int32Array(H),
    colSum = new Int32Array(W);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (d2[y * W + x]) {
        rowSum[y]++;
        colSum[x]++;
      }
  let minx = W,
    maxx = 0,
    miny = H,
    maxy = 0;
  for (let y = 0; y < H; y++)
    if (rowSum[y] > 4) {
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
    }
  for (let x = 0; x < W; x++)
    if (colSum[x] > 3) {
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
    }
  minx = Math.max(0, minx - 6);
  maxx = Math.min(W - 1, maxx + 6);
  miny = Math.max(0, miny - 6);
  maxy = Math.min(H - 1, maxy + 6);
  const cw = maxx - minx + 1,
    chh = maxy - miny + 1;
  const isStaff = new Uint8Array(H);
  for (let y = 0; y < H; y++) if (rowSum[y] > 0.5 * W) isStaff[y] = 1;
  // staff vertical extent — beams sit ABOVE it, sticking letters BELOW it
  let staffTop = miny,
    staffBot = maxy,
    seen = false;
  for (let y = miny; y <= maxy; y++)
    if (isStaff[y]) {
      if (!seen) {
        staffTop = y;
        seen = true;
      }
      staffBot = y;
    }
  const staffH = Math.max(6, staffBot - staffTop);
  // notehead row = densest non-staff row WITHIN the staff (all 16 noteheads share one pitch)
  let nhRow = Math.round((staffTop + staffBot) / 2),
    nhMax = -1;
  for (let y = staffTop; y <= staffBot; y++) {
    if (isStaff[y]) continue;
    let c = 0;
    for (let xx = minx; xx <= maxx; xx++) if (d2[y * W + xx]) c++;
    if (c > nhMax) {
      nhMax = c;
      nhRow = y;
    }
  }
  const rad = Math.max(4, Math.round(staffH * 0.45));
  const b0 = Math.max(miny, nhRow - rad),
    b1 = Math.min(maxy, nhRow + rad);
  const colD = new Float64Array(cw);
  for (let xx = minx; xx <= maxx; xx++) {
    let c = 0;
    for (let y = b0; y <= b1; y++) if (d2[y * W + xx] && !isStaff[y]) c++;
    colD[xx - minx] = c;
  }
  const sm = new Float64Array(cw);
  for (let xx = 0; xx < cw; xx++) {
    let s = 0,
      n = 0;
    for (let k = -3; k <= 3; k++) {
      const z = xx + k;
      if (z >= 0 && z < cw) {
        s += colD[z];
        n++;
      }
    }
    sm[xx] = s / n;
  }
  let mx = 0;
  for (let xx = 0; xx < cw; xx++) if (sm[xx] > mx) mx = sm[xx];
  const thr = mx * 0.38;
  const fr = [];
  let x = 0;
  while (x < cw) {
    if (sm[x] > thr) {
      let j = x;
      while (j < cw && sm[j] > thr) j++;
      const c = (x + j) / 2 / cw;
      if (j - x > 2 && c > 0.1 && c < 0.97) fr.push(c);
      x = j + 2;
    } else x++;
  }
  // DISPLAY: grayscale, deskewed, cropped, centered — gentle brightness lift, NO hard threshold
  let lo = 255,
    hi = 0;
  for (let y = miny; y <= maxy; y++)
    for (let xx = minx; xx <= maxx; xx++) {
      const v = g2[y * W + xx];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  lo = lo + (hi - lo) * 0.06;
  const rng = Math.max(1, hi - lo);
  const out = document.createElement("canvas");
  out.width = cw;
  out.height = chh;
  const octx = out.getContext("2d");
  const oi = octx.createImageData(cw, chh);
  for (let y = 0; y < chh; y++)
    for (let xx = 0; xx < cw; xx++) {
      let v = ((g2[(y + miny) * W + (xx + minx)] - lo) / rng) * 255;
      v = v < 0 ? 0 : v > 255 ? 255 : v;
      const o = (y * cw + xx) * 4;
      oi.data[o] = oi.data[o + 1] = oi.data[o + 2] = v;
      oi.data[o + 3] = 255;
    }
  octx.putImageData(oi, 0, 0);
  return { img: out.toDataURL("image/png"), fr, noteY: (nhRow - miny) / chh };
}
async function readSticking(b64, media) {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 200,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: media, data: b64 },
              },
              {
                type: "text",
                text: "Read the drum sticking — the R and L letters printed under the staff, left to right. Return ONLY the letters as one uppercase string with no spaces, e.g. RLRLRLRLRLRLRLRL.",
              },
            ],
          },
        ],
      }),
    });
    const data = await res.json();
    return (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .toUpperCase()
      .replace(/[^RL]/g, "");
  } catch (e) {
    return "";
  }
}

function Notation({ ex, cn, showNote, col }) {
  return (
    <div style={{ position: "relative", width: "100%" }}>
      <img
        src={ex.img}
        alt={ex.name}
        style={{ width: "100%", display: "block" }}
        draggable={false}
      />
      {showNote && cn.x != null && (
        <div
          style={{
            position: "absolute",
            left: cn.x * 100 + "%",
            top: ex.noteY * 100 + "%",
            width: "4.5%",
            paddingBottom: "4.5%",
            transform: "translate(-50%,-50%)",
            borderRadius: "50%",
            background: col,
            opacity: 0.42,
            boxShadow: `0 0 0 2px ${col}`,
          }}
        />
      )}
    </div>
  );
}

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

  const ctxRef = useRef(null),
    schedRef = useRef(null),
    rafRef = useRef(null);
  const nextT = useRef(0),
    idxRef = useRef(0),
    measRef = useRef(0),
    qRef = useRef([]),
    accRef = useRef(0);
  const flatRef = useRef([]),
    tempoRef = useRef(76),
    repRef = useRef(20),
    subRef = useRef(true),
    selRef = useRef(null);
  useEffect(() => {
    tempoRef.current = tempo;
  }, [tempo]);
  useEffect(() => {
    repRef.current = repeats;
  }, [repeats]);
  useEffect(() => {
    subRef.current = subClicks;
  }, [subClicks]);
  useEffect(() => {
    selRef.current = selId;
  }, [selId]);

  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get("scs_v8");
        if (r && r.value) {
          const d = JSON.parse(r.value);
          if (d.progress) setProgress(d.progress);
          if (typeof d.totalSec === "number") setTotalSec(d.totalSec);
          if (Array.isArray(d.added) && d.added.length) {
            setLibrary(d.added);
            setSelId(d.added[0].id);
          }
        }
      } catch (e) {}
      setLoaded(true);
    })();
  }, []);
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => {
      const added = library.filter((e) => e.added);
      window.storage
        .set("scs_v8", JSON.stringify({ progress, totalSec, added }))
        .catch(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, [progress, totalSec, library, loaded]);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setTotalSec((s) => s + 1);
      setProgress((p) => {
        const id = selRef.current,
          c = p[id] || BLANK;
        return { ...p, [id]: { ...c, sec: (c.sec || 0) + 1 } };
      });
    }, 1000);
    return () => clearInterval(t);
  }, [playing]);

  const ensure = async () => {
    if (!ctxRef.current)
      ctxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    await ctxRef.current.resume();
  };
  const click = (t, f, g) => {
    const c = ctxRef.current,
      o = c.createOscillator(),
      gg = c.createGain();
    o.frequency.value = f;
    gg.gain.setValueAtTime(g, t);
    gg.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(gg).connect(c.destination);
    o.start(t);
    o.stop(t + 0.06);
  };
  const voice = (t, n) => {
    if (n.measureStart) click(t, 1700, 0.55);
    else if (n.beatStart) click(t, 1100, 0.4);
    else if (subRef.current && !n.rest) click(t, 800, 0.15);
  };
  const scheduler = useCallback(() => {
    const c = ctxRef.current,
      Fl = flatRef.current;
    if (!Fl.length) return;
    while (nextT.current < c.currentTime + 0.12) {
      const n = Fl[idxRef.current];
      voice(nextT.current, n);
      qRef.current.push({ time: nextT.current, idx: idxRef.current });
      nextT.current += (1 / n.sub) * (60 / tempoRef.current);
      idxRef.current++;
      if (idxRef.current >= Fl.length) {
        idxRef.current = 0;
        measRef.current++;
        if (measRef.current >= repRef.current) {
          finish();
          return;
        }
      }
    }
  }, []);
  const draw = useCallback(() => {
    const c = ctxRef.current;
    if (c)
      while (qRef.current.length && qRef.current[0].time <= c.currentTime) {
        const e = qRef.current.shift();
        setCur(e.idx);
        setReps(measRef.current);
      }
    rafRef.current = requestAnimationFrame(draw);
  }, []);
  const credit = () => {
    const did = measRef.current - accRef.current;
    if (did <= 0) return;
    accRef.current = measRef.current;
    const id = selRef.current;
    setProgress((p) => {
      const c = p[id] || BLANK;
      return {
        ...p,
        [id]: {
          ...c,
          reps: (c.reps || 0) + did,
          bestTempo: Math.max(c.bestTempo || 0, tempoRef.current),
          done: c.done || measRef.current >= repRef.current,
          last: Date.now(),
        },
      };
    });
  };
  const play = async () => {
    const e = library.find((x) => x.id === selRef.current);
    if (!e) return;
    await ensure();
    flatRef.current = flatten(e);
    nextT.current = ctxRef.current.currentTime + 0.06;
    setPlaying(true);
    schedRef.current = setInterval(scheduler, 25);
    rafRef.current = requestAnimationFrame(draw);
  };
  const pause = () => {
    setPlaying(false);
    clearInterval(schedRef.current);
    cancelAnimationFrame(rafRef.current);
    qRef.current = [];
    credit();
  };
  const finish = () => {
    pause();
    setCur(-1);
    idxRef.current = 0;
    measRef.current = 0;
    accRef.current = 0;
    setReps(repeats);
  };
  const reset = () => {
    pause();
    idxRef.current = 0;
    measRef.current = 0;
    accRef.current = 0;
    setCur(-1);
    setReps(0);
  };
  const pick = (id) => {
    reset();
    setSelId(id);
  };
  useEffect(() => () => pause(), []);

  const onFiles = (files) => {
    Array.from(files || []).forEach((f) => {
      const rd = new FileReader();
      rd.onload = () =>
        setPending((p) => [
          ...p,
          {
            dataUrl: rd.result,
            b64: rd.result.split(",")[1],
            media: f.type || "image/png",
          },
        ]);
      rd.readAsDataURL(f);
    });
  };
  const addAll = async () => {
    if (!pending.length) return;
    const list = pending.slice();
    const made = [];
    for (let k = 0; k < list.length; k++) {
      setBusy("Fixing & detecting " + (k + 1) + " / " + list.length + "…");
      const p = list[k];
      let res = null;
      try {
        res = await fixAndDetect(p.dataUrl);
      } catch (e) {
        res = null;
      }
      let stick = "";
      try {
        stick = await readSticking(p.b64, p.media);
      } catch (e) {}
      const idBase = "u_" + Date.now() + "_" + k;
      const nm = "Exercise " + (library.length + made.length + 1);
      const N = 16; // Stick Control single-beat combos = 16 eighth notes
      const clean = res && res.fr.length >= 13 && res.fr.length <= 19;
      let pos = null;
      if (clean) {
        pos = res.fr.slice();
        while (pos.length > N) pos.pop();
        while (pos.length < N) {
          const d =
            pos.length > 1 ? pos[pos.length - 1] - pos[pos.length - 2] : 0.05;
          pos.push(Math.min(0.99, pos[pos.length - 1] + d));
        }
      }
      if (stick.length < N)
        stick = (stick + "RLRLRLRLRLRLRLRLRLRLRLRLRLRLRLRL").slice(0, N);
      const beats = [];
      for (let i = 0; i < N; i += 2) {
        const a = { h: stick[i] },
          b = { h: stick[i + 1] };
        if (pos) {
          a.x = pos[i];
          b.x = pos[i + 1];
        }
        beats.push({ sub: 2, notes: [a, b] });
      }
      made.push({
        id: idBase,
        name: nm,
        img: res && res.img ? res.img : p.dataUrl,
        added: true,
        aligned: clean,
        noteY: res ? res.noteY : 0.45,
        timeSig: "¢",
        meter: "cut time (2/2)",
        noteValue: "eighth notes",
        measureBeats: 4,
        beats,
      });
    }
    setLibrary((l) => [...l, ...made]);
    setPending([]);
    setBusy("");
    setShowImport(false);
    if (made[0]) pick(made[0].id);
  };

  return (
    <div
      className="min-h-screen flex justify-center font-sans"
      style={{ background: C.bg, color: C.text, alignItems: "flex-start" }}
    >
      <div className="w-full max-w-[760px] px-5 py-5">
        <div className="flex items-center justify-between mb-3">
          <div
            className="text-[11px] tracking-[0.3em] uppercase"
            style={{ color: C.muted }}
          >
            Stick Control · Studio
          </div>
          <div className="text-xs" style={{ color: C.muted }}>
            Practiced{" "}
            <span className="font-mono" style={{ color: C.text }}>
              {fmt(totalSec)}
            </span>
          </div>
        </div>

        <div className="flex gap-2 mb-3">
          {library.length > 0 ? (
            <select
              value={selId || ""}
              onChange={(e) => pick(e.target.value)}
              className="flex-1 rounded-lg px-3 py-2.5 text-sm font-semibold outline-none"
              style={{
                background: C.panel,
                color: C.text,
                border: `1px solid ${C.border}`,
              }}
            >
              {library.map((e) => {
                const d = (progress[e.id] || BLANK).done;
                return (
                  <option key={e.id} value={e.id}>
                    {(d ? "✓ " : "") + e.name}
                  </option>
                );
              })}
            </select>
          ) : (
            <div
              className="flex-1 rounded-lg px-3 py-2.5 text-sm flex items-center"
              style={{
                background: C.panel,
                color: C.muted,
                border: `1px solid ${C.border}`,
              }}
            >
              No exercises — add images to begin
            </div>
          )}
          <button
            onClick={() => setShowImport((s) => !s)}
            className="px-4 rounded-lg text-sm font-semibold"
            style={{
              background: showImport ? C.panel2 : C.panel,
              color: C.text,
              border: `1px solid ${C.border}`,
            }}
          >
            Add images
          </button>
          {library.length > 0 && (
            <button
              onClick={() => {
                pause();
                setSelId(null);
                setLibrary([]);
              }}
              className="px-3 rounded-lg text-sm font-semibold"
              style={{
                background: C.panel,
                color: C.muted,
                border: `1px solid ${C.border}`,
              }}
            >
              Clear
            </button>
          )}
        </div>

        {showImport && (
          <div
            className="rounded-xl border p-3 mb-3"
            style={{ borderColor: C.border, background: C.panel }}
          >
            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                onFiles(e.dataTransfer.files);
              }}
              className="rounded-lg text-center cursor-pointer"
              style={{
                border: `1.5px dashed ${C.border}`,
                padding: pending.length ? 10 : 22,
                background: C.bg,
              }}
            >
              {pending.length ? (
                <div className="flex gap-2 flex-wrap justify-center">
                  {pending.map((p, i) => (
                    <img
                      key={i}
                      src={p.dataUrl}
                      alt=""
                      style={{ height: 54, borderRadius: 4 }}
                    />
                  ))}
                </div>
              ) : (
                <div style={{ color: C.muted, fontSize: 13 }}>
                  Drop one or several sharp exercise images (one line each), or
                  click.
                </div>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => onFiles(e.target.files)}
              />
            </div>
            <button
              disabled={!pending.length || !!busy}
              onClick={addAll}
              className="w-full mt-3 py-2.5 rounded-lg font-bold text-sm"
              style={{
                background: pending.length ? C.R : C.panel,
                color: pending.length ? C.bg : C.muted,
                opacity: busy ? 0.7 : 1,
                border: "none",
              }}
            >
              {busy ||
                (pending.length
                  ? "Fix & add " +
                    pending.length +
                    (pending.length > 1 ? " exercises" : " exercise")
                  : "Add")}
            </button>
            <div className="text-xs mt-2" style={{ color: C.muted }}>
              On add, each image is straightened, sharpened, centered and its
              noteheads detected — so it comes in aligned. If a frame blocks
              image processing, it\u2019s added with the click only.
            </div>
          </div>
        )}

        {!ex && !busy && (
          <div
            className="rounded-xl border p-10 text-center"
            style={{
              borderColor: C.border,
              background: C.panel,
              color: C.muted,
            }}
          >
            <div className="text-sm font-semibold" style={{ color: C.text }}>
              No exercise loaded
            </div>
            <div className="text-xs mt-1">
              Add sharp single-line images above — they\u2019re fixed and
              aligned on the way in.
            </div>
          </div>
        )}

        {ex && (
          <>
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-bold">{ex.name}</div>
              <div
                className="flex items-center gap-2 text-xs"
                style={{ color: C.muted }}
              >
                <span className="text-xl" style={{ color: C.text }}>
                  {ex.timeSig}
                </span>
                <span>
                  {ex.meter} · {ex.noteValue}
                </span>
                {!ex.aligned && (
                  <span style={{ color: C.R }}>
                    · metronome only (sharper photo locks the dot)
                  </span>
                )}
              </div>
            </div>

            <div className="rounded-xl p-4 mb-3" style={{ background: "#fff" }}>
              <Notation ex={ex} cn={cn} showNote={showNote} col={col} />
            </div>

            <div className="flex items-center gap-3 mb-4">
              <div
                className="flex items-center gap-2 px-3 py-3.5 rounded-xl border"
                style={{ borderColor: C.border, background: C.panel }}
              >
                <span
                  className="text-xs uppercase tracking-wider"
                  style={{ color: C.muted }}
                >
                  Repeat
                </span>
                <input
                  type="number"
                  min={1}
                  value={repeats}
                  onChange={(e) => setRepeats(Math.max(1, +e.target.value))}
                  className="w-12 bg-transparent outline-none font-mono text-center"
                  style={{ color: C.text }}
                />
                <span className="text-xs" style={{ color: C.muted }}>
                  ×
                </span>
              </div>
              <button
                onClick={playing ? pause : play}
                className="flex-1 py-3.5 rounded-xl font-black text-lg active:scale-[0.99] transition"
                style={{ background: C.R, color: C.bg }}
              >
                {playing ? "Pause" : reps > 0 ? "Resume" : "Play"}
              </button>
              <button
                onClick={reset}
                className="px-4 py-3.5 rounded-xl border font-semibold"
                style={{
                  borderColor: C.border,
                  background: C.panel,
                  color: C.muted,
                }}
              >
                Reset
              </button>
            </div>

            <div className="flex items-center justify-center gap-6 mb-4">
              <div
                className="w-16 h-20 rounded-2xl flex items-center justify-center text-4xl font-black"
                style={{
                  background: showNote ? col : C.panel,
                  color: showNote ? C.bg : C.muted,
                  border: `1px solid ${C.border}`,
                }}
              >
                {showNote ? cn.h : "–"}
              </div>
              <div className="text-center">
                <div className="font-mono text-3xl font-bold">
                  {Math.min(reps + (playing ? 1 : 0), repeats)}
                  <span style={{ color: C.muted }}> / {repeats}</span>
                </div>
                <div
                  className="text-[11px] tracking-[0.2em] uppercase mt-1"
                  style={{ color: C.muted }}
                >
                  {cn ? (cn.rest ? "rest" : SUBLABEL[cn.sub]) : "repetitions"}
                </div>
              </div>
            </div>

            <div
              className="rounded-xl border p-4 mb-3"
              style={{ borderColor: C.border, background: C.panel }}
            >
              <div
                className="flex justify-between mb-2 text-xs uppercase tracking-wider"
                style={{ color: C.muted }}
              >
                <span>Tempo (♩ = quarter)</span>
                <span className="font-mono" style={{ color: C.text }}>
                  ♩ = {tempo}
                </span>
              </div>
              <input
                type="range"
                min={40}
                max={200}
                value={tempo}
                onChange={(e) => setTempo(+e.target.value)}
                className="w-full"
                style={{ accentColor: C.R }}
              />
              <div className="flex gap-2 mt-3">
                {LEVELS.map(([n, t]) => (
                  <button
                    key={n}
                    onClick={() => setTempo(t)}
                    className="flex-1 py-2 rounded-lg text-xs font-semibold transition"
                    style={{
                      background: tempo === t ? C.panel2 : C.bg,
                      border: `1px solid ${tempo === t ? C.R : C.border}`,
                      color: C.text,
                    }}
                  >
                    <span style={{ color: C.muted }}>{t}</span>
                  </button>
                ))}
              </div>
            </div>

            <div
              className="flex rounded-xl border overflow-hidden mb-4"
              style={{ borderColor: C.border }}
            >
              <button
                onClick={() => setSubClicks(false)}
                className="flex-1 py-2.5 text-sm font-semibold transition"
                style={{
                  background: !subClicks ? C.panel2 : C.panel,
                  color: !subClicks ? C.R : C.muted,
                }}
              >
                Click: 1 · 2 · 3 · 4
              </button>
              <button
                onClick={() => setSubClicks(true)}
                className="flex-1 py-2.5 text-sm font-semibold transition"
                style={{
                  background: subClicks ? C.panel2 : C.panel,
                  color: subClicks ? C.R : C.muted,
                }}
              >
                Click: every note
              </button>
            </div>

            <div
              className="rounded-xl border p-4"
              style={{ borderColor: C.border, background: C.panel }}
            >
              <div className="flex items-center justify-between mb-3">
                <span
                  className="text-xs uppercase tracking-[0.2em]"
                  style={{ color: C.muted }}
                >
                  This exercise
                </span>
                <button
                  onClick={() =>
                    setProgress((p) => ({
                      ...p,
                      [selId]: {
                        ...(p[selId] || BLANK),
                        done: !(p[selId] || BLANK).done,
                      },
                    }))
                  }
                  className="text-xs font-bold px-3 py-1.5 rounded-lg"
                  style={{
                    background: pr.done ? C.ok : C.bg,
                    color: pr.done ? C.bg : C.muted,
                    border: `1px solid ${pr.done ? C.ok : C.border}`,
                  }}
                >
                  {pr.done ? "✓ Done" : "Mark done"}
                </button>
              </div>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <div className="font-mono text-2xl font-bold">
                    {pr.bestTempo || "–"}
                  </div>
                  <div
                    className="text-[10px] uppercase tracking-wider"
                    style={{ color: C.muted }}
                  >
                    best ♩
                  </div>
                </div>
                <div>
                  <div className="font-mono text-2xl font-bold">
                    {pr.reps || 0}
                  </div>
                  <div
                    className="text-[10px] uppercase tracking-wider"
                    style={{ color: C.muted }}
                  >
                    reps
                  </div>
                </div>
                <div>
                  <div className="font-mono text-2xl font-bold">
                    {fmt(pr.sec)}
                  </div>
                  <div
                    className="text-[10px] uppercase tracking-wider"
                    style={{ color: C.muted }}
                  >
                    time
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
