// Run: npm test   (redraw: figures recreated from their mathematics, 2.2 dev)
import assert from 'node:assert/strict';
import { ExprError, compile, fn1, parse, toText } from '../src/lib/redraw/expr.ts';
import { nice, niceTicks, say } from '../src/lib/redraw/nice.ts';
import { autoY, sampleFn } from '../src/lib/redraw/sample.ts';
import { checkSpec } from '../src/lib/redraw/spec.ts';
import { redraw } from '../src/lib/redraw/index.ts';
import { EXAMPLES } from '../src/lib/redraw/examples.ts';
import type { GraphFacts } from '../src/lib/redraw/analyze.ts';
import { findMeets, integrate, type RegionFacts } from '../src/lib/redraw/region.ts';
import { asLine, classify, clipLine, contour, eigen, lineText, type Mat, type PhaseFacts } from '../src/lib/redraw/phase.ts';

const close = (a: number, b: number, tol = 1e-9) => assert(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);
const ev = (s: string, env: Record<string, number>) => compile(parse(s, Object.keys(env)))(env);

/* ---------------- expressions ---------------- */
close(ev('-t^2', { t: 3 }), -9); // ^ before unary minus
close(ev('2^-1', { t: 0 }), 0.5);
close(ev('e^-t*2', { t: 1 }), 2 / Math.E); // e^(-t), then *2
close(ev('2^3^2', { t: 0 }), 512); // right-associative
close(ev('2t^2 - 1', { t: 3 }), 17); // implicit multiplication binds the power first
close(ev('3(t-1)', { t: 2 }), 3);
close(ev('(t+1)(t-1)', { t: 3 }), 8);
close(ev('2 pi t', { t: 1 }), 2 * Math.PI);
close(ev('tcos(t)', { t: Math.PI }), -Math.PI); // run of letters split into names
close(ev('1/2t', { t: 4 }), 2); // (1/2)·t, like a calculator
close(ev('exp(-t)*cos(3t)', { t: 0 }), 1);
close(ev('u(t-2)', { t: 2 }), 1); // unit step is 1 at 0
close(ev('u(t-2)', { t: 1.999 }), 0);
close(ev('x^(1/3)', { x: -8 }), -2); // real odd roots
assert(Number.isNaN(ev('x^(1/2)', { x: -4 })));
assert(Number.isNaN(ev('x^x', { x: -1 / 3 })), 'no odd-root trick for variable exponents');
close(ev('log(e)', { t: 0 }), 1); // log is natural
close(ev('log10(100)', { t: 0 }), 2);
close(ev('max(t, 2)', { t: 1 }), 2);
close(ev('2·π − t²', { t: 1 }), 2 * Math.PI - 1); // Unicode from models
close(ev('t**2', { t: 3 }), 9);
close(ev('e5', { x: 0 }), Math.E * 5);
for (const [src, msg] of [
  ['sin t', /parentheses/],
  ['foo(t)', /Unknown name “foo”/],
  ['2+', /ends too soon/],
  ['(t', /Missing “\)”/],
  ['max(t)', /takes 2 arguments/],
  ['t$', /Unexpected character/],
  ['', /empty/],
  ['1e5', /Scientific notation/],
] as const)
  assert.throws(() => parse(src, ['t']), (e: unknown) => e instanceof ExprError && msg.test(e.message), src);
// No code execution, whatever the input.
for (const evil of ['constructor', 'this', 'alert(1)', 'process.exit()', 't;1']) assert.throws(() => parse(evil, ['t']), ExprError, evil);

assert.equal(toText(parse('exp(-t/2)*cos(3t)', ['t'])), 'e^(−t/2)·cos(3t)');
assert.equal(toText(parse('(t+1)(t-1)', ['t'])), '(t + 1)(t − 1)');
assert.equal(toText(parse('2 pi t', ['t'])), '2πt');
assert.equal(toText(parse('1/2t', ['t'])), '(1/2)t');
assert.equal(toText(parse('t - (t - 1)', ['t'])), 't − (t − 1)');
assert.equal(toText(parse('-t^2', ['t'])), '−t^2');
assert.equal(fn1('x^2', 'x')(3), 9);

