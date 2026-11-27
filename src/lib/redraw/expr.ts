/**
 * A small, safe parser for "calculator syntax" expressions (redraw specs, 2.2 dev).
 *
 *   exp(-t)*cos(3t)    2t^2 - 1    u(t-2)*(t-2)    sqrt(1 - x^2)    sin(pi x)
 *
 * - Operators: + - * / ^ and parentheses. ^ is right-associative and binds tighter
 *   than unary minus, so -t^2 = -(t^2) and e^-t = e^(-t).
 * - Implicit multiplication: 2t, 3(t-1), (t+1)(t-1), 2 pi t, t cos(t).
 * - Functions need parentheses: sin(t), not sin t.
 * - Names: the declared variables, the constants pi and e, and the functions in FUNCS.
 *   log is the natural log (as in ln); log10 and log2 are explicit.
 *   u(x) and H(x) are the unit step: 0 for x < 0, 1 for x >= 0.
 * - No scientific notation (2e-3 is an error, so it can't be misread as 2·e − 3).
 * - Unicode the models like to emit is accepted: − · × π ².
 *
 * Nothing is ever passed to eval or Function; parsing builds a small tree and
 * compile() turns it into nested closures.
 */

export type Node =
  | { type: 'num'; value: number }
  | { type: 'var'; name: string }
  | { type: 'const'; name: 'pi' | 'e' }
  | { type: 'neg'; arg: Node }
  | { type: 'bin'; op: '+' | '-' | '*' | '/' | '^'; a: Node; b: Node; implicit?: boolean }
  | { type: 'call'; fn: string; args: Node[] };

type Fn = (...a: number[]) => number;
export type FnDef = { arity: number; f: Fn };
const step = (x: number) => (x >= 0 ? 1 : 0);

/** Supported functions and their number of arguments. */
export const FUNCS: Record<string, FnDef> = {
  sin: { arity: 1, f: Math.sin },
  cos: { arity: 1, f: Math.cos },
  tan: { arity: 1, f: Math.tan },
  sec: { arity: 1, f: (x) => 1 / Math.cos(x) },
  csc: { arity: 1, f: (x) => 1 / Math.sin(x) },
  cot: { arity: 1, f: (x) => Math.cos(x) / Math.sin(x) },
  asin: { arity: 1, f: Math.asin },
  acos: { arity: 1, f: Math.acos },
  atan: { arity: 1, f: Math.atan },
  arcsin: { arity: 1, f: Math.asin },
  arccos: { arity: 1, f: Math.acos },
  arctan: { arity: 1, f: Math.atan },
  sinh: { arity: 1, f: Math.sinh },
  cosh: { arity: 1, f: Math.cosh },
  tanh: { arity: 1, f: Math.tanh },
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
  u: { arity: 1, f: step },
  H: { arity: 1, f: step },
  min: { arity: 2, f: Math.min },
  max: { arity: 2, f: Math.max },
};

/** Archetype curve shapes used for generic schematic plots such as f(t) vs f(t − c). */
export const SCHEMATIC_FUNCS: Record<string, FnDef> = {
  f: { arity: 1, f: (x) => 0.45 * x + 0.18 * Math.sin(2.4 * x) },
  g: { arity: 1, f: (x) => 0.8 * Math.exp(-0.35 * x) * Math.cos(2 * x) },
};

const CONSTS = { pi: Math.PI, e: Math.E } as const;

export class ExprError extends Error {}

type Tok = { k: 'num'; v: number } | { k: 'name'; v: string } | { k: 'op'; v: string };

function normalize(src: string): string {
  return src
    .replace(/[−–]/g, '-')
    .replace(/[·×⋅]/g, '*')
    .replace(/π/g, ' pi ')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/\*\*/g, '^');
}

/** Splits a run of letters into known names, longest match first ("tcos" -> t, cos). */
function splitName(run: string, vars: readonly string[], funcs: Record<string, FnDef> = FUNCS): string[] {
  const known = [...vars, ...Object.keys(CONSTS), ...Object.keys(funcs)].sort((a, b) => b.length - a.length);
  const out: string[] = [];
  let i = 0;
  while (i < run.length) {
    const hit = known.find((n) => run.startsWith(n, i));
    if (!hit) {
      throw new ExprError(
        `Unknown name “${run}”. Use ${vars.length ? `the variable ${vars.join(', ')}, ` : ''}pi, e, or a function such as sin(…).`,
      );
    }
    out.push(hit);
    i += hit.length;
  }
  return out;
}

