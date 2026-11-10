/**
 * Phone Tasks entrance: collapsed sheet must keep the toggle in-viewport and
 * openable via a REAL pointer hit-test (elementFromPoint + mouse click at
 * coordinates). dispatchEvent / element.click() alone is NOT accepted as proof.
 *
 * Run: node --test web/test/phone-tasks-entrance.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const artifacts = path.join(here, 'artifacts');
fs.mkdirSync(artifacts, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/ui/harness.html';
    const file = path.normalize(path.join(webRoot, rel));
    if (!file.startsWith(webRoot) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function openHarness(browser, server, viewport) {
  const port = server.address().port;
  const page = await browser.newPage({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 2,
    hasTouch: viewport.width <= 600,
  });
  const url = `http://127.0.0.1:${port}/ui/harness.html?still&shot&live=0&open=none`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('.bhq-tasks-toggle');
  await page.waitForTimeout(250);
  return page;
}

/** Geometry + real topmost-element probe. Never uses element.click() as proof. */
async function probeToggle(page) {
  return page.evaluate(() => {
    const toggle = document.querySelector('.bhq-tasks-toggle');
    const tasks = document.querySelector('.bhq-tasks');
    const body = document.querySelector('.bhq-sbody');
    const sheet = document.querySelector('.bhq-sheet');
    if (!toggle || !tasks) return { ok: false, reason: 'missing toggle' };
    const r = toggle.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const top = document.elementFromPoint(cx, cy);
    const hitToggle = !!(top && top.closest && top.closest('.bhq-tasks-toggle'));
    const inViewport =
      r.width > 0 && r.height > 0
      && r.top >= -0.5 && r.left >= -0.5
      && r.bottom <= window.innerHeight + 0.5
      && r.right <= window.innerWidth + 0.5;
    const underInert = !!(toggle.closest('[inert]') || (body && body.inert && body.contains(toggle)));
    return {
      ok: true,
      phone: document.documentElement.classList.contains('bhq-phone'),
      sheetOpen: !!(sheet && sheet.classList.contains('is-open')),
      parentClass: tasks.parentElement ? tasks.parentElement.className : null,
      inPeek: !!(tasks.closest && tasks.closest('.bhq-speek')),
      underInert,
      inViewport,
      hitToggle,
      hitTag: top ? (top.className || top.tagName) : null,
      expanded: toggle.getAttribute('aria-expanded'),
      bodyOpen: !document.querySelector('.bhq-tasks-body')?.hasAttribute('hidden'),
      cx, cy,
      rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: r.width, h: r.height },
      vw: window.innerWidth, vh: window.innerHeight,
    };
  });
}

/** Real mouse press at the toggle center — not locator.click() / element.click(). */
async function realTapToggle(page, probe) {
  await page.mouse.move(probe.cx, probe.cy);
  await page.mouse.down();
  await page.mouse.up();
}

async function tabMetrics(page) {
  return page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.bhq-tasks-tab')];
    return tabs.map((btn) => {
      const r = btn.getBoundingClientRect();
      const style = getComputedStyle(btn);
      return {
        text: btn.textContent.trim(),
        on: btn.classList.contains('is-on'),
        w: r.width,
        h: r.height,
        flexGrow: style.flexGrow,
        justify: style.justifyContent,
        overflow: (btn.scrollWidth - btn.clientWidth) > 1,
        // pill should not stretch far beyond the label: compare content width vs button
        padX: parseFloat(style.paddingLeft) + parseFloat(style.paddingRight),
      };
    });
  });
}

test('phone collapsed Tasks entrance is in-viewport and opens via real hit-test (390 and 320)', async (t) => {
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); server.close(); });

  for (const vp of [
    { width: 390, height: 844, name: '390' },
    { width: 320, height: 568, name: '320' },
  ]) {
    await t.test(`${vp.name}×${vp.height}`, async () => {
      const page = await openHarness(browser, server, vp);
      const before = await probeToggle(page);

      assert.equal(before.phone, true, 'phone mode');
      assert.equal(before.sheetOpen, false, 'sheet starts collapsed');
      assert.equal(before.inPeek, true, 'Tasks parked in peek, not inert body');
      assert.equal(before.underInert, false, 'toggle must not sit under inert');
      assert.equal(before.inViewport, true, `toggle in viewport: ${JSON.stringify(before.rect)}`);
      assert.equal(before.hitToggle, true, `elementFromPoint must hit toggle, got ${before.hitTag}`);
      assert.equal(before.expanded, 'false');

      // Forbidden as sole evidence: element.click() / dispatchEvent. Use coordinate mouse.
      await realTapToggle(page, before);
      await page.waitForTimeout(200);

      const after = await probeToggle(page);
      assert.equal(after.expanded, 'true', 'real tap must open Tasks');
      assert.equal(after.bodyOpen, true, 'tasks body visible after real tap');

      // Open Tasks → tabs hug labels (not equal 3-col stretch).
      const tabs = await tabMetrics(page);
      assert.equal(tabs.length, 3);
      for (const tab of tabs) {
        assert.equal(tab.flexGrow, '0', `${tab.text} must not flex-grow equally`);
        assert.equal(tab.overflow, false, `${tab.text} must not truncate`);
        if (tab.on) {
          assert.ok(tab.w < vp.width * 0.55, `active pill for ${tab.text} must not stretch hugely (${tab.w}px)`);
        }
      }
      // "Needs input" should sit near "Recent" — no huge dead gap from equal columns.
      const needs = tabs.find((x) => x.text === 'Needs input');
      const recent = tabs.find((x) => x.text === 'Recent');
      assert.ok(needs && recent);
      // With hug layout, Recent is only a small gap after Needs input (not ~1/3 viewport away).
      const gapHint = await page.evaluate(() => {
        const a = document.getElementById('bhq-tab-needs_input').getBoundingClientRect();
        const b = document.getElementById('bhq-tab-recent').getBoundingClientRect();
        return b.left - a.right;
      });
      assert.ok(gapHint >= 0 && gapHint < 40, `gap after Needs input toward Recent should be compact, got ${gapHint}`);

      await page.screenshot({ path: path.join(artifacts, `after-tasks-open-${vp.name}.png`) });
      await page.close();
    });
  }
});

