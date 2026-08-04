/**
 * Unfolding a hypercube into three dimensions.
 *
 * A cube's six square faces unfold into a flat cross; a hypercube's eight cubic cells unfold into a
 * solid one — the shape Dalí painted. The point of drawing a puzzle this way is that every cell
 * becomes a genuine, undistorted 3×3×3 cube, all eight are visible at once, and nothing is hidden
 * behind a projection. What it costs is described in `netTearing` below.
 *
 * The construction, in the same terms as the 2D case:
 *
 *   - One cell sits at the centre. Which one is arbitrary, and is the caller's choice.
 *   - The six cells whose normals are perpendicular to the centre's are its neighbours in the net,
 *     one on each of the centre cube's six faces. In four dimensions a cell touches every cell but
 *     its own opposite, so these six are exactly "all the others except one".
 *   - The last cell — the centre's opposite — has nowhere to attach except beyond one of those six.
 *     Which one is again arbitrary, and again the caller's choice. It is the arm that ends up two
 *     cubes long, the same way a cube's net has one arm of four squares.
 *
 * Each cell is carried into the common hyperplane by a rotation, which is what "unfolding" means
 * once you write it down: a neighbour turns a quarter turn in the plane its normal shares with the
 * centre's, and the far cell turns a half turn in that same plane, because it has been rolled twice.
 * Rotating about the origin rather than about the shared face leaves every cell stacked on the
 * centre; translating each one out by the cell width puts it exactly where a real unfolding would.
 * Translating by more than the cell width opens the gaps that let you see the middle cube.
 */

import type { PuzzleGeometry } from './asset.js';
import { identity, makeRowRotMat, vxm } from './vecmath.js';

/** Where one cell goes, and how it has to be turned to get there. */
export interface NetCell {
  /** Index of the cell, matching `sticker2face`. */
  readonly face: number;
  /**
   * The unfolding rotation, row-major and row-vector like everything else here: `v · matrix`.
   * Always a rotation, never a reflection — see the tests, which is where that is enforced.
   */
  readonly matrix: Float64Array;
  /** Where the cell sits once unfolded, in the reduced 3D coordinates. */
  readonly offset: readonly [number, number, number];
  /** Its role in the cross, for anything that wants to label or animate it. */
  readonly role: 'centre' | 'neighbour' | 'far';
}

export interface NetLayout {
  readonly cells: readonly NetCell[];
  /** The axis dropped when reducing 4D to 3D: every cell lands at a constant value of it. */
  readonly droppedAxis: number;
  /** Index into a cell's 4D coordinates for each of the three reduced ones. */
  readonly keptAxes: readonly [number, number, number];
}

/** Which coordinate axis a cell's normal lies on, and which way it points. */
function normalAxis(geo: PuzzleGeometry, face: number): { axis: number; sign: number } {
  const n = geo.nDims;
  let axis = -1;
  let sign = 0;
  let best = 0;
  for (let i = 0; i < n; ++i) {
    const c = geo.faceInwardNormals[face * n + i];
    if (Math.abs(c) > best) {
      best = Math.abs(c);
      axis = i;
      sign = Math.sign(c);
    }
  }
  if (best < 0.99) {
    throw new Error(
      `cell ${face} does not sit on a coordinate axis, so it cannot be unfolded this way`,
    );
  }
  // Inward normals point at the puzzle's middle, so the cell itself is the other way.
  return { axis, sign: -sign };
}

/**
 * A rotation in the (from, to) plane carrying the unit vector `sign·e_from` onto `toSign·e_to`.
 *
 * The sign of the angle is chosen by trying one and checking, rather than reasoned out. Row-vector
 * conventions and inward normals give four chances to be off by a sign, and a wrong one here is a
 * cell that unfolds the long way round — visibly wrong, but only once everything else is built.
 */
function quarterOnto(
  n: number,
  from: number,
  fromSign: number,
  to: number,
  toSign: number,
): Float64Array {
  for (const angle of [Math.PI / 2, -Math.PI / 2]) {
    const m = makeRowRotMat(n, from, to, angle);
    const v = new Float64Array(n);
    v[from] = fromSign;
    const image = vxm(new Float64Array(n), v, m, n);
    if (Math.abs(image[to] - toSign) < 1e-9) return m;
  }
  throw new Error(`no quarter turn takes axis ${from} onto axis ${to}`);
}

