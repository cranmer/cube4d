/**
 * The solid cross: does it actually unfold?
 *
 * These check the two things that would be invisible until everything else was built and then very
 * hard to attribute. First, that no cell comes out mirrored — a reflection would show every sticker
 * on that cell in mirror image, which reads as a scrambling bug rather than a layout one. Second,
 * that at spacing 1 the cells tile without overlapping, which is the definition of an unfolding and
 * the thing a wrong sign in the rotation would break.
 */

import { describe, expect, it } from 'vitest';

import { loadGeometry } from './fixtures.js';
import { cellAxis, cellName, faceOnAxis, netCompass, netStateLayout, netTransition, netLayout, netTearing, netTurn, netTween, netView } from '../src/net.js';
import { isValidTwist, numSlicesForGrip, permutationFor } from '../src/twist.js';
import { makeRowRotMat, mxm, vxm } from '../src/vecmath.js';
import { interpolateRotation } from '../src/so4.js';

const geo = loadGeometry('4-3-3_3');
const N = 4;

/** Every cell of the puzzle, placed by the layout, as reduced 3D points. */
function place(layout: ReturnType<typeof netLayout>) {
  const out = new Map<number, { xs: number[][]; dropped: number[] }>();
  for (const cell of layout.cells) {
    const xs: number[][] = [];
    const dropped: number[] = [];
    for (let s = 0; s < geo.nStickers; ++s) {
      if (geo.sticker2face[s] !== cell.face) continue;
      // Every vertex, not just sticker centres: the centres sit inside the cell, so their extent
      // is smaller than the cell and would not answer whether the cells tile.
      const begin = geo.stickerVertBegin[s];
      for (let k = 0; k < geo.stickerVertCount[s]; ++k) {
        const v = new Float64Array(N);
        for (let i = 0; i < N; ++i) {
          v[i] = geo.stickerCenters[s * N + i] + geo.vertsMinusStickerCenters[(begin + k) * N + i];
        }
        const r = vxm(new Float64Array(N), v, cell.matrix, N);
        dropped.push(r[layout.droppedAxis]);
        xs.push(layout.keptAxes.map((a, i) => r[a] + cell.offset[i]));
      }
    }
    out.set(cell.face, { xs, dropped });
  }
  return out;
}

const bounds = (xs: number[][]) => {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const p of xs) {
    for (let i = 0; i < 3; ++i) {
      lo[i] = Math.min(lo[i], p[i]);
      hi[i] = Math.max(hi[i], p[i]);
    }
  }
  return { lo, hi };
};

