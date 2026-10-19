import { describe, expect, it } from 'vitest';
import { defaultSettings, parseSettings, SETTINGS_VERSION } from '../src/core/settings';

describe('parseSettings', () => {
  it('returns defaults for missing or corrupt data', () => {
    expect(parseSettings(null)).toEqual(defaultSettings());
    expect(parseSettings('not json')).toEqual(defaultSettings());
    expect(parseSettings('42')).toEqual(defaultSettings());
  });

  it('keeps valid fields and replaces invalid ones with defaults', () => {
    const s = parseSettings(JSON.stringify({ version: 1, quality: 'high', footsteps: 'yes', autoRotate: true }));
    expect(s.quality).toBe('high');
    expect(s.footsteps).toBe(defaultSettings().footsteps);
    expect(s.autoRotate).toBe(true);
  });

  it('rejects unknown quality levels', () => {
    expect(parseSettings(JSON.stringify({ quality: 'ultra' })).quality).toBe('medium');
  });

  it('upgrades unversioned data to the current version', () => {
    expect(parseSettings(JSON.stringify({ autoRotate: true })).version).toBe(SETTINGS_VERSION);
  });

  it('clamps wave strength to [0, 1] and rejects non-numbers', () => {
    expect(parseSettings(JSON.stringify({ waveStrength: 3 })).waveStrength).toBe(1);
    expect(parseSettings(JSON.stringify({ waveStrength: -1 })).waveStrength).toBe(0);
    expect(parseSettings(JSON.stringify({ waveStrength: 'big' })).waveStrength).toBe(defaultSettings().waveStrength);
  });
});
