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
  check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  close: svg('<path d="m6 6 12 12"/><path d="M18 6 6 18"/>'),
  plus: svg('<path d="M12 5v14"/><path d="M5 12h14"/>'),
  pencil: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>'),
  power: svg('<path d="M12 3v8"/><path d="M6.4 7.4a8 8 0 1 0 11.2 0"/>'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  maximize: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  minimize: svg('<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>'),
  clock: svg('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5"/><path d="M9 2h6"/>'),
  // Accordion sections.
  scene: svg('<path d="m2 19 7-9 5 6 3-4 5 7z"/><circle cx="17" cy="6" r="2"/>'),
  music: svg('<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>'),
  time: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  /** The computer's clock: a monitor with clock hands. */
  realClock: svg('<rect x="2.5" y="3.5" width="19" height="13" rx="2"/><path d="M12 7v3l2 1.5M8 20.5h8M12 16.5v4"/>'),
  paw: svg('<circle cx="6" cy="10" r="2"/><circle cx="10" cy="5.5" r="2"/><circle cx="14" cy="5.5" r="2"/><circle cx="18" cy="10" r="2"/><path d="M12 12c-3 0-5.5 3.5-5.5 6a2.5 2.5 0 0 0 3.5 2.2c1.3-.5 2.7-.5 4 0a2.5 2.5 0 0 0 3.5-2.2c0-2.5-2.5-6-5.5-6z"/>'),
  eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  settings: svg('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
  keyboard: svg('<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>'),
  // Scene presets.
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  sunrise: svg('<path d="M17 18a5 5 0 0 0-10 0"/><path d="M2 18h20M5 22h14"/><path d="M12 8V2M4.2 10.2l1.4 1.4M19.8 10.2l-1.4 1.4M9 5l3-3 3 3"/>'),
  moon: svg('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/><path d="M17 3v2M16 4h2" />'),
  sunset: svg('<path d="M17 18a5 5 0 0 0-10 0"/><path d="M2 18h20M5 22h14"/><path d="M12 2v6M4.2 10.2l1.4 1.4M19.8 10.2l-1.4 1.4M9 5l3 3 3-3"/>'),
  storm: svg('<path d="M18 16a4 4 0 0 0-1-7.9A6 6 0 0 0 5.3 10 3.5 3.5 0 0 0 6 17"/><path d="m13 12-3 5h4l-3 5"/>'),
  rain: svg('<path d="M18 15a4 4 0 0 0-1-7.9A6 6 0 0 0 5.3 9 3.5 3.5 0 0 0 6 16"/><path d="M8 19l-1 2M12 18l-1 3M16 19l-1 2"/>'),
  flame: svg('<path d="M12 22c4 0 6.5-2.6 6.5-6.2 0-4.3-3.6-6.7-4.5-10.8-2.6 1.8-3.4 4.4-3 6.6-1.4-.7-2.2-2-2.4-3.4C6.6 10 5.5 12.6 5.5 15.8 5.5 19.4 8 22 12 22z"/><path d="M12 22c-1.6 0-2.7-1.2-2.7-2.8 0-1.8 1.4-2.6 2.7-4.4 1.3 1.8 2.7 2.6 2.7 4.4 0 1.6-1.1 2.8-2.7 2.8z"/>'),
  fog: svg('<path d="M4 9h16M2 13h20M5 17h14M8 21h8"/><path d="M8 5a4 4 0 0 1 8 0"/>'),
  aurora: svg('<path d="M3 18c2-6 4-9 6-9s2 6 4 6 3-7 8-11"/><path d="M3 14c2-4 3-5 4-5"/><path d="m18 18 .7 1.5L20 20l-1.3.5L18 22l-.7-1.5L16 20l1.3-.5z" fill="currentColor"/>'),
  snow: svg('<path d="M12 2v20M4 7l16 10M20 7 4 17"/><path d="m9 3 3 2 3-2M9 21l3-2 3 2"/>'),
  bookmark: svg('<path d="M6 3h12v18l-6-4-6 4z"/>'),
  // Views.
  globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
  walk: svg('<circle cx="13" cy="4" r="2"/><path d="m9 21 2.5-6 2.5 2v4M7 12l3-4 3 2 3 2M11.5 15 10 8"/>'),
  /** The panel's handle while it is out of sight. */
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
  // Activity card (ui/ActivityMenu.ts).
  kayak: svg('<path d="M2 14c3 3.5 17 3.5 20 0z"/><path d="m6 6 12 12"/><path d="m4.5 4.5 2.5 1.5-1 1zM19.5 19.5 17 18l1-1z" fill="currentColor"/>'),
  surf: svg('<path d="M6 18C8 12 13 6 19 4c.5 5-3.5 11-10 14.5z"/><path d="M8 15 17 6"/><path d="M2 21c2 0 2.5-1 4.5-1s2.5 1 4.5 1 2.5-1 4.5-1 2.5 1 4.5 1"/>'),
  swim: svg('<circle cx="17" cy="6" r="2"/><path d="m4 13 5-4 4 3 3-2"/><path d="M2 18c2 0 2.5-1.5 4.5-1.5S9 18 11 18s2.5-1.5 4.5-1.5S18 18 20 18"/>'),
  dive: svg('<path d="M12 3v9M8.5 8.5 12 12l3.5-3.5"/><path d="M2 17c2 0 2.5-1.5 4.5-1.5S9 17 11 17s2.5-1.5 4.5-1.5S18 17 20 17"/><path d="M5 21h14"/>'),
  shore: svg('<path d="M2 20h20"/><path d="M4 20c3-4 8-6 16-6"/><path d="M15 3v8M12 6l3-3 3 3"/>'),
  desk: svg('<rect x="3" y="4" width="18" height="11" rx="1.5"/><path d="M12 15v4M8 21h8"/>'),
  bath: svg('<path d="M3 12h18v2a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5z"/><path d="M6 12V5a2 2 0 0 1 4 0M7 19l-1 2M17 19l1 2"/>'),
  hammock: svg('<path d="M4 21V5M20 21V5M4 8l3 3h10l3-3M7 11c1 4 9 4 10 0"/><path d="M2 21h20"/>'),
  // On-screen controls (ui/TouchControls.ts).
  rise: svg('<path d="M12 21v-9M8.5 15.5 12 12l3.5 3.5"/><path d="M2 7c2 0 2.5-1.5 4.5-1.5S9 7 11 7s2.5-1.5 4.5-1.5S18 7 20 7"/><path d="M5 3h14"/>'),
  /** Leave what you're on or in (a door with an arrow out). */
  exit: svg('<path d="M14 4h5v16h-5"/><path d="M10 12H3M6.5 8.5 3 12l3.5 3.5"/>'),
};
