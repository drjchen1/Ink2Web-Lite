/**
 * Redraw: figures recreated from their mathematics (2.2 dev; not yet used by the app).
 *
 *   const r = redraw(specJson, { id: 'p3-fig2' });
 *   if (r.ok) element.innerHTML = r.svg;   // r.alt.short / r.alt.long for alt text
 *
 * common.ts   shared spec fields         spec.ts     checks, dispatch, "graph"
 * region.ts   "region" (spec, facts, alt text)
 * phase.ts    "phase" (spec, equilibria, nullclines, trajectories, alt text)
 * expr.ts     calculator-syntax expressions (no eval)
 * sample.ts   adaptive sampling with jumps, asymptotes, and gaps
 * analyze.ts  graph facts                describe.ts graph alt text + shared helpers
 * svg.ts      the drawing (every kind becomes a Plot)
 */
import { analyzeGraph, type GraphFacts } from './analyze.ts';
import { describeGraph } from './describe.ts';
import { analyzeRegion, describeRegion, intersectionMarks, regionWindows, type RegionFacts } from './region.ts';
import { analyzePhase, clipLine, describePhase, isStable, phaseWindows, type PhaseFacts } from './phase.ts';
import { autoY, type Pt } from './sample.ts';
import { nice } from './nice.ts';
import { checkSpec, valueAt, type GraphSpec, type Spec } from './spec.ts';
import { COLORS, GRAY, renderPlot, type Arrow, type Plot, type PlotCurve } from './svg.ts';

export type Facts = GraphFacts | RegionFacts | PhaseFacts;

