# How MagicCube4D works

A dissection of the original Java, written while planning the port. Everything here is cited by
file and line against the `magiccube4d/` submodule so it can be re-checked as upstream moves.

This is reference material — the *narrative* of the port is in [`porting-log.md`](porting-log.md),
and the traps are catalogued separately in [`quirks-and-bugs.md`](quirks-and-bugs.md).

**Attribution.** MagicCube4D is by Melinda Green and Don Hatch, with contributions from Jay
Berkenbilt and Roice Nelson. The n-dimensional CSG library dissected below is Don Hatch's work, and
it is the most impressive thing in the codebase.

---

## The shape of the thing

~40,000 lines of Java across 46 files, in three cleanly separable layers. That separability is what
makes a port tractable.

| Layer | Files | Lines | AWT/Swing? |
|---|---|---|---|
| Geometry engine | `PolytopePuzzleDescription` + `com/donhatchsw/util/*` | ~16,000 | **None** |
| Render / pick pipeline | `PipelineUtils`, `MC4DView`, `RotationHandler` | ~1,600 | Graphics only |
| Application | `MC4DSwing`, `History`, `Macro*`, `PropertyManager` | ~4,000 | Heavily |

Roughly 10,000 of those lines are unreachable from the puzzle: `LinearProgramming.java` (1,793
lines, zero references from anywhere), `Triangulator.java` (1,222, reachable only through `Poly`
methods the puzzle never calls), `TriangulationOptimizer`, `Minimizer`, and `NdSolve.java` (7,047 —
see below).

---

## 1. A puzzle is a Schläfli symbol and a length

There is no hard-coded hypercube anywhere. A puzzle is specified by two tokens:

```
{4,3,3} 3       the classic 3×3×3×3 hypercube
{5,3,3} 3       "hypermegaminx" — 120 dodecahedral cells
{5}x{4} 3       pentagonal duoprism
{3,3,3} 3       the 5-cell simplex
```

The grammar is parsed in `CSG.makeRegularStarPolytopeCrossProductFromString`
(`CSG.java:1358-1398`): split on `x` or `*` into factors, each factor a `{…}` list of integers or
`n/d` star-polytope fractions. `{}` is legal and means a 1-dimensional segment, so `{4}` ≡ `{}x{}`.
The length is a `double`, not an int — fractional lengths are a deliberate hack for experimenting
with cut depths.

The catalog of 24 families and their legal lengths lives in `MagicCube.java:35-59`, giving 128
(puzzle, length) pairs in total.

### Which base polytopes actually exist

`CSG.makeRegularStarPolytope` (`CSG.java:1253-1318`) dispatches:

| Pattern | Result |
|---|---|
| `{4,3,3,…,3}` | hypercube, generated programmatically |
| `{3,3,…,3}` | simplex |
| `{p}` | regular polygon, including star polygons `{p/d}` |
| `{5,3}` | dodecahedron — **hardcoded literal data** |
| `{5,3,3}` | 120-cell — **hardcoded literal data** |
| `{3,…,3,4}` | cross polytope — throws `Unimplemented` |
| anything else | `throw new Error("Schlafli symbol … not implemented yet!")` (`CSG.java:1313`) |

**About 2,800 of `CSG.java`'s 7,257 lines are literal vertex and incidence data** for the
tetrahedron, 5-cell, dodecahedron, and 120-cell, in a text format called "pcalc" parsed by
`CSG.Polytope.fromStringInPcalcFormat` (`CSG.java:675`). The 120-cell data is split into two string
constants because a single one would exceed Java's 64 KB string-constant limit.

---

## 2. Don Hatch's CSG library

`com/donhatchsw/util/CSG.java` is a general n-dimensional constructive-solid-geometry kernel
operating on a recursive boundary representation. A `Polytope` (`CSG.java:189-252`) has a dimension,
a list of facets that are themselves `Polytope`s one dimension lower, and its contributing
hyperplanes. A 4-polytope's facets are 3-cells, whose facets are polygons, whose facets are edges,
whose facets are vertices. Each element carries a globally unique id and a user-settable `aux` field.

