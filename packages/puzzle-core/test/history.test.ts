/**
 * History, scramble, and rotation — the parts of the core that don't touch geometry files.
 */

import { describe, expect, it } from 'vitest';

import {
  appliedMoves,
  canRedo,
  canUndo,
  countTwists,
  createHistory,
  emptyHistory,
  invertMoves,
  isWholePuzzleRotation,
  pushMark,
  pushMove,
  redo,
  scrambleBoundary,
  undo,
} from '../src/history.js';
import { fullScrambleLength, mulberry32, scramble } from '../src/scramble.js';
import { continueSpin, createRotation, drag, gramSchmidt, NICE_VIEW, stopSpinning } from '../src/rotation.js';
import { applyMove, type Move } from '../src/twist.js';
import { isSolved, solvedState, stateHash } from '../src/state.js';
import { loadGeometry } from './fixtures.js';

const move = (g: number, d: 1 | -1 = 1, s = 1): Move => ({ g, d, s });

describe('history', () => {
  it('starts empty', () => {
    expect(canUndo(emptyHistory)).toBe(false);
    expect(canRedo(emptyHistory)).toBe(false);
    expect(appliedMoves(emptyHistory)).toEqual([]);
  });

  it('records moves and steps back and forward', () => {
    let h = pushMove(pushMove(emptyHistory, move(1)), move(2));
    expect(h.index).toBe(2);

    const undone = undo(h)!;
    h = undone.history;
    expect(h.index).toBe(1);
    // Undo hands back the inverse, because that is what the caller has to animate.
    expect(undone.move).toEqual({ g: 2, d: -1, s: 1 });

    const redone = redo(h)!;
    h = redone.history;
    expect(h.index).toBe(2);
    expect(redone.move).toEqual({ g: 2, d: 1, s: 1 });
  });

  it('discards the redo tail when a new move is made', () => {
    let h = pushMove(pushMove(emptyHistory, move(1)), move(2));
    h = undo(h)!.history;
    expect(canRedo(h)).toBe(true);
    h = pushMove(h, move(3));
    expect(canRedo(h)).toBe(false);
    expect(appliedMoves(h)).toEqual([move(1), move(3)]);
  });

  it('keeps inverse pairs rather than cancelling them', () => {
    // The original erases both moves and the redo stack with them. We do not — see
    // docs/quirks-and-bugs.md.
    let h = pushMove(emptyHistory, move(5, 1));
    h = pushMove(h, move(5, -1));
    expect(h.moves).toHaveLength(2);
    expect(h.index).toBe(2);
  });

  it('tracks the scramble boundary', () => {
    let h = pushMove(emptyHistory, move(1));
    h = pushMark(h, 'scramble');
    h = pushMove(h, move(2));
    expect(scrambleBoundary(h)).toBe(1);
  });

  it('counts twists the way the original does', () => {
    // Only moves after the scramble boundary, excluding whole-puzzle rotations.
    const threeSlices = () => 3;
    let h = pushMove(emptyHistory, move(1));
    h = pushMove(h, move(2));
    h = pushMark(h, 'scramble');
    h = pushMove(h, move(3));
    h = pushMove(h, move(4, 1, 0b111)); // all slices: a whole-puzzle rotation, not a twist
    h = pushMove(h, move(5));
    expect(countTwists(h, threeSlices)).toBe(2);
  });

  it('identifies whole-puzzle rotations', () => {
    expect(isWholePuzzleRotation(move(1, 1, 0b111), 3)).toBe(true);
    expect(isWholePuzzleRotation(move(1, 1, 0b101), 3)).toBe(false);
    expect(isWholePuzzleRotation(move(1, 1, 1), 3)).toBe(false);
  });

  it('inverts a sequence by reversing it and each move', () => {
    expect(invertMoves([move(1, 1), move(2, -1)])).toEqual([move(2, 1), move(1, -1)]);
  });

  it('drops marks that fall beyond a truncation', () => {
    let h = createHistory([move(1), move(2), move(3)], [{ at: 2, kind: 'scramble' }], 3);
    h = undo(h)!.history;
    h = undo(h)!.history;
    h = pushMove(h, move(9));
    expect(h.marks).toEqual([]);
  });
});

