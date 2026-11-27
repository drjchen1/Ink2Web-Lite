# Ink2Web Lite: User Guide

This guide covers everyday use of **Ink2Web Lite 3.5.0**. For installation, model setup, and developer documentation, see [README.md](README.md) and [docs/REDRAW.md](docs/REDRAW.md).

> **Your work saves automatically** in this browser on this computer. To back up a copy or move work to another computer or browser, click **Save** in the top bar to download a `.ink2web.json` project file. See [Saving your work](#8-saving-your-work).

---

## Contents

1. [The basic workflow](#1-the-basic-workflow)
2. [Choosing a model and settings](#2-choosing-a-model-and-settings)
3. [Adding pages](#3-adding-pages)
4. [Converting](#4-converting)
5. [Reviewing and editing a page](#5-reviewing-and-editing-a-page)
6. [Handwriting marks: arrows, braces, boxes, colors](#6-handwriting-marks-arrows-braces-boxes-colors)
7. [Working with figures](#7-working-with-figures)
8. [Saving your work](#8-saving-your-work)
9. [Exporting](#9-exporting)
10. [Accessibility checklist](#10-accessibility-checklist)
11. [Known issues](#11-known-issues)
12. [Troubleshooting](#12-troubleshooting)
13. [FAQ](#13-faq)

---

## 1. The basic workflow

### The screen

- **Top bar** (always visible): the Ink2Web Lite title, document title field, save timestamp, **Open** and **Save** buttons for `.ink2web.json` project files, the **model button** (opens Model and settings; shows ☁ for GenAI Studio or ⚠ if attention is needed), and **Export**.
- **Page list** (left sidebar): thumbnail, status, and issue count for every page, plus **+ Add pages**, **Convert all** (or **Stop**), and **Clear all pages**.
- **Workspace** (main pane): one page at a time. The **original** scan stays visible on the left as you scroll, with the page's figures (or re-read selection controls) above it; the converted **document** sits on the right. Along the top are **← Prev / Next →**, **Convert again**, **↑ / ↓** to reorder pages, and **Remove**.

On narrow screens, the page list stacks above the workspace and the original sits above the document.

### Step by step

1. Start **Ollama** (the llama icon is in your menu bar or system tray) — unless you are using Purdue GenAI Studio.
2. Start Ink2Web Lite with `npm run dev` and open **http://localhost:5173**.
3. Pick a model via the **model button** in the top bar.
4. Drop a PDF or page images anywhere in the window (or click **Open a saved project** / pick a session under **Recent sessions in this browser**).
5. Click **Convert this page**, or **Convert all** in the sidebar.
6. **Review each converted page** beside the original: click any paragraph, equation, or figure to fix it in place, or choose **Image / Redrawn / Both** for mathematical plots.
7. Click **Export**, clear anything flagged under **Before you export**, and click **Download HTML**.

---

## 2. Choosing a model and settings

Click the **model button** in the top bar to open **Model and settings**. Close with **×**, Esc, or clicking outside. Settings cannot be changed while a page is actively converting.

### Where the model runs

- **This computer (Ollama)** *(default)*: everything runs locally; nothing leaves your machine.
- **Purdue GenAI Studio** (`☁`): sends page images and prompts through Ink2Web Lite's local proxy to Purdue's hosted models. Requires `GENAI_API_KEY` in `.env.local` (see [README.md](README.md#purdue-genai-studio-optional)). Use it for your own lecture notes — **never for student work (FERPA)**.

Each provider remembers its last selected model separately.

### Vision model selection

**Any vision model** works with Ink2Web Lite. For local machines, models are prioritized in recommended order for the **Everyday hardware** pipeline:

| Priority | Model | Pull command | Best for |
|---|---|---|---|
| **1 (Primary)** | **Qwen3.5 4B (MLX)** | `ollama pull qwen3.5:4b-mlx` | Everyday primary model on Apple Silicon Macs (all tasks + Line-DSL redraws) |
| **2 (Secondary)** | **LightOnOCR-3 4B / 3B** | `ollama pull Maternion/LightOnOCR-3:4b-q4_K_M` *(or `lightonocr-3:3b`)* | Dedicated OCR & native page grounding (`"grounding"` / `""` modes); crops figures with `"Hand-drawn figure."` (switch the top-bar model to `qwen3.5:4b-mlx` or `ministral-3:3b` anytime to run **Describe with the model** or **Redraw with the model** on individual figures without re-converting the page) |
| **3 (Secondary)** | **Ministral 3 3B** | `ollama pull ministral-3:3b` | Fast non-thinking multimodal model on Windows, Linux, and Mac |
| **4 (Fallback)** | **Qwen3.5 2B (MLX)** | `ollama pull qwen3.5:2b-mlx` | Lightweight Apple Silicon fallback for simpler documents |
| **5 (Fallback)** | **Gemma 4 E2B** | `ollama pull gemma4:e2b-it-qat` | Lightweight fallback for simpler documents on any OS |
| *(8B+ models)* | **Qwen3-VL 8B Instruct+** | `ollama pull qwen3-vl:8b-instruct` | Higher accuracy on beefier hardware; pair with the **Larger models** prompt |

Models labeled **no vision** cannot read images. Click **Refresh** after pulling a new model.

### Automatic per-task thinking & Context window

- **Task-aware thinking:** You do not need to pull separate `-instruct` vs `-thinking` models for Qwen 3.5 or Gemma 4. Ink2Web Lite disables thinking (`think: false`) for verbatim page transcription, cropped re-reads, figure bounding boxes, short alt text, detailed figure descriptions, and fast first-pass auto-redraws, while automatically turning thinking **on** (`think: true`) for `qwen3.5:4b-mlx` (and 8B+ models) when repairing failed redraws or when you click **Redraw with the model** manually. Small fallback models (`qwen3.5:2b-mlx`, `gemma4:e2b-it-qat`, `ministral-3:3b`) and `LightOnOCR-3` always keep thinking off for speed and stability.
- **Context window (`num_ctx`):** Choose **4096**, **8192**, or **16384** right in **Model and settings**:
  - **8 GB machines:** use **`4096`** with 4B models (`qwen3.5:4b-mlx`, `LightOnOCR-3:4b`) to prevent memory swapping, or **`6144–8192`** with 2B–3B models (`ministral-3:3b`, `qwen3.5:2b-mlx`, `gemma4:e2b-it-qat`) — 4B models have larger weights and wider per-token KV caches sharing the same ~5 GB usable GPU/unified RAM pool.
  - **16 GB+ machines:** use **`8192`** for everyday pages, or **`12288–16384`** for dense **High detail** pages and mathematical redraws.

### Transcription prompt

- **Everyday hardware** *(default)*: short, high-signal rules suited to 3B–4B models.
- **Larger models**: richer formatting rules (multi-line alignment, matrices/`cases`, tables, look-alike disambiguation, margin reading order) for 8B+ models and GenAI Studio.
  - **With Larger models: also write a short title and a detailed description for each figure**: enabled by default when **Larger models** is active; adds one extra pass per figure to produce a math-aware title (rendered in Page Cards caption bars) and a collapsible **Detailed description**.

### Processing options

| Setting | Default | What it does |
|---|---|---|
| **Image detail** | **Balanced (1344 px)** | Choose **Fast (1024 px)** for large clear writing or **High detail (1792 px)** for tiny subscripts and dense brace notes. |
| **Boost contrast before reading** | On | Darkens faint pencil/pen ink and whitens paper while **preserving ink colors** (`red`, `green`, `blue`, `orange`, `purple`). |
| **Ask the model where figures are when its list and the detected drawings disagree** | On | Helps align figure markers with actual drawing crops when page counts differ. |
| **Redraw mathematical graphs as clean SVG when their equation is in the notes** | On | Automatically drafts crisp mathematical SVGs during conversion and checks curves against the original ink. |
| **Split dense small-model pages or two-column handouts into bands before reading** | On | Splits tall dense pages or two-column layouts into overlapping strips before reading so small vision models don't skip lines or merge columns. |
| **Unload model from memory when conversion finishes** | On | Sends `keep_alive: 0` once the queue finishes so Ollama frees 2–5 GB of RAM immediately during review and touch-up (recommended on 8 GB machines). You can also click **Free RAM** in Model and settings anytime. |

### Advanced settings & Prompt Inspector

Under **Advanced**:
- **Ollama URL**: keep `/ollama` unless connecting to a custom endpoint (`OLLAMA_ORIGINS` may be needed for direct cross-origin URLs).
- **Transcription prompt › Inspect or change**: view the active prompt, test temporary edits, check required format markers (`[[FIGURE: ...]]`, `[[note: term | words]]`, `$...$`), save named presets in your browser, and choose a custom prompt to load on startup. A **Custom prompt in use** banner always shows whenever a non-built-in prompt is active.

---

## 3. Adding pages

- **Drag and drop** PDFs, images, or `.ink2web.json` project files anywhere in the window (or click **+ Add pages** / **Choose files**).
- **Paste** screenshots directly from your clipboard (`⌘V` / `Ctrl+V`).
- Supported image formats: **PDF, PNG, JPEG, WebP, GIF, BMP**. (Convert iPhone HEIC photos to JPEG before adding.)
- Use **↑ / ↓** at the top of a page to reorder it, **Remove** to delete it, or **Clear all pages** in the sidebar to start over.

---

## 4. Converting

- **In the browser:** Click **Convert this page** or **Convert all** (`Waiting` status; **Cancel waiting** / **Stop** anytime). Re-converting an existing page keeps your previous version if cancelled or failed.
- **Headless CLI (lowest memory on 8 GB machines):** Quit or close extra browser tabs, run `npm run convert -- notes/lecture05.pdf --8gb` in Terminal (uses ~150 MB of Node RAM, crops figures without auto-redraw by default for speed — add `--redraw` if you also want SVG redraws — and writes both `lecture05.ink2web.json` and `lecture05.html`), then click **Open** in the Web UI to review with Ollama stopped (**Review mode (offline)**). Model jobs always run one at a time.

---

## 5. Reviewing and editing a page

### Review Queue, Scan Spotlight, Loupe & Undo

- **Review bar:** Whenever any converted page has `[illegible]` spots, LaTeX warnings, missing/uncertain alt text, or redraws flagged **Compare against sketch**, an amber bar at the top lists the count and lets you step through every item (`←` / `→` or `Alt+[` / `Alt+]`), open the exact block or figure, or resolve flagged redraws in one click (**Looks right** / **Keep image** / **Show both**).
- **Scan Spotlight & 2.2× Loupe:** Hovering or editing a block on the right highlights the matching horizontal band on the original scan and scrolls it into view. Click **Loupe** above the scan (or hold **`Alt`** while moving the pointer) for a crisp **2.2× magnifier** over tiny subscripts or exponents.
- **Page-wide Undo / Redo:** Click **↶ Undo** / **↷ Redo** above the document (or press `⌘/Ctrl+Z` and `⌘/Ctrl+Shift+Z` outside text boxes) to undo or redo block edits, deletions, crop adjustments, figure moves, or redraw edits across the page.
- **Review mode (offline):** When all loaded pages are already converted (such as an opened `.ink2web.json`) and Ollama is turned off, the top bar cleanly shows **Review mode (offline)** — every local edit, crop, redraw, and offline HTML export tool works with zero AI loaded.

### Click to edit (Preview mode)

Every paragraph, display equation block, and figure highlights on hover. Click any block (or Tab to it and press Enter) to open the **in-place editor** with the Markup Toolbar above it and a live preview below it:

| Action | Shortcut / Control |
|---|---|
| Save edits & close block | **Done** or `⌘/Ctrl+Enter` |
| Discard edits & close block | **Cancel** or `Esc` |
| Wrap selection in `$...$` inline math | `$x$` button or `⌘/Ctrl+M` |
| Format display equation `$$...$$` | `$$` button or `⌘/Ctrl+Shift+M` |
| Wrap or format boxed equation (`\boxed{...}`) | **Box** button or `⌘/Ctrl+B` |
| Underline text or `\underline{...}` inside math | **U** button or `⌘/Ctrl+U` |
| Insert `\frac`, `\int`, `cases`, matrices, Greek symbols | **Symbols ▾** palette |
| Split one block into two or join adjacent blocks | **Split at cursor** / **Merge next** |
| Undo toolbar formatting inside box | `⌘Z` / `Ctrl+Z` |

Clearing all text in a block and clicking **Done** removes that block. Switching to **Edit source** edits the entire page's Markdown/LaTeX at once.

### Re-read from image

When the model garbled one line or formula:

1. Click the block to open its editor, then click **Re-read from image…**.
2. Drag a box over that exact region on the **original** image on the left.
3. Click **Re-read this region**.
4. Inspect or tweak the proposed text, click **Use this** (or **Try another box** / **Keep mine**), then press **Done**. Nothing on the page changes until you press **Done**.

### Markdown and LaTeX reference

| Source | Output |
|---|---|
| `## Heading` | Section heading |
| Plain line break | Kept cleanly as a line break |
| Blank line | New paragraph / clickable block |
| `- item` or `1. item` | Bulleted or numbered list |
| `**bold**`, `*italic*` | **bold**, *italic* |
| `$x^2 + 1$` | Inline math (do not put regular prose inside `$...$`) |
| `$$\int_0^1 x\,dx$$` | Centered display equation |
| `$$\begin{aligned} a &= b \\ &= c \end{aligned}$$` | Aligned multi-line equations |
| `[[FIGURE 2]]` | Places Figure 2 |
| `\$` | Literal dollar sign |

Yellow **LaTeX warnings** highlight unbalanced braces, unmatched `\left`/`\right`, or stray `$` delimiters; equations shown in red failed MathJax parsing and can be fixed in place.

---

## 6. Handwriting marks: arrows, braces, boxes, colors

### Arrow and brace notes

Notes pointing at part of an equation are stored as one line per note right underneath the equation:

```markdown
$$u(t) = R\cos(\omega t - \delta)$$
[[note: R | new amplitude]]
[[note: \delta | phase shift]]
```

- In **Classic** look, these render as a smooth *"where…"* sentence (*"where R is new amplitude and δ is phase shift"*).
- In **Page cards** look, multi-note groups render cleanly in a structured `.notebox` callout list so long derivations stay scannable.
- Purely mathematical equivalence notes automatically use `=` (e.g. `[[note: \cos(-\delta) | \cos(\delta)]]` → *"where cos(−δ) = cos(δ)"*), while verbal annotations use *is*.

Use the **Note** toolbar button (select the term first, e.g. `\omega`) to insert `[[note: \omega | ]]` with the cursor positioned cleanly.

### Boxes, skipped steps, underlines, and colors

| Handwritten mark | Toolbar button | Source syntax |
|---|---|---|
| Boxed formula | **Box** | `$$\boxed{R = \sqrt{A^2 + B^2}}$$` |
| Skipped steps | **⋮** | `$$\vdots$$` on its own line |
| Underlined prose / math | **U** | `<u>critically damped</u>` or `$\underline{x}$` |
| Colored prose / math ink | **Color…** | `[[red: key assumption]]` or `$\color{red}{u'(0)}$` |

All ink colors (`red`, `green`, `blue`, `orange`, `purple`) map to high-contrast shades that meet WCAG contrast guidelines on white, and colored prose uses italics so color is never the sole indicator.

---

## 7. Working with figures

Click any figure in the document, its crop box on the original image, or its badge in the **Figures** row above the original to open its in-place **Figure Panel**. Press **Done** or **Esc** to close it.

### Status badges

| Badge | Meaning |
|---|---|
| **Found by detector** | Detected by ink analysis rather than a model `[[FIGURE]]` marker. |
| **Check crop** | Crop or placement is estimated; dragging/resizing the crop box clears this. |
| **Check alt text** | Alt text appears to contain notes written *beside* the drawing instead of describing the drawing itself. |
| **Compare against sketch** | Auto-redraw had medium/low ink agreement — compare the SVG against the original sketch and click **Looks right** or switch back to **Image**. |
| **Not placed in text** | No `[[FIGURE n]]` marker exists in the page text; click **Insert in text** to place it. |
| **Redrawn** / **Redrawn + image** | Showing the mathematical SVG redraw (alone, or with the original crop collapsed underneath). |
| **Redraw has errors** | **Redrawn** or **Both** was selected, but the spec currently has syntax/math errors — the document safely shows the image until fixed. |

### Alt text, Captions, Detailed descriptions, and Moving text

- **Alt text**: Concise plain-language description read by screen readers.
- **Caption**: Optional visible caption below the figure (`$...$` math renders cleanly). In **Page cards**, if no caption is entered, the caption bar shows the figure's title (from the figure pass, or derived from a redraw's `from:` equation).
- **Detailed description**: Multi-sentence mathematical description shown in a collapsible `<details>` block under the figure (auto-expanded when printing). Generate one per figure with **Describe with the model**.
- **Move to notes**: If prose or equations beside a sketch leaked into the alt text, highlight that portion in the alt text box and click **Move to notes** to insert it into the transcription immediately after the figure.

### Crops and Layout

- **Adjusting crops**: Drag inside the selected blue box to move it, drag corners to resize, drag empty space to draw a new box, or use **arrow keys** (`Shift + arrows` to resize) when focused. Click **Snap crop to ink** to tighten automatically.
- **Add / Delete**: Click **+ Add** in the **Figures** row above the original to add a missed figure; click **Delete figure** inside its panel to remove a false detection.
- **Layout controls**: **Position ↑ Up / ↓ Down**, **Align** (Left / Center / Right), **Width** (`20–100%`), **Put text beside the figure**, **Lines beside it**, and **Side by side with figure n** (automatically stacks side-by-side drawings on wide screens and wraps on narrow screens).

---

### Redrawing figures from the math

Ink2Web Lite 3.5.0 uses the **Clean-Slate Redraw v2** engine to turn hand-drawn calculus, ODE, signals/systems, and schematic diagrams into exact inline SVGs with computed alt text — while **always keeping your cropped original sketch one click away**. Check **Overlay sketch** (with the opacity slider) above the redrawn SVG to inspect your original handwriting transparently behind the computed plot. (If the page was transcribed with an OCR-only model such as `LightOnOCR-3`, switch the top-bar model to a general VLM like `qwen3.5:4b-mlx` or `ministral-3:3b` to run **Redraw with the model** in place.)

#### Automatic vs Manual Redraw

- During page conversion (when enabled in Settings), the app analyzes the sketch's ink geometry, pulls nearby equations into an **Equation Menu (`@eq1`, `@eq2`)**, asks the model for a concise **Line-DSL** spec, and compares the resulting curves back against the original ink:
  - **High confidence**: automatically shows **Redrawn** (you can still switch back to **Image** or **Both** anytime).
  - **Medium confidence**: shows **Both** and flags **Compare against sketch** so you can visually confirm.
  - **Low confidence**: keeps **Image** active while saving the draft spec so you can inspect or tweak it manually.
- On any figure manually, expand **Redraw from the math** and click **Redraw with the model** or pick a category (**Graph / Piecewise**, **Region / Riemann sum**, **Phase plane / Slope field**, **s-plane / Number line**, **Block / Spring diagram**) and click **Start from template**.

#### Choosing what appears in the document

Under **In the document**, toggle between:
- **Image**: Shows only the cropped original drawing.
- **Redrawn**: Shows only the crisp inline SVG and its computed accessible description.
- **Both**: Shows the SVG redraw with the cropped original sketch in a collapsible **Original sketch** panel underneath it.

#### Editing with Visual Controls or Line-DSL

- **Scene & layer controls**: Adjust `from` (title/equation), coordinate space (`Cartesian`, `Polar`, `Complex s-plane`, `1D Number line`), axis labels & min/max bounds (leave Y blank for auto-framing), and edit/add/remove individual `curve`, `shade`, or `point` layers without writing code.
- **Spec (Line-DSL or JSON)** *(collapsible drawer)*: Edit the Line-DSL directly with live validation and debounce preview. Supports native LaTeX (`\frac{1}{x}`, `\sqrt{x}`, `u_c(t)`, `\begin{cases}...\end{cases}`), constants (`pi/2`), slope/vector fields, Riemann sums, complex poles/zeros/ROC, and block diagrams.
- **Legacy v1 JSON specs**: Older saved `.ink2web.json` specs continue to render identically, and display an **Upgrade to Line-DSL** button inside the Redraw panel when you want to convert them to v2.

For the full syntax guide, see [docs/REDRAW.md](docs/REDRAW.md).

---

## 8. Saving your work

- **Browser autosave (IndexedDB):** Edits, pages, crops, and redraw specs save continuously in your browser. Reopening offers **Continue where you left off?** (**Restore** / **Start fresh**).
- **Recent sessions:** The welcome screen lists your recent browser sessions so you can jump back between documents quickly.
- **Multi-tab protection:** If the same app URL is open in two tabs and another tab saves newer edits, an alert banner offers **Reload latest** or **Keep and save this tab** so tabs never silently overwrite each other.
- **Project files (`.ink2web.json`):** Use **Save** / **Open** in the top bar for permanent backups, sharing drafts, or moving between `localhost:5173` (dev) and `localhost:4173` (preview).

---

## 9. Exporting

1. Check and edit the **Document title** in the top bar (if left as a file name, the first heading in your notes becomes the HTML `<title>` and `<h1>`).
2. Click **Export** in the top bar.
3. Clear any items under **Before you export** (each links straight to its page/figure).
4. Choose export options:
   - **Look**: **Page cards** *(default — one card per page, figure caption bars, one card per letter sheet when printing)* or **Classic** *(continuous single-column reading flow)*.
   - **Show page badges / Mark page boundaries**: Toggle visible page numbers/dividers.
   - **Link to the original**: When converting a PDF/image in Page Cards mode, adds a link at the top of page 1 (place the original file in the same folder as the HTML).
   - **Work offline**: Pre-renders all MathJax equations into static CHTML with embedded fonts inside the exported `.html` file so viewers can open it anywhere with zero internet connection. Leave unchecked for smaller files that load MathJax from a CDN.
5. Click **Download HTML**. Unconverted pages are excluded.

---

## 10. Accessibility checklist

- [ ] Document title in the top bar reflects the lesson/topic, not just a scan filename.
- [ ] Headings reflect real section hierarchy (`##`, `###`).
- [ ] Zero red MathJax parse errors and zero LaTeX warnings remain.
- [ ] Plain prose sentences sit *outside* `$...$` math delimiters.
- [ ] Every visible image figure has clear, concise alt text describing only the drawing (and **Check alt text** is resolved).
- [ ] Every **Redrawn** figure matches the lesson equation (`Redrawn from:`) and its **Compare against sketch** check (if shown) has been verified.
- [ ] Colored highlights make sense when read aloud without color cues.

---

## 11. Known issues

| Issue | Quick Fix |
|---|---|
| Nearby prose captured inside figure alt text | Look for **Check alt text**, select the sentence inside the alt text box, click **Move to notes**. |
| Misread handwritten numbers or variables | Click block → **Re-read from image…** or fix text directly; **High detail (1792 px)** helps. |
| Model alters author spelling | Proofread against original pane and restore wording if needed. |
| `[[note:]]` highlights wrong sub-term | Open the equation block and edit the left side of `\|` in `[[note: term | words]]`. |
| Faint number line or arrow skipped by ink detector | Click **+ Add** in the **Figures** row above the original scan. |

---

## 12. Troubleshooting

| Problem | Fix |
|---|---|
| **"Cannot reach Ollama"** | Launch the Ollama app (or run `ollama serve`), then click **Refresh**. |
| **"GenAI Studio refused the API key"** | Verify `GENAI_API_KEY` in `.env.local`, then restart `npm run dev`. |
| **No vision models listed** | Pull `qwen3.5:4b-mlx` (Apple Silicon) or `qwen3-vl:4b-instruct`, then click **Refresh**. |
| **Very slow conversion / empty output** | On 8 GB Macs/PCs, a large **Context window** (`> 4096` with a 4B model) or **High detail** can push Ollama into swap — lower `num_ctx` to `4096`, pick **Fast (1024 px)** detail, or switch to a 2B–3B fallback model (`qwen3.5:2b-mlx`, `ministral-3:3b`). |
| **`LightOnOCR-3` leaves `"Hand-drawn figure."` / skips auto-redraw** | `LightOnOCR-3` is OCR-only and cannot answer figure-description or Line-DSL redraw prompts. Edit the alt text yourself, or switch the top-bar model to `qwen3.5:4b-mlx` or `ministral-3:3b` and click **Describe with the model** / **Redraw with the model** on the figure. |
| **Math shows raw `\(…\)` when opened offline** | Re-export with **Work offline** checked in the Export dialog. |
| **Redrawn figure doesn't look right** | Open **Redraw from the math**, tweak bounds/expressions in **Scene & layer controls** or **Spec (Line-DSL or JSON)**, or switch **In the document** back to **Image** or **Both**. |
| **Newer edits banner between tabs** | Click **Reload latest** to pull the newer tab's state, or **Keep and save this tab** if you want this tab's edits to win. |
| **Saved work missing after switching commands** | `npm run dev` (`:5173`) and `npm run preview` (`:4173`) have separate browser storage; export/open a `.ink2web.json` project file to transfer work. |

---

## 13. FAQ

**Does anything leave my computer?**
Not when using **This computer (Ollama)**. Only when you explicitly switch to **Purdue GenAI Studio (`☁`)** are page images sent to Purdue's servers. Autosaves and project files always stay local.

**Will auto-redraw ever delete my hand-drawn sketch?**
No. The original crop is always kept in your project. You can switch any figure between **Image**, **Redrawn**, and **Both** at any time, or remove the redraw completely.

**Can exported HTML files be opened completely offline?**
Yes — check **Work offline** in **Export** to pre-render all MathJax math and embed fonts directly in the HTML file.

**How do I write mathematical redraw specs by hand or test them?**
You can use **Scene & layer controls** in the Figure Panel, edit the **Spec (Line-DSL or JSON)** box directly, or open `http://localhost:5173/figure-lab.html` during `npm run dev` for a live sandbox. See [docs/REDRAW.md](docs/REDRAW.md).
