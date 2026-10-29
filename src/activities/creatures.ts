import * as THREE from 'three';
import { Spray } from '../water/Spray';
import { PetPointer } from '../controls/petPointer';
import type { ClickAim } from '../controls/waterClick';
import type { SharedUniforms } from '../core/uniforms';
import { AirBubbles } from '../world/creatures/airBubbles';
import { Embers, type EmberSink } from '../world/creatures/embers';
import type { SkillFxSink } from '../world/creatures/skillFx';
import type { SkillElement } from '../ui/skillCard';
import type { StrikeTarget } from './dogSkills';
import type { Partner } from './combos';
import type { SpraySink } from '../water/Spray';
import { WildCreatures, type Attacker, type WildTarget } from './wildCreatures';
import type { BubbleSink } from '../world/creatures/airBubbles';
import type { TrunkInstance } from '../world/vegetation/forest';
import type { PetBody } from '../world/pets/bodies';
// Type-only: the models, behaviours and the GLTFLoader are a separate chunk, fetched on first use.
import type { CrabModel } from '../world/creatures/crabModel';
import type { BubbleCrab, CrabPlayer, CrabSkill } from '../world/creatures/bubbleCrab';
import type { DragonModel } from '../world/creatures/dragonModel';
import type { DragonSkill, FireDragon } from '../world/creatures/fireDragon';
import type { JetStream } from '../world/creatures/jetStream';
import type { BigBubble } from '../world/creatures/bigBubble';
import type { FlameSprite, GroundGlow } from '../world/creatures/flames';
import type { BunnyModel } from '../world/creatures/bunnyModel';
import type { BunnySkill, GrassBunny } from '../world/creatures/grassBunny';
import type { LeafStorm } from '../world/creatures/leafStorm';
import type { Blooms } from '../world/creatures/blooms';
import waterCrabUrl from '../assets/creatures/water-crab.glb?url';
import fireDragonUrl from '../assets/creatures/fire-dragon.glb?url';
import grassBunnyUrl from '../assets/creatures/grass-bunny.glb?url';

/** Where a pet's head is (world), for the feeding bubble. */
export interface PetSpot {
  id: string;
  x: number;
  y: number;
  z: number;
}

/** What the creatures need from the app. */
export interface CreatureHost {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  shared: SharedUniforms;
  heightAt(x: number, z: number): number;
  /** Distance from the island centre to open water along `angle` (rad). */
  seaRadius(angle: number): number;
  ripple(x: number, z: number, radius: number, strength: number): void;
  /** Where each lives (world x, z). */
  homes: { crab: { x: number; z: number }; dragon: { x: number; z: number }; bunny: { x: number; z: number } };
  /** Where the house stands (Mầm keeps clear of its stilts). */
  house: { x: number; z: number };
  /** The forest's trunks, and how many stand within `r` m of (x, z) (the wild ones live there). */
  trunks: readonly TrunkInstance[];
  treesNear(x: number, z: number, r: number): number;
  /** How the pointer aims now (as for Mochi), and whether Mochi is under it (Mochi wins). */
  aim(): ClickAim;
  dogHover(): boolean;
  /** Walking about the island: you (feet), else false. */
  player(out: CrabPlayer): boolean;
  /** Rain now, 0..1 (the tail flame shrinks). */
  rain(): number;
  /** How a sound at (x, y, z) is heard (gain, pan), or null (too far, or activity sounds off). */
  ear(x: number, y: number, z: number): { gain: number; pan: number } | null;
  sound: {
    squirt(duration: number, gain: number, pan: number): void;
    crab(kind: 'greet' | 'dance', gain: number, pan: number): void;
    flame(duration: number, gain: number, pan: number): void;
    dragon(kind: 'greet' | 'dance', gain: number, pan: number): void;
    leaves(duration: number, gain: number, pan: number): void;
    bunny(kind: 'greet' | 'dance', gain: number, pan: number): void;
  };
  /** Water hit you: soaked. Fire hit you: dried. */
  soak(): void;
  dry(): void;
  /** Rainbow motes, shared (the geyser's rainbow, the dragon's and Mầm's sparkles). */
  rainbow: EmberSink;
  /** Flashes, shock waves, shake, framing and big sounds for the skills. */
  fx: SkillFxSink;
  /** A wild one in the forest gets ready to attack, then attacks (activities/ambush.ts). */
  wildWindup(a: Attacker): void;
  wildAttack(a: Attacker): void;
  /** A skill you set off (a key or a click) started at (x, z): show its name (and maybe a combo). */
  skillCard(skill: string, element: SkillElement, x: number, z: number): void;
}

