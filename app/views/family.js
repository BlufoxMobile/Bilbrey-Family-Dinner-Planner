// FAMILY & SETTINGS: this phone, family sync + passcode, planner rules, stores, data.
import { html, ic, when, toast, avatar, confirmSheet, segmented, stepper, switchToggle, tf } from '../ui.js';
import { PARENTS, VERSION } from '../config.js';
import { mediumDate } from '../util.js';
import { settingOps } from '../actions.js';
import { allDinners } from '../planner.js';

export const title = () => 'Family & settings';
export const MEAT_OPTS = [{ id: '1', label: 'Hearty (as written)' }, { id: '0.85', label: 'Lighter (−15%)' }];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function passcodeForm(app, mode, { compact = false } = {}) {
  const err = app.ui.passErr || '';
  if (mode === 'create') {
    return html`<form class="form" data-submit="fam:create" autocomplete="off">
      <label class="field"><span class="field-label">New family passcode</span><input class="input" id="pc-new" name="pass" type="password" minlength="4" maxlength="64" required autocomplete="new-password" placeholder="At least 4 characters"></label>
      <label class="field"><span class="field-label">Type it again</span><input class="input" id="pc-again" name="again" type="password" minlength="4" maxlength="64" required autocomplete="new-password"></label>
      ${when(err, () => html`<p class="form-error" role="alert">${err}</p>`)}
      <button type="submit" class="btn btn-primary btn-block" ${app.ui.passBusy ? 'disabled' : ''}>${app.ui.passBusy ? 'Creating…' : 'Create the family passcode'}</button>
      ${when(!compact, () => html`<p class="muted small">Everyone types the same passcode once on their phone. It never leaves the phone in plain text; capital letters don’t matter.</p>`)}
    </form>`;
  }
  if (mode === 'change') {
    return html`<form class="form" data-submit="fam:change" autocomplete="off">
      <label class="field"><span class="field-label">New passcode</span><input class="input" id="pc-change" name="pass" type="password" minlength="4" maxlength="64" required autocomplete="new-password"></label>
      <label class="field"><span class="field-label">Type it again</span><input class="input" id="pc-change2" name="again" type="password" minlength="4" maxlength="64" required autocomplete="new-password"></label>
      ${when(err, () => html`<p class="form-error" role="alert">${err}</p>`)}
      <button type="submit" class="btn btn-secondary btn-block" ${app.ui.passBusy ? 'disabled' : ''}>Change the family passcode</button>
      <p class="muted small">Other phones will be asked for the new passcode.</p>
    </form>`;
  }
  return html`<form class="form" data-submit="fam:enter" autocomplete="off">
    <label class="field"><span class="field-label">Family passcode</span><input class="input" id="pc-enter" name="pass" type="password" maxlength="64" required autocomplete="current-password"></label>
    ${when(err, () => html`<p class="form-error" role="alert">${err}</p>`)}
    <button type="submit" class="btn btn-primary btn-block" ${app.ui.passBusy ? 'disabled' : ''}>${app.ui.passBusy ? 'Checking…' : 'Join the family plan'}</button>
    ${when(!compact, () => html`<p class="muted small">Ask Jeff or Candi for the passcode. This phone remembers it.</p>`)}
  </form>`;
}

function syncSection(app) {
  const s = app.store;
  const parent = PARENTS.includes(app.who());
  const status = s.status;
  let body;
  if (status === 'local') {
    body = html`<p class="sheet-text">This phone keeps its own plan. Nothing is shared.</p>
      <button type="button" class="btn btn-primary" data-action="sync:family">Share with the family</button>`;
  } else if (status === 'needs-setup') {
    body = html`<p class="sheet-text">No family passcode yet. Create it once, then everyone enters it on their phone.</p>${passcodeForm(app, 'create')}`;
  } else if (status === 'needs-passcode') {
    body = html`<p class="sheet-text">${s.statusDetail || 'Enter the family passcode to see the same plan, votes and pantry as everyone else.'}</p>${passcodeForm(app, 'enter')}`;
  } else if (status === 'offline' && !s.device.key) {
    body = html`<p class="sheet-text">Can’t reach the family server right now. Everything works on this phone, and you can connect later.</p>
      <button type="button" class="btn btn-secondary" data-action="sync:retry">${ic('refresh', { size: 20 })}Try again</button>`;
  } else {
    const pending = s.pending.length;
    body = html`<p class="sheet-text">${status === 'synced' ? 'Connected. Everyone sees the same plan, votes, pantry and list.'
      : status === 'syncing' ? 'Sending changes…'
        : status === 'error' ? s.statusDetail || 'Sync is paused.'
          : `Offline. ${pending ? `${pending} change${pending === 1 ? ' is' : 's are'} saved on this phone and will sync.` : 'Changes are saved on this phone and will sync.'}`}</p>
      <button type="button" class="btn btn-secondary" data-action="sync:now">${ic('refresh', { size: 20 })}Sync now</button>
      ${when(parent && status === 'synced', () => html`<details class="more"><summary>Change the family passcode</summary>${passcodeForm(app, 'change')}</details>`)}`;
  }
  return html`<section class="set-sec" aria-labelledby="sync-h">
    <h2 id="sync-h" class="section-title">Family sync</h2>
    ${body}
    ${when(status !== 'local', () => html`<button type="button" class="btn btn-quiet" data-action="fam:local">${ic('phone', { size: 20 })}Use on this phone only</button>`)}
  </section>`;
}

