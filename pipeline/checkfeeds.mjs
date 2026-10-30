// Qualifies feeds: must fetch, parse as RSS/Atom, and have published within 45 days.
import fs from 'node:fs';
import { XMLParser } from 'fast-xml-parser';
const list = JSON.parse(fs.readFileSync(new URL('./' + (process.argv[2]||'feeds.candidates.json') + '', import.meta.url)));
const p = new XMLParser({ ignoreAttributes: false });
const ok = [], bad = [];
async function chk([name, url, lang, cc]) {
  try {
    const r = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0 UpstreamBot/1.0', accept: 'application/rss+xml,application/atom+xml,application/xml,text/xml,*/*' },
      signal: AbortSignal.timeout(15000), redirect: 'follow'
    });
    const t = await r.text();
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const x = p.parse(t);
    const items = x?.rss?.channel?.item || x?.feed?.entry || x?.['rdf:RDF']?.item || [];
    const arr = Array.isArray(items) ? items : [items];
    if (!arr.length || !arr[0]) throw new Error('no items');
    const d = arr[0].pubDate || arr[0].published || arr[0].updated || arr[0]['dc:date'];
    const age = d ? (Date.now() - new Date(d)) / 864e5 : NaN;
    if (!(age < 45)) throw new Error('stale/undated ' + age);
    ok.push({ name, url, n: arr.length, ...(lang ? { lang } : {}), ...(cc ? { cc } : {}) });
  } catch (e) { bad.push(name + ' :: ' + e.message); }
}
const q = [...list];
await Promise.all(Array.from({ length: 12 }, async () => { while (q.length) await chk(q.shift()); }));
fs.writeFileSync(new URL('./' + (process.argv[3] || 'feeds.json'), import.meta.url), JSON.stringify(ok.sort((a, b) => a.name.localeCompare(b.name)), null, 1));
console.log('OK', ok.length, 'BAD', bad.length);
console.log(bad.join('\n'));
