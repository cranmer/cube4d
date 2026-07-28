import { describe, expect, it } from 'vitest';

import { CANONICAL_VIEWS } from '../src/canonicalViews.js';
import { gramSchmidt, NICE_VIEW } from '../src/rotation.js';
import {
  interpolateRotation,
  matrixFromPair,
  pairFromMatrix,
  quatConj,
  quatMul,
  slerp,
  type Quat,
} from '../src/so4.js';

const N = 4;

/** Deterministic pseudo-random rotations, so a failure is always reproducible. */
function randomRotation(seed: number): Float64Array {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5;
  };
  const m = new Float64Array(N * N);
  for (let i = 0; i < m.length; ++i) m[i] = next();
  const out = gramSchmidt(m);
  // Gram-Schmidt preserves the sign of the determinant, so half the seeds give a reflection.
  if (determinant4(out) < 0) for (let j = 0; j < N; ++j) out[j] = -out[j];
  return gramSchmidt(out);
}

function determinant4(m: Float64Array | readonly number[]): number {
  const minor = (skipRow: number, skipCol: number) => {
    const v: number[] = [];
    for (let i = 0; i < N; ++i)
      for (let j = 0; j < N; ++j) if (i !== skipRow && j !== skipCol) v.push(m[i * N + j]);
    return (
      v[0] * (v[4] * v[8] - v[5] * v[7]) -
      v[1] * (v[3] * v[8] - v[5] * v[6]) +
      v[2] * (v[3] * v[7] - v[4] * v[6])
    );
  };
  let det = 0;
  for (let j = 0; j < N; ++j) det += (j % 2 ? -1 : 1) * m[j] * minor(0, j);
  return det;
}

function expectRotation(m: Float64Array, label: string) {
  expect(determinant4(m), `${label}: determinant`).toBeCloseTo(1, 9);
  for (let i = 0; i < N; ++i) {
    for (let j = 0; j < N; ++j) {
      let dot = 0;
      for (let k = 0; k < N; ++k) dot += m[i * N + k] * m[j * N + k];
      expect(dot, `${label}: rows ${i}·${j}`).toBeCloseTo(i === j ? 1 : 0, 9);
    }
  }
}

function expectMatricesClose(a: Float64Array, b: Float64Array | readonly number[], label: string) {
  for (let i = 0; i < N * N; ++i) expect(a[i], `${label}: entry ${i}`).toBeCloseTo(b[i], 9);
}

describe('quaternion arithmetic', () => {
  it('multiplies as Hamilton did', () => {
    const i: Quat = [0, 1, 0, 0];
    const j: Quat = [0, 0, 1, 0];
    const k: Quat = [0, 0, 0, 1];
    expect(quatMul(i, j)).toEqual(k);
    expect(quatMul(j, k)).toEqual(i);
    expect(quatMul(k, i)).toEqual(j);
    // i² = j² = k² = ijk = −1, the relation Hamilton cut into Broom Bridge.
    expect(quatMul(i, i)).toEqual([-1, 0, 0, 0]);
    expect(quatMul(quatMul(i, j), k)).toEqual([-1, 0, 0, 0]);
  });

  it('slerps between the endpoints exactly, at constant speed', () => {
    const a: Quat = [1, 0, 0, 0];
    const b: Quat = [Math.SQRT1_2, Math.SQRT1_2, 0, 0];
    slerp(a, b, 0).forEach((x, i) => expect(x).toBeCloseTo(a[i], 12));
    slerp(a, b, 1).forEach((x, i) => expect(x).toBeCloseTo(b[i], 12));
    // Halfway should be halfway in angle, not in coordinates.
    const half = slerp(a, b, 0.5);
    expect(Math.acos(half[0])).toBeCloseTo(Math.acos(b[0]) / 2, 12);
  });

  it('follows the arc it is given rather than choosing signs', () => {
    // Sign choice belongs to interpolateRotation, which must move both factors of a pair together.
    const a: Quat = [1, 0, 0, 0];
    const b: Quat = [Math.SQRT1_2, Math.SQRT1_2, 0, 0];
    const negated: Quat = [-b[0], -b[1], -b[2], -b[3]];
    const long = slerp(a, negated, 0.5);
    const short = slerp(a, b, 0.5);
    // The long way round is a genuinely different midpoint, and slerp reports it faithfully.
    expect(Math.acos(Math.abs(long[0]))).toBeGreaterThan(Math.acos(Math.abs(short[0])));
  });
});

