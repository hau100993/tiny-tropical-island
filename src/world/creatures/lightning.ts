import * as THREE from 'three';

/** Bolts that can be lit at once, points along each (main path), and per branch. */
const BOLTS = 6;
const MAIN = 33;
const BRANCH = 12;
const BRANCHES = 2;
/** Points per bolt (main + branches), and ribbon vertices (two per point). */
const PER_BOLT = MAIN + BRANCHES * BRANCH;
/** The path is redrawn this often (s): an arc never holds still. */
const REJAG = 0.05;

const VERT = /* glsl */ `
attribute float aAcross;
attribute float aGlow;
varying float vAcross;
varying float vGlow;
void main() {
  vAcross = aAcross;
  vGlow = aGlow;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

/**
 * Across the ribbon: a thin white-hot core and a wide coloured glow round it (two Gaussians);
 * `vGlow` is the bolt's brightness now (flicker, fade), less on the branches.
 */
const FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vAcross;
varying float vGlow;
void main() {
  float x = vAcross;
  float core = exp(-x * x * 40.0);
  float glow = exp(-x * x * 3.5);
  vec3 col = vec3(1.0) * core * 3.0 + uColor * glow * 1.6;
  gl_FragColor = vec4(col * vGlow, 1.0);
}
`;

interface Bolt {
  /** s since it struck (Infinity: dark), and how long it lasts. */
  age: number;
  life: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  /** Ribbon half-width (m). */
  width: number;
  /** The jagged path (world), main then branches; until the next re-jag (s). */
  points: THREE.Vector3[];
  branchFrom: number[];
  rejag: number;
}

/**
 * Lightning bolts (Mochi's "Lightning Strike"): each a jagged path from where the spark leaves to
 * what it hits, redrawn every 50 ms (midpoint displacement: each segment's middle pushed
 * sideways, less at each level) with two forks, drawn as camera-facing ribbons with an
 * additive white core and blue-yellow glow, flickering. All bolts are one mesh (one draw call),
 * rebuilt on the CPU while any is lit (a few hundred vertices).
 */
export class Lightning {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly bolts: Bolt[] = [];
  private readonly pos: THREE.BufferAttribute;
  private readonly across: THREE.BufferAttribute;
  private readonly glow: THREE.BufferAttribute;
  private readonly tmp = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private readonly toCam = new THREE.Vector3();

