// Run: npm test   (Clean-Slate Redraw v2: LaTeX compiler, @eq menu, MathBox SVG, composable PlotScene & DiagramScene, Sketch CV + repair loop, v1 upgrade)
import assert from 'node:assert/strict';
import { redraw, V2_TEMPLATES, formatSceneDsl, parseSceneDsl, upgradeV1ToScene } from '../src/lib/redraw/index.ts';
import { EXAMPLES } from '../src/lib/redraw/examples.ts';
import { compileLatexExpr, evalBound, parseCasesExpr } from '../src/lib/redraw/v2/latexExpr.ts';
import { extractEquationMenu, expandEqRefs } from '../src/lib/redraw/v2/eqMenu.ts';
import { measureAndRenderMath } from '../src/lib/redraw/v2/mathSvg.ts';
import { analyzeSketch, verifySceneAgainstInk } from '../src/lib/redraw/v2/sketchCv.ts';
import { buildRedrawV2Prompt, runRedrawV2Conversation } from '../src/lib/redraw/v2/converseV2.ts';
import type { InkMap } from '../src/lib/layout.ts';

/* ---------------- 1. Native LaTeX Expression Compiler & Cases ---------------- */
{
  const f1 = compileLatexExpr(String.raw`\frac{\sin^2(t) + \cos^2(t)}{\sqrt{4}}`, ['t']);
  assert(Math.abs(f1.f(0.7) - 0.5) < 1e-10, '\\frac and \\sin^2 evaluate cleanly');

  const f2 = compileLatexExpr(String.raw`y = u_c(t) \cdot (t - c)`, ['t'], { c: 2 });
  assert.equal(f2.f(1.5), 0);
  assert(Math.abs(f2.f(3.25) - 1.25) < 1e-10, 'u_c(t) evaluates with parameter c');

  const f3 = compileLatexExpr(String.raw`\tan^{-1}(x) + |x - 2|`, ['x']);
  assert(Math.abs(f3.f(0) - 2) < 1e-10, '\\tan^{-1} and absolute value pipes work');

  assert(Math.abs((evalBound('\\frac{\\pi}{2}') as number) - Math.PI / 2) < 1e-10, 'LaTeX bound \\frac{\\pi}{2} resolves');

  const pieces = parseCasesExpr(String.raw`f(t) = \begin{cases} 0 & t < 2 \\ t - 2 & 2 \le t < 5 \\ 3 & t \ge 5 \end{cases}`);
  assert.ok(pieces && pieces.length === 3, 'parseCasesExpr splits all three branches');
  assert.equal(pieces[0].ends[1], 'open');
  assert.equal(pieces[1].ends[0], 'closed');
}

/* ---------------- 2. Equation Menu (@eq1, @eq2) ---------------- */
{
  const notes = [
    'We define the shifted ramp $$y = u_c(t)(t - c)$$.',
    '',
    '>>> THIS FIGURE <<<',
    '',
    'Earlier example was $g(t) = e^{-2t}\\sin(3t)$.',
  ].join('\n');
  const menu = extractEquationMenu(notes);
  assert(menu.length >= 2, 'extracts equations near figure');
  const expanded = expandEqRefs('from: @eq1\ncurve: @eq2', menu);
  assert(!expanded.includes('@eq1') && expanded.includes('u_c(t)'), 'expands @eq1 cleanly');
}

/* ---------------- 3. Pure SVG MathBox Typesetter & Self-Closing XML ---------------- */
{
  const box = measureAndRenderMath(String.raw`\frac{\alpha + \sqrt{x^2 + 1}}{\mathcal{L}\{f(t)\}}`);
  assert(box.width > 10 && box.height > 15, 'measures math box');
  const frag = box.render(10, 20);
  assert(frag.includes('<line ') && frag.includes('/>') && frag.includes('<path '), 'renders fraction bar and radical SVG elements');
  assert(!/<(?:line|path|rect|circle|polygon)\b[^>]*[^/]>/i.test(frag), 'all SVG shape elements are strictly self-closing');
}

