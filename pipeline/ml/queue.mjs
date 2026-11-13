// Collects headlines to label, a few more on every refresh, and serves them on the #review page.
//   .cache/label-pool.json  persistent pool of unlabelled English headlines (kept in the Actions cache with the history; capped, oldest dropped first)
//   data/label-queue.json   a shuffled batch from the pool for the #review page; with a trained model, 60% are the ones it is least sure about
//   data/label-pool.csv     the whole pool as a spreadsheet (headline, severity, source, url, label): fill the label column with 1 / 0, then run `npm run import-labels`
import fs from 'node:fs';
import { predict } from './model.mjs';

const POOL_FILE = process.env.POOL_FILE || '.cache/label-pool.json', CAP = 6000, KEEP_DAYS = 45;
const csv = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';

export function buildQueue(items, model, now, outDir, n = 300) {
  const human = fs.existsSync('pipeline/ml/labels.json') ? JSON.parse(fs.readFileSync('pipeline/ml/labels.json', 'utf8')) : {};
  let pool = {};
  try { pool = JSON.parse(fs.readFileSync(POOL_FILE, 'utf8')); } catch { /* first run */ }
  const rnd = (seed => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)(Math.floor(now / 36e5));
  // today's candidates: every serious headline, plus a sample of the rest so there are plenty of "not an incident" examples
  for (const i of items) {
    if (i.l || i.a || human[i.t] != null || pool[i.t] || now - i.d > 4 * 864e5) continue;
    if (i.s >= 3 || rnd() < 0.15) pool[i.t] = { u: i.u, s: i.s, f: i.f, d: i.d };
  }
  for (const t of Object.keys(pool)) if (human[t] != null || now - pool[t].d > KEEP_DAYS * 864e5) delete pool[t];
  const keys = Object.keys(pool);
  if (keys.length > CAP) keys.sort((a, b) => pool[a].d - pool[b].d).slice(0, keys.length - CAP).forEach(t => delete pool[t]);
  fs.mkdirSync(require_dir(POOL_FILE), { recursive: true });
  fs.writeFileSync(POOL_FILE, JSON.stringify(pool));

  const rows = Object.entries(pool).map(([h, v]) => ({ h, ...v, ...(model ? { mp: +predict(h, model).toFixed(2) } : {}) }));
  const unsure = model ? rows.slice().sort((a, b) => Math.abs(a.mp - 0.5) - Math.abs(b.mp - 0.5)).slice(0, Math.round(n * 0.6)) : [];
  const pick = new Map(); for (const r of [...unsure, ...rows.sort(() => rnd() - 0.5)]) { if (pick.size >= n) break; pick.set(r.h, r); }
  fs.writeFileSync(outDir + '/label-queue.json', JSON.stringify([...pick.values()].map(r => ({ h: r.h, u: r.u, s: r.s, f: r.f, ...(r.mp != null ? { mp: r.mp } : {}) }))));
  fs.writeFileSync(outDir + '/label-pool.csv', 'headline,severity,source,url,label\n' + rows.sort((a, b) => b.d - a.d).map(r => [r.h, r.s, r.f, r.u, ''].map(csv).join(',')).join('\n') + '\n');
  return { pool: rows.length, queue: pick.size };
}
const require_dir = f => f.replace(/[\\/][^\\/]*$/, '') || '.';
