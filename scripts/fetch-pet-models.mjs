// Downloads the Thú Cưng models chosen on Poly Pizza into src/assets/creatures/pets/
// as <species>-<l1|l2|shiny>.glb, and prints each one's licence as the page states it.
//
//   node scripts/fetch-pet-models.mjs          (skips files already there)
//   node scripts/fetch-pet-models.mjs --force  (downloads them again)
//
// The list is MODEL_SOURCES in src/pets/species.ts (kept in step by hand below). A model page
// holds a link to its .glb on static.poly.pizza; if a page has none (the site changed), the
// script says so: download that one by hand ("Download" → glTF) and save it under the name shown.
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCES = {
  deer: { l1: 'T6Cs7tmMHJ', l2: 'tQdzbZ1Cmw' },
  na: { l1: 'x9x0viZs8V' },
  frog: { l1: '9Z2V8fpazF', l2: '0D54W8yfrA', shiny: '37wofOCOzG' },
  tiger: { l1: '2f54vbV0In' },
  bee: { l1: '42djT5zJnx' },
  cloudDragon: { l1: '54QyRcsogk', l2: 'Mo2ky6vkf8' },
  kind7: { l1: '7V4gaDMQV8', l2: 'ypEYhCImAB' },
  kind8: { l1: 'j4rVPvxyLg' },
  spider: { l1: 'yRYJiAJyiM' },
  kimquy: { l1: '2LCcq8vhqJ3' },
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'src', 'assets', 'creatures', 'pets');
const force = process.argv.includes('--force');

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

await mkdir(out, { recursive: true });
const report = [];
for (const [species, variants] of Object.entries(SOURCES)) {
  for (const [variant, id] of Object.entries(variants)) {
    const file = join(out, `${species}-${variant}.glb`);
    const page = `https://poly.pizza/m/${id}`;
    if (!force && (await exists(file))) {
      report.push(`=  ${species}-${variant}.glb (already there)`);
      continue;
    }
    try {
      const html = await (await fetch(page)).text();
      const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? '?';
      const licence = /(CC0|CC-BY[^"<\s]*|Public Domain|Creative Commons Attribution)/i.exec(html)?.[1] ?? 'not found: check the page';
      const glb = /https:\/\/static\.poly\.pizza\/[\w-]+\.glb/.exec(html)?.[0];
      if (!glb) {
        report.push(`!  ${species}-${variant}.glb: no .glb link on ${page} (${title}). Download it by hand.`);
        continue;
      }
      const res = await fetch(glb);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      await writeFile(file, bytes);
      report.push(`✓  ${species}-${variant}.glb  ${(bytes.length / 1024).toFixed(0)} KB  "${title}"  licence: ${licence}`);
    } catch (err) {
      report.push(`!  ${species}-${variant}.glb: ${page}: ${err.message}`);
    }
  }
}
console.log(report.join('\n'));
console.log('\nKeep only CC0 (or note CC-BY credits in README "Credits and licenses").');
