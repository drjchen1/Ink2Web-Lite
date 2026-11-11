# Redraw: figures recreated from their mathematics (developer preview)

**Status:** in the app since 2.2.0. Three figure kinds: *graph of a stated function*, *region between curves*, and *phase plane*. In the figure panel, the model (or the user) writes a spec, and the user chooses Image / Redrawn / Both, with Image the default. The figure lab remains as a developer tool.

## The idea

A hand-drawn figure whose details carry meaning is redrawn from the math it shows, not traced from the ink. The work is split the same way as for text:

- **The model (later) or you (now)** writes a small JSON *spec*: the equation on the page, the window, which curves and points were drawn, and the labels.
- **The code** computes everything else (curves, jumps, asymptotes, intersections, areas), draws the SVG, and writes the alt text from computed facts.

The result is **idealized**. The redraw follows the equation, not the sketch, while the teaching choices (window, which points are marked, where a slice sits) come from the sketch. If there is no equation on the page, there is no redraw: `from` is required.

## Try it

```
npm run dev
```

Open <http://localhost:5173/figure-lab.html>. Pick one of the sixteen examples or write your own spec. The figure, its alt text, and the computed facts update as you type, and your own spec is remembered in the browser. The lab is a development page only and is not part of `npm run build`.

## Shared fields

| Field | Meaning |
|---|---|
| `kind` | `"graph"`, `"region"`, or `"phase"` |
| `from` | The equation as transcribed on the page (required). |
| `window` | `{ "x": [a, b], "y": [c, d] }`. Graphs need `x`; anything left out is automatic. |
| `axes` | Axis labels. A one-letter label on the independent axis is also the variable; otherwise set `var`. |
| `points` | `{ at: [x, y] }`, or `{ on: { curve, at } }` to have the other coordinate computed. Optional `label`, `fill` (`closed`/`open`), `pos` (`above`/`below`/`left`/`right`); without `pos`, the clearest spot is chosen. |
| `labels`, `ticks` | Free text at a point; custom ticks such as `{ "at": 3.14159265, "label": "π" }`. |

**Expressions** use calculator syntax:

- Operators and implicit multiplication: `exp(-t)*cos(3t)`, `2t^2`, `(t+1)(t-1)`, `u(t-2)`, `sqrt(1-x^2)`, `pi`, `min(a, b)`. `^` binds tighter than unary minus, so `-t^2` means −(t²).
- Functions need parentheses, and `log` is the natural log. `u` and `H` are the unit step, equal to 1 at 0.
- Scientific notation is rejected so that `2e-3` can't be misread as 2e − 3.
- **Number fields** (`window`, `between`, `at`, `start`, `on`, `size`, `width`, `A`, `ticks`) also accept constants as strings: `"pi/2"`, `"-2pi"`, `"e"`, `"sqrt(2)"` (2.2.2). They are converted before the checks, so π is recognized exactly. Each run of letters must be one name, so `"pie"` is an error rather than π·e. The words `"auto"` and `"intersections"` stay words. Ticks given without a label are labeled exactly (π/2, 2π, e).
- Expressions are parsed into a tree and evaluated with closures. `eval` is never used.

## Kind "graph"

```json
{
  "kind": "graph",
  "from": "u(t) = e^{-t/2}\\cos(3t)",
  "window": { "x": [0, 8], "y": [-1.1, 1.1] },
  "axes": { "x": "t", "y": "u" },
  "curves": [
    { "expr": "exp(-t/2)*cos(3t)", "label": "u(t)" },
    { "expr": "exp(-t/2)", "style": "dashed" }
  ],
  "points": [{ "on": { "curve": 1, "at": 0 }, "label": "u(0) = 1", "pos": "right" }]
}
```

- `curves`: `{ expr, label?, style? }` (`solid`, `dashed`, or `dotted`), or `{ pieces: [{ expr, on: [a, b], ends: [closed/open, closed/open] }] }`.
- `impulses`: `{ at, size?, label? }`, drawn as arrows.
- `points` with `on: { curve: 1, at: x }`: at a jump, `fill` chooses the side.

