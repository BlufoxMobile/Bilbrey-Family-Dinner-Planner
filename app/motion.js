// Motion (docs/spec/19-design.md §3). Everything that moves goes through here or through the
// classes in styles/parts/design.css, takes its timing from the --dur-* / --ease-* tokens in
// styles/tokens.css, animates transform and opacity only, and does nothing at all when the
// person has asked for reduced motion.
//
//   page(update, { dir })      one screen to the next (View Transitions API, with a CSS fallback)
//   sheetOpened(dialog)        the photo that was tapped flies into the sheet it opened
//   closeDialog(dialog, done)  a sheet leaving
//   dragToDismiss(dialog, cb)  pulling a sheet down by its grip or header
//   snapshot(root) / play(root, snap)   around a re-render: rows glide to their new places, new rows
//                              arrive, a box that was just checked pops, a number that changed rolls
//   idle()                     resolves when nothing is mid-transition (tests wait on this)

const doc = typeof document !== 'undefined' ? document : null;
const root = doc?.documentElement;
const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

export const reduced = () => !!mq?.matches;
export const isTV = () => !!root?.classList.contains('is-tv');
const canVT = () => typeof doc?.startViewTransition === 'function';

/** A --dur-* token in milliseconds (so CSS and JS can't drift apart). */
export function dur(name) {
  const v = getComputedStyle(root).getPropertyValue(`--dur-${name}`).trim();
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return 250;
  return /ms$/.test(v) ? n : n * 1000;
}
/** An --ease* token as a WAAPI easing string. */
export function ease(name = '') {
  return getComputedStyle(root).getPropertyValue(name ? `--ease-${name}` : '--ease').trim() || 'ease';
}
/** element.animate() that never throws (an old engine may not know linear() springs). */
function animate(el, frames, opts) {
  try { return el.animate(frames, opts); } catch {
    try { return el.animate(frames, { ...opts, easing: 'cubic-bezier(.2,.7,.2,1)' }); } catch { return null; }
  }
}

// ---------------------------------------------------------------- busy / idle

let busy = 0;
const waiters = [];
function begin() { busy++; root.classList.add('is-moving'); }
function end() {
  busy = Math.max(0, busy - 1);
  if (busy) return;
  root.classList.remove('is-moving');
  while (waiters.length) waiters.pop()();
}
/** Resolves once no page transition, sheet or flying photo is in progress. */
export function idle() { return busy ? new Promise((res) => waiters.push(res)) : Promise.resolve(); }

// ---------------------------------------------------------------- the photo that was tapped

let source = null; // { key, rect, src, frame, at }

