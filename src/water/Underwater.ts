import * as THREE from 'three';
import type { SharedUniforms } from '../core/uniforms';

const DOME_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // on the far plane
}
`;

const DOME_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uSunDir;
uniform float uDayLight;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  // The fog color at and below the horizon (so the fogged seabed melts into it), brighter
  // looking up toward the light.
  vec3 col = uColor + uColor * 1.4 * smoothstep(0.0, 0.9, d.y);
  // A soft glow toward the sun, bent down into the water.
  vec3 s = normalize(vec3(uSunDir.x, max(uSunDir.y, 0.2) * 1.6, uSunDir.z));
  col += uColor * 2.0 * pow(max(dot(d, s), 0.0), 6.0) * uDayLight;
  gl_FragColor = vec4(col, 1.0);
  // No tone mapping: the fog adds its color after the tone mapper too, so the horizon here
  // must be the plain fog color for distant things to melt into it without a seam.
  #include <colorspace_fragment>
}
`;

const RAYS_VERT = /* glsl */ `
attribute vec2 iCell;   // cell offset from the camera's cell
uniform vec3 uSunDir;
uniform vec3 uCam;
uniform float uTime;
varying float vX;
varying float vY;
varying float vFade;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  // Beams belong to fixed 3 m cells of the world (they don't follow you), one per cell or none.
  vec2 cell = floor(uCam.xz / 3.0) + iCell;
  float h = hash(cell);
  float on = step(0.45, h);
  vec2 xz = (cell + vec2(hash(cell + 7.1), hash(cell + 3.3))) * 3.0;
  // Sunlight bends at the surface: steeper under water (Snell: sin t = sin i / 1.33).
  vec3 s = normalize(uSunDir);
  vec2 hor = s.xz;
  float sinI = length(hor);
  float sinT = sinI / 1.333;
  vec3 axis = normalize(vec3(hor / max(sinI, 1e-4) * sinT, sqrt(1.0 - sinT * sinT)));
  float len = 22.0;
  vec3 top = vec3(xz.x, 0.0, xz.y);
  vec3 mid = top - axis * len * 0.5;
  vec3 toCam = normalize(cameraPosition - mid);
  vec3 side = normalize(cross(axis, toCam));
  float width = mix(0.4, 1.6, hash(cell + 1.7)) * on;
  vec3 wp = top - axis * len * position.y + side * width * position.x;
  vX = position.x * 2.0;
  vY = position.y;
  // Fade with distance and flicker slowly (the waves focusing the light).
  float d = length(top.xz - uCam.xz);
  vFade = (1.0 - smoothstep(6.0, 14.0, d)) * (0.55 + 0.45 * sin(uTime * (0.6 + h) + h * 40.0));
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const RAYS_FRAG = /* glsl */ `
uniform vec3 uSunColor;
uniform float uDayLight;
uniform float uCloudCover;
varying float vX;
varying float vY;
varying float vFade;
void main() {
  float across = 1.0 - smoothstep(0.1, 1.0, abs(vX));
  float along = smoothstep(0.0, 0.08, vY) * (1.0 - smoothstep(0.35, 1.0, vY));
  float a = across * across * along * vFade * uDayLight * (1.0 - 0.8 * uCloudCover) * 0.12;
  gl_FragColor = vec4(mix(uSunColor, vec3(0.7, 1.0, 0.95), 0.5) * a, 1.0);
}
`;

/** Water colors seen from inside: near the surface, and in deep water (before light). */
const SHALLOW = new THREE.Color('#2e9fa3');
const DEEP = new THREE.Color('#0b3d63');

/**
 * Switches the scene to "under water" while the camera is below the sea surface: the sky dome
 * is hidden, the background and the fog turn sea-blue, and the fog closes in to ~25 m (deeper
 * and at night, darker). The water surface draws its own underside (water.frag, back faces:
 * the bright Snell's window overhead, mirror-like elsewhere). The same linear fog is reused
 * with other numbers, so no shader has to recompile.
 */
export class Underwater {
  under = false;
  /** Shared with the water shader (its underside fades into this). */
  readonly color = new THREE.Color();
  private readonly fog: THREE.Fog;
  private readonly airFog: { color: THREE.Color; near: number; far: number };
  /** The "sky" under water: a gradient dome around the camera (light from above). */
  private readonly dome: THREE.Mesh;
  /** Sun rays slanting down from the surface (additive, around the camera). */
  private readonly rays: THREE.Mesh;
  private readonly camPos = new THREE.Vector3();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly sky: THREE.Object3D,
    private readonly shared: SharedUniforms,
  ) {
    if (!(scene.fog instanceof THREE.Fog)) throw new Error('Underwater: expects a linear THREE.Fog');
    this.fog = scene.fog;
    this.airFog = { color: this.fog.color, near: this.fog.near, far: this.fog.far };
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(10, 24, 12),
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: this.color }, uSunDir: shared.uSunDir, uDayLight: shared.uDayLight },
        vertexShader: DOME_VERT,
        fragmentShader: DOME_FRAG,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    );
    this.dome.name = 'underwater-dome';
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1;
    this.dome.visible = false;
    scene.add(this.dome);

    // 11 × 11 cells around the camera; about half of them hold a beam.
    const n = 11;
    const cells = new Float32Array(n * n * 2);
    for (let i = 0; i < n * n; i++) {
      cells[i * 2] = (i % n) - (n >> 1);
      cells[i * 2 + 1] = Math.floor(i / n) - (n >> 1);
    }
    const quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('iCell', new THREE.InstancedBufferAttribute(cells, 2));
    geo.instanceCount = n * n;
    this.rays = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        uniforms: {
          uSunDir: shared.uSunDir,
          uSunColor: shared.uSunColor,
          uDayLight: shared.uDayLight,
          uCloudCover: shared.uCloudCover,
          uTime: shared.uTime,
          uCam: { value: this.camPos },
        },
        vertexShader: RAYS_VERT,
        fragmentShader: RAYS_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    this.rays.name = 'underwater-rays';
    this.rays.frustumCulled = false;
    this.rays.renderOrder = 4;
    this.rays.visible = false;
    scene.add(this.rays);
  }

  /** `surfaceY`: the sea surface above the camera; `depth`: how deep the camera is (m). */
  update(camera: THREE.Camera, surfaceY: number): void {
    const under = camera.position.y < surfaceY - 0.02;
    const depth = Math.max(0, surfaceY - camera.position.y);
    // Light under water: daylight, a little moon at night, dimmer the deeper you go.
    const light = (0.04 + 0.96 * this.shared.uDayLight.value) * (1 - 0.45 * Math.min(1, depth / 14)) * (1 - 0.4 * this.shared.uCloudCover.value);
    this.color.copy(SHALLOW).lerp(DEEP, Math.min(1, depth / 12)).multiplyScalar(light);
    this.dome.position.copy(camera.position);
    this.camPos.copy(camera.position);
    if (under === this.under) return;
    this.under = under;
    this.sky.visible = !under;
    this.dome.visible = under;
    this.rays.visible = under;
    if (under) {
      this.fog.color = this.color;
      this.fog.near = 0.5;
      this.fog.far = 26;
      this.scene.background = null;
    } else {
      this.fog.color = this.airFog.color;
      this.fog.near = this.airFog.near;
      this.fog.far = this.airFog.far;
      this.scene.background = null;
    }
  }
}
