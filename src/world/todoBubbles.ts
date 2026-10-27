import * as THREE from 'three';
import { BigBubble } from './creatures/bigBubble';
import type { SharedUniforms } from '../core/uniforms';

/** Pool sizes: a burst throws up to 34 small bubbles (each popping into ~7 bits) and ~90 bits. */
const MAX_BUBBLES = 160;
const MAX_BITS = 1200;
/** How long a pop lasts (s): the bubble swells, turns into a ring and fades. */
const POP = 0.2;
/** Drag on the launch speed (1/s): the small bubbles slow down and start to float. */
const DRAG = 1.6;
/** Rising speed once floating (m/s). */
const RISE = 0.11;

/**
 * Bubble motion, also evaluated on the CPU (`bubbleAt`) to know where each one pops.
 * position(t) = start + vel·(1 − e^(−DRAG·t))/DRAG + up·RISE·t + wind·t²/2 + a sideways wobble.
 */
const BUBBLE_VERT = /* glsl */ `
attribute vec3 aStart;
attribute vec3 aVel;
/** birth time, life (s until it pops), radius (m), seed 0..1 */
attribute vec4 aInfo;
uniform float uTime;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uWind;
varying vec2 vUv;
varying float vPop;
varying float vFade;
varying float vSeed;
void main() {
  float t = uTime - aInfo.x;
  float life = aInfo.y;
  if (t < 0.0 || t > life + ${POP.toFixed(2)}) {
    // Not born yet or gone: outside the clip volume, so nothing is drawn.
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float tm = min(t, life);
  float seed = aInfo.w;
  vec3 pos = aStart + aVel * (1.0 - exp(-${DRAG.toFixed(1)} * tm)) / ${DRAG.toFixed(1)}
    + vec3(0.0, ${RISE.toFixed(2)} * tm, 0.0) + uWind * (0.5 * tm * tm);
  pos += uCamRight * sin(tm * 3.1 + seed * 40.0) * 0.022;
  // Born small (a bounce past full size), the squash and stretch of a soft bubble in flight, and
  // flattening just before it pops.
  float grow = smoothstep(0.0, 0.18, t) + 0.12 * sin(clamp(t / 0.3, 0.0, 1.0) * 3.1416);
  float pop = clamp((t - life) / ${POP.toFixed(2)}, 0.0, 1.0);
  float pre = smoothstep(life - 0.16, life, tm);
  float wob = sin(tm * 9.0 + seed * 31.0) * 0.07 * (1.0 - pre);
  vec2 squash = vec2(1.0 + wob + 0.22 * pre, 1.0 - wob - 0.18 * pre);
  vec2 size = squash * aInfo.z * 2.0 * grow * (1.0 + 0.4 * pop);
  vec3 world = pos + uCamRight * position.x * size.x + uCamUp * position.y * size.y;
  vUv = uv;
  vPop = pop;
  vFade = min(grow, 1.0);
  vSeed = seed;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

/**
 * A Pokémon "Bọt" bubble, cartoon style. The quad's UV gives a point on a sphere seen from the
 * front: r = distance from the centre, z = sqrt(1 − r²) its depth, (p, z) its normal. The body
 * is a light, fairly opaque blue shaded by that normal (lighter top left), with a faint rainbow
 * on the rim (thin-film interference), a white inner rim, a deep-blue outline and big fixed
 * white highlights. Popping, it becomes a ring that widens and fades.
 */
const BUBBLE_FRAG = /* glsl */ `
uniform float uDayLight;
varying vec2 vUv;
varying float vPop;
varying float vFade;
varying float vSeed;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float light = 0.35 + 0.65 * uDayLight;
  if (vPop > 0.0) {
    // The burst: a white flash filling the bubble for an instant, and a ring that widens.
    float flash = (1.0 - smoothstep(0.0, 0.35, vPop)) * (1.0 - r * r) * 0.85;
    float w = 0.12 * (1.0 - vPop) + 0.03;
    float ring = smoothstep(w, 0.0, abs(r - (0.7 + 0.28 * vPop))) * (1.0 - vPop);
    vec3 c = mix(vec3(0.45, 0.78, 1.0), vec3(1.0), 0.6 + 0.4 * flash);
    gl_FragColor = vec4(c * max(light, flash), max(ring, flash));
    return;
  }
  float z = sqrt(1.0 - r * r);
  float fres = pow(1.0 - z, 2.0);
  // Body: light blue, lit from the top left.
  float shade = 0.5 + 0.5 * dot(vec3(p, z), normalize(vec3(-0.45, 0.55, 0.7)));
  vec3 col = vec3(0.56, 0.85, 1.0) * (0.72 + 0.4 * shade);
  float a = 0.3 + 0.3 * fres;
  vec3 film = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + fres * 1.6 + vSeed * 6.2831));
  col = mix(col, film, 0.22 * fres);
  // White inner rim, then a deep-blue outline (reads on a bright sky too).
  float inner = smoothstep(0.7, 0.83, r) * smoothstep(0.95, 0.85, r);
  col = mix(col, vec3(1.0), inner * 0.65);
  a = max(a, inner * 0.7);
  float edge = smoothstep(0.89, 0.97, r);
  col = mix(col, vec3(0.15, 0.45, 0.86), edge);
  a = max(a, edge * 0.95);
  col *= light;
  // Highlights: a big tilted oval top left, a dot above it, a soft one bottom right.
  vec2 q = p - vec2(-0.36, 0.36);
  q = mat2(0.8, 0.6, -0.6, 0.8) * q;
  float h1 = smoothstep(1.0, 0.7, length(q * vec2(3.4, 6.0)));
  float h2 = smoothstep(0.1, 0.06, length(p - vec2(0.06, 0.64)));
  float h3 = smoothstep(0.16, 0.04, length(p - vec2(0.46, -0.48))) * 0.45;
  float h = max(max(h1, h2), h3);
  col = mix(col, vec3(1.0), h);
  a = max(a, h * 0.95) * smoothstep(1.0, 0.97, r);
  gl_FragColor = vec4(col, a * vFade);
}
`;

/** Droplets (fall) and sparkles (drift) thrown by a pop. */
const BITS_VERT = /* glsl */ `
attribute vec3 aVel;
/** birth time, life, size (m), kind (0 droplet, 1 sparkle) */
attribute vec4 aInfo;
uniform float uTime;
uniform float uHalfHeight;
varying float vFade;
varying float vKind;
void main() {
  float t = uTime - aInfo.x;
  if (t < 0.0 || t > aInfo.y) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  float g = aInfo.w > 0.5 ? 0.25 : 3.2;
  vec3 pos = position + aVel * t - vec3(0.0, 0.5 * g * t * t, 0.0);
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  // World size → pixels: size · (projection's y scale) · (half the viewport height) / depth.
  gl_PointSize = clamp(aInfo.z * projectionMatrix[1][1] * uHalfHeight / -mv.z, 1.0, 40.0);
  vFade = 1.0 - t / aInfo.y;
  vKind = aInfo.w;
}
`;

const BITS_FRAG = /* glsl */ `
uniform float uDayLight;
varying float vFade;
varying float vKind;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float a;
  vec3 col;
  if (vKind > 0.5) {
    // A four-point star: two thin crossed bars and a soft core.
    float bars = max(smoothstep(0.16, 0.0, abs(c.x)) * (1.0 - abs(c.y)), smoothstep(0.16, 0.0, abs(c.y)) * (1.0 - abs(c.x)));
    a = max(bars, exp(-dot(c, c) * 9.0));
    col = vec3(1.0, 0.97, 0.85);
  } else {
    float r2 = dot(c, c);
    if (r2 > 1.0) discard;
    a = (1.0 - r2) * 0.8;
    col = vec3(0.7, 0.9, 1.0) * (0.35 + 0.65 * uDayLight);
  }
  gl_FragColor = vec4(col, a * vFade);
}
`;

/** When the burst is heard (seconds from now), for its one pop. */
export interface BubbleBurstPlan {
  pop: number;
  /** The last task of the list: a bigger bubble (a lower, fuller pop). */
  big: boolean;
}

/**
 * "Bubble Burst" on the desk, after Bọt's skill (bubbleCrab.ts) scaled down to a monitor (seconds
 * and metres): the bubble swells out of the task's ring, lets go and floats up toward you,
 * wobbling, then bursts: its film races out and fades, and small bubbles, droplets and sparkles
 * fly off all round.
 */
const BURST = {
  blow: 0.7,
  float: 1.3,
  radius: 0.065,
  radiusBig: 0.09,
  /** How far it floats up, and toward you, before it bursts. */
  rise: 0.2,
  toward: 0.14,
  /** The burst film: out to this × the radius in `blast` s. */
  blast: 0.35,
  blastScale: 3.2,
  shards: 22,
  shardsBig: 34,
  drops: 36,
  sparkles: 26,
} as const;

/** The big bubble in flight (null: none). */
interface Flight {
  age: number;
  radius: number;
  big: boolean;
  burst: boolean;
}

/**
 * A finished to-do: one soap bubble, Bọt's "Bubble Burst" at desk size. The bubble itself is
 * Bọt's thin-film sphere (BigBubble), moved by the CPU (one object, a few numbers a frame). The
 * small bubbles and the droplets and sparkles it bursts into run in the vertex shaders from a few
 * numbers written once at the burst (start, velocity, birth, life, size, seed): one instanced
 * mesh draws every small bubble, one Points object every droplet and sparkle; all are hidden
 * once the last one has faded.
 */
export class TodoBubbles {
  readonly group = new THREE.Group();
  private readonly film: BigBubble;
  private readonly bubbleGeo: THREE.InstancedBufferGeometry;
  private readonly bStart: THREE.InstancedBufferAttribute;
  private readonly bVel: THREE.InstancedBufferAttribute;
  private readonly bInfo: THREE.InstancedBufferAttribute;
  private readonly bitsPos: THREE.BufferAttribute;
  private readonly bitsVel: THREE.BufferAttribute;
  private readonly bitsInfo: THREE.BufferAttribute;
  private readonly uniforms = {
    uTime: { value: 0 },
    uCamRight: { value: new THREE.Vector3(1, 0, 0) },
    uCamUp: { value: new THREE.Vector3(0, 1, 0) },
    uWind: { value: new THREE.Vector3() },
    uHalfHeight: { value: 400 },
  };
  private nextBubble = 0;
  private nextBit = 0;
  /** When the last pop has faded (uTime). */
  private endsAt = 0;
  private flight: Flight | null = null;
  private readonly tmp = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  /** The big bubble's start (the ring on the screen) and where it is now. */
  private readonly origin = new THREE.Vector3();
  private readonly pos = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();

  constructor(shared: SharedUniforms) {
    this.film = new BigBubble(shared);
    const quad = new THREE.PlaneGeometry(1, 1);
    this.bubbleGeo = new THREE.InstancedBufferGeometry();
    this.bubbleGeo.index = quad.index;
    this.bubbleGeo.setAttribute('position', quad.getAttribute('position'));
    this.bubbleGeo.setAttribute('uv', quad.getAttribute('uv'));
    this.bStart = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BUBBLES * 3), 3);
    this.bVel = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BUBBLES * 3), 3);
    this.bInfo = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BUBBLES * 4).fill(-1e6), 4);
    this.bubbleGeo.setAttribute('aStart', this.bStart);
    this.bubbleGeo.setAttribute('aVel', this.bVel);
    this.bubbleGeo.setAttribute('aInfo', this.bInfo);
    this.bubbleGeo.instanceCount = MAX_BUBBLES;
    const ours = { ...this.uniforms, uDayLight: shared.uDayLight };
    const bubbles = new THREE.Mesh(
      this.bubbleGeo,
      new THREE.ShaderMaterial({
        uniforms: ours,
        vertexShader: BUBBLE_VERT,
        fragmentShader: BUBBLE_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    bubbles.frustumCulled = false;
    bubbles.renderOrder = 3;

    const bitsGeo = new THREE.BufferGeometry();
    this.bitsPos = new THREE.BufferAttribute(new Float32Array(MAX_BITS * 3), 3);
    this.bitsVel = new THREE.BufferAttribute(new Float32Array(MAX_BITS * 3), 3);
    this.bitsInfo = new THREE.BufferAttribute(new Float32Array(MAX_BITS * 4).fill(-1e6), 4);
    bitsGeo.setAttribute('position', this.bitsPos);
    bitsGeo.setAttribute('aVel', this.bitsVel);
    bitsGeo.setAttribute('aInfo', this.bitsInfo);
    const bits = new THREE.Points(
      bitsGeo,
      new THREE.ShaderMaterial({
        uniforms: ours,
        vertexShader: BITS_VERT,
        fragmentShader: BITS_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    bits.frustumCulled = false;
    bits.renderOrder = 3;
    this.group.add(this.film.mesh, bubbles, bits);
    this.group.visible = false;
  }

  /** Drawing buffer height (px), for the size of droplets and sparkles. */
  setViewport(heightPx: number): void {
    this.uniforms.uHalfHeight.value = heightPx / 2;
  }

  /**
   * Blows the bubble out of `screen` (a plane whose canvas is cw×ch pixels) at canvas point `at`
   * (the task's ring). `big`: the last task of the list, a bigger bubble. Returns when it pops,
   * for the sound. A new task finished meanwhile starts a new bubble.
   */
  burst(screen: THREE.Mesh<THREE.PlaneGeometry>, cw: number, ch: number, at: { x: number; y: number }, big: boolean): BubbleBurstPlan {
    const p = screen.geometry.parameters;
    screen.updateWorldMatrix(true, false);
    const m = screen.matrixWorld;
    // The screen's axes in the world: right, up, and its face (toward whoever reads it).
    this.right.setFromMatrixColumn(m, 0).normalize();
    this.up.set(0, 1, 0);
    this.normal.setFromMatrixColumn(m, 2).normalize();
    this.origin.set((at.x / cw - 0.5) * p.width, (0.5 - at.y / ch) * p.height, 0.015).applyMatrix4(m);
    this.flight = { age: 0, radius: big ? BURST.radiusBig : BURST.radius, big, burst: false };
    this.endsAt = this.uniforms.uTime.value + BURST.blow + BURST.float + 2.5;
    this.group.visible = true;
    return { pop: BURST.blow + BURST.float, big };
  }

  /** The big bubble: swelling, floating, then the burst film racing out. */
  private fly(dt: number): void {
    const f = this.flight;
    if (!f) return;
    f.age += dt;
    const R = f.radius;
    if (f.age < BURST.blow) {
      // Swelling out of the ring (eased), its back on the glass.
      const k = f.age / BURST.blow;
      const r = R * (1 - (1 - k) * (1 - k));
      this.pos.copy(this.origin).addScaledVector(this.normal, r * 1.05);
      this.film.set(this.pos.x, this.pos.y, this.pos.z, r);
      return;
    }
    const t = f.age - BURST.blow;
    if (t < BURST.float) {
      // It lets go: up (fast first, as Bọt's), toward you, swaying, its film quivering.
      const k = t / BURST.float;
      this.pos
        .copy(this.origin)
        .addScaledVector(this.normal, R * 1.05 + BURST.toward * (1 - (1 - k) * (1 - k)))
        .addScaledVector(this.up, BURST.rise * (1.2 * k - 0.2 * k * k))
        .addScaledVector(this.right, Math.sin(k * 9) * 0.012);
      this.film.set(this.pos.x, this.pos.y, this.pos.z, R * (1 + 0.04 * Math.sin(k * 30)));
      return;
    }
    if (!f.burst) {
      f.burst = true;
      this.shatter(this.pos, R, f.big);
    }
    // The film flies apart: a sphere racing out and fading.
    const k = Math.min(1, (t - BURST.float) / BURST.blast);
    const r = R + (R * BURST.blastScale - R) * (1 - (1 - k) * (1 - k));
    this.film.set(this.pos.x, this.pos.y, this.pos.z, r, (1 - k) * (1 - k) * 1.6);
    if (k >= 1) {
      this.film.set(0, 0, 0, 0);
      this.flight = null;
    }
  }

  /** The burst at `c`: small bubbles thrown out all round (they pop soon after), droplets, sparkles. */
  private shatter(c: THREE.Vector3, R: number, big: boolean): void {
    const now = this.uniforms.uTime.value;
    const n = big ? BURST.shardsBig : BURST.shards;
    for (let i = 0; i < n; i++) {
      randomDir(this.dir);
      const radius = 0.006 + Math.random() * 0.012;
      const speed = 0.25 + Math.random() * 0.6;
      const vel = this.tmp.copy(this.dir).multiplyScalar(speed).addScaledVector(this.up, 0.08);
      const start = this.dir.multiplyScalar(R).add(c);
      const life = 0.35 + Math.random() * 0.6;
      const seed = Math.random();
      const i3 = this.nextBubble * 3;
      const i4 = this.nextBubble * 4;
      (this.bStart.array as Float32Array).set([start.x, start.y, start.z], i3);
      (this.bVel.array as Float32Array).set([vel.x, vel.y, vel.z], i3);
      (this.bInfo.array as Float32Array).set([now, life, radius, seed], i4);
      this.nextBubble = (this.nextBubble + 1) % MAX_BUBBLES;
      this.spawnBits(start, vel, now, life, radius, seed);
    }
    // The splash: droplets fall, sparkles drift.
    const drops = big ? BURST.drops * 1.5 : BURST.drops;
    const sparkles = big ? BURST.sparkles * 1.5 : BURST.sparkles;
    for (let j = 0; j < drops + sparkles; j++) {
      const sparkle = j >= drops;
      randomDir(this.dir);
      const sp = sparkle ? 0.15 + Math.random() * 0.25 : 0.4 + Math.random() * 0.7;
      const i3 = this.nextBit * 3;
      const i4 = this.nextBit * 4;
      (this.bitsPos.array as Float32Array).set([c.x + this.dir.x * R, c.y + this.dir.y * R, c.z + this.dir.z * R], i3);
      (this.bitsVel.array as Float32Array).set([this.dir.x * sp, this.dir.y * sp + 0.3, this.dir.z * sp], i3);
      (this.bitsInfo.array as Float32Array).set([now, sparkle ? 0.8 : 0.6, sparkle ? 0.035 + Math.random() * 0.02 : 0.01 + Math.random() * 0.008, sparkle ? 1 : 0], i4);
      this.nextBit = (this.nextBit + 1) % MAX_BITS;
    }
    this.bStart.needsUpdate = true;
    this.bVel.needsUpdate = true;
    this.bInfo.needsUpdate = true;
    this.bitsPos.needsUpdate = true;
    this.bitsVel.needsUpdate = true;
    this.bitsInfo.needsUpdate = true;
    this.endsAt = now + 1.6;
  }

  /** Where the bubble is when it pops (the shader's motion, without the tiny wobble). */
  private spawnBits(start: THREE.Vector3, vel: THREE.Vector3, birth: number, life: number, radius: number, seed: number): void {
    const s = (1 - Math.exp(-DRAG * life)) / DRAG;
    const w = this.uniforms.uWind.value;
    const x = start.x + vel.x * s + w.x * 0.5 * life * life;
    const y = start.y + vel.y * s + RISE * life + w.y * 0.5 * life * life;
    const z = start.z + vel.z * s + w.z * 0.5 * life * life;
    // A splash: droplets thrown outward from the bubble's rim, and a few sparkles.
    const n = 6 + Math.floor(radius * 60);
    for (let j = 0; j < n; j++) {
      const sparkle = j % 3 === 0;
      const a = (j / n) * Math.PI * 2 + seed * 6.28;
      const cx = Math.cos(a);
      const sy = Math.sin(a);
      const sp = sparkle ? 0.14 + Math.random() * 0.1 : 0.35 + Math.random() * 0.4;
      const i3 = this.nextBit * 3;
      const i4 = this.nextBit * 4;
      (this.bitsPos.array as Float32Array).set(
        [x + (this.right.x * cx + this.up.x * sy) * radius, y + sy * radius, z + (this.right.z * cx + this.up.z * sy) * radius],
        i3,
      );
      (this.bitsVel.array as Float32Array).set([(this.right.x * cx + this.up.x * sy) * sp, sy * sp + 0.25, (this.right.z * cx + this.up.z * sy) * sp], i3);
      (this.bitsInfo.array as Float32Array).set([birth + life, sparkle ? 0.7 : 0.5, sparkle ? 0.03 + radius * 0.5 : 0.008 + radius * 0.2, sparkle ? 1 : 0], i4);
      this.nextBit = (this.nextBit + 1) % MAX_BITS;
    }
  }

  /**
   * Every frame: the clock (it runs while nothing shows too, so a new burst starts from "now"),
   * the big bubble, the camera's axes (the small bubbles face it) and the wind.
   */
  update(dt: number, camera: THREE.Camera, wind: THREE.Vector2, windStrength: number): void {
    const u = this.uniforms;
    u.uTime.value += dt;
    if (!this.group.visible) return;
    this.fly(dt);
    if (u.uTime.value > this.endsAt && !this.flight) {
      this.group.visible = false;
      return;
    }
    u.uCamRight.value.setFromMatrixColumn(camera.matrixWorld, 0);
    u.uCamUp.value.setFromMatrixColumn(camera.matrixWorld, 1);
    u.uWind.value.set(wind.x, 0, wind.y).multiplyScalar(0.25 * windStrength);
  }
}

/** A random direction (unit), written into `out`. */
function randomDir(out: THREE.Vector3): THREE.Vector3 {
  const a = Math.random() * Math.PI * 2;
  const c = Math.random() * 2 - 1;
  const s = Math.sqrt(1 - c * c);
  return out.set(Math.cos(a) * s, c, Math.sin(a) * s);
}
