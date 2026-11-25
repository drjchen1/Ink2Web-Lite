# Redraw Engine & Line-DSL Reference (Clean-Slate v2, v3.3.0)

Hand-drawn figures whose meaning lies in their mathematics (function graphs, piecewise step plots, shaded integrals, Riemann sums, slope fields, phase planes, sign charts, complex $s$-plane pole-zero plots, and block/spring schematics) can be redrawn cleanly from their mathematical specification — while always preserving the cropped original sketch as an instant fallback (**Image · Redrawn · Both**).

**Developer Playground:** Start `npm run dev` and open **<http://localhost:5173/figure-lab.html>** to test **Line-DSL (v2)** and **Legacy JSON (v1)** specs with live SVG preview, computed facts, and accessible alt text. (`figure-lab.html` is a development tool only and is not bundled in `dist/`.)

---

## Architecture Overview (6 Pillars)

The Clean-Slate Redraw v2 engine lives in `src/lib/redraw/v2/` and feeds directly into `redraw()` (`src/lib/redraw/index.ts`) and `redrawFigure()` (`src/lib/pipeline.ts`):

1. **Pre-Model Ink CV (`sketchCv.ts` — `analyzeSketch`)**
   - Analyzes the figure crop's binary ink mask *before* calling the vision model: frame type (`axes-2d`, `line-1d`, `diagram`, `freeform`), detected axis positions & origin placement, quadrant ink density `[Q1, Q2, Q3, Q4]`, aspect ratio, and stroke group count.
   - Injects a compact geometry hint into the prompt so 3B–4B models ground signs, quadrants, and windows reliably.
2. **Equation Menu Grounding (`eqMenu.ts` — `extractEquationMenu`, `expandEqRefs`)**
   - Scans surrounding notes around `>>> THIS FIGURE <<<` for display (`$$...$$`) and inline (`$...$`) equations, assigns `@eq1`, `@eq2`, … tokens, and expands references before parsing so small models do not have to re-transcribe complex fractions from pixels.
3. **Composable Scene AST + Compact Line-DSL (`scene.ts` — `parseSceneDsl`, `formatSceneDsl`, `upgradeV1ToScene`)**
   - Unifies cartesian, polar, complex $s$-plane, 1D number lines/sign charts, and schematic block diagrams into typed `PlotScene` (composable `curve`, `shade`, `field`, `flow`, `mark` layers) and `DiagramScene` (`node`, `edge`) ASTs.
   - Accepts concise `key: value | option` Line-DSL (ideal for small models and fast hand edits) as well as JSON `SceneSpec` objects and legacy v1 specs.
   - Explicit opt-out: `scene: image` keeps the cropped sketch untouched (`status: 'none'`).
4. **Native LaTeX & Piecewise Compiler (`latexExpr.ts`)**
   - Parses real LaTeX (`\frac`, `\dfrac`, `\tfrac`, `\sqrt`, `\sin^2 t`, `\tan^{-1}`, `|x|`, `u_c(t)`, `H_c(t)`, Greek symbols, and `\begin{cases}...\end{cases}`) alongside calculator syntax into AST closures — **zero `eval()` or `new Function()`**.
   - `evalBound()` resolves constants and symbolic bounds (`pi/2`, `\frac{\pi}{2}`, `2e`, `c`, `-inf`, `inf`) for windows, domains, ticks, and marks.
5. **Closed-Loop Bidirectional Ink Verification (`sketchCv.ts` — `verifySceneAgainstInk`, `converseV2.ts`)**
   - `runRedrawV2Conversation()` parses, evaluates, and runs bidirectional origin-anchored Chamfer distance scoring (`forwardCoverage` + `reverseCoverage`) between rendered curve polylines and the hand-drawn ink.
   - On syntax, evaluation, or ink-mismatch diagnostics, sends one structured repair turn and keeps the higher-scoring answer.
   - `convertPage()` gates default document visibility by confidence:
     - **`high`**: shows `Redrawn`
     - **`medium`**: shows `Both` + sets `redrawCheck` review warning
     - **`low`**: keeps `Image` + sets `redrawCheck` review warning
6. **Pure-SVG Math Typesetter & Renderer (`mathSvg.ts`, `evaluate.ts`, `describeScene.ts`, `render.ts`)**
   - `measureAndRenderMath()` builds `MathBox` layouts in pure TypeScript (zero DOM, identical in Node tests and browsers) for stacked fractions, square roots, superscripts/subscripts, calligraphic `\mathcal{L}`, Greek letters, and upright function names.
   - `renderSceneSvg()` draws with Okabe–Ito colorblind-safe strokes paired with dash patterns, expanded `<clipPath>` rects and negative axis overhangs (so origin jumps/dots never clip), occupancy-grid label placement with leader-line fallback, and strictly self-closing SVG shapes (`/>`).
   - `describeScene()` computes `alt.short`, `alt.long` (zeros, extrema, jumps, asymptotes, undefined gaps, area, equilibria & eigenvalues, trajectory behavior, diagram topology), and MathJax `alt.markdown`.

