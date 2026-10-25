import * as THREE from 'three';
import type { SkillSound } from '../../audio/synth/skillSounds';

/**
 * The look of a shock wave: `energy` (a plain glowing band), `fire` (flame tongues on the
 * wall), `water` (a crown of spray), `leaf` (a green gust with streaks) or `spark` (flickering
 * blue-white arcs).
 */
export type ShockStyle = 'energy' | 'fire' | 'water' | 'leaf' | 'spark';
const STYLE_ID: Record<ShockStyle, number> = { energy: 0, fire: 1, water: 2, leaf: 3, spark: 4 };

/** What a skill can ask for on top of its own particles (App owns the one SkillFx). */
export interface SkillFxSink {
  /** A real light flash at (x, y, z): colour, peak intensity (candela), reach (m), seconds. */
  flash(x: number, y: number, z: number, color: number, power: number, reach: number, time: number): void;
  /**
   * A shock wave racing out from (x, y, z) (y: the ground or sea under it) to `radius` m in `time`
   * s; `wall` m high (0: only the ring on the ground).
   */
  shock(x: number, y: number, z: number, style: ShockStyle, color: number, radius: number, time: number, wall?: number): void;
  /** The camera shakes (0..1, 1 = a big blast next to you) for `time` s, less from afar. */
  shake(x: number, y: number, z: number, amount: number, time: number): void;
  /**
   * A whirlwind standing on (x, y, z): a funnel `height` m tall, `top` m wide at the top, for
   * `time` s, in `color` (Mầm's tornado, the steam tornado of a combo).
   */
  vortex(x: number, y: number, z: number, color: number, height: number, top: number, time: number): void;
  /** A scorch mark on the ground at (x, y, z), `radius` m, fading away over `time` s. */
  mark(x: number, y: number, z: number, radius: number, time: number): void;
  /** The view widens and turns a little toward (x, y, z) for `time` s (a big skill). */
  focus(x: number, y: number, z: number, time: number): void;
  /** A big sound at (x, y, z) (heard with the activity sounds on), `size` 0..1. */
  sound(kind: SkillSound, size: number, x: number, y: number, z: number): void;
}

/** Shock waves that can run at once (each a ring and a wall: two draw calls while running). */
const SHOCKS = 8;
/** Shake at amount 1 (m of camera offset, rad of roll), and how far it carries (m). */
const SHAKE = { move: 0.14, roll: 0.012, reach: 30 } as const;
/**
 * Framing: the field of view widens by `fov` degrees (a zoom out: the camera never moves, so it
 * can't end up inside a tree or a wall), it turns `turn` of the way to the skill, easing in/out (s).
 */
const FOCUS = { fov: 14, turn: 0.3, ease: 0.45 } as const;

// The disc lies flat (x, z): its position there, in units of its radius.
const RING_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Shared helpers: a cheap value noise (hash on a grid, smoothly mixed).
const NOISE = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

/**
 * The ring on the ground: a bright band at the front (radius 1 = the mesh's scale), a faint fill
 * behind it, broken up along its length by noise so it isn't a perfect circle. Everything fades
 * as it grows (uK: 0 start … 1 done).
 */
