import { button, el, slider, toggle, type SliderControl, type ToggleControl } from './components';
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
import { PANEL_SECTIONS, type PanelSection, type Settings, type SettingsStore } from '../core/settings';
import { formatClock, formatClockSeconds, TIME_SPEEDS, type TimeSpeed } from '../world/celestial';
import type { ScreenInfo } from '../world/deskScreens';

/** Where the camera is, as the "Góc nhìn" tiles show it. */
export type ViewId = 'orbit' | 'walk' | 'desk' | 'bath';

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
  /** Current sky direction (degrees), stored with presets saved with the time. */
  getSkyTurn: () => number;
  setHours: (hours: number) => void;
  /** Scene, what is playing and the island time (the status line). */
  status: () => ScreenInfo;
  /** The current view, and a way to hear when it changes. */
  view: () => ViewId;
  onViewChange: (fn: () => void) => void;
  /** Goes to a view: orbit, walking, sitting at the desk, in the tub. */
  goTo: (view: ViewId) => void;
  /** Pomodoro: the timer's state for the header button, and showing/hiding its card. */
  pomodoro: () => { remaining: string; running: boolean; visible: boolean } | null;
  /** Stops or restarts the clock (N). */
  toggleTimePaused: () => void;
  togglePomodoro: () => void;
}

const SECTION_ICONS: Readonly<Record<Exclude<PanelSection, ''>, string>> = {
  scene: icons.scene,
  sound: icons.music,
  time: icons.time,
  view: icons.eye,
  settings: icons.settings,
};
const VIEWS: ReadonlyArray<[ViewId, string, string]> = [
  ['orbit', icons.globe, 'C'],
  ['walk', icons.walk, 'C'],
  ['desk', icons.desk, 'B'],
  ['bath', icons.bath, 'E'],
];
/** Status line and header clock refresh rate (ms). */
const TICK_MS = 500;

interface Section {
  root: HTMLDetailsElement;
  body: HTMLElement;
  meta: HTMLElement;
}

/**
 * The control panel. A fixed top: title, the Pomodoro clock button and collapse; a status
 * line (scene · what is playing · island time); master volume. Below, an accordion with one
 * section open at a time (remembered): Cảnh, Âm thanh, Thời gian, Góc nhìn, Cài đặt. Closed
 * sections still show their current value on the right of their title.
 */
export class Panel {
  readonly root: HTMLElement;
  private readonly collapseBtn: HTMLButtonElement;
  private readonly pomoBtn: HTMLButtonElement;
  private readonly pomoText: HTMLElement;
  private readonly statusLine: HTMLElement;
  private readonly masterVolume: SliderControl;
  private readonly masterMute: HTMLButtonElement;
  private readonly sections = new Map<Exclude<PanelSection, ''>, Section>();
  private readonly synthFallback: ToggleControl;
  private readonly synthStatus: HTMLElement;
  private readonly qualityBtns = new Map<QualityLevel, HTMLButtonElement>();
  private readonly qualityNote: HTMLElement;
  private readonly autoRotate: ToggleControl;
  private readonly footsteps: ToggleControl;
  private readonly thirdPerson: ToggleControl;
  private readonly startAtDesk: ToggleControl;
  private readonly startQuality: QualityLevel;
  private readonly speedBtns = new Map<TimeSpeed, HTMLButtonElement>();
  private readonly bigClock: HTMLElement;
  private readonly clockState: HTMLElement;
  private readonly pauseBtn: HTMLButtonElement;
  private readonly realTime: ToggleControl;
  private readonly speedHint: HTMLElement;
  private readonly viewTiles = new Map<ViewId, HTMLButtonElement>();
  private readonly clock: SliderControl;
  private shownMinute = -1;
  private lastTick = -Infinity;

