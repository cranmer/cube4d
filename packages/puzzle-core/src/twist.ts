/**
 * Twisting: the ~65 lines that the whole build-time-export architecture exists to leave behind.
 *
 * A twist is applied geometrically, exactly as the original does it: rotate each affected sticker's
 * centre by the twist matrix, then look the rotated centre up in a fuzzy spatial hash to find which
 * sticker slot it landed in. No connectivity graph, no precomputed tables in the asset — the
 * geometry itself says where everything goes.
 *
 * The original recomputes this on every single call. We memoize per (grip, direction, slicemask),
 * which matters because replaying a long solve log hits the same handful of twists repeatedly.
 */

import type { PuzzleGeometry } from './asset.js';
import { FuzzyPointHash } from './fuzzyPointHash.js';
import { makeRowRotMat, mxm, transpose, vxmAt } from './vecmath.js';

/** A single move: which grip, which way, and which layers. */
export interface Move {
  /** Index into the grip array. This is what `.log` files store. */
  readonly g: number;
  /** +1 counterclockwise, -1 clockwise. */
  readonly d: 1 | -1;
  /** Bit i selects slice i, counting inward from the grip's cell. 0 is treated as 1. */
  readonly s: number;
}

const hashCache = new WeakMap<PuzzleGeometry, FuzzyPointHash>();
const permCache = new WeakMap<PuzzleGeometry, Map<number, Int32Array>>();

function stickerHash(geo: PuzzleGeometry): FuzzyPointHash {
  let hash = hashCache.get(geo);
  if (!hash) {
    hash = new FuzzyPointHash(geo.stickerCenters, geo.nDims).indexAll();
    hashCache.set(geo, hash);
  }
  return hash;
}

/**
 * The rotation a grip performs, as `transpose(U) · R · U` where `U` is the grip's orthonormal basis
 * and `R` rotates in the plane of the last two axes. Change into the grip's frame, rotate, change
 * back. Row-vector convention throughout, matching the original.
 *
 * @param frac fraction of the full twist, for animation. 1 is a complete twist.
 */
export function twistMatrix(
  geo: PuzzleGeometry,
  gripIndex: number,
  direction: number,
  frac = 1,
): Float64Array {
  const n = geo.nDims;
  const order = geo.gripSymmetryOrders[gripIndex];
  if (order === 0) throw new Error(`grip ${gripIndex} does not rotate`);

  const angle = direction * ((2 * Math.PI) / order) * frac;
  const u = geo.gripUsefulMats.subarray(gripIndex * n * n, (gripIndex + 1) * n * n);
  // subarray gives a view; mxm reads it fine, but transpose must allocate.
  const basis = new Float64Array(u);
  return mxm(mxm(transpose(basis, n), makeRowRotMat(n, n - 2, n - 1, angle), n), basis, n);
}

/**
 * Which slice a point lies in, counting inward from a face, and whether the mask selects it.
 *
 * Slice 0 is the outermost layer next to the grip's own cell. Note this depends only on the grip's
 * FACE, not the grip itself — so two grips on the same cell always move the same stickers and
 * differ only in where those stickers go.
 */
export function isInSliceMask(
  geo: PuzzleGeometry,
  pointOffset: number,
  points: Float64Array,
  faceIndex: number,
  slicemask: number,
): boolean {
  const n = geo.nDims;
  const normalOffset = faceIndex * n;
  let height = 0;
  for (let i = 0; i < n; ++i) {
    height += points[pointOffset + i] * geo.faceInwardNormals[normalOffset + i];
  }

  const begin = geo.faceCutBegin[faceIndex];
  const nCuts = geo.faceCutCounts[faceIndex];
  let slice = 0;
  while (slice < nCuts && height > geo.faceCutOffsets[begin + slice]) slice++;
  return (slicemask & (1 << slice)) !== 0;
}

/** How many independently twistable layers a grip has. */
export function numSlicesForGrip(geo: PuzzleGeometry, gripIndex: number): number {
  return geo.faceCutCounts[geo.grip2face[gripIndex]] + 1;
}

/**
 * True if this move would actually do something. Filters grips that cannot rotate (order 0, the
 * cell-centre grips), grips whose twist is a full 360° no-op (order 1), and slicemasks that select
 * no existing layer.
 */
