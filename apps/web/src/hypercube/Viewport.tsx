import { useCallback, useEffect, useMemo, useRef } from 'react';

import {
  CANONICAL_VIEWS,
  makeRowRotMat,
  mxm,
  netCompass,
  netMiddleFacing,
  netStateLayout,
  netTurnToMiddle,
  netTween,
  netView,
  netViewMatching,
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
 * One pane, drawn either unfolded or projected, and switched between the two by its own label.
 *
 * The two are the same renderer with one uniform different, which is the reason for letting any pane
 * be either: whatever the net has to fake, a pane beside it can be doing honestly, and you can watch
 * both at once on the same puzzle.
 *
 * Their controls differ because their vocabularies do. Projected, a pane gets the four the
 * multi-view app settled on — Turn, Tip, Flip, Reset — which move between the eight ways of facing a
 * hypercube. Unfolded there are no such viewpoints: the net has already chosen a direction to fold
 * away, so what there is to change is which cell is in the middle, and Turn is the only one of the
 * four that still means anything.
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
  unfolded,
  onToggleMode,
  base,
  rotation,
  spacing,
  axisHints,
  axisColors,
  moves,
  spins,
  onPress,
  onAdopt,
  middleLabel,
}: {
  geometry: PuzzleGeometry | null;
  controls: ViewControls;
  handlers: ViewportHandlers;
  onRenderer: (index: number, renderer: PuzzleRenderer | null) => void;
  onSnapshot: (index: number, snapshot: () => ViewSnapshot) => void;
  initial: ViewSnapshot | undefined;
  index: number;
  /** Which pane this is: A, B or C, as the panel names them. */
  label: string;
  /** Unfolded into a solid cross, rather than projected from four dimensions. */
  unfolded: boolean;
  onToggleMode: () => void;
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
  /** Take up a whole arrangement at once, which is what unfolding a projection amounts to. */
  onAdopt: (rotation: Float64Array) => void;
  /** Which cell this pane has in the middle of its cross, for its label. */
  middleLabel: string;
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
  const viewpoint = CANONICAL_VIEWS.find((v) => v.id === view.canonicalView)?.name ?? 'Free';
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
      // Nothing is on screen to animate from, so the next unfolding settles rather than travels.
      shown.current = null;
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

    // Which way is into the screen, in the net's own coordinates: the third column of the view,
    // reversed. The cell that has to cross the middle swings round the back on that side. Round the
    // front it comes at the camera instead, which reads as lunging rather than as going around.
    const view = getRotation();
    const tween = netTween(geometry, base, previous, rotation, [-view[2], -view[6], -view[10]]);
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
  }, [getRenderer, getRotation, geometry, unfolded, base, rotation, spacing]);

  /**
   * Switching how the pane is drawn, without switching where it is looking.
   *
   * The two modes describe an orientation differently — a projection points all four axes somewhere
   * on the screen, a net has folded one of them away — so the camera cannot simply carry over. What
   * carries over is what the axes are doing, which is the thing you are actually reading: the
   * compass says where a net view puts them, and `netViewMatching` answers the reverse. Between them
   * a pane can change mode and stay put.
   *
   * The alternative, parking each mode's camera and picking it up again, sounds equivalent and is
   * not: after turning the cross a few times, the camera you parked is no longer the view you are
   * looking at, and toggling would take you somewhere you had left long ago.
   */
  const showing = useRef<boolean | null>(null);
  useEffect(() => {
    if (!geometry || !base || showing.current === unfolded) return;
    // Set outright rather than glided, and this is the one place in the app where that is right.
    // A glide would be the two matrices interpolated -- but they only *mean* the same orientation at
    // the end, and the cells have already changed shape by the first frame. What you would watch is
    // the new drawing at the old drawing's angle, swinging round to where it belonged all along.
    if (showing.current === null) {
      // Nothing to carry over on the first frame.
      if (unfolded) setRotation(netView(base, BASE_TURN));
    } else if (unfolded) {
      // The cell the projection had in the middle becomes the middle cube, so that the fold is of
      // the thing you were looking at. With the same cell folded away in both, the other three axes
      // land exactly where the projection had them and the compass does not move at all.
      const adopted = netTurnToMiddle(geometry, base, rotation, netMiddleFacing(geometry, getRotation()));
      if (adopted !== rotation) onAdopt(adopted);
      setRotation(netViewMatching(geometry, netStateLayout(geometry, base, adopted), getRotation()));
    } else {
      setRotation(netCompass(geometry, netStateLayout(geometry, base, rotation), getRotation()));
    }
    showing.current = unfolded;
  }, [setRotation, getRotation, onAdopt, geometry, unfolded, base, rotation]);

  /**
   * Turn, unfolded, is a quarter turn of the cross about the long arm — the axis it already stands
   * on. It cannot be the projected pane's Turn, which moves between viewpoints of 4-space that the
   * net does not have; and turning about anything else would lay the cross on its side.
   *
   * Applied to wherever the pane is looking rather than to a stock view, so it composes with dragging
   * and with an orientation carried over from a projection.
   */
  const turnCross = useCallback(
    (step: number) => {
      if (!base) return;
      const [i, j] = [0, 1, 2].filter((a) => a !== base.arm.axis);
      const from = Float64Array.from(getRotation());
      // Composed on the left, so the quarter turn happens in the cross's own space rather than the
      // camera's: the arm stays upright and the cells go round it, which is the point of Turn.
      glideTo(mxm(makeRowRotMat(4, i, j, step * QUARTER), from, 4));
    },
    [base, glideTo, getRotation],
  );

  // The compass asks where each puzzle axis lands on screen. In a projection that is a row of the
  // view matrix; unfolded the net has rearranged them, so the matrix is remapped first.
  const compassRotation = useCallback(() => {
    const mat = getRotation();
    if (!unfolded || !geometry) return mat;
    if (!base) return mat;
    return netCompass(geometry, netStateLayout(geometry, base, rotation), mat);
  }, [getRotation, unfolded, geometry, base, rotation]);

  return (
    <div className="pane">
      <canvas ref={view.canvasRef} />
      {axisHints && <AxisInset getRotation={compassRotation} colors={axisColors} />}
      {/* The label is the switch. There are exactly two ways to draw a hypercube here, so a toggle
          is the honest control — a picker would imply more of them — and putting it on the name
          means the pane says what it is and changes what it is in one place. Which pane it applies
          to needs no explaining, because it is in the pane. */}
      <div className="pane-label">
        <span className="pane-index">{label}</span>
        <button
          className="pane-kind"
          onClick={onToggleMode}
          title={unfolded ? 'Show this pane projected from 4D' : 'Show this pane unfolded into a cross'}
        >
          {unfolded ? 'Unfolded' : 'Projected'}
          <SwapIcon />
        </button>
        <span className="pane-view">{unfolded ? `${middleLabel} in the middle` : viewpoint}</span>
      </div>
      <div className="pane-controls" ref={controlsRef}>
        <div className="pad">
          <button
            onClick={() => (unfolded ? turnCross(-1) : view.turnQuarter(-1))}
            title="Turn a quarter, the other way"
          >
            <TurnIcon clockwise={false} />
          </button>
          <span>Turn</span>
          <button
            onClick={() => (unfolded ? turnCross(1) : view.turnQuarter(1))}
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
            <div className="presses">
              <span className="presses-name">Move</span>
              <div className="moves">
                {moves.map((m) => (
                  <button key={m.label} onClick={() => onPress(m)} title={m.hint}>
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="presses">
              <span className="presses-name">Rotate</span>
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
          onClick={() => (unfolded && base ? glideTo(netView(base, BASE_TURN)) : view.resetView())}
          title="Back to the opening view"
        >
          Reset
        </button>
      </div>
    </div>
  );
}

export /** Two arrows curling back on each other: this pane, drawn the other way. */
function SwapIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="11"
      height="11"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.6 6h9.2" />
      <path d="M9.6 3.4 12.2 6 9.6 8.6" />
      <path d="M13.4 10h-9.2" />
      <path d="M6.4 7.4 3.8 10l2.6 2.6" />
    </svg>
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
