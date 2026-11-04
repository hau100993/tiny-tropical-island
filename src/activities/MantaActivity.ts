import * as THREE from 'three';
import type { RidePose } from '../world/avatar';
import type { MantaModel } from '../world/creatures/mantaModel';
import type { WalkView } from '../controls/walker';
import type { SharedUniforms } from '../core/uniforms';
import { clamp, damp, smoothstep } from '../core/math';
import { DragLook } from '../controls/dragLook';
import { isTyping } from '../controls/keymap';
import { moveInput, readMove, touchInput } from '../controls/touchInput';
import { CLEARANCE, CRUISE, MantaFlight, angleTo, flightInput } from './flight/mantaFlight';
import type { Skyline } from './flight/skyline';
import mantaUrl from '../assets/creatures/sky-manta.glb?url';

const LOOK_SPEED = 0.0022;
const PITCH = { first: [-1.3, 1.2], third: [-1.2, 0.9] } as const;
/** The view's resting pitch: looking this far down is level flight. */
const LEVEL_PITCH = -0.18;
/** Third person: camera distance behind the rider's head (the manta is 7 m across). */
const ARM = 8.5;
/** Where the third-person camera looks: this far above the rider's chest (m). */
const HEAD = 0.9;
/** The rider's eyes in the back's frame (lying, the chest raised: ahead and a little up). */
const EYE = { y: 0.42, z: -0.62 } as const;
/**
 * Lying on its back (see Avatar.updateProneRide), by speed: slow, the chest up and the lower
 * legs lifted, swinging idly; fast, flat along it, legs nearly straight (streamlined).
 */
const SLOW = { chest: 0.38, knee: 1.0, swing: 0.3 } as const;
const FAST = { chest: 0.1, knee: 0.25, swing: 0.05 } as const;
/** Resting: its middle hovers this high over the ground or the sea (m), clear of both. */
const REST_Y = 1.15;
/** Close enough (m) to climb on. */
const MOUNT_NEAR = 5.5;
/** Where it lands when called: this far from you (m), tried in rings. */
const CALL_RINGS = [6.5, 9, 12, 16] as const;
/** The first call: it comes in from over the sea, this far out (m) and this high. */
const FIRST_FROM = { dist: 230, height: 55 } as const;
/** Climbing on and off (s). */
const HOP_ON = 0.9;
const HOP_OFF = 0.75;
/** Seconds without mouse movement before the view drifts back behind the manta. */
const RECENTER_AFTER = 1.2;
const KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);

/**
 * - away: not out yet (not loaded, or never called).
 * - arriving: gliding in along a curve to where it will land.
 * - resting: hovering a metre over the ground or the sea, wings rippling slowly.
 * - boarding / alighting: you hop on / off.
 * - riding: flown by you (or, outside the flying view, hovering where you left it).
 * - landing: coming down where it is before you hop off.
 */
export type MantaState = 'away' | 'arriving' | 'resting' | 'boarding' | 'riding' | 'landing' | 'alighting';

export interface MantaEvents {
  /** It came down beside you (a soft whoosh of wings). */
  onArrive(x: number, z: number): void;
  /** You hopped off at (x, z) facing `yaw`: put the walker there. */
  onAlight(x: number, z: number, yaw: number): void;
  /** "O" over the forest or a roof: no room to land here. */
  onNoRoom(): void;
  /** Called, but nowhere near you is open enough for it to come down. */
  onNoCallRoom(): void;
}

