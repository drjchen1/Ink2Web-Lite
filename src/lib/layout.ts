import type { Box, FigureAlign } from '../types.ts';

/**
 * Page-layout analysis from ink alone (no model, no DOM): finds hand-drawn figures
 * and text lines, and derives sensible defaults for where figures go in the HTML.
 *
 * Why: small vision models often forget to mark a drawing in the transcription,
 * and their bounding boxes are unreliable. Drawings, however, are easy to spot in
 * the ink. Everything is measured relative to the size of the handwriting itself
 * (the median ink blob), so it works for portrait and landscape pages, large and
 * small writing.
 */

export interface InkMap {
  w: number;
  h: number;
  /** 1 = ink pixel. Ruled lines and margin lines are removed. */
  ink: Uint8Array;
}

/** Builds an ink mask from RGBA pixels (any size; ~800 px long side is plenty). */
export function buildInkMap(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): InkMap {
  const n = w * h;
  const lum = new Uint8Array(n);
  const hist = new Uint32Array(256);
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    lum[j] = (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000;
    hist[lum[j]]++;
  }
  // Paper is the majority of the page, so the median is the paper tone.
  let acc = 0;
  let paper = 255;
  for (let v = 0; v < 256; v++) if ((acc += hist[v]) >= n / 2) { paper = v; break; }
  // 0.62 keeps pen and pencil but drops faint blue rules and the red margin line.
  const thr = paper * 0.62;
  const ink = new Uint8Array(n);
  for (let j = 0; j < n; j++) ink[j] = lum[j] < thr ? 1 : 0;

  // Remove any remaining full-length rules (margin lines, dark ruled paper, scan edges).
  for (let x = 0; x < w; x++) {
    let c = 0;
    for (let y = 0; y < h; y++) c += ink[y * w + x];
    if (c > h * 0.35) for (let y = 0; y < h; y++) ink[y * w + x] = 0;
  }
  for (let y = 0; y < h; y++) {
    let c = 0;
    for (let x = 0; x < w; x++) c += ink[y * w + x];
    if (c > w * 0.5) ink.fill(0, y * w, y * w + w);
  }
  return { w, h, ink };
}

export interface TextLine {
  /** Normalized vertical center and horizontal extent. */
  y: number;
  x0: number;
  x1: number;
}

export interface Layout {
  /** Drawings, in reading order (top to bottom, then left to right). Normalized. */
  figures: Box[];
  /** Handwritten text lines outside the figures, top to bottom. */
  lines: TextLine[];
}

