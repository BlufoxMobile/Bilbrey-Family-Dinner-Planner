// First launch: who's using this phone, then the family passcode (create or enter).
import { html, avatar, when } from '../ui.js';
import { FAMILY } from '../config.js';
import { passcodeForm, actions as familyActions } from './family.js';

export function gateActive(app) {
  const d = app.store.device;
  if (!d.who) return true;
  if (d.dismissedGate || d.localOnly || d.key) return false;
  return app.store.status === 'needs-setup' || app.store.status === 'needs-passcode';
}

export function render(app) {
  const d = app.store.device;
  if (!d.who) {
    return html`<section class="gate gate-who" aria-labelledby="gate-h">
      <div class="gate-card">
        <span class="wm-mark wm-lg" aria-hidden="true"></span>
        <h1 id="gate-h" class="gate-title">The Bilbrey Family Dinner Planner</h1>
        <p class="gate-text">Dinner for five, planned around Sam’s Club and Jewel-Osco.</p>
        <h2 class="gate-q">Who’s using this phone?</h2>
        <div class="who-grid">${FAMILY.map((n) => html`<button type="button" class="who-pick" data-action="gate:who" data-who="${n}">${avatar(n, { size: 'lg' })}<span>${n}</span></button>`)}</div>
      </div>
    </section>`;
  }
  const creating = app.store.status === 'needs-setup';
  return html`<section class="gate" aria-labelledby="gate-h">
    <div class="gate-card">
      <span class="wm-mark wm-lg" aria-hidden="true"></span>
      <h1 id="gate-h" class="gate-title">${creating ? 'Create the family passcode' : 'Enter the family passcode'}</h1>
      <p class="gate-text">${creating
        ? `${d.who === 'Jeff' ? 'You’re the first one here, Jeff.' : `You’re the first one here, ${d.who}.`} Pick a passcode the whole family will share, so every phone sees the same plan, votes and pantry.`
        : `Hi ${d.who}. Type the passcode Jeff set up, and this phone joins the family plan.`}</p>
      ${passcodeForm(app, creating ? 'create' : 'enter', { compact: true })}
      <div class="gate-alt">
        <button type="button" class="btn btn-quiet btn-block" data-action="gate:later">Decide later</button>
        <button type="button" class="btn btn-quiet btn-block" data-action="gate:local">Use on this phone only</button>
      </div>
      ${when(creating, () => html`<p class="muted small">It never leaves the phone in plain text. Capital letters don’t matter.</p>`)}
    </div>
  </section>`;
}

export function mount(app, root) {
  root.querySelector('.gate input[type=password]')?.focus({ preventScroll: true });
}

export const actions = {
  'gate:who': (app, el) => {
    app.store.setDevice({ who: el.dataset.who });
    app.store.connect();
  },
  'gate:later': (app) => { app.store.setDevice({ dismissedGate: true }); },
  'gate:local': (app) => { app.store.useLocalOnly(); app.store.setDevice({ dismissedGate: true }); },
  ...familyActions,
};
