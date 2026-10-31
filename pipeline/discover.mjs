// Source discovery: grow the feed registry across all countries.
//   1. Outlet lists: GDELT's domains-by-country file (homepages), plus two feed directories that already list feed URLs
//      (plenaryapp/awesome-rss-feeds by country, ournet/news-sources).
//   2. For a homepage, find its feed: <link rel="alternate" type="application/rss+xml">, then common paths (/feed, /rss ...).
//   3. Every candidate goes through the same gate as the rest of the registry (checkfeeds.validate): it must parse, carry
//      3+ items with title and link, and have an item from the last 45 days. Nothing enters on a guess.
//   4. Per-country cap (CAP, default 60), most active feeds first, so no country crowds out the rest.
// Usage: node pipeline/discover.mjs            (env: CAP, US_SAMPLE, OUT, LIMIT for a quick trial,
//        MERGE=1 keep what is already in the output and only add new sites, WIKIDATA=1 also list outlets from Wikidata, SKIP_LISTS=1 skip the other lists)
// Writes pipeline/feeds.discovered.json: [{name, url, n, cc, lang?}]
import fs from 'node:fs';
import { COUNTRIES } from './countries.mjs';
import { supports } from './classify-local.mjs';
import { validate } from './checkfeeds.mjs';

const CAP = +process.env.CAP || 60, US_SAMPLE = +process.env.US_SAMPLE || 500, CONC = 48;
const OUT = new URL('./' + (process.env.OUT || 'feeds.discovered.json'), import.meta.url);
const UA = 'Mozilla/5.0 UpstreamBot/1.0 (+https://github.com/thanizmy/upstream)';
const log = (...a) => console.error(new Date().toISOString().slice(11, 19), ...a);
// a misbehaving server can make Node's HTTP client throw from inside a socket event; that must not end a long run
process.on('uncaughtException', e => log('ignored network error:', String(e.message || e).slice(0, 80)));
process.on('unhandledRejection', e => log('ignored rejection:', String(e && e.message || e).slice(0, 80)));

// ── country lookup ───────────────────────────────────────────────────────────
const byName = new Map(Object.values(COUNTRIES).map(c => [c.k.toLowerCase(), c.cc]));
const ALIAS = { turkey: 'TR', 'czech republic': 'CZ', 'bahamas, the': 'BS', 'bosnia-herzegovina': 'BA', 'vietnam, republic of': 'VN', macedonia: 'MK',
  swaziland: 'SZ', 'slovak republic': 'SK', congo: 'CG', 'democratic republic of the congo': 'CD', 'hong kong sar china': 'HK', 'united states': 'US',
  'united kingdom': 'GB', 'south korea': 'KR', 'north korea': 'KP', russia: 'RU', 'ivory coast': 'CI', "côte d'ivoire": 'CI', burma: 'MM' };
const ccOf = n => { n = (n || '').trim().toLowerCase(); return ALIAS[n] || byName.get(n) || null; };

// ── existing registry (never add what is already there) ──────────────────────
const host = u => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
const existing = [];
for (const f of fs.readdirSync(new URL('./', import.meta.url))) {
  if (/^feeds.*\.json$/.test(f) && !/candidates/.test(f) && f !== 'feeds.discovered.json') existing.push(...JSON.parse(fs.readFileSync(new URL('./' + f, import.meta.url))));
}
const prior = process.env.MERGE && fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT)) : [];
const haveHost = new Set([...existing, ...prior].map(f => host(f.url))), haveName = new Set(existing.map(f => f.name.toLowerCase()));
const regHost = h => h.split('.').slice(-2).join('.'); // good enough to treat bbc.co.uk / bbc.com apart from other sites

// ── 1. outlet lists ──────────────────────────────────────────────────────────
const sites = new Map();   // homepage host -> {url, cc}
const direct = [];         // {name, url, cc, lang}
async function get(url, ms = 15000) { const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(ms), redirect: 'follow' }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); }

