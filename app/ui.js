// DOM helpers: an escaping html`` template, bottom sheets on <dialog>, toasts with
// undo, in-app confirmations, photos with graceful placeholders, avatars.

import { escapeHtml, fmtQty } from './util.js';
import { icon, glyph } from './icons.js';
import { FAMILY } from './config.js';
import * as motion from './motion.js';
import { captureFocus, restoreFocus, focusFirst, tvOn } from './tv.js';

class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Safe(String(s ?? ''));
const esc = (v) => {
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(esc).join('');
  if (v === null || v === undefined || v === false || v === true) return '';
  if (typeof v === 'number' && !Number.isFinite(v)) return '';
  return escapeHtml(String(v));
};
/** Escapes every interpolation unless it's raw() or nested html``. */
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += esc(vals[i]) + strings[i + 1];
  return new Safe(out);
}
export const ic = (name, opts) => raw(icon(name, opts));
export const when = (cond, fn) => (cond ? fn() : '');
/** ARIA true/false: the html`` template renders bare booleans as nothing. */
export const tf = (v) => (v ? 'true' : 'false');

export function setHTML(el, safe) {
  el.innerHTML = safe instanceof Safe ? safe.s : esc(safe);
  settlePhotos(el);
}

// ---------------------------------------------------------------- avatars

/**
 * Each person's color, from styles/tokens.css (light and dark): the fill, the ink for initials on
 * it, and a line for rings and borders. Jeff and Candi share the green; Jackson is red, Jordan
 * blue, Knox yellow. Names always show beside the color, so color is never the only cue.
 */
const tokens = (id) => ({ fill: `var(--p-${id})`, ink: `var(--p-${id}-ink)`, line: `var(--p-${id}-line)` });
export const PERSON_COLORS = { Jeff: tokens('jeff'), Candi: tokens('candi'), Knox: tokens('knox'), Jordan: tokens('jordan'), Jackson: tokens('jackson') };
const colorOf = (name) => (FAMILY.includes(name) ? PERSON_COLORS[name] : null);

/** Inline style for a chip or row that belongs to one person: --pc (fill) and --pc-line (ring). */
export function personStyle(name) {
  const c = colorOf(name);
  return c ? `--pc:${c.fill};--pc-line:${c.line}` : '';
}

export function initials(name) { return name ? name.slice(0, 2) : '?'; }
export function avatar(name, { size = 'md', cls = '' } = {}) {
  const c = colorOf(name);
  return html`<span class="avatar avatar-${size} ${cls}" style="${c ? `--av:${c.fill};--av-ink:${c.ink}` : ''}" aria-hidden="true">${initials(name)}</span>`;
}

// ---------------------------------------------------------------- photos

/**
 * A photo frame that always shows the warm placeholder underneath; the image (if the
 * photos agent produced one) sits on top and removes itself if it fails to load.
 */
export function photo(db, kind, id, { category = 'Comfort', size = 'card', alt = '', eager = false, sideKind = '' } = {}) {
  const p = db?.photos?.[kind === 'side' ? 'sides' : kind === 'lunch' ? 'lunches' : 'dinners']?.[id];
  const cat = kind === 'lunch' ? `lunch-${sideKind || 'main'}` : kind === 'side' ? (sideKind === 'shelf' ? 'shelf' : 'side') : category;
  const tone = kind === 'lunch' ? `lunch-${sideKind || 'main'}` : kind === 'side' ? `side-${sideKind || 'vegetable'}` : `cat-${String(category).toLowerCase().replace(/[^a-z]+/g, '-')}`;
  const glyphSize = size === 'hero' ? 84 : size === 'thumb' ? 30 : 52;
  // Intrinsic size, so the browser knows the shape before the bytes arrive (the frame fixes the layout).
  const dims = kind === 'dinner' ? 'width="1200" height="800"' : 'width="640" height="640"';
  let img = '';
  if (p?.src) {
    const small = p.small || (kind === 'dinner' ? p.src.replace(/\.webp$/, '-640.webp') : null);
    // Dinners come as 1200 × 800 with a 640-wide copy beside them; sides and lunch items are one 640 × 640 file.
    // The hero is the only frame that outgrows 640: on a big monitor and on the TV (where a 1080p panel
    // shows the 960-wide layout at twice the size) it takes the full picture.
    const sizes = size === 'hero' ? '(min-width: 1500px) 900px, (min-width: 960px) 640px, 100vw' : size === 'thumb' ? '96px' : '(min-width: 960px) 320px, 50vw';
    const srcset = small && small !== p.src ? `${small} 640w, ${p.src} 1200w` : '';
    // A picture this page has already shown comes back without a second fade (re-renders rebuild the markup).
    const seen = SEEN.has(p.src) ? ' class="is-loaded is-instant"' : '';
    img = `<img src="${escapeHtml(p.src)}" ${srcset ? `srcset="${escapeHtml(srcset)}" sizes="${sizes}"` : ''} ${dims} alt="${escapeHtml(alt)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" data-photo${seen}>`;
  }
  return raw(`<span class="photo photo-${size} ${tone}">${`<span class="photo-ph">${glyph(cat, { size: glyphSize })}</span>`}${img}</span>`);
}

