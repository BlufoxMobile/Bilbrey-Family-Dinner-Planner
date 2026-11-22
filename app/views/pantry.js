// PANTRY: scan shelves with the camera (AI suggests, the family confirms), add by hand,
// staples "stocked until low", measured items by amount, "running low" back to the list.
import { html, ic, when, openSheet, closeSheet, toast, renderSheet, switchToggle, confirmSheet } from '../ui.js';
import { resizeImage, LIMITS } from '../images.js';
import { STORAGE, AISLES } from '../config.js';
import { fmtQty, round2, money, rangeLabel, shortWeekday, shortDate, addDays, listJoin, datesBetween, weekdayName, chicagoDay, monthOnly } from '../util.js';
import { setPantryOps, customItemOps, undoFor } from '../actions.js';
import { set } from '../state.js';
import { kindOf } from '../planner.js';
import { unitText, buildList } from '../shopping.js';
import { pantryCoverage } from '../coverage.js';
import { pantryStretch } from '../planahead.js';
import { unsyncedReceipts, receiptPantryOps } from '../receipts.js';
import { currentRange, leftoversCard, catchUpCard } from './plan.js';
import { scanQtyIn } from '../scanqty.js';
import { PLACES, KINDS, placeOf, kindOfItem, useSoon, undated, freezerWatch, sinceOf, ABOUT_WHEN } from '../freshness.js';
import { REMOVE_REASONS, removeItemOps, aboutSinceOps, wasteSummary, wasteCost } from '../waste.js';
import { itemPhoto, ownPhoto, hydratePhotos, rememberPhoto, cropItem, photoUrl } from '../photos.js';
import { del } from '../state.js';
import { packageOf, packagesFor, plural } from '../packages.js';
import { readByText } from '../claude.js';

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

let useBy = null; // id → useSoon row, set while the page renders
let noDate = null; // ids of perishables nobody dated, set while the page renders

function useByText(app, s) {
  if (s.daysLeft < 0) return 'Past its usual use-by. Check it';
  if (s.daysLeft === 0) return 'Use today';
  if (s.daysLeft === 1) return 'Use by tomorrow';
  return `Use by ${weekdayName(s.useBy)}`;
}

function pantryRow(app, id, p) {
  const m = meta(app, id);
  if (!m) return '';
  const staple = m.kind === 'staple';
  const ph = itemPhoto(app.state, id);
  const soon = useBy?.get(id);
  // Count jars, boxes and bags; the planner works out the ounces (SPEC §13.5).
  const pk = staple ? null : packageOf(app.db, app.state, id);
  const byPack = !!pk && !pk.counted;
  const count = byPack ? packagesFor(typeof p.qty === 'number' ? p.qty : 0, pk.per) : null;
  return html`<li class="pan-row ${p.low ? 'is-low' : ''}" id="pan-${id}">
    <button type="button" class="pan-thumb ${ph ? 'has-photo' : ''}" data-action="pan:photo" data-id="${id}" aria-label="${ph ? `Picture of ${m.name}` : `Add a picture of ${m.name}`}">${ph ? html`<img data-photo="${ph}" alt="" loading="lazy" decoding="async">` : ic('camera', { size: 20 })}</button>
    <span class="pan-name"><b>${m.name}</b>
      ${when(soon, () => html`<small class="pan-soon ${soon.daysLeft <= 0 ? 'is-now' : ''}">${useByText(app, soon)}</small>`)}
      ${when(!soon && noDate?.has(id), () => html`<small class="pan-soon is-ask">No date yet, so no use-by</small>`)}
      ${when(p.label && !m.custom, () => html`<small class="pan-label">${p.label}</small>`)}
      <small>${p.low ? 'Running low, on the shopping list' : staple ? (p.stocked ? 'Stocked until low' : 'Not stocked') : `${typeof p.qty === 'number' ? (byPack ? `${fmtQty(count)} ${plural(pk.word, count)} (about ${unitText(p.qty, m.unit)})` : `${unitText(p.qty, m.unit)} on hand`) : byPack ? `How many ${plural(pk.word, 2)}?` : `Amount in ${m.unit}`}${m.custom ? ', shelf item' : ''}`}</small></span>
    <span class="pan-ctrl">
      ${staple
        ? html`<span class="have-it"><span class="have-label" aria-hidden="true">Have it</span>${switchToggle({ on: !!p.stocked && !p.low, action: 'pan:stock', data: { id }, label: `Have ${m.name}` })}</span>`
        : byPack ? html`<span class="qty-edit qty-pack">
            <button type="button" class="stepper-btn" data-action="pan:step" data-id="${id}" data-delta="-${pk.per}" aria-label="One less ${pk.word} of ${m.name}">${ic('minus', { size: 18 })}</button>
            <input class="qty-input" type="number" inputmode="decimal" min="0" step="any" value="${typeof p.qty === 'number' ? count : ''}" data-change="pan:qty" data-id="${id}" data-per="${pk.per}" aria-label="How many ${plural(pk.word, 2)} of ${m.name}">
            <button type="button" class="stepper-btn" data-action="pan:step" data-id="${id}" data-delta="${pk.per}" aria-label="One more ${pk.word} of ${m.name}">${ic('plus', { size: 18 })}</button>
            <span class="qty-unit">${plural(pk.word, 2)}</span>
          </span>`
        : html`<span class="qty-edit">
            <button type="button" class="stepper-btn" data-action="pan:step" data-id="${id}" data-delta="-${pk?.counted ? 1 : stepFor(m.unit)}" aria-label="Less ${m.name}">${ic('minus', { size: 18 })}</button>
            <input class="qty-input" type="number" inputmode="decimal" min="0" step="any" value="${typeof p.qty === 'number' ? round2(p.qty) : ''}" data-change="pan:qty" data-id="${id}" aria-label="${m.name} amount in ${m.unit}">
            <button type="button" class="stepper-btn" data-action="pan:step" data-id="${id}" data-delta="${pk?.counted ? 1 : stepFor(m.unit)}" aria-label="More ${m.name}">${ic('plus', { size: 18 })}</button>
            ${when(pk?.counted, () => html`<span class="qty-unit">${m.unit}</span>`)}
          </span>`}
      <button type="button" class="btn btn-small ${p.low ? 'btn-secondary' : 'btn-quiet'}" data-action="pan:low" data-id="${id}" aria-pressed="${p.low ? 'true' : 'false'}">${p.low ? 'Restocked' : 'Low? Add to list'}</button>
      <button type="button" class="icon-btn" data-action="pan:remove" data-id="${id}" aria-label="Remove ${m.name}">${ic('trash', { size: 20 })}</button>
    </span>
  </li>`;
}

