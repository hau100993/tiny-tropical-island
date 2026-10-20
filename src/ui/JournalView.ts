import { el } from './components';
import { vi } from './strings.vi';
import { GOAL_GROUPS, GOAL_IDS, type GoalGroup, type Journal } from '../activities/journal';

/**
 * "Nhật ký" (J): a card listing the sea goals by activity, ticked ones marked, open ones with a
 * short hint on how to do them. A quiet toast at the top when a goal gets ticked.
 */
export class JournalView {
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly resetButton: HTMLButtonElement;
  private readonly toastEl: HTMLElement;
  private resetArmed = false;
  private readonly queue: string[] = [];

  constructor(parent: HTMLElement, private readonly journal: Journal) {
    this.root = el('div', 'journal');
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', vi.journal.title);
    this.root.hidden = true;
    const head = el('div', 'journal-head');
    this.progress = el('span', 'journal-progress');
    head.append(el('span', 'journal-title', vi.journal.title), this.progress);
    this.body = el('div');
    const foot = el('div', 'journal-foot');
    this.resetButton = el('button', '', vi.journal.reset);
    this.resetButton.type = 'button';
    this.resetButton.addEventListener('click', () => this.onReset());
    foot.append(el('span', '', vi.journal.close), this.resetButton);
    this.root.append(head, this.body, foot);
    this.toastEl = el('div', 'journal-toast');
    this.toastEl.setAttribute('role', 'status');
    this.toastEl.hidden = true;
    parent.append(this.root, this.toastEl);
    journal.onChange((id) => {
      if (id) this.toast(`${vi.journal.toast}: ✓ ${vi.journal.goals[id][0]}`);
      if (!this.root.hidden) this.render();
    });
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  toggle(): void {
    this.root.hidden = !this.root.hidden;
    this.disarmReset();
    if (!this.root.hidden) this.render();
  }

  private render(): void {
    this.progress.textContent = vi.journal.progress(this.journal.count, GOAL_IDS.length);
    const rows: HTMLElement[] = [];
    for (const group of Object.keys(GOAL_GROUPS) as GoalGroup[]) {
      rows.push(el('div', 'journal-group', vi.journal.groups[group]));
      for (const id of GOAL_GROUPS[group]) {
        const done = this.journal.isDone(id);
        const [name, hint] = vi.journal.goals[id];
        const row = el('div', done ? 'journal-goal done' : 'journal-goal');
        row.append(el('span', 'journal-mark', done ? '✓' : '○'), el('span', 'journal-name', name));
        if (!done) row.append(el('span', 'journal-hint', hint));
        rows.push(row);
      }
    }
    this.body.replaceChildren(...rows);
  }

  /** "Làm lại" needs a second click to clear everything. */
  private onReset(): void {
    if (!this.resetArmed) {
      this.resetArmed = true;
      this.resetButton.textContent = vi.journal.resetConfirm;
      return;
    }
    this.disarmReset();
    this.journal.reset();
  }

  private disarmReset(): void {
    this.resetArmed = false;
    this.resetButton.textContent = vi.journal.reset;
  }

  /** Toasts take turns (two goals can be ticked in the same moment). */
  private toast(text: string): void {
    this.queue.push(text);
    if (this.toastEl.hidden) this.nextToast();
  }

  private nextToast(): void {
    const text = this.queue.shift();
    if (text === undefined) return;
    this.toastEl.textContent = text;
    this.toastEl.hidden = false;
    this.toastEl.classList.remove('fade');
    const hold = this.queue.length > 0 ? 2200 : 3600;
    window.setTimeout(() => this.toastEl.classList.add('fade'), hold);
    window.setTimeout(() => {
      this.toastEl.hidden = true;
      this.nextToast();
    }, hold + 700);
  }
}
