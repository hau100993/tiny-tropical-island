# Tropical Soundscape World — Đảo Nhiệt Đới

A local web app for Windows 11 that you leave open while you work: a small stylized tropical
island with GPU water, weather, day/night and your own ambient sound recordings. Fully offline,
no backend.

> Status: **Phase 7c** — island, GPU water with reflections, scene presets (weather + sky +
> time), a library of your own recordings that play with the scenes (synthesized sound as the
> fallback), a day/night cycle with clouds, stars and aurora, walking around the island, a
> modern wooden house with a work desk facing the sea, and a Pomodoro timer.
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
| `npm test` | Unit tests (Vitest; run through `scripts/test.mjs`, which works around a Vitest bug on Windows when the folder is opened as `d:\…` with a lower-case drive letter) |

### Public demo (GitHub Pages)

Live at **https://hau100993.github.io/tiny-tropical-island/**. Every push to `main` rebuilds it
via [.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml) (one-time setup:
repo **Settings → Pages → Source: GitHub Actions**). The public site has no audio files (they are
git-ignored), so visitors hear the synthesized sounds; recordings a visitor adds stay in their
own browser.

## First start

The island shows right away, no start screen. Browsers only allow sound after you interact
with the page, so the sound starts with your **first click or key press anywhere**; until then
the panel shows a **Bật âm thanh** button above the volume (a note at the bottom of the screen
appears only if starting the sound failed).

Want it silent? Press `M` or the speaker button next to *Âm lượng chung* (mute is remembered).

## Controls

