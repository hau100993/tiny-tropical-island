#!/usr/bin/env node
// One long-lived browser for ONE persona, driven over HTTP by act.cjs.
// Usage: node qa/browser.cjs --device pc-1080 --port 9301 --out qa/runs/<date>/<name> [--url http://localhost:5199/]
//
// Uses the Edge already installed on Windows (channel 'msedge'), so no browser download.
// Every command is logged to <out>/actions.jsonl; screenshots go to <out>/shots/.
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');

// ---------- arguments ----------
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const DEVICE_NAME = opt('device', 'pc-1080');
const PORT = Number(opt('port', '9301'));
const OUT = path.resolve(opt('out', path.join(__dirname, 'runs', 'scratch')));
const URL_ARG = opt('url', '');
const APP_PORT = 5199;
const APP_URL = URL_ARG || `http://localhost:${APP_PORT}/`;
const REPO = path.resolve(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures');

// ---------- devices ----------
/** @type {Record<string, {viewport:{width:number,height:number}, deviceScaleFactor:number, isMobile:boolean, hasTouch:boolean, userAgent?:string, label:string}>} */
const DEVICES = {
  'laptop-1366': { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false, label: 'Laptop 1366×768, chuột' },
  'pc-1080': { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false, label: 'PC 1920×1080, chuột + bàn phím' },
  'pc-1440': { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, isMobile: false, hasTouch: false, label: 'PC 1440×900 (scale 150%), chuột + bàn phím' },
  'tablet-landscape': {
    viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
    label: 'Samsung Galaxy Tab ngang 1280×800, cảm ứng',
  },
  'phone-portrait': {
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36',
    label: 'Điện thoại dọc 390×844, cảm ứng',
  },
};
const DEVICE = DEVICES[DEVICE_NAME];
if (!DEVICE) {
  console.error(`Unknown device "${DEVICE_NAME}". Known: ${Object.keys(DEVICES).join(', ')}`);
  process.exit(2);
}

// ---------- output ----------
const SHOTS = path.join(OUT, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const ACTIONS = path.join(OUT, 'actions.jsonl');
const CONSOLE = path.join(OUT, 'console.jsonl');
const log = (file, obj) => fs.appendFileSync(file, JSON.stringify({ t: new Date().toISOString(), ...obj }) + '\n');

// ---------- noise filter ----------
/**
 * Decide whether a console error / failed request is known noise that should NOT be reported.
 * kind: 'console' | 'pageerror' | 'http' | 'requestfailed'; text: the message or URL.
 * Requests we block on purpose are already handled before this is called.
 */
function isNoise(kind, text) {
  // TODO(user): refine. Too broad hides real bugs; too narrow floods the report.
  // Candidates seen with headless Edge: GPU stall / ReadPixels performance warnings,
  // "[.WebGL-...]" driver messages, favicon 404, Vite HMR websocket messages.
  if (/GPU stall due to ReadPixels|\[\.WebGL-/.test(text)) return true;
  if (kind === 'http' && /favicon\.ico/.test(text)) return true;
  if (/\[vite\]/.test(text)) return true;
  // The browser cancels range requests of a streaming <audio> on its own (seek, source switch).
  if (kind === 'requestfailed' && /\/audio\/.*net::ERR_ABORTED/.test(text)) return true;
  return false;
}

// ---------- state ----------
let browser = null;
let context = null;
let page = null;
let cdp = null;
let shotNo = 0;
let devServer = null;
let choosersSeen = 0;
/** How native confirm/alert dialogs are answered: 'accept' (OK) or 'dismiss' (Hủy). */
let dialogPolicy = 'accept';
/** @type {Array<object>} dialogs shown since the last reply */ let dialogsPending = [];
/** @type {Array<object>} files the page downloaded */ const downloads = [];
/** @type {string|null} file to hand to the next file chooser */ let pendingUpload = null;
/** @type {Array<object>} */ let errors = [];
let errorsSeen = 0;
/** @type {Set<string>} */ const blocked = new Set();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Accent-free, lower-case form of a label, so "Cảnh" matches "canh" and "Đi bộ" matches "di bo".
function norm(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

async function reachable(url) {
  try {
    const r = await fetch(url, { method: 'GET' });
    return r.ok || r.status < 500;
  } catch {
    return false;
  }
}

async function ensureApp() {
  if (await reachable(APP_URL)) return;
  if (URL_ARG) throw new Error(`URL not reachable: ${APP_URL}`);
  devServer = spawn('npx', ['vite', '--port', String(APP_PORT), '--strictPort', '--open', 'false'], {
    cwd: REPO.replace(/^[a-z]:/, (d) => d.toUpperCase()),
    shell: true,
    stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    if (await reachable(APP_URL)) return;
  }
  throw new Error('Dev server did not start on port ' + APP_PORT);
}

function isLocal(u) {
  if (u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('about:')) return true;
  try {
    const h = new URL(u).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
  } catch {
    return false;
  }
}

function pushError(e) {
  if (isNoise(e.kind, e.text)) return;
  errors.push(e);
  log(CONSOLE, e);
}

async function newContext() {
  if (context) await context.close().catch(() => {});
  errors = [];
  errorsSeen = 0;
  context = await browser.newContext({
    viewport: DEVICE.viewport,
    deviceScaleFactor: DEVICE.deviceScaleFactor,
    isMobile: DEVICE.isMobile,
    hasTouch: DEVICE.hasTouch,
    userAgent: DEVICE.userAgent,
    acceptDownloads: true,
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
  });
  // Offline app: anything that leaves this machine is blocked (Google sign-in, Drive API, YouTube...).
  await context.route('**/*', (route) => {
    const u = route.request().url();
    if (isLocal(u)) return route.continue();
    let host = u;
    try { host = new URL(u).host; } catch { /* keep raw */ }
    if (!blocked.has(host)) log(CONSOLE, { kind: 'blocked', text: u });
    blocked.add(host);
    return route.abort('blockedbyclient');
  });
  page = await context.newPage();
  page.on('pageerror', (err) => {
    const stack = String(err.stack || '').split('\n').slice(0, 4).join('\n');
    pushError({ kind: 'pageerror', text: err.message, stack });
  });
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const loc = msg.location();
    pushError({ kind: 'console', text: msg.text(), stack: loc && loc.url ? `${loc.url}:${loc.lineNumber}` : '' });
  });
  page.on('response', (res) => {
    if (res.status() >= 400) pushError({ kind: 'http', text: `${res.status()} ${res.url()}` });
  });
  page.on('requestfailed', (req) => {
    const f = req.failure();
    if (f && /BLOCKED_BY_CLIENT|blockedbyclient/i.test(f.errorText)) return;
    if (!isLocal(req.url())) return;
    pushError({ kind: 'requestfailed', text: `${req.url()} ${f ? f.errorText : ''}` });
  });
  page.on('dialog', async (d) => {
    // A native dialog blocks the page, so answer it at once by the current policy (`dialogs`
    // command), and hand it back in the reply of the command that caused it so the tester SEES it.
    const answer = dialogPolicy;
    dialogsPending.push({ type: d.type(), message: d.message(), answered: answer });
    log(CONSOLE, { kind: 'dialog', text: `${d.type()}: ${d.message()} → ${answer}` });
    if (answer === 'dismiss') await d.dismiss().catch(() => {});
    else await d.accept().catch(() => {});
  });
  // Headless has no download bar: save downloads next to the shots and log them, so a tester
  // can check that "Tải bản sao lưu" really produced a file.
  page.on('download', async (d) => {
    const dir = path.join(OUT, 'downloads');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, d.suggestedFilename());
    try {
      await d.saveAs(file);
      downloads.push({ name: d.suggestedFilename(), bytes: fs.statSync(file).size, path: path.relative(REPO, file).replace(/\\/g, '/') });
    } catch (e) {
      downloads.push({ name: d.suggestedFilename(), error: e.message });
    }
  });
  // One persistent handler: a chooser event that arrives late is still answered with the file.
  page.on('filechooser', async (fc) => {
    choosersSeen++;
    const f = pendingUpload;
    pendingUpload = null;
    if (f) await fc.setFiles(f).catch((e) => log(CONSOLE, { kind: 'tool', text: 'setFiles: ' + e.message }));
  });
  cdp = await context.newCDPSession(page);
  await page.goto(APP_URL, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { timeout: 30000 }).catch(() => {});
  await sleep(3500); // let the island build its first frames
}

async function shot(tag) {
  shotNo++;
  const name = `${String(shotNo).padStart(3, '0')}-${String(tag || 'shot').replace(/[^a-z0-9-]+/gi, '_').slice(0, 40)}.jpg`;
  const file = path.join(SHOTS, name);
  await page.screenshot({ path: file, type: 'jpeg', quality: 72, scale: 'css', timeout: 15000 });
  return path.relative(REPO, file).replace(/\\/g, '/');
}

// ---------- DOM inspection (runs in the page) ----------
async function inspect() {
  return page.evaluate(({ touch }) => {
    const out = [];
    const vw = innerWidth;
    const vh = innerHeight;
    const sel = 'button, a[href], input, select, textarea, summary, label, [role=button], [role=switch], [role=slider], [role=tab], [role=checkbox], [role=menuitem], [role=option], [contenteditable=true], [tabindex]:not([tabindex="-1"])';
    const seen = new Set();
    for (const el of document.querySelectorAll(sel)) {
      if (seen.has(el)) continue;
      seen.add(el);
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (r.right < 0 || r.bottom < 0 || r.left > vw || r.top > vh) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.05) continue;
      // Opacity of ancestors too (the panel fades to a faint handle).
      let op = 1;
      for (let p = el; p && p !== document.body; p = p.parentElement) op *= Number(getComputedStyle(p).opacity);
      if (op < 0.05) continue;
      const cx = Math.min(vw - 1, Math.max(0, r.left + r.width / 2));
      const cy = Math.min(vh - 1, Math.max(0, r.top + r.height / 2));
      const hit = document.elementFromPoint(cx, cy);
      const covered = !!hit && hit !== el && !el.contains(hit) && !hit.contains(el) && !(el.tagName === 'LABEL' && el.control === hit);
      const text = (el.innerText || '').trim().replace(/\s+/g, ' ');
      const aria = el.getAttribute('aria-label') || '';
      const title = el.getAttribute('title') || '';
      const ph = el.getAttribute('placeholder') || '';
      let value = '';
      if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') value = el.type === 'checkbox' ? String(el.checked) : String(el.value ?? '');
      const pressed = el.getAttribute('aria-pressed') || el.getAttribute('aria-checked') || el.getAttribute('aria-selected') || '';
      const fontPx = parseFloat(cs.fontSize);
      const flags = [];
      if (touch && (r.width < 44 || r.height < 44)) flags.push('target<44');
      if (!touch && (r.width < 24 || r.height < 24)) flags.push('target<24');
      if (text && fontPx < 12) flags.push('text<12');
      if (!text && !aria && !title && !(el.labels && el.labels.length) && el.tagName !== 'LABEL') flags.push('no-label');
      if (covered) flags.push('covered');
      if (op < 0.4) flags.push(`faint(${op.toFixed(2)})`);
      out.push({
        tag: el.tagName.toLowerCase() + (el.type && el.tagName === 'INPUT' ? `[${el.type}]` : '') + (el.getAttribute('role') ? `(${el.getAttribute('role')})` : ''),
        label: (text || aria || title || ph).slice(0, 80),
        hint: title && title !== text ? title.slice(0, 80) : undefined,
        value: value || undefined,
        state: pressed || (el.disabled ? 'disabled' : undefined),
        box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        font: Math.round(fontPx * 10) / 10,
        flags,
      });
    }
    // Visible text that is not inside a control (cards, hints, headings, toasts).
    const texts = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode()) && texts.length < 120) {
      const s = n.textContent.trim().replace(/\s+/g, ' ');
      if (!s) continue;
      const el = n.parentElement;
      if (!el || el.closest(sel)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      let op = 1;
      for (let p = el; p && p !== document.body; p = p.parentElement) op *= Number(getComputedStyle(p).opacity);
      if (op < 0.05) continue;
      const fontPx = parseFloat(cs.fontSize);
      texts.push({ text: s.slice(0, 140), box: [Math.round(r.left), Math.round(r.top)], font: Math.round(fontPx * 10) / 10, small: fontPx < 12 ? true : undefined });
    }
    return {
      viewport: [vw, vh],
      coarsePointer: matchMedia('(pointer: coarse)').matches,
      fullscreen: !!document.fullscreenElement,
      pointerLock: !!document.pointerLockElement,
      focused: document.activeElement && document.activeElement !== document.body ? (document.activeElement.getAttribute('aria-label') || document.activeElement.innerText || document.activeElement.tagName).slice(0, 60) : null,
      controls: out,
      texts,
    };
  }, { touch: DEVICE.hasTouch });
}

