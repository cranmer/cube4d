# Implementation plan

Companion to [`architecture-options.md`](architecture-options.md) (why this architecture) and
[`legacy-internals.md`](legacy-internals.md) (how the original works). Progress is tracked in
[`porting-log.md`](porting-log.md).

## Goal

A zero-install browser version of [MagicCube4D](https://superliminal.com/cube/): the full puzzle
catalog, 4D/3D rotation, twisting, undo/redo, scramble, solve detection, and save/load — as a static
site anyone can open from a link.

Constraints, decided up front:

- **React + TypeScript + Three.js** (Vite, react-three-fiber, Zustand).
- **Pure client-side static site.** No server, but state stays cleanly serializable so a records or
  leaderboard API could be added later without restructuring.
- **JSON is the native save format**, with a separate bidirectional converter for the legacy `.log`
  and `.macros` formats, usable both in-app and as a CLI.
- Macros UI, the auto-solver, audio, and full preferences breadth are explicitly out of v1.

## Architecture in brief

The 4D geometry engine is not reimplemented. A build-time exporter runs the original Java and dumps
each puzzle's geometry to a compact binary asset; the web app loads those assets and performs the
~65 lines of arithmetic that actually constitute a twist and its animation. Reasoning, and the three
options not taken, are in [`architecture-options.md`](architecture-options.md).

```
cube4d/
├─ magiccube4d/        the original Java, as a git submodule (reference + build input)
├─ docs/               design documents and the porting log
├─ fixtures/           golden test data generated from the Java
├─ tools/exporter/     Java: puzzles → binary assets and golden fixtures
└─ packages/
   ├─ puzzle-core/     pure TypeScript puzzle model — no DOM, no rendering, runs in Node
   ├─ legacy-format/   .log / .macros codec and the mc4d-convert CLI
   ├─ render/          Three.js renderer
   └─ app/             React application (the deployable)
```

### Asset format

One binary file per (puzzle, length), `.mc4dpz`: magic header, JSON block table, then 8-byte-aligned
typed-array blocks. Decoding is `fetch` → `ArrayBuffer` → zero-copy typed-array views. Served
pre-gzipped, decompressed with `DecompressionStream`, decoded in a Worker, cached in `CacheStorage`.
JSON-of-numbers is not viable — the largest puzzle would be ~30 MB of text.

Two lossless size wins, both confirmed at `PolytopePuzzleDescription.java:806-822`:

- Of the three shrink arrays, `vertStickerCentersMinusFaceCenters` and `vertFaceCenters` are
  **per-sticker and per-face aliases**, not independent per-vertex data. Storing them at their true
  cardinality cuts the dominant term ~3×.
- In 4D there is no vertex sharing between stickers, so each sticker owns a contiguous vertex range
  and polygon indices fit in `uint8` (verified: max range across the whole catalog is 200).

### Precision

`FuzzyPointHashTable` uses **absolute** epsilons (1e-9 / 1e-8), and the largest circumradius in the
catalog is 31.87 — so the tolerance is 3.1e-10 relative, about 380× finer than float32 resolves.
`stickerCenters`, `gripUsefulMats`, `faceInwardNormals`, and `faceCutOffsets` **must be Float64**.
Render-path data stays Float32, where it is bit-exact with the Java (which already narrows to
`float`) rather than an approximation.

### Rendering

Per-vertex attributes carry only the vertex's offset from its sticker centre plus a sticker id;
per-sticker and per-face data live in a float texture indexed by that id. The shrink, the 4D
rotation, the 4D→3D projection, and the front-cell cull all run in the vertex shader, so per-frame
CPU work is uploading ~40 floats.

- **Front-cell cull in the shader.** Every vertex of a sticker computes the same triple product from
  the same four witness vertices, so the sticker vanishes coherently.
- **Real depth buffer**, not painter's algorithm — the original's own sort key is already
  camera-space depth, so stages 9+11 *are* a standard perspective projection. Keep a painter's-mode
  toggle for like-for-like parity testing.
- **GPU colour-ID picking**, not raycasting — the CPU has no copy of the 4D-warped geometry. Same
  shader, same cull, same depth test, so what's visible is exactly what's picked.
- **Time-based animation** replacing frame counting, keeping the same `(sin((x−0.5)π)+1)/2` easing.

### State

Large typed arrays never go in reactive state. Geometry lives in a module-level map keyed by puzzle
id; the store holds `puzzleId` plus version counters. Puzzle state is an `Int32Array` mutated in
place with a version bump.

History becomes an immutable move list plus an index, replacing the linked list:

```ts
type Move = { g: number; d: 1 | -1; s: number };   // grip, direction, slicemask
type History = { moves: readonly Move[]; marks: readonly Mark[]; index: number };
```

The save document records puzzle id, `assetsVersion` (pinning the grip-index generation), scramble
state, **scramble seed and algorithm**, tuple-encoded moves, marks, index, view matrix, an optional
hashed state cache, and metadata.

Two deliberate departures from the original, both explained in
[`quirks-and-bugs.md`](quirks-and-bugs.md): the inverse-move cancellation on append and the
truncate-on-save are dropped from the core. Neither is a format constraint.

The seeded scramble is the one forward-looking addition: the original uses `Math.random()`, so
scrambles are unreproducible and solves unverifiable — which is why the existing Hall of Fame runs
on the honor system. Recording a seed means a future service could re-derive the scramble and verify
a solve without trusting the client. It costs nothing now and cannot be retrofitted later.

## Phases

| Phase | Scope | Status |
|---|---|---|
| **0** | Measure and freeze the catalog | ✅ **done** — see [`phase0-results.md`](phase0-results.md) |
| **1** | Exporter + asset format | ✅ **done** — all 2,912 permutations match the Java |
| **2** | Headless core | ✅ **done** — all 8 real solve logs replay to solved |
| **3** | Renderer, static | ✅ **done** — renders and rotates in a browser |
| **4** | Interaction | ✅ **done** — scramble and solve in the browser |
| **5** | Catalog + persistence | ✅ **done** — all 128 puzzles, save/load/share, autosave |
| **6** | Several apps on one engine | next — see [`multi-app.md`](multi-app.md) |
| **7** | A hypercube-specific app | not yet specified |
| **8** | 3D puzzles on the same engine | scoped — see [`multi-app.md`](multi-app.md) §4.5 |

**Phase 0 — Measure and freeze.** Build every catalog entry, record element counts and exact asset
sizes, identify anything too large or broken to ship, and acquire a corpus of real `.log` files.
*Done when* the counts reference and size table are committed and the shipped-catalog decision is
made. **Result: all 128 entries build, nothing dropped.**

**Phase 1 — Exporter + asset format.** `tools/exporter` emits `.mc4dpz` + `manifest.json`;
`@mc4d/puzzle-core` decodes it. *Done when* Node loads `{4,3,3} 3` reporting 216 stickers and 216
grips, and TS `applyTwist` reproduces Java-generated golden permutations bit-identically for all 216
grips × 2 directions × all slicemasks.

**Phase 2 — Headless core.** History, scramble, solve detection, rotation math, legacy codec. *Done
when* property tests pass, a real community `.log` replays to solved, and
`mc4d-convert a.log → a.json → b.log` round-trips byte-identically.

**Phase 3 — Renderer, static.** `{4,3,3} 3` at rest, deployed. *Done when* the cube-within-a-cube
look is right, shrink sliders work, and all three drag modes rotate with momentum plus ctrl-click
slerp-to-centre. **No twisting yet** — deliberately the first shareable artifact.

**Phase 4 — Interaction.** GPU picking, hover highlight, click-to-twist, number-key slicemask,
undo/redo, twist counter, scramble, solve detection. *Done when* `{4,3,3} 2` is solvable end to end.

**Phase 5 — Catalog + persistence.** Full picker with piece counts and sizes, lazy loading, JSON
save/load, drag-and-drop legacy import/export, autosave, shareable permalinks, core preferences.

The view controls, the colour-to-axis correspondence and what each rotation does are documented
separately in [`view-controls.md`](view-controls.md), which also records the UI experiments still
in flight.

**Phase 6 — Several apps on one engine.** Extract everything layout-free into `@mc4d/shell`, move
today's UI to `apps/classic`, and build the workspace as a multi-page site behind a landing page —
so that alternative front-ends are separate apps rather than more controls in one panel. Then
canonical view orientations with keyboard bindings, and multiple simultaneous viewports. The
trade-offs are worked through in [`multi-app.md`](multi-app.md). *Done when* the classic app is
byte-for-byte the same experience served from `apps/classic`, and a second front-end exists that
shares its session logic without sharing its layout.

Also in this phase, and independent of it: a guided "what is 4D" tour, and a compatibility page
documenting the grip-index guarantee.

Two earlier Phase 6 candidates were dropped deliberately. A **dedicated mobile layout** is no longer
motivated — the collapsible panel, the layer toggles and the direction toggle made the existing
responsive layout good enough in practice. The **opacity discontinuity** at 100% is understood and
documented, and not worth the order-independent transparency it would take to fix properly.

**Phase 7 — A hypercube-specific app.** A layout designed around `{4,3,3}` rather than around the
general catalog, still supporting any number of slices. Scoped separately because it is a design
question before it is an engineering one.

**Phase 8 — 3D puzzles.** An ordinary Rubik's cube and a megaminx on the same engine, so that a
newcomer can learn this interface — grips at faces, edges and vertices, chosen by how many colours
the clicked piece carries — on a shape whose solved state they can already picture, before adding a
fourth dimension to the problem. Measured, not assumed: the geometry already builds correctly in 3D
today, 26 cubies and 54 stickers for `{4,3} 3`, and the rotation-group machinery returns exactly the
six order-4 face turns that are R, L, U, D, F and B. What is missing is grip *generation*, blocked by
a single `if(nDims == 4)`, plus a 3D variant of the vertex shader. *Done when* a 3D cube is solvable
in the browser and its twists satisfy the same property tests every 4D puzzle does.

## Testing

Golden artifacts generated from the Java side:

1. `counts.ref` — element counts for all 128 entries. ✅ done in Phase 0.
2. `perm/<id>.bin` — the sticker permutation for each `(grip, direction, slicemask)`, from the real
   `applyTwistToState`. **The single most valuable fixture** — it validates the fuzzy hash port, the
   twist matrix, the slicemask logic, and the grip ordering simultaneously.
3. `frame/<id>_<case>.json` — pipeline snapshots for fixed view parameters, compared against a CPU
   mirror of the shader.
4. `pick/<id>.json` — the Java's pick results over a screen grid, pinning the known-imperfect
   `getClosestGrip` heuristic as behaviour rather than accident.
5. `logs/*.log` — a real community corpus with Java-computed final state hashes. **The only
   unreproducible artifact.**

Property tests, over every shipped puzzle:

- Applying a grip of order *k* exactly *k* times = identity.
- `(g,d,m)` then `(g,−d,m)` = identity.
- Every twist permutation is a **bijection** — the fuzzy-hash canary. A single float32 leak into the
  twist path fails this immediately, naming the puzzle and grip.
- Scramble then reversed inverses ⇒ solved.
- `sticker2face` as a multiset is invariant under any twist.
- Legacy and JSON round-trips.

Visual regression via Playwright with a fixed canvas and manually stepped animation — once in
painter's mode against Java-rendered PNGs, once in depth-buffer mode against its own baselines. Plus
a GPU-vs-CPU parity test closing the loop Java ↔ CPU ↔ GPU.

## Risks

1. ~~**Asset sizes are estimated, not measured.**~~ Retired by Phase 0.
2. **Float32 in the twist path** silently breaks twisting on large-coordinate puzzles. Mitigated by
   Float64 for the four critical arrays plus the bijection property test.
3. **Asset regeneration drift** — an exporter or JDK change silently reorders grips and invalidates
   every existing save. Mitigated by a sha256 per asset in a committed manifest, CI failing on any
   hash change without an explicit `assetsVersion` bump, and a pinned JDK. Grip indices are a wire
   format now; treat any change as breaking.
4. **Legacy log fidelity beyond grip indices** — `countTwists()` semantics, `c `-marker placement,
   ten-tokens-per-line wrapping, pretty-vs-raw length strings. Mitigated by byte-exact round-trip
   tests over a real corpus.
5. **`getClosestGrip` is known-imperfect upstream.** v1 inherits the behaviour exactly and pins it in
   fixtures. See [`quirks-and-bugs.md`](quirks-and-bugs.md).
6. **Solo-project attrition** — Phase 3 is deliberately scoped to produce a public, shareable
   rotating 4D polytope before any twisting logic is wired up.
