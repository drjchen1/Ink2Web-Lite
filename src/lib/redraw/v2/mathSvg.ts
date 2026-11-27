/**
 * Pure SVG Math Box typesetter (zero DOM, Node + Browser identical).
 * Turns LaTeX/plain math labels into tight SVG `<text>`, `<line .../>`, and `<path .../>`
 * fragments with accurate bounding boxes (stacked \frac bars, \sqrt radicals, super/subscripts,
 * calligraphic \mathcal{L}, and Greek letters). Every self-closing element ends with "/>".
 */
import { groupEnd } from '../../transcript.ts';

export interface MathBox {
  width: number;
  height: number;
  ascent: number;
  descent: number;
  render: (x: number, yBaseline: number, color?: string) => string;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const FONT = `font-family="'Times New Roman', Times, serif"`;

const SYMBOLS: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'θ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ',
  tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ',
  Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  infty: '∞', pm: '±', mp: '∓', le: '≤', leq: '≤', ge: '≥', geq: '≥',
  ne: '≠', neq: '≠', approx: '≈', to: '→', rightarrow: '→', leftarrow: '←',
  leftrightarrow: '↔', cdot: '·', times: '×', div: '÷', partial: '∂',
};

const UPRIGHT_FUNCS = new Set([
  'sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'asin', 'acos', 'atan',
  'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'ln', 'log',
  'exp', 'lim', 'max', 'min', 'Re', 'Im', 'det',
]);

type MNode =
  | { k: 'row'; items: MNode[] }
  | { k: 'sym'; text: string; italic: boolean; pad?: number }
  | { k: 'frac'; num: MNode; den: MNode }
  | { k: 'sqrt'; body: MNode }
  | { k: 'script'; base: MNode; sup?: MNode; sub?: MNode };

function stripOuterDollar(s: string): string {
  const t = s.trim();
  if (t.startsWith('$$') && t.endsWith('$$')) return t.slice(2, -2).trim();
  if (t.startsWith('$') && t.endsWith('$') && t.length >= 2) return t.slice(1, -1).trim();
  return t;
}

function parseTexNodes(input: string): MNode {
  const s = stripOuterDollar(input)
    .replace(/\\left|\\right/g, '')
    .replace(/\\(?:displaystyle|textstyle)/g, '')
    .replace(/\\[,;!]|\\quad|\\qquad/g, ' ');
  let i = 0;

  const readArg = (): MNode => {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) return { k: 'sym', text: '', italic: false };
    if (s[i] === '{') {
      const end = groupEnd(s, i);
      if (end > i) {
        const inner = s.slice(i + 1, end - 1);
        i = end;
        return parseTexNodes(inner);
      }
    }
    return readAtom();
  };

  const readAtom = (): MNode => {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) return { k: 'sym', text: '', italic: false };
    if (s[i] === '{') {
      const end = groupEnd(s, i);
      if (end > i) {
        const inner = s.slice(i + 1, end - 1);
        i = end;
        return parseTexNodes(inner);
      }
    }
    if (s[i] === '\\') {
      if (s[i + 1] === '{' || s[i + 1] === '}' || s[i + 1] === '|') {
        const ch = s[i + 1];
        i += 2;
        return { k: 'sym', text: ch, italic: false };
      }
      const cmd = /^\\([A-Za-z]+)/.exec(s.slice(i));
      if (!cmd) {
        i++;
        return { k: 'sym', text: '', italic: false };
      }
      const name = cmd[1];
      i += cmd[0].length;
      if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
        const num = readArg();
        const den = readArg();
        return { k: 'frac', num, den };
      }
      if (name === 'sqrt') {
        if (s[i] === '[') {
          const close = s.indexOf(']', i);
          if (close > i) i = close + 1;
        }
        return { k: 'sqrt', body: readArg() };
      }
      if (name === 'mathcal') {
        while (i < s.length && /\s/.test(s[i])) i++;
        if (s[i] === '{') {
          const end = groupEnd(s, i);
          if (end > i) {
            const inner = s.slice(i + 1, end - 1).trim();
            i = end;
            return { k: 'sym', text: inner === 'L' ? 'ℒ' : inner === 'F' ? 'ℱ' : inner, italic: false };
          }
        }
      }
      if (name === 'text' || name === 'textrm' || name === 'mbox' || name === 'mathrm' || name === 'mathbf') {
        while (i < s.length && /\s/.test(s[i])) i++;
        if (s[i] === '{') {
          const end = groupEnd(s, i);
          if (end > i) {
            const inner = s.slice(i + 1, end - 1);
            i = end;
            return { k: 'sym', text: inner, italic: false };
          }
        }
      }
      if (name in SYMBOLS) {
        const glyph = SYMBOLS[name];
        const pad = '≤≥≠≈→←↔·×'.includes(glyph) ? 2.5 : 0;
        return { k: 'sym', text: glyph, italic: false, pad };
      }
      if (UPRIGHT_FUNCS.has(name)) return { k: 'sym', text: name, italic: false, pad: 1 };
      return { k: 'sym', text: name, italic: false };
    }

    // Plain ASCII characters
    const c = s[i];
    if ('+-=<>≤≥≠≈'.includes(c)) {
      i++;
      return { k: 'sym', text: c === '-' ? '−' : c, italic: false, pad: 2.2 };
    }
    if ('0123456789.,()[]|/:!′°'.includes(c)) {
      const m = /^[0-9.,]+/.exec(s.slice(i));
      if (m) {
        i += m[0].length;
        return { k: 'sym', text: m[0], italic: false };
      }
      i++;
      return { k: 'sym', text: c, italic: false };
    }
    const word = /^[A-Za-z]+/.exec(s.slice(i));
    if (word) {
      i += word[0].length;
      if (UPRIGHT_FUNCS.has(word[0])) return { k: 'sym', text: word[0], italic: false, pad: 1 };
      if (word[0].length === 1) return { k: 'sym', text: word[0], italic: true };
      return { k: 'sym', text: word[0], italic: false };
    }
    i++;
    return { k: 'sym', text: c, italic: false };
  };

  const items: MNode[] = [];
  while (i < s.length) {
    if (/\s/.test(s[i])) {
      i++;
      continue;
    }
    let node = readAtom();
    let sup: MNode | undefined;
    let sub: MNode | undefined;
    for (;;) {
      while (i < s.length && s[i] === ' ') i++;
      if (s[i] === '^' && !sup) {
        i++;
        sup = readArg();
      } else if (s[i] === '_' && !sub) {
        i++;
        sub = readArg();
      } else break;
    }
    if (sup || sub) node = { k: 'script', base: node, sup, sub };
    items.push(node);
  }
  return items.length === 1 ? items[0] : { k: 'row', items };
}

