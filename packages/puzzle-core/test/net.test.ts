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
import { cellName, netLayout, netTearing, netView } from '../src/net.js';
import { isValidTwist, numSlicesForGrip, permutationFor } from '../src/twist.js';
import { vxm } from '../src/vecmath.js';

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
