import { describe, expect, it } from 'vitest';
import { ARM_GUARD_MS, isConfirmClick } from '../src/ui/armConfirm';

describe('isConfirmClick', () => {
  it('ignores the second click of a double-click', () => {
    expect(isConfirmClick(1000, 1000 + 120)).toBe(false);
  });

  it('confirms a deliberate second click', () => {
    expect(isConfirmClick(1000, 1000 + ARM_GUARD_MS)).toBe(true);
    expect(isConfirmClick(1000, 1000 + 2000)).toBe(true);
  });

  it('never confirms a button that is not armed', () => {
    expect(isConfirmClick(0, 5000)).toBe(false);
  });
});
