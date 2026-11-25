// The rule severity for a labelled headline, the way run.mjs would score it: local-language headlines go through classifyLocal, English through classify.
// pipeline/ml/lang.json maps a non-English headline to its language code; any headline not listed is English.
import fs from 'node:fs';
import { classify } from '../classify.mjs';
import { classifyLocal, supports } from '../classify-local.mjs';

let LANG = {}; try { LANG = JSON.parse(fs.readFileSync(new URL('./lang.json', import.meta.url), 'utf8')); } catch {}
export const langOf = t => LANG[t] || 'en';
export const ruleOf = t => { const l = langOf(t); return l !== 'en' && supports(l) ? classifyLocal(t, '', l) : l !== 'en' ? { s: 2, th: 'other' } : classify(t, ''); };
