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
  const used = new Set<number>();
  const figs: Comp[] = [];
  comps.forEach((c, i) => {
    if (cw(c) < unit * 2) return; // a lone vertical stroke is not a drawing
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

  // 7. Text lines: rows of ink outside figures, grouped into bands.
  const inFig = (x: number, y: number) =>
    figs.some((f) => x >= f.x0 && x <= f.x1 && y >= f.y0 && y <= f.y1);
  const rowMin = new Int32Array(gh).fill(gw);
  const rowMax = new Int32Array(gh).fill(-1);
  const rowCount = new Int32Array(gh);
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++)
      if (occ[y * gw + x] && !inFig(x, y)) {
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
export function insertionIndex(figure: Box, lines: TextLine[], units: PlacementUnit[]): number {
  const total = lines.reduce((n, l) => n + (l.x1 - l.x0), 0);
  const above = lines.filter((l) => l.y < figure.y).reduce((n, l) => n + (l.x1 - l.x0), 0);
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
  // A line whose middle is level with the figure (allowing a little below its bottom edge).
  const level = lines.filter((l) => l.y > fig.y && l.y < fig.y + fig.h * 1.08);
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
