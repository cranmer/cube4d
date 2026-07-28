/**
 * The puzzle catalog.
 *
 * Every entry the original ships — 21 families at various edge lengths, 128 in all — described by
 * the manifest the exporter writes. Nothing here builds geometry; it is the index you browse before
 * deciding what to download.
 */

export interface CatalogEntry {
  /** `"{4,3,3} 3"` — the same identifier `.log` files use to name a puzzle. */
  readonly id: string;
  readonly schlafli: string;
  /** The original's display name. Blank for several entries, which have only a Schläfli symbol. */
  readonly name: string;
  readonly length: number;
  /** File name of the asset, relative to the assets directory. */
  readonly path: string;
  readonly bytes: number;
  readonly gzipBytes: number;
  readonly sha256: string;
  readonly nFaces: number;
  readonly nCubies: number;
  readonly nStickers: number;
  readonly nGrips: number;
  readonly nVerts: number;
}

export interface Catalog {
  /** Which generation of exported geometry this is. Saves record it; see docs/asset-format.md. */
  readonly assetsVersion: string;
  readonly puzzles: readonly CatalogEntry[];
}

export interface CatalogFamily {
  readonly schlafli: string;
  readonly name: string;
  /** Entries in ascending edge length. */
  readonly entries: readonly CatalogEntry[];
}

/**
 * Group the catalog by Schläfli symbol, preserving the original's ordering.
 *
 * The original's menu is one submenu per symbol with an item per legal length, and that grouping is
 * worth keeping: the lengths of one family are the same puzzle at different sizes, which is a very
 * different relationship from one family to the next.
 */
export function groupByFamily(catalog: Catalog): CatalogFamily[] {
  const families = new Map<string, CatalogEntry[]>();
  for (const entry of catalog.puzzles) {
    const existing = families.get(entry.schlafli);
    if (existing) existing.push(entry);
    else families.set(entry.schlafli, [entry]);
  }
  return [...families.entries()].map(([schlafli, entries]) => ({
    schlafli,
    name: entries.find((e) => e.name)?.name ?? '',
    entries: [...entries].sort((a, b) => a.length - b.length),
  }));
}

export function findEntry(catalog: Catalog, id: string): CatalogEntry | undefined {
  return catalog.puzzles.find((p) => p.id === id);
}

/** The puzzle the app opens with: the 3×3×3×3 hypercube, as the original does. */
export const DEFAULT_PUZZLE_ID = '{4,3,3} 3';

/**
 * A short description of a puzzle's shape, for a picker that has to convey what `{5}x{4}` means.
 *
 * The original names only about half its entries, and even those names ("Hypermegaminx (BIG!)") are
 * more evocative than descriptive. This derives a description from the Schläfli symbol itself.
 */
export function describeShape(schlafli: string): string {
  // Phrased so as not to repeat the catalog's own name for the puzzle, which is shown alongside.
  const known: Record<string, string> = {
    '{3,3,3}': '5-cell — the four-dimensional tetrahedron',
    '{4,3,3}': 'The four-dimensional cube',
    '{5,3,3}': '120-cell — built from 120 dodecahedra',
    '{5,3}x{}': 'A dodecahedron extruded into 4D',
  };
  if (known[schlafli]) return known[schlafli];

  // Duoprisms: the product of two polygons, one of the shapes with no 3D analogue at all.
  const duoprism = /^\{(\d+)\}x\{(\d+)\}$/.exec(schlafli);
  if (duoprism) {
    const [, a, b] = duoprism;
    return a === b
      ? `Duoprism — two ${polygonName(Number(a))}s`
      : `Duoprism — ${polygonName(Number(a))} × ${polygonName(Number(b))}`;
  }
  return schlafli;
}

function polygonName(sides: number): string {
  const names: Record<number, string> = {
    3: 'triangle',
    4: 'square',
    5: 'pentagon',
    6: 'hexagon',
    7: 'heptagon',
    8: 'octagon',
    9: 'nonagon',
    10: 'decagon',
    100: '100-gon',
  };
  return names[sides] ?? `${sides}-gon`;
}

/** "8.2 KB", "2.8 MB" — for showing what a puzzle costs before you ask for it. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
