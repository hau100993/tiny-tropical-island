export interface Shortcut {
  /** KeyboardEvent.code, e.g. 'KeyH' or 'Backquote' (layout-independent). */
  code: string;
  /** Key as printed on the keyboard, shown in the shortcut list. */
  keyLabel: string;
  /** Vietnamese label shown in the UI. */
  label: string;
  action: () => void;
  /** Not listed one by one in the panel (e.g. the 1–9 scene keys, described by one hint). */
  unlisted?: boolean;
}

/** Inputs that take no typing: shortcuts still work while one of them has the focus. */
const NON_TEXT_INPUTS = new Set(['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file']);

/** True while the user types into a text field (a slider or switch that kept the focus doesn't count). */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true;
  return target instanceof HTMLInputElement && !NON_TEXT_INPUTS.has(target.type);
}

/** Global keyboard shortcuts; ignored while typing in a text field. */
export class Keymap {
  private readonly shortcuts = new Map<string, Shortcut>();

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
      if (isTyping(e.target)) return;
      const s = this.shortcuts.get(e.code);
      if (!s) return;
      e.preventDefault();
      s.action();
    });
  }

  register(shortcut: Shortcut): void {
    this.shortcuts.set(shortcut.code, shortcut);
  }

  list(): Shortcut[] {
    return [...this.shortcuts.values()].filter((s) => !s.unlisted);
  }
}
