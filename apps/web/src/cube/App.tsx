import { useCallback, useMemo, useRef, useState } from 'react';

import { isPlayable, type Catalog } from '@mc4d/puzzle-core';
import { PALETTES, paletteSwatches } from '@mc4d/render';
import type { PuzzleRenderer } from '@mc4d/render';
import {
  PuzzlePicker,
  Section,
  appKey,
  usePuzzleAsset,
  usePuzzleSession,
  type PuzzleActions,
  type ViewSnapshot,
} from '@mc4d/shell';

import { Viewport } from './Viewport.js';

/**
 * An ordinary Rubik's cube, on the engine that builds the hypercube.
 *
 * Its own app rather than a mode of the classic one, because almost every control differs. What it
 * shares is everything below the layout: the same geometry pipeline, the same twist code, the same
 * pick heuristic. That sharing is the point — see docs/three-d.md.
 *
 * **Tip is here on purpose, and it is the most interesting control in the app.** A 3D puzzle is drawn
 * flat in W — every vertex at `w = 0` — which is what makes the 4D→3D projection stage vanish, since
 * it divides by `eyeW − w`. Turn and drag stay inside that hyperplane. *Tip does not*: it rotates the
 * viewer axis into the puzzle's own, so a cube that was flat in W acquires extent in W and the
 * projection starts foreshortening it. What you see is a cube being turned through the fourth
 * dimension, which is a strange thing to watch and precisely the point — it makes visible both that
 * this is a 4D pipeline and that the cube was sitting flat in it all along.
 *
 * Flip is the odd one. It preserves flatness but acts on the `w = 0` slab as `diag(1, 1, −1)`: a
 * reflection, so it shows a mirror-image cube. It is offered anyway, next to Tip, because "the fourth
 * dimension lets you mirror a solid without passing it through itself" is a true and famous fact that
 * most people have only read about.
 *
 * The eight named viewpoints are *not* offered: each sends a puzzle axis all the way to W, which
 * turns the cube edge-on and shows nothing.
 */

const REPO_URL = 'https://github.com/cranmer/cube4d';

const DEFAULT = { id: '{4,3} 3', path: '4-3_3.mc4dpz' };

/** Panes are named rather than counted: each keeps its own camera, so B is a particular view. */
const PANES = ['A', 'B', 'C'];

function readShown(): boolean[] {
  const fallback = [true, false, false];
  try {
    const stored = globalThis.localStorage?.getItem(appKey('panes'));
    if (!stored) return fallback;
    const shown = PANES.map((name) => stored.includes(name));
    return shown.some(Boolean) ? shown : fallback;
  } catch {
    return fallback;
  }
}

