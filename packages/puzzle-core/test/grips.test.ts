/**
 * Resolving a clicked sticker to a twist axis.
 *
 * There are no Java-generated fixtures for this yet, so these are invariants rather than a
 * bit-for-bit comparison: every sticker must resolve to a grip that exists, sits on the cell the
 * sticker belongs to, and can actually turn.
 */

import { describe, expect, it } from 'vitest';

import { GOLDEN_PUZZLES, loadGeometry } from './fixtures.js';
import { gripForPick, numColorsForCubie, polygonCenter, stickerPickCenter } from '../src/grips.js';
import { isValidTwist } from '../src/twist.js';

describe.each(GOLDEN_PUZZLES)('$id — grip resolution', ({ file }) => {
  const geo = loadGeometry(file);

  it('resolves every sticker to a usable grip on its own cell', () => {
    for (let s = 0; s < geo.nStickers; ++s) {
      // Polygon 0 always exists; the choice only matters for 2×2×2 cells, covered separately.
      const pick = gripForPick(geo, s, 0);
      expect(pick.gripIndex, `sticker ${s} resolved to no grip`).toBeGreaterThanOrEqual(0);
      expect(geo.grip2face[pick.gripIndex]).toBe(geo.sticker2face[s]);
      expect(pick.faceIndex).toBe(geo.sticker2face[s]);
    }
  });

  it('fails only ever because the axis itself is degenerate', () => {
    // Some stickers legitimately resolve to a grip that cannot turn — a cell's innermost sticker
    // maps to the cell-centre axis, whose symmetry order is 0 — and on prisms and duoprisms even
    // some vertex and edge axes have order 1, a full turn that does nothing. The original behaves
    // the same and filters at the UI layer: such stickers do not highlight and clicks do nothing.
    //
    // So the invariant is not "always usable". It is that resolution never fails for any *other*
    // reason: never a bad index, never the wrong cell, never a slicemask that selects no layer.
    for (let s = 0; s < geo.nStickers; ++s) {
      const { gripIndex } = gripForPick(geo, s, 0);
      expect(gripIndex).toBeGreaterThanOrEqual(0);
      expect(isValidTwist(geo, gripIndex, 1), `sticker ${s}`).toBe(
        geo.gripSymmetryOrders[gripIndex] >= 2,
      );
    }
  });

  it('agrees with itself across a sticker’s polygons on non-2×2×2 cells', () => {
    // Away from the 2×2×2 special case the grip depends on the sticker, not on which face of it
    // you happened to click — so all polygons of a sticker must give the same answer.
    for (let s = 0; s < Math.min(geo.nStickers, 60); ++s) {
      const first = gripForPick(geo, s, 0);
      if (first.is2x2x2Cell) continue;
      for (let p = 1; p < geo.stickerPolyCount[s]; ++p) {
        expect(gripForPick(geo, s, p).gripIndex, `sticker ${s} polygon ${p}`).toBe(first.gripIndex);
      }
    }
  });
});

describe('{4,3,3} — every sticker but the cell centres is clickable', () => {
  it.each(['4-3-3_3', '4-3-3_2'])('%s', (file) => {
    // On a hypercube the only dead stickers are the eight cell centres, one per cell — and on the
    // 2⁴ there are none at all, because every sticker is a corner.
    const geo = loadGeometry(file);
    let dead = 0;
    for (let s = 0; s < geo.nStickers; ++s) {
      if (!isValidTwist(geo, gripForPick(geo, s, 0).gripIndex, 1)) dead++;
    }
    expect(dead).toBe(file === '4-3-3_3' ? 8 : 0);
  });
});

describe('duoprisms have degenerate twist axes', () => {
  it('is why some stickers cannot be clicked', () => {
    // A prism cell's rotation group is smaller than a cube's, so some of its vertex and edge axes
    // admit only the identity — symmetry order 1. Recorded here so the behaviour is a known
    // property of those puzzles rather than a suspected bug in grip resolution.
    const geo = loadGeometry('5x4_3');
    const orders = new Set<number>();
    for (let g = 0; g < geo.nGrips; ++g) orders.add(geo.gripSymmetryOrders[g]);
    expect(orders.has(1)).toBe(true);
  });
});

describe('{4,3,3} 3 — piece types map to grip dimensions', () => {
  const geo = loadGeometry('4-3-3_3');

  it('sends corners to vertex grips, edges to edge grips, faces to face grips', () => {
    // The rule is gripDim = nDims − (number of colours on the piece): a 4-colour corner turns
    // about a vertex, a 3-colour edge about an edge, a 2-colour face piece about a face.
    const expected: Record<number, number> = { 4: 0, 3: 1, 2: 2 };
    let checked = 0;
    for (let s = 0; s < geo.nStickers; ++s) {
      const colors = numColorsForCubie(geo, geo.sticker2cubie[s]);
      if (!(colors in expected)) continue;
      const { gripIndex } = gripForPick(geo, s, 0);
      expect(geo.gripDims[gripIndex], `sticker ${s} on a ${colors}-colour piece`).toBe(
        expected[colors],
      );
      checked++;
    }
    expect(checked).toBeGreaterThan(150);
  });

  it('gives those grips the rotation orders a cube has', () => {
    const orderFor = (colors: number) => {
      for (let s = 0; s < geo.nStickers; ++s) {
        if (numColorsForCubie(geo, geo.sticker2cubie[s]) === colors) {
          return geo.gripSymmetryOrders[gripForPick(geo, s, 0).gripIndex];
        }
      }
      return -1;
    };
    expect(orderFor(4)).toBe(3); // body diagonal — a third of a turn
    expect(orderFor(3)).toBe(2); // edge axis — a half turn
    expect(orderFor(2)).toBe(4); // face axis — a quarter turn
  });
});

describe('{4,3,3} 2 — the 2×2×2 cell special case', () => {
  const geo = loadGeometry('4-3-3_2');

  it('is detected', () => {
    // Every sticker of a 2⁴ is a corner, so the colour-count rule alone would send every click to
    // a vertex grip and two thirds of the puzzle's moves would be unreachable.
    let detected = 0;
    for (let s = 0; s < geo.nStickers; ++s) {
      for (let p = 0; p < geo.stickerPolyCount[s]; ++p) {
        if (gripForPick(geo, s, p).is2x2x2Cell) detected++;
      }
    }
    expect(detected).toBeGreaterThan(0);
  });

  it('lets one sticker reach several different axes', () => {
    // The point of the special case: which polygon you click decides the axis, so a single sticker
    // offers more than one move.
    const grips = new Set<number>();
    for (let p = 0; p < geo.stickerPolyCount[0]; ++p) {
      grips.add(gripForPick(geo, 0, p).gripIndex);
    }
    expect(grips.size).toBeGreaterThan(1);
  });
});

describe('geometry helpers', () => {
  const geo = loadGeometry('4-3-3_3');

  it('places polygon centres inside the sticker they belong to', () => {
    const stickerCenter = stickerPickCenter(geo, 0);
    for (let p = 0; p < geo.stickerPolyCount[0]; ++p) {
      const polyCenter = polygonCenter(geo, 0, p);
      let distance = 0;
      for (let i = 0; i < geo.nDims; ++i) {
        const d = polyCenter[i] - stickerCenter[i];
        distance += d * d;
      }
      // A cube's face centre sits half an edge from its middle, never further than a vertex does.
      expect(Math.sqrt(distance)).toBeLessThan(geo.circumRadius);
    }
  });
});