function tokenize(src: string, vars: readonly string[], funcs: Record<string, FnDef> = FUNCS): Tok[] {
  const s = normalize(src);
  const toks: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const num = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i));
    if (num && /^[eE][+-]?\d/.test(s.slice(i + num[1].length)))
      throw new ExprError(`Scientific notation isn’t supported: write ${num[1]}*10^… instead of ${num[1]}e….`);
    if (num) {
      toks.push({ k: 'num', v: parseFloat(num[1]) });
      i += num[1].length;
      continue;
    }
    // A name: letters, then digits only if the whole thing is a known name (log10).
    const name = /^[A-Za-z_][A-Za-z_]*(\d+)?/.exec(s.slice(i));
    if (name) {
      let run = name[0];
      if (name[1] && !(run in funcs)) run = run.slice(0, -name[1].length);
      for (const n of splitName(run, vars, funcs)) toks.push({ k: 'name', v: n });
      i += run.length;
      continue;
    }
    if ('+-*/^(),'.includes(c)) {
      toks.push({ k: 'op', v: c });
      i++;
      continue;
    }
    throw new ExprError(`Unexpected character “${c}”.`);
  }
  return toks;
}

/** Parses an expression in the given variables. Throws ExprError with a readable message. */
export function parse(src: string, vars: readonly string[], extraFuncs: Record<string, FnDef> = {}): Node {
  if (!src.trim()) throw new ExprError('The expression is empty.');
  const funcs = Object.keys(extraFuncs).length ? { ...FUNCS, ...extraFuncs } : FUNCS;
  const toks = tokenize(src, vars, funcs);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.k === 'op' && peek()!.v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new ExprError(peek() ? `Expected “${v}” near “${String(peek()!.v)}”.` : `Missing “${v}” at the end.`);
    p++;
  };
  const startsPrimary = () => {
    const t = peek();
    return !!t && (t.k === 'num' || t.k === 'name' || (t.k === 'op' && t.v === '('));
  };

  function expr(): Node {
    let a = term();
    while (isOp('+') || isOp('-')) {
      const op = (toks[p++] as { v: '+' | '-' }).v;
      a = { type: 'bin', op, a, b: term() };
    }
    return a;
  }
  function term(): Node {
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
  function unary(): Node {
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
  function power(): Node {
    const base = primary();
    if (isOp('^')) {
      p++;
      return { type: 'bin', op: '^', a: base, b: unary() };
    }
    return base;
  }
  function primary(): Node {
    const t = peek();
    if (!t) throw new ExprError('The expression ends too soon.');
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
        if (!isOp('(')) throw new ExprError(`Write ${t.v}(…) with parentheses.`);
        p++;
        const args = [expr()];
        while (isOp(',')) {
          p++;
          args.push(expr());
        }
        expect(')');
        const want = funcs[t.v].arity;
        if (args.length !== want) throw new ExprError(`${t.v}(…) takes ${want} argument${want > 1 ? 's' : ''}.`);
        return { type: 'call', fn: t.v, args };
      }
      if (t.v === 'pi' || t.v === 'e') return { type: 'const', name: t.v };
      return { type: 'var', name: t.v };
    }
    throw new ExprError(`Unexpected “${t.v}”.`);
  }

  const tree = expr();
  if (p < toks.length) throw new ExprError(`Unexpected “${String(toks[p].v)}”.`);
  return tree;
}

export type Env = Record<string, number>;
export type Compiled = (env: Env) => number;

function hasVar(n: Node): boolean {
  switch (n.type) {
    case 'var':
      return true;
    case 'num':
    case 'const':
      return false;
    case 'neg':
      return hasVar(n.arg);
    case 'bin':
      return hasVar(n.a) || hasVar(n.b);
    case 'call':
      return n.args.some(hasVar);
  }
}

