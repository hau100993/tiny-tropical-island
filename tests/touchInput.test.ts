import { afterEach, describe, expect, it } from 'vitest';
import { RUN_PUSH, moveInput, readMove, touchInput } from '../src/controls/touchInput';

afterEach(() => {
  touchInput.x = 0;
  touchInput.y = 0;
});

describe('readMove: keys and the on-screen joystick', () => {
  it('reads WASD and Shift at full amount', () => {
    const m = readMove(new Set(['KeyW', 'KeyA', 'ShiftLeft']), moveInput());
    expect(m).toEqual({ fwd: 1, side: -1, amount: 1, run: true });
  });

  it('a half-pushed joystick walks at part speed, without running', () => {
    touchInput.y = 0.45;
    const m = readMove(new Set(), moveInput());
    expect(m.fwd).toBeCloseTo(0.45);
    expect(m.amount).toBeCloseTo(0.45 / RUN_PUSH);
    expect(m.run).toBe(false);
  });

  it('pushed all the way it runs', () => {
    touchInput.x = 0.95;
    const m = readMove(new Set(), moveInput());
    expect(m.amount).toBe(1);
    expect(m.run).toBe(true);
  });

  it('a held movement key wins over the joystick', () => {
    touchInput.x = 1;
    const m = readMove(new Set(['KeyS']), moveInput());
    expect(m.fwd).toBe(-1);
    expect(m.side).toBe(0);
  });

  it('nothing held: no movement', () => {
    expect(readMove(new Set(['ShiftLeft']), moveInput())).toEqual({ fwd: 0, side: 0, amount: 0, run: true });
  });
});
