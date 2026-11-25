// Multilingual sentence embeddings, run locally (no API, no cost). The first use downloads the model (about 100 MB) to .cache/models.
// Loaded on demand, so the rest of the pipeline works without it.
import { pipeline, env } from '@huggingface/transformers';

env.cacheDir = process.env.MODEL_CACHE || '.cache/models';
export const EMBED_MODEL = 'Xenova/multilingual-e5-small', EMBED_DTYPE = 'q8';
let extractor;

/** Unit-length embeddings, one per text. e5 models expect the "query: " prefix. */
export async function embedTexts(texts, batch = 32) {
  extractor ||= await pipeline('feature-extraction', EMBED_MODEL, { dtype: EMBED_DTYPE });
  const out = [];
  for (let i = 0; i < texts.length; i += batch) {
    const r = await extractor(texts.slice(i, i + batch).map(t => 'query: ' + t), { pooling: 'mean', normalize: true });
    const d = r.dims[1];
    for (let k = 0; k < r.dims[0]; k++) out.push(Array.from(r.data.slice(k * d, (k + 1) * d)));
  }
  return out;
}
