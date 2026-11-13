// Builds the labelling queue shown on the #review page: recent serious English headlines nobody has labelled yet.
// With a trained model, 60% are the ones it is least sure about (closest to 50%) and 40% are random, so labels also check the confident cases.
import fs from 'node:fs';

export function buildQueue(items, model, now, file, n = 150) {
  const human = fs.existsSync('pipeline/ml/labels.json') ? JSON.parse(fs.readFileSync('pipeline/ml/labels.json', 'utf8')) : {};
  const seen = new Set();
  const pool = items.filter(i => !i.l && !i.a && i.s >= 3 && now - i.d <= 4 * 864e5 && human[i.t] == null && !seen.has(i.t) && seen.add(i.t));
  const rnd = (seed => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)(Math.floor(now / 864e5));
  const shuffled = pool.slice().sort(() => rnd() - 0.5);
  const unsure = model ? pool.slice().sort((a, b) => Math.abs((a.mp ?? 0.5) - 0.5) - Math.abs((b.mp ?? 0.5) - 0.5)).slice(0, Math.round(n * 0.6)) : [];
  const pick = new Map(); for (const i of [...unsure, ...shuffled]) { if (pick.size >= n) break; pick.set(i.t, i); }
  const out = [...pick.values()].map(i => ({ h: i.t, u: i.u, s: i.s, f: i.f, ...(i.mp != null ? { mp: i.mp } : {}) }));
  fs.writeFileSync(file, JSON.stringify(out));
  return out.length;
}
