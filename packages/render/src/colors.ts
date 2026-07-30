/**
 * Face colours.
 *
 * Colours are assigned by *opposite pair*, not by face index. On a Rubik's cube white faces yellow,
 * red faces orange, green faces blue — related colours placed opposite each other, where you never
 * see both at once. MagicCube4D follows the same convention and adds a fourth pair, purple/pink,
 * for the hypercube's extra two cells.
 *
 * The convention transfers to 4D, but only partly, and it is worth being precise about why. The
 * front-cell cull hides exactly one cell, so the pair containing it is split — its other half sits
 * at the centre of the picture. The remaining three pairs are *both* on screen at once. So unlike a
 * 3D cube, where an opposite pair is never visible together, here three quarters of the pairs
 * always are.
 *
 * That means related-but-similar is not good enough: the two colours of a pair have to be plainly
 * distinguishable side by side, the way white and yellow are. Red against orange is the pair that
 * strains this even on a physical cube, and it is the one to watch here.
 *
 * Every palette defines four pairs in the same order, so a cell keeps its colour family when you
 * switch palettes: the yellow cell stays yellow-ish, the green cell stays green-ish.
 */

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export type ColorPair = readonly [Rgb, Rgb];

/** `MagicCube.DEFAULT_FACE_COLORS` — the eight colours of the 3×3×3×3 hypercube, in face order. */
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

export interface Palette {
  readonly id: string;
  readonly name: string;
  readonly note: string;
  /**
   * Four opposite-face pairs, in a fixed order of roles: violet, light, green–blue, warm.
   *
   * Keeping the order consistent across palettes is what makes them interchangeable — switching
   * palette recolours the puzzle without relabelling which cell is which.
   */
  readonly pairs: readonly ColorPair[];
  /**
   * Backgrounds belong to palettes, not to the app.
   *
   * The original's sky blue is why its blues are hard to read: any blue or cyan cell competes with
   * it, and the shading only darkens cells further. A neutral dark background removes that
   * competition and lets saturated colours carry.
   */
  readonly background: Rgb;
}

/** The original's sky colour. */
export const SKY: Rgb = { r: 20, g: 170, b: 235 };

/** Neutral, slightly cool, dark enough that every saturated hue reads against it. */
const SLATE: Rgb = { r: 22, g: 26, b: 33 };

const rgb = (v: string): Rgb => ({
  r: parseInt(v.slice(1, 3), 16),
  g: parseInt(v.slice(3, 5), 16),
  b: parseInt(v.slice(5, 7), 16),
});
const pair = (a: string, b: string): ColorPair => [rgb(a), rgb(b)];

export const PALETTES: readonly Palette[] = [
  {
    id: 'vivid',
    name: 'Vivid',
    note: 'Saturated, with lightness varied so neighboring hues still separate.',
    // Hue alone is not enough for eight cells: the shading darkens whatever faces away, which
    // compresses hues together. So lightness varies within each pair as well.
    pairs: [
      pair('#a347d1', '#f06ac9'), // purple / pink
      pair('#ffd60a', '#f1f5f9'), // yellow / white
      pair('#26a269', '#1c71d8'), // green / blue
      pair('#ff7800', '#e01b24'), // orange / red
    ],
    background: SLATE,
  },
  {
    id: 'distinct',
    name: 'Distinct',
    note: 'Okabe–Ito — stays readable with any common color vision.',
    // The Okabe–Ito qualitative palette has exactly eight entries, which is exactly what a
    // hypercube needs. Its black is swapped for white, since an unlit black cell is
    // indistinguishable from shadow. The pairings are the closest same-family groupings the
    // palette allows: it was designed for maximum separation, not for related pairs.
    pairs: [
      pair('#cc79a7', '#0072b2'), // reddish purple / blue
      pair('#f0e442', '#ffffff'), // yellow / white
      pair('#009e73', '#56b4e9'), // bluish green / sky blue
      pair('#e69f00', '#d55e00'), // orange / vermillion
    ],
    background: SLATE,
  },
  {
    id: 'classic',
    name: 'Classic',
    note: "MagicCube4D's original colors, on its original sky.",
    // Exactly the original's colours, grouped into the pairs the original actually places
    // opposite each other — verified against the geometry rather than assumed.
    pairs: [
      [DEFAULT_FACE_COLORS[0], DEFAULT_FACE_COLORS[7]], // purple / pink
      [DEFAULT_FACE_COLORS[1], DEFAULT_FACE_COLORS[6]], // yellow / white
      [DEFAULT_FACE_COLORS[2], DEFAULT_FACE_COLORS[5]], // green / blue
      [DEFAULT_FACE_COLORS[3], DEFAULT_FACE_COLORS[4]], // orange / red
    ],
    background: SKY,
  },
];

