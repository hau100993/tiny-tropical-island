/** Inline SVG icons (no asset files). `currentColor` follows the text color. */
const svg = (body: string): string =>
  `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const speaker = '<path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor" stroke="none"/>';

export const icons = {
  speaker: svg(`${speaker}<path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>`),
  speakerOff: svg(`${speaker}<path d="m16 9 6 6"/><path d="m22 9-6 6"/>`),
  chevronRight: svg('<path d="m9 6 6 6-6 6"/>'),
  chevronLeft: svg('<path d="m15 6-6 6 6 6"/>'),
};
