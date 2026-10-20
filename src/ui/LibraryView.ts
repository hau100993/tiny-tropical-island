import { button, el, slider, toggle, VOLUME } from './components';
import { icons } from './icons';
import { vi } from './strings.vi';
import type { SoundLibrary } from '../audio/library/SoundLibrary';
import { formatSize, type TrackMeta } from '../audio/library/tracks';
import type { ScenePresetStore } from '../core/scenePresets';

const ACCEPT = 'audio/*,.mp3,.ogg,.oga,.opus,.wav,.m4a,.aac,.flac,.webm';

export interface LibraryViewDeps {
  library: SoundLibrary;
  scenes: ScenePresetStore;
  /** Adding a file is a click: start sound if it isn't running yet. */
  startAudio: () => void;
  /** Switches to a scene preset (effects, time, its recordings). */
  applyScene: (id: string) => void;
  /** Deselects the scene preset (its recordings fade out; the effects stay as they are). */
  clearScene: () => void;
}

/**
 * "Âm thanh của tôi": the user's recordings. Each row: ▶/⏸ (play on its own), name, volume,
 * and a details panel to rename, map to scene presets (each with its own volume) or delete.
 * Files can also be dropped onto the list.
 */
export class LibraryView {
  readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private readonly msg: HTMLElement;
  private readonly input: HTMLInputElement;
  /** Picker for "Thay file…" (one file, for the track in `replacing`). */
  private readonly replaceInput: HTMLInputElement;
  private replacing = '';
  /** Track whose details are open. */
  private open = '';
  /**
   * Rebuilding the list replaces its buttons and sliders. Doing that while a slider is dragged
   * drops the drag, and doing it between a button's press and release swallows the click. So
   * while the mouse is down in the panel, a slider is dragged or one has focus, a rebuild waits
   * (`pending`) and runs once the click has been handled.
   */
  private dragging = false;
  private pressing = false;
  private pending = false;
  /** Delete button armed by a first click (a second one within a few seconds deletes). */
  private armed = '';
  private armTimer = 0;

