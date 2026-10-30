// Registry gate. A feed enters only if all of this holds (HTTP 200 alone proves nothing):
//   1. it fetches and its body parses as RSS 2.0, Atom or RDF (an HTML error page that returns 200 fails here)
//   2. it carries at least MIN_ITEMS items, each with a title and an http(s) link
//   3. the NEWEST dated item was published within MAX_AGE_DAYS (not just the first item listed: some feeds sort oldest-first
//      or pin an old item on top). Items with no date do not count, and dates in the future are ignored.
// Usage: node pipeline/checkfeeds.mjs                      re-validates every list below
//        node pipeline/checkfeeds.mjs <candidates> <out>   one list
import fs from 'node:fs';
import { XMLParser } from 'fast-xml-parser';
const MAX_AGE_DAYS = 45, MIN_ITEMS = 3;
const p = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
const txt = v => { if (v == null) return ''; if (typeof v === 'object') v = v['#text'] ?? v['__cdata'] ?? ''; return String(v).trim(); };
const linkOf = e => {
  if (typeof e.link === 'string') return e.link;
  const L = Array.isArray(e.link) ? e.link : e.link ? [e.link] : [];
  return (L.find(l => l['@_rel'] === 'alternate') || L[0])?.['@_href'] || txt(e.guid);
};

/** Returns {n, newestAgeDays} or throws with the reason the feed is rejected. */
async function validate(url) {
  const r = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 UpstreamBot/1.0', accept: 'application/rss+xml,application/atom+xml,application/xml,text/xml,*/*' },
    signal: AbortSignal.timeout(20000), redirect: 'follow'
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const body = await r.text();
  let x; try { x = p.parse(body); } catch (e) { throw new Error('not XML: ' + e.message.slice(0, 40)); }
  const raw = x?.rss?.channel?.item || x?.feed?.entry || x?.['rdf:RDF']?.item;
  if (!raw) throw new Error('not RSS or Atom');
  const arr = (Array.isArray(raw) ? raw : [raw]).filter(Boolean);
  const good = arr.filter(e => txt(e.title) && /^https?:/.test(linkOf(e) || ''));
  if (good.length < MIN_ITEMS) throw new Error('fewer than ' + MIN_ITEMS + ' items with a title and link (' + good.length + ')');
  const now = Date.now();
  const times = good.map(e => new Date(txt(e.pubDate) || txt(e.published) || txt(e.updated) || txt(e['dc:date'])).getTime())
    .filter(t => !isNaN(t) && t <= now + 864e5);
  if (!times.length) throw new Error('no dated items');
  const age = (now - Math.max(...times)) / 864e5;
  if (age > MAX_AGE_DAYS) throw new Error('stale: newest item is ' + Math.round(age) + ' days old');
  return { n: good.length, age: +age.toFixed(1) };
}

async function run(candFile, outFile) {
  const list = JSON.parse(fs.readFileSync(new URL('./' + candFile, import.meta.url)));
  const ok = [], bad = [], q = list.map(x => Array.isArray(x) ? x : [x.name, x.url, x.lang, x.cc]);
  await Promise.all(Array.from({ length: 12 }, async () => {
    while (q.length) {
      const [name, url, lang, cc] = q.shift();
      try { const v = await validate(url); ok.push({ name, url, n: v.n, ...(lang ? { lang } : {}), ...(cc ? { cc } : {}) }); }
      catch (e) { bad.push(name + ' :: ' + e.message); }
    }
  }));
  fs.writeFileSync(new URL('./' + outFile, import.meta.url), JSON.stringify(ok.sort((a, b) => a.name.localeCompare(b.name)), null, 1));
  console.log(candFile + ' -> ' + outFile + ': OK ' + ok.length + ', rejected ' + bad.length);
  if (process.env.VERBOSE || process.argv[2]) console.log(bad.sort().join('\n'));
}

{
  if (process.argv[2]) await run(process.argv[2], process.argv[3] || 'feeds.json');
  else for (const [c, o] of [['feeds.candidates.json', 'feeds.json'], ['feeds.en2.candidates.json', 'feeds.en2.json'], ['feeds.local.candidates.json', 'feeds.local.json'], ['feeds.local2.candidates.json', 'feeds.local2.json']]) await run(c, o);
}
