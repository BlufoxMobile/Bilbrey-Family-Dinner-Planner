// The living-room TV, and keyboards in general (docs/spec/19-design.md §4).
//
//  - Detects a television (a Fire TV / smart-TV user agent, or a big screen with no touch and no
//    fine pointer), or follows the "TV display" switch, which is kept on this device only.
//  - Puts .is-tv on <html> and sets --tv-zoom so styles/parts/tv.css can lay the page out on a
//    960-wide canvas whatever the panel's real size.
//  - Remote-control navigation: the arrow keys move focus to the nearest thing in that direction,
//    Enter activates it, Back / Escape closes a sheet or goes back. The same arrow-key navigation
//    is there for keyboard users on a computer (once they have pressed Tab), and it never takes
//    the arrow keys away from a text box.
//  - Focus survives a re-render: captureFocus() before, restoreFocus() after.

const doc = typeof document !== 'undefined' ? document : null;
const root = doc?.documentElement;
const KEY = 'bfdp.v2.display';
const CANVAS = 960;

// ---------------------------------------------------------------- is this a TV?

/** True for the browsers that televisions and TV sticks ship. Pure, so it can be unit-tested. */
export function isTvUserAgent(ua = '') {
  if (/\bAFT[A-Z0-9]{1,8}\b/.test(ua)) return true;                       // Fire TV devices: AFTMM, AFTKA, AFTSSS…
  if (/Fire ?TV|SmartTV|Smart-TV|SMART-TV|GoogleTV|Google TV|Android TV|AndroidTV|BRAVIA|Tizen|Web0S|WebOS.*TV|NetCast|HbbTV|CrKey|AppleTV|Roku|VIZIO|PhilipsTV|Opera TV|TV Safari|; ?TV[;)]/i.test(ua)) return true;
  return false;
}

/**
 * A big screen that nobody can touch or point at precisely is a television in practice.
 * env: { ua, touch (maxTouchPoints), width, height, pointerFine, pointerNone, hoverNone, silk }
 */
export function looksLikeTv({ ua = '', touch = 0, width = 0, pointerFine = false, anyFine = false, anyCoarse = false } = {}) {
  if (isTvUserAgent(ua)) return true;
  const silkNoTouch = /\bSilk\//.test(ua) && !/Mobile/.test(ua) && touch === 0 && !/Kindle|KF[A-Z]{2,}/.test(ua);
  if (silkNoTouch && width >= 900) return true;
  return width >= 900 && touch === 0 && !pointerFine && !anyFine && !anyCoarse;
}

function detect() {
  if (!doc || typeof matchMedia !== 'function') return false;
  const m = (q) => matchMedia(q).matches;
  return looksLikeTv({
    ua: navigator.userAgent || '', touch: navigator.maxTouchPoints || 0, width: Math.max(screen?.width || 0, innerWidth),
    pointerFine: m('(pointer: fine)'), anyFine: m('(any-pointer: fine)'), anyCoarse: m('(any-pointer: coarse)'),
  });
}

/** The stored choice for this device: 'on', 'off' or 'auto' (follow detection). */
export function tvSetting() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '{}').tv; return v === 'on' || v === 'off' ? v : 'auto'; } catch { return 'auto'; }
}
export function setTvSetting(v) {
  try { localStorage.setItem(KEY, JSON.stringify({ tv: v === 'on' || v === 'off' ? v : 'auto' })); } catch { /* private mode: the choice lasts until reload */ }
  applyTv();
}
export const tvDetected = () => detect();
export const tvOn = () => !!root?.classList.contains('is-tv');

