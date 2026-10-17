# Tropical Soundscape World — Đảo Nhiệt Đới

A local web app for Windows 11 that you leave open while you work: a small stylized tropical
island with GPU water, weather, day/night and an ambient sound mixer. Fully offline, no backend.

> Status: **Phase 1b** — island, palm forest, stilt house, props, orbit camera, and the water:
> Gerstner swell + GPU ripple simulation, refraction, caustics, shore foam.
> See [PLAN.md](PLAN.md) for the roadmap.

## Run

Requires Node.js 20+ (tested with 22.14) and Chrome or Edge.

```powershell
npm install
npm run dev        # opens http://localhost:5173 in your browser
```

Other scripts:

| Command | What it does |
|---|---|
| `npm run build` | Type-check + production build into `dist/` |
| `npm run preview` | Serve the built `dist/` locally (works offline) |
| `npm test` | Unit tests (Vitest) |

## Controls

| Input | Action |
|---|---|
| Left-drag | Rotate the camera |
| Wheel / pinch | Zoom |
| Right-drag | Pan |
| Click on the water | Splash: ripples spread and bounce off the beach |
| `` ` `` (backquote) | Show/hide the stats panel |
| `L` | Toggle low-power mode (30 fps, Low-level water, no shadows) |

The stats panel (top left) shows FPS, CPU and GPU time per frame, draw calls and triangles,
and lets you switch quality (Thấp / Vừa / Cao), low power, auto-rotate and wave strength
("Sóng biển"). Settings are saved in `localStorage`. Anti-aliasing changes between Low and the
other presets apply after a page reload.

### What the quality presets change

| | Thấp (Low) | Vừa (Medium) | Cao (High) |
|---|---|---|---|
| Ripple simulation grid | 128² | 256² | 512² |
| Refraction (see the seabed bend through the water) | off (transparent water) | on | on |
| Caustics (light patterns on the seabed) | off | 384² | 512² |
| Shadows | off | 1024² | 2048² |
| Max pixel ratio | 1.0 | 1.25 | 1.5 |

## How the water works (short version)

- **Swell:** 5 Gerstner waves computed in the vertex shader; they fade out in shallow water and far away.
- **Ripples:** a 200 m × 200 m height grid lives in a GPU texture. Each step, every cell
  accelerates toward the average of its 4 neighbors (the discrete wave equation). Two textures
  are swapped every step (double buffering). Land cells are pinned to zero, so ripples reflect.
- **Refraction:** the scene without water is rendered at half resolution; the water shader
  samples it, shifted by the surface normal and tinted by how much water the view ray crosses.
- **Caustics:** a fine grid of "sun rays" is refracted through the surface and drawn where it
  lands on the seabed; where rays converge, triangles shrink and get brighter.

Rendering stops completely while the tab is hidden; the panel shows how long the last pause was.

## Project layout

```
src/
  core/      app wiring, render loop, settings, quality presets, shared uniforms, noise/RNG
  world/     heightmap, terrain, palms, house, props, sky, lighting
  water/     Gerstner swell, ripple simulation, refraction capture, caustics, floating objects
  controls/  orbit camera, water clicks, keyboard shortcuts
  ui/        Vietnamese strings, debug overlay, styles
tests/       unit tests for pure logic
```

Everything is procedural (geometry, colors, sky, water): there are no texture, model or audio
files in the repo.

## Credits and licenses

| Item | License | Notes |
|---|---|---|
| [three.js](https://threejs.org) 0.186.1 (incl. `OrbitControls`, `BufferGeometryUtils`, `FullScreenQuad`) | MIT | runtime dependency |
| [Vite](https://vite.dev), [TypeScript](https://www.typescriptlang.org), [Vitest](https://vitest.dev) | MIT / Apache-2.0 / MIT | dev tools only |
| Simplex noise | public domain | reimplemented after Stefan Gustavson's reference |
| Gerstner waves | — | technique from *GPU Gems* (2004), ch. 1 |
| [WebGL Water](https://madebyevan.com/webgl-water/) by Evan Wallace | MIT | the heightfield ripple simulation (drop + update passes) and the caustics-by-area-ratio technique are reimplemented after it in `src/water/` |
