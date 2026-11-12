// Roster gate. Feed fixtures are the read-only seeds in ../../../docs (outside this repo).
// STATUS-ALIASES.json lives in the repo at ../../docs and must match STATUS_ALIASES.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { StateStore, botIdFor } from '../lib/state.js';
import {
  OfficeGate, STATUS_ALIASES, sourceHash, lineKeys, canonicalBotName,
} from '../lib/office.js';

const docs = path.resolve(import.meta.dirname, '../../../docs');
const read = (name) => JSON.parse(fs.readFileSync(path.join(docs, name), 'utf8'));
const roster = read('FEED-POST-roster.json').roster;
const groups = read('FEED-POST-groups.json').groups;
const ids = read('FEED-POST-ids.json').ids;
const looks = read('FEED-POST-looks.json').looks;
const aliasFile = JSON.parse(
  fs.readFileSync(path.resolve(import.meta.dirname, '../../docs/STATUS-ALIASES.json'), 'utf8'),
).aliases;

// Locked 16-name roster already posted at 14:18 HKT on 2026-11-12.
const LOCKED_16 = [
  'Kelly · CoS · Exec',
  'Victor · GM · DET',
  'Michael · Dir · DR',
  'Lauren · HR Dir · Exec',
  'Ryan · Eng · DR',
  'Helen · PM · DR',
  'Elise · Design · DR',
  'Tess · QA · DR',
  'Hugo · Butler · Exec',
  'Clara · Briefs · Exec',
  'George · Visual · Exec',
  'Felix · Tech · Exec',
  'Nathan · Data · DET',
  'Maya · Brand · DET',
  'Ivan · Intel · DET',
  'Sophie · Comms · DET',
];

const NEW_ALIASES = [
  ['Eng · Black House', 'Ryan · Eng · DR'],
  ['Product · Black House', 'Helen · PM · DR'],
  ['Design · Black House', 'Elise · Design · DR'],
  ['QA · Black House', 'Tess · QA · DR'],
  ['Michael · Black House', 'Michael · Dir · DR'],
  ['Michael · Dir · BH', 'Michael · Dir · DR'],
  ['Kelly · Exec', 'Kelly · CoS · Exec'],
  ['HR · Exec', 'Lauren · HR Dir · Exec'],
  ['GM · DET', 'Victor · GM · DET'],
  ['Numbers · DET', 'Nathan · Data · DET'],
  ['Comms · DET', 'Sophie · Comms · DET'],
  ['Studio · DET', 'Maya · Brand · DET'],
  ['Intel · DET', 'Ivan · Intel · DET'],
  ['Briefs · Exec · 个人简报', 'Clara · Briefs · Exec'],
  ['Codex · Exec', 'Felix · Tech · Exec'],
  ['Butler · Exec', 'Hugo · Butler · Exec'],
];

const NOW = Date.parse('2026-11-06T07:05:00Z');

function setup(now = NOW) {
  const store = new StateStore({ now: () => now, tz: 'Asia/Hong_Kong' });
  const gate = new OfficeGate(store, { aliases: aliasFile });
  return { store, gate };
}

function names(store) {
  return Object.values(store.snapshot().bots).map((b) => b.name).sort();
}

test('alias map matches the seed file exactly', () => {
  assert.deepEqual(STATUS_ALIASES, aliasFile);
  assert.equal(canonicalBotName('DET 總管', aliasFile), 'Victor · GM · DET');
  assert.equal(canonicalBotName('秘书组 · 成稿', aliasFile), 'Draft · Exec');
  assert.equal(canonicalBotName('Kelly · Exec', aliasFile), 'Kelly · CoS · Exec');
  assert.equal(canonicalBotName('GM · DET', aliasFile), 'Victor · GM · DET');
});