let onChange = () => {};
/** Sets .is-tv and the zoom that maps the 960-wide canvas onto this screen. */
export function applyTv() {
  if (!doc) return false;
  const s = tvSetting();
  const on = s === 'on' || (s === 'auto' && detect());
  const was = tvOn();
  root.classList.toggle('is-tv', on);
  if (on) {
    const z = Math.max(0.6, Math.min(4, innerWidth / CANVAS));
    root.style.setProperty('--tv-zoom', String(Math.abs(z - 1) < 0.04 ? 1 : Math.round(z * 1000) / 1000));
    keys = true;
  } else {
    root.style.removeProperty('--tv-zoom');
  }
  if (was !== on) onChange(on);
  return on;
}

// ---------------------------------------------------------------- focus across re-renders

export const FOCUSABLE = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [tabindex]:not([tabindex="-1"])';
const DATA_KEYS = ['action', 'date', 'key', 'id', 'value', 'name', 'slot', 'dinner', 'who', 'store', 'delta', 'person', 'confirm', 'change', 'ref', 'list', 'href', 'kind'];

/** A description of a control that survives the DOM being rebuilt around it. */
function signature(el) {
  if (el.id) return `#${el.id}`;
  const parts = [el.tagName, el.getAttribute('href') || '', el.getAttribute('name') || '', el.getAttribute('type') || ''];
  let data = 0;
  for (const k of DATA_KEYS) if (el.dataset[k] != null) { parts.push(`${k}=${el.dataset[k]}`); data++; }
  if (el.tagName === 'INPUT' && (el.type === 'radio' || el.type === 'checkbox')) parts.push(`v=${el.value}`);
  if (!data && !parts[1] && !parts[2]) parts.push((el.classList[0] || ''), (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 48));
  return parts.join('|');
}

/** Focus the control that matches a signature taken earlier (Undo puts focus back where the change came from). */
export function signatureOf(el) { return el && el !== doc?.body ? signature(el) : null; }
export function focusBySignature(scope, sig) {
  if (!sig) return null;
  const el = sig.startsWith('#') ? scope.querySelector(`#${CSS.escape(sig.slice(1))}`) : focusables(scope).find((e) => signature(e) === sig);
  if (el) el.focus({ preventScroll: false });
  return el || null;
}

const visible = (el) => {
  if (el.disabled || el.getAttribute('aria-hidden') === 'true' || el.closest('[inert]')) return false;
  if (!el.getClientRects().length && !isHiddenInput(el)) return false;
  return getComputedStyle(el).visibility !== 'hidden';
};
/** A file input or radio tucked inside its label: the label is what you see and aim at. */
const isHiddenInput = (el) => el.tagName === 'INPUT' && !!el.closest('label') && (el.classList.contains('sr-only') || el.matches('.chip-radio input'));
const rectOf = (el) => (isHiddenInput(el) ? el.closest('label') : el).getBoundingClientRect();
export function focusables(scope) { return [...scope.querySelectorAll(FOCUSABLE)].filter(visible); }

/** Before a redraw of `scope`: what has focus, and where it was. null when focus is elsewhere. */
export function captureFocus(scope) {
  const act = doc?.activeElement;
  if (!act || act === doc.body || act === scope || !scope.contains(act)) return null;
  const sig = signature(act);
  const same = focusables(scope).filter((e) => signature(e) === sig);
  // id: a line focused on purpose (tabindex −1, like "All done for today.") isn't in the tab order,
  // so a redraw finds it again by its id (gauntlet r6: focus fell to the page after the last tick).
  const snap = { sig, id: act.id || '', n: Math.max(0, same.indexOf(act)), rect: rectOf(act), nav: !!act.closest('.rail, .tabbar, .topbar'), start: null, end: null };
  try { snap.start = act.selectionStart; snap.end = act.selectionEnd; } catch { /* not a text box */ }
  return snap;
}

/**
 * After the redraw: focus the same control again. If it is gone and `nearest` is set (the TV,
 * or someone driving with the keyboard), focus whatever now sits closest to where it was.
 */
