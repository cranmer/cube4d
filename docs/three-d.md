# Three dimensions on a four-dimensional engine

How an ordinary Rubik's cube is built from the same code that builds the 3×3×3×3, what that costs,
and the two places where the 4D assumptions have to be told about it.

Written while implementing Phase 8. Everything measured here comes from the unmodified engine in
`magiccube4d/` unless stated otherwise.

---

## 1. Why bother

The move set here is nothing like a Rubik's cube's. There is no R, U or F; there are grips at cells,
faces, edges and vertices, and which one a click means is *inferred* from how many colours the piece
you clicked carries. That is learnable — but it has to be learned at the same time as the fourth
dimension, and the two difficulties multiply.

A 3D puzzle separates them. Learn what a grip is, what a slice mask does, what clicking a sticker
means, all on a shape whose solved state you can already picture. Then add a dimension.

It is also a check on the port. If the twist machinery is genuinely dimension-generic, a 3D cube
should fall out of it. If it does not, something is special-cased that should not be.

---

## 2. What already works, unmodified

`{4,3} 3` builds from the stock engine with no changes at all:

| Puzzle | Schläfli | Cubies | Stickers | Axes | Slices |
|---|---|---|---|---|---|
| Pocket cube | `{4,3} 2` | 8 | 24 | 6 × order 4 | 2 |
| **Rubik's cube** | `{4,3} 3` | 26 | 54 | 6 × order 4 | 3 |
| Rubik's revenge | `{4,3} 4` | 56 | 96 | 6 × order 4 | 4 |
| Professor's cube | `{4,3} 5` | 98 | 150 | 6 × order 4 | 5 |
| Megaminx | `{5,3} 3` | 62 | 132 | 12 × order 5 | 3 |

Polytope construction, hyperplane slicing, cubie derivation, sticker generation and the state model
are all genuinely dimension-generic. So are `@mc4d/puzzle-core`'s decoder, `applyTwist`, and the
`.mc4dpz` format itself — every one of them carries `nDims` and uses it, with no hardcoded 4
anywhere in the twist path.

The number of slices is the edge length, so "how finely sliced" needs no separate mechanism: a
2×2×2, 4×4×4 and 5×5×5 are the same code with a different number.

**Not everything works.** `{3,3}` (tetrahedron) and `{3,4}` (octahedron) both fail inside the CSG for
reasons unrelated to any of this — an orientation assertion and an unimplemented Schläfli case — so
the 3D family is cubes and dodecahedra, not every Platonic solid.

---

## 3. The one missing piece: twist axes

At `PolytopePuzzleDescription.java:844`, grip construction is wrapped in `if(nDims == 4)`, directly
above a comment in which the author begins to handle 3D, notices the cell/facet analogy does not
transfer, and says so.

The analogue turns out to fit the existing machinery exactly. **In 4D a twist rotates a *cell* about
one of its sub-elements; in 3D it rotates the *whole polytope* about one of its sub-elements.** That
satisfies `CSG.calcRotationGroupOrder`'s precondition that its `cell3d` argument have dimension 3 —
which the whole solid does, and which is why passing a *face* fails.

Called that way it returns order 4 for each face of a cube and order 5 for each face of a
dodecahedron, with every useful matrix orthonormal to 2 × 10⁻¹⁶. Six axes of order 4 are exactly
R, L, U, D, F and B.

This lives in `tools/exporter/src/.../Grips3D.java`, reading the description through the same
reflection the exporter already uses for the 4D grip fields. **The legacy submodule is not
modified** — that stays a read-only reference, as it has been throughout.

### Face axes only, deliberately

The same call also yields order-3 rotations about vertices and order-2 rotations about edges. They
are real rotations of the solid, and they are not generated, for a structural reason rather than
laziness:

> A grip carries the face its slices are measured from (`grip2face`), and the twist code uses that
> face's inward normal and cut offsets to decide which layer a slice mask selects. A vertex or an
> edge belongs to no single face, so there is nothing for the mask to measure against.

Corner- and edge-turning puzzles are a different puzzle rather than a missing feature, and a cube
whose axes are its faces is the cube everyone means by "a Rubik's cube".

---

## 4. Flat in W: what the renderer needs

The renderer is the only genuinely 4D-specific code — `vec4` throughout, a 4D rotation uniform, a
projection from an eye on the W axis, and the front-cell cull that produces the cube-within-a-cube.
The instinct that a 3D puzzle is "the 4D puzzle held flat in W" turns out to be exactly right, and it
reduces the work from *a second shader* to *a flag*.

Embed the geometry at `w = 0` and trace the pipeline:

