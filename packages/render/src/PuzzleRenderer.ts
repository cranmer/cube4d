/**
 * The renderer.
 *
 * Owns a Three.js scene containing exactly one mesh — the whole puzzle — and drives it with
 * uniforms. Rotating the puzzle uploads sixteen floats; it costs the same for the 216-sticker
 * hypercube as for the 7,560-sticker 120-cell.
 */

import * as THREE from 'three';
import type { PuzzleGeometry } from '@mc4d/puzzle-core';

import {
  buildBuffers,
  buildFaceColorTexture,
  buildPickGeometry,
  setTwistingSlice,
  updateStickerColors,
  type PuzzleBuffers,
} from './buildGeometry.js';
import { projectPoint } from './pipeline.js';
import { assignFaceColors, DEFAULT_PALETTE_ID, paletteById, SKY, type Palette, type Rgb } from './colors.js';
import { DEFAULT_VIEW, projectedRadius, type ViewParams } from './pipeline.js';
import { fragmentShader, pickFragmentShader, pickVertexShader, vertexShader } from './shaders.js';

/** `MagicCube.SUNVEC`, normalised. Points toward the light. */
const SUN = new THREE.Vector3(0.82, 1.55, 3.3).normalize();

/** `MagicCube.EYEZ`. The 3D eye distance, distinct from the 4D one. */
const EYE_Z = 8.5;

/**
 * Chosen so the framing matches the original.
 *
 * The original maps a projected point to pixels as `s·x / (eyeZ − z)`, with
 * `s = 4.7 · minPixels / (1.25 · radius)`. Equating that to a perspective camera's
 * `x / ((eyeZ − z) · tan(fov/2))` gives `tan(fov/2) = radius · 1.25 / (2 · 4.7)`.
 */
const FRAMING = 1.25 / (2 * 4.7);

export interface RendererOptions {
  readonly canvas: HTMLCanvasElement;
  readonly background?: Rgb;
  /**
   * Ambient light fraction.
   *
   * The original uses none at all — a face pointing away from the sun goes black. That was
   * tolerable against its bright sky, where a black cell still stood out; against a dark
   * background it would simply disappear. A little ambient keeps every face legible.
   */
  readonly ambient?: number;
  /** Strength of a dim light from behind, so faces turned away keep their colour. */
  readonly fill?: number;
}