/** Photos that have finished loading at least once since the app opened (by their src). */
const SEEN = new Set();
function shown(img) {
  img.classList.add('is-loaded');
  const src = img.getAttribute('src');
  if (src) SEEN.add(src);
}

function photoFailed(img) {
  SEEN.delete(img.getAttribute('src'));
  if (img.hasAttribute('srcset')) { img.removeAttribute('srcset'); img.removeAttribute('sizes'); img.src = img.getAttribute('src'); return; }
  img.remove();
}

/**
 * Makes sure every photo in `root` ends up visible. A photo can finish loading while its
 * markup is still detached (built in a fragment, or straight from the memory / service-worker
 * cache), and then the document-level load listener never hears about it. So: already-decoded
 * images are revealed now, and the rest get a listener of their own.
 */
export function settlePhotos(root = document) {
  if (!root?.querySelectorAll) return;
  const imgs = root.matches?.('img[data-photo]') ? [root] : root.querySelectorAll('img[data-photo]:not(.is-loaded)');
  for (const img of imgs) {
    if (img.classList.contains('is-loaded')) continue;
    if (img.complete && img.naturalWidth > 0) { shown(img); continue; }
    if (img.dataset.watch) continue;
    img.dataset.watch = '1';
    img.addEventListener('load', () => shown(img));
    img.addEventListener('error', () => { if (!img.isConnected) photoFailed(img); });
  }
}

/** Installed once: broken images fall back to their srcset-less src, then to the placeholder. */
export function installPhotoFallback(root = document) {
  root.addEventListener('error', (ev) => {
    const img = ev.target;
    if (!(img instanceof HTMLImageElement) || !img.hasAttribute('data-photo')) return;
    photoFailed(img);
  }, true);
  root.addEventListener('load', (ev) => {
    const img = ev.target;
    if (img instanceof HTMLImageElement && img.hasAttribute('data-photo')) shown(img);
  }, true);
  // Every way markup reaches the page (renders, sheets, search results) passes through here.
  if (typeof MutationObserver !== 'undefined') {
    new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1) settlePhotos(n);
    }).observe(root.documentElement || root, { childList: true, subtree: true });
  }
}

// ---------------------------------------------------------------- sheets

let current = null;
let pendingFocus = null; // where focus goes back to, while a sheet is still sliding away

function dialogEl() {
  let d = document.getElementById('sheet');
  if (!d) {
    d = document.createElement('dialog');
    d.id = 'sheet';
    d.className = 'sheet';
    d.setAttribute('aria-labelledby', 'sheet-title');
    document.body.appendChild(d);
    d.addEventListener('cancel', (e) => { e.preventDefault(); closeSheet(); });
    d.addEventListener('click', (e) => { if (e.target === d) closeSheet(); });
    motion.dragToDismiss(d, () => closeSheet({ instant: true }));
  }
  return d;
}

/**
 * openSheet({ title, render: () => html, onMount(el), onClose, live, size: 'auto'|'tall', subtitle })
 * `live` sheets re-render when family state changes (e.g. a night's status).
 */
