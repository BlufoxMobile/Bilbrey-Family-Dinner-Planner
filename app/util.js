// Small, dependency-free helpers shared by the pure logic and the views.
// Dates are plain "YYYY-MM-DD" strings in the family's time zone (America/Chicago);
// arithmetic happens on UTC midnights so DST never shifts a day.

export const TZ = 'America/Chicago';

/** Today's date in America/Chicago as YYYY-MM-DD. */
export function todayISO(now = new Date(), tz = TZ) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Hour of day (0–23) in America/Chicago. */
export function hourIn(now = new Date(), tz = TZ) {
  const h = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(now);
  return Number(h) || 0;
}

export function isISODate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
}

export function toDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function fromDate(d) {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso, n) {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return fromDate(d);
}

export function diffDays(a, b) {
  return Math.round((toDate(a) - toDate(b)) / 86400000);
}

/** 0 = Sunday … 6 = Saturday (JS convention). */
export function weekday(iso) {
  return toDate(iso).getUTCDay();
}

/** 0 = Monday … 6 = Sunday. Used for settings.burgerNights (so [0,4] = Mon + Fri). */
export function monIndex(iso) {
  return (weekday(iso) + 6) % 7;
}

export function startOfWeek(iso, weekStartsOn = 1) {
  const wd = weekday(iso);
  const back = (wd - weekStartsOn + 7) % 7;
  return addDays(iso, -back);
}

export function startOfMonth(iso) {
  return iso.slice(0, 7) + '-01';
}

export function daysInMonth(iso) {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function endOfMonth(iso) {
  return iso.slice(0, 7) + '-' + String(daysInMonth(iso)).padStart(2, '0');
}

export function addMonths(iso, n) {
  const [y, m] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return fromDate(d);
}

export function dateRange(start, count) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(addDays(start, i));
  return out;
}

export function datesBetween(start, end) {
  const n = diffDays(end, start);
  return n < 0 ? [] : dateRange(start, n + 1);
}

const fmtCache = new Map();
function fmt(opts) {
  const key = JSON.stringify(opts);
  if (!fmtCache.has(key)) fmtCache.set(key, new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }));
  return fmtCache.get(key);
}

/** "Saturday, November 14" */
export function longDay(iso) { return fmt({ weekday: 'long', month: 'long', day: 'numeric' }).format(toDate(iso)); }
/** "Sat" */
export function shortWeekday(iso) { return fmt({ weekday: 'short' }).format(toDate(iso)); }
/** "Saturday" */
export function weekdayName(iso) { return fmt({ weekday: 'long' }).format(toDate(iso)); }
/** "Nov 14" */
export function shortDate(iso) { return fmt({ month: 'short', day: 'numeric' }).format(toDate(iso)); }
/** "November 2026" */
export function monthName(iso) { return fmt({ month: 'long', year: 'numeric' }).format(toDate(iso)); }
/** "November" */
export function monthOnly(iso) { return fmt({ month: 'long' }).format(toDate(iso)); }
/** "Nov 14, 2026" */
export function mediumDate(iso) { return fmt({ month: 'short', day: 'numeric', year: 'numeric' }).format(toDate(iso)); }

/** "Nov 16 – 22" or "Nov 30 – Dec 6" */
export function rangeLabel(start, end) {
  if (start.slice(0, 7) === end.slice(0, 7)) return `${shortDate(start)} – ${Number(end.slice(8))}`;
  return `${shortDate(start)} – ${shortDate(end)}`;
}

/** Relative name for a date: Tonight / Tomorrow / Yesterday / weekday name / short date. */
export function relativeDay(iso, today) {
  const d = diffDays(iso, today);
  if (d === 0) return 'Tonight';
  if (d === 1) return 'Tomorrow';
  if (d === -1) return 'Yesterday';
  if (d > 1 && d < 7) return weekdayName(iso);
  return `${shortWeekday(iso)}, ${shortDate(iso)}`;
}

const moneyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moneyFmt0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
/** "$1,234.56" — never NaN. */
export function money(n, { whole = false } = {}) {
  const v = Number.isFinite(n) ? n : 0;
  return (whole ? moneyFmt0 : moneyFmt).format(v);
}

export function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

const FRACTIONS = [[0.25, '¼'], [0.5, '½'], [0.75, '¾']];
/** Friendly quantity: 1.5 → "1½", 0.25 → "¼", 2.333 → "2.33". Never NaN. */
export function fmtQty(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  const whole = Math.floor(v + 1e-9);
  const frac = v - whole;
  if (frac < 0.01) return String(whole);
  for (const [f, glyph] of FRACTIONS) if (Math.abs(frac - f) < 0.01) return (whole ? String(whole) : '') + glyph;
  return String(Math.round(v * 100) / 100);
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'item';
}

/** FNV-1a 32-bit hash → unsigned int. Deterministic across devices. */
export function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic pseudo-random in [0,1) for a key. */
export function seeded(key) {
  let t = (hashString(key) + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function uid(prefix = '') {
  const r = (globalThis.crypto?.randomUUID?.() || (Date.now().toString(36) + Math.random().toString(36).slice(2))).replace(/-/g, '').slice(0, 12);
  return prefix + r;
}

export function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

export function plural(n, one, many = one + 's') {
  return `${fmtQty(n)} ${Math.abs(n - 1) < 1e-9 ? one : many}`;
}

export function listJoin(items) {
  const a = items.filter(Boolean);
  if (a.length <= 1) return a.join('');
  if (a.length === 2) return `${a[0]} and ${a[1]}`;
  return `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
}

export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