**The 4D→3D projection becomes the identity, for free.** `project()` computes

```
r.xyz * (uEyeW / (uEyeW - r.w))
```

With `r.w = 0` that factor is exactly `1`. The stage passes `xyz` straight through — no change, no
special case, no cost.

**The front-cell cull breaks, and fatally.** Both shaders do

```glsl
if (cellVolume(stickerId, ...) >= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
```

`cellVolume` is the scalar triple product of four witness points of the sticker. In a flat-in-W
puzzle those four points are coplanar, so the determinant is *exactly zero* — which satisfies
`>= 0.0`. **Every sticker would be culled and the puzzle would be invisible.** A uniform that
switches the cull off is the whole fix.

That the failure is total rather than subtle is fortunate: a puzzle that renders nothing is noticed
immediately, where a puzzle that culls the wrong sticker occasionally is not.

**Two consequences worth naming.** With no cull, a 3D puzzle needs ordinary depth-buffered rendering
to decide what is in front — which the renderer already does. And the drag handler must be kept in
the 3D planes: shift-drag rotates in XW/YW, which would tilt the puzzle out of the `w = 0` hyperplane
and un-flatten it. Shift-drag has to do nothing, or something else, on a 3D puzzle.

**Where the padding belongs.** The asset stays honest at `nDims = 3`; the pad to `w = 0` happens
where the buffers are uploaded, because `vec4` is a fact about GPUs rather than a fact about the
puzzle.

---

## 5. Picking: the heuristic is the point, and it transfers

In 4D you never choose an axis directly. You click a sticker, and the program infers which of the
many axes on that cell you meant from the piece's *type*: `gripDim = nDims − colours`, then the
nearest axis of that dimension on that cell. A 4-colour corner asks for a rotation about a vertex, a
3-colour piece about an edge, a 2-colour piece about a face.

**That heuristic is not plumbing. It is the interface a 3D puzzle exists to teach.** An earlier draft
of this document argued the opposite — that the rule solves a disambiguation problem 3D does not
have, so a 3D puzzle should simply turn the face you clicked. That produces a working cube and
destroys the entire reason for building it: a learner would practise an interface that appears
nowhere else.

The rule transfers exactly, once the axes are constructed per (face, element) as in §3:

| Piece | Colours | `3 − colours` | Axis | Turn |
|---|---|---|---|---|
| corner | 3 | 0 | a vertex of that face | order 3 — **120°** |
| edge | 2 | 1 | an edge of that face | order 2 — **180°** |
| centre | 1 | 2 | the face itself | order 4 — **90°** |

Measured on `{4,3} 3`: 24 corner stickers → dimension 0, order 3; 24 edge stickers → dimension 1,
order 2; 6 centre stickers → dimension 2, order 4. No special case in `gripForPick` at all.

**The centre sticker is live here and dead on the hypercube**, and that falls out rather than being
arranged. The last case asks for a rotation about an element of dimension `nDims − 1`. In 4D that is
the cell itself, which has no rotation — which is why a hypercube's centre cubie cannot be clicked
and does nothing. In 3D it is the face, which rotates by a quarter turn. Same arithmetic, opposite
outcome, because the dimensions differ.

---

## 5a. The one thing that does *not* transfer: which layers may turn

The axes are right and the pick rule is right. What is not is the assumption that any of them can
turn a *single layer*.

Exhaustively, over every (axis, layer-mask) combination on four 3D puzzles:

```
corner axes   single layer: 0 of 24 give a valid permutation      all layers: 24 of 24 ✓
edge axes     single layer: 0 of 24                               all layers: 24 of 24 ✓
face axes     single layer: 6 of 6 ✓                              all layers:  6 of 6 ✓
```

The rule is exact — 3,138 combinations across `{4,3} 2,3,5` and `{5,3} 3`, zero exceptions:

> **Below four dimensions, only a facet axis can turn one layer. A corner or edge axis is legal only
> with every layer selected — that is, as a rotation of the whole solid.**

The reason is a dimension counting argument, and it is the real content of the original author's
aborted comment. In the hypercube, the first layer measured from a cell **is that cell** — a whole
3×3×3 cube — so it carries the cube's entire rotation group, and a 120° turn about one of its corners
maps its 27 cubies onto themselves. In three dimensions the first layer measured from a face is a
flat 3×3×1 slab, whose only symmetry is the face's own four-fold one. Turn it about a corner and its
cubies have nowhere to go.

This is the same fact as a physical Rubik's cube having no corner move. It is not a defect of the
port; it is what three dimensions are like.

