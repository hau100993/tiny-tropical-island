# CLAUDE.md — Tropical Soundscape World

## Project
A local web app for Windows 11 that I leave open while I work: an immersive 3D tropical island with a sound mixer. It runs fully offline with no backend.

- UI text: Vietnamese (except Thú Cưng Levels, Ranks and skill names: English). Code, comments, commit messages, docs: English.
- Reply to me in Vietnamese unless I write in English.
- I am an embedded engineer (C/C++ background), new to web graphics. Explain shader and WebGL decisions briefly and concretely.

## Tech stack
- Vite + TypeScript + Three.js. Do not add a UI framework unless the plan justifies it.
- Run: `npm install && npm run dev`. Build: `npm run build`. Both must always work.
- No CDN at runtime. No network calls, except the opt-in Google Drive sync (Phase 13s), loaded only after the user turns it on. Settings persist in `localStorage`.
- Target: Chrome/Edge on Windows 11, mid-range GPU, 60 fps.

## Folder structure
```
src/
  world/      terrain, island, forest, house, props, day/night, sky
  water/      GPU heightfield water (WebGL Water style)
  weather/    rain, snow, wind, wetness/snow-cover shaders
  audio/      Web Audio engine, synthesized layers, mp3 loader, presets
  controls/   orbit camera, first-person controller, input
  ui/         control panel, start screen, Pomodoro overlay
  main.ts
public/audio/ optional user mp3/ogg files + config.json
PLAN.md       approved plan and roadmap (keep updated)
```

## Feature requirements (summary)
1. **World:** low-poly tropical island: beach, palm forest, wooden house, sea, props (boat, umbrella, rocks). Procedural geometry and shaders first; avoid large assets.
2. **Water:** GPU heightfield simulation in the style of Evan Wallace's WebGL Water (MIT, credit it in README): ripples on click and from rain, reflection/refraction, caustics, shore foam, adjustable wave strength.
3. **Camera:** Orbit mode (drag, wheel/pinch, optional auto-rotate) and first-person mode (pointer lock, WASD, Shift run, terrain following, collision, limited wading, Esc to exit). Footsteps vary by surface.
4. **Day/night:** smooth cycle, adjustable speed, pausable. Stars and lit windows at night.
5. **Weather and scene presets** (changed in Phase 7): rain (particles, water ripples, wet look), wind (sway of leaves, grass, sea, done in vertex shaders), snow (falling flakes, gradual white cover). Rain and snow blend sensibly. Scene presets set these effects and the sky (built-in + user-saved).
6. **Sound (Web Audio)** (changed in Phase 7): the user's own recordings, copied into IndexedDB and streamed, each played on its own or mapped to scene presets (per-preset volume). Synthesized layers (waves, birds, wind, rain, quiet snow) are the fallback whenever no recording plays, following the scene. Master volume and mute.
   - Default: everything synthesized in code (filtered noise + LFOs; randomized oscillator chirps for birds).
   - Optional realism: `public/audio/config.json` maps each layer to my own mp3/ogg files (gain, loop, random crossfade). Missing or failed file means silent fallback to the synthesized sound, with no errors.
   - Audio starts only after a user gesture (start screen).
   - Spatial touch in first-person: louder waves near shore, louder birds near forest, muffled rain inside the house.
7. **Pomodoro:** small overlay, 25/5 default and configurable, gentle chime, optional "storm calms down during breaks".
8. **Quality:** Low/Medium/High presets (water resolution, particles, shadows, pixel ratio). Stop rendering when the tab is hidden. ("Low power" mode was removed on request, 2026-10-19.) Hide-UI key for a clean wallpaper view. Respect `prefers-reduced-motion`.

## Working rules
- Work in phases from `PLAN.md`. After each phase tell me exactly how to run it and what to test, then wait for my feedback before continuing.
- Suggested phase order: (1) island + orbit camera + water, (2) audio engine + mixer UI, (3) weather that reacts to the mixer, (4) day/night, (5) first-person mode, (6) mp3 config, Pomodoro, quality presets, polish.
- Keep modules small and typed. No `any` unless commented why.
- Do not rewrite working files wholesale; make focused edits.
- If a requirement is risky or too heavy, say so and propose a cheaper alternative. Do not silently cut features.
- Never add a dependency without stating why and its license.
- Any third-party asset or code must have its license recorded in `README.md`.
- Before declaring a phase done: run `npm run build`, fix type errors, and check there are no console errors.

## Performance rules
- Prefer GPU work (shaders, instancing) over per-object JS updates. Use `InstancedMesh` for trees, grass, and rain.
- Reuse geometries and materials; dispose what is removed.
- Avoid allocating objects inside the render loop.
- Cap pixel ratio (default 1.5) and expose it in the quality presets.

## Audio rules
- One shared `AudioContext`, resumed on first user gesture.
- Every layer exposes: `setVolume`, `setEnabled`, `dispose`. Synthesized and file-based versions share this interface.
- Loops must be seamless; avoid clicks by ramping gain (`setTargetAtTime`).
- Keep total synthesized CPU cost low; stop nodes of disabled layers.

## UI rules
- Collapsible panel, keyboard shortcuts (documented in the panel), hide-UI key.
- Light/dark friendly panel; scene is always the focus.
- Vietnamese labels, short and clear.

## Definition of done (per phase)
- Runs with `npm run dev` on Windows 11, no console errors.
- Meets the frame-rate target at the default quality preset.
- README updated with controls and any new config.
- `PLAN.md` updated with status and next steps.
