/**
 * Codec for MagicCube4D `.log` files.
 *
 * Format (version 3):
 *
 *     MagicCube4D 3 3 191 {4,3,3} 3      magic, version, scrambleState, twistCount, schlafli, length
 *     0.018196997180 -0.883088133564 ... 4 rows of the 4D view matrix
 *     ...
 *     *                                  sentinel
 *     194,-1,1 181,-1,4 m| 151,1,4 ... . moves and marks, newline every 10, terminated by '.'
 *
 * Parsing is faithful to the bytes. Where the original's reader would silently transform what it
 * read — it cancels adjacent inverse moves on load — this returns the file's actual contents and
 * reports a warning instead. See docs/quirks-and-bugs.md.
 *
 * Line endings are preserved rather than normalised: the original writes
 * `System.getProperty("line.separator")`, so real files are a mix of CRLF and LF depending on
 * whichever machine produced them, and a byte-exact round-trip has to keep whichever it found.
 */

import type { Mark, MarkKind, Move } from '@mc4d/puzzle-core';
import { javaDoubleToString, parseJavaDouble } from './javaDouble.js';

export const MAGIC = 'MagicCube4D';
export const LOG_FILE_VERSION = 3;

/** Matches the original's enum: how thoroughly the puzzle was scrambled before solving began. */
export type ScrambleState = 'none' | 'partial' | 'full' | 'solved';

const SCRAMBLE_STATES: ScrambleState[] = ['none', 'partial', 'full', 'solved'];

/** Mark characters as written in the token stream. */
const MARK_CHARS: Record<MarkKind, string> = {
  scramble: '|',
  macroOpen: '[',
  macroClose: ']',
  setup: 'S',
};
const MARK_KINDS = new Map<string, MarkKind>(
  Object.entries(MARK_CHARS).map(([kind, char]) => [char, kind as MarkKind]),
);

export interface LogFile {
  readonly version: number;
  readonly scrambleState: ScrambleState;
  /** As written in the header. The original computes this but never reads it back. */
  readonly twistCount: number;
  readonly schlafli: string;
  readonly edgeLength: number;
  /** Row-major 4x4 view matrix. */
  readonly viewMatrix: number[];
  readonly moves: Move[];
  readonly marks: Mark[];
  /** Applied-move count. Equals `moves.length` unless the file carried a `c ` marker. */
  readonly index: number;
  /** The line separator the file used, so a re-emit can reproduce it. */
  readonly lineEnding: '\n' | '\r\n';
}

export interface Warning {
  readonly kind: 'adjacentInverse' | 'unknownMark' | 'trailingContent' | 'nonCanonical';
  readonly message: string;
}

export interface ParseResult {
  readonly log: LogFile;
  readonly warnings: Warning[];
}

/** Thrown for files this codec cannot represent at all, as opposed to files with oddities. */
export class LogFormatError extends Error {
  constructor(
    message: string,
    readonly detail?: { version?: number; firstLine?: string },
  ) {
    super(message);
    this.name = 'LogFormatError';
  }
}

// ---------------------------------------------------------------- parsing