  constructor(parent: HTMLElement, private readonly deps: PanelDeps) {
    const { mixer, settings } = deps;
    const s = settings.get();
    this.startQuality = s.quality;

    this.root = el('aside', 'panel');
    this.root.setAttribute('aria-label', vi.appTitle);

    // --- Fixed top ---
    const header = el('div', 'panel-header');
    const title = el('h1', 'panel-title', vi.appTitle);
    this.pomoBtn = button('', () => deps.togglePomodoro(), 'pomo-btn');
    this.pomoBtn.title = vi.panel.pomodoroBtn;
    this.pomoBtn.setAttribute('aria-label', vi.panel.pomodoroBtn);
    const pomoIcon = el('span', 'pomo-icon');
    pomoIcon.innerHTML = icons.clock;
    this.pomoText = el('span', 'pomo-text');
    this.pomoBtn.append(pomoIcon, this.pomoText);
    this.collapseBtn = button('', () => settings.update({ panelCollapsed: !settings.get().panelCollapsed }), 'icon-btn');
    const headerTools = el('div', 'header-tools');
    headerTools.append(this.pomoBtn, this.collapseBtn);
    header.append(title, headerTools);

    const top = el('div', 'panel-top');
    this.statusLine = el('div', 'status-line');
    const masterRow = el('div', 'mix-row master');
    this.masterVolume = slider(vi.panel.master, mixer.current.master.volume, (v) => mixer.setMaster({ volume: v }));
    this.masterMute = button('', () => mixer.toggleMuteAll(), 'icon-btn');
    masterRow.append(this.masterVolume.root, this.masterMute);
    top.append(this.statusLine, masterRow);

    const content = el('div', 'panel-content');

    // --- Cảnh ---
    const scene = this.section('scene');
    scene.body.append(
      new SceneView({
        settings,
        scenes: deps.scenes,
        applyScene: deps.applyScene,
        onDeleted: deps.onSceneDeleted,
        getHours: deps.getHours,
        getSkyTurn: deps.getSkyTurn,
      }).root,
    );

    // --- Âm thanh ---
    const sound = this.section('sound');
    this.synthFallback = toggle(vi.panel.synthFallbackLong, s.synthFallback, (on) => settings.update({ synthFallback: on }));
    this.synthStatus = el('div', 'hint');
    const library = new LibraryView({
      library: deps.library,
      scenes: deps.scenes,
      startAudio: deps.startAudio,
      applyScene: deps.applyScene,
      clearScene: () => settings.update({ activeScene: '' }),
    });
    const synthRow = el('div', 'option-list');
    synthRow.append(this.synthFallback.root);
    sound.body.append(library.root, synthRow, this.synthStatus);

    // --- Thời gian ---
    const time = this.section('time');
    // A big hh:mm:ss clock with its state, and the stop/run button.
    const face = el('div', 'clock-face');
    const faceText = el('div', 'clock-text');
    this.bigClock = el('div', 'clock-big');
    this.clockState = el('div', 'hint');
    faceText.append(this.bigClock, this.clockState);
    this.pauseBtn = button('', () => deps.toggleTimePaused(), 'btn small clock-pause');
    this.pauseBtn.title = vi.panel.pauseTitle;
    face.append(faceText, this.pauseBtn);
    this.realTime = toggle(vi.panel.realTime, s.timeMode === 'real', (on) =>
      settings.update(on ? { timeMode: 'real' } : { timeMode: 'free', timePaused: false }),
    );
    const realRow = el('div', 'option-list');
    realRow.append(this.realTime.root);
    // Dragging the clock: the island clock runs on from the chosen time.
    this.clock = slider(vi.panel.time, deps.getHours(), (h) => {
      const c = settings.get();
      if (c.timeMode === 'real' || c.timePaused) settings.update({ timeMode: 'free', timePaused: false });
      deps.setHours(h);
    }, { min: 0, max: 23.99, step: 0.05, format: formatClock });
    this.clock.root.title = vi.panel.timeDragHint;
    // Speeds: picking one runs the island clock at that speed from the current time.
    const speed = el('div', 'seg-group five');
    speed.setAttribute('role', 'group');
    speed.setAttribute('aria-label', vi.panel.speed);
    for (const v of TIME_SPEEDS) {
      const b = button(`×${v}`, () => settings.update({ timeMode: 'free', timeSpeed: v, timePaused: false }), 'seg');
      b.title = vi.panel.speedHints[v];
      this.speedBtns.set(v, b);
      speed.append(b);
    }
    this.speedHint = el('div', 'hint');
    time.body.append(face, realRow, this.clock.root, el('div', 'subhead', vi.panel.speed), speed, this.speedHint);

    // --- Góc nhìn ---
    const view = this.section('view');
    const tiles = el('div', 'view-grid');
    for (const [id, icon, key] of VIEWS) {
      const t = button('', () => deps.goTo(id), 'view-tile');
      const i = el('span', 'view-icon');
      i.innerHTML = icon;
      t.append(i, el('span', 'view-name', vi.panel.views[id]), el('kbd', 'key', key));
      this.viewTiles.set(id, t);
      tiles.append(t);
    }
    this.thirdPerson = toggle(vi.panel.thirdPerson.replace(' (V)', ''), s.walkView === 'third', (on) => settings.update({ walkView: on ? 'third' : 'first' }));
    this.footsteps = toggle(vi.panel.footsteps, s.footsteps, (on) => settings.update({ footsteps: on }));
    this.autoRotate = toggle(vi.panel.autoRotate, s.autoRotate, (on) => settings.update({ autoRotate: on }));
    const viewOpts = el('div', 'option-list');
    viewOpts.append(withKey(this.thirdPerson.root, 'V'), this.footsteps.root, this.autoRotate.root);
    view.body.append(tiles, el('div', 'subhead', vi.panel.viewOptions), viewOpts);

    // --- Cài đặt ---
    const conf = this.section('settings');
    const quality = el('div', 'seg-group three');
    for (const level of QUALITY_LEVELS) {
      const b = button(vi.panel.qualityNames[level], () => settings.update({ quality: level }), 'seg');
      this.qualityBtns.set(level, b);
      quality.append(b);
    }
    this.qualityNote = el('div', 'note');
    this.startAtDesk = toggle(vi.desk.startAtDesk, s.startAtDesk, (on) => settings.update({ startAtDesk: on }));
    const confOpts = el('div', 'option-list');
    confOpts.append(this.startAtDesk.root);
    const keys = el('details', 'subsection');
    const keysTitle = el('summary', 'subsection-title', vi.panel.shortcuts);
    const list = el('dl', 'shortcut-list');
    for (const sc of deps.keymap.list()) list.append(el('dt', '', sc.keyLabel), el('dd', '', sc.label));
    const keysBody = el('div', 'section-body');
    keysBody.append(list, el('div', 'hint', vi.shortcuts.mouse), el('div', 'hint', vi.shortcuts.walkKeys));
    keys.append(keysTitle, keysBody);
    conf.body.append(el('div', 'subhead', vi.panel.quality), quality, this.qualityNote, confOpts, keys);

    content.append(...[...this.sections.values()].map((x) => x.root));
    this.root.append(header, top, content);
    parent.append(this.root);

    mixer.onChange((state) => this.syncMixer(state));
    settings.onChange((next) => this.syncSettings(next));
    deps.library.onChange(() => this.syncSynthStatus());
    deps.onViewChange(() => this.syncView());
    this.syncMixer(mixer.current);
    this.syncSettings(s);
    this.syncView();
    // The status line fills on the first frame (tick), once the app has built everything.
  }