/** "img/dinners/beef-tacos-640.webp" and "img/dinners/beef-tacos.webp" are the same picture. */
export function photoKey(img) {
  const s = img?.getAttribute?.('src') || '';
  return s.replace(/-640(?=\.\w+$)/, '').replace(/[?#].*$/, '');
}
const frameOf = (img) => img.closest('.hero-photo') || img.closest('.photo') || img;

function remember(el) {
  const host = el?.closest?.('a, button, [data-action]');
  const img = host?.querySelector?.('.photo img[data-photo].is-loaded');
  if (!img) { source = null; return; }
  const frame = frameOf(img);
  source = { key: photoKey(img), rect: frame.getBoundingClientRect(), src: img.currentSrc || img.src, frame, at: performance.now() };
}
function freshSource(ms) {
  const s = source && performance.now() - source.at < ms ? source : null;
  source = null;
  return s;
}
const inViewport = (r) => r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;

let lastInput = -Infinity;
/** Was there a tap, click or key press in the page within the last `ms`? */
const justActed = (ms = 1200) => performance.now() - lastInput < ms;

/** Once, at boot: remember when the person last acted, and which photo a tap or Enter landed on. */
export function install() {
  if (!doc) return;
  const acted = () => { lastInput = performance.now(); };
  doc.addEventListener('pointerdown', acted, true);
  doc.addEventListener('click', (ev) => { acted(); remember(ev.target); }, true);
  doc.addEventListener('keydown', (ev) => { acted(); if (ev.key === 'Enter') remember(doc.activeElement); }, true);
}

// ---------------------------------------------------------------- page to page

let vtSeq = 0;
const TAGGED = new Set();
function tag(el) { el.style.viewTransitionName = 'shared-photo'; TAGGED.add(el); }
function untagAll() { for (const el of TAGGED) el.style.viewTransitionName = ''; TAGGED.clear(); }

/** The picture on the new screen that matches the one we left from (or are heading back to). */
function findTarget(key, scope) {
  const imgs = [...scope.querySelectorAll('.photo img[data-photo]')].filter((i) => photoKey(i) === key);
  const seen = imgs.map((i) => frameOf(i)).filter((f) => inViewport(f.getBoundingClientRect()));
  return seen.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0] || null;
}

/**
 * Runs `update` (which redraws the screen for the new route) inside a view transition.
 * dir: 'tab' (sideways between sections), 'forward' (deeper), 'back'.
 */
export function page(update, { dir = 'tab' } = {}) {
  // Motion answers an action. A route that changed with nobody touching the page (the address bar,
  // the system's own swipe-back, which brings its own animation) just changes.
  const acted = justActed();
  lastInput = -Infinity; // the action is answered by this change of screen; later redraws are not its echo
  if (!doc || reduced() || doc.visibilityState === 'hidden' || !acted) { update(); return; }
  if (!canVT() || isTV()) {
    update();
    const v = doc.getElementById('view');
    if (v) {
      v.classList.add('is-entering');
      setTimeout(() => v.classList.remove('is-entering'), dur('slow') + 60);
    }
    return;
  }
  // Leaving from a tapped card, or from a screen whose big photo should travel back to its card.
  let src = freshSource(500);
  if (!src) {
    const big = doc.querySelector('#view .recipe-photo .photo img[data-photo].is-loaded, #view .hero-photo .photo img[data-photo].is-loaded');
    if (big && inViewport(frameOf(big).getBoundingClientRect())) src = { key: photoKey(big), frame: frameOf(big) };
  }
  untagAll();
  if (src?.frame?.isConnected && inViewport(src.frame.getBoundingClientRect())) tag(src.frame); else src = null;
  root.dataset.nav = dir;
  root.classList.add('is-vt');
  begin();
  const seq = ++vtSeq;
  const finish = () => {
    end();
    if (seq !== vtSeq) return;
    root.classList.remove('is-vt');
    delete root.dataset.nav;
    untagAll();
  };
  let t;
  try {
    t = doc.startViewTransition(() => {
      untagAll();
      update();
      if (src) { const to = findTarget(src.key, doc.getElementById('view') || doc); if (to) tag(to); }
    });
  } catch {
    finish();
    update();
    return;
  }
  t.finished.then(finish, finish);
  t.ready?.catch(() => { /* skipped: a newer transition started, or the tab was hidden */ });
  t.updateCallbackDone?.catch(() => { /* render errors surface in the console as usual */ });
}

// ---------------------------------------------------------------- sheets

/** Called right after a new sheet is on screen: the tapped photo travels into it. */
export function sheetOpened(dialog) {
  const src = freshSource(300);
  if (!doc || reduced() || isTV() || !src || !inViewport(src.rect)) return;
  const img = [...dialog.querySelectorAll('.sheet-body .photo img[data-photo]')].find((i) => photoKey(i) === src.key);
  const target = img?.closest('.photo');
  const panel = dialog.querySelector('.sheet-panel');
  if (!target || !panel) return;
  // Where the photo will rest once the sheet has finished rising.
  panel.classList.add('is-shown');
  const to = target.getBoundingClientRect();
  panel.classList.remove('is-shown');
  if (!to.width || !to.height) return;
  const ghost = doc.createElement('span');
  ghost.className = 'photo-ghost';
  ghost.setAttribute('aria-hidden', 'true');
  ghost.style.width = `${to.width}px`;
  ghost.style.height = `${to.height}px`;
  ghost.style.borderRadius = getComputedStyle(target).borderRadius;
  ghost.style.backgroundImage = `url("${String(src.src).replace(/"/g, '%22')}")`;
  const s = Math.max(src.rect.width / to.width, src.rect.height / to.height);
  const x0 = src.rect.left + src.rect.width / 2 - (to.width * s) / 2;
  const y0 = src.rect.top + src.rect.height / 2 - (to.height * s) / 2;
  dialog.appendChild(ghost);
  target.classList.add('is-ghosted');
  begin();
  const a = animate(ghost, [
    { transform: `translate(${x0}px, ${y0}px) scale(${s})` },
    { transform: `translate(${to.left}px, ${to.top}px) scale(1)` },
  ], { duration: dur('slow'), easing: ease('spring'), fill: 'both' });
  const done = () => { target.classList.remove('is-ghosted'); ghost.remove(); end(); };
  if (a?.finished) a.finished.then(done, done); else done();
  setTimeout(() => { if (ghost.isConnected) done(); }, dur('slow') + 400); // the sheet was redrawn under us
}

let closing = null; // { dialog, finish }
/** A sheet leaving: plays the exit, then calls `done` (which really closes the <dialog>). */
export function closeDialog(dialog, done) {
  if (!doc || reduced() || !dialog.open || doc.visibilityState === 'hidden') { done(); return; }
  cancelClose();
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    dialog.classList.remove('is-closing');
    closing = null;
    end();
    done();
  };
  const timer = setTimeout(finish, dur('base') + 80);
  closing = { dialog, finish, abandon: () => { finished = true; clearTimeout(timer); dialog.classList.remove('is-closing'); closing = null; end(); } };
  begin();
  dialog.classList.add('is-closing');
  dialog.querySelector('.sheet-panel')?.addEventListener('animationend', (ev) => { if (ev.animationName === 'sheet-down') finish(); }, { once: true });
}
/** A new sheet is opening while the last one is still leaving: keep the <dialog>, drop the exit. */
export function cancelClose() {
  if (!closing) return false;
  closing.abandon();
  return true;
}
/** Finish any exit right now (the route is changing under it). */
export function flushClose() { closing?.finish(); }
export const isClosing = () => !!closing;

