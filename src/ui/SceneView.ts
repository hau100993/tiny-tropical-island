import { button, el, slider, toggle, type SliderControl, type ToggleControl } from './components';
import { icons } from './icons';
import { vi } from './strings.vi';
import type { Settings, SettingsStore } from '../core/settings';
import { sceneValuesOf, SCENE_KEYS, type ScenePreset, type ScenePresetStore } from '../core/scenePresets';

export interface SceneViewDeps {
  settings: SettingsStore;
  scenes: ScenePresetStore;
  /** Applies a preset (values, time of day, its recordings). */
  applyScene: (id: string) => void;
  /** A user preset was deleted (its recording mappings go too). */
  onDeleted: (id: string) => void;
  getHours: () => number;
}

/** Icon per built-in preset; the user's own presets get a bookmark. */
const PRESET_ICONS: Readonly<Record<string, string>> = {
  'b-sunny': icons.sun,
  'b-sunset': icons.sunset,
  'b-storm': icons.storm,
  'b-jungle-rain': icons.rain,
  'b-campfire': icons.flame,
  'b-misty': icons.fog,
  'b-aurora': icons.aurora,
};

type EffectKey = 'visualRain' | 'visualSnow' | 'visualWind' | 'waveStrength' | 'clouds' | 'gloom' | 'meteors' | 'aurora';
type FlagKey = 'rainbow' | 'stars' | 'fireflies';

/**
 * "Cảnh" section body: scene presets as a grid of cards (icon + name; the active one is
 * highlighted, a dot marks it as edited), the preset actions, and the effect controls folded
 * into "Tùy chỉnh hiệu ứng" (weather, night sky). Moving a slider keeps the preset active (its
 * recordings keep playing) and marks it as edited.
 */
export class SceneView {
  readonly root: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly cards = new Map<string, HTMLButtonElement>();
  private readonly updateBtn: HTMLButtonElement;
  private readonly deleteBtn: HTMLButtonElement;
  private readonly resetBtn: HTMLButtonElement;
  private readonly saveForm: HTMLFormElement;
  private readonly saveInput: HTMLInputElement;
  private readonly withTime: ToggleControl;
  private readonly msg: HTMLElement;
  private readonly sliders: Array<[EffectKey, SliderControl]> = [];
  private readonly flags: Array<[FlagKey, ToggleControl]> = [];