  /** One accordion section: icon, title, the current value on the right, a body. */
  private section(id: Exclude<PanelSection, ''>): Section {
    const root = el('details', 'section');
    const summary = el('summary', 'section-title');
    const icon = el('span', 'section-icon');
    icon.innerHTML = SECTION_ICONS[id];
    const meta = el('span', 'section-meta');
    summary.append(icon, el('span', 'section-name', vi.panel.sections[id]), meta);
    const body = el('div', 'section-body');
    root.append(summary, body);
    // Opening one closes the others; the open one is remembered.
    root.addEventListener('toggle', () => {
      const current = this.deps.settings.get().panelSection;
      if (root.open && current !== id) this.deps.settings.update({ panelSection: id });
      else if (!root.open && current === id) this.deps.settings.update({ panelSection: '' });
    });
    const s: Section = { root, body, meta };
    this.sections.set(id, s);
    return s;
  }

  /**
   * Called every frame; refreshes the status line, the Pomodoro clock and the section values
   * a couple of times a second, touching the DOM only when the text changes.
   */
  tick(now: number): void {
    setText(this.bigClock, formatClockSeconds(this.deps.getHours()));
    const minute = Math.floor(this.deps.getHours() * 60);
    if (minute !== this.shownMinute && document.activeElement !== this.clock.input) {
      this.shownMinute = minute;
      this.clock.set(this.deps.getHours());
    }
    if (now - this.lastTick < TICK_MS) return;
    this.lastTick = now;
    const info = this.deps.status();
    const muted = this.deps.mixer.current.master.muted;
    const scene = info.scene || vi.panel.status.noScene;
    const playing = muted ? vi.panel.status.muted : info.playing;
    setText(this.statusLine, `${scene}  ·  ♪ ${playing}  ·  ${info.islandTime}`);
    setText(this.meta('scene'), scene);
    setText(this.meta('sound'), muted ? vi.panel.status.muted : info.playing);
    setText(this.meta('time'), info.islandTime);
    const p = this.deps.pomodoro();
    setText(this.pomoText, p ? p.remaining : '');
    this.pomoBtn.classList.toggle('running', !!p?.running);
    this.pomoBtn.setAttribute('aria-pressed', String(!!p?.visible));
  }