/**
 * Pull a sheet down by its grip or header to dismiss it. Past a third of its height, or a quick
 * flick, it goes; otherwise it springs back. Pointer events, so it works for touch, pen and mouse.
 */
export function dragToDismiss(dialog, dismiss) {
  if (!doc || dialog.dataset.drag) return;
  dialog.dataset.drag = '1';
  let st = null;
  const panelOf = () => dialog.querySelector('.sheet-panel');
  dialog.addEventListener('pointerdown', (ev) => {
    if (reduced() || isTV() || ev.button > 0 || innerWidth >= 600) return;
    const handle = ev.target.closest?.('.sheet-grip, .sheet-head');
    if (!handle || ev.target.closest('button, a, input, select, textarea')) return;
    const panel = panelOf();
    if (!panel) return;
    st = { id: ev.pointerId, y: ev.clientY, t: ev.timeStamp, dy: 0, v: 0, lastY: ev.clientY, lastT: ev.timeStamp, panel, moved: false };
  });
  dialog.addEventListener('pointermove', (ev) => {
    if (!st || ev.pointerId !== st.id) return;
    const dy = Math.max(0, ev.clientY - st.y);
    if (!st.moved && dy < 6) return;
    if (!st.moved) { st.moved = true; dialog.classList.add('is-dragging'); try { st.panel.setPointerCapture(st.id); } catch { /* fine */ } }
    const dt = Math.max(1, ev.timeStamp - st.lastT);
    st.v = (ev.clientY - st.lastY) / dt;
    st.lastY = ev.clientY; st.lastT = ev.timeStamp; st.dy = dy;
    st.panel.style.transform = `translateY(${dy}px)`;
    ev.preventDefault();
  });
  const release = (ev) => {
    if (!st || ev.pointerId !== st.id) return;
    const { panel, dy, v, moved } = st;
    st = null;
    if (!moved) return;
    const h = panel.getBoundingClientRect().height || 1;
    const go = dy > h * 0.33 || (v > 0.55 && dy > 24);
    begin();
    const a = animate(panel, [{ transform: `translateY(${dy}px)` }, { transform: go ? 'translateY(105%)' : 'translateY(0)' }],
      { duration: go ? dur('base') : dur('slow'), easing: go ? ease('in') : ease('spring'), fill: 'forwards' });
    const done = () => {
      dialog.classList.remove('is-dragging');
      if (go) dismiss();
      panel.style.transform = '';
      a?.cancel();
      end();
    };
    if (a?.finished) a.finished.then(done, done); else done();
  };
  dialog.addEventListener('pointerup', release);
  dialog.addEventListener('pointercancel', release);
}

