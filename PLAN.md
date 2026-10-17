# PLAN.md — Tropical Soundscape World

> Approved 2026-10-17. Kept updated with a status line per phase.

## Status

| Phase | Status | Notes |
|---|---|---|
| 1a Island + orbit | ✅ Done (2026-10-17), awaiting feedback | Measured on RX 6600 (Medium, 1600×900): GPU ≈ 2.2 ms, CPU ≈ 0.7 ms per frame, 32 draw calls, 482k triangles incl. shadow pass. Bundle 153 KB gzip. Grass deferred to Phase 3 (it only matters once wind exists). Added a GPU/CPU timer to the debug overlay. |
| 1b GPU water | ✅ Done (2026-10-17), awaiting feedback | Heightfield sim (200 m square, ping-pong half-float), click ripples that reflect off the beach, screen-space refraction (half-res scene capture), Wallace-style caustics on seabed and rocks, foam on ripple crests, wave-strength slider (temporary home: stats panel). GPU per frame on RX 6600 @ 1600×900: Low ≈ 2.0 ms, Medium ≈ 3.1 ms, High ≈ 3.9 ms (whole frame, all passes). |
| 2 Audio + mixer | ✅ Done (2026-10-17), awaiting feedback | One AudioContext (created on the start-screen click), 5 synthesized layers behind a shared `AudioLayer` interface, look-ahead scheduler (1.5 s visible / 75 s hidden), snow muffle via shared lowpass, Vietnamese control panel (mixer, presets, scene, shortcuts), user presets + mix persisted. Levels balanced by measurement (solo RMS at 70%: waves −30, wind −28, rain −29, birds −35, snow −41 dBFS; all layers at max peak 0.96 before the limiter). Also pulled forward from Phase 6: `M`/`P`/`H` shortcuts and the hide-UI view. |
| 3 Weather | ✅ Done (2026-10-17), awaiting feedback | Deterministic gust function shared by shaders and wind audio; vertex-shader sway for palms (trunk bend + frond flutter, swaying shadows via custom depth materials) and 40k-blade instanced grass; GPU rain/snow particles (camera-anchored world-space wrap, draw-range intensity); rain rings in the ripple sim + pitting in the water shader; wetness/puddles/snow cover via one `patchWorldMaterial`; sleet rules unit-tested; overcast greys sky, fog and sun; "Tách hình/âm" with separate visual sliders. Storm GPU per frame (RX 6600, 1600×900): Medium ≈ 4.3 ms, High ≈ 4.6–8.4 ms. |
| 3+ Forest overhaul (user request) | ✅ Done (2026-10-17), awaiting feedback | Replaced the ~380-palm forest with 12 species in ecological zones (coast palms; garden of banana, papaya, mango/breadfruit, frangipani, hibiscus; rainforest canopy incl. flowering variant, emergent giants with buttress roots, tree ferns; understory shrubs, ferns, heliconia) + 4-color wildflower meadows; dark mossy forest floor. One shared plant material with baked per-vertex `aSway`/`aTip` (replaces the palm-only sway). Vegetation is skipped in the refraction capture. GPU per frame: Low ≈ 3.3, Medium ≈ 4.4, High ≈ 4.9 ms; 68 draw calls at Medium. |
| 4 Day/night | ✅ Done (2026-10-17), awaiting feedback | Clock with 4 modes (real / 24 min / 6 min / paused) + time slider + `N`; sun/moon paths and a keyed sky palette (night → twilight → golden hour → day) blended with weather overcast; main light switches sun ↔ moon; house windows + porch PointLight. Sky shader: drifting clouds with self-shadow, silver lining and sunset tint; stars (2 layers, twinkle, rotation) + Milky Way; aurora curtains; shooting stars; physically placed rainbow after rain. Cloud shadows on land and sea (per-vertex). Water/foam/rain dim at night, moon glint path. Fireflies; birds → crickets at night. Extra user-requested sky options: clouds, gloom, rainbow, stars, meteors, aurora, fireflies. GPU (Medium, RX 6600): day ≈ 6 ms, night ≈ 2–8 ms. |
| 5 First-person | ⏳ Next | |
| 6 Files, Pomodoro, polish | — | |

