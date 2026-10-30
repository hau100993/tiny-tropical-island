import type { EggTier, SpeciesId } from '../pets/species';

/**
 * Painted eggs for the Thú Cưng camp, as inline SVG strings: Easter-egg style (a pastel shell,
 * then bands, dots or zigzags clipped to the shell), one pattern per species that hatches from
 * eggs, and a plain "mystery" one per tier for the shop. Drawn in code, no image files.
 */

/** The shell in a 40 × 50 box: narrower at the top. */
const SHELL = 'M20 2C31 2 37 19 37 31C37 42 29.5 48 20 48C10.5 48 3 42 3 31C3 19 9 2 20 2Z';

interface Look {
  base: string;
  /** Shell outline (a darker shade of the base). */
  edge: string;
  /** SVG drawn over the base, inside the shell. */
  art: string;
}

/** Dots at the given (x, y) pairs, all of radius r. */
function dots(pts: ReadonlyArray<readonly [number, number]>, r: number, fill: string): string {
  return pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`).join('');
}

/** A horizontal zigzag band across the shell, at height y. */
function zigzag(y: number, h: number, stroke: string, width = 2.4): string {
  let d = `M0 ${y}`;
  for (let x = 0; x <= 40; x += 5) d += ` L${x + 2.5} ${y - h} L${x + 5} ${y}`;
  return `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round"/>`;
}

/** A horizontal wave across the shell, at height y. */
function wave(y: number, h: number, stroke: string, width = 2.2): string {
  let d = `M-2 ${y}`;
  for (let x = -2; x < 42; x += 8) d += ` q2 ${-h} 4 0 t4 0`;
  return `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round"/>`;
}

/** A small four-point star (sparkle) centred at (x, y). */
function star(x: number, y: number, r: number, fill: string): string {
  const k = r * 0.3;
  return `<path d="M${x} ${y - r}L${x + k} ${y - k}L${x + r} ${y}L${x + k} ${y + k}L${x} ${y + r}L${x - k} ${y + k}L${x - r} ${y}L${x - k} ${y - k}Z" fill="${fill}"/>`;
}

/** One flat-top hexagon (a shell plate) centred at (x, y). */
function hex(x: number, y: number, r: number): string {
  const p: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    p.push(`${(x + r * Math.cos(a)).toFixed(1)},${(y + r * Math.sin(a)).toFixed(1)}`);
  }
  return `<polygon points="${p.join(' ')}"/>`;
}

const SPECIES_LOOKS: Readonly<Partial<Record<SpeciesId, Look>>> = {
  // Fawn: warm gold with white spots.
  deer: {
    base: '#f0bd63',
    edge: '#b98431',
    art:
      `<rect x="0" y="38" width="40" height="12" fill="#fff3d6"/>` +
      dots([[13, 14], [24, 11], [9, 25], [20, 22], [30, 20], [15, 33], [27, 31], [33, 28]], 2.3, '#fff8e8'),
  },
  // Custard apple (na): green with rows of scales.
  na: {
    base: '#a6d67f',
    edge: '#5f9a3e',
    art: [8, 15, 22, 29, 36, 43]
      .map((y, row) => {
        let d = '';
        for (let x = row % 2 ? -3 : 1; x < 42; x += 8) d += `M${x} ${y}q4 5 8 0`;
        return `<path d="${d}" fill="none" stroke="#6aa847" stroke-width="1.6" stroke-linecap="round"/>`;
      })
      .join(''),
  },
  // Frog: leaf green, a pond band with lily pads.
  frog: {
    base: '#86d46f',
    edge: '#4c9a3a',
    art:
      `<rect x="0" y="26" width="40" height="11" fill="#8fd8e8"/>` +
      wave(26, 2.5, '#ffffff', 1.8) +
      wave(37, 2.5, '#ffffff', 1.8) +
      dots([[10, 31], [22, 32], [32, 30]], 2.6, '#3f9a3a') +
      dots([[14, 13], [26, 16], [19, 8]], 1.8, '#c8f0a8'),
  },
  // Tiger: orange with dark stripes from both sides.
  tiger: {
    base: '#f8a53e',
    edge: '#c06a12',
    art:
      ['M0 12l14 3-14 3z', 'M40 18l-15 3 15 3z', 'M0 26l16 3-16 3z', 'M40 33l-14 3 14 3z', 'M0 40l12 2.5-12 2.5z', 'M40 9l-11 2.5 11 2.5z']
        .map((d) => `<path d="${d}" fill="#4a2d14"/>`)
        .join('') + `<rect x="0" y="44" width="40" height="6" fill="#fff1dc"/>`,
  },
  // Bee: yellow with brown bands.
  bee: {
    base: '#ffd84d',
    edge: '#c79a12',
    art:
      [14, 25, 36].map((y) => `<rect x="0" y="${y}" width="40" height="5" fill="#6b4a1e"/>`).join('') +
      dots([[12, 8], [20, 6], [28, 8]], 1.4, '#fff6c8'),
  },
  // Cloud dragon: lavender sky, a cloud band and stars.
  cloudDragon: {
    base: '#b9c2ff',
    edge: '#7380d6',
    art:
      `<path d="M-2 34c3-6 8-6 10-2c2-5 9-5 11 0c2-4 8-4 10 0c2-4 8-3 9 2v20H-2z" fill="#ffffff"/>` +
      star(14, 13, 3.4, '#fff4a8') +
      star(27, 19, 2.4, '#fff4a8') +
      star(20, 7, 1.8, '#ffffff'),
  },
  // Sea horse: coral with white zigzags and bubbles.
  seahorse: {
    base: '#ff9c8c',
    edge: '#d0594a',
    art:
      zigzag(20, 4, '#ffffff') +
      zigzag(33, 4, '#2fb8b0') +
      dots([[12, 10], [27, 12], [20, 41], [30, 40]], 1.6, '#ffe2dc'),
  },
  // Fire fox: red-orange, a band of flames.
  kind8: {
    base: '#ff7b52',
    edge: '#c2421e',
    art:
      `<path d="M-2 50V36l4-8 4 6 4-10 4 9 4-11 4 10 4-9 4 9 4-8 4 8v18z" fill="#ffd34d"/>` +
      `<path d="M-2 50V42l4-5 4 4 4-6 4 5 4-7 4 6 4-5 4 5 4-5 4 5v9z" fill="#ffefb0"/>` +
      dots([[14, 12], [25, 10]], 1.6, '#ffd34d'),
  },
  // Spider: purple with a web from the top.
  spider: {
    base: '#8b66c4',
    edge: '#55368a',
    art:
      `<g fill="none" stroke="#e0d2ff" stroke-width="1.1">` +
      [-60, -30, 0, 30, 60].map((a) => `<path d="M20 2L${(20 + 60 * Math.sin((a * Math.PI) / 180)).toFixed(1)} ${(2 + 60 * Math.cos((a * Math.PI) / 180)).toFixed(1)}"/>`).join('') +
      [12, 22, 32].map((r) => `<path d="M${20 - r} ${2 + r * 0.95}Q20 ${2 + r * 1.25} ${20 + r} ${2 + r * 0.95}"/>`).join('') +
      `</g>` +
      `<circle cx="27" cy="36" r="3" fill="#ff9a3c"/><path d="M27 33v-2" stroke="#3c7a2a" stroke-width="1.2"/>`,
  },
  // Kim Quy (the legend): gold with a jade shell pattern and sparkles.
  kimquy: {
    base: '#f3c94e',
    edge: '#a87d12',
    art:
      `<g fill="#f8dc80" stroke="#2f8f6a" stroke-width="1.4">` +
      [[13, 20], [27, 20], [20, 28], [6, 28], [34, 28], [13, 36], [27, 36], [20, 12]].map(([x, y]) => hex(x, y, 4.6)).join('') +
      `</g>` +
      star(10, 10, 2.6, '#ffffff') +
      star(31, 9, 1.8, '#ffffff'),
  },
};