interface Crab {
  model: CrabModel;
  brain: BubbleCrab;
  stream: JetStream;
  big: BigBubble;
  column: JetStream;
}

interface Dragon {
  model: DragonModel;
  brain: FireDragon;
  stream: JetStream;
  tailFlame: FlameSprite;
  glow: GroundGlow;
}

interface Bunny {
  model: BunnyModel;
  brain: GrassBunny;
  leaves: LeafStorm;
  blooms: Blooms;
}

/**
 * The elemental creatures (world/creatures/): Bọt the water crab, Hỏa Long the fire dragon and
 * Mầm the grass bunny. Each loads on first use, its shaders compiled in the background before it
 * joins the scene. Owns their effect pools (droplets, soap bubbles, embers, steam, pollen: one
 * draw call each, nothing when idle) and the mouse on them (hover and click, like petting Mochi).
 */
export class Creatures {
  private readonly jetSpray: Spray;
  private readonly bubbles: AirBubbles;
  private readonly embers: Embers;
  private readonly steam: Embers;
  private readonly spores: Embers;
  /** Mầm's dandelion seeds, and the breeze they ride (reused). */
  private readonly fluff: Embers;
  private readonly breeze = { x: 0, z: 0 };
  private readonly crabPointer: PetPointer;
  private readonly dragonPointer: PetPointer;
  private readonly bunnyPointer: PetPointer;
  private crab: Crab | null = null;
  private dragon: Dragon | null = null;
  private bunny: Bunny | null = null;
  private crabOn = false;
  private dragonOn = false;
  private bunnyOn = false;
  private crabLoading = false;
  private dragonLoading = false;
  private bunnyLoading = false;
  private readonly wind = { strength: 0, x: 0, y: 0 };
  /** Wild ones in the rainforest (wildCreatures.ts). */
  private readonly wild: WildCreatures;
  private readonly you: CrabPlayer = { x: 0, z: 0, y: 0 };
  private readonly mouth = new THREE.Vector3();
  private readonly tip = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();

