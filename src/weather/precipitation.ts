import * as THREE from 'three';
import type { SharedUniforms } from '../core/uniforms';
import precipVert from './shaders/precip.vert.glsl?raw';
import precipFrag from './shaders/precip.frag.glsl?raw';

export interface PrecipitationOptions {
  kind: 'rain' | 'snow';
  /** Particles allocated (the High preset's maximum). */
  maxCount: number;
  /** Box around the camera (m). */
  box: THREE.Vector3;
  /** Fall speed (m/s). */
  fall: number;
  /** Rain: (width, length); snow: (diameter, unused). */
  size: THREE.Vector2;
  color: THREE.ColorRepresentation;
  opacity: number;
  /** Horizontal drift per unit of gust (m/s). */
  driftPerGust: number;
}

/**
 * One draw call for all particles. The geometry holds maxCount quads; drawing fewer is just
 * a smaller draw range, so intensity changes cost nothing.
 */
export class Precipitation {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly drift = new THREE.Vector2();
  private readonly offset = new THREE.Vector2();
  private maxForQuality: number;

  constructor(
    private readonly opts: PrecipitationOptions,
    private readonly shared: SharedUniforms,
  ) {
    this.maxForQuality = opts.maxCount;
    const n = opts.maxCount;
    const seeds = new Float32Array(n * 4 * 4);
    const corners = new Float32Array(n * 4 * 2);
    const index = new Uint32Array(n * 6);
    const cornerXY = [-0.5, 0, 0.5, 0, 0.5, 1, -0.5, 1];
    for (let i = 0; i < n; i++) {
      const sx = Math.random(), sy = Math.random(), sz = Math.random(), sw = Math.random();
      for (let v = 0; v < 4; v++) {
        seeds.set([sx, sy, sz, sw], (i * 4 + v) * 4);
        corners.set([cornerXY[v * 2], cornerXY[v * 2 + 1]], (i * 4 + v) * 2);
      }
      const b = i * 4;
      index.set([b, b + 1, b + 2, b, b + 2, b + 3], i * 6);
    }
    const g = new THREE.BufferGeometry();
    // Positions are computed in the shader; three still needs a position attribute to draw.
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 4 * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    g.setAttribute('aCorner', new THREE.BufferAttribute(corners, 2));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    g.setDrawRange(0, 0);

    const material = new THREE.ShaderMaterial({
      defines: opts.kind === 'snow' ? { SNOW: '' } : {},
      uniforms: {
        uTime: shared.uTime,
        uBox: { value: opts.box },
        uFall: { value: opts.fall },
        uDrift: { value: this.drift },
        uOffset: { value: this.offset },
        uSize: { value: opts.size },
        uColor: { value: new THREE.Color(opts.color) },
        uOpacity: { value: opts.opacity },
        uDayLight: shared.uDayLight,
        uShelter: shared.uShelter,
        uShelterSize: shared.uShelterSize,
      },
      vertexShader: precipVert,
      fragmentShader: precipFrag,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.name = opts.kind;
    this.mesh.frustumCulled = false;
    // After the water, so drops in front of the sea blend over it.
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
  }

  /** Quality preset's particle budget at full intensity. */
  setQualityMax(count: number): void {
    this.maxForQuality = Math.min(count, this.opts.maxCount);
  }

  /** amount: 0..1 of the quality budget. */
  update(amount: number, dt: number): void {
    const count = Math.round(this.maxForQuality * Math.min(1, Math.max(0, amount)));
    this.mesh.geometry.setDrawRange(0, count * 6);
    this.mesh.visible = count > 0;
    const d = this.shared.uWindDir.value;
    const k = this.shared.uGust.value * this.opts.driftPerGust;
    this.drift.set(d.x * k, d.y * k);
    // Wrap by exactly one box size: the shader wraps positions by the box too, so this is
    // invisible, and the offset stays small (good float precision over long sessions).
    const box = this.opts.box;
    this.offset.set((this.offset.x + this.drift.x * dt) % box.x, (this.offset.y + this.drift.y * dt) % box.z);
  }
}
