import * as THREE from 'three';
import { YT_LOGO } from '../ui/youtube';
import { vi } from '../ui/strings.vi';
import { attachScreenCanvas, type ScreenBackdrop } from './screenBackdrop';
import { ellipsize, type ScreenInfo } from './deskDash';

const W = 1024;
const H = 576;
/** Canvas size of the left screen, in pixels. */
export const SCREEN_PX = { w: W, h: H } as const;

/** What the left screen shows: the idle launcher, the typing code editor, or a YouTube video. */
export type LeftMode = 'idle' | 'editor' | 'video';

export interface PxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// The idle screen is a desktop with a dock at the bottom centre, like a Mac's. Icons only, no
// names. 48 px here is ~20-30 px on the real screen while seated (2026-10-30: smaller, user request).
const TILE = 48;
const TILE_GAP = 14;
const DOCK_PAD = 10;
const DOCK = {
  w: 2 * TILE + TILE_GAP + 2 * DOCK_PAD,
  h: TILE + 2 * DOCK_PAD,
  y: H - TILE - 2 * DOCK_PAD - 16,
};
const DOCK_X = (W - DOCK.w) / 2;
/**
 * The two app icons in the idle left screen's dock (canvas pixels). DeskVideo lays real buttons
 * exactly over them while you sit at the desk.
 */
export const LAUNCHER: { code: PxRect; youtube: PxRect } = {
  code: { x: DOCK_X + DOCK_PAD, y: DOCK.y + DOCK_PAD, w: TILE, h: TILE },
  youtube: { x: DOCK_X + DOCK_PAD + TILE + TILE_GAP, y: DOCK.y + DOCK_PAD, w: TILE, h: TILE },
};
/** How often the idle screen checks whether its info line (island time, scene, sound) changed (s). */
const INFO_CHECK_S = 1;
/** Redraw rate of the code editor (typing animation). */
const EDITOR_FPS = 8;
/** Beyond this distance (m) from the desk the screens are too small to read: don't redraw. */
const NEAR_ENOUGH = 14;

/** Under the video's title on the left screen's canvas (the live video covers it; reflections show it). */
const PAUSED_TEXT = 'YouTube';

const FONT = '"Cascadia Code", Consolas, "Courier New", monospace';
const UI_FONT = '"Segoe UI", system-ui, sans-serif';

// A dark editor theme.
const C = {
  bg: '#1e1f22',
  side: '#18191c',
  bar: '#2b2d31',
  gutter: '#5c6370',
  text: '#d4d4d4',
  keyword: '#c678dd',
  type: '#4ec9b0',
  fn: '#dcdcaa',
  string: '#ce9178',
  number: '#b5cea8',
  comment: '#6a9955',
  accent: '#3b82f6',
};

const KEYWORDS = new Set([
  'const', 'let', 'function', 'return', 'if', 'else', 'for', 'while', 'export', 'import', 'from', 'type',
  'interface', 'class', 'new', 'private', 'readonly', 'void', 'number', 'string', 'boolean', 'true', 'false',
  'null', 'this', 'of', 'in', 'async', 'await', 'extends', 'implements', 'uniform', 'float', 'vec2', 'vec3', 'vec4',
]);

/** Code that "gets typed" on the left screen, file by file. */
const SNIPPETS: Array<{ file: string; code: string }> = [
  {
    file: 'pomodoro.ts',
    code: `export function advance(s: PomodoroState, c: PomodoroConfig, now: number): AdvanceResult {
  let state: PomodoroState = { ...s };
  const ended: PomodoroPhase[] = [];
  // Bounded: after a long sleep, don't spin through hundreds of cycles.
  for (let i = 0; i < 64 && state.running && state.endsAt <= now; i++) {
    ended.push(state.phase);
    const n = following(state, c);
    const ms = phaseMs(n.phase, c);
    state = c.autoContinue
      ? { ...state, phase: n.phase, endsAt: state.endsAt + ms }
      : { ...state, phase: n.phase, running: false, remainingMs: ms };
  }
  return { state, ended };
}

export function formatRemaining(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return \`\${m}:\${String(sec).padStart(2, '0')}\`;
}`,
  },
  {
    file: 'simUpdate.frag.glsl',
    code: `// One step of the wave equation on the GPU (double-buffered).
uniform sampler2D uState;
uniform vec2 uTexel;

void main() {
  vec4 s = texture2D(uState, vUv);
  // Average of the four neighbours.
  float avg = (
    texture2D(uState, vUv - vec2(uTexel.x, 0.0)).r +
    texture2D(uState, vUv + vec2(uTexel.x, 0.0)).r +
    texture2D(uState, vUv - vec2(0.0, uTexel.y)).r +
    texture2D(uState, vUv + vec2(0.0, uTexel.y)).r
  ) * 0.25;
  // Accelerate toward the average, then damp a little.
  s.g += (avg - s.r) * 2.0;
  s.g *= 0.995;
  s.r += s.g;
  gl_FragColor = s;
}`,
  },
  {
    file: 'SoundLibrary.ts',
    code: `export class SoundLibrary {
  private tracks: TrackMeta[];
  private activePreset = '';
  private readonly players = new Map<string, TrackPlayer>();

  /** The scene preset now on screen: its recordings fade in. */
  setActivePreset(id: string): void {
    if (id === this.activePreset) return;
    this.activePreset = id;
    this.apply(SCENE_FADE);
  }

  private apply(timeConstant: number): void {
    for (const t of this.tracks) {
      const level = trackLevel(t, this.activePreset, this.calm);
      this.player(t.id).setLevel(level, timeConstant);
    }
  }
}`,
  },
];

