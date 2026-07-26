# Architecture options for a modern MagicCube4D

This document lays out the design choices for rewriting [MagicCube4D](https://superliminal.com/cube/)
as a web application, with the trade-offs for each. It is meant to be read before the implementation
plan — it explains *why* the recommended architecture is what it is.

Every claim about the original is grounded in the Java source in `magiccube4d/` (registered here as
a submodule); file and line references are given so anything can be re-checked.

---

## 1. What actually makes this port hard

Not the UI. Not the 4D math. The hard part is one specific thing:

> **A puzzle's geometry is *computed*, not hard-coded, by a 7,000-line n-dimensional CSG library —
> and every saved solve in existence refers to that geometry by array index.**

MagicCube4D does not know what a hypercube is in any special-cased way. It takes a Schläfli product
symbol (`{4,3,3}`, `{5,3,3}`, `{5}x{4}`, …) plus an edge length, constructs the corresponding regular
polytope, slices it with hyperplanes, and derives stickers, cubies, and twist axes from the resulting
cell complex. That generality is the whole point of the program — it's why there are "dozens of other
beautiful 4D puzzles" and not just one.

Three consequences drive everything below:

1. **The geometry engine is big and subtle.** `com/donhatchsw/util/CSG.java` is 7,257 lines, and
   `PolytopePuzzleDescription.java` is another 1,446. Numerically it is held together by tuned magic
   constants with an explicit "edit with caution" warning in the source
   (`PolytopePuzzleDescription.java:194-198`): `SLICE_MULTIPLIER = 0.99999`,
   `SLICE_MULTIPLIER_SIMPLEX = 0.995`, `SLIVER_VOLUME_PERCENT = 15`. These exist because the slicer
   throws an exception if a vertex lands exactly on a cut plane, so cuts are deliberately nudged
   off-center, producing sliver stickers that are then culled by volume.

2. **Grip indices are a wire format.** A move in a `.log` file is stored as
   `<gripIndex>,<direction>,<slicemask>`. The grip index is a position in an array that is generated
   at load time by iterating the polytope's element lattice. Reorder that iteration by one and every
   `.log` file ever saved becomes meaningless. There is no symbolic move notation to fall back on.

3. **There is a latent bug you must either reproduce or avoid.** At
   `PolytopePuzzleDescription.java:454` and `:478`, the local `length` variable is reassigned
   (`length = ceilLength`) *inside* the per-face cut loop. Once any face trips a special case
   (simplex, tetrahedral prism, triangular-prism face, uniform triangular duoprism, or a prism face),
   `length` stays clobbered for every subsequent face. For fractional edge lengths the resulting cut
   layout therefore depends on face iteration order. Any reimplementation has to replicate this
   bug-for-bug to stay compatible.

Everything else — the render pipeline, undo/redo, the file formats, the UI — is comparatively
mechanical.

---

## 2. Where should the geometry engine live?

This is the central decision. Four viable answers.

### Option A — Port the CSG kernel to TypeScript

Reimplement the boundary-representation polytope structure, `getAllElements`/`getAllIncidences`,
`makeHypercube`/`makeRegularPolygon`/`cross`, `sliceFacets`, `orientDeep`, volume computation via
simplicial subdivision, `calcRotationGroupOrder`, and `PolyFromPolytope`. Ship the hard-coded
dodecahedron and 120-cell vertex tables (~2,800 lines of literal data inside `CSG.java`) as JSON.

**Pros**
- Fully self-contained: no build-time artifacts, no generated assets to keep in sync.
- Preserves "Invent my own!" — any Schläfli symbol works at runtime.
- The repo is *just* a TypeScript project; one language, one toolchain.
- Intellectually the most satisfying, and the most interesting thing to blog about.

**Cons**
- Roughly 3,000–4,000 lines of the subtlest code in the project, where "subtle" means
  floating-point-epsilon-dependent computational geometry.
- The magic constants and the `length`-mutation bug must be reproduced exactly, or generated
  geometry silently diverges.
- **Divergence is silent and catastrophic.** A grip ordering that's off by one produces a puzzle that
  looks perfect and twists correctly, but reads every existing `.log` file wrong. You would not
  notice without a golden-data test suite — which you'd have to build from the Java anyway.
- Puzzle load stays slow. The Java re-runs the full slice pipeline on every load; `{5,3,3}` is capped
  at length 3 specifically because of this cost, and the app shows a four-phase progress bar during
  construction.
- Longest path to anything demoable.

### Option B — Precompute the geometry from the Java at build time ✅ recommended

Add a small exporter to the *existing* Java code that runs `PolytopePuzzleDescription` for every
catalog puzzle and dumps exactly what the runtime needs into binary assets. The web app then ships no
CSG at all.

The enabling discovery: **after construction, `PolytopePuzzleDescription` touches the CSG polytope
object in exactly five places, and all five only read an integer** (`nDims`, `nFaces`, `nStickers`).
Every other method — `applyTwistToState`, `computeStickerVertsPartiallyTwisted`, `getClosestGrip`,
`getClosestNicePointToRotateToCenter`, `getNumColorsForCubie`, `getNumSlicesForGrip` — reads only
precomputed arrays. The runtime needs the *arrays*, not the *engine*.

What that leaves for TypeScript is genuinely small. A twist is:

```
for each sticker whose centre is in the slice mask:
    rotate its centre by the twist matrix
    look the result up in a fuzzy spatial hash to find the destination slot
```

That's about 40 lines. Partial-twist animation geometry is another 25.

**Pros**
- Deletes the single hardest part of the project.
- **Legacy compatibility is free and exact.** Grip indices come from the same Java code that produced
  every `.log` file in the world. This is not "carefully matched" — it is literally the same
  computation.
- Puzzle loads become a download plus a zero-copy typed-array view, instead of a multi-second slice
  pipeline. `{5,3,3}` becomes pleasant to use rather than something you wait for.
- The asset is also a gift to the community: a clean, documented, language-neutral description of
  every MC4D puzzle that anyone can build on.
- Fastest path to a working demo by a wide margin.

**Cons**
- Requires a JDK at build time (once, in CI — not for users, not for most contributors).
- Ships static assets: ~40 KB gzipped for the default puzzle, ~1.4 MB for the largest, 10–20 MB for
  the full 128-entry catalog, lazy-loaded per puzzle.
- **Loses runtime "Invent my own!"** — arbitrary Schläfli symbols can't be constructed in the browser.
- The generated assets become a compatibility surface: regenerating them with a different JDK or a
  modified exporter could silently reorder grips. Needs hash pinning in CI.

**Mitigations for the one real loss.** Ship the entire 128-entry catalog so the gap is narrow, and
expose the exporter as a documented CLI plus drag-and-drop side-loading of custom asset files (~50
lines). A user who wants `{3}x{7} 4` can generate it and drop it in. Option A then remains available
later as a pure enhancement — port the CSG into a Web Worker whenever it's fun to do so — rather than
as a blocking dependency.

### Option C — Compile the Java engine to WebAssembly

Run the existing `CSG.java` unmodified via [TeaVM](https://teavm.org/) (Java → wasm/JS ahead of time)
or [CheerpJ](https://cheerpj.com/) (a full JVM in wasm).

**Pros**
- No reimplementation and no divergence risk — it *is* the original code.
- Keeps arbitrary Schläfli symbols at runtime.
- CheerpJ could in principle run the entire Swing app in a browser tab today, with zero porting.

**Cons**
- CheerpJ ships a whole JVM: multi-megabyte download, and you'd be shipping the Swing UI you were
  trying to replace. It solves "runs in a browser" but not "modern web app," and none of the outreach
  or teaching goals are served by an emulated 2005 desktop UI.
- TeaVM is the more surgical choice, but you'd be maintaining a Java toolchain, a TS toolchain, and
  the marshalling layer between them, forever, for one module.
- Debugging across the JS/Java boundary is genuinely unpleasant.
- Passing megabytes of geometry across the boundary on every puzzle load is awkward and slow.
- Option B gets the same "it's the original code" guarantee without any of this, by moving the Java
  to build time instead of run time.

**Verdict:** the right tool when you need the original code *at runtime*. Here you don't — you need
its *output*, which is static per puzzle.

### Option D — Client-server with a Java backend

Keep the Java engine on a server; a REST endpoint returns puzzle geometry as JSON. The browser
handles rendering and interaction.

**Pros**
- Zero porting of the hard part.
- Arbitrary Schläfli symbols work — the server can construct anything on demand.
- Opens the door to server-side solve verification, accounts, and leaderboards.
- Geometry is computed once per puzzle and cached for all users.

**Cons**
- **Kills the zero-install, zero-ops goal outright.** You'd be running and paying for a JVM service
  indefinitely; the project dies the day you stop.
- Offline use is impossible; a flaky connection means an unusable puzzle.
- Cold starts on a scale-to-zero host are seconds — worse than local computation.
- It's the *same data* the build-time exporter produces, just delivered at higher cost and lower
  reliability. Option B is strictly a static-CDN version of this option.

**Verdict:** the only reason to choose this is if geometry had to be computed per-request from
unbounded user input. It doesn't — the catalog is 128 entries and closed. Note that a records or
leaderboard API later is a *completely separate* concern and does not require this; it would be a
small stateless service that never touches geometry.

### Summary

| | Legacy compat | Runtime custom puzzles | Load speed | Ops burden | Lines to write | Risk |
|---|---|---|---|---|---|---|
| **A** TS port | Risky, silent failure mode | ✅ | Slow | None | ~4,000 hard | High |
| **B** Precompute ✅ | **Exact, by construction** | Build-time only | **Instant** | None | ~65 easy | Low |
| **C** Wasm | Exact | ✅ | Medium | None | Glue + 2 toolchains | Medium |
| **D** Server | Exact | ✅ | Network-bound | **Ongoing** | Glue + a service | Low tech, high lifecycle |

**Recommendation: B**, with A kept open as an optional later enhancement.

---

## 3. Client-side vs client-server, more broadly

Setting geometry aside, does anything else in this app want a server?

| Feature | Needs a server? |
|---|---|
| Playing, twisting, rotating, undo/redo | No |
| Saving and loading solves | No — File API + IndexedDB |
| Sharing a puzzle state with someone | No — URL fragment encoding |
| Legacy `.log` / `.macros` conversion | No — runs fine in the browser or as a CLI |
| Personal solve statistics | No — IndexedDB |
| **Public leaderboard / Hall of Fame** | Yes |
| **Verified solve records (anti-cheat)** | Yes |
| **Real-time shared/multiplayer sessions** | Yes |

The first six cover the entire v1 scope, so v1 ships as static files on GitHub Pages: no hosting
cost, no maintenance, no downtime, and it keeps working if the project goes quiet for a year. That
last property matters a lot for an outreach artifact you intend to link to from blog posts.

**One design decision now buys the option of the last three later.** Legacy MC4D scrambles with an
unseeded `Math.random()`, so a scramble is unreproducible and a claimed solve is unverifiable — which
is exactly why the existing Hall of Fame runs on the honor system. Using a **seeded PRNG** and
recording the seed in the save file means a future service can re-derive the scramble, replay the
submitted moves, and verify a solve server-side without trusting the client. It costs nothing to do
now and cannot be retrofitted onto solves recorded without it.

Beyond that, the requirement is just discipline: keep the puzzle core free of DOM and rendering
dependencies so it runs unchanged in Node, and keep the save document a plain serializable object.
A records API then becomes a small stateless service that accepts a save document and never touches
geometry.

---

## 4. Rendering approach

The original is a **software renderer**: it projects 4D → 3D → 2D on the CPU and calls
`java.awt.Graphics.fillPolygon` on integer pixel coordinates. No z-buffer, no 3D API, no
transparency (`PipelineUtils.java:760-851`).

### Option 1 — Port the software renderer to Canvas 2D

Transliterate the 12-stage pipeline and draw with `ctx.fill()` on `Path2D`.

**Pros:** highest possible visual fidelity — pixel-comparable to the Java. Simplest port; the code
maps line for line. No shader debugging. Works everywhere.

**Cons:** all `nVerts` positions recomputed on the CPU every frame — the Java does this even at rest.
For `{5,3,3} 3` that's ~68,000 vertices per frame plus a full polygon sort, in JavaScript. Painter's
algorithm also produces real artifacts on interpenetrating stickers, which the source comments
acknowledge. And it forecloses the visual features most valuable for teaching (transparency, smooth
shading, depth cues).

### Option 2 — WebGL via Three.js, with the pipeline in shaders ✅ recommended

Per-vertex attributes carry only the vertex's offset from its sticker centre plus a sticker id;
per-sticker and per-face data live in a float texture indexed by that id. The shrink, the 4D
rotation, the 4D → 3D projection, and the front-cell cull all run in the vertex shader.

**Pros**
- Per-frame CPU work drops to uploading ~40 floats of uniforms. Rotation and twist animation become
  free regardless of puzzle size.
- A real depth buffer fixes the painter's-algorithm artifacts.
- Unlocks the teaching features: transparency/"ghost mode", smooth shading, outlines, depth cues,
  arbitrary post-processing.
- Scales to the largest puzzles without special-casing.

**Cons**
- Requires WebGL2 (~98% of browsers). Feature-detect and show a clear message rather than a black
  canvas; don't attempt a WebGL1 fallback.
- Shader debugging is harder than stepping through TypeScript.
- Reproducing Java's *exact* look requires care — flat per-polygon Lambert with no ambient term, and
  its specific `.brighter().brighter()` highlight.

A CPU mirror of the shader is worth keeping in the repo regardless: it's what gets compared against
Java-generated golden frames in tests, and it's a readable reference for the blog posts.

### A specific sub-decision: painter's algorithm or a real depth buffer?

Worth spelling out, because it looks riskier than it is. The concern: the image involves *two*
perspective projections (4D → 3D, then 3D → 2D), so is standard depth testing even meaningful?

Yes. After the 4D → 3D projection you are holding honest 3D geometry — a set of nested convex solids.
The 4D step is a per-vertex nonlinear displacement, and everything after it is an ordinary 3D scene.
In fact Java's own sort key, `eyeZ - v.z` retained at `PipelineUtils.java:369`, *is* camera-space
depth for a pinhole camera at `(0, 0, eyeZ)` — stages 9 and 11 together are exactly a standard
perspective projection. A depth buffer computes per-pixel what Java approximates per-polygon.

Two caveats, both manageable: coplanar cell faces would z-fight at `faceShrink = 1` (MC4D's default
is 0.4, and the slider can be clamped just below 1), and a depth buffer forbids naive alpha blending
— which matters only when transparency is added, at which point per-sticker depth sorting is cheap
enough to enable just for that mode.

**Recommendation:** real depth buffer, with a painter's-mode toggle retained for like-for-like
parity testing against the Java.

### And picking

The original does 2D point-in-polygon in final screen pixels, walking its sorted draw list front to
back (`PipelineUtils.java:526-567`). If the projection moves to the GPU, the CPU no longer has the
projected geometry, so that approach would force a redundant CPU vertex pipeline.

**Recommendation: a GPU colour-ID pass** — render sticker and polygon ids to an off-screen target
with the same vertex shader, then read back a single pixel at the cursor. Same cull, same depth test,
same triangles, so what's visible is exactly what's picked. This is strictly more accurate than the
original and eliminates a class of bugs. Grip resolution then proceeds on the CPU in rest-space 4D
coordinates exactly as the Java does.

---

## 5. Save file format

The legacy `.log` format is a 6-field header, the 4×4 view matrix, a `*` sentinel, and a
space-separated token stream of `grip,direction,slicemask` moves and `m<char>` marks, terminated by
`.` (`History.java:567-592`).

| | Legacy-only | JSON-only | **JSON native + converter** ✅ |
|---|---|---|---|
| Interop with desktop MC4D | ✅ | ✗ | ✅ |
| Hall-of-Fame submissions | ✅ | ✗ | ✅ |
| Extensible (metadata, seeds, timing) | ✗ | ✅ | ✅ |
| Readable/diffable/tool-friendly | Barely | ✅ | ✅ |
| Implementation cost | Parser + exact-match writer | Trivial | Both, but cleanly separated |

The chosen approach — JSON as the native format with a standalone bidirectional converter — is also
the cleanest structurally: the converter is a pure function with no dependency on the app, so it
ships as both an in-app import/export path and a `mc4d-convert` CLI from a single implementation.

Two legacy behaviours are worth *not* reproducing in the core:

- **`append()` silently cancels an immediately-inverse move** (`History.java:254-272`) — typing a
  move and immediately undoing it erases both, destroying the redo stack and making the twist counter
  non-monotonic. It never affects what's written to a file, so dropping it costs no interop.
- **`saveAs()` truncates the redo stack before writing** (`MC4DSwing.java:228`) — saving silently
  discards your redo history, in memory *and* on disk. This is not a format limitation: the legacy
  grammar already supports a mid-list current position via the `c ` marker
  (`History.java:573` and `:619`), the Java simply chose not to use it.

One genuine asymmetry remains and can't be designed away: Java's *reader* applies the
inverse-cancellation, so a byte-faithful parser will disagree with Java's in-memory list on any log
containing adjacent inverse pairs. The converter parses faithfully and emits a warning rather than
silently matching or silently diverging.

The `.macros` codec is worth shipping in v1 even though the macro *UI* is deferred — it's ~150 lines,
and it means nobody's existing macro library is stranded.

---

## 6. Frontend framework

Largely a matter of taste; the 4D math and the rendering layer are identical in all cases, and both
live outside the framework anyway. **React + TypeScript** was chosen for ecosystem size and
contributor familiarity, with `react-three-fiber` for the canvas and Zustand for state.

The one framework-specific constraint worth recording: **large typed arrays must never go into
reactive state.** Puzzle state is an `Int32Array` mutated in place with a version counter that
components subscribe to. Structural sharing on a 7,560-element array at 60 Hz would be a performance
disaster, and it's an easy mistake to make with an immutable-by-default store.

---

## 7. What gets dropped, and why

- **`NdSolve.java`** (7,047 lines) — a real solver for n^d cubes by Don Hatch, but **completely
  orphaned**: no references anywhere outside itself, its menu item commented out
  (`MC4DSwing.java:825`), and its hotkey registration commented out (`:792`). It only handles 2^d and
  3^d cubes, so it could never be the general "Solve" button for a 128-puzzle catalog, and it has not
  been a shipping feature for years. The user-visible "Solve (Cheat)" — animated undo-all — is a few
  lines and is what people actually use.
- **`LinearProgramming.java`** (1,793 lines), **`Triangulator.java`** (1,222), `TriangulationOptimizer`,
  `Minimizer` — not on the puzzle path at all. Roughly 10,000 lines of the original are unreachable
  from the puzzle model.
- **The applet entry point** — vestigial, and hardcodes `{4,3,3}` regardless of its own parameters.

---

## Decisions

| Question | Answer |
|---|---|
| Geometry engine | **Precompute from the Java at build time**; port the CSG later only if it's fun |
| Server | **None.** Static site — but seed the scramble so records can be verified later |
| Renderer | **WebGL/Three.js** with the pipeline in shaders, real depth buffer, GPU colour-ID picking |
| Save format | **JSON native**, with a bidirectional `.log`/`.macros` converter as a shared module + CLI |
| Framework | **React + TypeScript**, with all puzzle logic outside it and testable in Node |
| Auto-solver | **Dropped** |

---

## Attribution

MagicCube4D was created by Melinda Green, Don Hatch, Jay Berkenbilt, and Roice Nelson. The original
is at <https://superliminal.com/cube/> and is licensed permissively, with attribution requested. This
project is a derivative work and carries that attribution forward.
