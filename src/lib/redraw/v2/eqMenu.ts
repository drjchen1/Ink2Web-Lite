/**
 * Equation Menu extractor (Redraw v2): pulls nearby equations from `page.source` around
 * `>>> THIS FIGURE <<<` so small models can reference `@eq1`, `@eq2`, ... accurately instead
 * of re-transcribing complex LaTeX inside a nested JSON spec.
 */

export interface EqItem {
  id: number;
  tex: string;
}

const isTrivial = (tex: string) => {
  const t = tex.replace(/\s+/g, '').trim();
  if (t.length <= 2) return true;
  if (/^[A-Za-z0-9.,()]+$/.test(t) && t.length <= 5 && !/[=<>]/.test(t)) return true;
  return false;
};

export function extractEquationMenu(notes: string, maxItems = 6): EqItem[] {
  const lines = notes.split('\n');
  const markIdx = lines.findIndex((l) => l.includes('>>> THIS FIGURE <<<'));
  const targetLine = markIdx >= 0 ? markIdx : Math.floor(lines.length / 2);

  interface Cand {
    tex: string;
    score: number;
    pos: number;
  }
  const cands: Cand[] = [];
  const lineOffsets: number[] = [];
  let acc = 0;
  for (const l of lines) {
    lineOffsets.push(acc);
    acc += l.length + 1;
  }
  const targetChar = lineOffsets[targetLine] ?? 0;

  const push = (rawTex: string, idx: number, display: boolean) => {
    const tex = rawTex.replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim();
    if (!tex || isTrivial(tex) || tex.length > 260) return;
    const dist = Math.abs(idx - targetChar);
    const beforeBoost = idx <= targetChar ? 120 : 0;
    const casesBoost = /\\begin\{cases\}|=/.test(tex) ? 80 : 0;
    const dispBoost = display ? 60 : 0;
    cands.push({ tex, score: 1000 - Math.min(dist, 900) + beforeBoost + casesBoost + dispBoost, pos: idx });
  };

  for (const m of notes.matchAll(/\$\$([\s\S]+?)\$\$/g)) push(m[1], m.index!, true);
  for (const m of notes.matchAll(/(?<!\$)\$(?!\$)([^$\n]+?)(?<!\$)\$(?!\$)/g)) push(m[1], m.index!, false);

  cands.sort((a, b) => b.score - a.score || a.pos - b.pos);
  const seen = new Set<string>();
  const out: EqItem[] = [];
  for (const c of cands) {
    const key = c.tex.replace(/\s+/g, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: out.length + 1, tex: c.tex });
    if (out.length >= maxItems) break;
  }
  return out;
}

export function formatEqMenuForPrompt(menu: EqItem[]): string {
  if (!menu.length) return '';
  return `Numbered equations from nearby notes (reference as @eq1, @eq2, ...):\n${menu.map((e) => `@eq${e.id}: ${e.tex}`).join('\n')}`;
}

export function expandEqRefs(text: string, menu: EqItem[]): string {
  if (!menu.length) return text;
  const map = new Map(menu.map((e) => [e.id, e.tex]));
  return text.replace(/(?:@eq|\[Eq\s+)(\d+)\]?/gi, (whole, n: string) => map.get(Number(n)) ?? whole);
}
