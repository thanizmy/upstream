// The labelled data, as a growing training set. Usage: npm run dataset [-- --write]
// Prints how much labelled data there is and whether it is enough to fine-tune a multilingual model instead of using frozen embeddings.
// With --write it exports pipeline/ml/finetune.jsonl: { text, label, severity, lang, split } per line, ready for a fine-tuning job.
// The data itself lives in labels.json, severity.json and lang.json (all committed); every `npm run import-labels` grows it.
// Only human labels go in. Never add the classifier's own predictions as labels: it would learn its own mistakes, and the gold set would stop meaning anything.
import fs from 'node:fs';
import { isGold } from './split.mjs';
import { langOf } from './rules.mjs';

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const labels = readJson('pipeline/ml/labels.json', {}), sev = readJson('pipeline/ml/severity.json', {});
// rules of thumb for fine-tuning a small multilingual encoder: thousands of examples, not hundreds, and enough in each language and each class
const NEED = { total: 3000, nonEnglish: 1200, perLanguage: 100, minClassShare: 0.3 };

const rows = Object.entries(labels).map(([t, y]) => ({ text: t, label: +y, severity: sev[t] ?? null, lang: langOf(t), split: isGold(t) ? 'gold' : 'train' }));
const by = {}; for (const r of rows) (by[r.lang] ||= []).push(r);
const inc = rows.filter(r => r.label).length, ne = rows.filter(r => r.lang !== 'en').length;
const langs = Object.entries(by).sort((a, b) => b[1].length - a[1].length);
console.log(`labelled headlines: ${rows.length} (${inc} incident, ${rows.length - inc} not); ${ne} non-English; gold ${rows.filter(r => r.split === 'gold').length}`);
console.table(Object.fromEntries(langs.map(([l, v]) => [l, { labelled: v.length, incident: v.filter(r => r.label).length, gold: v.filter(r => r.split === 'gold').length }])));
const checks = [
  [`total >= ${NEED.total}`, rows.length >= NEED.total, `${rows.length}`],
  [`non-English >= ${NEED.nonEnglish}`, ne >= NEED.nonEnglish, `${ne}`],
  [`each class >= ${NEED.minClassShare * 100}% of the data`, Math.min(inc, rows.length - inc) >= NEED.minClassShare * rows.length, `${(Math.min(inc, rows.length - inc) / rows.length * 100).toFixed(0)}%`],
  [`languages with >= ${NEED.perLanguage} labels`, langs.filter(([, v]) => v.length >= NEED.perLanguage).length >= 5, `${langs.filter(([, v]) => v.length >= NEED.perLanguage).length} (want 5+)`]
];
for (const [name, ok, have] of checks) console.log(`${ok ? 'ok ' : 'NO '} ${name}: ${have}`);
console.log(checks.every(c => c[1]) ? '\nEnough data to try fine-tuning.' : '\nNot enough data to fine-tune yet; keep labelling on #review (the queue mixes in other languages and the headlines the classifier is least sure about).');
if (process.argv.includes('--write')) {
  fs.writeFileSync('pipeline/ml/finetune.jsonl', rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  console.log(`wrote ${rows.length} rows to pipeline/ml/finetune.jsonl`);
}
