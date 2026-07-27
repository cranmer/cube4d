/**
 * The handful of linear algebra routines the puzzle model actually needs.
 *
 * The original's VecMath.java is 3,572 lines of generic n-dimensional code; the twist path reaches
 * about fifteen functions of it. These are those, specialised to flat Float64Array matrices in
 * row-major order.
 *
 * CONVENTION: the original uses ROW vectors throughout — a point is transformed as `v · M`, not
 * `M · v`. That is the opposite of the column-vector convention used by WebGL and most graphics
 * code, and getting it backwards produces a puzzle that twists in plausible but wrong ways. The
 * convention is preserved here so this code can be checked directly against the Java; the renderer
 * transposes at the boundary.
 */

/** Row-vector times matrix: `result[j] = Σᵢ v[i] · m[i][j]`. Matches VecMath.vxm. */
export function vxm(out: Float64Array, v: Float64Array, m: Float64Array, n: number): Float64Array {
  for (let j = 0; j < n; ++j) {
    let sum = 0;
    for (let i = 0; i < n; ++i) sum += v[i] * m[i * n + j];
    out[j] = sum;
  }
  return out;
}

/** Same, reading `v` from an offset into a larger packed array. */
export function vxmAt(
  out: Float64Array,
  v: Float64Array,
  vOffset: number,
  m: Float64Array,
  n: number,
): Float64Array {
  for (let j = 0; j < n; ++j) {
    let sum = 0;
    for (let i = 0; i < n; ++i) sum += v[vOffset + i] * m[i * n + j];
    out[j] = sum;
  }
  return out;
}

/** Matrix product: `(a · b)[i][j] = Σₖ a[i][k] · b[k][j]`. */
export function mxm(a: Float64Array, b: Float64Array, n: number): Float64Array {
  const out = new Float64Array(n * n);
  for (let i = 0; i < n; ++i) {
    for (let j = 0; j < n; ++j) {
      let sum = 0;
      for (let k = 0; k < n; ++k) sum += a[i * n + k] * b[k * n + j];
      out[i * n + j] = sum;
    }
  }
  return out;
}

export function transpose(m: Float64Array, n: number): Float64Array {
  const out = new Float64Array(n * n);
  for (let i = 0; i < n; ++i) for (let j = 0; j < n; ++j) out[j * n + i] = m[i * n + j];
  return out;
}

export function identity(n: number): Float64Array {
  const out = new Float64Array(n * n);
  for (let i = 0; i < n; ++i) out[i * n + i] = 1;
  return out;
}

/**
 * Rotation by `radians` in the plane spanned by two axes, for row-vector application.
 * Mirrors VecMath.makeRowRotMat exactly, including the sign placement — note that the negative
 * sine sits at [toAxis][fromAxis], which is the transpose of the column-vector convention.
 */
export function makeRowRotMat(
  n: number,
  fromAxis: number,
  toAxis: number,
  radians: number,
): Float64Array {
  if (fromAxis === toAxis) throw new Error('makeRowRotMat: fromAxis must differ from toAxis');
  const m = identity(n);
  const s = Math.sin(radians);
  const c = Math.cos(radians);
  m[fromAxis * n + fromAxis] = c;
  m[fromAxis * n + toAxis] = s;
  m[toAxis * n + fromAxis] = -s;
  m[toAxis * n + toAxis] = c;
  return m;
}

/** Dot product of a packed row of `a` at `offset` with a packed row of `b` at `bOffset`. */
export function dotAt(
  a: Float64Array,
  aOffset: number,
  b: Float64Array,
  bOffset: number,
  n: number,
): number {
  let sum = 0;
  for (let i = 0; i < n; ++i) sum += a[aOffset + i] * b[bOffset + i];
  return sum;
}
