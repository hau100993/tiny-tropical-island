import * as THREE from 'three';

/**
 * Shapes for the recipe skills, drawn by small shaders (no textures): beams (a breath, a tongue,
 * a sting, lightning, a falling sword), sigils (a glowing pattern on the ground: a web, a lotus,
 * a honeycomb, a sun, a crescent, the eight trigrams, leaves), domes (a soap-bubble shield, a
 * golden hex shell) and shape rain (stars, pumpkins, leaves, fruit, bats as camera-facing
 * sprites). Each kind is a small pool reused cast after cast; nothing is allocated per frame.
 */

export type SigilPattern = 'web' | 'lotus' | 'hive' | 'sun' | 'crescent' | 'trigrams' | 'leaves';
const SIGIL_ID: Readonly<Record<SigilPattern, number>> = { web: 0, lotus: 1, hive: 2, sun: 3, crescent: 4, trigrams: 5, leaves: 6 };

export type DomeStyle = 'bubble' | 'shell';
export type ShapeKind = 'star' | 'pumpkin' | 'leaf' | 'fruit' | 'bat';
const SHAPE_ID: Readonly<Record<ShapeKind, number>> = { star: 0, pumpkin: 1, leaf: 2, fruit: 3, bat: 4 };

export interface BeamSpec {
  x: number;
  y: number;
  z: number;
  /** Direction (normalized by the pool). */
  dx: number;
  dy: number;
  dz: number;
  length: number;
  radius: number;
  color: number;
  time: number;
  /** A blade tapers to a point (the sword); a beam is a tube of light. */
  blade?: boolean;
  /** Shoots out then pulls back in (a tongue). */
  retract?: boolean;
  /** Starts this many m higher and slides down into place in the first 40 % (the sword). */
  drop?: number;
}

const BEAMS = 6;
const SIGILS = 6;
const DOMES = 3;
const SHAPES = 256;
/** Shape rain items fall at this gravity (m/s²) and slow by this drag (1/s). */
const GRAVITY = 6;
const DRAG = 0.6;

interface BeamSlot {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  age: number;
  spec: BeamSpec | null;
  base: THREE.Vector3;
}

interface SigilSlot {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  age: number;
  time: number;
  radius: number;
  spin: number;
}

interface DomeSlot {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  age: number;
  time: number;
  radius: number;
}

const UP = new THREE.Vector3(0, 1, 0);

export class SkillShapes {
  readonly group = new THREE.Group();
  private readonly beams: BeamSlot[] = [];
  private readonly sigils: SigilSlot[] = [];
  private readonly domes: DomeSlot[] = [];
  private readonly time = { value: 0 };
  private readonly tmpDir = new THREE.Vector3();
  // Shape rain: one instanced draw, per-item state in typed arrays.
  private readonly shapeMesh: THREE.InstancedMesh;
  private readonly sPos: Float32Array;
  private readonly sVel = new Float32Array(SHAPES * 3);
  private readonly sMisc: Float32Array; // shape, size, rotation, alpha
  private readonly sTint: Float32Array;
  private readonly sLife = new Float32Array(SHAPES);
  private readonly sAge = new Float32Array(SHAPES);
  private readonly sSpin = new Float32Array(SHAPES);
  /** Orbiting items (bats): centre and angular speed; NaN: falls instead. */
  private readonly sOrbit = new Float32Array(SHAPES * 4);
  private sNext = 0;