Two derived views are computed and memoized:

- `getAllElements()` (`CSG.java:316`) — a BFS over the facet graph, bucketed by dimension and sorted
  by id. **This ordering is what grip indices ultimately depend on.**
- `getAllIncidences()` (`CSG.java:389`) — for every element, the indices of every incident element of
  every other dimension.

The library supports full boolean CSG (`union`, `intersect`, `complement`, `diff`), but the puzzle
never uses any of it. **The puzzle model calls exactly seven CSG entry points:**

```java
makeRegularStarPolytopeCrossProductFromString(String)   // construction
orientDeep(SPolytope)                                    // twice
sliceFacets(SPolytope, Hyperplane, Object)               // once per cut
calcRotationGroupOrder(Polytope, Polytope, Polytope, double[][])   // once per grip
cgOfVerts(double[], Polytope)                            // centroids
SPolytope.volume()                                       // sliver removal
getAllElements() / getAllIncidences() / resetAllElements()
```

### The `aux`-field trick

This is the cleverest thing in the construction, and the thing a port most needs to understand.

Before slicing, every element of the original polytope is stamped with its own index into its `aux`
field (`PolytopePuzzleDescription.java:301-315`). Slicing preserves `aux` on the surviving
sub-elements. So after slicing:

- each sticker's `aux` still says which original cell it came from → `sticker2face`
- a ridge with `aux != null` came from the original polytope rather than from a cut, meaning the two
  stickers sharing it belong to the same physical piece → `sticker2cubie`, via union-find

Without this provenance tagging, neither mapping is recoverable. Any reimplementation needs an
equivalent mechanism designed in from the start.

---

## 3. Building a puzzle

All of it happens in one constructor, `PolytopePuzzleDescription.java:283-934`.

**Build the polytope.** From the Schläfli string, then `orientDeep` to fix facet orientations
(commented `// XXX shouldn't be necessary!!!!` at line 297).

**Find the face planes.** Inward normals and offsets from each cell's contributing hyperplane.
Opposite faces are found by putting all inward normals into a fuzzy spatial hash and looking up each
negated normal — `-1` when there is none, as for a simplex.

**Decide the cut hyperplanes** (lines 390-509) — the most delicate part. For each face, compute
`fullThickness`: the depth of the polytope along that face's inward normal, taken as the smallest
positive projection of an edge touching the face but not lying on it. Then
`sliceThickness = fullThickness / length`, and place `ceilLength/2` cuts on the near side and the
same on the far side.

The epsilon fudging lives here:

```java
SLICE_MULTIPLIER        = 0.99999   // even lengths: the two middle cuts would coincide
SLICE_MULTIPLIER_SIMPLEX = 0.995    // simplex-like cells
SLIVER_VOLUME_PERCENT   = 15        // cull stickers below this % of average volume
```
(`PolytopePuzzleDescription.java:196-198`, with a comment warning to re-run the module test if they
are changed.)

The reason for the fudging is blunt: the slicer throws `Unimplemented` if a vertex lands *exactly* on
a cut plane. So cuts are deliberately nudged off-centre, which produces degenerate sliver stickers,
which are then culled by volume in a later pass. It is a hack, it is load-bearing, and it works.

**Slice** (lines 514-553). `CSG.sliceFacets` splits each facet of the polytope by the hyperplane and
rebuilds the facet list from the pieces — so a 4-polytope's 3-cells get subdivided, but the polytope
itself is not cut in two. Faces whose opposite has already been processed are skipped. This is the
dominant cost of construction.

**Remove slivers** (lines 559-594) — discard facets whose volume is under 15% of the average, warning
if anything lands ambiguously near the threshold.