/** The dates the coverage card looks at: today to the end of the plan's period (at least a week). */
function coverDates(app) {
  const today = app.today();
  const range = currentRange(app);
  const end = range.end > addDays(today, 6) ? range.end : addDays(today, 6);
  return datesBetween(today, end);
}

const STORE_NAMES = { sams: 'Sam’s Club', jewel: 'Jewel-Osco', other: 'Other store' };

/** One plain line instead of the old coverage card: how many planned dinners the shelves already cover. */
function coverLine(app) {
  const dates = coverDates(app);
  const cov = pantryCoverage(app.db, app.state, { dates });
  if (!cov.total) return '';
  return html`<p class="cover-line">${ic('checkCircle', { size: 18 })}<span><b>${cov.ready} of ${cov.total}</b> planned ${cov.total === 1 ? 'dinner is' : 'dinners are'} fully stocked. <a href="#/list">The list buys the rest</a>.</span></p>`;
}

function coverageCard(app) {
  const dates = coverDates(app);
  const cov = pantryCoverage(app.db, app.state, { dates });
  if (!cov.total && !cov.extra.length && !cov.backups.length) return '';
  const today = app.today();
  const short = cov.rows.filter((r) => !r.ready);
  const list = short.length ? buildList(app.db, app.state, { dates, today }) : null;
  const toBuy = list ? list.items.filter((i) => i.reasons.includes('dinners')) : [];
  return html`<section class="cover-card" aria-labelledby="cov-h">
    <h2 id="cov-h" class="section-title">What the pantry covers</h2>
    ${cov.total ? html`<p class="cover-big"><b>${cov.ready}</b><span>of ${cov.total} planned ${cov.total === 1 ? 'dinner is' : 'dinners are'} fully stocked<small>${rangeLabel(dates[0], dates[dates.length - 1])}, main and sides for five</small></span></p>
      <div class="cover-meter" role="img" aria-label="${cov.ready} of ${cov.total} dinners stocked">${cov.rows.map((r) => html`<span class="cover-pip ${r.ready ? 'is-on' : ''}" title="${shortWeekday(r.date)}: ${r.title}"></span>`)}</div>
      ${(() => { const s = pantryStretch(app.db, app.state, { start: dates[0], end: dates[dates.length - 1] }); return s.coveredThrough ? html`<p class="small cover-stretch">At this rate the pantry carries you through <b>${s.coveredThrough === today ? 'tonight' : `${weekdayName(s.coveredThrough)}, ${shortDate(s.coveredThrough)}`}</b>${s.gapReason === 'short' ? '.' : ', as far as the plan goes.'}</p>` : ''; })()}
      <details class="cover-more" ${cov.total <= 8 ? 'open' : ''}><summary>Night by night</summary>
        <ul class="cover-list">${cov.rows.map((r) => html`<li class="${r.ready ? 'is-ready' : ''}"><span class="cover-day">${r.date === today ? 'Tonight' : `${shortWeekday(r.date)} ${shortDate(r.date)}`}</span><span class="cover-what"><b>${r.title}</b><small>${r.ready ? 'Everything’s here' : `Needs ${listJoin(r.missing.map((m) => m.name.replace(/\s*\(.*?\)\s*/g, ' ').trim().toLowerCase()))}`}</small></span></li>`)}</ul>
      </details>
      ${when(short.length, () => html`<p class="small">To make the other ${short.length}, the list buys ${toBuy.length} ${toBuy.length === 1 ? 'item' : 'items'}, about ${money(list.dinnerCost)} for dinners. <a href="#/list">See the list</a></p>`)}` : html`<p class="small">Nothing planned yet. <a href="#/plan">Plan dinners</a> and this shows which ones the pantry already covers.</p>`}
    ${when(cov.assumed?.length, () => html`<p class="muted small">Counts ${listJoin(cov.assumed.map((n) => n.replace(/\s*\(.*?\)\s*/g, ' ').trim().toLowerCase()))} as in the house. Add them to the pantry, or mark one running low, to change that.</p>`)}
    ${when(cov.extra.length, () => html`<p class="small"><b>The leftovers could also make:</b> ${listJoin(cov.extra.slice(0, 6).map((x) => x.title))}.</p>`)}
    ${when(cov.backups.length, () => html`<p class="small"><b>Quick backups on the shelf:</b> ${listJoin(cov.backups.slice(0, 8).map((b) => `${b.name.replace(/\s*\(.*?\)\s*/g, ' ').trim()} (${fmtQty(b.qty)})`))}.</p>`)}
  </section>`;
}

