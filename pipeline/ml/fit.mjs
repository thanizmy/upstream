// Training helpers shared by train.mjs: a seeded random generator, TF-IDF + logistic regression, and plain logistic regression on dense features.
import { tokens, vectorize } from './model.mjs';

export const sigmoid = z => 1 / (1 + Math.exp(-z));
export const logit = p => { p = Math.min(1 - 1e-4, Math.max(1e-4, p)); return Math.log(p / (1 - p)); };
export const rng = seed => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const shuffled = (a, rnd) => a.map(x => [rnd(), x]).sort((p, q) => p[0] - q[0]).map(x => x[1]);

/** TF-IDF (words and word pairs) + logistic regression. rows: [{t, y}]. */
export function fitTfidf(rows, { minDf = 2, maxFeatures = 20000, epochs = 40, l2 = 2e-5, seed = 42 } = {}) {
  const rnd = rng(seed), df = new Map();
  for (const r of rows) for (const tk of new Set(tokens(r.t))) df.set(tk, (df.get(tk) || 0) + 1);
  const list = [...df].filter(([, c]) => c >= minDf).sort((a, b) => b[1] - a[1]).slice(0, maxFeatures);
  const m = { vocab: {}, idf: [], w: new Array(list.length).fill(0), b: 0 };
  list.forEach(([tk, c], i) => { m.vocab[tk] = i; m.idf.push(+(Math.log((1 + rows.length) / (1 + c)) + 1).toFixed(4)); });
  const X = rows.map(r => vectorize(r.t, m));
  for (let ep = 0; ep < epochs; ep++) {
    const lr = 1.5 / (1 + ep * 0.15);
    for (const k of shuffled(X.map((_, i) => i), rnd)) {
      let z = m.b; for (const [i, x] of X[k]) z += m.w[i] * x;
      const g = sigmoid(z) - rows[k].y;
      m.b -= lr * g; for (const [i, x] of X[k]) m.w[i] -= lr * (g * x + l2 * m.w[i]);
    }
  }
  m.w = m.w.map(x => +x.toFixed(4)); m.b = +m.b.toFixed(4);
  return m;
}

/** Logistic regression on dense vectors by SGD. X: number[][], y: 0|1[]. Returns {w, b}. */
export function fitDense(X, y, { l2 = 1e-3, epochs = 200, lr0 = 0.5, decay = 0.05, seed = 7 } = {}) {
  const rnd = rng(seed), d = X[0].length, w = new Array(d).fill(0); let b = 0;
  for (let ep = 0; ep < epochs; ep++) {
    const lr = lr0 / (1 + ep * decay);
    for (const k of shuffled(X.map((_, i) => i), rnd)) {
      let z = b; for (let j = 0; j < d; j++) z += w[j] * X[k][j];
      const g = sigmoid(z) - y[k];
      b -= lr * g; for (let j = 0; j < d; j++) w[j] -= lr * (g * X[k][j] + l2 * w[j]);
    }
  }
  return { w, b };
}
export const denseP = (m, x) => { let z = m.b; for (let j = 0; j < m.w.length; j++) z += m.w[j] * x[j]; return sigmoid(z); };
