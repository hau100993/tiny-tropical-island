import { button, el, section, slider, toggle, type SliderControl, type ToggleControl } from './components';
import { icons } from './icons';
import { vi } from './strings.vi';
import { LibraryView } from './LibraryView';
import { SceneView } from './SceneView';
import type { Mixer } from '../audio/mixer';
import type { MixerState } from '../audio/types';
import type { SoundLibrary } from '../audio/library/SoundLibrary';
import type { Keymap } from '../controls/keymap';
import { QUALITY_LEVELS, type QualityLevel } from '../core/quality';
import type { ScenePresetStore } from '../core/scenePresets';
import type { Settings, SettingsStore } from '../core/settings';
import { formatClock, type TimeMode } from '../world/celestial';

export interface PanelDeps {
  mixer: Mixer;
  library: SoundLibrary;
  scenes: ScenePresetStore;
  settings: SettingsStore;
  keymap: Keymap;
  /** Starts audio from a click (autoplay policy). */
  startAudio: () => void;
  applyScene: (id: string) => void;
  onSceneDeleted: (id: string) => void;
  getHours: () => number;
  setHours: (hours: number) => void;
  /** Switches to walking. */
  walk: () => void;
  /** Shows/hides the Pomodoro card. */
  togglePomodoro: () => void;
  /** Sit at the desk in the house (or get up). */
  toggleDesk: () => void;
  /** Get into the bathtub (or out). */
  toggleBath: () => void;
}

const TIME_MODES: readonly TimeMode[] = ['real', 'cycle24', 'cycle6', 'paused'];

/** The collapsible control panel: sound, scene presets, sky, display options, shortcuts. */
export class Panel {
  readonly root: HTMLElement;
  private readonly collapseBtn: HTMLButtonElement;
  private readonly enableAudioBtn: HTMLButtonElement;
  private readonly masterVolume: SliderControl;
  private readonly masterMute: HTMLButtonElement;
  private readonly sceneOnly: ToggleControl;
  private readonly synthFallback: ToggleControl;
  private readonly synthStatus: HTMLElement;
  private readonly qualityBtns = new Map<QualityLevel, HTMLButtonElement>();
  private readonly qualityNote: HTMLElement;
  private readonly lowPower: ToggleControl;
  private readonly autoRotate: ToggleControl;
  private readonly footsteps: ToggleControl;
  private readonly thirdPerson: ToggleControl;
  private readonly startAtDesk: ToggleControl;
  private readonly startQuality: QualityLevel;
  private readonly timeModeBtns = new Map<TimeMode, HTMLButtonElement>();
  private clock: SliderControl | null = null;
  private meteors: SliderControl | null = null;
  private aurora: SliderControl | null = null;
  private stars: ToggleControl | null = null;
  private fireflies: ToggleControl | null = null;
  private shownMinute = -1;

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

    // --- Sound: master, synthesized fallback, the user's recordings ---
    const audio = section(vi.panel.audio);
    this.enableAudioBtn = button(vi.panel.enableAudio, () => deps.startAudio(), 'btn primary wide');
    const masterRow = el('div', 'mix-row master');
    this.masterVolume = slider(vi.panel.master, mixer.current.master.volume, (v) => mixer.setMaster({ volume: v }));
    this.masterMute = button('', () => mixer.toggleMuteAll(), 'icon-btn');
    masterRow.append(this.masterVolume.root, this.masterMute);
    this.sceneOnly = toggle(vi.panel.sceneOnly, s.sceneOnly, (on) => settings.update({ sceneOnly: on }));
    this.synthFallback = toggle(vi.panel.synthFallback, s.synthFallback, (on) => settings.update({ synthFallback: on }));
    const toggles = el('div', 'button-row');
    toggles.append(this.sceneOnly.root, this.synthFallback.root);
    this.synthStatus = el('div', 'hint');
    const library = new LibraryView({
      library: deps.library,
      scenes: deps.scenes,
      startAudio: deps.startAudio,
      applyScene: deps.applyScene,
      clearScene: () => settings.update({ activeScene: '' }),
    });
    audio.body.append(this.enableAudioBtn, masterRow, toggles, this.synthStatus, library.root);

    // --- Scene presets and effects ---
    const scene = new SceneView({
      settings,
      scenes: deps.scenes,
      applyScene: deps.applyScene,
      onDeleted: deps.onSceneDeleted,
      getHours: deps.getHours,
    });

    // --- Display ---
    const display = section(vi.panel.display);
    const walkRow = el('div', 'button-row');
    const walkBtn = button(vi.panel.walk, () => deps.walk(), 'btn primary');
    this.thirdPerson = toggle(vi.panel.thirdPerson, s.walkView === 'third', (on) => settings.update({ walkView: on ? 'third' : 'first' }));
    this.footsteps = toggle(vi.panel.footsteps, s.footsteps, (on) => settings.update({ footsteps: on }));
    walkRow.append(walkBtn, this.thirdPerson.root, this.footsteps.root);
    const deskRow = el('div', 'button-row');
    this.startAtDesk = toggle(vi.desk.startAtDesk, s.startAtDesk, (on) => settings.update({ startAtDesk: on }));
    deskRow.append(
      button(vi.desk.button, () => deps.toggleDesk(), 'btn primary'),
      button(vi.bath.button, () => deps.toggleBath(), 'btn'),
      this.startAtDesk.root,
    );
    const pomoRow = el('div', 'button-row');
    pomoRow.append(button(vi.panel.pomodoro, () => deps.togglePomodoro(), 'btn'));
    const qualityRow = el('div', 'button-row');
    qualityRow.append(el('span', 'slider-label', vi.panel.quality));
    for (const level of QUALITY_LEVELS) {
      const b = button(vi.panel.qualityNames[level], () => settings.update({ quality: level }), 'seg');
      this.qualityBtns.set(level, b);
      qualityRow.append(b);
    }
    this.qualityNote = el('div', 'note');
    const displayToggles = el('div', 'button-row');
    this.lowPower = toggle(vi.panel.lowPower, s.lowPower, (on) => settings.update({ lowPower: on }));
    this.autoRotate = toggle(vi.panel.autoRotate, s.autoRotate, (on) => settings.update({ autoRotate: on }));
    displayToggles.append(this.lowPower.root, this.autoRotate.root);
    display.body.append(deskRow, walkRow, pomoRow, qualityRow, this.qualityNote, displayToggles);

