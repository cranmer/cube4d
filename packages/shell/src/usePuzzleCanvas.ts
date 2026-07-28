/**
 * Wires the renderer to a canvas: pointer input, wheel zoom, resize, and the render loop.
 *
 * The one subtlety is telling a click from a drag. The same button both rotates the puzzle and
 * twists it, so a press that moves is a rotation and a press that doesn't is a twist — which is how
 * the original behaves, and it stays out of the way once your hands learn it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  canonicalViewById,
  continueSpin,
  createRotation,
  drag,
  interpolateRotation,
  nextCanonicalView,
  stopSpinning,
  type PuzzleGeometry,
  type RotationState,
} from '@mc4d/puzzle-core';
import { DEFAULT_PALETTE_ID, paletteById, PuzzleRenderer } from '@mc4d/render';

import { sharedKey } from './storage.js';
import { loadPuzzle } from './usePuzzle.js';
import type { Catalog } from '@mc4d/puzzle-core';

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

/** A press that moves less than this is a click, not a drag. */
const DRAG_THRESHOLD_PX = 4;

/**
 * How long a glide between viewpoints takes.
 *
 * Long enough to be followed — the whole point is to show you how the orientations relate, and an
 * instant cut would teach nothing — and short enough not to be in the way when stepping through
 * several in a row.
 */
const VIEW_GLIDE_MS = 520;

/** Ease in and out, so a glide starts and ends at rest rather than jerking. */
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export interface CanvasHandlers {
  onTap(x: number, y: number, button: number): void;
  onHover(x: number, y: number): void;
  onLeave(): void;
}

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
  /**
   * Which named viewpoint the camera is at or heading for, or null once it has been dragged away.
   */
  readonly canonicalView: string | null;
  /** Glide to a named viewpoint. */
  goToCanonicalView(id: string): void;
  /** Glide to the next or previous viewpoint in the list. */
  stepCanonicalView(step: 1 | -1): void;
  getRenderer(): PuzzleRenderer | null;
  /** The current 4D view rotation, row-major, as `.log` files store it. */
  getRotation(): number[];
  setRotation(mat4d: readonly number[]): void;
}

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
 * and retaining them on every render. A module-level cache also means revisiting a puzzle is free.
 */
const geometryCache = new Map<string, PuzzleGeometry>();