function syncCard(app) {
  const recs = unsyncedReceipts(app.db, app.state, app.today());
  if (!recs.length) return '';
  return html`<section class="sync-card" aria-labelledby="sync-h">
    <h2 id="sync-h" class="section-title">From your receipts</h2>
    <ul class="sync-list">${recs.map((r) => html`<li><span><b>${STORE_NAMES[r.store] || 'Receipt'}, ${shortDate(r.date)}</b><small>${r.adds.length} ${r.adds.length === 1 ? 'grocery' : 'groceries'}: ${listJoin(r.adds.slice(0, 4).map((a) => a.name.replace(/\s*\(.*?\)\s*/g, ' ').trim().toLowerCase()))}${r.adds.length > 4 ? '…' : ''}</small></span>
      <button type="button" class="btn btn-small btn-secondary" data-action="pan:sync" data-id="${r.id}">Add to pantry</button></li>`)}</ul>
  </section>`;
}

const bare = (name) => String(name || '').replace(/\s*\(.*?\)\s*/g, ' ').trim();
const agoText = (days) => (days >= 60 ? `about ${Math.round(days / 30)} months` : `${days} days`);

function useFirstCard(app, soon) {
  // Old freezer food belongs here too (SPEC §21.3): 60 days in, past its keep time, or meat nobody dated.
  const seen = new Set(soon.map((s) => s.id));
  const old = freezerWatch(app.db, app.state, app.today()).filter((w) => !seen.has(w.id));
  if (!soon.length && !old.length) return '';
  const place = (id) => PLACES.find((p) => p.id === id)?.label.replace(/^(In|On) the /, '') || '';
  return html`<section class="use-first" aria-labelledby="use-h">
    <h2 id="use-h" class="section-title">${ic('clock', { size: 22 })}Use first</h2>
    <ul class="use-list">${soon.slice(0, 5).map((s) => html`<li class="${s.daysLeft <= 0 ? 'is-now' : ''}"><button type="button" class="link-row" data-action="pan:jump" data-target="pan-${s.id}"><b>${bare(s.name)}</b><small>${useByText(app, s)}, ${place(s.place)}</small></button></li>`)}
      ${old.slice(0, Math.max(0, 6 - Math.min(5, soon.length))).map((w) => html`<li class="${w.past ? 'is-now' : ''}"><button type="button" class="link-row" data-action="pan:jump" data-target="pan-${w.id}"><b>${bare(w.name)}</b><small>${w.unknown ? 'No date on it, so it counts as old' : `In the freezer ${agoText(w.age)}, since ${shortDate(w.since)}`}</small></button></li>`)}</ul>
  </section>`;
}

