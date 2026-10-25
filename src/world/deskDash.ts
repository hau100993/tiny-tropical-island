import * as THREE from 'three';
import type { PomodoroSnapshot } from '../ui/PomodoroOverlay';
import { vi } from '../ui/strings.vi';
import { parseJson, readStored, writeStored } from '../core/storage';
import {
  addPomodoro,
  addTask,
  completeTask,
  moveTask,
  parseTodo,
  removeTask,
  restoreTask,
  rollDay,
  toggleCurrent,
  type Task,
  type TodoState,
} from '../ui/todo';

/** What the right-hand monitor shows besides the to-do list (filled by the app). */
export interface ScreenInfo {
  pomodoro: PomodoroSnapshot | null;
  scene: string;
  /** What is playing, as one line. */
  playing: string;
  islandTime: string;
  weather: string;
}

export interface DashDeps {
  info(): ScreenInfo;
  /** Start or pause the Pomodoro. */
  toggleTimer(): void;
  skipPhase(): void;
  chimeOn(): boolean;
  toggleChime(): void;
  ambienceOn(): boolean;
  toggleAmbience(): void;
}

/** Something on the screen that reacts to a click. */
export type DashHit =
  | { kind: 'ring' | 'card' | 'delete' | 'restore'; id: string }
  | { kind: 'input' | 'doneHead' | 'timer' | 'skip' | 'chime' | 'ambience' };

const W = 1280;
const H = 720;
/** Canvas size of the right screen, in pixels. */
export const DASH_PX = { w: W, h: H } as const;

const STORAGE_KEY = 'tsw.todo';
const UI_FONT = '"Segoe UI", system-ui, sans-serif';
const TEAL = '#4fd1c1';
const AMBER = '#ffd38a';
const DIM = 'rgba(214,232,238,0.62)';

// Layout (canvas pixels).
const X = 36;
const CW = W - 2 * X;
const STRIP = { x: X, y: 18, w: CW, h: 142 };
const LIST_TOP = 174;
const LIST_BOTTOM = H - 12;
/** With the footer line (scene, sound, island time) shown. */
const LIST_BOTTOM_FOOTER = H - 58;
const HEAD_H = 46;
const CARD_H = 66;
const CARD_STEP = CARD_H + 10;
const DONE_H = 52;
const DONE_STEP = DONE_H + 8;
const BTN = {
  play: { x: 990, y: 88, r: 36 },
  skip: { x: 1076, y: 88, r: 30 },
  chime: { x: 1176, y: 60, r: 24 },
  ambience: { x: 1176, y: 116, r: 24 },
} as const;
const START = { x: 590, y: 56, w: 330, h: 64 };

/** Beyond this distance (m) from the desk the screen is too small to read: don't redraw. */
const NEAR_ENOUGH = 14;
/** Redraws per second: seated (animations, typing, dragging), close by, farther. */
const FPS_SEATED = 24;
const FPS_NEAR = 4;
const FPS_FAR = 1;
/** Background: drawn small, then scaled up (the scaling blurs it for free). */
const BG_SCALE = 8;

/** Slowly drifting colour blobs behind the glass. */
const BLOBS: ReadonlyArray<{ color: string; r: number; fx: number; fy: number; phase: number }> = [
  { color: 'rgba(31,181,168,0.85)', r: 0.55, fx: 0.031, fy: 0.023, phase: 0 },
  { color: 'rgba(42,111,214,0.8)', r: 0.6, fx: 0.019, fy: 0.029, phase: 2.1 },
  { color: 'rgba(226,121,143,0.6)', r: 0.42, fx: 0.027, fy: 0.017, phase: 4.2 },
  { color: 'rgba(243,180,91,0.45)', r: 0.36, fx: 0.015, fy: 0.033, phase: 1.3 },
];

type RowKind = 'head' | 'task' | 'input' | 'doneHead' | 'done';

interface Row {
  key: string;
  kind: RowKind;
  /** Target top, in list content coordinates (0 = top of the list). */
  y: number;
  h: number;
  task?: Task;
}

/** Animated state of a row: where it is drawn, its opacity. */
interface RowAnim {
  y: number;
  a: number;
}

/** A finished or deleted card fading out where it was. */
interface Ghost {
  task: Task;
  y: number;
  t: number;
  pop: boolean;
}

interface HitRect {
  x: number;
  y: number;
  w: number;
  h: number;
  hit: DashHit;
}

/**
 * The right desk monitor: a compact Pomodoro strip on top and the to-do list below, as "liquid
 * glass" cards over drifting colour blobs. Everything is drawn on one canvas (the same picture
 * close up, from afar and in reflections); DeskDashInput turns clicks on the 3D screen into
 * canvas pixels and calls `hitAt` / `activate`. The list is kept in localStorage.
 */
