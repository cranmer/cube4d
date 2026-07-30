/**
 * The puzzle an app is showing: the catalog, the geometry, and the settings for drawing it.
 *
 * Everything here is per *app* rather than per viewport. Splitting it out of `usePuzzleCanvas` is
 * what makes several viewports possible: they share one download, one decoded geometry — megabytes
 * of typed arrays — and one set of shape and colour settings, and differ only in where the camera
 * is pointing.
 */

import { useCallback, useEffect, useState } from 'react';
import { type Catalog, type PuzzleGeometry } from '@mc4d/puzzle-core';

import { sharedKey } from './storage.js';
import { loadPuzzle } from './usePuzzle.js';
import { DEFAULT_CONTROLS, DEFAULT_CONTROLS_3D, type ViewControls } from './viewControls.js';

// Shared across apps: partly a taste, partly an accessibility need, and asking twice is a defect.
const PALETTE_KEY = sharedKey('palette');

function readStoredPalette(): string | null {
  try {
    return globalThis.localStorage?.getItem(PALETTE_KEY) ?? null;
  } catch {
    // Storage can be unavailable in private modes and inside sandboxed frames.
    return null;
  }
}

function storePalette(id: string): void {
  try {
    globalThis.localStorage?.setItem(PALETTE_KEY, id);
  } catch {
    /* not worth surfacing */
  }
}

/**
 * Decoded geometry, kept outside React.
 *
 * These are megabytes of typed arrays; putting them in component state would mean React comparing
 * and retaining them on every render. A module-level cache also means revisiting a puzzle is free —
 * and that N viewports of one puzzle hold one copy between them, not N.
 */
const geometryCache = new Map<string, PuzzleGeometry>();

export interface PuzzleAsset {
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
  /** So a viewport can report a WebGL failure through the same channel as a download failure. */
  reportError(message: string): void;
}

export function usePuzzleAsset(
  assetBase: string,
  initial: { id: string; path: string },
): PuzzleAsset {
  const [geometry, setGeometry] = useState<PuzzleGeometry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [target, setTarget] = useState(initial);
  const [controls, setControlsState] = useState<ViewControls>(() => ({
    ...DEFAULT_CONTROLS,
    // The palette is a taste and an accessibility choice, so it should survive a reload.
    paletteId: readStoredPalette() ?? DEFAULT_CONTROLS.paletteId,
  }));

  useEffect(() => {
    let cancelled = false;
    fetch(`${assetBase}manifest.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`manifest ${r.status}`))))
      .then((c: Catalog) => {
        if (!cancelled) setCatalog(c);
      })
      .catch(() => {
        // The catalog is a convenience; without it the app still plays whatever loaded.
        if (!cancelled) setCatalog(null);
      });
    return () => {
      cancelled = true;
    };
  }, [assetBase]);

  // --- the puzzle itself, fetched on demand
  useEffect(() => {
    let cancelled = false;
    const cached = geometryCache.get(target.id);
    if (cached) {
      adoptShapeDefaults(cached);
      setGeometry(cached);
      setLoading(false);
      setLoadingId(null);
      return;
    }
    setLoading(true);
    setLoadingId(target.id);
    loadPuzzle(`${assetBase}${target.path}.gz`)
      .then((geo) => {
        geometryCache.set(target.id, geo);
        if (!cancelled) {
          adoptShapeDefaults(geo);
          setGeometry(geo);
          setLoading(false);
          setLoadingId(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
          setLoadingId(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [assetBase, target]);

  /**
   * Reframe when crossing between a solid and a hypercube.
   *
   * Shape settings that suit one are wrong for the other — 0.4 face shrink separates a hypercube's
   * cells so you can see inside, and blows a cube apart into six floating sheets. Only the shape
   * settings move; palette and opacity are about taste and stay where they were put.
   */
  const adoptShapeDefaults = useCallback((geo: PuzzleGeometry) => {
    setControlsState((current) => {
      const wanted = geo.nDims < 4 ? DEFAULT_CONTROLS_3D : DEFAULT_CONTROLS;
      if (current.faceShrink === wanted.faceShrink && current.stickerShrink === wanted.stickerShrink) {
        return current;
      }
      return { ...current, faceShrink: wanted.faceShrink, stickerShrink: wanted.stickerShrink };
    });
  }, []);

  const setControls = useCallback((next: Partial<ViewControls>) => {
    setControlsState((current) => {
      if (next.paletteId !== undefined) storePalette(next.paletteId);
      return { ...current, ...next };
    });
  }, []);

  const selectPuzzle = useCallback((id: string, path: string) => {
    setError(null);
    setTarget({ id, path });
  }, []);

  return {
    geometry,
    error,
    loading,
    loadingId,
    catalog,
    puzzleId: target.id,
    selectPuzzle,
    controls,
    setControls,
    reportError: setError,
  };
}
