import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  cellAxis,
  makeRowRotMat,
  netCompass,
  netLayout,
  netTransitionBetween,
  netView,
  type PuzzleGeometry,
} from '@mc4d/puzzle-core';
import {
  AxisInset,
  useViewport,
  type ViewControls,
  type ViewportHandlers,
  type ViewSnapshot,
} from '@mc4d/shell';
import type { PuzzleRenderer } from '@mc4d/render';

/**
 * How far round the oblique starts, and how far one press of Turn moves it.
 *
 * The starting quarter is chosen so that the two panes agree about left and right: −X and −Y fall to
 * the left of the middle cell and +X and +Y to the right, which is how the projection beside it
 * groups them. A cell you find in one pane is then on the same side in the other — and with −Z as
 * the long arm the vertical agrees too, +Z above the middle and −Z below.
 */
const BASE_TURN = 0.52 - Math.PI / 2;
const QUARTER = Math.PI / 2;
/** How long a change of cut takes, matched to the view glide so the app moves at one pace. */
const RECUT_MS = 520;

/**
 * One pane, drawn either unfolded or projected.
 *
 * The two are the same renderer with one uniform different, which is the reason for showing them
 * side by side: whatever the net has to fake, the projection next to it is doing honestly, and you
 * can watch both at once.
 *
 * Their controls differ because their vocabularies do. The projected pane gets the four the
 * multi-view app settled on — Turn, Tip, Flip, Reset — which move between the eight ways of facing a
 * hypercube. Unfolded there are no such viewpoints: the net has already chosen a direction to fold
 * away, so what a viewer wants to change is the cut, and Turn is the only one of the four that
 * still means anything.
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
  axisHints,
  axisColors,
  onCycleFold,
  onCycleCentre,
  onCycleArm,
  foldLabel,
  centreLabel,
  armLabel,
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
  axisHints: boolean;
  axisColors: readonly (string | null)[] | undefined;
  /** The three cuts, as cyclers: the panel's choices, next to the thing they change. */
  onCycleFold: () => void;
  onCycleCentre: () => void;
  onCycleArm: () => void;
  foldLabel: string;
  centreLabel: string;
  armLabel: string;
}) {
  const controlsRef = useRef<HTMLDivElement>(null);
  // The two panes want opposite shape settings, so they take them separately while sharing
  // everything else. The projected pane pulls cells in to 40% and cubies to 50%, which is what
  // opens the gaps you see through into the interior — the only way a projected hypercube is
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

  const { getRenderer, snapshot, setRotation, glideTo, getRotation } = view;
  useEffect(() => {
    onRenderer(index, getRenderer());
    return () => onRenderer(index, null);
  }, [onRenderer, index, getRenderer, geometry]);

  useEffect(() => {
    onSnapshot(index, snapshot);
  }, [onSnapshot, index, snapshot]);

  // Re-cutting the net and turning the whole puzzle are the same operation seen from two sides, so
  // a change of cut is shown as the rotation it is equivalent to rather than as a jump — the same
  // motion a twist with every layer selected already makes, driven through the same uniform.
  //
  // The old cut stays on screen while the rotation plays and the new one is applied at the end: the
  // cells are what move, and moving them before the motion has finished would be showing the answer
  // during the question.
  const previousCut = useRef<{ centre: number; arm: number } | null>(null);
  const animation = useRef<number>(0);
  useEffect(() => {
    const renderer = getRenderer();
    if (!renderer || !geometry) return;
    if (!unfolded) {
      renderer.setNetLayout(null);
      return;
    }

    const settle = (centre: number, arm: number) => {
      renderer.setNetLayout(netLayout(geometry, centre, arm, spacing));
      renderer.endTwist();
      previousCut.current = { centre, arm };
    };

    const before = previousCut.current;
    const transition =
      before && (before.centre !== centreFace || before.arm !== armFace)
        ? netTransitionBetween(
            { centre: cellAxis(geometry, before.centre), arm: cellAxis(geometry, before.arm) },
            { centre: cellAxis(geometry, centreFace), arm: cellAxis(geometry, armFace) },
          )
        : null;

    if (!transition) {
      settle(centreFace, armFace);
      return;
    }

    // Every sticker turns, which is what makes this a whole-puzzle rotation rather than a twist.
    renderer.setNetLayout(netLayout(geometry, before!.centre, before!.arm, spacing));
    renderer.beginTwist(new Uint8Array(geometry.nStickers).fill(1));
    const [i, j] = transition.plane;
    const radians = (transition.degrees * Math.PI) / 180;
    const startedAt = performance.now();
    cancelAnimationFrame(animation.current);
    const step = () => {
      const t = Math.min(1, (performance.now() - startedAt) / RECUT_MS);
      const eased = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
      renderer.setTwistMatrix(makeRowRotMat(4, i, j, radians * eased));
      if (t < 1) animation.current = requestAnimationFrame(step);
      else settle(centreFace, armFace);
    };
    animation.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animation.current);
  }, [getRenderer, geometry, unfolded, centreFace, armFace, spacing]);

  // Turn, unfolded, is a quarter turn about the long arm — the axis the cross already stands on.
  // It cannot be the projected pane's Turn, which moves between viewpoints of 4-space that the net
  // does not have; and turning about anything else would lay the cross on its side.
  const [quarters, setQuarters] = useState(0);

  // Deliberately not keyed on spacing: widening the gaps is not a re-cut, and snapping the camera
  // back on every frame of a slider drag would be maddening.
  const lastCut = useRef<string | null>(null);
  useEffect(() => {
    if (!geometry || !unfolded) return;
    const layout = netLayout(geometry, centreFace, armFace);
    const target = netView(layout, BASE_TURN + quarters * QUARTER);
    const cut = `${centreFace}:${armFace}`;
    // A Turn leaves the cross exactly as it was and only changes where you stand, so it is worth
    // watching happen — and gliding is what makes a quarter turn legible as a quarter turn rather
    // than as the puzzle having been swapped for a different one. A re-cut is the opposite: the
    // cells themselves move, and easing the camera through that would suggest a motion that is not
    // taking place.
    if (lastCut.current === cut) glideTo(target);
    else setRotation(target);
    lastCut.current = cut;
  }, [setRotation, glideTo, geometry, unfolded, centreFace, armFace, quarters]);

  // The compass asks where each puzzle axis lands on screen. In a projection that is a row of the
  // view matrix; unfolded the net has rearranged them, so the matrix is remapped first.
  const compassRotation = useCallback(() => {
    const mat = getRotation();
    if (!unfolded || !geometry) return mat;
    return netCompass(geometry, netLayout(geometry, centreFace, armFace), centreFace, mat);
  }, [getRotation, unfolded, geometry, centreFace, armFace]);

  return (
    <div className="pane">
      <canvas ref={view.canvasRef} />
      {axisHints && <AxisInset getRotation={compassRotation} colors={axisColors} />}
      <div className="pane-label">
        <span className="pane-kind">{unfolded ? 'Unfolded' : 'Projected'}</span>
      </div>
      <div className="pane-controls" ref={controlsRef}>
        <div className="pad">
          <button
            onClick={() => (unfolded ? setQuarters((q) => q - 1) : view.turnQuarter(-1))}
            title="Turn a quarter, the other way"
          >
            <TurnIcon clockwise={false} />
          </button>
          <span>Turn</span>
          <button
            onClick={() => (unfolded ? setQuarters((q) => q + 1) : view.turnQuarter(1))}
            title="Turn a quarter"
          >
            <TurnIcon clockwise />
          </button>
        </div>

        {unfolded ? (
          // The three arbitrary choices, as cyclers rather than pickers: small enough for a strip,
          // and next to the cross they re-cut. The panel keeps the full pickers, for when you want
          // a particular one rather than the next one.
          <>
            <button className="cycle" onClick={onCycleFold} title="Fold a different axis away">
              <span className="cycle-name">Fold</span>
              <span className="cycle-value">{foldLabel}</span>
            </button>
            <button
              className="cycle"
              onClick={onCycleCentre}
              title="Keep the other end of that axis in the middle"
            >
              <span className="cycle-name">Middle</span>
              <span className="cycle-value">{centreLabel}</span>
            </button>
            <button className="cycle" onClick={onCycleArm} title="Hang the eighth cell elsewhere">
              <span className="cycle-name">Arm</span>
              <span className="cycle-value">{armLabel}</span>
            </button>
          </>
        ) : (
          <>
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
          </>
        )}

        <button
          className="reset"
          onClick={() => (unfolded ? setQuarters(0) : view.resetView())}
          title="Back to the opening view"
        >
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