describe('the solid cross', () => {
  it('places all eight cells, one centre, six neighbours and one far', () => {
    const layout = netLayout(geo, 0, 2);
    expect(layout.cells).toHaveLength(8);
    const roles = layout.cells.map((c) => c.role);
    expect(roles.filter((r) => r === 'centre')).toHaveLength(1);
    expect(roles.filter((r) => r === 'neighbour')).toHaveLength(6);
    expect(roles.filter((r) => r === 'far')).toHaveLength(1);
    expect(new Set(layout.cells.map((c) => c.face)).size).toBe(8);
  });

  // The whole point of an unfolding: every cell ends up in one hyperplane, so the fourth
  // coordinate carries no information and can simply be dropped.
  it('lands every cell in one hyperplane', () => {
    const layout = netLayout(geo, 0, 2);
    const all: number[] = [];
    for (const { dropped } of place(layout).values()) all.push(...dropped);
    const first = all[0];
    for (const d of all) expect(d).toBeCloseTo(first, 9);
  });

  // A reflection would mirror every sticker on the cell. Determinant +1 is what rules it out.
  it('turns every cell rather than reflecting it', () => {
    for (const centre of [0, 3, 5, 7]) {
      for (const arm of [0, 1, 2, 3, 4, 5, 6, 7]) {
        if (arm === centre || arm === geo.face2OppositeFace[centre]) continue;
        for (const cell of netLayout(geo, centre, arm).cells) {
          expect(determinant4(cell.matrix), `cell ${cell.face} of centre ${centre}`).toBeCloseTo(
            1,
            9,
          );
          expect(isOrthogonal(cell.matrix), `cell ${cell.face} of centre ${centre}`).toBe(true);
        }
      }
    }
  });

  // At spacing 1 the cells touch and do not overlap: that is what makes it an unfolding rather
  // than eight cubes scattered near each other.
  it('tiles without overlapping at spacing 1', () => {
    const layout = netLayout(geo, 0, 2, 1);
    const placed = [...place(layout).entries()].map(([face, { xs }]) => ({ face, ...bounds(xs) }));
    // The same measure the layout uses, and for the same reason: `inRadius` is zero in this asset
    // format, so the cell width has to come from where the cell centres actually are.
    const width =
      2 * Math.hypot(...Array.from({ length: N }, (_, i) => geo.faceCenters[0 * N + i]));

    for (const cell of placed) {
      for (let i = 0; i < 3; ++i) {
        // Each cell is a cube of the same size, however it was turned to get here.
        expect(cell.hi[i] - cell.lo[i]).toBeCloseTo(width, 6);
      }
    }
    for (let a = 0; a < placed.length; ++a) {
      for (let b = a + 1; b < placed.length; ++b) {
        const gap = Math.max(
          ...[0, 1, 2].map((i) => Math.max(placed[a].lo[i] - placed[b].hi[i], placed[b].lo[i] - placed[a].hi[i])),
        );
        expect(gap, `cells ${placed[a].face} and ${placed[b].face} overlap`).toBeGreaterThan(-1e-6);
      }
    }
  });

  it('opens gaps when asked', () => {
    const extent = (spacing: number) => {
      const all: number[][] = [];
      for (const { xs } of place(netLayout(geo, 0, 2, spacing)).values()) all.push(...xs);
      const b = bounds(all);
      return b.hi.map((h, i) => h - b.lo[i]);
    };
    const tight = extent(1);
    const loose = extent(1.5);
    for (let i = 0; i < 3; ++i) expect(loose[i]).toBeGreaterThan(tight[i]);
  });

  // Off-centre reads as bad framing rather than as the shape it is, since the long arm reaches two
  // cells one way and one the other.
  it('centres the cross on the origin, whichever arm is long', () => {
    for (const arm of [1, 2, 3, 4, 5, 6]) {
      const all: number[][] = [];
      for (const { xs } of place(netLayout(geo, 0, arm, 1.35)).values()) all.push(...xs);
      const b = bounds(all);
      for (let i = 0; i < 3; ++i) {
        expect(Math.abs(b.lo[i] + b.hi[i]), `arm ${arm}, axis ${i}`).toBeLessThan(1e-6);
      }
    }
  });

  it('refuses a far cell that is not beyond a neighbour', () => {
    expect(() => netLayout(geo, 0, 0)).toThrow();
    expect(() => netLayout(geo, 0, geo.face2OppositeFace[0])).toThrow();
  });

  it('is a hypercube layout only', () => {
    expect(() => netLayout(loadGeometry('4-3_3'), 0, 2)).toThrow(/cells/);
  });
});

describe('what the net cannot show', () => {
  // Quantifies the cost of the layout, and pins it: if a change to the pick or twist rules ever
  // moved these numbers, the animation built on top of them would silently become wrong.
  it('has most moved stickers changing cell', () => {
    for (const [mask, expected] of [
      [1, 0.6],
      [7, 0.7],
    ] as const) {
      let moved = 0;
      let crossed = 0;
      for (let g = 0; g < geo.nGrips; ++g) {
        if (!isValidTwist(geo, g, mask) || numSlicesForGrip(geo, g) !== 3) continue;
        const t = netTearing(geo, permutationFor(geo, g, 1, mask));
        moved += t.moved;
        crossed += t.crossed;
      }
      expect(moved).toBeGreaterThan(0);
      expect(crossed / moved).toBeGreaterThan(expected);
    }
  });

  it('counts a twist that stays inside one cell as untorn', () => {
    const identityPerm = Int32Array.from({ length: geo.nStickers }, (_, i) => i);
    expect(netTearing(geo, identityPerm)).toEqual({ moved: 0, crossed: 0 });
  });
});

