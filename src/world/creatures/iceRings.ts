import * as THREE from 'three';
import type { SharedUniforms } from '../../core/uniforms';
import { CRYSTAL_FRAG, crystalUniforms, shardGeometry } from './iceCrystals';
import { FIRE_BLENDING, FIRE_BLEND_GLSL } from './fireBlend';

/** Rings drawn at once (a course has at most 13). */
const MAX = 16;
/** Shards flying at once (a ring breaks into ~110). */
const SHARDS = 1000;
/** Sparkles round each ring (orbiting stars and snow motes swirling in). */
const SPARKS = 72;
/** Seconds a ring takes to form, to melt away, and its burst to spread when flown through. */
const FORM = 0.8;
const MELT = 0.9;
const BURST = 0.55;
/** The ice tube's radius (m), never thinner on screen than `minPx` pixels. */
const TUBE = { radius: 0.045, minPx: 1.1 } as const;
/** The flat layer (halo, snowflake seal, burst) reaches this many radii out. */
const DISC = 2.5;

// ---- Shared GLSL ----

const COMMON = /* glsl */ `
#define PI 3.14159265
// A frame: a circle of radius R, or (hex > 0.5) a hexagon with its corners on R at 0°, 60° …
float frameR(float th, float R, float hex) {
  if (hex < 0.5) return R;
  float phi = mod(th, PI / 3.0) - PI / 6.0;
  return R * cos(PI / 6.0) / cos(phi);
}
float hash1(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
vec3 hash3(vec3 p) {
  return fract(sin(vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)))) * 43758.5453);
}
float easeOutBack(float x) {
  const float c1 = 1.7;
  const float c3 = c1 + 1.0;
  return 1.0 + c3 * pow(x - 1.0, 3.0) + c1 * pow(x - 1.0, 2.0);
}
`;

// ---- The ice tube ----

const CORE_VERT = /* glsl */ `
${COMMON}
// u: round the frame (0 … 1); v: round the tube (0 … 1)
attribute vec2 aUV;
// birth, end (shader time), mode (0: flown through, 1: melts), seed
attribute vec4 aState;
// radius, hexagon (0 / 1), glow (0 … 1), spin direction (±1)
attribute vec4 aShape;
uniform float uTime;
uniform float uPx;
varying vec3 vWorld;
varying vec3 vN;
varying float vFade;
varying float vGlow;
varying float vSweep;
varying float vU;
void main() {
  float age = uTime - aState.x;
  float gone = uTime - aState.y;
  float melt = aState.z > 0.5 ? clamp(gone / ${MELT.toFixed(2)}, 0.0, 1.0) : step(0.0, gone);
  if (age <= 0.0 || melt >= 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float k = clamp(age / ${FORM.toFixed(2)}, 0.0, 1.0);
  // Forming: it spins in and swells a little past its size, drawn on round the frame.
  float R = aShape.x * easeOutBack(k) * (1.0 - 0.15 * melt);
  float t0 = aUV.x * 2.0 * PI;
  float r = frameR(t0, R, aShape.y);
  // Outward across the frame: radial on a circle, the side's normal on a hexagon.
  float side = t0 - (mod(t0, PI / 3.0) - PI / 6.0);
  vec2 out0 = aShape.y > 0.5 ? vec2(cos(side), sin(side)) : vec2(cos(t0), sin(t0));
  float spin = (1.0 - k) * (1.0 - k) * 2.5 * aShape.w;
  mat2 turn = mat2(cos(spin), sin(spin), -sin(spin), cos(spin));
  vec2 dir = turn * vec2(cos(t0), sin(t0));
  vec2 out2 = turn * out0;
  vec3 centre = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  // Thin, but never thinner than a pixel or so (far rings stay crisp, no flicker).
  float tube = max(${TUBE.radius.toFixed(3)}, ${TUBE.minPx.toFixed(2)} * distance(cameraPosition, centre) / uPx);
  float v = aUV.y * 2.0 * PI;
  vec3 n = vec3(out2 * cos(v), sin(v));
  vec3 p = vec3(dir * r, 0.0) + n * tube;
  vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
  w.y -= melt * melt * 2.0;
  vWorld = w.xyz;
  vN = mat3(modelMatrix * instanceMatrix) * n;
  vFade = 1.0 - melt;
  vGlow = aShape.z;
  vSweep = k * 1.15;
  vU = aUV.x;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const CORE_FRAG = /* glsl */ `
