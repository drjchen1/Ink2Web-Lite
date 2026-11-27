import fs from 'node:fs/promises';
import path from 'node:path';
import type { ModelInfo, Page, Settings } from '../src/types.ts';
import { CLI_HELP, parseCliArgs } from '../src/lib/cliArgs.ts';
import { buildDocument, fileSlug, looksLikeFileName } from '../src/lib/exportHtml.ts';
import { pageIssues } from '../src/lib/editing.ts';
import * as genai from '../src/lib/genai.ts';
import { pickModel } from '../src/lib/model.ts';
import * as ollama from '../src/lib/ollama.ts';
import { convertPage } from '../src/lib/pipeline.ts';
import { transcribePrompt } from '../src/lib/prompts.ts';
import { projectFromJson, projectToJson } from '../src/lib/storage.ts';
import { loadNodeFile, nodeRaster } from './nodeRaster.ts';
import { prerenderOfflineHtmlNode } from './nodeMathjax.ts';

/**
 * Headless Ink2Web Lite batch CLI (`npm run convert -- ...`).
 * Keeps Node RAM low (~100-150 MB) so Ollama can use all available memory on 8 GB
 * machines, outputs portable `.ink2web.json` projects for UI touch-up and accessible
 * `.html`, and automatically unloads the Ollama model when finished.
 */