// ---------------------------------------------------------------- around a re-render

// Rows that keep an identity from one render to the next. A new list can join by putting
// data-flip="some-stable-key" on its rows.
const ROWS = '.item, .pan-row, .extra-row, .receipt-row, .skip-row, .rate-row, .dropped-row, .product-row, .menu-list > li, .lunch-day, .r-grid > li, .cook-step, .rcpt-card, .fz-row, [data-flip]';
// Things that are "on" and should pop the moment they turn on.
const POPS = '.item.is-checked .check-box, .cook-step.is-done .cook-num, .thumb.is-on, .ed-item.is-on .ed-pos, .vote-btn.is-on, [data-pop].is-on';
// Numbers that roll when they change. Add data-num to any other figure (it must not be display: inline).
const NUMS = '.total-num, .budget-num, .store-total b, .glance-main b, .total-split b, .cost-lines b, .cover-big > b, [data-num]';
// Bars whose length changes.
const BARS = '.progress > span, .ai-meter > span, .cook-progress > span, .meter-spent';
const MAX = 500;

function rowKey(el) {
  if (el.dataset.flip) return `f|${el.dataset.flip}`;
  if (el.id) return `#${el.id}`;
  const base = el.classList[0] || el.tagName;
  const scope = el.closest('.store-sec, .week, .pan-place, .lunch-person, section')?.className.split(' ').slice(0, 2).join('.') || '';
  const d = el.matches('[data-key], [data-date], [data-id]') ? el : el.querySelector('[data-key], [data-date], [data-id], [data-dinner], a[href]');
  const id = d ? (d.dataset.key || d.dataset.date || d.dataset.id || d.dataset.dinner || d.getAttribute('href')) : (el.querySelector('b, .item-name')?.textContent || '').trim();
  return id ? `${base}|${scope}|${id}` : null;
}
function popKey(el, i) {
  const row = el.closest(ROWS);
  const own = ['action', 'id', 'value', 'person', 'key', 'date'].map((k) => el.dataset[k] ?? '').join(',');
  return `${el.classList[0]}|${row ? rowKey(row) : ''}|${own}|${row ? '' : i}`;
}
const num = (t) => { const m = String(t).replace(/,/g, '').match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null; };

