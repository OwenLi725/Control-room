/**
 * The office Tasks & Decisions surface is gone.
 * At 320, 390, and 1280 there is no toggle, no tab strip, no task list, and no
 * peek parking. Floors, assistant rows, the activity feed, the phone sheet, and
 * the #hq-… deep link still work.
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
const repoRoot = path.resolve(here, '../..');
const webRoot = path.resolve(here, '..');
const artifacts = path.join(here, 'artifacts');
fs.mkdirSync(artifacts, { recursive: true });

const TOPIC = 'hq-Mxlj1TVQyC7fwI32fboWAErb';
const FLOORS = ['Main', 'Black House', 'Exec', 'KVideo', 'DET'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
};

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/web/ui/harness.html';
    const file = path.normalize(path.join(repoRoot, rel));
    if (!file.startsWith(repoRoot) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function launchBrowser() {
  return chromium.launch({
    headless: true,
    channel: 'chrome',
    args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
  });
}

async function openHarness(browser, server, viewport) {
  const port = server.address().port;
  const page = await browser.newPage({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 2,
    hasTouch: viewport.width <= 600,
  });
  const url = `http://127.0.0.1:${port}/web/ui/harness.html?still&shot&live=0&open=none`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('.bhq-floor');
  await page.waitForTimeout(250);
  return page;
}

/** DOM proof that the Tasks surface is not rendered and did not leave an empty slot. */
async function tasksGone(page) {
  return page.evaluate(() => {
    const text = document.body.innerText || '';
    const phone = document.documentElement.classList.contains('bhq-phone');
    const tasks = document.querySelector('.bhq-tasks, .bhq-tasks-toggle, .bhq-tasks-tab, .bhq-tasks-row, #bhq-tasks-panel');
    const headings = /Tasks & Decisions|任務與決策|任务与決策|Task filters/.test(text);
    const liveNote = /Live statuses/.test(text);
    const peek = document.querySelector('.bhq-speek');
    let peekSlack = null;
    let extras = [];
    if (phone && peek) {
      const grab = peek.querySelector('.bhq-sgrab');
      const head = peek.querySelector('.bhq-thead');
      const ph = peek.getBoundingClientRect().height;
      const used = (grab ? grab.getBoundingClientRect().height : 0) + (head ? head.getBoundingClientRect().height : 0);
      peekSlack = Math.round((ph - used) * 10) / 10;
      extras = [...peek.children].map((el) => el.className).filter((c) => !/bhq-sgrab|bhq-shead/.test(String(c)));
    }
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight - 48;
    const hit = document.elementFromPoint(cx, cy);
    const r = hit ? hit.getBoundingClientRect() : null;
    const wideBottomBar = !phone && !!(hit && r && r.width > window.innerWidth * 0.35 && r.bottom > window.innerHeight - 90 && !hit.closest('#scene') && hit.id !== 'scene');
    return {
      tasks: !!tasks, headings, liveNote, peekSlack, extras, wideBottomBar,
      hit: hit ? (hit.id || hit.className || hit.tagName) : null,
      phone,
    };
  });
}

async function feedAlive(page) {
  return page.evaluate(() => {
    const feed = document.querySelector('#feed');
    if (!feed) return { ok: false };
    return {
      ok: true,
      rows: feed.querySelectorAll('.bhq-frow').length,
      label: feed.querySelector('.bhq-fhead')?.textContent?.trim() || '',
    };
  });
}

test('source no longer builds a Tasks dock', () => {
  const ui = fs.readFileSync(path.join(webRoot, 'ui/ui.js'), 'utf8');
  const css = fs.readFileSync(path.join(webRoot, 'ui/ui.css'), 'utf8');
  const office = fs.readFileSync(path.join(webRoot, 'lib/office.js'), 'utf8');
  for (const [name, src] of [['ui.js', ui], ['ui.css', css], ['office.js', office]]) {
    assert.equal(/placePhoneTasks|bhq-tasks|taskView|Tasks & Decisions|任務與決策/.test(src), false, name);
  }
});

