/**
 * Events that browsers accept as the user gesture that may start audio ("activation-triggering"
 * in the HTML spec). A touch `pointerdown` is NOT one of them: on phones the gesture only
 * counts on `pointerup` / `touchend` (iOS Safari and Chrome Android alike). `pointerdown`
 * stays in the list because a mouse press does count, and it lets desktop start a little sooner.
 */
export const GESTURE_EVENTS = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] as const;

/**
 * Calls `fn` on every activation-triggering event (capture phase, so a handler that stops
 * propagation can't swallow it). Returns a function that removes the listeners.
 */
export function onUserGesture(fn: () => void): () => void {
  const opts: AddEventListenerOptions = { capture: true, passive: true };
  for (const type of GESTURE_EVENTS) window.addEventListener(type, fn, opts);
  return () => {
    for (const type of GESTURE_EVENTS) window.removeEventListener(type, fn, opts);
  };
}

/** Like `onUserGesture`, but only for the next gesture. */
export function onNextUserGesture(fn: () => void): void {
  const off = onUserGesture(() => {
    off();
    fn();
  });
}

/**
 * iOS Safari routes Web Audio through the "ambient" session by default, so the ringer/silent
 * switch mutes it. "playback" makes it behave like a media player (Safari 16.4+; other browsers
 * don't have `navigator.audioSession` and ignore this).
 */
export function preferPlaybackAudioSession(): void {
  // `audioSession` is not in TypeScript's DOM lib yet; this is its minimal shape.
  const nav = navigator as Navigator & { audioSession?: { type: string } };
  if (nav.audioSession) {
    try {
      nav.audioSession.type = 'playback';
    } catch {
      // Unsupported value on this version: keep the default session.
    }
  }
}
