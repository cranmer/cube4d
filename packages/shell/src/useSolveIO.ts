/**
 * Loading and saving solves: files, the Hall of Fame, and the deferred restore both need.
 *
 * Extracted from the classic app when a second app wanted the same two panel sections. The logic is
 * not large but it is fiddly in one specific way, and duplicating that fiddliness is how two copies
 * come to disagree: **a solve usually names a puzzle that is not the one on screen**, so restoring it
 * means asking for that puzzle and waiting. The wait is what `pending` is for — the restore is held
 * until the geometry that arrives is the geometry the solve was recorded against, checked by id
 * rather than assumed from the order things happened in.
 */

import { useCallback, useEffect, useState } from 'react';
import { findEntry, type Catalog, type PuzzleGeometry } from '@mc4d/puzzle-core';
import type { SaveDoc } from '@mc4d/legacy-format';

import type { Example } from './examples.js';
import { fromSaveDoc, parseDropped, toSaveDoc, type SessionSnapshot } from './persist.js';
import type { PuzzleActions } from './usePuzzle.js';

export interface SolveIODeps {
  actions: PuzzleActions;
  catalog: Catalog | null;
  puzzleId: string;
  geometry: PuzzleGeometry | null;
  selectPuzzle(id: string, path: string): void;
  getRotation(): number[];
  setRotation(mat4d: readonly number[]): void;
  /** How the app tells the player something went wrong, or went right. */
  say(message: string): void;
  /** Base URL for `examples/`, normally `import.meta.env.BASE_URL`. */
  base: string;
}

export interface SolveIO {
  /** The current position as a save document, for writing to a file or a link. */
  buildDoc(): SaveDoc;
  /** Load a Hall of Fame solve, parked at the scramble so the interesting part is what follows. */
  loadExample(example: Example): Promise<void>;
  /** Load a dropped or chosen `.json` / `.log` file. */
  openFile(file: File): Promise<void>;
  /** Hand a snapshot over to be restored once its puzzle has loaded. */
  restoreLater(snapshot: SessionSnapshot): void;
}

export function useSolveIO(deps: SolveIODeps): SolveIO {
  const { actions, catalog, puzzleId, geometry, selectPuzzle, getRotation, setRotation, say, base } =
    deps;
  const [pending, setPending] = useState<SessionSnapshot | null>(null);

  // State rather than a ref: a restore has to wait for the right geometry, and setting a ref would
  // not schedule the effect that consumes it — so a solve for the puzzle already on screen would sit
  // there forever, since nothing else causes a render.
  useEffect(() => {
    if (!pending || !geometry) return;
    if (geometry.id !== pending.puzzleId) return;
    if (puzzleId !== pending.puzzleId) return;
    setPending(null);
    actions.restore(pending);
    // The original stores the camera alongside the moves, so a loaded solve looks as it was left.
    if (pending.viewMatrix.length === 16) setRotation(pending.viewMatrix);
    say(`Loaded ${pending.history.moves.length} moves.`);
  }, [pending, geometry, puzzleId, actions, setRotation, say]);

  const buildDoc = useCallback(() => {
    const entry = catalog ? findEntry(catalog, puzzleId) : undefined;
    const state = actions.snapshot();
    return toSaveDoc(
      {
        puzzleId,
        schlafli: entry?.schlafli ?? geometry?.schlafli ?? '',
        length: entry?.length ?? geometry?.edgeLength ?? 0,
        history: state.history,
        scrambleState: state.scrambleState,
        ...(state.scramble ? { scramble: state.scramble } : {}),
        viewMatrix: getRotation(),
        ...(catalog ? { assetsVersion: catalog.assetsVersion } : {}),
      },
      geometry,
    );
  }, [actions, catalog, geometry, puzzleId, getRotation]);

  /** Apply a snapshot now if its puzzle is on screen, or ask for that puzzle and apply it after. */
  const apply = useCallback(
    (snapshot: SessionSnapshot, name: string, onImmediate?: () => void): boolean => {
      const entry = catalog ? findEntry(catalog, snapshot.puzzleId) : undefined;
      if (!entry) {
        say(`${name} is for ${snapshot.puzzleId}, which this app does not offer.`);
        return false;
      }
      if (entry.id === puzzleId) {
        actions.restore(snapshot);
        onImmediate?.();
      } else {
        setPending(snapshot);
        selectPuzzle(entry.id, entry.path);
      }
      return true;
    },
    [actions, catalog, puzzleId, say, selectPuzzle],
  );

  const loadExample = useCallback(
    async (example: Example) => {
      try {
        const response = await fetch(`${base}examples/${example.file}`);
        if (!response.ok) throw new Error(`could not load ${example.file}`);
        const { doc } = parseDropped(example.file, await response.text());
        const snapshot = fromSaveDoc(doc);
        // The move list runs scramble → boundary → solution, so seeking to the boundary shows the
        // position the solver actually faced. Play then works through their solution.
        const boundary = snapshot.history.marks.find((m) => m.kind === 'scramble');
        const staged = { ...snapshot, history: { ...snapshot.history, index: boundary?.at ?? 0 } };
        apply(staged, example.file, () =>
          say(`${example.solver}, ${example.twists.toLocaleString()} twists. Press Play.`),
        );
      } catch (e) {
        say(e instanceof Error ? e.message : String(e));
      }
    },
    [apply, base, say],
  );

  const openFile = useCallback(
    async (file: File) => {
      try {
        const { doc, warnings } = parseDropped(file.name, await file.text());
        const snapshot = fromSaveDoc(doc);
        for (const warning of warnings) say(warning);
        apply(snapshot, file.name, () => {
          if (snapshot.viewMatrix.length === 16) setRotation(snapshot.viewMatrix);
          say(`Loaded ${snapshot.history.moves.length} moves from ${file.name}.`);
        });
      } catch (e) {
        say(e instanceof Error ? e.message : String(e));
      }
    },
    [apply, say, setRotation],
  );

  return { buildDoc, loadExample, openFile, restoreLater: setPending };
}
