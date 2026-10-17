import type { Box } from '../types.ts';

/** Pure helpers for cleaning model output and editing the page source. No DOM access. */

/** Removes wrappers small models like to add (code fences, think blocks, chatter). */
export function cleanModelOutput(raw: string): string {
  let t = raw.replace(/\r\n?/g, '\n');
  t = t.replace(/<think>[\s\S]*?<\/think>/gi, '');
  // Drop a leading "Here is the transcription:"-style line.
  t = t.replace(/^\s*(here is|here's|below is|sure)[^\n]*:\s*\n/i, '');
  // Unwrap a code fence around the whole answer (closing fence may be missing if cut off).
  const fence = t.match(/^\s*```[a-zA-Z]*[ \t]*\n([\s\S]*?)(?:\n```\s*)?$/);
  if (fence) t = fence[1];
  // Normalize LaTeX delimiters to $ / $$ so there is one canonical form for editing.
  t = t.replace(/(?<!\\)\\\[([\s\S]*?)(?<!\\)\\\]/g, (_, m: string) => `$$${m}$$`);
  t = t.replace(/(?<!\\)\\\(([\s\S]*?)(?<!\\)\\\)/g, (_, m: string) => `$${m}$`);
  t = unwrapTextMath(t);
  return t.replace(/\n{3,}/g, '\n\n').trim();
}

/** Reads a balanced {...} group starting at `open` (the index of "{"). */
function braced(s: string, open: number): { body: string; end: number } | null {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '\\') i++;
    else if (s[i] === '{') depth++;
    else if (s[i] === '}' && --depth === 0) return { body: s.slice(open + 1, i), end: i + 1 };
  }
  return null;
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
 * Small models sometimes wrap ordinary sentences in display math
 * ($$\begin{aligned}&\text{...}\\&\text{...}\end{aligned}$$ or $\text{...}$).
 * Screen readers then read prose as math. This puts the sentences back as text
 * lines; blocks that contain real equations are left alone.
 */
export function unwrapTextMath(md: string): string {
  let t = md.replace(/\$\$([\s\S]+?)\$\$/g, (whole, inner: string) => {
    if (!/\\(?:text|textrm|mbox)\s*\{/.test(inner)) return whole;
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

const FIGURE_DESC = /\[\[\s*FIGURE\s*:\s*([\s\S]*?)\]\]/gi;
export const MARKER_LINE = /^\s*\[\[\s*FIGURE\s+(\d+)\s*\]\]\s*$/i;

/**
 * Replaces [[FIGURE: description]] with numbered markers [[FIGURE n]] on their own
 * lines and returns the descriptions in order.
 */
export function extractFigures(md: string): { source: string; descriptions: string[] } {
  const descriptions: string[] = [];
  const source = md.replace(FIGURE_DESC, (_, d: string) => {
    descriptions.push(d.replace(/\s+/g, ' ').trim() || 'Hand-drawn figure');
    return `\n\n[[FIGURE ${descriptions.length}]]\n\n`;
  });
  return { source: tidy(source), descriptions };
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
