/**
 * Computed accessible descriptions (`alt.short`, `alt.long`, and MathJax `alt.markdown`)
 * generated strictly from EvaluatedScene facts (Redraw v2).
 */
import { list, num, pt } from '../describe.ts';
import { say } from '../nice.ts';
import { lineText } from '../phase.ts';
import { mathifyAlt } from '../describe.ts';
import type { EvaluatedDiagram, EvaluatedPlot, EvaluatedScene } from './evaluate.ts';
import { plainLabel } from './mathSvg.ts';

function wrapTex(s: string): string {
  const t = s.trim();
  if (!t) return '';
  return `$${t.replace(/^\$+|\$+$/g, '')}$`;
}

export function describeScene(ev: EvaluatedScene): { short: string; long: string; markdown: string } {
  if (ev.kind === 'diagram') return describeDiagram(ev);
  return describePlot(ev);
}

function describePlot(ev: EvaluatedPlot): { short: string; long: string; markdown: string } {
  const { spec, xWindow, yWindow, axes, curves, shades, fields, flows, marks } = ev;
  const fromClean = spec.from ? plainLabel(spec.from) : '';

  if (spec.space === '1d') {
    const short = marks.signs.length
      ? `Sign chart for ${axes.x}${fromClean ? ` (${fromClean})` : ''}.`
      : `Number line ${axes.x} from ${num(xWindow[0])} to ${num(xWindow[1])}.`;
    const parts: string[] = [`Number line ${axes.x} spanning from ${num(xWindow[0])} to ${num(xWindow[1])}.`];
    if (marks.intervals.length) {
      const desc = marks.intervals.map(
        (it) =>
          `${it.ends[0] === 'open' || it.a === '-inf' ? '(' : '['}${it.a === '-inf' ? '−∞' : num(it.a)}, ` +
          `${it.b === 'inf' ? '∞' : num(it.b)}${it.ends[1] === 'open' || it.b === 'inf' ? ')' : ']'}`,
      );
      parts.push(`Highlighted intervals: ${list(desc)}.`);
    }
    if (marks.signs.length) {
      const words = marks.signs.map(
        (s) =>
          `${s.sign === '+' ? 'positive' : s.sign === '-' ? 'negative' : s.sign === '0' ? 'zero' : 'undefined'} on ` +
          `(${s.a === '-inf' ? '−∞' : num(s.a)}, ${s.b === 'inf' ? '∞' : num(s.b)})`,
      );
      parts.push(`Sign regions on ${axes.x}: ${list(words)}.`);
    }
    const long = parts.join(' ');
    return { short, long, markdown: mathifyAlt(long) };
  }

  let short = '';
  if (fields.length && fields[0].mode === 'vector') short = `Phase plane${fromClean ? ` for ${fromClean}` : ''}.`;
  else if (fields.length && fields[0].mode === 'slope') short = `Slope field${fromClean ? ` for ${fromClean}` : ''}.`;
  else if (shades.length && shades[0].roc) short = `Complex s-plane pole-zero plot${fromClean ? ` for ${fromClean}` : ''}.`;
  else if (shades.length) short = `Region between ${shades[0].hiText} and ${shades[0].loText} from ${num(shades[0].a)} to ${num(shades[0].b)}.`;
  else if (spec.schematic) short = `Schematic comparison of ${list(curves.map((c) => plainLabel(c.layer.label ?? c.text)))}.`;
  else short = `Graph of ${fromClean || list(curves.map((c) => c.text))} for ${axes.x} from ${num(xWindow[0])} to ${num(xWindow[1])}.`;

  const parts: string[] = [
    `Horizontal axis ${axes.x} from ${num(xWindow[0])} to ${num(xWindow[1])}; vertical axis ${axes.y} from ${num(yWindow[0])} to ${num(yWindow[1])}.`,
  ];

  for (const c of curves) {
    const lbl = plainLabel(c.layer.label ?? c.text);
    const styleNote = c.style !== 'solid' ? ` (${c.style})` : '';
    if (c.piecewise) {
      const pieceStrs = c.pieces.map(
        (p) => `${p.text} on ${num(p.on[0])} ${p.ends[0] === 'closed' ? '≤' : '<'} ${axes.x} ${p.ends[1] === 'closed' ? '≤' : '<'} ${num(p.on[1])}`,
      );
      parts.push(`${curves.length === 1 ? 'The graph' : `Curve ${c.n}`}${lbl ? ` ${lbl}` : ''}${styleNote} is piecewise: ${list(pieceStrs)}.`);
    } else {
      parts.push(`${curves.length === 1 ? 'The curve shows' : `Curve ${c.n}:`} ${lbl || c.text}${styleNote}.`);
    }
    if (!spec.schematic) {
      if (c.zeros.length && c.zeros.length <= 4) parts.push(`Zeros at ${axes.x} = ${list(c.zeros.map(num))}.`);
      if (c.maxima.length === 1) parts.push(`Local maximum at ${pt(...c.maxima[0])}.`);
      if (c.minima.length === 1) parts.push(`Local minimum at ${pt(...c.minima[0])}.`);
      for (const j of c.jumps) parts.push(`Jumps from ${num(j.from)} to ${num(j.to)} at ${axes.x} = ${num(j.x)}.`);
      if (c.asymptotes.length) parts.push(`Vertical asymptote${c.asymptotes.length > 1 ? 's' : ''} at ${axes.x} = ${list(c.asymptotes.map(num))}.`);
    }
  }

  for (const sh of shades) {
    if (sh.roc) {
      const conds = [
        ...(sh.roc.gt !== undefined ? [`Re(s) > ${num(sh.roc.gt)}`] : []),
        ...(sh.roc.lt !== undefined ? [`Re(s) < ${num(sh.roc.lt)}`] : []),
      ];
      if (conds.length) parts.push(`Shaded region of convergence: ${conds.join(' and ')}.`);
    } else {
      parts.push(`Shaded region between ${sh.hiText} and ${sh.loText} from ${num(sh.a)} to ${num(sh.b)}.`);
      if (sh.riemannSum !== null && sh.layer.riemann) {
        parts.push(`${sh.layer.riemann.n}-panel ${sh.layer.riemann.rule} approximation sum is ${say(sh.riemannSum)}.`);
      } else if (sh.layer.area) {
        parts.push(`The shaded area is ${say(sh.area)}.`);
      }
      if (sh.slice) parts.push(`Representative slice at ${axes.x} = ${num(sh.slice.at)}.`);
    }
  }

  for (const f of fields) {
    if (f.mode === 'slope') {
      parts.push(`Direction field for ${f.names[1]}′ = ${f.text[0]}.`);
      const iso = f.nullclines[0];
      if (iso?.lines) parts.push(`Zero-isocline (${f.names[1]}′ = 0, dashed) is ${list(iso.lines.map((l) => lineText(l, ...f.names)))}.`);
    } else {
      parts.push(`Phase plane system ${f.names[0]}′ = ${f.text[0]}, ${f.names[1]}′ = ${f.text[1]}.`);
      if (f.equilibria.length) {
        parts.push(
          `Equilibria: ${list(f.equilibria.map((e) => `${pt(...e.at)} (${e.type}, eigenvalues ${e.eigen.text})`))}.`,
        );
      }
    }
  }

  for (const fl of flows) {
    const sx = fl.layer.start;
    parts.push(`Solution through (${String(sx[0])}, ${String(sx[1])}) ${fl.summary}.`);
  }

  if (marks.poles.length) parts.push(`Poles (×) at ${list(marks.poles.map((p) => pt(p.x, p.y)))}.`);
  if (marks.zeros.length) parts.push(`Zeros (○) at ${list(marks.zeros.map((z) => pt(z.x, z.y)))}.`);
  for (const im of marks.impulses) parts.push(`Impulse arrow at ${axes.x} = ${num(im.at)} of height ${num(im.size)}.`);
  for (const ar of marks.arrows) {
    parts.push(
      `Arrow from ${pt(...ar.from)} to ${pt(...ar.to)}${ar.label ? ` labeled ${plainLabel(ar.label)}` : ''}.`,
    );
  }
  const userPts = marks.points.filter((p) => !p.auto);
  if (userPts.length) {
    parts.push(`Marked points: ${list(userPts.map((p) => `${p.fill === 'open' ? 'open' : 'filled'} dot at ${pt(p.x, p.y)}${p.label ? ` (${plainLabel(p.label)})` : ''}`))}.`);
  }

  const long = parts.join(' ');
  let markdown = mathifyAlt(long);
  if (spec.from && !markdown.includes(wrapTex(spec.from))) {
    markdown = `${markdown} Reference formula: ${wrapTex(spec.from)}.`;
  }
  return { short, long, markdown };
}