  constructor(private readonly host: CreatureHost) {
    const { scene, shared } = host;
    this.jetSpray = new Spray(shared, 'jet');
    this.bubbles = new AirBubbles(shared, (x, z) => host.heightAt(x, z));
    this.embers = new Embers(shared, 'ember');
    this.steam = new Embers(shared, 'steam');
    this.spores = new Embers(shared, 'spore');
    this.fluff = new Embers(shared, 'fluff');
    scene.add(this.jetSpray.points, this.bubbles.points, this.embers.points, this.steam.points, this.spores.points, this.fluff.points);
    this.wild = new WildCreatures({
      scene,
      camera: host.camera,
      shared,
      heightAt: host.heightAt,
      trunks: host.trunks,
      treesNear: host.treesNear,
      bubbles: this.bubbles,
      embers: this.embers,
      spores: this.spores,
      voice: (kind, x, y, z) =>
        this.play(x, y, z, (g, p) => (kind === 'crab' ? host.sound.crab('greet', g, p) : kind === 'dragon' ? host.sound.dragon('greet', g, p) : host.sound.bunny('greet', g, p))),
      load: async (count) => {
        const [{ CrabModel }, { DragonModel }, { BunnyModel }] = await Promise.all([
          import('../world/creatures/crabModel'),
          import('../world/creatures/dragonModel'),
          import('../world/creatures/bunnyModel'),
        ]);
        const [crabs, dragons, bunnies] = await Promise.all([
          CrabModel.loadMany(waterCrabUrl, shared, count),
          DragonModel.loadMany(fireDragonUrl, shared, count),
          BunnyModel.loadMany(grassBunnyUrl, shared, count),
        ]);
        return { crabs, dragons, bunnies };
      },
      compile: (root) => this.compileHidden(root, []),
      windup: (a) => host.wildWindup(a),
      attack: (a) => host.wildAttack(a),
      banished: (kind, x, y, z) => {
        // Gone in a flash of its colour and a burst of sparkles.
        host.fx.flash(x, y, z, kind === 'crab' ? 0x9fe8ff : kind === 'dragon' ? 0xffb060 : 0xb8ff8a, 70, 8, 0.3);
        host.fx.shock(x, y, z, 'energy', 0xffffff, 2.2, 0.4);
        for (let i = 0; i < 70; i++) {
          const a = Math.random() * Math.PI * 2;
          const c = Math.random() * 2 - 1;
          const s = Math.sqrt(1 - c * c);
          const v = 1 + Math.random() * 2.5;
          host.rainbow.emit(x, y, z, Math.cos(a) * s * v, c * v + 0.5, Math.sin(a) * s * v, 0.04 + Math.random() * 0.05);
        }
      },
    });
    const dom = host.renderer.domElement;
    this.crabPointer = new PetPointer(dom, host.camera, {
      // Like Mochi: the cursor, from above or walking.
      aim: () => (this.crab?.model.root.visible ? host.aim() : 'none'),
      hit: (ray) => {
        if (host.dogHover()) return false;
        const d = this.crab?.model.hitTest(ray) ?? null;
        return d !== null;
      },
      onStart: () => this.crab?.brain.pat(),
      onMove: () => {},
      onEnd: () => {},
    });
    this.dragonPointer = new PetPointer(dom, host.camera, {
      aim: () => (this.dragon?.model.root.visible ? host.aim() : 'none'),
      hit: (ray) => {
        if (host.dogHover() || this.crabPointer.hover) return false;
        const d = this.dragon?.model.hitTest(ray) ?? null;
        return d !== null;
      },
      onStart: () => this.dragon?.brain.pat(),
      onMove: () => {},
      onEnd: () => {},
    });
    this.bunnyPointer = new PetPointer(dom, host.camera, {
      aim: () => (this.bunny?.model.root.visible ? host.aim() : 'none'),
      hit: (ray) => {
        if (host.dogHover() || this.crabPointer.hover || this.dragonPointer.hover) return false;
        const d = this.bunny?.model.hitTest(ray) ?? null;
        return d !== null;
      },
      onStart: () => this.bunny?.brain.pat(),
      onMove: () => {},
      onEnd: () => {},
    });
  }

  /** The pointer is on a creature (no water click, the paw cursor). */
  get hover(): boolean {
    return this.crabPointer.hover || this.dragonPointer.hover || this.bunnyPointer.hover;
  }

  /** Shows or hides each (loading it the first time it is shown). */
  setEnabled(crab: boolean, dragon: boolean, bunny: boolean): void {
    this.crabOn = crab;
    this.dragonOn = dragon;
    this.bunnyOn = bunny;
    if (crab && !this.crab && !this.crabLoading) this.loadCrab();
    if (dragon && !this.dragon && !this.dragonLoading) this.loadDragon();
    if (bunny && !this.bunny && !this.bunnyLoading) this.loadBunny();
    if (this.crab) this.crab.model.root.visible = crab;
    if (this.dragon) this.dragon.model.root.visible = dragon;
    if (this.bunny) this.bunny.model.root.visible = bunny;
  }

  /**
   * Bọt's water skills (R: each press the next): which one started, 'busy' (one is under way)
   * or 'off' (Bọt is off or not loaded yet).
   */
  waterSkill(): CrabSkill | 'busy' | 'off' {
    if (!this.crabOn || !this.crab) return 'off';
    return this.crab.brain.command() ?? 'busy';
  }

  /** Hỏa Long's fire skills (X: each press the next); see waterSkill. */
  fireSkill(): DragonSkill | 'busy' | 'off' {
    if (!this.dragonOn || !this.dragon) return 'off';
    return this.dragon.brain.command() ?? 'busy';
  }