${COMMON}
uniform float uTime;
uniform vec3 uLightDir;
uniform float uDayLight;
varying vec3 vWorld;
varying vec3 vN;
varying float vFade;
varying float vGlow;
varying float vSweep;
varying float vU;
${FIRE_BLEND_GLSL}
void main() {
  if (vU > vSweep) discard;
  vec3 v = normalize(cameraPosition - vWorld);
  vec3 n = normalize(vN);
  float fres = pow(1.0 - abs(dot(n, v)), 2.0);
  // Clear pale ice, white at the grazing edges with a hint of rainbow (dispersion).
  vec3 ice = mix(vec3(0.55, 0.86, 1.0), vec3(1.0), 0.3 + 0.7 * fres);
  ice += (0.5 + 0.5 * cos(6.2832 * (fres * 1.4 + vec3(0.0, 0.33, 0.67)))) * fres * 0.3;
  float spec = pow(max(dot(reflect(-uLightDir, n), v), 0.0), 50.0);
  // Glitter (after Shopf; Wang & Bowles): ice grains in a jittered 3D grid, each with its own
  // facing; one flashes when the light reflects off it toward you, so they wink as you move.
  vec3 cell = floor(vWorld * 10.0);
  vec3 facet = normalize(hash3(cell) - 0.5);
  float flash = pow(max(dot(facet, normalize(v + uLightDir)), 0.0), 90.0) * step(0.5, hash1(cell));
  // … and a few twinkle on their own (at night too).
  flash += step(0.97, hash1(cell + floor(uTime * 4.0 + hash1(cell) * 4.0)));
  vec3 col = ice * (0.75 + 0.75 * vGlow) + vec3(1.0) * (spec * 1.2 + flash * 2.2);
  gl_FragColor = fireBlend(col, (0.8 + 0.2 * fres) * vFade, uDayLight);
}
`;

// ---- The flat layer: halo, snowflake seal, ornaments, film, burst ----

const DISC_VERT = /* glsl */ `
attribute vec4 aState;
attribute vec4 aShape;
uniform float uTime;
varying vec2 vP;
varying vec3 vWorld;
varying vec3 vN;
varying vec4 vState;
varying vec4 vShape;
void main() {
  float age = uTime - aState.x;
  float gone = uTime - aState.y;
  // Shown from birth until it has melted, or its burst has spread.
  float last = aState.z > 0.5 ? ${MELT.toFixed(2)} : ${BURST.toFixed(2)};
  if (age <= 0.0 || gone >= last) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec2 p = position.xy * aShape.x * ${DISC.toFixed(1)};
  vec4 w = modelMatrix * instanceMatrix * vec4(p, 0.0, 1.0);
  vP = p;
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix * instanceMatrix) * vec3(0.0, 0.0, 1.0));
  vState = aState;
  vShape = aShape;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const DISC_FRAG = /* glsl */ `
${COMMON}
uniform float uTime;
uniform float uDayLight;
varying vec2 vP;
varying vec3 vWorld;
varying vec3 vN;
varying vec4 vState;
varying vec4 vShape;
${FIRE_BLEND_GLSL}
// Distance to the frame's outline (m): a circle, or the hexagon's sides.
float frameDist(vec2 p, float R, float hex) {
  if (hex < 0.5) return length(p) - R;
  float th = atan(p.y, p.x);
  float side = th - (mod(th, PI / 3.0) - PI / 6.0);
  return dot(p, vec2(cos(side), sin(side))) - R * cos(PI / 6.0);
}
float seg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}
// A six-armed snowflake (radius 1), as snow grows: a hexagonal plate in the middle, arms with
// side branches at 60° (Frozen's "branching and plating"). Distance to its lines.
float flake(vec2 q) {
  float r = length(q);
  float a = mod(atan(q.y, q.x) + PI / 6.0, PI / 3.0) - PI / 6.0;
  vec2 f = r * vec2(cos(abs(a)), sin(abs(a)));
  vec2 b = vec2(0.5, 0.866);
  float d = seg(f, vec2(0.17, 0.0), vec2(0.86, 0.0));
  d = min(d, seg(f, vec2(0.38, 0.0), vec2(0.38, 0.0) + 0.22 * b));
  d = min(d, seg(f, vec2(0.55, 0.0), vec2(0.55, 0.0) + 0.16 * b));
  d = min(d, seg(f, vec2(0.7, 0.0), vec2(0.7, 0.0) + 0.1 * b));
  // The plate: a small hexagon with its corners on the arms.
  d = min(d, abs(dot(f, vec2(0.866, 0.5)) - 0.17 * 0.866));
  return d;
}
float line(float d, float w) {
  float fw = fwidth(d);
  return 1.0 - smoothstep(w, w + fw * 1.5, d);
}
void main() {
  float R = vShape.x;
  float hex = vShape.y;
  float glow = vShape.z;
  float age = uTime - vState.x;
  float gone = uTime - vState.y;
  float k = clamp(age / ${FORM.toFixed(2)}, 0.0, 1.0);
  float df = frameDist(vP, R, hex);
  vec3 tint = vec3(0.6, 0.9, 1.0);
  vec3 col = vec3(0.0);
  float a = 0.0;
  if (vState.z < 0.5 && gone >= 0.0) {
    // Flown through: a thin ring of light races out from the frame and a flash fills it.
    float b = gone / ${BURST.toFixed(2)};
    float s = 1.0 + 1.4 * b;
    float d = abs(frameDist(vP / s, R, hex)) * s;
    float ring = exp(-d * d / (0.04 + 0.25 * b * b)) * (1.0 - b) * (1.0 - b);
    float fill = exp(-b * 7.0) * step(df, 0.0) * 0.35;
    col = vec3(0.85, 0.97, 1.0) * (ring * 1.6 + fill);
    a = clamp(ring + fill, 0.0, 1.0);
    gl_FragColor = fireBlend(col, a, uDayLight);
    return;
  }
  float fade = vState.z > 0.5 && gone >= 0.0 ? 1.0 - clamp(gone / ${MELT.toFixed(2)}, 0.0, 1.0) : 1.0;
  float level = 0.25 + 0.75 * smoothstep(0.05, 0.4, glow);
  // A soft halo hugging the frame (inside and out).
  float hw = 0.25 + 0.05 * R;
  float halo = exp(-df * df / (hw * hw)) * (0.18 + 0.4 * glow) * k;
  // The snowflake seal inside, turning slowly; it unfurls from the middle as the ring forms.
  float rot = uTime * 0.18 * vShape.w + vState.w * 6.2832;
  vec2 q = mat2(cos(rot), sin(rot), -sin(rot), cos(rot)) * vP / (R * 0.82);
  float reveal = 1.0 - smoothstep(k * 1.2 - 0.15, k * 1.2, length(q));
  float fd = flake(q) * R * 0.82;
  float seal = line(fd, 0.022) * reveal * 0.8;
  float sealGlow = exp(-pow(fd / 0.14, 2.0)) * 0.22 * reveal;
  // A dashed circle just inside the frame (a rune ring).
  float rq = length(vP) / R;
  float dash = step(0.45, fract(atan(vP.y, vP.x) / (2.0 * PI) * 48.0 + uTime * 0.05 * vShape.w));
  float runes = line(abs(rq - 0.9) * R, 0.02) * dash * k;
  // Six small snowflakes on the frame (on a hexagon's corners).
  float th = atan(vP.y, vP.x);
  float sector = floor((th + PI / 6.0) / (PI / 3.0));
  float ca = sector * PI / 3.0;
  vec2 c = R * vec2(cos(ca), sin(ca));
  float orn = line(flake((vP - c) / (0.17 * R)) * 0.17 * R, 0.025) * smoothstep(0.6, 1.0, k);
  // The film across the hole: nearly clear, colours swirling only at a grazing look.
  float inside = 1.0 - smoothstep(-0.05, 0.05, df);
  float graze = 1.0 - abs(dot(vN, normalize(cameraPosition - vWorld)));
  float th2 = hash1(floor(vec3(vP * 1.5, 0.0))) * 0.2 + length(vP) / R * 0.6 + uTime * 0.05;
  vec3 film = 0.5 + 0.5 * cos(6.2832 * (th2 + vec3(0.0, 0.33, 0.67)));
  float filmA = inside * (0.02 + 0.12 * graze * graze) * k;
  // Glints on the seal's lines (the same winking grains as the tube).
  vec3 cell = floor(vec3(vP * 6.0, 0.0));
  float wink = step(0.93, hash1(cell + floor(uTime * 5.0 + hash1(cell) * 5.0)));
  float lines = (seal + sealGlow) * level + runes * 0.5 * level + orn * (0.6 + 0.4 * glow);
  col = tint * halo + vec3(0.92, 0.98, 1.0) * lines + vec3(1.0) * wink * (seal + orn) * 1.5 + film * filmA;
  a = clamp(halo + lines + filmA + wink * (seal + orn), 0.0, 1.0) * fade;
  if (a < 0.003) discard;
  gl_FragColor = fireBlend(col / max(a, 0.001) * fade, a, uDayLight);
}
`;

