import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OUTDIR || path.join(DIR, '..', 'frames');
const EXE = process.env.CHROME || `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.woff2': 'font/woff2', '.css': 'text/css' };

const server = http.createServer((req, res) => {
  const p = path.join(DIR, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
  fs.readFile(p, (err, buf) => {
    if (err) { res.writeHead(404); res.end('nope'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(buf);
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const mode = process.argv[2] || 'all';
const browser = await chromium.launch({ executablePath: EXE, args: ['--force-color-profile=srgb', '--font-render-hinting=none', '--disable-lcd-text', '--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
page.on('console', m => { if (m.type() === 'error') console.log('PAGE ERROR:', m.text()); });
page.on('pageerror', e => console.log('PAGE EXCEPTION:', e.message));
await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
await page.waitForFunction('window.__ready !== undefined');
await page.evaluate('window.__ready');
const meta = await page.evaluate('window.META');
console.log('meta', JSON.stringify(meta));
await page.waitForTimeout(500);

fs.mkdirSync(OUT, { recursive: true });
async function grab(n, file) {
  await page.evaluate(i => window.renderFrame(i), n);
  await page.screenshot({ path: file, type: 'png', clip: { x: 0, y: 0, width: 1080, height: 1920 } });
}

if (mode === 'sheet') {
  const picks = (process.env.PICKS || '').split(',').filter(Boolean).map(Number);
  const list = picks.length ? picks : Array.from({ length: 20 }, (_, i) => Math.round(i * (meta.TOTAL - 1) / 19));
  for (const [i, n] of list.entries()) {
    await grab(n, path.join(OUT, `s${String(i).padStart(3, '0')}_f${n}.png`));
  }
  console.log('sheet frames:', list.join(','));
} else {
  const t0 = Date.now();
  const from = Number(process.env.FROM || 0), to = Number(process.env.TO || meta.TOTAL);
  for (let n = from; n < to; n++) {
    await grab(n, path.join(OUT, `f${String(n).padStart(5, '0')}.png`));
    if (n % 60 === 0) console.log(`frame ${n}/${meta.TOTAL} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  }
  console.log(`done ${meta.TOTAL} frames in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
await browser.close();
server.close();