**Computed:**
- jumps, located to machine precision
- vertical asymptotes, including poles that land on a sample point (1/x) and slowly diverging ones (ln|x|)
- where the function is undefined
- zeros and turning points, by bisection on *f* and *f′*
- constant stretches ("stays at 0 for t from 0 to 2")
- decaying or growing oscillation

## Kind "region"

```json
{
  "kind": "region",
  "from": "A = \\int_0^1 (\\sqrt{x} - x^2)\\,dx",
  "top": { "expr": "sqrt(x)", "label": "y = √x" },
  "bottom": "x^2",
  "between": "intersections",
  "slice": { "at": 0.55, "label": "Δx" },
  "markIntersections": true
}
```

| Field | Meaning |
|---|---|
| `top`, `bottom` | Vertical slices (`dir: "dx"`, the default): expressions in x. `bottom` defaults to `0`, the axis. |
| `right`, `left` | Horizontal slices (`dir: "dy"`): x = g(y). `left` defaults to `0`. Using only these implies `"dy"`. |
| `between` | `[a, b]`, or `"intersections"` (the default): the first and last places the boundaries meet, searched over the window, or −10 to 10. |
| `slice` | `{ at, label?, width? }`: the representative strip. |
| `markIntersections` | Dots with exact coordinates at every meeting point. |
| `area` | `true` puts the computed area in the alt text. Off by default, so a worksheet figure doesn't give the answer away. The lab always shows it. |
| `points` | `on: { curve: "top", at: x }` (or `bottom`, `left`, `right`). |

**Computed:**
- **Meeting points**, including touching ones such as $(x-1)^2 = 0$. Poles such as tan's are not counted as meeting points.
- **Crossings inside the region.** The region stays between the curves, and the alt text says which curve is on top on each side of the crossing.
- **Area** by adaptive Simpson, one integral per part, accurate to about 1e-10, so 1/3, 14/3 and π/2 are recognized.
- **Straight sides** where numeric bounds close the region.
- **Orientation check:** boundaries written the wrong way round are swapped, with a warning.
- **Rejected specs:** a boundary that is undefined, or has an asymptote, inside the region is an error.

Example alt text: *"The shaded region lies between y = x and y = x^3, for x from −1 to 1. The curves cross at x = 0, so the upper curve changes: y = x^3 is on top for −1 < x < 0 and y = x for 0 < x < 1. The curves meet at (−1, −1), (0, 0), and (1, 1)."*

Numbers in the alt text are written exactly when they are almost certainly exact (2, 0.5, π/6, 1/3) and as "≈0.368" otherwise.

## Kind "phase"

```json
{
  "kind": "phase",
  "from": "x' = y, \\; y' = -2x - 3y",
  "A": [[0, 1], [-2, -3]],
  "window": { "x": [-3, 3], "y": [-3, 3] },
  "show": ["field", "equilibria", "eigenvectors"],
  "trajectories": [{ "start": [2.5, 0] }, { "start": [-2.5, 0.5] }]
}
```

| Field | Meaning |
|---|---|
| `system` | `{ "x": "y", "y": "-2x - 3y" }`, keyed by the axis variables. The system must be autonomous (no `t`). |
| `A` | A 2×2 matrix instead of `system`, for x′ = A**x**. |
| `vars` | The state variables when the axis labels aren't single letters. One-character labels such as θ and ω are used in the alt text. |
| `show` | Any of `field`, `equilibria` (default: these two), `nullclines`, `eigenvectors`. |
| `trajectories` | `{ start: [x, y], direction?, label? }`, where `direction` is `both` (default), `forward`, or `backward`. |
| `labelEquilibria` | `true` writes the coordinates beside each equilibrium. |
| `window` | Optional: by default, centred on the equilibria with nearly equal scales, so circles look round. |

