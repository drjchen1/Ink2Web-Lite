/**
 * "line" redraw kind:
 *  - 1D number lines, intervals, and derivative sign charts (+ / − / 0 / undef)
 *  - 2D complex s-plane pole-zero plots with optional Region of Convergence (ROC)
 */
import {
  COMMON_FIELDS,
  isNum,
  isObj,
  parseCommon,
  str,
  warnUnknown,
  type Common,
  type Fill,
  type Messages,
  type Obj,
  type PointMark,
  type Range,
} from './common.ts';
import { describeMarks, list, num, pt } from './describe.ts';
import { nice, niceRange, niceTicks, tickText } from './nice.ts';
import type { Pt } from './sample.ts';
import { COLORS, GRAY, PLOT_ASPECT, SIZE, richText, type Plot, type SvgOptions } from './svg.ts';

export type BoundEnd = number | '-inf' | 'inf';

export interface LineInterval {
  on: [BoundEnd, BoundEnd];
  ends: [Fill, Fill];
  label: string | null;
}

export interface LineSign {
  on: [BoundEnd, BoundEnd];
  sign: '+' | '-' | '0' | 'undef';
}

export interface LineSpec extends Common {
  kind: 'line';
  mode: '1d' | 'splane';
  intervals: LineInterval[];
  signs: LineSign[];
  poles: Pt[];
  zeros: Pt[];
  roc: { gt?: number; lt?: number } | null;
}

export interface LineFacts {
  kind: 'line';
  spec: LineSpec;
  xWindow: Range;
  yWindow: Range;
}

const LINE_FIELDS = [...COMMON_FIELDS, 'intervals', 'signs', 'poles', 'zeros', 'roc'];

const parseBound = (v: unknown): BoundEnd | null => {
  if (isNum(v)) return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === '-inf' || s === '-∞') return '-inf';
    if (s === 'inf' || s === '+inf' || s === '∞') return 'inf';
  }
  return null;
};

const parsePt = (v: unknown): Pt | null =>
  Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]) ? [v[0], v[1]] : null;

