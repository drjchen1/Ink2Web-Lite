// Run: npm test   (Everyday hardware models: priority pickModel, Gemma4 paramsB, per-task thinking policy, LightOnOCR grounding/cleanup, Ollama 400 fallback)
import assert from 'node:assert/strict';
import { paramsB } from '../src/lib/genai.ts';
import { VISION_NAME, isLightOnOcrModel, isSmallEdgeModel, pickModel, resolveTaskThink } from '../src/lib/model.ts';
import { chat } from '../src/lib/ollama.ts';
import { cleanLightOnOcrOutput, cleanModelOutput, extractFigures, fixSingleDollarDisplayEnvs, htmlTablesToMarkdown, stripThinkingTraces, unescapeInlineMathDollars } from '../src/lib/transcript.ts';
import { markdownToHtml } from '../src/lib/markdown.ts';
import type { ModelInfo } from '../src/types.ts';

/* ---------------- 1. Model sizing & vision detection ---------------- */
assert.equal(paramsB('qwen3.5:4b-mlx'), 4);
assert.equal(paramsB('Maternion/LightOnOCR-3:4b-q4_K_M'), 4);
assert.equal(paramsB('ministral-3:3b'), 3);
assert.equal(paramsB('qwen3.5:2b-mlx'), 2);
assert.equal(paramsB('gemma4:e2b-it-qat'), 2);

for (const name of [
  'qwen3.5:4b-mlx',
  'Maternion/LightOnOCR-3:4b-q4_K_M',
  'lightonocr-3:3b',
  'ministral-3:3b',
  'qwen3.5:2b-mlx',
  'gemma4:e2b-it-qat',
  'llama3.2-vision:11b',
  'pixtral:12b',
  'internvl3:8b',
  'qwen2.5vl:7b',
]) {
  assert(VISION_NAME.test(name), `${name} recognized as vision-capable`);
}
assert(isLightOnOcrModel('Maternion/LightOnOCR-3:4b-q4_K_M'));
assert(isLightOnOcrModel('lightonocr-3:3b'));
assert(!isLightOnOcrModel('qwen3.5:4b-mlx'));
assert(!isSmallEdgeModel('qwen3.5:4b-mlx', 3.4));
assert(isSmallEdgeModel('qwen3.5:2b-mlx', 1.8));
assert(isSmallEdgeModel('gemma4:e2b-it-qat', 2.4));
assert(isSmallEdgeModel('ministral-3:3b', 2.9));

/* ---------------- 2. Priority pickModel order ---------------- */
const mk = (name: string, vision: boolean | null = true, thinking = false, sizeGB = 3): ModelInfo => ({ name, vision, thinking, sizeGB });
assert.equal(
  pickModel([
    mk('gemma4:e2b-it-qat', true, true, 2.4),
    mk('qwen3.5:2b-mlx', true, true, 1.8),
    mk('ministral-3:3b', true, false, 2.9),
    mk('Maternion/LightOnOCR-3:4b-q4_K_M', true, false, 2.8),
    mk('qwen3.5:4b-mlx', true, true, 3.4),
  ]),
  'qwen3.5:4b-mlx',
);
assert.equal(
  pickModel([mk('gemma4:e2b-it-qat'), mk('ministral-3:3b'), mk('lightonocr-3:3b')]),
  'lightonocr-3:3b',
);
assert.equal(
  pickModel([mk('gemma4:e2b-it-qat'), mk('ministral-3:3b'), mk('Maternion/LightOnOCR-3:4b-q4_K_M')]),
  'Maternion/LightOnOCR-3:4b-q4_K_M',
);
assert.equal(pickModel([mk('gemma4:e2b-it-qat'), mk('qwen3.5:2b-mlx'), mk('ministral-3:3b')]), 'ministral-3:3b');
assert.equal(pickModel([mk('gemma4:e2b-it-qat'), mk('qwen3.5:2b-mlx')]), 'qwen3.5:2b-mlx');
assert.equal(pickModel([mk('gemma4:e2b-it-qat')]), 'gemma4:e2b-it-qat');

/* ---------------- 3. Per-task thinking policy ---------------- */
// qwen3.5:4b-mlx (capable >= 4B thinking model): off for OCR/JSON, off on R1 auto-redraw, ON for repair & manual redraw
assert.equal(resolveTaskThink('transcribe', { model: 'qwen3.5:4b-mlx', supportsThinking: true }), false);
assert.equal(resolveTaskThink('reread', { model: 'qwen3.5:4b-mlx', supportsThinking: true }), false);
assert.equal(resolveTaskThink('locate', { model: 'qwen3.5:4b-mlx', supportsThinking: true }), false);
assert.equal(resolveTaskThink('shortAlt', { model: 'qwen3.5:4b-mlx', supportsThinking: true }), false);
assert.equal(resolveTaskThink('describe', { model: 'qwen3.5:4b-mlx', supportsThinking: true }), false);
assert.equal(resolveTaskThink('redrawAuto', { model: 'qwen3.5:4b-mlx', supportsThinking: true }), false);
assert.equal(resolveTaskThink('redrawRepair', { model: 'qwen3.5:4b-mlx', supportsThinking: true }), true);
assert.equal(resolveTaskThink('redrawManual', { model: 'qwen3.5:4b-mlx', supportsThinking: true }), true);

