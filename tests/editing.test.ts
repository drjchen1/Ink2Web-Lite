// Run: npm test
import assert from 'node:assert/strict';
import {
  altTextIssue, applyEdit, applyMark, blockText, commitBlock, isInMath, moveAltToNotes, pageBlocks, replaceBlock, splitBlocks, type Mark,
} from '../src/lib/editing.ts';
import { pageHtml, withWrapEnds } from '../src/lib/exportHtml.ts';
import type { Figure } from '../src/types.ts';

/* ---------------- blocks ---------------- */
const src = [
  '## Mechanical Vibration', 'this suggest we can rewrite $u(t)$ as', '$$u(t) = R\\cos(7t - \\delta)$$', '[[note: R | new amplitude]]', '',
  '[[FIGURE 1]]', '', 'beside the figure', 'more beside', 'below the figure', '', '$$', 'A = R\\cos(\\delta)', '', '$$',
].join('\n');
let b = splitBlocks(src);
assert.deepEqual(b.map((x) => [x.start, x.end, x.fig ?? null]), [[0, 3, null], [5, 5, 1], [7, 9, null], [11, 14, null]]);
b = splitBlocks(src, new Set([8]));
assert.deepEqual(b.map((x) => [x.start, x.end, x.clear]), [[0, 3, false], [5, 5, false], [7, 8, true], [9, 9, false], [11, 14, false]]);
assert.equal(blockText(src, b[0]).split('\n').length, 4);
assert.deepEqual(splitBlocks(''), []);
assert(replaceBlock(src, splitBlocks(src)[0], '## Mechanical Vibration (continued)\n$$x$$').startsWith('## Mechanical Vibration (continued)\n$$x$$\n\n[[FIGURE 1]]'));
const del = replaceBlock(src, splitBlocks(src)[2], '   ');
assert(!del.includes('beside the figure') && !/\n{3,}/.test(del));
{
  const s = 'a\n\nb line\n\nc';
  const blk = splitBlocks(s)[1];
  assert.equal(commitBlock(s, blk, 'b line', 'B LINE'), 'a\n\nB LINE\n\nc');
  assert.equal(commitBlock('[[FIGURE 1]]\n\na\n\nb line\n\nc', blk, 'b line', 'B LINE'), '[[FIGURE 1]]\n\na\n\nB LINE\n\nc');
  assert.equal(commitBlock('x', blk, 'b line', 'B LINE'), 'x\n\nB LINE');
}
const fig: Figure = { id: 1, box: { x: 0, y: 0, w: 1, h: 1 }, alt: 'a spring', caption: '', src: 'data:x', needsReview: false, width: 30, align: 'left', wrap: true, besideLines: 2 };
const page = { source: src, figures: [fig] };
const pb = pageBlocks(page, 1, 'hint-1');
assert.equal(pb.blocks.length, 5);
assert(pb.html[0].startsWith('<div class="blk" data-b="0" tabindex="0" aria-describedby="hint-1"><h2>Mechanical Vibration</h2>'));
assert(pb.html[0].includes('where \\(R\\) is the new amplitude.'));
assert(pb.html[1].includes('class="blk blk-fig"') && pb.html[1].includes('<figure id="fig-1-1"'));
assert(pb.html[2].endsWith('<div class="fig-clear"></div>'));
const strip = (h: string) => h.replace(/<div class="blk[^>]*>/g, '').replace(/<\/div>(?=(<div class="fig-clear">|$))/g, '').replace(/\s+/g, '');
assert(strip(pageHtml({ ...page, id: 'x', label: '', image: null as any, url: '', width: 1, height: 1, status: 'done' }, 1)).includes(strip(pb.html[0])));
const wsrc = 'intro\n\n[[FIGURE 1]]\n\nbeside one\n$$\na = b\n$$\nbelow\n[[FIGURE 2]]\nnext';
assert.equal(withWrapEnds(wsrc, [{ ...fig, width: 40, besideLines: 2 }]), 'intro\n\n[[FIGURE 1]]\n\nbeside one\n$$\na = b\n$$\n\n[[CLEAR]]\n\nbelow\n[[FIGURE 2]]\nnext');

/* ---------------- toolbar marks ---------------- */
const run = (text: string, s: number, e: number, m: Mark) => {
  const ed = applyMark(text, s, e, m);
  const out = applyEdit(text, ed);
  return { out, sel: out.slice(ed.selStart, ed.selEnd), cur: ed.selStart };
};
const at = (t: string, sub: string) => [t.indexOf(sub), t.indexOf(sub) + sub.length] as const;
assert.equal(isInMath('a $x$ b', 3), true);
assert.equal(isInMath('a $x$ b', 6), false);
assert.equal(isInMath('$$\nx\n$$ y', 4), true);
assert.equal(isInMath('cost \\$5 and x', 12), false);
let t = 'the mass m moves';
let s0 = t.indexOf(' m ') + 1;
assert.deepEqual(run(t, s0, s0 + 1, 'math'), { out: 'the mass $m$ moves', sel: 'm', cur: s0 + 1 });
t = 'R = \\sqrt{A^2+B^2}';
assert.equal(run(t, 0, t.length, 'display').out, '$$R = \\sqrt{A^2+B^2}$$');
assert.equal(run('so $x = 1$ ok', 0, 0, 'display').out, '$$so x = 1 ok$$');
t = '$$R = \\sqrt{A^2+B^2}$$';
let [a1, a2] = at(t, 'R = \\sqrt{A^2+B^2}');
assert.equal(run(t, a1, a2, 'box').out, '$$\\boxed{R = \\sqrt{A^2+B^2}}$$');
assert.equal(run('R = 1', 0, 5, 'box').out, '$$\\boxed{R = 1}$$');
t = 'damped just right critically damped';
[a1, a2] = at(t, 'critically damped');
assert.equal(run(t, a1, a2, 'underline').out, 'damped just right <u>critically damped</u>');
assert.equal(run('$x$', 1, 2, 'underline').out, '$\\underline{x}$');
assert.equal(run(t, a1, a2, 'color:red').out, 'damped just right [[red: critically damped]]');
assert.equal(run('$u = 1$', 1, 6, 'color:red').out, '$\\color{red}{u = 1}$');
t = '$$u(t) = R\\cos(7t - \\delta)$$\nto do that';
[a1, a2] = at(t, 'R');
const n = run(t, a1, a2, 'note');
assert.equal(n.out, '$$u(t) = R\\cos(7t - \\delta)$$\n[[note: R | ]]\nto do that');
assert.equal(n.out.slice(n.cur, n.cur + 2), ']]');
t = '$$\nu = R\\cos(\\omega t)\n$$\nnext';
[a1, a2] = at(t, '\\omega');
assert.equal(run(t, a1, a2, 'note').out, '$$\nu = R\\cos(\\omega t)\n$$\n[[note: \\omega | ]]\nnext');
assert.equal(run('$$a = b$$\nlater', 3, 3, 'vdots').out, '$$a = b$$\n$$\\vdots$$\nlater');
assert.equal(run('Damped vibration\nbody', 3, 3, 'heading').out, '## Damped vibration\nbody');
assert.equal(run('## Damped vibration', 5, 5, 'heading').out, 'Damped vibration');

/* ---------------- 1.9.4: alt text check and Move to notes ---------------- */
// Flagged: what the model actually wrote for the Fundamental Theorem page.
const bad = 'graph with x-axis labeled a to b, y-axis, shaded region under curve from a to b, with text " $\\int_a^b f(x) \\, dx$ is area of the shaded region." written beside it';
assert(altTextIssue(bad));
assert(altTextIssue('spring diagram; k: spring constant ($k > 0$)'), 'math');
assert(altTextIssue('graph of u(t), with a note saying the period stays the same'), 'mentions a note');
assert(altTextIssue('spring diagram with the words written next to it'), 'mentions writing beside');
// Not flagged: good alt text, including short labels.
for (const ok of [
  'Graph with x-axis labeled a to b and a shaded region under the curve.',
  'Graph of u against t with two curves labeled "1st case" and "2nd case".',
  'Spring hanging from a ceiling with a block of mass m attached.',
  '',
]) assert.equal(altTextIssue(ok), null, ok);

// Selecting the quoted sentence moves it after the figure and tidies the alt text.
const qs = bad.indexOf('" $');
const qe = bad.indexOf('" written') + 1;
const page2 = 'it represents the area under $f(x)$\n\n[[FIGURE 1]]\n\nfor example, $\\int_0^{\\pi/2} \\cos(x)\\,dx = 1$';
let mv = moveAltToNotes(page2, 1, bad, qs, qe);
assert.equal(mv.moved, '$\\int_a^b f(x) \\, dx$ is area of the shaded region.');
assert.equal(mv.alt, 'graph with x-axis labeled a to b, y-axis, shaded region under curve from a to b');
assert.equal(mv.source, 'it represents the area under $f(x)$\n\n[[FIGURE 1]]\n\n$\\int_a^b f(x) \\, dx$ is area of the shaded region.\nfor example, $\\int_0^{\\pi/2} \\cos(x)\\,dx = 1$');
// Selection that includes the trailing "written beside it": that phrase isn't moved.
mv = moveAltToNotes(page2, 1, bad, qs, bad.length);
assert.equal(mv.moved, '$\\int_a^b f(x) \\, dx$ is area of the shaded region.');
// Nothing selected: the whole alt text moves.
mv = moveAltToNotes('[[FIGURE 2]]', 2, 'k: spring constant', 0, 0);
assert.deepEqual([mv.alt, mv.source], ['', '[[FIGURE 2]]\n\nk: spring constant']);
// Figure marker missing from the page: appended at the end, nothing lost.
mv = moveAltToNotes('text', 3, 'a sentence here', 0, 0);
assert.equal(mv.source, 'text\n\na sentence here');
console.log('All editing tests passed.');

/* ---------------- things to check (2.1) ---------------- */
{
  const { pageIssues } = await import('../src/lib/editing.ts');
  const base: Figure = { id: 1, box: { x: 0, y: 0, w: 0.5, h: 0.5 }, alt: 'graph of u(t)', caption: '', src: '', needsReview: false, width: 60, align: 'center', wrap: false, besideLines: 0 };
  assert.deepEqual(pageIssues({ source: '$$x = 1$$', figures: [base] }), [], 'clean page has nothing to check');
  const kinds = pageIssues({
    source: '$$\\frac{1}{2$$',
    figures: [{ ...base, alt: '' }, { ...base, id: 2, alt: 'graph, with text "$x$ is the area" written beside it', needsReview: true }],
    error: 'Converting again failed',
  }).map((i) => [i.kind, i.figure ?? null]);
  assert.deepEqual(kinds, [['error', null], ['alt-missing', 1], ['alt-check', 2], ['figure-check', 2], ['latex', null]]);
  console.log('Page-issue tests passed.');
}