export function openSheet(opts) {
  const d = dialogEl();
  // A sheet that is still sliding away is reused as it is: no exit, and focus returns where it would have.
  const reused = motion.cancelClose();
  const page = document.getElementById('app') || document.body;
  // Where focus returns when the sheet closes: the element itself, and a description of it in case
  // the page is redrawn behind the sheet and that element is replaced.
  const from = current ? { el: current.prevFocus, snap: current.prevSnap } : (reused && pendingFocus) || { el: document.activeElement, snap: captureFocus(page) };
  pendingFocus = null;
  if (current?.onClose) { try { current.onClose(); } catch { /* ignore */ } }
  current = { ...opts, prevFocus: from.el, prevSnap: from.snap };
  d.className = `sheet sheet-${opts.size || 'auto'}`;
  const wasOpen = d.open;
  renderSheet({ fresh: true });
  if (!d.open) {
    try { d.showModal(); } catch { d.setAttribute('open', ''); }
  }
  document.documentElement.classList.add('has-sheet'); // also when reusing a sheet that was on its way out
  if (!wasOpen) motion.sheetOpened(d);
  // data-autofocus, not the autofocus attribute: showModal() scrolls to a native autofocus target and
  // shoved the sheet off the top of the screen (gauntlet r7).
  const first = d.querySelector('[data-autofocus]') || d.querySelector('.sheet-body button, .sheet-body input, .sheet-body select, .sheet-body a, .sheet-body textarea') || d.querySelector('.sheet-close');
  first?.focus({ preventScroll: true });
  d.scrollTop = 0;
}

/**
 * Draws the open sheet. `fresh` is a new sheet (slides up, starts at the top); anything else
 * is the same sheet updating in place (a stepper, a tab, the family's changes arriving), which
 * keeps its scroll position and keyboard focus and doesn't replay the slide-up.
 */
export function renderSheet({ fresh = false } = {}) {
  if (!current) return;
  const d = dialogEl();
  const body = current.render();
  const scroller = d.querySelector('.sheet-body');
  const top = !fresh && scroller ? scroller.scrollTop : 0;
  const focus = fresh ? null : captureFocus(d);
  const snap = fresh ? null : motion.snapshot(scroller);
  const t = document.getElementById('toast');
  const settled = d.open && !fresh;
  setHTML(d, html`
    <div class="sheet-panel ${settled || (d.open && fresh) ? 'is-shown' : ''}">
      <div class="sheet-grip" aria-hidden="true"></div>
      <header class="sheet-head">
        <div class="sheet-titles">
          <h2 id="sheet-title" class="sheet-title">${current.title}</h2>
          ${when(current.subtitle, () => html`<p class="sheet-sub">${current.subtitle}</p>`)}
        </div>
        <button type="button" class="icon-btn sheet-close" data-action="sheet:close" aria-label="Close">${ic('close')}</button>
      </header>
      <div class="sheet-body">${body}</div>
    </div>`);
  const sc = d.querySelector('.sheet-body');
  if (sc && top) sc.scrollTop = top;
  current.onMount?.(d.querySelector('.sheet-body'));
  if (t) d.appendChild(t); // a message (and its Undo) stays on top of the sheet
  if (focus && !restoreFocus(d, focus, { nearest: true })) d.querySelector('.sheet-close')?.focus({ preventScroll: true });
  if (snap) motion.play(sc, snap);
  // One sheet replacing another (a picker opened from a night): the panel stays, its contents arrive.
  if (fresh && d.open && sc) { sc.classList.add('is-entering'); setTimeout(() => sc.classList.remove('is-entering'), motion.dur('slow') + 60); }
}

export function refreshLiveSheet() {
  if (current?.live) renderSheet();
}

/**
 * Closes the sheet. `instant` skips the exit (the route is changing, or it was dragged away).
 * `focusTo`: an element id to focus once the sheet is gone, instead of the button that opened it.
 */
