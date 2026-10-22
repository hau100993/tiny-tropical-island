import * as THREE from 'three';
import { CSS3DObject, CSS3DRenderer } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import { button, el } from './components';
import { icons } from './icons';
import { vi } from './strings.vi';
import { embedUrl, parseYouTubeUrl, youTubeLogoSvg, YT_ORIGIN, YT_STATE, type YouTubeRef } from './youtube';
import { parseJson, readStored, writeStored } from '../core/storage';
import { DASH_LOGO, SCREEN_PX } from '../world/deskScreens';

/** The iframe's own size in CSS pixels (16:9 like the screen); CSS3D scales it onto the screen. */
const PX_W = 640;
const PX_H = 360;
const RECENT_KEY = 'tsw.videoRecent';
const RECENT_MAX = 5;
/** The logo button's own size in CSS pixels (same shape as its spot on the right screen). */
const LOGO_PX_W = 104;
const LOGO_PX_H = Math.round((LOGO_PX_W * DASH_LOGO.h) / DASH_LOGO.w);
/** The menu stays this long after the mouse leaves (time to cross the gap to it). */
const MENU_HIDE_MS = 400;
/** When a video first starts, the menu shows itself this long so you know where it is. */
const PEEK_MS = 3000;

interface Recent {
  url: string;
  title: string;
}

export interface DeskVideoDeps {
  /** The video started or stopped playing (the app silences the soundscape while it plays). */
  onPlaying(playing: boolean): void;
  /** Master volume (0..1) and mute, applied to the video too. */
  master(): { volume: number; muted: boolean };
}

/**
 * YouTube on the left desk monitor. A real iframe (YouTube's pixels can't be read into a WebGL
 * texture) is placed with three's CSS3DRenderer, so it sits exactly on the 3D screen and follows
 * every look and zoom. Seated, the layer lies over the canvas (nothing stands between the chair
 * and that screen, and the video takes clicks). Up and about, it keeps playing and the layer
 * moves under the canvas, which is see-through only where that screen is visible (`punchHole`):
 * whatever passes in front of the monitor hides the video. The player is driven with postMessage
 * commands (no YouTube script in this page).
 * A YouTube logo on the right screen (a real button, laid on it the same way) opens the link
 * card or plays/pauses; hovering it shows a small menu with the video's controls.
 */
export class DeskVideo {
  private readonly css = new CSS3DRenderer();
  private readonly cssScene = new THREE.Scene();
  private readonly object: CSS3DObject;
  private readonly frame: HTMLDivElement;
  private readonly logoObject: CSS3DObject;
  private readonly logo: HTMLButtonElement;
  private iframe: HTMLIFrameElement | null = null;
  private url = '';
  private title = '';
  private seated = false;
  private playing = false;
  private ready = false;
  private listenTimer = 0;
  /** While playing: you turned the soundscape back on for this video. */
  private ambienceWanted = false;
  // Prompt card, and the menu that opens from the logo.
  private readonly card: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly recentList: HTMLElement;
  private readonly error: HTMLElement;
  private readonly menu: HTMLElement;
  private readonly menuTitle: HTMLElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly ambienceBtn: HTMLButtonElement;
  /** Mouse (or keyboard focus) on the logo or the menu. */
  private hovering = false;
  private hideTimer = 0;
  private peekTimer = 0;
  /** The menu already showed itself for this video. */
  private peeked = false;
  private readonly tmp = new THREE.Vector3();
  /** The left screen again, drawn as a see-through hole in the canvas (see `punchHole`). */
  private readonly holeScene = new THREE.Scene();
  private menuX = NaN;
  private menuY = NaN;

