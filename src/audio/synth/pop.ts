import type { AudioEngine } from '../AudioEngine';

/** The click's noise, made once per AudioContext. */
const clicks = new WeakMap<BaseAudioContext, AudioBuffer>();

function clickBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buf = clicks.get(ctx);
  if (!buf) {
    const len = Math.round(ctx.sampleRate * 0.015);
    buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    clicks.set(ctx, buf);
  }
  return buf;
}

/**
 * A soap bubble's "bụp" on the alerts bus at AudioContext time `when`: a sine that drops an
 * octave in 60 ms (the pop's body) over a 15 ms click of filtered noise. `size` 0..1: bigger
 * bubbles pop lower. The nodes free themselves when it ends.
 */
export function schedulePop(engine: AudioEngine, when: number, size: number, volume = 0.18): void {
  const ctx = engine.ctx;
  const t0 = Math.max(when, ctx.currentTime + 0.005);
  const f0 = 1400 - size * 700 + Math.random() * 250;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(f0, t0);
  osc.frequency.exponentialRampToValueAtTime(f0 * 0.5, t0 + 0.06);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(volume, t0 + 0.004);
  g.gain.setTargetAtTime(0, t0 + 0.004, 0.02);
  osc.connect(g).connect(engine.alerts);
  osc.start(t0);
  osc.stop(t0 + 0.15);

  const noise = ctx.createBufferSource();
  noise.buffer = clickBuffer(ctx);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 2500;
  const ng = ctx.createGain();
  ng.gain.value = volume * 0.5;
  noise.connect(hp).connect(ng).connect(engine.alerts);
  noise.start(t0);
  osc.onended = () => {
    osc.disconnect();
    g.disconnect();
    noise.disconnect();
    hp.disconnect();
    ng.disconnect();
  };
}