/** The shop's eggs: nothing to hint at the species, richer with the tier. */
const TIER_LOOKS: Readonly<Record<EggTier, Look>> = {
  2: {
    base: '#f4e7c9',
    edge: '#bfa676',
    art: `<rect x="0" y="23" width="40" height="5" fill="#9fd8cf"/>` + dots([[12, 13], [22, 10], [28, 16], [14, 37], [25, 39]], 1.5, '#e2b98a'),
  },
  5: {
    base: '#a9dcf6',
    edge: '#5d9cc4',
    art: `<rect x="0" y="20" width="40" height="11" fill="#ffffff" opacity="0.85"/>` + zigzag(25.5, 3.5, '#ff9fb2', 2) + dots([[13, 11], [26, 12], [20, 40]], 1.6, '#ffffff'),
  },
  10: {
    base: '#8f7ad8',
    edge: '#5b45a8',
    art:
      `<rect x="0" y="22" width="40" height="7" fill="#f6cf55"/>` +
      zigzag(36, 3, '#f6cf55', 1.8) +
      star(14, 12, 3, '#fff3b0') +
      star(27, 15, 2, '#fff3b0') +
      star(21, 42, 2, '#fff3b0'),
  },
};

/** Grey shell for a species without a pattern (never expected; keeps the type total). */
const PLAIN: Look = { base: '#e8e2d6', edge: '#a89f8c', art: '' };

let clipCount = 0;

function draw(look: Look, cracked: boolean): string {
  const id = `egg-clip-${++clipCount}`;
  const crack = cracked
    ? `<path d="M5 24l5 3 4-4 4 5 4-4 4 4 4-3 5 3" fill="none" stroke="#5a4630" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>`
    : '';
  return (
    `<svg class="egg-art" viewBox="0 0 40 50" aria-hidden="true">` +
    `<defs><clipPath id="${id}"><path d="${SHELL}"/></clipPath></defs>` +
    `<path d="${SHELL}" fill="${look.base}"/>` +
    `<g clip-path="url(#${id})">${look.art}${crack}</g>` +
    // Gloss on the upper left, then the outline.
    `<ellipse cx="13" cy="15" rx="3.2" ry="6" transform="rotate(20 13 15)" fill="#ffffff" opacity="0.45"/>` +
    `<path d="${SHELL}" fill="none" stroke="${look.edge}" stroke-width="1.5"/>` +
    `</svg>`
  );
}

/** The egg of a species (what it will hatch into); cracked when it is ready to hatch. */
export function speciesEgg(species: SpeciesId, cracked = false): string {
  return draw(SPECIES_LOOKS[species] ?? PLAIN, cracked);
}

/** A shop egg of a tier. */
export function tierEgg(tier: EggTier): string {
  return draw(TIER_LOOKS[tier], false);
}
