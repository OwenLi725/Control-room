// Roster gate for the bots-only office. Alias a status name, then decide whether StateStore may
// create a person. Unknown names never become bots. Runs in Node (tests) and in the browser (feed.js).
import { botIdFor } from './state.js';
import { hash32, parseTime } from './util.js';

// Exact legacy names from docs/STATUS-ALIASES.json. A test compares this object to that file.
export const STATUS_ALIASES = {
  'DET 總管': 'GM · DET',
  'DET WhatsApp PA': 'WhatsApp PA · DET',
  'DET Inbox PA': 'Inbox PA · DET',
  'DET B2B Analyst': 'B2B Analyst · DET',
  'DET Marketing': 'Marketing · DET',
  '秘书组 · 成稿': 'Draft · Exec',
  'Eng · Black House': 'Ryan · Eng · DR',
  'Product · Black House': 'Helen · PM · DR',
  'Design · Black House': 'Elise · Design · DR',
  'QA · Black House': 'Tess · QA · DR',
  'Michael · Black House': 'Michael · Dir · DR',
  'Michael · Dir · BH': 'Michael · Dir · DR',
  'Kelly · Exec': 'Kelly · CoS · Exec',
  'HR · Exec': 'Lauren · HR Dir · Exec',
  'GM · DET': 'Victor · GM · DET',
  'Numbers · DET': 'Nathan · Data · DET',
  'Comms · DET': 'Sophie · Comms · DET',
  'Studio · DET': 'Maya · Brand · DET',
  'Intel · DET': 'Ivan · Intel · DET',
  'Briefs · Exec · 个人简报': 'Clara · Briefs · Exec',
  'Codex · Exec': 'Felix · Tech · Exec',
  'Butler · Exec': 'Hugo · Butler · Exec',
};

export function canonicalBotName(name, aliases = STATUS_ALIASES) {
  if (typeof name !== 'string') return '';
  let trimmed = name.trim();
  if (!trimmed) return '';
  const seen = new Set();
  while (Object.prototype.hasOwnProperty.call(aliases, trimmed)) {
    if (seen.has(trimmed)) return trimmed;
    seen.add(trimmed);
    const next = aliases[trimmed];
    if (typeof next !== 'string') return '';
    trimmed = next.trim();
    if (!trimmed) return '';
  }
  return trimmed;
}

/** Stable hex digest. Objects and missing parts become empty; it does not throw. */
export function sourceHash(src, id, time, message) {
  return hash32([part(src), part(id), part(time), part(message)].join('\u0000')).toString(16).padStart(8, '0');
}

function part(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'boolean') return v ? '1' : '0';
  return '';
}

/**
 * The same two keys web/feed.js used to drop a repeated mailbox id and a cross-mailbox copy of the
 * same second + text. sourceHash is recorded beside them and is not a third reason to drop a line.
 */
export function lineKeys(line) {
  const src = line && line.src != null && typeof line.src !== 'object' ? String(line.src) : '';
  const id = line && typeof line.id === 'string' ? line.id : '';
  const time = line && line.time != null && typeof line.time !== 'object' ? String(line.time) : '';
  const message = line && typeof line.message === 'string' ? line.message : '';
  return {
    source: `${src} ${id}`,
    line: `${time} ${message}`,
    hash: sourceHash(src, line ? line.id : '', time, message),
  };
}

const CHAT_URL = /^(grokbot|https):\/\//i;

/**
 * Sits in front of a StateStore. People come from the roster. A legacy alias is renamed first.
 * Status for a known alias before the roster arrives is queued, then applied in feed-time order.
 */
export class OfficeGate {
  constructor(store, opts = {}) {
    this.store = store;
    this.aliases = opts.aliases || STATUS_ALIASES;
    this.aliasValues = new Set(Object.values(this.aliases));
    this.debug = !!opts.debug;
    this.roster = null;
    this.rosterSet = new Set();
    this.rosterReady = false;
    this.queue = [];
    this.cfg = {};
    this.seen = new Set();
    this.diagnostics = [];
    this.feedAt = null;
  }

  canonical(name) {
    return canonicalBotName(name, this.aliases);
  }

  /** True when this line is new. Cross-mailbox copies of the same second + text are not new. */
  acceptLine(line) {
    const keys = lineKeys(line || {});
    if (this.seen.has(keys.source) || this.seen.has(keys.line)) return false;
    this.seen.add(keys.source);
    this.seen.add(keys.line);
    return true;
  }

  noteUnknown(name, kind) {
    const row = { name: String(name).slice(0, 80), kind, t: this.feedAt };
    this.diagnostics.push(row);
    if (this.diagnostics.length > 50) this.diagnostics.shift();
    try {
      const fn = this.debug ? console.warn : console.debug;
      fn.call(console, '[office] ignored unknown bot', row.name, kind);
    } catch { /* console may be missing */ }
  }