export const DEFAULT_PALETTE_ID = 'vivid';

export function paletteById(id: string): Palette {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0];
}

/**
 * Colour every cell of a puzzle, keeping opposite cells in the same colour family.
 *
 * Faces are walked in order and grouped with their opposites; each group takes the next pair. A
 * face with no opposite — a simplex has none at all — takes a single colour from the pool.
 *
 * Puzzles larger than the palette (the 120-cell needs sixty pairs) fall back to generated hues,
 * still assigned in pairs so the convention holds all the way up.
 */
export function assignFaceColors(
  nFaces: number,
  face2OppositeFace: ArrayLike<number>,
  palette: Palette,
): Rgb[] {
  // Group faces into opposite pairs, in face order.
  const groups: number[][] = [];
  const placed = new Uint8Array(nFaces);
  for (let f = 0; f < nFaces; ++f) {
    if (placed[f]) continue;
    const opposite = face2OppositeFace[f];
    if (opposite > f && opposite < nFaces && !placed[opposite]) {
      groups.push([f, opposite]);
      placed[f] = placed[opposite] = 1;
    } else {
      groups.push([f]);
      placed[f] = 1;
    }
  }

  // A puzzle with exactly three opposite pairs is a solid with six faces — an ordinary cube. Give it
  // the three a cuber expects (white/yellow, green/blue, red/orange) rather than the first three in
  // the list, whose leading pair exists for the fourth axis a solid does not have. Skipping it costs
  // nothing: the pairs are in a fixed role order precisely so a subset can be taken meaningfully.
  const traditional = groups.length === 3 && palette.pairs.length >= 4;
  const pairs = traditional
    ? palette.pairs.slice(1, 4)
    : groups.length <= palette.pairs.length
      ? palette.pairs
      : generatePairs(groups.length);

  const out: Rgb[] = new Array(nFaces);
  for (let g = 0; g < groups.length; ++g) {
    const [a, b] = pairs[g % pairs.length];
    out[groups[g][0]] = { ...a };
    if (groups[g].length > 1) out[groups[g][1]] = { ...b };
  }
  return out;
}

/**
 * Pairs for puzzles too large for a hand-picked palette.
 *
 * Hues walk by the golden angle, which spreads them about as evenly as possible however many you
 * take, and each pair is a light and a dark of the same hue — so opposite cells stay related, as
 * they do on a Rubik's cube, while every other cell is a different hue entirely.
 */
function generatePairs(count: number): ColorPair[] {
  const GOLDEN_ANGLE = 137.50776405003785;
  const out: ColorPair[] = [];
  for (let i = 0; i < count; ++i) {
    const hue = (i * GOLDEN_ANGLE) % 360;
    out.push([hslToRgb(hue, 0.72, 0.62), hslToRgb(hue, 0.85, 0.38)]);
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

/**
 * Order the pairs are shown in, which is deliberately not the order they are assigned in.
 *
 * Assignment starts with the violet pair because that is what reproduces the original's per-face
 * colours exactly. But a swatch strip should lead with what people recognise — yellow/white,
 * green/blue, orange/red are the Rubik's pairs — so violet goes last for display only.
 */
const SWATCH_ORDER = [1, 2, 3, 0];

/** The palette's colours in a flat list, for swatches in the UI. */
export function paletteSwatches(palette: Palette): Rgb[] {
  const order = palette.pairs.length === SWATCH_ORDER.length
    ? SWATCH_ORDER
    : palette.pairs.map((_, i) => i);
  return order.flatMap((i) => [palette.pairs[i][0], palette.pairs[i][1]]);
}
