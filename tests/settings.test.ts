import { describe, expect, it } from 'vitest';
import { defaultSettings, parseSettings, SETTINGS_VERSION } from '../src/core/settings';
import { effectiveProfile, QUALITY_PROFILES } from '../src/core/quality';

describe('parseSettings', () => {
  it('returns defaults for missing or corrupt data', () => {
    expect(parseSettings(null)).toEqual(defaultSettings());
    expect(parseSettings('not json')).toEqual(defaultSettings());
    expect(parseSettings('42')).toEqual(defaultSettings());
  });

  it('keeps valid fields and replaces invalid ones with defaults', () => {
    const s = parseSettings(JSON.stringify({ version: 1, quality: 'high', lowPower: 'yes', autoRotate: true }));
    expect(s.quality).toBe('high');
    expect(s.lowPower).toBe(defaultSettings().lowPower);
    expect(s.autoRotate).toBe(true);
  });

  it('rejects unknown quality levels', () => {
    expect(parseSettings(JSON.stringify({ quality: 'ultra' })).quality).toBe('medium');
  });

  it('upgrades unversioned data to the current version', () => {
    expect(parseSettings(JSON.stringify({ lowPower: true })).version).toBe(SETTINGS_VERSION);
  });

  it('clamps wave strength to [0, 1] and rejects non-numbers', () => {
    expect(parseSettings(JSON.stringify({ waveStrength: 3 })).waveStrength).toBe(1);
    expect(parseSettings(JSON.stringify({ waveStrength: -1 })).waveStrength).toBe(0);
    expect(parseSettings(JSON.stringify({ waveStrength: 'big' })).waveStrength).toBe(defaultSettings().waveStrength);
  });
});

describe('effectiveProfile', () => {
  it('low power drops to Low-level costs but keeps the MSAA chosen at startup', () => {
    const p = effectiveProfile('high', true);
    expect(p.shadowMapSize).toBe(0);
    expect(p.refraction).toBe(false);
    expect(p.causticsRes).toBe(0);
    expect(p.waterSimRes).toBe(QUALITY_PROFILES.low.waterSimRes);
    expect(p.msaa).toBe(QUALITY_PROFILES.high.msaa);
  });

  it('returns the preset unchanged when low power is off', () => {
    expect(effectiveProfile('medium', false)).toEqual(QUALITY_PROFILES.medium);
  });
});
