import type { LayerId, SpatialMix } from './types';
import { clamp, smoothstep } from '../core/math';

/** Where the listener is while walking (computed from the walker each frame). */
export interface ListenerState {
  walking: boolean;
  /** Meters inland from the coastline (negative when wading). */
  shoreDistance: number;
  /** How far the sea lies to the listener's right: −1 (left) … 1 (right). */
  seaSide: number;
  /** Tree trunks within ~12 m. */
  trees: number;
  shelter: 'none' | 'porch' | 'room';
}

/**
 * The cheap "spatial touch" for walk mode (no HRTF, no per-source panning):
 * - waves: loud on the beach and in the water, faint deep inland, panned toward the sea;
 * - birds (and crickets): louder among trees, quieter on open sand;
 * - wind: a bit stronger out in the open, sheltered in the forest;
 * - inside the house everything is quieter and low-passed, rain most of all
 *   (you hear it on the roof); on the porch rain is only slightly muffled.
 * In orbit mode every layer is neutral.
 */
export function spatialMix(id: LayerId, l: Readonly<ListenerState>, out: SpatialMix): SpatialMix {
  out.gain = 1;
  out.pan = 0;
  out.occlusion = 0;
  if (!l.walking) return out;
  const room = l.shelter === 'room';
  const porch = l.shelter === 'porch';
  const forest = clamp(l.trees / 10, 0, 1);
  switch (id) {
    case 'waves': {
      const near = 1 - smoothstep(2, 45, l.shoreDistance);
      out.gain = 0.3 + 1.0 * near;
      out.pan = clamp(l.seaSide, -1, 1) * 0.55 * (0.3 + 0.7 * near);
      out.occlusion = room ? 0.55 : 0;
      break;
    }
    case 'birds':
      out.gain = 0.45 + 0.85 * forest;
      out.occlusion = room ? 0.5 : 0;
      break;
    case 'wind':
      out.gain = 1.15 - 0.35 * forest - (room ? 0.4 : 0);
      out.occlusion = room ? 0.6 : 0;
      break;
    case 'rain':
      out.gain = room ? 0.6 : porch ? 0.85 : 1;
      out.occlusion = room ? 0.7 : porch ? 0.2 : 0;
      break;
    case 'snow':
      out.gain = room ? 0.6 : 1;
      out.occlusion = room ? 0.4 : 0;
      break;
  }
  return out;
}
