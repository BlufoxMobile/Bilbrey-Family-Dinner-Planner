// First open on a phone, a computer or the TV (docs/spec/20): what the planner is, then the
// family passcode — create it once, type it on every other device. The family shares one
// profile, so nobody is asked who they are. The screen never guesses: it says it is looking for
// the family's plan, and if the server can't be reached it says so and offers a way in anyway.
import { html, ic, when } from '../ui.js';
import { isTV } from '../util.js';
import { passcodeForm, actions as familyActions } from './family.js';

/** The first-open screen shows until this device has the passcode, is set to work alone, or was waved through. */
export function gateActive(app) {
  const d = app.store.device;
  return !(d.key || d.localOnly || d.dismissedGate);
}

/** Which of the four first-open screens: 'checking' | 'create' | 'enter' | 'offline'. */
export function gateStep(app) {
  const s = app.store;
  if (s.status === 'needs-setup') return 'create';
  if (s.status === 'needs-passcode') return 'enter';
  // Only the first look, or a tap on "Try again", shows "looking": the quiet retries in the
  // background must not swap the buttons out from under a thumb or a TV remote.
  return s.checked && !app.ui.gateBusy ? 'offline' : 'checking';
}

const POINTS = [
  ['plan', 'Dinner for five, planned for the week: a main and two sides, nothing that needs an oven.'],
  ['list', 'One shopping list for Sam’s Club and Jewel-Osco, minus what’s already in the pantry.'],
  ['family', 'Every phone and the TV show the same plan. There are no separate profiles.'],
];

function intro() {
  return html`<ul class="gate-points">${POINTS.map(([icon, text]) => html`<li>${ic(icon, { size: 20 })}<span>${text}</span></li>`)}</ul>`;
}

// "This device only" is for the rare phone that should never share; it waits under More options
// (gauntlet r1), next to Larger text for whoever finds the type small.
const altButtons = (app) => html`<div class="gate-alt">
  <button type="button" class="btn btn-quiet btn-block" id="gate-later" data-action="gate:later">Look around first</button>
  <details class="gate-more">
    <summary>More options</summary>
    <button type="button" class="btn btn-quiet btn-block" id="gate-text" data-action="gate:text">${app.store.device.textSize === 'large' ? 'Regular text' : 'Larger text'}</button>
    <button type="button" class="btn btn-quiet btn-block" id="gate-local" data-action="gate:local">Use on this device only</button>
  </details>
</div>`;

export function render(app) {
  const step = gateStep(app);
  // Two parts, so a wide, short screen (a TV, a laptop) can put them side by side and keep the
  // passcode box on screen without scrolling.
  const card = (title, about, main) => html`<section class="gate gate-${step}" aria-labelledby="gate-h">
    <div class="gate-card">
      <div class="gate-about">
        <span class="wm-mark wm-lg" aria-hidden="true"></span>
        <p class="gate-kicker">The Bilbrey Family Dinner Planner</p>
        <h1 id="gate-h" class="gate-title">${title}</h1>
        ${about}
      </div>
      <div class="gate-main">${main}</div>
    </div>
  </section>`;
  if (step === 'checking') {
    return card('Dinner, lunches and one shopping list', intro(), html`
      <p class="gate-status" role="status"><span class="gate-spin" aria-hidden="true"></span>Looking for the family’s plan…</p>`);
  }
  if (step === 'offline') {
    return card('Can’t reach the family’s plan', html`
      <p class="gate-text">This device is offline, or the family server isn’t answering. Check the Wi-Fi and try again.</p>`, html`
      <p class="gate-text">You can also look around now: the recipes are all here, and anything you change is kept on this device until it connects.</p>
      <button type="button" class="btn btn-primary btn-block" id="gate-retry" data-action="gate:retry">${ic('refresh', { size: 20 })}Try again</button>
      ${altButtons(app)}`);
  }
  const creating = step === 'create';
  return card(creating ? 'Create the family passcode' : 'Enter the family passcode', intro(), html`
    <p class="gate-text">${creating
      ? 'You’re the first one here. Pick a passcode the whole family will share; it’s typed once on each phone and on the TV.'
      : 'Type the passcode the family set up, and this device joins the plan. Capital letters don’t matter.'}</p>
    ${passcodeForm(app, creating ? 'create' : 'enter', { compact: true })}
    ${when(isTV() && !app.ui.passErr, () => html`<p class="muted small gate-remote">With a remote: move to the box and press OK or Select for the on-screen keyboard. “Show the passcode” lets you check it before you choose ${creating ? 'Create' : 'Join'}.</p>`)}
    ${altButtons(app)}
    ${when(creating, () => html`<p class="muted small">It never leaves the device in plain text. Capital letters don’t matter.</p>`)}`);
}

/** Called when a first-open screen appears (not on every redraw, so a TV remote's focus isn't yanked back). */
export function mount(app, root) {
  const el = root.querySelector('#pc-enter, #pc-new') || root.querySelector('#gate-retry');
  if (!el) return;
  el.focus({ preventScroll: true });
  el.scrollIntoView?.({ block: 'nearest' }); // on a short screen the box must be in view, not below the fold
}

export const actions = {
  'gate:later': (app) => { app.store.setDevice({ dismissedGate: true }); },
  'gate:text': (app) => { app.store.setDevice({ textSize: app.store.device.textSize === 'large' ? 'regular' : 'large' }); },
  'gate:local': (app) => { app.store.useLocalOnly(); app.store.setDevice({ dismissedGate: true }); },
  'gate:retry': (app) => {
    app.ui.gateBusy = true;
    app.render();
    app.store.connect().finally(() => { app.ui.gateBusy = false; app.render(); });
  },
  // A "who's using this phone" button from before the shared profile (an older page still open): nothing to pick any more.
  'gate:who': (app) => { app.store.connect(); },
  ...familyActions,
};
