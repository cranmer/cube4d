/**
 * One canvas showing the puzzle: its renderer, its camera, and the pointer input over it.
 *
 * Split out of `usePuzzleCanvas` so an app can have more than one. What is *per viewport* is
 * everything about looking — the WebGL context, the 4D rotation, which named viewpoint you are at,
 * and the picking that turns a pixel into a sticker. What is per *app* — the catalog, the geometry,
 * and the shape and colour settings — lives in `usePuzzleAsset` and is passed in here.
 *
 * Note the cost of a second one: each viewport is its own WebGL context, and browsers cap those at
 * roughly eight to sixteen per page. Two to four panes are comfortable; a grid of sixteen is not,
 * and would want one context with scissored viewports instead — a different design that shares
 * nothing with this one.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  canonicalViewById,
  continueSpin,
  createRotation,
  DEFAULT_VIEW_ID,
  drag,
  flipView,
  interpolateRotation,
  nextCanonicalView,
  quarterTurn,
  stopSpinning,
  tipView,
  viewpointCentredBy,
  type PuzzleGeometry,
  type RotationState,
} from '@mc4d/puzzle-core';
import { paletteById, PuzzleRenderer } from '@mc4d/render';

import type { ViewControls } from './viewControls.js';

/** A press that moves less than this is a click, not a drag. */
const DRAG_THRESHOLD_PX = 4;

/**
 * How long a glide between viewpoints takes.
 *
 * Long enough to be followed — the whole point is to show how the orientations relate, and an
 * instant cut would teach nothing — and short enough not to be in the way when stepping through
 * several in a row.
 */
const VIEW_GLIDE_MS = 520;

/** Ease in and out, so a glide starts and ends at rest rather than jerking. */
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export interface ViewportHandlers {
  /** The renderer is passed along because picking only means something under one camera. */
  onTap(view: PuzzleRenderer, x: number, y: number, button: number): void;
  onHover(view: PuzzleRenderer, x: number, y: number): void;
  onLeave(): void;
}

/**
 * Everything about where a camera is pointing, in a form that outlives the component.
 *
 * A pane that is closed and reopened should come back where it was; without this its rotation dies
 * with the React component that held it, and reopening silently resets the view someone had set up.
 */
export interface ViewSnapshot {
  /** Row-major 4x4, as `.log` files store it. */
  readonly mat4d: readonly number[];
  readonly canonicalView: string | null;
  readonly zoom: number;
}

export interface Viewport {
  readonly canvasRef: React.RefObject<HTMLCanvasElement>;
  getRenderer(): PuzzleRenderer | null;
  /** The current 4D view rotation, row-major, as `.log` files store it. */
  getRotation(): number[];
  setRotation(mat4d: readonly number[]): void;
  resetView(): void;
  /** Which named viewpoint this camera is at or heading for; null once it has been dragged away. */
  readonly canonicalView: string | null;
  goToCanonicalView(id: string): void;
  stepCanonicalView(step: 1 | -1): void;
  /** A quarter turn to the next corner. Leaves the centred cell alone. */
  turnQuarter(step: 1 | -1): void;
  /** A three-cycle that brings a different cell to the middle. */
  tip(step: 1 | -1): void;
  /** A half-turn swapping the centred cell with the hidden one. Its own inverse. */
  flip(): void;
  /** Where this camera is now, in a form that can be handed back as `initial` later. */
  snapshot(): ViewSnapshot;
}

