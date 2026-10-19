import * as THREE from 'three';

/** A soft shadow footprint on a flat surface: center, size, yaw and darkness (0..1). */
export interface ShadowSpot {
  x: number;
  z: number;
  w: number;
  d: number;
  yaw?: number;
  strength?: number;
}

/**
 * Contact shadows: soft dark footprints under objects standing on a surface (the "ambient
 * occlusion" right where an object touches it). Shadow maps are too coarse for a mug or a
 * monitor foot, and these are what make small things look set down rather than floating.
 * One mesh of textured quads, one draw call; the texture is a blurred rounded rectangle, so
 * one quad stretched to the footprint works for round and square bases alike.
 */
export function createContactShadows(spots: readonly ShadowSpot[], y: number): THREE.Mesh {
  const pos: number[] = [];
  const uv: number[] = [];
  const alpha: number[] = [];
  const index: number[] = [];
  for (const s of spots) {
    // The texture fades out over the outer part: grow the quad so the dark core matches the base.
    const hw = s.w * 0.8;
    const hd = s.d * 0.8;
    const c = Math.cos(s.yaw ?? 0);
    const sn = Math.sin(s.yaw ?? 0);
    const base = pos.length / 3;
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]] as const) {
      const lx = (u * 2 - 1) * hw;
      const lz = (v * 2 - 1) * hd;
      pos.push(s.x + lx * c + lz * sn, y, s.z - lx * sn + lz * c);
      uv.push(u, v);
      alpha.push(s.strength ?? 0.5);
    }
    index.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aStrength', new THREE.Float32BufferAttribute(alpha, 1));
  g.setIndex(index);
  const material = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: footprintTexture() } },
    vertexShader: /* glsl */ `
      attribute float aStrength;
      varying vec2 vUv;
      varying float vStrength;
      void main() {
        vUv = uv;
        vStrength = aStrength;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      varying vec2 vUv;
      varying float vStrength;
      void main() {
        gl_FragColor = vec4(0.0, 0.0, 0.0, texture2D(uMap, vUv).r * vStrength);
      }`,
    transparent: true,
    depthWrite: false,
    // Drawn on the desk top: pull toward the camera a little so it never flickers into it.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, material);
  mesh.name = 'contact-shadows';
  mesh.renderOrder = 1;
  return mesh;
}

/**
 * A soft rounded-rectangle footprint: full inside the middle ~40 %, fading smoothly to zero
 * at the edges (distance to a rounded box, through a smoothstep). Built once, 64×64 bytes.
 */
function footprintTexture(): THREE.DataTexture {
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = Math.abs(((i + 0.5) / n) * 2 - 1);
      const y = Math.abs(((j + 0.5) / n) * 2 - 1);
      // Signed distance to a rounded box of half-size 0.42 and corner radius 0.25.
      const qx = Math.max(x - 0.42 + 0.25, 0);
      const qy = Math.max(y - 0.42 + 0.25, 0);
      const d = Math.hypot(qx, qy) - 0.25;
      const t = Math.min(1, Math.max(0, (0.55 - d) / 0.55));
      const v = Math.round(255 * t * t * (3 - 2 * t));
      data.set([v, v, v, 255], (j * n + i) * 4);
    }
  }
  const tex = new THREE.DataTexture(data, n, n);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
