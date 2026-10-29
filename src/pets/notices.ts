import { el, button } from '../ui/components';
import { vi } from '../ui/strings.vi';
import { readStored, writeStored } from '../core/storage';
import { downloadBackup } from '../ui/backupControls';
import type { Roster } from './roster';
import type { DriveSync } from './DriveSync';

/** When the last backup was downloaded (ms), and until when the reminder sleeps. */
export const BACKUP_AT_KEY = 'tsw.backupAt';
const SNOOZE_KEY = 'tsw.backupSnooze';
const WEEK = 7 * 86_400_000;

export interface PetNotices {
  /** Rows for the top of the camp, or null. */
  element(roster: Roster): HTMLElement | null;
}

/** Something worth keeping: a pet fed, an egg, a new pet. */
function hasProgress(r: Roster): boolean {
  return r.pets.some((p) => p.exp > 0 || p.origin !== 'original') || r.eggs.length > 0;
}

function num(key: string): number {
  const v = Number(readStored(key));
  return Number.isFinite(v) ? v : 0;
}

/**
 * The camp's rows on top: the Drive sync (status, or its invitation at milestones) and the
 * weekly reminder to download a backup (once there is progress and while Drive is off; "Để
 * sau" snoozes it a week).
 */
export function petNotices(drive: DriveSync): PetNotices {
  const backupReminder = (r: Roster): HTMLElement | null => {
    const now = Date.now();
    if (drive.on || !hasProgress(r) || now - num(BACKUP_AT_KEY) < WEEK || now < num(SNOOZE_KEY)) return null;
    const box = el('div', 'camp-notice');
    box.append(el('div', '', vi.pets.reminder));
    const row = el('div', 'button-row');
    row.append(
      button(vi.pets.reminderBtn, () => {
        downloadBackup();
        box.remove();
      }, 'btn small primary'),
      button(vi.pets.later, () => {
        writeStored(SNOOZE_KEY, now + WEEK);
        box.remove();
      }, 'btn small'),
    );
    box.append(row);
    return box;
  };
  return {
    element(r) {
      const sync = drive.element(r);
      // One ask at a time: while Drive is being offered, no backup reminder.
      const inviting = sync?.classList.contains('camp-invite') ?? false;
      const parts = [sync, inviting ? null : backupReminder(r)].filter((x): x is HTMLElement => x !== null);
      if (parts.length === 0) return null;
      const box = el('div', 'camp-notices');
      box.append(...parts);
      return box;
    },
  };
}
