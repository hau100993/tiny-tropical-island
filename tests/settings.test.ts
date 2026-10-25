import { describe, expect, it } from 'vitest';
import { defaultSettings, mouseLook, parseSettings, SETTINGS_VERSION } from '../src/core/settings';

describe('parseSettings', () => {
  it('maps the old day-cycle modes onto the island clock', () => {
    const p = (timeMode: string) => {
      const s = parseSettings(JSON.stringify({ timeMode, timeSpeed: 10 }));
      return [s.timeMode, s.timeSpeed, s.timePaused];
    };
    expect(p('cycle24')).toEqual(['free', 60, false]);
    expect(p('cycle6')).toEqual(['free', 240, false]);
    expect(p('paused')).toEqual(['free', 10, true]);
    expect(p('real')).toEqual(['real', 10, false]);
    expect(parseSettings(JSON.stringify({ timeSpeed: 7 })).timeSpeed).toBe(60);
  });

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

  it('keeps the mouse speed in [0, 1], slower than before by default', () => {
    expect(parseSettings(JSON.stringify({ mouseSpeed: 3 })).mouseSpeed).toBe(1);
    expect(parseSettings(JSON.stringify({ mouseSpeed: 'x' })).mouseSpeed).toBe(0.4);
    expect(mouseLook(defaultSettings().mouseSpeed)).toBeCloseTo(0.6);
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
