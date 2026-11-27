/**
 * Asking the model for a redraw spec (2.2). Pure functions; the call itself is in
 * pipeline.ts (redrawFigure).
 *
 * The model gets the figure's crop and the notes around the figure, and answers with a
 * spec constrained by REDRAW_SCHEMA (Ollama structured output). The schema is one flat
 * object with every kind's fields optional: small grammar-constrained models handle
 * that far better than a union of three shapes. tidyModelSpec() then drops empty and
 * unrelated fields, so the checks in spec.ts see what the model actually meant.
 *
 * The model reads the *equation* from the notes and only the teaching choices (window,
 * labels, marked points, starting points) from the drawing. With no equation in the
 * notes, it answers kind "none" and the figure stays an image.
 */

import { parse } from './expr.ts';

const num = { type: 'number' };
const pair = { type: 'array', items: num };
const str = { type: 'string' };
const point = {
  type: 'object',
  properties: {
    at: pair,
    label: str,
    fill: { enum: ['closed', 'open'] },
    pos: { enum: ['above', 'below', 'left', 'right'] },
  },
};
const tick = { type: 'object', properties: { at: num, label: str }, required: ['at'] };

export const REDRAW_SCHEMA = {
  type: 'object',
  properties: {
    kind: { enum: ['graph', 'region', 'phase', 'slope', 'line', 'none'] },
    from: str,
    schematic: { type: 'boolean' },
    params: {
      type: 'array',
      items: { type: 'object', properties: { name: str, value: num }, required: ['name', 'value'] },
    },
    window: { type: 'object', properties: { x: pair, y: pair } },
    axes: { type: 'object', properties: { x: str, y: str } },
    ticks: { type: 'object', properties: { x: { type: 'array', items: tick }, y: { type: 'array', items: tick } } },
    curves: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          expr: str,
          label: str,
          style: { enum: ['solid', 'dashed', 'dotted'] },
          pieces: {
            type: 'array',
            items: {
              type: 'object',
              properties: { expr: str, on: pair, ends: { type: 'array', items: { enum: ['closed', 'open'] } } },
              required: ['expr', 'on'],
            },
          },
        },
      },
    },
    jumpGuides: { type: 'boolean' },
    impulses: { type: 'array', items: { type: 'object', properties: { at: num, size: num, label: str }, required: ['at'] } },
    top: str,
    bottom: str,
    left: str,
    right: str,
    between: pair,
    slice: { type: 'object', properties: { at: num, label: str } },
    system: { type: 'object', properties: { x: str, y: str } },
    slope: str,
    show: { type: 'array', items: { enum: ['field', 'equilibria', 'nullclines', 'eigenvectors', 'isoclines'] } },
    trajectories: { type: 'array', items: { type: 'object', properties: { start: pair } } },
    solutions: { type: 'array', items: { type: 'object', properties: { start: pair, direction: { enum: ['both', 'forward', 'backward'] }, label: str } } },
    intervals: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          on: { type: 'array', items: { anyOf: [num, str] } },
          ends: { type: 'array', items: { enum: ['closed', 'open'] } },
          label: str,
        },
        required: ['on'],
      },
    },
    signs: {
      type: 'array',
      items: {
        type: 'object',
        properties: { on: { type: 'array', items: { anyOf: [num, str] } }, sign: { enum: ['+', '-', '0', 'undef'] } },
        required: ['on', 'sign'],
      },
    },
    poles: { type: 'array', items: pair },
    zeros: { type: 'array', items: pair },
    roc: { type: 'object', properties: { gt: num, lt: num } },
    points: { type: 'array', items: point },
    labels: { type: 'array', items: { type: 'object', properties: { at: pair, text: str }, required: ['at', 'text'] } },
  },
  required: ['kind', 'from'],
};

export const REDRAW_SYSTEM = 'You turn hand-drawn math figures into exact JSON descriptions of their mathematics.';

/**
 * The notes around figure `id`: up to `max` characters, mostly before the figure (the
 * equation a figure shows usually comes first). The figure's own marker is shown as
 * ">>> THIS FIGURE <<<", other figures as "[another figure]".
 */
