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
  /** Where the listener is (walk mode); neutral in orbit mode. */
  setSpatial(spatial: Readonly<SpatialMix>): void;
  dispose(): void;
}

/** Position-dependent mix of one layer while walking. */
export interface SpatialMix {
  /** Extra gain; 1 = neutral. */
  gain: number;
  /** Stereo position, −1 (left) … 1 (right). */
  pan: number;
  /** 0 = open air … 1 = heard through walls (low-passed). */
  occlusion: number;
}

export const NEUTRAL_SPATIAL: Readonly<SpatialMix> = { gain: 1, pan: 0, occlusion: 0 };