  pendingKnown(raw, canon) {
    return Object.prototype.hasOwnProperty.call(this.aliases, raw) || this.aliasValues.has(canon);
  }

  /**
   * @param {string[]} names roster order is kept; Main floor stays first in that list
   * @param {string} t feed timestamp, not the clock when the line was parsed
   */
  applyRoster(names, t, replay = false) {
    const list = [];
    const seen = new Set();
    const source = Array.isArray(names) ? names.slice(0, 400) : [];
    for (const n of source) {
      if (typeof n !== 'string') continue;
      const canon = this.canonical(n);
      if (!canon || seen.has(canon)) continue;
      seen.add(canon);
      list.push(canon);
    }
    this.roster = list;
    this.rosterSet = seen;
    this.rosterReady = true;
    if (typeof t === 'string' && parseTime(t) != null) this.feedAt = t;
    this.sweepCfg();
    this.store.setBotsConfig(this.cfg);
    this.flushQueue();
    this.idleFill(typeof t === 'string' ? t : new Date(0).toISOString(), replay);
    return true;
  }

  /** Looks, groups, or chat. Keys are renamed onto the canonical bot. This does not create a bot. */
  applyConfig(kind, obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
    const ranked = [];
    for (const [name, value] of Object.entries(obj).slice(0, 400)) {
      const canon = this.canonical(name);
      if (!canon) continue;
      const aliased = Object.prototype.hasOwnProperty.call(this.aliases, String(name).trim());
      ranked.push({ canon, value, aliased });
    }
    ranked.sort((a, b) => Number(b.aliased) - Number(a.aliased));
    let wrote = false;
    for (const e of ranked) {
      if (this.rosterReady && !this.rosterSet.has(e.canon)) {
        this.noteUnknown(e.canon, kind);
        continue;
      }
      const slot = this.cfg[e.canon] || (this.cfg[e.canon] = {});
      if (kind === 'floor') {
        if (typeof e.value !== 'string' || !e.value.trim()) continue;
        slot.floor = e.value.trim().slice(0, 40);
      } else if (kind === 'look') {
        slot.look = e.value;
      } else if (kind === 'chat') {
        if (typeof e.value !== 'string' || !CHAT_URL.test(e.value.trim())) continue;
        slot.chat_url = e.value.trim();
      } else continue;
      wrote = true;
    }
    if (wrote) this.store.setBotsConfig(this.cfg);
    return wrote;
  }

  applyStatus(rec, replay = false) {
    if (!rec || typeof rec.bot !== 'string') return false;
    const raw = rec.bot.trim();
    const canon = this.canonical(raw);
    if (!canon) return false;
    if (typeof rec.t === 'string' && parseTime(rec.t) != null) this.feedAt = rec.t;
    const next = { ...rec, bot: canon };
    if (!this.rosterReady) {
      if (!this.pendingKnown(raw, canon)) {
        this.noteUnknown(raw, 'status');
        return false;
      }
      this.queue.push({ rec: next, replay });
      return false;
    }
    if (!this.rosterSet.has(canon)) {
      this.noteUnknown(raw, 'status');
      return false;
    }
    return this.commitStatus(next);
  }

  flushQueue() {
    const items = this.queue.splice(0);
    items.sort((a, b) => (parseTime(a.rec.t) ?? 0) - (parseTime(b.rec.t) ?? 0));
    for (const item of items) {
      if (!this.rosterSet.has(item.rec.bot)) {
        this.noteUnknown(item.rec.bot, 'status');
        continue;
      }
      this.commitStatus(item.rec);
    }
  }

  commitStatus(rec) {
    const ms = parseTime(rec.t);
    const id = botIdFor(rec.bot);
    const bot = this.store.bots.get(id);
    if (bot && bot.lastMs != null && ms != null && ms < bot.lastMs) return false;
    this.store.apply(rec, { replay: true });
    return true;
  }

  idleFill(t, replay) {
    for (const name of this.roster) {
      if (this.store.bots.has(botIdFor(name))) continue;
      this.store.apply({ t, bot: name, status: 'idle', step: '', listed: true }, { replay });
    }
  }

  sweepCfg() {
    for (const key of Object.keys(this.cfg)) {
      if (this.rosterSet.has(key)) continue;
      // A person who already posted stays put. A name that never became a bot is not a person.
      if (this.store.bots.has(botIdFor(key))) continue;
      this.noteUnknown(key, 'config');
      delete this.cfg[key];
    }
  }
}
