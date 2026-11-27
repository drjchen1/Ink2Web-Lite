import type { ChatMessage } from '../ollama.ts';
import { checkSpec } from './spec.ts';
import { formatSpec, repairPrompt, tidyModelSpec } from './prompt.ts';

export interface RedrawOutcome {
  /**
   * ok: a spec that passes every check. errors: a spec with problems (shown so the user
   * can fix it). none: the model found no equation for this figure in the notes.
   * unreadable: the model didn't answer with JSON.
   */
  status: 'ok' | 'errors' | 'none' | 'unreadable';
  /** The spec as pretty JSON ('' for none/unreadable). */
  spec: string;
  errors: string[];
  /** Optional confidence tag from v2 ink verification. */
  confidence?: 'high' | 'medium' | 'low';
}

/**
 * The question-and-repair loop behind redrawFigure (pipeline.ts), with the model call
 * passed in so it can be tested without a browser or a model. At most two answers: a
 * spec that fails the checks goes back once with its problems listed, and the better
 * of the two answers is kept (a repair can make things worse).
 */
export async function specConversation(ask: (messages: ChatMessage[]) => Promise<string>, first: ChatMessage[]): Promise<RedrawOutcome> {
  const messages = [...first];
  let best: RedrawOutcome = { status: 'unreadable', spec: '', errors: ['The model didn’t answer with a spec.'] };
  for (let round = 0; round < 2; round++) {
    const answer = await ask(messages);
    const spec = tidyModelSpec(answer);
    if (spec === 'none') return { status: 'none', spec: '', errors: [] };
    let problems: string[];
    if (spec === null) problems = ['The answer was not valid JSON.'];
    else {
      const { errors } = checkSpec(spec);
      const outcome: RedrawOutcome = { status: errors.length ? 'errors' : 'ok', spec: formatSpec(spec), errors };
      if (best.status === 'unreadable' || errors.length <= best.errors.length) best = outcome;
      if (!errors.length) return best;
      problems = errors;
    }
    messages.push({ role: 'assistant', content: answer }, { role: 'user', content: repairPrompt(problems) });
  }
  return best;
}
