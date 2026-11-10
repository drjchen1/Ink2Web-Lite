/**
 * SVG for redrawn figures (2.2 dev). Every kind is turned into a Plot (index.ts) and
 * drawn here in one fixed, print-friendly style: black axes with arrowheads, serif
 * labels, Okabe–Ito colors (distinguishable with color-vision deficiencies) plus
 * dash patterns, so nothing depends on color alone. The SVG is self-contained (no
 * external fonts or CSS) and accessible: role="img" with <title> and <desc>.
 */
import type { LineStyle, PointMark, Range, TextLabel, Tick } from './common.ts';
import { approx, nice, niceTicks, tickText } from './nice.ts';
import type { Pt } from './sample.ts';
import type { Impulse } from './spec.ts';

export const SIZE = { w: 480, h: 320 };
const M = { l: 46, r: 22, t: 18, b: 34 };
/** Width / height of the plotting area: windows with this ratio have equal scales. */
export const PLOT_ASPECT = (SIZE.w - M.l - M.r) / (SIZE.h - M.t - M.b);
export const COLORS = ['#0072B2', '#D55E00', '#009E73', '#CC79A7', '#E69F00', '#56B4E9'];
export const GRAY = '#6b6b6b';
const INK = '#1a1a1a';
const FIELD = '#8c8c8c';
const FONT = `font-family="'Times New Roman', Times, serif"`;

export interface PlotCurve {
  segments: Pt[][];
  style: LineStyle;
  label: string | null;
  color: string;
  /** Stroke width (default 2.2). */
  width?: number;
}

/** A short arrow (direction field) or an arrowhead on a curve, in math coordinates. */
export interface Arrow {
  at: Pt;
  dir: Pt;
  color?: string;
}

/** A figure ready to draw, in math coordinates (x, y). */
export interface Plot {
  xWindow: Range;
  yWindow: Range;
  axes: { x: string; y: string };
  ticks: { x: Tick[] | null; y: Tick[] | null };
  fills: { polygon: Pt[]; color: string }[];
  curves: PlotCurve[];
  /** Thin straight sides of a region. */
  edges: [Pt, Pt][];
  /** Slices: opposite corners, and where their label goes. */
  strips: { rect: [Pt, Pt]; label: string | null; side: 'below' | 'right' }[];
  /** Vertical dashed guide lines (asymptotes). */
  guides: number[];
  impulses: Impulse[];
  points: PointMark[];
  labels: TextLabel[];
  /** Direction-field arrows, drawn at a fixed length on screen. */
  arrows?: Arrow[];
  /** Arrowheads showing the direction of motion along curves. */
  heads?: Arrow[];
}

export interface SvgOptions {
  /** Prefix for element ids, unique on the page (e.g. "p3-fig2"). */
  id: string;
  title: string;
  desc: string;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Label text with simple sub/superscripts: y_0, x^2, e^{-t}, u_{c}. Sizes are absolute
 * (percent sizes aren't handled the same everywhere), and the baseline is restored on
 * the next run of text rather than with an invisible character.
 */
export function richText(s: string, size: number): string {
  const out: string[] = [];
  const re = /([_^])(\{([^}]*)\}|(.))/g;
  let last = 0;
  let shift = 0; // em offset to undo on the next normal run
  let m: RegExpExecArray | null;
  const normal = (t: string) => {
    if (!t) return;
    out.push(shift ? `<tspan dy="${-shift}em" font-size="${size}">${esc(t)}</tspan>` : esc(t));
    shift = 0;
  };
  while ((m = re.exec(s))) {
    normal(s.slice(last, m.index));
    const body = m[3] ?? m[4];
    const dy = m[1] === '_' ? 0.3 : -0.45;
    // Consecutive scripts (x_0^2) share the shift.
    out.push(`<tspan dy="${r1((dy - shift) * 100) / 100}em" font-size="${r1(size * 0.72)}">${esc(body)}</tspan>`);
    shift = dy;
    last = re.lastIndex;
  }
  normal(s.slice(last));
  return out.join('');
}

type Box = { x0: number; y0: number; x1: number; y1: number };

/** Rough text box (serif digits/letters ≈ 0.5em wide). */
function textBox(x: number, y: number, anchor: 'start' | 'middle' | 'end', size: number, text: string): Box {
  const w = text.replace(/[_^{}]/g, '').length * size * 0.5;
  const x0 = anchor === 'start' ? x : anchor === 'middle' ? x - w / 2 : x - w;
  return { x0, y0: y - size * 0.8, x1: x0 + w, y1: y + size * 0.25 };
}
const overlaps = (p: Box, q: Box) => p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1;
const distToBox = (x: number, y: number, b: Box) => Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.y0 - y, 0, y - b.y1));

