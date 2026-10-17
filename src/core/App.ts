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
import { vi } from '../ui/strings.vi';

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

    this.overlay = new DebugOverlay(container, s, (patch) => this.settings.update(patch));
    this.settings.onChange((next) => this.applySettings(next));

    this.keymap.register({
      code: 'Backquote',
      label: vi.shortcuts.debug,
      action: () => this.settings.update({ showDebug: !this.settings.get().showDebug }),
    });
    this.keymap.register({
      code: 'KeyL',
      label: vi.shortcuts.lowPower,
      action: () => this.settings.update({ lowPower: !this.settings.get().lowPower }),
    });

    window.addEventListener('resize', this.onResize);
    this.loop = new Loop(this.tick);
    this.applySettings(s);
    this.onResize();
  }

  start(): void {
    this.loop.start();
  }

  private applySettings(s: Readonly<Settings>): void {
    const profile = effectiveProfile(s.quality, s.lowPower);
    const pixelRatio = Math.min(window.devicePixelRatio, profile.pixelRatioCap);
    if (pixelRatio !== this.renderer.getPixelRatio()) {
      // Resizing the canvas clears it, so only do it when the ratio really changes.
      this.renderer.setPixelRatio(pixelRatio);
      this.onResize();
    }

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
    this.env.waveStrength.target = s.waveStrength;
    this.overlay.sync(s);
  }

  private readonly drawingBuffer = new THREE.Vector2();

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
    sharedUniforms.uWaveStrength.value = this.env.waveStrength.value;

    this.orbit.update(dt);
    this.world.update(dt, elapsed, this.camera, this.env.waveStrength.value);
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
