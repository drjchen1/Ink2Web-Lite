import type { AnnotationStyle, Box } from '../types.ts';

/** Pure helpers for cleaning model output and editing the page source. No DOM access. */

/**
 * Removes wrappers small models like to add (code fences, think blocks, chatter) and
 * repairs common slips. With the "notes" annotation style, arrows and braces the model
 * still drew inside an equation are moved out into [[note: term | words]] lines.
 */
export function cleanModelOutput(raw: string, style: AnnotationStyle = 'notes'): string {
  let t = raw.replace(/\r\n?/g, '\n');
  t = t.replace(/<think>[\s\S]*?<\/think>/gi, '');
  // Drop a leading "Here is the transcription:"-style line.
  t = t.replace(/^\s*(here is|here's|below is|sure)[^\n]*:\s*\n/i, '');
  // Unwrap a code fence around the whole answer (closing fence may be missing if cut off).
  const fence = t.match(/^\s*```[a-zA-Z]*[ \t]*\n([\s\S]*?)(?:\n```\s*)?$/);
  if (fence) t = fence[1];
  // Normalize LaTeX delimiters to $ / $$ so there is one canonical form for editing.
  // Trim the contents: some models write "\( x \)", and "$ x $" would not count as math
  // (an opening $ followed by a space is text, so "$5 and $10" stays text).
  t = t.replace(/(?<!\\)\\\[([\s\S]*?)(?<!\\)\\\]/g, (_, m: string) => `$$${m.trim()}$$`);
  t = t.replace(/(?<!\\)\\\(([\s\S]*?)(?<!\\)\\\)/g, (_, m: string) => `$${m.trim()}$`);
  t = normalizeColorMarkup(t);
  t = unwrapTextMath(t);
  t = mergeArrowNotes(t);
  t = promoteEquationLines(t);
  if (style === 'notes') t = annotationsToNotes(t);
  return t.replace(/\n{3,}/g, '\n\n').trim();
}

const COLOR_NAMES = 'red|green|orange|purple|blue';

/* ------------------------------------------------------------------------------------
 * Arrow and brace notes
 * ---------------------------------------------------------------------------------- */

/** Index just past the balanced {...} group that opens at `open` (or -1). */
function groupEnd(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '\\') i++;
    else if (s[i] === '{') depth++;
    else if (s[i] === '}' && --depth === 0) return i + 1;
  }
  return -1;
}

