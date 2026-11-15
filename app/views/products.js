// MY PRODUCTS (SPEC §9.5): per ingredient and store, the exact product the family buys —
// learned from receipts, picked from researched options, or typed in — with "Find it" to
// search for that exact product on the store's site.
import { html, ic, when, openSheet, closeSheet, renderSheet, toast, segmented } from '../ui.js';
import { money, shortDate, fmtQty } from '../util.js';
import { AISLES } from '../config.js';
import { myProduct, packFor } from '../planner.js';
import { itemMeta, singular } from '../shopping.js';
import { setProductOps, clearProductOps } from '../actions.js';
import { productLabel, cleanPackLabel, shownProduct, findItUrl, learnedProducts, researchedProducts, searchUrl } from '../products.js';
import { parseSize, convertSize } from '../receipts.js';

export const title = () => 'My products';
const NAMES = { sams: "Sam's Club", jewel: 'Jewel-Osco' };

/** "Paid $17.94 on Nov 12" · "Your pick, about $23.88" · "Typed in" · "Estimate" */
export function productSource(p) {
  if (!p) return 'Estimate';
  if (p.source === 'receipt') return `Paid ${p.price != null ? money(p.price) : ''} on ${p.date ? shortDate(p.date) : 'a receipt'}`.replace('Paid  on', 'Bought on');
  if (p.source === 'typed') return `Typed in${p.price != null ? `, ${money(p.price)}` : ''}`;
  return `Your pick${p.price != null ? `, about ${money(p.price)}` : ''}`;
}

const sizeText = (o, unit) => [o.size, o.packSize ? `${fmtQty(o.packSize)} ${o.packSize === 1 ? singular(unit) : unit}` : ''].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(' · ');

// ---------------------------------------------------------------- the picker

