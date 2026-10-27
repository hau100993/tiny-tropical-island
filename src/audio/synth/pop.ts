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

/** Disconnects every node once `last` has ended. */
function freeOnEnd(last: AudioScheduledSourceNode, nodes: AudioNode[]): void {
  last.onended = () => {
    for (const n of nodes) n.disconnect();
  };
}

/**
 * A bubble bursting ("pop"): a short sine that drops an octave in 50 ms over a 15 ms click of
 * filtered noise. `step` 0..1 sets the pitch (low for a big bubble, high for a small one).
 */
export function schedulePop(engine: AudioEngine, when: number, step: number, volume = 0.18): void {
  const ctx = engine.ctx;
  const t0 = Math.max(when, ctx.currentTime + 0.005);
  const f0 = 720 + step * 900 + Math.random() * 60;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(f0, t0);
  osc.frequency.exponentialRampToValueAtTime(f0 * 0.5, t0 + 0.05);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(volume, t0 + 0.003);
  g.gain.setTargetAtTime(0, t0 + 0.003, 0.018);
  osc.connect(g).connect(engine.alerts);
  osc.start(t0);
  osc.stop(t0 + 0.14);

  const noise = ctx.createBufferSource();
  noise.buffer = clickBuffer(ctx);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 2500;
  const ng = ctx.createGain();
  ng.gain.value = volume * 0.55;
  noise.connect(hp).connect(ng).connect(engine.alerts);
  noise.start(t0);
  freeOnEnd(osc, [osc, g, noise, hp, ng]);
}