function charWidth(ch: string, size: number, italic: boolean): number {
  if ('iIl1.,|!′·'.includes(ch)) return size * 0.34;
  if ('mwMWℒℱ∑∞'.includes(ch)) return size * 0.78;
  if ('()[]'.includes(ch)) return size * 0.36;
  return size * (italic ? 0.56 : 0.52);
}

function textWidth(s: string, size: number, italic: boolean): number {
  let w = 0;
  for (const ch of s) w += charWidth(ch, size, italic);
  return w;
}

function boxOf(node: MNode, size: number): MathBox {
  if (node.k === 'sym') {
    const pad = node.pad ?? 0;
    const w = textWidth(node.text, size, node.italic) + pad * 2;
    const ascent = size * 0.78;
    const descent = size * 0.24;
    return {
      width: w,
      ascent,
      descent,
      height: ascent + descent,
      render: (x, yBase, color = '#1a1a1a') => {
        if (!node.text) return '';
        const st = node.italic ? ' font-style="italic"' : '';
        return `<text x="${r1(x + pad)}" y="${r1(yBase)}" font-size="${r1(size)}"${st} fill="${color}" ${FONT}>${esc(node.text)}</text>`;
      },
    };
  }

  if (node.k === 'row') {
    const boxes = node.items.map((it) => boxOf(it, size));
    let width = 0;
    let ascent = size * 0.75;
    let descent = size * 0.22;
    for (const b of boxes) {
      width += b.width;
      ascent = Math.max(ascent, b.ascent);
      descent = Math.max(descent, b.descent);
    }
    return {
      width,
      ascent,
      descent,
      height: ascent + descent,
      render: (x, yBase, color) => {
        let cx = x;
        return boxes
          .map((b) => {
            const out = b.render(cx, yBase, color);
            cx += b.width;
            return out;
          })
          .join('');
      },
    };
  }

  if (node.k === 'script') {
    const base = boxOf(node.base, size);
    const sSize = Math.max(8, size * 0.72);
    const sup = node.sup ? boxOf(node.sup, sSize) : null;
    const sub = node.sub ? boxOf(node.sub, sSize) : null;
    const extraW = Math.max(sup?.width ?? 0, sub?.width ?? 0);
    const ascent = Math.max(base.ascent, sup ? size * 0.42 + sup.ascent : 0);
    const descent = Math.max(base.descent, sub ? size * 0.28 + sub.descent : 0);
    return {
      width: base.width + extraW,
      ascent,
      descent,
      height: ascent + descent,
      render: (x, yBase, color) => {
        const parts = [base.render(x, yBase, color)];
        if (sup) parts.push(sup.render(x + base.width, yBase - size * 0.42, color));
        if (sub) parts.push(sub.render(x + base.width, yBase + size * 0.28, color));
        return parts.join('');
      },
    };
  }

  if (node.k === 'frac') {
    const fSize = Math.max(8.5, size * 0.78);
    const num = boxOf(node.num, fSize);
    const den = boxOf(node.den, fSize);
    const barW = Math.max(num.width, den.width) + 4;
    const axis = size * 0.32;
    const gap = 2.5;
    const ascent = axis + gap + num.ascent + num.descent;
    const descent = Math.max(0, den.ascent + den.descent + gap - axis);
    return {
      width: barW + 2,
      ascent,
      descent,
      height: ascent + descent,
      render: (x, yBase, color = '#1a1a1a') => {
        const midY = yBase - axis;
        const numY = midY - gap - num.descent;
        const denY = midY + gap + den.ascent;
        const nx = x + 1 + (barW - num.width) / 2;
        const dx = x + 1 + (barW - den.width) / 2;
        return (
          `<line x1="${r1(x + 1)}" y1="${r1(midY)}" x2="${r1(x + 1 + barW)}" y2="${r1(midY)}" stroke="${color}" stroke-width="1"/>` +
          num.render(nx, numY, color) +
          den.render(dx, denY, color)
        );
      },
    };
  }

  // sqrt
  const body = boxOf(node.body, size);
  const radW = size * 0.65;
  const ascent = body.ascent + 3;
  const descent = body.descent;
  return {
    width: radW + body.width + 2,
    ascent,
    descent,
    height: ascent + descent,
    render: (x, yBase, color = '#1a1a1a') => {
      const topY = yBase - body.ascent - 1.5;
      const botY = yBase + Math.max(1, body.descent * 0.35);
      const midY = (topY + botY) / 2 + 1;
      const vx = x + radW * 0.55;
      const rx = x + radW;
      const endX = rx + body.width + 1.5;
      return (
        `<path d="M${r1(x + 1)},${r1(midY)}L${r1(vx)},${r1(botY)}L${r1(rx)},${r1(topY)}L${r1(endX)},${r1(topY)}" fill="none" stroke="${color}" stroke-width="1.15" stroke-linejoin="round"/>` +
        body.render(rx + 1, yBase, color)
      );
    },
  };
}

