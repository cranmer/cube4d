/**
 * Scrambling, with a seed.
 *
 * The original uses an unseeded `Random`, so a scramble can never be reproduced and a claimed solve
 * can never be checked — which is why the Hall of Fame runs on the honour system. Recording a seed
 * costs nothing now and means a future service could re-derive the scramble, replay the submitted
 * moves, and verify a solve without trusting the client. It cannot be retrofitted onto solves
 * recorded without it.
 */

import type { PuzzleGeometry } from './asset.js';
import { isValidTwist, numSlicesForGrip, type Move } from './twist.js';

/**
 * mulberry32 — small, fast, and good enough for shuffling. Named in the save file as
 * `mulberry32-v1` so the exact generator stays pinned even if we later prefer another.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ScrambleOptions {
  /** How many twists. The original's "full" scramble uses a heuristic; see fullScrambleLength. */
  readonly twists: number;
  readonly seed: number;
}

/**
 * Generate a scramble.
 *
 * Follows the original's selection rules: only grips that actually rotate, exactly one slice per
 * twist, and never the same cell or its opposite twice in a row — consecutive twists on the same
 * axis would partly cancel and make the scramble weaker than its twist count suggests.
 */
export function scramble(geo: PuzzleGeometry, options: ScrambleOptions): Move[] {
  const random = mulberry32(options.seed);

  const usable: number[] = [];
  for (let g = 0; g < geo.nGrips; ++g) if (isValidTwist(geo, g, 1)) usable.push(g);
  if (usable.length === 0) {
    throw new Error(`${geo.id} has no twistable grips; it cannot be scrambled`);
  }

  const moves: Move[] = [];
  let previousFace = -1;
  for (let i = 0; i < options.twists; ++i) {
    let grip = -1;
    // Bounded rather than unbounded: on a puzzle with very few faces, "not the last face or its
    // opposite" can be a tight constraint, and an unlucky run should not hang.
    for (let attempt = 0; attempt < 64; ++attempt) {
      const candidate = usable[Math.floor(random() * usable.length)];
      const face = geo.grip2face[candidate];
      if (face !== previousFace && geo.face2OppositeFace[face] !== previousFace) {
        grip = candidate;
        break;
      }
      grip = candidate;
    }
    const slices = numSlicesForGrip(geo, grip);
    moves.push({
      g: grip,
      d: random() < 0.5 ? 1 : -1,
      s: 1 << Math.floor(random() * slices),
    });
    previousFace = geo.grip2face[grip];
  }
  return moves;
}

/**
 * How many twists count as a "full" scramble — the original's `goldilocks` heuristic, ported
 * verbatim from `PuzzleManager.java:664`.
 *
 * It is a coupon-collector estimate: `0.577` is the Euler–Mascheroni constant, so
 * `0.577 + ln(nPieces)` approximates the harmonic number that says how many random draws it takes
 * to touch every piece. That is scaled by how many pieces a single twist moves, then again by a
 * dimension-and-face term.
 *
 * Reproduced exactly rather than reinvented, because the number is load-bearing: it decides whether
 * a scramble counts as "full", which decides whether a solve is celebrated and recorded.
 */
export function fullScrambleLength(geo: PuzzleGeometry): number {
  const nPieces = geo.nCubies;
  const nFaces = geo.nFaces;
  const nStickers = geo.nStickers;
  const n1ColorPieces = countCubiesWithColors(geo, 1);
  const d = geo.nDims;

  const aveNumTwists =
    ((nPieces * nFaces) / (nStickers - n1ColorPieces)) * (0.577 + Math.log(nPieces));
  return Math.round(aveNumTwists * (d - 1 + Math.log(nFaces / (2 * d)) / Math.log(4)));
}

/** How many pieces carry exactly `colors` stickers. A piece's sticker count is its "colours". */
export function countCubiesWithColors(geo: PuzzleGeometry, colors: number): number {
  const stickersPerCubie = new Map<number, number>();
  for (let s = 0; s < geo.nStickers; ++s) {
    const cubie = geo.sticker2cubie[s];
    stickersPerCubie.set(cubie, (stickersPerCubie.get(cubie) ?? 0) + 1);
  }
  let count = 0;
  for (const n of stickersPerCubie.values()) if (n === colors) count++;
  return count;
}