/* ---------------- numbers ---------------- */
assert.equal(nice(Math.PI / 6).text, 'π/6');
assert.equal(nice((-2 * Math.PI) / 3).text, '−2π/3');
assert.equal(nice(Math.PI).text, 'π');
assert.equal(nice(1.1).text, '1.1'); // decimals stay decimals, not 11/10
assert.equal(nice(0.5).text, '0.5');
assert.equal(nice(1 / 3).text, '1/3');
assert.equal(nice(14 / 3).text, '14/3');
assert.equal(nice(2.0000000001).text, '2');
assert.deepEqual(nice(Math.E), { text: 'e', exact: true }); // 2.2.2: multiples of e
assert.equal(nice(2 * Math.E).text, '2e');
assert.equal(nice(-Math.E / 2).text, '−e/2');
assert.deepEqual(nice(Math.E + 0.001), { text: '2.72', exact: false });
assert.deepEqual(nice(Math.SQRT2), { text: '1.41', exact: false });
assert.equal(say(0.0077748), 'about 0.00777');
assert.equal(say(-12345.6789), 'about −12346'); // large values round to whole numbers
assert.equal(say(-12345.6), '−12345.6'); // a short decimal is taken as exact
assert.deepEqual(niceTicks(0, 8).values, [0, 2, 4, 6, 8]);
assert.deepEqual(niceTicks(-1.1, 1.1).values, [-1, -0.5, 0, 0.5, 1]);

/* ---------------- sampling ---------------- */
let s = sampleFn(fn1('u(t-2)*(t-2) + u(t-4)', 't'), [0, 6], [-1, 4]);
assert.deepEqual([s.breaks.length, s.breaks[0].kind, nice(s.breaks[0].x).text, s.segments.length], [1, 'jump', '4', 2]);
s = sampleFn(fn1('tan(x)', 'x'), [-4, 4], [-5, 5]);
assert.deepEqual(s.breaks.map((b) => [b.kind, nice(b.x).text]), [['blowup', '−π/2'], ['blowup', 'π/2']]);
s = sampleFn(fn1('1/x', 'x'), [-2, 2], [-5, 5]); // pole exactly on a sample point
assert.deepEqual(s.breaks.map((b) => [b.kind, nice(b.x).text]), [['blowup', '0']]);
s = sampleFn(fn1('ln(abs(x))', 'x'), [-3, 3], [-6, 2]); // slowly diverging pole on a sample point
assert.deepEqual(s.breaks.map((b) => [b.kind, nice(b.x).text]), [['blowup', '0']]);
s = sampleFn(fn1('sqrt(x)', 'x'), [-1, 4], [-1, 3]);
assert.equal(s.gaps.length, 1);
assert.equal(nice(s.gaps[0][1]).text, '0');
close(s.segments[0][0][0], 0, 1e-9); // the curve reaches its domain edge
s = sampleFn(fn1('exp(10x)', 'x'), [-1, 1], [-1, 3]);
assert(s.segments.flat().length < 600, 'off-screen growth is not refined');
s = sampleFn(fn1('exp(-t)*cos(3t)', 't'), [0, 6], [-1, 1]);
assert.deepEqual([s.segments.length, s.breaks.length, s.gaps.length], [1, 0, 0]);
const [lo, hi] = autoY([fn1('exp(-t)*cos(3t)', 't')], [0, 6]);
assert(lo < -0.2 && lo >= -1 && hi > 1 && hi <= 1.5, `auto window ${lo}..${hi}`);
const [tlo, thi] = autoY([fn1('tan(x)', 'x')], [-4, 4]);
assert(thi < 60 && tlo > -60, 'asymptotes don’t blow up the automatic window');

