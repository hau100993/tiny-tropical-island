import * as THREE from 'three';
import { Loop } from './loop';
import { SettingsStore, safeLocalStorage, type Settings } from './settings';
import { effectiveProfile, LOW_POWER_FPS, NORMAL_FPS, QUALITY_PROFILES } from './quality';
import { sharedUniforms } from './uniforms';
import { EnvState } from './envState';
import { GpuTimer } from './gpuTimer';
import { createWorld, type World } from '../world/World';
import { createOrbitCamera, type OrbitCamera } from '../controls/orbit';
import { Keymap } from '../controls/keymap';
import { onWaterClick } from '../controls/waterClick';
import { DebugOverlay } from '../ui/DebugOverlay';
import { Panel } from '../ui/Panel';
import { StartScreen } from '../ui/StartScreen';
import { vi } from '../ui/strings.vi';
import { Mixer } from '../audio/mixer';
import { PresetStore } from '../audio/presets';
import type { WeatherTargets } from '../weather/Weather';
import { wallSeconds } from '../weather/wind';
import type { SkyOptions, SkyWeather } from '../world/dayNight';
import type { TimeMode } from '../world/celestial';

export class App {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly settings: SettingsStore;
  private readonly env = new EnvState();
  private readonly world: World;
  private readonly orbit: OrbitCamera;
  private readonly overlay: DebugOverlay;
  private readonly keymap = new Keymap();
  private readonly loop: Loop;
  private readonly gpuTimer: GpuTimer;
  private readonly mixer = new Mixer();
  private readonly presets = new PresetStore();
  private readonly panel: Panel;
  /** Time mode to return to when N un-pauses the clock. */
  private resumeMode: TimeMode = 'cycle24';
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
    this.orbit = createOrbitCamera(this.camera, this.renderer.domElement);
    onWaterClick(this.renderer.domElement, this.camera, (x, z) => this.world.water.addRipple(x, z, 3, -1.0));

    this.overlay = new DebugOverlay(container, s.showDebug);
    this.settings.onChange((next) => this.applySettings(next));

    this.registerShortcuts();
    // UI layer above the canvas; hidden as a whole with the H key.
    const ui = document.createElement('div');
    ui.className = 'ui-layer';
    container.append(ui);
    this.panel = new Panel(ui, {
      mixer: this.mixer,
      presets: this.presets,
      settings: this.settings,
      keymap: this.keymap,
      startAudio: () => void this.startAudio(),
      getHours: () => this.world.dayNight.hours,
      setHours: (h) => this.world.dayNight.setHours(h),
    });
    new StartScreen(container, () => this.startAudio());

    window.addEventListener('resize', this.onResize);
    this.loop = new Loop(this.tick);
    this.applySettings(s);
    this.onResize();
    // Start in the saved weather instead of easing in from a clear sky.
    this.world.weather.setTargets(this.weatherTargets());
    this.world.weather.snapToTargets();
  }

  /**
   * Linked (default): each weather effect follows its sound layer — on/off × volume.
   * Mute only silences the sound; the rain stays visible. Unlinked: separate visual sliders.
   */
  private weatherTargets(): WeatherTargets {
    const s = this.settings.get();
    if (!s.weatherLinked) return { rain: s.visualRain, snow: s.visualSnow, wind: s.visualWind };
    const l = this.mixer.current.layers;
    const level = (id: 'rain' | 'snow' | 'wind'): number => (l[id].enabled ? l[id].volume : 0);
    return { rain: level('rain'), snow: level('snow'), wind: level('wind') };
  }

  start(): void {
    this.loop.start();
  }

  /** Creates the audio graph; must run inside a click/keypress handler. */
  private startAudio(): Promise<void> {
    return this.mixer.start();
  }

  private registerShortcuts(): void {
    const toggleSetting = (key: 'showDebug' | 'lowPower' | 'panelCollapsed') => () =>
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
      action: () => {
        const mode = this.settings.get().timeMode;
        if (mode === 'paused') this.settings.update({ timeMode: this.resumeMode });
        else {
          this.resumeMode = mode;
          this.settings.update({ timeMode: 'paused' });
        }
      },
    });
    this.keymap.register({ code: 'KeyL', keyLabel: 'L', label: vi.shortcuts.lowPower, action: toggleSetting('lowPower') });
    this.keymap.register({ code: 'Backquote', keyLabel: '`', label: vi.shortcuts.debug, action: toggleSetting('showDebug') });
  }

  private applySettings(s: Readonly<Settings>): void {
    const profile = effectiveProfile(s.quality, s.lowPower);
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
    const fps = s.lowPower ? LOW_POWER_FPS : NORMAL_FPS;
    this.loop.targetFps = fps;
    this.world.water.applyProfile(profile);
    this.world.water.setStepRate(fps);
    this.world.weather.setQuality(profile);
    this.world.grass.setCount(profile.grassCount);
    this.world.flowers.setCount(profile.flowerCount);
    this.env.waveStrength.target = s.waveStrength;
    this.overlay.setVisible(s.showDebug);
  }

  private readonly drawingBuffer = new THREE.Vector2();
  // Reused every frame (no per-frame allocations).
  private readonly skyOptions: SkyOptions = {
    mode: 'cycle24', clouds: 0, gloom: 0, rainbow: true, stars: true, meteors: 0, aurora: 0,
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

    const weather = this.world.weather;
    weather.setTargets(this.weatherTargets());
    weather.update(dt, wallSeconds());

    // Sky after weather: the time-of-day palette is greyed by the weather's overcast.
    const s = this.settings.get();
    const dayNight = this.world.dayNight;
    this.skyOptions.mode = s.timeMode;
    this.skyOptions.clouds = s.clouds;
    this.skyOptions.gloom = s.gloom;
    this.skyOptions.rainbow = s.rainbow;
    this.skyOptions.stars = s.stars;
    this.skyOptions.meteors = s.meteors;
    this.skyOptions.aurora = s.aurora;
    this.skyWeather.overcast = weather.overcast;
    this.skyWeather.rain = weather.rainAmount;
    this.skyWeather.wetness = weather.wetness;
    dayNight.update(dt, this.skyOptions, this.skyWeather, this.camera);
    const night = dayNight.night;
    this.world.fireflies.update(s.fireflies ? night * (1 - weather.rainAmount) * (1 - sharedUniforms.uSnow.value) : 0);
    this.mixer.setNight(night);
    this.panel.setClock(dayNight.hours);
    // Wind roughens the sea on top of the wave slider; the surf sound follows the same value.
    const sea = Math.min(1, this.env.waveStrength.value + weather.seaBoost);
    sharedUniforms.uWaveStrength.value = sea;
    this.mixer.setSeaState(sea);

    this.orbit.update(dt);
    this.world.update(dt, elapsed, this.camera, sea);
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