  constructor(
    container: HTMLElement,
    ui: HTMLElement,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly screen: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>,
    dash: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>,
    private readonly deps: DeskVideoDeps,
  ) {
    // The CSS layer: right above the canvas, below the UI (DOM order).
    this.css.domElement.className = 'video-layer';
    container.insertBefore(this.css.domElement, ui);
    this.frame = el('div', 'video-frame');
    this.frame.style.width = `${PX_W}px`;
    this.frame.style.height = `${PX_H}px`;
    this.object = new CSS3DObject(this.frame);
    this.object.visible = false;
    this.cssScene.add(this.object);
    // Lie exactly on the screen: same place and turn, scaled from pixels to metres.
    this.screen.updateWorldMatrix(true, false);
    this.screen.matrixWorld.decompose(this.object.position, this.object.quaternion, this.tmp);
    const p = this.screen.geometry.parameters;
    this.object.scale.set(p.width / PX_W, p.height / PX_H, 1);
    // A hair in front of the screen glass.
    this.object.translateZ(0.001);
    // Clear colour and alpha 0, drawn without blending: the canvas becomes transparent there.
    const holeMat = new THREE.MeshBasicMaterial({
      color: '#000000',
      transparent: true,
      opacity: 0,
      blending: THREE.NoBlending,
      depthWrite: false,
      toneMapped: false,
      // Same triangles as the screen drawn in the main pass: pull forward so they win the depth test.
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    });
    const hole = new THREE.Mesh(this.screen.geometry, holeMat);
    hole.matrixAutoUpdate = false;
    hole.matrix.copy(this.screen.matrixWorld);
    this.holeScene.add(hole);

    // ---- The logo on the right screen, exactly over the one drawn there ----
    this.logo = button('', () => this.onLogo(), 'video-logo');
    this.logo.style.width = `${LOGO_PX_W}px`;
    this.logo.style.height = `${LOGO_PX_H}px`;
    this.logo.innerHTML = `${youTubeLogoSvg()}<span class="video-logo-badge"></span>`;
    this.logo.setAttribute('aria-label', vi.video.logo);
    this.logoObject = new CSS3DObject(this.logo);
    this.logoObject.visible = false;
    this.cssScene.add(this.logoObject);
    dash.updateWorldMatrix(true, false);
    dash.matrixWorld.decompose(this.logoObject.position, this.logoObject.quaternion, this.tmp);
    const d = dash.geometry.parameters;
    const r = DASH_LOGO;
    // Canvas pixels (origin top left) to the screen's metres (origin centre, y up).
    this.logoObject.translateX(((r.x + r.w / 2) / SCREEN_PX.w - 0.5) * d.width);
    this.logoObject.translateY((0.5 - (r.y + r.h / 2) / SCREEN_PX.h) * d.height);
    this.logoObject.translateZ(0.001);
    const metres = (r.w / SCREEN_PX.w) * d.width;
    this.logoObject.scale.setScalar(metres / LOGO_PX_W);

    // ---- Prompt card ----
    this.card = el('div', 'video-card');
    this.card.hidden = true;
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-label', vi.video.title);
    const head = el('div', 'video-card-head');
    head.append(el('span', 'video-card-title', vi.video.title));
    const close = button('', () => this.closeCard(), 'icon-btn');
    close.innerHTML = icons.close;
    close.title = vi.video.cancel;
    head.append(close);
    const form = el('form', 'video-form');
    this.input = el('input', 'video-input');
    this.input.type = 'url';
    this.input.placeholder = vi.video.placeholder;
    this.input.setAttribute('aria-label', vi.video.placeholder);
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.closeCard();
      }
    });
    const go = button(vi.video.play, () => undefined, 'btn primary');
    go.type = 'submit';
    form.append(this.input, go);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submit(this.input.value);
    });
    this.error = el('div', 'video-error');
    this.recentList = el('div', 'video-recent');
    this.card.append(head, form, this.error, this.recentList, el('div', 'hint', vi.video.note));
    ui.append(this.card);

    // ---- Menu under the logo: title, play/pause, soundscape, change video, close ----
    this.menu = el('div', 'video-menu');
    this.menu.hidden = true;
    this.menuTitle = el('div', 'video-menu-title');
    this.playBtn = button('', () => this.togglePlay(), 'video-menu-btn');
    this.ambienceBtn = button('', () => this.toggleAmbience(), 'video-menu-btn');
    const change = button('', () => this.openCard(), 'video-menu-btn');
    change.innerHTML = `${icons.link}<span>${vi.video.change}</span>`;
    const stop = button('', () => this.stop(), 'video-menu-btn');
    stop.innerHTML = `${icons.close}<span>${vi.video.close}</span>`;
    const row = el('div', 'video-menu-row');
    row.append(this.playBtn, this.ambienceBtn, change, stop);
    this.menu.append(this.menuTitle, row, el('div', 'video-menu-hint', vi.video.focusHint));
    ui.append(this.menu);
    for (const target of [this.logo, this.menu]) {
      target.addEventListener('pointerenter', () => this.setHover(true));
      target.addEventListener('pointerleave', () => this.setHover(false));
      target.addEventListener('focusin', () => this.setHover(true));
      target.addEventListener('focusout', () => this.setHover(false));
    }
    this.syncAmbienceBtn();
    this.syncControls();

    window.addEventListener('message', this.onMessage);
  }

  /** A video is loaded (playing or paused). */
  get active(): boolean {
    return this.iframe !== null;
  }

  /** Title for the left screen while you're away from the desk. */
  get label(): string | null {
    return this.active ? this.title || vi.video.untitled : null;
  }

  /** A video is playing while you sit in front of it. */
  get watching(): boolean {
    return this.playing && this.seated;
  }

  /** U: open the link card (only at the desk), or close it. */
  toggleCard(): void {
    if (!this.card.hidden) this.closeCard();
    else this.openCard();
  }

  /** Seated at the desk or not. Getting up leaves the video playing; the logo and menu hide. */
  setSeated(on: boolean): void {
    if (on === this.seated) return;
    this.seated = on;
    if (!on) {
      this.closeCard();
      this.hovering = false;
      window.clearTimeout(this.peekTimer);
      this.peekTimer = 0;
    }
    // Seated: over the canvas (clickable). Away: under it, seen through the hole.
    this.css.domElement.classList.toggle('behind', !on);
    this.show();
  }

  /**
   * Shows or hides the video and the logo button. The CSS renderer only touches the DOM when it
   * renders, so it renders once here too (otherwise a hidden video would stay where it was).
   */
  private show(): void {
    this.object.visible = this.active;
    this.logoObject.visible = this.seated;
    this.syncMenu();
    this.css.render(this.cssScene, this.camera);
  }

  setSize(width: number, height: number): void {
    this.css.setSize(width, height);
  }

  /** Master volume or mute changed. */
  syncVolume(): void {
    const m = this.deps.master();
    this.command(m.muted ? 'mute' : 'unMute');
    this.command('setVolume', [Math.round(m.volume * 100)]);
  }

  /** Every frame: place the iframe and the logo on their screens, the menu under the logo. */
  update(): void {
    if (!this.object.visible && !this.logoObject.visible) return;
    this.css.render(this.cssScene, this.camera);
    this.placeMenu();
  }

  /**
   * After the main render. First the canvas alpha goes back to 1 everywhere (an alpha-only
   * clear: some blended effects leave alpha below 1, which would let the page show through).
   * Then, with a video loaded, the left screen is drawn again writing (0,0,0,0) where it passes
   * the depth test, i.e. only the pixels of it that nothing covers. The iframe under the canvas
   * shows exactly there.
   */
  punchHole(renderer: THREE.WebGLRenderer): void {
    const gl = renderer.getContext();
    gl.colorMask(false, false, false, true);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.colorMask(true, true, true, true);
    // three caches the mask and clear colour: tell it they changed behind its back.
    renderer.state.buffers.color.reset();
    if (!this.object.visible) return;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.holeScene, this.camera);
    renderer.autoClear = autoClear;
  }

  /** U away from the desk: play or pause the loaded video. */
  togglePlayback(): boolean {
    if (!this.active) return false;
    this.togglePlay();
    return true;
  }

  /** The menu hangs under the logo's bottom edge, kept inside the window. */
  private placeMenu(): void {
    if (this.menu.hidden) return;
    const v = this.tmp.set(0, -LOGO_PX_H / 2, 0).applyMatrix4(this.logoObject.matrixWorld).project(this.camera);
    const w = this.css.domElement.clientWidth;
    const ht = this.css.domElement.clientHeight;
    const half = this.menu.offsetWidth / 2;
    // Whole pixels, written only when they change (a style write every frame costs a relayout).
    const x = Math.round(Math.min(Math.max((v.x * 0.5 + 0.5) * w, half + 8), w - half - 8));
    const y = Math.round((-v.y * 0.5 + 0.5) * ht + 8);
    if (x !== this.menuX || y !== this.menuY) {
      this.menuX = x;
      this.menuY = y;
      this.menu.style.left = `${x}px`;
      this.menu.style.top = `${y}px`;
    }
  }

  /** The logo: no video yet, ask for a link; otherwise play or pause. */
  private onLogo(): void {
    if (this.active) this.togglePlay();
    else this.openCard();
  }

  private togglePlay(): void {
    this.command(this.playing ? 'pauseVideo' : 'playVideo');
  }

  private setHover(on: boolean): void {
    window.clearTimeout(this.hideTimer);
    if (on) {
      this.hovering = true;
      this.syncMenu();
      return;
    }
    this.hideTimer = window.setTimeout(() => {
      this.hovering = false;
      this.syncMenu();
    }, MENU_HIDE_MS);
  }

  /** The menu shows while hovered or peeking, and only with a video loaded. */
  private syncMenu(): void {
    const show = this.seated && this.active && (this.hovering || this.peekTimer !== 0);
    if (show === !this.menu.hidden) return;
    this.menu.hidden = !show;
    this.menuX = NaN;
    this.placeMenu();
  }

  /** Logo badge, its tooltip, the play button and the menu title follow the player. */
  private syncControls(): void {
    const state = !this.active ? 'none' : this.playing ? 'playing' : 'paused';
    this.logo.dataset.state = state;
    this.logo.title = state === 'none' ? vi.video.logo : '';
    this.playBtn.innerHTML = this.playing
      ? `${icons.pause}<span>${vi.video.pause}</span>`
      : `${icons.play}<span>${vi.video.resume}</span>`;
    this.menuTitle.textContent = this.title || vi.video.untitled;
  }

  private openCard(): void {
    if (!this.seated) return;
    this.error.textContent = '';
    this.input.value = this.url;
    this.renderRecent();
    this.card.hidden = false;
    this.input.focus();
    this.input.select();
  }

  private closeCard(): void {
    if (this.card.hidden) return;
    this.card.hidden = true;
    this.input.blur();
  }

  private submit(text: string): void {
    const ref = parseYouTubeUrl(text);
    if (!ref) {
      this.error.textContent = vi.video.badLink;
      return;
    }
    if (!navigator.onLine) {
      this.error.textContent = vi.video.offline;
      return;
    }
    this.closeCard();
    this.load(ref, text.trim());
  }

  private load(ref: YouTubeRef, url: string): void {
    this.unload();
    this.url = url;
    this.title = '';
    this.ambienceWanted = false;
    this.peeked = false;
    this.syncAmbienceBtn();
    const f = el('iframe', 'video-iframe');
    f.src = embedUrl(ref, location.origin);
    f.width = String(PX_W);
    f.height = String(PX_H);
    f.title = vi.video.title;
    // YouTube now refuses embeds sent without a referrer (error 153).
    f.referrerPolicy = 'strict-origin-when-cross-origin';
    f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    f.addEventListener('load', () => this.listen());
    this.frame.replaceChildren(f);
    this.iframe = f;
    this.syncControls();
    this.show();
    this.remember(url, '');
  }

  private unload(): void {
    window.clearInterval(this.listenTimer);
    this.frame.replaceChildren();
    this.iframe = null;
    this.ready = false;
    this.setPlaying(false);
    window.clearTimeout(this.peekTimer);
    this.peekTimer = 0;
    this.syncControls();
  }

  /** ✕: close the video; the left screen goes back to the code editor. */
  private stop(): void {
    this.unload();
    this.hovering = false;
    this.show();
  }

  /**
   * The embed only reports its state after being told someone listens (what YouTube's own API
   * script does): say so until it answers.
   */
  private listen(): void {
    window.clearInterval(this.listenTimer);
    let tries = 0;
    const ping = (): void => {
      if (this.ready || tries++ > 40) {
        window.clearInterval(this.listenTimer);
        return;
      }
      this.post({ event: 'listening', id: 'tsw-desk', channel: 'widget' });
    };
    ping();
    this.listenTimer = window.setInterval(ping, 250);
  }

  private readonly onMessage = (e: MessageEvent): void => {
    if (e.origin !== YT_ORIGIN || !this.iframe || e.source !== this.iframe.contentWindow) return;
    const msg = typeof e.data === 'string' ? parseJson(e.data) : e.data;
    if (typeof msg !== 'object' || msg === null) return;
    const { event, info } = msg as { event?: string; info?: unknown };
    if (event === 'onReady' || event === 'initialDelivery') {
      if (!this.ready) {
        this.ready = true;
        this.command('addEventListener', ['onStateChange']);
        this.command('addEventListener', ['onError']);
        this.syncVolume();
      }
    }
    if (event === 'onStateChange' && typeof info === 'number') this.onState(info);
    if (event === 'onError' && typeof info === 'number') this.onError(info);
    if ((event === 'infoDelivery' || event === 'initialDelivery') && typeof info === 'object' && info !== null) {
      const i = info as { playerState?: number; videoData?: { title?: string } };
      if (typeof i.playerState === 'number') this.onState(i.playerState);
      const t = i.videoData?.title;
      if (t && t !== this.title) {
        this.title = t;
        this.remember(this.url, t);
        this.syncControls();
      }
    }
  };

  private onState(state: number): void {
    if (state === YT_STATE.playing) this.setPlaying(true);
    else if (state === YT_STATE.paused || state === YT_STATE.ended) this.setPlaying(false);
  }

  private onError(code: number): void {
    this.setPlaying(false);
    const text =
      code === 101 || code === 150 ? vi.video.noEmbed : code === 100 ? vi.video.notFound : code === 153 ? vi.video.config : vi.video.failed;
    // Back to the card with the reason (the iframe shows YouTube's own error meanwhile).
    this.openCard();
    this.error.textContent = text;
  }

  private setPlaying(on: boolean): void {
    if (on === this.playing) return;
    this.playing = on;
    // The soundscape goes quiet while the video plays, unless you turned it back on.
    this.deps.onPlaying(on && !this.ambienceWanted);
    this.syncControls();
    if (on && !this.peeked && this.seated) {
      // First start of this video: show the menu for a moment (the soundscape just went quiet
      // and its switch lives there).
      this.peeked = true;
      this.peekTimer = window.setTimeout(() => {
        this.peekTimer = 0;
        this.syncMenu();
      }, PEEK_MS);
      this.syncMenu();
    }
  }

  /** The bar's speaker button: soundscape back on (or off again) while the video plays. */
  private toggleAmbience(): void {
    this.ambienceWanted = !this.ambienceWanted;
    this.syncAmbienceBtn();
    if (this.playing) this.deps.onPlaying(!this.ambienceWanted);
  }

  private syncAmbienceBtn(): void {
    const on = this.ambienceWanted;
    this.ambienceBtn.innerHTML = `${on ? icons.speaker : icons.speakerOff}<span>${vi.video.ambience}</span>`;
    this.ambienceBtn.setAttribute('aria-pressed', String(on));
    this.ambienceBtn.title = on ? vi.video.ambienceOn : vi.video.ambienceOff;
  }

  private command(func: string, args: unknown[] = []): void {
    if (this.ready) this.post({ event: 'command', func, args });
  }

  private post(msg: unknown): void {
    this.iframe?.contentWindow?.postMessage(JSON.stringify(msg), YT_ORIGIN);
  }

  // ---- Recent links ----

  private recent(): Recent[] {
    const raw = parseJson(readStored(RECENT_KEY));
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((r): r is Recent => typeof r === 'object' && r !== null && typeof (r as Recent).url === 'string')
      .map((r) => ({ url: r.url.slice(0, 500), title: typeof r.title === 'string' ? r.title.slice(0, 200) : '' }))
      .slice(0, RECENT_MAX);
  }

  private remember(url: string, title: string): void {
    const list = this.recent().filter((r) => r.url !== url);
    const old = this.recent().find((r) => r.url === url);
    list.unshift({ url, title: title || old?.title || '' });
    writeStored(RECENT_KEY, list.slice(0, RECENT_MAX));
  }

  private renderRecent(): void {
    const list = this.recent();
    this.recentList.replaceChildren();
    if (list.length === 0) return;
    this.recentList.append(el('div', 'subhead', vi.video.recent));
    for (const r of list) {
      const b = button(r.title || r.url, () => this.submit(r.url), 'video-recent-item');
      b.title = r.url;
      this.recentList.append(b);
    }
  }
}
