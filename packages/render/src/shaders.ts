/**
 * The vertex and fragment shaders.
 *
 * The original recomputes every vertex position on the CPU each frame, even at rest — for the
 * largest puzzle that is 65,000 vertices in software. Here the whole per-vertex pipeline lives on
 * the GPU, so rotating the puzzle costs a handful of uniform floats per frame regardless of size.
 *
 * The trick that makes it fit: a vertex only needs its own offset from its sticker's centre. Every
 * other input — the sticker's offset from its cell centre, the cell centre itself, and the four
 * vertices that decide the cull — is per *sticker*, so it lives in a texture indexed by a sticker
 * id carried on the vertex.
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
 *   6      (faceIndex, cubieIndex, unused, unused)
 *   7      reserved
 */
export const STICKER_TEXEL = {
  centerMinusFace: 0,
  faceCenter: 1,
  witness0: 2,
  meta: 6,
} as const;

export const vertexShader = /* glsl */ `
precision highp float;
precision highp sampler2D;

in vec4 aVertMinusStickerCenter;
in float aStickerId;

uniform sampler2D uStickerData;
uniform int uStickerTexWidth;

// Row-major from the puzzle core, uploaded so that GLSL's column-vector multiply performs the
// original's row-vector one. See PuzzleRenderer for the transpose argument.
uniform mat4 uRot4d;
uniform float uScale4d;
uniform float uEyeW;
uniform float uFaceShrink;
uniform float uStickerShrink;

out vec3 vPos3;
flat out float vColorIndex;

vec4 fetchSticker(int stickerId, int texel) {
  int index = stickerId * ${TEXELS_PER_STICKER} + texel;
  return texelFetch(uStickerData, ivec2(index % uStickerTexWidth, index / uStickerTexWidth), 0);
}

// Stage 1: shrink the sticker toward its own centre, and the cell toward the puzzle's.
vec4 shrink(vec4 vMinusStickerCenter, vec4 centerMinusFace, vec4 faceCenter) {
  return (vMinusStickerCenter * uStickerShrink + centerMinusFace) * uFaceShrink + faceCenter;
}

// Stages 2 and 3: rotate in 4D, normalise scale, then project to 3D from an eye on the W axis.
vec3 project(vec4 p) {
  vec4 r = uRot4d * p * uScale4d;
  return r.xyz * (uEyeW / (uEyeW - r.w));
}

void main() {
  int stickerId = int(aStickerId + 0.5);
  vec4 centerMinusFace = fetchSticker(stickerId, ${STICKER_TEXEL.centerMinusFace});
  vec4 faceCenter = fetchSticker(stickerId, ${STICKER_TEXEL.faceCenter});

  // Stage 4: the front-cell cull. Every vertex of a sticker computes this from the same four
  // witnesses and so reaches the same verdict, which is what lets the whole cell vanish together.
  vec3 w0 = project(shrink(fetchSticker(stickerId, ${STICKER_TEXEL.witness0} + 0), centerMinusFace, faceCenter));
  vec3 w1 = project(shrink(fetchSticker(stickerId, ${STICKER_TEXEL.witness0} + 1), centerMinusFace, faceCenter));
  vec3 w2 = project(shrink(fetchSticker(stickerId, ${STICKER_TEXEL.witness0} + 2), centerMinusFace, faceCenter));
  vec3 w3 = project(shrink(fetchSticker(stickerId, ${STICKER_TEXEL.witness0} + 3), centerMinusFace, faceCenter));
  float volume = determinant(mat3(w1 - w0, w2 - w0, w3 - w0));

  // The colour a sticker currently shows. In the solved state this is its own face;
  // after a twist it is whichever face's colour was carried into this slot.
  vColorIndex = fetchSticker(stickerId, ${STICKER_TEXEL.meta}).x;
  vec3 p = project(shrink(aVertMinusStickerCenter, centerMinusFace, faceCenter));
  vPos3 = p;

  if (volume >= 0.0) {
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

// One texel per face. A texture rather than a uniform array because the catalog reaches 120 faces
// and uniform array sizes are tightly limited on some GPUs — and because a twist can later update
// individual entries without touching anything else.
uniform sampler2D uFaceColors;
uniform vec3 uSun;
uniform float uAmbient;

out vec4 fragColor;

void main() {
  // Flat shading from the geometry itself: for a planar polygon the screen-space derivatives of
  // the interpolated 3D position give exactly the plane's normal, so no normal attribute is
  // needed and the result matches the original's per-polygon lighting.
  vec3 normal = normalize(cross(dFdx(vPos3), dFdy(vPos3)));
  if (!gl_FrontFacing) normal = -normal;

  float brightness = max(0.0, dot(normal, uSun));
  vec3 color = texelFetch(uFaceColors, ivec2(int(vColorIndex + 0.5), 0), 0).rgb;
  fragColor = vec4(color * (uAmbient + (1.0 - uAmbient) * brightness), 1.0);
}
`;
