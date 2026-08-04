import { useCallback, useMemo, useRef, useState } from 'react';

import { DEFAULT_PUZZLE_ID } from '@mc4d/puzzle-core';
import type { PuzzleRenderer } from '@mc4d/render';
import {
  Section,
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
            Both choices below are arbitrary — a cube's net can be cut a dozen ways, and so can a
            hypercube's. Changing them re-cuts it.
          </p>

          <h3 className="subhead">Cell in the middle</h3>
          <div className="chips">
            {geometry &&
              Array.from({ length: geometry.nFaces }, (_, f) => (
                <button
                  key={f}
                  className={f === centreFace ? 'chip on' : 'chip'}
                  onClick={() => {
                    setCentreFace(f);
                    // The eighth cell hangs off a neighbour, and the old arm may have become the
                    // new centre or its opposite. Pick the first that is still legal.
                    if (f === armFace || geometry.face2OppositeFace[f] === armFace) {
                      const next = Array.from({ length: geometry.nFaces }, (_, g) => g).find(
                        (g) => g !== f && g !== geometry.face2OppositeFace[f],
                      );
                      if (next !== undefined) setArmFace(next);
                    }
                  }}
                >
                  {f}
                </button>
              ))}
          </div>

          <h3 className="subhead">Long arm</h3>
          <div className="chips">
            {arms.map((f) => (
              <button
                key={f}
                className={f === armFace ? 'chip on' : 'chip'}
                onClick={() => setArmFace(f)}
              >
                {f}
              </button>
            ))}
          </div>

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