export function restoreFocus(scope, snap, { nearest = keysMode(), only = null } = {}) {
  if (!snap) return null;
  if (snap.id && !snap.sig?.startsWith?.('input')) {
    const byId = scope.querySelector(`#${CSS.escape(snap.id)}`);
    if (byId && byId.getAttribute('tabindex') === '-1') { byId.focus({ preventScroll: true }); return byId; }
  }
  const all = focusables(scope).filter((e) => !only || e.closest(only));
  const same = all.filter((e) => signature(e) === snap.sig);
  let el = same[snap.n] || same[0] || null;
  if (!el && nearest && all.length) {
    const cx = snap.rect.left + snap.rect.width / 2; const cy = snap.rect.top + snap.rect.height / 2;
    let best = Infinity;
    for (const e of all) {
      const r = rectOf(e);
      const d = Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy);
      if (d < best) { best = d; el = e; }
    }
  }
  if (!el) return null;
  el.focus({ preventScroll: true });
  try { if (snap.start != null && same.length) el.setSelectionRange(snap.start, snap.end); } catch { /* not a text box */ }
  return el;
}

/** On a new screen, with nothing to restore: where a remote should start. */
export function focusFirst(scope) {
  const all = focusables(scope);
  const el = scope.querySelector('[data-tv-focus]') || all.find((e) => e.matches('.btn-primary, .hero-photo')) || all[0];
  el?.focus({ preventScroll: true });
  return el || null;
}

// ---------------------------------------------------------------- arrow keys

let keys = false; // true once someone is driving with the keyboard (or always, on a TV)
export const keysMode = () => keys || tvOn();

const TEXT_TYPES = new Set(['text', 'search', 'password', 'email', 'tel', 'url', 'number', 'date', 'time', 'month', 'week', 'datetime-local', '']);
/** Does this control need this arrow key for itself? */
export function wantsArrow(el, key) {
  if (!el || el === doc?.body) return false;
  const tag = el.tagName;
  if (el.isContentEditable || tag === 'TEXTAREA') return true;
  const vertical = key === 'ArrowUp' || key === 'ArrowDown';
  if (tag === 'SELECT') return vertical;
  if (tag === 'INPUT') {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    if (type === 'range') return true;
    if (!TEXT_TYPES.has(type)) return false;                  // checkbox, radio, file, button…
    if (!vertical) return true;                               // left / right move the caret
    return ['number', 'date', 'time', 'month', 'week', 'datetime-local'].includes(type) || el.hasAttribute('list');
  }
  return false;
}

const REGIONS = ['.rail, .tabbar, .topbar', '#view'];
const regionOf = (el) => REGIONS.find((r) => el.closest?.(r)) || null;

/**
 * The best control to move to from `from` in direction `key`, among `els`.
 * Pure geometry on plain rects ({left, top, right, bottom}), so it can be unit-tested.
 */
export function pickInDirection(from, cands, key) {
  const horiz = key === 'ArrowLeft' || key === 'ArrowRight';
  const fwd = key === 'ArrowRight' || key === 'ArrowDown';
  const a = from;
  const aC = { x: (a.left + a.right) / 2, y: (a.top + a.bottom) / 2 };
  let best = null; let bestScore = Infinity;
  for (const c of cands) {
    const b = c.rect;
    if (b.right - b.left <= 0 || b.bottom - b.top <= 0) continue;
    const bC = { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 };
    // Along the direction of travel: how far past our far edge does it start?
    const lead = horiz ? (fwd ? b.left - a.right : a.left - b.right) : (fwd ? b.top - a.bottom : a.top - b.bottom);
    const centre = horiz ? (fwd ? bC.x - aC.x : aC.x - bC.x) : (fwd ? bC.y - aC.y : aC.y - bC.y);
    const tol = Math.min(12, (horiz ? a.right - a.left : a.bottom - a.top) / 3);
    if (lead < -tol || centre <= 0) continue;                 // not in that direction
    // Across it: 0 if the two overlap, else the gap between them.
    const gap = horiz ? Math.max(0, b.top - a.bottom, a.top - b.bottom) : Math.max(0, b.left - a.right, a.left - b.right);
    const off = horiz ? Math.abs(bC.y - aC.y) : Math.abs(bC.x - aC.x);
    const score = Math.max(0, lead) + gap * 4 + off * 0.12 + (gap > 0 ? 40 : 0);
    if (score < bestScore) { bestScore = score; best = c; }
  }
  return best;
}