export function parseLog(text: string): ParseResult {
  const warnings: Warning[] = [];
  const lineEnding = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);

  const header = (lines[0] ?? '').trim().split(/\s+/);
  if (header[0] !== MAGIC) {
    throw new LogFormatError(
      `not a MagicCube4D log file (first line reads "${(lines[0] ?? '').slice(0, 40)}")`,
      { firstLine: lines[0] },
    );
  }

  const version = Number(header[1]);
  if (version !== LOG_FILE_VERSION) {
    // Version 1 is a genuinely different format — it stores the position as a grid of colour
    // digits, never says which puzzle it is, and encodes moves differently. About a third of the
    // logs published on the Hall of Fame are version 1, and the current Java cannot open them
    // either. See fixtures/logs/README.md.
    throw new LogFormatError(
      `unsupported log file version ${header[1]}; this codec reads version ${LOG_FILE_VERSION}`,
      { version },
    );
  }
  if (header.length !== 6) {
    throw new LogFormatError(
      `malformed header: expected 6 fields, found ${header.length}`,
      { firstLine: lines[0] },
    );
  }

  const scrambleIndex = Number(header[2]);
  const scrambleState = SCRAMBLE_STATES[scrambleIndex] ?? 'none';
  const twistCount = Number(header[3]);
  const schlafli = header[4];
  const edgeLength = parseJavaDouble(header[5], 'header edge length');

  const viewMatrix: number[] = [];
  for (let row = 0; row < 4; ++row) {
    const parts = (lines[1 + row] ?? '').trim().split(/\s+/);
    if (parts.length !== 4) {
      throw new LogFormatError(`view matrix row ${row} has ${parts.length} values, expected 4`);
    }
    for (const part of parts) viewMatrix.push(parseJavaDouble(part, `view matrix row ${row}`));
  }

  const sentinel = lines.findIndex((line, i) => i >= 5 && line.trim() === '*');
  if (sentinel < 0) throw new LogFormatError('missing the "*" sentinel after the view matrix');

  const body = lines.slice(sentinel + 1).join('\n');
  const { moves, marks, index, warnings: bodyWarnings } = parseBody(body);
  warnings.push(...bodyWarnings);

  const log: LogFile = {
    version,
    scrambleState,
    twistCount,
    schlafli,
    edgeLength,
    viewMatrix,
    moves,
    marks,
    index,
    lineEnding,
  };

  // Not every file in the wild was written by MagicCube4D. Computer-assisted solves in particular
  // were emitted by solver scripts using a looser variant: integer view matrices ("1 0 0 0" rather
  // than "1.0 0.0 0.0 0.0"), or the whole move list on one line instead of wrapping every ten
  // tokens. Such files parse fine and mean exactly what they say, but re-emitting them produces
  // canonical formatting rather than the original bytes. Say so rather than pretend otherwise.
  if (formatLog(log) !== text) {
    warnings.push({
      kind: 'nonCanonical',
      message:
        'this file was not written by MagicCube4D itself — its formatting differs from what the ' +
        'app emits, so saving it will normalise the layout (the moves are unaffected)',
    });
  }

  return { log, warnings };
}

/** True if re-emitting the file would reproduce it byte-for-byte. */
export function isCanonical(text: string): boolean {
  const { warnings } = parseLog(text);
  return !warnings.some((w) => w.kind === 'nonCanonical');
}

/**
 * Parse the token stream: `grip,direction,slicemask` for moves, `m<char>` for marks, an optional
 * `c ` prefix marking the applied/redo boundary, and `.` to end.
 */
function parseBody(body: string): {
  moves: Move[];
  marks: Mark[];
  index: number;
  warnings: Warning[];
} {
  const warnings: Warning[] = [];
  const moves: Move[] = [];
  const marks: Mark[] = [];
  let index = -1;

  const tokens = body.split(/\s+/).filter((t) => t.length > 0);
  for (const raw of tokens) {
    if (raw === 'c') {
      // The current-position marker: everything after it is redo.
      index = moves.length;
      continue;
    }

    const terminated = raw.endsWith('.');
    const token = terminated ? raw.slice(0, -1) : raw;

    if (token.length > 0) {
      if (token.startsWith('m')) {
        const char = token.slice(1);
        const kind = MARK_KINDS.get(char);
        if (kind) {
          marks.push({ at: moves.length, kind });
        } else {
          warnings.push({
            kind: 'unknownMark',
            message: `unrecognised mark "m${char}"; ignoring it`,
          });
        }
      } else {
        const parts = token.split(',');
        if (parts.length !== 3) {
          warnings.push({
            kind: 'trailingContent',
            message: `skipping unparseable token "${token}"`,
          });
          continue;
        }
        const move: Move = {
          g: Number(parts[0]),
          d: Number(parts[1]) < 0 ? -1 : 1,
          s: Number(parts[2]) === 0 ? 1 : Number(parts[2]),
        };
        // The original's reader collapses a move against an immediately preceding inverse, so its
        // in-memory list can differ from the file. We keep the file's contents and say so.
        const previous = moves[moves.length - 1];
        if (previous && previous.g === move.g && previous.s === move.s && previous.d === -move.d) {
          warnings.push({
            kind: 'adjacentInverse',
            message:
              `moves ${moves.length - 1} and ${moves.length} are inverses; MagicCube4D would ` +
              `cancel both on load, so it will show a different move list than this file contains`,
          });
        }
        moves.push(move);
      }
    }

    if (terminated) break;
  }

  return { moves, marks, index: index < 0 ? moves.length : index, warnings };
}