  constructor(color = 0xffe066) {
    const verts = BOLTS * PER_BOLT * 2;
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(verts * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.across = new THREE.BufferAttribute(new Float32Array(verts), 1);
    this.glow = new THREE.BufferAttribute(new Float32Array(verts), 1).setUsage(THREE.DynamicDrawUsage);
    for (let v = 0; v < verts; v++) (this.across.array as Float32Array)[v] = v % 2 === 0 ? -1 : 1;
    geo.setAttribute('position', this.pos);
    geo.setAttribute('aAcross', this.across);
    geo.setAttribute('aGlow', this.glow);
    // Quads between consecutive points of each strand (main, each branch).
    const index: number[] = [];
    for (let b = 0; b < BOLTS; b++) {
      const base = b * PER_BOLT;
      const strand = (start: number, n: number): void => {
        for (let i = 0; i < n - 1; i++) {
          const p = (base + start + i) * 2;
          index.push(p, p + 1, p + 2, p + 1, p + 3, p + 2);
        }
      };
      strand(0, MAIN);
      for (let k = 0; k < BRANCHES; k++) strand(MAIN + k * BRANCH, BRANCH);
    }
    geo.setIndex(index);
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(color) } },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 6;
    for (let b = 0; b < BOLTS; b++) {
      this.bolts.push({
        age: Infinity,
        life: 1,
        from: new THREE.Vector3(),
        to: new THREE.Vector3(),
        width: 0.2,
        points: Array.from({ length: PER_BOLT }, () => new THREE.Vector3()),
        branchFrom: [0, 0],
        rejag: 0,
      });
    }
  }

  /** A bolt from `from` to `to` (world), lit for `life` s, `width` m wide glow. */
  strike(from: THREE.Vector3, to: THREE.Vector3, life = 0.4, width = 0.22): void {
    // The oldest one makes way.
    let b = this.bolts[0];
    for (const c of this.bolts) {
      if (c.age >= c.life) {
        b = c;
        break;
      }
      if (c.age / c.life > b.age / b.life) b = c;
    }
    b.from.copy(from);
    b.to.copy(to);
    b.age = 0;
    b.life = life;
    b.width = width;
    b.rejag = 0;
    this.mesh.visible = true;
  }

  /** Any bolt still lit. */
  get busy(): boolean {
    return this.bolts.some((b) => b.age < b.life);
  }

  update(dt: number, camera: THREE.Camera): void {
    if (!this.mesh.visible) return;
    const p = this.pos.array as Float32Array;
    const g = this.glow.array as Float32Array;
    let any = false;
    for (let bi = 0; bi < BOLTS; bi++) {
      const b = this.bolts[bi];
      const base = bi * PER_BOLT;
      if (b.age >= b.life) {
        for (let v = base * 2; v < (base + PER_BOLT) * 2; v++) g[v] = 0;
        continue;
      }
      any = true;
      b.age += dt;
      b.rejag -= dt;
      if (b.rejag <= 0) {
        b.rejag = REJAG;
        this.jag(b);
      }
      // Bright at once, flickering (a few strokes, as real lightning restrikes), fading out.
      const k = b.age / b.life;
      const flick = 0.55 + 0.45 * Math.sign(Math.sin(b.age * 60 + bi)) * Math.random();
      const bright = Math.max(0, (1 - k * k) * flick);
      for (let i = 0; i < PER_BOLT; i++) {
        const branch = i >= MAIN;
        // Each strand's end: the point before it (for the ribbon's direction).
        const first = i === 0 || i === MAIN || i === MAIN + BRANCH;
        const a = b.points[first ? i : i - 1];
        const c = b.points[first ? i + 1 : i];
        const pt = b.points[i];
        this.toCam.copy(camera.position).sub(pt);
        this.side.copy(c).sub(a).cross(this.toCam).normalize();
        // Thinner along the forks and toward their tips.
        const w = b.width * (branch ? 0.55 * (1 - ((i - MAIN) % BRANCH) / BRANCH) : 1);
        for (let s = 0; s < 2; s++) {
          const v = (base + i) * 2 + s;
          this.tmp.copy(pt).addScaledVector(this.side, s === 0 ? -w : w);
          p[v * 3] = this.tmp.x;
          p[v * 3 + 1] = this.tmp.y;
          p[v * 3 + 2] = this.tmp.z;
          g[v] = bright * (branch ? 0.6 : 1);
        }
      }
    }
    this.pos.needsUpdate = true;
    this.glow.needsUpdate = true;
    this.mesh.visible = any;
  }

  /** A new jagged path: the main strand by midpoint displacement, two forks off it. */
  private jag(b: Bolt): void {
    const pts = b.points;
    const len = b.from.distanceTo(b.to);
    pts[0].copy(b.from);
    pts[MAIN - 1].copy(b.to);
    this.displace(pts, 0, MAIN - 1, len * 0.18);
    for (let k = 0; k < BRANCHES; k++) {
      // A fork leaves from somewhere in the middle half, heading off at an angle, fading.
      const at = Math.floor(MAIN * (0.25 + Math.random() * 0.5));
      const start = MAIN + k * BRANCH;
      const o = pts[at];
      pts[start].copy(o);
      const dir = this.tmp.copy(b.to).sub(b.from).normalize();
      const end = pts[start + BRANCH - 1];
      end.set(dir.x + (Math.random() - 0.5) * 1.6, dir.y + (Math.random() - 0.3) * 1.2, dir.z + (Math.random() - 0.5) * 1.6).normalize().multiplyScalar(len * (0.15 + Math.random() * 0.2)).add(o);
      // (Branch: a straight line pushed about, segment by segment.)
      for (let i = 1; i < BRANCH - 1; i++) {
        const t = i / (BRANCH - 1);
        pts[start + i].lerpVectors(o, end, t).add(this.side.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(len * 0.05));
      }
    }
  }

  /** Midpoint displacement between pts[i0] and pts[i1] (both set): the middle pushed `amp` m sideways, halving each level. */
  private displace(pts: THREE.Vector3[], i0: number, i1: number, amp: number): void {
    if (i1 - i0 < 2) return;
    const m = (i0 + i1) >> 1;
    pts[m].lerpVectors(pts[i0], pts[i1], 0.5).add(this.side.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(2 * amp));
    this.displace(pts, i0, m, amp * 0.5);
    this.displace(pts, m, i1, amp * 0.5);
  }
}
