# Folding the hypercube open

A plan for animating the transition a pane already makes instantly: from the projection of a
hypercube to its solid cross, and back. Written after `v0.7.0-hypercube`, where the transition is a
jump, and deliberately not built yet.

The case for it is that this one animation would carry the whole argument of the app. The net and the
projection are the same puzzle, and every other feature says so indirectly — they twist together,
they highlight together, they hold the same orientation. Watching one become the other says it
outright, and it is the picture people already have of a hypercube, from Dalí, in motion.

---

## 1. What the two ends actually are

Both panes run the same pipeline. A sticker's 4D point is shrunk toward its sticker centre and its
cell centre, rotated by the view, scaled, and divided through by `eyeW − w` to land in 3D.

Unfolded inserts one step before the view rotation: each cell is carried by its own rotation into a
shared hyperplane and translated out to its arm of the cross.

| | Projected | Unfolded |
|---|---|---|
| Per-cell transform | none | rotation + translation, from `netLayout` |
| `w` after that step | the sticker's own | forced to `0` |
| Front-cell cull | on — hides the cell facing the 4D eye | off — all eight are meant to be visible |
| Face shrink | `0.4` | `1` |
| Sticker shrink | `0.5` | `0.92` |
| Cells visible | seven | eight |

So the transition is: fade the per-cell transform in from the identity, inflate two shape uniforms,
and let the eighth cell appear. Nothing else about the pipeline changes.

---

## 2. Three things that make this cheaper than it looks

**The fold is already computed.** `netLayout` does not merely place the cells; it stores each one's
unfolding as a rotation and a translation — a quarter turn for each of the six neighbours, in the
plane its normal shares with the centre's, and a half turn for the eighth because it has been rolled
twice. Animating is interpolating what is already there. This is also why the seven cubes end up in
one orientation, which is worth knowing because it is the thing that will make the motion read as a
single object opening rather than as eight cubes drifting apart.

**The per-frame plumbing exists.** `netTween` already builds a fresh `NetLayout` per frame and
`setNetLayout` already uploads one, with a `reframe` flag for exactly this kind of animation.

**The camera does not have to move.** This falls out of the orientation work in `v0.7.0-hypercube`.
Unfolding adopts the arrangement whose middle cube is the cell the projection had facing away, so
the net's hyperplane is spanned by the camera's own three axes: the cross lands flat and undistorted
under the unchanged projected camera, and every point ends at the same `w`, which is a uniform scale
rather than a distortion. The hardest-looking part of the problem is already solved by accident.

---

## 3. The eighth cell

In the projection there are seven cells to see; the eighth is culled because it faces the 4D eye. It
is also the middle cube's opposite, which is why it is the one at the bottom of the long arm. It has
to appear from somewhere.

It probably needs no fade. The cull is a sign test on the projected volume of each cell, and as this
one swings out that sign flips at the moment the cell turns edge-on — so it would wink in as a flat
sliver and inflate, which is the honest moment for it to arrive.

What the cull cannot do is survive the end: at `t = 1` all eight cells are coplanar in 4-space, every
determinant is exactly zero, and `>= 0` would discard the entire puzzle. So the cull has to be
switched off once the eighth cell has flipped and before the others flatten — somewhere around the
middle of the motion, and the exact point wants measuring rather than guessing.

---

## 4. The work, in order

1. **`netFold(geo, base, rotation, t)` in the core.** Per-cell rigid motions interpolating identity →
   the cell's place in the cross. Hinged rather than centred: a cell should rotate about the square
   face it shares with the one it is attached to, the way a paper flap does, rather than about the
   origin and then slide. The endpoint is the same either way — that equivalence is why `netLayout`
   is written as it is — but the path is not, and only the hinged one looks like unfolding. The
   eighth cell hinges off a neighbour that is itself moving, so its motion is the composition of two.
   Testable exactly as `netTween` is: endpoints matching the two existing states, each cell rigid at
   every step, none of them mirrored.

2. **The shader change, which is where the risk is.** `unfold()` currently forces `w = 0`; mid-fold
   the cells have a genuine `w` and the perspective divide has to do its job. That zero is
   load-bearing — it is what lets the framing, the view rotation and the *pick pass* run unchanged
   over an unfolded puzzle — so this wants care, and a mistake in the pick pass is silent. `uCellMat`
   becomes a true 4×4 with no axis-drop baked in and `uCellOffset` a `vec4`.

3. **Renderer.** Interpolate the framing radius rather than holding it, since the cross is larger
   than the projection. Drive the cull from the animation rather than from whether a layout is set.

4. **App.** Replace the mode jump with a clock, interpolating face and sticker shrink alongside the
   fold so the cells inflate from the see-through projection into solid cubes as they flatten out.
   Input should be refused for the duration: a twist part way through a fold is not a coherent thing
   to draw.

---

## 5. What might disappoint

A paper net unfolds into empty space. A projection has none: mid-fold, eight cells overlap in a busy
picture, and the fact that they cannot collide in 4-space will not stop them crossing on screen.

So build it short — 300–400 ms — and look at it before investing in polish. If it reads badly the
fallback is not the current jump but a shorter, partial fold: enough motion to show that the cross
comes out of the projection, without asking anyone to follow eight cells at once.

---

## 6. Not doing yet, and why that is fine

The jump is honest and, from the opening arrangement, does not even change the view matrix. Nothing
is broken. This is the difference between an app that shows you both pictures and one that explains
how they are the same picture — worth having, worth doing properly, and not worth doing badly in
between other work.
