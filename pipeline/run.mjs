// Upstream refresh: fetch feeds -> tag countries -> classify -> cluster into events -> score -> write JSON.
// Usage: node pipeline/run.mjs   (env: HISTORY_URL to continue from the deployed history, OUT_DIR)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import { COUNTRIES, detectCountries } from './countries.mjs';
import { classify } from './classify.mjs';

const OUT = process.env.OUT_DIR || 'public/data';
const NOW = Date.now();
const DAY = 864e5;
const KEEP_DAYS = 56;
const WEIGHT = [0, 1, 3, 9, 27, 81]; // severity -> weight; one severity-5 event outweighs ten severity-2 events
const AUTH_HOSTS = /(^|\.)(un\.org|who\.int|gdacs\.org|usgs\.gov|reliefweb\.int|icrc\.org)$/;
const FEED_HINT = { 'Premium Times': 'NG', 'Punch Nigeria': 'NG', 'Daily Nation': 'KE', Dawn: 'PK', 'Japan Times': 'JP', 'Taipei Times': 'TW',
  'Times of Israel': 'IL', 'Jerusalem Post': 'IL', 'Kyiv Independent': 'UA', Rappler: 'PH', Irrawaddy: 'MM', 'Mexico News Daily': 'MX',
  'Havana Times': 'CU', 'Colombia One': 'CO', 'Peru Reports': 'PE', 'PNG Post-Courier': 'PG', 'Ethiopia Insight': 'ET',
  'Daily Maverick': 'ZA', 'The Hindu International': 'IN', 'Times of India World': 'IN', 'Korea Herald': 'KR' };

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', htmlEntities: true, processEntities: true });
const txt = v => { if (v == null) return ''; if (typeof v === 'object') v = v['#text'] ?? v['__cdata'] ?? ''; return String(v); };
const clean = s => txt(s).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const hash = s => crypto.createHash('sha1').update(s).digest('base64url').slice(0, 10);
const hostOf = u => { try { const h = new URL(u).hostname.replace(/^www\./, '').split('.'); const n = h.length; return (n > 2 && ['co', 'com', 'org', 'gov'].includes(h[n - 2]) ? h.slice(-3) : h.slice(-2)).join('.'); } catch { return 'unknown'; } };
const dayKey = t => new Date(t).toISOString().slice(0, 10);

function linkOf(e) {
  if (e.link && typeof e.link === 'string') return e.link;
  const L = Array.isArray(e.link) ? e.link : e.link ? [e.link] : [];
  const alt = L.find(l => l['@_rel'] === 'alternate') || L[0];
  return alt?.['@_href'] || txt(e.guid) || '';
}

async function fetchFeed(f) {
  const r = await fetch(f.url, { headers: { 'user-agent': 'Mozilla/5.0 UpstreamBot/1.0', accept: 'application/rss+xml,application/atom+xml,application/xml,text/xml,*/*' }, signal: AbortSignal.timeout(20000), redirect: 'follow' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const x = xml.parse(await r.text());
  const raw = x?.rss?.channel?.item || x?.feed?.entry || x?.['rdf:RDF']?.item || [];
  const arr = (Array.isArray(raw) ? raw : [raw]).filter(Boolean);
  const out = [];
  for (const e of arr) {
    const title = clean(e.title), u = linkOf(e);
    const date = new Date(txt(e.pubDate) || txt(e.published) || txt(e.updated) || txt(e['dc:date']) || NOW);
    if (!title || !/^https?:/.test(u) || isNaN(date)) { out.push({ bad: 1 }); continue; }
    out.push({ title, u, t: Math.min(date.getTime(), NOW), summary: clean(e.description || e.summary || e['content:encoded'] || '') });
  }
  return out;
}

// ── 1. history (items from earlier runs) ─────────────────────────────────────
let hist = { since: dayKey(NOW), items: [] };
try {
  if (process.env.HISTORY_URL) {
    const r = await fetch(process.env.HISTORY_URL, { signal: AbortSignal.timeout(30000) });
    if (r.ok) hist = await r.json();
  } else if (fs.existsSync(path.join(OUT, 'history.json'))) hist = JSON.parse(fs.readFileSync(path.join(OUT, 'history.json'), 'utf8'));
} catch (e) { console.warn('history load failed, starting fresh:', e.message); }
const byId = new Map(hist.items.map(i => [i.id, i]));

// ── 2. fetch ─────────────────────────────────────────────────────────────────
const feeds = JSON.parse(fs.readFileSync(new URL('./feeds.json', import.meta.url)));
const health = [];
let inWindow = 0, bad = 0, fresh = 0;
const queue = [...feeds];
await Promise.all(Array.from({ length: 12 }, async () => {
  while (queue.length) {
    const f = queue.shift();
    try {
      const items = await fetchFeed(f);
      let used = 0;
      for (const it of items) {
        if (it.bad) { bad++; continue; }
        if (NOW - it.t > KEEP_DAYS * DAY) continue;
        if (NOW - it.t <= 7 * DAY) inWindow++;
        const id = hash(it.u);
        if (byId.has(id)) continue;
        let cc = detectCountries(it.title).slice(0, 3);
        if (!cc.length) cc = detectCountries(it.summary.slice(0, 300)).slice(0, 2);
        if (!cc.length && FEED_HINT[f.name]) cc = [FEED_HINT[f.name]];
        if (!cc.length) continue;
        const { s, th } = classify(it.title, it.summary);
        if (s < 2) continue;
        byId.set(id, { id, t: it.title, d: it.t, u: it.u, f: f.name, h: hostOf(it.u), cc, s, th });
        fresh++; used++;
      }
      health.push({ name: f.name, ok: true, items: items.length, used });
    } catch (e) { health.push({ name: f.name, ok: false, err: e.message }); }
  }
}));
const feedsOk = health.filter(h => h.ok).length;
console.log(`feeds ok ${feedsOk}/${feeds.length}, new tagged items ${fresh}, bad items ${bad}`);
if (feedsOk < feeds.length * 0.4) { console.error('too many feeds failed; keeping previous output'); process.exit(1); }

const items = [...byId.values()].filter(i => NOW - i.d <= KEEP_DAYS * DAY);

// ── 3. cluster into unique events (per country) ──────────────────────────────
const STOP = new Set('the and for with from that this have has will after over into about than their they were been are was its not but who how what when where why says said say new more news amid as of in on at to by is it be an a or up out off could would may after before during against'.split(' '));
const toks = t => new Set(t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w)));
function similar(A, B) {
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n >= 3 && (n / Math.min(A.size, B.size) >= 0.5 || n / (A.size + B.size - n) >= 0.4);
}
const perCountry = {};
for (const it of items) for (const cc of it.cc) if (COUNTRIES[cc]) (perCountry[cc] ||= []).push(it);