function rules(app) {
  const s = app.settings;
  return html`<section class="set-sec" aria-labelledby="rules-h">
    <h2 id="rules-h" class="section-title">Planner rules</h2>
    <div class="set-row set-col"><span class="set-label">Burger nights<small>Fries by default, with an option to add a side.</small></span>
      <div class="chip-grid days-pick">${DAYS.map((d, i) => html`<button type="button" class="chip ${s.burgerNights.includes(i) ? 'is-on' : ''}" aria-pressed="${tf(s.burgerNights.includes(i))}" data-action="fam:burger" data-day="${i}">${d}</button>`)}</div></div>
    <div class="set-row"><span class="set-label">Frozen pizza nights a month<small>On Saturdays.</small></span>${stepper({ value: s.pizzaPerMonth, step: 1, min: 0, action: 'fam:num', data: { key: 'pizzaPerMonth', max: 4 }, label: 'Pizza nights a month' })}</div>
    <div class="set-row"><span class="set-label">Rice dinners a week, at most<small>Candi’s rule.</small></span>${stepper({ value: s.riceMaxPerWeek, step: 1, min: 0, action: 'fam:num', data: { key: 'riceMaxPerWeek', max: 3 }, label: 'Rice dinners a week' })}</div>
    <div class="set-row set-col"><span class="set-label">Meat per dinner<small>Lighter trims every meat amount by 15% to save money.</small></span>${segmented('meatScale', MEAT_OPTS, String(s.meatScale), { label: 'Meat per dinner', action: 'fam:meat', small: true })}</div>
    <div class="set-row set-col"><span class="set-label">Plan from</span>${segmented('planStore', [{ id: 'both', label: 'Both stores' }, { id: 'sams', label: "Sam's only" }, { id: 'jewel', label: 'Jewel only' }], s.planStore, { label: 'Plan from', action: 'plan:setting', small: true })}</div>
    <div class="set-row set-col"><span class="set-label">Brands by default<small>Change any single item on the list.</small></span>${segmented('brand', [{ id: 'generic', label: 'Store brand' }, { id: 'name', label: 'Name brand' }], s.brand, { label: 'Brand default', action: 'plan:setting', small: true })}</div>
    <div class="set-row set-col"><span class="set-label">Weeks start on</span>${segmented('weekStartsOn', [{ id: '1', label: 'Monday' }, { id: '0', label: 'Sunday' }], String(s.weekStartsOn), { label: 'Weeks start on', action: 'fam:weekstart', small: true })}</div>
    <div class="set-row"><span class="set-label">Monthly grocery target</span><a class="btn btn-small btn-quiet" href="#/budget">$${s.monthlyTarget}</a></div>
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
  </section>`;
}

export function render(app) {
  const who = app.who();
  const theme = app.store.device.theme || 'auto';
  return html`<div class="page page-family">
    <header class="page-head"><h1 class="page-title">Family & settings</h1></header>
    <section class="set-sec me" aria-labelledby="me-h">
      <h2 id="me-h" class="sr-only">This phone</h2>
      <div class="me-row">${avatar(who, { size: 'lg' })}<span><b>${who ? `${who}’s phone` : 'Whose phone is this?'}</b><small>Votes and changes from this phone say ${who || 'nobody yet'}.</small></span>
        <button type="button" class="btn btn-small btn-secondary" data-action="sheet:who">Change</button></div>
      <div class="set-row"><span class="set-label">Show calories and protein<small>On this phone only. Lunches and dinners; breakfast and snacks aren’t tracked.</small></span>${switchToggle({ on: !app.store.device.hideNutrition, action: 'fam:nutrition', label: 'Show calories and protein on this phone' })}</div>
      <div class="set-row set-col"><span class="set-label">Appearance</span>${segmented('theme', [{ id: 'auto', label: 'Match phone' }, { id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }], theme, { label: 'Appearance', action: 'fam:theme', small: true })}</div>
    </section>
    ${syncSection(app)}
    ${rules(app)}
    ${stores(app)}
    <section class="set-sec" aria-labelledby="hl-h">
      <h2 id="hl-h" class="section-title">Good to know</h2>
      <ul class="plain">
        <li>Sam’s Club and Jewel-Osco don’t let apps read live prices or fill a cart. Prices here are researched estimates${app.db.pricesUpdated ? ` (as of ${mediumDate(app.db.pricesUpdated)})` : ''}; fix any price on the list and the whole family gets it.</li>
        <li>Ordering means copying a store-ready list and opening the store’s app. You check out there.</li>
        <li>Pantry scans are AI suggestions. You confirm every item and amount.</li>
        <li>No recipe uses the oven, and there is never seafood or tofu.</li>
      </ul>
    </section>
    <section class="set-sec" aria-labelledby="data-h">
      <h2 id="data-h" class="section-title">This phone’s data</h2>
      <p class="muted small">${allDinners(app.db, app.state).length} dinners and ${app.db.sideList.length} sides in the recipe box. Version ${VERSION}.</p>
      <button type="button" class="btn btn-danger-quiet" data-action="fam:reset">${ic('trash', { size: 20 })}Clear this phone’s data</button>
    </section>
  </div>`;
}