/** Food with no came-home date can't get a use-by (SPEC §21.3): one tap says about when it went in. */
function whenCard(app, rows) {
  if (!rows.length) return '';
  const place = (id) => PLACES.find((p) => p.id === id)?.label.replace(/^(In|On) the /, '') || '';
  const shown = rows.slice(0, 6);
  return html`<section class="when-card" id="when-card" aria-labelledby="when-h">
    <h2 id="when-h" class="section-title">${ic('info', { size: 22 })}About when did these go in?</h2>
    <p class="small">A rough answer is enough.</p>
    <ul class="when-list">${shown.map((r) => html`<li><span class="when-name"><b>${bare(r.name)}</b><small>${place(r.place)}${r.meat && r.place === 'freezer' ? ', counted as old until you say' : ''}</small></span>
      <span class="when-chips" role="group" aria-label="When ${bare(r.name)} went in">${ABOUT_WHEN.map((a) => html`<button type="button" class="chip" data-action="pan:about" data-id="${r.id}" data-about="${a.id}">${a.label}</button>`)}</span></li>`)}</ul>
    ${when(rows.length > shown.length, () => html`<p class="muted small">${rows.length - shown.length} more after these.</p>`)}
  </section>`;
}

/** What's been thrown out this month, in dollars, with a way to the details. */
function wasteLine(app) {
  const w = wasteSummary(app.state, app.today());
  if (!w.count && !w.top.length) return '';
  const worst = w.top[0];
  return html`<p class="waste-line">${ic('trash', { size: 18 })}<span>${w.count ? html`Thrown out in ${monthOnly(app.today())}: <b>${money(w.total)}</b> (${w.count} ${w.count === 1 ? 'thing' : 'things'}).` : `Nothing thrown out in ${monthOnly(app.today())} so far.`}${worst && worst.times >= 2 ? ` ${bare(worst.name)} has gone ${worst.times} times lately, so the planner buys less of it.` : ''} <a href="#/budget">See the waste log</a></span></p>`;
}

/** Shelves by place (fridge, freezer, pantry, counter), then by kind (meat, drinks, canned…). */
function shelves(app, entries) {
  const name = (id) => meta(app, id).name;
  return PLACES.map((pl) => {
    const rows = entries.filter(([id]) => placeOf(app.db, app.state, id) === pl.id);
    const kinds = KINDS.map((k) => ({ ...k, rows: rows.filter(([id]) => kindOfItem(app.db, app.state, id) === k.id).sort((a, b) => name(a[0]).localeCompare(name(b[0]))) })).filter((k) => k.rows.length);
    return { ...pl, count: rows.length, kinds };
  }).filter((pl) => pl.count);
}

