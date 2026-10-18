import type { AudioEngine } from '../AudioEngine';

export type ChimeKind = 'toBreak' | 'toFocus';

/** Partials of a small struck bell (ratios of a bar chime), with their level and decay (s). */
const PARTIALS: ReadonlyArray<[ratio: number, level: number, decay: number]> = [
  [1, 1, 2.4],
  [2.76, 0.32, 1.1],
  [5.4, 0.12, 0.5],
  [8.93, 0.05, 0.25],
];

/** Notes (Hz) of each chime: down a third into a break, up a fourth back to focus. */
const NOTES: Record<ChimeKind, number[]> = {
  toBreak: [784, 659.3, 523.3],
  toFocus: [523.3, 698.5],
};

/**
 * A gentle bell chime placed on the audio clock at `when` (AudioContext time). Scheduling it on
 * the audio clock, minutes ahead, keeps it on time in a hidden tab, where JS timers may run only
 * once a minute. Returns a cancel function (for pause/reset before it rings).
 */
export function scheduleChime(engine: AudioEngine, when: number, kind: ChimeKind, volume = 0.35): () => void {
  const ctx = engine.ctx;
  const nodes: Array<OscillatorNode | GainNode> = [];
  const t0 = Math.max(when, ctx.currentTime + 0.02);
  let longest: OscillatorNode | null = null;
  let longestEnd = 0;
  NOTES[kind].forEach((freq, i) => {
    const start = t0 + i * 0.42;
    for (const [ratio, level, decay] of PARTIALS) {
      const osc = ctx.createOscillator();
      osc.frequency.value = freq * ratio;
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(volume * level, start + 0.006);
      g.gain.setTargetAtTime(0, start + 0.006, decay / 4);
      osc.connect(g).connect(engine.alerts);
      osc.start(start);
      osc.stop(start + decay * 1.6);
      nodes.push(osc, g);
      if (start + decay * 1.6 > longestEnd) {
        longestEnd = start + decay * 1.6;
        longest = osc;
      }
    }
  });
  let done = false;
  const cleanup = (): void => {
    if (done) return;
    done = true;
    for (const n of nodes) {
      if (n instanceof OscillatorNode) {
        try {
          n.stop();
        } catch {
          // Already stopped.
        }
      }
      n.disconnect();
    }
  };
  // Free the nodes once the chime has rung out.
  if (longest) (longest as OscillatorNode).onended = cleanup;
  return cleanup;
}