| Input | Action |
|---|---|
| Left-drag | Rotate the camera; drag down to bring it to the sand or the sea surface and look up at the sky (it never goes below them) |
| Wheel / pinch | Zoom |
| Right-drag | Pan (up/down lifts the point you look at, e.g. into the sky) |
| Click on the water | Splash: ripples spread and bounce off the beach |
| `M` | Mute / unmute everything |
| `P` | Collapse / expand the control panel (or click its title) |
| `1` – `9` | Pick a scene, in the order of the panel's cards (the key shows on each card) |
| `H` | Hide all UI (clean wallpaper view); press again to show |
| `N` | Stop / run the clock (stopping the real-time clock freezes the island at that moment) |
| `C` | Walk around the island; press again to go back to the orbit view |
| `V` | While walking: character view (third person) ↔ eyes view (first person) |
| `T` | Pomodoro: show the timer and start / pause it |
| `B` | Work desk: sit down at the desk in the house (from anywhere) / get up |
| `E` | While walking next to the desk or the bathtub: sit down / get in; seated: get up |
| `Esc` | Seated (desk or bathtub): get up |
| `` ` `` (backquote) | Show/hide the stats overlay (FPS, CPU/GPU ms, draw calls) |

### Control panel (top right)

Always visible at the top: the **Pomodoro clock** button (shows the time left while a session
runs; click to show or hide the timer card), collapse (or click the title **Đảo Nhiệt Đới**), a
**status line** (scene · what is playing · island time) and **Âm lượng chung** with mute. Below,
five sections that each open and close on their own (remembered; on first launch **Cảnh**, with
*Ngày nắng* selected, and **Góc nhìn** are open); a closed section shows its current value next
to its title (hidden while the section is open). Collapsed, the panel keeps a one-line header:
title, the current scene, mute, Pomodoro and expand. The selected scene card is tinted and has a
✓ on its icon; cards keep an even height (only a long name makes its own row taller).
Every slider also moves with the **mouse wheel** over it (wheel up = more): 5% per notch,
15 minutes on the **Giờ** sliders (wrapping past midnight); hold **Shift** for fine steps (1%,
or the slider's own time step). Volume sliders move 2% per notch below 20%, where the ear hears
small changes. While the panel is scrolling, the wheel keeps scrolling it, so passing over a
slider doesn't change it. A floating value shows over the thumb while you wheel.
**Double-click** a slider's row to return it to its default (master 80%, recordings 70%, scene
effects their normal level). Small ticks mark 06:00 / 12:00 / 18:00 on the **Giờ** sliders and
the normal 50% (30% for **Trăng sáng**) on the sun and moon sliders. The Pomodoro minute boxes
also take the wheel when the pointer is over their row (±1, Shift ±5).

- **Cảnh:** scenes as cards: icon, name, and a second line with the scene's time (or *Giữ
  giờ*) and ♪ when it plays recordings of its own. Clicking a card switches to the scene and
  its sound. Below: **+ Tạo cảnh**, **Sửa cảnh**, **Khôi phục gốc** (edited built-ins) and
  **Xóa** (your scenes); see *Scenes and your recordings*.
- **Âm thanh:** **Âm thanh của tôi** (your recordings) and **Âm nền tự tạo khi không phát
  file** (the synthesized fallback, see below).
- **Thời gian:** a big hh:mm:ss clock with **Dừng / Chạy**, **Giờ thật (theo máy tính)**, the
  **Giờ** slider and the speed (×1 · ×10 · ×30 · ×60 · ×240), see *Day, night and sky*.
- **Góc nhìn:** tiles for **Toàn cảnh**, **Đi bộ**, **Góc làm việc**, **Bồn tắm** (the current
  one is highlighted, each shows its key), and switches: character view (`V`), footsteps,
  camera auto-rotate.
- **Cài đặt:** quality (Thấp / Vừa / Cao; anti-aliasing changes between Low and the others
  apply after a reload), **Mở app ở góc làm việc**, **Nhấp vào cảnh 3D để thu gọn bảng** (off by
  default: a click on the island without dragging collapses the panel), and the keyboard
  shortcuts.

On/off options are switches; buttons only do things.

## Scenes and your recordings

A **scene** sets the weather and sky effects (rain, snow, wind, waves, clouds, gloom, rainbow,
moonlight, stars, shooting stars, aurora, fireflies), optionally a time of day, and its sound:
the recordings chosen for it, or, with none chosen, the synthesized ambience that follows its
effects (rain sound with rain, and so on). Recordings and the synthesized ambience don't mix:
to layer sounds, choose several recordings.
Built in: *Bình minh ơi* (sunrise, 06:12), *Ngày nắng*, *Hoàng hôn yên ả* (sunset, 17:54, the sun touching the sea),
*Bão nhiệt đới*, *Mưa rừng*, *Đêm lửa trại*, *Đêm trăng tròn* (19:15, a big bright full moon and
its path on the sea), *Sáng sương mù*, *Đêm tuyết cực quang*.

**+ Tạo cảnh** and **Sửa cảnh** (the selected scene) open the scene editor in place of the
cards. Everything you change shows on the island right away; **Hủy** (or ‹) puts the island
back as it was, **Lưu cảnh** stores the scene and plays it. The editor has four parts:

1. **Tên cảnh** (a built-in keeps its name; names must be unique).
2. **Thời gian:** *Không đặt giờ* (picking the scene keeps the island's clock) or *Đặt giờ*:
   the **Giờ** slider (5-minute steps), **Dùng giờ lúc mở**, and **Mặt trời / trăng hiện ở cửa
   sổ bàn làm việc** (on by default), which turns the sky so that hour's sun, or at night the
   moon, sits in the desk window. Picking a scene with a time jumps there and the clock runs on
   from it (at the chosen speed); while you edit, the preview holds that time still.
3. **Hiệu ứng:** the weather and night-sky sliders and switches.
4. **Âm thanh:** switch on the recordings that play with the scene, each with its volume, or
   **+ Thêm file từ máy…** (the new file is switched on). None on: the synthesized ambience.

Built-ins can be edited too (effects, time, sound); **Khôi phục gốc** restores their original
effects and time. **Xóa** and **Khôi phục gốc** ask for a second click. Up to 30 scenes of
your own.

**Âm thanh của tôi** holds your recordings (e.g. a one-hour rain MP3 you downloaded):

1. **+ Thêm file** (or drag files onto the list). MP3, OGG, WAV, M4A, FLAC, WebM. The file is
   **copied into the browser's storage** (IndexedDB), so it is there next time without asking;
   the original on your PC is not touched. An hour of MP3 at 128 kbps is ~58 MB.
2. **▶** on a recording that is mapped to scenes (step 3) switches to its scene: the
   first scene it is mapped to, unless the active one is among them. **⏸** then leaves the
   scene (its recordings fade out; the effects stay). On a recording without mappings, **▶**
   plays it on its own, with its own volume, whatever the scene.
3. **⚙ → Tự phát khi chọn cảnh:** switch on the scenes it belongs to, each with its own
   volume (e.g. "Sóng biển 1h" at 70 % in *Hoàng hôn* and 100 % in *Bão*); the same as the
   *Âm thanh* part of the scene editor. Choosing such a scene fades its recordings in over ~3 s and the previous scene's out. Tags under the name
   show the mapping; the active scene's tag is highlighted.
4. ⚙ also renames, **Thay file…** (replace the audio with another file from your PC, keeping
   the name, volume and scene mappings), or deletes (click **Xóa file**, then again to confirm; deleting removes the browser copy
   only).

**Built-in recordings.** Two 15-minute recordings ship with the app and appear in the list
marked *có sẵn*: **Ban ngày trên đảo** (plays with *Bình minh ơi* and *Ngày nắng*) and **Ban
đêm trên đảo** (plays with *Đêm trăng tròn* and *Đêm lửa trại*). A default mapping added to
`library.json` later is given once to lists saved before it; one you removed stays removed. They stream from the site instead of being copied into the browser, and
you can change their volume, mappings and name like your own, or **Thay file…** with a file of
your own (**Dùng lại file gốc** switches back). ⚙ → **Ẩn khỏi danh sách** hides
one; **Hiện âm thanh có sẵn** brings it back. To ship more, put files in
`public/audio/library/` and list them in `library.json` there (`id`, `name`, `file`, `mappings`
with preset ids such as `b-sunny`, `b-campfire`); a listed file that is missing is skipped.

Long files are streamed by an `<audio>` element (a few MB of memory, not the ~1.4 GB an hour
would take decoded) and routed through the app's audio graph, so master volume, mute, the snow
muffle and the Pomodoro calm apply to them. A file the browser can't play is marked
*Không phát được* and skipped.

**Synthesized fallback:** with **Âm tổng hợp khi chưa có file** on (default), the built-in
synthesized soundscape plays whenever none of your recordings is playing, and it follows the
scene (rain slider → rain sound, wind → gusts, waves → surf, birds by day). As soon as a
recording plays it fades out. So a scene with no recording is never silent.

## The house and the work desk

A modern, minimal wooden house on stilts, a few steps up from the beach: dark vertical board
cladding, a mono-pitch roof with **8 solar panels** and a **Starlink** dish (battery and inverter
under the floor), and a **floor-to-ceiling glass wall** facing the sea with a deck in front
(glass railing, wide open wooden stairs (1.45 m) at its right end, with bougainvillea
climbing the handrails and a clear way out from their foot, the sliding glass door is
the way in). Inside, Japanese-style and sparse, under exposed timber beams: a tea corner by the
left window (low chabudai table on tatami, zabuton cushions, a cast-iron teapot and cups, a book),
a futon on tatami with a paper lantern, a low bookshelf, an open bath corner (no partitions: a
hinoki tub under a big window onto the forest behind the house, a rain shower, slate floor), a
monstera with split leaves and a snake plant, and a long oak desk along the glass with **two
27" thin-bezel monitors** on aluminium stands (their top edge stays below eye level, so the sea
is in view above them), a felt desk pad, a **tenkeyless mechanical keyboard in the Keychron K8
style** (87 keys on the real layout, space-gray frame, orange Esc and Enter, an RGB backlight whose
rainbow drifts across the board, glowing between the keys, soft by day and bright at night),
a mouse on the right, a round Akari-style washi paper lamp on wire legs (glows at night) and a
white moth orchid (Phalaenopsis) in bloom on a bamboo stake, and a mug. The lamp stands at the
left end of the desk, the orchid and the mug at the right end; soft contact shadows under the
monitor feet, keyboard, mouse, mug, pot and lamp set them down on the desk.

**The print on the mug:** the TMA logo, `src/assets/decor/mug-logo.png`. Its white background
is dropped and the rest is wrapped around the side of the mug that faces the chair. To print
something else, put your own image at `src/assets/local/mug-logo.png` (or `.jpg`/`.webp`;
that folder is git-ignored and takes precedence) and restart `npm run dev`. Wood has a procedural grain (shader, no textures); cushions, futon, chair and
ceramics are rounded and smooth-shaded. Trees are kept out of the view from the glass to the sea.

**Out at sea:** a Vietnamese fishing boat (blue hull, red bottom, high bow, white-and-blue cabin,
the red flag with the yellow star on both masts and a line of coloured pennants) cruises a slow
loop about 150–200 m out, in the upper right of the view from the desk. It rides the same waves
as the sea, with a bow wave and a short wake (`src/world/fishingBoat.ts`).

**Sitting at the desk:** press **B** (or *Góc làm việc* in the panel) from anywhere, or walk in
and press **E** next to the chair. At the desk:

- **drag** with the mouse to look around (screens, the sea, the room); **scroll** to lean in and
  read the screens; **E**, **Esc** or **B** to get up: you stand next to the chair, in the room
  (even if you sat down from the orbit view; **C** then takes you back to it). The mouse stays free, so the panel and the
  Pomodoro card work as usual.
- **Left monitor:** a code editor that slowly types code (a few files of this project).
  **Right monitor:** the clock and date, the Pomodoro timer, the scene preset and its effects,
  what is playing, and the time on the island.
- Rain is muffled indoors; at night the pendant lamp and the desk lamp light the room.
- **Mở app ở góc làm việc** in the *Hiển thị* section opens the app straight at the desk.

**Soaking in the tub:** **Ngâm bồn tắm** in the panel (from anywhere), or walk to the bath corner
and press **E** next to the tub. You sit in the water looking out of the big window at the
forest; drag to look around, **E** or **Esc** to get out.

## Pomodoro (`T` or **Pomodoro (T)** in the panel)

A small card in the bottom-left corner: **25 min focus → 5 min break**, and a 15 min long break
after every 4 focus sessions (the dots show how many are done). Buttons: start/pause, skip to
the next part, reset, settings (⚙), hide (✕).

- **Settings (⚙):** lengths of focus, short and long break (minutes), long break after N
  sessions (0 = never), and three switches:
  - **Tự chạy tiếp** — the next part starts by itself (otherwise the timer waits for you).
  - **Chuông báo** — a soft bell when a part ends (falling notes into a break, rising back to
    focus). It rings even when the soundscape is muted with `M`.
  - **Bão dịu đi khi nghỉ** — during breaks rain, wind and snow (sound *and* visuals) ease down to
    30 % over ~20 s, and come back when focus starts.
- The browser tab title shows the countdown (e.g. `18:42 · Tập trung`), so you can see it on the
  taskbar.
- Works with the tab in the background: the bell is placed on the audio clock in advance, so it
  rings on time even though Chrome runs background timers only once a minute.
- The timer is saved: reloading the page or restarting the browser continues where it was.

## Sound files in the project folder (advanced, optional)

For people building the project: a synthesized layer can also be replaced by files placed in
`public/audio/` (this changes the *fallback* sound; the in-app library above is usually easier):

1. Put audio files under `public/audio/` (any sub-folders), e.g. `public/audio/waves/beach1.ogg`.
   OGG (Vorbis/Opus), MP3, WAV, M4A, FLAC and WebM work in Chrome/Edge.
2. List them in [`public/audio/config.json`](public/audio/config.json):

   ```json
   {
     "layers": {
       "waves": {
         "files": ["waves/beach1.ogg", { "src": "waves/beach2.mp3", "gain": 0.8, "loopEnd": 59.9 }],
         "crossfadeSec": 4,
         "rotateEverySec": [90, 240]
       }
     }
   }
   ```

   | Field | Default | Meaning |
   |---|---|---|
   | `files` | — | Paths relative to `public/audio/`. A plain string or an object with the fields below |
   | `gain` | 1 | Level of this file (0–4), to match recordings to each other |
   | `loop` | true | `false`: play once, then crossfade to the next file |
   | `loopStart`, `loopEnd` | 0, end | Loop points in seconds (cut MP3 padding or a bad ending) |
   | `crossfadeSec` | 4 | Equal-power crossfade when switching files |
   | `rotateEverySec` | [90, 180] | With several files: switch to a random other one after this many seconds |

3. Reload the page (in `npm run dev` new files are picked up right away; for the built version
   run `npm run build` again, or drop the files into `dist/audio/` and use `npm run preview`).

When a layer's first file is decoded it crossfades from the synthesized sound to the recording,
and the panel shows **tệp** next to it. Missing files and files that can't be decoded are
skipped with one `console.info` line; if none work, the layer keeps its synthesized sound.
Volume, mute, walk-mode position and the weather link work the same for recordings.

Tips: OGG loops seamlessly; MP3 adds a little silence at the start and end (use `loopStart`/
`loopEnd`, or convert to OGG). Keep loops between 30 s and 3 min: each file is decoded into
memory (~20 MB per stereo minute) and at most two per layer are kept. Check the license of
every file you use (e.g. [Freesound](https://freesound.org) with the CC0 filter); don't commit
files you may not redistribute. More details in [`public/audio/README.md`](public/audio/README.md).

## Walking on the island (`C` or **Đi bộ trên đảo** in the panel)

Two views, switched with `V` (or **Thấy nhân vật** in the panel): behind your character, like
a game (default), or through the character's eyes. The character is a young man dressed for
the beach, built entirely in code (Korean-style curtain hair: a middle part, volume on top and two swept
bangs framing the forehead, slim-fit
pale linen shirt with an open collar, board shorts, flip-flops, a bead bracelet, fair skin and a
friendly face). The head is a sculpted sphere (jaw, cheekbones, nose, eye sockets, ears); the hair
grows from a hairline and is made of tapered locks; chest, arms and calves have muscle shape; hands
have fingers, feet have toes. The body is a skinned mesh on a 15-bone skeleton, so knees and
elbows bend smoothly. The walk follows a real gait cycle (heel strike, the knee giving under the
weight, push-off from the toes, the knee folding as the leg swings through, hips dropping and
turning against the shoulders); running adds a flight phase and pumping arms. He breathes, blinks
and looks around slowly when standing.
In the character view the camera pulls in when a wall, the roof, a trunk or the ground is
behind you, so it works inside the small room too.

| Input | Action |
|---|---|
| Mouse | Look around (the browser captures the mouse and briefly says how to release it with Esc) |
| `W` `A` `S` `D` / arrow keys | Walk |
| `Shift` (hold) | Run |
| Click | Splash: a ripple where you look, if that is water |
| `V` | Switch between the character view and the eyes view |
| `Esc` | Stop walking and return to the orbit view (also `C`) |

- You start at the foot of the porch steps, looking out to sea; next time you continue where you
  left off. The control panel hides while walking (the mouse is captured); `H` hides the hint too.
- You follow the ground, can climb the steps onto the porch and walk into the room; trunks, rocks,
  walls, railings and furniture block you (you slide along them).
- You can wade into the sea up to about 0.9 m deep; the deeper, the slower.
- If the mouse is not captured (e.g. right after pressing `Esc`, the browser waits a moment),
  the hint says **Nhấp vào cảnh…**: click the scene.
- **Sound follows where you are:** footsteps change with the ground (sand, grass, rock, wooden
  floor, splashing water, snow crunch; switch off with **Tiếng bước chân**). The surf is loud on
  the beach and fades inland, coming from the sea's side; birds get louder among the trees;
  inside the room everything is muffled and rain sounds like rain on the roof. No rain or snow
  falls under the roof, and the floor stays dry.
- Head bob is off when Windows' "Animation effects" is disabled (`prefers-reduced-motion`).

## Day, night and sky

**The clock** (*Thời gian* in the panel):

- **Giờ thật (theo máy tính):** the island follows your computer's clock, to the second.
- Otherwise the island has its own clock. Drag **Giờ** to any time and it runs on from there
  (dragging while stopped, or while on real time, starts it again).
- **Tốc độ:** ×1 (1 s = 1 s), ×10 (a day ≈ 2.4 h), ×30 (≈ 48 min), ×60 (1 s = 1 min, a day ≈
  24 min, the default) and ×240 (1 s = 4 min, a day ≈ 6 min). Picking a speed starts the island
  clock from the current time.
- **Dừng / Chạy** (or `N`) stops and restarts it. A scene with a time of day starts
  the clock from that time (it keeps running).

The other sky options are scene effects (*Cảnh → Sửa cảnh / Tạo cảnh → Hiệu ứng*):

| Option | What it does |
|---|---|
| Mây trôi | Cloud cover; clouds drift with the wind, glow at sunset, and cast moving shadows on the island and sea. Rain and snow add more cloud. |
| Mặt trời: Độ sáng | Brightness of the sun disc and its glare; 50 % is normal (×0.4 … ×1.8), brighter pushes it toward white. |
| Mặt trời: Kích thước | Size of the sun disc; 50 % is normal (×0.6 … ×2.2). |
| Mây dạng sợi | Cirrus: clouds as thin streaks drawn across the view from the desk (thin, see-through, catching the low sun's light) instead of puffs. |
| Trời u ám | Grey, gloomy sky without rain. |
| Cầu vồng sau mưa | After rain, with a low sun behind you, a rainbow appears at the real 42° angle. |
| Sao & Ngân Hà | Twinkling stars and a faint Milky Way that slowly wheel across the night sky. |
| Sao băng | How often shooting stars cross the visible sky: thin, star-sized streaks with a fading tail, in random directions, sometimes two or three at once. |
| Trăng sáng | Moon size and brightness: 30 % is the normal moon; higher gives a bigger, brighter full moon, a wider glow, stronger silver moonlight on the island and a brighter path on the sea. Clouds dim it. |
| Cực quang | Green-violet aurora ribbons with vertical rays: brightest over the sea in front of the desk window (so you see it while working) and toward the north (the overview), a faint glow elsewhere. They move on several rhythms: the ribbon slowly sways into S-curves (~40 s), folds travel along it (~7 s), rays slide and flicker (1–3 s), and now and then a wave of brightness runs along it (~30 s). The sea reflects them at every quality level. With *reduce motion* turned on in Windows, rays and folds almost stand still. |
| Đom đóm | Fireflies blinking around the garden and forest edge at night. |

**Sky direction per scene.** The desk window faces east, so the real sunset would be behind
you. *Bình minh ơi*, *Hoàng hôn yên ả* and *Đêm trăng tròn* therefore turn the whole sky (sun,
moon, stars) around the vertical so their sun or moon sits in the desk window, a little left of
the monitors; the sky swings there smoothly when you pick the scene. Any other scene with a time
of day turns it back to the real direction (scenes without a time keep the current one). In the
scene editor, **Mặt trời / trăng hiện ở cửa sổ bàn làm việc** does the same for any time.

**Sunrise and sunset.** Low over the sea the sun is one even colour (deep orange on the sea,
golden a little higher, near white high up), only slightly darker and redder at the rim, with a
soft edge that melts into a wide glare (drawn after tone mapping, so it never bleaches to
cream); refraction squashes it a little and the horizon cuts it. The warm colours belong to the
sun's side of the sky: they fan out over the horizon below the sun and fade sideways and
upward, while the opposite sky stays a cool blue-lilac (with Earth's shadow and a faint pink
band just after sunset). *Sunrise*: warm amber and peach
tones, a soft pink horizon, a clear sky with a few glowing (golden-peach) clouds and a golden
road of sparkles on calm water. *Sunset*: a warm amber-orange sky, a golden sun on the horizon,
coral-pink clouds, and a sea that stays a clear blue away from the sun while carrying the
golden light toward it. The sky
depends on where you look: toward the sun a warm glow fans out over the horizon; opposite it,
around sunset, Earth's shadow rises as a dark blue band under the pink *Belt of Venus*. The
palette has a golden hour (warm light, cool bluish shadows) and a blue hour (deep blue with a
lilac horizon). Clouds are lit from below: gold, then orange, red-pink as the sun touches the
sea, and magenta-violet after it has set, while the sea darkens; their edges blaze with the sun
behind them, and with gaps near a low sun faint sunbeams fan out. A haze lies over the horizon
(warm toward the sun, grey-blue away from it), and at sunrise a soft pink-peach haze lies low
over the sea. With a clear horizon, the last sliver of the
setting sun (or the first of the rising one) can flash green for a moment.

**The moon.** It shows the real near side's dark "seas" (maria) and bright Tycho with its rays.
Low over the horizon it is orange and dimmer, and so is its light on the island; high up it is
silver-white. It lays a road of glints on the sea: single wave facets flash, and more waves
make the road wider and more broken (the sun does the same, more softly). Thin cloud passing
in front glows around it and gets silver edges; thick cloud hides it. Now and then, with a thin
veil of cloud (cover roughly 15–60 %), a faint 22° halo ring appears around it for a few
minutes. At night, dark surfaces lose their color toward a cool blue-grey (as the eye sees in
dim light) while lamps and lit windows keep theirs.

The sun rises in the east and sets in the west (with the real sky direction); dawn and dusk paint the horizon. At night the
moon lights the scene in silver and leaves a glittering path on the sea, the house windows and
porch lantern light up, birds fall silent and crickets start (needs the *Chim hót* layer on).
The chosen time is remembered between sessions.

## Vegetation

The island is zoned like a real tropical island, from the coast inward:

| Zone | Plants |
|---|---|
| Coast | coconut palms leaning out over the sand |
| Garden around the house | banana clumps (with fruit bunch and purple bud), papaya, mango and breadfruit trees with fruit, frangipani (white or pink blossoms), hibiscus bushes (red, yellow, pink) |
| Rainforest (inland, up the hill) | canopy trees in varied greens (one variant flowers crimson-orange like a flame tree), emergent giants with buttress roots, tree ferns; a dark mossy floor with leaf litter |
| Understory and floor | shrubs, ground ferns, heliconia ("lobster claw" flowers), wildflower meadows in four colors on the grass |

**The forest trail:** from the sea, stepping stones lead up the beach to a wooden signpost
("Đường mòn"); the path then runs along the left side of the house (seen from the sea), passes
behind it into the forest, winds through the heart of the rainforest and comes out on the beach
on the far side (~170 m). It is clearest at the entrance and fainter deeper in. It is only half there: trodden earth and leaf litter in the middle, moss and grass
creeping back over it, ferns and shrubs crowding its edges and wildflowers along both sides;
the big trunks stand back so it stays walkable and their crowns meet overhead. On sunny days,
shafts of sunlight slant down through the canopy onto the path (they follow the sun, fade with
clouds and rain, and slowly breathe as the leaves move). Walk it with `C`; look up to see the
sky through the leaves.

All plants are generated in code and drawn with one shared material (one draw call per plant
variant); wind bends each species according to its stiffness.

## Weather

| Effect | What happens |
|---|---|
| Rain | GPU rain streaks, raindrop rings on the sea, ground darkens and glosses over ~30 s (dries over ~2 min), puddle sheen on flat sand, grey sky, dimmer sun |
| Wind | palms, fronds and grass bend and flutter; the sea gets rougher. The gusts you see are the gusts you hear (both read the same `gustShape(t)`) |
| Snow | falling flakes; snow settles over ~90 s — first in patches, then everywhere (leaves, roofs, sand) — and melts slowly when it stops |
| Rain + snow | sleet: fewer particles of each; snow only settles if it outweighs the rain, and melting snow makes things wet |

Settings, presets and the panel state are saved in `localStorage`; your recordings in IndexedDB.

### What the quality presets change

| | Thấp (Low) | Vừa (Medium) | Cao (High) |
|---|---|---|---|
| Ripple simulation grid | 128² | 256² | 512² |
| Refraction (see the seabed bend through the water) | off (transparent water) | on | on |
| Reflection of palms, house and rocks in the water | off (sky only) | off (sky only) | on (+~0.7 ms GPU) |
| Caustics (light patterns on the seabed) | off | 384² | 512² |
| Shadows | off | 1024² | 2048² |
| Grass blades | 4k | 15k | 40k |
| Wildflower clumps | 1.5k | 5k | 10k |
| Rain streaks / snowflakes (max) | 3k / 2k | 10k / 6k | 25k / 15k |
| Max pixel ratio | 1.0 | 1.25 | 1.5 |

## How the water works (short version)

- **Swell:** 5 Gerstner waves computed in the vertex shader; they fade out in shallow water and far away.
- **Ripples:** a 200 m × 200 m height grid lives in a GPU texture. Each step, every cell
  accelerates toward the average of its 4 neighbors (the discrete wave equation). Two textures
  are swapped every step (double buffering). Land cells are pinned to zero, so ripples reflect.
- **Refraction:** the scene without water is rendered at half resolution; the water shader
  samples it, shifted by the surface normal and tinted by how much water the view ray crosses.
- **Reflection (High):** the scene is rendered a second time at half resolution from a camera
  mirrored below the sea level, with its near plane tilted onto the water plane so nothing under
  water leaks in. The water shader looks that image up, bent by the wave slopes; where nothing
  is reflected it uses the sky color.
- **Caustics:** a fine grid of "sun rays" is refracted through the surface and drawn where it
  lands on the seabed; where rays converge, triangles shrink and get brighter.
- **Swash (the moving waterline):** near the shore the water surface itself runs up the beach
  in ~2 s and drains back over ~7 s. Every ~12 m stretch of beach has its own timing and every
  wave its own size, so the waterline never keeps one shape. One shared function
  (`water/shaders/swash.glsl`) drives the water height, the foam and the wet sand, so they stay
  in step: dark sand up to where the last wave reached, glossy right behind the draining water.
- **Surf foam:** the shader decides *how much* foam a spot should have (a thick white front while
  a wave runs up, streaky lace while it drains, breaking bands further out, lines bent by noise),
  then a cellular "lace" pattern decides *where*: thin foam breaks into a bubbly net, thick foam
  is solid white.
- **Ground:** the terrain is smooth-shaded; sand and grass are blended per pixel with ragged,
  noise-driven edges, plus sand grain, ripples, pebbles and grass streaks that fade out with
  distance (no textures).

Rendering stops completely while the tab is hidden (the stats overlay shows how long the last
pause was). Sound keeps playing.

## How the sound works (short version)

The fallback sound is generated in code with the Web Audio API — no audio files are needed.

- **Noise colors** (white, pink, brown) are generated once into 8 s looping buffers; each layer
  filters them differently. Loops are made seamless so they never click.
- **Waves:** a brown-noise rumble plus surf swells that rise, break and wash up the beach every
  6–10 s (more often and louder when *Sóng biển* in the scene section is higher).
- **Wind:** a resonant band of pink noise whose pitch and level follow random gusts, plus leaf rustle.
- **Rain:** pink-noise hiss + two pre-rendered droplet loops (5.0 s and 7.3 s, so the pattern
  repeats only every ~6 min) + low rumble.
- **Birds:** short sine "calls" (5 species patterns) at random times and stereo positions.
- **Tuyết lặng:** a very soft hush; it also muffles the other layers (snow absorbs high frequencies).
- **Footsteps** (walk mode): each step is a few short filtered-noise bursts and pitched blips,
  shaped per surface, with random pitch/level and alternating left/right feet.
- **Walk mode mix:** every layer passes through its own stereo panner and low-pass filter, so
  position can move it left/right and muffle it (indoors) without touching the synth itself.
- Timed events (swells, gusts, bird calls) are scheduled on the audio clock. When the tab is
  hidden, Chrome may run timers only once a minute, so events are queued ~75 s ahead.
- **Recordings** (optional) play through the same per-layer chain. A small Vite plugin writes
  `audio-manifest.json` with the files that really exist, so the app never requests a missing
  file (no red 404s in the console).
- **Pomodoro bell:** a few sine partials of a small bar chime with exponential decay, on its own
  output so mute-all doesn't silence it.

## Project layout

```
src/
  core/      app wiring, render loop, settings, quality presets, shared uniforms, noise/RNG
  world/     heightmap, terrain, grass, house, props, sky, lighting, material patching
    vegetation/  plant geometry builder, species (habitat rules), forest placement, wildflowers
  water/     Gerstner swell, ripple simulation, refraction capture, caustics, floating objects
  weather/   rain/snow particles, gusts, wetness & snow-cover rules
  audio/     audio engine, synthesized layers, mixer state, presets, scheduler
    file/      public/audio config parsing and the file layer (crossfades)
    library/   the user's recordings: IndexedDB storage, streaming players, scene mapping
  controls/  orbit camera, walking (first person), collision, water clicks, keyboard shortcuts
  ui/        Vietnamese strings, control panel, Pomodoro (state machine + card), stats overlay, styles
