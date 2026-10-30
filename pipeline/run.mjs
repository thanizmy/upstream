// Upstream refresh: fetch feeds -> tag countries -> classify -> cluster into events -> score -> write JSON.
// Usage: node pipeline/run.mjs   (env: HISTORY_URL to continue from the deployed history, OUT_DIR)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import { COUNTRIES, detectCountries } from './countries.mjs';
import { classify } from './classify.mjs';
import { classifyLocal, supports } from './classify-local.mjs';

const OUT = process.env.OUT_DIR || 'public/data';
const NOW = Date.now();
const DAY = 864e5;
const KEEP_DAYS = 70;
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
  const buf = Buffer.from(await r.arrayBuffer());
  const enc = (/encoding=["']([w-]+)/i.exec(buf.subarray(0, 200).toString('latin1')) || /charset=([w-]+)/i.exec(r.headers.get('content-type') || '') || [])[1] || 'utf-8';
  let body; try { body = new TextDecoder(enc).decode(buf); } catch { body = buf.toString('utf8'); }
  const x = xml.parse(body);
  const raw = x?.rss?.channel?.item || x?.feed?.entry || x?.['rdf:RDF']?.item || [];
  const arr = (Array.isArray(raw) ? raw : [raw]).filter(Boolean);
  const out = [];
  for (const e of arr) {
    const title = clean(e.title), u = linkOf(e);
    const date = new Date(txt(e.pubDate) || txt(e.published) || txt(e.updated) || txt(e['dc:date']) || NOW);
    if (!title || !/^https?:/.test(u) || isNaN(date)) { out.push({ bad: 1 }); continue; }
    const imgRaw = e['media:thumbnail']?.['@_url'] || (Array.isArray(e['media:content']) ? e['media:content'][0] : e['media:content'])?.['@_url'] || (/image/.test(e.enclosure?.['@_type'] || '') ? e.enclosure['@_url'] : '');
    out.push({ title, u, t: Math.min(date.getTime(), NOW), img: /^https:/.test(imgRaw || '') ? imgRaw : '', summary: clean(e.description || e.summary || e['content:encoded'] || '') });
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
hist.items = hist.items.filter(i => !i.t.includes('�')); // drop headlines stored before charset decoding was added
const byId = new Map(hist.items.map(i => [i.id, i]));

// ── 2. fetch ─────────────────────────────────────────────────────────────────
const feeds = [...JSON.parse(fs.readFileSync(new URL('./feeds.json', import.meta.url))), ...JSON.parse(fs.readFileSync(new URL('./feeds.local.json', import.meta.url))).filter(f => supports(f.lang))];
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
        if (!cc.length && (f.cc || FEED_HINT[f.name])) cc = [f.cc || FEED_HINT[f.name]];
        if (!cc.length) continue;
        const lang = f.lang || 'en';
        const { s, th } = lang === 'en' ? classify(it.title, it.summary) : classifyLocal(it.title, it.summary, lang);
        if (s < 2) continue;
        byId.set(id, { id, t: it.title, d: it.t, u: it.u, f: f.name, h: hostOf(it.u), cc, s, th, ...(lang !== 'en' ? { l: lang } : {}), ...(s >= 4 && it.img ? { i: it.img } : {}) });
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
const STOP = new Set('los las del que con por para una uno sus más como este esta tras sobre entre desde les des une pour dans par sur avec aux est sont plus cette après contre dos das uma mais após der die das und mit von für auf den dem ein eine nach über bei zum zur ist sind the and for with from that this have has will after over into about than their they were been are was its not but who how what when where why says said say new more news amid as of in on at to by is it be an a or up out off could would may after before during against'.split(' '));
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
    const smax = Math.max(...c.items.map(x => x.s));
    let s = smax;
    if (s === 5 && conf < 2) s = 4; // one source alone cannot make a severity-5 event
    const rep = c.items.filter(x => x.s === smax).sort((a, b) => a.d - b.d)[0];
    const themes = {}; c.items.forEach(x => { themes[x.th] = (themes[x.th] || 0) + 1; });
    return { id: hash(cc + rep.id), cc, h: rep.t, u: rep.u, s, th: Object.entries(themes).sort((a, b) => b[1] - a[1])[0][0],
      d: c.items[0].d, last: c.last, o: outlets.size, conf, r: c.items.length, src: rep.f, ...(rep.l ? { l: rep.l } : {}), img: c.items.map(x => x.i).find(Boolean) || '',
      hosts: [...outlets], T: rep.T,
      items: c.items.sort((a, b) => b.d - a.d).map(x => ({ t: x.t, u: x.u, f: x.f, d: dayKey(x.d), s: x.s, ...(x.l ? { l: x.l } : {}) })) };
  });
}

