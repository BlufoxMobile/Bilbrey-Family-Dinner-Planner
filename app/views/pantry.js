// PANTRY: scan shelves with the camera (AI suggests, the family confirms), add by hand,
// staples "stocked until low", measured items by amount, "running low" back to the list.
import { html, ic, when, openSheet, closeSheet, toast, renderSheet, switchToggle, confirmSheet } from '../ui.js';
import { resizeImage, LIMITS } from '../images.js';
import { STORAGE, AISLES } from '../config.js';
import { fmtQty, round2 } from '../util.js';
import { setPantryOps, removePantryOps, customItemOps, undoFor } from '../actions.js';
import { set } from '../state.js';
import { kindOf } from '../planner.js';
import { unitText } from '../shopping.js';
import { scanQtyIn } from '../scanqty.js';

export const title = () => 'Pantry';

function meta(app, id) {
  const ing = app.db.ingredients[id];
  if (ing) return { id, name: ing.name, unit: ing.unit, storage: ing.storage, kind: ing.kind, aisle: ing.aisle, custom: false };
  const c = app.state.custom?.[id];
  if (c) return { id, name: c.name, unit: c.unit || 'each', storage: c.storage || 'pantry', kind: c.kind === 'staple' ? 'staple' : 'measured', aisle: c.aisle, custom: true };
  return null;
}

const stepFor = (unit) => (unit === 'lb' ? 0.5 : unit === 'oz' ? 4 : unit === 'tbsp' || unit === 'tsp' ? 4 : 1);
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

function searchCatalog(app, q, limit = 8) {
  const n = norm(q);
  if (!n) return [];
  const words = n.split(' ');
  const rows = [];
  for (const ing of Object.values(app.db.ingredients)) {
    const hay = norm([ing.name, ...(ing.aliases || [])].join(' '));
    const hit = words.every((w) => hay.includes(w));
    if (hit) rows.push({ id: ing.id, name: ing.name, unit: ing.unit, score: hay.startsWith(n) ? 2 : 1 });
  }
  for (const [id, c] of Object.entries(app.state.custom || {})) {
    if (words.every((w) => norm(c.name).includes(w))) rows.push({ id, name: c.name, unit: c.unit, score: 1.5, custom: true });
  }
  return rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, limit);
}

function pantryRow(app, id, p) {
  const m = meta(app, id);
  if (!m) return '';
  const staple = m.kind === 'staple';
  return html`<li class="pan-row ${p.low ? 'is-low' : ''}">
    <span class="pan-name"><b>${m.name}</b>
      ${when(p.label && !m.custom, () => html`<small class="pan-label">${p.label}</small>`)}
      <small>${p.low ? 'Running low, on the shopping list' : staple ? (p.stocked ? 'Stocked until low' : 'Not stocked') : `${typeof p.qty === 'number' ? `${unitText(p.qty, m.unit)} on hand` : `Amount in ${m.unit}`}${m.custom ? ', shelf item' : ''}`}${p.by ? `, updated by ${p.by}` : ''}</small></span>
    <span class="pan-ctrl">
      ${staple
        ? switchToggle({ on: !!p.stocked && !p.low, action: 'pan:stock', data: { id }, label: `${m.name} stocked until low` })
        : html`<span class="qty-edit">
            <button type="button" class="stepper-btn" data-action="pan:step" data-id="${id}" data-delta="-${stepFor(m.unit)}" aria-label="Less ${m.name}">${ic('minus', { size: 18 })}</button>
            <input class="qty-input" type="number" inputmode="decimal" min="0" step="any" value="${typeof p.qty === 'number' ? round2(p.qty) : ''}" data-change="pan:qty" data-id="${id}" aria-label="${m.name} amount in ${m.unit}">
            <button type="button" class="stepper-btn" data-action="pan:step" data-id="${id}" data-delta="${stepFor(m.unit)}" aria-label="More ${m.name}">${ic('plus', { size: 18 })}</button>
          </span>`}
      <button type="button" class="btn btn-small ${p.low ? 'btn-secondary' : 'btn-quiet'}" data-action="pan:low" data-id="${id}" aria-pressed="${p.low ? 'true' : 'false'}">${p.low ? 'Restocked' : 'Running low'}</button>
      <button type="button" class="icon-btn" data-action="pan:remove" data-id="${id}" aria-label="Remove ${m.name}">${ic('trash', { size: 20 })}</button>
    </span>
  </li>`;
}