export function renderPlot(plot: Plot, opts: SvgOptions): string {
  const [a, b] = plot.xWindow;
  const [c, d] = plot.yWindow;
  const pw = SIZE.w - M.l - M.r;
  const ph = SIZE.h - M.t - M.b;
  const clampX = (x: number) => Math.max(a - 2 * (b - a), Math.min(b + 2 * (b - a), x));
  const clampY = (y: number) => Math.max(c - 2 * (d - c), Math.min(d + 2 * (d - c), y));
  const X = (x: number) => M.l + ((clampX(x) - a) / (b - a)) * pw;
  const Y = (y: number) => M.t + ((d - clampY(y)) / (d - c)) * ph;
  const id = opts.id.replace(/[^A-Za-z0-9_-]/g, '-');
  const parts: string[] = [];
  const area: Box = { x0: M.l + 4, y0: M.t + 4, x1: M.l + pw - 4, y1: M.t + ph - 4 };

  // Axes: through 0 when 0 is in view, otherwise along the window's edge.
  const xAxisY = c <= 0 && 0 <= d ? 0 : c;
  const yAxisX = a <= 0 && 0 <= b ? 0 : a;
  const ax0 = X(a), ax1 = X(b) + 10, ay = Y(xAxisY);
  const bx = X(yAxisX), by0 = Y(c), by1 = Y(d) - 10;

  parts.push(
    `<defs>`,
    `<clipPath id="${id}-clip"><rect x="${M.l}" y="${M.t}" width="${pw}" height="${ph}"/></clipPath>`,
    `<marker id="${id}-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">` +
      `<path d="M0,1 L10,5 L0,9 z" fill="${INK}"/></marker>`,
    `</defs>`,
    `<rect width="100%" height="100%" fill="#fff"/>`,
  );

  /* ink that labels should stay away from (pixel points) */
  const ink: [number, number][] = [];
  const curvePx = plot.curves.map((cv) =>
    cv.segments.map((seg) => seg.map(([x, y]): [number, number] => [X(x), Y(y)]).filter(([px, py]) => py >= M.t - 2 && py <= M.t + ph + 2 && px >= M.l - 2 && px <= M.l + pw + 2)),
  );
  // Every ~6 px along each curve (straight lines are sampled with very few points).
  for (const segs of curvePx)
    for (const seg of segs)
      for (let i = 0; i < seg.length; i++) {
        ink.push(seg[i]);
        if (i === 0) continue;
        const [x0, y0] = seg[i - 1];
        const [x1, y1] = seg[i];
        const n = Math.min(80, Math.floor(Math.hypot(x1 - x0, y1 - y0) / 6));
        for (let k = 1; k < n; k++) ink.push([x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n]);
      }
  for (let x = ax0; x <= ax1; x += 8) ink.push([x, ay]);
  for (let y = by1; y <= by0; y += 8) ink.push([bx, y]);
  for (const m of plot.impulses) for (let k = 0; k <= 10; k++) ink.push([X(m.at), Y((m.size * k) / 10)]);
  for (const [p, q] of plot.edges) for (let k = 0; k <= 10; k++) ink.push([X(p[0] + ((q[0] - p[0]) * k) / 10), Y(p[1] + ((q[1] - p[1]) * k) / 10)]);
  // Pixel direction of a math direction (y is flipped on screen).
  const kx = pw / (b - a);
  const ky = ph / (d - c);
  const pxDir = (v: Pt): [number, number] | null => {
    const ux = v[0] * kx;
    const uy = -v[1] * ky;
    const len = Math.hypot(ux, uy);
    return len > 0 && Number.isFinite(len) ? [ux / len, uy / len] : null;
  };
  const head = (x: number, y: number, u: [number, number], size: number, color: string) => {
    const [ux, uy] = u;
    const bx0 = x - ux * size;
    const by0 = y - uy * size;
    const w = size * 0.55;
    return `<path d="M${r1(x)},${r1(y)}L${r1(bx0 - uy * w)},${r1(by0 + ux * w)}L${r1(bx0 + uy * w)},${r1(by0 - ux * w)}Z" fill="${color}"/>`;
  };
  const arrowG: string[] = [];
  for (const ar of plot.arrows ?? []) {
    const u = pxDir(ar.dir);
    if (!u) continue;
    const cx = X(ar.at[0]);
    const cy = Y(ar.at[1]);
    const L = 7;
    const [x0, y0, x1, y1] = [cx - u[0] * L, cy - u[1] * L, cx + u[0] * L, cy + u[1] * L];
    ink.push([x0, y0], [cx, cy], [x1, y1]);
    arrowG.push(`<line x1="${r1(x0)}" y1="${r1(y0)}" x2="${r1(x1 - u[0] * 2)}" y2="${r1(y1 - u[1] * 2)}"/>`, head(x1, y1, u, 4.5, FIELD));
  }
  const headG: string[] = [];
  for (const hd of plot.heads ?? []) {
    const u = pxDir(hd.dir);
    if (!u) continue;
    const x = X(hd.at[0]);
    const y = Y(hd.at[1]);
    if (x < M.l || x > M.l + pw || y < M.t || y > M.t + ph) continue;
    headG.push(head(x + u[0] * 4, y + u[1] * 4, u, 9, hd.color ?? INK));
  }
  const placed: Box[] = [];

  /* strips and their labels */
  const stripG: string[] = [];
  for (const s of plot.strips) {
    const [p, q] = s.rect;
    const x0 = Math.min(X(p[0]), X(q[0]));
    const x1 = Math.max(X(p[0]), X(q[0]));
    const y0 = Math.min(Y(p[1]), Y(q[1]));
    const y1 = Math.max(Y(p[1]), Y(q[1]));
    stripG.push(
      `<rect x="${r1(x0)}" y="${r1(y0)}" width="${r1(Math.max(1, x1 - x0))}" height="${r1(Math.max(1, y1 - y0))}" fill="${COLORS[0]}" fill-opacity="0.55" stroke="${INK}" stroke-width="1"/>`,
    );
    for (let k = 0; k <= 6; k++) ink.push([(x0 + x1) / 2, y0 + ((y1 - y0) * k) / 6], [x0 + ((x1 - x0) * k) / 6, (y0 + y1) / 2]);
    if (s.label) {
      // Like a textbook: Δx under the strip, below the horizontal axis (or the strip, if
      // it hangs below the axis); Δy beside the strip, left of the vertical axis.
      const [tx, ty, anchor] =
        s.side === 'below'
          ? [(x0 + x1) / 2, Math.max(y1, ay) + 16, 'middle' as const]
          : [Math.min(x0, bx) - 6, (y0 + y1) / 2 + 5, 'end' as const];
      placed.push(textBox(tx, ty, anchor, 14, s.label));
      stripG.push(`<text x="${r1(tx)}" y="${r1(ty)}" text-anchor="${anchor}" font-size="14" font-style="italic" fill="${INK}" ${FONT}>${richText(s.label, 14)}</text>`);
    }
  }

  /* point marks and their labels (placed before ticks, so ticks give way) */
  const pointG: string[] = [];
  for (const p of plot.points) {
    if (p.x < a || p.x > b || p.y < c || p.y > d) continue;
    const x = X(p.x);
    const y = Y(p.y);
    ink.push([x, y]);
    pointG.push(`<circle cx="${r1(x)}" cy="${r1(y)}" r="3.8" stroke="${INK}" stroke-width="1.5" fill="${p.fill === 'open' ? '#fff' : INK}"/>`);
  }
  for (const p of plot.points) {
    if (!p.label || p.x < a || p.x > b || p.y < c || p.y > d) continue;
    const x = X(p.x);
    const y = Y(p.y);
    const options: [number, number, 'start' | 'middle' | 'end'][] = {
      below: [[0, 18, 'middle']],
      left: [[-8, 5, 'end']],
      right: [[8, 5, 'start']],
      above: [[0, -9, 'middle']],
      auto: [[6, -8, 'start'], [-6, -8, 'end'], [6, 16, 'start'], [-6, 16, 'end'], [0, -10, 'middle'], [0, 19, 'middle']],
    }[p.pos ?? 'auto'] as [number, number, 'start' | 'middle' | 'end'][];
    // Given a position, use it; otherwise the clearest of a few spots around the dot.
    let best = options[0];
    let bestScore = -Infinity;
    for (const o of options) {
      const box = textBox(x + o[0], y + o[1], o[2], 14, p.label);
      const inside = box.x0 >= area.x0 - 30 && box.x1 <= area.x1 + 20 && box.y0 >= area.y0 - 10 && box.y1 <= area.y1 + 20;
      let clear = 24;
      for (const [ix, iy] of ink) if (Math.hypot(ix - x, iy - y) > 5) clear = Math.min(clear, distToBox(ix, iy, box)); // not its own dot
      const score = clear - (placed.some((q) => overlaps(q, box)) ? 50 : 0) - (inside ? 0 : 40);
      if (score > bestScore) [best, bestScore] = [o, score];
    }
    placed.push(textBox(x + best[0], y + best[1], best[2], 14, p.label));
    pointG.push(`<text x="${r1(x + best[0])}" y="${r1(y + best[1])}" text-anchor="${best[2]}" font-size="14" fill="${INK}" ${FONT}>${richText(p.label, 14)}</text>`);
  }

  /* ticks */
  const ticks = (given: Tick[] | null, lo: number, hi: number) => {
    if (given)
      return given
        .filter((t) => t.at >= lo - 1e-9 && t.at <= hi + 1e-9)
        // A tick given without a label is labeled exactly when it can be (π/2, 2π, e).
        .map((t) => ({ ...t, label: t.label ?? (nice(t.at).exact ? nice(t.at).text : approx(t.at)), step: 1 }));
    const { values, step } = niceTicks(lo, hi, 6);
    return values.map((at) => ({ at, label: null as string | null, step }));
  };
  const tickG: string[] = [];
  const tick = (x1: number, y1: number, x2: number, y2: number, tx: number, ty: number, anchor: 'middle' | 'end', label: string) => {
    tickG.push(`<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}"/>`);
    const box = textBox(tx, ty, anchor, 13, label);
    if (placed.some((p) => overlaps(p, box))) return; // a point or strip label is here
    tickG.push(`<text x="${r1(tx)}" y="${r1(ty)}" text-anchor="${anchor}" stroke="none" fill="${INK}">${richText(label, 13)}</text>`);
  };
  for (const t of ticks(plot.ticks.x, a, b)) {
    // No 0 label where the axes cross (it would sit on the vertical axis).
    if (Math.abs(t.at - yAxisX) < 1e-12 && t.label === null && yAxisX === 0 && xAxisY === 0) continue;
    const x = X(t.at);
    tick(x, ay - 3, x, ay + 3, x, ay + 16, 'middle', t.label ?? tickText(t.at, t.step));
  }
  for (const t of ticks(plot.ticks.y, c, d)) {
    if (Math.abs(t.at - xAxisY) < 1e-12 && t.label === null) continue;
    const y = Y(t.at);
    tick(bx - 3, y, bx + 3, y, bx - 6, y + 4, 'end', t.label ?? tickText(t.at, t.step));
  }

  /* fills under everything */
  for (const f of plot.fills) {
    if (f.polygon.length < 3) continue;
    const dAttr = f.polygon.map(([x, y], i) => `${i ? 'L' : 'M'}${r1(X(x))},${r1(Y(y))}`).join('') + 'Z';
    parts.push(`<path d="${dAttr}" fill="${f.color}" fill-opacity="0.35" stroke="none" clip-path="url(#${id}-clip)"/>`);
  }

  if (arrowG.length) parts.push(`<g stroke="${FIELD}" stroke-width="1.1" stroke-linecap="round" clip-path="url(#${id}-clip)">`, ...arrowG, `</g>`);

  parts.push(
    `<g stroke="${INK}" stroke-width="1.2" fill="none">`,
    `<line x1="${r1(ax0)}" y1="${r1(ay)}" x2="${r1(ax1)}" y2="${r1(ay)}" marker-end="url(#${id}-arrow)"/>`,
    `<line x1="${r1(bx)}" y1="${r1(by0)}" x2="${r1(bx)}" y2="${r1(by1)}" marker-end="url(#${id}-arrow)"/>`,
    `</g>`,
    `<g stroke="${INK}" stroke-width="1" font-size="13" ${FONT}>`,
    ...tickG,
    `</g>`,
    `<g font-size="16" font-style="italic" fill="${INK}" ${FONT}>`,
    `<text x="${r1(ax1 + 2)}" y="${r1(ay + 5)}">${richText(plot.axes.x, 16)}</text>`,
    `<text x="${r1(bx + 6)}" y="${r1(by1 + 4)}">${richText(plot.axes.y, 16)}</text>`,
    `</g>`,
  );
  placed.push(textBox(ax1 + 2, ay + 5, 'start', 16, plot.axes.x), textBox(bx + 6, by1 + 4, 'start', 16, plot.axes.y));

  /* asymptotes as light dashed guides (computed, so they are exact) */
  if (plot.guides.length)
    parts.push(
      `<g stroke="${GRAY}" stroke-width="1" stroke-dasharray="3 4">`,
      ...plot.guides.map((x) => `<line x1="${r1(X(x))}" y1="${M.t}" x2="${r1(X(x))}" y2="${M.t + ph}"/>`),
      `</g>`,
    );

  /* curves and their labels */
  const curveG: string[] = [];
  const labelG: string[] = [];
  plot.curves.forEach((cv, k) => {
    const dash = cv.style === 'dashed' ? ' stroke-dasharray="7 5"' : cv.style === 'dotted' ? ' stroke-dasharray="1.5 4"' : '';
    const path = cv.segments.map((seg) => seg.map(([x, y], i) => `${i ? 'L' : 'M'}${r1(X(x))},${r1(Y(y))}`).join('')).join('');
    if (path) curveG.push(`<path d="${path}" stroke="${cv.color}"${dash}${cv.width ? ` stroke-width="${cv.width}"` : ''}/>`);
    if (cv.label) {
      const spot = labelSpot(curvePx[k], cv.label, ink, placed, area);
      if (spot) {
        placed.push(spot.box);
        labelG.push(`<text x="${r1(spot.x)}" y="${r1(spot.y)}" font-size="15" fill="${cv.color}" ${FONT}>${richText(cv.label, 15)}</text>`);
      }
    }
  });
  parts.push(
    `<g clip-path="url(#${id}-clip)" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">`,
    ...curveG,
    ...plot.edges.map(([p, q]) => `<line x1="${r1(X(p[0]))}" y1="${r1(Y(p[1]))}" x2="${r1(X(q[0]))}" y2="${r1(Y(q[1]))}" stroke="${INK}" stroke-width="1.4"/>`),
    `</g>`,
  );

  /* impulses */
  for (const m of plot.impulses) {
    const x = X(m.at);
    const top = Y(m.size);
    parts.push(`<line x1="${r1(x)}" y1="${r1(Y(0))}" x2="${r1(x)}" y2="${r1(top)}" stroke="${COLORS[0]}" stroke-width="2.2" marker-end="url(#${id}-arrow)"/>`);
    if (m.label) parts.push(`<text x="${r1(x + 6)}" y="${r1(top + 4)}" font-size="14" fill="${INK}" ${FONT}>${richText(m.label, 14)}</text>`);
  }

  parts.push(...headG, ...stripG, ...pointG, ...labelG);
  for (const l of plot.labels) parts.push(`<text x="${r1(X(l.x))}" y="${r1(Y(l.y))}" font-size="14" fill="${INK}" ${FONT}>${richText(l.text, 14)}</text>`);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE.w} ${SIZE.h}" width="${SIZE.w}" height="${SIZE.h}" ` +
    `role="img" aria-labelledby="${id}-title ${id}-desc" class="redraw">` +
    `<title id="${id}-title">${esc(opts.title)}</title><desc id="${id}-desc">${esc(opts.desc)}</desc>` +
    parts.join('') +
    `</svg>`
  );
}

