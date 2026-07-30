/**
 * Saving and loading a solve, as a panel section.
 *
 * The formats are the point: JSON is this project's own and carries things the original never
 * recorded, while `.log` is byte-compatible with MagicCube4D so a solve made here opens there. Both
 * live in `@mc4d/legacy-format`; this is only the buttons.
 */

import { Section } from './Section.js';
import { download, encodePermalink, saveDocToLogText, suggestFilename } from './persist.js';
import type { PuzzleActions, PuzzleSession } from './usePuzzle.js';
import type { SolveIO } from './useSolveIO.js';
import type { PuzzleGeometry } from '@mc4d/puzzle-core';

export function ImportExport({
  session,
  actions,
  io,
  puzzleId,
  geometry,
  say,
}: {
  session: PuzzleSession;
  actions: PuzzleActions;
  io: SolveIO;
  puzzleId: string;
  geometry: PuzzleGeometry | null;
  say: (message: string) => void;
}) {
  return (
        <Section id="solve" title="Import / Export">
          <div className="buttons">
            <button
              onClick={() => download(suggestFilename(puzzleId, 'json'), JSON.stringify(io.buildDoc(), null, 2), 'application/json')}
              title="Save as JSON — this project's own format"
            >
              Save
            </button>
            <button
              onClick={() => download(suggestFilename(puzzleId, 'log'), saveDocToLogText(io.buildDoc()), 'text/plain')}
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
                  if (file) void io.openFile(file);
                  e.target.value = '';
                }}
              />
            </label>
            <button
              onClick={async () => {
                const state = actions.snapshot();
                const url = `${globalThis.location.origin}${globalThis.location.pathname}#${encodePermalink(
                  puzzleId,
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
        </Section>
  );
}
