import * as THREE from 'three';
import type { RidePose } from '../world/avatar';
import type { MantaModel } from '../world/creatures/mantaModel';
import type { WalkView } from '../controls/walker';
import type { SharedUniforms } from '../core/uniforms';
import { clamp, damp, smoothstep } from '../core/math';
import { DragLook } from '../controls/dragLook';
import { Pinch } from '../controls/pinch';
import type { CircleCollider } from '../controls/collision';
import { isTyping } from '../controls/keymap';
import { moveInput, readMove, touchInput } from '../controls/touchInput';
import { CLEARANCE, CRUISE, MantaFlight, angleTo, flightInput } from './flight/mantaFlight';
import type { Skyline } from './flight/skyline';
import { MANTA_WINGSPAN } from './flight/mantaSize';
import { MantaSummon } from './flight/mantaSummon';
import mantaUrl from '../assets/creatures/sky-manta.glb?url';

const LOOK_SPEED = 0.0022;
const PITCH = { first: [-1.3, 1.2], third: [-1.2, 0.9] } as const;
/** The view's resting pitch: looking this far down is level flight. */
const LEVEL_PITCH = -0.18;
/** Third person: camera distance behind the rider's head (a little more than the wingspan). */
const ARM = MANTA_WINGSPAN + 2;
/** Where the third-person camera looks: this far above the rider's feet (m), about the chest. */
const HEAD = 1.5;
/**
 * Through the eyes (V): the view from just over the tip of its head (m up, m ahead), so its head
 * isn't in the way and the whole island is in view; the wings at the edges.
 */
const EYE = { up: 0.55, ahead: 0.25 } as const;
/**
 * Standing on its back like on a surfboard (see Avatar.updateStandRide): the knees bend more
 * the faster it goes (`slow` … `fast`), more still gliding on the ice; leaning into the turns
 * by `lean` × its bank.
 */
const STANCE = { slow: 0.2, fast: 0.75, ice: 0.9, lean: 0.9 } as const;
/** Resting: its middle hovers this high over the ground or the sea (m), clear of both. */
const REST_Y = 1.15;
/**
 * Landing (Shift + Space): where it is if there's room (`clear` m round it free of anything
 * over a low bush; the sea or the shallows count), else the nearest such spot on rings up to
 * `reach` m away, ahead of it first; it glides there at up to `speed` m/s as it comes down.
 */
const LAND = { reach: [5, 9, 14, 20, 27, 35], clear: 3, speed: 9 } as const;
/**
 * Mouse wheel / pinch while riding (as walking): the camera arm from `min` to `max` m, × `step`
 * per notch; in past `min`: through the eyes, out from there: behind again.
 */
const ZOOM = { min: 3, max: 24, step: 1.18 } as const;
/** Wheel delta (px) of one notch, and a pinch's step in notches (as the walker's). */
const NOTCH_PX = 100;
const PINCH_STEP = 0.2;
/** Hovering by you it blocks the way: its body and each wing as circles (m: offset to the side, radius). */
const BLOCK = [
  [0, MANTA_WINGSPAN * 0.22],
  [-MANTA_WINGSPAN * 0.3, MANTA_WINGSPAN * 0.13],
  [MANTA_WINGSPAN * 0.3, MANTA_WINGSPAN * 0.13],
] as const;
/** Close enough (m) to climb on. */
const MOUNT_NEAR = MANTA_WINGSPAN * 0.5 + 2;
/** Where it lands when called: this far from you (m), tried in rings. */
const CALL_RINGS = [6.5, 9, 12, 16, 20, 25] as const;
/** No sea to come up from near you: it flies in from over the sea, this far out (m) and this high. */
const FIRST_FROM = { dist: 230, height: 55 } as const;
/**
 * Where it comes up out of the sea when called (see MantaSummon): `dist` m from you (nearest
 * first), toward where you look if it can; the sea at least `deep` m deep there and open water
 * (no land, deeper than `clear`) under the whole loop, `back` m behind to `ahead` m past it.
 */
const BREACH = { dist: [55, 70, 90, 110, 135], deep: 3, clear: -0.8, back: 14, ahead: 8 } as const;
/**
 * Its loop is turned this far (rad) off the line to where it lands, so from the beach you see
 * the loop's circle (head-on it would only go up and down); it curves in to you after.
 */
const LOOP_SIDE = 0.9;
/** Called from farther than this (m), it doesn't fly over: it dives and comes up near you. */
const FAR_CALL = 80;
/** Called from a point of the sea (clicked): it comes up there if that's within this far (m) of you. */
const FROM_REACH = 220;
/** Climbing on and off (s). */
const HOP_ON = 0.9;
const HOP_OFF = 0.75;
/**
 * Gliding on the ice road (Hơi Thở Băng Giá): its middle rides this high over the ice (wings
 * flat); it settles onto ice under it from up to `catch` m above, carried at `speed` m/s at
 * least (ice has no grip). Looking up while flying forward (or the up button) takes off, and
 * it won't settle again for `lift` s.
 */
const SKATE = { clear: 0.75, catch: 14, speed: 16, takeoff: 0.32, lift: 3 } as const;
/**
 * Shift + W + Q riding: Vũ Điệu Xoắn Ốc, three barrel rolls about its own axis in `time` s (eased in
 * and out), rising `hop` m at the middle, `boost` m/s faster (up to `top`). Only `clear` m or
 * more above what's below, flying at least `speed` m/s, not on the ice; again after `rest` s.
 */
const TRICK = { time: 2.4, turns: 3, hop: 2.2, boost: 5, top: 30, clear: 4, speed: 4, rest: 0.6 } as const;
/** Seconds without mouse movement before the view drifts back behind the manta. */
const RECENTER_AFTER = 1.2;
const KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);

