# Phase 15r — Săn Bong Bóng (bubble hunt while riding the manta)

Status: design approved in chat 2026-11-08; awaiting review of this written spec.

## 1. Intent

While riding Cá Đuối Trời, the player can shoot a beautiful laser from the manta at soap bubbles
that drift around the sky; hit bubbles burst open. It is a relaxed, always-on toy that fits a
wallpaper app: no timer, no fail state, light scoring.

User decisions (2026-11-08):
- Bubbles appear by themselves and drift randomly whenever you ride (not a timed skill).
- Light scoring: a counter, combos, one 🍅 per 30 bubbles.
- Click = a short laser flash; hold = a continuous beam that heats up.
- Style: frost / aurora (white core, ice-blue to violet halo, frost crystals on impact).

Success: on Medium at the default pixel ratio, flying and shooting stays at 60 fps in Edge; aiming
feels fair with the mouse; a burst reads clearly as "a hole opens where I hit it and the film
tears into droplets"; nothing is drawn or updated while not riding.

## 2. Research notes

- Laser: a thin near-white core plus a wider coloured glow, intensity falling with distance from
  the beam axis, additive blending (threex.laser; Godot "Simple Laser Shader"; WebGL laser spec).
- Real bubble bursts: a hole opens, its rim races round the film, the rim's edge indents into
  ligaments that break into droplets; the whole event takes tens of milliseconds
  (Science News Explores; Live Science).
- Game feel: hit confirmation is the most satisfying moment; scale screen shake to importance
  (shaking on every hit gets tuned out); always offer reduced shake; feedback returns to rest.
- From 15i: mouse aiming is hard, so use generous hit radii and an "on target" cue.

## 3. Architecture

Hit detection runs on the CPU with analytic motion: every bubble's position is a closed-form
function `pos(t)` of its spawn parameters, evaluated identically in TypeScript and in the vertex
shader (the `bubbleAt` pattern of `world/todoBubbles.ts`). No GPU readback. GPU picking was
rejected: a readback stall for ~12 targets.

The app never captures the mouse (no pointer lock; `controls/dragLook.ts`): while a movement key
is held, plain mouse moves steer and the cursor hides (`body.steering`); standing still, the
cursor shows and a left drag turns the view. So the hit ray comes from the camera through the
screen centre while steering (the crosshair shows there), and through the cursor otherwise. The
drawn beam joins the manta's mouth to the first hit point on that ray, so what you aim at is what
you hit (no parallax error between mouth and camera). Holding fire while dragging sweeps the
beam with the view, which is the intended "sweep" gesture.

### Units

| File | Purpose | Depends on |
| --- | --- | --- |
| `src/activities/flight/bubbleField.ts` | Pure logic: spawn/recycle policy, `posAt(slot, t, out)`, `raySphere`, `pick(ray, t)` with inflated radius, burst bookkeeping. Unit-tested. | nothing (math only; skyline floor passed in as a function) |
| `src/world/creatures/huntBubbles.ts` | Draws bubbles (one `InstancedMesh`) and burst droplets (one `Points` pool). Per-instance attributes: spawn params, burst time, burst direction. | shared thin-film GLSL chunk, `SharedUniforms` |
| `src/world/creatures/bubbleFilm.glsl.ts` | Thin-film + Fresnel + wobble GLSL extracted from `bigBubble.ts` (which then imports it; no behaviour change). | — |
| `src/world/creatures/laserBeam.ts` | Beam quad (camera-facing, built in the vertex shader along the axis), muzzle flare, impact flare + frost sparks. | `SharedUniforms` |
| `src/activities/BubbleHunt.ts` | Glue: input (mouse/touch), fire state machine (flash / beam / heat), per-frame ray cast, scoring, combos, ledger, sounds, enable/disable with riding. | the units above, `MantaActivity`, `AudioEngine`, ledger |
| `src/ui/HuntHud.ts` | Counter + combo readout (styled like `RingHud`). | — |
| `src/ui/Crosshair.ts` | Small CSS crosshair at screen centre while flying; lit when on target. | — |

Focused edits: `MantaActivity` (mouth position, riding/flying state for the hunt), `App` (create
and update `BubbleHunt`, fly tip), `audio/synth/skillSounds.ts` (zap, beam hum, burst chime),
`ui/MantaSkillBar.ts` (touch fire button), `ui/strings.vi.ts`, `pets/ledger.ts` (kind `bubble`),
`ui/ShortcutsView.ts` and README (controls).

## 4. Bubbles

