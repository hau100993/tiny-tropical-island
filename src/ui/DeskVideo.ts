import * as THREE from 'three';
import { CSS3DObject, CSS3DRenderer } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import { button, el } from './components';
import { icons } from './icons';
import { vi } from './strings.vi';
import { embedUrl, parseYouTubeUrl, YT_ORIGIN, YT_STATE, type YouTubeRef } from './youtube';
import { parseJson, readStored, writeStored } from '../core/storage';
import { LAUNCHER, SCREEN_PX, type LeftMode, type PxRect } from '../world/deskScreens';

/** The iframe's own size in CSS pixels (16:9 like the screen); CSS3D scales it onto the screen. */
const PX_W = 640;
const PX_H = 360;
const RECENT_KEY = 'tsw.videoRecent';
const RECENT_MAX = 5;
/** The left screen's last choice between idle and the code editor. */
const LEFT_KEY = 'tsw.leftScreen';

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

/** Corner buttons: this share of the screen's on-page width, within these sizes (CSS px). */
const BAR_SHARE = 0.03;
const BAR_MIN = 18;
const BAR_MAX = 30;

/**
 * YouTube on the left desk monitor. A real iframe (YouTube's pixels can't be read into a WebGL
 * texture) is placed with three's CSS3DRenderer, so it sits exactly on the 3D screen and follows
 * every look and zoom. Seated, the layer lies over the canvas (nothing stands between the chair
 * and that screen, and the video takes clicks). Up and about, it keeps playing and the layer
 * moves under the canvas, which is see-through only where that screen is visible (`punchHole`):
 * whatever passes in front of the monitor hides the video. The player is driven with postMessage
 * commands (no YouTube script in this page).
 * The same screen is a small launcher: at rest it shows two app icons (real buttons laid over the
 * ones drawn on its canvas) that open the code editor or the link card. With either open, a button
 * cluster in its top-right corner controls the video and turns the screen back to rest.
 */
export class DeskVideo {
  private readonly css = new CSS3DRenderer();
  private readonly cssScene = new THREE.Scene();
  private readonly object: CSS3DObject;
  private readonly frame: HTMLDivElement;
  private readonly appsObject: CSS3DObject;
  /** Corner buttons: a flat overlay kept over the screen's top-right corner. */
  private readonly bar: HTMLElement;
  private barX = NaN;
  private barY = NaN;
  /** The corner buttons' size (CSS px), following the screen's size in the view. */
  private barSize = NaN;
  /** The code editor is open (when no video is loaded). */
  private editorOn: boolean;
  private iframe: HTMLIFrameElement | null = null;
  private url = '';
  private title = '';
  private seated = false;
  private playing = false;
  private ready = false;
  private listenTimer = 0;
  // Prompt card, and the video's buttons in the corner.
  private readonly card: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly recentList: HTMLElement;
  private readonly error: HTMLElement;
  private readonly tmp = new THREE.Vector3();
  /** The left screen again, drawn as a see-through hole in the canvas (see `punchHole`). */
  private readonly holeScene = new THREE.Scene();

  constructor(
    container: HTMLElement,
    ui: HTMLElement,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly screen: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>,
    private readonly deps: DeskVideoDeps,
  ) {
    this.editorOn = parseJson(readStored(LEFT_KEY)) === 'editor';
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

    // ---- Launcher: real buttons over the two icons drawn on the idle screen ----
    const { code, youtube } = LAUNCHER;
    const apps = el('div', 'screen-apps');
    const codeBtn = button('', () => this.openEditor(), 'screen-app');
    codeBtn.setAttribute('aria-label', vi.video.code);
    codeBtn.title = vi.video.code;
    const ytBtn = button('', () => this.openCard(), 'screen-app');
    ytBtn.setAttribute('aria-label', vi.video.logo);
    ytBtn.title = vi.video.logo;
    for (const [b, r] of [[codeBtn, code], [ytBtn, youtube]] as const) {
      b.style.left = `${r.x - code.x}px`;
      b.style.width = `${r.w}px`;
      b.style.height = `${r.h}px`;
    }
    apps.append(codeBtn, ytBtn);
    this.appsObject = this.onScreen(apps, { x: code.x, y: code.y, w: youtube.x + youtube.w - code.x, h: code.h });

    // ---- Corner buttons: change link (video only) and power ----
    // Not CSS3D: laid a hair in front of the iframe, almost in its plane, Chrome's GPU hit
    // testing can give the click to the video under them. A flat element in the UI layer can't
    // lose it; `update` keeps it over the screen's top-right corner.
    this.bar = el('div', 'screen-bar');
    this.bar.hidden = true;
    const change = button('', () => this.openCard(), 'screen-bar-btn video-only');
    change.innerHTML = icons.link;
    change.title = vi.video.change;
    change.setAttribute('aria-label', vi.video.change);
    const power = button('', () => this.turnOff(), 'screen-bar-btn');
    power.innerHTML = icons.power;
    this.bar.append(change, power);
    ui.append(this.bar);
    const syncPower = (): void => {
      power.title = this.active ? vi.video.close : vi.video.closeEditor;
      power.setAttribute('aria-label', power.title);
    };
    this.bar.addEventListener('pointerenter', syncPower);
    syncPower();

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
    this.card.append(head, form, this.error, this.recentList, el('div', 'hint', vi.video.note), el('div', 'hint', vi.video.focusHint));
    ui.append(this.card);


    window.addEventListener('message', this.onMessage);
  }

