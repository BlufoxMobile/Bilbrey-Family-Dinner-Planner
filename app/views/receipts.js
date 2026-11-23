// RECEIPTS (SPEC §9.3–9.4): scan a paper receipt or the store app's digital receipt (1–4
// images), check every line, save — the Budget counts it once, prices learned feed the next
// list, and the exact products land in "My products". Plus the history of saved receipts.
import { html, ic, when, openSheet, closeSheet, renderSheet, toast, confirmSheet, segmented, announce } from '../ui.js';
import { money, shortDate, mediumDate, monthName, fmtQty, round2, isISODate, byLabel } from '../util.js';
import { resizeImage, LIMITS } from '../images.js';
import {
  normalizeReceipt, importReceipt, packSizeFor, linePaid, suggestMatches, findDuplicate, receiptList, deleteReceiptOps,
  receiptPantryOps, PANTRY_SYNC_DAYS,
} from '../receipts.js';
import { applyOps } from '../state.js';
import { undoFor } from '../actions.js';
import { itemMeta } from '../shopping.js';
import { readByText } from '../claude.js';
import { openHave } from './sheets.js';

export const title = () => 'Receipts';
export const STORE_NAMES = { sams: "Sam's Club", jewel: 'Jewel-Osco', other: 'Other store' };
const MAX_IMAGES = 4;

function knownList(app) {
  const out = Object.values(app.db.ingredients).map((i) => ({ id: i.id, name: i.name, aliases: i.aliases || [] }));
  for (const [id, c] of Object.entries(app.state.custom || {})) out.push({ id, name: c.name, aliases: [] });
  return out;
}

const nameOf = (app, id) => (id ? itemMeta(app.db, app.state, id).name : '');

// ---------------------------------------------------------------- 1. pick the images

export function openReceiptScan(app) {
  const st = { store: '', files: [] };
  openReceiptScan.state = st;
  const s = app.store;
  if (s.device.localOnly || !s.device.key) {
    openSheet({
      id: 'rcpt-gate',
      title: 'Scanning needs the family server',
      render: () => html`<p class="sheet-text">${s.device.localOnly ? 'This device is set to “this device only.”' : 'This device isn’t connected to the family yet.'} Receipts are read by the family’s server, so connect with the family passcode first. You can still log a receipt’s total by hand on the Budget page.</p>
        <div class="sheet-actions"><a class="btn btn-primary btn-block" href="#/family">Family & settings</a><a class="btn btn-quiet btn-block" href="#/budget">Log a total by hand</a></div>`,
    });
    return;
  }
  openSheet({
    id: 'rcpt-scan',
    title: 'Scan a receipt',
    subtitle: 'A photo of the receipt, or screenshots from the store’s app.',
    render: () => html`
      <fieldset class="field"><legend class="field-label">Store</legend>
        ${segmented('rcptStore', [{ id: 'sams', label: "Sam's Club" }, { id: 'jewel', label: 'Jewel-Osco' }, { id: '', label: 'Not sure' }], st.store, { label: 'Which store', action: 'rcpt:store', small: true })}
      </fieldset>
      <div class="rcpt-pick">
        <label class="btn btn-secondary rcpt-file file-btn">${ic('image', { size: 20 })}Photo library<input type="file" accept="image/*" multiple data-change="rcpt:files" class="file-over" data-testid="rcpt-files" aria-label="Choose receipt photos or screenshots from the photo library"></label>
        <label class="btn btn-secondary rcpt-file file-btn">${ic('camera', { size: 20 })}Take a photo<input type="file" accept="image/*" capture="environment" data-change="rcpt:files" class="file-over" aria-label="Take a photo of the receipt"></label>
      </div>
      <p class="muted small">Long receipt? Up to ${MAX_IMAGES} photos, top to bottom.</p>
      ${when(st.files.length, () => html`<ul class="rcpt-thumbs">${st.files.map((f, k) => html`<li><img src="${f.preview}" alt="Receipt image ${k + 1}"><button type="button" class="icon-btn" data-action="rcpt:unpick" data-k="${k}" aria-label="Remove image ${k + 1}">${ic('close', { size: 18 })}</button></li>`)}</ul>`)}
      <button type="button" class="btn btn-primary btn-block" data-action="rcpt:read" ${st.files.length ? '' : 'disabled'}>${ic('sparkle', { size: 20 })}${st.files.length ? `Read ${st.files.length === 1 ? 'the receipt' : `these ${st.files.length} images`}` : 'Add a photo or screenshot first'}</button>
      <p class="muted small">You check every line before it’s saved. Photos aren’t kept.</p>`,
  });
}

