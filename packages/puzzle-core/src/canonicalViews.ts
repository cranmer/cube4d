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
 * The default view's 3D obliqueness, on its own.
 *
 * `NICE_VIEW` leaves W alone — its last row and column are both `(0,0,0,1)` — so it is a pure
 * rotation of the 3D part, and that is exactly what makes the opening picture readable: nothing is
 * seen face-on, so seven of the eight cells are visible at once with nothing hidden behind anything.
 */
const OBLIQUE = gramSchmidt(Float64Array.from(NICE_VIEW));

/**
 * A view bringing the signed axis `axis` to -W, seen from the same oblique corner as the default.
 *
 * The alignment itself is a signed permutation — row `i` says where basis vector `i` lands, and the
 * sign of one axis is flipped where needed to keep the determinant at +1, so this is a rotation and
 * never a reflection. On its own that produces a face-on view, which is legible but flat: whole
 * cells line up behind one another and the structure is harder to read than in the opening view.
 *
 * Composing it with `OBLIQUE` fixes that, and costs nothing, because `OBLIQUE` fixes W. Applied
 * after the alignment it tilts the 3D part into the pleasant corner while leaving the centred cell
 * exactly where the alignment put it. Every viewpoint therefore looks like the default view with a
 * different cell in the middle, which is the point of having them.
 *
 * One consequence worth knowing: the default view already centres the -W cell, so `kata` — which
 * asks for exactly that — comes out identical to it.
 */
