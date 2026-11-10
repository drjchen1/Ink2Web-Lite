/**
 * Figure lab (2.2 dev): a developer page for trying redraw specs by hand.
 * Run `npm run dev` and open http://localhost:5173/figure-lab.html
 */
import { redraw, type Facts } from './lib/redraw/index.ts';
import { EXAMPLES } from './lib/redraw/examples.ts';
import { nice } from './lib/redraw/nice.ts';
import { boundaryName } from './lib/redraw/region.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const specEl = $<HTMLTextAreaElement>('spec');
const exampleEl = $<HTMLSelectElement>('example');
const preview = $('preview');
const messages = $('messages');
const altShort = $('alt-short');
const altLong = $('alt-long');
const factsEl = $('facts');
const copyBtn = $<HTMLButtonElement>('copy');
const copied = $('copied');

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const n = (v: number) => nice(v).text;
const pt = ([x, y]: [number, number]) => `(${n(x)}, ${n(y)})`;
const STORE = 'ink2web-lite:figure-lab';

EXAMPLES.forEach((e, i) => exampleEl.add(new Option(e.name, String(i))));
exampleEl.add(new Option('(your own)', 'own'));

let lastSvg = '';

function box(kind: 'error' | 'warning', title: string, items: string[]): string {
  return `<div class="${kind}"><strong>${esc(title)}</strong><ul>${items.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></div>`;
}

const table = (head: string[], rows: string[][]) =>
  `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>` +
  rows.map((r) => `<tr>${r.map((c, i) => (i ? `<td>${esc(c || '—')}</td>` : `<th scope="row">${esc(c)}</th>`)).join('')}</tr>`).join('') +
  `</tbody></table>`;

function factsHtml(f: Facts): string {
  if (f.kind === 'phase') {
    const [vx, vy] = f.spec.names;
    const eqRows = f.equilibria.map((e) => [
      pt(e.at),
      e.type,
      e.eigen.text,
      `[${e.J.map((r) => r.map(n).join(', ')).join('; ')}]`,
    ]);
    const fate = (t: (typeof f.trajectories)[number]['forward']) => {
      if (!t) return '';
      switch (t.kind) {
        case 'equilibrium':
          return `→ ${pt(f.equilibria[t.eq].at)}`;
        case 'exits':
          return `${t.side} edge`;
        case 'closed':
          return `closed (${t.turn})`;
        case 'circles':
          return `circling (${t.turn})`;
        case 'stops':
          return `stops at ${pt(t.at)}`;
        case 'stays':
          return 'stays inside';
      }
    };
    const trRows = f.trajectories.map((t) => [String(t.t.n), pt(t.t.start), fate(t.backward), fate(t.forward)]);
    const ncl = f.nullclines.map(
      (c) => `${c.which ? vy : vx}′ = 0: ${c.lines ? c.lines.length + ' line(s)' : c.segments.length ? 'curve(s)' : 'none in the window'}`,
    );
    return (
      (eqRows.length ? table(['Equilibrium', 'Type', 'Eigenvalues', 'Jacobian'], eqRows) : '<p>No equilibrium in the window.</p>') +
      (trRows.length ? table(['Trajectory', 'Start', 'Backward', 'Forward'], trRows) : '') +
      (ncl.length ? `<p>${esc(ncl.join('; '))}.</p>` : '') +
      `<p class="hint">${f.linear ? 'Linear system. ' : ''}Window: ${esc(vx)} from ${n(f.xWindow[0])} to ${n(f.xWindow[1])}, ` +
      `${esc(vy)} from ${n(f.yWindow[0])} to ${n(f.yWindow[1])}${f.spec.window.x && f.spec.window.y ? '' : ' (automatic)'}.</p>`
    );
  }
  if (f.kind === 'graph') {
    const rows = f.curves.map((c) => [
      String(c.curve.n),
      c.zeros.map(n).join(', '),
      [...c.maxima.map((p) => `max ${pt(p)}`), ...c.minima.map((p) => `min ${pt(p)}`)].join('; '),
      c.jumps.map((j) => `${n(j.x)}: ${n(j.from)} → ${n(j.to)}`).join('; '),
      c.asymptotes.map(n).join(', '),
      c.gaps.map(([p, q]) => `${n(p)} to ${n(q)}`).join('; '),
    ]);
    return (
      table(['Curve', 'Zeros', 'Turning points', 'Jumps', 'Asymptotes', 'Undefined'], rows) +
      `<p class="hint">Window: ${esc(f.spec.v)} from ${n(f.spec.window.x[0])} to ${n(f.spec.window.x[1])}, ` +
      `y from ${n(f.yWindow[0])} to ${n(f.yWindow[1])}${f.spec.window.y ? '' : ' (automatic)'}.</p>`
    );
  }
  const s = f.spec;
  const name = (b: typeof s.hi) => boundaryName(b, s);
  const v = s.v;
  const rows = f.pieces.map((p) => [`${n(p.from)} to ${n(p.to)}`, `${name(p.upper)}`, `${name(p.lower)}`, n(p.area)]);
  return (
    table([`${v} range`, s.dir === 'dx' ? 'Upper' : 'Right', s.dir === 'dx' ? 'Lower' : 'Left', 'Area'], rows) +
    `<p>Total area: <strong>${esc(n(f.area))}</strong>${s.showArea ? '' : ' (not in the alt text; add "area": true to include it)'}.</p>` +
    `<p>Ends: ${esc(v)} = ${esc(n(s.a))} and ${esc(n(s.b))} (${s.between === 'intersections' ? 'from the intersections' : 'as given'}). ` +
    `Meeting points: ${esc(f.meetPoints.map(pt).join(', ') || 'none')}.</p>` +
    `<p class="hint">Window: x from ${n(f.xWindow[0])} to ${n(f.xWindow[1])}, y from ${n(f.yWindow[0])} to ${n(f.yWindow[1])}.</p>`
  );
}

function render() {
  const r = redraw(specEl.value, { id: 'lab' });
  if (!r.ok) {
    messages.innerHTML = box('error', 'Can’t redraw yet', r.errors) + (r.warnings.length ? box('warning', 'Warnings', r.warnings) : '');
    return; // keep the last good drawing visible while typing
  }
  messages.innerHTML = r.warnings.length ? box('warning', 'Warnings', r.warnings) : '';
  preview.innerHTML = r.svg;
  lastSvg = r.svg;
  altShort.textContent = r.alt.short;
  altLong.textContent = r.alt.long;
  factsEl.innerHTML = factsHtml(r.facts);
}

function load(i: string) {
  if (i === 'own') specEl.value = localStorage.getItem(STORE) ?? '';
  else specEl.value = JSON.stringify(EXAMPLES[Number(i)].spec, null, 2);
  render();
}

let timer = 0;
specEl.addEventListener('input', () => {
  exampleEl.value = 'own';
  try {
    localStorage.setItem(STORE, specEl.value);
  } catch {
    /* storage full or blocked: the lab still works */
  }
  clearTimeout(timer);
  timer = window.setTimeout(render, 250);
});
exampleEl.addEventListener('change', () => load(exampleEl.value));
copyBtn.addEventListener('click', async () => {
  if (!lastSvg) return;
  try {
    await navigator.clipboard.writeText(lastSvg);
    copied.textContent = 'Copied.';
  } catch {
    copied.textContent = 'The browser blocked the clipboard.';
  }
  setTimeout(() => (copied.textContent = ''), 2000);
});

const start = localStorage.getItem(STORE) ? 'own' : '0';
exampleEl.value = start;
load(start);
