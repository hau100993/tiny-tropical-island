import { el } from './components';
import { vi } from './strings.vi';

/**
 * Small, unobtrusive note shown until sound starts. Browsers only allow audio after the user
 * has clicked or pressed a key, so the first interaction anywhere starts it (see App).
 */
export class AudioPrompt {
  private readonly root: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'audio-prompt', vi.audioPrompt.waiting);
    this.root.setAttribute('role', 'status');
    this.root.hidden = true;
    parent.append(this.root);
  }

  show(failed = false): void {
    this.root.textContent = failed ? vi.audioPrompt.failed : vi.audioPrompt.waiting;
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }
}
