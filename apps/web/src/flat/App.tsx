import { useCallback, useMemo, useRef, useState } from 'react';

import { AXIS_NAMES, cellAxis, cellName, DEFAULT_PUZZLE_ID } from '@mc4d/puzzle-core';
import type { PuzzleRenderer } from '@mc4d/render';
import {
  Section,
  appKey,
  useAxisColors,
  usePuzzleAsset,
  usePuzzleSession,
  type PuzzleActions,
  type ViewSnapshot,
} from '@mc4d/shell';

import { Viewport } from './Viewport.js';

/**
 * The hypercube, unfolded.
 *
 * A cube's six faces flatten into a cross you can lay on a table; a hypercube's eight cells flatten
 * into a solid one. Drawn that way, every cell is a genuine undistorted 3×3×3 cube and all eight are
 * visible at once — none of the foreshortening that makes the projected view look like a cube inside
 * a cube, and no hidden cell.
 *
 * What it costs is that a twist is a rotation of the whole 4-space, and the net has cut precisely
 * the connections a twist turns through: about two thirds of the stickers a twist moves have to
 * cross from one arm of the cross to another, where no rigid motion can take them. That is why the
 * projected view sits beside it rather than being replaced by it. Whatever the net has to fake, the
 * pane next to it is doing honestly, and both are the same puzzle, twisting together.
 *
 * Hypercube only. The layout is the hypercube's own net; there is no solid cross for a simplex.
 */

/** Which cell sits at the middle of the cross, and which neighbour the eighth is attached beyond. */
const DEFAULT_CENTRE = 0;
const DEFAULT_ARM = 2;

