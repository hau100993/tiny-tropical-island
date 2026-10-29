import { button, el } from './components';
import { vi } from './strings.vi';
import { safeLocalStorage } from '../core/settings';
import { applyBackup, backupFileName, collectBackup, parseBackup } from '../core/backup';

/**
 * "Sao lưu" in the panel's settings: download everything the app keeps in localStorage as one
 * file, or load such a file back (then the page reloads, so no module writes its old state over
 * the imported one).
 */
export function backupControls(): HTMLElement {
  const box = el('div', 'backup');
  const row = el('div', 'button-row');
  const status = el('div', 'note');
  const exportBtn = button(vi.backup.export, () => {
    const store = safeLocalStorage();
    if (!store) return;
    const now = Date.now();
    const blob = new Blob([JSON.stringify(collectBackup(store, now), null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a');
    a.href = url;
    a.download = backupFileName(now);
    a.click();
    // After the download has started.
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, 'btn small');
  const input = el('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.hidden = true;
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    void file.text().then((text) => {
      const backup = parseBackup(text);
      const store = safeLocalStorage();
      if (!backup || !store) {
        status.textContent = vi.backup.bad;
        return;
      }
      if (!window.confirm(vi.backup.confirm)) return;
      applyBackup(store, backup);
      status.textContent = vi.backup.done;
      window.setTimeout(() => location.reload(), 400);
    });
  });
  const importBtn = button(vi.backup.import, () => input.click(), 'btn small');
  row.append(exportBtn, importBtn, input);
  box.append(row, el('div', 'note', vi.backup.note), status);
  return box;
}
