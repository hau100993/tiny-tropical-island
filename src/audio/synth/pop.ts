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
 * A cartoon bubble shot out ("bloop"): a sine gliding up 1.6 octaves in 90 ms with a quick
 * swell and fade, a quiet octave above for some body. The sound of a bubble being blown out.
 */
export function scheduleBloop(engine: AudioEngine, when: number, volume = 0.1): void {
  const ctx = engine.ctx;
  const t0 = Math.max(when, ctx.currentTime + 0.005);
  const f0 = 240 + Math.random() * 80;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(volume, t0 + 0.012);
  g.gain.setTargetAtTime(0, t0 + 0.05, 0.025);
  g.connect(engine.alerts);
  const nodes: AudioNode[] = [g];
  let last: OscillatorNode | null = null;
  for (const [mul, level] of [
    [1, 1],
    [2, 0.25],
  ] as const) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0 * mul, t0);
    osc.frequency.exponentialRampToValueAtTime(f0 * mul * 3, t0 + 0.09);
    const lg = ctx.createGain();
    lg.gain.value = level;
    osc.connect(lg).connect(g);
    osc.start(t0);
    osc.stop(t0 + 0.2);
    nodes.push(osc, lg);
    last = osc;
  }
  if (last) freeOnEnd(last, nodes);
}

/**
 * A bubble bursting ("pop"): a short sine that drops an octave in 50 ms over a 15 ms click of
 * filtered noise. `step` 0..1 is its place in the chain: each pop is a little higher than the
 * one before, so a chain of them climbs.
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

/** Notes (Hz) of the closing sparkle: a quick rising arpeggio, high and bright (G6 C7 E7 G7). */
const SPARKLE = [1568, 2093, 2637, 3136];

/**
 * The finish: a quick, high arpeggio of small bells (two sine partials each, fast decay), the
 * "ting-ting-ting-ting" after the last bubble.
 */
export function scheduleSparkle(engine: AudioEngine, when: number, volume = 0.1): void {
  const ctx = engine.ctx;
  const t0 = Math.max(when, ctx.currentTime + 0.005);
  SPARKLE.forEach((freq, i) => {
    const start = t0 + i * 0.065;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(volume, start + 0.004);
    g.gain.setTargetAtTime(0, start + 0.004, 0.09);
    g.connect(engine.alerts);
    const nodes: AudioNode[] = [g];
    let last: OscillatorNode | null = null;
    for (const [ratio, level] of [
      [1, 1],
      [2.76, 0.25],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.frequency.value = freq * ratio;
      const lg = ctx.createGain();
      lg.gain.value = level;
      osc.connect(lg).connect(g);
      osc.start(start);
      osc.stop(start + 0.6);
      nodes.push(osc, lg);
      last = osc;
    }
    if (last) freeOnEnd(last, nodes);
  });
}