export function render(app) {
  const pantry = app.state.pantry || {};
  const entries = Object.entries(pantry).filter(([id, p]) => p && meta(app, id));
  const low = entries.filter(([, p]) => p.low);
  const soon = useSoon(app.db, app.state, app.today());
  useBy = new Map(soon.map((s) => [s.id, s]));
  const ask = undated(app.db, app.state);
  noDate = new Set(ask.map((a) => a.id));
  // Measured items at zero are used up: they get their own short list instead of cluttering the shelves.
  const isEmpty = ([id, p]) => !p.low && typeof p.qty === 'number' && p.qty <= 0 && meta(app, id).kind !== 'staple';
  const empty = entries.filter(isEmpty);
  const places = shelves(app, entries.filter((e) => !e[1].low && !isEmpty(e)));
  const photos = entries.filter(([id]) => itemPhoto(app.state, id)).length;
  const canScan = app.store.device.key && !app.store.device.localOnly && app.store.health?.ai !== false;
  const cov = coverLine(app);
  return html`<div class="page page-pantry">
    <header class="page-head"><h1 class="page-title">Pantry</h1></header>
    <section class="pan-add" aria-labelledby="add-h">
      <h2 id="add-h" class="sr-only">Add to the pantry</h2>
      <label class="search">${ic('search', { size: 20 })}<input type="search" id="pantry-search" placeholder="Add: chicken, rice, green beans…" value="${app.ui.pantryQuery}" data-input="pan:search" aria-label="Search ingredients to add" autocomplete="off"></label>
      <div id="pan-results">${results(app)}</div>
      <div class="scan-pick pan-scan" role="group" aria-label="Add from photos of the shelves">
        <label class="btn btn-secondary file-btn">${ic('image', { size: 20 })}Photo library<input type="file" accept="image/*" multiple class="file-over" data-change="pan:scan" aria-label="Add from shelf photos in the photo library"></label>
        <label class="btn btn-secondary file-btn">${ic('camera', { size: 20 })}Take a photo<input type="file" accept="image/*" capture="environment" class="file-over" data-change="pan:scan" aria-label="Take a photo of the shelves"></label>
      </div>
      <p class="muted small pan-add-how">${canScan ? 'Photos of the shelves: the app suggests what it sees, you confirm.' : app.store.device.localOnly ? 'Photo scanning needs the family server; this device is set to “this device only.”' : !app.store.device.key ? 'Photo scanning needs the family passcode (Family & settings).' : 'Photo scanning isn’t available right now.'} Just shopped? <button type="button" class="link-btn" data-action="rcpt:scan">Scan the receipt</button>.</p>
    </section>
    ${useFirstCard(app, soon)}
    ${when(cov, () => cov)}
    ${syncCard(app)}
    ${when(low.length, () => html`<section class="pan-group"><h2 class="section-title">Running low</h2><ul class="pan-list">${low.map(([id, p]) => pantryRow(app, id, p))}</ul></section>`)}
    ${entries.length ? html`
      <nav class="pan-jump" aria-label="Pantry sections">${places.map((pl) => html`<button type="button" class="chip" data-action="pan:jump" data-target="place-${pl.id}">${pl.label.replace(/^(In|On) the /, '').replace(/^./, (c) => c.toUpperCase())} <span class="chip-count">${pl.count}</span></button>`)}</nav>
      ${when(photos < entries.length, () => html`<p class="muted small pan-photo-hint">${ic('camera', { size: 16 })}Tap a square to add a picture.</p>`)}
      ${places.map((pl) => html`<section class="pan-place" id="place-${pl.id}" aria-labelledby="ph-${pl.id}">
        <h2 id="ph-${pl.id}" class="section-title">${pl.label}<span class="count">${pl.count}</span></h2>
        ${pl.kinds.map((k) => html`<h3 class="pan-kind">${k.label}<span class="count">${k.rows.length}</span></h3><ul class="pan-list">${k.rows.map(([id, p]) => pantryRow(app, id, p))}</ul>`)}
      </section>`)}
      ${when(empty.length, () => html`<section class="pan-place pan-empty" id="place-empty" aria-labelledby="ph-empty">
        <h2 id="ph-empty" class="section-title">Used up<span class="count">${empty.length}</span></h2>
        <p class="muted small">These are down to zero. Clear them, or set an amount if there’s still some.</p>
        <button type="button" class="btn btn-small btn-secondary" data-action="pan:clear-empty">Clear all ${empty.length}</button>
        <ul class="pan-list">${empty.map(([id, p]) => pantryRow(app, id, p))}</ul>
      </section>`)}
      ${whenCard(app, ask)}
      ${wasteLine(app)}`
      : html`<div class="empty"><span class="empty-ic">${ic('pantry', { size: 28 })}</span><h3 class="empty-title">The pantry is empty</h3><p class="empty-body">Scan your shelves or add what you have. Staples like salt and spices stay off the list until you mark them running low.</p></div>`}
  </div>`;
}

export function mount(app, root) {
  hydratePhotos(root, app.store);
}

// ---------------------------------------------------------------- item pictures

async function savePhoto(app, itemId, blob) {
  const id = await app.store.putPhoto(blob);
  await rememberPhoto(id, blob);
  const ops = [set(['itemPhotos', itemId], { photo: id, at: new Date().toISOString(), by: app.who() || 'Family' })];
  return { id, ops };
}

