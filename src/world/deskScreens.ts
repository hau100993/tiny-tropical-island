import * as THREE from 'three';

/** What the right-hand monitor shows (filled by the app once a second). */
export interface ScreenInfo {
  pomodoro: { phase: string; remaining: string; progress: number; running: boolean; onBreak: boolean } | null;
  scene: string;
  /** What is playing, as one line. */
  playing: string;
  islandTime: string;
  weather: string;
}

const W = 1024;
const H = 576;
/** Redraw rate of the code editor (typing animation). */
const EDITOR_FPS = 8;
/** Beyond this distance (m) from the desk the screens are too small to read: don't redraw. */
const NEAR_ENOUGH = 14;

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
 * The two desk monitors, drawn on canvases: a code editor that slowly types code (left) and a
 * dashboard with the clock, Pomodoro, scene and what is playing (right). They only redraw
 * while the camera is close enough to read them.
 */
export class DeskScreens {
  private readonly editor: CanvasRenderingContext2D;
  private readonly dash: CanvasRenderingContext2D;
  private readonly editorTex: THREE.CanvasTexture;
  private readonly dashTex: THREE.CanvasTexture;
  private snippet = 0;
  /** Characters of the current snippet typed so far. */
  private typed = 0;
  private pauseLeft = 0;
  private editorTimer = 0;
  private dashTimer = 0;
  private blink = 0;
  private readonly center = new THREE.Vector3();

  constructor(
    screens: ReadonlyArray<THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>>,
    anisotropy: number,
    private readonly info: () => ScreenInfo,
  ) {
    const make = (mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>): [CanvasRenderingContext2D, THREE.CanvasTexture] => {
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('2D canvas unavailable');
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = anisotropy;
      mesh.material.map = tex;
      mesh.material.color.set('#ffffff');
      mesh.material.needsUpdate = true;
      return [ctx, tex];
    };
    [this.editor, this.editorTex] = make(screens[0]);
    [this.dash, this.dashTex] = make(screens[1]);
    screens[0].getWorldPosition(this.center);
    // The dashboard is drawn on the first update (its data source may not exist yet).
    this.drawEditor();
  }

  update(dt: number, camera: THREE.Camera): void {
    if (camera.position.distanceTo(this.center) > NEAR_ENOUGH) return;
    this.editorTimer -= dt;
    if (this.editorTimer <= 0) {
      this.editorTimer = 1 / EDITOR_FPS;
      this.typeSome();
      this.drawEditor();
    }
    this.dashTimer -= dt;
    if (this.dashTimer <= 0) {
      this.dashTimer = 1;
      this.drawDash();
    }
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

  private drawDash(): void {
    const g = this.dash;
    const i = this.info();
    const bg = g.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#0f2027');
    bg.addColorStop(1, '#203a43');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);

    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    g.fillStyle = '#ffffff';
    g.font = `200 120px ${UI_FONT}`;
    g.fillText(`${hh}:${mm}`, 48, 150);
    g.font = `26px ${UI_FONT}`;
    g.fillStyle = '#a7c4cc';
    const days = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
    g.fillText(`${days[now.getDay()]}, ${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`, 52, 196);

    // Pomodoro card.
    const p = i.pomodoro;
    roundRect(g, 48, 236, 440, 150, 18, 'rgba(255,255,255,0.08)');
    g.font = `22px ${UI_FONT}`;
    g.fillStyle = '#a7c4cc';
    g.fillText('Pomodoro', 72, 274);
    if (p) {
      g.fillStyle = p.onBreak ? '#ffd38a' : '#4fd1c1';
      g.fillText(p.phase + (p.running ? '' : ' (tạm dừng)'), 200, 274);
      g.fillStyle = '#ffffff';
      g.font = `300 64px ${UI_FONT}`;
      g.fillText(p.remaining, 70, 346);
      roundRect(g, 72, 362, 392, 6, 3, 'rgba(255,255,255,0.15)');
      roundRect(g, 72, 362, Math.max(6, 392 * p.progress), 6, 3, p.onBreak ? '#ffd38a' : '#4fd1c1');
    } else {
      g.fillStyle = '#ffffff';
      g.font = `26px ${UI_FONT}`;
      g.fillText('Nhấn T để bắt đầu', 72, 330);
    }

    // Scene and sound.
    roundRect(g, 520, 236, 456, 150, 18, 'rgba(255,255,255,0.08)');
    g.font = `22px ${UI_FONT}`;
    g.fillStyle = '#a7c4cc';
    g.fillText('Cảnh', 544, 274);
    g.fillStyle = '#ffffff';
    g.font = `30px ${UI_FONT}`;
    g.fillText(ellipsize(g, i.scene || '—', 400), 544, 316);
    g.font = `20px ${UI_FONT}`;
    g.fillStyle = '#a7c4cc';
    g.fillText(ellipsize(g, i.weather, 410), 544, 356);

    roundRect(g, 48, 410, 928, 120, 18, 'rgba(255,255,255,0.08)');
    g.font = `22px ${UI_FONT}`;
    g.fillStyle = '#a7c4cc';
    g.fillText('Đang phát', 72, 448);
    g.fillText(`Giờ trên đảo ${i.islandTime}`, 760, 448);
    g.fillStyle = '#ffffff';
    g.font = `26px ${UI_FONT}`;
    g.fillText(ellipsize(g, `♪  ${i.playing}`, 880), 72, 500);
    this.dashTex.needsUpdate = true;
  }

  dispose(): void {
    this.editorTex.dispose();
    this.dashTex.dispose();
  }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string): void {
  g.fillStyle = fill;
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.fill();
}

function ellipsize(g: CanvasRenderingContext2D, text: string, max: number): string {
  if (g.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && g.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}
