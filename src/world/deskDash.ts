import * as THREE from 'three';
import type { PomodoroSnapshot } from '../ui/PomodoroOverlay';
import { vi } from '../ui/strings.vi';
import { attachScreenCanvas, type ScreenBackdrop } from './screenBackdrop';
import { parseJson, readStored, writeStored } from '../core/storage';
import {
  addPomodoro,
  clearDone,
  MAX_EST,
  renameTask,
  setEstimate,
  addTask,
  completeTask,
  moveTask,
  parseTodo,
  removeTask,
  restoreTask,
  rollDay,
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
  /** A task's ▶: start focusing now (skips the rest of a break). */
  startFocus(): void;
  skipPhase(): void;
  /** End the Pomodoro (back to the clock). */
  resetTimer(): void;
  chimeOn(): boolean;
  toggleChime(): void;
  alertVolume(): number;
  setAlertVolume(v: number): void;
  ambienceOn(): boolean;
  toggleAmbience(): void;
  /** The island's sound (master volume). */
  masterVolume(): number;
  setMasterVolume(v: number): void;
}

export type DashSlider = 'alert' | 'master';

/** Something on the screen that reacts to a click. */
export type DashHit =
  | { kind: 'ring' | 'card' | 'delete' | 'restore' | 'play' | 'remove' | 'estimate'; id: string }
  | { kind: 'slider'; id: DashSlider }
  | { kind: 'input' | 'timer' | 'skip' | 'stop' | 'chime' | 'ambience' | 'undo' | 'clearDone' };

/** A finished task: where its ring was on the canvas (the bubbles start there). */
export interface TaskDone {
  x: number;
  y: number;
  /** No task left: the bigger burst. */
  last: boolean;
}

const W = 1280;
const H = 720;
/** Canvas size of the right screen, in pixels. */
export const DASH_PX = { w: W, h: H } as const;

const STORAGE_KEY = 'tsw.todo';
const UI_FONT = '"Segoe UI", system-ui, sans-serif';
const EMOJI_FONT = `"Segoe UI Emoji", ${UI_FONT}`;
const TEAL = '#4fd1c1';
const AMBER = '#ffd38a';
const DIM = 'rgba(214,232,238,0.66)';

// Layout (canvas pixels). The monitor shows this canvas about 0.4× on a 1080p window, so text
// is large: 40 px here is ~16 px on screen (2026-10-27: bigger, user request).
// The strip: the timer row, then a line with the current (or next) task, then the progress.
const STRIP = { x: 36, y: 16, w: 1208, h: 176 };
const LIST_TOP = 208;
/** "Đã xóa … · Hoàn tác" stays this long (s). */
const UNDO_S = 6;
const LIST_BOTTOM = H - 12;
/** With the footer line (what is playing, scene, island time) shown. */
const LIST_BOTTOM_FOOTER = H - 54;
type Col = 'L' | 'R';
const COLS: Record<Col, { x: number; w: number }> = {
  L: { x: 36, w: 716 },
  R: { x: 772, w: 472 },
};
const HEAD_H = 56;
const CARD_H = 88;
const CARD_STEP = CARD_H + 12;
const DONE_H = 72;
const DONE_STEP = DONE_H + 10;
const RING_X = 46;
/** Where a card's text starts (after the ring). */
const TEXT_X = 90;
const TASK_FONT = 40;
const DONE_FONT = 33;
/** A task's ▶ / ⏸ (radius, canvas px). */
const PLAY_R = 24;
const BTN = {
  play: { x: 680, y: 84, r: 40 },
  skip: { x: 772, y: 84, r: 33 },
  stop: { x: 852, y: 84, r: 33 },
} as const;
const START = { x: 330, y: 52, w: 370, h: 66 };
/** The two volume rows: icon (a round toggle) and a slider track. */
const VOL: Record<DashSlider, { y: number; icon: number; x0: number; x1: number }> = {
  alert: { y: 58, icon: 940, x0: 978, x1: 1214 },
  master: { y: 112, icon: 940, x0: 978, x1: 1214 },
};

/** Beyond this distance (m) from the desk the screen is too small to read: don't redraw. */
const NEAR_ENOUGH = 14;
/**
 * Redraws per second. Each redraw re-uploads the canvas, which makes the CPU wait for the GPU,
 * so it only redraws fast while something moves (cards sliding or fading, scrolling, dragging)
 * or while typing (the caret blinks); otherwise once a second for the clock. The backdrop
 * drifts in the shader (screenBackdrop.ts) and needs no redraw. Clicks redraw at once.
 */
const FPS_ANIMATING = 24;
const FPS_TYPING = 6;
const FPS_IDLE = 1;
const FPS_FAR = 0.5;

type RowKind = 'head' | 'task' | 'input' | 'done' | 'empty' | 'clear';

interface Row {
  key: string;
  kind: RowKind;
  /** Target top, in the column's content coordinates (0 = top of the list). */
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
 * The right desk monitor: a compact Pomodoro strip on top (timer, play/pause, skip, stop, and
 * the notification and soundscape volumes), then two columns of "liquid glass" cards over
 * drifting colour blobs: what to do ("Đang làm", the top task is the one being worked on) and
 * what is done today. Everything is drawn on one canvas (the same picture close up, from afar
 * and in reflections); DeskDashInput turns clicks on the 3D screen into canvas pixels and calls
 * `hitAt` / `activate`. The list is kept in localStorage.
 */
export class DeskDash {
  private readonly g: CanvasRenderingContext2D;
  private readonly tex: THREE.CanvasTexture;
  private readonly backdrop: ScreenBackdrop;
  /** Something moved in the last draw (it redraws fast until everything has settled). */
  private animating = false;
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
  private readonly scroll: Record<Col, number> = { L: 0, R: 0 };
  private readonly scrollTarget: Record<Col, number> = { L: 0, R: 0 };
  private listBottom = LIST_BOTTOM;
  // Typing a new task, or editing one (`editId`); the text comes from DeskDashInput's hidden input.
  private editing = false;
  private editId: string | null = null;
  /** A focus session is running (a task's ⏸ shows on the top one). */
  private focusing = false;
  /** Just deleted something: the list before, and what the toast says, until `until` (this.time). */
  private undo: { prev: TodoState; text: string; until: number } | null = null;
  private draft = '';
  private caret = 0;
  private caretTime = 0;
  // Dragging a card.
  private dragId: string | null = null;
  /** Pointer on the canvas, and where in the card it grabbed. */
  private dragX = 0;
  private dragY = 0;
  private dragGrab = 0;
  private dragIndex = 0;
  /** A task was finished (clicked ring or dropped on "Đã xong"). */
  onTaskDone: ((done: TaskDone) => void) | null = null;

