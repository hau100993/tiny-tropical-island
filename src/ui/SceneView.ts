import { button, el } from './components';
import { icons } from './icons';
import { vi } from './strings.vi';
import { SceneEditor } from './SceneEditor';
import type { Settings, SettingsStore } from '../core/settings';
import type { ScenePreset, ScenePresetStore } from '../core/scenePresets';
import type { SoundLibrary } from '../audio/library/SoundLibrary';
import { formatClock } from '../world/celestial';

export interface SceneViewDeps {
  settings: SettingsStore;
  scenes: ScenePresetStore;
  library: SoundLibrary;
  /** Applies a scene (values, time of day, its recordings). */
  applyScene: (id: string) => void;
  /** A user scene was deleted (its recording mappings go too). */
  onDeleted: (id: string) => void;
  startAudio: () => void;
  getHours: () => number;
  getSkyTurn: () => number;
  setSky: (hours: number, skyTurn: number) => void;
  windowTurn: (hours: number) => number;
}

/** Icon per built-in scene; the user's own get one from their weather and time. */
const PRESET_ICONS: Readonly<Record<string, string>> = {
  'b-dawn': icons.sunrise,
  'b-sunny': icons.sun,
  'b-sunset': icons.sunset,
  'b-storm': icons.storm,
  'b-jungle-rain': icons.rain,
  'b-campfire': icons.flame,
  'b-full-moon': icons.moon,
  'b-misty': icons.fog,
  'b-aurora': icons.aurora,
};

function sceneIcon(p: ScenePreset): string {
  const fixed = PRESET_ICONS[p.id];
  if (fixed) return fixed;
  const v = p.values;
  if (v.visualRain > 0.6 && v.visualWind > 0.5) return icons.storm;
  if (v.visualRain > 0.15) return icons.rain;
  if (v.visualSnow > 0.15) return icons.snow;
  if (v.gloom > 0.3) return icons.fog;
  const h = p.hours;
  if (h === null) return icons.bookmark;
  if (h >= 5 && h < 7.5) return icons.sunrise;
  if (h >= 7.5 && h < 16.5) return icons.sun;
  if (h >= 16.5 && h < 19) return icons.sunset;
  return icons.moon;
}

/**
 * "Cảnh" section body: scenes as a grid of cards (icon, name, its time and a note when it has
 * its own recordings; the active one is highlighted) and the actions Tạo cảnh / Sửa cảnh /
 * Khôi phục gốc / Xóa. Creating or editing opens the SceneEditor in place of the grid.
 */
export class SceneView {
  readonly root: HTMLElement;
  private readonly home: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly cards = new Map<string, { card: HTMLButtonElement; meta: HTMLElement }>();
  private readonly editBtn: HTMLButtonElement;
  private readonly deleteBtn: HTMLButtonElement;
  private readonly resetBtn: HTMLButtonElement;
  private readonly msg: HTMLElement;
  private editor: SceneEditor | null = null;
  /** Delete / reset wait for a second click (a browser confirm() can be blocked). */
  private armed: 'delete' | 'reset' | '' = '';
  private armTimer = 0;

  constructor(private readonly deps: SceneViewDeps) {
    const { settings } = deps;
    this.root = el('div', 'scene-view');
    this.home = el('div', 'editor-stack');
    this.grid = el('div', 'preset-grid');
    this.grid.setAttribute('role', 'radiogroup');
    this.grid.setAttribute('aria-label', vi.scene.preset);

    const actions = el('div', 'button-row scene-actions');
    const create = button(vi.scene.create, () => this.openEditor(null), 'btn small primary');
    this.editBtn = button(vi.scene.edit, () => this.openEditor(deps.scenes.get(settings.get().activeScene) ?? null), 'btn small');
    this.editBtn.title = vi.scene.editHint;
    this.resetBtn = button(vi.scene.reset, () => this.arm('reset'), 'btn small');
    this.resetBtn.title = vi.scene.resetTitle;
    this.deleteBtn = button(vi.scene.delete, () => this.arm('delete'), 'btn small');
    actions.append(create, this.editBtn, this.resetBtn, this.deleteBtn);
    this.msg = el('div', 'note');

    this.home.append(this.grid, actions, this.msg);
    this.root.append(this.home);
    deps.scenes.onChange(() => this.refresh());
    settings.onChange((next) => this.sync(next));
    // Badges only (no rebuild: the library emits often, and rebuilding mid-click loses clicks).
    deps.library.onChange(() => this.updateMeta());
    this.refresh();
  }

