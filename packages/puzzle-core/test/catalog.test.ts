/**
 * The catalog: the index of every puzzle, read from the manifest the exporter writes.
 *
 * These run against the real committed manifest rather than a fixture, so they also assert that the
 * exporter and the app agree about what is in the catalog.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PUZZLE_ID,
  describeShape,
  findEntry,
  formatBytes,
  groupByFamily,
  type Catalog,
} from '../src/catalog.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const catalog = JSON.parse(readFileSync(`${ROOT}fixtures/manifest.json`, 'utf8')) as Catalog;

describe('the manifest', () => {
  it('lists every puzzle the original ships', () => {
    // 21 families at their legal lengths. The original's catalog has 24 entries but three are
    // commented out or are the "invent your own" placeholder.
    expect(catalog.puzzles).toHaveLength(128);
    expect(catalog.assetsVersion).toMatch(/^\d{4}\.\d{2}\.\d+$/);
  });

  it('gives every puzzle a unique id and asset', () => {
    expect(new Set(catalog.puzzles.map((p) => p.id)).size).toBe(catalog.puzzles.length);
    expect(new Set(catalog.puzzles.map((p) => p.path)).size).toBe(catalog.puzzles.length);
  });

  it('records a checksum and counts for each', () => {
    for (const puzzle of catalog.puzzles) {
      expect(puzzle.sha256, puzzle.id).toMatch(/^[0-9a-f]{64}$/);
      expect(puzzle.nStickers).toBeGreaterThan(0);
      expect(puzzle.nGrips).toBeGreaterThan(0);
      expect(puzzle.gzipBytes).toBeGreaterThan(0);
      expect(puzzle.gzipBytes).toBeLessThan(puzzle.bytes);
    }
  });

  it('stays small enough to ship in full', () => {
    // The whole catalog is lazy-loaded, so what matters is the largest single download and the
    // total the deploy carries.
    const total = catalog.puzzles.reduce((n, p) => n + p.gzipBytes, 0);
    const largest = Math.max(...catalog.puzzles.map((p) => p.gzipBytes));
    expect(total).toBeLessThan(20 * 1024 * 1024);
    expect(largest).toBeLessThan(2 * 1024 * 1024);
  });

  it('contains the default puzzle', () => {
    const entry = findEntry(catalog, DEFAULT_PUZZLE_ID);
    expect(entry).toBeDefined();
    expect(entry!.nStickers).toBe(216);
    expect(entry!.nCubies).toBe(80);
  });
});

describe('grouping', () => {
  const families = groupByFamily(catalog);

  it('collects lengths under their family', () => {
    expect(families).toHaveLength(21);
    const hypercube = families.find((f) => f.schlafli === '{4,3,3}')!;
    expect(hypercube.name).toBe('Hypercube');
    expect(hypercube.entries.map((e) => e.length)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('accounts for every puzzle exactly once', () => {
    expect(families.reduce((n, f) => n + f.entries.length, 0)).toBe(catalog.puzzles.length);
  });

  it('sorts lengths ascending', () => {
    for (const family of families) {
      const lengths = family.entries.map((e) => e.length);
      expect(lengths).toEqual([...lengths].sort((a, b) => a - b));
    }
  });
});

describe('describing a shape', () => {
  it('explains the named puzzles without repeating their name', () => {
    // The name is shown beside the description, so "Hypercube — the hypercube" would be noise.
    expect(describeShape('{4,3,3}')).not.toMatch(/hypercube/i);
    expect(describeShape('{4,3,3}')).toContain('four-dimensional');
    expect(describeShape('{5,3,3}')).toContain('120');
  });

  it('reads a duoprism out of its symbol', () => {
    expect(describeShape('{3}x{4}')).toBe('Duoprism — triangle × square');
    expect(describeShape('{6}x{6}')).toBe('Duoprism — two hexagons');
    expect(describeShape('{100}x{4}')).toBe('Duoprism — 100-gon × square');
  });

  it('describes every family in the catalog', () => {
    // No family should fall through to showing its raw Schläfli symbol twice over.
    for (const family of groupByFamily(catalog)) {
      const described = describeShape(family.schlafli);
      expect(described.length, family.schlafli).toBeGreaterThan(0);
      if (!family.name) expect(described, family.schlafli).not.toBe(family.schlafli);
    }
  });
});

describe('formatBytes', () => {
  it('is readable at every scale the catalog reaches', () => {
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(8373)).toBe('8 KB');
    expect(formatBytes(824000)).toBe('805 KB');
    expect(formatBytes(2_900_000)).toBe('2.8 MB');
  });
});