- Count by quality: 8 / 12 / 16 (Low / Medium / High). Radius 1.2–3.5 m.
- Spawned in a shell 40–140 m from the manta, biased ahead of its heading; at least 3 m above the
  skyline floor and below the soft ceiling; inside the 520 m flight limit.
- Motion: a slow drift (sum of a few sines per axis with per-bubble seeds) plus a slight rise.
- Recycle: a bubble more than 200 m behind (or out of bounds) fades out and respawns ahead.
- After a burst, a new bubble grows in 1–3 s later (scale-in with a small overshoot).
- Leaving the manta: all bubbles fade out over ~1 s, then the meshes are hidden: no draw calls
  and no per-frame work while not riding.

### Burst

- The fragment shader opens a hole centred on the hit direction (in the bubble's local frame):
  the film is discarded where the angle from the hit point is below a rim angle that grows from 0
  to π in ~90 ms. The rim is bright and jagged (noise on the rim angle stands in for ligaments).
- At the same time ~40 droplets fly off from the rim (ballistic with drag, in the vertex shader,
  from a shared `Points` pool), plus a few frost crystals in the beam's colours.

## 5. Laser

- Click: a flash lasting 0.15 s (width swells then thins); 0.12 s cooldown between flashes.
- Hold (pointer down > 0.15 s): a continuous beam. Over its first 1.5 s it heats up: wider,
  brighter, the halo shifting from ice-blue toward violet. A bubble bursts after ~0.08 s of
  cumulative exposure (a flash always bursts what it hits).
- Beam end: the first bubble hit; else terrain / sea along the camera ray (sea hit adds
  `water.addRipple`); else 250 m.
- Look: core = narrow falloff around the axis (near-white), halo = wider faded falloff in the
  colour, noise scrolling along the length, additive blending, depth-tested so it passes behind
  terrain correctly. Muzzle flare sprite at the mouth; impact flare + frost sparks at the end.
- Aim assist: bubble hit radius × 1.3. Crosshair (shown only while steering) lights when the
  centre ray is on a bubble.

## 6. Scoring and feedback

- HUD counter of bubbles burst. Combo: bursts within 2 s of each other raise ×2, ×3, …
- Every 30 bubbles: 🍅 +1 through the ledger (kind `bubble`, id `b<ms timestamp of the 30th
  burst>`, so it pays once and two synced devices never collide). Only the count toward the next
  tomato (0–29) and the lifetime total are kept in `localStorage` (`tsw.bubbleHunt`), with
  try/catch; losing them loses at most 29 bubbles of progress, never a paid tomato.
- Sounds (synthesized): flash = short downward FM "zap"; beam = a hum whose filter opens with heat;
  burst = `pop.ts` plus a glassy chime on a pentatonic step that climbs with the combo.
- Screen shake only at combo ≥ 5. With `prefers-reduced-motion`: no shake, no beam flicker.
- Fly tip: "Click để bắn bong bóng" added to `App.updateFlyTips` (marked used on the first shot).

## 7. Input and conflicts

- Left button on the scene while flying (camera mode `fly`, manta state `riding`) = fire, aimed
  as in §3. Presses on the menu, cards or skill buttons never fire (they don't reach the canvas).
- Sea-click summoning (15o) and the shark shoo click are inactive while riding; verified during
  implementation.
- Not flying (landed, climbing on, autopilot hand-over) = no firing.
- Touch: a round fire button in the skill column (tap = flash, hold = beam), aiming at the
  screen centre.

## 8. Performance budget

+4 draw calls while riding (bubbles, droplets, beam, flares), estimated < 0.4 ms GPU on Medium;
0 when not riding. No allocations in the render loop (scratch vectors reused; the ray test loops
over a fixed array). Measured in Edge before the phase is declared done.

## 9. Testing

- Unit tests (`npm test`): `bubbleField` (spawn shell and floor, recycle behind, `raySphere`
  hits/misses and nearest-first, inflated radius, CPU `posAt` matches the formula used in GLSL
  at sample times), combo and 🍅 block logic.
- In the browser: ride, click a bubble (hole opens at the hit side), hold and sweep across
  several (combo climbs, chime rises), shoot the sea (ripple), land (bubbles fade, no draw calls),
  Low/High counts, reduced motion, touch button.
- `npm run build` clean, no console errors, 60 fps on Medium.

## 10. Delivery

- **15r-a:** bubbles, burst, laser, crosshair, hit detection (playable without sound or score).
- **15r-b:** sounds, HUD, combos, 🍅, touch button, fly tip, README / shortcuts.

Learning-mode contributions for the user (5–10 lines each): the combo / score rule in
`BubbleHunt`, or the spawn-position rule in `bubbleField`.