function determinant4(m: Float64Array): number {
  const a = (r: number, c: number) => m[r * 4 + c];
  let det = 0;
  for (let c = 0; c < 4; ++c) {
    const minor: number[] = [];
    for (let r = 1; r < 4; ++r) {
      for (let cc = 0; cc < 4; ++cc) if (cc !== c) minor.push(a(r, cc));
    }
    const d3 =
      minor[0] * (minor[4] * minor[8] - minor[5] * minor[7]) -
      minor[1] * (minor[3] * minor[8] - minor[5] * minor[6]) +
      minor[2] * (minor[3] * minor[7] - minor[4] * minor[6]);
    det += (c % 2 ? -1 : 1) * a(0, c) * d3;
  }
  return det;
}

function isOrthogonal(m: Float64Array): boolean {
  for (let i = 0; i < 4; ++i) {
    for (let j = 0; j < 4; ++j) {
      let dot = 0;
      for (let k = 0; k < 4; ++k) dot += m[i * 4 + k] * m[j * 4 + k];
      if (Math.abs(dot - (i === j ? 1 : 0)) > 1e-9) return false;
    }
  }
  return true;
}

describe('standing the cross up', () => {
  // The far cell belongs at the loose end of the long arm, and the long arm belongs vertical --
  // which reduced axis it falls on depends on which cell is in the middle, so the view has to come
  // from the layout. Checked for every legal combination, since a wrong sign would only show as a
  // cross lying on its side for some of them.
  it('puts the long arm straight down the screen, whichever cell is centred', () => {
    for (const centre of [0, 1, 2, 3, 4, 5, 6, 7]) {
      for (const arm of [0, 1, 2, 3, 4, 5, 6, 7]) {
        if (arm === centre || arm === geo.face2OppositeFace[centre]) continue;
        const layout = netLayout(geo, centre, arm, 1.35);
        const view = netView(layout);

        const screen = (offset: readonly [number, number, number]) => {
          const v = [offset[0], offset[1], offset[2], 0];
          return [0, 1, 2].map((j) => [0, 1, 2, 3].reduce((sum, i) => sum + v[i] * view[i * 4 + j], 0));
        };
        const middle = screen(layout.cells.find((c) => c.role === 'centre')!.offset);
        const far = screen(layout.cells.find((c) => c.role === 'far')!.offset);

        const label = `centre ${centre}, arm ${arm}`;
        // Straight down: no sideways drift at all, and below the middle rather than above it.
        expect(Math.abs(far[0] - middle[0]), `${label} drifts sideways`).toBeLessThan(1e-9);
        expect(far[1] - middle[1], `${label} puts the far cell above the middle`).toBeLessThan(0);
      }
    }
  });

  it('is a rotation, so the cells are not mirrored by the view either', () => {
    const view = netView(netLayout(geo, 0, 2, 1.35));
    expect(determinant4(Float64Array.from(view))).toBeCloseTo(1, 9);
    expect(isOrthogonal(Float64Array.from(view))).toBe(true);
  });

  it('leaves the fourth coordinate alone, since the net has none', () => {
    const view = netView(netLayout(geo, 0, 2, 1.35));
    for (let i = 0; i < 4; ++i) {
      expect(view[i * 4 + 3]).toBeCloseTo(i === 3 ? 1 : 0, 12);
      expect(view[3 * 4 + i]).toBeCloseTo(i === 3 ? 1 : 0, 12);
    }
  });
});

