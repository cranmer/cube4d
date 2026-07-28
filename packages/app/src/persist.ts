/**
 * Saving, loading, sharing.
 *
 * Three routes out of the app and three back in:
 *
 *   - a JSON save file, the native format, which carries everything
 *   - a legacy `.log`, so solves move between this and MagicCube4D
 *   - a URL, for handing someone a position without a file
 *
 * All three go through the same save document, so they cannot drift apart.
 */

import {
  countTwists,
  createHistory,
  numSlicesForGrip,
  type History,
  type Move,
  type PuzzleGeometry,
} from '@mc4d/puzzle-core';
import {
  formatLog,
  logToSave,
  parseLog,
  saveToLog,
  SAVE_FORMAT_VERSION,
  type SaveDoc,
} from '@mc4d/legacy-format';

export interface SessionSnapshot {
  readonly puzzleId: string;
  readonly schlafli: string;
  readonly length: number;
  readonly history: History;
  readonly scrambleState: SaveDoc['scrambleState'];
  readonly scramble?: SaveDoc['scramble'];
  readonly viewMatrix: readonly number[];
  readonly assetsVersion?: string;
}

export function toSaveDoc(snapshot: SessionSnapshot, geo: PuzzleGeometry | null): SaveDoc {
  return {
    format: 'mc4d-save',
    version: SAVE_FORMAT_VERSION,
    puzzle: {
      schlafli: snapshot.schlafli,
      length: snapshot.length,
      id: snapshot.puzzleId,
    },
    ...(snapshot.assetsVersion ? { assetsVersion: snapshot.assetsVersion } : {}),
    scrambleState: snapshot.scrambleState,
    ...(snapshot.scramble ? { scramble: snapshot.scramble } : {}),
    moves: snapshot.history.moves.map((m) => [m.g, m.d, m.s] as [number, 1 | -1, number]),
    marks: [...snapshot.history.marks],
    index: snapshot.history.index,
    view: { mat4d: [...snapshot.viewMatrix] },
    meta: {
      app: 'cube4d',
      createdAt: new Date().toISOString(),
      ...(geo
        ? {
            twistCount: countTwists(snapshot.history, (g) => numSlicesForGrip(geo, g)),
          }
        : {}),
    },
  };
}

export function fromSaveDoc(doc: SaveDoc): SessionSnapshot {
  return {
    puzzleId: doc.puzzle.id,
    schlafli: doc.puzzle.schlafli,
    length: doc.puzzle.length,
    history: createHistory(
      doc.moves.map((t): Move => ({ g: t[0], d: t[1], s: t[2] })),
      [...doc.marks],
      doc.index,
    ),
    scrambleState: doc.scrambleState,
    ...(doc.scramble ? { scramble: doc.scramble } : {}),
    viewMatrix: doc.view?.mat4d ?? [],
  };
}

/**
 * Read whatever was dropped on the window.
 *
 * The extension is a hint, not a promise — people rename files — so both formats are attempted and
 * the content decides.
 */
export function parseDropped(name: string, text: string): { doc: SaveDoc; warnings: string[] } {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{')) {
    const doc = JSON.parse(text) as SaveDoc;
    if (doc.format !== 'mc4d-save') throw new Error(`${name} is JSON, but not a cube4d save file`);
    return { doc, warnings: [] };
  }
  const { log, warnings } = parseLog(text);
  return { doc: logToSave(log), warnings: warnings.map((w) => w.message) };
}

export function saveDocToLogText(doc: SaveDoc): string {
  return formatLog(saveToLog(doc));
}

/** Trigger a download without a server. */
export function download(filename: string, contents: string, type: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // Revoking immediately can cancel the download in some browsers; a tick is enough.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Filenames a solve archive can live with: `mc4d-4-3-3_3-2026-07-28.log`. */
export function suggestFilename(puzzleId: string, extension: string): string {
  const safe = puzzleId.replace(/[{}]/g, '').replace(/[,\s]+/g, '-').replace(/\//g, 'over');
  return `mc4d-${safe}-${new Date().toISOString().slice(0, 10)}.${extension}`;
}

// ---------------------------------------------------------------- permalinks

/**
 * Encode a position into a URL fragment.
 *
 * Moves are the compact part — three small integers each — so they are packed into a base64url
 * string rather than JSON. A hundred-move solve comes to a few hundred characters, which fits
 * comfortably in a link. The view matrix is deliberately not included: where the puzzle *is*
 * matters, how you happened to be looking at it does not.
 */
export function encodePermalink(puzzleId: string, moves: readonly Move[]): string {
  const bytes = new Uint8Array(moves.length * 4);
  const view = new DataView(bytes.buffer);
  moves.forEach((move, i) => {
    view.setUint16(i * 4, move.g, true);
    view.setUint8(i * 4 + 2, move.d < 0 ? 1 : 0);
    view.setUint8(i * 4 + 3, Math.min(255, move.s));
  });
  const params = new URLSearchParams({ p: puzzleId });
  if (moves.length > 0) params.set('m', base64UrlEncode(bytes));
  return params.toString();
}

export function decodePermalink(fragment: string): { puzzleId: string; moves: Move[] } | null {
  const params = new URLSearchParams(fragment.replace(/^#/, ''));
  const puzzleId = params.get('p');
  if (!puzzleId) return null;

  const packed = params.get('m');
  const moves: Move[] = [];
  if (packed) {
    const bytes = base64UrlDecode(packed);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i + 4 <= bytes.length; i += 4) {
      moves.push({
        g: view.getUint16(i, true),
        d: view.getUint8(i + 2) ? -1 : 1,
        s: view.getUint8(i + 3),
      });
    }
  }
  return { puzzleId, moves };
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; ++i) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
