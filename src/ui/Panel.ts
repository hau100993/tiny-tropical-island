import { button, el, section, slider, toggle, type SliderControl, type ToggleControl } from './components';
import { icons } from './icons';
import { vi } from './strings.vi';
import type { Mixer } from '../audio/mixer';
import type { PresetStore } from '../audio/presets';
import { LAYER_IDS, type LayerId, type MixerState } from '../audio/types';
import type { Keymap } from '../controls/keymap';
import { QUALITY_LEVELS, type QualityLevel } from '../core/quality';
import type { Settings, SettingsStore } from '../core/settings';
import { formatClock, type TimeMode } from '../world/celestial';

interface LayerRow {
  enabled: ToggleControl;
  volume: SliderControl;
  mute: HTMLButtonElement;
  row: HTMLElement;
}

export interface PanelDeps {
  mixer: Mixer;
  presets: PresetStore;
  settings: SettingsStore;
  keymap: Keymap;
  /** Starts audio from a click (autoplay policy). */
  startAudio: () => void;
  getHours: () => number;
  setHours: (hours: number) => void;
  /** Switches to walking (first-person). */
  walk: () => void;
}

const TIME_MODES: readonly TimeMode[] = ['real', 'cycle24', 'cycle6', 'paused'];

/** The collapsible control panel: sound mixer, presets, scene options, shortcuts. */
export class Panel {
  readonly root: HTMLElement;
  private readonly collapseBtn: HTMLButtonElement;
  private readonly enableAudioBtn: HTMLButtonElement;
  private readonly masterVolume: SliderControl;
  private readonly sceneOnly: ToggleControl;
  private readonly masterMute: HTMLButtonElement;
  private readonly rows = new Map<LayerId, LayerRow>();
  private readonly presetSelect: HTMLSelectElement;
  private readonly deleteBtn: HTMLButtonElement;
  private readonly saveForm: HTMLFormElement;
  private readonly saveInput: HTMLInputElement;
  private readonly presetMsg: HTMLElement;
  private readonly waves: SliderControl;
  private readonly qualityBtns = new Map<QualityLevel, HTMLButtonElement>();
  private readonly qualityNote: HTMLElement;
  private readonly lowPower: ToggleControl;
  private readonly autoRotate: ToggleControl;
  private readonly footsteps: ToggleControl;
  private readonly thirdPerson: ToggleControl;
  private readonly unlink: ToggleControl;
  private readonly linkHint: HTMLElement;
  private readonly visualBox: HTMLElement;
  private readonly visualRain: SliderControl;
  private readonly visualSnow: SliderControl;
  private readonly visualWind: SliderControl;
  private readonly startQuality: QualityLevel;
  private readonly timeModeBtns = new Map<TimeMode, HTMLButtonElement>();
  private clock: SliderControl | null = null;
  private clouds: SliderControl | null = null;
  private gloom: SliderControl | null = null;
  private meteors: SliderControl | null = null;
  private aurora: SliderControl | null = null;
  private rainbow: ToggleControl | null = null;
  private stars: ToggleControl | null = null;
  private fireflies: ToggleControl | null = null;
  private shownMinute = -1;
  /** Preset whose values are currently loaded; cleared when the user changes anything. */
  private activePreset = '';
  private applyingPreset = false;