  constructor(private readonly heightAt: (x: number, z: number) => number) {
    this.group.name = 'skill-shapes';
    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 8, true);
    // From y = 0 to y = 1, so the base is the origin and the scale's y is the length.
    beamGeo.translate(0, 0.5, 0);
    for (let i = 0; i < BEAMS; i++) {
      const mat = beamMaterial(this.time);
      const mesh = new THREE.Mesh(beamGeo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 3;
      this.group.add(mesh);
      this.beams.push({ mesh, mat, age: 0, spec: null, base: new THREE.Vector3() });
    }
    const sigilGeo = new THREE.CircleGeometry(1, 64);
    sigilGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < SIGILS; i++) {
      const mat = sigilMaterial(this.time);
      const mesh = new THREE.Mesh(sigilGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 2;
      this.group.add(mesh);
      this.sigils.push({ mesh, mat, age: 0, time: 0, radius: 1, spin: 0 });
    }
    const domeGeo = new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2);
    for (let i = 0; i < DOMES; i++) {
      const mat = domeMaterial(this.time);
      const mesh = new THREE.Mesh(domeGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 3;
      this.group.add(mesh);
      this.domes.push({ mesh, mat, age: 0, time: 0, radius: 1 });
    }
    const quad = new THREE.InstancedBufferGeometry();
    quad.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    quad.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    quad.setIndex([0, 1, 2, 0, 2, 3]);
    this.sPos = new Float32Array(SHAPES * 3);
    this.sMisc = new Float32Array(SHAPES * 4);
    this.sTint = new Float32Array(SHAPES * 3);
    quad.setAttribute('aPos', new THREE.InstancedBufferAttribute(this.sPos, 3).setUsage(THREE.DynamicDrawUsage));
    quad.setAttribute('aMisc', new THREE.InstancedBufferAttribute(this.sMisc, 4).setUsage(THREE.DynamicDrawUsage));
    quad.setAttribute('aTint', new THREE.InstancedBufferAttribute(this.sTint, 3).setUsage(THREE.DynamicDrawUsage));
    this.shapeMesh = new THREE.InstancedMesh(quad, shapeMaterial(), SHAPES);
    this.shapeMesh.frustumCulled = false;
    this.shapeMesh.count = SHAPES;
    this.shapeMesh.visible = false;
    this.group.add(this.shapeMesh);
  }

  /** A beam or blade of light (see BeamSpec). */
  beam(spec: BeamSpec): void {
    const slot = this.beams.find((b) => !b.spec) ?? this.beams.reduce((a, b) => (a.age > b.age ? a : b));
    slot.spec = spec;
    slot.age = 0;
    slot.base.set(spec.x, spec.y, spec.z);
    this.tmpDir.set(spec.dx, spec.dy, spec.dz).normalize();
    slot.mesh.quaternion.setFromUnitVectors(UP, this.tmpDir);
    slot.mat.uniforms.uColor.value.set(spec.color);
    slot.mat.uniforms.uBlade.value = spec.blade ? 1 : 0;
    slot.mesh.visible = true;
  }

  /** A glowing pattern on the ground at (x, z), growing to `radius` m, for `time` s. */
  sigil(x: number, z: number, pattern: SigilPattern, radius: number, color: number, time: number): void {
    const slot = this.sigils.find((s) => !s.mesh.visible) ?? this.sigils.reduce((a, b) => (a.age / a.time > b.age / b.time ? a : b));
    slot.age = 0;
    slot.time = time;
    slot.radius = radius;
    slot.spin = (Math.random() < 0.5 ? -1 : 1) * 0.35;
    slot.mesh.position.set(x, Math.max(0, this.heightAt(x, z)) + 0.05, z);
    slot.mesh.rotation.y = Math.random() * Math.PI * 2;
    slot.mat.uniforms.uPattern.value = SIGIL_ID[pattern];
    slot.mat.uniforms.uColor.value.set(color);
    slot.mesh.visible = true;
  }

  /** A shield dome over (x, z), `radius` m, held `time` s, then it pops. */
  dome(x: number, z: number, style: DomeStyle, radius: number, color: number, time: number): void {
    const slot = this.domes.find((d) => !d.mesh.visible) ?? this.domes[0];
    slot.age = 0;
    slot.time = time;
    slot.radius = radius;
    slot.mesh.position.set(x, Math.max(0, this.heightAt(x, z)), z);
    slot.mat.uniforms.uShell.value = style === 'shell' ? 1 : 0;
    slot.mat.uniforms.uColor.value.set(color);
    slot.mesh.visible = true;
  }