**Computed:**
- **Equilibria:** found by Newton's method from a grid of seeds, and written exactly where possible, such as (π, 0).
- **Types:** from the Jacobian's eigenvalues: node, saddle, spiral, center, star, degenerate node, each stable or unstable. Spirals and centers also get their direction of rotation.
- **Eigenvalues:** written exactly when possible: −2 and −1, −0.5 ± 2i, (−1 ± √13)/2, ±i√3.
- **Nonlinear centers** are reported as centers *of the linearization*, because the linearization can't decide those. A zero eigenvalue is reported as degenerate.
- **Eigenvectors:** drawn as dashed lines and described as lines through the equilibrium. For a saddle, the alt text says which line attracts and which repels. For a node, it gives the slow direction trajectories come in tangent to.
- **Nullclines:** found by contouring, with points located exactly on each grid edge. When a nullcline is made of straight lines, they are named: "the lines x = 0 and y = −x + 1". Poles are not mistaken for zeros.
- **Trajectories:** integrated with RK4 in steps of fixed length on screen. Each one ends when it leaves the window (the alt text says across which edge), reaches an equilibrium, closes up, or keeps circling without settling (a limit cycle). Arrowheads show the direction of motion and are kept off the axes.
- **Dots:** equilibria are filled when stable and open when unstable, and the alt text says so.
- **Rejected:** a linear system with a whole line of equilibria (singular matrix) is rejected, so that figure keeps its cropped image. Singular systems with *no* equilibria are fine.

Example alt text: *"Four equilibria: (0, 0), an unstable node (eigenvalues 0.75 and 1); (0, 0.75), a saddle (eigenvalues −0.75 and 0.25); (0.5, 0.5), a stable node (eigenvalues ≈−0.854 and ≈−0.146); (1, 0), a saddle (eigenvalues −1 and 0.25). … The x-nullcline (where x′ = 0, dashed) is the lines x = 0 and y = −x + 1."*

## Drawing

Every kind becomes a *plot* (fills, curves, straight edges, strips, guides, impulses, field arrows, arrowheads, points, labels) and is drawn by one renderer. The SVG is 480 × 320, self-contained, and print-friendly. It uses Okabe–Ito colors plus dash patterns, so nothing depends on color alone. Labels are placed away from other ink: curve labels along their curve, dot labels at the clearest of several spots, and strip labels on the axis as in textbooks. Tick labels give way to all of them. It is accessible: `role="img"` with `<title>` (short alt) and `<desc>` (long alt).

## Files

- `src/lib/redraw/`
  - `common.ts`: shared fields
  - `spec.ts`: checks, dispatch, graph
  - `region.ts`: region
  - `phase.ts`: phase plane
  - `expr.ts`: expressions
  - `nice.ts`: numbers
  - `sample.ts`: sampling
  - `analyze.ts`: graph facts
  - `describe.ts`: graph alt text
  - `svg.ts`: drawing
  - `index.ts`: `redraw(spec, { id })`
  - `examples.ts`: examples
- `figure-lab.html`, `src/figure-lab.ts`: the lab
- `tests/redraw.test.ts`

## In the app (2.2.0)

- **Redraw pass:** `redrawFigure` (pipeline.ts) sends the figure's crop and the notes around its marker (`notesAround`, mostly before the figure). The answer is constrained by `REDRAW_SCHEMA`, a flat object with every kind's fields optional, which small grammar-constrained models handle better than a union. The tidy-up drops empty and unrelated fields, strips "y =" and stray LaTeX from expressions, and accepts a phase system written in the author's letters. A spec that fails the checks goes back to the model once with its problems listed, and the better answer is kept (`specConversation`, conversation.ts).
- **Figures:** `Figure.redraw = { spec, show }`. Only the spec text is stored. The SVG and alt text are regenerated through a small cache (`figureRedraw.ts`), so engine improvements reach existing figures and a broken spec falls back to the image. Element ids are rewritten per figure (`placeSvg`), so two redrawn figures on a page never share ids.
- **Export:** *Redrawn* is the inline SVG with `<title>`/`<desc>`. *Both* adds the original image in a collapsed `<details>` with its own alt text.
- **Checklist:** a chosen redraw with errors is reported. A figure shown only as a redraw needs no hand-written alt text.

## Next

1. **Ink check:** compare the drawn ink with the computed curves and flag mismatches with "Check equation".
2. More kinds, if real notes call for them (number lines and sign charts, direction fields for y′ = f(t, y)).