export class DeskDash {
  private readonly g: CanvasRenderingContext2D;
  private readonly tex: THREE.CanvasTexture;
  private readonly bg: CanvasRenderingContext2D;
  private readonly center = new THREE.Vector3();
  private todo: TodoState;
  private time = 0;
  private drawTimer = 0;
  /** Time since the last draw (animations advance by it). */
  private sinceDraw = 0;
  private dayCheck = 0;
  private readonly anims = new Map<string, RowAnim>();
  private ghosts: Ghost[] = [];
  private hits: HitRect[] = [];
  private hover = '';
  private scroll = 0;
  private scrollTarget = 0;
  private listBottom = LIST_BOTTOM;
  private doneOpen = true;
  // Typing a new task (the text comes from DeskDashInput's hidden input).
  private editing = false;
  private draft = '';
  private caret = 0;
  private caretTime = 0;
  // Dragging a card.
  private dragId: string | null = null;
  /** Pointer y on the canvas, and where in the card it grabbed. */
  private dragY = 0;
  private dragGrab = 0;
  private dragIndex = 0;
  /** A task was finished: its card's rectangle on the canvas (for the bubbles, Phase 12c). */
  onTaskDone: ((x: number, y: number, w: number, h: number) => void) | null = null;

  constructor(
    mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>,
    anisotropy: number,
    private readonly deps: DashDeps,
  ) {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d');
    const bgCanvas = document.createElement('canvas');
    bgCanvas.width = W / BG_SCALE;
    bgCanvas.height = H / BG_SCALE;
    const bg = bgCanvas.getContext('2d');
    if (!g || !bg) throw new Error('2D canvas unavailable');
    this.g = g;
    this.bg = bg;
    this.tex = new THREE.CanvasTexture(canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = anisotropy;
    mesh.material.map = this.tex;
    mesh.material.color.set('#ffffff');
    mesh.material.needsUpdate = true;
    mesh.getWorldPosition(this.center);
    const raw = parseJson(readStored(STORAGE_KEY));
    this.doneOpen = !(typeof raw === 'object' && raw !== null && (raw as { doneOpen?: unknown }).doneOpen === false);
    this.todo = parseTodo(raw, Date.now());
  }

  // ---- Called by the app and by DeskDashInput ----

  /** Seated at the desk: draws fast enough for animations and typing. */
  update(dt: number, camera: THREE.Camera, seated: boolean): void {
    this.time += dt;
    this.sinceDraw += dt;
    this.caretTime += dt;
    this.dayCheck -= dt;
    if (this.dayCheck <= 0) {
      this.dayCheck = 10;
      const next = rollDay(this.todo, Date.now());
      if (next !== this.todo) this.set(next);
    }
    const dist = camera.position.distanceTo(this.center);
    if (dist > NEAR_ENOUGH) return;
    this.drawTimer -= dt;
    if (this.drawTimer > 0) return;
    this.drawTimer = 1 / (seated ? FPS_SEATED : dist < 4 ? FPS_NEAR : FPS_FAR);
    this.draw(Math.min(this.sinceDraw, 0.25));
    this.sinceDraw = 0;
  }

  /** Focus sessions ended: a 🍅 for the current task and the day. */
  addPomodoros(count: number): void {
    this.set(addPomodoro(rollDay(this.todo, Date.now()), count));
  }

  /** What is under canvas pixel (x, y), if anything reacts there. */
  hitAt(x: number, y: number): DashHit | null {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const r = this.hits[i];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r.hit;
    }
    return null;
  }

  /** The pointer is over the list (the wheel scrolls it there). */
  inList(x: number, y: number): boolean {
    return x >= X && x <= X + CW && y >= LIST_TOP && y <= this.listBottom;
  }

  setHover(hit: DashHit | null): void {
    this.hover = hit ? hitKey(hit) : '';
  }

  scrollBy(dy: number): void {
    this.scrollTarget = this.clampScroll(this.scrollTarget + dy * 0.6);
  }

  /** A click (press and release without dragging) on `hit`. */
  activate(hit: DashHit): void {
    switch (hit.kind) {
      case 'ring':
        this.complete(hit.id);
        break;
      case 'card':
        this.set(toggleCurrent(this.todo, hit.id));
        break;
      case 'delete': {
        const a = this.anims.get(`o:${hit.id}`);
        const task = this.todo.open.find((t) => t.id === hit.id);
        if (a && task) this.ghosts.push({ task, y: a.y, t: 0, pop: false });
        this.set(removeTask(this.todo, hit.id));
        break;
      }
      case 'restore':
        this.set(restoreTask(this.todo, hit.id));
        break;
      case 'doneHead':
        this.doneOpen = !this.doneOpen;
        this.save();
        break;
      case 'timer':
        this.deps.toggleTimer();
        break;
      case 'skip':
        this.deps.skipPhase();
        break;
      case 'chime':
        this.deps.toggleChime();
        break;
      case 'ambience':
        this.deps.toggleAmbience();
        break;
      case 'input':
        break;
    }
    this.drawTimer = 0;
  }

