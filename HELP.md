# Ink2Web Lite: User Guide

This guide covers everyday use of Ink2Web Lite 1.8. For installation, see [README.md](README.md).

> **Your work is saved as you go**, in this browser on this computer. To keep a copy you can move or back up, use **Save project**. See [Saving your work](#8-saving-your-work).

---

## Contents

1. [The basic workflow](#1-the-basic-workflow)
2. [Choosing a model and settings](#2-choosing-a-model-and-settings)
3. [Adding pages](#3-adding-pages)
4. [Converting](#4-converting)
5. [Reviewing a page](#5-reviewing-a-page)
6. [Handwriting marks: arrows, braces, boxes, colors](#6-handwriting-marks-arrows-braces-boxes-colors)
7. [Working with figures](#7-working-with-figures)
8. [Saving your work](#8-saving-your-work)
9. [Exporting](#9-exporting)
10. [Accessibility checklist](#10-accessibility-checklist)
11. [Troubleshooting](#11-troubleshooting)
12. [FAQ](#12-faq)

---

## 1. The basic workflow

1. Make sure **Ollama is running** (the llama icon is in your menu bar or system tray).
2. Start the app with `npm run dev` and open **http://localhost:5173**.
3. **Choose a model**, then **add your notes** (PDF or photos), or choose **Restore** / **Open project** to continue earlier work.
4. Click **Convert** on the pages you want, or **Convert all**.
5. **Review each converted page**: check the text, math, notes, and figures against the original. Expect some light editing; the app is an assistant, not a one-click converter.
6. Click **Download HTML**. Only converted pages are included.

A typical page takes from a few seconds to a minute, depending on your model and computer.

---

## 2. Choosing a model and settings

### Ollama vision model

The dropdown lists every model installed in Ollama, with vision-capable models first. Models marked **no vision** can't read images, so don't use them. If you've just installed a model, click **Refresh**.

**Ink2Web Lite is tuned for two Qwen models:**

| Model | Install |
|---|---|
| Qwen3-VL 4B, instruct build (recommended) | `ollama pull qwen3-vl:4b-instruct` |
| Qwen2.5-VL 3B (smaller fallback) | `ollama pull qwen2.5vl:3b` |

Both run on an 8 GB Apple Silicon Mac. Other vision models may work, but the prompt and clean-up are tested only with these two, so results can vary. If you want to adapt the app to another model, see "Tuned for Qwen" in the README.

**Tip for comparing:** convert one page with one model, switch models, then click **Convert again** on the same page. Only that page is converted, so you can compare quickly.

### Use "instruct" models, not "thinking" ones

Some model families come in two builds with the same size but different training:

- **Thinking (reasoning) builds** write out hidden step-by-step "thinking" before they answer. For a page transcription, that thinking can be several times longer than the transcription itself, and the model has to generate every word of it. This makes conversion much slower. On a long page, the model can also use up its allowed output on thinking and return an empty or cut-off transcription.
- **Instruct builds** are trained to answer directly. They write only the transcription, so they're much faster and more reliable for this job.

**For Qwen3-VL**, the default tags (like `qwen3-vl:4b`) are thinking builds. Use `qwen3-vl:4b-instruct` instead.

The app tries to switch thinking off automatically, but only when Ollama reports that the model supports thinking, and that doesn't work for every model. Picking the instruct tag is the dependable fix. To check an installed model, run `ollama show <model>` and look for `thinking` under **Capabilities**.

### Image detail

This controls how large an image of the page the model sees.

| Setting | When to use it |
|---|---|
| **Fast (1024 px)** | Large, clear handwriting; quick drafts |
| **Balanced (1344 px)** | The default; good for most notes |
| **High detail (1792 px)** | Small or dense writing, subscripts, notes under braces and arrows |

### Boost contrast before reading

This darkens the ink and whitens the paper before the model sees it. It helps with pencil, faint pens, and phone photos. **Ink colors are kept**, so the model can still notice comments written in a different color. It doesn't change the figure crops in your export.

### Ask the model where figures are…

When the model and the app's drawing detector disagree on how many figures a page has, this asks the model for their positions so they can be matched correctly. It costs one short extra model call. Leave it on.

### Advanced

- **Ollama URL:** leave this as `/ollama` unless Ollama runs somewhere unusual.
- **Context window (num_ctx):** leave it at 8192. On an 8 GB machine, lowering it to 4096 saves memory and is enough for most single pages. Raise it only if long pages come back cut off.

Your settings are remembered the next time you open the app. Settings can't be changed while a page is converting.

---

## 3. Adding pages

- **Drag and drop** PDFs or images onto the **Notes** area, or click **Choose files**.
- **Paste** a screenshot directly with ⌘V / Ctrl+V.
- Supported formats: **PDF, PNG, JPEG, WebP, GIF, BMP**. iPhone HEIC photos must be converted to JPEG first.
- Dropping a saved project file (`.ink2web.json`) on the Notes area opens it.
- Each PDF page becomes its own page in the app, marked **Not converted**. Nothing is converted until you ask.
- Use **↑ / ↓** on a page to reorder it, and **Remove** to delete it. **Clear all** starts over.

**Check the page image on the left.** If it looks wrong (missing ink, sideways, very faint), the model will struggle too. Fix the scan first.

---

## 4. Converting

### One page or all of them

- **Convert** on a page converts **only that page**. This is the quickest way to handle a long PDF when you need just a few pages.
- **Convert all** (at the top) converts every page that isn't done yet: pages not yet converted, and pages that failed or were stopped. Its label shows how many.

Pages convert **one at a time**, in page order. This keeps memory use low on small machines.

### While a page is converting

- You see the model's output as it's written, then **Finding figures…** while the app locates and describes drawings.
- You can click **Convert** on other pages. They're marked **Waiting** and start in turn.
- **Cancel** on a waiting page takes it back out of the queue.
- **Stop** (at the top) stops the current page and cancels all waiting pages. The stopped page is marked **Stopped**; convert it again whenever you like.
- Settings are locked until conversion finishes.

### Converting a page again

When a page already has a transcription, its button reads **Convert again**. Use it after switching models or changing settings. The app asks before converting, because it **replaces your edits on that page**, including alt text and figure layout.

### Page status

| Status | Meaning |
|---|---|
| **Not converted** | Added, not converted yet |
| **Waiting** | In the queue; starts after the page being converted |
| **Transcribing… / Finding figures…** | Being converted now |
| **Done** | Converted; ready to review |
| **Error** | Conversion failed; the message explains why. Click **Convert** to try again. |
| **Stopped** | You stopped it; click **Convert** to try again |

---

## 5. Reviewing a page

Each page shows the **original** on the left and the result on the right.

### Preview and Edit source

- **Preview** shows the page exactly as it will look in the exported HTML, including figure layout, notes, and colors.
- **Edit source** shows the transcription as Markdown with LaTeX. Edits update the preview within a moment, and are saved automatically.

### Markdown and LaTeX basics

| You type | You get |
|---|---|
| `## Heading` | A section heading (`#` is the largest; the document title sits above it) |
| A line of text | A line of text (line breaks are kept) |
| A blank line | A new paragraph |
| `- item` or `1. item` | Bulleted or numbered list |
| `**bold**`, `*italic*` | **bold**, *italic* |
| `$x^2$` | Math inside a sentence (no spaces just inside the `$`s) |
| `$$\int_0^1 x\,dx$$` | An equation on its own line |
| `$$\begin{aligned} a &= b \\ &= c \end{aligned}$$` | Several aligned equation lines |
| `[[FIGURE 2]]` | Where figure 2 appears |
| `\$` | A literal dollar sign |

Keep ordinary sentences **outside** of `$…$`. Screen readers read anything inside as math.

Inline math must not start or end with a space: write `$x^2$`, not `$ x^2 $`. This rule is what lets "$5 and $10" stay as text.

### Warnings

- **LaTeX warnings** (yellow box) flag common slips: unbalanced braces, unmatched `\begin`/`\end` or `\left`/`\right`, or a stray `$`.
- **Math shown in red** in the preview failed to render. A count above the preview tells you how many. Fix them in **Edit source**.

### What to proofread

The model copies what it sees, mistakes included, though small models sometimes "correct" spelling anyway. Common things to check:

- misread words, and spelling the model changed
- similar-looking symbols and digits: 7 vs 9, ℓ vs 1, x vs ×, subscripts vs superscripts
- missing limits on integrals or sums
- notes: the right term, the right words, nothing invented

---

## 6. Handwriting marks: arrows, braces, boxes, colors

### Arrow and brace notes

When you point an arrow at a term or put a brace under part of an equation with a note, Ink2Web Lite keeps the equation clean and adds a sentence after it:

> $$u(t) = A\cos(\omega t) + B\sin(\omega t) = R\cos(\omega t - \delta)$$
> *where ω is the frequency, a = ωt, and b = −δ.*

This is more reliable with small models than drawing the arrow into the equation, and a screen reader hears the equation, then the explanation, without interruptions.

In **Edit source**, each note is one line right after its equation:

```
$$u(t) = R\cos(7t - \delta)$$
[[note: R | new amplitude]]
[[note: \delta | phase shift]]
```

The part before `|` is the **term** the arrow or brace points at, in LaTeX without `$`. The part after `|` is **what you wrote** there. Consecutive note lines become one sentence. The app chooses the wording:

| Note | Reads as |
|---|---|
| `[[note: \omega \| frequency]]` | where ω is **the** frequency |
| `[[note: c \| the damping constant]]` | where c is the damping constant |
| `[[note: -0.3 \| upward]]` (a describing word) | where −0.3 is upward |
| `[[note: u_h \| oscillation with frequency \omega_n]]` (words and math) | where u_h **is** oscillation with frequency ωₙ |
| `[[note: \cos(-\delta) \| \cos(\delta)]]` (math only) | where cos(−δ) **=** cos(δ) |
| `[[note: \omega t \| a]]` (a single letter) | where a = ωt |
| `[[note red: -0.3 \| upward]]` | the same, in red |

A note with any words gets "is"; only a note that is purely math gets "=". To fix a note, edit its line. To remove one, delete the line. A note with no `|`, like `[[note: compare to the natural frequency]]`, is shown as written, in italics.

**Want an arrow or brace drawn in the equation for a particular spot?** Type it yourself in **Edit source**; it renders as drawn:

| In your notes | Type this inside math |
|---|---|
| A brace under part of an equation, with a note | `\underbrace{\cos(-\delta)}_{\cos(\delta)}` |
| A brace over part of an equation | `\overbrace{\omega t}^{a}` |
| An arrow pointing up at a term, with a note below | `\underset{\substack{\uparrow\\ \text{new amplitude}}}{R}` |

Note that **Convert again** replaces hand edits, and new conversions always produce notes.

### Other marks

| In your notes | Type this in Edit source |
|---|---|
| A box around a formula or result | `$$\boxed{R = \sqrt{A^2+B^2}}$$` |
| A column of dots for skipped steps | `$$\vdots$$` on its own line |
| Underlined words | `<u>critically damped</u>` |
| Underlined math | `$\underline{x}$` |
| Words in a different ink color | `[[red: without crossing equilibrium]]` |
| Math in a different color | `$\color{red}{u'(0) = -0.3}$` |

**Colors:** `red`, `green`, `orange`, `purple`, and `blue` are supported. They're shown in darker shades that meet WCAG contrast on white, and colored words are also italic, so the difference never depends on color alone.

A circle, box, or bracket you draw around **words** just to highlight them is ignored; the words are transcribed normally.

---

## 7. Working with figures

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

**Snap to ink** tightens the box around the drawing. If a line of handwriting touches the box, it may get included. If that happens, drag the edge back.

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

## 8. Saving your work

### Autosave

Everything you do is saved in the browser a moment after each change: the page images, transcriptions, notes, figures, crops, alt text, and the document title. A line under the toolbar shows when it was last saved ("Saved in this browser at 10:42").

When you open the app again (after closing the tab, a refresh, or a crash), it asks **Continue where you left off?**:

- **Restore** brings back all your pages exactly as they were.
- **Start fresh** deletes the saved work and starts empty.

Until you choose, autosave is paused, so the saved work can't be overwritten by accident.

A page that was converting when the app closed comes back as **Done** if it already had a transcription, or **Not converted** otherwise. Convert it again if needed.

**Clear all** removes all pages and the saved copy. It asks first if you have converted pages.

### Project files

**Save project** downloads one file, named after the document title (for example `lesson21.ink2web.json`), that contains everything, including the page images. Use it to:

- keep a copy of a lecture alongside the PDF,
- back up finished work before clearing the browser,
- move work to another computer or another browser.

**Open project** (or dropping the file on the Notes area) loads it back. If pages are already open, the app asks before replacing them.

### Good to know

- **Autosave lives in this browser, on this computer.** Safari and Chrome keep separate copies, and so do `npm run dev` (port 5173) and `npm run preview` (port 4173). Use project files to move work between them.
- **Clearing the browser's site data deletes autosaved work.** Keep a project file for anything you'd hate to lose.
- **Space:** each page image takes about 1–3 MB. Browsers allow far more than a few lectures' worth, but if saving ever fails, a warning appears; save a project file, then **Clear all** pages you've finished.

---

## 9. Exporting

In the **Export** section at the bottom:

- **Document title** becomes the page title and its main heading. While the title is still the file name (for example "Lesson21"), the **first heading in your notes** is used instead. Type your own title to override this.
- **Mark page boundaries** adds small "Page 2", "Page 3" dividers between pages, which screen readers can use to navigate. Turn it off for one continuous document.
- A warning shows how many figures are **missing alt text**.
- **Only converted pages are exported.** The Export section tells you how many pages will be included and how many are left out.

**Download HTML** saves one self-contained `.html` file with all figures embedded. You can:

- open it in any browser,
- upload it to Brightspace or a course website,
- print it, or save it as PDF from the browser (colored notes keep their colors).

Viewers need an internet connection the first time they open the file, because MathJax loads from a CDN to draw the math.

The exported HTML is the finished document; the **project file** is what you need to keep editing later.

---

## 10. Accessibility checklist

Before you publish, check:

- [ ] Every figure has meaningful alt text (not just "diagram").
- [ ] The title is a real title, not a file name.
- [ ] Headings follow the structure of your notes.
- [ ] No red math in the preview, and no LaTeX warnings left.
- [ ] Sentences are plain text, not inside `$…$`.
- [ ] Each "where…" note names the right term.
- [ ] Colored notes still make sense if read aloud without the color.
- [ ] Figures appear next to the text that refers to them.
- [ ] You've proofread the transcription and notes against the original.

The export already handles the rest: language, skip link, landmarks, heading order, math for screen readers, color contrast, keyboard focus, and reflow on small screens.

---

## 11. Troubleshooting

| Problem | Fix |
|---|---|
| **"Cannot reach Ollama"** | Open the Ollama app (or run `ollama serve`), then click **Refresh**. |
| **No models in the list** | Install one: `ollama pull qwen3-vl:4b-instruct`, then **Refresh**. |
| **Convert buttons are greyed out** | Choose a model first. |
| **"This model can't read images"** | Choose a vision model from the list. |
| **A model is very slow, or returns empty or cut-off text** | It's probably a thinking build. Use `qwen3-vl:4b-instruct`. |
| **Results with another model are poor** | The app is tuned for qwen3-vl:4b-instruct and qwen2.5vl:3b. Try one of those. |
| **The app seems to behave like an older version** | Check `grep version package.json`, restart `npm run dev`, and hard-refresh the browser tab (⌘⇧R). |
| **My work didn't come back after reopening** | Make sure it's the same browser and the same address (5173 for `npm run dev`, 4173 for `npm run preview`). If you chose **Start fresh** or cleared site data, the saved copy is gone; open a project file if you have one. |
| **"Couldn't save in this browser"** | The browser may be out of storage or blocking it (for example in a private window). Click **Save project** now, then free space or use a normal window. |
| **"This file is not an Ink2Web Lite project"** | Open the `.ink2web.json` file made by **Save project**, not the exported `.html`. |
| **Equations come out as plain text** | Standalone equations are converted to math automatically. Equations inside a sentence aren't; wrap them in `$…$` in **Edit source**, or try **Convert again**. |
| **A "where…" sentence names the wrong term** | Fix the term in its `[[note: term \| words]]` line in **Edit source**. |
| **A note shows as a separate italic line ("↑ new amplitude")** | The model copied the arrow but not its target. Replace it with `[[note: R \| new amplitude]]`. |
| **A box or note appears that isn't in my notes** | The model invented it. Delete it in **Edit source**. |
| **Colored comments come out in the normal color** | Keep **Boost contrast** on (it keeps colors), or add `[[red: …]]` in **Edit source**. |
| **"A '$' delimiter is unmatched" but the math looks fine** | Look for spaces just inside `$…$`, like `$ x $`, and remove them. |
| **Lots of misread words** | Try **High detail**, keep **Boost contrast** on, then **Convert again**. |
| **The output repeats itself or stops early** | The app trims repetition automatically. **Convert again**. Raise the context window if long pages are cut off. |
| **A figure is missing** | Click **+ Add figure**. |
| **Something that isn't a drawing became a figure** | **Delete** it in its figure card. |
| **A figure's crop cuts off a label** | **Adjust crop** and drag the edge out, or try **Snap to ink**. |
| **Conversion is very slow** | Make sure you're using an instruct build. Then try **Fast** detail or a context window of 4096. Close other memory-heavy apps. |
| **A page is missing from the export** | Only converted pages are exported. Click **Convert** on it. |
| **Math shows as raw `\(…\)` in the exported file** | The viewer is offline; MathJax needs the internet to load. |

---

## 12. FAQ

**Does anything leave my computer?**
No. Your notes go only to Ollama on your own machine, and saved work stays in this browser or in project files you download. The only outside connection is MathJax loading when someone opens the exported file.

**Can I close the app and continue later?**
Yes. Your work is saved automatically; reopen the app and choose **Restore**. For a copy you can move or back up, use **Save project**.

**Which models does it support?**
It's tuned for qwen3-vl:4b-instruct (recommended) and qwen2.5vl:3b. Any Ollama vision model can be selected, but others aren't tested. The project is on GitHub, so you can adapt the prompt and clean-up to another model; see "Tuned for Qwen" in the README.

**Will it fix mistakes in my notes?**
It's told not to: it should transcribe exactly what's written, so you control every change. Small models sometimes fix spelling anyway, so proofread.

**Why does my arrow note become a "where" sentence?**
Placing an arrow inside an equation is the hardest thing for a small model to get right, and a note inside the math interrupts a screen reader. A sentence after the equation is reliable and reads naturally. If you want a particular arrow or brace drawn in the equation, type it in **Edit source**.

**Why are my red comments a darker red in the export?**
Bright red, green, and orange text is hard to read on white. The export uses darker shades of the same colors that meet the WCAG contrast requirement.

**Can I convert just a few pages of a long PDF?**
Yes. Click **Convert** on each page you want. Only converted pages go into the export.

**Why does it use both a model and a "detector" for figures?**
Small vision models often forget to mention a drawing or misjudge where it is. The detector finds drawings directly from the ink in a fraction of a second, and the model describes them. Each covers the other's weak spot.

**Which browser should I use?**
Any current Chrome, Edge, Firefox, or Safari. Autosave works in all of them, but not in private/incognito windows that block storage.
