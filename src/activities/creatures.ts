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
import { WildCreatures } from './wildCreatures';
import type { TrunkInstance } from '../world/vegetation/forest';
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
  /** A skill you set off (a key or a click) started: show its name. */
  skillCard(skill: string, element: SkillElement): void;
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

  /** A blast (Mochi's bark) at (x, z): those within `r` m jump (a pat: a dance, or a skill back). */
  startle(x: number, z: number, r: number): void {
    const near = (bx: number, bz: number): boolean => Math.hypot(bx - x, bz - z) < r;
    if (this.crabOn && this.crab && near(this.crab.brain.x, this.crab.brain.z)) this.crab.brain.pat();
    if (this.dragonOn && this.dragon && near(this.dragon.brain.x, this.dragon.brain.z)) this.dragon.brain.pat();
    if (this.bunnyOn && this.bunny && near(this.bunny.brain.x, this.bunny.brain.z)) this.bunny.brain.pat();
  }

  /** Wild creatures peeking out in the rainforest, on or off. */
  setWild(on: boolean): void {
    this.wild.setEnabled(on);
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
            onSkill: (skill) => h.skillCard(skill, 'water'),
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
            onSkill: (skill) => h.skillCard(skill, 'fire'),
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
            onSkill: (skill) => h.skillCard(skill, 'grass'),
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
