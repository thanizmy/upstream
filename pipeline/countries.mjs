// Country detection from free text. Built on the world-countries dataset plus news-style aliases.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const raw = require('world-countries');

// Domestic US news is excluded on purpose: the product watches international contexts, and the
// largest feeds are US domestic stories that would otherwise dominate every ranking.
const EXCLUDE = new Set(['US', 'UM', 'PR', 'GU', 'VI', 'AS', 'MP']);
const NO_CAPITAL = new Set(['Georgetown', 'Victoria', 'Kingston', 'Hamilton', 'Jamestown', 'Road Town', 'Washington, D.C.',
  'Charlotte Amalie', 'Saint-Denis', 'Male', 'Bern', 'Nassau', 'Apia', 'Majuro', 'Palikir', 'Roseau', 'Valletta', 'Doha', 'Lome']);
const BAD_ALIAS = new Set(['Guinea', 'Georgia', 'Dominica', 'Jersey', 'Man', 'Niue', 'Chad']);
const MANUAL = {
  PS: ['Gaza', 'West Bank', 'Rafah', 'Gaza Strip', 'Palestinian', 'Palestinians', 'Ramallah'],
  RU: ['Kremlin', 'Russian', 'Russians'], UA: ['Donbas', 'Crimea', 'Kyiv', 'Ukrainian', 'Ukrainians', 'Kharkiv', 'Odesa', 'Zaporizhzhia'],
  CD: ['DR Congo', 'DRC', 'Congo', 'Congolese', 'Democratic Republic of Congo', 'Democratic Republic of the Congo', 'Goma', 'Kinshasa'],
  CG: ['Republic of the Congo', 'Congo-Brazzaville', 'Brazzaville'],
  MM: ['Burma', 'Myanmar', 'Burmese', 'Rohingya'], CI: ['Ivory Coast', "Côte d'Ivoire", 'Ivorian'],
  GB: ['Britain', 'British', 'England', 'Scotland', 'Wales', 'London', 'Northern Ireland', 'UK'],
  SD: ['Darfur', 'Khartoum', 'Sudanese', 'El Fasher'], ET: ['Tigray', 'Amhara', 'Oromia', 'Ethiopian'],
  NG: ['Nigerian', 'Abuja', 'Borno', 'Plateau State', 'Benue'], SO: ['Somali', 'Mogadishu', 'Al-Shabaab', 'Al-Shabab'],
  IL: ['Israeli', 'Israelis', 'Tel Aviv', 'Jerusalem'], IR: ['Iranian', 'Tehran'], LB: ['Lebanese', 'Hezbollah', 'Beirut'],
  YE: ['Houthi', 'Houthis', 'Yemeni', 'Sanaa'], SY: ['Syrian', 'Damascus', 'Aleppo'], AF: ['Afghan', 'Taliban', 'Kabul'],
  PK: ['Pakistani', 'Balochistan', 'Karachi', 'Lahore'], IN: ['Indian', 'Manipur', 'New Delhi', 'Mumbai'], CN: ['Chinese', 'Beijing', 'Xinjiang', 'Tibet'],
  KP: ['North Korea', 'North Korean', 'Pyongyang'], KR: ['South Korea', 'South Korean', 'Seoul'], TW: ['Taiwan', 'Taiwanese', 'Taipei'],
  HK: ['Hong Kong'], TR: ['Türkiye', 'Turkey', 'Turkish', 'Ankara', 'Istanbul'], HT: ['Haitian', 'Port-au-Prince'],
  VE: ['Venezuelan', 'Caracas'], MX: ['Mexican'], CO: ['Colombian', 'Bogotá'], BR: ['Brazilian'], CU: ['Cuban'], NI: ['Nicaraguan'],
  SS: ['South Sudan', 'South Sudanese', 'Juba'], CF: ['Central African Republic', 'Bangui'], BF: ['Burkina Faso', 'Ouagadougou'],
  ML: ['Malian', 'Bamako'], NE: ['Niamey'], CM: ['Cameroonian', 'Cameroon'], MZ: ['Cabo Delgado', 'Mozambican'],
  KE: ['Kenyan', 'Nairobi'], UG: ['Ugandan', 'Kampala'], ZA: ['South African', 'South Africa', 'Johannesburg'], EG: ['Egyptian', 'Cairo'],
  SA: ['Saudi', 'Saudi Arabia', 'Riyadh'], AE: ['UAE', 'Emirati', 'Dubai', 'Abu Dhabi'], IQ: ['Iraqi', 'Baghdad', 'Mosul'],
  PH: ['Filipino', 'Philippine', 'Philippines', 'Manila'], ID: ['Indonesian', 'Jakarta'], TH: ['Thai', 'Bangkok'], VN: ['Vietnamese', 'Hanoi'],
  BD: ['Bangladeshi', 'Dhaka'], LK: ['Sri Lankan', 'Colombo'], NP: ['Nepali', 'Nepalese', 'Kathmandu'], DE: ['German', 'Germans', 'Berlin'],
  FR: ['French', 'Paris'], IT: ['Italian', 'Italians'], ES: ['Spanish', 'Madrid'], PL: ['Polish', 'Warsaw'], AM: ['Armenian', 'Yerevan'],
  AZ: ['Azerbaijani', 'Baku', 'Nagorno-Karabakh'], BY: ['Belarusian', 'Minsk'], RS: ['Serbian', 'Belgrade'], XK: ['Kosovo', 'Pristina'],
  LY: ['Libyan', 'Tripoli'], TN: ['Tunisian', 'Tunis'], DZ: ['Algerian', 'Algiers'], MA: ['Moroccan', 'Rabat'], JO: ['Jordanian', 'Amman'],
  ER: ['Eritrean', 'Asmara'], TD: ['Chadian', "N'Djamena"], GN: ['Guinean', 'Conakry'], PG: ['Papua New Guinea', 'Port Moresby']
};

