# Ink2Web Lite

Ink2Web Lite turns handwritten math notes (scanned PDFs or photos) into clean, accessible HTML. Equations are rendered with MathJax, and hand-drawn figures are extracted as images with alt text.

Everything runs on your own computer. The app uses a vision model running locally in [Ollama](https://ollama.com), so:

- 🔒 **Your notes never leave your machine.** There are no cloud uploads.
- ⚡ **No API keys or subscriptions** are needed.
- 💻 **It runs on everyday hardware**, including Apple Silicon laptops with 8 GB of RAM.

Version 1.7.2. For step-by-step usage, see **[HELP.md](HELP.md)**.

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
- **`src/lib/transcript.ts`**: the clean-up step that repairs model output after transcription. This is the better place for model-specific fixes, because it costs nothing in prompt length and helps every model. For example, models that write `\( x \)` with inner spaces are already handled here.

Run `npm test` after changes, and compare a few pages you know well before and after.

---

## What's new

### 1.7.2
- **One annotation style.** Arrow and brace notes always become a sentence after the equation ("where ω is the frequency"). The *as drawn* option is gone, and the prompt no longer mentions `\underbrace`, `\overbrace` or `\underset`, which keeps it shorter. You can still type those by hand in **Edit source**; they render as before.
- **Documented model support:** tuned for qwen3-vl:4b-instruct and qwen2.5vl:3b.

### 1.7.1
- Circles, boxes, and brackets drawn around words are no longer treated as figures.
- The prompt names more functions and operators (`\log`, `\sqrt`, `\times`, `\cdot`).

### 1.7
- **Arrow and brace notes become sentences.** The model reports each note as `[[note: term | words]]`; the app writes the sentence after the equation, so the wording is always consistent:

  > $$u(t) = R\cos(7t - \delta)$$
  > *where R is the new amplitude and δ is the phase shift.*

  Word notes read "ω is the frequency"; math notes on braces read "cos(−δ) = cos(δ)"; single letters read "a = ωt"; describing words read "−0.3 is upward". Several notes on one equation are joined with "and". Colored notes keep their color. Arrows and braces the model draws inside an equation anyway are moved out into notes.

### 1.6.1
- Math rule first in the prompt; plain-text equations rescued as display math; arrow notes copied as stacked words joined; a leading minus no longer becomes a bullet; small narrow drawings (like a spring) detected.

### 1.6
- Handwriting marks: boxed results, underlined words, comments in a different ink color (accessible shades, also italic), and a column of dots for skipped steps. **Boost contrast** keeps ink colors.

---

## What it does

- Reads handwritten notes and transcribes them into text and LaTeX, keeping the author's wording and marks.
- Turns arrow and brace notes into "where…" sentences after the equation.
- Finds hand-drawn figures (graphs, diagrams, sketches), crops them, and places them where they appear in the notes.
- Copies the original layout: figure size, alignment, and text written beside a drawing.
- Produces a single self-contained HTML file built for accessibility:
  - correct heading structure and landmarks
  - MathJax with assistive MathML
  - alt text for every figure
  - colors that meet WCAG contrast, never used as the only cue
  - reflow on small screens
- Lets you convert only the pages you want, and review and fix everything before exporting.

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

If Ollama runs on a different machine:

```bash
OLLAMA_HOST=http://192.168.1.20:11434 npm run dev
```

### Updating to a new version

Replace the project files (keep or delete `node_modules`), then run `npm install` and `npm run dev` again. Reload the browser tab so it picks up the new code.

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
                  ├─► Vision model: transcribe ──► Markdown + LaTeX + marks + notes + figure markers
                  │
                  └─► Ink analysis (no model) ──► drawings + lines of text on the page
                                  │
          figures matched, described, cropped, and placed by their position on the page
                                  │
          Markdown → accessible HTML (built in code, not by the model) ──► MathJax
```

A few design choices matter for accuracy:

- **The model only writes Markdown and LaTeX**, plus small extensions for underlined words, colored ink, and notes. Small vision models do this reliably. The app's own code builds all the HTML and accessibility markup, so every export has the same structure.
- **The model reports notes; the app writes the sentences.** Deciding where an arrow points inside LaTeX is hard for a small model. Naming the term and copying the note is not.
- **Model quirks are fixed after transcription, not in the prompt.** The clean-up step repairs code fences, repeated text, spaced math delimiters, HTML color tags, plain-text equations, and sentences wrapped in math blocks, so screen readers read prose as prose and math as math.
- **Figures are found from the ink itself**, not only from the model, because small models often forget to mention a drawing. Sizes are measured against the author's own letter height, which makes detection work for large or small writing and for portrait or landscape pages.
- **Figures are placed by where they sit on the page**, and text written beside a drawing stays beside it in the export.
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
    transcript.ts       cleans model output; moves drawn notes out; edits figure markers
    markdown.ts         Markdown (+ marks, "where" sentences) → accessible HTML
    exportHtml.ts       builds the downloadable HTML document
    images.ts           PDF/image loading, contrast boost, cropping
    mathjax.ts          MathJax for the in-app preview
tests/                  automated tests (npm test)
vite.config.ts          dev server, Ollama proxy, asset copying
```

Runtime dependencies: React, pdf.js, and MathJax.

---

## Testing

```bash
npm test          # logic, export, layout, notation, and prompt tests (needs Node 22.6+)
npm run typecheck
```

---

## Known limits

- **Model misreadings.** The transcription is only as good as the model. Small models occasionally misread words or symbols (a handwritten 7 read as 9, for example). **High detail** helps. Always proofread before publishing.
- **Spelling gets "corrected."** Small models tend to fix the author's spelling despite instructions to copy exactly. Fix it back in **Edit source** if it matters.
- **Notes need the right target.** A "where…" sentence is only as good as the term the model names. If it names the wrong term, edit the `[[note: term | words]]` line.
- **Very flat drawings** (a lone number line, a single long arrow) may not be detected. Add them with **+ Add figure**.
- **A large bracket or matrix written on its own** may be mistaken for a drawing. Delete it in its figure card.
- **Work isn't saved between sessions.** Refreshing the browser clears all pages, so export before closing.
- **Exported files load MathJax from a CDN**, so viewers need an internet connection to see the rendered math.

---

## License

See [LICENSE](LICENSE).
