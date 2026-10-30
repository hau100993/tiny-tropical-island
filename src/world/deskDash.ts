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
  /** Tomatoes in the wallet. */
  tomatoes: number;
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

/** The two volume knobs: notifications (🔔) and the island's sound (🌊). */
export type DashKnob = 'alert' | 'master';

/** Something on the screen that reacts to a click. */
export type DashHit =
  | { kind: 'ring' | 'card' | 'delete' | 'restore' | 'play' | 'remove' | 'estimate'; id: string }
  | { kind: 'knob'; id: DashKnob }
  | { kind: 'input' | 'timer' | 'skip' | 'stop' | 'undo' | 'clearDone' | 'doneToggle' };

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
// The strip: one timer row (phase, countdown, buttons, two volume knobs), the progress under it.
const STRIP = { x: 36, y: 16, w: 1208, h: 132 };
const LIST_TOP = 166;
/** "Đã xóa … · Hoàn tác" stays this long (s). */
const UNDO_S = 6;
const LIST_BOTTOM = H - 12;
/** With the footer line (what is playing, scene, island time) shown. */
const LIST_BOTTOM_FOOTER = H - 54;
/** One list across the screen: what to do, then "Đã xong hôm nay" folded into one line. */
const LIST = { x: 36, w: 1208 };
const HEAD_H = 56;
const CARD_H = 88;
const CARD_STEP = CARD_H + 12;
/** The current task's second line (its name in full, on up to two lines). */
const TASK_LINE = 46;
/** Right part of the current task's card kept for ✕, ▶ and 🍅, so its name wraps the same always. */
const FIRST_RESERVE = 290;
const DONE_H = 72;
const DONE_STEP = DONE_H + 10;
const DONE_HEAD_H = 60;
const RING_X = 46;
/** Where a card's text starts (after the ring). */
const TEXT_X = 90;
const TASK_FONT = 40;
const DONE_FONT = 33;
/** A task's ▶ / ⏸ (radius, canvas px). */
const PLAY_R = 24;
const BTN = {
  play: { x: 650, y: 82, r: 38 },
  skip: { x: 738, y: 82, r: 31 },
  stop: { x: 812, y: 82, r: 31 },
} as const;
const START = { x: 330, y: 50, w: 370, h: 64 };
/** The volume knobs: round buttons with an arc for the level (click: on/off; drag up/down or wheel: level). */
const KNOB: Record<DashKnob, { x: number; y: number }> = {
  alert: { x: 1088, y: 82 },
  master: { x: 1184, y: 82 },
};
const KNOB_R = 36;
/** The level arc: from lower left (135°) clockwise round to lower right, 270° in all. */
const KNOB_START = Math.PI * 0.75;
const KNOB_SWEEP = Math.PI * 1.5;

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

type RowKind = 'head' | 'task' | 'input' | 'doneHead' | 'done' | 'clear';

