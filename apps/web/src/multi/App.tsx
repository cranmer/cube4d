import { useCallback, useMemo, useRef, useState } from 'react';

import { DEFAULT_PUZZLE_ID, findEntry } from '@mc4d/puzzle-core';
import { PALETTES, paletteSwatches } from '@mc4d/render';
import type { PuzzleRenderer } from '@mc4d/render';
import {
  PuzzlePicker,
  Section,
  appKey,
  usePuzzleAsset,
  usePuzzleSession,
  useViewport,
  type PuzzleActions,
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
const MAX_PANES = 3;

/** Panes are labelled rather than numbered from zero, since the labels are for people. */
const PANE_LABELS = ['A', 'B', 'C'];

function readPaneCount(): number {
  try {
    const stored = Number(globalThis.localStorage?.getItem(appKey('panes')));
    return Number.isInteger(stored) && stored >= 1 && stored <= MAX_PANES ? stored : 2;
  } catch {
    return 2;
  }
}

export function App() {
  const assetBase = `${import.meta.env.BASE_URL}assets/`;
  const asset = usePuzzleAsset(assetBase, { id: DEFAULT_PUZZLE_ID, path: '4-3-3_3.mc4dpz' });
  const [paneCount, setPaneCountState] = useState(readPaneCount);

  // Every pane's renderer, so the session can broadcast a twist to all of them. A ref rather than
  // state: it changes when a pane mounts, and re-rendering the panes because a pane mounted would
  // be a loop.
  const renderers = useRef<(PuzzleRenderer | null)[]>([]);
  const onRenderer = useCallback((index: number, renderer: PuzzleRenderer | null) => {
    renderers.current[index] = renderer;
  }, []);
  const getViews = useCallback(
    () => renderers.current.slice(0, paneCount).filter((r): r is PuzzleRenderer => !!r),
    [paneCount],
  );

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

  const setPaneCount = useCallback((n: number) => {
    setPaneCountState(n);
    try {
      globalThis.localStorage?.setItem(appKey('panes'), String(n));
    } catch {
      /* a forgotten layout is not worth surfacing */
    }
  }, []);

  const { controls, setControls } = asset;

  return (
    <div className="layout">
      <div className={`stage panes-${paneCount}`}>
        {Array.from({ length: paneCount }, (_, i) => (
          <Viewport
            key={i}
            index={i}
            label={PANE_LABELS[i]}
            geometry={asset.geometry}
            controls={controls}
            handlers={handlers}
            onRenderer={onRenderer}
          />
        ))}
        {(asset.loading || asset.error) && (
          <div className="overlay">
            {asset.error ? (
              <p className="error">{asset.error}</p>
            ) : (
              <p>Loading {asset.loadingId ?? 'the hypercube'}…</p>
            )}
          </div>
        )}
        <div className="hud">
          <span>
            <b>{session.twistCount}</b> twist{session.twistCount === 1 ? '' : 's'}
          </span>
          {session.solved && session.scrambled && <span className="won">Solved</span>}
        </div>
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

        <Section id="panes" title="Panes" defaultOpen badge={`${paneCount}`}>
          <div className="chips">
            {Array.from({ length: MAX_PANES }, (_, i) => (
              <button
                key={i}
                className={paneCount === i + 1 ? 'chip on' : 'chip'}
                onClick={() => setPaneCount(i + 1)}
                aria-pressed={paneCount === i + 1}
              >
                {i + 1}
              </button>
            ))}
          </div>
          <p className="hint">
            How many views of the same puzzle. Each has its own camera and its own Turn, Tip and Flip
            underneath it; everything else on this panel applies to all of them. Hover a sticker in
            any pane and it lights up in every pane.
          </p>
        </Section>

        <Section id="move" title="Move" defaultOpen>
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
          <p className="hint">Which way a click turns. Right-click always turns the other way.</p>
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
