# Săn Bong Bóng (Phase 15r) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While riding the manta, click/hold to fire a frost-aurora laser at drifting soap bubbles that burst open where they are hit, with a light score and 🍅 per 30.

**Architecture:** Pure, unit-tested logic (`bubbleField`, `laserFire`, `huntScore`) owns state; bubble motion is a closed-form `pos(t)` evaluated identically on the CPU (hit tests) and in the vertex shader (drawing), so nothing is read back from the GPU. Renderers (`huntBubbles`, `laserBeam`) are instanced/one-quad shaders driven by attributes and uniforms. `BubbleHunt` glues input, aiming, scoring and sounds, and is created and updated by `App` beside `MantaSkills`.

**Tech Stack:** TypeScript, Three.js (`InstancedMesh`, `Points`, `ShaderMaterial`), Web Audio, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-08-bubble-hunt-design.md`

## Global Constraints

- UI text Vietnamese; code, comments, commits English. Strings live in `src/ui/strings.vi.ts`.
- No new dependencies. No network. No `any` unless commented why.
- No allocations in per-frame code: module-level scratch `THREE.Vector3`s, fixed-size arrays.
- Nothing drawn or updated while not riding (meshes `visible = false`, `update` returns early).
- Ground truth for "flying": `cameras.mode === 'fly' && manta.state === 'riding'`.
- Time base: `sharedUniforms.uTime.value` (s), the same value on CPU and GPU.
- Additive glow uses `FIRE_BLENDING` from `src/world/creatures/fireBlend.ts`.
- `prefers-reduced-motion`: no screen shake, no beam flicker.
- Tests: run with `npm test` (bare `npx vitest run` fails from a lower-case `d:\` cwd).
- Per phase: `npm run build` clean, no console errors, ~60 fps on Medium in Edge.

## Review Focus

1. Bubble spawned over a hill or the house while the floor rises under its drift → it must never sit inside terrain (spawn y ≥ floor(x±A, z±A) + 3 + A). Test in Task 1.
2. Hold fire while the manta lands / you hop off / switch to overview → beam and hum stop at once, no stuck sound. Test in Task 4 (`laserFire.cancel`) + browser check in Task 6.
3. Two bubbles on the ray, the far one larger → the nearer one bursts (nearest `t`), and the beam stops there. Test in Task 1.
4. A burst bubble is not hittable again during its 90 ms burst nor while waiting to respawn. Test in Task 1.
5. Tab hidden mid-burst / large `dt` after resume → respawn timers and combo window work from `uTime`, not accumulated `dt`, so nothing explodes in a batch. Test in Task 2 (combo uses absolute times).

---

## File map

| File | Responsibility |
| --- | --- |
| `src/activities/flight/bubbleField.ts` (new) | Pure: slots, spawn/recycle/respawn, `posAt`, `raySphere`, `pick`, `burst`. |
| `src/activities/flight/laserFire.ts` (new) | Pure: click/hold state machine, heat, exposure. |
| `src/activities/flight/huntScore.ts` (new) | Pure: count, combo, 🍅 blocks, persistence shape. |
| `src/pets/ledger.ts`, `src/pets/wallet.ts` | `earnBubble` + kind `bubble`. |
| `src/world/creatures/bubbleFilm.glsl.ts` (new) | Thin-film GLSL shared with `bigBubble.ts`. |
| `src/world/creatures/huntBubbles.ts` (new) | Bubble `InstancedMesh` + droplet `Points`. |
| `src/world/creatures/laserBeam.ts` (new) | Beam quad + muzzle/impact flares. |
| `src/activities/BubbleHunt.ts` (new) | Glue: input, aim ray, ground/sea march, scoring, sounds. |
| `src/ui/Crosshair.ts`, `src/ui/HuntHud.ts` (new) | DOM overlays. |
| `src/audio/synth/laserHum.ts` (new) | Continuous beam hum (setVolume/setEnabled/dispose). |
| Edits | `MantaActivity` (`nose`), `DragLook` (`steering` getter), `quality.ts` (`huntBubbles`), `skillSounds.ts`, `mixer.ts`, `App.ts`, `MantaSkillBar`, `strings.vi.ts`, `styles.css`, `ShortcutsView`, README, PLAN.md. |

---

## 15r-a — bubbles, burst, laser, aiming

### Task 1: `bubbleField` (pure logic)

**Files:**
- Create: `src/activities/flight/bubbleField.ts`
- Test: `tests/bubbleField.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const FIELD = { shellMin: 40, shellMax: 140, behind: 200, rMin: 1.2, rMax: 3.5,
    drift: 4, rise: 0.3, above: 3, ceiling: 150, bound: 520, respawnMin: 1, respawnMax: 3,
    burst: 0.09, grow: 0.6, inflate: 1.3 } as const;
  export interface Slot { p0: Float32Array /*3*/; freq: Float32Array /*3, rad/s*/; phase: Float32Array /*3*/;
    born: number; radius: number; burstAt: number /* -1 none */; burstDir: Float32Array /*3, unit*/;
    respawnAt: number /* -1 none */; fadeAt: number /* -1 none: recycle fade start */ }
  export type Floor = (x: number, z: number) => number;
  export class BubbleField {
    constructor(capacity: number, rand?: () => number);
    readonly slots: readonly Slot[];
    count: number;                       // active slots (quality), ≤ capacity
    /** Fills empty/expired slots around (x,y,z) heading `yaw` (forward (−sin, −cos)); recycles far-behind ones. */
    update(now: number, x: number, y: number, z: number, yaw: number, floor: Floor): void;
    posAt(i: number, now: number, out: Float32Array | number[]): void;
    /** Nearest hittable slot along the ray (dir unit) within maxT, radius × inflate; -1 if none. Writes t into hit[0]. */
    pick(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, now: number, hit: Float32Array): number;
    hittable(i: number, now: number): boolean;
    /** Starts the burst; dir = from centre to the hit point (unit). Schedules respawn. */
    burst(i: number, now: number, dx: number, dy: number, dz: number): void;
    /** Leaving the manta: fade every live slot out now. */
    clear(now: number): void;
    /** Bumped whenever slot attributes change (renderer re-uploads). */
    version: number;
  }
  export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r): number; // nearest t ≥ 0, or -1
  ```
- Motion (must match the shader in Task 3 exactly):
  `τ = now − born; pos = p0 + (A·sin(fx·τ+φx), rise·τ + 0.5·A·sin(fy·τ+φy), A·sin(fz·τ+φz))`, A = `FIELD.drift`.

- [ ] **Step 1: Write failing tests** in `tests/bubbleField.test.ts` (use the seeded mulberry32 helper copied from `tests/ringCourse.test.ts`):
  - `raySphere`: ray at origin along +z, sphere at (0,0,10) r 1 → `t ≈ 9`; offset 1.5 sideways → −1; origin inside → t ≥ 0 (exit point); sphere behind → −1.
  - `spawns in the shell ahead`: after `update(0, 0,50,0, yaw 0, floor ()=>0)` with count 12, every slot centre is 40–140 m away horizontally and ≥ 70 % of them have `dot(forward, offset) > 0`.
  - `stays clear of the floor`: floor = `(x,z) => 30 + 10*Math.sin(x*0.1)`; every spawned `p0.y ≥ max floor over x±4, z±4 + 3 + 4` (sample a 3×3 grid).
  - `posAt follows the formula` at τ = 0, 1.7, 12.3 against a hand-written evaluation.
  - `pick returns the nearest`: place two slots manually on a ray (near r 1 at 20 m, far r 3 at 40 m) → near index, `hit[0] ≈ 20 − 1.3`.
  - `inflate`: a ray passing 1.25 R from the centre hits; 1.35 R misses.
  - `burst slots are not hittable`: after `burst(i, 5, …)`, `hittable(i, 5.05)` false, `pick` skips it; at `respawnAt` it is regrown (new `born`) and hittable after `born + FIELD.grow`.
  - `recycles behind`: move the manta 260 m forward → slots more than 200 m behind get `fadeAt` set and are respawned ahead after the fade.
  - `clear` sets `fadeAt` on every live slot; `update` respawns nothing until the next `update` called with the field re-enabled (`count` > 0).
- [ ] **Step 2:** `npm test -- bubbleField` → FAIL (module not found).
- [ ] **Step 3: Implement** `BubbleField`. Spawn: pick a heading `yaw + (rand−0.5)·2.4` (biases ahead), distance `40 + rand·100`, height `y + (rand−0.5)·40`, then clamp to `floorMax + above + drift` and `ceiling`; reject (retry ≤ 8) outside `bound`. Frequencies 0.15–0.35 rad/s, phases 0–2π. Fade on recycle lasts `FIELD.grow`. `version++` on every slot change.
- [ ] **Step 4:** `npm test -- bubbleField` → PASS.
- [ ] **Step 5:** Commit `Bubble hunt: bubble field logic`.

### Task 2: `huntScore` + ledger kind `bubble`

**Files:**
- Create: `src/activities/flight/huntScore.ts`
- Modify: `src/pets/ledger.ts` (TOMATO_SIGN `bubble: 1`; `earnBubble`), `src/pets/wallet.ts` (`earnBubble`)
- Test: `tests/huntScore.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const SCORE = { comboGap: 2, block: 30, shakeAt: 5 } as const;
  export interface HuntSave { total: number; toward: number }       // stored at 'tsw.bubbleHunt'
  export function parseHuntSave(raw: unknown): HuntSave;            // bad input → {0,0}; clamps toward to 0..29
  export class HuntScore {
    constructor(save: HuntSave);
    total: number; toward: number; combo: number;
    /** A burst at `now` (s, uTime) and `wall` (ms, Date.now()). Returns the tomato id `b<wall>` when this burst completes a block, else null. */
    add(now: number, wall: number): string | null;
    save(): HuntSave;
  }
  // ledger.ts
  export function earnBubble(l: Readonly<Ledger>, id: string, t: number): { ledger: Ledger; earned: boolean };
  // wallet.ts
  earnBubble(id: string, t: number): boolean;
  ```
- **Learning-mode contribution (user writes):** the combo rule inside `HuntScore.add` (5–10 lines): how `combo` grows within `SCORE.comboGap` of the previous burst and resets after. The tests below pin the agreed behaviour; the user may propose a different curve before writing it.

- [ ] **Step 1: Failing tests:** combo 1,2,3 for bursts at t = 0, 1.5, 3.4; reset to 1 at t = 5.5; a resume with t jumping +100 resets (absolute times, not dt); the 30th `add` returns `'b<wall>'` and `toward` returns to 0, the 29th returns null; `parseHuntSave(null)`, `{total:'x'}`, `{toward: 99}` → sane values; `earnBubble` twice with the same id earns once and `tomatoes()` grows by 1; unknown kinds still count 0.
- [ ] **Step 2:** `npm test -- huntScore` → FAIL.
- [ ] **Step 3:** Implement (combo rule left as a `TODO(user)` with the tests above as its contract), `earnBubble` mirrors `earnRing`, `Wallet.earnBubble` mirrors `Wallet.earnRing`.
- [ ] **Step 4:** `npm test` → all PASS (including `ledger.test.ts`).
- [ ] **Step 5:** Commit `Bubble hunt: score, combo and bubble tomatoes`.

### Task 3: Bubble renderer (`bubbleFilm.glsl.ts`, `huntBubbles.ts`)

**Files:**
- Create: `src/world/creatures/bubbleFilm.glsl.ts`, `src/world/creatures/huntBubbles.ts`
- Modify: `src/world/creatures/bigBubble.ts` (import the chunk; no visual change)
- Modify: `src/core/quality.ts` (`huntBubbles: 8 | 12 | 16` in each profile)

**Interfaces:**
- Consumes: `BubbleField`, `Slot`, `FIELD` (Task 1); `SharedUniforms`.
- Produces:
  ```ts
  export const THIN_FILM_GLSL: string;   // vec3 thinFilm(float thickness, float cosTheta), float fresnel(...)
  export class HuntBubbles {
    constructor(scene: THREE.Scene, shared: SharedUniforms, capacity: number /*16*/, droplets: number /*640*/);
    /** Re-uploads attributes when field.version changed; sets instance count; visible = on. */
    sync(field: BubbleField, on: boolean): void;
    /** Throws ~40 droplets from the rim at the hit point (ring buffer). */
    splash(cx: number, cy: number, cz: number, r: number, dx: number, dy: number, dz: number, now: number): void;
    dispose(): void;
  }
  ```
- Shader decisions:
  - Instance attributes: `aP0`, `aFreq`, `aPhase` (vec3); `aInfo` vec4 = (born, radius, burstAt, fadeAt); `aBurstDir` vec3. Vertex shader evaluates the Task 1 motion formula; scale = radius × grow-in (ease-out-back over `FIELD.grow`) × fade-out.
  - Burst hole: in the fragment shader, `ang = acos(dot(normalize(localPos), aBurstDir))`; rim angle `ρ = π · smoothstep(0, FIELD.burst, now − burstAt)`; jagged rim `ρ' = ρ + 0.25·noise(angle round the axis × 9)`; `discard` if `ang < ρ'`; bright rim band of 0.12 rad; whole bubble hidden after `burstAt + FIELD.burst`.
  - Material: transparent, `depthWrite: false`, double-sided off, normal blending (film), `renderOrder` after water like `bigBubble`.
  - Droplets: `Points` with attributes start, velocity, birth; ballistic with drag 2.5 /s and gravity 6 m/s², life 0.7 s, size 2–4 px scaled by distance, colours from the frost palette; `FIRE_BLENDING`.
- [ ] **Step 1:** Extract the thin-film/Fresnel code from `bigBubble.ts` into `THIN_FILM_GLSL`, import it back; `npm run build` passes; Bọt's bubble looks unchanged (screenshot before/after from the desk crab scene).
- [ ] **Step 2:** Implement `HuntBubbles`; add `huntBubbles` to `QualityProfile` (low 8, medium 12, high 16).
- [ ] **Step 3:** Temporary check in the browser via a dev hook (`window.__hunt`) that fills a field round the camera: bubbles drift, grow in, a forced `burst` opens a hole on the chosen side, droplets fly. Remove the hook after.
- [ ] **Step 4:** `npm run build` clean; commit `Bubble hunt: bubble and burst rendering`.

### Task 4: `laserFire` state machine

**Files:**
- Create: `src/activities/flight/laserFire.ts`
- Test: `tests/laserFire.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const FIRE = { flash: 0.15, cooldown: 0.12, hold: 0.15, heat: 1.5, exposure: 0.08 } as const;
  export type FireMode = 'off' | 'flash' | 'beam';
  export class LaserFire {
    press(now: number): void; release(now: number): void; cancel(): void;
    update(now: number): void;
    readonly mode: FireMode;
    /** 0..1 width envelope of the flash or the beam (beam ramps in over 0.05 s). */
    readonly strength: number;
    /** 0..1 over FIRE.heat while the beam stays on. */
    readonly heat: number;
    /** True for exactly one update after a flash starts (the flash hits instantly). */
    readonly flashFired: boolean;
  }
  /** Beam exposure bookkeeping: true when slot i has had ≥ FIRE.exposure s of beam. */
  export class Exposure { add(i: number, dt: number): boolean; reset(i: number): void; clearAll(): void; }
  ```
- [ ] **Step 1: Failing tests:** press at 0, release at 0.05 → flash, `flashFired` once, mode off at 0.2; a second press at 0.21 is accepted, at 0.16 + 0.1 inside cooldown it is ignored; press held past 0.15 → mode `beam`, heat 0.5 at 0.15 + 0.75, 1 after 1.65; release → off; `cancel()` while beam → off and heat 0; `Exposure.add` crosses at 0.08 cumulative (0.05 + 0.04), `reset` clears.
- [ ] **Step 2:** `npm test -- laserFire` → FAIL. **Step 3:** implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `Bubble hunt: laser fire state`.

### Task 5: Beam renderer (`laserBeam.ts`)

**Files:**
- Create: `src/world/creatures/laserBeam.ts`

**Interfaces:**
- Produces:
  ```ts
  export class LaserBeam {
    constructor(scene: THREE.Scene, shared: SharedUniforms);
    /** from = mouth, to = end point (world); strength/heat from LaserFire; hit = an impact flare at `to`. */
    set(from: THREE.Vector3, to: THREE.Vector3, strength: number, heat: number, hit: boolean, flicker: boolean): void;
    hide(): void;
    dispose(): void;
  }
  ```
- Shader decisions: one quad (4 vertices, `position.x` ∈ {0,1} along, `position.y` ∈ {−1,1} across); vertex shader places it between `uFrom` and `uTo`, across = `normalize(cross(axis, toCamera))`, half-width `0.06 m + 0.10 m·heat` scaled by strength, widened to ≥ 1.5 px at distance (as `iceRings` core). Fragment: `d = |across|`; core `exp(−d²·60)` white; halo `exp(−d²·6)` in `mix(vec3(0.55,0.9,1.0), vec3(0.75,0.5,1.0), heat)`; noise scrolling at 40 m/s along the length (×0.85–1.15); when `flicker`, a 30 Hz ±10 % pulse. `FIRE_BLENDING`, `depthWrite: false`, depth-tested. Muzzle and impact flares: two camera-facing sprites in one `Points` (2 vertices), soft star (radial + 4-point cross), impact 2× size with frost sparks (8 short streaks, random per hit seed).
- [ ] **Step 1:** Implement; dev hook draws a beam from the manta nose to 100 m ahead; check day, sunset, night; beam behind a hill is occluded.
- [ ] **Step 2:** `npm run build`; commit `Bubble hunt: laser beam rendering`.

### Task 6: `BubbleHunt` glue, aiming, crosshair (end of 15r-a)

**Files:**
- Create: `src/activities/BubbleHunt.ts`, `src/ui/Crosshair.ts`
- Modify: `src/activities/MantaActivity.ts` (add `nose(out: THREE.Vector3): boolean`, like `wingTip`, using `model.nose(0.1, out)`), `src/controls/dragLook.ts` (public `get steering(): boolean`), `src/core/App.ts` (create, update, `setQuality`, dispose), `src/ui/styles.css` (`.crosshair`, `.crosshair.on`).

**Interfaces:**
- Consumes: Tasks 1, 3, 4, 5.
- Produces:
  ```ts
  export interface HuntHooks {
    flying(): boolean;
    floor(x: number, z: number): number;
    heightAt(x: number, z: number): number;
    seaHeight(x: number, z: number): number;
    ripple(x: number, z: number): void;
    reducedMotion(): boolean;
    // 15r-b adds: sound, burst (score), shake
  }
  export class BubbleHunt {
    constructor(scene: THREE.Scene, shared: SharedUniforms, manta: MantaActivity, camera: THREE.PerspectiveCamera,
                dom: HTMLCanvasElement, ui: HTMLElement, hooks: HuntHooks);
    setQuality(count: number): void;
    /** Fire from a button (touch): press/release aimed at the centre. */
    press(): void; release(): void;
    update(dt: number): void;
    dispose(): void;
  }
  ```
- Behaviour:
  - Listens `pointerdown` (button 0, target the canvas, `hooks.flying()`) → `fire.press(now)`, records cursor NDC; `pointermove` updates the NDC; `pointerup`/`pointercancel`/`blur` → `release`.
  - Aim NDC = (0,0) when `manta.look.steering` or the press came from `press()`; else the cursor.
  - Each frame while flying: `field.update(...)` with `manta.flight` (x, y, z, yaw) and `hooks.floor` (App passes `(x, z) => this.manta.floorAt(x, z)`); `pick` along the camera ray to 250 m; if no bubble, march 2 m steps comparing y with `max(heightAt, seaHeight)` (≤ 125 steps, only while firing) to find the end; sea hit → `ripple`.
  - Flash: bursts the picked slot on `flashFired`. Beam: `Exposure.add(picked, dt)` → burst when true; switching target keeps per-slot exposure.
  - Not flying: `fire.cancel()`, `field.clear(now)` once, beam hidden, crosshair hidden; after the fade, `bubbles.sync(field, false)`.
  - Crosshair: a centred CSS element, shown while `flying && manta.look.steering`, `.on` when the centre ray picks a bubble.
- [ ] **Step 1:** Implement the two DragLook/MantaActivity accessors, `Crosshair`, `BubbleHunt`; wire in `App` (create after `mantaSkills`; `update` beside `this.mantaSkills.update(dt)`; `setQuality(profile.huntBubbles)` in `applySettings`).
- [ ] **Step 2: Browser check (Edge, `npm run dev`):** ride, Shift + W: bubbles ahead, crosshair; click on one → hole opens on the side facing you, droplets; hold and sweep across two → both burst; shoot the sea → ripple; stand still and click at the cursor; land with the beam held → beam stops, bubbles fade. Low/High counts. Console clean.
- [ ] **Step 3:** `npm test` and `npm run build` clean; measure GPU time with the bubbles out and the beam on (Chrome DevTools performance trace) and note it in PLAN.md.
- [ ] **Step 4:** Commit `Bubble hunt 15r-a: shoot bubbles from the manta`. **Stop and ask the user to test 15r-a before 15r-b.**

---

## 15r-b — sound, score, touch, docs

### Task 7: Sounds

**Files:**
- Create: `src/audio/synth/laserHum.ts`
- Modify: `src/audio/synth/skillSounds.ts` (kinds `laser`, `bubblePop`), `src/audio/mixer.ts` (`laserHum` accessor, created on the shared context), `src/activities/BubbleHunt.ts` (`hooks.sound`, `hooks.hum`).

**Interfaces:**
- Produces: `class LaserHum { constructor(ctx: AudioContext, out: AudioNode); setVolume(v: number): void; setEnabled(on: boolean): void; setHeat(h: number): void; dispose(): void }`; `SkillSound` += `'laser' | 'bubblePop'` where `bubblePop`'s `size` carries the combo step (pentatonic degree = min(combo − 1, 9)).
- Recipes: `laser` = FM sine 2.4 kHz → 600 Hz in 0.12 s, modulator ×3.5, plus 10 ms noise click; `bubblePop` = `pop.ts` click + FM glass bell (the `gate` recipe, shorter, 0.35 s) on C-major pentatonic from C6 stepping up; `LaserHum` = two detuned saws (110 / 110.7 Hz) through a lowpass whose cutoff goes 400 Hz → 2.2 kHz with heat, gain ramped with `setTargetAtTime` (τ 0.03 s), oscillators stopped when disabled.
- [ ] **Step 1:** Implement; browser check: click = zap, hold = hum rising, burst chimes climb with the combo; release → hum fades without a click; land while holding → silent.
- [ ] **Step 2:** `npm test` (audio tests), `npm run build`; commit `Bubble hunt: laser and bubble sounds`.

### Task 8: HUD, score, 🍅, shake

**Files:**
- Create: `src/ui/HuntHud.ts`
- Modify: `src/activities/BubbleHunt.ts` (`HuntScore`, persistence at `tsw.bubbleHunt` with try/catch via the existing `writeStored`/read helper used for `tsw.flyTips`), `src/core/App.ts` (hooks: `reward: (id, t) => wallet.earnBubble(id, t)`, shake via `this.fx.shake(x, y, z, 0.08, 0.3)` (`SkillFxSink`, as `mantaEntranceFx` uses it)), `src/ui/strings.vi.ts`, `src/ui/styles.css`.

**Interfaces:**
- Produces: `class HuntHud { constructor(parent: HTMLElement); show(total: number, toward: number, combo: number): void; tomato(): void; hide(): void }`.
- Copy (`vi.manta.hunt`): `title: 'Săn Bong Bóng'`, `count: (n) => \`${n} bong bóng\``, `combo: (n) => \`×${n}\``, `toward: (k) => \`${k}/30 → 🍅\``, `tomato: '🍅 +1 từ bong bóng!'`.
- Behaviour: HUD visible while flying after the first burst of the ride, under the ring HUD's spot (hidden while a ring course runs); combo badge pops (CSS scale, none with reduced motion); shake at `combo ≥ SCORE.shakeAt` and not reduced motion; a returned tomato id → `reward` → if earned, `hud.tomato()` and `avatar.cheer(1)`.
- [ ] **Step 1:** Implement; browser check: count, combo ×n within 2 s, 30th → 🍅 note and the wallet count +1; reload → `toward` kept.
- [ ] **Step 2:** `npm test`, `npm run build`; commit `Bubble hunt: score HUD and tomatoes`.

### Task 9: Touch button, fly tip, docs

**Files:**
- Modify: `src/ui/MantaSkillBar.ts` (an extra hold button: `pointerdown` → `hunt.press()`, `pointerup`/`pointercancel`/`pointerleave` → `hunt.release()`; shown only on touch layouts), `src/ui/icons.ts` (`skillLaser`), `src/core/App.ts` (`FLY_TIP_ORDER` += `'shoot'`, marked used on the first shot), `src/ui/strings.vi.ts` (`flyTips.shoot: 'Click (giữ) chuột: bắn bong bóng bằng tia băng'`), `src/ui/ShortcutsView.ts` (row "Chuột trái — bắn bong bóng (khi bay)"), `src/ui/WelcomeGuide.ts` (one line in the manta step), `README.md` (controls), `PLAN.md` (15r status, measured cost).
- [ ] **Step 1:** Implement; check on the phone emulation (Edge DevTools, 390×844): tap = flash, hold = beam, the button doesn't steer the view.
- [ ] **Step 2:** `npm test`, `npm run build`, no console errors, 60 fps on Medium; commit `Bubble hunt 15r-b: sound, score, touch and docs`. **Stop and ask the user to test.**
