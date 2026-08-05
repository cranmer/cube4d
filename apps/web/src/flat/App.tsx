import { useCallback, useMemo, useRef, useState } from 'react';

import { AXIS_NAMES, cellName, DEFAULT_PUZZLE_ID, faceOnAxis } from '@mc4d/puzzle-core';
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

/**
 * The cut the app opens on, chosen to line up with the projected pane beside it.
 *
 * −W in the middle is the cell the projection centres by default, and hanging the long arm off −Z
 * puts +Z above the middle and −Z below it — which is where the projection puts them too. The two
 * panes then agree about up and down, and a cell you find in one is where you expect in the other.
 *
 * Held as signed axes rather than face indices: an axis is what the controls offer and what the
 * labels say, and a bare index would have to be trusted to be the cell you meant.
 */
const DEFAULT_CENTRE = { axis: 3, sign: -1 };
const DEFAULT_ARM = { axis: 2, sign: -1 };

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

  const [centre, setCentre] = useState(DEFAULT_CENTRE);
  const [arm, setArm] = useState(DEFAULT_ARM);
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
  const centreFace = geometry ? faceOnAxis(geometry, centre.axis, centre.sign) : 0;
  const armFace = geometry ? faceOnAxis(geometry, arm.axis, arm.sign) : 0;

  /** The six signed axes the long arm can hang from: everything off the folded-away axis. */
  const arms = AXIS_NAMES.flatMap((_, axis) =>
    axis === centre.axis ? [] : [1, -1].map((sign) => ({ axis, sign })),
  );

  /**
   * Re-cut the net so the given signed axis is the cell in the middle.
   *
   * The long arm has to be moved with it when its axis is the one being folded away: it hangs off
   * one of the middle cell's neighbours, and both cells on the folded axis are the middle cell and
   * the one with nowhere to attach.
   */
  const recut = useCallback(
    (axis: number, sign: number) => {
      setCentre({ axis, sign });
      setArm((current) =>
        current.axis === axis ? { axis: (axis + 1) % AXIS_NAMES.length, sign: -1 } : current,
      );
    },
    [],
  );

  const axisColors = useAxisColors(geometry, controls.paletteId);

  const cycleFold = useCallback(
    () => recut((centre.axis + 1) % AXIS_NAMES.length, centre.sign),
    [recut, centre.axis, centre.sign],
  );
  const cycleCentre = useCallback(() => recut(centre.axis, -centre.sign), [recut, centre.axis, centre.sign]);
  const cycleArm = useCallback(() => {
    const at = arms.findIndex((a) => a.axis === arm.axis && a.sign === arm.sign);
    if (arms.length) setArm(arms[(at + 1) % arms.length]);
  }, [arms, arm.axis, arm.sign]);

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
                className={centre.axis === axis ? 'chip on' : 'chip'}
                onClick={() => recut(axis, centre.sign)}
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
            {[1, -1].map((sign) => (
              <button
                key={sign}
                className={centre.sign === sign ? 'chip on' : 'chip'}
                onClick={() => recut(centre.axis, sign)}
              >
                {sign > 0 ? '+' : '\u2212'}
                {AXIS_NAMES[centre.axis]}
              </button>
            ))}
          </div>
          <p className="hint">
            Either end of that axis will do. The other end is the cell with nowhere to attach, and
            hangs off the bottom of the long arm.
          </p>

          <h3 className="subhead">Long arm</h3>
          <div className="chips">
            {arms.map((a) => (
              <button
                key={`${a.axis}:${a.sign}`}
                className={a.axis === arm.axis && a.sign === arm.sign ? 'chip on' : 'chip'}
                onClick={() => setArm(a)}
              >
                {a.sign > 0 ? '+' : '\u2212'}
                {AXIS_NAMES[a.axis]}
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
