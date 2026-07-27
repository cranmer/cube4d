/**
 * The renderer.
 *
 * Owns a Three.js scene containing exactly one mesh — the whole puzzle — and drives it with
 * uniforms. Rotating the puzzle uploads sixteen floats; it costs the same for the 216-sticker
 * hypercube as for the 7,560-sticker 120-cell.
 */

import * as THREE from 'three';
import type { PuzzleGeometry } from '@mc4d/puzzle-core';

import { buildBuffers, buildFaceColorTexture, updateStickerColors, type PuzzleBuffers } from './buildGeometry.js';
import { facePalette, SKY, type Rgb } from './colors.js';
import { DEFAULT_VIEW, projectedRadius, type ViewParams } from './pipeline.js';
import { fragmentShader, vertexShader } from './shaders.js';

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
  /** Ambient light fraction. The original uses none; a little makes unlit faces legible. */
  readonly ambient?: number;
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
  setPuzzle(geo: PuzzleGeometry, colors: readonly Rgb[] = facePalette(geo.nFaces)): void {
    this.disposePuzzle();
    this.geo = geo;
    this.buffers = buildBuffers(geo);
    this.faceColorTexture = buildFaceColorTexture(colors);

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
        uAmbient: { value: this.options.ambient ?? 0.15 },
      },
    });

    this.mesh = new THREE.Mesh(this.buffers.geometry, this.material);
    this.mesh.frustumCulled = false; // positions are computed in the shader; a CPU bound is meaningless
    this.scene.add(this.mesh);
    this.refreshFraming();
  }

  /** Update the 4D view rotation. `mat4d` is row-major, as the puzzle core produces it. */
  setRotation(mat4d: Float64Array | readonly number[]): void {
    this.view = { ...this.view, mat4d };
    if (!this.material) return;
    // The core uses row vectors (v · M); GLSL multiplies column vectors (M · v). Loading a
    // row-major array into Three's column-major Matrix4 transposes it, which converts between the
    // two exactly. No explicit transpose is needed — or wanted.
    (this.material.uniforms.uRot4d.value as THREE.Matrix4).fromArray(Array.from(mat4d));
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