/** Plain content of an annotation label: arrows, \substack, \text and line breaks removed. */
export function cleanLabel(label: string): string {
  let t = label;
  for (let i = 0; i < 3; i++) t = t.replace(/\\(?:substack|mathclap|text|textrm|mbox|mathrm|scriptsize)\s*\{([^{}]*)\}/g, '$1');
  return t
    .replace(/\\(?:uparrow|downarrow|leftarrow|rightarrow|nearrow|nwarrow|searrow|swarrow|Uparrow|Downarrow)\b/g, ' ')
    .replace(/[↑↓←→↖↗↘↙]/g, ' ')
    .replace(/\\\\/g, ' ')
    .replace(/^\s*\{|\}\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface Annotation {
  target: string;
  label: string;
}

/**
 * Removes \underset, \overset, \underbrace and \overbrace from a LaTeX expression,
 * keeping the annotated term, and returns the notes that were attached.
 */
export function extractAnnotations(tex: string): { tex: string; notes: Annotation[] } {
  const notes: Annotation[] = [];
  let s = tex;
  const cmd = /\\(underset|overset|stackrel|underbrace|overbrace)\s*\{/;
  for (let guard = 0; guard < 50; guard++) {
    const m = cmd.exec(s);
    if (!m) break;
    const open1 = m.index + m[0].length - 1;
    const end1 = groupEnd(s, open1);
    if (end1 < 0) break;
    const first = s.slice(open1 + 1, end1 - 1);
    let target: string;
    let label = '';
    let end = end1;
    if (m[1] === 'underbrace' || m[1] === 'overbrace') {
      target = first;
      const after = s.slice(end1).match(/^\s*[_^]\s*\{/);
      if (after) {
        const open2 = end1 + after[0].length - 1;
        const end2 = groupEnd(s, open2);
        if (end2 > 0) {
          label = s.slice(open2 + 1, end2 - 1);
          end = end2;
        }
      }
    } else {
      // \underset{LABEL}{term}, \overset{LABEL}{term}, \stackrel{LABEL}{term}
      const after = s.slice(end1).match(/^\s*\{/);
      if (!after) break;
      const open2 = end1 + after[0].length - 1;
      const end2 = groupEnd(s, open2);
      if (end2 < 0) break;
      label = first;
      target = s.slice(open2 + 1, end2 - 1);
      end = end2;
    }
    const clean = cleanLabel(label);
    if (clean) notes.push({ target: target.trim(), label: clean });
    s = s.slice(0, m.index) + target + s.slice(end);
  }
  return { tex: s, notes };
}

const noteLine = (n: Annotation) => `[[note: ${n.target} | ${n.label}]]`;

/**
 * "Notes" style: arrows and braces drawn inside math are taken out of the equation
 * and listed as [[note: term | words]] lines right after the line that held them.
 */
export function annotationsToNotes(md: string): string {
  // Display math first (may span lines); notes go right after the closing $$.
  let t = md.replace(/\$\$([\s\S]+?)\$\$/g, (whole, inner: string) => {
    const { tex, notes } = extractAnnotations(inner);
    if (!notes.length && tex === inner) return whole;
    return `$$${tex}$$${notes.length ? `\n${notes.map(noteLine).join('\n')}` : ''}`;
  });
  // Inline math: notes after the line.
  t = t
    .split('\n')
    .map((line) => {
      if (/^\s*\[\[\s*note/i.test(line)) return line;
      const notes: Annotation[] = [];
      const out = line.replace(/(?<!\$)\$(?!\$)([^$\n]+?)(?<!\$)\$(?!\$)/g, (whole, inner: string) => {
        const r = extractAnnotations(inner);
        notes.push(...r.notes);
        return r.tex === inner ? whole : `$${r.tex.trim()}$`;
      });
      return notes.length ? `${out}\n${notes.map(noteLine).join('\n')}` : out;
    })
    .join('\n');
  return t;
}

/**
 * Models sometimes write colored text as HTML instead of the [[red: ...]] form the
 * prompt asks for. Convert the common shapes so they still render (and escape safely).
 */
export function normalizeColorMarkup(md: string): string {
  return md
    .replace(
      new RegExp(`<span\\s+style\\s*=\\s*["']\\s*color\\s*:\\s*(${COLOR_NAMES})\\s*;?\\s*["']\\s*>([\\s\\S]*?)<\\/span>`, 'gi'),
      (_, c: string, body: string) => `[[${c.toLowerCase()}: ${body.trim()}]]`,
    )
    .replace(
      new RegExp(`<font\\s+color\\s*=\\s*["']?(${COLOR_NAMES})["']?\\s*>([\\s\\S]*?)<\\/font>`, 'gi'),
      (_, c: string, body: string) => `[[${c.toLowerCase()}: ${body.trim()}]]`,
    );
}

const ARROWS = '↑↓←→↖↗↘↙⟵⟶';
const ARROW_LINE = new RegExp(`^\\s*[${ARROWS}]\\s*(.*)$`);

/**
 * Small models often copy an arrow note the way it looks on the page: the arrow on
 * one line and the note, word by word, on the next lines ("↑" / "new" / "amplitude").
 * That reads as nonsense, and a line like "- sin(δ)" even becomes a bullet point.
 * This joins each run of arrow lines and their short note lines into one note line,
 * shown in the note style: [[note: ↑ new amplitude · ← phase shift]].
 */
export function mergeArrowNotes(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  const short = (l: string) => {
    const t = l.trim();
    return t.length > 0 && t.length <= 24 && !t.includes('=') && !t.includes('$$') && t.split(/\s+/).length <= 2 && !/^#|^\[\[/.test(t);
  };
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(ARROW_LINE);
    if (!m) {
      out.push(lines[i]);
      continue;
    }
    const segments: string[] = [];
    let seg = `${lines[i].trim().charAt(0)} ${m[1].trim()}`.trim();
    while (i + 1 < lines.length) {
      const next = lines[i + 1];
      const arrow = next.match(ARROW_LINE);
      if (arrow) {
        segments.push(seg);
        seg = `${next.trim().charAt(0)} ${arrow[1].trim()}`.trim();
        i++;
      } else if (short(next)) {
        seg += ` ${next.trim()}`;
        i++;
      } else break;
    }
    segments.push(seg);
    out.push(`[[note: ${segments.join(' · ')}]]`);
  }
  return out.join('\n');
}

const GREEK_MAP: Record<string, string> = {
  α: '\\alpha', β: '\\beta', γ: '\\gamma', δ: '\\delta', ε: '\\varepsilon', θ: '\\theta', λ: '\\lambda',
  μ: '\\mu', π: '\\pi', ρ: '\\rho', σ: '\\sigma', τ: '\\tau', φ: '\\phi', ω: '\\omega', Δ: '\\Delta', Ω: '\\Omega',
};
const FUNCS = 'sin|cos|tan|sec|csc|cot|ln|log|exp';
const FUNC_WORDS = new Set(FUNCS.split('|').concat(['tan^{-1}']));

/** Converts a plain-text equation ("u(t) = Rcos(7t - δ)") to LaTeX. */
export function plainToTex(line: string): string {
  let t = line.replace(/\$+/g, '');
  t = t.replace(/[αβγδεθλμπρσφωΔΩτ]/g, (g) => `${GREEK_MAP[g]} `);
  t = t.replace(new RegExp(`(?<!\\\\)(${FUNCS})(?=\\s*[(\\\\{^])`, 'g'), '\\$1');
  t = t.replace(/·|×/g, '\\cdot ').replace(/≤/g, '\\le ').replace(/≥/g, '\\ge ').replace(/≠/g, '\\ne ').replace(/→/g, '\\to ');
  t = t.replace(/\s{3,}/g, ' \\qquad ');
  return t.replace(/\s+/g, ' ').replace(/ \)/g, ')').trim();
}

/**
 * Lines that are clearly a standalone equation (they contain "=" and no words other
 * than function names) but were written without $$...$$ are turned into display math,
 * so they render as math and screen readers read them as math. Lines that mix words
 * and math are left as written.
 */
export function promoteEquationLines(md: string): string {
  let inDisplay = false;
  return md
    .split('\n')
    .map((line) => {
      const dd = (line.match(/\$\$/g) ?? []).length;
      if (inDisplay || dd) {
        if (dd % 2 === 1) inDisplay = !inDisplay;
        return line;
      }
      const t = line.trim();
      if (!t.includes('=') || /^(#|- |\d+[.)] |>|\||\[\[)/.test(t) || /\\begin|<u>/.test(t)) return line;
      // Words, ignoring math inside $...$, LaTeX commands and function names.
      const outside = t
        .replace(/\$[^$]*\$/g, ' ')
        .replace(/\\[a-zA-Z]+/g, ' ')
        .replace(new RegExp(`(${FUNCS})(?=\\s*[(^])`, 'g'), ' ');
      const words = (outside.match(/[A-Za-z]{2,}/g) ?? []).filter((w) => !FUNC_WORDS.has(w.toLowerCase()));
      if (words.length) return line;
      return `$$${plainToTex(t)}$$`;
    })
    .join('\n');
}

/** Reads a balanced {...} group starting at `open` (the index of "{"). */
function braced(s: string, open: number): { body: string; end: number } | null {
  const end = groupEnd(s, open);
  return end < 0 ? null : { body: s.slice(open + 1, end - 1), end };
}

/**
 * Turns one row of a display-math block into prose if it is mostly \text{...}.
 * "&\text{due to the weight, the spring lengthens by } L" -> "due to the weight, the spring lengthens by $L$".
 * Returns null if the row is real math.
 */
function textRow(row: string): string | null {
  const r = row.replace(/(^|[^\\])&/g, '$1').trim();
  if (!r) return '';
  const parts: { text: boolean; s: string }[] = [];
  let i = 0;
  let mathBuf = '';
  while (i < r.length) {
    const m = r.slice(i).match(/^\\(?:text|textrm|mbox|textit|mathrm)\s*\{/);
    if (m) {
      const g = braced(r, i + m[0].length - 1);
      if (!g) return null;
      if (mathBuf.trim()) parts.push({ text: false, s: mathBuf.trim() });
      mathBuf = '';
      parts.push({ text: true, s: g.body });
      i = g.end;
    } else mathBuf += r[i++];
  }
  if (mathBuf.trim()) parts.push({ text: false, s: mathBuf.trim() });
  const textLen = parts.filter((p) => p.text).reduce((n, p) => n + p.s.trim().length, 0);
  const mathLen = parts.filter((p) => !p.text).reduce((n, p) => n + p.s.length, 0);
  if (!textLen || textLen < mathLen * 2) return null;
  return parts
    .map((p) => (p.text ? p.s : ` $${p.s.replace(/^[.,;:]+|[.,;:]+$/g, '')}$ `))
    .join('')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
}

/**
 * Annotation commands: \text inside these is a label on the math (a brace note, an
 * arrow note), not prose, so blocks containing them are never unwrapped.
 */
const ANNOTATION = /\\(?:underbrace|overbrace|underset|overset|stackrel|boxed|substack|xrightarrow|xleftarrow)\b/;

/**
 * Small models sometimes wrap ordinary sentences in display math
 * ($$\begin{aligned}&\text{...}\\&\text{...}\end{aligned}$$ or $\text{...}$).
 * Screen readers then read prose as math. This puts the sentences back as text
 * lines; blocks that contain real equations or annotations are left alone.
 */
export function unwrapTextMath(md: string): string {
  let t = md.replace(/\$\$([\s\S]+?)\$\$/g, (whole, inner: string) => {
    if (!/\\(?:text|textrm|mbox)\s*\{/.test(inner) || ANNOTATION.test(inner)) return whole;
    const body = inner
      .replace(/\\begin\{(aligned|align\*?|gathered|gather\*?|array)\}(\{[^}]*\})?/g, '')
      .replace(/\\end\{(aligned|align\*?|gathered|gather\*?|array)\}/g, '');
    const rows = body.split(/\\\\(?:\[[^\]]*\])?/);
    const lines = rows.map(textRow);
    if (lines.some((l) => l === null)) return whole;
    return `\n${(lines as string[]).filter((l) => l).join('\n')}\n`;
  });
  // Inline math that is only text: "$\text{if we do nothing}$" -> "if we do nothing".
  t = t.replace(/(?<!\$)\$\s*\\(?:text|textrm|mbox)\s*\{([^{}$]*)\}\s*\$(?!\$)/g, '$1');
  return t;
}

/**
 * Detects degenerate repetition (a known failure mode of small VLMs at temperature 0).
 * Returns true when the tail of the text is the same chunk repeated many times.
 */
export function isLooping(text: string): boolean {
  if (text.length < 400) return false;
  const tail = text.slice(-1200);
  for (let p = 8; p <= 300; p++) {
    const reps = Math.floor(tail.length / p);
    if (reps < 4) break;
    const unit = tail.slice(-p);
    if (!unit.trim()) continue;
    let count = 1;
    while (count < reps && tail.slice(-(count + 1) * p, -count * p) === unit) count++;
    if (count >= (p < 40 ? 8 : 4)) return true;
  }
  return false;
}

/** Collapses a repeated tail down to a single copy. */
export function trimRepetition(text: string): string {
  for (let p = 8; p <= 300; p++) {
    const unit = text.slice(-p);
    if (!unit.trim()) continue;
    let end = text.length;
    let count = 0;
    while (end - p >= 0 && text.slice(end - p, end) === unit) {
      end -= p;
      count++;
    }
    if (count >= 3) return text.slice(0, end + p).trimEnd();
  }
  return text;
}

/**
 * A figure description is always on one line: [[FIGURE: graph of u(t)]].
 *
 * Small models sometimes drop a closing bracket ("[[FIGURE: graph of u(t)]").
 * Matching up to the next "]]" anywhere would then swallow the following lines
 * (often the sentence written right after the drawing) into the alt text. So a
 * description ends at "]]" on its own line, or at the end of that line, with one
 * stray "]" removed.
 */
const FIGURE_START = /\[\[\s*FIGURE\s*:/gi;
export const MARKER_LINE = /^\s*\[\[\s*FIGURE\s+(\d+)\s*\]\]\s*$/i;

/** Words that end a quoted-text clause: "written beside it", "next to the graph", ... */
const PLACE =
  String.raw`(?:\s*(?:is\s+|are\s+)?(?:written|shown|placed|located|appearing|noted)?\s*(?:beside|next\s+to|to\s+the\s+(?:right|left)\s+of|right\s+of|left\s+of|below|above|under|near|alongside)\s+(?:it|the\s+(?:graph|figure|drawing|diagram|plot|sketch|curve|region))?)?`;
/** Words that introduce it: ", with text", "and the text", "with the note", ... */
const INTRO = String.raw`(?:[,;]?\s*(?:and|with)?\s*(?:the\s+)?(?:handwritten\s+)?(?:text|note|sentence|words|caption|annotation)\s*(?:reading|that\s+reads|saying|:)?\s*)`;
const QUOTED = String.raw`(?:"([^"]+)"|“([^”]+)”)`;

/**
 * Small models sometimes copy the sentence written beside a drawing into the
 * drawing's description, in quotes:
 *   graph ..., with text "$\int_a^b f(x)\,dx$ is area of the shaded region." written beside it
 * That sentence belongs to the notes (and alt text should describe the drawing).
 * Quoted text that reads like a sentence (several words, or math with words) is
 * moved out; short quoted labels on the drawing ("labeled \"y\"") stay.
 */
export function splitQuotedText(desc: string): { desc: string; moved: string[] } {
  const moved: string[] = [];
  const isSentence = (q: string) => {
    const words = q.replace(/\$[^$]*\$/g, ' x ').trim().split(/\s+/).filter(Boolean);
    return words.length >= 4 || (q.includes('$') && words.length >= 3);
  };
  const re = new RegExp(`${INTRO}?${QUOTED}${PLACE}`, 'gi');
  const out = desc.replace(re, (whole, a?: string, b?: string) => {
    const q = (a ?? b ?? '').trim();
    if (!isSentence(q)) return whole;
    moved.push(q);
    return '';
  });
  return {
    desc: out.replace(/\s+([,.;])/g, '$1').replace(/^[,;\s]+|[,;\s]+$/g, '').replace(/\s{2,}/g, ' ').trim(),
    moved,
  };
}

/**
 * Replaces [[FIGURE: description]] with numbered markers [[FIGURE n]] on their own
 * lines and returns the descriptions in order. Text after the description on the
 * same line, and sentences the model quoted inside the description, are kept as
 * text after the figure.
 */
export function extractFigures(md: string): { source: string; descriptions: string[] } {
  const descriptions: string[] = [];
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  FIGURE_START.lastIndex = 0;
  while ((m = FIGURE_START.exec(md))) {
    const from = m.index + m[0].length;
    const nl = md.indexOf('\n', from);
    const lineEnd = nl < 0 ? md.length : nl;
    // The closing "]]" on this line, skipping brackets inside the description ("on [0, 1]").
    let close = -1;
    for (let i = from, depth = 0; i < lineEnd; i++) {
      if (md[i] === '[') depth++;
      else if (md[i] === ']') {
        if (depth > 0) depth--;
        else if (md[i + 1] === ']') {
          close = i;
          break;
        }
      }
    }
    let desc: string;
    let next: number;
    if (close >= 0) {
      desc = md.slice(from, close);
      next = close + 2;
    } else {
      // Missing "]]": the description is the rest of the line, minus a stray "]"
      // (only if it is unbalanced, so "on [0, 1]" keeps its bracket).
      desc = md.slice(from, lineEnd).trimEnd();
      const opens = (desc.match(/\[/g) ?? []).length;
      const closes = (desc.match(/\]/g) ?? []).length;
      if (desc.endsWith(']') && closes > opens) desc = desc.slice(0, -1);
      next = lineEnd;
    }
    const split = splitQuotedText(desc.replace(/\s+/g, ' ').trim());
    descriptions.push(split.desc || 'Hand-drawn figure');
    const after = split.moved.length ? `${split.moved.join('\n')}\n` : '';
    out += `${md.slice(last, m.index)}\n\n[[FIGURE ${descriptions.length}]]\n\n${after}`;
    while (md[next] === ' ' || md[next] === '\t') next++; // text after it starts its own line
    last = next;
    FIGURE_START.lastIndex = next;
  }
  out += md.slice(last);
  return { source: tidy(out), descriptions };
}

const tidy = (s: string) => s.replace(/\n{3,}/g, '\n\n').trim();

/** Removes the [[FIGURE id]] markers for the given ids. */
export function removeMarkers(source: string, ids: number[]): string {
  const drop = new Set(ids);
  return tidy(
    source
      .split('\n')
      .filter((l) => {
        const m = l.match(MARKER_LINE);
        return !(m && drop.has(Number(m[1])));
      })
      .join('\n'),
  );
}

/**
 * Splits the source into "units": runs of non-blank lines that must stay together
 * when a figure marker moves (a multi-line $$...$$ block or \begin..\end environment
 * is one unit; any other non-blank line is its own unit).
 */
export function sourceUnits(source: string): { start: number; end: number }[] {
  const lines = source.split('\n');
  const units: { start: number; end: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    let end = i;
    const dollars = (line.match(/\$\$/g) ?? []).length;
    const env = line.match(/\\begin\{([^}]+)\}/);
    if (dollars % 2 === 1) {
      while (end + 1 < lines.length && (lines[++end].match(/\$\$/g) ?? []).length % 2 === 0);
    } else if (env && !line.includes(`\\end{${env[1]}}`)) {
      while (end + 1 < lines.length && !lines[++end].includes(`\\end{${env[1]}}`));
    }
    units.push({ start: i, end });
    i = end;
  }
  return units;
}

/** Moves the [[FIGURE id]] marker one unit up (-1) or down (+1). Returns the source unchanged if it can't move. */
export function moveMarker(source: string, id: number, dir: -1 | 1): string {
  const lines = source.split('\n');
  const units = sourceUnits(source);
  const idx = units.findIndex((u) => u.start === u.end && Number(lines[u.start].match(MARKER_LINE)?.[1]) === id);
  const target = idx + dir;
  if (idx < 0 || target < 0 || target >= units.length) return source;
  const chunks = units.map((u) => lines.slice(u.start, u.end + 1).join('\n'));
  [chunks[idx], chunks[target]] = [chunks[target], chunks[idx]];
  return rebuild(source, units, chunks);
}

/** Inserts a [[FIGURE id]] marker before content unit `index`. */
export function insertMarkerAt(source: string, id: number, index: number): string {
  const lines = source.split('\n');
  const units = sourceUnits(source);
  const chunks = units.map((u) => lines.slice(u.start, u.end + 1).join('\n'));
  const at = Math.max(0, Math.min(index, chunks.length));
  chunks.splice(at, 0, `[[FIGURE ${id}]]`);
  // Blank lines around markers so paragraphs read naturally in the editor.
  return tidy(chunks.map((c) => (MARKER_LINE.test(c) ? `\n${c}\n` : c)).join('\n'));
}

function rebuild(source: string, units: { start: number; end: number }[], chunks: string[]): string {
  // Keep the original blank-line separators between unit slots.
  const lines = source.split('\n');
  const out: string[] = [];
  let cursor = 0;
  units.forEach((u, i) => {
    out.push(...lines.slice(cursor, u.start));
    out.push(chunks[i]);
    cursor = u.end + 1;
  });
  out.push(...lines.slice(cursor));
  return tidy(out.join('\n'));
}

/** Unit index of each figure marker, by id. */
export function markerUnitIndex(source: string): Map<number, number> {
  const lines = source.split('\n');
  const map = new Map<number, number>();
  sourceUnits(source).forEach((u, i) => {
    const m = u.start === u.end ? lines[u.start].match(MARKER_LINE) : null;
    if (m) map.set(Number(m[1]), i);
  });
  return map;
}

/**
 * For each source unit: the figure-marker id it holds, or null for text.
 * Used with figure positions to place new markers in reading order.
 */
export function unitMarkers(source: string): (number | null)[] {
  const lines = source.split('\n');
  return sourceUnits(source).map((u) => {
    const m = u.start === u.end ? lines[u.start].match(MARKER_LINE) : null;
    return m ? Number(m[1]) : null;
  });
}

/**
 * Parses the locate-pass answer. Accepts the requested JSON, but also tolerates
 * models that ignore the schema and emit bare [x1,y1,x2,y2] arrays.
 * Coordinates are in a 1000x1000 letterboxed square; they're mapped back to
 * page-normalized coordinates (page occupies [0, 1000*w/side] x [0, 1000*h/side]).
 */
export function parseBoxes(answer: string, count: number, pageW: number, pageH: number): (Box | null)[] {
  let arrays: number[][] = [];
  try {
    const json = JSON.parse(answer) as { figures?: { id?: number; bbox_2d?: number[] }[] };
    const figs = json.figures ?? [];
    const out: (number[] | undefined)[] = [];
    figs.forEach((f, i) => {
      const idx = typeof f.id === 'number' && f.id >= 1 && f.id <= count ? f.id - 1 : i;
      if (Array.isArray(f.bbox_2d) && f.bbox_2d.length === 4 && !out[idx]) out[idx] = f.bbox_2d;
    });
    arrays = Array.from({ length: count }, (_, i) => out[i] ?? []);
  } catch {
    const found = answer.match(/\[\s*-?\d+(?:\.\d+)?(?:\s*,\s*-?\d+(?:\.\d+)?){3}\s*\]/g) ?? [];
    arrays = found.map((s) => JSON.parse(s) as number[]);
  }

  const side = Math.max(pageW, pageH);
  const maxX = (1000 * pageW) / side;
  const maxY = (1000 * pageH) / side;

  return Array.from({ length: count }, (_, i) => {
    const a = arrays[i];
    if (!a || a.length !== 4 || a.some((v) => !Number.isFinite(v))) return null;
    let [x1, y1, x2, y2] = a;
    // Some models return 0..1 fractions.
    if (Math.max(x1, y1, x2, y2) <= 1.0001) [x1, y1, x2, y2] = [x1, y1, x2, y2].map((v) => v * 1000);
    if (x2 < x1) [x1, x2] = [x2, x1];
    if (y2 < y1) [y1, y2] = [y2, y1];
    const box = clampBox({ x: x1 / maxX, y: y1 / maxY, w: (x2 - x1) / maxX, h: (y2 - y1) / maxY });
    return box.w > 0.02 && box.h > 0.02 ? box : null;
  });
}

export function clampBox(b: Box): Box {
  const x = Math.min(Math.max(b.x, 0), 1);
  const y = Math.min(Math.max(b.y, 0), 1);
  return { x, y, w: Math.min(Math.max(b.w, 0), 1 - x), h: Math.min(Math.max(b.h, 0), 1 - y) };
}

/** Next unused figure id for a page. */
export function nextFigureId(ids: number[]): number {
  return ids.length ? Math.max(...ids) + 1 : 1;
}
