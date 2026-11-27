/**
 * Pre-model Ink CV & Bidirectional Origin-Anchored Verification (Redraw v2).
 * Measures sketch geometry (axes, origin, quadrants, aspect ratio, strokes) BEFORE
 * prompting the vision model, and runs bidirectional Chamfer verification afterward.
 */
import type { InkMap } from '../../layout.ts';
import type { Pt } from '../sample.ts';

export interface SketchProfile {
  hasInk: boolean;
  /** Width / height of ink bounding box, clamped to [1.05, 2.4] for plot aspect. */
  aspect: number;
  frame: 'axes-2d' | 'line-1d' | 'diagram' | 'freeform';
  /** Detected normalized axis lines inside the crop, if present. */
  hAxisNorm: number | null;
  vAxisNorm: number | null;
  originDesc: string;
  /** Fraction of ink in each quadrant around detected axes [Q1(UR), Q2(UL), Q3(LL), Q4(LR)]. */
  quadInk: [number, number, number, number];
  /** Distinct major curve-like regions in the ink. */
  strokeGroups: number;
}

export interface InkVerifyResult {
  confidence: 'high' | 'medium' | 'low';
  score: number;
  forwardCoverage: number;
  reverseCoverage: number;
  diagnostic: string | null;
}

/** 2-pass Chamfer distance field over a binary mask. */
function chamferField(mask: Uint8Array, w: number, h: number): Float32Array {
  const inf = w + h + 1;
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = mask[i] ? 0 : inf;
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

function inkBounds(map: InkMap) {
  const { w, h, ink } = map;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  let count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!ink[y * w + x]) continue;
      count++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return { x0, y0, x1, y1, count, bw: x1 - x0 + 1, bh: y1 - y0 + 1 };
}