export function checkLine(raw: Obj, m: Messages): LineSpec | null {
  warnUnknown(raw, LINE_FIELDS, m);
  const isSplane = Array.isArray(raw.poles) || Array.isArray(raw.zeros) || isObj(raw.roc);
  const axesIn = isObj(raw.axes) ? raw.axes : {};
  const normalizedRaw: Obj = isSplane
    ? {
        ...raw,
        axes: {
          x: str(axesIn.x) ?? 'Re(s)',
          y: str(axesIn.y) ?? 'Im(s)',
        },
      }
    : raw;
  const common = parseCommon(normalizedRaw, m, 'x');

  const points: PointMark[] = [];
  if (raw.points !== undefined && !Array.isArray(raw.points)) m.errors.push('points must be a list.');
  (Array.isArray(raw.points) ? raw.points : []).forEach((p, i) => {
    const where = `point ${i + 1}`;
    if (!isObj(p)) return void m.errors.push(`${where}: must be an object.`);
    const label = str(p.label);
    const fill: Fill = p.fill === 'open' ? 'open' : 'closed';
    const pos = p.pos === 'above' || p.pos === 'below' || p.pos === 'left' || p.pos === 'right' ? p.pos : null;
    if (isNum(p.at)) points.push({ x: p.at, y: 0, label, fill, pos });
    else {
      const xy = parsePt(p.at);
      if (xy) points.push({ x: xy[0], y: xy[1], label, fill, pos });
      else m.errors.push(`${where}: give "at": a number or [x, y].`);
    }
  });

  if (isSplane) {
    const poles: Pt[] = [];
    const zeros: Pt[] = [];
    if (raw.poles !== undefined && !Array.isArray(raw.poles)) m.errors.push('poles must be a list.');
    (Array.isArray(raw.poles) ? raw.poles : []).forEach((p, i) => {
      const xy = parsePt(p);
      if (xy) poles.push(xy);
      else m.errors.push(`pole ${i + 1}: give [Re, Im].`);
    });
    if (raw.zeros !== undefined && !Array.isArray(raw.zeros)) m.errors.push('zeros must be a list.');
    (Array.isArray(raw.zeros) ? raw.zeros : []).forEach((z, i) => {
      const xy = parsePt(z);
      if (xy) zeros.push(xy);
      else m.errors.push(`zero ${i + 1}: give [Re, Im].`);
    });
    let roc: LineSpec['roc'] = null;
    if (raw.roc !== undefined) {
      if (!isObj(raw.roc)) m.errors.push('roc must be an object, e.g. { "gt": -1 }.');
      else {
        const gt = raw.roc.gt !== undefined ? (isNum(raw.roc.gt) ? raw.roc.gt : (m.errors.push('roc.gt must be a number.'), undefined)) : undefined;
        const lt = raw.roc.lt !== undefined ? (isNum(raw.roc.lt) ? raw.roc.lt : (m.errors.push('roc.lt must be a number.'), undefined)) : undefined;
        if (gt !== undefined || lt !== undefined) roc = { gt, lt };
      }
    }
    if (!poles.length && !zeros.length && !roc) m.errors.push('s-plane: give poles, zeros, or roc.');
    if (m.errors.length) return null;
    return {
      kind: 'line',
      ...common,
      points,
      mode: 'splane',
      intervals: [],
      signs: [],
      poles,
      zeros,
      roc,
    };
  }

  /* 1D number line / sign chart */
  const intervals: LineInterval[] = [];
  if (raw.intervals !== undefined && !Array.isArray(raw.intervals)) m.errors.push('intervals must be a list.');
  (Array.isArray(raw.intervals) ? raw.intervals : []).forEach((it, i) => {
    const where = `interval ${i + 1}`;
    if (!isObj(it) || !Array.isArray(it.on) || it.on.length !== 2) return void m.errors.push(`${where}: give "on": [from, to].`);
    const a = parseBound(it.on[0]);
    const b = parseBound(it.on[1]);
    if (a === null || b === null) return void m.errors.push(`${where}: bounds must be numbers, "-inf", or "inf".`);
    if (typeof a === 'number' && typeof b === 'number' && a >= b) return void m.errors.push(`${where}: start must be less than end.`);
    const fillOf = (e: unknown, dflt: Fill): Fill => (e === 'open' || e === 'closed' ? e : dflt);
    const ends: [Fill, Fill] = Array.isArray(it.ends)
      ? [fillOf(it.ends[0], 'closed'), fillOf(it.ends[1], 'open')]
      : ['closed', 'open'];
    intervals.push({ on: [a, b], ends, label: str(it.label) });
  });

  const signs: LineSign[] = [];
  if (raw.signs !== undefined && !Array.isArray(raw.signs)) m.errors.push('signs must be a list.');
  (Array.isArray(raw.signs) ? raw.signs : []).forEach((sg, i) => {
    const where = `sign ${i + 1}`;
    if (!isObj(sg) || !Array.isArray(sg.on) || sg.on.length !== 2) return void m.errors.push(`${where}: give "on": [from, to].`);
    const a = parseBound(sg.on[0]);
    const b = parseBound(sg.on[1]);
    if (a === null || b === null) return void m.errors.push(`${where}: bounds must be numbers, "-inf", or "inf".`);
    const rawSign = typeof sg.sign === 'string' ? sg.sign.trim() : '';
    const sign: LineSign['sign'] =
      rawSign === '−' || rawSign === '-'
        ? '-'
        : rawSign === '+' || rawSign === '0' || rawSign === 'undef'
          ? (rawSign as LineSign['sign'])
          : (m.errors.push(`${where}: sign must be "+", "-", "0", or "undef".`), '+');
    signs.push({ on: [a, b], sign });
  });

  if (!intervals.length && !signs.length && !points.length)
    m.errors.push('line: give intervals, signs, or points (or poles/zeros for an s-plane).');
  if (m.errors.length) return null;

  return {
    kind: 'line',
    ...common,
    points,
    mode: '1d',
    intervals,
    signs,
    poles: [],
    zeros: [],
    roc: null,
  };
}

