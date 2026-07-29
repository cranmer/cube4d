import { useMemo, useState } from 'react';
import {
  describeShape,
  formatBytes,
  groupByFamily,
  isPlayable,
  type Catalog,
  type CatalogEntry,
} from '@mc4d/puzzle-core';

/**
 * Choosing a puzzle.
 *
 * The original presents this as a menu of Schläfli symbols with a submenu of lengths, which assumes
 * you already know what `{5}x{4}` is. Here the family is described in words and the lengths are
 * buttons, so the two questions — *which shape* and *how finely sliced* — are asked separately.
 *
 * Download size is shown per length, because it ranges from 5 KB to 805 KB and someone on a phone
 * deserves to know before tapping.
 */
export function PuzzlePicker({
  catalog,
  currentId,
  onSelect,
  loadingId,
}: {
  catalog: Catalog;
  currentId: string;
  onSelect: (entry: CatalogEntry) => void;
  loadingId: string | null;
}) {
  // An edge length of 1 has one cubie and no twists, so it is not offered — see isPlayable. A
  // permalink to one still opens; it just is not something to pick on purpose.
  const families = useMemo(
    () =>
      groupByFamily(catalog)
        .map((f) => ({ ...f, entries: f.entries.filter(isPlayable) }))
        .filter((f) => f.entries.length > 0),
    [catalog],
  );
  const currentFamily = useMemo(
    () => catalog.puzzles.find((p) => p.id === currentId)?.schlafli ?? families[0]?.schlafli,
    [catalog, currentId, families],
  );
  const [open, setOpen] = useState<string | null>(currentFamily ?? null);

  return (
    <div className="picker">
      {families.map((family) => {
        const expanded = open === family.schlafli;
        const holdsCurrent = family.entries.some((e) => e.id === currentId);
        return (
          <div key={family.schlafli} className={holdsCurrent ? 'family current' : 'family'}>
            <button
              className="family-head"
              onClick={() => setOpen(expanded ? null : family.schlafli)}
              aria-expanded={expanded}
            >
              <span className="family-name">
                {family.name || family.schlafli}
                {/* The Schläfli symbol is the puzzle's real identity — it is what a .log file
                    records — so it stays visible even when a friendlier name exists. */}
                {family.name && <code>{family.schlafli}</code>}
              </span>
              <span className="family-shape">{describeShape(family.schlafli)}</span>
            </button>
            {expanded && (
              <div className="lengths">
                {family.entries.map((entry) => (
                  <button
                    key={entry.id}
                    className={entry.id === currentId ? 'length on' : 'length'}
                    onClick={() => onSelect(entry)}
                    disabled={loadingId !== null}
                    title={`${entry.nCubies} pieces, ${entry.nStickers} stickers · ${formatBytes(
                      entry.gzipBytes,
                    )}`}
                  >
                    <span className="n">{entry.length}</span>
                    <span className="size">
                      {loadingId === entry.id ? '…' : formatBytes(entry.gzipBytes)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