/* ---------------- spec checks (graph) ---------------- */
const base = { kind: 'graph', from: 'y = x^2', window: { x: [-2, 2] }, curves: [{ expr: 'x^2' }] };
assert.ok(checkSpec(base).spec);
assert.ok(checkSpec(JSON.stringify(base)).spec);
const errs = (spec: unknown) => checkSpec(spec).errors.join(' | ');
assert.match(errs('{bad json'), /Not valid JSON/);
assert.match(errs({ ...base, from: '' }), /from: quote the equation/);
assert.match(errs({ ...base, kind: 'pie' }), /kind must be "graph", "region", or "phase"/);
assert.match(errs({ ...base, window: { x: [2, -2] } }), /window\.x/);
assert.match(errs({ ...base, window: {} }), /window\.x/);
assert.match(errs({ ...base, curves: [{ expr: 'sin x' }] }), /curve 1: Write sin/);
assert.match(errs({ ...base, curves: [{ expr: 'sqrt(-1 - x^2)' }] }), /gives no real values/);
assert.match(errs({ ...base, points: [{ on: { curve: 2, at: 0 } }] }), /no curve 2/);
assert.match(errs({ ...base, points: [{ on: { curve: 1, at: 5 } }] }), /outside the window/);
assert.match(errs({ ...base, curves: [{ pieces: [{ expr: '0', on: [0, 2] }, { expr: '1', on: [1, 3] }] }] }), /pieces 1 and 2 overlap/);
assert.deepEqual(checkSpec({ ...base, colour: 'red' }).warnings, ['Ignored unknown field “colour”.']);
assert.equal(checkSpec({ ...base, axes: { x: 't' }, curves: [{ expr: 't^2' }] }).spec?.v, 't');
assert.equal(checkSpec({ ...base, axes: { x: 'time (s)' }, var: 't', curves: [{ expr: 't^2' }] }).spec?.v, 't');
// A point "on" a curve gets its y computed; at a jump, open/closed pick the side.
const step = {
  ...base,
  window: { x: [0, 4] },
  curves: [{ pieces: [{ expr: '0', on: [0, 2], ends: ['closed', 'open'] }, { expr: '1', on: [2, 4], ends: ['closed', 'closed'] }] }],
  points: [{ on: { curve: 1, at: 2 }, fill: 'open' }, { on: { curve: 1, at: 2 } }, { on: { curve: 1, at: 3 } }],
};
assert.deepEqual(checkSpec(step).spec?.points.map((p) => p.y), [0, 1, 1]);

/* ---------------- graph facts and alt text ---------------- */
const run = (spec: object) => {
  const r = redraw(spec, { id: 't' });
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r;
};
const graph = (spec: object) => {
  const r = run(spec);
  assert.equal(r.facts.kind, 'graph');
  return { ...r, g: r.facts as GraphFacts };
};
let gr = graph(EXAMPLES[0].spec); // damped oscillation
assert.deepEqual(gr.g.curves[0].zeros.slice(0, 3).map((x) => nice(x).text), ['π/6', 'π/2', '5π/6']);
assert.equal(gr.g.curves[0].oscillation, 'decaying');
assert.match(gr.alt.long, /oscillates with decreasing amplitude/);
assert.match(gr.alt.long, /Marked: a filled dot at \(0, 1\) labeled u\(0\) = 1/);
assert.match(gr.alt.short, /^Graph of u\(t\) = e\^\(−t\/2\)·cos\(3t\)/);

gr = graph(EXAMPLES[1].spec); // piecewise step
assert.deepEqual(gr.g.curves[0].jumps.map((j) => [j.x, j.from, j.to]), [[2, 0, 1], [5, 1, 0]]);
assert.match(gr.alt.long, /equal to 0 for 0 ≤ t < 2, 1 for 2 ≤ t < 5, and 0 for t from 5 to 7/);
assert.equal(gr.alt.short, 'Graph of the piecewise function g(t) for t from 0 to 7.');
assert(!/stays at/.test(gr.alt.long), 'constant pieces aren’t repeated');

gr = graph(EXAMPLES[2].spec); // switch-on: flat at 2 from π
assert.match(gr.alt.long, /It stays at 2 for t from π to 12\./);
assert.equal(gr.g.curves[0].zeros.length, 0);

gr = graph(EXAMPLES[3].spec); // impulse response: flat 0 before t = 2 is not "many zeros"
assert.deepEqual(gr.g.curves[0].constant.map(([p, q, v]) => [nice(p).text, nice(q).text, v]), [['0', '2', 0]]);
assert.equal(gr.g.curves[0].zeros.length, 3);
assert.match(gr.alt.long, /zero at t ≈ 5\.14, 8\.28, and 11\.4/);
assert.match(gr.alt.long, /An impulse, δ\(t − 2\), of size 1\.3 at t = 2, drawn as an upward arrow/);

gr = graph(EXAMPLES[4].spec); // tan
assert.match(gr.alt.long, /vertical asymptotes at x = −π\/2 and π\/2/);
assert.match(gr.alt.long, /zero at x = −π, 0, and π/);

gr = graph(EXAMPLES[5].spec); // ln x
assert.match(gr.alt.long, /Curve 1: ln\(x\)\. It is zero at x = 1\. It has a vertical asymptote at x = 0\. It is not defined for x from −1 to 0\./);
assert.match(gr.alt.long, /Curve 2: y = x − 1 \(dotted\)/);