  /** The hidden input's text and caret; `editing` while it has the focus. */
  setDraft(text: string, caret: number, editing: boolean): void {
    if (editing && !this.editing) this.reveal('input');
    this.editing = editing;
    this.draft = text;
    this.caret = caret;
    this.caretTime = 0;
    this.drawTimer = 0;
  }

  /** Enter in the input: adds the task. */
  submit(text: string): void {
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    this.set(addTask(this.todo, text, id));
    this.reveal('input');
  }

  beginDrag(id: string, y: number): void {
    const a = this.anims.get(`o:${id}`);
    if (!a) return;
    this.dragId = id;
    this.dragY = y;
    this.dragGrab = y - (LIST_TOP + a.y - this.scroll);
    this.dragIndex = this.todo.open.findIndex((t) => t.id === id);
  }

  dragTo(y: number): void {
    if (this.dragId) this.dragY = y;
  }

  endDrag(): void {
    if (!this.dragId) return;
    const id = this.dragId;
    this.dragId = null;
    // The card settles from where it was dropped.
    const a = this.anims.get(`o:${id}`);
    if (a) a.y = this.dragY - this.dragGrab - LIST_TOP + this.scroll;
    this.set(moveTask(this.todo, id, this.dragIndex));
  }

  get dragging(): boolean {
    return this.dragId !== null;
  }

  dispose(): void {
    this.tex.dispose();
  }

  // ---- State ----

  private set(next: TodoState): void {
    this.todo = next;
    this.save();
    this.drawTimer = 0;
  }

  private save(): void {
    writeStored(STORAGE_KEY, { ...this.todo, doneOpen: this.doneOpen });
  }

  private complete(id: string): void {
    const a = this.anims.get(`o:${id}`);
    const task = this.todo.open.find((t) => t.id === id);
    if (!a || !task) return;
    this.ghosts.push({ task, y: a.y, t: 0, pop: true });
    const top = LIST_TOP + a.y - this.scroll;
    this.onTaskDone?.(X, top, CW, CARD_H);
    this.set(completeTask(rollDay(this.todo, Date.now()), id));
  }

  /** Scrolls so that the row `key` is in view. */
  private reveal(key: string): void {
    const row = this.layout().find((r) => r.key === key);
    if (!row) return;
    const view = this.listBottom - LIST_TOP;
    if (row.y < this.scrollTarget) this.scrollTarget = row.y;
    else if (row.y + row.h > this.scrollTarget + view) this.scrollTarget = row.y + row.h - view + 8;
    this.scrollTarget = this.clampScroll(this.scrollTarget);
  }

  private clampScroll(v: number): number {
    const rows = this.layout();
    const last = rows[rows.length - 1];
    const content = last ? last.y + last.h + 8 : 0;
    return Math.max(0, Math.min(v, content - (this.listBottom - LIST_TOP)));
  }

  /** The list's rows and where they belong (content coordinates). */
  private layout(): Row[] {
    const rows: Row[] = [{ key: 'head', kind: 'head', y: 0, h: HEAD_H }];
    let y = HEAD_H;
    const open = this.dragId ? this.todo.open.filter((t) => t.id !== this.dragId) : this.todo.open;
    open.forEach((task, i) => {
      // Leave a gap where the dragged card would land.
      if (this.dragId && i === this.dragIndex) y += CARD_STEP;
      rows.push({ key: `o:${task.id}`, kind: 'task', y, h: CARD_H, task });
      y += CARD_STEP;
    });
    if (this.dragId && this.dragIndex >= open.length) y += CARD_STEP;
    rows.push({ key: 'input', kind: 'input', y, h: CARD_H });
    y += CARD_STEP;
    if (this.todo.done.length > 0) {
      y += 6;
      rows.push({ key: 'doneHead', kind: 'doneHead', y, h: HEAD_H });
      y += HEAD_H;
      if (this.doneOpen) {
        for (const task of this.todo.done) {
          rows.push({ key: `d:${task.id}`, kind: 'done', y, h: DONE_H, task });
          y += DONE_STEP;
        }
      }
    }
    return rows;
  }

  // ---- Drawing ----

