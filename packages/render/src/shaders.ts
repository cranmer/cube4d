/**
 * The shaders.
 *
 * The original recomputes every vertex position on the CPU each frame, even at rest — for the
 * largest puzzle that is 65,000 vertices in software. Here the whole per-vertex pipeline lives on
 * the GPU, so rotating or animating a twist costs a handful of uniform floats per frame regardless
 * of puzzle size.
 *
 * The trick that makes it fit: a vertex only needs its own offset from its sticker's centre. Every
 * other input — the sticker's offset from its cell centre, the cell centre, which slice it is in,
 * and the four vertices that decide the cull — is per *sticker*, so it lives in a texture indexed
 * by a sticker id carried on the vertex.
 *
 * WebGL2 / GLSL ES 3.00, using texelFetch so there is no filtering or precision ambiguity.
 */

/** Texels of sticker data per sticker. Power of two so the index maths stays cheap. */
export const TEXELS_PER_STICKER = 8;

/**
 * Layout of each sticker's texels:
 *
 *   0      stickerCentre − faceCentre
 *   1      faceCentre
 *   2..5   the four cull witnesses, each as (vertex − stickerCentre)
 *   6      (colourIndex, cubieIndex, inTwistingSlice, unused)
 *   7      reserved
 */
export const STICKER_TEXEL = {
  centerMinusFace: 0,
  faceCenter: 1,
  witness0: 2,
  meta: 6,
} as const;

/** Shared by the visible pass and the pick pass, so what you click is exactly what you see. */
const COMMON_VERTEX = /* glsl */ `
precision highp float;
precision highp sampler2D;

in vec4 aVertMinusStickerCenter;
in float aStickerId;

uniform sampler2D uStickerData;
uniform int uStickerTexWidth;

// Row-major from the puzzle core, uploaded so that GLSL's column-vector multiply performs the
// original's row-vector one. See PuzzleRenderer for why no transpose is needed.
uniform mat4 uRot4d;
uniform float uScale4d;
uniform float uEyeW;
uniform float uFaceShrink;
uniform float uStickerShrink;

// The in-progress twist. Identity when nothing is turning.
uniform mat4 uTwistMat;
uniform float uTwisting;

vec4 fetchSticker(int stickerId, int texel) {
  int index = stickerId * ${TEXELS_PER_STICKER} + texel;
  return texelFetch(uStickerData, ivec2(index % uStickerTexWidth, index / uStickerTexWidth), 0);
}

// Stage 1: shrink the sticker toward its own centre, and the cell toward the puzzle's. Then, if
// this sticker is in the slice currently turning, rotate it by however far the twist has gone.
vec4 place(vec4 vMinusStickerCenter, vec4 centerMinusFace, vec4 faceCenter, float inSlice) {
  vec4 v = (vMinusStickerCenter * uStickerShrink + centerMinusFace) * uFaceShrink + faceCenter;
  if (uTwisting > 0.5 && inSlice > 0.5) v = uTwistMat * v;
  return v;
}

// Stages 2 and 3: rotate in 4D, normalise scale, then project to 3D from an eye on the W axis.
vec3 project(vec4 p) {
  vec4 r = uRot4d * p * uScale4d;
  return r.xyz * (uEyeW / (uEyeW - r.w));
}

// Stage 4: the front-cell cull. Every vertex of a sticker computes this from the same four
// witnesses and so reaches the same verdict, which is what lets a whole cell vanish together.
// Negative volume means the cell faces away from the 4D eye, and is therefore the one to draw.
float cellVolume(int stickerId, vec4 centerMinusFace, vec4 faceCenter, float inSlice) {
  vec3 w0 = project(place(fetchSticker(stickerId, ${STICKER_TEXEL.witness0} + 0), centerMinusFace, faceCenter, inSlice));
  vec3 w1 = project(place(fetchSticker(stickerId, ${STICKER_TEXEL.witness0} + 1), centerMinusFace, faceCenter, inSlice));
  vec3 w2 = project(place(fetchSticker(stickerId, ${STICKER_TEXEL.witness0} + 2), centerMinusFace, faceCenter, inSlice));
  vec3 w3 = project(place(fetchSticker(stickerId, ${STICKER_TEXEL.witness0} + 3), centerMinusFace, faceCenter, inSlice));
  return determinant(mat3(w1 - w0, w2 - w0, w3 - w0));
}
`;

export const vertexShader = /* glsl */ `
${COMMON_VERTEX}

out vec3 vPos3;
flat out float vColorIndex;
flat out float vCubie;
flat out float vSticker;
flat out float vInSlice;

void main() {
  int stickerId = int(aStickerId + 0.5);
  vec4 centerMinusFace = fetchSticker(stickerId, ${STICKER_TEXEL.centerMinusFace});
  vec4 faceCenter = fetchSticker(stickerId, ${STICKER_TEXEL.faceCenter});
  vec4 meta = fetchSticker(stickerId, ${STICKER_TEXEL.meta});

  // The colour a sticker currently shows. Solved, that is its own cell's; after a twist it is
  // whichever colour was carried into this slot.
  vColorIndex = meta.x;
  vCubie = meta.y;
  vSticker = aStickerId;
  vInSlice = meta.z;

  vec3 p = project(place(aVertMinusStickerCenter, centerMinusFace, faceCenter, meta.z));
  vPos3 = p;

  if (cellVolume(stickerId, centerMinusFace, faceCenter, meta.z) >= 0.0) {
    // Facing the 4D eye: collapse it outside the clip volume so nothing is rasterised.
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

export const fragmentShader = /* glsl */ `
precision highp float;
precision highp sampler2D;