async function findControl(label, nth) {
  const want = norm(label);
  const ui = await inspect();
  const cands = ui.controls.map((c) => ({ c, l: norm(c.label), h: norm(c.hint || '') }));
  const tiers = [
    cands.filter((x) => x.l === want || x.h === want),
    cands.filter((x) => x.l.startsWith(want) || x.h.startsWith(want)),
    cands.filter((x) => x.l.includes(want) || x.h.includes(want)),
  ];
  // Also plain visible text (e.g. a card whose text is not inside a button).
  const textHits = ui.texts.filter((t) => norm(t.text) === want || norm(t.text).includes(want));
  for (const tier of tiers) {
    const visible = tier.filter((x) => !(x.c.flags || []).includes('covered'));
    const pick = (visible.length ? visible : tier)[nth || 0];
    if (pick) return { box: pick.c.box, label: pick.c.label, matches: tier.length, covered: (pick.c.flags || []).includes('covered') };
  }
  if (textHits[nth || 0]) {
    const t = textHits[nth || 0];
    // Find the element's centre via the DOM.
    const box = await page.evaluate(({ want, nth }) => {
      const f = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/\s+/g, ' ').trim();
      const hits = [];
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        if (f(n.textContent).includes(want) && n.parentElement) {
          const r = n.parentElement.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) hits.push([Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]);
        }
      }
      return hits[nth] || null;
    }, { want, nth: nth || 0 });
    if (box) return { box, label: t.text, matches: textHits.length, covered: false, textOnly: true };
  }
  return null;
}

