import * as THREE from 'three';
import { Loop } from './loop';
import { SettingsStore, safeLocalStorage, type Settings, type SettingsPatch } from './settings';
import { NORMAL_FPS, QUALITY_PROFILES } from './quality';
import { sharedUniforms } from './uniforms';
import { EnvState } from './envState';
import { GpuTimer } from './gpuTimer';
import { createWorld, type World } from '../world/World';
import { createOrbitCamera, type OrbitCamera } from '../controls/orbit';
import { Keymap } from '../controls/keymap';
import { onWaterClick } from '../controls/waterClick';
import { IslandColliders, type WalkSurface } from '../controls/islandColliders';
import { Walker, type StepEvent } from '../controls/walker';
import { CameraManager, type SeatId, type SeatSpot } from '../controls/CameraManager';
import type { HouseSeat } from '../world/house';
import { DeskView } from '../controls/deskView';
import { DeskScreens, type ScreenInfo } from '../world/deskScreens';
import { formatClock, windowSkyTurn } from '../world/celestial';
import { WalkHint } from '../ui/WalkHint';
import { Avatar, type AvatarPose } from '../world/avatar';
import type { ListenerState } from '../audio/spatial';
import type { FootSurface } from '../audio/synth/footsteps';
import type { LayerId } from '../audio/types';
import { DebugOverlay } from '../ui/DebugOverlay';
import { Panel, type ViewId } from '../ui/Panel';
import { AudioPrompt } from '../ui/AudioPrompt';
import { PomodoroOverlay } from '../ui/PomodoroOverlay';
import { vi } from '../ui/strings.vi';
import { Mixer } from '../audio/mixer';
import { SoundLibrary } from '../audio/library/SoundLibrary';
import { ScenePresetStore } from './scenePresets';
import type { WeatherTargets } from '../weather/Weather';
import { wallSeconds } from '../weather/wind';
import type { SkyOptions, SkyWeather } from '../world/dayNight';

/** Weather level during a Pomodoro break with "Bão dịu đi khi nghỉ". */
const CALM_LEVEL = 0.3;
/** Time constant of the calm-down, seconds (≈ 20 s to settle). */
const CALM_EASE = 6;

export class App {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly settings: SettingsStore;
  private readonly env = new EnvState();
  private readonly world: World;
  private readonly orbit: OrbitCamera;
  private readonly colliders: IslandColliders;
  private readonly walker: Walker;
  private readonly cameras: CameraManager;
  private readonly deskView: DeskView;
  private readonly deskScreens: DeskScreens;
  private readonly fader: HTMLElement;
  private faderTimer = 0;
  private readonly walkHint: WalkHint;
  private readonly audioPrompt: AudioPrompt;
  private audioStarting = false;
  private readonly avatar: Avatar;
  private readonly listener: ListenerState = { walking: false, shoreDistance: 0, seaSide: 0, trees: 0, shelter: 'none' };
  private listenerTimer = 0;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private readonly overlay: DebugOverlay;
  private readonly keymap = new Keymap();
  private readonly loop: Loop;
  private readonly gpuTimer: GpuTimer;
  private readonly mixer = new Mixer();
  private readonly scenes = new ScenePresetStore();
  private readonly library = new SoundLibrary();
  private readonly panel: Panel;
  private readonly pomodoro: PomodoroOverlay;
  /** Pomodoro storm calm: target and the eased value the visuals use. */
  private calmTarget = 1;
  private calmVisual = 1;
  /** Time mode to return to when N un-pauses the clock. */
  private shadowsOn: boolean | null = null;

