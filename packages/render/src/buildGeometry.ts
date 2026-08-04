/**
 * Turning an exported puzzle into GPU buffers.
 *
 * Two things go to the GPU: a vertex buffer carrying each vertex's offset from its own sticker's
 * centre plus the sticker's id, and a texture holding everything that is per-sticker. Nothing here
 * changes when the puzzle rotates or when the shrink sliders move — those are uniforms.
 */

import * as THREE from 'three';
import type { PuzzleGeometry } from '@mc4d/puzzle-core';

import { cullWitnesses, vertexToSticker } from './pipeline.js';
import { STICKER_TEXEL, TEXELS_PER_STICKER } from './shaders.js';
import type { Rgb } from './colors.js';

/** Wide enough to keep textures short, narrow enough to stay inside every GPU's size limit. */
const STICKER_TEX_WIDTH = 1024;

export interface PuzzleBuffers {
  readonly geometry: THREE.BufferGeometry;
  readonly stickerData: THREE.DataTexture;
  readonly stickerTexWidth: number;
  /** Backing store for `stickerData`, so a twist can rewrite entries in place. */
  readonly stickerArray: Float32Array;
  readonly triangleCount: number;
  /** Index data in sticker order, kept so transparency can reorder it back-to-front. */
  readonly baseIndices: Uint16Array | Uint32Array;
  /** Where each sticker's triangles start in the index buffer, in triangles. */
  readonly stickerTriBegin: Uint32Array;
  readonly stickerTriCount: Uint32Array;
}

/**
 * Build the vertex buffer and index buffer.
 *
 * Polygons are facets of a convex cell, so a triangle fan is always a valid triangulation. Vertices
 * are shared within a sticker but never between stickers, which is exactly the sharing the GPU
 * wants — no duplication is needed.
 */
/**
 * Present a puzzle of fewer than four dimensions as a four-dimensional one, flat in the extra axes.
 *
 * The renderer is `vec4` throughout — a GPU fact rather than a fact about the puzzle — while an asset
 * is honest about its own dimension. Rather than teach every reader of the per-vertex arrays about
 * `nDims`, they are padded once, here, and everything downstream carries on believing in four.
 *
 * The padding is zero, which makes the projection stage vanish rather than misbehave: it divides by
 * `eyeW - w`, so `w = 0` gives a factor of exactly one and the 4D→3D step passes `xyz` straight
 * through. What it does *not* survive is the front-cell cull, which is why that is switched off
 * separately. See docs/three-d.md §4.
 */
export function widenTo4D(geo: PuzzleGeometry): PuzzleGeometry {
  if (geo.nDims >= 4) return geo;
  const pad = (src: Float32Array, count: number): Float32Array => {
    const out = new Float32Array(count * 4);
    for (let i = 0; i < count; ++i) {
      for (let k = 0; k < geo.nDims; ++k) out[i * 4 + k] = src[i * geo.nDims + k];
    }
    return out;
  };
  return {
    ...geo,
    nDims: 4,
    vertsMinusStickerCenters: pad(geo.vertsMinusStickerCenters, geo.nVerts),
    stickerCenterMinusFaceCenter: pad(geo.stickerCenterMinusFaceCenter, geo.nStickers),
    faceCenters: pad(geo.faceCenters, geo.nFaces),
  };
}

