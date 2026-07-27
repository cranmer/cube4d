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

/**
 * Alternative palettes.
 *
 * The original's colours were chosen for a 3D-shaped intuition: red and orange are *opposite*
 * cells, as are blue and purple, and on a physical cube you almost never see an opposite pair at
 * once. In 4D the front-cell cull shows you seven cells simultaneously, so opposite pairs sit side
 * by side constantly and near-hues become genuinely hard to tell apart.
 */
export interface Palette {
  readonly id: string;
  readonly name: string;
  readonly note: string;
  readonly colors: readonly Rgb[];
  /**
   * Backgrounds belong to palettes, not to the app.
   *
   * The original's sky blue is the reason its blues are hard to read: any blue or cyan cell
   * competes with it, and the Lambert shading only darkens cells further. A neutral dark
   * background removes that competition entirely and lets saturated colours carry.
   */
  readonly background: Rgb;
}

/** The original's sky colour. */
export const SKY: Rgb = { r: 20, g: 170, b: 235 };

const hex = (...values: string[]): Rgb[] =>
  values.map((v) => ({
    r: parseInt(v.slice(1, 3), 16),
    g: parseInt(v.slice(3, 5), 16),
    b: parseInt(v.slice(5, 7), 16),
  }));

/** Neutral, slightly cool, dark enough that every saturated hue reads against it. */
const SLATE: Rgb = { r: 22, g: 26, b: 33 };

export const PALETTES: readonly Palette[] = [
  {
    id: 'distinct',
    name: 'Distinct',
    note: 'Okabe–Ito — stays readable with any common colour vision.',
    // The Okabe–Ito qualitative palette happens to have exactly eight entries, which is exactly
    // what a hypercube needs. Its black is swapped for white, since an unlit black cell is
    // indistinguishable from shadow.
    colors: hex('#ffffff', '#e69f00', '#56b4e9', '#009e73', '#f0e442', '#0072b2', '#d55e00', '#cc79a7'),
    background: SLATE,
  },
  {
    id: 'vivid',
    name: 'Vivid',
    note: 'Saturated, with lightness varied so neighbouring hues still separate.',
    // Hue alone is not enough for eight cells: the shading darkens whatever faces away, which
    // compresses hues together. So lightness alternates as well — a deep red beside a bright
    // orange stays legible where two mid-tones would not.
    colors: hex('#c1121f', '#fb8500', '#ffd500', '#2a9d8f', '#52d1dc', '#1d4ed8', '#d946ef', '#f1f5f9'),
    background: SLATE,
  },
  {
    id: 'classic',
    name: 'Classic',
    note: "MagicCube4D's original colours, on its original sky.",
    // Kept exactly as the original, sky included. Its red/orange and blue/purple pairs are opposite
    // cells — a convention from 3D cubes, where you never see an opposite pair at once. In 4D you
    // see seven cells simultaneously and the pairs sit side by side, which is why it is no longer
    // the default.
    colors: DEFAULT_FACE_COLORS,
    background: SKY,
  },
];

export const DEFAULT_PALETTE_ID = 'distinct';

export function paletteById(id: string): Palette {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0];
}

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
export function facePalette(n: number, base: readonly Rgb[] | undefined = DEFAULT_FACE_COLORS): Rgb[] {
  base = base ?? DEFAULT_FACE_COLORS;
  if (n <= base.length) return base.slice(0, n).map((c) => ({ ...c }));

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
