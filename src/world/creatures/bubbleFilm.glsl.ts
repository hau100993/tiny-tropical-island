/**
 * Soap-film colour shared by Bọt's giant bubble and the manta's hunt bubbles.
 *
 * `bubbleFilm(n, v, local, time, dayLight)` → (colour, alpha): the film's thickness (swirling)
 * and the angle you look through it pick a hue, like a real soap bubble; nearly clear face-on,
 * bright at the rim (Fresnel), a sharp highlight of the sky on top. `local` is the position on
 * the unit sphere (the thickness pattern follows the bubble, not the world).
 */
export const BUBBLE_FILM_GLSL = /* glsl */ `
vec3 hue(float h) {
  return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
}
vec4 bubbleFilm(vec3 n, vec3 v, vec3 local, float time, float dayLight) {
  float c = abs(dot(n, v));
  float fres = pow(1.0 - c, 2.5);
  float thick = local.y * 1.3 + sin(local.x * 4.0 + time * 0.9) * 0.35 + sin(local.z * 5.0 - time * 0.7) * 0.25;
  vec3 film = hue(fract(thick + c * 0.8 + time * 0.05)) * 0.8 + 0.2;
  float spec = pow(max(0.0, dot(reflect(-v, n), normalize(vec3(0.3, 1.0, 0.2)))), 60.0);
  float a = 0.06 + fres * 0.75 + spec;
  vec3 col = film * (0.4 + 0.8 * fres) * (0.45 + 0.55 * dayLight) + spec * 1.6;
  return vec4(col, clamp(a, 0.0, 1.0));
}
`;