export function notesAround(source: string, id: number, max = 1800): string {
  const lines = source.split('\n');
  const marker = (l: string) => /^\s*\[\[\s*FIGURE\s+(\d+)\s*\]\]\s*$/i.exec(l);
  const at = lines.findIndex((l) => Number(marker(l)?.[1]) === id);
  const shown = lines.map((l) => {
    const m = marker(l);
    if (!m) return l;
    return Number(m[1]) === id ? '>>> THIS FIGURE <<<' : '[another figure]';
  });
  if (at < 0) {
    const text = shown.join('\n').trim();
    return text.length > max ? `${text.slice(0, max)}\n…` : text;
  }
  let lo = at;
  let hi = at;
  let size = shown[at].length;
  // Grow mostly backward: about two lines before for each line after.
  for (let k = 0; ; k++) {
    const back = k % 3 !== 2;
    const i = back ? lo - 1 : hi + 1;
    const j = back ? hi + 1 : lo - 1;
    const pick = i >= 0 && i < shown.length ? i : j >= 0 && j < shown.length ? j : -1;
    if (pick < 0 || size + shown[pick].length + 1 > max) break;
    size += shown[pick].length + 1;
    if (pick < lo) lo = pick;
    else hi = pick;
  }
  return `${lo > 0 ? '…\n' : ''}${shown.slice(lo, hi + 1).join('\n').trim()}${hi < shown.length - 1 ? '\n…' : ''}`;
}

export function redrawPrompt(notes: string): string {
  return `The image is one hand-drawn figure from a page of math notes. Below are the notes around it; ">>> THIS FIGURE <<<" marks where the figure is.

Write the figure's mathematics as JSON so the app can redraw it exactly. Take the equation from the notes, not from the picture. Take only the window, axis letters, labels, and marked points from the picture.

If the notes don't give an equation or system that this figure shows, answer {"kind": "none", "from": ""}.

Five kinds:

1. "graph": the graph of a function given in the notes.
{"kind": "graph", "from": "y = e^{-t/2}\\\\cos(3t)", "window": {"x": [0, 8], "y": [-1, 1]}, "axes": {"x": "t", "y": "y"}, "curves": [{"expr": "exp(-t/2)*cos(3t)", "label": "y(t)"}]}
A piecewise function is one curve with pieces: {"pieces": [{"expr": "0", "on": [0, 2], "ends": ["closed", "open"]}, {"expr": "1", "on": [2, 5]}]}. Add "jumpGuides": true if dashed vertical lines connect jumps.
Use u(t - c) for u_c(t). When the axis marks an unspecified constant like c > 0, pick a sample value: "params": [{"name": "c", "value": 2}], "window": {"x": [0, 4], "y": [-0.5, 1.5]}.
For an illustrative curve f(t) vs shifted f(t - c) without an explicit formula, use "schematic": true with expressions "f(t)" and "f(t - c)".
An impulse δ(t − 3) is "impulses": [{"at": 3}].

2. "region": a shaded region between curves (areas, integrals).
{"kind": "region", "from": "\\\\int_0^1 (\\\\sqrt{x} - x^2)\\\\,dx", "top": "sqrt(x)", "bottom": "x^2", "slice": {"at": 0.5, "label": "Δx"}}
Leave out "between" to end the region where the curves meet; otherwise "between": [0, 2]. "bottom" may be left out for the x-axis. For horizontal strips use "right" and "left" as functions of y.

3. "phase": the phase plane of a system x' = f(x, y), y' = g(x, y).
{"kind": "phase", "from": "x' = y,\\\\; y' = -2x - 3y", "system": {"x": "y", "y": "-2*x - 3*y"}, "window": {"x": [-3, 3], "y": [-3, 3]}, "trajectories": [{"start": [2, 0]}]}
Always write the system with the letters x and y, and put the author's letters in "axes", for example {"x": "u", "y": "v"}. Give one start point on each curve drawn. Add "show": ["field", "equilibria", "nullclines"] only for what is drawn.

4. "slope": a 1D ODE direction (slope) field y' = f(t, y) with optional solution curves.
{"kind": "slope", "from": "y' = t - y", "slope": "t - y", "window": {"x": [-3, 3], "y": [-3, 3]}, "solutions": [{"start": [0, 1]}]}

5. "line": a number line / derivative sign chart, or a complex s-plane pole-zero plot.
{"kind": "line", "from": "f'(x) = (x + 2)(x - 1)", "signs": [{"on": ["-inf", -2], "sign": "+"}, {"on": [-2, 1], "sign": "-"}, {"on": [1, "inf"], "sign": "+"}]}
For s-plane plots, give "poles": [[re, im], ...] (×), "zeros": [[re, im], ...] (○), and optional "roc": {"gt": -1}.

Rules:
- "from" is the equation copied from the notes, in LaTeX.
- "expr" uses calculator syntax: * for products, ^ for powers, exp(), sqrt(), sin(), ln(), pi, u(t-2) for a unit step. No LaTeX, no "y =".
- "window" is the range the drawn axes cover; use the tick marks.
- Points the author marked: "points": [{"at": [1, 2], "label": "(1, 2)"}].

Notes:
${notes}

Answer with the JSON only.`;
}

