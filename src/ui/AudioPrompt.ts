import { el } from './components';
import { vi } from './strings.vi';
import { isTouch } from './touch';

/**
 * Small, unobtrusive note shown until sound starts. Browsers only allow audio after the user
 * has clicked or pressed a key, so the first interaction anywhere starts it (see App).
 */
export class AudioPrompt {
  private readonly root: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'audio-prompt');
    this.root.setAttribute('role', 'status');
    this.root.hidden = true;
    parent.append(this.root);
  }

  show(failed = false): void {
    const t = vi.audioPrompt;
    this.root.textContent = isTouch() ? (failed ? t.failedTouch : t.waitingTouch) : failed ? t.failed : t.waiting;
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }
}
