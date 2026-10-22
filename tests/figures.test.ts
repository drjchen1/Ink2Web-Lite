// Run: npm test
import assert from 'node:assert/strict';
import { extractFigures, splitQuotedText } from '../src/lib/transcript.ts';

let r = extractFigures('before\n[[FIGURE: graph of u(t)]]\nafter the figure');
assert.deepEqual(r.descriptions, ['graph of u(t)']);
assert.equal(r.source, 'before\n\n[[FIGURE 1]]\n\nafter the figure');

/* 1.9.1: a missing bracket no longer swallows the next lines into the alt text. */
r = extractFigures('[[FIGURE: graph of u vs t]\nthe period remained the same\n[[note: R | new amplitude]]');
assert.deepEqual(r.descriptions, ['graph of u vs t']);
assert(r.source.includes('the period remained the same'));
assert(r.source.includes('[[note: R | new amplitude]]'));
r = extractFigures('[[FIGURE: spring with mass\nk: spring constant\n[[FIGURE: graph]]');
assert.deepEqual(r.descriptions, ['spring with mass', 'graph']);
assert(r.source.includes('k: spring constant'));
r = extractFigures('[[FIGURE: graph on [0, 1]]]\nx');
assert.deepEqual(r.descriptions, ['graph on [0, 1]']);
r = extractFigures('[[FIGURE: graph on [0, 1]\nx');
assert.deepEqual(r.descriptions, ['graph on [0, 1]']);
r = extractFigures('[[FIGURE: graph]] the period remained the same');
assert.equal(r.source, '[[FIGURE 1]]\n\nthe period remained the same');
r = extractFigures('a\n[[FIGURE: one]]\nb\n[[figure : two]\nc');
assert.deepEqual(r.descriptions, ['one', 'two']);
assert.equal(r.source, 'a\n\n[[FIGURE 1]]\n\nb\n\n[[FIGURE 2]]\n\nc');
assert.deepEqual(extractFigures('no figures').descriptions, []);

/* 1.9.2: a sentence the model quoted inside the description goes back into the notes. */
const ftc =
  'it represents the area under $f(x)$\n' +
  '[[FIGURE: graph with x-axis labeled a to b, y-axis, shaded region under curve from a to b, with text " $\\int_a^b f(x) \\, dx$ is area of the shaded region." written beside it]]\n' +
  'for example, $\\int_0^{\\pi/2} \\cos(x)\\,dx = 1$';
r = extractFigures(ftc);
assert.deepEqual(r.descriptions, ['graph with x-axis labeled a to b, y-axis, shaded region under curve from a to b']);
assert.equal(r.source, 'it represents the area under $f(x)$\n\n[[FIGURE 1]]\n\n$\\int_a^b f(x) \\, dx$ is area of the shaded region.\n\nfor example, $\\int_0^{\\pi/2} \\cos(x)\\,dx = 1$');
assert.deepEqual(splitQuotedText('spring diagram, and the note "k: spring constant (k > 0)" next to it'), { desc: 'spring diagram', moved: ['k: spring constant (k > 0)'] });
assert.deepEqual(splitQuotedText('“the frequency is decreased” written below the graph, decaying curve'), { desc: 'decaying curve', moved: ['the frequency is decreased'] });
assert.deepEqual(splitQuotedText('graph with axes labeled "t" and "u(t)", curve labeled "1st case"'), { desc: 'graph with axes labeled "t" and "u(t)", curve labeled "1st case"', moved: [] });
assert.deepEqual(splitQuotedText('spring with label "$k$"'), { desc: 'spring with label "$k$"', moved: [] });
console.log('All figure-marker tests passed.');
