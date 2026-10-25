import * as THREE from 'three';

/** Pool sizes: a big burst is 60 bubbles, each pop throws up to 7 droplets and sparkles. */
const MAX_BUBBLES = 160;
const MAX_BITS = 1200;
/** How long a pop lasts (s): the bubble swells, turns into a ring and fades. */
const POP = 0.2;
/** Drag on the launch speed (1/s): the stream slows down and the bubbles start to float. */
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
  // Born small, then the slight squash and stretch of a soft bubble in flight.
  float grow = smoothstep(0.0, 0.14, t);
  float pop = clamp((t - life) / ${POP.toFixed(2)}, 0.0, 1.0);
  float wob = sin(tm * 9.0 + seed * 31.0) * 0.08;
  vec2 size = vec2(1.0 + wob, 1.0 - wob) * aInfo.z * 2.0 * grow * (1.0 + 0.35 * pop);
  vec3 world = pos + uCamRight * position.x * size.x + uCamUp * position.y * size.y;
  vUv = uv;
  vPop = pop;
  vFade = grow;
  vSeed = seed;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

/**
 * A soap bubble, cartoon style. The quad's UV gives a point on a sphere seen from the front:
 * r = distance from the centre, z = sqrt(1 − r²) its depth. Fresnel (1 − z)^n makes the rim
 * strong and the middle clear; the rim's colour runs through a rainbow (thin-film interference:
 * the soap film's thickness shifts which colour is reflected) and two fixed white highlights
 * sell it as a Pokémon "Bọt". Popping, it becomes a thin ring that widens and fades.
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
    float ring = smoothstep(0.1, 0.0, abs(r - (0.72 + 0.26 * vPop)));
    gl_FragColor = vec4(vec3(0.9, 0.97, 1.0) * light, ring * (1.0 - vPop) * 0.9);
    return;
  }
  float z = sqrt(1.0 - r * r);
  float fres = pow(1.0 - z, 2.2);
  float hue = fres * 2.2 + vSeed * 6.2831 + p.y * 0.8;
  vec3 film = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + hue));
  vec3 col = mix(vec3(0.55, 0.82, 1.0), film, 0.5 * fres);
  float a = 0.13 + 0.7 * fres;
  // A thin deeper-blue outline, so the bubble still reads against a bright sky.
  float edge = smoothstep(0.84, 0.97, r);
  col = mix(col, vec3(0.2, 0.5, 0.88), edge * 0.75);
  a = max(a, edge * 0.85);
  float h1 = smoothstep(0.2, 0.12, length(p - vec2(-0.36, 0.4)));
  float h2 = smoothstep(0.085, 0.045, length(p - vec2(-0.08, 0.62)));
  float h = max(h1, h2);
  col = mix(col * light, vec3(1.0), h);
  a = max(a, h * 0.95) * smoothstep(1.0, 0.95, r);
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

export interface BubblePop {
  /** Seconds from now. */
  delay: number;
  /** 0..1, for the pop's pitch. */
  size: number;
}

/**
 * "Bọt": when a to-do is finished its card bursts into a stream of soap bubbles that fly out of
 * the monitor, wobble, float up with the wind and pop into a ring, droplets and sparkles.
 * All motion runs in the vertex shaders from a few numbers written once per bubble at launch
 * (start, velocity, birth, life, size, seed); the CPU never touches them per frame. One
 * instanced mesh draws every bubble, one Points object every droplet and sparkle; both are
 * hidden once the last pop has faded.
 */
export class TodoBubbles {
  readonly group = new THREE.Group();
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
  private readonly tmp = new THREE.Vector3();
  private readonly corner = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();