export function repairPrompt(errors: string[]): string {
  return `The app couldn't use that JSON:
${errors.map((e) => `- ${e}`).join('\n')}
Fix these problems and answer with the corrected JSON only. If the notes don't give an equation for this figure, answer {"kind": "none", "from": ""}.`;
}

/* ---------------- tidying the answer ---------------- */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

const SHARED = ['kind', 'from', 'params', 'schematic', 'window', 'axes', 'ticks', 'points', 'labels'];
const FIELDS: Record<string, string[]> = {
  graph: [...SHARED, 'curves', 'impulses', 'jumpGuides'],
  region: [...SHARED, 'top', 'bottom', 'left', 'right', 'between', 'slice'],
  phase: [...SHARED, 'system', 'show', 'trajectories', 'vars'],
  slope: [...SHARED, 'slope', 'show', 'solutions', 'vars'],
  line: [...SHARED, 'intervals', 'signs', 'poles', 'zeros', 'roc'],
};

/** Drops empty strings, arrays, and objects, recursively. */
function prune(v: unknown): unknown {
  if (typeof v === 'string') return v.trim() ? v.trim() : undefined;
  if (Array.isArray(v)) {
    const a = v.map(prune).filter((x) => x !== undefined);
    return a.length ? a : undefined;
  }
  if (isObj(v)) {
    const o: Obj = {};
    for (const [k, x] of Object.entries(v)) {
      const p = prune(x);
      if (p !== undefined) o[k] = p;
    }
    return Object.keys(o).length ? o : undefined;
  }
  return v;
}

/** Strips "y =" and LaTeX the model may still put in an expression. */
export function cleanExpr(e: string): string {
  return e
    .replace(/^\s*[A-Za-z]\s*(\(\s*[A-Za-z]\s*\))?\s*=\s*/, '') // "y =", "f(x) ="
    .replace(/\\left|\\right/g, '')
    .replace(/\\cdot|\\times/g, '*')
    .replace(/\\(sin|cos|tan|ln|exp|sqrt|pi)\b/g, '$1')
    .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)')
    .replace(/\b([uH])_(?:\{([^{}]+)\}|([A-Za-z0-9.]+))\s*\(\s*([A-Za-z])\s*\)/g, (_, fn: string, g1?: string, g2?: string, v?: string) => {
      const c = (g1 ?? g2 ?? '').trim();
      return c === '0' ? `${fn}(${v})` : `${fn}(${v} - ${c})`;
    })
    .replace(/[{}]/g, (c) => (c === '{' ? '(' : ')'))
    .replace(/\$/g, '')
    .trim();
}

/**
 * The model's answer as a spec object, 'none' when it says the figure has no equation
 * in the notes, or null when the answer isn't JSON at all.
 */