  /**
   * The creatures shown within `r` m of (x, z), as things Mochi's lightning can strike (`out`
   * is appended to); one that is struck hits back with a skill of its own, or dances.
   */
  strikeTargets(x: number, z: number, r: number, out: StrikeTarget[]): void {
    const add = (on: boolean, root: THREE.Object3D, bx: number, by: number, bz: number, up: number, pat: () => void): void => {
      if (!on || !root.visible || Math.hypot(bx - x, bz - z) > r) return;
      out.push({ x: bx, y: by + up, z: bz, kind: 'creature', body: root, hit: pat });
    };
    if (this.crab) add(this.crabOn, this.crab.model.root, this.crab.brain.x, this.crab.brain.y, this.crab.brain.z, 0.3, () => this.crab?.brain.pat());
    if (this.dragon) add(this.dragonOn, this.dragon.model.root, this.dragon.brain.x, this.dragon.brain.y, this.dragon.brain.z, 0, () => this.dragon?.brain.pat());
    if (this.bunny) add(this.bunnyOn, this.bunny.model.root, this.bunny.brain.x, this.bunny.brain.y, this.bunny.brain.z, 0.4, () => this.bunny?.brain.pat());
  }

  /** Their effect pools, for the combos (flowers only once Mầm is loaded). */
  get pools(): { embers: EmberSink; steam: EmberSink; spores: EmberSink; fluff: EmberSink; spray: SpraySink; bubbles: BubbleSink; bloom(x: number, z: number, n: number): void } {
    return {
      embers: this.embers,
      steam: this.steam,
      spores: this.spores,
      fluff: this.fluff,
      spray: this.jetSpray,
      bubbles: this.bubbles,
      bloom: (x, z, n) => this.bunny?.blooms.spawnCluster(x, z, n),
    };
  }

  /** The creatures within `r` m of (x, z) other than `except`'s, that could join a skill (a combo). */
  partners(x: number, z: number, r: number, except: string, out: Partner[]): void {
    const near = (bx: number, bz: number): boolean => Math.hypot(bx - x, bz - z) < r;
    const c = this.crab;
    const d = this.dragon;
    const b = this.bunny;
    if (except !== 'water' && this.crabOn && c && near(c.brain.x, c.brain.z)) out.push({ element: 'water', x: c.brain.x, z: c.brain.z, start: () => c.brain.command() !== null });
    if (except !== 'fire' && this.dragonOn && d && near(d.brain.x, d.brain.z)) out.push({ element: 'fire', x: d.brain.x, z: d.brain.z, start: () => d.brain.command() !== null });
    if (except !== 'grass' && this.bunnyOn && b && near(b.brain.x, b.brain.z)) out.push({ element: 'grass', x: b.brain.x, z: b.brain.z, start: () => b.brain.command() !== null });
  }

  /** A blast (Mochi's bark) at (x, z): those within `r` m jump (a pat: a dance, or a skill back). */
  startle(x: number, z: number, r: number): void {
    const near = (bx: number, bz: number): boolean => Math.hypot(bx - x, bz - z) < r;
    if (this.crabOn && this.crab && near(this.crab.brain.x, this.crab.brain.z)) this.crab.brain.pat();
    if (this.dragonOn && this.dragon && near(this.dragon.brain.x, this.dragon.brain.z)) this.dragon.brain.pat();
    if (this.bunnyOn && this.bunny && near(this.bunny.brain.x, this.bunny.brain.z)) this.bunny.brain.pat();
  }

  /**
   * Bọt, Hỏa Long and Mầm as things to feed (Thú Cưng): their id and the top of the head, for
   * those shown and loaded, appended to `out` (objects reused).
   */
  petSpots(out: PetSpot[]): void {
    const c = this.crab;
    if (c && this.crabOn && c.model.root.visible) out.push(this.spot('bot', c.brain.x, c.brain.y + 0.55 * c.model.root.scale.y, c.brain.z));
    const d = this.dragon;
    if (d && this.dragonOn && d.model.root.visible) out.push(this.spot('hoalong', d.brain.x, d.brain.y + 0.7 * d.model.root.scale.y, d.brain.z));
    const b = this.bunny;
    if (b && this.bunnyOn && b.model.root.visible) {
      b.model.budTop(this.mouth);
      out.push(this.spot('mam', b.brain.x, this.mouth.y + 0.15, b.brain.z));
    }
  }

  private readonly spots = new Map<string, PetSpot>();

