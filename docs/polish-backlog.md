# Polish backlog

Known rough edges and deferred design work. Each is understood; none blocks the next phase.

---

## Controls and layout

### Separate destructive actions from navigation

**Scramble** and **Reset** currently sit directly above **Undo** and **Redo** in one "Play" group.
They are different kinds of action and should not be adjacent: undo and redo step through history
and are always safe, while scramble and reset throw the current solve away. Putting them a click
apart invites the mistake where someone reaching for Undo hits Reset and loses a long solve.

Proposed: undo/redo and the twist counter as a navigation cluster near the puzzle; scramble and
reset in a separate group, with reset confirming when a solve is in progress.

### Reset view belongs at the top

It sits at the bottom of the View group, below four sliders. It is the control people reach for
when they have rotated themselves into confusion — exactly when they should not have to hunt for
it. Move it to the top of that group, or beside the canvas.

### The number keys are invisible

Holding 1–9 to choose which layers turn is the least discoverable thing in the app. It is
documented in a help list nobody reads, and there is no visual affordance until a key is already
held. An on-screen slice selector fixes this for everyone, not only for touch — see below.

---

## Touch and mobile

**The original was never designed for touch**, and three of its core inputs have no touch
equivalent. This is not a porting problem to work around; it is a design gap the original never had
to face, and it needs answering on its own terms.

| Desktop input | What it does | Touch has no… |
|---|---|---|
| Hold 1–9 | Choose which layers turn | keyboard |
| Right-click | Twist the other way | second button |
| Shift + drag | Rotate in 4D rather than 3D | modifier key |
| Hover | Highlight the piece under the cursor | cursor |

### Slice selection

A row of toggle chips — `1 2 3` for a length-3 puzzle, as many as the puzzle has layers — that
multi-select, mirroring what holding several number keys does. Generated from `numSlicesForGrip`
so it is right for every puzzle in the catalog rather than hardcoded to three. Keyboard shortcuts
keep working, and the chips make them discoverable by showing their state.

### Twist direction

Options, roughly in order of preference:

1. A direction toggle beside the slice chips (⟲ / ⟳) — explicit and always visible.
2. Two-finger tap for the reverse direction — fast, but discoverable only if taught.
3. Long-press for reverse — conflicts with OS text-selection gestures on some platforms.

The toggle is the safe choice, and it also gives desktop users an alternative to remembering that
right-click reverses.

### 4D rotation

The hardest one, because it is the app's whole point. Options:

1. **Two-finger drag** rotates in 4D while one finger rotates in 3D. Natural, needs no chrome, and
   parallels the desktop modifier — but collides with pinch-to-zoom, so zoom would have to move to
   a slider or be inferred only from a pure pinch.
2. **A mode toggle** (3D ⇄ 4D) beside the view controls. Unambiguous, at the cost of a mode the
   user must remember they are in.
3. **Both** — the toggle as the discoverable path, the gesture as the fast one.

Worth prototyping before choosing. Whatever it is, the UI should say which rotation you are about
to perform, because "the rotation with no 3D analogue" is precisely what a newcomer cannot guess.

### Hover

Touch has no hover, so the highlight has to fold into the tap: highlight on touch-down, twist on
release, cancel if the finger moves — which is already how the click/drag distinction works. That
gives a moment of feedback showing which piece is about to turn, arguably better than the desktop
behaviour.

### Layout

The two-column grid collapses to a stacked layout under 720px, but the panel then eats nearly half
the screen. A mobile layout probably wants the canvas full-bleed with controls in a collapsible
sheet, and the play controls — slice chips, direction, undo — pinned within thumb reach rather than
in a scrolling panel.

---

## Rendering

### Opacity jumps between 100% and 99%

The transition is discontinuous rather than gradual. At full opacity the material writes depth; at
anything below it stops, so a single step off 1.0 flips the whole puzzle from solid to see-through
in one go.

That flip is necessary — a translucent surface writing depth would hide what is behind it, which is
the one thing transparency exists to prevent — but it does not have to be *abrupt*. Options: keep
depth writes until a lower threshold and let opacity ramp first, snap the slider to 1.0 near the
top, or use weighted-blended order-independent transparency and drop the toggle entirely.

### Bundle size

622 KB (169 KB gzipped), nearly all Three.js. Worth trimming with a custom build or by importing
only the modules actually used — the renderer touches a small fraction of the library.

### Favicon at 16 and 32 pixels

The icon is the default view, which means separated cells and so not much ink at small sizes. If it
reads faint in a real tab, either nudge face shrink up for the icon only, or keep the default view
for large sizes and use tighter framing for 16/32.

---

## Housekeeping

### Dev-dependency advisories

`npm audit` reports several in Vite's transitive tree. None ships to users, but they should be
cleared or explicitly waived.

### Visual regression tests

Screenshots have caught four bugs that unit tests could not, but they are still driven by hand. The
Playwright scripts in `tools/screenshot/` should become a committed suite with baseline images, as
the plan's testing section describes.
