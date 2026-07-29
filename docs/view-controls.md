# The view: cells, colours, and the controls that move between them

Reference for the viewpoint controls, written while experimenting with how they should be laid out.
Everything here is measured from the shipped assets and the shipped palettes, not inferred — the
face centres come from `fixtures/assets/4-3-3_3.mc4dpz` and the colours from
`assignFaceColors` in `packages/render/src/colors.ts`.

---

## 1. Which colour is which axis

The hypercube's eight cells sit at the eight signed coordinate axes. Face indices in the asset are
ordered negatives-then-positives, and `assignFaceColors` groups them into opposite pairs in face
order, so the correspondence is fixed and total:

| Face | Centre | Axis | Vivid | Distinct | Classic |
|---|---|---|---|---|---|
| 0 | `(0,0,0,−1)` | **−e3** | purple | rose | purple |
| 7 | `(0,0,0,+1)` | **+e3** | pink | blue | pink |
| 1 | `(0,0,−1,0)` | **−e2** | yellow | yellow | yellow |
| 6 | `(0,0,+1,0)` | **+e2** | white | white | white |
| 2 | `(0,−1,0,0)` | **−e1** | green | green | green |
| 5 | `(0,+1,0,0)` | **+e1** | blue | sky | blue |
| 3 | `(−1,0,0,0)` | **−e0** | orange | amber | orange |
| 4 | `(+1,0,0,0)` | **+e0** | red | vermilion | red |

The **pairing** is what is stable: `±e3`, `±e2`, `±e1`, `±e0` are always four opposite pairs in that
order, so switching palettes never moves a colour to a different axis pair. Only the specific hues
change. This is why the palettes were built as four pairs in a fixed role order rather than as eight
independent colours — a cuber's memory depends on white being across from yellow, not on the exact
white.

---

## 2. What "centred" means

The renderer puts the 4D eye on the **+W** axis and projects with

```
xyz * eyeW / (eyeW − w)          eyeW = 1.05 by default
```

So a cell's `w` after the view rotation decides everything about how it reads:

| `w` after rotation | Distance from the eye | What you see |
|---|---|---|
| **+1** | 0.05 — almost touching | Culled. The front-cell cull removes it so you can see inside |
| **0** | 1.05 | The ring of cells around the middle |
| **−1** | 2.05 — farthest | Projects smallest: **the little cell in the middle** |

"Bringing a cell to the centre" therefore means rotating it onto **−W**. Its opposite necessarily
lands on +W and becomes the invisible one. That is why every viewpoint hides exactly one cell, and
why the hidden cell is always the partner of the centred one.

---

## 3. The default view

`NICE_VIEW`, from the original, orthonormalised. Its rows are the images of the puzzle's axes:

```
e0 → ( 0.732, −0.196,  0.653, 0)      ring
e1 → ( 0.681,  0.187, −0.707, 0)      ring
e2 → ( 0.016,  0.963,  0.270, 0)      up
e3 → ( 0,      0,      0,     1)      at the viewer
```

Note the last row and column are both `(0,0,0,1)`: **`NICE_VIEW` leaves W alone**, so it is a pure
rotation of the 3D part. That fact is load-bearing twice over — it is what lets the same obliqueness
be composed onto every other viewpoint, and it is why the default view centres `−e3`.

On screen:

```
                  white  +e2
                   (top)

     orange −e0                  blue  +e1
      (upper left)              (upper right)

                 purple  −e3
                  (middle)          pink +e3 is culled — it is
                                    between you and everything else
     green  −e1                   red   +e0
     (lower left)                (lower right)

                  yellow −e2
                  (bottom)
```

The two ring pairs sit on the two diagonals: `±e0` on upper-left/lower-right, `±e1` on
lower-left/upper-right.

**The view is oblique on purpose.** Nothing is seen face-on, so seven of the eight cells are visible
at once with nothing hidden behind anything. Every control below preserves that obliqueness; that is
most of what makes them feel like views of one object rather than eight unrelated pictures.

---

## 4. The eight named viewpoints

Each is a signed permutation bringing one axis to −W, composed with the default view's obliqueness so
it is seen from the same corner.

| Button | Centres | Vivid colour in the middle | Then hidden |
|---|---|---|---|
| +X | +e0 | red | orange |
| +Y | +e1 | blue | green |
| +Z | +e2 | white | yellow |
| +W | +e3 | pink | purple |
| −X | −e0 | orange | red |
| −Y | −e1 | green | blue |
| −Z | −e2 | yellow | white |
| −W | −e3 | purple | pink |

**They used to be called Right/Left/Up/Down/Front/Back/Ana/Kata, and that was wrong.** The names
read well but described screen directions, which the buttons do not control. The view is
deliberately oblique, so no puzzle axis points at the top of the screen: "Front" was the button that
centred the cell you saw *above* everything else, and "Up" centred one at the upper right. An axis
name cannot mislead that way. It also stays honest on the puzzles where the correspondence to cells
breaks down entirely — on a duoprism or the 120-cell, `+X` is still a perfectly good direction, it
just does not name a cell.

*Ana* and *kata*, Hinton's 1880s words for the two directions perpendicular to length, width and
height alike, survive in the tooltips for `+W` and `−W`. They are worth teaching, but they are not
what a button should say.