function scanError(e) {
  if (e.status === 0) return 'Reading a receipt needs an internet connection.';
  if (e.status === 401) return 'This device needs the family passcode to read receipts. Enter it in Family & settings.';
  if (e.status === 404) return 'Receipt reading isn’t on the family server yet.';
  if (e.status === 413) return 'Those images are too large together. Try fewer, or closer photos.';
  if (e.status === 429) return 'Too many scans at once. Wait a minute, then try again.';
  if (e.status === 503) return 'Receipt reading isn’t available on the family server right now.';
  if (e.status === 502) return 'The receipt couldn’t be read. Try a brighter, flatter photo.';
  return `The scan didn’t work (${e.message}).`;
}

async function readReceipt(app) {
  const st = openReceiptScan.state;
  if (!st?.files.length) return;
  if (navigator.onLine === false) { toast('Reading a receipt needs an internet connection.'); return; }
  openSheet({ id: 'rcpt-reading', title: 'Reading your receipt', render: () => html`<div class="scan-progress" role="status"><span class="spinner" aria-hidden="true"></span><p>Reading ${st.files.length === 1 ? 'the receipt' : `${st.files.length} images`}. This takes about half a minute.</p></div>` });
  let images;
  try {
    images = [];
    for (const f of st.files) images.push(await resizeImage(f.file, LIMITS.receipt));
    // All of them together must fit the server's limit: shrink harder if they don't.
    if (images.reduce((t, x) => t + x.length, 0) > LIMITS.receiptTotalChars) {
      const each = Math.floor(LIMITS.receiptTotalChars / images.length);
      images = [];
      for (const f of st.files) images.push(await resizeImage(f.file, { ...LIMITS.receipt, max: 1400, maxChars: each }));
    }
  } catch {
    failSheet(app, 'One of those images couldn’t be opened. Try a screenshot or a new photo.');
    return;
  }
  try {
    const body = { images, known: knownList(app) };
    if (st.store) body.store = st.store;
    const r = await app.store.api('POST', '/api/receipt', body, { timeoutMs: 180000 });
    for (const f of st.files) URL.revokeObjectURL(f.preview);
    review(app, r, st.store);
  } catch (e) {
    failSheet(app, scanError(e));
  }
}

function failSheet(app, text) {
  openSheet({
    id: 'rcpt-fail',
    title: 'The receipt wasn’t read',
    render: () => html`<p class="sheet-text">${text}</p>
      <div class="sheet-actions">
        <button type="button" class="btn btn-primary btn-block" data-action="rcpt:scan">Try again</button>
        <a class="btn btn-quiet btn-block" href="#/budget">Log the total by hand</a>
      </div>`,
  });
}

// ---------------------------------------------------------------- 2. check every line

