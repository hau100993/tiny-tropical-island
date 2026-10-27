import * as THREE from 'three';
import { Loop } from './loop';
import { SettingsStore, mouseLook, safeLocalStorage, type CharacterId, type Settings, type SettingsPatch } from './settings';
import { NORMAL_FPS, QUALITY_PROFILES, VIDEO_FPS } from './quality';
import { sharedUniforms } from './uniforms';
import { EnvState } from './envState';
import { GpuTimer } from './gpuTimer';
import { createWorld, FOG_FAR, FOG_FAR_CLEAR, FOG_NEAR, FOG_NEAR_CLEAR, type World } from '../world/World';
import { ISLAND_SHADOW_HALF } from '../world/lighting';
import { createOrbitCamera, type OrbitCamera } from '../controls/orbit';
import { Keymap } from '../controls/keymap';
import { onWaterClick, type ClickAim } from '../controls/waterClick';
import { PetPointer } from '../controls/petPointer';
import { DragLook } from '../controls/dragLook';
import { SkillFx } from '../world/creatures/skillFx';
import { Bloom } from './bloom';
import { SkillCard, type SkillElement } from '../ui/skillCard';
import { Lightning } from '../world/creatures/lightning';
import { Scorcher } from '../world/scorch';
import { DogSkills, type DogSkill, type StrikeTarget } from '../activities/dogSkills';
import { Combos, type ComboId, type Partner } from '../activities/combos';
import { Ambush } from '../activities/ambush';
import { Health } from './health';
import { FloatBars } from '../ui/floatBars';
import { Petting } from '../activities/petting';
import { Hearts } from '../world/hearts';
import { PetCursor } from '../ui/PetCursor';
import { IslandColliders, type WalkSurface } from '../controls/islandColliders';
import { Walker, type StepEvent, type SwimStroke } from '../controls/walker';
import { CameraManager, type SeatId, type SeatSpot } from '../controls/CameraManager';
import type { HouseSeat } from '../world/house';
import { DeskView } from '../controls/deskView';
import { DeskScreens } from '../world/deskScreens';
import { DASH_PX, DeskDash, type ScreenInfo } from '../world/deskDash';
import { TodoBubbles } from '../world/todoBubbles';
import { DeskDashInput } from '../controls/deskDashInput';
import { AmbienceSwitch } from '../audio/ambienceSwitch';
import { formatClock, windowSkyTurn } from '../world/celestial';
import { WalkHint } from '../ui/WalkHint';
import { ActivityMenu, type ActivityCard } from '../ui/ActivityMenu';
import { BreathMeter } from '../ui/BreathMeter';
import { WaveMeter } from '../ui/WaveMeter';
import { Spray } from '../water/Spray';
import { KayakActivity } from '../activities/KayakActivity';
import { createKayakEnv } from '../activities/kayakEnv';
import type { BladeEvent, WaterSample } from '../activities/kayakPhysics';
import { SwimEffects } from '../activities/swimEffects';
import { SurfActivity } from '../activities/SurfActivity';
import type { PopUp, SurfEvent } from '../activities/surfPhysics';
import { Avatar, type AvatarPose, type AvatarRig, type SwimPose } from '../world/avatar';
// Type-only: the .glb modules (and three's GLTFLoader with them) are a separate chunk, fetched
// with the first character or the dog (see setCharacter and loadDog).
import type { GlbCharacter, CharacterSpec } from '../world/character';
import manUrl from '../assets/characters/man.glb?url';
import womanUrl from '../assets/characters/woman.glb?url';
import shibaUrl from '../assets/animals/shiba.glb?url';
import type { DogModel } from '../world/dog';
import { DogCompanion, type DogPlayer, type DogSpot } from '../activities/dogCompanion';
import { Creatures } from '../activities/creatures';
import { CHEER_AFTER, SeaShark } from '../activities/seaShark';
import { Embers } from '../world/creatures/embers';
import seaSharkUrl from '../assets/creatures/sea-shark.glb?url';
import type { ListenerState } from '../audio/spatial';
import type { FootSurface } from '../audio/synth/footsteps';
import type { LayerId } from '../audio/types';
import { DebugOverlay } from '../ui/DebugOverlay';
import { Panel, type ViewId } from '../ui/Panel';
import { AudioPrompt } from '../ui/AudioPrompt';
import { SlowHint } from '../ui/SlowHint';
import { isTouch, watchTouch } from '../ui/touch';
import { TouchControls, type TouchLayout } from '../ui/TouchControls';
import { touchInput } from '../controls/touchInput';
import { PomodoroOverlay } from '../ui/PomodoroOverlay';
import { Fullscreen, lockLandscape } from '../ui/fullscreen';
import { DeskVideo } from '../ui/DeskVideo';
import { vi } from '../ui/strings.vi';
import { Mixer } from '../audio/mixer';
import { SoundLibrary } from '../audio/library/SoundLibrary';
import { ScenePresetStore } from './scenePresets';
import type { WeatherTargets } from '../weather/Weather';
import { wallSeconds } from '../weather/wind';
import type { SkyOptions, SkyWeather } from '../world/dayNight';

/** Swimming closer than this (m) to the floating kayak climbs back in, once armed farther than REBOARD_ARM away. */
const REBOARD_NEAR = 1.4;
const REBOARD_ARM = 2.5;

/**
 * Shader clock restart (see Loop.resetElapsed): when the tab is hidden after this many seconds
 * of rendering, or behind a short fade after this many while it stays visible (overview or seat).
 */
const TIME_RESET_HIDDEN = 3600;
/** Upright screens zoom out at most this far (camera.zoom): 55° → ~81° vertical fov. */
const PORTRAIT_MIN_ZOOM = 0.6;
/**
 * Shadows while walking, paddling or surfing: a square of ±PLAYER_SHADOW_HALF m whose center
 * sits PLAYER_SHADOW_AHEAD m in front of you (you see more ahead than behind).
 */
const PLAYER_SHADOW_HALF = 50;
const PLAYER_SHADOW_AHEAD = 22;
const TIME_RESET_VISIBLE = 8 * 3600;
/** While hidden: how often the real-time clock still moves the night for the sound (ms). */
const HIDDEN_CLOCK_MS = 5000;

/** Weather level during a Pomodoro break with "Bão dịu đi khi nghỉ". */
const CALM_LEVEL = 0.3;
/** Time constant of the calm-down, seconds (≈ 20 s to settle). */
const CALM_EASE = 6;

/** Mochi out of health in a fight rests this long (s). */
const DOG_REST = 10;
/** A pat on Mochi sets off one of its skills this often (else a hop and a yip). */
const PAT_SKILL = 0.35;
/** Mochi's skills by their name-card keys (vi.creatures.skills). */
const DOG_SKILL_KEY: Record<DogSkill, string> = { zoom: 'dogZoom', bark: 'dogBark', zap: 'dogZap' };

/**
 * Characters from .glb files (Quaternius, CC0; see README), scaled to these standing heights.
 * They load the first time they are chosen.
 */