function scopeNow() {
  const sheet = doc.querySelector('dialog[open]');
  return sheet || doc.getElementById('app') || doc.body;
}

function reveal(el) {
  const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const target = isHiddenInput(el) ? el.closest('label') : el.closest('.day, .r-grid > li, .lunch-day') || el;
  try { target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: smooth ? 'smooth' : 'auto' }); } catch { target.scrollIntoView(false); }
}

/** Moves focus one step. Returns true if it moved. */
export function move(key) {
  const scope = scopeNow();
  const all = focusables(scope);
  if (!all.length) return false;
  const act = doc.activeElement;
  const inScope = act && act !== doc.body && scope.contains(act) && act.matches(FOCUSABLE) && act.id !== 'view';
  if (!inScope) {
    // Nothing chosen yet: Down / Right start in the page, Up / Left in the navigation.
    const nav = scope.querySelector('.rail [aria-current="page"], .tabbar [aria-current="page"]');
    const inView = (e) => { const r = rectOf(e); return r.bottom > 0 && r.top < innerHeight; };
    const main = scope.matches('dialog') ? scope : scope.querySelector('#view') || scope;
    const first = main.querySelector('[data-tv-focus]') || all.find((e) => main.contains(e) && inView(e)) || all.find((e) => main.contains(e)) || all[0];
    const el = (key === 'ArrowUp' || key === 'ArrowLeft') && nav && visible(nav) ? nav : first;
    if (!el) return false;
    el.focus({ preventScroll: true }); reveal(el);
    return true;
  }
  const from = rectOf(act);
  const mine = regionOf(act);
  const cand = (list) => list.filter((e) => e !== act && !e.contains(act) && !(isHiddenInput(act) && act.closest('label') === e)).map((e) => ({ el: e, rect: rectOf(e) }));
  // Stay in the navigation or in the page while there is somewhere to go there; then cross over.
  let hit = mine ? pickInDirection(from, cand(all.filter((e) => regionOf(e) === mine)), key) : null;
  if (!hit) {
    hit = pickInDirection(from, cand(all), key);
    // Crossing from the page into the navigation lands on the section you are in.
    const here = hit && mine === '#view' && regionOf(hit.el) === REGIONS[0] ? scope.querySelector('.rail [aria-current="page"], .tabbar [aria-current="page"]') : null;
    if (here && visible(here)) hit = { el: here };
  }
  if (!hit) return false;
  hit.el.focus({ preventScroll: true });
  reveal(hit.el);
  return true;
}

const BACK_KEYS = new Set(['GoBack', 'BrowserBack']);
const BACK_CODES = new Set([4, 461, 10009, 166]);

/**
 * Once, at boot. hooks: { sheetOpen(), closeSheet(), home (hash to fall back to) }.
 */
