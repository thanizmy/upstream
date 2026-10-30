// Rule-based severity (1-5) and theme for a report. Deliberately transparent: every rule is a regex.
const R = s => new RegExp(s, 'i');

const SPORT = R('\\b(football|soccer|cricket|rugby|tennis|golf|league|striker|goalkeeper|tournament|olympic|fifa|premier league|world cup|marathon|box office|movie|film|celebrity|fashion|recipe|concert|album|netflix|oscars?|grammy|horoscope|travel guide|best hotels?)\\b');
const MASS = R('\\b(massacre|genocide|mass (grave|killing|shooting)|famine (declared|conditions)|coup|crimes against humanity|ethnic cleansing|city (falls|captured)|(tsunami|catastrophic (earthquake|flood)))\\b');
const KILL = R('\\b(kill(s|ed|ing)?|dead|dies|died|death toll|deaths|massacred|slain|murdered|martyr(s|ed)?|executed|beheaded|casualt(y|ies)|fatalit(y|ies))\\b');
const VIOLENCE = R('\\b(airstrike|air strike|shelling|bombing|bomb(s|ed)?|suicide (bomber|attack)|gunmen|militants?|insurgents?|rebels?|terror(ist)?s?|missile|drone strike|ambush|hostages?|abduct(ed|ion|s)?|kidnap(ped|ping|s)?|siege|offensive|invasion|clashes|assault|stabbing|attack(s|ed)?|war)\\b');
const DISASTER = R('\\b(fire (destroys?|destroyed|ravages?|ravaged|guts?|gutted|sweeps?|swept|breaks? out|broke out)|(house|building|factory|market|forest|apartment|warehouse|hospital|shop) fire|crash(es|ed)?|collision|derail\\w*|collapse(d|s)?|explosion|blaze|earthquake|quake|tsunami|flood(s|ing|ed)?|cyclone|hurricane|typhoon|landslide|wildfire|volcano|eruption|drought|heatwave|storm)\\b');
const HEALTH = R('\\b(outbreak|cholera|ebola|marburg|measles|malaria|dengue|mpox|epidemic|pandemic|polio|plague|anthrax|bird flu|h5n1|meningitis|lassa)\\b');
const HUNGER = R('\\b(famine|starvation|starving|hunger|food insecurity|malnutrition|food crisis|ipc phase)\\b');
const PERSECUTE = R('\\b(christians?|churches|church|pastors?|believers|converts?|missionar(y|ies)|persecut\\w*|blasphemy|religious freedom|apostasy|evangelical|bishop|priest|nuns?)\\b');
const PERSECUTE_HARM = R('\\b(attack(s|ed)?|killed|burn(ed|t)?|arrest(ed|s)?|jail(ed)?|imprison(ed)?|detain(ed|s)?|abduct(ed)?|kidnap(ped)?|raid(ed|s)?|banned|bomb\\w*|sentenced|charged|forced|expelled|deport\\w*|threat\\w*|torture\\w*|persecut\\w*|harass\\w*|massacre\\w*)\\b');
const DISPLACE = R('\\b(refugees?|displaced|displacement|fleeing|flee(s)?|asylum|migrants?|evacuat\\w+|exodus|stateless)\\b');
const UNREST = R('\\b(protest(s|ers)?|riot(s|ers)?|unrest|crackdown|curfew|state of emergency|martial law|demonstrat\\w+|tear gas|strike(s)?|uprising|opposition leader|election violence|disputed election|junta)\\b');
const POLITICS = R('\\b(election|parliament|minister|president|prime minister|talks|sanctions|summit|treaty|ceasefire|negotiat\\w+|diplomat\\w*|government|vote|referendum)\\b');
const HARM_STRONG = R('\\b(emergency|crisis|catastrophe|devastat\\w+|collapse|humanitarian|urgent|warns?|appeals? for)\\b');
// a declared emergency or a clearly large disaster; "killed" with no number and no such signal stays at severity 3
const EMERGENCY = R('\\b(state of emergency|declares? (a )?(national |state of )?(emergency|disaster)|catastroph\\w+|devastat\\w+|humanitarian (crisis|emergency)|thousands (displaced|homeless|evacuated)|mass evacuation)\\b');
const bigQuake = t => { const m = t.match(/\b(?:magnitude|M)\s?(\d(?:\.\d)?)\b/); return !!m && parseFloat(m[1]) >= 6; };
// Signs that something actually went wrong, and signs the story is about heritage, culture or a rehearsal, not an incident.
const HARM = R('\\b(injur\\w+|wounded|hurt|dead|deaths?|killed|casualt\\w+|damag\\w+|destroy\\w+|evacuat\\w+|homeless|missing|trapped|stranded|collaps\\w+|razed|emergency|rescu\\w+|victims?|hospitali[sz]\\w+|displaced|death toll|fatalit\\w+)\\b');
const SOFT = R('\\b(heritage|museum|anniversary|exhibit\\w*|festival|documentary|memorial|commemorat\\w+|historic\\w*|ancient|tourist\\w*|tourism|monument|recipe|video game|movie|film|novel|theme park|simulation|drill|exercise)\\b');
const NUM_DEAD = /\b(\d{1,3}(?:,\d{3})*|\d+)\s+(?:people\s+|civilians\s+|children\s+|worshippers\s+|soldiers\s+)?(?:have been\s+|were\s+|are\s+)?(?:killed|dead|dies|died|lives lost|fatalities)\b/i;
const DEAD_NUM = /\b(?:kill(?:s|ed|ing)|leaves?|left|claims?)\s+(?:at least\s+|over\s+|more than\s+)?(\d{1,3}(?:,\d{3})*|\d+)\b/i;
const WORDNUM = { dozens: 24, scores: 40, hundreds: 200, thousands: 2000 };
const WORD_DEAD = /\b(dozens|scores|hundreds|thousands)\s+(?:of\s+)?(?:people\s+|civilians\s+)?(?:killed|dead|dies|died|lives)\b/i;