export const COUNTRIES = {}; // cc -> {k, cc, fl, ll, region}
const aliasToCc = new Map();
function addAlias(a, cc) {
  if (!a || a.length < 3 || BAD_ALIAS.has(a)) return;
  if (!aliasToCc.has(a)) aliasToCc.set(a, cc);
}
for (const c of raw) {
  const cc = c.cca2;
  if (EXCLUDE.has(cc)) continue;
  if (!(c.independent || c.unMember || ['PS', 'XK', 'TW', 'HK'].includes(cc))) continue;
  COUNTRIES[cc] = { k: c.name.common, cc, fl: c.flag, ll: c.latlng, region: c.region, sub: c.subregion };
  addAlias(c.name.common, cc);
  (c.altSpellings || []).forEach(a => { if (a.length > 4 && !/^[A-Z]{2,4}$/.test(a)) addAlias(a, cc); });
  (c.capital || []).forEach(a => { if (!NO_CAPITAL.has(a)) addAlias(a, cc); });
  if (c.demonyms?.eng?.m) addAlias(c.demonyms.eng.m, cc);
}
COUNTRIES.XK ||= { k: 'Kosovo', cc: 'XK', fl: '🇽🇰', ll: [42.67, 21.17], region: 'Europe', sub: 'Southeast Europe' };
COUNTRIES.PS ||= { k: 'Palestine', cc: 'PS', fl: '🇵🇸', ll: [31.9, 35.2], region: 'Asia', sub: 'Western Asia' };
for (const [cc, list] of Object.entries(MANUAL)) {
  if (!COUNTRIES[cc]) continue;
  list.forEach(a => { aliasToCc.set(a, cc); });
}
aliasToCc.delete('Georgia'); aliasToCc.set('Georgia (country)', 'GE'); aliasToCc.set('Tbilisi', 'GE'); aliasToCc.set('Georgian government', 'GE');

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const keys = [...aliasToCc.keys()].sort((a, b) => b.length - a.length);
const RE = new RegExp('(?<![\\p{L}\\p{N}])(' + keys.map(esc).join('|') + ')(?![\\p{L}\\p{N}])', 'gu');

/** Distinct country codes mentioned in `text`, in order of first appearance. */
export function detectCountries(text) {
  const out = [];
  for (const m of text.matchAll(RE)) {
    const cc = aliasToCc.get(m[1]);
    if (cc && !out.includes(cc)) out.push(cc);
  }
  return out;
}
