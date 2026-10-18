import { button, el, section, slider, toggle, type SliderControl, type ToggleControl } from './components';
import { vi } from './strings.vi';
import type { Settings, SettingsStore } from '../core/settings';
import { sceneValuesOf, SCENE_KEYS, type ScenePresetStore } from '../core/scenePresets';

export interface SceneViewDeps {
  settings: SettingsStore;
  scenes: ScenePresetStore;
  /** Applies a preset (values, time of day, its recordings). */
  applyScene: (id: string) => void;
  /** A user preset was deleted (its recording mappings go too). */
  onDeleted: (id: string) => void;
  getHours: () => number;
}

/**
 * "Cảnh" section: scene presets (pick, save, update, delete) and the effect sliders. Moving a
 * slider keeps the preset active (its recordings keep playing); the list shows it as edited.
 */
export class SceneView {
  readonly root: HTMLElement;
  private readonly select: HTMLSelectElement;
  private readonly updateBtn: HTMLButtonElement;
  private readonly deleteBtn: HTMLButtonElement;
  private readonly resetBtn: HTMLButtonElement;
  private readonly saveForm: HTMLFormElement;
  private readonly saveInput: HTMLInputElement;
  private readonly withTime: ToggleControl;
  private readonly msg: HTMLElement;
  private readonly edited: HTMLElement;
  private readonly sliders: Array<[keyof Settings, SliderControl]> = [];
  private readonly rainbow: ToggleControl;

  constructor(private readonly deps: SceneViewDeps) {
    const { settings } = deps;
    const s = settings.get();
    const sec = section(vi.scene.title);
    this.root = sec.root;

    const row = el('label', 'preset-row');
    row.append(el('span', 'slider-label', vi.scene.preset));
    this.select = el('select', 'select');
    this.select.addEventListener('change', () => {
      if (this.select.value) deps.applyScene(this.select.value);
    });
    this.edited = el('span', 'hint', vi.scene.edited);
    row.append(this.select, this.edited);

    const actions = el('div', 'button-row');
    const saveAs = button(vi.scene.saveAs, () => this.showSaveForm(true), 'btn small');
    this.updateBtn = button(vi.scene.update, () => this.updatePreset(), 'btn small');
    this.updateBtn.title = vi.scene.updateTitle;
    this.deleteBtn = button(vi.scene.delete, () => this.deletePreset(), 'btn small');
    this.resetBtn = button(vi.scene.reset, () => this.resetPreset(), 'btn small');
    this.resetBtn.title = vi.scene.resetTitle;
    actions.append(saveAs, this.updateBtn, this.deleteBtn, this.resetBtn);

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

    const effects = el('div', 'subhead', vi.scene.effects);
    const add = (key: 'visualRain' | 'visualSnow' | 'visualWind' | 'waveStrength' | 'clouds' | 'gloom', label: string): void => {
      const c = slider(label, s[key], (v) => settings.update({ [key]: v }));
      this.sliders.push([key, c]);
    };
    add('visualRain', vi.scene.rain);
    add('visualSnow', vi.scene.snow);
    add('visualWind', vi.scene.wind);
    add('waveStrength', vi.scene.waves);
    add('clouds', vi.scene.clouds);
    add('gloom', vi.scene.gloom);
    this.rainbow = toggle(vi.scene.rainbow, s.rainbow, (on) => settings.update({ rainbow: on }));
    const toggles = el('div', 'button-row');
    toggles.append(this.rainbow.root);

    sec.body.append(row, actions, this.saveForm, this.msg, effects, ...this.sliders.map(([, c]) => c.root), toggles);

    deps.scenes.onChange(() => this.refresh());
    settings.onChange((next) => this.sync(next));
    this.refresh();
  }

  private refresh(): void {
    const sel = this.select;
    sel.replaceChildren();
    const none = el('option', '', vi.scene.none);
    none.value = '';
    sel.append(none);
    const all = this.deps.scenes.all();
    for (const [label, builtIn] of [[vi.scene.builtIn, true], [vi.scene.mine, false]] as const) {
      const items = all.filter((p) => p.builtIn === builtIn);
      if (items.length === 0) continue;
      const group = el('optgroup');
      group.label = label;
      for (const p of items) {
        const o = el('option', '', p.name);
        o.value = p.id;
        group.append(o);
      }
      sel.append(group);
    }
    this.sync(this.deps.settings.get());
  }

  private sync(s: Readonly<Settings>): void {
    const p = this.deps.scenes.get(s.activeScene);
    this.select.value = p ? p.id : '';
    const values = sceneValuesOf(s);
    const edited = !!p && SCENE_KEYS.some((k) => {
      const a = values[k];
      const b = p.values[k];
      return typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) > 0.005 : a !== b;
    });
    this.edited.hidden = !edited;
    this.updateBtn.disabled = !p || !edited;
    this.deleteBtn.disabled = !p || p.builtIn;
    // Built-ins can't be deleted, but edits to them can be undone.
    this.deleteBtn.hidden = !!p && p.builtIn;
    this.resetBtn.hidden = !p || !p.builtIn || !this.deps.scenes.isModified(p.id);
    for (const [key, c] of this.sliders) c.set(s[key] as number);
    this.rainbow.set(s.rainbow);
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