  constructor(
    mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>,
    anisotropy: number,
    private readonly deps: DashDeps,
  ) {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d');
    if (!g) throw new Error('2D canvas unavailable');
    this.g = g;
    const screen = attachScreenCanvas(mesh.material, canvas, anisotropy);
    this.tex = screen.texture;
    this.backdrop = screen.backdrop;
    mesh.getWorldPosition(this.center);
    this.todo = parseTodo(parseJson(readStored(STORAGE_KEY)), Date.now());
  }

  // ---- Called by the app and by DeskDashInput ----

  /** Seated at the desk: draws fast enough for animations and typing. */
  update(dt: number, camera: THREE.Camera, seated: boolean): void {
    this.time += dt;
    this.backdrop.time.value = this.time;
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
    // An animation starting after a quiet spell starts from its first step, not a 1 s jump.
    const step = Math.min(this.sinceDraw, this.animating ? 0.25 : 1 / FPS_ANIMATING);
    this.draw(step);
    this.sinceDraw = 0;
    const moving = this.animating || this.dragId !== null;
    this.drawTimer = 1 / (moving ? FPS_ANIMATING : seated && this.editing ? FPS_TYPING : seated || dist < 4 ? FPS_IDLE : FPS_FAR);
  }

  /** The task being worked on (the top one), for the Pomodoro card; null with none. */
  get currentTask(): string | null {
    return this.todo.open[0]?.text ?? null;
  }

  /** Focus sessions ended: a 🍅 for the top task and the day. */
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

  /** The column under (x, y) the wheel scrolls, or null. */
  private colAt(x: number, y: number): Col | null {
    if (y < LIST_TOP || y > this.listBottom) return null;
    for (const c of ['L', 'R'] as const) if (x >= COLS[c].x && x <= COLS[c].x + COLS[c].w) return c;
    return null;
  }

  /** The pointer is over a list (the wheel scrolls it there). */
  inList(x: number, y: number): boolean {
    return this.colAt(x, y) !== null;
  }

  setHover(hit: DashHit | null): void {
    const hover = hit ? hitKey(hit) : '';
    if (hover === this.hover) return;
    this.hover = hover;
    this.drawTimer = 0;
  }

  scrollBy(x: number, y: number, dy: number): void {
    const c = this.colAt(x, y);
    if (c) this.scrollTarget[c] = this.clampScroll(c, this.scrollTarget[c] + dy * 0.6);
  }

  /** Sets a volume slider from canvas x (a click or a drag on it). */
  slide(id: DashSlider, x: number): void {
    const v = VOL[id];
    const value = Math.min(1, Math.max(0, (x - v.x0) / (v.x1 - v.x0)));
    if (id === 'alert') this.deps.setAlertVolume(value);
    else this.deps.setMasterVolume(value);
    this.drawTimer = 0;
  }

  /** The wheel over a slider: ±5 % a notch. */
  nudge(id: DashSlider, dir: number): void {
    const now = id === 'alert' ? this.deps.alertVolume() : this.deps.masterVolume();
    const value = Math.min(1, Math.max(0, Math.round((now + dir * 0.05) * 20) / 20));
    if (id === 'alert') this.deps.setAlertVolume(value);
    else this.deps.setMasterVolume(value);
    this.drawTimer = 0;
  }

  /** A click (press and release without dragging) on `hit`. */
  activate(hit: DashHit): void {
    switch (hit.kind) {
      case 'ring':
        this.complete(hit.id, null);
        break;
      case 'delete': {
        const a = this.anims.get(`o:${hit.id}`);
        const task = this.todo.open.find((t) => t.id === hit.id);
        if (a && task) this.ghosts.push({ task, y: a.y, t: 0, pop: false });
        if (task) this.keepUndo(vi.dash.deleted(task.text));
        this.set(removeTask(this.todo, hit.id));
        break;
      }
      case 'estimate': {
        // 🍅: one more expected session each click, past MAX_EST back to none.
        const task = this.todo.open.find((t) => t.id === hit.id);
        if (task) this.set(setEstimate(this.todo, hit.id, ((task.est ?? 0) + 1) % (MAX_EST + 1)));
        break;
      }
      case 'clearDone':
        if (this.todo.done.length === 0) break;
        this.keepUndo(vi.dash.cleared(this.todo.done.length));
        this.set(clearDone(this.todo));
        break;
      case 'undo':
        if (this.undo) this.set(rollDay(this.undo.prev, Date.now()));
        this.undo = null;
        break;
      case 'restore':
        this.set(restoreTask(this.todo, hit.id));
        break;
      case 'remove': {
        const task = this.todo.done.find((t) => t.id === hit.id);
        if (task) this.keepUndo(vi.dash.deleted(task.text));
        this.set(removeTask(this.todo, hit.id));
        break;
      }
      case 'play':
        // The top task's ⏸ pauses; any other ▶ makes that task the current one and focuses.
        if (this.focusing && this.todo.open[0]?.id === hit.id) this.deps.toggleTimer();
        else {
          if (this.todo.open[0]?.id !== hit.id) this.set(moveTask(this.todo, hit.id, 0));
          this.reveal(`o:${hit.id}`);
          this.deps.startFocus();
        }
        break;
      case 'timer':
        this.deps.toggleTimer();
        break;
      case 'skip':
        this.deps.skipPhase();
        break;
      case 'stop':
        this.deps.resetTimer();
        break;
      case 'chime':
        this.deps.toggleChime();
        break;
      case 'ambience':
        this.deps.toggleAmbience();
        break;
      case 'card':
      case 'input':
      case 'slider':
        break;
    }
    this.drawTimer = 0;
  }

