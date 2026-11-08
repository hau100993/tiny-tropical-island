import * as THREE from 'three';
import type { SharedUniforms } from '../core/uniforms';
import { BubbleField } from './flight/bubbleField';
import { Exposure, LaserFire } from './flight/laserFire';
import type { MantaActivity } from './MantaActivity';
import { HuntBubbles } from '../world/creatures/huntBubbles';
import { LaserBeam } from '../world/creatures/laserBeam';
import { Crosshair } from '../ui/Crosshair';

/** Bubble slots made (the quality picks how many are used). */
const CAPACITY = 16;
/** Droplets in the burst pool. */
const DROPLETS = 640;
/** The laser's reach (m). */
const RANGE = 250;
/** Ground / sea search along the aim ray: step (m) and refinement halvings. */
const MARCH_STEP = 2;
const MARCH_REFINE = 5;
/** A held beam on the sea ripples it this often (s). */
const SEA_RIPPLE_EVERY = 0.1;

export interface HuntHooks {
  /** On the manta's back in the flying view. */
  flying(): boolean;
  /** The flight's floor (skyline + ice) for spawning. */
  floor(x: number, z: number): number;
  heightAt(x: number, z: number): number;
  seaHeight(x: number, z: number): number;
  ripple(x: number, z: number): void;
  reducedMotion(): boolean;
  /** A bubble burst at (x, y, z). */
  burst?(x: number, y: number, z: number): void;
  /** The laser fired: a flash (`beam` false) or the beam starting. */
  shot?(beam: boolean): void;
  /** The held beam's hum: on, and its heat 0 … 1 (called every flying frame). */
  hum?(on: boolean, heat: number): void;
}

const ndc = new THREE.Vector2();
const mouth = new THREE.Vector3();
const end = new THREE.Vector3();
const tmp = new THREE.Vector3();
const centre = new Float32Array(3);
const hitT = new Float32Array(1);

/**
 * Săn Bong Bóng: riding the manta, click to flash its frost laser, hold for a beam that heats up;
 * bubbles drift round you and burst where they are hit. Aims at the screen centre while the
 * mouse steers (the crosshair), at the cursor otherwise; touch fires from a button (centre).
 */
export class BubbleHunt {
  private readonly field = new BubbleField(CAPACITY);
  private readonly fire = new LaserFire();
  private readonly exposure = new Exposure(CAPACITY);
  private readonly bubbles: HuntBubbles;
  private readonly beam: LaserBeam;
  private readonly crosshair: Crosshair;
  private readonly ray = new THREE.Raycaster();
  /** The press now held: its pointer (−2 the touch button, −1 none) and whether it aims at the centre. */
  private pointer = -1;
  private aimCentre = true;
  private cursorX = 0;
  private cursorY = 0;
  private wasFlying = false;
  private wasBeam = false;
  private seaRippleAt = -Infinity;

  constructor(
    scene: THREE.Scene,
    private readonly shared: SharedUniforms,
    private readonly manta: MantaActivity,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly dom: HTMLCanvasElement,
    ui: HTMLElement,
    private readonly hooks: HuntHooks,
  ) {
    this.bubbles = new HuntBubbles(scene, shared, CAPACITY, DROPLETS);
    this.beam = new LaserBeam(scene, shared);
    this.crosshair = new Crosshair(ui);
    dom.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    window.addEventListener('blur', this.onBlur);
  }

  private get now(): number {
    return this.shared.uTime.value as number;
  }

