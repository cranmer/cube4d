/**
 * Loading helpers for the golden fixtures produced by `tools/exporter`.
 *
 * Both assets and permutation dumps are stored gzipped — which also means the test suite exercises
 * the same decompression path the browser will use.
 */

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

import { decodeAsset, type PuzzleGeometry } from '../src/asset.js';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/**
 * The puzzles with committed goldens, chosen to exercise different parts of the original's
 * construction rather than for coverage's sake.
 */
export const GOLDEN_PUZZLES = [
  { id: '{4,3,3} 3', file: '4-3-3_3', note: 'the default puzzle — dumped exhaustively' },
  { id: '{4,3,3} 2', file: '4-3-3_2', note: 'even length: the coincident-cut epsilon path' },
  { id: '{3,3,3} 3', file: '3-3-3_3', note: 'simplex: no opposite faces, all cuts on the near side' },
  { id: '{3}x{3} 3', file: '3x3_3', note: 'uniform triangular duoprism: special-case cut logic' },
  { id: '{5}x{4} 3', file: '5x4_3', note: 'an ordinary duoprism' },
  { id: '{5,3}x{} 3', file: '5-3x_3', note: 'dodecahedral prism: hardcoded polytope data' },
  { id: '{100}x{4} 3', file: '100x4_3', note: 'circumradius 31.87: the precision stress case' },
  { id: '{5,3,3} 2', file: '5-3-3_2', note: 'the largest puzzle in the catalog' },
] as const;

/**
 * Read a file into a standalone, 8-byte-aligned ArrayBuffer.
 *
 * Node pools Buffer allocations, so a Buffer's byteOffset is usually not 8-aligned — and the
 * Float64Array views the decoder creates would throw a RangeError.
 */
function toAlignedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

export function loadGeometry(file: string): PuzzleGeometry {
  const gz = readFileSync(`${ROOT}/fixtures/assets/${file}.mc4dpz.gz`);
  return decodeAsset(toAlignedArrayBuffer(gunzipSync(gz)));
}

export interface GoldenEntry {
  grip: number;
  dir: number;
  mask: number;
  perm: Int32Array;
}

export interface Goldens {
  nStickers: number;
  /** How many legal moves the puzzle has in total, which may exceed the number sampled. */
  entries: GoldenEntry[];
}

/**
 * Golden permutation dump. Layout (little-endian): "MC4DPERM", u32 version, u32 nStickers,
 * u32 nEntries, u32 pad, then nEntries x {i32 grip, i32 dir, i32 mask}, then the permutations as
 * nEntries x nStickers x i32.
 *
 * Convention: `perm[destination] = source`.
 */
export function loadGoldens(file: string): Goldens {
  const gz = readFileSync(`${ROOT}/fixtures/perm/${file}.bin.gz`);
  const buf = toAlignedArrayBuffer(gunzipSync(gz));
  const view = new DataView(buf);

  const magic = new TextDecoder().decode(new Uint8Array(buf, 0, 8));
  if (magic !== 'MC4DPERM') throw new Error(`bad golden magic in ${file}: ${magic}`);
  if (view.getUint32(8, true) !== 1) throw new Error(`unsupported golden version in ${file}`);

  const nStickers = view.getUint32(12, true);
  const nEntries = view.getUint32(16, true);
  const metaBase = 24;
  const permBase = metaBase + nEntries * 12;

  const entries: GoldenEntry[] = [];
  for (let i = 0; i < nEntries; ++i) {
    entries.push({
      grip: view.getInt32(metaBase + i * 12, true),
      dir: view.getInt32(metaBase + i * 12 + 4, true),
      mask: view.getInt32(metaBase + i * 12 + 8, true),
      perm: new Int32Array(buf, permBase + i * nStickers * 4, nStickers),
    });
  }
  return { nStickers, entries };
}
