# Polish backlog

Known rough edges and deferred design work. Each is understood; none blocks the next phase.

---

## Controls and layout

**Done.** Navigation (undo, redo, reset view) is now at the top; scramble and reset moved to the
very end of the panel, since both discard a solve and sat one click from Undo; and layer selection
became on-screen toggles, generated from the puzzle's own layer count so a 2⁴ gets two and a 4⁴
gets four. The 1–9 keys still work and the toggles show their state, which fixes the
discoverability problem at the same time.

Still open: reset could confirm when a long solve is in progress.

---

## Touch and mobile

**The original was never designed for touch**, and three of its core inputs have no touch
equivalent. This is not a porting problem to work around; it is a design gap the original never had
to face, and it needs answering on its own terms.

| Desktop input | What it does | Touch has no… |
|---|---|---|
| ~~Hold 1–9~~ | Choose which layers turn | *solved: on-screen toggles* |
| ~~Pinch~~ | — | *added: zoom* |
| ~~Right-click~~ | Twist the other way | *solved: direction toggle* |
| Shift + drag | Rotate in 4D rather than 3D | modifier key — *deliberately unaddressed* |
| Hover | Highlight the piece under the cursor | cursor |

### Slice selection

**Done** — toggles generated from the puzzle's layer count, unioned with the number keys.

### Twist direction

**Done** — a two-segment toggle below the layer buttons. Right-click still means "the other way",
relative to whichever segment is chosen, so the two never fight.

Note on the icons: the obvious characters (⟲ ⟳ ↺ ↻) are missing from enough system fonts to render
as a dot, so they are drawn as SVG. A filled arrowhead also read as a speck at 16px; an arc running
into a right-angled tail, at the same stroke weight, is legible at any size.

### 4D rotation

**Decided: no gesture.** Two-finger drag was the obvious candidate, but it collides with pinch,
and pinch is the natural gesture for zoom — which is now what it does. If 4D rotation is wanted on
touch later it should be an explicit mode toggle rather than a hidden gesture, since a mode you can
see beats one you have to be told about.

Note the consequence: without it, a touch user cannot bring the hidden cell to the front. Reset view
returns to a known orientation, so nothing is unrecoverable, but the fourth dimension is only
directly explorable with a keyboard.

### Hover

Touch has no hover, so the highlight has to fold into the tap: highlight on touch-down, twist on
release, cancel if the finger moves — which is already how the click/drag distinction works. That
gives a moment of feedback showing which piece is about to turn, arguably better than the desktop
behaviour.

### Layout

Panel sections now collapse, and their state is remembered, which shortens the panel considerably —
by default only Move, Layers, Direction, Puzzle and Start over are open. Collapsed sections show a
badge with their current value, so folding one away loses no information.

Still open for mobile: under 720px the panel stacks below the canvas and eats nearly half the
screen. It probably wants the canvas full-bleed with the play controls — layers, direction, undo —
pinned within thumb reach rather than in a scrolling panel.

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

The icon is the default view, which means separated cells and so not much ink at small sizes. It
reads better since the background went dark, but if it still looks faint in a real tab, either
nudge face shrink up for the icon only, or keep the default view for large sizes and use tighter
framing for 16/32.

### More palettes

Three ship today. Worth considering: a light-background theme, and per-cell colour editing for
people who solve by colour association and have their own conventions. The original reads an
optional `facecolors.txt`, so there is precedent for user-supplied palettes.

---

## Housekeeping

### Dev-dependency advisories

`npm audit` reports several in Vite's transitive tree. None ships to users, but they should be
cleared or explicitly waived.

### Visual regression tests

Screenshots have caught four bugs that unit tests could not, but they are still driven by hand. The
Playwright scripts in `tools/screenshot/` should become a committed suite with baseline images, as
the plan's testing section describes.