export function buildBuffers(geo: PuzzleGeometry, cull = true): PuzzleBuffers {
  const vertToSticker = vertexToSticker(geo);

  const positions = new Float32Array(geo.nVerts * 4);
  positions.set(geo.vertsMinusStickerCenters);
  const stickerIds = new Float32Array(geo.nVerts);
  for (let v = 0; v < geo.nVerts; ++v) stickerIds[v] = vertToSticker[v];

  // Count triangles first so the index buffer can be allocated once.
  let triangles = 0;
  for (let p = 0; p < geo.nPolys; ++p) triangles += Math.max(0, geo.polyVertCount[p] - 2);

  const use32Bit = geo.nVerts > 65535;
  const indices = use32Bit ? new Uint32Array(triangles * 3) : new Uint16Array(triangles * 3);

  const stickerTriBegin = new Uint32Array(geo.nStickers);
  const stickerTriCount = new Uint32Array(geo.nStickers);

  let poly = 0;
  let ind = 0;
  let out = 0;
  for (let s = 0; s < geo.nStickers; ++s) {
    const base = geo.stickerVertBegin[s];
    const nPolys = geo.stickerPolyCount[s];
    stickerTriBegin[s] = out / 3;
    for (let k = 0; k < nPolys; ++k) {
      const count = geo.polyVertCount[poly + k];
      const first = base + geo.polyIndsLocal[ind];
      for (let t = 1; t + 1 < count; ++t) {
        indices[out++] = first;
        indices[out++] = base + geo.polyIndsLocal[ind + t];
        indices[out++] = base + geo.polyIndsLocal[ind + t + 1];
      }
      ind += count;
    }
    stickerTriCount[s] = out / 3 - stickerTriBegin[s];
    poly += nPolys;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('aVertMinusStickerCenter', new THREE.BufferAttribute(positions, 4));
  geometry.setAttribute('aStickerId', new THREE.BufferAttribute(stickerIds, 1));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  // The shader ignores it, but Three.js culls against the bounding sphere before drawing, and an
  // unset one makes it compute a bogus sphere from the offset attribute.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Number.POSITIVE_INFINITY);

  const { texture, array, width } = buildStickerTexture(geo, cull);
  return {
    geometry,
    stickerData: texture,
    stickerArray: array,
    stickerTexWidth: width,
    triangleCount: triangles,
    // A copy, not the live buffer. The transparency sort reads from this while writing into the
    // geometry's index array; if they were the same array it would overwrite its own source and
    // silently drop whole cells.
    baseIndices: indices.slice(),
    stickerTriBegin,
    stickerTriCount,
  };
}

function buildStickerTexture(geo: PuzzleGeometry, cull: boolean): {
  texture: THREE.DataTexture;
  array: Float32Array;
  width: number;
} {
  // A flat puzzle has one polygon per sticker, so there is no tetrahedron to take a volume of and
  // nothing to cull. Asking for witnesses would throw, which is the pipeline being honest.
  const witnesses = cull ? cullWitnesses(geo) : null;
  const vertToSticker = vertexToSticker(geo);

  const texelCount = geo.nStickers * TEXELS_PER_STICKER;
  const width = Math.min(STICKER_TEX_WIDTH, texelCount);
  const height = Math.ceil(texelCount / width);
  const array = new Float32Array(width * height * 4);

  for (let s = 0; s < geo.nStickers; ++s) {
    const texel = (k: number) => (s * TEXELS_PER_STICKER + k) * 4;
    const face = geo.sticker2face[s];

    for (let i = 0; i < 4; ++i) {
      array[texel(STICKER_TEXEL.centerMinusFace) + i] = geo.stickerCenterMinusFaceCenter[s * 4 + i];
      array[texel(STICKER_TEXEL.faceCenter) + i] = geo.faceCenters[face * 4 + i];
    }

    // The four cull witnesses, stored the same way a vertex is: as an offset from the sticker
    // centre, so the shader can push them through the identical shrink.
    if (witnesses) {
      for (let k = 0; k < 4; ++k) {
        const v = witnesses[s * 4 + k];
        if (vertToSticker[v] !== s) {
          throw new Error(`cull witness ${v} for sticker ${s} belongs to sticker ${vertToSticker[v]}`);
        }
        for (let i = 0; i < 4; ++i) {
          array[texel(STICKER_TEXEL.witness0 + k) + i] = geo.vertsMinusStickerCenters[v * 4 + i];
        }
      }
    }

    // Solved: each sticker shows its own face's colour.
    array[texel(STICKER_TEXEL.meta) + 0] = face;
    array[texel(STICKER_TEXEL.meta) + 1] = geo.sticker2cubie[s];
    // The cell this sticker's *slot* belongs to, which never changes. Distinct from the colour in
    // .x, which a twist overwrites: the unfolded layout has to know where a slot lives, not what
    // colour is currently sitting in it.
    array[texel(STICKER_TEXEL.meta) + 3] = geo.sticker2face[s];
  }

  const texture = new THREE.DataTexture(array, width, height, THREE.RGBAFormat, THREE.FloatType);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return { texture, array, width };
}

/**
 * Geometry for the pick pass: the same triangles, but non-indexed so each vertex can carry the
 * polygon it belongs to.
 *
 * Vertices are shared between the polygons of a sticker, so a polygon id cannot live on the shared
 * vertex — hence the expansion. Built lazily, since it is only needed once someone clicks.
 */
export function buildPickGeometry(geo: PuzzleGeometry): THREE.BufferGeometry {
  let triangles = 0;
  for (let p = 0; p < geo.nPolys; ++p) triangles += Math.max(0, geo.polyVertCount[p] - 2);

  const count = triangles * 3;
  const offsets = new Float32Array(count * 4);
  const stickerIds = new Float32Array(count);
  const polyIds = new Float32Array(count);

  let poly = 0;
  let ind = 0;
  let out = 0;
  for (let s = 0; s < geo.nStickers; ++s) {
    const base = geo.stickerVertBegin[s];
    const nPolys = geo.stickerPolyCount[s];
    for (let k = 0; k < nPolys; ++k) {
      const n = geo.polyVertCount[poly + k];
      const emit = (localIndex: number) => {
        const v = base + geo.polyIndsLocal[ind + localIndex];
        offsets.set(geo.vertsMinusStickerCenters.subarray(v * 4, v * 4 + 4), out * 4);
        stickerIds[out] = s;
        polyIds[out] = k;
        out++;
      };
      for (let t = 1; t + 1 < n; ++t) {
        emit(0);
        emit(t);
        emit(t + 1);
      }
      ind += n;
    }
    poly += nPolys;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('aVertMinusStickerCenter', new THREE.BufferAttribute(offsets, 4));
  geometry.setAttribute('aStickerId', new THREE.BufferAttribute(stickerIds, 1));
  geometry.setAttribute('aPolyId', new THREE.BufferAttribute(polyIds, 1));

  // A sequential index, purely so Three.js knows how many vertices to draw. It takes that count
  // from the index buffer or from an attribute literally named `position`, and this geometry has
  // neither — without one of them the renderer returns early and draws nothing at all, silently.
  const sequential = count > 65535 ? new Uint32Array(count) : new Uint16Array(count);
  for (let i = 0; i < count; ++i) sequential[i] = i;
  geometry.setIndex(new THREE.BufferAttribute(sequential, 1));

  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Number.POSITIVE_INFINITY);
  return geometry;
}

/**
 * Mark which stickers belong to the slice currently turning.
 *
 * The shader reads this per sticker, so an animating twist needs no geometry changes at all —
 * only this flag and a matrix uniform.
 */
export function setTwistingSlice(buffers: PuzzleBuffers, inSlice: Uint8Array | null): void {
  const n = inSlice ? inSlice.length : buffers.stickerTriBegin.length;
  for (let s = 0; s < n; ++s) {
    buffers.stickerArray[(s * TEXELS_PER_STICKER + STICKER_TEXEL.meta) * 4 + 2] =
      inSlice ? inSlice[s] : 0;
  }
  buffers.stickerData.needsUpdate = true;
}

/** Rewrite the colour each sticker shows, from a puzzle state. Used once a twist completes. */
export function updateStickerColors(
  buffers: PuzzleBuffers,
  state: Int32Array | Uint16Array,
): void {
  for (let s = 0; s < state.length; ++s) {
    buffers.stickerArray[(s * TEXELS_PER_STICKER + STICKER_TEXEL.meta) * 4] = state[s];
  }
  buffers.stickerData.needsUpdate = true;
}

/** A 1×nFaces texture of face colours, in linear space. */
export function buildFaceColorTexture(colors: readonly Rgb[]): THREE.DataTexture {
  const array = new Float32Array(colors.length * 4);
  for (let i = 0; i < colors.length; ++i) {
    // sRGB to linear, so the shader's multiply by brightness behaves like light rather than paint.
    array[i * 4 + 0] = srgbToLinear(colors[i].r / 255);
    array[i * 4 + 1] = srgbToLinear(colors[i].g / 255);
    array[i * 4 + 2] = srgbToLinear(colors[i].b / 255);
    array[i * 4 + 3] = 1;
  }
  const texture = new THREE.DataTexture(array, colors.length, 1, THREE.RGBAFormat, THREE.FloatType);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