async function withBusy(app, fn) {
  app.ui.passBusy = true;
  app.ui.passErr = '';
  app.render();
  try {
    await fn();
    app.ui.passErr = '';
  } catch (e) {
    app.ui.passErr = e?.status === 0 ? 'Can’t reach the family server. Check the connection and try again.' : e?.message || 'Something went wrong. Try again.';
  } finally {
    app.ui.passBusy = false;
    app.render();
  }
}

export const actions = {
  'fam:create': (app, form) => {
    const f = new FormData(form);
    const pass = String(f.get('pass') || '');
    if (pass.trim().length < 4) { app.ui.passErr = 'Use at least 4 characters.'; app.render(); return; }
    if (pass.trim().toLowerCase() !== String(f.get('again') || '').trim().toLowerCase()) { app.ui.passErr = 'The two passcodes don’t match.'; app.render(); return; }
    withBusy(app, async () => {
      try {
        await app.store.createPasscode(pass);
        toast('Family passcode created. Share it with Candi and the boys.');
      } catch (e) {
        if (e.status === 409) { app.store.setStatus('needs-passcode'); }
        throw e;
      }
    });
  },
  'fam:enter': (app, form) => {
    const pass = String(new FormData(form).get('pass') || '');
    if (!pass.trim()) return;
    withBusy(app, async () => {
      try {
        await app.store.enterPasscode(pass);
        toast('You’re on the family plan.');
      } catch (e) {
        if (e.data?.needsSetup) app.store.setStatus('needs-setup');
        throw e;
      }
    });
  },
  'fam:change': (app, form) => {
    const f = new FormData(form);
    const pass = String(f.get('pass') || '');
    if (pass.trim().length < 4) { app.ui.passErr = 'Use at least 4 characters.'; app.render(); return; }
    if (pass.trim().toLowerCase() !== String(f.get('again') || '').trim().toLowerCase()) { app.ui.passErr = 'The two passcodes don’t match.'; app.render(); return; }
    withBusy(app, async () => { await app.store.changePasscode(pass); toast('Passcode changed. Other phones will ask for it.'); });
  },
  'fam:local': async (app) => {
    const ok = await confirmSheet({ title: 'Use on this phone only?', body: 'This phone stops syncing with the family. Your plan stays here, and you can share with the family again any time.', confirm: 'Use on this phone only' });
    if (ok) { app.store.useLocalOnly(); toast('Using the planner on this phone only.'); }
  },
  'fam:theme': (app, el) => app.store.setDevice({ theme: el.dataset.value }),
  'fam:nutrition': (app) => app.store.setDevice({ hideNutrition: !app.store.device.hideNutrition }),
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
  'fam:weekstart': (app, el) => app.commit(settingOps(app.state, 'weekStartsOn', Number(el.dataset.value)), { quiet: true }),
  'fam:reset': async (app) => {
    const ok = await confirmSheet({
      title: 'Clear this phone’s data?',
      body: app.store.device.key && !app.store.device.localOnly
        ? 'This removes the plan, pantry and settings saved on this phone, and forgets who’s using it. The family’s shared plan on the server is not touched; it comes back when you enter the passcode.'
        : 'This phone isn’t syncing, so its plan, pantry, votes and receipts will be gone for good.',
      confirm: 'Clear this phone',
      danger: true,
    });
    if (!ok) return;
    app.store.resetLocal();
    app.ui.anchor = null;
    toast('This phone’s data is cleared.');
    location.hash = '#/tonight';
    app.render();
  },
};
