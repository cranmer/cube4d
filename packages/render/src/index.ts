export { PuzzleRenderer, type RendererOptions } from './PuzzleRenderer.js';
export {
  buildBuffers,
  widenTo4D,
  buildFaceColorTexture,
  buildPickGeometry,
  setTwistingSlice,
  updateStickerColors,
  type PuzzleBuffers,
} from './buildGeometry.js';
export {
  assignFaceColors,
  DEFAULT_FACE_COLORS,
  DEFAULT_PALETTE_ID,
  PALETTES,
  paletteById,
  paletteSwatches,
  SKY,
  type ColorPair,
  type Palette,
  type Rgb,
} from './colors.js';
export {
  countVisibleStickers,
  cullWitnesses,
  DEFAULT_VIEW,
  isBackCell,
  projectedRadius,
  projectPoint,
  vertexToSticker,
  visibleStickerMask,
  type ViewParams,
} from './pipeline.js';
export {
  fragmentShader,
  pickFragmentShader,
  pickVertexShader,
  STICKER_TEXEL,
  TEXELS_PER_STICKER,
  vertexShader,
} from './shaders.js';
