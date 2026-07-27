/**
 * Replaying real solves.
 *
 * This is the end-to-end proof that the whole architecture works. A `.log` file stores each move as
 * a bare index into the grip array that MagicCube4D generated when it built the puzzle. Nothing in
 * the file says what a grip *is* — no axis, no face, no angle. The index is only meaningful against
 * geometry generated in exactly the same order.
 *
 * So: take a real solve from the Hall of Fame, start from a solved puzzle, apply every move by index
 * against geometry exported from the original Java, and see whether the puzzle ends up solved.
 *
 * If the grip ordering were off by even one, these would end in a scrambled mess.
 */

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  applyMove,
  countMisplaced,
  countTwists,
  createHistory,
  decodeAsset,
  isSolved,
  numSlicesForGrip,
  solvedState,
  type PuzzleGeometry,
} from '@mc4d/puzzle-core';
import { isCanonical, parseLog } from '../src/log.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

function loadGeometry(file: string): PuzzleGeometry {
  const gz = readFileSync(`${ROOT}fixtures/assets/${file}.mc4dpz.gz`);
  const raw = gunzipSync(gz);
  // Node pools Buffer allocations, so copy into an 8-byte-aligned ArrayBuffer for the f64 views.
  const buf = new ArrayBuffer(raw.byteLength);
  new Uint8Array(buf).set(raw);
  return decodeAsset(buf);
}

const ASSET_FOR: Record<string, string> = {
  '{4,3,3} 2': '4-3-3_2',
  '{4,3,3} 3': '4-3-3_3',
  '{4,3,3} 5': '4-3-3_5',
};

/**
 * Every version 3 solve log in the corpus, with the puzzle it claims to be for.
 *
 * These are complete records: scramble moves, a `m|` boundary, then the solution. Replaying the
 * whole list from solved should therefore return to solved.
 */
const SOLVES = [
  { file: 'charles-3x3x3x3-191.log', puzzle: '{4,3,3} 3', note: 'Charles Doan — shortest 3⁴, 191 twists' },
  { file: 'sebastian-3x3x3x3-bld.log', puzzle: '{4,3,3} 3', note: 'Sebastian — 3⁴ blindfolded' },
  { file: 'andrew-luna_3x3x3x3-comp-assist.log', puzzle: '{4,3,3} 3', note: 'Andrew Luna — computer-assisted 3⁴' },
  { file: 'daniel-2x2x2x2-46.log', puzzle: '{4,3,3} 2', note: 'Daniel — 2⁴ in 46 twists' },
  { file: 'anderson-2x2x2x2-computer-24.log', puzzle: '{4,3,3} 2', note: 'Anderson — computer-assisted 2⁴' },
  { file: 'liu-2x2x2x2-bld.log', puzzle: '{4,3,3} 2', note: 'Liu — 2⁴ blindfolded' },
  { file: 'matt_2x2x2x2_blind.log', puzzle: '{4,3,3} 2', note: 'Matt — 2⁴ blindfolded' },
  { file: 'andrey-5x5x5x5-1981.log', puzzle: '{4,3,3} 5', note: 'Andrey Astrelin — 5⁴ in 1981 twists' },
] as const;

const read = (name: string) => readFileSync(`${ROOT}fixtures/logs/${name}`, 'utf8');

describe.each(SOLVES)('$file — $note', ({ file, puzzle }) => {
  const { log } = parseLog(read(file));
  const geo = loadGeometry(ASSET_FOR[puzzle]);

  it('is for the puzzle we think it is', () => {
    expect(`${log.schlafli} ${log.edgeLength}`).toBe(puzzle);
    expect(geo.schlafli).toBe(log.schlafli);
    expect(geo.edgeLength).toBe(log.edgeLength);
  });

  it('references only grips this puzzle has', () => {
    for (const move of log.moves) {
      expect(move.g, `grip ${move.g} is out of range for ${puzzle}`).toBeGreaterThanOrEqual(0);
      expect(move.g).toBeLessThan(geo.nGrips);
    }
  });

  it('actually scrambles the puzzle on the way through', () => {
    // Guards against the replay passing trivially — if every move were a no-op the puzzle would
    // also "end solved". Check that it genuinely leaves the solved state partway.
    const boundary = log.marks.find((m) => m.kind === 'scramble');
    const upTo = boundary ? boundary.at : Math.floor(log.moves.length / 2);
    const state = solvedState(geo);
    for (let i = 0; i < upTo; ++i) applyMove(geo, state, log.moves[i]);
    expect(countMisplaced(geo, state)).toBeGreaterThan(0);
  });

  it('replays to a solved puzzle', () => {
    // The moment of truth for the whole project.
    const state = solvedState(geo);
    for (const move of log.moves) applyMove(geo, state, move);
    expect(isSolved(geo, state)).toBe(true);
  });

  it.skipIf(!isCanonical(read(file)))('reproduces the twist count in its own header', () => {
    // Independent check on countTwists: only moves after the scramble boundary, excluding
    // whole-puzzle rotations. The community reads this number, so it has to match exactly.
    //
    // Skipped for the two computer-assisted solves, whose headers were written by solver scripts
    // and do not agree with their own contents — see the test below.
    const history = createHistory(log.moves, log.marks, log.index);
    const counted = countTwists(history, (grip) => numSlicesForGrip(geo, grip));
    expect(counted).toBe(log.twistCount);
  });
});

describe('headers written by other tools', () => {
  it('do not always agree with their own move lists', () => {
    // anderson-2x2x2x2-computer-24.log declares 0 twists for what its own filename calls a
    // 24-twist solve: the script that produced it never filled the field in. Recorded here so the
    // discrepancy is a known property of the corpus rather than a suspected bug in countTwists.
    const { log } = parseLog(read('anderson-2x2x2x2-computer-24.log'));
    const geo = loadGeometry('4-3-3_2');
    const counted = countTwists(
      createHistory(log.moves, log.marks, log.index),
      (grip) => numSlicesForGrip(geo, grip),
    );
    expect(log.twistCount).toBe(0);
    expect(counted).toBe(24);
  });
});

describe('the corpus as a whole', () => {
  it('replays every version 3 solve to solved', () => {
    const results = SOLVES.map(({ file, puzzle }) => {
      const { log } = parseLog(read(file));
      const geo = loadGeometry(ASSET_FOR[puzzle]);
      const state = solvedState(geo);
      for (const move of log.moves) applyMove(geo, state, move);
      return { file, moves: log.moves.length, solved: isSolved(geo, state) };
    });
    expect(results.filter((r) => !r.solved)).toEqual([]);
    // A meaningful amount of history: thousands of real twists by real solvers.
    expect(results.reduce((n, r) => n + r.moves, 0)).toBeGreaterThan(2000);
  });
});