const FILES = ['src', '  audio', '    library', '  core', '  ui', '  water', '  world', 'tests', 'PLAN.md', 'README.md'];

interface Token {
  text: string;
  color: string;
}

/** A tiny highlighter: comments, strings, numbers, keywords, types, function names. */
function tokenize(line: string): Token[] {
  const out: Token[] = [];
  const re = /(\/\/.*$)|('[^']*'|"[^"]*"|`[^`]*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)|(\s+)|(.)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const [text, comment, str, num, word] = m;
    let color = C.text;
    if (comment) color = C.comment;
    else if (str) color = C.string;
    else if (num) color = C.number;
    else if (word) {
      if (KEYWORDS.has(word)) color = C.keyword;
      else if (/^[A-Z]/.test(word)) color = C.type;
      else if (line[m.index + word.length] === '(') color = C.fn;
    }
    out.push({ text, color });
  }
  return out;
}

/**
 * The left desk monitor, drawn on a canvas: an idle launcher with two app icons, a code editor
 * that slowly types code, or the title of the loaded video (the live video covers it while
 * seated). It only redraws while the camera is close enough to read it. (The right monitor is
 * DeskDash.)
 */
export class DeskScreens {
  private readonly editor: CanvasRenderingContext2D;
  private readonly editorTex: THREE.CanvasTexture;
  private snippet = 0;
  /** Characters of the current snippet typed so far. */
  private typed = 0;
  private pauseLeft = 0;
  private editorTimer = 0;
  private blink = 0;
  private readonly center = new THREE.Vector3();
  private readonly logoBody = new Path2D(YT_LOGO.body);
  private readonly logoPlay = new Path2D(YT_LOGO.play);
  private leftMode: LeftMode = 'idle';
  /** A video loaded on the left screen (its title), shown there while you're away from the desk. */
  private videoLabel: string | null = null;
  /** The idle and video screens are still pictures: drawn again only when this is set. */
  private leftDirty = true;
  /** The idle screen's background, like the right monitor's (shifted so the two differ). */
  private readonly backdrop: ScreenBackdrop;
  private time = 0;
  private infoTimer = 0;
  private drawnOnce = false;
  /** The island time, scene and sound last drawn on the idle screen. */
  private infoKey = '';

  constructor(
    mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>,
    anisotropy: number,
    private readonly info: () => ScreenInfo,
  ) {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.editor = ctx;
    const screen = attachScreenCanvas(mesh.material, canvas, anisotropy, 2.7);
    this.editorTex = screen.texture;
    this.backdrop = screen.backdrop;
    mesh.getWorldPosition(this.center);
    // Not drawn here: `info` reads parts of the app built after this. The first update draws.
  }

  /** What the left screen shows; `videoLabel` is the loaded video's title (video mode). */
  setLeft(mode: LeftMode, videoLabel: string | null): void {
    if (mode === this.leftMode && videoLabel === this.videoLabel) return;
    this.leftMode = mode;
    this.videoLabel = videoLabel;
    this.leftDirty = true;
    this.editorTimer = 0;
  }

  update(dt: number, camera: THREE.Camera): void {
    this.time += dt;
    this.backdrop.time.value = this.time;
    const dist = camera.position.distanceTo(this.center);
    // Far away only the first picture is drawn.
    if (dist > NEAR_ENOUGH && this.drawnOnce) return;
    this.drawnOnce = true;
    if (this.leftMode === 'editor') {
      this.editorTimer -= dt;
      if (this.editorTimer <= 0) {
        this.editorTimer = 1 / EDITOR_FPS;
        this.typeSome();
        this.drawLeft();
      }
    } else {
      if (this.leftMode === 'idle') {
        this.infoTimer -= dt;
        if (this.infoTimer <= 0) {
          this.infoTimer = INFO_CHECK_S;
          const i = this.info();
          if (infoKey(i) !== this.infoKey) this.leftDirty = true;
        }
      }
      if (this.leftDirty) this.drawLeft();
    }
  }

