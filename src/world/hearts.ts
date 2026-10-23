import * as THREE from 'three';

/** How many hearts can float at once (a fixed pool, reused). */
const POOL = 12;
/** Life (s), rise (m) and size (m) of one heart. */
const LIFE = 1.6;
const RISE = 0.55;
const SIZE = 0.11;

interface Heart {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  age: number;
  x: number;
  y: number;
  z: number;
  /** Sideways drift direction and sway phase. */
  dx: number;
  dz: number;
  phase: number;
}

/** A heart shape drawn once into a small canvas: pink, with a soft white rim and a highlight. */
function heartTexture(): THREE.CanvasTexture {
  const n = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = n;
  const g = canvas.getContext('2d');
  if (g) {
    const path = new Path2D();
    path.moveTo(32, 54);
    path.bezierCurveTo(10, 40, 4, 26, 12, 16);
    path.bezierCurveTo(19, 8, 29, 10, 32, 19);
    path.bezierCurveTo(35, 10, 45, 8, 52, 16);
    path.bezierCurveTo(60, 26, 54, 40, 32, 54);
    path.closePath();
    g.lineJoin = 'round';
    g.lineWidth = 6;
    g.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    g.stroke(path);
    const fill = g.createLinearGradient(0, 10, 0, 54);
    fill.addColorStop(0, '#ff8fab');
    fill.addColorStop(1, '#ff4f7b');
    g.fillStyle = fill;
    g.fill(path);
    g.fillStyle = 'rgba(255, 255, 255, 0.55)';
    g.beginPath();
    g.ellipse(21, 21, 5, 3.2, -0.7, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Little hearts floating up from Mochi while you pet it: sprites (always facing the camera)
 * that pop in, rise with a gentle sway and fade. Unlit and not tone-mapped, so they keep their
 * pink at any time of day.
 */
export class Hearts {
  readonly group = new THREE.Group();
  private readonly texture = heartTexture();
  private readonly hearts: Heart[] = [];
  private next = 0;

  constructor(private readonly reducedMotion: () => boolean) {
    for (let i = 0; i < POOL; i++) {
      const mat = new THREE.SpriteMaterial({ map: this.texture, transparent: true, depthWrite: false, toneMapped: false, fog: false });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      sprite.renderOrder = 3;
      this.group.add(sprite);
      this.hearts.push({ sprite, mat, age: LIFE, x: 0, y: 0, z: 0, dx: 0, dz: 0, phase: 0 });
    }
    this.group.name = 'hearts';
  }

  /** One heart rising from `at` (world). */
  spawn(at: THREE.Vector3): void {
    const h = this.hearts[this.next];
    this.next = (this.next + 1) % POOL;
    const a = Math.random() * Math.PI * 2;
    h.age = 0;
    h.x = at.x + Math.cos(a) * 0.05;
    h.y = at.y;
    h.z = at.z + Math.sin(a) * 0.05;
    h.dx = Math.cos(a);
    h.dz = Math.sin(a);
    h.phase = Math.random() * Math.PI * 2;
    h.sprite.visible = true;
  }

  update(dt: number): void {
    const calm = this.reducedMotion();
    for (const h of this.hearts) {
      if (h.age >= LIFE) continue;
      h.age += dt;
      if (h.age >= LIFE) {
        h.sprite.visible = false;
        continue;
      }
      const t = h.age / LIFE;
      // Eases up and out; sways side to side (not with reduced motion).
      const up = RISE * (1 - (1 - t) * (1 - t));
      const sway = calm ? 0 : Math.sin(h.phase + h.age * 5) * 0.04;
      const out = 0.08 * t;
      h.sprite.position.set(h.x + h.dx * out + h.dz * sway, h.y + up, h.z + h.dz * out - h.dx * sway);
      // Pops in (a quick overshoot), fades over the last part.
      const pop = t < 0.15 ? (t / 0.15) * 1.15 : 1.15 - 0.15 * Math.min(1, (t - 0.15) / 0.1);
      h.sprite.scale.setScalar(SIZE * pop);
      h.mat.opacity = 1 - Math.max(0, (t - 0.55) / 0.45);
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const h of this.hearts) h.mat.dispose();
    this.texture.dispose();
  }
}
