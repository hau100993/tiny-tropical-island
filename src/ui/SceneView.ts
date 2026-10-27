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
  /** The editor opened (true) or closed: the panel gives it the whole page. */
  onEditing: (on: boolean) => void;
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
 * "Cảnh" tab: scenes as a grid of cards (icon, name, its time and ♪ when it has its own
 * recordings; the active one is highlighted), each with a pencil to edit it, and a "+" card at
 * the end to create one. The SceneEditor opens in place of the grid; deleting a scene of your
 * own, or resetting an edited built-in, is done from there.
 */
export class SceneView {
  readonly root: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly cards = new Map<string, { card: HTMLButtonElement; meta: HTMLElement }>();
  private readonly msg: HTMLElement;
  private editor: SceneEditor | null = null;

  constructor(private readonly deps: SceneViewDeps) {
    const { settings } = deps;
    this.root = el('div', 'scene-view');
    this.grid = el('div', 'preset-grid');
    this.grid.setAttribute('role', 'radiogroup');
    this.grid.setAttribute('aria-label', vi.scene.preset);
    this.msg = el('div', 'note');
    this.root.append(this.grid, this.msg);
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
    const add = button('', () => this.openEditor(null), 'preset-card preset-add');
    const icon = el('span', 'preset-icon');
    icon.innerHTML = icons.plus;
    add.append(icon, el('span', 'preset-name', vi.scene.create));
    this.grid.append(add);
    this.updateMeta();
    this.sync(this.deps.settings.get());
  }

  /** A card (picks the scene) and its pencil (edits it), side by side in one grid cell. */
  private card(p: ScenePreset, index: number): HTMLElement {
    const cell = el('div', 'preset-cell');
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
    // A check on the icon of the selected scene; keys 1–9 pick the first nine (tooltip).
    const check = el('span', 'preset-check');
    check.innerHTML = icons.check;
    icon.append(check);
    b.append(icon, text);
    b.title = index < 9 ? `${p.name} (${index + 1})` : p.name;
    const edit = button('', () => this.openEditor(p), 'icon-btn preset-edit');
    edit.innerHTML = icons.pencil;
    edit.title = vi.scene.edit(p.name);
    edit.setAttribute('aria-label', vi.scene.edit(p.name));
    cell.append(b, edit);
    this.cards.set(p.id, { card: b, meta });
    return cell;
  }

  /** Each card's second line: its time (if it sets one) and ♪ when it plays its own recordings. */
  private updateMeta(): void {
    for (const p of this.deps.scenes.all()) {
      const c = this.cards.get(p.id);
      if (!c) continue;
      const sounds = this.deps.library.sceneSounds(p.id).size;
      const time = p.hours === null ? '' : `<span>${formatClock(p.hours)}</span>`;
      const html = `${time}${sounds > 0 ? `<span class="preset-note" title="${vi.scene.hasSound}">♪</span>` : ''}`;
      if (c.meta.innerHTML !== html) c.meta.innerHTML = html;
    }
  }

  private sync(s: Readonly<Settings>): void {
    for (const [id, c] of this.cards) c.card.setAttribute('aria-checked', String(id === s.activeScene));
  }

  private openEditor(p: ScenePreset | null): void {
    this.msg.textContent = '';
    const editor = new SceneEditor(
      {
        ...this.deps,
        onClose: (savedId) => this.closeEditor(savedId),
      },
      p,
    );
    this.editor = editor;
    this.grid.hidden = true;
    this.root.append(editor.root);
    this.deps.onEditing(true);
    editor.focus();
  }

  private closeEditor(savedId: string | null): void {
    this.editor?.root.remove();
    this.editor = null;
    this.grid.hidden = false;
    this.msg.textContent = savedId ? vi.scene.saved : '';
    this.deps.onEditing(false);
  }
}