  constructor(private readonly deps: SceneViewDeps) {
    const { settings } = deps;
    const s = settings.get();
    this.root = el('div', 'scene-view');
    this.grid = el('div', 'preset-grid');
    this.grid.setAttribute('role', 'radiogroup');
    this.grid.setAttribute('aria-label', vi.scene.preset);

    const actions = el('div', 'button-row');
    const saveAs = button(vi.scene.saveAs, () => this.showSaveForm(true), 'btn small');
    this.updateBtn = button(vi.scene.update, () => this.updatePreset(), 'btn small');
    this.updateBtn.title = vi.scene.updateTitle;
    this.deleteBtn = button(vi.scene.delete, () => this.deletePreset(), 'btn small');
    this.resetBtn = button(vi.scene.reset, () => this.resetPreset(), 'btn small');
    this.resetBtn.title = vi.scene.resetTitle;
    actions.append(saveAs, this.updateBtn, this.resetBtn, this.deleteBtn);

    this.saveForm = el('form', 'save-form wrap');
    this.saveForm.hidden = true;
    this.saveInput = el('input', 'text-input');
    this.saveInput.placeholder = vi.scene.name;
    this.saveInput.maxLength = 32;
    this.withTime = toggle(vi.scene.withTime, false, (on) => this.withTime.set(on));
    const ok = el('button', 'btn small primary', vi.scene.save);
    ok.type = 'submit';
    const cancel = button(vi.scene.cancel, () => this.showSaveForm(false), 'btn small');
    this.saveForm.append(this.saveInput, this.withTime.root, ok, cancel);
    this.saveForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.savePreset();
    });
    this.msg = el('div', 'note');

    // Effects, folded: weather, then the night sky.
    const custom = el('details', 'subsection');
    const summary = el('summary', 'subsection-title', vi.panel.customize);
    const body = el('div', 'section-body');
    const add = (key: EffectKey, label: string): HTMLElement => {
      const c = slider(label, s[key], (v) => settings.update({ [key]: v }));
      this.sliders.push([key, c]);
      return c.root;
    };
    const flag = (key: FlagKey, label: string): HTMLElement => {
      const t = toggle(label, s[key], (on) => settings.update({ [key]: on }));
      this.flags.push([key, t]);
      return t.root;
    };
    const weatherFlags = el('div', 'button-row');
    weatherFlags.append(flag('rainbow', vi.scene.rainbow));
    const nightFlags = el('div', 'button-row');
    nightFlags.append(flag('stars', vi.panel.stars), flag('fireflies', vi.panel.fireflies));
    body.append(
      el('div', 'subhead', vi.panel.weather),
      add('visualRain', vi.scene.rain),
      add('visualSnow', vi.scene.snow),
      add('visualWind', vi.scene.wind),
      add('waveStrength', vi.scene.waves),
      add('clouds', vi.scene.clouds),
      add('gloom', vi.scene.gloom),
      weatherFlags,
      el('div', 'subhead', vi.panel.nightSky),
      add('meteors', vi.panel.meteors),
      add('aurora', vi.panel.aurora),
      nightFlags,
    );
    custom.append(summary, body);

    this.root.append(this.grid, actions, this.saveForm, this.msg, custom);
    deps.scenes.onChange(() => this.refresh());
    settings.onChange((next) => this.sync(next));
    this.refresh();
  }

  /** Rebuilds the cards (presets were added, renamed or removed). */
  private refresh(): void {
    this.grid.replaceChildren();
    this.cards.clear();
    for (const p of this.deps.scenes.all()) this.grid.append(this.card(p));
    this.sync(this.deps.settings.get());
  }

  private card(p: ScenePreset): HTMLButtonElement {
    const b = button('', () => this.deps.applyScene(p.id), 'preset-card');
    b.setAttribute('role', 'radio');
    const icon = el('span', 'preset-icon');
    icon.innerHTML = PRESET_ICONS[p.id] ?? icons.bookmark;
    const name = el('span', 'preset-name', p.name);
    const dot = el('span', 'preset-dot');
    dot.title = vi.scene.edited;
    b.append(icon, name, dot);
    b.title = p.name;
    this.cards.set(p.id, b);
    return b;
  }

  private sync(s: Readonly<Settings>): void {
    const p = this.deps.scenes.get(s.activeScene);
    const values = sceneValuesOf(s);
    const edited = !!p && SCENE_KEYS.some((k) => {
      const a = values[k];
      const b = p.values[k];
      return typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) > 0.005 : a !== b;
    });
    for (const [id, c] of this.cards) {
      const on = id === s.activeScene;
      c.setAttribute('aria-checked', String(on));
      c.classList.toggle('edited', on && edited);
    }
    this.updateBtn.disabled = !p || !edited;
    // Built-ins can't be deleted, but edits to them can be undone.
    this.deleteBtn.hidden = !p || p.builtIn;
    this.resetBtn.hidden = !p || !p.builtIn || !this.deps.scenes.isModified(p.id);
    for (const [key, c] of this.sliders) c.set(s[key]);
    for (const [key, t] of this.flags) t.set(s[key]);
  }

  private showSaveForm(show: boolean): void {
    this.saveForm.hidden = !show;
    this.msg.textContent = '';
    if (show) {
      this.saveInput.value = '';
      this.withTime.set(false);
      this.saveInput.focus();
    }
  }

  private savePreset(): void {
    const { scenes, settings } = this.deps;
    const hours = this.withTime.root.getAttribute('aria-pressed') === 'true' ? this.deps.getHours() : null;
    const saved = scenes.save(this.saveInput.value, sceneValuesOf(settings.get()), hours);
    if (!saved) {
      this.msg.textContent = vi.scene.saveFailed;
      return;
    }
    this.saveForm.hidden = true;
    this.deps.applyScene(saved.id);
    this.msg.textContent = vi.scene.saved;
  }

  private updatePreset(): void {
    const { scenes, settings } = this.deps;
    if (scenes.update(settings.get().activeScene, sceneValuesOf(settings.get()))) this.msg.textContent = vi.scene.saved;
  }

  private resetPreset(): void {
    const { scenes, settings } = this.deps;
    const p = scenes.get(settings.get().activeScene);
    if (!p || !p.builtIn || !window.confirm(vi.scene.confirmReset(p.name))) return;
    scenes.resetBuiltIn(p.id);
    this.deps.applyScene(p.id);
  }

  private deletePreset(): void {
    const { scenes, settings } = this.deps;
    const p = scenes.get(settings.get().activeScene);
    if (!p || p.builtIn || !window.confirm(vi.scene.confirmDelete(p.name))) return;
    scenes.remove(p.id);
    this.deps.onDeleted(p.id);
    settings.update({ activeScene: '' });
  }
}