gr = graph({ ...base, curves: [{ expr: 'x^3 - 3x' }] });
assert.match(gr.alt.long, /local maximum at \(−1, 2\)/);
assert.match(gr.alt.long, /local minimum at \(1, −2\)/);
gr = graph({ ...base, window: { x: [-2, 3] }, curves: [{ expr: '(x-1)^2' }] });
assert.deepEqual(gr.g.curves[0].zeros, [1], 'a touching zero counts');
gr = graph({ ...base, window: { x: [-3, 3] }, curves: [{ expr: 'ln(abs(x))' }] });
assert.match(gr.alt.long, /vertical asymptote at x = 0/);

/* ---------------- regions: helpers ---------------- */
close(integrate((x) => x * x, 0, 1), 1 / 3, 1e-12);
close(integrate((x) => Math.sqrt(x) - x * x, 0, 1), 1 / 3, 1e-9); // infinite slope at 0
close(integrate((x) => Math.sqrt(1 - x * x), -1, 1), Math.PI / 2, 1e-8);
assert.deepEqual(findMeets((x) => Math.sqrt(x) - x * x, 0, 2).map((x) => nice(x).text), ['0', '1']);
assert.deepEqual(findMeets((x) => x - x ** 3, -2, 2).map((x) => nice(x).text), ['−1', '0', '1']);
assert.deepEqual(findMeets((x) => (x - 1) ** 2, -1, 3).map((x) => nice(x, 1e-6).text), ['1'], 'touching zero');
assert.deepEqual(findMeets((x) => Math.tan(x), 1, 2), [], 'a pole is not a meeting point');

/* ---------------- regions: spec checks ---------------- */
const reg = { kind: 'region', from: 'A = \\int_0^1 (\\sqrt{x} - x^2) dx', top: 'sqrt(x)', bottom: 'x^2' };
assert.ok(checkSpec(reg).spec);
assert.match(errs({ ...reg, top: undefined }), /top: give the top boundary/);
assert.match(errs({ ...reg, top: 'sqrt x' }), /top: Write sqrt/);
assert.match(errs({ ...reg, left: 'y' }), /left\/right are for horizontal slices/);
assert.match(errs({ ...reg, dir: 'dz' }), /dir must be/);
assert.match(errs({ ...reg, top: 'x^2 + 1' }), /between: found no place where top and bottom meet/);
assert.match(errs({ ...reg, top: 'x^2 + 1', window: { x: [0, 3] } }), /found no place .* from 0 to 3\. Give "between": \[a, b\]\./);
assert.match(errs({ ...reg, between: [2, 1] }), /between must be \[a, b\]/);
assert.match(errs({ ...reg, top: 'sqrt(x)', between: [-1, 1] }), /top: not defined everywhere for x from −1 to 1/);
assert.match(errs({ ...reg, top: '1/x', bottom: '0', between: [-1, 1.01] }), /top: has a vertical asymptote at x = 0, inside the region/);
assert.match(errs({ ...reg, slice: { at: 3 } }), /slice: x = 3 is outside the region/);
assert.match(errs({ ...reg, points: [{ on: { curve: 'left', at: 0.5 } }] }), /"curve" must be "top" or "bottom"/);
// Written the wrong way round: swapped, with a warning.
const swapped = checkSpec({ ...reg, top: 'x^2', bottom: 'sqrt(x)' });
assert.match(swapped.warnings.join(), /“top” \(x\^2\) is below “bottom” \(sqrt\(x\)\) everywhere/);
assert(swapped.spec?.kind === 'region' && swapped.spec.hi.expr === 'sqrt(x)');
// left/right alone means horizontal slices; the variable is then y.
const dySpec = checkSpec({ kind: 'region', from: 'x', right: 'y + 2', left: 'y^2' }).spec;
assert(dySpec?.kind === 'region' && dySpec.dir === 'dy' && dySpec.v === 'y');
const onTop = checkSpec({ ...reg, points: [{ on: { curve: 'top', at: 0.25 } }] }).spec;
assert.deepEqual(onTop?.points.map((p) => [p.x, p.y]), [[0.25, 0.5]]);

