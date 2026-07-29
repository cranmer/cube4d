/**
 * Named viewpoints, and gliding between them.
 *
 * A free 4D trackball is the honest interface — every drag is a genuine rotation of 4-space — but
 * it is also very easy to get lost in. There is no horizon and no gravity, so an orientation you
 * reached by accident can be hard to leave. A small set of named viewpoints gives you somewhere to
 * stand: not a replacement for dragging, but a way back.
 *
 * A viewpoint is defined by **which direction is pointed away from the viewer**. The renderer puts
 * the 4D eye on the +W axis and projects with `xyz * eyeW / (eyeW - w)`, so the cell sitting at
 * w = -1 is the farthest away and projects smallest — it is the little cube at the centre of the
 * familiar picture. "Bring a cell to the centre" therefore means "rotate it onto -W", which is what
 * each of these matrices does.
 *
 * The names are directional rather than numeric because direction is the thing being taught. Three
 * of the four axes have ordinary names; the fourth pair are *ana* and *kata*, coined by Charles
 * Hinton in the 1880s for the two directions perpendicular to all of length, width and height.
 * Nobody has a better word, and having a word at all helps.
 */

import { gramSchmidt, NICE_VIEW } from './rotation.js';
import { identity, makeRowRotMat, mxm } from './vecmath.js';

const N = 4;

export interface CanonicalView {
  readonly id: string;
  readonly name: string;
  /** One-line explanation of what you are looking at, for a tooltip or a caption. */
  readonly hint: string;
  /** Row-major 4x4, row-vector convention (`v · M`), as every view matrix here is. */
  readonly mat: readonly number[];
}

/**
 * A rotation sending the signed axis `axis` to -W, with the remaining axes kept in a right-handed
 * order so that the picture does not mirror as you step between viewpoints.
 *
 * Built as a signed permutation: row `i` of the matrix is where basis vector `i` lands.
 */
function bringToCentre(axis: number, sign: 1 | -1): number[] {
  const mat = new Array<number>(N * N).fill(0);
  // The chosen axis goes to -W...
  mat[axis * N + 3] = -sign;
  // ...and the other three fill X, Y, Z in their original relative order. Reversing the sign of one
  // of them when needed keeps the determinant at +1, so this is a rotation and never a reflection.
  const rest = [0, 1, 2, 3].filter((a) => a !== axis);
  for (let k = 0; k < 3; ++k) mat[rest[k] * N + k] = 1;
  if (determinantIsNegative(mat)) mat[rest[0] * N + 0] = -mat[rest[0] * N + 0];
  return mat;
}

/** Sign of the determinant of a signed permutation matrix, by counting swaps and negations. */
function determinantIsNegative(mat: readonly number[]): boolean {
  // Small and exact: expand over the permutation directly rather than doing general elimination.
  const where: number[] = [];
  let negations = 0;
  for (let i = 0; i < N; ++i) {
    for (let j = 0; j < N; ++j) {
      if (mat[i * N + j] !== 0) {
        where[i] = j;
        if (mat[i * N + j] < 0) negations++;
      }
    }
  }
  let swaps = 0;
  for (let i = 0; i < N; ++i) for (let j = i + 1; j < N; ++j) if (where[i] > where[j]) swaps++;
  return (swaps + negations) % 2 === 1;
}

/**
 * The viewpoints offered, in cycling order.
 *
 * Deliberately puzzle-independent: these are orientations of 4-space, not of any particular
 * polytope, so the same key means the same rotation on every puzzle in the catalog. For the
 * hypercube — where the eight cell centres are exactly the eight signed axes — each one also
 * happens to bring a specific cell to the centre, which is the case that matters most.
 */
export const CANONICAL_VIEWS: readonly CanonicalView[] = [
  {
    id: 'default',
    name: 'Default',
    hint: 'The oblique view the puzzle opens in, chosen to show all four axes at once.',
    // NICE_VIEW is quoted to three decimals in the original, so it is very slightly not a rotation.
    // Everything in this list should be one exactly, since callers may compose them.
    mat: [...gramSchmidt(Float64Array.from(NICE_VIEW))],
  },
  { id: 'right', name: 'Right', hint: 'Looking along +X.', mat: bringToCentre(0, 1) },
  { id: 'left', name: 'Left', hint: 'Looking along −X.', mat: bringToCentre(0, -1) },
  { id: 'up', name: 'Up', hint: 'Looking along +Y.', mat: bringToCentre(1, 1) },
  { id: 'down', name: 'Down', hint: 'Looking along −Y.', mat: bringToCentre(1, -1) },
  { id: 'front', name: 'Front', hint: 'Looking along +Z.', mat: bringToCentre(2, 1) },
  { id: 'back', name: 'Back', hint: 'Looking along −Z.', mat: bringToCentre(2, -1) },
  {
    id: 'ana',
    name: 'Ana',
    hint: 'Looking along +W — one of the two directions perpendicular to all of X, Y and Z.',
    mat: bringToCentre(3, 1),
  },
  {
    id: 'kata',
    name: 'Kata',
    hint: 'Looking along −W — the other direction with no 3D analogue.',
    mat: bringToCentre(3, -1),
  },
];

