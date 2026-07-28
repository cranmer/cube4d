/**
 * The `.log` codec against the real corpus.
 *
 * These are actual solve logs downloaded from the MagicCube4D Hall of Fame — see
 * fixtures/logs/README.md. Real files contain variations no synthetic test would produce: mixed
 * line endings, Java's scientific notation, and formats the current Java itself cannot open.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { formatLog, isCanonical, LogFormatError, parseLog } from '../src/log.js';
import { logToSave, saveToLog } from '../src/save.js';
import { javaDoubleToString } from '../src/javaDouble.js';

const LOGS = fileURLToPath(new URL('../../../fixtures/logs/', import.meta.url));

const allLogs = readdirSync(LOGS).filter((f) => f.endsWith('.log'));
const read = (name: string) => readFileSync(LOGS + name, 'utf8');

/** Files the codec is expected to accept: log format version 3. */
const version3 = allLogs.filter((name) => {
  const first = read(name).split(/\r?\n/)[0].trim().split(/\s+/);
  return first[0] === 'MagicCube4D' && first[1] === '3';
});

describe('the corpus', () => {
  it('is present and contains version 3 files', () => {
    expect(allLogs.length).toBeGreaterThan(10);
    expect(version3.length).toBe(10);
  });
});

describe.each(version3)('%s', (name) => {
  const text = read(name);

  it('parses', () => {
    const { log } = parseLog(text);
    expect(log.version).toBe(3);
    expect(log.schlafli).toMatch(/^\{[\d,]+\}$/);
    expect(log.viewMatrix).toHaveLength(16);
    expect(log.moves.length).toBeGreaterThan(0);
  });

  it('round-trips semantically through the JSON save format', () => {
    // Holds for every file, canonical or not: the moves, marks, matrix and header survive a trip
    // out to JSON and back unchanged.
    const { log } = parseLog(text);
    const doc = JSON.parse(JSON.stringify(logToSave(log)));
    const { log: reparsed } = parseLog(formatLog(saveToLog(doc)));
    expect(reparsed.moves).toEqual(log.moves);
    expect(reparsed.marks).toEqual(log.marks);
    expect(reparsed.viewMatrix).toEqual(log.viewMatrix);
    expect(reparsed.schlafli).toBe(log.schlafli);
    expect(reparsed.edgeLength).toBe(log.edgeLength);
    expect(reparsed.scrambleState).toBe(log.scrambleState);
    expect(reparsed.index).toBe(log.index);
  });

  it('re-emits identically once canonical', () => {
    // Emitting is idempotent even where the input was not canonical.
    const { log } = parseLog(text);
    const emitted = formatLog(log);
    expect(formatLog(parseLog(emitted).log)).toBe(emitted);
  });

  it('preserves its line ending', () => {
    const { log } = parseLog(text);
    expect(log.lineEnding).toBe(text.includes('\r\n') ? '\r\n' : '\n');
  });

});

describe('files written by MagicCube4D itself', () => {
  // Everything except the two computer-assisted solves, which solver scripts emitted using a
  // looser variant of the format — see the "non-canonical" test below.
  const canonical = version3.filter((name) => isCanonical(read(name)));

  it('is most of the corpus', () => {
    expect(canonical.length).toBe(8);
  });

  it.each(canonical)('%s round-trips byte-for-byte', (name) => {
    // The strongest statement the codec can make: parse, re-emit, get the same bytes back. This
    // pins the header layout, Java's double formatting, the ten-tokens-per-line wrapping, and —
    // because the corpus is mixed — that line endings are preserved rather than normalised.
    const text = read(name);
    expect(formatLog(parseLog(text).log)).toBe(text);
  });

  it.each(canonical)('%s survives a trip through JSON and back to bytes', (name) => {
    const text = read(name);
    const doc = JSON.parse(JSON.stringify(logToSave(parseLog(text).log)));
    expect(formatLog(saveToLog(doc))).toBe(text);
  });
});