export function App() {
  const assetBase = `${import.meta.env.BASE_URL}assets/`;
  const asset = usePuzzleAsset(
    assetBase,
    { id: DEFAULT_PUZZLE_ID, path: '4-3-3_3.mc4dpz' },
    {
      // The one puzzle this layout exists for. Other hypercube sizes unfold identically, but the
      // catalog stays shut until the layout has been tried on the one everybody knows.
      accepts: (entry) => entry.id === DEFAULT_PUZZLE_ID,
      defaultPaletteId: 'vivid',
    },
  );

  const [centreFace, setCentreFace] = useState(DEFAULT_CENTRE);
  const [armFace, setArmFace] = useState(DEFAULT_ARM);
  const [spacing, setSpacing] = useState(1.35);
  const [axisHints, setAxisHints] = useState(() => {
    try {
      return globalThis.localStorage?.getItem(appKey('axisHints')) !== 'off';
    } catch {
      return true;
    }
  });
  const toggleAxisHints = useCallback(() => {
    setAxisHints((on) => {
      try {
        globalThis.localStorage?.setItem(appKey('axisHints'), on ? 'off' : 'on');
      } catch {
        /* a forgotten preference is not worth surfacing */
      }
      return !on;
    });
  }, []);

  const renderers = useRef<(PuzzleRenderer | null)[]>([]);
  const onRenderer = useCallback((index: number, renderer: PuzzleRenderer | null) => {
    renderers.current[index] = renderer;
  }, []);
  const takeSnapshot = useRef(new Map<number, () => ViewSnapshot>());
  const onSnapshot = useCallback((index: number, fn: () => ViewSnapshot) => {
    takeSnapshot.current.set(index, fn);
  }, []);

  const actionsRef = useRef<PuzzleActions | null>(null);
  const handlers = useMemo(
    () => ({
      onTap: (view: PuzzleRenderer, x: number, y: number, button: number) =>
        actionsRef.current?.onClick(view, x, y, button),
      onHover: (view: PuzzleRenderer, x: number, y: number) =>
        actionsRef.current?.onPointerMove(view, x, y),
      onLeave: () => actionsRef.current?.onPointerLeave(),
    }),
    [],
  );

  // Both panes, so a twist made in either turns both. That they stay in step is the whole argument
  // for the pairing: the unfolded pane is not a diagram of the puzzle, it is the puzzle.
  const getViews = useCallback(
    () => renderers.current.filter((r): r is PuzzleRenderer => !!r),
    [],
  );
  const { session, actions } = usePuzzleSession(getViews, asset.geometry);
  actionsRef.current = actions;

  const { controls, geometry } = asset;
  const opposite = geometry ? geometry.face2OppositeFace[centreFace] : -1;
  const arms = geometry
    ? Array.from({ length: geometry.nFaces }, (_, f) => f).filter(
        (f) => f !== centreFace && f !== opposite,
      )
    : [];

  /**
   * Re-cut the net so the given signed axis is the cell in the middle.
   *
   * The long arm has to be checked as well as set: it hangs off one of the middle cell's
   * neighbours, and the cell that was serving as that neighbour may have just become the middle
   * cell itself, or its opposite, either of which has nowhere to hang from.
   */
  const recut = useCallback(
    (axis: number, sign: number) => {
      if (!geometry) return;
      const wanted = Array.from({ length: geometry.nFaces }, (_, f) => f).find((f) => {
        const a = cellAxis(geometry, f);
        return a.axis === axis && a.sign === sign;
      });
      if (wanted === undefined) return;
      setCentreFace(wanted);
      const stillLegal = armFace !== wanted && armFace !== geometry.face2OppositeFace[wanted];
      if (!stillLegal) {
        const next = Array.from({ length: geometry.nFaces }, (_, f) => f).find(
          (f) => f !== wanted && f !== geometry.face2OppositeFace[wanted],
        );
        if (next !== undefined) setArmFace(next);
      }
    },
    [geometry, armFace],
  );

  const axisColors = useAxisColors(geometry, controls.paletteId);
  const centre = geometry ? cellAxis(geometry, centreFace) : { axis: 3, sign: -1 };

  const cycleFold = useCallback(
    () => recut((centre.axis + 1) % AXIS_NAMES.length, centre.sign),
    [recut, centre.axis, centre.sign],
  );
  const cycleCentre = useCallback(
    () => recut(centre.axis, -centre.sign),
    [recut, centre.axis, centre.sign],
  );
  const cycleArm = useCallback(() => {
    const at = arms.indexOf(armFace);
    if (arms.length) setArmFace(arms[(at + 1) % arms.length]);
  }, [arms, armFace]);

  return (
    <div className="layout">
      <div className="stage">
        {[true, false].map((unfolded, i) => (
          <Viewport
            key={i}
            index={i}
            unfolded={unfolded}
            geometry={geometry}
            controls={controls}
            handlers={handlers}
            onRenderer={onRenderer}
            onSnapshot={onSnapshot}
            initial={undefined}
            centreFace={centreFace}
            armFace={armFace}
            spacing={spacing}
            axisHints={axisHints}
            axisColors={axisColors}
            onCycleFold={cycleFold}
            onCycleCentre={cycleCentre}
            onCycleArm={cycleArm}
            foldLabel={AXIS_NAMES[centre.axis]}
            centreLabel={geometry ? cellName(geometry, centreFace) : ''}
            armLabel={geometry ? cellName(geometry, armFace) : ''}
          />
        ))}
      </div>

      <aside className="panel">
        <header className="masthead">
          <h1>Unfolded</h1>
          <p className="sub">The hypercube as a solid cross.</p>
        </header>

        {asset.error && <p className="error">{asset.error}</p>}
        {asset.loading && <p className="hint">Loading…</p>}

        <Section id="fold" title="The cross" defaultOpen>
          <p className="hint">
            A cube's net can be cut a dozen ways and so can a hypercube's. All three choices below
            are arbitrary; changing any of them re-cuts it.
          </p>

          {/* The flattening direction and the middle cell are one choice in the geometry -- the net
              lies in the hyperplane perpendicular to the middle cell's normal, so picking that cell
              fixes the direction too. They are asked separately because they are separate questions
              to a person: which axis gets folded away, and then which of its two ends you keep in
              your hand. */}
          <h3 className="subhead">Flattened direction</h3>
          <div className="chips">
            {AXIS_NAMES.map((name, axis) => (
              <button
                key={name}
                className={geometry && cellAxis(geometry, centreFace).axis === axis ? 'chip on' : 'chip'}
                onClick={() => geometry && recut(axis, cellAxis(geometry, centreFace).sign)}
              >
                {name}
              </button>
            ))}
          </div>
          <p className="hint">
            The axis folded away. The other three are the ones you can still see, and the cross is
            built in them.
          </p>

          <h3 className="subhead">Cell in the middle</h3>
          <div className="chips">
            {geometry &&
              [1, -1].map((sign) => (
                <button
                  key={sign}
                  className={cellAxis(geometry, centreFace).sign === sign ? 'chip on' : 'chip'}
                  onClick={() => recut(cellAxis(geometry, centreFace).axis, sign)}
                >
                  {sign > 0 ? '+' : '\u2212'}
                  {AXIS_NAMES[cellAxis(geometry, centreFace).axis]}
                </button>
              ))}
          </div>
          <p className="hint">
            Either end of that axis will do. The other end is the cell with nowhere to attach, and
            hangs off the bottom of the long arm.
          </p>

          <h3 className="subhead">Long arm</h3>
          <div className="chips">
            {arms.map((f) => (
              <button
                key={f}
                className={f === armFace ? 'chip on' : 'chip'}
                onClick={() => setArmFace(f)}
              >
                {geometry ? cellName(geometry, f) : f}
              </button>
            ))}
          </div>
          <p className="hint">
            Which neighbour the eighth cell hangs beyond. It is drawn straight down, so the long arm
            is always the vertical one.
          </p>

          <label className="slider">
            <span className="row">
              <span>Spacing</span>
              <span>{spacing.toFixed(2)}×</span>
            </span>
            <input
              type="range"
              min={1}
              max={2}
              step={0.01}
              value={spacing}
              onChange={(e) => setSpacing(Number(e.target.value))}
            />
          </label>
          <p className="hint">
            At 1× the cells touch, which is a true unfolding. Wider opens the gaps, so the cell in
            the middle stops being hidden by the six around it.
          </p>
        </Section>

        <Section id="view" title="View">
          <label className="check">
            <input type="checkbox" checked={axisHints} onChange={toggleAxisHints} />
            <span>Show axis hints in the corner</span>
          </label>
          <p className="hint">
            A compass per pane, since the panes point different ways. In the projection it says where
            the four axes went; unfolded it points at six of the eight cells, which do sit along
            their own axis — the folded-away axis collapses to the middle, where its cell is.
          </p>
        </Section>

        <Section id="move" title="Move" defaultOpen badge={`${session.twistCount}`}>
          <div className="buttons">
            <button disabled={!session.canUndo} onClick={() => actions.undo()}>
              Undo
            </button>
            <button disabled={!session.canRedo} onClick={() => actions.redo()}>
              Redo
            </button>
          </div>
          <div className="buttons">
            <button onClick={() => actions.scramble()}>Scramble</button>
            <button onClick={() => actions.reset()}>Reset puzzle</button>
          </div>
        </Section>
      </aside>
    </div>
  );
}