export function openProductPicker(app, { store, id }) {
  const st = { typing: false };
  openProductPicker.state = { store, id, st };
  const meta = itemMeta(app.db, app.state, id);
  openSheet({
    id: `product:${store}/${id}`,
    live: true,
    size: 'tall',
    title: `${meta.name} at ${NAMES[store]}`,
    subtitle: 'The exact product you buy. It sets the price, the list and Find it.',
    render: () => {
      const mine = myProduct(app.state, store, id);
      const pack = packFor(app.db, app.state, id, store);
      const shown = shownProduct(app.state, store, id, pack, app.db);
      const learned = learnedProducts(app.state, store, id);
      const options = researchedProducts(app.db, store, id);
      const unit = meta.unit;
      const isMine = (o) => mine && mine.name === o.name;
      return html`
        <div class="current-product">
          <span><small>${mine ? 'Buying' : shown?.usual ? 'You usually buy' : 'Pricing it with'}</small><b>${mine ? productLabel(mine) : shown?.label || meta.name}</b><small>${mine ? productSource(mine) : pack ? `${money(pack.price)} for ${fmtQty(pack.size)} ${unit}, ${pack.confidence === 'paid' ? 'paid' : pack.confidence === 'listed' ? 'listed' : 'estimated'}` : 'No price yet'}</small></span>
          <a class="btn btn-small btn-secondary" href="${findItUrl(app.db, store, mine, cleanPackLabel(pack?.label) || meta.name)}" target="_blank" rel="noopener" data-findit="${store}">${ic('search', { size: 18 })}Find it</a>
        </div>
        ${when(mine, () => html`<button type="button" class="btn btn-quiet btn-block" data-action="prod:clear" data-store="${store}" data-id="${id}">Use the suggested product instead</button>`)}
        ${when(learned.length, () => html`<h3 class="sheet-h">You’ve bought</h3><ul class="pick-list">${learned.map((o, k) => html`<li><button type="button" class="pick-row ${isMine(o) ? 'is-current' : ''}" data-action="prod:use" data-kind="learned" data-k="${k}">
          <span class="pick-main"><b>${o.name}</b><small>${[sizeText(o, unit), o.price != null ? `paid ${money(o.price)} on ${shortDate(o.date)}` : ''].filter(Boolean).join(' · ')}</small></span>${isMine(o) ? ic('check', { size: 20 }) : ''}</button></li>`)}</ul>`)}
        ${when(options.length, () => html`<h3 class="sheet-h">Options at ${NAMES[store]}</h3><ul class="pick-list">${options.map((o, k) => html`<li class="pick-with-link"><button type="button" class="pick-row ${isMine(o) ? 'is-current' : ''}" data-action="prod:use" data-kind="option" data-k="${k}">
          <span class="pick-main"><b>${o.name}</b><small>${[o.brand && !o.name.toLowerCase().startsWith(o.brand.toLowerCase()) ? o.brand : '', sizeText(o, unit), o.price != null ? `about ${money(o.price)}` : ''].filter(Boolean).join(' · ')}</small></span>${isMine(o) ? ic('check', { size: 20 }) : ''}</button>
          <a class="find-it" href="${findItUrl(app.db, store, o)}" target="_blank" rel="noopener" aria-label="Find ${o.name} on ${NAMES[store]}">${ic('search', { size: 18 })}</a></li>`)}</ul>`)}
        ${when(!learned.length && !options.length, () => html`<p class="sheet-text">No products on file yet. Scan a receipt after your next trip and the planner learns it, or type yours below.</p>`)}
        <h3 class="sheet-h">Type my own</h3>
        <form class="form form-inline-card" data-submit="prod:typed" data-store="${store}" data-id="${id}">
          <input class="input" name="name" placeholder="${store === 'sams' ? "Member's Mark …" : 'Signature Select …'}" required maxlength="120" aria-label="Product name">
          <div class="field-row">
            <input class="input" name="size" placeholder="Size on the label, like 6.5 lb" maxlength="40" aria-label="Size on the label">
            <label class="field field-unit"><span class="sr-only">Pack size in ${unit}</span><input class="input" name="packSize" type="number" inputmode="decimal" min="0.01" step="any" placeholder="Pack size" aria-label="Pack size in ${unit}"><span class="unit">${unit}</span></label>
          </div>
          <div class="field-row">
            <label class="field field-money"><span class="sr-only">Price</span><span class="prefix" aria-hidden="true">$</span><input class="input" name="price" type="number" inputmode="decimal" min="0" step="0.01" placeholder="Price (optional)" aria-label="Price, optional"></label>
            <input class="input" name="url" type="url" inputmode="url" placeholder="Link (optional)" aria-label="Link to the product, optional">
          </div>
          <button type="submit" class="btn btn-secondary btn-block">Use this product</button>
        </form>`;
    },
  });
}

// ---------------------------------------------------------------- the page

