import { useMemo, useRef } from 'react';

import { DEFAULT_CONTROLS, usePuzzleCanvas } from './usePuzzleCanvas.js';
import { usePuzzleSession, type PuzzleActions } from './usePuzzle.js';

/**
 * Phase 4: the puzzle is playable.
 *
 * Click a sticker to twist the piece it belongs to; hold number keys to choose which layers turn.
 * The view controls are deliberately the ones that teach something — the shrink sliders open the
 * gaps you see through, and dragging the 4D eye toward 1 makes the fourth dimension unmistakable.
 */
export function App() {
  const assetUrl = `${import.meta.env.BASE_URL}assets/4-3-3_3.mc4dpz.gz`;

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

  const puzzle = usePuzzleCanvas(assetUrl, handlers);
  const { session, actions } = usePuzzleSession(puzzle.getRenderer, puzzle.geometry);
  actionsRef.current = actions;

  const { controls, setControls } = puzzle;
  const sliceLabel = describeSlices(session.slicemask);

  return (
    <div className="layout">
      <div className="stage">
        <canvas ref={puzzle.canvasRef} />
        {(puzzle.loading || puzzle.error) && (
          <div className="overlay">
            {puzzle.error ? <p className="error">{puzzle.error}</p> : <p>Loading the hypercube…</p>}
          </div>
        )}
        {session.solved && session.scrambled && (
          <div className="banner">Solved</div>
        )}
        <div className="hud">
          <span>
            <b>{session.twistCount}</b> twist{session.twistCount === 1 ? '' : 's'}
          </span>
          {sliceLabel && <span className="slices">slice {sliceLabel}</span>}
        </div>
      </div>

      <aside className="panel">
        <h1>MagicCube4D</h1>
        <p className="sub">A four-dimensional Rubik&rsquo;s cube.</p>

        <div className="group">
          <h2>Play</h2>
          <div className="buttons">
            <button onClick={() => actions.scramble()}>Scramble</button>
            <button onClick={() => actions.reset()}>Reset</button>
          </div>
          <div className="buttons">
            <button disabled={!session.canUndo} onClick={() => actions.undo()}>
              Undo
            </button>
            <button disabled={!session.canRedo} onClick={() => actions.redo()}>
              Redo
            </button>
          </div>
        </div>

        <div className="group">
          <h2>Controls</h2>
          <dl className="help">
            <dt>Click a sticker</dt>
            <dd>Twist that piece. Right-click turns the other way.</dd>
            <dt>Hold 1–9</dt>
            <dd>
              Choose which layers turn, counting inward from the cell you click. Holding several
              turns several at once; holding all of them rotates the whole puzzle.
            </dd>
            <dt>Drag</dt>
            <dd>Rotate in 3D — the familiar trackball.</dd>
            <dt>Shift + drag</dt>
            <dd>
              Rotate in 4D. This is the one with no 3D analogue: it turns cells through the fourth
              dimension and brings the hidden cell to the front.
            </dd>
            <dt>Right-drag</dt>
            <dd>Roll, and rotate in the ZW plane.</dd>
            <dt>Scroll</dt>
            <dd>Zoom.</dd>
          </dl>
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
          <button
            onClick={() => {
              setControls(DEFAULT_CONTROLS);
              puzzle.resetView();
            }}
          >
            Reset view
          </button>
        </div>

        {puzzle.geometry && (
          <div className="group">
            <h2>This puzzle</h2>
            <p className="facts">
              <b>{puzzle.geometry.schlafli}</b> at length <b>{puzzle.geometry.edgeLength}</b>
              <br />
              <b>{puzzle.geometry.nFaces}</b> cells, <b>{puzzle.geometry.nCubies}</b> pieces,{' '}
              <b>{puzzle.geometry.nStickers}</b> stickers
              <br />
              <b>
                1.76 × 10<sup>120</sup>
              </b>{' '}
              reachable states
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
      </aside>
    </div>
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