export function tidyModelSpec(answer: string): Obj | 'none' | null {
  let raw: unknown;
  try {
    raw = JSON.parse(answer.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    return null;
  }
  if (!isObj(raw)) return null;
  if (raw.kind === 'none') return 'none';
  const kind = typeof raw.kind === 'string' ? raw.kind : '';
  const keep = FIELDS[kind] ?? Object.keys(raw);
  const out: Obj = {};
  for (const k of keep) if (raw[k] !== undefined) out[k] = raw[k];
  const spec = (prune(out) ?? {}) as Obj;

  // Ranges written backwards; a zero-height window.
  if (isObj(spec.window)) {
    const w = spec.window as Obj;
    for (const k of ['x', 'y']) {
      const r = w[k];
      if (Array.isArray(r) && r.length === 2 && typeof r[0] === 'number' && typeof r[1] === 'number') {
        if (r[0] > r[1]) w[k] = [r[1], r[0]];
        else if (r[0] === r[1]) delete w[k];
      } else delete w[k];
    }
    if (!Object.keys(w).length) delete spec.window;
  }
  // Expressions.
  const fix = (e: unknown) => (typeof e === 'string' ? cleanExpr(e) : e);
  if (Array.isArray(spec.curves))
    for (const c of spec.curves as Obj[]) {
      if (!isObj(c)) continue;
      if (c.expr !== undefined) c.expr = fix(c.expr);
      if (Array.isArray(c.pieces)) for (const p of c.pieces as Obj[]) if (isObj(p)) p.expr = fix(p.expr);
      if (c.pieces && c.expr) delete c.expr;
    }
  for (const k of ['top', 'bottom', 'left', 'right', 'slope']) if (spec[k] !== undefined) spec[k] = fix(spec[k]);
  // Phase: the system is in x and y; the author's letters are only labels.
  if (kind === 'phase' && isObj(spec.system)) {
    const sys = spec.system as Obj;
    for (const k of Object.keys(sys)) sys[k] = fix(sys[k]);
    const ax = isObj(spec.axes) ? (spec.axes as Obj) : {};
    const letters = [ax.x, ax.y].map((l) => (typeof l === 'string' && /^[A-Za-z]$/.test(l) ? l : null));
    const [lx, ly] = letters;
    if (Object.keys(sys).sort().join() === 'x,y' && lx && ly && (lx !== 'x' || ly !== 'y')) {
      // Keyed x, y as asked, but the expressions may use the author's letters anyway.
      const parses = (vars: string[]) =>
        [sys.x, sys.y].every((e) => {
          try {
            return typeof e === 'string' && !!parse(e, vars);
          } catch {
            return false;
          }
        });
      if (parses(['x', 'y'])) spec.vars = ['x', 'y'];
      else if (parses([lx, ly])) spec.system = { [lx]: sys.x, [ly]: sys.y };
    }
  }
  return spec;
}

/**
 * Pretty JSON for the spec editor: anything that fits on a line stays on one line.
 *   "window": { "x": [0, 8], "y": [-1, 1] },
 */
export function formatSpec(spec: unknown, indent = 0, width = 76, lead = 0): string {
  const inline = (v: unknown): string =>
    Array.isArray(v)
      ? `[${v.map(inline).join(', ')}]`
      : isObj(v)
        ? Object.keys(v).length
          ? `{ ${Object.entries(v)
              .map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`)
              .join(', ')} }`
          : '{}'
        : JSON.stringify(v);
  const one = inline(spec);
  // `lead`: characters already on this line before the value (its key).
  if (indent + lead + one.length <= width || (!Array.isArray(spec) && !isObj(spec))) return one;
  const pad = ' '.repeat(indent + 2);
  const close = ' '.repeat(indent);
  if (Array.isArray(spec)) return `[\n${spec.map((x) => pad + formatSpec(x, indent + 2, width)).join(',\n')}\n${close}]`;
  const entries = Object.entries(spec as Obj).map(([k, x]) => {
    const key = `${JSON.stringify(k)}: `;
    return pad + key + formatSpec(x, indent + 2, width, key.length);
  });
  return `{\n${entries.join(',\n')}\n${close}}`;
}

/** Starting points for writing a spec by hand. */
export const TEMPLATES: Record<'graph' | 'region' | 'phase' | 'slope' | 'line', object> = {
  graph: {
    kind: 'graph',
    from: 'y = e^{-t}\\cos(2t)',
    window: { x: [0, 6], y: [-1, 1] },
    axes: { x: 't', y: 'y' },
    curves: [{ expr: 'exp(-t)*cos(2t)', label: 'y(t)' }],
  },
  region: {
    kind: 'region',
    from: '\\int_0^1 (\\sqrt{x} - x^2)\\,dx',
    top: 'sqrt(x)',
    bottom: 'x^2',
    slice: { at: 0.5, label: 'Δx' },
    markIntersections: true,
  },
  phase: {
    kind: 'phase',
    from: "x' = y,\\; y' = -2x - 3y",
    system: { x: 'y', y: '-2x - 3y' },
    window: { x: [-3, 3], y: [-3, 3] },
    show: ['field', 'equilibria'],
    trajectories: [{ start: [2, 0] }],
  },
  slope: {
    kind: 'slope',
    from: "y' = t - y",
    slope: 't - y',
    window: { x: [-3, 3], y: [-3, 3] },
    show: ['field', 'isoclines'],
    solutions: [{ start: [0, 1] }],
  },
  line: {
    kind: 'line',
    from: 's^2 + 2s + 5 = 0',
    poles: [[-1, 2], [-1, -2]],
    roc: { gt: -1 },
  },
};