{ // GDELT
  const rows = (await get('https://data.gdeltproject.org/supportingdatasets/DOMAINSBYCOUNTRY-ENGLISH.TXT', 60000)).split('\n').slice(1).filter(Boolean).map(l => l.split('\t'));
  const us = [];
  for (const [d, , name] of rows) {
    const cc = ccOf(name); if (!cc || !COUNTRIES[cc] || !d || haveHost.has(d.replace(/^www\./, ''))) continue;
    if (cc === 'US') us.push({ d, cc }); else sites.set(d, { url: 'https://' + d + '/', cc });
  }
  us.sort(() => Math.random() - .5).slice(0, US_SAMPLE).forEach(({ d, cc }) => sites.set(d, { url: 'https://' + d + '/', cc }));
  log('gdelt homepages', sites.size);
}
try { // awesome-rss-feeds, one OPML per country
  const tree = await (await fetch('https://api.github.com/repos/plenaryapp/awesome-rss-feeds/git/trees/master?recursive=1', { headers: { 'user-agent': UA } })).json();
  for (const t of tree.tree.filter(t => /^countries\/without_category\/.+\.opml$/.test(t.path) || /^countries\/with_category\/.+\.opml$/.test(t.path))) {
    const cc = ccOf(decodeURIComponent(t.path.split('/').pop().replace('.opml', '')));
    if (!cc || !COUNTRIES[cc]) continue;
    const x = await get('https://raw.githubusercontent.com/plenaryapp/awesome-rss-feeds/master/' + t.path.split('/').map(encodeURIComponent).join('/'));
    for (const m of x.matchAll(/<outline[^>]*?text="([^"]*)"[^>]*?xmlUrl="([^"]+)"/g)) direct.push({ name: m[1].replace(/&amp;/g, '&'), url: m[2].replace(/&amp;/g, '&'), cc });
  }
  log('awesome-rss-feeds', direct.length);
} catch (e) { log('awesome-rss-feeds skipped:', e.message); }
try { // ournet/news-sources
  const dir = await (await fetch('https://api.github.com/repos/ournet/news-sources/contents/data/sources', { headers: { 'user-agent': UA } })).json();
  for (const f of dir) {
    const j = JSON.parse(await get(f.download_url));
    for (const s of j) { const cc = (s.country || '').toUpperCase(); if (!COUNTRIES[cc]) continue; for (const fd of s.feeds || []) direct.push({ name: s.name, url: fd.url, cc, lang: fd.language || (s.languages || [])[0] }); }
  }
  log('+ ournet', direct.length);
} catch (e) { log('ournet skipped:', e.message); }

