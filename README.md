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
| `P` | Collapse / expand the control panel (or click its title). The page opens with the panel tucked away as in walk mode (faded, then a small round handle; point at the top-right corner to peek); the first click in it or `P` opens it. Walking, the ›/‹ button and `P` shut or open the peeking panel at once. The panel and the cards are liquid glass: clear, blurred and slightly saturated behind, tinted teal, with a bright top rim; dark glass when Windows is in dark mode |
| `1` – `9` | Pick a scene, in the order of the panel's cards (the key shows on each card) |
| `H` | Hide all UI (clean wallpaper view); press again to show. While hidden, the panel stays as a small faint **☰ handle** in the top-right corner: point at it (or the corner) to open it |
| `F` | Full screen on / off (also the ⛶ button in the panel header; `Esc` leaves it too). In full screen the mouse cursor hides over the scene after 3 s without moving. `F11` (the browser's own full screen) works as well. |
| `N` | Stop / run the clock (stopping the real-time clock freezes the island at that moment) |
| `C` | Walk around the island; press again to go back to the orbit view |
| `V` | While walking: character view (third person) ↔ eyes view (first person) |
| `T` | Pomodoro: show the timer and start / pause it |
| `B` | Work desk: sit down at the desk in the house (from anywhere) / get up |
| `G` | Call Mochi the dog: it runs straight to you |
| `J` | Mochi's skills, each press the next: **Shooting Star**, **Sonic Bark**, **Lightning Strike** (see *Mochi*) |
| `R` | Bọt the water crab's skills, each press the next: water jet (at you if you stand within 10 m, else out to sea), bubble shower, rainbow geyser (see *Three skills each*) |
| `X` | Hỏa Long the fire dragon's skills, each press the next: fire breath (at you if you stand within 12 m: it dries you; else onto the sea), ring of fire, meteor shower |
| `Z` | Mầm the grass bunny's skills, each press the next: Leaf Blossom (flowers spring up where the leaves land; within 10 m of you: a ring of flowers round you), the pollen dance, dandelion breeze |
| `U` | Seated at the desk: play a YouTube link on the left monitor, same as clicking the YouTube logo on the right monitor (see *The house and the work desk*). Elsewhere: pause / resume that video |
| `E` | While walking next to the desk or the bathtub: sit down / get in; seated: get up |
| `K` | Walking on the beach or in the shallows: get into the kayak; in the kayak: step out (see *Kayak*) |
| `L` | Walking on the beach or in the shallows: go surfing (see *Surfing*); on the board: slip off |
| `Esc` | Seated (desk or bathtub): get up |
| `` ` `` (backquote) | Show/hide the stats overlay (FPS, CPU/GPU ms, draw calls) |

### Control panel (top right)

Always visible at the top: the **Pomodoro clock** button (shows the time left while a session
runs; click to show or hide the timer card), full screen (`F`), collapse (or click the title **Đảo Nhiệt Đới**), a
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

- **Time bar** (always shown above *Cảnh*, nothing to open): the hh:mm clock with three icon
  buttons (pause/play, speed, computer clock) and a day-coloured hour slider, see *Day, night
  and sky*.
- **Cảnh:** scenes as cards: icon, name, and a second line with the scene's time (or *Giữ
  giờ*) and ♪ when it plays recordings of its own. Clicking a card switches to the scene and
  its sound. Below: **+ Tạo cảnh**, **Sửa cảnh**, **Khôi phục gốc** (edited built-ins) and
  **Xóa** (your scenes); see *Scenes and your recordings*.
- **Âm thanh:** **Âm thanh của tôi** (your recordings) and **Âm nền tự tạo khi không phát
  file** (the synthesized fallback, see below).
- **Góc nhìn:** tiles for **Toàn cảnh**, **Đi bộ**, **Góc làm việc**, **Bồn tắm**, **Nằm võng**
  (the current one is highlighted, each shows its key), and switches: character view (`V`),
  **Âm thanh hoạt động** (footsteps, paddle and swim splashes, the surf's crash and rush; off by
  default), camera auto-rotate, and **Nhân vật**: **Mặc định** (the built-in body), **Nam** or
  **Nữ** (see *Characters* below).
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

**The print on the mug:** hidden for now (`MUG_LOGO_ON = false` in `src/world/mugLogo.ts`; set it
to `true` to show it again). When on: the TMA logo, `src/assets/decor/mug-logo.png`. Its white background
is dropped and the rest is wrapped around the side of the mug that faces the chair. To print
something else, put your own image at `src/assets/local/mug-logo.png` (or `.jpg`/`.webp`;
that folder is git-ignored and takes precedence) and restart `npm run dev`. Wood has a procedural grain (shader, no textures); cushions, futon, chair and
ceramics are rounded and smooth-shaded. Trees are kept out of the view from the glass to the sea.

**YouTube on the left monitor.** Seated at the desk, click the YouTube logo on the right
monitor (or press `U`). Paste a YouTube link (a video, a live stream, a Short or a playlist) into
the little card, or pick one of the last five, and it plays on the left screen, sitting on it in
3D as you look around or lean in. With a video loaded, clicking the logo plays or pauses it; a
dot in its corner shows the state. Hover the logo for the video's menu: **Tạm dừng / Phát tiếp**,
**Âm nền** (the island's sound is switched off while a video plays; this turns it back on),
**Đổi video** and **Tắt video** (back to the code editor). The menu also shows itself for a few
seconds when a video starts. Master volume and `M` also set the video's volume. Getting up
leaves the video playing: you still see it on the monitor as you walk around the house, and `U`
anywhere away from the desk pauses or resumes it. Notes:

- This needs the internet (the only part of the app that does) and only connects when you paste
  a link. It uses YouTube's privacy-enhanced embed (`youtube-nocookie.com`), but YouTube's own
  page inside the player can still set cookies once you play.
- Some videos don't allow playing outside YouTube; the card then says so.
- The YouTube logo is a trademark of Google; its shape comes from Simple Icons (CC0).
- While the video plays and you sit at the desk, the island is drawn at 30 frames per second
  instead of 60, so the GPU has room to decode the video smoothly.
- After you click inside the video, the keyboard belongs to YouTube: click the scene to use the
  app's shortcuts again.

**Out at sea:** a Vietnamese fishing boat (blue hull, red bottom, high bow, white-and-blue cabin,
the red flag with the yellow star on both masts and a line of coloured pennants) cruises a slow
loop about 150–200 m out, in the upper right of the view from the desk. It rides the same waves
as the sea, with a bow wave and a short wake (`src/world/fishingBoat.ts`). From dusk to dawn its
lights are on (`src/world/boatLights.ts`): two lines of bright squid-fishing lamps over the
foredeck, red and green sidelights, white masthead and stern lights and warm cabin windows, each
with a soft glow, shimmering reflections on the sea (longer and more broken when the waves are
higher) and a pool of light on the water under the lamps.

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
pale linen shirt with an open collar, board shorts, bare feet, a bead bracelet, fair skin and a
friendly face). The head is a sculpted sphere (jaw, cheekbones, nose, eye sockets, ears); the hair
grows from a hairline and is made of tapered locks; chest, arms and calves have muscle shape; hands
have fingers, feet have toes. The body is a skinned mesh on a 15-bone skeleton, so knees and
elbows bend smoothly; each leg, foot included, is one surface (the shin bends forward into
the instep and swells into the heel, so there is no seam at the ankle), the forearm runs on into
the palm, and the fingers are tapered tubes. The walk follows measured human gait curves (heel strike with the toes up,
the knee giving under the weight, the heel lifting and the toes pushing off, the knee folding as
the leg swings through, hips turning against the shoulders); running adds a flight phase, a deep
knee fold and arms bent at about 90°. The arms swing a beat behind the legs with the elbows
always a little bent, and the forearms, hands and chest trail the motion (springs). The feet are
planted with inverse kinematics: a foot carrying weight stays put on the ground (no sliding), each
foot finds the real ground under it (on the steps one foot is a tread higher than the other), and
the hips dip as the legs reach. Walking slower means shorter, slower steps (as people do, e.g.
when wading), and when he stops mid-stride he steps his feet back together instead of standing
with one leg out and the knees bent. He breathes, blinks
and looks around slowly when standing.

**Mochi the dog (Góc nhìn → Mochi đi theo, on by default).** A Shiba Inu keeps you company. It
follows your own path a couple of metres behind (breadcrumbs of where you walked, so it goes
round trees and rocks and up the steps without any path finding), walking or galloping to keep
up; when you stand about it looks at you, wags, sniffs the sand now and then and, after a while,
lies down. It comes into the house with you (through the door, along your path); while you work
at the desk it sits beside the chair looking up at you, while you're in the bath it lies by the
tub (if you jumped to a seat with `B` while it was outside, it is simply there); while you're in
the hammock it lies beside it; while you swim, paddle or surf it
waits at the water's edge watching you, and greets you with a bark when you're back. `G` calls
it. **`J`: its three skills**, each press the next (a name card shows each). **Shooting Star**
(Shiba "zoomies"): a play bow and a yip, then two
laps round you at full gallop (7.5 m/s, leaning into the turn) leaving a comet's tail of golden
sparkles that drift down onto the sand, and a leap with a full turn in the air to finish: a
burst of gold (and a few colours) and two hearts. It needs open ground: a circle round you
(3.4, 2.8 or 2.2 m) clear of trees, rocks, walls and the sea, or else one just beside you; if
there is none a note says so. **Sonic Bark**: it braces and lets out one huge bark (a deep
"WOOF" with its echo): rings of sound race 10 m out over the ground with a puff of dust all
round, the camera shakes, the sea ripples, the other creatures jump; within 8 m you are
**knocked off your feet**: you topple onto your back, arms flung up, lie there dazed, then sit up
and stand (~3 s; no walking meanwhile; through the eyes the view drops to the ground and looks
at the sky). **Lightning Strike** (like a Pikachu): it crouches while little arcs crawl over its back,
then four bolts of lightning crackle out at whatever is within 13 m: you, palms, rocks, the
house, the other creatures, the sea. Each bolt is a jagged, forking, flickering arc that lights
up the scene, with a crack of thunder and a burst of sparks; what it hits is **scorched**: you
or a creature go black for a moment, smoking, and come back to your colours over ~5 s; the ground
gets a scorch mark that fades; a struck creature hits back with a skill of its own; on the sea
it ripples. **A pat** (a click) now and then (1 in 3) sets off one of the three at random. The
model is the file's, rounded off at load (`world/smoothMesh.ts`:
the file is flat-shaded low poly, ~1.9k triangles; one step of Loop subdivision and smooth
normals give ~7.7k, like the other animals). **Petting, with the mouse** (no key, no text prompt): point at Mochi (from above the cursor
turns into a paw; walking, a paw appears at the screen centre when you aim at it). A click is a
pat (it hops, wags hard and yips). Press and hold to stroke it: walking, it comes to sit in
front of you, your character crouches and strokes its head and neck with the right hand (the
left on the knee) while you move the mouse (the view holds still meanwhile); it tilts its head
into your hand, wags harder the longer you pet it, and little hearts float up. Let go and it
follows again. Walking off ends it. Its paws leave prints in the
sand and snow, and with **Âm thanh hoạt động** on you hear its paws on the deck and its bark
(synthesized). Its walk and gallop are the model's own clips, played faster or slower with its
speed so the paws don't slide; lying down and sitting are poses built in code (the file has none).

**Bọt, the water creature (Góc nhìn → Bọt (cua hệ Nước), on by default; trial of an elemental
trio).** A small blue crab (~0.4 m) lives on the hammock's beach. It potters about the damp
sand, comes over to greet you when you walk near (a "yes" nod and a bubbly blub-blub), and now
and then turns to the sea and fires a **water jet**: one glassy stream bent along its ballistic
arc, fraying into drops at the end, shedding soap bubbles on the way and splashing and rippling
the water where it lands. `R` orders the jet: standing within 10 m of it you are the target, and
if the water hits you, your character is soaked like after a swim (it drips and dries the same
way) and Bọt does a little dance. **With the mouse:** rest the pointer on Bọt (the cursor turns
into a paw) and it turns to you and blows rainbow soap bubbles that float off on the wind and
pop; click it and, at random, it either dances in a burst of bubbles or fires its water jet your
way (at you if you are walking within 10 m, else onto the ground between it and the camera).
The jet flies hard and flat (up to ~10 m out to sea), a wide stream with a big splash. Sounds (the jet's hiss, its voice) follow
**Âm thanh hoạt động**. Loaded on first use (0.2 MB), its shaders compiled in the background.

**Hỏa Long, the fire creature (Góc nhìn → Hỏa Long (rồng hệ Lửa), on by default).** A small red
dragon (~1.5 m wingspan) always on the wing, looping lazily over the beach in front of the house,
a flame burning at the tip of its tail (smaller in the rain). Its fire lights the sand below it,
faintly by day and warmly at night (a faked glow, no real light). It flies over to greet you when
you walk near, and now and then flies out over the water's edge and **breathes fire**: from its
mouth, straight ahead the way it faces, the whole body tipping nose-down toward the sea; a long
(up to 6.5 m), widening, flickering tongue of flame with embers that stops where it meets the
water (steam) or the sand (sparks). `X`
orders it: standing within 12 m of it you are the target, and the fire **dries you** at once
(steam rises off you), the opposite of Bọt's jet. **With the mouse:** rest the pointer on it and
it hovers, turns to you, its tail flame flares and it puffs embers; click it and it does an
excited dance with a burst of fire straight up. Sounds (the roar and crackle of the flame, its
chirrup) follow **Âm thanh hoạt động**. Loaded on first use (0.44 MB).

**Mầm, the grass creature (Góc nhìn → Mầm (thỏ hệ Cỏ), on by default).** A spring-green bunny
(~0.75 m to the ear tips) with a cream belly and a carrot in its paw, a sprout growing from the
top of its head between the ears (a soft-ribbed bud with a shoot and four leaves that sway in the
wind). It wanders the lawn by the stepping stones between the house and the beach (it keeps away
from the house's stilts), waves to greet you, and now and then throws **Leaf Blossom**: an arching
stream of leaves and flower petals in a widening spiral, trailing sparkles; they fall swinging
like real leaves, lie on the grass a moment and fade, and **flowers spring up where they land**:
small clusters of daisies, five-petal flowers and tulips in eight colours that grow out of the
ground, unfold their petals from a closed bud with a puff of pollen, sway in the wind, and after
~45 s close up, droop and wilt. `Z` orders it:
standing within 10 m you are the target, the leaves swirl round you and a ring of flowers opens
at your feet. **With the mouse:** rest the pointer on it and it turns to you, the sprout's leaves
open and golden pollen drifts up; click it and, at random, it throws leaves your way or does a
happy hop in a puff of pollen. Sounds (a rush of leaves, little squeaks) follow **Âm thanh hoạt
động**. Loaded on first use (0.54 MB).

**Three skills each (`R` / `X` / `Z`: each press starts the next; a click on the creature picks
one at random).** A skill you set off shows its **name card**, big and glowing in the creature's
colours, like an anime (hidden with the rest of the UI by `H`). Bọt: **Aqua Jet** (the jet),
**Bubble Burst** (it blows one giant soap bubble, 2.3 m across, with a swirling thin-film
rainbow skin, sparkles drawn into it; the bubble floats up and bursts: a flash, its film flying
apart as a fading sphere, a shock wave on the sand, hundreds of bubbles, drops and glitter all
round, soaking you within 3.5 m), **Rainbow Geyser** (claws up, the sand trembles and pulses
with rings, then a geyser bursts out with a flash, a crown of spray and a shock wave: a thick
column of water ~10 m high for 2.8 s with a skirt of splashes, under you if you stand within 10 m
(soaking you), else in front of it; in daylight a big rainbow arches over it, facing you). Hỏa
Long: **Flame Breath** (the breath), **Inferno Ring** (it spins, drawing sparks into itself, then a
flash and a 2.4 m wall of flame race out along the ground in a ring to 10 m, a second ring inside
it; it dries you as it passes; over the sea it skims the waves), **Meteor Storm** (it climbs,
a circle of fire opens in the sky over you, or over it, and it spits ten fireballs that rain down
within 7 m, each blowing up where it lands: a flash, a ring of flame, the ground shaking, steam
on the sea). Mầm: **Leaf Blossom** (the leaves and flowers), **Verdant Tornado** (a green
tornado 6 m tall swirls up round it, a snaking funnel of wind streaks full of pollen and seeds;
at the end it bursts in a gust and flowers spring up round it in two rings), **Gió Bồ Công
Anh** (a dandelion clock swells on its sprout, then a gust: a wall of wind races out and
hundreds of seeds, little white stars of fine hairs, whirl up and away on the wind). Bé Mập
already has three pranks and its celebration.

The big moments of every skill share their effects (`world/creatures/skillFx.ts`): a **flash**
of real light (one point light kept in the scene at zero, so no shader is rebuilt), **shock
waves** (a glowing ring on the ground or sea and a wall on its front: flame tongues, a crown of
spray, wind streaks), a **camera shake** (off with Windows' reduce-motion), a short **framing**
(the view widens a little and turns toward the skill; the camera itself never moves, so it can't
end up inside a tree) and big **sounds** (boom, splash, whoosh, a power-up swell; with Âm thanh
hoạt động on). On **Cao (High)** they also **glow** (a bloom pass, only while a skill is on).

**Combos.** Two skills of different elements set off within 1.5 s of each other (press two
creatures' keys one after the other, or let it happen: when you start a skill and another
creature stands within 12 m, it joins in 1 time in 3) make a **combo** in front of you, with a
purple name card (`activities/combos.ts`; then none for 6 s): **Lửa + Nước "Hơi Nước Cầu
Vồng"** (a white whirlwind of steam 8 m tall under a great rainbow), **Lửa + Cỏ "Blaze Bloom"** (a
ring of fire racing out, flowers springing up behind it), **Nước + Cỏ "Petal Rain"** (a shower of
drops and glitter, flowers everywhere), **Điện + Nước "Thunder Spout"** (a water spout with
lightning spiralling up it), **Điện + Lửa "Firestorm Strike"** (five bolts out of the sky, each
blowing up in fire), **Điện + Cỏ "Glowing Meadow"** (glowing pollen all over the meadow, little
arcs jumping between the grass). Mochi counts as Điện; a creature struck by its lightning that
hits back can make one too.

**Wild ones in the rainforest (Góc nhìn → Sinh vật hoang trong rừng, on by default).** Walk in
among the trees and wild Bọt, Hỏa Long and Mầm show themselves: every few seconds one peeks out
from behind a trunk ahead of you (5–11 m off, never behind another trunk from where the camera
looks; up to 1–3 at once, drawn again each time you walk in), watches you, calls, shows its
element (soap bubbles, embers, pollen), then slips back behind the trunk and is gone. Come within
3.5 m and it startles and vanishes in a puff of its element; leave the forest (or stop walking)
and they all hide. The wild dragons hover between the trunks. Two of each are loaded on your
first visit (skeleton clones of one load each) and reused.

**Bé Mập, the baby shark (Góc nhìn → Bé Mập trêu bạn ở biển, on by default).** A small
friendly blue shark with a big baby head lives out at sea and comes to play while you are on the
water (kayak, surf, swim, dive), first after ~30 s there and then every ~2–4 minutes, only over
water deeper than 1.5 m. It warns you first: it circles you for 5–8 s with its fin cutting the
surface and a giggle. Then one of three pranks, at a random strength (light / medium / strong):
**Cú Nhảy Ùm**, a leap right over you and a big splash (a strong one rolls in the air); **Húc
Đùa**, a bump from below; **Xoáy Nước**, tight fast circles round you that spin you. What they
do: the kayak rocks (and settles), spins, or, at full strength, **capsizes** and rolls back up
by itself after a moment (an Eskimo roll; with reduced motion it only rocks); the surfer is
knocked off the board (medium and strong); a swimmer or diver is shoved (diving, no leaps);
you always end up soaked. Then it swims off and dives. **Shoo it:** click it while it circles
or lines up a prank and it swims off in a huff (no prank). **Friends:** after three pranks it
is your friend (kept between visits): most of its visits it then just swims along beside you,
keeping pace, and now and then leaps out ahead for show; one visit in four it still plays a
prank. **It cheers your rides:** stand on one wave for 8 s and it comes up ahead of you and
does **Cầu Vồng Mập**, a high leap across your line (~4.4 m) with two barrel rolls, drawing a
rainbow in the air behind it (seven bands of glittering motes that hang for a couple of
seconds), a burst of coloured sparkles at the top, a note (**Lướt 8 giây liền!…**) and a big
splash; once a ride, never a prank. **At night** the water it stirs glows: a cyan trail of sea sparkle behind its fin and
round its splashes. Its splashes and giggle follow **Âm thanh hoạt động**.

**Characters (Góc nhìn → Nhân vật).** Besides the built-in body you can walk around as a man or a
woman from Quaternius' low-poly character pack (`src/assets/characters/*.glb`, CC0). They load
the first time you pick them (about a second) and wear the same motion as the built-in body:
walking with planted feet, stopping, swimming, the kayak and the surfboard all work. How: the
procedural skeleton keeps posing itself as before (its own meshes hidden), and every frame each
of its joints' turn from rest is copied onto the character's matching bone (retargeting; their
rest pose is a T-pose, so the arms are first swung down to ours; their longer spine shares our
one torso bend; their feet are IK bones, placed at the end of the shin). The skeleton is scaled
so its legs are as long as the character's, which keeps the feet on the ground. They wear
shoes, so their footprints in the sand are shoe soles. Their materials get wet and catch cloud
shadows like everything else.
In the character view the camera pulls in when a wall, the roof, a trunk or the ground is
behind you, so it works inside the small room too.

| Input | Action |
|---|---|
| Mouse, while moving | Steers, no button needed (as in a game); the cursor hides meanwhile. With the cursor at the left or right edge of the screen the view keeps turning that way (building up over 0.3 s, so brushing the edge barely turns). Speed: **Cài đặt → Độ nhạy chuột** scales both (default 60 % of the old rate: ~145° across a full-HD screen, ~70°/s at the edge, which was 120°/s whatever the setting). The mouse is never captured, so there is no browser "press Esc" notice |
| Mouse, standing still | The cursor is back: **drag** on the scene to turn the view, point at Mochi to pet it, use the menu |
| `W` `A` `S` `D` / arrow keys | Walk |
| `Shift` (hold) | Run |
| Click | Splash: a ripple at the cursor, if that is water |
| `V` | Switch between the character view and the eyes view |
| `C` | Stop walking and return to the orbit view |

- You start at the foot of the porch steps, looking out to sea; next time you continue where you
  left off. The control panel waits collapsed and faded in its corner; point at it and it opens,
  move away and it closes again. Left alone for 5 s it shrinks to a small faint **☰ handle** in
  the corner (it lights up for a moment as it does): point at it to bring the menu back. `H` hides it and the
  hint.
- **Hoạt động card:** under the menu bar, what you can do right where you stand (by the sea: kayak,
  surfboard, swimming; at the desk, the bath, the hammock; in the kayak: land, jump in). Click a
  row, or press its key (shown on the right). It fades after 5 s and comes back when you stand still.
  Short notes (e.g. why you can't land here) appear as its last row.
- You follow the ground, can climb the steps onto the porch and walk into the room; trunks, rocks,
  walls, railings and furniture block you (you slide along them).
- You can wade into the sea; the deeper, the slower. Chest deep (1.2 m) you start swimming
  (see *Swimming*).
- **Footprints:** bare footprints stay behind you on the sand (and on anything under settled
  snow). They fade by themselves: a couple of minutes on dry sand, much sooner where the waves
  reach, faster in the rain, longer in snow.
- **Wet after the sea:** out of the water your character is soaked (darker clothes and hair,
  glossy skin, drops falling) and dries in about a minute in sun and wind, a few minutes on a
  grey day or at night, not while it rains on you. Rain wets him only outdoors.
- **The hammock:** past the beach umbrella, between two palms on the sand. Stand next to it and
  press `E` (or the panel tile **Nằm võng**): you lie in it, looking up into the palms and the sky,
  gently rocking (more in wind). Drag to look around, scroll to look closer, `E` or `Esc` to get
  up.
- **Animals:** seagulls circle over the beaches by day (they roost at night); dolphins cruise off
  the house beach and leap now and then (watch from the desk window); ghost crabs scurry on the
  damp sand and dig in when you come close; sea turtles glide over the reef (dive to see them).
- **Sound follows where you are:** footsteps change with the ground (sand, grass, rock, wooden
  floor, splashing water, snow crunch; switch on with **Âm thanh hoạt động**). The surf is loud on
  the beach and fades inland, coming from the sea's side; birds get louder among the trees;
  inside the room everything is muffled and rain sounds like rain on the roof. No rain or snow
  falls under the roof, and the floor stays dry.
- Head bob is off when Windows' "Animation effects" is disabled (`prefers-reduced-motion`).

## Sea activities

Walk onto the beach or into the shallows and a small card **Hoạt động biển** appears at the
bottom right with the key of each activity you can start there: **K – Chèo kayak**,
**L – Lướt ván** and **W – Bơi** (just walk out into deep water). In the kayak, `Space` jumps over the side into
the sea; swim back right up to the floating kayak and you climb in by yourself (or press `K`
next to it). While swimming, the card shows **Space – Lặn** (dive).

### Surfing (`L` at the sea)

A quarter of the way round the island from the house (to the right when you stand on the house's
beach facing the sea) there is a surf break: real breaking waves every ~13 s rolling onto a long
sandy beach. Each wave rises as it comes in, then breaks from one end and the
break runs along it ("peels"); white water tumbles down the broken part and a band of foam
follows it in; near the beach every wave closes out and washes up the sand. You can see it from
the overview too.

`L` anywhere on a beach fades and puts you lying on the board at the lineup (where you wait
for waves, just outside the break line, ~48 m out), nose to the beach. A wave caught there
rides all the way in: ~15 s.

**Difficulty follows the "Sóng biển" slider** (the wind's extra chop doesn't count):

| Slider | Waves | The break runs along at | Holding you on the wave | You fall when leaning past |
|---|---|---|---|---|
| low (~0.15) | ~1.0 m | 3.6 m/s | strong | ~70° (practically never) |
| default (0.45) | ~1.5 m | 4.8 m/s | medium | ~49° |
| storm (~0.95) | ~2.4 m | 6.8 m/s | light | ~42°; the falling lip knocks you off too |

| Lying on the board | |
|---|---|
| `W` (hold) | Paddle (`Shift` + `W`: paddle hard) |
| `A` / `D` | Turn the board |
| `S` | Drag a hand (brake) |
| `Space` | Catch the wave (when **Sóng tới!** shows): the board keeps the line its nose points (A/D still adjust it), paddles and stands up by itself |
| `L` | Slip off the board |

| Standing (riding) | |
|---|---|
| `A` / `D` | Carve along the wave (held, the board turns up to ~83° off straight in and rides along the wave there: it never turns over the wave's back) |
| `Shift` + `A`/`D` | Hard carve: turns much tighter, but held at speed you lean too far and fall |
| `W` | Pump (a little speed down the face) |
| `S` | Stall (lets the wave catch up) |

How to catch a wave: wait at the lineup. While you lie still the view turns out to sea, so you
see the waves coming, and a bar at the top counts down to the next one (**Sóng tiếp theo: 4 s**).
When it turns green (**Space!**, and a note says **Sóng tới!**) press `Space`. The board keeps
the line its nose already points (up to ~57° off straight in; you can still adjust it with
`A`/`D` while it waits; lying the wrong way round, nose out to sea, it turns in toward the side
that breaks last), waits for the wave, which picks it up, and you stand up. Then stay on the face, ahead
of the white water, carving with `A`/`D`: the wave holds you on its face (see the table), so
riding straight on takes you all the way in; angle along it for speed. The ride ends when the wave passes under you or
closes out (you lie down again), or at the beach (you step off). Falling (holding a hard carve
at speed, or under the breaking lip) is a splash and a second in the white water, then you are
lying on the board again by yourself. After a ride (or a fall, or a missed wave), leave the
keys alone for a second and the board paddles itself back out to the lineup (diving under the
white water) and turns for the beach; any key takes over. Space at the wrong moment says why:
no wave here, still far, or already gone by.

Sounds: each wave crashes as it starts to break, along the peel and where it closes out
(louder close by and for big waves, from its side); riding, the water tears past the board and
the wind rises with your speed. The camera shakes a little in a hard carve and when you fall
(not with reduced motion).

The waves are also real for the kayak and the swimmer at that beach.

### Journal (disabled)

A journal of sea goals ("Nhật ký") was built and is switched off for now, to be redesigned.
The code (`src/activities/journal.ts`, `goalTracker.ts`, `src/ui/JournalView.ts`) stays, but nothing
calls it.

### Swimming

Walk out until the water reaches your chest (1.2 m) and you swim; back where it is under 1 m
you stand up and walk out. The same keys as walking:

| Input | Action |
|---|---|
| `W` `A` `S` `D` | Swim (breaststroke, ~0.75 m/s); you build up speed over a stroke or two and glide on when you stop |
| `Shift` (hold) | Front crawl (~1.5 m/s) |
| No key | Tread water: upright, head out, hands sculling, legs cycling |
| Mouse / `V` | Look around / character view ↔ eyes view (just above the water, the waves rise and fall in front of you) |

The body floats on the waves. The strokes follow real technique: the crawl's arms turn full
circles half a cycle apart (pull under the chest, high-elbow recovery) with the body rolling
and the head turning to breathe, six flutter kicks per cycle; the breaststroke pulls with the
head up to breathe, then the arms shoot forward and the frog kick snaps the legs together,
then a glide. Each hand entry splashes (droplets, a ring, a sound on that side), the head
pushes a small V, the crawl kick churns white water behind and each frog kick leaves a swirl.
Rocks still block you; far out at sea a gentle current brings you back.

### Diving (`Space` while swimming)

Where the water is deeper than ~1.8 m, `Space` takes a breath and dives. Under water:

| Input | Action |
|---|---|
| `W` / `S` | Swim where you look (look down to go deeper, up to rise) / backwards |
| `A` / `D` | Sideways |
| `Space` (hold) | Rise |
| `Shift` (hold) | Swim faster (uses your breath faster) |

- **Breath:** a bar at the top. One breath lasts ~45 s (less when swimming fast) and refills
  in a few seconds at the surface. Out of breath, you float up to the surface by yourself (no
  game over). Every few seconds you breathe out a puff of bubbles that wobbles up and pops at
  the surface. You can go down to 14 m.
- **The reef:** off the beach by the house (and in patches all round the island), between 1.5
  and 9 m deep. Reef rocks crusted with pink and green coralline algae carry most of the
  corals: brain corals (meandering ridges), staghorn (pale growing tips), table corals (radial
  growth lines), sea fans (real nets you can see through), tube sponges (growth rings, dark
  inside), sea anemones and soft corals swaying in the swell; starfish, sea urchins, rubble
  and shells on the sand, seagrass meadows and seaweed between the rocks, and 14 schools of
  fish (yellow tangs, blue and yellow, silver, clownfish, blue-green, pink) circling over it.
  The surface detail is painted by the shader, no textures. The reef also shows through the
  clear water from above.
- **What it looks like:** blue water that closes in after ~25 m and darkens with depth and at
  night; looking up, the surface is a bright, wobbling disc of sky with the sun in it (Snell's
  window: under water you see the whole sky squeezed into a cone of ~97°) and a mirror of the
  dark water all around it; sun rays slant down through the water and flicker; caustics dance
  on the sand and the corals. Sounds are muffled while your head is under.

### Kayak (`K` at the sea)

The kayak is a yellow sit-on-top, pulled up on the sand beside the house. Press `K` and it is
put in the water in front of you (from the sand, or wherever you left it) and you sit in it.
It has no rudder: like a real kayak it turns only through the paddle, and the paddle is one
piece, so the two sides take turns. You steer like in a game; the paddler picks the real strokes.

| Input | Action |
|---|---|
| `W` (hold) | Paddle forward: steady strokes, left and right (~1.5 m/s, a relaxed touring pace). `Shift` + `W`: sprint, a race cadence (strokes ~40 % quicker, ~2.5 m/s) |
| `A` / `D` | Turn left / right. Standing still: sweep strokes on the other side (turns on the spot, ~30°/s). With `W`: strokes on the outside of the turn (~25°/s). Gliding without `W`: the blade is trailed behind your hip as a stern rudder (~20°/s, slows you a little). The paddler also leans the kayak onto its outer edge, which frees the stern |
| `S` (hold) | Paddle backwards: brake, then back up (~0.8 m/s); with `A`/`D` it backs round |
| `Q` / `E` | Manual: one forward stroke on the left / right side (tap, or hold to repeat). A stroke on one side turns the boat **away** from that side, like a real kayak. `Shift` + `Q`/`E`: sweep stroke |
| Mouse | Look around; after a moment without the mouse the camera drifts back behind the boat |
| `V` | Character view ↔ eyes view (you see your arms, legs and the paddle) |
| `Space` | Jump over the side and swim; swim back within ~1.4 m of the kayak and you climb back in automatically (after you have first swum a few meters away) |
| `K` | Get out: where the water beside the kayak is no deeper than 0.9 m you step out; in deeper water you slip in and swim |
| `C` | Back to the orbit view; `C` again puts you back in the kayak |

How it moves: the kayak is a small simulated body, no physics library. The water drags on the
hull a little lengthwise and a lot sideways (that's why it goes where it points and glides a
long way after the last stroke). Each stroke moves the blade through the water; the drag on the
wet part of the blade, applied where the blade is, pushes and turns the boat, so a stroke helps
less when you're already fast, and a stroke far out turns more. The waves (the same ones the
water draws) lift, pitch and roll the boat; it runs aground on the sand and is stopped by rocks
and the rowboat. The empty kayak keeps floating where you left it. The paddle sounds (left
or right ear by the side) follow **Âm thanh hoạt động**.

What you see on the water: the bow pushes out a V of little waves and bubbles that opens
behind you at ~19.5° (the angle of every wake on deep water), the stern leaves a band of
stirred water, each pull leaves a pair of small whirlpools (dimples with foam spun round them)
that drift behind for a few seconds, the blade throws a splash ring and droplets when it goes
in, and drips when it comes out. These marks live in a sharp "wake map" (48 m around the kayak,
9 cm per texel) that the water shader reads for foam and bumps, so they work anywhere at sea.

## Day, night and sky

**The clock** (the time bar at the top of the panel's list, always shown):

One row: the time (hh:mm) (a dot before it: filled = running, ring = the computer's clock, grey =
stopped; hover for the words) and three small buttons; below it the hour slider, coloured like
the day (night blue, dawn pink, sky blue, sunset orange), with a sun or a moon as its handle.
Hover any button for its name.

- **Monitor icon (giờ thật):** the island follows your computer's clock, to the second. Click
  again for the island's own clock.
- **Hour slider:** drag (or wheel, 15 min per notch) to any time; the time shows over the handle
  meanwhile; the island clock runs on from there (also when it was stopped or on real time).
- **Speed button (×1 / ×10 / ×60 / ×240):** click for the next speed, round and round; Shift +
  click goes back; the mouse wheel over it changes it too. ×1 = real speed, ×10 = a day in about
  2.4 h, ×60 = a day in 24 min (default), ×240 = a day in 6 min. On the computer's clock it shows
  the island speed dimmed; a click switches to the island clock at that speed.
- **Pause/play icon** (or `N`) stops and restarts the clock. A scene with a time of day starts
  the clock from that time (it keeps running).
- Closed, the section's title shows e.g. *10:14 · ×60*, *21:30 · đã dừng* or *09:38 · giờ thật*.

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

**The way to the sea:** from the foot of the house's steps, stepping stones lead straight down
the beach to the wet sand; no bushes grow along it.

**The forest trail:** from the beach, a wooden signpost ("Đường mòn") marks where it starts; the path then runs along the left side of the house (seen from the sea), passes
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
| Glow (bloom) round the creatures' big skills, only while one is on | off | off | on (~1–2 ms GPU then) |

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
  world/     heightmap, terrain, grass, house, props, sky, lighting, material patching, kayak, reef
    vegetation/  plant geometry builder, species (habitat rules), forest placement, wildflowers
  water/     Gerstner swell, ripple simulation, refraction capture, caustics, floating objects,
             wake map, spray and bubbles, under-water look (fog, dome, sun rays), surf break
  weather/   rain/snow particles, gusts, wetness & snow-cover rules
  audio/     audio engine, synthesized layers, mixer state, presets, scheduler
    file/      public/audio config parsing and the file layer (crossfades)
    library/   the user's recordings: IndexedDB storage, streaming players, scene mapping
  controls/  orbit camera, walking (first person), collision, water clicks, keyboard shortcuts
  activities/  sea activities: kayak physics (paddle strokes, blade forces, hull drag) and control,
             surfboard physics and control
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
| [three.js](https://threejs.org) 0.186.1 (incl. `OrbitControls`, `BufferGeometryUtils`, `FullScreenQuad`, and `EffectComposer`, `RenderPass`, `ShaderPass`, `UnrealBloomPass`, `OutputPass` for the skills' glow) | MIT | runtime dependency |
| [Vite](https://vite.dev), [TypeScript](https://www.typescriptlang.org), [Vitest](https://vitest.dev) | MIT / Apache-2.0 / MIT | dev tools only |
| Simplex noise | public domain | reimplemented after Stefan Gustavson's reference |
| Gerstner waves | — | technique from *GPU Gems* (2004), ch. 1 |
| [WebGL Water](https://madebyevan.com/webgl-water/) by Evan Wallace | MIT | the heightfield ripple simulation (drop + update passes) and the caustics-by-area-ratio technique are reimplemented after it in `src/water/` |
| Planar reflection camera (`src/water/PlanarReflection.ts`) | MIT | mirrored camera and oblique near plane adapted from three.js `examples/jsm/objects/Reflector.js` |
| YouTube logo on the desk's right monitor (`YT_LOGO` in `src/ui/youtube.ts`) | path data from [Simple Icons](https://simpleicons.org/), CC0; the logo is a trademark of Google | drawn as the button that opens the YouTube player |
| `src/assets/animals/shiba.glb` ("Shiba Inu") by [Quaternius](https://quaternius.com/), via [Poly Pizza](https://poly.pizza/m/y4wdQpg767) | CC0 1.0 (public domain) | Mochi the dog; its walk, gallop, idle, sniff and jump clips are used |
| `src/assets/creatures/water-crab.glb` ("Crab Enemy") by [Quaternius](https://quaternius.com/), via [Poly Pizza](https://poly.pizza/m/Gs3yfsV5lB) | CC0 1.0 (public domain) | Bọt the water crab, recoloured blue in code; its idle, walk, bite, yes and dance clips are used. The file has 6 vertices with NaN skin weights (an export fault), repaired at load |
| `src/assets/creatures/fire-dragon.glb` ("Dragon Evolved") by [Quaternius](https://quaternius.com/), via [Poly Pizza](https://poly.pizza/m/LlwD0QNUPj) | CC0 1.0 (public domain) | Hỏa Long the fire dragon, recoloured red and gold in code; its flying idle, fast flying, headbutt, yes and punch clips are used |
| `src/assets/creatures/grass-bunny.glb` ("Bunny") by [Quaternius](https://quaternius.com/), via [Poly Pizza](https://poly.pizza/m/irZjWFARyl) | CC0 1.0 (public domain) | Mầm the grass bunny, recoloured green and cream in code; the sprout on its head is made in code; its idle, walk, punch, wave and jump clips are used |
| `src/assets/creatures/sea-shark.glb` ("Shark") by [Quaternius](https://quaternius.com/), via [Poly Pizza](https://poly.pizza/m/YYsK3gRCBZ) | CC0 1.0 (public domain) | Bé Mập the baby shark, tinted and scaled small in code, its head enlarged on the Neck bone; its swim, fast swim and bite clips are used. (Named in Vietnamese on purpose: "Baby Shark" is a Pinkfong trademark.) |
| `src/assets/characters/man.glb` ("Hoodie Character") and `woman.glb` (a woman from the same pack) by [Quaternius](https://quaternius.com/), via [Poly Pizza](https://poly.pizza/m/gKLBoRsyKe) | CC0 1.0 (public domain) | rigged low-poly characters; their own animations are not used (they wear the procedural motion) |
| `src/assets/decor/mug-logo.png` (TMA logo) | trademark of its owner, not covered by this project's license | added at the repository owner's request, for the desk mug only |
| `public/audio/library/island-day.mp3`, `island-night.mp3` | redistribution permitted (confirmed by the repository owner) | built-in recordings, 15 min each; source: *TODO, add the original source and exact license* |