  /** The left screen while a video waits: dark, a play mark, the title, how to go on. */
  private drawVideoCard(title: string): void {
    const g = this.editor;
    g.fillStyle = '#0f0f10';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#ff0033';
    g.beginPath();
    g.roundRect(W / 2 - 60, H / 2 - 110, 120, 84, 22);
    g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(W / 2 - 16, H / 2 - 92);
    g.lineTo(W / 2 + 24, H / 2 - 68);
    g.lineTo(W / 2 - 16, H / 2 - 44);
    g.closePath();
    g.fill();
    g.textAlign = 'center';
    g.font = `600 30px ${UI_FONT}`;
    const t = title.length > 52 ? `${title.slice(0, 50)}…` : title;
    g.fillText(t, W / 2, H / 2 + 30);
    g.fillStyle = '#9aa0a6';
    g.font = `22px ${UI_FONT}`;
    g.fillText(PAUSED_TEXT, W / 2, H / 2 + 72);
    g.textAlign = 'left';
    this.editorTex.needsUpdate = true;
  }

  /** Types a few characters (bursts, like a person), pausing at the end of each file. */
  private typeSome(): void {
    this.blink++;
    const code = SNIPPETS[this.snippet].code;
    if (this.typed >= code.length) {
      this.pauseLeft -= 1 / EDITOR_FPS;
      if (this.pauseLeft <= 0) {
        this.snippet = (this.snippet + 1) % SNIPPETS.length;
        this.typed = 0;
      }
      return;
    }
    // Whole indentation at once; otherwise 0–4 characters per tick.
    const burst = Math.random() < 0.15 ? 0 : 1 + Math.floor(Math.random() * 4);
    let n = burst;
    while (code[this.typed + n] === ' ') n++;
    this.typed = Math.min(code.length, this.typed + n);
    if (this.typed >= code.length) this.pauseLeft = 4;
  }

  private drawLeft(): void {
    this.leftDirty = false;
    if (this.leftMode === 'video') this.drawVideoCard(this.videoLabel ?? '');
    else if (this.leftMode === 'editor') this.drawEditor();
    else this.drawIdle();
  }

  /**
   * A monitor at rest, over the drifting colour backdrop (the screen's shader, screenBackdrop.ts):
   * the island time, scene and sound in the middle (quiet), the two app icons in a dock at the
   * bottom. A still picture, drawn again when the info changes.
   */
  private drawIdle(): void {
    const g = this.editor;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(5,14,22,0.22)';
    g.fillRect(0, 0, W, H);
    this.drawInfo(g);

    // The dock: a frosted bar, a little shadow under it.
    roundRect(g, DOCK_X, DOCK.y + 3, DOCK.w, DOCK.h, 20, 'rgba(0,0,0,0.18)');
    roundRect(g, DOCK_X, DOCK.y, DOCK.w, DOCK.h, 20, 'rgba(255,255,255,0.16)');
    g.strokeStyle = 'rgba(255,255,255,0.28)';
    g.lineWidth = 1;
    g.beginPath();
    g.roundRect(DOCK_X + 0.5, DOCK.y + 0.5, DOCK.w - 1, DOCK.h - 1, 20);
    g.stroke();

    const { code, youtube } = LAUNCHER;
    const k = TILE / 150;
    const radius = 11;
    // Code: a blue tile with a "</>" mark.
    const blue = g.createLinearGradient(0, code.y, 0, code.y + code.h);
    blue.addColorStop(0, '#3aa0ee');
    blue.addColorStop(1, '#0b5fae');
    roundRect(g, code.x, code.y, code.w, code.h, radius, blue);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 13 * k;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const cx = code.x + code.w / 2;
    const cy = code.y + code.h / 2;
    g.beginPath();
    g.moveTo(cx - 26 * k, cy - 26 * k);
    g.lineTo(cx - 50 * k, cy);
    g.lineTo(cx - 26 * k, cy + 26 * k);
    g.moveTo(cx + 26 * k, cy - 26 * k);
    g.lineTo(cx + 50 * k, cy);
    g.lineTo(cx + 26 * k, cy + 26 * k);
    g.moveTo(cx + 9 * k, cy - 34 * k);
    g.lineTo(cx - 9 * k, cy + 34 * k);
    g.stroke();
    // YouTube: a white tile with the logo.
    roundRect(g, youtube.x, youtube.y, youtube.w, youtube.h, radius, '#f4f5f7');
    const logoW = 104 * k;
    this.drawLogo(g, youtube.x + (youtube.w - logoW) / 2, youtube.y + (youtube.h - (logoW * 17) / 24) / 2, logoW);
    this.editorTex.needsUpdate = true;
  }

