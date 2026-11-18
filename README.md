# Ink2Web Lite

Ink2Web Lite turns handwritten math notes (scanned PDFs or photos) into clean, accessible HTML. Equations are rendered with MathJax, and hand-drawn figures are extracted as images with alt text.

By default everything runs on your own computer. The app uses a vision model running locally in [Ollama](https://ollama.com), so:

- 🔒 **Your notes never leave your machine.** There are no cloud uploads.
- ⚡ **No API keys or subscriptions** are needed.
- 💻 **It runs on everyday hardware**, including Apple Silicon laptops with 8 GB of RAM.

Ink2Web Lite is an **assistant, not a one-click converter**: the model does a first transcription, and you review and lightly edit it before exporting. Click any part of the preview to fix it in place; your work is saved as you go.

**New in 3.0:** Purdue users can switch to **Purdue GenAI Studio** instead, for much larger models. Local stays the default; see [Purdue GenAI Studio](#purdue-genai-studio-optional).

**New in 3.1:** models reached through **OpenCode** (including its free models) are a third choice; see [OpenCode](#opencode-optional).

Version 3.1.1. For step-by-step usage, see **[HELP.md](HELP.md)**.

---

## Tuned for Qwen

Ink2Web Lite works with small Qwen vision models:

| Model | Install | Notes |
|---|---|---|
| **Qwen3.5 4B, MLX build** (recommended on Apple Silicon) | `ollama pull qwen3.5:4b-mlx` | Uses Ollama's MLX engine; runs on an 8 GB M1 Mac |
| **Qwen3-VL 4B, instruct build** | `ollama pull qwen3-vl:4b-instruct` | For computers without Apple Silicon; the model the prompts were first tuned with |
| **Qwen2.5-VL 3B** | `ollama pull qwen2.5vl:3b` | Smaller, slightly less accurate |

The MLX build needs a recent Ollama (check with `ollama --version`).

**Have a more powerful computer?** Choose the **Larger models** prompt under **Model and settings › Transcription prompt**. It's a second built-in prompt with more detailed rules (multi-line alignment, cases and matrices, lists and tables, look-alike characters, reading order, fuller figure descriptions) for vision models around 8B and up, such as `qwen3-vl:8b-instruct`. The short **Everyday hardware** prompt stays the default, and both use the same output formats, so everything after transcription works the same way.

Other vision models may work but aren't tested. Each model has its own quirks, and the prompt is kept short on purpose: small models follow a few clear rules much better than a long list of model-specific exceptions.

**Adapting it to another model?** You're welcome to. Two places to look:

- **`src/lib/prompts.ts`**: the transcription prompts. Keep the everyday one short; every added rule competes with the important ones. The larger-model prompt has more room.
- **`src/lib/transcript.ts`**: the clean-up step that repairs model output after transcription. This is the better place for model-specific fixes, because it costs nothing in prompt length and helps every model.

To try a prompt change without touching the code, click the **model button** in the app's top bar, then **Advanced › Transcription prompt**: it shows the prompt, lets you edit it for the next conversions, warns if a format the app depends on is missing, saves named versions in your browser (one of which can start with the app), and copies your version for pasting into `prompts.ts`.

Run `npm test` after changes, and compare a few pages you know well before and after.

---

## What's new

### 3.1.1
- **OpenCode 2.** The app uses OpenCode 2's server API (`/api/...`), with the server password and working folder added by the app's own server. 3.1.0 was written for the older API and couldn't list models. Setup below now includes the password.
- **OpenCode's own models only.** The OpenCode list no longer repeats the Purdue models from `opencode.jsonc`; those are under **Purdue GenAI Studio**.
- **The free usage limit stops conversion.** When OpenCode says its free limit is reached, the app stops at once (no more pages, figure passes, or repair rounds) and explains that the limit covers every free model.
- Each request now refuses every OpenCode tool and permission, and its session is deleted afterwards, as before.

### 3.1.0
- **A third place for the model to run: OpenCode.** Under **Model and settings › Where the model runs**, choose **OpenCode** and pick any model from the providers you're logged in to in OpenCode, including its free ones. Models that read images are listed first, and free ones are marked.
- **OpenCode is only the gateway.** Each request is a new OpenCode session with every tool refused, using the app's own prompts, and it's deleted afterwards. Convert, re-read, and redraw work as with the other two.
- The app's own server forwards requests to `opencode serve` on this computer, so there is no CORS setup. Setup below.
- Good to know: OpenCode answers in one piece, so there's no live text while a page converts. Structured answers (figure boxes, redraw specs) are asked for in words, and the existing clean-up handles the rest.

### 3.0.0
- **A second place for the model to run: Purdue GenAI Studio.** Under **Model and settings › Where the model runs**, choose **This computer (Ollama)** (the default) or **Purdue GenAI Studio**, then pick one of its hosted models. Everything (convert, re-read, redraw, figures, export) works the same with either.
- **The API key stays out of the browser.** The app's own server forwards requests to GenAI Studio and adds the key from `.env.local`. Setup below.
- **Rate limits handled:** a request GenAI Studio turns away for being too frequent waits and is retried. A model that doesn't support structured output is asked again without it.
- **Always visible:** a ☁ on the model button and a note in the settings when pages go to GenAI Studio. Each provider remembers its own model.
- Why 3.0: until now, nothing ever left your computer. That is still the default, but it's no longer the only mode.

### 2.2.3
- **Figures side by side.** Drawings that sit next to each other on the page are shown next to each other in the document, in one row. The app detects this when converting; in a figure's panel, **Side by side with figure n** does it by hand. Each figure's **Width** is its share of the line; text doesn't flow beside a row, and on narrow screens the figures stack.

### 2.2.2
- Redraw specs: number fields accept constants such as `"pi/2"`, `"2pi"`, and `"e"`, and the alt text says π exactly. Ticks without labels are labeled π, 2π, … automatically. Simple multiples of e are recognized in alt text.
- Figure panel: the crop tools sit with the layout again; **Redraw from the math** is collapsed until used; inside it, the steps follow the workflow (compare, edit the spec with its problems listed right under it, then choose **In the document** at the end).
- Fixed: closing the panel right after typing in the spec no longer drops the last edit. Spec problems no longer interrupt screen readers on every pause, and the alt text box isn't flagged as missing when only the redraw is shown.

### 2.2.1
- Redraw: a warning when the equation in `from` doesn't match the curve that is drawn (the drawing follows `expr`, so editing only `from` changes nothing), and a note under the spec explaining that edits apply as you type.

### 2.2.0
- **Redraw figures from the math.** A graph of a stated function, a region between curves, or a phase plane can be redrawn exactly from the equation in the notes, with alt text computed from the math (zeros, jumps, asymptotes, intersections, equilibria and their types, what each trajectory does). In the figure panel, **Redraw with the model** reads the figure and the notes around it and writes a small spec; you can also write or edit the spec yourself.
- **The image stays the default.** Choose **Image**, **Redrawn**, or **Both** (the redraw with the original sketch under it) for each figure. A spec with errors never replaces the image.
- Redrawn figures are inline SVG in the export: sharp at any zoom, printable, and readable by screen readers. Project files keep the spec.
- Developer preview of the engine: `figure-lab.html` (see `docs/REDRAW.md`).

### 2.1.2
- **A second built-in prompt for larger models.** Under **Model and settings › Transcription prompt**, choose **Everyday hardware** (the default: short and concrete, for small models like `qwen3-vl:4b-instruct`) or **Larger models** (more detailed rules for models around 8B and up). The choice is remembered and applies to pages you convert next.
- The larger-model prompt asks for aligned multi-line work, `cases` and matrices, Markdown lists and tables, the author's exact notation, care with look-alike characters, reading order for margin notes, and figure descriptions written as alt text. Same formats as the everyday prompt, so clean-up, notes, figures, and export are unchanged.
- A hint suggests the other prompt when the chosen one doesn't fit the selected model's size (it never switches by itself).
- The prompt inspector lists both built-in prompts; a saved prompt remembers which one it was based on, and the "built-in has changed" note compares against that one.

### 2.1.1
- **Saved prompts.** Under **Model › Advanced › Transcription prompt**, an edited prompt can be saved under a name (kept in this browser). Pick a saved prompt from the **Prompt** list to load it, update it by saving under the same name, or delete it.
- **Start with a saved prompt:** tick **Use “…” whenever the app opens** to make a saved prompt your everyday prompt. The built-in prompt itself is never changed, so app updates to it still reach you; a saved prompt notes when the built-in has changed since it was saved.
- The banner and badge name the saved prompt in use.

### 2.1 (new layout)
- **One page at a time.** A **page list** on the left (thumbnail, status, and how many things to check on each page) and a **workspace** showing the selected page, with **← Prev / Next →**.
- **Top bar, always visible:** title, save status, **Open** / **Save**, the **model button** (opens Model and settings), and **Export**.
- **The original stays in view** while you scroll the document, with its tools on top: the **Figures** row, or the **re-read** controls while re-reading. The re-read proposal scrolls into view and takes the focus when it arrives.
- **Figures open in place**, like text: click a figure in the document, its box on the original, or its number, and its panel (alt text, caption, layout, crop, and a preview) takes its place. The long list of figure cards under each page is gone.
- **Export checklist:** Export lists what's still flagged (missing alt text, crops to check, LaTeX warnings), each linked to its page and figure.
- **Drop files anywhere** in the window. A friendlier start screen.
- An edit left open in the block editor is kept when you go to another page. Removing a converted page asks first.
- Only the current page is rendered, so long PDFs stay responsive. The page list uses small thumbnails.

### 2.0.1 (clean-up)
- **A failed or stopped *Convert again* keeps the page's previous version and your edits**, still marked Done and still exported. (Before, the old text stayed on screen but was silently left out of the export.)
- **The model does one job at a time:** re-reading waits while a page converts, and converting waits while a re-read runs, so two jobs never compete for memory on an 8 GB machine.
- Re-read uses the **Boost contrast** setting like a full conversion, stops runaway repetition, and never proposes a figure line.
- Removing a page (or **Clear all**, **Restore**, **Open project**) stops any re-read running on it.
- A **Dismiss** button for the message on a page whose re-conversion failed.
- The **Context window** field can be typed freely; it's checked when you leave the field.
- Housekeeping: patch notes folded into this README, unused code removed, `LICENSE` restored, `dist/` ignored by git.

### 2.0
- **Re-read from image.** While editing a paragraph or equation, click **Re-read from image…**, drag a box around that handwriting on the original page, and click **Re-read this region**. The model reads only that crop and proposes a replacement you can edit. **Use this** puts it in the editor; press **Done** to keep it. Nothing changes on the page without that.

### 1.9.5
- **Prompt inspector** under **Model › Advanced**: see the exact transcription prompt sent to the model, and try an edited version on the next conversions.
  - **Temporary by design:** the edit isn't saved and ends when you reload the app. **Reset to default** or **Use the default prompt** switches back at any time.
  - **Always visible when active:** a *Custom prompt in use* banner sits above **Convert all**.
  - **Format check:** a warning appears if the edited prompt no longer asks for `[[FIGURE: …]]`, `[[note: term | words]]`, or `$…$` math, which the clean-up code depends on.
  - **Copy prompt** for pasting into `src/lib/prompts.ts` or a GitHub issue.

### 1.9.4
- **Alt text check.** A figure whose alt text looks like it holds writing from next to the drawing (math, "written beside it", "with text …", a long quote) gets a **Check alt text** badge and a short hint.
- **Move to notes.** Select the misplaced part of the alt text and click **Move to notes**: it's removed from the alt text and added as a line right after the figure. With nothing selected, the whole alt text moves.
- **Known issues** section added to this README and to HELP.

### 1.9.3
- The prompt says explicitly that writing next to a drawing is notes, never part of the figure's description, and its example shows a line of notes right after a figure.

### 1.9.2
- A sentence the model quotes inside a figure's description ("… with text "…" written beside it") is moved back into the notes automatically.

### 1.9.1
- A missing bracket in the model's figure line no longer pulls the following sentence into the alt text.

### 1.9
- **Click to edit.** Click a paragraph, an equation (with its "where…" note), or a figure in the preview to fix it in place. **Done** (⌘/Ctrl+Enter) saves, **Cancel** (Esc) discards. Works from the keyboard too.
- **Markup toolbar** in the in-place editor and **Edit source**: `$x$`, `$$`, **Note**, **Box**, **⋮**, **U**nderline, **H**eading, **Color**. ⌘Z / Ctrl+Z undoes toolbar edits.

### 1.8
- **Autosave** in the browser, with **Restore** after a refresh or crash. **Save project** / **Open project** (`.ink2web.json`) to keep or move work.

### 1.7 – 1.7.3
- Arrow and brace notes become "where…" sentences after the equation, written by the app from `[[note: term | words]]` lines; notes with words get "is", purely mathematical notes get "=". Tuned for Qwen.

### 1.6 and 1.6.1
- Handwriting marks: boxes, underlines, colored comments (accessible shades), ⋮ for skipped steps. Plain-text equations rescued as math. Narrow drawings detected.

---

## What it does

- Reads handwritten notes and transcribes them into text and LaTeX, keeping the author's wording and marks.
- Turns arrow and brace notes into "where…" sentences after the equation.
- Finds hand-drawn figures (graphs, diagrams, sketches), crops them, and places them where they appear in the notes.
- Copies the original layout: figure size, alignment, and text written beside a drawing.
- Lets you fix things where you see them: click any part of the preview, with a toolbar for the marks you use most.
- Saves your work automatically, and as project files you can keep or move.
- Produces a single HTML file (figures embedded; MathJax loads from a CDN) built for accessibility:
  - correct heading structure and landmarks
  - MathJax with assistive MathML
  - alt text for every figure
  - colors that meet WCAG contrast, never used as the only cue
  - reflow on small screens

---

## Requirements

| Tool | Version | Purpose |
|---|---|---|
| [Node.js](https://nodejs.org) | 22 LTS recommended (20.19 or newer) | Runs the app |
| [Ollama](https://ollama.com/download) | Current release | Runs the vision model locally |
| A Qwen vision model | see [Tuned for Qwen](#tuned-for-qwen) | Reads the handwriting |

---

## Setup

### macOS

1. **Install Node.js.** Download the LTS installer from [nodejs.org](https://nodejs.org), or run `brew install node`.
2. **Install Ollama.** Download it from [ollama.com/download](https://ollama.com/download) and move it to Applications. Open it once, and a llama icon appears in the menu bar.
3. **Check both** in Terminal:
   ```bash
   node -v
   ollama --version
   ```

### Windows

1. **Install Node.js.** Run the LTS `.msi` from [nodejs.org](https://nodejs.org) and keep the option to add Node to PATH.
2. **Install Ollama.** Run the Windows installer from [ollama.com/download](https://ollama.com/download). Ollama then runs in the system tray.
3. **Check both** in PowerShell with `node -v` and `ollama --version`.

### Linux

```bash
# Node.js: use your distribution's package manager, or nvm (https://github.com/nvm-sh/nvm)
curl -fsSL https://ollama.com/install.sh | sh
node -v && ollama --version
```

### Install a model

On an Apple Silicon Mac:

```bash
ollama pull qwen3.5:4b-mlx
```

On other computers:

```bash
ollama pull qwen3-vl:4b-instruct
```

**For Qwen3-VL, use the `-instruct` tag.** The default Qwen3-VL tags (like `qwen3-vl:4b`) are "thinking" builds. They're much slower for transcription and may return empty pages. HELP.md explains why.

---

## Purdue GenAI Studio (optional)

[Purdue GenAI Studio](https://genai.rcac.purdue.edu) runs open-weight models on Purdue's servers, including vision models much larger than a laptop can hold.

1. Sign in to GenAI Studio, open **Settings › Account › API Keys**, and create a key.
2. In the project folder, copy `.env.example` to `.env.local` and paste the key:
   ```bash
   GENAI_API_KEY=sk-...
   ```
   `.env.local` is git-ignored. Never commit the key or put it anywhere the browser can read it.
3. Restart `npm run dev` (or `npm run preview`).
4. In the app: **Model and settings › Where the model runs › Purdue GenAI Studio**, then choose a model that reads images. Try the **Larger models** prompt.

**What to send:** GenAI Studio is approved for public and sensitive (L2) data, not restricted data. Your own lecture notes are fine; **never student work** (FERPA). Saved work and project files still stay in your browser either way.

**Good to know:** the key is added by the dev/preview server on this computer, so keep the server on `localhost` (don't start it with `--host` on a shared network). Pages convert one at a time, and a rate-limited request waits and retries by itself.

## OpenCode (optional)

[OpenCode](https://opencode.ai) can reach many hosted models, including free ones. Those only answer requests that come through OpenCode itself, so Ink2Web Lite talks to OpenCode's own local server. This needs **OpenCode 2** (`opencode --version`).

1. **Pick a password** (any word; it only protects the server on this computer) and put it in `.env.local` in the app folder:
   ```
   OPENCODE_SERVER_PASSWORD=ink2web
   ```
2. **Start the server** in its own folder, with the same password, and leave it running:
   ```bash
   mkdir -p ~/ink2web-opencode && cd ~/ink2web-opencode
   OPENCODE_SERVER_PASSWORD=ink2web opencode serve --port 4096
   ```
   Your OpenCode logins are used as they are. Tip: put `export OPENCODE_SERVER_PASSWORD=ink2web` in `~/.zshrc` so a plain `opencode serve --port 4096` works.
3. **Start the app** with `npm run dev` (restart it if it was running, so it reads `.env.local`).
4. In the app: **Model and settings › Where the model runs › OpenCode**, **Refresh**, then choose a model that reads images. Many free models are text-only (marked **no vision**) and can't read pages. Try the **Larger models** prompt.

The list shows OpenCode's own models only. Other providers in your `opencode.jsonc` (such as Purdue) are left out; use **Purdue GenAI Studio** for those.

Check from a terminal: `curl -u opencode:ink2web -H "x-opencode-directory: $HOME/ink2web-opencode" http://127.0.0.1:4096/api/model` should list models. If OpenCode runs on another port or folder, set `OPENCODE_URL` or `OPENCODE_DIRECTORY` in `.env.local` (see `.env.example`).

**The free usage limit.** OpenCode's free models share one usage limit, which OpenCode doesn't publish. A page can take several requests, each with a large image, so converting uses it up much faster than coding does, and the same limit then also blocks free models in OpenCode itself. When OpenCode refuses, Ink2Web stops converting and says so; switching to another free model doesn't help. Use OpenCode to try a model on a page or two, and Purdue GenAI Studio or Ollama for whole documents.

**What to send:** pages go to whichever company runs the chosen model. Free models in particular may keep prompts and use them for training. Use it for trying models on your own notes; **never for student work** (FERPA). Saved work and project files still stay in your browser.

## Running the app

From the project folder:

```bash
npm install        # first time only (or after updating)
npm run dev
```

Open **http://localhost:5173** in your browser. Press `Ctrl+C` in the terminal to stop the app.

For everyday use of a settled version, you can build once and run the faster preview server instead:

```bash
npm run build      # once per new version
npm run preview    # then open http://localhost:4173
```

The dev server (port 5173) and preview server (port 4173) count as different sites to the browser, so each keeps its own autosaved work. Use **Save** / **Open** (project files) to move work between them.

If Ollama runs on a different machine:

```bash
OLLAMA_HOST=http://192.168.1.20:11434 npm run dev
```

### Updating to a new version

Replace the project files (keep or delete `node_modules`), then run `npm install` and `npm run dev` again. Reload the browser tab so it picks up the new code. Autosaved work is kept across updates.

---

## Using it (short version)

1. Choose a model (the model button in the top bar).
2. Drop a PDF or photos anywhere in the window (or **Open** a saved project).
3. Click **Convert this page**, or **Convert all** in the page list.
4. Review each page against the original: click anything that needs fixing, edit it (or **Re-read from image…** to let the model look again), and press **Done**. Check the figures and their alt text, especially any marked **Check alt text**. Your edits are saved as you go.
5. Click **Export**, clear anything it flags, and **Download HTML**. Only converted pages are exported.

The full guide is in **[HELP.md](HELP.md)**.

---

## How it works

```
PDF / image ──► page image
                  │
                  ├─► Vision model: transcribe ──► Markdown + LaTeX + marks + notes + figure markers
                  │
                  └─► Ink analysis (no model) ──► drawings + lines of text on the page
                                  │
          figures matched, described, cropped, and placed by their position on the page
                                  │
          Markdown → accessible HTML (built in code, not by the model) ──► MathJax
```

A few design choices matter for accuracy:

- **The model only writes Markdown and LaTeX**, plus small extensions for underlined words, colored ink, and notes. The app's own code builds all the HTML and accessibility markup, so every export has the same structure.
- **The model reports notes; the app writes the sentences.** Deciding where an arrow points inside LaTeX is hard for a small model. Naming the term and copying the note is not.
- **Model quirks are fixed after transcription, not in the prompt**, whenever code can do it reliably.
- **Figures are found from the ink itself**, not only from the model, and placed by where they sit on the page.
- **Editing stays in the source.** The preview is split into blocks that map back to lines of the transcription, so clicking a block edits exactly those lines; the export is built from the same source.
- **Pages convert one at a time, only when asked**, which keeps memory use low on small machines.
- **Work is saved in the browser's own storage (IndexedDB)**, on this computer only.

---

## Project layout

```
src/
  App.tsx               app state, conversion queue, upload, saving; top bar, page list, workspace
  components/
    PageView.tsx        one page: original (with figure / re-read tools), document, in-place editing
    PageList.tsx        the page list: thumbnails, status, things to check
    FigurePanel.tsx     one figure's alt text, caption, layout, and crop actions (opens in place)
    ExportPanel.tsx     export checklist and Download
    Dialog.tsx          modal dialog (settings, export)
    BlockEditor.tsx     the in-place editor for one block
    MarkupToolbar.tsx   toolbar for math, notes, boxes, colors, ...
    Preview.tsx         renders and typesets HTML; reports clicks on blocks
    CropCanvas.tsx      figure crop boxes on the page image
    SettingsPanel.tsx   model and settings
    PromptInspector.tsx view, change, and save transcription prompts
  lib/
    ollama.ts           talks to the local Ollama server
    genai.ts            talks to Purdue GenAI Studio (OpenAI-compatible API, via the /genai proxy)
    opencode.ts         talks to a local OpenCode 2 server (via the /opencode proxy), one throw-away session per request
    model.ts            picks Ollama, GenAI Studio, or OpenCode for each request
    prompts.ts          instructions given to the model
    promptLibrary.ts    saved prompts and the one that starts with the app (localStorage)
    pipeline.ts         converts one page from start to finish (default or custom prompt)
    layout.ts           finds drawings and text lines in the ink
    placement.ts        decides where figures go in the text
    transcript.ts       cleans model output; figure lines; moves drawn notes out
    markdown.ts         Markdown (+ marks, "where" sentences) → accessible HTML
    editing.ts          click-to-edit blocks; toolbar marks; alt text check, Move to notes; things to check
    exportHtml.ts       builds the downloadable HTML document
    figureRows.ts       figures side by side (rows)
    storage.ts          autosave (IndexedDB) and project files
    images.ts           PDF/image loading, contrast boost, cropping
    mathjax.ts          MathJax for the in-app preview
tests/                  automated tests (npm test)
vite.config.ts          dev server, Ollama proxy, asset copying
```

Runtime dependencies: React, pdf.js, and MathJax.

---

## Testing

```bash
npm test          # all automated tests (needs Node 22.6+)
npm run typecheck
```

---

## Known issues

These come from what small vision models can and can't do reliably. Each has a quick fix in the app.

| Issue | What to do |
|---|---|
| **Writing next to a figure can end up in its alt text.** Small models sometimes include a sentence written beside a drawing in the drawing's description instead of the notes. The app catches the common forms automatically, but not all. | Look for figures marked **Check alt text**. Select the misplaced sentence in the alt text and click **Move to notes**. |
| **Words and symbols can be misread** (a handwritten 7 read as 9, for example). | Proofread against the original; **High detail** helps. Click the part to fix it. |
| **Spelling gets "corrected."** Small models tend to fix the author's spelling despite instructions to copy exactly. | Fix it back if it matters. |
| **A "where…" note can name the wrong term.** The sentence is only as good as the term the model picks. | Click the equation and fix the `[[note: term \| words]]` line. |
| **Very flat drawings** (a lone number line, a single long arrow) may not be detected as figures. | Click **+ Add** in the Figures row above the original. |

Other limits:

- **The in-place editor edits source**, not the rendered math directly; you still type LaTeX, with the toolbar's help.
- **Autosave is per browser.** Work saved in Safari isn't visible in Chrome, and clearing the browser's site data deletes it. Use **Save** to keep a project file for anything important.
- **Exported files load MathJax from a CDN**, so viewers need an internet connection to see the rendered math.

---

## License

See [LICENSE](LICENSE).