describe('naming cells', () => {
  it('round-trips a cell through its signed axis', () => {
    for (let f = 0; f < geo.nFaces; ++f) {
      const { axis, sign } = cellAxis(geo, f);
      expect(faceOnAxis(geo, axis, sign)).toBe(f);
    }
    // A hypercube has a cell on every signed axis, and nothing anywhere else.
    expect(faceOnAxis(geo, 3, 1)).toBeGreaterThanOrEqual(0);
    expect(faceOnAxis(loadGeometry('4-3_3'), 3, 1)).toBe(-1);
  });

  it('gives each cell its signed axis, all eight distinct', () => {
    const names = Array.from({ length: geo.nFaces }, (_, f) => cellName(geo, f));
    expect(new Set(names).size).toBe(8);
    expect(names.every((n) => /^[+\u2212][XYZW]$/.test(n))).toBe(true);
    // Opposite cells differ only in sign, which is what makes the names worth showing.
    for (let f = 0; f < geo.nFaces; ++f) {
      const other = cellName(geo, geo.face2OppositeFace[f]);
      expect(other.slice(1)).toBe(names[f].slice(1));
      expect(other[0]).not.toBe(names[f][0]);
    }
  });
});

describe('the compass, unfolded', () => {
  // Six of the eight cells sit along their own signed axis, so the spoke for that axis must point
  // at the cell. This is the part that is right by accident when the folded axis is W and wrong for
  // every other choice, which is the whole reason the remap exists.
  it('points each kept axis at the cell that sits on it', () => {
    for (const centre of [0, 2, 5, 7]) {
      const arm = [0, 1, 2, 3, 4, 5, 6, 7].find(
        (f) => f !== centre && f !== geo.face2OppositeFace[centre],
      )!;
      const layout = netLayout(geo, centre, arm, 1.35);
      const view = netView(layout);
      const compass = netCompass(geo, layout, centre, view);

      for (const cell of layout.cells) {
        if (cell.role !== 'neighbour') continue;
        const { axis, sign } = cellAxis(geo, cell.face);
        // Where the compass sends this cell's axis, on screen.
        const spoke = [0, 1].map((j) => sign * compass[axis * 4 + j]);
        // Where the cell actually is, on screen -- measured from the middle cell, not from the
        // origin. Recentring the cross moves the middle cell off the origin, so a neighbour's raw
        // offset carries a component along the long arm that has nothing to do with its own axis.
        const from = layout.cells.find((c) => c.role === 'centre')!.offset;
        const at = [0, 1].map((j) =>
          [0, 1, 2].reduce((sum, i) => sum + (cell.offset[i] - from[i]) * view[i * 4 + j], 0),
        );
        const dot = spoke[0] * at[0] + spoke[1] * at[1];
        const norms = Math.hypot(...spoke) * Math.hypot(...at);
        // Same direction, allowing for the spoke being a unit vector and the cell being further out.
        expect(dot / norms, `cell ${cellName(geo, cell.face)} of centre ${centre}`).toBeCloseTo(1, 6);
      }
    }
  });

  it('aims the folded-away axis at the viewer, surviving end at the middle cell', () => {
    const layout = netLayout(geo, 0, 2, 1.35);
    const compass = netCompass(geo, layout, 0, netView(layout));
    const { axis, sign } = cellAxis(geo, 0);
    expect(axis).toBe(layout.droppedAxis);
    // The compass fades a spoke by `1 - w`. The middle cell must survive; its opposite must not.
    expect(sign * compass[axis * 4 + 3]).toBeCloseTo(-1, 9);
    expect(-sign * compass[axis * 4 + 3]).toBeCloseTo(1, 9);
    // And it has no screen direction at all, which is what puts it in the middle.
    expect(compass[axis * 4]).toBeCloseTo(0, 9);
    expect(compass[axis * 4 + 1]).toBeCloseTo(0, 9);
  });
});