---

## Line-DSL Specification

Blank lines and `#` / `//` comments are ignored. Pipe segments (`|`) separate options on any layer line. Quotes (`"..."`) preserve spaces or colons inside labels. Multiline `\begin{cases}...\end{cases}` or braced TeX blocks are joined automatically.

### Scene Headers

| Directive | Description | Example |
|---|---|---|
| `scene:` | `plot` (default), `diagram`, or `image` (keeps original crop) | `scene: diagram` |
| `from:` | Source equation or title from notes (**required** on `plot`) | `from: y = u_c(t)(t - c)` or `from: @eq1` |
| `space:` | `cartesian` (default), `polar`, `complex`, or `1d` | `space: complex` |
| `schematic:` | `true` for qualitative curves without explicit formulas (hides misleading ticks, skips curve ink check) | `schematic: true` |
| `param:` | One or more numeric parameters usable in expressions, domains, bounds, and ticks | `param: c = 2, a = 0.5` |
| `axes:` | Axis labels and optional `[min, max]` windows (`x` only for `1d`) | `axes: t [0, 5], y [-0.5, 3]` |
| `tick-x:`, `tick-y:` | Custom ticks with optional quoted labels | `tick-x: c:"c", pi:"\pi", 2pi` |

### Plot Layers (`scene: plot`)

#### `curve:`
```text
curve: <expr> [; <exprY>] [| form=y|x|polar|parametric|implicit|cases] [| solid|dashed|dotted] [| domain=[a, b]] [| ends=[open|closed|none, ...]] [| label="..."] [| guides]
```
- Supports `\begin{cases} ... \end{cases}` directly inside `curve:` (automatically creates intervals and open/closed endpoint markers from `<`, `<=`, `>`, `>=`, `otherwise`).
- `guides` draws vertical dashed jump guides at piecewise discontinuities.
- Examples:
  - `curve: \frac{\sin^2 t}{\sqrt{t + 1}} | domain=[0, 2pi] | label="f(t)"`
  - `curve: 2\cos(2\theta) | form=polar | domain=[0, 2pi]`
  - `curve: \cos t; \sin t | form=parametric | domain=[0, 2pi]`
  - `curve: x^2 + y^2 - 4 | form=implicit`

#### `shade:` and `roc:`
```text
shade: <topExpr> [.. <bottomExpr>] [| axis=x|y] [| on=intersections|[a, b]] [| slice=at:"label"] [| riemann=n:left|right|midpoint|trapezoid] [| area] [| label="..."]
roc: Re(s) > -2 [, Re(s) < 1]
```
- Computes adaptive Simpson areas, exact intersection points (`findMeets`), curve swaps if crossing occurs inside `[a, b]`, representative integration slices, and Riemann sum rectangles/trapezoids.
- `roc:` shades left/right complex half-planes on `space: complex` $s$-plane plots.

#### `field:` and `flow:`
```text
field: slope <dy/dt> [| vars=[t, y]] [| field | isoclines]
field: vector <dx/dt> ; <dy/dt> [| vars=[x, y]] [| field | equilibria | nullclines | eigenvectors]
flow: [x0, y0] [| both|forward|backward] [| label="..."]
```
- `field` vectors compute fixed-point equilibria via Newton iteration, classify Jacobian eigenvalues (node, saddle, spiral, center, degenerate, focus/stability), contour nullclines/zero-isoclines, and integrate `flow:` trajectories via adaptive step-size RK4.
- If state variable letters match axis names (e.g. `axes: u, v`), `vars=` is inferred automatically; set `vars=[x, y]` explicitly when axis labels differ from equation variables (e.g. `axes: θ, ω` with `vars=[x, y]`).

#### Marks (`point:`, `pole:`, `zero:`, `impulse:`, `arrow:`, `projection:`, `sign:`, `interval:`, `label:`)
- `point: [x, y] | closed|open | label="..." | pos=above|below|left|right`
- `pole: [re, im]` / `zero: [re, im]` *(auto-switches `space: complex` if unset)*
- `impulse: t_at | size=1 | label="\delta(t - 2)"`
- `arrow: [x0, y0] -> [x1, y1] | solid|dashed|dotted | label="..."`
- `projection: [x, y]` *(dashed perpendicular guides from `(x, y)` to both axes)*
- `sign: [a, b]:+|-|0|undef` *(1D sign chart region above axis)*
- `interval: (a, b] | label="..."` *(1D highlighted open/closed interval)*
- `label: [x, y] | "text"`

