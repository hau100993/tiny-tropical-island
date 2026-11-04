import * as THREE from 'three';
import type { SharedUniforms } from '../../core/uniforms';
import type { SkillSound } from '../../audio/synth/skillSounds';
import type { EmberSink } from './embers';
import { IceCrystals, type SpikeSpec } from './iceCrystals';
import { TrailRibbon, type RibbonProfile } from './trailRibbon';

/** The ice's top, above the calm sea level (m): clear of ordinary waves. */
export const ICE_TOP = 0.6;
/** Half the road's width (m) on average: a little wider than the manta's wings droop. */
export const ICE_HALF_WIDTH = 4.2;
/** The width wanders between these (× ICE_HALF_WIDTH), a little per point. */
export const ICE_WIDTH = { min: 0.75, max: 1.35, step: 0.12 } as const;
/** Seconds the ice lasts, then how long it takes to melt away. */
export const ICE_LIFE = 40;
export const ICE_MELT = 6;
/** Points in the ring (one every ~1.6 m: about 400 m of road at once). */
const POINTS = 256;
/** Spikes and drifting shards in the pools (the most, on High; see setQuality). */
const SPIKES = 600;
const SHARDS = 200;
/**
 * Clusters of spikes along the edges: the chance of one per point and side, crystals in it and
 * how far they spread (m); their heights (m; most small, some tall, now and then a big one) and
 * tilts from upright (rad).
 */
const CLUSTER = { chance: 0.45, min: 3, max: 7, spread: 1.4 } as const;
const SPIKE = { min: 0.7, max: 3.2, bigChance: 0.05, big: [4, 6], tilt: [0.3, 1.0], bigTilt: [0.2, 0.5] } as const;

const tmp2 = new THREE.Vector2();

/** A slab: the flat top (s −1 … 1 times the half width) and two bevelled sides down into the sea. */
const PROFILE: RibbonProfile = {
  verts: [
    [-1.12, -1.1],
    [-1, 0],
    [1, 0],
    [1.12, -1.1],
  ],
  bands: [
    [0, 1],
    [1, 2],
    [2, 3],
  ],
};

