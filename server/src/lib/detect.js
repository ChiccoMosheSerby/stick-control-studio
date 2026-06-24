import { PNG } from "pngjs";

// Deterministic notehead detection on an ALREADY-CLEANED (deskewed/cropped/centered) image.
// Same algorithm as the browser CV (adaptive threshold -> staff/beams -> morphological opening
// -> connected components), but run server-side so positions never vary between imports.
// Returns { notes: [x in 0..1, left->right], noteY: 0..1 } or { notes: null, noteY: null }.
export function detectNoteheads(buffer) {
  let png; try { png = PNG.sync.read(buffer); } catch (e) { return { notes: null, noteY: null }; }
  const W = png.width, H = png.height, px = png.data;   // RGBA
  if (!W || !H) return { notes: null, noteY: null };

  const gray = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) gray[i] = px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11;

  // adaptive threshold via integral image (local mean, offset -8)
  const integ = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += gray[y * W + x]; integ[(y + 1) * (W + 1) + (x + 1)] = integ[y * (W + 1) + (x + 1)] + row; } }
  const r = Math.max(8, Math.round(W / 40));
  const dark = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r), x1 = Math.min(W, x + r), y1 = Math.min(H, y + r);
    const s = integ[y1 * (W + 1) + x1] - integ[y0 * (W + 1) + x1] - integ[y1 * (W + 1) + x0] + integ[y0 * (W + 1) + x0];
    dark[y * W + x] = gray[y * W + x] < s / ((x1 - x0) * (y1 - y0)) - 8 ? 1 : 0;
  }

  // staff lines
  const rowSum = new Int32Array(H);
  for (let y = 0; y < H; y++) { let c = 0; for (let x = 0; x < W; x++) if (dark[y * W + x]) c++; rowSum[y] = c; }
  const isStaff = new Uint8Array(H);
  for (let y = 0; y < H; y++) if (rowSum[y] > 0.5 * W) isStaff[y] = 1;
  let staffTop = -1, staffBot = -1;
  for (let y = 0; y < H; y++) if (isStaff[y]) { if (staffTop < 0) staffTop = y; staffBot = y; }
  if (staffTop < 0) return { notes: null, noteY: null };
  const staffH = staffBot - staffTop;

  // beams above the staff -> first beam start (note region begins here; clef/timesig sit to the left)
  const beamMask = new Uint8Array(W);
  let brmax = 0; const brow = new Int32Array(Math.max(1, staffTop));
  for (let y = 0; y < staffTop; y++) { let c = 0; for (let x = 0; x < W; x++) if (dark[y * W + x]) c++; brow[y] = c; if (c > brmax) brmax = c; }
  for (let y = 0; y < staffTop; y++) if (brow[y] >= brmax * 0.5) for (let x = 0; x < W; x++) if (dark[y * W + x]) beamMask[x] = 1;
  const segs = []; const gapTol = Math.max(2, Math.round(W * 0.012)), minSeg = Math.max(6, Math.round(W * 0.04));
  let xi = 0;
  while (xi < W) {
    if (beamMask[xi]) { let j = xi, last = xi; while (j < W && (beamMask[j] || j - last <= gapTol)) { if (beamMask[j]) last = j; j++; } if (last - xi + 1 >= minSeg) segs.push([xi, last]); xi = last + 1; }
    else xi++;
  }

  // staff-line spacing -> notehead size + erosion radius
  const lineStarts = [];
  { let inrun = false; for (let y = staffTop; y <= staffBot; y++) { if (isStaff[y] && !inrun) { lineStarts.push(y); inrun = true; } else if (!isStaff[y]) inrun = false; } }
  let sp = 8;
  if (lineStarts.length >= 2) { const dd = []; for (let i = 1; i < lineStarts.length; i++) dd.push(lineStarts[i] - lineStarts[i - 1]); dd.sort((a, b) => a - b); sp = dd[dd.length >> 1]; }
  const nh = Math.max(3, Math.round(sp * 0.9)), er = Math.max(1, nh >> 2);
  let xStart = (segs.length ? segs[0][0] : 0) - nh; if (xStart < 0) xStart = 0;

  // work mask: dark inside the staff band, right of xStart, with staff-line rows removed
  const work = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    if (y < staffTop - 2 || y > staffBot + 2) continue;
    if (isStaff[y]) continue;
    for (let x = xStart; x < W; x++) if (dark[y * W + x]) work[y * W + x] = 1;
  }
  // morphological opening with a (2er+1) square: erode (separable min) then dilate (separable max)
  const morph = (src, useMin) => {
    const tmp = new Uint8Array(W * H), out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let v = useMin ? 1 : 0; for (let k = -er; k <= er; k++) { const xx = x + k; const sv = (xx >= 0 && xx < W) ? src[y * W + xx] : 0; v = useMin ? (v && sv) : (v || sv); } tmp[y * W + x] = v ? 1 : 0; }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let v = useMin ? 1 : 0; for (let k = -er; k <= er; k++) { const yy = y + k; const sv = (yy >= 0 && yy < H) ? tmp[yy * W + x] : 0; v = useMin ? (v && sv) : (v || sv); } out[y * W + x] = v ? 1 : 0; }
    return out;
  };
  const opened = morph(morph(work, true), false);

  // connected components (4-connectivity) via stack flood fill
  const lab = new Uint8Array(W * H), comps = [], stack = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p0 = y * W + x; if (!opened[p0] || lab[p0]) continue;
    let sumX = 0, sumY = 0, cnt = 0, x0 = x, x1 = x; lab[p0] = 1; stack.length = 0; stack.push(p0);
    while (stack.length) {
      const p = stack.pop(), px2 = p % W, py2 = (p - px2) / W;
      sumX += px2; sumY += py2; cnt++; if (px2 < x0) x0 = px2; if (px2 > x1) x1 = px2;
      if (px2 > 0 && opened[p - 1] && !lab[p - 1]) { lab[p - 1] = 1; stack.push(p - 1); }
      if (px2 < W - 1 && opened[p + 1] && !lab[p + 1]) { lab[p + 1] = 1; stack.push(p + 1); }
      if (py2 > 0 && opened[p - W] && !lab[p - W]) { lab[p - W] = 1; stack.push(p - W); }
      if (py2 < H - 1 && opened[p + W] && !lab[p + W]) { lab[p + W] = 1; stack.push(p + W); }
    }
    if (cnt >= nh * nh * 0.3 && (x1 - x0 + 1) <= sp * 2.5) comps.push({ x: sumX / cnt, y: sumY / cnt, a: cnt });
  }
  if (!comps.length) return { notes: null, noteY: null };
  // drop small blobs (repeat-sign dots / specks) via median area, then sort left-to-right
  const areas = comps.map((c) => c.a).sort((a, b) => a - b), medA = areas[areas.length >> 1];
  const keep = comps.filter((c) => c.a >= 0.5 * medA).sort((a, b) => a.x - b.x);
  if (!keep.length) return { notes: null, noteY: null };
  const yc = keep.map((c) => c.y).sort((a, b) => a - b);
  return { notes: keep.map((c) => c.x / W), noteY: yc[yc.length >> 1] / H };
}
