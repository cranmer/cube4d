/**
 * Interpolating 4D rotations, properly.
 *
 * Gliding the camera from one orientation to another needs a path through SO(4), and the cheap
 * approximations both fail in the same place. Blending the matrices and re-orthonormalising cannot
 * reverse a row, because Gram-Schmidt fixes lengths and not signs. Stepping along the antisymmetric
 * part of the relative rotation — the trick the drag integrator uses, and a good one for small
 * increments — recovers `sin θ` times each plane's generator, and `sin θ` is zero at θ = π just as
 * surely as at θ = 0. Both therefore stall on half-turns, and half-turns are precisely what separate
 * one axis-aligned viewpoint from another. It is the common case, not a corner case.
 *
 * The correct tool is a fact peculiar to four dimensions. Identify R⁴ with the quaternions; then
 * every rotation is `v ↦ L·v·R` for a pair of unit quaternions, and every such pair is a rotation.
 * (Only the pair's overall sign is ambiguous: `(L, R)` and `(−L, −R)` give the same rotation.) So
 * interpolating a 4D rotation is just slerping two quaternions independently — exact at both ends,
 * constant angular speed in between, and no singularity anywhere.
 *
 * Four dimensions is the only place this works. There is no analogous factorisation in five.
 */

const N = 4;

/** `[w, x, y, z]`, identified with `w + xi + yj + zk`. */
export type Quat = readonly [number, number, number, number];

export function quatMul(a: Quat, b: Quat): Quat {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}

export function quatConj(q: Quat): Quat {
  return [q[0], -q[1], -q[2], -q[3]];
}

