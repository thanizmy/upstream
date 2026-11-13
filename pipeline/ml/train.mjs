// Train the headline classifier. Usage: npm run train   (env: HISTORY_FILE, default .cache/history.json or public/data/history.json)
//   labels:  pipeline/ml/labels.json  { "headline": 1 | 0 }  made by people on the #review page (1 = real incident, 0 = not)
//   weak:    labels derived from the rule guards in classify.mjs (figures of speech, past events, good news = 0; clear death counts = 1), weighted lower
// Writes pipeline/model.json. The model starts in "shadow" mode: it scores headlines but changes nothing until meta.mode is set to "gate".
import fs from 'node:fs';
import { tokens, vectorize, predict } from './model.mjs';
import { guardReason, strongIncident } from '../classify.mjs';

const HUMAN_W = 1, WEAK_W = 0.3, MIN_DF = 2, MAX_FEATURES = 20000, EPOCHS = 40, L2 = 2e-5;
const rnd = (seed => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)(42);

const human = fs.existsSync('pipeline/ml/labels.json') ? JSON.parse(fs.readFileSync('pipeline/ml/labels.json', 'utf8')) : {};
const histFile = [process.env.HISTORY_FILE, '.cache/history.json', 'public/data/history.json'].find(f => f && fs.existsSync(f));
const hist = histFile ? JSON.parse(fs.readFileSync(histFile, 'utf8')).items : [];

// weak labels from the rules, English headlines only
const weak = {};
for (const i of hist) {
  if (i.l || i.a || human[i.t] != null || weak[i.t] != null) continue;
  if (guardReason(i.t)) weak[i.t] = 0; else if (strongIncident(i.t)) weak[i.t] = 1;
}
let rows = [
  ...Object.entries(human).map(([t, y]) => ({ t, y: +y, w: HUMAN_W, h: 1 })),
  ...Object.entries(weak).map(([t, y]) => ({ t, y, w: WEAK_W, h: 0 }))
];
// balance the weak labels: there are far more clear incidents than guarded headlines
const pos = rows.filter(r => !r.h && r.y === 1), neg = rows.filter(r => !r.h && r.y === 0);
if (pos.length > neg.length * 3) { pos.sort(() => rnd() - 0.5); const keep = new Set(pos.slice(0, neg.length * 3)); rows = rows.filter(r => r.h || r.y === 0 || keep.has(r)); }
console.log(`labels: ${Object.keys(human).length} human, weak ${rows.filter(r => !r.h && r.y === 1).length} incident + ${rows.filter(r => !r.h && r.y === 0).length} not`);
if (rows.length < 100) { console.error('not enough labels yet (need 100+); label more on #review'); process.exit(1); }

// hold out 20% (of the human labels when there are 50+, otherwise of everything) for evaluation
rows.sort(() => rnd() - 0.5);
const pool = rows.filter(r => r.h).length >= 50 ? rows.filter(r => r.h) : rows;
const test = new Set(pool.slice(0, Math.max(20, Math.floor(pool.length * 0.2))));
const train = rows.filter(r => !test.has(r)), held = [...test];

// vocabulary and idf from the training rows
const df = new Map();
for (const r of train) for (const tk of new Set(tokens(r.t))) df.set(tk, (df.get(tk) || 0) + 1);
const vocabList = [...df].filter(([, c]) => c >= MIN_DF).sort((a, b) => b[1] - a[1]).slice(0, MAX_FEATURES);
const model = { vocab: {}, idf: [], w: new Array(vocabList.length).fill(0), b: 0 };
vocabList.forEach(([tk, c], i) => { model.vocab[tk] = i; model.idf.push(+(Math.log((1 + train.length) / (1 + c)) + 1).toFixed(4)); });

// logistic regression by stochastic gradient descent
const X = train.map(r => vectorize(r.t, model));
for (let ep = 0; ep < EPOCHS; ep++) {
  const lr = 1.5 / (1 + ep * 0.15), order = X.map((_, i) => i).sort(() => rnd() - 0.5);
  for (const k of order) {
    let z = model.b; for (const [i, x] of X[k]) z += model.w[i] * x;
    const g = (1 / (1 + Math.exp(-z)) - train[k].y) * train[k].w;
    model.b -= lr * g; for (const [i, x] of X[k]) model.w[i] -= lr * (g * x + L2 * model.w[i]);
  }
}
model.w = model.w.map(x => +x.toFixed(4)); model.b = +model.b.toFixed(4);

// evaluation on the held-out rows
const ev = list => {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const r of list) { const p = predict(r.t, model) >= 0.5 ? 1 : 0; if (p && r.y) tp++; else if (p && !r.y) fp++; else if (!p && r.y) fn++; else tn++; }
  const pr = (a, b) => (a + b ? a / (a + b) : 0);
  return { n: list.length, accuracy: +((tp + tn) / list.length).toFixed(3), incidentPrecision: +pr(tp, fp).toFixed(3), incidentRecall: +pr(tp, fn).toFixed(3), notIncidentPrecision: +pr(tn, fn).toFixed(3), notIncidentRecall: +pr(tn, fp).toFixed(3), tp, fp, fn, tn };
};
const metrics = ev(held);
console.log('held-out:', metrics);
console.log('missed incidents (model says no):'); held.filter(r => r.y && predict(r.t, model) < 0.5).slice(0, 8).forEach(r => console.log('  ', r.t));
console.log('false alarms (model says incident):'); held.filter(r => !r.y && predict(r.t, model) >= 0.5).slice(0, 8).forEach(r => console.log('  ', r.t));

const prev = fs.existsSync('pipeline/model.json') ? JSON.parse(fs.readFileSync('pipeline/model.json', 'utf8')) : null;
model.meta = { trained: new Date().toISOString(), human: Object.keys(human).length, weak: rows.length - Object.keys(human).length, features: vocabList.length, metrics, mode: prev?.meta?.mode || 'shadow' };
fs.writeFileSync('pipeline/model.json', JSON.stringify(model));
console.log('wrote pipeline/model.json, mode:', model.meta.mode, ', size', Math.round(JSON.stringify(model).length / 1024), 'KB');
