/**
 * Native LaTeX + calculator math expression parser & closure compiler (Redraw v2).
 * Accepts real LaTeX (\frac, \dfrac, \sqrt, \sin^2 t, \tan^{-1}, |x|, u_c(t), \theta,
 * \begin{cases}...\end{cases}) alongside plain calculator syntax. Zero eval().
 */
import { groupEnd } from '../../transcript.ts';
import type { Fill } from '../common.ts';

export class ExprV2Error extends Error {}

export type FnDefV2 = { arity: number; f: (...a: number[]) => number };

const step = (x: number) => (x >= 0 ? 1 : 0);

export const V2_FUNCS: Record<string, FnDefV2> = {
  sin: { arity: 1, f: Math.sin },
  cos: { arity: 1, f: Math.cos },
  tan: { arity: 1, f: Math.tan },
  sec: { arity: 1, f: (x) => 1 / Math.cos(x) },
  csc: { arity: 1, f: (x) => 1 / Math.sin(x) },
  cot: { arity: 1, f: (x) => Math.cos(x) / Math.sin(x) },
  asin: { arity: 1, f: Math.asin },
  acos: { arity: 1, f: Math.acos },
  atan: { arity: 1, f: Math.atan },
  asec: { arity: 1, f: (x) => Math.acos(1 / x) },
  acsc: { arity: 1, f: (x) => Math.asin(1 / x) },
  acot: { arity: 1, f: (x) => Math.atan(1 / x) },
  arcsin: { arity: 1, f: Math.asin },
  arccos: { arity: 1, f: Math.acos },
  arctan: { arity: 1, f: Math.atan },
  sinh: { arity: 1, f: Math.sinh },
  cosh: { arity: 1, f: Math.cosh },
  tanh: { arity: 1, f: Math.tanh },
  asinh: { arity: 1, f: Math.asinh },
  acosh: { arity: 1, f: Math.acosh },
  atanh: { arity: 1, f: Math.atanh },
  exp: { arity: 1, f: Math.exp },
  ln: { arity: 1, f: Math.log },
  log: { arity: 1, f: Math.log },
  log10: { arity: 1, f: Math.log10 },
  log2: { arity: 1, f: Math.log2 },
  sqrt: { arity: 1, f: Math.sqrt },
  cbrt: { arity: 1, f: Math.cbrt },
  abs: { arity: 1, f: Math.abs },
  sign: { arity: 1, f: Math.sign },
  floor: { arity: 1, f: Math.floor },
  ceil: { arity: 1, f: Math.ceil },
  sinc: { arity: 1, f: (x) => (Math.abs(x) < 1e-8 ? 1 : Math.sin(x) / x) },
  u: { arity: 1, f: step },
  H: { arity: 1, f: step },
  min: { arity: 2, f: Math.min },
  max: { arity: 2, f: Math.max },
};

export const SCHEMATIC_V2_FUNCS: Record<string, FnDefV2> = {
  f: { arity: 1, f: (x) => 0.45 * x + 0.18 * Math.sin(2.4 * x) },
  g: { arity: 1, f: (x) => 0.8 * Math.exp(-0.35 * x) * Math.cos(2 * x) },
};

const CONSTS = { pi: Math.PI, e: Math.E } as const;

const GREEK_WORDS = [
  ['theta', 'theta'],
  ['omega', 'omega'],
  ['alpha', 'alpha'],
  ['beta', 'beta'],
  ['gamma', 'gamma'],
  ['delta', 'delta'],
  ['sigma', 'sigma'],
  ['tau', 'tau'],
  ['phi', 'phi'],
  ['psi', 'psi'],
  ['rho', 'rho'],
  ['mu', 'mu'],
  ['lambda', 'lambda'],
  ['pi', 'pi'],
] as const;

const FN_NAMES_RE = '(?:arcsin|arccos|arctan|asinh|acosh|atanh|sinh|cosh|tanh|sin|cos|tan|sec|csc|cot|asin|acos|atan|asec|acsc|acot|exp|log10|log2|log|ln|sqrt|cbrt|abs|sign|floor|ceil|sinc|min|max)';

