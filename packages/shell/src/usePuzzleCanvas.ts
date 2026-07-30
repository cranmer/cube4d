/**
 * One puzzle, one canvas — the shape almost every app wants.
 *
 * This is now a composition of `usePuzzleAsset` (the catalog, the geometry and the drawing
 * settings, all per app) and a single `useViewport` (the camera and the pointer input, per canvas).
 * It exists because most front-ends have exactly one viewport and should not have to wire two hooks
 * together to say so. An app that wants several calls the two directly.
 */

import { useCallback, useMemo } from 'react';
import type { PuzzleRenderer } from '@mc4d/render';

import { usePuzzleAsset, type PuzzleAssetOptions } from './usePuzzleAsset.js';
import { useViewport, type ViewportHandlers } from './useViewport.js';
import type { Catalog, PuzzleGeometry } from '@mc4d/puzzle-core';
import type { ViewControls } from './viewControls.js';

export type CanvasHandlers = ViewportHandlers;

export interface PuzzleCanvas {
  readonly canvasRef: React.RefObject<HTMLCanvasElement>;
  readonly geometry: PuzzleGeometry | null;
  readonly error: string | null;
  readonly loading: boolean;
  /** Id of the puzzle currently being fetched, or null. */
  readonly loadingId: string | null;
  readonly catalog: Catalog | null;
  readonly puzzleId: string;
  selectPuzzle(id: string, path: string): void;
  readonly controls: ViewControls;
  setControls(controls: Partial<ViewControls>): void;
  resetView(): void;
  getRenderer(): PuzzleRenderer | null;
  /** Every viewport, for the session to broadcast to. One, here. */
  getViews(): readonly PuzzleRenderer[];
  /** The current 4D view rotation, row-major, as `.log` files store it. */
  getRotation(): number[];
  setRotation(mat4d: readonly number[]): void;
  readonly canonicalView: string | null;
  goToCanonicalView(id: string): void;
  stepCanonicalView(step: 1 | -1): void;
  turnQuarter(step: 1 | -1): void;
  tip(step: 1 | -1): void;
  flip(): void;
}

export function usePuzzleCanvas(
  assetBase: string,
  initial: { id: string; path: string },
  handlers: CanvasHandlers,
  options: PuzzleAssetOptions = {},
): PuzzleCanvas {
  const asset = usePuzzleAsset(assetBase, initial, options);
  const viewport = useViewport(asset.geometry, asset.controls, handlers, {
    onError: asset.reportError,
  });

  const { getRenderer } = viewport;
  const getViews = useCallback(() => {
    const renderer = getRenderer();
    return renderer ? [renderer] : [];
  }, [getRenderer]);

  return useMemo(
    () => ({ ...asset, ...viewport, getViews }),
    [asset, viewport, getViews],
  );
}