const events = {};
for (const [cc, list] of Object.entries(perCountry)) {
  list.sort((a, b) => a.d - b.d);
  const cl = [];
  for (const it of list) {
    const T = toks(it.t);
    let c = null;
    for (let i = cl.length - 1; i >= 0 && !c; i--) {
      if (it.d - cl[i].last > 3 * DAY) continue;
      if (cl[i].items.some(x => similar(T, x.T))) c = cl[i];
    }
    if (!c) { c = { items: [], last: it.d }; cl.push(c); }
    c.items.push({ ...it, T }); c.last = it.d;
  }
  events[cc] = cl.map(c => {
    const outlets = new Set(c.items.map(x => x.h));
    const conf = [...outlets].reduce((n, h) => n + (AUTH_HOSTS.test(h) ? 2 : 1), 0);
    let s = Math.max(...c.items.map(x => x.s));
    if (s === 5 && conf < 2) s = 4; // one source alone cannot make a severity-5 event
    const rep = c.items.filter(x => x.s === Math.max(...c.items.map(y => y.s))).sort((a, b) => a.d - b.d)[0];
    const themes = {}; c.items.forEach(x => { themes[x.th] = (themes[x.th] || 0) + 1; });
    return { id: hash(cc + rep.id), cc, h: rep.t, u: rep.u, s, th: Object.entries(themes).sort((a, b) => b[1] - a[1])[0][0],
      d: c.items[0].d, last: c.last, o: outlets.size, conf, r: c.items.length, src: rep.f };
  });
}

// ── 4. score: urgency-weighted load, own-baseline comparison, band ───────────
const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const sinceMs = new Date(hist.since + 'T00:00:00Z').getTime();
const fullWeeks = Math.floor((NOW - sinceMs) / (7 * DAY)) - 1; // complete weeks observed before the current one
const baselineReady = fullWeeks >= 2;
const sumW = (evs, from, to) => evs.filter(e => e.d > NOW - to * DAY && e.d <= NOW - from * DAY).reduce((n, e) => n + WEIGHT[e.s], 0);

const THEME_PRAYER = {
  conflict: ['Pray for peace and protection for civilians in {c}.', 'Pray for those caught in the violence in {c}, and for wisdom among leaders seeking peace.'],
  disaster: ['Pray for families who lost homes and loved ones in {c}, and for rescue and relief teams.', 'Pray for comfort and provision for people hit by disaster in {c}.'],
  health: ['Pray for the sick and for health workers responding to the outbreak in {c}.', 'Pray for healing and for containment of disease in {c}.'],
  persecution: ['Pray for believers facing persecution in {c}: for safety, endurance, and peace in their hearts.', 'Pray for the church in {c}, and for justice for those who are suffering for their faith.'],
  hunger: ['Pray for families facing hunger in {c}, and for food to reach those who need it.', 'Pray for provision and for aid workers serving the hungry in {c}.'],
  displacement: ['Pray for people who have had to leave their homes in {c}: for shelter, safety, and welcome.', 'Pray for refugees and displaced families connected to {c}.'],
  unrest: ['Pray for calm and safety in {c}, and for leaders to listen and act with justice.', 'Pray for peace in the streets of {c} and for wisdom for those in authority.'],
  politics: ['Pray for wise and just leadership in {c}.', 'Pray for good decisions and stability for the people of {c}.'],
  other: ['Pray for the people of {c}.']
};