test('desktop 1280 Tasks dock unchanged in placement (body, not peek)', async (t) => {
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); server.close(); });

  const page = await openHarness(browser, server, { width: 1280, height: 800 });
  const info = await page.evaluate(() => {
    const tasks = document.querySelector('.bhq-tasks');
    const tabs = [...document.querySelectorAll('.bhq-tasks-tab')].map((b) => getComputedStyle(b).flexGrow);
    return {
      phone: document.documentElement.classList.contains('bhq-phone'),
      parent: tasks.parentElement && tasks.parentElement.tagName,
      inPeek: !!(tasks.closest && tasks.closest('.bhq-speek')),
      flexGrows: tabs,
    };
  });
  assert.equal(info.phone, false);
  assert.equal(info.inPeek, false);
  assert.equal(info.parent, 'BODY');
  // Desktop keeps equal-ish flex tabs (flex-grow 1).
  assert.ok(info.flexGrows.every((g) => g === '1'), `desktop tabs keep flex-grow 1, got ${info.flexGrows}`);
  await page.screenshot({ path: path.join(artifacts, 'after-tasks-1280.png') });
  await page.close();
});

test('drawer close, floors chips, and bot card still work on phone', async (t) => {
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); server.close(); });

  const page = await openHarness(browser, server, { width: 390, height: 844 });

  const grabCenter = () => page.evaluate(() => {
    const g = document.querySelector('.bhq-sgrab');
    const r = g.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  const waitSheet = async (open) => {
    await page.waitForFunction((want) => {
      const S = document.querySelector('.bhq-sheet');
      if (!S || S.classList.contains('is-open') !== want) return false;
      const t = S.style.transform || '';
      // Chromium serializes as translate3d(0px, Npx, 0px).
      const m = /translate3d\(\s*[-0-9.]+(?:px)?,\s*([-0-9.]+)px/i.exec(t);
      if (!m) return false;
      const y = Math.abs(parseFloat(m[1]));
      return want ? y < 2 : y > 40;
    }, open, { timeout: 5000 });
  };

  // Open sheet via grabber tap (peek drag end without move). Re-query coords after each move.
  let grab = await grabCenter();
  await page.mouse.click(grab.x, grab.y);
  await waitSheet(true);

  // Close sheet again (grab has moved with the sheet).
  grab = await grabCenter();
  await page.mouse.click(grab.x, grab.y);
  await waitSheet(false);

  // Floor chip is tappable (use a chip that is on-screen; the row scrolls).
  const floor = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.bhq-floor')].find((b) => {
      const r = b.getBoundingClientRect();
      return r.left >= 0 && r.right <= window.innerWidth;
    }) || document.querySelector('.bhq-floor');
    const r = btn.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, label: btn.textContent.slice(0, 40) };
  });
  await page.mouse.click(floor.x, floor.y);
  await page.waitForTimeout(150);

  // Open a bot card from the open sheet team list.
  grab = await grabCenter();
  await page.mouse.click(grab.x, grab.y);
  await waitSheet(true);
  const member = await page.evaluate(() => {
    const body = document.querySelector('.bhq-sbody');
    const btn = document.querySelector('.bhq-member');
    if (!btn || !body) return null;
    // Scroll the sheet body, not the page — Tasks stays parked in the peek.
    const br = btn.getBoundingClientRect();
    const sr = body.getBoundingClientRect();
    if (br.top < sr.top || br.bottom > sr.bottom) {
      body.scrollTop += br.top - sr.top - 8;
    }
    const r = btn.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const top = document.elementFromPoint(x, y);
    return {
      x, y,
      hit: !!(top && top.closest && top.closest('.bhq-member')),
      inView: r.top >= 0 && r.bottom <= window.innerHeight,
    };
  });
  assert.ok(member, 'team member row present when sheet open');
  assert.equal(member.inView, true, 'member must be in viewport before tap');
  assert.equal(member.hit, true, 'elementFromPoint must hit member');
  await page.mouse.click(member.x, member.y);
  await page.waitForTimeout(400);
  const cardVisible = await page.evaluate(() => {
    const card = document.querySelector('.bhq-card');
    const panel = document.getElementById('panel');
    return !!(card && !card.hidden && panel && getComputedStyle(panel).display !== 'none');
  });
  // Panel mode switches to card; sheet goes is-away.
  const away = await page.evaluate(() => document.querySelector('.bhq-sheet').classList.contains('is-away'));
  assert.equal(away, true, 'sheet yields to bot card');
  assert.equal(cardVisible, true, 'bot card visible');
  await page.close();
});