**Deviations from the plan so far**
- Vitest 5.0.5 instead of 4.x/3.x: npm 10.9 crashes resolving vitest 4.1's optional peers, and vitest 3.2 has published advisories (dev-only, but avoided anyway).
- Water mesh stays one fixed radial grid (~155k triangles) on all presets: measured cost is negligible, so per-preset meshes weren't worth the complexity.
- **Planar reflection (High) deferred to Phase 6.** All presets reflect the procedural sky for now. Reflections of palms/house would add a full extra scene pass; better judged during the perf pass with weather and day/night in place.
- Medium caustics texture is 384² (not 256²): at 256² the caustic network blurred into blobs; the cost difference is < 0.2 ms.
- Ripples are tuned for orbit-distance readability: 6 m/s travel speed, 3 m drops, slopes amplified ×4 in shading. Real ripples at island scale would be invisible from 100 m.
- Caustics use amplified sub-geometry ripples (not the Gerstner swell) because visible focusing at 1–4 m depth needs stronger curvature than the visible surface has.
- Debug: `window.__tsw` exposes the running App in `npm run dev` only (stripped from builds).
- Stats overlay is now stats-only and hidden by default (`` ` ``); quality/low-power/auto-rotate/wave controls moved into the control panel.
- Wind gusts are generated inside the wind layer for now; Phase 3 moves the gust source into `weather/wind.ts` so sound and swaying palms share it.
- Rain droplets are pre-rendered loops instead of per-drop scheduled nodes: no scheduling cost, nothing to stall in hidden tabs.
- Triangle budget: the "< 600k" in §6 is per scene pass. The stats overlay counts all passes of a frame (shadow + refraction capture + main), so it shows ~1.2M at Medium in a storm; measured GPU time is the number that matters and stays well under budget.
- Overcast (grey sky/fog, dimmer sun) is applied by the weather system in Phase 3 as a simple blend; Phase 4's day/night palette will take over the base colors and keep the overcast blend on top.
- Rain is not yet discarded under the house roof; that only matters in first-person (Phase 5), together with indoor muffling.

## 0. Context

A local, offline Windows 11 web app left open while working: a small stylized tropical island with GPU water, weather, day/night, and a synthesized ambient sound mixer. Greenfield repo (only `CLAUDE.md` exists). UI in Vietnamese; code/comments/docs in English.

**Decisions from Q&A (2026-10-17)**
| Topic | Decision |
|---|---|
| Runtime | Plain Chrome/Edge tab (no Lively/Wallpaper Engine integration) |
| GPU | AMD RX 6600 → default preset **Medium**; High expected to hold 60 fps at 1080p–1440p |
| Water | **Hybrid**: GPU heightfield sim over the island region + analytic Gerstner waves for the far sea |
| Style | **Mix**: flat-shaded terrain/rocks/house, smoother shading for palms/leaves and water |
| Island | Small, ~150 m across, no LOD system |
| House | Stilt house: 1 enterable room + wooden porch |
| Weather ↔ audio | Linked by default; "Tách hình/âm" toggle reveals separate visual sliders |
| UI | Vanilla TS + CSS, no framework |

---

## 1. Architecture

```
main.ts
  └─ App (core/)
       ├─ Loop ............ rAF, frame limiter (60/30), pauses when document.hidden
       ├─ Settings ........ typed, versioned localStorage store (+ migration)
       ├─ EnvState ........ single source of truth: targets + smoothed values
       │                    { timeOfDay, rain, snow, wind, gust, waveStrength,
       │                      wetness, snowCover, overcast, indoor, ... }
       ├─ SharedUniforms .. one object of THREE uniforms referenced by all materials
       ├─ World (world/) .. terrain, palms, grass, house, props, sky, lighting
       ├─ Water (water/) .. sim + surface + caustics + refraction
       ├─ Weather (weather/) rain/snow particles, wind gusts, accumulation rules
       ├─ Audio (audio/) .. AudioEngine, layers, mixer, presets, spatial, footsteps
       ├─ Controls (controls/) orbit + first-person + collision + keymap
       └─ UI (ui/) ........ start screen, panel, Pomodoro overlay, debug overlay
```

**Data flow (one direction, no circular deps):**
UI / presets / Pomodoro → write *targets* into `EnvState` and mixer state → each frame `EnvState.update(dt)` smooths targets (exponential ease, no pops) → subsystems read smoothed values → GPU via `SharedUniforms`, audio via `setTargetAtTime`.

**Key pattern — shader chunk patching.** All world materials (MeshStandard/Lambert) get one `patchMaterial(mat, opts)` via `onBeforeCompile` that injects: wind sway (vertex), wetness darkening + sheen, snow cover, caustics (underwater), night window emission. One place for weather visuals; per-object JS updates are zero. Three.js version is pinned exactly because chunk names can change between releases.

*For a C/C++ mind:* a uniform is like a read-only global register the GPU sees for a whole draw call; the vertex shader runs per vertex in parallel, so "sway every leaf" costs one uniform write per frame, not a loop over 50k objects. The water sim's "ping-pong" textures are double buffering: read state N from texture A, write N+1 into B, swap.

---

## 2. Folder structure

```
index.html
vite.config.ts            # + local audio-manifest plugin
vite-plugins/audioManifest.ts
src/
  main.ts
  core/        App.ts, loop.ts, settings.ts, envState.ts, uniforms.ts,
               quality.ts, events.ts, rng.ts (seeded), noise.ts (simplex, own impl)
  world/       heightmap.ts (CPU height/surface/shore-distance/forest-density grids)
               terrain.ts, palms.ts, grass.ts, bushes.ts, house.ts, props.ts,
               sky.ts, dayNight.ts, lighting.ts, patchMaterial.ts, shaders/*.glsl
  water/       WaterSim.ts, WaterSurface.ts, gerstner.ts (GPU + CPU twin for boat bob),
               Caustics.ts, SceneCapture.ts (refraction RT), shaders/*.glsl
  weather/     Weather.ts (blend + accumulation rules), rain.ts, snow.ts, wind.ts (gusts)
  audio/       AudioEngine.ts, Layer.ts (interface), LayerSlot.ts (synth↔file switch),
               noiseBuffers.ts, synth/{waves,wind,rain,birds,snowQuiet,footsteps,chime}.ts,
               file/{configLoader.ts, FileLayer.ts}, mixer.ts, presets.ts, spatial.ts
  controls/    CameraManager.ts, orbit.ts, firstPerson.ts, collision.ts, keymap.ts
  ui/          strings.vi.ts, Panel.ts, components/{Slider,Toggle,Section,Button}.ts,
               StartScreen.ts, PomodoroOverlay.ts, pomodoro.ts, DebugOverlay.ts, styles.css
tests/         settings migration, pomodoro state machine, weather blend rules, preset I/O
public/audio/  config.json (ships with empty file lists), README.md
README.md, PLAN.md, CLAUDE.md
```
`core/` is added beyond CLAUDE.md's list: loop/settings/state are shared by every module and don't belong to any one of them. GLSL is imported with Vite's built-in `?raw` (no plugin).

---

## 3. Tech choices

| Choice | Why | License |
|---|---|---|
| Vite + TypeScript (strict) | Fast dev server, zero-config TS, `?raw` shader imports, static build that works offline | MIT / Apache-2.0 |
| three (pinned exact version) | Mature WebGL2 renderer, InstancedMesh, shadow maps, `OrbitControls`/`PointerLockControls` in `examples/jsm` | MIT |
| WebGL2 only (no WebGPU) | Chrome/Edge on Win11 fully support it; float render targets via `EXT_color_buffer_float`; WebGPU adds risk for no visible win here | — |
| Web Audio API, no library | Everything needed (noise buffers, biquad filters, LFOs, panners) is native; one `AudioContext` | — |
| No AudioWorklet initially | Buffer-based noise + scheduled one-shots is cheaper to build and debug; worklet only if CPU profiling demands it | — |
| Vanilla TS UI | Small panel, full control over look, easy Vietnamese strings in one file | — |
| Vitest (dev only) | Unit tests for pure logic (state machines, migrations, blend rules) | MIT |
| Own simplex noise + seeded RNG | ~80 lines, avoids a dependency, same island every launch | — |

Water technique credit: Evan Wallace, *WebGL Water* (MIT) — heightfield wave-equation update, drop shader, and caustics-by-area-ratio idea are reimplemented in our own GLSL; credited in README and in `water/` file headers.

---

## 4. Subsystem design (short)

**Terrain & island.** 160×160 m heightfield (≈256² grid) from radial falloff × fBm simplex noise; bands: seabed → sand → grass → small hill. Flat-shaded non-indexed mesh, vertex colors. CPU keeps the Float32 height grid plus derived grids: surface type (sand/grass), distance-to-shore, forest density. Same grid uploads as a texture for water depth/foam/sim walls.

**Vegetation.** Procedural palm (curved trunk segments + bent-plane fronds), ~400 instances via `InstancedMesh`, per-instance phase/scale in instance attributes. Grass blades instanced (count per preset). Wind sway in vertex shader weighted by height on trunk / distance along frond.

**House & props.** Code-built geometry: stilts, floor, plank walls with window holes and a door gap, thatch-ish roof, porch + steps. Boat (extruded hull, bobs using CPU Gerstner twin), umbrella, flat-shaded rocks (jittered icosahedra).

**Water (hybrid).**
- *Sim region:* 200×200 m square centred on the island, ping-pong RGBA16F textures, resolution by preset. Passes per frame: drops (batched: up to 16 click/rain drops per pass via uniform array) → wave update (1–2 steps) → normals. Terrain mask makes land act as walls, so ripples reflect off the shore.
- *Far sea:* 4–6 Gerstner waves in the vertex shader; amplitude/choppiness from wave strength + wind. Sim height added on top inside the region, faded to zero at its edges.
- *Shading:* Fresnel mix of reflection and refraction. Refraction = opaque scene captured to a half-res RT, sampled with normal offset + depth-based absorption tint. Reflection = procedural sky lookup (Low/Med), planar reflection at half-res limited to sky+terrain+house layers (High).
- *Caustics:* Wallace's method (refracted-grid area ratio via `dFdx/dFdy`) rendered into a texture, projected top-down along the sun direction onto underwater terrain (approximation; the seabed isn't a flat pool floor).
- *Foam:* shallow depth (water height − terrain height) × wave crest × noise.

**Sky & day/night.** Custom sky dome shader: gradient from sun elevation, sun/moon discs, hashed stars fading in at night, cheap noise clouds whose cover follows `overcast` (driven by rain/snow). Palette keyframes (dawn/noon/dusk/night) for sun color, hemi light, fog, water tint. Speeds: paused / real clock / 1 day = 24 min / 1 day = 6 min, plus a time slider. Windows emissive + one interior PointLight ramp in at dusk.

**Weather.**
- *Wind:* slider + JS gust generator (low-freq noise → `uGust`). The **same gust value** drives vegetation sway, sea choppiness, rain slant, snow drift, and the wind audio filter, so what you see and hear moves together.
- *Rain:* instanced streaks in a camera-following box, animated fully in the vertex shader (`fract(seed − t·speed)` wrap); active count = max × intensity via `instanceCount`. Discarded inside the house roof AABB. Feeds random drops into the water sim. `wetness` rises in ~30 s, dries in ~2 min → darker albedo, lower roughness, puddle sheen on flat sand (noise mask × normal.y).
- *Snow:* instanced soft quads with wobble + wind drift. `snowCover` accumulates over ~90 s, melts slower; shader whitens by normal.y × noise × cover (leaves and roofs too; never on water).
- *Rain + snow blend rule:* both on = sleet. Particles of both at scaled counts; snow cover only grows when snow > rain, otherwise it melts and adds to wetness. Audio plays both. Documented and unit-tested.
- *Linking:* visual intensity = layer volume × on/off switch. **Mute affects audio only** (the rain stays visible). With "Tách hình/âm" on, separate visual sliders appear.

**Audio.**
- Graph: layers → layer gain → *ambience bus* (shared lowpass used for "snow muffle" and indoor muffle) → master gain → compressor → destination.
- `Layer` interface: `setVolume`, `setEnabled`, `setMuted`, `setSpatialGain`, `dispose`. `LayerSlot` holds the synth version and optionally a file version and crossfades between them.
- Synth recipes: shared pre-generated white/pink/brown noise buffers (looped from random offsets).
  - Waves: brown noise → lowpass with a slow randomized LFO (6–10 s swells) + high-band wash on each swell.
  - Wind: pink noise → bandpass whose frequency/gain follow `uGust`; plus a rustle layer (high-pass + AM).
  - Rain: filtered noise bed + lookahead-scheduled droplet ticks at a rate ∝ intensity.
  - Birds: scheduled chirps (oscillator + frequency/gain envelopes, 3–4 species patterns, random stereo pan); density drops at night.
  - Snow-quiet: very soft low rumble + it pulls the ambience-bus lowpass down (snow absorbs sound).
  - Footsteps: sand (soft low crunch), grass (brighter rustle), wood (low thump + click), shallow water (splash with longer tail); triggered by distance walked.
- Disabled layers stop their nodes (no hidden CPU cost). All gain changes use `setTargetAtTime` (no clicks).
- Spatial (first-person only, cheap, no HRTF): gain from CPU grids — waves by distance-to-shore (and pan toward the nearest shore relative to view yaw), birds by forest density, rain lowpassed + quieter when `indoor`. Orbit mode = neutral mix.
- Start screen: "Bắt đầu" button resumes the `AudioContext`; the scene already renders behind it.
- Presets: built-in "Tập trung", "Bão", "Tuyết yên tĩnh", "Bình minh yên ả"; user presets saved/deleted in localStorage (preset = mixer + weather + optional time of day).

**Optional audio files.**
`public/audio/config.json`:
```json
{ "layers": { "waves": { "files": [ { "src": "waves/beach1.ogg", "gain": 0.8, "loop": true,
      "loopStart": 0, "loopEnd": null } ], "crossfadeSec": 4, "rotateEverySec": [60, 180] } } }
```
- A small Vite plugin writes `audio-manifest.json` (files actually present under `public/audio`) in both dev and build. The loader only fetches config entries that exist, so a missing file never causes a red 404 in the console. Decode failures → `console.info` + keep the synth.
- Loops use `AudioBufferSourceNode.loop` with optional loopStart/loopEnd (MP3 encoder padding causes gaps; README recommends OGG or trimmed WAV→OGG). Multiple files → random equal-power crossfades.
- README lists sources (Freesound with a CC0 filter, Sonniss GDC bundles, BBC Sound Effects (personal-use licence only)) and says to check every file's licence.

**Pomodoro.** Pure state machine (focus/break, configurable 25/5, optional long break) based on `Date.now()` deltas. The chime is **scheduled on the AudioContext clock** at the exact end time, because Chrome throttles hidden-tab timers to about once per minute. "Bão dịu đi khi nghỉ": during breaks weather targets ease to 30% over 20 s and are restored afterwards.

**Controls.** `OrbitControls` (damping, zoom limits, optional auto-rotate). First-person: `PointerLockControls` for look, own movement: WASD 1.6 m/s, Shift 4 m/s, eye height 1.65 m, bilinear terrain sampling with smoothing. Collision: 2D circles (trunks, rocks) in a spatial hash + house wall AABBs with a door gap. Walkable floor boxes for porch/room/steps (ramp). Water depth > 0.9 m blocks movement (slides along the limit). Spawn on the beach near the house. Esc (pointer-lock release) → back to orbit. Head-bob disabled under reduced motion.

**Keyboard shortcuts** (listed in the panel): `C` camera mode · `H` hide/show UI · `P` collapse panel · `M` mute all · `T` Pomodoro start/pause · `N` pause day cycle · `L` low power · `` ` `` debug overlay.

---

## 5. Quality presets & low power

| | Low | Medium (default) | High |
|---|---|---|---|
| Water sim | 128² | 256² | 512² |
| Reflection | sky only | sky only | planar ½-res |
| Refraction RT | off (tint only) | ½-res | ½-res |
| Caustics | off | 384² | 512² |
| Shadows | off | 1024, PCF | 2048, PCF soft |
| Grass blades | 4k | 15k | 40k |
| Rain / snow max | 3k / 2k | 10k / 6k | 25k / 15k |
| Pixel ratio cap | 1.0 | 1.25 | 1.5 |
| MSAA | off | on | on |

**Low power mode:** 30 fps limiter, forces Low-level water/particles, sim stepped every other frame, pixel ratio 1.0. **In every mode, rendering stops while the tab is hidden**; audio and Pomodoro keep running. `prefers-reduced-motion`: auto-rotate off by default, no head-bob, slower default day cycle, no UI animations.

## 6. Performance budget (Medium, 1080p, RX 6600; 16.6 ms frame)

| Item | Budget |
|---|---|
| Water sim passes | ≤ 0.5 ms GPU |
| Water surface + refraction capture | ≤ 3 ms GPU |
| Terrain + vegetation + house | ≤ 3 ms GPU |
| Shadow pass | ≤ 1.5 ms GPU |
| Rain/snow particles | ≤ 1 ms GPU |
| JS per frame | ≤ 2 ms, zero allocations in the loop |
| Draw calls / triangles | < 120 / < 600k |
| GPU memory | < 200 MB |
| Audio | < 3% of one CPU core, < 150 live nodes |
| JS bundle | < 450 KB gzip; repo (no node_modules) < 2 MB |

Checked via the debug overlay (fps, frame ms, `renderer.info` draw calls/triangles; GPU timer query when `EXT_disjoint_timer_query_webgl2` is available) and Edge/Chrome performance traces.

---

## 7. Phased roadmap (each phase ends runnable, build-clean, no console errors)

| Phase | Deliverable | What you test |
|---|---|---|
| **1a** Island + orbit | Scaffold (Vite/TS strict, loop with hidden-tab pause + 30 fps limiter, settings, debug overlay). Terrain, palms, house, props, static sun/sky, Gerstner sea with simple shore foam, orbit camera | `npm install && npm run dev` → orbit/zoom around the island; switch tabs, see in the overlay that rendering paused; ~60 fps |
| **1b** GPU water | Heightfield sim region, click ripples, refraction, caustics, sky reflection, wave-strength slider, quality preset skeleton (water res) | Click water → rings that reflect off the beach; caustics on shallow sand; slider changes the sea; Low/Med/High in the overlay |
| **2** Audio + mixer | AudioEngine, 5 synth layers, start screen, Vietnamese panel (volume/mute/on-off/master), presets + user presets in localStorage | Start button → sound; every slider/mute/switch works without clicks; save a preset, reload the page, it's still there |
| **3** Weather | Wind gusts (vegetation, grass, sea, audio), rain (particles, ripples, wetness, sheen), snow (particles, cover), sleet blend, link/unlink toggle | "Bão" preset → rain, ripples, sand darkens; wind sways palms in sync with the gust sound; snow slowly whitens the island; rain + snow → sleet, no fight |
| **4** Day/night | Sky shader, palette, stars, moon, clouds tied to overcast, windows + interior light, birds fade at night | Speed up the cycle: smooth dawn/dusk, stars at night, house lights on; pause works |
| **5** First-person | Pointer lock, WASD/Shift, terrain following, collision, house interior/porch, deep-water limit, footsteps by surface, spatial audio, indoor rain muffle | `C` → walk; can't pass trunks/walls/deep water; footsteps change on sand/grass/wood/shallows; waves louder at the shore; rain muffled indoors; Esc → orbit |
| **6** Files, Pomodoro, polish | Audio config + manifest plugin + crossfades, Pomodoro overlay + chime + "storm calms", final quality presets, low power, reduced motion, hide-UI, shortcuts, README, perf pass | Drop an OGG into `public/audio`, edit config → real sound; delete it → synth, no red errors; Pomodoro chimes while the tab is hidden; `H` gives a clean wallpaper view; Low power holds 30 fps |

After each phase: `npm run build` passes, PLAN.md status updated, README updated, and I give you exact run/test steps, then wait for your feedback.

---

## 8. Risks & mitigations

1. **Hybrid water is the hardest part.** Split into 1a (Gerstner only) and 1b (sim). If sim + Gerstner blending looks seamy at the region edge, fall back to sim near shore + Gerstner far, with a wider fade.
2. **Float render targets.** Check `EXT_color_buffer_float` at startup and fall back to HalfFloat (always fine on RX 6600, but kept for robustness).
3. **Caustics on uneven seabed** are an approximation (top-down projection). It looks right in the shallows, which is where you see them.
4. **Planar reflection doubles scene cost.** High only, half-res, reduced layer mask.
5. **Synthesized birds/rain can sound "synthetic".** Will iterate on the recipes. The file config is the realism escape hatch; I'll be upfront if a layer stays stylized.
6. **Missing audio files → console 404s** contradict "no errors". Solved by the manifest plugin (only existing files are fetched).
7. **Hidden-tab timer throttling** would delay the Pomodoro chime → schedule it on the AudioContext clock.
8. **Pointer lock quirks** (re-lock cooldown after Esc, needs a gesture): handle `pointerlockerror`, show a "Nhấp để tiếp tục" hint.
9. **`onBeforeCompile` chunk names change across three.js versions** → pin the exact version; all patching lives in `patchMaterial.ts`.
10. **Transparent ordering** (rain/snow vs water): explicit `renderOrder`; particles depth-test against the water.

## 9. What I will NOT do

- No backend, accounts, network calls, CDN, analytics, or telemetry.
- No Lively/Wallpaper Engine/Electron packaging (possible later as a separate mode).
- No WebGPU, no FFT/Tessendorf ocean, no volumetric clouds, no bloom/post-processing stack.
- No swimming, jumping, visible animals/NPCs (birds are audio-only), and no physics engine.
- No shipped audio files, textures, or 3D models: everything is procedural.
- No mobile/touch tuning beyond what OrbitControls gives for free (pinch works, not optimized).
- No i18n framework: Vietnamese strings live in `ui/strings.vi.ts`.

## 10. Verification (every phase)

- `npm install && npm run dev` on Windows 11 in Chrome and Edge; DevTools console has no errors or warnings from our code.
- `npm run build` and `npx vitest run` pass; `npm run preview` works offline (DevTools Network set to "Offline").
- Debug overlay shows ≥ 60 fps at Medium (≥ 30 in Low power); tab-hidden pause confirmed.
- Phase-specific checklist from §7.
