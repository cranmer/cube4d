export { PuzzleRenderer, type RendererOptions } from './PuzzleRenderer.js';
export { buildBuffers, buildFaceColorTexture, updateStickerColors, type PuzzleBuffers } from './buildGeometry.js';
export { DEFAULT_FACE_COLORS, facePalette, SKY, type Rgb } from './colors.js';
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
export { fragmentShader, STICKER_TEXEL, TEXELS_PER_STICKER, vertexShader } from './shaders.js';