  /** Rebuilds the cards (scenes were added, edited or removed). */
  private refresh(): void {
    this.grid.replaceChildren();
    this.cards.clear();
    this.deps.scenes.all().forEach((p, i) => this.grid.append(this.card(p, i)));
    this.updateMeta();
    this.sync(this.deps.settings.get());
  }

  private card(p: ScenePreset, index: number): HTMLButtonElement {
    const b = button('', () => {
      this.deps.startAudio();
      this.deps.applyScene(p.id);
    }, 'preset-card');
    b.setAttribute('role', 'radio');
    const icon = el('span', 'preset-icon');
    icon.innerHTML = sceneIcon(p);
    const text = el('span', 'preset-text');
    const meta = el('span', 'preset-meta');
    text.append(el('span', 'preset-name', p.name), meta);
    // A check on the icon of the selected scene; keys 1–9 pick the first nine.
    const check = el('span', 'preset-check');
    check.innerHTML = icons.check;
    icon.append(check);
    b.append(icon, text);
    b.title = p.name;
    if (index < 9) {
      b.append(el('kbd', 'key', String(index + 1)));
      b.title = `${p.name} (${index + 1})`;
    }
    this.cards.set(p.id, { card: b, meta });
    return b;
  }

  /** Each card's second line: its time (or none) and ♪ when it plays its own recordings. */
  private updateMeta(): void {
    for (const p of this.deps.scenes.all()) {
      const c = this.cards.get(p.id);
      if (!c) continue;
      const sounds = this.deps.library.sceneSounds(p.id).size;
      const time = p.hours === null ? vi.scene.keepTime : formatClock(p.hours);
      const html = `<span>${time}</span>${sounds > 0 ? `<span class="preset-note" title="${vi.scene.hasSound}">♪</span>` : ''}`;
      if (c.meta.innerHTML !== html) c.meta.innerHTML = html;
    }
  }

  private sync(s: Readonly<Settings>): void {
    const p = this.deps.scenes.get(s.activeScene);
    for (const [id, c] of this.cards) c.card.setAttribute('aria-checked', String(id === s.activeScene));
    this.editBtn.disabled = !p;
    // Built-ins can't be deleted, but edits to them can be undone.
    this.deleteBtn.hidden = !p || p.builtIn;
    this.resetBtn.hidden = !p || !p.builtIn || !this.deps.scenes.isModified(p.id);
    this.deleteBtn.textContent = this.armed === 'delete' ? vi.scene.confirmDeleteBtn : vi.scene.delete;
    this.resetBtn.textContent = this.armed === 'reset' ? vi.scene.confirmResetBtn : vi.scene.reset;
    this.deleteBtn.classList.toggle('danger', this.armed === 'delete');
    this.resetBtn.classList.toggle('danger', this.armed === 'reset');
  }

  private openEditor(p: ScenePreset | null): void {
    this.msg.textContent = '';
    this.disarm();
    const editor = new SceneEditor(
      {
        ...this.deps,
        onClose: (savedId) => this.closeEditor(savedId),
      },
      p,
    );
    this.editor = editor;
    this.home.hidden = true;
    this.root.append(editor.root);
    editor.root.scrollIntoView({ block: 'start' });
    editor.focus();
  }

  private closeEditor(savedId: string | null): void {
    this.editor?.root.remove();
    this.editor = null;
    this.home.hidden = false;
    this.msg.textContent = savedId ? vi.scene.saved : '';
  }

  /** First click arms delete/reset on the button itself; a second one within 4 s does it. */
  private arm(what: 'delete' | 'reset'): void {
    window.clearTimeout(this.armTimer);
    if (this.armed === what) {
      this.armed = '';
      if (what === 'delete') this.deleteScene();
      else this.resetScene();
      this.sync(this.deps.settings.get());
      return;
    }
    this.armed = what;
    this.armTimer = window.setTimeout(() => this.disarm(), 4000);
    this.sync(this.deps.settings.get());
  }

  private disarm(): void {
    window.clearTimeout(this.armTimer);
    this.armed = '';
    this.sync(this.deps.settings.get());
  }

  private resetScene(): void {
    const { scenes, settings } = this.deps;
    const p = scenes.get(settings.get().activeScene);
    if (!p || !p.builtIn) return;
    scenes.resetBuiltIn(p.id);
    this.deps.applyScene(p.id);
  }

  private deleteScene(): void {
    const { scenes, settings } = this.deps;
    const p = scenes.get(settings.get().activeScene);
    if (!p || p.builtIn) return;
    scenes.remove(p.id);
    this.deps.onDeleted(p.id);
    settings.update({ activeScene: '' });
  }
}