/** Replaces braced LaTeX commands (\frac, \dfrac, \tfrac, \sqrt, u_c(t)) iteratively inside-out. */
function expandBracedTex(input: string): string {
  let s = input;
  for (let pass = 0; pass < 16; pass++) {
    let changed = false;

    // \frac{A}{B}, \dfrac{A}{B}, \tfrac{A}{B}
    const fracRe = /\\(?:d|t)?frac\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = fracRe.exec(s))) {
      const o1 = m.index + m[0].length - 1;
      const e1 = groupEnd(s, o1);
      if (e1 < 0) break;
      const rest = s.slice(e1).match(/^\s*\{/);
      if (!rest) break;
      const o2 = e1 + rest[0].length - 1;
      const e2 = groupEnd(s, o2);
      if (e2 < 0) break;
      const num = s.slice(o1 + 1, e1 - 1).trim();
      const den = s.slice(o2 + 1, e2 - 1).trim();
      s = `${s.slice(0, m.index)}((${num})/(${den}))${s.slice(e2)}`;
      changed = true;
      break;
    }
    if (changed) continue;

    // \sqrt[n]{A} and \sqrt{A}
    const sqrtRe = /\\sqrt(?:\s*\[([^\]]+)\])?\s*\{/g;
    if ((m = sqrtRe.exec(s))) {
      const open = m.index + m[0].length - 1;
      const end = groupEnd(s, open);
      if (end > open) {
        const body = s.slice(open + 1, end - 1).trim();
        const repl = m[1] ? `((${body})^(1/(${m[1].trim()})))` : `sqrt(${body})`;
        s = `${s.slice(0, m.index)}${repl}${s.slice(end)}`;
        continue;
      }
    }

    // \operatorname{name}, \mathrm{name}
    const opRe = /\\(?:operatorname|mathrm|textrm)\s*\{([^{}]*)\}/;
    if (opRe.test(s)) {
      s = s.replace(opRe, '$1');
      continue;
    }
    break;
  }
  return s;
}

/**
 * Strips leading equation LHS ("y = ", "f(t) = ") when followed by an expression,
 * and translates LaTeX notation into normalized calculator syntax.
 */
export function preprocessLatex(raw: string): string {
  let s = raw
    .replace(/\$/g, '')
    .replace(/\\left\s*\|/g, '|')
    .replace(/\\right\s*\|/g, '|')
    .replace(/\\lvert/g, '|')
    .replace(/\\rvert/g, '|')
    .replace(/\\left|\\right|\\displaystyle|\\textstyle/g, '')
    .replace(/\\[,;!]|\\quad|\\qquad/g, ' ')
    .replace(/[−–]/g, '-')
    .replace(/[·×⋅]|\\cdot|\\times/g, '*')
    .replace(/\*\*/g, '^')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/π/g, ' pi ')
    .replace(/θ/g, ' theta ')
    .replace(/ω/g, ' omega ')
    .replace(/α/g, ' alpha ')
    .replace(/β/g, ' beta ')
    .replace(/γ/g, ' gamma ')
    .replace(/δ/g, ' delta ');

  for (const [cmd, name] of GREEK_WORDS) {
    s = s.replace(new RegExp(`\\\\${cmd}\\b`, 'g'), ` ${name} `);
  }

  s = expandBracedTex(s);

  // Paired |expr| -> abs(expr)
  for (let pass = 0; pass < 8; pass++) {
    const next = s.replace(/\|([^|]+)\|/g, 'abs($1)');
    if (next === s) break;
    s = next;
  }

  // Unit step: u_c(t) / u_{c}(t) / H_c(t) -> u((t) - (c))
  s = s.replace(
    /\b([uH])_(?:\{([^{}]+)\}|([A-Za-z0-9.]+))\s*\(([^()]+)\)/g,
    (_, fn: string, g1?: string, g2?: string, arg?: string) => {
      const c = (g1 ?? g2 ?? '').trim();
      return c === '0' ? `${fn}(${arg})` : `${fn}((${arg}) - (${c}))`;
    },
  );

  // Strip backslashes before known functions.
  s = s.replace(new RegExp(`\\\\(${FN_NAMES_RE})\\b`, 'g'), '$1');

  // Inverse trig written as sin^{-1}(x) or tan^-1 x
  s = s.replace(
    /\b(sin|cos|tan|sec|csc|cot|sinh|cosh|tanh)\s*\^\s*(?:\{\s*-1\s*\}|-1|\(\s*-1\s*\))\s*(\([^()]+\)|[A-Za-z0-9]+)/g,
    (_, fn: string, arg: string) => `a${fn}(${arg.startsWith('(') ? arg.slice(1, -1) : arg})`,
  );

  // Trig powers written as \sin^2(t), sin^2 t, cos^{3}(2t)
  s = s.replace(
    /\b(sin|cos|tan|sec|csc|cot|sinh|cosh|tanh)\s*\^\s*(?:\{([^{}]+)\}|(\d+))\s*(\([^()]+\)|[A-Za-z0-9]+(?:\s*\*\s*[A-Za-z0-9]+)?)/g,
    (_, fn: string, p1: string | undefined, p2: string | undefined, arg: string) => {
      const p = (p1 ?? p2 ?? '').trim();
      const inner = arg.startsWith('(') && arg.endsWith(')') ? arg.slice(1, -1) : arg;
      return `(${fn}(${inner}))^(${p})`;
    },
  );

  // Convert remaining {...} to (...) after powers (e^{-t} -> e^(-t))
  s = s.replace(/[{}]/g, (ch) => (ch === '{' ? '(' : ')'));

  // Bare function arguments without parens: "sin t" or "sin 2t" -> "sin(2t)"
  s = s.replace(
    new RegExp(`\\b(${FN_NAMES_RE})\\s+(?!\\()([0-9]*[A-Za-z_][A-Za-z0-9_]*)`, 'g'),
    '$1($2)',
  );

  return s.replace(/\s+/g, ' ').trim();
}