`isValidTwist` now encodes it, so a corner click on a single layer is refused rather than producing
nonsense. The pedagogical consequence is worth stating: on a 3D cube, hovering a corner shows you a
real axis, and clicking it **reorients the whole cube by 120°**. That is honest, and arguably the
clearest possible demonstration of what a corner axis *is* — before you meet one in 4D that can turn
a layer.

---

## 6. What is *not* a constraint

Everywhere else in this project, grip ordering is a wire format. A move in a `.log` is a bare index
into a generated array, so the export order is fixed by twenty years of saved solves and cannot be
chosen.

**There are no 3D logs.** No 3D puzzle has ever been saved from MagicCube4D, because it could never
build one. So the grip order here is a free choice made for clarity — one grip per face, in face
order — rather than a constraint inherited from 2005. It is the only part of this port where that is
true.

The same freedom applies to the direction convention: which way a plain click turns a face is ours to
pick, and should be picked so that "clockwise" looks clockwise *from outside the cube*, which is what
a cuber means by it. That needs checking against a render rather than reasoning about matrices.

---

## 7. Checklist

| Piece | Status |
|---|---|
| Polytope, slicing, cubies, stickers | ✅ works unmodified |
| Twist axes for `nDims == 3` | ✅ `Grips3D.java`, verified orthonormal |
| `.mc4dpz`, decoder, `applyTwist` | ✅ already dimension-generic |
| Exporter emitting 3D entries | ✅ `Expand3D.java`; behind `--include-3d` until the apps can use them |
| Twist permutations proven bijective in TS | ✅ 66 tests in `threeD.test.ts` |
| Renderer: pad to `w = 0`, disable the cull | ✅ `widenTo4D` + `uCull` |
| `gripForPick`: face-of-sticker rule for 3D | ✅ |
| Drag: keep to the 3D planes | ✅ `DragOptions.dims` |
| The app itself, with a slice-count choice | ⬜ blocked on §9 |
| Direction convention checked against a render | ⬜ |

---

## 8. The blocker: 3D stickers share vertices

The asset format stores polygon indices *sticker-locally*, in one byte each, which needs every
sticker to own a private contiguous run of vertices. The 4D path gets that for free, and the exporter
verifies it rather than trusting it. Measured:

```
{4,3,3} 2   nVerts=512  nStickers=64   sticker 0 range [0..7], sticker 1 [8..15], …   private
{4,3} 2     nVerts= 26  nStickers=24   sticker 0 range [6..13], sticker 1 [4..13]     shared
{4,3} 3     nVerts= 56  nStickers=54   sticker 0 range [6..25], sticker 1 [16..25]    shared
```

In 4D each sticker is a solid with eight vertices of its own — 64 × 8 = 512, exactly. In 3D a sticker
is a *polygon* on a shared surface mesh: 24 quads over 26 vertices, with neighbours sharing corners.
The exporter's contiguity check fires on the first sticker, which is the check doing its job.

Sharing is not merely inconvenient for the index encoding; it makes one of the stored arrays
ill-defined. The shrink decomposition keeps `vertsMinusStickerCenters` **per vertex**, which assumes a
vertex belongs to one sticker and so has one centre to be measured from. A shared corner belongs to
three stickers with three different centres, and no single value is right for all of them.

**Done**, in `Expand3D.java`. Each 3D sticker gets private copies of the vertices it uses, so the runs
are contiguous by construction and each copy's offset is measured from the sticker that actually owns
it. A pocket cube goes from 26 vertices to 96 — nothing at these sizes.

Absolute positions turn out to be recoverable exactly, which is what makes this arithmetic rather than
guesswork, and the mechanism is cleaner than expected. Alongside the two arrays the exporter already
read, the description keeps a third — `vertFaceCenters` — holding the face centre of whichever sticker
first claimed each vertex. The three sum to the true rest position for every vertex, shared or not.
The 4D path had been reconstructing through the *per-face* centre instead, which is correct only
because 4D vertices are never shared; using the per-vertex one is the distinction that does not matter
there and does here.

Applied only for 3D. Renumbering 4D vertices would change a wire format, and the check that matters
is that it did not: **all 128 4D assets export byte-identical** by sha256 after the change.

---

## 9. The bug that was: two orderings that are not the same order

The first render was a recognisable cube and completely wrong — 102 of 216 vertices off by exactly
2.0, the width of the cube, landing on the opposite face. The cause is worth recording because
nothing about it is visible in either piece of code alone.

`stickerInds` and `stickerCentersD` are **not indexed the same way in 3D.** In 4D `stickerInds` is
built by concatenating one `Poly` per sticker, so its order *is* the sticker order:

