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
// Scoring model v2. Severity is impact-based and the same for every country; only events of severity 3 to 5 carry the urgency score.
//   S = 8*(1+ln n3) + 30*(1+ln n4) + 100*(1+ln n5)   (a tier with no events adds nothing)
// Weekly level from fixed thresholds on S (10 / 30 / 100); the monthly level uses four times those thresholds on the sum of four weekly scores.
const TW = { 3: 8, 4: 30, 5: 100 }, SOLO_CAP = 5, MODEL_V = 3;
const T3_CAP = 25; // severity-3 events alone can reach Elevated but never High: many minor incidents are not instability
const THRESH = [10, 30, 100];
const bandOf = (S, k = 1) => S <= 0 ? 1 : S < THRESH[0] * k ? 2 : S < THRESH[1] * k ? 3 : S < THRESH[2] * k ? 4 : 5;
const AUTH_HOSTS = /(^|\.)(un\.org|who\.int|gdacs\.org|usgs\.gov|reliefweb\.int|icrc\.org)$/;
// World / international sections and multi-country services say nothing about the outlet's own country, so a headline with no country in it is skipped, not filed under the home country.
const WORLD_RE = /(the-gioi|thegioi|th\u1ebf gi\u1edbi|world|mundo|internacional|international|monde|\bwelt\b|ausland|esteri|mondo|bbci\.co\.uk|dw\.com|rfi\.fr|france24|euronews|dunya|\u56fd\u9645|\u570b\u969b|\u56fd\u969b|\ubbfc\uc81c|\u0432\u0441\u0435 \u043d\u043e\u0432\u043e\u0441\u0442\u0438)/i;
const isWorld = f => WORLD_RE.test(f.name + ' ' + f.url);
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
  let body; try { body = new TextDecoder(enc, { fatal: true }).decode(buf); } catch { try { body = new TextDecoder('windows-1252').decode(buf); } catch { body = buf.toString('utf8'); } } // a feed may declare one charset and send another
  const x = xml.parse(body);
  const raw = x?.rss?.channel?.item || x?.feed?.entry || x?.['rdf:RDF']?.item || [];
  const arr = (Array.isArray(raw) ? raw : [raw]).filter(Boolean);
  const out = [];
  for (const e of arr) {
    const title = clean(e.title), u = linkOf(e);
    const ds = txt(e.pubDate) || txt(e.published) || txt(e.updated) || txt(e['dc:date']), date = new Date(ds);
    // an item with no usable date, or dated in the future, is not counted: it must not pass as published just now
    if (!title || !/^https?:/.test(u) || !ds || isNaN(date) || date.getTime() > NOW + DAY) { out.push({ bad: 1 }); continue; }
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
hist.items = hist.items.filter(i => !i.t.includes('�')); // headlines stored before charset handling was fixed
for (const i of hist.items) if (i.v !== MODEL_V) {
  const r = i.l ? (supports(i.l) ? classifyLocal(i.t, '', i.l) : { s: i.s, th: i.th }) : classify(i.t, '');
  i.s = r.s; i.th = r.th; i.v = MODEL_V;
}
hist.items = hist.items.filter(i => i.s >= 2);
const byId = new Map(hist.items.map(i => [i.id, i]));

// ── 2. fetch ─────────────────────────────────────────────────────────────────
const feeds = [...JSON.parse(fs.readFileSync(new URL('./feeds.json', import.meta.url))), ...JSON.parse(fs.readFileSync(new URL('./feeds.en2.json', import.meta.url))), ...JSON.parse(fs.readFileSync(new URL('./feeds.local.json', import.meta.url))), ...JSON.parse(fs.readFileSync(new URL('./feeds.local2.json', import.meta.url)))].filter((f, i, a) => (!f.lang || supports(f.lang)) && a.findIndex(g => g.url === f.url) === i); // one entry per URL
const health = [];
let inWindow = 0, bad = 0, fresh = 0;
const queue = [...feeds];
await Promise.all(Array.from({ length: 12 }, async () => {
  while (queue.length) {
    const f = queue.shift();
    try {
      const items = await fetchFeed(f);
      // the registry rule is enforced on every run, not only when a feed is added: a feed that has gone quiet or stopped parsing no longer counts as live
      const dated = items.filter(i => !i.bad), newest = Math.max(0, ...dated.map(i => i.t));
      if (dated.length < 3 || NOW - newest > 45 * DAY) { health.push({ name: f.name, ok: false, err: dated.length < 3 ? 'fewer than 3 valid items' : 'stale: newest item ' + Math.round((NOW - newest) / DAY) + ' days old' }); continue; }
      let used = 0;
      for (const it of items) {
        if (it.bad) { bad++; continue; }
        if (NOW - it.t > KEEP_DAYS * DAY) continue;
        if (NOW - it.t <= 7 * DAY) inWindow++;
        const id = hash(it.u);
        if (byId.has(id)) continue;
        let cc = detectCountries(it.title).slice(0, 3);
        if (!cc.length) cc = detectCountries(it.summary.slice(0, 300)).slice(0, 2);
        if (!cc.length && !isWorld(f) && (f.cc || FEED_HINT[f.name])) cc = [f.cc || FEED_HINT[f.name]];
        if (!cc.length) continue;
        const lang = f.lang || 'en';
        const { s, th } = lang === 'en' ? classify(it.title, it.summary) : classifyLocal(it.title, it.summary, lang);
        if (s < 2) continue;
        byId.set(id, { id, t: it.title, d: it.t, u: it.u, f: f.name, h: hostOf(it.u), cc, s, th, v: MODEL_V, ...(lang !== 'en' ? { l: lang } : {}), ...(s >= 4 && it.img ? { i: it.img } : {}) });
        fresh++; used++;
      }
      health.push({ name: f.name, ok: true, items: items.length, used });
    } catch (e) { health.push({ name: f.name, ok: false, err: e.message }); }
  }
}));
const feedsOk = health.filter(h => h.ok).length;
console.log(`feeds ok ${feedsOk}/${feeds.length}, new tagged items ${fresh}, bad items ${bad}`);
if (feedsOk < feeds.length * 0.4) { console.error('too many feeds failed; keeping previous output'); process.exit(1); }

// local-language headlines are re-placed each run, so improvements to country names also fix items stored earlier
const homeByFeed = Object.fromEntries(feeds.filter(f => !isWorld(f)).map(f => [f.name, f.cc || FEED_HINT[f.name]]));
for (const it of byId.values()) if (it.l) { const cc = detectCountries(it.t).slice(0, 3); it.cc = cc.length ? cc : homeByFeed[it.f] ? [homeByFeed[it.f]] : []; }
const items = [...byId.values()].filter(i => NOW - i.d <= KEEP_DAYS * DAY);
// ── 3. cluster into unique events (per country) ──────────────────────────────
const STOP = new Set('los las del que con por para una uno sus más como este esta tras sobre entre desde les des une pour dans par sur avec aux est sont plus cette après contre dos das uma mais após der die das und mit von für auf den dem ein eine nach über bei zum zur ist sind the and for with from that this have has will after over into about than their they were been are was its not but who how what when where why says said say new more news amid as of in on at to by is it be an a or up out off could would may after before during against'.split(' '));
const toks = t => new Set(t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w)));
function similar(A, B) {
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n >= 3 && (n / Math.min(A.size, B.size) >= 0.5 || n / (A.size + B.size - n) >= 0.4);
}
// where each outlet is based (set per feed, or by the FEED_HINT list); "local" means an outlet from the event's own country
const feedHome = {}; for (const f of feeds) { const hc = f.cc || FEED_HINT[f.name]; if (hc) feedHome[f.name] = hc; }
const fold = s => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
/** Names and numbers in a headline, accent-folded, so the same event in two languages can be recognised. */
function keysOf(t) {
  const out = new Set();
  t.split(/[\s,;:()"'\u2018\u2019\u201C\u201D\-\u2013\u2014]+/).forEach((w, i) => {
    const f = fold(w.replace(/[^\p{L}\p{N}]/gu, '')); if (!f) return;
    if (/^\d{2,}$/.test(f)) { const n = +f; if (n < 1900 || n > 2100) out.add(f); }
    else if (i > 0 && /^\p{Lu}/u.test(w) && f.length > 3) out.add(f);
  });
  return out;
}
const sameAcrossLanguages = (a, b) => {
  if ((a.l || 'en') === (b.l || 'en') || a.th !== b.th || Math.abs(a.d - b.d) > 2 * DAY) return false;
  let n = 0; for (const k of a.K) if (b.K.has(k)) n++;
  return n >= 2;
};
const perCountry = {};
for (const it of items) for (const cc of it.cc) if (COUNTRIES[cc]) (perCountry[cc] ||= []).push(it);