  constructor(dayLight: { value: number }) {
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
    const shared = { ...this.uniforms, uDayLight: dayLight };
    const bubbles = new THREE.Mesh(
      this.bubbleGeo,
      new THREE.ShaderMaterial({
        uniforms: shared,
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
        uniforms: shared,
        vertexShader: BITS_VERT,
        fragmentShader: BITS_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    bits.frustumCulled = false;
    bits.renderOrder = 3;
    this.group.add(bubbles, bits);
    this.group.visible = false;
  }

  /** Drawing buffer height (px), for the size of droplets and sparkles. */
  setViewport(heightPx: number): void {
    this.uniforms.uHalfHeight.value = heightPx / 2;
  }

  /**
   * Bursts the canvas rectangle (x, y, w, h) of `screen` (a plane whose canvas is cw×ch pixels)
   * into bubbles flying out of its face. `big`: the last task of the list, a bigger "Bọt Nước".
   * Returns when each bubble pops, for the sound.
   */
  burst(
    screen: THREE.Mesh<THREE.PlaneGeometry>,
    cw: number,
    ch: number,
    rect: { x: number; y: number; w: number; h: number },
    big: boolean,
  ): BubblePop[] {
    const now = this.uniforms.uTime.value;
    const p = screen.geometry.parameters;
    screen.updateWorldMatrix(true, false);
    const m = screen.matrixWorld;
    // The screen's axes in the world: right, up, and its face (toward whoever reads it).
    this.right.setFromMatrixColumn(m, 0).normalize();
    this.up.setFromMatrixColumn(m, 1).normalize();
    this.normal.setFromMatrixColumn(m, 2).normalize();
    const count = big ? 60 : 22;
    const stream = big ? 1.2 : 0.6;
    const pops: BubblePop[] = [];
    for (let i = 0; i < count; i++) {
      const k = i / count;
      // Sweep along the card from its ring (left) to the right, a little scatter up and down.
      const px = rect.x + rect.w * Math.min(1, k * 1.1 + Math.random() * 0.08);
      const py = rect.y + rect.h * (0.2 + Math.random() * 0.6);
      this.corner.set((px / cw - 0.5) * p.width, (0.5 - py / ch) * p.height, 0.01).applyMatrix4(m);
      const radius = (big ? 0.012 : 0.01) + Math.random() * (big ? 0.03 : 0.022);
      // Out of the screen, arcing up; small ones are lighter and fly faster.
      const speed = 0.55 + Math.random() * 0.5 + (0.03 - radius) * 8;
      const vel = this.tmp
        .copy(this.normal)
        .multiplyScalar(speed)
        .addScaledVector(this.up, 0.35 + Math.random() * 0.45)
        .addScaledVector(this.right, (Math.random() - 0.5) * 0.7);
      const birth = now + k * stream + Math.random() * 0.05;
      const life = (big ? 1.6 : 1.2) + Math.random() * (big ? 1.6 : 1.3);
      const seed = Math.random();
      const i3 = this.nextBubble * 3;
      const i4 = this.nextBubble * 4;
      (this.bStart.array as Float32Array).set([this.corner.x, this.corner.y, this.corner.z], i3);
      (this.bVel.array as Float32Array).set([vel.x, vel.y, vel.z], i3);
      (this.bInfo.array as Float32Array).set([birth, life, radius, seed], i4);
      this.nextBubble = (this.nextBubble + 1) % MAX_BUBBLES;
      this.spawnBits(this.corner, vel, birth, life, radius, seed);
      pops.push({ delay: birth + life - now, size: Math.min(1, radius / 0.042) });
      this.endsAt = Math.max(this.endsAt, birth + life + 1.2);
    }
    this.bStart.needsUpdate = true;
    this.bVel.needsUpdate = true;
    this.bInfo.needsUpdate = true;
    this.bitsPos.needsUpdate = true;
    this.bitsVel.needsUpdate = true;
    this.bitsInfo.needsUpdate = true;
    this.group.visible = true;
    return pops;
  }

  /** Where the bubble is when it pops (the shader's motion, without the tiny wobble). */
  private spawnBits(start: THREE.Vector3, vel: THREE.Vector3, birth: number, life: number, radius: number, seed: number): void {
    const s = (1 - Math.exp(-DRAG * life)) / DRAG;
    const w = this.uniforms.uWind.value;
    const x = start.x + vel.x * s + w.x * 0.5 * life * life;
    const y = start.y + vel.y * s + RISE * life + w.y * 0.5 * life * life;
    const z = start.z + vel.z * s + w.z * 0.5 * life * life;
    const n = 3 + Math.floor(radius * 100);
    for (let j = 0; j < n; j++) {
      const sparkle = j % 3 === 0;
      const a = (j / n) * Math.PI * 2 + seed * 6.28;
      const sp = sparkle ? 0.12 + Math.random() * 0.1 : 0.25 + Math.random() * 0.35;
      const i3 = this.nextBit * 3;
      const i4 = this.nextBit * 4;
      (this.bitsPos.array as Float32Array).set([x, y, z], i3);
      (this.bitsVel.array as Float32Array).set(
        [this.right.x * Math.cos(a) * sp + this.up.x * Math.sin(a) * sp, Math.sin(a) * sp + 0.15, this.right.z * Math.cos(a) * sp + this.up.z * Math.sin(a) * sp],
        i3,
      );
      (this.bitsInfo.array as Float32Array).set([birth + life, sparkle ? 0.55 : 0.45, sparkle ? 0.022 + radius * 0.4 : 0.006 + radius * 0.15, sparkle ? 1 : 0], i4);
      this.nextBit = (this.nextBit + 1) % MAX_BITS;
    }
  }

  /**
   * Every frame: the clock (it runs while nothing shows too, so a new burst starts from "now"),
   * the camera's axes (bubbles face it) and the wind.
   */
  update(dt: number, camera: THREE.Camera, wind: THREE.Vector2, windStrength: number): void {
    const u = this.uniforms;
    u.uTime.value += dt;
    if (!this.group.visible) return;
    if (u.uTime.value > this.endsAt) {
      this.group.visible = false;
      return;
    }
    u.uCamRight.value.setFromMatrixColumn(camera.matrixWorld, 0);
    u.uCamUp.value.setFromMatrixColumn(camera.matrixWorld, 1);
    u.uWind.value.set(wind.x, 0, wind.y).multiplyScalar(0.25 * windStrength);
  }
}