/* ---------------- regions: facts and alt text ---------------- */
const region = (spec: object) => {
  const r = run(spec);
  assert.equal(r.facts.kind, 'region');
  return { ...r, f: r.facts as RegionFacts };
};
let rg = region(EXAMPLES[6].spec); // √x and x²
assert.equal(nice(rg.f.area).text, '1/3');
assert.equal(rg.alt.short, 'Region between y = √x and y = x^2 for x from 0 to 1.');
assert.match(rg.alt.long, /The shaded region lies below y = √x and above y = x\^2, for x from 0 to 1\./);
assert.match(rg.alt.long, /The curves meet at \(0, 0\) and \(1, 1\)\./);
assert.match(rg.alt.long, /A thin vertical strip of width Δx is drawn at x = 0\.55, reaching from \(0\.55, ≈0\.303\) on y = x\^2 up to \(0\.55, ≈0\.742\) on y = √x\./);
assert(!/area/.test(rg.alt.long), 'the area is left out unless asked for');
assert(!/Marked/.test(rg.alt.long), 'intersection dots aren’t listed twice');
assert.equal((rg.svg.match(/<circle /g) ?? []).length, 2, 'two intersection dots');
assert(rg.f.edges.length === 0, 'no straight sides between intersections');

rg = region(EXAMPLES[7].spec); // under x² + 1 on [0, 2]
assert.equal(nice(rg.f.area).text, '14/3');
assert.equal(rg.alt.short, 'Region between y = x^2 + 1 and the x-axis for x from 0 to 2.');
assert.match(rg.alt.long, /Its left and right sides are the vertical lines x = 0 and x = 2\./);
assert.match(rg.alt.long, /The shaded area is 14\/3\./);
assert.equal(rg.f.boundaries.length, 1, 'the axis (bottom = 0) isn’t drawn again');

rg = region(EXAMPLES[8].spec); // y = x and y = x³ cross at 0
assert.deepEqual(rg.f.pieces.map((p) => [p.upper.expr, nice(p.area).text]), [['x^3', '0.25'], ['x', '0.25']]);
assert.equal(nice(rg.f.area).text, '0.5');
assert.match(rg.alt.long, /The curves cross at x = 0, so the upper curve changes: y = x\^3 is on top for −1 < x < 0 and y = x for 0 < x < 1\./);
assert.match(rg.alt.long, /meet at \(−1, −1\), \(0, 0\), and \(1, 1\)/);

rg = region(EXAMPLES[9].spec); // x = y² and x = y + 2
assert.equal(nice(rg.f.area).text, '4.5');
assert.deepEqual(rg.f.meetPoints.map((p) => p.map((v) => nice(v).text)), [['1', '−1'], ['4', '2']], 'meeting points are (x, y)');
assert.match(rg.alt.long, /lies to the left of x = y \+ 2 and to the right of x = y\^2, for y from −1 to 2\./);
assert.match(rg.alt.long, /horizontal strip of height Δy is drawn at y = 0\.5, reaching from \(0\.25, 0\.5\) on x = y\^2 across to \(2\.5, 0\.5\) on x = y \+ 2\./);
// The window frames the region (x from about 0 to 4), not the whole parabola.
assert(rg.f.xWindow[0] >= -1 && rg.f.xWindow[1] <= 6, `x window ${rg.f.xWindow}`);

// Unlabeled boundaries are named from the axes; numeric bounds give straight sides.
rg = region({ kind: 'region', from: '\\int_1^2 \\frac{1}{t} dt', axes: { x: 't', y: 'v' }, top: '1/t', between: [1, 2], area: true });
assert.equal(rg.alt.short, 'Region between v = 1/t and the t-axis for t from 1 to 2.');
assert.match(rg.alt.long, /The shaded area is about 0\.693\./);
// Touching zero inside, meeting points at irrational ends.
rg = region({ kind: 'region', from: 'y = x^4 - 2x^2', top: 'x^4 - 2x^2', window: { x: [-2, 2] }, area: true });
assert.match(rg.alt.long, /lies below the x-axis and above y = x\^4 − 2x\^2, for x from ≈−1\.41 to ≈1\.41/);
assert.equal(rg.f.meetPoints.length, 3);
close(rg.f.area, (16 * Math.SQRT2) / 15, 1e-8);
assert.match(rg.warnings.join(), /was|were swapped/);
// Semicircle: area recognized as π/2.
rg = region({ kind: 'region', from: 'x^2 + y^2 = 1', top: 'sqrt(1 - x^2)', area: true });
assert.match(rg.alt.long, /The shaded area is π\/2\./);

