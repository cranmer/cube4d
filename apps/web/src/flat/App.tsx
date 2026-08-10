import { useCallback, useMemo, useRef, useState } from 'react';

import {
  cellName,
  DEFAULT_PUZZLE_ID,
  faceOnAxis,
  identity,
  netLayout,
  netStateLayout,
  netTurn,
  netView,
  type NetLayout,
} from '@mc4d/puzzle-core';
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

import { BASE_TURN, Viewport } from './Viewport.js';

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

  // What has been done to the puzzle since the opening arrangement. Holding a rotation rather than
  // a cut is what keeps the cells from coming out mirrored: see netStateLayout.
  const [rotation, setRotation] = useState(() => identity(4));
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

  /** The arrangement everything else is a turn away from, and the one known to render correctly. */
  const base: NetLayout | null = useMemo(
    () =>
      geometry
        ? netLayout(
            geometry,
            faceOnAxis(geometry, DEFAULT_CENTRE.axis, DEFAULT_CENTRE.sign),
            faceOnAxis(geometry, DEFAULT_ARM.axis, DEFAULT_ARM.sign),
            spacing,
          )
        : null,
    [geometry, spacing],
  );

  /**
   * The six presses: the middle cube one step along each of the three directions, either way.
   *
   * Each is a quarter turn in the plane holding the folded-away axis and one of the three the cross
   * is built in — which is to say, exactly the whole-puzzle twist that would move it there. Four
   * cells change place and four stand still, every time, which is what makes it predictable.
   */
  const moves = useMemo(() => {
    if (!base) return [];
    // Which way each turn actually sends the middle cube, asked of the view rather than assumed.
    // The three axes the cross is built in are not in screen order -- the long arm is whichever one
    // the opening view stands upright -- so labelling them positionally gets Up wrong.
    const view = netView(base, BASE_TURN);
    const screen = (axis: number, way: number) => {
      const to = [0, 0, 0];
      to[base.keptAxes.indexOf(axis)] = way;
      return [0, 1, 2].map((j) => [0, 1, 2].reduce((sum, i) => sum + to[i] * view[i * 4 + j], 0));
    };
    const named = base.keptAxes.flatMap((axis) =>
      [1, -1].map((way) => {
        // Negated: the turn moves the middle cube *towards* the slot it is named for, so the cell
        // that arrives in the middle is the one from the opposite side. Pressing Up must send the
        // middle cube up and bring the cell below it in, not the other way about.
        const [x, y, z] = screen(axis, -way);
        const label =
          Math.abs(y) > Math.abs(x) && Math.abs(y) > Math.abs(z)
            ? y > 0 ? 'Up' : 'Down'
            : Math.abs(x) >= Math.abs(z)
              ? x > 0 ? 'Right' : 'Left'
              : z > 0 ? 'Front' : 'Back';
        return {
          label,
          hint: `Move the middle cube ${label.toLowerCase()}`,
          plane: [axis, base.droppedAxis] as const,
          radians: (way * Math.PI) / 2,
        };
      }),
    );
    const order = ['Up', 'Down', 'Left', 'Right', 'Front', 'Back'];
    return named.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
  }, [base]);

  // A press only ever composes a new rotation. The panes animate from the one they were showing to
  // the one they are handed, so what the motion looks like is theirs to work out, not a press's.
  const press = useCallback(
    (m: { plane: readonly [number, number]; radians: number }) =>
      setRotation((current: Float64Array) => netTurn(current, m.plane, m.radians)),
    [],
  );

  /** Where the turning has left things, for the labels. */
  const placed = geometry && base ? netStateLayout(geometry, base, rotation) : null;
  const middleCell = placed?.cells.find((c) => c.role === 'centre');
  const farCell = placed?.cells.find((c) => c.role === 'far');

  const axisColors = useAxisColors(geometry, controls.paletteId);


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
            base={base}
            rotation={rotation}
            spacing={spacing}
            axisHints={axisHints}
            axisColors={axisColors}
            moves={moves}
            onPress={press}
            middleLabel={geometry && middleCell ? cellName(geometry, middleCell.face) : ''}
            farLabel={geometry && farCell ? cellName(geometry, farCell.face) : ''}
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
            The cross itself never moves. The six buttons under the pane turn the puzzle, which
            shuffles the cells through it one step at a time — each is the whole-puzzle twist that
            would put the middle cube where you asked, so pressing and watching are the same thing.
          </p>

          <div className="moves panel-moves">
            {moves.map((m) => (
              <button key={m.label} onClick={() => press(m)} title={m.hint}>
                {m.label}
              </button>
            ))}
          </div>

          {/* Where the turning has left things. Labels rather than controls: which cell is in the
              middle is now a consequence of what you pressed, not a thing you set. */}
          <h3 className="subhead">Where you are</h3>
          <dl className="help">
            <dt>Folded away</dt>
            <dd>{geometry && middleCell ? cellName(geometry, middleCell.face).slice(1) : '—'}</dd>
            <dt>In the middle</dt>
            <dd>{geometry && middleCell ? cellName(geometry, middleCell.face) : '—'}</dd>
            <dt>At the bottom</dt>
            <dd>{geometry && farCell ? cellName(geometry, farCell.face) : '—'}</dd>
          </dl>

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

        <Section id="twist" title="Twist control" defaultOpen>
          <h3 className="subhead">Layers</h3>
          <div className="chips">
            {Array.from({ length: session.sliceCount }, (_, i) => (
              <button
                key={i}
                className={session.slicemask & (1 << i) ? 'chip on' : 'chip'}
                onClick={() => actions.toggleSlice(i)}
              >
                {i + 1}
              </button>
            ))}
          </div>
          <p className="hint">
            Which layers turn, counting inward from the cell you click. Holding <kbd>1</kbd>–
            <kbd>3</kbd> chooses them for a single twist without changing the setting.
          </p>
          {/* Worth saying here rather than in the projected app, because unfolded it is visible:
              selecting every layer turns the whole puzzle, which moves all eight cells at once. */}
          <p className="hint">
            Selecting all three turns the whole puzzle rather than a slice of it.
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