interface Comp {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const cw = (c: Comp) => c.x1 - c.x0 + 1;
const ch = (c: Comp) => c.y1 - c.y0 + 1;

/** Detects figures and text lines on a coarse cell grid (a page takes a few ms). */
export function analyzeLayout(map: InkMap): Layout {
  const { w, h, ink } = map;
  const cell = Math.max(2, Math.round(Math.max(w, h) / 250));
  const gw = Math.ceil(w / cell);
  const gh = Math.ceil(h / cell);

  // 1. Coarse occupancy grid (a cell is ink if it holds a couple of ink pixels).
  const grid = new Uint8Array(gw * gh);
  for (let y = 0; y < h; y++) {
    const gy = (y / cell) | 0;
    for (let x = 0; x < w; x++) if (ink[y * w + x]) grid[gy * gw + ((x / cell) | 0)]++;
  }
  const occ = new Uint8Array(gw * gh);
  for (let i = 0; i < occ.length; i++) occ[i] = grid[i] >= 2 ? 1 : 0;

  // 2. Dilate sideways by one cell so letters join into words and broken strokes reconnect.
  //    (Not vertically: that would chain a label to the line of writing just above it.)
  const dil = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      if (!occ[y * gw + x]) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        if (xx >= 0 && xx < gw) dil[y * gw + xx] = 1;
      }
    }

  // 3. Connected components (iterative flood fill).
  const label = new Int32Array(gw * gh).fill(-1);
  const comps: Comp[] = [];
  const stack: number[] = [];
  for (let s = 0; s < dil.length; s++) {
    if (!dil[s] || label[s] >= 0) continue;
    const c: Comp = { x0: gw, y0: gh, x1: 0, y1: 0 };
    label[s] = comps.length;
    stack.push(s);
    while (stack.length) {
      const p = stack.pop()!;
      const px = p % gw;
      const py = (p / gw) | 0;
      if (px < c.x0) c.x0 = px;
      if (px > c.x1) c.x1 = px;
      if (py < c.y0) c.y0 = py;
      if (py > c.y1) c.y1 = py;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = px + dx;
          const yy = py + dy;
          if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue;
          const q = yy * gw + xx;
          if (dil[q] && label[q] < 0) {
            label[q] = comps.length;
            stack.push(q);
          }
        }
    }
    comps.push(c);
  }
  if (!comps.length) return { figures: [], lines: [] };

  // The size of ordinary handwriting: the median blob height.
  const heights = comps.map(ch).sort((a, b) => a - b);
  const unit = Math.max(2, heights[heights.length >> 1]);

  // 4. Group blobs into rows ("words on one line"). A row is what makes an integral
  //    sign with limits different from a narrow drawing of the same size: the integral
  //    has the rest of its equation right next to it; a drawing has at most labels.
  const parent = comps.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const rowGap = Math.max(3, unit * 1.6);
  for (let i = 0; i < comps.length; i++)
    for (let j = i + 1; j < comps.length; j++) {
      const a = comps[i];
      const b = comps[j];
      const vOverlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) + 1;
      const hGap = Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1);
      if (vOverlap >= Math.min(ch(a), ch(b)) * 0.5 && hGap <= rowGap) parent[find(i)] = find(j);
    }
  const groups = new Map<number, { x0: number; x1: number; n: number }>();
  comps.forEach((c, i) => {
    const g = groups.get(find(i)) ?? { x0: gw, x1: 0, n: 0 };
    g.x0 = Math.min(g.x0, c.x0);
    g.x1 = Math.max(g.x1, c.x1);
    g.n++;
    groups.set(find(i), g);
  });
  const groupWidth = (i: number) => {
    const g = groups.get(find(i))!;
    return g.x1 - g.x0 + 1;
  };

  // 5. Figure candidates.
  //    Big drawings: at least ~5 handwriting heights tall (taller than any equation line).
  //    Narrow drawings (a spring, a vertical arrow diagram): at least ~3 heights tall,
  //    taller than wide, and not sitting inside a row of writing.
  //    Hollow hand-drawn rectangles around equations (high border coverage, empty core) are skipped.
  const isBoxFrame = (c: Comp, idx: number): boolean => {
    if (cw(c) < ch(c) * 1.6 || cw(c) < unit * 6) return false;
    const bx = Math.max(2, Math.round(cw(c) * 0.08));
    const by = Math.max(2, Math.round(ch(c) * 0.15));
    const ix0 = c.x0 + 2 * bx;
    const ix1 = c.x1 - 2 * bx;
    const iy0 = c.y0 + 2 * by;
    const iy1 = c.y1 - 2 * by;
    if (ix1 <= ix0 || iy1 <= iy0) return false;
    let topCols = 0;
    let botCols = 0;
    for (let x = c.x0; x <= c.x1; x++) {
      let hasTop = false;
      for (let y = c.y0; y <= Math.min(c.y1, c.y0 + by); y++) if (label[y * gw + x] === idx) { hasTop = true; break; }
      if (hasTop) topCols++;
      let hasBot = false;
      for (let y = Math.max(c.y0, c.y1 - by); y <= c.y1; y++) if (label[y * gw + x] === idx) { hasBot = true; break; }
      if (hasBot) botCols++;
    }
    let leftRows = 0;
    let rightRows = 0;
    for (let y = c.y0; y <= c.y1; y++) {
      let hasL = false;
      for (let x = c.x0; x <= Math.min(c.x1, c.x0 + bx); x++) if (label[y * gw + x] === idx) { hasL = true; break; }
      if (hasL) leftRows++;
      let hasR = false;
      for (let x = Math.max(c.x0, c.x1 - bx); x <= c.x1; x++) if (label[y * gw + x] === idx) { hasR = true; break; }
      if (hasR) rightRows++;
    }
    if (topCols / cw(c) < 0.65 || botCols / cw(c) < 0.65 || leftRows / ch(c) < 0.65 || rightRows / ch(c) < 0.65) return false;
    let coreHit = 0;
    const coreArea = (ix1 - ix0 + 1) * (iy1 - iy0 + 1);
    for (let y = iy0; y <= iy1; y++)
      for (let x = ix0; x <= ix1; x++) if (label[y * gw + x] === idx) coreHit++;
    return coreHit / coreArea < 0.1;
  };

  const used = new Set<number>();
  const boxFrames = new Set<number>();
  const figs: Comp[] = [];
  comps.forEach((c, i) => {
    if (cw(c) < unit * 1.5) return; // a lone vertical stroke (a bracket, an integral sign) is not a drawing
    if (isBoxFrame(c, i)) {
      boxFrames.add(i);
      return;
    }
    const big = ch(c) >= unit * 5;
    const narrow = ch(c) >= unit * 3 && ch(c) > cw(c) && groupWidth(i) <= cw(c) * 3;
    if (big || narrow) {
      figs.push({ ...c });
      used.add(i);
    }
  });

  // 6. Absorb labels, tick marks, arrows, and dashed guide lines into each figure.
  //    At the figure's height:
  //      - anything that overlaps the drawing horizontally is on it (axis labels,
  //        "f(x) = sin x" next to a curve, a dashed line through it);
  //      - a small piece just outside it (an arrow, a letter, a dash) is a label if
  //        what continues outward on the same line is also small. If a word or a
  //        formula follows, the piece belongs to text written beside the drawing.
  //    Above/below it: only short, isolated labels right at the edge (like "y").
  const reach = unit * 2.5;
  const small = unit * 2.5;
  const gapY = Math.max(1, unit * 0.6);
  const vOver = (a: Comp, b: Comp) => Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) + 1 >= Math.min(ch(a), ch(b)) * 0.5;

  /** Walks outward from piece `c` along its line; false if it runs into a wide piece (text). */
  const onlySmallBeyond = (c: Comp, side: 1 | -1): boolean => {
    let cur = c;
    for (let steps = 0; steps < 60; steps++) {
      let next = -1;
      let gap = Infinity;
      comps.forEach((d, i) => {
        if (used.has(i) || d === cur || !vOver(c, d)) return;
        const g = side > 0 ? d.x0 - cur.x1 : cur.x0 - d.x1;
        if (g >= 0 && g <= rowGap && g < gap) {
          gap = g;
          next = i;
        }
      });
      if (next < 0) return true;
      if (cw(comps[next]) > small) return false;
      cur = comps[next];
    }
    return true;
  };

  for (const f of figs) {
    let grew = true;
    while (grew) {
      grew = false;
      comps.forEach((c, i) => {
        if (used.has(i)) return;
        const cy = (c.y0 + c.y1) / 2;
        const hGap = Math.max(c.x0 - f.x1, f.x0 - c.x1, 0);
        let ok = false;
        if (cy >= f.y0 - gapY && cy <= f.y1 + gapY) {
          if (c.x0 <= f.x1 && c.x1 >= f.x0) ok = true;
          else if (hGap <= reach && cw(c) <= small) ok = onlySmallBeyond(c, c.x0 > f.x1 ? 1 : -1);
        } else {
          const g = groups.get(find(i))!;
          const vGap = Math.max(c.y0 - f.y1, f.y0 - c.y1);
          ok = vGap <= gapY + 1 && hGap <= unit && g.n <= 2 && g.x1 - g.x0 + 1 <= unit * 4;
        }
        if (!ok) return;
        f.x0 = Math.min(f.x0, c.x0);
        f.y0 = Math.min(f.y0, c.y0);
        f.x1 = Math.max(f.x1, c.x1);
        f.y1 = Math.max(f.y1, c.y1);
        used.add(i);
        grew = true;
      });
    }
  }

  // Merge figures that overlap after growing.
  for (let i = 0; i < figs.length; i++)
    for (let j = i + 1; j < figs.length; j++) {
      const a = figs[i];
      const b = figs[j];
      if (a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1) {
        a.x0 = Math.min(a.x0, b.x0);
        a.y0 = Math.min(a.y0, b.y0);
        a.x1 = Math.max(a.x1, b.x1);
        a.y1 = Math.max(a.y1, b.y1);
        figs.splice(j, 1);
        j = i;
      }
    }

  const pad = 1;
  const figures = figs
    .map((f) => ({
      x: Math.max(0, (f.x0 - pad) / gw),
      y: Math.max(0, (f.y0 - pad) / gh),
      w: Math.min(1, (f.x1 - f.x0 + 1 + 2 * pad) / gw),
      h: Math.min(1, (f.y1 - f.y0 + 1 + 2 * pad) / gh),
    }))
    .sort((a, b) => a.y - b.y || a.x - b.x);

  // 7. Text lines: rows of ink outside figures (and box frames), grouped into bands.
  const inFig = (x: number, y: number) =>
    figs.some((f) => x >= f.x0 && x <= f.x1 && y >= f.y0 && y <= f.y1);
  const rowMin = new Int32Array(gh).fill(gw);
  const rowMax = new Int32Array(gh).fill(-1);
  const rowCount = new Int32Array(gh);
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++)
      if (occ[y * gw + x] && !boxFrames.has(label[y * gw + x]) && !inFig(x, y)) {
        rowCount[y]++;
        if (x < rowMin[y]) rowMin[y] = x;
        if (x > rowMax[y]) rowMax[y] = x;
      }

  // Rows inside one handwritten line (including limits on integrals) are close together;
  // separate lines are at least ~half a ruled line apart.
  const joinGap = Math.max(1, Math.round(unit * 0.4));
  const minBand = Math.max(2, Math.round(unit * 0.5));
  const lines: TextLine[] = [];
  let start = -1;
  let last = -1;
  const flush = () => {
    if (start < 0) return;
    if (last - start + 1 >= minBand) {
      let x0 = gw;
      let x1 = -1;
      for (let y = start; y <= last; y++) {
        x0 = Math.min(x0, rowMin[y]);
        x1 = Math.max(x1, rowMax[y]);
      }
      lines.push({ y: (start + last + 1) / 2 / gh, x0: x0 / gw, x1: (x1 + 1) / gw });
    }
    start = -1;
  };
  for (let y = 0; y < gh; y++) {
    if (rowCount[y] >= 2) {
      if (start >= 0 && y - last > joinGap + 1) flush();
      if (start < 0) start = y;
      last = y;
    }
  }
  flush();

  return { figures, lines };
}

