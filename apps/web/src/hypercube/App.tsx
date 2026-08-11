import { useCallback, useMemo, useRef, useState } from 'react';

import {
  cellAxis,
  cellName,
  DEFAULT_PUZZLE_ID,
  faceOnAxis,
  identity,
  makeRowRotMat,
  netLayout,
  netStateLayout,
  netTurn,
  netView,
  vxm,
  type NetLayout,
} from '@mc4d/puzzle-core';
import { PALETTES, paletteSwatches } from '@mc4d/render';
import type { PuzzleRenderer } from '@mc4d/render';
import {
  ImportExport,
  RealSolves,
  Section,
  appKey,
  useAxisColors,
  usePuzzleAsset,
  usePuzzleSession,
  useSolveIO,
  type PuzzleActions,
  type ViewSnapshot,
} from '@mc4d/shell';

import { BASE_TURN, TurnIcon, Viewport } from './Viewport.js';

/**
 * The hypercube, projected and unfolded, in as many views at once as you like.
 *
 * A cube's six faces flatten into a cross you can lay on a table; a hypercube's eight cells flatten
 * into a solid one. Drawn that way, every cell is a genuine undistorted 3×3×3 cube and all eight are
 * visible at once — none of the foreshortening that makes the projected view look like a cube inside
 * a cube, and no hidden cell.
 *
 * What it costs is that a twist is a rotation of the whole 4-space, and the net has cut precisely
 * the connections a twist turns through: about two thirds of the stickers a twist moves have to
 * cross from one arm of the cross to another, where no rigid motion can take them. That is why a
 * projected pane belongs beside an unfolded one rather than being replaced by it. Whatever the net
 * has to fake, the pane next to it is doing honestly, and both are the same puzzle, twisting
 * together.
 *
 * So the mode is a property of a *pane*, not of the app, and it is set on the pane by its own label.
 * Everything on the panel is a property of the puzzle and applies everywhere.
 *
 * One puzzle only, and deliberately: the layout is the hypercube's own net, and there is no solid
 * cross for a duoprism. The catalog picker that the multi-view app carries has nothing to offer here.
 */

const REPO_URL = 'https://github.com/cranmer/cube4d';

/**
 * The panes, named rather than counted — each keeps its own camera, its own mode and its own
 * arrangement of the cross, so B is a particular view of the puzzle and not merely "the second one".
 */
const PANES = ['A', 'B', 'C'];

/**
 * The cut the app opens on, chosen to line up with a projected pane beside it.
 *
 * −W in the middle is the cell the projection centres by default, and hanging the long arm off −Z
 * puts +Z above the middle and −Z below it — which is where the projection puts them too. The two
 * agree about up and down, and a cell you find in one is where you expect in the other.
 *
 * Held as signed axes rather than face indices: an axis is what the controls offer and what the
 * labels say, and a bare index would have to be trusted to be the cell you meant.
 */
const DEFAULT_CENTRE = { axis: 3, sign: -1 };
const DEFAULT_ARM = { axis: 2, sign: -1 };

/** Which panes are open, or which are unfolded: both are a set of pane letters in one string. */
function readPanes(key: string, fallback: boolean[]): boolean[] {
  try {
    const stored = globalThis.localStorage?.getItem(appKey(key));
    if (stored === null || stored === undefined) return fallback;
    return PANES.map((name) => stored.includes(name));
  } catch {
    return fallback;
  }
}

function writePanes(key: string, panes: boolean[]) {
  try {
    globalThis.localStorage?.setItem(appKey(key), PANES.filter((_, i) => panes[i]).join(''));
  } catch {
    /* a forgotten layout is not worth surfacing */
  }
}

