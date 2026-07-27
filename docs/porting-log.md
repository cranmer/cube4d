# Porting log

A running record of rewriting [MagicCube4D](https://superliminal.com/cube/) — a 4D Rubik's cube
written in Java between 2005 and 2016 — as a browser application. Kept in the open because the
archaeology turned out to be more interesting than the rewrite, and because the reasoning behind
several decisions is not obvious from the resulting code.

If you want the conclusions rather than the story:

| | |
|---|---|
| Why this architecture | [`architecture-options.md`](architecture-options.md) |
| How the original works | [`legacy-internals.md`](legacy-internals.md) |
| Traps found in the original | [`quirks-and-bugs.md`](quirks-and-bugs.md) |
| What gets built, in what order | [`plan.md`](plan.md) |
| Catalog measurements | [`phase0-results.md`](phase0-results.md) |

---

## Status

**Phase 0 of 6 complete.** Nothing is playable yet.

| Phase | Scope | Status |
|---|---|---|
| 0 | Measure and freeze the catalog | ✅ complete |
| 1 | Exporter + asset format | next |
| 2 | Headless puzzle core | not started |
| 3 | Renderer, static (first shareable artifact) | not started |
| 4 | Interaction — twisting, undo, scramble | not started |
| 5 | Catalog + persistence | not started |
| 6 | Polish & outreach | not started |

What exists today: the repo scaffold, four design documents, a Java survey tool that builds every
puzzle in the catalog, and the golden count fixtures it produced. No TypeScript yet.

---

## 2026-07-26 — Reading the original

Started by reading rather than writing, on the theory that a twenty-year-old program that still works
usually knows something you don't.

**The first surprise was how general it is.** I expected a hypercube program with a few extra puzzles
bolted on. It's the opposite: there is no hard-coded hypercube anywhere. A puzzle is a Schläfli
product symbol plus an edge length — `{4,3,3} 3` for the familiar 3×3×3×3, `{5,3,3} 3` for a puzzle
made of 120 dodecahedra, `{5}x{4} 3` for a pentagonal duoprism. The program constructs the regular
polytope, slices it with hyperplanes, and derives stickers, pieces, and twist axes from the resulting
cell complex. The hypercube is just one of 24 families falling out of the same machinery.

That generality is powered by `com/donhatchsw/util/CSG.java`: 7,257 lines of n-dimensional
constructive solid geometry by Don Hatch, operating on a recursive boundary representation where a
4-polytope's facets are 3-cells whose facets are polygons whose facets are edges. It supports full
boolean CSG — union, intersection, difference — none of which the puzzle uses. It also contains about
2,800 lines of *literal vertex data* for the dodecahedron and the 120-cell, the latter split across
two string constants because a single one would exceed Java's 64 KB limit on string constants.

**The second surprise was how simple the state is.** After all that geometry, a puzzle position is
`int[nStickers]` — 216 integers for the standard cube — saying which colour currently sits in each
physical sticker slot. Solved means every slot on a face agrees. That check is geometry-agnostic and
works unmodified for all 24 families.

**The third surprise was the honesty of the comments.** `// XXX shouldn't be necessary!!!!` above a
call that is in fact necessary. `// XXX DO ME?` on two pipeline stages that were never written.
`// Note: loses redo moves as a side effect!` on a line that loses redo moves as a side effect. And a
twenty-line comment calmly explaining that the grip-picking heuristic is fundamentally inadequate and
what should replace it. Reading this codebase, you always know where you stand.

Detailed dissection: [`legacy-internals.md`](legacy-internals.md).

### The thing that determines the whole architecture

Every move in a saved solve is stored as `<gripIndex>,<direction>,<slicemask>`. That grip index is a
raw position in an array built during geometry construction — one entry per (cell, sub-element of
that cell) pair, ordered by a breadth-first traversal of the polytope's element lattice.

There is no symbolic move notation. No `R U R' U'`. Just array indices.

Which means: **reorder that array by one and every `.log` file ever saved becomes meaningless.** Every
solve in the Hall of Fame, every macro anyone has recorded, every log emailed to
`MagicCube4D@Superliminal.com` over two decades.

A from-scratch reimplementation of the geometry engine would have to reproduce that ordering exactly
— including the epsilon fudge constants, including a latent bug where a loop variable gets clobbered
mid-iteration ([details](quirks-and-bugs.md#length-is-mutated-inside-the-per-face-cut-loop)). And the
failure mode is silent: you'd get a puzzle that looks perfect and twists correctly, and reads every
existing log file wrong.

### The observation that resolved it

While tracing which methods actually need the polytope object after construction, I found that
`PolytopePuzzleDescription` touches it in **exactly five places, and all five just read an integer**
(`nDims`, `nFaces`, `nStickers`).

Everything else — applying a twist, animating a partial twist, resolving a click to a grip, finding
nice points to rotate to the centre, counting a piece's colours — reads only arrays that were
computed during construction and then never updated.

So the running program doesn't need the CSG engine. It needs the engine's *output*.

That makes a build-time exporter the obvious move: run the original Java once per puzzle, dump the
arrays, and ship those. It deletes the hardest four thousand lines from the port, makes puzzle loads
a download instead of a multi-second slice pipeline, and makes log compatibility **exact by
construction** rather than carefully-matched — the indices come from the same code that produced
every existing log file in the world.

The cost is one real feature: "Invent my own!", the menu item that accepts an arbitrary Schläfli
symbol at runtime. Mitigated by shipping the entire catalog and exposing the exporter as a CLI with
drag-and-drop side-loading, so a determined user can still generate `{3}x{7} 4` and drop it in.

Four options were weighed, including compiling the Java to WebAssembly and keeping a Java backend;
the full comparison is in [`architecture-options.md`](architecture-options.md).

---

## 2026-07-27 — Phase 0: measuring the catalog

The architecture rested on estimates: how big is a puzzle's geometry once exported? The plan guessed
25–50 MB for the whole catalog and ~3 MB for the worst case, from hand arithmetic on element counts.
Guesses that load-bearing should be checked before anything gets built on top of them.

### An accidental find

The original ships `ModuleTest.java`, which builds every catalog puzzle and writes element counts to
`test/puzzleBuildTest.ref` — a golden reference for exactly the kind of regression testing a port
needs.

**That file has never been committed.** Only its generator is in the repository; there is no `test/`
directory. So the reference data a port would most want to check itself against did not exist, and
Phase 0 had to produce it.

`ModuleTest` also wraps its whole run in a single try/catch, so the first failing puzzle aborts
everything. Our survey isolates each puzzle so a failure is recorded rather than fatal — which is
presumably how `{3,3}x{}` ended up commented out of the catalog with `// FIX: Simply fails.` rather
than recorded as a known-broken entry.

### A detour: no compiler

The machine had a Java *runtime* — an old Oracle applet-plugin JRE — but no JDK. `javac` on macOS is
a stub that prints an ad for java.com. Homebrew refused to install one because its taps are shallow
clones and updating them is "an extremely expensive operation" GitHub has asked Homebrew not to do
automatically. Installed Temurin 21 straight from Adoptium into `~/Library/Java/JavaVirtualMachines/`
instead: no sudo, no changes to anyone's Homebrew state, and removable by deleting a directory.

The legacy source targets Java 1.6 and compiles on 21 with nothing but deprecation and raw-type
warnings.

`tools/exporter/build.sh` pins the major version, because the generated assets are a wire format and
a toolchain change that silently reordered grips would invalidate every save file.

### Results

**All 128 catalog entries built. Zero failures.** Full detail in
[`phase0-results.md`](phase0-results.md); the headlines:

| | Estimated | Measured |
|---|---|---|
| Default puzzle `{4,3,3} 3` | 81 KB | **78.8 KB** |
| Largest single asset | ~3 MB | **2.76 MB** (`{5,3,3}`) |
| Whole catalog | 25–50 MB | **56.9 MB** |
| Whole-catalog build time | — | **17.9 s** |

The per-asset estimates were good; the total was low, because the estimate assumed a few large
puzzles dominated when in fact size is spread evenly across 128 entries. It doesn't matter — assets
are lazy-loaded per puzzle, so what matters is the 78.8 KB default and the 2.76 MB worst case, both
comfortable. Nothing needs dropping from the catalog.

The 18-second full rebuild was a nice surprise: it means CI can regenerate the entire catalog and
diff hashes on every pull request, which is the whole defence against accidental grip reordering.

### Three things worth writing down

**Float64 is mandatory, and now I know by how much.** `FuzzyPointHashTable` — the spatial hash that
turns a rotated sticker centre back into a sticker index, and therefore the heart of every twist —
uses **absolute** epsilons of 1e-9 and 1e-8. The largest circumradius in the catalog is 31.87
(`{100}x{4}`, a hundred-gonal duoprism), making that tolerance 3.1e-10 *relative*. Float32 resolves
about 1.2e-7. It is roughly **380× too coarse.**

Store sticker centres or grip rotation bases as float32 and twists break — but only on
large-coordinate puzzles, and only for some grips. Exactly the kind of silent, data-dependent bug
that survives a casual test suite. The countermeasure is a property test asserting that every twist
permutation is a bijection; a single float32 leak fails it immediately and names the puzzle and grip.

**A size shortcut that was almost right.** While estimating, I'd noticed that at length 3 the number
of stickers seems to equal the number of grips — both correspond to the cell's element lattice. It
holds for 21 of 24 families. It fails for exactly three: `{3}x{4}`, `{3}x{3}`, and `{3}x{5}` — the
ones with a triangular factor, which are precisely the ones hitting the special-case cut logic that
forces integer lengths and puts all cuts on one side because a triangle has no opposite face. The
shortcut fails exactly where the source says it should, which is reassuring.

**`{5,3,3}` at lengths 2 and 3 are the same puzzle.** Both produce 7,560 stickers and 64,800
vertices — identical. The cut-count formula gives one near cut and one far cut for both; only the cut
*depths* differ. So the "2" and "3" hypermegaminx have the same piece structure and differ only in
how deep the slices sit. The same pattern explains several plateaus in the size table.

### Verdict

Proceed to Phase 1 with the full 128-entry catalog. No entries dropped, no size mitigations needed.
The main architectural risk — "are the assets small enough for this whole approach to work?" — is
retired.

---

## Next

**Phase 1: the exporter and the asset format.** Extend the survey tool into something that writes
`.mc4dpz` files, and write the TypeScript decoder.

The gate is deliberately harsh: TypeScript `applyTwist` must reproduce Java-generated permutations
**bit-identically for all 216 grips × 2 directions × every slicemask** on `{4,3,3} 3`. That single
test exercises the fuzzy hash port, the twist matrix construction, the slicemask logic, and the grip
ordering all at once. If it passes, the riskiest part of the port is done.
