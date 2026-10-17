import { button, el } from './components';
import { vi } from './strings.vi';

/**
 * First screen. Browsers only allow audio to start from a user gesture, so the
 * "Bắt đầu nghe" click is what creates the AudioContext. The scene already renders behind.
 */
export class StartScreen {
  private readonly root: HTMLElement;
  private readonly error: HTMLElement;

  constructor(parent: HTMLElement, onListen: () => Promise<void>) {
    this.root = el('div', 'start-screen');
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    const card = el('div', 'start-card');
    const title = el('h1', 'start-title', vi.start.title);
    const sub = el('p', 'start-subtitle', vi.start.subtitle);
    const listen = button(vi.start.listen, () => void this.listen(onListen, listen), 'btn primary big');
    const silent = button(vi.start.silent, () => this.close(), 'btn ghost');
    const actions = el('div', 'start-actions');
    actions.append(listen, silent);
    this.error = el('p', 'note error');
    card.append(title, sub, actions, el('p', 'start-hint', vi.start.hint), this.error);
    this.root.append(card);
    parent.append(this.root);
    listen.focus();
  }

  private async listen(onListen: () => Promise<void>, btn: HTMLButtonElement): Promise<void> {
    btn.disabled = true;
    try {
      await onListen();
      this.close();
    } catch (e) {
      console.warn('Audio start failed', e);
      this.error.textContent = vi.start.failed;
      btn.disabled = false;
    }
  }

  private close(): void {
    this.root.remove();
  }
}
