// Probe: how many distinct outlets does GDELT's DOC API give per country? (one request every 6 s)
import fs from 'node:fs';
import { COUNTRIES } from './countries.mjs';
const out = {}; const doms = new Set(); const langs = {};
for (const c of Object.values(COUNTRIES)) {
  const q = 'sourcecountry:' + c.k.replace(/[^A-Za-z]/g, '');
  try {
    const r = await fetch('https://api.gdeltproject.org/api/v2/doc/doc?query=' + q + '&mode=artlist&maxrecords=250&format=json&timespan=2d&sort=datedesc', { signal: AbortSignal.timeout(40000) });
    const t = await r.text(); const a = t.startsWith('{') ? (JSON.parse(t).articles || []) : [];
    const d = new Set(a.map(x => x.domain)); d.forEach(x => doms.add(x)); a.forEach(x => langs[x.language] = (langs[x.language] || 0) + 1);
    out[c.cc] = { n: a.length, d: d.size, http: r.status };
  } catch (e) { out[c.cc] = { err: e.message }; }
  await new Promise(r => setTimeout(r, 6000));
}
fs.writeFileSync(process.env.TEMP + '/gdelt-probe.json', JSON.stringify({ out, domains: doms.size, langs }, null, 1));
console.log('done', doms.size);
