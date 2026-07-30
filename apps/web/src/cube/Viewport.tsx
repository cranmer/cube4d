import { useEffect, useRef } from 'react';

import type { PuzzleGeometry } from '@mc4d/puzzle-core';
import { useViewport, type ViewControls, type ViewportHandlers, type ViewSnapshot } from '@mc4d/shell';
import type { PuzzleRenderer } from '@mc4d/render';

/**
 * One pane of the cube app: a canvas and the controls that move only this camera.
 *
 * Same arrangement as the multi-view app — a pane is operated by the buttons underneath it, with no
 * notion of an active pane — but a different set of controls, because a 3D puzzle is drawn flat in W
 * and only some of them respect that. See the note in App.tsx.
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
}: {
  geometry: PuzzleGeometry | null;
  controls: ViewControls;
  handlers: ViewportHandlers;
  onRenderer: (index: number, renderer: PuzzleRenderer | null) => void;
  onSnapshot: (index: number, snapshot: () => ViewSnapshot) => void;
  initial: ViewSnapshot | undefined;
  index: number;
  label: string;
}) {
  // The controls sit over the bottom of the canvas, so the puzzle is centred in the space above
  // them rather than in the whole pane — otherwise the lowest cells hide behind the buttons.
  const controlsRef = useRef<HTMLDivElement>(null);
  const view = useViewport(geometry, controls, handlers, {
    publishTestHandle: index === 0,
    initial,
    reserveBelow: controlsRef,
  });

  const { getRenderer, snapshot } = view;
  useEffect(() => {
    onRenderer(index, getRenderer());
    return () => onRenderer(index, null);
  }, [onRenderer, index, getRenderer, geometry]);
  useEffect(() => {
    onSnapshot(index, snapshot);
  }, [onSnapshot, index, snapshot]);

  return (
    <div className="pane">
      <canvas ref={view.canvasRef} />
      <div className="pane-label">
        <span className="pane-index">{label}</span>
      </div>
      <div className="pane-controls" ref={controlsRef}>
        <div className="pad">
          <button onClick={() => view.turnQuarter(-1)} title="Turn a quarter anticlockwise">
            <TurnIcon clockwise={false} />
          </button>
          <span>Turn</span>
          <button onClick={() => view.turnQuarter(1)} title="Turn a quarter clockwise">
            <TurnIcon clockwise />
          </button>
        </div>
        <div className="pad">
          <button onClick={() => view.tip(1)} title="Tip: rotate through the fourth dimension">
            <TurnIcon clockwise={false} />
          </button>
          <span>Tip</span>
          <button onClick={() => view.tip(-1)} title="Tip back">
            <TurnIcon clockwise />
          </button>
        </div>
        <button className="flip" onClick={view.flip} title="Flip: mirror through the fourth dimension">
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
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      style={{ transform: clockwise ? 'scaleX(-1)' : undefined }}>
      <path d="M3.4 8a4.6 4.6 0 1 0 1.6-3.5" />
      <path d="M2.2 2.6v3.2h3.2" />
    </svg>
  );
}

function FlipIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.6 5.6h10.8" /><path d="M10.8 3l2.6 2.6-2.6 2.6" />
      <path d="M13.4 10.4H2.6" /><path d="M5.2 7.8 2.6 10.4l2.6 2.6" />
    </svg>
  );
}