export function useViewport(
  geometry: PuzzleGeometry | null,
  controls: ViewControls,
  handlers: ViewportHandlers,
  options: {
    onError?: (message: string) => void;
    publishTestHandle?: boolean;
    /** Where to start, for a pane being restored rather than opened fresh. Read once, at mount. */
    initial?: ViewSnapshot | undefined;
    /**
     * An element drawn over the bottom of the canvas — a strip of controls — whose height should be
     * kept clear of the puzzle. Watched, so it stays right as the strip grows or shrinks.
     */
    reserveBelow?: React.RefObject<HTMLElement | null> | undefined;
    /**
     * How many dimensions a drag may turn through. Defaults to the puzzle's own.
     *
     * A viewport showing the puzzle unfolded wants 3 even though the puzzle has 4: the net lies in
     * one hyperplane, and a rotation that took it out of that hyperplane would project the cells
     * back into a jumble, undoing the only thing the layout is for.
     */
    dragDims?: number | undefined;
  } = {},
): Viewport {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<PuzzleRenderer | null>(null);
  const rotationRef = useRef<RotationState>(createRotation(options.initial?.mat4d));
  // A glide in progress: where it started, where it is going, and when it began. Held in a ref so
  // the render loop can read it without re-subscribing every frame.
  const glideRef = useRef<{
    from: Float64Array;
    to: readonly number[] | Float64Array;
    startedAt: number;
  } | null>(null);
  const [canonicalView, setCanonicalView] = useState<string | null>(
    options.initial ? options.initial.canonicalView : DEFAULT_VIEW_ID,
  );
  // Mirrored into a ref so `snapshot` can be a stable callback and still read the current value.
  const canonicalViewRef = useRef(canonicalView);
  canonicalViewRef.current = canonicalView;
  // Zoom lives in the renderer, which does not exist yet at this point, so it is applied when the
  // renderer is built rather than here.
  const initialZoom = useRef(options.initial?.zoom ?? 1);

  // Held in refs so the listeners never need re-binding when a callback identity changes.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const controlsRef = useRef(controls);
  controlsRef.current = controls;

  useEffect(() => {
    if (!canvasRef.current || !geometry) return;
    let renderer: PuzzleRenderer;
    try {
      renderer = new PuzzleRenderer({ canvas: canvasRef.current });
    } catch (e) {
      optionsRef.current.onError?.(e instanceof Error ? e.message : String(e));
      return;
    }
    rendererRef.current = renderer;
    const settings = controlsRef.current;
    const palette = paletteById(settings.paletteId);
    renderer.setPuzzle(geometry, palette);
    renderer.setBackground(palette.background);
    renderer.setRotation(rotationRef.current.mat);
    renderer.setViewParams(settings);
    renderer.setOpacity(settings.opacity);
    if (initialZoom.current !== 1) renderer.setZoom(initialZoom.current);

    const canvas = canvasRef.current;
    const reserved = optionsRef.current.reserveBelow;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height));
      renderer.setBottomInset(reserved?.current?.getBoundingClientRect().height ?? 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    if (reserved?.current) observer.observe(reserved.current);

    // A handle for automated testing: lets a headless browser interrogate the picker and drive the
    // view deterministically, neither of which is reachable through the UI. Only one viewport
    // publishes it, so an app with several does not leave the last-mounted one winning by accident.
    if (optionsRef.current.publishTestHandle !== false) {
      (globalThis as unknown as { __mc4d?: unknown }).__mc4d = {
        renderer,
        geometry,
        pick: (x: number, y: number) => renderer.pick(x, y),
      };
    }

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

  // Shape, opacity and palette are app-wide rather than per viewport, so every viewport follows the
  // same settings and an effect is the natural way to keep them in step.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const palette = paletteById(controls.paletteId);
    renderer.setViewParams(controls);
    renderer.setOpacity(controls.opacity);
    renderer.setPalette(palette);
    renderer.setBackground(palette.background);
  }, [controls, geometry]);

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
        const renderer = rendererRef.current;
        const p = local(event);
        if (renderer) handlersRef.current.onHover(renderer, p.x, p.y);
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
        // that turns the puzzle through the fourth dimension — which a 3D puzzle does not have, so
        // it passes its own dimension and the W planes are withheld.
        shift: event.shiftKey,
        dims: optionsRef.current.dragDims ?? geometry.nDims,
      });
      rendererRef.current?.setRotation(rotationRef.current.mat);
    };

    const onPointerUp = (event: PointerEvent) => {
      active.delete(event.pointerId);
      if (active.size < 2) pinchDistance = 0;
      if (pressed && !moved) {
        const renderer = rendererRef.current;
        const p = local(event);
        if (renderer) handlersRef.current.onTap(renderer, p.x, p.y, rawButton);
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

  /** Begin a glide from wherever the camera is now — including mid-glide, so presses chain. */
  const glideTo = useCallback((to: readonly number[] | Float64Array) => {
    glideRef.current = {
      from: Float64Array.from(rotationRef.current.mat),
      to,
      startedAt: performance.now(),
    };
  }, []);

  const resetView = useCallback(() => {
    glideRef.current = null;
    setCanonicalView(DEFAULT_VIEW_ID);
    rotationRef.current = createRotation();
    rendererRef.current?.setRotation(rotationRef.current.mat);
    rendererRef.current?.setZoom(1);
  }, []);

  const goToCanonicalView = useCallback(
    (id: string) => {
      const view = canonicalViewById(id);
      if (!view) return;
      glideTo(view.mat);
      setCanonicalView(view.id);
    },
    [glideTo],
  );

  const stepCanonicalView = useCallback(
    (step: 1 | -1) => {
      setCanonicalView((current) => {
        const view = nextCanonicalView(current, step);
        glideTo(view.mat);
        return view.id;
      });
    },
    [glideTo],
  );

  const turnQuarter = useCallback(
    (step: 1 | -1) => glideTo(quarterTurn(rotationRef.current.mat, step)),
    [glideTo],
  );

  const tip = useCallback(
    (step: 1 | -1) => {
      const to = tipView(rotationRef.current.mat, step);
      glideTo(to);
      // Unlike a quarter turn, this changes which cell is in the middle — which is exactly what the
      // viewpoint label names, so it has to be recomputed rather than carried over.
      setCanonicalView(viewpointCentredBy(to)?.id ?? null);
    },
    [glideTo],
  );

  const flip = useCallback(() => {
    const to = flipView(rotationRef.current.mat);
    glideTo(to);
    setCanonicalView(viewpointCentredBy(to)?.id ?? null);
  }, [glideTo]);

  const snapshot = useCallback(
    (): ViewSnapshot => ({
      mat4d: Array.from(rotationRef.current.mat),
      canonicalView: canonicalViewRef.current,
      zoom: rendererRef.current?.getZoom() ?? initialZoom.current,
    }),
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

  return {
    canvasRef,
    getRenderer,
    getRotation,
    setRotation,
    resetView,
    canonicalView,
    goToCanonicalView,
    stepCanonicalView,
    turnQuarter,
    tip,
    flip,
    snapshot,
  };
}