/* ---------------- SVG ---------------- */
for (const [i, e] of EXAMPLES.entries()) {
  const out = redraw(e.spec, { id: `fig ${i}` });
  assert(out.ok, e.name);
  const svg = out.svg;
  assert(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"') && svg.endsWith('</svg>'));
  assert(svg.includes('role="img"') && svg.includes(`aria-labelledby="fig-${i}-title fig-${i}-desc"`), 'ids are sanitized');
  assert(svg.includes(`<title id="fig-${i}-title">`) && svg.includes(`<desc id="fig-${i}-desc">`));
  assert(!/NaN|Infinity|undefined/.test(svg), `${e.name}: no bad numbers`);
  assert(!svg.includes('\u200B') && !/font-size="\d+%"/.test(svg), `${e.name}: no invisible characters or percent sizes`);
  const open = (svg.match(/<(?!\/)[a-zA-Z]+(?:\s[^>]*)?(?<!\/)>/g) ?? []).length;
  const closeTags = (svg.match(/<\/[a-zA-Z]+>/g) ?? []).length;
  assert.equal(open, closeTags, `${e.name}: balanced tags`);
}
const labelled = redraw(EXAMPLES[0].spec, { id: 'x' });
assert(labelled.ok && labelled.svg.includes('>u(t)</text>'), 'curve labels are drawn');
const sup = redraw(EXAMPLES[6].spec, { id: 'x' });
assert(sup.ok && /y = x<tspan dy="-0\.45em" font-size="[\d.]+">2<\/tspan>/.test(sup.svg), 'superscripts in labels');
assert(sup.ok && sup.svg.includes('fill-opacity="0.35"'), 'the region is shaded');
const escd = redraw({ ...base, labels: [{ at: [0, 1], text: '<b>&' }] }, { id: 'x' });
assert(escd.ok && escd.svg.includes('&lt;b&gt;&amp;') && !escd.svg.includes('<b>'), 'label text is escaped');

/* ---------------- phase planes: linear algebra ---------------- */
const kindOf = (J: Mat) => classify(J, eigen(J));
assert.equal(kindOf([[0, 1], [-2, -3]]), 'stable node');
assert.equal(kindOf([[1, 0], [0, 2]]), 'unstable node');
assert.equal(kindOf([[1, 1], [4, 1]]), 'saddle');
assert.equal(kindOf([[-0.5, 2], [-2, -0.5]]), 'stable spiral');
assert.equal(kindOf([[0.2, -1], [1, 0.2]]), 'unstable spiral');
assert.equal(kindOf([[0, 1], [-4, 0]]), 'center');
assert.equal(kindOf([[-2, 0], [0, -2]]), 'stable star');
assert.equal(kindOf([[-1, 1], [0, -1]]), 'stable degenerate node');
assert.equal(kindOf([[1, 2], [2, 4]]), 'degenerate');
assert.equal(eigen([[0, 1], [-2, -3]]).text, '−2 and −1');
assert.equal(eigen([[-0.5, 2], [-2, -0.5]]).text, '−0.5 ± 2i');
assert.equal(eigen([[0, 1], [-4, 0]]).text, '±2i');
assert.equal(eigen([[0, 1], [-1, 0]]).text, '±i');
assert.equal(eigen([[0, 1], [-1, -1]]).text, '(−1 ± i√3)/2');
assert.equal(eigen([[1, 1], [1, -2]]).text, '(−1 ± √13)/2');
assert.equal(eigen([[-2, 0], [0, -2]]).text, '−2 (repeated)');
assert.equal(eigen([[0, 1], [3, 0]]).text, '±√3');
assert.equal(eigen([[-1, 1], [2, -1]]).text, '−1 ± √2');
assert.equal(eigen([[0, 1], [-3, 0]]).text, '±i√3');
assert.equal(eigen([[-1, 2], [-1, -1]]).text, '−1 ± i√2');
// Eigenvectors: A v = λ v.
for (const A of [[[0, 1], [-2, -3]], [[1, 1], [4, 1]], [[3, 0], [0, -1]], [[1, 1], [1, -2]]] as Mat[]) {
  const e = eigen(A);
  e.vectors.forEach((v, k) => {
    const l = e.values[k].re;
    close(A[0][0] * v[0] + A[0][1] * v[1], l * v[0], 1e-9);
    close(A[1][0] * v[0] + A[1][1] * v[1], l * v[1], 1e-9);
  });
}
assert.equal(lineText({ vertical: false, m: -2 / 3, c: 0 }, 'x', 'y'), 'y = −(2/3)x');
assert.equal(lineText({ vertical: false, m: -1, c: 1 }, 'x', 'y'), 'y = −x + 1');
assert.equal(lineText({ vertical: false, m: 0, c: 0 }, 'x', 'y'), 'y = 0');
assert.equal(lineText({ vertical: true, m: 0, c: 2 }, 'u', 'v'), 'u = 2');
assert.equal(lineText({ vertical: false, m: 2, c: -0.75 }, 'x', 'y'), 'y = 2x − 0.75');
assert.deepEqual(clipLine([0, 0], [1, 1], [-1, 2], [-3, 3]), [[-1, -1], [2, 2]]);
assert.equal(clipLine([5, 5], [1, 0], [-1, 1], [-1, 1]), null);
// Contours: a circle comes back as one closed loop; a line is recognized as a line.
const circ = contour((x, y) => x * x + y * y - 1, [-2, 2], [-2, 2]);
assert.equal(circ.length, 1);
assert(circ[0].every(([x, y]) => Math.abs(Math.hypot(x, y) - 1) < 1e-9), 'points exactly on the circle');
const ln = contour((x, y) => y - 2 * x + 1, [-2, 2], [-2, 2]);
assert.deepEqual(asLine(ln[0], [-2, 2], [-2, 2]), { vertical: false, m: 2, c: -1 });
assert.deepEqual(contour((x) => 1 / x, [-2, 2], [-2, 2]), [], 'a pole is not a zero');

/* ---------------- phase planes: specs ---------------- */
const ph = { kind: 'phase', from: "x' = y, y' = -x", system: { x: 'y', y: '-x' } };
assert.ok(checkSpec(ph).spec);
assert.match(errs({ ...ph, system: { x: 'y', y: '-x + cos(t)' } }), /y′: it uses t, but a phase plane needs an autonomous system/);
assert.match(errs({ ...ph, system: { u: 'v', v: '-u' } }), /exactly the keys "x" and "y"/);
assert.match(errs({ ...ph, system: undefined }), /system: give/);
assert.match(errs({ ...ph, system: undefined, A: [[1, 2, 3]] }), /A must be a 2×2 matrix/);
assert.match(errs({ ...ph, trajectories: [{ start: 1 }] }), /trajectory 1: give "start"/);
assert.match(errs({ ...ph, system: { x: '1/x', y: 'y' }, trajectories: [{ start: [0, 1] }] }), /isn’t defined at \(0, 1\)/);
assert.match(errs({ ...ph, vars: ['x', 'x'] }), /must differ/);
assert.match(errs({ ...ph, points: [{ on: { curve: 1, at: 0 } }] }), /points on trajectories aren’t supported/);
assert.match(checkSpec({ ...ph, show: ['field', 'arrows'] }).warnings.join(), /show: ignored “arrows”/);
// A variable named u is a variable, not the unit step.
const uv = checkSpec({ ...ph, axes: { x: 'u', y: 'v' }, system: { u: 'v', v: '-4u' } }).spec;
assert(uv?.kind === 'phase');
assert.deepEqual(uv.F(1, 2), [2, -4]);
// A matrix becomes ordinary expressions.
const am = checkSpec({ ...ph, system: undefined, A: [[0, 1], [-2, -3]] }).spec;
assert(am?.kind === 'phase' && am.text[0] === 'y' && am.text[1] === '−2x − 3y');

/* ---------------- phase planes: facts and alt text ---------------- */
const phase = (spec: object) => {
  const r = run(spec);
  assert.equal(r.facts.kind, 'phase');
  return { ...r, f: r.facts as PhaseFacts };
};
let pr = phase(EXAMPLES[10].spec); // stable node
assert.equal(pr.alt.short, 'Phase plane for x′ = y, y′ = −2x − 3y.');
assert.match(pr.alt.long, /One equilibrium, at \(0, 0\): a stable node \(eigenvalues −2 and −1\); nearby trajectories approach it tangent to the line y = −x, except those along the line y = −2x\./);
assert(pr.f.trajectories.every((t) => t.forward?.kind === 'equilibrium'), 'every trajectory approaches the node');
assert.equal((pr.svg.match(/<circle /g) ?? []).length, 1);
assert(/<circle [^>]*fill="#1a1a1a"/.test(pr.svg), 'a stable equilibrium is a filled dot');

pr = phase(EXAMPLES[11].spec); // saddle
assert.match(pr.alt.long, /a saddle \(eigenvalues −1 and 3\); it attracts along the line y = −2x and repels along the line y = 2x/);
assert(pr.f.trajectories.every((t) => t.forward?.kind === 'exits' && t.backward?.kind === 'exits'));
assert(/<circle [^>]*fill="#fff"/.test(pr.svg), 'an unstable equilibrium is an open dot');

pr = phase(EXAMPLES[12].spec); // stable spiral
assert.match(pr.alt.long, /a stable spiral \(eigenvalues −0\.5 ± 2i\); nearby trajectories turn clockwise/);
assert.equal(pr.f.trajectories[0].backward, null, 'forward only');
assert.match(pr.alt.long, /The trajectory through \(2\.5, 0\) approaches the stable spiral at \(0, 0\)\./);

pr = phase(EXAMPLES[13].spec); // center (u, v)
assert.equal(pr.alt.short, 'Phase plane for u′ = v, v′ = −4u.');
assert.match(pr.alt.long, /a center \(eigenvalues ±2i\)/);
assert.match(pr.alt.long, /Trajectory 1 through \(1, 0\) is a closed loop around the center at \(0, 0\), traversed clockwise\./);
// The orbit really is the ellipse u² + v²/4 = 1.
assert(pr.f.trajectories[0].path.every(([u, v]) => Math.abs(u * u + (v * v) / 4 - 1) < 1e-6), 'RK4 stays on the orbit');
assert(pr.f.xWindow[0] === -pr.f.xWindow[1], 'automatic window centred on the equilibrium');

pr = phase(EXAMPLES[14].spec); // competing species
assert.match(pr.alt.long, /Four equilibria: \(0, 0\), an unstable node \(eigenvalues 0\.75 and 1\); \(0, 0\.75\), a saddle/);
assert.match(pr.alt.long, /\(0\.5, 0\.5\), a stable node \(eigenvalues ≈−0\.854 and ≈−0\.146\)/);
assert.match(pr.alt.long, /The x-nullcline \(where x′ = 0, dashed\) is the lines x = 0 and y = −x \+ 1\./);
assert.match(pr.alt.long, /The y-nullcline \(where y′ = 0, dotted\) is the lines y = 0 and y = −0\.5x \+ 0\.75\./);
assert(pr.svg.includes('>x′ = 0</text>') && pr.svg.includes('>y′ = 0</text>'), 'nullclines are labeled');

pr = phase(EXAMPLES[15].spec); // pendulum, displayed as θ and ω
assert.equal(pr.alt.short, 'Phase plane for θ′ = ω, ω′ = −sin(θ).');
assert.match(pr.alt.long, /Five equilibria: \(−2π, 0\), \(0, 0\), and \(2π, 0\), centers of the linearization \(eigenvalues ±i\); the nonlinear terms decide/);
assert.match(pr.alt.long, /\(−π, 0\) and \(π, 0\), saddles \(eigenvalues −1 and 1\)/);
assert.equal(pr.f.trajectories[0].forward?.kind, 'closed');
assert.match(pr.alt.long, /Trajectory 2 through \(0, 2\.5\) enters the window across the left edge and leaves the window across the right edge\./);

// Nonlinear closed orbits, limit cycles, and the singular cases.
pr = phase({ ...ph, system: { x: 'x(1 - y)', y: 'y(x - 1)' }, window: { x: [0, 3], y: [0, 3] }, trajectories: [{ start: [1, 2] }] });
assert.match(pr.alt.long, /is a closed loop around the center at \(1, 1\), traversed counterclockwise/);
pr = phase({ ...ph, system: { x: 'y', y: '(1 - x^2)y - x' }, window: { x: [-3, 3], y: [-3, 3] }, trajectories: [{ start: [0.5, 0], direction: 'forward' }] });
assert.match(pr.alt.long, /an unstable spiral \(eigenvalues \(1 ± i√3\)\/2\)/);
assert.match(pr.alt.long, /keeps circling clockwise without settling/);
let bad = redraw({ ...ph, system: undefined, A: [[1, 2], [2, 4]] }, { id: 'x' });
assert(!bad.ok && /Every point on a line/.test(bad.errors.join()));
pr = phase({ ...ph, system: { x: '1', y: 'x' }, window: { x: [-2, 2], y: [-2, 2] }, show: ['equilibria', 'nullclines'] });
assert.match(pr.alt.long, /There is no equilibrium in the window\. x′ is never 0 in the window\. The y-nullcline \(where y′ = 0, dotted\) is the line x = 0\./);
assert.match(errs({ ...ph, system: { x: 'y', y: 'sqrt(-1 - x^2)' } }), /system: gives no real values anywhere/);

console.log('Redraw tests passed.');