```java
Poly stickerPolys[] = new Poly[nStickers];
for(int iSticker = 0; ...) stickerPolys[iSticker] = PolyCSG.PolyFromPolytope(stickers[iSticker]);
Poly slicedPoly = Poly.concat(stickerPolys);
```

In 3D it is the sliced solid's own face list, reinterpreted:

```java
Poly slicedPoly = PolyCSG.PolyFromPolytope(slicedPolytope.p);
stickerInds = (int[][][]) slicedPoly.inds;   // one contour per face, read as one face per sticker
```

That order has no reason to agree with the order `stickerCentersD`, `sticker2face` and the twist
permutations use, and it does not. Measuring the centroid of each polygon against the sticker centres
showed every one of the 54 matching a *different* sticker, at distance exactly zero — which is the
signature of a permutation rather than of arithmetic being wrong. The reconstruction was right all
along.

The fix pairs them by geometry rather than assuming: a polygon's vertices centre on its own sticker's
centre and on no other's, so matching centroids identifies each. `Expand3D` insists the match be exact
and that no sticker be claimed twice, so if the assumption ever stops holding it will say so rather
than draw a subtly wrong cube.

Verified afterwards, using each face's own normal from the asset rather than assuming faces are
axis-aligned — which matters for the dodecahedron, and which made my first check report a false
failure on it:

```
4-3_2   worst out-of-plane: 0.00e+0      4-3_5   5.96e-8
4-3_3   worst out-of-plane: 5.96e-8      4-3_7   5.96e-8
4-3_4   worst out-of-plane: 0.00e+0      5-3_3   1.19e-7
```

Every vertex lies in its own face's plane to float32 precision. The twist tests were passing
throughout, and would have gone on passing: the twist path reads sticker centres and grip matrices,
never the vertex offsets, so this was invisible to all 66 of them. It took a picture.

---

## 10. Checklist

| Piece | Status |
|---|---|
| Polytope, slicing, cubies, stickers | ✅ works unmodified |
| Twist axes for `nDims == 3` | ✅ `Grips3D.java` |
| `.mc4dpz`, decoder, `applyTwist` | ✅ already dimension-generic |
| Exporter emitting 3D entries | ✅ `Expand3D.java`, behind `--include-3d` |
| Twist permutations proven bijective | ✅ 66 tests |
| Vertex geometry proven planar | ✅ to float32 precision, all six puzzles |
| Renderer: pad to `w = 0`, disable the cull | ✅ `widenTo4D` + `uCull` |
| Grips per (face, element), as 4D has per (cell, element) | ✅ 54 for a cube, 132 for a dodecahedron |
| `gripForPick` unchanged — the 4D heuristic transfers | ✅ corner 120°, edge 180°, centre 90° |
| `isValidTwist`: only facet axes turn one layer | ✅ verified over 3,138 combinations |
| Traditional colours for a six-faced puzzle | ✅ white/yellow, green/blue, red/orange |
| Drag: keep to the 3D planes | ✅ `DragOptions.dims` |
| Framing defaults for a solid | ✅ `DEFAULT_CONTROLS_3D` |
| The app itself, with a slice-count choice | ⬜ |
| Direction convention checked against a render | ⬜ |
| 3D assets shipped by default | ⬜ still behind `--include-3d` |

---

## 11. Does this actually teach the 4D interface?

Honestly: **less than it was meant to.** Worth writing down while the reasoning is fresh, because the
answer decides what the app is for.

What was hoped: learn the grip taxonomy — corner means a 120° turn, edge means 180°, centre means 90°
— on a shape whose solved state you can already picture, then carry that to the hypercube.

What actually transfers:

| | 3D cube | 4D hypercube |
|---|---|---|
| Hover a sticker, see the piece light up | ✅ | ✅ |
| Which axis a click means, from the piece's colour count | ✅ | ✅ |
| Layer selection 1–n, direction toggle, right-click to reverse | ✅ | ✅ |
| Drag to rotate, with momentum | ✅ | ✅ |
| **Corner click turns a layer** | ❌ whole solid only | ✅ |
| **Edge click turns a layer** | ❌ whole solid only | ✅ |
| **Centre sticker does nothing** | ❌ it is the face turn | ✅ dead |

The mechanics transfer completely. The *taxonomy* — the distinctive part, the thing a newcomer finds
strange — is exactly where the two disagree, and it disagrees in both directions at once: the two
piece types that would demonstrate it are inert in 3D, and the one type that is inert in 4D is the
useful one in 3D.