export function render(app) {
  const pantry = app.state.pantry || {};
  const entries = Object.entries(pantry).filter(([id, p]) => p && meta(app, id));
  const low = entries.filter(([, p]) => p.low);
  const groups = STORAGE.map((s) => ({ ...s, rows: entries.filter(([id, p]) => !p.low && meta(app, id).storage === s.id).sort((a, b) => meta(app, a[0]).name.localeCompare(meta(app, b[0]).name)) }));
  const canScan = app.store.device.key && !app.store.device.localOnly && app.store.health?.ai !== false;
  return html`<div class="page page-pantry">
    <header class="page-head"><h1 class="page-title">Pantry</h1></header>
    <section class="scan-card">
      <div class="scan-text">
        <h2 class="scan-title">Scan the pantry before you shop</h2>
        <p class="small">Take photos of the shelves, fridge and freezer. The app suggests what it sees and you confirm each item, so the list only buys what’s missing.</p>
      </div>
      <label class="btn btn-primary btn-block scan-btn">
        ${ic('camera', { size: 22 })}Take or choose photos
        <input type="file" accept="image/*" multiple class="sr-only" data-change="pan:scan" aria-label="Take or choose pantry photos">
      </label>
      ${when(!canScan, () => html`<p class="muted small">${app.store.device.localOnly ? 'Scanning needs the family server, and this phone is set to “this phone only.” Add items by hand below.' : !app.store.device.key ? 'Scanning needs the family server. Connect with the family passcode, or add items by hand below.' : 'Pantry scanning isn’t available on the family server right now. Add items by hand below.'}</p>`)}
    </section>
    <section class="pan-add" aria-labelledby="add-h">
      <h2 id="add-h" class="section-title">Add by hand</h2>
      <label class="search">${ic('search', { size: 20 })}<input type="search" id="pantry-search" placeholder="Chicken, rice, green beans…" value="${app.ui.pantryQuery}" data-input="pan:search" aria-label="Search ingredients to add" autocomplete="off"></label>
      <div id="pan-results">${results(app)}</div>
    </section>
    ${when(low.length, () => html`<section class="pan-group"><h2 class="section-title">Running low</h2><ul class="pan-list">${low.map(([id, p]) => pantryRow(app, id, p))}</ul></section>`)}
    ${entries.length ? groups.filter((g) => g.rows.length).map((g) => html`<section class="pan-group"><h2 class="section-title">${g.label}</h2><ul class="pan-list">${g.rows.map(([id, p]) => pantryRow(app, id, p))}</ul></section>`)
      : html`<div class="empty"><span class="empty-ic">${ic('pantry', { size: 28 })}</span><h3 class="empty-title">The pantry is empty</h3><p class="empty-body">Scan your shelves or add what you have. Staples like salt and spices stay off the list until you mark them running low.</p></div>`}
  </div>`;
}

function results(app) {
  const q = app.ui.pantryQuery.trim();
  if (!q) return '';
  const rows = searchCatalog(app, q);
  const pantry = app.state.pantry || {};
  return html`<ul class="pick-list">
    ${rows.map((r) => html`<li><button type="button" class="pick-row" data-action="pan:add" data-id="${r.id}">
      <span class="pick-main"><b>${r.name}</b><small>${pantry[r.id] ? 'Already in the pantry' : kindOf(app.db, app.state, r.id) === 'staple' ? 'Staple: stocked until low' : `Measured in ${r.unit}`}</small></span>${ic('plus', { size: 20 })}</button></li>`)}
    <li><button type="button" class="pick-row" data-action="pan:new" data-name="${q}"><span class="pick-main"><b>Add “${q}” as a shelf item</b><small>Not in the recipe box. Usable as a substitute side.</small></span>${ic('plus', { size: 20 })}</button></li>
  </ul>`;
}

