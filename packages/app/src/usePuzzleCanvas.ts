/**
 * Wires the renderer to a canvas: pointer input, wheel zoom, resize, and the render loop.
 *
 * The one subtlety is telling a click from a drag. The same button both rotates the puzzle and
 * twists it, so a press that moves is a rotation and a press that doesn't is a twist — which is how
 * the original behaves, and it stays out of the way once your hands learn it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  continueSpin,
  createRotation,
  drag,
  stopSpinning,
  type PuzzleGeometry,
  type RotationState,
} from '@mc4d/puzzle-core';
import { DEFAULT_PALETTE_ID, paletteById, PuzzleRenderer } from '@mc4d/render';

import { loadPuzzle } from './usePuzzle.js';

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
  readonly controls: ViewControls;
  setControls(controls: Partial<ViewControls>): void;
  resetView(): void;
  getRenderer(): PuzzleRenderer | null;
}

const PALETTE_KEY = 'mc4d.palette';

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

export function usePuzzleCanvas(assetUrl: string, handlers: CanvasHandlers): PuzzleCanvas {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<PuzzleRenderer | null>(null);
  const rotationRef = useRef<RotationState>(createRotation());
  // Held in a ref so the pointer listeners never need re-binding when a callback identity changes.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const [geometry, setGeometry] = useState<PuzzleGeometry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [controls, setControlsState] = useState<ViewControls>(() => ({
    ...DEFAULT_CONTROLS,
    // The palette is a taste and an accessibility choice, so it should survive a reload.
    paletteId: readStoredPalette() ?? DEFAULT_CONTROLS.paletteId,
  }));

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadPuzzle(assetUrl)
      .then((geo) => {
        if (!cancelled) {
          setGeometry(geo);
          setLoading(false);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [assetUrl]);

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
      const spun = continueSpin(rotationRef.current);
      if (spun !== rotationRef.current || spun.spin) {
        rotationRef.current = spun;
        renderer.setRotation(spun.mat);
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

    const local = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const onPointerDown = (event: PointerEvent) => {
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

      rotationRef.current = drag(rotationRef.current, dx, dy, {
        button,
        // Shift switches from the XZ/YZ rotation that reads as a 3D trackball to the XW/YW one
        // that turns the puzzle through the fourth dimension.
        shift: event.shiftKey,
      });
      rendererRef.current?.setRotation(rotationRef.current.mat);
    };

    const onPointerUp = (event: PointerEvent) => {
      if (pressed && !moved) {
        const p = local(event);
        handlersRef.current.onTap(p.x, p.y, rawButton);
      }
      pressed = false;
      canvas.releasePointerCapture(event.pointerId);
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
    rotationRef.current = createRotation();
    rendererRef.current?.setRotation(rotationRef.current.mat);
    rendererRef.current?.setZoom(1);
  };

  const getRenderer = useCallback(() => rendererRef.current, []);

  return { canvasRef, geometry, error, loading, controls, setControls, resetView, getRenderer };
}