describe('gliding a Turn', () => {
  // The unfolded view eases between quarter turns through SO(4), the same interpolation the named
  // viewpoints use. Both ends fix the fourth axis, and the concern is whether the path between them
  // does: any W leaking in mid-glide would give the perspective divide something to divide by, and
  // the whole cross would swell and shrink as it turned. It should not -- rotations fixing an axis
  // form a subgroup, and a bi-invariant geodesic between two of its members stays inside it -- but
  // "should not" and "does not" are different claims about a shipped animation.
  it('never leaves the hyperplane the net lies in', () => {
    const layout = netLayout(geo, 0, 2, 1.35);
    for (let quarter = 1; quarter <= 4; ++quarter) {
      const from = Float64Array.from(netView(layout, 0.52 + (quarter - 1) * (Math.PI / 2)));
      const to = Float64Array.from(netView(layout, 0.52 + quarter * (Math.PI / 2)));
      for (let step = 0; step <= 20; ++step) {
        const mat = interpolateRotation(from, to, step / 20);
        for (let i = 0; i < 4; ++i) {
          expect(Math.abs(mat[i * 4 + 3] - (i === 3 ? 1 : 0)), `quarter ${quarter} at ${step}/20`)
            .toBeLessThan(1e-9);
          expect(Math.abs(mat[3 * 4 + i] - (i === 3 ? 1 : 0)), `quarter ${quarter} at ${step}/20`)
            .toBeLessThan(1e-9);
        }
      }
    }
  });

  it('takes the short way round, so a quarter turn looks like a quarter turn', () => {
    const layout = netLayout(geo, 0, 2, 1.35);
    const from = Float64Array.from(netView(layout, 0.52));
    const to = Float64Array.from(netView(layout, 0.52 + Math.PI / 2));
    // The angle swept by a point on the long arm, accumulated over the glide. A path the long way
    // round would total three quarters rather than one.
    const arm = layout.cells.find((c) => c.role === 'far')!.offset;
    let swept = 0;
    let previous: number[] | null = null;
    for (let step = 0; step <= 60; ++step) {
      const mat = interpolateRotation(from, to, step / 60);
      const at = [0, 1, 2].map((j) =>
        [0, 1, 2].reduce((sum, i) => sum + arm[i] * mat[i * 4 + j], 0),
      );
      if (previous) {
        const dot = at[0] * previous[0] + at[1] * previous[1] + at[2] * previous[2];
        const norms = Math.hypot(...at) * Math.hypot(...previous);
        swept += Math.acos(Math.min(1, Math.max(-1, dot / norms)));
      }
      previous = at;
    }
    expect(swept).toBeLessThan(Math.PI / 2 + 0.02);
  });
});

describe('a re-cut is a whole-puzzle rotation', () => {
  const CELLS = [0, 1, 2, 3].flatMap((axis) => [1, -1].map((sign) => ({ axis, sign })));
  const CUTS = CELLS.flatMap((centre) =>
    CELLS.filter((arm) => arm.axis !== centre.axis).map((arm) => ({ centre, arm })),
  );

  it('has one for every control change from every cut', () => {
    expect(CUTS).toHaveLength(48);
    for (const cut of CUTS) {
      for (const axis of [0, 1, 2, 3]) {
        if (axis === cut.centre.axis) continue;
        expect(() => netTransition(cut, { kind: 'fold', axis }), `fold ${axis}`).not.toThrow();
      }
      expect(() => netTransition(cut, { kind: 'middle' })).not.toThrow();
      for (const to of CELLS) {
        if (to.axis === cut.centre.axis) continue;
        if (to.axis === cut.arm.axis && to.sign === cut.arm.sign) continue;
        expect(() => netTransition(cut, { kind: 'arm', to }), `arm`).not.toThrow();
      }
    }
  });

  it('always turns in a single plane, by a quarter or a half', () => {
    for (const cut of CUTS) {
      const t = netTransition(cut, { kind: 'middle' });
      expect([90, -90, 180]).toContain(t.degrees);
      expect(t.plane[0]).not.toBe(t.plane[1]);
      // A rotation, not a reflection: the cells must not come out mirrored.
      expect(determinant4(t.matrix)).toBeCloseTo(1, 9);
      expect(isOrthogonal(t.matrix)).toBe(true);
    }
  });

  it('lands each control on the cut it was asked for', () => {
    for (const cut of CUTS) {
      for (const axis of [0, 1, 2, 3]) {
        if (axis === cut.centre.axis) continue;
        expect(netTransition(cut, { kind: 'fold', axis }).centre.axis).toBe(axis);
      }
      const middle = netTransition(cut, { kind: 'middle' });
      expect(middle.centre.axis).toBe(cut.centre.axis);
      expect(middle.centre.sign).toBe(-cut.centre.sign);
      for (const to of CELLS) {
        if (to.axis === cut.centre.axis) continue;
        if (to.axis === cut.arm.axis && to.sign === cut.arm.sign) continue;
        const t = netTransition(cut, { kind: 'arm', to });
        expect(t.arm).toEqual(to);
        expect(t.centre).toEqual(cut.centre);
      }
    }
  });

  // The case that started this. From the default cut, folding onto Z turns in the ZW plane -- the
  // plane the long arm lies in -- and has to move the arm, because the arm was using Z. Both ends of
  // Z are reachable, one directly and the other after Middle; the observed screenshot was +Z.
  it('reproduces the observed example', () => {
    const cut = { centre: { axis: 3, sign: -1 }, arm: { axis: 2, sign: -1 } };
    const folded = netTransition(cut, { kind: 'fold', axis: 2 });
    expect(folded.centre.axis).toBe(2);
    expect(folded.arm.axis).toBe(3);
    expect([...folded.plane].sort()).toEqual([2, 3]);
    expect(Math.abs(folded.degrees)).toBe(90);

    const observed = netTransition(folded, { kind: 'middle' });
    expect(observed.centre).toEqual({ axis: 2, sign: -folded.centre.sign });
    expect(Math.abs(observed.degrees)).toBe(180);
  });

  // The four cells on the long arm are the ones the rotation turns; the four at the sides are not.
  it('turns in the plane the long arm lies in, leaving the sides alone', () => {
    const cut = { centre: { axis: 3, sign: -1 }, arm: { axis: 2, sign: -1 } };
    const t = netTransition(cut, { kind: 'fold', axis: 2 });
    const onArm = [cut.centre.axis, cut.arm.axis].sort();
    expect([...t.plane].sort()).toEqual(onArm);
  });
});

