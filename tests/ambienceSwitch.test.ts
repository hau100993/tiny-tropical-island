import { describe, expect, it } from 'vitest';
import { AmbienceSwitch } from '../src/audio/ambienceSwitch';

function make(): { sw: AmbienceSwitch; muted: () => boolean } {
  let muted = true;
  const sw = new AmbienceSwitch((m) => {
    muted = m;
  });
  return { sw, muted: () => muted };
}

describe('soundscape switch', () => {
  it('a video silences it, and it comes back when the video stops', () => {
    const { sw, muted } = make();
    expect(muted()).toBe(false);
    sw.setVideoPlaying(true);
    expect(muted()).toBe(true);
    sw.setVideoPlaying(false);
    expect(muted()).toBe(false);
  });

  it('turned on during a video, it stays on for later videos', () => {
    const { sw, muted } = make();
    sw.setVideoPlaying(true);
    sw.toggle();
    expect(muted()).toBe(false);
    sw.setVideoPlaying(false);
    sw.setVideoPlaying(true);
    expect(muted()).toBe(false);
    sw.toggle();
    expect(muted()).toBe(true);
    sw.setVideoPlaying(false);
    expect(muted()).toBe(false);
  });

  it('turned off without a video, it stays off when a video stops', () => {
    const { sw, muted } = make();
    sw.toggle();
    expect(muted()).toBe(true);
    sw.setVideoPlaying(true);
    sw.setVideoPlaying(false);
    expect(muted()).toBe(true);
    sw.toggle();
    expect(sw.on).toBe(true);
  });
});