  /**
   * Double-click on a card: edit that task in place (null: stop editing). Returns the task's
   * text to put in the hidden input, or null if there is no such open task.
   */
  beginEdit(id: string | null): string | null {
    this.editId = null;
    this.drawTimer = 0;
    const task = id === null ? undefined : this.todo.open.find((t) => t.id === id);
    if (!task) return null;
    this.editId = task.id;
    this.reveal(`o:${task.id}`);
    return task.text;
  }

  /** Enter (or leaving the field) while editing a task: its new text. */
  renameTask(id: string, text: string): void {
    this.set(renameTask(this.todo, id, text));
  }

  /** The hidden input's text and caret; `editing` while it has the focus. */
  setDraft(text: string, caret: number, editing: boolean): void {
    if (editing && !this.editing && !this.editId) this.reveal('input');
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

  beginDrag(id: string, x: number, y: number): void {
    const a = this.anims.get(`o:${id}`);
    if (!a) return;
    this.dragId = id;
    this.dragX = x;
    this.dragY = y;
    this.dragGrab = y - (LIST_TOP + a.y - this.scroll.L);
    this.dragIndex = this.todo.open.findIndex((t) => t.id === id);
  }

  dragTo(x: number, y: number): void {
    if (!this.dragId) return;
    this.dragX = x;
    this.dragY = y;
  }

  /** Dropped over "Đã xong": finished; elsewhere: moved to its new place. */
  endDrag(): void {
    if (!this.dragId) return;
    const id = this.dragId;
    this.dragId = null;
    const top = this.dragY - this.dragGrab;
    const a = this.anims.get(`o:${id}`);
    if (a) a.y = top - LIST_TOP + this.scroll.L;
    if (this.overDone()) {
      this.complete(id, { x: this.dragX - 120, y: top + CARD_H / 2 });
      return;
    }
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
    writeStored(STORAGE_KEY, this.todo);
  }

  /** About to delete: remember the list as it is, for "Hoàn tác". */
  private keepUndo(text: string): void {
    this.undo = { prev: this.todo, text, until: this.time + UNDO_S };
  }

  private overDone(): boolean {
    return this.dragId !== null && this.dragX > COLS.R.x - 10;
  }

  /** `at`: where the bubbles start (canvas px); null = the task's ring in the list. */
  private complete(id: string, at: { x: number; y: number } | null): void {
    const a = this.anims.get(`o:${id}`);
    const task = this.todo.open.find((t) => t.id === id);
    if (!a || !task) return;
    const top = LIST_TOP + a.y - this.scroll.L;
    if (!at) this.ghosts.push({ task, y: a.y, t: 0, pop: true });
    this.set(completeTask(rollDay(this.todo, Date.now()), id));
    const p = at ?? { x: COLS.L.x + RING_X, y: top + CARD_H / 2 };
    this.onTaskDone?.({ x: p.x, y: p.y, last: this.todo.open.length === 0 });
  }

  /** Scrolls so that the row `key` (left column) is in view. */
  private reveal(key: string): void {
    const row = this.layout('L').find((r) => r.key === key);
    if (!row) return;
    const view = this.listBottom - LIST_TOP;
    let t = this.scrollTarget.L;
    if (row.y < t) t = row.y;
    else if (row.y + row.h > t + view) t = row.y + row.h - view + 8;
    this.scrollTarget.L = this.clampScroll('L', t);
  }

  private clampScroll(c: Col, v: number): number {
    const rows = this.layout(c);
    const last = rows[rows.length - 1];
    const content = last ? last.y + last.h + 8 : 0;
    return Math.max(0, Math.min(v, content - (this.listBottom - LIST_TOP)));
  }

  /** A column's rows and where they belong (content coordinates). */
  private layout(c: Col): Row[] {
    const rows: Row[] = [{ key: `head${c}`, kind: 'head', y: 0, h: HEAD_H }];
    let y = HEAD_H;
    if (c === 'L') {
      const open = this.dragId ? this.todo.open.filter((t) => t.id !== this.dragId) : this.todo.open;
      const gap = this.dragId && !this.overDone() ? this.dragIndex : -1;
      open.forEach((task, i) => {
        // Leave a gap where the dragged card would land.
        if (i === gap) y += CARD_STEP;
        rows.push({ key: `o:${task.id}`, kind: 'task', y, h: CARD_H, task });
        y += CARD_STEP;
      });
      if (gap >= open.length) y += CARD_STEP;
      rows.push({ key: 'input', kind: 'input', y, h: CARD_H });
    } else if (this.todo.done.length === 0) {
      rows.push({ key: 'empty', kind: 'empty', y, h: DONE_H });
    } else {
      for (const task of this.todo.done) {
        rows.push({ key: `d:${task.id}`, kind: 'done', y, h: DONE_H, task });
        y += DONE_STEP;
      }
      // "Xóa hết" under the last one (it can be undone).
      rows.push({ key: 'clear', kind: 'clear', y, h: 44 });
    }
    return rows;
  }

  // ---- Drawing ----

  private draw(dt: number): void {
    const info = this.deps.info();
    const p = info.pomodoro;
    const timerOn = p !== null && p.started;
    this.focusing = p !== null && p.running && !p.onBreak;
    this.listBottom = timerOn ? LIST_BOTTOM : LIST_BOTTOM_FOOTER;
    this.hits = [];

    // The backdrop is the screen's shader (screenBackdrop.ts); here only a veil darkening it
    // for the text, which the glass cards cut through (see glass).
    this.g.clearRect(0, 0, W, H);
    this.g.fillStyle = 'rgba(5,14,22,0.38)';
    this.g.fillRect(0, 0, W, H);
    this.drawStrip(p, timerOn);

    // Dragging: which slot the card is over, and scroll when held near an edge.
    if (this.dragId) {
      const contentY = this.dragY - this.dragGrab - LIST_TOP + this.scroll.L + CARD_H / 2;
      const n = this.todo.open.length;
      this.dragIndex = Math.max(0, Math.min(n - 1, Math.floor((contentY - HEAD_H) / CARD_STEP)));
      if (this.dragY < LIST_TOP + 40) this.scrollTarget.L -= 600 * dt;
      else if (this.dragY > this.listBottom - 40) this.scrollTarget.L += 600 * dt;
    }
    const k = Math.min(1, dt * 14);
    const live = new Set<string>();
    let moving = false;
    for (const c of ['L', 'R'] as const) {
      this.scrollTarget[c] = this.clampScroll(c, this.scrollTarget[c]);
      this.scroll[c] += (this.scrollTarget[c] - this.scroll[c]) * k;
      // Settled (within half a pixel): snap, so the screen can stop redrawing.
      if (Math.abs(this.scrollTarget[c] - this.scroll[c]) > 0.5) moving = true;
      else this.scroll[c] = this.scrollTarget[c];
      const rows = this.layout(c);
      for (const r of rows) {
        live.add(r.key);
        let a = this.anims.get(r.key);
        if (!a) {
          a = { y: r.y, a: 0 };
          this.anims.set(r.key, a);
        }
        a.y += (r.y - a.y) * k;
        a.a = Math.min(1, a.a + dt * 5);
        if (Math.abs(r.y - a.y) > 0.5 || a.a < 1) moving = true;
        else a.y = r.y;
      }
      this.drawColumn(c, rows, dt);
    }
    this.animating = moving || this.ghosts.length > 0;
    for (const key of this.anims.keys()) if (!live.has(key) && key !== `o:${this.dragId}`) this.anims.delete(key);

    if (this.dragId) {
      const task = this.todo.open.find((t) => t.id === this.dragId);
      if (task) {
        // Over "Đã xong" the card follows the pointer across; otherwise it stays in its column.
        const over = this.overDone();
        const x = over ? Math.min(this.dragX - 120, W - 36 - COLS.R.w) : COLS.L.x;
        this.drawTask(task, x, over ? COLS.R.w : COLS.L.w, this.dragY - this.dragGrab, 1, true, false);
      }
    }
    if (!timerOn) this.drawFooter(info);
    if (this.undo && this.time > this.undo.until) this.undo = null;
    if (this.undo) this.drawUndo(this.undo.text);
    this.tex.needsUpdate = true;
  }

  private drawColumn(c: Col, rows: Row[], dt: number): void {
    const g = this.g;
    const col = COLS[c];
    g.save();
    g.beginPath();
    g.rect(col.x - 8, LIST_TOP - 6, col.w + 16, this.listBottom - LIST_TOP + 6);
    g.clip();
    if (c === 'R' && this.dragId && this.overDone()) {
      // A drop zone lights up under the dragged card.
      g.fillStyle = 'rgba(79,209,193,0.12)';
      g.strokeStyle = 'rgba(79,209,193,0.7)';
      g.lineWidth = 2;
      g.setLineDash([10, 8]);
      g.beginPath();
      g.roundRect(col.x, LIST_TOP + HEAD_H - 4, col.w, this.listBottom - LIST_TOP - HEAD_H, 22);
      g.fill();
      g.stroke();
      g.setLineDash([]);
    }
    for (const r of rows) {
      const a = this.anims.get(r.key);
      if (!a) continue;
      const top = LIST_TOP + a.y - this.scroll[c];
      if (top > this.listBottom || top + r.h < LIST_TOP - 6) continue;
      this.drawRow(c, r, top, a.a);
    }
    if (c === 'L') {
      this.ghosts = this.ghosts.filter((gh) => (gh.t += dt / 0.4) < 1);
      for (const gh of this.ghosts) this.drawGhost(gh);
    }
    g.restore();
    this.drawScrollbar(c, rows);
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
      // The backdrop shows through the glass: cut 90 % of the darkening veil (and of anything
      // drawn under the card) inside it, so the colours behind it read brighter.
      g.globalCompositeOperation = 'destination-out';
      g.globalAlpha = alpha * 0.9;
      g.fillRect(x, y, w, h);
      g.globalCompositeOperation = 'source-over';
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
      g.lineWidth = 2.4;
      g.stroke();
    }
    g.restore();
  }