// LightOnOCR-3 always forces think: false
assert.equal(resolveTaskThink('transcribe', { model: 'Maternion/LightOnOCR-3:4b-q4_K_M', supportsThinking: true }), false);
assert.equal(resolveTaskThink('redrawManual', { model: 'Maternion/LightOnOCR-3:4b-q4_K_M', supportsThinking: true }), false);

// ministral-3:3b (non-thinking) omits `think`
assert.equal(resolveTaskThink('transcribe', { model: 'ministral-3:3b', supportsThinking: false }), undefined);
assert.equal(resolveTaskThink('redrawManual', { model: 'ministral-3:3b', supportsThinking: false }), undefined);

// 2B / E2B fallback models keep thinking off even on redraw repair/manual
assert.equal(resolveTaskThink('redrawRepair', { model: 'qwen3.5:2b-mlx', supportsThinking: true }), false);
assert.equal(resolveTaskThink('redrawManual', { model: 'gemma4:e2b-it-qat', supportsThinking: true }), false);

// General non-everyday models receive clean resolveTaskThink defaults
assert.equal(resolveTaskThink('transcribe', { model: 'llama3.2-vision:11b', supportsThinking: false }), undefined);
assert.equal(resolveTaskThink('transcribe', { model: 'qwen2.5vl:7b', supportsThinking: false }), undefined);
assert.equal(resolveTaskThink('redrawManual', { model: 'pixtral:12b', supportsThinking: false }), undefined);
assert.equal(resolveTaskThink('redrawRepair', { model: 'internvl3:8b', supportsThinking: false }), undefined);

// GenAI Studio never sends Ollama's `think` field
assert.equal(resolveTaskThink('redrawManual', { model: 'qwen3.5:4b-mlx', supportsThinking: true, provider: 'genai' }), undefined);

/* ---------------- 4. Multi-model thinking trace & format cleanup ---------------- */
assert.equal(stripThinkingTraces('<|channel>thought\n<channel|>Hello'), 'Hello');
assert.equal(stripThinkingTraces('<|thought|>steps<|/thought|>Done'), 'Done');
assert.equal(stripThinkingTraces('[THINK]plan[/THINK]Result'), 'Result');
assert.equal(stripThinkingTraces('<think>unclosed'), '');

const alignedSingleDollar = fixSingleDollarDisplayEnvs('$\\begin{aligned}\na &= 1 \\\\\nb &= 2\n\\end{aligned}$');
assert(alignedSingleDollar.startsWith('$$') && alignedSingleDollar.endsWith('$$'), 'promotes single-$ aligned env to $$');

const mdTable = htmlTablesToMarkdown('<table><tr><th>x</th><th>y</th></tr><tr><td>0</td><td>1</td></tr></table>');
assert(mdTable.includes('| x | y |') && mdTable.includes('| --- | --- |') && mdTable.includes('| 0 | 1 |'));

// Paired escaped math delimiters unescape while escaped currency stays literal
assert.equal(unescapeInlineMathDollars('If \\$f(x)\\$ on \\$a\\$ costs \\$5 and \\$10'), 'If $f(x)$ on $a$ costs \\$5 and \\$10');
const currencyHtml = markdownToHtml(cleanModelOutput('Costs \\$5 and \\$10 for \\$f(x)\\$.'), { figure: () => '' });
assert(currencyHtml.includes('Costs $5 and $10 for \\(f(x)\\).'));

const lightOnRaw = [
  '![title](80,50,900,110)',
  '## Lesson 12',
  '![page_number](900,20,960,50)',
  '12',
  '![text](80,140,900,210)',
  'Find $\\int_0^1 x^2\\,dx$.',
  '![chart](100,250,500,600)',
  '<table><tr><td>0</td><td>0</td></tr><tr><td>1</td><td>1</td></tr></table>',
  '![image](550,250,900,600)',
  'Parabola opening upward through (0, 0)',
].join('\n');
const lo = cleanLightOnOcrOutput(lightOnRaw);
assert.equal(lo.boxes.length, 2, 'extracts both chart and image bounding boxes');
assert(Math.abs(lo.boxes[0].x - 0.1) < 1e-6 && Math.abs(lo.boxes[1].x - 0.55) < 1e-6);
assert(!lo.text.includes('![title]') && !/^12$/m.test(lo.text) && !lo.text.includes('<table>'));
assert(lo.text.includes('[[FIGURE: Chart or graph]]'));
assert(lo.text.includes('[[FIGURE: Parabola opening upward through (0, 0)]]'));
assert(cleanModelOutput('<|channel>thought\n<channel|>Hi $\\text{only}$').includes('Hi only'));

