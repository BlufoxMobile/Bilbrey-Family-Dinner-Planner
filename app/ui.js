// DOM helpers: an escaping html`` template, bottom sheets on <dialog>, toasts with
// undo, in-app confirmations, photos with graceful placeholders, avatars.

import { escapeHtml } from './util.js';
import { icon, glyph } from './icons.js';
import { FAMILY } from './config.js';

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

export function setHTML(el, safe) {
  el.innerHTML = safe instanceof Safe ? safe.s : esc(safe);
}

// ---------------------------------------------------------------- avatars

export const PERSON_COLORS = { Jeff: 'var(--p-jeff)', Candi: 'var(--p-candi)', Knox: 'var(--p-knox)', Jordan: 'var(--p-jordan)', Jackson: 'var(--p-jackson)' };
export function initials(name) { return name ? name.slice(0, 2) : '?'; }
export function avatar(name, { size = 'md', cls = '' } = {}) {
  const known = FAMILY.includes(name);
  return html`<span class="avatar avatar-${size} ${cls}" style="${known ? `--av:${PERSON_COLORS[name]}` : ''}" aria-hidden="true">${initials(name)}</span>`;
}

// ---------------------------------------------------------------- photos

/**
 * A photo frame that always shows the warm placeholder underneath; the image (if the
 * photos agent produced one) sits on top and removes itself if it fails to load.
 */
export function photo(db, kind, id, { category = 'Comfort', size = 'card', alt = '', eager = false, sideKind = '' } = {}) {
  const p = db?.photos?.[kind === 'side' ? 'sides' : 'dinners']?.[id];
  const cat = kind === 'side' ? (sideKind === 'shelf' ? 'shelf' : 'side') : category;
  const tone = kind === 'side' ? `side-${sideKind || 'vegetable'}` : `cat-${String(category).toLowerCase().replace(/[^a-z]+/g, '-')}`;
  const glyphSize = size === 'hero' ? 84 : size === 'thumb' ? 30 : 52;
  let img = '';
  if (p?.src) {
    const small = p.small || (kind === 'side' ? null : p.src.replace(/\.webp$/, '-640.webp'));
    const sizes = size === 'hero' ? '(min-width: 960px) 640px, 100vw' : size === 'thumb' ? '96px' : '(min-width: 960px) 320px, 50vw';
    const srcset = small && small !== p.src ? `${small} 640w, ${p.src} 1280w` : '';
    img = `<img src="${escapeHtml(p.src)}" ${srcset ? `srcset="${escapeHtml(srcset)}" sizes="${sizes}"` : ''} alt="${escapeHtml(alt)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" data-photo>`;
  }
  return raw(`<span class="photo photo-${size} ${tone}">${`<span class="photo-ph">${glyph(cat, { size: glyphSize })}</span>`}${img}</span>`);
}

/** Installed once: broken images fall back to their srcset-less src, then to the placeholder. */
export function installPhotoFallback(root = document) {
  root.addEventListener('error', (ev) => {
    const img = ev.target;
    if (!(img instanceof HTMLImageElement) || !img.hasAttribute('data-photo')) return;
    if (img.hasAttribute('srcset')) { img.removeAttribute('srcset'); img.removeAttribute('sizes'); img.src = img.getAttribute('src'); return; }
    img.remove();
  }, true);
  root.addEventListener('load', (ev) => {
    const img = ev.target;
    if (img instanceof HTMLImageElement && img.hasAttribute('data-photo')) img.classList.add('is-loaded');
  }, true);
}

// ---------------------------------------------------------------- sheets

let current = null;

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
  }
  return d;
}

/**
 * openSheet({ title, render: () => html, onMount(el), onClose, live, size: 'auto'|'tall', subtitle })
 * `live` sheets re-render when family state changes (e.g. a night's status).
 */
export function openSheet(opts) {
  const d = dialogEl();
  const prevFocus = current ? current.prevFocus : document.activeElement;
  if (current?.onClose) { try { current.onClose(); } catch { /* ignore */ } }
  current = { ...opts, prevFocus };
  d.className = `sheet sheet-${opts.size || 'auto'}`;
  renderSheet();
  if (!d.open) {
    try { d.showModal(); } catch { d.setAttribute('open', ''); }
    document.documentElement.classList.add('has-sheet');
  }
  const first = d.querySelector('[autofocus]') || d.querySelector('.sheet-body button, .sheet-body input, .sheet-body select, .sheet-body a, .sheet-body textarea') || d.querySelector('.sheet-close');
  first?.focus({ preventScroll: true });
}

export function renderSheet() {
  if (!current) return;
  const d = dialogEl();
  const body = current.render();
  const scroller = d.querySelector('.sheet-body');
  const top = scroller ? scroller.scrollTop : 0;
  setHTML(d, html`
    <div class="sheet-panel">
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
}

export function refreshLiveSheet() {
  if (current?.live) renderSheet();
}

export function closeSheet() {
  const d = document.getElementById('sheet');
  const c = current;
  current = null;
  if (d?.open) { try { d.close(); } catch { d.removeAttribute('open'); } }
  document.documentElement.classList.remove('has-sheet');
  c?.onClose?.();
  if (c?.prevFocus && document.contains(c.prevFocus)) c.prevFocus.focus?.({ preventScroll: true });
}

export const sheetOpen = () => !!current;
export const sheetId = () => current?.id || null;

/** In-app confirmation (never window.confirm). Resolves true/false. */
export function confirmSheet({ title, body = '', confirm = 'Confirm', cancel = 'Cancel', danger = false }) {
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
          <button type="button" class="btn btn-quiet btn-block" data-confirm="no">${cancel}</button>
        </div>`,
      onMount: (el) => {
        el.querySelector('[data-confirm="yes"]').addEventListener('click', () => { finish(true); closeSheet(); });
        el.querySelector('[data-confirm="no"]').addEventListener('click', () => { finish(false); closeSheet(); });
      },
      onClose: () => finish(false),
    });
  });
}

// ---------------------------------------------------------------- toasts

let toastTimer = null;
export function toast(message, { undo = null, action = null, duration = 6500 } = {}) {
  if (!message) return;
  let root = document.getElementById('toast');
  if (!root) {
    root = document.createElement('div');
    root.id = 'toast';
    root.className = 'toast-root';
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
    document.body.appendChild(root);
  }
  clearTimeout(toastTimer);
  const btn = undo ? { label: 'Undo', fn: undo } : action;
  setHTML(root, html`<div class="toast">
      <p class="toast-msg">${message}</p>
      ${when(btn, () => html`<button type="button" class="toast-btn">${btn.label}</button>`)}
      <button type="button" class="toast-x icon-btn" aria-label="Dismiss">${ic('close', { size: 18 })}</button>
    </div>`);
  const hide = () => { root.classList.remove('is-on'); };
  root.querySelector('.toast-btn')?.addEventListener('click', () => { hide(); btn.fn(); });
  root.querySelector('.toast-x').addEventListener('click', hide);
  requestAnimationFrame(() => root.classList.add('is-on'));
  toastTimer = setTimeout(hide, duration);
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
    <span class="stepper-val">${value}${unit ? html` <small>${unit}</small>` : ''}</span>
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