  /** The island time, large and light, and one dim line under it: the scene and what is playing. */
  private drawInfo(g: CanvasRenderingContext2D): void {
    const i = this.info();
    this.infoKey = infoKey(i);
    const cy = (DOCK.y - 16) / 2 + 8;
    g.save();
    g.textAlign = 'center';
    g.shadowColor = 'rgba(0,0,0,0.35)';
    g.shadowBlur = 12;
    g.font = `600 15px ${UI_FONT}`;
    g.fillStyle = 'rgba(225,236,242,0.6)';
    g.fillText(vi.dash.island.toUpperCase(), W / 2, cy - 62);
    g.font = `200 64px ${UI_FONT}`;
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.fillText(i.islandTime, W / 2, cy);
    g.font = `20px ${UI_FONT}`;
    g.fillStyle = 'rgba(225,236,242,0.72)';
    const line = `${i.scene || '—'}  ·  ♪ ${i.playing}`;
    g.fillText(ellipsize(g, line, W - 200), W / 2, cy + 40);
    g.restore();
  }

  private drawEditor(): void {
    const g = this.editor;
    const { file, code } = SNIPPETS[this.snippet];
    g.fillStyle = C.bg;
    g.fillRect(0, 0, W, H);
    // Side bar with a file tree.
    const sideW = 150;
    g.fillStyle = C.side;
    g.fillRect(0, 0, sideW, H);
    g.font = `15px ${UI_FONT}`;
    g.fillStyle = '#8b8f97';
    g.fillText('EXPLORER', 16, 30);
    FILES.forEach((f, i) => {
      g.fillStyle = f.trim() === 'library' || f.trim() === 'audio' ? '#c8ccd4' : '#8b8f97';
      g.fillText(f.trim().includes('.') ? f : `▸ ${f.trim()}`, 16 + (f.length - f.trimStart().length) * 6, 62 + i * 26);
    });
    // Tab bar.
    g.fillStyle = C.bar;
    g.fillRect(sideW, 0, W - sideW, 38);
    g.fillStyle = C.bg;
    g.fillRect(sideW, 0, 230, 38);
    g.fillStyle = C.accent;
    g.fillRect(sideW, 0, 230, 2);
    g.fillStyle = '#e6e6e6';
    g.font = `15px ${UI_FONT}`;
    g.fillText(file, sideW + 16, 25);
    // Code: the last lines that fit, with line numbers and a blinking cursor.
    const text = code.slice(0, this.typed);
    const lines = text.split('\n');
    const lineH = 27;
    const top = 66;
    const rows = Math.floor((H - top - 34) / lineH);
    const first = Math.max(0, lines.length - rows);
    g.font = `20px ${FONT}`;
    const charW = g.measureText('M').width;
    for (let i = first; i < lines.length; i++) {
      const y = top + (i - first) * lineH;
      g.fillStyle = C.gutter;
      g.textAlign = 'right';
      g.fillText(String(i + 1), sideW + 40, y);
      g.textAlign = 'left';
      let x = sideW + 56;
      for (const t of tokenize(lines[i])) {
        g.fillStyle = t.color;
        g.fillText(t.text, x, y);
        x += t.text.length * charW;
      }
      if (i === lines.length - 1 && this.blink % 8 < 5) {
        g.fillStyle = '#e6e6e6';
        g.fillRect(x + 1, y - 18, 2, 23);
      }
    }
    // Status bar.
    g.fillStyle = C.accent;
    g.fillRect(0, H - 26, W, 26);
    g.fillStyle = '#ffffff';
    g.font = `14px ${UI_FONT}`;
    g.fillText(`main  ·  Ln ${lines.length}, Col ${(lines[lines.length - 1]?.length ?? 0) + 1}  ·  UTF-8  ·  TypeScript`, 14, H - 8);
    this.editorTex.needsUpdate = true;
  }

  /** The YouTube logo, `w` pixels wide, its top-left corner at (x, y). */
  private drawLogo(g: CanvasRenderingContext2D, x: number, y: number, w: number): void {
    g.save();
    g.translate(x, y);
    g.scale(w / 24, w / 24);
    g.translate(0, -3.5);
    g.fillStyle = YT_LOGO.red;
    g.fill(this.logoBody);
    g.fillStyle = '#ffffff';
    g.fill(this.logoPlay);
    g.restore();
  }

  dispose(): void {
    this.editorTex.dispose();
  }
}

function infoKey(i: ScreenInfo): string {
  return `${i.islandTime}|${i.scene}|${i.playing}`;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string | CanvasGradient): void {
  g.fillStyle = fill;
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.fill();
}
