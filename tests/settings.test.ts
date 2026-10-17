import { describe, expect, it } from 'vitest';
import { defaultSettings, parseSettings, SETTINGS_VERSION } from '../src/core/settings';

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
});