in vec3 vPos3;
flat in float vColorIndex;
flat in float vCubie;
flat in float vSticker;
flat in float vInSlice;

// One texel per face. A texture rather than a uniform array because the catalog reaches 120 faces
// and uniform array sizes are tightly limited on some GPUs — and because a twist can update
// individual entries without touching anything else.
uniform sampler2D uFaceColors;
uniform vec3 uSun;
uniform float uAmbient;
uniform float uFill;
uniform float uOpacity;

// What the cursor is over, or -1 for nothing. Highlighting by cubie lights the whole piece.
uniform float uHighlightSticker;
uniform float uHighlightCubie;
/**
 * Lights the layer that is about to turn, before it turns.
 *
 * Watching a recorded solve, the move is over before you have worked out which layer moved. Showing
 * it first turns each move into two readable halves: what is about to happen, then it happening.
 */
uniform float uTelegraph;

out vec4 fragColor;

vec3 linearToSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  // Flat shading from the geometry itself: for a planar polygon the screen-space derivatives of
  // the interpolated 3D position give exactly the plane's normal, so no normal attribute is
  // needed and the result matches the original's per-polygon lighting.
  vec3 normal = normalize(cross(dFdx(vPos3), dFdy(vPos3)));
  if (!gl_FrontFacing) normal = -normal;

  // Key light, plus a dim fill from behind so faces turned away from the sun keep their hue
  // instead of sinking into the background. The original has neither — a face pointing away goes
  // pure black — which was survivable against its bright sky but not against a dark one.
  float key = max(0.0, dot(normal, uSun));
  float fill = uFill * max(0.0, dot(normal, -uSun));
  float lit = clamp(key + fill, 0.0, 1.0);

  vec3 color = texelFetch(uFaceColors, ivec2(int(vColorIndex + 0.5), 0), 0).rgb;
  color *= uAmbient + (1.0 - uAmbient) * lit;

  bool highlit =
    (uHighlightCubie >= 0.0 && abs(vCubie - uHighlightCubie) < 0.5) ||
    (uHighlightSticker >= 0.0 && abs(vSticker - uHighlightSticker) < 0.5) ||
    (uTelegraph > 0.5 && vInSlice > 0.5);
  // The original brightens twice, each step a 1/0.7 scale — about 2x, clamped.
  if (highlit) color = min(color * 2.04, vec3(1.0));

  // Back to sRGB for display.
  //
  // Shading has to happen in linear space to be right, and the palette is converted on the way in
  // — but a ShaderMaterial writing gl_FragColor by hand gets no encoding applied on the way out.
  // Without this the linear values are shown as though they were already sRGB, which darkens
  // everything by roughly a gamma.
  fragColor = vec4(linearToSRGB(color), uOpacity);
}
`;

/**
 * The pick pass.
 *
 * Renders sticker and polygon ids as colour into an off-screen target, using the *same* vertex
 * transform and the same cull as the visible pass — so whatever is on screen is exactly what gets
 * picked. That is more reliable than the original's approach of walking a sorted draw list and
 * testing point-in-polygon in screen space, and it cannot drift out of agreement with the drawing.
 *
 * Ids are packed into 8-bit channels rather than using an integer render target: RGBA8 is
 * universally supported and reads back without fuss. A sticker id needs 16 bits (the largest puzzle
 * has 7,560) and a polygon index needs 8 (no sticker in the catalog has anywhere near 256 faces).
 */
export const pickVertexShader = /* glsl */ `
${COMMON_VERTEX}

in float aPolyId;
flat out float vPickSticker;
flat out float vPickPoly;

void main() {
  int stickerId = int(aStickerId + 0.5);
  vec4 centerMinusFace = fetchSticker(stickerId, ${STICKER_TEXEL.centerMinusFace});
  vec4 faceCenter = fetchSticker(stickerId, ${STICKER_TEXEL.faceCenter});
  vec4 meta = fetchSticker(stickerId, ${STICKER_TEXEL.meta});

  vPickSticker = aStickerId;
  vPickPoly = aPolyId;

  vec3 p = project(place(aVertMinusStickerCenter, centerMinusFace, faceCenter, meta.z));
  if (cellVolume(stickerId, centerMinusFace, faceCenter, meta.z) >= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

export const pickFragmentShader = /* glsl */ `
precision highp float;

flat in float vPickSticker;
flat in float vPickPoly;

out vec4 fragColor;

void main() {
  // Values are divided by exactly 255 so the GPU's round(v * 255) quantization returns them
  // unchanged. Any offset here would shift every id by one.
  int sticker = int(vPickSticker + 0.5);
  fragColor = vec4(
    float(sticker % 256) / 255.0,
    float(sticker / 256) / 255.0,
    vPickPoly / 255.0,
    1.0   // alpha marks a hit; the cleared background leaves it at zero
  );
}
`;
