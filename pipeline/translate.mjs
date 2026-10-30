// Headline translation is NOT in use. The pipeline calls no AI or translation service.
// The display code (an English headline with the original beneath it, read from it.te) is kept so a translator can be added later,
// but nothing here sets it.te and nothing here makes a network call.
export const translationEnabled = () => false;
export async function translatePending() { return { done: 0, tried: 0, off: true }; }
