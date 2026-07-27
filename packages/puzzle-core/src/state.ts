/**
 * Puzzle state: an Int32Array where `state[slot] = faceIndex`, saying which colour currently sits
 * in each physical sticker slot.
 *
 * That really is the whole representation. All the difficulty in MagicCube4D is in generating the
 * geometry; once you have it, a position is a few hundred small integers.
 */

import type { PuzzleGeometry } from './asset.js';

/** The solved position: every sticker showing its own face's colour. */
export function solvedState(geo: PuzzleGeometry): Int32Array {
  return Int32Array.from(geo.sticker2face);
}

/**
 * Solved iff every sticker belonging to a face shows the same colour.
 *
 * Note this doesn't require each face to show *its own* colour — a whole-puzzle rotation leaves the
 * puzzle solved but permutes which colour is where, and that should still count. This matches the
 * original's PuzzleManager.isSolved, and it works unchanged for every puzzle in the catalog because
 * it never looks at the geometry.
 */
export function isSolved(geo: PuzzleGeometry, state: Int32Array): boolean {
  const colorOfFace = new Int32Array(geo.nFaces).fill(-1);
  for (let s = 0; s < geo.nStickers; ++s) {
    const face = geo.sticker2face[s];
    const color = state[s];
    if (colorOfFace[face] === -1) colorOfFace[face] = color;
    else if (colorOfFace[face] !== color) return false;
  }
  return true;
}

/** How many stickers are not showing the colour they started with. Handy for progress display. */
export function countMisplaced(geo: PuzzleGeometry, state: Int32Array): number {
  let n = 0;
  for (let s = 0; s < geo.nStickers; ++s) if (state[s] !== geo.sticker2face[s]) n++;
  return n;
}

/**
 * Order-independent fingerprint of a position, for cheap equality checks and for validating a
 * cached state against a replay. FNV-1a over the state bytes.
 */
export function stateHash(state: Int32Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < state.length; ++i) {
    h ^= state[i] & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (state[i] >>> 8) & 0xff;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