  /**
   * One shape sprite at (x, y, z) moving (vx, vy, vz) (falling under gravity), `size` m, for
   * `life` s; tinted (leaves, fruit, stars). With `orbit`, it circles that centre instead
   * (rising slowly): bats round the caster.
   */
  shape(kind: ShapeKind, x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, tint: number, life: number, orbit?: { x: number; z: number; speed: number }): void {
    const i = this.sNext;
    this.sNext = (this.sNext + 1) % SHAPES;
    this.sPos[i * 3] = x;
    this.sPos[i * 3 + 1] = y;
    this.sPos[i * 3 + 2] = z;
    this.sVel[i * 3] = vx;
    this.sVel[i * 3 + 1] = vy;
    this.sVel[i * 3 + 2] = vz;
    this.sMisc[i * 4] = SHAPE_ID[kind];
    this.sMisc[i * 4 + 1] = size;
    // Stars and leaves tumble; pumpkins, fruit and bats stay upright.
    const tumbles = kind === 'star' || kind === 'leaf';
    this.sMisc[i * 4 + 2] = tumbles ? Math.random() * Math.PI * 2 : (Math.random() - 0.5) * 0.3;
    this.sMisc[i * 4 + 3] = 1;
    const c = TINT.set(tint);
    this.sTint[i * 3] = c.r;
    this.sTint[i * 3 + 1] = c.g;
    this.sTint[i * 3 + 2] = c.b;
    this.sLife[i] = life;
    this.sAge[i] = 0;
    this.sSpin[i] = tumbles ? (Math.random() - 0.5) * 6 : 0;
    if (orbit) {
      this.sOrbit[i * 4] = orbit.x;
      this.sOrbit[i * 4 + 1] = orbit.z;
      this.sOrbit[i * 4 + 2] = orbit.speed;
      this.sOrbit[i * 4 + 3] = Math.hypot(x - orbit.x, z - orbit.z);
    } else {
      this.sOrbit[i * 4] = Number.NaN;
    }
    this.shapeMesh.visible = true;
  }

  update(dt: number): void {
    this.time.value += dt;
    for (const b of this.beams) this.updateBeam(b, dt);
    for (const s of this.sigils) {
      if (!s.mesh.visible) continue;
      s.age += dt;
      const k = s.age / s.time;
      if (k >= 1) {
        s.mesh.visible = false;
        continue;
      }
      // Springs open (with a little overshoot), turns slowly, fades in the last third.
      const grow = Math.min(1, s.age / 0.3);
      const open = 1 + Math.sin(grow * Math.PI) * 0.12 * (1 - grow);
      s.mesh.scale.setScalar(s.radius * (1 - (1 - grow) * (1 - grow)) * open);
      s.mesh.rotation.y += s.spin * dt;
      s.mat.uniforms.uLife.value = (k < 0.66 ? 1 : 1 - (k - 0.66) / 0.34) * (1 + Math.max(0, 1 - s.age * 4));
    }
    for (const d of this.domes) {
      if (!d.mesh.visible) continue;
      d.age += dt;
      const k = d.age / d.time;
      if (k >= 1) {
        d.mesh.visible = false;
        continue;
      }
      // Swells in, holds with a breathing wobble, then pops: a quick swell and fade.
      const grow = Math.min(1, d.age / 0.35);
      const pop = Math.max(0, (k - 0.88) / 0.12);
      const s = d.radius * (1 - (1 - grow) ** 3) * (1 + Math.sin(d.age * 5) * 0.02 + pop * 0.35);
      d.mesh.scale.set(s, s * 0.9, s);
      d.mat.uniforms.uLife.value = 1 - pop;
    }
    this.updateShapes(dt);
  }