const RING_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uK;
uniform float uFront;
uniform float uStyle;
uniform float uSeed;
uniform float uTime;
varying vec2 vP;
${NOISE}
void main() {
  float r = length(vP);
  if (r > 1.0) discard;
  float ang = atan(vP.y, vP.x);
  float n = noise(vec2(ang * 6.0 + uSeed * 20.0, uTime * 2.0));
  float width = uStyle == 4.0 ? 0.025 : 0.06 + 0.05 * (1.0 - uK);
  float band = exp(-pow((r - uFront) / width, 2.0));
  float fill = smoothstep(uFront, uFront * 0.2, r) * step(r, uFront) * 0.22;
  float wob = 0.55 + 0.45 * n;
  if (uStyle == 4.0) wob = step(0.45, noise(vec2(ang * 18.0, uTime * 25.0 + uSeed * 9.0))) * 1.6;
  if (uStyle == 3.0) wob *= 0.6 + 0.4 * sin(ang * 14.0 + r * 18.0 - uTime * 6.0);
  float fade = pow(1.0 - uK, 1.4);
  float a = (band * wob + fill * (0.6 + 0.4 * n)) * fade;
  gl_FragColor = vec4(uColor * (1.0 + 2.5 * band), clamp(a, 0.0, 1.0));
}
`;

const WALL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * The wall: an open cylinder on the front, its top torn by noise into tongues (fire), spikes
 * (water), streaks (leaf) or flicker (spark); brightest at the foot.
 */
const WALL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uK;
uniform float uStyle;
uniform float uSeed;
uniform float uTime;
varying vec2 vUv;
${NOISE}
void main() {
  float ang = vUv.x * 6.2832;
  float y = vUv.y;
  float top;
  if (uStyle == 1.0) {
    // Flame tongues licking up, rising through the noise.
    top = 0.35 + 0.65 * noise(vec2(vUv.x * 28.0 + uSeed * 7.0, y * 2.5 - uTime * 3.5));
  } else if (uStyle == 2.0) {
    // A crown of spray: sharp spikes, frozen as they rise.
    top = 0.3 + 0.7 * pow(noise(vec2(vUv.x * 40.0 + uSeed * 7.0, 0.5)), 2.0);
  } else if (uStyle == 3.0) {
    top = 0.4 + 0.6 * noise(vec2(vUv.x * 18.0 + y * 3.0 + uTime * 1.5, uSeed * 5.0));
  } else if (uStyle == 4.0) {
    top = step(0.5, noise(vec2(vUv.x * 30.0, uTime * 30.0 + uSeed * 3.0))) * 0.9 + 0.1;
  } else {
    top = 0.55 + 0.45 * noise(vec2(vUv.x * 12.0 + uSeed * 7.0, uTime));
  }
  float body = smoothstep(top, top - 0.35, y);
  float foot = exp(-y * 4.0);
  float fade = pow(1.0 - uK, 1.6) * smoothstep(0.0, 0.08, uK);
  float a = (body * (0.35 + 0.65 * foot)) * fade;
  vec3 col = uColor * (1.2 + 2.0 * foot);
  if (uStyle == 1.0) col = mix(uColor * 1.6, vec3(1.0, 0.8, 0.4) * 2.2, foot * foot);
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}
`;

/**
 * The whirlwind: a funnel (an open cone) whose surface is streaks of wind spiralling up, broken
 * by noise, densest low down; it fades in and out over its life (uK) and with height.
 */
