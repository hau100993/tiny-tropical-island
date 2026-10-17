import type * as THREE from 'three';
import { el } from './components';
import { vi } from './strings.vi';
import type { Loop } from '../core/loop';

/**
 * Small stats panel (fps, CPU/GPU time, draw calls, triangles), toggled with the ` key.
 * The DOM is refreshed 4× per second, not every frame, to keep layout work negligible.
 */
export class DebugOverlay {
  private readonly root: HTMLDivElement;
  private readonly stats: HTMLDivElement;
  private frames = 0;
  private accum = 0;
  private cpuAccum = 0;

  constructor(parent: HTMLElement, visible: boolean) {
    this.root = el('div', 'debug-overlay');
    this.stats = el('div', 'debug-stats');
    this.root.append(el('div', 'debug-title', vi.debug.title), this.stats);
    parent.append(this.root);
    this.setVisible(visible);
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  /** Call once per rendered frame, after rendering. `gpuMs` is NaN when unsupported. */
  update(dt: number, info: THREE.WebGLInfo, loop: Loop, cpuMs: number, gpuMs: number): void {
    if (this.root.hidden) {
      this.frames = 0;
      this.accum = 0;
      this.cpuAccum = 0;
      return;
    }
    this.frames++;
    this.accum += dt;
    this.cpuAccum += cpuMs;
    if (this.accum < 0.25) return;
    const fps = this.frames / this.accum;
    const ms = (this.accum / this.frames) * 1000;
    const cpu = this.cpuAccum / this.frames;
    const gpu = Number.isNaN(gpuMs) ? '–' : `${gpuMs.toFixed(2)} ms`;
    const pause =
      loop.lastPauseSeconds > 0 ? `${loop.lastPauseSeconds.toFixed(1)} ${vi.debug.seconds}` : vi.debug.never;
    this.stats.innerHTML =
      `<span>${vi.debug.fps}</span><b>${fps.toFixed(0)}</b>` +
      `<span>${vi.debug.frameMs}</span><b>${ms.toFixed(1)} ms</b>` +
      `<span>${vi.debug.cpu}</span><b>${cpu.toFixed(2)} ms</b>` +
      `<span>${vi.debug.gpu}</span><b>${gpu}</b>` +
      `<span>${vi.debug.drawCalls}</span><b>${info.render.calls}</b>` +
      `<span>${vi.debug.triangles}</span><b>${(info.render.triangles / 1000).toFixed(0)}k</b>` +
      `<span>${vi.debug.lastPause}</span><b>${pause}</b>`;
    this.frames = 0;
    this.accum = 0;
    this.cpuAccum = 0;
  }
}