const VERT = /* glsl */ `
attribute vec2 aSide;
attribute vec2 aProf;
attribute float aBirth;
attribute float aAlong;
uniform float uTime;
uniform vec2 uScale;
uniform float uLife;
uniform float uMelt;
varying vec3 vWorld;
varying float vAge;
varying float vEdge;
void main() {
  float age = uTime - aBirth;
  // Freezing outward from the breath's line in a third of a second; settling a little as it melts.
  float grow = smoothstep(0.0, 0.35, age);
  float melt = smoothstep(uLife, uLife + uMelt, age);
  // A ragged outline on top of the width's wander (the side vector's length carries that).
  float wob = 1.0 + 0.1 * sin(aAlong * 0.7 + aBirth) + 0.06 * sin(aAlong * 2.3) + 0.04 * sin(aAlong * 5.1 + aBirth * 3.0);
  float s = aProf.x * uScale.x * wob * grow;
  float h = aProf.y * uScale.y - 0.2 * melt;
  vec3 p = position + vec3(aSide.x * s, h, aSide.y * s);
  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorld = world.xyz;
  vAge = age;
  vEdge = abs(aProf.x) > 1.01 ? 1.0 : 0.0;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uLife;
uniform float uMelt;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform float uDayLight;
uniform float uNight;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
varying vec3 vWorld;
varying float vAge;
varying float vEdge;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// Cellular (Voronoi) noise: x = distance to the nearest cell point, y = how far from the edge
// to the next cell (F2 − F1: 0 on an edge), z = the nearest cell's id (0..1). Ice breaks into
// polygons, so its cracks are cell edges.
vec3 voronoi(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  float id = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 r = g + vec2(hash(i + g), hash(i + g + 19.7)) - f;
      float d = dot(r, r);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = hash(i + g + 5.3);
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  return vec3(sqrt(d1), sqrt(d2) - sqrt(d1), id);
}
void main() {
  float melt = clamp((vAge - uLife) / uMelt, 0.0, 1.0);
  vec2 p = vWorld.xz;
  // Plates (~2.5 m) with finer cracks inside them (~0.8 m), the edges warped a little.
  vec2 warp = vec2(noise(p * 0.7), noise(p * 0.7 + 4.1)) * 0.5;
  vec3 big = voronoi(p * 0.4 + warp);
  vec3 small = voronoi(p * 1.25 + warp * 2.0 + 7.0);
  // Melting plate by plate: each starts at its own time, darkens as it goes under, then is gone.
  float cell = clamp((melt - big.z * 0.6) / 0.35, 0.0, 1.0);
  if (cell > 0.97) discard;
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (n.y < 0.0) n = -n;
  vec3 v = normalize(cameraPosition - vWorld);
  // Thick plates are a deeper blue, thin ones paler; frosty patches over them.
  float thick = big.z * 0.7 + noise(p * 0.5) * 0.3;
  vec3 base = mix(vec3(0.72, 0.92, 1.0), vec3(0.35, 0.7, 0.92), thick);
  float frost = smoothstep(0.45, 0.85, noise(p * 0.35) * 0.6 + noise(p * 1.9) * 0.4);
  base = mix(base, vec3(0.94, 0.98, 1.0), frost * 0.6);
  // Air bubbles caught in the ice: tiny pale dots, here and there.
  vec2 bc = floor(p * 5.0);
  vec2 bf = fract(p * 5.0) - 0.5 - (vec2(hash(bc + 3.1), hash(bc + 8.7)) - 0.5) * 0.6;
  float bubble = step(0.82, hash(bc)) * smoothstep(0.09, 0.04, length(bf)) * (1.0 - vEdge);
  base = mix(base, vec3(0.97, 1.0, 1.0), bubble * 0.6);
  // Cracks: white where the plates meet, faint inside them; wider as it melts.
  float wide = 0.06 + 0.1 * melt;
  float crack = max(1.0 - smoothstep(0.0, wide, big.y), 0.5 * (1.0 - smoothstep(0.0, wide * 0.6, small.y)));
  base = mix(base, vec3(0.96, 1.0, 1.0), crack * 0.6 * (1.0 - vEdge));
  // Sides: deeper, glassier blue.
  base = mix(base, vec3(0.3, 0.68, 0.88), vEdge * 0.7);
  // Lit by the sky all round and the sun (or moon) from its side; ice is bright.
  vec3 sky = mix(uSkyHorizon, uSkyTop, 0.5);
  vec3 light = sky * 0.55 + vec3(0.3) + uLightColor * 0.6 * max(dot(n, uLightDir), 0.0);
  vec3 col = base * light * (0.3 + 0.7 * uDayLight);
  // Sky reflection at grazing angles (Schlick's Fresnel).
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  col = mix(col, sky * (0.4 + 0.6 * uDayLight), fres * 0.5);
  // The light's glare, broken up plate by plate.
  vec3 hn = normalize(n + vec3(big.z - 0.5, 0.0, hash(vec2(big.z, 1.0)) - 0.5) * 0.12);
  col += uLightColor * pow(max(dot(reflect(-uLightDir, hn), v), 0.0), 80.0) * 0.8;
  // Glitter: a few tiny cells catching the light, each twinkling on its own beat.
  vec2 gc = floor(p * 6.0);
  float g = hash(gc);
  float tw = pow(max(sin(uTime * (2.0 + 3.0 * g) + g * 40.0 + dot(v.xz, vec2(9.0, 7.0))), 0.0), 30.0);
  float dotMask = smoothstep(0.35, 0.0, length(fract(p * 6.0) - 0.5));
  col += vec3(0.9, 0.97, 1.0) * step(0.86, g) * tw * dotMask * (1.0 + 2.0 * uNight) * (1.0 - vEdge);
  // The freezing front: its cracks flash cold light, then settle; a faint glow at night.
  float fresh = exp(-vAge * 3.0);
  col += vec3(0.35, 0.8, 1.0) * (uNight * (0.1 + 0.35 * crack) + fresh * (0.5 + 2.5 * crack));
  // A melting plate sinks: it takes the sea's deep blue and turns see-through.
  col = mix(col, vec3(0.08, 0.35, 0.55) * (0.4 + 0.6 * uDayLight), cell * 0.7);
  float a = smoothstep(0.0, 0.25, vAge) * mix(0.94, 0.82, vEdge) * (1.0 - 0.6 * cell);
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
}
`;

/** What the ice needs from the rest of the island for its bits: particles, splashes, sounds. */
export interface IceFx {
  frost: EmberSink;
  mist: EmberSink;
  ripple(x: number, z: number): void;
  sound(kind: SkillSound, size: number): void;
}

/**
 * The ice road of Hơi Thở Băng Giá: a slab of sea ice frozen along the breath's line, with a
 * ragged edge of wandering width, a polygon crack network (Voronoi), bubbles and glitter;
 * clusters of crystal spikes burst up along both edges and broken plates drift off. After
 * ICE_LIFE seconds the spikes crumble and the plates sink one by one. `floorAt` tells the
 * flight where the ice is (the manta glides on it).
 */