export function closeSheet({ instant = false, focusTo = null } = {}) {
  const d = document.getElementById('sheet');
  const c = current;
  current = null;
  document.documentElement.classList.remove('has-sheet');
  const t = document.getElementById('toast');
  if (t && d?.contains(t)) document.body.appendChild(t);
  c?.onClose?.();
  const back = c?.prevFocus || null;
  const snap = c?.prevSnap || null;
  const finish = () => {
    if (current) return; // another sheet opened in the meantime and is using the dialog
    const late = document.getElementById('toast');
    if (late && d?.contains(late)) document.body.appendChild(late);
    if (d?.open) { try { d.close(); } catch { d.removeAttribute('open'); } }
    pendingFocus = null;
    const page = document.getElementById('app') || document.body;
    const to = focusTo && document.getElementById(focusTo);
    if (to) to.focus({ preventScroll: true });
    else if (back && document.contains(back) && back !== document.body) back.focus?.({ preventScroll: true });
    else if (!restoreFocus(page, snap) && tvOn()) focusFirst(document.getElementById('view') || document.body);
  };
  if (!d?.open) { finish(); return; }
  if (instant) { motion.cancelClose(); finish(); return; }
  pendingFocus = { el: back, snap };
  motion.closeDialog(d, finish);
}

export const sheetOpen = () => !!current;
export const sheetId = () => current?.id || null;

/** In-app confirmation (never window.confirm). Resolves true/false. */
/**
 * A yes/no sheet → Promise<boolean>. `safe`: an "anyway?" question starts on Cancel, so Enter doesn't
 * commit something short (gauntlet r8). `onCancel`: Cancel goes back to where the question came from
 * (it opens that sheet) instead of closing everything; ✕ and Escape still close.
 */
export function confirmSheet({ title, body = '', confirm = 'Confirm', cancel = 'Cancel', danger = false, safe = false, onCancel = null }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; resolve(v); };
    openSheet({
      title,
      size: 'auto',
      render: () => html`
        ${when(body, () => html`<p class="sheet-text">${body}</p>`)}
        <div class="sheet-actions">
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'} btn-block" data-confirm="yes">${confirm}</button>
          <button type="button" class="btn btn-quiet btn-block" data-confirm="no" ${safe ? html`data-autofocus` : ''}>${cancel}</button>
        </div>`,
      onMount: (el) => {
        el.querySelector('[data-confirm="yes"]').addEventListener('click', () => { finish(true); closeSheet(); });
        el.querySelector('[data-confirm="no"]').addEventListener('click', () => { finish(false); if (onCancel) onCancel(); else closeSheet(); });
      },
      onClose: () => finish(false),
    });
  });
}

// ---------------------------------------------------------------- toasts

