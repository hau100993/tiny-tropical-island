import { describe, expect, it } from 'vitest';
import { normalizeSrc, parseAudioConfig } from '../src/audio/file/config';

describe('audio file config', () => {
  const available = new Set(['waves/beach1.ogg', 'waves/beach 2.mp3', 'rain/roof.ogg']);

  it('normalizes paths to the manifest form', () => {
    expect(normalizeSrc('./waves\\beach1.ogg')).toBe('waves/beach1.ogg');
    expect(normalizeSrc('/audio/waves/beach1.ogg')).toBe('waves/beach1.ogg');
  });

  it('keeps existing files, reports missing ones, applies defaults', () => {
    const p = parseAudioConfig(
      {
        layers: {
          waves: { files: ['waves/beach1.ogg', { src: 'waves/beach 2.mp3', gain: 9, loopEnd: 30.5 }, 'waves/gone.ogg'] },
          rain: { files: [{ src: 'rain/roof.ogg', loop: false }], crossfadeSec: 100, rotateEverySec: [300, 10] },
          birds: { files: ['birds/none.ogg'] },
          wind: 'broken',
        },
      },
      available,
    );
    expect(p.missing).toEqual(['waves/gone.ogg', 'birds/none.ogg']);
    expect(p.layers.waves?.files).toEqual([
      { src: 'waves/beach1.ogg', gain: 1, loop: true, loopStart: 0, loopEnd: null },
      { src: 'waves/beach 2.mp3', gain: 4, loop: true, loopStart: 0, loopEnd: 30.5 },
    ]);
    expect(p.layers.rain?.crossfadeSec).toBe(30);
    expect(p.layers.rain?.rotateEverySec).toEqual([300, 300]);
    expect(p.layers.rain?.files[0].loop).toBe(false);
    // A layer without any existing file keeps its synthesized sound.
    expect(p.layers.birds).toBeUndefined();
    expect(p.layers.wind).toBeUndefined();
  });

  it('never throws on garbage', () => {
    expect(parseAudioConfig(null, available)).toEqual({ layers: {}, missing: [] });
    expect(parseAudioConfig({ layers: [] }, available).layers).toEqual({});
  });
});
