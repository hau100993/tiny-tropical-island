# PLAN.md — Tropical Soundscape World

> Approved 2026-10-17. Kept updated with a status line per phase.

## Status

| Phase                             | Status                                 | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1a Island + orbit                 | ✅ Done (2026-10-17), awaiting feedback | Measured on RX 6600 (Medium, 1600×900): GPU ≈ 2.2 ms, CPU ≈ 0.7 ms per frame, 32 draw calls, 482k triangles incl. shadow pass. Bundle 153 KB gzip. Grass deferred to Phase 3 (it only matters once wind exists). Added a GPU/CPU timer to the debug overlay.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 1b GPU water                      | ✅ Done (2026-10-17), awaiting feedback | Heightfield sim (200 m square, ping-pong half-float), click ripples that reflect off the beach, screen-space refraction (half-res scene capture), Wallace-style caustics on seabed and rocks, foam on ripple crests, wave-strength slider (temporary home: stats panel). GPU per frame on RX 6600 @ 1600×900: Low ≈ 2.0 ms, Medium ≈ 3.1 ms, High ≈ 3.9 ms (whole frame, all passes).                                                                                                                                                                                                                                                                                                                                                         |
| 2 Audio + mixer                   | ✅ Done (2026-10-17), awaiting feedback | One AudioContext (created on the start-screen click), 5 synthesized layers behind a shared `AudioLayer` interface, look-ahead scheduler (1.5 s visible / 75 s hidden), snow muffle via shared lowpass, Vietnamese control panel (mixer, presets, scene, shortcuts), user presets + mix persisted. Levels balanced by measurement (solo RMS at 70%: waves −30, wind −28, rain −29, birds −35, snow −41 dBFS; all layers at max peak 0.96 before the limiter). Also pulled forward from Phase 6: `M`/`P`/`H` shortcuts and the hide-UI view.                                                                                                                                                                                                    |
| 3 Weather                         | ✅ Done (2026-10-17), awaiting feedback | Deterministic gust function shared by shaders and wind audio; vertex-shader sway for palms (trunk bend + frond flutter, swaying shadows via custom depth materials) and 40k-blade instanced grass; GPU rain/snow particles (camera-anchored world-space wrap, draw-range intensity); rain rings in the ripple sim + pitting in the water shader; wetness/puddles/snow cover via one `patchWorldMaterial`; sleet rules unit-tested; overcast greys sky, fog and sun; "Tách hình/âm" with separate visual sliders. Storm GPU per frame (RX 6600, 1600×900): Medium ≈ 4.3 ms, High ≈ 4.6–8.4 ms.                                                                                                                                                 |
| 3+ Forest overhaul (user request) | ✅ Done (2026-10-17), awaiting feedback | Replaced the ~380-palm forest with 12 species in ecological zones (coast palms; garden of banana, papaya, mango/breadfruit, frangipani, hibiscus; rainforest canopy incl. flowering variant, emergent giants with buttress roots, tree ferns; understory shrubs, ferns, heliconia) + 4-color wildflower meadows; dark mossy forest floor. One shared plant material with baked per-vertex `aSway`/`aTip` (replaces the palm-only sway). Vegetation is skipped in the refraction capture. GPU per frame: Low ≈ 3.3, Medium ≈ 4.4, High ≈ 4.9 ms; 68 draw calls at Medium.                                                                                                                                                                      |
| 4 Day/night                       | ✅ Done (2026-10-17), awaiting feedback | Clock with 4 modes (real / 24 min / 6 min / paused) + time slider + `N`; sun/moon paths and a keyed sky palette (night → twilight → golden hour → day) blended with weather overcast; main light switches sun ↔ moon; house windows + porch PointLight. Sky shader: drifting clouds with self-shadow, silver lining and sunset tint; stars (2 layers, twinkle, rotation) + Milky Way; aurora curtains; shooting stars; physically placed rainbow after rain. Cloud shadows on land and sea (per-vertex). Water/foam/rain dim at night, moon glint path. Fireflies; birds → crickets at night. Extra user-requested sky options: clouds, gloom, rainbow, stars, meteors, aurora, fireflies. GPU (Medium, RX 6600): day ≈ 6 ms, night ≈ 2–8 ms. |
| 5 First-person                    | ✅ Done (2026-10-18), awaiting feedback | `C` / panel button → walk; pointer-lock look, WASD/arrows, Shift run (1.6 / 4 m/s), terrain + house floor/steps following with smoothed eye height, head bob (off with reduced motion). 2.5D collision (`controls/collision.ts`, unit-tested): trunks/rocks/umbrella pole as circles in a grid, walls/railings/furniture/stilts as height-ranged oriented boxes, floor and steps as platforms. Wading slows you down; stops at 0.9 m depth. Footsteps synthesized per surface (sand, grass, rock, wood, water, snow) + ripples when wading. Spatial mix per layer (gain/pan/low-pass): waves by distance to shore and panned toward the sea, birds by nearby trunks, wind sheltered in forest, everything muffled indoors (rain most). No rain/snow particles or wet/snow surfaces under the roof. Clear window glass by day, room lamp at night. Esc → back to orbit view. GPU (Medium, RX 6600, 1600×900): forest 2.7 ms, beach 2.6 ms, room at night 4.4 ms. |
| 5+ Third-person character (user request) | ✅ Done (2026-10-18), awaiting feedback | `V` switches walk view (default third person). Original low-poly explorer built in code (`world/avatar.ts`): 10 vertex-colored meshes on a small joint hierarchy, procedural gait driven by the walker's footfall phase (walk → run blend, knee lift, arm swing, run lean, idle breathing), faces the walking direction. Spring-arm camera (4.2 m behind the chest, pitch −1.2…0.45) shortened by ray tests against walls, lintel, roof, floor, trunks and terrain; never under the sea surface; character hidden when the arm is < 0.7 m. The user's reference image (`avatar.png`, third-party character art) is only a color/outfit reference, git-ignored and not shipped. |
| 6 Files, Pomodoro, polish         | ✅ Done (2026-10-18), awaiting feedback | Optional recordings per layer: `public/audio/config.json` + a Vite plugin that writes `audio-manifest.json` (dev, preview and build), so only existing files are fetched; `FileLayer` shares the synth layers' interface and output chain (volume, mute, walk-mode pan/muffle), loops with loop points, random equal-power crossfades between files, at most 2 decoded buffers per layer; a `LayerSlot` crossfades synth → file once the first file decodes and falls back if none do; "tệp" badge in the panel. Pomodoro: pure, unit-tested state machine (absolute end times, catch-up after sleep, long breaks), card UI with settings, countdown in the tab title, bell synthesized and scheduled on the audio clock (rings on time in a hidden tab, bypasses mute-all), "Bão dịu đi khi nghỉ" eases rain/wind/snow sound and visuals to 30 %, state persisted. Planar reflection on High (+~0.7 ms GPU, total ≈ 5.1 ms at 1600×900). Reduced motion: first run defaults to the real-time clock. Low power measured at 30.3 fps. 66 unit tests. |
| 7a Scene presets + sound library (user request) | ✅ Done (2026-10-18), awaiting feedback | Presets are now scenes (weather + sky effects, optional time of day; 7 built-in, up to 30 of your own, update/delete, "(đã chỉnh)" marker). "Âm thanh của tôi": recordings picked or dropped from the PC are copied into IndexedDB (persistent storage requested), streamed by `<audio>` through a MediaElementSource into the audio graph (master, mute, snow muffle, Pomodoro calm apply), played on their own and/or mapped to scene presets with a per-preset volume; switching scenes crossfades (~3 s). The synthesized layers are the fallback: they follow the scene sliders and fade out while any recording plays. Old mixer presets and the mixer/link UI removed; linked weather migrated once into the scene sliders. 69 unit tests. |
| 7c House + work desk (user request) | ✅ Done (2026-10-18), awaiting feedback | House rebuilt (`world/house.ts`): 7 × 5 m room on 1.6 m stilts, dark board cladding with pale oak lining, mono-pitch roof with 8 solar panels, Starlink dish, battery/inverter, floor-to-ceiling glass wall to the sea with a sliding door, deck with glass railing and side steps; Japanese-minimal interior (futon on tatami, sofa, coffee table, hinoki tub behind shoji, plants, sideboard, pendant and desk lamps, daytime fill light). The house now exports its own collision boxes, floor, stairs, room/roof rectangles and desk spot, so colliders can't drift from the mesh. Trees are excluded from a ±45° view wedge in front of the glass. Desk mode (`B` anywhere, `E` next to the chair; drag to look, scroll to lean in, `E`/`Esc`/`B` to get up; fade from afar, glide from nearby; optional start at the desk): two canvas monitors — a typing code editor and a dashboard (clock, Pomodoro, scene, playing, island time), redrawn only within 14 m. GPU at the desk ≈ 5 ms (Medium, day and night). 71 unit tests. |
| 7c+ Interior polish (user request) | ✅ Done (2026-10-18), awaiting feedback | Sofa replaced by a Japanese tea corner (chabudai, zabuton, teapot from three's TeapotGeometry, cups, books) by the left window, so the way in is clear; monstera with heart-shaped split/holed leaves on curved stems and a lathe pot; snake plant blades; low bookshelf; timber beams and baseboards; rounded, smooth-shaded soft furnishings (three's RoundedBoxGeometry); procedural wood grain (`wood` feature in patchMaterial, axes from the house frame); open stairs with stringers, treads, handrails and a stone pad. Interior split into `world/houseInterior.ts`. +~56k triangles per frame. |
| 7c++ Open bath (user request) | ✅ Done (2026-10-18), awaiting feedback | Shoji screens removed; big back window (1.7 × 1.6 m) onto the forest; hinoki tub under it with spout, rain shower (pipe, arm, square head, mixer, drain) on the side wall, slate tile floor, stool and bucket, towel rail, a fern on the sill. |
| 7c+++ Bath seat (user request) | ✅ Done (2026-10-18), awaiting feedback | Seated mode generalized to several seats (`CameraManager.sit(id)`, mode 'seat'): desk and bathtub. In the tub the eyes are 0.86 m above the floor, looking at the forest through the back window; `E` next to the tub or the panel button "Ngâm bồn tắm". |
| 7b New scene effects | ⏳ Next | Lightning (flash + bolts), campfire on the beach (shader flames, embers, flickering light, smoke), mist, drizzle ↔ downpour, falling leaves/petals, house lanterns, night fishing-boat lights, bright full moon. Each added to scene presets and shown for approval. Later phase: animals. Later: per-file "sound type" (thunder-synced flashes, positional campfire, indoor muffle for rain). |

