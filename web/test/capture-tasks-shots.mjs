#!/usr/bin/env node
/**
 * Capture Tasks dock screenshots at phone + desktop viewports.
 * Usage: node web/test/capture-tasks-shots.mjs <before|after>
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const tag = process.argv[2] === 'after' ? 'after' : 'before';
const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const outDir = path.resolve(here, 'artifacts');
fs.mkdirSync(outDir, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

function contentType(file) {
  return MIME[path.extname(file)] || 'application/octet-stream';
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/ui/harness.html';
  const file = path.normalize(path.join(webRoot, rel));
  if (!file.startsWith(webRoot) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': contentType(file) });
  fs.createReadStream(file).pipe(res);
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const { port } = server.address();
const base = `http://127.0.0.1:${port}/ui/harness.html?still&shot&live=0&open=none`;

const viewports = [
  { name: '320', width: 320, height: 568 },
  { name: '390', width: 390, height: 844 },
  { name: '1280', width: 1280, height: 800 },
];

const browser = await chromium.launch({ headless: true });
try {
  for (const vp of viewports) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2 });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.waitForSelector('.bhq-tasks-toggle');
    // Ensure sheet starts collapsed on phone (no ?sheet=open).
    await page.waitForTimeout(200);
    const file = path.join(outDir, `${tag}-tasks-${vp.name}.png`);
    await page.screenshot({ path: file, fullPage: false });
    console.log('wrote', file);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