export type RedrawResult =
  | { ok: true; svg: string; alt: { short: string; long: string }; facts: Facts; spec: Spec; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

function graphPlot(spec: GraphSpec, f: GraphFacts): Plot {
  let colorIdx = 0;
  return {
    xWindow: spec.window.x,
    yWindow: f.yWindow,
    axes: spec.axes,
    ticks: spec.ticks,
    fills: [],
    curves: f.curves.map((c) => ({
      segments: c.segments,
      style: c.curve.style,
      label: c.curve.label,
      color: c.curve.style === 'dashed' ? GRAY : COLORS[colorIdx++ % COLORS.length],
    })),
    edges: [],
    strips: [],
    guides: f.curves.flatMap((c) => c.asymptotes),
    impulses: spec.impulses,
    points: spec.points,
    labels: spec.labels,
  };
}

function regionPlot(f: RegionFacts): Plot {
  const { spec } = f;
  const points = spec.markIntersections ? [...intersectionMarks(f), ...spec.points] : spec.points;
  return {
    xWindow: f.xWindow,
    yWindow: f.yWindow,
    axes: spec.axes,
    ticks: spec.ticks,
    fills: [{ polygon: f.polygon, color: COLORS[5] }],
    curves: f.boundaries.map(({ b, segments }) => ({
      segments,
      style: 'solid' as const,
      label: b.label,
      color: b === spec.hi ? COLORS[0] : COLORS[1],
    })),
    edges: f.edges.map((e) => [e.from, e.to]),
    strips: f.strip ? [{ rect: f.strip.rect, label: spec.slice?.label ?? null, side: spec.dir === 'dx' ? 'below' : 'right' }] : [],
    guides: [],
    impulses: [],
    points,
    labels: spec.labels,
  };
}

function phasePlot(f: PhaseFacts): Plot {
  const { spec } = f;
  const [x0, x1] = f.xWindow;
  const [y0, y1] = f.yWindow;
  const curves: PlotCurve[] = [];
  const arrows: Arrow[] = [];
  const heads: Arrow[] = [];

  if (spec.show.has('field')) {
    const nx = 19;
    const ny = 12;
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < ny; j++) {
        const at: Pt = [x0 + ((i + 0.5) * (x1 - x0)) / nx, y0 + ((j + 0.5) * (y1 - y0)) / ny];
        const dir = spec.F(...at);
        if (Number.isFinite(dir[0]) && Number.isFinite(dir[1]) && (dir[0] || dir[1])) arrows.push({ at, dir });
      }
  }
  if (spec.show.has('eigenvectors'))
    for (const e of f.equilibria)
      for (const v of e.eigen.vectors) {
        const seg = clipLine(e.at, v, f.xWindow, f.yWindow);
        if (seg) curves.push({ segments: [seg], style: 'dashed', label: null, color: GRAY, width: 1.2 });
      }
  const [vx, vy] = spec.names;
  for (const n of f.nullclines)
    if (n.segments.length)
      curves.push({
        segments: n.segments,
        style: n.which ? 'dotted' : 'dashed',
        label: `${n.which ? vy : vx}′ = 0`,
        color: n.which ? COLORS[2] : COLORS[1],
        width: 1.8,
      });

  // Trajectories, with arrowheads spaced along the part inside the window.
  const sx = x1 - x0;
  const sy = y1 - y0;
  for (const t of f.trajectories) {
    curves.push({ segments: [t.path], style: 'solid', label: t.t.label, color: COLORS[0], width: 1.9 });
    const inWin = (p: Pt) => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1;
    let len = 0;
    const along: number[] = [0];
    for (let i = 1; i < t.path.length; i++) {
      const [p, q] = [t.path[i - 1], t.path[i]];
      len += inWin(q) ? Math.hypot((q[0] - p[0]) / sx, (q[1] - p[1]) / sy) : 0;
      along.push(len);
    }
    const count = Math.max(1, Math.min(3, Math.floor(len / 0.45)));
    // Keep arrowheads off the axes, where they would collide with tick labels.
    const ax = x0 <= 0 && 0 <= x1 ? 0 : x0;
    const ay = y0 <= 0 && 0 <= y1 ? 0 : y0;
    const clear = (p: Pt) => Math.abs(p[0] - ax) / sx > 0.04 && Math.abs(p[1] - ay) / sy > 0.06;
    for (let k = 0; k < count; k++) {
      let i = -1;
      for (const shift of [0, 0.12, -0.12, 0.24, -0.24]) {
        const target = (len * (k + 0.5 + shift)) / count;
        const j = along.findIndex((s) => s >= target);
        if (j > 0 && j < t.path.length - 1 && clear(t.path[j])) {
          i = j;
          break;
        }
      }
      if (i < 0) i = along.findIndex((s) => s >= (len * (k + 0.5)) / count);
      if (i <= 0 || i >= t.path.length - 1) continue;
      const p = t.path[i];
      const q = t.path[Math.min(t.path.length - 1, i + 2)];
      heads.push({ at: p, dir: [q[0] - p[0], q[1] - p[1]], color: COLORS[0] });
    }
  }

  const eqPoints = spec.show.has('equilibria')
    ? f.equilibria.map((e) => ({
        x: e.at[0],
        y: e.at[1],
        label: spec.labelEquilibria ? `(${e.at.map((v) => nice(v).text).join(', ')})` : null,
        fill: (isStable(e.type) ? 'closed' : 'open') as 'closed' | 'open',
        pos: null,
        auto: true,
      }))
    : [];
  return {
    xWindow: f.xWindow,
    yWindow: f.yWindow,
    axes: spec.axes,
    ticks: spec.ticks,
    fills: [],
    curves,
    edges: [],
    strips: [],
    guides: [],
    impulses: [],
    points: [...eqPoints, ...spec.points],
    labels: spec.labels,
    arrows,
    heads,
  };
}

export function redraw(input: unknown, opts: { id: string }): RedrawResult {
  const { spec, errors, warnings } = checkSpec(input);
  if (!spec) return { ok: false, errors, warnings };
  let facts: Facts;
  let plot: Plot;
  let alt: { short: string; long: string };
  if (spec.kind === 'graph') {
    const yWindow =
      spec.window.y ??
      autoY(
        spec.curves.map((c) => (x: number) => valueAt(c, x)),
        spec.window.x,
        [...spec.points.map((p) => p.y), ...spec.impulses.map((m) => m.size), ...spec.labels.map((l) => l.y)],
      );
    const g = analyzeGraph(spec, yWindow);
    facts = g;
    alt = describeGraph(g);
    plot = graphPlot(spec, g);
  } else if (spec.kind === 'phase') {
    const w = phaseWindows(spec);
    const p = analyzePhase(spec, w.x, w.y);
    if (typeof p === 'string') return { ok: false, errors: [p], warnings };
    facts = p;
    alt = describePhase(p);
    plot = phasePlot(p);
  } else {
    const w = regionWindows(spec);
    const r = analyzeRegion(spec, w.x, w.y);
    facts = r;
    alt = describeRegion(r);
    plot = regionPlot(r);
  }
  const svg = renderPlot(plot, { id: opts.id, title: alt.short, desc: alt.long });
  return { ok: true, svg, alt, facts, spec, warnings };
}

export { checkSpec } from './spec.ts';
export { parse, toText, ExprError } from './expr.ts';