**Deviations from the plan so far**
- Vitest 5.0.5 instead of 4.x/3.x: npm 10.9 crashes resolving vitest 4.1's optional peers, and vitest 3.2 has published advisories (dev-only, but avoided anyway).
- Water mesh stays one fixed radial grid (~155k triangles) on all presets: measured cost is negligible, so per-preset meshes weren't worth the complexity.
- **Planar reflection (High)** was deferred from Phase 1b and added in Phase 6: +~0.7 ms GPU on High (forest included, grass/flowers/particles skipped). Low and Medium keep the sky-only reflection.
- Medium caustics texture is 384² (not 256²): at 256² the caustic network blurred into blobs; the cost difference is < 0.2 ms.
- Ripples are tuned for orbit-distance readability: 6 m/s travel speed, 3 m drops, slopes amplified ×4 in shading. Real ripples at island scale would be invisible from 100 m.
- Caustics use amplified sub-geometry ripples (not the Gerstner swell) because visible focusing at 1–4 m depth needs stronger curvature than the visible surface has.
- Debug: `window.__tsw` exposes the running App in `npm run dev` only (stripped from builds).
- Stats overlay is now stats-only and hidden by default (`` ` ``); quality/low-power/auto-rotate/wave controls moved into the control panel.
- Wind gusts are generated inside the wind layer for now; Phase 3 moves the gust source into `weather/wind.ts` so sound and swaying palms share it.
- Rain droplets are pre-rendered loops instead of per-drop scheduled nodes: no scheduling cost, nothing to stall in hidden tabs.
- Triangle budget: the "< 600k" in §6 is per scene pass. The stats overlay counts all passes of a frame (shadow + refraction capture + main), so it shows ~1.2M at Medium in a storm; measured GPU time is the number that matters and stays well under budget.
- Overcast (grey sky/fog, dimmer sun) is applied by the weather system in Phase 3 as a simple blend; Phase 4's day/night palette will take over the base colors and keep the overcast blend on top.
- Rain/snow under the house roof (done in Phase 5): particles are hidden inside the roof footprint and the house's floor, porch and furniture stay dry and snow-free (`uShelter` uniforms).
- Walk mode: Esc leaves walking (back to the saved orbit view) instead of pausing in place; the control panel is hidden while walking because the mouse is captured. Walking resumes where you left off within the session.
- Walk mode keeps three's own pointer-lock handling out: a ~20-line mouse-look in `firstPerson.ts` (ignores Chrome's occasional huge first `movementX`, uses raw mouse input where supported). No new dependency.
- Terrain is no longer flat-shaded (user feedback: visible triangles looked fake): smooth normals, per-vertex sand/land colors, and per-pixel procedural detail and sand/grass edges in `patchMaterial` (WORLD_GROUND). Rocks and the house keep the faceted low-poly look.
- Shore foam reworked (user feedback: "too perfect" contour): noise-bent distances, per-stretch surge timing, segmented breaking bands, and a cellular-noise lace that dissolves thin foam into bubbles; matching wet-sand swash band on the beach. Cost: ~+0.5 ms GPU at Medium.
- No start screen any more (user request): sound starts on the first click/key press anywhere (autoplay policy), with a small corner note until then; "Chỉ ngắm cảnh" became a remembered panel option (`sceneOnly`) that keeps the app silent.
- Moving waterline (user feedback: the shore outline still looked fixed): a shared swash function raises/lowers the water surface near the shore (fast run-up, slow backwash, per-stretch timing, per-wave size), and drives the foam front/backwash lace and the wet-sand band.
- Character redesigned on request: smooth-shaded rounded shapes (capsule limbs, ball joints, lathe-turned torso) instead of blocky boxes; beachwear and Korean-style hair, no cap/backpack. Rocks: subdivided, noise-displaced, smooth-shaded boulders with triplanar grain, cracks, lichen and a waterline band (WORLD_STONE) instead of faceted icosahedra.
- Phase 6: the plan's start screen no longer exists (removed on request earlier), so recordings load after the first click/key press; the synth plays until each recording is decoded, then crossfades.
- Phase 6: user recordings are git-ignored by default (licenses vary); `public/audio/README.md` explains this.
- Phase 6: the Pomodoro bell has its own output after the master gain, so `M` (mute all) doesn't silence it; "Chỉ ngắm cảnh" does.
- Phase 6: recordings are decoded fully (seamless loops and loop points need `AudioBufferSourceNode`), not streamed; README recommends 30 s – 3 min loops.
- Phase 7c was done before 7b on request. The house's door moved from the middle of the front to a sliding glass door at the right end of the glass wall, with the steps at the right end of the deck, so the centre of the view stays open.
- Phase 7 (user request) reverses the Phase 2–3 model: the scene leads and sound follows. Weather is no longer driven by the mixer sliders; the synthesized mixer is a fallback without its own UI (only master volume/mute remain), and recordings come from the in-app library. `public/audio/config.json` (Phase 6) still works and now replaces fallback layers.
- Phase 7: recordings are streamed (`<audio>` element), not decoded; the loop point of an MP3 may have a tiny gap once per file length.
- Character detail pass (2026-10-18, user request): sculpted head with eyes in sockets, eyelids that blink, ears; hair shell grown from a hairline plus ~50 tapered locks; superellipse "tube" body and limbs with muscle shape; hands with fingers, feet with toes; separate skin/cloth/hair materials. 25 draw calls, ~33k triangles. Gait adds hip/shoulder counter-rotation, ankles that keep the feet level, idle head turns.
- Character skinning (2026-10-18, user feedback "no knee joint, limbs like Lego"): the avatar is now a `SkinnedMesh` (15 bones, 3 draw calls); arms and legs are continuous skins weighted across the elbow/knee. New gait cycle per leg (hip, knee, foot pitch, stance/swing) for walking and running.
- Joint fixes (2026-10-18, user feedback): the shoulder is a deltoid dome continuous with the sleeve and weighted between chest and arm (it was a separate capped tube that showed as a "can"); the separate kneecap ball is gone; limb cross-sections are interpolated with Catmull-Rom (no flat bands).
- Built-in recordings (2026-10-19, user request): `public/audio/library/library.json` lists recordings shipped with the app (two 15-min island ambiences: day → *Ngày nắng*, night → *Đêm lửa trại*). They join the library on startup, stream from the site (no IndexedDB copy), can be hidden and restored. The manifest now reports sizes and whether the list exists, so nothing missing is requested. This reverses the earlier "repo ships no audio" rule for this folder only; the user confirmed the files may be redistributed.
- Desk detail (2026-10-19, user request): two 27" thin-bezel monitors on aluminium stands, a Keychron K8-style TKL keyboard (87 individual keycaps on the real layout, tilted case), an ergonomic mouse moved to the right (it was on the left), a felt desk pad. RGB backlight: a lit plate under the keycaps with a drifting rainbow computed in the shader (uTime), dimmer by day (uDayLight). The desk lamp (an open cone that showed see-through from below) is now a round Akari-style washi lamp with bamboo ribs on wire legs; the small plant is a Phalaenopsis orchid (arching spike with 7 flowers and buds, broad leaves, bark in a white pot). Mug moved next to the lamp, larger, with an optional local print (`src/assets/local/mug-logo.*`, git-ignored, found with `import.meta.glob` so a missing file costs nothing). Layout balanced (lamp to the left end, mug by the orchid on the right) and soft contact shadows under every desk object (`world/contactShadows.ts`: one mesh of textured quads, one draw call).
- Panel trim (2026-10-19, user request): removed "Tiết kiệm điện" (low power: 30 fps + Low costs, key `L`) and "Chỉ ngắm cảnh" (the mute button covers it); stored values are ignored. Rendering still stops while the tab is hidden. Library: **Thay file…** replaces a recording's audio and keeps its name, volume and mappings; on a shipped recording the new file is stored in the browser (`custom`) and **Dùng lại file gốc** switches back.
- Panel redesign (2026-10-19, user choices: accordion, preset cards with icons, Pomodoro clock in the header): fixed top (Pomodoro clock button, status line, master volume); accordion sections Cảnh / Âm thanh / Thời gian / Góc nhìn / Cài đặt, one open at a time (`panelSection` setting), closed ones show their current value; preset cards with SVG icons and an edited dot; night-sky effects moved next to the weather effects; view tiles reflect the camera mode; real on/off switches (CSS track/knob on every toggle); key caps for shortcuts; "Âm u" → "Trời u ám", synth fallback renamed "Âm nền tự tạo". Every section fits without scrolling at 900 px height.
- Forest trail (2026-10-20, user request): `world/trail.ts` (centerline of ~90 smoothed points from the beach left of the house through the forest center to the far beach, ~160 m, slopes ≥ normalY 0.90, `distance()` with a bounding-box early-out). Terrain gets an `aTrail` attribute; the ground shader turns it into broken, noise-edged earth with leaf litter, at most ~70% opaque so moss shows through. Trees keep ≥ 2 m (+ crown) off it, undergrowth ≥ 0.75 m and denser within 3.5 m; grass thins to a quarter on it; 160 flowers per color along its edges (placed first, so every quality level shows them). `world/lightShafts.ts`: ~75 instanced additive beams on the path, built in the vertex shader from `uSunDir` (camera-facing around their axis), faded by sun height, clouds, rain; one draw call, hidden from water capture/reflection. New tests: no trunk on the path; it runs beach → deep forest → beach.
- Test runner (2026-10-20): the recurring "all 11 test files fail with `reading 'config'`" was Vitest on Windows started from a lower-case drive (`d:\…`): it loads two copies of itself. `npm test` now runs `scripts/test.mjs`, which upper-cases the drive letter before spawning Vitest (a chdir in vite.config.ts is too late).
- Low views (2026-10-20, user report: couldn't look up at the sky from the sand or the sea): orbit `maxPolarAngle` 0.47π → 0.92π with a floor clamp in `update()` (sand + 0.5 m, sea 0.9 m; the camera slides along it and looks up at the target), `minDistance` 12 → 6, screen-space panning with target y up to 60 m. Third-person walk can look up to 0.8 rad (was 0.45). Underwater views are not supported (the water has no underside shading).
- Fishing boat (2026-10-20, user request with a photo): `world/fishingBoat.ts`, a ~20 m Vietnamese fishing boat built in code: lofted hull with an upswept, raked bow, paint in clean bands (one colour per quad, rings packed at the deck edge for a thin rail), two-deck cabin aft, white bow mast and roof frame each flying the national flag (ShapeGeometry star on both faces), a sagging line of 30 pennants, foam at the bow and stern. `FishingTrip` drives it round a house-local ellipse (center seat x − 62 m, z 160 m; radii 34 × 16 m; 2.2 m/s, ~1.5 min per loop), heading along the path and riding the CPU wave twin with damped pitch/roll. Three opaque draw calls + the foam.
- Stairs (2026-10-20, user request): a shrub grew on the lower steps (shrubs were only kept 6 m from the house center; the stair foot is ~7 m out). `inStairsPath()` in layout.ts keeps forest plants and ground flowers out of a strip in front of the steps, so the shrub grows elsewhere. Steps widened to 1.44 m (`STAIRS` in layout.ts, x 2.8 → 2.5 to stay inside the deck), wider stone pad. Bougainvillea on both handrails (`climbingFlowers` in house.ts: leaves up the foot post and spiralling along the rail, magenta bract clusters thicker toward the foot, a few hanging strands; leaf builder, own RNG stream so the rest of the house is unchanged).
- Panel polish (2026-10-20, user: "hãy cải thiện" the 8-point review): even card rows (`minmax(44px, auto)`), smaller paddings/icons; section values hidden while open (`visibility`, keeps the chevron in place); collapsed header shows the scene name and a mute button; keys 1–9 pick scenes (`Shortcut.unlisted`, one hint line; key cap bottom-right of each card); `autoCollapse` setting (click on the canvas, < 6 px movement, collapses the panel; off by default); a **Bật âm thanh** button in the panel top replaces the bottom "click anywhere" pill (AudioPrompt now only reports a failed start); the selected scene card is tinted and has a ✓ badge. At an 800 px tall viewport with Cảnh + Góc nhìn open, ~80 px still scrolls (the last view option).
- Panel sections (2026-10-20, user request): the accordion is gone; sections open and close independently, stored as `panelSections` (default `['scene', 'view']`; the old `panelSection` is ignored so everyone gets the new default once). The title "Đảo Nhiệt Đới" is a button that collapses/expands the panel, like the chevron.
- Curtain hair (2026-10-20, user request "2 mái trẻ trung", reference photo): the avatar's hair is now a middle part with two swept bangs. Hairline arches up in the middle of the forehead (`HAIRLINE`), the shell is fuller and lifted on top/front with a shallow groove along the front half of the part (`hairScale`), and the fringe/top locks now root along the part and sweep out to the temples and over the sides. Locks sit 0.012 above the shell so they are never buried in it.
- Scene time runs on (2026-10-20, user request): picking a scene with a time of day now jumps to it and the island clock keeps running from there (`timePaused: false`, current speed) instead of stopping; the editor's live preview still holds the time still.
- Slider wheel (2026-10-20, user request): every slider (shared `slider()` in ui/components.ts) moves with the mouse wheel over its row: `wheelStep` per notch (default 5 steps; 5% for percentages, 15 min with `wrap: 24` on both clocks), Shift + wheel = `step`; values land on multiples of the increment; trackpad deltas accumulate to a notch; ignored for 350 ms after any scroll so scrolling the panel past a slider doesn't change it. Hint under Phím tắt. Follow-up (same day, "sửa hết"): `defaultValue` (double-click the row; master 0.8, recordings/mappings 0.7, scene effects `DEFAULT_SCENE`), `marks` (ticks at 06/12/18 h on both clocks, at the normal level on sun brightness/size and moonlight), a shared fixed-position value bubble over the thumb for 1 s after a wheel/reset, `VOLUME` options with `fineBelow: 0.2` (2% notches below 20%), and `onWheelNotch` reused by the Pomodoro number boxes (±1, Shift ±5, no focus needed).
- Sun sliders (2026-10-20, user request): scene effects `sunBrightness` and `sunSize` (0..1, 0.5 = normal) in the editor under "Mặt trời"; mapped in App to `uSunBright` ×0.4…×1.8 (disc and glare; excess over display white bleeds toward white) and `uSunSize` ×0.6…×2.2 (disc radius).
- Fix (2026-10-20, user review): (1) the sun looked fake (orange rim, white core, hard edge): one colour by height with mild limb darkening, soft edge, and a display-space glare (screen blend) that the disc melts into; the stacked in-sky glows around a low sun were cut so the sun is the brightest thing. (2) The overview showed orange all round: the palette's top/horizon are direction-less, so twilight keys are neutral now and dawnDuskShift only changes sunlight; the warm fan, saturation boost, dawn haze and cloud glow (0.04 away from the sun) all depend on the direction to the sun. Checked toward, away and both sides, plus the desk.
- Sunrise/sunset look (2026-10-20, user's reference photo and two briefs): the sun disc is now drawn after tone mapping in display colours (golden edge, pale hot core; ACES bleached a bright one to cream and turned a dim one olive) with a golden glow; thin cloud no longer hides it. Dawn: amber-peach palette, soft pink horizon, golden-peach cloud light, calm sea (preset clouds 0.3, cirrus 0.6, waves 0.15). Dusk: amber-orange sky (`dawnDuskShift` evening branch), coral-pink clouds, sun touching the sea (17:54, sky turn −152°). Water at golden hour: reflections cooled to blue away from the sun, a lit blue body, a 3.5× golden sparkle road. New scene effect `cirrus` ("Mây dạng sợi", `uCirrus`): cloud noise stretched across the desk view. Window glass opacity 0.05. Fix: `mugLogo` returns null without a DOM `Image` (collision.test.ts had failed since the logo commit) and the local override now really comes first.
- Sun realism (2026-10-20, user request, "đợt 1 + 2"): (A) disc-local sun with refraction squash, horizon cut, limb darkening, orange-red and below the tone mapper's white when low; (B) azimuth-dependent sky in skyColor: wide warm fan toward the sun, Earth's shadow + Belt of Venus opposite it; (C) palette keys 7 (blue hour −0.16/−0.07, sunset 0, 0.04, golden hour 0.12), cool hemi light at golden hour; (D) sunset clouds: shaded lilac-grey bodies + underside glow gold→orange→red-pink→violet (afterglow to ~−10°), blazing edges and a sun aureole through thin cloud; (E) crepuscular rays (5 cloud samples toward the sun, drawn over the clouds, low sun only); (F) horizon haze warm/cool by side; (G) `uDawn` + `dawnDuskShift`: cooler paler mornings with low mist, warmer evenings; twilight saturation boost against ACES pastel (not in the blue hour); (H) green flash on the last/first sliver. Window glass is now an unlit faint dark tint (the matte pane spread a milky haze facing the low sun). Sunset preset clouds 0.4 → 0.3.
- Mug logo (2026-10-20, user request): the TMA logo is now committed at `src/assets/decor/mug-logo.png` so it shows on GitHub Pages too; a file in the git-ignored `src/assets/local/` still overrides it. Recorded in README credits as a trademark not covered by the project license.
- Moon realism (2026-10-20, user request, "đợt 1 + 2"): (A) disc-local coordinates with the near side's maria, Tycho and its rays, Copernicus/Kepler, slight limb darkening; (B) `moonTint()` in skyCommon (orange and dimmer when low) for disc, halo, cloud glow; moonlight color follows in dayNight; (C) water glitter road: wide lobe × moving sparkle noise, scaled by wave strength, averaged with distance; (D) thin cloud near the moon glows (forward-scatter aureole) with silver rims, thick cloud hides it; (E) 22° halo ring with a reddish inner edge when cloud cover ~15–60 %, coming and going (noise on time); (G) Purkinje shift in patched world materials: dark surfaces desaturate toward blue-grey at night, bright ones keep their color. Also: Milky Way dust now uses polar coordinates around its pole (the fixed latitude offset made streaks).
- Aurora rework (2026-10-20, user request, "mức 2"): new shared `world/shaders/aurora.glsl` (sky + water reflection, `AURORA_LAYERS` 2/1). Ribbons with a wavy sharp lower edge and vertical rays of varying height; four motion rhythms (sway ~40 s, travelling folds ~7 s, ray slide/flicker 1–3 s, brightness surges ~30 s); a faint under-glow so the sky below a ribbon never reads as dark hills; zenith fade. Sea reflects it at all quality levels (water adds ~6 noise lookups per pixel only while the aurora is on). `uAuroraMotion` = 0.08 under prefers-reduced-motion. No rhythm slider and no pink fringe (user's choice).
- Fix (2026-10-20, user report: aurora hard to see from the desk): the aurora was a single arc toward north, ~130° from the desk window. Now two arcs, over the sea in front of the desk (`uAuroraAz`, set from the seat's yaw, +20° right of center so the scene moon stays clear) and toward north for the overview, plus a faint all-round glow; noise is sampled on a circle so the curtains have no seam; a little brighter.
- Fix (2026-10-20, user report "đốm sáng lóe"): the Milky Way dust used atan() around the star frame's Y axis, whose pinch point sits at the band's edge and drifted into the desk window as a burst of rays; it is now sampled in the band's own frame (pinch at the band's pole, where it is invisible). The window glass is Lambert now: its specular highlight of the room lights looked like a pale second moon.
- Scene editor (2026-10-20, user request): "Lưu thành preset" became **+ Tạo cảnh** / **Sửa cảnh**, an in-panel editor (SceneEditor.ts) with name, time (none / set, 5-min slider, auto sky turn into the desk window via `windowSkyTurn`), effects and sound (recordings per scene with volume, add a file; none = synthesized fallback). Live preview, Hủy restores the snapshot. Built-in edits now store values + time (`BuiltInEdit`; old values-only overrides still read). The folded "Tùy chỉnh hiệu ứng" and the "edited" dot are gone: effects are changed in the editor. Cards show time and ♪. Clicking a card also starts audio. Default mappings: Ban ngày → Bình minh ơi + Ngày nắng, Ban đêm → Đêm trăng tròn + Đêm lửa trại; `tsw.tracksOffered` gives new defaults once to existing lists. Delete/reset are two-click.
- Sky turn per scene (2026-10-19, user request: sun/moon visible from the desk window): `ScenePreset.skyTurn` (degrees, only with a time of day) rotates sun, moon and stars around +Y (`turnSky` in celestial.ts, `uSkyTurn` for the star field), eased over ~1.2 s and stored in `tsw.skyTurn`. Dawn 06:12 +15°, sunset 17:42 −150°, full moon 19:15 +15°: each lands ~12–25° left of the desk view's center. Trade-off: while turned, compass directions on the island differ from the real arc.
- New scenes (2026-10-19, user request): *Bình minh ơi* (sunrise, 06:03) and *Đêm trăng tròn* (20:36). New scene effect `moonlight` ("Trăng sáng", default 0.3 = the old moon): bigger/brighter moon disc, wider halo (also in the sea's sky reflection, so a moon path), up to 2x moonlight and a little more night ambient; clouds dim it. Old presets/settings without it read 0.3.
- Clock rework (2026-10-19, user request): `timeMode` is now 'real' (computer clock, shown to the second) or 'free' (the island's own clock) with `timeSpeed` ×1/×10/×30/×60/×240 and `timePaused`. Dragging the time slider runs the island clock from there; Dừng/Chạy and `N` toggle it; old 'cycle24'/'cycle6'/'paused' settings migrate to ×60/×240/stopped (unit-tested).
- Fix (2026-10-18): the High-quality water reflection mirrored its look-at point through the world origin, so it was only right while the camera faced the island center (orbit). Walking and looking out to sea showed the forest behind you smeared over the water. Now built like Reflector.js.
- Spatial audio is the cheap kind planned: per-layer gain, stereo pan and a low-pass "occlusion" filter added to every layer (`BaseLayer`), updated ~10×/s. The wave pan assumes the sea lies away from the island center (true for this round island).

## 0. Context

A local, offline Windows 11 web app left open while working: a small stylized tropical island with GPU water, weather, day/night, and a synthesized ambient sound mixer. Greenfield repo (only `CLAUDE.md` exists). UI in Vietnamese; code/comments/docs in English.

**Decisions from Q&A (2026-10-17)**
| Topic           | Decision                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------ |
| Runtime         | Plain Chrome/Edge tab (no Lively/Wallpaper Engine integration)                                   |
| GPU             | AMD RX 6600 → default preset **Medium**; High expected to hold 60 fps at 1080p–1440p             |
| Water           | **Hybrid**: GPU heightfield sim over the island region + analytic Gerstner waves for the far sea |
| Style           | **Mix**: flat-shaded terrain/rocks/house, smoother shading for palms/leaves and water            |
| Island          | Small, ~150 m across, no LOD system                                                              |
| House           | Stilt house: 1 enterable room + wooden porch                                                     |
| Weather ↔ audio | Linked by default; "Tách hình/âm" toggle reveals separate visual sliders                         |
| UI              | Vanilla TS + CSS, no framework                                                                   |

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

| Choice                         | Why                                                                                                                                | License          |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Vite + TypeScript (strict)     | Fast dev server, zero-config TS, `?raw` shader imports, static build that works offline                                            | MIT / Apache-2.0 |
| three (pinned exact version)   | Mature WebGL2 renderer, InstancedMesh, shadow maps, `OrbitControls`/`PointerLockControls` in `examples/jsm`                        | MIT              |
| WebGL2 only (no WebGPU)        | Chrome/Edge on Win11 fully support it; float render targets via `EXT_color_buffer_float`; WebGPU adds risk for no visible win here | —                |
| Web Audio API, no library      | Everything needed (noise buffers, biquad filters, LFOs, panners) is native; one `AudioContext`                                     | —                |
| No AudioWorklet initially      | Buffer-based noise + scheduled one-shots is cheaper to build and debug; worklet only if CPU profiling demands it                   | —                |
| Vanilla TS UI                  | Small panel, full control over look, easy Vietnamese strings in one file                                                           | —                |
| Vitest (dev only)              | Unit tests for pure logic (state machines, migrations, blend rules)                                                                | MIT              |
| Own simplex noise + seeded RNG | ~80 lines, avoids a dependency, same island every launch                                                                           | —                |

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

|                 | Low             | Medium (default) | High           |
| --------------- | --------------- | ---------------- | -------------- |
| Water sim       | 128²            | 256²             | 512²           |
| Reflection      | sky only        | sky only         | planar ½-res   |
| Refraction RT   | off (tint only) | ½-res            | ½-res          |
| Caustics        | off             | 384²             | 512²           |
| Shadows         | off             | 1024, PCF        | 2048, PCF soft |
| Grass blades    | 4k              | 15k              | 40k            |
| Rain / snow max | 3k / 2k         | 10k / 6k         | 25k / 15k      |
| Pixel ratio cap | 1.0             | 1.25             | 1.5            |
| MSAA            | off             | on               | on             |

**Low power mode:** 30 fps limiter, forces Low-level water/particles, sim stepped every other frame, pixel ratio 1.0. **In every mode, rendering stops while the tab is hidden**; audio and Pomodoro keep running. `prefers-reduced-motion`: auto-rotate off by default, no head-bob, slower default day cycle, no UI animations.

## 6. Performance budget (Medium, 1080p, RX 6600; 16.6 ms frame)

| Item                               | Budget                                       |
| ---------------------------------- | -------------------------------------------- |
| Water sim passes                   | ≤ 0.5 ms GPU                                 |
| Water surface + refraction capture | ≤ 3 ms GPU                                   |
| Terrain + vegetation + house       | ≤ 3 ms GPU                                   |
| Shadow pass                        | ≤ 1.5 ms GPU                                 |
| Rain/snow particles                | ≤ 1 ms GPU                                   |
| JS per frame                       | ≤ 2 ms, zero allocations in the loop         |
| Draw calls / triangles             | < 120 / < 600k                               |
| GPU memory                         | < 200 MB                                     |
| Audio                              | < 3% of one CPU core, < 150 live nodes       |
| JS bundle                          | < 450 KB gzip; repo (no node_modules) < 2 MB |

Checked via the debug overlay (fps, frame ms, `renderer.info` draw calls/triangles; GPU timer query when `EXT_disjoint_timer_query_webgl2` is available) and Edge/Chrome performance traces.

---

## 7. Phased roadmap (each phase ends runnable, build-clean, no console errors)

| Phase                         | Deliverable                                                                                                                                                                                      | What you test                                                                                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1a** Island + orbit         | Scaffold (Vite/TS strict, loop with hidden-tab pause + 30 fps limiter, settings, debug overlay). Terrain, palms, house, props, static sun/sky, Gerstner sea with simple shore foam, orbit camera | `npm install && npm run dev` → orbit/zoom around the island; switch tabs, see in the overlay that rendering paused; ~60 fps                                                                    |
| **1b** GPU water              | Heightfield sim region, click ripples, refraction, caustics, sky reflection, wave-strength slider, quality preset skeleton (water res)                                                           | Click water → rings that reflect off the beach; caustics on shallow sand; slider changes the sea; Low/Med/High in the overlay                                                                  |
| **2** Audio + mixer           | AudioEngine, 5 synth layers, start screen, Vietnamese panel (volume/mute/on-off/master), presets + user presets in localStorage                                                                  | Start button → sound; every slider/mute/switch works without clicks; save a preset, reload the page, it's still there                                                                          |
| **3** Weather                 | Wind gusts (vegetation, grass, sea, audio), rain (particles, ripples, wetness, sheen), snow (particles, cover), sleet blend, link/unlink toggle                                                  | "Bão" preset → rain, ripples, sand darkens; wind sways palms in sync with the gust sound; snow slowly whitens the island; rain + snow → sleet, no fight                                        |
| **4** Day/night               | Sky shader, palette, stars, moon, clouds tied to overcast, windows + interior light, birds fade at night                                                                                         | Speed up the cycle: smooth dawn/dusk, stars at night, house lights on; pause works                                                                                                             |
| **5** First-person            | Pointer lock, WASD/Shift, terrain following, collision, house interior/porch, deep-water limit, footsteps by surface, spatial audio, indoor rain muffle                                          | `C` → walk; can't pass trunks/walls/deep water; footsteps change on sand/grass/wood/shallows; waves louder at the shore; rain muffled indoors; Esc → orbit                                     |
| **6** Files, Pomodoro, polish | Audio config + manifest plugin + crossfades, Pomodoro overlay + chime + "storm calms", final quality presets, low power, reduced motion, hide-UI, shortcuts, README, perf pass                   | Drop an OGG into `public/audio`, edit config → real sound; delete it → synth, no red errors; Pomodoro chimes while the tab is hidden; `H` gives a clean wallpaper view; Low power holds 30 fps |

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
- `npm run build` and `npm test` pass; `npm run preview` works offline (DevTools Network set to "Offline").
- Debug overlay shows ≥ 60 fps at Medium (≥ 30 in Low power); tab-hidden pause confirmed.
- Phase-specific checklist from §7.
