/**
 * Wires the renderer to a canvas: pointer drags, wheel zoom, resize, and the animation loop.
 *
 * Kept out of the component so the interaction rules — which drag rotates in which plane — read as
 * one piece rather than being scattered through JSX.
 */

import { useEffect, useRef, useState } from 'react';
import {
  continueSpin,
  createRotation,
  decodeAsset,
  drag,
  stopSpinning,
  type PuzzleGeometry,
  type RotationState,
} from '@mc4d/puzzle-core';
import { PuzzleRenderer } from '@mc4d/render';

export interface ViewControls {
  faceShrink: number;
  stickerShrink: number;
  eyeW: number;
  /** 1 is solid. Below that the puzzle becomes a glass model of itself. */
  opacity: number;
}

export const DEFAULT_CONTROLS: ViewControls = {
  faceShrink: 0.4,
  stickerShrink: 0.5,
  eyeW: 1.05,
  opacity: 1,
};

export interface PuzzleCanvas {
  readonly canvasRef: React.RefObject<HTMLCanvasElement>;
  readonly geometry: PuzzleGeometry | null;
  readonly error: string | null;
  readonly loading: boolean;
  setControls(controls: Partial<ViewControls>): void;
  readonly controls: ViewControls;
  resetView(): void;
}

/**
 * Fetch and decode a puzzle asset.
 *
 * Assets are stored gzipped, but whether they arrive that way is not up to us: many static hosts —
 * GitHub Pages and Vite's own preview server among them — serve a `.gz` file with
 * `Content-Encoding: gzip`, so the browser transparently inflates it before we ever see the bytes.
 * Others serve it verbatim. Decide from the data rather than the file extension: a gzip stream
 * always begins with 0x1f 0x8b.
 */
async function loadPuzzle(url: string): Promise<PuzzleGeometry> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`could not load ${url} (${response.status})`);

  let bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Response(bytes).body?.pipeThrough(new DecompressionStream('gzip'));
    if (!stream) throw new Error('could not decompress the puzzle asset');
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // The decoder builds Float64 views over this buffer, which requires 8-byte alignment. A
  // Uint8Array from fetch is aligned, but one produced by slicing or decompression need not be.
  if (bytes.byteOffset % 8 !== 0) {
    const aligned = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(aligned).set(bytes);
    return decodeAsset(aligned);
  }
  return decodeAsset(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

export function usePuzzleCanvas(assetUrl: string): PuzzleCanvas {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<PuzzleRenderer | null>(null);
  const rotationRef = useRef<RotationState>(createRotation());

  const [geometry, setGeometry] = useState<PuzzleGeometry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [controls, setControlsState] = useState<ViewControls>(DEFAULT_CONTROLS);

  // --- load the puzzle
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

  // --- create the renderer once the canvas and geometry both exist
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
    renderer.setPuzzle(geometry);
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

    let frame = 0;
    const tick = () => {
      // Momentum: the puzzle keeps turning if it was moving when released.
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

  // --- pointer interaction
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let dragging = false;
    let button: 'left' | 'middle' | 'right' = 'left';
    let last = { x: 0, y: 0 };

    const onPointerDown = (event: PointerEvent) => {
      dragging = true;
      button = event.button === 2 ? 'right' : event.button === 1 ? 'middle' : 'left';
      last = { x: event.clientX, y: event.clientY };
      rotationRef.current = stopSpinning(rotationRef.current);
      canvas.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      // The original measures the drag as (previous − current) and inverts Y, since screen Y grows
      // downward. Matching that keeps the puzzle following the cursor rather than opposing it.
      const dx = last.x - event.clientX;
      const dy = -(last.y - event.clientY);
      last = { x: event.clientX, y: event.clientY };

      rotationRef.current = drag(rotationRef.current, dx, dy, {
        button,
        // Shift switches from the XZ/YZ rotation that looks like a 3D trackball to the XW/YW
        // rotation that turns the puzzle through the fourth dimension.
        shift: event.shiftKey,
      });
      rendererRef.current?.setRotation(rotationRef.current.mat);
    };

    const onPointerUp = (event: PointerEvent) => {
      dragging = false;
      canvas.releasePointerCapture(event.pointerId);
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const renderer = rendererRef.current;
      if (renderer) renderer.setZoom(renderer.getZoom() * (event.deltaY > 0 ? 0.92 : 1.08));
    };

    // Right-drag is a rotation, so suppress the context menu over the canvas.
    const onContextMenu = (event: Event) => event.preventDefault();

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
    };
  }, [geometry]);

  const setControls = (next: Partial<ViewControls>) => {
    setControlsState((current) => {
      const merged = { ...current, ...next };
      rendererRef.current?.setViewParams(merged);
      if (next.opacity !== undefined) rendererRef.current?.setOpacity(next.opacity);
      return merged;
    });
  };

  const resetView = () => {
    rotationRef.current = createRotation();
    rendererRef.current?.setRotation(rotationRef.current.mat);
    rendererRef.current?.setZoom(1);
  };

  return { canvasRef, geometry, error, loading, controls, setControls, resetView };
}