  private readonly onDown = (e: PointerEvent): void => {
    // Fingers drag the view; they fire from the button (press / release).
    if (e.button !== 0 || e.pointerType === 'touch' || this.pointer !== -1 || !this.hooks.flying()) return;
    this.pointer = e.pointerId;
    this.aimCentre = this.manta.look.steering;
    this.cursorX = e.clientX;
    this.cursorY = e.clientY;
    this.fire.press(this.now);
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointer) return;
    this.cursorX = e.clientX;
    this.cursorY = e.clientY;
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (e.pointerId === this.pointer) this.letGo();
  };

  private readonly onBlur = (): void => {
    if (this.pointer !== -1) this.letGo();
  };

  private letGo(): void {
    this.pointer = -1;
    this.fire.release(this.now);
  }

  /** The touch button: fire aimed at the centre. */
  press(): void {
    if (this.pointer !== -1 || !this.hooks.flying()) return;
    this.pointer = -2;
    this.aimCentre = true;
    this.fire.press(this.now);
  }

  release(): void {
    if (this.pointer === -2) this.letGo();
  }

  setQuality(count: number): void {
    this.field.count = Math.min(CAPACITY, count);
  }

  setViewport(heightPx: number, fovDeg: number): void {
    this.bubbles.setViewport(heightPx, fovDeg);
    this.beam.setViewport(heightPx, fovDeg);
  }

  /** The shared clock went back to 0. */
  reset(): void {
    this.field.reset();
    this.fire.cancel();
    this.exposure.clearAll();
    this.pointer = -1;
  }

  update(dt: number): void {
    const now = this.now;
    if (!this.hooks.flying()) {
      if (this.wasFlying) {
        this.wasFlying = false;
        this.fire.cancel();
        this.pointer = -1;
        this.field.clear(now);
        this.exposure.clearAll();
        this.beam.hide();
        this.crosshair.set(false, false);
        this.hooks.hum?.(false, 0);
      }
      this.bubbles.sync(this.field, this.field.visible(now), now);
      return;
    }
    this.wasFlying = true;
    const f = this.manta.flight;
    this.field.update(now, f.x, f.y, f.z, f.yaw, this.hooks.floor);
    this.fire.update(now);

    const steering = this.manta.look.steering;
    const centred = this.pointer !== -1 ? this.aimCentre : steering;
    if (centred) ndc.set(0, 0);
    else {
      const r = this.dom.getBoundingClientRect();
      ndc.set(((this.cursorX - r.left) / r.width) * 2 - 1, -((this.cursorY - r.top) / r.height) * 2 + 1);
    }
    this.ray.setFromCamera(ndc, this.camera);
    const o = this.ray.ray.origin;
    const d = this.ray.ray.direction;
    const picked = this.field.pick(o.x, o.y, o.z, d.x, d.y, d.z, RANGE, now, hitT);
    this.crosshair.set(centred && (steering || this.pointer !== -1), picked >= 0);

    const mode = this.fire.mode;
    this.hooks.hum?.(mode === 'beam', this.fire.heat);
    if (mode === 'off') {
      this.wasBeam = false;
      this.beam.hide();
      this.bubbles.sync(this.field, true, now);
      return;
    }
    if (this.fire.flashFired) this.hooks.shot?.(false);
    if (mode === 'beam' && !this.wasBeam) this.hooks.shot?.(true);
    this.wasBeam = mode === 'beam';

    let struck = picked >= 0;
    let sea = false;
    if (struck) end.copy(d).multiplyScalar(hitT[0]).add(o);
    else {
      const t = this.march(o, d);
      if (t >= 0) {
        end.copy(d).multiplyScalar(t).add(o);
        struck = true;
        sea = this.hooks.seaHeight(end.x, end.z) >= this.hooks.heightAt(end.x, end.z);
      } else end.copy(d).multiplyScalar(RANGE).add(o);
    }
    if (picked >= 0 && (this.fire.flashFired || (mode === 'beam' && this.exposure.add(picked, dt)))) this.burst(picked, now);
    if (sea && (this.fire.flashFired || (mode === 'beam' && now - this.seaRippleAt >= SEA_RIPPLE_EVERY))) {
      this.seaRippleAt = now;
      this.hooks.ripple(end.x, end.z);
    }
    if (!this.manta.nose(mouth)) mouth.copy(this.camera.position);
    this.beam.set(mouth, end, this.fire.strength, this.fire.heat, struck, !this.hooks.reducedMotion());
    this.bubbles.sync(this.field, true, now);
  }

  private burst(i: number, now: number): void {
    this.field.posAt(i, now, centre);
    tmp.set(end.x - centre[0], end.y - centre[1], end.z - centre[2]);
    if (tmp.lengthSq() < 1e-6) tmp.set(0, 1, 0);
    tmp.normalize();
    this.field.burst(i, now, tmp.x, tmp.y, tmp.z);
    this.bubbles.splash(centre[0], centre[1], centre[2], this.field.slots[i].radius, tmp.x, tmp.y, tmp.z, now);
    this.exposure.reset(i);
    this.hooks.burst?.(centre[0], centre[1], centre[2]);
  }

  /** Where the aim ray meets the ground or the sea within RANGE, or −1 (only while firing). */
  private march(o: THREE.Vector3, d: THREE.Vector3): number {
    let prev = 0;
    for (let t = MARCH_STEP; t <= RANGE; t += MARCH_STEP) {
      if (!this.below(o, d, t)) {
        prev = t;
        continue;
      }
      let lo = prev;
      let hi = t;
      for (let k = 0; k < MARCH_REFINE; k++) {
        const mid = (lo + hi) / 2;
        if (this.below(o, d, mid)) hi = mid;
        else lo = mid;
      }
      return hi;
    }
    return -1;
  }

  /** The point t along the ray is under the ground or the sea. */
  private below(o: THREE.Vector3, d: THREE.Vector3, t: number): boolean {
    const x = o.x + d.x * t;
    const z = o.z + d.z * t;
    return o.y + d.y * t <= Math.max(this.hooks.heightAt(x, z), this.hooks.seaHeight(x, z));
  }

  dispose(): void {
    this.dom.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    window.removeEventListener('blur', this.onBlur);
    this.bubbles.dispose();
    this.beam.dispose();
  }
}
