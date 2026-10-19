# Your own sound files

> `library/` is different: recordings **shipped with the app** (listed in
> `library/library.json`, committed to the repo, shown in *Âm thanh của tôi* as *có sẵn*).
> Only put files there that may be redistributed, and credit them in the main README.

Optional. Without any files every layer is synthesized in code.

1. Put audio files in this folder (sub-folders are fine), e.g. `waves/beach1.ogg`.
2. List them per layer in `config.json` (layers: `waves`, `birds`, `wind`, `rain`, `snow`).
   A file is a path relative to this folder, or an object:

   ```json
   { "src": "waves/beach2.mp3", "gain": 0.8, "loop": true, "loopStart": 0.05, "loopEnd": 59.9 }
   ```

3. Reload the page. A layer switches to its recordings once the first one is decoded (the panel
   shows **tệp** next to it). Missing or broken files are skipped quietly.

`crossfadeSec` (default 4) is the crossfade length when switching files; `rotateEverySec`
(`[min, max]`) is how often a layer with several files switches to another one at random.

## Format tips

- **OGG** loops without gaps. MP3 adds a little silence at both ends: set `loopStart`/`loopEnd`,
  or convert, e.g. `ffmpeg -i in.wav -c:a libvorbis -q:a 5 out.ogg`.
- Normalize recordings to similar loudness, then fine-tune with `gain`.
- 30 s – 3 min loops are plenty. Files are decoded into memory (~20 MB per stereo minute), and at
  most two per layer are kept.

## Where to find sounds (check every file's license)

- [Freesound](https://freesound.org): filter by **CC0** to avoid attribution requirements;
  CC-BY files need credit in the main README.
- [Sonniss GDC bundles](https://sonniss.com/gameaudiogdc): royalty-free, read their license.
- [BBC Sound Effects](https://sound-effects.bbcrewind.co.uk): personal/educational use only.

Don't commit files you aren't allowed to redistribute; keep them local.