/** Measures and builds an SVG renderer for a math or short prose/math label. */
export function measureAndRenderMath(tex: string, size = 14, defaultColor = '#1a1a1a'): MathBox {
  const trimmed = stripOuterDollar(tex);
  if (!trimmed) {
    return { width: 0, height: size, ascent: size * 0.78, descent: size * 0.22, render: () => '' };
  }
  const hasTexOrSimpleMath = /\\|[_^]|\|/.test(trimmed) || /^[A-Za-z0-9().,+\-−=<>≤≥≈'\s/]+$/.test(trimmed);
  if (!hasTexOrSimpleMath) {
    // Plain prose text fallback (e.g. "unstable saddle" or free caption text)
    const w = textWidth(trimmed, size, false);
    const ascent = size * 0.78;
    const descent = size * 0.24;
    return {
      width: w,
      ascent,
      descent,
      height: ascent + descent,
      render: (x, yBase, color = defaultColor) =>
        `<text x="${r1(x)}" y="${r1(yBase)}" font-size="${r1(size)}" fill="${color}" ${FONT}>${esc(trimmed)}</text>`,
    };
  }
  const baseBox = boxOf(parseTexNodes(trimmed), size);
  return {
    ...baseBox,
    render: (x, yBase, color = defaultColor) => baseBox.render(x, yBase, color),
  };
}

/** Readable plain-words version of a TeX label for `<desc>` and alt text. */
export function plainLabel(tex: string): string {
  let s = stripOuterDollar(tex)
    .replace(/\\mathcal\s*\{\s*L\s*\}/g, 'L')
    .replace(/\\(?:d|t)?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '$1/$2')
    .replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)')
    .replace(/\\(?:left|right|quad|qquad|[,;!])/g, ' ')
    .replace(/\\(?:text|textrm|mbox|mathrm)\s*\{([^{}]*)\}/g, '$1')
    .replace(/\\([A-Za-z]+)/g, (_, c: string) => SYMBOLS[c] ?? c)
    .replace(/\{([^{}]*)\}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  s = s.replace(/-/g, '−');
  return s;
}