/* ---------------------------------------------------------------------------------- */

const area = (b: Box) => b.w * b.h;
export function overlapRatio(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? (w * h) / Math.min(area(a), area(b)) : 0;
}

/**
 * Pairs the model's figure descriptions (in reading order) with detected regions.
 *
 * - Same count: paired in reading order.
 * - Different counts: only confident pairs (the model's own box overlaps a region)
 *   are kept. Guessing would put the wrong alt text on a figure, which is worse for
 *   a blind reader than asking the model to describe each drawing directly.
 *
 * Returns, for each description, the index of its region (or -1), plus the regions
 * left unpaired.
 */
export function matchFigures(
  count: number,
  regions: Box[],
  modelBoxes?: (Box | null)[],
): { assigned: number[]; extra: number[] } {
  const assigned = new Array<number>(count).fill(-1);
  const taken = new Set<number>();

  if (count === regions.length) {
    regions.forEach((_, i) => {
      assigned[i] = i;
      taken.add(i);
    });
  } else {
    modelBoxes?.forEach((mb, i) => {
      if (!mb || i >= count) return;
      let best = -1;
      let score = 0.3;
      regions.forEach((r, j) => {
        const s = overlapRatio(mb, r);
        if (!taken.has(j) && s > score) {
          score = s;
          best = j;
        }
      });
      if (best >= 0) {
        assigned[i] = best;
        taken.add(best);
      }
    });
  }
  const extra = regions.map((_, j) => j).filter((j) => !taken.has(j));
  return { assigned, extra };
}

