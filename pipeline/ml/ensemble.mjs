// The combined classifier: is this headline a real incident? Three signals feed a small final model.
//   1. TF-IDF + logistic regression (good on English words it has seen)
//   2. multilingual embeddings + logistic regression (carries meaning across languages)
//   3. the rule severity and theme, so the final model learns how far to trust each signal per language
// pipeline/model.json holds all the weights; `npm run train` writes it.
import fs from 'node:fs';
import { predict as tfidfP } from './model.mjs';
import { logit, denseP } from './fit.mjs';

export const EXEMPT_THEMES = new Set(['unrest', 'politics']); // protests and political crises keep their rule severity

export function loadEnsemble(file = new URL('../model.json', import.meta.url)) {
  try { const m = JSON.parse(fs.readFileSync(file, 'utf8')); return m.stack ? m : null; } catch { return null; }
}

/** Inputs to the final model. zt, ze: logit of each base model; item: { lang, s (rule severity), th }. */
export const stackFeatures = (zt, ze, { lang = 'en', s, th }) => {
  const en = lang === 'en' ? 1 : 0;
  return [zt * en, zt * (1 - en), ze, s >= 3 ? 1 : 0, s >= 4 ? 1 : 0, EXEMPT_THEMES.has(th) ? 1 : 0, en];
};

/** Probability of "real incident" for each item { t, lang, s, th }, or null when the embedding model cannot be loaded. */
export async function scoreItems(ens, items) {
  if (!items.length) return [];
  let emb;
  // a hung download or a slow runner must not hold the build: give up after EMBED_TIMEOUT_MS (run.mjs then keeps every score as it was)
  const limit = Number(process.env.EMBED_TIMEOUT_MS) || 15 * 60 * 1000; let timer;
  try {
    const { embedTexts } = await import('./embed.mjs');
    emb = await Promise.race([embedTexts(items.map(i => i.t)), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timed out after ' + Math.round(limit / 1000) + 's')), limit); })]);
  } catch (e) { console.warn('embedding model unavailable, classifier skipped:', e.message); return null; }
  finally { clearTimeout(timer); }
  return items.map((it, k) => denseP(ens.stack, stackFeatures(logit(tfidfP(it.t, ens.tfidf)), logit(denseP(ens.embed, emb[k])), it)));
}
