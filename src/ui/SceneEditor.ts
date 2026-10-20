import { button, el, slider, toggle, type SliderControl } from './components';
import { icons } from './icons';
import { vi } from './strings.vi';
import type { SettingsStore } from '../core/settings';
import { sceneValuesOf, type ScenePreset, type ScenePresetStore, type SceneValues } from '../core/scenePresets';
import type { SoundLibrary } from '../audio/library/SoundLibrary';
import { formatClock } from '../world/celestial';

export interface SceneEditorDeps {
  settings: SettingsStore;
  scenes: ScenePresetStore;
  library: SoundLibrary;
  /** Applies a saved scene (effects, time, its recordings). */
  applyScene: (id: string) => void;
  startAudio: () => void;
  getHours: () => number;
  getSkyTurn: () => number;
  /** Shows a time of day and sky turn (degrees) on the island, for the live preview. */
  setSky: (hours: number, skyTurn: number) => void;
  /** Sky turn (degrees) that brings this hour's sun or moon into the desk window. */
  windowTurn: (hours: number) => number;
  /** Called when the editor closes (saved or not). */
  onClose: (savedId: string | null) => void;
}

type EffectKey = 'visualRain' | 'visualSnow' | 'visualWind' | 'waveStrength' | 'clouds' | 'cirrus' | 'gloom' | 'meteors' | 'aurora' | 'moonlight' | 'sunBrightness' | 'sunSize';
type FlagKey = 'rainbow' | 'stars' | 'fireflies';

/** The island as it was when the editor opened (Hủy puts it back). */
interface Snapshot {
  values: SceneValues;
  activeScene: string;
  timeMode: 'real' | 'free';
  timePaused: boolean;
  hours: number;
  skyTurn: number;
}

/** Time slider step: 5 minutes. */
const TIME_STEP = 5 / 60;

/**
 * "Tạo cảnh" / "Sửa cảnh": one page inside the Cảnh section with the scene's name, time of day
 * (optionally aimed at the desk window), effects and sound. Every change shows on the island
 * right away; Hủy restores what was there, Lưu stores the scene and plays it.
 */
export class SceneEditor {
  readonly root: HTMLElement;
  private readonly snap: Snapshot;
  private readonly values: SceneValues;
  private hours: number | null;
  private aim: boolean;
  private skyTurn: number;
  private readonly sounds: Map<string, number>;
  private readonly nameInput: HTMLInputElement;
  private readonly msg: HTMLElement;
  private readonly timeBody: HTMLElement;
  private readonly timeHint: HTMLElement;
  private readonly timeModeBtns: HTMLButtonElement[] = [];
  private readonly soundList: HTMLElement;
  private readonly soundHint: HTMLElement;
  private readonly fileInput: HTMLInputElement;
  private clock!: SliderControl;
  private aimToggle!: ReturnType<typeof toggle>;

