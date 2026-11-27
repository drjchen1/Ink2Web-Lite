# Ink2Web Lite

**Ink2Web Lite** turns handwritten math notes (scanned PDFs, tablet exports, or phone photos) into clean, WCAG-accessible HTML with MathJax equations, structured handwriting marks, cropped or mathematically redrawn SVG figures, and computed alt text.

By default, everything runs **locally on your own computer** using a vision model in [Ollama](https://ollama.com):

- **Private by default** — notes never leave your machine when running with Ollama.
- **No cloud lock-in or required keys** — works offline after initial model download.
<<<<<<< HEAD
- **Runs on everyday hardware** — works with any Ollama vision model and is tuned for 2B–4B everyday local models (`qwen3.5:4b-mlx`, `LightOnOCR-3`, `ministral-3:3b`, `qwen3.5:2b-mlx`, `gemma4:e2b-it-qat`) on 8 GB and 16 GB+ laptops, with optional support for larger local models or **[Purdue GenAI Studio](#purdue-genai-studio-optional)**.
- **Human-in-the-loop editing** — Ink2Web Lite prepares a faithful first draft; you inspect beside the original, click any paragraph, equation, or figure to refine it, and export when ready.

Version **3.5.0** · User guide: **[HELP.md](HELP.md)** · Redraw engine reference: **[docs/REDRAW.md](docs/REDRAW.md)**
=======
- **Runs on everyday hardware** — tuned for 3B–4B Qwen vision models on an 8 GB Apple Silicon laptop, with optional support for larger local models or **[Purdue GenAI Studio](#purdue-genai-studio-optional)**.
- **Human-in-the-loop editing** — Ink2Web Lite prepares a faithful first draft; you inspect beside the original, click any paragraph, equation, or figure to refine it, and export when ready.

Version **3.3.0** · User guide: **[HELP.md](HELP.md)** · Redraw engine reference: **[docs/REDRAW.md](docs/REDRAW.md)**
>>>>>>> 2035e741849f59f0e03e1c92174722e9ce01ab9a

---

## Key Capabilities

- **Transcription that respects your notes:** Converts prose, headings, lists, aligned display equations, `cases`, matrices, boxed results (`\boxed{...}`), skipped-step dots (`⋮`), underlines, and accessible ink-colored annotations (`[[red: ...]]`).
- **Arrow & brace notes without breaking MathJax:** Model-extracted `[[note: term | words]]` annotations become clean *"where…"* callouts (inline sentences in Classic look, or `.notebox` lists in Page Cards).
- **Layout-aware PDF/image ingestion:** Ink analysis splits two-column handouts and dense pages into readable bands for small models, detects standalone and inline drawings automatically, and groups side-by-side or stacked figures cleanly.
<<<<<<< HEAD
- **Clean-Slate Mathematical Redraw (v2):** Figures backed by an equation or schematic can be automatically or manually redrawn as crisp inline SVGs using a compact **Line-DSL** with a native LaTeX expression compiler, nearby **Equation Menu (`@eq1`)** grounding, pre-model sketch CV, bidirectional Chamfer ink verification, pure-SVG math typesetting, transparent **Overlay sketch** alignment checking, and computed accessibility descriptions — while **always preserving the original cropped sketch** (`Image` / `Redrawn` / `Both`).
- **Guided Touch-Up & Review Mode:** Cross-page **Review Queue bar** jumps straight to `[illegible]` spots, LaTeX warnings, or flagged figures; synced **Scan Spotlight** and **2.2× Loupe** match blocks to handwriting; **Page-Wide Undo/Redo** (`⌘/Ctrl+Z`), a **Symbols** quick-palette, and **Split / Merge** controls let you polish notes rapidly—even with Ollama closed (**Review mode (offline)**).
- **Headless Batch CLI (`npm run convert`):** Convert PDFs and images in Terminal with ~150 MB overhead (freeing 1.5–3 GB of browser/GPU RAM on 8 GB machines), auto-unload Ollama (`keep_alive: 0`), write `.ink2web.json` for fast UI touch-up, and optionally pre-render `--offline` MathJax HTML.
=======
- **Clean-Slate Mathematical Redraw (v2):** Figures backed by an equation or schematic can be automatically or manually redrawn as crisp inline SVGs using a compact **Line-DSL** with a native LaTeX expression compiler, nearby **Equation Menu (`@eq1`)** grounding, pre-model sketch CV, bidirectional Chamfer ink verification, pure-SVG math typesetting, and computed accessibility descriptions — while **always preserving the original cropped sketch** (`Image` / `Redrawn` / `Both`).
- **In-place visual review:** Side-by-side original and document panes; click any block to edit with shortcuts (`⌘/Ctrl+M` or `$`, `⌘/Ctrl+B`, `⌘/Ctrl+U`, `⌘/Ctrl+Enter`) or **Re-read from image…** on a cropped region.
>>>>>>> 2035e741849f59f0e03e1c92174722e9ce01ab9a
- **Resilient local persistence:** Browser autosave (IndexedDB) with multi-tab conflict protection, **Recent sessions** history on the welcome screen, and portable `.ink2web.json` project files.
- **Accessible HTML export:** Single-file HTML output in **Page cards** (letter-sheet print layout) or **Classic** look, pre-export accessibility checklist, and optional **Work offline** mode that pre-renders MathJax CHTML and embedded `@font-face` rules so exported files work with zero internet access.

---

## Quick Start

### Requirements

| Tool | Version | Purpose |
|---|---|---|
| [Node.js](https://nodejs.org) | 20.19+ (22 LTS recommended; `>= 22.6` for `--experimental-strip-types` tests) | Runs the dev server, proxy, build, and tests |
| [Ollama](https://ollama.com/download) | Current release | Runs local vision models |
| Vision model | See [Recommended Models](#recommended-models) | Reads handwritten pages and figures |

### 1. Install Ollama & Pull a Vision Model

- **macOS:** Install Node.js (`brew install node` or installer) and Ollama, launch Ollama once, then pull the MLX build on Apple Silicon:
  ```bash
  ollama pull qwen3.5:4b-mlx
  ```
<<<<<<< HEAD
- **Windows / Linux:** Install Node.js and Ollama (on Linux: `curl -fsSL https://ollama.com/install.sh | sh`), then pull an edge or instruct vision model:
  ```bash
  ollama pull ministral-3:3b
  # or on 16 GB+ / GPU systems:
=======
- **Windows / Linux:** Install Node.js and Ollama (on Linux: `curl -fsSL https://ollama.com/install.sh | sh`), then pull the instruct build:
  ```bash
>>>>>>> 2035e741849f59f0e03e1c92174722e9ce01ab9a
  ollama pull qwen3-vl:4b-instruct
  ```

### 2. Run Ink2Web Lite

```bash
npm install
npm run dev
```

Open **http://localhost:5173** in Chrome, Edge, Firefox, or Safari. Drop a PDF or page images anywhere in the window, pick your model in the top bar, and click **Convert this page** or **Convert all**.

For a compiled production preview on `http://localhost:4173`:

```bash
npm run build
npm run preview
```

> **Note:** Browsers isolate IndexedDB autosave by origin/port (`5173` vs `4173`). Use **Save** / **Open** (`.ink2web.json`) to move work between dev, preview, or another computer.

To connect to Ollama on another host:

```bash
OLLAMA_HOST=http://192.168.1.20:11434 npm run dev
```

<<<<<<< HEAD
### 3. Optional: Headless Batch CLI (Great for 8 GB Macs / Overnight Runs)

Keep your browser closed while Ollama runs, convert one or many PDFs/images from Terminal into portable `.ink2web.json` + `.html`, and open the `.ink2web.json` project in the Web UI later in zero-Ollama **Review mode**:

```bash
# Convert with the 8 GB preset (num_ctx = 4096, crop-only by default for fast conversion) and auto-unload Ollama:
npm run convert -- notes/lecture05.pdf --8gb

# Opt into mathematical SVG redraw during CLI conversion (`--redraw`):
npm run convert -- notes/*.pdf --model qwen3.5:4b-mlx --redraw --offline --out ./out

# Re-export an edited .ink2web.json project directly to offline HTML (no Ollama needed):
npm run convert -- lecture05.ink2web.json --offline --look cards

# Print all CLI flags:
npm run convert -- --help
=======
---

## Recommended Models

Ink2Web Lite is tuned for compact Qwen vision-language models using **`-instruct`** / non-thinking builds:

| Model | Pull command | Best for |
|---|---|---|
| **Qwen3.5 4B (MLX)** | `ollama pull qwen3.5:4b-mlx` | Everyday notes on 8 GB+ Apple Silicon Macs (recommended) |
| **Qwen3-VL 4B Instruct** | `ollama pull qwen3-vl:4b-instruct` | Windows / Linux / non-Apple Silicon laptops |
| **Qwen2.5-VL 3B** | `ollama pull qwen2.5vl:3b` | Tight memory fallback |
| **Qwen3-VL 8B Instruct+** | `ollama pull qwen3-vl:8b-instruct` | Larger GPUs / desktops — pair with the **Larger models** prompt |

> **Important:** Avoid raw *"thinking"* builds (such as untagged `qwen3-vl:4b`) for full-page transcription: hidden reasoning chains can fill `num_predict` before the page finishes. Check `ollama show <model>` if unsure.

### Built-in Prompts & Customization

Under **Model and settings › Transcription prompt**, choose:
- **Everyday hardware** *(default)*: concise rules tailored for 3B–4B models.
- **Larger models**: richer rules for 8B+ local models or GenAI Studio, plus an optional second pass that writes a short title (rendered with math in Page Cards) and a collapsible **Detailed description** for each figure.

To customize prompts without changing source code, open **Model and settings › Advanced › Transcription prompt › Inspect or change** to edit, validate format tags, save named presets in your browser, and set a default startup prompt. For code-level model tuning, see [`src/lib/prompts.ts`](src/lib/prompts.ts) and post-processing cleanup in [`src/lib/transcript.ts`](src/lib/transcript.ts).

---

## Purdue GenAI Studio (Optional)

If you have access to [Purdue GenAI Studio](https://genai.rcac.purdue.edu), you can run larger hosted vision models through Ink2Web Lite's local server proxy:

1. Generate an API key in GenAI Studio (**Settings › Account › API Keys**).
2. Copy `.env.example` to `.env.local` (already git-ignored) and set `GENAI_API_KEY`:
   ```bash
   cp .env.example .env.local
   # edit .env.local and add GENAI_API_KEY=sk-...
   ```
3. Restart `npm run dev` (or `npm run preview`).
4. Open **Model and settings › Where the model runs › Purdue GenAI Studio** (`☁`), pick a vision model, and optionally enable the **Larger models** prompt.

**Privacy & proxy rules:** `.env.local` stays on your machine — the key is attached by Vite's local proxy (`/genai`), never exposed to browser JavaScript. Keep Vite bound to `localhost` (do not use `--host` on shared networks). GenAI Studio is approved for public and sensitive (L2) lecture materials; **never send student work (FERPA)**.

---

## What's New

### 3.3.0
- **Clean-Slate Redraw v2 Engine** ([`src/lib/redraw/v2/`](src/lib/redraw/v2/), [`docs/REDRAW.md`](docs/REDRAW.md)):
  - **Compact Line-DSL + JSON support:** Small models write readable line directives (`from:`, `axes:`, `param:`, `curve:`, `shade:`, `field:`, `flow:`, `point:`, `pole:`, `zero:`, `roc:`, `sign:`, `interval:`, `node:`, `edge:`) instead of brittle nested JSON schemas, with automatic repair over a 2-turn conversation.
  - **Native LaTeX & piecewise expression compiler:** Evaluates `\frac`, `\sqrt`, `\sin^2 t`, `\tan^{-1}`, `|x|`, `u_c(t)`, Greek symbols, constants (`\pi/2`), and `\begin{cases}...\end{cases}` safely with zero `eval()`.
  - **Equation Menu (`@eq1`, `@eq2`):** Extracts nearby display/inline equations around a figure marker so the model can reference exact formulas rather than re-transcribing them from pixels.
  - **Pre-model Sketch CV & Bidirectional Ink Verification:** `analyzeSketch` gives the model the sketch's axes, quadrant ink density, and aspect ratio; `verifySceneAgainstInk` runs bidirectional Chamfer distance scoring and gates automatic document display by confidence (`high` → **Redrawn**, `medium` → **Both** + review prompt, `low` → keeps **Image** + review prompt).
  - **Expanded figure coverage & pure-SVG math typesetter:** Cartesian, piecewise, polar, parametric, implicit contours, Riemann rectangles/trapezoids, slope & vector fields with RK4 trajectories, 1D sign/interval charts, complex $s$-plane pole-zero & ROC plots, and non-coordinate grid diagrams (`box`, `sum`, `mass`, `wall`, `spring`, `damper`). Labels render via `mathSvg.ts` into tight self-closing SVG shapes with collision-aware placement.
  - **Two-way UI & backwards compatibility:** `RedrawSection` retains the **Image · Redrawn · Both** switch at all times, adds visual **Scene & layer controls** synced two-way with a collapsible Line-DSL/JSON drawer, and offers one-click upgrade of legacy v1 JSON specs (`upgradeV1ToScene`). `figure-lab.html` now includes both v2 and v1 presets.
- **Self-Contained Offline Export:** Check **Work offline** in **Export** to pre-render every page equation into MathJax CHTML and inline CSS fonts directly inside the downloaded `.html` file so it opens with zero internet connection.
- **Higher Accuracy on Small Models & Dense Pages:**
  - Pre-OCR dense small-model pages and two-column handouts split automatically into overlapping horizontal bands before vision transcription (configurable in Settings).
  - Rescues tabular / D-I integration-by-parts scratch columns into structured MathJax arrays (`rescueScratchNotes`).
  - Stacked beside-text figure groups, `.notebox` list callouts in Page Cards, keyboard shortcuts in the block editor (`⌘/Ctrl+M` or `$`, `⌘/Ctrl+B`, `⌘/Ctrl+U`, `⌘/Ctrl+Enter`), **Recent sessions** restore list on the home screen, and multi-tab autosave conflict warnings.
- **Documentation & Version Bump:** Rewritten `README.md`, `HELP.md`, `docs/REDRAW.md`, `figure-lab.html`, and `.env.example` for v3.3.0 and GitHub publication.

<details>
<summary>Previous releases (3.2.x – 1.6)</summary>

- **3.2.1:** Math rendered in Page Cards figure caption bars; improved plain-word alt text for fractions and grouped exponents; reduced redundant figure-pass calls.
- **3.2.0:** **Page cards** export look (`1 card per page` print styling), figure **Detailed description** pass with Larger models, Tab-navigable equations.
- **3.0.0:** Optional **Purdue GenAI Studio** provider (`☁`) via local proxy, automatic rate-limit retries, per-provider model memory.
- **2.2.x:** First mathematical SVG redraw engine (`kind: graph | region | phase`), `figure-lab.html`, side-by-side figure rows, math constants in spec fields (`"pi/2"`).
- **2.1.x:** Single-page workspace with left page list, in-place figure panels, export checklist, **Larger models** prompt, and saved browser prompt library.
- **2.0.x:** **Re-read from image…** cropped re-transcription, serialized model queue, failed re-conversion rollback.
- **1.6 – 1.9.5:** Click-to-edit blocks with live preview & toolbar, Prompt Inspector, **Check alt text** & **Move to notes**, IndexedDB autosave + `.ink2web.json` project files, `[[note: ...]]` prose notes, and WCAG-accessible color/mark rendering.

</details>

---

## How It Works

```
PDF / Photo ──► Render page image + extract ink layout (margins, columns, drawings)
                     │
                     ├──► Optional dense / 2-column band splitting (small models)
                     │
                     ├──► Vision model (Ollama or GenAI Studio) ──► Markdown + LaTeX + marks + [[note:]] + [[FIGURE:]]
                     │                                                       │
                     ├──► Transcript clean-up & figure matching ◄────────────┘
                     │         ├──► Optional figure title / detailed description pass
                     │         └──► Redraw v2 (Sketch CV + @eq menu + Line-DSL + Chamfer check)
                     │
                     └──► Deterministic accessible HTML builder ──► MathJax (CDN or pre-rendered offline)
```

1. **Deterministic HTML structure:** Models write only Markdown/LaTeX and simple markers; code generates semantic HTML landmarks, heading hierarchy, figure roles, assistive MathML, and color-independent markers.
2. **Post-processing over bloated prompts:** Model quirks are repaired in `src/lib/transcript.ts` rather than crowding small-model context windows.
3. **Serialized model calls:** Transcription, cropped re-reads, figure descriptions, and redraws run one request at a time so 8 GB machines stay responsive.

---

## Project Layout

```
index.html                  App entry HTML
figure-lab.html             Developer Figure Lab (Line-DSL v2 & Legacy JSON v1 sandbox)
src/
  App.tsx                   App state, conversion queue, recent sessions, multi-tab sync
  types.ts                  Page, Figure, Settings, and Prompt data models
  figure-lab.ts             Controller for figure-lab.html
  components/
    PageView.tsx            Original-left / Document-right workspace and inline editing
    PageList.tsx            Page thumbnails, status badges, and queue controls
    BlockEditor.tsx         Click-to-edit block textarea + shortcuts + live preview
    MarkupToolbar.tsx       LaTeX, Note, Box, Skipped-steps, Underline, Heading, Color buttons
    FigurePanel.tsx         In-place figure editor (alt text, caption, crop, layout)
    RedrawSection.tsx       Image / Redrawn / Both toggle, Scene & Layer controls, Line-DSL editor
    CropCanvas.tsx          Interactive crop and re-read region box overlay
    SettingsPanel.tsx       Provider (Ollama / GenAI), model picker, prompts, pipeline toggles
    PromptInspector.tsx     Live prompt editor, validator, browser prompt library
    ExportPanel.tsx         Accessibility checklist, Page Cards vs Classic, Work offline export
    Preview.tsx & Dialog.tsx
  lib/
    ollama.ts / genai.ts / model.ts   Unified local Ollama & Purdue GenAI Studio clients
    prompts.ts / promptLibrary.ts     Built-in prompts (Everyday / Larger) & browser presets
    pipeline.ts                       End-to-end page conversion, band splitting, figure passes
    layout.ts / placement.ts / figureRows.ts   Ink map, column/band splits, figure placement & rows
    images.ts                         PDF.js rendering, contrast enhancement, base64 cropping
    transcript.ts / describe.ts       Output cleanup, IBP rescue, figure title & description parsing
    markdown.ts / editing.ts          Custom Markdown+marks parser, block splitting, page issues
    exportHtml.ts / mathjax.ts        Single-file HTML export + MathJax CDN & offline CHTML compiler
    storage.ts                        IndexedDB autosave, session history, .ink2web.json files
    figureRedraw.ts                   UI SVG cache and per-figure ID isolation
    redraw/                           Mathematical SVG redraw engine (docs/REDRAW.md)
      index.ts, spec.ts, expr.ts, analyze.ts, region.ts, phase.ts, slope.ts, line.ts,
      inkCheck.ts, describe.ts, nice.ts, sample.ts, svg.ts, conversation.ts, prompt.ts, examples.ts
      v2/                             Clean-Slate Redraw v2 modules
        latexExpr.ts, eqMenu.ts, mathSvg.ts, scene.ts, sketchCv.ts,
        evaluate.ts, describeScene.ts, render.ts, converseV2.ts
tests/                                18 automated test suites (Node + TypeScript)
```

---

## Development & Testing

```bash
npm test          # Runs all 18 Node test suites (--experimental-strip-types; requires Node 22.6+)
npm run typecheck # Runs tsc --noEmit
npm run build     # Type-checks and builds production bundle into dist/
>>>>>>> 2035e741849f59f0e03e1c92174722e9ce01ab9a
```

---

<<<<<<< HEAD
## Recommended Models

**Any vision model** in Ollama or Purdue GenAI Studio works with the built-in prompts. For local laptops, Ink2Web Lite's **Everyday hardware** pipeline prioritizes and tunes for these 5 local Ollama models in order:

| Priority | Model | Install | Role & Notes |
|---|---|---|---|
| **1 (Primary)** | **Qwen3.5 4B (MLX)** | `ollama pull qwen3.5:4b-mlx` | Primary general-purpose model on Apple Silicon (full transcription, figure boxes, & Line-DSL redraws) |
| **2 (Secondary)** | **LightOnOCR-3 4B / 3B** | `ollama pull Maternion/LightOnOCR-3:4b-q4_K_M` *(or `lightonocr-3:3b`)* | Dedicated OCR & native grounding boxes (`"grounding"` / `""` mode); uses native ink crops with fallback `"Hand-drawn figure."` alt text (switch to a general VLM like `qwen3.5:4b-mlx` or `ministral-3:3b` if you want generated figure descriptions or SVG redraws) |
| **3 (Secondary)** | **Ministral 3 3B** | `ollama pull ministral-3:3b` | Fast non-thinking edge VLM for Windows, Linux, & Intel/Apple Macs |
| **4 (Fallback)** | **Qwen3.5 2B (MLX)** | `ollama pull qwen3.5:2b-mlx` | Lightweight Apple Silicon fallback for simpler pages or tight RAM |
| **5 (Fallback)** | **Gemma 4 E2B** | `ollama pull gemma4:e2b-it-qat` | Lightweight multi-platform fallback for simpler documents |
| *(Larger GPUs)* | **Qwen3-VL 8B+ Instruct** | `ollama pull qwen3-vl:8b-instruct` | Desktop GPUs / 16 GB+ Macs — pair with the **Larger models** prompt |

### Per-Task Thinking & Context Window (`num_ctx`)

- **Automatic task-aware thinking:** Ink2Web Lite sets Ollama's `think` parameter per task automatically:
  - **Off (`think: false`):** Page transcription, cropped re-reads, short alt text, figure locating (`format`), detailed figure descriptions (`describe`), and Round 1 auto-redraw drafts — prevents chain-of-thought stalls and JSON grammar conflicts.
  - **On (`think: true`):** Interactive manual figure redraws and Round 2 redraw repairs on thinking-capable ≥4B models (`qwen3.5:4b-mlx`, 8B+ models) so the model verifies geometry, bounds, and LaTeX carefully. Kept `false` on ≤3B fallback models (`qwen3.5:2b-mlx`, `gemma4:e2b-it-qat`, `ministral-3:3b`) and `LightOnOCR-3`.
- **Context Window (`num_ctx`):**
  - **8 GB machines:** **`4096`** with 4B models (`qwen3.5:4b-mlx`, `LightOnOCR-3:4b`) to avoid swap, or **`6144–8192`** with 2B–3B models (4B weights plus a wider per-token KV cache share the ~5 GB usable GPU/unified RAM budget before hitting swap).
  - **16 GB+ machines:** **`8192`** for standard pages, or **`12288–16384`** for dense **High detail** pages and multi-step figure redraws.

### Built-in Prompts & Customization

Under **Model and settings › Transcription prompt**, choose:
- **Everyday hardware** *(default)*: concise rules tailored for 3B–4B models.
- **Larger models**: richer rules for 8B+ local models or GenAI Studio, plus an optional second pass that writes a short title (rendered with math in Page Cards) and a collapsible **Detailed description** for each figure.

To customize prompts without changing source code, open **Model and settings › Advanced › Transcription prompt › Inspect or change** to edit, validate format tags, save named presets in your browser, and set a default startup prompt. For code-level model tuning, see [`src/lib/prompts.ts`](src/lib/prompts.ts) and post-processing cleanup in [`src/lib/transcript.ts`](src/lib/transcript.ts).

---

## Purdue GenAI Studio (Optional)

If you have access to [Purdue GenAI Studio](https://genai.rcac.purdue.edu), you can run larger hosted vision models through Ink2Web Lite's local server proxy:

1. Generate an API key in GenAI Studio (**Settings › Account › API Keys**).
2. Copy `.env.example` to `.env.local` (already git-ignored) and set `GENAI_API_KEY`:
   ```bash
   cp .env.example .env.local
   # edit .env.local and add GENAI_API_KEY=sk-...
   ```
3. Restart `npm run dev` (or `npm run preview`).
4. Open **Model and settings › Where the model runs › Purdue GenAI Studio** (`☁`), pick a vision model, and optionally enable the **Larger models** prompt.

**Privacy & proxy rules:** `.env.local` stays on your machine — the key is attached by Vite's local proxy (`/genai`), never exposed to browser JavaScript. Keep Vite bound to `localhost` (do not use `--host` on shared networks). GenAI Studio is approved for public and sensitive (L2) lecture materials; **never send student work (FERPA)**.

---

## What's New

### 3.5.0
- **Headless Batch CLI (`npm run convert`):** Added [`cli/convert.ts`](cli/convert.ts) backed by `@napi-rs/canvas`, `pdfjs-dist` legacy Node build, and MathJax 3 `liteAdaptor` ([`cli/nodeRaster.ts`](cli/nodeRaster.ts), [`cli/nodeMathjax.ts`](cli/nodeMathjax.ts)) sharing [`src/lib/pipeline.ts`](src/lib/pipeline.ts) via a pluggable `RasterBackend`. Close the browser on 8 GB machines so Ollama keeps all RAM, generate `.ink2web.json` + `.html` (with optional `--offline`, `--8gb`, `--genai`), and review in the browser afterward.
- **Automatic Ollama RAM Unload & Zero-Ollama Review Mode:** Added `unloadModel()` (`keep_alive: 0`), automatic post-queue unloading (toggleable in Settings), a **Free RAM** button in Settings, and calm **Review mode (offline)** in the top bar when viewing completed `.ink2web.json` projects without Ollama running.
- **Guided Touch-Up UX ([`src/components/ReviewBar.tsx`](src/components/ReviewBar.tsx), [`PageView.tsx`](src/components/PageView.tsx), [`CropCanvas.tsx`](src/components/CropCanvas.tsx)):**
  - Cross-page **Review Queue bar** (`Alt+[` / `Alt+]`) jumping straight to flagged figures and exact `[illegible]` / LaTeX warning blocks, with one-click **Looks right / Keep image / Show both** actions.
  - **Synced Scan Spotlight** and **2.2× Loupe** (toggle button or hold `Alt` over the scan) for checking subscripts.
  - **Ghost Sketch Overlay** toggle + opacity slider in Redraw to compare the original sketch transparently underneath the SVG.
  - **Page-Wide Undo/Redo** (`⌘/Ctrl+Z`, `⌘/Ctrl+Shift+Z`), one-click **Symbols ▾** Math Palette in [`MarkupToolbar.tsx`](src/components/MarkupToolbar.tsx), and **Split at cursor / Merge next** block actions in [`BlockEditor.tsx`](src/components/BlockEditor.tsx).

### 3.4.0
- **Everyday Hardware 5-Model Suite & General Vision Support:** Prioritizes and tunes the Everyday pipeline for `qwen3.5:4b-mlx`, `Maternion/LightOnOCR-3:4b-q4_K_M` / `lightonocr-3:3b`, `ministral-3:3b`, `qwen3.5:2b-mlx`, and `gemma4:e2b-it-qat`, while broadening `VISION_NAME` detection (`internvl`, `moondream`, `bakllava`, `cogvlm`, `glm-4v`, `deepseek-vl`, `llama*vision`, `phi*vision`, `granite*vision`) and keeping built-in prompts general across any vision model.
- **Task-Aware Automatic `thinking` Control (`resolveTaskThink`):** Automatically sends `think: false` for page transcription, cropped re-reads, JSON figure locating/describing, and fast Round 1 auto-redraws, while enabling `think: true` on ≥4B thinking models for Round 2 redraw repairs and interactive manual redraws (and keeping thinking off on ≤3B fallback models and LightOnOCR-3). Includes automatic HTTP 400 retry without `think` and strips `<think>`, `[THINK]`, and Gemma `<|channel>thought` / `<|thought|>` traces.
- **Robust LightOnOCR-3 Grounding & Math Cleanup:** Routes LightOnOCR models unconditionally through their native protocol, strips inline `![title](...)`, `![text](...)`, `![formula](...)`, and `![aside_text](...)` grounding prefixes, drops hallucinated plot-to-table extractions under `![image]` / `![chart]` sketches while rejoining valid `![table]` pipe rows, and safely unescapes paired `\$math\$` tokens (`\$f(x)\$` → `$f(x)$`) without altering escaped currency (`\$5`).
- **Promoted Context Window (`num_ctx`) & Hardware Presets:** Moves **Context window (`num_ctx`)** to main Ollama settings with one-click **`4096 / 8192 / 16384`** presets and 8 GB vs 16 GB+ guidance.

### 3.3.0
- **Clean-Slate Redraw v2 Engine** ([`src/lib/redraw/v2/`](src/lib/redraw/v2/), [`docs/REDRAW.md`](docs/REDRAW.md)):
  - **Compact Line-DSL + JSON support:** Small models write readable line directives (`from:`, `axes:`, `param:`, `curve:`, `shade:`, `field:`, `flow:`, `point:`, `pole:`, `zero:`, `roc:`, `sign:`, `interval:`, `node:`, `edge:`) instead of brittle nested JSON schemas, with automatic repair over a 2-turn conversation.
  - **Native LaTeX & piecewise expression compiler:** Evaluates `\frac`, `\sqrt`, `\sin^2 t`, `\tan^{-1}`, `|x|`, `u_c(t)`, Greek symbols, constants (`\pi/2`), and `\begin{cases}...\end{cases}` safely with zero `eval()`.
  - **Equation Menu (`@eq1`, `@eq2`):** Extracts nearby display/inline equations around a figure marker so the model can reference exact formulas rather than re-transcribing them from pixels.
  - **Pre-model Sketch CV & Bidirectional Ink Verification:** `analyzeSketch` gives the model the sketch's axes, quadrant ink density, and aspect ratio; `verifySceneAgainstInk` runs bidirectional Chamfer distance scoring and gates automatic document display by confidence (`high` → **Redrawn**, `medium` → **Both** + review prompt, `low` → keeps **Image** + review prompt).
  - **Expanded figure coverage & pure-SVG math typesetter:** Cartesian, piecewise, polar, parametric, implicit contours, Riemann rectangles/trapezoids, slope & vector fields with RK4 trajectories, 1D sign/interval charts, complex $s$-plane pole-zero & ROC plots, and non-coordinate grid diagrams (`box`, `sum`, `mass`, `wall`, `spring`, `damper`). Labels render via `mathSvg.ts` into tight self-closing SVG shapes with collision-aware placement.
  - **Two-way UI & backwards compatibility:** `RedrawSection` retains the **Image · Redrawn · Both** switch at all times, adds visual **Scene & layer controls** synced two-way with a collapsible Line-DSL/JSON drawer, and offers one-click upgrade of legacy v1 JSON specs (`upgradeV1ToScene`). `figure-lab.html` now includes both v2 and v1 presets.
- **Self-Contained Offline Export:** Check **Work offline** in **Export** to pre-render every page equation into MathJax CHTML and inline CSS fonts directly inside the downloaded `.html` file so it opens with zero internet connection.
- **Higher Accuracy on Small Models & Dense Pages:**
  - Pre-OCR dense small-model pages and two-column handouts split automatically into overlapping horizontal bands before vision transcription (configurable in Settings).
  - Rescues tabular / D-I integration-by-parts scratch columns into structured MathJax arrays (`rescueScratchNotes`).
  - Stacked beside-text figure groups, `.notebox` list callouts in Page Cards, keyboard shortcuts in the block editor (`⌘/Ctrl+M` or `$`, `⌘/Ctrl+B`, `⌘/Ctrl+U`, `⌘/Ctrl+Enter`), **Recent sessions** restore list on the home screen, and multi-tab autosave conflict warnings.
- **Documentation & Version Bump:** Rewritten `README.md`, `HELP.md`, `docs/REDRAW.md`, `figure-lab.html`, and `.env.example` for v3.3.0 and GitHub publication.

<details>
<summary>Previous releases (3.2.x – 1.6)</summary>

- **3.2.1:** Math rendered in Page Cards figure caption bars; improved plain-word alt text for fractions and grouped exponents; reduced redundant figure-pass calls.
- **3.2.0:** **Page cards** export look (`1 card per page` print styling), figure **Detailed description** pass with Larger models, Tab-navigable equations.
- **3.0.0:** Optional **Purdue GenAI Studio** provider (`☁`) via local proxy, automatic rate-limit retries, per-provider model memory.
- **2.2.x:** First mathematical SVG redraw engine (`kind: graph | region | phase`), `figure-lab.html`, side-by-side figure rows, math constants in spec fields (`"pi/2"`).
- **2.1.x:** Single-page workspace with left page list, in-place figure panels, export checklist, **Larger models** prompt, and saved browser prompt library.
- **2.0.x:** **Re-read from image…** cropped re-transcription, serialized model queue, failed re-conversion rollback.
- **1.6 – 1.9.5:** Click-to-edit blocks with live preview & toolbar, Prompt Inspector, **Check alt text** & **Move to notes**, IndexedDB autosave + `.ink2web.json` project files, `[[note: ...]]` prose notes, and WCAG-accessible color/mark rendering.

</details>

---

## How It Works

```
PDF / Photo ──► Render page image + extract ink layout (margins, columns, drawings)
                     │
                     ├──► Optional dense / 2-column band splitting (small models)
                     │
                     ├──► Vision model (Ollama or GenAI Studio) ──► Markdown + LaTeX + marks + [[note:]] + [[FIGURE:]]
                     │                                                       │
                     ├──► Transcript clean-up & figure matching ◄────────────┘
                     │         ├──► Optional figure title / detailed description pass
                     │         └──► Redraw v2 (Sketch CV + @eq menu + Line-DSL + Chamfer check)
                     │
                     └──► Deterministic accessible HTML builder ──► MathJax (CDN or pre-rendered offline)
```

1. **Deterministic HTML structure:** Models write only Markdown/LaTeX and simple markers; code generates semantic HTML landmarks, heading hierarchy, figure roles, assistive MathML, and color-independent markers.
2. **Post-processing over bloated prompts:** Model quirks are repaired in `src/lib/transcript.ts` rather than crowding small-model context windows.
3. **Serialized model calls:** Transcription, cropped re-reads, figure descriptions, and redraws run one request at a time so 8 GB machines stay responsive.

---

## Project Layout

```
index.html                  App entry HTML
figure-lab.html             Developer Figure Lab (Line-DSL v2 & Legacy JSON v1 sandbox)
cli/
  convert.ts                Headless batch CLI entry (npm run convert)
  nodeRaster.ts / nodeMathjax.ts   Node @napi-rs/canvas raster + MathJax offline prerenderer
src/
  App.tsx                   App state, conversion queue, review mode, recent sessions
  types.ts                  Page, Figure, Settings, and Prompt data models
  figure-lab.ts             Controller for figure-lab.html
  components/
    PageView.tsx            Original-left / Document-right workspace, undo/redo, spotlight
    ReviewBar.tsx           Cross-page guided review queue bar
    PageList.tsx            Page thumbnails, status badges, and queue controls
    BlockEditor.tsx         Click-to-edit block textarea, split/merge, shortcuts, live preview
    MarkupToolbar.tsx       LaTeX, Symbols palette, Note, Box, Columns, Underline, Color buttons
    FigurePanel.tsx         In-place figure editor (alt text, caption, crop, layout)
    RedrawSection.tsx       Image / Redrawn / Both, Ghost overlay, Scene & Layer controls, Line-DSL
    CropCanvas.tsx          Interactive crop, re-read box, scan spotlight & 2.2x loupe
    SettingsPanel.tsx       Provider (Ollama / GenAI), Free RAM, num_ctx, prompts, toggles
    PromptInspector.tsx     Live prompt editor, validator, browser prompt library
    ExportPanel.tsx         Accessibility checklist, Page Cards vs Classic, Work offline export
    Preview.tsx & Dialog.tsx
  lib/
    ollama.ts / genai.ts / model.ts   Unified local Ollama (with unloadModel) & GenAI Studio clients
    raster.ts / images.ts             Pluggable RasterBackend + PDF.js / browser canvas imaging
    cliArgs.ts                        Pure CLI flag parser & help text
    history.ts                        Bounded per-page undo/redo snapshot history
    prompts.ts / promptLibrary.ts     Built-in prompts (Everyday / Larger) & browser presets
    pipeline.ts                       End-to-end page conversion, band splitting, figure passes
    layout.ts / placement.ts / figureRows.ts   Ink map, column/band splits, figure placement & rows
    transcript.ts / describe.ts       Output cleanup, IBP rescue, figure title & description parsing
    markdown.ts / editing.ts          Markdown+marks parser, review queue, spotlights, math snippets
    exportHtml.ts / mathjax.ts        Single-file HTML export + MathJax CDN & offline CHTML compiler
    storage.ts                        IndexedDB autosave, session history, .ink2web.json files
    figureRedraw.ts                   UI SVG cache and per-figure ID isolation
    redraw/                           Mathematical SVG redraw engine (docs/REDRAW.md)
      index.ts, spec.ts, expr.ts, analyze.ts, region.ts, phase.ts, slope.ts, line.ts,
      inkCheck.ts, describe.ts, nice.ts, sample.ts, svg.ts, conversation.ts, prompt.ts, examples.ts
      v2/                             Clean-Slate Redraw v2 modules
        latexExpr.ts, eqMenu.ts, mathSvg.ts, scene.ts, sketchCv.ts,
        evaluate.ts, describeScene.ts, render.ts, converseV2.ts
tests/                                21 automated test suites (Node + TypeScript)
```

---

## Development & Testing

```bash
npm test          # Runs all 21 Node test suites (--experimental-strip-types; requires Node 22.6+)
npm run convert   # Runs the headless batch CLI (pass -- --help for flags)
npm run typecheck # Runs tsc --noEmit
npm run build     # Type-checks and builds production bundle into dist/
```

---

## Known Limitations & Quick Fixes

=======
## Known Limitations & Quick Fixes

>>>>>>> 2035e741849f59f0e03e1c92174722e9ce01ab9a
| Issue | Workaround in App |
|---|---|
| Text beside a drawing ends up inside its alt text | Look for the **Check alt text** badge, highlight the misplaced sentence, and click **Move to notes**. |
| Misread handwritten digit or symbol (e.g., `7` vs `9`) | Open that block and use **Re-read from image…** or fix the source directly. Enabling **High detail** also helps. |
| Redraw doesn't match a rough qualitative sketch | Toggle **In the document** back to **Image** (or **Both**), or adjust **Scene & layer controls** / `axes:` window. |
<<<<<<< HEAD
| `LightOnOCR-3` leaves `"Hand-drawn figure."` or skips redraw | LightOnOCR-3 is OCR-only: switch the top-bar model to `qwen3.5:4b-mlx` or `ministral-3:3b` and click **Describe with the model** or **Redraw with the model** on the figure (no need to re-convert the page). |
=======
>>>>>>> 2035e741849f59f0e03e1c92174722e9ce01ab9a
| Very flat or faint drawings missed by ink detector | Click **+ Add** in the **Figures** row above the original page image. |
| Editing source vs rendered math | Click-to-edit opens Markdown/LaTeX source with a live preview underneath and toolbar buttons. |
| Sharing notes with offline viewers | Enable **Work offline** inside the **Export** dialog before clicking **Download HTML**. |

---

## License

See [LICENSE](LICENSE). Developed for educators and students everywhere.
