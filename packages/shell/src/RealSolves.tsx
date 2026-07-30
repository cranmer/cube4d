/**
 * The Hall of Fame, as a panel section.
 *
 * Shared rather than copied: two apps show it, and the interesting part — that each solve loads at
 * the position its solver faced rather than at the start — is the sort of detail that would drift
 * between copies.
 */

import { EXAMPLES } from './examples.js';
import { Section } from './Section.js';
import { PLAYBACK_SPEED_RANGE, type PuzzleActions, type PuzzleSession } from './usePuzzle.js';
import type { SolveIO } from './useSolveIO.js';

export function RealSolves({
  session,
  actions,
  io,
  base,
}: {
  session: PuzzleSession;
  actions: PuzzleActions;
  io: SolveIO;
  base: string;
}) {
  return (
        <Section
          id="examples"
          title="Real solves"
          badge={`${EXAMPLES.length}`}
        >
          <p className="hint">
            Actual solves from the{' '}
            <a
              href="https://superliminal.com/cube/halloffame.htm"
              target="_blank"
              rel="noopener noreferrer"
            >
              MagicCube4D Hall of Fame
            </a>
            . Each loads at the position the solver faced — press Play to watch it come apart, or
            download the log to keep or to open in the original.
          </p>
          {/* A transport for whatever solve is loaded. Step back and forward are undo and redo,
              named for what you are doing here: reading someone else's moves rather than making
              your own. */}
          <div className="transport">
            <button
              className="step"
              disabled={!session.canUndo}
              onClick={() => actions.undo()}
              aria-label="Step back one move"
              title="Step back one move"
            >
              <StepIcon direction="back" />
            </button>
            <button
              className="play"
              disabled={!session.canRedo && !session.playing}
              onClick={() => actions.setPlaying(!session.playing)}
            >
              {session.playing ? <StopIcon /> : <PlayIcon />}
              <span>{session.playing ? 'Stop' : 'Play'}</span>
            </button>
            <button
              className="step"
              disabled={!session.canRedo}
              onClick={() => actions.redo()}
              aria-label="Step forward one move"
              title="Step forward one move"
            >
              <StepIcon direction="forward" />
            </button>
          </div>

          {/* Logarithmic, so 1× sits in the middle and the two extremes are symmetric — a linear
              track would put the default a fifth of the way along. */}
          <Slider
            label="Playback speed"
            value={Math.log2(session.playbackSpeed)}
            min={Math.log2(PLAYBACK_SPEED_RANGE.min)}
            max={Math.log2(PLAYBACK_SPEED_RANGE.max)}
            step={0.25}
            format={(v) => `${formatSpeed(2 ** v)}×`}
            onChange={(v) => actions.setPlaybackSpeed(2 ** v)}
          />

          <div className="examples">
            {EXAMPLES.map((example) => (
              <div key={example.file} className="example">
                <button className="example-load" onClick={() => void io.loadExample(example)}>
                  <span className="who">{example.solver}</span>
                  <span className="what">
                    {example.puzzle} · {example.twists.toLocaleString()} twists
                    {example.note ? ` · ${example.note}` : ''}
                  </span>
                </button>
                {/* The file itself, so it can be kept or opened in the original MagicCube4D.
                    An anchor rather than a nested button, which would be invalid inside one. */}
                <a
                  className="example-download"
                  href={`${base}examples/${example.file}`}
                  download={example.file}
                  title={`Download ${example.file}`}
                  aria-label={`Download ${example.solver}'s log file`}
                >
                  <svg
                    viewBox="0 0 16 16"
                    width="14"
                    height="14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M8 2v8" />
                    <polyline points="4.5 7 8 10.5 11.5 7" />
                    <path d="M2.5 13h11" />
                  </svg>
                </a>
              </div>
            ))}
          </div>
        </Section>
  );
}

/** Logarithmic, so 1× sits in the middle and the two extremes are symmetric. */
function formatSpeed(speed: number): string {
  return speed >= 1 ? String(Math.round(speed * 10) / 10) : String(Math.round(speed * 100) / 100);
}

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="slider">
      <span className="row">
        <span>{props.label}</span>
        <span>{props.format ? props.format(props.value) : props.value.toFixed(2)}</span>
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

function StepIcon({ direction }: { direction: 'back' | 'forward' }) {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true"
      style={{ transform: direction === 'back' ? 'scaleX(-1)' : undefined }}>
      <path d="M4 3.2 11 8l-7 4.8Z" />
      <rect x="11.3" y="3.2" width="1.5" height="9.6" rx="0.4" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true">
      <path d="M4 2.8 13 8l-9 5.2Z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true">
      <rect x="3.4" y="3.4" width="9.2" height="9.2" rx="1.2" />
    </svg>
  );
}
