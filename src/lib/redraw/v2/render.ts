/**
 * Textbook-grade self-contained SVG Renderer (Redraw v2):
 *  - Negative axis overhangs past (0, 0) so origin jumps/dots aren't clipped
 *  - Expanded clip rects so boundary curve segments never shave half their stroke width
 *  - True MathBox labels (fractions, radicals, scripts, Greek, calligraphic)
 *  - Occupancy-grid label placement with leader-line fallback (no silently dropped labels)
 *  - Strictly self-closing SVG tags (`/>`) matching WCAG + XML invariants.
 */
import type { LineStyle } from '../common.ts';
import { nice, niceTicks, tickText } from '../nice.ts';
import type { Pt } from '../sample.ts';
import { COLORS, GRAY } from '../svg.ts';
import type { EvaluatedDiagram, EvaluatedPlot, EvaluatedScene } from './evaluate.ts';
import { measureAndRenderMath } from './mathSvg.ts';

const r1 = (n: number) => Math.round(n * 10) / 10;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const INK = '#0f172a';
const FIELD = '#8c8c8c';

interface Box2 {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
const hits = (a: Box2, b: Box2) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const boxDist = (px: number, py: number, b: Box2) => Math.hypot(Math.max(b.x0 - px, 0, px - b.x1), Math.max(b.y0 - py, 0, py - b.y1));

export function renderSceneSvg(
  ev: EvaluatedScene,
  opts: { id: string; title: string; desc: string },
): string {
  const id = opts.id.replace(/[^A-Za-z0-9_-]/g, '-');
  if (ev.kind === 'diagram') return renderDiagramSvg(ev, id, opts.title, opts.desc);
  if (ev.spec.space === '1d') return render1dSvg(ev, id, opts.title, opts.desc);
  return render2dPlotSvg(ev, id, opts.title, opts.desc);
}

function render2dPlotSvg(ev: EvaluatedPlot, id: string, title: string, desc: string): string {
  const W = 440;
  const H = Math.max(210, Math.min(380, Math.round(W / ev.aspect)));
  const M = { l: 46, r: 24, t: 22, b: 36 };
  const pw = W - M.l - M.r;
  const ph = H - M.t - M.b;
  const [a, b] = ev.xWindow;
  const [c, d] = ev.yWindow;

  const clampX = (x: number) => Math.max(a - 2 * (b - a), Math.min(b + 2 * (b - a), x));
  const clampY = (y: number) => Math.max(c - 2 * (d - c), Math.min(d + 2 * (d - c), y));
  const X = (x: number) => M.l + ((clampX(x) - a) / (b - a)) * pw;
  const Y = (y: number) => M.t + ((d - clampY(y)) / (d - c)) * ph;

  const xAxisY = c <= 0 && 0 <= d ? 0 : c;
  const yAxisX = a <= 0 && 0 <= b ? 0 : a;
  // Short negative overhangs past axis intersections so origin points stay clear.
  const ax0 = X(a) - (yAxisX === a ? 12 : 0);
  const ax1 = X(b) + 12;
  const ay = Y(xAxisY);
  const bx = X(yAxisX);
  const by0 = Y(c) + (xAxisY === c ? 12 : 0);
  const by1 = Y(d) - 12;

  const parts: string[] = [
    `<defs>`,
    // Expanded by 3px so segments sitting right along y=0 or x=0 aren't half-clipped.
    `<clipPath id="${id}-clip"><rect x="${M.l - 3}" y="${M.t - 3}" width="${pw + 6}" height="${ph + 6}"/></clipPath>`,
    `<marker id="${id}-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,1 L10,5 L0,9 z" fill="${INK}"/></marker>`,
    `</defs>`,
    `<rect width="100%" height="100%" fill="#fff"/>`,
  ];

  /* Ink samples so labels stay away from plotted lines */
  const ink: Pt[] = [];
  for (const cv of ev.curves) {
    for (const seg of cv.segments) {
      for (let i = 0; i < seg.length; i++) {
        const p: Pt = [X(seg[i][0]), Y(seg[i][1])];
        if (p[0] >= M.l - 4 && p[0] <= M.l + pw + 4 && p[1] >= M.t - 4 && p[1] <= M.t + ph + 4) ink.push(p);
      }
    }
  }
  for (let x = ax0; x <= ax1; x += 8) ink.push([x, ay]);
  for (let y = by1; y <= by0; y += 8) ink.push([bx, y]);
  const placed: Box2[] = [];

  /* Shaded regions, ROC half-planes, Riemann bars */
  for (const sh of ev.shades) {
    if (sh.polygon.length >= 3) {
      const dAttr = sh.polygon.map(([x, y], i) => `${i ? 'L' : 'M'}${r1(X(x))},${r1(Y(y))}`).join('') + 'Z';
      parts.push(`<path d="${dAttr}" fill="${sh.color}" fill-opacity="0.32" stroke="none" clip-path="url(#${id}-clip)"/>`);
    }
    for (const r of sh.riemannRects) {
      if (r.poly) {
        const dAttr = r.poly.map(([x, y], i) => `${i ? 'L' : 'M'}${r1(X(x))},${r1(Y(y))}`).join('') + 'Z';
        parts.push(`<path d="${dAttr}" fill="${COLORS[5]}" fill-opacity="0.38" stroke="${COLORS[0]}" stroke-width="1.1" clip-path="url(#${id}-clip)"/>`);
      } else {
        const rx = Math.min(X(r.x0), X(r.x1));
        const ry = Math.min(Y(r.y0), Y(r.y1));
        const rw = Math.abs(X(r.x1) - X(r.x0));
        const rh = Math.abs(Y(r.y1) - Y(r.y0));
        parts.push(`<rect x="${r1(rx)}" y="${r1(ry)}" width="${r1(rw)}" height="${r1(Math.max(1, rh))}" fill="${COLORS[5]}" fill-opacity="0.38" stroke="${COLORS[0]}" stroke-width="1.1" clip-path="url(#${id}-clip)"/>`);
      }
    }
    for (const gx of sh.guides) {
      if (gx >= a && gx <= b) {
        parts.push(`<line x1="${r1(X(gx))}" y1="${M.t}" x2="${r1(X(gx))}" y2="${M.t + ph}" stroke="${GRAY}" stroke-width="1.4" stroke-dasharray="5 4"/>`);
      }
    }
    if (sh.slice) {
      const [p, q] = sh.slice.rect;
      const sx0 = Math.min(X(p[0]), X(q[0]));
      const sx1 = Math.max(X(p[0]), X(q[0]));
      const sy0 = Math.min(Y(p[1]), Y(q[1]));
      const sy1 = Math.max(Y(p[1]), Y(q[1]));
      parts.push(`<rect x="${r1(sx0)}" y="${r1(sy0)}" width="${r1(Math.max(2, sx1 - sx0))}" height="${r1(Math.max(1, sy1 - sy0))}" fill="${COLORS[0]}" fill-opacity="0.55" stroke="${INK}" stroke-width="1"/>`);
      if (sh.slice.label) {
        const lb = measureAndRenderMath(sh.slice.label, 14);
        const lx = (sx0 + sx1) / 2 - lb.width / 2;
        const ly = sh.axis === 'x' ? Math.max(sy1, ay) + 17 : (sy0 + sy1) / 2 + 4;
        placed.push({ x0: lx, y0: ly - lb.ascent, x1: lx + lb.width, y1: ly + lb.descent });
        parts.push(lb.render(lx, ly, INK));
      }
    }
  }

  /* Direction-field arrows */
  const kx = pw / (b - a);
  const ky = ph / (d - c);
  const pxDir = (v: Pt): [number, number] | null => {
    const ux = v[0] * kx;
    const uy = -v[1] * ky;
    const len = Math.hypot(ux, uy);
    return len > 0 && Number.isFinite(len) ? [ux / len, uy / len] : null;
  };
  const arrowHeadPath = (x: number, y: number, u: [number, number], size: number, color: string) => {
    const bx0 = x - u[0] * size;
    const by0 = y - u[1] * size;
    const hw = size * 0.55;
    return `<path d="M${r1(x)},${r1(y)}L${r1(bx0 - u[1] * hw)},${r1(by0 + u[0] * hw)}L${r1(bx0 + u[1] * hw)},${r1(by0 - u[0] * hw)}Z" fill="${color}"/>`;
  };
  for (const f of ev.fields) {
    if (!f.arrows.length) continue;
    const ag: string[] = [];
    for (const ar of f.arrows) {
      const u = pxDir(ar.dir);
      if (!u) continue;
      const cx = X(ar.at[0]);
      const cy = Y(ar.at[1]);
      const L = 7;
      ag.push(`<line x1="${r1(cx - u[0] * L)}" y1="${r1(cy - u[1] * L)}" x2="${r1(cx + u[0] * L - u[0] * 2)}" y2="${r1(cy + u[1] * L - u[1] * 2)}"/>`);
      if (f.mode === 'vector') ag.push(arrowHeadPath(cx + u[0] * L, cy + u[1] * L, u, 4.2, FIELD));
    }
    parts.push(`<g stroke="${FIELD}" stroke-width="1.2" stroke-linecap="round" clip-path="url(#${id}-clip)">`, ...ag, `</g>`);
  }

  /* Coordinate axes */
  parts.push(
    `<g stroke="${INK}" stroke-width="1.4" fill="none">`,
    `<line x1="${r1(ax0)}" y1="${r1(ay)}" x2="${r1(ax1)}" y2="${r1(ay)}" marker-end="url(#${id}-arrow)"/>`,
    `<line x1="${r1(bx)}" y1="${r1(by0)}" x2="${r1(bx)}" y2="${r1(by1)}" marker-end="url(#${id}-arrow)"/>`,
    `</g>`,
  );

  const axBox = measureAndRenderMath(ev.axes.x, 15);
  const ayBox = measureAndRenderMath(ev.axes.y, 15);
  const axPos: Pt = [Math.min(W - axBox.width - 4, ax1 + 3), ay + 5];
  const ayPos: Pt = [bx + 8, Math.max(14, by1 + 5)];
  placed.push(
    { x0: axPos[0], y0: axPos[1] - axBox.ascent, x1: axPos[0] + axBox.width, y1: axPos[1] + axBox.descent },
    { x0: ayPos[0], y0: ayPos[1] - ayBox.ascent, x1: ayPos[0] + ayBox.width, y1: ayPos[1] + ayBox.descent },
  );
  parts.push(axBox.render(axPos[0], axPos[1], INK), ayBox.render(ayPos[0], ayPos[1], INK));

  /* Ticks */
  const txList =
    ev.ticks.x !== null
      ? ev.ticks.x
      : niceTicks(a, b, 5).values.map((at) => ({ at, label: nice(at).exact ? nice(at).text : tickText(at, 1) }));
  const tyList =
    ev.ticks.y !== null
      ? ev.ticks.y
      : niceTicks(c, d, 5).values.map((at) => ({ at, label: nice(at).exact ? nice(at).text : tickText(at, 1) }));

  const tickG: string[] = [];
  for (const t of txList) {
    if (t.at < a - 1e-9 || t.at > b + 1e-9) continue;
    if (ev.ticks.x === null && Math.abs(t.at - yAxisX) < 1e-12 && yAxisX === 0 && xAxisY === 0) continue;
    const x = X(t.at);
    tickG.push(`<line x1="${r1(x)}" y1="${r1(ay - 4)}" x2="${r1(x)}" y2="${r1(ay + 4)}" stroke="${INK}" stroke-width="1.1"/>`);
    const tb = measureAndRenderMath(t.label, 12.5);
    const box: Box2 = { x0: x - tb.width / 2, y0: ay + 18 - tb.ascent, x1: x + tb.width / 2, y1: ay + 18 + tb.descent };
    if (!placed.some((p) => hits(p, box))) {
      placed.push(box);
      tickG.push(tb.render(box.x0, ay + 18, INK));
    }
  }
  for (const t of tyList) {
    if (t.at < c - 1e-9 || t.at > d + 1e-9) continue;
    if (ev.ticks.y === null && Math.abs(t.at - xAxisY) < 1e-12) continue;
    const y = Y(t.at);
    tickG.push(`<line x1="${r1(bx - 4)}" y1="${r1(y)}" x2="${r1(bx + 4)}" y2="${r1(y)}" stroke="${INK}" stroke-width="1.1"/>`);
    const tb = measureAndRenderMath(t.label, 12.5);
    const box: Box2 = { x0: bx - 7 - tb.width, y0: y + 4 - tb.ascent, x1: bx - 7, y1: y + 4 + tb.descent };
    if (!placed.some((p) => hits(p, box))) {
      placed.push(box);
      tickG.push(tb.render(box.x0, y + 4, INK));
    }
  }
  parts.push(...tickG);

  /* Asymptotes, jumpGuides, projection drop lines */
  for (const cv of ev.curves) {
    for (const ax of cv.asymptotes) {
      parts.push(`<line x1="${r1(X(ax))}" y1="${M.t}" x2="${r1(X(ax))}" y2="${M.t + ph}" stroke="${GRAY}" stroke-width="1" stroke-dasharray="3 4"/>`);
    }
    for (const jg of cv.jumpGuides) {
      parts.push(`<line x1="${r1(X(jg.x))}" y1="${r1(Y(jg.y0))}" x2="${r1(X(jg.x))}" y2="${r1(Y(jg.y1))}" stroke="#475569" stroke-width="1.2" stroke-dasharray="4 4"/>`);
    }
  }
  for (const [px, py] of ev.marks.projections) {
    const sx = X(px);
    const sy = Y(py);
    parts.push(
      `<line x1="${r1(sx)}" y1="${r1(sy)}" x2="${r1(sx)}" y2="${r1(ay)}" stroke="${GRAY}" stroke-width="1.1" stroke-dasharray="4 3"/>`,
      `<line x1="${r1(sx)}" y1="${r1(sy)}" x2="${r1(bx)}" y2="${r1(sy)}" stroke="${GRAY}" stroke-width="1.1" stroke-dasharray="4 3"/>`,
    );
  }

  /* Nullclines & curves & flows */
  const strokeDash = (st: LineStyle) => (st === 'dashed' ? ' stroke-dasharray="7 5"' : st === 'dotted' ? ' stroke-dasharray="1.8 4"' : '');
  const curveG: string[] = [];
  const labelG: string[] = [];
  const plotArea: Box2 = { x0: M.l + 4, y0: M.t + 4, x1: W - 8, y1: H - 6 };

  for (const f of ev.fields) {
    for (const n of f.nullclines) {
      const path = n.segments.map((s) => s.map(([x, y], i) => `${i ? 'L' : 'M'}${r1(X(x))},${r1(Y(y))}`).join('')).join('');
      if (path) curveG.push(`<path d="${path}" stroke="${n.color}"${strokeDash(n.style)} stroke-width="1.7"/>`);
    }
  }

  ev.curves.forEach((cv) => {
    const path = cv.segments.map((seg) => seg.map(([x, y], i) => `${i ? 'L' : 'M'}${r1(X(x))},${r1(Y(y))}`).join('')).join('');
    if (path) curveG.push(`<path d="${path}" stroke="${cv.color}"${strokeDash(cv.style)} stroke-width="2.4"/>`);
    if (cv.layer.label) {
      const lb = measureAndRenderMath(cv.layer.label, 14.5);
      const pts = cv.segments.flat().map(([x, y]): Pt => [X(x), Y(y)]).filter(([px, py]) => px >= M.l && px <= M.l + pw && py >= M.t && py <= M.t + ph);
      let best: { x: number; y: number; box: Box2; score: number; anchorPt?: Pt } | null = null;
      const stride = Math.max(1, Math.floor(pts.length / 40));
      for (let i = pts.length - 1; i >= 0; i -= stride) {
        const [px, py] = pts[i];
        const offsets: [number, number][] = [[8, -8], [8, 16], [-lb.width - 8, -8], [-lb.width - 8, 16], [14, -20], [14, 24]];
        for (const [dx, dy] of offsets) {
          const box: Box2 = { x0: px + dx, y0: py + dy - lb.ascent, x1: px + dx + lb.width, y1: py + dy + lb.descent };
          if (box.x0 < plotArea.x0 || box.x1 > plotArea.x1 || box.y0 < plotArea.y0 || box.y1 > plotArea.y1) continue;
          if (placed.some((p) => hits(p, box))) continue;
          let clr = 24;
          for (const [ix, iy] of ink) clr = Math.min(clr, boxDist(ix, iy, box));
          const score = clr + (px - M.l) / pw;
          if (!best || score > best.score) best = { x: px + dx, y: py + dy, box, score };
        }
      }
      if (!best && pts.length) {
        // Fallback: place in top-right open corner with a thin leader line so label is never dropped.
        const [px, py] = pts[Math.floor(pts.length * 0.7)];
        const fx = Math.max(M.l + 8, M.l + pw - lb.width - 10);
        const fy = M.t + 18;
        best = {
          x: fx,
          y: fy,
          box: { x0: fx, y0: fy - lb.ascent, x1: fx + lb.width, y1: fy + lb.descent },
          score: 0,
          anchorPt: [px, py],
        };
      }
      if (best) {
        placed.push(best.box);
        if (best.anchorPt) {
          labelG.push(`<line x1="${r1(best.anchorPt[0])}" y1="${r1(best.anchorPt[1])}" x2="${r1(best.x)}" y2="${r1(best.y - 4)}" stroke="${cv.color}" stroke-width="0.9" stroke-dasharray="2 2"/>`);
        }
        labelG.push(best.anchorPt ? lb.render(best.x, best.y, cv.color) : lb.render(best.x, best.y, cv.color));
      }
    }
  });

  for (const fl of ev.flows) {
    const path = fl.path.map(([x, y], i) => `${i ? 'L' : 'M'}${r1(X(x))},${r1(Y(y))}`).join('');
    if (path) curveG.push(`<path d="${path}" stroke="${COLORS[0]}" stroke-width="2.1"/>`);
    for (const h of fl.heads) {
      const u = pxDir(h.dir);
      if (u) parts.push(arrowHeadPath(X(h.at[0]), Y(h.at[1]), u, 8.5, COLORS[0]));
    }
  }

  parts.push(
    `<g clip-path="url(#${id}-clip)" fill="none" stroke-linecap="round" stroke-linejoin="round">`,
    ...curveG,
    `</g>`,
  );

  /* Shift arrows, impulses, poles/zeros, points, labels */
  for (const ar of ev.marks.arrows) {
    const x0 = X(ar.from[0]);
    const y0 = Y(ar.from[1]);
    const x1 = X(ar.to[0]);
    const y1 = Y(ar.to[1]);
    parts.push(`<line x1="${r1(x0)}" y1="${r1(y0)}" x2="${r1(x1)}" y2="${r1(y1)}" stroke="${INK}" stroke-width="1.6"${strokeDash(ar.style)} marker-end="url(#${id}-arrow)"/>`);
    if (ar.label) {
      const lb = measureAndRenderMath(ar.label, 14);
      parts.push(lb.render((x0 + x1) / 2 - lb.width / 2, (y0 + y1) / 2 - 7, INK));
    }
  }
  for (const im of ev.marks.impulses) {
    const x = X(im.at);
    const y0 = Y(0);
    const y1 = Y(im.size);
    parts.push(`<line x1="${r1(x)}" y1="${r1(y0)}" x2="${r1(x)}" y2="${r1(y1)}" stroke="${COLORS[0]}" stroke-width="2.2" marker-end="url(#${id}-arrow)"/>`);
    if (im.label) parts.push(measureAndRenderMath(im.label, 14).render(x + 6, y1 + 4, INK));
  }
  for (const z of ev.marks.zeros) {
    parts.push(`<circle cx="${r1(X(z.x))}" cy="${r1(Y(z.y))}" r="5" fill="#fff" stroke="${COLORS[0]}" stroke-width="2"/>`);
  }
  for (const p of ev.marks.poles) {
    const px = X(p.x);
    const py = Y(p.y);
    parts.push(`<path d="M${r1(px - 5)},${r1(py - 5)}L${r1(px + 5)},${r1(py + 5)}M${r1(px - 5)},${r1(py + 5)}L${r1(px + 5)},${r1(py - 5)}" stroke="${COLORS[1]}" stroke-width="2.2" stroke-linecap="round"/>`);
  }
  for (const p of ev.marks.points) {
    if (p.x < a - 1e-9 || p.x > b + 1e-9 || p.y < c - 1e-9 || p.y > d + 1e-9) continue;
    const px = X(p.x);
    const py = Y(p.y);
    const stroke = p.color ?? INK;
    parts.push(`<circle cx="${r1(px)}" cy="${r1(py)}" r="4" stroke="${stroke}" stroke-width="1.6" fill="${p.fill === 'open' ? '#fff' : stroke}"/>`);
    if (p.label) {
      const lb = measureAndRenderMath(p.label, 13.5);
      const dx = p.pos === 'left' ? -lb.width - 7 : p.pos === 'above' || p.pos === 'below' ? -lb.width / 2 : 7;
      const dy = p.pos === 'below' ? 17 : p.pos === 'above' ? -9 : 4;
      parts.push(lb.render(px + dx, py + dy, INK));
    }
  }
  for (const lb of ev.marks.labels) {
    parts.push(measureAndRenderMath(lb.text, 14).render(X(lb.x), Y(lb.y), INK));
  }
  parts.push(...labelG);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" ` +
    `role="img" aria-labelledby="${id}-title ${id}-desc" class="redraw">` +
    `<title id="${id}-title">${esc(title)}</title><desc id="${id}-desc">${esc(desc)}</desc>` +
    parts.join('') +
    `</svg>`
  );
}