  /**
   * Lays `element` on the left screen over the canvas rectangle `r`, one CSS pixel per canvas
   * pixel, a hair in front of the video.
   */
  private onScreen(element: HTMLElement, r: PxRect): CSS3DObject {
    element.style.width = `${r.w}px`;
    element.style.height = `${r.h}px`;
    const obj = new CSS3DObject(element);
    obj.visible = false;
    this.cssScene.add(obj);
    this.screen.matrixWorld.decompose(obj.position, obj.quaternion, this.tmp);
    const d = this.screen.geometry.parameters;
    // Canvas pixels (origin top left) to the screen's metres (origin centre, y up).
    obj.translateX(((r.x + r.w / 2) / SCREEN_PX.w - 0.5) * d.width);
    obj.translateY((0.5 - (r.y + r.h / 2) / SCREEN_PX.h) * d.height);
    obj.translateZ(0.002);
    obj.scale.setScalar(d.width / SCREEN_PX.w);
    return obj;
  }

  /** A video is loaded (playing or paused). */
  get active(): boolean {
    return this.iframe !== null;
  }

  /** What the left screen shows. */
  get leftMode(): LeftMode {
    return this.active ? 'video' : this.editorOn ? 'editor' : 'idle';
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

  /** Seated at the desk or not. Getting up leaves the video playing; the buttons hide. */
  setSeated(on: boolean): void {
    if (on === this.seated) return;
    this.seated = on;
    if (!on) this.closeCard();
    // Seated: over the canvas (clickable). Away: under it, seen through the hole.
    this.css.domElement.classList.toggle('behind', !on);
    this.show();
  }

  /**
   * Shows or hides the video, the launcher and the corner buttons. The CSS renderer only touches
   * the DOM when it renders, so it renders once here too (otherwise a hidden video would stay
   * where it was).
   */
  private show(): void {
    const mode = this.leftMode;
    this.object.visible = this.active;
    this.appsObject.visible = this.seated && mode === 'idle';
    this.bar.hidden = !(this.seated && mode !== 'idle');
    this.bar.dataset.mode = mode;
    this.barX = NaN;
    this.placeBar();
    this.css.render(this.cssScene, this.camera);
  }

  /** The VS Code icon: the typing editor. */
  private openEditor(): void {
    this.editorOn = true;
    writeStored(LEFT_KEY, 'editor');
    this.show();
  }

  /** Power: close the video or the editor; the screen goes back to rest. */
  private turnOff(): void {
    if (this.active) this.unload();
    this.editorOn = false;
    writeStored(LEFT_KEY, 'idle');
    this.show();
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

  /** Every frame: place the iframe and the buttons on the screen. */
  update(): void {
    this.placeBar();
    if (!this.object.visible && !this.appsObject.visible) return;
    this.css.render(this.cssScene, this.camera);
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

  private togglePlay(): void {
    this.command(this.playing ? 'pauseVideo' : 'playVideo');
  }

  /** The corner buttons sit inside the screen's top-right corner, wherever the view turns. */
  private placeBar(): void {
    if (this.bar.hidden) return;
    const p = this.screen.geometry.parameters;
    const v = this.tmp.set(p.width / 2, p.height / 2, 0).applyMatrix4(this.screen.matrixWorld).project(this.camera);
    const r = this.css.domElement.getBoundingClientRect();
    // Whole pixels, written only when they change (a style write every frame costs a relayout).
    const x = Math.round(r.left + (v.x * 0.5 + 0.5) * r.width);
    const y = Math.round(r.top + (-v.y * 0.5 + 0.5) * r.height);
    // Sized like a window's title-bar button: a small share of the screen's width on the page.
    const l = this.tmp.set(-p.width / 2, p.height / 2, 0).applyMatrix4(this.screen.matrixWorld).project(this.camera);
    const size = Math.round(Math.min(BAR_MAX, Math.max(BAR_MIN, ((v.x - l.x) / 2) * r.width * BAR_SHARE)));
    if (size !== this.barSize) {
      this.barSize = size;
      this.bar.style.setProperty('--bar-btn', `${size}px`);
    }
    if (x === this.barX && y === this.barY) return;
    this.barX = x;
    this.barY = y;
    this.bar.style.left = `${x}px`;
    this.bar.style.top = `${y}px`;
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
    // The video takes the screen; closing it goes back to rest, not to the editor.
    this.editorOn = false;
    writeStored(LEFT_KEY, 'idle');
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
    this.show();
    this.remember(url, '');
  }

  private unload(): void {
    window.clearInterval(this.listenTimer);
    this.frame.replaceChildren();
    this.iframe = null;
    this.ready = false;
    this.setPlaying(false);
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
    this.deps.onPlaying(on);
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