/** A unit of the transcription: an existing figure marker (its page y) or text (its weight). */
export interface PlacementUnit {
  /** y of the figure this marker belongs to, or null for a text unit. */
  markerY: number | null;
  /** Rough amount of written content (visible characters). Ignored for markers. */
  weight: number;
}

/**
 * Where a figure should go in the transcription, as a unit index (insert before
 * that unit).
 *
 * Compares how much handwriting lies above the figure (summed widths of the text
 * lines that start above it) with how much transcribed text comes before each
 * possible insertion point, and picks the closest. Using amounts rather than line
 * counts keeps it right when the model merges two handwritten lines into one or
 * splits one. Lines written beside the figure count as below it, so they follow
 * the figure (and wrap next to it). Order relative to existing markers is kept.
 */
const strictlyBeside = (l: TextLine, fig: Box) => l.x0 >= fig.x + fig.w * 0.9 || l.x1 <= fig.x + fig.w * 0.1;

export function insertionIndex(figure: Box, lines: TextLine[], units: PlacementUnit[]): number {
  const total = lines.reduce((n, l) => n + (l.x1 - l.x0), 0);
  const above = lines
    .filter((l) => l.y < figure.y && !(strictlyBeside(l, figure) && l.y > figure.y - figure.h * 0.08))
    .reduce((n, l) => n + (l.x1 - l.x0), 0);
  const target = total > 0 ? above / total : 1;

  const textTotal = units.reduce((n, u) => n + (u.markerY === null ? u.weight : 0), 0);
  let idx = units.length;
  let best = Infinity;
  let acc = 0;
  for (let i = 0; i <= units.length; i++) {
    const frac = textTotal > 0 ? acc / textTotal : 1;
    const d = Math.abs(frac - target);
    if (d < best - 1e-9) {
      best = d;
      idx = i;
    }
    if (i < units.length && units[i].markerY === null) acc += units[i].weight;
  }
  units.forEach((u, i) => {
    if (u.markerY === null) return;
    if (u.markerY < figure.y && idx <= i) idx = i + 1;
    if (u.markerY > figure.y && idx > i) idx = i;
  });
  return Math.max(0, Math.min(units.length, idx));
}