  constructor(private readonly container: HTMLElement) {
    this.settings = new SettingsStore(safeLocalStorage());
    const s = this.settings.get();

    this.renderer = new THREE.WebGLRenderer({
      // MSAA can only be chosen at context creation (see quality.ts).
      antialias: QUALITY_PROFILES[s.quality].msaa,
      powerPreference: 'high-performance',
    });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // Shadows are re-rendered once per frame (by the first scene pass), not once per pass.
    this.renderer.shadowMap.autoUpdate = false;
    // Stats cover every pass of the frame (simulation, caustics, capture, main), not just the last.
    this.renderer.info.autoReset = false;
    container.append(this.renderer.domElement);
    this.gpuTimer = new GpuTimer(this.renderer.getContext() as WebGL2RenderingContext);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.3, 6000);
    this.world = createWorld(this.scene, this.renderer, this.camera, sharedUniforms);
    this.orbit = createOrbitCamera(this.camera, this.renderer.domElement, (x, z) => this.world.heightmap.heightAt(x, z));
    const w = this.world;
    this.colliders = new IslandColliders({
      heightmap: w.heightmap,
      house: w.house,
      umbrella: w.layout.umbrella,
      trunks: w.forest.trunks,
      rocks: w.rocks.circles,
    });
    this.walker = new Walker(
      this.camera,
      this.renderer.domElement,
      this.colliders,
      {
        onStep: (e) => this.onStep(e),
        onUnlock: () => this.cameras.setMode('orbit'),
        onLockState: (locked, failed) => {
          this.walkHint.update(this.cameras.mode === 'walk', locked, failed);
        },
      },
      () => this.reducedMotion.matches,
    );
    this.deskView = new DeskView(this.camera, this.renderer.domElement);
    // House-local seat → world-space camera pose (desk faces the sea, the tub the forest).
    const spot = (h: HouseSeat): SeatSpot => {
      const seat = this.colliders.houseToWorld(h.seatX, h.seatZ, { x: 0, z: 0 });
      const stand = this.colliders.houseToWorld(h.standX, h.standZ, { x: 0, z: 0 });
      const yaw = this.colliders.seaYaw + (h.facesSea ? 0 : Math.PI);
      return { seat: { x: seat.x, y: h.eyeY, z: seat.z, yaw, pitch: h.pitch }, stand: { x: stand.x, z: stand.z, yaw } };
    };
    this.cameras = new CameraManager(this.camera, this.orbit, this.walker, this.deskView, this.colliders.spawn, {
      desk: spot(w.house.desk),
      bath: spot(w.house.bath),
    });
    // The aurora hangs over the sea seen from the desk, a little right of the window's center
    // (scene skies put the moon a little left of it). Shader azimuth: atan(x, −z).
    {
      const yaw = this.colliders.seaYaw;
      sharedUniforms.uAuroraAz.value = Math.atan2(-Math.sin(yaw), Math.cos(yaw)) + (20 * Math.PI) / 180;
    }
    // Reduced motion: the aurora's rays and folds nearly stand still (the slow sway stays).
    const auroraMotion = (): void => {
      sharedUniforms.uAuroraMotion.value = this.reducedMotion.matches ? 0.08 : 1;
    };
    auroraMotion();
    this.reducedMotion.addEventListener('change', auroraMotion);
    this.deskScreens = new DeskScreens(w.house.screens, this.renderer.capabilities.getMaxAnisotropy(), () => this.screenInfo());
    // The avatar's feet find the ground (terrain, house floor, steps) like the walker does.
    const support = { y: 0, surface: 'sand' as WalkSurface, onPlatform: false };
    this.avatar = new Avatar(sharedUniforms, (x, z, nearY) =>
      this.colliders.world.supportAt(x, z, nearY, support) ? support.y : nearY,
    );
    this.scene.add(this.avatar.group);
    this.walker.setView(s.walkView);
    onWaterClick(
      this.renderer.domElement,
      this.camera,
      (x, z) => this.world.water.addRipple(x, z, 3, -1.0),
      () => (this.cameras.mode === 'orbit' ? 'cursor' : this.walker.locked ? 'center' : 'none'),
    );

    this.overlay = new DebugOverlay(container, s.showDebug);
    this.settings.onChange((next) => this.applySettings(next));