// ---- Sparkles round the rings (one Points mesh for all of them) ----

const SPARK_VERT = /* glsl */ `
${COMMON}
// ring slot, phase (0 … 1), speed, kind (0: orbiting star, 1: snow mote swirling in)
attribute vec4 aSpark;
uniform float uTime;
uniform float uScale;
uniform mat4 uRingM[${MAX}];
// radius, hexagon, glow, spin direction
uniform vec4 uRingS[${MAX}];
// birth, end, mode, seed
uniform vec4 uRingT[${MAX}];
varying float vBright;
varying float vSnow;
void main() {
  int i = int(aSpark.x);
  vec4 S = uRingS[i];
  vec4 T = uRingT[i];
  float age = uTime - T.x;
  float gone = uTime - T.y;
  float level = 0.15 + 0.85 * smoothstep(0.05, 0.4, S.z);
  float burst = T.z < 0.5 && gone >= 0.0 ? gone / 0.8 : 0.0;
  float melt = T.z > 0.5 && gone >= 0.0 ? gone / ${MELT.toFixed(2)} : 0.0;
  if (age <= 0.0 || burst >= 1.0 || melt >= 1.0 || (aSpark.w > 0.5 && level < 0.5)) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float ph = aSpark.y;
  float th = ph * 2.0 * PI + uTime * aSpark.z * S.w * (1.0 + S.z);
  float r;
  float z;
  float fade = 1.0;
  if (aSpark.w < 0.5) {
    // Orbiting the frame, bobbing in and out of its plane.
    r = frameR(th, S.x, S.y) * (0.84 + 0.34 * fract(ph * 29.0) + 0.05 * sin(uTime * 2.0 + ph * 40.0));
    z = 0.6 * sin(uTime * 1.7 + ph * 31.0);
  } else {
    // Snow drawn in toward the middle in a spiral, fading in and out.
    float s = fract(uTime * 0.22 + ph * 7.0);
    th += s * 2.5;
    r = frameR(th, S.x, S.y) * (1.05 - 0.9 * s);
    z = 0.15 * sin(ph * 50.0);
    fade = sin(PI * s);
  }
  // Flown through: they all fly outward and fade.
  r += burst * 9.0 * (0.6 + 0.4 * fract(ph * 13.0));
  z += burst * 3.0 * (fract(ph * 17.0) - 0.5);
  float grow = smoothstep(0.0, ${FORM.toFixed(2)}, age);
  vec4 w = uRingM[i] * vec4(cos(th) * r * grow, sin(th) * r * grow, z, 1.0);
  vec4 mv = viewMatrix * w;
  gl_Position = projectionMatrix * mv;
  // Each winks on its own beat.
  float tw = pow(0.5 + 0.5 * sin(uTime * (5.0 + 9.0 * fract(ph * 23.0)) + ph * 60.0), 4.0);
  vBright = (0.35 + 0.65 * tw) * level * fade * (1.0 - burst) * (1.0 - melt);
  vSnow = aSpark.w;
  float size = aSpark.w > 0.5 ? 0.12 : 0.26 + 0.2 * tw;
  gl_PointSize = clamp(size * uScale / -mv.z, 2.0, 22.0);
}
`;