function review(app, raw, storeHint) {
  const today = app.today();
  const r = normalizeReceipt(raw, { today: null });
  if (r.store === 'other' && (storeHint === 'sams' || storeHint === 'jewel')) r.store = storeHint;
  const st = {
    store: r.store, date: r.date || today, total: r.total || '', tax: r.tax, savings: r.savings, toPantry: true,
    readBy: readByText(raw?.engine, raw?.model),
    lines: r.lines.map((l) => {
      const sugg = suggestMatches(app.db, app.state, l, 4);
      const known = l.matchId && (app.db.ingredients[l.matchId] || app.state.custom?.[l.matchId]) ? l.matchId : null;
      const matchId = known || (sugg[0]?.score >= 1.4 ? sugg[0].id : null);
      return { ...l, matchId, include: !l.skip && !(l.confidence != null && l.confidence < 0.2 && !matchId), cands: sugg, sizeHow: null, sure: !!known && !l.skip };
    }),
  };
  for (const l of st.lines) setPack(app, st, l);
  review.state = st;
  if (!st.lines.length) {
    failSheet(app, 'No lines could be read from that receipt. Try a clearer image, or log the total by hand.');
    return;
  }
  openSheet({
    id: 'rcpt-review',
    size: 'tall',
    title: 'Check the receipt',
    subtitle: 'Fix anything misread. Matched lines teach the planner what you paid and which product you buy.',
    render: () => reviewBody(app, st),
  });
}

function setPack(app, st, l) {
  if (!l.matchId) { l.packSize = null; l.sizeHow = null; return; }
  const store = st.store === 'sams' || st.store === 'jewel' ? st.store : 'jewel';
  const p = packSizeFor(app.db, app.state, store, l.matchId, { ...l, packSize: null });
  l.packSize = p.packSize;
  l.sizeHow = p.how;
}

function currentReceipt(st) {
  return {
    store: st.store, date: st.date, total: Number(st.total), tax: st.tax, savings: st.savings,
    lines: st.lines.map((l) => ({ ...l, skip: !l.include, matchId: l.include ? l.matchId : null })),
  };
}

function reviewBody(app, st) {
  const rec = normalizeReceipt(currentReceipt(st));
  const dupe = isISODate(st.date) && Number(st.total) > 0 ? findDuplicate(app.state, rec) : null;
  const included = st.lines.filter((l) => l.include);
  const sum = round2(included.reduce((t, l) => t + (linePaid(l) ?? 0) * l.qty, 0));
  const tax = Number(st.tax) > 0 ? Number(st.tax) : 0;
  const off = Number(st.total) > 0 ? round2(Number(st.total) - sum - tax) : 0;
  const matched = included.filter((l) => l.matchId).length;
  return html`
    ${when(st.readBy, () => html`<p class="read-by">${ic('sparkle', { size: 16 })}${st.readBy}</p>`)}
    ${st.headOpen || !(Number(st.total) > 0) || !isISODate(st.date) || st.store === 'other'
      ? html`<div class="rcpt-head">
      <label class="field"><span class="field-label">Store</span><select class="input" data-change="rcpt:head" data-f="store">
        ${['sams', 'jewel', 'other'].map((x) => html`<option value="${x}" ${st.store === x ? 'selected' : ''}>${STORE_NAMES[x]}</option>`)}</select></label>
      <label class="field"><span class="field-label">Date</span><input class="input" type="date" value="${st.date}" max="${app.today()}" data-change="rcpt:head" data-f="date"></label>
      <label class="field field-money"><span class="field-label">Total</span><span class="prefix" aria-hidden="true">$</span><input class="input" type="number" inputmode="decimal" min="0.01" step="0.01" value="${st.total}" data-input="rcpt:head" data-f="total" aria-label="Receipt total"></label>
    </div>`
      // Read right: one line to confirm, not three boxes to fill (gauntlet r5).
      : html`<p class="rcpt-headline"><span><b>${STORE_NAMES[st.store]}</b> · ${shortDate(st.date)} · <b>${money(Number(st.total))}</b></span>
      <button type="button" class="link-btn" data-action="rcpt:edit-head" aria-label="Edit the store, date or total">Edit</button></p>`}
    ${when(st.savings, () => html`<p class="muted small">${STORE_NAMES[st.store] || 'The store'} took off ${money(st.savings)} in savings.</p>`)}
    ${when(st.store === 'other', () => html`<p class="hint">${ic('info', { size: 18 })}<span>Prices and products are learned for Sam’s Club and Jewel-Osco receipts. This one still counts in the Budget.</span></p>`)}
    ${when(dupe, () => html`<p class="hint hint-warn">${ic('info', { size: 18 })}<span>This receipt is already saved (${STORE_NAMES[rec.store]}, ${shortDate(rec.date)}, ${money(rec.total)}). Saving again won’t count it twice.</span></p>`)}
    <ul class="rcpt-lines">${st.lines.map((l, k) => lineRow(app, st, l, k))}</ul>
    <div class="rcpt-check ${Math.abs(off) > 0.5 ? 'is-off' : ''}">
      <p><span>Lines checked</span><b>${money(sum)}</b></p>
      ${when(tax, () => html`<p><span>Tax</span><b>${money(tax)}</b></p>`)}
      <p><span>Receipt total</span><b>${Number(st.total) > 0 ? money(Number(st.total)) : '—'}</b></p>
      <small>${Math.abs(off) > 0.5 ? `${money(Math.abs(off))} ${off > 0 ? 'isn’t in the lines above (skipped or misread lines, deposits, bags)' : 'more in the lines than the total: check quantities'}. The receipt total is what the Budget counts.` : 'The lines add up to the total.'}</small>
    </div>
    ${when(matched, () => html`<label class="rcpt-pantry"><input type="checkbox" ${st.toPantry ? 'checked' : ''} data-change="rcpt:topantry"><span><b>Add these groceries to the pantry</b><small>${matched} matched ${matched === 1 ? 'item goes' : 'items go'} on the shelf, so the list stops asking for them. Leave it off for an old receipt.</small></span></label>`)}
    <button type="button" class="btn btn-primary btn-block" data-action="rcpt:save" ${dupe || !(Number(st.total) > 0) || !isISODate(st.date) ? 'disabled' : ''}>${ic('check', { size: 20 })}${dupe ? 'Already saved' : `Save receipt${matched ? `: learn ${matched} ${matched === 1 ? 'price' : 'prices'}` : ''}`}</button>`;
}

