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
  /** The reduced axis the long arm runs along, and which way along it the far cell lies. */
  readonly arm: { readonly axis: number; readonly sign: number };
  /** The axis dropped when reducing 4D to 3D: every cell lands at a constant value of it. */
  readonly droppedAxis: number;
  /** Index into a cell's 4D coordinates for each of the three reduced ones. */
  readonly keptAxes: readonly [number, number, number];
}

/**
 * Which coordinate axis a cell's normal lies on, and which way it points.
 *
 * The hypercube's eight cells sit one on each signed axis, so this is how a cell gets a name a
 * person can use — `+X`, `−W` — instead of the index it happens to have in the asset.
 */
export function cellAxis(geo: PuzzleGeometry, face: number): { axis: number; sign: number } {
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

  const centre = cellAxis(geo, centreFace);
  const arm = cellAxis(geo, armFace);
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
    const here = cellAxis(geo, face);
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

  return {
    cells: centred,
    arm: { axis: reduced(arm.axis), sign: arm.sign },
    droppedAxis: centre.axis,
    keptAxes,
  };
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

/** Axis names, in the order the puzzle's coordinates come in. */
export const AXIS_NAMES = ['X', 'Y', 'Z', 'W'] as const;

/** A cell's name as a signed axis: the label a person can match against what they are looking at. */
export function cellName(geo: PuzzleGeometry, face: number): string {
  const { axis, sign } = cellAxis(geo, face);
  return `${sign > 0 ? '+' : '\u2212'}${AXIS_NAMES[axis]}`;
}

/**
 * A view that stands the cross up, with the long arm vertical and the far cell at the bottom.
 *
 * The cross has one arm longer than the others, and it reads as a shape rather than as a heap when
 * that arm is the vertical one — the same reason a cube's net is drawn as an upright cross rather
 * than lying on its side. Which reduced axis the arm happens to fall on depends on which cell the
 * viewer put in the middle, so the view has to be derived from the layout rather than fixed.
 *
 * The two oblique turns afterwards are what make the cells read as cubes rather than as squares.
 * Both are about screen axes, and neither disturbs the vertical: a turn about the screen's vertical
 * axis leaves it alone outright, and a turn about the horizontal one foreshortens it but still
 * projects it straight up and down.
 *
 * Row-major, row-vector, ready for `setRotation`.
 */
export function netView(layout: NetLayout, turn = 0.52, tilt = 0.28): number[] {
  const n = 4;
  // Down the screen, so the long arm hangs rather than towers: the far cell is the odd one out and
  // belongs at the loose end.
  const target = [0, -1, 0];
  const from = [0, 0, 0];
  from[layout.arm.axis] = layout.arm.sign;

  const align = rotationTaking(from, target);
  const oblique = mxm3(rotation3(1, turn), rotation3(0, tilt));
  const r3 = mxm3(align, oblique);

  const out = new Array(n * n).fill(0);
  for (let i = 0; i < 3; ++i) for (let j = 0; j < 3; ++j) out[i * n + j] = r3[i * 3 + j];
  out[15] = 1;
  return out;
}

/** A rotation about coordinate axis `axis`, row-vector convention. */
function rotation3(axis: number, angle: number): number[] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const i = (axis + 1) % 3;
  const j = (axis + 2) % 3;
  const m = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  m[i * 3 + i] = c;
  m[i * 3 + j] = s;
  m[j * 3 + i] = -s;
  m[j * 3 + j] = c;
  return m;
}

function mxm3(a: readonly number[], b: readonly number[]): number[] {
  const out = new Array(9).fill(0);
  for (let i = 0; i < 3; ++i) {
    for (let j = 0; j < 3; ++j) {
      let sum = 0;
      for (let k = 0; k < 3; ++k) sum += a[i * 3 + k] * b[k * 3 + j];
      out[i * 3 + j] = sum;
    }
  }
  return out;
}

/** The shortest rotation carrying one unit vector onto another, row-vector convention. */
function rotationTaking(from: readonly number[], to: readonly number[]): number[] {
  const dot = from[0] * to[0] + from[1] * to[1] + from[2] * to[2];
  if (dot > 1 - 1e-9) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  if (dot < -1 + 1e-9) {
    // Antiparallel: a half turn about any perpendicular axis will do, so pick one that exists.
    const axis = Math.abs(from[0]) < 0.9 ? 0 : 1;
    return rotation3(axis, Math.PI);
  }
  const v = [
    from[1] * to[2] - from[2] * to[1],
    from[2] * to[0] - from[0] * to[2],
    from[0] * to[1] - from[1] * to[0],
  ];
  // Rodrigues, transposed into the row-vector convention the rest of this file uses. Written the
  // usual way round it turns the arm the other way, which puts the far cell at the top.
  const k = 1 / (1 + dot);
  const [x, y, z] = v;
  return [
    1 - k * (y * y + z * z), z + k * x * y, -y + k * x * z,
    -z + k * x * y, 1 - k * (x * x + z * z), x + k * y * z,
    y + k * x * z, -x + k * y * z, 1 - k * (x * x + y * y),
  ];
}

/**
 * The view matrix a 4-space compass should read when the puzzle is drawn unfolded.
 *
 * The compass works by asking where each puzzle axis lands on screen, which in a projection is
 * simply a row of the view matrix. Unfolded it is not: the net lays its cells out along the three
 * axes it kept, in *reduced* coordinates, so the axis a cell belongs to and the direction it sits
 * in are related by the layout rather than by identity. When the folded-away axis is W they happen
 * to coincide, which makes this look unnecessary until someone folds away X instead.
 *
 * Six of the eight cells sit exactly along their own signed axis, so their spokes point straight at
 * them. The remaining two are the pair on the folded-away axis, and are handled by pointing that
 * axis at the viewer: the compass already draws such an axis collapsed in the middle at the end
 * that faces away, and hides the end that faces you. Aimed so that the surviving end is the cell in
 * the middle of the cross — which is exactly where the compass draws it — the far cell's label is
 * the one dropped, and that is the honest outcome, since it is the one cell that does not lie along
 * any axis from the middle.
 */
export function netCompass(
  geo: PuzzleGeometry,
  layout: NetLayout,
  centreFace: number,
  viewMat: readonly number[],
): number[] {
  const n = 4;
  const out = new Array(n * n).fill(0);
  for (let axis = 0; axis < n; ++axis) {
    if (axis === layout.droppedAxis) {
      // Straight at the viewer, oriented so the end that survives is the middle cell.
      out[axis * n + 3] = -cellAxis(geo, centreFace).sign;
      continue;
    }
    const reduced = layout.keptAxes.indexOf(axis);
    for (let j = 0; j < 3; ++j) out[axis * n + j] = viewMat[reduced * n + j];
  }
  return out;
}