  private drawStrip(p: PomodoroSnapshot | null, timerOn: boolean): void {
    const g = this.g;
    const s = STRIP;
    this.glass(s.x, s.y, s.w, s.h, 28, 1, { tint: 0.07 });
    if (p && timerOn) {
      const color = p.onBreak ? AMBER : TEAL;
      g.font = `700 32px ${UI_FONT}`;
      g.fillStyle = color;
      g.fillText(p.phase.toUpperCase(), 64, 68);
      g.font = `28px ${UI_FONT}`;
      g.globalAlpha = 0.9;
      g.fillText(p.running ? p.dots : vi.dash.paused, 64, 112);
      g.globalAlpha = 1;
      g.font = `300 116px ${UI_FONT}`;
      g.fillStyle = p.running ? '#ffffff' : 'rgba(255,255,255,0.7)';
      g.fillText(p.remaining, 296, 124);
      // Progress along the strip's bottom edge.
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.beginPath();
      g.roundRect(64, 178, 1152, 5, 2.5);
      g.fill();
      g.fillStyle = color;
      g.beginPath();
      g.roundRect(64, 178, Math.max(5, 1152 * Math.min(1, p.progress)), 5, 2.5);
      g.fill();
      this.drawTaskLine(p.onBreak ? vi.dash.next : vi.dash.now, color);
      this.roundButton(BTN.play, 'timer', p.running ? 'pause' : 'play', true);
      this.roundButton(BTN.skip, 'skip', 'skip', false);
      this.roundButton(BTN.stop, 'stop', 'stop', false);
    } else {
      const now = new Date();
      g.font = `200 96px ${UI_FONT}`;
      g.fillStyle = '#ffffff';
      g.fillText(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`, 58, 106);
      g.font = `24px ${UI_FONT}`;
      g.fillStyle = DIM;
      g.fillText(`${vi.dash.days[now.getDay()]}, ${now.getDate()}/${now.getMonth() + 1}`, 64, 140);
      // "Bắt đầu tập trung".
      const b = START;
      const hov = this.hover === 'timer';
      this.glass(b.x, b.y, b.w, b.h, b.h / 2, 1, { tint: hov ? 0.2 : 0.12, glow: hov ? TEAL : undefined });
      g.fillStyle = TEAL;
      drawIcon(g, 'play', b.x + 46, b.y + b.h / 2, 15);
      g.font = `600 30px ${UI_FONT}`;
      g.fillStyle = '#ffffff';
      g.fillText(vi.dash.start, b.x + 78, b.y + b.h / 2 + 10);
      this.hits.push({ x: b.x, y: b.y, w: b.w, h: b.h, hit: { kind: 'timer' } });
      this.drawTaskLine(vi.dash.next, TEAL);
    }
    this.volumeRow('alert', '🔔', this.deps.chimeOn(), this.deps.alertVolume());
    this.volumeRow('master', '🌊', this.deps.ambienceOn(), this.deps.masterVolume());
  }

  /** The strip's second line: "Đang làm · <the top task>" across the whole strip. */
  private drawTaskLine(label: string, color: string): void {
    const task = this.todo.open[0];
    if (!task) return;
    const g = this.g;
    g.font = `600 26px ${UI_FONT}`;
    g.fillStyle = color;
    const head = `${label.toUpperCase()}  `;
    g.fillText(head, 64, 164);
    const x = 64 + g.measureText(head).width;
    g.font = `30px ${UI_FONT}`;
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.fillText(ellipsize(g, task.text, STRIP.x + STRIP.w - 28 - x), x, 165);
  }

  /** "Đã xóa … · Hoàn tác" at the bottom, over the lists, for UNDO_S seconds. */
  private drawUndo(text: string): void {
    const g = this.g;
    g.save();
    g.font = `26px ${UI_FONT}`;
    const label = ellipsize(g, text, 620);
    const lw = g.measureText(label).width;
    g.font = `700 26px ${UI_FONT}`;
    const uw = g.measureText(vi.dash.undo).width;
    const w = lw + uw + 88;
    const h = 56;
    const x = (W - w) / 2;
    const y = H - h - 14;
    const hov = this.hover === 'undo';
    this.glass(x, y, w, h, h / 2, 1, { tint: hov ? 0.24 : 0.16, lift: 1 });
    g.fillStyle = '#ffffff';
    g.font = `26px ${UI_FONT}`;
    g.fillText(label, x + 28, y + 37);
    g.fillStyle = TEAL;
    g.font = `700 26px ${UI_FONT}`;
    g.fillText(vi.dash.undo, x + 60 + lw, y + 37);
    g.restore();
    this.hits.push({ x, y, w, h, hit: { kind: 'undo' } });
  }

  /** A round icon (click: on/off) and a slider (click or drag: volume). */
  private volumeRow(id: DashSlider, emoji: string, on: boolean, value: number): void {
    const g = this.g;
    const v = VOL[id];
    const kind = id === 'alert' ? 'chime' : 'ambience';
    const r = 22;
    const hovIcon = this.hover === kind;
    this.glass(v.icon - r, v.y - r, r * 2, r * 2, r, 1, { tint: hovIcon ? 0.22 : 0.06 });
    g.save();
    g.globalAlpha = on ? 1 : 0.35;
    g.font = `24px ${EMOJI_FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(emoji, v.icon, v.y + 1);
    g.restore();
    if (!on) {
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.lineWidth = 3;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(v.icon - 12, v.y + 12);
      g.lineTo(v.icon + 12, v.y - 12);
      g.stroke();
    }
    this.hits.push({ x: v.icon - r, y: v.y - r, w: r * 2, h: r * 2, hit: { kind } });
    // The track, its filled part and the knob.
    const hov = this.hover === `slider:${id}`;
    const x = v.x0 + (v.x1 - v.x0) * value;
    g.fillStyle = 'rgba(255,255,255,0.16)';
    g.beginPath();
    g.roundRect(v.x0, v.y - 4, v.x1 - v.x0, 8, 4);
    g.fill();
    g.fillStyle = on ? TEAL : 'rgba(255,255,255,0.4)';
    g.beginPath();
    g.roundRect(v.x0, v.y - 4, Math.max(8, x - v.x0), 8, 4);
    g.fill();
    g.beginPath();
    g.arc(x, v.y, hov ? 13 : 11, 0, Math.PI * 2);
    g.fillStyle = '#ffffff';
    g.fill();
    this.hits.push({ x: v.x0 - 14, y: v.y - 20, w: v.x1 - v.x0 + 28, h: 40, hit: { kind: 'slider', id } });
  }

  private roundButton(b: { x: number; y: number; r: number }, kind: 'timer' | 'skip' | 'stop', icon: 'play' | 'pause' | 'skip' | 'stop', primary: boolean): void {
    const g = this.g;
    const hov = this.hover === kind;
    this.glass(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2, b.r, 1, { tint: hov ? 0.24 : primary ? 0.14 : 0.08, glow: hov ? (kind === 'stop' ? '#ff9a9a' : TEAL) : undefined });
    g.fillStyle = '#ffffff';
    drawIcon(g, icon, b.x, b.y, b.r * 0.42);
    this.hits.push({ x: b.x - b.r, y: b.y - b.r, w: b.r * 2, h: b.r * 2, hit: { kind } });
  }

  private drawRow(c: Col, r: Row, top: number, alpha: number): void {
    const g = this.g;
    const col = COLS[c];
    switch (r.kind) {
      case 'head': {
        g.globalAlpha = alpha;
        g.font = `700 28px ${UI_FONT}`;
        g.fillStyle = c === 'L' ? '#ffffff' : DIM;
        const title = c === 'L' ? vi.dash.todo.toUpperCase() : vi.dash.doneToday.toUpperCase();
        const count = c === 'L' ? this.todo.open.length : this.todo.done.length;
        g.fillText(`${title} · ${count}`, col.x + 8, top + 36);
        g.font = `24px ${EMOJI_FONT}`;
        g.textAlign = 'right';
        g.fillStyle = DIM;
        g.fillText(c === 'L' ? vi.dash.hint : `🍅 ${this.todo.pomosToday}`, col.x + col.w - 8, top + 35);
        g.textAlign = 'left';
        g.globalAlpha = 1;
        break;
      }
      case 'task':
        if (r.task) this.drawTask(r.task, col.x, col.w, top, alpha, false, this.todo.open[0]?.id === r.task.id);
        break;
      case 'input':
        this.drawInput(top, alpha);
        break;
      case 'done':
        if (r.task) this.drawDone(r.task, top, alpha);
        break;
      case 'clear': {
        g.globalAlpha = alpha;
        g.font = `600 24px ${UI_FONT}`;
        g.textAlign = 'right';
        const hov = this.hover === 'clearDone';
        g.fillStyle = hov ? '#ff9a9a' : DIM;
        const x = col.x + col.w - 12;
        g.fillText(vi.dash.clearDone, x, top + 30);
        const w = g.measureText(vi.dash.clearDone).width;
        if (hov) g.fillRect(x - w, top + 35, w, 2);
        g.textAlign = 'left';
        g.globalAlpha = 1;
        this.pushListHit(x - w - 12, top, w + 24, 44, { kind: 'clearDone' });
        break;
      }
      case 'empty':
        g.globalAlpha = alpha;
        g.font = `28px ${UI_FONT}`;
        g.fillStyle = 'rgba(214,232,238,0.45)';
        g.fillText(vi.dash.noneDone, col.x + 12, top + 42);
        g.globalAlpha = 1;
        break;
    }
  }

  /**
   * `first`: the top task, the one being worked on (it glows, collects the 🍅 and always shows
   * its ▶, or ⏸ while a focus session runs). Other tasks show ▶ on hover.
   */
  private drawTask(task: Task, x: number, w: number, top: number, alpha: number, lifted: boolean, first: boolean): void {
    const g = this.g;
    const hovCard = this.hover === `card:${task.id}`;
    const hovRing = this.hover === `ring:${task.id}`;
    const hovDel = this.hover === `delete:${task.id}`;
    const hovPlay = this.hover === `play:${task.id}`;
    const hovAny = hovCard || hovRing || hovDel || hovPlay || lifted;
    const editing = this.editId === task.id && this.editing;
    const running = first && this.focusing;
    this.glass(x, top, w, CARD_H, 24, alpha, {
      tint: editing ? 0.16 : hovAny ? 0.14 : first ? 0.11 : 0.08,
      glow: editing ? 'rgba(255,255,255,0.6)' : first && !lifted ? 'rgba(79,209,193,0.9)' : undefined,
      lift: lifted ? 1 : 0,
    });
    const cy = top + CARD_H / 2;
    g.save();
    g.globalAlpha = alpha;
    // The ring: click it when the task is done.
    g.beginPath();
    g.arc(x + RING_X, cy, 20, 0, Math.PI * 2);
    if (hovRing) {
      g.fillStyle = 'rgba(79,209,193,0.35)';
      g.fill();
    }
    g.strokeStyle = hovRing || first ? TEAL : 'rgba(255,255,255,0.78)';
    g.lineWidth = 3;
    g.stroke();
    if (hovRing) {
      g.strokeStyle = '#ffffff';
      drawCheck(g, x + RING_X, cy, 9);
    }
    if (editing) {
      g.restore();
      this.drawDraft(x + TEXT_X, cy, w - TEXT_X - 22, vi.dash.editHint);
      this.pushListHit(x, top, w, CARD_H, { kind: 'card', id: task.id });
      return;
    }
    // Right side: ✕ on hover, ▶ / ⏸, then the tomatoes.
    let right = x + w - 22;
    if (hovAny && !lifted) {
      g.strokeStyle = hovDel ? '#ff9a9a' : 'rgba(255,255,255,0.55)';
      g.lineWidth = 3;
      g.lineCap = 'round';
      const dx = right - 10;
      g.beginPath();
      g.moveTo(dx - 9, cy - 9);
      g.lineTo(dx + 9, cy + 9);
      g.moveTo(dx + 9, cy - 9);
      g.lineTo(dx - 9, cy + 9);
      g.stroke();
    }
    // The ✕ slot is kept even when ✕ is hidden, so ▶ doesn't jump when the pointer comes in.
    if (!lifted) right -= 46;
    const showPlay = (first || hovAny) && !lifted;
    const playX = right - PLAY_R;
    if (showPlay) {
      g.beginPath();
      g.arc(playX, cy, PLAY_R, 0, Math.PI * 2);
      g.fillStyle = running ? TEAL : hovPlay ? 'rgba(79,209,193,0.45)' : 'rgba(255,255,255,0.14)';
      g.fill();
      g.fillStyle = running ? '#06302b' : '#ffffff';
      drawIcon(g, running ? 'pause' : 'play', playX + (running ? 0 : 2), cy, 10);
      right -= PLAY_R * 2 + 16;
    }
    // 🍅: sessions done, "2/4" with an estimate (amber once past it), a faint "🍅+" on hover to
    // set one. Clicking it counts the estimate up.
    const est = task.est ?? 0;
    const hovEst = this.hover === `estimate:${task.id}`;
    const tom = est > 0 ? `🍅 ${task.pomos}/${est}` : task.pomos > 0 ? (task.pomos > 3 ? `🍅×${task.pomos}` : '🍅'.repeat(task.pomos)) : hovAny && !lifted ? '🍅+' : '';
    let estHit: { x: number; w: number } | null = null;
    if (tom) {
      g.textAlign = 'right';
      g.font = `28px ${EMOJI_FONT}`;
      g.globalAlpha = alpha * (est === 0 && task.pomos === 0 && !hovEst ? 0.45 : 1);
      g.fillStyle = est > 0 && task.pomos > est ? AMBER : hovEst ? TEAL : '#ffffff';
      g.fillText(tom, right, cy + 10);
      const tw = g.measureText(tom).width;
      estHit = { x: right - tw - 8, w: tw + 16 };
      right -= tw + 14;
      g.textAlign = 'left';
      g.globalAlpha = alpha;
    }
    g.font = `${first ? 600 : 400} ${TASK_FONT}px ${UI_FONT}`;
    g.fillStyle = '#ffffff';
    g.fillText(ellipsize(g, task.text, right - (x + TEXT_X)), x + TEXT_X, cy + 14);
    g.restore();
    if (!lifted) {
      this.pushListHit(x, top, w, CARD_H, { kind: 'card', id: task.id });
      this.pushListHit(x + 8, top, TEXT_X - 8, CARD_H, { kind: 'ring', id: task.id });
      // ▶ is there to press only where it shows (always on the top task).
      if (showPlay) this.pushListHit(playX - PLAY_R - 6, top, PLAY_R * 2 + 12, CARD_H, { kind: 'play', id: task.id });
      if (estHit) this.pushListHit(estHit.x, top, estHit.w, CARD_H, { kind: 'estimate', id: task.id });
      if (hovAny) this.pushListHit(x + w - 70, top, 70, CARD_H, { kind: 'delete', id: task.id });
    }
  }

  private drawInput(top: number, alpha: number): void {
    const g = this.g;
    const { x, w } = COLS.L;
    const hov = this.hover === 'input';
    // Typing a new task (not editing one).
    const typing = this.editing && !this.editId;
    this.glass(x, top, w, CARD_H, 24, alpha, { tint: typing ? 0.12 : hov ? 0.08 : 0.03, dashed: !typing, glow: typing ? 'rgba(255,255,255,0.5)' : undefined });
    const cy = top + CARD_H / 2;
    g.save();
    g.globalAlpha = alpha;
    g.strokeStyle = typing ? TEAL : 'rgba(255,255,255,0.7)';
    g.lineWidth = 3.4;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x + RING_X - 12, cy);
    g.lineTo(x + RING_X + 12, cy);
    g.moveTo(x + RING_X, cy - 12);
    g.lineTo(x + RING_X, cy + 12);
    g.stroke();
    const tx = x + TEXT_X;
    if (typing) {
      g.restore();
      this.drawDraft(tx, cy, w - TEXT_X - 22, vi.dash.addHint);
    } else {
      g.font = `${TASK_FONT}px ${UI_FONT}`;
      g.fillStyle = hov ? 'rgba(255,255,255,0.88)' : DIM;
      g.fillText(vi.dash.add, tx, cy + 14);
      g.restore();
    }
    this.pushListHit(x, top, w, CARD_H, { kind: 'input' });
  }

  /** The text being typed with its caret, from `tx` across `w` px, and a key hint on the right. */
  private drawDraft(tx: number, cy: number, w: number, hint: string): void {
    const g = this.g;
    g.save();
    g.font = `22px ${UI_FONT}`;
    g.fillStyle = DIM;
    g.textAlign = 'right';
    g.fillText(hint, tx + w, cy + 8);
    const hintW = g.measureText(hint).width;
    g.textAlign = 'left';
    g.font = `${TASK_FONT}px ${UI_FONT}`;
    const maxW = w - hintW - 28;
    // Keep the caret in view: show the end of a long draft.
    let start = 0;
    while (start < this.caret && g.measureText(this.draft.slice(start, this.caret)).width > maxW) start++;
    const shown = ellipsize(g, this.draft.slice(start), maxW);
    g.fillStyle = '#ffffff';
    g.fillText(shown, tx, cy + 14);
    if (this.caretTime % 1 < 0.6) {
      const cx = tx + g.measureText(this.draft.slice(start, this.caret)).width + 1;
      g.fillStyle = TEAL;
      g.fillRect(cx, cy - 23, 3, 46);
    }
    g.restore();
  }

  private drawDone(task: Task, top: number, alpha: number): void {
    const g = this.g;
    const { x, w } = COLS.R;
    const hovRemove = this.hover === `remove:${task.id}`;
    const hov = this.hover === `restore:${task.id}` || hovRemove;
    this.glass(x, top, w, DONE_H, 20, alpha * 0.8, { tint: hov ? 0.12 : 0.05 });
    const cy = top + DONE_H / 2;
    g.save();
    g.globalAlpha = alpha * (hov ? 1 : 0.85);
    g.beginPath();
    g.arc(x + 34, cy, 17, 0, Math.PI * 2);
    g.fillStyle = hov ? 'rgba(255,255,255,0.25)' : 'rgba(79,209,193,0.8)';
    g.fill();
    g.strokeStyle = '#ffffff';
    if (hov) drawRestore(g, x + 34, cy, 8);
    else drawCheck(g, x + 34, cy, 7.5);
    let right = x + w - 18;
    // ✕ on hover: delete it from the list (a click elsewhere on the row puts it back to do).
    if (hov) {
      g.strokeStyle = hovRemove ? '#ff9a9a' : 'rgba(255,255,255,0.55)';
      g.lineWidth = 3;
      g.lineCap = 'round';
      const dx = right - 9;
      g.beginPath();
      g.moveTo(dx - 8, cy - 8);
      g.lineTo(dx + 8, cy + 8);
      g.moveTo(dx + 8, cy - 8);
      g.lineTo(dx - 8, cy + 8);
      g.stroke();
      right -= 40;
    }
    if (task.pomos > 0) {
      g.font = `24px ${EMOJI_FONT}`;
      g.textAlign = 'right';
      g.fillStyle = '#ffffff';
      const t = task.est ? `🍅${task.pomos}/${task.est}` : `🍅${task.pomos}`;
      g.fillText(t, right, cy + 8);
      right -= g.measureText(t).width + 12;
      g.textAlign = 'left';
    }
    g.font = `${DONE_FONT}px ${UI_FONT}`;
    g.fillStyle = 'rgba(230,240,244,0.78)';
    const text = ellipsize(g, task.text, right - (x + 62));
    g.fillText(text, x + 62, cy + 12);
    const tw = g.measureText(text).width;
    g.fillStyle = 'rgba(230,240,244,0.55)';
    g.fillRect(x + 62, cy, tw, 2);
    g.restore();
    this.pushListHit(x, top, w, DONE_H, { kind: 'restore', id: task.id });
    if (hov) this.pushListHit(x + w - 60, top, 60, DONE_H, { kind: 'remove', id: task.id });
  }

  /** A finished card swells a little and fades as its bubbles fly out; a deleted one just fades. */
  private drawGhost(gh: Ghost): void {
    const g = this.g;
    const { x, w } = COLS.L;
    const top = LIST_TOP + gh.y - this.scroll.L;
    const cy = top + CARD_H / 2;
    const e = gh.t;
    const s = gh.pop ? 1 + 0.06 * Math.sin(Math.min(1, e * 1.6) * Math.PI) : 1 - 0.04 * e;
    g.save();
    g.translate(x + w / 2, cy);
    g.scale(s, s);
    g.translate(-(x + w / 2), -cy);
    const alpha = (1 - e) * (1 - e);
    this.glass(x, top, w, CARD_H, 24, alpha, { tint: gh.pop ? 0.2 * (1 - e) + 0.08 : 0.08 });
    g.globalAlpha = alpha;
    g.font = `${TASK_FONT}px ${UI_FONT}`;
    g.fillStyle = '#ffffff';
    g.fillText(ellipsize(g, gh.task.text, w - 140), x + TEXT_X, cy + 14);
    if (gh.pop) {
      g.beginPath();
      g.arc(x + RING_X, cy, 20, 0, Math.PI * 2);
      g.fillStyle = TEAL;
      g.fill();
      g.strokeStyle = '#ffffff';
      drawCheck(g, x + RING_X, cy, 9);
    }
    g.restore();
  }

  private drawScrollbar(c: Col, rows: Row[]): void {
    const last = rows[rows.length - 1];
    const content = last.y + last.h + 8;
    const view = this.listBottom - LIST_TOP;
    if (content <= view + 1) return;
    const g = this.g;
    const h = Math.max(40, (view * view) / content);
    const y = LIST_TOP + ((view - h) * this.scroll[c]) / (content - view);
    g.fillStyle = 'rgba(255,255,255,0.28)';
    g.beginPath();
    g.roundRect(COLS[c].x + COLS[c].w + 3, y, 5, h, 2.5);
    g.fill();
  }

  private drawFooter(info: ScreenInfo): void {
    const g = this.g;
    g.font = `22px ${UI_FONT}`;
    g.fillStyle = DIM;
    const line = `♪  ${info.playing}   ·   ${info.scene || '—'}   ·   ${vi.dash.island} ${info.islandTime}`;
    g.fillText(ellipsize(g, line, STRIP.w - 16), STRIP.x + 8, H - 20);
  }

  /** A clickable area inside a list (cut to the list's visible part). */
  private pushListHit(x: number, y: number, w: number, h: number, hit: DashHit): void {
    const y0 = Math.max(y, LIST_TOP);
    const y1 = Math.min(y + h, this.listBottom);
    if (y1 > y0) this.hits.push({ x, y: y0, w, h: y1 - y0, hit });
  }
}

function hitKey(hit: DashHit): string {
  return 'id' in hit ? `${hit.kind}:${hit.id}` : hit.kind;
}

function drawIcon(g: CanvasRenderingContext2D, icon: 'play' | 'pause' | 'skip' | 'stop', x: number, y: number, s: number): void {
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
  } else if (icon === 'stop') {
    g.roundRect(x - s * 0.8, y - s * 0.8, s * 1.6, s * 1.6, 3);
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
  g.lineWidth = Math.max(2.4, s * 0.38);
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
  g.lineWidth = 2.4;
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
