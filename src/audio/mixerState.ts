import { LAYER_IDS, type LayerId, type LayerState, type MixerState } from './types';
import { bool, clamp01, isRecord } from '../core/storage';

export const MIXER_KEY = 'tsw.mixer';

/** First-launch mix: the "Tập trung" (Focus) preset. */
export function defaultMixerState(): MixerState {
  return {
    master: { volume: 0.8, muted: false },
    layers: {
      waves: { volume: 0.55, enabled: true, muted: false },
      birds: { volume: 0.3, enabled: true, muted: false },
      wind: { volume: 0.25, enabled: true, muted: false },
      rain: { volume: 0.5, enabled: false, muted: false },
      snow: { volume: 0.5, enabled: false, muted: false },
    },
  };
}

export function cloneMixerState(s: MixerState): MixerState {
  const layers = {} as Record<LayerId, LayerState>;
  for (const id of LAYER_IDS) layers[id] = { ...s.layers[id] };
  return { master: { ...s.master }, layers };
}

/** Validates unknown data (storage, presets); bad or missing fields fall back to defaults. */
export function parseMixerState(raw: unknown): MixerState {
  const d = defaultMixerState();
  if (!isRecord(raw)) return d;
  const master = isRecord(raw.master) ? raw.master : {};
  const layersRaw = isRecord(raw.layers) ? raw.layers : {};
  const layers = {} as Record<LayerId, LayerState>;
  for (const id of LAYER_IDS) {
    const l = isRecord(layersRaw[id]) ? (layersRaw[id] as Record<string, unknown>) : {};
    layers[id] = {
      volume: clamp01(l.volume, d.layers[id].volume),
      enabled: bool(l.enabled, d.layers[id].enabled),
      muted: bool(l.muted, d.layers[id].muted),
    };
  }
  return {
    master: { volume: clamp01(master.volume, d.master.volume), muted: bool(master.muted, d.master.muted) },
    layers,
  };
}
