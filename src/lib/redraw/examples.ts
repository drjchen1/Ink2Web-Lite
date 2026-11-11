/** Example redraw specs (2.2 dev): used by the figure lab and the tests. */
export const EXAMPLES: { name: string; spec: object }[] = [
  {
    name: 'Graph: damped oscillation with envelope',
    spec: {
      kind: 'graph',
      from: 'u(t) = e^{-t/2}\\cos(3t)',
      window: { x: [0, 8], y: [-1.1, 1.1] },
      axes: { x: 't', y: 'u' },
      curves: [
        { expr: 'exp(-t/2)*cos(3t)', label: 'u(t)' },
        { expr: 'exp(-t/2)', style: 'dashed' },
        { expr: '-exp(-t/2)', style: 'dashed' },
      ],
      points: [{ on: { curve: 1, at: 0 }, label: 'u(0) = 1', pos: 'right' }],
    },
  },
  {
    name: 'Graph: step input (piecewise forcing)',
    spec: {
      kind: 'graph',
      from: 'g(t) = \\begin{cases} 0, & 0 \\le t < 2 \\\\ 1, & 2 \\le t < 5 \\\\ 0, & t \\ge 5 \\end{cases}',
      window: { x: [0, 7], y: [-0.5, 1.5] },
      axes: { x: 't', y: 'g' },
      curves: [
        {
          label: 'g(t)',
          pieces: [
            { expr: '0', on: [0, 2], ends: ['closed', 'open'] },
            { expr: '1', on: [2, 5], ends: ['closed', 'open'] },
            { expr: '0', on: [5, 7], ends: ['closed', null] },
          ],
        },
      ],
      points: [{ at: [2, 0], fill: 'open' }, { at: [2, 1] }, { at: [5, 1], fill: 'open' }, { at: [5, 0] }],
    },
  },
  {
    name: 'Graph: solution with a switch-on (u(t − c))',
    spec: {
      kind: 'graph',
      from: 'y = 1 - \\cos t + u_{\\pi}(t)\\,(1 + \\cos t)',
      window: { x: [0, 12], y: [-0.5, 2.5] },
      axes: { x: 't', y: 'y' },
      ticks: { x: [{ at: 3.141592653589793, label: 'π' }, { at: 6.283185307179586, label: '2π' }, { at: 9.42477796076938, label: '3π' }] },
      curves: [{ expr: '1 - cos(t) + u(t - pi)*(1 + cos(t))', label: 'y(t)' }],
    },
  },
  {
    name: 'Graph: impulse response',
    spec: {
      kind: 'graph',
      from: "y'' + y = \\delta(t - 2),\\ y = u_2(t)\\sin(t - 2)",
      window: { x: [0, 12], y: [-1.3, 1.6] },
      axes: { x: 't', y: 'y' },
      curves: [{ expr: 'u(t-2)*sin(t-2)', label: 'y(t)' }],
      impulses: [{ at: 2, size: 1.3, label: 'δ(t − 2)' }],
    },
  },
  {
    name: 'Graph: asymptotes (tan x)',
    spec: {
      kind: 'graph',
      from: 'y = \\tan x',
      window: { x: [-4.5, 4.5], y: [-4, 4] },
      axes: { x: 'x', y: 'y' },
      curves: [{ expr: 'tan(x)' }],
    },
  },
  {
    name: 'Graph: domain edge (ln x and its tangent line)',
    spec: {
      kind: 'graph',
      from: 'y = \\ln x, \\quad y = x - 1',
      window: { x: [-1, 4] },
      axes: { x: 'x', y: 'y' },
      curves: [
        { expr: 'ln(x)', label: 'ln x' },
        { expr: 'x - 1', style: 'dotted', label: 'y = x − 1' },
      ],
      points: [{ on: { curve: 1, at: 1 }, label: '(1, 0)', pos: 'below' }],
    },
  },
  {
    name: 'Region: between √x and x² (vertical slice)',
    spec: {
      kind: 'region',
      from: 'A = \\int_0^1 \\left(\\sqrt{x} - x^2\\right) dx',
      top: { expr: 'sqrt(x)', label: 'y = √x' },
      bottom: { expr: 'x^2', label: 'y = x^2' },
      between: 'intersections',
      slice: { at: 0.55, label: 'Δx' },
      markIntersections: true,
    },
  },
  {
    name: 'Region: under a curve with straight sides',
    spec: {
      kind: 'region',
      from: '\\int_0^2 (x^2 + 1)\\,dx',
      top: { expr: 'x^2 + 1', label: 'y = x^2 + 1' },
      between: [0, 2],
      area: true,
    },
  },
  {
    name: 'Region: curves that cross (y = x and y = x³)',
    spec: {
      kind: 'region',
      from: 'A = \\int_{-1}^{1} |x - x^3|\\,dx',
      window: { x: [-1.5, 1.5], y: [-1.5, 1.5] },
      top: 'x',
      bottom: 'x^3',
      markIntersections: true,
      area: true,
    },
  },
  {
    name: 'Region: horizontal slices (x = y² and x = y + 2)',
    spec: {
      kind: 'region',
      from: 'A = \\int_{-1}^{2} \\left((y + 2) - y^2\\right) dy',
      right: { expr: 'y + 2', label: 'x = y + 2' },
      left: { expr: 'y^2', label: 'x = y^2' },
      slice: { at: 0.5, label: 'Δy' },
      markIntersections: true,
    },
  },
  {
    name: 'Phase: stable node with eigenvectors',
    spec: {
      kind: 'phase',
      from: "\\mathbf{x}' = \\begin{pmatrix} 0 & 1 \\\\ -2 & -3 \\end{pmatrix} \\mathbf{x}",
      A: [[0, 1], [-2, -3]],
      window: { x: [-3, 3], y: [-3, 3] },
      show: ['field', 'equilibria', 'eigenvectors'],
      trajectories: [{ start: [2.5, 0] }, { start: [-2.5, 0.5] }, { start: [0.5, 2.8] }, { start: [-0.5, -2.8] }],
    },
  },
  {
    name: 'Phase: saddle',
    spec: {
      kind: 'phase',
      from: "x' = x + y, \\; y' = 4x + y",
      system: { x: 'x + y', y: '4x + y' },
      window: { x: [-3, 3], y: [-3, 3] },
      show: ['field', 'equilibria', 'eigenvectors'],
      trajectories: [{ start: [1, -1.6] }, { start: [-1, 1.6] }, { start: [1.5, -2.5] }, { start: [-1.5, 2.5] }],
    },
  },
  {
    name: 'Phase: stable spiral',
    spec: {
      kind: 'phase',
      from: "x' = -0.5x + 2y, \\; y' = -2x - 0.5y",
      system: { x: '-0.5x + 2y', y: '-2x - 0.5y' },
      trajectories: [{ start: [2.5, 0], direction: 'forward' }],
    },
  },
  {
    name: 'Phase: center (undamped spring)',
    spec: {
      kind: 'phase',
      from: "u'' + 4u = 0 \\Rightarrow u' = v,\\; v' = -4u",
      axes: { x: 'u', y: 'v' },
      system: { u: 'v', v: '-4u' },
      trajectories: [{ start: [1, 0] }, { start: [0.5, 0] }],
    },
  },
  {
    name: 'Phase: competing species with nullclines',
    spec: {
      kind: 'phase',
      from: "x' = x(1 - x - y), \\; y' = y(0.75 - y - 0.5x)",
      system: { x: 'x(1 - x - y)', y: 'y(0.75 - y - 0.5x)' },
      window: { x: [-0.1, 1.2], y: [-0.1, 1.1] },
      show: ['field', 'equilibria', 'nullclines'],
      trajectories: [{ start: [0.1, 1], direction: 'forward' }, { start: [1.15, 0.05], direction: 'forward' }],
    },
  },
  {
    name: 'Phase: pendulum',
    spec: {
      kind: 'phase',
      from: "\\theta' = \\omega, \\; \\omega' = -\\sin\\theta",
      axes: { x: 'θ', y: 'ω' },
      vars: ['x', 'y'],
      system: { x: 'y', y: '-sin(x)' },
      window: { x: [-7, 7], y: [-3, 3] },
      ticks: { x: [{ at: -6.283185307179586, label: '−2π' }, { at: -3.141592653589793, label: '−π' }, { at: 3.141592653589793, label: 'π' }, { at: 6.283185307179586, label: '2π' }] },
      trajectories: [{ start: [0, 1] }, { start: [0, 2.5] }, { start: [0, -2.5] }],
    },
  },
];