### Diagram Scenes (`scene: diagram`)

Used for non-coordinate engineering/math schematics (feedback control loops, spring-mass-damper systems, tanks, free-body schematics):

```text
scene: diagram
from: Feedback control loop H(s)
node: r = point("R(s)") @ (0, 0)
node: s = sum("+") @ (1, 0)
node: g = box("G(s)") @ (2, 0)
node: y = point("Y(s)") @ (3, 0)
node: h = box("H(s)") @ (2, 1)
edge: r -> s | arrow
edge: s -> g | arrow | label="E(s)"
edge: g -> y | arrow
edge: y -> h | arrow
edge: h -> s | arrow | label="-"
```

- **Node shapes:** `box`, `circle`, `sum`, `mass`, `wall`, `tank`, `ground`, `point` positioned on logical integer grid coordinates `@ (col, row)`.
- **Edge styles:** `arrow`, `line`, `dashed`, `spring`, `damper`, with optional `label="..."` and `bend=offset`.

---

## Native LaTeX & Expression Compiler Rules

- Accepts LaTeX (`\frac`, `\dfrac`, `\tfrac`, `\sqrt[n]{...}`, `\sin^2 t`, `\tan^{-1}(x)`, `|x|`, `\pi`, `\theta`, `\omega`, `u_c(t)`, `H_c(t)`, implicit multiplication like `2t^2` or `(t+1)(t-1)`), as well as standard calculator notation (`exp(-t)*cos(3*t)`, `sqrt(x)`, `ln(x)`, `abs(x)`).
- Precedence matches mathematical convention (`^` binds tighter than unary `-`, so `-t^2` means `-(t^2)`).
- Rejects scientific `e` shorthand (`2e-3`) so Euler's constant `e` in `2e - 3` or `e^(-t)` is never ambiguous.
- Bounds and ticks accept expressions/constants (`"pi/2"`, `"-2pi"`, `"\frac{\pi}{4}"`, `"-inf"`, `"inf"`).

---

## Backwards Compatibility (Legacy v1 JSON)

All v1 JSON specs (`"kind": "graph" | "region" | "phase" | "slope" | "line"`) continue to validate and render through `redraw()`, preserving existing saved `.ink2web.json` projects and regression suites (`tests/redraw.test.ts`, `tests/redrawApp.test.ts`).

- `upgradeV1ToScene(spec)` losslessly converts any v1 spec object into an equivalent v2 `PlotScene`.
- Inside `RedrawSection.tsx`, opening a legacy JSON figure enables **Upgrade to Line-DSL** or automatically edits via two-way **Scene & layer controls**.

---

## Module Map & Tests

- **v2 Core (`src/lib/redraw/v2/`):**
  - `latexExpr.ts` — LaTeX preprocessor, closure compiler, `evalBound`, `parseCasesExpr`
  - `eqMenu.ts` — `@eq1` equation menu extraction and expansion
  - `mathSvg.ts` — Pure-SVG `MathBox` typesetter (`measureAndRenderMath`, `plainLabel`)
  - `scene.ts` — `PlotScene` / `DiagramScene` AST, `parseSceneDsl`, `formatSceneDsl`, `upgradeV1ToScene`, `V2_TEMPLATES`
  - `sketchCv.ts` — `analyzeSketch`, `formatSketchHint`, `verifySceneAgainstInk`
  - `evaluate.ts` — `evaluateScene` geometry evaluator & analytical facts
  - `describeScene.ts` — `describeScene` accessible alt/markdown generator
  - `render.ts` — `renderSceneSvg` textbook SVG renderer
  - `converseV2.ts` — `REDRAW_V2_SYSTEM`, `buildRedrawV2Prompt`, `runRedrawV2Conversation`
- **Entry & Integration:** `src/lib/redraw/index.ts`, `src/lib/redraw/inkCheck.ts`, `src/lib/figureRedraw.ts`, `src/lib/pipeline.ts`, `src/components/RedrawSection.tsx`, `src/figure-lab.ts`, `figure-lab.html`
- **Tests:** `tests/redrawV2.test.ts`, `tests/redraw.test.ts`, `tests/redrawApp.test.ts`, `tests/wave2.test.ts`, `tests/lesson29.test.ts` (run all via `npm test`).