function photoSheet(app, itemId) {
  const m = meta(app, itemId);
  if (!m) return;
  const st = { busy: false };
  openSheet({
    id: `photo:${itemId}`,
    title: m.name,
    subtitle: 'Its picture, and where the family keeps it.',
    render: () => {
      const ph = itemPhoto(app.state, itemId);
      const canSave = app.store.device.key && !app.store.device.localOnly;
      return html`
        ${ph ? html`<img class="photo-big" data-photo="${ph}" alt="${m.name}">` : html`<div class="photo-big photo-empty">${ic('camera', { size: 36 })}<span>No picture yet</span></div>`}
        ${when(st.busy, () => html`<div class="scan-progress" role="status"><span class="spinner" aria-hidden="true"></span><p>Saving the picture…</p></div>`)}
        ${canSave ? html`<div class="scan-pick">
            <label class="btn btn-primary file-btn">${ic('image', { size: 20 })}Photo library<input type="file" accept="image/*" class="file-over" data-change="pan:photo-file" data-id="${itemId}" aria-label="Choose a picture of ${m.name} from the photo library"></label>
            <label class="btn btn-secondary file-btn">${ic('camera', { size: 20 })}${ph ? 'Take a new one' : 'Take a picture'}<input type="file" accept="image/*" capture="environment" class="file-over" data-change="pan:photo-file" data-id="${itemId}" aria-label="Take a picture of ${m.name}"></label>
          </div>
          <p class="muted small">Fill the square with the package so the label shows. Pictures stay in the family’s private storage.</p>`
          : html`<p class="sheet-text">Pictures are kept on the family server. Connect this device with the family passcode in Family & settings to add one.</p>`}
        ${when(ph, () => html`<button type="button" class="btn btn-quiet btn-block" data-action="pan:photo-off" data-id="${itemId}">Remove the picture</button>`)}
        <h3 class="sheet-h">Where it’s kept</h3>
        <div class="chip-grid place-pick">${PLACES.map((pl) => html`<button type="button" class="chip ${placeOf(app.db, app.state, itemId) === pl.id ? 'is-on' : ''}" aria-pressed="${placeOf(app.db, app.state, itemId) === pl.id ? 'true' : 'false'}" data-action="pan:place" data-id="${itemId}" data-place="${pl.id}">${pl.label.replace(/^(In|On) the /, '').replace(/^./, (c) => c.toUpperCase())}</button>`)}</div>`;
    },
  });
  setTimeout(() => hydratePhotos(document.getElementById('sheet'), app.store), 0);
  photoSheet.state = st;
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
  if (e.status === 401) return 'Pantry scan needs the family passcode on this device. Enter it in Family & settings, or add items by hand.';
  if (e.status === 413) return 'That photo is too large. Try a closer, simpler photo.';
  if (e.status === 429) return 'Too many scans at once. Wait a minute, then try again.';
  if (e.status === 503) return 'Pantry scanning isn’t available on the family server right now. Add items by hand below.';
  if (e.status === 502) return 'The scanner couldn’t read that photo. Try again with more light, or add items by hand.';
  return `The scan didn’t work (${e.message}). Add items by hand below.`;
}

