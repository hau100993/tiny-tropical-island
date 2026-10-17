import type * as THREE from 'three';
import { vi } from './strings.vi';
import { QUALITY_LEVELS, type QualityLevel } from '../core/quality';
import type { Settings, SettingsPatch } from '../core/settings';
import type { Loop } from '../core/loop';

/**
 * Small stats panel (fps, frame time, draw calls, triangles) with quality controls.
 * The DOM is refreshed 4× per second, not every frame, to keep layout work negligible.
 */
export class DebugOverlay {
  private readonly root: HTMLDivElement;
  private readonly stats: HTMLDivElement;
  private readonly qualityButtons = new Map<QualityLevel, HTMLButtonElement>();
  private readonly lowPowerBtn: HTMLButtonElement;
  private readonly autoRotateBtn: HTMLButtonElement;
  private readonly note: HTMLDivElement;
  private frames = 0;
  private accum = 0;
  private cpuAccum = 0;
  private readonly startQuality: QualityLevel;
  private current: Readonly<Settings>;

  constructor(
    parent: HTMLElement,
    settings: Readonly<Settings>,
    private readonly onChange: (patch: SettingsPatch) => void,
  ) {
    this.startQuality = settings.quality;
    this.root = el('div', 'debug-overlay');
    const title = el('div', 'debug-title');
    title.textContent = vi.debug.title;
    this.stats = el('div', 'debug-stats');

    const qualityRow = el('div', 'debug-row');
    const qLabel = el('span', 'debug-label');
    qLabel.textContent = vi.debug.quality;
    qualityRow.append(qLabel);
    for (const level of QUALITY_LEVELS) {
      const b = button(vi.debug.qualityNames[level], () => this.onChange({ quality: level }));
      this.qualityButtons.set(level, b);
      qualityRow.append(b);
    }

    const toggles = el('div', 'debug-row');
    this.lowPowerBtn = button('', () => this.onChange({ lowPower: !this.current.lowPower }));
    this.autoRotateBtn = button('', () => this.onChange({ autoRotate: !this.current.autoRotate }));
    toggles.append(this.lowPowerBtn, this.autoRotateBtn);

    this.note = el('div', 'debug-note');
    const hint = el('div', 'debug-hint');
    hint.textContent = vi.debug.hint;

    this.root.append(title, this.stats, qualityRow, toggles, this.note, hint);
    parent.append(this.root);
    this.current = settings;
    this.sync(settings);
  }

  sync(settings: Readonly<Settings>): void {
    this.current = settings;
    this.root.hidden = !settings.showDebug;
    for (const [level, b] of this.qualityButtons) b.classList.toggle('active', level === settings.quality);
    this.lowPowerBtn.textContent = `${vi.debug.lowPower}: ${settings.lowPower ? vi.debug.on : vi.debug.off}`;
    this.lowPowerBtn.classList.toggle('active', settings.lowPower);
    this.autoRotateBtn.textContent = `${vi.debug.autoRotate}: ${settings.autoRotate ? vi.debug.on : vi.debug.off}`;
    this.autoRotateBtn.classList.toggle('active', settings.autoRotate);
    const msaaChanged = (settings.quality === 'low') !== (this.startQuality === 'low');
    this.note.textContent = msaaChanged ? vi.debug.msaaReload : '';
  }

  /** Call once per rendered frame, after `renderer.render`. `gpuMs` is NaN when unsupported. */
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

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  return e;
}

function button(text: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', 'debug-btn');
  b.type = 'button';
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}