function describeDiagram(ev: EvaluatedDiagram): { short: string; long: string; markdown: string } {
  const title = ev.spec.title?.trim() || plainLabel(ev.spec.from) || 'System diagram';
  const short = `Diagram: ${title}.`;
  const nodeWords = ev.nodes.map((n) => `${n.shape} ${plainLabel(n.label) || n.id}`);
  const edgeWords = ev.edges.map((e) => {
    const fromN = ev.nodes.find((n) => n.id === e.from);
    const toN = ev.nodes.find((n) => n.id === e.to);
    const l = e.label ? ` labeled ${plainLabel(e.label)}` : '';
    return `${plainLabel(fromN?.label ?? e.from)} to ${plainLabel(toN?.label ?? e.to)} (${e.kind}${l})`;
  });
  const long = `Schematic diagram with ${ev.nodes.length} elements (${list(nodeWords)}). Connections: ${list(edgeWords)}.`;
  const mdEdges = ev.edges.map((e) => {
    const fromN = ev.nodes.find((n) => n.id === e.from);
    const toN = ev.nodes.find((n) => n.id === e.to);
    return `* ${wrapTex(fromN?.label ?? e.from)} → ${wrapTex(toN?.label ?? e.to)}${e.label ? ` (${wrapTex(e.label)})` : ''}`;
  });
  const markdown = `Schematic diagram for ${wrapTex(ev.spec.from || title)}:\n\n${mdEdges.join('\n')}`;
  return { short, long, markdown };
}