const SPARK_FRAG = /* glsl */ `
uniform float uDayLight;
varying float vBright;
varying float vSnow;
${FIRE_BLEND_GLSL}
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  // A four-pointed star (a glint's cross) round a bright point; snow motes are soft dots.
  float star = max(exp(-abs(c.x) * 8.0) * exp(-abs(c.y) * 2.2), exp(-abs(c.y) * 8.0) * exp(-abs(c.x) * 2.2));
  float dot2 = exp(-dot(c, c) * 5.0);
  float s = vSnow > 0.5 ? dot2 : star + dot2;
  float a = clamp(s * vBright, 0.0, 1.0);
  if (a < 0.01) discard;
  gl_FragColor = fireBlend(vec3(0.9, 0.98, 1.0) * 1.6, min(1.0, a * 1.3), uDayLight);
}
`;

// ---- Shards ----

const SHARD_VERT = /* glsl */ `
attribute float aH;
attribute vec3 aOrigin;
attribute vec3 aVel;
// spin axis (unit) and rate (rad/s)
attribute vec4 aSpin;
// start (shader time), life (s), size (m), seed
attribute vec4 aLife;
uniform float uTime;
varying vec3 vWorld;
varying vec3 vLocal;
varying float vH;
varying float vSeed;
varying float vFresh;
vec3 rotate(vec3 v, vec3 k, float a) {
  return v * cos(a) + cross(k, v) * sin(a) + k * dot(k, v) * (1.0 - cos(a));
}
void main() {
  float t = uTime - aLife.x;
  if (t < 0.0 || t > aLife.y) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  // Thrown out, slowed by the air, falling; shrinking away at the end. All from the time since
  // the break: nothing per frame on the CPU.
  float k = t / aLife.y;
  float s = aLife.z * (1.0 - smoothstep(0.55, 1.0, k));
  vec3 p = rotate(position * s, aSpin.xyz, aSpin.w * t + aLife.w * 6.2832);
  float d = (1.0 - exp(-1.3 * t)) / 1.3;
  vec3 w = aOrigin + aVel * d + vec3(0.0, -4.2 * t * t, 0.0) + p;
  vWorld = w;
  vLocal = position * 2.0;
  vH = 0.6 + 0.4 * aH;
  vSeed = aLife.w;
  vFresh = 1.4 * exp(-t * 3.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
`;

