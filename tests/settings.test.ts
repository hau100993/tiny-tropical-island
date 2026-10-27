import { describe, expect, it } from 'vitest';
import { defaultSettings, fromSkyBalance, mouseLook, parseSettings, SETTINGS_VERSION, skyBalance } from '../src/core/settings';
import { parseSceneValues } from '../src/core/scenePresets';

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

  it('turns activity sounds on once for version 2 data, and keeps a later choice', () => {
    expect(defaultSettings().footsteps).toBe(true);
    expect(parseSettings(JSON.stringify({ version: 2, footsteps: false })).footsteps).toBe(true);
    expect(parseSettings(JSON.stringify({ version: 3, footsteps: false })).footsteps).toBe(false);
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

describe('sky balance (gloom and clarity as one slider)', () => {
  it('maps −1 … +1 onto one of the two fields', () => {
    expect(fromSkyBalance(-0.4)).toEqual({ gloom: 0.4, clarity: 0 });
    expect(fromSkyBalance(0.7)).toEqual({ gloom: 0, clarity: 0.7 });
    expect(fromSkyBalance(0)).toEqual({ gloom: 0, clarity: 0 });
    expect(fromSkyBalance(3)).toEqual({ gloom: 0, clarity: 1 });
    expect(skyBalance(fromSkyBalance(-0.25))).toBeCloseTo(-0.25);
  });

  it('keeps the net when old data had both up', () => {
    const s = parseSettings(JSON.stringify({ gloom: 0.3, clarity: 1 }));
    expect(s.gloom).toBe(0);
    expect(s.clarity).toBeCloseTo(0.7);
    const v = parseSceneValues({ gloom: 0.8, clarity: 0.2 });
    expect(v.gloom).toBeCloseTo(0.6);
    expect(v.clarity).toBe(0);
  });

  it('leaves the panel tab valid', () => {
    expect(parseSettings(JSON.stringify({ panelTab: 'sound' })).panelTab).toBe('sound');
    expect(parseSettings(JSON.stringify({ panelTab: 'nope', panelSections: ['view'] })).panelTab).toBe('scene');
  });
});