**Extract stickers and pieces** (lines 596-657). Stickers are the facets of the sliced polytope.
Pieces come from union-find (`MergeFind`, 50 lines) over ridges whose `aux` survived, per the trick
above. Note the resulting cubie ids are **non-consecutive** — they are union-find representatives,
not a dense range.

**Flatten to drawable geometry** (lines 690-792). Each sticker is converted independently by
`PolyCSG.PolyFromPolytope`, then concatenated — so **each sticker owns a private, contiguous block of
vertices with no sharing between stickers**. A final fixup cyclically rotates the second polygon's
indices so that four specific vertices are guaranteed to form a non-degenerate simplex; the sign of
that simplex's projected volume is what the renderer uses for inside-out cell culling. That contract
is stated in the interface at `PuzzleDescription.java:40-48`.

**Decompose for shrinking** (lines 795-823). Three parallel arrays let any (faceShrink, stickerShrink)
be applied in one pass with no geometry work:

```java
vert = (vertMinusStickerCenter * stickerShrink + stickerCenterMinusFaceCenter) * faceShrink
       + faceCenter
```

Two of those three arrays are *aliases* — one value per sticker and one per face, replicated across
each vertex (lines 806-822). Worth knowing: it makes the exported asset about 3× smaller than the
naive reading suggests.

---

## 4. Grips: how twists are addressed

A **grip** is a rotation axis, and there is one for every (cell, sub-element of that cell) pair for
sub-element dimensions 0 through 3. For `{4,3,3}`: 8 cells × (8 vertices + 12 edges + 6 faces + 1
cell centre) = **216 grips**.

Grip count depends only on the polytope's element lattice, **not on the length** — `{4,3,3}` has 216
grips at every length from 1 to 9. Measured counts for the whole catalog are in `fixtures/sizes.csv`.

Each grip carries:

- `grip2face` — which cell it belongs to, determining which stack of parallel slices it moves
- `gripDims` ∈ {0,1,2,3} — the dimension of the sub-element
- `gripCentersF` — a 4D point used only for nearest-neighbour picking, **nudged 1% toward the cell
  centre** so that two grips on different cells of the same piece don't coincide
- `gripSymmetryOrders` — the twist angle is 2π/order. **0 means "cannot rotate"** (cell-centre grips);
  **1 means a 360° no-op**. Both must be filtered before offering a twist.
- `gripUsefulMats` — an orthonormal 4×4 basis defining the rotation plane

Symmetry orders are found by brute force in `CSG.calcRotationGroupOrder` (`CSG.java:1621-1776`): for
each divisor of the maximum possible order, rotate every vertex of the whole polytope and check
whether the result lands back on the vertex set, via a fuzzy hash. First success wins.

The twist matrix is a conjugated planar rotation, in **row-vector convention** (`v · M`):

```java
transpose(gripUsefulMat) · makeRowRotMat(n, n-2, n-1, dir · 2π/order · frac) · gripUsefulMat
```

---

## 5. State and twisting

Puzzle state is startlingly simple — `int[nStickers]`, where `state[slot] = faceIndex` says which
colour currently sits in that physical sticker slot. Solved iff every slot belonging to a face agrees
(`PuzzleManager.isSolved()`), which is geometry-agnostic and works for every puzzle in the catalog.

A twist is applied **geometrically, recomputed from scratch every call**
(`PolytopePuzzleDescription.java:1348-1387`):

```
for each sticker:
    if its centre is in the slice mask:
        rotate the centre by the twist matrix
        look the result up in a fuzzy spatial hash → destination slot
        move the colour there
    else:
        leave it
```

There is no precomputed permutation table. A port should memoize per `(grip, direction, slicemask)` —
this alone is roughly a 10× speedup when replaying a long solve log.

### Slice masks

Fifteen lines (`PolytopePuzzleDescription.java:1390-1406`): dot the sticker's centre with the face's
inward normal, count how many ascending cut offsets it exceeds to get a slice index, test that bit.

- Slice 0 is the outermost layer adjacent to the grip's cell; slice 1 is next inward.
- Multiple bits move multiple layers together; all bits set is a whole-puzzle rotation rather than a
  twist.