async function runScan(app, files) {
  if (!files.length) return;
  if (app.store.device.localOnly || !app.store.device.key) {
    openSheet({ title: 'Scanning needs the family server', render: () => html`<p class="sheet-text">${app.store.device.localOnly ? 'This device is set to “this device only.”' : 'This device isn’t connected to the family yet.'} Pantry photos are read by the family’s server, so connect with the family passcode first, or add items by hand.</p>
      <div class="sheet-actions"><a class="btn btn-primary btn-block" href="#/family">Family & settings</a><button type="button" class="btn btn-quiet btn-block" data-action="pan:manual">Add by hand</button></div>` });
    return;
  }
  if (navigator.onLine === false) {
    openSheet({ title: 'You’re offline', render: () => html`<p class="sheet-text">Pantry scan needs an internet connection. Everything else works offline, and you can add items by hand right now.</p><div class="sheet-actions"><button type="button" class="btn btn-primary btn-block" data-action="pan:manual">Add by hand</button></div>` });
    return;
  }
  const st = { done: 0, total: files.length, items: [], errors: [], images: [] };
  openSheet({
    id: 'scan',
    title: 'Reading your photos',
    render: () => html`<div class="scan-progress" role="status"><span class="spinner" aria-hidden="true"></span><p>Photo ${Math.min(st.done + 1, st.total)} of ${st.total}…</p></div>`,
  });
  for (const f of files) {
    try {
      const image = await resize(f);
      const r = await app.store.api('POST', '/api/scan', { image, known: knownList(app) }, { timeoutMs: 150000 });
      if (r?.engine || r?.model) st.readBy = readByText(r.engine, r.model);
      st.images.push(image);
      const img = st.images.length - 1;
      for (const it of r?.items || []) st.items.push({ ...it, img });
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
      by.set(key, { name: it.name || meta(app, matchId)?.name || 'Item', label, matchId, qty: conv.qty, seen: conv.per ? conv.from : null, unit: it.unit || null, confidence: Number(it.confidence) || 0, include: (Number(it.confidence) || 0) >= 0.35, box: Array.isArray(it.box) ? it.box : null, img: Number.isInteger(it.img) ? it.img : null });
    } else {
      // The clearest sighting (highest confidence, with a box) is the one pictured.
      if (Array.isArray(it.box) && Number.isInteger(it.img) && (!prev.box || (Number(it.confidence) || 0) > prev.confidence)) { prev.box = it.box; prev.img = it.img; }
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
      ${when(st.readBy, () => html`<p class="read-by">${ic('sparkle', { size: 16 })}${st.readBy}</p>`)}
      ${when(st.errors.length, () => html`<p class="hint">${ic('info', { size: 18 })}<span>${st.errors[0]}</span></p>`)}
      <form class="form" data-submit="pan:confirm">
        <ul class="review-list">
          ${rows.map((r, k) => {
            const m = r.matchId ? meta(app, r.matchId) : null;
            const staple = m?.kind === 'staple';
            const cands = searchCatalog(app, r.name, 5).filter((c) => c.id !== r.matchId);
            return html`<li class="review-row">
              <label class="review-inc"><input type="checkbox" name="inc-${k}" ${r.include ? 'checked' : ''}><span class="sr-only">Add ${r.name}</span></label>
              ${when(r.thumb, () => html`<img class="review-thumb" src="${r.thumb}" alt="">`)}
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
  review.images = st.images;
  // A picture of each item from its photo, shown as soon as it's cut out (kept when the item is added).
  (async () => {
    for (const r of rows) {
      if (r.img == null || !st.images[r.img]) continue;
      try { r.blob = await cropItem(st.images[r.img], r.box, { size: 360 }); r.thumb = URL.createObjectURL(r.blob); renderSheet(); } catch { /* no picture for this one */ }
    }
  })();
}

export const actions = {
  'pan:jump': (app, el) => {
    const t = document.getElementById(el.dataset.target);
    if (!t) return;
    t.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (t.classList.contains('pan-row')) { t.classList.add('is-flash'); setTimeout(() => t.classList.remove('is-flash'), 1600); }
  },
  'pan:photo': (app, el) => photoSheet(app, el.dataset.id),
  'pan:place': (app, el) => {
    const id = el.dataset.id;
    if (!app.state.pantry?.[id] || !PLACES.some((p) => p.id === el.dataset.place)) return;
    const ops = [set(['pantry', id, 'place'], el.dataset.place)];
    app.commit({ ops, undo: undoFor(app.state, ops), message: `Moved to ${PLACES.find((p) => p.id === el.dataset.place).label.toLowerCase()}.` });
    renderSheet();
    setTimeout(() => hydratePhotos(document.getElementById('sheet'), app.store), 0);
  },
  'pan:photo-file': async (app, el) => {
    const file = el.files?.[0];
    const itemId = el.dataset.id;
    el.value = '';
    if (!file) return;
    const st = photoSheet.state || {};
    st.busy = true; renderSheet();
    try {
      const src = URL.createObjectURL(file);
      const blob = await cropItem(src, null, { size: 480 });
      URL.revokeObjectURL(src);
      const { ops } = await savePhoto(app, itemId, blob);
      app.commit({ ops, undo: undoFor(app.state, ops), message: 'Picture saved for the family.' });
    } catch (e) {
      toast(e?.status === 0 ? 'Saving a picture needs an internet connection.' : 'That picture couldn’t be saved. Try again.');
    }
    st.busy = false; renderSheet();
    setTimeout(() => hydratePhotos(document.getElementById('sheet'), app.store), 0);
  },
  'pan:photo-off': (app, el) => {
    const ops = [del(['itemPhotos', el.dataset.id])];
    app.commit({ ops, undo: undoFor(app.state, ops), message: 'Picture removed.' });
    closeSheet();
  },
  'pan:sync': (app, el) => {
    const ops = receiptPantryOps(app.db, app.state, el.dataset.id, { who: app.who() || 'Family' });
    const n = ops.filter((o) => o.path[0] === 'pantry').length;
    if (!n) { toast('That receipt is already in the pantry.'); return; }
    app.commit({ ops, undo: undoFor(app.state, ops), message: `${n} ${n === 1 ? 'item is' : 'items are'} in the pantry now.` });
  },
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
    const per = Number(el.dataset.per) > 0 ? Number(el.dataset.per) : 1; // a count of packages
    app.commit(setPantryOps(app.db, app.state, { id: el.dataset.id, qty: round2(v * per), who: app.who() }), { quiet: true });
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
  // Taking something off the shelf asks why (SPEC §21.3): eaten, thrown out, or never there.
  'pan:remove': (app, el) => openRemove(app, el.dataset.id),
  'pan:gone': (app, el) => {
    const id = el.dataset.id;
    const st = openRemove.state;
    const input = document.getElementById('gone-qty');
    const typed = input && input.value !== '' ? Number(input.value) : null;
    const qty = typed != null && Number.isFinite(typed) && typed > 0 ? round2(typed * (st?.per || 1)) : null;
    const res = removeItemOps(app.db, app.state, { id, reason: el.dataset.reason, qty, today: app.today(), who: app.who() });
    closeSheet();
    app.commit(res);
  },
  'pan:about': (app, el) => app.commit(aboutSinceOps(app.db, app.state, { id: el.dataset.id, about: el.dataset.about, today: app.today() })),
  'pan:clear-empty': (app) => {
    const ops = Object.entries(app.state.pantry || {})
      .filter(([id, p]) => p && !p.low && typeof p.qty === 'number' && p.qty <= 0 && meta(app, id) && meta(app, id).kind !== 'staple')
      .map(([id]) => del(['pantry', id]));
    if (ops.length) app.commit({ ops, undo: undoFor(app.state, ops), message: `Cleared ${ops.length} used-up ${ops.length === 1 ? 'item' : 'items'}.` });
  },
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
    const picked = [];
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
      const now = new Date().toISOString();
      const prev = app.state.pantry?.[id];
      const had = prev && !prev.low && (prev.stocked || prev.qty > 0);
      const since = { ...(had && prev.since ? { since: prev.since } : had ? {} : { since: chicagoDay(now) }), ...(prev?.place ? { place: prev.place } : {}) };
      ops.push(set(['pantry', id], staple ? { qty: null, stocked: true, ...label, ...since, by: app.who(), at: now }
        : { qty: Number.isFinite(qty) && qty >= 0 ? round2(qty) : (app.state.pantry?.[id]?.qty ?? 1), stocked: false, ...label, ...since, by: app.who(), at: now }));
      picked.push({ id, r });
      n++;
    });
    if (!n) { toast('Nothing checked to add.'); return; }
    app.commit({ ops, undo: undoFor(app.state, ops), message: `Added ${n} ${n === 1 ? 'item' : 'items'} to the pantry. The list is updated.` });
    closeSheet();
    // Then each new item's picture, in the background (items that already have one keep it).
    // ownPhoto: a store's product picture doesn't stop the family's own crop from being saved (it wins).
    const pics = picked.filter(({ id, r }) => r.blob && !ownPhoto(app.state, id));
    (async () => {
      const photoOps = [];
      for (const { id, r } of pics) {
        try { photoOps.push(...(await savePhoto(app, id, r.blob)).ops); } catch { break; } // offline: skip the rest
      }
      if (photoOps.length) app.commit({ ops: photoOps, message: `Saved ${photoOps.length} ${photoOps.length === 1 ? 'picture' : 'pictures'} of what’s on the shelves.` });
    })();
  },
};

export { confirmSheet };

// ---------------------------------------------------------------- taking something off the shelf (SPEC §21.3)

const REASON_ICON = { used: 'checkCircle', tossed: 'trash', wrong: 'edit' };

/** Why is it leaving? "Threw it out" goes in the waste log with what it cost. */
function openRemove(app, id) {
  const m = meta(app, id);
  const p = app.state.pantry?.[id];
  if (!m || !p) return;
  const have = typeof p.qty === 'number' ? p.qty : null;
  // An item at zero has nothing to explain: it just goes.
  if (have !== null && have <= 0) { app.commit(removeItemOps(app.db, app.state, { id, reason: 'used', today: app.today(), who: app.who() })); return; }
  const pk = m.kind === 'staple' ? null : packageOf(app.db, app.state, id);
  const byPack = !!pk && !pk.counted;
  const per = byPack ? pk.per : 1;
  const unit = byPack ? plural(pk.word, 2) : m.unit;
  const all = have == null ? null : round2(byPack ? packagesFor(have, pk.per) : have);
  openRemove.state = { per };
  const since = sinceOf(p);
  const worth = wasteCost(app.db, app.state, id, have).cost;
  openSheet({
    id: `remove:${id}`,
    title: bare(m.name),
    subtitle: 'Taking it off the shelf: what happened to it? The answer keeps the pantry right, and the planner learns from it.',
    render: () => html`
      ${when(all != null, () => html`<label class="field gone-amount"><span class="field-label">How much? <small>(all ${fmtQty(all)} ${unit} unless you change it)</small></span>
        <span class="gone-row"><input class="input" id="gone-qty" type="number" inputmode="decimal" min="0" max="${all}" step="any" value="${all}" aria-label="How much of the ${bare(m.name)}, in ${unit}"><span class="qty-unit">${unit}</span></span></label>`)}
      <div class="action-list gone-reasons">
        ${REMOVE_REASONS.map((r) => html`<button type="button" class="action-row" data-action="pan:gone" data-id="${id}" data-reason="${r.id}">${ic(REASON_ICON[r.id])}<span><b>${r.label}</b><small>${r.id === 'tossed' && worth ? `${r.note.replace(/\.$/, '')}: about ${money(worth)} for all of it.` : r.note}</small></span></button>`)}
      </div>
      ${when(since, () => html`<p class="muted small">On the shelf since ${shortDate(since)}.</p>`)}`,
  });
}
