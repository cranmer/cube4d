/**
 * The gate for Phase 1.
 *
 * `tools/exporter` runs the original Java's `applyTwistToState` and dumps the resulting sticker
 * permutations. This test asserts the TypeScript port reproduces them exactly — not approximately,
 * not up to a relabelling: identical integers.
 *
 * Passing it means four separate things are right at once: the fuzzy spatial hash, the twist matrix
 * construction (including the row-vector convention), the slicemask classification, and the grip
 * ordering. The last is the one that matters for compatibility, because every move in every .log
 * file ever saved is an index into that array.
 */

import { describe, expect, it } from 'vitest';

import { GOLDEN_PUZZLES, loadGeometry, loadGoldens } from './fixtures.js';
import { permutationFor } from '../src/twist.js';

describe.each(GOLDEN_PUZZLES)('$id — against the Java ($note)', ({ file }) => {
  const geo = loadGeometry(file);
  const golden = loadGoldens(file);

  it('agrees on sticker count', () => {
    expect(golden.nStickers).toBe(geo.nStickers);
  });

  it('reproduces every sampled permutation bit-identically', () => {
    const mismatches: string[] = [];
    for (const { grip, dir, mask, perm } of golden.entries) {
      const ours = permutationFor(geo, grip, dir, mask);
      for (let i = 0; i < perm.length; ++i) {
        if (ours[i] !== perm[i]) {
          mismatches.push(
            `grip ${grip} dir ${dir} mask ${mask}: slot ${i} is ${ours[i]}, Java says ${perm[i]}`,
          );
          break;
        }
      }
    }
    // Show a few concrete failures before the count, so a regression reports something readable.
    expect(mismatches.slice(0, 5)).toEqual([]);
    expect(mismatches.length).toBe(0);
  });
});

describe('{4,3,3} 3 — exhaustive coverage', () => {
  const golden = loadGoldens('4-3-3_3');

  it('covers all 2,912 legal moves', () => {
    // 208 rotating grips (216 minus the 8 cell-centre grips) x 7 slicemasks x 2 directions.
    expect(golden.entries.length).toBe(2912);
  });
});
