/**
 * The 4D view rotation.
 *
 * There is exactly one matrix. The original has no separate 3D rotation at all — the projected
 * polytope's 3D orientation is fixed, and every drag rotates in 4D. What reads as ordinary
 * trackball rotation is really rotation in the XZ and YZ planes; holding shift switches to XW and
 * YW, which is the rotation that has no 3D analogue and makes cells turn inside out.
 *
 * Ported from RotationHandler.java, including its integration scheme, which is worth appreciating:
 * a drag builds an antisymmetric matrix (an element of so(4), the Lie algebra of rotations), adds
 * the identity to it, and re-orthonormalises. That is a first-order exponential map with the error
 * projected straight back out — cheap, self-correcting, and perfectly adequate for a view matrix.
 */

import { identity, mxm } from './vecmath.js';

const N = 4;

export interface RotationState {
  /** Row-major 4x4. Points transform as `v · M`. */
  readonly mat: Float64Array;
  /** The current so(4) generator, or null when not spinning. */
  readonly spin: Float64Array | null;
}

/**
 * The orientation the original starts every puzzle in — chosen to show the 4D structure clearly
 * rather than to be axis-aligned. Taken from `MagicCube.NICE_VIEW`.
 */
export const NICE_VIEW: readonly number[] = [
  0.732, -0.196, 0.653, 0, 0.681, 0.187, -0.707, 0, 0.016, 0.963, 0.27, 0, 0, 0, 0, 1,
];

export function createRotation(matrix: readonly number[] = NICE_VIEW): RotationState {
  return { mat: gramSchmidt(Float64Array.from(matrix)), spin: null };
}

export type DragButton = 'left' | 'middle' | 'right';

export interface DragOptions {
  readonly button: DragButton;
  readonly shift: boolean;
  /** Scales rotation per pixel; the original's `dragfactor` preference. */
  readonly dragFactor?: number;
  /**
   * The puzzle's own dimension, when it is fewer than four.
   *
   * A three-dimensional puzzle is drawn flat in W, and every stage of the pipeline depends on that:
   * the projection is the identity only while `w = 0`. Rotating in a plane that contains W would tilt
   * the puzzle out of its hyperplane and start foreshortening a solid that has no fourth extent. So
   * for such a puzzle the W planes are simply not offered — shift-drag does nothing rather than
   * something wrong. See docs/three-d.md §4.
   */
  readonly dims?: number;
}

/**
 * Turn a mouse drag into a rotation.
 *
 * Which planes a drag rotates in is the whole user interface for exploring 4D:
 *
 *   left drag           XZ and YZ — looks and feels like a 3D trackball
 *   shift + left drag   XW and YW — true 4D rotation; cells turn through the fourth dimension
 *   right drag          XY (roll) and ZW
 */
export function drag(state: RotationState, dx: number, dy: number, options: DragOptions): RotationState {
  const magnitude = Math.hypot(dx, dy);
  if (magnitude <= 0.0001) return state;

  const spin = new Float64Array(N * N);
  const set = (i: number, j: number, v: number) => {
    spin[i * N + j] += v;
    spin[j * N + i] -= v;
  };

  // A puzzle flat in W may only be turned within XYZ.
  const flat = (options.dims ?? 4) < 4;
  if (options.button === 'left' && (!options.shift || flat)) {
    set(0, 2, dx);
    set(1, 2, dy);
  } else if (options.button === 'left' && options.shift) {
    set(0, 3, -dx);
    set(1, 3, -dy);
  } else if (options.button === 'right') {
    set(0, 1, dx);
    if (!flat) set(3, 2, -dy);
  } else {
    return state;
  }

  const scale = 0.005 * (options.dragFactor ?? 1);
  for (let i = 0; i < spin.length; ++i) spin[i] *= scale;

  const next = applySpin(state.mat, spin);
  // A drag of under two pixels is a click that wobbled, not a throw. Don't leave it spinning.
  return { mat: next, spin: magnitude < 2 ? null : spin };
}

/** Advance a momentum spin by one step. Returns the state unchanged when not spinning. */
export function continueSpin(state: RotationState): RotationState {
  if (!state.spin) return state;
  return { mat: applySpin(state.mat, state.spin), spin: state.spin };
}

export function stopSpinning(state: RotationState): RotationState {
  return state.spin ? { mat: state.mat, spin: null } : state;
}

/** `mat · gramschmidt(I + spin)`, re-orthonormalised. */
function applySpin(mat: Float64Array, spin: Float64Array): Float64Array {
  const delta = identity(N);
  for (let i = 0; i < delta.length; ++i) delta[i] += spin[i];
  return gramSchmidt(mxm(mat, gramSchmidt(delta), N));
}

/**
 * Gram-Schmidt orthonormalisation, in place on a copy.
 *
 * Applied after every update. Without it, repeated first-order steps would drift the matrix away
 * from the rotation group and the puzzle would visibly shear.
 */
export function gramSchmidt(m: Float64Array): Float64Array {
  const out = Float64Array.from(m);
  for (let i = 0; i < N; ++i) {
    for (let j = 0; j < i; ++j) {
      let dot = 0;
      for (let k = 0; k < N; ++k) dot += out[i * N + k] * out[j * N + k];
      for (let k = 0; k < N; ++k) out[i * N + k] -= dot * out[j * N + k];
    }
    let norm = 0;
    for (let k = 0; k < N; ++k) norm += out[i * N + k] * out[i * N + k];
    norm = Math.sqrt(norm);
    if (norm > 1e-12) for (let k = 0; k < N; ++k) out[i * N + k] /= norm;
  }
  return out;
}

/**
 * A rotation carrying unit vector `from` onto unit vector `to`, by `fraction` of the way.
 *
 * Used for "bring this cell to the centre": the clicked point is slerped onto the −W axis, which is
 * the direction the viewer looks along in 4D.
 */
export function rotateTowards(from: Float64Array, to: Float64Array, fraction: number): Float64Array {
  let dot = 0;
  for (let i = 0; i < N; ++i) dot += from[i] * to[i];
  dot = Math.max(-1, Math.min(1, dot));
  const angle = Math.acos(dot) * fraction;
  if (Math.abs(angle) < 1e-12) return identity(N);

  // Build an orthonormal pair spanning the rotation plane, then rotate within it.
  const perpendicular = new Float64Array(N);
  for (let i = 0; i < N; ++i) perpendicular[i] = to[i] - dot * from[i];
  let norm = 0;
  for (let i = 0; i < N; ++i) norm += perpendicular[i] * perpendicular[i];
  norm = Math.sqrt(norm);
  // Antipodal (or identical) vectors span no unique plane; any rotation would be arbitrary.
  if (norm < 1e-12) return identity(N);
  for (let i = 0; i < N; ++i) perpendicular[i] /= norm;

  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const out = identity(N);
  for (let i = 0; i < N; ++i) {
    for (let j = 0; j < N; ++j) {
      out[i * N + j] +=
        (c - 1) * (from[i] * from[j] + perpendicular[i] * perpendicular[j]) +
        s * (perpendicular[i] * from[j] - from[i] * perpendicular[j]);
    }
  }
  return out;
}
