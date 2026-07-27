/**
 * Decoder for the .mc4dpz puzzle asset produced by `tools/exporter`.
 *
 * The container is a magic string, a JSON block table, then 8-byte-aligned typed-array blocks.
 * Decoding creates views directly onto the incoming ArrayBuffer — nothing is copied and no numbers
 * are parsed, so loading the largest puzzle in the catalog costs about as much as the fetch.
 */

const MAGIC = 'MC4DPZ\0';
const SUPPORTED_VERSION = 1;

type DType = 'f32' | 'f64' | 'u8' | 'u16' | 'u32' | 'i32';

interface BlockSpec {
  offset: number;
  length: number;
  dtype: DType;
  shape: number[];
}

interface AssetHeader {
  format: string;
  assetsVersion: string;
  schlafli: string;
  edgeLength: number;
  nDims: number;
  nFaces: number;
  nCubies: number;
  nStickers: number;
  nGrips: number;
  nVerts: number;
  nPolys: number;
  circumRadius: number;
  inRadius: number;
  blocks: Record<string, BlockSpec>;
}

/**
 * A puzzle's geometry: everything the running app needs, and nothing it doesn't.
 *
 * Notably absent is any polytope or CSG structure. The original computes all of this by slicing a
 * regular 4D polytope with hyperplanes, but never consults that structure again once construction
 * finishes — so it isn't shipped.
 */
export interface PuzzleGeometry {
  readonly id: string;
  readonly assetsVersion: string;
  readonly schlafli: string;
  readonly edgeLength: number;

  readonly nDims: number;
  readonly nFaces: number;
  readonly nCubies: number;
  readonly nStickers: number;
  readonly nGrips: number;
  readonly nVerts: number;
  readonly nPolys: number;
  readonly circumRadius: number;
  readonly inRadius: number;

  // --- render geometry (f32: bit-exact with the Java, which also narrows to float here)
  /** Per vertex, its offset from its own sticker's centre. `nVerts * nDims`. */
  readonly vertsMinusStickerCenters: Float32Array;
  /** Per sticker, its centre's offset from its face's centre. `nStickers * nDims`. */
  readonly stickerCenterMinusFaceCenter: Float32Array;
  /** Per face, its centre. `nFaces * nDims`. */
  readonly faceCenters: Float32Array;

  // --- sticker topology. Each sticker owns a contiguous, private vertex range.
  readonly stickerVertBegin: Uint32Array;
  readonly stickerVertCount: Uint16Array;
  readonly stickerPolyCount: Uint16Array;
  readonly polyVertCount: Uint8Array;
  /** Polygon vertex indices, relative to the owning sticker's `stickerVertBegin`. */
  readonly polyIndsLocal: Uint8Array;

  readonly sticker2face: Uint16Array;
  /** Union-find representatives, so values are non-consecutive rather than a dense range. */
  readonly sticker2cubie: Uint32Array;
  /** -1 where a face has no opposite, as on a simplex. */
  readonly face2OppositeFace: Int32Array;

  // --- twist path (f64: mandatory, see fuzzyPointHash.ts)
  readonly stickerCenters: Float64Array;
  readonly faceInwardNormals: Float64Array;
  readonly faceCutCounts: Uint8Array;
  readonly faceCutOffsets: Float64Array;
  /** Start of each face's run within `faceCutOffsets`. Derived at load. */
  readonly faceCutBegin: Uint32Array;

  readonly gripUsefulMats: Float64Array;
  readonly gripCenters: Float32Array;
  readonly gripDims: Uint8Array;
  readonly grip2face: Uint16Array;
  /** 0 means the grip cannot rotate; 1 means a 360° no-op. Both must be filtered out. */
  readonly gripSymmetryOrders: Uint16Array;

  readonly nicePoints: Float32Array;
}

