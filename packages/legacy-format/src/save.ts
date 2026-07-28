/**
 * The native save format, and its translation to and from the legacy `.log`.
 *
 * JSON rather than the legacy text format, because it can carry things the original never recorded:
 * a scramble seed, timing, which asset generation the grip indices refer to. The legacy format
 * remains fully supported through this translation, so nothing is stranded.
 *
 * Moves are tuple-encoded — `[12,1,1]` rather than `{"g":12,"d":1,"s":1}`. On a hundred-thousand
 * move log that is roughly a 4x size difference, which is the difference between a shareable URL
 * and not.
 */

import type { Mark, Move } from '@mc4d/puzzle-core';
import type { LogFile, ScrambleState } from './log.js';

export const SAVE_FORMAT_VERSION = 1;

/** `[gripIndex, direction, slicemask]`. */
export type MoveTuple = [number, 1 | -1, number];

export interface SaveDoc {
  readonly format: 'mc4d-save';
  readonly version: number;

  readonly puzzle: {
    readonly schlafli: string;
    readonly length: number;
    /** `"{4,3,3} 3"` — the same identifier the asset manifest uses. */
    readonly id: string;
  };

  /**
   * Which generation of exported assets the grip indices in `moves` refer to.
   *
   * Grip indices are positions in a generated array, so they are only meaningful against the
   * geometry that produced them. Recording this lets a future reader detect, rather than silently
   * misinterpret, a save written against different assets.
   */
  readonly assetsVersion?: string;

  readonly scrambleState: ScrambleState;
  /**
   * Present only for scrambles this app generated. The original uses an unseeded RNG, so scrambles
   * imported from a `.log` cannot carry one.
   */
  readonly scramble?: {
    readonly seed: number;
    readonly algo: 'mulberry32-v1';
    readonly twists: number;
  };

  readonly moves: MoveTuple[];
  readonly marks: Mark[];
  /** How many moves are applied; the rest are redo. */
  readonly index: number;

  readonly view?: {
    /** Row-major 4x4. */
    readonly mat4d: number[];
  };

  readonly meta?: {
    readonly app?: string;
    readonly createdAt?: string;
    readonly solver?: string;
    readonly durationMs?: number;
    readonly twistCount?: number;
    /** Set when imported, so a round-trip can reproduce the original file exactly. */
    readonly importedFrom?: {
      readonly format: 'mc4d-log';
      readonly version: number;
      readonly lineEnding: '\n' | '\r\n';
      readonly twistCount: number;
    };
  };
}

/**
 * Convert a parsed `.log` into a save document.
 *
 * Everything needed to reproduce the original file byte-for-byte is carried in
 * `meta.importedFrom` — the line ending and the header's twist count, neither of which is derivable
 * from the move list alone (the twist count depends on each grip's slice count, which needs the
 * puzzle geometry).
 */
export function logToSave(log: LogFile, extra: Partial<SaveDoc['meta']> = {}): SaveDoc {
  return {
    format: 'mc4d-save',
    version: SAVE_FORMAT_VERSION,
    puzzle: {
      schlafli: log.schlafli,
      length: log.edgeLength,
      id: `${log.schlafli} ${Number.isInteger(log.edgeLength) ? log.edgeLength : log.edgeLength}`,
    },
    scrambleState: log.scrambleState,
    moves: log.moves.map((m): MoveTuple => [m.g, m.d, m.s]),
    marks: [...log.marks],
    index: log.index,
    view: { mat4d: [...log.viewMatrix] },
    meta: {
      ...extra,
      importedFrom: {
        format: 'mc4d-log',
        version: log.version,
        lineEnding: log.lineEnding,
        twistCount: log.twistCount,
      },
    },
  };
}

/** Convert a save document back to the structure the `.log` writer expects. */
export function saveToLog(doc: SaveDoc): LogFile {
  const imported = doc.meta?.importedFrom;
  return {
    version: 3,
    scrambleState: doc.scrambleState,
    twistCount: imported?.twistCount ?? doc.meta?.twistCount ?? 0,
    schlafli: doc.puzzle.schlafli,
    edgeLength: doc.puzzle.length,
    viewMatrix: doc.view?.mat4d?.length === 16 ? doc.view.mat4d : identity4(),
    moves: doc.moves.map((t): Move => ({ g: t[0], d: t[1], s: t[2] })),
    marks: [...doc.marks],
    index: doc.index,
    lineEnding: imported?.lineEnding ?? '\n',
  };
}

function identity4(): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}
