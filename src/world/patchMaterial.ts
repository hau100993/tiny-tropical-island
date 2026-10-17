import type * as THREE from 'three';

/**
 * Shader patching for built-in three.js materials. `onBeforeCompile` lets us splice GLSL into
 * MeshStandardMaterial at known `#include` points, keeping all of three's lighting and shadows.
 * The chunk names below are checked against three 0.186.1 (pinned in package.json).
 */

export interface CausticsUniforms {
  uCaustics: { value: THREE.Texture | null };
  uCausticsSize: { value: number };
  uCausticsOn: { value: number };
  uSunColor: { value: THREE.Color };
  uSunDir: { value: THREE.Vector3 };
}

/** Adds underwater caustic light to a MeshStandardMaterial (works with InstancedMesh too). */
export function patchCaustics(material: THREE.MeshStandardMaterial, uniforms: CausticsUniforms): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vCausticWorldPos;\nvoid main() {')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec4 cwp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            cwp = instanceMatrix * cwp;
          #endif
          vCausticWorldPos = (modelMatrix * cwp).xyz;
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `uniform sampler2D uCaustics;
        uniform float uCausticsSize;
        uniform float uCausticsOn;
        uniform vec3 uSunColor;
        uniform vec3 uSunDir;
        varying vec3 vCausticWorldPos;
        void main() {`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        if (uCausticsOn > 0.5 && vCausticWorldPos.y < 0.0) {
          vec2 cuv = vCausticWorldPos.xz / uCausticsSize + 0.5;
          if (all(greaterThan(cuv, vec2(0.0))) && all(lessThan(cuv, vec2(1.0)))) {
            float c = texture2D(uCaustics, cuv).r;
            float d = -vCausticWorldPos.y;
            // Fade in just below the waterline, fade out with depth (light gets absorbed).
            float fade = smoothstep(0.0, 0.3, d) * exp(-d * 0.28) * max(uSunDir.y, 0.0);
            totalEmissiveRadiance += diffuseColor.rgb * uSunColor * max(c - 0.75, 0.0) * 1.1 * fade;
          }
        }`,
      );
  };
  material.customProgramCacheKey = () => 'caustics';
}
