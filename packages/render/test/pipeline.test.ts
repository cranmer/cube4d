/**
 * The 4D→3D pipeline, tested on the CPU.
 *
 * The shader does the same arithmetic, but a shader cannot be unit tested in Node. These tests pin
 * the maths itself — particularly the front-cell cull, which is the step that decides whether the
 * picture is legible or an opaque blob.
 */

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { createRotation, decodeAsset, drag, NICE_VIEW, type PuzzleGeometry } from '@mc4d/puzzle-core';

import {
  countVisibleStickers,
  cullWitnesses,
  DEFAULT_VIEW,
  isBackCell,
  projectedRadius,
  projectPoint,
  vertexToSticker,
  visibleStickerMask,
} from '../src/pipeline.js';
import { assignFaceColors, DEFAULT_FACE_COLORS, paletteById, paletteSwatches } from '../src/colors.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

function loadGeometry(file: string): PuzzleGeometry {
  const raw = gunzipSync(readFileSync(`${ROOT}fixtures/assets/${file}.mc4dpz.gz`));
  const buf = new ArrayBuffer(raw.byteLength);
  new Uint8Array(buf).set(raw);
  return decodeAsset(buf);
}

const view = (over: Partial<typeof DEFAULT_VIEW> = {}) => ({
  ...DEFAULT_VIEW,
  ...over,
  mat4d: Float64Array.from(NICE_VIEW),
});

describe('vertex ownership', () => {
  const geo = loadGeometry('4-3-3_3');

  it('assigns every vertex to exactly one sticker', () => {
    const map = vertexToSticker(geo);
    expect(map).toHaveLength(geo.nVerts);
    for (let s = 0; s < geo.nStickers; ++s) {
      const begin = geo.stickerVertBegin[s];
      for (let k = 0; k < geo.stickerVertCount[s]; ++k) expect(map[begin + k]).toBe(s);
    }
  });

  it('gives the hypercube 8 vertices per sticker', () => {
    // Every sticker of a 3×3×3×3 is a cube.
    for (let s = 0; s < geo.nStickers; ++s) expect(geo.stickerVertCount[s]).toBe(8);
  });
});

describe('cull witnesses', () => {
  const geo = loadGeometry('4-3-3_3');

  it('picks four vertices from the sticker they belong to', () => {
    const witnesses = cullWitnesses(geo);
    const map = vertexToSticker(geo);
    for (let s = 0; s < geo.nStickers; ++s) {
      for (let k = 0; k < 4; ++k) expect(map[witnesses[s * 4 + k]]).toBe(s);
    }
  });

  it('never picks four coplanar points', () => {
    // The original arranges this during construction, by rotating each sticker's second polygon
    // until the tetrahedron is non-degenerate. Without it the cull test would be undefined.
    const witnesses = cullWitnesses(geo);
    const map = vertexToSticker(geo);
    const p = [0, 1, 2, 3].map(() => new Float32Array(3));

    for (let s = 0; s < geo.nStickers; ++s) {
      for (let k = 0; k < 4; ++k) {
        const v = witnesses[s * 4 + k];
        projectPoint(
          p[k],
          geo.vertsMinusStickerCenters,
          v * 4,
          geo.stickerCenterMinusFaceCenter,
          map[v] * 4,
          geo.faceCenters,
          geo.sticker2face[map[v]] * 4,
          view().mat4d,
          1 / geo.circumRadius,
          DEFAULT_VIEW.eyeW,
          DEFAULT_VIEW.faceShrink,
          DEFAULT_VIEW.stickerShrink,
        );
      }
      const a = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
      const b = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
      const c = [p[3][0] - p[0][0], p[3][1] - p[0][1], p[3][2] - p[0][2]];
      const volume =
        a[0] * (b[1] * c[2] - b[2] * c[1]) -
        a[1] * (b[0] * c[2] - b[2] * c[0]) +
        a[2] * (b[0] * c[1] - b[1] * c[0]);
      expect(Math.abs(volume), `sticker ${s} has a degenerate cull tetrahedron`).toBeGreaterThan(1e-6);
    }
  });
});

describe('the front-cell cull', () => {
  it('reads the sign of a tetrahedron volume', () => {
    const p0 = Float32Array.from([0, 0, 0]);
    const p1 = Float32Array.from([1, 0, 0]);
    const p2 = Float32Array.from([0, 1, 0]);
    const above = Float32Array.from([0, 0, 1]);
    const below = Float32Array.from([0, 0, -1]);
    expect(isBackCell(p0, p1, p2, above)).toBe(false);
    expect(isBackCell(p0, p1, p2, below)).toBe(true);
  });

  it.each(['4-3-3_3', '4-3-3_2', '5x4_3', '3-3-3_3'])('culls some but not all of %s', (file) => {
    // Culling nothing would mean the near cell hides everything; culling everything would mean a
    // blank screen. Either is a sign the volume test has the wrong sign.
    const geo = loadGeometry(file);
    const visible = countVisibleStickers(geo, view());
    expect(visible).toBeGreaterThan(0);
    expect(visible).toBeLessThan(geo.nStickers);
  });

  it('culls exactly one cell of the hypercube', () => {
    // The 4D eye sits at 1.05 against a puzzle normalised to circumradius 1 — almost touching the
    // surface — so exactly the nearest cell faces it. For the 3×3×3×3 that is 27 of 216 stickers,
    // and you see through the gap into the interior. That gap is the cube-within-a-cube.
    const geo = loadGeometry('4-3-3_3');
    expect(geo.nStickers - countVisibleStickers(geo, view())).toBe(27);
  });

  it('is unchanged by ordinary 3D rotation', () => {
    // A plain left-drag rotates in the XZ and YZ planes, which leaves every point's W coordinate
    // untouched — and a proper 3D rotation preserves the sign of the tetrahedron volume. So it
    // cannot change which cell faces the 4D eye, however far you drag. The puzzle turns; the
    // hole stays in the same cell.
    const geo = loadGeometry('4-3-3_3');
    let rotation = createRotation();
    const initial = visibleStickerMask(geo, { ...DEFAULT_VIEW, mat4d: rotation.mat }).join('');
    for (let k = 0; k < 200; ++k) {
      rotation = drag(rotation, 25, 12, { button: 'left', shift: false });
    }
    expect(visibleStickerMask(geo, { ...DEFAULT_VIEW, mat4d: rotation.mat }).join('')).toBe(initial);
  });

  it('changes under true 4D rotation', () => {
    // Shift-drag rotates in the XW and YW planes. This is the motion with no 3D analogue, and it
    // is the only way to bring a different cell to the front — which is exactly why the original
    // gives it its own modifier.
    const geo = loadGeometry('4-3-3_3');
    let rotation = createRotation();
    const seen = new Set<string>();
    for (let i = 0; i < 12; ++i) {
      seen.add(visibleStickerMask(geo, { ...DEFAULT_VIEW, mat4d: rotation.mat }).join(''));
      for (let k = 0; k < 20; ++k) {
        rotation = drag(rotation, 25, 12, { button: 'left', shift: true });
      }
    }
    expect(seen.size).toBeGreaterThan(3);
  });
});