export function isValidTwist(geo: PuzzleGeometry, gripIndex: number, slicemask: number): boolean {
  if (gripIndex < 0 || gripIndex >= geo.nGrips) return false;
  const order = geo.gripSymmetryOrders[gripIndex];
  if (order === 0 || order === 1) return false;
  const slices = numSlicesForGrip(geo, gripIndex);
  const mask = slicemask === 0 ? 1 : slicemask;
  if ((mask & ((1 << slices) - 1)) === 0) return false;

  // Below four dimensions, only a facet axis can turn a single layer.
  //
  // The reason is the one thing that does *not* carry over from 4D, and it is worth stating exactly.
  // In the hypercube, the first layer measured from a cell *is that cell* — a whole 3×3×3 cube — so
  // it has the cube's full rotation group and a 120° turn about a corner maps it to itself. In three
  // dimensions the first layer measured from a face is a flat 3×3×1 slab, whose only symmetry is the
  // face's own. Turning it about a corner or an edge would send its cubies nowhere.
  //
  // The axes are real all the same: they rotate the *whole* solid, which is why the full mask stays
  // legal. This is the same fact as a physical Rubik's cube having no corner move.
  //
  // Verified exhaustively rather than reasoned about: across 3,138 (axis, mask) combinations on four
  // 3D puzzles, a permutation is a bijection exactly when this predicate holds.
  if (geo.nDims < 4 && geo.gripDims[gripIndex] < geo.nDims - 1) {
    return mask === (1 << slices) - 1;
  }
  return true;
}

/**
 * The sticker permutation for a move, as `perm[destination] = source`.
 *
 * Stickers the move doesn't touch map to themselves, so the array always covers every slot and can
 * be applied unconditionally.
 */
export function permutationFor(
  geo: PuzzleGeometry,
  gripIndex: number,
  direction: number,
  slicemask: number,
): Int32Array {
  const mask = slicemask === 0 ? 1 : slicemask;
  const key = (gripIndex * 2 + (direction > 0 ? 1 : 0)) * 65536 + mask;

  let cache = permCache.get(geo);
  if (!cache) {
    cache = new Map();
    permCache.set(geo, cache);
  }
  const cached = cache.get(key);
  if (cached) return cached;

  const n = geo.nDims;
  const order = geo.gripSymmetryOrders[gripIndex];
  if (order === 0) throw new Error(`applyTwist called on grip ${gripIndex}, which does not rotate`);

  const matrix = twistMatrix(geo, gripIndex, direction, 1);
  const faceIndex = geo.grip2face[gripIndex];
  const hash = stickerHash(geo);
  const rotated = new Float64Array(n);

  const perm = new Int32Array(geo.nStickers);
  for (let s = 0; s < geo.nStickers; ++s) {
    const offset = s * n;
    if (!isInSliceMask(geo, offset, geo.stickerCenters, faceIndex, mask)) {
      perm[s] = s;
      continue;
    }
    vxmAt(rotated, geo.stickerCenters, offset, matrix, n);
    const destination = hash.get(rotated);
    if (destination < 0) {
      // Only reachable if the geometry and the hash disagree, which in practice means a precision
      // problem — the epsilons here are absolute and unforgiving. See fuzzyPointHash.ts.
      throw new Error(
        `twist (grip ${gripIndex}, dir ${direction}, mask ${mask}) sent sticker ${s} to a point ` +
          `that matches no sticker`,
      );
    }
    perm[destination] = s;
  }

  cache.set(key, perm);
  return perm;
}

/**
 * Apply a move to a puzzle state, in place.
 *
 * State is `state[slot] = faceIndex` — which colour currently sits in each physical sticker slot.
 * That is the entire representation; all the complexity lives in the geometry.
 */
export function applyTwist(
  geo: PuzzleGeometry,
  state: Int32Array,
  gripIndex: number,
  direction: number,
  slicemask: number,
): Int32Array {
  if (state.length !== geo.nStickers) {
    throw new Error(`state has ${state.length} entries, expected ${geo.nStickers}`);
  }
  const perm = permutationFor(geo, gripIndex, direction, slicemask);
  const previous = Int32Array.from(state);
  for (let d = 0; d < perm.length; ++d) state[d] = previous[perm[d]];
  return state;
}

export function applyMove(geo: PuzzleGeometry, state: Int32Array, move: Move): Int32Array {
  return applyTwist(geo, state, move.g, move.d, move.s);
}

/**
 * Which stickers a move sets in motion, as a 0/1 flag per sticker.
 *
 * The renderer needs this to animate a partial twist: those stickers get the rotation applied,
 * everything else stays put.
 */
export function stickersInSlice(
  geo: PuzzleGeometry,
  gripIndex: number,
  slicemask: number,
): Uint8Array {
  const mask = slicemask === 0 ? 1 : slicemask;
  const faceIndex = geo.grip2face[gripIndex];
  const out = new Uint8Array(geo.nStickers);
  for (let s = 0; s < geo.nStickers; ++s) {
    out[s] = isInSliceMask(geo, s * geo.nDims, geo.stickerCenters, faceIndex, mask) ? 1 : 0;
  }
  return out;
}