async function readGenAiKey(): Promise<string> {
  if (process.env.GENAI_API_KEY) return process.env.GENAI_API_KEY;
  for (const name of ['.env.local', '.env']) {
    try {
      const txt = await fs.readFile(path.join(process.cwd(), name), 'utf8');
      const m = txt.match(/^\s*GENAI_API_KEY\s*=\s*(.+?)\s*$/m);
      if (m) return m[1].replace(/^["']|["']$/g, '').trim();
    } catch {
      /* file absent */
    }
  }
  return '';
}

async function resolveModel(
  requested: string,
  provider: 'ollama' | 'genai',
  ollamaUrl: string,
  genaiUrl: string,
  apiKey: string,
): Promise<{ name: string; thinking: boolean }> {
  let list: ModelInfo[];
  try {
    list = provider === 'genai' ? await genai.listModels(genaiUrl, apiKey) : await ollama.listModels(ollamaUrl);
  } catch (e) {
    if (requested) return { name: requested, thinking: /\b(?:qwen3\.5|gemma-?4|deepseek-r1|qwq)\b/i.test(requested) };
    throw e;
  }
  if (!list.length) {
    if (requested) return { name: requested, thinking: false };
    throw new Error(
      provider === 'genai'
        ? 'GenAI Studio returned no models for GENAI_API_KEY.'
        : `No Ollama models found at ${ollamaUrl}. Pull a vision model first (e.g. ollama pull qwen3.5:4b-mlx).`,
    );
  }
  if (requested) {
    const exact = list.find((m) => m.name === requested);
    if (!exact) {
      return { name: requested, thinking: /\b(?:qwen3\.5|gemma-?4|deepseek-r1|qwq)\b/i.test(requested) };
    }
    return { name: exact.name, thinking: exact.thinking };
  }
  const chosen = pickModel(list);
  const info = list.find((m) => m.name === chosen);
  if (!chosen || info?.vision === false) {
    throw new Error('No vision-capable model found. Pass --model <name> or pull a vision model first.');
  }
  return { name: chosen, thinking: info?.thinking ?? false };
}

async function main() {
  const opts = parseCliArgs(process.argv.slice(2));
  if (opts.help || !opts.inputs.length) {
    console.log(CLI_HELP);
    process.exit(opts.help ? 0 : 1);
  }

  const ollamaUrl = process.env.OLLAMA_HOST || opts.ollamaUrl;
  const genaiUrl = process.env.GENAI_URL || opts.genaiUrl;
  const needsModel = opts.inputs.some((f) => !/\.json$/i.test(f));
  const apiKey = needsModel && opts.provider === 'genai' ? await readGenAiKey() : '';
  if (needsModel && opts.provider === 'genai' && !apiKey) {
    throw new Error('Missing GENAI_API_KEY (set env var or add to .env.local).');
  }

  const resolvedModel = needsModel ? await resolveModel(opts.model, opts.provider, ollamaUrl, genaiUrl, apiKey) : { name: '', thinking: false };
  if (needsModel) {
    console.log(
      `Model: ${resolvedModel.name} (${opts.provider}, num_ctx=${opts.numCtx}, detail=${opts.detail}px, prompt=${opts.promptSet}, redraw=${opts.autoRedraw ? 'on' : 'crop-only'})`,
    );
  }

  const settings: Settings = {
    provider: opts.provider,
    lastModels: {},
    baseUrl: ollamaUrl,
    model: resolvedModel.name,
    detail: opts.detail,
    enhance: opts.enhance,
    locateFigures: true,
    numCtx: opts.numCtx,
    promptSet: opts.promptSet,
    describeFigures: opts.promptSet === 'large',
    autoRedraw: opts.autoRedraw,
    splitDensePages: opts.splitDensePages,
    unloadAfterConvert: !opts.keepLoaded,
  };
  const promptText = transcribePrompt(opts.promptSet);
  const env = { raster: nodeRaster, apiKey, genaiUrl };

  let totalIssues = 0;

  try {
    for (const inputPath of opts.inputs) {
      const absIn = path.resolve(inputPath);
      const outDir = opts.outDir ? path.resolve(opts.outDir) : path.dirname(absIn);
      await fs.mkdir(outDir, { recursive: true });
      const rawName = path.basename(absIn);

      if (/\.json$/i.test(rawName)) {
        const text = await fs.readFile(absIn, 'utf8');
        const session = projectFromJson(text);
        const pages: Page[] = session.pages.map((p) => ({ ...p, url: '' }));
        const done = pages.filter((p) => p.status === 'done');
        const title = opts.title || session.title || rawName.replace(/\.ink2web\.json$|\.json$/i, '');
        const slug = fileSlug(title);
        const baseOut = path.join(outDir, slug);

        if (opts.jsonOnly) {
          const outJson = await projectToJson({ ...session, title }, pages);
          await fs.writeFile(`${baseOut}.ink2web.json`, outJson, 'utf8');
          console.log(`Wrote ${baseOut}.ink2web.json`);
          continue;
        }
        let html = buildDocument(done, {
          title,
          titleFromFileName: !opts.title && session.titleAuto,
          lang: 'en',
          pageMarkers: session.pageMarkers,
          look: opts.look,
        });
        if (opts.offline) html = await prerenderOfflineHtmlNode(html);
        await fs.writeFile(`${baseOut}.html`, html, 'utf8');
        console.log(`Wrote ${baseOut}.html (${done.length} page${done.length === 1 ? '' : 's'}${opts.offline ? ', offline' : ''})`);
        continue;
      }

      process.stdout.write(`Reading ${rawName}…`);
      const loaded = await loadNodeFile(absIn, (n, total) => {
        if (total > 1) process.stdout.write(`\rReading ${rawName}: page ${n}/${total}…`);
      });
      console.log(`\rLoaded ${rawName}: ${loaded.length} page${loaded.length === 1 ? '' : 's'}`);

      const pages: Page[] = loaded.map((l, idx) => ({
        ...l,
        id: `cli-${idx + 1}`,
        url: '',
        status: 'idle',
        source: '',
        figures: [],
      }));

      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const t0 = Date.now();
        let lastPhase = '';
        let lastDetail = '';
        const ac = new AbortController();
        process.stdout.write(`  [${i + 1}/${pages.length}] ${page.label}: transcribing…`);
        const res = await convertPage(
          page,
          settings,
          resolvedModel.thinking,
          ac.signal,
          (prog) => {
            if (prog.detail && prog.detail !== lastDetail) {
              lastDetail = prog.detail;
              process.stdout.write(` ${prog.detail}…`);
            } else if (prog.phase !== lastPhase && prog.phase === 'locating') {
              lastPhase = 'locating';
              process.stdout.write(' figures…');
            }
          },
          promptText,
          env,
        );
        pages[i] = { ...page, ...res, status: 'done' };
        const redrawnCount = res.figures.filter((f) => f.redraw?.show === 'redrawn' || f.redraw?.show === 'both').length;
        const issues = pageIssues(pages[i]);
        totalIssues += issues.length;
        const secs = ((Date.now() - t0) / 1000).toFixed(1);
        console.log(
          ` done (${secs}s, ${res.figures.length} fig${res.figures.length === 1 ? '' : 's'}${redrawnCount ? `, ${redrawnCount} redrawn` : ''}${issues.length ? `, ${issues.length} to check` : ''})`,
        );
      }

      const defaultTitle = opts.title || rawName.replace(/\.[^.]+$/, '');
      const titleAuto = !opts.title && looksLikeFileName(rawName);
      const slugBase = fileSlug(rawName.replace(/\.[^.]+$/, ''));
      const outStem = path.join(outDir, slugBase);

      if (!opts.htmlOnly) {
        const json = await projectToJson({ title: defaultTitle, titleAuto, pageMarkers: true }, pages);
        await fs.writeFile(`${outStem}.ink2web.json`, json, 'utf8');
        console.log(`  → Saved ${outStem}.ink2web.json (open in Web UI for quick touch-up)`);
      }

      if (!opts.jsonOnly) {
        let html = buildDocument(pages, {
          title: defaultTitle,
          titleFromFileName: titleAuto,
          lang: 'en',
          pageMarkers: true,
          look: opts.look,
          sourceFile: opts.look === 'cards' ? rawName : undefined,
        });
        if (opts.offline) {
          process.stdout.write('  → Pre-rendering offline MathJax equations…');
          html = await prerenderOfflineHtmlNode(html);
          console.log(' done');
        }
        await fs.writeFile(`${outStem}.html`, html, 'utf8');
        console.log(`  → Wrote ${outStem}.html`);
      }
    }

    if (totalIssues > 0) {
      console.log(`\nNote: ${totalIssues} flagged item(s) across converted pages. Open the .ink2web.json file in Ink2Web Lite to review them.`);
    }
  } finally {
    if (needsModel && opts.provider === 'ollama' && !opts.keepLoaded && resolvedModel.name) {
      const unloaded = await ollama.unloadModel(ollamaUrl, resolvedModel.name);
      if (unloaded) console.log(`Unloaded ${resolvedModel.name} from Ollama RAM.`);
    }
  }
}

main().catch((e) => {
  console.error(`Error: ${(e as Error).message}`);
  process.exit(1);
});
