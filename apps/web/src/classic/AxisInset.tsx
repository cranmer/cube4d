import { useEffect, useRef } from 'react';

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
 * **The colours are not the puzzle's palette.** On the hypercube each signed axis does happen to be
 * a cell, so palette colours would look right; on a duoprism or the 120-cell no cell sits on an axis
 * at all. Using the conventional gizmo hues keeps this a statement about directions in space rather
 * than about pieces.
 */

const AXES = ['X', 'Y', 'Z', 'W'] as const;
const AXIS_COLORS = ['#e8646e', '#5fd48a', '#6aa9ff', '#c98bff'];

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

export function AxisInset({ getRotation }: { getRotation: () => number[] }) {
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
      {SPOKES.map(({ axis, sign }, i) => (
        <g key={i} stroke={AXIS_COLORS[axis]} fill={AXIS_COLORS[axis]}>
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
      ))}
    </svg>
  );
}
