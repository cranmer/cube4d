# Phase 0 results — catalog survey

Measured 2026-07-27 with Temurin JDK 21.0.11 on macOS/arm64, via
`tools/exporter/src/com/superliminal/export/Phase0Survey.java`.

Phase 0 existed to replace the architecture's *estimated* numbers with measurements before
committing to the precomputed-geometry design. **All 128 catalog entries built successfully, with
zero failures.** The design holds; three specifics were off and are corrected below.

Raw data: [`fixtures/counts.ref`](../fixtures/counts.ref) (the reference file `ModuleTest` was
written to produce but which was never committed to the original repo) and
[`fixtures/sizes.csv`](../fixtures/sizes.csv).

## Headline numbers

| | |
|---|---|
| Catalog entries built | **128 / 128**, no failures |
| Total asset size | **56.9 MB** raw, uncompressed |
| Largest single asset | **2.76 MB** — `{5,3,3} 2` and `{5,3,3} 3` |
| Default puzzle `{4,3,3} 3` | **78.8 KB** |
| Slowest build | **1.46 s** (`{5,3,3} 2`) |
| Total build time, whole catalog | **17.9 s** |

Every entry is small enough to ship. There is no need to trim the catalog — the "drop anything over
~15 MB" contingency in the plan is not triggered, since the largest asset is 5× under that.

Total build time of 18 seconds means regenerating the entire catalog in CI is trivial, which
strengthens the hash-pinning story: a full regeneration and diff can run on every pull request.

## Corrections to the plan's estimates

### 1. Catalog total was underestimated; per-asset sizes were accurate

Estimated 25–50 MB total; actual **56.9 MB**. But the two figures that matter were close: `{4,3,3} 3`
was estimated at 81 KB and measured at **78.8 KB**, and the worst case was estimated at ~3 MB and
measured at **2.76 MB**. The total was low because the estimate assumed a handful of large puzzles
dominated; in fact the size is spread fairly evenly across 128 entries.

This changes nothing — assets are lazy-loaded per puzzle, so what matters is the per-asset size and
the 40 KB default, not the total.

### 2. `nStickers == nGrips` at length 3 is *almost* universal — three exceptions

The identity holds for 21 of the 24 puzzle families at length 3. The exceptions are exactly the
three families with a triangular factor:

| Puzzle | nStickers | nGrips |
|---|---|---|
| `{3}x{4}` | 189 | 165 |
| `{3}x{3}` | 162 | 126 |
| `{3}x{5}` | 234 | 204 |

These are precisely the cases that trip the special-case cut logic at
`PolytopePuzzleDescription.java:444-499` — `slicingTriangularPrism` and
`isUniformTriangularDuoprism`, which force an integer length, apply
`SLICE_MULTIPLIER_SIMPLEX = 0.995`, and place *all* cuts on the near side because a triangular face
has no opposite face. Extra cuts produce more sticker regions than the cell's element lattice has
elements, so the correspondence breaks.

This is a useful sanity check rather than a problem: the identity was a convenient way to predict
sizes, and it fails exactly where the source says it should.

### 3. Float64 requirement confirmed, and the magnitude measured

The largest circumradius in the catalog is **31.87** (`{100}x{4}`). `FuzzyPointHashTable`'s
`bigEps` of 1e-8 is *absolute*, so at that scale it is **3.1e-10 relative** — against float32's
~1.2e-7. Float32 is roughly **380× too coarse** for the twist-path arrays, confirming that
`stickerCenters`, `gripUsefulMats`, `faceInwardNormals`, and `faceCutOffsets` must be Float64.

(The plan said "three orders of magnitude"; the measured figure is closer to 2.6. The conclusion is
unchanged.)

## Confirmations

- **uint8 sticker-local vertex indices work for the entire catalog.** The largest vertex range within
  a single sticker is **200** (`{100}x{4} 1`), comfortably under 256. No entry needs uint16 indices,
  so the index blocks stay at one byte per index as designed.
- **The per-sticker contiguous vertex range assumption holds** — index ranges are dense and
  non-overlapping, as expected from `Poly.concat` copying per-sticker blocks.
- **`{3,3}x{}` (the tetrahedral prism) is genuinely broken**, as the comment in `MagicCube.java:55`
  says. It is commented out of the catalog, so it never entered the survey. Worth revisiting later,
  but not a v1 concern.

## Incidental findings

**`{5,3,3}` at lengths 2 and 3 are the same puzzle, structurally.** Both produce 7,560 stickers and
64,800 vertices — identical counts. The cut-count formula (`nNearCuts = ceilLength/2`,
`nFarCuts = nNearCuts`) yields one near cut and one far cut for both lengths; only the cut *depths*
differ. So the "2" and "3" hypermegaminx have the same piece structure and differ only in how deep
the slices sit. The same pattern shows up in other families and explains several size plateaus in
`sizes.csv`.

**Grip count is independent of length**, as expected — it depends only on the polytope's element
lattice, not on how finely it is sliced. `{4,3,3}` has 216 grips at every length from 1 to 9. This is
worth remembering when reasoning about `.log` compatibility: a grip index means the same thing across
all lengths of a given Schläfli symbol.

## Verdict

Proceed to Phase 1 with the full 128-entry catalog. No entries dropped, no size mitigations needed.
