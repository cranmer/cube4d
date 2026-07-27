/**
 * Move history: an immutable move list plus an index, replacing the original's doubly-linked list.
 *
 * `index` is how many moves are currently applied. Everything from `index` onward is the redo tail.
 * Marks are stored as positions rather than as nodes interleaved among the moves, which is a
 * lossless rearrangement of the same information and much easier to reason about.
 *
 * Two behaviours of the original are deliberately NOT reproduced here — see
 * docs/quirks-and-bugs.md:
 *
 *   - appending a move that inverts the previous one erased both, taking the redo stack with it
 *   - saving truncated the redo tail, discarding it from memory and disk alike
 *
 * Neither is required by the file format, and both surprise users. The legacy codec handles the
 * mismatch rather than the core carrying it.
 */

import type { Move } from './twist.js';

/**
 * Marks punctuate the move list.
 *
 * `scramble` separates the scramble from the solve, and is what makes the twist counter meaningful.
 * `macroOpen` / `macroClose` bracket an applied macro so undo can treat it as one unit.
 * `setup` marks moves that position the puzzle before a macro and get reversed afterwards.
 */
export type MarkKind = 'scramble' | 'macroOpen' | 'macroClose' | 'setup';

export interface Mark {
  /** Sits before `moves[at]`; may equal `moves.length`, meaning "after everything". */
  readonly at: number;
  readonly kind: MarkKind;
}

export interface History {
  readonly moves: readonly Move[];
  readonly marks: readonly Mark[];
  readonly index: number;
}

export const emptyHistory: History = Object.freeze({
  moves: Object.freeze([]) as readonly Move[],
  marks: Object.freeze([]) as readonly Mark[],
  index: 0,
});

export function createHistory(
  moves: readonly Move[] = [],
  marks: readonly Mark[] = [],
  index = moves.length,
): History {
  return { moves, marks, index };
}

/** Add a move at the current position, discarding any redo tail — the normal user twist. */
export function pushMove(history: History, move: Move): History {
  const moves = [...history.moves.slice(0, history.index), move];
  return {
    moves,
    // Marks beyond the truncation point go with the moves they punctuated.
    marks: history.marks.filter((m) => m.at <= history.index),
    index: moves.length,
  };
}

export function pushMark(history: History, kind: MarkKind): History {
  return {
    ...history,
    marks: [...history.marks.filter((m) => m.at <= history.index), { at: history.index, kind }],
  };
}

export function canUndo(history: History): boolean {
  return history.index > 0;
}

export function canRedo(history: History): boolean {
  return history.index < history.moves.length;
}

/**
 * Step back one move. Returns the history and the move to animate — which is the *inverse* of the
 * move being undone, since that is what the caller has to play.
 */
export function undo(history: History): { history: History; move: Move } | null {
  if (!canUndo(history)) return null;
  const move = history.moves[history.index - 1];
  return {
    history: { ...history, index: history.index - 1 },
    move: { g: move.g, d: (move.d === 1 ? -1 : 1) as 1 | -1, s: move.s },
  };
}

export function redo(history: History): { history: History; move: Move } | null {
  if (!canRedo(history)) return null;
  return {
    history: { ...history, index: history.index + 1 },
    move: history.moves[history.index],
  };
}

/** The moves currently applied, in order. Replaying these from solved reproduces the position. */
export function appliedMoves(history: History): readonly Move[] {
  return history.moves.slice(0, history.index);
}

/** Position of the scramble boundary, or -1 if the puzzle was never scrambled. */
export function scrambleBoundary(history: History): number {
  const mark = history.marks.find((m) => m.kind === 'scramble');
  return mark ? mark.at : -1;
}

/**
 * The twist count as the original reports it: applied moves after the scramble boundary, excluding
 * whole-puzzle rotations.
 *
 * This number goes in the `.log` header and the community reads it, so it has to match. A move that
 * turns every slice of a cell at once rotates the whole puzzle rather than twisting it, and has
 * never counted.
 */
export function countTwists(history: History, slicesForGrip: (grip: number) => number): number {
  const boundary = scrambleBoundary(history);
  const from = boundary >= 0 ? boundary : 0;
  let count = 0;
  for (let i = from; i < history.index; ++i) {
    const move = history.moves[i];
    if (!isWholePuzzleRotation(move, slicesForGrip(move.g))) count++;
  }
  return count;
}

/** True if the move turns every slice at once, which rotates the puzzle rather than twisting it. */
export function isWholePuzzleRotation(move: Move, numSlices: number): boolean {
  const mask = move.s === 0 ? 1 : move.s;
  const allSlices = (1 << numSlices) - 1;
  return (mask & allSlices) === allSlices;
}

/** Reverse a sequence of moves, for undoing a run or inverting a macro. */
export function invertMoves(moves: readonly Move[]): Move[] {
  return moves
    .slice()
    .reverse()
    .map((m) => ({ g: m.g, d: (m.d === 1 ? -1 : 1) as 1 | -1, s: m.s }));
}