export function analyzeLine(spec: LineSpec): LineFacts {
  if (spec.mode === 'splane') {
    const xs = [0, ...spec.poles.map((p) => p[0]), ...spec.zeros.map((z) => z[0]), ...spec.points.map((p) => p.x)];
    const ys = [0, ...spec.poles.map((p) => p[1]), ...spec.zeros.map((z) => z[1]), ...spec.points.map((p) => p.y)];
    if (spec.roc?.gt !== undefined) xs.push(spec.roc.gt);
    if (spec.roc?.lt !== undefined) xs.push(spec.roc.lt);
    const padX = spec.window.x ?? niceRange(Math.min(...xs) - 1.5, Math.max(...xs) + 1.5);
    let padY = spec.window.y ?? niceRange(Math.min(...ys) - 1.5, Math.max(...ys) + 1.5);
    if (!spec.window.y) {
      const halfY = Math.max(Math.abs(padY[0]), Math.abs(padY[1]), (padX[1] - padX[0]) / (2 * PLOT_ASPECT));
      padY = niceRange(-halfY, halfY);
    }
    return { kind: 'line', spec, xWindow: padX, yWindow: padY };
  }

  const nums: number[] = [...spec.points.map((p) => p.x)];
  for (const it of spec.intervals) for (const b of it.on) if (typeof b === 'number') nums.push(b);
  for (const sg of spec.signs) for (const b of sg.on) if (typeof b === 'number') nums.push(b);
  if (spec.ticks.x) for (const t of spec.ticks.x) nums.push(t.at);
  const lo = nums.length ? Math.min(...nums) : -3;
  const hi = nums.length ? Math.max(...nums) : 3;
  const span = Math.max(2, hi - lo);
  const xWindow = spec.window.x ?? niceRange(lo - 0.25 * span, hi + 0.25 * span);
  return { kind: 'line', spec, xWindow, yWindow: [-1, 1] };
}

