/**
 * Algebraic properties that must hold for every puzzle, independent of the golden dumps.
 *
 * The goldens prove we match the Java on the moves that were sampled. These prove the port is
 * internally consistent everywhere else — which matters most for the large puzzles, where only a
 * fraction of moves could be dumped.
 */

import { describe, expect, it } from 'vitest';

import { GOLDEN_PUZZLES, loadGeometry } from './fixtures.js';
import { applyTwist, isValidTwist, numSlicesForGrip, permutationFor } from '../src/twist.js';
import { isSolved, solvedState, stateHash } from '../src/state.js';
import type { PuzzleGeometry } from '../src/asset.js';

function rotatingGrips(geo: PuzzleGeometry): number[] {
  const out: number[] = [];
  for (let g = 0; g < geo.nGrips; ++g) if (geo.gripSymmetryOrders[g] >= 2) out.push(g);
  return out;
}

/** Deterministic spread across the grip array, so a run is repeatable but not front-loaded. */
function sample<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) return items;
  const stride = Math.max(1, Math.floor(items.length / limit));
  const out: T[] = [];
  for (let i = 0; i < items.length && out.length < limit; i += stride) out.push(items[i]);
  return out;
}

describe.each(GOLDEN_PUZZLES)('$id — algebraic properties', ({ file }) => {
  const geo = loadGeometry(file);
  const grips = rotatingGrips(geo);
  // Large puzzles have tens of thousands of legal moves; a spread sample keeps the suite quick
  // while still touching every region of the grip array.
  const probes = sample(grips, 120);

  it('starts solved', () => {
    expect(isSolved(geo, solvedState(geo))).toBe(true);
  });

  it('every permutation is a bijection', () => {
    // The canary for precision regressions. The fuzzy hash uses ABSOLUTE epsilons, so a float32
    // leak into the twist path makes lookups miss — surfacing here as two slots mapping to the
    // same source, on one specific puzzle and grip.
    for (const g of probes) {
      for (let mask = 1; mask < 1 << numSlicesForGrip(geo, g); ++mask) {
        for (const dir of [1, -1] as const) {
          const perm = permutationFor(geo, g, dir, mask);
          const seen = new Uint8Array(geo.nStickers);
          for (const src of perm) seen[src] = 1;
          const missing = seen.indexOf(0);
          expect(missing, `grip ${g} dir ${dir} mask ${mask} never yields sticker ${missing}`).toBe(
            -1,
          );
        }
      }
    }
  });

  it('applying a grip of order k exactly k times is the identity', () => {
    for (const g of probes) {
      const order = geo.gripSymmetryOrders[g];
      // Start from a non-solved position, or a puzzle-symmetric twist could pass trivially.
      const state = solvedState(geo);
      const other = grips.find((h) => geo.grip2face[h] !== geo.grip2face[g]);
      if (other !== undefined) applyTwist(geo, state, other, 1, 1);
      const before = stateHash(state);
      for (let i = 0; i < order; ++i) applyTwist(geo, state, g, 1, 1);
      expect(stateHash(state), `grip ${g} of order ${order}`).toBe(before);
    }
  });

  it('a twist followed by its inverse is the identity', () => {
    const solvedHash = stateHash(solvedState(geo));
    for (const g of probes) {
      for (let mask = 1; mask < 1 << numSlicesForGrip(geo, g); ++mask) {
        const state = solvedState(geo);
        applyTwist(geo, state, g, 1, mask);
        applyTwist(geo, state, g, -1, mask);
        expect(stateHash(state), `grip ${g} mask ${mask}`).toBe(solvedHash);
      }
    }
  });

  it('conserves the colour census', () => {
    const state = solvedState(geo);
    const census = () => {
      const counts = new Int32Array(geo.nFaces);
      for (const c of state) counts[c]++;
      return Array.from(counts);
    };
    const before = census();
    for (const g of probes) applyTwist(geo, state, g, 1, 1);
    expect(census()).toEqual(before);
  });

  it('stays solved under a whole-puzzle rotation', () => {
    // Every slice of a cell moving together rotates the entire puzzle rather than twisting it,
    // so the colours move but the puzzle is still solved.
    for (const g of probes.slice(0, 8)) {
      const allSlices = (1 << numSlicesForGrip(geo, g)) - 1;
      const state = solvedState(geo);
      applyTwist(geo, state, g, 1, allSlices);
      expect(isSolved(geo, state), `whole-puzzle rotation on grip ${g}`).toBe(true);
    }
  });

  it('rejects twists that would do nothing', () => {
    for (let g = 0; g < geo.nGrips; ++g) {
      if (geo.gripSymmetryOrders[g] === 0) expect(isValidTwist(geo, g, 1)).toBe(false);
    }
    expect(isValidTwist(geo, -1, 1)).toBe(false);
    expect(isValidTwist(geo, geo.nGrips, 1)).toBe(false);
    const g = probes[0];
    const beyondLastSlice = 1 << numSlicesForGrip(geo, g);
    expect(isValidTwist(geo, g, beyondLastSlice)).toBe(false);
  });
});

