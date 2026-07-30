/**
 * Turning a click into a twist.
 *
 * You never choose a grip directly — you click a sticker, and the program infers which of the many
 * grips on that cell you meant. The rule is the piece's *type*: a 4-colour corner implies a
 * rotation about a vertex, a 3-colour edge piece about an edge, a 2-colour face piece about a face.
 *
 * This is a faithful port of the original's `getClosestGrip`, including a heuristic its own authors
 * describe at length as inadequate — see docs/quirks-and-bugs.md. Reproducing it is deliberate:
 * behaviour that players have twenty years of muscle memory for should not change silently, and the
 * cases where it misbehaves are pinned by fixtures rather than left to drift.
 */

import type { PuzzleGeometry } from './asset.js';

/**
 * The sticker vertices at rest with no shrink applied — the original's
 * `getStandardStickerVertsAtRest`. Pick geometry is reasoned about in these coordinates, not in
 * the shrunken ones you see on screen.
 */
export function standardStickerVerts(geo: PuzzleGeometry): Float32Array {
  const n = geo.nDims;
  const out = new Float32Array(geo.nVerts * n);
  for (let s = 0; s < geo.nStickers; ++s) {
    const face = geo.sticker2face[s];
    const begin = geo.stickerVertBegin[s];
    const end = begin + geo.stickerVertCount[s];
    for (let v = begin; v < end; ++v) {
      for (let i = 0; i < n; ++i) {
        out[v * n + i] =
          geo.vertsMinusStickerCenters[v * n + i] +
          geo.stickerCenterMinusFaceCenter[s * n + i] +
          geo.faceCenters[face * n + i];
      }
    }
  }
  return out;
}

/** Where each sticker's polygons begin in the flat `polyVertCount` / `polyIndsLocal` arrays. */
export function polygonOffsets(geo: PuzzleGeometry): { polyBegin: Uint32Array; indBegin: Uint32Array } {
  const polyBegin = new Uint32Array(geo.nStickers);
  const indBegin = new Uint32Array(geo.nPolys);
  let poly = 0;
  let ind = 0;
  for (let s = 0; s < geo.nStickers; ++s) {
    polyBegin[s] = poly;
    for (let k = 0; k < geo.stickerPolyCount[s]; ++k) {
      indBegin[poly] = ind;
      ind += geo.polyVertCount[poly];
      poly++;
    }
  }
  return { polyBegin, indBegin };
}

export interface PickInfo {
  readonly stickerIndex: number;
  readonly polyIndex: number;
  readonly faceIndex: number;
  readonly gripIndex: number;
  readonly is2x2x2Cell: boolean;
}

/** Cached derived tables, keyed by geometry. Building them walks every vertex, so do it once. */
interface GripTables {
  verts: Float32Array;
  polyBegin: Uint32Array;
  indBegin: Uint32Array;
  colorsPerCubie: Map<number, number>;
}
const tableCache = new WeakMap<PuzzleGeometry, GripTables>();

function tables(geo: PuzzleGeometry): GripTables {
  let t = tableCache.get(geo);
  if (!t) {
    const { polyBegin, indBegin } = polygonOffsets(geo);
    const stickersPerCubie = new Map<number, number>();
    for (let s = 0; s < geo.nStickers; ++s) {
      const cubie = geo.sticker2cubie[s];
      stickersPerCubie.set(cubie, (stickersPerCubie.get(cubie) ?? 0) + 1);
    }
    t = { verts: standardStickerVerts(geo), polyBegin, indBegin, colorsPerCubie: stickersPerCubie };
    tableCache.set(geo, t);
  }
  return t;
}

/** How many stickers a piece carries — its "number of colours". */
export function numColorsForCubie(geo: PuzzleGeometry, cubie: number): number {
  return tables(geo).colorsPerCubie.get(cubie) ?? 0;
}

/**
 * Centre of one polygon of a sticker, in standard rest coordinates.
 *
 * Note this averages over the polygon's index list, so a vertex appearing twice would count twice.
 * That matches the original exactly, and the values feed only tolerance-based comparisons.
 */
export function polygonCenter(geo: PuzzleGeometry, sticker: number, poly: number): Float32Array {
  const t = tables(geo);
  const n = geo.nDims;
  const p = t.polyBegin[sticker] + poly;
  const begin = t.indBegin[p];
  const count = geo.polyVertCount[p];
  const base = geo.stickerVertBegin[sticker];

  const out = new Float32Array(n);
  for (let k = 0; k < count; ++k) {
    const v = base + geo.polyIndsLocal[begin + k];
    for (let i = 0; i < n; ++i) out[i] += t.verts[v * n + i];
  }
  for (let i = 0; i < n; ++i) out[i] /= count;
  return out;
}

/**
 * Centre of a whole sticker, averaged the way the original does it: over every index of every
 * polygon, so shared vertices are counted once per polygon they appear in. That is not the true
 * centroid, but it is what the original compares against.
 */
export function stickerPickCenter(geo: PuzzleGeometry, sticker: number): Float32Array {
  const t = tables(geo);
  const n = geo.nDims;
  const base = geo.stickerVertBegin[sticker];
  const firstPoly = t.polyBegin[sticker];
  const nPolys = geo.stickerPolyCount[sticker];

  const out = new Float32Array(n);
  let total = 0;
  for (let k = 0; k < nPolys; ++k) {
    const p = firstPoly + k;
    const begin = t.indBegin[p];
    const count = geo.polyVertCount[p];
    for (let j = 0; j < count; ++j) {
      const v = base + geo.polyIndsLocal[begin + j];
      for (let i = 0; i < n; ++i) out[i] += t.verts[v * n + i];
      total++;
    }
  }
  for (let i = 0; i < n; ++i) out[i] /= total;
  return out;
}

