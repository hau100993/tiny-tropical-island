import * as THREE from 'three';
import { MUG } from './houseInterior';

/**
 * Image printed on the desk mug: `src/assets/decor/mug-logo.png` (committed, the TMA logo), or
 * a local one in the git-ignored `src/assets/local/` that takes precedence (.png/.jpg/.webp).
 * Vite's glob finds nothing when a file is absent, so with neither the mug stays plain and
 * nothing is requested (no 404).
 */
const found = {
  ...import.meta.glob<string>('../assets/decor/mug-logo.{png,jpg,jpeg,webp}', { eager: true, query: '?url', import: 'default' }),
  ...import.meta.glob<string>('../assets/local/mug-logo.{png,jpg,jpeg,webp}', { eager: true, query: '?url', import: 'default' }),
};

/** The mug body's radius at height h (see `mug()` in houseInterior.ts). */
const radiusAt = (h: number): number => MUG.r0 + ((MUG.r1 - MUG.r0) * h) / MUG.h;
/** Printed band: most of the height, ~100° of the circumference wide. */
const Y0 = 0.014;
const Y1 = MUG.h - 0.01;
const ARC = 1.75;

/**
 * A print wrapped on the mug at (x, y = desk top, z), centered on the side facing `yaw`
 * (0 = +Z, π/2 = +X). Returns null when there is no logo file.
 */
export function createMugLogo(x: number, y: number, z: number, yaw: number): THREE.Mesh | null {
  const url = Object.values(found)[0];
  if (!url) return null;
  // An open slice of a cone hugging the tapered body, just outside the glaze. Its texture
  // coordinates run around the mug (u) and up (v), so the image wraps without stretching.
  const geo = new THREE.CylinderGeometry(radiusAt(Y1) + 0.0006, radiusAt(Y0) + 0.0006, Y1 - Y0, 24, 1, true, -ARC / 2, ARC);
  geo.rotateY(yaw);
  geo.translate(x, y + (Y0 + Y1) / 2, z);
  const material = new THREE.MeshStandardMaterial({ roughness: 0.3, alphaTest: 0.5, visible: false });
  const img = new Image();
  img.onload = () => {
    material.map = printTexture(img);
    material.visible = true;
    material.needsUpdate = true;
  };
  img.onerror = () => console.info('[decor] Mug logo could not be loaded');
  img.src = url;
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'mug-logo';
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * The logo as a print: the near-white background becomes transparent (the mug's own glaze
 * shows there), so only the inked parts appear, and the empty margin is cropped so the logo
 * fills the band (centered, aspect kept). Done once on a canvas when the image loads.
 */
function printTexture(img: HTMLImageElement): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  if (g) {
    g.drawImage(img, 0, 0);
    const data = g.getImageData(0, 0, canvas.width, canvas.height);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      const lightest = Math.min(px[i], px[i + 1], px[i + 2]);
      // White → clear, with a soft edge so the outlines stay smooth.
      const a = Math.max(0, Math.min(1, (245 - lightest) / 25));
      px[i + 3] = Math.round(px[i + 3] * a);
    }
    g.putImageData(data, 0, 0);
  }
  const tex = new THREE.CanvasTexture(fitInk(canvas));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Crops `src` to its inked (non-transparent) area and centers that on a new canvas shaped like
 * the printed band (its width around the mug : its height), with a small margin, so the logo
 * comes out as large as the band allows without being stretched.
 */
function fitInk(src: HTMLCanvasElement): HTMLCanvasElement {
  const g = src.getContext('2d', { willReadFrequently: true });
  if (!g) return src;
  const { width: w, height: h } = src;
  const px = g.getImageData(0, 0, w, h).data;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] > 24) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
  }
  if (x1 < x0) return src;
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  const bandAspect = (ARC * radiusAt((Y0 + Y1) / 2)) / (Y1 - Y0);
  const out = document.createElement('canvas');
  out.height = 512;
  out.width = Math.round(512 * bandAspect);
  const o = out.getContext('2d');
  if (!o) return src;
  const fit = Math.min((out.width * 0.92) / cw, (out.height * 0.92) / ch);
  const dw = cw * fit;
  const dh = ch * fit;
  o.drawImage(src, x0, y0, cw, ch, (out.width - dw) / 2, (out.height - dh) / 2, dw, dh);
  return out;
}
