/**
 * The 4D→3D pipeline, on the CPU.
 *
 * This mirrors what the vertex shader does. It exists for three reasons: to compute the projected
 * bounding radius the camera needs, to be testable in Node where there is no GPU, and to be a
 * readable statement of the transformation for anyone trying to understand how a 4D object gets
 * onto a screen.
 *
 * The stages, following PipelineUtils.computeFrame:
 *
 *   1. shrink   — pull each sticker toward its own centre, and each cell toward the puzzle's
 *   2. rotate   — in 4D, by the single view matrix; scale so the puzzle has circumradius 1
 *   3. project  — 4D to 3D, perspective, from an eye on the W axis
 *   4. cull     — discard cells facing toward the 4D eye
 *
 * Stage 4 is what makes the picture legible. A 4D object projected into 3D nests its cells inside
 * one another; drawing the near ones would hide everything. Discarding them is what produces the
 * characteristic cube-within-a-cube.
 */

import type { PuzzleGeometry } from '@mc4d/puzzle-core';

export interface ViewParams {
  /** Row-major 4×4 view rotation. */
  readonly mat4d: Float64Array | readonly number[];
  /** Distance of the 4D eye along W. The original's default is 1.05. */
  readonly eyeW: number;
  /** Gap between cells. Default 0.4. */
  readonly faceShrink: number;
  /** Gap between stickers within a cell. Default 0.5. */
  readonly stickerShrink: number;
}

export const DEFAULT_VIEW: Omit<ViewParams, 'mat4d'> = {
  eyeW: 1.05,
  faceShrink: 0.4,
  stickerShrink: 0.5,
};

/**
 * Apply shrink, 4D rotation and 4D→3D projection to a single point.
 *
 * `vMinusStickerCenter`, `stickerCenterMinusFaceCenter` and `faceCenter` are the original's
 * three-way decomposition, which lets any shrink setting be applied without touching the geometry.
 */
export function projectPoint(
  out: Float32Array,
  vMinusStickerCenter: ArrayLike<number>,
  vOffset: number,
  stickerCenterMinusFaceCenter: ArrayLike<number>,
  sOffset: number,
  faceCenter: ArrayLike<number>,
  fOffset: number,
  mat4d: ArrayLike<number>,
  scale4d: number,
  eyeW: number,
  faceShrink: number,
  stickerShrink: number,
): Float32Array {
  // Stage 1 — shrink.
  const p = [0, 0, 0, 0];
  for (let i = 0; i < 4; ++i) {
    p[i] =
      (vMinusStickerCenter[vOffset + i] * stickerShrink + stickerCenterMinusFaceCenter[sOffset + i]) *
        faceShrink +
      faceCenter[fOffset + i];
  }

  // Stage 2 — rotate in 4D and normalise scale. Row-vector convention: v · M.
  const r = [0, 0, 0, 0];
  for (let j = 0; j < 4; ++j) {
    let sum = 0;
    for (let i = 0; i < 4; ++i) sum += p[i] * mat4d[i * 4 + j];
    r[j] = sum * scale4d;
  }

  // Stage 3 — project 4D to 3D. The eye sits at +W looking toward −W.
  const w = eyeW - r[3];
  const k = eyeW / w;
  out[0] = r[0] * k;
  out[1] = r[1] * k;
  out[2] = r[2] * k;
  return out;
}

/**
 * Whether a sticker's cell faces away from the 4D eye, and should therefore be drawn.
 *
 * The test is the sign of the volume of a tetrahedron formed by four vertices of the projected
 * cell. The geometry guarantees those four are never coplanar — the original goes out of its way
 * during construction to arrange that, precisely so this test is always well defined.
 */
export function isBackCell(p0: Float32Array, p1: Float32Array, p2: Float32Array, p3: Float32Array): boolean {
  const a = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const b = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
  const c = [p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]];
  const volume =
    a[0] * (b[1] * c[2] - b[2] * c[1]) -
    a[1] * (b[0] * c[2] - b[2] * c[0]) +
    a[2] * (b[0] * c[1] - b[1] * c[0]);
  return volume < 0;
}

/**
 * The four vertices per sticker whose tetrahedron decides the cull, as indices into the global
 * vertex array.
 *
 * They are `inds[s][0][0..2]` and `inds[s][1][0]` — the first three vertices of the sticker's first
 * polygon plus one from its second. During construction the original rotates the second polygon's
 * indices specifically so this set is never degenerate.
 */