  constructor(private readonly deps: LibraryViewDeps) {
    this.root = el('div', 'library');
    const head = el('div', 'library-head');
    head.append(el('span', 'subhead', vi.library.title));
    this.input = el('input');
    this.input.type = 'file';
    this.input.accept = ACCEPT;
    this.input.multiple = true;
    this.input.hidden = true;
    this.input.addEventListener('change', () => {
      void this.addFiles(Array.from(this.input.files ?? []));
      this.input.value = '';
    });
    const addBtn = button(vi.library.add, () => {
      deps.startAudio();
      this.input.click();
    }, 'btn small primary');
    this.replaceInput = el('input');
    this.replaceInput.type = 'file';
    this.replaceInput.accept = ACCEPT;
    this.replaceInput.hidden = true;
    this.replaceInput.addEventListener('change', () => {
      const file = this.replaceInput.files?.[0];
      this.replaceInput.value = '';
      if (file && this.replacing) void this.replaceFile(this.replacing, file);
    });
    head.append(addBtn, this.input, this.replaceInput);
    this.list = el('div', 'track-list');
    this.msg = el('div', 'hint');
    this.root.append(head, this.list, this.msg);

    this.root.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      this.root.classList.add('drop');
    });
    this.root.addEventListener('dragleave', () => this.root.classList.remove('drop'));
    this.root.addEventListener('drop', (e) => {
      e.preventDefault();
      this.root.classList.remove('drop');
      deps.startAudio();
      void this.addFiles(Array.from(e.dataTransfer?.files ?? []));
    });
    this.root.addEventListener('pointerdown', () => (this.pressing = true), true);
    // Released anywhere (even outside the panel): the click event comes first, then rebuild.
    window.addEventListener('pointerup', () => {
      if (!this.pressing && !this.dragging) return;
      window.setTimeout(() => {
        this.pressing = false;
        this.dragging = false;
        this.flush();
      }, 0);
    }, true);
    this.list.addEventListener('focusout', () => window.setTimeout(() => this.flush(), 0));

    deps.library.onChange(() => this.render());
    deps.scenes.onChange(() => this.render());
    this.render();
  }

  private async addFiles(files: File[]): Promise<void> {
    if (files.length === 0) return;
    this.msg.textContent = vi.library.copying;
    const problems: string[] = [];
    for (const f of files) {
      const r = await this.deps.library.add(f);
      if (r !== 'ok') problems.push(`${f.name}: ${vi.library.errors[r]}`);
    }
    this.msg.textContent = problems.length > 0 ? problems.join(' · ') : '';
  }

  private async replaceFile(id: string, file: File): Promise<void> {
    this.msg.textContent = vi.library.copying;
    const r = await this.deps.library.replace(id, file);
    this.msg.textContent = r === 'ok' ? vi.library.replaced : `${file.name}: ${vi.library.errors[r]}`;
  }

  /** Runs a rebuild that was held back, if nothing holds it any more. */
  private flush(): void {
    if (this.pending) this.render();
  }

  private render(): void {
    const focused = document.activeElement;
    const usingSlider = focused instanceof HTMLInputElement && focused.type === 'range' && this.list.contains(focused);
    if (this.dragging || this.pressing || usingSlider) {
      this.pending = true;
      return;
    }
    this.pending = false;
    const { library } = this.deps;
    const tracks = library.list();
    this.list.replaceChildren();
    if (tracks.length === 0) this.list.append(el('div', 'hint', vi.library.empty));
    for (const t of tracks) this.list.append(this.row(t));
    if (library.hiddenCount > 0) {
      this.list.append(button(vi.library.restore(library.hiddenCount), () => library.restoreBundled(), 'btn small'));
    }
  }

  private row(t: Readonly<TrackMeta>): HTMLElement {
    const { library, scenes } = this.deps;
    const active = library.active;
    const mappedActive = t.mappings.some((m) => m.presetId === active);
    const failed = library.failed(t.id);
    const wrap = el('div', 'track');
    wrap.classList.toggle('sounding', (t.playing || mappedActive) && !failed);

    const line = el('div', 'track-line');
    // A track mapped to scenes plays *with* its scene: ▶ switches to that scene (the first one it
    // is mapped to, unless the active scene is one of them); ⏸ leaves the scene. Unmapped tracks
    // play on their own.
    const sounding = (t.playing || mappedActive) && !failed;
    const firstScene = t.mappings.map((m) => scenes.get(m.presetId)).find((p) => p !== undefined);
    const play = button('', () => {
      if (sounding) {
        if (t.playing) library.setPlaying(t.id, false);
        if (mappedActive) this.deps.clearScene();
      } else if (firstScene) {
        this.deps.startAudio();
        this.deps.applyScene(firstScene.id);
      } else {
        this.deps.startAudio();
        library.setPlaying(t.id, true);
      }
    }, 'icon-btn');
    play.innerHTML = sounding ? icons.pause : icons.play;
    const playLabel = sounding
      ? vi.library.stop
      : firstScene
        ? vi.library.playWithScene(firstScene.name)
        : vi.library.play;
    play.title = playLabel;
    play.setAttribute('aria-label', `${playLabel}: ${t.name}`);
    const bundled = library.isBundled(t.id);
    const name = el('span', 'track-name', t.name);
    name.title = `${t.name} · ${formatSize(t.size)}${bundled ? ` · ${vi.library.bundled}` : ''}`;
    const vol = slider('', t.volume, (v) => library.setVolume(t.id, v), { ...VOLUME, defaultValue: 0.7 });
    vol.root.classList.add('compact');
    vol.input.setAttribute('aria-label', `${vi.library.volume}: ${t.name}`);
    this.trackDrag(vol.input);
    const more = button('', () => {
      this.open = this.open === t.id ? '' : t.id;
      this.render();
    }, 'icon-btn');
    more.innerHTML = icons.gear;
    more.title = vi.library.details;
    more.setAttribute('aria-label', `${vi.library.details}: ${t.name}`);
    more.setAttribute('aria-expanded', String(this.open === t.id));
    line.append(play, name, vol.root, more);
    wrap.append(line);

    // Which scenes this track plays with (short tags), or a warning.
    const tags = el('div', 'track-tags');
    if (failed) tags.append(el('span', 'note', vi.library.failed));
    for (const m of t.mappings) {
      const p = scenes.get(m.presetId);
      if (!p) continue;
      const tag = el('span', m.presetId === active ? 'tag on' : 'tag', `${p.name} ${Math.round(m.volume * 100)}%`);
      tags.append(tag);
    }
    if (tags.childElementCount > 0) wrap.append(tags);

    if (this.open === t.id) wrap.append(this.details(t));
    return wrap;
  }

  private details(t: Readonly<TrackMeta>): HTMLElement {
    const { library, scenes } = this.deps;
    const box = el('div', 'track-details');

    const renameForm = el('form', 'save-form');
    const nameInput = el('input', 'text-input');
    nameInput.value = t.name;
    nameInput.maxLength = 40;
    nameInput.setAttribute('aria-label', vi.library.rename);
    const ok = el('button', 'btn small', vi.library.rename);
    ok.type = 'submit';
    renameForm.append(nameInput, ok);
    renameForm.addEventListener('submit', (e) => {
      e.preventDefault();
      library.rename(t.id, nameInput.value);
    });

    box.append(renameForm, el('div', 'hint', vi.library.mapHint));
    for (const p of scenes.all()) {
      const mapping = t.mappings.find((m) => m.presetId === p.id);
      const r = el('div', 'map-row');
      const on = toggle(p.name, !!mapping, (v) => library.setMapping(t.id, p.id, v ? (mapping?.volume ?? 0.7) : null), 'toggle small');
      r.append(on.root);
      if (mapping) {
        const v = slider('', mapping.volume, (x) => library.setMapping(t.id, p.id, x), { ...VOLUME, defaultValue: 0.7 });
        v.root.classList.add('compact');
        v.input.setAttribute('aria-label', `${vi.library.volume}: ${p.name}`);
        this.trackDrag(v.input);
        r.append(v.root);
      }
      box.append(r);
    }

    // Replace the audio (keeps name, volume, mappings); a shipped one can go back to its file.
    const actions = el('div', 'button-row');
    const replace = button(vi.library.replace, () => {
      this.deps.startAudio();
      this.replacing = t.id;
      this.replaceInput.click();
    }, 'btn small');
    replace.title = vi.library.replaceTitle;
    actions.append(replace);
    if (t.custom) actions.append(button(vi.library.original, () => void library.useOriginal(t.id), 'btn small'));
    // Bundled recordings ship with the app: they can only be hidden from the list.
    const bundled = library.isBundled(t.id);
    // Two-step delete on the button itself (a browser confirm() can be blocked for the page):
    // the first click arms it, a second click within a few seconds deletes.
    const armed = this.armed === t.id;
    const del = button(armed ? vi.library.confirmAgain : bundled ? vi.library.hide : vi.library.delete, () => {
      window.clearTimeout(this.armTimer);
      if (this.armed === t.id) {
        this.armed = '';
        void library.remove(t.id);
        return;
      }
      this.armed = t.id;
      this.armTimer = window.setTimeout(() => {
        this.armed = '';
        this.render();
      }, 4000);
      this.render();
    }, armed ? 'btn small danger' : 'btn small');
    del.title = bundled ? vi.library.confirmHide(t.name) : vi.library.confirmDelete(t.name);
    actions.append(del);
    const origin = bundled ? ` · ${t.custom ? vi.library.custom : vi.library.bundled}` : '';
    box.append(el('div', 'hint', `${formatSize(t.size)}${origin}`), actions);
    return box;
  }

  private trackDrag(input: HTMLInputElement): void {
    input.addEventListener('pointerdown', () => (this.dragging = true));
  }
}
