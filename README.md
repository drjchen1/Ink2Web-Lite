# Ink2Web Lite

Ink2Web Lite turns handwritten math notes (scanned PDFs or photos) into clean, accessible HTML. Equations are rendered with MathJax, and hand-drawn figures are extracted as images with alt text.

Everything runs on your own computer. The app uses a vision model running locally in [Ollama](https://ollama.com), so:

- 🔒 **Your notes never leave your machine.** There are no cloud uploads.
- ⚡ **No API keys or subscriptions** are needed.
- 💻 **It runs on everyday hardware**, including Apple Silicon laptops with 8 GB of RAM (with a small model).

Version 1.5. For step-by-step usage, see **[HELP.md](HELP.md)**.

---

## What's new in 1.5

- **Convert only the pages you want.** New pages wait until you ask. A page's **Convert** button converts just that page. **Convert all** converts every page that isn't done yet.
- **Queue pages while one is converting.** Click **Convert** on another page and it waits its turn. **Cancel** takes it back out of the queue, and **Stop** stops the current page and empties the queue.
- **Convert again asks first** when the page already has a transcription, because converting replaces your edits on that page.
- **Fix for models that write `\( x \)` with spaces** (e.g. ministral). Their inline math now renders, with no stray-`$` warning.

---

## What it does

- Reads handwritten notes and transcribes them into text and LaTeX, keeping the author's wording.
- Finds hand-drawn figures (graphs, diagrams, sketches), crops them, and places them where they appear in the notes.
- Copies the original layout: figure size, alignment, and text written beside a drawing.
- Produces a single self-contained HTML file built for accessibility:
  - correct heading structure and landmarks
  - MathJax with assistive MathML
  - alt text for every figure
  - reflow on small screens
- Lets you review and fix everything before exporting: the transcription, the math, the figure crops, alt text, and the layout.

---

## Requirements

| Tool | Version | Purpose |
|---|---|---|
| [Node.js](https://nodejs.org) | 22 LTS recommended (20.19 or newer) | Runs the app |
| [Ollama](https://ollama.com/download) | Current release | Runs the vision model locally |
| A vision model | Any | Reads the handwriting |

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

### Install a vision model

Any Ollama model that can read images works. The app doesn't require a specific one. Two that work well on an 8 GB Mac:

```bash
ollama pull qwen2.5vl:3b            # small and fast
ollama pull qwen3-vl:4b-instruct    # newer; use the -instruct tag
```

**Use instruct builds, not thinking builds.** For Qwen3-VL, the default tags (like `qwen3-vl:4b`) are "thinking" builds. They're much slower for transcription and may return empty pages. HELP.md explains why.

Larger models are more accurate on messy handwriting but slower and need more memory. You can switch models at any time in the app.

---

## Running the app

From the project folder:

```bash
npm install        # first time only (or after updating)
npm run dev
```

Open **http://localhost:5173** in your browser. Press `Ctrl+C` in the terminal to stop the app.

If Ollama runs on a different machine:

```bash
OLLAMA_HOST=http://192.168.1.20:11434 npm run dev
```

### Updating to a new version

Replace the project files (keep or delete `node_modules`), then run `npm install` and `npm run dev` again.

---

## Using it (short version)

1. Choose a model.
2. Drop in a PDF or photos.
3. Click **Convert** on the pages you want, or **Convert all**.
4. Review each page: compare the preview with the original, fix any text or LaTeX, and check the figures and their alt text.
5. Click **Download HTML**. Only converted pages are exported.

The full guide is in **[HELP.md](HELP.md)**.

---

## How it works

```
PDF / image ──► page image
                  │
                  ├─► Vision model: transcribe ──► Markdown + LaTeX + figure markers
                  │
                  └─► Ink analysis (no model) ──► drawings + lines of text on the page
                                  │
          figures matched, described, cropped, and placed by their position on the page
                                  │
          Markdown → accessible HTML (built in code, not by the model) ──► MathJax
```

A few design choices matter for accuracy:

- **The model only writes Markdown and LaTeX**, which small vision models do reliably. The app's own code builds all the HTML and accessibility markup, so every export has the same structure.
- **Figures are found from the ink itself**, not only from the model, because small models often forget to mention a drawing. Sizes are measured against the author's own letter height, which makes detection work for large or small writing and for portrait or landscape pages.
- **Figures are placed by where they sit on the page**, and text written beside a drawing stays beside it in the export.
- **Model output is cleaned up**: code fences, repeated text, spaced math delimiters, and sentences wrapped in math blocks are fixed, so screen readers read prose as prose.
- **Pages convert one at a time, only when asked**, which keeps memory use low on small machines.

---

## Project layout

```
src/
  App.tsx               app state, conversion queue, upload, export
  components/           settings panel, page view, crop editor, preview
  lib/
    ollama.ts           talks to the local Ollama server
    prompts.ts          instructions given to the model
    pipeline.ts         converts one page from start to finish
    layout.ts           finds drawings and text lines in the ink
    placement.ts        decides where figures go in the text
    transcript.ts       cleans model output; edits figure markers
    markdown.ts         Markdown → accessible HTML
    exportHtml.ts       builds the downloadable HTML document
    images.ts           PDF/image loading, cropping
    mathjax.ts          MathJax for the in-app preview
tests/                  automated tests (npm test)
vite.config.ts          dev server + Ollama proxy
```

Runtime dependencies: React, pdf.js, and MathJax.

---

## Testing

```bash
npm test          # logic, export, and layout tests (needs Node 22.6+)
npm run typecheck
```

---

## Known limits

- **Model misreadings.** The transcription is only as good as the model. Small models occasionally misread words or symbols. A larger model or the **High detail** setting helps. Always proofread before publishing.
- **Very flat drawings** (a lone number line, a single long arrow) may not be detected. Add them with **+ Add figure**.
- **A large bracket or matrix written on its own** may be mistaken for a drawing. Delete it in its figure card.
- **Work isn't saved between sessions.** Refreshing the browser clears all pages, so export before closing.
- **Exported files load MathJax from a CDN**, so viewers need an internet connection to see the rendered math.

---

## License

See [LICENSE](LICENSE).
