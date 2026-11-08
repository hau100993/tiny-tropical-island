import * as THREE from 'three';
import type { SharedUniforms } from '../../core/uniforms';
import { BUBBLE_FILM_GLSL } from './bubbleFilm.glsl';

/**
 * Where Bọt's giant bubble is (BubbleCrab drives it; radius 0 hides it); `fade` 1 … 0: as it
 * bursts, the film flies apart as a fading sphere.
 */
export interface BigBubbleSink {
  set(x: number, y: number, z: number, radius: number, fade?: number): void;
}

const VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vView;
varying vec3 vPos;
uniform float uTime;
uniform float uWobble;
void main() {
  // A soap film wobbles: the sphere pushed in and out by a few slow waves.
  vec3 p = position;
  float w = sin(p.x * 3.0 + uTime * 4.0) * sin(p.y * 2.5 + uTime * 3.1) * sin(p.z * 3.3 + uTime * 3.7);
  p *= 1.0 + w * uWobble;
  vec4 world = modelMatrix * vec4(p, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vView = cameraPosition - world.xyz;
  vPos = position;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

/**
 * Thin-film colour: the film's thickness (swirling) and the angle you look through it pick a
 * hue, like a real soap bubble; nearly clear face-on, bright at the rim (Fresnel), a sharp
 * highlight of the sky on top.
 */
const FRAG = /* glsl */ `
varying vec3 vN;
varying vec3 vView;
varying vec3 vPos;
uniform float uTime;
uniform float uDayLight;
uniform float uFade;
${BUBBLE_FILM_GLSL}
void main() {
  vec4 f = bubbleFilm(normalize(vN), normalize(vView), vPos, uTime, uDayLight);
  gl_FragColor = vec4(f.rgb, f.a * uFade);
}
`;

/**
 * Bọt's giant soap bubble ("Bubble Burst"): one sphere with a thin-film shader, drawn only
 * while it is blown, rises and pops.
 */
export class BigBubble implements BigBubbleSink {
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;

  constructor(shared: SharedUniforms) {
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 48, 32),
      new THREE.ShaderMaterial({
        uniforms: { uTime: shared.uTime, uDayLight: shared.uDayLight, uWobble: { value: 0.04 }, uFade: { value: 1 } },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.mesh.visible = false;
    this.mesh.renderOrder = 4;
  }

  set(x: number, y: number, z: number, radius: number, fade = 1): void {
    this.mesh.visible = radius > 0.01 && fade > 0.01;
    this.mesh.material.uniforms.uFade.value = fade;
    this.mesh.position.set(x, y, z);
    this.mesh.scale.setScalar(Math.max(0.01, radius));
  }
}