// ---------- touch via CDP (page.touchscreen only does single taps) ----------
async function touch(type, points) {
  await cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map(([x, y], id) => ({ x, y, id, radiusX: 6, radiusY: 6, force: 1 })),
  });
}
async function swipe(x1, y1, x2, y2, ms = 300) {
  const steps = Math.max(6, Math.round(ms / 16));
  await touch('touchStart', [[x1, y1]]);
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    await touch('touchMove', [[x1 + (x2 - x1) * k, y1 + (y2 - y1) * k]]);
    await sleep(ms / steps);
  }
  await touch('touchEnd', []);
}
async function hold(x, y, ms = 800) {
  await touch('touchStart', [[x, y]]);
  await sleep(Math.max(0, ms - 250));
  // Capture what the finger is holding (e.g. "Nổi lên" while held), not only after release.
  const during = await shot('hold-during').catch(() => null);
  await sleep(Math.min(250, ms));
  await touch('touchEnd', []);
  return during;
}
async function pinch(cx, cy, scale = 2, ms = 400) {
  const d0 = 60;
  const d1 = d0 * scale;
  const steps = Math.max(8, Math.round(ms / 16));
  await touch('touchStart', [[cx - d0, cy], [cx + d0, cy]]);
  for (let i = 1; i <= steps; i++) {
    const d = d0 + (d1 - d0) * (i / steps);
    await touch('touchMove', [[cx - d, cy], [cx + d, cy]]);
    await sleep(ms / steps);
  }
  await touch('touchEnd', []);
}