export function usePuzzleCanvas(
  assetBase: string,
  initial: { id: string; path: string },
  handlers: CanvasHandlers,
): PuzzleCanvas {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<PuzzleRenderer | null>(null);
  const rotationRef = useRef<RotationState>(createRotation());
  // A glide in progress: where it started, where it is going, and when it began. Held in a ref so
  // the render loop can read it without re-subscribing every frame.
  const glideRef = useRef<{ from: Float64Array; to: readonly number[]; startedAt: number } | null>(
    null,
  );
  const [canonicalView, setCanonicalView] = useState<string | null>('default');
  // Held in a ref so the pointer listeners never need re-binding when a callback identity changes.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

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

  // --- the catalog: a small index, fetched once
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

  useEffect(() => {
    if (!canvasRef.current || !geometry) return;
    let renderer: PuzzleRenderer;
    try {
      renderer = new PuzzleRenderer({ canvas: canvasRef.current });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    rendererRef.current = renderer;
    const palette = paletteById(controls.paletteId);
    renderer.setPuzzle(geometry, palette);
    renderer.setBackground(palette.background);
    renderer.setRotation(rotationRef.current.mat);
    renderer.setViewParams(controls);
    renderer.setOpacity(controls.opacity);

    const canvas = canvasRef.current;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    // A handle for automated testing: lets a headless browser interrogate the picker and drive the
    // view deterministically, neither of which is reachable through the UI.
    (globalThis as unknown as { __mc4d?: unknown }).__mc4d = {
      renderer,
      geometry,
      pick: (x: number, y: number) => renderer.pick(x, y),
    };

    let frame = 0;
    const tick = () => {
      const glide = glideRef.current;
      if (glide) {
        const t = Math.min(1, (performance.now() - glide.startedAt) / VIEW_GLIDE_MS);
        const mat = interpolateRotation(glide.from, glide.to, easeInOut(t));
        rotationRef.current = { mat, spin: null };
        renderer.setRotation(mat);
        if (t >= 1) glideRef.current = null;
      } else {
        const spun = continueSpin(rotationRef.current);
        if (spun !== rotationRef.current || spun.spin) {
          rotationRef.current = spun;
          renderer.setRotation(spun.mat);
        }
      }
      renderer.render();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [geometry]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !geometry) return;

    let pressed = false;
    let moved = false;
    let button: 'left' | 'middle' | 'right' = 'left';
    let rawButton = 0;
    let start = { x: 0, y: 0 };
    let last = { x: 0, y: 0 };

    // Touch: track every finger so two of them can pinch. Rotation is suspended while pinching,
    // otherwise the puzzle lurches as the fingers converge.
    const active = new Map<number, { x: number; y: number }>();
    let pinchDistance = 0;

    const spread = () => {
      const [a, b] = [...active.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };

    const local = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const onPointerDown = (event: PointerEvent) => {
      active.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (active.size === 2) {
        // A second finger cancels the tap and starts a pinch.
        pressed = false;
        moved = true;
        pinchDistance = spread();
        return;
      }
      pressed = true;
      moved = false;
      rawButton = event.button;
      button = event.button === 2 ? 'right' : event.button === 1 ? 'middle' : 'left';
      start = { x: event.clientX, y: event.clientY };
      last = start;
      rotationRef.current = stopSpinning(rotationRef.current);
      canvas.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (active.has(event.pointerId)) {
        active.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }
      if (active.size >= 2) {
        const distance = spread();
        if (pinchDistance > 0 && distance > 0) {
          const renderer = rendererRef.current;
          if (renderer) renderer.setZoom(renderer.getZoom() * (distance / pinchDistance));
        }
        pinchDistance = distance;
        return;
      }
      if (!pressed) {
        const p = local(event);
        handlersRef.current.onHover(p.x, p.y);
        return;
      }
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > DRAG_THRESHOLD_PX) {
        moved = true;
      }
      if (!moved) return;

      // The original measures the drag as (previous − current) and inverts Y, since screen Y grows
      // downward. Matching that keeps the puzzle following the cursor rather than opposing it.
      const dx = last.x - event.clientX;
      const dy = -(last.y - event.clientY);
      last = { x: event.clientX, y: event.clientY };

      // Dragging abandons whatever viewpoint we were at or gliding towards; the label going blank
      // is the honest report of that.
      glideRef.current = null;
      setCanonicalView(null);
      rotationRef.current = drag(rotationRef.current, dx, dy, {
        button,
        // Shift switches from the XZ/YZ rotation that reads as a 3D trackball to the XW/YW one
        // that turns the puzzle through the fourth dimension.
        shift: event.shiftKey,
      });
      rendererRef.current?.setRotation(rotationRef.current.mat);
    };

    const onPointerUp = (event: PointerEvent) => {
      active.delete(event.pointerId);
      if (active.size < 2) pinchDistance = 0;
      if (pressed && !moved) {
        const p = local(event);
        handlersRef.current.onTap(p.x, p.y, rawButton);
      }
      pressed = false;
      // Lifting one finger of a pinch leaves the other down; don't treat it as the start of a drag.
      if (active.size === 1) {
        const [remaining] = [...active.values()];
        last = { x: remaining.x, y: remaining.y };
        start = last;
        pressed = true;
        moved = true;
      }
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };

    const onPointerLeave = () => handlersRef.current.onLeave();

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const renderer = rendererRef.current;
      if (renderer) renderer.setZoom(renderer.getZoom() * (event.deltaY > 0 ? 0.92 : 1.08));
    };

    // Right-click both twists and rotates, so the context menu must not appear over the canvas.
    const onContextMenu = (event: Event) => event.preventDefault();

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
    };
  }, [geometry]);

  const setControls = (next: Partial<ViewControls>) => {
    setControlsState((current) => {
      const merged = { ...current, ...next };
      rendererRef.current?.setViewParams(merged);
      if (next.opacity !== undefined) rendererRef.current?.setOpacity(next.opacity);
      if (next.paletteId !== undefined) {
        storePalette(next.paletteId);
        rendererRef.current?.setPalette(paletteById(next.paletteId));
      }
      return merged;
    });
  };

  const resetView = () => {
    glideRef.current = null;
    setCanonicalView('default');
    rotationRef.current = createRotation();
    rendererRef.current?.setRotation(rotationRef.current.mat);
    rendererRef.current?.setZoom(1);
  };

  const goToCanonicalView = useCallback((id: string) => {
    const view = canonicalViewById(id);
    if (!view) return;
    // Start from wherever the camera is now, including mid-glide, so repeated presses chain
    // smoothly instead of snapping back to the last waypoint.
    glideRef.current = {
      from: Float64Array.from(rotationRef.current.mat),
      to: view.mat,
      startedAt: performance.now(),
    };
    setCanonicalView(view.id);
  }, []);

  const stepCanonicalView = useCallback(
    (step: 1 | -1) => {
      setCanonicalView((current) => {
        const view = nextCanonicalView(current, step);
        glideRef.current = {
          from: Float64Array.from(rotationRef.current.mat),
          to: view.mat,
          startedAt: performance.now(),
        };
        return view.id;
      });
    },
    [],
  );

  const getRenderer = useCallback(() => rendererRef.current, []);
  const getRotation = useCallback(() => Array.from(rotationRef.current.mat), []);
  const setRotation = useCallback((mat4d: readonly number[]) => {
    if (mat4d.length !== 16) return;
    glideRef.current = null;
    setCanonicalView(null);
    rotationRef.current = { mat: Float64Array.from(mat4d), spin: null };
    rendererRef.current?.setRotation(rotationRef.current.mat);
  }, []);

  const selectPuzzle = useCallback((id: string, path: string) => {
    setError(null);
    setTarget({ id, path });
  }, []);

  return {
    canvasRef,
    geometry,
    error,
    loading,
    loadingId,
    catalog,
    puzzleId: target.id,
    selectPuzzle,
    controls,
    setControls,
    resetView,
    canonicalView,
    goToCanonicalView,
    stepCanonicalView,
    getRenderer,
    getRotation,
    setRotation,
  };
}