/** Visible-character estimate for a transcription unit (LaTeX commands don't count). */
export function textWeight(unit: string): number {
  const t = unit
    .replace(/\\(?:begin|end)\{[^}]*\}/g, '')
    .replace(/\\[a-zA-Z]+/g, 'x')
    .replace(/[$&{}^_\\#*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Math.max(1, t.length);
}

export interface FigureLayout {
  width: number;
  align: FigureAlign;
  wrap: boolean;
  besideLines: number;
}

/** Text lines written beside a figure, on the side the text flows (right or left). */
export function besideLines(fig: Box, lines: TextLine[]): { side: 'left' | 'right' | null; lines: TextLine[] } {
  // A line whose middle is level with the figure (allowing a little above its top and below its bottom edge).
  const level = lines.filter((l) => l.y > fig.y - fig.h * 0.08 && l.y < fig.y + fig.h * 1.08);
  const right = level.filter((l) => l.x0 >= fig.x + fig.w * 0.9);
  const left = level.filter((l) => l.x1 <= fig.x + fig.w * 0.1);
  if (right.length && !left.length) return { side: 'right', lines: right };
  if (left.length && !right.length) return { side: 'left', lines: left };
  return { side: null, lines: [] };
}

/**
 * Approximates the original layout: width relative to the writing area, alignment
 * from the figure's horizontal position, and text wrapping when something is
 * written next to it. `besideLines` here counts handwritten lines; the pipeline
 * converts it to transcription lines (the model may merge or split lines).
 */
export function defaultLayout(fig: Box, lines: TextLine[]): FigureLayout {
  // The handwriting typically spans ~75% of the page width; that maps to 100% of the column.
  const width = Math.round(Math.min(100, Math.max(20, (fig.w / 0.75) * 100)) / 5) * 5;
  const b = besideLines(fig, lines);
  // Text on the right means the figure sits on the left, and vice versa.
  if (b.side) return { width, align: b.side === 'right' ? 'left' : 'right', wrap: true, besideLines: b.lines.length };
  const cx = fig.x + fig.w / 2;
  return { width, align: cx < 0.4 ? 'left' : cx > 0.65 ? 'right' : 'center', wrap: false, besideLines: 0 };
}

/** Slices a normalized box out of a page InkMap (used by ink-vs-redraw checking). */
export function cropInkMap(map: InkMap, box: Box): InkMap {
  const x0 = Math.max(0, Math.min(map.w - 1, Math.floor(box.x * map.w)));
  const y0 = Math.max(0, Math.min(map.h - 1, Math.floor(box.y * map.h)));
  const x1 = Math.max(x0 + 1, Math.min(map.w, Math.ceil((box.x + box.w) * map.w)));
  const y1 = Math.max(y0 + 1, Math.min(map.h, Math.ceil((box.y + box.h) * map.h)));
  const w = x1 - x0;
  const h = y1 - y0;
  const ink = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    ink.set(map.ink.subarray((y0 + y) * map.w + x0, (y0 + y) * map.w + x1), y * w);
  }
  return { w, h, ink };
}