export function App() {
  const assetBase = `${import.meta.env.BASE_URL}assets/`;
  const asset = usePuzzleAsset(
    assetBase,
    { id: DEFAULT_PUZZLE_ID, path: '4-3-3_3.mc4dpz' },
    {
      // The one puzzle this app exists for. Other hypercube sizes unfold identically, but the
      // catalog stays shut until the layout has been tried on the one everybody knows.
      accepts: (entry) => entry.id === DEFAULT_PUZZLE_ID,
      // Vivid: three small panes at once, so the cells have to be told apart at a glance.
      defaultPaletteId: 'vivid',
    },
  );

  // Two panes, one of each kind, is the opening argument of the app: the same puzzle drawn both
  // ways, side by side, so the net's tearing is visible against a projection that has none.
  const [shown, setShown] = useState<boolean[]>(() => readPanes('panes', [true, true, false]));
  const [unfolded, setUnfolded] = useState<boolean[]>(() =>
    readPanes('unfolded', [true, false, false]),
  );
  const visibleCount = shown.filter(Boolean).length;

  /**
   * How far each pane has turned the puzzle from the opening arrangement.
   *
   * Per pane, like the camera: two unfolded panes showing different cells in the middle is the same
   * kind of useful as two viewpoints, and it is the only way to see a cell in the middle of one
   * cross and out on an arm of another. Kept here rather than in the pane so that closing a pane and
   * reopening it returns the arrangement you had set up, which is often why the pane was open.
   */
  const [arrangements, setArrangements] = useState<Float64Array[]>(() =>
    PANES.map(() => identity(4)),
  );
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

  // Every pane's renderer, so the session can broadcast a twist to all of them. A ref rather than
  // state: it changes when a pane mounts, and re-rendering the panes because a pane mounted would
  // be a loop.
  const renderers = useRef<(PuzzleRenderer | null)[]>([]);
  const onRenderer = useCallback((index: number, renderer: PuzzleRenderer | null) => {
    renderers.current[index] = renderer;
  }, []);
  const getViews = useCallback(
    () => renderers.current.filter((r, i): r is PuzzleRenderer => !!r && !!shown[i]),
    [shown],
  );

  // Where each pane's camera was when it was last open, so reopening it returns you there.
  const cameras = useRef(new Map<number, ViewSnapshot>());
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

  const { session, actions } = usePuzzleSession(getViews, asset.geometry);
  actionsRef.current = actions;

  const [notice, setNotice] = useState<string | null>(null);
  const say = useCallback((message: string) => {
    setNotice(message);
    setTimeout(() => setNotice((current) => (current === message ? null : current)), 4000);
  }, []);

  const io = useSolveIO({
    actions,
    catalog: asset.catalog,
    puzzleId: asset.puzzleId,
    geometry: asset.geometry,
    selectPuzzle: asset.selectPuzzle,
    // Pane A's camera is the one a save records, since a file holds one view matrix and there is no
    // honest way to spread it across three.
    getRotation: () => Array.from(takeSnapshot.current.get(0)?.().mat4d ?? []),
    setRotation: () => {
      /* Panes keep their own cameras, and a loaded solve overriding them would discard the
         arrangement that is the reason for using this app. */
    },
    say,
    base: import.meta.env.BASE_URL,
  });

  const togglePane = useCallback((index: number) => {
    setShown((current) => {
      const next = [...current];
      next[index] = !next[index];
      // Closing the last one would leave nothing to look at, so it stays open — the same rule the
      // layer chips follow when you deselect the last layer.
      if (!next.some(Boolean)) return current;
      // Ask the pane where it is while it still exists to answer.
      if (!next[index]) {
        const take = takeSnapshot.current.get(index);
        if (take) cameras.current.set(index, take());
      }
      writePanes('panes', next);
      return next;
    });
  }, []);

  const toggleMode = useCallback((index: number) => {
    setUnfolded((current) => {
      const next = current.map((on, i) => (i === index ? !on : on));
      writePanes('unfolded', next);
      return next;
    });
  }, []);

  const { controls, setControls, geometry } = asset;

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
   * The presses, in the two kinds a middle cube can be given.
   *
   * Six of them move it: a quarter turn in the plane holding the folded-away axis and one of the
   * three the cross is built in, which is exactly the whole-puzzle twist that would carry it to the
   * next slot. Four more rotate it where it stands, in a plane of two of the cross's own axes, so
   * the middle cube keeps its place and spins about the axis the other two leave alone.
   *
   * Both are named from the picture rather than from the axes. The three axes the cross is built in
   * are not in screen order — the long arm is whichever one the opening view stands upright — so
   * anything positional gets Up wrong. Every label here is read off the view, and where a press
   * sends a cell is read off the rotation, so neither can drift from what the buttons do.
   *
   * The same for every pane, because the slots of the cross are: what differs between panes is which
   * cell is in which slot, and that is what a press changes.
   */
  const { moves, spins } = useMemo(() => {
    if (!base || !geometry) return { moves: [], spins: [] };
    const view = netView(base, BASE_TURN);
    const screen = (axis: number, way: number) => {
      const to = [0, 0, 0];
      to[base.keptAxes.indexOf(axis)] = way;
      return [0, 1, 2].map((j) => [0, 1, 2].reduce((sum, i) => sum + to[i] * view[i * 4 + j], 0));
    };
    /** What to call the direction a signed axis points once the opening view has turned it. */
    const nameOf = (axis: number, sign: number) => {
      const v = screen(axis, sign);
      let k = 0;
      for (let i = 1; i < 3; ++i) if (Math.abs(v[i]) > Math.abs(v[k])) k = i;
      return [
        ['Left', 'Right'],
        ['Down', 'Up'],
        ['Back', 'Front'],
      ][k][v[k] > 0 ? 1 : 0];
    };
    /**
     * Which slot the cell in a given one ends up in. A press carries the cell in slot t to the slot
     * whose direction is `t` turned back: the slots are fixed and the cells move through them.
     */
    const after = (
      slot: { axis: number; sign: number },
      plane: readonly [number, number],
      radians: number,
    ) => {
      const from = new Float64Array(4);
      from[slot.axis] = slot.sign;
      const to = vxm(new Float64Array(4), from, makeRowRotMat(4, plane[0], plane[1], -radians), 4);
      let axis = 0;
      for (let i = 1; i < 4; ++i) if (Math.abs(to[i]) > Math.abs(to[axis])) axis = i;
      return { axis, sign: Math.sign(to[axis]) };
    };

    const middle = cellAxis(geometry, base.cells.find((c) => c.role === 'centre')!.face);
    const order = ['Up', 'Down', 'Left', 'Right', 'Front', 'Back'];
    const moves = base.keptAxes
      .flatMap((axis) =>
        [1, -1].map((way) => {
          const plane = [axis, base.droppedAxis] as const;
          const radians = (way * Math.PI) / 2;
          const to = after(middle, plane, radians);
          const label = nameOf(to.axis, to.sign);
          return { label, hint: `Move the middle cube ${label.toLowerCase()}`, plane, radians };
        }),
      )
      .sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));

    // The axis a rotation leaves alone is the one it is named for, so each is a plane of the other
    // two. Rotating about the up-down axis is the third of these and is left out on purpose: it
    // spins the cross about the axis it already stands on, which is what Turn appears to do.
    const upright = base.keptAxes.find((a) => nameOf(a, 1) === 'Up' || nameOf(a, -1) === 'Up')!;
    const sideways = base.keptAxes.find((a) => nameOf(a, 1) === 'Right' || nameOf(a, -1) === 'Right')!;
    const depth = base.keptAxes.find((a) => nameOf(a, 1) === 'Front' || nameOf(a, -1) === 'Front')!;
    const top = { axis: upright, sign: nameOf(upright, 1) === 'Up' ? 1 : -1 };
    const spins = [
      { label: 'L–R', name: 'left–right', plane: [upright, depth] as const },
      { label: 'F–B', name: 'front–back', plane: [upright, sideways] as const },
    ].map((spin) => ({
      ...spin,
      // Ordered so the right-hand button always brings the top of the cross towards you or towards
      // your right, whichever this axis offers. Two pairs of identical arrows need some rule.
      pair: [1, -1]
        .map((way) => {
          const radians = (way * Math.PI) / 2;
          const to = after(top, spin.plane, radians);
          const goes = nameOf(to.axis, to.sign);
          return {
            goes,
            hint: `Rotate the middle cube about the ${spin.name} axis: the cube on top comes round to the ${goes.toLowerCase()}`,
            plane: spin.plane,
            radians,
          };
        })
        .sort((a, b) => (a.goes === 'Front' || a.goes === 'Right' ? 1 : -1)),
    }));

    return { moves, spins };
  }, [base, geometry]);

  // A press only ever composes a new rotation, for the one pane whose button was pressed. The pane
  // animates from the arrangement it was showing to the one it is handed, so what the motion looks
  // like is its business, not a press's.
  const press = useCallback(
    (index: number, m: { plane: readonly [number, number]; radians: number }) =>
      setArrangements((current) =>
        current.map((rotation, i) => (i === index ? netTurn(rotation, m.plane, m.radians) : rotation)),
      ),
    [],
  );

  /** Which cell each pane has in the middle of its cross, for the pane's own label. */
  const middleOf = useCallback(
    (index: number) => {
      if (!geometry || !base) return '';
      const cells = netStateLayout(geometry, base, arrangements[index]).cells;
      const middle = cells.find((c) => c.role === 'centre');
      return middle ? cellName(geometry, middle.face) : '';
    },
    [geometry, base, arrangements],
  );

  const axisColors = useAxisColors(geometry, controls.paletteId);
  const anyUnfolded = shown.some((open, i) => open && unfolded[i]);

  return (
    <div className="layout">
      <div className={`stage panes-${visibleCount}`}>
        {PANES.map((name, i) =>
          shown[i] ? (
            <Viewport
              key={i}
              index={i}
              label={name}
              unfolded={unfolded[i]}
              onToggleMode={() => toggleMode(i)}
              geometry={geometry}
              controls={controls}
              handlers={handlers}
              onRenderer={onRenderer}
              onSnapshot={onSnapshot}
              initial={cameras.current.get(i)}
              base={base}
              rotation={arrangements[i]}
              spacing={spacing}
              axisHints={axisHints}
              axisColors={axisColors}
              moves={moves}
              spins={spins}
              onPress={(m) => press(i, m)}
              middleLabel={middleOf(i)}
            />
          ) : null,
        )}
        {notice && <div className="notice">{notice}</div>}
        {(asset.loading || asset.error) && (
          <div className="overlay">
            {asset.error ? (
              <p className="error">{asset.error}</p>
            ) : (
              <p>Loading the hypercube…</p>
            )}
          </div>
        )}
      </div>

      <aside className="panel">
        <header className="masthead">
          <div>
            <h1>MagicCube4D</h1>
            <p className="sub">The hypercube &mdash; projected and unfolded.</p>
          </div>
          <a
            className="icon-link"
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Source code on GitHub"
            title="Source code on GitHub"
          >
            <svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true">
              <path
                fill="currentColor"
                d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
                   0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01
                   1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95
                   0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68
                   0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0
                   3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01
                   8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
              />
            </svg>
          </a>
        </header>
        <p className="lede">
          A{' '}
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
            modern port
          </a>{' '}
          of{' '}
          <a href="https://superliminal.com/cube/" target="_blank" rel="noopener noreferrer">
            the original
          </a>
          , by{' '}
          <a href="https://theoryandpractice.org/" target="_blank" rel="noopener noreferrer">
            Kyle Cranmer
          </a>{' '}
          and{' '}
          <a href="https://claude.ai/" target="_blank" rel="noopener noreferrer">
            Claude
          </a>
          . <a href={import.meta.env.BASE_URL}>More apps</a>.
        </p>

        <Section
          id="panes"
          title="Panes"
          defaultOpen
          badge={PANES.filter((_, i) => shown[i]).join(' ')}
        >
          <div className="chips">
            {PANES.map((name, i) => (
              <button
                key={name}
                className={shown[i] ? 'chip on' : 'chip'}
                onClick={() => togglePane(i)}
                aria-pressed={shown[i]}
                title={`Show or hide pane ${name}`}
              >
                {name}
              </button>
            ))}
          </div>
          <label className="check">
            <input type="checkbox" checked={axisHints} onChange={toggleAxisHints} />
            <span>Show axis hints in each pane</span>
          </label>
          <p className="hint">
            Which views to show — any one, any two, or all three. Each keeps its own camera, its own
            arrangement of the cross, and its own choice of <b>projected</b> or <b>unfolded</b>:
            press the word in the corner of a pane to swap it. Its own buttons sit underneath it;
            everything else on this panel applies to all of them. Hover a sticker in any pane and it
            lights up in every pane, unfolded and projected alike.
          </p>
        </Section>

        <Section id="move" title="Move" defaultOpen>
          <p className="counter">
            <span>
              <b>{session.twistCount}</b> twist{session.twistCount === 1 ? '' : 's'}
            </span>
            {session.solved && session.scrambled && <span className="won">Solved</span>}
          </p>
          <div className="buttons">
            <button onClick={actions.undo} disabled={!session.canUndo || session.busy}>
              Undo
            </button>
            <button onClick={actions.redo} disabled={!session.canRedo || session.busy}>
              Redo
            </button>
          </div>
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
            <kbd>3</kbd> chooses them for a single twist without changing the setting. Selecting all
            three turns the whole puzzle rather than a slice of it — which unfolded is visible as the
            cells changing places.
          </p>
          <h3 className="subhead">Direction</h3>
          <div className="chips">
            <button
              className={session.reversed ? 'chip' : 'chip on'}
              onClick={() => actions.setReversed(false)}
            >
              Counter
            </button>
            <button
              className={session.reversed ? 'chip on' : 'chip'}
              onClick={() => actions.setReversed(true)}
            >
              Clockwise
            </button>
          </div>
          <p className="hint">
            Which way a click turns. Right-click always turns the other way, and so does holding{' '}
            <kbd>Shift</kbd>.
          </p>
        </Section>

        <Section id="view" title="View controls">
          <h3 className="subhead">Colors</h3>
          <div className="palettes">
            {PALETTES.map((palette) => (
              <button
                key={palette.id}
                className={palette.id === controls.paletteId ? 'palette selected' : 'palette'}
                onClick={() => setControls({ paletteId: palette.id })}
                title={palette.note}
              >
                <span className="swatches">
                  {paletteSwatches(palette).map((c, i) => (
                    <i key={i} style={{ background: `rgb(${c.r},${c.g},${c.b})` }} />
                  ))}
                </span>
                <span className="name">{palette.name}</span>
              </button>
            ))}
          </div>

          {anyUnfolded && (
            <>
              <h3 className="subhead">The cross</h3>
              <Slider
                label="Spacing"
                value={spacing}
                min={1}
                max={2}
                onChange={setSpacing}
                unit="×"
              />
              <p className="hint">
                At 1× the cells touch, which is a true unfolding. Wider opens the gaps, so the cube
                in the middle stops being hidden by the six around it.
              </p>
            </>
          )}

          <h3 className="subhead">Shape and projection</h3>
          <Slider
            label="Face shrink"
            value={controls.faceShrink}
            min={0.1}
            max={0.99}
            onChange={(faceShrink) => setControls({ faceShrink })}
          />
          <Slider
            label="Sticker shrink"
            value={controls.stickerShrink}
            min={0.1}
            max={0.99}
            onChange={(stickerShrink) => setControls({ stickerShrink })}
          />
          <Slider
            label="Opacity"
            value={controls.opacity}
            min={0.15}
            max={1}
            onChange={(opacity) => setControls({ opacity })}
          />
          <p className="hint">
            How the puzzle is drawn, so these apply to every pane — except that an unfolded pane
            keeps its cells at full size and its stickers nearly so. Shrinking is what opens a
            projection up enough to see into; a net has nothing to see into, and shrunken cells would
            only stop it reading as eight ordinary cubes.
          </p>
        </Section>

        <RealSolves session={session} actions={actions} io={io} base={import.meta.env.BASE_URL} />

        <ImportExport
          session={session}
          actions={actions}
          io={io}
          puzzleId={asset.puzzleId}
          geometry={geometry}
          say={say}
        />

        <Section id="startover" title="Start over" defaultOpen>
          <div className="buttons">
            <button onClick={actions.scramble} disabled={session.busy}>
              Scramble
            </button>
            <button onClick={actions.reset} disabled={session.busy}>
              Reset
            </button>
          </div>
        </Section>
      </aside>
    </div>
  );
}

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="slider">
      <span className="row">
        <span>{props.label}</span>
        <span>
          {props.value.toFixed(2)}
          {props.unit ?? ''}
        </span>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={0.01}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  );
}