interface Row {
  key: string;
  kind: RowKind;
  /** Target top, in the list's content coordinates (0 = top of the list). */
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
  h: number;
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
 * knobs for the notification and soundscape volumes), then one list of "liquid glass" cards over
 * drifting colour blobs: what to do ("Đang làm"; the top task, the one being worked on, is bigger
 * and shows its name in full), then today's finished tasks folded into one line that opens them.
 * Everything is drawn on one canvas (the same picture close up, from afar
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
  private scroll = 0;
  private scrollTarget = 0;
  private listBottom = LIST_BOTTOM;
  /** "Đã xong hôm nay" opened under the list. */
  private showDone = false;
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
  /** Pointer height on the canvas (cards only move up and down), and where in the card it grabbed. */
  private dragY = 0;
  private dragGrab = 0;
  private dragIndex = 0;
  /** A task was finished (its ring clicked). */
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

  /** 🍅 the list remembers (tasks still listed, or today's count if more): the starting gift. */
  get pomodoroHistory(): number {
    const listed = [...this.todo.open, ...this.todo.done].reduce((n, t) => n + t.pomos, 0);
    return Math.max(listed, this.todo.pomosToday);
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

  /** The pointer is over the list (the wheel scrolls it there). */
  inList(x: number, y: number): boolean {
    return y >= LIST_TOP && y <= this.listBottom && x >= LIST.x && x <= LIST.x + LIST.w;
  }

  setHover(hit: DashHit | null): void {
    const hover = hit ? hitKey(hit) : '';
    if (hover === this.hover) return;
    this.hover = hover;
    this.drawTimer = 0;
  }

  scrollBy(x: number, y: number, dy: number): void {
    if (this.inList(x, y)) this.scrollTarget = this.clampScroll(this.scrollTarget + dy * 0.6);
  }

  /** A knob's level (0..1). */
  volume(id: DashKnob): number {
    return id === 'alert' ? this.deps.alertVolume() : this.deps.masterVolume();
  }

  /** Sets a knob's level (a drag on it). */
  setVolume(id: DashKnob, value: number): void {
    const v = Math.min(1, Math.max(0, value));
    if (id === 'alert') this.deps.setAlertVolume(v);
    else this.deps.setMasterVolume(v);
    this.drawTimer = 0;
  }

  /** The wheel over a knob: ±5 % a notch. */
  nudge(id: DashKnob, dir: number): void {
    this.setVolume(id, Math.round((this.volume(id) + dir * 0.05) * 20) / 20);
  }

  /** A click (press and release without dragging) on `hit`. */
  activate(hit: DashHit): void {
    switch (hit.kind) {
      case 'ring':
        this.complete(hit.id);
        break;
      case 'delete': {
        const a = this.anims.get(`o:${hit.id}`);
        const task = this.todo.open.find((t) => t.id === hit.id);
        if (a && task) this.ghosts.push({ task, y: a.y, h: this.taskHeight(task), t: 0, pop: false });
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
      case 'knob':
        if (hit.id === 'alert') this.deps.toggleChime();
        else this.deps.toggleAmbience();
        break;
      case 'doneToggle':
        this.showDone = !this.showDone;
        // Opened: scroll down to show it.
        if (this.showDone) this.reveal('clear');
        break;
      case 'card':
      case 'input':
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

  beginDrag(id: string, y: number): void {
    const a = this.anims.get(`o:${id}`);
    if (!a) return;
    this.dragId = id;
    this.dragY = y;
    this.dragGrab = y - (LIST_TOP + a.y - this.scroll);
    this.dragIndex = this.todo.open.findIndex((t) => t.id === id);
  }

  dragTo(y: number): void {
    if (!this.dragId) return;
    this.dragY = y;
  }

  /** Dropped: the card moves to its new place in the list. */
  endDrag(): void {
    if (!this.dragId) return;
    const id = this.dragId;
    this.dragId = null;
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
    writeStored(STORAGE_KEY, this.todo);
  }

  /** About to delete: remember the list as it is, for "Hoàn tác". */
  private keepUndo(text: string): void {
    this.undo = { prev: this.todo, text, until: this.time + UNDO_S };
  }

  /** Clicked ring: the card pops and its bubbles start from the ring. */
  private complete(id: string): void {
    const a = this.anims.get(`o:${id}`);
    const task = this.todo.open.find((t) => t.id === id);
    if (!a || !task) return;
    const h = this.taskHeight(task);
    const top = LIST_TOP + a.y - this.scroll;
    this.ghosts.push({ task, y: a.y, h, t: 0, pop: true });
    this.set(completeTask(rollDay(this.todo, Date.now()), id));
    this.onTaskDone?.({ x: LIST.x + RING_X, y: top + h / 2, last: this.todo.open.length === 0 });
  }

  /** Scrolls so that the row `key` is in view. */
  private reveal(key: string): void {
    const row = this.layout().find((r) => r.key === key);
    if (!row) return;
    const view = this.listBottom - LIST_TOP;
    let t = this.scrollTarget;
    if (row.y < t) t = row.y;
    else if (row.y + row.h > t + view) t = row.y + row.h - view + 8;
    this.scrollTarget = this.clampScroll(t);
  }

  private clampScroll(v: number): number {
    const rows = this.layout();
    const last = rows[rows.length - 1];
    const content = last ? last.y + last.h + 8 : 0;
    return Math.max(0, Math.min(v, content - (this.listBottom - LIST_TOP)));
  }

  /** The current (top) task's name, wrapped on up to two lines in its card. */
  private firstLines(task: Task): string[] {
    this.g.font = `600 ${TASK_FONT}px ${UI_FONT}`;
    return wrapLines(this.g, task.text, LIST.w - TEXT_X - FIRST_RESERVE, 2);
  }

  /** A card's height: the current task grows a line for a long name. */
  private taskHeight(task: Task): number {
    return task.id === this.todo.open[0]?.id && this.firstLines(task).length > 1 ? CARD_H + TASK_LINE : CARD_H;
  }

  /** The rows and where they belong (content coordinates). */
  private layout(): Row[] {
    const rows: Row[] = [{ key: 'head', kind: 'head', y: 0, h: HEAD_H }];
    let y = HEAD_H;
    const open = this.dragId ? this.todo.open.filter((t) => t.id !== this.dragId) : this.todo.open;
    const gap = this.dragId ? this.dragIndex : -1;
    open.forEach((task, i) => {
      // Leave a gap where the dragged card would land.
      if (i === gap) y += CARD_STEP;
      const h = this.taskHeight(task);
      rows.push({ key: `o:${task.id}`, kind: 'task', y, h, task });
      y += h + CARD_STEP - CARD_H;
    });
    if (gap >= open.length) y += CARD_STEP;
    rows.push({ key: 'input', kind: 'input', y, h: CARD_H });
    y += CARD_STEP;
    if (this.todo.done.length === 0) return rows;
    // "Đã xong hôm nay · 3 ▸": one line; open, today's finished tasks follow it.
    rows.push({ key: 'doneHead', kind: 'doneHead', y, h: DONE_HEAD_H });
    y += DONE_HEAD_H + 6;
    if (!this.showDone) return rows;
    for (const task of this.todo.done) {
      rows.push({ key: `d:${task.id}`, kind: 'done', y, h: DONE_H, task });
      y += DONE_STEP;
    }
    // "Xóa hết" under the last one (it can be undone).
    rows.push({ key: 'clear', kind: 'clear', y, h: 44 });
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
    this.drawStrip(info, timerOn);

    // Dragging: which slot the card is over, and scroll when held near an edge.
    if (this.dragId) {
      const contentY = this.dragY - this.dragGrab - LIST_TOP + this.scroll + CARD_H / 2;
      const n = this.todo.open.length;
      this.dragIndex = Math.max(0, Math.min(n - 1, Math.floor((contentY - HEAD_H) / CARD_STEP)));
      if (this.dragY < LIST_TOP + 40) this.scrollTarget -= 600 * dt;
      else if (this.dragY > this.listBottom - 40) this.scrollTarget += 600 * dt;
    }
    const k = Math.min(1, dt * 14);
    const live = new Set<string>();
    let moving = false;
    this.scrollTarget = this.clampScroll(this.scrollTarget);
    this.scroll += (this.scrollTarget - this.scroll) * k;
    // Settled (within half a pixel): snap, so the screen can stop redrawing.
    if (Math.abs(this.scrollTarget - this.scroll) > 0.5) moving = true;
    else this.scroll = this.scrollTarget;
    const rows = this.layout();
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
    this.drawList(rows, dt);
    this.animating = moving || this.ghosts.length > 0;
    for (const key of this.anims.keys()) if (!live.has(key) && key !== `o:${this.dragId}`) this.anims.delete(key);

    if (this.dragId) {
      const task = this.todo.open.find((t) => t.id === this.dragId);
      if (task) this.drawTask(task, LIST.x, LIST.w, this.dragY - this.dragGrab, 1, true, false);
    }
    if (!timerOn) this.drawFooter(info);
    if (this.undo && this.time > this.undo.until) this.undo = null;
    if (this.undo) this.drawUndo(this.undo.text);
    this.tex.needsUpdate = true;
  }

  private drawList(rows: Row[], dt: number): void {
    const g = this.g;
    g.save();
    g.beginPath();
    g.rect(LIST.x - 8, LIST_TOP - 6, LIST.w + 16, this.listBottom - LIST_TOP + 6);
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

  private drawStrip(info: ScreenInfo, timerOn: boolean): void {
    const g = this.g;
    const p = info.pomodoro;
    const s = STRIP;
    this.glass(s.x, s.y, s.w, s.h, 28, 1, { tint: 0.07 });
    if (p && timerOn) {
      const color = p.onBreak ? AMBER : TEAL;
      g.font = `700 30px ${UI_FONT}`;
      g.fillStyle = color;
      g.fillText(p.phase.toUpperCase(), 64, 70);
      g.font = `26px ${UI_FONT}`;
      g.globalAlpha = 0.9;
      const sub = p.running ? p.dots : vi.dash.paused;
      g.fillText(sub, 64, 110);
      g.globalAlpha = 1;
      // Left of the big countdown (x 296); with many session dots it stays out.
      this.drawWallet(64 + g.measureText(sub).width + (sub ? 20 : 0), 110, info.tomatoes, 286);
      g.font = `300 104px ${UI_FONT}`;
      g.fillStyle = p.running ? '#ffffff' : 'rgba(255,255,255,0.7)';
      g.fillText(p.remaining, 296, 118);
      // Progress along the strip's bottom edge.
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.beginPath();
      g.roundRect(64, 134, 1152, 5, 2.5);
      g.fill();
      g.fillStyle = color;
      g.beginPath();
      g.roundRect(64, 134, Math.max(5, 1152 * Math.min(1, p.progress)), 5, 2.5);
      g.fill();
      this.roundButton(BTN.play, 'timer', p.running ? 'pause' : 'play', true);
      this.roundButton(BTN.skip, 'skip', 'skip', false);
      this.roundButton(BTN.stop, 'stop', 'stop', false);
    } else {
      const now = new Date();
      g.font = `200 88px ${UI_FONT}`;
      g.fillStyle = '#ffffff';
      g.fillText(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`, 58, 98);
      g.font = `24px ${UI_FONT}`;
      g.fillStyle = DIM;
      const date = `${vi.dash.days[now.getDay()]}, ${now.getDate()}/${now.getMonth() + 1}`;
      g.fillText(date, 64, 132);
      this.drawWallet(64 + g.measureText(date).width + 20, 132, info.tomatoes, START.x + START.w);
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
    }
    this.knob('alert', '🔔', this.deps.chimeOn());
    this.knob('master', '🌊', this.deps.ambienceOn());
  }

  /** "Kho 🍅 12" on the strip from `x` (baseline `y`); left out if it would pass `maxX`. */
  private drawWallet(x: number, y: number, count: number, maxX: number): void {
    const g = this.g;
    const label = `${vi.pets.wallet} `;
    const num = String(count);
    g.font = `24px ${UI_FONT}`;
    const labelW = g.measureText(label).width;
    g.font = `22px ${EMOJI_FONT}`;
    const emojiW = g.measureText('🍅').width + 6;
    g.font = `600 24px ${UI_FONT}`;
    if (x + labelW + emojiW + g.measureText(num).width > maxX) return;
    g.fillStyle = '#ffffff';
    g.fillText(num, x + labelW + emojiW, y);
    g.font = `22px ${EMOJI_FONT}`;
    g.fillText('🍅', x + labelW, y);
    g.font = `24px ${UI_FONT}`;
    g.fillStyle = DIM;
    g.fillText(label, x, y);
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

  /**
   * A volume knob: a round glass button with the level as a 270° arc round it (dial-style, open
   * at the bottom), and a dot at the arc's end. Off: the emoji fades and is struck through.
   * Pointed at (or being turned), the emoji gives way to the level in %.
   */
  private knob(id: DashKnob, emoji: string, on: boolean): void {
    const g = this.g;
    const { x, y } = KNOB[id];
    const value = this.volume(id);
    const hov = this.hover === `knob:${id}`;
    this.glass(x - KNOB_R, y - KNOB_R, KNOB_R * 2, KNOB_R * 2, KNOB_R, 1, { tint: hov ? 0.2 : 0.07 });
    const r = KNOB_R - 8;
    const end = KNOB_START + KNOB_SWEEP * value;
    g.save();
    g.lineWidth = 5;
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(255,255,255,0.16)';
    g.beginPath();
    g.arc(x, y, r, KNOB_START, KNOB_START + KNOB_SWEEP);
    g.stroke();
    const color = on ? TEAL : 'rgba(255,255,255,0.45)';
    if (value > 0.005) {
      g.strokeStyle = color;
      g.beginPath();
      g.arc(x, y, r, KNOB_START, end);
      g.stroke();
    }
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(x + Math.cos(end) * r, y + Math.sin(end) * r, 5, 0, Math.PI * 2);
    g.fill();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (hov) {
      g.font = `600 22px ${UI_FONT}`;
      g.fillStyle = on ? '#ffffff' : DIM;
      g.fillText(`${Math.round(value * 100)}%`, x, y + 1);
    } else {
      g.globalAlpha = on ? 1 : 0.35;
      g.font = `26px ${EMOJI_FONT}`;
      g.fillText(emoji, x, y + 1);
      g.globalAlpha = 1;
      if (!on) {
        g.strokeStyle = 'rgba(255,255,255,0.85)';
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(x - 11, y + 11);
        g.lineTo(x + 11, y - 11);
        g.stroke();
      }
    }
    g.restore();
    this.hits.push({ x: x - KNOB_R, y: y - KNOB_R, w: KNOB_R * 2, h: KNOB_R * 2, hit: { kind: 'knob', id } });
  }

  private roundButton(b: { x: number; y: number; r: number }, kind: 'timer' | 'skip' | 'stop', icon: 'play' | 'pause' | 'skip' | 'stop', primary: boolean): void {
    const g = this.g;
    const hov = this.hover === kind;
    this.glass(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2, b.r, 1, { tint: hov ? 0.24 : primary ? 0.14 : 0.08, glow: hov ? (kind === 'stop' ? '#ff9a9a' : TEAL) : undefined });
    g.fillStyle = '#ffffff';
    drawIcon(g, icon, b.x, b.y, b.r * 0.42);
    this.hits.push({ x: b.x - b.r, y: b.y - b.r, w: b.r * 2, h: b.r * 2, hit: { kind } });
  }

  private drawRow(r: Row, top: number, alpha: number): void {
    const g = this.g;
    const { x: lx, w: lw } = LIST;
    switch (r.kind) {
      case 'head': {
        g.globalAlpha = alpha;
        g.font = `700 28px ${UI_FONT}`;
        g.fillStyle = '#ffffff';
        g.fillText(`${vi.dash.todo.toUpperCase()} · ${this.todo.open.length}`, lx + 8, top + 36);
        g.font = `24px ${EMOJI_FONT}`;
        g.textAlign = 'right';
        g.fillStyle = DIM;
        g.fillText(vi.dash.pomosToday(this.todo.pomosToday), lx + lw - 8, top + 35);
        g.textAlign = 'left';
        g.globalAlpha = 1;
        break;
      }
      case 'task':
        if (r.task) this.drawTask(r.task, lx, lw, top, alpha, false, this.todo.open[0]?.id === r.task.id);
        break;
      case 'input':
        this.drawInput(top, alpha);
        break;
      case 'doneHead':
        this.drawDoneHead(top, alpha);
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
        const x = lx + lw - 12;
        g.fillText(vi.dash.clearDone, x, top + 30);
        const w = g.measureText(vi.dash.clearDone).width;
        if (hov) g.fillRect(x - w, top + 35, w, 2);
        g.textAlign = 'left';
        g.globalAlpha = 1;
        this.pushListHit(x - w - 12, top, w + 24, 44, { kind: 'clearDone' });
        break;
      }
    }
  }

  /** "✓ ĐÃ XONG HÔM NAY · 3  ▸": a thin rule above, a click opens or folds the finished tasks. */
  private drawDoneHead(top: number, alpha: number): void {
    const g = this.g;
    const { x, w } = LIST;
    const hov = this.hover === 'doneToggle';
    const cy = top + DONE_HEAD_H / 2 + 4;
    g.save();
    g.globalAlpha = alpha;
    g.fillStyle = 'rgba(255,255,255,0.14)';
    g.fillRect(x + 8, top + 2, w - 16, 1.5);
    // ✓ in a teal disc.
    g.beginPath();
    g.arc(x + RING_X, cy, 16, 0, Math.PI * 2);
    g.fillStyle = 'rgba(79,209,193,0.8)';
    g.fill();
    g.strokeStyle = '#ffffff';
    drawCheck(g, x + RING_X, cy, 7);
    g.font = `700 26px ${UI_FONT}`;
    g.fillStyle = hov ? '#ffffff' : DIM;
    const label = `${vi.dash.doneToday.toUpperCase()} · ${this.todo.done.length}`;
    g.fillText(label, x + TEXT_X - 14, cy + 9);
    // ▸ folded, ▾ open.
    const ax = x + TEXT_X - 14 + g.measureText(label).width + 24;
    g.beginPath();
    if (this.showDone) {
      g.moveTo(ax - 8, cy - 4);
      g.lineTo(ax + 8, cy - 4);
      g.lineTo(ax, cy + 6);
    } else {
      g.moveTo(ax - 4, cy - 8);
      g.lineTo(ax + 6, cy);
      g.lineTo(ax - 4, cy + 8);
    }
    g.closePath();
    g.fill();
    g.restore();
    this.pushListHit(x, top, w, DONE_HEAD_H, { kind: 'doneToggle' });
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
    // The current task shows its name in full, on a second line when it is long.
    const lines = first && !editing ? this.firstLines(task) : null;
    const h = first ? this.taskHeight(task) : CARD_H;
    this.glass(x, top, w, h, 24, alpha, {
      tint: editing ? 0.16 : hovAny ? 0.14 : first ? 0.11 : 0.08,
      glow: editing ? 'rgba(255,255,255,0.6)' : first && !lifted ? 'rgba(79,209,193,0.9)' : undefined,
      lift: lifted ? 1 : 0,
    });
    const cy = top + h / 2;
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
    if (lines) {
      const y0 = cy + 14 - ((lines.length - 1) * TASK_LINE) / 2;
      lines.forEach((line, i) => g.fillText(line, x + TEXT_X, y0 + i * TASK_LINE));
    } else g.fillText(ellipsize(g, task.text, right - (x + TEXT_X)), x + TEXT_X, cy + 14);
    g.restore();
    if (!lifted) {
      this.pushListHit(x, top, w, h, { kind: 'card', id: task.id });
      this.pushListHit(x + 8, top, TEXT_X - 8, h, { kind: 'ring', id: task.id });
      // ▶ is there to press only where it shows (always on the top task).
      if (showPlay) this.pushListHit(playX - PLAY_R - 6, top, PLAY_R * 2 + 12, h, { kind: 'play', id: task.id });
      if (estHit) this.pushListHit(estHit.x, top, estHit.w, h, { kind: 'estimate', id: task.id });
      if (hovAny) this.pushListHit(x + w - 70, top, 70, h, { kind: 'delete', id: task.id });
    }
  }

  private drawInput(top: number, alpha: number): void {
    const g = this.g;
    const { x, w } = LIST;
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
    const { x, w } = LIST;
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
    const { x, w } = LIST;
    const top = LIST_TOP + gh.y - this.scroll;
    const cy = top + gh.h / 2;
    const e = gh.t;
    const s = gh.pop ? 1 + 0.06 * Math.sin(Math.min(1, e * 1.6) * Math.PI) : 1 - 0.04 * e;
    g.save();
    g.translate(x + w / 2, cy);
    g.scale(s, s);
    g.translate(-(x + w / 2), -cy);
    const alpha = (1 - e) * (1 - e);
    this.glass(x, top, w, gh.h, 24, alpha, { tint: gh.pop ? 0.2 * (1 - e) + 0.08 : 0.08 });
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
    g.roundRect(LIST.x + LIST.w + 3, y, 5, h, 2.5);
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

/**
 * `text` broken at spaces into at most `maxLines` lines of `max` px (the font set on `g`); the
 * last line ends in "…" if the rest doesn't fit, and a word longer than a line is cut the same.
 */
function wrapLines(g: CanvasRenderingContext2D, text: string, max: number, maxLines: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (let i = 0; i < words.length; i++) {
    const test = cur ? `${cur} ${words[i]}` : words[i];
    if (!cur || g.measureText(test).width <= max) {
      cur = test;
      continue;
    }
    lines.push(cur);
    if (lines.length === maxLines - 1) {
      cur = words.slice(i).join(' ');
      break;
    }
    cur = words[i];
  }
  lines.push(cur);
  return lines.map((l) => ellipsize(g, l, max));
}

function ellipsize(g: CanvasRenderingContext2D, text: string, max: number): string {
  if (max <= 0) return '';
  if (g.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && g.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}