export function analyzeSketch(map: InkMap): SketchProfile {
  const { w, h, ink } = map;
  const b = inkBounds(map);
  if (b.count < 25 || b.bw < 12 || b.bh < 10) {
    return {
      hasInk: false,
      aspect: 1.45,
      frame: 'freeform',
      hAxisNorm: null,
      vAxisNorm: null,
      originDesc: 'minimal ink',
      quadInk: [0.25, 0.25, 0.25, 0.25],
      strokeGroups: 0,
    };
  }

  const aspect = Math.max(1.05, Math.min(2.4, b.bw / Math.max(1, b.bh)));

  // Find strongest horizontal line spanning >= 42% of ink width (checking 3px band for slight tilt).
  let bestRow = -1;
  let bestRowHits = 0;
  for (let y = b.y0; y <= b.y1; y++) {
    let cols = 0;
    for (let x = b.x0; x <= b.x1; x++) {
      if (ink[y * w + x] || (y > 0 && ink[(y - 1) * w + x]) || (y + 1 < h && ink[(y + 1) * w + x])) cols++;
    }
    if (cols > bestRowHits) {
      bestRowHits = cols;
      bestRow = y;
    }
  }
  const hasH = bestRowHits >= b.bw * 0.44;

  // Find strongest vertical line spanning >= 42% of ink height.
  let bestCol = -1;
  let bestColHits = 0;
  for (let x = b.x0; x <= b.x1; x++) {
    let rows = 0;
    for (let y = b.y0; y <= b.y1; y++) {
      if (ink[y * w + x] || (x > 0 && ink[y * w + x - 1]) || (x + 1 < w && ink[y * w + x + 1])) rows++;
    }
    if (rows > bestColHits) {
      bestColHits = rows;
      bestCol = x;
    }
  }
  const hasV = bestColHits >= b.bh * 0.44;

  const frame: SketchProfile['frame'] =
    hasH && hasV ? 'axes-2d' : hasH && b.bh <= b.bw * 0.35 ? 'line-1d' : hasH || hasV ? 'freeform' : 'diagram';

  const ox = hasV ? bestCol : Math.round((b.x0 + b.x1) / 2);
  const oy = hasH ? bestRow : Math.round((b.y0 + b.y1) / 2);
  let q1 = 0;
  let q2 = 0;
  let q3 = 0;
  let q4 = 0;
  for (let y = b.y0; y <= b.y1; y++) {
    if (hasH && Math.abs(y - bestRow) <= 2) continue;
    for (let x = b.x0; x <= b.x1; x++) {
      if (hasV && Math.abs(x - bestCol) <= 2) continue;
      if (!ink[y * w + x]) continue;
      if (x >= ox && y <= oy) q1++;
      else if (x < ox && y <= oy) q2++;
      else if (x < ox && y > oy) q3++;
      else q4++;
    }
  }
  const qt = Math.max(1, q1 + q2 + q3 + q4);
  const quadInk: [number, number, number, number] = [q1 / qt, q2 / qt, q3 / qt, q4 / qt];

  // Describe axis placement for VLM grounding.
  const hPos = hasH ? (oy - b.y0) / Math.max(1, b.bh) : 0.5;
  const vPos = hasV ? (ox - b.x0) / Math.max(1, b.bw) : 0.5;
  const originDesc =
    frame === 'axes-2d'
      ? vPos < 0.28 && hPos > 0.65
        ? 'axes cross at bottom-left (mostly first quadrant x >= 0, y >= 0)'
        : vPos < 0.28
          ? 'vertical axis near left (x >= 0, horizontal axis in middle)'
          : 'axes cross near center (four-quadrant window)'
      : frame === 'line-1d'
        ? 'horizontal 1D number line (no vertical axis)'
        : 'no coordinate axes detected (likely a block diagram, mechanical schematic, or freehand figure)';

  // Coarse stroke-group estimate along vertical slices outside axes.
  let strokeGroups = 0;
  if (frame === 'axes-2d') {
    const counts: number[] = [];
    for (let s = 1; s <= 4; s++) {
      const sx = Math.round(b.x0 + (b.bw * s) / 5);
      if (hasV && Math.abs(sx - bestCol) <= 3) continue;
      let segs = 0;
      let inInk = false;
      for (let y = b.y0; y <= b.y1; y++) {
        if (hasH && Math.abs(y - bestRow) <= 3) {
          inInk = false;
          continue;
        }
        const hit = ink[y * w + sx] || (sx + 1 < w && ink[y * w + sx + 1]);
        if (hit && !inInk) segs++;
        inInk = !!hit;
      }
      counts.push(segs);
    }
    counts.sort((p, q) => p - q);
    strokeGroups = counts[Math.floor(counts.length / 2)] ?? 0;
  }

  return {
    hasInk: true,
    aspect,
    frame,
    hAxisNorm: hasH ? bestRow / h : null,
    vAxisNorm: hasV ? bestCol / w : null,
    originDesc,
    quadInk,
    strokeGroups,
  };
}

export function formatSketchHint(p: SketchProfile): string {
  if (!p.hasInk) return '';
  const bits = [`Detected layout: ${p.originDesc}.`];
  if (p.frame === 'axes-2d') {
    const negY = p.quadInk[2] + p.quadInk[3];
    if (negY > 0.15) bits.push('Curve ink appears both above and below the horizontal axis.');
    if (p.strokeGroups >= 2) bits.push(`Vertical slices suggest roughly ${p.strokeGroups} stacked curves or levels.`);
  }
  return bits.join(' ');
}

function samplePts(polylines: Pt[][], xw: [number, number], yw: [number, number], max = 140): Pt[] {
  const pts: Pt[] = [];
  for (const poly of polylines) {
    for (const [x, y] of poly) {
      if (Number.isFinite(x) && Number.isFinite(y) && x >= xw[0] && x <= xw[1] && y >= yw[0] && y <= yw[1]) pts.push([x, y]);
    }
  }
  if (pts.length <= max) return pts;
  const step = (pts.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, k) => pts[Math.round(k * step)]);
}

/**
 * Bidirectional origin-anchored Chamfer check comparing evaluated scene polylines
 * against the sketch ink mask (with axis lines masked out).
 */