test('alias + chronological latest: older legacy then newer canonical is one bot', () => {
  const { store, gate } = setup();
  gate.applyConfig('floor', groups);
  gate.applyRoster(roster, '2026-11-06T00:00:00Z');
  assert.equal(gate.applyStatus({ t: '2026-11-06T01:00:00Z', bot: 'DET 總管', status: 'working', step: 'legacy step' }), true);
  assert.equal(gate.applyStatus({ t: '2026-11-06T02:00:00Z', bot: 'GM · DET', status: 'waiting_user', step: 'canonical step' }), true);
  const st = store.snapshot();
  const hits = Object.values(st.bots).filter((b) => b.name === 'Victor · GM · DET' || b.name === 'GM · DET' || b.name === 'DET 總管');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, botIdFor('Victor · GM · DET'));
  assert.equal(hits[0].name, 'Victor · GM · DET');
  assert.equal(hits[0].status, 'waiting_user');
  assert.equal(hits[0].step, 'canonical step');
  assert.equal(st.feed[0].name, 'Victor · GM · DET');
  assert.equal(st.feed[0].status, 'waiting_user');

  // A later-arriving older line must not walk the status backwards.
  assert.equal(gate.applyStatus({ t: '2026-11-06T01:30:00Z', bot: 'DET 總管', status: 'error', step: 'stale' }), false);
  assert.equal(store.snapshot().bots[hits[0].id].status, 'waiting_user');
  assert.equal(store.snapshot().bots[hits[0].id].step, 'canonical step');
});

test('unknown status is ignored and never materializes a bot', () => {
  const { store, gate } = setup();
  assert.equal(gate.applyStatus({ t: '2026-11-06T01:00:00Z', bot: 'Not A Person', status: 'working', step: 'nope' }), false);
  assert.equal(store.bots.size, 0);
  gate.applyConfig('floor', groups);
  gate.applyRoster(roster, '2026-11-06T00:30:00Z');
  const n = store.bots.size;
  assert.equal(gate.applyStatus({ t: '2026-11-06T03:00:00Z', bot: 'Ghost Bot', status: 'working', step: 'still no' }), false);
  assert.equal(store.bots.size, n);
  assert.equal(names(store).includes('Not A Person'), false);
  assert.equal(names(store).includes('Ghost Bot'), false);
  assert.ok(gate.diagnostics.some((d) => d.name === 'Not A Person' && d.kind === 'status'));
  assert.ok(gate.diagnostics.some((d) => d.name === 'Ghost Bot' && d.kind === 'status'));
});

test('roster-first alias merges, and a queued legacy line applies when the roster arrives', () => {
  const first = setup();
  first.gate.applyRoster(roster, '2026-11-06T00:00:00Z');
  first.gate.applyConfig('floor', { '秘书组 · 成稿': 'Exec', 'Draft · Exec': 'Exec', 'DET Marketing': 'DET' });
  assert.equal(first.gate.applyStatus({ t: '2026-11-06T01:00:00Z', bot: 'DET Marketing', status: 'working', step: 'ads' }), true);
  const marketing = Object.values(first.store.snapshot().bots).filter((b) => b.name === 'Marketing · DET' || b.name === 'DET Marketing');
  assert.equal(marketing.length, 1);
  assert.equal(marketing[0].name, 'Marketing · DET');
  assert.equal(marketing[0].status, 'working');
  assert.equal(marketing[0].step, 'ads');
  assert.equal(marketing[0].floor, 'det');
  assert.equal(Object.keys(first.store.snapshot().bots).length, roster.length);

  const queued = setup();
  assert.equal(queued.gate.applyStatus({ t: '2026-11-06T01:00:00Z', bot: '秘书组 · 成稿', status: 'done', step: '稿好了' }), false);
  assert.equal(queued.store.bots.size, 0, 'a legacy line before the roster does not invent a person');
  queued.gate.applyConfig('floor', groups);
  queued.gate.applyRoster(roster, '2026-11-06T02:00:00Z');
  const draft = queued.store.snapshot().bots[botIdFor('Draft · Exec')];
  assert.equal(draft.name, 'Draft · Exec');
  assert.equal(draft.status, 'done');
  assert.equal(draft.step, '稿好了');
  assert.equal(draft.floor, 'exec');
  assert.equal(queued.store.snapshot().feed.find((e) => e.name === 'Draft · Exec' && e.status === 'done').step, '稿好了');

  // A later roster must not delete someone who already has a live status, and Main stays the top floor.
  const kept = queued.store.snapshot().bots[botIdFor('Kelly · CoS · Exec')];
  queued.gate.applyStatus({ t: '2026-11-06T03:00:00Z', bot: 'Kelly · Exec', status: 'working', step: 'still here' });
  queued.gate.applyRoster(roster.filter((n) => n !== 'Kelly · Exec'), '2026-11-06T04:00:00Z');
  const kelly = queued.store.snapshot().bots[botIdFor('Kelly · CoS · Exec')];
  assert.ok(kelly, 'live status is kept when a later roster omits the name');
  assert.equal(kelly.status, 'working');
  assert.equal(kelly.step, 'still here');
  assert.ok(kept);
  const floors = queued.store.snapshot().floors;
  const main = floors.find((f) => f.name === 'Main floor');
  assert.equal(main.order, Math.max(...floors.map((f) => f.order)));
});