// ---------------------------------------------------------------- writing

export interface FormatOptions {
  /** Defaults to the file's own ending when re-emitting a parsed log. */
  readonly lineEnding?: '\n' | '\r\n';
  /**
   * The header's twist count. The original computes this from the history, excluding whole-puzzle
   * rotations and counting only after the scramble boundary; pass that value in rather than have
   * the codec guess without knowing the puzzle's slice counts.
   */
  readonly twistCount?: number;
}

export function formatLog(log: LogFile, options: FormatOptions = {}): string {
  const sep = options.lineEnding ?? log.lineEnding ?? '\n';
  const twistCount = options.twistCount ?? log.twistCount;

  const out: string[] = [];
  out.push(
    [
      MAGIC,
      LOG_FILE_VERSION,
      SCRAMBLE_STATES.indexOf(log.scrambleState),
      twistCount,
      log.schlafli,
      prettyLength(log.edgeLength),
    ].join(' '),
  );
  out.push(sep);

  for (let row = 0; row < 4; ++row) {
    for (let col = 0; col < 4; ++col) {
      out.push(javaDoubleToString(log.viewMatrix[row * 4 + col]));
      out.push(col === 3 ? sep : ' ');
    }
  }

  out.push('*', sep);
  out.push(formatBody(log, sep));
  out.push(sep);
  return out.join('');
}

/**
 * Interleave moves and marks back into the token stream, breaking the line after every tenth
 * token, and terminate with `.`.
 */
function formatBody(log: LogFile, sep: string): string {
  const nodes: string[] = [];
  const marksAt = new Map<number, MarkKind[]>();
  for (const mark of log.marks) {
    if (!marksAt.has(mark.at)) marksAt.set(mark.at, []);
    marksAt.get(mark.at)!.push(mark.kind);
  }

  const emitMarks = (at: number) => {
    for (const kind of marksAt.get(at) ?? []) nodes.push(`m${MARK_CHARS[kind]}`);
  };

  for (let i = 0; i < log.moves.length; ++i) {
    emitMarks(i);
    const move = log.moves[i];
    nodes.push(`${move.g},${move.d},${move.s}`);
  }
  emitMarks(log.moves.length);

  // The applied/redo boundary is written as a `c ` prefix on the node it precedes. The original
  // never emits this, because saving truncates the redo tail first — we keep the tail instead.
  const currentNode = log.index < log.moves.length ? nodeIndexForMove(log, log.index) : -1;

  let text = '';
  for (let i = 0; i < nodes.length; ++i) {
    if (i === currentNode) text += 'c ';
    text += nodes[i];
    if (i + 1 < nodes.length) text += (i + 1) % 10 === 0 ? sep : ' ';
  }
  return text + '.';
}

/** Where move `moveIndex` sits in the interleaved node stream, counting marks. */
function nodeIndexForMove(log: LogFile, moveIndex: number): number {
  let marksBefore = 0;
  for (const mark of log.marks) if (mark.at <= moveIndex) marksBefore++;
  return moveIndex + marksBefore;
}

/** The original's "pretty length": integral lengths lose their decimal point. */
export function prettyLength(length: number): string {
  return Number.isInteger(length) ? String(Math.trunc(length)) : javaDoubleToString(length);
}