/** The tube as a grid: u round the frame (one vertex per 3°), v round the tube. */
function tubeGeometry(): THREE.BufferGeometry {
  const U = 120;
  const V = 6;
  const uv: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= U; i++) for (let j = 0; j <= V; j++) uv.push(i / U, j / V);
  for (let i = 0; i < U; i++) {
    for (let j = 0; j < V; j++) {
      const a = i * (V + 1) + j;
      const b = a + V + 1;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  // (Positions come from aUV in the shader; three.js still wants a position attribute.)
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(uv.length * 1.5), 3));
  g.setAttribute('aUV', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  return g;
}

const Z = new THREE.Vector3(0, 0, 1);
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);

export interface RingSpec {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  radius: number;
  seed: number;
  /** A hexagonal frame (a snowflake's outline) instead of a circle. */
  hex?: boolean;
}

/**
 * The ice rings of Vòng Tròn Băng Giá (see RingCourse), in layers as magic-ring effects are
 * built: a thin tube of clear ice (a circle or a snowflake's hexagon) that glints as you move,
 * a soft halo, a six-armed snowflake seal turning inside it with a dashed rune ring and six
 * small snowflakes on the frame, a nearly clear film, and star-shaped sparkles orbiting it with
 * snow swirling in. Flown through: a ring of light races out, the sparkles scatter and the ice
 * bursts into shards. Four draw calls in all; everything moves in the vertex shaders.
 */