function lineRow(app, st, l, k) {
  const paid = linePaid(l);
  // A line the scanner matched for sure, with its size, is one read-only row; a tap opens it to fix
  // (gauntlet r2: every line was a four-field form). Unsure and unmatched lines stay open.
  if (l.sure && !l.open && l.include && l.matchId && Number(l.packSize) > 0 && l.sizeHow !== 'default') {
    const u = itemMeta(app.db, app.state, l.matchId).unit;
    return html`<li class="rcpt-line is-sure" data-k="${k}">
      <label class="review-inc"><input type="checkbox" checked data-change="rcpt:line" data-k="${k}" data-f="include"><span class="sr-only">Include ${l.product}</span></label>
      <button type="button" class="rcpt-sure" data-action="rcpt:open" data-k="${k}" aria-label="${nameOf(app, l.matchId)}: ${l.product}. Tap to fix">
        <span><b>${nameOf(app, l.matchId)}</b><small>${[l.text || l.product, `${fmtQty(Number(l.packSize))} ${u}`].filter(Boolean).join(' · ')}</small></span>
        <span class="rcpt-sure-paid">${paid != null ? money(paid) : ''}${ic('check', { size: 16 })}</span>
      </button>
    </li>`;
  }
  // Unsure, but with a best guess: the guess in words and a Fix button; the form only when asked (gauntlet r5).
  if (!l.open && l.include && l.matchId) {
    const u = itemMeta(app.db, app.state, l.matchId).unit;
    const size = Number(l.packSize) > 0 ? `${fmtQty(Number(l.packSize))} ${u}` : '';
    return html`<li class="rcpt-line is-sure is-guess" data-k="${k}">
      <label class="review-inc"><input type="checkbox" checked data-change="rcpt:line" data-k="${k}" data-f="include"><span class="sr-only">Include ${l.product}</span></label>
      <button type="button" class="rcpt-sure" data-action="rcpt:open" data-k="${k}" aria-label="Probably ${nameOf(app, l.matchId)}${size ? `, ${size}` : ''}: ${l.product}. Fix it">
        <span><b>Probably ${nameOf(app, l.matchId)}</b><small>${[l.text || l.product, size ? `${size}${l.sizeHow === 'default' ? ' (the usual pack)' : ''}` : 'size not read'].filter(Boolean).join(' · ')}</small></span>
        <span class="rcpt-sure-paid">${paid != null ? money(paid) : ''}<span class="rcpt-fix">Fix</span></span>
      </button>
    </li>`;
  }
  const unit = l.matchId ? itemMeta(app.db, app.state, l.matchId).unit : '';
  const cands = [...new Map([...(l.matchId ? [{ id: l.matchId, name: nameOf(app, l.matchId) }] : []), ...l.cands].map((c) => [c.id, c])).values()];
  return html`<li class="rcpt-line ${l.include ? '' : 'is-skipped'}" data-k="${k}">
    <label class="review-inc"><input type="checkbox" ${l.include ? 'checked' : ''} data-change="rcpt:line" data-k="${k}" data-f="include"><span class="sr-only">Include ${l.product}</span></label>
    <div class="rcpt-main">
      <input class="input" value="${l.product}" maxlength="120" data-input="rcpt:line" data-k="${k}" data-f="product" aria-label="Product name">
      <small class="rcpt-sub">${[l.text && l.text !== l.product ? l.text : '', l.size, paid != null ? `${l.qty !== 1 ? `${fmtQty(l.qty)} × ` : ''}${money(paid)}${l.discount ? ` after ${money(l.discount)} off` : ''}` : ''].filter(Boolean).join(' · ')}</small>
      ${l.include ? html`<select class="input" data-change="rcpt:line" data-k="${k}" data-f="matchId" aria-label="What it is">
          ${cands.map((c) => html`<option value="${c.id}" ${c.id === l.matchId ? 'selected' : ''}>${c.name}</option>`)}
          <option value="" ${!l.matchId ? 'selected' : ''}>Not on our list (just count it)</option>
        </select>
        ${when(l.matchId, () => html`<label class="rcpt-size ${l.sizeHow === 'default' ? 'is-guess' : ''}"><span>Pack size</span><input class="input" type="number" inputmode="decimal" min="0.01" step="any" value="${l.packSize ?? ''}" data-input="rcpt:line" data-k="${k}" data-f="packSize" aria-label="Pack size in ${unit}"><span>${unit}</span></label>
          ${when(l.sizeHow === 'default' || !l.packSize, () => html`<small class="rcpt-guess">Check the size: it couldn’t be read from the receipt, so this is the usual pack.</small>`)}`)}`
        : html`<small class="muted">Skipped: not a grocery item. It still counts in the total.</small>`}
    </div>
  </li>`;
}