/**
 * A spot for a curve's label: next to a point of the curve, inside the plot, as far
 * as possible from other ink and labels (ties go to the right-hand part of the curve,
 * where labels are usually written).
 */
function labelSpot(segs: [number, number][][], text: string, ink: [number, number][], placed: Box[], area: Box): { x: number; y: number; box: Box } | null {
  const pts = segs.flat().filter(([x, y]) => x > area.x0 && x < area.x1 && y > area.y0 && y < area.y1);
  if (!pts.length) return null;
  const stride = Math.max(1, Math.floor(pts.length / 80));
  let best: { x: number; y: number; box: Box; score: number } | null = null;
  for (let i = 0; i < pts.length; i += stride) {
    const [px, py] = pts[i];
    for (const [dx, dy] of [[6, -8], [6, 18], [-6 - text.length * 7.5, -8], [-6 - text.length * 7.5, 18]]) {
      const box = textBox(px + dx, py + dy, 'start', 15, text);
      if (box.x0 < area.x0 || box.x1 > area.x1 || box.y0 < area.y0 || box.y1 > area.y1) continue;
      if (placed.some((p) => overlaps(p, box))) continue;
      let clear = Infinity;
      for (const [x, y] of ink) clear = Math.min(clear, distToBox(x, y, box));
      const score = Math.min(clear, 24) + (px - area.x0) / (area.x1 - area.x0);
      if (!best || score > best.score) best = { x: px + dx, y: py + dy, box, score };
    }
  }
  return best;
}