    this.registerShortcuts();
    // UI layer above the canvas; hidden as a whole with the H key.
    const ui = document.createElement('div');
    ui.className = 'ui-layer';
    container.append(ui);
    this.migrateLinkedWeather();
    this.library.setActivePreset(this.settings.get().activeScene);
    this.library.onChange(() => this.updateSynth());
    this.panel = new Panel(ui, {
      mixer: this.mixer,
      library: this.library,
      scenes: this.scenes,
      settings: this.settings,
      keymap: this.keymap,
      startAudio: () => void this.startAudio(),
      applyScene: (id) => this.applyScene(id),
      onSceneDeleted: (id) => this.library.dropPreset(id),
      getHours: () => this.world.dayNight.hours,
      getSkyTurn: () => this.world.dayNight.skyTurn,
      setSky: (h, turn) => {
        this.world.dayNight.setHours(h);
        this.world.dayNight.setSkyTurn(turn);
      },
      windowTurn: (h) => {
        // Desk view azimuth: forward is −Z turned by the seat's yaw.
        const yaw = this.colliders.seaYaw;
        return windowSkyTurn(h, Math.atan2(-Math.cos(yaw), -Math.sin(yaw)));
      },
      setHours: (h) => this.world.dayNight.setHours(h),
      status: () => this.screenInfo(),
      view: () => (this.cameras.mode === 'seat' ? this.cameras.seat : this.cameras.mode),
      onViewChange: (fn) => this.cameras.onChange(fn),
      goTo: (view) => this.goTo(view),
      pomodoro: () => {
        const p = this.pomodoro.snapshot();
        return p ? { remaining: p.remaining, running: p.running, visible: this.pomodoro.isVisible } : null;
      },
      togglePomodoro: () => this.pomodoro.setVisible(!this.pomodoro.isVisible),
      toggleTimePaused: () => this.toggleTimePaused(),
    });
    this.pomodoro = new PomodoroOverlay(ui, {
      scheduleChime: (atMs, kind) => this.mixer.scheduleChime(atMs, kind),
      soundOn: () => this.mixer.started,
      onCalm: (active) => {
        this.calmTarget = active ? CALM_LEVEL : 1;
        this.mixer.setCalm(this.calmTarget);
        this.library.setCalm(this.calmTarget);
      },
    });
    this.audioPrompt = new AudioPrompt(ui);
    // No start screen: sound starts with the first click or key press anywhere (browsers
    // don't allow audio before that).
    for (const type of ['pointerdown', 'keydown'] as const) {
      window.addEventListener(type, () => this.onFirstGesture(), { capture: true });
    }
    // The panel offers a "Bật âm thanh" button; the prompt only reports a failed start.
    this.walkHint = new WalkHint(ui);
    this.fader = document.createElement('div');
    this.fader.className = 'fader';
    container.append(this.fader);
    this.cameras.onChange((mode) => {
      const walking = mode === 'walk';
      document.body.classList.toggle('walking', walking);
      document.body.classList.toggle('at-desk', mode === 'seat');
      this.walkHint.update(walking, this.walker.locked, false);
      this.walkHint.showSeat(mode === 'seat', this.cameras.seat === 'bath' ? vi.bath.controls : vi.desk.controls);
      this.listenerTimer = 0;
      if (walking) this.avatar.setYaw(this.walker.yaw);
      if (mode === 'orbit') {
        this.listener.walking = false;
        this.mixer.setListener(this.listener);
      }
    });