async function save(app) {
  const st = review.state;
  if (!st) return;
  const receipt = currentReceipt(st);
  for (const l of receipt.lines) if (l.matchId && !(Number(l.packSize) > 0)) l.packSize = null;
  const ops = importReceipt(app.state, receipt, { db: app.db, by: app.who() || 'Family', source: 'scan', today: app.today() });
  if (ops.duplicate) { toast('That receipt is already saved.'); closeSheet(); return; }
  if (ops.error) { toast(ops.error); return; }
  const where = STORE_NAMES[ops.store] || 'the store';
  // v2.5: sync the pantry from the receipt (recent receipts only, and only when asked).
  let stocked = 0;
  const recent = isISODate(ops.date) && (Date.parse(`${app.today()}T12:00:00Z`) - Date.parse(`${ops.date}T12:00:00Z`)) / 86400000 <= PANTRY_SYNC_DAYS;
  if (st.toPantry && recent && ops.id) {
    const pops = receiptPantryOps(app.db, applyOps(app.state, ops), ops.id, { who: app.who() || 'Family' });
    stocked = pops.filter((o) => o.path[0] === 'pantry').length;
    ops.push(...pops);
  }
  const learned = ops.learned ? ` Learned ${ops.learned === 1 ? 'one price' : `${ops.learned} prices`} for next time.` : '';
  // With groceries in the pantry the toast is one line; Cook from what we have opens right after (gauntlet r7).
  const message = stocked
    ? `Saved ${money(ops.total)} · ${stocked} ${stocked === 1 ? 'item' : 'items'} in the pantry`
    : `Saved ${money(ops.total)} from ${where}, ${shortDate(ops.date)}.${ops.counted ? '' : ' It was already in the Budget, so it’s not counted twice.'}${learned}`;
  const undo = undoFor(app.state, ops);
  // With groceries in the pantry, the "Saved" line and its Undo sit at the top of Cook from what we
  // have, not in a toast over its first rows (gauntlet r10).
  app.commit({ ops: [...ops], undo, message }, { quiet: !!stocked });
  closeSheet();
  const here = location.hash;
  const bought = new Set(receipt.lines.filter((l) => l.matchId).map((l) => l.matchId));
  if (stocked) {
    announce(`${message}.`);
    setTimeout(() => { if (location.hash === here) openHave(app, { bought, saved: { text: message, undo } }); }, 350);
  }
}