// ── 4. score ─────────────────────────────────────────────────────────────────
const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const sinceMs = new Date(hist.since + 'T00:00:00Z').getTime();
const fullWeeks = Math.floor((NOW - sinceMs) / (7 * DAY)) - 1;
const baselineReady = fullWeeks >= 2;

const spanDays = Math.max(1, Math.round((NOW - sinceMs) / DAY)); // days since this deployment began collecting
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
const SPAN = 30;
const dayList = Array.from({ length: SPAN }, (_, i) => dayKey(NOW - (SPAN - 1 - i) * DAY));

/** Stats for one country over the last `days` days. */
function windowStats(evs, days, z) {
  const w = evs.filter(e => e.d > NOW - days * DAY);
  const cnt = [0, 0, 0, 0, 0, 0]; w.forEach(e => cnt[e.s]++);
  const th = {}; w.forEach(e => { th[e.th] = (th[e.th] || 0) + 1; });
  const hosts = new Set(); w.forEach(e => e.hosts.forEach(h => hosts.add(h)));
  const s5 = w.filter(e => e.s === 5 && e.conf >= 2).length;
  let band = w.length ? 2 : 1;
  if (days <= 7) {
    if (cnt[3] + cnt[4] + cnt[5] >= 3 || (z != null && z > 1)) band = 3;
    if (cnt[4] + cnt[5] >= 1 || (z != null && z > 2)) band = 4;
    if (s5 >= 1 || (z != null && z > 3)) band = 5;
  } else { // monthly: a single severe event is common over 30 days, so the bar is higher
    if (cnt[3] + cnt[4] + cnt[5] >= 6) band = 3;
    if (cnt[4] + cnt[5] >= 2) band = 4;
    if (s5 >= 1 && cnt[4] + cnt[5] >= 3) band = 5;
  }
  const cur = sumW(evs, 0, days);
  // change: weekly compares with the week before (or the last 3 days with the 4 before while history is short); monthly compares 15 vs 15 days
  let chg = null;
  const rate = (a, b) => sumW(evs, a, b) / (b - a);
  const mk = (cu, pr, basis) => ({ basis, pct: pr > 0 ? Math.round((cu - pr) / pr * 100) : null, isNew: pr === 0 && cu > 0, cur: +cu.toFixed(1), prev: +pr.toFixed(1) });
  if (days <= 7) chg = fullWeeks >= 1 ? mk(rate(0, 7), rate(7, 14), 'week') : mk(rate(0, 3), rate(3, 7), '3d');
  else if (spanDays >= 28) chg = mk(rate(0, 15), rate(15, 30), '15d');
  if (chg) chg.dir = chg.isNew || (chg.pct != null && chg.pct > 10) ? 'up' : chg.pct != null && chg.pct < -10 ? 'down' : 'flat';
  return {
    ev: w.length, rep: w.reduce((n, e) => n + e.r, 0), src: hosts.size, load: +Math.log(1 + cur).toFixed(2), cur,
    maxSev: Math.max(0, ...w.map(e => e.s)), band, sev: cnt.slice(1), th, chg
  };
}
const topOf = (evs, days, n) => [...evs].filter(e => e.last > NOW - days * DAY)
  .sort((a, b) => b.s - a.s || b.conf - a.conf || b.last - a.last).slice(0, n)
  .map(e => ({ id: e.id, h: e.h, u: e.u, s: e.s, th: e.th, o: e.o, r: e.r, d: dayKey(e.d), src: e.src, ...(e.l ? { l: e.l } : {}) }));

