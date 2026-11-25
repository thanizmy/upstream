// Score the severity rules and the classifier against the human-labelled gold set. Usage: npm run eval
//   gold set:  the stable 20% of pipeline/ml/labels.json that train.mjs never trains on (see split.mjs)
//   severity:  pipeline/ml/severity.json { "headline": 1..5 }, optional; adds an exact-severity comparison for the rules
// "Serious" means severity >= 3, the level that feeds the country score. The question the harness answers:
// of the headlines the rules call serious, how many does a person say are not incidents, and does the classifier catch them?
// Env for testing: LABELS_FILE, SEVERITY_FILE, MODEL_FILE.
import fs from 'node:fs';
import { loadEnsemble, scoreItems, EXEMPT_THEMES } from './ensemble.mjs';
import { isGold } from './split.mjs';
import { ruleOf, langOf } from './rules.mjs';

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const labels = readJson(process.env.LABELS_FILE || 'pipeline/ml/labels.json', {});
const sev = readJson(process.env.SEVERITY_FILE || 'pipeline/ml/severity.json', {});
const ens = loadEnsemble(process.env.MODEL_FILE || undefined);
const GATE = ens?.meta.gate ?? 0.2; // the cut-off stored with the model, the same one run.mjs uses

const gold = Object.entries(labels).filter(([t]) => isGold(t)).map(([t, y]) => { const r = ruleOf(t); return { t, y: +y, rule: r.s, th: r.th, lang: langOf(t), p: null, hs: sev[t] }; });
console.log(`gold set: ${gold.length} headlines (${gold.filter(g => g.y).length} incident, ${gold.filter(g => !g.y).length} not), ${Object.keys(labels).length} human labels in total`);
if (gold.length < 20) { console.error('gold set too small to mean anything (need 20+); label more on #review'); process.exit(1); }
if (ens) { const ps = await scoreItems(ens, gold.map(g => ({ t: g.t, lang: g.lang, s: g.rule, th: g.th }))); ps?.forEach((p, i) => { gold[i].p = p; }); }
const model = ens && gold[0].p != null;
const gated = g => g.rule >= 3 && g.p < GATE && !EXEMPT_THEMES.has(g.th); // true when the gate would demote this headline to 2

const pct = x => (x * 100).toFixed(1) + '%', div = (a, b) => (b ? a / b : 0);
const score = (name, pred, set = gold) => {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const g of set) { const p = pred(g); if (p && g.y) tp++; else if (p && !g.y) fp++; else if (!p && g.y) fn++; else tn++; }
  const precision = div(tp, tp + fp), recall = div(tp, tp + fn), f1 = div(2 * precision * recall, precision + recall);
  return { name, 'flagged serious': tp + fp, 'false alarms': fp, 'missed incidents': fn, precision: pct(precision), recall: pct(recall), f1: pct(f1) };
};
const table = set => {
  const rows = [score('rules (current)', g => g.rule >= 3, set)];
  if (model) { rows.push(score('classifier alone (p>=0.5)', g => g.p >= 0.5, set)); rows.push(score(`rules + gate (p<${GATE} demotes; unrest/politics exempt)`, g => g.rule >= 3 && !gated(g), set)); }
  return rows;
};
if (!model) console.log('no model.json found: only the rules are scored (run npm run train)');
for (const [label, set] of [['ALL', gold], ['English', gold.filter(g => g.lang === 'en')], ['non-English', gold.filter(g => g.lang !== 'en')]]) {
  if (set.length) { console.log(`\n${label}: ${set.length} gold headlines (${set.filter(g => g.y).length} incident)`); console.table(table(set)); }
}

const fa = g => g.rule >= 3 && !g.y;
console.log('\nfalse alarms by the rules (serious, but a person says not an incident):');
gold.filter(fa).sort((a, b) => (b.p ?? 0) - (a.p ?? 0)).slice(0, 15).forEach(g => console.log(`  rule ${g.rule}${g.p != null ? '  model ' + g.p.toFixed(2) + (gated(g) ? ' (gate would fix)' : ' (gate would miss)') : ''}  ${g.t}`));
if (model) {
  const lost = gold.filter(g => g.y && gated(g));
  console.log(`\nreal incidents the gate would wrongly demote: ${lost.length}`); lost.slice(0, 10).forEach(g => console.log(`  rule ${g.rule}  model ${g.p.toFixed(2)}  ${g.t}`));
  const dem = gold.filter(g => !g.y && g.hs >= 3 && gated(g));
  console.log(`rated severity 3+ but not an incident, and the gate would demote to 2: ${dem.length}`);
}

// exact severity, where a person gave one (the rules only; the classifier does not predict severity yet)
const sg = gold.filter(g => g.hs != null);
if (sg.length) {
  const exact = sg.filter(g => g.rule === g.hs).length, mae = sg.reduce((a, g) => a + Math.abs(g.rule - g.hs), 0) / sg.length;
  console.log(`\nseverity labels in gold set: ${sg.length}. Rules: exact ${pct(exact / sg.length)}, mean absolute error ${mae.toFixed(2)}`);
}
