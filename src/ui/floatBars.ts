import * as THREE from 'three';
import { el } from './components';
import { MAX_HP } from '../core/health';

/** Whose bar: its colours (styles: .float-bar.dog …). */
export type BarLook = 'dog' | 'crab' | 'dragon' | 'bunny';

/** Bars at once (Mochi and the wild ones it may be fighting). */
const BARS = 4;
/** Narrower far away, never smaller than this (px). */
const WIDTH = { near: 90, min: 46 } as const;

interface Bar {
  root: HTMLElement;
  fill: HTMLElement;
  look: BarLook | null;
  shown: boolean;
  hp: number;
}

const tmp = new THREE.Vector3();

/**
 * Health bars floating over heads, as in games (Mochi's and the wild ones' in a forest fight):
 * small glass pills placed each frame where a world point lands on the screen, scaled down with
 * distance, hidden behind the camera. DOM, a few elements: cheaper and sharper than drawing them
 * in the scene. Part of the UI layer (H hides them).
 */
export class FloatBars {
  private readonly bars: Bar[] = [];
  private used = 0;

  constructor(parent: HTMLElement) {
    for (let i = 0; i < BARS; i++) {
      const root = el('div', 'float-bar');
      const fill = el('span', 'float-fill');
      root.append(fill);
      parent.append(root);
      this.bars.push({ root, fill, look: null, shown: false, hp: -1 });
    }
  }

  /** Start of a frame's bars. */
  begin(): void {
    this.used = 0;
  }

  /** One bar this frame over (x, y, z), `hp` of 100. */
  add(camera: THREE.PerspectiveCamera, x: number, y: number, z: number, hp: number, look: BarLook): void {
    const b = this.bars[this.used];
    if (!b) return;
    tmp.set(x, y, z).project(camera);
    // Behind the camera, or off the screen.
    if (tmp.z > 1 || Math.abs(tmp.x) > 1.1 || Math.abs(tmp.y) > 1.1) return;
    this.used++;
    const d = camera.position.distanceTo(tmp.set(x, y, z));
    const w = Math.max(WIDTH.min, Math.min(WIDTH.near, (WIDTH.near * 6) / Math.max(1, d)));
    const sx = ((tmp.set(x, y, z).project(camera).x + 1) / 2) * window.innerWidth;
    const sy = ((1 - tmp.y) / 2) * window.innerHeight;
    b.root.style.transform = `translate(${(sx - w / 2).toFixed(1)}px, ${(sy - 6).toFixed(1)}px)`;
    b.root.style.width = `${w.toFixed(0)}px`;
    if (b.look !== look) {
      b.look = look;
      b.root.className = `float-bar ${look}`;
    }
    const v = Math.round(hp);
    if (v !== b.hp) {
      b.hp = v;
      b.fill.style.width = `${(100 * hp) / MAX_HP}%`;
      b.root.classList.toggle('low', hp < 30);
    }
    if (!b.shown) {
      b.shown = true;
      b.root.classList.add('on');
    }
  }

  /** End of the frame: the bars not used this frame go. */
  end(): void {
    for (let i = this.used; i < this.bars.length; i++) {
      const b = this.bars[i];
      if (!b.shown) continue;
      b.shown = false;
      b.root.classList.remove('on');
    }
  }
}
