import * as THREE from 'three';
import type { SharedUniforms } from '../core/uniforms';

/** One lamp on a boat (boat-local position). */
export interface BoatLamp {
  x: number;
  y: number;
  z: number;
  color: string;
  /** Radius of its glow halo (m). */
  halo: number;
  /** Strength of its reflection streak on the sea (0 = none). */
  streak: number;
}

/** Sun elevation (sin) where the lamps start to come on, and where they are fully on. */
const ON_FROM = 0.08;
const ON_AT = -0.04;

/** Shared GLSL: hash value noise, and the linear-fog fade for additive things (no fog colour). */
const COMMON = /* glsl */ `
float bl_hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float bl_noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(bl_hash(i), bl_hash(i + vec2(1.0, 0.0)), u.x), mix(bl_hash(i + vec2(0.0, 1.0)), bl_hash(i + 1.0), u.x), u.y);
}
`;

// ---- Bulbs and lit windows: dark glass by day, bright at night (over 1 → the tone mapper
// whitens their cores, like a camera would). ----
const LIT_VERT = /* glsl */ `
varying vec3 vColor;
#include <fog_pars_vertex>
void main() {
  vColor = color;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;
const LIT_FRAG = /* glsl */ `
uniform float uOn;
varying vec3 vColor;
#include <fog_pars_fragment>
void main() {
  vec3 off = vec3(0.13, 0.17, 0.2);
  gl_FragColor = vec4(mix(off, vColor * 3.0, uOn), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

// ---- Halos: camera-facing soft discs around each lamp, added on top (a cheap bloom). ----
const HALO_VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec3 iColor;
attribute float iSize;
varying vec2 vUv;
varying vec3 vColor;
varying float vDepth;
void main() {
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  // Never smaller than ~0.5° on screen: far lights glow like they do to the eye (nearby bulbs
  // then melt into one glow, as they would).
  float size = max(iSize, -mv.z * 0.0045);
  mv.xy += position.xy * size * 2.0;
  // In front of the lamp's own fitting, so the cabin doesn't cut the halo in half.
  mv.z += size * 0.8;
  vUv = position.xy * 2.0;
  vColor = iColor;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;
const HALO_FRAG = /* glsl */ `
uniform float uOn;
uniform float fogNear;
uniform float fogFar;
varying vec2 vUv;
varying vec3 vColor;
varying float vDepth;
void main() {
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0) discard;
  // Wide soft glow plus a tight bright core.
  float a = exp(-r2 * 6.0) * 0.4 + exp(-r2 * 45.0) * 1.1;
  a *= uOn * (1.0 - smoothstep(fogNear, fogFar, vDepth));
  gl_FragColor = vec4(vColor * a, 1.0);
  #include <colorspace_fragment>
}
`;

// ---- Reflection streaks: each lamp lays a broken, shimmering column of light on the sea,
// running from under the lamp toward the viewer (longer and more broken in rough water). ----
const STREAK_VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec3 iColor;
attribute float iPower;
uniform float uWave;
varying vec2 vLocal;   // across (−1..1), along (0 at the lamp … 1 toward you)
varying vec2 vXZ;
varying vec3 vColor;
varying float vPower;
varying float vDepth;
void main() {
  vec3 P = (modelMatrix * vec4(iPos, 1.0)).xyz;
  vec2 toCam = cameraPosition.xz - P.xz;
  float dc = max(length(toCam), 1.0);
  vec2 d = toCam / dc;
  vec2 side = vec2(-d.y, d.x);
  // Higher lamps and rougher seas reflect over a longer stretch of water.
  float len = min(dc * 0.8, (14.0 + 50.0 * uWave) * (0.55 + 0.45 * clamp(P.y / 9.0, 0.0, 1.0)));
  // At least ~0.25° wide on screen, so a far boat's reflections still read.
  float wid = max(0.35 + 0.9 * uWave, length(cameraPosition - P) * 0.0045) * (0.7 + 0.8 * position.y);
  vec2 xz = P.xz + d * position.y * len + side * position.x * wid;
  vec4 mv = viewMatrix * vec4(xz.x, 0.02, xz.y, 1.0);
  // Pulled a little toward the eye so wave crests don't swallow it (same place on screen).
  mv.xyz -= normalize(mv.xyz) * 2.5;
  vLocal = vec2(position.x * 2.0, position.y);
  vXZ = xz;
  vColor = iColor;
  vPower = iPower;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;
const STREAK_FRAG = /* glsl */ `
uniform float uOn;
uniform float uTime;
uniform float fogNear;
uniform float fogFar;
varying vec2 vLocal;
varying vec2 vXZ;
varying vec3 vColor;
varying float vPower;
varying float vDepth;
${COMMON}
void main() {
  float across = 1.0 - smoothstep(0.15, 1.0, abs(vLocal.x));
  float along = smoothstep(0.0, 0.04, vLocal.y) * pow(1.0 - vLocal.y, 1.3);
  // Glints: thin bands across the column (wave crests that mirror the lamp), broken up and
  // flickering as the waves move.
  float bands = bl_noise(vec2(vLocal.y * 38.0 - uTime * 1.8, vLocal.x * 1.5));
  float n = bands * bl_noise(vXZ * 0.9 + vec2(uTime * 0.5, -uTime * 0.9));
  float glint = smoothstep(0.15, 0.45, n);
  float a = across * along * mix(0.25, 2.8 * glint, 0.85) * vPower * uOn;
  a *= 1.0 - smoothstep(fogNear, fogFar, vDepth);
  gl_FragColor = vec4(vColor * a, 1.0);
  #include <colorspace_fragment>
}
`;

// ---- The pool: the bright lamps light the water round the boat (squid boats fish in it). ----
const POOL_VERT = /* glsl */ `
varying vec2 vUv;
varying vec2 vXZ;
varying float vDepth;
void main() {
  vUv = position.xy;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vXZ = w.xz;
  vec4 mv = viewMatrix * vec4(w.x, 0.03, w.z, 1.0);
  mv.xyz -= normalize(mv.xyz) * 0.8;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;
const POOL_FRAG = /* glsl */ `
uniform float uOn;
uniform float uTime;
uniform vec3 uColor;
uniform float fogNear;
uniform float fogFar;
varying vec2 vUv;
varying vec2 vXZ;
varying float vDepth;
${COMMON}
void main() {
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0) discard;
  float ripple = 0.75 + 0.5 * bl_noise(vXZ * 0.8 + vec2(uTime * 0.4, -uTime * 0.3));
  // Gaussian falloff reaching ~0 well inside the disc, so its edge never shows.
  float a = exp(-r2 * 6.0) * 0.2 * ripple * uOn * (1.0 - smoothstep(fogNear, fogFar, vDepth));
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <colorspace_fragment>
}
`;

/**
 * Night lights of a boat: bulbs and lit windows, halos round the lamps, their reflections on
 * the sea and a pool of light on the water. Children of the boat (they move with it). Four
 * draw calls; no three.js lights, so no shader in the scene has to change. They come on at
 * dusk and go off at dawn.
 */
export class BoatLights {
  readonly group = new THREE.Group();
  /** Lie on the sea: keep them out of the refraction capture and the planar reflection. */
  readonly onWater: THREE.Object3D[];
  /** Above the sea: out of the refraction capture only (the reflection may mirror them). */
  readonly aboveWater: THREE.Object3D[];
  private readonly on = { value: 0 };

  constructor(
    lamps: readonly BoatLamp[],
    /** Lit windows etc. (vertex colour = the colour when lit), boat-local. */
    glow: THREE.BufferGeometry,
    pool: { x: number; z: number; radius: number; color: string },
    private readonly shared: SharedUniforms,
  ) {
    this.group.name = 'boat-lights';
    const fog = (): Record<string, THREE.IUniform> => THREE.UniformsUtils.clone(THREE.UniformsLib.fog);

    // Bulbs (small spheres) merged with the window glow.
    const bulbs: THREE.BufferGeometry[] = [glow];
    for (const l of lamps) {
      const g = new THREE.SphereGeometry(Math.min(0.16, l.halo * 0.12), 8, 6).toNonIndexed();
      g.translate(l.x, l.y, l.z);
      const c = new THREE.Color(l.color);
      const col = new Float32Array(g.getAttribute('position').count * 3);
      for (let i = 0; i < col.length; i += 3) col.set([c.r, c.g, c.b], i);
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.deleteAttribute('uv');
      g.deleteAttribute('normal');
      bulbs.push(g);
    }
    const lit = new THREE.Mesh(
      mergePositionsColors(bulbs),
      new THREE.ShaderMaterial({ uniforms: { ...fog(), uOn: this.on }, vertexShader: LIT_VERT, fragmentShader: LIT_FRAG, vertexColors: true, fog: true }),
    );
    lit.name = 'boat-bulbs';

    // Instanced quads for halos and streaks.
    const quad = (y0: number): THREE.InstancedBufferGeometry => {
      const p = new THREE.PlaneGeometry(1, 1).translate(0, y0, 0);
      const g = new THREE.InstancedBufferGeometry();
      g.index = p.index;
      g.setAttribute('position', p.getAttribute('position'));
      return g;
    };
    const iPos = new Float32Array(lamps.length * 3);
    const iColor = new Float32Array(lamps.length * 3);
    const iSize = new Float32Array(lamps.length);
    lamps.forEach((l, i) => {
      const c = new THREE.Color(l.color);
      iPos.set([l.x, l.y, l.z], i * 3);
      iColor.set([c.r, c.g, c.b], i * 3);
      iSize[i] = l.halo;
    });
    const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true } as const;
    const haloGeo = quad(0);
    haloGeo.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 3));
    haloGeo.setAttribute('iColor', new THREE.InstancedBufferAttribute(iColor, 3));
    haloGeo.setAttribute('iSize', new THREE.InstancedBufferAttribute(iSize, 1));
    haloGeo.instanceCount = lamps.length;
    const halos = new THREE.Mesh(
      haloGeo,
      new THREE.ShaderMaterial({ uniforms: { ...fog(), uOn: this.on }, vertexShader: HALO_VERT, fragmentShader: HALO_FRAG, ...additive }),
    );
    halos.name = 'boat-halos';
    halos.renderOrder = 3;

    const streaky = lamps.filter((l) => l.streak > 0);
    const sPos = new Float32Array(streaky.length * 3);
    const sColor = new Float32Array(streaky.length * 3);
    const sPower = new Float32Array(streaky.length);
    streaky.forEach((l, i) => {
      const c = new THREE.Color(l.color);
      sPos.set([l.x, l.y, l.z], i * 3);
      sColor.set([c.r, c.g, c.b], i * 3);
      sPower[i] = l.streak;
    });
    const streakGeo = quad(0.5);
    streakGeo.setAttribute('iPos', new THREE.InstancedBufferAttribute(sPos, 3));
    streakGeo.setAttribute('iColor', new THREE.InstancedBufferAttribute(sColor, 3));
    streakGeo.setAttribute('iPower', new THREE.InstancedBufferAttribute(sPower, 1));
    streakGeo.instanceCount = streaky.length;
    const streaks = new THREE.Mesh(
      streakGeo,
      new THREE.ShaderMaterial({
        uniforms: { ...fog(), uOn: this.on, uTime: shared.uTime, uWave: shared.uWaveStrength },
        vertexShader: STREAK_VERT,
        fragmentShader: STREAK_FRAG,
        ...additive,
      }),
    );
    streaks.name = 'boat-streaks';
    // After the water, before the rain.
    streaks.renderOrder = 1.5;

    const poolMesh = new THREE.Mesh(
      new THREE.CircleGeometry(1, 40),
      new THREE.ShaderMaterial({
        uniforms: { ...fog(), uOn: this.on, uTime: shared.uTime, uColor: { value: new THREE.Color(pool.color) } },
        vertexShader: POOL_VERT,
        fragmentShader: POOL_FRAG,
        ...additive,
      }),
    );
    poolMesh.name = 'boat-light-pool';
    poolMesh.rotation.x = -Math.PI / 2;
    poolMesh.position.set(pool.x, 0, pool.z);
    poolMesh.scale.setScalar(pool.radius);
    poolMesh.renderOrder = 1.5;

    for (const m of [lit, halos, streaks, poolMesh]) m.frustumCulled = false;
    this.group.add(lit, halos, streaks, poolMesh);
    this.onWater = [streaks, poolMesh];
    this.aboveWater = [halos];
    this.group.visible = false;
  }

  /** Every frame: on from dusk to dawn (by the sun's height), off (and not drawn) by day. */
  update(): void {
    const e = this.shared.uSunDir.value.y;
    const t = Math.min(1, Math.max(0, (ON_FROM - e) / (ON_FROM - ON_AT)));
    this.on.value = t * t * (3 - 2 * t);
    // By day the bulbs still show (dark glass); the rest is skipped.
    const night = this.on.value > 0.001;
    for (const o of this.group.children) o.visible = night || o.name === 'boat-bulbs';
    this.group.visible = true;
  }
}

/** Merges position + colour of non-indexed geometries. */
function mergePositionsColors(input: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const geos = input.map((g) => {
    if (!g.index) return g;
    const flat = g.toNonIndexed();
    g.dispose();
    return flat;
  });
  let n = 0;
  for (const g of geos) n += g.getAttribute('position').count;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  let o = 0;
  for (const g of geos) {
    const c = g.getAttribute('position').count;
    pos.set(g.getAttribute('position').array as Float32Array, o * 3);
    col.set(g.getAttribute('color').array as Float32Array, o * 3);
    o += c;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}
