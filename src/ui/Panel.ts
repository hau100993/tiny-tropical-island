import { button, el, onWheelNotch, slider, toggle, VOLUME, type SliderControl, type ToggleControl } from './components';
import { icons } from './icons';
import { backupControls } from './backupControls';
import { vi } from './strings.vi';
import { LibraryView } from './LibraryView';
import { SceneView } from './SceneView';
import type { Mixer } from '../audio/mixer';
import type { MixerState } from '../audio/types';
import type { SoundLibrary } from '../audio/library/SoundLibrary';
import { isTyping, type Keymap } from '../controls/keymap';
import { QUALITY_LEVELS, type QualityLevel } from '../core/quality';
import type { ScenePresetStore } from '../core/scenePresets';
import { CHARACTER_IDS, PANEL_TABS, type CharacterId, type PanelTab, type Settings, type SettingsStore } from '../core/settings';
import type { WalkView } from '../controls/walker';
import { ShortcutsView } from './ShortcutsView';
import { formatClock } from '../world/celestial';
import { nextSpeed } from './timeSpeed';
import type { Fullscreen } from './fullscreen';
import type { ScreenInfo } from '../world/deskDash';
import { isTouch } from './touch';

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
  /**
   * Pomodoro: the timer's state for the ring round the shut panel's ☰ (progress 0..1 through
   * the phase), and showing/hiding its card (the button in Cài đặt).
   */
  pomodoro: () => { running: boolean; progress: number; onBreak: boolean } | null;
  /** Stops or restarts the clock (N). */
  toggleTimePaused: () => void;
  togglePomodoro: () => void;
  /** Full screen (F): the header button toggles it and shows its state. */
  fullscreen: Fullscreen;
}

const TAB_ICONS: Readonly<Record<PanelTab, string>> = {
  scene: icons.scene,
  sound: icons.music,
  view: icons.eye,
  pets: icons.paw,
  settings: icons.settings,
};
/**
 * The views you pick from the panel, with their key (in the tooltip: C goes back and forth
 * between the first two). The tub and the hammock are offered when you walk up to them.
 */
const VIEWS: ReadonlyArray<[ViewId, string, string]> = [
  ['orbit', icons.globe, 'C'],
  ['walk', icons.walk, 'C'],
  ['desk', icons.desk, 'B'],
];
const WALK_VIEWS: readonly WalkView[] = ['third', 'first'];
/** Handle tooltip and Pomodoro clock refresh rate (ms). */
const TICK_MS = 500;
/**
 * Tucked away (walking, or the UI hidden with H): it closes this long (ms) after the pointer
 * leaves; walking, its handle then grows faint after SLEEP_MS more. Pointing at the top-right
 * corner (CORNER_W × CORNER_H px) brings it back.
 */
const CLOSE_MS = 600;
const SLEEP_MS = 5000;
const CORNER_W = 200;
const CORNER_H = 120;

interface Tab {
  button: HTMLButtonElement;
  body: HTMLElement;
}

/**
 * The control panel. A fixed top: title, shortcuts, full screen and
 * collapse; master volume; the time bar. Below, four tabs (one shown at a time, remembered):
 * Cảnh, Âm thanh, Góc nhìn, Cài đặt. Clicking the title collapses or expands the whole panel.
 */
