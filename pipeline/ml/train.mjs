// Train the headline classifier. Usage: npm run train
//   labels:  pipeline/ml/labels.json  { "headline": 1 | 0 }  made by people on the #review page (1 = real incident, 0 = not)
//   lang:    pipeline/ml/lang.json    { "headline": "es" }    language of each non-English labelled headline (others are English)
// A stable 20% of the labels (see split.mjs) is the gold set: it is never trained on, never used to choose settings, and is what `npm run eval` scores.
// Method: the TF-IDF and embedding models are fitted on the training rows; the final model that combines them learns from their
// out-of-fold predictions (5-fold), so it never sees a prediction made by a model that had trained on that headline.
// Writes pipeline/model.json. The classifier starts in "shadow" mode: it scores headlines but changes nothing until meta.mode is set to "gate".
// Env for testing: LABELS_FILE, MODEL_FILE.
import fs from 'node:fs';
import { predict as tfidfP } from './model.mjs';
import { fitTfidf, fitDense, denseP, logit } from './fit.mjs';
import { embedTexts, EMBED_MODEL, EMBED_DTYPE } from './embed.mjs';
import { stackFeatures } from './ensemble.mjs';
import { isGold } from './split.mjs';
import { ruleOf, langOf } from './rules.mjs';

const LABELS = process.env.LABELS_FILE || 'pipeline/ml/labels.json', MODEL_FILE = process.env.MODEL_FILE || 'pipeline/model.json', FOLDS = 5, MAX_DEMOTED = 0.05;
const human = fs.existsSync(LABELS) ? JSON.parse(fs.readFileSync(LABELS, 'utf8')) : {};
const rows = Object.entries(human).map(([t, y]) => { const r = ruleOf(t); return { t, y: +y, lang: langOf(t), s: r.s, th: r.th }; });
const held = rows.filter(r => isGold(r.t)), train = rows.filter(r => !isGold(r.t));
console.log(`labels: ${rows.length} (${rows.filter(r => r.lang !== 'en').length} non-English); train ${train.length}, gold (held out) ${held.length}`);
if (train.length < 100 || held.length < 20) { console.error('not enough human labels yet (need about 125+: 100 to train and 20 held out); label more on #review'); process.exit(1); }