export class PuzzleRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private material: THREE.ShaderMaterial | null = null;
  private mesh: THREE.Mesh | null = null;
  private buffers: PuzzleBuffers | null = null;
  private faceColorTexture: THREE.DataTexture | null = null;
  private geo: PuzzleGeometry | null = null;

  private view: ViewParams = { ...DEFAULT_VIEW, mat4d: new Float64Array(16) };
  private radius = 1;
  private zoom = 1;
  private opacity = 1;
  private palette: Palette = paletteById(DEFAULT_PALETTE_ID);
  private sortScratch: { sticker: number; depth: number }[] = [];

  // Pick pass, built lazily — it costs memory and is not needed until someone clicks.
  private pickTarget: THREE.WebGLRenderTarget | null = null;
  private pickScene: THREE.Scene | null = null;
  private pickMaterial: THREE.ShaderMaterial | null = null;
  private pickMesh: THREE.Mesh | null = null;
  private readonly pickPixel = new Uint8Array(4);

  constructor(private readonly options: RendererOptions) {
    this.renderer = new THREE.WebGLRenderer({
      canvas: options.canvas,
      antialias: true,
      alpha: false,
    });
    if (!this.renderer.capabilities.isWebGL2) {
      throw new Error('WebGL2 is required — this puzzle projects 4D geometry in a vertex shader.');
    }
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2));

    const background = options.background ?? SKY;
    this.scene.background = new THREE.Color(
      background.r / 255,
      background.g / 255,
      background.b / 255,
    ).convertSRGBToLinear();

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    this.camera.position.set(0, 0, EYE_Z);
    this.camera.lookAt(0, 0, 0);
  }

  /** Swap in a puzzle. Disposes whatever was there before. */
  setPuzzle(geo: PuzzleGeometry, palette: Palette = paletteById(DEFAULT_PALETTE_ID)): void {
    this.disposePuzzle();
    this.geo = geo;
    this.buffers = buildBuffers(geo);
    this.palette = palette;
    this.faceColorTexture = buildFaceColorTexture(
      assignFaceColors(geo.nFaces, geo.face2OppositeFace, palette),
    );

    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader,
      fragmentShader,
      // The cells are closed solids whose facet winding is not guaranteed consistent, and the
      // depth buffer hides interiors anyway, so draw both sides and flip the normal per fragment.
      side: THREE.DoubleSide,
      uniforms: {
        uStickerData: { value: this.buffers.stickerData },
        uStickerTexWidth: { value: this.buffers.stickerTexWidth },
        uRot4d: { value: new THREE.Matrix4() },
        uScale4d: { value: 1 / geo.circumRadius },
        uEyeW: { value: this.view.eyeW },
        uFaceShrink: { value: this.view.faceShrink },
        uStickerShrink: { value: this.view.stickerShrink },
        uFaceColors: { value: this.faceColorTexture },
        uSun: { value: SUN },
        uAmbient: { value: this.options.ambient ?? 0.22 },
        uFill: { value: this.options.fill ?? 0.35 },
        uOpacity: { value: this.opacity },
        uTwistMat: { value: new THREE.Matrix4() },
        uTwisting: { value: 0 },
        uHighlightSticker: { value: -1 },
        uHighlightCubie: { value: -1 },
        uTelegraph: { value: 0 },
      },
    });
    this.applyOpacity();

    this.mesh = new THREE.Mesh(this.buffers.geometry, this.material);
    this.mesh.frustumCulled = false; // positions are computed in the shader; a CPU bound is meaningless
    this.scene.add(this.mesh);
    this.refreshFraming();
  }

  // ---------------------------------------------------------------- twisting

  /**
   * Show a twist partway through.
   *
   * `inSlice` marks which stickers are turning; pass it once when the twist starts. `matrix` is the
   * partial rotation for the current instant, row-major like everything else from the core.
   */
  beginTwist(inSlice: Uint8Array): void {
    if (!this.buffers) return;
    setTwistingSlice(this.buffers, inSlice);
    if (this.material) this.material.uniforms.uTwisting.value = 1;
  }

  setTwistMatrix(matrix: Float64Array): void {
    if (!this.material) return;
    (this.material.uniforms.uTwistMat.value as THREE.Matrix4).fromArray(Array.from(matrix));
  }

  /**
   * Light the layer that is about to turn, without turning it.
   *
   * Uses the same per-sticker flag the twist does, so there is nothing extra to compute or upload.
   */
  setTelegraph(on: boolean): void {
    if (this.material) this.material.uniforms.uTelegraph.value = on ? 1 : 0;
  }

  /** Clear the animation. Call once the move has been applied to the puzzle state. */
  endTwist(): void {
    if (!this.buffers) return;
    setTwistingSlice(this.buffers, null);
    if (this.material) {
      this.material.uniforms.uTwisting.value = 0;
      this.material.uniforms.uTelegraph.value = 0;
    }
  }

  /** Light up the sticker or piece under the cursor. Pass -1 for neither. */
  setHighlight(sticker: number, cubie: number): void {
    if (!this.material) return;
    this.material.uniforms.uHighlightSticker.value = sticker;
    this.material.uniforms.uHighlightCubie.value = cubie;
  }

  // ---------------------------------------------------------------- picking

  /**
   * What is under the cursor, in canvas pixels.
   *
   * Renders a single pixel through the same vertex shader and the same cull as the visible pass,
   * with sticker and polygon ids as colour, then reads it back. Whatever is on screen is what gets
   * picked, by construction — there is no second geometry representation to fall out of step.
   */
  pick(x: number, y: number): { sticker: number; poly: number } | null {
    const geo = this.geo;
    if (!geo) return null;
    this.ensurePickPass(geo);
    if (!this.pickTarget || !this.pickScene) return null;

    const size = this.renderer.getSize(new THREE.Vector2());
    const ratio = this.renderer.getPixelRatio();
    const px = Math.round(x * ratio);
    const py = Math.round((size.y - y) * ratio);

    // Render just the one pixel the cursor is over, by offsetting the view so that pixel fills the
    // whole 1x1 target. Far cheaper than a full-resolution pass per mouse move.
    this.camera.setViewOffset(size.x * ratio, size.y * ratio, px, size.y * ratio - py - 1, 1, 1);
    const previousTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.pickTarget);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.render(this.pickScene, this.camera);
    this.renderer.readRenderTargetPixels(this.pickTarget, 0, 0, 1, 1, this.pickPixel);
    this.renderer.setRenderTarget(previousTarget);
    this.camera.clearViewOffset();

    const [r, g, b, a] = this.pickPixel;
    if (a === 0) return null;
    const sticker = r + g * 256;
    if (sticker >= geo.nStickers) return null;
    return { sticker, poly: b };
  }

  private ensurePickPass(geo: PuzzleGeometry): void {
    if (this.pickScene || !this.material) return;
    this.pickTarget = new THREE.WebGLRenderTarget(1, 1, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
    });
    this.pickMaterial = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: pickVertexShader,
      fragmentShader: pickFragmentShader,
      side: THREE.DoubleSide,
      // Ids must not be blended or dithered — every fragment is a discrete value.
      transparent: false,
      // Shares the visible pass's uniform objects, so it can never disagree about the view.
      uniforms: this.material.uniforms,
    });
    this.pickMesh = new THREE.Mesh(buildPickGeometry(geo), this.pickMaterial);
    this.pickMesh.frustumCulled = false;
    this.pickScene = new THREE.Scene();
    this.pickScene.add(this.pickMesh);
  }

  /** Update the 4D view rotation. `mat4d` is row-major, as the puzzle core produces it. */
  setRotation(mat4d: Float64Array | readonly number[]): void {
    this.view = { ...this.view, mat4d };
    if (!this.material) return;
    // The core uses row vectors (v · M); GLSL multiplies column vectors (M · v). Loading a
    // row-major array into Three's column-major Matrix4 transposes it, which converts between the
    // two exactly. No explicit transpose is needed — or wanted.
    (this.material.uniforms.uRot4d.value as THREE.Matrix4).fromArray(Array.from(mat4d));
    // Blending is order-dependent, so a rotation invalidates the draw order.
    if (this.opacity < 1) this.sortStickersBackToFront();
  }

  /**
   * How opaque the stickers are. Below 1 the puzzle becomes a glass model of itself, which is the
   * clearest way to see that the cells really do nest inside one another.
   */
  setOpacity(opacity: number): void {
    const next = Math.max(0.05, Math.min(1, opacity));
    const wasTransparent = this.opacity < 1;
    this.opacity = next;
    if (!this.material) return;
    this.material.uniforms.uOpacity.value = next;
    this.applyOpacity();
    if (next < 1) this.sortStickersBackToFront();
    else if (wasTransparent) this.restoreStickerOrder();
  }

  getOpacity(): number {
    return this.opacity;
  }

  private applyOpacity(): void {
    if (!this.material) return;
    const transparent = this.opacity < 1;
    this.material.transparent = transparent;
    // Writing depth from a translucent surface would let it hide what is behind it, which is the
    // one thing transparency exists to prevent. Depth *testing* stays on, so opaque geometry still
    // occludes correctly.
    this.material.depthWrite = !transparent;
    this.material.needsUpdate = true;
  }

  /**
   * Reorder the index buffer so stickers draw far-to-near.
   *
   * Alpha blending is not commutative, so translucent geometry has to be drawn back to front or
   * the result depends on buffer order rather than on what is actually behind what. Sorting whole
   * stickers rather than triangles is an approximation — two interpenetrating stickers can still
   * blend wrongly — but stickers are small, convex and disjoint, so in practice it is exact.
   */
  private sortStickersBackToFront(): void {
    const geo = this.geo;
    const buffers = this.buffers;
    if (!geo || !buffers) return;

    if (this.sortScratch.length !== geo.nStickers) {
      this.sortScratch = Array.from({ length: geo.nStickers }, () => ({ sticker: 0, depth: 0 }));
    }

    // A sticker's centre is what you get by running the pipeline with a zero vertex offset.
    const zero = new Float64Array(4);
    const out = new Float32Array(3);
    const scale4d = 1 / geo.circumRadius;
    for (let s = 0; s < geo.nStickers; ++s) {
      projectPoint(
        out,
        zero,
        0,
        geo.stickerCenterMinusFaceCenter,
        s * 4,
        geo.faceCenters,
        geo.sticker2face[s] * 4,
        this.view.mat4d,
        scale4d,
        this.view.eyeW,
        this.view.faceShrink,
        this.view.stickerShrink,
      );
      this.sortScratch[s].sticker = s;
      this.sortScratch[s].depth = out[2]; // larger z is nearer the camera at +eyeZ
    }
    this.sortScratch.sort((a, b) => a.depth - b.depth);

    const indices = buffers.geometry.getIndex()!;
    const target = indices.array as Uint16Array | Uint32Array;
    let write = 0;
    for (const { sticker } of this.sortScratch) {
      const begin = buffers.stickerTriBegin[sticker] * 3;
      const count = buffers.stickerTriCount[sticker] * 3;
      target.set(buffers.baseIndices.subarray(begin, begin + count), write);
      write += count;
    }
    indices.needsUpdate = true;
  }

  private restoreStickerOrder(): void {
    const buffers = this.buffers;
    if (!buffers) return;
    const indices = buffers.geometry.getIndex()!;
    (indices.array as Uint16Array | Uint32Array).set(buffers.baseIndices);
    indices.needsUpdate = true;
  }

  /** Shrink sliders and the 4D eye distance. Any change reframes the camera. */
  setViewParams(params: Partial<Omit<ViewParams, 'mat4d'>>): void {
    this.view = { ...this.view, ...params };
    if (!this.material) return;
    this.material.uniforms.uEyeW.value = this.view.eyeW;
    this.material.uniforms.uFaceShrink.value = this.view.faceShrink;
    this.material.uniforms.uStickerShrink.value = this.view.stickerShrink;
    this.refreshFraming();
  }

  setZoom(zoom: number): void {
    this.zoom = Math.max(0.2, Math.min(5, zoom));
    this.applyCamera();
  }

  getZoom(): number {
    return this.zoom;
  }

  setBackground(color: Rgb): void {
    this.scene.background = new THREE.Color(
      color.r / 255,
      color.g / 255,
      color.b / 255,
    ).convertSRGBToLinear();
  }

  /** Swap the face colours without rebuilding any geometry. */
  setPalette(palette: Palette): void {
    if (!this.material || !this.geo) return;
    this.palette = palette;
    this.faceColorTexture?.dispose();
    this.faceColorTexture = buildFaceColorTexture(
      assignFaceColors(this.geo.nFaces, this.geo.face2OppositeFace, palette),
    );
    this.material.uniforms.uFaceColors.value = this.faceColorTexture;
    this.setBackground(palette.background);
  }

  /** Recolour the stickers from a puzzle state. */
  setState(state: Int32Array): void {
    if (this.buffers) updateStickerColors(this.buffers, state);
  }

  setSize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.applyCamera();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * The projected extent of the puzzle, recomputed on the CPU when the shrink or eye parameters
   * change. Rotation does not change it enough to matter, and recomputing per frame would undo the
   * point of putting the pipeline on the GPU.
   */
  private refreshFraming(): void {
    if (!this.geo) return;
    this.radius = Math.max(1e-6, projectedRadius(this.geo, this.view));
    this.applyCamera();
  }

  private applyCamera(): void {
    const halfAngle = Math.atan((this.radius * FRAMING) / this.zoom);
    // Frame against the smaller dimension, as the original does with its `minpix`, so the puzzle
    // fits whatever the window shape. A perspective camera's `fov` is vertical, so on a portrait
    // canvas it has to be widened until the *horizontal* half-angle is the one we asked for.
    const aspect = this.camera.aspect;
    const verticalHalfAngle = aspect >= 1 ? halfAngle : Math.atan(Math.tan(halfAngle) / aspect);
    this.camera.fov = (2 * verticalHalfAngle * 180) / Math.PI;
    // Keep the depth range tight around the object; precision is then never an issue.
    this.camera.near = Math.max(0.01, EYE_Z - this.radius * 1.2);
    this.camera.far = EYE_Z + this.radius * 1.2;
    this.camera.updateProjectionMatrix();
  }

  private disposePuzzle(): void {
    if (this.mesh) this.scene.remove(this.mesh);
    this.pickMesh?.geometry.dispose();
    this.pickMaterial?.dispose();
    this.pickTarget?.dispose();
    this.pickMesh = null;
    this.pickMaterial = null;
    this.pickTarget = null;
    this.pickScene = null;
    this.buffers?.geometry.dispose();
    this.buffers?.stickerData.dispose();
    this.faceColorTexture?.dispose();
    this.material?.dispose();
    this.mesh = null;
    this.buffers = null;
    this.material = null;
    this.faceColorTexture = null;
  }

  dispose(): void {
    this.disposePuzzle();
    this.renderer.dispose();
  }
}