  private spot(id: string, x: number, y: number, z: number): PetSpot {
    let s = this.spots.get(id);
    if (!s) {
      s = { id, x, y, z };
      this.spots.set(id, s);
    }
    s.x = x;
    s.y = y;
    s.z = z;
    return s;
  }

  /** The model of an original (Level 2 changes its look), once loaded. */
  originalRoot(id: string): THREE.Object3D | null {
    if (id === 'bot') return this.crab?.model.root ?? null;
    if (id === 'hoalong') return this.dragon?.model.root ?? null;
    if (id === 'mam') return this.bunny?.model.root ?? null;
    return null;
  }

  /** Where an original stands and faces (its Level 2 skills start there); false if not out. */
  originalCaster(id: string, out: { x: number; y: number; z: number; yaw: number }): boolean {
    const b = id === 'bot' && this.crabOn ? this.crab?.brain : id === 'hoalong' && this.dragonOn ? this.dragon?.brain : id === 'mam' && this.bunnyOn ? this.bunny?.brain : undefined;
    if (!b) return false;
    out.x = b.x;
    out.y = b.y + 0.4;
    out.z = b.z;
    out.yaw = b.yaw;
    return true;
  }

  /** An original's own next skill (its key's), started if it can now. */
  originalNative(id: string): boolean {
    const r = id === 'bot' ? this.waterSkill() : id === 'hoalong' ? this.fireSkill() : id === 'mam' ? this.grassSkill() : 'off';
    return r !== 'off' && r !== 'busy';
  }

  /**
   * A model of a crab, dragon or bunny for a befriended wild one (Thú Cưng), with what its
   * walking about needs. Loaded fresh each time (its own materials, so it can be tinted).
   */
  async loadPetModel(kind: 'crab' | 'dragon' | 'bunny'): Promise<PetBody> {
    const shared = this.host.shared;
    if (kind === 'crab') {
      const { CrabModel } = await import('../world/creatures/crabModel');
      const m = await CrabModel.load(waterCrabUrl, shared);
      return { root: m.root, head: 0.45, hover: 0, speed: 1.3, animate: (dt, a, moving) => m.update(dt, a, moving) };
    }
    if (kind === 'dragon') {
      const { DragonModel } = await import('../world/creatures/dragonModel');
      const m = await DragonModel.load(fireDragonUrl, shared);
      return { root: m.root, head: 0.6, hover: 1.4, speed: 2.2, animate: (dt, a) => m.update(dt, a) };
    }
    const { BunnyModel } = await import('../world/creatures/bunnyModel');
    const m = await BunnyModel.load(grassBunnyUrl, shared);
    return { root: m.root, head: 0.8, hover: 0, speed: 1.6, animate: (dt, a, moving, wind) => m.update(dt, a, moving, a === 'greet' || a === 'dance' ? 0.8 : 0, wind) };
  }

  /** A happy reaction (fed): the same as a pat. */
  cheer(id: string): void {
    if (id === 'bot') this.crab?.brain.pat();
    if (id === 'hoalong') this.dragon?.brain.pat();
    if (id === 'mam') this.bunny?.brain.pat();
  }

  /** Wild ones watching you from the trees (they can be fed). */
  wildWatchers(out: WildTarget[]): void {
    this.wild.watchers(out);
  }

  /** Wild creatures peeking out in the rainforest, on or off; and whether they attack. */
  setWild(on: boolean, attacks: boolean): void {
    this.wild.setEnabled(on);
    this.wild.setAttacks(on && attacks);
  }

  /** Walking in the forest with the wild ones about. */
  get inWildForest(): boolean {
    return this.wild.inForest;
  }

  /** Mầm's grass skills (Z: each press the next); see waterSkill. */
  grassSkill(): BunnySkill | 'busy' | 'off' {
    if (!this.bunnyOn || !this.bunny) return 'off';
    return this.bunny.brain.command() ?? 'busy';
  }

  setViewport(heightPx: number, fovDeg: number): void {
    this.spores.setViewport(heightPx, fovDeg);
    this.fluff.setViewport(heightPx, fovDeg);
    this.jetSpray.setViewport(heightPx, fovDeg);
    this.bubbles.setViewport(heightPx, fovDeg);
    this.embers.setViewport(heightPx, fovDeg);
    this.steam.setViewport(heightPx, fovDeg);
  }

