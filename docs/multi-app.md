# Many apps, one engine

This document works through how to host several different front-ends on the same puzzle
infrastructure — a "classic" app matching what ships today, plus variations with different layouts,
different interaction models, and eventually a layout designed specifically around the hypercube.

The motivating worry is a real one: **piling every feature into a single app produces a UI that
serves nobody well.** Canonical-view buttons, multiple simultaneous viewports and a hypercube-specific
layout are not features the classic app is missing. They are different answers to "what is this for",
and forcing them to coexist in one panel would compromise all of them.

The good news is that the split this requires is largely already present, because the port was built
in layers for unrelated reasons. This document says what is genuinely reusable, what is not, and what
each of the proposed apps actually costs.

Written after `v0.6.0`, which is the revert point if the restructuring goes badly.

---

## 1. What is already reusable, measured

Not estimated — this is the current tree.

| Layer | Lines | DOM? | React? | Layout? | Reusable as-is |
|---|---|---|---|---|---|
| `@mc4d/puzzle-core` | ~1,400 | no | no | no | ✅ already shared |
| `@mc4d/legacy-format` | ~700 | no | no | no | ✅ already shared |
| `@mc4d/render` | ~1,200 | yes | no | no | ✅ already shared |
| `usePuzzle.ts` | 595 | no | yes | **no** | ✅ headless — renders nothing |
| `usePuzzleCanvas.ts` | 402 | yes | yes | **no** | ⚠️ headless, but assumes one canvas |
| `persist.ts`, `autosave.ts`, `examples.ts` | 373 | yes | no | no | ✅ |
| `Section.tsx`, `PuzzlePicker.tsx` | 167 | yes | yes | partly | ✅ as components |
| `App.tsx` | 792 | yes | yes | **yes** | ❌ this *is* the classic layout |

Roughly three quarters of the front-end code is already independent of the layout. That is not an
accident of good taste; it fell out of two earlier decisions:

- **The renderer never knew about React.** `PuzzleRenderer` is a class with an imperative surface
  (`setPuzzle`, `setRotation`, `beginTwist`, `pick`) because WebGL state and React reconciliation are
  a bad pairing. That means a second app can drive it without inheriting any of the first app's
  component tree.
- **Session logic went into a hook, not a component.** `usePuzzleSession` owns twist animation,
  history, scramble, solve detection and playback, and returns `{ session, actions }`. It has no
  opinion about where a button lives. A different app calls the same hook and draws a different
  panel.

So the question is not "can this be reused" but "what are the three or four places where a
single-app assumption is baked in".

---

## 2. Where the single-app assumptions actually are

### 2.1 One canvas, one renderer

`usePuzzleCanvas` bundles two unrelated concerns:

```
usePuzzleCanvas(assetBase, initial, handlers) → {
  catalog, geometry, loading, error, selectPuzzle,   // per-app: which puzzle are we playing
  canvasRef, getRenderer, getRotation, setRotation,  // per-viewport: one canvas, one camera
  controls, setControls, resetView,                  // per-viewport: shrink, opacity, palette
}
```

For one viewport these coincide, so bundling them cost nothing and saved a layer. For N viewports
they diverge sharply: you want *one* geometry shared by *N* cameras.

### 2.2 The session broadcasts to exactly one view

`usePuzzleSession(renderer: () => PuzzleRenderer | null, geometry)` calls `view.beginTwist(...)`,
`view.setTwistMatrix(...)` and `view.setHighlight(...)` on a single renderer as a twist animates.

Note the asymmetry that matters for the fix: **state changes are broadcast, but picking is not.**
A twist should animate in every viewport. A click happens in exactly one, under one camera, and
must be picked against that camera only. So these two groups of calls have to be separated rather
than uniformly generalised.

### 2.3 Storage keys are global by convention

Four unnamespaced keys:

| Key | Written by | Should be |
|---|---|---|
| `mc4d.session` | `autosave.ts` | **per app** — apps have different notions of a session |
| `mc4d.sections` | `Section.tsx` | **per app** — section ids only mean something within a layout |
| `mc4d.palette` | `usePuzzleCanvas.ts` | **shared** — a taste, and partly an accessibility need |
| `mc4d.playbackSpeed` | `usePuzzle.ts` | **shared** — a preference about pace, not about layout |

Two apps on one origin share localStorage. Left alone, opening the hypercube app would silently
overwrite the classic app's autosaved solve. This is the cheapest thing on the list to fix and the
most annoying to discover later.

### 2.4 Nothing else