describe('scramble', () => {
  const geo = loadGeometry('4-3-3_3');

  it('is reproducible from its seed', () => {
    // The whole point: the original uses an unseeded RNG, so a scramble can never be re-derived
    // and a solve can never be verified.
    const a = scramble(geo, { twists: 40, seed: 12345 });
    const b = scramble(geo, { twists: 40, seed: 12345 });
    expect(a).toEqual(b);
    expect(scramble(geo, { twists: 40, seed: 12346 })).not.toEqual(a);
  });

  it('produces only legal twists', () => {
    for (const m of scramble(geo, { twists: 200, seed: 7 })) {
      expect(geo.gripSymmetryOrders[m.g]).toBeGreaterThanOrEqual(2);
      expect([1, -1]).toContain(m.d);
      // Exactly one slice per scramble twist, as in the original.
      expect(m.s & (m.s - 1)).toBe(0);
      expect(m.s).toBeGreaterThan(0);
    }
  });

  it('never twists the same axis twice in a row', () => {
    // Consecutive twists on the same cell or its opposite partly cancel, making a scramble weaker
    // than its twist count suggests.
    const moves = scramble(geo, { twists: 300, seed: 99 });
    for (let i = 1; i < moves.length; ++i) {
      const previous = geo.grip2face[moves[i - 1].g];
      const current = geo.grip2face[moves[i].g];
      expect(current).not.toBe(previous);
      expect(geo.face2OppositeFace[current]).not.toBe(previous);
    }
  });

  it('actually scrambles, and inverts back to solved', () => {
    const moves = scramble(geo, { twists: 60, seed: 2024 });
    const state = solvedState(geo);
    for (const m of moves) applyMove(geo, state, m);
    expect(isSolved(geo, state)).toBe(false);

    for (const m of invertMoves(moves)) applyMove(geo, state, m);
    expect(stateHash(state)).toBe(stateHash(solvedState(geo)));
  });

  it('scales the full-scramble length to the puzzle', () => {
    // The original's "goldilocks" coupon-collector estimate.
    const length = fullScrambleLength(geo);
    expect(length).toBeGreaterThan(20);
    expect(length).toBeLessThan(1000);
    expect(fullScrambleLength(loadGeometry('4-3-3_2'))).toBeLessThan(length);
  });
});

describe('mulberry32', () => {
  it('is deterministic and stays in range', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 1000; ++i) {
      const value = a();
      expect(value).toBe(b());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('rotation', () => {
  const isOrthonormal = (m: Float64Array) => {
    for (let i = 0; i < 4; ++i) {
      for (let j = 0; j < 4; ++j) {
        let dot = 0;
        for (let k = 0; k < 4; ++k) dot += m[i * 4 + k] * m[j * 4 + k];
        expect(dot).toBeCloseTo(i === j ? 1 : 0, 10);
      }
    }
  };

  it('starts orthonormal at the nice view', () => {
    const state = createRotation();
    expect(state.mat).toHaveLength(16);
    isOrthonormal(state.mat);
    expect(state.spin).toBeNull();
    expect(NICE_VIEW).toHaveLength(16);
  });

  it('stays orthonormal under thousands of drags', () => {
    // The integration scheme is a first-order exponential map, so it depends on the
    // re-orthonormalisation to keep from drifting out of the rotation group.
    let state = createRotation();
    for (let i = 0; i < 2000; ++i) {
      state = drag(state, Math.sin(i) * 30, Math.cos(i * 0.7) * 30, {
        button: i % 3 === 0 ? 'right' : 'left',
        shift: i % 2 === 0,
      });
    }
    isOrthonormal(state.mat);
  });

  it('keeps spinning after a throw, and stops on demand', () => {
    let state = drag(createRotation(), 40, 10, { button: 'left', shift: false });
    expect(state.spin).not.toBeNull();
    const before = Array.from(state.mat);
    state = continueSpin(state);
    expect(Array.from(state.mat)).not.toEqual(before);
    state = stopSpinning(state);
    expect(state.spin).toBeNull();
    const stopped = Array.from(state.mat);
    expect(Array.from(continueSpin(state).mat)).toEqual(stopped);
  });

  it('treats a tiny drag as a click, not a throw', () => {
    const state = drag(createRotation(), 0.5, 0.5, { button: 'left', shift: false });
    expect(state.spin).toBeNull();
  });

  it('rotates in different planes for different drags', () => {
    // Shift-drag is the rotation with no 3D analogue; it must not coincide with a plain drag.
    const plain = drag(createRotation(), 30, 0, { button: 'left', shift: false });
    const shifted = drag(createRotation(), 30, 0, { button: 'left', shift: true });
    expect(Array.from(plain.mat)).not.toEqual(Array.from(shifted.mat));
  });

  it('orthonormalises a degenerate matrix without dividing by zero', () => {
    const result = gramSchmidt(new Float64Array(16));
    expect(result.every((v) => Number.isFinite(v))).toBe(true);
  });
});
