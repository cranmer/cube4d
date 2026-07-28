import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { DEFAULT_PUZZLE_ID, findEntry } from '@mc4d/puzzle-core';
import { PALETTES, paletteSwatches } from '@mc4d/render';

import { PuzzlePicker } from './PuzzlePicker.js';
import {
  decodePermalink,
  download,
  encodePermalink,
  fromSaveDoc,
  parseDropped,
  saveDocToLogText,
  suggestFilename,
  toSaveDoc,
} from './persist.js';

import { DEFAULT_CONTROLS, usePuzzleCanvas } from './usePuzzleCanvas.js';
import { usePuzzleSession, type PuzzleActions } from './usePuzzle.js';

/**
 * Phase 4: the puzzle is playable.
 *
 * Click a sticker to twist the piece it belongs to; hold number keys to choose which layers turn.
 * The view controls are deliberately the ones that teach something — the shrink sliders open the
 * gaps you see through, and dragging the 4D eye toward 1 makes the fourth dimension unmistakable.
 */
const REPO_URL = 'https://github.com/cranmer/cube4d';

export function App() {
  const assetBase = `${import.meta.env.BASE_URL}assets/`;

  // The canvas and the session each need the other, so the handlers reach the session through a
  // ref that is filled in immediately below.
  const actionsRef = useRef<PuzzleActions | null>(null);
  const handlers = useMemo(
    () => ({
      onTap: (x: number, y: number, button: number) => actionsRef.current?.onClick(x, y, button),
      onHover: (x: number, y: number) => actionsRef.current?.onPointerMove(x, y),
      onLeave: () => actionsRef.current?.onPointerLeave(),
    }),
    [],
  );

  const puzzle = usePuzzleCanvas(
    assetBase,
    { id: DEFAULT_PUZZLE_ID, path: '4-3-3_3.mc4dpz' },
    handlers,
  );
  const { session, actions } = usePuzzleSession(puzzle.getRenderer, puzzle.geometry);
  actionsRef.current = actions;

  const { controls, setControls } = puzzle;
  const sliceLabel = describeSlices(session.slicemask);
  const [notice, setNotice] = useState<string | null>(null);
  // State, not a ref: a restore has to wait for the right geometry, and setting a ref would not
  // schedule the effect that consumes it — so a link for the puzzle already on screen would sit
  // there forever, since nothing else causes a render.
  const [pendingRestore, setPendingRestore] = useState<ReturnType<typeof fromSaveDoc> | null>(null);

  const say = useCallback((message: string) => {
    setNotice(message);
    setTimeout(() => setNotice((current) => (current === message ? null : current)), 4000);
  }, []);

  // --- opening a permalink
  const [hash, setHash] = useState(() => globalThis.location?.hash ?? '');
  useEffect(() => {
    // Pasting a link into the address bar of an already-open tab changes only the fragment, which
    // is a same-document navigation: nothing reloads and a mount-only effect would never see it.
    const onHashChange = () => setHash(globalThis.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    const link = decodePermalink(hash);
    if (!link || !puzzle.catalog) return;
    const entry = findEntry(puzzle.catalog, link.puzzleId);
    if (!entry) {
      say(`This link is for ${link.puzzleId}, which is not in the catalog.`);
      return;
    }
    setPendingRestore({
      puzzleId: entry.id,
      schlafli: entry.schlafli,
      length: entry.length,
      history: { moves: link.moves, marks: [], index: link.moves.length },
      scrambleState: link.moves.length > 0 ? 'full' : 'none',
      viewMatrix: [],
    });
    // Clear the fragment so a reload does not keep re-applying it over your own moves.
    globalThis.history?.replaceState(null, '', globalThis.location.pathname);
    setHash('');
    if (entry.id !== puzzle.puzzleId) puzzle.selectPuzzle(entry.id, entry.path);
  }, [hash, puzzle.catalog]);

  // A restore has to wait for the right geometry to finish loading.
  useEffect(() => {
    if (!pendingRestore || !puzzle.geometry || puzzle.puzzleId !== pendingRestore.puzzleId) return;
    setPendingRestore(null);
    actions.restore(pendingRestore);
    // The original stores the camera alongside the moves, so a loaded solve looks as it was left.
    if (pendingRestore.viewMatrix.length === 16) puzzle.setRotation(pendingRestore.viewMatrix);
    say(`Loaded ${pendingRestore.history.moves.length} moves.`);
  }, [pendingRestore, puzzle.geometry, puzzle.puzzleId, actions, say]);

  const currentEntry = puzzle.catalog ? findEntry(puzzle.catalog, puzzle.puzzleId) : undefined;

  const buildDoc = useCallback(() => {
    const state = actions.snapshot();
    return toSaveDoc(
      {
        puzzleId: puzzle.puzzleId,
        schlafli: currentEntry?.schlafli ?? puzzle.geometry?.schlafli ?? '',
        length: currentEntry?.length ?? puzzle.geometry?.edgeLength ?? 0,
        history: state.history,
        scrambleState: state.scrambleState,
        ...(state.scramble ? { scramble: state.scramble } : {}),
        viewMatrix: puzzle.getRotation(),
        ...(puzzle.catalog ? { assetsVersion: puzzle.catalog.assetsVersion } : {}),
      },
      puzzle.geometry,
    );
  }, [actions, currentEntry, puzzle.catalog, puzzle.geometry, puzzle.puzzleId]);

  const openFile = useCallback(
    async (file: File) => {
      try {
        const { doc, warnings } = parseDropped(file.name, await file.text());
        const snapshot = fromSaveDoc(doc);
        const entry = puzzle.catalog ? findEntry(puzzle.catalog, snapshot.puzzleId) : undefined;
        if (!entry) {
          say(`${file.name} is for ${snapshot.puzzleId}, which is not in the catalog.`);
          return;
        }
        for (const warning of warnings) say(warning);
        if (entry.id === puzzle.puzzleId) {
          actions.restore(snapshot);
          if (snapshot.viewMatrix.length === 16) puzzle.setRotation(snapshot.viewMatrix);
          say(`Loaded ${snapshot.history.moves.length} moves from ${file.name}.`);
        } else {
          setPendingRestore(snapshot);
          puzzle.selectPuzzle(entry.id, entry.path);
        }
      } catch (e) {
        say(e instanceof Error ? e.message : String(e));
      }
    },
    [actions, puzzle, say],
  );

  // --- drag and drop, anywhere on the window
  useEffect(() => {
    const over = (event: DragEvent) => event.preventDefault();
    const drop = (event: DragEvent) => {
      event.preventDefault();
      const file = event.dataTransfer?.files?.[0];
      if (file) void openFile(file);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [openFile]);

  return (
    <div className="layout">
      <div className="stage">
        <canvas ref={puzzle.canvasRef} />
        {(puzzle.loading || puzzle.error) && (
          <div className="overlay">
            {puzzle.error ? (
              <p className="error">{puzzle.error}</p>
            ) : (
              <p>Loading {puzzle.loadingId ?? 'the hypercube'}…</p>
            )}
          </div>
        )}
        {session.solved && session.scrambled && <div className="banner">Solved</div>}
        {notice && <div className="notice">{notice}</div>}
        <div className="hud">
          <span>
            <b>{session.twistCount}</b> twist{session.twistCount === 1 ? '' : 's'}
          </span>
          {sliceLabel !== '1' && <span className="slices">layer {sliceLabel}</span>}
        </div>
      </div>

      <aside className="panel">
        <header className="masthead">
          <div>
            <h1>MagicCube4D</h1>
            <p className="sub">A four-dimensional Rubik&rsquo;s cube.</p>
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
        {/* Two links, one line: this project and its ancestor. The original's licence asks for
            attribution "with links to the main project page", which the second link is. Naming two
            of its four authors would be worse than naming none, so the full credit lives in the
            README and LICENSE. */}
        <p className="lede">
          A{' '}
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
            modern port
          </a>{' '}
          of{' '}
          <a href="https://superliminal.com/cube/" target="_blank" rel="noopener noreferrer">
            the original
          </a>
          .
        </p>

        {/* Navigation only. Scramble and reset discard a solve, so they live at the far end of
            the panel rather than a few pixels from Undo. */}
        <div className="group">
          <h2>Move</h2>
          <div className="buttons">
            <button disabled={!session.canUndo} onClick={() => actions.undo()}>
              Undo
            </button>
            <button disabled={!session.canRedo} onClick={() => actions.redo()}>
              Redo
            </button>
          </div>
          <div className="buttons">
            <button
              onClick={() => {
                // Resets the camera, not the puzzle and not the palette.
                const { paletteId, ...view } = DEFAULT_CONTROLS;
                setControls(view);
                puzzle.resetView();
              }}
              title="Return the camera to its starting orientation"
            >
              Reset view
            </button>
          </div>
        </div>

        {session.sliceCount > 1 && (
          <div className="group">
            <h2>Layers</h2>
            {/* One toggle per layer the puzzle actually has, so a 2⁴ offers two and a 4⁴ four.
                These mirror the 1–9 keys, which still work — but the keys are held and invisible,
                and these stay put and show their state. */}
            <div className="chips">
              {Array.from({ length: session.sliceCount }, (_, i) => (
                <button
                  key={i}
                  className={session.slicemask & (1 << i) ? 'chip on' : 'chip'}
                  onClick={() => actions.toggleSlice(i)}
                  title={`Layer ${i + 1}, counting inward from the cell you click`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
            <p className="hint">
              Which layers turn, counting inward. Select several to turn them together; select all
              to rotate the whole puzzle.
            </p>
          </div>
        )}

        <div className="group">
          <h2>Direction</h2>
          {/* Right-click reverses a twist on a desktop; touch has no second button, so the
              direction needs to be selectable. Right-click still means "the other way" whichever
              of these is chosen. */}
          <div className="chips">
            <button
              className={session.reversed ? 'chip' : 'chip on'}
              onClick={() => actions.setReversed(false)}
              aria-pressed={!session.reversed}
              title="Counter-clockwise — what a plain click has always done"
            >
              <TurnIcon clockwise={false} />
              <span>Counter</span>
            </button>
            <button
              className={session.reversed ? 'chip on' : 'chip'}
              onClick={() => actions.setReversed(true)}
              aria-pressed={session.reversed}
              title="Clockwise — the same as right-clicking"
            >
              <TurnIcon clockwise />
              <span>Clockwise</span>
            </button>
          </div>
          <p className="hint">Which way a click turns. Right-click always turns the other way.</p>
        </div>

        <div className="group">
          <h2>Controls</h2>
          <dl className="help">
            <dt>Click a sticker</dt>
            <dd>Twist that piece. Right-click turns the other way.</dd>
            <dt>Direction</dt>
            <dd>Sets which way a plain click turns, for when right-click is not available.</dd>
            <dt>Hold 1–9</dt>
            <dd>Choose which layers turn — the same as the Layers toggles above.</dd>
            <dt>Drag</dt>
            <dd>Rotate in 3D.</dd>
            <dt>Shift + drag</dt>
            <dd>
              Rotate in 4D. This is the one with no 3D analogue: it turns cells through the fourth
              dimension and brings the hidden cell to the front.
            </dd>
            <dt>Right-drag</dt>
            <dd>Roll, and rotate in the ZW plane.</dd>
            <dt>Scroll, or pinch</dt>
            <dd>Zoom.</dd>
          </dl>
        </div>

        <div className="group">
          <h2>Colours</h2>
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
        </div>

        <div className="group">
          <h2>View</h2>
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
            min={0.1}
            max={1}
            onChange={(opacity) => setControls({ opacity })}
          />
          <Slider
            label="4D eye distance"
            value={controls.eyeW}
            min={1.01}
            max={4}
            step={0.01}
            onChange={(eyeW) => setControls({ eyeW })}
          />
        </div>

        {puzzle.catalog && (
          <div className="group">
            <h2>Puzzle</h2>
            <PuzzlePicker
              catalog={puzzle.catalog}
              currentId={puzzle.puzzleId}
              loadingId={puzzle.loadingId}
              onSelect={(entry) => puzzle.selectPuzzle(entry.id, entry.path)}
            />
          </div>
        )}

        {puzzle.geometry && (
          <div className="group">
            <h2>This puzzle</h2>
            <p className="facts">
              <b>{puzzle.geometry.schlafli}</b> at length <b>{puzzle.geometry.edgeLength}</b>
              <br />
              <b>{puzzle.geometry.nFaces}</b> cells, <b>{puzzle.geometry.nCubies}</b> pieces,{' '}
              <b>{puzzle.geometry.nStickers}</b> stickers
              {puzzle.puzzleId === DEFAULT_PUZZLE_ID && (
                <>
                  <br />
                  <b>
                    1.76 × 10<sup>120</sup>
                  </b>{' '}
                  reachable states
                </>
              )}
            </p>
          </div>
        )}

        <div className="group">
          <h2>Why it looks like that</h2>
          <p className="facts">
            You are seeing a 4D object projected into 3D, then onto your screen. The nearest cell is
            hidden so you can see through it into the interior — which is why a cube appears to sit
            inside another cube. Every one of those cells is a genuine cube; they only look
            distorted because they are further away in a direction you cannot point.
          </p>
        </div>

        <div className="group">
          <h2>Solve</h2>
          <div className="buttons">
            <button
              onClick={() => download(suggestFilename(puzzle.puzzleId, 'json'), JSON.stringify(buildDoc(), null, 2), 'application/json')}
              title="Save as JSON — this project's own format"
            >
              Save
            </button>
            <button
              onClick={() => download(suggestFilename(puzzle.puzzleId, 'log'), saveDocToLogText(buildDoc()), 'text/plain')}
              title="Export a MagicCube4D .log file, readable by the original"
            >
              Export .log
            </button>
          </div>
          <div className="buttons">
            <label className="filebutton">
              Open…
              <input
                type="file"
                accept=".json,.log,application/json,text/plain"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void openFile(file);
                  e.target.value = '';
                }}
              />
            </label>
            <button
              onClick={async () => {
                const state = actions.snapshot();
                const url = `${globalThis.location.origin}${globalThis.location.pathname}#${encodePermalink(
                  puzzle.puzzleId,
                  state.history.moves.slice(0, state.history.index),
                )}`;
                try {
                  await navigator.clipboard.writeText(url);
                  say('Link copied.');
                } catch {
                  // Clipboard access needs permission and a secure context; fall back to showing it.
                  globalThis.prompt?.('Copy this link:', url);
                }
              }}
              title="Copy a link that reproduces this position"
            >
              Copy link
            </button>
          </div>
          <p className="hint">
            Or drop a <code>.json</code> or <code>.log</code> file anywhere on the page. Exported
            logs open in the original MagicCube4D.
          </p>
        </div>

        {/* Last in the panel on purpose: both of these throw away whatever solve is in progress. */}
        <div className="group">
          <h2>Start over</h2>
          <div className="buttons">
            <button onClick={() => actions.scramble()}>Scramble</button>
            <button onClick={() => actions.reset()}>Reset</button>
          </div>
          <p className="hint">Both discard the current solve.</p>
        </div>
      </aside>
    </div>
  );
}

/**
 * A circular arrow.
 *
 * Drawn rather than typed: the obvious characters for this (⟲ ⟳ ↺ ↻) are missing from enough
 * system fonts to render as a dot, which is worse than no icon at all. One is the mirror of the
 * other, so the same path serves both.
 */
function TurnIcon({ clockwise }: { clockwise: boolean }) {
  // An arc that runs into a right-angled tail. A filled arrowhead was the first attempt and read
  // as a speck at 15px; a corner the same weight as the arc is legible at any size.
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {clockwise ? (
        <>
          <polyline points="23 4 23 10 17 10" />
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
        </>
      ) : (
        <>
          <polyline points="1 4 1 10 7 10" />
          <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
        </>
      )}
    </svg>
  );
}

/** "1", "1+2", … for the slice indicator. */
function describeSlices(mask: number): string {
  if (mask === 0) return '';
  const parts: number[] = [];
  for (let i = 0; i < 9; ++i) if (mask & (1 << i)) parts.push(i + 1);
  return parts.join('+');
}

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
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
        step={props.step ?? 0.01}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  );
}