  constructor(
    private readonly deps: SceneEditorDeps,
    private readonly editing: ScenePreset | null,
  ) {
    const { settings } = deps;
    const s = settings.get();
    this.snap = {
      values: sceneValuesOf(s),
      activeScene: s.activeScene,
      timeMode: s.timeMode,
      timePaused: s.timePaused,
      hours: deps.getHours(),
      skyTurn: deps.getSkyTurn(),
    };
    const p = editing;
    this.values = p ? { ...p.values } : sceneValuesOf(s);
    this.hours = p ? p.hours : roundTime(this.snap.hours);
    this.aim = p ? p.skyTurn !== 0 : true;
    this.skyTurn = p ? p.skyTurn : this.hours === null ? 0 : deps.windowTurn(this.hours);
    this.sounds = p ? deps.library.sceneSounds(p.id) : new Map();

    this.root = el('div', 'scene-editor');
    const head = el('div', 'editor-head');
    const back = button('', () => this.cancel(), 'icon-btn');
    back.innerHTML = icons.chevronLeft;
    back.title = vi.scene.back;
    back.setAttribute('aria-label', vi.scene.back);
    head.append(back, el('div', 'editor-title', p ? vi.scene.editTitle(p.name) : vi.scene.newTitle));

    // Name (a built-in keeps its own).
    const nameGroup = this.group(icons.bookmark, vi.scene.nameLabel);
    this.nameInput = el('input', 'text-input editor-name');
    this.nameInput.maxLength = 32;
    this.nameInput.placeholder = vi.scene.namePlaceholder;
    this.nameInput.value = p?.name ?? '';
    this.nameInput.disabled = !!p?.builtIn;
    nameGroup.body.append(this.nameInput);
    if (p?.builtIn) nameGroup.body.append(el('div', 'hint', vi.scene.builtInName));

    // Time of day.
    const timeGroup = this.group(icons.time, vi.scene.timeTitle);
    const modes = el('div', 'seg-group two');
    for (const set of [false, true]) {
      const b = button(set ? vi.scene.setTime : vi.scene.noTime, () => this.setTimeOn(set), 'seg');
      this.timeModeBtns.push(b);
      modes.append(b);
    }
    this.timeBody = el('div', 'editor-stack');
    this.clock = slider(vi.panel.time, this.hours ?? this.snap.hours, (h) => this.setHours(h), {
      min: 0,
      max: 24 - TIME_STEP,
      step: TIME_STEP,
      format: formatClock,
    });
    const now = button(vi.scene.nowBtn, () => {
      this.clock.set(roundTime(this.snap.hours));
      this.setHours(roundTime(this.snap.hours));
    }, 'btn small');
    this.aimToggle = toggle(vi.scene.aimWindow, this.aim, (on) => {
      this.aim = on;
      this.aimToggle.set(on);
      this.retarget();
    });
    const aimRow = el('div', 'option-list');
    aimRow.append(this.aimToggle.root);
    const nowRow = el('div', 'button-row');
    nowRow.append(now);
    this.timeBody.append(this.clock.root, nowRow, aimRow);
    this.timeHint = el('div', 'hint');
    timeGroup.body.append(modes, this.timeBody, this.timeHint);

    // Effects: weather, then the night sky.
    const fx = this.group(icons.scene, vi.scene.effectsTitle);
    const add = (key: EffectKey, label: string): HTMLElement =>
      slider(label, this.values[key], (v) => this.setValue(key, v)).root;
    const flag = (key: FlagKey, label: string): HTMLElement => {
      const t = toggle(label, this.values[key], (on) => {
        t.set(on);
        this.setValue(key, on);
      });
      return t.root;
    };
    const weatherFlags = el('div', 'button-row');
    weatherFlags.append(flag('rainbow', vi.scene.rainbow));
    const nightFlags = el('div', 'button-row');
    nightFlags.append(flag('stars', vi.panel.stars), flag('fireflies', vi.panel.fireflies));
    fx.body.append(
      el('div', 'subhead', vi.panel.weather),
      add('visualRain', vi.scene.rain),
      add('visualSnow', vi.scene.snow),
      add('visualWind', vi.scene.wind),
      add('waveStrength', vi.scene.waves),
      add('clouds', vi.scene.clouds),
      add('cirrus', vi.scene.cirrus),
      add('gloom', vi.scene.gloom),
      weatherFlags,
      el('div', 'subhead', vi.scene.sun),
      add('sunBrightness', vi.scene.sunBrightness),
      add('sunSize', vi.scene.sunSize),
      el('div', 'subhead', vi.panel.nightSky),
      add('moonlight', vi.panel.moonlight),
      add('meteors', vi.panel.meteors),
      add('aurora', vi.panel.aurora),
      nightFlags,
    );

    // Sound: the recordings that play with the scene; none = the synthesized fallback.
    const snd = this.group(icons.music, vi.scene.soundTitle);
    this.soundHint = el('div', 'hint');
    this.soundList = el('div', 'editor-sounds');
    this.fileInput = el('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'audio/*,.mp3,.ogg,.opus,.m4a,.wav,.flac,.webm';
    this.fileInput.hidden = true;
    this.fileInput.addEventListener('change', () => void this.addFile());
    const addBtn = button(vi.scene.addFile, () => {
      deps.startAudio();
      this.fileInput.click();
    }, 'btn small');
    snd.body.append(this.soundHint, this.soundList, addBtn, this.fileInput);

    // Pinned to the bottom of the panel while scrolling.
    const foot = el('div', 'editor-foot');
    this.msg = el('div', 'note');
    const actions = el('div', 'editor-actions');
    const save = button(vi.scene.saveScene, () => this.save(), 'btn primary');
    actions.append(button(vi.scene.cancel, () => this.cancel(), 'btn'), save);
    foot.append(this.msg, actions);
    this.nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.save();
    });

    this.root.append(head, nameGroup.root, timeGroup.root, fx.root, snd.root, foot);
    this.renderTime();
    this.renderSounds();
    // Preview the starting state (a new scene starts from what is on screen).
    settings.update({ ...this.values });
    this.previewTime();
  }

  /** Puts the name field in focus (new scenes). */
  focus(): void {
    if (!this.nameInput.disabled) this.nameInput.focus();
  }

  private group(icon: string, title: string): { root: HTMLElement; body: HTMLElement } {
    const root = el('section', 'editor-group');
    const h = el('div', 'editor-group-title');
    const i = el('span', 'editor-group-icon');
    i.innerHTML = icon;
    h.append(i, el('span', '', title));
    const body = el('div', 'editor-stack');
    root.append(h, body);
    return { root, body };
  }

  private setValue<K extends keyof SceneValues>(key: K, v: SceneValues[K]): void {
    this.values[key] = v;
    this.deps.settings.update({ [key]: v });
  }

  private setTimeOn(on: boolean): void {
    if (on === (this.hours !== null)) return;
    this.hours = on ? roundTime(Number(this.clock.input.value)) : null;
    this.retarget();
    this.renderTime();
  }

  private setHours(h: number): void {
    this.hours = h;
    this.retarget();
    this.renderTime();
  }

  /** The time or aim changed: recompute the sky turn and preview it. */
  private retarget(): void {
    this.skyTurn = this.hours !== null && this.aim ? this.deps.windowTurn(this.hours) : 0;
    this.previewTime();
  }

  private previewTime(): void {
    const { settings } = this.deps;
    if (this.hours === null) {
      // No time of its own: the island keeps the clock it had.
      settings.update({ timeMode: this.snap.timeMode, timePaused: this.snap.timePaused });
      this.deps.setSky(this.snap.hours, this.snap.skyTurn);
      return;
    }
    settings.update({ timeMode: 'free', timePaused: true });
    this.deps.setSky(this.hours, this.skyTurn);
  }

  private renderTime(): void {
    const on = this.hours !== null;
    this.timeModeBtns.forEach((b, i) => b.setAttribute('aria-pressed', String((i === 1) === on)));
    this.timeBody.hidden = !on;
    this.timeHint.textContent = on ? vi.scene.timeHint(formatClock(this.hours ?? 0)) : vi.scene.noTimeHint;
  }

  private renderSounds(): void {
    const { library } = this.deps;
    const tracks = library.list();
    this.soundList.replaceChildren();
    if (tracks.length === 0) this.soundList.append(el('div', 'hint', vi.scene.noTracks));
    for (const t of tracks) {
      const vol = this.sounds.get(t.id);
      const row = el('div', 'map-row');
      const on = toggle(t.name, vol !== undefined, (v) => {
        if (v) this.sounds.set(t.id, t.volume || 0.7);
        else this.sounds.delete(t.id);
        this.renderSounds();
      }, 'toggle small');
      on.root.title = t.name;
      row.append(on.root);
      if (vol !== undefined) {
        const v = slider('', vol, (x) => this.sounds.set(t.id, x));
        v.root.classList.add('compact');
        v.input.setAttribute('aria-label', `${vi.library.volume}: ${t.name}`);
        row.append(v.root);
      }
      this.soundList.append(row);
    }
    this.soundHint.textContent = this.sounds.size > 0 ? vi.scene.soundFiles(this.sounds.size) : vi.scene.soundSynth;
  }

  private async addFile(): Promise<void> {
    const file = this.fileInput.files?.[0];
    this.fileInput.value = '';
    if (!file) return;
    this.msg.textContent = vi.library.copying;
    const before = new Set(this.deps.library.list().map((t) => t.id));
    const r = await this.deps.library.add(file);
    if (r !== 'ok') {
      this.msg.textContent = `${file.name}: ${vi.library.errors[r]}`;
      return;
    }
    this.msg.textContent = '';
    // The new recording plays with this scene.
    const added = this.deps.library.list().find((t) => !before.has(t.id));
    if (added) this.sounds.set(added.id, added.volume);
    this.renderSounds();
  }

  private save(): void {
    const { scenes, library } = this.deps;
    const draft = {
      name: this.editing?.builtIn ? this.editing.name : this.nameInput.value,
      values: { ...this.values },
      hours: this.hours,
      skyTurn: this.skyTurn,
    };
    const r = this.editing ? scenes.edit(this.editing.id, draft) : scenes.create(draft);
    if (typeof r === 'string') {
      this.msg.textContent = vi.scene.errors[r];
      if (!this.nameInput.disabled) this.nameInput.focus();
      return;
    }
    library.setSceneSounds(r.id, this.sounds);
    this.deps.applyScene(r.id);
    this.deps.onClose(r.id);
  }

  /** Hủy / back: the island goes back to how it was. */
  cancel(): void {
    const { settings } = this.deps;
    const s = this.snap;
    settings.update({ ...s.values, activeScene: s.activeScene, timeMode: s.timeMode, timePaused: s.timePaused });
    this.deps.setSky(s.hours, s.skyTurn);
    this.deps.onClose(null);
  }
}

function roundTime(h: number): number {
  return Math.min(24 - TIME_STEP, Math.round(h / TIME_STEP) * TIME_STEP);
}