const events = {};
for (const [cc, list] of Object.entries(perCountry)) {
  list.sort((a, b) => a.d - b.d);
  const cl = [];
  for (const it of list) {
    const T = toks(it.t), K = keysOf(it.t);
    let c = null;
    for (let i = cl.length - 1; i >= 0 && !c; i--) {
      if (it.d - cl[i].last > 3 * DAY) continue;
      if (cl[i].items.some(x => similar(T, x.T) || sameAcrossLanguages({ ...it, K }, x))) c = cl[i];
    }
    if (!c) { c = { items: [], last: it.d }; cl.push(c); }
    c.items.push({ ...it, T, K }); c.last = it.d;
  }
  events[cc] = cl.map(c => {
    const outlets = new Set(c.items.map(x => x.h));
    const conf = [...outlets].reduce((n, h) => n + (AUTH_HOSTS.test(h) ? 2 : 1), 0);
    const smax = Math.max(...c.items.map(x => x.s));
    let s = smax;
    if (s >= 4 && conf < 2) s = 3; // a serious event reported by one outlet counts at severity 3 until a second outlet confirms it
    const rep = c.items.filter(x => x.s === smax).sort((a, b) => a.d - b.d)[0];
    const themes = {}; c.items.forEach(x => { themes[x.th] = (themes[x.th] || 0) + 1; });
    const localHosts = new Set(c.items.filter(x => feedHome[x.f] === cc).map(x => x.h));
    const langs = [...new Set(c.items.map(x => x.l || 'en'))].sort();
    return { id: hash(cc + rep.id), cc, h: rep.t, u: rep.u, s, ...(smax !== s ? { s0: smax } : {}), th: Object.entries(themes).sort((a, b) => b[1] - a[1])[0][0],
      d: c.items[0].d, last: c.last, o: outlets.size, conf, r: c.items.length, src: rep.f, ...(rep.l ? { l: rep.l } : {}), ...(localHosts.size ? { lo: localHosts.size } : {}), ...(langs.length > 1 ? { lg: langs } : {}), img: c.items.map(x => x.i).find(Boolean) || '',
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
/** The tier score S of a set of events. A single outlet's solo severity-3 reports are capped, so one prolific feed cannot inflate a country. */
function tierScore(list) {
  const n = { 3: 0, 4: 0, 5: 0 }, solo = {};
  for (const e of list) {
    if (e.s < 3) continue;
    if (e.s === 3 && e.o === 1) { const h = e.hosts[0]; solo[h] = (solo[h] || 0) + 1; if (solo[h] > SOLO_CAP) continue; }
    n[e.s]++;
  }
  return [3, 4, 5].reduce((S, t) => n[t] ? S + Math.min(t === 3 ? T3_CAP : Infinity, TW[t] * (1 + Math.log(n[t]))) : S, 0);
}
const sumW = (evs, from, to) => tierScore(evs.filter(e => e.d > NOW - to * DAY && e.d <= NOW - from * DAY));
const weekScores = evs => [0, 1, 2, 3].map(k => sumW(evs, 7 * k, 7 * (k + 1)));
/** How a country normally scores: median and spread of ln(1+S) over its recent full weeks (needs two or more). */
function ownBase(evs) {
  const m = Math.min(8, fullWeeks); if (m < 2) return null;
  const L = Array.from({ length: m }, (_, k) => Math.log(1 + sumW(evs, 7 * (k + 1), 7 * (k + 2))));
  const med = median(L); return { m, med, mad: median(L.map(x => Math.abs(x - med))) };
}

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

/** Stats for one country over the last `days` days. z is the surge against the country's own normal (weekly view only). */
function windowStats(evs, days, z) {
  const w = evs.filter(e => e.d > NOW - days * DAY);
  const cnt = [0, 0, 0, 0, 0, 0]; w.forEach(e => cnt[e.s]++);
  const th = {}; w.forEach(e => { th[e.th] = (th[e.th] || 0) + 1; });
  const hosts = new Set(); w.forEach(e => e.hosts.forEach(h => hosts.add(h)));
  const weeks = weekScores(evs);
  let S, band, lift = false;
  if (days <= 7) {
    S = Math.max(weeks[0], weeks[1] * 0.5, weeks[2] * 0.25); // earlier weeks fade out gradually, so a country eases down after serious events stop
    band = bandOf(S);
    if (z != null && z >= 2.5 && weeks[0] >= TW[3] && band < 5) { band++; lift = true; } // far above its own normal: one step up, never down
  } else { S = weeks.reduce((x, y) => x + y, 0); band = bandOf(S, 4); }
  // change: weekly compares with the week before (or the last 3 days with the 4 before while history is short); monthly compares 15 vs 15 days
  let chg = null;
  const rate = (a, b) => sumW(evs, a, b) / (b - a);
  const mk = (cu, pr, basis) => ({ basis, pct: pr > 0 ? Math.round((cu - pr) / pr * 100) : null, isNew: pr === 0 && cu > 0, cur: +cu.toFixed(1), prev: +pr.toFixed(1) });
  if (days <= 7) chg = fullWeeks >= 1 ? mk(rate(0, 7), rate(7, 14), 'week') : mk(rate(0, 3), rate(3, 7), '3d');
  else if (spanDays >= 28) chg = mk(rate(0, 15), rate(15, 30), '15d');
  if (chg) chg.dir = chg.isNew || (chg.pct != null && chg.pct > 10) ? 'up' : chg.pct != null && chg.pct < -10 ? 'down' : 'flat';
  return {
    ev: w.length, rep: w.reduce((n, e) => n + e.r, 0), src: hosts.size, S: +S.toFixed(1), load: +Math.log(1 + S).toFixed(2), cur: +S.toFixed(1),
    weeks: weeks.map(x => +x.toFixed(1)), peak: bandOf(Math.max(...weeks)), lift,
    maxSev: Math.max(0, ...w.map(e => e.s)), band, sev: cnt.slice(1), th, chg
  };
}
const tg = e => ({ ...(e.l ? { l: e.l } : {}), ...(e.lo ? { lo: e.lo } : {}), ...(e.lg ? { lg: e.lg } : {}) });
const topOf = (evs, days, n) => [...evs].filter(e => e.last > NOW - days * DAY)
  .sort((a, b) => b.s - a.s || b.conf - a.conf || b.last - a.last).slice(0, n)
  .map(e => ({ id: e.id, h: e.h, u: e.u, s: e.s, th: e.th, o: e.o, r: e.r, d: dayKey(e.d), src: e.src, ...tg(e) }));

const bases = {};
for (const [cc, evs] of Object.entries(events)) if (evs.some(e => e.d > NOW - 30 * DAY)) { const b = ownBase(evs); if (b) bases[cc] = b; }
const gMed = median(Object.values(bases).map(b => b.med).concat(0)), gMad = median(Object.values(bases).map(b => b.mad).concat(0));
const countries = [];
for (const [cc, evs] of Object.entries(events)) {
  if (!evs.some(e => e.d > NOW - 30 * DAY)) continue;
  // surge: this week against the country's own normal, blended toward the world typical value while its own history is short
  let z = null; const b = bases[cc];
  if (baselineReady && b) {
    const K0 = 3, med = (b.m * b.med + K0 * gMed) / (b.m + K0), mad = (b.m * b.mad + K0 * gMad) / (b.m + K0);
    z = +((Math.log(1 + sumW(evs, 0, 7)) - med) / Math.max(1.4826 * mad, 0.35)).toFixed(2);
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
const rankBy = win => countries.slice().sort((a, b) => b[win].band - a[win].band || b[win].S - a[win].S || (b.w7.z ?? 0) - (a.w7.z ?? 0)).map(c => c.cc);
const r7 = rankBy('w7'), r30 = rankBy('w30');
countries.forEach(c => { c.w7.rank = r7.indexOf(c.cc) + 1; c.w30.rank = r30.indexOf(c.cc) + 1; });
countries.sort((a, b) => a.w7.rank - b.w7.rank);

// ── 5. headline figures, stories, movement, gaps ─────────────────────────────
const allEv = Object.values(events).flat();
const cname = cc => COUNTRIES[cc].k;
const slim = e => ({ id: e.id, cc: e.cc, c: cname(e.cc), fl: COUNTRIES[e.cc].fl, h: e.h, u: e.u, s: e.s, th: e.th, o: e.o, d: dayKey(e.last), src: e.src, ...tg(e) });
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
const heldBack = (days) => allEv.filter(e => (e.s0 || e.s) >= 4 && e.conf < 2 && e.last > NOW - days * DAY).length;
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
    events: evs.map(e => ({ id: e.id, h: e.h, u: e.u, s: e.s, th: e.th, o: e.o, r: e.r, d: dayKey(e.d), last: dayKey(e.last), src: e.src, ...tg(e), items: e.items }))
  }));
}
fs.writeFileSync(path.join(OUT, 'brief.json'), JSON.stringify(brief));
fs.writeFileSync(path.join(OUT, 'history.json'), JSON.stringify({ since: hist.since, items }));
fs.writeFileSync(path.join(OUT, 'health.json'), JSON.stringify({ generated: brief.generated, feeds: health }));
console.log(`countries ${countries.length}, urgent3d ${brief.urgent.w7.length}, urgent30d ${brief.urgent.w30.length}, stories ${brief.stories.w7.length}, top5 ${brief.top5.join(',')}, baseline ${baselineReady}, span ${spanDays}d`);
console.log('moved up:', moved.w7.up.map(r => r.k + ' ' + (r.pct ?? 'new')).join(', '), '| themes:', moved.w7.themes.map(t => t.th + ' ' + t.pct).join(', '), '| sudden:', moved.w7.sudden.map(e => e.c).join(', '));
