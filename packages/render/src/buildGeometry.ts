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
}

/**
 * Build the vertex buffer and index buffer.
 *
 * Polygons are facets of a convex cell, so a triangle fan is always a valid triangulation. Vertices
 * are shared within a sticker but never between stickers, which is exactly the sharing the GPU
 * wants — no duplication is needed.
 */
export function buildBuffers(geo: PuzzleGeometry): PuzzleBuffers {
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

  let poly = 0;
  let ind = 0;
  let out = 0;
  for (let s = 0; s < geo.nStickers; ++s) {
    const base = geo.stickerVertBegin[s];
    const nPolys = geo.stickerPolyCount[s];
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
    poly += nPolys;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('aVertMinusStickerCenter', new THREE.BufferAttribute(positions, 4));
  geometry.setAttribute('aStickerId', new THREE.BufferAttribute(stickerIds, 1));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  // The shader ignores it, but Three.js culls against the bounding sphere before drawing, and an
  // unset one makes it compute a bogus sphere from the offset attribute.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Number.POSITIVE_INFINITY);

  const { texture, array, width } = buildStickerTexture(geo);
  return {
    geometry,
    stickerData: texture,
    stickerArray: array,
    stickerTexWidth: width,
    triangleCount: triangles,
  };
}

function buildStickerTexture(geo: PuzzleGeometry): {
  texture: THREE.DataTexture;
  array: Float32Array;
  width: number;
} {
  const witnesses = cullWitnesses(geo);
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
    for (let k = 0; k < 4; ++k) {
      const v = witnesses[s * 4 + k];
      if (vertToSticker[v] !== s) {
        throw new Error(`cull witness ${v} for sticker ${s} belongs to sticker ${vertToSticker[v]}`);
      }
      for (let i = 0; i < 4; ++i) {
        array[texel(STICKER_TEXEL.witness0 + k) + i] = geo.vertsMinusStickerCenters[v * 4 + i];
      }
    }

    // Solved: each sticker shows its own face's colour.
    array[texel(STICKER_TEXEL.meta) + 0] = face;
    array[texel(STICKER_TEXEL.meta) + 1] = geo.sticker2cubie[s];
  }

  const texture = new THREE.DataTexture(array, width, height, THREE.RGBAFormat, THREE.FloatType);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return { texture, array, width };
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