const countries = [];
for (const [cc, evs] of Object.entries(events)) {
  if (!evs.some(e => e.d > NOW - 30 * DAY)) continue;
  const cur7 = sumW(evs, 0, 7), load7 = Math.log(1 + cur7);
  let z = null;
  if (baselineReady) {
    const weeks = Array.from({ length: Math.min(8, fullWeeks) }, (_, k) => Math.log(1 + sumW(evs, 7 * (k + 1), 7 * (k + 2))));
    const med = median(weeks), mad = median(weeks.map(x => Math.abs(x - med)));
    z = +((load7 - med) / Math.max(1.4826 * mad, 0.35)).toFixed(2);
  }
  const w7 = windowStats(evs, 7, z), w30 = windowStats(evs, 30, null);
  w7.z = z; w7.top = topOf(evs, 14, 8); w30.top = topOf(evs, 30, 12);
  w7.thin = w7.band >= 4 && w7.src <= 2; w30.thin = w30.band >= 4 && w30.src <= 2;
  const series = { n: dayList.map(() => 0), s: dayList.map(() => 0) };
  for (const e of evs) { const i = dayList.indexOf(dayKey(e.d)); if (i >= 0) { series.n[i]++; series.s[i] = Math.max(series.s[i], e.s); } }
  const lead = (w7.top[0] || w30.top[0]);
  const tpl = THEME_PRAYER[lead.th] || THEME_PRAYER.other;
  const c = COUNTRIES[cc];
  countries.push({
    cc, k: c.k, fl: c.fl, region: c.region, ll: c.ll, w7, w30, series,
    prayer: { text: tpl[hash(cc + dayKey(NOW)).charCodeAt(0) % tpl.length].replace('{c}', c.k), eventId: lead.id, th: lead.th }
  });
}
const rankBy = win => countries.slice().sort((a, b) => b[win].band - a[win].band || b[win].load - a[win].load || (b.w7.z ?? 0) - (a.w7.z ?? 0)).map(c => c.cc);
const r7 = rankBy('w7'), r30 = rankBy('w30');
countries.forEach(c => { c.w7.rank = r7.indexOf(c.cc) + 1; c.w30.rank = r30.indexOf(c.cc) + 1; });
countries.sort((a, b) => a.w7.rank - b.w7.rank);

// ── 5. headline figures, stories, movement, gaps ─────────────────────────────
const allEv = Object.values(events).flat();
const cname = cc => COUNTRIES[cc].k;
const slim = e => ({ id: e.id, cc: e.cc, c: cname(e.cc), fl: COUNTRIES[e.cc].fl, h: e.h, u: e.u, s: e.s, th: e.th, o: e.o, d: dayKey(e.last), src: e.src, ...(e.l ? { l: e.l } : {}) });
function urgentSince(days, n) {
  return allEv.filter(e => e.s >= 4 && e.last > NOW - days * DAY && e.conf >= 2)
    .sort((a, b) => b.s - a.s || b.conf - a.conf || b.last - a.last)
    .filter((e, i, a) => a.findIndex(x => x.u === e.u) === i).map(slim).slice(0, n);
}
function stories(days) {
  const out = [], seenC = new Set();
  const pool = allEv.filter(e => e.d > NOW - days * DAY && e.conf >= 2)
    .sort((a, b) => b.s - a.s || b.conf - a.conf || b.r - a.r);
  for (const e of pool) {
    if (out.length >= 5) break;
    if (seenC.has(e.cc) || out.some(o => o.u === e.u || similar(e.T, toks(o.h)))) continue;
    seenC.add(e.cc); out.push({ ...slim(e), r: e.r, img: e.img || '' });
  }
  return out;
}
function movement(a, b, label) {
  // a-b = recent days, b-c = baseline days
  const rows = countries.map(c => {
    const evs = events[c.cc], cur = sumW(evs, 0, a) / a, prev = sumW(evs, a, b) / (b - a);
    return { cc: c.cc, k: c.k, fl: c.fl, cur: +cur.toFixed(1), prev: +prev.toFixed(1), pct: prev > 0 ? Math.round((cur - prev) / prev * 100) : null, isNew: prev === 0 && cur > 0, n: c.w7.ev };
  }).filter(r => Math.max(r.cur, r.prev) >= 3);
  const up = rows.filter(r => r.isNew || (r.pct != null && r.pct > 15)).sort((x, y) => (y.isNew - x.isNew) || ((y.pct ?? 0) - (x.pct ?? 0)) || y.cur - x.cur).slice(0, 6);
  const down = rows.filter(r => r.pct != null && r.pct < -15).sort((x, y) => x.pct - y.pct).slice(0, 6);
  const tcount = (from, to) => { const o = {}; allEv.filter(e => e.d > NOW - to * DAY && e.d <= NOW - from * DAY).forEach(e => { o[e.th] = (o[e.th] || 0) + 1 / (to - from); }); return o; };
  const tc = tcount(0, a), tp = tcount(a, b);
  const themes = Object.keys({ ...tc, ...tp }).filter(t => t !== 'other' && t !== 'politics')
    .map(t => ({ th: t, cur: +(tc[t] || 0).toFixed(1), prev: +(tp[t] || 0).toFixed(1) }))
    .filter(t => Math.max(t.cur, t.prev) >= 1).map(t => ({ ...t, pct: t.prev > 0 ? Math.round((t.cur - t.prev) / t.prev * 100) : null }))
    .sort((x, y) => Math.abs(y.pct ?? 999) - Math.abs(x.pct ?? 999)).slice(0, 4);
  const sudden = allEv.filter(e => e.s >= 4 && e.conf >= 2 && e.d > NOW - 2 * DAY
      && !events[e.cc].some(x => x.s >= 4 && x.d <= NOW - 2 * DAY && x.d > NOW - b * DAY))
    .sort((x, y) => y.s - x.s || y.conf - x.conf).filter((e, i, arr) => arr.findIndex(x => x.cc === e.cc) === i).map(slim).slice(0, 6);
  return { basis: label, up, down, themes, sudden };
}
const moved = {
  w7: fullWeeks >= 1 ? movement(7, 14, 'this week vs last week') : movement(3, 7, 'the last 3 days vs the 4 before'),
  w30: spanDays >= 28 ? movement(15, 30, 'the last 15 days vs the 15 before') : null
};
const heldBack = (days) => allEv.filter(e => e.s >= 4 && e.conf < 2 && e.last > NOW - days * DAY).length;
const sources = new Set(items.map(i => i.h)).size;
const kpi = days => {
  const k = days === 7 ? 'w7' : 'w30';
  return { watched: countries.filter(c => c[k].ev > 0).length, hot: countries.filter(c => c[k].band >= 4).length, events: countries.reduce((n, c) => n + c[k].ev, 0),
    reports: countries.reduce((n, c) => n + c[k].rep, 0), held: heldBack(days), urgent: urgentSince(days === 7 ? 3 : 30, 200).length };
};
const gaps = countries.filter(c => c.w7.thin).sort((a, b) => b.w7.band - a.w7.band || a.w7.src - b.w7.src).slice(0, 10).map(c => c.cc);

