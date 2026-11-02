import { backBar, button, CLOCK_MARKS, el, PERCENT, slider, toggle, VOLUME, type SliderControl } from './components';
import { icons } from './icons';
import { vi } from './strings.vi';
import { fromSkyBalance, skyBalance, type SettingsStore } from '../core/settings';
import { DEFAULT_SCENE, sceneValuesOf, type ScenePreset, type ScenePresetStore, type SceneValues } from '../core/scenePresets';
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
  /** A scene of your own was deleted (its recording mappings go too). */
  onDeleted: (id: string) => void;
  /** Called when the editor closes (saved or not). */
  onClose: (savedId: string | null) => void;
}

type EffectKey = 'visualRain' | 'visualSnow' | 'visualWind' | 'waveStrength' | 'clouds' | 'cirrus' | 'meteors' | 'aurora' | 'moonlight' | 'sunBrightness' | 'sunSize';
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
const NORMAL_MARKED: readonly EffectKey[] = ['sunBrightness', 'sunSize', 'moonlight'];

/**
 * "Tạo cảnh" / "Sửa cảnh": one page inside the Cảnh section with the scene's name, time of day
 * (optionally aimed at the desk window), effects and sound. Every change shows on the island
 * right away; Hủy restores what was there, Lưu stores the scene and plays it. At the bottom, a
 * scene of your own can be deleted and an edited built-in reset (each asks for a second click).
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
  /** Delete / reset wait for a second click (a browser confirm() can be blocked). */
  private armed = false;
  private armTimer = 0;
  private aimToggle!: ReturnType<typeof toggle>;
  private readonly title: string;
  private readonly backBar: ReturnType<typeof backBar>;
  /** The draft as it was when the editor opened (back asks to confirm once it differs). */
  private readonly startDraft: string;
  /** Back with unsaved changes waits for a second click, like delete. */
  private backArmed = false;
  private backTimer = 0;

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
    this.title = p ? vi.scene.editTitle(p.name) : vi.scene.newTitle;
    this.backBar = backBar(this.title, vi.scene.back, () => this.back());
    head.append(this.backBar.root);

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
      wheelStep: 0.25,
      wrap: 24,
      marks: CLOCK_MARKS,
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
      slider(label, this.values[key], (v) => this.setValue(key, v), {
        ...PERCENT,
        defaultValue: DEFAULT_SCENE[key],
        // The sun and moon sliders have a "normal" level in the middle: mark it.
        marks: NORMAL_MARKED.includes(key) ? [DEFAULT_SCENE[key]] : undefined,
      }).root;
    const flag = (key: FlagKey, label: string): HTMLElement => {
      const t = toggle(label, this.values[key], (on) => {
        t.set(on);
        this.setValue(key, on);
      });
      return t.root;
    };
    // Gloom and clarity as one two-way slider: left grey, right clear (the middle is normal).
    const sky = slider(vi.scene.sky, skyBalance(this.values), (b) => {
      const v = fromSkyBalance(b);
      this.values.gloom = v.gloom;
      this.values.clarity = v.clarity;
      this.deps.settings.update(v);
    }, { min: -1, max: 1, step: 0.01, wheelStep: 0.05, format: vi.scene.skyValue, defaultValue: 0, marks: [0] });
    sky.root.classList.add('sky-slider');
    sky.root.title = `${vi.scene.skyHint}\n${sky.root.title}`;
    const weatherFlags = el('div', 'option-list');
    weatherFlags.append(flag('rainbow', vi.scene.rainbow));
    const nightFlags = el('div', 'option-list');
    nightFlags.append(flag('stars', vi.panel.stars), flag('fireflies', vi.panel.fireflies));
    // What most scenes change stays open; the sun and the night sky fold away.
    fx.body.append(
      el('div', 'subhead', vi.panel.weather),
      add('visualRain', vi.scene.rain),
      add('visualSnow', vi.scene.snow),
      add('visualWind', vi.scene.wind),
      add('waveStrength', vi.scene.waves),
      el('div', 'subhead', vi.scene.skyGroup),
      add('clouds', vi.scene.clouds),
      add('cirrus', vi.scene.cirrus),
      sky.root,
      weatherFlags,
      this.fold(vi.scene.sun, add('sunBrightness', vi.scene.sunBrightness), add('sunSize', vi.scene.sunSize)),
      this.fold(vi.scene.nightGroup, add('moonlight', vi.panel.moonlight), add('meteors', vi.panel.meteors), add('aurora', vi.panel.aurora), nightFlags),
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
    foot.append(this.msg);
    // Delete (your own scene) or reset (a built-in you have edited).
    const remove = p && !p.builtIn ? 'delete' : p && deps.scenes.isModified(p.id) ? 'reset' : null;
    if (remove) {
      const label = remove === 'delete' ? vi.scene.delete : vi.scene.reset;
      const confirm = remove === 'delete' ? vi.scene.confirmDeleteBtn : vi.scene.confirmResetBtn;
      const b = button(label, () => {
        window.clearTimeout(this.armTimer);
        if (this.armed) {
          if (remove === 'delete') this.deleteScene();
          else this.resetScene();
          return;
        }
        this.armed = true;
        b.textContent = confirm;
        b.classList.add('danger');
        this.armTimer = window.setTimeout(() => {
          this.armed = false;
          b.textContent = label;
          b.classList.remove('danger');
        }, 4000);
      }, 'btn small ghost editor-remove');
      if (remove === 'reset') b.title = vi.scene.resetTitle;
      foot.append(b);
    }
    foot.append(actions);
    this.nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.save();
    });

    this.root.append(head, nameGroup.root, timeGroup.root, fx.root, snd.root, foot);
    this.renderTime();
    this.renderSounds();
    // Preview the starting state (a new scene starts from what is on screen).
    settings.update({ ...this.values });
    this.previewTime();
    this.startDraft = this.draftKey();
  }

  /** Everything Lưu would store, as one comparable string. */
  private draftKey(): string {
    return JSON.stringify([this.nameInput.value, this.values, this.hours, this.aim, this.skyTurn, [...this.sounds]]);
  }

  /**
   * The back bar or Esc: leaves at once when nothing changed; with changes, the first press
   * turns the bar into "Bấm lần nữa để bỏ thay đổi" for 4 s and the second one leaves.
   */
  back(): void {
    if (this.backArmed || this.draftKey() === this.startDraft) {
      this.cancel();
      return;
    }
    this.backArmed = true;
    this.backBar.label.textContent = vi.scene.confirmBack;
    this.backBar.root.classList.add('armed');
    this.backTimer = window.setTimeout(() => {
      this.backArmed = false;
      this.backBar.label.textContent = this.title;
      this.backBar.root.classList.remove('armed');
    }, 4000);
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

  /** A folded block of effects inside a group (closed at first). */
  private fold(title: string, ...children: HTMLElement[]): HTMLElement {
    const d = el('details', 'editor-fold');
    const body = el('div', 'editor-stack');
    body.append(...children);
    d.append(el('summary', 'editor-fold-title', title), body);
    return d;
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
        const v = slider('', vol, (x) => this.sounds.set(t.id, x), { ...VOLUME, defaultValue: 0.7 });
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
    this.restore(this.snap.activeScene);
    this.deps.onClose(null);
  }

  /** The island as it was when the editor opened, with this scene selected. */
  private restore(activeScene: string): void {
    window.clearTimeout(this.armTimer);
    window.clearTimeout(this.backTimer);
    const s = this.snap;
    this.deps.settings.update({ ...s.values, activeScene, timeMode: s.timeMode, timePaused: s.timePaused });
    this.deps.setSky(s.hours, s.skyTurn);
  }

  /** Deletes the scene of your own being edited; the effects on screen stay as they were. */
  private deleteScene(): void {
    const p = this.editing;
    if (!p || p.builtIn) return;
    this.restore(this.snap.activeScene === p.id ? '' : this.snap.activeScene);
    this.deps.scenes.remove(p.id);
    this.deps.onDeleted(p.id);
    this.deps.onClose(null);
  }

  /** Puts the built-in being edited back as shipped, and plays it. */
  private resetScene(): void {
    const p = this.editing;
    if (!p || !p.builtIn) return;
    window.clearTimeout(this.armTimer);
    this.deps.scenes.resetBuiltIn(p.id);
    this.deps.applyScene(p.id);
    this.deps.onClose(null);
  }
}

function roundTime(h: number): number {
  return Math.min(24 - TIME_STEP, Math.round(h / TIME_STEP) * TIME_STEP);
}