export function install({ sheetOpen = () => false, closeSheet = () => {}, home = '#/tonight', changed = () => {} } = {}) {
  if (!doc) return;
  onChange = changed;
  // ?tv=1 / ?tv=0 on the address sets the switch (handy for a bookmark on the TV); ?tv=auto clears it.
  try {
    const q = new URLSearchParams(location.search).get('tv');
    if (q === '1' || q === 'on') setTvSetting('on'); else if (q === '0' || q === 'off') setTvSetting('off'); else if (q === 'auto') setTvSetting('auto');
  } catch { /* no URL API: detection still works */ }
  applyTv();
  addEventListener('resize', () => applyTv());

  doc.addEventListener('pointerdown', () => { if (!tvOn()) { keys = false; delete root.dataset.input; } }, true);
  doc.addEventListener('wheel', () => { if (!tvOn()) { keys = false; delete root.dataset.input; } }, { capture: true, passive: true });

  doc.addEventListener('keydown', (ev) => {
    if (ev.defaultPrevented || ev.altKey || ev.ctrlKey || ev.metaKey) return;
    const key = ev.key;
    const act = doc.activeElement;
    if (key === 'Tab') { keys = true; root.dataset.input = 'keys'; return; }

    if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight') {
      if (ev.shiftKey || !keysMode() || wantsArrow(act, key)) return;
      root.dataset.input = 'keys';
      if (move(key)) ev.preventDefault();                      // nowhere to go: the page scrolls as usual
      return;
    }

    if (key === 'Enter' && act?.tagName === 'INPUT' && (act.type === 'radio' || act.type === 'checkbox') && keysMode()) {
      ev.preventDefault();
      act.click();
      return;
    }

    const back = BACK_KEYS.has(key) || BACK_CODES.has(ev.keyCode) || (tvOn() && (key === 'Escape' || (key === 'Backspace' && !wantsArrow(act, 'ArrowLeft') && act?.tagName !== 'INPUT')));
    if (!back) return;
    if (sheetOpen()) {
      if (key === 'Escape') return;                            // the <dialog> handles Escape itself
      ev.preventDefault(); closeSheet(); return;
    }
    if (wantsArrow(act, 'ArrowLeft')) { act.blur(); ev.preventDefault(); return; }
    const hash = location.hash || home;
    if (hash === home || hash === '#/' || hash === '') return; // at the top: let the TV leave the app
    ev.preventDefault();
    if (history.length > 1) history.back(); else location.hash = home;
  });
}

// ---------------------------------------------------------------- the kitchen clock and the settings row

let clockTimer = null;
function clockText(now = new Date()) {
  try { return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' }).format(now); } catch { return ''; }
}
/** Call after each render: on the TV, Tonight's date line also carries the time. */
export function decorate(view) {
  if (!doc || !view) return;
  clearInterval(clockTimer);
  if (!tvOn()) return;
  const line = view.querySelector('.page-tonight > .dateline');
  if (!line || line.querySelector('.tv-clock')) return;
  const clock = doc.createElement('span');
  clock.className = 'tv-clock';
  clock.setAttribute('aria-hidden', 'true');
  clock.textContent = clockText();
  const day = doc.createElement('span');
  day.textContent = line.textContent;
  line.textContent = '';
  line.append(day, clock);
  clockTimer = setInterval(() => { if (clock.isConnected) clock.textContent = clockText(); else clearInterval(clockTimer); }, 20000);
}

/**
 * The "TV display" switch for a settings page, as an HTML string. Settings screens can place it
 * themselves (class .tv-row); if they don't, main.js adds it under Appearance.
 */
export function tvSettingRow() {
  const on = tvOn();
  const auto = tvSetting() === 'auto';
  const note = auto ? (on ? 'On, because this looks like a TV.' : 'Turns on by itself on a Fire TV.') : 'On this screen only.';
  return `<div class="set-row tv-row"><span class="set-label">TV display<small>Bigger type, and the remote’s arrows move around the screen. ${note}</small></span>`
    + `<button type="button" class="switch ${on ? 'is-on' : ''}" role="switch" aria-checked="${on ? 'true' : 'false'}" aria-label="TV display on this screen" data-action="tv:toggle"><span class="switch-knob"></span></button></div>`;
}
/** Adds the switch to the family & settings page if that page hasn't placed one itself. */
export function injectSettingRow(view) {
  const page = view?.querySelector?.('.page-family');
  if (!page || page.querySelector('.tv-row')) return;
  const after = page.querySelector('[data-action="fam:theme"]')?.closest('.set-row');
  if (after) after.insertAdjacentHTML('afterend', tvSettingRow());
  else page.querySelector('.set-sec')?.insertAdjacentHTML('beforeend', tvSettingRow());
}