export function splanePlot(f: LineFacts): Plot {
  const { spec, xWindow, yWindow } = f;
  const fills: Plot['fills'] = [];
  const guides: number[] = [];
  if (spec.roc) {
    const r0 = Math.max(xWindow[0], spec.roc.gt ?? xWindow[0]);
    const r1 = Math.min(xWindow[1], spec.roc.lt ?? xWindow[1]);
    if (r1 > r0) {
      fills.push({
        polygon: [
          [r0, yWindow[0]],
          [r1, yWindow[0]],
          [r1, yWindow[1]],
          [r0, yWindow[1]],
        ],
        color: COLORS[5],
      });
    }
    if (spec.roc.gt !== undefined) guides.push(spec.roc.gt);
    if (spec.roc.lt !== undefined) guides.push(spec.roc.lt);
  }
  const zeros: PointMark[] = spec.zeros.map(([x, y]) => ({
    x,
    y,
    label: null,
    fill: 'open',
    pos: null,
    auto: true,
    color: COLORS[0],
  }));
  return {
    xWindow,
    yWindow,
    axes: spec.axes,
    ticks: spec.ticks,
    fills,
    curves: [],
    edges: [],
    strips: [],
    guides,
    impulses: [],
    points: [...zeros, ...spec.points],
    labels: spec.labels,
  };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const r1 = (n: number) => Math.round(n * 10) / 10;
const FONT = `font-family="'Times New Roman', Times, serif"`;
const INK = '#1a1a1a';

export function renderLineSvg(f: LineFacts, opts: SvgOptions): string {
  const { spec, xWindow, yWindow } = f;
  const [a, b] = xWindow;
  const id = opts.id.replace(/[^A-Za-z0-9_-]/g, '-');

  if (spec.mode === 'splane') {
    const [c, d] = yWindow;
    const M = { l: 46, r: 22, t: 18, b: 34 };
    const pw = SIZE.w - M.l - M.r;
    const ph = SIZE.h - M.t - M.b;
    const X = (x: number) => M.l + ((x - a) / (b - a)) * pw;
    const Y = (y: number) => M.t + ((d - y) / (d - c)) * ph;
    const parts: string[] = [
      `<defs>`,
      `<clipPath id="${id}-clip"><rect x="${M.l}" y="${M.t}" width="${pw}" height="${ph}"/></clipPath>`,
      `<marker id="${id}-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,1 L10,5 L0,9 z" fill="${INK}"/></marker>`,
      `</defs>`,
      `<rect width="100%" height="100%" fill="#fff"/>`,
    ];
    if (spec.roc) {
      const r0 = Math.max(a, spec.roc.gt ?? a);
      const r1px = Math.min(b, spec.roc.lt ?? b);
      if (r1px > r0) {
        parts.push(`<rect x="${r1(X(r0))}" y="${M.t}" width="${r1(X(r1px) - X(r0))}" height="${ph}" fill="${COLORS[5]}" fill-opacity="0.28" clip-path="url(#${id}-clip)"/>`);
      }
      for (const gx of [spec.roc.gt, spec.roc.lt]) {
        if (gx !== undefined && gx >= a && gx <= b)
          parts.push(`<line x1="${r1(X(gx))}" y1="${M.t}" x2="${r1(X(gx))}" y2="${M.t + ph}" stroke="${GRAY}" stroke-width="1.4" stroke-dasharray="5 4"/>`);
      }
    }
    const ay = Y(c <= 0 && 0 <= d ? 0 : c);
    const bx = X(a <= 0 && 0 <= b ? 0 : a);
    parts.push(
      `<g stroke="${INK}" stroke-width="1.2" fill="none">`,
      `<line x1="${M.l}" y1="${r1(ay)}" x2="${r1(M.l + pw + 10)}" y2="${r1(ay)}" marker-end="url(#${id}-arrow)"/>`,
      `<line x1="${r1(bx)}" y1="${r1(M.t + ph)}" x2="${r1(bx)}" y2="${r1(M.t - 10)}" marker-end="url(#${id}-arrow)"/>`,
      `</g>`,
    );
    const xTicks = spec.ticks.x ?? niceTicks(a, b, 6).values.map((at) => ({ at, label: null as string | null }));
    const yTicks = spec.ticks.y ?? niceTicks(c, d, 6).values.map((at) => ({ at, label: null as string | null }));
    parts.push(`<g stroke="${INK}" stroke-width="1" font-size="13" ${FONT}>`);
    for (const t of xTicks) {
      if (t.at < a || t.at > b || (Math.abs(t.at) < 1e-12 && !t.label)) continue;
      const x = X(t.at);
      const lbl = t.label ?? (nice(t.at).exact ? nice(t.at).text : tickText(t.at, 1));
      parts.push(`<line x1="${r1(x)}" y1="${r1(ay - 3)}" x2="${r1(x)}" y2="${r1(ay + 3)}"/><text x="${r1(x)}" y="${r1(ay + 16)}" text-anchor="middle" stroke="none" fill="${INK}">${richText(lbl, 13)}</text>`);
    }
    for (const t of yTicks) {
      if (t.at < c || t.at > d || (Math.abs(t.at) < 1e-12 && !t.label)) continue;
      const y = Y(t.at);
      const lbl = t.label ?? (nice(t.at).exact ? nice(t.at).text : tickText(t.at, 1));
      parts.push(`<line x1="${r1(bx - 3)}" y1="${r1(y)}" x2="${r1(bx + 3)}" y2="${r1(y)}"/><text x="${r1(bx - 6)}" y="${r1(y + 4)}" text-anchor="end" stroke="none" fill="${INK}">${richText(lbl, 13)}</text>`);
    }
    parts.push(`</g>`);
    parts.push(`<g font-size="15" font-style="italic" fill="${INK}" ${FONT}><text x="${r1(M.l + pw - 2)}" y="${r1(ay - 8)}" text-anchor="end">${richText(spec.axes.x, 15)}</text><text x="${r1(bx + 8)}" y="${r1(M.t + 6)}">${richText(spec.axes.y, 15)}</text></g>`);
    // Zeros (open circles)
    for (const [zx, zy] of spec.zeros) {
      if (zx < a || zx > b || zy < c || zy > d) continue;
      parts.push(`<circle cx="${r1(X(zx))}" cy="${r1(Y(zy))}" r="5" fill="#fff" stroke="${COLORS[0]}" stroke-width="2"/>`);
    }
    // Poles (× crosses)
    for (const [px, py] of spec.poles) {
      if (px < a || px > b || py < c || py > d) continue;
      const x = X(px);
      const y = Y(py);
      const r = 5;
      parts.push(`<path d="M${r1(x - r)},${r1(y - r)}L${r1(x + r)},${r1(y + r)}M${r1(x - r)},${r1(y + r)}L${r1(x + r)},${r1(y - r)}" stroke="${COLORS[1]}" stroke-width="2.2" stroke-linecap="round"/>`);
    }
    for (const p of spec.points) {
      parts.push(`<circle cx="${r1(X(p.x))}" cy="${r1(Y(p.y))}" r="4" stroke="${INK}" stroke-width="1.5" fill="${p.fill === 'open' ? '#fff' : INK}"/>`);
      if (p.label) parts.push(`<text x="${r1(X(p.x) + 7)}" y="${r1(Y(p.y) - 6)}" font-size="14" fill="${INK}" ${FONT}>${richText(p.label, 14)}</text>`);
    }
    for (const l of spec.labels) {
      parts.push(`<text x="${r1(X(l.x))}" y="${r1(Y(l.y))}" font-size="14" fill="${INK}" ${FONT}>${richText(l.text, 14)}</text>`);
    }
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE.w} ${SIZE.h}" width="${SIZE.w}" height="${SIZE.h}" ` +
      `role="img" aria-labelledby="${id}-title ${id}-desc" class="redraw">` +
      `<title id="${id}-title">${esc(opts.title)}</title><desc id="${id}-desc">${esc(opts.desc)}</desc>` +
      parts.join('') +
      `</svg>`
    );
  }

  /* 1D number line / sign chart SVG (480 × 130) */
  const W = 480;
  const H = 130;
  const ml = 34;
  const mr = 40;
  const pw = W - ml - mr;
  const ay = 78;
  const X = (x: number) => ml + ((x - a) / (b - a)) * pw;
  const parts: string[] = [
    `<defs><marker id="${id}-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,1 L10,5 L0,9 z" fill="${INK}"/></marker></defs>`,
    `<rect width="100%" height="100%" fill="#fff"/>`,
    `<line x1="${ml - 8}" y1="${ay}" x2="${ml + pw + 10}" y2="${ay}" stroke="${INK}" stroke-width="1.4" marker-start="url(#${id}-arrow)" marker-end="url(#${id}-arrow)"/>`,
  ];
  const tickSet = new Set<number>();
  for (const it of spec.intervals) for (const end of it.on) if (typeof end === 'number') tickSet.add(end);
  for (const sg of spec.signs) for (const end of sg.on) if (typeof end === 'number') tickSet.add(end);
  for (const p of spec.points) tickSet.add(p.x);
  const ticks =
    spec.ticks.x ??
    (tickSet.size
      ? [...tickSet].sort((p, q) => p - q).map((at) => ({ at, label: null as string | null }))
      : niceTicks(a, b, 6).values.map((at) => ({ at, label: null as string | null })));

  parts.push(`<g stroke="${INK}" stroke-width="1.1" font-size="13" ${FONT}>`);
  for (const t of ticks) {
    if (t.at < a || t.at > b) continue;
    const x = X(t.at);
    const lbl = t.label ?? (nice(t.at).exact ? nice(t.at).text : tickText(t.at, 1));
    parts.push(`<line x1="${r1(x)}" y1="${ay - 5}" x2="${r1(x)}" y2="${ay + 5}"/><text x="${r1(x)}" y="${ay + 22}" text-anchor="middle" stroke="none" fill="${INK}">${richText(lbl, 13)}</text>`);
  }
  parts.push(`</g>`);
  parts.push(`<text x="${ml + pw + 16}" y="${ay + 5}" font-size="16" font-style="italic" fill="${INK}" ${FONT}>${richText(spec.axes.x, 16)}</text>`);

  // Intervals along the number line
  for (const it of spec.intervals) {
    const x0 = it.on[0] === '-inf' ? ml - 4 : typeof it.on[0] === 'number' ? X(Math.max(a, it.on[0])) : ml + pw + 6;
    const x1 = it.on[1] === 'inf' ? ml + pw + 6 : typeof it.on[1] === 'number' ? X(Math.min(b, it.on[1])) : ml - 4;
    parts.push(`<line x1="${r1(x0)}" y1="${ay}" x2="${r1(x1)}" y2="${ay}" stroke="${COLORS[0]}" stroke-width="4.5" stroke-linecap="round"/>`);
    if (typeof it.on[0] === 'number' && it.on[0] >= a && it.on[0] <= b)
      parts.push(`<circle cx="${r1(X(it.on[0]))}" cy="${ay}" r="4.5" stroke="${COLORS[0]}" stroke-width="2" fill="${it.ends[0] === 'open' ? '#fff' : COLORS[0]}"/>`);
    if (typeof it.on[1] === 'number' && it.on[1] >= a && it.on[1] <= b)
      parts.push(`<circle cx="${r1(X(it.on[1]))}" cy="${ay}" r="4.5" stroke="${COLORS[0]}" stroke-width="2" fill="${it.ends[1] === 'open' ? '#fff' : COLORS[0]}"/>`);
    if (it.label)
      parts.push(`<text x="${r1((x0 + x1) / 2)}" y="${ay - 16}" text-anchor="middle" font-size="14" fill="${COLORS[0]}" ${FONT}>${richText(it.label, 14)}</text>`);
  }

  // Sign chart annotations above the line
  for (const sg of spec.signs) {
    const x0 = sg.on[0] === '-inf' ? a : typeof sg.on[0] === 'number' ? Math.max(a, sg.on[0]) : b;
    const x1 = sg.on[1] === 'inf' ? b : typeof sg.on[1] === 'number' ? Math.min(b, sg.on[1]) : a;
    const mid = X((x0 + x1) / 2);
    const glyph = sg.sign === '-' ? '−' : sg.sign;
    const color = sg.sign === '+' ? COLORS[2] : sg.sign === '-' ? COLORS[1] : INK;
    parts.push(`<text x="${r1(mid)}" y="${ay - 22}" text-anchor="middle" font-size="18" font-weight="700" fill="${color}" ${FONT}>${esc(glyph)}</text>`);
    for (const boundary of sg.on) {
      if (typeof boundary === 'number' && boundary > a && boundary < b) {
        const bx = X(boundary);
        parts.push(`<line x1="${r1(bx)}" y1="26" x2="${r1(bx)}" y2="${ay - 6}" stroke="${GRAY}" stroke-width="1" stroke-dasharray="3 3"/>`);
      }
    }
  }

  for (const p of spec.points) {
    if (p.x < a || p.x > b) continue;
    const x = X(p.x);
    parts.push(`<circle cx="${r1(x)}" cy="${ay}" r="4.5" stroke="${INK}" stroke-width="1.6" fill="${p.fill === 'open' ? '#fff' : INK}"/>`);
    if (p.label) parts.push(`<text x="${r1(x)}" y="${ay - 14}" text-anchor="middle" font-size="14" fill="${INK}" ${FONT}>${richText(p.label, 14)}</text>`);
  }
  for (const l of spec.labels) {
    parts.push(`<text x="${r1(X(l.x))}" y="24" text-anchor="middle" font-size="14" fill="${INK}" ${FONT}>${richText(l.text, 14)}</text>`);
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" ` +
    `role="img" aria-labelledby="${id}-title ${id}-desc" class="redraw">` +
    `<title id="${id}-title">${esc(opts.title)}</title><desc id="${id}-desc">${esc(opts.desc)}</desc>` +
    parts.join('') +
    `</svg>`
  );
}