// ---------------------------------------------------------------- scanning

const resize = (file) => resizeImage(file, LIMITS.pantry);

const FORM = { freezer: 'frozen', fridge: 'refrigerated', pantry: 'shelf-stable', counter: 'fresh' };

function knownList(app) {
  // The form tells the scanner canned mushrooms aren't the fresh ones and canned peas aren't frozen.
  const out = Object.values(app.db.ingredients).map((i) => ({ id: i.id, name: `${i.name} [${FORM[i.storage] || 'shelf-stable'}]`, aliases: i.aliases || [] }));
  for (const [id, c] of Object.entries(app.state.custom || {})) out.push({ id, name: c.name, aliases: [] });
  return out;
}

function scanErrorText(e) {
  if (e.status === 0) return 'Pantry scan needs an internet connection. You can add items by hand below.';
  if (e.status === 401) return 'Pantry scan needs the family passcode on this phone. Enter it in Family & settings, or add items by hand.';
  if (e.status === 413) return 'That photo is too large. Try a closer, simpler photo.';
  if (e.status === 429) return 'Too many scans at once. Wait a minute, then try again.';
  if (e.status === 503) return 'Pantry scanning isn’t available on the family server right now. Add items by hand below.';
  if (e.status === 502) return 'The scanner couldn’t read that photo. Try again with more light, or add items by hand.';
  return `The scan didn’t work (${e.message}). Add items by hand below.`;
}

async function runScan(app, files) {
  if (!files.length) return;
  if (app.store.device.localOnly || !app.store.device.key) {
    openSheet({ title: 'Scanning needs the family server', render: () => html`<p class="sheet-text">${app.store.device.localOnly ? 'This phone is set to “this phone only.”' : 'This phone isn’t connected to the family yet.'} Pantry photos are read by the family’s server, so connect with the family passcode first, or add items by hand.</p>
      <div class="sheet-actions"><a class="btn btn-primary btn-block" href="#/family">Family & settings</a><button type="button" class="btn btn-quiet btn-block" data-action="pan:manual">Add by hand</button></div>` });
    return;
  }
  if (navigator.onLine === false) {
    openSheet({ title: 'You’re offline', render: () => html`<p class="sheet-text">Pantry scan needs an internet connection. Everything else works offline, and you can add items by hand right now.</p><div class="sheet-actions"><button type="button" class="btn btn-primary btn-block" data-action="pan:manual">Add by hand</button></div>` });
    return;
  }
  const st = { done: 0, total: files.length, items: [], errors: [] };
  openSheet({
    id: 'scan',
    title: 'Reading your photos',
    render: () => html`<div class="scan-progress" role="status"><span class="spinner" aria-hidden="true"></span><p>Photo ${Math.min(st.done + 1, st.total)} of ${st.total}…</p></div>`,
  });
  for (const f of files) {
    try {
      const image = await resize(f);
      const r = await app.store.api('POST', '/api/scan', { image, known: knownList(app) }, { timeoutMs: 90000 });
      for (const it of r?.items || []) st.items.push(it);
    } catch (e) {
      st.errors.push(e.status !== undefined ? scanErrorText(e) : 'One photo couldn’t be opened.');
      if (e.status === 0 || e.status === 401 || e.status === 503) break;
    }
    st.done++;
    renderSheet();
  }
  review(app, st);
}

/** "Rao's Homemade Marinara Sauce" — what the label says, brand first, when the scanner could read it. */
export function scanLabel(it) {
  const brand = String(it?.brand || '').trim();
  const label = String(it?.label || '').trim();
  if (label && brand && !label.toLowerCase().includes(brand.toLowerCase())) return `${brand} ${label}`.slice(0, 120);
  return (label || brand).slice(0, 120);
}

