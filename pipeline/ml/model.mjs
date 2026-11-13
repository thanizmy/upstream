// Headline classifier: is this headline a real incident (1) or not (0)?
// TF-IDF over words and word pairs + logistic regression, in plain JavaScript. No network, no API, no AI service.
// pipeline/model.json holds the trained vocabulary and weights; train it with `npm run train`.
import fs from 'node:fs';

export const tokens = t => {
  const w = String(t).toLowerCase().replace(/\d[\d,.]*/g, ' 0 ').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const out = w.slice();
  for (let i = 0; i + 1 < w.length; i++) out.push(w[i] + '_' + w[i + 1]);
  return out;
};

/** Sparse TF-IDF vector as [index, value] pairs, L2-normalised; unknown tokens are ignored. */
export function vectorize(title, model) {
  const tf = new Map();
  for (const tk of tokens(title)) { const i = model.vocab[tk]; if (i != null) tf.set(i, (tf.get(i) || 0) + 1); }
  const v = []; let n = 0;
  for (const [i, c] of tf) { const x = (1 + Math.log(c)) * model.idf[i]; v.push([i, x]); n += x * x; }
  n = Math.sqrt(n) || 1;
  return v.map(([i, x]) => [i, x / n]);
}

export const predict = (title, model) => {
  let z = model.b; for (const [i, x] of vectorize(title, model)) z += model.w[i] * x;
  return 1 / (1 + Math.exp(-z)); // probability that the headline is a real incident
};

export function loadModel(file = new URL('../model.json', import.meta.url)) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
