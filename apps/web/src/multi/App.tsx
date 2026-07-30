import { useCallback, useMemo, useRef, useState } from 'react';

import { DEFAULT_PUZZLE_ID, findEntry } from '@mc4d/puzzle-core';
import { PALETTES, paletteSwatches } from '@mc4d/render';
import type { PuzzleRenderer } from '@mc4d/render';
import {
  ImportExport,
  PuzzlePicker,
  RealSolves,
  Section,
  appKey,
  usePuzzleAsset,
  usePuzzleSession,
  useAxisColors,
  useSolveIO,
  type PuzzleActions,
  type ViewSnapshot,
} from '@mc4d/shell';

import { Viewport } from './Viewport.js';

/**
 * One puzzle, up to three cameras.
 *
 * The point is that a 4D puzzle has no single good angle. In the classic app you turn the thing over
 * to see where a piece went, and then have to turn it back; here you leave a second pane looking at
 * the far side. Hover a sticker in any pane and it lights up in all of them, which is the shortest
 * demonstration of what the extra panes are for.
 *
 * The division of controls follows from what each thing is a property of. Layers, direction, shape,
 * palette and which puzzle are properties of the *puzzle*, so they live in the panel and apply
 * everywhere. Which way a camera points is a property of a *pane*, so those controls sit under the
 * pane they move. There is no "active pane": you operate one by pressing its own buttons.
 *
 * Deliberately not a copy of the classic app. Save, load, import, export and the Hall of Fame all
 * live there; this exists to answer one question.
 */

const REPO_URL = 'https://github.com/cranmer/cube4d';

/**
 * The panes, named rather than counted.
 *
 * They were a count — one, two or three — which quietly meant the panes were interchangeable, and
 * they are not: each keeps its own camera, so B is a *particular* view of the puzzle and not merely
 * "the second one". Showing them is therefore a choice per pane, which also means you can put B
 * beside C and leave A closed, rather than only ever growing the set from the left.
 */
const PANES = ['A', 'B', 'C'];

function readShown(): boolean[] {
  const fallback = [true, true, false];
  try {
    const stored = globalThis.localStorage?.getItem(appKey('panes'));
    if (!stored) return fallback;
    const shown = PANES.map((name) => stored.includes(name));
    // A layout with nothing in it is not a layout.
    return shown.some(Boolean) ? shown : fallback;
  } catch {
    return fallback;
  }
}

export function App() {
  const assetBase = `${import.meta.env.BASE_URL}assets/`;
  // Four-dimensional only: the per-pane Tip and Flip would rotate a flat puzzle out of its
  // hyperplane, and this app is about seeing a 4D object from several angles at once.
  const asset = usePuzzleAsset(
    assetBase,
    { id: DEFAULT_PUZZLE_ID, path: '4-3-3_3.mc4dpz' },
    {
      accepts: (entry) => entry.nDims === 4,
      // Vivid: three small panes at once, so the cells have to be told apart at a glance.
      defaultPaletteId: 'vivid',
    },
  );
  const [shown, setShown] = useState<boolean[]>(readShown);
  const visibleCount = shown.filter(Boolean).length;

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

  // Where each pane's camera was when it was last open. Closing a pane and reopening it should
  // return you to the view you had set up, not to the default — that view is often the whole reason
  // the pane was open.
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

  // Pane A's camera is the one a loaded solve restores into, since a save records one view matrix
  // and there is no honest way to spread it across three.
  const primaryRotation = useCallback(
    () => takeSnapshot.current.get(0)?.().mat4d ?? [],
    [],
  );
  const io = useSolveIO({
    actions,
    catalog: asset.catalog,
    puzzleId: asset.puzzleId,
    geometry: asset.geometry,
    selectPuzzle: asset.selectPuzzle,
    getRotation: () => Array.from(primaryRotation()),
    setRotation: () => {
      /* Panes keep their own cameras, and overriding them on load would discard the arrangement
         that is the reason for using this app. The solve's stored view is deliberately ignored. */
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
      try {
        globalThis.localStorage?.setItem(
          appKey('panes'),
          PANES.filter((_, i) => next[i]).join(''),
        );
      } catch {
        /* a forgotten layout is not worth surfacing */
      }
      return next;
    });
  }, []);

  const { controls, setControls } = asset;
  const axisColors = useAxisColors(asset.geometry, controls.paletteId);
  // One setting for every pane: whether to show the compass is a preference about reading the
  // picture, not something you would want answered differently in pane B than in pane A.
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

  return (
    <div className="layout">
      <div className={`stage panes-${visibleCount}`}>
        {PANES.map((name, i) =>
          shown[i] ? (
          <Viewport
            key={i}
            index={i}
            label={name}
            geometry={asset.geometry}
            controls={controls}
            handlers={handlers}
            onRenderer={onRenderer}
            onSnapshot={onSnapshot}
            initial={cameras.current.get(i)}
            axisColors={axisColors}
            axisHints={axisHints}
          />
          ) : null,
        )}
        {notice && <div className="notice">{notice}</div>}
        {(asset.loading || asset.error) && (
          <div className="overlay">
            {asset.error ? (
              <p className="error">{asset.error}</p>
            ) : (
              <p>Loading {asset.loadingId ?? 'the hypercube'}…</p>
            )}
          </div>
        )}
      </div>

      <aside className="panel">
        <header className="masthead">
          <div>
            <h1>MagicCube4D</h1>
            <p className="sub">Multi-view &mdash; one puzzle, several angles.</p>
          </div>
          <a
            className="icon-link"
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Source code on GitHub"
            title="Source code on GitHub"
          >
            {/* The GitHub mark inlined rather than pulled from an icon library: the whole site is
                self-contained, and this is one path against a few hundred kilobytes. */}
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
        {/* The same byline the classic app carries, ending in a way out rather than in the gallery
            link: someone here has already chosen an app, so the useful offer is the other ones. */}
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
            Which views of the puzzle to show — any one, any two, or all three. Each keeps its own
            camera, so closing a pane and reopening it returns you to the view you had. Turn, Tip and
            Flip sit under the pane they move; everything else on this panel applies to all of them.
            Hover a sticker in any pane and it lights up in every pane.
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
          {session.sliceCount > 1 && (
            <>
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
            </>
          )}
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
          <p className="hint">These describe how the puzzle is drawn, so they apply to every pane.</p>
        </Section>

        {asset.catalog && (
          <Section id="puzzle" title="Puzzles" badge={asset.puzzleId}>
            <PuzzlePicker
              catalog={asset.catalog}
              currentId={asset.puzzleId}
              loadingId={asset.loadingId}
              onSelect={(entry) => asset.selectPuzzle(entry.id, entry.path.replace(/\.mc4dpz$/, '.mc4dpz'))}
            />
          </Section>
        )}

        <RealSolves session={session} actions={actions} io={io} base={import.meta.env.BASE_URL} />

        <ImportExport
          session={session}
          actions={actions}
          io={io}
          puzzleId={asset.puzzleId}
          geometry={asset.geometry}
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
  onChange: (value: number) => void;
}) {
  return (
    <label className="slider">
      <span className="row">
        <span>{props.label}</span>
        <span>{props.value.toFixed(2)}</span>
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