describe('turning the puzzle instead of re-cutting it', () => {
  const base = netLayout(geo, 0, faceOnAxis(geo, 2, -1), 1.35);
  const I = identity4();

  /**
   * The determinant of the 3×3 that actually places a cell: from its own 3-space into the frame the
   * net is read off in. This is the quantity that was wrong, and the 4×4 test could not see it --
   * the 4×4 unfold rotation is always +1 while this block can be −1, which mirrors every sticker on
   * the cell and points its normals inward.
   */
  function placementDeterminant(layout: ReturnType<typeof netLayout>, cell: (typeof base.cells)[0]) {
    const normalAxis = [0, 1, 2, 3].find(
      (a) => Math.abs(geo.faceInwardNormals[cell.face * 4 + a]) > 0.5,
    )!;
    const outward = -Math.sign(geo.faceInwardNormals[cell.face * 4 + normalAxis]);
    const rest = [0, 1, 2, 3].filter((a) => a !== normalAxis);
    // Orient the cell's own 3-space by its outward normal: (normal, rest...) right-handed in 4D.
    const own = (normalAxis % 2 === 0) === (outward > 0) ? rest : [rest[1], rest[0], rest[2]];
    const m = own.map((r) => layout.keptAxes.map((k) => cell.matrix[r * 4 + k]));
    return (
      m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
      m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
      m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
    );
  }

  /** The six presses: the middle cube one step along each display axis, either way. */
  const PRESSES = base.keptAxes.flatMap((axis) =>
    [1, -1].map((way) => ({
      plane: [axis, base.droppedAxis] as const,
      radians: (way * Math.PI) / 2,
    })),
  );
  const MOVES = PRESSES.map((p) => makeRowRotMat(4, p.plane[0], p.plane[1], p.radians));

  it('never mirrors a cell, however far you walk', () => {
    let rotation = I;
    // A long deterministic walk: every press, repeatedly, in a pattern that revisits and diverges.
    for (let step = 0; step < 400; ++step) {
      rotation = mxm(rotation, MOVES[(step * 7 + (step % 5)) % MOVES.length], 4);
      const layout = netStateLayout(geo, base, rotation);
      expect(new Set(layout.cells.map((c) => c.face)).size, `step ${step}`).toBe(8);
      for (const cell of layout.cells) {
        expect(placementDeterminant(layout, cell), `step ${step}, cell ${cell.face}`).toBeCloseTo(1, 6);
      }
    }
  });

  // The point of the base layout being the one that is known good: it is what everything inherits.
  it('agrees with the base layout when nothing has been turned', () => {
    const still = netStateLayout(geo, base, I);
    expect(still.cells.map((c) => c.face)).toEqual(base.cells.map((c) => c.face));
    expect(still.cells.map((c) => [...c.offset])).toEqual(base.cells.map((c) => [...c.offset]));
  });

  // The slots never move; the cells move through them. That is what makes the controls predictable.
  it('keeps the cross fixed and shuffles the cells through it', () => {
    const turned = netStateLayout(geo, base, MOVES[0]);
    expect(turned.cells.map((c) => [...c.offset])).toEqual(base.cells.map((c) => [...c.offset]));
    expect(turned.cells.map((c) => c.role)).toEqual(base.cells.map((c) => c.role));
    // Four cells change slot -- the ones on the plane being turned -- and four stay.
    const moved = turned.cells.filter((c, i) => c.face !== base.cells[i].face);
    expect(moved).toHaveLength(4);
  });

  /**
   * The other thing that can be done to the middle cube: turned about one of its own axes rather
   * than moved to another slot. The plane is two of the cross's three, so the folded-away axis is
   * left alone — and the two cells on it are the middle one and the one at the end of the long arm.
   */
  it('keeps the middle and the far cube in place when turned about an axis of its own', () => {
    const still = netStateLayout(geo, base, I).cells;
    for (let i = 0; i < 3; ++i) {
      for (let j = i + 1; j < 3; ++j) {
        for (const way of [1, -1]) {
          const plane = [base.keptAxes[i], base.keptAxes[j]] as const;
          const turned = netStateLayout(geo, base, netTurn(I, plane, (way * Math.PI) / 2)).cells;
          const kept = turned.filter((c, s) => c.face === still[s].face);
          expect(kept, `plane ${plane}`).toHaveLength(4);
          // The two on the folded-away axis are always among them, whichever plane was turned.
          for (const role of ['centre', 'far'] as const) {
            const slot = still.findIndex((c) => c.role === role);
            expect(turned[slot].face, `${role} in plane ${plane}`).toBe(still[slot].face);
          }
        }
      }
    }
  });

  /**
   * A press is named for places in the cross, so it has to mean the same thing every time. Composed
   * in the puzzle's frame instead of the cross's it does not: the first press behaves, the second
   * turns about an axis the first one carried off somewhere, and the third rolls the whole cross
   * bodily. All three are real moves; only the first is the one the button says.
   */
  it('moves the same slots however much has been pressed before', () => {
    /** Where the cell in each slot goes: the permutation of slots a press performs. */
    const shuffle = (before: Float64Array, press: (typeof PRESSES)[0]) => {
      const was = netStateLayout(geo, base, before).cells.map((c) => c.face);
      const now = netStateLayout(
        geo,
        base,
        netTurn(before, press.plane, press.radians),
      ).cells.map((c) => c.face);
      return was.map((face) => now.indexOf(face));
    };

    for (const press of PRESSES) {
      const fresh = shuffle(I, press);
      // Four slots keep their cell and four pass it on, which is what a press is.
      expect(fresh.filter((to, from) => to === from)).toHaveLength(4);

      let history = I;
      for (let step = 0; step < 40; ++step) {
        const previous = PRESSES[(step * 3 + (step % 4)) % PRESSES.length];
        history = netTurn(history, previous.plane, previous.radians);
        expect(shuffle(history, press), `after ${step + 1} presses`).toEqual(fresh);
      }
    }
  });
});

