/**
 * Face colours.
 *
 * The hypercube's eight cells use the original's hand-picked palette; anything else gets colours
 * generated to be as visually distinct as possible, since some puzzles in the catalog have 120
 * faces and no hand-picked palette would scale.
 */

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** `MagicCube.DEFAULT_FACE_COLORS` — the eight colours of the 3×3×3×3 hypercube. */
export const DEFAULT_FACE_COLORS: readonly Rgb[] = [
  { r: 153, g: 89, b: 255 }, // purple
  { r: 255, g: 229, b: 0 }, // yellow
  { r: 0, g: 158, b: 73 }, // green
  { r: 255, g: 141, b: 0 }, // orange
  { r: 255, g: 0, b: 0 }, // red
  { r: 0, g: 128, b: 255 }, // blue
  { r: 255, g: 255, b: 255 }, // white
  { r: 255, g: 127, b: 255 }, // pink
];

/** The original's sky colour, used as the default background. */
export const SKY: Rgb = { r: 20, g: 170, b: 235 };

/**
 * A palette of `n` visually distinct colours.
 *
 * Uses the hand-picked eight where they fit. Beyond that, walks hue by the golden angle — which
 * spreads successive hues about as evenly as possible however many you take — and varies lightness
 * and saturation on shorter cycles so that neighbouring hues still separate.
 *
 * The original instead samples YUV space at random and iteratively pushes the closest pair apart.
 * That is a better optimiser, but it is seeded-random and produces a palette nobody can predict;
 * this is deterministic and good enough to tell 120 cells apart.
 */
export function facePalette(n: number): Rgb[] {
  if (n <= DEFAULT_FACE_COLORS.length) return DEFAULT_FACE_COLORS.slice(0, n).map((c) => ({ ...c }));

  const GOLDEN_ANGLE = 137.50776405003785;
  const out: Rgb[] = [];
  for (let i = 0; i < n; ++i) {
    const hue = (i * GOLDEN_ANGLE) % 360;
    const lightness = 0.45 + 0.2 * ((i % 3) / 2);
    const saturation = 0.65 + 0.3 * ((i % 2) / 1);
    out.push(hslToRgb(hue, saturation, lightness));
  }
  return out;
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}