  private meta(id: Exclude<PanelSection, ''>): HTMLElement {
    const s = this.sections.get(id);
    if (!s) throw new Error(`Panel: no section ${id}`);
    return s.meta;
  }

  private syncMixer(state: Readonly<MixerState>): void {
    this.masterVolume.set(state.master.volume);
    setMuteIcon(this.masterMute, state.master.muted);
    this.syncSynthStatus();
    this.lastTick = -Infinity;
  }

  private syncSynthStatus(): void {
    const s = this.deps.settings.get();
    this.synthStatus.hidden = !this.deps.mixer.started || !s.synthFallback;
    this.synthStatus.textContent = this.deps.library.audible ? vi.panel.synthIdle : vi.panel.synthPlaying;
    this.lastTick = -Infinity;
  }

  private syncView(): void {
    const current = this.deps.view();
    for (const [id, t] of this.viewTiles) t.setAttribute('aria-pressed', String(id === current));
    setText(this.meta('view'), vi.panel.views[current]);
  }

  private syncSettings(s: Readonly<Settings>): void {
    this.root.classList.toggle('collapsed', s.panelCollapsed);
    this.collapseBtn.innerHTML = s.panelCollapsed ? icons.chevronLeft : icons.chevronRight;
    const label = s.panelCollapsed ? vi.panel.expand : vi.panel.collapse;
    this.collapseBtn.title = label;
    this.collapseBtn.setAttribute('aria-label', label);
    this.collapseBtn.setAttribute('aria-expanded', String(!s.panelCollapsed));
    for (const id of PANEL_SECTIONS) {
      const sec = this.sections.get(id);
      if (sec && sec.root.open !== (s.panelSection === id)) sec.root.open = s.panelSection === id;
    }
    for (const [level, b] of this.qualityBtns) b.setAttribute('aria-pressed', String(level === s.quality));
    const msaaChanged = (s.quality === 'low') !== (this.startQuality === 'low');
    this.qualityNote.textContent = msaaChanged ? vi.panel.msaaReload : '';
    this.autoRotate.set(s.autoRotate);
    this.footsteps.set(s.footsteps);
    this.synthFallback.set(s.synthFallback);
    this.thirdPerson.set(s.walkView === 'third');
    this.startAtDesk.set(s.startAtDesk);
    const real = s.timeMode === 'real';
    const stopped = !real && s.timePaused;
    this.realTime.set(real);
    for (const [v, b] of this.speedBtns) b.setAttribute('aria-pressed', String(!real && v === s.timeSpeed));
    this.speedHint.textContent = real ? vi.panel.speedHints[1] : vi.panel.speedHints[s.timeSpeed];
    this.clockState.textContent = real
      ? vi.panel.clockReal
      : stopped
        ? vi.panel.clockPaused
        : vi.panel.clockFree(`×${s.timeSpeed}`);
    this.pauseBtn.innerHTML = `${stopped ? icons.play : icons.pause}<span>${stopped ? vi.panel.resume : vi.panel.pause}</span>`;
    this.pauseBtn.setAttribute('aria-pressed', String(stopped));
    this.syncSynthStatus();
  }
}

/** A toggle with its keyboard shortcut shown as a key cap on the right. */
function withKey(control: HTMLElement, key: string): HTMLElement {
  control.append(el('kbd', 'key', key));
  return control;
}

function setText(e: HTMLElement, text: string): void {
  if (e.textContent !== text) e.textContent = text;
}

function setMuteIcon(b: HTMLButtonElement, muted: boolean): void {
  b.innerHTML = muted ? icons.speakerOff : icons.speaker;
  const label = muted ? vi.panel.unmute : vi.panel.mute;
  b.title = label;
  b.setAttribute('aria-label', label);
  b.setAttribute('aria-pressed', String(muted));
}
