// Headline translation into English for non-English items. Off unless a provider is configured, so the pipeline never depends on it:
//   ANTHROPIC_API_KEY   translate with Claude (model: TRANSLATE_MODEL, default claude-haiku-5-5), 40 headlines per call
//   TRANSLATE_MAX       most headlines to translate per run (default 800); the most serious and newest go first
//   TRANSLATE_PROVIDER=mock   test only: prefixes the original so the display path can be checked without a key
// Each translation is stored on the item (it.te) in history.json, so a headline is translated once and never paid for twice.
const KEY = process.env.ANTHROPIC_API_KEY, MOCK = process.env.TRANSLATE_PROVIDER === 'mock';
const MODEL = process.env.TRANSLATE_MODEL || 'claude-haiku-5-5';
const LANG = { es: 'Spanish', fr: 'French', pt: 'Portuguese', de: 'German', ru: 'Russian or Ukrainian', id: 'Indonesian', tr: 'Turkish', sw: 'Swahili', ar: 'Arabic', vi: 'Vietnamese',
  zh: 'Chinese', ja: 'Japanese', ko: 'Korean', th: 'Thai', he: 'Hebrew', fa: 'Persian', ur: 'Urdu', hi: 'Hindi', bn: 'Bengali', it: 'Italian' };
export const translationEnabled = () => MOCK || !!KEY;

const SYSTEM = 'You translate news headlines into clear, neutral English for ministry staff who need a quick read. Keep names, places and numbers exact. ' +
  'Do not add information or opinion, and keep each translation under 160 characters. The input is a JSON array of {id, lang, headline}. ' +
  'Reply with ONLY a JSON array of {id, en}, one entry for every input id, and nothing else.';

async function viaClaude(batch) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 4096, system: SYSTEM, messages: [{ role: 'user', content: JSON.stringify(batch.map(b => ({ id: b.id, lang: LANG[b.l] || b.l, headline: b.t }))) }] }),
    signal: AbortSignal.timeout(90000)
  });
  if (!r.ok) throw new Error('translation service HTTP ' + r.status);
  const j = await r.json();
  const text = (j.content || []).map(c => c.text || '').join('');
  const m = text.match(/\[[\s\S]*\]/); if (!m) throw new Error('translation reply was not JSON');
  const out = {};
  for (const x of JSON.parse(m[0])) if (x && typeof x.id === 'string' && typeof x.en === 'string' && x.en.trim()) out[x.id] = x.en.trim().slice(0, 300);
  return out;
}
const viaMock = async batch => Object.fromEntries(batch.map(b => [b.id, '[EN] ' + b.t]));

/** Translate pending items in place (sets it.te). Returns {done, tried, error}. */
export async function translatePending(items, max = +process.env.TRANSLATE_MAX || 800) {
  if (!translationEnabled()) return { done: 0, tried: 0, off: true };
  const todo = items.filter(i => i.l && i.l !== 'en' && !i.te && i.s >= 2).sort((a, b) => b.s - a.s || b.d - a.d).slice(0, max);
  const run = MOCK ? viaMock : viaClaude;
  let done = 0, fails = 0, error = null;
  for (let i = 0; i < todo.length && fails < 3; i += 40) {
    const batch = todo.slice(i, i + 40);
    try {
      const out = await run(batch);
      for (const it of batch) if (out[it.id]) { it.te = out[it.id]; done++; }
    } catch (e) { fails++; error = e.message; }
  }
  return { done, tried: todo.length, error };
}