export function stripLeadingLhs(expr: string): string {
  return expr.replace(/^\s*[A-Za-zθω]\s*(?:\([^()]*\))?\s*=\s*/, '').trim();
}

export type NodeV2 =
  | { type: 'num'; value: number }
  | { type: 'var'; name: string }
  | { type: 'const'; name: 'pi' | 'e' }
  | { type: 'neg'; arg: NodeV2 }
  | { type: 'bin'; op: '+' | '-' | '*' | '/' | '^'; a: NodeV2; b: NodeV2; implicit?: boolean }
  | { type: 'call'; fn: string; args: NodeV2[] };

type Tok = { k: 'num'; v: number } | { k: 'name'; v: string } | { k: 'op'; v: string };

function splitName(run: string, vars: readonly string[], funcs: Record<string, FnDefV2>): string[] {
  const known = [...vars, ...Object.keys(CONSTS), ...Object.keys(funcs)].sort((a, b) => b.length - a.length);
  const out: string[] = [];
  let i = 0;
  while (i < run.length) {
    const hit = known.find((n) => run.startsWith(n, i));
    if (!hit) {
      throw new ExprV2Error(
        `Unknown name “${run}”. Use ${vars.length ? `variable ${vars.join(', ')}, ` : ''}pi, e, or a function such as sin(…).`,
      );
    }
    out.push(hit);
    i += hit.length;
  }
  return out;
}

function tokenize(src: string, vars: readonly string[], funcs: Record<string, FnDefV2>): Tok[] {
  const s = preprocessLatex(src);
  const toks: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const num = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i));
    if (num && /^[eE][+-]?\d/.test(s.slice(i + num[1].length))) {
      throw new ExprV2Error(`Scientific notation isn’t supported: write ${num[1]}*10^… instead of ${num[1]}e….`);
    }
    if (num) {
      toks.push({ k: 'num', v: parseFloat(num[1]) });
      i += num[1].length;
      continue;
    }
    const name = /^[A-Za-z_][A-Za-z_]*(\d+)?/.exec(s.slice(i));
    if (name) {
      let run = name[0];
      if (name[1] && !(run in funcs) && !vars.includes(run)) run = run.slice(0, -name[1].length);
      for (const n of splitName(run, vars, funcs)) toks.push({ k: 'name', v: n });
      i += run.length;
      continue;
    }
    if ('+-*/^(),'.includes(c)) {
      toks.push({ k: 'op', v: c });
      i++;
      continue;
    }
    throw new ExprV2Error(`Unexpected character “${c}”.`);
  }
  return toks;
}