export function mergeDetections(app, items) {
  const by = new Map();
  for (const it of items) {
    const matchId = it.matchId && (app.db.ingredients[it.matchId] || app.state.custom?.[it.matchId]) ? it.matchId : null;
    const key = matchId || norm(scanLabel(it) || it.name);
    if (!key) continue;
    const prev = by.get(key);
    const ing = matchId ? app.db.ingredients[matchId] : null;
    // A scanned count ("1 jar") in the recipe box's unit (24 oz) for catalog items.
    const conv = ing ? scanQtyIn(ing, it.qty, it.unit) : { qty: Number(it.qty) > 0 ? Number(it.qty) : null, per: null, from: null };
    const label = scanLabel(it);
    if (!prev) {
      by.set(key, { name: it.name || meta(app, matchId)?.name || 'Item', label, matchId, qty: conv.qty, seen: conv.per ? conv.from : null, unit: it.unit || null, confidence: Number(it.confidence) || 0, include: (Number(it.confidence) || 0) >= 0.35 });
    } else {
      // The same product on two photos (or two shelves): keep the larger count, never double it.
      if (conv.qty !== null && conv.qty > (prev.qty || 0)) { prev.qty = conv.qty; prev.seen = conv.per ? conv.from : null; }
      if (!prev.label && label) prev.label = label;
      prev.confidence = Math.max(prev.confidence, Number(it.confidence) || 0);
    }
  }
  return [...by.values()].sort((a, b) => (b.matchId ? 1 : 0) - (a.matchId ? 1 : 0) || b.confidence - a.confidence);
}

/** A best guess at the aisle for a new shelf item, so spices don't land in "Canned & Jarred". */
export function guessAisle(name) {
  const n = String(name || '').toLowerCase();
  if (/season|spice|pepper,? ground|ground (cinnamon|cumin|ginger|turmeric|red pepper)|turmeric|cinnamon|paprika|oregano|basil|thyme|rosemary|poppy|old bay|cajun|rub\b|bouillon|extract|baking|flour|sugar|cooking spray|pam\b|crumbs/.test(n)) return 'Spices & Baking';
  if (/sauce|dressing|ketchup|mustard|mayo|salsa|vinegar|hot sauce|syrup/.test(n)) return 'Condiments & Sauces';
  if (/chips|stix|crackers?|cookies|cereal|snack|candy|popcorn|pretzel|granola|bars?\b|nuts\b|tea\b|chamomile|coffee/.test(n)) return 'Snacks & Extras';
  if (/pasta|noodle|rice|macaroni|spaghetti|ramen|potato bake|au gratin|stuffing/.test(n)) return 'Pasta & Grains';
  return 'Canned & Jarred';
}

function review(app, st) {
  const rows = mergeDetections(app, st.items);
  if (!rows.length) {
    openSheet({ title: st.errors.length ? 'The scan didn’t work' : 'Nothing recognized', render: () => html`
      <p class="sheet-text">${st.errors[0] || 'The scanner didn’t find anything it could name. Try a closer photo with the labels facing out, or add items by hand.'}</p>
      <div class="sheet-actions"><button type="button" class="btn btn-primary btn-block" data-action="pan:manual">Add by hand</button></div>` });
    return;
  }
  openSheet({
    id: 'scan-review',
    size: 'tall',
    title: `Found ${rows.length} ${rows.length === 1 ? 'item' : 'items'}`,
    subtitle: 'Check each one. Fix names and amounts, or skip it.',
    render: () => html`
      ${when(st.errors.length, () => html`<p class="hint">${ic('info', { size: 18 })}<span>${st.errors[0]}</span></p>`)}
      <form class="form" data-submit="pan:confirm">
        <ul class="review-list">
          ${rows.map((r, k) => {
            const m = r.matchId ? meta(app, r.matchId) : null;
            const staple = m?.kind === 'staple';
            const cands = searchCatalog(app, r.name, 5).filter((c) => c.id !== r.matchId);
            return html`<li class="review-row">
              <label class="review-inc"><input type="checkbox" name="inc-${k}" ${r.include ? 'checked' : ''}><span class="sr-only">Add ${r.name}</span></label>
              <div class="review-main">
                <input class="input" name="name-${k}" value="${m ? m.name : (r.label || r.name).slice(0, 60)}" aria-label="Name" maxlength="60">
                ${when(m && r.label, () => html`<p class="muted small">Label: ${r.label}</p>`)}
                <select class="input" name="match-${k}" aria-label="Match to">
                  ${when(m, () => html`<option value="${r.matchId}" selected>Matches: ${m.name}</option>`)}
                  ${cands.map((c) => html`<option value="${c.id}">Matches: ${c.name}</option>`)}
                  <option value="" ${!m ? 'selected' : ''}>New shelf item</option>
                </select>
                ${staple ? html`<p class="muted small">Staple: marked stocked until low.</p>` : html`<div class="field-row">
                  <input class="input" name="qty-${k}" type="number" inputmode="decimal" min="0" step="any" value="${r.qty ?? ''}" placeholder="Amount" aria-label="Amount">
                  <input class="input" name="unit-${k}" value="${m?.unit || r.unit || 'each'}" aria-label="Unit" ${m ? 'readonly' : ''}>
                </div>
                ${when(m && r.seen, () => html`<p class="muted small">Saw ${r.seen}, about ${fmtQty(r.qty)} ${m.unit}.</p>`)}`}
                ${when(r.confidence && r.confidence < 0.6, () => html`<p class="muted small">Not sure about this one. Double-check it.</p>`)}
              </div>
            </li>`;
          })}
        </ul>
        <button type="submit" class="btn btn-primary btn-block">Add checked items to the pantry</button>
      </form>`,
  });
  review.rows = rows;
}

