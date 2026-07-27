# Polish backlog

Known rough edges, deferred deliberately. Each is understood; none blocks the next phase.

## Opacity jumps between 100% and 99%

The transition is discontinuous rather than gradual. At full opacity the material writes depth; at
anything below it stops, so a single step off 1.0 flips the whole puzzle from solid to see-through
in one go.

That flip is necessary — a translucent surface writing depth would hide what is behind it, which is
the one thing transparency exists to prevent — but it does not have to be *abrupt*. Options: keep
depth writes until a lower threshold and let opacity ramp first, snap the slider to 1.0 near the
top, or use weighted-blended order-independent transparency and drop the toggle entirely.

## Bundle size

622 KB (169 KB gzipped), nearly all Three.js. Worth trimming with a custom build or by importing
only the modules actually used — the renderer touches a small fraction of the library.

## UI and layout

The current panel is functional rather than designed. Worth revisiting: control grouping, an
alternate layout that gives the puzzle more room, mobile ergonomics.

## Dev-dependency advisories

`npm audit` reports several in Vite's transitive tree. None ships to users, but they should be
cleared or explicitly waived.