export class IceRoad {
  readonly mesh: THREE.Mesh;
  readonly ribbon: TrailRibbon;
  readonly crystals: IceCrystals;
  private readonly box = new THREE.Box2(new THREE.Vector2(Infinity, Infinity), new THREE.Vector2(-Infinity, -Infinity));
  private lastBirth = -1e9;
  private width = 1;
  private crackAt = -1e9;
  private crumbleAt = -1e9;
  private readonly spec: SpikeSpec = { x: 0, y: 0, z: 0, height: 1, thick: 0.3, tilt: 0, toward: 0, spin: 0, birth: 0, end: 0 };

  constructor(
    shared: SharedUniforms,
    private readonly fx: IceFx | null = null,
  ) {
    this.ribbon = new TrailRibbon(POINTS, PROFILE);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: shared.uTime,
        uScale: { value: new THREE.Vector2(ICE_HALF_WIDTH, 1) },
        uLife: { value: ICE_LIFE },
        uMelt: { value: ICE_MELT },
        uLightDir: shared.uLightDir,
        uLightColor: shared.uLightColor,
        uDayLight: shared.uDayLight,
        uNight: shared.uNight,
        uSkyTop: shared.uSkyTop,
        uSkyHorizon: shared.uSkyHorizon,
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
    });
    this.mesh = new THREE.Mesh(this.ribbon.geometry, mat);
    this.mesh.name = 'ice-road';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 1;
    this.crystals = new IceCrystals(shared, SPIKES, SHARDS);
  }

  /** The meshes to add to the scene. */
  get objects(): THREE.Object3D[] {
    return [this.mesh, this.crystals.spikes, this.crystals.shards];
  }

  /** Quality: spikes and shards drawn (Low draws about a third). */
  setQuality(spikes: number, shards: number): void {
    this.crystals.setLimits(spikes, shards);
  }

  /** Freezes the sea at (x, z) along the side vector (sx, sz) (unit), now. */
  add(x: number, z: number, sx: number, sz: number, now: number): void {
    // The width wanders from point to point, pulled back toward the middle of its range.
    this.width += (Math.random() - 0.5) * 2 * ICE_WIDTH.step + (1.05 - this.width) * 0.15;
    this.width = Math.min(ICE_WIDTH.max, Math.max(ICE_WIDTH.min, this.width));
    this.ribbon.push(x, ICE_TOP, z, sx * this.width, sz * this.width, now);
    this.lastBirth = now;
    this.box.expandByPoint(tmp2.set(x, z));
    this.mesh.visible = true;
    const edge = ICE_HALF_WIDTH * this.width;
    for (const side of [-1, 1]) {
      const ox = sx * side;
      const oz = sz * side;
      const ex = x + ox * edge;
      const ez = z + oz * edge;
      // Fewer clusters when the preset allows fewer spikes, so a whole breath's worth fits in
      // the pool and none is taken back while it still stands.
      if (Math.random() < CLUSTER.chance * Math.min(1, this.crystals.spikeLimit / SPIKES)) this.cluster(ex, ez, ox, oz, now);
      // Broken plates now and then, drifting off outward.
      if (Math.random() < 0.5) {
        const out = 0.6 + Math.random() * 2.5;
        const v = 0.15 + Math.random() * 0.35;
        this.crystals.addShard(ex + ox * out, ez + oz * out, 0.35 + Math.random() * 0.9, ox * v, oz * v, now + Math.random() * 0.3, now + ICE_LIFE + Math.random() * ICE_MELT);
      }
      // The freezing front throws up ice and cold mist at the edge.
      const fx = this.fx;
      if (fx) {
        for (let k = 0; k < 3; k++) fx.frost.emit(ex, ICE_TOP + 0.2, ez, ox * (1 + Math.random() * 2), 2 + Math.random() * 3, oz * (1 + Math.random() * 2), 0.25 + Math.random() * 0.3);
        if (Math.random() < 0.4) fx.mist.emit(ex, ICE_TOP + 0.3, ez, ox * 0.8, 0.6, oz * 0.8, 0.9 + Math.random() * 0.8);
      }
    }
  }

  /**
   * A cluster of spikes round (x, z) on the edge, leaning outward along (ox, oz) (unit); they
   * burst up one after another in a quarter of a second.
   */
  private cluster(x: number, z: number, ox: number, oz: number, now: number): void {
    const n = CLUSTER.min + Math.floor(Math.random() * (CLUSTER.max - CLUSTER.min + 1));
    const out = Math.atan2(ox, oz);
    const s = this.spec;
    for (let k = 0; k < n; k++) {
      const big = Math.random() < SPIKE.bigChance;
      // Mostly short, a few tall (a squared random number leans low).
      const r = Math.random();
      s.height = big ? SPIKE.big[0] + Math.random() * (SPIKE.big[1] - SPIKE.big[0]) : SPIKE.min + r * r * (SPIKE.max - SPIKE.min);
      s.thick = s.height * (0.12 + Math.random() * 0.1) + 0.1;
      // Along the edge either way, and only outward from it: the wings pass just inside.
      const along = (Math.random() - 0.5) * 2 * CLUSTER.spread;
      const outward = Math.random() * CLUSTER.spread * 0.8;
      s.x = x + ox * outward - oz * along;
      s.z = z + oz * outward + ox * along;
      s.y = ICE_TOP - 0.15;
      const [t0, t1] = big ? SPIKE.bigTilt : SPIKE.tilt;
      s.tilt = t0 + Math.random() * (t1 - t0);
      // Leaning outward, fanning out to either side.
      s.toward = out + (Math.random() - 0.5) * 1.3;
      s.spin = Math.random() * Math.PI * 2;
      s.birth = now + 0.05 + k * 0.04 + Math.random() * 0.08;
      s.end = now + ICE_LIFE - 1 + Math.random() * ICE_MELT * 0.6;
      this.crystals.addSpike(s, Math.random());
    }
    if (this.fx && now - this.crackAt > 0.12) {
      this.crackAt = now;
      this.fx.sound('crack', 0.4 + Math.random() * 0.4);
    }
  }

  /** The breath stopped (or went over land): the next ice is a new floe. */
  cut(): void {
    this.ribbon.cut();
  }

  /** Every frame: spikes crumbling into crystals; hides everything once it has all melted. */
  update(now: number): void {
    const c = this.crystals;
    const fx = this.fx;
    if (c.spikes.visible) {
      for (let i = 0; i < c.spikeLimit; i++) {
        if (c.crumbled[i] || now < c.endAt[i]) continue;
        c.crumbled[i] = 1;
        if (!fx) continue;
        // Its crumbs: crystals down its length, a splash where it drops in.
        for (let k = 0; k < 6; k++) {
          const t = Math.random();
          fx.frost.emit(c.tipX[i] + (Math.random() - 0.5), ICE_TOP + (c.tipY[i] - ICE_TOP) * t, c.tipZ[i] + (Math.random() - 0.5), (Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3, 0.25 + Math.random() * 0.35);
        }
        if (i % 3 === 0) fx.ripple(c.tipX[i], c.tipZ[i]);
        if (now - this.crumbleAt > 0.15) {
          this.crumbleAt = now;
          fx.sound('shatter', 0.3 + Math.random() * 0.4);
        }
      }
    }
    if (this.mesh.visible && now - this.lastBirth > ICE_LIFE + ICE_MELT) this.clear();
  }

  /** Forgets all of it (melted, or the shader clock was reset). */
  clear(): void {
    this.ribbon.clear();
    this.box.makeEmpty();
    this.mesh.visible = false;
    this.crystals.clear();
  }

  /** The ice's top at (x, z) if solid ice is there (not melting), else −Infinity. */
  floorAt(x: number, z: number, now: number): number {
    const b = this.box;
    const w = ICE_HALF_WIDTH * ICE_WIDTH.max;
    if (x < b.min.x - w || x > b.max.x + w || z < b.min.y - w || z > b.max.y + w) return -Infinity;
    const r = this.ribbon;
    // Within the narrowest the road gets (where it's certainly ice).
    const reach = ICE_HALF_WIDTH * ICE_WIDTH.min * 0.95;
    for (let i = 0; i < r.max; i++) {
      if (!r.linked[i]) continue;
      const j = r.prev(i);
      // Solid until half way through melting; and frozen across by now (a third of a second).
      const ageA = now - r.born[j];
      const ageB = now - r.born[i];
      if (ageA > ICE_LIFE + ICE_MELT * 0.5 || ageB < 0.2) continue;
      if (segmentDistance(x, z, r.cx[j], r.cz[j], r.cx[i], r.cz[i]) < reach) return ICE_TOP;
    }
    return -Infinity;
  }

  dispose(): void {
    this.ribbon.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.crystals.dispose();
  }
}

/** Distance from (x, z) to the segment a–b (m). */
export function segmentDistance(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}
