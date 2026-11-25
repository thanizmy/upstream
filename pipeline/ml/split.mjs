// Stable train / gold split. A headline is in the gold set when its hash falls in the held-out bucket, so the
// same headlines stay held out across every retrain and the model never sees them while training.
export const GOLD_SHARE = 5; // 1 in 5 human labels (about 20%) is held out
const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
export const isGold = headline => hash(String(headline)) % GOLD_SHARE === 0;