**There is no separate "default" entry.** The opening view already centres −e3, so `−W` *is* the
default; a ninth button would have done nothing.

---

## 5. Turn — spin the ring

`quarterTurn`, bound to `,` and `.`

A quarter turn about the axis through the top and bottom **cells**. The four ring cells cycle; the
top, bottom, centre and hidden cells stay exactly where they are.

From the default view, one clockwise turn:

```
upper-left    orange → green → red    → blue   → orange
upper-right   blue   → orange → green → red    → blue
```

**Invariants** (all tested):

- Four presses return exactly to the start, from any viewpoint.
- The W column of the view matrix is untouched, so **which cell is centred never changes** — and
  neither does which cell is hidden.
- Determinant stays +1: a rotation, never a reflection, so the puzzle never mirrors.

Implementation note: this is *not* a rotation of the camera about the screen's vertical axis. That
was the first attempt and it produces a flattened, degenerate picture, because the view's up
direction is not the direction of the top cell. It is a rotation of the puzzle, applied before the
view rather than after it, about the axis through the top and bottom cells.

---

## 6. Tip — change what is in the middle

`tipView`, bound to `;` and `'`

The complement of Turn. A three-cycle of axes, with no sign changes at all:

```
 a ring axis   →  faces the viewer     its far cell becomes the centre
 the viewer axis →  becomes vertical   the hidden cell rises to the top
 the vertical axis →  joins the ring   the top and bottom pair splay out
 the other ring axis            unchanged
```

From the opening view this is exactly the **−W → −Y** transition:

```
e1 → e3      green swings in and becomes the centre
e3 → e2      pink rises from hidden to the top
e2 → e1      white and yellow drop into the ring
e0 → e0      orange and red do not move
                             ... and blue takes over as the hidden cell
```

**Invariants** (all tested):

- Three presses return exactly to the start, from any viewpoint — it is a three-cycle, not a swap.
- Which cell is centred **always** changes, where Turn's never does. The two controls are exactly
  complementary.

Which of the two ring axes takes part is the one pointing away from the viewer in 3D. That is what
makes Turn and Tip compose: spin the ring to choose a cell, then tip to bring it in.

---

## 7. What Turn and Tip can and cannot reach

Measured by generating the group, not argued:

> Turn and Tip together generate exactly **48 orientations** — a quarter of the 4-cube's 192
> rotations — and every one of them centres a **negative** axis. Only `−W`, `−X`, `−Y` and `−Z` are
> reachable. **`+X`, `+Y`, `+Z` and `+W` are not.**

The reason is structural. Turn fixes W, so it cannot change the middle at all. Tip changes it, but
is a pure axis cycle with no sign flips. Neither can ever *reverse* a direction, so the four positive
cells are out of reach no matter how they are combined.

A third control would fix it, and it only has to do one thing: **reverse the viewer axis**, swapping
the centred cell for its opposite and the hidden cell for the one in the middle. That is a half-turn
in a plane containing W — a genuine two-state toggle, since doing it twice returns you home.

With that added, the three controls reach all eight: Tip chooses which axis pair is in the middle,
the flip chooses which end of that pair, and Turn chooses the corner you view it from.

---

## 8. Open UI questions

Recorded rather than settled — these are the experiments in flight.

**An eight-way "what do you want in the middle?" picker versus three motion controls.** The picker is
direct: one press gets you anywhere, and it makes the eight-ness of the puzzle visible. The motion
controls are smaller, teach the *relationships* between viewpoints rather than just listing them, and
degrade gracefully to a puzzle with a different number of cells — the named viewpoints are specific to
`{4,3,3}`, whereas Turn and Tip read their axes off the view matrix and work anywhere. They are not
exclusive; the picker is a shortcut and the motions are a way to explore.

**Naming.** *Settled:* the buttons name axes (see §4). The alternative was to name them by the
colour brought to the middle, which is how people actually talk about the puzzle — but that moves
with the palette, and only works on the hypercube.

**Where the controls live.** Turn and Tip are currently duplicated as an overlay in the bottom
corners of the viewport as well as in the panel, to find out whether motion controls want to be near
the thing they move.

**The axis inset.** A 96px compass in the top-right, toggleable, showing where the four axes
currently point. Three decisions inside it are worth knowing.

An axis pointing at you is **not drawn at all** — that is the one the front-cell cull removes, so a
label there would name a cell you cannot see. It fades out as the axis swings towards you rather
than popping, and at a named viewpoint exactly one of the eight is gone. Note which one: at the `+X`
viewpoint it is **−X** that vanishes, because `+X` is the cell brought to the middle and its
opposite is the one hidden between you and everything else.

Its W axis is projected *orthographically* rather than in perspective: the renderer divides by `eyeW − w`, which for an axis
aimed straight at the eye magnifies by twenty and would fling the spoke off the edge, whereas
dropping W makes such an axis collapse to the middle — the honest picture, and exactly what happens
to the cell that gets culled. And its colours are the conventional gizmo hues rather than the
puzzle's palette, because on most puzzles no cell sits on an axis at all, and palette colours would
claim otherwise.

**Which cell is hidden.** No control names it, but it is always the partner of the centred cell, and
players do ask where a colour went. The axis inset now shows this implicitly — the axis pointing at
you is drawn brightest and collapsed to the middle — but a line of text may still be worth more.