if (process.env.SKIP_LISTS) { sites.clear(); direct.length = 0; log('skipping the GDELT and directory lists (already tried)'); }
if (process.env.WIKIDATA) { // Wikidata: newspapers, daily newspapers, online newspapers and news agencies that have an official website
  const wd = async q => { for (let t = 0; t < 2; t++) { try { const r = await fetch('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q), { headers: { 'user-agent': 'UpstreamDiscovery/1.0 (https://github.com/thanizmy/upstream)', accept: 'application/sparql-results+json' }, signal: AbortSignal.timeout(70000) }); if (r.ok) return (await r.json()).results.bindings; } catch { /* retry once */ } await new Promise(r => setTimeout(r, 4000)); } return []; };
  let added = 0;
  for (const cc of Object.keys(COUNTRIES)) {
    const rows = await wd(`SELECT DISTINCT ?site ?lc WHERE { ?c wdt:P297 "${cc}". ?i wdt:P17 ?c; wdt:P31 ?t; wdt:P856 ?site. VALUES ?t { wd:Q11032 wd:Q1110794 wd:Q1153191 wd:Q192283 wd:Q1002697 } OPTIONAL { ?i wdt:P407 ?l. ?l wdt:P218 ?lc } FILTER NOT EXISTS { ?i wdt:P576 ?e } } LIMIT 600`);
    for (const b of rows) {
      const h = host(b.site.value); if (!h || haveHost.has(h) || sites.has(h)) continue;
      sites.set(h, { url: b.site.value, cc, lang: b.lc?.value }); added++;
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  log('wikidata homepages added', added);
}

// ── 2. find a feed on a homepage ─────────────────────────────────────────────
const PATHS = ['feed', 'rss', 'rss.xml', 'feed/', 'rss/', 'atom.xml', 'feeds/posts/default?alt=rss'];
async function findFeeds(site) {
  let html = '', base = site.url;
  for (const u of [site.url, site.url.replace('://', '://www.')]) {
    try { html = (await get(u, 12000)).slice(0, 400000); base = u; break; } catch { /* next */ }
  }
  const out = [];
  const abs = h => { try { return new URL(h.replace(/&amp;/g, '&'), base).href; } catch { return null; } };
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/type=["']application\/(rss|atom)\+xml["']/i.test(tag) || !/rel=["']alternate["']/i.test(tag)) continue;
    const h = /href=["']([^"']+)["']/i.exec(tag)?.[1], u = h && abs(h);
    if (u && !/comment/i.test(u) && !out.includes(u)) out.push(u);
  }
  if (!html) return { feeds: [] };
  for (const p of PATHS) { const u = abs('/' + p); if (u && !out.includes(u)) out.push(u); }
  const lang = (/<html[^>]*\blang=["']?([a-zA-Z]{2})/i.exec(html) || [])[1]?.toLowerCase();
  const sn = /property=["']og:site_name["'][^>]*content=["']([^"']+)/i.exec(html)?.[1] || /content=["']([^"']+)["'][^>]*property=["']og:site_name["']/i.exec(html)?.[1];
  const title = /<title[^>]*>([^<]{2,80})/i.exec(html)?.[1];
  return { feeds: out.slice(0, 5), lang, name: (sn || title || '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim() };
}

// ── 3. gate ──────────────────────────────────────────────────────────────────
const found = [...prior];
async function pool(items, fn) {
  const q = [...items]; let done = 0;
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (q.length) { const it = q.shift(); try { await fn(it); } catch { /* skip */ } if (++done % 250 === 0) { log('progress', done + '/' + items.length, 'live', found.length); fs.writeFileSync(process.env.TEMP + '/discover.partial.json', JSON.stringify(found)); } }
  }));
}
const work = [...direct.map(d => ({ kind: 'direct', ...d })), ...[...sites].map(([d, s]) => ({ kind: 'site', d, ...s }))];
if (+process.env.LIMIT) work.sort(() => Math.random() - .5).splice(+process.env.LIMIT);
log('candidates', work.length);
const seenHost = new Set();
await pool(work, async w => {
  if (w.kind === 'direct') {
    const h = host(w.url); if (haveHost.has(h) || seenHost.has(h)) return; seenHost.add(h);
    const lang = (w.lang || '').toLowerCase().slice(0, 2);
    if (lang && lang !== 'en' && !supports(lang)) return;
    const v = await validate(w.url);
    found.push({ name: w.name, url: w.url, n: v.n, cc: w.cc, ...(lang && lang !== 'en' ? { lang } : {}) });
    return;
  }
  const r = await findFeeds(w);
  const hint = (w.lang || '').toLowerCase().slice(0, 2), pick = r.lang || hint;
  const lang = pick && pick !== 'en' ? pick : '';
  if (lang && !supports(lang)) return;
  for (const u of r.feeds) {
    try {
      const v = await validate(u);
      found.push({ name: r.name || w.d, url: u, n: v.n, cc: w.cc, ...(lang ? { lang } : {}) });
      return;
    } catch { /* try the next candidate */ }
  }
});
log('validated live feeds', found.length);

// ── 4. dedupe, name uniquely, cap per country ────────────────────────────────
const out = [], perCc = {}, usedHost = new Set(), usedName = new Set(haveName);
for (const f of found.sort((a, b) => b.n - a.n)) {
  const h = host(f.url); if (usedHost.has(h) || haveHost.has(h)) continue;
  if ((perCc[f.cc] || 0) >= CAP) continue;
  let name = f.name.replace(/^(breaking news|latest news|home)\s*[-–:]\s*/i, '').split(/\s[|–—·]\s/)[0].replace(/\s*[-–]\s*(home|news|rss)$/i, '').slice(0, 70).trim() || h; if (usedName.has(name.toLowerCase())) name = name + ' · ' + h; if (usedName.has(name.toLowerCase())) continue;
  usedName.add(name.toLowerCase()); usedHost.add(h); perCc[f.cc] = (perCc[f.cc] || 0) + 1;
  out.push({ ...f, name });
}
fs.writeFileSync(OUT, JSON.stringify(out.sort((a, b) => a.name.localeCompare(b.name)), null, 1));
log('wrote', out.length, 'feeds across', Object.keys(perCc).length, 'countries; registry total', existing.length + out.length);
