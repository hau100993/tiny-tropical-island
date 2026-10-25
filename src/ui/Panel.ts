import { button, el, onWheelNotch, slider, toggle, VOLUME, type SliderControl, type ToggleControl } from './components';
import { icons } from './icons';
import { vi } from './strings.vi';
import { LibraryView } from './LibraryView';
import { SceneView } from './SceneView';
import type { Mixer } from '../audio/mixer';
import type { MixerState } from '../audio/types';
import type { SoundLibrary } from '../audio/library/SoundLibrary';
import { isTyping, type Keymap } from '../controls/keymap';
import { QUALITY_LEVELS, type QualityLevel } from '../core/quality';
import type { ScenePresetStore } from '../core/scenePresets';
import { CHARACTER_IDS, PANEL_SECTIONS, type CharacterId, type PanelSection, type Settings, type SettingsStore } from '../core/settings';
import { formatClock } from '../world/celestial';
import { nextSpeed } from './timeSpeed';
import type { Fullscreen } from './fullscreen';
import type { ScreenInfo } from '../world/deskScreens';

/** Where the camera is, as the "Góc nhìn" tiles show it. */
export type ViewId = 'orbit' | 'walk' | 'desk' | 'bath' | 'hammock';

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
  /** Current sky direction (degrees). */
  getSkyTurn: () => number;
  /** Scene editor preview: show this time and sky turn (degrees). */
  setSky: (hours: number, skyTurn: number) => void;
  /** Sky turn (degrees) that brings this hour's sun or moon into the desk window. */
  windowTurn: (hours: number) => number;
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
  /** Full screen (F): the header button toggles it and shows its state. */
  fullscreen: Fullscreen;
}

const SECTION_ICONS: Readonly<Record<PanelSection, string>> = {
  scene: icons.scene,
  sound: icons.music,
  view: icons.eye,
  settings: icons.settings,
};
const VIEWS: ReadonlyArray<[ViewId, string, string]> = [
  ['orbit', icons.globe, 'C'],
  ['walk', icons.walk, 'C'],
  ['desk', icons.desk, 'B'],
  ['bath', icons.bath, 'E'],
  ['hammock', icons.hammock, 'E'],
];
/** Status line and header clock refresh rate (ms). */
const TICK_MS = 500;
/**
 * Tucked away (walking, or the UI hidden with H): it closes this long (ms) after the pointer
 * leaves; walking, the faded panel then fades out completely after SLEEP_MS more. Pointing at
 * the top-right corner (CORNER_W × CORNER_H px) brings it back.
 */
const CLOSE_MS = 600;
const SLEEP_MS = 5000;
const CORNER_W = 200;
const CORNER_H = 120;

interface Section {
  root: HTMLDetailsElement;
  body: HTMLElement;
  meta: HTMLElement;
}

/**
 * The control panel. A fixed top: title, the Pomodoro clock button and collapse; a status
 * line (scene · what is playing · island time); master volume. Below, sections that open and
 * close on their own (remembered; Cảnh and Góc nhìn open on first launch): Cảnh, Âm thanh,
 * Thời gian, Góc nhìn, Cài đặt. Closed sections still show their current value on the right of
 * their title. Clicking the title collapses or expands the whole panel.
 */