export function App() {
  const assetBase = `${import.meta.env.BASE_URL}assets/`;
  // Three-dimensional only, so switching between apps cannot leave one showing the other's puzzle.
  const asset = usePuzzleAsset(assetBase, DEFAULT, { accepts: (entry) => entry.nDims === 3 });

  const [shown, setShown] = useState<boolean[]>(readShown);
  const visibleCount = shown.filter(Boolean).length;

  const renderers = useRef<(PuzzleRenderer | null)[]>([]);
  const onRenderer = useCallback((index: number, renderer: PuzzleRenderer | null) => {
    renderers.current[index] = renderer;
  }, []);
  const cameras = useRef(new Map<number, ViewSnapshot>());
  const takeSnapshot = useRef(new Map<number, () => ViewSnapshot>());
  const onSnapshot = useCallback((index: number, fn: () => ViewSnapshot) => {
    takeSnapshot.current.set(index, fn);
  }, []);

  const togglePane = useCallback((index: number) => {
    setShown((current) => {
      const next = [...current];
      next[index] = !next[index];
      if (!next.some(Boolean)) return current;
      if (!next[index]) {
        const take = takeSnapshot.current.get(index);
        if (take) cameras.current.set(index, take());
      }
      try {
        globalThis.localStorage?.setItem(appKey('panes'), PANES.filter((_, i) => next[i]).join(''));
      } catch {
        /* a forgotten layout is not worth surfacing */
      }
      return next;
    });
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

  const getViews = useCallback(
    () => renderers.current.filter((r, i): r is PuzzleRenderer => !!r && !!shown[i]),
    [shown],
  );

  const { session, actions } = usePuzzleSession(getViews, asset.geometry);
  actionsRef.current = actions;

  /** The catalog is already 3D-only; drop the one-cubie entries, which are not puzzles. */
  const catalog: Catalog | null = useMemo(
    () =>
      asset.catalog
        ? { ...asset.catalog, puzzles: asset.catalog.puzzles.filter(isPlayable) }
        : null,
    [asset.catalog],
  );

  const { controls, setControls } = asset;

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
            />
          ) : null,
        )}
        {(asset.loading || asset.error) && (
          <div className="overlay">
            {asset.error ? (
              <p className="error">{asset.error}</p>
            ) : (
              <p>Loading {asset.loadingId ?? 'the cube'}…</p>
            )}
          </div>
        )}
        <div className="hud">
          <span>
            <b>{session.twistCount}</b> twist{session.twistCount === 1 ? '' : 's'}
          </span>
          {session.slicemask !== 1 && <span className="slices">layer {describeSlices(session.slicemask)}</span>}
        </div>
      </div>

      <aside className="panel">
        <header className="masthead">
          <div>
            <h1>MagicCube4D</h1>
            <p className="sub">A Rubik&rsquo;s cube on the four-dimensional engine.</p>
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

        <Section id="panes" title="Panes" defaultOpen badge={PANES.filter((_, i) => shown[i]).join(' ')}>
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
          <p className="hint">
            Views of the same cube, each with its own camera and its own Turn, Tip and Flip. Useful
            here for the same reason as on the hypercube — leave one pane looking at the far side —
            and for one more: tip a second pane through the fourth dimension and watch the same solid
            from inside and outside the hyperplane at once.
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

        <Section id="twist" title="Twist control" defaultOpen badge={describeSlices(session.slicemask)}>
          {session.sliceCount > 1 && (
            <>
              <h3 className="subhead">Layers</h3>
              <div className="chips">
                {Array.from({ length: session.sliceCount }, (_, i) => (
                  <button
                    key={i}
                    className={session.slicemask & (1 << i) ? 'chip on' : 'chip'}
                    onClick={() => actions.toggleSlice(i)}
                    title={`Layer ${i + 1}, counting inward from the face you click`}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
              <p className="hint">
                Which layers turn, counting inward. The number keys work too, while held.
              </p>
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

        <Section id="how" title="How to twist" defaultOpen>
          {/* The reason this app exists: the same rule the hypercube uses, on a shape you can
              already picture. See docs/three-d.md §5. */}
          <dl className="help">
            <dt>Click a centre sticker</dt>
            <dd>Turns that face a quarter turn — 90°, the move you already know.</dd>
            <dt>Click an edge sticker</dt>
            <dd>Asks for a half turn about that edge — 180°.</dd>
            <dt>Click a corner sticker</dt>
            <dd>Asks for a third of a turn about that corner — 120°.</dd>
          </dl>
          <dl className="help">
            <dt>
              Hold <kbd>Ctrl</kbd> and click anywhere on a face
            </dt>
            <dd>Turns that face, whatever piece you clicked — the move its centre sticker would give.</dd>
          </dl>
          <p className="hint">
            Which axis a click means is inferred from how many colours the piece carries, exactly as
            on the hypercube. Corner and edge turns need every layer selected: on a solid they can
            only turn the whole thing, which is why a real Rubik&rsquo;s cube has no corner move.
          </p>
          <p className="hint">
            <b>The 2×2×2 has only corners</b>, so without <kbd>Ctrl</kbd> every click asks for a
            corner turn and the puzzle has no moves at all. Holding it names the face axis directly,
            which is what makes a pocket cube playable — and the same key helps on any puzzle whose
            pieces cannot express the axis you want.
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
          <h3 className="subhead">Shape</h3>
          <Slider
            label="Sticker size"
            value={controls.stickerShrink}
            min={0.4}
            max={1}
            onChange={(stickerShrink) => setControls({ stickerShrink })}
          />
          <Slider
            label="Faces apart"
            value={controls.faceShrink}
            min={0.3}
            max={1}
            onChange={(faceShrink) => setControls({ faceShrink })}
          />
          <p className="hint">
            Pulling the faces apart is how the hypercube is drawn by default, and it works here too:
            the six faces separate and you can see the cube from the inside.
          </p>
          <h3 className="subhead">The fourth dimension is still there</h3>
          <p className="hint">
            This cube is drawn by the four-dimensional pipeline, lying flat in the W axis it does not
            use — which is why the 4D→3D projection does nothing to it. <b>Tip</b>, under each
            pane, rotates it out of that flatness and through W, so you can watch a solid
            foreshorten in a direction it has no extent in. <b>Flip</b> mirrors it: in four
            dimensions a solid can be turned into its own mirror image without passing through
            itself.
          </p>
        </Section>

        {catalog && catalog.puzzles.length > 0 && (
          <Section id="puzzle" title="Puzzles" defaultOpen badge={asset.puzzleId}>
            <PuzzlePicker
              catalog={catalog}
              currentId={asset.puzzleId}
              loadingId={asset.loadingId}
              onSelect={(entry) => asset.selectPuzzle(entry.id, entry.path)}
            />
            <p className="hint">
              Every solid the engine can slice. The tetrahedron, octahedron and icosahedron are
              absent because its geometry library refuses them, not because they were left out.
            </p>
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

/** "1", "1+2", … for the layer indicator. */
function describeSlices(mask: number): string {
  const layers: number[] = [];
  for (let i = 0; i < 9; ++i) if (mask & (1 << i)) layers.push(i + 1);
  return layers.join('+') || '1';
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

/** Two arrows trading places, for the move that mirrors the solid through the fourth dimension. */
function FlipIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.6 5.6h10.8" /><path d="M10.8 3l2.6 2.6-2.6 2.6" />
      <path d="M13.4 10.4H2.6" /><path d="M5.2 7.8 2.6 10.4l2.6 2.6" />
    </svg>
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
