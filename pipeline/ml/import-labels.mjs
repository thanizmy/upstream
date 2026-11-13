// Merge labels from a CSV into pipeline/ml/labels.json.
// Usage: npm run import-labels -- path/to/label-pool.csv
// The CSV is the one downloaded from data/label-pool.csv with the last column (label) filled in: 1 = real incident, 0 = not. Blank rows are skipped.
import fs from 'node:fs';

const file = process.argv[2];
if (!file) { console.error('usage: npm run import-labels -- file.csv'); process.exit(1); }
const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
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
const head = rows.shift().map(h => h.trim().toLowerCase()), hi = head.indexOf('headline'), li = head.indexOf('label');
if (hi < 0 || li < 0) { console.error('the CSV needs "headline" and "label" columns'); process.exit(1); }
const out = fs.existsSync('pipeline/ml/labels.json') ? JSON.parse(fs.readFileSync('pipeline/ml/labels.json', 'utf8')) : {};
let added = 0, skipped = 0;
for (const r of rows) {
  const v = (r[li] || '').trim().toLowerCase(), y = ['1', 'y', 'yes', 'incident', 'true'].includes(v) ? 1 : ['0', 'n', 'no', 'not', 'false'].includes(v) ? 0 : null;
  if (y == null) { skipped++; continue; }
  if (out[r[hi]] !== y) added++; out[r[hi]] = y;
}
fs.writeFileSync('pipeline/ml/labels.json', JSON.stringify(out, null, 1));
console.log(`labels: +${added} new or changed, ${skipped} blank/unclear rows skipped, ${Object.keys(out).length} total`);