  update(dt: number): void {
    this.jetSpray.update(dt);
    this.bubbles.update(dt);
    this.embers.update(dt);
    this.steam.update(dt);
    this.spores.update(dt);
    this.fluff.update(dt);
    const walking = this.host.player(this.you);
    const you = walking ? this.you : null;
    const cam = this.host.camera.position;
    this.updateCrab(dt, you, cam);
    this.updateDragon(dt, you, cam);
    this.updateBunny(dt, you, cam);
    this.wild.update(dt, you);
  }

  private updateBunny(dt: number, you: CrabPlayer | null, cam: THREE.Vector3): void {
    const b = this.bunny;
    if (b) b.blooms.update(dt);
    if (!b || !b.model.root.visible) {
      this.bunnyPointer.cancel();
      this.bunnyPointer.hover = false;
      if (b) b.leaves.mesh.visible = false;
      return;
    }
    this.bunnyPointer.update();
    const g = b.brain;
    g.setHover(this.bunnyPointer.hover, cam.x, cam.z);
    g.update(dt, you, b.model.budTop(this.mouth));
    b.model.root.position.set(g.x, g.y, g.z);
    b.model.root.rotation.y = g.yaw;
    b.model.update(dt, g.action, g.speed, g.flare, this.host.shared.uWind.value);
    b.leaves.update(dt, this.mouth.x, this.mouth.y, this.mouth.z);
  }

  private updateCrab(dt: number, you: CrabPlayer | null, cam: THREE.Vector3): void {
    const c = this.crab;
    if (!c || !c.model.root.visible) {
      this.crabPointer.cancel();
      this.crabPointer.hover = false;
      if (c) c.stream.mesh.visible = c.big.mesh.visible = c.column.mesh.visible = false;
      return;
    }
    this.crabPointer.update();
    c.brain.setHover(this.crabPointer.hover, cam.x, cam.z);
    c.brain.update(dt, you, c.model.mouthPoint(this.mouth));
    c.model.root.position.set(c.brain.x, c.brain.y, c.brain.z);
    c.model.root.rotation.y = c.brain.yaw;
    c.model.update(dt, c.brain.action, c.brain.speed);
    c.stream.update(c.brain.stream);
    c.column.update(c.brain.column);
  }

  private updateDragon(dt: number, you: CrabPlayer | null, cam: THREE.Vector3): void {
    const d = this.dragon;
    if (!d || !d.model.root.visible) {
      this.dragonPointer.cancel();
      this.dragonPointer.hover = false;
      if (d) {
        d.stream.mesh.visible = false;
        d.tailFlame.mesh.visible = false;
        d.glow.mesh.visible = false;
      }
      return;
    }
    this.dragonPointer.update();
    const b = d.brain;
    b.setHover(this.dragonPointer.hover, cam.x, cam.z);
    b.update(dt, you, d.model.mouthPoint(this.mouth), d.model.facing(this.dir));
    d.model.root.position.set(b.x, b.y, b.z);
    d.model.root.rotation.y = b.yaw;
    d.model.setPitch(b.pitch);
    d.model.update(dt, b.action);
    d.stream.update(b.stream);
    // The tail's flame: bigger when excited, smaller in the rain.
    d.tailFlame.mesh.visible = true;
    d.model.tailPoint(this.tip);
    d.tailFlame.set(this.tip, (0.3 + 0.2 * b.flare) * (1 - 0.45 * this.host.rain()), 1);
    // Its light on the ground below: mostly at night, fading with height.
    const ground = Math.max(0, this.host.heightAt(b.x, b.z));
    const night = 1 - this.host.shared.uDayLight.value;
    const near = Math.max(0, 1 - (b.y - ground) / 5);
    d.glow.set(b.x, ground, b.z, 2 + 1.2 * b.flare, (0.12 + 0.5 * night + 0.35 * b.flare) * near);
  }

  /** At (x, y, z): how loud and where (activity sounds), or nothing. */
  private play(x: number, y: number, z: number, fn: (gain: number, pan: number) => void): void {
    const ear = this.host.ear(x, y, z);
    if (ear) fn(ear.gain, ear.pan);
  }

