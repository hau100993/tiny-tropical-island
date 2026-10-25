import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/** Bloom at full strength: how strong, how wide (0..1), and from what brightness (linear, before tone mapping). */
const BLOOM = { strength: 0.55, radius: 0.4, threshold: 2.2 } as const;

/**
 * Before the blur: a half-float target keeps what an 8-bit canvas would clip, so piled-up
 * additive fire can reach infinity, and one NaN or infinite pixel smeared by the blur blacks
 * out the whole screen. Colours are capped (far above anything that should glow) and NaNs
 * dropped. Alpha is set to 1 as a plain render leaves it: the canvas is see-through where it
 * is below 1 (the desk video's hole).
 */
const SANITIZE = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
  fragmentShader: /* glsl */ `
uniform sampler2D tDiffuse;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  // (NaN is the only value not equal to itself.)
  if (c.r != c.r || c.g != c.g || c.b != c.b) c = vec3(0.0);
  gl_FragColor = vec4(clamp(c, 0.0, 16.0), 1.0);
}`,
};

/**
 * The glow round fire, lightning and sparkles while a big skill is on (High quality only).
 * Three.js's own post-processing (examples/jsm, MIT, part of the three package): the scene into
 * a half-float target (HDR, so only what is really bright blooms), UnrealBloom's blurred mip
 * chain of the bright parts added back, then the tone mapping and sRGB that a plain render does
 * itself. Made on first use; only used while `level` > 0, so it costs nothing the rest of the time.
 */
export class Bloom {
  private composer: EffectComposer | null = null;
  private pass: UnrealBloomPass | null = null;
  private readonly size = new THREE.Vector2();

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    private readonly msaa: boolean,
  ) {}

  /** Renders the frame with bloom at `level` (0..1) of full strength. */
  render(level: number): void {
    const c = this.composer ?? this.make();
    if (this.pass) this.pass.strength = BLOOM.strength * level;
    c.render();
  }

  /** The canvas changed size (call after renderer.setSize / setPixelRatio). */
  resize(): void {
    if (!this.composer) return;
    this.renderer.getSize(this.size);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(this.size.x, this.size.y);
  }

  private make(): EffectComposer {
    const r = this.renderer;
    r.getSize(this.size);
    const target = new THREE.WebGLRenderTarget(this.size.x * r.getPixelRatio(), this.size.y * r.getPixelRatio(), {
      type: THREE.HalfFloatType,
      samples: this.msaa ? 4 : 0,
    });
    const c = new EffectComposer(r, target);
    c.addPass(new RenderPass(this.scene, this.camera));
    c.addPass(new ShaderPass(SANITIZE));
    // Half resolution is plenty for a blur, and much cheaper.
    this.pass = new UnrealBloomPass(new THREE.Vector2(this.size.x / 2, this.size.y / 2), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
    c.addPass(this.pass);
    c.addPass(new OutputPass());
    this.composer = c;
    this.resize();
    return c;
  }
}