Permalinks (`persist.ts`) encode puzzle id and moves, which is app-independent. The asset pipeline,
the catalog, the legacy codec and the examples are all already neutral.

---

## 3. Options for the shared layer

### Option A — One app with modes

Keep a single bundle; switch layouts behind a mode toggle or a route.

**For:** no restructuring at all, one thing to deploy, impossible for the apps to drift apart.

**Against:** this is precisely the outcome the exercise exists to avoid. Every app's UI code loads
for every visitor, the panel accumulates controls that only make sense in one mode, and "does this
button apply here" becomes a question the code has to answer at runtime in dozens of places. The
complexity does not go away; it moves into conditionals.

### Option B — Separate repos or separate deployments

Each app its own package, its own build, its own URL, depending on published versions of the core.

**For:** total isolation; an app can go stale without endangering the others.

**Against:** version skew becomes real work — a fix in `usePuzzle` has to be published and adopted
three times. Cross-app links break the same-origin sharing of palette and permalinks. And for a
project of this size it is ceremony without a beneficiary.

### Option C — One repo, one build, several HTML entries ✅ recommended

A shared `@mc4d/shell` package holding everything layout-free, plus one small app package per
front-end, built as a Vite multi-page application with a static landing page.

```
packages/
  puzzle-core/      pure
  legacy-format/    pure
  render/           canvas + WebGL, no React
  shell/            ← new: headless hooks, persistence, shared components
apps/
  classic/          ← today's App.tsx, essentially unchanged
  hypercube/        ← later
  index.html        ← landing page
```

**For:**

- **One deploy, one origin.** Palette, playback speed and permalinks are shared naturally; the
  landing page can link between apps without a round trip.
- **Three.js is downloaded once.** This is the decisive practical point. Vite emits shared
  dependencies as a common chunk, so three apps do not cost 3 × 622 KB. A visitor who tries two apps
  pays for the second one's *layout* only.
- **A fix lands everywhere at once.** `usePuzzleSession` is imported, not vendored.
- **Apps can be genuinely different.** Nothing forces the hypercube app to have a panel at all.

**Against:**

- A shared package acquires gravity: it is tempting to push app-specific logic into it because that
  is where the plumbing lives. The discipline is that `@mc4d/shell` may not know which app is using
  it — no `if (app === 'classic')`, ever.
- Three shells means three things that can rot. The mitigation is that the classic app stays the
  reference implementation and the visual-regression suite covers all of them (see §6).

**Not chosen but noted:** a route-based SPA with one HTML entry and lazy-loaded layouts. It gets the
same shared-chunk benefit and adds client-side navigation between apps, at the cost of a router and
of every app sharing one document lifecycle. Worth reconsidering only if the apps end up wanting to
hand state to one another live.

---

## 4. The apps, and what each actually costs

### 4.1 Classic — free

`App.tsx` moves to `apps/classic/` and imports from `@mc4d/shell`. No behaviour change; this is the
step that proves the seam without risking anything.

### 4.2 Canonical views and keybindings — small, and shared rather than app-specific

Cycling between named orientations instead of free-dragging is arguably a *better default* for a
newcomer: a free trackball in 4D is easy to get lost in, and a small set of known-good viewpoints is
easy to reason about.

**Done**, and it cost more than the "small" in this heading promised — the interesting part is why.

The estimate assumed the animation was free, because `rotation.ts` already had `rotateTowards`, an
incremental slerp between two *vectors*. It turned out to be unused by the app (ctrl-click centring
was specified in Phase 3 and never landed), and more to the point it solves a different problem:
gliding the camera means interpolating a *rotation*, not carrying one vector to another.

Two cheap schemes were tried and both failed on the same case. Blending the two matrices and
re-orthonormalising cannot reverse a row, because Gram-Schmidt fixes lengths and not signs — the
view silently sticks. Stepping along the antisymmetric part of the relative rotation, which is
exactly what the drag integrator does and is excellent for small increments, recovers `sin θ` times
each plane's generator, and `sin θ` vanishes at θ = π as surely as at θ = 0. Half-turns are not a
corner case here: six of the eight axis-aligned viewpoints differ from the default by a rotation
containing one.

The tool that works is peculiar to four dimensions. Every 4D rotation factors as `v ↦ L·v·R` for a
pair of unit quaternions, so interpolating one is just slerping two quaternions — exact at both
ends, constant angular speed between, no singularity anywhere. That is `so4.ts`, about 100 lines
with 13 tests, and it is genuinely reusable: any app that wants to move a camera in 4D wants it.