**And the engine cannot produce a 3D puzzle where they would work.** Every cut it makes is parallel
to a face (`faceCutOffsets` is indexed by face), so no corner-turning solid — a Skewb, a Dino cube —
is expressible here. This is not a gap to be filled later; it follows from how the slicing is defined.

So the 3D cube is a good on-ramp for the *mechanics* and a poor teacher of the *idea*. Three ways to
take that, none yet chosen:

1. **Keep it, and say what it is.** An on-ramp for hover/click/layers/direction/drag, plus a genuinely
   interesting exhibit: a Rubik's cube has no corner move, and here is the dimension count that says
   why. Curiosity rather than pedagogy.
2. **Teach on a small 4D puzzle instead.** The taxonomy only exists in 4D, so the tutorial arguably
   belongs on `{4,3,3} 2` or `{3,3,3} 3`, where there are few enough pieces to see what is happening.
3. **Split the tutorial.** Mechanics on the cube, taxonomy on the hypercube, with the disagreement
   itself as the bridge — "here is why the corner does nothing on a cube, and everything here."

The third is the only one that uses what was learned rather than working around it.

---

## 12. What a twist actually is — and why 120° is physical

The question that settles §11: are the 120° and 180° twists *physical* in 4D, or do the cubies pass
through each other? Measured on `{4,3,3} 3`, for the cell at +W:

```
vertex axis  order 3 (120°)   cell normal fixed: 0.0e+0   W component ever changed: 0.0e+0
edge   axis  order 2 (180°)   cell normal fixed: 0.0e+0   W component ever changed: 0.0e+0
face   axis  order 4  (90°)   cell normal fixed: 0.0e+0   W component ever changed: 0.0e+0
```

**No twist of MC4D is a four-dimensional rotation.** Every one is a *simple* rotation — a single
bivector, one invariant plane — and that plane lies entirely inside the cell's own 3-space. The W
component of every basis vector is untouched, exactly.

The construction makes this inevitable. `CSG.calcRotationGroupOrder` builds an orthonormal frame `U`
whose first two rows are the cell's normal and the cell→element direction, then rotates in the plane
of the *last two* rows — the plane orthogonal to both. The cell normal is W and the element direction
lies in XYZ, so the rotation plane is inside XYZ.

For the +W cell of a hypercube, with the six coordinate bivectors available in 4D:

| Element | Direction | Rotation plane | Order |
|---|---|---|---|
| a face, at +X | `x` | `y∧z` | 4 — 90° |
| an edge, at +X+Y | `(x+y)/√2` | `(x−y)∧z` | 2 — 180° |
| a vertex, at +X+Y+Z | `(x+y+z)/√3` | the plane ⟂ to it in XYZ | 3 — 120° |

So of `xy, xz, yz, xw, yw, zw`, a twist of the +W cell uses only the first three, and never the three
containing W. Cells at ±X use only the planes avoiding X, and so on.

The measured vertex twist is exactly `X→Y→Z→X`: the 3-cycle of coordinate axes, which is the 120°
rotation about the body diagonal `(1,1,1)`, with W left alone.

### Why that is physical

Because the slab being turned is a **cube**. Layers measured from the +W cell contain, in order:

```
layer 1: 27 cubies     layer 2: 26 cubies (27 less the invisible core)     layer 3: 27 cubies
```

Each is a 3×3×3 block at constant W. A twist rotates one or more of these blocks about an axis lying
in their common 3-space; W never changes, so a moving block stays in its own hyperplane and the
stationary cubies are in others. Nothing can intersect at any moment of the motion. Within the block,
the rotation is a symmetry of a cube — order 3 about a vertex, 2 about an edge, 4 about a face — so
cubies land on cubies.

### The reframing this forces

The fourth dimension is not in the motion. **A hypercube twist is exactly the thing you do to a whole
Rubik's cube: pick it up and turn it.** What is four-dimensional is that there are *eight* such blocks
sharing their pieces — 8 × 27 = 216 sticker slots over 81 cubies — and that turning one rearranges the
others.

Which rescues §11's conclusion rather than confirming it. The 3D cube is not a poor teacher of the
grip taxonomy; it is a *complete* teacher of one cell of it:

> In four dimensions each of the eight cells is a Rubik's cube in its own right, and a twist turns
> one of them. In three dimensions there is only one such block — the whole puzzle. That is why a
> corner click reorients the entire cube here and turns a single cell there. It is the same move; the
> 3D puzzle just has nothing else to be.

So the corner and edge clicks are not degenerate in 3D after all. They are the honest 3D shadow of the
4D move, and the lesson is the sentence above.