export interface TwoColumnSplit {
  headerBox: Box | null;
  leftBox: Box;
  rightBox: Box;
  gutterX: number;
}

/**
 * Detects a two-column handout (such as a reference sheet with side-by-side tables
 * or callouts below an optional full-width header) from ink alone.
 */
export function detectTwoColumns(map: InkMap, layout: Layout): TwoColumnSplit | null {
  const { w, h, ink } = map;
  if (w < 40 || h < 40 || layout.lines.length < 6) return null;

  const hw = Math.max(2, Math.round(w * 0.015));
  const rowStats = (y: number, gxPx: number) => {
    const off = y * w;
    let left = 0;
    let gut = 0;
    let right = 0;
    const g0 = Math.max(0, gxPx - hw);
    const g1 = Math.min(w - 1, gxPx + hw);
    for (let x = Math.round(w * 0.03); x < g0; x++) left += ink[off + x];
    for (let x = g0; x <= g1; x++) gut += ink[off + x];
    for (let x = g1 + 1; x <= Math.round(w * 0.97); x++) right += ink[off + x];
    return { left, gut, right };
  };

  let best: (TwoColumnSplit & { gutHits: number }) | null = null;
  const yEnd = Math.floor(h * 0.96);
  for (let gx = 0.43; gx <= 0.571; gx += 0.01) {
    if (layout.figures.some((f) => f.y + f.h > 0.3 && f.x < gx + 0.02 && f.x + f.w > gx - 0.02)) continue;
    const gxPx = Math.round(gx * w);
    // Skip any full-width header in the top 30% that crosses the gutter.
    let headerLastRow = -1;
    for (let y = 0; y < Math.floor(h * 0.3); y++) {
      if (rowStats(y, gxPx).gut > 0) headerLastRow = y;
    }
    const yStart = headerLastRow >= 0 ? Math.min(Math.floor(h * 0.35), headerLastRow + Math.max(3, Math.round(h * 0.015))) : 0;
    const bodyRows = yEnd - yStart;
    if (bodyRows < h * 0.45) continue;

    let gutRows = 0;
    let gutHits = 0;
    let leftInk = 0;
    let rightInk = 0;
    let leftRows = 0;
    let rightRows = 0;
    let leftTop = 0;
    let leftBot = 0;
    let rightTop = 0;
    let rightBot = 0;
    const midY = yStart + (bodyRows >> 1);
    for (let y = yStart; y < yEnd; y++) {
      const s = rowStats(y, gxPx);
      if (s.gut > 0) {
        gutRows++;
        gutHits += s.gut;
      }
      leftInk += s.left;
      rightInk += s.right;
      if (s.left >= 2) {
        leftRows++;
        if (y < midY) leftTop++;
        else leftBot++;
      }
      if (s.right >= 2) {
        rightRows++;
        if (y < midY) rightTop++;
        else rightBot++;
      }
    }
    const bodyInk = leftInk + rightInk;
    if (bodyInk < 150) continue;
    if (gutRows / bodyRows > 0.02) continue;
    if (leftInk / bodyInk < 0.22 || rightInk / bodyInk < 0.22) continue;
    if (leftRows / bodyRows < 0.12 || rightRows / bodyRows < 0.12) continue;
    if (leftTop < 2 || leftBot < 2 || rightTop < 2 || rightBot < 2) continue;

    let hasHeaderInk = false;
    if (yStart > 0) {
      let hInk = 0;
      for (let y = 0; y < yStart; y++) for (let x = 0; x < w; x++) hInk += ink[y * w + x];
      hasHeaderInk = hInk >= 30;
    }
    const topY = yStart / h;
    if (!best || gutHits < best.gutHits) {
      best = {
        gutHits,
        gutterX: gx,
        headerBox: hasHeaderInk ? { x: 0, y: 0, w: 1, h: topY } : null,
        leftBox: { x: 0, y: topY, w: gx, h: 1 - topY },
        rightBox: { x: gx, y: topY, w: 1 - gx, h: 1 - topY },
      };
    }
  }
  if (!best) return null;
  const { headerBox, leftBox, rightBox, gutterX } = best;
  return { headerBox, leftBox, rightBox, gutterX };
}

