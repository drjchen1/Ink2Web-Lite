/**
 * Ink-vs-redraw sanity check: compares a redrawn mathematical figure against the
 * original hand-drawn InkMap to flag mismatches (inverted sign, wrong curve,
 * misread equation) so the app can keep the sketch visible alongside the redraw.
 */
import type { InkMap } from '../layout.ts';
import type { RedrawResult } from './index.ts';
import type { Pt } from './sample.ts';

export interface InkCheckResult {
  matches: boolean;
  score: number;
}

/** 2-pass Chamfer distance transform in pixels (0 at ink pixels). */
function distanceField(map: InkMap): Float32Array {
  const { w, h, ink } = map;
  const inf = w + h + 1;
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = ink[i] ? 0 : inf;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 1);
      if (y > 0) {
        v = Math.min(v, d[i - w] + 1);
        if (x > 0) v = Math.min(v, d[i - w - 1] + 1.414);
        if (x + 1 < w) v = Math.min(v, d[i - w + 1] + 1.414);
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i];
      if (x + 1 < w) v = Math.min(v, d[i + 1] + 1);
      if (y + 1 < h) {
        v = Math.min(v, d[i + w] + 1);
        if (x > 0) v = Math.min(v, d[i + w - 1] + 1.414);
        if (x + 1 < w) v = Math.min(v, d[i + w + 1] + 1.414);
      }
      d[i] = v;
    }
  }
  return d;
}

function samplePolylines(segs: Pt[][], xw: [number, number], yw: [number, number], maxPts = 100): Pt[] {
  const inWin: Pt[] = [];
  for (const seg of segs) {
    for (const [x, y] of seg) {
      if (Number.isFinite(x) && Number.isFinite(y) && x >= xw[0] && x <= xw[1] && y >= yw[0] && y <= yw[1]) {
        inWin.push([x, y]);
      }
    }
  }
  if (inWin.length <= maxPts) return inWin;
  const out: Pt[] = [];
  for (let k = 0; k < maxPts; k++) out.push(inWin[Math.floor((k * (inWin.length - 1)) / (maxPts - 1))]);
  return out;
}

export function checkRedrawInk(inkMap: InkMap, result: Extract<RedrawResult, { ok: true }>): InkCheckResult {
  const f = result.facts;
  if (f.kind === 'line') return { matches: true, score: 1 };
  if (f.kind === 'graph' && f.spec.schematic) return { matches: true, score: 1 };
  if (f.kind === 'phase' && !f.trajectories.length) return { matches: true, score: 1 };
  if (f.kind === 'slope' && !f.solutions.length) return { matches: true, score: 1 };
  if (f.kind === 'scene' && (f.evaluated.kind === 'diagram' || f.evaluated.spec.schematic || !f.evaluated.polylines.length)) {
    return { matches: true, score: 1 };
  }

  const xWindow: [number, number] =
    f.kind === 'scene'
      ? f.evaluated.kind === 'plot'
        ? f.evaluated.xWindow
        : [0, 1]
      : f.kind === 'graph'
        ? f.spec.window.x
        : f.xWindow;
  const yWindow: [number, number] =
    f.kind === 'scene' ? (f.evaluated.kind === 'plot' ? f.evaluated.yWindow : [0, 1]) : f.yWindow;

  let rawSegs: Pt[][] = [];
  if (f.kind === 'scene') rawSegs = f.evaluated.kind === 'plot' ? f.evaluated.polylines : [];
  else if (f.kind === 'graph') rawSegs = f.curves.flatMap((c) => c.segments);
  else if (f.kind === 'region') rawSegs = f.boundaries.flatMap((b) => b.segments);
  else if (f.kind === 'phase') rawSegs = f.trajectories.map((t) => t.path);
  else if (f.kind === 'slope') rawSegs = f.solutions.map((s) => s.path);

  const pts = samplePolylines(rawSegs, xWindow, yWindow, 100);
  if (pts.length < 8) return { matches: true, score: 1 };

  // Bounding box of ink inside the cropped figure.
  const { w, h, ink } = inkMap;
  let ix0 = w;
  let iy0 = h;
  let ix1 = -1;
  let iy1 = -1;
  let inkCount = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!ink[y * w + x]) continue;
      inkCount++;
      if (x < ix0) ix0 = x;
      if (x > ix1) ix1 = x;
      if (y < iy0) iy0 = y;
      if (y > iy1) iy1 = y;
    }
  }
  if (inkCount < 30 || ix1 - ix0 < 12 || iy1 - iy0 < 12) return { matches: true, score: 1 };

  // Prefer evaluating non-axis curve points when enough exist, so axes alone can't mask a flipped curve.
  const xSpan = xWindow[1] - xWindow[0];
  const ySpan = yWindow[1] - yWindow[0];
  const xAxisY = yWindow[0] <= 0 && 0 <= yWindow[1] ? 0 : yWindow[0];
  const yAxisX = xWindow[0] <= 0 && 0 <= xWindow[1] ? 0 : xWindow[0];
  const offAxis = pts.filter(([x, y]) => Math.abs(x - yAxisX) / xSpan > 0.05 && Math.abs(y - xAxisY) / ySpan > 0.05);
  const evalPts = offAxis.length >= 12 ? offAxis : pts;

  const dist = distanceField(inkMap);
  const bw = ix1 - ix0;
  const bh = iy1 - iy0;
  const tol = Math.max(3.5, 0.11 * Math.max(bw, bh));

  let bestScore = 0;
  const trims = [0, 0.1, 0.18];
  for (const tl of trims) {
    for (const tb of trims) {
      const px0 = ix0 + tl * bw;
      const px1 = ix1 - tl * 0.4 * bw;
      const py0 = iy0 + tb * 0.4 * bh;
      const py1 = iy1 - tb * bh;
      if (px1 - px0 < 10 || py1 - py0 < 10) continue;
      let hit = 0;
      for (const [mx, my] of evalPts) {
        const sx = Math.min(w - 1, Math.max(0, Math.round(px0 + ((mx - xWindow[0]) / xSpan) * (px1 - px0))));
        const sy = Math.min(h - 1, Math.max(0, Math.round(py0 + ((yWindow[1] - my) / ySpan) * (py1 - py0))));
        if (dist[sy * w + sx] <= tol) hit++;
      }
      bestScore = Math.max(bestScore, hit / evalPts.length);
    }
  }
  return { matches: bestScore >= 0.45, score: bestScore };
}