/** Turns a tree into a fast evaluator (nested closures; no eval). */
export function compile(n: Node, extraFuncs: Record<string, FnDef> = {}): Compiled {
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
      const a = compile(n.arg, extraFuncs);
      return (env) => -a(env);
    }
    case 'bin': {
      const a = compile(n.a, extraFuncs);
      const b = compile(n.b, extraFuncs);
      switch (n.op) {
        case '+':
          return (env) => a(env) + b(env);
        case '-':
          return (env) => a(env) - b(env);
        case '*':
          return (env) => a(env) * b(env);
        case '/':
          return (env) => a(env) / b(env);
        case '^':
          // Real odd roots ((−8)^(1/3) = −2) only for constant exponents: x^x stays NaN for x < 0.
          return hasVar(n.b) ? (env) => Math.pow(a(env), b(env)) : (env) => realPow(a(env), b(env));
      }
      throw new ExprError(`Unknown operator.`);
    }
    case 'call': {
      const f = (extraFuncs[n.fn] ?? FUNCS[n.fn]).f;
      const args = n.args.map((a) => compile(a, extraFuncs));
      if (args.length === 1) {
        const [x] = args;
        return (env) => f(x(env));
      }
      return (env) => f(...args.map((g) => g(env)));
    }
  }
}

/** x^y with real odd roots of negatives: (-8)^(1/3) = -2, as students expect. */
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

/** Parses and compiles a one-variable expression into f(x). */
export function fn1(src: string, v: string): (x: number) => number {
  const g = compile(parse(src, [v]));
  const env: Env = { [v]: 0 };
  return (x) => {
    env[v] = x;
    return g(env);
  };
}

/** True when the expression has no variable in it (e.g. "0", "2pi"). */
export const isConstantExpr = (n: Node) => !hasVar(n);

/* ---------------- readable text (alt text, labels) ---------------- */

const PREC: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, neg: 3, '^': 4 };

/**
 * Plain-text math for alt text: e^(−t)·cos(3t), (t − 2)·u(t − 2), sqrt(1 − x^2).
 * `names` renames variables for display (x → θ when the axis is labeled θ).
 */
export function toText(n: Node, names?: Record<string, string>): string {
  const toText_ = (m: Node) => toText(m, names);
  const prec = (m: Node) => (m.type === 'bin' ? PREC[m.op] : m.type === 'neg' ? PREC.neg : 9);
  const wrap = (m: Node, min: number) => (prec(m) < min ? `(${toText_(m)})` : toText_(m));
  switch (n.type) {
    case 'num':
      return String(n.value);
    case 'const':
      return n.name === 'pi' ? 'π' : 'e';
    case 'var':
      return names?.[n.name] ?? n.name;
    case 'neg':
      return `−${wrap(n.arg, PREC.neg + 1)}`;
    case 'call': {
      if (n.fn === 'exp') {
        const x = n.args[0];
        return `e^${x.type === 'num' || x.type === 'var' ? toText_(x) : `(${toText_(x)})`}`;
      }
      return `${n.fn}(${n.args.map(toText_).join(', ')})`;
    }
    case 'bin': {
      if (n.op === '^') {
        const base = wrap(n.a, 5);
        const exp = n.b.type === 'num' || n.b.type === 'var' || n.b.type === 'const' ? toText_(n.b) : `(${toText_(n.b)})`;
        return `${base}^${exp}`;
      }
      if (n.op === '*') {
        // (1/2)t, not 1/2·t, which reads like 1/(2t).
        const left = n.a.type === 'bin' && n.a.op === '/' ? `(${toText_(n.a)})` : wrap(n.a, 2);
        const right = wrap(n.b, 3);
        // 3t, 2π, 3cos(t), 2πt, (t + 1)(t − 1): juxtapose after a number, or where the
        // author did (except before a function name: t·cos(t)); otherwise a dot.
        const coef = n.a.type === 'num' || (n.a.type === 'neg' && n.a.arg.type === 'num');
        const juxt = n.b.type !== 'num' && (coef || (!!n.implicit && n.b.type !== 'call'));
        return juxt ? `${left}${right}` : `${left}·${right}`;
      }
      if (n.op === '/') return `${wrap(n.a, 2)}/${wrap(n.b, 3)}`;
      const sym = n.op === '-' ? ' − ' : ' + ';
      return `${wrap(n.a, 1)}${sym}${wrap(n.b, n.op === '-' ? 2 : 1)}`;
    }
  }
}