/**
 * The motion between two arrangements.
 *
 * The thing being guarded is that the cells stay solid. The first version of this animation ran the
 * 4D rotation through the twist uniform, which unfolded draws a moving cell's shadow rather than the
 * cell: it flattens as it turns out of the net's hyperplane and springs back at the end. Nothing
 * about the endpoints could catch that, since the endpoints were right -- only the frames between.
 */
describe('moving between arrangements', () => {
  const base = netLayout(geo, faceOnAxis(geo, 3, -1), faceOnAxis(geo, 2, -1), 1.35);
  const I = identity4();

  /** The six presses: the middle cube one step along each display axis, either way. */
  const MOVES = base.keptAxes.flatMap((axis) =>
    [1, -1].map((way) => makeRowRotMat(4, axis, base.droppedAxis, (way * Math.PI) / 2)),
  );
  const STEPS = [0, 0.07, 0.2, 0.35, 0.5, 0.64, 0.8, 0.93, 1];

  const byFace = (layout: ReturnType<typeof netLayout>) =>
    new Map(layout.cells.map((c) => [c.face, c]));

  it('begins and ends on the two arrangements it is between', () => {
    for (const move of MOVES) {
      const tween = netTween(geo, base, I, move);
      for (const [t, rotation] of [
        [0, I],
        [1, move],
      ] as const) {
        const got = byFace(tween(t));
        for (const want of netStateLayout(geo, base, rotation).cells) {
          const cell = got.get(want.face)!;
          expect([...cell.offset]).toEqual(want.offset.map((v) => expect.closeTo(v, 9)));
          expect([...cell.matrix]).toEqual([...want.matrix].map((v) => expect.closeTo(v, 9)));
        }
      }
    }
  });

  it('keeps every cell solid the whole way', () => {
    for (const move of MOVES) {
      const tween = netTween(geo, base, I, move);
      const rest = place(tween(0));
      for (const t of STEPS) {
        const layout = tween(t);
        const placed = place(layout);
        // Every cell in the same hyperplane, at every moment: a cell part way out of it would be
        // drawn as its own shadow, which is exactly the flattening this replaced.
        const depths = [...placed.values()].flatMap((c) => c.dropped);
        for (const d of depths) expect(d, `t ${t}`).toBeCloseTo(depths[0], 9);
        // And rigid: a vertex keeps its distance from every other vertex on its cell.
        for (const [face, { xs }] of placed) {
          const was = rest.get(face)!.xs;
          for (let i = 0; i < xs.length; i += 37) {
            for (let j = i + 1; j < xs.length; j += 53) {
              const now = Math.hypot(...xs[i].map((v, k) => v - xs[j][k]));
              const then = Math.hypot(...was[i].map((v, k) => v - was[j][k]));
              expect(now, `cell ${face} at t ${t}`).toBeCloseTo(then, 9);
            }
          }
        }
      }
    }
  });

  // What makes a press readable: half the cross is standing still, and nothing that moves goes
  // anywhere but into a slot another cell has just left.
  it('moves four cells and spins the other four where they stand', () => {
    for (const move of MOVES) {
      const tween = netTween(geo, base, I, move);
      const before = place(tween(0));
      const after = byFace(tween(1));
      const still = [...byFace(tween(0)).values()].filter(
        (c) => Math.hypot(...c.offset.map((v, i) => v - after.get(c.face)!.offset[i])) < 1e-9,
      );
      expect(still).toHaveLength(4);
      // Standing still is not the same as not moving: those four spin a quarter turn in place.
      const ends = place(tween(1));
      for (const cell of still) {
        const travel = before
          .get(cell.face)!
          .xs.map((p, i) => Math.hypot(...p.map((v, k) => v - ends.get(cell.face)!.xs[i][k])));
        expect(Math.max(...travel)).toBeGreaterThan(0.5);
      }
      // And every slot is still occupied, so nothing has been left doubled up or empty.
      expect(new Set([...after.values()].map((c) => c.offset.join(','))).size).toBe(8);
    }
  });
});

function identity4(): Float64Array {
  const m = new Float64Array(16);
  for (let i = 0; i < 4; ++i) m[i * 4 + i] = 1;
  return m;
}