/**
 * The same viewpoint, seen from the next corner round.
 *
 * The default oblique view is good precisely because it is oblique — seven of the eight cells are
 * visible at once and nothing hides behind anything. But it is one of *four* equally good corners,
 * and the only way to reach the other three was to drag until it looked about right.
 *
 * The obvious implementation is wrong, and instructively so. "Rotate the camera 90° about the
 * screen's vertical axis" is a quarter turn in the view's X–Z plane — exactly what a horizontal
 * drag does — and it produces a *degenerate* picture, because the view's up direction is not the
 * direction of the top cell. The default view is deliberately oblique, and a rotation about the
 * screen axis destroys that obliqueness instead of preserving it.
 *
 * What is wanted is a symmetry of the arrangement: rotate about the axis through the top and bottom
 * *cells*, so the four cells around the ring cycle and everything else stays put. That is a rotation
 * of the puzzle rather than of the camera, and it is applied before the view rather than after.
 *
 * Which plane to rotate in is read off the view itself. The rows of a view matrix are the images of
 * the puzzle's axes, so the axis pointing at the viewer is the row most aligned with W, the vertical
 * one is the row most aligned with Y, and the remaining two are the ring. Doing it this way means
 * the control composes with the named viewpoints instead of being special-cased per viewpoint — and
 * since the rotation fixes the W axis, the centred cell never changes. "Which cell is in the middle"
 * and "which corner am I looking from" stay independent questions.
 */
export function quarterTurn(mat: Float64Array | readonly number[], step: 1 | -1): Float64Array {
  const rows = [0, 1, 2, 3];
  const alignment = (row: number, axis: number) => Math.abs(mat[row * N + axis]);

  const wAxis = rows.reduce((best, r) => (alignment(r, 3) > alignment(best, 3) ? r : best), 0);
  const rest = rows.filter((r) => r !== wAxis);
  const upAxis = rest.reduce((best, r) => (alignment(r, 1) > alignment(best, 1) ? r : best), rest[0]);
  const [a, b] = rest.filter((r) => r !== upAxis);

  // Rotating a towards b is clockwise on screen for one handedness of (image a, image b, image up)
  // and anticlockwise for the other, and which one it is varies between viewpoints. Reading the sign
  // off the images rather than assuming it keeps the button meaning the same thing everywhere. The
  // overall sign is fixed by observation: from the default view, `step = 1` must send the cell on
  // the upper left round to the upper right.
  const xyz = (row: number) => [mat[row * N], mat[row * N + 1], mat[row * N + 2]];
  const [p, q, u] = [xyz(a), xyz(b), xyz(upAxis)];
  const handedness =
    p[0] * (q[1] * u[2] - q[2] * u[1]) -
    p[1] * (q[0] * u[2] - q[2] * u[0]) +
    p[2] * (q[0] * u[1] - q[1] * u[0]);

  const turn = makeRowRotMat(N, a, b, (step * (handedness >= 0 ? -1 : 1) * Math.PI) / 2);
  // Pre-multiplied: the puzzle turns under a fixed camera, not the other way round.
  return mxm(turn, Float64Array.from(mat), N);
}

export function canonicalViewById(id: string): CanonicalView | undefined {
  return CANONICAL_VIEWS.find((v) => v.id === id);
}

/** The next viewpoint in cycling order, wrapping. `step` of -1 goes back. */
export function nextCanonicalView(id: string | null, step: 1 | -1): CanonicalView {
  const at = CANONICAL_VIEWS.findIndex((v) => v.id === id);
  // No current viewpoint — the view has been dragged — so a step forward means "the first one".
  const from = at < 0 ? (step === 1 ? -1 : 0) : at;
  const n = CANONICAL_VIEWS.length;
  return CANONICAL_VIEWS[(((from + step) % n) + n) % n];
}

/**
 * A view matrix `t` of the way from `from` to `to`, for animating between viewpoints.
 *
 * Re-exported from `so4.ts`, where the reason it is not simply a blend of the two matrices is
 * written down at length. Short version: the obvious approximations stall on half-turns, and
 * half-turns are exactly what separate one axis-aligned viewpoint from another.
 */
export { interpolateRotation } from './so4.js';

/** How far a view matrix is from a target, as the largest single-entry difference. */
export function viewDistance(current: Float64Array, target: readonly number[]): number {
  let worst = 0;
  for (let i = 0; i < N * N; ++i) worst = Math.max(worst, Math.abs(current[i] - target[i]));
  return worst;
}

/** The identity view, for tests and as a safe fallback. */
export function identityView(): Float64Array {
  return identity(N);
}