// ---------------------------------------------------------------- 3. history

function lineList(app, r) {
  return html`<ul class="rcpt-history-lines">${r.lines.map((l) => {
    const paid = linePaid(l);
    return html`<li><span><b>${l.product}</b><small>${[l.size, l.qty !== 1 ? `${fmtQty(l.qty)} ×` : '', l.matchId ? nameOf(app, l.matchId) : 'not on our list'].filter(Boolean).join(' · ')}</small></span><span>${paid != null ? money(round2(paid * (l.qty || 1))) : '—'}</span></li>`;
  })}</ul>`;
}

export function receiptDetails(app, r, { open = false } = {}) {
  return html`<details class="rcpt-card" ${open ? 'open' : ''}>
    <summary><span><b>${STORE_NAMES[r.store] || r.store}</b><small>${shortDate(r.date)} · ${r.lines.length} ${r.lines.length === 1 ? 'line' : 'lines'}${r.source === 'import' ? ' · from purchase history' : byLabel(r.by) ? ` · scanned by ${byLabel(r.by)}` : ''}</small></span><b class="receipt-amt">${money(Number(r.total))}</b></summary>
    ${lineList(app, r)}
    ${when(r.savings, () => html`<p class="muted small">Savings: ${money(r.savings)}${r.tax != null ? ` · Tax: ${money(r.tax)}` : ''}</p>`)}
    <button type="button" class="btn btn-quiet btn-small" data-action="rcpt:delete" data-id="${r.id}">${ic('trash', { size: 18 })}Delete this receipt</button>
  </details>`;
}

export function render(app) {
  const list = receiptList(app.state);
  const months = new Map();
  for (const r of list) {
    const m = r.date.slice(0, 7);
    if (!months.has(m)) months.set(m, []);
    months.get(m).push(r);
  }
  return html`<div class="page page-receipts">
    <a class="back" href="#/budget">${ic('left', { size: 20 })}Budget</a>
    <header class="page-head"><h1 class="page-title">Receipts</h1></header>
    <button type="button" class="btn btn-primary" data-action="rcpt:scan">${ic('camera', { size: 20 })}Scan a receipt</button>
    <p class="muted small">Every saved receipt, with what was on it. Deleting one takes it out of the Budget and forgets the prices it taught.</p>
    ${list.length ? [...months.entries()].map(([m, rs]) => html`<section class="rcpt-month"><h2 class="section-title">${monthName(`${m}-01`)}<small>${money(round2(rs.reduce((t, r) => t + Number(r.total || 0), 0)))}</small></h2>${rs.map((r) => receiptDetails(app, r))}</section>`)
      : html`<div class="empty"><span class="empty-ic">${ic('receipt', { size: 28 })}</span><h3 class="empty-title">No scanned receipts yet</h3><p class="empty-body">After a trip, scan the receipt (or the store app’s digital receipt). The Budget counts it, and the next list uses what you actually paid.</p></div>`}
  </div>`;
}

