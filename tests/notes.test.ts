// Run: npm test
import assert from 'node:assert/strict';
import { noteClause, labelToProse, composeNotes, markdownToHtml, latexWarnings } from '../src/lib/markdown.ts';

const r = (md: string) => markdownToHtml(md, { figure: () => '' });

/* ---- 1.7.3: labels with words never get "="; their words stay text ---- */
// The Mechanical Vibration case (screenshot): words + math in the label.
assert.equal(
  noteClause({ target: 'C_1\\cos(\\omega_n t) + C_2\\sin(\\omega_n t)', label: 'oscillation with frequency \\omega_n = \\sqrt{\\frac{k}{m}}' }),
  '$C_1\\cos(\\omega_n t) + C_2\\sin(\\omega_n t)$ is oscillation with frequency $\\omega_n = \\sqrt{\\frac{k}{m}}$',
);
assert.equal(
  noteClause({ target: '\\frac{f_0/m}{\\omega_n^2 - \\omega^2}\\cos(\\omega t)', label: 'oscillation with frequency \\omega' }),
  '$\\frac{f_0/m}{\\omega_n^2 - \\omega^2}\\cos(\\omega t)$ is oscillation with frequency $\\omega$',
);
// Same label written with \text{...} or $...$ by the model.
assert.equal(labelToProse('\\text{oscillation with frequency } \\omega_n = \\sqrt{\\frac{k}{m}}'), 'oscillation with frequency $\\omega_n = \\sqrt{\\frac{k}{m}}$');
assert.equal(labelToProse('oscillation with frequency $\\omega$'), 'oscillation with frequency $\\omega$');
assert.equal(labelToProse('decays like e^{-t} as t grows'), 'decays like $e^{-t}$ as $t$ grows');
assert.equal(labelToProse('the cos term'), 'the cos term');

/* ---- earlier wording rules still hold ---- */
assert.equal(noteClause({ target: '\\omega', label: 'frequency' }), '$\\omega$ is the frequency');
assert.equal(noteClause({ target: '\\omega', label: 'omega (frequency)' }), '$\\omega$ is the frequency');
assert.equal(noteClause({ target: 'R', label: 'new amplitude' }), '$R$ is the new amplitude');
assert.equal(noteClause({ target: 'c', label: 'the damping constant' }), '$c$ is the damping constant');
assert.equal(noteClause({ target: '-0.3', label: 'upward', color: 'red' }), '[[red: $-0.3$ is upward]]');
assert.equal(noteClause({ target: '$\\delta$', label: '\\text{phase shift}' }), '$\\delta$ is the phase shift');
// Pure math labels are still equations.
assert.equal(noteClause({ target: '\\cos(-\\delta)', label: '\\cos(\\delta)' }), '$\\cos(-\\delta) = \\cos(\\delta)$');
assert.equal(noteClause({ target: '\\omega t', label: 'a' }), '$a = \\omega t$');
assert.equal(noteClause({ target: '\\cos(\\delta)', label: '\\cos(\\delta)' }), null);
// A longer plain description doesn't get "the".
assert.equal(noteClause({ target: 'u', label: 'change from equilibrium position' }), '$u$ is change from equilibrium position');

/* ---- end to end ---- */
const md = [
  '$$u(t) = C_1\\cos(\\omega_n t) + C_2\\sin(\\omega_n t) + \\frac{f_0/m}{\\omega_n^2 - \\omega^2}\\cos(\\omega t)$$',
  '[[note: C_1\\cos(\\omega_n t) + C_2\\sin(\\omega_n t) | oscillation with frequency \\omega_n = \\sqrt{\\frac{k}{m}}]]',
  '[[note: \\frac{f_0/m}{\\omega_n^2 - \\omega^2}\\cos(\\omega t) | oscillation with frequency \\omega]]',
].join('\n');
const html = r(md);
assert(html.includes('is oscillation with frequency \\(\\omega_n = \\sqrt{\\frac{k}{m}}\\) and'), html);
assert(html.includes('is oscillation with frequency \\(\\omega\\).</span>'), html);
assert(!/oscillation\s*with\s*frequency\s*[^<]*=\s*\\\(\\omega_n/.test(html.replace('frequency \\(\\omega_n =', '')), 'no "=" joining term and words');
assert.deepEqual(latexWarnings(composeNotes(md)), []);
console.log('All note wording tests passed.');