async function tapAt(x, y) {
  if (DEVICE.hasTouch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

// ---------- commands ----------
const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
const AUTO_SHOT = new Set(['fresh', 'click', 'tap', 'swipe', 'hold', 'pinch', 'mouse', 'drag', 'wheel', 'type', 'press', 'upload', 'back', 'resize', 'reload', 'media']);

const COMMANDS = {
  async fresh() {
    await newContext();
    return { ok: true, device: DEVICE_NAME, label: DEVICE.label, url: APP_URL };
  },
  async reload() {
    await page.reload({ waitUntil: 'load' });
    await sleep(3000);
    return { ok: true };
  },
  async ui() {
    return inspect();
  },
  async shot(args) {
    return { ok: true, shot: await shot(args[0] || 'shot') };
  },
  async click(args) {
    // click <text> [#n]  — n is 1-based when several match
    let nth = 0;
    const last = args[args.length - 1];
    if (args.length > 1 && /^#\d+$/.test(last)) { nth = Number(last.slice(1)) - 1; args = args.slice(0, -1); }
    const label = args.join(' ');
    const hit = await findControl(label, nth);
    if (!hit) return { ok: false, error: `Không thấy nút/chữ "${label}" trên màn hình. Dùng "ui" hoặc "shot" để nhìn lại.` };
    const [x, y, w, h] = hit.box;
    const cx = Math.round(x + w / 2);
    const cy = Math.round(y + h / 2);
    await tapAt(cx, cy);
    await sleep(500);
    return { ok: true, clicked: hit.label, at: [cx, cy], matches: hit.matches, covered: hit.covered || undefined, textOnly: hit.textOnly };
  },
  async tap(args) {
    const [x, y] = [num(args[0]), num(args[1])];
    await tapAt(x, y);
    await sleep(400);
    return { ok: true, at: [x, y] };
  },
  async swipe(args) {
    const [x1, y1, x2, y2, ms] = args.map(Number);
    if (!DEVICE.hasTouch) return { ok: false, error: 'Máy này không có cảm ứng; dùng drag.' };
    await swipe(x1, y1, x2, y2, ms || 300);
    await sleep(300);
    return { ok: true };
  },
  async hold(args) {
    const [x, y, ms] = args.map(Number);
    if (!DEVICE.hasTouch) return { ok: false, error: 'Máy này không có cảm ứng; dùng mouse down/up.' };
    const during = await hold(x, y, ms || 800);
    await sleep(300);
    return { ok: true, shotDuring: during };
  },
  async pinch(args) {
    const [cx, cy, scale, ms] = args.map(Number);
    if (!DEVICE.hasTouch) return { ok: false, error: 'Máy này không có cảm ứng; dùng wheel.' };
    await pinch(cx, cy, scale || 2, ms || 400);
    await sleep(300);
    return { ok: true };
  },
  async mouse(args) {
    // mouse <x> <y> [move|click|dblclick|right|down|up]
    const [x, y] = [num(args[0]), num(args[1])];
    const act = args[2] || 'move';
    await page.mouse.move(x, y, { steps: 8 });
    if (act === 'click') await page.mouse.click(x, y);
    else if (act === 'dblclick') await page.mouse.dblclick(x, y);
    else if (act === 'right') await page.mouse.click(x, y, { button: 'right' });
    else if (act === 'down') await page.mouse.down();
    else if (act === 'up') await page.mouse.up();
    await sleep(400);
    return { ok: true, at: [x, y], act };
  },
  async drag(args) {
    // drag x1 y1 x2 y2 [left|right] [ms]
    const [x1, y1, x2, y2] = args.slice(0, 4).map(Number);
    const button = args[4] === 'right' ? 'right' : 'left';
    const ms = num(args[5], 500);
    if (DEVICE.hasTouch && button === 'left') {
      await swipe(x1, y1, x2, y2, ms);
    } else {
      await page.mouse.move(x1, y1);
      await page.mouse.down({ button });
      const steps = Math.max(8, Math.round(ms / 16));
      for (let i = 1; i <= steps; i++) {
        await page.mouse.move(x1 + ((x2 - x1) * i) / steps, y1 + ((y2 - y1) * i) / steps);
        await sleep(ms / steps);
      }
      await page.mouse.up({ button });
    }
    await sleep(400);
    return { ok: true };
  },
  async wheel(args) {
    // wheel x y dy [times]
    const [x, y, dy] = args.slice(0, 3).map(Number);
    const times = num(args[3], 1);
    await page.mouse.move(x, y);
    for (let i = 0; i < times; i++) { await page.mouse.wheel(0, dy); await sleep(80); }
    await sleep(400);
    return { ok: true };
  },
  async type(args) {
    // Typing with no text field focused would fire the app's one-key shortcuts (M mutes, 1 picks
    // a scene...). Refuse unless the last arg is --force (a deliberate "typing on the scene" test).
    const force = args[args.length - 1] === '--force';
    if (force) args = args.slice(0, -1);
    const editable = await page.evaluate(() => {
      const a = document.activeElement;
      return !!a && (a.isContentEditable || (a.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button', 'file'].includes(a.type)) || a.tagName === 'TEXTAREA');
    });
    if (!editable && !force) return { ok: false, error: 'Không có ô nhập nào đang được chọn: chữ gõ vào sẽ thành phím tắt. Bấm vào ô nhập trước (hoặc thêm --force nếu cố ý).' };
    await page.keyboard.type(args.join(' '), { delay: 25 });
    await sleep(300);
    return { ok: true, typed: args.join(' ').length + ' ký tự' };
  },
  async press(args) {
    // press <key> [holdMs] [times]   e.g. press H · press Shift+Space · press w 2000
    const key = args[0];
    const holdMs = num(args[1], 0);
    const times = num(args[2], 1);
    for (let i = 0; i < times; i++) {
      if (holdMs > 0) {
        const parts = key.split('+');
        for (const k of parts) await page.keyboard.down(k);
        await sleep(holdMs);
        for (const k of parts.reverse()) await page.keyboard.up(k);
      } else {
        await page.keyboard.press(key);
      }
      await sleep(times > 1 ? 60 : 0);
    }
    await sleep(500);
    return { ok: true, key, holdMs, times };
  },
  async upload(args) {
    // upload <fixture> [chữ trên nút mở chọn file]
    const file = path.join(FIXTURES, args[0] || '');
    if (!args[0] || !fs.existsSync(file)) return { ok: false, error: `Không có fixture "${args[0]}". Có: ${fs.readdirSync(FIXTURES).join(', ')}` };
    const label = args.slice(1).join(' ');
    if (label) {
      const hit = await findControl(label, 0);
      if (!hit) return { ok: false, error: `Không thấy nút "${label}".` };
      const [x, y, w, h] = hit.box;
      const before = choosersSeen;
      pendingUpload = file;
      await tapAt(Math.round(x + w / 2), Math.round(y + h / 2));
      for (let i = 0; i < 25 && choosersSeen === before; i++) await sleep(200);
      if (choosersSeen === before) {
        pendingUpload = null;
        return { ok: false, error: `Bấm "${hit.label}" nhưng không mở hộp chọn file.` };
      }
    } else {
      const input = await page.$('input[type=file]');
      if (!input) return { ok: false, error: 'Không có ô chọn file nào trên trang. Ghi tên nút: upload <file> <chữ trên nút>.' };
      await input.setInputFiles(file);
    }
    await sleep(1500);
    return { ok: true, file: args[0] };
  },
  async back() {
    // The app is one page: with no history, a real Back would leave the app. Say so instead of
    // landing on about:blank and losing the session.
    const depth = await page.evaluate(() => history.length);
    if (depth <= 1) return { ok: true, note: 'Không có trang trước trong app: trên máy thật, nút Quay lại sẽ rời khỏi app (không mô phỏng).' };
    await page.goBack({ waitUntil: 'load' }).catch(() => {});
    await sleep(1000);
    return { ok: true, url: page.url() };
  },
  async resize(args) {
    const [w, h] = args.map(Number);
    await page.setViewportSize({ width: w, height: h });
    await sleep(800);
    return { ok: true, viewport: [w, h] };
  },
  async wait(args) {
    const ms = Math.min(num(args[0], 1000), 60000);
    await sleep(ms);
    return { ok: true, waited: ms };
  },
  async media(args) {
    // media reduced-motion | no-motion | dark | light
    const a = args[0];
    if (a === 'reduced-motion') await page.emulateMedia({ reducedMotion: 'reduce' });
    else if (a === 'no-motion') await page.emulateMedia({ reducedMotion: 'no-preference' });
    else if (a === 'dark' || a === 'light') await page.emulateMedia({ colorScheme: a });
    else return { ok: false, error: 'media reduced-motion|no-motion|dark|light' };
    await sleep(600);
    return { ok: true, media: a };
  },
  async axe() {
    const src = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
    await page.evaluate(src);
    const res = await page.evaluate(async () => {
      // eslint-disable-next-line no-undef
      const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }, resultTypes: ['violations'] });
      return r.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        count: v.nodes.length,
        examples: v.nodes.slice(0, 3).map((n) => ({ target: n.target.join(' '), html: n.html.slice(0, 140), why: (n.failureSummary || '').split('\n').slice(0, 2).join(' ') })),
      }));
    });
    const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
    res.sort((a, b) => (order[a.impact] ?? 9) - (order[b.impact] ?? 9));
    return { ok: true, violations: res };
  },
  async errors() {
    const fresh = errors.slice(errorsSeen);
    errorsSeen = errors.length;
    return { ok: true, new: fresh, total: errors.length, blockedHosts: [...blocked], downloads };
  },
  async dialogs(args) {
    // dialogs accept|dismiss — how the NEXT native confirm/alert is answered
    if (args[0] !== 'accept' && args[0] !== 'dismiss') return { ok: false, error: 'dialogs accept|dismiss', current: dialogPolicy };
    dialogPolicy = args[0];
    return { ok: true, policy: dialogPolicy };
  },
  async perf(args) {
    const ms = Math.min(num(args[0], 2000), 10000);
    const fps = await page.evaluate((ms) => new Promise((res) => {
      let n = 0; const t0 = performance.now();
      const f = () => { n++; if (performance.now() - t0 < ms) requestAnimationFrame(f); else res(Math.round((n * 1000) / (performance.now() - t0))); };
      requestAnimationFrame(f);
    }), ms);
    return { ok: true, fps, note: 'Headless, nhiều trình duyệt cùng chạy: chỉ để so sánh tương đối, không phải FPS máy thật.' };
  },
  async eval(args) {
    // Only to CONFIRM what was seen, never to act for the user.
    const expr = args.join(' ');
    const value = await page.evaluate((e) => {
      // eslint-disable-next-line no-eval
      const v = (0, eval)(e);
      return v instanceof Promise ? v.then((x) => JSON.parse(JSON.stringify(x ?? null))) : JSON.parse(JSON.stringify(v ?? null));
    }, expr);
    return { ok: true, value };
  },
  async stop() {
    setTimeout(async () => {
      await browser?.close().catch(() => {});
      if (devServer) devServer.kill();
      process.exit(0);
    }, 100);
    return { ok: true, stopped: true };
  },
};