    window.addEventListener('resize', this.onResize);
    this.loop = new Loop(this.tick);
    this.applySettings(s);
    this.onResize();
    if (s.startAtDesk) this.cameras.sit('desk', false);
    // Start in the saved weather instead of easing in from a clear sky.
    this.world.weather.setTargets(this.weatherTargets());
    this.world.weather.snapToTargets();
  }

  /** The scene's effect sliders (eased down during a Pomodoro break with "storm calms"). */
  private weatherTargets(): WeatherTargets {
    const s = this.settings.get();
    const k = this.calmVisual;
    return { rain: s.visualRain * k, snow: s.visualSnow * k, wind: s.visualWind * k };
  }

  /**
   * Before Phase 7 the weather followed the synth mixer. Carry such a setup over once into the
   * scene sliders, so nothing changes on screen after the update.
   */
  private migrateLinkedWeather(): void {
    const s = this.settings.get();
    if (!s.weatherLinked) return;
    const l = this.mixer.current.layers;
    const level = (id: 'rain' | 'snow' | 'wind'): number => (l[id].enabled ? l[id].volume : 0);
    this.settings.update({
      weatherLinked: false,
      visualRain: level('rain'),
      visualSnow: level('snow'),
      visualWind: level('wind'),
      activeScene: '',
    });
  }

  /** Scene preset: its effects, its time of day (if saved with one) and its recordings. */
  private applyScene(id: string): void {
    const p = this.scenes.get(id);
    if (!p) return;
    const patch: SettingsPatch = { ...p.values, activeScene: id };
    // A preset saved with a time of day starts there: the island clock runs on from that time
    // at the current speed.
    if (p.hours !== null) {
      patch.timeMode = 'free';
      patch.timePaused = false;
    }
    this.settings.update(patch);
    if (p.hours !== null) {
      this.world.dayNight.setHours(p.hours);
      this.world.dayNight.setSkyTurn(p.skyTurn);
    }
  }

  /**
   * The synthesized soundscape is the fallback: it follows the scene (rain slider → rain sound,
   * …) and fades out while any recording plays.
   */
  private updateSynth(): void {
    const s = this.settings.get();
    const on = s.synthFallback && !this.library.audible;
    const wet = Math.max(s.visualRain, s.visualSnow);
    this.synthLevels.waves = on ? 0.3 + 0.55 * s.waveStrength : 0;
    this.synthLevels.birds = on ? 0.32 * (1 - 0.8 * wet) : 0;
    this.synthLevels.wind = on && s.visualWind > 0.03 ? 0.1 + 0.75 * s.visualWind : 0;
    this.synthLevels.rain = on ? s.visualRain : 0;
    this.synthLevels.snow = on ? 0.8 * s.visualSnow : 0;
    this.mixer.setSceneMix(this.synthLevels);
    // Falling snow muffles everything, recordings included.
    this.mixer.setMuffle(0.8 * s.visualSnow);
  }

  private readonly synthLevels: Record<LayerId, number> = { waves: 0, birds: 0, wind: 0, rain: 0, snow: 0 };

  start(): void {
    this.loop.start();
  }

  /** Creates the audio graph; must run inside a click/keypress handler. */
  private async startAudio(): Promise<void> {
    if (this.mixer.started || this.audioStarting) return;
    this.audioStarting = true;
    try {
      await this.mixer.start();
      const engine = this.mixer.audioEngine;
      if (engine) this.library.attach(engine);
      this.updateSynth();
      this.audioPrompt.hide();
      this.pomodoro.refreshSound();
    } catch (e) {
      console.warn('Audio start failed', e);
      this.audioPrompt.show(true);
    } finally {
      this.audioStarting = false;
    }
  }

  /** Any click or key press counts as the gesture that may start the sound. */
  private onFirstGesture(): void {
    if (!this.mixer.started) void this.startAudio();
  }

  private registerShortcuts(): void {
    const toggleSetting = (key: 'showDebug' | 'panelCollapsed') => () =>
      this.settings.update({ [key]: !this.settings.get()[key] });
    this.keymap.register({ code: 'KeyM', keyLabel: 'M', label: vi.shortcuts.muteAll, action: () => this.mixer.toggleMuteAll() });
    this.keymap.register({ code: 'KeyP', keyLabel: 'P', label: vi.shortcuts.panel, action: toggleSetting('panelCollapsed') });
    this.keymap.register({
      code: 'KeyH',
      keyLabel: 'H',
      label: vi.shortcuts.hideUI,
      action: () => document.body.classList.toggle('ui-hidden'),
    });
    this.keymap.register({
      code: 'KeyN',
      keyLabel: 'N',
      label: vi.shortcuts.pauseTime,
      action: () => this.toggleTimePaused(),
    });
    this.keymap.register({ code: 'KeyT', keyLabel: 'T', label: vi.shortcuts.pomodoro, action: () => this.pomodoro.toggleRunning() });
    this.keymap.register({ code: 'KeyB', keyLabel: 'B', label: vi.shortcuts.desk, action: () => this.toggleSeat('desk') });
    this.keymap.register({
      code: 'KeyE',
      keyLabel: 'E',
      label: vi.shortcuts.sit,
      action: () => {
        if (this.cameras.mode === 'seat') {
          this.cameras.getUp();
          return;
        }
        const near = this.nearSeat();
        if (near) this.cameras.sit(near, true);
      },
    });
    this.keymap.register({
      code: 'Escape',
      keyLabel: 'Esc',
      label: vi.shortcuts.leaveDesk,
      action: () => {
        if (this.cameras.mode === 'seat') this.toggleSeat(this.cameras.seat);
      },
    });
    this.keymap.register({ code: 'KeyC', keyLabel: 'C', label: vi.shortcuts.walk, action: () => this.cameras.toggle() });
    this.keymap.register({
      code: 'KeyV',
      keyLabel: 'V',
      label: vi.shortcuts.view,
      action: () => this.settings.update({ walkView: this.settings.get().walkView === 'third' ? 'first' : 'third' }),
    });
    // 1–9: the scenes in the order of the panel's cards.
    for (let i = 1; i <= 9; i++) {
      this.keymap.register({
        code: `Digit${i}`,
        keyLabel: String(i),
        label: vi.shortcuts.sceneKeys,
        unlisted: true,
        action: () => {
          const p = this.scenes.all()[i - 1];
          if (p) this.applyScene(p.id);
        },
      });
    }
    this.keymap.register({ code: 'Backquote', keyLabel: '`', label: vi.shortcuts.debug, action: toggleSetting('showDebug') });
  }

  private applySettings(s: Readonly<Settings>): void {
    const profile = QUALITY_PROFILES[s.quality];
    const pixelRatio = Math.min(window.devicePixelRatio, profile.pixelRatioCap);
    if (pixelRatio !== this.renderer.getPixelRatio()) {
      // Resizing the canvas clears it, so only do it when the ratio really changes.
      this.renderer.setPixelRatio(pixelRatio);
      this.onResize();
    }
    this.world.fireflies.setPixelRatio(pixelRatio);

    const shadows = profile.shadowMapSize > 0;
    this.renderer.shadowMap.enabled = shadows;
    this.world.lighting.setShadowMapSize(profile.shadowMapSize);
    if (this.shadowsOn !== null && this.shadowsOn !== shadows) {
      // Toggling shadows changes shader code, so every material must recompile once.
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
        else if (m) m.needsUpdate = true;
      });
    }
    this.shadowsOn = shadows;

    // Reduced motion: never auto-rotate, regardless of the stored setting.
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.orbit.setAutoRotate(s.autoRotate && !reducedMotion);
    const fps = NORMAL_FPS;
    this.loop.targetFps = fps;
    this.world.water.applyProfile(profile);
    this.world.water.setStepRate(fps);
    this.world.weather.setQuality(profile);
    this.world.grass.setCount(profile.grassCount);
    this.world.flowers.setCount(profile.flowerCount);
    this.env.waveStrength.target = s.waveStrength;
    if (s.walkView !== this.walker.view) this.walker.setView(s.walkView);
    this.library.setActivePreset(s.activeScene);
    this.updateSynth();
    this.overlay.setVisible(s.showDebug);
  }

  /**
   * B / panel buttons: sit at a seat from anywhere, or get up from it. From far away (orbit,
   * elsewhere on the island) the screen fades through black instead of flying through walls;
   * standing right next to the seat, the camera glides there.
   */
  private toggleSeat(id: SeatId): void {
    const seated = this.cameras.mode === 'seat' && this.cameras.seat === id;
    if (!seated && this.cameras.mode === 'walk' && this.nearSeat() === id) {
      this.cameras.sit(id, true);
      return;
    }
    window.clearTimeout(this.faderTimer);
    this.fader.classList.add('on');
    this.faderTimer = window.setTimeout(() => {
      if (seated) this.cameras.getUp();
      else this.cameras.sit(id, false);
      this.fader.classList.remove('on');
    }, 300);
  }

  /**
   * N key / "Dừng" button: stop or restart the clock. Stopping the computer's clock freezes the
   * island at the current time (the island clock takes over from there).
   */
  private toggleTimePaused(): void {
    const s = this.settings.get();
    if (s.timeMode === 'real') this.settings.update({ timeMode: 'free', timePaused: true });
    else this.settings.update({ timePaused: !s.timePaused });
  }

  /** "Góc nhìn" tiles: the overview, walking, or one of the seats (the active one does nothing). */
  private goTo(view: ViewId): void {
    const c = this.cameras;
    if (view === 'orbit' || view === 'walk') {
      if (c.mode === 'seat' && view === 'walk') c.getUp();
      else c.setMode(view);
    } else if (!(c.mode === 'seat' && c.seat === view)) {
      this.toggleSeat(view);
    }
  }

  /** The seat you are standing next to in the room (walk mode), if any. */
  private nearSeat(): SeatId | null {
    if (this.cameras.mode !== 'walk' || this.walker.shelter !== 'room') return null;
    const h = this.world.house;
    const l = this.colliders.worldToHouse(this.walker.x, this.walker.z, this.tmpLocal);
    if (Math.hypot(l.x - h.desk.seatX, l.z - h.desk.seatZ) < 1.3) return 'desk';
    // Next to the tub's open (front) side.
    if (Math.hypot(l.x - h.bath.seatX, l.z - (h.bath.seatZ + 0.45)) < 1.25) return 'bath';
    return null;
  }

  private readonly tmpLocal = { x: 0, z: 0 };

  /** What the right-hand desk monitor shows. */
  private screenInfo(): ScreenInfo {
    const s = this.settings.get();
    const pct = (v: number): string => `${Math.round(v * 100)}%`;
    const weather = [`Mưa ${pct(s.visualRain)}`, `Gió ${pct(s.visualWind)}`, `Sóng ${pct(s.waveStrength)}`];
    if (s.visualSnow > 0.01) weather.push(`Tuyết ${pct(s.visualSnow)}`);
    const names = this.library.playingNames();
    const soundOn = this.mixer.started;
    return {
      pomodoro: this.pomodoro.snapshot(),
      scene: this.scenes.get(s.activeScene)?.name ?? '',
      playing: !soundOn ? vi.desk.soundOff : names.length > 0 ? names.join('  ·  ') : vi.desk.synth,
      islandTime: formatClock(this.world.dayNight.hours),
      weather: weather.join('  ·  '),
    };
  }

  /** Footstep sound (by surface, snow on top when it has settled) and a ripple when wading. */
  private onStep(e: StepEvent): void {
    if (e.depth > 0.05) this.world.water.addRipple(this.walker.x, this.walker.z, 1.2, -0.35 * e.strength);
    if (!this.settings.get().footsteps) return;
    let surface: FootSurface = e.surface;
    const snowy = sharedUniforms.uSnowCover.value > 0.45;
    if (snowy && surface !== 'water' && this.walker.shelter === 'none') surface = 'snow';
    this.mixer.playFootstep(surface, e.strength, e.depth);
  }

  /** The character is shown in third-person walking, unless the camera is pressed right up to it. */
  private updateAvatar(dt: number): void {
    const w = this.walker;
    const show = this.cameras.mode === 'walk' && w.view === 'third' && w.arm > 0.7;
    this.avatar.group.visible = show;
    if (!show) return;
    const p = this.avatarPose;
    p.x = w.x;
    p.z = w.z;
    p.feetY = w.feetY;
    p.vx = w.vel.x;
    p.vz = w.vel.y;
    p.speed = w.speed;
    p.phase = w.phase;
    p.running = w.running;
    this.avatar.update(dt, p);
  }

  private readonly avatarPose: AvatarPose = { x: 0, z: 0, feetY: 0, vx: 0, vz: 0, speed: 0, phase: 0, running: false };

  /** Walk/desk mode: where the listener is shapes the mix (~10 times per second is plenty). */
  private updateListener(dt: number): void {
    const mode = this.cameras.mode;
    if (mode === 'orbit') return;
    if (mode === 'walk') {
      const near = this.nearSeat();
      this.walkHint.setPrompt(near === 'desk' ? vi.desk.sit : near === 'bath' ? vi.bath.enter : null);
    }
    this.listenerTimer -= dt;
    if (this.listenerTimer > 0) return;
    this.listenerTimer = 0.1;
    const atDesk = mode === 'seat';
    const seat = this.deskView.seat;
    const x = atDesk ? seat.x : this.walker.x;
    const z = atDesk ? seat.z : this.walker.z;
    const yaw = atDesk ? seat.yaw : this.walker.yaw;
    const l = this.listener;
    l.walking = true;
    l.shoreDistance = this.world.heightmap.distanceToShore(x, z);
    // The sea lies roughly away from the island center; project that onto the listener's right.
    const r = Math.hypot(x, z) || 1;
    l.seaSide = (x / r) * Math.cos(yaw) - (z / r) * Math.sin(yaw);
    l.trees = this.colliders.treesNear(x, z, 12);
    l.shelter = atDesk ? 'room' : this.walker.shelter;
    this.mixer.setListener(l);
  }

  private readonly drawingBuffer = new THREE.Vector2();
  // Reused every frame (no per-frame allocations).
  private readonly skyOptions: SkyOptions = {
    clock: { mode: 'free', speed: 60, paused: false }, clouds: 0, gloom: 0, rainbow: true, stars: true, meteors: 0, aurora: 0, moonlight: 0.3,
  };
  private readonly skyWeather: SkyWeather = { overcast: 0, rain: 0, wetness: 0 };

  private onResize = (): void => {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.renderer.getDrawingBufferSize(this.drawingBuffer);
    this.world.water.setSize(this.drawingBuffer.x, this.drawingBuffer.y);
  };

  private tick = (dt: number, elapsed: number): void => {
    const cpuStart = performance.now();
    this.renderer.info.reset();
    this.env.update(dt);
    sharedUniforms.uTime.value = elapsed;

    this.calmVisual += (this.calmTarget - this.calmVisual) * (1 - Math.exp(-dt / CALM_EASE));
    const weather = this.world.weather;
    weather.setTargets(this.weatherTargets());
    weather.update(dt, wallSeconds());

    // Sky after weather: the time-of-day palette is greyed by the weather's overcast.
    const s = this.settings.get();
    const dayNight = this.world.dayNight;
    this.skyOptions.clock.mode = s.timeMode;
    this.skyOptions.clock.speed = s.timeSpeed;
    this.skyOptions.clock.paused = s.timePaused;
    this.skyOptions.clouds = s.clouds;
    this.skyOptions.gloom = s.gloom;
    sharedUniforms.uCirrus.value = s.cirrus;
    // Sliders 0..1 with 0.5 = normal: brightness ×0.4…×1.8, size ×0.6…×2.2.
    sharedUniforms.uSunBright.value = s.sunBrightness < 0.5 ? 0.4 + 1.2 * s.sunBrightness : 1 + 1.6 * (s.sunBrightness - 0.5);
    sharedUniforms.uSunSize.value = s.sunSize < 0.5 ? 0.6 + 0.8 * s.sunSize : 1 + 2.4 * (s.sunSize - 0.5);
    this.skyOptions.rainbow = s.rainbow;
    this.skyOptions.stars = s.stars;
    this.skyOptions.meteors = s.meteors;
    this.skyOptions.aurora = s.aurora;
    this.skyOptions.moonlight = s.moonlight;
    this.skyWeather.overcast = weather.overcast;
    this.skyWeather.rain = weather.rainAmount;
    this.skyWeather.wetness = weather.wetness;
    dayNight.update(dt, this.skyOptions, this.skyWeather, this.camera);
    const night = dayNight.night;
    this.world.fireflies.update(s.fireflies ? night * (1 - weather.rainAmount) * (1 - sharedUniforms.uSnow.value) : 0);
    this.mixer.setNight(night);
    this.panel.tick(performance.now());
    // Wind roughens the sea on top of the wave slider; the surf sound follows the same value.
    const sea = Math.min(1, this.env.waveStrength.value + weather.seaBoost);
    sharedUniforms.uWaveStrength.value = sea;
    this.mixer.setSeaState(sea);

    this.cameras.update(dt);
    this.updateListener(dt);
    this.updateAvatar(dt);
    this.world.update(dt, elapsed, this.camera, sea);
    this.deskScreens.update(dt, this.camera);
    this.gpuTimer.begin();
    this.world.water.simulate(dt);
    // The next scene render (capture if refraction is on, else main) refreshes the shadow map.
    this.renderer.shadowMap.needsUpdate = true;
    this.world.water.captureScene(this.scene, this.camera);
    this.renderer.render(this.scene, this.camera);
    this.gpuTimer.end();
    const cpuMs = performance.now() - cpuStart;
    this.overlay.update(dt, this.renderer.info, this.loop, cpuMs, this.gpuTimer.lastMs);
  };
}
