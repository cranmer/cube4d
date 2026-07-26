# cube4d

A modern, browser-based rewrite of [MagicCube4D](https://superliminal.com/cube/) — a fully
functional four-dimensional Rubik's cube, plus dozens of other 4D twisty puzzles.

The original is an excellent piece of software that requires a Java installation to run. This is a
zero-install version: open a link, solve a hypercube.

> **Status: early development.** Nothing is playable yet. See
> [`docs/architecture-options.md`](docs/architecture-options.md) for the design rationale.

## What this is

MagicCube4D doesn't hard-code the hypercube. It takes a Schläfli product symbol — `{4,3,3}` for the
3×3×3×3 hypercube, `{5,3,3}` for the "hypermegaminx", `{5}x{4}` for a pentagonal duoprism — builds
the corresponding regular 4D polytope, slices it with hyperplanes, and derives the stickers, pieces,
and twist axes from the resulting cell complex. That generality is the point, and this rewrite keeps
it.

The 3×3×3×3 hypercube has roughly 1.76 × 10<sup>120</sup> reachable states, against 4.3 × 10<sup>19</sup>
for the ordinary Rubik's cube.

## Design in one paragraph

The 4D geometry engine is not reimplemented. Instead, a build-time exporter runs the original Java
code and dumps each puzzle's geometry to a compact binary asset; the web app loads those assets and
does the ~65 lines of arithmetic that actually constitute a twist. This makes puzzle loads instant,
removes the riskiest 4,000 lines from the port, and — because twist axes are identified by array
index in MagicCube4D's save files — guarantees that solve logs remain byte-compatible with the
desktop application. The renderer puts the whole 4D→3D→2D projection pipeline into vertex shaders.
Full reasoning, including the options not taken, is in
[`docs/architecture-options.md`](docs/architecture-options.md).

## Layout

```
magiccube4d/        the original Java, as a git submodule (read-only reference + build input)
docs/               design documents
fixtures/           golden test data generated from the Java
tools/exporter/     Java: turns puzzles into binary assets and golden fixtures
packages/
  puzzle-core/      pure TypeScript puzzle model — no DOM, no rendering, runs in Node
  legacy-format/    .log / .macros codec and the mc4d-convert CLI
  render/           Three.js renderer
  app/              React application (the deployable)
```

Clone with submodules:

```sh
git clone --recurse-submodules <this repo>
```

## Credits

MagicCube4D is by **Melinda Green**, **Don Hatch**, Jay Berkenbilt, and Roice Nelson —
<https://superliminal.com/cube/>. The n-dimensional CSG library that makes the puzzle generation
possible is Don Hatch's work. This project is a derivative work; see [LICENSE](LICENSE).