  private draw(dt: number): void {
    const g = this.g;
    const info = this.deps.info();
    const p = info.pomodoro;
    const timerOn = p !== null && p.started;
    this.listBottom = timerOn ? LIST_BOTTOM : LIST_BOTTOM_FOOTER;
    this.hits = [];

    this.drawBackground();
    this.drawStrip(info.pomodoro, timerOn);

    // Dragging: which slot the card is over, and scroll when held near an edge.
    if (this.dragId) {
      const contentY = this.dragY - this.dragGrab - LIST_TOP + this.scroll + CARD_H / 2;
      const n = this.todo.open.length;
      this.dragIndex = Math.max(0, Math.min(n - 1, Math.floor((contentY - HEAD_H) / CARD_STEP)));
      if (this.dragY < LIST_TOP + 40) this.scrollTarget = this.clampScroll(this.scrollTarget - 600 * dt);
      else if (this.dragY > this.listBottom - 40) this.scrollTarget = this.clampScroll(this.scrollTarget + 600 * dt);
    }
    this.scrollTarget = this.clampScroll(this.scrollTarget);
    this.scroll += (this.scrollTarget - this.scroll) * Math.min(1, dt * 14);

    const rows = this.layout();
    const k = Math.min(1, dt * 14);
    const live = new Set<string>();
    for (const r of rows) {
      live.add(r.key);
      let a = this.anims.get(r.key);
      if (!a) {
        a = { y: r.y, a: 0 };
        this.anims.set(r.key, a);
      }
      a.y += (r.y - a.y) * k;
      a.a = Math.min(1, a.a + dt * 5);
    }
    for (const key of this.anims.keys()) if (!live.has(key) && key !== `o:${this.dragId}`) this.anims.delete(key);

    g.save();
    g.beginPath();
    g.rect(0, LIST_TOP - 6, W, this.listBottom - LIST_TOP + 6);
    g.clip();
    for (const r of rows) {
      const a = this.anims.get(r.key);
      if (!a) continue;
      const top = LIST_TOP + a.y - this.scroll;
      if (top > this.listBottom || top + r.h < LIST_TOP - 6) continue;
      this.drawRow(r, top, a.a);
    }
    this.ghosts = this.ghosts.filter((gh) => (gh.t += dt / 0.4) < 1);
    for (const gh of this.ghosts) this.drawGhost(gh);
    g.restore();
    this.drawScrollbar(rows);

    if (this.dragId) {
      const task = this.todo.open.find((t) => t.id === this.dragId);
      if (task) this.drawTask(task, this.dragY - this.dragGrab, 1, true);
    }
    if (!timerOn) this.drawFooter(info);
    this.tex.needsUpdate = true;
  }

