#!/usr/bin/env node
// Client for browser.cjs: node qa/act.cjs <port> <command> [args...]  → prints the JSON reply.
// Examples:
//   node qa/act.cjs 9301 fresh
//   node qa/act.cjs 9301 click "Cảnh"
//   node qa/act.cjs 9301 press Shift+Space
//   node qa/act.cjs 9301 drag 900 500 600 500
'use strict';

const http = require('node:http');

const [port, cmd, ...args] = process.argv.slice(2);
if (!port || !cmd) {
  console.error('usage: node qa/act.cjs <port> <command> [args...]');
  process.exit(2);
}

const body = JSON.stringify({ cmd, args });
const req = http.request(
  { host: '127.0.0.1', port: Number(port), method: 'POST', path: '/', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, timeout: 180000 },
  (res) => {
    let data = '';
    res.setEncoding('utf8');
    res.on('data', (c) => (data += c));
    res.on('end', () => {
      try {
        console.log(JSON.stringify(JSON.parse(data), null, cmd === 'ui' || cmd === 'axe' ? 0 : 2));
      } catch {
        console.log(data);
      }
    });
  },
);
req.on('error', (e) => {
  console.log(JSON.stringify({ ok: false, error: `browser.cjs không chạy ở cổng ${port}: ${e.message}` }));
  process.exit(1);
});
req.end(body);
