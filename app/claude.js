// Claude in the planner (SPEC §17): which model reads the family's photos, what a month of it
// costs, and the plain words the app uses for both. Pure: no DOM, no network.

/** The family's choice (state.settings.aiModel). Opus is the default. */
export const AI_MODELS = Object.freeze([
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', short: 'Opus 5.5', tag: 'Costs the most', note: 'The sharpest reader: small print, crowded shelves and the best dinner ideas.' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', short: 'Sonnet 5.5', tag: 'Costs less', note: 'Nearly as sharp, and costs less.' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', short: 'Haiku 5.5', tag: 'Costs the least', note: 'The quickest and cheapest. Fine for clear, well-lit photos.' },
]);
export const DEFAULT_AI_MODEL = 'claude-opus-5-5';
export const isAiModel = (id) => AI_MODELS.some((m) => m.id === id);

/**
 * What one photo costs, for the hint under each model: a pantry photo is about this many tokens
 * going in (the picture, the instructions and the list of what the family buys) and coming out
 * (what Claude saw). An estimate, shown as "about"; the real spend is on the card.
 */
export const PHOTO_TOKENS = Object.freeze({ in: 6000, out: 800 });

/** "claude-sonnet-5-5" → "Claude Sonnet 5.5" (a dated id loses its date). */
export function modelLabel(id) {
  const known = AI_MODELS.find((m) => m.id === id);
  if (known) return known.label;
  const s = String(id || '').trim();
  if (!/^claude-/i.test(s)) return s;
  const parts = s.replace(/-\d{8}$/, '').split('-').slice(1);
  const words = [];
  const nums = [];
  for (const p of parts) (/^\d+$/.test(p) ? nums : words).push(p);
  return ['Claude', ...words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)), nums.join('.')].filter(Boolean).join(' ');
}

/** True when a response says Claude did the reading. */
export function readByClaude(engine, model) {
  if (engine) return engine === 'claude';
  return /^claude/i.test(String(model || ''));
}

/** The small line on the scan and receipt review sheets: "Read by Claude Opus 5.5" / "Read by the free scanner". */
export function readByText(engine, model) {
  if (!engine && !model) return '';
  return readByClaude(engine, model) ? `Read by ${modelLabel(model) || 'Claude'}` : 'Read by the free scanner';
}

/** Cents for one photo with a model's prices (USD per million tokens), or null without prices. */
export function photoCents(m) {
  const inUsd = Number(m?.inUsd);
  const outUsd = Number(m?.outUsd);
  if (!(inUsd >= 0) || !(outUsd >= 0) || !Number.isFinite(inUsd) || !Number.isFinite(outUsd)) return null;
  return ((PHOTO_TOKENS.in * inUsd + PHOTO_TOKENS.out * outUsd) / 1e6) * 100;
}

/** "About 5¢ a photo" / "Under 1¢ a photo" / "" when the server didn't send prices. */
export function photoCostHint(m) {
  const c = photoCents(m);
  if (c == null) return '';
  if (c < 1) return 'Under 1¢ a photo';
  return `About ${Math.round(c)}¢ a photo`;
}

const usd = (n) => `$${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2)}`;
const usdWhole = (n) => (Math.abs(Number(n) - Math.round(Number(n))) < 0.005 ? `$${Math.round(Number(n))}` : usd(n));

/**
 * The family's Claude status from GET /api/ai and the model chosen in settings.
 * → { tone: 'on'|'free'|'capped'|'unknown', text, spend: { spent, cap, pct, text }|null }
 */
export function aiStatus(info, modelId = DEFAULT_AI_MODEL) {
  if (!info || typeof info !== 'object') return { tone: 'unknown', text: '', spend: null };
  const cap = Number(info.capUsd) > 0 ? Number(info.capUsd) : null;
  const spent = Math.max(0, Number(info.spentUsd) || 0);
  const spend = cap ? { spent, cap, pct: Math.max(0, Math.min(100, Math.round((spent / cap) * 100))), text: `${usd(spent)} of ${usd(cap)}` } : null;
  if (!info.keySet) return { tone: 'free', text: 'Using the free scanner — add the Claude key to turn Claude on', spend };
  if (info.capped) return { tone: 'capped', text: `This month’s ${cap ? usdWhole(cap) : 'Claude budget'} is used up; back on the 1st`, spend };
  return { tone: 'on', text: `${modelLabel(isAiModel(modelId) ? modelId : info.model || DEFAULT_AI_MODEL)} reads your photos`, spend };
}

/** Friendly words for a failed Claude request (What can I make?, the connector link). */
export function claudeErrorText(e) {
  const s = Number(e?.status);
  if (s === 0) return 'This needs an internet connection. Everything else works offline.';
  if (s === 401) return 'This needs the family passcode on this phone. Enter it in Family & settings.';
  if (s === 402 || e?.data?.capped) return 'This month’s Claude budget is used up. It’s back on the 1st; the pantry and list work as usual until then.';
  if (s === 503) return 'Claude isn’t turned on yet. Once Jeff adds the Claude key to the family server, this works.';
  if (s === 404) return 'This isn’t on the family server yet. Try again after the next update.';
  if (s === 413) return 'Those photos are too large together. Try fewer, or closer ones.';
  if (s === 429) return 'Too many requests at once. Wait a minute, then try again.';
  if (s === 502 || s === 504) return 'Claude didn’t answer this time. Try again in a moment.';
  return `That didn’t work (${e?.message || 'unknown error'}). Try again in a moment.`;
}
