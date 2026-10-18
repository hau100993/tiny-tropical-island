import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_SCENES,
  DEFAULT_SCENE,
  MAX_USER_PRESETS,
  parseSceneValues,
  parseUserScenes,
  sanitizePresetName,
  sceneValuesOf,
} from '../src/core/scenePresets';
import { defaultSettings } from '../src/core/settings';
import { formatSize, nameFromFile, parseTracks, trackLevel, type TrackMeta } from '../src/audio/library/tracks';

describe('scene presets', () => {
  it('built-ins have unique ids and complete, valid values', () => {
    expect(new Set(BUILT_IN_SCENES.map((p) => p.id)).size).toBe(BUILT_IN_SCENES.length);
    for (const p of BUILT_IN_SCENES) expect(parseSceneValues(p.values)).toEqual(p.values);
  });

  it('reads the scene part of the settings', () => {
    const s = { ...defaultSettings(), visualRain: 0.7, aurora: 0.1, fireflies: false };
    const v = sceneValuesOf(s);
    expect(v.visualRain).toBe(0.7);
    expect(v.fireflies).toBe(false);
    expect(Object.keys(v).sort()).toEqual(Object.keys(DEFAULT_SCENE).sort());
  });

  it('repairs stored values (older presets miss newer effects)', () => {
    const v = parseSceneValues({ visualRain: 3, stars: 'yes', gloom: 0.2 });
    expect(v.visualRain).toBe(1);
    expect(v.stars).toBe(DEFAULT_SCENE.stars);
    expect(v.gloom).toBe(0.2);
    expect(v.aurora).toBe(DEFAULT_SCENE.aurora);
  });

  it('drops invalid user presets, duplicates, and caps the list', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `u${i}`, name: `P${i}`, values: {}, hours: 25 }));
    const list = parseUserScenes([{ id: 'x', name: '   ' }, { id: 'u0', name: 'dup' }, ...many, 'junk']);
    expect(list).toHaveLength(MAX_USER_PRESETS);
    expect(list[0]).toMatchObject({ id: 'u0', name: 'dup', builtIn: false, hours: null });
    expect(list[1]).toMatchObject({ id: 'u1', hours: 1 });
    expect(parseUserScenes([{ id: 'a', name: 'A', hours: 'x' }])[0].hours).toBeNull();
    expect(sanitizePresetName('  Mưa   đêm ')).toBe('Mưa đêm');
  });
});

describe('sound library tracks', () => {
  const t = (over: Partial<TrackMeta>): TrackMeta => ({
    id: 'a', name: 'A', size: 1, volume: 0.6, playing: false, mappings: [], ...over,
  });

  it('plays with the active scene, on its own, or not at all', () => {
    const mapped = t({ mappings: [{ presetId: 'storm', volume: 0.9 }] });
    expect(trackLevel(mapped, 'storm', 1)).toBe(0.9);
    expect(trackLevel(mapped, 'sunny', 1)).toBe(0);
    expect(trackLevel(mapped, 'storm', 0.3)).toBeCloseTo(0.27);
    expect(trackLevel(t({ playing: true }), 'storm', 0.3)).toBe(0.6);
    // Both: the louder one wins.
    expect(trackLevel({ ...mapped, playing: true }, 'storm', 1)).toBe(0.9);
  });

  it('parses stored tracks defensively', () => {
    const list = parseTracks([
      { id: 'a', name: 'Sóng', size: 100, volume: 5, playing: true, mappings: [{ presetId: 'p', volume: 0.4 }, { presetId: 'p' }, 'x'] },
      { id: 'a', name: 'dup' },
      { id: 'b', name: '' },
      null,
    ]);
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({ id: 'a', name: 'Sóng', size: 100, volume: 1, playing: true, mappings: [{ presetId: 'p', volume: 0.4 }] });
  });

  it('names and sizes for the list', () => {
    expect(nameFromFile('song_bien_1h.mp3')).toBe('song bien 1h');
    expect(nameFromFile('Mưa rừng.final.ogg')).toBe('Mưa rừng.final');
    expect(formatSize(58 * 1024 * 1024)).toBe('58.0 MB');
    expect(formatSize(500)).toBe('1 KB');
  });
});