function quatNormalize(q: Quat): Quat {
  const n = Math.hypot(q[0], q[1], q[2], q[3]);
  return n < 1e-12 ? [1, 0, 0, 0] : [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

function quatDot(a: Quat, b: Quat): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
}

/**
 * Spherical linear interpolation along the arc from `a` to `b` **exactly as given**.
 *
 * Deliberately not the usual "flip `b` if the dot product is negative" convenience. A 4D rotation
 * is a *pair* of quaternions, and only the pair's overall sign may be changed — flipping one factor
 * on its own names a different rotation. A slerp that silently chose signs would therefore be
 * unusable for the one caller that matters. `interpolateRotation` makes the choice jointly instead.
 */
export function slerp(a: Quat, b: Quat, t: number): Quat {
  const dot = Math.max(-1, Math.min(1, quatDot(a, b)));
  // Nearly parallel: the arc is shorter than the error in computing it, so interpolate linearly.
  if (dot > 0.9995) {
    return quatNormalize([
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t,
      a[3] + (b[3] - a[3]) * t,
    ]);
  }
  const theta = Math.acos(dot);
  const sin = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sin;
  const wb = Math.sin(t * theta) / sin;
  return [
    a[0] * wa + b[0] * wb,
    a[1] * wa + b[1] * wb,
    a[2] * wa + b[2] * wb,
    a[3] * wa + b[3] * wb,
  ];
}

/**
 * The rotation `v ↦ L·v·R`, as a row-major matrix in this project's row-vector convention (`v · M`).
 *
 * Built by applying the map to each basis vector rather than by expanding the product symbolically,
 * which leaves no sign convention to get wrong.
 */
export function matrixFromPair(left: Quat, right: Quat): Float64Array {
  const mat = new Float64Array(N * N);
  for (let i = 0; i < N; ++i) {
    const basis: Quat = [i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0, i === 3 ? 1 : 0];
    const image = quatMul(quatMul(left, basis), right);
    // Row i is where basis vector i lands — exactly what `v · M` means.
    for (let j = 0; j < N; ++j) mat[i * N + j] = image[j];
  }
  return mat;
}

/**
 * Factor a rotation into its quaternion pair — the inverse of `matrixFromPair`.
 *
 * Rather than the usual associate-matrix construction, this peels the factors off one at a time,
 * which needs no tabulated sign conventions and reuses a routine everyone already trusts:
 *
 *   1. `M` sends `1` to `L·R`, so column zero of the map gives the product `q₀ = L·R` outright.
 *   2. Right-multiplying by `conj(q₀)` leaves `v ↦ L·v·conj(L)`, which fixes `1` and acts on the
 *      imaginary part as an ordinary 3D rotation.
 *   3. `L` is that 3D rotation's quaternion, read off by the standard largest-diagonal method.
 *   4. `R = conj(L)·q₀`.
 *
 * The returned pair is normalised, and its overall sign is unspecified — both `(L, R)` and
 * `(−L, −R)` are correct answers.
 */
export function pairFromMatrix(mat: Float64Array | readonly number[]): { left: Quat; right: Quat } {
  const apply = (v: Quat): Quat => {
    const out: [number, number, number, number] = [0, 0, 0, 0];
    for (let j = 0; j < N; ++j) for (let i = 0; i < N; ++i) out[j] += v[i] * mat[i * N + j];
    return out;
  };

  const q0 = apply([1, 0, 0, 0]);
  const inverseQ0 = quatConj(q0);

  // The residual map v ↦ L·v·conj(L), as a 3x3 acting on (i, j, k).
  const r = new Float64Array(9);
  for (let i = 0; i < 3; ++i) {
    const basis: Quat = [0, i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0];
    const image = quatMul(apply(basis), inverseQ0);
    for (let j = 0; j < 3; ++j) r[i * 3 + j] = image[j + 1];
  }

  const left = quatNormalize(quatFrom3x3(r));
  return { left, right: quatNormalize(quatMul(quatConj(left), q0)) };
}

/**
 * A 3D rotation's quaternion, branching on the largest diagonal term.
 *
 * The naive formula divides by `sqrt(1 + trace)`, which vanishes for a 180° turn — the same failure
 * that motivated this whole module. Choosing the branch by largest diagonal keeps the divisor well
 * away from zero for every rotation.
 *
 * `r` is row-major with the same row-vector convention as everything else here.
 */
function quatFrom3x3(r: Float64Array): Quat {
  const m = (i: number, j: number) => r[i * 3 + j];
  const trace = m(0, 0) + m(1, 1) + m(2, 2);
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    return [s / 4, (m(1, 2) - m(2, 1)) / s, (m(2, 0) - m(0, 2)) / s, (m(0, 1) - m(1, 0)) / s];
  }
  if (m(0, 0) > m(1, 1) && m(0, 0) > m(2, 2)) {
    const s = Math.sqrt(1 + m(0, 0) - m(1, 1) - m(2, 2)) * 2;
    return [(m(1, 2) - m(2, 1)) / s, s / 4, (m(1, 0) + m(0, 1)) / s, (m(2, 0) + m(0, 2)) / s];
  }
  if (m(1, 1) > m(2, 2)) {
    const s = Math.sqrt(1 + m(1, 1) - m(0, 0) - m(2, 2)) * 2;
    return [(m(2, 0) - m(0, 2)) / s, (m(1, 0) + m(0, 1)) / s, s / 4, (m(2, 1) + m(1, 2)) / s];
  }
  const s = Math.sqrt(1 + m(2, 2) - m(0, 0) - m(1, 1)) * 2;
  return [(m(0, 1) - m(1, 0)) / s, (m(2, 0) + m(0, 2)) / s, (m(2, 1) + m(1, 2)) / s, s / 4];
}

/**
 * The rotation `t` of the way from `from` to `to`, along the shortest path.
 *
 * `t = 0` returns `from` and `t = 1` returns `to`, both exactly. Everything between is a genuine
 * rotation traversed at constant angular speed, with no orientation the path cannot reach.
 */
export function interpolateRotation(
  from: Float64Array | readonly number[],
  to: Float64Array | readonly number[],
  t: number,
): Float64Array {
  const a = pairFromMatrix(from);
  const b = pairFromMatrix(to);
  // (L, R) and (−L, −R) name the same rotation, so there are exactly two candidate destinations.
  // Take the one whose factors are jointly nearer, which is what makes the glide take the short way
  // round. Flipping only one factor would name a different rotation entirely, so they move together.
  const flip = quatDot(a.left, b.left) + quatDot(a.right, b.right) < 0;
  const bLeft: Quat = flip ? [-b.left[0], -b.left[1], -b.left[2], -b.left[3]] : b.left;
  const bRight: Quat = flip ? [-b.right[0], -b.right[1], -b.right[2], -b.right[3]] : b.right;
  return matrixFromPair(slerp(a.left, bLeft, t), slerp(a.right, bRight, t));
}