test('fixture roster is 35 people and the floors are 5/6/5/6/13', () => {
  assert.equal(roster.length, 35);
  assert.equal(Object.keys(ids).length, 35);
  assert.equal(Object.keys(groups).length, 35);
  for (const name of roster) {
    assert.equal(groups[name] != null, true, name);
    assert.equal(typeof ids[name], 'string', name);
  }
  const { store, gate } = setup();
  gate.applyConfig('look', looks);
  gate.applyConfig('floor', groups);
  // A legacy look key merges onto the canonical bot and does not add a person.
  gate.applyConfig('look', { 'DET 總管': { shape: 'sphere', color: '#000000', accessory: 'glasses' } });
  gate.applyRoster(roster, '2026-11-06T00:00:00Z');
  const st = store.snapshot();
  assert.equal(Object.keys(st.bots).length, 35);
  assert.equal(gate.roster.length, 35);
  const byName = Object.fromEntries(st.floors.map((f) => [f.name, f.bots.length]));
  assert.deepEqual(byName, {
    'Main floor': 5,
    'Black House': 6,
    Exec: 5,
    KVideo: 6,
    DET: 13,
  });
  assert.equal(Object.values(byName).reduce((s, n) => s + n, 0), roster.length);
  const main = st.floors.find((f) => f.name === 'Main floor');
  assert.equal(main.order, Math.max(...st.floors.map((f) => f.order)), 'Main floor stays the top floor');
  assert.equal(st.floors.filter((f) => f.bots.length).length, 5);
  const gm = st.bots[botIdFor('Victor · GM · DET')];
  assert.equal(gm.floor, 'general');
  assert.equal(gm.look && gm.look.shape, 'sphere');
  assert.equal(st.bots[botIdFor('Not A Person')], undefined);
});

test('sourceHash and source id stay safe, and a cross-mailbox duplicate does not change the line', () => {
  const msg = JSON.stringify({ bot: 'Kelly · Exec', status: 'working', step: 'a' });
  const relay = { src: 'relay', id: 'm1', time: 1762412400, message: msg };
  const ntfy = { src: 'ntfy', id: 'other-id', time: 1762412400, message: msg };
  const original = (seen, l) => {
    const a = `${l.src} ${l.id}`;
    const b = `${l.time} ${l.message}`;
    if (seen.has(a) || seen.has(b)) return false;
    seen.add(a);
    seen.add(b);
    return true;
  };
  const lines = [
    relay,
    relay,
    ntfy,
    { src: 'ntfy', id: 'x', time: relay.time, message: '{"bot":"Kelly · Exec","status":"done","step":"b"}' },
    { src: 'relay', id: 'm2', time: relay.time + 1, message: msg },
  ];
  const seen = new Set();
  const { gate } = setup();
  for (const line of lines) {
    assert.equal(gate.acceptLine(line), original(seen, line));
  }
  assert.equal(lineKeys(relay).hash, sourceHash('relay', 'm1', '1762412400', msg));
  assert.equal(sourceHash('relay', 'm1', 1762412400, msg), sourceHash('relay', 'm1', 1762412400, msg));
  assert.notEqual(sourceHash('relay', 'm1', 1762412400, msg), sourceHash('ntfy', 'm1', 1762412400, msg));
  assert.equal(sourceHash('relay', { evil: 'id' }, null, undefined), sourceHash('relay', { other: true }, undefined, null));
  assert.doesNotThrow(() => sourceHash(undefined, Object.create(null), Symbol('x'), 1));
  assert.equal(gate.acceptLine({ src: 'relay', id: '__proto__', time: 1, message: '{}' }), true);
  assert.equal(gate.acceptLine({ src: 'relay', id: '__proto__', time: 2, message: '{"b":1}' }), false);

  const once = setup();
  once.gate.applyConfig('floor', groups);
  once.gate.applyRoster(roster, '2026-11-06T00:00:00Z');
  const line = { src: 'relay', id: '1', time: Date.parse('2026-11-06T06:00:00Z') / 1000, message: msg };
  assert.equal(once.gate.acceptLine(line), true);
  once.gate.applyStatus({ t: new Date(line.time * 1000).toISOString(), bot: 'Kelly · Exec', status: 'working', step: 'a' });
  const snap = once.store.snapshot();
  const id = botIdFor('Kelly · CoS · Exec');
  const history = snap.bots[id].history.length;
  const status = snap.bots[id].status;
  assert.equal(once.gate.acceptLine({ src: 'ntfy', id: '9', time: line.time, message: msg }), false);
  const again = once.store.snapshot();
  assert.equal(again.bots[id].history.length, history);
  assert.equal(again.bots[id].status, status);
  assert.equal(again.bots[id].step, 'a');
  assert.equal(again.feed.filter((e) => e.bot === id && e.step === 'a').length, 1);
});