/**
 * - away: not out yet (not loaded, or never called).
 * - rising: called, it comes up out of the sea and loops (MantaSummon), then arrives.
 * - arriving: gliding in along a curve to where it will land.
 * - resting: hovering a metre over the ground or the sea, wings rippling slowly.
 * - boarding / alighting: you hop on / off.
 * - riding: flown by you (or, outside the flying view, hovering where you left it).
 * - landing: coming down where it is before you hop off.
 */
export type MantaState = 'away' | 'rising' | 'arriving' | 'resting' | 'boarding' | 'riding' | 'landing' | 'alighting';

export interface MantaEvents {
  /** It came down beside you (a soft whoosh of wings). */
  onArrive(x: number, z: number): void;
  /** You hopped off at (x, z) facing `yaw`: put the walker there. */
  onAlight(x: number, z: number, yaw: number): void;
  /** Shift + Space over the forest or a roof: no room to land here. */
  onNoRoom(): void;
  /** Called, but nowhere near you is open enough for it to come down. */
  onNoCallRoom(): void;
  /** The wheel asks for the other view (in past the nearest: through the eyes; out: behind). */
  onView(view: WalkView): void;
}

export interface MantaWorld {
  skyline: Skyline;
  heightAt(x: number, z: number): number;
  seaHeight(x: number, z: number): number;
}

/** The ice road under the manta (see IceRoad.floorAt): its top, or −Infinity. */
export interface IceFloor {
  floorAt(x: number, z: number, now: number): number;
}

/** Where the walker stands (for the hop on). */
export interface Rider {
  x: number;
  z: number;
  feetY: number;
  yaw: number;
}

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Cá Đuối Trời (Phase 15): a manta ray that flies. Called with a whistle (it glides in and
 * hovers beside you), ridden on its back (MantaFlight, steered like the walker: W forward, the
 * mouse aims while moving, A/D turn, Space down; 1 – 4 its skills, see MantaSkills), landed where there's room. Loads its
 * model on the first call.
 */
