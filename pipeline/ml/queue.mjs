// Collects headlines to label, a few more on every refresh, and serves them on the #review page. This is how the training data grows.
//   .cache/label-pool.json  persistent pool of unlabelled headlines in every language (kept in the Actions cache with the history; capped, oldest dropped first)
//   data/label-queue.json   a batch from the pool for the #review page: 60% English / 40% other languages, and within each the headlines the classifier is least sure about come first
//   data/label-pool.csv     the whole pool as a spreadsheet (headline, severity = the rules' score, source, url, lang, label, human_severity): fill label with 1 / 0 and, optionally, human_severity with 1-5, then run `npm run import-labels`
import fs from 'node:fs';

const POOL_FILE = process.env.POOL_FILE || '.cache/label-pool.json', CAP = 6000, KEEP_DAYS = 45, NON_EN_SHARE = 0.4;
const csv = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';

export function buildQueue(items, now, outDir, n = 300) {
  const human = fs.existsSync('pipeline/ml/labels.json') ? JSON.parse(fs.readFileSync('pipeline/ml/labels.json', 'utf8')) : {};
  let pool = {};
  try { pool = JSON.parse(fs.readFileSync(POOL_FILE, 'utf8')); } catch { /* first run */ }
  const rnd = (seed => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)(Math.floor(now / 36e5));
  // today's candidates: every serious headline, plus a sample of the rest so there are plenty of "not an incident" examples
  for (const i of items) {
    if (i.a || human[i.t] != null || now - i.d > 4 * 864e5) continue;
    if (pool[i.t]) { if (i.mp != null) pool[i.t].mp = i.mp; continue; }
    if (i.s >= 3 || (i.sg != null) || rnd() < 0.15) pool[i.t] = { u: i.u, s: i.sg ?? i.s, f: i.f, d: i.d, ...(i.l ? { l: i.l } : {}), ...(i.mp != null ? { mp: i.mp } : {}) };
  }
  for (const t of Object.keys(pool)) if (human[t] != null || now - pool[t].d > KEEP_DAYS * 864e5) delete pool[t];
  const keys = Object.keys(pool);
  if (keys.length > CAP) keys.sort((a, b) => pool[a].d - pool[b].d).slice(0, keys.length - CAP).forEach(t => delete pool[t]);
  fs.mkdirSync(dirOf(POOL_FILE), { recursive: true });
  fs.writeFileSync(POOL_FILE, JSON.stringify(pool));

  const rows = Object.entries(pool).map(([h, v]) => ({ h, ...v }));
  // within a group: the least certain headlines first (60%), then random ones
  const take = (list, k) => {
    const scored = list.filter(r => r.mp != null).sort((a, b) => Math.abs(a.mp - 0.5) - Math.abs(b.mp - 0.5)).slice(0, Math.round(k * 0.6));
    const out = new Map(scored.map(r => [r.h, r]));
    for (const r of list.slice().sort(() => rnd() - 0.5)) { if (out.size >= k) break; out.set(r.h, r); }
    return [...out.values()];
  };
  const ne = rows.filter(r => r.l), en = rows.filter(r => !r.l);
  const kNe = Math.min(ne.length, Math.round(n * NON_EN_SHARE)), pickNe = take(ne, kNe), pickEn = take(en, n - pickNe.length);
  const picked = [...pickEn, ...pickNe].sort(() => rnd() - 0.5);
  fs.writeFileSync(outDir + '/label-queue.json', JSON.stringify(picked.map(r => ({ h: r.h, u: r.u, s: r.s, f: r.f, ...(r.l ? { l: r.l } : {}), ...(r.mp != null ? { mp: r.mp } : {}) }))));
  fs.writeFileSync(outDir + '/label-pool.csv', 'headline,severity,source,url,lang,label,human_severity\n' + rows.sort((a, b) => b.d - a.d).map(r => [r.h, r.s, r.f, r.u, r.l || 'en', '', ''].map(csv).join(',')).join('\n') + '\n');
  return { pool: rows.length, nonEnglish: ne.length, queue: picked.length };
}
const dirOf = f => f.replace(/[\\/][^\\/]*$/, '') || '.';