describe('projected extent', () => {
  const geo = loadGeometry('4-3-3_3');

  it('is finite and positive', () => {
    const radius = projectedRadius(geo, view());
    expect(Number.isFinite(radius)).toBe(true);
    expect(radius).toBeGreaterThan(0);
  });

  it('grows as the cells are drawn closer together', () => {
    // Less face shrink means cells sit further out from the puzzle centre.
    const tight = projectedRadius(geo, view({ faceShrink: 0.3 }));
    const loose = projectedRadius(geo, view({ faceShrink: 0.9 }));
    expect(loose).toBeGreaterThan(tight);
  });

  it('grows as the 4D eye comes closer', () => {
    // A nearer eye exaggerates the perspective, pushing the near cell outward.
    const near = projectedRadius(geo, view({ eyeW: 1.05 }));
    const far = projectedRadius(geo, view({ eyeW: 4 }));
    expect(near).toBeGreaterThan(far);
  });
});

describe('face colours', () => {
  it('reproduces the original assignment exactly for the hypercube', () => {
    // Classic is defined as pairs, but assigning them by the puzzle's real opposite-face relation
    // has to land every cell on the colour the original gave it.
    const geo = loadGeometry('4-3-3_3');
    const colors = assignFaceColors(geo.nFaces, geo.face2OppositeFace, paletteById('classic'));
    expect(colors).toEqual(DEFAULT_FACE_COLORS.map((c) => ({ ...c })));
  });

  it.each(['distinct', 'vivid', 'classic'])('puts %s opposite cells in the same pair', (id) => {
    // The Rubik's convention: white faces yellow, red faces orange. Each palette pair must land on
    // an actual opposite pair of the puzzle, or the convention is decorative rather than real.
    const geo = loadGeometry('4-3-3_3');
    const palette = paletteById(id);
    const colors = assignFaceColors(geo.nFaces, geo.face2OppositeFace, palette);
    const key = (c: { r: number; g: number; b: number }) => `${c.r},${c.g},${c.b}`;

    for (const [a, b] of palette.pairs) {
      const faceA = colors.findIndex((c) => key(c) === key(a));
      const faceB = colors.findIndex((c) => key(c) === key(b));
      expect(faceA, `${id}: ${key(a)} unused`).toBeGreaterThanOrEqual(0);
      expect(geo.face2OppositeFace[faceA]).toBe(faceB);
    }
  });

  it.each(['distinct', 'vivid', 'classic'])('gives %s eight distinct colours', (id) => {
    const geo = loadGeometry('4-3-3_3');
    const colors = assignFaceColors(geo.nFaces, geo.face2OppositeFace, paletteById(id));
    expect(new Set(colors.map((c) => `${c.r},${c.g},${c.b}`)).size).toBe(8);
    expect(paletteSwatches(paletteById(id))).toHaveLength(8);
  });

  it('keeps the convention on the 120-cell, where no palette is big enough', () => {
    const geo = loadGeometry('5-3-3_2');
    const colors = assignFaceColors(geo.nFaces, geo.face2OppositeFace, paletteById('distinct'));
    expect(colors).toHaveLength(geo.nFaces);
    for (const c of colors) {
      for (const channel of [c.r, c.g, c.b]) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(255);
      }
    }
    // Opposite cells should be a light and a dark of one hue, so never identical but always close
    // in hue — which is exactly the Rubik's relationship, generated rather than hand-picked.
    let checked = 0;
    for (let f = 0; f < geo.nFaces && checked < 20; ++f) {
      const o = geo.face2OppositeFace[f];
      if (o <= f) continue;
      expect(colors[f]).not.toEqual(colors[o]);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('colours a simplex, which has no opposite faces at all', () => {
    const geo = loadGeometry('3-3-3_3');
    for (let f = 0; f < geo.nFaces; ++f) expect(geo.face2OppositeFace[f]).toBe(-1);
    const colors = assignFaceColors(geo.nFaces, geo.face2OppositeFace, paletteById('distinct'));
    expect(colors).toHaveLength(geo.nFaces);
    expect(new Set(colors.map((c) => `${c.r},${c.g},${c.b}`)).size).toBe(geo.nFaces);
  });
});
