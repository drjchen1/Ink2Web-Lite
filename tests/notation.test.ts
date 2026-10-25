// Run: npm test
import assert from 'node:assert/strict';
import { markdownToHtml, latexWarnings, INK_COLORS, clapTextLabels, composeNotes, noteClause } from '../src/lib/markdown.ts';
import {
  cleanModelOutput, unwrapTextMath, normalizeColorMarkup, mergeArrowNotes, promoteEquationLines, plainToTex,
  extractAnnotations, annotationsToNotes,
} from '../src/lib/transcript.ts';
import { polishAlt } from '../src/lib/exportHtml.ts';

const r = (md: string) => markdownToHtml(md, { figure: () => '' });

/* ---- underlined words, colors ---- */
assert(r('-> damped just right -> <u>critically damped</u>').includes('<strong class="ul">critically damped</strong>'));
assert(r('<script>x</script>').includes('&lt;script&gt;'), 'other HTML stays escaped');
assert(r('mass returns slowly [[red: without crossing equilibrium]]').includes('<span class="ink ink-red">without crossing equilibrium</span>'));
assert(r('[[Red: only if $|q| < 1$]]').includes('<span class="ink ink-red">only if \\(|q| &lt; 1\\)</span>'));
assert(r('[[CLEAR]]').includes('fig-clear'), 'internal marker unaffected');
assert(r('see \\textcolor{green}{this}').includes('<span class="ink ink-green">this</span>'));
assert(r('$\\color{red}{x}$').includes(`\\color{${INK_COLORS.red}}{x}`));

/* ---- drawn style: annotations pass through, never "unwrapped" as prose ---- */
const ann = '$$=R\\Big(\\underbrace{\\cos(\\omega t)\\cos(-\\delta)}_{\\text{cos of delta}} - \\sin(\\omega t)\\sin(-\\delta)\\Big)$$';
assert.equal(unwrapTextMath(ann), ann);
const arrow = '$$u(t) = \\underset{\\substack{\\uparrow\\\\ \\text{new amplitude}}}{R}\\cos(7t-\\delta)$$';
assert.equal(unwrapTextMath(arrow), arrow);
assert(r(arrow).includes('\\underset{\\mathclap{\\substack{\\uparrow\\\\ \\text{new amplitude}}}}{R}'));
assert(r('$$\\vdots$$').includes('<div class="math-display">\\[\\vdots\\]</div>'));
assert.deepEqual(latexWarnings(ann + '\n' + arrow), []);
assert.equal(cleanModelOutput(arrow, 'drawn'), arrow, 'drawn style keeps annotations');
assert(unwrapTextMath('$$\\begin{aligned}&\\text{leave it there} \\\\ &\\text{pull it down}\\end{aligned}$$').includes('\nleave it there\npull it down\n'));

/* ---- text labels hang without widening the term ---- */
assert.equal(clapTextLabels('\\underset{\\substack{\\uparrow\\\\ \\text{new amplitude}}}{R}'), '\\underset{\\mathclap{\\substack{\\uparrow\\\\ \\text{new amplitude}}}}{R}');
assert.equal(clapTextLabels('\\underbrace{e^{rt}}_{\\text{never } 0}'), '\\underbrace{e^{rt}}_{\\mathclap{\\text{never } 0}}');
assert.equal(clapTextLabels('\\underbrace{\\sin(-\\delta)}_{-\\sin(\\delta)}'), '\\underbrace{\\sin(-\\delta)}_{-\\sin(\\delta)}');
assert.equal(clapTextLabels('\\overset{\\mathclap{\\text{x}}}{y}'), '\\overset{\\mathclap{\\text{x}}}{y}', 'idempotent');

/* ---- HTML color markup from models is normalized ---- */
assert.equal(normalizeColorMarkup('a <span style="color: red;">note</span> b'), 'a [[red: note]] b');
assert.equal(normalizeColorMarkup('<font color="green">ok</font>'), '[[green: ok]]');

/* ---- 1.6.1 fallbacks ---- */
assert.equal(
  mergeArrowNotes('u(t) = Rcos(7t - δ)\n↑\nnew\namplitude\n← phase\nshift\nto do that'),
  'u(t) = Rcos(7t - δ)\n[[note: ↑ new amplitude · ← phase shift]]\nto do that',
);
assert(r('[[note: ↑ new amplitude]]').includes('<span class="ink">↑ new amplitude</span>'), 'free-standing note');
assert.equal(plainToTex('u(t) = Rcos(7t - δ)'), 'u(t) = R\\cos(7t - \\delta)');
assert.equal(promoteEquationLines('A = R cos(δ)    B = R sin(δ)'), '$$A = R \\cos(\\delta) \\qquad B = R \\sin(\\delta)$$');
assert.equal(promoteEquationLines('to do that, we use this identity : cos(a+b) = x'), 'to do that, we use this identity : cos(a+b) = x');
assert.equal(promoteEquationLines('[[note: \\omega | x = y]]'), '[[note: \\omega | x = y]]', 'note lines untouched');
assert(!r('- sin(δ)').includes('<li>') && r('- strong damping → overdamped').includes('<li>'));