const brief = {
  generated: new Date(NOW).toISOString(), baselineReady, historySince: hist.since, fullWeeks, spanDays,
  feeds: { total: feeds.length, ok: feedsOk, hostsSeen: sources, local: feeds.filter(f => f.lang).length, localOk: health.filter(h => h.ok && feeds.find(f => f.name === h.name)?.lang).length, langs: [...new Set(feeds.map(f => f.lang || 'en'))] }, itemsInWindow: inWindow, tracked: items.length,
  top5: r7.slice(0, 5), kpi: { w7: kpi(7), w30: kpi(30) },
  urgent: { w7: urgentSince(3, 40), w30: urgentSince(30, 60) },
  stories: { w7: stories(7), w30: stories(30) }, moved, gaps, countries
};

// ── 6. write ─────────────────────────────────────────────────────────────────
fs.mkdirSync(OUT, { recursive: true });
fs.rmSync(path.join(OUT, 'c'), { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'c'), { recursive: true });
for (const c of countries) {
  const evs = events[c.cc].filter(e => e.last > NOW - 40 * DAY).sort((a, b) => b.last - a.last);
  fs.writeFileSync(path.join(OUT, 'c', c.cc + '.json'), JSON.stringify({
    cc: c.cc, generated: brief.generated,
    events: evs.map(e => ({ id: e.id, h: e.h, u: e.u, s: e.s, th: e.th, o: e.o, r: e.r, d: dayKey(e.d), last: dayKey(e.last), src: e.src, ...(e.l ? { l: e.l } : {}), items: e.items }))
  }));
}
fs.writeFileSync(path.join(OUT, 'brief.json'), JSON.stringify(brief));
fs.writeFileSync(path.join(OUT, 'history.json'), JSON.stringify({ since: hist.since, items }));
fs.writeFileSync(path.join(OUT, 'health.json'), JSON.stringify({ generated: brief.generated, feeds: health }));
console.log(`countries ${countries.length}, urgent3d ${brief.urgent.w7.length}, urgent30d ${brief.urgent.w30.length}, stories ${brief.stories.w7.length}, top5 ${brief.top5.join(',')}, baseline ${baselineReady}, span ${spanDays}d`);
console.log('moved up:', moved.w7.up.map(r => r.k + ' ' + (r.pct ?? 'new')).join(', '), '| themes:', moved.w7.themes.map(t => t.th + ' ' + t.pct).join(', '), '| sudden:', moved.w7.sudden.map(e => e.c).join(', '));