export function cullWitnesses(geo: PuzzleGeometry): Uint32Array {
  const out = new Uint32Array(geo.nStickers * 4);
  let poly = 0;
  let ind = 0;
  for (let s = 0; s < geo.nStickers; ++s) {
    const base = geo.stickerVertBegin[s];
    const nPolys = geo.stickerPolyCount[s];
    if (nPolys < 2) throw new Error(`sticker ${s} has ${nPolys} polygons; cannot form a cull tetrahedron`);

    const firstCount = geo.polyVertCount[poly];
    out[s * 4 + 0] = base + geo.polyIndsLocal[ind + 0];
    out[s * 4 + 1] = base + geo.polyIndsLocal[ind + 1];
    out[s * 4 + 2] = base + geo.polyIndsLocal[ind + 2];
    out[s * 4 + 3] = base + geo.polyIndsLocal[ind + firstCount];

    for (let k = 0; k < nPolys; ++k) ind += geo.polyVertCount[poly + k];
    poly += nPolys;
  }
  return out;
}

/**
 * Run the pipeline over every vertex and report the largest distance from the origin.
 *
 * The camera is framed from this. It changes only when the shrink or eye parameters change, not
 * when the puzzle rotates — a rotation cannot alter the projected extent, because the 4D rotation
 * is applied before the projection and the eye is on an axis the rotation moves points around.
 * (Not quite true in general, so it is recomputed on parameter change and treated as approximate.)
 */
export function projectedRadius(geo: PuzzleGeometry, params: ViewParams): number {
  const scale4d = 1 / geo.circumRadius;
  const out = new Float32Array(3);
  let maxSquared = 0;
  for (let v = 0; v < geo.nVerts; ++v) {
    const s = stickerOfVertex(geo, v);
    projectPoint(
      out,
      geo.vertsMinusStickerCenters,
      v * 4,
      geo.stickerCenterMinusFaceCenter,
      s * 4,
      geo.faceCenters,
      geo.sticker2face[s] * 4,
      params.mat4d,
      scale4d,
      params.eyeW,
      params.faceShrink,
      params.stickerShrink,
    );
    const squared = out[0] * out[0] + out[1] * out[1] + out[2] * out[2];
    if (squared > maxSquared) maxSquared = squared;
  }
  return Math.sqrt(maxSquared);
}

/** Which sticker owns each vertex. Each sticker's vertices are a contiguous run. */
export function vertexToSticker(geo: PuzzleGeometry): Uint32Array {
  const out = new Uint32Array(geo.nVerts);
  for (let s = 0; s < geo.nStickers; ++s) {
    const begin = geo.stickerVertBegin[s];
    const end = begin + geo.stickerVertCount[s];
    for (let v = begin; v < end; ++v) out[v] = s;
  }
  return out;
}

let cachedGeo: PuzzleGeometry | null = null;
let cachedMap: Uint32Array | null = null;

function stickerOfVertex(geo: PuzzleGeometry, vertex: number): number {
  if (cachedGeo !== geo || !cachedMap) {
    cachedGeo = geo;
    cachedMap = vertexToSticker(geo);
  }
  return cachedMap[vertex];
}

/**
 * Which stickers survive the front-cell cull, as a mask of 0/1 per sticker.
 *
 * Worth knowing what to expect here: the 4D eye sits at 1.05 against a puzzle normalised to
 * circumradius 1, so it is almost touching the surface. From there only the single nearest cell
 * faces the viewer, and everything else faces away. For the 3×3×3×3 that means exactly 27 of 216
 * stickers are culled — one cell's worth — and you are looking *through* where that cell was, into
 * the interior. That is precisely the cube-within-a-cube image.
 *
 * The number culled is largely rotation-invariant, but *which* ones are culled is not.
 */
export function visibleStickerMask(geo: PuzzleGeometry, params: ViewParams): Uint8Array {
  const witnesses = cullWitnesses(geo);
  const map = vertexToSticker(geo);
  const scale4d = 1 / geo.circumRadius;
  const points = [new Float32Array(3), new Float32Array(3), new Float32Array(3), new Float32Array(3)];

  const mask = new Uint8Array(geo.nStickers);
  for (let s = 0; s < geo.nStickers; ++s) {
    for (let k = 0; k < 4; ++k) {
      const v = witnesses[s * 4 + k];
      projectPoint(
        points[k],
        geo.vertsMinusStickerCenters,
        v * 4,
        geo.stickerCenterMinusFaceCenter,
        map[v] * 4,
        geo.faceCenters,
        geo.sticker2face[map[v]] * 4,
        params.mat4d,
        scale4d,
        params.eyeW,
        params.faceShrink,
        params.stickerShrink,
      );
    }
    mask[s] = isBackCell(points[0], points[1], points[2], points[3]) ? 1 : 0;
  }
  return mask;
}

/** How many stickers survive the cull. */
export function countVisibleStickers(geo: PuzzleGeometry, params: ViewParams): number {
  const mask = visibleStickerMask(geo, params);
  let n = 0;
  for (const v of mask) n += v;
  return n;
}
