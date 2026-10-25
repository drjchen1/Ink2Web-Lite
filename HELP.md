# Ink2Web Lite: User Guide

This guide covers everyday use of Ink2Web Lite 2.1. For installation, see [README.md](README.md).

> **Your work is saved as you go**, in this browser on this computer. To keep a copy you can move or back up, use **Save** in the top bar. See [Saving your work](#8-saving-your-work).

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

- **Top bar** (always visible): the document title, when work was last saved, **Open** and **Save** for project files, the **model button** (shows the model in use; click it for settings), and **Export**.
- **Page list** (left): every page with a thumbnail, its status, and how many things on it still need checking. Click a page to show it. **+ Add pages**, **Convert all** (or **Stop**), and **Clear all pages** are here too.
- **Workspace** (right): one page at a time. The **original** is on the left and stays in view while you scroll; the **document** is on the right. The page's own buttons are along its top: **← Prev / Next →**, **Convert again**, **↑ / ↓** to reorder, **Remove**.

On a narrow window the page list moves above the workspace, and the original sits above the document.

### Step by step

1. Make sure **Ollama is running** (the llama icon is in your menu bar or system tray).
2. Start the app with `npm run dev` and open **http://localhost:5173**.
3. **Choose a model**, then **add your notes** (PDF or photos), or choose **Restore** / **Open** to continue earlier work.
4. Click **Convert this page**, or **Convert all** in the page list.
5. **Review each converted page** against the original. Click anything that needs fixing, edit it in place, and press **Done**. Check each figure's alt text. Expect some light editing; the app is an assistant, not a one-click converter.
6. Click **Export**. It lists anything still flagged (missing alt text, figures to check, LaTeX warnings), each linked to its page. Then **Download HTML**. Only converted pages are included.

A typical page takes from a few seconds to a minute, depending on your model and computer.

---

## 2. Choosing a model and settings

Click the **model button** in the top bar (it shows the current model, or ⚠ when there's a problem) to open **Model and settings**. Close it with **×**, Esc, or a click outside.

### Ollama vision model

The dropdown lists every model installed in Ollama, with vision-capable models first. Models marked **no vision** can't read images. If you've just installed a model, click **Refresh**.

**Ink2Web Lite is tuned for two Qwen models:**

| Model | Install |
|---|---|
| Qwen3-VL 4B, instruct build (recommended) | `ollama pull qwen3-vl:4b-instruct` |
| Qwen2.5-VL 3B (smaller fallback) | `ollama pull qwen2.5vl:3b` |

Both run on an 8 GB Apple Silicon Mac. Other vision models may work, but the prompt and clean-up are tested only with these two. If you want to adapt the app to another model, see "Tuned for Qwen" in the README.

**Tip for comparing:** convert one page with one model, switch models, then click **Convert again** on the same page.

### Use "instruct" models, not "thinking" ones

- **Thinking (reasoning) builds** write out hidden step-by-step "thinking" before they answer. For a page transcription, that thinking can be several times longer than the transcription itself, so conversion is much slower, and long pages can come back empty or cut off.
- **Instruct builds** answer directly. They're much faster and more reliable for this job.

**For Qwen3-VL**, the default tags (like `qwen3-vl:4b`) are thinking builds. Use `qwen3-vl:4b-instruct` instead. To check an installed model, run `ollama show <model>` and look for `thinking` under **Capabilities**.

### Image detail

| Setting | When to use it |
|---|---|
| **Fast (1024 px)** | Large, clear handwriting; quick drafts |
| **Balanced (1344 px)** | The default; good for most notes |
| **High detail (1792 px)** | Small or dense writing, subscripts, notes under braces and arrows |

### Boost contrast before reading

Darkens the ink and whitens the paper before the model sees it. Helps with pencil, faint pens, and phone photos. **Ink colors are kept**, so colored comments are still noticed.

### Ask the model where figures are…

When the model and the app's drawing detector disagree on how many figures a page has, this asks the model for their positions. Leave it on.

### Advanced

- **Ollama URL:** leave this as `/ollama` unless Ollama runs somewhere unusual.
- **Context window (num_ctx):** leave it at 8192; 4096 saves memory on an 8 GB machine.
- **Transcription prompt:** the instructions the model gets for each page. See [Inspecting or changing the prompt](#inspecting-or-changing-the-prompt).

#### Inspecting or changing the prompt

Under **Advanced › Transcription prompt**, click **Inspect or change** to see the exact prompt sent to the model with each page. You can also try an edited version, for example when testing a different model:

1. Edit the text.
2. Click **Use this prompt**. Pages you convert from now on use it; pages already converted keep their text.
3. Compare with **Convert again** on a page you know well.

Things to know:

- **It's temporary.** The edited prompt isn't saved, and it ends when you reload the app. **Reset to default** (or **Use the default prompt** in the banner) switches back at any time.
- **You'll always see when it's on:** a **Custom prompt in use** banner appears under the top bar, and the prompt shows a **Custom (temporary)** badge.
- **Keep the formats.** The app's clean-up depends on the prompt asking for `[[FIGURE: …]]` lines, `[[note: term | words]]` lines, and math in `$…$`. If an edit drops one, a warning explains what will stop working.
- **To keep a change for good**, click **Copy prompt**, paste it into `src/lib/prompts.ts`, and run `npm test`.

Ink2Web Lite is tuned for the default prompt; edited prompts are for experiments.

Your settings are remembered. Settings can't be changed while a page is converting.

---

## 3. Adding pages

- **Drag and drop** PDFs or images **anywhere in the window**, or click **+ Add pages** (or **Choose files** on the start screen).
- **Paste** a screenshot directly with ⌘V / Ctrl+V.
- Supported formats: **PDF, PNG, JPEG, WebP, GIF, BMP**. iPhone HEIC photos must be converted to JPEG first.
- Dropping a saved project file (`.ink2web.json`) on the window opens it.
- Each PDF page becomes its own page in the app, marked **Not converted**. Nothing is converted until you ask.
- Use **↑ / ↓** at the top of a page to move it earlier or later, and **Remove** to delete it (it asks first if the page is converted). **Clear all pages** starts over.

---

## 4. Converting

- **Convert this page** converts **only that page**.
- **Convert all** (in the page list) converts every page that isn't done yet.
- Pages convert **one at a time**, in page order. Other pages you convert meanwhile are marked **Waiting**; **Cancel waiting** takes them back out of the queue. You can keep reviewing other pages while this happens.
- **Stop** (in the page list, in place of Convert all) stops the current page and cancels all waiting pages.
- **Convert again** on a finished page asks first, because it **replaces your edits on that page**. If it fails or you stop it, the page keeps its previous version and your edits.
- The model does **one job at a time**: while a page converts, **Re-read** waits; while a re-read runs, **Convert** waits.

| Status | Meaning |
|---|---|
| **Not converted** | Added, not converted yet |
| **Waiting** | In the queue |
| **Transcribing… / Finding figures…** | Being converted now |
| **Done** | Converted; ready to review |
| **Error** | Conversion failed; the message explains why. Click **Convert** to try again. |
| **Stopped** | You stopped it; click **Convert** to try again |

---

## 5. Reviewing and editing a page

Each page shows the **original** on the left and the document on the right. The original stays in view as you scroll, with the page's figures (or, while re-reading, the re-read controls) just above it.

### Click to edit

In **Preview**, every paragraph, equation, and figure is a separate part you can click. Hovering shows which part you're on.

- **Click a paragraph or equation** to open it in place. You see its source, the toolbar, and a live preview of just that part underneath.
  - **Done** (or ⌘/Ctrl+Enter) saves the change.
  - **Cancel** (or Esc) discards it.
  - Deleting everything in the box and pressing **Done** removes that part.
  - Clicking another part saves the open one first.
- **An equation and its "where…" sentence** are one part: the note lines sit right under the equation.
- **Click a figure** to open its panel in place, with the alt text box ready to type. See [Working with figures](#7-working-with-figures).
- **With the keyboard:** Tab to a part and press Enter. When you finish, focus returns to that part.

Selecting text in the preview (to copy it) doesn't open the editor.

### Re-read from image

When a part came out badly (a garbled line, a misread equation), let the model look again at just that spot instead of fixing it by hand:

1. Click the paragraph or equation to open it, then click **Re-read from image…** under the editor.
2. On the original page (left; the re-read controls appear right above it), **drag a box** around the handwriting for that part. Figure boxes are inactive meanwhile, so you can't move a crop by accident. Drag again to adjust.
3. Click **Re-read this region**. The model reads only the boxed area, which is much faster than a whole page.
4. The **proposed replacement** appears under the editor and is scrolled into view. Review it (you can edit it), then choose **Use this** (it goes into the editor), **Try another box**, or **Keep mine**.
5. Press **Done** in the editor to keep the change. Nothing on the page changes before that; **Cancel** throws it all away.

Re-read uses the same model and the same **Boost contrast** setting as converting. It isn't available while a page is converting.

### Edit source

**Edit source** shows the whole page's transcription at once, for bigger changes such as moving paragraphs around. It has the same toolbar. Switching to **Edit source** saves any part you have open.

### The toolbar

Select some text (or put the cursor where you want it), then click:

| Button | What it does |
|---|---|
| **$x$** | Wraps the selection in `$…$` (math inside a sentence) |
| **$$** | Makes the line or selection an equation on its own line |
| **Note** | Adds an arrow/brace note after the equation. Select the term first (e.g. `\omega`); the cursor then waits where you type what the note says |
| **Box** | Boxes a formula or result (`\boxed{…}`); outside math it creates a boxed equation |
| **⋮** | Adds skipped-steps dots on the next line |
| **U** | Underline: `<u>…</u>` for words, `\underline{…}` inside math |
| **H** | Turns the line into a heading, or back |
| **Color…** | Colored ink: `[[red: …]]` for words, `\color{red}{…}` inside math |

⌘Z / Ctrl+Z undoes toolbar changes like any other typing.

### Markdown and LaTeX basics

| You type | You get |
|---|---|
| `## Heading` | A section heading |
| A line of text | A line of text (line breaks are kept) |
| A blank line | A new paragraph (and a new clickable part) |
| `- item` or `1. item` | Bulleted or numbered list |
| `**bold**`, `*italic*` | **bold**, *italic* |
| `$x^2$` | Math inside a sentence (no spaces just inside the `$`s) |
| `$$\int_0^1 x\,dx$$` | An equation on its own line |
| `$$\begin{aligned} a &= b \\ &= c \end{aligned}$$` | Several aligned equation lines |
| `[[FIGURE 2]]` | Where figure 2 appears |
| `\$` | A literal dollar sign |

Keep ordinary sentences **outside** of `$…$`. Screen readers read anything inside as math.

### Warnings

- **LaTeX warnings** (yellow box) flag common slips: unbalanced braces, unmatched `\begin`/`\end` or `\left`/`\right`, or a stray `$`.
- **Math shown in red** in the preview failed to render. Click it to fix the LaTeX.

### What to proofread

- misread words, and spelling the model changed
- similar-looking symbols and digits: 7 vs 9, ℓ vs 1, x vs ×, subscripts vs superscripts
- missing limits on integrals or sums
- notes: the right term, the right words, nothing invented
- figure alt text: only the drawing, not the writing next to it (see [Known issues](#11-known-issues))

---

## 6. Handwriting marks: arrows, braces, boxes, colors

### Arrow and brace notes

When you point an arrow at a term or put a brace under part of an equation with a note, Ink2Web Lite keeps the equation clean and adds a sentence after it:

> $$u(t) = A\cos(\omega t) + B\sin(\omega t) = R\cos(\omega t - \delta)$$
> *where ω is the frequency, a = ωt, and b = −δ.*

In the source, each note is one line right after its equation:

```
$$u(t) = R\cos(7t - \delta)$$
[[note: R | new amplitude]]
[[note: \delta | phase shift]]
```

The part before `|` is the **term** the arrow or brace points at, in LaTeX without `$`. The part after `|` is **what you wrote** there. The **Note** button writes this line for you. The app chooses the wording:

| Note | Reads as |
|---|---|
| `[[note: \omega \| frequency]]` | where ω is **the** frequency |
| `[[note: c \| the damping constant]]` | where c is the damping constant |
| `[[note: -0.3 \| upward]]` (a describing word) | where −0.3 is upward |
| `[[note: u_h \| oscillation with frequency \omega_n]]` (words and math) | where u_h **is** oscillation with frequency ωₙ |
| `[[note: \cos(-\delta) \| \cos(\delta)]]` (math only) | where cos(−δ) **=** cos(δ) |
| `[[note: \omega t \| a]]` (a single letter) | where a = ωt |
| `[[note red: -0.3 \| upward]]` | the same, in red |

A note with any words gets "is"; only a note that is purely math gets "=". A note with no `|` is shown as written, in italics.

**Want an arrow or brace drawn in the equation for a particular spot?** Type it yourself; it renders as drawn:

| In your notes | Type this inside math |
|---|---|
| A brace under part of an equation, with a note | `\underbrace{\cos(-\delta)}_{\cos(\delta)}` |
| A brace over part of an equation | `\overbrace{\omega t}^{a}` |
| An arrow pointing up at a term, with a note below | `\underset{\substack{\uparrow\\ \text{new amplitude}}}{R}` |

### Other marks

| In your notes | Toolbar | Source |
|---|---|---|
| A box around a formula or result | **Box** | `$$\boxed{R = \sqrt{A^2+B^2}}$$` |
| A column of dots for skipped steps | **⋮** | `$$\vdots$$` on its own line |
| Underlined words | **U** | `<u>critically damped</u>` |
| Underlined math | **U** (inside math) | `$\underline{x}$` |
| Words in a different ink color | **Color…** | `[[red: without crossing equilibrium]]` |
| Math in a different color | **Color…** (inside math) | `$\color{red}{u'(0) = -0.3}$` |

**Colors:** `red`, `green`, `blue`, `orange`, and `purple` are shown in darker shades that meet WCAG contrast on white, and colored words are also italic, so the difference never depends on color alone.

A circle, box, or bracket you draw around **words** just to highlight them is ignored; the words are transcribed normally.

---

## 7. Working with figures

Every figure opens in a **figure panel** that takes its place in the document, just as a paragraph opens in the editor. Open it by clicking the figure in the document, its box on the original, or its number in the **Figures** row above the original. A number marked **!** needs checking. **Done** (or Esc) closes the panel.

While a figure's panel is open, its box on the original is selected (blue) so you can adjust the crop. The panel ends with a preview of the figure as it will appear in the document.

### Badges

| Badge | Meaning |
|---|---|
| **Found by detector** | The app found this drawing in the ink; the model didn't mention it. |
| **Check crop** | The crop or position is a guess and may need attention. Adjusting the box clears it. |
| **Check alt text** | The alt text looks like it includes writing from next to the drawing. See [Moving writing out of the alt text](#moving-writing-out-of-the-alt-text). |
| **Not placed in text** | The figure has no marker in the transcription, so it won't appear in the export. Click **Insert in text**. |

### Alt text

Every figure needs alt text, the description a screen reader reads aloud. The app writes a first draft, but **you know what the drawing is meant to show**, so please review it. Good alt text says what kind of drawing it is, what matters for the lesson, and the labels a student needs, in plain words. It describes **the drawing only**; sentences and formulas written next to it belong in the notes.

The **Caption** is optional, visible text shown under the figure.

### Moving writing out of the alt text

Small models sometimes copy the sentence written next to a drawing into the drawing's alt text, for example:

> graph with x-axis labeled a to b, shaded region under the curve, with text "∫ₐᵇ f(x) dx is area of the shaded region." written beside it

When the alt text looks like this, the figure is marked **Check alt text** with a short hint. To fix it:

1. In the alt text box, **select the sentence** that belongs in the notes (here, the quoted part).
2. Click **Move to notes**.

The sentence is removed from the alt text (along with leftovers like "with text … written beside it") and added as a line right after the figure, so it appears next to the drawing as in your notes. If the figure has **Put text beside the figure** on, the moved line is counted as one of the lines beside it. With nothing selected, **Move to notes** moves the whole alt text; type a new description afterwards.

You can always do the same by hand: cut the sentence from the alt text and paste it after the figure in **Edit source**.

### Adjusting the crop

Open the figure (its box on the original turns blue). Then drag inside the box to move it, drag a corner to resize it, or drag on empty space to draw a new box. With the keyboard: Tab to the selected box, then **arrow keys** move it and **Shift + arrow keys** resize it. **Snap crop to ink** tightens the box around the drawing.

### Layout in the document

| Control | What it does |
|---|---|
| **Position ↑ Up / ↓ Down** | Moves the figure one line (or one whole equation) earlier or later in the text |
| **Align** | Left, Center, or Right |
| **Width** | 20–100% of the text column |
| **Put text beside the figure** | For Left/Right figures, the following text sits next to the drawing |
| **Lines beside it** | How many lines sit beside the figure; text after that starts below it |

### Adding or removing figures

- **+ Add** (in the Figures row above the original) looks for a drawing that isn't a figure yet and adds it in the right place; otherwise it adds a box at the end for you to draw.
- **Delete figure** (in its panel) removes the figure and its marker.

---

## 8. Saving your work

### Autosave

Everything you do is saved in the browser a moment after each change: page images, transcriptions, notes, figures, crops, alt text, and the title. The top bar shows when it was last saved. An edit still open in the in-place editor is kept when you press **Done** or go to another page.

When you open the app again, it asks **Continue where you left off?**: **Restore** brings everything back; **Start fresh** deletes the saved work. Until you choose, autosave is paused.

**Clear all pages** removes all pages and the saved copy. It asks first if you have converted pages.

### Project files

**Save** (top bar) downloads one project file (for example `lesson21.ink2web.json`) with everything, including the page images. **Open** (or dropping the file on the window) loads it back, on this computer or another one.

### Good to know

- **Autosave lives in this browser, on this computer.** Safari and Chrome keep separate copies, and so do `npm run dev` (port 5173) and `npm run preview` (port 4173). Use project files to move work between them.
- **Clearing the browser's site data deletes autosaved work.** Keep a project file for anything you'd hate to lose.
- **If saving ever fails**, a warning appears; save a project file right away.

---

## 9. Exporting

The **title** in the top bar becomes the exported page's title and main heading. While the title is still the file name, the **first heading in your notes** is used instead.

Click **Export** (top bar):

- **Before you export** lists what is still flagged on converted pages: figures with no alt text or alt text to check, figures whose crop needs checking, LaTeX warnings, and failed re-conversions. Click **Page n** to go straight there (a figure opens in its panel).
- **Mark page boundaries** adds small "Page 2", "Page 3" dividers between pages.
- **Only converted pages are exported**; the dialog says how many are left out.

**Download HTML** saves one `.html` file with all figures embedded. Viewers need an internet connection the first time they open it, because MathJax loads from a CDN.

The exported HTML is the finished document; the **project file** is what you need to keep editing later.

---

## 10. Accessibility checklist

- [ ] Every figure has meaningful alt text (not just "diagram").
- [ ] No figure is marked **Check alt text**, and alt text describes only the drawing.
- [ ] The title is a real title, not a file name.
- [ ] Headings follow the structure of your notes.
- [ ] No red math in the preview, and no LaTeX warnings left.
- [ ] Sentences are plain text, not inside `$…$`.
- [ ] Each "where…" note names the right term.
- [ ] Colored notes still make sense if read aloud without the color.
- [ ] Figures appear next to the text that refers to them.
- [ ] You've proofread the transcription and notes against the original.

---

## 11. Known issues

These come from what small vision models can and can't do reliably. Each has a quick fix in the app.

| Issue | What to do |
|---|---|
| **Writing next to a figure can end up in its alt text.** Small models sometimes include a sentence written beside a drawing in the drawing's description instead of the notes. The app catches the common forms automatically, but not all. | Look for **Check alt text**. Select the sentence in the alt text and click **Move to notes** (see [Moving writing out of the alt text](#moving-writing-out-of-the-alt-text)). |
| **Words and symbols can be misread** (a handwritten 7 read as 9, for example). | Proofread; **High detail** helps. Click the part to fix it. |
| **Spelling gets "corrected."** Small models tend to fix the author's spelling despite instructions to copy exactly. | Fix it back if it matters. |
| **A "where…" note can name the wrong term.** | Click the equation and fix the `[[note: term \| words]]` line. |
| **Very flat drawings** (a lone number line, a single long arrow) may not be detected as figures. | Click **+ Add** in the Figures row above the original. |

---

## 12. Troubleshooting

| Problem | Fix |
|---|---|
| **"Cannot reach Ollama"** | Open the Ollama app (or run `ollama serve`), then click **Refresh**. |
| **No models in the list** | Install one: `ollama pull qwen3-vl:4b-instruct`, then **Refresh**. |
| **A model is very slow, or returns empty or cut-off text** | It's probably a thinking build. Use `qwen3-vl:4b-instruct`. |
| **Results suddenly look different** | Check for the **Custom prompt in use** banner above **Convert all**. Click **Use the default prompt**, then **Convert again**. |
| **The app seems to behave like an older version** | Check `grep version package.json`, restart `npm run dev`, and hard-refresh the browser tab (⌘⇧R). |
| **A sentence from the notes is missing, and it's in a figure's alt text** | Select it in the alt text and click **Move to notes**. |
| **A sentence from the notes is missing everywhere** | The model skipped it. Click the part before it and type it in, or try **Convert again** (with **High detail**). |
| **Clicking the preview doesn't open the editor** | Make sure you're on **Preview**, not **Edit source**. If you were selecting text, click once without dragging. |
| **A toolbar button did something odd** | Press ⌘Z / Ctrl+Z to undo it. Box, Underline, and Color act differently inside and outside math, so check where the cursor is. |
| **My work didn't come back after reopening** | Use the same browser and the same address (5173 or 4173). Otherwise open a project file. |
| **"Couldn't save in this browser"** | Click **Save** (top bar) now; then free space or leave a private window. |
| **"This file is not an Ink2Web Lite project"** | Open the `.ink2web.json` file from **Save**, not the exported `.html`. |
| **Equations come out as plain text** | Click the line and use **$$** (whole line) or **$x$** (part of a sentence). |
| **A "where…" sentence names the wrong term** | Click the equation and fix the term in its `[[note: term \| words]]` line. |
| **A box or note appears that isn't in my notes** | Click it and delete it. |
| **Lots of misread words** | Try **High detail**, keep **Boost contrast** on, then **Convert again**. |
| **A figure is missing** | Click **+ Add** in the Figures row above the original. |
| **Something that isn't a drawing became a figure** | **Delete** it in its figure card. |
| **Conversion is very slow** | Use an instruct build; try **Fast** detail or a context window of 4096. |
| **Math shows as raw `\(…\)` in the exported file** | The viewer is offline; MathJax needs the internet to load. |

---

## 13. FAQ

**Does anything leave my computer?**
No. Your notes go only to Ollama on your own machine, and saved work stays in this browser or in project files you download.

**Can I close the app and continue later?**
Yes. Reopen it and choose **Restore**, or open a project file.

**Why does writing next to a figure sometimes end up in its alt text?**
The model is asked to describe each drawing and to keep the writing beside it in the notes, but small models sometimes include that writing in the description anyway. The app fixes the most common forms automatically and flags the rest with **Check alt text**; **Move to notes** fixes them in one click.

**Can I change what the model is asked to do?**
Yes, for experiments: **model button › Advanced › Transcription prompt** shows the prompt and lets you try an edited version until you reload the app. See [Inspecting or changing the prompt](#inspecting-or-changing-the-prompt).

**Can I edit the rendered math directly, like in a word processor?**
Not quite: clicking opens that part's source, with a live preview right underneath and a toolbar for the common marks. This keeps the export exact and predictable.

**Which models does it support?**
It's tuned for qwen3-vl:4b-instruct (recommended) and qwen2.5vl:3b. Others may work but aren't tested.

**Will it fix mistakes in my notes?**
It's told not to. Small models sometimes fix spelling anyway, so proofread.

**Why does my arrow note become a "where" sentence?**
Placing an arrow inside an equation is the hardest thing for a small model to get right, and a note inside the math interrupts a screen reader. A sentence after the equation is reliable and reads naturally.

**Why are my red comments a darker red in the export?**
Bright colors are hard to read on white; the export uses darker shades that meet WCAG contrast.

**Which browser should I use?**
Any current Chrome, Edge, Firefox, or Safari. Autosave doesn't work in private windows that block storage.