/* ---------------- 4. Composable PlotScene & DiagramScene Rendering ---------------- */
{
  // Every V2 template compiles and renders valid self-closing SVG
  for (const [key, dsl] of Object.entries(V2_TEMPLATES)) {
    const res = redraw(dsl, { id: `tpl-${key}` });
    assert.ok(res.ok, `V2 template ${key} renders cleanly: ${!res.ok ? res.errors.join('; ') : ''}`);
    assert(res.svg.includes('<svg ') && res.svg.includes('</svg>'));
    assert(!/<(?:line|path|rect|circle|polygon)\b[^>]*[^/]>/i.test(res.svg), `${key}: all SVG shapes self-closing`);
  }

  // Polar rose + Parametric spiral + Implicit circle + Riemann trapezoid
  const polar = redraw('from: r = 2\\cos(2\\theta)\nspace: polar\naxes: r, θ\ncurve: 2*cos(2*θ) | form=polar | domain=[0, 2pi]', { id: 'pol' });
  assert.ok(polar.ok, 'polar rose renders');

  const param = redraw('from: (\\cos t, \\sin t)\naxes: x [-2, 2], y [-2, 2]\ncurve: cos(t); sin(t) | form=parametric | domain=[0, 2pi]', { id: 'par' });
  assert.ok(param.ok && param.svg.includes('<path '), 'parametric curve renders');

  const imp = redraw('from: x^2 + y^2 = 4\naxes: x [-3, 3], y [-3, 3]\ncurve: x^2 + y^2 - 4 | form=implicit', { id: 'imp' });
  assert.ok(imp.ok && imp.svg.includes('<path '), 'implicit contour renders');

  const riem = redraw('from: \\int_0^2 (x^2 + 1)\\,dx\naxes: x [0, 2], y\nshade: x^2 + 1 | on=[0, 2] | riemann=4:midpoint | area', { id: 'riem' });
  assert.ok(riem.ok && riem.svg.includes('<rect '), 'midpoint Riemann rectangles render');

  const sign1d = redraw('from: f\'(x)\nspace: 1d\naxes: x [-5, 5]\nsign: [-inf, 1]:-\nsign: [1, inf]:+\ninterval: (1, 4]', { id: 's1d' });
  assert.ok(sign1d.ok && sign1d.alt.short.includes('Sign chart'), '1D sign chart + interval renders');

  // Piecewise \begin{cases} directly inside curve:
  const casesPlot = redraw(
    String.raw`from: f(t) = \begin{cases} 0 & t < 2 \\ (t - 2)^2 & t \ge 2 \end{cases}` + '\naxes: t [0, 5], y [-0.5, 9]\ncurve: \\begin{cases} 0 & t < 2 \\\\ (t - 2)^2 & t \\ge 2 \\end{cases}',
    { id: 'cas' },
  );
  assert.ok(casesPlot.ok, 'LaTeX cases inside Line-DSL redraws without JSON escaping');
}

/* ---------------- 5. Round-Trip Formatting & V1-to-V2 Upgrader ---------------- */
{
  for (let i = 0; i < EXAMPLES.length; i++) {
    const ex = EXAMPLES[i];
    const scene = upgradeV1ToScene(ex.spec);
    const dsl = formatSceneDsl(scene);
    const reparsed = parseSceneDsl(dsl);
    assert.ok(reparsed.scene && reparsed.scene !== 'image', `example ${i} (${ex.name}) round-trips through Line-DSL`);
    const out = redraw(dsl, { id: `up-${i}` });
    assert.ok(out.ok, `upgraded example ${i} (${ex.name}) renders cleanly: ${!out.ok ? out.errors.join('; ') : ''}`);
  }
}

/* ---------------- 6. Pre-Model Ink CV, Verification & Closed-Loop Repair ---------------- */
{
  const W = 200;
  const H = 160;
  const inkBits = new Uint8Array(W * H);
  const dot = (x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const px = Math.round(x + dx);
        const py = Math.round(y + dy);
        if (px >= 0 && px < W && py >= 0 && py < H) inkBits[py * W + px] = 1;
      }
    }
  };
  // Draw axes at origin (x = 30, y = 130)
  for (let y = 15; y < 145; y++) dot(30, y);
  for (let x = 15; x < 185; x++) dot(x, 130);
  // Draw curve y = x/2 over x in [0, 4], y in [0, 2] mapped linearly to plot box
  for (let k = 0; k <= 80; k++) {
    const xVal = (k / 80) * 4;
    const yVal = 0.5 * xVal;
    const sx = 30 + (xVal / 4) * 150;
    const sy = 130 - (yVal / 2) * 110;
    dot(sx, sy);
  }
  const ink: InkMap = { w: W, h: H, ink: inkBits };
  const profile = analyzeSketch(ink);
  assert.equal(profile.frame, 'axes-2d', 'detects 2D axes frame from ink map');
  const hint = buildRedrawV2Prompt('We plot $y = x/2$.\n>>> THIS FIGURE <<<', [], profile);
  assert(hint.includes('Sketch geometry hint:'), 'includes CV geometry hint in prompt');

  // Correct curve passes high/medium ink match; wrong downward curve scores lower
  const ptsGood = Array.from({ length: 60 }, (_, k): [number, number] => {
    const x = (k / 59) * 4;
    return [x, 0.5 * x];
  });
  const ptsWrong = Array.from({ length: 60 }, (_, k): [number, number] => {
    const x = (k / 59) * 4;
    return [x, 2 - 0.5 * x];
  });
  const vGood = verifySceneAgainstInk(ink, profile, [ptsGood], [0, 4], [0, 2]);
  const vWrong = verifySceneAgainstInk(ink, profile, [ptsWrong], [0, 4], [0, 2]);
  assert(vGood.score > vWrong.score, `matching curve (${vGood.score.toFixed(2)}) outscores mirrored curve (${vWrong.score.toFixed(2)})`);

  // Closed-loop repair: round 1 syntax error -> round 2 repairs to valid Line-DSL
  let calls = 0;
  const outcome = await runRedrawV2Conversation(
    async () => {
      calls++;
      if (calls === 1) return 'curve: \\frac{1}{';
      return 'from: y = 0.5x\naxes: x [0, 4], y [0, 2]\ncurve: 0.5*x';
    },
    [{ role: 'user', content: hint }],
    { ink, profile },
  );
  assert.equal(outcome.status, 'ok');
  assert.equal(calls, 2);

  // Explicit "scene: image" opt-out stays none
  const keepImg = await runRedrawV2Conversation(async () => 'scene: image', [{ role: 'user', content: 'sketch' }]);
  assert.equal(keepImg.status, 'none');
}

console.log('tests/redrawV2.test.ts: all passed');