describe('files written by other tools', () => {
  // Both computer-assisted solves in the corpus were emitted by solver scripts rather than by
  // MagicCube4D. They are valid and unambiguous, just not byte-identical to what the app writes.
  const nonCanonical = version3.filter((name) => !isCanonical(read(name)));

  it('are flagged rather than silently normalised', () => {
    expect(nonCanonical.sort()).toEqual([
      'anderson-2x2x2x2-computer-24.log',
      'andrew-luna_3x3x3x3-comp-assist.log',
    ]);
    for (const name of nonCanonical) {
      const { warnings } = parseLog(read(name));
      expect(warnings.some((w) => w.kind === 'nonCanonical')).toBe(true);
    }
  });

  it('still parse to the right moves', () => {
    // andrew-luna's view matrix is written as integers ("1 0 0 0"), which is what makes it
    // non-canonical — the moves themselves are ordinary.
    const { log } = parseLog(read('andrew-luna_3x3x3x3-comp-assist.log'));
    expect(log.viewMatrix).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    expect(log.moves.length).toBeGreaterThan(100);
  });
});

describe('files the codec should reject clearly', () => {
  it('rejects version 1 with a version-specific message', () => {
    // Six of the Hall of Fame's files are version 1, which stores the position as a grid of colour
    // digits and never records which puzzle it is. The current Java cannot open them either.
    const error = catchError(() => parseLog(read('roice_4x4x4x4-2581.log')));
    expect(error).toBeInstanceOf(LogFormatError);
    expect((error as LogFormatError).detail?.version).toBe(1);
    expect(error?.message).toContain('version 1');
  });

  it('rejects a headerless move list', () => {
    const error = catchError(() => parseLog(read('don-4checkshort-20.log')));
    expect(error).toBeInstanceOf(LogFormatError);
    expect(error?.message).toContain('not a MagicCube4D log file');
  });

  it("rejects another program's format", () => {
    // A Magic Puzzle Ultimate file, linked from the Hall of Fame alongside the MC4D ones.
    const error = catchError(() => parseLog(read('nan_2x2x2x2_blind.log')));
    expect(error).toBeInstanceOf(LogFormatError);
  });
});

function catchError(fn: () => unknown): Error | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e as Error;
  }
}

describe('Java double formatting', () => {
  it('matches Java where it differs from JavaScript', () => {
    expect(javaDoubleToString(1)).toBe('1.0');
    expect(javaDoubleToString(-1)).toBe('-1.0');
    expect(javaDoubleToString(0)).toBe('0.0');
    expect(javaDoubleToString(-0)).toBe('-0.0');
    expect(javaDoubleToString(0.5)).toBe('0.5');
    expect(javaDoubleToString(100)).toBe('100.0');
    // Java switches to scientific outside [1e-3, 1e7); JavaScript outside [1e-6, 1e21).
    expect(javaDoubleToString(1e7)).toBe('1.0E7');
    expect(javaDoubleToString(1234567)).toBe('1234567.0');
    expect(javaDoubleToString(0.001)).toBe('0.001');
    expect(javaDoubleToString(0.0001)).toBe('1.0E-4');
    // Capital E, and no '+' on a positive exponent.
    expect(javaDoubleToString(1e21)).toBe('1.0E21');
    // Values taken verbatim from charles-3x3x3x3-191.log.
    expect(javaDoubleToString(-2.925836087297376e-9)).toBe('-2.925836087297376E-9');
    expect(javaDoubleToString(4.379940093404794e-16)).toBe('4.379940093404794E-16');
    expect(javaDoubleToString(0.01819699718070393)).toBe('0.01819699718070393');
  });

  it('refuses anything that is not a number', () => {
    // A missing value used to slip through: `Number.isNaN(undefined)` is false, so `undefined`
    // fell into the formatting path and emerged as "N.aNENaN" — which looks enough like a number
    // to be written to a file, and was only caught later by the parser refusing to read it.
    expect(() => javaDoubleToString(undefined as unknown as number)).toThrow(TypeError);
    expect(() => javaDoubleToString('1.0' as unknown as number)).toThrow(TypeError);
    expect(javaDoubleToString(NaN)).toBe('NaN');
  });

  it('reproduces every number in the corpus exactly', () => {
    // The real test: every value in every view matrix, re-rendered from the parsed double.
    for (const name of version3) {
      const text = read(name);
      const matrixLines = text.split(/\r?\n/).slice(1, 5);
      for (const line of matrixLines) {
        for (const token of line.trim().split(/\s+/)) {
          if (!token.includes('.') && !token.includes('E')) continue; // non-canonical integer form
          expect(javaDoubleToString(Number(token)), `${name}: ${token}`).toBe(token);
        }
      }
    }
  });
});