// End-to-end regression: lightonocr-3:3b inline grounding tags + fake plot tables + mixed \$f(x)\$ / \(...\) math
const docPdfLightOnRaw = [
  '![title](193,129,649,166) # Fundamental Theorem of Calculus',
  '![text](193,192,740,227) If \\$f(x)\\$ is continuous on \\(a \\leq x \\leq b\\) then',
  "![formula](213,242,768,294) \\[\\int_a^b f(x) \\, dx = F(b) - F(a) \\quad \\text{where} \\quad F' = f\\]",
  '![text](183,314,871,362) for example,',
  '\\[\\int_0^{\\pi/2} \\sin(x) \\, dx = -\\cos\\left(\\frac{\\pi}{2}\\right) + \\cos(0) = 1\\]',
  '![text](188,385,923,416) this represents the area under the curve \\$f(x)\\$ above \\(x\\) -axis',
  '![image](336,424,572,574)',
  '',
  '| x | f(x) = sin(x) |',
  '',
  '| --- | --- |',
  '',
  '| 0 | 0 |',
  '',
  '| π/2 | 1 |',
  '![text](322,603,678,633) the shaded region has area 1',
  '![title](184,668,477,692) ## Area between two curves',
  '![image](288,698,602,887)',
  '',
  '| x | f(x) | g(x) |',
  '',
  '| --- | --- | --- |',
  '',
  '| a | ? | ? |',
  '',
  '| b | ? | ? |',
  '![formula](652,705,824,820) \\[\\int_a^b [f(x) - g(x)] \\, dx\\]',
].join('\n');

const loDoc = cleanLightOnOcrOutput(docPdfLightOnRaw);
assert.equal(loDoc.boxes.length, 2, 'extracts both graph bounding boxes');
const cleanedDoc = cleanModelOutput(loDoc.text);
const { source: docSource, descriptions: docDescs } = extractFigures(cleanedDoc);
assert.equal(docDescs.length, 2, 'produces 2 figure markers');
const docHtml = markdownToHtml(docSource, { figure: (id) => `<figure id="fig-${id}"></figure>` });
assert(!/!\[/.test(docHtml), 'no raw ![label](...) grounding tags remain in HTML');
assert(!docHtml.includes('| --- |') && !docHtml.includes('| a | ? | ? |'), 'no hallucinated plot tables in HTML');
assert(docHtml.includes('<h2>Fundamental Theorem of Calculus</h2>'), 'first heading renders as h2');
assert(docHtml.includes('<h3>Area between two curves</h3>'), 'second heading renders as h3');
assert(docHtml.includes('\\(f(x)\\)') && docHtml.includes('\\(a \\leq x \\leq b\\)'), 'inline math renders consistently');
assert.equal((docHtml.match(/<div class="math-display">\\\[/g) ?? []).length, 3, 'all 3 display integrals render as display math');
assert(docHtml.includes('<figure id="fig-1"></figure>') && docHtml.includes('<figure id="fig-2"></figure>'));

// Genuine ![table](...) block with blank-line-separated pipe rows becomes a semantic HTML <table>
const genuineTableRaw = [
  '![table](100,200,900,400)',
  '| t | y(t) |',
  '',
  '| --- | --- |',
  '',
  '| 0 | 1 |',
].join('\n');
const genuineTableHtml = markdownToHtml(cleanModelOutput(genuineTableRaw), { figure: () => '' });
assert(genuineTableHtml.includes('<table>') && genuineTableHtml.includes('<th scope="col">t</th>'));

/* ---------------- 5. Ollama client `think` handling & 400 fallback ---------------- */
{
  const realFetch = globalThis.fetch;
  const sentBodies: Record<string, unknown>[] = [];
  let replyMode: 'ok' | 'reject400' = 'ok';
  const ndjson = (lines: object[]) =>
    new Response(new Blob([lines.map((l) => `${JSON.stringify(l)}\n`).join('')]).stream(), { status: 200 });

  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
    sentBodies.push(body);
    if (replyMode === 'reject400' && 'think' in body) {
      replyMode = 'ok';
      return new Response(JSON.stringify({ error: '"ministral-3:3b" does not support thinking' }), { status: 400 });
    }
    return ndjson([
      { message: { thinking: 'internal thoughts should be ignored' }, done: false },
      { message: { content: 'Answer ' }, done: false },
      { message: { content: '42' }, done: true },
    ]);
  }) as typeof fetch;

  try {
    const out1 = await chat({ baseUrl: '/ollama', model: 'qwen3.5:4b-mlx', think: true, messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(out1, 'Answer 42');
    assert.equal(sentBodies[0].think, true);

    sentBodies.length = 0;
    replyMode = 'reject400';
    const out2 = await chat({ baseUrl: '/ollama', model: 'ministral-3:3b', think: false, messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(out2, 'Answer 42');
    assert.equal(sentBodies.length, 2, 'retries cleanly without `think` after 400');
    assert.equal('think' in sentBodies[0], true);
    assert.equal('think' in sentBodies[1], false);
  } finally {
    globalThis.fetch = realFetch;
  }
}

console.log('Everyday model optimization tests passed.');
