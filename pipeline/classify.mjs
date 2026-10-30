// Rule-based severity (1-5) and theme for a report. Deliberately transparent: every rule is a regex.
const R = s => new RegExp(s, 'i');

const SPORT = R('\\b(football|soccer|cricket|rugby|tennis|golf|league|striker|goalkeeper|tournament|olympic|fifa|premier league|world cup|marathon|box office|movie|film|celebrity|fashion|recipe|concert|album|netflix|oscars?|grammy|horoscope|travel guide|best hotels?)\\b');
const MASS = R('\\b(massacre|genocide|mass (grave|killing|shooting)|famine (declared|conditions)|coup|crimes against humanity|ethnic cleansing|city (falls|captured)|(tsunami|catastrophic (earthquake|flood)))\\b');
const KILL = R('\\b(kill(s|ed|ing)?|dead|dies|died|death toll|deaths|massacred|slain|murdered|martyr(s|ed)?|executed|beheaded|casualt(y|ies)|fatalit(y|ies))\\b');
const VIOLENCE = R('\\b(airstrike|air strike|shelling|bombing|bomb(s|ed)?|suicide (bomber|attack)|gunmen|militants?|insurgents?|rebels?|terror(ist)?s?|missile|drone strike|ambush|hostages?|abduct(ed|ion|s)?|kidnap(ped|ping|s)?|siege|offensive|invasion|clashes|assault|stabbing|attack(s|ed)?|war)\\b');
const DISASTER = R('\\b(crash(es|ed)?|collision|derail\\w*|collapse(d|s)?|explosion|blaze|earthquake|quake|tsunami|flood(s|ing|ed)?|cyclone|hurricane|typhoon|landslide|wildfire|volcano|eruption|drought|heatwave|storm)\\b');
const HEALTH = R('\\b(outbreak|cholera|ebola|marburg|measles|malaria|dengue|mpox|epidemic|pandemic|polio|plague|anthrax|bird flu|h5n1|meningitis|lassa)\\b');
const HUNGER = R('\\b(famine|starvation|starving|hunger|food insecurity|malnutrition|food crisis|ipc phase)\\b');
const PERSECUTE = R('\\b(christians?|churches|church|pastors?|believers|converts?|missionar(y|ies)|persecut\\w*|blasphemy|religious freedom|apostasy|evangelical|bishop|priest|nuns?)\\b');
const PERSECUTE_HARM = R('\\b(attack(s|ed)?|killed|burn(ed|t)?|arrest(ed|s)?|jail(ed)?|imprison(ed)?|detain(ed|s)?|abduct(ed)?|kidnap(ped)?|raid(ed|s)?|banned|bomb\\w*|sentenced|charged|forced|expelled|deport\\w*|threat\\w*|torture\\w*|persecut\\w*|harass\\w*|massacre\\w*)\\b');
const DISPLACE = R('\\b(refugees?|displaced|displacement|fleeing|flee(s)?|asylum|migrants?|evacuat\\w+|exodus|stateless)\\b');
const UNREST = R('\\b(protest(s|ers)?|riot(s|ers)?|unrest|crackdown|curfew|state of emergency|martial law|demonstrat\\w+|tear gas|strike(s)?|uprising|opposition leader|election violence|disputed election|junta)\\b');
const POLITICS = R('\\b(election|parliament|minister|president|prime minister|talks|sanctions|summit|treaty|ceasefire|negotiat\\w+|diplomat\\w*|government|vote|referendum)\\b');
const HARM_STRONG = R('\\b(emergency|crisis|catastrophe|devastat\\w+|collapse|humanitarian|urgent|warns?|appeals? for)\\b');
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
  let s = 1;
  if (MASS.test(headline)) s = 5;
  else if (n >= 100) s = 5;
  else if (n >= 10) s = 4;
  else if (KILL.test(headline) && (VIOLENCE.test(t) || DISASTER.test(t) || n > 0)) s = 4;
  else if (th === 'persecution' && PERSECUTE_HARM.test(headline)) s = 4;
  else if (DISASTER.test(headline) && (HARM_STRONG.test(t) || KILL.test(t) || /\b(magnitude|\d\.\d)\b/.test(t))) s = 4;
  else if (HEALTH.test(headline)) s = 4;
  else if (HUNGER.test(headline)) s = 4;
  else if (VIOLENCE.test(headline)) s = 3;
  else if (DISASTER.test(headline) || DISPLACE.test(headline) || UNREST.test(headline)) s = 3;
  else if (th === 'persecution') s = 3;
  else if (HARM_STRONG.test(headline)) s = 3;
  else if (POLITICS.test(headline)) s = 2;
  else s = 1;
  // everyday politics and generic strikes should not read as emergencies
  if (s === 4 && /\b(strike)\b/i.test(headline) && !KILL.test(headline) && !VIOLENCE.test(headline)) s = 3;
  return { s, th };
}