/* ---- 1.7: notes style -> "where ..." sentences ---- */
assert.equal(noteClause({ target: '\\omega', label: 'frequency' }), '$\\omega$ is the frequency');
assert.equal(noteClause({ target: '\\omega', label: 'omega (frequency)' }), '$\\omega$ is the frequency');
assert.equal(noteClause({ target: 'R', label: 'new amplitude' }), '$R$ is the new amplitude');
assert.equal(noteClause({ target: '\\cos(-\\delta)', label: '\\cos(\\delta)' }), '$\\cos(-\\delta) = \\cos(\\delta)$');
assert.equal(noteClause({ target: '\\omega t', label: 'a' }), '$a = \\omega t$', 'a letter names the term');
assert.equal(noteClause({ target: '-0.3', label: 'upward', color: 'red' }), '[[red: $-0.3$ is upward]]');
assert.equal(noteClause({ target: 'c', label: 'the damping constant' }), '$c$ is the damping constant');
assert.equal(noteClause({ target: '\\cos(\\delta)', label: '\\cos(\\delta)' }), null, 'label repeating the term adds nothing');
assert.equal(noteClause({ target: '$\\delta$', label: '\\text{phase shift}' }), '$\\delta$ is the phase shift', '$ and \\text tolerated');

assert.equal(
  composeNotes('$$u(t) = R\\cos(7t - \\delta)$$\n[[note: R | new amplitude]]\n[[note: \\delta | phase shift]]\nto do that'),
  '$$u(t) = R\\cos(7t - \\delta)$$\n[[where: where $R$ is the new amplitude and $\\delta$ is the phase shift.]]\n\nto do that',
);
assert.equal(
  composeNotes('[[note: m | mass]]\n\n[[note: c | damping constant]]\n[[note: k | spring constant]]'),
  '[[where: where $m$ is the mass, $c$ is the damping constant, and $k$ is the spring constant.]]\n',
  'blank lines inside a run, Oxford comma',
);
assert.equal(composeNotes('[[note: ↑ new amplitude]]'), '[[note: ↑ new amplitude]]', 'pipe-less notes untouched');
assert.equal(composeNotes('[[note: x | x]]'), '', 'empty run disappears');

const where = r('$$x = y$$\n[[note: \\omega | frequency]]\n[[note red: -0.3 | upward]]');
assert(where.includes('<span class="ink">where \\(\\omega\\) is the frequency and <span class="ink ink-red">\\(-0.3\\) is upward</span>.</span>'), where);
assert.deepEqual(latexWarnings('$$x$$\n[[note: |q| | absolute value]]'), [], 'pipes in a note do not trip the $ check');

/* ---- 1.7: arrows/braces the model drew anyway are moved into notes ---- */
assert.deepEqual(extractAnnotations('u(t) = \\underset{\\substack{\\uparrow\\\\ \\text{new amplitude}}}{R}\\cos(7t)'), {
  tex: 'u(t) = R\\cos(7t)',
  notes: [{ target: 'R', label: 'new amplitude' }],
});
assert.deepEqual(extractAnnotations('R\\cos(\\overbrace{\\omega t}^{a}\\overbrace{-\\delta}^{b})'), {
  tex: 'R\\cos(\\omega t-\\delta)',
  notes: [{ target: '\\omega t', label: 'a' }, { target: '-\\delta', label: 'b' }],
});
assert.deepEqual(extractAnnotations('\\underbrace{\\cos(-\\delta)}_{\\cos(\\delta)} - \\underbrace{x}'), {
  tex: '\\cos(-\\delta) - x',
  notes: [{ target: '\\cos(-\\delta)', label: '\\cos(\\delta)' }],
});
assert.equal(
  annotationsToNotes('$$=R\\big(\\cos(\\omega t)\\underbrace{\\cos(-\\delta)}_{\\cos(\\delta)}\\big)$$\nnext line'),
  '$$=R\\big(\\cos(\\omega t)\\cos(-\\delta)\\big)$$\n[[note: \\cos(-\\delta) | \\cos(\\delta)]]\nnext line',
);
assert.equal(
  annotationsToNotes('so $\\underset{\\text{start}}{x_0}$ here'),
  'so $x_0$ here\n[[note: x_0 | start]]',
);
// The duplicate the model produced on Lesson21 p2: label = term, so the note adds nothing.
assert(!r(cleanModelOutput('$\\underbrace{\\cos(\\delta)}_{\\cos(\\delta)}$ $\\underbrace{-\\sin(\\delta)}_{-\\sin(\\delta)}$')).includes('where'));
// End to end: what the model drew becomes a clean equation plus a sentence.
const e2e = r(cleanModelOutput('$$u(t) = A\\cos(\\underset{\\substack{\\uparrow\\\\ \\text{frequency}}}{\\omega} t)$$'));
assert(e2e.includes('\\[u(t) = A\\cos(\\omega t)\\]') && e2e.includes('where \\(\\omega\\) is the frequency.'), e2e);

/* ---- alt text, contrast ---- */
assert.equal(polishAlt('curve $\\color{red}{u(t)}$ decays'), 'Curve u(t) decays.');
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
for (const [name, hex] of Object.entries(INK_COLORS)) assert(1.05 / (lum(hex) + 0.05) >= 4.5, `${name} contrast`);
console.log('All notation tests passed.');

/* ---------------- re-read clean-up (2.0.1) ---------------- */
{
  const { cleanReread } = await import('../src/lib/transcript.ts');
  const raw = '```markdown\nthe spring stretches by $L$\n[[FIGURE: graph of u(t)]]\n\\[ mg = kL \\]\n```';
  assert.equal(cleanReread(raw), 'the spring stretches by $L$\n$$mg = kL$$', 're-read drops figure lines and fences, normalizes math');
  console.log('Re-read clean-up tests passed.');
}