  /** Bọt: a .glb of 0.2 MB. */
  private loadCrab(): void {
    this.crabLoading = true;
    const h = this.host;
    Promise.all([
      import('../world/creatures/crabModel'),
      import('../world/creatures/bubbleCrab'),
      import('../world/creatures/jetStream'),
      import('../world/creatures/bigBubble'),
    ])
      .then(async ([{ CrabModel }, { BubbleCrab }, { JetStream }, { BigBubble }]) => {
        const model = await CrabModel.load(waterCrabUrl, h.shared);
        const stream = new JetStream(h.shared, 9.81);
        const big = new BigBubble(h.shared);
        // The geyser's column: a thick water stream shot straight up.
        const column = new JetStream(h.shared, 9.81);
        column.setRadius(0.32, 0.6);
        await this.compileHidden(model.root, [stream.mesh, big.mesh, column.mesh]);
        const brain: BubbleCrab = new BubbleCrab(
          {
            heightAt: h.heightAt,
            seaRadius: h.seaRadius,
            ripple: h.ripple,
            spray: this.jetSpray,
            bubbles: this.bubbles,
            rainbow: h.rainbow,
            daylight: () => h.shared.uDayLight.value,
            fx: h.fx,
            big,
          },
          h.homes.crab,
          {
            onSquirt: (duration) => this.play(brain.x, brain.y, brain.z, (g, p) => h.sound.squirt(duration, g, p)),
            onVoice: (kind) => this.play(brain.x, brain.y, brain.z, (g, p) => h.sound.crab(kind, g, p)),
            onHitPlayer: () => h.soak(),
            onSkill: (skill) => h.skillCard(skill, 'water', brain.x, brain.z),
          },
        );
        h.scene.add(model.root, stream.mesh, big.mesh, column.mesh);
        model.root.visible = this.crabOn;
        this.crab = { model, brain, stream, big, column };
      })
      .catch((err: unknown) => console.warn('crab load failed', err))
      .finally(() => {
        this.crabLoading = false;
      });
  }

