import { useEffect, useMemo, useRef } from 'react';

import { netLayout, netView, type PuzzleGeometry } from '@mc4d/puzzle-core';
import {
  useViewport,
  type ViewControls,
  type ViewportHandlers,
  type ViewSnapshot,
} from '@mc4d/shell';
import type { PuzzleRenderer } from '@mc4d/render';

/**
 * One pane, drawn either unfolded or projected.
 *
 * The two are the same renderer with one uniform different, which is the reason for showing them
 * side by side: whatever the net has to fake, the projection next to it is doing honestly, and you
 * can watch both at once.
 */
export function Viewport({
  geometry,
  controls,
  handlers,
  onRenderer,
  onSnapshot,
  initial,
  index,
  unfolded,
  centreFace,
  armFace,
  spacing,
}: {
  geometry: PuzzleGeometry | null;
  controls: ViewControls;
  handlers: ViewportHandlers;
  onRenderer: (index: number, renderer: PuzzleRenderer | null) => void;
  onSnapshot: (index: number, snapshot: () => ViewSnapshot) => void;
  initial: ViewSnapshot | undefined;
  index: number;
  /** Unfolded into a solid cross, rather than projected from four dimensions. */
  unfolded: boolean;
  /** Which cell sits at the middle of the cross. Ignored when projecting. */
  centreFace: number;
  /** Which of its neighbours the eighth cell is attached beyond. Ignored when projecting. */
  armFace: number;
  spacing: number;
}) {
  const controlsRef = useRef<HTMLDivElement>(null);
  // The two panes want opposite shape settings, so they take them separately while sharing
  // everything else. The projected pane pulls cells in to 40% and cubies to 50%, which is what
  // opens the gaps you see through into the interior -- the only way a projected hypercube is
  // legible at all. Unfolded there is nothing to see into: each cell is meant to read as an
  // ordinary Rubik's cube with narrow seams, and the space between cells comes from the layout.
  const paneControls = useMemo(
    () => (unfolded ? { ...controls, faceShrink: 1, stickerShrink: 0.92 } : controls),
    [controls, unfolded],
  );
  const view = useViewport(geometry, paneControls, handlers, {
    publishTestHandle: index === 0,
    initial,
    reserveBelow: controlsRef,
    // Unfolded, the puzzle lies in one hyperplane; a drag through W would take it out of that
    // hyperplane and scatter the cells back into a projection, which is the thing being avoided.
    dragDims: unfolded ? 3 : 4,
  });

  const { getRenderer, snapshot } = view;
  useEffect(() => {
    onRenderer(index, getRenderer());
    return () => onRenderer(index, null);
  }, [onRenderer, index, getRenderer, geometry]);

  useEffect(() => {
    onSnapshot(index, snapshot);
  }, [onSnapshot, index, snapshot]);

  // The layout is rebuilt whenever either arbitrary choice changes, which is what cycling them
  // amounts to. Keyed on the geometry too, since the renderer is replaced when the puzzle loads.
  //
  // Re-cutting the net also stands it back up. Which reduced axis the long arm falls on depends on
  // which cell is in the middle, so a view left where it was would have the cross lying on its side
  // as often as not. Only when the cut changes, though: a view the viewer has dragged to is theirs
  // until they change the cut again.
  const { setRotation } = view;
  useEffect(() => {
    const renderer = getRenderer();
    if (!renderer || !geometry) return;
    renderer.setNetLayout(unfolded ? netLayout(geometry, centreFace, armFace, spacing) : null);
  }, [getRenderer, geometry, unfolded, centreFace, armFace, spacing]);

  // Deliberately not keyed on spacing: widening the gaps is not a re-cut, and snapping the camera
  // back on every frame of a slider drag would be maddening.
  useEffect(() => {
    if (!geometry || !unfolded) return;
    setRotation(netView(netLayout(geometry, centreFace, armFace)));
  }, [setRotation, geometry, unfolded, centreFace, armFace]);

  return (
    <div className="pane">
      <canvas ref={view.canvasRef} />
      <div className="pane-label">
        <span className="pane-kind">{unfolded ? 'Unfolded' : 'Projected'}</span>
      </div>
      <div className="pane-controls" ref={controlsRef}>
        <button onClick={view.resetView} title="Back to the opening view">
          Reset
        </button>
      </div>
    </div>
  );
}