export class IceRings {
  readonly cores: THREE.InstancedMesh;
  readonly discs: THREE.InstancedMesh;
  readonly sparks: THREE.Points;
  readonly shards: THREE.InstancedMesh;
  private readonly state: THREE.InstancedBufferAttribute;
  private readonly shape: THREE.InstancedBufferAttribute;
  private readonly ringM: THREE.Matrix4[] = Array.from({ length: MAX }, () => new THREE.Matrix4());
  private readonly ringS: THREE.Vector4[] = Array.from({ length: MAX }, () => new THREE.Vector4());
  private readonly ringT: THREE.Vector4[] = Array.from({ length: MAX }, () => new THREE.Vector4(1e9, 1e9, 1, 0));
  private readonly sparkScale = { value: 600 };
  private readonly px = { value: 600 };
  private readonly origin: THREE.InstancedBufferAttribute;
  private readonly vel: THREE.InstancedBufferAttribute;
  private readonly spin: THREE.InstancedBufferAttribute;
  private readonly life: THREE.InstancedBufferAttribute;
  private readonly specs: (RingSpec | null)[] = Array.from({ length: MAX }, () => null);
  private nextShard = 0;
  private lastShard = -1e9;
  private lastRing = -1e9;

  constructor(shared: SharedUniforms) {
    const dyn = (n: number, size: number, fill = 0): THREE.InstancedBufferAttribute =>
      new THREE.InstancedBufferAttribute(new Float32Array(n * size).fill(fill), size).setUsage(THREE.DynamicDrawUsage);
    this.state = dyn(MAX, 4, 1e9);
    this.shape = dyn(MAX, 4, 1);
    const tube = tubeGeometry();
    tube.setAttribute('aState', this.state);
    tube.setAttribute('aShape', this.shape);
    const glowy = { transparent: true, depthWrite: false, ...FIRE_BLENDING } as const;
    this.cores = new THREE.InstancedMesh(
      tube,
      new THREE.ShaderMaterial({
        uniforms: { uTime: shared.uTime, uLightDir: shared.uLightDir, uDayLight: shared.uDayLight, uPx: this.px },
        vertexShader: CORE_VERT,
        fragmentShader: CORE_FRAG,
        ...glowy,
      }),
      MAX,
    );
    const disc = new THREE.PlaneGeometry(2, 2);
    disc.setAttribute('aState', this.state);
    disc.setAttribute('aShape', this.shape);
    this.discs = new THREE.InstancedMesh(
      disc,
      new THREE.ShaderMaterial({
        uniforms: { uTime: shared.uTime, uDayLight: shared.uDayLight },
        vertexShader: DISC_VERT,
        fragmentShader: DISC_FRAG,
        side: THREE.DoubleSide,
        ...glowy,
      }),
      MAX,
    );
    // Sparkles: SPARKS per ring slot, a third of them snow swirling in.
    const sparkData = new Float32Array(MAX * SPARKS * 4);
    for (let i = 0; i < MAX; i++) {
      for (let j = 0; j < SPARKS; j++) {
        const o = (i * SPARKS + j) * 4;
        sparkData[o] = i;
        sparkData[o + 1] = Math.random();
        sparkData[o + 2] = 0.25 + Math.random() * 0.45;
        sparkData[o + 3] = j % 3 === 0 ? 1 : 0;
      }
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(MAX * SPARKS * 3), 3));
    sg.setAttribute('aSpark', new THREE.Float32BufferAttribute(sparkData, 4));
    this.sparks = new THREE.Points(
      sg,
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: shared.uTime,
          uDayLight: shared.uDayLight,
          uScale: this.sparkScale,
          uRingM: { value: this.ringM },
          uRingS: { value: this.ringS },
          uRingT: { value: this.ringT },
        },
        vertexShader: SPARK_VERT,
        fragmentShader: SPARK_FRAG,
        ...glowy,
      }),
    );
    // Shards: little plates of ice, thrown.
    const shardGeo = shardGeometry();
    this.origin = dyn(SHARDS, 3);
    this.vel = dyn(SHARDS, 3);
    this.spin = dyn(SHARDS, 4);
    this.life = dyn(SHARDS, 4);
    for (let i = 0; i < SHARDS; i++) (this.life.array as Float32Array)[i * 4] = -1e9;
    shardGeo.setAttribute('aOrigin', this.origin);
    shardGeo.setAttribute('aVel', this.vel);
    shardGeo.setAttribute('aSpin', this.spin);
    shardGeo.setAttribute('aLife', this.life);
    this.shards = new THREE.InstancedMesh(
      shardGeo,
      new THREE.ShaderMaterial({ uniforms: crystalUniforms(shared), vertexShader: SHARD_VERT, fragmentShader: CRYSTAL_FRAG }),
      SHARDS,
    );
    for (const m of this.objects) {
      m.frustumCulled = false;
      m.visible = false;
    }
    this.cores.renderOrder = 4;
    this.discs.renderOrder = 3;
    this.sparks.renderOrder = 5;
    this.cores.name = 'ice-rings';
    this.discs.name = 'ice-ring-discs';
    this.sparks.name = 'ice-ring-sparks';
    this.shards.name = 'ice-ring-shards';
  }

  get objects(): THREE.Object3D[] {
    return [this.cores, this.discs, this.sparks, this.shards];
  }

  /** Ring `i` forms at shader time `birth` (it stands until flown through or melted). */
  show(i: number, r: RingSpec, birth: number): void {
    this.specs[i] = { ...r };
    // Facing its way, turned about it at random (the seal and the hexagon's corners).
    tmpQ.setFromUnitVectors(Z, tmpV.set(r.nx, r.ny, r.nz));
    tmpQ2.setFromAxisAngle(Z, r.seed * Math.PI * 2);
    tmpQ.multiply(tmpQ2);
    tmpM.compose(tmpS.set(r.x, r.y, r.z), tmpQ, ONE);
    this.cores.setMatrixAt(i, tmpM);
    this.discs.setMatrixAt(i, tmpM);
    this.ringM[i].copy(tmpM);
    this.cores.instanceMatrix.needsUpdate = true;
    this.discs.instanceMatrix.needsUpdate = true;
    const dir = r.seed < 0.5 ? 1 : -1;
    this.setState(i, birth, 1e9, 1, r.seed);
    const sh = this.shape.array as Float32Array;
    sh[i * 4] = r.radius;
    sh[i * 4 + 1] = r.hex ? 1 : 0;
    sh[i * 4 + 2] = 0;
    sh[i * 4 + 3] = dir;
    this.shape.needsUpdate = true;
    this.ringS[i].set(r.radius, r.hex ? 1 : 0, 0, dir);
    this.lastRing = 1e9;
    this.cores.visible = true;
    this.discs.visible = true;
    this.sparks.visible = true;
  }

  /** How bright ring `i` is (0 … 1): the next one pulses, lined up on it it shines. */
  setGlow(i: number, v: number): void {
    (this.shape.array as Float32Array)[i * 4 + 2] = v;
    this.shape.needsUpdate = true;
    this.ringS[i].z = v;
  }

  /** Ring `i` melts away from `now` (the course ended without it). */
  melt(i: number, now: number): void {
    this.end(i, now, 1);
  }

  /**
   * Flown through at `now` with velocity (vx, vy, vz): a ring of light races out, the sparkles
   * scatter, and the ice bursts into `count` shards thrown on with you.
   */
  shatter(i: number, now: number, vx: number, vy: number, vz: number, count = 110): void {
    const r = this.specs[i];
    if (!r) return;
    this.end(i, now, 0);
    tmpV.set(r.nx, r.ny, r.nz);
    // Two directions across the ring's plane.
    tmpA.set(0, 1, 0).cross(tmpV);
    if (tmpA.lengthSq() < 1e-4) tmpA.set(1, 0, 0);
    tmpA.normalize();
    tmpB.crossVectors(tmpV, tmpA);
    const o = this.origin.array as Float32Array;
    const v = this.vel.array as Float32Array;
    const sp = this.spin.array as Float32Array;
    const l = this.life.array as Float32Array;
    for (let k = 0; k < count; k++) {
      const j = this.nextShard;
      this.nextShard = (this.nextShard + 1) % SHARDS;
      const a = Math.random() * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      // Mostly the frame's ice (thrown outward), some from across the hole (carried on with you).
      const fromRim = k < count * 0.7;
      const d = fromRim ? r.radius * (0.95 + Math.random() * 0.1) : r.radius * Math.sqrt(Math.random()) * 0.9;
      const out = fromRim ? 3 + Math.random() * 6 : 1 + Math.random() * 3;
      const on = fromRim ? 0.15 + Math.random() * 0.35 : 0.35 + Math.random() * 0.45;
      o[j * 3] = r.x + (tmpA.x * c + tmpB.x * s) * d;
      o[j * 3 + 1] = r.y + (tmpA.y * c + tmpB.y * s) * d;
      o[j * 3 + 2] = r.z + (tmpA.z * c + tmpB.z * s) * d;
      v[j * 3] = (tmpA.x * c + tmpB.x * s) * out + vx * on + (Math.random() - 0.5) * 2;
      v[j * 3 + 1] = (tmpA.y * c + tmpB.y * s) * out + vy * on + Math.random() * 2;
      v[j * 3 + 2] = (tmpA.z * c + tmpB.z * s) * out + vz * on + (Math.random() - 0.5) * 2;
      tmpS.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      sp[j * 4] = tmpS.x;
      sp[j * 4 + 1] = tmpS.y;
      sp[j * 4 + 2] = tmpS.z;
      sp[j * 4 + 3] = 5 + Math.random() * 12;
      l[j * 4] = now;
      l[j * 4 + 1] = 1.2 + Math.random() * 1.1;
      // Small slivers (the tube was thin): 6 – 18 cm across.
      l[j * 4 + 2] = 0.06 + Math.random() * 0.12;
      l[j * 4 + 3] = Math.random();
    }
    for (const a of [this.origin, this.vel, this.spin, this.life]) a.needsUpdate = true;
    this.lastShard = now + 2.4;
    this.shards.visible = true;
  }

  private setState(i: number, birth: number, end: number, mode: number, seed: number): void {
    const s = this.state.array as Float32Array;
    s[i * 4] = birth;
    s[i * 4 + 1] = end;
    s[i * 4 + 2] = mode;
    s[i * 4 + 3] = seed;
    this.state.needsUpdate = true;
    this.ringT[i].set(birth, end, mode, seed);
  }

  private end(i: number, now: number, mode: number): void {
    const s = this.state.array as Float32Array;
    if (s[i * 4 + 1] < 1e8) return;
    this.setState(i, s[i * 4], now, mode, s[i * 4 + 3]);
    this.specs[i] = null;
    // Still drawn while one stands; when the last one goes, until it has melted or burst.
    if (this.specs.every((x) => x === null)) this.lastRing = now + Math.max(MELT, 0.8);
  }

  /** Hides what's done (no draw calls while nothing is out). */
  update(now: number): void {
    if (this.cores.visible && now > this.lastRing + 0.1) {
      this.cores.visible = false;
      this.discs.visible = false;
      this.sparks.visible = false;
    }
    if (this.shards.visible && now > this.lastShard) this.shards.visible = false;
  }

  /** Viewport height (px) and vertical field of view: the sparkles' size, the tube's thinnest. */
  setViewport(heightPx: number, fovDeg: number): void {
    const s = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
    this.sparkScale.value = s;
    this.px.value = s;
  }

  /** The shader clock was reset: everything goes. */
  clear(): void {
    for (let i = 0; i < MAX; i++) this.setState(i, 1e9, 1e9, 1, 0);
    (this.life.array as Float32Array).fill(-1e9);
    this.life.needsUpdate = true;
    this.specs.fill(null);
    for (const m of this.objects) m.visible = false;
  }

  dispose(): void {
    for (const m of [this.cores, this.discs, this.shards]) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.sparks.geometry.dispose();
    (this.sparks.material as THREE.Material).dispose();
  }
}