// ---------- HTTP server ----------
let busy = Promise.resolve();
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    busy = busy.then(async () => {
      let msg;
      try { msg = JSON.parse(body || '{}'); } catch { msg = {}; }
      const cmd = String(msg.cmd || '');
      const args = Array.isArray(msg.args) ? msg.args.map(String) : [];
      const fn = COMMANDS[cmd];
      let out;
      const t0 = Date.now();
      try {
        if (!fn) out = { ok: false, error: `Lệnh không có: "${cmd}". Có: ${Object.keys(COMMANDS).join(', ')}` };
        else {
          if (!page && cmd !== 'fresh' && cmd !== 'stop') await newContext();
          out = await fn(args);
          if (out && out.ok && AUTO_SHOT.has(cmd)) out.shot = await shot(`${cmd}-${args.join('_')}`);
          const fresh = errors.length - errorsSeen;
          if (fresh > 0 && cmd !== 'errors') out.newErrors = fresh;
          if (dialogsPending.length) { out.dialogs = dialogsPending; dialogsPending = []; }
        }
      } catch (e) {
        out = { ok: false, error: String(e && e.message ? e.message : e).split('\n')[0] };
      }
      log(ACTIONS, { cmd, args, ms: Date.now() - t0, result: summarize(out) });
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(out));
    });
  });
});

function summarize(out) {
  if (!out) return out;
  if (out.controls) return { controls: out.controls.length, texts: out.texts.length, coarse: out.coarsePointer };
  return out;
}

(async () => {
  await ensureApp();
  browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
    // Real GPU through ANGLE/D3D11 so the WebGL water renders like on the user's PC.
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
  });
  await newContext();
  server.listen(PORT, '127.0.0.1', () => {
    log(ACTIONS, { cmd: '(start)', args: [DEVICE_NAME, APP_URL], result: { ok: true } });
    console.log(`ready device=${DEVICE_NAME} port=${PORT} out=${OUT}`);
  });
})().catch((e) => {
  console.error('browser.cjs failed:', e);
  process.exit(1);
});