/** Take this just before redrawing `root` in place. Returns null when there is nothing to animate. */
export function snapshot(scope) {
  // Only a redraw that follows something the person just did is animated. A redraw caused by the
  // family's changes arriving from another phone lands quietly: nothing slides under a waiting finger.
  if (!doc || !scope || reduced() || doc.visibilityState === 'hidden' || !justActed(1500)) return null;
  const rows = scope.querySelectorAll(ROWS);
  if (rows.length > MAX) return null;
  const snap = { rows: new Map(), dup: new Set(), pops: new Set(), nums: [], bars: [], photos: new Map(), dupPhoto: new Set() };
  for (const el of rows) {
    const k = rowKey(el);
    if (!k) continue;
    if (snap.rows.has(k)) { snap.dup.add(k); continue; }
    snap.rows.set(k, el.getBoundingClientRect());
  }
  scope.querySelectorAll(POPS).forEach((el, i) => snap.pops.add(popKey(el, i)));
  scope.querySelectorAll(NUMS).forEach((el) => snap.nums.push(el.textContent));
  scope.querySelectorAll(BARS).forEach((el) => snap.bars.push(el.getBoundingClientRect().width));
  // Dinner photos on the planner, so two nights that trade places are seen to trade.
  for (const img of scope.querySelectorAll('.day .photo img[data-photo]')) {
    const k = photoKey(img);
    if (snap.photos.has(k)) { snap.dupPhoto.add(k); continue; }
    snap.photos.set(k, img.closest('.photo').getBoundingClientRect());
  }
  return snap;
}

/** Play the difference between `snap` and what is on screen now. */
export function play(scope, snap) {
  if (!snap || !scope || reduced()) return;
  const base = dur('base');
  const slow = dur('slow');
  const out = ease('out');
  const near = (r) => r.bottom > -200 && r.top < innerHeight + 200;
  const rows = scope.querySelectorAll(ROWS);
  if (rows.length <= MAX) {
    const seen = new Set();
    let entered = 0;
    for (const el of rows) {
      const k = rowKey(el);
      if (!k || snap.dup.has(k) || seen.has(k)) continue;
      seen.add(k);
      const was = snap.rows.get(k);
      const now = el.getBoundingClientRect();
      if (!was) { if (snap.rows.size && near(now) && entered++ < 12) el.classList.add('flip-in'); continue; }
      const dx = was.left - now.left; const dy = was.top - now.top;
      if ((Math.abs(dx) < 1.5 && Math.abs(dy) < 1.5) || !(near(was) || near(now)) || Math.abs(dy) > innerHeight * 1.5) continue;
      animate(el, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], { duration: base, easing: out });
    }
  }
  scope.querySelectorAll(POPS).forEach((el, i) => {
    if (snap.pops.has(popKey(el, i))) return;
    el.classList.add('pop');
    el.closest('.item')?.classList.add('just-checked');
  });
  scope.querySelectorAll(NUMS).forEach((el, i) => {
    const was = snap.nums[i];
    if (was === undefined || was === el.textContent) return;
    const a = num(was); const b = num(el.textContent);
    el.classList.add('num-tick');
    if (a !== null && b !== null && b < a) el.classList.add('is-down');
  });
  scope.querySelectorAll(BARS).forEach((el, i) => {
    const was = snap.bars[i]; const now = el.getBoundingClientRect().width;
    if (!was || !now || Math.abs(was - now) < 1) return;
    el.style.transformOrigin = '0 50%';
    animate(el, [{ transform: `scaleX(${was / now})` }, { transform: 'scaleX(1)' }], { duration: slow, easing: out });
  });
  const seenPhoto = new Set();
  for (const img of scope.querySelectorAll('.day .photo img[data-photo]')) {
    const k = photoKey(img);
    if (snap.dupPhoto.has(k) || seenPhoto.has(k)) { seenPhoto.add(k); continue; }
    seenPhoto.add(k);
    const was = snap.photos.get(k);
    if (!was) continue;
    const frame = img.closest('.photo');
    const now = frame.getBoundingClientRect();
    const dx = was.left - now.left; const dy = was.top - now.top;
    if ((Math.abs(dx) < 4 && Math.abs(dy) < 4) || !near(now)) continue;
    frame.style.zIndex = '3';
    const a = animate(frame, [{ transform: `translate(${dx}px, ${dy}px) scale(${was.width / now.width})` }, { transform: 'translate(0, 0) scale(1)' }], { duration: slow, easing: ease('spring') });
    a?.finished.then(() => { frame.style.zIndex = ''; }, () => { frame.style.zIndex = ''; });
  }
}