export class Panel {
  readonly root: HTMLElement;
  private readonly collapseBtn: HTMLButtonElement;
  private readonly titleBtn: HTMLButtonElement;
  /** Shown only while the panel is collapsed: the scene's name and a mute button. */
  private readonly headerScene: HTMLElement;
  private readonly headerMute: HTMLButtonElement;
  private readonly startBtn: HTMLButtonElement;
  private readonly autoCollapse: ToggleControl;
  private readonly mouseSpeed: SliderControl;
  private readonly pomoBtn: HTMLButtonElement;
  private readonly pomoText: HTMLElement;
  private readonly statusLine: HTMLElement;
  private readonly masterVolume: SliderControl;
  private readonly masterMute: HTMLButtonElement;
  private readonly sections = new Map<PanelSection, Section>();
  private readonly synthFallback: ToggleControl;
  private readonly synthStatus: HTMLElement;
  private readonly qualityBtns = new Map<QualityLevel, HTMLButtonElement>();
  private readonly characterBtns = new Map<CharacterId, HTMLButtonElement>();
  private readonly qualityNote: HTMLElement;
  private readonly autoRotate: ToggleControl;
  private readonly footsteps: ToggleControl;
  private readonly thirdPerson: ToggleControl;
  private readonly startAtDesk: ToggleControl;
  private readonly startQuality: QualityLevel;
  private readonly bigClock: HTMLElement;
  /** Running / stopped / real clock, as a small dot before the time (its tooltip says which). */
  private readonly clockDot: HTMLElement;
  private readonly clockFace: HTMLElement;
  private readonly pauseBtn: HTMLButtonElement;
  private readonly speedBtn: HTMLButtonElement;
  private readonly realBtn: HTMLButtonElement;
  private readonly viewTiles = new Map<ViewId, HTMLButtonElement>();
  private readonly clock: SliderControl;
  private shownMinute = -1;
  private lastTick = -Infinity;
  /** Walking, paddling or surfing: collapsed and faded unless pointed at (`peek`). */
  private walking = false;
  /** The UI is hidden (H): the panel only shows while pointed at, from the top-right corner. */
  private uiHidden = false;
  /** Just opened: tucked away as when walking, until the panel is clicked or P pressed (endIntro). */
  private intro = true;
  private peek = false;
  /** Walking, left alone SLEEP_MS: faded out completely until the corner is pointed at. */
  private asleep = false;
  /** A press inside the panel is held (dragging a slider): it stays open. */
  private held = false;
  private closeTimer = 0;
  private sleepTimer = 0;
  /** Called whenever it opens, closes or fades (what sits under it follows: dockRect). */
  onLayout: (() => void) | null = null;

