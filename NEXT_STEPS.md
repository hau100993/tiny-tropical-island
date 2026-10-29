# NEXT_STEPS.md — Thú Cưng (Phase 13): what is left

Hand-off from the cloud session (2026-10-29) to work on the Windows PC in VS Code (with or
without Claude Code). The approved design and the status table live in `PLAN.md` (*Phase 13*);
this file is the to-do list. Delete it (or fold it into `PLAN.md`) when it is done.

## Where things are

- Branch: **`claude/thu-cung-phase-13`** (not merged into `main` yet; `main` has only the phone
  audio fix, PR #1).
- Run: `git fetch origin && git checkout claude/thu-cung-phase-13 && npm install && npm run dev`.
- Checks: `npm run build` (type check + bundle) and `npm test` (209 tests) both pass.
- Code map:
  - `src/pets/`: rules and save, all pure and tested. `ledger.ts` (event log, earn rules,
    merge), `roster.ts` (pets, Ranks, eggs, traits, team, actions), `species.ts` (all species,
    skills, eggs, `MODEL_SOURCES`), `wallet.ts` (localStorage), `PetGame.ts` (the game on the
    island), `notices.ts`, `drive.ts` / `sync.ts` / `DriveSync.ts` (optional Drive sync).
  - `src/world/pets/`: `petModels.ts` (loads `.glb`), `bodies.ts` (stand-in body, accessories),
    `looks.ts` (tint, shiny, Level 2 aura), `PetActor.ts`, `recipes.ts` (skills),
    `ceremony.ts`, `wildVisitors.ts`, `tomatoToss.ts`.
  - `src/ui/CampView.ts` (the "Thú Cưng" tab), `src/ui/FeedBubble.ts`.
  - `scripts/fetch-pet-models.mjs` (`npm run pets:models`).

## 1. Models for the ten species (blocked in the cloud: poly.pizza unreachable)

1. [ ] `npm run pets:models`. It downloads every model in `MODEL_SOURCES` to
   `src/assets/creatures/pets/<species>-<l1|l2|shiny>.glb` and prints each title and licence.
   - A line starting with `!` means no `.glb` link was found on the page: open the page,
     *Download → glTF (.glb)*, save it under the name shown.
   - **Kim Quy:** its id `2LCcq8vhqJ3` has 11 characters (the others 10). If it fails, fix the
     id in both `src/pets/species.ts` and `scripts/fetch-pet-models.mjs` (a test checks they match).
2. [ ] **Licences:** keep CC0. For CC-BY, add a row to *Credits and licenses* in `README.md`
   (title, author, link, licence). Drop anything that is neither.
3. [ ] Run `npm run dev`, open the "Thú Cưng" tab, hatch or befriend one of each (see *Testing
   shortcuts* below), and look at each species:
   - Height, flying height, speed: `FIT` in `src/world/pets/petModels.ts`.
   - Clips: `CLIP_PATTERNS` in the same file picks idle / move / skill / greet / dance by name.
     If a model's clip names don't match (it stands still, or slides), log
     `gltf.animations.map(a => a.name)` in `loadPetModel` and add its names to the patterns.
   - Accessories (bow, Level 2 crown/flowers/flames/pumpkin/sword) sit at `body.head`; if one
     floats or sinks, adjust `addAccessory` in `src/world/pets/bodies.ts` (per-species offsets
     can go in `LEVEL2_ACCESSORY` or a new table).
   - Facing: models should walk along +z. If one walks backwards, rotate the fitted scene by π
     in `loadPetModel` for that species.
4. [ ] **Name species 7 and 8** (now "Thú Lạ" / "Thú Hiếm", ids `kind7`, `kind8`): set `name`,
   `name2`, `element`, `emoji`, `color`, auto `names`, and rename their skills in
   `src/pets/species.ts` (and the matching entries in `src/world/pets/recipes.ts`; a test checks
   every skill has a recipe). Rename the ids too if you like (`kind7` → e.g. `fox`): then also
   rename the `.glb` files and the keys in `MODEL_SOURCES`, `FIT`, `LEVEL2_ACCESSORY` and the
   script.
5. [ ] Commit the `.glb` files (about 5–15 MB in all; they load only when needed).

## 2. Test on the real PC (not possible in the cloud: headless Chrome ran at ~0.7 fps)

- [ ] **Frame rate** at Medium on the RX 6600 with 5 new pets out and a skill running (debug
  overlay: `` ` ``). Target 60 fps. If low: fewer particles in `recipes.ts`, or `TEAM_MAX` in
  `roster.ts`.
- [ ] **Feeding:** walk (`C`) up to Mochi / Mầm / a new pet: the bubble shows; click, hold, or `E`.
- [ ] **Evolve** (Rank 15, 20 🍅) and **hatch** (buy an egg, finish sessions, *Nở!*): the
  ceremonies, then the new look.
- [ ] **Wild visitors:** rain on (Cảnh) + beach → Ếch; fine day + lawn → Ong; night (`N` / time
  slider) + forest → Nhện; dawn or dusk + forest edge → Nai. Three tomatoes → it joins you.
- [ ] **No spending during focus:** start a Pomodoro: the camp locks, no bubbles.
- [ ] **Backup:** *Cài đặt → Sao lưu* export, clear site data, import: everything back.
- [ ] **Phone sound fix** (PR #1) on a real phone: one tap starts sound; iPhone with the silent
  switch on.

### Testing shortcuts

Tomatoes take real 20-minute sessions. To test quickly, paste a log in the browser console
(DevTools → Console) and reload. Example: 200 tomatoes and one ready 10-session egg:

```js
const ev = []; let t = Date.now() - 90 * 864e5;
for (let i = 0; i < 200; i++) { t += 864e5 / 4; ev.push({ id: 'f' + t, t, kind: 'focus', n: 1 }); }
ev.push({ id: 'gTest1', t: (t += 6e4), kind: 'egg', n: 20, s: '10' });
for (let i = 0; i < 10; i++) { t += 6e4; ev.push({ id: 'f' + t, t, kind: 'focus', n: 1 }); }
localStorage.setItem('tsw.pets', JSON.stringify({ v: 1, events: ev })); location.reload();
```

Change the egg id (`gTest1`, `gTest2`…) to get other species (the egg's id decides what hatches;
`eggContents` in `roster.ts`). Remove `tsw.pets` afterwards (or import your real backup).

## 3. Decisions still open (marked "to confirm" in PLAN.md)

- [ ] The limit of 5 out on the island applies to new pets only (the five originals are always there).
- [ ] Ranks make the recipe skills bigger, not the originals' hand-made Level 1 skills.
- [ ] Earning rules: focus ≥ 20 min, ≤ 16 🍅 a day, none for sessions that ended while the
  browser was closed (`MIN_FOCUS_MIN`, `DAILY_FOCUS_CAP`, `LIVE_SLACK_MS` in `ledger.ts`).
- [ ] Feeding: a pet you walked past without feeding asks again after 10 minutes (`ASK_AGAIN_MS`
  in `PetGame.ts`).

## 4. Optional: Google Drive sync

Steps in `README.md`, *Saving to Google Drive*: Google Cloud project, Drive API, OAuth web client
(origins `https://hau100993.github.io` and `http://localhost:5173`), then the client id in
`.env.local` (`VITE_GOOGLE_CLIENT_ID=…`) and as the repository variable `GOOGLE_CLIENT_ID` for
GitHub Pages. Test: turn it on in the camp on the PC and on the phone, feed on one, sync, check the
other.

## 5. Later (not started)

- [ ] **13e:** balance prices and pacing after 1–2 weeks of real use (`rankCost`, `EVOLVE_COST`,
  `EGGS` costs, shiny odds). Extra tomato sources (found on the island, in the forest, mini-games):
  discuss first.
- [ ] **11d:** PWA (home-screen install; on iPhone it also stops Safari clearing the data after 7
  days unused) and moving a save between devices by QR code.

## 6. Merge

- [ ] When it all works: open a PR from `claude/thu-cung-phase-13` into `main` (GitHub Pages
  deploys `main`), update the Phase 13 row in `PLAN.md`, delete this file.