/**
 * Whether the clicked sticker belongs to a 2×2×2 cell.
 *
 * Such a cell has no face pieces or centres — every sticker is a corner — so the colour-count rule
 * would send every click to a vertex grip and two thirds of the puzzle's moves would be
 * unreachable. The original detects the case by comparing squared distances against hardcoded
 * values with a generous tolerance, and routes it to a face grip chosen by which polygon was hit.
 */
export function is2x2x2Cell(
  polyCenter: ArrayLike<number>,
  stickerCenter: ArrayLike<number>,
  faceCenter: ArrayLike<number>,
  nDims: number,
): boolean {
  const eps = 0.1;
  let c1 = 0;
  let c2 = 0;
  for (let i = 0; i < nDims; ++i) {
    const a = stickerCenter[i] - faceCenter[i];
    const b = polyCenter[i] - faceCenter[i];
    c1 += a * a;
    c2 += b * b;
  }
  return Math.abs(c1 - 0.75) < eps && Math.abs(c2 - 1.5) < eps;
}

/**
 * Resolve a clicked sticker and polygon to a grip.
 *
 * Candidates are filtered to the clicked cell and to the grip dimension the piece type implies,
 * then the nearest grip centre wins.
 */
export function gripForPick(
  geo: PuzzleGeometry,
  stickerIndex: number,
  polyIndex: number,
  /**
   * Override the axis dimension the colour count would have chosen.
   *
   * The inference is convenient and occasionally cannot express what you want. A 2×2×2 has nothing
   * but corners, so every click asks for a vertex axis and — below four dimensions — a vertex axis
   * can only turn the whole solid, leaving the puzzle with no moves at all. The same shape of gap
   * appears on the pocket hypercube and the simplex; see docs/three-d.md §13.
   *
   * Rather than special-case those puzzles, the interface offers a way to say what you meant: hold a
   * key and ask for the facet axis directly — the move the missing centre sticker would have given.
   * It generalises because it adds a way to *name* an axis rather than a rule about which puzzles
   * are odd.
   */
  axisDim?: number,
): PickInfo {
  const n = geo.nDims;
  const faceIndex = geo.sticker2face[stickerIndex];

  const polyCenter = polygonCenter(geo, stickerIndex, polyIndex);
  const stickerCenter = stickerPickCenter(geo, stickerIndex);
  const faceCenter = geo.faceCenters.subarray(faceIndex * n, faceIndex * n + n);

  const twoByTwo = is2x2x2Cell(polyCenter, stickerCenter, faceCenter, n);

  let gripDim: number;
  if (axisDim !== undefined) {
    gripDim = axisDim;
  } else if (twoByTwo) {
    gripDim = 2;
  } else {
    const colors = numColorsForCubie(geo, geo.sticker2cubie[stickerIndex]);
    gripDim = n - colors;
    // A length-2 simplex has a central piece with more colours than the puzzle has dimensions.
    if (gripDim < 0) gripDim = n - 1;
  }

  // On a 2×2×2 cell the polygon decides the axis; otherwise the sticker does.
  const target = twoByTwo ? polyCenter : stickerCenter;

  let best = -1;
  let bestDistance = Infinity;
  for (let g = 0; g < geo.nGrips; ++g) {
    if (geo.grip2face[g] !== faceIndex) continue;
    if (geo.gripDims[g] !== gripDim) continue;
    let d = 0;
    for (let i = 0; i < n; ++i) {
      const delta = geo.gripCenters[g * n + i] - target[i];
      d += delta * delta;
    }
    if (d < bestDistance) {
      bestDistance = d;
      best = g;
    }
  }

  return { stickerIndex, polyIndex, faceIndex, gripIndex: best, is2x2x2Cell: twoByTwo };
}

const representativeCache = new WeakMap<PuzzleGeometry, Map<number, number>>();

/**
 * A sticker you could click to perform a given twist — the inverse of `gripForPick`.
 *
 * A `.log` records only the grip index, so replaying a solve knows *what* turned but not what the
 * solver clicked to turn it. Recovering a sticker lets a replay point at the same thing a player
 * would have, which is the difference between watching a move happen and understanding it.
 *
 * There is no closed form, since resolution is a nearest-grip search with filters — so this
 * inverts it by brute force, asking every sticker where it would send you and keeping the first
 * that answers with this grip. Built once per puzzle, on demand, and cached.
 */
export function stickerForGrip(geo: PuzzleGeometry, gripIndex: number): number {
  let map = representativeCache.get(geo);
  if (!map) {
    map = new Map<number, number>();
    for (let s = 0; s < geo.nStickers; ++s) {
      // Polygon matters only on 2×2×2 cells, where each face of a sticker offers a different axis.
      for (let p = 0; p < geo.stickerPolyCount[s]; ++p) {
        const { gripIndex: g } = gripForPick(geo, s, p);
        if (g >= 0 && !map.has(g)) map.set(g, s);
      }
    }
    representativeCache.set(geo, map);
  }
  return map.get(gripIndex) ?? -1;
}