describe('{4,3,3} 3 — structure', () => {
  const geo = loadGeometry('4-3-3_3');

  it('decodes to the counts the Java reports', () => {
    expect(geo.schlafli).toBe('{4,3,3}');
    expect(geo.edgeLength).toBe(3);
    expect(geo.nDims).toBe(4);
    expect(geo.nFaces).toBe(8);
    expect(geo.nCubies).toBe(80);
    expect(geo.nStickers).toBe(216);
    expect(geo.nGrips).toBe(216);
    expect(geo.nVerts).toBe(1728);
  });

  it('gives each cell 27 grips: 8 vertices, 12 edges, 6 faces, 1 centre', () => {
    const perFace = new Map<number, number[]>();
    for (let g = 0; g < geo.nGrips; ++g) {
      const face = geo.grip2face[g];
      if (!perFace.has(face)) perFace.set(face, [0, 0, 0, 0]);
      perFace.get(face)![geo.gripDims[g]]++;
    }
    expect(perFace.size).toBe(8);
    for (const counts of perFace.values()) expect(counts).toEqual([8, 12, 6, 1]);
  });

  it('has one non-rotating grip per cell — the cell-centre grips', () => {
    let nonRotating = 0;
    for (let g = 0; g < geo.nGrips; ++g) if (geo.gripSymmetryOrders[g] === 0) nonRotating++;
    expect(nonRotating).toBe(8);
  });

  it('gives face grips order 4, edge grips order 2, vertex grips order 3', () => {
    // A cube's rotation group, recovered from the geometry: quarter turns about face axes,
    // half turns about edge axes, third turns about body diagonals.
    const ordersByDim = new Map<number, Set<number>>();
    for (let g = 0; g < geo.nGrips; ++g) {
      const dim = geo.gripDims[g];
      if (!ordersByDim.has(dim)) ordersByDim.set(dim, new Set());
      ordersByDim.get(dim)!.add(geo.gripSymmetryOrders[g]);
    }
    expect([...ordersByDim.get(0)!]).toEqual([3]); // vertex
    expect([...ordersByDim.get(1)!]).toEqual([2]); // edge
    expect([...ordersByDim.get(2)!]).toEqual([4]); // face
    expect([...ordersByDim.get(3)!]).toEqual([0]); // cell centre — cannot rotate
  });

  it('has 80 pieces: 16 corners, 32 edges, 24 faces, 8 centres', () => {
    const stickersPerCubie = new Map<number, number>();
    for (let s = 0; s < geo.nStickers; ++s) {
      const cubie = geo.sticker2cubie[s];
      stickersPerCubie.set(cubie, (stickersPerCubie.get(cubie) ?? 0) + 1);
    }
    expect(stickersPerCubie.size).toBe(80);
    const histogram = new Map<number, number>();
    for (const n of stickersPerCubie.values()) histogram.set(n, (histogram.get(n) ?? 0) + 1);
    expect(histogram.get(4)).toBe(16); // 4-colour corner pieces
    expect(histogram.get(3)).toBe(32); // 3-colour edge pieces
    expect(histogram.get(2)).toBe(24); // 2-colour face pieces
    expect(histogram.get(1)).toBe(8); // 1-colour cell centres
  });

  it('pairs every face with an opposite', () => {
    for (let f = 0; f < geo.nFaces; ++f) {
      const opposite = geo.face2OppositeFace[f];
      expect(opposite).toBeGreaterThanOrEqual(0);
      expect(geo.face2OppositeFace[opposite]).toBe(f);
    }
  });
});

describe('{3,3,3} 3 — the simplex has no opposite faces', () => {
  const geo = loadGeometry('3-3-3_3');

  it('reports -1 for every face', () => {
    // A 5-cell has no antipodal cells, which is why the construction puts all its cuts on the
    // near side of each face rather than splitting them.
    for (let f = 0; f < geo.nFaces; ++f) expect(geo.face2OppositeFace[f]).toBe(-1);
  });
});