export function parseLatexToNode(src: string, vars: readonly string[], extraFuncs: Record<string, FnDefV2> = {}): NodeV2 {
  if (!src.trim()) throw new ExprV2Error('The expression is empty.');
  const funcs = Object.keys(extraFuncs).length ? { ...V2_FUNCS, ...extraFuncs } : V2_FUNCS;
  const toks = tokenize(src, vars, funcs);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.k === 'op' && peek()!.v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new ExprV2Error(peek() ? `Expected “${v}” near “${String(peek()!.v)}”.` : `Missing “${v}” at the end.`);
    p++;
  };
  const startsPrimary = () => {
    const t = peek();
    return !!t && (t.k === 'num' || t.k === 'name' || (t.k === 'op' && t.v === '('));
  };

  function expr(): NodeV2 {
    let a = term();
    while (isOp('+') || isOp('-')) {
      const op = (toks[p++] as { v: '+' | '-' }).v;
      a = { type: 'bin', op, a, b: term() };
    }
    return a;
  }
  function term(): NodeV2 {
    let a = unary();
    for (;;) {
      if (isOp('*') || isOp('/')) {
        const op = (toks[p++] as { v: '*' | '/' }).v;
        a = { type: 'bin', op, a, b: unary() };
      } else if (startsPrimary()) {
        a = { type: 'bin', op: '*', a, b: power(), implicit: true };
      } else return a;
    }
  }
  function unary(): NodeV2 {
    if (isOp('-')) {
      p++;
      return { type: 'neg', arg: unary() };
    }
    if (isOp('+')) {
      p++;
      return unary();
    }
    return power();
  }
  function power(): NodeV2 {
    const base = primary();
    if (isOp('^')) {
      p++;
      return { type: 'bin', op: '^', a: base, b: unary() };
    }
    return base;
  }
  function primary(): NodeV2 {
    const t = peek();
    if (!t) throw new ExprV2Error('The expression ends too soon.');
    if (t.k === 'num') {
      p++;
      return { type: 'num', value: t.v };
    }
    if (t.k === 'op' && t.v === '(') {
      p++;
      const e = expr();
      expect(')');
      return e;
    }
    if (t.k === 'name') {
      p++;
      if (t.v in funcs && !vars.includes(t.v)) {
        if (!isOp('(')) throw new ExprV2Error(`Write ${t.v}(…) with parentheses.`);
        p++;
        const args = [expr()];
        while (isOp(',')) {
          p++;
          args.push(expr());
        }
        expect(')');
        const want = funcs[t.v].arity;
        if (args.length !== want) throw new ExprV2Error(`${t.v}(…) takes ${want} argument${want > 1 ? 's' : ''}.`);
        return { type: 'call', fn: t.v, args };
      }
      if (t.v === 'pi' || t.v === 'e') return { type: 'const', name: t.v };
      return { type: 'var', name: t.v };
    }
    throw new ExprV2Error(`Unexpected “${t.v}”.`);
  }

  const tree = expr();
  if (p < toks.length) throw new ExprV2Error(`Unexpected “${String(toks[p].v)}”.`);
  return tree;
}

function realPow(x: number, y: number): number {
  if (x >= 0 || Number.isInteger(y)) return Math.pow(x, y);
  for (let q = 3; q <= 15; q += 2) {
    const pq = y * q;
    if (Math.abs(pq - Math.round(pq)) < 1e-9) {
      const r = Math.pow(-x, y);
      return Math.round(pq) % 2 === 0 ? r : -r;
    }
  }
  return NaN;
}

const hasVar = (n: NodeV2): boolean =>
  n.type === 'var'
    ? true
    : n.type === 'num' || n.type === 'const'
      ? false
      : n.type === 'neg'
        ? hasVar(n.arg)
        : n.type === 'bin'
          ? hasVar(n.a) || hasVar(n.b)
          : n.args.some(hasVar);

export type CompiledV2 = (env: Record<string, number>) => number;

export function compileV2(n: NodeV2, extraFuncs: Record<string, FnDefV2> = {}): CompiledV2 {
  switch (n.type) {
    case 'num': {
      const v = n.value;
      return () => v;
    }
    case 'const': {
      const v = CONSTS[n.name];
      return () => v;
    }
    case 'var': {
      const name = n.name;
      return (env) => env[name];
    }
    case 'neg': {
      const a = compileV2(n.arg, extraFuncs);
      return (env) => -a(env);
    }
    case 'bin': {
      const a = compileV2(n.a, extraFuncs);
      const b = compileV2(n.b, extraFuncs);
      switch (n.op) {
        case '+':
          return (env) => a(env) + b(env);
        case '-':
          return (env) => a(env) - b(env);
        case '*':
          return (env) => {
            const v = a(env) * b(env);
            return Object.is(v, -0) ? 0 : v;
          };
        case '/':
          return (env) => a(env) / b(env);
        case '^':
          return hasVar(n.b) ? (env) => Math.pow(a(env), b(env)) : (env) => realPow(a(env), b(env));
      }
      throw new ExprV2Error('Unknown operator.');
    }
    case 'call': {
      const fn = (extraFuncs[n.fn] ?? V2_FUNCS[n.fn]).f;
      const args = n.args.map((a) => compileV2(a, extraFuncs));
      if (args.length === 1) {
        const [x] = args;
        return (env) => fn(x(env));
      }
      return (env) => fn(...args.map((g) => g(env)));
    }
  }
}