export const actions = {
  'rcpt:scan': (app) => openReceiptScan(app),
  'rcpt:store': (app, el) => { if (openReceiptScan.state) openReceiptScan.state.store = el.dataset.value; renderSheet(); },
  'rcpt:files': (app, el) => {
    const st = openReceiptScan.state;
    if (!st) return;
    const files = [...(el.files || [])].filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|heic|webp)$/i.test(f.name));
    const room = MAX_IMAGES - st.files.length;
    if (files.length > room) toast(`Up to ${MAX_IMAGES} images for one receipt.`);
    for (const f of files.slice(0, Math.max(0, room))) st.files.push({ file: f, preview: URL.createObjectURL(f) });
    el.value = '';
    renderSheet();
  },
  'rcpt:unpick': (app, el) => {
    const st = openReceiptScan.state;
    const [f] = st?.files.splice(Number(el.dataset.k), 1) || [];
    if (f) URL.revokeObjectURL(f.preview);
    renderSheet();
  },
  'rcpt:read': (app) => readReceipt(app),
  'rcpt:topantry': (app, el) => { if (review.state) review.state.toPantry = !!el.checked; },
  'rcpt:head': (app, el) => {
    const st = review.state;
    if (!st) return;
    const f = el.dataset.f;
    st[f] = f === 'total' ? el.value : el.value;
    if (f === 'store') for (const l of st.lines) setPack(app, st, l);
    if (el.tagName === 'SELECT' || el.type === 'date') renderSheet();
    else updateCheck(app);
  },
  'rcpt:edit-head': () => { const st = review.state; if (st) { st.headOpen = true; renderSheet(); } },
  'rcpt:open': (app, el) => { const l = review.state?.lines?.[Number(el.dataset.k)]; if (l) { l.open = true; renderSheet(); } },
  'rcpt:line': (app, el) => {
    const st = review.state;
    const l = st?.lines[Number(el.dataset.k)];
    if (!l) return;
    const f = el.dataset.f;
    if (f === 'include') { l.include = el.checked; renderSheet(); return; }
    if (f === 'matchId') { l.matchId = el.value || null; setPack(app, st, l); renderSheet(); return; }
    if (f === 'packSize') { const n = Number(el.value); l.packSize = n > 0 ? n : null; l.sizeHow = n > 0 ? 'given' : l.sizeHow; return; }
    if (f === 'product') l.product = el.value.trim() || l.text || 'Item';
  },
  'rcpt:save': (app) => save(app),
  'rcpt:delete': async (app, el) => {
    const id = el.dataset.id;
    const r = app.state.receiptLog?.[id];
    if (!r) return;
    const ok = await confirmSheet({ title: 'Delete this receipt?', body: `${STORE_NAMES[r.store] || 'Receipt'}, ${mediumDate(r.date)}, ${money(Number(r.total))}. It comes out of the Budget, and the prices it taught are forgotten.`, confirm: 'Delete receipt', danger: true });
    if (!ok) return;
    const ops = deleteReceiptOps(app.state, id);
    app.commit({ ops, undo: undoFor(app.state, ops), message: 'Receipt deleted.' });
  },
};

/** The totals box re-renders without touching the inputs (so typing isn't interrupted). */
function updateCheck(app) {
  const st = review.state;
  const box = document.querySelector('dialog[open] .rcpt-check');
  const btn = document.querySelector('dialog[open] [data-action="rcpt:save"]');
  if (!st || !box) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = reviewBody(app, st).s;
  const fresh = tmp.querySelector('.rcpt-check');
  if (fresh) box.replaceWith(fresh);
  const freshBtn = tmp.querySelector('[data-action="rcpt:save"]');
  if (btn && freshBtn) btn.replaceWith(freshBtn);
}
