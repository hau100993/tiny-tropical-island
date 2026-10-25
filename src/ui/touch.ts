/**
 * Touch screens (phones, tablets without a mouse): `pointer: coarse` means the main pointer is
 * a finger. Screen width isn't used: a tablet with a mouse should keep the PC layout.
 */
const COARSE = window.matchMedia('(pointer: coarse)');

/** True while the main pointer is a finger. */
export function isTouch(): boolean {
  return COARSE.matches;
}

/** Keeps `body.touch` in step with the device (styles: the touch layout). */
export function watchTouch(): void {
  const sync = (): void => {
    document.body.classList.toggle('touch', COARSE.matches);
  };
  sync();
  COARSE.addEventListener('change', sync);
}
