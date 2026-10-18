/** Inline SVG icons (no asset files). `currentColor` follows the text color. */
const svg = (body: string): string =>
  `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const speaker = '<path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor" stroke="none"/>';

export const icons = {
  speaker: svg(`${speaker}<path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>`),
  speakerOff: svg(`${speaker}<path d="m16 9 6 6"/><path d="m22 9-6 6"/>`),
  chevronRight: svg('<path d="m9 6 6 6-6 6"/>'),
  chevronLeft: svg('<path d="m15 6-6 6 6 6"/>'),
  play: svg('<path d="M7 5v14l12-7z" fill="currentColor" stroke="none"/>'),
  pause: svg('<path d="M8 5v14"/><path d="M16 5v14"/>'),
  skip: svg('<path d="M6 5v14l9-7z" fill="currentColor" stroke="none"/><path d="M18 5v14"/>'),
  reset: svg('<path d="M4 12a8 8 0 1 0 2.5-5.8"/><path d="M4 4v4h4"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>'),
  close: svg('<path d="m6 6 12 12"/><path d="M18 6 6 18"/>'),
};