const VORTEX_VERT = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
void main() {
  vUv = uv;
  // A living funnel: the outline ripples round, and the whole column snakes from side to side,
  // more toward the top (in the unit cone's own space, before its scale).
  vec3 p = position;
  float y = uv.y;
  float ang = uv.x * 6.2832;
  p.xz *= 1.0 + 0.18 * sin(ang * 3.0 + y * 6.0 - uTime * 5.0);
  p.xz += vec2(sin(y * 2.6 + uTime * 1.9), cos(y * 2.2 + uTime * 1.4)) * 0.22 * y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const VORTEX_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uK;
uniform float uTime;
varying vec2 vUv;
${NOISE}
void main() {
  float y = vUv.y;
  // Two layers of streaks spiralling up, one faster, broken by noise into wisps.
  float a1 = vUv.x * 6.2832 * 4.0 - y * 9.0 + uTime * 7.0;
  float a2 = vUv.x * 6.2832 * 7.0 - y * 14.0 + uTime * 11.0;
  float n = noise(vec2(vUv.x * 24.0 - uTime * 3.0, y * 6.0 - uTime * 2.0));
  float streak = smoothstep(0.55, 1.0, sin(a1) * 0.5 + 0.5) * (0.3 + 0.7 * n)
               + smoothstep(0.75, 1.0, sin(a2) * 0.5 + 0.5) * 0.6 * (1.0 - n);
  float life = smoothstep(0.0, 0.15, uK) * (1.0 - smoothstep(0.8, 1.0, uK));
  float a = (streak + 0.03) * smoothstep(0.0, 0.12, y) * (1.0 - smoothstep(0.7, 1.0, y)) * life;
  gl_FragColor = vec4(uColor * (1.0 + 1.5 * streak), clamp(a, 0.0, 1.0) * 0.8);
}
`;

/** A scorch mark: soot, darkest in the middle, ragged at the edge, a few cracks of ember glow at first. */
const MARK_FRAG = /* glsl */ `
uniform float uK;
uniform float uSeed;
varying vec2 vP;
${NOISE}
void main() {
  float r = length(vP);
  float ang = atan(vP.y, vP.x);
  float edge = 0.75 + 0.25 * noise(vec2(ang * 3.0 + uSeed * 10.0, uSeed));
  float soot = smoothstep(edge, edge * 0.35, r) * (0.75 + 0.25 * noise(vP * 6.0 + uSeed * 4.0));
  float fade = 1.0 - smoothstep(0.55, 1.0, uK);
  float ember = smoothstep(0.6, 0.95, noise(vP * 9.0 + uSeed * 7.0)) * smoothstep(0.6, 0.0, r) * (1.0 - smoothstep(0.0, 0.25, uK));
  vec3 col = mix(vec3(0.04, 0.035, 0.03), vec3(1.4, 0.4, 0.08), ember);
  gl_FragColor = vec4(col, max(soot * 0.85, ember) * fade);
}
`;

interface Mark {
  mesh: THREE.Mesh<THREE.CircleGeometry, THREE.ShaderMaterial>;
  age: number;
  time: number;
}

interface Vortex {
  mesh: THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>;
  age: number;
  time: number;
  height: number;
}

interface Shock {
  ring: THREE.Mesh<THREE.CircleGeometry, THREE.ShaderMaterial>;
  wall: THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>;
  age: number;
  time: number;
  radius: number;
  height: number;
}

/**
 * Shared extras for the creatures' skills, so each one reads as powerful: a light flash that
 * really lights the scene (one PointLight kept in the scene at intensity 0, so the number of
 * lights, and with it every shader, never changes), shock waves on the ground or sea (additive
 * meshes from a small pool), a camera shake and a short camera framing (applied just for the
 * render, then undone, so the controls never see them), and how much bloom they want (App
 * adds a bloom pass on High while this is up).
 */
export class SkillFx implements SkillFxSink {
  /** 0..1: how much glow the effects want now (App's bloom pass, High quality only). */
  bloom = 0;
  private readonly light = new THREE.PointLight(0xffffff, 0, 10, 2);
  private flashAge = Infinity;
  private flashTime = 1;
  private flashPower = 0;
  private readonly shocks: Shock[] = [];
  private readonly vortices: Vortex[] = [];
  private readonly marks: Mark[] = [];
  private trauma = 0;
  private traumaFade = 1;
  private clock = 0;
  private focusLeft = 0;
  private focusK = 0;
  private readonly focusAt = new THREE.Vector3();
  private readonly savedPos = new THREE.Vector3();
  private readonly savedQuat = new THREE.Quaternion();
  private savedFov = 0;
  private applied = false;
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpM = new THREE.Matrix4();

  constructor(
    scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly reducedMotion: () => boolean,
    private readonly play: (kind: SkillSound, size: number, x: number, y: number, z: number) => void,
  ) {
    this.light.castShadow = false;
    scene.add(this.light);
    // Unit shapes, scaled per shock: a disc (radius 1) lying flat, an open cylinder (radius 1, 0..1 high).
    const disc = new THREE.CircleGeometry(1, 96).rotateX(-Math.PI / 2);
    const tube = new THREE.CylinderGeometry(1, 1, 1, 96, 1, true).translate(0, 0.5, 0);
    for (let i = 0; i < 8; i++) {
      const mesh = new THREE.Mesh(
        disc,
        new THREE.ShaderMaterial({
          uniforms: { uK: { value: 0 }, uSeed: { value: 0 } },
          vertexShader: RING_VERT,
          fragmentShader: MARK_FRAG,
          transparent: true,
          depthWrite: false,
          // Over the ground, under everything else that is see-through.
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        }),
      );
      mesh.visible = false;
      mesh.renderOrder = 1;
      scene.add(mesh);
      this.marks.push({ mesh, age: Infinity, time: 1 });
    }
    // The funnel: radius 1 at the top, narrow at the foot, 0..1 high.
    const cone = new THREE.CylinderGeometry(1, 0.12, 1, 64, 12, true).translate(0, 0.5, 0);
    for (let i = 0; i < 2; i++) {
      const mesh = new THREE.Mesh(
        cone,
        new THREE.ShaderMaterial({
          uniforms: { uColor: { value: new THREE.Color() }, uK: { value: 0 }, uTime: { value: 0 } },
          vertexShader: VORTEX_VERT,
          fragmentShader: VORTEX_FRAG,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        }),
      );
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 5;
      scene.add(mesh);
      this.vortices.push({ mesh, age: Infinity, time: 1, height: 1 });
    }
    for (let i = 0; i < SHOCKS; i++) {
      const common = (): Record<string, THREE.IUniform> => ({
        uColor: { value: new THREE.Color() },
        uK: { value: 0 },
        uStyle: { value: 0 },
        uSeed: { value: 0 },
        uTime: { value: 0 },
      });
      const ring = new THREE.Mesh(
        disc,
        new THREE.ShaderMaterial({
          uniforms: { ...common(), uFront: { value: 0 } },
          vertexShader: RING_VERT,
          fragmentShader: RING_FRAG,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        }),
      );
      const wall = new THREE.Mesh(
        tube,
        new THREE.ShaderMaterial({
          uniforms: common(),
          vertexShader: WALL_VERT,
          fragmentShader: WALL_FRAG,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        }),
      );
      ring.visible = wall.visible = false;
      ring.frustumCulled = wall.frustumCulled = false;
      // After the water and the particles' depth: drawn over the sea, under the UI.
      ring.renderOrder = wall.renderOrder = 5;
      scene.add(ring, wall);
      this.shocks.push({ ring, wall, age: Infinity, time: 1, radius: 1, height: 0 });
    }
  }

  flash(x: number, y: number, z: number, color: number, power: number, reach: number, time: number): void {
    // A brighter flash wins over one still fading.
    const now = this.flashLevel();
    if (power < now) return;
    this.light.position.set(x, y, z);
    this.light.color.setHex(color);
    this.light.distance = reach;
    this.flashPower = power;
    this.flashTime = Math.max(0.05, time);
    this.flashAge = 0;
    this.bloom = Math.max(this.bloom, Math.min(1, 0.4 + power / 200));
  }

  shock(x: number, y: number, z: number, style: ShockStyle, color: number, radius: number, time: number, wall = 0): void {
    // The oldest one makes way if all are running.
    let s = this.shocks[0];
    for (const c of this.shocks) {
      if (c.age >= c.time) {
        s = c;
        break;
      }
      if (c.age / c.time > s.age / s.time) s = c;
    }
    s.age = 0;
    s.time = time;
    s.radius = radius;
    s.height = wall;
    const seed = Math.random();
    for (const m of [s.ring.material, s.wall.material]) {
      (m.uniforms.uColor.value as THREE.Color).setHex(color);
      m.uniforms.uStyle.value = STYLE_ID[style];
      m.uniforms.uSeed.value = seed;
    }
    s.ring.position.set(x, y + 0.06, z);
    s.wall.position.set(x, y, z);
    s.ring.visible = true;
    s.wall.visible = wall > 0;
    this.bloom = Math.max(this.bloom, 0.6);
  }

  shake(x: number, y: number, z: number, amount: number, time: number): void {
    if (this.reducedMotion()) return;
    const d = this.camera.position.distanceTo(this.tmpV.set(x, y, z));
    const k = amount * Math.max(0, 1 - d / SHAKE.reach);
    if (k <= this.trauma) return;
    this.trauma = Math.min(1, k);
    this.traumaFade = this.trauma / Math.max(0.1, time);
  }

  sound(kind: SkillSound, size: number, x: number, y: number, z: number): void {
    this.play(kind, size, x, y, z);
  }

  vortex(x: number, y: number, z: number, color: number, height: number, top: number, time: number): void {
    const v = this.vortices[0].age >= this.vortices[0].time ? this.vortices[0] : this.vortices[1];
    v.age = 0;
    v.time = time;
    v.height = height;
    v.mesh.position.set(x, y, z);
    v.mesh.scale.set(top, height, top);
    (v.mesh.material.uniforms.uColor.value as THREE.Color).setHex(color);
    v.mesh.visible = true;
  }

  mark(x: number, y: number, z: number, radius: number, time: number): void {
    let m = this.marks[0];
    for (const c of this.marks) {
      if (c.age >= c.time) {
        m = c;
        break;
      }
      if (c.age / c.time > m.age / m.time) m = c;
    }
    m.age = 0;
    m.time = time;
    m.mesh.position.set(x, y + 0.03, z);
    m.mesh.scale.set(radius, 1, radius);
    m.mesh.material.uniforms.uSeed.value = Math.random();
    m.mesh.visible = true;
  }

  focus(x: number, y: number, z: number, time: number): void {
    this.focusAt.set(x, y, z);
    this.focusLeft = Math.max(this.focusLeft, time);
  }

  update(dt: number): void {
    this.clock += dt;
    this.flashAge += dt;
    this.light.intensity = this.flashLevel();
    for (const s of this.shocks) {
      if (s.age >= s.time) continue;
      s.age += dt;
      const k = Math.min(1, s.age / s.time);
      if (k >= 1) {
        s.ring.visible = s.wall.visible = false;
        continue;
      }
      // Ease out: the front races off, then slows.
      const front = 1 - (1 - k) * (1 - k) * (1 - k);
      const r = Math.max(0.05, s.radius * front);
      // The ring mesh is a bit larger than the front, for the band's soft outer edge.
      const outer = r * 1.15;
      s.ring.scale.set(outer, 1, outer);
      s.ring.material.uniforms.uFront.value = r / outer;
      s.ring.material.uniforms.uK.value = k;
      s.ring.material.uniforms.uTime.value = this.clock;
      if (s.height > 0) {
        // The wall rises fast and sinks as the front spreads out.
        const h = s.height * Math.sin(Math.PI * Math.min(1, k * 1.25 + 0.05));
        s.wall.scale.set(r, Math.max(0.01, h), r);
        s.wall.material.uniforms.uK.value = k;
        s.wall.material.uniforms.uTime.value = this.clock;
      }
    }
    for (const v of this.vortices) {
      if (v.age >= v.time) continue;
      v.age += dt;
      const k = Math.min(1, v.age / v.time);
      v.mesh.visible = k < 1;
      v.mesh.material.uniforms.uK.value = k;
      v.mesh.material.uniforms.uTime.value = this.clock;
      // It grows up out of the ground over the first quarter.
      v.mesh.scale.y = v.height * Math.min(1, k * 4);
    }
    for (const m of this.marks) {
      if (m.age >= m.time) continue;
      m.age += dt;
      m.mesh.material.uniforms.uK.value = Math.min(1, m.age / m.time);
      m.mesh.visible = m.age < m.time;
    }
    this.trauma = Math.max(0, this.trauma - this.traumaFade * dt);
    this.bloom = Math.max(0, this.bloom - dt * 0.7);
    this.focusLeft -= dt;
    const want = this.focusLeft > 0 ? 1 : 0;
    this.focusK += (want - this.focusK) * (1 - Math.exp(-dt / (FOCUS.ease / 2)));
    if (this.focusK < 1e-3) this.focusK = 0;
  }

  /**
   * Just before rendering: the shake and the framing put on the camera (`frame`: this view may
   * widen and turn, e.g. not sitting at the desk). Undo with `restore`.
   */
  apply(frame: boolean): void {
    const cam = this.camera;
    const shake = this.trauma > 0.001;
    const focus = frame && this.focusK > 0;
    if (!shake && !focus) return;
    this.applied = true;
    this.savedPos.copy(cam.position);
    this.savedQuat.copy(cam.quaternion);
    this.savedFov = cam.fov;
    if (focus) {
      const k = this.focusK * this.focusK * (3 - 2 * this.focusK);
      // Wider, and turned part of the way to the skill.
      cam.fov = this.savedFov + FOCUS.fov * k;
      cam.updateProjectionMatrix();
      this.tmpM.lookAt(cam.position, this.focusAt, cam.up);
      this.tmpQ.setFromRotationMatrix(this.tmpM);
      cam.quaternion.slerp(this.tmpQ, FOCUS.turn * k);
    }
    if (shake) {
      // Trauma²: small knocks barely show, big ones do. Smooth noise from a few sines per axis.
      const t = this.clock;
      const a = this.trauma * this.trauma;
      cam.position.x += a * SHAKE.move * (Math.sin(t * 37) * 0.6 + Math.sin(t * 61 + 1) * 0.4);
      cam.position.y += a * SHAKE.move * (Math.sin(t * 43 + 2) * 0.6 + Math.sin(t * 71 + 3) * 0.4);
      cam.position.z += a * SHAKE.move * (Math.sin(t * 53 + 4) * 0.6 + Math.sin(t * 29 + 5) * 0.4);
      cam.rotateZ(a * SHAKE.roll * Math.sin(t * 47 + 6));
    }
    cam.updateMatrixWorld();
  }

  /** After rendering: the camera back where the controls put it. */
  restore(): void {
    if (!this.applied) return;
    this.applied = false;
    this.camera.position.copy(this.savedPos);
    this.camera.quaternion.copy(this.savedQuat);
    if (this.camera.fov !== this.savedFov) {
      this.camera.fov = this.savedFov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld();
  }

  /** The flash now: a quick rise (40 ms), then an exponential-ish fall over its time. */
  private flashLevel(): number {
    const t = this.flashAge;
    if (t >= this.flashTime) return 0;
    const rise = Math.min(1, t / 0.04);
    const fall = Math.pow(1 - t / this.flashTime, 2);
    return this.flashPower * rise * fall;
  }
}