const boundWord = (b: BoundEnd) => (b === '-inf' ? '−∞' : b === 'inf' ? '∞' : num(b));
const fmtInterval = ([lo, hi]: [BoundEnd, BoundEnd], ends: [Fill, Fill] = ['open', 'open']) =>
  `${lo === '-inf' || ends[0] === 'open' ? '(' : '['}${boundWord(lo)}, ${boundWord(hi)}${hi === 'inf' || ends[1] === 'open' ? ')' : ']'}`;

export function describeLine(f: LineFacts): { short: string; long: string } {
  const { spec, xWindow, yWindow } = f;
  if (spec.mode === 'splane') {
    const short = `Complex ${spec.axes.x.replace(/\(.*/, '') || 's'}-plane pole-zero plot${spec.from ? ` for ${spec.from}` : ''}.`;
    const parts: string[] = [
      `Horizontal axis ${spec.axes.x} from ${num(xWindow[0])} to ${num(xWindow[1])}; vertical axis ${spec.axes.y} from ${num(yWindow[0])} to ${num(yWindow[1])}.`,
    ];
    if (spec.poles.length) parts.push(`Poles (marked ×) at ${list(spec.poles.map((p) => pt(...p)))}.`);
    if (spec.zeros.length) parts.push(`Zeros (marked ○) at ${list(spec.zeros.map((z) => pt(...z)))}.`);
    if (spec.roc) {
      const conds: string[] = [];
      if (spec.roc.gt !== undefined) conds.push(`Re(s) > ${num(spec.roc.gt)}`);
      if (spec.roc.lt !== undefined) conds.push(`Re(s) < ${num(spec.roc.lt)}`);
      if (conds.length) parts.push(`Shaded region of convergence: ${conds.join(' and ')}.`);
    }
    parts.push(...describeMarks(spec));
    return { short, long: parts.join(' ') };
  }

  const v = spec.v;
  const kindWord = spec.signs.length ? 'Sign chart' : 'Number line';
  const short = `${kindWord} for ${spec.axes.x} from ${num(xWindow[0])} to ${num(xWindow[1])}.`;
  const parts: string[] = [`Number line ${spec.axes.x} spanning from ${num(xWindow[0])} to ${num(xWindow[1])}.`];
  if (spec.intervals.length) {
    parts.push(
      `Highlighted ${spec.intervals.length === 1 ? 'interval' : 'intervals'}: ${list(
        spec.intervals.map((it) => `${fmtInterval(it.on, it.ends)}${it.label ? ` (${it.label})` : ''}`),
      )}.`,
    );
  }
  if (spec.signs.length) {
    const signWord = (s: LineSign['sign']) => (s === '+' ? 'positive' : s === '-' ? 'negative' : s === '0' ? 'zero' : 'undefined');
    parts.push(
      `Sign regions on ${v}: ${list(spec.signs.map((s) => `${signWord(s.sign)} on ${fmtInterval(s.on)}`))}.`,
    );
  }
  parts.push(...describeMarks(spec));
  return { short, long: parts.join(' ') };
}
