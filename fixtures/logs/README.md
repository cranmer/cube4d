# Real MagicCube4D log files

Solve logs collected from the [MagicCube4D Hall of Fame](https://superliminal.com/cube/halloffame.htm),
where they are published for download so anyone can open them in MagicCube4D and step through the
solution.

They are here as **test fixtures**: the `.log` codec has to round-trip real files byte-for-byte, and
real files contain variations no synthetic test would think to produce. This is the one fixture in
the project that cannot be regenerated — everything else comes out of the exporter.

Each file is someone's solve, in some cases a world record. Credit belongs to the named solvers; see
the Hall of Fame for the full context and for records not published as files.

## What the corpus turned out to contain

Downloading all 19 linked files and reading their headers produced a more interesting picture than
expected.

| | Count | Openable by MagicCube4D 4.3? |
|---|---|---|
| Log format **version 3** | 10 | yes |
| Log format **version 1** | 6 | **no** |
| Headerless move list | 1 | no |
| A *different program's* format | 1 | no |
| Dead link (served a 404 page) | 1 | — |

**About half of the publicly linked Hall of Fame solve logs cannot be opened by the current
MagicCube4D.** The loader requires a 6-field header and rejects any version but 3
(`MC4DSwing.java:1209` and `:1214`). Among the casualties is `roice_4x4x4x4-2581.log`, Roice Nelson's
4⁴ solve.

Supporting version 1 would let this project open solves the original no longer can. That is a real
opportunity, and a reason the corpus was worth collecting before writing the codec rather than after.

## The formats

### Version 3 — current

```
MagicCube4D 3 3 191 {4,3,3} 3     magic, version, scrambleState, twistCount, schlafli, length
0.0181969971807 -0.883088133564 ...   4 rows of the 4D view matrix
...
*                                 sentinel
194,-1,1 181,-1,4 151,1,4 ... .   moves: grip,direction,slicemask   marks: m<char>
```

### Version 1 — a different format entirely

```
MagicCube4D 1 0 20                magic, version, scrambleState, twistCount — no puzzle identified
07707007                          the puzzle STATE, as a grid of colour digits
61161661
...
214 214 114 114 314:2 ... .       moves in an older notation: <3-digit id>[:<direction>]
```

Version 1 stores the position directly rather than a view matrix, does not record which puzzle it
is, and encodes moves as a three-digit id with an optional `:direction` suffix (`:-1`, `:2` — the
latter apparently a double twist, matching the commented-out "Experimental control to allow double
twists" in `MC4DView.java`). Its marks use a different vocabulary too (`mc`, `mi` rather than
version 3's `m|`, `m[`, `m]`, `mS`).

Supporting it is a separate piece of work, not a parser tweak.

## Things these files taught us that the source didn't

- **Line endings are mixed.** 13 of 18 are CRLF, 5 are LF — the original writes
  `System.getProperty("line.separator")`, so a file reflects whichever OS the solver used. A
  byte-exact round-trip must *preserve* the file's line ending rather than normalise it.
- **View matrices use Java's scientific notation.** Values like `-2.925836087297376E-9` and
  `4.379940093404794E-16` appear throughout. `parseFloat` handles them, but a hand-rolled numeric
  parser would not.
- **The `c ` current-position marker does occur in the wild** — in version 1 files, which were
  written before saving truncated the redo tail. No version 3 file in this corpus contains one,
  which matches the prediction from reading `MC4DSwing.saveAs`.
- **Puzzles referenced** by the version 3 files: `{4,3,3}` at lengths 2, 3, and 5 — the 2⁴, 3⁴ and
  5⁴ cubes.

## Files

| File | Format | Notes |
|---|---|---|
| `charles-3x3x3x3-191.log` | v3 | Charles Doan — shortest 3⁴ solution, 191 twists |
| `andrew-luna_3x3x3x3-comp-assist.log` | v3 | Andrew Luna — computer-assisted 3⁴ |
| `sebastian-3x3x3x3-bld.log` | v3 | Sebastian — 3⁴ blindfolded |
| `daniel-2x2x2x2-46.log` | v3 | Daniel — 2⁴ in 46 twists |
| `anderson-2x2x2x2-computer-24.log` | v3 | Anderson — computer-assisted 2⁴ |
| `liu-2x2x2x2-bld.log`, `matt_2x2x2x2_blind.log` | v3 | 2⁴ blindfolded |
| `andrey-5x5x5x5-1981.log` | v3 | Andrey Astrelin — 5⁴ in 1981 twists |
| `3checkerboard-14-luna.log`, `5checkerboard-26-luna.log` | v3 | checkerboard patterns |
| `roice_4x4x4x4-2581.log` | v1 | Roice Nelson — 4⁴ solve |
| `eric_5x5x5x5_solution.log` | v1 | Eric — 5⁴ solve |
| `2checkerboard-20.log`, `3checkerboard.log`, `5checkerboard-44.log`, `first_2.log` | v1 | patterns and early solves |
| `don-4checkshort-20.log` | headerless | Don Hatch — a bare move list, no header at all |
| `nan_2x2x2x2_blind.log` | not MC4D | a Magic Puzzle Ultimate file; kept as a rejection test |

Retrieved 2026-07-27. `4checkerboard-08.log` is linked from the Hall of Fame but the link is dead,
so it is not included.
