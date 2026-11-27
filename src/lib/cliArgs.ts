import type { Provider } from '../types.ts';
import type { BuiltinPromptId } from './prompts.ts';
import type { ExportLook } from './exportHtml.ts';

/** Options parsed from the headless CLI (`npm run convert -- ...`). Zero Node imports so tests & browser share it. */
export interface CliOptions {
  inputs: string[];
  help: boolean;
  model: string;
  numCtx: number;
  detail: number;
  promptSet: BuiltinPromptId;
  look: ExportLook;
  outDir: string;
  title: string;
  offline: boolean;
  jsonOnly: boolean;
  htmlOnly: boolean;
  autoRedraw: boolean;
  enhance: boolean;
  splitDensePages: boolean;
  keepLoaded: boolean;
  provider: Provider;
  ollamaUrl: string;
  genaiUrl: string;
}

export const CLI_HELP = `Ink2Web Lite CLI — headless batch conversion (creates .ink2web.json + accessible .html)

Usage:
  npm run convert -- <files...> [options]

Inputs:
  One or more PDF, PNG, JPEG, WebP, GIF, BMP, or .ink2web.json files.
  Passing a .ink2web.json project re-exports HTML cleanly without calling Ollama.

Options:
  -h, --help                Show this help text
  --model <name>            Ollama or GenAI Studio model name (default: auto-pick best installed)
  --8gb                     Use 8 GB memory preset (sets num_ctx = 4096 unless --ctx is given)
  --ctx <number>            Context window tokens (default: 8192, min: 2048)
  --detail <mode|px>        fast (1024), balanced (1344, default), high (1792), or pixel number
  --prompt <id>             everyday (default) or large
  --look <style>            cards (default) or classic
  --out <dir>               Output directory (default: same folder as each input file)
  --title <text>            Override document title (default: first heading or file name)
  --offline                 Pre-render MathJax offline SVG/MathML into the exported HTML
  --json-only               Write only <slug>.ink2web.json (for Review UI touch-up)
  --html-only               Write only <slug>.html
  --redraw                  Also run mathematical SVG redraw pass (default: crop only)
  --no-enhance              Disable contrast stretch preprocessing
  --no-split                Disable two-column / dense-band splitting
  --keep-loaded             Keep Ollama model pinned in RAM after finishing (default: unloads)
  --ollama-url <url>        Ollama URL (default: http://127.0.0.1:11434 or OLLAMA_HOST)
  --genai                   Use Purdue GenAI Studio (reads GENAI_API_KEY from env or .env.local)

Examples:
  npm run convert -- notes/lecture05.pdf --8gb
  npm run convert -- notes/*.pdf --model qwen3.5:4b-mlx --offline --out ./out
  npm run convert -- lecture05.ink2web.json --offline --look cards`;

const DETAIL_MAP: Record<string, number> = { fast: 1024, balanced: 1344, high: 1792 };

/** Parses CLI flags purely so both `cli/convert.ts` and unit tests can validate every option. */
export function parseCliArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    inputs: [],
    help: false,
    model: '',
    numCtx: 8192,
    detail: 1344,
    promptSet: 'everyday',
    look: 'cards',
    outDir: '',
    title: '',
    offline: false,
    jsonOnly: false,
    htmlOnly: false,
    autoRedraw: false,
    enhance: true,
    splitDensePages: true,
    keepLoaded: false,
    provider: 'ollama',
    ollamaUrl: 'http://127.0.0.1:11434',
    genaiUrl: 'https://genai.rcac.purdue.edu',
  };

  let explicitCtx = false;
  let use8gb = false;

  const take = (i: number, flag: string): string => {
    if (i + 1 >= argv.length) throw new Error(`Missing value after ${flag}`);
    return argv[i + 1];
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      opts.inputs.push(...argv.slice(i + 1));
      break;
    }
    if (a === '-h' || a === '--help') {
      opts.help = true;
    } else if (a === '--8gb') {
      use8gb = true;
    } else if (a === '--offline') {
      opts.offline = true;
    } else if (a === '--json-only') {
      opts.jsonOnly = true;
    } else if (a === '--html-only') {
      opts.htmlOnly = true;
    } else if (a === '--redraw') {
      opts.autoRedraw = true;
    } else if (a === '--no-redraw') {
      opts.autoRedraw = false;
    } else if (a === '--no-enhance') {
      opts.enhance = false;
    } else if (a === '--no-split') {
      opts.splitDensePages = false;
    } else if (a === '--keep-loaded') {
      opts.keepLoaded = true;
    } else if (a === '--genai') {
      opts.provider = 'genai';
    } else if (a === '--model') {
      opts.model = take(i, a);
      i++;
    } else if (a === '--ctx') {
      const n = Number(take(i, a));
      if (!Number.isFinite(n) || n < 512) throw new Error(`Invalid --ctx value: ${argv[i + 1]}`);
      opts.numCtx = Math.max(2048, Math.round(n));
      explicitCtx = true;
      i++;
    } else if (a === '--detail') {
      const v = take(i, a).toLowerCase();
      if (v in DETAIL_MAP) {
        opts.detail = DETAIL_MAP[v];
      } else {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 256) throw new Error(`Invalid --detail value: ${argv[i + 1]}`);
        opts.detail = Math.round(n);
      }
      i++;
    } else if (a === '--prompt') {
      const v = take(i, a).toLowerCase();
      if (v !== 'everyday' && v !== 'large') throw new Error(`Invalid --prompt value: ${argv[i + 1]} (use everyday or large)`);
      opts.promptSet = v;
      i++;
    } else if (a === '--look') {
      const v = take(i, a).toLowerCase();
      if (v !== 'cards' && v !== 'classic') throw new Error(`Invalid --look value: ${argv[i + 1]} (use cards or classic)`);
      opts.look = v;
      i++;
    } else if (a === '--out') {
      opts.outDir = take(i, a);
      i++;
    } else if (a === '--title') {
      opts.title = take(i, a);
      i++;
    } else if (a === '--ollama-url') {
      opts.ollamaUrl = take(i, a);
      i++;
    } else if (a === '--genai-url') {
      opts.genaiUrl = take(i, a);
      i++;
    } else if (a.startsWith('-')) {
      throw new Error(`Unknown option: ${a}`);
    } else {
      opts.inputs.push(a);
    }
  }

  if (use8gb && !explicitCtx) opts.numCtx = 4096;
  if (opts.jsonOnly && opts.htmlOnly) throw new Error('Cannot combine --json-only and --html-only');
  return opts;
}