test('deep link hash still names both mailboxes', async () => {
  const { feedFromHash } = await import('../feed.js');
  const f = feedFromHash(`#${TOPIC}`, '');
  assert.equal(f.topic, TOPIC);
  assert.deepEqual(f.servers, ['https://relay.0xcodila.com', 'https://ntfy.sh']);
});

test('harness office has no Tasks chrome at 320, 390, and 1280', async (t) => {
  const server = await startServer();
  const browser = await launchBrowser();
  t.after(async () => { await browser.close(); server.close(); });

  for (const vp of [
    { width: 320, height: 568, name: '320' },
    { width: 390, height: 844, name: '390' },
    { width: 1280, height: 800, name: '1280' },
  ]) {
    await t.test(`${vp.name}×${vp.height}`, async () => {
      const page = await openHarness(browser, server, vp);
      const gone = await tasksGone(page);
      assert.equal(gone.tasks, false, 'no Tasks nodes');
      assert.equal(gone.headings, false, 'no Tasks & Decisions heading');
      assert.equal(gone.liveNote, false, 'no Live statuses note');
      const floors = await page.locator('.bhq-floor').count();
      assert.ok(floors >= 2, 'floor controls still render');
      const feed = await feedAlive(page);
      assert.equal(feed.ok, true, 'activity feed node still exists');
      assert.equal(feed.label, 'Activity');
      assert.ok(feed.rows > 0, 'activity feed has rows');
      if (vp.width <= 600) {
        assert.equal(gone.phone, true);
        assert.ok(gone.peekSlack != null && gone.peekSlack < 16, `peek has no hollow Tasks slot (${gone.peekSlack}px)`);
        assert.deepEqual(gone.extras, [], 'peek holds only the grabber and floor head');
      } else {
        assert.equal(gone.phone, false);
        assert.equal(gone.wideBottomBar, false, `bottom center is the scene, hit ${gone.hit}`);
      }
      const members = await page.locator('.bhq-member').count();
      assert.ok(members > 0, 'assistant rows still render');
      await page.close();
    });
  }
});

test('phone sheet, floor chips, feed, and bot card still open', async (t) => {
  const server = await startServer();
  const browser = await launchBrowser();
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
      const tr = S.style.transform || '';
      const m = /translate3d\(\s*[-0-9.]+(?:px)?,\s*([-0-9.]+)px/i.exec(tr);
      if (!m) return false;
      const y = Math.abs(parseFloat(m[1]));
      return want ? y < 2 : y > 40;
    }, open, { timeout: 5000 });
  };

  let grab = await grabCenter();
  await page.mouse.click(grab.x, grab.y);
  await waitSheet(true);

  const feedHit = await page.evaluate(() => {
    const feed = document.querySelector('#feed');
    const body = document.querySelector('.bhq-sbody');
    if (!feed || !body || !body.contains(feed)) return { ok: false };
    return {
      ok: true,
      rows: feed.querySelectorAll('.bhq-frow').length,
      label: feed.querySelector('.bhq-fhead')?.textContent?.trim() || '',
    };
  });
  assert.equal(feedHit.ok, true, 'activity feed sits in the open sheet');
  assert.equal(feedHit.label, 'Activity');
  assert.ok(feedHit.rows > 0, 'activity feed has rows');

  grab = await grabCenter();
  await page.mouse.click(grab.x, grab.y);
  await waitSheet(false);

  const floor = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.bhq-floor')].find((b) => {
      const r = b.getBoundingClientRect();
      return r.left >= 0 && r.right <= window.innerWidth && r.width > 20;
    }) || document.querySelector('.bhq-floor');
    const r = btn.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.click(floor.x, floor.y);
  await page.waitForTimeout(150);

  grab = await grabCenter();
  await page.mouse.click(grab.x, grab.y);
  await waitSheet(true);
  const member = await page.evaluate(() => {
    const body = document.querySelector('.bhq-sbody');
    const btn = document.querySelector('.bhq-member');
    if (!btn || !body) return null;
    const br = btn.getBoundingClientRect();
    const sr = body.getBoundingClientRect();
    if (br.top < sr.top || br.bottom > sr.bottom) body.scrollTop += br.top - sr.top - 8;
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
  assert.ok(member, 'assistant row present when the sheet is open');
  assert.equal(member.inView, true);
  assert.equal(member.hit, true);
  await page.mouse.click(member.x, member.y);
  await page.waitForTimeout(400);
  const cardVisible = await page.evaluate(() => {
    const card = document.querySelector('.bhq-card');
    const panel = document.getElementById('panel');
    return !!(card && !card.hidden && panel && getComputedStyle(panel).display !== 'none');
  });
  const away = await page.evaluate(() => document.querySelector('.bhq-sheet').classList.contains('is-away'));
  assert.equal(away, true, 'sheet yields to the bot card');
  assert.equal(cardVisible, true, 'bot card visible');
  const stillGone = await tasksGone(page);
  assert.equal(stillGone.tasks, false);
  await page.close();
});

