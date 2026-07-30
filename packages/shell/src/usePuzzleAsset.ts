/**
 * The puzzle an app is showing: the catalog, the geometry, and the settings for drawing it.
 *
 * Everything here is per *app* rather than per viewport. Splitting it out of `usePuzzleCanvas` is
 * what makes several viewports possible: they share one download, one decoded geometry — megabytes
 * of typed arrays — and one set of shape and colour settings, and differ only in where the camera
 * is pointing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { type Catalog, type CatalogEntry, type PuzzleGeometry } from '@mc4d/puzzle-core';

import { appKey } from './storage.js';
import { loadPuzzle } from './usePuzzle.js';
import { DEFAULT_CONTROLS, DEFAULT_CONTROLS_3D, type ViewControls } from './viewControls.js';

// Per app, not per person. The palette was shared at first, on the reasoning that someone who needs
// a high-contrast one needs it everywhere. That reasoning survives — see the note in storage.ts —
// but it collided with something more basic: the classic app is meant to look like the original and
// the multi-view app is meant to be legible in three small panes at once, and those are different
// pictures. A shared key made the app you opened last decide what the next one looked like.
//
// Resolved on each call rather than once at module load: the app names itself at startup, which
// happens after this module is imported.
function paletteKey(): string {
  return appKey('palette');
}

function readStoredPalette(): string | null {
  try {
    return globalThis.localStorage?.getItem(paletteKey()) ?? null;
  } catch {
    // Storage can be unavailable in private modes and inside sandboxed frames.
    return null;
  }
}

function storePalette(id: string): void {
  try {
    globalThis.localStorage?.setItem(paletteKey(), id);
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

export interface PuzzleAssetOptions {
  /**
   * Which puzzles this app is for. Applied to the catalog as it arrives, so the picker, permalinks
   * and any restored session all see the same set — an app cannot be talked into loading a puzzle it
   * was not built to draw. Omit to accept everything.
   */
  accepts?: (entry: CatalogEntry) => boolean;
  /**
   * Which palette this app opens with, for an app whose character calls for a different one. Only a
   * default: a palette the visitor has actually chosen still wins, here and everywhere else.
   */
  defaultPaletteId?: string;
}

export function usePuzzleAsset(
  assetBase: string,
  initial: { id: string; path: string },
  options: PuzzleAssetOptions = {},
): PuzzleAsset {
  const [geometry, setGeometry] = useState<PuzzleGeometry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [target, setTarget] = useState(initial);
  // Held in a ref so passing an inline predicate does not refetch the catalog every render.
  const acceptsRef = useRef(options.accepts);
  acceptsRef.current = options.accepts;
  const [controls, setControlsState] = useState<ViewControls>(() => ({
    ...DEFAULT_CONTROLS,
    // A choice made in this app survives a reload. Failing that, the app's own default — which is
    // where someone who has never chosen starts.
    paletteId: readStoredPalette() ?? options.defaultPaletteId ?? DEFAULT_CONTROLS.paletteId,
  }));

  useEffect(() => {
    let cancelled = false;
    fetch(`${assetBase}manifest.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`manifest ${r.status}`))))
      .then((c: Catalog) => {
        if (cancelled) return;
        setCatalog(acceptsRef.current ? { ...c, puzzles: c.puzzles.filter(acceptsRef.current) } : c);
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