export function verifySceneAgainstInk(
  map: InkMap,
  profile: SketchProfile,
  polylines: Pt[][],
  xWin: [number, number],
  yWin: [number, number],
  opts?: { skip?: boolean; schematic?: boolean },
): InkVerifyResult {
  if (opts?.skip || opts?.schematic || !profile.hasInk || profile.frame !== 'axes-2d') {
    return { confidence: 'high', score: 1, forwardCoverage: 1, reverseCoverage: 1, diagnostic: null };
  }
  const b = inkBounds(map);
  if (b.count < 30 || b.bw < 15 || b.bh < 15) {
    return { confidence: 'high', score: 1, forwardCoverage: 1, reverseCoverage: 1, diagnostic: null };
  }
  const pts = samplePts(polylines, xWin, yWin, 140);
  if (pts.length < 8) {
    return { confidence: 'high', score: 1, forwardCoverage: 1, reverseCoverage: 1, diagnostic: null };
  }

  const { w, h, ink } = map;
  const axY = profile.hAxisNorm !== null ? Math.round(profile.hAxisNorm * h) : -99;
  const axX = profile.vAxisNorm !== null ? Math.round(profile.vAxisNorm * w) : -99;

  // Mask out the axis lines themselves so axes never give false match credit.
  const curveInk = new Uint8Array(w * h);
  let curveInkCount = 0;
  for (let y = 0; y < h; y++) {
    if (Math.abs(y - axY) <= 3) continue;
    for (let x = 0; x < w; x++) {
      if (Math.abs(x - axX) <= 3) continue;
      if (ink[y * w + x]) {
        curveInk[y * w + x] = 1;
        curveInkCount++;
      }
    }
  }
  if (curveInkCount < 15) return { confidence: 'high', score: 1, forwardCoverage: 1, reverseCoverage: 1, diagnostic: null };

  const xSpan = xWin[1] - xWin[0];
  const ySpan = yWin[1] - yWin[0];
  const offAxis = pts.filter(([x, y]) => {
    const nearY = yWin[0] <= 0 && yWin[1] >= 0 ? Math.abs(y) / ySpan < 0.04 : false;
    const nearX = xWin[0] <= 0 && xWin[1] >= 0 ? Math.abs(x) / xSpan < 0.04 : false;
    return !nearX && !nearY;
  });
  const evalPts = offAxis.length >= 12 ? offAxis : pts;

  const inkDist = chamferField(curveInk, w, h);
  const tol = Math.max(4, 0.12 * Math.max(b.bw, b.bh));

  // Try origin-anchored piecewise mapping when 0 lies inside xWin and yWin, plus trimmed box mapping.
  const mapCandidates: ((mx: number, my: number) => [number, number])[] = [];
  if (profile.vAxisNorm !== null && profile.hAxisNorm !== null && xWin[0] <= 0 && xWin[1] >= 0 && yWin[0] <= 0 && yWin[1] >= 0) {
    const ox = profile.vAxisNorm * w;
    const oy = profile.hAxisNorm * h;
    for (const pad of [0, 0.08]) {
      const px0 = b.x0 + pad * b.bw;
      const px1 = b.x1 - pad * 0.5 * b.bw;
      const py0 = b.y0 + pad * 0.5 * b.bh;
      const py1 = b.y1 - pad * b.bh;
      mapCandidates.push((mx, my) => {
        const sx =
          mx >= 0 && xWin[1] > 0
            ? ox + (mx / xWin[1]) * Math.max(6, px1 - ox)
            : xWin[0] < 0
              ? ox - (mx / xWin[0]) * Math.max(6, ox - px0)
              : ox;
        const sy =
          my >= 0 && yWin[1] > 0
            ? oy - (my / yWin[1]) * Math.max(6, oy - py0)
            : yWin[0] < 0
              ? oy + (my / yWin[0]) * Math.max(6, py1 - oy)
              : oy;
        return [Math.min(w - 1, Math.max(0, Math.round(sx))), Math.min(h - 1, Math.max(0, Math.round(sy)))];
      });
    }
  }
  for (const tl of [0, 0.1, 0.18]) {
    for (const tb of [0, 0.1, 0.18]) {
      const px0 = b.x0 + tl * b.bw;
      const px1 = b.x1 - tl * 0.4 * b.bw;
      const py0 = b.y0 + tb * 0.4 * b.bh;
      const py1 = b.y1 - tb * b.bh;
      if (px1 - px0 < 10 || py1 - py0 < 10) continue;
      mapCandidates.push((mx, my) => [
        Math.min(w - 1, Math.max(0, Math.round(px0 + ((mx - xWin[0]) / xSpan) * (px1 - px0)))),
        Math.min(h - 1, Math.max(0, Math.round(py0 + ((yWin[1] - my) / ySpan) * (py1 - py0)))),
      ]);
    }
  }

  let bestScore = -1;
  let bestFwd = 0;
  let bestRev = 0;

  for (const toPx of mapCandidates) {
    let fwdHits = 0;
    const redrawnMask = new Uint8Array(w * h);
    for (const poly of polylines) {
      let prev: [number, number] | null = null;
      for (const [mx, my] of poly) {
        if (!Number.isFinite(mx) || !Number.isFinite(my) || mx < xWin[0] || mx > xWin[1] || my < yWin[0] || my > yWin[1]) {
          prev = null;
          continue;
        }
        const cur = toPx(mx, my);
        redrawnMask[cur[1] * w + cur[0]] = 1;
        if (prev) {
          const steps = Math.max(1, Math.min(40, Math.ceil(Math.hypot(cur[0] - prev[0], cur[1] - prev[1]))));
          for (let k = 1; k < steps; k++) {
            const ix = Math.round(prev[0] + ((cur[0] - prev[0]) * k) / steps);
            const iy = Math.round(prev[1] + ((cur[1] - prev[1]) * k) / steps);
            redrawnMask[iy * w + ix] = 1;
          }
        }
        prev = cur;
      }
    }
    for (const [mx, my] of evalPts) {
      const [sx, sy] = toPx(mx, my);
      if (inkDist[sy * w + sx] <= tol) fwdHits++;
    }
    const fwd = fwdHits / evalPts.length;
    const curveDist = chamferField(redrawnMask, w, h);
    let revHits = 0;
    for (let i = 0; i < w * h; i++) {
      if (curveInk[i] && curveDist[i] <= tol * 1.35) revHits++;
    }
    const rev = revHits / curveInkCount;
    const combined = 0.6 * fwd + 0.4 * rev;
    if (combined > bestScore) {
      bestScore = combined;
      bestFwd = fwd;
      bestRev = rev;
    }
  }

  const confidence: InkVerifyResult['confidence'] =
    bestScore >= 0.62 && bestFwd >= 0.52 && bestRev >= 0.35
      ? 'high'
      : bestScore >= 0.38
        ? 'medium'
        : 'low';

  let diagnostic: string | null = null;
  if (confidence !== 'high') {
    if (bestFwd < 0.45 && profile.quadInk[2] + profile.quadInk[3] > 0.2 && evalPts.every(([, y]) => y >= -1e-6)) {
      diagnostic = 'The hand-drawn sketch extends below the horizontal axis, whereas your curve stays >= 0. Check signs or negative pieces.';
    } else if (bestFwd >= 0.6 && bestRev < 0.38) {
      diagnostic = 'Your curve matches part of the sketch, but significant extra curve ink in the sketch is unexplained (a second curve, envelope, or comparison line may be missing).';
    } else {
      diagnostic = `Redrawn curve geometry poorly matches the sketch (${Math.round(bestFwd * 100)}% curve-to-ink, ${Math.round(bestRev * 100)}% ink-to-curve). Re-check equation, window, and quadrant.`;
    }
  }

  return { confidence, score: bestScore, forwardCoverage: bestFwd, reverseCoverage: bestRev, diagnostic };
}