  constructor(parent: HTMLElement, private readonly deps: PanelDeps) {
    const { mixer, settings } = deps;
    const s = settings.get();
    this.startQuality = s.quality;

    this.root = el('aside', 'panel');
    this.root.setAttribute('aria-label', vi.appTitle);
    const header = el('div', 'panel-header');
    const title = el('h1', 'panel-title', vi.appTitle);
    this.collapseBtn = button('', () => settings.update({ panelCollapsed: !settings.get().panelCollapsed }), 'icon-btn');
    header.append(title, this.collapseBtn);
    const content = el('div', 'panel-content');

    // --- Audio ---
    const audio = section(vi.panel.audio);
    this.enableAudioBtn = button(vi.panel.enableAudio, () => deps.startAudio(), 'btn primary wide');
    const m = mixer.current;
    const masterRow = el('div', 'mix-row master');
    this.masterVolume = slider(vi.panel.master, m.master.volume, (v) => mixer.setMaster({ volume: v }));
    this.masterMute = button('', () => mixer.toggleMuteAll(), 'icon-btn');
    masterRow.append(el('span', 'switch-spacer'), this.masterVolume.root, this.masterMute);
    this.sceneOnly = toggle(vi.panel.sceneOnly, s.sceneOnly, (on) => settings.update({ sceneOnly: on }));
    const sceneOnlyRow = el('div', 'button-row');
    sceneOnlyRow.append(this.sceneOnly.root);
    audio.body.append(this.enableAudioBtn, sceneOnlyRow, masterRow);

    for (const id of LAYER_IDS) {
      const row = el('div', 'mix-row');
      const name = vi.layers[id];
      const enabled = toggle('', m.layers[id].enabled, (on) => this.userEdit(() => mixer.setLayer(id, { enabled: on })), 'switch');
      enabled.root.setAttribute('aria-label', `${vi.panel.layerOn}/${vi.panel.layerOff}: ${name}`);
      const volume = slider(name, m.layers[id].volume, (v) => this.userEdit(() => mixer.setLayer(id, { volume: v })));
      const mute = button('', () => this.userEdit(() => mixer.setLayer(id, { muted: !mixer.current.layers[id].muted })), 'icon-btn');
      row.append(enabled.root, volume.root, mute);
      audio.body.append(row);
      this.rows.set(id, { enabled, volume, mute, row });
    }

    // Presets: pick one to apply; save the current mix under a name; delete your own.
    const presetBox = el('div', 'presets');
    const presetLabel = el('label', 'preset-row');
    presetLabel.append(el('span', 'slider-label', vi.panel.presets));
    this.presetSelect = el('select', 'select');
    this.presetSelect.addEventListener('change', () => this.applyPreset(this.presetSelect.value));
    presetLabel.append(this.presetSelect);
    this.deleteBtn = button(vi.panel.delete, () => this.deletePreset(), 'btn small');
    presetLabel.append(this.deleteBtn);

    const saveAs = button(vi.panel.saveAs, () => this.showSaveForm(true), 'btn small');
    this.saveForm = el('form', 'save-form');
    this.saveForm.hidden = true;
    this.saveInput = el('input', 'text-input');
    this.saveInput.placeholder = vi.panel.presetName;
    this.saveInput.maxLength = 32;
    const saveBtn = el('button', 'btn small primary', vi.panel.save);
    saveBtn.type = 'submit';
    const cancelBtn = button(vi.panel.cancel, () => this.showSaveForm(false), 'btn small');
    this.saveForm.append(this.saveInput, saveBtn, cancelBtn);
    this.saveForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.savePreset();
    });
    this.presetMsg = el('div', 'note');
    presetBox.append(presetLabel, saveAs, this.saveForm, this.presetMsg);
    audio.body.append(presetBox);

    // --- Scene ---
    const scene = section(vi.panel.scene);
    this.waves = slider(vi.panel.waves, s.waveStrength, (v) => this.userEdit(() => settings.update({ waveStrength: v })));
    const qualityRow = el('div', 'button-row');
    qualityRow.append(el('span', 'slider-label', vi.panel.quality));
    for (const level of QUALITY_LEVELS) {
      const b = button(vi.panel.qualityNames[level], () => settings.update({ quality: level }), 'seg');
      this.qualityBtns.set(level, b);
      qualityRow.append(b);
    }
    this.qualityNote = el('div', 'note');
    const toggles = el('div', 'button-row');
    this.lowPower = toggle(vi.panel.lowPower, s.lowPower, (on) => settings.update({ lowPower: on }));
    this.autoRotate = toggle(vi.panel.autoRotate, s.autoRotate, (on) => settings.update({ autoRotate: on }));
    toggles.append(this.lowPower.root, this.autoRotate.root);
    const walkRow = el('div', 'button-row');
    const walkBtn = button(vi.panel.walk, () => deps.walk(), 'btn primary');
    this.footsteps = toggle(vi.panel.footsteps, s.footsteps, (on) => settings.update({ footsteps: on }));
    this.thirdPerson = toggle(vi.panel.thirdPerson, s.walkView === 'third', (on) => settings.update({ walkView: on ? 'third' : 'first' }));
    walkRow.append(walkBtn, this.thirdPerson.root, this.footsteps.root);

    // Weather visuals: linked to the sound sliders by default, or separate.
    const linkRow = el('div', 'button-row');
    this.unlink = toggle(vi.panel.unlink, !s.weatherLinked, (on) => settings.update({ weatherLinked: !on }));
    linkRow.append(this.unlink.root);
    this.linkHint = el('div', 'hint', vi.panel.unlinkHint);
    this.visualBox = el('div', 'section-body');
    this.visualRain = slider(vi.panel.visualRain, s.visualRain, (v) => settings.update({ visualRain: v }));
    this.visualSnow = slider(vi.panel.visualSnow, s.visualSnow, (v) => settings.update({ visualSnow: v }));
    this.visualWind = slider(vi.panel.visualWind, s.visualWind, (v) => settings.update({ visualWind: v }));
    this.visualBox.append(this.visualRain.root, this.visualSnow.root, this.visualWind.root);

    scene.body.append(walkRow, this.waves.root, linkRow, this.linkHint, this.visualBox, qualityRow, this.qualityNote, toggles);

    // --- Shortcuts ---
    const keys = section(vi.panel.shortcuts, false);
    const list = el('dl', 'shortcut-list');
    for (const sc of deps.keymap.list()) {
      list.append(el('dt', '', sc.keyLabel), el('dd', '', sc.label));
    }
    keys.body.append(list, el('div', 'note', vi.shortcuts.mouse), el('div', 'note', vi.shortcuts.walkKeys));

    content.append(audio.root, this.buildSky(s), scene.root, keys.root);
    this.root.append(header, content);
    parent.append(this.root);

    this.refreshPresets();
    mixer.onChange((state) => this.syncMixer(state));
    settings.onChange((next) => this.syncSettings(next));
    this.syncMixer(mixer.current);
    this.syncSettings(s);
  }

  /** Sky section: time of day, day options (clouds, gloom, rainbow), night options. */
  private buildSky(s: Readonly<Settings>): HTMLElement {
    const { settings } = this.deps;
    const sky = section(vi.panel.sky);
    const modeRow = el('div', 'button-row');
    modeRow.append(el('span', 'slider-label', vi.panel.timeModeLabel));
    for (const mode of TIME_MODES) {
      const b = button(vi.panel.timeModes[mode], () => settings.update({ timeMode: mode }), 'seg');
      this.timeModeBtns.set(mode, b);
      modeRow.append(b);
    }
    // Dragging the clock in "real time" mode switches to a fixed (paused) time.
    this.clock = slider(vi.panel.time, this.deps.getHours(), (h) => {
      if (settings.get().timeMode === 'real') settings.update({ timeMode: 'paused' });
      this.deps.setHours(h);
    }, { min: 0, max: 23.99, step: 0.05, format: formatClock });

    const dayTitle = el('div', 'subhead', vi.panel.day);
    this.clouds = slider(vi.panel.clouds, s.clouds, (v) => settings.update({ clouds: v }));
    this.gloom = slider(vi.panel.gloom, s.gloom, (v) => settings.update({ gloom: v }));
    this.rainbow = toggle(vi.panel.rainbow, s.rainbow, (on) => settings.update({ rainbow: on }));
    const nightTitle = el('div', 'subhead', vi.panel.night);
    this.meteors = slider(vi.panel.meteors, s.meteors, (v) => settings.update({ meteors: v }));
    this.aurora = slider(vi.panel.aurora, s.aurora, (v) => settings.update({ aurora: v }));
    this.stars = toggle(vi.panel.stars, s.stars, (on) => settings.update({ stars: on }));
    this.fireflies = toggle(vi.panel.fireflies, s.fireflies, (on) => settings.update({ fireflies: on }));
    const dayToggles = el('div', 'button-row');
    dayToggles.append(this.rainbow.root);
    const nightToggles = el('div', 'button-row');
    nightToggles.append(this.stars.root, this.fireflies.root);

    sky.body.append(
      modeRow,
      this.clock.root,
      dayTitle,
      this.clouds.root,
      this.gloom.root,
      dayToggles,
      nightTitle,
      this.meteors.root,
      this.aurora.root,
      nightToggles,
    );
    return sky.root;
  }

  /** Called every frame; only touches the DOM when the displayed minute changes. */
  setClock(hours: number): void {
    const minute = Math.floor(hours * 60);
    if (minute === this.shownMinute || document.activeElement === this.clock?.input) return;
    this.shownMinute = minute;
    this.clock?.set(hours);
  }

  /** Any manual tweak means the mix no longer matches the selected preset. */
  private userEdit(action: () => void): void {
    action();
    if (!this.applyingPreset && this.activePreset) {
      this.activePreset = '';
      this.presetSelect.value = '';
      this.deleteBtn.disabled = true;
    }
  }

  private syncMixer(state: Readonly<MixerState>): void {
    this.enableAudioBtn.hidden = this.deps.mixer.started || this.deps.settings.get().sceneOnly;
    this.masterVolume.set(state.master.volume);
    setMuteIcon(this.masterMute, state.master.muted);
    for (const id of LAYER_IDS) {
      const r = this.rows.get(id);
      if (!r) continue;
      const l = state.layers[id];
      r.enabled.set(l.enabled);
      r.volume.set(l.volume);
      setMuteIcon(r.mute, l.muted);
      r.row.classList.toggle('off', !l.enabled);
    }
  }

  private syncSettings(s: Readonly<Settings>): void {
    this.root.classList.toggle('collapsed', s.panelCollapsed);
    this.collapseBtn.innerHTML = s.panelCollapsed ? icons.chevronLeft : icons.chevronRight;
    const label = s.panelCollapsed ? vi.panel.expand : vi.panel.collapse;
    this.collapseBtn.title = label;
    this.collapseBtn.setAttribute('aria-label', label);
    this.collapseBtn.setAttribute('aria-expanded', String(!s.panelCollapsed));
    this.waves.set(s.waveStrength);
    for (const [level, b] of this.qualityBtns) b.setAttribute('aria-pressed', String(level === s.quality));
    const msaaChanged = (s.quality === 'low') !== (this.startQuality === 'low');
    this.qualityNote.textContent = msaaChanged ? vi.panel.msaaReload : '';
    this.lowPower.set(s.lowPower);
    this.autoRotate.set(s.autoRotate);
    this.footsteps.set(s.footsteps);
    this.sceneOnly.set(s.sceneOnly);
    this.enableAudioBtn.hidden = this.deps.mixer.started || s.sceneOnly;
    this.thirdPerson.set(s.walkView === 'third');
    this.unlink.set(!s.weatherLinked);
    this.visualBox.hidden = s.weatherLinked;
    this.linkHint.hidden = !s.weatherLinked;
    this.visualRain.set(s.visualRain);
    this.visualSnow.set(s.visualSnow);
    this.visualWind.set(s.visualWind);
    for (const [mode, b] of this.timeModeBtns) b.setAttribute('aria-pressed', String(mode === s.timeMode));
    this.clouds?.set(s.clouds);
    this.gloom?.set(s.gloom);
    this.rainbow?.set(s.rainbow);
    this.meteors?.set(s.meteors);
    this.aurora?.set(s.aurora);
    this.stars?.set(s.stars);
    this.fireflies?.set(s.fireflies);
  }

  private refreshPresets(): void {
    const sel = this.presetSelect;
    sel.replaceChildren();
    const custom = el('option', '', vi.panel.custom);
    custom.value = '';
    sel.append(custom);
    const all = this.deps.presets.all();
    const groups: Array<[string, boolean]> = [
      [vi.panel.builtInGroup, true],
      [vi.panel.userGroup, false],
    ];
    for (const [label, builtIn] of groups) {
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
    sel.value = this.activePreset;
    this.deleteBtn.disabled = !this.deps.presets.get(this.activePreset) || !!this.deps.presets.get(this.activePreset)?.builtIn;
  }

  private applyPreset(id: string): void {
    const p = this.deps.presets.get(id);
    if (!p) return;
    this.applyingPreset = true;
    this.deps.mixer.load(p.mixer);
    this.deps.settings.update({ waveStrength: p.waveStrength });
    this.applyingPreset = false;
    this.activePreset = id;
    this.deleteBtn.disabled = p.builtIn;
    this.presetMsg.textContent = '';
  }

  private showSaveForm(show: boolean): void {
    this.saveForm.hidden = !show;
    this.presetMsg.textContent = '';
    if (show) {
      this.saveInput.value = '';
      this.saveInput.focus();
    }
  }

  private savePreset(): void {
    const saved = this.deps.presets.save(this.saveInput.value, this.deps.mixer.current, this.deps.settings.get().waveStrength);
    if (!saved) {
      this.presetMsg.textContent = vi.panel.saveFailed;
      return;
    }
    this.activePreset = saved.id;
    this.refreshPresets();
    this.saveForm.hidden = true;
    this.presetMsg.textContent = vi.panel.saved;
  }

  private deletePreset(): void {
    const p = this.deps.presets.get(this.activePreset);
    if (!p || p.builtIn) return;
    this.deps.presets.remove(p.id);
    this.activePreset = '';
    this.refreshPresets();
  }
}

function setMuteIcon(b: HTMLButtonElement, muted: boolean): void {
  b.innerHTML = muted ? icons.speakerOff : icons.speaker;
  const label = muted ? vi.panel.unmute : vi.panel.mute;
  b.title = label;
  b.setAttribute('aria-label', label);
  b.setAttribute('aria-pressed', String(muted));
}