export const actions = {
  'pan:search': (app, el) => {
    app.ui.pantryQuery = el.value;
    const box = document.getElementById('pan-results');
    if (box) box.innerHTML = results(app).s ?? String(results(app));
  },
  'pan:add': (app, el) => {
    const id = el.dataset.id;
    const m = meta(app, id);
    if (!m) return;
    const p = app.state.pantry?.[id];
    if (p && !p.low) { toast(`${m.name} is already in the pantry.`); return; }
    const res = m.kind === 'staple'
      ? setPantryOps(app.db, app.state, { id, stocked: true, low: false, who: app.who() })
      : setPantryOps(app.db, app.state, { id, qty: p?.qty ?? stepFor(m.unit) * (m.unit === 'oz' ? 4 : 2), low: false, who: app.who() });
    res.message = `${m.name} added. ${m.kind === 'staple' ? 'Stocked until low.' : 'Set the amount below.'}`;
    app.ui.pantryQuery = '';
    app.commit(res);
  },
  'pan:new': async (app, el) => {
    const name = String(el.dataset.name || '').trim();
    if (!name) return;
    openSheet({
      title: `Add “${name}”`,
      subtitle: 'A shelf item that isn’t in the recipe box.',
      render: () => html`<form class="form" data-submit="pan:new-save">
        <input type="hidden" name="name" value="${name}">
        <div class="field-row">
          <label class="field"><span class="field-label">Amount</span><input class="input" name="qty" type="number" inputmode="decimal" min="0" step="any" value="1"></label>
          <label class="field"><span class="field-label">Unit</span><select class="input" name="unit">${['cans', 'each', 'lb', 'oz', 'bags', 'boxes', 'jars', 'bottles'].map((u) => html`<option>${u}</option>`)}</select></label>
        </div>
        <label class="field"><span class="field-label">Where it’s kept</span><select class="input" name="storage">${STORAGE.map((s) => html`<option value="${s.id}" ${s.id === 'pantry' ? 'selected' : ''}>${s.label}</option>`)}</select></label>
        <label class="field"><span class="field-label">Aisle</span><select class="input" name="aisle">${AISLES.map((a) => html`<option ${a === 'Canned & Jarred' ? 'selected' : ''}>${a}</option>`)}</select></label>
        <button type="submit" class="btn btn-primary btn-block">Add to the pantry</button>
      </form>`,
    });
  },
  'pan:new-save': (app, form) => {
    const f = new FormData(form);
    const name = String(f.get('name') || '').trim();
    const c = customItemOps(app.state, { name, unit: String(f.get('unit') || 'each'), aisle: String(f.get('aisle') || 'Canned & Jarred'), storage: String(f.get('storage') || 'pantry') });
    const p = setPantryOps(app.db, app.state, { id: c.id, qty: Number(f.get('qty')) || 0, who: app.who() });
    app.ui.pantryQuery = '';
    app.commit({ ops: [...c.ops, ...p.ops], undo: undoFor(app.state, [...c.ops, ...p.ops]), message: `${name} added to the shelf. You can use it as a substitute side.` });
    closeSheet();
  },
  'pan:step': (app, el) => {
    const id = el.dataset.id;
    const cur = app.state.pantry?.[id]?.qty || 0;
    app.commit(setPantryOps(app.db, app.state, { id, qty: Math.max(0, round2(cur + Number(el.dataset.delta))), who: app.who() }), { quiet: true });
  },
  'pan:qty': (app, el) => {
    const v = el.value === '' ? 0 : Number(el.value);
    if (!Number.isFinite(v) || v < 0) return;
    app.commit(setPantryOps(app.db, app.state, { id: el.dataset.id, qty: v, who: app.who() }), { quiet: true });
  },
  'pan:stock': (app, el) => {
    const id = el.dataset.id;
    const p = app.state.pantry?.[id];
    const on = !(p?.stocked && !p?.low);
    app.commit(setPantryOps(app.db, app.state, { id, stocked: on, low: false, who: app.who() }), { quiet: true });
  },
  'pan:low': (app, el) => {
    const id = el.dataset.id;
    const p = app.state.pantry?.[id];
    const m = meta(app, id);
    if (p?.low) {
      app.commit({ ...setPantryOps(app.db, app.state, { id, ...(m.kind === 'staple' ? { stocked: true } : {}), low: false, who: app.who() }), message: `${m.name} restocked.` });
    } else {
      app.commit({ ...setPantryOps(app.db, app.state, { id, low: true, who: app.who() }), message: `${m.name} is on the shopping list.` });
    }
  },
  'pan:remove': async (app, el) => app.commit(removePantryOps(app.db, app.state, { id: el.dataset.id })),
  'pan:scan': (app, el) => {
    const files = [...(el.files || [])].slice(0, 8);
    el.value = '';
    runScan(app, files);
  },
  'pan:manual': () => {
    closeSheet();
    const input = document.getElementById('pantry-search');
    input?.focus();
  },
  'pan:confirm': (app, form) => {
    const rows = review.rows || [];
    const f = new FormData(form);
    const ops = [];
    let n = 0;
    let state = app.state;
    rows.forEach((r, k) => {
      if (!f.get(`inc-${k}`)) return;
      const name = String(f.get(`name-${k}`) || r.name).trim() || r.name;
      const match = String(f.get(`match-${k}`) || '');
      const qtyRaw = f.get(`qty-${k}`);
      const qty = qtyRaw === null || qtyRaw === '' ? null : Number(qtyRaw);
      let id = match || null;
      if (!id) {
        const c = customItemOps(state, { name, unit: String(f.get(`unit-${k}`) || r.unit || 'each'), aisle: guessAisle(name) });
        id = c.id;
        ops.push(...c.ops);
        for (const op of c.ops) state = { ...state, custom: { ...(state.custom || {}), [op.path[1]]: op.value } };
      }
      const m = app.db.ingredients[id];
      const staple = m?.kind === 'staple';
      // Keep what the label said (brand and product) so the family can see which product is on the shelf.
      const label = match && r.label ? { label: r.label.slice(0, 120) } : {};
      ops.push(set(['pantry', id], staple ? { qty: null, stocked: true, ...label, by: app.who(), at: new Date().toISOString() }
        : { qty: Number.isFinite(qty) && qty >= 0 ? round2(qty) : (app.state.pantry?.[id]?.qty ?? 1), stocked: false, ...label, by: app.who(), at: new Date().toISOString() }));
      n++;
    });
    if (!n) { toast('Nothing checked to add.'); return; }
    app.commit({ ops, undo: undoFor(app.state, ops), message: `Added ${n} ${n === 1 ? 'item' : 'items'} to the pantry. The list is updated.` });
    closeSheet();
  },
};

export { confirmSheet };