  /** Hỏa Long: a .glb of 0.44 MB. */
  private loadDragon(): void {
    this.dragonLoading = true;
    const h = this.host;
    Promise.all([
      import('../world/creatures/dragonModel'),
      import('../world/creatures/fireDragon'),
      import('../world/creatures/jetStream'),
      import('../world/creatures/fireBreath'),
      import('../world/creatures/flames'),
    ])
      .then(async ([{ DragonModel }, { FireDragon }, { JetStream }, { FLAME_LIFT }, { FlameSprite, GroundGlow }]) => {
        const model = await DragonModel.load(fireDragonUrl, h.shared);
        const stream = new JetStream(h.shared, FLAME_LIFT, 'fire');
        const tailFlame = new FlameSprite(h.shared);
        const glow = new GroundGlow(h.shared);
        await this.compileHidden(model.root, [stream.mesh, tailFlame.mesh, glow.mesh]);
        const brain: FireDragon = new FireDragon(
          {
            heightAt: h.heightAt,
            seaRadius: h.seaRadius,
            ripple: h.ripple,
            embers: this.embers,
            steam: this.steam,
            fx: h.fx,
          },
          h.homes.dragon,
          {
            onBreath: (duration) => this.play(brain.x, brain.y, brain.z, (g, p) => h.sound.flame(duration, g, p)),
            onBoom: (x, y, z) => this.play(x, y, z, (g, p) => h.sound.flame(0.35, g, p)),
            onVoice: (kind) => this.play(brain.x, brain.y, brain.z, (g, p) => h.sound.dragon(kind, g, p)),
            onHitPlayer: () => {
              // Warm air off a wet you: a puff of steam, then dry.
              const y = this.you;
              for (let i = 0; i < 14; i++) {
                this.steam.emit(y.x + (Math.random() - 0.5) * 0.4, y.y + 0.4 + Math.random() * 1.2, y.z + (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.3, 0.4 + Math.random() * 0.5, (Math.random() - 0.5) * 0.3, 0.08 + Math.random() * 0.08);
              }
              h.dry();
            },
            onSkill: (skill) => h.skillCard(skill, 'fire', brain.x, brain.z),
          },
        );
        h.scene.add(model.root, stream.mesh, tailFlame.mesh, glow.mesh);
        model.root.visible = this.dragonOn;
        this.dragon = { model, brain, stream, tailFlame, glow };
      })
      .catch((err: unknown) => console.warn('dragon load failed', err))
      .finally(() => {
        this.dragonLoading = false;
      });
  }

  /** Mầm: a .glb of 0.4 MB, with its leaves and flowers. */
  private loadBunny(): void {
    this.bunnyLoading = true;
    const h = this.host;
    Promise.all([
      import('../world/creatures/bunnyModel'),
      import('../world/creatures/grassBunny'),
      import('../world/creatures/leafStorm'),
      import('../world/creatures/blooms'),
    ])
      .then(async ([{ BunnyModel }, { GrassBunny }, { LeafStorm }, { Blooms }]) => {
        const model = await BunnyModel.load(grassBunnyUrl, h.shared);
        // Each flower that opens gives a little puff of pollen.
        const blooms = new Blooms(h.shared.uTime, h.shared.uWind, h.heightAt, (x, y, z) => {
          for (let i = 0; i < 6; i++) {
            this.spores.emit(x, y, z, (Math.random() - 0.5) * 0.4, 0.15 + Math.random() * 0.35, (Math.random() - 0.5) * 0.4, 0.018 + Math.random() * 0.015);
          }
        });
        const wind = (): { strength: number; x: number; y: number } => {
          this.wind.strength = h.shared.uWind.value;
          this.wind.x = h.shared.uWindDir.value.x;
          this.wind.y = h.shared.uWindDir.value.y;
          return this.wind;
        };
        const leaves = new LeafStorm(
          h.heightAt,
          wind,
          (x, _y, z) => blooms.spawnCluster(x, z),
          () => {
            // The leaves swirl round you and leave a ring of flowers at your feet.
            const y = this.you;
            for (let i = 0; i < 8; i++) {
              const a = (i / 8) * Math.PI * 2 + Math.random() * 0.3;
              const r = 0.6 + Math.random() * 0.3;
              blooms.spawnCluster(y.x + Math.cos(a) * r, y.z + Math.sin(a) * r, 1 + Math.floor(Math.random() * 2));
            }
          },
          this.spores,
        );
        await this.compileHidden(model.root, [leaves.mesh, blooms.group]);
        const brain: GrassBunny = new GrassBunny(
          {
            heightAt: h.heightAt,
            house: h.house,
            leaves,
            spores: this.spores,
            fluff: this.fluff,
            fx: h.fx,
            bloom: (x, z, n) => blooms.spawnCluster(x, z, n),
            // The wind (uWind ~0..1.5) as a breeze of up to ~2 m/s.
            breeze: () => {
              const k = h.shared.uWind.value * 1.4;
              this.breeze.x = h.shared.uWindDir.value.x * k;
              this.breeze.z = h.shared.uWindDir.value.y * k;
              return this.breeze;
            },
          },
          h.homes.bunny,
          {
            onThrow: (duration) => this.play(brain.x, brain.y, brain.z, (g, p) => h.sound.leaves(duration, g, p)),
            onVoice: (kind) => this.play(brain.x, brain.y, brain.z, (g, p) => h.sound.bunny(kind, g, p)),
            onSkill: (skill) => h.skillCard(skill, 'grass', brain.x, brain.z),
          },
        );
        h.scene.add(model.root, leaves.mesh, blooms.group);
        model.root.visible = this.bunnyOn;
        this.bunny = { model, brain, leaves, blooms };
      })
      .catch((err: unknown) => console.warn('bunny load failed', err))
      .finally(() => {
        this.bunnyLoading = false;
      });
  }

  /**
   * Compiles `root` and effect objects that start hidden (compile skips hidden objects): shown
   * for the call, which gathers them at once, then hidden again until used.
   */
  private compileHidden(root: THREE.Object3D, extras: THREE.Object3D[]): Promise<unknown> {
    const group = new THREE.Group();
    group.add(root, ...extras);
    for (const m of extras) m.visible = true;
    const done = this.host.renderer.compileAsync(group, this.host.camera, this.host.scene);
    for (const m of extras) m.visible = false;
    for (const o of [root, ...extras]) group.remove(o);
    return done;
  }
}
