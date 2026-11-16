// Cinematic motion (docs/spec/26): the layer over app/motion.js that makes a screen arrive like a
// title sequence instead of a page load.
//   install()    once at boot: the drifting aurora behind the app, the launch splash, the hero tilt
//   enter(view)  after a NEW screen draws: headline words rise out of a mask, the dinner photo
//                settles (Ken Burns) under a pass of light, big numbers count up, charts draw
//                themselves, and the cards below the fold rise in as they scroll into view
// Rules: transform and opacity only; nothing here hides content for good (every reveal has a
// timeout); a TV gets the entrance and nothing that runs forever; reduced motion gets none of it.
// A re-render (sync, another phone's change) never replays an entrance: only a new screen does.

import { reduced, isTV } from './motion.js';

const doc = typeof document !== 'undefined' ? document : null;
const root = doc?.documentElement;
/** Automated browsers read numbers the moment a screen draws, so they skip what rewrites text or covers the screen (`?fx=all` forces it for screenshots). */
const automated = () => !!globalThis.navigator?.webdriver && !/[?&]fx=all\b/.test(globalThis.location?.search || '');
export const fxOn = () => !!doc && !reduced();

const HEADLINES = '.hero-title, .page-title, .recipe-title';
const NUMBERS = '.budget-num, .trips-big > b, .glance-main > b, .week-stats dd';
const SECTIONS = '.page > *:not(.page-head):not(.dateline), .tonight-side > *, .ck-col > *';
const REVEAL_SAFETY_MS = 6000;

/** "Blackstone smashburgers" → one masked span a word, so each can rise on its own. The text a screen reader or a test reads is unchanged. */
export function splitWords(el) {
  if (!el || el.children.length || el.dataset.fxSplit) return 0;
  const words = el.textContent.split(/(\s+)/);
  if (words.filter((w) => w.trim()).length > 12) return 0; // a sentence, not a headline
  el.dataset.fxSplit = '1';
  el.textContent = '';
  let i = 0;
  for (const w of words) {
    if (!w.trim()) { el.append(doc.createTextNode(w)); continue; }
    const mask = doc.createElement('span');
    mask.className = 'fx-w';
    const inner = doc.createElement('span');
    inner.style.setProperty('--i', String(i++));
    inner.textContent = w;
    mask.append(inner);
    el.append(mask);
  }
  return i;
}

/** "$1,176.46" → { prefix: '$', value: 1176.46, decimals: 2 }; anything that isn't a plain number → null. */
export function parseNumber(text) {
  const m = /^(\$?)([\d,]+)(\.\d+)?$/.exec(String(text || '').trim());
  if (!m) return null;
  const value = Number(`${m[2].replace(/,/g, '')}${m[3] || ''}`);
  return Number.isFinite(value) && value > 0 ? { prefix: m[1], value, decimals: m[3] ? m[3].length - 1 : 0 } : null;
}
export function formatNumber(n, { prefix = '', decimals = 0 } = {}) {
  return prefix + n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function countUp(el) {
  const n = parseNumber(el.textContent);
  if (!n) return;
  const final = el.textContent;
  const t0 = performance.now();
  const ms = 900;
  const step = (now) => {
    if (!el.isConnected) return;
    const p = Math.min(1, (now - t0) / ms);
    const eased = 1 - (1 - p) ** 4;
    el.textContent = p >= 1 ? final : formatNumber(n.value * eased, n);
    if (p < 1) requestAnimationFrame(step);
  };
  el.textContent = formatNumber(0, n);
  requestAnimationFrame(step);
}

let io = null;
function reveals(view) {
  if (typeof IntersectionObserver !== 'function') return;
  io?.disconnect();
  const fold = innerHeight * 0.94;
  const els = [...view.querySelectorAll(SECTIONS)].filter((el) => el.getBoundingClientRect().top > fold);
  if (!els.length) return;
  io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.04 });
  for (const el of els) { el.classList.add('fx-reveal'); io.observe(el); }
  setTimeout(() => { for (const el of els) el.classList.add('is-in'); }, REVEAL_SAFETY_MS); // never leave anything hidden
}

let splashUntil = 0; // while the launch covers the screen, the first entrance waits for it to lift
/** After a new screen draws. */
export function enter(view) {
  if (!fxOn() || !view) return;
  const wait = splashUntil - performance.now();
  if (wait > 0) { setTimeout(() => enter(doc.querySelector('#view')), wait); return; }
  view.classList.add('fx-enter');
  for (const el of view.querySelectorAll(HEADLINES)) splitWords(el);
  if (automated()) return;
  for (const el of view.querySelectorAll(NUMBERS)) countUp(el);
  if (!isTV()) reveals(view);
}

/** The dinner photo leans toward the pointer (a mouse or trackpad only). */
function tilt() {
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  let on = null;
  const reset = () => { if (on) { on.style.removeProperty('--fx-rx'); on.style.removeProperty('--fx-ry'); on.classList.remove('fx-tilt'); on = null; } };
  doc.addEventListener('pointermove', (ev) => {
    const el = ev.target.closest?.('.hero-photo, .recipe-photo');
    if (!el || isTV()) { reset(); return; }
    if (on && on !== el) reset();
    on = el;
    const r = el.getBoundingClientRect();
    const x = (ev.clientX - r.left) / r.width - 0.5;
    const y = (ev.clientY - r.top) / r.height - 0.5;
    el.classList.add('fx-tilt');
    el.style.setProperty('--fx-ry', `${(x * 5).toFixed(2)}deg`);
    el.style.setProperty('--fx-rx', `${(-y * 4).toFixed(2)}deg`);
    el.style.setProperty('--fx-mx', `${((x + 0.5) * 100).toFixed(1)}%`);
    el.style.setProperty('--fx-my', `${((y + 0.5) * 100).toFixed(1)}%`);
  }, { passive: true });
  doc.addEventListener('pointerleave', reset, true);
}

/** The launch: the mark lands, a ring opens, the name rises, and it all lifts away. Once per visit. */
function splash() {
  if (automated()) return;
  try { if (sessionStorage.getItem('bfdp.splash')) return; sessionStorage.setItem('bfdp.splash', '1'); } catch { /* private mode: play it */ }
  const el = doc.createElement('div');
  el.className = 'fx-splash';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<div class="fx-splash-in"><span class="fx-ring"></span><span class="wm-mark fx-splash-mark"></span><p class="fx-splash-name"><span>The Bilbrey</span><span>Family Dinners</span></p></div>';
  doc.body.append(el);
  splashUntil = performance.now() + 1150;
  const done = () => el.remove();
  el.addEventListener('animationend', (ev) => { if (ev.target === el) done(); });
  setTimeout(done, 2600);
}

export function install() {
  if (!doc) return;
  const apply = () => root.classList.toggle('fx-on', fxOn());
  apply();
  try { matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', apply); } catch { /* an old engine: the choice at launch stands */ }
  if (!fxOn()) return;
  // (Software-rendered test browsers skip the aurora: three blurred layers starve their timers.)
  if (!isTV() && !automated() && !doc.querySelector('.fx-aurora')) {
    const a = doc.createElement('div');
    a.className = 'fx-aurora';
    a.setAttribute('aria-hidden', 'true');
    a.innerHTML = '<i></i><i></i><i></i>';
    doc.body.prepend(a);
  }
  tilt();
  splash();
}