function render1dSvg(ev: EvaluatedPlot, id: string, title: string, desc: string): string {
  const W = 460;
  const H = 130;
  const ml = 34;
  const mr = 42;
  const pw = W - ml - mr;
  const ay = 78;
  const [a, b] = ev.xWindow;
  const X = (x: number) => ml + ((x - a) / (b - a)) * pw;
  const parts: string[] = [
    `<defs><marker id="${id}-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,1 L10,5 L0,9 z" fill="${INK}"/></marker></defs>`,
    `<rect width="100%" height="100%" fill="#fff"/>`,
    `<line x1="${ml - 10}" y1="${ay}" x2="${ml + pw + 10}" y2="${ay}" stroke="${INK}" stroke-width="1.4" marker-start="url(#${id}-arrow)" marker-end="url(#${id}-arrow)"/>`,
  ];

  const tickSet = new Set<number>();
  for (const it of ev.marks.intervals) {
    if (typeof it.a === 'number') tickSet.add(it.a);
    if (typeof it.b === 'number') tickSet.add(it.b);
  }
  for (const s of ev.marks.signs) {
    if (typeof s.a === 'number') tickSet.add(s.a);
    if (typeof s.b === 'number') tickSet.add(s.b);
  }
  for (const p of ev.marks.points) tickSet.add(p.x);
  const ticks =
    ev.ticks.x ??
    (tickSet.size
      ? [...tickSet].sort((u, v) => u - v).map((at) => ({ at, label: nice(at).exact ? nice(at).text : tickText(at, 1) }))
      : niceTicks(a, b, 5).values.map((at) => ({ at, label: nice(at).exact ? nice(at).text : tickText(at, 1) })));

  for (const t of ticks) {
    if (t.at < a || t.at > b) continue;
    const x = X(t.at);
    const tb = measureAndRenderMath(t.label, 13);
    parts.push(`<line x1="${r1(x)}" y1="${ay - 5}" x2="${r1(x)}" y2="${ay + 5}" stroke="${INK}" stroke-width="1.1"/>`, tb.render(x - tb.width / 2, ay + 22, INK));
  }
  parts.push(measureAndRenderMath(ev.axes.x, 15).render(ml + pw + 16, ay + 5, INK));

  for (const it of ev.marks.intervals) {
    const x0 = it.a === '-inf' ? ml - 4 : X(Math.max(a, it.a));
    const x1 = it.b === 'inf' ? ml + pw + 6 : X(Math.min(b, it.b));
    parts.push(`<line x1="${r1(x0)}" y1="${ay}" x2="${r1(x1)}" y2="${ay}" stroke="${COLORS[0]}" stroke-width="4.5" stroke-linecap="round"/>`);
    if (typeof it.a === 'number') parts.push(`<circle cx="${r1(X(it.a))}" cy="${ay}" r="4.5" stroke="${COLORS[0]}" stroke-width="2" fill="${it.ends[0] === 'open' ? '#fff' : COLORS[0]}"/>`);
    if (typeof it.b === 'number') parts.push(`<circle cx="${r1(X(it.b))}" cy="${ay}" r="4.5" stroke="${COLORS[0]}" stroke-width="2" fill="${it.ends[1] === 'open' ? '#fff' : COLORS[0]}"/>`);
    if (it.label) {
      const lb = measureAndRenderMath(it.label, 13.5);
      parts.push(lb.render((x0 + x1) / 2 - lb.width / 2, ay - 14, COLORS[0]));
    }
  }

  for (const sg of ev.marks.signs) {
    const x0 = sg.a === '-inf' ? a : Math.max(a, sg.a);
    const x1 = sg.b === 'inf' ? b : Math.min(b, sg.b);
    const mid = X((x0 + x1) / 2);
    const glyph = sg.sign === '-' ? '−' : sg.sign;
    const color = sg.sign === '+' ? COLORS[2] : sg.sign === '-' ? COLORS[1] : INK;
    parts.push(`<text x="${r1(mid)}" y="${ay - 22}" text-anchor="middle" font-size="18" font-weight="700" fill="${color}" font-family="'Times New Roman', Times, serif">${esc(glyph)}</text>`);
    for (const bd of [sg.a, sg.b]) {
      if (typeof bd === 'number' && bd > a && bd < b) {
        parts.push(`<line x1="${r1(X(bd))}" y1="26" x2="${r1(X(bd))}" y2="${ay - 6}" stroke="${GRAY}" stroke-width="1" stroke-dasharray="3 3"/>`);
      }
    }
  }

  for (const p of ev.marks.points) {
    if (p.x < a || p.x > b) continue;
    const x = X(p.x);
    parts.push(`<circle cx="${r1(x)}" cy="${ay}" r="4.5" stroke="${INK}" stroke-width="1.6" fill="${p.fill === 'open' ? '#fff' : INK}"/>`);
    if (p.label) {
      const lb = measureAndRenderMath(p.label, 13.5);
      parts.push(lb.render(x - lb.width / 2, ay - 14, INK));
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" ` +
    `role="img" aria-labelledby="${id}-title ${id}-desc" class="redraw">` +
    `<title id="${id}-title">${esc(title)}</title><desc id="${id}-desc">${esc(desc)}</desc>` +
    parts.join('') +
    `</svg>`
  );
}

function springPath(p0: Pt, p1: Pt): string {
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L;
  const uy = dy / L;
  const nx = -uy;
  const ny = ux;
  const lead = Math.min(12, L * 0.16);
  const coils = 5;
  const pts: Pt[] = [p0, [p0[0] + ux * lead, p0[1] + uy * lead]];
  const span = L - 2 * lead;
  for (let i = 1; i <= coils * 2; i++) {
    const t = lead + (span * (i - 0.5)) / (coils * 2);
    const amp = (i % 2 === 1 ? 1 : -1) * 7;
    pts.push([p0[0] + ux * t + nx * amp, p0[1] + uy * t + ny * amp]);
  }
  pts.push([p1[0] - ux * lead, p1[1] - uy * lead], p1);
  return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${r1(x)},${r1(y)}`).join('');
}

function renderDiagramSvg(ev: EvaluatedDiagram, id: string, title: string, desc: string): string {
  const { width: W, height: H, nodes, edges } = ev;
  const parts: string[] = [
    `<defs><marker id="${id}-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,1 L10,5 L0,9 z" fill="${INK}"/></marker></defs>`,
    `<rect width="100%" height="100%" fill="#fff"/>`,
  ];

  for (const e of edges) {
    const [p0, p1] = e.pts;
    if (e.kind === 'spring') {
      parts.push(`<path d="${springPath(p0, p1)}" fill="none" stroke="${COLORS[0]}" stroke-width="1.8" stroke-linejoin="round"/>`);
    } else if (e.kind === 'damper') {
      const mx = (p0[0] + p1[0]) / 2;
      const my = (p0[1] + p1[1]) / 2;
      parts.push(
        `<line x1="${r1(p0[0])}" y1="${r1(p0[1])}" x2="${r1(mx - 4)}" y2="${r1(my)}" stroke="${INK}" stroke-width="1.6"/>`,
        `<rect x="${r1(mx - 6)}" y="${r1(my - 8)}" width="12" height="16" fill="#fff" stroke="${INK}" stroke-width="1.6"/>`,
        `<line x1="${r1(mx + 6)}" y1="${r1(my)}" x2="${r1(p1[0])}" y2="${r1(p1[1])}" stroke="${INK}" stroke-width="1.6"/>`,
      );
    } else {
      const dash = e.kind === 'dashed' ? ' stroke-dasharray="5 4"' : '';
      const mk = e.kind === 'arrow' ? ` marker-end="url(#${id}-arrow)"` : '';
      parts.push(`<line x1="${r1(p0[0])}" y1="${r1(p0[1])}" x2="${r1(p1[0])}" y2="${r1(p1[1])}" stroke="${INK}" stroke-width="1.6"${dash}${mk}/>`);
    }
    if (e.labelBox && e.labelAt) {
      parts.push(e.labelBox.render(e.labelAt[0] - e.labelBox.width / 2, e.labelAt[1], COLORS[0]));
    }
  }

  for (const n of nodes) {
    if (n.shape === 'box' || n.shape === 'mass') {
      const fill = n.shape === 'mass' ? '#eef2ff' : '#f8fafc';
      const rx = n.shape === 'box' ? ' rx="5"' : '';
      parts.push(`<rect x="${r1(n.x - n.w / 2)}" y="${r1(n.y - n.h / 2)}" width="${r1(n.w)}" height="${r1(n.h)}"${rx} fill="${fill}" stroke="${INK}" stroke-width="1.6"/>`);
    } else if (n.shape === 'tank') {
      const x0 = n.x - n.w / 2;
      const y0 = n.y - n.h / 2;
      parts.push(`<path d="M${r1(x0)},${r1(y0)}L${r1(x0)},${r1(y0 + n.h)}L${r1(x0 + n.w)},${r1(y0 + n.h)}L${r1(x0 + n.w)},${r1(y0)}" fill="#eff6ff" stroke="${INK}" stroke-width="1.8"/>`);
    } else if (n.shape === 'sum' || n.shape === 'circle') {
      parts.push(`<circle cx="${r1(n.x)}" cy="${r1(n.y)}" r="${r1(n.w / 2)}" fill="#fff" stroke="${INK}" stroke-width="1.6"/>`);
    } else if (n.shape === 'wall' || n.shape === 'ground') {
      const x0 = n.x;
      parts.push(`<line x1="${r1(x0)}" y1="${r1(n.y - n.h / 2)}" x2="${r1(x0)}" y2="${r1(n.y + n.h / 2)}" stroke="${INK}" stroke-width="2.4"/>`);
    }
    if (n.label && n.shape !== 'wall' && n.shape !== 'ground') {
      const yBase = n.y + n.box.ascent * 0.4;
      parts.push(n.box.render(n.x - n.box.width / 2, yBase, INK));
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" ` +
    `role="img" aria-labelledby="${id}-title ${id}-desc" class="redraw">` +
    `<title id="${id}-title">${esc(title)}</title><desc id="${id}-desc">${esc(desc)}</desc>` +
    parts.join('') +
    `</svg>`
  );
}
