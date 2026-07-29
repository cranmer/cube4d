import { useEffect } from 'react';

import { CANONICAL_VIEWS, type PuzzleGeometry } from '@mc4d/puzzle-core';
import {
  AxisInset,
  useViewport,
  type ViewControls,
  type ViewportHandlers,
  type ViewSnapshot,
} from '@mc4d/shell';
import type { PuzzleRenderer } from '@mc4d/render';

/**
 * One pane: a canvas, and the controls that move only this camera.
 *
 * Which cell is in the middle is per-pane by nature — that is the entire point of having more than
 * one — so those controls live here rather than in the panel. There is deliberately no notion of an
 * "active" pane: a pane is operated by pressing the buttons underneath it, which needs no state, no
 * focus ring, and no explaining.
 *
 * The eight +X…−W buttons do not appear here; three of them per pane would take more room than the
 * puzzle. Turn, Tip and Flip between them reach all eight viewpoints, which is exactly why Flip
 * exists — see docs/view-controls.md §7.
 */
export function Viewport({
  geometry,
  controls,
  handlers,
  onRenderer,
  onSnapshot,
  initial,
  index,
  label,
  axisColors,
  axisHints,
}: {
  geometry: PuzzleGeometry | null;
  controls: ViewControls;
  handlers: ViewportHandlers;
  /** Registers this pane's renderer with the session, so twists are broadcast to it. */
  onRenderer: (index: number, renderer: PuzzleRenderer | null) => void;
  /** Hands this pane's camera back before it unmounts, so reopening it returns you where you were. */
  onSnapshot: (index: number, snapshot: () => ViewSnapshot) => void;
  /** Where to start, if this pane has been open before. */
  initial: ViewSnapshot | undefined;
  index: number;
  label: string;
  /** One colour per signed axis for the compass, or undefined before the puzzle has loaded. */
  axisColors: readonly (string | null)[] | undefined;
  axisHints: boolean;
}) {
  const view = useViewport(geometry, controls, handlers, {
    // Only the first pane publishes the test handle, so an automated check always finds a
    // predictable one rather than whichever mounted last.
    publishTestHandle: index === 0,
    initial,
  });

  const { getRenderer, snapshot } = view;
  useEffect(() => {
    onRenderer(index, getRenderer());
    return () => onRenderer(index, null);
  }, [onRenderer, index, getRenderer, geometry]);

  // Registered rather than saved on unmount: by the time React runs this component's cleanup the
  // renderer has already been disposed, so its zoom is gone. The app asks for the snapshot while
  // the pane is still alive.
  useEffect(() => {
    onSnapshot(index, snapshot);
  }, [onSnapshot, index, snapshot]);

  const viewpoint = CANONICAL_VIEWS.find((v) => v.id === view.canonicalView)?.name ?? 'Free';

  return (
    <div className="pane">
      <canvas ref={view.canvasRef} />
      {/* One compass per pane, because each pane points somewhere different — a single shared one
          would be telling you about whichever pane it happened to belong to. */}
      {axisHints && <AxisInset getRotation={view.getRotation} colors={axisColors} />}
      <div className="pane-label">
        <span className="pane-index">{label}</span>
        <span className="pane-view">{viewpoint}</span>
      </div>
      <div className="pane-controls">
        <div className="pad">
          <button onClick={() => view.turnQuarter(-1)} title="Turn to the previous corner">
            <TurnIcon clockwise={false} />
          </button>
          <span>Turn</span>
          <button onClick={() => view.turnQuarter(1)} title="Turn to the next corner">
            <TurnIcon clockwise />
          </button>
        </div>
        <div className="pad">
          <button onClick={() => view.tip(-1)} title="Tip back: another cell to the middle">
            <TurnIcon clockwise={false} />
          </button>
          <span>Tip</span>
          <button onClick={() => view.tip(1)} title="Tip forward: another cell to the middle">
            <TurnIcon clockwise />
          </button>
        </div>
        <button
          className="flip"
          onClick={view.flip}
          title="Flip: swap the cell in the middle with the hidden one"
        >
          <FlipIcon />
          <span>Flip</span>
        </button>
        <button className="reset" onClick={view.resetView} title="Back to the opening view">
          Reset
        </button>
      </div>
    </div>
  );
}

function TurnIcon({ clockwise }: { clockwise: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ transform: clockwise ? 'scaleX(-1)' : undefined }}
    >
      <path d="M3.4 8a4.6 4.6 0 1 0 1.6-3.5" />
      <path d="M2.2 2.6v3.2h3.2" />
    </svg>
  );
}

/** Two arrows trading places, for the move that swaps the middle cell with the hidden one. */
function FlipIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.6 5.6h10.8" />
      <path d="M10.8 3l2.6 2.6-2.6 2.6" />
      <path d="M13.4 10.4H2.6" />
      <path d="M5.2 7.8 2.6 10.4l2.6 2.6" />
    </svg>
  );
}