/**
 * Splits dense single-column handwritten pages (>= 10 lines) into 2-3 horizontal
 * crop bands along figure-free whitespace gaps so small vision models read fewer
 * symbols per request without dropping inline/margin annotations.
 */
export function splitDenseBands(layout: Layout): Box[] | null {
  if (layout.lines.length < 10) return null;
  const occupied = (y: number) =>
    layout.figures.some((f) => y >= f.y - 0.01 && y <= f.y + f.h + 0.01) ||
    layout.lines.some((l) => Math.abs(l.y - y) <= 0.012);

  const candidates: number[] = [];
  let gapStart = -1;
  for (let i = 20; i <= 80; i++) {
    const y = i / 100;
    if (!occupied(y)) {
      if (gapStart < 0) gapStart = y;
    } else if (gapStart >= 0) {
      if (y - gapStart >= 0.025) candidates.push((gapStart + y) / 2);
      gapStart = -1;
    }
  }
  if (gapStart >= 0 && 0.8 - gapStart >= 0.025) candidates.push((gapStart + 0.8) / 2);
  if (!candidates.length) return null;

  const lineCountIn = (y0: number, y1: number) => layout.lines.filter((l) => l.y >= y0 && l.y < y1).length;
  const toBoxes = (cuts: number[]): Box[] => {
    const ys = [0, ...cuts, 1];
    return ys.slice(1).map((y1, k) => ({ x: 0, y: ys[k], w: 1, h: y1 - ys[k] }));
  };

  if (layout.lines.length >= 15 && candidates.length >= 2) {
    const c1 = candidates.reduce((a, b) => (Math.abs(a - 0.34) < Math.abs(b - 0.34) ? a : b));
    const c2 = candidates.reduce((a, b) => (Math.abs(a - 0.67) < Math.abs(b - 0.67) ? a : b));
    if (c1 >= 0.22 && c2 - c1 >= 0.22 && 1 - c2 >= 0.22) {
      if (lineCountIn(0, c1) >= 4 && lineCountIn(c1, c2) >= 4 && lineCountIn(c2, 1) >= 4) return toBoxes([c1, c2]);
    }
  }

  const mid = candidates.reduce((a, b) => (Math.abs(a - 0.5) < Math.abs(b - 0.5) ? a : b));
  if (mid >= 0.28 && 1 - mid >= 0.28 && lineCountIn(0, mid) >= 4 && lineCountIn(mid, 1) >= 4) {
    return toBoxes([mid]);
  }
  return null;
}
