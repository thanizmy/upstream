// One-off: build public/world.json (simplified country outlines, equirectangular, lat 84..-58) from world-countries.
// Usage: node pipeline/mkmap.mjs
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const raw = require('world-countries');
const W = 1000, LAT0 = 84, LAT1 = -58, H = Math.round(W / 360 * (LAT0 - LAT1));
const X = lo => (lo + 180) / 360 * W, Y = la => (LAT0 - la) / (LAT0 - LAT1) * H;

function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1e-9;
  let max = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len;
    if (d > max) { max = d; idx = i; }
  }
  if (max <= eps) return [pts[0], pts[pts.length - 1]];
  return [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)];
}
const area = r => { let a = 0; for (let i = 0; i < r.length; i++) { const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % r.length]; a += x1 * y2 - x2 * y1; } return Math.abs(a / 2); };

const out = {};
let bytes = 0;
for (const c of raw) {
  const f = `node_modules/world-countries/data/${c.cca3.toLowerCase()}.geo.json`;
  if (!fs.existsSync(f)) continue;
  const g = JSON.parse(fs.readFileSync(f, 'utf8')).features[0]?.geometry;
  if (!g) continue;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  const rings = polys.map(p => p[0]).filter(r => r.length > 3);
  const big = Math.max(...rings.map(area));
  let d = '';
  for (const r of rings) {
    const a = area(r);
    if (a < 0.35 && a < big) continue; // drop specks, keep the main landmass
    const eps = a > 20 ? 0.25 : 0.12, m = r.length >> 1, pr = r.map(([lo, la]) => [lo, la]); const s = [...rdp(pr.slice(0, m + 1), eps).slice(0, -1), ...rdp(pr.slice(m), eps)];
    if (s.length < 3) continue;
    d += 'M' + s.map(([lo, la]) => X(lo).toFixed(1) + ' ' + Y(Math.max(LAT1, Math.min(LAT0, la))).toFixed(1)).join('L') + 'Z';
  }
  if (d) { out[c.cca2] = d; bytes += d.length; }
}
fs.writeFileSync('public/world.json', JSON.stringify({ w: W, h: H, paths: out }));
console.log('countries', Object.keys(out).length, 'KB', Math.round(bytes / 1024), 'viewBox', W, H);
