#!/usr/bin/env node
// Generates test files into qa/fixtures/: good and bad audio files, backups and nasty strings.
// Run: node qa/make-fixtures.cjs
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, 'fixtures');
fs.mkdirSync(DIR, { recursive: true });
const put = (name, data) => fs.writeFileSync(path.join(DIR, name), data);

// 16-bit mono PCM WAV. kind 'rain' = soft filtered noise, 'tone' = 440 Hz.
function wav(seconds, kind) {
  const rate = 22050;
  const n = Math.round(seconds * rate);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  let lp = 0;
  let seed = 12345;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const white = seed / 0x3fffffff - 1;
    lp += 0.15 * (white - lp);
    const s = kind === 'tone' ? Math.sin((2 * Math.PI * 440 * i) / rate) * 0.3 : lp * 0.6;
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(s * 32767))), 44 + i * 2);
  }
  return buf;
}

// --- audio: good ---
put('mua-nhe.wav', wav(8, 'rain'));
put('chuong-440.wav', wav(3, 'tone'));
put('Tiếng mưa rơi trên mái tôn nhà bà ngoại ở quê vào một buổi chiều mùa hạ năm ấy thật là dài.wav', wav(4, 'rain'));
// --- audio: bad ---
put('rong.mp3', Buffer.alloc(0));
put('van-ban-doi-duoi.mp3', 'Đây là một file văn bản, không phải âm thanh.\n'.repeat(50));
put('anh-gia.wav', Buffer.from('89504E470D0A1A0A0000000D49484452', 'hex'));
put('ghi-chu.txt', 'Một file không phải âm thanh.');

// --- backups ---
const backup = {
  app: 'tiny-tropical-island',
  v: 1,
  exportedAt: Date.UTC(2026, 10, 1, 8, 0, 0),
  data: {
    // Same shape as the app's TodoState (src/ui/todo.ts): open/done task lists, day, pomosToday.
    'tsw.todo': JSON.stringify({ open: [{ id: 'a1', text: 'Viết báo cáo tuần', pomos: 0 }], done: [], day: '2026-11-01', pomosToday: 0 }),
  },
};
put('saoluu-hop-le.json', JSON.stringify(backup, null, 2));
put('saoluu-hong.json', '{"app":"tiny-tropical-island","v":1,"data":{"tsw.todo": [1,2,');
put('saoluu-rong.json', '');
put('saoluu-app-khac.json', JSON.stringify({ app: 'cozy-book-shelf', v: 1, data: {} }));

// --- nasty strings for typing (one per line) ---
put(
  'chuoi-xau.txt',
  [
    'Cảnh '.repeat(40).trim(),
    '   ',
    '🌴🌊🌧️⛈️🌙✨🔥',
    'Ngày nắng',
    '<b>đậm</b><script>alert(1)</script>',
    'https://www.youtube.com/watch?v=khong-hop-le',
    'không phải link',
    'a',
  ].join('\n'),
);

console.log('fixtures:', fs.readdirSync(DIR).join(', '));
