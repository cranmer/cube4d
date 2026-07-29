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
 * Whether an entry is a puzzle at all.
 *
 * Every family has an edge length of 1, which means no cuts: one cubie, one sticker per face, and
 * nothing that can be twisted except the whole thing at once. They are legitimate members of the
 * catalog and the exporter builds them, but offering them to someone looking for a puzzle to solve
 * is offering them a solved puzzle. Twenty-one of the 128 entries are like this.
 *
 * Tested by cubie count rather than by length, because that is the property that actually matters
 * and it does not assume the convention holds for some future family.
 */
export function isPlayable(entry: CatalogEntry): boolean {
  return entry.nCubies > 1;
}

/**
 * The order families are offered in, most-wanted first.
 *
 * The catalog's own order comes from the original's menu, which is roughly by discovery. Nearly
 * everyone arriving here wants the 3×3×3×3, and most of the rest want one of the other regular
 * 4-polytopes, so those come first and the duoprisms — of which there are many, all similar —
 * follow. Everything not named keeps its catalog position.
 */
const FAMILY_ORDER = ['{4,3,3}', '{5,3,3}', '{3,3,3}', '{5,3}x{}'];

/**
 * Group the catalog by Schläfli symbol.
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
  const rank = (schlafli: string) => {
    const at = FAMILY_ORDER.indexOf(schlafli);
    return at < 0 ? FAMILY_ORDER.length : at;
  };
  return [...families.entries()]
    .map(([schlafli, entries]) => ({
      schlafli,
      name: entries.find((e) => e.name)?.name ?? '',
      entries: [...entries].sort((a, b) => a.length - b.length),
    }))
    // Stable, so anything unranked keeps the catalog's own order.
    .sort((a, b) => rank(a.schlafli) - rank(b.schlafli));
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