export class MantaActivity {
  active = false;
  view: WalkView = 'third';
  /** View direction (absolute: the camera's yaw and pitch while riding). */
  viewYaw = 0;
  viewPitch = LEVEL_PITCH;
  /** Third person: camera distance (shorter near the ground). */
  arm = ARM;
  /** The arm the wheel chose (the camera eases to it, shorter when the ground is in the way). */
  private armWant = ARM;
  private pinchNotches = 0;
  /** Its body and wings as circles for the walker to bump into (see `blocking`). */
  readonly blockers: CircleCollider[] = BLOCK.map(([, r]) => ({ x: 0, z: 0, r }));
  readonly flight: MantaFlight;
  /** What the avatar needs to stand on its back holding the rein (world space), every frame. */
  readonly ride: RidePose = {
    back: new THREE.Matrix4(),
    rein: new THREE.Vector3(),
    crouch: STANCE.slow,
    lean: 0,
    lookYaw: 0,
    lookPitch: 0,
    firstPerson: false,
  };
  /** The ice road (set by MantaSkills): the flight's floor includes it. */
  ice: IceFloor | null = null;
  /** 0 flying … 1 gliding on the ice, eased. */
  skating = 0;
  /** The barrel rolls (Shift + W + Q): seconds in, or −1; their roll (rad) and lift (m), on the pose only. */
  private trickT = -1;
  private trickDir = 1;
  private trickRoll = 0;
  private trickLift = 0;
  private trickReady = 0;
  private liftT = 0;
  /** 0 slow … 1 fast (see STANCE), eased with the speed. */
  private pace = 0;
  private _state: MantaState = 'away';
  /** Its entrance out of the sea (read by MantaSkills for the churn and the splash). */
  readonly summon = new MantaSummon();
  private model: MantaModel | null = null;
  private loading = false;
  /** Called before the model arrived: where to come to once it has. */
  private pending: Rider | null = null;
  /** Where in the sea it was called from (clicked), to come up there; null: in front of you. */
  private callFrom: { x: number; z: number } | null = null;
  private readonly keys = new Set<string>();
  private readonly mv = moveInput();
  private readonly input = flightInput();
  readonly look: DragLook;
  private mouseIdle = 0;
  private time = 0;
  // ---- Arriving: a quadratic Bézier from where it is to where it lands ----
  private readonly p0 = new THREE.Vector3();
  private readonly p1 = new THREE.Vector3();
  private readonly p2 = new THREE.Vector3();
  private pathT = 0;
  private pathDur = 1;
  /** Where it faces once landed (you, more or less). */
  private landYaw = 0;
  // ---- Resting ----
  /** Where it is coming down (Shift + Space), or null: right where it is. */
  private landTo: { x: number; z: number } | null = null;
  private restX = 0;
  private restZ = 0;
  private restY = 0;
  // ---- Hops: from one seat pose to another ----
  private hopT = 0;
  private readonly hopFrom = new THREE.Matrix4();
  private readonly hopTo = new THREE.Matrix4();
  private alight = { x: 0, z: 0, yaw: 0 };
  /** Flapping for the model: 0 glide … 1 full beats, and the beat's speed. */
  private flap = 0.15;
  private rate = 0.5;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    dom: HTMLElement,
    private readonly scene: THREE.Scene,
    private readonly shared: SharedUniforms,
    private readonly world: MantaWorld,
    private readonly events: MantaEvents,
    private readonly reducedMotion: () => boolean,
  ) {
    this.flight = new MantaFlight({
      floor: (x, z) => Math.max(world.skyline.floor(x, z), this.iceAt(x, z)),
    });
    window.addEventListener('keydown', (e) => {
      if (!this.active || !KEYS.has(e.code) || e.ctrlKey || e.altKey || e.metaKey || isTyping(e.target)) return;
      this.keys.add(e.code);
      e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    this.look = new DragLook(
      dom,
      (dx, dy) => {
        this.mouseIdle = 0;
        this.viewYaw -= dx * LOOK_SPEED;
        const [lo, hi] = PITCH[this.view];
        this.viewPitch = clamp(this.viewPitch - dy * LOOK_SPEED, lo, hi);
      },
      LOOK_SPEED,
    );
    dom.addEventListener(
      'wheel',
      (e) => {
        if (!this.active) return;
        e.preventDefault();
        const px = e.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? e.deltaY : e.deltaY * NOTCH_PX;
        this.zoom(px / NOTCH_PX);
      },
      { passive: false },
    );
    // Two fingers: the arm in and out like the wheel (fingers apart: closer).
    new Pinch(
      dom,
      () => {
        if (!this.active) return;
        this.look.release();
        this.pinchNotches = 0;
      },
      (factor) => {
        if (!this.active) return;
        this.pinchNotches -= Math.log(factor) / Math.log(ZOOM.step);
        if (Math.abs(this.pinchNotches) < PINCH_STEP) return;
        this.zoom(this.pinchNotches);
        this.pinchNotches = 0;
      },
    );
  }

  /** `notches` of the wheel (> 0: out), as the walker's. */
  zoom(notches: number): void {
    if (notches === 0) return;
    if (this.view === 'first') {
      if (notches > 0) {
        this.armWant = ZOOM.min;
        this.events.onView('third');
      }
      return;
    }
    const next = this.armWant * Math.pow(ZOOM.step, notches);
    if (next < ZOOM.min * 0.92) {
      this.events.onView('first');
      return;
    }
    this.armWant = Math.min(ZOOM.max, Math.max(ZOOM.min, next));
  }

  /**
   * Hovering beside you (or you hopping on or off): it's solid, the walker goes round it.
   * `blockers` then hold its circles, placed this frame.
   */
  get blocking(): boolean {
    const s = this._state;
    if (s !== 'resting' && s !== 'boarding' && s !== 'alighting') return false;
    const f = this.flight;
    // Its side (right) is (cos, −sin) of its heading.
    const sx = Math.cos(f.yaw);
    const sz = -Math.sin(f.yaw);
    for (let i = 0; i < BLOCK.length; i++) {
      this.blockers[i].x = f.x + sx * BLOCK[i][0];
      this.blockers[i].z = f.z + sz * BLOCK[i][0];
    }
    return true;
  }

  /** The ice's top at (x, z), or −Infinity. */
  private iceAt(x: number, z: number): number {
    return this.ice ? this.ice.floorAt(x, z, this.shared.uTime.value) : -Infinity;
  }

  get state(): MantaState {
    return this._state;
  }

  /** On its back (or climbing on, or coming down to let you off). */
  get riding(): boolean {
    const s = this._state;
    return s === 'riding' || s === 'boarding' || s === 'landing' || s === 'alighting';
  }

  get x(): number {
    return this.flight.x;
  }

  get z(): number {
    return this.flight.z;
  }

  /**
   * Ridden and settled low over the ground or the sea, standing still: Space then hops off
   * (coming down the last metre or two first).
   */
  get settled(): boolean {
    const f = this.flight;
    // Not on the ice (you'd step off into the sea under it).
    if (this.skating > 0.1) return false;
    return this._state === 'riding' && Math.abs(f.speed) < 0.6 && f.y - (this.world.skyline.floor(f.x, f.z) + CLEARANCE) < 0.6;
  }

  /** Resting close enough to climb on from (x, z). */
  canMount(x: number, z: number): boolean {
    return this._state === 'resting' && Math.hypot(this.flight.x - x, this.flight.z - z) < MOUNT_NEAR;
  }

  /**
   * The whistle: it comes and hovers beside `rider` (on open ground, or on the water when you
   * swim). 'coming', or 'noRoom' when nowhere near is open, or 'busy' (you are on it). Left
   * riderless in the air (you went to a seat), it comes too.
   */
  call(rider: Readonly<Rider>, swimming: boolean, from: { x: number; z: number } | null = null): 'coming' | 'noRoom' | 'busy' {
    if (this.active) return 'busy';
    // Already on its way up out of the sea (a second whistle doesn't start it over).
    if (this._state === 'rising') return 'coming';
    this.callFrom = from && Math.hypot(from.x - rider.x, from.z - rider.z) < FROM_REACH ? { ...from } : null;
    if (!this.model) {
      this.pending = { ...rider };
      void this.load();
      // (Checked for room once it's here; it always finds water or sand somewhere.)
      return 'coming';
    }
    return this.comeTo(rider, swimming) ? 'coming' : 'noRoom';
  }

  private async load(): Promise<void> {
    if (this.loading || this.model) return;
    this.loading = true;
    try {
      const { MantaModel } = await import('../world/creatures/mantaModel');
      const model = await MantaModel.load(mantaUrl, this.shared);
      this.model = model;
      this.scene.add(model.root);
      model.root.visible = false;
      const r = this.pending;
      this.pending = null;
      if (r && !this.comeTo(r, this.world.heightAt(r.x, r.z) < -0.9)) this.events.onNoCallRoom();
    } catch (err) {
      // Missing or broken file: no manta (the rest of the island carries on).
      console.warn('manta: could not load', err);
    } finally {
      this.loading = false;
    }
  }

  /** Picks a landing spot near the rider and sets off toward it along a curve. */
  private comeTo(r: Readonly<Rider>, swimming: boolean): boolean {
    const spot = this.findSpot(r, swimming);
    if (!spot) return false;
    const f = this.flight;
    this.p2.set(spot.x, this.restHeight(spot.x, spot.z), spot.z);
    // Face across your view, a little toward you: the side of its back, ready to climb on.
    this.landYaw = Math.atan2(-(r.x - spot.x), -(r.z - spot.z)) + Math.PI / 2;
    if (this.model) this.model.root.visible = true;
    // Not out yet, or far off: up out of the sea in front of you.
    if (this._state === 'away' || this._state === 'rising' || Math.hypot(f.x - r.x, f.z - r.z) > FAR_CALL) {
      const from = this.callFrom;
      this.callFrom = null;
      const b = (from && this.breachNear(from.x, from.z, spot)) ?? this.findBreach(r, spot);
      if (b) {
        this.summon.start(b.x, b.z, b.yaw, this.world.seaHeight(b.x, b.z));
        this._state = 'rising';
        this.rise(0);
        return true;
      }
    }
    if (this._state === 'away' || this._state === 'rising') {
      // From far over the open sea, beyond the spot as seen from the island's middle.
      const d = Math.hypot(spot.x, spot.z) || 1;
      const out = FIRST_FROM.dist;
      this.p0.set((spot.x / d) * (d + out), FIRST_FROM.height, (spot.z / d) * (d + out));
      f.place(this.p0.x, this.p0.y, this.p0.z, 0);
    } else {
      this.p0.set(f.x, f.y, f.z);
    }
    // The approach: from the side with the lowest skyline, 25 m out, 12 m up.
    this.approach(this.p0, this.p2, this.p1);
    const len = this.p0.distanceTo(this.p1) + this.p1.distanceTo(this.p2);
    this.pathDur = Math.max(3.5, len / 15);
    this.pathT = 0;
    this._state = 'arriving';
    return true;
  }

  /**
   * Where to come up out of the sea, and its heading: on rings round you, ahead of you first;
   * deep enough there and open sea under the whole loop, turned LOOP_SIDE off the line to `spot`.
   */
  private findBreach(r: Readonly<Rider>, spot: { x: number; z: number }): { x: number; z: number; yaw: number } | null {
    for (const dist of BREACH.dist) {
      for (let k = 0; k < 16; k++) {
        const a = r.yaw + (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 8);
        const b = this.breachAt(r.x - Math.sin(a) * dist, r.z - Math.cos(a) * dist, spot);
        if (b) return b;
      }
    }
    return null;
  }

  /** Coming up at (x, z) (where you clicked the sea), or the nearest place round it deep and open enough. */
  private breachNear(x: number, z: number, spot: { x: number; z: number }): { x: number; z: number; yaw: number } | null {
    const here = this.breachAt(x, z, spot);
    if (here) return here;
    for (let d = 6; d <= 48; d += 6) {
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const b = this.breachAt(x + Math.cos(a) * d, z + Math.sin(a) * d, spot);
        if (b) return b;
      }
    }
    return null;
  }

  /** Coming up at (x, z): deep enough, and open sea under the loop on one side or the other. */
  private breachAt(x: number, z: number, spot: { x: number; z: number }): { x: number; z: number; yaw: number } | null {
    const h = this.world.heightAt;
    if (h(x, z) > -BREACH.deep) return null;
    const side = Math.random() < 0.5 ? 1 : -1;
    // Either side (a random one first).
    for (const sgn of [side, -side]) {
      const yaw = Math.atan2(-(spot.x - x), -(spot.z - z)) + sgn * LOOP_SIDE;
      const ux = -Math.sin(yaw);
      const uz = -Math.cos(yaw);
      let open = true;
      for (let s = -BREACH.back; s <= BREACH.ahead && open; s += 2) open = h(x + ux * s, z + uz * s) < BREACH.clear;
      if (open) return { x, z, yaw };
    }
    return null;
  }

  /** Up out of the sea and round the loop; then the glide in to where it lands. */
  private rise(dt: number): void {
    const f = this.flight;
    const m = this.summon;
    const y0 = f.y;
    m.update(dt);
    f.x = m.x;
    f.y = m.y;
    f.z = m.z;
    f.yaw = m.yaw;
    f.pitch = m.pitch;
    f.roll = m.roll;
    f.speed = m.speed;
    f.yawRate = 0;
    f.vy = dt > 0 ? (f.y - y0) / dt : 0;
    this.flap = m.flap;
    this.rate = m.rate;
    if (m.active) return;
    // Out of the loop low and level: glide on in, at the speed it has. The curve leaves along
    // its heading (no snap), then curves round and down to where it lands.
    this.p0.set(f.x, f.y, f.z);
    const d = Math.hypot(this.p2.x - f.x, this.p2.z - f.z);
    const lead = Math.max(2, d * 0.45);
    this.p1.set(f.x + m.fx * lead, Math.max(f.y, this.p2.y + 2), f.z + m.fz * lead);
    // The curve leaves at 4·|p1 − p0| / pathDur (ease-out): match its speed.
    this.pathDur = Math.max(2.5, (4 * this.p0.distanceTo(this.p1)) / Math.max(m.speed, 5));
    this.pathT = 0;
    this._state = 'arriving';
  }

  /** Room near the rider (or water when swimming) on rings around them, the nearest first. */
  private findSpot(r: Readonly<Rider>, swimming: boolean): { x: number; z: number } | null {
    const sky = this.world.skyline;
    for (const dist of CALL_RINGS) {
      // Start in front of you, a little to the side, then round the ring.
      for (let k = 0; k < 12; k++) {
        const a = r.yaw + 0.6 + (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 6);
        const x = r.x - Math.sin(a) * dist;
        const z = r.z - Math.cos(a) * dist;
        const h = this.world.heightAt(x, z);
        // Walking: dry land, wet sand or the shallows (you wade to it), with room for its wings.
        const ok = swimming ? h < -1.2 && sky.floor(x, z) < 0.5 : h > -0.9 && sky.clear(x, z, LAND.clear) && this.iceAt(x, z) === -Infinity;
        if (ok) return { x, z };
      }
    }
    return null;
  }

  /** The control point of the approach: 25 m out from `to`, 12 m up, where the skyline is lowest. */
  private approach(from: THREE.Vector3, to: THREE.Vector3, out: THREE.Vector3): void {
    const sky = this.world.skyline;
    const toward = Math.atan2(from.x - to.x, from.z - to.z);
    let best = Infinity;
    for (let k = 0; k < 8; k++) {
      // Directions round the spot, the one facing where it comes from first.
      const a = toward + (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 4);
      const sx = Math.sin(a);
      const sz = Math.cos(a);
      let worst = -Infinity;
      for (let d = 2; d <= 25; d += 2) {
        // The glide line's height there, against what stands below it.
        const lineY = to.y + (12 * d) / 25;
        worst = Math.max(worst, sky.floor(to.x + sx * d, to.z + sz * d) + CLEARANCE - lineY);
      }
      // Prefer the side it comes from (a short turn) unless another is clearly clearer.
      const score = Math.max(worst, -2) + k * 0.3;
      if (score < best) {
        best = score;
        out.set(to.x + sx * 25, to.y + 12 + Math.max(0, worst), to.z + sz * 25);
      }
    }
  }

  /** The highest thing at (x, z) it flies over: terrain, trees, the house (the sea: 0). */
  floorAt(x: number, z: number): number {
    return this.world.skyline.floor(x, z);
  }

  /** Ground or sea surface under (x, z). */
  private groundY(x: number, z: number): number {
    const h = this.world.heightAt(x, z);
    return h < 0 ? Math.max(h, this.world.seaHeight(x, z)) : h;
  }

  /** Where it hovers at rest over (x, z): over the ground or the sea, and over a low bush there too. */
  private restHeight(x: number, z: number): number {
    return Math.max(this.groundY(x, z), this.world.skyline.floor(x, z)) + REST_Y;
  }

  /** Space (or Shift + Space) next to it: climb on (the view switches to flying with this). */
  board(r: Readonly<Rider>): boolean {
    if (!this.model || !this.canMount(r.x, r.z)) return false;
    this._state = 'boarding';
    this.hopT = 0;
    this.hopFrom.compose(tmpV.set(r.x, r.feetY, r.z), tmpQ.setFromAxisAngle(UP, r.yaw), tmpS.set(1, 1, 1));
    this.viewYaw = this.flight.yaw;
    this.viewPitch = LEVEL_PITCH;
    return true;
  }

  /** Shift + Space riding: come down here and let you off; false (and a note) over trees or a roof. */
  land(): boolean {
    if (this._state !== 'riding') return false;
    const spot = this.findLanding();
    if (!spot) {
      this.events.onNoRoom();
      return false;
    }
    this.landTo = spot;
    this._state = 'landing';
    return true;
  }

  /** Room to come down at (x, z): the sea, or ground or shallows with nothing tall round it (not the ice). */
  private landable(x: number, z: number): boolean {
    if (this.iceAt(x, z) > -Infinity) return false;
    return this.world.heightAt(x, z) < -0.9 || this.world.skyline.clear(x, z, LAND.clear);
  }

  /** Right here if there's room, else the nearest spot that has, ahead first; null: none near. */
  private findLanding(): { x: number; z: number } | null {
    const f = this.flight;
    if (this.landable(f.x, f.z)) return { x: f.x, z: f.z };
    for (const d of LAND.reach) {
      for (let k = 0; k < 16; k++) {
        const a = f.yaw + (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 8);
        const x = f.x - Math.sin(a) * d;
        const z = f.z - Math.cos(a) * d;
        if (this.landable(x, z)) return { x, z };
      }
    }
    return null;
  }

  enter(): void {
    this.active = true;
    this.keys.clear();
    this.mouseIdle = 0;
    this.arm = this.armWant;
    this.camera.rotation.order = 'YXZ';
    this.look.start();
  }

  exit(): void {
    this.active = false;
    this.keys.clear();
    this.camera.rotation.order = 'XYZ';
    this.look.stop();
  }

  setView(view: WalkView): void {
    this.view = view;
    const [lo, hi] = PITCH[view];
    this.viewPitch = clamp(this.viewPitch, lo, hi);
  }

  /** Every frame, ridden or not. */
  update(dt: number): void {
    const model = this.model;
    if (!model || this._state === 'away') return;
    dt = Math.min(dt, 0.05);
    this.time += dt;
    const f = this.flight;
    if (this._state !== 'riding') this.skating = 0;
    switch (this._state) {
      case 'rising':
        this.rise(dt);
        break;
      case 'arriving':
        this.arrive(dt);
        break;
      case 'resting':
      case 'boarding':
      case 'alighting':
        this.rest(dt);
        break;
      case 'riding':
        if (this.active) this.steer(dt);
        else this.idleInput();
        this.flyOrGlide(dt);
        break;
      case 'landing':
        this.descend(dt);
        break;
    }
    this.updateTrick(dt);
    model.setPose(f.x, f.y + this.trickLift, f.z, f.yaw, f.pitch, f.roll + this.trickRoll);
    model.update(dt, this.flap, this.rate, f.yawRate, f.vy);
    model.backMatrix(this.ride.back);
    model.reinKnot(this.ride.rein);
    // Nobody on it: the rein is put away (the rider's hand sets it while riding: holdRein).
    if (!this.riding) model.setRein(null);
    this.hop(dt);
    const want = this._state === 'riding' ? clamp((Math.abs(f.speed) - 2) / (CRUISE - 2), 0, 1) : 0;
    this.pace += (want - this.pace) * damp(2.5, dt);
    this.updateRide();
    if (this.active) this.applyCamera(dt);
  }

  /** Flying fast: Shift and W (or ↑) held. */
  private get sprinting(): boolean {
    const k = this.keys;
    return (k.has('ShiftLeft') || k.has('ShiftRight')) && (k.has('KeyW') || k.has('ArrowUp'));
  }

  /** 0 … 1 through the barrel rolls, or −1 (MantaSkills' sparkles and whooshes follow it). */
  get trick(): number {
    return this.trickT < 0 ? -1 : Math.min(1, this.trickT / TRICK.time);
  }

  /**
   * Q while flying fast (Shift + W held): three barrel rolls. 'ok', or why not: 'low' (too near
   * the ground, the sea or the ice), 'slow' (not flying fast), 'busy' (rolling already, or not
   * flying it).
   */
  barrelRoll(): 'ok' | 'low' | 'slow' | 'busy' {
    if (this._state !== 'riding' || !this.active || this.trickT >= 0 || this.time < this.trickReady) return 'busy';
    const f = this.flight;
    if (!this.sprinting || f.speed < TRICK.speed) return 'slow';
    if (this.skating > 0.1 || f.y - this.world.skyline.floor(f.x, f.z) < TRICK.clear) return 'low';
    this.trickT = 0;
    // Rolling the way it's turning (right if level).
    this.trickDir = f.roll > 0.05 ? 1 : f.roll < -0.05 ? -1 : -1;
    f.speed = Math.max(f.speed, Math.min(TRICK.top, f.speed + TRICK.boost));
    return 'ok';
  }

  private updateTrick(dt: number): void {
    if (this.trickT < 0) return;
    if (this._state !== 'riding') this.trickT = TRICK.time;
    this.trickT += dt;
    const k = Math.min(1, this.trickT / TRICK.time);
    // Eased in and out (a sine ease): it winds up, whips round, and settles level.
    const e = 0.5 - 0.5 * Math.cos(Math.PI * k);
    this.trickRoll = this.trickDir * Math.PI * 2 * TRICK.turns * e;
    this.trickLift = Math.sin(Math.PI * k) * TRICK.hop;
    if (k >= 1) {
      this.trickT = -1;
      this.trickRoll = 0;
      this.trickLift = 0;
      this.trickReady = this.time + TRICK.rest;
    }
  }

  /**
   * Flying, or gliding on the ice road: over ice and low enough (not taking off), it eases down
   * onto it, level, and slides on without losing speed; off the ice the clearance eases back
   * up (no jump).
   */
  private flyOrGlide(dt: number): void {
    const f = this.flight;
    const c = this.input;
    const ice = this.iceAt(f.x, f.z);
    const takeoff = c.climb > 0 || (c.thrust > 0 && c.aimPitch > SKATE.takeoff);
    if (takeoff && this.skating > 0.5) this.liftT = SKATE.lift;
    this.liftT = Math.max(0, this.liftT - dt);
    const on = ice > -Infinity && f.y < ice + SKATE.catch && !takeoff && this.liftT === 0;
    this.skating += ((on ? 1 : 0) - this.skating) * damp(on ? 2.5 : 1.5, dt);
    if (this.skating < 0.01) this.skating = 0;
    f.clearance = CLEARANCE + (SKATE.clear - CLEARANCE) * this.skating;
    const before = f.speed;
    f.update(dt, c);
    if (this.skating > 0.01 && ice > -Infinity) {
      const target = ice + f.clearance;
      f.y += (target - f.y) * damp(3 * this.skating, dt);
      f.pitch *= 1 - this.skating * damp(6, dt);
      f.vy *= 1 - this.skating;
      // No grip on ice: coasting keeps its speed, and it's carried at least SKATE.speed.
      if (before > 0 && c.back === 0) {
        if (c.thrust === 0) f.speed = Math.max(f.speed, before - 0.3 * dt);
        if (f.speed < SKATE.speed) f.speed += (SKATE.speed - f.speed) * damp(1.5 * this.skating, dt);
      }
    }
    this.flapFromFlight();
    // Wings flat on the ice (a glide), so the tips don't dip into it.
    this.flap += (0.04 - this.flap) * this.skating;
  }

  /** Along the curve, easing out to a stop; the heading follows the curve, then turns to land. */
  private arrive(dt: number): void {
    const f = this.flight;
    this.pathT = Math.min(1, this.pathT + dt / this.pathDur);
    // Ease-out (fast in, slow to a stop): u = 1 − (1 − t)².
    const t = this.pathT;
    const u = 1 - (1 - t) * (1 - t);
    const a = 1 - u;
    const px = a * a * this.p0.x + 2 * a * u * this.p1.x + u * u * this.p2.x;
    const py = a * a * this.p0.y + 2 * a * u * this.p1.y + u * u * this.p2.y;
    const pz = a * a * this.p0.z + 2 * a * u * this.p1.z + u * u * this.p2.z;
    // Tangent (unscaled): heading and flight-path pitch.
    const tx = 2 * a * (this.p1.x - this.p0.x) + 2 * u * (this.p2.x - this.p1.x);
    const ty = 2 * a * (this.p1.y - this.p0.y) + 2 * u * (this.p2.y - this.p1.y);
    const tz = 2 * a * (this.p1.z - this.p0.z) + 2 * u * (this.p2.z - this.p1.z);
    const speed = Math.hypot(px - f.x, pz - f.z) / Math.max(dt, 1e-3);
    const lastYaw = f.yaw;
    const along = Math.atan2(-tx, -tz);
    // The last stretch: turned to its landing heading.
    const yaw = along + angleTo(along, this.landYaw) * smoothstep(0.75, 1, t);
    f.yaw = lastYaw + angleTo(lastYaw, yaw) * damp(5, dt);
    f.yawRate = angleTo(lastYaw, f.yaw) / Math.max(dt, 1e-3);
    f.pitch += (clamp(Math.atan2(ty, Math.hypot(tx, tz)), -0.5, 0.5) * (1 - t) - f.pitch) * damp(3, dt);
    f.roll += (clamp(Math.atan((Math.max(speed, 3) * -f.yawRate) / 9.81), -0.6, 0.6) - f.roll) * damp(3, dt);
    f.vy = (py - f.y) / Math.max(dt, 1e-3);
    // Never through a treetop on the way (the curve is checked only near the end).
    f.x = px;
    f.z = pz;
    f.y = t < 0.85 ? Math.max(py, this.world.skyline.floor(px, pz) + CLEARANCE) : py;
    f.speed = speed;
    // Beating in, gliding the middle, braking with big beats at the end.
    this.flap = t < 0.25 ? 0.7 : t < 0.8 ? 0.2 : 0.75;
    this.rate = t < 0.8 ? 1.1 : 1.5;
    if (t >= 1) {
      this.restX = this.p2.x;
      this.restZ = this.p2.z;
      this._state = 'resting';
      f.speed = 0;
      this.events.onArrive(f.x, f.z);
    }
  }

  /** Hovering at rest: a slow bob and sway, the wings rippling. */
  private rest(dt: number): void {
    const f = this.flight;
    this.restY = this.restHeight(this.restX, this.restZ);
    const bob = this.reducedMotion() ? 0 : 0.12 * Math.sin(this.time * 0.9);
    f.x += (this.restX - f.x) * damp(3, dt);
    f.z += (this.restZ - f.z) * damp(3, dt);
    f.y += (this.restY + bob - f.y) * damp(3, dt);
    f.speed = 0;
    f.vy = 0;
    f.yawRate = 0;
    f.pitch += (0 - f.pitch) * damp(3, dt);
    f.roll += (0.04 * Math.sin(this.time * 0.6) - f.roll) * damp(2, dt);
    this.flap = this._state === 'boarding' ? 0.3 : 0.18;
    this.rate = 0.6;
  }

  /** Coming down where it is: brakes, sinks to a hover over the ground or the sea, then lets you off. */
  private descend(dt: number): void {
    const f = this.flight;
    const c = this.input;
    c.thrust = 0;
    c.back = 0;
    c.sprint = false;
    c.brake = true;
    c.turn = 0;
    c.climb = 0;
    c.aimYaw = Number.NaN;
    c.aimPitch = Number.NaN;
    f.clearance = REST_Y;
    f.update(dt, c);
    // Gliding over to the spot it picked (if not right here), turning toward it.
    let far = 0;
    const to = this.landTo;
    if (to) {
      const dx = to.x - f.x;
      const dz = to.z - f.z;
      far = Math.hypot(dx, dz);
      if (far > 0.05) {
        const v = Math.min(LAND.speed, far * 1.5);
        const step = Math.min(far, v * dt);
        f.x += (dx / far) * step;
        f.z += (dz / far) * step;
        if (far > 2) {
          const yaw = f.yaw;
          f.yaw += angleTo(yaw, Math.atan2(-dx, -dz)) * damp(3, dt);
          f.yawRate = angleTo(yaw, f.yaw) / Math.max(dt, 1e-3);
        }
      }
    }
    // Down to its resting height, but over the treetops while it still has a way to go.
    const target = far > 3 ? Math.max(this.restHeight(f.x, f.z), this.world.skyline.floor(f.x, f.z) + CLEARANCE) : this.restHeight(f.x, f.z);
    const dy = target - f.y;
    // Down at up to 14 m/s, slowing near the end.
    f.y += clamp(dy * damp(1.8, dt), -14 * dt, 14 * dt);
    this.flap = 0.55;
    this.rate = 1.2;
    if (Math.abs(dy) < 0.25 && far < 0.3 && f.speed < 0.6) {
      // Drifted over something while braking: on to the nearest spot with room.
      if (!this.landable(f.x, f.z)) {
        const spot = this.findLanding();
        if (!spot) {
          this._state = 'riding';
          this.landTo = null;
          this.events.onNoRoom();
          return;
        }
        this.landTo = spot;
        return;
      }
      this.landTo = null;
      this.restX = f.x;
      this.restZ = f.z;
      this.startAlight();
    }
  }

  /** Off to its right side: on the ground beside it, or into the sea. */
  private startAlight(): void {
    const f = this.flight;
    const yaw = f.yaw;
    // Right of the manta (forward (−sin, −cos); right is (cos, −sin)), clear of the wing.
    const off = MANTA_WINGSPAN * 0.5 + 0.7;
    const x = f.x + Math.cos(yaw) * off;
    const z = f.z - Math.sin(yaw) * off;
    const y = this.groundY(x, z);
    this.alight = { x, z, yaw };
    this.hopFrom.copy(this.ride.back);
    this.hopTo.compose(tmpV.set(x, y, z), tmpQ.setFromAxisAngle(UP, yaw), tmpS.set(1, 1, 1));
    this.hopT = 0;
    this._state = 'alighting';
  }

  /** The rider's hop on or off: the seat pose travels from one place to the other along an arc. */
  private hop(dt: number): void {
    const s = this._state;
    if (s !== 'boarding' && s !== 'alighting') return;
    this.hopT = Math.min(1, this.hopT + dt / (s === 'boarding' ? HOP_ON : HOP_OFF));
    const k = smoothstep(0, 1, this.hopT);
    // Boarding lands on the seat as it is this frame (it bobs).
    const to = s === 'boarding' ? this.ride.back : this.hopTo;
    this.hopFrom.decompose(tmpV, tmpQ, tmpS);
    to.decompose(tmpV2, tmpQ2, tmpS);
    tmpV.lerp(tmpV2, k);
    tmpV.y += 0.8 * Math.sin(Math.PI * this.hopT);
    tmpQ.slerp(tmpQ2, k);
    this.ride.back.compose(tmpV, tmpQ, tmpS.set(1, 1, 1));
    if (this.hopT < 1) return;
    if (s === 'boarding') {
      this._state = 'riding';
      this.flight.speed = 0;
    } else {
      this._state = 'resting';
      this.events.onAlight(this.alight.x, this.alight.z, this.alight.yaw);
    }
  }

  /** Riderless in the air (you went to the overview or a seat): it holds its place. */
  private idleInput(): void {
    const c = this.input;
    c.thrust = 0;
    c.back = 0;
    c.sprint = false;
    c.brake = true;
    c.turn = 0;
    c.climb = 0;
    c.aimYaw = Number.NaN;
    c.aimPitch = Number.NaN;
  }

  /** Keys and the joystick → the flight's input; the view follows the turn. */
  private steer(dt: number): void {
    const k = this.keys;
    const m = readMove(k, this.mv);
    const c = this.input;
    // Space goes down (up: look up while flying forward); on touch, a button each way.
    const climb = (touchInput.jump ? 1 : 0) - (k.has('Space') || touchInput.down ? 1 : 0);
    const thrust = m.fwd > 0 ? m.fwd * Math.max(m.amount, 0.4) : 0;
    const back = m.fwd < 0 ? -m.fwd * Math.max(m.amount, 0.4) : 0;
    const moving = thrust > 0 || back > 0 || m.side !== 0 || climb !== 0;
    this.look.update(dt, moving);
    c.thrust = thrust;
    c.back = back;
    c.sprint = m.run && (thrust > 0 || back > 0);
    c.brake = false;
    c.climb = climb;
    const f = this.flight;
    if (thrust > 0) {
      // Flying forward: it goes where you look; A/D swing the view (and so the manta).
      this.viewYaw += -m.side * 1.1 * dt;
      c.turn = 0;
      c.aimYaw = this.viewYaw;
      c.aimPitch = this.viewPitch - LEVEL_PITCH;
    } else {
      c.turn = m.side;
      c.aimYaw = Number.NaN;
      c.aimPitch = Number.NaN;
      // Not looking around: the view settles back behind it.
      this.mouseIdle += dt;
      if (this.mouseIdle > RECENTER_AFTER) this.viewYaw += angleTo(this.viewYaw, f.yaw) * damp(1.5, dt);
    }
  }

  /** Beats from what the flight is doing: hard on a sprint or a climb, a glide when coasting. */
  private flapFromFlight(): void {
    const f = this.flight;
    const c = this.input;
    const slow = f.speed < 3;
    if (c.thrust > 0) {
      this.flap = c.sprint ? 1 : 0.8;
      this.rate = c.sprint ? 1.9 : 1.3;
    } else if (c.back > 0) {
      // Sculling backward: quick, shallow beats.
      this.flap = c.sprint ? 0.8 : 0.6;
      this.rate = c.sprint ? 1.7 : 1.3;
    } else if (c.climb > 0) {
      this.flap = 0.85;
      this.rate = 1.5;
    } else if (slow) {
      this.flap = 0.35;
      this.rate = 0.9;
    } else {
      this.flap = 0.12;
      this.rate = 0.7;
    }
    // Diving fast: wings back, a pure glide.
    if (f.pitch < -0.25 && c.thrust === 0) this.flap = 0.05;
  }

  /** The stance by the pace and the turn; the head looks where the view does. */
  private updateRide(): void {
    const p = this.ride;
    const k = this.pace;
    const crouch = STANCE.slow + (STANCE.fast - STANCE.slow) * k;
    p.crouch = crouch + (STANCE.ice - crouch) * this.skating;
    // Banked right (roll > 0) is a right turn: lean toward the toes (the pose's lean < 0).
    p.lean = this._state === 'riding' ? -this.flight.roll * STANCE.lean : 0;
    p.lookYaw = this.active ? clamp(angleTo(this.flight.yaw, this.viewYaw), -1, 1) : 0;
    p.lookPitch = this.active ? this.viewPitch - LEVEL_PITCH : 0;
    p.firstPerson = this.active && this.view === 'first';
  }

  /** Behind and above the rider's head (or through the eyes), banking a little with the manta. */
  private applyCamera(dt: number): void {
    const seat = this.ride.back;
    const roll = this.reducedMotion() ? 0 : this.flight.roll;
    if (this.view === 'first' && this.model) {
      // Ahead of the nose along its heading.
      this.model.nose(EYE.up, tmpV);
      tmpV.x -= Math.sin(this.flight.yaw) * EYE.ahead;
      tmpV.z -= Math.cos(this.flight.yaw) * EYE.ahead;
      this.camera.position.copy(tmpV);
      // Through its eyes the world turns round with the barrel rolls (not with reduced motion).
      const spin = this.reducedMotion() ? 0 : this.trickRoll;
      this.camera.rotation.set(this.viewPitch, this.viewYaw, -roll * 0.6 - spin, 'YXZ');
      return;
    }
    tmpV.setFromMatrixPosition(seat);
    tmpV.y += HEAD;
    const cp = Math.cos(this.viewPitch);
    const fx = -Math.sin(this.viewYaw) * cp;
    const fy = Math.sin(this.viewPitch);
    const fz = -Math.cos(this.viewYaw) * cp;
    // Shorter when looking up from close to the ground (the camera would go under it).
    this.arm += (this.armWant - this.arm) * damp(3, dt);
    let cx = tmpV.x - fx * this.arm;
    let cy = tmpV.y - fy * this.arm;
    let cz = tmpV.z - fz * this.arm;
    const floor = this.world.skyline.floor(cx, cz) + 0.8;
    if (cy < floor) {
      this.arm = Math.max(2.5, this.arm * 0.92);
      cx = tmpV.x - fx * this.arm;
      cy = Math.max(tmpV.y - fy * this.arm, floor);
      cz = tmpV.z - fz * this.arm;
    }
    this.camera.position.set(cx, cy, cz);
    this.camera.rotation.set(this.viewPitch, this.viewYaw, -roll * 0.3, 'YXZ');
  }

  /** The rider's front hand holds the rein at `hand` (world): the rope runs there from the knot. */
  holdRein(hand: THREE.Vector3): void {
    this.model?.setRein(hand);
  }

  /** A wing tip (0 left, 1 right) in the world; false before the model is here. */
  wingTip(i: number, out: THREE.Vector3): boolean {
    if (!this.model || this._state === 'away') return false;
    this.model.wingTip(i, out);
    return true;
  }

  /** The front of its head (where the laser leaves), world; false before the model is here. */
  nose(out: THREE.Vector3): boolean {
    if (!this.model || this._state === 'away') return false;
    this.model.nose(0, out);
    return true;
  }

  dispose(): void {
    this.model?.dispose();
    this.model = null;
  }
}
