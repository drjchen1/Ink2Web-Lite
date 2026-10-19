// Run: npm test
import assert from 'node:assert/strict';
import { analyzeLayout, buildInkMap, defaultLayout, matchFigures, textWeight } from '../src/lib/layout.ts';
import { besideUnitCount, placeByPosition, renumber } from '../src/lib/placement.ts';
import { insertMarkerAt, markerUnitIndex, moveMarker, removeMarkers, sourceUnits } from '../src/lib/transcript.ts';

/* ---- synthetic page: text, a narrow spring with labels + text beside, an integral, a graph ---- */
const W = 800, H = 600;
const rgba = new Uint8ClampedArray(W * H * 4).fill(245);
const ink = (x0: number, y0: number, x1: number, y1: number) => {
  [x0, y0, x1, y1] = [x0, y0, x1, y1].map(Math.round);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * W + x) * 4; rgba[i] = 20; rgba[i + 1] = 30; rgba[i + 2] = 110; }
};
// Handwriting: thin strokes, ~12 px tall letters, words of 3-5 letters.
const words = (y: number, x0: number, x1: number) => { for (let x = x0; x < x1; x += 46) for (let s = x; s < Math.min(x + 34, x1); s += 6) ink(s, y, s + 2, y + 12); };
words(30, 100, 500);                                              // line 1
// Spring: top bar + zigzag (narrow, ~6 letters tall), arrows/label column beside it.
ink(180, 70, 215, 73);
for (let k = 0; k < 10; k++) ink(k % 2 ? 192 : 200, 73 + k * 7, (k % 2 ? 192 : 200) + 8, 80 + k * 7);
ink(240, 72, 242, 85); ink(238, 92, 244, 104); ink(240, 110, 242, 140);      // ↑ ℓ ↓ column
words(95, 330, 700);                                              // text beside the spring
// Integral with limits next to its integrand (~4 letters tall, like real ones; part of a row).
ink(110, 188, 116, 226); ink(118, 184, 124, 191); ink(104, 224, 110, 231);
words(200, 128, 420);
// Graph: axes + curve, label inside, formula beside it.
ink(160, 300, 163, 480); ink(160, 477, 420, 480);
for (let x = 165; x < 400; x += 3) ink(x, 470 - (x - 160) / 1.6, x + 3, 473 - (x - 160) / 1.6);
ink(150, 286, 160, 298);                                          // "y" over the axis
ink(470, 380, 600, 400);                                          // formula beside (one wide blob)
words(540, 100, 460);                                             // line after

const L = analyzeLayout(buildInkMap(rgba, W, H));
assert.equal(L.figures.length, 2, `spring and graph found, integral not (got ${L.figures.length})`);
const [spring, graph] = L.figures;
assert(spring.x * W + spring.w * W >= 242 && spring.x * W + spring.w * W < 320, 'spring includes its arrow column, not the text');
assert(graph.y * H < 290 && graph.x * W + graph.w * W < 460, 'graph includes "y" label, not the formula beside it');
assert.deepEqual(defaultLayout(spring, L.lines), { width: 20, align: 'left', wrap: true, besideLines: 1 });
assert.equal(defaultLayout(graph, L.lines).wrap, true);

/* ---- matching ---- */
const R = [{ x: 0.2, y: 0.1, w: 0.3, h: 0.2 }, { x: 0.2, y: 0.6, w: 0.3, h: 0.2 }];
assert.deepEqual(matchFigures(2, R), { assigned: [0, 1], extra: [] });
assert.deepEqual(matchFigures(1, R), { assigned: [-1], extra: [0, 1] }, 'no guessing when counts differ');
assert.deepEqual(matchFigures(1, R, [{ x: 0.22, y: 0.62, w: 0.25, h: 0.15 }]), { assigned: [1], extra: [0] }, 'model box decides');
assert.deepEqual(matchFigures(0, R), { assigned: [], extra: [0, 1] });

/* ---- placement on the real Lesson20-1 page (detector output measured on the scan) ---- */
const lesson = [
  '## Mechanical Vibrations',
  'take a spring, attach to a fixed point',
  'leaving it there, it will have a natural length',
  "now let's attach a block with mass m to it",
  'due to the weight, the spring lengthens by $L$',
  'if we do nothing, it sits there in equilibrium',
  'pull it down a bit and let go',
  'the block moves up and down and traces out a sine/cosine like curve',
  "why? let's model and explain with diff. eqs.",
  '',
  '[[FIGURE 1]]',
].join('\n');
const lines = [
  [0.080, 0.30, 0.53], [0.167, 0.10, 0.51], [0.240, 0.46, 0.90], [0.393, 0.10, 0.57], [0.524, 0.40, 0.77],
  [0.624, 0.41, 0.86], [0.687, 0.10, 0.42], [0.796, 0.48, 0.81], [0.847, 0.48, 0.87], [0.947, 0.12, 0.59],
].map(([y, x0, x1]) => ({ y, x0, x1 }));
const figs = [
  { id: 2, box: { x: 0.232, y: 0.209, w: 0.094, h: 0.112 } },
  { id: 3, box: { x: 0.191, y: 0.447, w: 0.142, h: 0.170 } },
  { id: 4, box: { x: 0.187, y: 0.733, w: 0.258, h: 0.160 } },
];
const placed = renumber(placeByPosition(removeMarkers(lesson, [1]), figs, [], lines)).source;
assert.equal(
  placed,
  [
    '## Mechanical Vibrations',
    'take a spring, attach to a fixed point',
    '', '[[FIGURE 1]]', '',
    'leaving it there, it will have a natural length',
    "now let's attach a block with mass m to it",
    '', '[[FIGURE 2]]', '',
    'due to the weight, the spring lengthens by $L$',
    'if we do nothing, it sits there in equilibrium',
    'pull it down a bit and let go',
    '', '[[FIGURE 3]]', '',
    'the block moves up and down and traces out a sine/cosine like curve',
    "why? let's model and explain with diff. eqs.",
  ].join('\n'),
);
assert.deepEqual(figs.map((f, i) => besideUnitCount(placed, { id: i + 1, box: f.box }, lines)), [1, 2, 1]);

/* ---- moving markers ---- */
const multi = 'a\n$$\nx = 1\n$$\n[[FIGURE 1]]\nb';
assert.equal(sourceUnits(multi).length, 4, 'multi-line $$ is one unit');
assert.equal(moveMarker(multi, 1, -1), 'a\n[[FIGURE 1]]\n$$\nx = 1\n$$\nb', 'jumps over the whole equation');
assert.equal(moveMarker(multi, 1, 1), 'a\n$$\nx = 1\n$$\nb\n[[FIGURE 1]]');
assert.equal(moveMarker('[[FIGURE 1]]\na', 1, -1), '[[FIGURE 1]]\na', 'no-op at the top');
assert.equal(markerUnitIndex(multi).get(1), 2);
assert.equal(insertMarkerAt('a\nb', 7, 1), 'a\n\n[[FIGURE 7]]\n\nb');
assert(textWeight('$$\\int_{0}^{\\pi/2} \\sin(x) \\, dx = 1$$') < 25, 'LaTeX commands do not inflate weight');

console.log('All layout tests passed.');