let toastTimer = null;
let toastAbort = null;
let toastAt = 0;
/** A message from another screen doesn't follow you around (gauntlet r2); one shown just now stays. */
export function hideStaleToast(ms = 600) { // only a toast from the tap that changed the screen stays (gauntlet r4)
  if (Date.now() - toastAt < ms) return;
  document.getElementById('toast')?.classList.remove('is-on');
}
/** Says something to a screen reader without showing it (a change with no toast; WCAG 4.1.3). */
export function announce(text) {
  let el = document.getElementById('sr-announce');
  if (!el) {
    el = document.createElement('div');
    el.id = 'sr-announce';
    el.className = 'sr-only';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = '';
  setTimeout(() => { el.textContent = text; }, 60);
}

// A toast with a button stays at least 15 seconds and waits while a finger, the mouse or keyboard focus
// is on it (gauntlet r1: 6.5 s was too short to read and reach Undo). A plain note stays 6.5 s.
export function toast(message, { undo = null, action = null, duration = null } = {}) {
  if (!message) return;
  let root = document.getElementById('toast');
  if (!root) {
    root = document.createElement('div');
    root.id = 'toast';
    root.className = 'toast-root';
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
  }
  // An open sheet is a modal <dialog> in the top layer: the toast must live inside it to be seen and tapped.
  const sheet = document.getElementById('sheet');
  const host = sheet?.open && current ? sheet : document.body; // a sheet that is sliding away is already gone
  if (root.parentNode !== host) host.appendChild(root);
  clearTimeout(toastTimer);
  toastAbort?.abort();
  const btn = undo ? { label: 'Undo', fn: undo } : action;
  const wait = duration ?? (btn ? 15000 : 6500);
  toastAt = Date.now();
  setHTML(root, html`<div class="toast">
      <p class="toast-msg">${message}</p>
      ${when(btn, () => html`<button type="button" class="toast-btn">${btn.label}</button>`)}
      <button type="button" class="toast-x icon-btn" aria-label="Dismiss">${ic('close', { size: 18 })}</button>
    </div>`);
  const hide = () => { root.classList.remove('is-on'); };
  root.querySelector('.toast-btn')?.addEventListener('click', () => { hide(); btn.fn(); });
  root.querySelector('.toast-x').addEventListener('click', hide);
  requestAnimationFrame(() => root.classList.add('is-on'));
  const ctl = new AbortController(); toastAbort = ctl;
  const box = root.querySelector('.toast');
  let held = 0;
  const arm = (ms) => { clearTimeout(toastTimer); toastTimer = setTimeout(hide, ms); };
  const hold = () => { held++; clearTimeout(toastTimer); };
  const release = () => { held = Math.max(0, held - 1); if (!held) arm(5000); };
  for (const [on, off] of [['pointerenter', 'pointerleave'], ['focusin', 'focusout']]) {
    box.addEventListener(on, hold, { signal: ctl.signal });
    box.addEventListener(off, release, { signal: ctl.signal });
  }
  box.addEventListener('touchstart', () => arm(wait), { signal: ctl.signal, passive: true });
  arm(wait);
}

// ---------------------------------------------------------------- small controls

export function segmented(name, options, value, { label = '', action = 'seg', small = false } = {}) {
  return html`<div class="seg ${small ? 'seg-sm' : ''}" role="radiogroup" aria-label="${label}">
    ${options.map((o) => html`<button type="button" role="radio" aria-checked="${o.id === value ? 'true' : 'false'}" class="seg-opt ${o.id === value ? 'is-on' : ''}" data-action="${action}" data-name="${name}" data-value="${o.id}">${o.label}</button>`)}
  </div>`;
}

export function stepper({ value, step = 1, min = 0, action, data = {}, unit = '', label = 'Amount' }) {
  const attrs = Object.entries(data).map(([k, v]) => `data-${k}="${escapeHtml(String(v))}"`).join(' ');
  return html`<span class="stepper" role="group" aria-label="${label}">
    <button type="button" class="stepper-btn" data-action="${action}" data-delta="-${step}" ${raw(attrs)} aria-label="Less" ${value <= min ? 'disabled' : ''}>${ic('minus', { size: 18 })}</button>
    <span class="stepper-val">${typeof value === 'number' ? fmtQty(value) : value}${unit ? html` <small>${unit}</small>` : ''}</span>
    <button type="button" class="stepper-btn" data-action="${action}" data-delta="${step}" ${raw(attrs)} aria-label="More">${ic('plus', { size: 18 })}</button>
  </span>`;
}

export function switchToggle({ on, action, data = {}, label }) {
  const attrs = Object.entries(data).map(([k, v]) => `data-${k}="${escapeHtml(String(v))}"`).join(' ');
  return html`<button type="button" class="switch ${on ? 'is-on' : ''}" role="switch" aria-checked="${on ? 'true' : 'false'}" aria-label="${label}" data-action="${action}" ${raw(attrs)}><span class="switch-knob"></span></button>`;
}

export function emptyState({ title, body, actions = '' , iconName = 'tonight' }) {
  return html`<div class="empty">
    <span class="empty-ic">${ic(iconName, { size: 28 })}</span>
    <h3 class="empty-title">${title}</h3>
    <p class="empty-body">${body}</p>
    ${actions ? html`<div class="empty-actions">${actions}</div>` : ''}
  </div>`;
}

/**
 * A placeholder with the shape of what is loading (styles/parts/design.css, .sk).
 * skeleton({ rows: 4 }) → rows of thumbnail + two lines; skeleton({ hero: true }) adds a photo block.
 */
export function skeleton({ rows = 3, hero = false, label = 'Loading' } = {}) {
  return html`<div class="sk-wrap" role="status" aria-label="${label}">
    ${when(hero, () => html`<span class="sk sk-block"></span>`)}
    ${Array.from({ length: rows }, () => html`<div class="sk-row"><span class="sk"></span><span><span class="sk sk-line"></span><span class="sk sk-line sk-short"></span></span></div>`)}
  </div>`;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