- `slicemask == 0` is normalised to `1` everywhere.
- In the UI, holding number keys 1–9 sets the bits.

Note the classification depends only on the grip's *face*, not the grip itself — so two grips on the
same cell move exactly the same stickers for a given mask, differing only in rotation axis and order.

---

## 6. The render pipeline

`PipelineUtils` is stateless: 862 lines, twelve stages, ending in `Graphics.fillPolygon` on integer
pixels. **No z-buffer, no 3D API, no transparency anywhere.**

| # | Stage | Notes |
|---|---|---|
| 1 | Sticker verts with face/sticker shrink | optionally partially twisted |
| 2 | Rotate in 4D, scale by 1/circumradius | one 4×4 matrix |
| 3 | 4D near-clip | **stub, never implemented** (`PipelineUtils.java:213`) |
| 4 | **4D → 3D perspective** | `w = eyeW − v.w; v.xyz *= eyeW/w` |
| 5 | **Front-cell cull** | scalar triple product; keep only *back* cells |
| 6 | Shadow projection onto ground plane | |
| 7 | Flat Lambert brightness per polygon | no ambient term, clamped at 0 |
| 8 | 3D near-clip | **stub** (`PipelineUtils.java:354`) |
| 9 | **3D → 2D perspective** | `z = eyeZ − v.z; v.xy /= z` |
| 10 | 2D back-face cull by signed area | culled polys kept for the shadow pass |
| 11 | 2D affine: scale, Y-flip, centre | |
| 12 | Painter's-algorithm back-to-front sort | key is the retained z from stage 9 |

**Stage 5 is the whole trick.** Without it you would see only the nearest cell. It relies on the
non-degenerate-simplex guarantee established during construction. Everything characteristic about how
MagicCube4D *looks* — the cube nested inside a cube — comes from culling the near cells of a 4D
object and letting you see through to the far side.

**The see-through effect is purely geometric.** There is no alpha anywhere. The gaps come from
`faceShrink` (default 0.4) and `stickerShrink` (default 0.5) opening space between cells, plus the
front-cell cull.

Note that stage 9 retains `eyeZ − v.z` in the unused third slot, commented "keep this for future
reference" (`PipelineUtils.java:370`). That retained value *is* camera-space depth for a pinhole
camera — which is why swapping the painter's sort for a real depth buffer is sound rather than risky.

### Picking

2D point-in-polygon in **final screen pixels**, walking the sorted draw list front to back, first hit
wins (`PipelineUtils.java:526-567`). The hit sticker maps to a grip via `getClosestGrip`, which
filters candidates by face and by `gripDim = 4 − (number of colours on that piece)` — corner piece →
vertex grip, edge piece → edge grip, and so on — then takes the nearest grip centre in 4D. That
heuristic is known-imperfect; see [`quirks-and-bugs.md`](quirks-and-bugs.md).

### Rotation

There is exactly one matrix, `viewMat4d`. There is **no separate 3D rotation** — the 3D orientation
of the projected polytope is fixed, and everything is a rotation in 4D.

| Input | Rotation planes |
|---|---|
| Left-drag | XZ and YZ — reads as ordinary 3D trackball rotation |
| Shift + left-drag | XW and YW — "true 4D" |
| Right-drag | XY (roll) and ZW |

Each drag builds an antisymmetric generator (an element of so(4)) and applies:

```java
delta = gramschmidt(I + spinDelta);
viewMat4d = gramschmidt(viewMat4d · delta);
```

A first-order exponential map, re-orthonormalised. Cheap, self-correcting, and perfectly adequate.
Momentum spin continues if the mouse was released while still moving — tested by requiring the
release event's timestamp to equal the last drag event's, which is a neat way to suppress accidental
spin.

Ctrl+click slerps the clicked cell or piece to the −W axis ("bring this to the centre"); ctrl+right-
click reverses it.

### Animation

