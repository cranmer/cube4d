import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  netCompass,
  netStateLayout,
  netTween,
  netView,
  type NetLayout,
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
export const BASE_TURN = 0.52 - Math.PI / 2;
const QUARTER = Math.PI / 2;
/** How long a change of cut takes, matched to the view glide so the app moves at one pace. */
const RECUT_MS = 520;

/** One press: a quarter turn of the whole puzzle, named for what it does to the middle cube. */
export interface Press {
  label?: string;
  hint: string;
  plane: readonly [number, number];
  radians: number;
}

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
  base,
  rotation,
  spacing,
  axisHints,
  axisColors,
  moves,
  spins,
  onPress,
  middleLabel,
  farLabel,
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
  /** The arrangement everything is derived from, or null before the puzzle loads. */
  base: NetLayout | null;
  /**
   * How far the puzzle has been turned from that arrangement. A new one animates from the last:
   * it is the identity of the array that says a turn has happened, so it is never mutated.
   */
  rotation: Float64Array;
  spacing: number;
  axisHints: boolean;
  axisColors: readonly (string | null)[] | undefined;
  /** The six presses that move the middle cube one step, and what to call where it ended up. */
  moves: readonly Press[];
  /** The two axes it can be rotated about instead, each with a press either way round. */
  spins: readonly { label: string; name: string; pair: readonly Press[] }[];
  onPress: (move: { plane: readonly [number, number]; radians: number }) => void;
  middleLabel: string;
  farLabel: string;
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

  // A press turns the puzzle, and the turn is shown rather than jumped to: every cell travels from
  // the slot it held to the slot it is going to, as a solid cube moving through the net's own space.
  // What it must not be is the 4D rotation itself run through the twist uniform -- unfolded that
  // draws each moving cell's shadow rather than the cell, so they flatten on the way past and never
  // leave their slots. netTween is where that is worked out; this only has to run the clock.
  const animation = useRef<number>(0);
  const shown = useRef<Float64Array | null>(null);
  useEffect(() => {
    const renderer = getRenderer();
    if (!renderer || !geometry || !base || !unfolded) {
      renderer?.setNetLayout(null);
      return;
    }

    const settle = () => {
      renderer.setNetLayout(netStateLayout(geometry, base, rotation));
      shown.current = rotation;
    };

    cancelAnimationFrame(animation.current);
    const previous = shown.current;
    if (!previous || previous === rotation) {
      settle();
      return;
    }

    const tween = netTween(geometry, base, previous, rotation);
    const startedAt = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - startedAt) / RECUT_MS);
      const eased = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
      if (t < 1) {
        // Framing held: see setNetLayout. Every frame here is between two crosses of the same size.
        renderer.setNetLayout(tween(eased), false);
        animation.current = requestAnimationFrame(step);
      } else settle();
    };
    animation.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animation.current);
  }, [getRenderer, geometry, unfolded, base, rotation, spacing]);

  // Turn, unfolded, is a quarter turn about the long arm — the axis the cross already stands on.
  // It cannot be the projected pane's Turn, which moves between viewpoints of 4-space that the net
  // does not have; and turning about anything else would lay the cross on its side.
  const [quarters, setQuarters] = useState(0);

  // The cross itself never moves now, so the view only has to be set once and turned by Turn.
  useEffect(() => {
    if (!geometry || !unfolded || !base) return;
    setRotation(netView(base, BASE_TURN + quarters * QUARTER));
  }, [setRotation, geometry, unfolded, base, quarters]);

  // The compass asks where each puzzle axis lands on screen. In a projection that is a row of the
  // view matrix; unfolded the net has rearranged them, so the matrix is remapped first.
  const compassRotation = useCallback(() => {
    const mat = getRotation();
    if (!unfolded || !geometry) return mat;
    if (!base) return mat;
    const middle = netStateLayout(geometry, base, rotation).cells.find((c) => c.role === 'centre');
    return middle ? netCompass(geometry, base, middle.face, mat) : mat;
  }, [getRotation, unfolded, geometry, base, rotation]);

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
          // Everything here is done to the middle cube, which is why the two groups are named for
          // it: six presses move it to the next slot, four rotate it where it stands. Both are
          // whole-puzzle twists, so what you press and what you watch are the same thing.
          <>
            <div className="group">
              <span className="group-name">Move</span>
              <div className="moves">
                {moves.map((m) => (
                  <button key={m.label} onClick={() => onPress(m)} title={m.hint}>
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="group">
              <span className="group-name">Rotate</span>
              <div className="spins">
                {spins.map((spin) => (
                  <div className="pad" key={spin.label}>
                    <button onClick={() => onPress(spin.pair[0])} title={spin.pair[0].hint}>
                      <TurnIcon clockwise={false} />
                    </button>
                    <span>{spin.label}</span>
                    <button onClick={() => onPress(spin.pair[1])} title={spin.pair[1].hint}>
                      <TurnIcon clockwise />
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <span className="standing">
              <span className="standing-name">Middle</span>
              <span className="standing-value">{middleLabel}</span>
            </span>
            <span className="standing">
              <span className="standing-name">Bottom</span>
              <span className="standing-value">{farLabel}</span>
            </span>
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

export function TurnIcon({ clockwise }: { clockwise: boolean }) {
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