test('live office with the hq deep link has the scene, five floors, feed, and no Tasks panel', { timeout: 240000 }, async (t) => {
  const server = await startServer();
  const browser = await launchBrowser();
  t.after(async () => { await browser.close(); server.close(); });
  const port = server.address().port;

  for (const vp of [
    { width: 320, height: 568, name: '320' },
    { width: 390, height: 844, name: '390' },
    { width: 1280, height: 800, name: '1280' },
  ]) {
    await t.test(`${vp.name}×${vp.height}`, async () => {
      const page = await browser.newPage({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 2,
        hasTouch: vp.width <= 600,
      });
      const hits = [];
      page.on('request', (req) => {
        const u = req.url();
        if (u.includes(TOPIC)) hits.push(u);
      });
      try {
      await page.goto(`http://127.0.0.1:${port}/web/index.html#${TOPIC}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForSelector('#scene canvas', { state: 'attached', timeout: 45000 });
      await page.waitForFunction((names) => {
        const labels = [...document.querySelectorAll('.bhq-fname')].map((el) => el.textContent.trim());
        return names.every((n) => labels.some((label) => label === n || label.startsWith(n)));
      }, FLOORS, { timeout: 90000 });
      await page.waitForFunction(() => {
        const rows = document.querySelectorAll('#feed .bhq-frow');
        const members = document.querySelectorAll('.bhq-member');
        return rows.length > 0 && members.length > 0;
      }, null, { timeout: 20000 });
      // Let the first elevator settle so the building is in frame.
      await page.waitForTimeout(1600);
      const gone = await tasksGone(page);
      assert.equal(gone.tasks, false);
      assert.equal(gone.headings, false);
      assert.equal(gone.liveNote, false);
      if (vp.width <= 600) {
        assert.ok(gone.peekSlack != null && gone.peekSlack < 16, `peek slack ${gone.peekSlack}`);
        assert.deepEqual(gone.extras, []);
      } else {
        assert.equal(gone.wideBottomBar, false, `bottom center hit ${gone.hit}`);
      }
      const info = await page.evaluate((names) => {
        const labels = [...document.querySelectorAll('.bhq-fname')].map((el) => el.textContent.trim());
        const canvas = document.querySelector('#scene canvas');
        return {
          hash: location.hash,
          labels,
          members: document.querySelectorAll('.bhq-member').length,
          feed: (document.querySelector('#feed')?.innerText || '').slice(0, 120),
          canvas: !!(canvas && canvas.width > 0 && canvas.height > 0),
          matched: names.filter((n) => labels.some((label) => label === n || label.startsWith(n))),
        };
      }, FLOORS);
      assert.equal(info.hash, `#${TOPIC}`);
      assert.deepEqual(info.matched, FLOORS);
      assert.ok(info.members > 0, 'assistant chips/rows present');
      const feed = await feedAlive(page);
      assert.equal(feed.label, 'Activity');
      assert.ok(feed.rows > 0, 'live feed has rows');
      assert.equal(info.canvas, true, '3D scene canvas has pixels');
      assert.ok(hits.some((u) => u.includes('relay.0xcodila.com') && u.includes(TOPIC)), 'deep link still reads the relay');
      assert.ok(hits.some((u) => u.includes('ntfy.sh') && u.includes(TOPIC)), 'deep link still reads ntfy');
      const shot = path.join(artifacts, `office-no-tasks-${vp.name}.png`);
      await page.screenshot({ path: shot, fullPage: false });
      } finally {
        await page.close();
      }
    });
  }
});
