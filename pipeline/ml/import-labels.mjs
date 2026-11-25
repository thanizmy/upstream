// Merge labels into pipeline/ml/labels.json (incident 1 / not 0) and pipeline/ml/severity.json (severity 1-5).
// Usage: npm run import-labels -- path/to/file.csv | path/to/labels.json
//   CSV:   data/label-pool.csv with the label column filled in (1 = real incident, 0 = not) and, optionally, human_severity (1-5). Blank rows are skipped.
//   JSON:  what "Copy labels" on #review puts on the clipboard: { "labels": { "headline": 1|0 }, "severity": { "headline": 1..5 } }.
//          The older flat shape { "headline": 1|0 } is still accepted.
//   Language: non-English headlines carry their language code (a "lang" column in the CSV, a "lang": {headline: code} map in the JSON); it is merged into pipeline/ml/lang.json. Headlines without one are English.
// Env for testing: LABELS_FILE, SEVERITY_FILE, LANG_FILE.
import fs from 'node:fs';

const file = process.argv[2];
if (!file) { console.error('usage: npm run import-labels -- file.csv|file.json'); process.exit(1); }
const LABELS = process.env.LABELS_FILE || 'pipeline/ml/labels.json', SEVERITY = process.env.SEVERITY_FILE || 'pipeline/ml/severity.json', LANG = process.env.LANG_FILE || 'pipeline/ml/lang.json';
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
const lab = [], sev = [], lng = []; // [headline, value]
const asLang = v => { v = String(v ?? '').trim().toLowerCase(); return /^[a-z]{2,3}$/.test(v) && v !== 'en' ? v : null; };
const okKey = h => typeof h === 'string' && h.trim() !== '' && !['__proto__', 'constructor', 'prototype'].includes(h); // keys become object properties
const asLabel = v => { v = String(v ?? '').trim().toLowerCase(); return ['1', 'y', 'yes', 'incident', 'true'].includes(v) ? 1 : ['0', 'n', 'no', 'not', 'false'].includes(v) ? 0 : null; };
const asSev = v => { const n = parseInt(String(v ?? '').trim(), 10); return n >= 1 && n <= 5 ? n : null; };

if (/\.json$/i.test(file) || /^\s*[{[]/.test(text)) {
  const j = JSON.parse(text), L = j.labels && typeof j.labels === 'object' ? j.labels : j.severity || j.lang ? {} : j, S = j.severity || {};
  for (const [h, v] of Object.entries(L)) { const y = asLabel(v); if (y != null && okKey(h)) lab.push([h, y]); }
  for (const [h, v] of Object.entries(S)) { const n = asSev(v); if (n != null && okKey(h)) sev.push([h, n]); }
  for (const [h, v] of Object.entries(j.lang || {})) { const l = asLang(v); if (l && okKey(h)) lng.push([h, l]); }
} else {
  // minimal CSV reader (quoted fields, doubled quotes, newlines inside quotes)
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.length > 1 || row[0]) rows.push(row); row = []; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  if (!rows.length) { console.error('the CSV is empty'); process.exit(1); }
  const head = rows.shift().map(h => h.trim().toLowerCase()), hi = head.indexOf('headline'), li = head.indexOf('label'), si = head.indexOf('human_severity'), gi = head.indexOf('lang');
  if (hi < 0 || (li < 0 && si < 0)) { console.error('the CSV needs a "headline" column and a "label" and/or "human_severity" column'); process.exit(1); }
  for (const r of rows) {
    if (!okKey(r[hi])) continue;
    const y = li >= 0 ? asLabel(r[li]) : null, n = si >= 0 ? asSev(r[si]) : null;
    if (y != null) lab.push([r[hi], y]);
    if (n != null) sev.push([r[hi], n]);
    if (gi >= 0 && (y != null || n != null)) { const l = asLang(r[gi]); if (l) lng.push([r[hi], l]); }
  }
}

const merge = (path, entries) => {
  const out = readJson(path, {}); let changed = 0;
  for (const [h, v] of entries) { if (out[h] !== v) changed++; out[h] = v; }
  fs.writeFileSync(path, JSON.stringify(out, null, 1));
  return { changed, total: Object.keys(out).length, out };
};
const a = merge(LABELS, lab), b = merge(SEVERITY, sev), c = merge(LANG, lng);
console.log(`labels: +${a.changed} new or changed, ${a.total} total`);
console.log(`severity: +${b.changed} new or changed, ${b.total} total`);
console.log(`non-English language tags: +${c.changed} new or changed, ${c.total} total`);
// an incident should be at least severity 3. (Not-incident with severity 3 is allowed: peaceful protests and political crises are rated 3 but are not incidents.)
const clash = Object.entries(b.out).filter(([h, n]) => a.out[h] === 1 && n <= 2);
if (clash.length) { console.warn(`warning: ${clash.length} headline(s) are labelled an incident but have severity 1 or 2:`); clash.slice(0, 5).forEach(([h, n]) => console.warn(`  sev ${n}  ${h}`)); }