export class Panel {
  readonly root: HTMLElement;
  private readonly collapseBtn: HTMLButtonElement;
  /** All that shows of a shut panel: a round ☰ button (its tooltip: scene and what plays). */
  private readonly handle: HTMLButtonElement;
  private readonly startBtn: HTMLButtonElement;
  private readonly mouseSpeed: SliderControl;
  private readonly masterVolume: SliderControl;
  private readonly masterMute: HTMLButtonElement;
  private readonly tabs = new Map<PanelTab, Tab>();
  private readonly shortcuts: ShortcutsView;
  private readonly synthFallback: ToggleControl;
  private readonly synthStatus: HTMLElement;
  private readonly qualityBtns = new Map<QualityLevel, HTMLButtonElement>();
  private readonly characterBtns = new Map<CharacterId, HTMLButtonElement>();
  private readonly qualityNote: HTMLElement;
  private readonly autoRotate: ToggleControl;
  private readonly footsteps: ToggleControl;
  private readonly walkViewBtns = new Map<WalkView, HTMLButtonElement>();
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
  private peek = false;
  /** Walking, left alone SLEEP_MS: the handle grows faint until the corner is pointed at. */
  private asleep = false;
  /** A press inside the panel is held (dragging a slider): it stays open. */
  private held = false;
  /** The last press in the panel began while it was shut (touch: that tap opens it). */
  private pressedShut = false;
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
    // A finger has no hover (and "leaves" on every lift): on touch screens a tap opens the tucked
    // panel and a tap on the scene or the collapse button shuts it (watchSceneClicks, toggle).
    this.root.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'touch') this.open();
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.tucked || this.peek || e.buttons !== 0 || e.pointerType === 'touch') return;
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
      this.pressedShut = this.root.classList.contains('collapsed');
    });
    window.addEventListener('pointerup', () => {
      if (!this.held) return;
      this.held = false;
      this.scheduleClose();
    });
    this.root.addEventListener('click', () => {
      // (A tap on the collapse button of an open panel shut it just before: pressedShut is false.)
      if (isTouch() && this.tucked && !this.peek && this.pressedShut) this.open();
    });

    // --- Fixed top ---
    const header = el('div', 'panel-header');
    const title = el('h1', 'panel-title', vi.appTitle);
    this.shortcuts = new ShortcutsView(parent, deps.keymap);
    const keysBtn = button('', () => this.toggleShortcuts(), 'icon-btn kbd-only');
    keysBtn.innerHTML = icons.keyboard;
    keysBtn.title = vi.panel.shortcutsBtn;
    keysBtn.setAttribute('aria-label', vi.panel.shortcutsBtn);
    const fsBtn = button('', () => deps.fullscreen.toggle(), 'icon-btn fs-btn');
    const syncFs = (on: boolean): void => {
      fsBtn.innerHTML = on ? icons.minimize : icons.maximize;
      const label = on ? vi.panel.fullscreenOff : vi.panel.fullscreenOn;
      fsBtn.title = label;
      fsBtn.setAttribute('aria-label', label);
    };
    syncFs(deps.fullscreen.active);
    deps.fullscreen.onChange(syncFs);
    // ☰ shuts the panel; shut, the same ☰ in the same corner (the handle) opens it again.
    this.collapseBtn = button('', () => this.toggle(), 'icon-btn');
    this.collapseBtn.innerHTML = icons.menu;
    const headerTools = el('div', 'header-tools');
    headerTools.append(keysBtn, fsBtn, this.collapseBtn);
    header.append(title, headerTools);

    // --- Thời gian ---
    // Always shown above the tabs: the hh:mm clock with three icon buttons (stop/run, speed, the
    // computer's clock), and the hour slider painted with the colours of the day. Labels live in
    // tooltips.
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

    const top = el('div', 'panel-top');
    const masterRow = el('div', 'mix-row master');
    this.masterVolume = slider(vi.panel.master, mixer.current.master.volume, (v) => mixer.setMaster({ volume: v }), { ...VOLUME, defaultValue: 0.8 });
    this.masterMute = button('', () => mixer.toggleMuteAll(), 'icon-btn');
    masterRow.append(this.masterVolume.root, this.masterMute);
    // Browsers allow sound only after a click or key press: until then, say so right here.
    this.startBtn = button('', () => deps.startAudio(), 'btn primary start-sound');
    this.startBtn.innerHTML = `${icons.speaker}<span>${vi.panel.startSound}</span>`;
    this.startBtn.title = vi.panel.startSoundHint;
    top.append(this.startBtn, masterRow, time);

    // --- Tabs ---
    const tabBar = el('div', 'panel-tabs');
    tabBar.setAttribute('role', 'tablist');
    const content = el('div', 'panel-content');
    for (const id of PANEL_TABS) {
      const b = button('', () => settings.update({ panelTab: id }), 'panel-tab');
      b.setAttribute('role', 'tab');
      b.innerHTML = `${TAB_ICONS[id]}<span>${vi.panel.sections[id]}</span>`;
      const body = el('div', 'tab-body');
      body.setAttribute('role', 'tabpanel');
      body.setAttribute('aria-label', vi.panel.sections[id]);
      this.tabs.set(id, { button: b, body });
      tabBar.append(b);
      content.append(body);
    }

    // --- Cảnh ---
    // The scene editor is a page of its own: the time bar and the tabs step aside meanwhile.
    this.tab('scene').append(
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
        onEditing: (on) => {
          this.root.classList.toggle('editing', on);
          content.scrollTop = 0;
        },
      }).root,
    );

    // --- Âm thanh ---
    this.synthFallback = toggle(vi.panel.synthFallbackLong, s.synthFallback, (on) => settings.update({ synthFallback: on }));
    this.synthStatus = el('div', 'hint');
    this.footsteps = toggle(vi.panel.footsteps, s.footsteps, (on) => settings.update({ footsteps: on }));
    const library = new LibraryView({
      library: deps.library,
      scenes: deps.scenes,
      startAudio: deps.startAudio,
    });
    const soundOpts = el('div', 'option-list');
    soundOpts.append(this.synthFallback.root, this.footsteps.root);
    this.tab('sound').append(library.root, soundOpts, this.synthStatus);

    // --- Góc nhìn ---
    // One row of the three views; under it the options of the overview and of walking.
    const tiles = el('div', 'view-row');
    for (const [id, icon, key] of VIEWS) {
      const t = button('', () => deps.goTo(id), 'view-tile');
      const i = el('span', 'view-icon');
      i.innerHTML = icon;
      t.append(i, el('span', 'view-name', vi.panel.views[id]));
      t.title = `${vi.panel.views[id]} (${key})`;
      this.viewTiles.set(id, t);
      tiles.append(t);
    }
    this.autoRotate = toggle(vi.panel.autoRotate, s.autoRotate, (on) => settings.update({ autoRotate: on }));
    const orbitOpts = el('div', 'option-list');
    orbitOpts.append(this.autoRotate.root);
    const walkViews = el('div', 'seg-group two');
    for (const id of WALK_VIEWS) {
      const b = button(vi.panel.walkViews[id], () => settings.update({ walkView: id }), 'seg');
      this.walkViewBtns.set(id, b);
      walkViews.append(b);
    }
    this.tab('view').append(
      tiles,
      el('div', 'subhead', vi.panel.orbitOptions),
      orbitOpts,
      el('div', 'subhead', vi.panel.walkOptions),
      walkViews,
    );

    // --- Cài đặt ---
    const quality = el('div', 'seg-group three');
    for (const level of QUALITY_LEVELS) {
      const b = button(vi.panel.qualityNames[level], () => settings.update({ quality: level }), 'seg');
      this.qualityBtns.set(level, b);
      quality.append(b);
    }
    this.qualityNote = el('div', 'note');
    const characters = el('div', 'seg-group three');
    for (const id of CHARACTER_IDS) {
      const b = button(vi.panel.characterNames[id], () => settings.update({ character: id }), 'seg');
      this.characterBtns.set(id, b);
      characters.append(b);
    }
    this.mouseSpeed = slider(vi.panel.mouseSpeed, s.mouseSpeed, (v) => settings.update({ mouseSpeed: v }));
    this.mouseSpeed.root.title = vi.panel.mouseSpeedHint;
    // The Pomodoro card shows itself when started (T) and hides when ended; from here it can be
    // opened while idle, to set it up or start it without a keyboard.
    const pomoRow = el('div', 'button-row');
    const pomoLink = button('', () => deps.togglePomodoro(), 'btn small with-icon');
    pomoLink.innerHTML = `${icons.clock}<span>${vi.panel.pomodoroOpen}</span>`;
    pomoLink.title = vi.panel.pomodoroBtn;
    pomoRow.append(pomoLink);
    const keysRow = el('div', 'button-row kbd-only');
    const keysLink = button('', () => this.toggleShortcuts(), 'btn small with-icon');
    keysLink.innerHTML = `${icons.keyboard}<span>${vi.panel.shortcutsBtn}</span>`;
    keysRow.append(keysLink);
    this.tab('settings').append(
      el('div', 'subhead', vi.panel.quality),
      quality,
      this.qualityNote,
      el('div', 'subhead', vi.panel.character),
      characters,
      this.mouseSpeed.root,
      el('div', 'subhead', vi.pomodoro.title),
      pomoRow,
      keysRow,
      el('div', 'subhead', vi.backup.title),
      backupControls(),
    );

    this.root.append(header, top, tabBar, content);
    // Out of sight (walking and left alone, or the UI hidden with H): only a small round handle
    // stays where the bar was (styles: .panel.handle); pointing at it opens the panel.
    this.handle = el('button', 'panel-handle');
    this.handle.type = 'button';
    this.handle.innerHTML = icons.menu;
    this.handle.setAttribute('aria-label', vi.panel.expand);
    this.handle.addEventListener('click', (e) => {
      // Handled here: the panel's own click handler would take it for a click in an open panel.
      e.stopPropagation();
      this.toggle();
    });
    this.root.append(this.handle);
    parent.append(this.root);

    mixer.onChange((state) => this.syncMixer(state));
    settings.onChange((next) => this.syncSettings(next));
    deps.library.onChange(() => this.syncSynthStatus());
    deps.onViewChange(() => this.syncView());
    this.syncMixer(mixer.current);
    this.syncSettings(s);
    this.syncView();
    this.watchSceneClicks();
    // The handle's tooltip fills on the first frame (tick), once the app has built everything.
  }

  /**
   * A click on the 3D view (pressed and released almost in place, so orbit drags don't count)
   * shuts the open panel, as a menu is shut by clicking outside it (the click still makes its
   * ripple). Not while a scene is being edited.
   */
  private watchSceneClicks(): void {
    let down: { x: number; y: number } | null = null;
    window.addEventListener('pointerdown', (e) => {
      down = e.button === 0 && e.target instanceof HTMLCanvasElement ? { x: e.clientX, y: e.clientY } : null;
    }, { capture: true });
    window.addEventListener('pointerup', (e) => {
      const s = this.deps.settings.get();
      const tap = down !== null && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6;
      down = null;
      if (!tap) return;
      // Touch: a tap on the scene shuts the tucked panel (there is no pointing away from it).
      if (this.tucked && this.peek && isTouch()) {
        window.clearTimeout(this.closeTimer);
        this.peek = false;
        this.syncCollapsed();
        this.scheduleSleep();
        return;
      }
      if (!this.tucked && !s.panelCollapsed && !this.root.classList.contains('editing')) {
        this.deps.settings.update({ panelCollapsed: true });
      }
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
   * Walking, paddling or surfing (`on`): the panel stays out of the scene, shut to its handle
   * (faint after SLEEP_MS), until you point at it or at the corner. Your own collapsed setting
   * is kept for the overview.
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
    return this.walking || this.uiHidden;
  }

  /** The first frame is up: the tucked panel's handle grows faint SLEEP_MS from now. */
  sceneShown(): void {
    this.scheduleSleep();
  }

  /** Esc in the overview: shuts the open panel. False if there was nothing to shut. */
  close(): boolean {
    if (this.tucked || this.root.classList.contains('collapsed') || this.root.classList.contains('editing')) return false;
    this.deps.settings.update({ panelCollapsed: true });
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
    // Touch: it stays open until shut by a tap (a lifted finger always "leaves").
    if (!this.tucked || !this.peek || isTouch()) return;
    window.clearTimeout(this.closeTimer);
    this.closeTimer = window.setTimeout(() => {
      if (this.held || this.root.matches(':hover') || (isTyping(document.activeElement) && this.root.contains(document.activeElement))) return;
      this.peek = false;
      this.syncCollapsed();
      this.scheduleSleep();
    }, CLOSE_MS);
  }

  /** Walking: the handle grows faint after SLEEP_MS left alone. */
  private scheduleSleep(): void {
    window.clearTimeout(this.sleepTimer);
    if (!this.walking || this.peek) return;
    this.sleepTimer = window.setTimeout(() => {
      if (!this.walking || this.peek) return;
      this.asleep = true;
      this.syncCollapsed();
    }, SLEEP_MS);
  }

  /** Collapsed: your setting in the overview; tucked away, unless pointed at. */
  private syncCollapsed(): void {
    const tucked = this.tucked;
    const shut = tucked ? !this.peek : this.deps.settings.get().panelCollapsed;
    // Shut is always the handle alone (styles: .panel.handle); `faint` once walking left it be.
    this.root.classList.toggle('collapsed', shut);
    this.root.classList.toggle('handle', shut);
    this.root.classList.toggle('faint', shut && tucked && (this.asleep || this.uiHidden));
    this.root.classList.toggle('peek', tucked && this.peek);
    this.collapseBtn.title = vi.panel.collapse;
    this.collapseBtn.setAttribute('aria-label', vi.panel.collapse);
    this.collapseBtn.setAttribute('aria-expanded', String(!shut));
    this.handle.setAttribute('aria-expanded', String(!shut));
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
    // A sheet along the bottom (upright phone): the top right corner is free.
    if (r.top > window.innerHeight / 2) return { top: 12, right: 12, width: 0 };
    if (!this.tucked) return { top: 12, right: window.innerWidth - r.left + 12, width: 0 };
    return { top: r.bottom + 8, right: 12, width: 0 };
  }

  /**
   * ☰ (in the header, or the handle), P: shuts the panel if it is open, opens it if shut. In the
   * overview that is the setting; tucked away (walking, the UI hidden) it closes the peek at once
   * or opens it (it used to flip the setting, which a tucked panel ignores: nothing happened).
   */
  toggle(): void {
    const open = !this.root.classList.contains('collapsed');
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

  /** Puts content made elsewhere (the Thú Cưng camp) into a tab. */
  mount(id: PanelTab, content: HTMLElement): void {
    this.tab(id).append(content);
  }

  private tab(id: PanelTab): HTMLElement {
    const t = this.tabs.get(id);
    if (!t) throw new Error(`Panel: no tab ${id}`);
    return t.body;
  }

  /** The shortcut card (? or the keyboard buttons). */
  toggleShortcuts(): void {
    this.shortcuts.toggle();
  }

  /**
   * Called every frame; refreshes the clock, and the handle's tooltip and Pomodoro ring a
   * couple of times a second, touching the DOM only when the text changes.
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
    const tip = `${vi.panel.expand} · ${scene} · ♪ ${muted ? vi.panel.status.muted : info.playing}`;
    if (this.handle.title !== tip) this.handle.title = tip;
    const p = this.deps.pomodoro();
    // A ring round the shut panel's ☰ fills as the phase runs (green focus, blue break).
    this.root.classList.toggle('pomo-on', !!p?.running);
    this.root.classList.toggle('pomo-break', !!p?.onBreak);
    const ring = p ? p.progress.toFixed(3) : '0';
    if (this.root.style.getPropertyValue('--pomo') !== ring) this.root.style.setProperty('--pomo', ring);
  }

  private syncMixer(state: Readonly<MixerState>): void {
    this.masterVolume.set(state.master.volume);
    setMuteIcon(this.masterMute, state.master.muted);
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
  }

  private syncSettings(s: Readonly<Settings>): void {
    this.syncCollapsed();
    for (const [id, t] of this.tabs) {
      const on = id === s.panelTab;
      t.button.setAttribute('aria-selected', String(on));
      t.body.hidden = !on;
    }
    for (const [level, b] of this.qualityBtns) b.setAttribute('aria-pressed', String(level === s.quality));
    for (const [id, b] of this.characterBtns) b.setAttribute('aria-pressed', String(id === s.character));
    const msaaChanged = (s.quality === 'low') !== (this.startQuality === 'low');
    this.qualityNote.textContent = msaaChanged ? vi.panel.msaaReload : '';
    this.autoRotate.set(s.autoRotate);
    this.footsteps.set(s.footsteps);
    this.synthFallback.set(s.synthFallback);
    for (const [id, b] of this.walkViewBtns) b.setAttribute('aria-pressed', String(id === s.walkView));
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