A second control turned out to be needed alongside them, and it produced the same shape of mistake
one level up. The default view is good *because* it is oblique — seven of the eight cells visible,
nothing hidden — and it is one of four equally good corners. "Rotate the camera 90° about the
screen's vertical axis" is the obvious way to reach the other three, and it gives a **degenerate**
picture: the view's up direction is not the direction of the top cell, so a rotation about the
screen axis destroys the obliqueness rather than preserving it. What is wanted is a symmetry of the
arrangement — a rotation about the axis through the top and bottom *cells*, applied to the puzzle
before the view rather than to the camera after it. Which plane that is gets read off the view
matrix itself, whose rows are the images of the puzzle's axes, so the control composes with every
viewpoint instead of being special-cased per viewpoint. And because it fixes the W axis, the centred
cell never changes: "which cell is in the middle" and "which corner am I looking from" stay
independent questions with independent controls.

The viewpoints themselves are puzzle-independent, as expected — orientations of 4-space, so the
same key means the same rotation on every puzzle. For the hypercube, whose eight cell centres *are*
the eight signed axes, each one also brings a specific cell to the centre, which is the case that
matters. Deriving them per puzzle from cell centres remains the only way to make them meaningful for
the duoprisms, and remains unbuilt.

### 4.3 Multiple simultaneous viewports — the one real refactor ✅ built

Split `usePuzzleCanvas` along the seam identified in §2.1:

```
usePuzzleAsset(assetBase, initial)   → catalog, geometry, loading, selectPuzzle   // one per app
useViewport(geometry)                → canvasRef, renderer, rotation, controls    // N per app
```

Then change the session's contract so that state changes broadcast and picking does not:

```
usePuzzleSession(views: () => PuzzleRenderer[], geometry)
  actions.onClick(view, x, y, button)    // picking is per-viewport, by necessity
  actions.onPointerMove(view, x, y)
```

Cost, as built: roughly what was estimated, and no change to `puzzle-core` or `@mc4d/render`. The
one thing the estimate missed is that the viewpoint *controls* had to change too. The eight +X…−W
buttons are per-pane by nature, and three panes' worth of them would take more room than the puzzle,
so the panes carry only Turn, Tip and Flip — which is exactly why Flip had to exist first. There is
deliberately no "active pane": a pane is operated by the buttons underneath it, which needs no
state, no focus ring and no explaining.

Two facts that make this cheaper than it looks, and one that limits it:

- `geometryCache` is already module-level, so N viewports on the same puzzle share one copy of the
  megabytes of typed arrays rather than N copies.
- Each viewport gets its own `ViewControls`, which is what makes the feature interesting — one pane
  at full opacity, another transparent; one at the default face shrink, another exploded.
- **Each viewport is a separate WebGL context, and browsers cap those at roughly 8–16 per page.**
  Two to four panes are comfortable. A grid of sixteen is not. If many small views are ever wanted,
  that is one context with scissored viewports and a different rendering loop — deliberately *not*
  built in advance, since the two designs have nothing in common and only one of them is likely to
  be needed.

### 4.4 A hypercube-specific layout — a new phase, not a refactor

A layout designed around `{4,3,3}` specifically, still supporting any number of slices, is a new
app on the same hooks. It needs nothing from this document beyond the extraction in §4.1 — and
possibly viewports from §4.3, depending on the design.

It is scoped separately and specified separately, because unlike the others it is a design question
before it is an engineering one.

### 4.5 A 3D app — teaching the interface on a shape people already know

The move set here is unlike a Rubik's cube's. There is no R, U or F; there are grips at cells,
faces, edges and vertices, and which one a click means is inferred from how many colours the piece
carries. That is learnable, but it has to be learned *and* the fourth dimension has to be learned at
the same time. A 3D app would let someone learn the interface first, on a shape whose solved state
they can already picture.

**The engine turns out to be most of the way there, which was not the expectation.** Measured, not
estimated — `{4,3} 3` built with the stock, unmodified engine:

```
{4,3} 3   nDims=3  polytope.dim=3  cubies=26  stickers=54
{5,3} 3   nDims=3  polytope.dim=3  cubies=62  stickers=132     (a megaminx)
```

26 cubies and 54 stickers is exactly an ordinary Rubik's cube. Polytope construction, hyperplane
slicing, cubie derivation and sticker generation are all genuinely dimension-generic and work in 3D
today with no changes at all.

**What is missing is one `if`.** At `PolytopePuzzleDescription.java:844`, grip generation is wrapped
in `if(nDims == 4)`, above a comment in which the author starts to handle 3D, notices the cell/facet
analogy does not transfer, and leaves a note saying so.

