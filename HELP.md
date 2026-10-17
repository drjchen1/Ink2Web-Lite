# Ink2Web Lite: User Guide

This guide covers everyday use of Ink2Web Lite 1.4. For installation, see [README.md](README.md).

> **Before you start:** Ink2Web Lite doesn't save your work between sessions. Refreshing or closing the browser tab clears all pages, so download the HTML before you leave.

---

## Contents

1. [The basic workflow](#1-the-basic-workflow)
2. [Choosing a model and settings](#2-choosing-a-model-and-settings)
3. [Adding pages](#3-adding-pages)
4. [Converting](#4-converting)
5. [Reviewing a page](#5-reviewing-a-page)
6. [Working with figures](#6-working-with-figures)
7. [Exporting](#7-exporting)
8. [Accessibility checklist](#8-accessibility-checklist)
9. [Troubleshooting](#9-troubleshooting)
10. [FAQ](#10-faq)

---

## 1. The basic workflow

1. Make sure **Ollama is running** (the llama icon is in your menu bar or system tray).
2. Start the app with `npm run dev` and open **http://localhost:5173**.
3. **Choose a model**, then **add your notes** (PDF or photos).
4. Click **Convert** and wait for each page to finish.
5. **Review each page**: check the text, math, and figures against the original.
6. Click **Download HTML**.

A typical page takes from a few seconds to a minute, depending on your model and computer.

---

## 2. Choosing a model and settings

### Ollama vision model

The dropdown lists every model installed in Ollama, with vision-capable models first. Models marked **no vision** can't read images, so don't use them. If you've just installed a model, click **Refresh**.

**Which model?** Start with a small one, like a 3B model, to make sure everything works. If it misreads your handwriting often, try a larger one, like a 7B model. Larger models are more accurate but slower and need more memory.

### Image detail

This controls how large an image of the page the model sees.

| Setting | When to use it |
|---|---|
| **Fast (1024 px)** | Large, clear handwriting; quick drafts |
| **Balanced (1344 px)** | The default; good for most notes |
| **High detail (1792 px)** | Small or dense writing, subscripts, tiny labels |

### Boost contrast before reading

This turns the page grayscale and darkens the ink before the model sees it. It helps with pencil, faint pens, and phone photos. Turn it off if your notes rely on color, for example red corrections. It doesn't change the figure crops in your export.

### Ask the model where figures are…

When the model and the app's drawing detector disagree on how many figures a page has, this asks the model for their positions so they can be matched correctly. It costs one short extra model call. Leave it on.

### Advanced

- **Ollama URL:** leave this as `/ollama` unless Ollama runs somewhere unusual.
- **Context window (num_ctx):** leave it at 8192. Raise it only if long pages come back cut off.

Your settings are remembered the next time you open the app.

---

## 3. Adding pages

- **Drag and drop** PDFs or images onto the **Notes** area, or click **Choose files**.
- **Paste** a screenshot directly with ⌘V / Ctrl+V.
- Supported formats: **PDF, PNG, JPEG, WebP, GIF, BMP**. iPhone HEIC photos must be converted to JPEG first.
- Each PDF page becomes its own page in the app.
- Use **↑ / ↓** on a page to reorder it, and **Remove** to delete it. **Clear all** starts over.

**Check the page image on the left.** If it looks wrong (missing ink, sideways, very faint), the model will struggle too. Fix the scan first.

---

## 4. Converting

- **Convert** processes all waiting pages, one after another.
- While a page converts, you see the model's output as it's written, then **Finding figures…** while the app locates and describes drawings.
- **Stop** cancels the current page. Click **Convert** again to continue.
- **Re-run** on a page converts it again from scratch, for example after switching to a better model. This replaces any edits you made on that page.

---

## 5. Reviewing a page

Each page shows the **original** on the left and the result on the right.

### Preview and Edit source

- **Preview** shows the page exactly as it will look in the exported HTML, including figure layout.
- **Edit source** shows the transcription as Markdown with LaTeX. Edits update the preview within a moment.

### Markdown and LaTeX basics

| You type | You get |
|---|---|
| `## Heading` | A section heading (`#` is the largest; the document title sits above it) |
| A line of text | A line of text (line breaks are kept) |
| A blank line | A new paragraph |
| `- item` or `1. item` | Bulleted or numbered list |
| `**bold**`, `*italic*` | **bold**, *italic* |
| `$x^2$` | Math inside a sentence |
| `$$\int_0^1 x\,dx$$` | An equation on its own line |
| `$$\begin{aligned} a &= b \\ &= c \end{aligned}$$` | Several aligned equation lines |
| `[[FIGURE 2]]` | Where figure 2 appears |
| `\$` | A literal dollar sign |

Keep ordinary sentences **outside** of `$…$`. Screen readers read anything inside as math.

### Warnings

- **LaTeX warnings** (yellow box) flag common slips: unbalanced braces, unmatched `\begin`/`\end` or `\left`/`\right`, or a stray `$`.
- **Math shown in red** in the preview failed to render. A count above the preview tells you how many. Fix them in **Edit source**.

### What to proofread

The model copies what it sees, mistakes included. It doesn't "correct" your notes. Common things to check:

- misread words (e.g. "leaving" for "leave")
- similar-looking symbols: ℓ vs 1, x vs ×, sin vs sim, subscripts vs superscripts
- missing limits on integrals or sums

---

## 6. Working with figures

Below the preview, each figure has its own card with a thumbnail.

### Badges

| Badge | Meaning |
|---|---|
| **Found by detector** | The app found this drawing in the ink; the model didn't mention it. Its alt text was written separately. |
| **Check** | The crop or description may need attention. Look at it. |
| **Not placed in text** | The figure has no marker in the transcription, so it won't appear in the export. Click **Insert in text**. |

### Alt text

Every figure needs alt text, the description a screen reader reads aloud. The app writes a first draft, but **you know what the drawing is meant to show**, so please review it.

Good alt text for math figures:

- **Says what kind of drawing it is:** "Graph of…", "Diagram of…".
- **Gives what matters for the lesson**, not every stroke: "The region under y = sin x from 0 to π/2 is shaded."
- **Includes the labels** a student needs: axis names, key points, variable names.
- **Uses plain words.** Any LaTeX is converted automatically (`\frac{\pi}{2}` becomes "pi/2"), but plain words read best.

The **Caption** is optional, visible text shown under the figure.

### Adjusting the crop

On the page image, each figure has a numbered box. Click **Adjust crop**, or click a box, to select it. Then:

- **Drag inside the box** to move it.
- **Drag a corner** to resize it.
- **Drag on empty space** to draw a new box.
- **With the keyboard:** Tab to the selected box, then use the **arrow keys** to move it and **Shift + arrow keys** to resize it.

**Snap to ink** tightens the box around the drawing. Edges that cut through strokes move outward, empty margins are trimmed, and a little padding is added. If a line of handwriting touches the box, it may get included. If that happens, drag the edge back.

### Layout in the document

| Control | What it does |
|---|---|
| **Position ↑ Up / ↓ Down** | Moves the figure one line (or one whole equation) earlier or later in the text |
| **Align** | Left, Center, or Right |
| **Width** | 20–100% of the text column |
| **Put text beside the figure** | For Left/Right figures, the following text sits next to the drawing, as in the notes |
| **Lines beside it** | How many lines sit beside the figure; text after that starts below it |

These are set automatically from your page, so you usually only need small adjustments. On phones, figures always stack between lines at a readable size, whatever you choose here.

### Adding or removing figures

- **+ Add figure** first looks for a drawing on the page that isn't a figure yet, and adds it in the right place. If there isn't one, it adds a box at the end for you to draw around the figure.
- **Delete** removes the figure and its marker. The text is unaffected.

---

## 7. Exporting

In the **Export** section at the bottom:

- **Document title** becomes the page title and its main heading. While the title is still the file name (for example "Lesson20-1"), the **first heading in your notes** is used instead. Type your own title to override this.
- **Mark page boundaries** adds small "Page 2", "Page 3" dividers between pages, which screen readers can use to navigate. Turn it off for one continuous document.
- A warning shows how many figures are **missing alt text**.
- Pages that haven't been converted are left out.

**Download HTML** saves one self-contained `.html` file with all figures embedded. You can:

- open it in any browser,
- upload it to Brightspace or a course website,
- print it, or save it as PDF from the browser.

Viewers need an internet connection the first time they open the file, because MathJax loads from a CDN to draw the math.

---

## 8. Accessibility checklist

Before you publish, check:

- [ ] Every figure has meaningful alt text (not just "diagram").
- [ ] The title is a real title, not a file name.
- [ ] Headings follow the structure of your notes.
- [ ] No red math in the preview, and no LaTeX warnings left.
- [ ] Sentences are plain text, not inside `$…$`.
- [ ] Figures appear next to the text that refers to them.
- [ ] You've proofread the transcription against the original.

The export already handles the rest: language, skip link, landmarks, heading order, math for screen readers, keyboard focus, and reflow on small screens.

---

## 9. Troubleshooting

| Problem | Fix |
|---|---|
| **"Cannot reach Ollama"** | Open the Ollama app (or run `ollama serve`), then click **Refresh**. |
| **No models in the list** | Install one: `ollama pull qwen2.5vl:3b`, then **Refresh**. |
| **"This model can't read images"** | Choose a vision model from the list. |
| **A PDF page shows only bits of the handwriting** | The app handles most scanner PDFs. If the page image still looks broken, re-scan or export it as an image and upload that instead. |
| **Lots of misread words** | Try **High detail**, keep **Boost contrast** on, or use a larger model, then **Re-run**. |
| **The output repeats itself or stops early** | The app trims repetition automatically. **Re-run** the page, or try another model. Raise the context window if long pages are cut off. |
| **A figure is missing** | Click **+ Add figure**. |
| **Something that isn't a drawing became a figure** | **Delete** it in its figure card. |
| **A figure's crop cuts off a label** | **Adjust crop** and drag the edge out, or try **Snap to ink**. |
| **Text sits beside a figure that shouldn't** | Lower **Lines beside it**, or turn off **Put text beside the figure**. |
| **Conversion is very slow** | Use **Fast** detail or a smaller model. Close other memory-heavy apps. The first page is slower while the model loads. |
| **Math shows as raw `\(…\)` in the exported file** | The viewer is offline; MathJax needs the internet to load. |

---

## 10. FAQ

**Does anything leave my computer?**
No. Your notes go only to Ollama on your own machine. The only outside connection is MathJax loading when someone opens the exported file.

**Can I close the app and continue later?**
Not in this version. Pages live only in the open browser tab, so finish and download before closing.

**Will it fix mistakes in my notes?**
No, on purpose. It transcribes exactly what's written, so you control every change.

**Can I convert many pages at once?**
Yes. Add them all and click **Convert**; they're processed one after another. A multi-page PDF exports as one document.

**Why does it use both a model and a "detector" for figures?**
Small vision models often forget to mention a drawing or misjudge where it is. The detector finds drawings directly from the ink in a fraction of a second, and the model describes them. Each covers the other's weak spot.

**Which browser should I use?**
Any current Chrome, Edge, Firefox, or Safari.