tests/       unit tests for pure logic
vite-plugins/  audio-manifest plugin (lists files in public/audio)
public/audio/  config.json for optional recordings (+ README)
```

Everything is procedural (geometry, colors, sky, water, sound): there are no texture, model or
audio files in the repo.

## Credits and licenses

| Item | License | Notes |
|---|---|---|
| [three.js](https://threejs.org) 0.186.1 (incl. `OrbitControls`, `BufferGeometryUtils`, `FullScreenQuad`) | MIT | runtime dependency |
| [Vite](https://vite.dev), [TypeScript](https://www.typescriptlang.org), [Vitest](https://vitest.dev) | MIT / Apache-2.0 / MIT | dev tools only |
| Simplex noise | public domain | reimplemented after Stefan Gustavson's reference |
| Gerstner waves | — | technique from *GPU Gems* (2004), ch. 1 |
| [WebGL Water](https://madebyevan.com/webgl-water/) by Evan Wallace | MIT | the heightfield ripple simulation (drop + update passes) and the caustics-by-area-ratio technique are reimplemented after it in `src/water/` |
| Planar reflection camera (`src/water/PlanarReflection.ts`) | MIT | mirrored camera and oblique near plane adapted from three.js `examples/jsm/objects/Reflector.js` |
| `src/assets/decor/mug-logo.png` (TMA logo) | trademark of its owner, not covered by this project's license | added at the repository owner's request, for the desk mug only |
| `public/audio/library/island-day.mp3`, `island-night.mp3` | redistribution permitted (confirmed by the repository owner) | built-in recordings, 15 min each; source: *TODO, add the original source and exact license* |
