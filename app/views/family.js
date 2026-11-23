// FAMILY & SETTINGS for one shared profile (docs/spec/20): family sync + passcode, planner rules,
// shopping and budget, stores, who packs a lunch, Claude, this screen's display options, data.
// Nothing here is about one person, except the list of who packs a lunch.
import { html, ic, raw, when, toast, avatar, personStyle, confirmSheet, segmented, stepper, switchToggle, tf, copyText } from '../ui.js';
import { tvSettingRow } from '../tv.js';
import { VERSION } from '../config.js';
import { mediumDate, listJoin, cleanName } from '../util.js';
import { lunchPackers } from '../lunch.js';
import { settingOps, undoFor } from '../actions.js';
import { allDinners } from '../planner.js';
import { AI_MODELS, aiStatus, photoCostHint, modelLabel, claudeErrorText } from '../claude.js';

export const title = () => 'Family & settings';
export const MEAT_OPTS = [{ id: '1', label: 'Hearty (as written)' }, { id: '0.85', label: 'Lighter (−15%)' }];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * The passcode forms. Built so a passcode can be typed with a TV remote as well as a thumb: nothing
 * is auto-capitalised or auto-corrected, "Show the passcode" lets you check it before sending (and
 * then there's no "type it again"), what was typed stays put after a wrong try, and the error is
 * tied to the field for screen readers.
 */
export function passcodeForm(app, mode, { compact = false } = {}) {
  const err = app.ui.passErr || '';
  const shown = !!app.ui.passShow;
  const type = shown ? 'text' : 'password';
  const plain = raw('autocapitalize="none" autocorrect="off" spellcheck="false"');
  const bad = err ? raw(`aria-invalid="true" aria-describedby="pc-err-${mode}"`) : '';
  const errLine = when(err, () => html`<p class="form-error" id="pc-err-${mode}" role="alert">${err}</p>`);
  // "Checking…" keeps the button focusable (a disabled one drops a TV remote's focus on the floor).
  const busy = app.ui.passBusy ? raw('aria-disabled="true"') : '';
  const show = html`<button type="button" class="chip pass-show" id="pc-show-${mode}" aria-pressed="${tf(shown)}" data-action="fam:show-pass">${ic(shown ? 'checkCircle' : 'lock', { size: 18 })}${shown ? 'Showing the passcode' : 'Show the passcode'}</button>`;
  if (mode === 'create') {
    return html`<form class="form pass-form" data-submit="fam:create" autocomplete="off">
      <label class="field"><span class="field-label">New family passcode</span><input class="input input-pass" id="pc-new" name="pass" type="${type}" minlength="4" maxlength="64" required autocomplete="new-password" placeholder="At least 4 characters" ${plain} ${bad} enterkeyhint="${shown ? 'go' : 'next'}"></label>
      ${when(!shown, () => html`<label class="field"><span class="field-label">Type it again</span><input class="input input-pass" id="pc-again" name="again" type="password" minlength="4" maxlength="64" required autocomplete="new-password" ${plain} enterkeyhint="go"></label>`)}
      ${show}
      ${errLine}
      <button type="submit" class="btn btn-primary btn-block" id="pc-submit-create" ${busy}>${app.ui.passBusy ? 'Creating…' : 'Create the family passcode'}</button>
      ${when(!compact, () => html`<p class="muted small">It’s typed once on each phone and on the TV. It never leaves the device in plain text; capital letters don’t matter.</p>`)}
    </form>`;
  }
  if (mode === 'change') {
    return html`<form class="form pass-form" data-submit="fam:change" autocomplete="off">
      <label class="field"><span class="field-label">New passcode</span><input class="input input-pass" id="pc-change" name="pass" type="${type}" minlength="4" maxlength="64" required autocomplete="new-password" ${plain} ${bad}></label>
      ${when(!shown, () => html`<label class="field"><span class="field-label">Type it again</span><input class="input input-pass" id="pc-change2" name="again" type="password" minlength="4" maxlength="64" required autocomplete="new-password" ${plain}></label>`)}
      ${show}
      ${errLine}
      <button type="submit" class="btn btn-secondary btn-block" id="pc-submit-change" ${busy}>Change the family passcode</button>
      <p class="muted small">Every other phone and the TV will ask for the new passcode once.</p>
    </form>`;
  }
  return html`<form class="form pass-form" data-submit="fam:enter" autocomplete="off">
    <label class="field"><span class="field-label">Family passcode</span><input class="input input-pass" id="pc-enter" name="pass" type="${type}" maxlength="64" required autocomplete="current-password" ${plain} ${bad} enterkeyhint="go"></label>
    ${show}
    ${errLine}
    <button type="submit" class="btn btn-primary btn-block" id="pc-submit-enter" ${busy}>${app.ui.passBusy ? 'Checking…' : 'Join the family plan'}</button>
    ${when(!compact, () => html`<p class="muted small">Ask Jeff or Candi for the passcode. This device remembers it; capital letters don’t matter.</p>`)}
  </form>`;
}

/** A fold-out that stays open across redraws (a sync, or "Show the passcode", would otherwise snap it shut mid-typing). */
const openMore = new Set();
const more = (key, summary, body) => html`<details class="more" data-more="${key}" ${openMore.has(key) ? 'open' : ''}><summary>${summary}</summary>${body}</details>`;

function syncSection(app) {
  const s = app.store;
  const status = s.status;
  let body;
  if (status === 'local') {
    body = html`<p class="sheet-text">This device keeps its own plan. Nothing is shared.</p>
      <button type="button" class="btn btn-primary" data-action="sync:family">Share with the family</button>`;
  } else if (status === 'needs-setup') {
    body = html`<p class="sheet-text">No family passcode yet. Create it once, then type it on every other phone and the TV.</p>${passcodeForm(app, 'create')}`;
  } else if (status === 'needs-passcode') {
    body = html`<p class="sheet-text">${s.statusDetail || 'Enter the family passcode to see the same plan, favorites, pantry and list as every other phone and the TV.'}</p>${passcodeForm(app, 'enter')}`;
  } else if (status === 'offline' && !s.device.key) {
    body = html`<p class="sheet-text">Can’t reach the family server right now. Everything works on this device, and you can connect later.</p>
      <button type="button" class="btn btn-secondary" data-action="sync:retry">${ic('refresh', { size: 20 })}Try again</button>`;
  } else {
    const pending = s.pending.length;
    body = html`<p class="sheet-text">${status === 'synced' ? 'Connected. Every phone, computer and the TV show the same plan, favorites, pantry and list.'
      : status === 'syncing' ? 'Sending changes…'
        : status === 'error' ? s.statusDetail || 'Sync is paused.'
          : `Offline. ${pending ? `${pending} change${pending === 1 ? ' is' : 's are'} saved on this device and will sync.` : 'Changes are saved on this device and will sync.'}`}</p>
      <button type="button" class="btn btn-secondary" data-action="sync:now">${ic('refresh', { size: 20 })}Sync now</button>
      ${when(status === 'synced', () => html`${more('add-device', 'Add another phone or the TV', html`
        <ol class="steps-small"><li>Open the planner on it (on a TV, in the TV’s web browser).</li><li>Type the family passcode. Capital letters don’t matter, and it only has to be typed once.</li><li>That’s it: there are no separate profiles, so it shows the same plan right away.</li></ol>`)}
        ${more('change-pass', 'Change the family passcode', passcodeForm(app, 'change'))}`)}`;
  }
  return html`<section class="set-sec" aria-labelledby="sync-h">
    <h2 id="sync-h" class="section-title">Family sync</h2>
    ${body}
    ${when(status !== 'local', () => html`<button type="button" class="btn btn-quiet" data-action="fam:local">${ic('phone', { size: 20 })}Use on this device only</button>`)}
  </section>`;
}

// ---------------------------------------------------------------- Claude (SPEC §17)

/** This phone's copy of GET /api/ai and the connector link (never stored: fetched when needed). */
const ai = { info: null, at: 0, loading: false, error: null, link: '', linkBusy: false, linkError: '' };
const connected = (app) => !!app.store.device.key && !app.store.device.localOnly;

/** Fetches the family's Claude status (model, this month's spend) at most once a minute unless forced. */
export async function loadAiInfo(app, { force = false } = {}) {
  if (!connected(app) || ai.loading) return ai.info;
  if (!force && ai.at && Date.now() - ai.at < 60000) return ai.info;
  ai.loading = true;
  try {
    ai.info = await app.store.api('GET', '/api/ai', null, { timeoutMs: 8000 });
    ai.error = null;
  } catch (e) {
    ai.error = e;
  } finally {
    ai.loading = false;
    ai.at = Date.now();
    app.render();
  }
  return ai.info;
}
export const aiInfo = () => ai.info;

function claudeStatusText(app) {
  if (!connected(app)) return { tone: 'free', text: app.store.device.localOnly ? 'Claude works through the family server, and this device is set to “this device only.”' : 'Claude works through the family server. Connect this device with the family passcode first.' };
  if (!ai.info) {
    if (!ai.at || ai.loading) return { tone: 'unknown', text: 'Checking on Claude…' };
    return { tone: 'unknown', text: ai.error?.status === 404 ? 'Claude isn’t on the family server yet.' : 'Can’t reach the family server to check on Claude right now.' };
  }
  return aiStatus(ai.info, app.settings.aiModel);
}

function modelPicker(app) {
  const chosen = app.settings.aiModel;
  const priced = (m) => ({ ...m, ...(ai.info?.models || []).find((x) => x?.id === m.id) });
  const note = AI_MODELS.find((m) => m.id === chosen)?.note || '';
  return html`<div class="set-row set-col"><span class="set-label">Which Claude<small>${note}</small></span>
    <div class="seg seg-ai" role="radiogroup" aria-label="Which Claude reads photos and suggests dinners">
      ${AI_MODELS.map(priced).map((m) => html`<button type="button" role="radio" aria-checked="${tf(m.id === chosen)}" class="seg-opt ${m.id === chosen ? 'is-on' : ''}" data-action="ai:model" data-value="${m.id}" aria-label="${modelLabel(m.id)}, ${photoCostHint(m) || m.tag}"><b>${m.short}</b><small>${photoCostHint(m) || m.tag}</small></button>`)}
    </div></div>`;
}

function connectBlock(app) {
  return html`<div class="ai-connect">
    <h3 class="sheet-h">Connect your Claude chats</h3>
    <p class="small muted">Use the planner from the Claude app: send a photo of the fridge to update the pantry, or ask what to make.</p>
    ${ai.link && connected(app) ? html`
      <div class="ai-link-row">
        <input class="input ai-link" id="ai-link" readonly value="${ai.link}" aria-label="Your private connector link">
        <button type="button" class="btn btn-secondary btn-small" data-action="ai:copy">${ic('copy', { size: 18 })}Copy</button>
      </div>
      <p class="muted small">Keep this link to yourself: it opens the family’s planner.</p>
      <ol class="steps-small ai-steps">
        <li>In Claude, open <b>Settings</b>, then <b>Connectors</b>, and tap <b>Add custom connector</b>.</li>
        <li>Name it <b>Bilbrey Dinner Planner</b>, paste the link, and tap <b>Add</b>.</li>
        <li>In any chat, turn it on from the tools menu, then say things like “Here’s our fridge — update the pantry” or “What can we make with these?”</li>
      </ol>
      <button type="button" class="btn btn-quiet btn-small" data-action="ai:rotate" ${ai.linkBusy ? 'disabled' : ''}>${ic('refresh', { size: 18 })}Make a new link</button>`
      : html`<button type="button" class="btn btn-secondary" data-action="ai:link" ${ai.linkBusy || !connected(app) ? 'disabled' : ''}>${ic('link', { size: 20 })}${ai.linkBusy ? 'Getting the link…' : 'Get my connector link'}</button>`}
    ${when(ai.linkError, () => html`<p class="form-error" role="alert">${ai.linkError}</p>`)}
  </div>`;
}

function claudeSection(app) {
  const st = claudeStatusText(app);
  const spend = connected(app) ? aiStatus(ai.info, app.settings.aiModel).spend : null;
  return html`<section class="set-sec claude-card" aria-labelledby="ai-h">
    <h2 id="ai-h" class="section-title">${ic('sparkle', { size: 22 })}Dinner ideas & photo reading (Claude)</h2>
    <p class="ai-status ai-${st.tone}" role="status"><span class="ai-dot" aria-hidden="true"></span><span>${st.text}</span></p>
    ${when(spend, () => html`<div class="ai-spend">
      <p class="ai-spend-row"><span>This month</span><b>${spend.text}</b></p>
      <span class="ai-meter ${spend.pct >= 100 ? 'is-full' : ''}" role="img" aria-label="${spend.text} used this month"><span style="width:${spend.pct}%"></span></span>
      <small class="muted">Starts over on the 1st.</small>
    </div>`)}
    ${modelPicker(app)}
    ${connectBlock(app)}
  </section>`;
}

function rules(app) {
  const s = app.settings;
  return html`<section class="set-sec" aria-labelledby="rules-h">
    <h2 id="rules-h" class="section-title">House rules</h2>
    <div class="set-row set-col"><span class="set-label">Burger nights (with fries)</span>
      <div class="chip-grid days-pick">${DAYS.map((d, i) => html`<button type="button" class="chip ${s.burgerNights.includes(i) ? 'is-on' : ''}" aria-pressed="${tf(s.burgerNights.includes(i))}" data-action="fam:burger" data-day="${i}">${d}</button>`)}</div></div>
    <div class="set-row"><span class="set-label">Frozen pizza nights a month<small>On Saturdays.</small></span>${stepper({ value: s.pizzaPerMonth, step: 1, min: 0, action: 'fam:num', data: { key: 'pizzaPerMonth', max: 4 }, label: 'Pizza nights a month' })}</div>
    <div class="set-row"><span class="set-label">Rice dinners a week, at most<small>Candi’s rule.</small></span>${stepper({ value: s.riceMaxPerWeek, step: 1, min: 0, action: 'fam:num', data: { key: 'riceMaxPerWeek', max: 3 }, label: 'Rice dinners a week' })}</div>
    <div class="set-row set-col"><span class="set-label">Weeks start on</span>${segmented('weekStartsOn', [{ id: '1', label: 'Monday' }, { id: '0', label: 'Sunday' }], String(s.weekStartsOn), { label: 'Weeks start on', action: 'fam:weekstart', small: true })}</div>
  </section>`;
}

function shopping(app) {
  const s = app.settings;
  return html`<section class="set-sec" aria-labelledby="shop-h">
    <h2 id="shop-h" class="section-title">Shopping and budget</h2>
    <div class="set-row"><span class="set-label">Monthly grocery target<small>$${s.monthlyTarget}</small></span><a class="link-btn trip-link" href="#/budget" aria-label="Change the $${s.monthlyTarget} monthly target on Budget">Change ›</a></div>
    <div class="set-row"><span class="set-label">Organic fruits and vegetables<small>When the store has one.</small></span>${switchToggle({ on: s.organic, action: 'fam:organic', label: 'Buy organic fruits and vegetables' })}</div>
    <div class="set-row set-col"><span class="set-label">Meat per dinner<small>Lighter uses 15% less meat.</small></span>${segmented('meatScale', MEAT_OPTS, String(s.meatScale), { label: 'Meat per dinner', action: 'fam:meat', small: true })}</div>
  </section>`;
}

function stores(app) {
  return html`<section class="set-sec" aria-labelledby="st-h">
    <h2 id="st-h" class="section-title">Stores</h2>
    <div class="store-cards">${['sams', 'jewel'].map((id) => {
      const s = app.db.stores[id];
      return html`<article class="store-card">
        <h3>${s.name}</h3>
        ${when(s.address, () => html`<p>${s.address}</p>`)}
        ${when(s.hours, () => html`<p class="muted small">${s.hours}</p>`)}
        <p class="store-links">
          ${when(s.phone, () => html`<a href="tel:${s.phone.replace(/[^\d+]/g, '')}">${s.phone}</a>`)}
          <a href="${s.website}" target="_blank" rel="noopener">Website</a>
        </p>
      </article>`;
    })}</div>
    <div class="action-list">
      <a class="action-row" href="#/products">${ic('cart')}<span><b>My products</b><small>The exact product you buy for each item, at each store. Learned from receipts.</small></span></a>
      <a class="action-row" href="#/receipts">${ic('receipt')}<span><b>Receipts</b><small>Scan one after a trip; see what was on each.</small></span></a>
    </div>
  </section>`;
}

/** The only place settings talks about individual people: who packs a lunch. */
function lunches(app) {
  if (!app.db.lunch?.available) return '';
  const people = lunchPackers(app.db, app.state);
  const packing = people.filter((p) => !p.paused).map((p) => p.name);
  const days = (cfg) => (cfg.days.length === 5 && [1, 2, 3, 4, 5].every((d) => cfg.days.includes(d)) ? 'Weekdays' : `${cfg.days.length} ${cfg.days.length === 1 ? 'day' : 'days'} a week`);
  return html`<section class="set-sec" aria-labelledby="lun-h">
    <h2 id="lun-h" class="section-title">Packed lunches</h2>
    <p class="sheet-text">${packing.length ? `Packing for ${listJoin(packing)}.` : 'No lunches are being packed, so no lunch groceries are bought.'}</p>
    ${when(people.length, () => html`<ul class="packer-list">${people.map((p) => html`<li class="packer" style="${personStyle(p.name)}">
      ${avatar(p.name, { size: 'sm' })}<span class="packer-name"><b>${p.name}</b><small>${p.paused ? 'Paused: nothing packed or bought' : days(p.cfg)}</small></span>
      ${p.paused ? html`<button type="button" class="btn btn-small btn-secondary" data-action="lunch:resume" data-who="${p.name}">Resume</button>`
        : html`<button type="button" class="btn btn-small btn-quiet" data-action="lunch:edit" data-who="${p.name}" aria-label="Edit ${p.name}’s lunches">Edit</button>`}
    </li>`)}</ul>`)}
    <div class="set-actions">
      <button type="button" class="btn btn-secondary" data-action="lunch:add">${ic('plus', { size: 20 })}Add a person</button>
    </div>
  </section>`;
}

function display(app) {
  const d = app.store.device;
  const names = lunchPackers(app.db, app.state).map((p) => p.name);
  if (d.todayFor && !names.includes(d.todayFor)) names.push(d.todayFor);
  const todayOpts = [{ id: '', label: 'Nobody' }, ...names.map((n) => ({ id: n, label: n }))];
  return html`<section class="set-sec" aria-labelledby="disp-h">
    <h2 id="disp-h" class="section-title">Display on this device</h2>
    <p class="muted small">Just this phone, computer or TV.</p>
    <div class="set-row set-col"><span class="set-label">Appearance</span>${segmented('theme', [{ id: 'auto', label: 'Match device' }, { id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }], d.theme || 'auto', { label: 'Appearance', action: 'fam:theme', small: true })}</div>
    ${raw(tvSettingRow())}
    <div class="set-row set-col"><span class="set-label">Text size</span>${segmented('textSize', [{ id: 'regular', label: 'Regular' }, { id: 'large', label: 'Large' }], d.textSize || 'regular', { label: 'Text size', action: 'fam:text', small: true })}</div>
    <div class="set-row"><span class="set-label">Show calories and protein<small>Lunches and dinners; breakfast and snacks aren’t tracked.</small></span>${switchToggle({ on: !d.hideNutrition, action: 'fam:nutrition', label: 'Show calories and protein on this device' })}</div>
    ${when(!d.hideNutrition, () => html`<div class="set-row set-col"><span class="set-label">Show a day’s calories on Tonight<small>A packed lunch plus a dinner plate, for one person.</small></span>${segmented('todayFor', todayOpts, d.todayFor || '', { label: 'Whose daily total shows on Tonight', action: 'fam:today', small: true })}</div>`)}
  </section>`;
}

export function render(app) {
  // House rules first; the plumbing (sync, Claude, device data) waits under Advanced unless something
  // needs attention (docs/spec/29).
  const synced = app.store.status === 'synced';
  return html`<div class="page page-family">
    <header class="page-head"><h1 class="page-title">Family & settings</h1></header>
    ${when(!synced, () => syncSection(app))}
    ${rules(app)}
    ${shopping(app)}
    ${lunches(app)}
    ${display(app)}
    ${stores(app)}
    <details class="set-advanced" data-more="advanced" ${openMore.has('advanced') ? 'open' : ''}>
      <summary><span class="section-title">Advanced</span><small>Sync, dinner ideas and photo reading, and this device’s data</small></summary>
    ${when(synced, () => syncSection(app))}
    ${claudeSection(app)}
    <section class="set-sec" aria-labelledby="hl-h">
      <h2 id="hl-h" class="section-title">Good to know</h2>
      <ul class="plain">
        <li>Sam’s Club and Jewel-Osco don’t let apps read live prices or fill a cart. Prices here are researched estimates${app.db.pricesUpdated ? ` (as of ${mediumDate(app.db.pricesUpdated)})` : ''}; fix any price on the list and the whole family gets it.</li>
        <li>Ordering means copying a store-ready list and opening the store’s app. You check out there.</li>
        <li>Pantry scans are AI suggestions. You confirm every item and amount.</li>
        <li>No recipe uses the oven, there is never tofu, and the only seafood is fried shrimp night (two bags of SeaPak with fries).</li>
        <li>Days and dates follow Glen Ellyn (Central) time, wherever a phone happens to be.</li>
      </ul>
    </section>
    <section class="set-sec" aria-labelledby="data-h">
      <h2 id="data-h" class="section-title">This device’s data</h2>
      <p class="muted small">${allDinners(app.db, app.state).length} dinners and ${app.db.sideList.length} sides in the recipe box. Version ${VERSION}.</p>
      <button type="button" class="btn btn-danger-quiet" data-action="fam:reset">${ic('trash', { size: 20 })}Clear this device’s data</button>
    </section>
    </details>
  </div>`;
}

export function mount(app, root) {
  loadAiInfo(app);
  root?.addEventListener?.('toggle', (ev) => {
    const key = ev.target?.dataset?.more;
    if (!key) return;
    if (ev.target.open) openMore.add(key); else openMore.delete(key);
  }, true);
}

/** GET /api/mcp/link or POST /api/mcp/rotate → the private connector link on screen. */
async function fetchLink(app, method, path) {
  if (!connected(app) || ai.linkBusy) return false;
  ai.linkBusy = true;
  ai.linkError = '';
  app.render();
  try {
    const r = await app.store.api(method, path, method === 'POST' ? {} : null);
    if (!/^https?:\/\/\S+$/.test(String(r?.url || ''))) throw Object.assign(new Error('No link came back'), { status: 502 });
    ai.link = r.url;
    return true;
  } catch (e) {
    ai.linkError = claudeErrorText(e);
    return false;
  } finally {
    ai.linkBusy = false;
    app.render();
  }
}

/** What's wrong with a new passcode, or ''. "Type it again" is only asked while the passcode is hidden. */
function passProblem(f, pass) {
  if (pass.trim().length < 4) return 'Use at least 4 characters.';
  if (f.has('again') && pass.trim().toLowerCase() !== String(f.get('again') || '').trim().toLowerCase()) return 'The two passcodes don’t match.';
  return '';
}

/** Runs a passcode request once at a time; on a problem the message shows and focus goes back to the box (`field`). */
async function withBusy(app, fn, field = '') {
  if (app.ui.passBusy) return;
  app.ui.passBusy = true;
  app.ui.passErr = '';
  app.render();
  try {
    await fn();
    app.ui.passErr = '';
  } catch (e) {
    app.ui.passErr = e?.status === 0 ? 'Can’t reach the family server. Check the connection and try again.' : e?.message || 'Something went wrong. Try again.';
    app.ui.focusNext = field;
  } finally {
    app.ui.passBusy = false;
    app.render();
  }
}

/**
 * Join with the passcode. A device that was changed before it ever joined (someone looked around
 * and planned a week on the TV) is asked first whether those changes should reach the family:
 * sent along like any offline change, or left behind. Nothing is dropped unless the passcode is right.
 */
async function joinFamily(app, pass) {
  const s = app.store;
  const n = !s.device.key ? s.pending.length : 0;
  let dropPending = false;
  if (n) {
    dropPending = await confirmSheet({
      title: 'Start from the family’s plan?',
      body: `${n} ${n === 1 ? 'change was' : 'changes were'} made on this device before it joined. Joining can leave ${n === 1 ? 'it' : 'them'} behind and show the family’s plan as it is, or send ${n === 1 ? 'it' : 'them'} to the family’s plan too.`,
      confirm: 'Start from the family’s plan',
      cancel: n === 1 ? 'Send my change too' : 'Send my changes too',
    });
  }
  withBusy(app, async () => {
    try {
      await s.enterPasscode(pass, { dropPending });
      app.ui.passShow = false;
      toast('You’re on the family plan.');
    } catch (e) {
      if (e.data?.needsSetup) s.setStatus('needs-setup');
      throw e;
    }
  }, 'pc-enter');
}

export const actions = {
  'fam:create': (app, form) => {
    const f = new FormData(form);
    const pass = String(f.get('pass') || '');
    const problem = passProblem(f, pass);
    if (problem) { delete form.dataset.submitted; app.ui.passErr = problem; app.ui.focusNext = 'pc-new'; app.render(); return; }
    withBusy(app, async () => {
      try {
        await app.store.createPasscode(pass);
        app.ui.passShow = false;
        toast('Family passcode created. Type it once on every other phone and on the TV.');
      } catch (e) {
        if (e.status === 409) { app.store.setStatus('needs-passcode'); }
        throw e;
      }
    }, 'pc-new');
  },
  'fam:enter': (app, form) => {
    // What was typed stays in the box through "Checking…" and after a wrong try: retyping a whole
    // passcode with a TV remote for one slipped letter is miserable.
    delete form.dataset.submitted;
    const pass = String(new FormData(form).get('pass') || '');
    if (!pass.trim() || app.ui.passBusy) return;
    joinFamily(app, pass);
  },
  'fam:change': (app, form) => {
    const f = new FormData(form);
    const pass = String(f.get('pass') || '');
    const problem = passProblem(f, pass);
    if (problem) { delete form.dataset.submitted; app.ui.passErr = problem; app.ui.focusNext = 'pc-change'; app.render(); return; }
    withBusy(app, async () => { await app.store.changePasscode(pass); app.ui.passShow = false; toast('Passcode changed. Every other phone and the TV will ask for it once.'); }, 'pc-change');
  },
  'fam:show-pass': (app) => { app.ui.passShow = !app.ui.passShow; app.render(); },
  'fam:local': async (app) => {
    const ok = await confirmSheet({ title: 'Use on this device only?', body: 'This device stops syncing with the family. Its plan stays here, and you can share with the family again any time.', confirm: 'Use on this device only' });
    if (ok) { app.store.useLocalOnly(); toast('Using the planner on this device only.'); }
  },
  'fam:theme': (app, el) => app.store.setDevice({ theme: el.dataset.value }),
  'fam:text': (app, el) => app.store.setDevice({ textSize: el.dataset.value === 'large' ? 'large' : 'regular' }),
  'fam:nutrition': (app) => app.store.setDevice({ hideNutrition: !app.store.device.hideNutrition }),
  'fam:today': (app, el) => app.store.setDevice({ todayFor: cleanName(el.dataset.value) }),
  'fam:burger': (app, el) => {
    const i = Number(el.dataset.day);
    const cur = app.settings.burgerNights;
    const next = cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i].sort();
    app.commit({ ...settingOps(app.state, 'burgerNights', next), message: next.length ? `Burger nights: ${next.map((x) => DAYS[x]).join(', ')}. Applies to nights you plan from now on.` : 'No burger nights.' });
  },
  'fam:num': (app, el) => {
    const key = el.dataset.key;
    const max = Number(el.dataset.max);
    const v = Math.max(0, Math.min(max, (app.settings[key] || 0) + Number(el.dataset.delta)));
    app.commit(settingOps(app.state, key, v), { quiet: true });
  },
  'fam:meat': (app, el) => {
    const v = Number(el.dataset.value) === 0.85 ? 0.85 : 1;
    app.commit({ ...settingOps(app.state, 'meatScale', v), message: v === 1 ? 'Meat amounts are back to hearty, as written.' : 'Lighter: every meat amount is 15% less, and the list and budget follow.' });
  },
  'fam:organic': (app) => app.commit(settingOps(app.state, 'organic', !app.settings.organic), { quiet: true }),
  'fam:weekstart': (app, el) => app.commit(settingOps(app.state, 'weekStartsOn', Number(el.dataset.value)), { quiet: true }),
  'ai:model': (app, el) => {
    const id = el.dataset.value;
    if (!AI_MODELS.some((m) => m.id === id) || id === app.settings.aiModel) return;
    const res = settingOps(app.state, 'aiModel', id);
    app.commit({ ...res, undo: undoFor(app.state, res.ops), message: `${modelLabel(id)} reads your photos and suggests dinners from now on.` });
  },
  'ai:link': (app) => fetchLink(app, 'GET', '/api/mcp/link'),
  'ai:copy': async () => {
    if (!ai.link) return;
    toast(await copyText(ai.link) ? 'Link copied. Paste it into Claude’s Add custom connector.' : 'Couldn’t copy. Press and hold the link to copy it.');
  },
  'ai:rotate': async (app) => {
    if (!connected(app) || ai.linkBusy) return;
    const ok = await confirmSheet({ title: 'Make a new link?', body: 'The old link stops working right away. Any Claude app using it needs the new one pasted in.', confirm: 'Make a new link' });
    if (ok && await fetchLink(app, 'POST', '/api/mcp/rotate')) toast('New link ready. The old one no longer works.');
  },
  'fam:reset': async (app) => {
    const ok = await confirmSheet({
      title: 'Clear this device’s data?',
      body: app.store.device.key && !app.store.device.localOnly
        ? 'This removes the plan, pantry and settings saved on this device, and it forgets the family passcode. The family’s shared plan on the server is not touched; it comes back when you enter the passcode.'
        : 'This device isn’t syncing, so its plan, pantry, favorites and receipts will be gone for good.',
      confirm: 'Clear this device',
      danger: true,
    });
    if (!ok) return;
    Object.assign(ai, { info: null, at: 0, error: null, link: '', linkError: '' });
    app.store.resetLocal();
    app.ui.anchor = null;
    toast('This device’s data is cleared.');
    location.hash = '#/tonight';
    app.render();
  },
};
