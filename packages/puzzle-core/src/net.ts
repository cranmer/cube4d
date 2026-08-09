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
import { identity, makeRowRotMat, mxm, transpose, vxm } from './vecmath.js';

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
 * The determinant of the 3×3 that actually places a cell: from the cell's own 3-space into the frame
 * the net is read off in. The 4×4 unfold rotation is always +1; this block need not be, and −1
 * mirrors the cell — every sticker on it drawn in reverse, with its normals pointing inward, which
 * shows up as inside-out lighting rather than as anything recognisably geometric.
 *
 * Probed on one neighbour, which settles it for all of them: they differ by which axis they came
 * from, not by handedness. Measured rather than derived, because the rule depends on the middle
 * cell's axis *and* its sign, and getting it wrong mirrors exactly half the cuts.
 */
function reducedDeterminant(
  geo: PuzzleGeometry,
  centreFace: number,
  kept: readonly number[],
): number {
  const centre = cellAxis(geo, centreFace);
  const probe = [0, 1, 2, 3].find((a) => a !== centre.axis)!;
  const m = quarterOnto(4, probe, 1, centre.axis, centre.sign);
  const own = [0, 1, 2, 3].filter((a) => a !== probe);
  const b = own.map((r) => kept.map((k) => m[r * 4 + k]));
  return (
    b[0][0] * (b[1][1] * b[2][2] - b[1][2] * b[2][1]) -
    b[0][1] * (b[1][0] * b[2][2] - b[1][2] * b[2][0]) +
    b[0][2] * (b[1][0] * b[2][1] - b[1][1] * b[2][0])
  );
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
  // The three axes the net is built in, ordered so the reduced frame is right-handed.
  //
  // A cell is placed by reading off the kept coordinates of its rotated points, which is a 3×3 map
  // from the cell's own 3-space to this frame. The 4×4 rotation always has determinant +1, but that
  // 3×3 block need not: with the axes in their natural order it comes out −1 for one sign of the
  // middle cell and +1 for the other, and −1 mirrors every cell — visible as inside-out lighting on
  // the six cells a change of middle does not otherwise touch, since their normals point inward.
  // Swapping two axes flips the handedness back.
  const rising = [0, 1, 2, 3].filter((a) => a !== centre.axis);
  // Measured rather than derived. Which ordering is right-handed depends on the middle cell's axis
  // *and* its sign, and getting the rule wrong is silent: it mirrors exactly half the cuts, which
  // looks like a lighting fault rather than a geometric one.
  const keptAxes = rising as unknown as [number, number, number];
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

/**
 * Which cell sits on a signed axis, or -1.
 *
 * The inverse of `cellAxis`. Callers that think in axes — which is everything a person operates,
 * since `+X` means something and "face 3" does not — need this to get back to the index the
 * geometry is keyed by.
 */
export function faceOnAxis(geo: PuzzleGeometry, axis: number, sign: number): number {
  for (let face = 0; face < geo.nFaces; ++face) {
    const a = cellAxis(geo, face);
    if (a.axis === axis && a.sign === sign) return face;
  }
  return -1;
}

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

/** A cell named by the signed axis it sits on, which is how the controls talk about them. */
export interface CellRef {
  readonly axis: number;
  readonly sign: number;
}

/** A cut of the net: which cell is in the middle, and which neighbour the far cell hangs beyond. */
export interface Cut {
  readonly centre: CellRef;
  readonly arm: CellRef;
}

/** What one of the three controls does. */
export type Recut =
  | { readonly kind: 'fold'; readonly axis: number }
  | { readonly kind: 'middle' }
  | { readonly kind: 'arm'; readonly to: CellRef };

export interface NetTransition extends Cut {
  /**
   * The rotation of 4-space this re-cut is equivalent to, row-major and row-vector.
   *
   * It carries the *new* cut onto the old one, which is the direction that makes the pictures agree:
   * after a whole-puzzle twist the colour of cell F shows up on cell R(F), and after this re-cut
   * cell F sits where R(F) used to.
   */
  readonly matrix: Float64Array;
  /** The two axes it turns in, and by how much. Always a simple rotation. */
  readonly plane: readonly [number, number];
  readonly degrees: number;
}

const same = (a: CellRef, b: CellRef) => a.axis === b.axis && a.sign === b.sign;
const flip = (a: CellRef): CellRef => ({ axis: a.axis, sign: -a.sign });

/** Where a cell sits in a cut, without reference to any frame. */
function slot(cell: CellRef, cut: Cut): 'centre' | 'far' | 'side' {
  if (same(cell, cut.centre)) return 'centre';
  if (same(cell, flip(cut.centre))) return 'far';
  return 'side';
}

/** How a simple rotation moves a signed axis. */
function turn(cell: CellRef, i: number, j: number, degrees: number): CellRef {
  if (degrees === 180) {
    return cell.axis === i || cell.axis === j ? flip(cell) : cell;
  }
  const forward = degrees === 90;
  if (cell.axis === i) return { axis: j, sign: forward ? cell.sign : -cell.sign };
  if (cell.axis === j) return { axis: i, sign: forward ? -cell.sign : cell.sign };
  return cell;
}

const ALL_CELLS: readonly CellRef[] = [0, 1, 2, 3].flatMap((axis) =>
  [1, -1].map((sign) => ({ axis, sign })),
);

/**
 * The rotation a change of cut is equivalent to.
 *
 * Re-cutting the net and rotating the whole puzzle are the same operation seen from two sides. A
 * re-cut moves the cells and leaves the colours; a whole-puzzle twist — every layer selected, about
 * a cell's own face axis — moves the colours and leaves the cells. They produce the same picture,
 * which is why changing the cut can be animated as the twist it corresponds to rather than snapping.
 *
 * The rotation is always *simple*: a turn in one 2-plane, leaving the other two axes alone. That is
 * what a whole-puzzle twist is, and it is why the four cells on the long arm cycle while the four at
 * the sides sit still — the arm holds exactly the two axes the rotation turns in. Verified for every
 * control change from every one of the 48 cuts.
 *
 * The rotation chooses the new cut rather than the caller choosing it and hoping. Folding onto an
 * axis the long arm is already using has to move the arm, and only the rotation knows where to.
 */
export function netTransition(cut: Cut, action: Recut): NetTransition {
  // What the caller is entitled to pin down, and what the rotation is left to choose.
  //
  // Folding onto the axis the long arm is already using has to move the arm, and only the rotation
  // knows where to — so the arm is left free there and named everywhere else. The middle's sign is
  // preferred rather than required for the same reason: for some cuts, folding onto an axis is only
  // reachable by a turn that lands on the other end of it.
  const targets: { centre: CellRef | null; centreAxis: number; arm: CellRef | null }[] =
    action.kind === 'fold'
      ? [
          { centre: { axis: action.axis, sign: cut.centre.sign }, centreAxis: action.axis, arm: null },
          { centre: null, centreAxis: action.axis, arm: null },
        ]
      : action.kind === 'middle'
        ? [{ centre: flip(cut.centre), centreAxis: cut.centre.axis, arm: cut.arm }]
        : [{ centre: cut.centre, centreAxis: cut.centre.axis, arm: action.to }];

  for (const target of targets) {
    for (let i = 0; i < 4; ++i) {
      for (let j = i + 1; j < 4; ++j) {
        for (const degrees of [90, -90, 180]) {
          const R = (cell: CellRef) => turn(cell, i, j, degrees);
          // R carries the new cut onto the old one, so the new cut is what R sends there.
          const centre = ALL_CELLS.find((c) => same(R(c), cut.centre));
          const arm = ALL_CELLS.find((c) => same(R(c), cut.arm));
          if (!centre || !arm) continue;
          if (centre.axis !== target.centreAxis) continue;
          if (target.centre && !same(centre, target.centre)) continue;
          if (target.arm && !same(arm, target.arm)) continue;
          if (arm.axis === centre.axis) continue;
          // The picture test, which is the whole claim: every cell lands in the slot the rotation
          // would have carried its colour to.
          if (!ALL_CELLS.every((F) => slot(F, { centre, arm }) === slot(R(F), cut))) continue;
          return { centre, arm, matrix: rotationMatrix(i, j, degrees), plane: [i, j], degrees };
        }
      }
    }
  }
  throw new Error(`no simple rotation performs ${action.kind} on this cut`);
}

/** A simple rotation as a 4×4, row-major and row-vector, matching the rest of this file. */
function rotationMatrix(i: number, j: number, degrees: number): Float64Array {
  return makeRowRotMat(4, i, j, (degrees * Math.PI) / 180);
}

/**
 * The simple rotation carrying one cut to another, or null if there is none.
 *
 * The same relation `netTransition` finds, but between two cuts already decided rather than from a
 * control's intent. A viewport that is handed a new cut can use this to work out what motion it
 * should show without being told which button was pressed.
 */
export function netTransitionBetween(cut: Cut, next: Cut): NetTransition | null {
  for (let i = 0; i < 4; ++i) {
    for (let j = i + 1; j < 4; ++j) {
      for (const degrees of [90, -90, 180]) {
        const R = (cell: CellRef) => turn(cell, i, j, degrees);
        if (!same(R(next.centre), cut.centre) || !same(R(next.arm), cut.arm)) continue;
        if (!ALL_CELLS.every((F) => slot(F, next) === slot(R(F), cut))) continue;
        return {
          centre: next.centre,
          arm: next.arm,
          matrix: rotationMatrix(i, j, degrees),
          plane: [i, j],
          degrees,
        };
      }
    }
  }
  return null;
}

/**
 * The layout reached by turning the puzzle, rather than by re-deriving a cut from scratch.
 *
 * This is the fix for a bug that no predicate over `(centre, arm)` could have solved. Building each
 * cut independently re-derives the handedness of the frame every time, and gets it wrong for half of
 * them — every cell mirrored, normals pointing inward, which reads as bad lighting rather than as
 * bad geometry. The cut does not determine the handedness; the *path taken to reach it* does.
 *
 * So the state is a rotation applied to a layout already known to be right, and the frame is carried
 * along instead of recomputed. Every rotation preserves orientation, so no sequence of them can flip
 * it: the property holds by construction rather than by a check that has to be got right.
 *
 * It also makes the arrangement predictable in the way the controls want. The slots — the shape of
 * the cross, the kept axes, the long arm's direction — are fixed by the base layout and never move.
 * Turning the puzzle shuffles which cell occupies which slot, one step at a time.
 */
export function netStateLayout(
  geo: PuzzleGeometry,
  base: NetLayout,
  rotation: Float64Array,
): NetLayout {
  const n = geo.nDims;
  const cells = base.cells.map((slot) => {
    // Which cell the rotation brings into this slot: the one whose normal lands on this slot's.
    const normal = new Float64Array(n);
    for (let i = 0; i < n; ++i) normal[i] = -geo.faceInwardNormals[slot.face * n + i];
    const turned = vxm(new Float64Array(n), normal, rotation, n);
    let axis = 0;
    for (let i = 1; i < n; ++i) if (Math.abs(turned[i]) > Math.abs(turned[axis])) axis = i;
    const face = faceOnAxis(geo, axis, Math.sign(turned[axis]));
    // Carry the cell into this slot, then place it as the slot has always been placed. The product
    // of two rotations is a rotation, which is the whole point.
    return {
      face,
      matrix: mxm(transpose(rotation, n), slot.matrix, n),
      offset: slot.offset,
      role: slot.role,
    };
  });
  return { ...base, cells };
}
