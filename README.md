# Ink2Web Lite

Ink2Web Lite turns handwritten math notes (scanned PDFs or photos) into clean, accessible HTML. Equations are rendered with MathJax, and hand-drawn figures are extracted as images with alt text.

Everything runs on your own computer. The app uses a vision model running locally in [Ollama](https://ollama.com), so:

- 🔒 **Your notes never leave your machine.** There are no cloud uploads.
- ⚡ **No API keys or subscriptions** are needed.
- 💻 **It runs on everyday hardware**, including Apple Silicon laptops with 8 GB of RAM.

Ink2Web Lite is an **assistant, not a one-click converter**: the model does a first transcription, and you review and lightly edit it before exporting. Click any part of the preview to fix it in place; your work is saved as you go.

Version 2.1. For step-by-step usage, see **[HELP.md](HELP.md)**.

---

## Tuned for Qwen

Ink2Web Lite is tuned and tested with two small Qwen vision models:

| Model | Install | Notes |
|---|---|---|
| **Qwen3-VL 4B, instruct build** (recommended) | `ollama pull qwen3-vl:4b-instruct` | Best results; runs on an 8 GB Mac |
| **Qwen2.5-VL 3B** | `ollama pull qwen2.5vl:3b` | Smaller, slightly less accurate |

Other vision models may work but aren't tested. Each model has its own quirks, and the prompt is kept short on purpose: small models follow a few clear rules much better than a long list of model-specific exceptions.

**Adapting it to another model?** You're welcome to. Two places to look:

- **`src/lib/prompts.ts`**: the transcription prompt. Keep it short; every added rule competes with the important ones.
- **`src/lib/transcript.ts`**: the clean-up step that repairs model output after transcription. This is the better place for model-specific fixes, because it costs nothing in prompt length and helps every model.

To try a prompt change without touching the code, click the **model button** in the app's top bar, then **Advanced › Transcription prompt**: it shows the prompt, lets you edit it for the next conversions, warns if a format the app depends on is missing, and copies your version for pasting into `prompts.ts`. The edit is temporary and ends when you reload.

Run `npm test` after changes, and compare a few pages you know well before and after.

---

## What's new

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

```bash
ollama pull qwen3-vl:4b-instruct
```

**Use the `-instruct` tag.** The default Qwen3-VL tags (like `qwen3-vl:4b`) are "thinking" builds. They're much slower for transcription and may return empty pages. HELP.md explains why.

---

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
    PromptInspector.tsx view and temporarily change the transcription prompt
  lib/
    ollama.ts           talks to the local Ollama server
    prompts.ts          instructions given to the model
    pipeline.ts         converts one page from start to finish (default or custom prompt)
    layout.ts           finds drawings and text lines in the ink
    placement.ts        decides where figures go in the text
    transcript.ts       cleans model output; figure lines; moves drawn notes out
    markdown.ts         Markdown (+ marks, "where" sentences) → accessible HTML
    editing.ts          click-to-edit blocks; toolbar marks; alt text check, Move to notes; things to check
    exportHtml.ts       builds the downloadable HTML document
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
