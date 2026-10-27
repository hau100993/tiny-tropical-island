import * as THREE from 'three';

/**
 * The desk monitors' background: colour blobs drifting over dark teal, computed in the screen's
 * fragment shader. The monitor's canvas holds only what is drawn on top (transparent elsewhere),
 * so the backdrop moves at full frame rate without redrawing or re-uploading the canvas: each
 * canvas → texture upload makes the CPU wait for the GPU (measured: 24 uploads/s cost the desk
 * view ~25 fps).
 *
 * Each blob is a canvas-style radial gradient from its colour to transparent black (colour and
 * alpha fade together), laid over the base colour in sRGB like the 2D canvas did.
 */
const BACKDROP_GLSL = /* glsl */ `
uniform float uBackdropTime;
uniform float uBackdropPhase;
uniform vec2 uBackdropSize;

// One blob: centre drifting at (fx, fy) Hz, radius r × the screen width, peak alpha a.
vec3 backdropBlob(vec3 col, vec2 px, vec3 rgb, float a, float r, float fx, float fy, float phase) {
  float t = uBackdropTime;
  float p = phase + uBackdropPhase;
  vec2 c = uBackdropSize * vec2(0.5 + 0.42 * sin(t * fx * 6.2831853 + p), 0.5 + 0.4 * cos(t * fy * 6.2831853 + p * 1.7));
  float k = 1.0 - min(length(px - c) / (r * uBackdropSize.x), 1.0);
  float alpha = a * k;
  return col * (1.0 - alpha) + rgb * k * alpha;
}

// sRGB colour of the backdrop at canvas position uv (0..1, y down).
vec3 screenBackdrop(vec2 uv) {
  vec2 px = uv * uBackdropSize;
  vec3 col = vec3(11.0, 34.0, 48.0) / 255.0;
  col = backdropBlob(col, px, vec3(31.0, 181.0, 168.0) / 255.0, 0.85, 0.55, 0.031, 0.023, 0.0);
  col = backdropBlob(col, px, vec3(42.0, 111.0, 214.0) / 255.0, 0.8, 0.6, 0.019, 0.029, 2.1);
  col = backdropBlob(col, px, vec3(226.0, 121.0, 143.0) / 255.0, 0.6, 0.42, 0.027, 0.017, 4.2);
  col = backdropBlob(col, px, vec3(243.0, 180.0, 91.0) / 255.0, 0.45, 0.36, 0.015, 0.033, 1.3);
  return col;
}
`;

// The canvas (premultiplied, raw sRGB values) over the backdrop, composited in sRGB as the 2D
// canvas would, then decoded to linear like any colour texture.
const MAP_FRAGMENT = /* glsl */ `
#ifdef USE_MAP
  vec4 ui = texture2D( map, vMapUv );
  vec3 bg = screenBackdrop( vec2( vMapUv.x, 1.0 - vMapUv.y ) );
  diffuseColor *= sRGBTransferEOTF( vec4( bg * ( 1.0 - ui.a ) + ui.rgb, 1.0 ) );
#endif
`;

export interface ScreenBackdrop {
  /** Seconds; the blobs drift with it. */
  readonly time: { value: number };
}

/**
 * Shows `canvas` on the monitor `material` over the drifting backdrop. Transparent parts of the
 * canvas show the backdrop; `phase` shifts the drift so the two screens differ.
 */
export function attachScreenCanvas(
  material: THREE.MeshBasicMaterial,
  canvas: HTMLCanvasElement,
  anisotropy: number,
  phase = 0,
): { texture: THREE.CanvasTexture; backdrop: ScreenBackdrop } {
  const texture = new THREE.CanvasTexture(canvas);
  // Raw sRGB values, premultiplied (the 2D canvas's own format, so the upload converts nothing).
  texture.colorSpace = THREE.NoColorSpace;
  texture.premultiplyAlpha = true;
  texture.anisotropy = anisotropy;
  const time = { value: 0 };
  material.map = texture;
  material.color.set('#ffffff');
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBackdropTime = time;
    shader.uniforms.uBackdropPhase = { value: phase };
    shader.uniforms.uBackdropSize = { value: new THREE.Vector2(canvas.width, canvas.height) };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${BACKDROP_GLSL}`)
      .replace('#include <map_fragment>', MAP_FRAGMENT);
  };
  material.customProgramCacheKey = () => 'screenBackdrop';
  material.needsUpdate = true;
  return { texture, backdrop: { time } };
}
