// Authoritative hazard feeds that carry their own severity (GDACS alert level, USGS magnitude and PAGER alert).
// Their severity is taken from the data, not guessed from the words of a headline, so a metaphor or an all-clear cannot turn into a disaster.
// Each item is returned ready to store: { title, u, t, summary, cc, s, th, f } and is marked a:1 by the caller so it is never re-scored from its title.
import { XMLParser } from 'fast-xml-parser';
import { detectCountries } from './countries.mjs';

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', htmlEntities: true, processEntities: true });
const UA = { 'user-agent': 'Mozilla/5.0 UpstreamBot/1.0' };
const txt = v => (v == null ? '' : typeof v === 'object' ? String(v['#text'] ?? '') : String(v)).trim();
const arr = v => (Array.isArray(v) ? v : v ? [v] : []);

/** GDACS (UN/EU Global Disaster Alert and Coordination System): Red = high humanitarian impact, Orange = medium, Green = low. */
const GDACS_LEVEL = { red: 4, orange: 3 };
export async function gdacs(now) {
  const r = await fetch('https://www.gdacs.org/xml/rss.xml', { headers: UA, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error('GDACS HTTP ' + r.status);
  const items = arr(xml.parse(await r.text())?.rss?.channel?.item);
  const out = [];
  for (const e of items) {
    const lvl = txt(e['gdacs:alertlevel']).toLowerCase(), s = GDACS_LEVEL[lvl];
    if (!s || txt(e['gdacs:eventtype']) === 'DR') continue; // droughts are slow and span many countries: not an acute event to attribute to one
    const t = new Date(txt(e.pubDate)).getTime();
    if (isNaN(t) || t > now + 864e5) continue;
    const title = txt(e.title).replace(/\s+/g, ' '), place = txt(e['gdacs:country']);
    let cc = detectCountries(place).slice(0, 3); if (!cc.length) cc = detectCountries(title).slice(0, 3);
    if (!cc.length || place.split(',').length > 3) continue;
    out.push({ title: 'GDACS ' + title, u: txt(e.link), t, summary: txt(e.description), cc, s, th: 'disaster', f: 'GDACS' });
  }
  return { items: out, total: items.length };
}

/** USGS earthquakes of magnitude 4.5+ in the last week. PAGER orange/red or M7+ = 4, PAGER yellow or M6+ = 3; smaller ones are not incidents. */
export async function usgs(now) {
  const r = await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson', { headers: UA, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error('USGS HTTP ' + r.status);
  const feats = (await r.json()).features || [], out = [];
  for (const f of feats) {
    const p = f.properties || {}, mag = p.mag, alert = (p.alert || '').toLowerCase();
    const s = alert === 'red' || alert === 'orange' || mag >= 7 ? 4 : alert === 'yellow' || mag >= 6 ? 3 : 0;
    if (!s || !p.time || p.time > now + 864e5) continue;
    const cc = detectCountries(String(p.place || '')).slice(0, 2);
    if (!cc.length) continue; // open ocean: nobody to attribute it to
    out.push({ title: 'Earthquake: ' + (p.title || 'M ' + mag + ' ' + p.place), u: p.url, t: p.time, summary: '', cc, s, th: 'disaster', f: 'USGS' });
  }
  return { items: out, total: feats.length };
}