export function render(app) {
  const store = app.ui.productsStore === 'jewel' ? 'jewel' : 'sams';
  const q = (app.ui.productsQuery || '').trim().toLowerCase();
  const rows = [];
  for (const ing of Object.values(app.db.ingredients)) {
    const mine = myProduct(app.state, store, ing.id);
    const pack = packFor(app.db, app.state, ing.id, store);
    if (!mine && !pack) continue;
    const label = mine ? productLabel(mine) : shownProduct(app.state, store, ing.id, pack, app.db)?.label || '';
    if (q && !`${ing.name} ${label}`.toLowerCase().includes(q)) continue;
    rows.push({ ing, mine, pack, label });
  }
  for (const [key, p] of Object.entries(app.state.myProducts || {})) {
    const [s, id] = key.split('/');
    if (s !== store || app.db.ingredients[id] || !p?.name) continue;
    const ing = itemMeta(app.db, app.state, id);
    if (q && !`${ing.name} ${p.name}`.toLowerCase().includes(q)) continue;
    rows.push({ ing, mine: p, pack: null, label: productLabel(p) });
  }
  const chosen = Object.keys(app.state.myProducts || {}).filter((k) => k.startsWith(`${store}/`)).length;
  rows.sort((a, b) => (!!b.mine - !!a.mine) || AISLES.indexOf(a.ing.aisle) - AISLES.indexOf(b.ing.aisle) || a.ing.name.localeCompare(b.ing.name));
  return html`<div class="page page-products">
    <a class="back" href="#/list">${ic('left', { size: 20 })}Shopping list</a>
    <header class="page-head"><h1 class="page-title">My products</h1></header>
    <p class="muted small">The exact product you buy for each thing, at each store. Scanned receipts fill this in; tap Change to pick a different one. The list, its prices and “Copy & open” use these.</p>
    ${segmented('productsStore', [{ id: 'sams', label: "Sam's Club" }, { id: 'jewel', label: 'Jewel-Osco' }], store, { label: 'Store', action: 'prod:store' })}
    <label class="search">${ic('search', { size: 20 })}<input type="search" id="products-search" placeholder="Search chicken, cheese, tortillas…" value="${app.ui.productsQuery || ''}" data-input="prod:search" aria-label="Search products" autocomplete="off"></label>
    <p class="muted small">${chosen ? `${chosen} chosen at ${NAMES[store]}.` : `None chosen at ${NAMES[store]} yet: these are the products the list prices.`}</p>
    <ul class="product-list" id="product-list">${rows.map((r) => html`<li class="product-row ${r.mine ? 'is-mine' : ''}">
      <span class="product-main"><small>${r.ing.name}</small><b>${r.label || r.ing.name}</b><small>${r.mine ? productSource(r.mine) : r.pack ? `${r.pack.confidence === 'paid' ? 'Your usual, paid' : r.pack.confidence === 'listed' ? 'Listed at' : 'Estimate,'} ${money(r.pack.price)}` : ''}</small></span>
      <span class="product-acts">
        <a class="btn btn-small btn-quiet" href="${findItUrl(app.db, store, r.mine, r.label || r.ing.name)}" target="_blank" rel="noopener" aria-label="Find ${r.label || r.ing.name} on ${NAMES[store]}">Find it</a>
        <button type="button" class="btn btn-small btn-secondary" data-action="prod:pick" data-store="${store}" data-id="${r.ing.id}">Change</button>
      </span>
    </li>`)}</ul>
    ${when(!rows.length, () => html`<p class="empty-body pad">Nothing matches “${app.ui.productsQuery}”.</p>`)}
  </div>`;
}

export const actions = {
  'prod:pick': (app, el) => openProductPicker(app, { store: el.dataset.store, id: el.dataset.id }),
  'prod:store': (app, el) => { app.ui.productsStore = el.dataset.value; app.render(); },
  'prod:search': (app, el) => { app.ui.productsQuery = el.value; app.render(); },
  'prod:use': (app, el) => {
    const s = openProductPicker.state;
    if (!s) return;
    const list = el.dataset.kind === 'learned' ? learnedProducts(app.state, s.store, s.id) : researchedProducts(app.db, s.store, s.id);
    const o = list[Number(el.dataset.k)];
    if (!o) return;
    app.commit(setProductOps(app.db, app.state, { store: s.store, id: s.id, product: { ...o, source: el.dataset.kind === 'learned' ? 'receipt' : 'pick' }, who: app.who() }));
    closeSheet();
  },
  'prod:clear': (app, el) => { app.commit(clearProductOps(app.db, app.state, { store: el.dataset.store, id: el.dataset.id })); renderSheet(); },
  'prod:typed': (app, form) => {
    const f = new FormData(form);
    const name = String(f.get('name') || '').trim();
    if (!name) { toast('Give the product a name first.'); return; }
    const unit = itemMeta(app.db, app.state, form.dataset.id).unit;
    const size = String(f.get('size') || '').trim();
    let packSize = Number(f.get('packSize'));
    if (!(packSize > 0)) packSize = convertSize(parseSize(size), unit) || null;
    const price = f.get('price') === '' ? null : Number(f.get('price'));
    if (price != null && !(packSize > 0)) { toast(`Add the pack size in ${unit} so the price can be used.`); delete form.dataset.submitted; return; }
    const url = String(f.get('url') || '').trim();
    app.commit(setProductOps(app.db, app.state, { store: form.dataset.store, id: form.dataset.id, product: { name, size, packSize, price, url, source: 'typed' }, who: app.who() }));
    closeSheet();
  },
};

export { searchUrl };