The right analogue turns out to fit the existing code exactly. In 4D a twist rotates a *cell* about
one of its sub-elements; in 3D it rotates the *whole polytope* about one of its sub-elements — and
`calcRotationGroupOrder(p, cell3d, subCell, mat)` requires `cell3d.dim == 3`, which the whole 3D
polytope satisfies. Called that way it returns:

```
{4,3} 3   vert(8)={order 3}   edge(12)={order 2}   face(6)={order 4}
{5,3} 3   vert(20)={order 3}  edge(30)={order 2}   face(12)={order 5}
```

Those six face grips of order 4 are exactly R, L, U, D, F and B. The order-3 vertex and order-2 edge
grips are the corner and edge twists that make the pedagogical point: the same lattice of grips the
4D puzzle has, on a shape that needs no explaining.

**Costs, by piece:**

| Piece | Status |
|---|---|
| Polytope, slicing, cubies, stickers | ✅ works now, unchanged |
| Grip generation for `nDims == 3` | ~60 lines in `tools/exporter`, *not* in the submodule — the machinery it calls is proven correct |
| `.mc4dpz`, `puzzle-core`, `twist.ts` | ✅ already carry `nDims` and use it generically; no hardcoded 4 |
| Renderer | ⚠️ the only genuinely 4D-specific piece — `vec4` throughout, `uRot4d`, the eye-on-W projection, and the front-cell cull that produces the cube-within-a-cube. A 3D variant skips the 4D→3D stage and the cull |
| Legacy `.log` compatibility | **Not required** — no 3D logs exist |

That last row is worth dwelling on. Everywhere else in this project, grip ordering is a wire format
that every saved solve depends on. In 3D there are no saved solves, so the ordering is a free choice
made for clarity rather than a constraint inherited from 2005.

Two caveats. `grip2face` assumes each grip belongs to one face, and a slicemask means "layers
measured from that face" — true for face grips, not for vertex or edge grips, so the honest first
version is face grips only, which is the standard cube move set anyway. And `{3,3}` (tetrahedron)
and `{3,4}` (octahedron) both fail inside the CSG for reasons unrelated to any of this — an
orientation assertion and an unimplemented Schläfli case — so the 3D family is cubes and dodecahedra,
not everything.

**Risk is concentrated in the renderer, not the geometry**, which is the reverse of what one would
fear from a codebase whose hard part has always been the geometry.

### 4.6 Landing page

Static HTML listing the apps with a screenshot and a sentence each. No framework; it exists to be
instant and to make the choice legible. It is also the honest place to say what this project is,
which the classic app's panel currently has to do in three lines.

---

## 5. Sequencing

Deliberately ordered so that each step is verifiable before the next begins.

1. **Extract `@mc4d/shell`; move `App.tsx` to `apps/classic`; multi-page build; landing page.**
   No new features, no behaviour change. Success is the full test suite and the screenshot scripts
   agreeing that nothing moved.
2. **Namespace the storage keys** (§2.3), while there is still only one app and so nothing to
   migrate.
3. **Canonical views + keybindings**, in the shared layer. First feature genuinely used by more than
   one front-end.
4. **Viewports**, alongside whichever app motivates them.
5. **The hypercube app**, once specified.
6. **The 3D app**, whose only unknown is the renderer.

Steps 1 and 2 are the ones with revert risk, and `v0.6.0` is the revert point.

Steps 1–4 are done: the shell is split, storage is namespaced, the view controls exist, and the
multi-view app ships at `/multi/`. A gallery of the catalog was added along the way, at `/gallery/`,
which was not on this list.

---

## 6. What this changes elsewhere

**The visual-regression suite gets promoted from nice-to-have to load-bearing.** The screenshot
scripts in `tools/screenshot/` have caught four bugs that the unit tests could not, and they are
still driven by hand against one app. With three shells sharing hooks, a refactor in `@mc4d/shell`
can break an app nobody was looking at. Committed baselines per app are the cheapest defence.

**Bundle size stops being one number.** Splitting into shared chunks makes the current 622 KB
(169 KB gzipped, nearly all Three.js) more visible and more worth trimming, since it is now the
common cost of *every* app rather than the price of one.

**Two Phase 6 items are consciously deprioritised.** Mobile layout was the largest remaining item;
in practice the collapsible panel and touch toggles made the mobile experience good enough that a
dedicated mobile shell is no longer motivated. The opacity discontinuity between 100% and 99% is
understood, documented in `polish-backlog.md`, and not worth the order-independent-transparency
machinery it would take to fix properly.