const CHARACTERS: Record<Exclude<CharacterId, 'default'>, CharacterSpec> = {
  man: { url: manUrl, height: 1.76 },
  woman: { url: womanUrl, height: 1.68 },
};

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
  private readonly kayak: KayakActivity;
  private readonly surf: SurfActivity;
  private readonly swimFx: SwimEffects;
  /** Air bubbles under water (exhaled while diving). */
  private readonly bubbles: Spray;
  private readonly breathMeter: BreathMeter;
  /** Surfing: when the next wave comes. */
  private readonly waveMeter: WaveMeter;
  /** Sea surface (with waves) at (x, z). */
  private readonly seaHeight: (x: number, z: number) => number;
  private bubbleTimer = 0;
  private outOfBreath = false;
  /** Snow's muffle (0..1); diving muffles everything a lot more. */
  private snowMuffle = 0;
  private readonly activityMenu: ActivityMenu;
  private readonly cameras: CameraManager;
  private readonly deskView: DeskView;
  private readonly deskScreens: DeskScreens;
  /** The right desk monitor: Pomodoro strip and to-do list. */
  private readonly deskDash: DeskDash;
  private readonly dashInput: DeskDashInput;
  /** "Bọt": bubbles out of the right monitor when a to-do is finished. */
  private readonly todoBubbles = new TodoBubbles(sharedUniforms.uDayLight);
  /** Soundscape on/off, shared by the right monitor and the video's corner button. */
  private readonly ambience: AmbienceSwitch;
  private readonly fader: HTMLElement;
  private faderTimer = 0;
  private readonly walkHint: WalkHint;
  /** Joystick and buttons on touch screens (see touchLayout). */
  private readonly touchControls: TouchControls;
  /** Full screen was entered by starting to play on a phone (left again in the overview). */
  private autoFullscreen = false;
  private readonly audioPrompt: AudioPrompt;
  private readonly slowHint: SlowHint;
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
  private readonly fullscreen = new Fullscreen();
  /** YouTube on the left desk monitor (U while seated at the desk). */
  private readonly deskVideo: DeskVideo;
  private readonly avatarRig: AvatarRig;
  private character: GlbCharacter | null = null;
  private characterId: CharacterId = 'default';
  /** Bumped per switch, so a slow load doesn't override a later choice. */
  private characterToken = 0;
  private readonly characterCache = new Map<CharacterId, GlbCharacter>();
  private dogModel: DogModel | null = null;
  private dog: DogCompanion | null = null;
  private dogLoading = false;
  private readonly dogPlayer: DogPlayer = { x: 0, z: 0, y: 0, speed: 0, onFoot: true, atSea: false, seat: null };
  private readonly dogLook = new THREE.Vector3();
  /** Bọt the water crab and Hỏa Long the fire dragon (activities/creatures.ts). */
  private readonly creatures: Creatures;
  /** Bé Mập, the baby shark who plays pranks on you at sea (activities/seaShark.ts). */
  private readonly beMap: SeaShark;
  /** Sea sparkle (Bé Mập's glowing trail at night). */
  private readonly seaGlow: Embers;
  /** Bé Mập's rainbow (its celebration of a long ride). */
  private readonly rainbow: Embers;
  /** The skills' flashes, shock waves, shake and framing; their bloom (High), their name cards. */
  private readonly fx: SkillFx;
  private readonly bloom: Bloom;
  private skillCard!: SkillCard;
  /** Mochi's bark and lightning (activities/dogSkills.ts), its bolts, what they scorch, soot and dust. */
  private readonly dogSkills: DogSkills;
  private readonly lightning = new Lightning();
  private readonly scorcher = new Scorcher();
  private readonly smoke: Embers;
  private readonly dust: Embers;
  private readonly you = { x: 0, y: 0, z: 0 };
  /** Forest fights: the shots, Mochi's health (resting s left when down), the bars over heads, the red flash. */
  private readonly ambush: Ambush;
  private readonly health = new Health(() => this.onDogDown());
  private floatBars!: FloatBars;
  private hurtEl!: HTMLElement;
  private dogDownT = 0;
  private readonly dogAt = { x: 0, y: 0, z: 0 };
  /** Two creatures' skills together (activities/combos.ts). */
  private readonly combos: Combos;
  private readonly viewXZ = { x: 0, z: 0 };
  /** Petting Mochi with the mouse (activities/petting.ts, controls/petPointer.ts). */
  private readonly petting = new Petting();
  private readonly petPointer: PetPointer;
  /**
   * Touch: a press on Mochi held still this long (s) sets off its skill (the J key) instead of
   * stroking; `petHold` is how long the current press has lasted, `petTravel` how far (px) it moved.
   */
  private static readonly PET_HOLD = 0.5;
  private petHold = 0;
  private petTravel = 0;
  private readonly petCursor: PetCursor;
  private readonly hearts: Hearts;
  /** Where the hand strokes the fur (world), and the far end of a stroke. */
  private readonly petHand = new THREE.Vector3();
  private readonly petBack = new THREE.Vector3();
  private readonly heartAt = new THREE.Vector3();
  private heartCount = 0;
  private readonly dogSupport = { y: 0, surface: 'sand' as WalkSurface, onPlatform: false };
  private readonly dogClear = { x: 0, z: 0 };
  /** Mochi's comet trail: motes per second still owed (see dogTrail). */
  private dogTrailIn = 0;
  private readonly earRight = new THREE.Vector3();
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
      // The canvas can be see-through where the desk video's screen is (DeskVideo.punchHole).
      alpha: true,
    });
    // Same clears as an opaque canvas (render targets included); only that hole is transparent.
    this.renderer.setClearAlpha(1);
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
      rocks: [...w.rocks.circles, ...w.hammock.circles],
    });
    this.walker = new Walker(
      this.camera,
      this.renderer.domElement,
      this.colliders,
      {
        onStep: (e) => this.onStep(e),
        onSwim: (swimming) => this.onSwim(swimming),
        onStroke: (e) => this.onSwimStroke(e),
        onDive: (under) => this.onDive(under),
        onView: (view) => this.settings.update({ walkView: view }),
      },
      () => this.reducedMotion.matches,
    );
    // The sea surface with its waves (the CPU twin of the water shader): the kayak floats on
    // it, the swimmer too.
    const seaEnv = createKayakEnv(w.heightmap, this.colliders, w.layout.boat, this.camera, sharedUniforms, w.layout.surf.frame);
    const sample: WaterSample = { height: 0, dhdx: 0, dhdz: 0 };
    this.seaHeight = (x, z) => seaEnv.water(x, z, sample).height;
    this.walker.setSea(this.seaHeight);
    this.bubbles = new Spray(sharedUniforms, 'bubbles', this.seaHeight);
    this.scene.add(this.bubbles.points);
    this.swimFx = new SwimEffects(w.water.wake, w.spray);
    this.kayak = new KayakActivity(
      this.camera,
      this.renderer.domElement,
      w.kayak,
      seaEnv,
      this.colliders,
      {
        onBlade: (e) => this.onBlade(e),
        onJump: () => this.jumpFromKayak(),
      },
      () => this.reducedMotion.matches,
      { wake: w.water.wake, spray: w.spray },
    );
    this.kayak.place(w.layout.kayak.x, w.layout.kayak.z, w.layout.kayak.rotY);
    this.surf = new SurfActivity(
      this.camera,
      this.renderer.domElement,
      w.surfboard,
      seaEnv,
      w.layout.surf.frame,
      this.colliders,
      {
        onPopUp: (r) => this.onPopUp(r),
        onEvent: (e) => this.onSurfEvent(e),
        onStroke: (side, strength) => {
          if (this.settings.get().footsteps) this.mixer.playPaddle('catch', 0.45 * strength, side * 0.5);
        },
        onCrash: (x, z) => this.onSurfCrash(x, z),
      },
      () => this.reducedMotion.matches,
      { wake: w.water.wake, spray: w.spray },
      () => sharedUniforms.uTime.value,
    );
    this.surf.place(w.layout.surf.board.x, w.layout.surf.board.z, w.layout.surf.board.rotY);
    this.deskView = new DeskView(this.camera, this.renderer.domElement);
    // House-local seat → world-space camera pose (desk faces the sea, the tub the forest).
    const spot = (h: HouseSeat): SeatSpot => {
      const seat = this.colliders.houseToWorld(h.seatX, h.seatZ, { x: 0, z: 0 });
      const stand = this.colliders.houseToWorld(h.standX, h.standZ, { x: 0, z: 0 });
      const yaw = this.colliders.seaYaw + (h.facesSea ? 0 : Math.PI);
      return { seat: { x: seat.x, y: h.eyeY, z: seat.z, yaw, pitch: h.pitch }, stand: { x: stand.x, z: stand.z, yaw } };
    };
    this.cameras = new CameraManager(this.camera, this.orbit, this.walker, this.deskView, this.kayak, this.surf, this.colliders.spawn, {
      desk: spot(w.house.desk),
      bath: spot(w.house.bath),
      hammock: this.hammockSpot(),
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
    this.deskScreens = new DeskScreens(w.house.screens[0], this.renderer.capabilities.getMaxAnisotropy());
    // The avatar's feet find the ground (terrain, house floor, steps) like the walker does.
    const support = { y: 0, surface: 'sand' as WalkSurface, onPlatform: false };
    this.avatar = new Avatar(sharedUniforms, (x, z, nearY) =>
      this.colliders.world.supportAt(x, z, nearY, support) ? support.y : nearY,
    );
    this.scene.add(this.avatar.group);
    this.avatarRig = this.avatar.rig;
    this.walker.setView(s.walkView);
    this.kayak.setView(s.walkView);
    this.surf.setView(s.walkView);
    onWaterClick(
      this.renderer.domElement,
      this.camera,
      (x, z) => this.world.water.addRipple(x, z, 3, -1.0),
      // A click on Mochi (or a creature) pets it instead.
      () =>
        this.petPointer.active || this.petPointer.hover || this.creatures.hover
          ? 'none'
          : this.cameras.mode === 'orbit'
            ? 'cursor'
            : this.walkClickAim(),
    );
    this.hearts = new Hearts(() => this.reducedMotion.matches);
    this.scene.add(this.hearts.group);
    this.petPointer = new PetPointer(this.renderer.domElement, this.camera, {
      aim: () => this.petAim(),
      // Walking, within a few steps (it comes to you); from above, wherever it is.
      hit: (ray) => {
        const d = this.dogModel?.hitTest(ray) ?? null;
        return d !== null && (this.cameras.mode !== 'walk' || d < 14);
      },
      onStart: () => this.startPetting(),
      onMove: (dx, dy) => {
        this.petTravel += Math.abs(dx) + Math.abs(dy);
        this.petting.move(dx, dy);
      },
      onEnd: (cancelled) => this.endPetting(cancelled),
    });
    // Rainbow motes: Bé Mập's and Mochi's celebrations, Bọt's geyser and more (shared).
    this.rainbow = new Embers(sharedUniforms, 'rainbow');
    this.scene.add(this.rainbow.points);
    this.fx = new SkillFx(this.scene, this.camera, () => this.reducedMotion.matches, (kind, size, x, y, z) => {
      const ear = this.settings.get().footsteps ? this.dogEar(x, y, z) : null;
      // Big sounds carry: at least a third as loud as up close, anywhere on the beach.
      if (ear) this.mixer.playSkill(kind, size, Math.max(ear.gain, 0.35), ear.pan);
    });
    this.bloom = new Bloom(this.renderer, this.scene, this.camera, QUALITY_PROFILES[this.settings.get().quality].msaa);
    this.creatures = this.createCreatures();
    this.smoke = new Embers(sharedUniforms, 'smoke');
    this.dust = new Embers(sharedUniforms, 'steam');
    this.scene.add(this.lightning.mesh, this.smoke.points, this.dust.points);
    this.dogSkills = this.createDogSkills();
    this.combos = this.createCombos();
    this.ambush = this.createAmbush();
    this.seaGlow = new Embers(sharedUniforms, 'sea');
    this.scene.add(this.seaGlow.points);
    this.beMap = this.createShark();
    this.listenShoo();

    this.overlay = new DebugOverlay(container, s.showDebug);
    this.settings.onChange((next) => this.applySettings(next));

    this.registerShortcuts();
    // Touch screens get finger-sized UI (body.touch).
    watchTouch();
    // UI layer above the canvas; hidden as a whole with the H key.
    const ui = document.createElement('div');
    ui.className = 'ui-layer';
    this.skillCard = new SkillCard(ui);
    this.floatBars = new FloatBars(ui);
    this.hurtEl = document.createElement('div');
    this.hurtEl.className = 'hurt-flash';
    ui.append(this.hurtEl);
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
      view: () => {
        const m = this.cameras.mode;
        return m === 'seat' ? this.cameras.seat : m === 'kayak' || m === 'surf' ? 'walk' : m;
      },
      onViewChange: (fn) => this.cameras.onChange(fn),
      goTo: (view) => this.goTo(view),
      pomodoro: () => {
        const p = this.pomodoro.snapshot();
        return p ? { remaining: p.remaining, running: p.running, visible: this.pomodoro.isVisible } : null;
      },
      togglePomodoro: () => this.pomodoro.setVisible(!this.pomodoro.isVisible),
      toggleTimePaused: () => this.toggleTimePaused(),
      fullscreen: this.fullscreen,
    });
    // Before the Pomodoro: its first tick may already report finished focus sessions.
    this.deskDash = new DeskDash(w.house.screens[1], this.renderer.capabilities.getMaxAnisotropy(), {
      info: () => this.screenInfo(),
      toggleTimer: () => this.pomodoro.toggleRunning(),
      skipPhase: () => this.pomodoro.skipPhase(),
      resetTimer: () => this.pomodoro.resetTimer(),
      chimeOn: () => this.pomodoro.chimeOn,
      toggleChime: () => this.pomodoro.toggleChime(),
      alertVolume: () => this.pomodoro.alertVolume,
      setAlertVolume: (v) => this.pomodoro.setAlertVolume(v),
      ambienceOn: () => this.ambience.on,
      toggleAmbience: () => this.ambience.toggle(),
      masterVolume: () => this.mixer.current.master.volume,
      setMasterVolume: (v) => this.mixer.setMaster({ volume: v }),
    });
    this.dashInput = new DeskDashInput(this.renderer.domElement, this.camera, w.house.screens[1], this.deskDash, ui);
    this.scene.add(this.todoBubbles.group);
    this.deskDash.onTaskDone = (done) => {
      // Reduced motion: no bubbles, one pop and the sparkle.
      const plan = this.reducedMotion.matches
        ? { launches: [], pops: [{ delay: 0.05, step: 0.5 }], finale: 0.15 }
        : this.todoBubbles.burst(w.house.screens[1], DASH_PX.w, DASH_PX.h, done, done.last);
      if (this.pomodoro.chimeOn) this.mixer.scheduleBubbleBurst(plan);
    };
    this.pomodoro = new PomodoroOverlay(ui, {
      scheduleChime: (atMs, kind) => this.mixer.scheduleChime(atMs, kind),
      soundOn: () => this.mixer.started,
      onCalm: (active) => {
        this.calmTarget = active ? CALM_LEVEL : 1;
        this.mixer.setCalm(this.calmTarget);
        this.library.setCalm(this.calmTarget);
      },
      setAlertVolume: (v) => this.mixer.setAlertVolume(v),
      onFocusDone: (count) => this.deskDash.addPomodoros(count),
    });
    this.audioPrompt = new AudioPrompt(ui);
    this.slowHint = new SlowHint(ui, () => this.settings.get().quality, (quality) => this.settings.update({ quality }));
    this.ambience = new AmbienceSwitch((muted) => this.mixer.setAmbienceMuted(muted));
    this.deskVideo = new DeskVideo(container, ui, this.camera, w.house.screens[0], {
      onPlaying: (playing) => this.ambience.setVideoPlaying(playing),
      master: () => this.mixer.current.master,
    });
    this.mixer.onChange(() => this.deskVideo.syncVolume());
    // No start screen: sound starts with the first click or key press anywhere (browsers
    // don't allow audio before that).
    for (const type of ['pointerdown', 'keydown'] as const) {
      window.addEventListener(type, () => this.onFirstGesture(), { capture: true });
    }
    // The panel offers a "Bật âm thanh" button; the prompt only reports a failed start.
    this.walkHint = new WalkHint(ui);
    this.touchControls = new TouchControls(ui);
    const rotateHint = document.createElement('div');
    rotateHint.className = 'rotate-hint';
    rotateHint.textContent = vi.touch.rotate;
    ui.append(rotateHint);
    this.petCursor = new PetCursor();
    this.activityMenu = new ActivityMenu(ui);
    // The card sits under the menu bar; it follows the panel (opened over it, faded out of sight).
    const dock = (): void => this.activityMenu.dock(this.panel.dockRect());
    this.panel.onLayout = () => {
      dock();
      // Again once the panel's own transition has settled.
      window.setTimeout(dock, 320);
    };
    window.addEventListener('resize', dock);
    dock();
    this.breathMeter = new BreathMeter(ui);
    this.waveMeter = new WaveMeter(ui);
    this.fader = document.createElement('div');
    this.fader.className = 'fader';
    container.append(this.fader);
    this.cameras.onChange((mode) => {
      const walking = mode === 'walk';
      const paddling = mode === 'kayak';
      const surfing = mode === 'surf';
      document.body.classList.toggle('walking', walking || paddling || surfing);
      this.panel.setWalking(walking || paddling || surfing);
      document.body.classList.toggle('at-desk', mode === 'seat');
      const atDesk = mode === 'seat' && this.cameras.seat === 'desk';
      this.deskVideo.setSeated(atDesk);
      this.dashInput.setActive(atDesk);
      // The monitor shows the Pomodoro: the floating card steps aside.
      document.body.classList.toggle('at-work-desk', atDesk);
      if (paddling) this.walkHint.update(true, vi.kayak.controls);
      else if (surfing) this.walkHint.update(true, this.surfControls());
      else this.walkHint.update(walking, this.walkControls());
      if (!walking && !paddling) this.activityMenu.set(null);
      const seat = this.cameras.seat;
      this.walkHint.showSeat(mode === 'seat', seat === 'bath' ? vi.bath.controls : seat === 'hammock' ? vi.hammock.controls : vi.desk.controls);
      this.listenerTimer = 0;
      this.playScreen(mode !== 'orbit');
      if (walking) this.avatar.setYaw(this.walker.yaw);
      if (mode === 'orbit') {
        this.listener.walking = false;
        this.mixer.setListener(this.listener);
      }
    });

    window.addEventListener('resize', this.onResize);
    this.loop = new Loop(this.tick);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.loop.elapsedSeconds > TIME_RESET_HIDDEN && this.cameras.mode !== 'surf') this.resetTime();
    });
    // Nothing renders while hidden (e.g. behind a full-screen editor), but the sound plays on:
    // the real clock still brings the night to it.
    window.setInterval(() => {
      if (!document.hidden) return;
      const s = this.settings.get();
      this.skyOptions.clock.mode = s.timeMode;
      this.world.dayNight.updateHidden(this.skyOptions.clock);
      this.mixer.setNight(this.world.dayNight.night);
    }, HIDDEN_CLOCK_MS);
    // A lost GPU context (driver reset, sleep) comes back by itself in three.js; the timer's
    // queries belong to the old context.
    this.renderer.domElement.addEventListener('webglcontextrestored', () => this.gpuTimer.reset());
    this.applySettings(s);
    if (s.startAtDesk) this.cameras.sit('desk', false);
    // Start in the saved weather instead of easing in from a clear sky.
    this.world.weather.setTargets(this.weatherTargets());
    this.world.weather.snapToTargets();
  }

  /**
   * Lying in the hammock: the eyes a third of the way in, head toward palm A, looking along it
   * to the feet and up into the fronds and the sky. You get up on the seaward side.
   */
  private hammockSpot(): SeatSpot {
    const h = this.world.hammock;
    const eye = h.restingEye(new THREE.Vector3());
    const yaw = Math.atan2(-h.dir.x, -h.dir.z);
    const r = Math.hypot(h.center.x, h.center.z) || 1;
    const ox = h.center.x / r;
    const oz = h.center.z / r;
    return {
      seat: { x: eye.x, y: eye.y, z: eye.z, yaw, pitch: 0.6, pitchMin: -0.5, pitchMax: 1.3, yawLimit: 1.5 },
      stand: { x: h.center.x + ox * 1.4, z: h.center.z + oz * 1.4, yaw: Math.atan2(ox, oz) },
    };
  }

  /** Every frame: the hammock swings; lying in it, the eyes swing along. */
  private updateHammock(dt: number): void {
    const h = this.world.hammock;
    const lying = this.cameras.mode === 'seat' && this.cameras.seat === 'hammock';
    h.update(dt, sharedUniforms.uWind.value, lying, this.reducedMotion.matches);
    if (!lying) return;
    const pose = this.deskView.seat;
    const eye = h.eyeWorld(this.tmpEye);
    const m = this.deskView.motion;
    m.x = eye.x - pose.x;
    m.y = eye.y - pose.y;
    m.z = eye.z - pose.z;
    m.roll = -h.roll;
  }

  private readonly tmpEye = new THREE.Vector3();

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
    this.snowMuffle = 0.8 * s.visualSnow;
    this.applyMuffle();
  }

  private readonly synthLevels: Record<LayerId, number> = { waves: 0, birds: 0, wind: 0, rain: 0, snow: 0 };
  private underMuffled = false;

  /** Snow muffles the world a little; with your head under water it is nearly all gone. */
  private applyMuffle(): void {
    this.mixer.setMuffle(this.snowMuffle);
    this.mixer.setUnderwater(this.underMuffled);
  }

  /**
   * The first frame would wait for every shader to compile (~100 programs: 15+ s with a cold
   * shader cache in Chrome on Windows, the page frozen). They compile in the background first.
   */
  start(): void {
    const note = document.createElement('div');
    note.className = 'loading-note';
    note.textContent = vi.loading;
    this.container.append(note);
    Promise.all([
      this.renderer.compileAsync(this.scene, this.camera),
      this.world.water.compileAsync(this.scene, this.camera),
    ])
      .catch((err: unknown) => console.warn('shader precompile failed', err))
      .finally(() => {
        note.remove();
        this.loop.start();
        this.panel.sceneShown();
      });
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
    this.keymap.register({
      code: 'KeyP',
      keyLabel: 'P',
      label: vi.shortcuts.panel,
      // Right after opening the page, P brings the tucked panel out first.
      action: () => this.panel.toggle(),
    });
    this.keymap.register({
      code: 'KeyH',
      keyLabel: 'H',
      label: vi.shortcuts.hideUI,
      action: () => {
        // The panel stays as a small handle in its corner (Panel.setUiHidden).
        this.panel.setUiHidden(document.body.classList.toggle('ui-hidden'));
      },
    });
    this.keymap.register({
      code: 'KeyU',
      keyLabel: 'U',
      label: vi.shortcuts.video,
      action: () => {
        if (this.cameras.mode === 'seat' && this.cameras.seat === 'desk') this.deskVideo.toggleCard();
        else if (!this.deskVideo.togglePlayback()) this.activityMenu.flash(vi.video.atDeskOnly);
      },
    });
    this.keymap.register({ code: 'KeyF', keyLabel: 'F', label: vi.shortcuts.fullscreen, action: () => this.fullscreen.toggle() });
    this.keymap.register({
      code: 'KeyG',
      keyLabel: 'G',
      label: vi.shortcuts.callDog,
      action: () => {
        this.dog?.call();
      },
    });
    this.keymap.register({
      code: 'KeyJ',
      keyLabel: 'J',
      label: vi.shortcuts.dogSkill,
      action: () => {
        const dog = this.dog;
        if (!dog) return;
        if (this.dogSkills.next(() => dog.zoomies(this.dogPlayer)) === 'noRoom') this.activityMenu.flash(vi.dog.zoomNoRoom);
      },
    });
    this.keymap.register({
      code: 'KeyR',
      keyLabel: 'R',
      label: vi.shortcuts.waterSkill,
      action: () => {
        const r = this.creatures.waterSkill();
        if (r === 'off') this.activityMenu.flash(vi.creatures.coming);
      },
    });
    this.keymap.register({
      code: 'KeyX',
      keyLabel: 'X',
      label: vi.shortcuts.fireSkill,
      action: () => {
        const r = this.creatures.fireSkill();
        if (r === 'off') this.activityMenu.flash(vi.creatures.coming);
      },
    });
    this.keymap.register({
      code: 'KeyZ',
      keyLabel: 'Z',
      label: vi.shortcuts.grassSkill,
      action: () => {
        const r = this.creatures.grassSkill();
        if (r === 'off') this.activityMenu.flash(vi.creatures.coming);
      },
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
        // In the kayak, E is the right-hand stroke (K steps out).
        if (this.cameras.mode === 'kayak') return;
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
      code: 'KeyK',
      keyLabel: 'K',
      label: vi.shortcuts.kayak,
      action: () => {
        if (this.cameras.mode === 'kayak') this.leaveKayak();
        else if (this.cameras.mode === 'walk' && this.nearSea()) this.boardKayak();
      },
    });
    this.keymap.register({
      code: 'KeyL',
      keyLabel: 'L',
      label: vi.shortcuts.surf,
      action: () => {
        if (this.cameras.mode === 'surf') this.leaveSurf();
        else if (this.cameras.mode === 'walk' && this.nearSea()) this.boardSurf();
      },
    });
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

  /** Shader clock back to 0 (see Loop.resetElapsed), with everything timed on it. */
  private resetTime(): void {
    this.loop.resetElapsed();
    sharedUniforms.uTime.value = 0;
    this.world.dayNight.onTimeReset();
    this.world.footprints.clear();
  }

  /** Long visible sessions: restart the shader clock behind a short fade, never mid-activity. */
  private maybeResetTimeVisible(): void {
    const m = this.cameras.mode;
    if (this.loop.elapsedSeconds < TIME_RESET_VISIBLE || (m !== 'orbit' && m !== 'seat')) return;
    this.fadeThrough(() => this.resetTime());
  }

  /** Overview and seats: the whole island; on the move: a sharper square around you. */
  private updateShadowFocus(): void {
    const m = this.cameras.mode;
    const lighting = this.world.lighting;
    if (m === 'orbit' || m === 'seat') {
      lighting.setShadowFocus(0, 0, ISLAND_SHADOW_HALF);
      return;
    }
    const p = m === 'kayak' ? this.kayak.body : m === 'surf' ? this.surf.body : this.walker;
    const f = this.camera.getWorldDirection(this.tmpDir);
    const fl = Math.hypot(f.x, f.z) || 1;
    lighting.setShadowFocus(p.x + (f.x / fl) * PLAYER_SHADOW_AHEAD, p.z + (f.z / fl) * PLAYER_SHADOW_AHEAD, PLAYER_SHADOW_HALF);
  }

  private readonly tmpDir = new THREE.Vector3();

  /** Device pixel ratio (zoom, another monitor) capped by the quality preset. */
  private targetPixelRatio(): number {
    return Math.min(window.devicePixelRatio, QUALITY_PROFILES[this.settings.get().quality].pixelRatioCap);
  }

  private applySettings(s: Readonly<Settings>): void {
    const profile = QUALITY_PROFILES[s.quality];
    // A new quality preset may change the pixel ratio cap.
    this.onResize();
    DragLook.sensitivity = mouseLook(s.mouseSpeed);

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
    if (s.walkView !== this.kayak.view) this.kayak.setView(s.walkView);
    if (s.walkView !== this.surf.view) this.surf.setView(s.walkView);
    this.library.setActivePreset(s.activeScene);
    this.updateSynth();
    this.overlay.setVisible(s.showDebug);
    if (s.character !== this.characterId) this.setCharacter(s.character);
    // Mochi, the creatures, the wild ones and Bé Mập are always there (no switches since 2026-10-25).
    if (!this.dogModel && !this.dogLoading) this.loadDog();
    this.creatures.setEnabled(true, true, true);
    this.creatures.setWild(true, true);
    this.beMap.setEnabled(true);
  }

  /**
   * A click (a press and release without dragging) on Bé Mập while it comes for you shoos it
   * away: at the cursor, or at the screen centre while the pointer is locked.
   */
  private listenShoo(): void {
    const dom = this.renderer.domElement;
    const ndc = new THREE.Vector2();
    const ray = new THREE.Raycaster();
    let downX = 0;
    let downY = 0;
    let downT = 0;
    dom.addEventListener('pointerdown', (e) => {
      downX = e.clientX;
      downY = e.clientY;
      downT = performance.now();
    });
    dom.addEventListener('pointerup', (e) => {
      if (e.button !== 0 || Math.hypot(e.clientX - downX, e.clientY - downY) > 6 || performance.now() - downT > 400) return;
      if (document.pointerLockElement === dom) {
        ndc.set(0, 0);
      } else {
        const r = dom.getBoundingClientRect();
        ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      }
      ray.setFromCamera(ndc, this.camera);
      this.beMap.shoo(ray.ray);
    });
  }

  /**
   * Bé Mập: comes to play when you are at sea (kayak, surf, swim, dive). Its pranks rock, spin
   * or capsize the kayak, knock the surfer off, shove a swimmer, and always get you wet.
   */
  private createShark(): SeaShark {
    const hm = this.world.heightmap;
    return new SeaShark({
      seaHeight: this.seaHeight,
      ground: (x, z) => hm.heightAt(x, z),
      ripple: (x, z, radius, strength) => this.world.water.addRipple(x, z, radius, strength),
      spray: this.world.spray,
      bubbles: this.bubbles,
      player: (out) => {
        const m = this.cameras.mode;
        const w = this.walker;
        if (m === 'kayak') {
          out.mode = 'kayak';
          out.x = this.kayak.body.x;
          out.z = this.kayak.body.z;
        } else if (m === 'surf') {
          out.mode = 'surf';
          out.x = this.surf.body.x;
          out.z = this.surf.body.z;
        } else if (m === 'walk' && w.swimming) {
          out.mode = w.diving ? 'dive' : 'swim';
          out.x = w.x;
          out.z = w.z;
        } else {
          out.mode = null;
          return;
        }
        out.y = out.mode === 'dive' ? w.bodyY : this.seaHeight(out.x, out.z);
      },
      kayak: {
        jolt: (roll, heave) => this.kayak.jolt(roll, heave),
        shove: (spin, vx, vz) => this.kayak.shove(spin, vx, vz),
        capsize: (side) => this.kayak.capsize(side),
        splash: (n) => this.kayak.splashBurst(n),
      },
      surfKnock: () => this.surf.knockOff(),
      rideTime: () => this.surf.body.rideTime,
      rainbow: this.rainbow,
      swimPush: (vx, vz, vy) => {
        this.walker.vel.x += vx;
        this.walker.vel.y += vz;
        if (this.walker.diving) this.walker.vy += vy;
      },
      soak: () => {
        this.soaked = 1;
      },
      glow: this.seaGlow,
      night: () => 1 - sharedUniforms.uDayLight.value,
      notify: (kind) => this.activityMenu.flash(kind === 'friend' ? vi.creatures.sharkFriend : kind === 'cheer' ? vi.creatures.sharkCheer(CHEER_AFTER) : vi.creatures.sharkShoo),
      sound: {
        splash: (g, p) => this.mixer.playSurfCrash(g, p),
        giggle: (g, p) => this.mixer.playCrab('dance', g, p),
      },
      ear: (x, y, z) => (this.settings.get().footsteps ? this.dogEar(x, y, z) : null),
      load: async () => {
        const { SharkModel } = await import('../world/creatures/sharkModel');
        const model = await SharkModel.load(seaSharkUrl);
        await this.renderer.compileAsync(model.root, this.camera, this.scene);
        this.scene.add(model.root);
        return model;
      },
    });
  }

  /**
   * The elemental creatures: Bọt lives on the hammock's beach, Hỏa Long loops over the beach in
   * front of the house, Mầm wanders the grass between the house and the beach. They see you only walking about (not swimming); their sounds follow
   * Âm thanh hoạt động; water soaks you like a swim, fire dries you.
   */
  private createCreatures(): Creatures {
    const hm = this.world.heightmap;
    const hammock = this.world.hammock.center;
    const crabAngle = Math.atan2(hammock.z, hammock.x) + 0.12;
    const crabR = hm.shoreDistance(crabAngle, 0.5);
    const house = this.world.layout.house;
    const dragonAngle = Math.atan2(house.z, house.x) - 0.25;
    const dragonR = hm.shoreDistance(dragonAngle, 0.3);
    // Mầm: the open lawn by the stepping stones, between the house and the beach.
    const hl = Math.hypot(house.x, house.z) || 1;
    const bunnyX = house.x + (house.x / hl) * 10;
    const bunnyZ = house.z + (house.z / hl) * 10;
    const ear = (x: number, y: number, z: number): { gain: number; pan: number } | null =>
      this.settings.get().footsteps ? this.dogEar(x, y, z) : null;
    return new Creatures({
      scene: this.scene,
      camera: this.camera,
      renderer: this.renderer,
      shared: sharedUniforms,
      heightAt: (x, z) => hm.heightAt(x, z),
      seaRadius: (angle) => hm.shoreDistance(angle, -0.3),
      ripple: (x, z, radius, strength) => this.world.water.addRipple(x, z, radius, strength),
      homes: {
        crab: { x: Math.cos(crabAngle) * crabR, z: Math.sin(crabAngle) * crabR },
        dragon: { x: Math.cos(dragonAngle) * dragonR, z: Math.sin(dragonAngle) * dragonR },
        bunny: { x: bunnyX, z: bunnyZ },
      },
      house: { x: house.x, z: house.z },
      rainbow: this.rainbow,
      wildWindup: (a) => this.ambush.windup(a),
      wildAttack: (a) => this.ambush.attack(a),
      fx: this.fx,
      skillCard: (skill, element, x, z) => {
        this.showSkill(skill, element);
        if (element !== 'combo') this.combos.note(element, x, z);
      },
      trunks: this.world.forest.trunks,
      treesNear: (x, z, r) => this.colliders.treesNear(x, z, r),
      aim: () => this.creatureAimMode(),
      dogHover: () => this.petPointer.hover,
      player: (out) => {
        const w = this.walker;
        if (this.cameras.mode !== 'walk' || w.swimming) return false;
        out.x = w.x;
        out.z = w.z;
        out.y = w.feetY;
        return true;
      },
      rain: () => this.world.weather.rainAmount,
      ear,
      sound: {
        squirt: (d, g, p) => this.mixer.playSquirt(d, g, p),
        crab: (k, g, p) => this.mixer.playCrab(k, g, p),
        flame: (d, g, p) => this.mixer.playFlame(d, g, p),
        dragon: (k, g, p) => this.mixer.playDragon(k, g, p),
        leaves: (d, g, p) => this.mixer.playLeaves(d, g, p),
        bunny: (k, g, p) => this.mixer.playBunny(k, g, p),
      },
      // Soaked like after a swim (it dries, and drips, the same way); fire dries you at once.
      soak: () => {
        this.soaked = Math.max(this.soaked, 0.6);
      },
      dry: () => {
        this.soaked = 0;
      },
    });
  }

  /** Mochi's skills: what they need from the island, you and the other creatures. */
  private createDogSkills(): DogSkills {
    const hm = this.world.heightmap;
    return new DogSkills({
      dog: () => this.dog,
      head: (out) => (this.dog && this.dogModel ? this.dogModel.headTop(out) : null),
      player: () => {
        const w = this.walker;
        if (this.cameras.mode !== 'walk' || w.swimming) return null;
        this.you.x = w.x;
        this.you.y = w.feetY;
        this.you.z = w.z;
        return this.you;
      },
      knockDown: (x, z) => this.walker.knockDown(x, z),
      targets: (x, z, r, out) => this.strikeTargets(x, z, r, out),
      startle: (x, z, r) => this.creatures.startle(x, z, r),
      heightAt: (x, z) => hm.heightAt(x, z),
      ripple: (x, z, radius, strength) => this.world.water.addRipple(x, z, radius, strength),
      fx: this.fx,
      lightning: this.lightning,
      scorch: this.scorcher,
      sparks: this.rainbow,
      smoke: this.smoke,
      dust: this.dust,
      card: (s) => {
        this.showSkill(DOG_SKILL_KEY[s], s === 'bark' ? 'water' : 'spark');
        const dog = this.dog;
        if (dog) this.combos.note('spark', dog.x, dog.z);
      },
    });
  }

  /** Fights in the forest: who can be hit, what a hit does, Mochi on guard and striking back. */
  private createAmbush(): Ambush {
    const hm = this.world.heightmap;
    const pools = this.creatures.pools;
    return new Ambush({
      fx: this.fx,
      embers: pools.embers,
      spores: pools.spores,
      fluff: pools.fluff,
      spray: pools.spray,
      bubbles: pools.bubbles,
      heightAt: (x, z) => hm.heightAt(x, z),
      you: () => {
        const w = this.walker;
        if (this.cameras.mode !== 'walk' || w.swimming) return null;
        this.you.x = w.x;
        this.you.y = w.feetY;
        this.you.z = w.z;
        return this.you;
      },
      dog: () => {
        const dog = this.dog;
        if (!dog || !this.dogModel?.root.visible || this.health.isDown) return null;
        this.dogAt.x = dog.x;
        this.dogAt.y = dog.y;
        this.dogAt.z = dog.z;
        return this.dogAt;
      },
      guard: (x, z, fx, fz) => this.dog?.guard(x, z, fx, fz) ?? false,
      splashYou: (kind) => {
        // No health for you: a red flash at the screen's edge, and water soaks you, fire dries you.
        this.hurtFlash();
        if (kind === 'crab') this.soaked = Math.max(this.soaked, 0.6);
        else if (kind === 'dragon') this.soaked = 0;
      },
      hitDog: (_kind, amount) => {
        const dog = this.dog;
        if (dog && this.settings.get().footsteps) {
          const ear = this.dogEar(dog.x, dog.y, dog.z);
          if (ear) this.mixer.playBark('yip', ear.gain, ear.pan);
        }
        this.dogModel?.hop();
        this.health.hit(amount);
      },
      counter: (a, hit) => !this.health.isDown && this.dogSkills.counter(a, hit),
    });
  }

  /** You were hit in a fight: the screen's edge flashes red for a moment. */
  private hurtFlash(): void {
    const f = this.hurtEl;
    f.classList.remove('on');
    void f.offsetWidth;
    f.classList.add('on');
  }

  /** Mochi out of health: it lies down to rest a while, then gets up at half. */
  private onDogDown(): void {
    const dog = this.dog;
    if (dog) dog.act(DOG_REST, dog.x + Math.sin(dog.yaw), dog.z + Math.cos(dog.yaw), 'lie');
    this.dogDownT = DOG_REST;
  }

  /** The fights, Mochi's rest, and the bars over heads, every frame. */
  private updateHealth(dt: number): void {
    this.health.update(dt, this.petting.stroking);
    this.ambush.update(dt);
    if (this.dogDownT > 0) {
      this.dogDownT -= dt;
      if (this.dogDownT <= 0) this.health.restore(50);
    }
    const bars = this.floatBars;
    bars.begin();
    const dog = this.dog;
    const model = this.dogModel;
    // Mochi's: in a fight, or while it is hurt.
    if (dog && model?.root.visible && (this.ambush.fighting || this.health.hurt)) {
      model.headTop(this.heartAt);
      bars.add(this.camera, this.heartAt.x, this.heartAt.y + 0.35, this.heartAt.z, this.health.hp, 'dog');
    }
    for (const f of this.ambush.fights) bars.add(this.camera, f.a.x, f.a.y + 0.5, f.a.z, f.hp, f.a.kind);
    bars.end();
  }

  /** Combos: the creatures' effect pools, where you are, who could join in. */
  private createCombos(): Combos {
    const hm = this.world.heightmap;
    const pools = this.creatures.pools;
    return new Combos({
      fx: this.fx,
      lightning: this.lightning,
      embers: pools.embers,
      steam: pools.steam,
      spores: pools.spores,
      rainbow: this.rainbow,
      spray: pools.spray,
      heightAt: (x, z) => hm.heightAt(x, z),
      bloom: (x, z, n) => pools.bloom(x, z, n),
      ripple: (x, z, radius, strength) => this.world.water.addRipple(x, z, radius, strength),
      stage: (out) => {
        const w = this.walker;
        if (this.cameras.mode !== 'walk' || w.swimming) return null;
        // In front of you, where you are looking.
        return out.set(w.x - Math.sin(w.yaw) * 5, 0, w.z - Math.cos(w.yaw) * 5);
      },
      viewer: () => {
        this.viewXZ.x = this.camera.position.x;
        this.viewXZ.z = this.camera.position.z;
        return this.viewXZ;
      },
      partners: (x, z, r, except) => {
        const out: Partner[] = [];
        this.creatures.partners(x, z, r, except, out);
        const dog = this.dog;
        if (except !== 'spark' && dog && Math.hypot(dog.x - x, dog.z - z) < r) {
          out.push({ element: 'spark', x: dog.x, z: dog.z, start: () => this.dogSkills.join() });
        }
        return out;
      },
      card: (id: ComboId) => this.showSkill(id, 'combo'),
    });
  }

  /**
   * What Mochi's lightning may strike from (x, z) within r m: you (walking), a few of the trees
   * and rocks, the house, the other creatures, and the sea if it is in reach.
   */
  private strikeTargets(x: number, z: number, r: number, out: StrikeTarget[]): void {
    const hm = this.world.heightmap;
    const w = this.walker;
    if (this.cameras.mode === 'walk' && !w.swimming && Math.hypot(w.x - x, w.z - z) < r) {
      out.push({ x: w.x, y: w.feetY + 1.2, z: w.z, kind: 'you', body: this.avatar.group.visible ? this.avatar.group : null });
    }
    // A few trees: the nearest ones, at a random height up the trunk.
    let trees = 0;
    for (const t of this.world.forest.trunks) {
      if (trees >= 4 || Math.hypot(t.x - x, t.z - z) > r || Math.random() < 0.5) continue;
      out.push({ x: t.x, y: hm.heightAt(t.x, t.z) + 1.2 + Math.random() * 2, z: t.z, kind: 'tree', body: null });
      trees++;
    }
    for (const c of this.world.rocks.circles) {
      if (Math.hypot(c.x - x, c.z - z) > r) continue;
      out.push({ x: c.x, y: hm.heightAt(c.x, c.z) + c.r * 0.6, z: c.z, kind: 'rock', body: null });
    }
    const house = this.world.layout.house;
    if (Math.hypot(house.x - x, house.z - z) < r + 3) {
      out.push({ x: house.x, y: hm.heightAt(house.x, house.z) + 4.5, z: house.z, kind: 'house', body: null });
    }
    this.creatures.strikeTargets(x, z, r, out);
    // The sea: a point on the water within reach, if there is one.
    const a0 = Math.random() * Math.PI * 2;
    for (let k = 0; k < 8; k++) {
      const a = a0 + (k / 8) * Math.PI * 2;
      const sx = x + Math.cos(a) * r * 0.7;
      const sz = z + Math.sin(a) * r * 0.7;
      if (hm.heightAt(sx, sz) < -0.3) {
        out.push({ x: sx, y: 0.1, z: sz, kind: 'sea', body: null });
        break;
      }
    }
  }

  /** A skill you set off (a key or a click): its name card. */
  private showSkill(skill: string, element: SkillElement): void {
    const name = vi.creatures.skills[skill];
    if (name) this.skillCard.show(name, element);
  }

  /** Mochi the dog: loaded on first use (a .glb, ~0.8 MB). See activities/dogCompanion.ts. */
  private loadDog(): void {
    this.dogLoading = true;
    import('../world/dog')
      .then(({ DogModel }) => DogModel.load(shibaUrl, sharedUniforms))
      .then((model) => {
        this.dogModel = model;
        this.scene.add(model.root);
        model.root.visible = true;
        const h = this.world.house;
        const c = this.colliders;
        // A spot in the room (house-local), facing a house-local point; on the floor.
        const roomSpot = (lx: number, lz: number, fx: number, fz: number): DogSpot => {
          const p = c.houseToWorld(lx, lz, { x: 0, z: 0 });
          const f = c.houseToWorld(fx, fz, { x: 0, z: 0 });
          return { x: p.x, y: h.floorY, z: p.z, yaw: Math.atan2(f.x - p.x, f.z - p.z) };
        };
        // Beside the hammock, facing it.
        const hm = this.world.hammock;
        const hx = hm.center.x - hm.dir.z * 1.4;
        const hz = hm.center.z + hm.dir.x * 1.4;
        const w = this.walker;
        this.dog = new DogCompanion(
          {
            groundAt: (x, z, nearY) => (c.world.supportAt(x, z, nearY, this.dogSupport) ? this.dogSupport.y : this.world.heightmap.heightAt(x, z)),
            terrainAt: (x, z) => this.world.heightmap.heightAt(x, z),
            // Sitting by the desk chair, looking up at you; lying by the bath's open side.
            deskSpot: roomSpot(h.desk.seatX + 0.7, h.desk.seatZ - 0.35, h.desk.seatX, h.desk.seatZ),
            bathSpot: roomSpot(h.bath.standX - 0.5, h.bath.standZ + 0.35, h.bath.seatX, h.bath.seatZ),
            hammockSpot: { x: hx, y: this.world.heightmap.heightAt(hx, hz), z: hz, yaw: Math.atan2(hm.center.x - hx, hm.center.z - hz) },
            inRoom: (x, z, y) => c.shelterAt(x, z, y) === 'room',
            clear: (x, z, y) => {
              if (this.world.heightmap.heightAt(x, z) < 0.15 || c.shelterAt(x, z, y) !== 'none') return false;
              c.world.resolve(x, z, y, 0.4, this.dogClear);
              return this.dogClear.x === x && this.dogClear.z === z;
            },
          },
          {
            onStep: (x, z, y, yaw, side, speed) => this.onDogStep(x, z, y, yaw, side, speed),
            onBark: (kind) => {
              if (!this.dog || !this.settings.get().footsteps) return;
              const ear = this.dogEar(this.dog.x, this.dog.y, this.dog.z);
              if (ear) this.mixer.playBark(kind, ear.gain, ear.pan);
            },
            onZoom: (phase) => this.onDogZoom(phase),
          },
          { x: w.x + 1.5, z: w.z + 1.5 },
        );
      })
      .catch((err: unknown) => console.warn('dog load failed', err))
      .finally(() => {
        this.dogLoading = false;
      });
  }

  /**
   * Where the pointer aims at Mochi: the cursor, from above or walking (not swimming).
   */
  private petAim(): ClickAim {
    if (!this.dog || !this.dogModel?.root.visible) return 'none';
    return this.petAimMode();
  }

  /** Pointing at an animal: the cursor, from above or walking (not swimming). */
  private petAimMode(): ClickAim {
    const m = this.cameras.mode;
    if (m === 'orbit') return 'cursor';
    if (m !== 'walk' || this.walker.swimming) return 'none';
    return 'cursor';
  }

  /**
   * Clicking or tapping a creature (its skill): also from the water, the kayak and the board
   * (on a phone that's the only way to set them off there). Not under water.
   */
  private creatureAimMode(): ClickAim {
    const m = this.cameras.mode;
    if (m === 'orbit' || m === 'kayak' || m === 'surf') return 'cursor';
    return m === 'walk' && !this.walker.diving ? 'cursor' : 'none';
  }

  /** Walking, paddling or surfing: a click splashes at the cursor. */
  private walkClickAim(): ClickAim {
    const m = this.cameras.mode;
    return m === 'walk' || m === 'kayak' || m === 'surf' ? 'cursor' : 'none';
  }

  /** Pressed on Mochi: walking, it comes to sit in front of you for your hand; from above it stays put. */
  private startPetting(): void {
    if (!this.dog) return;
    this.petHold = 0;
    this.petTravel = 0;
    const walking = this.cameras.mode === 'walk';
    this.petting.start();
    // It sits ahead of you, seen from behind a little to the right (so your body doesn't hide
    // it from the camera); through the eyes, straight ahead.
    const yaw = this.walker.yaw;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const side = this.walker.view === 'third' ? 0.83 : 0;
    const ahead = this.walker.view === 'third' ? 0.55 : 1;
    this.dog.startPetting(walking, fx * ahead - fz * side, fz * ahead + fx * side);
  }

  private endPetting(cancelled: boolean): void {
    if (cancelled) this.petting.cancel();
    else this.petting.end();
    this.dog?.stopPetting();
    if (this.petting.takePat()) {
      // Now and then a pat sets off one of its skills instead of a hop.
      const dog = this.dog;
      if (dog && this.dogSkills.maybeOnPat(PAT_SKILL, () => dog.zoomies(this.dogPlayer))) return;
      dog?.pet();
      this.dogModel?.hop();
    }
  }

  /**
   * "Shooting Star": a comet's tail of golden sparkles behind it while it runs (the rainbow
   * motes, hues from orange to pale yellow), ~90 a second, drifting up a little off its back.
   */
  private dogTrail(dt: number): void {
    const dog = this.dog;
    if (!dog) return;
    this.dogTrailIn -= dt * 90;
    const bx = -Math.sin(dog.yaw);
    const bz = -Math.cos(dog.yaw);
    for (; this.dogTrailIn <= 0; this.dogTrailIn += 1) {
      const j = (): number => (Math.random() - 0.5) * 0.18;
      this.rainbow.emit(dog.x + bx * 0.3 + j(), dog.y + dog.lift + 0.28 + j(), dog.z + bz * 0.3 + j(), bx * 0.4 + j(), 0.6 + Math.random() * 0.6, bz * 0.4 + j(), 0.05 + Math.random() * 0.05, 0.08 + Math.random() * 0.1);
    }
  }

  /** Mochi's special move: the start (a puff of sand), the leap (a ring), the landing (a burst, hearts). */
  private onDogZoom(phase: 'start' | 'leap' | 'land'): void {
    const dog = this.dog;
    const model = this.dogModel;
    if (!dog || !model) return;
    const n = phase === 'land' ? 140 : phase === 'leap' ? 40 : 0;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const c = phase === 'land' ? Math.random() : Math.random() * 0.3;
      const sn = Math.sqrt(1 - c * c);
      const v = phase === 'land' ? 2.5 + Math.random() * 2.5 : 1.5;
      // Mostly gold, a few in every colour.
      const hue = Math.random() < 0.7 ? 0.08 + Math.random() * 0.1 : Math.random() * 0.8;
      this.rainbow.emit(dog.x, dog.y + dog.lift + 0.3, dog.z, Math.cos(a) * sn * v, c * v + 0.8, Math.sin(a) * sn * v, 0.05 + Math.random() * 0.06, hue);
    }
    if (phase === 'land') {
      this.hearts.spawn(model.headTop(this.heartAt));
      this.hearts.spawn(model.headTop(this.heartAt));
    }
  }

  /** Every frame: where you are for Mochi, its move, then its animation; petting and hearts. */
  private updateDog(dt: number): void {
    const model = this.dogModel;
    const dog = this.dog;
    this.hearts.update(dt);
    if (!model || !dog || !model.root.visible) {
      this.petPointer.cancel();
      this.petCursor.set(this.creatures.hover ? 'hover' : 'none');
      return;
    }
    const w = this.walker;
    const mode = this.cameras.mode;
    const p = this.dogPlayer;
    p.seat = mode === 'seat' ? this.cameras.seat : null;
    p.atSea = mode === 'kayak' || mode === 'surf' || ((mode === 'walk' || mode === 'orbit') && w.swimming);
    p.onFoot = (mode === 'walk' || mode === 'orbit') && !w.swimming;
    const body = mode === 'kayak' ? this.kayak.body : mode === 'surf' ? this.surf.body : null;
    p.x = body ? body.x : w.x;
    p.z = body ? body.z : w.z;
    p.y = w.feetY;
    p.speed = p.onFoot ? w.speed : 0;
    const pp = this.petPointer;
    pp.update();
    // Walking off (or swimming, sitting, another view) ends the stroking.
    if (pp.active && (!p.onFoot || p.seat !== null || w.speed > 0.6 || this.petAim() === 'none')) pp.cancel();
    // Touch: held still on it, a long press: its skill (J) instead of a stroke.
    if (pp.active && isTouch()) {
      this.petHold += dt;
      if (this.petHold >= App.PET_HOLD && this.petTravel < 12) {
        pp.cancel();
        this.keymap.run('KeyJ');
      }
    }
    this.petting.update(dt);
    dog.affection = this.petting.affection;
    this.petCursor.set(pp.active ? 'grab' : pp.hover || this.creatures.hover ? 'hover' : 'none');
    dog.update(dt, p);
    model.root.position.set(dog.x, dog.y + dog.lift, dog.z);
    model.root.rotation.y = dog.yaw;
    model.root.rotation.z = dog.bank;
    if (dog.zooming) this.dogTrail(dt);
    // It looks at you when you're close (at the camera while stroked from above).
    const stroking = this.petting.stroking;
    const near = Math.hypot(p.x - dog.x, p.z - dog.z) < 6;
    const look = stroking && this.cameras.mode === 'orbit' ? this.dogLook.copy(this.camera.position) : near ? this.dogLook.set(p.x, p.y + 1.4, p.z) : null;
    model.update(dt, dog.action, dog.speed, dog.wag, look, stroking ? 1 : 0);
    // The hand on the fur: from the head down the back with the strokes, lifted on the way back.
    model.petPoints(this.petHand, this.petBack);
    this.petHand.lerp(this.petBack, this.petting.stroke);
    if (this.petting.returning) this.petHand.y += 0.04;
    // Hearts rise from its head; now and then a happy little yip.
    const hearts = this.petting.takeHearts();
    for (let i = 0; i < hearts; i++) {
      this.hearts.spawn(model.headTop(this.heartAt));
      this.heartCount++;
      if (this.heartCount % 5 === 0 && this.settings.get().footsteps) {
        const ear = this.dogEar(dog.x, dog.y, dog.z);
        if (ear) this.mixer.playBark('yip', ear.gain * 0.5, ear.pan);
      }
    }
  }

  /** A paw down: a print on sand or snow, and the patter when activity sounds are on. */
  private onDogStep(x: number, z: number, y: number, yaw: number, side: number, speed: number): void {
    const sup = this.dogSupport;
    const surface: WalkSurface = this.colliders.world.supportAt(x, z, y, sup) ? sup.surface : 'sand';
    const snowy = sharedUniforms.uSnowCover.value > 0.45;
    const onSnow = snowy && surface !== 'wood' && surface !== 'water';
    // The footprints use the walker's yaw (forward is (−sin, −cos)); the dog's forward is (sin, cos).
    if (!sup.onPlatform && (onSnow || surface === 'sand')) this.world.footprints.add(x, z, yaw + Math.PI, side, onSnow, false, true);
    if (!this.settings.get().footsteps) return;
    const ear = this.dogEar(x, y, z);
    if (ear) this.mixer.playPaw(onSnow ? 'snow' : surface, ear.gain * (0.5 + 0.15 * Math.min(4, speed)), ear.pan);
  }

  /** How a sound at (x, y, z) reaches you: quieter with distance, panned to its side. */
  private dogEar(x: number, y: number, z: number): { gain: number; pan: number } | null {
    const cam = this.camera.position;
    const dx = x - cam.x;
    const dz = z - cam.z;
    const d = Math.hypot(dx, y - cam.y, dz);
    if (d > 25) return null;
    this.earRight.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const pan = d > 0.01 ? (dx * this.earRight.x + dz * this.earRight.z) / d : 0;
    return { gain: 1 / (1 + d * 0.35), pan };
  }

  /**
   * Switches who you walk around as. A .glb character loads on first use (a moment); until then
   * the current body stays. It wears the same skeleton: see world/character.ts.
   */
  private setCharacter(id: CharacterId): void {
    this.characterId = id;
    const token = ++this.characterToken;
    const spec = id === 'default' ? null : CHARACTERS[id];
    if (!spec) {
      this.wearCharacter(null);
      return;
    }
    const cached = this.characterCache.get(id);
    if (cached) {
      this.wearCharacter(cached);
      return;
    }
    this.activityMenu.flash(vi.panel.characterLoading);
    import('../world/character')
      .then(({ GlbCharacter }) => GlbCharacter.load(spec, { ...sharedUniforms, uWetness: this.avatar.wetness }))
      .then((c) => {
        this.characterCache.set(id, c);
        // Chosen something else meanwhile: keep it for later, don't wear it.
        if (token === this.characterToken) this.wearCharacter(c);
      })
      .catch((err: unknown) => {
        console.warn('character load failed', err);
        if (token !== this.characterToken) return;
        this.activityMenu.flash(vi.panel.characterFailed);
        this.settings.update({ character: 'default' });
      });
  }

  private wearCharacter(c: GlbCharacter | null): void {
    this.character?.root.removeFromParent();
    this.character = c;
    this.avatar.setBodyScale(c ? c.bodyScale : 1);
    this.avatar.setOwnBodyVisible(!c);
    if (c) this.avatar.group.add(c.root);
  }

  /** After the procedural body is posed: a worn character copies the pose. */
  private syncCharacter(): void {
    this.character?.sync(this.avatarRig);
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

  /** Walking on the beach or in the shallows: the sea activities are on offer. */
  private nearSea(): boolean {
    const w = this.walker;
    if (w.shelter !== 'none') return false;
    if (w.swimming) return !w.diving;
    return w.depth > 0 || (this.world.heightmap.distanceToShore(w.x, w.z) < 9 && w.surface === 'sand');
  }

  /** Feet in the water (wading or swimming): only then does the sea card show. */
  private inSea(): boolean {
    const w = this.walker;
    if (w.shelter !== 'none') return false;
    if (w.swimming) return !w.diving;
    return w.depth > 0;
  }

  /** What the activity card offers by the sea right now. */
  private seaOffer(): ActivityCard {
    const w = this.walker;
    if (!w.swimming) return this.seaCard;
    if (this.surf.afloat && this.surf.distanceTo(w.x, w.z) < 4.5) return this.diveSurfCard;
    const nearKayak = this.kayak.distanceTo(w.x, w.z) < 4.5;
    return nearKayak ? this.diveKayakCard : this.diveCard;
  }

  // The activity card's rows (ui/ActivityMenu.ts): a click does what the key does, through the
  // keymap where the key is a shortcut. Rows without `run` are hints (held keys: W, Space).
  private readonly diveRow = { key: 'Space', label: vi.dive.menu, icon: 'dive' } as const;
  private readonly seaCard: ActivityCard = {
    title: vi.sea.menuTitle,
    items: [
      { key: 'K', label: vi.sea.kayak, icon: 'kayak', run: () => this.keymap.run('KeyK') },
      { key: 'L', label: vi.surf.menu, icon: 'surf', run: () => this.keymap.run('KeyL') },
      { key: 'W', label: vi.sea.swim, icon: 'swim' },
    ],
  };
  private readonly diveCard: ActivityCard = { title: vi.sea.menuTitle, items: [this.diveRow] };
  private readonly diveKayakCard: ActivityCard = {
    title: vi.sea.menuTitle,
    items: [this.diveRow, { key: 'K', label: vi.sea.reboard, icon: 'kayak', run: () => this.keymap.run('KeyK') }],
  };
  private readonly diveSurfCard: ActivityCard = {
    title: vi.sea.menuTitle,
    items: [this.diveRow, { key: 'L', label: vi.surf.mount, icon: 'surf', run: () => this.keymap.run('KeyL') }],
  };
  private readonly jumpRow = { key: 'Space', label: vi.kayak.jump, icon: 'dive', run: () => this.jumpFromKayak() } as const;
  private readonly kayakCard: ActivityCard = { title: vi.kayak.title, items: [this.jumpRow] };
  private readonly kayakLandCard: ActivityCard = {
    title: vi.kayak.title,
    items: [{ key: 'K', label: vi.kayak.land, icon: 'shore', run: () => this.keymap.run('KeyK') }, this.jumpRow],
  };
  private readonly deskCard: ActivityCard = {
    title: vi.panel.views.desk,
    items: [{ key: 'E', label: vi.desk.sit, icon: 'desk', run: () => this.keymap.run('KeyE') }],
  };
  private readonly bathCard: ActivityCard = {
    title: vi.panel.views.bath,
    items: [{ key: 'E', label: vi.bath.enter, icon: 'bath', run: () => this.keymap.run('KeyE') }],
  };
  private readonly hammockCard: ActivityCard = {
    title: vi.panel.views.hammock,
    items: [{ key: 'E', label: vi.hammock.enter, icon: 'hammock', run: () => this.keymap.run('KeyE') }],
  };

  /** The controls line on the surfboard: lying (paddling) or standing (riding). */
  private surfControls(): string {
    return this.surf.body.state === 'ride' ? vi.surf.controlsRide : vi.surf.controlsProne;
  }

  /**
   * L near the sea: onto the surfboard. Swimming right next to it, you climb on; from anywhere
   * else on the beach the screen fades and you are lying on it in the shallows of the surf break.
   */
  private boardSurf(): void {
    const w = this.walker;
    const s = this.surf;
    const near = w.swimming && s.afloat && s.distanceTo(w.x, w.z) < 4.5;
    this.fadeThrough(() => {
      if (!near) s.launch();
      this.cameras.setMode('surf');
    });
  }

  /** L on the board: slip off beside it (standing where it's shallow, swimming where it's deep). */
  private leaveSurf(): void {
    const spot = this.tmpSpot;
    this.surf.besideSpot(spot);
    const { x, z, yaw } = spot;
    this.surfArmed = false;
    this.fadeThrough(() => {
      this.walker.placeAt(x, z, yaw);
      this.cameras.setMode('walk');
    });
  }

  /** Space on the board: catching the wave, or why not. */
  private onPopUp(r: PopUp): void {
    const touch = isTouch() && (r === 'noWave' || r === 'early') ? vi.surf.touch[r] : null;
    this.activityMenu.flash(touch ?? vi.surf.popUp[r]);
  }

  /** The board reports standing up, a wipeout, the end of a ride, or the beach. */
  private onSurfEvent(e: SurfEvent): void {
    if (this.cameras.mode !== 'surf') return;
    if (e === 'stand') {
      this.walkHint.update(true, vi.surf.controlsRide);
      return;
    }
    if (e === 'wipeout') {
      // A splash, a moment in the white water, then back on the board by itself.
      if (this.settings.get().footsteps) this.mixer.playFootstep('water', 1, 1.2);
      this.activityMenu.flash(vi.surf.wipeout);
      return;
    }
    if (e === 'waveGone' || e === 'missed' || e === 'remount') {
      this.walkHint.update(true, vi.surf.controlsProne);
      if (e !== 'remount') this.activityMenu.flash(e === 'missed' ? vi.surf.missed : vi.surf.waveGone);
      return;
    }
    const spot = this.tmpSpot;
    this.surf.besideSpot(spot);
    this.surfArmed = false;
    // On the beach: step off.
    const { x, z, yaw } = spot;
    this.fadeThrough(() => {
      this.walker.placeAt(x, z, yaw);
      this.cameras.setMode('walk');
      this.activityMenu.flash(vi.surf.beach);
    });
  }

  private surfArmed = true;

  /** A wave breaks near you (walking on that beach, or surfing): its crash, by distance and side. */
  private onSurfCrash(x: number, z: number): void {
    const mode = this.cameras.mode;
    if ((mode !== 'surf' && mode !== 'walk') || !this.settings.get().footsteps) return;
    const cam = this.camera.position;
    const dx = x - cam.x;
    const dz = z - cam.z;
    const d = Math.hypot(dx, dz);
    const near = Math.max(0, 1 - d / 140);
    // Bigger waves are louder.
    const gain = near * near * (0.55 + 0.45 * sharedUniforms.uSurfLevel.value);
    // The camera's right (first column of its world matrix), to pan the crash.
    const m = this.camera.matrixWorld.elements;
    const rl = Math.hypot(m[0], m[2]) || 1;
    const pan = d > 1e-3 ? ((dx / d) * m[0] + (dz / d) * m[2]) / rl : 0;
    this.mixer.playSurfCrash(gain, pan);
  }

  /** Every frame: the next-wave bar while lying in the break, the rush of water while riding. */
  private updateSurfing(): void {
    const surfing = this.cameras.mode === 'surf';
    this.waveMeter.set(surfing ? this.surf.nextWave() : null);
    const b = this.surf.body;
    const riding = surfing && b.state === 'ride' && this.settings.get().footsteps;
    this.mixer.setSurfRush(riding ? Math.hypot(b.vx, b.vz) : 0);
  }

  /** The controls line while walking (or swimming, or diving). */
  private walkControls(): string {
    const w = this.walker;
    return w.diving ? vi.dive.controls : w.swimming ? vi.swim.controls : vi.walk.controls;
  }

  /** Going under: a splash and a burst of bubbles; coming up: a gasp of air (a splash). */
  private onDive(under: boolean): void {
    this.walkHint.update(true, this.walkControls());
    if (under) this.exhale(14, 0.4);
    if (this.settings.get().footsteps) this.mixer.playFootstep('water', under ? 0.9 : 0.6, 1.2);
  }

  /** A puff of bubbles from the diver's mouth. */
  private exhale(count: number, spread: number): void {
    const w = this.walker;
    const fx = -Math.sin(w.yaw);
    const fz = -Math.cos(w.yaw);
    for (let i = 0; i < count; i++) {
      this.bubbles.drop(
        w.x + fx * 0.15 + (Math.random() - 0.5) * spread * 0.3,
        w.bodyY + 0.02,
        w.z + fz * 0.15 + (Math.random() - 0.5) * spread * 0.3,
        (Math.random() - 0.5) * spread,
        0.1 + Math.random() * 0.3,
        (Math.random() - 0.5) * spread,
        0.006 + Math.random() * 0.018,
      );
    }
  }

  /** Every frame: breath bar, exhaled bubbles, the under-water look and sound. */
  private updateDiving(dt: number): void {
    const w = this.walker;
    const walking = this.cameras.mode === 'walk';
    this.breathMeter.set(walking && w.swimming && (w.diving || w.breath < 0.999), w.breath);
    if (walking && w.diving && w.breath <= 0 && !this.outOfBreath) {
      this.outOfBreath = true;
      this.activityMenu.flash(vi.dive.out);
    }
    if (w.breath > 0.5) this.outOfBreath = false;
    if (walking && w.diving) {
      this.bubbleTimer -= dt;
      if (this.bubbleTimer <= 0) {
        this.bubbleTimer = 2.2 + Math.random() * 1.4;
        this.exhale(6 + Math.floor(Math.random() * 7), 0.15);
      }
    }
    this.bubbles.update(dt);
    const cam = this.camera.position;
    this.world.underwater.update(this.camera, this.seaHeight(cam.x, cam.z));
    const under = this.world.underwater.under;
    if (under !== this.underMuffled) {
      this.underMuffled = under;
      this.applyMuffle();
    }
  }

  /** Into deep water / back on your feet: the controls line changes, a splash as you go in. */
  private onSwim(swimming: boolean): void {
    this.walkHint.update(true, this.walkControls());
    if (swimming && this.settings.get().footsteps) this.mixer.playFootstep('water', 1, 1.2);
  }

  /** A swim stroke: splash sound by the arm's side, marks and droplets on the water. */
  private onSwimStroke(e: SwimStroke): void {
    this.swimFx.stroke(e, this.walker);
    if (this.settings.get().footsteps) this.mixer.playPaddle('catch', 0.55 * e.strength, e.side * 0.5);
  }

  /**
   * K at the shore: into the kayak. It is pulled into the water in front of you (from the sand,
   * or wherever you left it), unless it already floats right next to you. The screen fades
   * through black meanwhile, like getting into a seat from afar.
   */
  private boardKayak(): void {
    const w = this.walker;
    const k = this.kayak;
    const afloat = this.world.heightmap.heightAt(k.body.x, k.body.z) < -0.3;
    if (!(afloat && k.distanceTo(w.x, w.z) < 4.5) && !k.launchNear(w.x, w.z)) {
      this.activityMenu.flash(vi.kayak.noLaunch);
      return;
    }
    this.fadeThrough(() => this.cameras.setMode('kayak'));
  }

  /** K in the kayak: step out beside it where you can stand, or slip into deep water and swim. */
  private leaveKayak(): void {
    const spot = this.tmpSpot;
    if (!this.kayak.landingSpot(spot)) this.kayak.besideSpot(spot);
    // Copied: tmpSpot is reused every frame while the screen fades.
    const { x, z, yaw } = spot;
    this.fadeThrough(() => {
      this.walker.placeAt(x, z, yaw);
      this.cameras.setMode('walk');
    });
  }

  private readonly tmpSpot = { x: 0, z: 0, yaw: 0 };

  // On-screen controls per moment (ui/TouchControls.ts): only what a key-less player can't do
  // otherwise. Held buttons write touchInput (read with the keys); skills come from tapping the
  // animals (a long press on Mochi), places and boats from the activity card.
  private readonly walkTouch: TouchLayout = { stick: true, buttons: [] };
  private readonly swimTouch: TouchLayout = {
    stick: true,
    buttons: [{ label: vi.touch.dive, icon: 'dive', main: true, down: () => (touchInput.jump = true), up: () => (touchInput.jump = false) }],
  };
  private readonly diveTouch: TouchLayout = {
    stick: true,
    buttons: [{ label: vi.touch.rise, icon: 'rise', main: true, down: () => (touchInput.jump = true), up: () => (touchInput.jump = false) }],
  };
  /** Kayak: the joystick paddles; leaving lands where it's shallow, else over the side (K / Space). */
  private readonly kayakTouch: TouchLayout = {
    stick: true,
    buttons: [],
    exit: () => {
      if (this.kayak.landingSpot(this.tmpSpot)) this.keymap.run('KeyK');
      else this.jumpFromKayak();
    },
  };
  /** The board: "Bắt sóng" only while a wave can be caught. */
  private readonly surfTouch: TouchLayout = { stick: true, buttons: [], exit: () => this.keymap.run('KeyL') };
  private readonly surfWaveTouch: TouchLayout = {
    stick: true,
    buttons: [{ label: vi.touch.catchWave, icon: 'surf', main: true, down: () => this.surf.catchWave() }],
    exit: () => this.keymap.run('KeyL'),
  };
  private readonly seatTouch: TouchLayout = { stick: false, buttons: [], exit: () => this.keymap.run('Escape') };

  /** On touch a card is only worth showing with something to tap (not key hints alone). */
  private touchCard(card: ActivityCard | null): ActivityCard | null {
    if (!card || !isTouch()) return card;
    return card.items.some((it) => it.run) ? card : null;
  }

  /** What the on-screen controls show now: null without a touch screen or in the overview. */
  private touchLayout(): TouchLayout | null {
    if (!isTouch()) return null;
    switch (this.cameras.mode) {
      case 'walk':
        return this.walker.diving ? this.diveTouch : this.walker.swimming ? this.swimTouch : this.walkTouch;
      case 'kayak':
        return this.kayakTouch;
      case 'surf':
        return this.surf.waveComing ? this.surfWaveTouch : this.surfTouch;
      case 'seat':
        return this.seatTouch;
      default:
        return null;
    }
  }

  /**
   * Phones: starting to play (walking, the kayak, the board, a seat) goes full screen and
   * sideways, like a game; back in the overview both are undone (upright viewing). Android Chrome
   * allows this from the tap that started playing; iPhone allows neither, and a "turn the phone"
   * hint shows instead (styles: .rotate-hint).
   */
  private playScreen(playing: boolean): void {
    if (!isTouch()) return;
    if (playing && !this.fullscreen.active) {
      this.autoFullscreen = true;
      void this.fullscreen.enter().then((ok) => {
        if (ok) lockLandscape();
      });
    } else if (!playing && this.autoFullscreen) {
      this.autoFullscreen = false;
      screen.orientation?.unlock?.();
      this.fullscreen.exit();
    }
  }

  /** Space in the kayak: over the side into the water (swimming if it's deep there). */
  private jumpFromKayak(): void {
    const spot = this.tmpSpot;
    this.kayak.besideSpot(spot);
    this.reboardArmed = false;
    const { x, z, yaw } = spot;
    this.fadeThrough(() => {
      this.walker.placeAt(x, z, yaw);
      this.cameras.setMode('walk');
      if (this.settings.get().footsteps) this.mixer.playFootstep('water', 1, 1.2);
    });
  }

  /**
   * Swimming back to the floating kayak climbs in by itself. Armed only once you have swum a
   * little away from it (so jumping out doesn't put you straight back in).
   */
  private autoReboard(): void {
    const w = this.walker;
    if (this.cameras.mode !== 'walk' || !w.swimming || this.fader.classList.contains('on')) return;
    // The surfboard, after a wipeout: swim back to it and you climb on.
    const ds = this.surf.distanceTo(w.x, w.z);
    if (ds > REBOARD_ARM) this.surfArmed = true;
    if (this.surfArmed && ds < REBOARD_NEAR && this.surf.afloat) {
      this.surfArmed = false;
      this.fadeThrough(() => this.cameras.setMode('surf'));
      return;
    }
    const d = this.kayak.distanceTo(w.x, w.z);
    if (d > REBOARD_ARM) this.reboardArmed = true;
    if (this.reboardArmed && d < REBOARD_NEAR && this.world.heightmap.heightAt(this.kayak.body.x, this.kayak.body.z) < -0.3) {
      this.reboardArmed = false;
      this.fadeThrough(() => this.cameras.setMode('kayak'));
    }
  }

  private reboardArmed = true;

  private fadeThrough(then: () => void): void {
    // One at a time: a request every frame would restart the fade forever (a black screen).
    if (this.fader.classList.contains('on')) return;
    window.clearTimeout(this.faderTimer);
    this.fader.classList.add('on');
    this.faderTimer = window.setTimeout(() => {
      then();
      this.fader.classList.remove('on');
    }, 300);
  }

  /** Paddle in or out of the water: a splash sound, panned to the blade's side (the kayak draws the water). */
  private onBlade(e: BladeEvent): void {
    if (!this.settings.get().footsteps) return;
    // The blade's side, as heard from where the head looks.
    const pan = e.side * Math.cos(this.kayak.lookYaw);
    this.mixer.playPaddle(e.kind, e.strength, pan);
  }

  /** The seat you are standing next to (walk mode), if any: in the room, or by the hammock. */
  private nearSeat(): SeatId | null {
    if (this.cameras.mode !== 'walk' || this.walker.swimming) return null;
    if (this.walker.shelter === 'none') {
      const c = this.world.hammock.center;
      return Math.hypot(this.walker.x - c.x, this.walker.z - c.z) < 2.3 ? 'hammock' : null;
    }
    if (this.walker.shelter !== 'room') return null;
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

  /**
   * Footstep sound (by surface, snow on top when it has settled), a ripple when wading, and a
   * footprint on sand or snow.
   */
  private onStep(e: StepEvent): void {
    const w = this.walker;
    if (e.depth > 0.05) this.world.water.addRipple(w.x, w.z, 1.2, -0.35 * e.strength);
    const snowy = sharedUniforms.uSnowCover.value > 0.45;
    this.stepSide = -this.stepSide;
    if (e.depth === 0 && w.shelter === 'none') {
      const onSnow = snowy && e.surface !== 'wood' && e.surface !== 'water';
      if (onSnow || e.surface === 'sand') this.world.footprints.add(w.x, w.z, w.yaw, this.stepSide, onSnow, this.character !== null);
    }
    if (!this.settings.get().footsteps) return;
    let surface: FootSurface = e.surface;
    if (snowy && surface !== 'water' && this.walker.shelter === 'none') surface = 'snow';
    this.mixer.playFootstep(surface, e.strength, e.depth);
  }

  private stepSide = 1;
  /** How soaked the character is from the sea (0..1); dries off slowly in sun and wind. */
  private soaked = 0;
  private dripDebt = 0;

  /**
   * Every frame: the character's wet look (from the sea, or the rain where it falls) and, fresh
   * out of the water, drops falling from it.
   */
  private updateWetness(dt: number): void {
    const m = this.cameras.mode;
    const w = this.walker;
    let soak = 0;
    if (m === 'walk') soak = w.swimming ? 1 : Math.min(0.5, w.depth * 0.6);
    else if (m === 'surf') soak = 0.9;
    else if (m === 'kayak') soak = 0.3; // paddle splashes
    const sheltered = (m === 'walk' && w.shelter !== 'none') || (m === 'seat' && this.cameras.seat !== 'hammock');
    const raining = !sheltered && this.world.weather.rainAmount > 0.1;
    if (soak > this.soaked) {
      this.soaked += (soak - this.soaked) * (1 - Math.exp(-dt / 0.4));
    } else if (!raining) {
      // ~1 min to dry in full sun and wind, a few minutes on a still grey day or at night.
      const sun = sharedUniforms.uDayLight.value * (1 - 0.6 * sharedUniforms.uCloudCover.value);
      const tau = 60 + 200 * (1 - sun) - 30 * sharedUniforms.uWind.value;
      this.soaked = Math.max(0, this.soaked - dt / Math.max(30, tau));
    }
    const rainWet = sheltered ? 0 : this.world.weather.wetness;
    this.avatar.wetness.value = Math.max(this.soaked, rainWet);

    // Drips from hair, hands and clothes, out of the water while still soaked.
    if (m !== 'walk' || w.swimming || w.depth > 0.3 || this.soaked < 0.2 || !this.avatar.group.visible) return;
    this.dripDebt += dt * 22 * (this.soaked - 0.15);
    while (this.dripDebt >= 1) {
      this.dripDebt -= 1;
      const a = Math.random() * Math.PI * 2;
      const r = 0.12 + Math.random() * 0.1;
      this.world.spray.drop(
        w.x + Math.cos(a) * r,
        w.feetY + 0.2 + Math.random() * 1.3,
        w.z + Math.sin(a) * r,
        w.vel.x * 0.8,
        -0.3,
        w.vel.y * 0.8,
        // Larger than real drops (~4 mm) so they read as glints at a few metres.
        0.01 + Math.random() * 0.012,
      );
    }
  }

  /** The character is shown in third-person walking, unless the camera is pressed right up to it. */
  private updateAvatar(dt: number): void {
    if (this.cameras.mode === 'surf') {
      const show = (this.surf.view === 'first' || this.surf.arm > 0.7) && !this.surf.riderHidden;
      this.avatar.group.visible = show;
      if (show) {
        this.avatar.updateSurfing(dt, this.surf.pose);
        this.syncCharacter();
      }
      return;
    }
    if (this.cameras.mode === 'kayak') {
      // Through the eyes too: your arms and legs are in view while paddling.
      const show = this.kayak.view === 'first' || this.kayak.arm > 0.7;
      this.avatar.group.visible = show;
      if (show) {
        this.avatar.updateSeated(dt, this.kayak.seated);
        this.syncCharacter();
      }
      return;
    }
    const w = this.walker;
    if (this.cameras.mode === 'walk' && w.swimming) {
      // Through the eyes too: the arms come round into view.
      const show = w.view === 'first' || w.arm > 0.7;
      this.avatar.group.visible = show;
      if (!show) return;
      const sp = this.swimPose;
      sp.x = w.x;
      sp.z = w.z;
      sp.surfaceY = w.surfaceY;
      sp.vx = w.vel.x;
      sp.vz = w.vel.y;
      sp.speed = w.speed;
      sp.phase = w.swimPhase;
      sp.crawl = w.crawl;
      sp.move = w.swimMove;
      sp.firstPerson = w.view === 'first';
      if (w.diving) {
        // Lying along the way you swim (head down when diving, up when rising), half upright when still.
        const h = Math.hypot(w.vel.x, w.vel.y);
        sp.lift = w.speed > 0.2 ? Math.atan2(w.vy, h) : 0.7;
        sp.chestY = w.bodyY - 0.3;
        sp.move = Math.max(sp.move, 0.6);
      } else {
        sp.lift = Number.NaN;
        sp.chestY = Number.NaN;
      }
      this.avatar.updateSwimming(dt, sp);
      this.syncCharacter();
      return;
    }
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
    p.stride = w.stride;
    p.running = w.running;
    // Stroking Mochi once it sits in front of you: crouch, the hand on its fur.
    const dog = this.dog;
    p.pet = this.petting.stroking && dog?.petReady ? 1 : 0;
    if (dog) p.petYaw = Math.atan2(-(dog.x - w.x), -(dog.z - w.z));
    // Knocked over by its bark: falling on your back, facing it.
    p.fall = w.knockT;
    p.fallYaw = w.knockYaw;
    this.avatar.update(dt, p);
    this.syncCharacter();
  }

  private readonly avatarPose: AvatarPose = {
    x: 0, z: 0, feetY: 0, vx: 0, vz: 0, speed: 0, phase: 0, stride: 0, running: false, pet: 0, petYaw: 0, petHand: this.petHand,
  };
  private readonly swimPose: SwimPose = {
    x: 0, z: 0, surfaceY: 0, vx: 0, vz: 0, speed: 0, phase: 0, crawl: 0, move: 0, firstPerson: false, chestY: Number.NaN, lift: Number.NaN,
  };

  /** Walk/desk mode: where the listener is shapes the mix (~10 times per second is plenty). */
  private updateListener(dt: number): void {
    const mode = this.cameras.mode;
    if (mode === 'orbit') return;
    if (mode === 'walk') {
      // What you can do here: sit at the desk, the bath, the hammock; the sea's activities.
      const near = this.nearSeat();
      const seatCard = near === 'desk' ? this.deskCard : near === 'bath' ? this.bathCard : near === 'hammock' ? this.hammockCard : null;
      this.activityMenu.set(this.touchCard(seatCard ?? (this.inSea() ? this.seaOffer() : null)));
      this.activityMenu.update(dt, this.walker.speed > 0.15);
    } else if (mode === 'kayak') {
      this.activityMenu.update(dt, Math.abs(this.kayak.body.speed) > 0.3);
    }
    this.listenerTimer -= dt;
    if (this.listenerTimer > 0) return;
    this.listenerTimer = 0.1;
    const atDesk = mode === 'seat';
    const seat = this.deskView.seat;
    const k = this.kayak;
    const paddling = mode === 'kayak';
    const surfing = mode === 'surf';
    const sb = this.surf.body;
    // (On touch the corner button leaves the kayak: no card.)
    if (paddling) this.activityMenu.set(isTouch() ? null : k.landingSpot(this.tmpSpot) ? this.kayakLandCard : this.kayakCard);
    if (surfing) this.walkHint.setPrompt(this.surf.waveComing ? (isTouch() ? vi.surf.touch.cue : vi.surf.cue) : null);
    const x = atDesk ? seat.x : paddling ? k.body.x : surfing ? sb.x : this.walker.x;
    const z = atDesk ? seat.z : paddling ? k.body.z : surfing ? sb.z : this.walker.z;
    const yaw = atDesk ? seat.yaw : paddling ? k.body.yaw + k.lookYaw : surfing ? sb.yaw + this.surf.lookYaw : this.walker.yaw;
    const l = this.listener;
    l.walking = true;
    l.shoreDistance = this.world.heightmap.distanceToShore(x, z);
    // The sea lies roughly away from the island center; project that onto the listener's right.
    const r = Math.hypot(x, z) || 1;
    l.seaSide = (x / r) * Math.cos(yaw) - (z / r) * Math.sin(yaw);
    l.trees = this.colliders.treesNear(x, z, 12);
    l.shelter = atDesk ? (this.cameras.seat === 'hammock' ? 'none' : 'room') : paddling || surfing ? 'none' : this.walker.shelter;
    this.mixer.setListener(l);
  }

  private readonly drawingBuffer = new THREE.Vector2();
  // Reused every frame (no per-frame allocations).
  private readonly skyOptions: SkyOptions = {
    clock: { mode: 'free', speed: 60, paused: false }, clouds: 0, gloom: 0, clarity: 0, rainbow: true, stars: true, meteors: 0, aurora: 0, moonlight: 0.3,
  };
  private readonly skyWeather: SkyWeather = { overcast: 0, rain: 0, wetness: 0 };

  private readonly canvasSize = { w: 0, h: 0, ratio: 0 };

  /** Window size, browser zoom or monitor changed (zoom and monitors change devicePixelRatio). */
  private onResize = (): void => {
    const pixelRatio = this.targetPixelRatio();
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    // Resizing the canvas reallocates (and clears) it: only when something really changed.
    const sz = this.canvasSize;
    if (sz.w === w && sz.h === h && sz.ratio === pixelRatio) return;
    sz.w = w;
    sz.h = h;
    sz.ratio = pixelRatio;
    this.renderer.setPixelRatio(pixelRatio);
    this.world.fireflies.setPixelRatio(pixelRatio);
    this.camera.aspect = w / h;
    // Upright screen (a phone held upright): the fov is vertical, so the view would be a narrow
    // slit across. Zooming out (zoom < 1 widens the fov without touching it; the desk view and
    // the skills animate the fov) keeps more of the island in view.
    this.camera.zoom = Math.min(1, Math.max(PORTRAIT_MIN_ZOOM, w / h));
    this.camera.updateProjectionMatrix();
    // The vertical fov as drawn: particle sizes follow it.
    const fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) / this.camera.zoom));
    this.renderer.setSize(w, h, false);
    this.renderer.getDrawingBufferSize(this.drawingBuffer);
    this.bloom.resize();
    this.world.water.setSize(this.drawingBuffer.x, this.drawingBuffer.y);
    this.deskVideo?.setSize(w, h);
    this.world.spray.setViewport(this.drawingBuffer.y, fov);
    this.bubbles.setViewport(this.drawingBuffer.y, fov);
    this.todoBubbles.setViewport(this.drawingBuffer.y);
    this.creatures.setViewport(this.drawingBuffer.y, fov);
    this.seaGlow.setViewport(this.drawingBuffer.y, fov);
    this.rainbow.setViewport(this.drawingBuffer.y, fov);
    this.smoke.setViewport(this.drawingBuffer.y, fov);
    this.dust.setViewport(this.drawingBuffer.y, fov);
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
    this.skyOptions.clarity = s.clarity;
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
    const clear = dayNight.clarity;
    this.world.underwater.setAirFog(FOG_NEAR + (FOG_NEAR_CLEAR - FOG_NEAR) * clear, FOG_FAR + (FOG_FAR_CLEAR - FOG_FAR) * clear);
    const night = dayNight.night;
    this.world.fireflies.update(s.fireflies ? night * (1 - weather.rainAmount) * (1 - sharedUniforms.uSnow.value) : 0);
    this.mixer.setNight(night);
    this.panel.tick(performance.now());
    // Wind roughens the sea on top of the wave slider; the surf sound follows the same value.
    const sea = Math.min(1, this.env.waveStrength.value + weather.seaBoost);
    sharedUniforms.uWaveStrength.value = sea;
    sharedUniforms.uSurfLevel.value = this.env.waveStrength.value;
    this.mixer.setSeaState(sea);

    this.updateHammock(dt);
    this.cameras.update(dt);
    this.touchControls.set(this.touchLayout());
    this.updateListener(dt);
    this.updateSurfing();
    this.updateAvatar(dt);
    this.updateDog(dt);
    this.creatures.update(dt);
    this.beMap.update(dt);
    this.seaGlow.update(dt);
    this.rainbow.update(dt);
    this.fx.update(dt);
    this.dogSkills.update(dt);
    this.combos.update(dt);
    this.updateHealth(dt);
    this.lightning.update(dt, this.camera);
    this.scorcher.update(dt);
    this.smoke.update(dt);
    this.dust.update(dt);
    this.updateWetness(dt);
    this.world.footprints.setClock(elapsed);
    const onFoot = this.cameras.mode === 'walk' && !this.walker.swimming;
    this.world.update(dt, elapsed, this.camera, sea, onFoot ? this.walker : null);
    this.deskScreens.setLeft(this.deskVideo.leftMode, this.deskVideo.label);
    this.deskScreens.update(dt, this.camera);
    this.deskDash.update(dt, this.camera, this.cameras.mode === 'seat' && this.cameras.seat === 'desk');
    this.todoBubbles.update(dt, this.camera, sharedUniforms.uWindDir.value, sharedUniforms.uWind.value);
    this.deskVideo.update();
    // The video is decoded and composited on the same GPU: give it room while it plays.
    this.loop.targetFps = this.deskVideo.watching ? VIDEO_FPS : NORMAL_FPS;
    this.gpuTimer.begin();
    // The wake map follows the kayak (it only has marks while the kayak moves).
    if (this.cameras.mode === 'walk') this.swimFx.update(dt, this.walker);
    this.autoReboard();
    this.updateDiving(dt);
    const swimmer = this.cameras.mode === 'walk' && this.walker.swimming;
    const surfer = this.cameras.mode === 'surf';
    const wakeX = swimmer ? this.walker.x : surfer ? this.surf.body.x : this.kayak.body.x;
    const wakeZ = swimmer ? this.walker.z : surfer ? this.surf.body.z : this.kayak.body.z;
    this.world.water.simulate(dt, wakeX, wakeZ);
    this.updateShadowFocus();
    // The next scene render (capture if refraction is on, else main) refreshes the shadow map.
    this.renderer.shadowMap.needsUpdate = true;
    // The skills' shake and framing, for this frame's renders only (not seated: the desk's own view).
    this.fx.apply(this.cameras.mode !== 'seat');
    this.world.water.captureScene(this.scene, this.camera);
    if (QUALITY_PROFILES[s.quality].bloom && this.fx.bloom > 0.02) this.bloom.render(this.fx.bloom);
    else this.renderer.render(this.scene, this.camera);
    this.fx.restore();
    this.deskVideo.punchHole(this.renderer);
    this.gpuTimer.end();
    this.maybeResetTimeVisible();
    const cpuMs = performance.now() - cpuStart;
    this.slowHint.frame(performance.now() / 1000);
    this.overlay.update(dt, this.renderer.info, this.loop, cpuMs, this.gpuTimer.lastMs);
  };
}
