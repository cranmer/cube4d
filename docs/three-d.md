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

## 5. Picking: the heuristic does not transfer

In 4D you never choose a grip directly. You click a sticker, and the program infers which of the many
grips on that cell you meant, from the piece's *type*: a 4-colour corner implies a rotation about a
vertex, a 3-colour edge piece about an edge, a 2-colour face piece about a face. Concretely
`gripDim = nDims − colours`, then the nearest grip on that cell with that dimension wins.

**On a 3D cube that rule makes the puzzle almost unclickable.** Work it through:

| Piece | Colours | `3 − colours` | Wants an axis at a… |
|---|---|---|---|
| corner | 3 | 0 | vertex — *not generated* |
| edge | 2 | 1 | edge — *not generated* |
| face centre | 1 | 2 | face ✅ |

Only the single centre sticker of each face would resolve to an axis. Every other click would do
nothing.

The fix is not to generate the missing axes — see §3 — but to notice that **the heuristic exists to
solve a problem 3D does not have.** It is there because a 4D cell carries 27 grips and a click has to
choose between them. A 3D puzzle has exactly one axis per face, so there is nothing to disambiguate,
and the rule collapses to:

> **Turn the face the clicked sticker belongs to.**

Which is how every 3D cube interface has ever worked, and needs no explaining to anyone.

This is a `nDims === 3` branch in `gripForPick`, and it also sidesteps a hazard: the 4D path first
tests `is2x2x2Cell`, which compares squared distances against the hardcoded constants `0.75` and
`1.5` with a tolerance of `0.1`. Those numbers describe a 2×2×2 *cell of a 4D puzzle*; whether some
3D puzzle at some edge length happens to satisfy them is not a question worth leaving open.

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
| Exporter emitting 3D entries | ⚠️ blocked — see §8. Behind `--include-3d`, off by default |
| Twist permutations proven bijective in TS | ⬜ |
| Renderer: pad to `w = 0`, disable the cull | ⬜ |
| `gripForPick`: face-of-sticker rule for 3D | ⬜ |
| Drag: keep to the 3D planes | ⬜ |
| The app itself, with a slice-count choice | ⬜ |
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

The fix is to stop sharing: give each 3D sticker its own copy of the vertices it uses, and compute the
decomposition per copy from absolute positions. Twenty-four quads becomes 96 vertices instead of 26 —
irrelevant at these sizes, and it restores the invariant the format is built on rather than weakening
it. That expansion is the next piece of work.