const PREC: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, neg: 3, '^': 4 };

export function toTextV2(n: NodeV2, names?: Record<string, string>): string {
  const rec = (m: NodeV2) => toTextV2(m, names);
  const prec = (m: NodeV2) => (m.type === 'bin' ? PREC[m.op] : m.type === 'neg' ? PREC.neg : 9);
  const wrap = (m: NodeV2, min: number) => (prec(m) < min ? `(${rec(m)})` : rec(m));
  switch (n.type) {
    case 'num':
      return String(n.value);
    case 'const':
      return n.name === 'pi' ? 'π' : 'e';
    case 'var':
      return names?.[n.name] ?? n.name;
    case 'neg':
      return `−${wrap(n.arg, PREC.neg + 1)}`;
    case 'call':
      if (n.fn === 'exp') {
        const x = n.args[0];
        return `e^${x.type === 'num' || x.type === 'var' ? rec(x) : `(${rec(x)})`}`;
      }
      return `${n.fn}(${n.args.map(rec).join(', ')})`;
    case 'bin': {
      if (n.op === '^') {
        const base = wrap(n.a, 5);
        const exp = n.b.type === 'num' || n.b.type === 'var' || n.b.type === 'const' ? rec(n.b) : `(${rec(n.b)})`;
        return `${base}^${exp}`;
      }
      if (n.op === '*') {
        const left = n.a.type === 'bin' && n.a.op === '/' ? `(${rec(n.a)})` : wrap(n.a, 2);
        const right = wrap(n.b, 3);
        const coef = n.a.type === 'num' || (n.a.type === 'neg' && n.a.arg.type === 'num');
        const juxt = n.b.type !== 'num' && (coef || (!!n.implicit && n.b.type !== 'call'));
        return juxt ? `${left}${right}` : `${left}·${right}`;
      }
      if (n.op === '/') return `${wrap(n.a, 2)}/${wrap(n.b, 3)}`;
      return `${wrap(n.a, 1)}${n.op === '-' ? ' − ' : ' + '}${wrap(n.b, n.op === '-' ? 2 : 1)}`;
    }
  }
}

export interface CompiledLatex1 {
  expr: string;
  text: string;
  f: (x: number) => number;
  constant: boolean;
  schematicUsed: boolean;
}