Frame-count based, not time based: `nTwists = angle/(π/2) × 11 × twistfactor`, so a quarter turn is
11 frames regardless of monitor refresh rate. Easing is `(sin((x−0.5)π)+1)/2`. There is no timer —
the animation is a self-sustaining repaint chain, where each paint schedules the next if work
remains.

---

## 7. File formats

### `.log`

```
MagicCube4D 3 2 41 {4,3,3} 3     magic, version, scrambleState, twistCount, schlafli, length
0.732 -0.196 0.653 0.0           4 rows of the 4D view matrix
0.681 0.187 -0.707 0.0
0.016 0.963 0.27 0.0
0.0 0.0 0.0 1.0
*                                sentinel
57,1,1 3,-1,2 m| 91,1,1 ... .    token stream, newline every 10, terminated by '.'
```

Tokens are either a move `grip,direction,slicemask` or a mark `m<char>`, where `|` is the scramble
boundary, `[` and `]` bracket an applied macro, and `S` marks set-up moves. An optional `c ` prefix
marks the current position for undo.

Header field 1 must be exactly `3` — the loader rejects anything else. The puzzle is identified by
fields 4 and 5 alone, and loading re-runs the entire geometry construction from that string.

**The compatibility crux:** the first number in each move is a **grip index** — a raw position in the
array built during construction. There is no symbolic move notation to fall back on. Reproduce that
ordering exactly or every existing log file is meaningless. This single fact is the strongest
argument for generating puzzle geometry from the original code rather than reimplementing it.

### `.macros`

```
MagicCube4D 2
@name@@{4,3,3} 3.0@(g 57 91 23) 57,1,1 91,-1,1 ... .
```

A macro is a twist sequence recorded relative to **three reference grips**. Applying it elsewhere
fits a 4×4 orthogonal transform from the three definition points plus a face centre to the three new
points plus theirs, pushes each recorded grip's coordinates through it, and snaps to the nearest
grip. If the transform's determinant is negative — a mirrored placement — the sequence is
automatically reversed.

Note the puzzle string here is the raw double (`{4,3,3} 3.0`), unlike the log's pretty length (`3`).

---

## 8. NdSolve: 7,047 lines of orphan

`NdSolve.java` is a genuine solver for n^d cubes by Don Hatch, dated 2006. It implements a proper
layer-agnostic reduction: fix permutation parity, then for k = 2..d position and orient the k-sticker
pieces using commutators that preserve what is already solved.

It is also **completely unreferenced**. `grep -rn NdSolve` across the entire tree matches only inside
the file itself. Its menu item is commented out, its hotkey registration is commented out, and even
the commented-out action called a method on a class that no longer exists.

It only handles 2^d and 3^d cubes, so it could never be the general "Solve" button for a 24-family
catalog. The user-visible "Solve (Cheat)" is animated undo-all, which is a few lines.

Not ported.

---

## What surprised me

- **The engine is genuinely general.** It is not a hypercube program with extras bolted on; the
  hypercube is one of 24 families falling out of the same construction.
- **The geometry layer is completely free of AWT.** `PuzzleDescription.java` has zero imports.
  `CSG.java` has zero imports, using fully-qualified names throughout. The only coupling is a
  progress-callback parameter that is null-checked at every use.
- **Nothing is cached.** Every puzzle load re-runs the full slice pipeline. Measured: 1.46 s for the
  largest puzzle, 17.9 s for all 128. That is why the biggest puzzle is capped at length 3 and why
  there is a four-phase progress bar.
- **Puzzle state is 216 integers.** All the complexity is in the geometry; the state is trivial.
- **The comments are honest.** `// XXX shouldn't be necessary!!!!`, `// XXX DO ME?`, a 20-line
  admission that the grip-picking heuristic is fundamentally inadequate, and a note that a fudge
  constant was tuned because "too close to 1 [affects] drawing and too far from 1 was affecting grip
  detection." Reading this codebase, you always know where you stand.