    // --- Shortcuts ---
    const keys = section(vi.panel.shortcuts, false);
    const list = el('dl', 'shortcut-list');
    for (const sc of deps.keymap.list()) {
      list.append(el('dt', '', sc.keyLabel), el('dd', '', sc.label));
    }
    keys.body.append(list, el('div', 'note', vi.shortcuts.mouse), el('div', 'note', vi.shortcuts.walkKeys));

    content.append(audio.root, scene.root, this.buildSky(s), display.root, keys.root);
    this.root.append(header, content);
    parent.append(this.root);

    mixer.onChange((state) => this.syncMixer(state));
    settings.onChange((next) => this.syncSettings(next));
    deps.library.onChange(() => this.syncSynthStatus());
    this.syncMixer(mixer.current);
    this.syncSettings(s);
  }

  /** Sky section: time of day and the night options. */
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

    const nightTitle = el('div', 'subhead', vi.panel.night);
    this.meteors = slider(vi.panel.meteors, s.meteors, (v) => settings.update({ meteors: v }));
    this.aurora = slider(vi.panel.aurora, s.aurora, (v) => settings.update({ aurora: v }));
    this.stars = toggle(vi.panel.stars, s.stars, (on) => settings.update({ stars: on }));
    this.fireflies = toggle(vi.panel.fireflies, s.fireflies, (on) => settings.update({ fireflies: on }));
    const nightToggles = el('div', 'button-row');
    nightToggles.append(this.stars.root, this.fireflies.root);

    sky.body.append(modeRow, this.clock.root, nightTitle, this.meteors.root, this.aurora.root, nightToggles);
    return sky.root;
  }

  /** Called every frame; only touches the DOM when the displayed minute changes. */
  setClock(hours: number): void {
    const minute = Math.floor(hours * 60);
    if (minute === this.shownMinute || document.activeElement === this.clock?.input) return;
    this.shownMinute = minute;
    this.clock?.set(hours);
  }

  private syncMixer(state: Readonly<MixerState>): void {
    this.enableAudioBtn.hidden = this.deps.mixer.started || this.deps.settings.get().sceneOnly;
    this.masterVolume.set(state.master.volume);
    setMuteIcon(this.masterMute, state.master.muted);
    this.syncSynthStatus();
  }

  private syncSynthStatus(): void {
    const s = this.deps.settings.get();
    const started = this.deps.mixer.started && !s.sceneOnly;
    this.synthStatus.hidden = !started || !s.synthFallback;
    this.synthStatus.textContent = this.deps.library.audible ? vi.panel.synthIdle : vi.panel.synthPlaying;
  }

  private syncSettings(s: Readonly<Settings>): void {
    this.root.classList.toggle('collapsed', s.panelCollapsed);
    this.collapseBtn.innerHTML = s.panelCollapsed ? icons.chevronLeft : icons.chevronRight;
    const label = s.panelCollapsed ? vi.panel.expand : vi.panel.collapse;
    this.collapseBtn.title = label;
    this.collapseBtn.setAttribute('aria-label', label);
    this.collapseBtn.setAttribute('aria-expanded', String(!s.panelCollapsed));
    for (const [level, b] of this.qualityBtns) b.setAttribute('aria-pressed', String(level === s.quality));
    const msaaChanged = (s.quality === 'low') !== (this.startQuality === 'low');
    this.qualityNote.textContent = msaaChanged ? vi.panel.msaaReload : '';
    this.lowPower.set(s.lowPower);
    this.autoRotate.set(s.autoRotate);
    this.footsteps.set(s.footsteps);
    this.sceneOnly.set(s.sceneOnly);
    this.synthFallback.set(s.synthFallback);
    this.enableAudioBtn.hidden = this.deps.mixer.started || s.sceneOnly;
    this.thirdPerson.set(s.walkView === 'third');
    this.startAtDesk.set(s.startAtDesk);
    for (const [mode, b] of this.timeModeBtns) b.setAttribute('aria-pressed', String(mode === s.timeMode));
    this.meteors?.set(s.meteors);
    this.aurora?.set(s.aurora);
    this.stars?.set(s.stars);
    this.fireflies?.set(s.fireflies);
    this.syncSynthStatus();
  }
}

function setMuteIcon(b: HTMLButtonElement, muted: boolean): void {
  b.innerHTML = muted ? icons.speakerOff : icons.speaker;
  const label = muted ? vi.panel.unmute : vi.panel.mute;
  b.title = label;
  b.setAttribute('aria-label', label);
  b.setAttribute('aria-pressed', String(muted));
}