describe('factoring a 4D rotation into two quaternions', () => {
  it('round-trips every canonical view', () => {
    for (const view of CANONICAL_VIEWS) {
      const mat = Float64Array.from(view.mat);
      const { left, right } = pairFromMatrix(mat);
      expectMatricesClose(matrixFromPair(left, right), mat, view.id);
    }
  });

  it('round-trips random rotations, including the awkward ones', () => {
    for (let seed = 1; seed <= 200; ++seed) {
      const mat = randomRotation(seed);
      const { left, right } = pairFromMatrix(mat);
      expectMatricesClose(matrixFromPair(left, right), mat, `seed ${seed}`);
    }
  });

  it('round-trips a half-turn, the case that defeated the cheaper methods', () => {
    // diag(−1, −1, 1, 1) is a rotation by π in the XY plane. Its antisymmetric part is zero, so a
    // first-order generator sees no rotation to do at all.
    const halfTurn = Float64Array.from([-1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const { left, right } = pairFromMatrix(halfTurn);
    expectMatricesClose(matrixFromPair(left, right), halfTurn, 'half turn');
  });

  it('produces unit quaternions', () => {
    for (let seed = 1; seed <= 50; ++seed) {
      const { left, right } = pairFromMatrix(randomRotation(seed));
      expect(Math.hypot(...left), `seed ${seed} left`).toBeCloseTo(1, 12);
      expect(Math.hypot(...right), `seed ${seed} right`).toBeCloseTo(1, 12);
    }
  });

  it('maps every unit pair to a rotation', () => {
    for (let seed = 1; seed <= 50; ++seed) {
      const a = pairFromMatrix(randomRotation(seed));
      const b = pairFromMatrix(randomRotation(seed + 1000));
      expectRotation(matrixFromPair(a.left, b.right), `mixed pair ${seed}`);
    }
  });

  it('agrees that conjugation by a unit quaternion fixes the real axis', () => {
    const l: Quat = [Math.SQRT1_2, 0, Math.SQRT1_2, 0];
    const mat = matrixFromPair(l, quatConj(l));
    // v ↦ l·v·conj(l) leaves 1 alone; it is an ordinary 3D rotation of the imaginary part.
    [...mat.slice(0, 4)].forEach((x, i) => expect(x).toBeCloseTo(i === 0 ? 1 : 0, 12));
    expectRotation(mat, 'conjugation');
  });
});

describe('interpolating between orientations', () => {
  const nice = gramSchmidt(Float64Array.from(NICE_VIEW));

  it('hits both endpoints exactly', () => {
    for (const view of CANONICAL_VIEWS) {
      expectMatricesClose(interpolateRotation(nice, view.mat, 0), nice, `${view.id} at t=0`);
      expectMatricesClose(interpolateRotation(nice, view.mat, 1), view.mat, `${view.id} at t=1`);
    }
  });

  it('stays a rotation the whole way, for every viewpoint', () => {
    for (const view of CANONICAL_VIEWS) {
      for (let step = 0; step <= 20; ++step) {
        expectRotation(interpolateRotation(nice, view.mat, step / 20), `${view.id} @ ${step}`);
      }
    }
  });

  it('actually moves — the failure the earlier attempts hid', () => {
    // Six of the eight axis-aligned viewpoints differ from the default by a rotation containing a
    // half-turn. Both cheaper schemes stalled on exactly these, so assert progress at every step.
    for (const view of CANONICAL_VIEWS.slice(1)) {
      const distances = [];
      for (let step = 0; step <= 10; ++step) {
        const m = interpolateRotation(nice, view.mat, step / 10);
        let worst = 0;
        for (let i = 0; i < N * N; ++i) worst = Math.max(worst, Math.abs(m[i] - view.mat[i]));
        distances.push(worst);
      }
      expect(distances[10], `${view.id} arrives`).toBeLessThan(1e-9);
      expect(distances[5], `${view.id} is en route at the halfway point`).toBeLessThan(
        distances[0] - 1e-6,
      );
    }
  });

  it('moves at a constant angular rate', () => {
    // Equal steps in t should cover equal angles. Measured as the angle of the relative rotation
    // between consecutive samples, via the trace.
    const target = CANONICAL_VIEWS.find((v) => v.id === 'ana')!.mat;
    const angles: number[] = [];
    for (let step = 0; step < 10; ++step) {
      const a = interpolateRotation(nice, target, step / 10);
      const b = interpolateRotation(nice, target, (step + 1) / 10);
      let trace = 0;
      for (let i = 0; i < N; ++i)
        for (let k = 0; k < N; ++k) trace += a[i * N + k] * b[i * N + k];
      angles.push(trace);
    }
    for (const t of angles) expect(t).toBeCloseTo(angles[0], 6);
  });
});
