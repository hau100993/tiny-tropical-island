#!/usr/bin/env node
// Builds the UX report page from one run folder.
// Usage: node qa/report/build.cjs qa/runs/<date>
// Reads <run>/<persona>/{findings.json,summary.md}, <run>/groups.json (merge, labels, fixes,
// limits) and the persona files; writes <run>/report/index.html + report/shots/*.jpg.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..', '..');
const RUN = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !fs.existsSync(path.join(RUN, 'groups.json'))) {
  console.error('usage: node qa/report/build.cjs qa/runs/<date>   (needs groups.json in it)');
  process.exit(2);
}
const OUT = path.join(RUN, 'report');
const SHOTS = path.join(OUT, 'shots');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });

const groups = JSON.parse(fs.readFileSync(path.join(RUN, 'groups.json'), 'utf8'));
const personaDirs = fs.readdirSync(RUN).filter((d) => fs.existsSync(path.join(RUN, d, 'findings.json')));

// --- persona profile + summary ---
function section(md, re) {
  const m = md.match(re);
  return m ? m[1].trim() : '';
}
const personas = personaDirs.map((id) => {
  const prof = fs.readFileSync(path.join(REPO, 'qa', 'personas', `${id}.md`), 'utf8');
  const sum = fs.existsSync(path.join(RUN, id, 'summary.md')) ? fs.readFileSync(path.join(RUN, id, 'summary.md'), 'utf8') : '';
  const title = (prof.match(/^#\s+(.+)$/m) || [, id])[1];
  const device = (prof.match(/\*\*Thiết bị:\*\*\s*`([^`]+)`\s*[—-]\s*([^\n]+)/) || [, '', ''])
  const impression = section(sum, /##[^\n]*Cảm nhận[^\n]*\n+([\s\S]*?)(?=\n##|\n\*\*Điểm)/)
    .replace(/^"|"$/g, '')
    .replace(/\*\*/g, '');
  const scoreM = sum.match(/(\d{1,2})\s*\/\s*10/);
  const likes = section(sum, /##[^\n]*thích[^\n]*\n+([\s\S]*?)(?=\n##)/)
    .split('\n')
    .filter((l) => /^\s*-/.test(l))
    .map((l) => l.replace(/^\s*-\s*/, '').replace(/\*\*/g, '').replace(/`/g, ''))
    .slice(0, 5);
  const notDone = section(sum, /##[^\n]*(?:không làm được|chưa làm)[^\n]*\n+([\s\S]*?)(?=\n##|$)/i)
    .split('\n')
    .filter((l) => /^\s*-/.test(l))
    .map((l) => l.replace(/^\s*-\s*/, '').replace(/\*\*/g, '').replace(/`/g, ''))
    .slice(0, 4);
  // Some testers write the tasks as a table: | # | Nhiệm vụ | Kết quả |
  if (!notDone.length) {
    for (const row of sum.split('\n').filter((l) => /^\|/.test(l) && /không làm được/i.test(l))) {
      const cells = row.split('|').map((c) => c.trim()).filter(Boolean);
      notDone.push(cells.slice(1).join(': ').replace(/\*\*/g, ''));
    }
  }
  return { id, title, device: device[1], deviceLabel: device[2].trim(), impression, score: scoreM ? Number(scoreM[1]) : null, likes, notDone };
});

// --- findings + evidence ---
const groupOf = new Map();
for (const g of groups.groups) for (const m of g.members) groupOf.set(m, g.id);
let shotNo = 0;
const findings = [];
for (const id of personaDirs) {
  const list = JSON.parse(fs.readFileSync(path.join(RUN, id, 'findings.json'), 'utf8'));
  for (const f of list) {
    const shots = [];
    for (const e of (f.evidence || []).slice(0, 3)) {
      const src = path.join(REPO, e);
      if (!fs.existsSync(src)) continue;
      const name = `${String(++shotNo).padStart(3, '0')}-${f.id}.jpg`;
      fs.copyFileSync(src, path.join(SHOTS, name));
      shots.push({ src: `shots/${name}`, caption: path.basename(e) });
    }
    const v = groups.verified[f.id];
    findings.push({
      id: f.id,
      persona: id,
      title: f.title,
      severity: f.severity,
      type: f.type,
      rule: f.rule || '',
      device: f.device,
      where: f.where,
      steps: f.steps || [],
      expected: f.expected,
      actual: f.actual,
      quote: f.quote,
      confidence: f.confidence,
      repro: f.repro,
      group: groupOf.get(f.id) || '',
      label: v ? v.label : 'Chưa kiểm chứng lại',
      verifyNote: v ? v.note : '',
      shots,
    });
  }
}
// Verification screenshots (the verify/<id>/shots folder) for the replayed findings.
for (const f of findings) {
  const dir = path.join(RUN, 'verify', f.id, 'shots');
  if (!fs.existsSync(dir)) continue;
  const pick = fs.readdirSync(dir).filter((n) => !/fresh|Escape/.test(n)).slice(-2);
  for (const n of pick) {
    const name = `${String(++shotNo).padStart(3, '0')}-${f.id}-verify.jpg`;
    fs.copyFileSync(path.join(dir, n), path.join(SHOTS, name));
    f.shots.push({ src: `shots/${name}`, caption: `kiểm chứng: ${n}` });
  }
}

const data = { run: groups.run, personas, groups: groups.groups, findings, limits: groups.limits };
const json = JSON.stringify(data).replace(/</g, '\\u003c');
const tpl = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8');
fs.writeFileSync(path.join(OUT, 'index.html'), tpl.replace('/*__DATA__*/null', json));
const bytes = fs.readdirSync(SHOTS).reduce((s, n) => s + fs.statSync(path.join(SHOTS, n)).size, 0);
console.log(`report: ${path.relative(REPO, OUT)}  findings=${findings.length}  shots=${shotNo} (${(bytes / 1e6).toFixed(1)} MB)`);
