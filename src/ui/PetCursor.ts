/** Paw print (24 × 24, drawn at 28 px): four toes and the pad, white with a brown outline. */
const PAW =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28">' +
  '<g fill="#fff" stroke="#5a3a2a" stroke-width="1.4">' +
  '<ellipse cx="5.2" cy="10.2" rx="2.3" ry="2.8" transform="rotate(-20 5.2 10.2)"/>' +
  '<ellipse cx="9.3" cy="5.6" rx="2.4" ry="3"/>' +
  '<ellipse cx="14.7" cy="5.6" rx="2.4" ry="3"/>' +
  '<ellipse cx="18.8" cy="10.2" rx="2.3" ry="2.8" transform="rotate(20 18.8 10.2)"/>' +
  '<path d="M12 11.2c-3.6 0-6.6 3.5-6.6 6.4 0 2 1.6 3.2 3.4 3.2 1.3 0 2.1-.7 3.2-.7s1.9.7 3.2.7c1.8 0 3.4-1.2 3.4-3.2 0-2.9-3-6.4-6.6-6.4z"/>' +
  '</g></svg>';

/**
 * Shows that Mochi can be petted, without any text: over the dog (and while stroking it) the
 * mouse cursor turns into a paw (`--paw-cursor`, see styles.css).
 */
export class PetCursor {
  private state: 'none' | 'hover' | 'grab' = 'none';

  constructor() {
    // A data URL, hotspot on the pad.
    document.documentElement.style.setProperty('--paw-cursor', `url("data:image/svg+xml,${encodeURIComponent(PAW)}") 14 16`);
  }

  set(state: 'none' | 'hover' | 'grab'): void {
    if (state === this.state) return;
    this.state = state;
    document.body.classList.toggle('pet-hover', state === 'hover');
    document.body.classList.toggle('pet-grab', state === 'grab');
  }
}