  private updateBeam(b: BeamSlot, dt: number): void {
    const spec = b.spec;
    if (!spec) return;
    b.age += dt;
    const k = b.age / spec.time;
    if (k >= 1) {
      b.spec = null;
      b.mesh.visible = false;
      return;
    }
    // Length: out fast; a tongue comes back, the others hold and fade.
    const out = Math.min(1, k / 0.25);
    const len = spec.retract ? Math.sin(Math.min(1, k) * Math.PI) : 1 - (1 - out) ** 2;
    const fade = spec.retract ? 1 : k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
    // A blade is flat (a quarter as thick as it is wide); a beam is round.
    b.mesh.scale.set(spec.radius, Math.max(0.01, spec.length * len), spec.blade ? spec.radius * 0.25 : spec.radius);
    const drop = spec.drop ? spec.drop * Math.max(0, 1 - k / 0.4) ** 2 : 0;
    b.mesh.position.set(b.base.x, b.base.y + drop, b.base.z);
    b.mat.uniforms.uLife.value = fade;
  }

  private updateShapes(dt: number): void {
    if (!this.shapeMesh.visible) return;
    let alive = 0;
    const damp = Math.exp(-DRAG * dt);
    for (let i = 0; i < SHAPES; i++) {
      if (this.sMisc[i * 4 + 3] <= 0) continue;
      this.sAge[i] += dt;
      const life = this.sLife[i];
      const k = this.sAge[i] / life;
      if (k >= 1) {
        this.sMisc[i * 4 + 3] = 0;
        continue;
      }
      alive++;
      const o = i * 3;
      if (Number.isNaN(this.sOrbit[i * 4])) {
        this.sVel[o + 1] -= GRAVITY * dt;
        this.sVel[o] *= damp;
        this.sVel[o + 1] *= damp;
        this.sVel[o + 2] *= damp;
        this.sPos[o] += this.sVel[o] * dt;
        this.sPos[o + 1] += this.sVel[o + 1] * dt;
        this.sPos[o + 2] += this.sVel[o + 2] * dt;
        const g = Math.max(0, this.heightAt(this.sPos[o], this.sPos[o + 2])) + this.sMisc[i * 4 + 1] * 0.4;
        if (this.sPos[o + 1] < g) {
          // Lands: a little bounce, then lies there till it fades.
          this.sPos[o + 1] = g;
          this.sVel[o + 1] = Math.abs(this.sVel[o + 1]) * 0.25;
          this.sVel[o] *= 0.5;
          this.sVel[o + 2] *= 0.5;
          this.sSpin[i] *= 0.5;
        }
      } else {
        const cx = this.sOrbit[i * 4];
        const cz = this.sOrbit[i * 4 + 1];
        const a = Math.atan2(this.sPos[o + 2] - cz, this.sPos[o] - cx) + this.sOrbit[i * 4 + 2] * dt;
        const r = this.sOrbit[i * 4 + 3] * (1 + k * 0.8);
        this.sPos[o] = cx + Math.cos(a) * r;
        this.sPos[o + 2] = cz + Math.sin(a) * r;
        this.sPos[o + 1] += this.sVel[o + 1] * dt;
      }
      this.sMisc[i * 4 + 2] += this.sSpin[i] * dt;
      // Fades in quickly, out in the last fifth; bats flap (size wobble done in the shader).
      this.sMisc[i * 4 + 3] = Math.max(0.001, Math.min(1, this.sAge[i] * 8) * (k > 0.8 ? (1 - k) / 0.2 : 1));
    }
    const g = this.shapeMesh.geometry;
    (g.getAttribute('aPos') as THREE.InstancedBufferAttribute).needsUpdate = true;
    (g.getAttribute('aMisc') as THREE.InstancedBufferAttribute).needsUpdate = true;
    (g.getAttribute('aTint') as THREE.InstancedBufferAttribute).needsUpdate = true;
    if (alive === 0) this.shapeMesh.visible = false;
  }
}

const TINT = new THREE.Color();

/**
 * A tube of light, additive. Brightest where the tube faces you (its middle line), dimmer at the
 * sides; stripes run along it. A blade narrows to a point toward its far end.
 */
