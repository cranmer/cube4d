import { useEffect, useMemo, useRef } from 'react';

import type { PuzzleGeometry } from '@mc4d/puzzle-core';
import { assignFaceColors, paletteById } from '@mc4d/render';

/**
 * A small compass for 4-space, drawn over the viewport.
 *
 * The view is deliberately oblique, so no puzzle axis points at the top of the screen and there is
 * no way to tell by looking which direction is which. That is fine while you are only turning the
 * puzzle over, and confusing the moment the viewpoint buttons name directions you cannot see. This
 * says where they went.
 *
 * Two decisions worth recording:
 *
 * **The W axis is projected orthographically, not in perspective.** The renderer divides by
 * `eyeW − w`, which for an axis pointing straight at the eye (`w → 1`, `eyeW = 1.05`) magnifies by
 * twenty and would fling the spoke off the edge. Dropping W instead makes an axis aligned with the
 * viewing direction collapse to the centre — which is the honest picture, and exactly what happens
 * to the cell that gets culled.
 *
 * **An axis pointing at you is not drawn.** Its cell is the one the front-cell cull removes, so a
 * label there would name something you cannot see. It fades out as the axis swings towards you
 * rather than popping, and at a named viewpoint it is gone entirely — leaving exactly one spoke
 * collapsed at the middle, which is the little cell in the middle of the picture.
 *
 * **Each spoke is coloured like the cell that sits on it**, so the compass reads directly against
 * the picture: the green spoke points where the green cell is. That correspondence only exists on
 * puzzles whose faces happen to lie on the coordinate axes — the hypercube's do, a duoprism's and
 * the 120-cell's do not — so it is looked up per puzzle rather than assumed, and any axis with no
 * cell on it falls back to a neutral gizmo hue.
 */

const AXES = ['X', 'Y', 'Z', 'W'] as const;

/** Used only where no cell lies on the axis, so there is no puzzle colour to borrow. */
const FALLBACK_COLORS = ['#e8646e', '#5fd48a', '#6aa9ff', '#c98bff'];

const R = 30;
const SIZE = 96;
const C = SIZE / 2;

/** Below this projected length an axis is pointing at or away from you, and has no screen direction. */
const COLLAPSED = 0.18;

interface Spoke {
  axis: number;
  sign: 1 | -1;
}
const SPOKES: Spoke[] = AXES.flatMap((_, axis) =>
  [1, -1].map((sign) => ({ axis, sign: sign as 1 | -1 })),
);

/**
 * A colour per signed axis, taken from the cell that sits on it.
 *
 * The correspondence is real on the hypercube — its eight cell centres are exactly the eight signed
 * axes — and absent on the duoprisms and the 120-cell, whose faces point elsewhere. So it is looked
 * up from the geometry rather than assumed, and axes with no cell on them get null and fall back to
 * a neutral hue. Of the shipped catalog: the hypercube has 8 of 8 faces on an axis, `{5}x{4} 3` has
 * 5 of 9, the simplex 1 of 5, and the 120-cell none of 120.
 */
export function useAxisColors(
  geometry: PuzzleGeometry | null,
  paletteId: string,
): (string | null)[] | undefined {
  return useMemo(() => {
    if (!geometry) return undefined;
    const faceColors = assignFaceColors(
      geometry.nFaces,
      geometry.face2OppositeFace,
      paletteById(paletteId),
    );
    const out: (string | null)[] = new Array(8).fill(null);
    for (let f = 0; f < geometry.nFaces; ++f) {
      const centre = Array.from(
        { length: geometry.nDims },
        (_, i) => geometry.faceCenters[f * geometry.nDims + i],
      );
      const length = Math.hypot(...centre);
      if (length < 1e-9) continue;
      // On an axis exactly when one component carries the whole length.
      const axis = centre.findIndex((x) => Math.abs(x) / length > 0.999);
      if (axis < 0 || axis > 3) continue;
      const rgb = faceColors[f];
      out[axis * 2 + (centre[axis] > 0 ? 0 : 1)] = `rgb(${rgb.r},${rgb.g},${rgb.b})`;
    }
    return out;
  }, [geometry, paletteId]);
}

export function AxisInset({
  getRotation,
  colors,
}: {
  getRotation: () => number[];
  /** One CSS colour per spoke, indexed `axis * 2 + (sign > 0 ? 0 : 1)`; null to fall back. */
  colors?: readonly (string | null)[] | undefined;
}) {
  const root = useRef<SVGSVGElement>(null);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const svg = root.current;
      if (svg) {
        const mat = getRotation();
        for (let i = 0; i < SPOKES.length; ++i) {
          const { axis, sign } = SPOKES[i];
          // Row `axis` of the view matrix is where that basis vector lands; the sign picks the end.
          const x = sign * mat[axis * 4];
          const y = sign * mat[axis * 4 + 1];
          const w = sign * mat[axis * 4 + 3];

          const length = Math.hypot(x, y);
          // Screen y grows downward, so the vertical component is negated.
          const px = C + x * R;
          const py = C - y * R;

          // An axis with no screen direction still needs its label somewhere legible, so it is
          // parked clear of the middle. Only the one pointing away survives to be drawn there.
          const collapsed = length < COLLAPSED;
          const lx = collapsed ? C : C + (x / length) * (R + 11);
          const ly = collapsed ? C + (w > 0 ? -13 : 15) : C - (y / length) * (R + 11);

          // Fades to nothing as the axis turns towards the viewer, because that is precisely when
          // its cell stops being drawn. Everything from side-on to straight-away stays at full
          // strength: those cells are all visible, so their labels should all be readable.
          const shown = Math.min(1, Math.max(0, 1 - w));

          const line = svg.querySelector<SVGLineElement>(`[data-line="${i}"]`);
          const dot = svg.querySelector<SVGCircleElement>(`[data-dot="${i}"]`);
          const text = svg.querySelector<SVGTextElement>(`[data-text="${i}"]`);
          if (!line || !dot || !text) continue;
          line.setAttribute('x2', String(px));
          line.setAttribute('y2', String(py));
          line.setAttribute('opacity', String(0.6 * shown));
          dot.setAttribute('cx', String(px));
          dot.setAttribute('cy', String(py));
          dot.setAttribute('r', String(3 * shown));
          dot.setAttribute('opacity', String(shown));
          text.setAttribute('x', String(lx));
          text.setAttribute('y', String(ly));
          text.setAttribute('opacity', String(shown));
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [getRotation]);

  return (
    <svg
      className="axis-inset"
      ref={root}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      width={SIZE}
      height={SIZE}
      aria-label="Orientation of the four axes"
    >
      <rect x="0.5" y="0.5" width={SIZE - 1} height={SIZE - 1} rx="7" className="axis-frame" />
      {SPOKES.map(({ axis, sign }, i) => {
        const color = colors?.[i] ?? FALLBACK_COLORS[axis];
        return (
        <g key={i} stroke={color} fill={color}>
          <line data-line={i} x1={C} y1={C} x2={C} y2={C} strokeWidth="1.4" strokeLinecap="round" />
          <circle data-dot={i} cx={C} cy={C} r="2.5" stroke="none" />
          <text
            data-text={i}
            x={C}
            y={C}
            stroke="none"
            fontSize="9.5"
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {sign > 0 ? '+' : '−'}
            {AXES[axis]}
          </text>
        </g>
        );
      })}
    </svg>
  );
}