export function decodeAsset(buffer: ArrayBuffer): PuzzleGeometry {
  const bytes = new Uint8Array(buffer);

  for (let i = 0; i < MAGIC.length; ++i) {
    if (bytes[i] !== MAGIC.charCodeAt(i)) throw new Error('not a .mc4dpz file');
  }
  const version = bytes[MAGIC.length];
  if (version !== SUPPORTED_VERSION) {
    throw new Error(`unsupported .mc4dpz version ${version}, expected ${SUPPORTED_VERSION}`);
  }

  const view = new DataView(buffer);
  const headerLen = view.getUint32(MAGIC.length + 1, true);
  const headerStart = MAGIC.length + 1 + 4;
  const headerText = new TextDecoder().decode(bytes.subarray(headerStart, headerStart + headerLen));
  const header = JSON.parse(headerText) as AssetHeader;

  const block = (name: string): BlockSpec => {
    const spec = header.blocks[name];
    if (!spec) throw new Error(`.mc4dpz is missing block "${name}"`);
    return spec;
  };
  const count = (name: string, bytesPerElement: number): number => {
    const spec = block(name);
    if (spec.length % bytesPerElement !== 0) {
      throw new Error(`block "${name}" length ${spec.length} is not a multiple of ${bytesPerElement}`);
    }
    return spec.length / bytesPerElement;
  };

  // Views, not copies. The exporter aligns every block to 8 bytes, which is what makes the Float64
  // views legal — JavaScript throws if a typed array's byteOffset is misaligned for its element.
  const f32 = (name: string) => new Float32Array(buffer, block(name).offset, count(name, 4));
  const f64 = (name: string) => new Float64Array(buffer, block(name).offset, count(name, 8));
  const u8 = (name: string) => new Uint8Array(buffer, block(name).offset, count(name, 1));
  const u16 = (name: string) => new Uint16Array(buffer, block(name).offset, count(name, 2));
  const u32 = (name: string) => new Uint32Array(buffer, block(name).offset, count(name, 4));
  const i32 = (name: string) => new Int32Array(buffer, block(name).offset, count(name, 4));

  const faceCutCounts = u8('faceCutCounts');
  const faceCutBegin = new Uint32Array(faceCutCounts.length);
  for (let f = 1; f < faceCutCounts.length; ++f) {
    faceCutBegin[f] = faceCutBegin[f - 1] + faceCutCounts[f - 1];
  }

  const geometry: PuzzleGeometry = {
    id: `${header.schlafli} ${formatLength(header.edgeLength)}`,
    assetsVersion: header.assetsVersion,
    schlafli: header.schlafli,
    edgeLength: header.edgeLength,

    nDims: header.nDims,
    nFaces: header.nFaces,
    nCubies: header.nCubies,
    nStickers: header.nStickers,
    nGrips: header.nGrips,
    nVerts: header.nVerts,
    nPolys: header.nPolys,
    circumRadius: header.circumRadius,
    inRadius: header.inRadius,

    vertsMinusStickerCenters: f32('vertsMinusStickerCenters'),
    stickerCenterMinusFaceCenter: f32('stickerCenterMinusFaceCenter'),
    faceCenters: f32('faceCenters'),

    stickerVertBegin: u32('stickerVertBegin'),
    stickerVertCount: u16('stickerVertCount'),
    stickerPolyCount: u16('stickerPolyCount'),
    polyVertCount: u8('polyVertCount'),
    polyIndsLocal: u8('polyIndsLocal'),

    sticker2face: u16('sticker2face'),
    sticker2cubie: u32('sticker2cubie'),
    face2OppositeFace: i32('face2OppositeFace'),

    stickerCenters: f64('stickerCenters'),
    faceInwardNormals: f64('faceInwardNormals'),
    faceCutCounts,
    faceCutOffsets: f64('faceCutOffsets'),
    faceCutBegin,

    gripUsefulMats: f64('gripUsefulMats'),
    gripCenters: f32('gripCenters'),
    gripDims: u8('gripDims'),
    grip2face: u16('grip2face'),
    gripSymmetryOrders: u16('gripSymmetryOrders'),

    nicePoints: f32('nicePoints'),
  };

  validate(geometry);
  return geometry;
}

/** Cheap structural checks. A malformed asset should fail here, not deep in a twist. */
function validate(g: PuzzleGeometry): void {
  const expect = (actual: number, wanted: number, what: string) => {
    if (actual !== wanted) throw new Error(`.mc4dpz: ${what} is ${actual}, expected ${wanted}`);
  };
  expect(g.stickerCenters.length, g.nStickers * g.nDims, 'stickerCenters length');
  expect(g.vertsMinusStickerCenters.length, g.nVerts * g.nDims, 'vertsMinusStickerCenters length');
  expect(g.faceInwardNormals.length, g.nFaces * g.nDims, 'faceInwardNormals length');
  expect(g.gripUsefulMats.length, g.nGrips * g.nDims * g.nDims, 'gripUsefulMats length');
  expect(g.sticker2face.length, g.nStickers, 'sticker2face length');
  expect(g.grip2face.length, g.nGrips, 'grip2face length');
  expect(g.polyVertCount.length, g.nPolys, 'polyVertCount length');
}

/** Matches the original's "pretty length": integral lengths lose their decimal point. */
export function formatLength(length: number): string {
  return Number.isInteger(length) ? String(length) : String(length);
}