function beamMaterial(time: { value: number }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color() }, uLife: { value: 1 }, uBlade: { value: 0 }, uTime: time },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      uniform float uBlade;
      varying vec3 vN;
      varying vec3 vV;
      varying float vAlong;
      void main() {
        vec3 p = position;
        vAlong = position.y;
        // A blade: full width at the hilt end, a point at the tip.
        p.xz *= mix(1.0, max(0.02, 1.0 - position.y), uBlade);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uLife;
      uniform float uBlade;
      uniform float uTime;
      varying vec3 vN;
      varying vec3 vV;
      varying float vAlong;
      void main() {
        float facing = abs(dot(vN, vV));
        float core = pow(facing, 2.5);
        float stripes = 0.75 + 0.25 * sin(vAlong * 40.0 - uTime * 30.0);
        // A blade keeps its colour (gold) with a white edge where it faces you; a beam whitens at its core.
        vec3 c = mix(uColor, vec3(1.0), core * (0.6 - 0.3 * uBlade)) * (0.25 + 1.6 * core) * mix(stripes, 1.0, uBlade);
        c *= 1.0 + 0.4 * uBlade;
        gl_FragColor = vec4(c * uLife, 1.0);
      }
    `,
  });
}

/**
 * A pattern on the ground in polar coordinates (r: 0 centre … 1 rim, a: angle), additive. Each
 * pattern is a few lines: thin bright strokes from distance fields, an outer ring for all.
 */
function sigilMaterial(time: { value: number }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color() }, uLife: { value: 1 }, uPattern: { value: 0 }, uTime: time },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    vertexShader: /* glsl */ `
      varying vec2 vP;
      void main() {
        vP = position.xz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uLife;
      uniform float uPattern;
      uniform float uTime;
      varying vec2 vP;
      const float PI = 3.14159265;
      // A soft stroke where d is 0, w wide.
      float stroke(float d, float w) { return smoothstep(w, 0.0, abs(d)); }
      void main() {
        float r = length(vP);
        if (r > 1.0) discard;
        float a = atan(vP.y, vP.x);
        float v = stroke(r - 0.96, 0.02) + stroke(r - 0.9, 0.008) * 0.6;
        int p = int(uPattern + 0.5);
        if (p == 0) {
          // Web: 12 spokes and polygon rings (straight threads between spokes), a little sag.
          float n = 12.0;
          float seg = 2.0 * PI / n;
          float local = mod(a, seg) - seg * 0.5;
          v += stroke(local * r, 0.012);
          float rp = r * cos(local) / cos(seg * 0.5);
          float ring = fract(rp * 6.0 + 0.04 * sin(local * n));
          v += stroke(min(ring, 1.0 - ring) / 6.0, 0.006) * step(0.08, r);
        } else if (p == 1) {
          // Lotus: two rings of eight petals and a seed-pod circle.
          float petal = 0.55 + 0.4 * abs(cos(a * 4.0));
          float petal2 = 0.35 + 0.25 * abs(cos(a * 4.0 + PI / 4.0));
          v += stroke(r - petal, 0.02) + stroke(r - petal2, 0.018) + stroke(r - 0.18, 0.015);
          v += smoothstep(petal, petal - 0.3, r) * 0.15;
        } else if (p == 2) {
          // Honeycomb: hex cells (distance to the nearest cell edge).
          vec2 q = vP * 5.0;
          vec2 s = vec2(1.0, 1.7320508);
          vec2 h = s * 0.5;
          vec2 a1 = mod(q, s) - h;
          vec2 b1 = mod(q - h, s) - h;
          vec2 g = dot(a1, a1) < dot(b1, b1) ? a1 : b1;
          vec2 ag = abs(g);
          float edge = 0.5 - max(dot(ag, normalize(s)), ag.x);
          v += stroke(edge, 0.05) * smoothstep(1.0, 0.8, r);
        } else if (p == 3) {
          // Sun: a disc ring, twelve rays that pulse outward.
          v += stroke(r - 0.28, 0.025) + smoothstep(0.28, 0.0, r) * 0.35;
          float ray = pow(abs(cos(a * 6.0)), 40.0) * step(0.34, r) * smoothstep(0.92, 0.5, r);
          v += ray * (0.7 + 0.3 * sin(r * 20.0 - uTime * 10.0));
        } else if (p == 4) {
          // Crescent moon and a ring of small stars.
          float d1 = length(vP) - 0.55;
          float d2 = length(vP - vec2(0.22, 0.12)) - 0.47;
          float moon = max(d1, -d2);
          v += stroke(moon, 0.02) + smoothstep(0.0, -0.05, moon) * 0.35;
          float star = pow(abs(cos(a * 7.0)), 60.0) * stroke(r - 0.76, 0.03);
          v += star * 2.0;
        } else if (p == 5) {
          // The eight trigrams: three bars in each sector, broken by the sector's bits.
          v += stroke(r - 0.28, 0.012) + stroke(r - 0.82, 0.012);
          float sector = floor((a + PI) / (2.0 * PI) * 8.0);
          float within = fract((a + PI) / (2.0 * PI) * 8.0);
          for (int k = 0; k < 3; k++) {
            float rr = 0.45 + float(k) * 0.12;
            float bit = mod(floor(sector / pow(2.0, float(k))), 2.0);
            float bar = step(0.15, within) * step(within, 0.85);
            float gap = bit * step(0.43, within) * step(within, 0.57);
            v += stroke(r - rr, 0.025) * bar * (1.0 - gap);
          }
        } else {
          // Leaves: eight leaf outlines round a ring.
          float n = 8.0;
          float seg = 2.0 * PI / n;
          float local = mod(a + uTime * 0.2, seg) - seg * 0.5;
          vec2 l = vec2(r - 0.62, local * r);
          float leaf = length(vec2(l.x / 0.3, l.y / 0.12)) - 1.0;
          v += stroke(leaf, 0.12) + stroke(l.y, 0.01) * step(abs(l.x), 0.28);
          v += stroke(r - 0.3, 0.015);
        }
        gl_FragColor = vec4(mix(uColor, vec3(1.0), clamp(v - 1.0, 0.0, 0.6)) * v * uLife * 1.4, 1.0);
      }
    `,
  });
}

/**
 * A shield dome, additive: bright at the rim (fresnel: where the surface turns edge-on to you),
 * nearly clear in the middle. A bubble shimmers in rainbow colours; a shell shows hex plates.
 */
function domeMaterial(time: { value: number }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color() }, uLife: { value: 1 }, uShell: { value: 0 }, uTime: time },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vLocal;
      void main() {
        vLocal = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uLife;
      uniform float uShell;
      uniform float uTime;
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vLocal;
      vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
      void main() {
        float rim = pow(1.0 - abs(dot(vN, vV)), 2.2);
        vec3 c = uColor * (0.035 + rim * 1.0);
        if (uShell < 0.5) {
          // Thin-film shimmer: the colour turns with the angle and drifts with time.
          c += hue(rim * 1.5 + vLocal.y * 0.6 + uTime * 0.15) * rim * 0.7;
        } else {
          // Hex plates on the shell (from the direction on the sphere), bright seams.
          vec2 q = vec2(atan(vLocal.z, vLocal.x) * 3.0, vLocal.y * 5.0);
          vec2 s = vec2(1.0, 1.7320508);
          vec2 h = s * 0.5;
          vec2 a1 = mod(q, s) - h;
          vec2 b1 = mod(q - h, s) - h;
          vec2 g = dot(a1, a1) < dot(b1, b1) ? a1 : b1;
          vec2 ag = abs(g);
          float edge = 0.5 - max(dot(ag, normalize(s)), ag.x);
          c += uColor * smoothstep(0.06, 0.0, edge) * 0.9;
        }
        // The base ring where it meets the ground.
        c += uColor * smoothstep(0.08, 0.0, vLocal.y) * 0.8;
        gl_FragColor = vec4(c * uLife, 1.0);
      }
    `,
  });
}