function deaths(t) {
  let m = t.match(NUM_DEAD) || t.match(DEAD_NUM);
  if (m) return parseInt(m[1].replace(/,/g, ''), 10);
  m = t.match(WORD_DEAD);
  return m ? WORDNUM[m[1].toLowerCase()] : 0;
}

export function themeOf(t) {
  if (PERSECUTE.test(t) && PERSECUTE_HARM.test(t)) return 'persecution';
  if (HEALTH.test(t)) return 'health';
  if (DISASTER.test(t)) return 'disaster';
  if (HUNGER.test(t)) return 'hunger';
  if (VIOLENCE.test(t)) return 'conflict';
  if (DISPLACE.test(t)) return 'displacement';
  if (UNREST.test(t)) return 'unrest';
  if (POLITICS.test(t)) return 'politics';
  return 'other';
}

/** @returns {{s:number, th:string}} severity 1..5 and theme */
export function classify(title, summary = '') {
  const t = (title + ' . ' + summary.slice(0, 240)).replace(/\s+/g, ' ');
  const th = themeOf(title + ' ' + summary.slice(0, 240));
  const headline = title;
  const hardWords = KILL.test(headline) || VIOLENCE.test(headline) || DISASTER.test(headline) || HEALTH.test(headline);
  if (SPORT.test(headline) && !hardWords) return { s: 1, th: 'other' };
  const n = deaths(t);
  if (SOFT.test(headline) && !HARM.test(t)) return { s: 1, th: 'other' }; // heritage, culture and drills are not incidents
  let s = 1;
  if (MASS.test(headline)) s = 5;
  else if (n >= 100) s = 5;
  else if (n >= 10) s = 4;
  else if (KILL.test(headline) && (VIOLENCE.test(t) || DISASTER.test(t) || n > 0)) s = 3; // fewer than 10 dead, or no number: severity 3
  else if (th === 'persecution' && PERSECUTE_HARM.test(headline)) s = 4;
  else if (DISASTER.test(headline) && (EMERGENCY.test(t) || bigQuake(t))) s = 4;
  else if (HEALTH.test(headline)) s = 4;
  else if (HUNGER.test(headline)) s = 4;
  else if (VIOLENCE.test(headline)) s = 3;
  else if ((DISASTER.test(headline) || DISPLACE.test(headline)) && !HARM.test(t) && !EMERGENCY.test(t)) s = 2; // a hazard word with no sign of harm is not an incident
  else if (DISASTER.test(headline) || DISPLACE.test(headline) || UNREST.test(headline)) s = 3;
  else if (th === 'persecution') s = 3;
  else if (HARM_STRONG.test(headline)) s = 3;
  else if (POLITICS.test(headline)) s = 2;
  else s = 1;
  // everyday politics and generic strikes should not read as emergencies
  if (s === 4 && /\b(strike)\b/i.test(headline) && !KILL.test(headline) && !VIOLENCE.test(headline)) s = 3;
  return { s, th };
}
