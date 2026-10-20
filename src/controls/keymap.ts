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

/** Global keyboard shortcuts; ignored while typing in an input field. */
export class Keymap {
  private readonly shortcuts = new Map<string, Shortcut>();

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
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