/**
 * Camera-facing sprites drawn from distance fields: a star, a glowing jack-o'-lantern, a leaf,
 * a round fruit, a flapping bat. Opaque inside the shape (alpha-tested), so they sort with the
 * scene; pumpkins and stars glow a little.
 */
function shapeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {},
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute vec3 aPos;
      attribute vec4 aMisc;
      attribute vec3 aTint;
      varying vec2 vUv;
      varying float vShape;
      varying float vAlpha;
      varying vec3 vTint;
      void main() {
        vUv = uv;
        vShape = aMisc.x;
        vAlpha = aMisc.w;
        vTint = aTint;
        float c = cos(aMisc.z);
        float s = sin(aMisc.z);
        vec2 corner = mat2(c, s, -s, c) * position.xy * aMisc.y * step(0.0011, aMisc.w);
        vec4 mv = viewMatrix * vec4(aPos, 1.0);
        mv.xy += corner;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying float vShape;
      varying float vAlpha;
      varying vec3 vTint;
      const float PI = 3.14159265;
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p);
        float a = atan(p.y, p.x);
        int k = int(vShape + 0.5);
        vec3 col;
        float inside;
        if (k == 0) {
          // Five-pointed star, glowing.
          float star = 0.45 + 0.35 * pow(abs(cos(a * 2.5 + PI * 0.5)), 3.0);
          inside = smoothstep(star, star - 0.05, r);
          col = mix(vTint, vec3(1.0), smoothstep(star, 0.0, r)) * 1.6;
        } else if (k == 1) {
          // Pumpkin: a ribbed orange body, green stem, glowing eyes and grin.
          vec2 q = p * vec2(1.0, 1.15);
          float body = length(q) - 0.72 + 0.06 * abs(cos(a * 3.0));
          float stem = max(abs(p.x - 0.05) - 0.08, abs(p.y - 0.78) - 0.14);
          inside = max(smoothstep(0.02, -0.02, body), smoothstep(0.02, -0.02, stem));
          col = stem < 0.0 ? vec3(0.25, 0.5, 0.15) : vec3(1.0, 0.45, 0.05) * (0.8 + 0.2 * cos(p.x * 9.0));
          float eyeL = length(p - vec2(-0.25, 0.12)) - 0.12;
          float eyeR = length(p - vec2(0.25, 0.12)) - 0.12;
          float grin = max(abs(length(p - vec2(0.0, 0.25)) - 0.45) - 0.06, p.y + 0.0);
          if (min(min(eyeL, eyeR), grin) < 0.0 && body < 0.0) col = vec3(1.0, 0.9, 0.4) * 2.0;
        } else if (k == 2) {
          // Leaf: a pointed oval with a midrib.
          vec2 q = vec2(p.x, p.y * 1.8);
          float leaf = length(q) - 0.85 + 0.35 * abs(p.y);
          inside = smoothstep(0.03, -0.03, leaf);
          col = vTint * (0.85 + 0.25 * p.x) * (1.0 - 0.4 * smoothstep(0.04, 0.0, abs(p.y)));
        } else if (k == 3) {
          // Round fruit with a highlight and a little leaf.
          float fruit = r - 0.7;
          float leaf = length((p - vec2(0.2, 0.78)) * vec2(1.0, 2.2)) - 0.22;
          inside = max(smoothstep(0.03, -0.03, fruit), smoothstep(0.03, -0.03, leaf));
          col = leaf < 0.0 ? vec3(0.3, 0.65, 0.2) : vTint * (0.7 + 0.5 * smoothstep(0.5, 0.0, length(p - vec2(-0.25, 0.25))));
        } else {
          // Bat: a body and two scalloped wings.
          float body = length(p * vec2(1.6, 1.0)) - 0.32;
          float wy = p.y - 0.15 * abs(p.x) + 0.1 * sin(abs(p.x) * 12.0);
          float wing = max(abs(p.x) - 0.95, abs(wy) - 0.22 * (1.0 - abs(p.x)));
          inside = max(smoothstep(0.03, -0.03, body), smoothstep(0.03, -0.03, wing));
          col = vec3(0.12, 0.06, 0.18);
          if (length(p - vec2(-0.1, 0.12)) < 0.05 || length(p - vec2(0.1, 0.12)) < 0.05) col = vec3(1.0, 0.6, 0.1) * 2.0;
        }
        float alpha = inside * vAlpha;
        if (alpha < 0.02) discard;
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}