export function compileLatexExpr(
  raw: string,
  vars: readonly string[],
  params: Record<string, number> = {},
  schematic = false,
): CompiledLatex1 {
  const cleaned = stripLeadingLhs(raw);
  const varList = [...vars, ...Object.keys(params)];
  const useSchematic =
    schematic || (/\b[fg]\s*\(/.test(cleaned) && !varList.includes('f') && !varList.includes('g'));
  const extra = useSchematic ? SCHEMATIC_V2_FUNCS : {};
  const tree = parseLatexToNode(cleaned, varList, extra);
  const g = compileV2(tree, extra);
  const mainVar = vars[0] ?? 'x';
  const env: Record<string, number> = { ...params, [mainVar]: 0 };
  return {
    expr: raw.trim(),
    text: toTextV2(tree),
    f: (x: number) => {
      env[mainVar] = x;
      return g(env);
    },
    constant: !hasVar(tree),
    schematicUsed: useSchematic,
  };
}

export function compileLatex2(
  raw: string,
  vx: string,
  vy: string,
  params: Record<string, number> = {},
  names?: [string, string],
): { text: string; f: (x: number, y: number) => number } {
  const varList = [vx, vy, ...Object.keys(params)];
  const tree = parseLatexToNode(raw, varList);
  const g = compileV2(tree);
  const env: Record<string, number> = { ...params, [vx]: 0, [vy]: 0 };
  const rename = names ? { [vx]: names[0], [vy]: names[1] } : undefined;
  return {
    text: toTextV2(tree, rename),
    f: (x: number, y: number) => {
      env[vx] = x;
      env[vy] = y;
      return g(env);
    },
  };
}

/** Evaluates a bound token (number, "pi/2", "c", "-inf", "inf", "∞"). */
export function evalBound(val: string | number, params: Record<string, number> = {}): number | '-inf' | 'inf' | null {
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;
  const s = val.trim().replace(/\\infty/g, 'inf').replace(/∞/g, 'inf').replace(/[−–]/g, '-');
  if (!s) return null;
  if (/^-inf$/i.test(s)) return '-inf';
  if (/^\+?inf$/i.test(s)) return 'inf';
  try {
    const paramNames = Object.keys(params);
    const n = compileV2(parseLatexToNode(s, paramNames))(params);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export interface ParsedPiece {
  expr: string;
  on: [number | '-inf', number | 'inf'];
  ends: [Fill | null, Fill | null];
}

function parseCondition(
  condRaw: string,
  params: Record<string, number>,
): { on: [number | '-inf', number | 'inf']; ends: [Fill | null, Fill | null] } | null {
  const c = condRaw
    .replace(/\\(?:text|textrm|mbox)\s*\{([^{}]*)\}/g, ' $1 ')
    .replace(/\b(if|for|when)\b/gi, '')
    .replace(/\\leq?/g, '<=')
    .replace(/≤/g, '<=')
    .replace(/\\geq?/g, '>=')
    .replace(/≥/g, '>=')
    .replace(/−/g, '-')
    .trim();

  if (/^(?:otherwise|else)$/i.test(c)) return { on: ['-inf', 'inf'], ends: [null, null] };

  // Two-sided: "a <= t < b" or "a < t <= b"
  const two = c.match(/^(.+?)\s*(<=|<)\s*[A-Za-zθω]+\s*(<=|<)\s*(.+)$/);
  if (two) {
    const lo = evalBound(two[1], params);
    const hi = evalBound(two[4], params);
    if (lo !== null && hi !== null && lo !== 'inf' && hi !== '-inf') {
      return { on: [lo, hi], ends: [two[2] === '<=' ? 'closed' : 'open', two[3] === '<=' ? 'closed' : 'open'] };
    }
  }

  // One-sided: "t < 1", "t >= 3", "1 <= t"
  const oneRight = c.match(/^[A-Za-zθω]+\s*(<=|<|>=|>)\s*(.+)$/);
  if (oneRight) {
    const op = oneRight[1];
    const b = evalBound(oneRight[2], params);
    if (b === null || b === 'inf' || b === '-inf') return null;
    const fill: Fill = op === '<=' || op === '>=' ? 'closed' : 'open';
    return op.startsWith('<') ? { on: ['-inf', b], ends: [null, fill] } : { on: [b, 'inf'], ends: [fill, null] };
  }
  const oneLeft = c.match(/^(.+?)\s*(<=|<|>=|>)\s*[A-Za-zθω]+$/);
  if (oneLeft) {
    const op = oneLeft[2];
    const b = evalBound(oneLeft[1], params);
    if (b === null || b === 'inf' || b === '-inf') return null;
    const fill: Fill = op === '<=' || op === '>=' ? 'closed' : 'open';
    return op.startsWith('>') ? { on: ['-inf', b], ends: [null, fill] } : { on: [b, 'inf'], ends: [fill, null] };
  }
  return null;
}

/**
 * Extracts piecewise intervals from `\begin{cases}...\end{cases}` if present;
 * otherwise returns null so the caller evaluates as a single expression.
 */
export function parseCasesExpr(raw: string, params: Record<string, number> = {}): ParsedPiece[] | null {
  const m = stripLeadingLhs(raw).match(/^\\begin\{cases\}([\s\S]+)\\end\{cases\}$/);
  if (!m) return null;
  const rows = m[1]
    .split(/\\\\(?:\[[^\]]*\])?/)
    .map((r) => r.trim())
    .filter(Boolean);
  if (!rows.length) return null;
  const out: ParsedPiece[] = [];
  for (const row of rows) {
    const parts = row.split('&').map((p) => p.trim());
    const exprPart = parts[0] ?? '';
    const condPart = parts.slice(1).join(' ');
    if (!exprPart || !condPart) return null;
    const parsedCond = parseCondition(condPart, params);
    if (!parsedCond) return null;
    out.push({ expr: exprPart.replace(/,\s*$/, '').trim(), ...parsedCond });
  }
  return out.length ? out : null;
}
