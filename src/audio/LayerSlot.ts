import type { AudioLayer, LayerId, SpatialMix } from './types';
import type { FileLayer } from './file/FileLayer';

export type LayerSource = 'synth' | 'file';

/**
 * One mixer channel: the synthesized layer, optionally replaced by the user's recordings.
 * Every control goes to both, but only the active one is enabled, so switching source is just a
 * crossfade (the inactive one fades out and stops its nodes).
 */
export class LayerSlot implements AudioLayer {
  private file: FileLayer | null = null;
  private enabled = false;

  constructor(
    readonly id: LayerId,
    private readonly synth: AudioLayer,
    private readonly onSourceChange: () => void,
  ) {}

  get source(): LayerSource {
    return this.file ? 'file' : 'synth';
  }

  /** Switches to recordings once the first one is decoded; keeps the synth if none decode. */
  async attachFile(file: FileLayer, state: { volume: number; muted: boolean }): Promise<void> {
    file.setVolume(state.volume);
    file.setMuted(state.muted);
    if (!(await file.prepare())) {
      file.dispose();
      return;
    }
    this.file = file;
    file.setEnabled(this.enabled);
    this.synth.setEnabled(false);
    this.onSourceChange();
  }

  /** Called when the recordings stop being playable: back to the synthesized sound. */
  detachFile(): void {
    const f = this.file;
    if (!f) return;
    this.file = null;
    this.synth.setEnabled(this.enabled);
    f.setEnabled(false);
    window.setTimeout(() => f.dispose(), 2000);
    this.onSourceChange();
  }

  setVolume(volume: number): void {
    this.synth.setVolume(volume);
    this.file?.setVolume(volume);
  }

  setMuted(muted: boolean): void {
    this.synth.setMuted(muted);
    this.file?.setMuted(muted);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    (this.file ?? this.synth).setEnabled(enabled);
  }

  setSpatial(spatial: Readonly<SpatialMix>): void {
    this.synth.setSpatial(spatial);
    this.file?.setSpatial(spatial);
  }

  setDuck(gain: number, timeConstant: number): void {
    this.synth.setDuck(gain, timeConstant);
    this.file?.setDuck(gain, timeConstant);
  }

  dispose(): void {
    this.synth.dispose();
    this.file?.dispose();
  }
}
