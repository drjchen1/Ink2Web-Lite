/**
 * V2 Scene prompt + closed-loop Ink/Geometry verification conversation (Redraw v2).
 */
import type { InkMap } from '../../layout.ts';
import type { ChatMessage } from '../../ollama.ts';
import { formatEqMenuForPrompt, type EqItem } from './eqMenu.ts';
import { evaluateScene } from './evaluate.ts';
import { formatSceneDsl, parseSceneDsl } from './scene.ts';
import { analyzeSketch, formatSketchHint, verifySceneAgainstInk, type InkVerifyResult, type SketchProfile } from './sketchCv.ts';

export const REDRAW_V2_SYSTEM =
  'You turn hand-drawn math figures into a compact Line-DSL scene spec so the app can compute exact curves, schematics, and accessible descriptions.';

export interface RedrawV2Outcome {
  status: 'ok' | 'errors' | 'none' | 'unreadable';
  spec: string;
  errors: string[];
  confidence: InkVerifyResult['confidence'];
}

export function buildRedrawV2Prompt(notes: string, eqMenu: EqItem[], profile?: SketchProfile): string {
  const hint = profile ? formatSketchHint(profile) : '';
  const eqBlock = formatEqMenuForPrompt(eqMenu);

  return `The image is one hand-drawn figure from math notes. Below are nearby notes ("$" math, ">>> THIS FIGURE <<<" marks its spot).

Write a compact Line-DSL specification so the app can redraw it accurately.
If the drawing has NO equation or schematic in the notes (e.g. a casual doodle or photo), answer:
scene: image

${hint ? `Sketch geometry hint:\n${hint}\n\n` : ''}${eqBlock ? `${eqBlock}\n\n` : ''}Examples:

1. Function / piecewise step graph (use LaTeX directly, or reference @eq1):
from: @eq1
param: c = 2
axes: t [0, 4], f(t) [-0.5, 1.5]
curve: 0 | domain=[0, c] | ends=[closed, open]
curve: 1 | domain=[c, 4] | ends=[closed, closed] | guides

2. Schematic curve without explicit formula (e.g. f(t) vs f(t-c)):
from: f(t - c)
schematic: true
param: c = 2
axes: t [0, 5], y [-0.2, 2]
curve: f(t) | dashed | label="f(t)"
curve: f(t - c) | solid | label="f(t - c)"
arrow: [1.5, 0.9] -> [3.5, 0.9] | dashed | label="+c"

3. Shaded region / Riemann sum:
from: A = \\int_0^1 (\\sqrt{x} - x^2)\\,dx
axes: x, y
shade: \\sqrt{x} .. x^2 | on=intersections | slice=0.55:"\\Delta x"

4. ODE phase plane / 1D slope field:
from: y' = t - y
axes: t [-3, 3], y [-3, 3]
field: slope t - y | field | isoclines
flow: [0, 1]

5. Number line sign chart OR complex s-plane:
from: F(s) = \\frac{1}{s + 2}
space: complex
axes: Re(s), Im(s)
pole: [-2, 0]
roc: Re(s) > -2

6. Non-coordinate block / spring-mass diagram:
scene: diagram
from: Feedback loop G(s), H(s)
node: r = point("R(s)") @ (0, 0)
node: g = box("G(s)") @ (1, 0)
node: y = point("Y(s)") @ (2, 0)
edge: r -> g | arrow
edge: g -> y | arrow

Notes around this figure:
${notes}

Answer with the Line-DSL lines only (no markdown fences, no prose).`;
}

export async function runRedrawV2Conversation(
  ask: (messages: ChatMessage[]) => Promise<string>,
  first: ChatMessage[],
  opts?: { eqMenu?: EqItem[]; ink?: InkMap; profile?: SketchProfile },
): Promise<RedrawV2Outcome> {
  const eqMenu = opts?.eqMenu ?? [];
  const profile = opts?.profile ?? (opts?.ink ? analyzeSketch(opts.ink) : undefined);
  const messages = [...first];

  let best: RedrawV2Outcome = {
    status: 'unreadable',
    spec: '',
    errors: ['The model didn’t answer with a usable Line-DSL spec.'],
    confidence: 'low',
  };

  for (let round = 0; round < 2; round++) {
    const answer = await ask(messages);
    const parsed = parseSceneDsl(answer, eqMenu);
    if (parsed.scene === 'image') return { status: 'none', spec: '', errors: [], confidence: 'high' };

    let repairProblems: string[] = [];
    if (!parsed.scene) {
      repairProblems = parsed.errors.length ? parsed.errors : ['Could not parse Line-DSL.'];
    } else {
      const ev = evaluateScene(parsed.scene, { aspect: profile?.aspect });
      if (!ev.evaluated) {
        repairProblems = ev.errors;
        const formatted = formatSceneDsl(parsed.scene);
        if (best.status === 'unreadable' || ev.errors.length <= best.errors.length) {
          best = { status: 'errors', spec: formatted, errors: ev.errors, confidence: 'low' };
        }
      } else {
        let confidence: InkVerifyResult['confidence'] = 'high';
        let diagnostic: string | null = null;
        if (opts?.ink && profile && ev.evaluated.kind === 'plot') {
          const v = verifySceneAgainstInk(
            opts.ink,
            profile,
            ev.evaluated.polylines,
            ev.evaluated.xWindow,
            ev.evaluated.yWindow,
            {
              skip: ev.evaluated.spec.space === '1d' || ev.evaluated.spec.space === 'complex' || (ev.evaluated.fields.length > 0 && ev.evaluated.flows.length === 0),
              schematic: !!ev.evaluated.spec.schematic,
            },
          );
          confidence = v.confidence;
          diagnostic = v.diagnostic;
        }
        const formatted = formatSceneDsl(parsed.scene);
        const rank = confidence === 'high' ? 3 : confidence === 'medium' ? 2 : 1;
        const bestRank = best.status !== 'ok' ? 0 : best.confidence === 'high' ? 3 : best.confidence === 'medium' ? 2 : 1;
        if (rank >= bestRank) best = { status: 'ok', spec: formatted, errors: [], confidence };
        if (confidence === 'high' || round === 1 || !diagnostic) return best;
        repairProblems = [diagnostic];
      }
    }

    messages.push(
      { role: 'assistant', content: answer },
      {
        role: 'user',
        content: `Please check these issues and reply with the corrected Line-DSL only (or "scene: image" if this sketch shouldn't be redrawn):\n${repairProblems.map((e) => `- ${e}`).join('\n')}`,
      },
    );
  }

  return best;
}
