export type LayerId = 'waves' | 'birds' | 'wind' | 'rain' | 'snow';

export const LAYER_IDS: readonly LayerId[] = ['waves', 'birds', 'wind', 'rain', 'snow'];

export interface LayerState {
  /** 0..1 slider position (mapped to gain with a perceptual curve). */
  volume: number;
  /** Off = the layer's audio nodes are stopped (no CPU cost). */
  enabled: boolean;
  /** Muted = silent but still running, for instant un-mute. */
  muted: boolean;
}

export interface MixerState {
  master: { volume: number; muted: boolean };
  layers: Record<LayerId, LayerState>;
}

/**
 * Every audio layer, synthesized or file-based, exposes this interface (see CLAUDE.md).
 * All changes ramp smoothly; nothing clicks.
 */
export interface AudioLayer {
  readonly id: LayerId;
  setVolume(volume: number): void;
  setEnabled(enabled: boolean): void;
  setMuted(muted: boolean): void;
  /** Extra gain from position in the world (Phase 5); 1 = neutral. */
  setSpatialGain(gain: number): void;
  dispose(): void;
}