export interface MantaWorld {
  skyline: Skyline;
  heightAt(x: number, z: number): number;
  seaHeight(x: number, z: number): number;
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
 * mouse aims while moving, A/D turn, Space/Q up/down), landed where there's room. Loads its
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
  readonly flight: MantaFlight;
  /** What the avatar needs to lie on its back holding the harness (world space), every frame. */
  readonly ride: RidePose = {
    back: new THREE.Matrix4(),
    hands: [new THREE.Vector3(), new THREE.Vector3()],
    knees: [SLOW.knee, SLOW.knee],
    chest: SLOW.chest,
    lookYaw: 0,
    lookPitch: 0,
    firstPerson: false,
  };
  /** 0 slow … 1 fast (see SLOW, FAST), eased with the speed. */
  private pace = 0;
  private _state: MantaState = 'away';
  private model: MantaModel | null = null;
  private loading = false;
  /** Called before the model arrived: where to come to once it has. */
  private pending: Rider | null = null;
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
    this.flight = new MantaFlight(world.skyline);
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
  call(rider: Readonly<Rider>, swimming: boolean): 'coming' | 'noRoom' | 'busy' {
    if (this.active) return 'busy';
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
    if (this._state === 'away') {
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
    // Face across your view, a little toward you: the side of its back, ready to climb on.
    this.landYaw = Math.atan2(-(r.x - spot.x), -(r.z - spot.z)) + Math.PI / 2;
    this._state = 'arriving';
    if (this.model) this.model.root.visible = true;
    return true;
  }

  /** Open ground (or water when swimming) on rings around the rider, the nearest first. */
  private findSpot(r: Readonly<Rider>, swimming: boolean): { x: number; z: number } | null {
    const sky = this.world.skyline;
    for (const dist of CALL_RINGS) {
      // Start in front of you, a little to the side, then round the ring.
      for (let k = 0; k < 12; k++) {
        const a = r.yaw + 0.6 + (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 6);
        const x = r.x - Math.sin(a) * dist;
        const z = r.z - Math.cos(a) * dist;
        const h = this.world.heightAt(x, z);
        if (swimming ? h < -1.2 && sky.floor(x, z) < 0.5 : sky.open(x, z, 4)) return { x, z };
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

  /** Ground or sea surface under (x, z). */
  private groundY(x: number, z: number): number {
    const h = this.world.heightAt(x, z);
    return h < 0 ? Math.max(h, this.world.seaHeight(x, z)) : h;
  }

  /** Where it hovers at rest over (x, z): over the ground or the sea, and over a low bush there too. */
  private restHeight(x: number, z: number): number {
    return Math.max(this.groundY(x, z), this.world.skyline.floor(x, z)) + REST_Y;
  }

  /** "O" next to it: climb on (the view switches to flying with this). */
  board(r: Readonly<Rider>): boolean {
    if (!this.model || !this.canMount(r.x, r.z)) return false;
    this._state = 'boarding';
    this.hopT = 0;
    this.hopFrom.compose(tmpV.set(r.x, r.feetY + 0.9, r.z), tmpQ.setFromAxisAngle(UP, r.yaw), tmpS.set(1, 1, 1));
    this.viewYaw = this.flight.yaw;
    this.viewPitch = LEVEL_PITCH;
    return true;
  }

  /** "O" riding: come down here and let you off; false (and a note) over trees or a roof. */
  land(): boolean {
    if (this._state !== 'riding') return false;
    const f = this.flight;
    const water = this.world.heightAt(f.x, f.z) < -0.9;
    if (!water && !this.world.skyline.open(f.x, f.z, 3)) {
      this.events.onNoRoom();
      return false;
    }
    this._state = 'landing';
    return true;
  }

  enter(): void {
    this.active = true;
    this.keys.clear();
    this.mouseIdle = 0;
    this.arm = ARM;
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
    switch (this._state) {
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
        f.clearance = CLEARANCE;
        f.update(dt, this.input);
        this.flapFromFlight();
        break;
      case 'landing':
        this.descend(dt);
        break;
    }
    model.setPose(f.x, f.y, f.z, f.yaw, f.pitch, f.roll);
    model.update(dt, this.flap, this.rate, f.yawRate, f.vy);
    model.backMatrix(this.ride.back);
    model.gripPoint(0, this.ride.hands[0]);
    model.gripPoint(1, this.ride.hands[1]);
    this.hop(dt);
    const want = this._state === 'riding' ? clamp((Math.abs(f.speed) - 2) / (CRUISE - 2), 0, 1) : 0;
    this.pace += (want - this.pace) * damp(2.5, dt);
    this.updateRide();
    if (this.active) this.applyCamera(dt);
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
    const target = this.restHeight(f.x, f.z);
    const dy = target - f.y;
    // Down at up to 14 m/s, slowing near the end.
    f.y += clamp(dy * damp(1.8, dt), -14 * dt, 14 * dt);
    this.flap = 0.55;
    this.rate = 1.2;
    if (Math.abs(dy) < 0.25 && f.speed < 0.6) {
      const water = this.world.heightAt(f.x, f.z) < -0.9;
      // Drifted over something while braking: no room here after all.
      if (!water && !this.world.skyline.open(f.x, f.z, 3)) {
        this._state = 'riding';
        this.events.onNoRoom();
        return;
      }
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
    const x = f.x + Math.cos(yaw) * 4.2;
    const z = f.z - Math.sin(yaw) * 4.2;
    const y = this.groundY(x, z);
    this.alight = { x, z, yaw };
    this.hopFrom.copy(this.ride.back);
    this.hopTo.compose(tmpV.set(x, y + 0.9, z), tmpQ.setFromAxisAngle(UP, yaw), tmpS.set(1, 1, 1));
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

  /** Chest and legs by the pace (the feet swing idly, out of step); the head looks where the view does. */
  private updateRide(): void {
    const p = this.ride;
    const k = this.pace;
    p.chest = SLOW.chest + (FAST.chest - SLOW.chest) * k;
    const knee = SLOW.knee + (FAST.knee - SLOW.knee) * k;
    const swing = this.reducedMotion() ? 0 : SLOW.swing + (FAST.swing - SLOW.swing) * k;
    p.knees[0] = knee + swing * Math.sin(this.time * 1.3);
    p.knees[1] = knee + swing * Math.sin(this.time * 1.3 + 2.1);
    p.lookYaw = this.active ? clamp(angleTo(this.flight.yaw, this.viewYaw), -1, 1) : 0;
    p.lookPitch = this.active ? this.viewPitch - LEVEL_PITCH : 0;
    p.firstPerson = this.active && this.view === 'first';
  }

  /** Behind and above the rider's head (or through the eyes), banking a little with the manta. */
  private applyCamera(dt: number): void {
    const seat = this.ride.back;
    const roll = this.reducedMotion() ? 0 : this.flight.roll;
    if (this.view === 'first') {
      tmpV.set(0, EYE.y, EYE.z).applyMatrix4(seat);
      this.camera.position.copy(tmpV);
      this.camera.rotation.set(this.viewPitch, this.viewYaw, -roll * 0.6, 'YXZ');
      return;
    }
    tmpV.setFromMatrixPosition(seat);
    tmpV.y += HEAD;
    const cp = Math.cos(this.viewPitch);
    const fx = -Math.sin(this.viewYaw) * cp;
    const fy = Math.sin(this.viewPitch);
    const fz = -Math.cos(this.viewYaw) * cp;
    // Shorter when looking up from close to the ground (the camera would go under it).
    this.arm += (ARM - this.arm) * damp(3, dt);
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

  dispose(): void {
    this.model?.dispose();
    this.model = null;
  }
}