test('each new alias canonicalizes to the locked roster name', () => {
  const rosterSet = new Set(LOCKED_16);
  for (const [posted, locked] of NEW_ALIASES) {
    assert.equal(canonicalBotName(posted, aliasFile), locked, posted);
    assert.equal(STATUS_ALIASES[posted], locked, posted);
    assert.ok(rosterSet.has(locked), locked);
    assert.equal(aliasFile[posted], STATUS_ALIASES[posted], posted);
  }
  assert.equal(canonicalBotName('George · Visual · Exec', aliasFile), 'George · Visual · Exec');
  assert.equal(canonicalBotName('Lauren · HR Dir · Exec', aliasFile), 'Lauren · HR Dir · Exec');
  assert.equal(canonicalBotName('Victor · GM · DET', aliasFile), 'Victor · GM · DET');
  assert.equal(Object.prototype.hasOwnProperty.call(STATUS_ALIASES, 'George · Visual · Exec'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(STATUS_ALIASES, 'Lauren · HR Dir · Exec'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(STATUS_ALIASES, 'Victor · GM · DET'), false);
});

test('a status post under the old name updates that roster person once the 16-name roster is applied', () => {
  const after = setup();
  after.gate.applyRoster(LOCKED_16, '2026-11-12T06:18:00Z');
  assert.equal(Object.keys(after.store.snapshot().bots).length, 16);
  for (const [posted, locked] of NEW_ALIASES) {
    assert.equal(after.gate.applyStatus({ t: '2026-11-12T06:20:00Z', bot: posted, status: 'working', step: posted }), true, posted);
    const bot = after.store.snapshot().bots[botIdFor(locked)];
    assert.equal(bot.name, locked, posted);
    assert.equal(bot.status, 'working', posted);
    assert.equal(bot.step, posted);
  }
  // Two posted names for the same person stay one bot.
  const michael = Object.values(after.store.snapshot().bots).filter((b) => b.name === 'Michael · Dir · DR');
  assert.equal(michael.length, 1);

  const queued = setup();
  assert.equal(queued.gate.applyStatus({ t: '2026-11-12T06:19:00Z', bot: 'Eng · Black House', status: 'working', step: 'office alias' }), false);
  assert.equal(queued.store.bots.size, 0);
  queued.gate.applyRoster(LOCKED_16, '2026-11-12T06:21:00Z');
  const ryan = queued.store.snapshot().bots[botIdFor('Ryan · Eng · DR')];
  assert.equal(ryan.name, 'Ryan · Eng · DR');
  assert.equal(ryan.status, 'working');
  assert.equal(ryan.step, 'office alias');
});

test('an unknown name is still dropped after the 16-name roster is applied', () => {
  const { store, gate } = setup();
  gate.applyRoster(LOCKED_16, '2026-11-12T06:18:00Z');
  const n = store.bots.size;
  assert.equal(n, 16);
  assert.equal(gate.applyStatus({ t: '2026-11-12T06:22:00Z', bot: 'Not A Person', status: 'working', step: 'nope' }), false);
  assert.equal(gate.applyStatus({ t: '2026-11-12T06:22:00Z', bot: 'Eng Lead · Black House', status: 'working', step: 'retired' }), false);
  assert.equal(store.bots.size, n);
  assert.equal(names(store).includes('Not A Person'), false);
  assert.equal(names(store).includes('Eng Lead · Black House'), false);
  assert.ok(gate.diagnostics.some((d) => d.name === 'Not A Person' && d.kind === 'status'));
  assert.ok(gate.diagnostics.some((d) => d.name === 'Eng Lead · Black House' && d.kind === 'status'));
});