  private drawBackground(): void {
    const b = this.bg;
    const bw = W / BG_SCALE;
    const bh = H / BG_SCALE;
    b.fillStyle = '#0b2230';
    b.fillRect(0, 0, bw, bh);
    const t = this.time;
    for (const blob of BLOBS) {
      const cx = bw * (0.5 + 0.42 * Math.sin(t * blob.fx * 2 * Math.PI + blob.phase));
      const cy = bh * (0.5 + 0.4 * Math.cos(t * blob.fy * 2 * Math.PI + blob.phase * 1.7));
      const r = blob.r * bw;
      const grad = b.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0, blob.color);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      b.fillStyle = grad;
      b.fillRect(0, 0, bw, bh);
    }
    const g = this.g;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(b.canvas, 0, 0, W, H);
    // Darker, for the text on top.
    g.fillStyle = 'rgba(5,14,22,0.38)';
    g.fillRect(0, 0, W, H);
  }

  /**
   * A "liquid glass" panel: soft shadow, the background seen through it slightly magnified (a
   * lens), a white tint and a gloss on its upper half, and a rim lit from the top left.
   */
  private glass(x: number, y: number, w: number, h: number, r: number, alpha: number, opts: { tint?: number; glow?: string; lift?: number; dashed?: boolean } = {}): void {
    const g = this.g;
    const lift = opts.lift ?? 0;
    g.save();
    g.globalAlpha = alpha;
    if (lift > 0) {
      g.shadowColor = 'rgba(0,0,0,0.4)';
      g.shadowBlur = 30;
      g.shadowOffsetY = 14;
      g.fillStyle = 'rgba(20,40,50,0.5)';
      g.beginPath();
      g.roundRect(x, y, w, h, r);
      g.fill();
      g.shadowColor = 'transparent';
    } else if (!opts.dashed) {
      // A cheap soft shadow: two offset copies, no blur.
      g.fillStyle = 'rgba(0,0,0,0.14)';
      g.beginPath();
      g.roundRect(x, y + 6, w, h, r);
      g.fill();
      g.fillStyle = 'rgba(0,0,0,0.1)';
      g.beginPath();
      g.roundRect(x + 2, y + 3, w - 4, h, r);
      g.fill();
    }
    g.save();
    g.beginPath();
    g.roundRect(x, y, w, h, r);
    g.clip();
    if (!opts.dashed) {
      const mag = 1.08;
      const sw = w / mag;
      const sh = h / mag;
      g.globalAlpha = alpha * 0.9;
      g.drawImage(this.bg.canvas, (x + (w - sw) / 2) / BG_SCALE, (y + (h - sh) / 2) / BG_SCALE, sw / BG_SCALE, sh / BG_SCALE, x, y, w, h);
      g.globalAlpha = alpha;
    }
    g.fillStyle = `rgba(255,255,255,${opts.tint ?? 0.08})`;
    g.fillRect(x, y, w, h);
    const gloss = g.createLinearGradient(0, y, 0, y + h);
    gloss.addColorStop(0, 'rgba(255,255,255,0.2)');
    gloss.addColorStop(0.5, 'rgba(255,255,255,0.03)');
    gloss.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gloss;
    g.fillRect(x, y, w, h);
    g.restore();
    const rim = g.createLinearGradient(x, y, x + w * 0.3, y + h * 1.6);
    rim.addColorStop(0, 'rgba(255,255,255,0.7)');
    rim.addColorStop(0.35, 'rgba(255,255,255,0.16)');
    rim.addColorStop(0.75, 'rgba(255,255,255,0.06)');
    rim.addColorStop(1, 'rgba(255,255,255,0.3)');
    g.strokeStyle = rim;
    g.lineWidth = 1.6;
    if (opts.dashed) g.setLineDash([10, 8]);
    g.beginPath();
    g.roundRect(x + 0.8, y + 0.8, w - 1.6, h - 1.6, r);
    g.stroke();
    g.setLineDash([]);
    if (opts.glow) {
      g.shadowColor = opts.glow;
      g.shadowBlur = 16;
      g.strokeStyle = opts.glow;
      g.lineWidth = 2.2;
      g.stroke();
    }
    g.restore();
  }

  private drawStrip(p: PomodoroSnapshot | null, timerOn: boolean): void {
    const g = this.g;
    const s = STRIP;
    this.glass(s.x, s.y, s.w, s.h, 26, 1, { tint: 0.07 });
    const now = new Date();
    const stats = `✓ ${this.todo.done.length}   🍅 ${this.todo.pomosToday}`;
    if (p && timerOn) {
      const color = p.onBreak ? AMBER : TEAL;
      g.font = `600 28px ${UI_FONT}`;
      g.fillStyle = color;
      g.fillText(p.phase + (p.running ? '' : ` (${vi.dash.paused})`), 70, 62);
      g.font = `24px ${UI_FONT}`;
      g.globalAlpha = 0.85;
      g.fillText(p.dots, 70, 98);
      g.globalAlpha = 1;
      g.font = `22px ${UI_FONT}`;
      g.fillStyle = DIM;
      g.fillText(stats, 70, 136);
      g.font = `300 104px ${UI_FONT}`;
      g.fillStyle = p.running ? '#ffffff' : 'rgba(255,255,255,0.7)';
      g.textAlign = 'center';
      g.fillText(p.remaining, 590, 128);
      g.textAlign = 'left';
      // Progress along the strip's bottom edge.
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.beginPath();
      g.roundRect(70, 148, 1070, 5, 2.5);
      g.fill();
      g.fillStyle = color;
      g.beginPath();
      g.roundRect(70, 148, Math.max(5, 1070 * Math.min(1, p.progress)), 5, 2.5);
      g.fill();
      this.roundButton(BTN.play, 'timer', p.running ? 'pause' : 'play', true);
      this.roundButton(BTN.skip, 'skip', 'skip', false);
    } else {
      g.font = `200 82px ${UI_FONT}`;
      g.fillStyle = '#ffffff';
      g.fillText(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`, 64, 108);
      g.font = `24px ${UI_FONT}`;
      g.fillStyle = DIM;
      g.fillText(`${vi.dash.days[now.getDay()]}, ${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}     ${stats}`, 70, 144);
      // "Bắt đầu tập trung".
      const b = START;
      const hov = this.hover === 'timer';
      this.glass(b.x, b.y, b.w, b.h, b.h / 2, 1, { tint: hov ? 0.2 : 0.12, glow: hov ? TEAL : undefined });
      g.fillStyle = TEAL;
      drawIcon(g, 'play', b.x + 44, b.y + b.h / 2, 14);
      g.font = `600 27px ${UI_FONT}`;
      g.fillStyle = '#ffffff';
      g.fillText(vi.dash.start, b.x + 72, b.y + b.h / 2 + 9);
      this.hits.push({ x: b.x, y: b.y, w: b.w, h: b.h, hit: { kind: 'timer' } });
    }
    this.emojiButton(BTN.chime, 'chime', '🔔', this.deps.chimeOn());
    this.emojiButton(BTN.ambience, 'ambience', '🌊', this.deps.ambienceOn());
  }

  private roundButton(b: { x: number; y: number; r: number }, kind: 'timer' | 'skip', icon: 'play' | 'pause' | 'skip', primary: boolean): void {
    const g = this.g;
    const hov = this.hover === kind;
    this.glass(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2, b.r, 1, { tint: hov ? 0.24 : primary ? 0.14 : 0.08, glow: hov ? TEAL : undefined });
    g.fillStyle = '#ffffff';
    drawIcon(g, icon, b.x, b.y, b.r * 0.42);
    this.hits.push({ x: b.x - b.r, y: b.y - b.r, w: b.r * 2, h: b.r * 2, hit: { kind } });
  }

  private emojiButton(b: { x: number; y: number; r: number }, kind: 'chime' | 'ambience', emoji: string, on: boolean): void {
    const g = this.g;
    const hov = this.hover === kind;
    this.glass(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2, b.r, 1, { tint: hov ? 0.22 : 0.06 });
    g.save();
    g.globalAlpha = on ? 1 : 0.35;
    g.font = `${Math.round(b.r * 1.05)}px "Segoe UI Emoji", ${UI_FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(emoji, b.x, b.y + 1);
    g.restore();
    if (!on) {
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.lineWidth = 3;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(b.x - b.r * 0.55, b.y + b.r * 0.55);
      g.lineTo(b.x + b.r * 0.55, b.y - b.r * 0.55);
      g.stroke();
    }
    this.hits.push({ x: b.x - b.r, y: b.y - b.r, w: b.r * 2, h: b.r * 2, hit: { kind } });
  }

  private drawRow(r: Row, top: number, alpha: number): void {
    const g = this.g;
    switch (r.kind) {
      case 'head': {
        g.globalAlpha = alpha;
        g.font = `600 26px ${UI_FONT}`;
        g.fillStyle = '#ffffff';
        const title = vi.dash.todo;
        g.fillText(title, X + 8, top + 32);
        const tw = g.measureText(title).width;
        g.font = `24px ${UI_FONT}`;
        g.fillStyle = DIM;
        g.fillText(String(this.todo.open.length), X + 22 + tw, top + 32);
        g.font = `19px ${UI_FONT}`;
        g.textAlign = 'right';
        g.fillText(vi.dash.hint, X + CW - 8, top + 31);
        g.textAlign = 'left';
        g.globalAlpha = 1;
        break;
      }
      case 'task':
        if (r.task) this.drawTask(r.task, top, alpha, false);
        break;
      case 'input':
        this.drawInput(top, alpha);
        break;
      case 'doneHead': {
        g.globalAlpha = alpha;
        g.font = `24px ${UI_FONT}`;
        g.fillStyle = this.hover === 'doneHead' ? '#ffffff' : DIM;
        g.fillText(`${this.doneOpen ? '▾' : '▸'}  ${vi.dash.doneToday} · ${this.todo.done.length}`, X + 8, top + 30);
        g.globalAlpha = 1;
        this.pushListHit(X, top, CW, HEAD_H, { kind: 'doneHead' });
        break;
      }
      case 'done':
        if (r.task) this.drawDone(r.task, top, alpha);
        break;
    }
  }

  private drawTask(task: Task, top: number, alpha: number, lifted: boolean): void {
    const g = this.g;
    const current = this.todo.current === task.id;
    const hovCard = this.hover === `card:${task.id}`;
    const hovRing = this.hover === `ring:${task.id}`;
    const hovDel = this.hover === `delete:${task.id}`;
    const hovAny = hovCard || hovRing || hovDel || lifted;
    this.glass(X, top, CW, CARD_H, 22, alpha, {
      tint: hovAny ? 0.13 : 0.08,
      glow: current ? 'rgba(79,209,193,0.9)' : undefined,
      lift: lifted ? 1 : 0,
    });
    const cy = top + CARD_H / 2;
    g.save();
    g.globalAlpha = alpha;
    // The ring: click it when the task is done.
    g.beginPath();
    g.arc(X + 40, cy, 16, 0, Math.PI * 2);
    if (hovRing) {
      g.fillStyle = 'rgba(79,209,193,0.35)';
      g.fill();
    }
    g.strokeStyle = hovRing ? TEAL : 'rgba(255,255,255,0.75)';
    g.lineWidth = 2.6;
    g.stroke();
    if (hovRing) {
      g.strokeStyle = '#ffffff';
      drawCheck(g, X + 40, cy, 8);
    }
    // Right side: ✕ on hover, tomatoes, "Đang làm".
    let right = X + CW - 24;
    if (hovAny && !lifted) {
      g.strokeStyle = hovDel ? '#ff9a9a' : 'rgba(255,255,255,0.55)';
      g.lineWidth = 2.6;
      g.lineCap = 'round';
      const dx = right - 10;
      g.beginPath();
      g.moveTo(dx - 8, cy - 8);
      g.lineTo(dx + 8, cy + 8);
      g.moveTo(dx + 8, cy - 8);
      g.lineTo(dx - 8, cy + 8);
      g.stroke();
      right -= 44;
    }
    g.textAlign = 'right';
    if (task.pomos > 0) {
      g.font = `24px "Segoe UI Emoji", ${UI_FONT}`;
      g.fillStyle = '#ffffff';
      const t = task.pomos > 4 ? `🍅×${task.pomos}` : '🍅'.repeat(task.pomos);
      g.fillText(t, right, cy + 9);
      right -= g.measureText(t).width + 16;
    }
    if (current) {
      g.font = `600 19px ${UI_FONT}`;
      const label = vi.dash.current.toUpperCase();
      const lw = g.measureText(label).width;
      g.fillStyle = 'rgba(79,209,193,0.2)';
      g.beginPath();
      g.roundRect(right - lw - 14, cy - 15, lw + 28, 30, 15);
      g.fill();
      g.fillStyle = TEAL;
      g.fillText(label, right, cy + 7);
      right -= lw + 40;
    }
    g.textAlign = 'left';
    g.font = `30px ${UI_FONT}`;
    g.fillStyle = '#ffffff';
    g.fillText(ellipsize(g, task.text, right - (X + 76)), X + 76, cy + 10);
    g.restore();
    if (!lifted) {
      this.pushListHit(X, top, CW, CARD_H, { kind: 'card', id: task.id });
      this.pushListHit(X + 8, top, 66, CARD_H, { kind: 'ring', id: task.id });
      if (hovAny) this.pushListHit(X + CW - 66, top, 66, CARD_H, { kind: 'delete', id: task.id });
    }
  }

  private drawInput(top: number, alpha: number): void {
    const g = this.g;
    const hov = this.hover === 'input';
    this.glass(X, top, CW, CARD_H, 22, alpha, { tint: this.editing ? 0.12 : hov ? 0.08 : 0.03, dashed: !this.editing, glow: this.editing ? 'rgba(255,255,255,0.5)' : undefined });
    const cy = top + CARD_H / 2;
    g.save();
    g.globalAlpha = alpha;
    g.strokeStyle = this.editing ? TEAL : 'rgba(255,255,255,0.7)';
    g.lineWidth = 3;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(X + 30, cy);
    g.lineTo(X + 50, cy);
    g.moveTo(X + 40, cy - 10);
    g.lineTo(X + 40, cy + 10);
    g.stroke();
    g.font = `30px ${UI_FONT}`;
    const tx = X + 76;
    if (this.editing) {
      g.font = `19px ${UI_FONT}`;
      g.fillStyle = DIM;
      g.textAlign = 'right';
      g.fillText(vi.dash.addHint, X + CW - 24, cy + 7);
      const hintW = g.measureText(vi.dash.addHint).width;
      g.textAlign = 'left';
      g.font = `30px ${UI_FONT}`;
      const maxW = CW - 76 - hintW - 56;
      // Keep the caret in view: show the end of a long draft.
      let start = 0;
      while (start < this.caret && g.measureText(this.draft.slice(start, this.caret)).width > maxW) start++;
      const shown = ellipsize(g, this.draft.slice(start), maxW);
      g.fillStyle = '#ffffff';
      g.fillText(shown, tx, cy + 10);
      if (this.caretTime % 1 < 0.6) {
        const cx = tx + g.measureText(this.draft.slice(start, this.caret)).width + 1;
        g.fillStyle = TEAL;
        g.fillRect(cx, cy - 17, 2.5, 34);
      }
    } else {
      g.fillStyle = hov ? 'rgba(255,255,255,0.85)' : DIM;
      g.fillText(vi.dash.add, tx, cy + 10);
    }
    g.restore();
    this.pushListHit(X, top, CW, CARD_H, { kind: 'input' });
  }

  private drawDone(task: Task, top: number, alpha: number): void {
    const g = this.g;
    const hov = this.hover === `restore:${task.id}`;
    this.glass(X + 24, top, CW - 24, DONE_H, 18, alpha * 0.75, { tint: hov ? 0.1 : 0.04 });
    const cy = top + DONE_H / 2;
    g.save();
    g.globalAlpha = alpha * (hov ? 1 : 0.8);
    g.beginPath();
    g.arc(X + 58, cy, 13, 0, Math.PI * 2);
    g.fillStyle = hov ? 'rgba(255,255,255,0.25)' : 'rgba(79,209,193,0.75)';
    g.fill();
    g.strokeStyle = '#ffffff';
    if (hov) drawRestore(g, X + 58, cy, 7);
    else drawCheck(g, X + 58, cy, 6.5);
    let right = X + CW - 24;
    if (task.pomos > 0) {
      g.font = `20px "Segoe UI Emoji", ${UI_FONT}`;
      g.textAlign = 'right';
      g.fillStyle = '#ffffff';
      const t = `🍅×${task.pomos}`;
      g.fillText(t, right, cy + 7);
      right -= g.measureText(t).width + 16;
      g.textAlign = 'left';
    }
    g.font = `25px ${UI_FONT}`;
    g.fillStyle = 'rgba(230,240,244,0.7)';
    const text = ellipsize(g, task.text, right - (X + 90));
    g.fillText(text, X + 90, cy + 8);
    const tw = g.measureText(text).width;
    g.fillStyle = 'rgba(230,240,244,0.55)';
    g.fillRect(X + 90, cy - 1, tw, 2);
    g.restore();
    this.pushListHit(X + 24, top, CW - 24, DONE_H, { kind: 'restore', id: task.id });
  }

  /** A finished card swells a little and fades (bubbles join in Phase 12c); a deleted one just fades. */
  private drawGhost(gh: Ghost): void {
    const g = this.g;
    const top = LIST_TOP + gh.y - this.scroll;
    const e = gh.t;
    const s = gh.pop ? 1 + 0.06 * Math.sin(Math.min(1, e * 1.6) * Math.PI) : 1 - 0.04 * e;
    g.save();
    g.translate(X + CW / 2, top + CARD_H / 2);
    g.scale(s, s);
    g.translate(-(X + CW / 2), -(top + CARD_H / 2));
    const alpha = (1 - e) * (1 - e);
    this.glass(X, top, CW, CARD_H, 22, alpha, { tint: gh.pop ? 0.2 * (1 - e) + 0.08 : 0.08 });
    g.globalAlpha = alpha;
    g.font = `30px ${UI_FONT}`;
    g.fillStyle = '#ffffff';
    g.fillText(ellipsize(g, gh.task.text, CW - 140), X + 76, top + CARD_H / 2 + 10);
    if (gh.pop) {
      g.beginPath();
      g.arc(X + 40, top + CARD_H / 2, 16, 0, Math.PI * 2);
      g.fillStyle = TEAL;
      g.fill();
      g.strokeStyle = '#ffffff';
      drawCheck(g, X + 40, top + CARD_H / 2, 8);
    }
    g.restore();
  }

  private drawScrollbar(rows: Row[]): void {
    const last = rows[rows.length - 1];
    const content = last.y + last.h + 8;
    const view = this.listBottom - LIST_TOP;
    if (content <= view + 1) return;
    const g = this.g;
    const h = Math.max(40, (view * view) / content);
    const y = LIST_TOP + ((view - h) * this.scroll) / (content - view);
    g.fillStyle = 'rgba(255,255,255,0.28)';
    g.beginPath();
    g.roundRect(W - 22, y, 6, h, 3);
    g.fill();
  }

  private drawFooter(info: ScreenInfo): void {
    const g = this.g;
    g.font = `21px ${UI_FONT}`;
    g.fillStyle = DIM;
    const line = `♪  ${info.playing}   ·   ${info.scene || '—'}   ·   ${vi.dash.island} ${info.islandTime}`;
    g.fillText(ellipsize(g, line, CW - 16), X + 8, H - 22);
  }

  /** A clickable area inside the list (cut to the list's visible part). */
  private pushListHit(x: number, y: number, w: number, h: number, hit: DashHit): void {
    const y0 = Math.max(y, LIST_TOP);
    const y1 = Math.min(y + h, this.listBottom);
    if (y1 > y0) this.hits.push({ x, y: y0, w, h: y1 - y0, hit });
  }
}

function hitKey(hit: DashHit): string {
  return 'id' in hit ? `${hit.kind}:${hit.id}` : hit.kind;
}

function drawIcon(g: CanvasRenderingContext2D, icon: 'play' | 'pause' | 'skip', x: number, y: number, s: number): void {
  g.beginPath();
  if (icon === 'play') {
    g.moveTo(x - s * 0.7, y - s);
    g.lineTo(x + s, y);
    g.lineTo(x - s * 0.7, y + s);
    g.closePath();
    g.fill();
  } else if (icon === 'pause') {
    g.roundRect(x - s * 0.85, y - s, s * 0.6, s * 2, 2);
    g.roundRect(x + s * 0.25, y - s, s * 0.6, s * 2, 2);
    g.fill();
  } else {
    g.moveTo(x - s, y - s);
    g.lineTo(x + s * 0.5, y);
    g.lineTo(x - s, y + s);
    g.closePath();
    g.fill();
    g.fillRect(x + s * 0.55, y - s, s * 0.35, s * 2);
  }
}

function drawCheck(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  g.lineWidth = Math.max(2.2, s * 0.38);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(x - s, y);
  g.lineTo(x - s * 0.3, y + s * 0.7);
  g.lineTo(x + s, y - s * 0.65);
  g.stroke();
}

/** ↺: a circular arrow (put the task back). */
function drawRestore(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  g.lineWidth = 2.2;
  g.lineCap = 'round';
  g.beginPath();
  g.arc(x, y, s, -Math.PI * 0.1, Math.PI * 1.45);
  g.stroke();
  g.beginPath();
  g.moveTo(x + s + 4, y - 3);
  g.lineTo(x + s, y + 1);
  g.lineTo(x + s - 4, y - 4);
  g.stroke();
}

function ellipsize(g: CanvasRenderingContext2D, text: string, max: number): string {
  if (max <= 0) return '';
  if (g.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && g.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