/**
 * Lay the eight cells of a hypercube out as a solid cross.
 *
 * @param centreFace which cell sits in the middle
 * @param armFace    which of the centre's neighbours the far cell is attached beyond
 * @param spacing    centre-to-centre distance between adjacent cells, in cell widths. 1 is a true
 *                   unfolding with the cells touching; more than 1 opens the gaps.
 */
export function netLayout(
  geo: PuzzleGeometry,
  centreFace: number,
  armFace: number,
  spacing = 1,
): NetLayout {
  const n = geo.nDims;
  if (n !== 4 || geo.nFaces !== 8) {
    throw new Error(`the solid cross is a hypercube layout; this puzzle has ${geo.nFaces} cells`);
  }
  const opposite = geo.face2OppositeFace[centreFace];
  if (armFace === centreFace || armFace === opposite) {
    throw new Error('the far cell must be attached beyond one of the centre cell\'s neighbours');
  }

  const centre = normalAxis(geo, centreFace);
  const arm = normalAxis(geo, armFace);
  const keptAxes = [0, 1, 2, 3].filter((a) => a !== centre.axis) as unknown as [
    number,
    number,
    number,
  ];
  const reduced = (axis: number) => keptAxes.indexOf(axis);

  // A cell's width, so `spacing` can be given in cell widths rather than in whatever units the
  // exporter happened to use. Measured from the geometry rather than taken from `inRadius`, which
  // this asset format leaves at zero. A hypercube's cells are cubes of side twice the distance from
  // the puzzle's middle to a cell's middle: vertices at (±1,±1,±1,±1) put the cells at ±1 on each
  // axis and give each one a side of 2.
  let width = 0;
  for (let i = 0; i < n; ++i) {
    const c = geo.faceCenters[centreFace * n + i];
    width += c * c;
  }
  width = 2 * Math.sqrt(width);

  const cells: NetCell[] = [];
  for (let face = 0; face < geo.nFaces; ++face) {
    if (face === centreFace) {
      cells.push({ face, matrix: identity(n), offset: [0, 0, 0], role: 'centre' });
      continue;
    }
    const offset: [number, number, number] = [0, 0, 0];
    if (face === opposite) {
      // Rolled twice, over the arm neighbour: a half turn in the plane the arm shares with the
      // centre. A half turn is its own inverse either way round, so no sign to choose here.
      const matrix = makeRowRotMat(n, arm.axis, centre.axis, Math.PI);
      offset[reduced(arm.axis)] = 2 * spacing * width * arm.sign;
      cells.push({ face, matrix, offset, role: 'far' });
      continue;
    }
    const here = normalAxis(geo, face);
    const matrix = quarterOnto(n, here.axis, here.sign, centre.axis, centre.sign);
    offset[reduced(here.axis)] = spacing * width * here.sign;
    cells.push({ face, matrix, offset, role: 'neighbour' });
  }
  // Recentre. The long arm reaches two cells one way and one the other, so a cross built around the
  // middle cell sits off to one side of it — which a viewer reads as the whole thing being badly
  // framed rather than as the shape it is.
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const cell of cells) {
    for (let i = 0; i < 3; ++i) {
      lo[i] = Math.min(lo[i], cell.offset[i]);
      hi[i] = Math.max(hi[i], cell.offset[i]);
    }
  }
  const middle = [0, 1, 2].map((i) => (lo[i] + hi[i]) / 2);
  const centred = cells.map((cell) => ({
    ...cell,
    offset: cell.offset.map((v, i) => v - middle[i]) as unknown as readonly [
      number,
      number,
      number,
    ],
  }));

  return { cells: centred, droppedAxis: centre.axis, keptAxes };
}

/**
 * How much of a twist the net cannot show as a rigid motion.
 *
 * A twist is a rotation of the whole puzzle's 4-space, and the net has cut precisely the
 * connections it turns through, so stickers that cross from one cell to another have no honest
 * path across the gap. Measuring it is the difference between knowing that and guessing: on
 * `{4,3,3} 3` roughly two thirds of the stickers a twist moves change cell. Those are the ones an
 * unfolded view has to fade rather than move.
 */
export function netTearing(
  geo: PuzzleGeometry,
  permutation: Int32Array,
): { moved: number; crossed: number } {
  let moved = 0;
  let crossed = 0;
  for (let destination = 0; destination < permutation.length; ++destination) {
    const source = permutation[destination];
    if (source === destination) continue;
    moved++;
    if (geo.sticker2face[source] !== geo.sticker2face[destination]) crossed++;
  }
  return { moved, crossed };
}
