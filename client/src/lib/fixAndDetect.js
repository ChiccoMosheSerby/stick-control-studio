const loadImg = (src) => new Promise((res, rej) => {
  const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src;
});

// Straighten -> crop -> center -> detect noteheads. Returns {img, fr, noteY}.
// Best-effort in the browser; move to a server (Python/OpenCV) for robustness.
export async function fixAndDetect(dataUrl) {
  const img = await loadImg(dataUrl);
  const scale = Math.min(1, 1000 / img.naturalWidth);
  const W = Math.round(img.naturalWidth * scale), H = Math.round(img.naturalHeight * scale);
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d", { willReadFrequently: true }); ctx.drawImage(img, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;
  const gray = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) gray[i] = px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11;

  // adaptive threshold via integral image (local mean)
  const integ = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += gray[y * W + x]; integ[(y + 1) * (W + 1) + (x + 1)] = integ[y * (W + 1) + (x + 1)] + row; } }
  const r = Math.max(8, Math.round(W / 40));
  const dark = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r), x1 = Math.min(W, x + r), y1 = Math.min(H, y + r);
    const s = integ[y1 * (W + 1) + x1] - integ[y0 * (W + 1) + x1] - integ[y1 * (W + 1) + x0] + integ[y0 * (W + 1) + x0];
    dark[y * W + x] = gray[y * W + x] < s / ((x1 - x0) * (y1 - y0)) - 8 ? 1 : 0;
  }

  // deskew via shear search (vertical shift per column)
  let bestS = 0, bestV = -1;
  for (let sl = -0.10; sl <= 0.1001; sl += 0.01) {
    const rs = new Float64Array(H);
    for (let x = 0; x < W; x += 2) { const sh = Math.round((x - W / 2) * sl); for (let y = 0; y < H; y++) { const yy = y + sh; if (yy >= 0 && yy < H && dark[yy * W + x]) rs[y]++; } }
    let m = 0; for (let y = 0; y < H; y++) m += rs[y]; m /= H; let v = 0; for (let y = 0; y < H; y++) { const d = rs[y] - m; v += d * d; }
    if (v > bestV) { bestV = v; bestS = sl; }
  }

  // straighten BOTH the dark map (detection) and grayscale (display)
  const d2 = new Uint8Array(W * H); const g2 = new Float32Array(W * H); g2.fill(255);
  for (let x = 0; x < W; x++) { const sh = Math.round((x - W / 2) * bestS); for (let y = 0; y < H; y++) { const yy = y + sh; if (yy >= 0 && yy < H) { if (dark[yy * W + x]) d2[y * W + x] = 1; g2[y * W + x] = gray[yy * W + x]; } } }

  // content bbox + staff rows
  const rowSum = new Int32Array(H), colSum = new Int32Array(W);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d2[y * W + x]) { rowSum[y]++; colSum[x]++; }
  let minx = W, maxx = 0, miny = H, maxy = 0;
  for (let y = 0; y < H; y++) if (rowSum[y] > 4) { if (y < miny) miny = y; if (y > maxy) maxy = y; }
  for (let x = 0; x < W; x++) if (colSum[x] > 3) { if (x < minx) minx = x; if (x > maxx) maxx = x; }
  minx = Math.max(0, minx - 6); maxx = Math.min(W - 1, maxx + 6); miny = Math.max(0, miny - 6); maxy = Math.min(H - 1, maxy + 6);
  const cw = maxx - minx + 1, chh = maxy - miny + 1;
  const isStaff = new Uint8Array(H); for (let y = 0; y < H; y++) if (rowSum[y] > 0.5 * W) isStaff[y] = 1;

  // staff vertical extent (beams above it, sticking letters below it)
  let staffTop = miny, staffBot = maxy, seen = false;
  for (let y = miny; y <= maxy; y++) if (isStaff[y]) { if (!seen) { staffTop = y; seen = true; } staffBot = y; }
  const staffH = Math.max(6, staffBot - staffTop);

  // notehead row = densest non-staff row WITHIN the staff (all noteheads share one pitch)
  let nhRow = Math.round((staffTop + staffBot) / 2), nhMax = -1;
  for (let y = staffTop; y <= staffBot; y++) { if (isStaff[y]) continue; let c = 0; for (let xx = minx; xx <= maxx; xx++) if (d2[y * W + xx]) c++; if (c > nhMax) { nhMax = c; nhRow = y; } }
  const rad = Math.max(4, Math.round(staffH * 0.45));
  const b0 = Math.max(miny, nhRow - rad), b1 = Math.min(maxy, nhRow + rad);

  // column density in the notehead band -> peak picking
  const colD = new Float64Array(cw);
  for (let xx = minx; xx <= maxx; xx++) { let c = 0; for (let y = b0; y <= b1; y++) if (d2[y * W + xx] && !isStaff[y]) c++; colD[xx - minx] = c; }
  const sm = new Float64Array(cw);
  for (let xx = 0; xx < cw; xx++) { let s = 0, n = 0; for (let k = -3; k <= 3; k++) { const z = xx + k; if (z >= 0 && z < cw) { s += colD[z]; n++; } } sm[xx] = s / n; }
  let mx = 0; for (let xx = 0; xx < cw; xx++) if (sm[xx] > mx) mx = sm[xx];
  const thr = mx * 0.38; const fr = []; let x = 0;
  while (x < cw) { if (sm[x] > thr) { let j = x; while (j < cw && sm[j] > thr) j++; const c = ((x + j) / 2) / cw; if (j - x > 2 && c > 0.10 && c < 0.97) fr.push(c); x = j + 2; } else x++; }

  // DISPLAY: grayscale, deskewed, cropped, centered, gentle brightness lift (no hard threshold)
  let lo = 255, hi = 0; for (let y = miny; y <= maxy; y++) for (let xx = minx; xx <= maxx; xx++) { const v = g2[y * W + xx]; if (v < lo) lo = v; if (v > hi) hi = v; }
  lo = lo + (hi - lo) * 0.06; const rng = Math.max(1, hi - lo);
  const out = document.createElement("canvas"); out.width = cw; out.height = chh;
  const octx = out.getContext("2d"); const oi = octx.createImageData(cw, chh);
  for (let y = 0; y < chh; y++) for (let xx = 0; xx < cw; xx++) { let v = (g2[(y + miny) * W + (xx + minx)] - lo) / rng * 255; v = v < 0 ? 0 : v > 255 ? 255 : v; const o = (y * cw + xx) * 4; oi.data[o] = oi.data[o + 1] = oi.data[o + 2] = v; oi.data[o + 3] = 255; }
  octx.putImageData(oi, 0, 0);
  return { img: out.toDataURL("image/png"), fr, noteY: (nhRow - miny) / chh };
}

// Placeholder. Wire this to a server route that calls a vision model or OCR.
// Never expose an API key in the browser. Returns "" -> player falls back to alternating R/L.
export async function readSticking(/* b64, media */) {
  return "";
}
