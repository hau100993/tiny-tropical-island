import { describe, expect, it } from 'vitest';
import { parseBundled } from '../src/audio/library/bundled';

const sizes = new Map([
  ['library/island-day.mp3', 1000],
  ['library/island-night.mp3', 2000],
]);

describe('parseBundled', () => {
  it('keeps entries whose file exists, with URL, size and mappings', () => {
    const out = parseBundled(
      {
        tracks: [
          { id: 'island-day', name: 'Ngày', file: 'library/island-day.mp3', mappings: [{ presetId: 'b-sunny', volume: 0.5 }] },
          { id: 'island-night', name: 'Đêm', file: './audio/library/island-night.mp3', mappings: [] },
        ],
      },
      sizes,
    );
    expect(out).toEqual([
      { id: 'b:island-day', name: 'Ngày', src: 'audio/library/island-day.mp3', size: 1000, mappings: [{ presetId: 'b-sunny', volume: 0.5 }] },
      { id: 'b:island-night', name: 'Đêm', src: 'audio/library/island-night.mp3', size: 2000, mappings: [] },
    ]);
  });

  it('skips missing files, duplicates and malformed entries; never throws', () => {
    const out = parseBundled(
      {
        tracks: [
          { id: 'gone', name: 'X', file: 'library/missing.mp3' },
          { id: 'island-day', name: 'A', file: 'library/island-day.mp3', mappings: [{ presetId: 'p', volume: 9 }, { presetId: 'p' }, 3] },
          { id: 'island-day', name: 'B', file: 'library/island-day.mp3' },
          { id: '', name: 'C', file: 'library/island-night.mp3' },
          { id: 'n', name: '   ', file: 'library/island-night.mp3' },
          null,
        ],
      },
      sizes,
    );
    expect(out).toHaveLength(1);
    expect(out[0].mappings).toEqual([{ presetId: 'p', volume: 1 }]);
    expect(parseBundled(null, sizes)).toEqual([]);
    expect(parseBundled({ tracks: 'x' }, sizes)).toEqual([]);
  });
});
