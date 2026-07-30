/**
 * The settings that describe how the puzzle is drawn, as opposed to where it is seen from.
 *
 * These are app-wide, not per viewport: face shrink, transparency and palette are answers to "what
 * should this look like", and an app showing the same puzzle from three angles wants one answer, not
 * three. Where the camera is pointing is the per-viewport question, and lives in `useViewport`.
 */

import { DEFAULT_PALETTE_ID } from '@mc4d/render';

export interface ViewControls {
  faceShrink: number;
  stickerShrink: number;
  eyeW: number;
  /** 1 is solid. Below that the puzzle becomes a glass model of itself. */
  opacity: number;
  paletteId: string;
}

export const DEFAULT_CONTROLS: ViewControls = {
  faceShrink: 0.4,
  stickerShrink: 0.5,
  eyeW: 1.05,
  opacity: 1,
  paletteId: DEFAULT_PALETTE_ID,
};

/**
 * Defaults for a puzzle of fewer than four dimensions.
 *
 * The 4D numbers pull the cells apart, which is the whole reason the hypercube is legible: without
 * that separation you would see only the outermost cell. A solid needs the opposite — its faces
 * belong where they are, and the stickers want the narrow seams a real cube has.
 */
export const DEFAULT_CONTROLS_3D: ViewControls = {
  ...DEFAULT_CONTROLS,
  faceShrink: 1,
  stickerShrink: 0.9,
};