const SPAN = 21;
const dayList = Array.from({ length: SPAN }, (_, i) => dayKey(NOW - (SPAN - 1 - i) * DAY));
const countries = [];
for (const [cc, evs] of Object.entries(events)) {
  const c14 = evs.filter(e => e.d > NOW - 14 * DAY);
  if (!c14.length) continue;
  const w7 = evs.filter(e => e.d > NOW - 7 * DAY);
  const cur = sumW(evs, 0, 7), prev = sumW(evs, 7, 14);
  const load = Math.log(1 + cur);
  let z = null;
  if (baselineReady) {
    const weeks = Array.from({ length: Math.min(8, fullWeeks) }, (_, k) => Math.log(1 + sumW(evs, 7 * (k + 1), 7 * (k + 2))));
    const med = median(weeks), mad = median(weeks.map(x => Math.abs(x - med)));
    z = +((load - med) / Math.max(1.4826 * mad, 0.35)).toFixed(2);
  }
  const s5 = w7.filter(e => e.s === 5 && e.conf >= 2).length;
  const s4 = w7.filter(e => e.s >= 4).length;
  const s3 = w7.filter(e => e.s >= 3).length;
  let band = w7.length ? 2 : 1;
  if (s3 >= 3 || (z != null && z > 1)) band = 3;
  if (s4 >= 1 || (z != null && z > 2)) band = 4;
  if (s5 >= 1 || (z != null && z > 3)) band = 5;
  const top = [...evs].sort((a, b) => b.s - a.s || b.conf - a.conf || b.last - a.last)
    .filter(e => e.last > NOW - 14 * DAY).slice(0, 8)
    .map(e => ({ id: e.id, h: e.h, u: e.u, s: e.s, th: e.th, o: e.o, r: e.r, d: dayKey(e.d), src: e.src }));
  const series = { n: dayList.map(() => 0), s: dayList.map(() => 0) };
  for (const e of evs) { const i = dayList.indexOf(dayKey(e.d)); if (i >= 0) { series.n[i]++; series.s[i] = Math.max(series.s[i], e.s); } }
  let trend = null;
  if (fullWeeks >= 1) trend = prev === 0 ? { dir: cur > 0 ? 'up' : 'flat', pct: null } : (p => ({ dir: p > 10 ? 'up' : p < -10 ? 'down' : 'flat', pct: p }))(Math.round((cur - prev) / prev * 100));
  const lead = top[0];
  const tpl = THEME_PRAYER[lead.th] || THEME_PRAYER.other;
  countries.push({
    cc, k: COUNTRIES[cc].k, fl: COUNTRIES[cc].fl, region: COUNTRIES[cc].region, band, load: +load.toFixed(2), z,
    events7: w7.length, reports7: w7.reduce((n, e) => n + e.r, 0), maxSev: Math.max(...w7.map(e => e.s), 0), trend, series, top,
    prayer: { text: tpl[parseInt(hash(cc + dayKey(NOW)).charCodeAt(0)) % tpl.length].replace('{c}', COUNTRIES[cc].k), eventId: lead.id, th: lead.th }
  });
}
countries.sort((a, b) => b.band - a.band || b.load - a.load || (b.z ?? 0) - (a.z ?? 0));
countries.forEach((c, i) => { c.rank = i + 1; });

const urgent = Object.values(events).flat()
  .filter(e => e.s >= 4 && e.last > NOW - 3 * DAY && e.conf >= 2)
  .filter((e, i, a) => a.findIndex(x => x.u === e.u) === i)
  .sort((a, b) => b.s - a.s || b.conf - a.conf || b.last - a.last)
  .map(e => ({ id: e.id, cc: e.cc, c: COUNTRIES[e.cc].k, fl: COUNTRIES[e.cc].fl, h: e.h, u: e.u, s: e.s, th: e.th, o: e.o, d: dayKey(e.last), src: e.src }))
  .slice(0, 40);

const brief = {
  generated: new Date(NOW).toISOString(), window: 7, baselineReady, historySince: hist.since, fullWeeks,
  feeds: { total: feeds.length, ok: feedsOk }, itemsInWindow: inWindow, tracked: items.length,
  top5: countries.slice(0, 5).map(c => c.cc), urgent, countries
};
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'brief.json'), JSON.stringify(brief));
fs.writeFileSync(path.join(OUT, 'history.json'), JSON.stringify({ since: hist.since, items }));
fs.writeFileSync(path.join(OUT, 'health.json'), JSON.stringify({ generated: brief.generated, feeds: health }));
console.log(`countries ${countries.length}, urgent ${urgent.length}, top5 ${brief.top5.join(',')}, baseline ${baselineReady}`);
console.log(countries.slice(0, 12).map(c => `${c.k} b${c.band} load${c.load} ev${c.events7} rep${c.reports7} max${c.maxSev}`).join('\n'));