const t0 = Date.now();
const E = new Map(); (await embedTexts(rows.map(r => r.t))).forEach((v, i) => E.set(rows[i].t, v));
console.log(`embedded ${rows.length} headlines in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
const embX = list => list.map(r => E.get(r.t)), ys = list => list.map(r => r.y);

// choose the embedding regularisation by cross-validation on the training rows
const folds = k => [train.filter((_, i) => i % FOLDS !== k), train.filter((_, i) => i % FOLDS === k)];
let L2 = 1e-3, bestAcc = -1;
for (const l2 of [1e-4, 1e-3, 3e-3, 1e-2]) {
  let ok = 0; for (let k = 0; k < FOLDS; k++) { const [tr, va] = folds(k), m = fitDense(embX(tr), ys(tr), { l2, epochs: 100 }); ok += va.filter(r => (denseP(m, E.get(r.t)) >= 0.5) === !!r.y).length; }
  if (ok > bestAcc) { bestAcc = ok; L2 = l2; }
}
console.log(`embedding l2 ${L2}`);

// out-of-fold base predictions on the training rows
const oof = new Map();
for (let k = 0; k < FOLDS; k++) {
  const [tr, va] = folds(k), tf = fitTfidf(tr), em = fitDense(embX(tr), ys(tr), { l2: L2, epochs: 200 });
  for (const r of va) oof.set(r.t, [logit(tfidfP(r.t, tf)), logit(denseP(em, E.get(r.t)))]);
}
const stackRow = (r, [zt, ze]) => stackFeatures(zt, ze, r);
// the final model is tiny (7 weights): pick its regularisation and training length by cross-validated log-loss on the out-of-fold rows
const SX = train.map(r => stackRow(r, oof.get(r.t))), SY = ys(train);
const logLoss = (m, X, y) => X.reduce((a, x, i) => { const p = Math.min(1 - 1e-6, Math.max(1e-6, denseP(m, x))); return a - (y[i] ? Math.log(p) : Math.log(1 - p)); }, 0) / X.length;
let SO = { l2: 1e-3, epochs: 400 }, bestLoss = Infinity;
for (const l2 of [1e-5, 1e-4, 1e-3]) for (const epochs of [400, 1500]) {
  let loss = 0; for (let k = 0; k < FOLDS; k++) { const tr = SX.map((_, i) => i).filter(i => i % FOLDS !== k), va = SX.map((_, i) => i).filter(i => i % FOLDS === k); loss += logLoss(fitDense(tr.map(i => SX[i]), tr.map(i => SY[i]), { l2, epochs, lr0: 0.5 }), va.map(i => SX[i]), va.map(i => SY[i])) / FOLDS; }
  if (loss < bestLoss) { bestLoss = loss; SO = { l2, epochs }; }
}
console.log(`final model: l2 ${SO.l2}, ${SO.epochs} epochs (cross-validated log-loss ${bestLoss.toFixed(3)})`);
const stack = fitDense(SX, SY, { ...SO, lr0: 0.5 });

// final base models on all training rows
const tfidf = fitTfidf(train), embed = fitDense(embX(train), ys(train), { l2: L2, epochs: 200 });
embed.w = embed.w.map(x => +x.toFixed(5)); embed.b = +embed.b.toFixed(5);
stack.w = stack.w.map(x => +x.toFixed(4)); stack.b = +stack.b.toFixed(4);
const pOf = r => { const zt = logit(tfidfP(r.t, tfidf)), ze = logit(denseP(embed, E.get(r.t))); return { zt, ze, p: denseP(stack, stackRow(r, [zt, ze])) }; };

// gate cut-off: the highest value that would have demoted at most 5% of real incidents among the training rows (out-of-fold)
const posP = train.filter(r => r.y).map(r => denseP(stack, stackRow(r, oof.get(r.t)))).sort((a, b) => a - b);
let gate = 0.05; for (let c = 0.05; c <= 0.5; c += 0.01) if (posP.filter(p => p < c).length <= MAX_DEMOTED * posP.length) gate = +c.toFixed(2);

// scores on the gold set
const pct = x => (x * 100).toFixed(1) + '%', div = (a, b) => (b ? a / b : 0);
const score = (name, set, pred) => {
  let tp = 0, fp = 0, fn = 0, tn = 0; for (const r of set) { const p = pred(r), y = r.y; if (p && y) tp++; else if (p && !y) fp++; else if (!p && y) fn++; else tn++; }
  const pr = div(tp, tp + fp), rc = div(tp, tp + fn);
  return { name, 'false alarms': fp, missed: fn, precision: pct(pr), recall: pct(rc), f1: pct(div(2 * pr * rc, pr + rc)), accuracy: pct((tp + tn) / set.length) };
};
const sc = new Map(held.map(r => [r.t, pOf(r)]));
const table = set => [
  score('rules', set, r => r.s >= 3),
  score('tf-idf alone', set, r => sc.get(r.t).zt >= 0),
  score('embeddings alone', set, r => sc.get(r.t).ze >= 0),
  score('combined (p>=0.5)', set, r => sc.get(r.t).p >= 0.5),
  score(`rules + combined gate (p<${gate})`, set, r => r.s >= 3 && !(sc.get(r.t).p < gate && !['unrest', 'politics'].includes(r.th)))
];
for (const [label, set] of [['ALL', held], ['English', held.filter(r => r.lang === 'en')], ['non-English', held.filter(r => r.lang !== 'en')]]) {
  if (set.length) { console.log(`\n${label} gold: ${set.length} headlines (${set.filter(r => r.y).length} incident)`); console.table(table(set)); }
}
console.log('final-model weights:', stack.w.join(', '), '| bias', stack.b, '| features: tfidf(en), tfidf(non-en), embeddings, rule>=3, rule>=4, unrest/politics, english');

const prev = fs.existsSync(MODEL_FILE) ? JSON.parse(fs.readFileSync(MODEL_FILE, 'utf8')) : null;
const model = { tfidf, embed: { model: EMBED_MODEL, dtype: EMBED_DTYPE, w: embed.w, b: embed.b }, stack: { w: stack.w, b: stack.b },
  meta: { trained: new Date().toISOString(), human: rows.length, nonEnglish: rows.filter(r => r.lang !== 'en').length, gold: held.length, gate, mode: prev?.meta?.mode || 'shadow',
    metrics: { combined: table(held)[3] } } };
fs.writeFileSync(MODEL_FILE, JSON.stringify(model));
console.log(`\nwrote ${MODEL_FILE}, mode ${model.meta.mode}, gate cut-off ${gate}, ${Math.round(JSON.stringify(model).length / 1024)} KB`);