function bringToCentre(axis: number, sign: 1 | -1): number[] {
  const mat = new Array<number>(N * N).fill(0);
  // The chosen axis goes to -W...
  mat[axis * N + 3] = -sign;
  // ...and the other three fill X, Y, Z in their original relative order.
  const rest = [0, 1, 2, 3].filter((a) => a !== axis);
  for (let k = 0; k < 3; ++k) mat[rest[k] * N + k] = 1;
  if (determinantIsNegative(mat)) mat[rest[0] * N + 0] = -mat[rest[0] * N + 0];
  return [...mxm(Float64Array.from(mat), OBLIQUE, N)];
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
 * The viewpoints offered, in cycling order: the four positive axes, then the four negative.
 *
 * Named for the axis each brings to the middle rather than for a screen direction. These were once
 * Right/Left/Up/Down/Front/Back/Ana/Kata, which read well and were wrong: the view is deliberately
 * oblique, so no puzzle axis points at the top of the screen, and "Front" was the button that
 * centred the cell you saw *above* everything else. An axis name cannot mislead that way, and it
 * stays honest on the puzzles where no cell sits on an axis at all.
 *
 * Deliberately puzzle-independent: these are orientations of 4-space, not of any particular
 * polytope, so the same key means the same rotation on every puzzle in the catalog. For the
 * hypercube — whose eight cell centres are exactly the eight signed axes — each also brings a
 * specific cell to the middle, which is the case that matters most. On a duoprism or the 120-cell
 * they are still perfectly good directions; they just do not name a cell.
 *
 * There is no separate "default" entry. The opening view already centres −W, so `-w` is it.
 */
export const CANONICAL_VIEWS: readonly CanonicalView[] = [
  { id: '+x', name: '+X', hint: 'The +X direction in the middle.', mat: bringToCentre(0, 1) },
  { id: '+y', name: '+Y', hint: 'The +Y direction in the middle.', mat: bringToCentre(1, 1) },
  { id: '+z', name: '+Z', hint: 'The +Z direction in the middle.', mat: bringToCentre(2, 1) },
  {
    id: '+w',
    name: '+W',
    hint: 'The +W direction in the middle — "ana", one of the two directions perpendicular to X, Y and Z alike.',
    mat: bringToCentre(3, 1),
  },
  { id: '-x', name: '−X', hint: 'The −X direction in the middle.', mat: bringToCentre(0, -1) },
  { id: '-y', name: '−Y', hint: 'The −Y direction in the middle.', mat: bringToCentre(1, -1) },
  { id: '-z', name: '−Z', hint: 'The −Z direction in the middle.', mat: bringToCentre(2, -1) },
  {
    id: '-w',
    name: '−W',
    hint: 'The −W direction in the middle — "kata", the other direction with no 3D analogue. This is the view the puzzle opens in.',
    mat: bringToCentre(3, -1),
  },
];

/** The orientation a puzzle opens in, and what Reset view returns to. */
export const DEFAULT_VIEW_ID = '-w';

/**
 * The four roles a puzzle axis can play in a view, read off the view matrix.
 *
 * A view matrix's rows are the images of the puzzle's axes, so the role of each axis is a question
 * about where its row points: at the viewer (aligned with W), straight up (aligned with Y), or
 * somewhere in the ring around the middle. Reading the roles rather than hard-coding them is what
 * lets the view controls compose with every viewpoint instead of being written out per viewpoint.
 */
function axisRoles(mat: Float64Array | readonly number[]): {
  viewer: number;
  up: number;
  ring: [number, number];
} {
  const rows = [0, 1, 2, 3];
  const alignment = (row: number, axis: number) => Math.abs(mat[row * N + axis]);
  const viewer = rows.reduce((best, r) => (alignment(r, 3) > alignment(best, 3) ? r : best), 0);
  const rest = rows.filter((r) => r !== viewer);
  const up = rest.reduce((best, r) => (alignment(r, 1) > alignment(best, 1) ? r : best), rest[0]);
  const [a, b] = rest.filter((r) => r !== up);
  return { viewer, up, ring: [a, b] };
}

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
  const { up: upAxis, ring } = axisRoles(mat);
  const [a, b] = ring;

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


/**
 * Tip the arrangement: swap which direction is vertical and which faces the viewer.
 *
 * Where `quarterTurn` spins the ring and leaves the centred cell alone, this does the complementary
 * thing — it changes which cell is in the middle, without disturbing the oblique framing. Going from
 * `kata` to `down`, which is the motion this generalises, it is a clean three-cycle of axes with no
 * sign changes at all:
 *
 *   - one of the two ring axes swings in to face the viewer, so its far cell becomes the centre;
 *   - the axis that was facing the viewer swings up to vertical, so the cell that was culled and
 *     invisible appears at the top;
 *   - the axis that was vertical drops into the ring;
 *   - the other ring axis does not move.
 *
 * Being a three-cycle rather than a swap, three presses return you exactly where you started. Which
 * of the two ring axes takes part is decided by which one points away from the viewer in 3D, so
 * `quarterTurn` and this compose: spin the ring to choose a cell, then tip to bring it to the middle.
 * Between them the two controls reach every viewpoint.
 */
export function tipView(mat: Float64Array | readonly number[], step: 1 | -1): Float64Array {
  const { viewer, up, ring } = axisRoles(mat);
  // The participating ring axis is the one pointing away from the viewer, so that a quarter turn
  // followed by a tip brings a *different* cell in each time.
  const zOf = (row: number) => mat[row * N + 2];
  const [away, fixed] = zOf(ring[0]) <= zOf(ring[1]) ? ring : [ring[1], ring[0]];

  const cycle = step === 1 ? [away, viewer, up] : [away, up, viewer];
  const turn = new Float64Array(N * N);
  turn[fixed * N + fixed] = 1;
  for (let k = 0; k < 3; ++k) turn[cycle[k] * N + cycle[(k + 1) % 3]] = 1;
  // A three-cycle is an even permutation, so this is a rotation and needs no sign correction.

  // Pre-multiplied, like quarterTurn: the puzzle turns under a fixed camera.
  return mxm(turn, Float64Array.from(mat), N);
}

/**
 * Turn the whole arrangement over: the cell in the middle and the hidden one swap places.
 *
 * Turn and Tip between them cannot do this, and the gap is structural rather than incidental. Turn
 * fixes W, so it cannot change the middle at all; Tip changes it, but is a pure cycle of axes with
 * no sign changes. Neither can ever *reverse* a direction, so between them they reach only the four
 * viewpoints that centre a negative axis — 48 of the 4-cube's 192 orientations. Adding this reaches
 * all eight.
 *
 * It is a half-turn in the plane of the viewer axis and the vertical one, so the top and bottom
 * cells trade places at the same time. Being a half-turn it is its own inverse: one button, two
 * presses returns you home, and there is no direction to choose.
 */
export function flipView(mat: Float64Array | readonly number[]): Float64Array {
  const { viewer, up } = axisRoles(mat);
  return mxm(makeRowRotMat(N, viewer, up, Math.PI), Float64Array.from(mat), N);
}

/**
 * Which named viewpoint a matrix is showing, judged by the only thing the name claims: which cell
 * sits in the middle. Null once the view has been dragged somewhere that centres nothing.
 */
export function viewpointCentredBy(
  mat: Float64Array | readonly number[],
): CanonicalView | undefined {
  let axis = -1;
  for (let i = 0; i < N; ++i) if (Math.abs(mat[i * N + 3]) > 0.999) axis = i;
  if (axis < 0) return undefined;
  const sign = mat[axis * N + 3] < 0 ? 1 : -1;
  return CANONICAL_VIEWS.find((v) => {
    const row = v.mat[axis * N + 3];
    return Math.abs(row) > 0.999 && (row < 0 ? 1 : -1) === sign;
  });
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