  constructor(parent: HTMLElement, private readonly deps: PanelDeps) {
    const { mixer, settings } = deps;
    const s = settings.get();
    this.startQuality = s.quality;

    this.root = el('aside', 'panel');
    this.root.setAttribute('aria-label', vi.appTitle);
    // Tucked away: pointing at the panel (or at the top-right corner, where it waits even when
    // out of sight) opens it; leaving closes it again after a moment, unless a slider is still
    // being dragged or you are typing in it.
    this.root.addEventListener('pointerenter', () => this.open());
    window.addEventListener('pointermove', (e) => {
      if (!this.tucked || this.peek || e.buttons !== 0) return;
      // Over the activity card under the menu bar: that isn't the corner.
      if (e.target instanceof Element && e.target.closest('[data-no-corner]')) return;
      if (e.clientX > window.innerWidth - CORNER_W && e.clientY < CORNER_H) {
        this.open();
        // Opened from the corner without entering it: it closes again unless pointed at.
        this.scheduleClose();
      }
    });
    this.root.addEventListener('pointerleave', () => this.scheduleClose());
    this.root.addEventListener('focusout', () => this.scheduleClose());
    this.root.addEventListener('pointerdown', () => {
      this.held = true;
    });
    window.addEventListener('pointerup', () => {
      if (!this.held) return;
      this.held = false;
      this.scheduleClose();
    });
    // The page opens with the scene in front: the panel waits tucked away (styles:
    // body.panel-intro) until something in it is clicked.
    document.body.classList.add('panel-intro');
    this.root.addEventListener('click', () => this.endIntro());

    // --- Fixed top ---
    const header = el('div', 'panel-header');
    const title = el('h1', 'panel-title');
    this.titleBtn = button(vi.appTitle, () => this.toggle(), 'panel-title-btn');
    title.append(this.titleBtn);
    this.pomoBtn = button('', () => deps.togglePomodoro(), 'pomo-btn');
    this.pomoBtn.title = vi.panel.pomodoroBtn;
    this.pomoBtn.setAttribute('aria-label', vi.panel.pomodoroBtn);
    const pomoIcon = el('span', 'pomo-icon');
    pomoIcon.innerHTML = icons.clock;
    this.pomoText = el('span', 'pomo-text');
    this.pomoBtn.append(pomoIcon, this.pomoText);
    const fsBtn = button('', () => deps.fullscreen.toggle(), 'icon-btn fs-btn');
    const syncFs = (on: boolean): void => {
      fsBtn.innerHTML = on ? icons.minimize : icons.maximize;
      const label = on ? vi.panel.fullscreenOff : vi.panel.fullscreenOn;
      fsBtn.title = label;
      fsBtn.setAttribute('aria-label', label);
    };
    syncFs(deps.fullscreen.active);
    deps.fullscreen.onChange(syncFs);
    this.collapseBtn = button('', () => this.toggle(), 'icon-btn');
    this.headerScene = el('span', 'header-scene');
    this.headerMute = button('', () => mixer.toggleMuteAll(), 'icon-btn header-mute');
    const headerTools = el('div', 'header-tools');
    headerTools.append(this.headerMute, this.pomoBtn, fsBtn, this.collapseBtn);
    header.append(title, this.headerScene, headerTools);

    const top = el('div', 'panel-top');
    this.statusLine = el('div', 'status-line');
    const masterRow = el('div', 'mix-row master');
    this.masterVolume = slider(vi.panel.master, mixer.current.master.volume, (v) => mixer.setMaster({ volume: v }), { ...VOLUME, defaultValue: 0.8 });
    this.masterMute = button('', () => mixer.toggleMuteAll(), 'icon-btn');
    masterRow.append(this.masterVolume.root, this.masterMute);
    // Browsers allow sound only after a click or key press: until then, say so right here.
    this.startBtn = button('', () => deps.startAudio(), 'btn primary start-sound');
    this.startBtn.innerHTML = `${icons.speaker}<span>${vi.panel.startSound}</span>`;
    this.startBtn.title = vi.panel.startSoundHint;
    top.append(this.statusLine, this.startBtn, masterRow);

    const content = el('div', 'panel-content');

    // --- Cảnh ---
    const scene = this.section('scene');
    scene.body.append(
      new SceneView({
        settings,
        scenes: deps.scenes,
        library: deps.library,
        applyScene: deps.applyScene,
        onDeleted: deps.onSceneDeleted,
        startAudio: deps.startAudio,
        getHours: deps.getHours,
        getSkyTurn: deps.getSkyTurn,
        setSky: deps.setSky,
        windowTurn: deps.windowTurn,
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
    // Always shown above the sections, nothing to open: the hh:mm clock with three icon buttons
    // (stop/run, speed, the computer's clock), and the hour slider painted with the colours of
    // the day. Labels live in tooltips.
    const time = el('div', 'time-bar');
    this.clockFace = el('div', 'clock-face');
    const clockMain = el('div', 'clock-main');
    this.clockDot = el('span', 'clock-dot');
    this.bigClock = el('span', 'clock-big');
    clockMain.append(this.clockDot, this.bigClock);
    this.pauseBtn = button('', () => deps.toggleTimePaused(), 'icon-btn clock-tool');
    this.pauseBtn.title = vi.panel.pauseTitle;
    this.pauseBtn.setAttribute('aria-label', vi.panel.pauseTitle);
    this.speedBtn = button('', () => undefined, 'clock-tool speed-btn');
    // Click: one speed up (round and round); Shift + click: one down.
    this.speedBtn.addEventListener('click', (e) => this.stepSpeed(e.shiftKey ? -1 : 1, true));
    // Wheel: up faster, down slower (stops at the ends).
    onWheelNotch(this.speedBtn, () => true, (dir) => this.stepSpeed(dir, false));
    this.realBtn = button('', () => {
      settings.update(settings.get().timeMode === 'real' ? { timeMode: 'free', timePaused: false } : { timeMode: 'real' });
    }, 'icon-btn clock-tool real-btn');
    this.realBtn.innerHTML = icons.realClock;
    this.realBtn.setAttribute('aria-label', vi.panel.realTime);
    const tools = el('div', 'clock-tools');
    tools.append(this.pauseBtn, this.speedBtn, this.realBtn);
    this.clockFace.append(clockMain, tools);
    // Dragging the clock: the island clock runs on from the chosen time.
    this.clock = slider(vi.panel.time, deps.getHours(), (h) => {
      const c = settings.get();
      if (c.timeMode === 'real' || c.timePaused) settings.update({ timeMode: 'free', timePaused: false });
      deps.setHours(h);
    }, { min: 0, max: 23.99, step: 0.05, wheelStep: 0.25, wrap: 24, format: formatClock, dragBubble: true });
    this.clock.root.classList.add('day-slider');
    this.clock.root.title = vi.panel.timeDragHint;
    this.clock.input.setAttribute('aria-label', vi.panel.time);
    time.append(this.clockFace, this.clock.root);

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
    viewOpts.append(
      withKey(this.thirdPerson.root, 'V'),
      this.footsteps.root,
      this.autoRotate.root,
    );
    const characters = el('div', 'seg-group three');
    for (const id of CHARACTER_IDS) {
      const b = button(vi.panel.characterNames[id], () => settings.update({ character: id }), 'seg');
      this.characterBtns.set(id, b);
      characters.append(b);
    }
    view.body.append(tiles, el('div', 'subhead', vi.panel.viewOptions), viewOpts, el('div', 'subhead', vi.panel.character), characters);

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
    this.autoCollapse = toggle(vi.panel.autoCollapse, s.autoCollapse, (on) => settings.update({ autoCollapse: on }));
    const confOpts = el('div', 'option-list');
    confOpts.append(this.startAtDesk.root, this.autoCollapse.root);
    this.mouseSpeed = slider(vi.panel.mouseSpeed, s.mouseSpeed, (v) => settings.update({ mouseSpeed: v }));
    this.mouseSpeed.root.title = vi.panel.mouseSpeedHint;
    const keys = el('details', 'subsection');
    const keysTitle = el('summary', 'subsection-title', vi.panel.shortcuts);
    const list = el('dl', 'shortcut-list');
    for (const sc of deps.keymap.list()) list.append(el('dt', '', sc.keyLabel), el('dd', '', sc.label));
    const keysBody = el('div', 'section-body');
    keysBody.append(list, el('div', 'hint', vi.shortcuts.mouse), el('div', 'hint', vi.shortcuts.sliderWheel), el('div', 'hint', vi.shortcuts.sceneKeys), el('div', 'hint', vi.shortcuts.walkKeys), el('div', 'hint', vi.shortcuts.swimKeys), el('div', 'hint', vi.shortcuts.diveKeys), el('div', 'hint', vi.shortcuts.kayakKeys), el('div', 'hint', vi.shortcuts.surfKeys));
    keys.append(keysTitle, keysBody);
    conf.body.append(el('div', 'subhead', vi.panel.quality), quality, this.qualityNote, confOpts, this.mouseSpeed.root, keys);

    content.append(time, ...[...this.sections.values()].map((x) => x.root));
    this.root.append(header, top, content);
    // Out of sight (walking and left alone, or the UI hidden with H): only a small round handle
    // stays where the bar was (styles: .panel.handle); pointing at it opens the panel.
    const handle = el('span', 'panel-handle');
    handle.innerHTML = icons.menu;
    this.root.append(handle);
    parent.append(this.root);

    mixer.onChange((state) => this.syncMixer(state));
    settings.onChange((next) => this.syncSettings(next));
    deps.library.onChange(() => this.syncSynthStatus());
    deps.onViewChange(() => this.syncView());
    this.syncMixer(mixer.current);
    this.syncSettings(s);
    this.syncView();
    this.watchSceneClicks();
    // The status line fills on the first frame (tick), once the app has built everything.
  }

  /**
   * "Nhấp vào cảnh 3D để thu gọn bảng": a click on the 3D view (pressed and released almost
   * in place, so orbit drags don't count) collapses the panel.
   */
  private watchSceneClicks(): void {
    let down: { x: number; y: number } | null = null;
    window.addEventListener('pointerdown', (e) => {
      down = e.button === 0 && e.target instanceof HTMLCanvasElement ? { x: e.clientX, y: e.clientY } : null;
    }, { capture: true });
    window.addEventListener('pointerup', (e) => {
      const s = this.deps.settings.get();
      if (!down || !s.autoCollapse || s.panelCollapsed) return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) this.deps.settings.update({ panelCollapsed: true });
      down = null;
    }, { capture: true });
  }

  /**
   * The speed button. `wrap` (click): past the fastest back to ×1; the wheel stops at the ends.
   * On the computer's clock, the first click switches to the island clock at the speed shown.
   */
  private stepSpeed(dir: 1 | -1, wrap: boolean): void {
    const { settings } = this.deps;
    const s = settings.get();
    if (s.timeMode === 'real') {
      settings.update({ timeMode: 'free', timePaused: false });
      return;
    }
    const next = nextSpeed(s.timeSpeed, dir, wrap);
    if (next !== s.timeSpeed || s.timePaused) settings.update({ timeSpeed: next, timePaused: false });
  }

  /**
   * Walking, paddling or surfing (`on`): the panel stays out of the scene, collapsed and faded
   * in its corner (styles: body.walking .panel), and out of sight after SLEEP_MS, until you
   * point at it or at the corner. Your own collapsed setting is kept for the overview.
   */
  setWalking(on: boolean): void {
    if (on === this.walking) return;
    this.walking = on;
    this.retuck();
  }

  /** The UI hidden with H (`on`): the panel shows only while pointed at, from the top-right corner. */
  setUiHidden(on: boolean): void {
    if (on === this.uiHidden) return;
    this.uiHidden = on;
    this.retuck();
  }

  private get tucked(): boolean {
    return this.walking || this.uiHidden || this.intro;
  }

  /** The first frame is up: the tucked panel goes out of sight SLEEP_MS from now, in view. */
  sceneShown(): void {
    this.scheduleSleep();
  }

  /**
   * Ends the opening tuck (a click in the panel, or P): from then on it opens and collapses as
   * usual in the overview. False if it had already ended.
   */
  endIntro(): boolean {
    if (!this.intro) return false;
    this.intro = false;
    document.body.classList.remove('panel-intro');
    const { settings } = this.deps;
    if (settings.get().panelCollapsed) settings.update({ panelCollapsed: false });
    this.retuck();
    return true;
  }

  private retuck(): void {
    this.peek = false;
    this.asleep = false;
    window.clearTimeout(this.closeTimer);
    this.syncCollapsed();
    this.scheduleSleep();
  }

  private open(): void {
    if (!this.tucked) return;
    window.clearTimeout(this.closeTimer);
    window.clearTimeout(this.sleepTimer);
    this.asleep = false;
    this.peek = true;
    this.syncCollapsed();
  }

  private scheduleClose(): void {
    if (!this.tucked || !this.peek) return;
    window.clearTimeout(this.closeTimer);
    this.closeTimer = window.setTimeout(() => {
      if (this.held || this.root.matches(':hover') || (isTyping(document.activeElement) && this.root.contains(document.activeElement))) return;
      this.peek = false;
      this.syncCollapsed();
      this.scheduleSleep();
    }, CLOSE_MS);
  }

  /** Walking (or just opened): the faded panel goes out of sight after SLEEP_MS left alone. */
  private scheduleSleep(): void {
    window.clearTimeout(this.sleepTimer);
    if (!(this.walking || this.intro) || this.peek) return;
    this.sleepTimer = window.setTimeout(() => {
      if (!(this.walking || this.intro) || this.peek) return;
      this.asleep = true;
      this.syncCollapsed();
    }, SLEEP_MS);
  }

  /** Collapsed: your setting in the overview; tucked away, unless pointed at. */
  private syncCollapsed(): void {
    const tucked = this.tucked;
    this.root.classList.toggle('collapsed', tucked ? !this.peek : this.deps.settings.get().panelCollapsed);
    this.root.classList.toggle('peek', tucked && this.peek);
    this.root.classList.toggle('handle', tucked && !this.peek && (this.asleep || this.uiHidden));
    // The button shows what a press does to the panel as it is now (tucked away while walking,
    // that isn't the setting).
    const shut = this.root.classList.contains('collapsed');
    const label = shut ? vi.panel.expand : vi.panel.collapse;
    this.collapseBtn.innerHTML = shut ? icons.chevronLeft : icons.chevronRight;
    this.collapseBtn.title = label;
    this.collapseBtn.setAttribute('aria-label', label);
    this.collapseBtn.setAttribute('aria-expanded', String(!shut));
    this.titleBtn.title = label;
    this.titleBtn.setAttribute('aria-expanded', String(!shut));
    this.onLayout?.();
  }

  /**
   * Where something can sit (px): under the menu bar or the handle, as wide as the bar (width 0:
   * keep the last); in the overview, beside the open panel at the top; null while the panel is
   * open over it.
   */
  dockRect(): { top: number; right: number; width: number } | null {
    if (this.tucked && this.peek) return null;
    const r = this.root.getBoundingClientRect();
    if (!this.tucked) return { top: 12, right: window.innerWidth - r.left + 12, width: 0 };
    const handle = this.asleep || this.uiHidden;
    return { top: r.bottom + 8, right: 12, width: handle ? 0 : r.width };
  }

  /**
   * The collapse button, the title, P: shuts the panel if it is open, opens it if shut. In the
   * overview that is the setting; tucked away (walking, the UI hidden) it closes the peek at once
   * or opens it (it used to flip the setting, which a tucked panel ignores: nothing happened).
   */
  toggle(): void {
    const open = !this.root.classList.contains('collapsed');
    if (this.intro) {
      // The first press ends the opening tuck: the panel comes out (or stays shut if it was out).
      this.endIntro();
      if (open) this.deps.settings.update({ panelCollapsed: true });
      return;
    }
    if (this.tucked) {
      if (open) {
        window.clearTimeout(this.closeTimer);
        this.peek = false;
        this.syncCollapsed();
        this.scheduleSleep();
      } else {
        this.open();
        this.scheduleClose();
      }
      return;
    }
    this.deps.settings.update({ panelCollapsed: open });
  }

  /** One section: icon, title, the current value on the right, a body. */
  private section(id: PanelSection): Section {
    const root = el('details', 'section');
    const summary = el('summary', 'section-title');
    const icon = el('span', 'section-icon');
    icon.innerHTML = SECTION_ICONS[id];
    const meta = el('span', 'section-meta');
    summary.append(icon, el('span', 'section-name', vi.panel.sections[id]), meta);
    const body = el('div', 'section-body');
    root.append(summary, body);
    // Each section opens and closes on its own; the open ones are remembered.
    root.addEventListener('toggle', () => {
      const open = this.deps.settings.get().panelSections;
      if (root.open === open.includes(id)) return;
      this.deps.settings.update({
        panelSections: root.open ? PANEL_SECTIONS.filter((x) => x === id || open.includes(x)) : open.filter((x) => x !== id),
      });
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
    const minute = Math.floor(this.deps.getHours() * 60);
    // The clock string changes once a minute (and no string is built in between).
    if (minute !== this.shownMinute) {
      this.shownMinute = minute;
      setText(this.bigClock, formatClock(this.deps.getHours()));
      if (document.activeElement !== this.clock.input) this.clock.set(this.deps.getHours());
    }
    // The slider's thumb is a sun by day (06–18 h), a moon by night.
    const h = this.deps.getHours();
    this.clock.root.classList.toggle('night', h < 6 || h >= 18);
    if (now - this.lastTick < TICK_MS) return;
    this.lastTick = now;
    const info = this.deps.status();
    const muted = this.deps.mixer.current.master.muted;
    const scene = info.scene || vi.panel.status.noScene;
    const playing = muted ? vi.panel.status.muted : info.playing;
    setText(this.statusLine, `${scene}  ·  ♪ ${playing}  ·  ${info.islandTime}`);
    setText(this.meta('scene'), scene);
    setText(this.headerScene, scene);
    setText(this.meta('sound'), muted ? vi.panel.status.muted : info.playing);
    const p = this.deps.pomodoro();
    setText(this.pomoText, p ? p.remaining : '');
    this.pomoBtn.classList.toggle('running', !!p?.running);
    this.pomoBtn.setAttribute('aria-pressed', String(!!p?.visible));
  }

  private meta(id: PanelSection): HTMLElement {
    const s = this.sections.get(id);
    if (!s) throw new Error(`Panel: no section ${id}`);
    return s.meta;
  }

  private syncMixer(state: Readonly<MixerState>): void {
    this.masterVolume.set(state.master.volume);
    setMuteIcon(this.masterMute, state.master.muted);
    setMuteIcon(this.headerMute, state.master.muted);
    this.startBtn.hidden = this.deps.mixer.started;
    this.root.classList.toggle('sound-off', !this.deps.mixer.started);
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
    this.syncCollapsed();
    for (const id of PANEL_SECTIONS) {
      const sec = this.sections.get(id);
      const open = s.panelSections.includes(id);
      if (sec && sec.root.open !== open) sec.root.open = open;
    }
    for (const [level, b] of this.qualityBtns) b.setAttribute('aria-pressed', String(level === s.quality));
    for (const [id, b] of this.characterBtns) b.setAttribute('aria-pressed', String(id === s.character));
    const msaaChanged = (s.quality === 'low') !== (this.startQuality === 'low');
    this.qualityNote.textContent = msaaChanged ? vi.panel.msaaReload : '';
    this.autoRotate.set(s.autoRotate);
    this.footsteps.set(s.footsteps);
    this.synthFallback.set(s.synthFallback);
    this.thirdPerson.set(s.walkView === 'third');
    this.startAtDesk.set(s.startAtDesk);
    this.autoCollapse.set(s.autoCollapse);
    this.mouseSpeed.set(s.mouseSpeed);
    const real = s.timeMode === 'real';
    const stopped = !real && s.timePaused;
    // Real clock: the monitor icon is lit; the speed shows the island speed, dimmed.
    this.realBtn.setAttribute('aria-pressed', String(real));
    this.realBtn.title = real ? vi.panel.realTimeOn : vi.panel.realTime;
    this.speedBtn.textContent = `×${s.timeSpeed}`;
    this.speedBtn.classList.toggle('inactive', real);
    this.speedBtn.title = real ? vi.panel.speedFromReal : vi.panel.speedTitle(vi.panel.speedHints[s.timeSpeed]);
    this.speedBtn.setAttribute('aria-label', `${vi.panel.speed} ×${s.timeSpeed}`);
    this.pauseBtn.innerHTML = stopped ? icons.play : icons.pause;
    this.pauseBtn.setAttribute('aria-pressed', String(stopped));
    // The dot and its tooltip replace the old state line under the clock.
    const state = real ? vi.panel.clockReal : stopped ? vi.panel.clockPaused : vi.panel.clockFree(`×${s.timeSpeed}`);
    this.clockFace.dataset.state = real ? 'real' : stopped ? 'paused' : 'running';
    this.clockDot.title = state;
    this.bigClock.title = state;
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
