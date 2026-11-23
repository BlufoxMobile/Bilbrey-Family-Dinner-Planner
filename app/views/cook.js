// COOK MODE (SPEC §22.3): full screen, one step at a time in type you can read from across the
// kitchen. Next and back by tap, swipe, arrow keys or a TV remote. Timers keep counting across
// steps (and screens, and reloads) and ring with a sound and a banner. The screen stays awake.
// It remembers the step you were on. Finishing marks the dinner cooked and asks about leftovers.
import { html, ic, when, tf, openSheet, closeSheet, sheetOpen } from '../ui.js';
import { isISODate, midSentence, relativeDay, listJoin } from '../util.js';
import { dinnerById, findInPlan } from '../planner.js';
import { markCookedOps, cookedPreview } from '../actions.js';
import { cic, equipIcon, equipLabel, timelineChart, leftoversQuestion, isLeftoverNight, thawLine } from './common.js';
import {
  plateRecipes, cookTracks, cookTimeline, stepIngredients, stepDetails, equipmentSettings, safeTemps, pantryCheck, ingredientLabel,
  newTimer, timerLeft, timerPhase, pauseTimer, resumeTimer, addTime, fmtClock, fmtMinutes, ringing, leftoversNote, servingsText,
} from '../cooking.js';
import { itemMeta } from '../shopping.js';

export const title = (app) => {
  const t = target(app);
  return t.d ? `Cooking ${t.d.title}` : 'Cook mode';
};

// ---------------------------------------------------------------- what's being cooked

/** #/cook/<date> cooks that night's dinner; #/cook/d/<id> cooks a recipe (tonight's, if it's on tonight's plan). */
function target(app) {
  const [a, b] = app.route.params;
  const today = app.today();
  if (a === 'd') {
    const tonight = app.state.plan?.[today];
    if (tonight?.dinner === b && tonight.status !== 'away') return { d: dinnerById(app.db, app.state, b), date: today, entry: tonight };
    // Not tonight's: cook it with the sides of the night it's next planned for (the recipe page shows the same ones).
    const nextNight = findInPlan(app.state, b, { from: today })[0];
    return { d: dinnerById(app.db, app.state, b), date: null, entry: nextNight ? app.state.plan[nextNight] : null };
  }
  const date = isISODate(a) ? a : today;
  const entry = app.state.plan?.[date];
  if (entry?.status === 'away') return { d: null, date, entry, away: true };
  return { d: entry?.dinner ? dinnerById(app.db, app.state, entry.dinner) : null, date, entry };
}

function build(app, t) {
  const recs = plateRecipes(app.db, app.state, t.d.id, t.entry);
  const tracks = cookTracks(recs);
  const tl = cookTimeline(tracks, { order: prefs.order });
  const ings = Object.fromEntries(recs.map((r) => [r.id, stepIngredients(app.db, app.state, r.recipe.items, stepDetails(r.recipe))]));
  return { recs, tracks, tl, ings, n: tl.steps.length };
}

// ---------------------------------------------------------------- what this device remembers

const LS = { session: 'bfdp.cook.session', timers: 'bfdp.cook.timers', prefs: 'bfdp.cook.prefs' };
const HAS_DOM = typeof document !== 'undefined';
function read(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: it just won't be remembered */ }
}

const savedPrefs = read(LS.prefs, {});
const prefs = {
  size: typeof savedPrefs?.size === 'number' ? Math.max(0.85, Math.min(1.6, savedPrefs.size)) : 1,
  sound: savedPrefs?.sound !== false,
  order: savedPrefs?.order === 'dish' ? 'dish' : 'together',
};

/** A cooking session is good for the evening: after 18 hours it starts over. */
const SESSION_MS = 18 * 3600 * 1000;
let session = null; // { key, i (-1 = get ready, n = finish), gathered: { id: true }, n, at }
let resumedKey = null;

function sessionFor(key, n) {
  if (session?.key !== key) {
    const s = read(LS.session, null);
    const fresh = s && s.key === key && Number.isFinite(s.i) && Date.now() - (Number(s.at) || 0) < SESSION_MS;
    session = fresh ? { key, i: s.i, gathered: s.gathered && typeof s.gathered === 'object' ? s.gathered : {}, at: s.at } : { key, i: -1, gathered: {}, at: Date.now() };
    resumedKey = fresh && session.i >= 0 && session.i < n ? key : null;
  }
  session.i = Math.max(-1, Math.min(n, Math.round(session.i)));
  session.n = n;
  return session;
}
function saveSession() {
  if (session) write(LS.session, { ...session, at: Date.now() });
}

/** For Tonight: "Keep cooking, step 4 of 9". → { step, of } | null */
export function cookProgress(dinnerId) {
  const s = session?.key === `cook:${dinnerId}` ? session : read(LS.session, null);
  if (!s || s.key !== `cook:${dinnerId}` || !(s.i >= 0) || !(s.n > 0) || s.i >= s.n) return null;
  if (Date.now() - (Number(s.at) || 0) > SESSION_MS) return null;
  return { step: s.i + 1, of: s.n };
}

// ---------------------------------------------------------------- text size: three steps
const SIZES = [1, 1.3, 1.6];
const SIZE_NAMES = ['Text', 'Large', 'Largest'];
function sizeStep() {
  let best = 0;
  SIZES.forEach((v, k) => { if (Math.abs(v - prefs.size) < Math.abs(SIZES[best] - prefs.size)) best = k; });
  return best;
}

// ---------------------------------------------------------------- timers

let timers = (Array.isArray(read(LS.timers, [])) ? read(LS.timers, []) : [])
  .filter((t) => t && typeof t.id === 'string' && Number.isFinite(t.endsAt) && Number.isFinite(t.seconds))
  // One that finished long ago (the app was closed) has nothing left to say.
  .filter((t) => t.left != null || (!t.acked && Date.now() - t.endsAt < 30 * 60000));
const rung = new Set();
let appRef = null;
let ticker = null;
let audio = null;
let lastBeep = 0;

const saveTimers = () => write(LS.timers, timers);
const timerById = (id) => timers.find((t) => t.id === id);
function setTimer(next) {
  timers = timers.some((t) => t.id === next.id) ? timers.map((t) => (t.id === next.id ? next : t)) : [...timers, next];
  rung.delete(next.id);
  saveTimers();
  startTicking();
}
function dropTimer(id) {
  timers = timers.filter((t) => t.id !== id);
  rung.delete(id);
  saveTimers();
  syncAlert();
}

/** Browsers only let a page make sound after a tap: every timer button unlocks it. */
function unlockAudio() {
  try {
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctx) return;
    audio = audio || new Ctx();
    if (audio.state === 'suspended') audio.resume();
  } catch { audio = null; }
}
function beep() {
  if (!prefs.sound) return;
  try { navigator.vibrate?.([250, 120, 250]); } catch { /* not a phone */ }
  if (!audio || audio.state !== 'running') return;
  const t0 = audio.currentTime;
  [[0, 880], [0.24, 880], [0.48, 1175]].forEach(([at, hz]) => {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'sine';
    osc.frequency.value = hz;
    gain.gain.setValueAtTime(0.0001, t0 + at);
    gain.gain.exponentialRampToValueAtTime(0.4, t0 + at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.2);
    osc.connect(gain).connect(audio.destination);
    osc.start(t0 + at);
    osc.stop(t0 + at + 0.22);
  });
}

function startTicking() {
  if (!HAS_DOM || ticker) return;
  ticker = setInterval(tick, 500);
  tick();
}

/** Twice a second: move the clocks on the page, and ring any timer that just finished. */
function tick() {
  const now = Date.now();
  if (!timers.length) { clearInterval(ticker); ticker = null; syncAlert(); return; }
  for (const el of document.querySelectorAll('[data-timer-clock]')) {
    const t = timerById(el.dataset.timerClock);
    if (t) el.textContent = fmtClock(timerLeft(t, now));
  }
  const due = ringing(timers, now);
  const fresh = due.filter((t) => !rung.has(t.id));
  if (fresh.length) {
    for (const t of fresh) rung.add(t.id);
    lastBeep = now;
    beep();
    syncAlert();
    // The step's own controls change from "pause" to "done".
    if (document.querySelector('.cook') && appRef) appRef.render();
  } else if (due.length && now - lastBeep > 2500 && now - Math.min(...due.map((t) => t.endsAt)) < 120000) {
    lastBeep = now; // keep ringing (for two minutes) until someone answers
    beep();
  }
  if (!due.length && document.getElementById('cook-alert')) syncAlert();
}

/** The banner for finished timers. It sits above every screen, so it's seen from the recipe page too. */
function syncAlert() {
  if (!HAS_DOM) return;
  const due = ringing(timers, Date.now());
  let el = document.getElementById('cook-alert');
  if (!due.length) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'cook-alert';
    el.className = 'cook-alert';
    el.setAttribute('role', 'alert');
  }
  const sheet = document.getElementById('sheet');
  const host = sheet?.open ? sheet : document.body;
  if (el.parentNode !== host) host.appendChild(el);
  const inCook = !!document.querySelector('.cook');
  el.innerHTML = html`${due.map((t) => html`<div class="cook-alert-row">
      <span class="cook-alert-ic" aria-hidden="true">${cic('bell', { size: 26 })}</span>
      <p class="cook-alert-text"><b>Timer done</b><span>${t.title || 'Cook mode'}${t.label ? `: ${t.label}` : ''}</span></p>
      <span class="cook-alert-acts">
        <button type="button" class="btn btn-small btn-on-alert" data-action="cook:timer-ack" data-id="${t.id}">Got it</button>
        <button type="button" class="btn btn-small btn-quiet-alert" data-action="cook:timer-add" data-id="${t.id}" data-seconds="60">+1 min</button>
        ${when(!inCook && t.href, () => html`<a class="btn btn-small btn-quiet-alert" href="${t.href}">Back to cooking</a>`)}
      </span>
    </div>`)}`.s;
}

// ---------------------------------------------------------------- staying awake

let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener?.('release', () => { wakeLock = null; showWake(); });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { wakeLock = null; }
  showWake();
}
/** Says only what's true: the lock can be refused (low battery, an older TV browser). */
function showWake() {
  if (!HAS_DOM) return;
  const el = document.querySelector('[data-wake]');
  if (el) el.textContent = wakeLock ? 'The screen stays on while you cook.' : 'This screen may dim while you cook: turn auto-lock up, or tap it now and then.';
}

if (HAS_DOM) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (document.querySelector('.cook')) keepAwake(true);
    if (timers.length) tick();
  });
  window.addEventListener('hashchange', () => { if (!location.hash.startsWith('#/cook')) keepAwake(false); });
  // Arrow keys and a TV remote's left / right, rewind / fast-forward and play / pause.
  window.addEventListener('keydown', (ev) => {
    usedKeys = true;
    if (ev.defaultPrevented || ev.altKey || ev.ctrlKey || ev.metaKey || !appRef || !document.querySelector('.cook[data-key]') || sheetOpen()) return;
    const tag = ev.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const onControl = tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY';
    const k = ev.key;
    // With a remote or a keyboard walking the screen (app/tv.js), the arrows belong to it along the
    // top bar, so every button there can be reached; everywhere else left and right are the steps.
    const walking = document.documentElement.classList.contains('is-tv') || document.documentElement.dataset.input === 'keys';
    if ((k === 'ArrowLeft' || k === 'ArrowRight') && walking && ev.target?.closest?.('.cook-bar')) return;
    let act = null;
    if (k === 'ArrowRight' || k === 'PageDown' || k === 'MediaTrackNext' || k === 'MediaFastForward' || (k === ' ' && !onControl)) act = 'cook:next';
    else if (k === 'ArrowLeft' || k === 'PageUp' || k === 'MediaTrackPrevious' || k === 'MediaRewind') act = 'cook:back';
    else if (k === 'MediaPlayPause' || ((k === 't' || k === 'T') && !onControl)) act = 'cook:timer-toggle';
    else if (k === 'Escape' && ringing(timers, Date.now()).length) act = 'cook:timer-ack-all';
    if (!act) return;
    ev.preventDefault();
    ev.stopPropagation();
    actions[act](appRef, document.createElement('span'));
  }, true);
  if (timers.length) {
    startTicking();
    window.addEventListener('pointerdown', unlockAudio, { once: true });
  }
}

// ---------------------------------------------------------------- screens

const TONE = { main: 'main', side0: 'a', side1: 'b', side2: 'c', side3: 'c' };
const tone = (track) => `cook-tone-${TONE[track] || 'c'}`;
const timerId = (s, step, k) => `${s.key}|${step.key}|${k}`;

function timerControl(app, s, step, k, t0) {
  const id = timerId(s, step, k);
  const t = timerById(id);
  const now = Date.now();
  const phase = t ? timerPhase(t, now) : 'idle';
  if (phase === 'idle') {
    return html`<li class="cook-timer is-idle"><button type="button" class="btn btn-secondary cook-timer-start" data-action="cook:timer" data-key="${step.key}" data-k="${k}">${cic('timer', { size: 22 })}<span>Start timer</span><b>${t0.label}</b></button></li>`;
  }
  return html`<li class="cook-timer is-${phase}" data-timer="${id}">
    <span class="cook-timer-face">${cic(phase === 'done' ? 'bell' : 'timer', { size: 24 })}<b class="cook-timer-clock" data-timer-clock="${id}">${fmtClock(timerLeft(t, now))}</b><small>${phase === 'done' ? `Done: ${t.label}` : phase === 'paused' ? `Paused: ${t.label}` : t.label}</small></span>
    <span class="cook-timer-acts">
      ${phase === 'running' ? html`<button type="button" class="btn btn-small btn-secondary" data-action="cook:timer-pause" data-id="${id}">${cic('pause', { size: 18 })}Pause</button>` : ''}
      ${phase === 'paused' ? html`<button type="button" class="btn btn-small btn-secondary" data-action="cook:timer-resume" data-id="${id}">${cic('play', { size: 18 })}Go on</button>` : ''}
      ${phase === 'done' ? html`<button type="button" class="btn btn-small btn-primary" data-action="cook:timer-ack" data-id="${id}">${ic('check', { size: 18 })}Got it</button>
        <button type="button" class="btn btn-small btn-secondary" data-action="cook:timer" data-key="${step.key}" data-k="${k}">${t0.per ? `Again for the next ${t0.per}` : 'Again'}</button>` : ''}
      <button type="button" class="btn btn-small btn-quiet" data-action="cook:timer-add" data-id="${id}" data-seconds="60">+1 min</button>
      ${phase !== 'done' ? html`<button type="button" class="btn btn-small btn-quiet" data-action="cook:timer-cancel" data-id="${id}">Stop</button>` : ''}
    </span>
  </li>`;
}

/** Timers from other steps, always in sight: tap one to go back to its step. */
function dock(s, p, current) {
  const now = Date.now();
  const mine = timers.filter((t) => t.id.startsWith(`${s.key}|`));
  const others = mine.filter((t) => !current || t.step !== current.key);
  if (!others.length) return '';
  return html`<div class="cook-dock" role="group" aria-label="Timers running on other steps">
    ${others.map((t) => {
      const phase = timerPhase(t, now);
      const idx = p.tl.steps.findIndex((x) => x.key === t.step);
      return html`<button type="button" class="cook-pill is-${phase}" data-action="cook:goto" data-i="${idx}" ${idx < 0 ? 'disabled' : ''} aria-label="${t.title}, ${t.label}: ${phase === 'done' ? 'done' : 'go to its step'}">
        ${cic(phase === 'done' ? 'bell' : 'timer', { size: 18 })}<b data-timer-clock="${t.id}">${fmtClock(timerLeft(t, now))}</b><span>${t.title}</span>
      </button>`;
    })}
  </div>`;
}

function readyScreen(app, t, p, s) {
  const settings = [];
  for (const r of p.recs) for (const e of equipmentSettings(r.recipe)) {
    const had = settings.find((x) => x.id === e.id);
    if (had) { for (const v of e.settings) if (!had.settings.includes(v)) had.settings.push(v); } else settings.push({ ...e, settings: [...e.settings] });
  }
  const temps = safeTemps(t.d);
  return html`<article class="cook-ready">
    <div class="cook-card">
      <h1 class="cook-dish">${t.d.title}</h1>
      ${when(p.recs.length > 1, () => html`<p class="cook-with">with ${listJoin(p.recs.slice(1).map((r) => midSentence(r.title)))}</p>`)}
      <ul class="facts cook-facts">
        ${when(p.tl.total, () => html`<li>${ic('clock', { size: 20 })}<span>About ${fmtMinutes(p.tl.total)} for the whole plate</span></li>`)}
        ${settings.map((e) => html`<li>${equipIcon(e.id, { size: 20 })}<span>${equipLabel(e.id)}${e.settings.length ? html`: <b>${e.settings.join(', ')}</b>` : ''}</span></li>`)}
      </ul>
      ${temps.map((x) => html`<p class="cook-temp">${cic('thermo', { size: 20 })}<span>${x.food}: <b>${x.temp}°F</b>, ${x.note}.</span></p>`)}
      ${when(t.date === app.today(), () => thawLine(app, app.today()))}
      <p class="muted small" data-wake>${'wakeLock' in navigator ? 'The screen stays on while you cook.' : 'This screen may dim while you cook: turn auto-lock up, or tap it now and then.'}</p>
    </div>
    ${when(!p.n, () => html`<p class="hint">${ic('info', { size: 18 })}<span>This recipe has no steps written down. Cook it your way, then tap Finish to mark it cooked.</span></p>`)}
    ${when(p.tl.tracks.length > 1, () => html`<section class="cook-plan" aria-labelledby="cook-plan-h">
      <h2 id="cook-plan-h" class="cook-sec-h">Timing the whole plate</h2>
      <ul class="cook-cues">${p.tl.cues.map((c) => html`<li><b>${c.title}.</b> ${c.text}</li>`)}</ul>
    </section>`)}
    <section class="cook-need" aria-labelledby="cook-need-h">
      <h2 id="cook-need-h" class="cook-sec-h">Get everything out</h2>
      <p class="muted small">Tap each one as it comes out.</p>
      ${p.recs.map((r) => {
        const check = pantryCheck(app.db, app.state, r.recipe.items);
        if (!check.rows.length) return '';
        return html`<h3 class="cook-need-h ${tone(r.id)}"><span class="cook-dot" aria-hidden="true"></span>${r.title}</h3>
          <ul class="cook-gather">${check.rows.map((row) => {
            const on = !!s.gathered[`${r.id}:${row.id}`];
            return html`<li><button type="button" class="cook-gather-row ${on ? 'is-on' : ''}" role="checkbox" aria-checked="${tf(on)}" data-action="cook:gather" data-id="${r.id}:${row.id}">
              <span class="cook-check" aria-hidden="true">${on ? ic('check', { size: 18 }) : ''}</span>
              <span class="cook-gather-name">${ingredientLabel(row.need, itemMeta(app.db, app.state, row.id))}${when(row.status !== 'have' && !row.staple, () => html`<small>${row.status === 'short' ? 'The pantry shows less than this' : 'Not in the pantry list'}</small>`)}</span>
            </button></li>`;
          })}</ul>`;
      })}
    </section>
  </article>`;
}

function stepScreen(app, t, p, s) {
  const step = p.tl.steps[s.i];
  const ings = p.ings[step.track]?.[step.index] || [];
  const next = p.tl.steps[s.i + 1];
  const custom = timerById(timerId(s, step, 'x'));
  return html`<article class="cook-step-card ${tone(step.track)}">
    <p class="cook-dish-tag"><span class="cook-dot" aria-hidden="true"></span><b>${step.title}</b></p>
    ${when(resumedKey === s.key, () => html`<p class="cook-resumed">${ic('undo', { size: 16 })}<span>Picked up where you left off.</span><button type="button" class="link-btn" data-action="cook:restart">Start over</button></p>`)}
    <p class="cook-step-text" id="cook-step-text" aria-live="polite">${step.text}</p>
    ${when(step.setting, () => html`<p class="cook-setting">${ic('flame', { size: 20 })}<span>${step.setting}</span></p>`)}
    ${when(ings.length, () => html`<ul class="cook-ings" aria-label="What this step uses, for five">${ings.map((x) => html`<li class="${x.again ? 'is-again' : ''}">${x.label}${x.again ? html`<span class="sr-only"> (already out)</span>` : ''}</li>`)}</ul>`)}
    <ul class="cook-timers" aria-label="Timers for this step">
      ${step.timers.map((t0, k) => (Number(t0.seconds) > 0 && Number(t0.seconds) < 30 ? '' : timerControl(app, s, step, k, t0)))}
      ${custom ? timerControl(app, s, step, 'x', { label: custom.label, per: null }) : ''}
      ${when(!custom, () => html`<li class="cook-timer is-idle"><button type="button" class="btn btn-quiet btn-small cook-timer-other" data-action="cook:timer-pick" data-key="${step.key}">${ic('plus', { size: 18 })}${step.timers.length ? 'Another timer' : 'Set a timer'}</button></li>`)}
    </ul>
  </article>
  ${next
    ? html`<p class="cook-upnext ${tone(next.track)}"><small>Next${next.track !== step.track ? html`, ${midSentence(next.title)}` : ''}</small><span>${next.text}</span></p>`
    : html`<p class="cook-upnext"><small>Next</small><span>That’s the last step. Plate it up.</span></p>`}`;
}

function finishScreen(app, t, p) {
  const today = app.today();
  const cooked = t.entry?.status === 'cooked';
  const left = t.date ? app.state.leftovers?.[t.date] : null;
  const temps = safeTemps(t.d);
  if (!t.date) {
    return html`<article class="cook-finish">
      <span class="cook-finish-ic" aria-hidden="true">${ic('checkCircle', { size: 44 })}</span>
      <h1 class="cook-dish">Dinner’s ready</h1>
      <p class="cook-with">${t.d.title}${p.recs.length > 1 ? ` with ${listJoin(p.recs.slice(1).map((r) => midSentence(r.title)))}` : ''}.</p>
      <p class="hint">${ic('info', { size: 18 })}<span>This one isn’t on tonight’s plan, so nothing came out of the pantry. Put it on tonight and it can be marked cooked.</span></p>
      <div class="cook-finish-acts">
        <button type="button" class="btn btn-primary btn-lg" data-action="rec:tonight" data-dinner="${t.d.id}">${ic('tonight', { size: 22 })}Make it tonight’s dinner</button>
        <a class="btn btn-secondary btn-lg" href="#/recipe/${t.d.id}" data-action="cook:exit" data-href="#/recipe/${t.d.id}">Back to the recipe</a>
      </div>
    </article>`;
  }
  if (!cooked) {
    const uses = cookedPreview(app.db, app.state, t.date);
    return html`<article class="cook-finish">
      <span class="cook-finish-ic" aria-hidden="true">${ic('checkCircle', { size: 44 })}</span>
      <h1 class="cook-dish">Dinner’s ready</h1>
      <p class="cook-with">${t.d.title}${p.recs.length > 1 ? ` with ${listJoin(p.recs.slice(1).map((r) => midSentence(r.title)))}` : ''}. Turn everything off, then plate it up.</p>
      ${temps.map((x) => html`<p class="cook-temp">${cic('thermo', { size: 20 })}<span>${x.food}: <b>${x.temp}°F</b>, ${x.note}.</span></p>`)}
      <div class="cook-finish-acts">
        <button type="button" class="btn btn-primary btn-lg" id="cook-done" data-action="cook:done" data-date="${t.date}">${ic('checkCircle', { size: 22 })}Mark cooked</button>
      </div>
      <p class="muted small cook-uses">${uses.length
        ? html`Marking it cooked takes what it used out of the pantry: ${listJoin(uses.slice(0, 6).map((u) => ingredientLabel(u.need, itemMeta(app.db, app.state, u.id))))}${uses.length > 6 ? `, and ${uses.length - 6} more` : ''}.`
        : 'Marking it cooked keeps the plan and the week’s summary right. Nothing measured in the pantry to take out.'}</p>
    </article>`;
  }
  return html`<article class="cook-finish">
    <span class="cook-finish-ic" aria-hidden="true">${ic('checkCircle', { size: 44 })}</span>
    <h1 class="cook-dish">Cooked. Enjoy.</h1>
    <p class="cook-with">${t.d.title} is marked cooked${t.date === today ? '' : ` for ${relativeDay(t.date, today).toLowerCase()}`}.</p>
    ${left
      ? html`<p class="status-note status-cooked">${ic('check', { size: 18 })}${left.saved ? `Leftovers saved: ${servingsText(left.saved)}.` : 'No leftovers.'}</p>
        <div class="cook-finish-acts"><a class="btn btn-primary btn-lg" id="cook-home" href="#/tonight" data-action="cook:exit" data-href="#/tonight">Back to Tonight</a></div>`
      : html`${leftoversQuestion(app, t.date, { then: '#/tonight' })}
        <p class="muted small">${leftoversNote(t.d)}</p>
        <div class="cook-finish-acts"><a class="btn btn-quiet" href="#/tonight" data-action="cook:exit" data-href="#/tonight">Ask me later</a></div>`}
  </article>`;
}

function emptyScreen(app, t) {
  const today = app.today();
  const night = t.date && t.date !== today ? relativeDay(t.date, today).toLowerCase() : 'tonight';
  const away = t.away;
  return html`<div class="cook cook-empty" style="--cook-scale:${prefs.size}">
    <header class="cook-bar"><a class="icon-btn" href="#/tonight" aria-label="Close cook mode">${ic('close')}</a><p class="cook-title">Cook mode</p></header>
    <div class="empty">
      <span class="empty-ic">${ic(away ? 'moon' : 'flame', { size: 28 })}</span>
      <h1 class="empty-title">${away ? (isLeftoverNight(t.entry) ? 'It’s a leftover night' : 'Nobody’s cooking that night') : app.route.params[0] === 'd' ? 'That recipe isn’t in the box' : `Nothing planned for ${night}`}</h1>
      <p class="empty-body">${away ? (isLeftoverNight(t.entry) ? 'Dinner is already in the fridge: reheat it until it’s steaming hot (165°F).' : 'The plan says not eating at home. Bring the night back from Tonight to cook.') : 'Pick a dinner first, then come back to cook it step by step.'}</p>
      <div class="empty-actions">
        ${when(!away && t.date, () => html`<button type="button" class="btn btn-primary" data-action="night:pick" data-date="${t.date}">Pick a dinner</button>`)}
        <a class="btn ${away || !t.date ? 'btn-primary' : 'btn-secondary'}" href="${t.date ? '#/tonight' : '#/recipes'}">${t.date ? 'Back to Tonight' : 'Open recipes'}</a>
      </div>
    </div>
  </div>`;
}

export function render(app) {
  appRef = app;
  const t = target(app);
  if (!t.d) return emptyScreen(app, t);
  const p = build(app, t);
  const s = sessionFor(`cook:${t.d.id}`, p.n);
  const exit = t.date ? '#/tonight' : `#/recipe/${t.d.id}`;
  const atReady = s.i < 0;
  const atFinish = s.i >= p.n;
  const step = !atReady && !atFinish ? p.tl.steps[s.i] : null;
  const where = t.date ? relativeDay(t.date, app.today()) : 'Recipe';
  const head = atReady ? 'Get ready' : atFinish ? 'All done' : `Step ${s.i + 1} of ${p.n}`;
  const pct = p.n ? Math.round((Math.max(0, Math.min(p.n, s.i + (atFinish ? 0 : 1))) / p.n) * 100) : atFinish ? 100 : 0;
  return html`<div class="cook cook-v3 ${atReady ? 'is-ready' : atFinish ? 'is-finish' : 'is-step'}" style="--cook-scale:${prefs.size}" data-key="${s.key}" data-step="${step ? step.key : atReady ? 'ready' : 'finish'}" data-n="${p.n}" data-arrow-keys="steps">
    <header class="cook-bar">
      <a class="icon-btn" href="${exit}" aria-label="Close cook mode. Your place is kept.">${ic('close')}</a>
      <p class="cook-title">${head}<small>${where}: ${t.d.title}</small></p>
      <span class="cook-tools">
        ${when(p.n, () => html`<button type="button" class="cook-tool" data-action="cook:steps" aria-label="All steps">${cic('steps')}<span aria-hidden="true">Steps</span></button>`)}
        <button type="button" class="cook-tool ${prefs.sound ? 'is-on' : ''}" data-action="cook:sound" aria-pressed="${tf(prefs.sound)}" aria-label="Timer sound">${cic('bell')}<span aria-hidden="true">${prefs.sound ? 'Sound' : 'Muted'}</span></button>
        <button type="button" class="cook-tool" data-action="cook:size" data-cycle="1" aria-label="Text size: ${SIZE_NAMES[sizeStep()]}. Tap for ${SIZE_NAMES[(sizeStep() + 1) % SIZES.length]}">${ic('textSize')}<span aria-hidden="true">${SIZE_NAMES[sizeStep()]}</span></button>
      </span>
    </header>
    <div class="cook-progress" role="progressbar" aria-label="${head}" aria-valuemin="0" aria-valuemax="${p.n}" aria-valuenow="${Math.max(0, Math.min(p.n, s.i + 1))}"><span style="width:${pct}%"></span></div>
    <div class="cook-stage" data-cook-scroll>
      <div class="cook-body">${atReady ? readyScreen(app, t, p, s) : atFinish ? finishScreen(app, t, p) : stepScreen(app, t, p, s)}</div>
    </div>
    ${dock(s, p, step)}
    <nav class="cook-nav" aria-label="Steps">
      ${atReady
        ? html`<a class="btn btn-secondary btn-lg cook-nav-back" id="cook-back" href="${exit}">${ic('left', { size: 22 })}<span>${t.date ? 'Tonight' : 'Recipe'}</span></a>`
        : html`<button type="button" class="btn btn-secondary btn-lg cook-nav-back" id="cook-back" data-action="cook:back">${ic('left', { size: 22 })}<span>Back</span></button>`}
      ${when(!atFinish, () => html`<button type="button" class="btn btn-primary btn-lg cook-nav-next" id="cook-next" data-action="cook:next"><span>${atReady ? (p.n ? 'Step 1' : 'Finish') : s.i === p.n - 1 ? 'Finish' : 'Next'}</span>${ic('right', { size: 22 })}</button>`)}
    </nav>
  </div>`;
}

// ---------------------------------------------------------------- after each render

let usedKeys = false; // someone is driving with keys or a remote
let lastScreen = null; // `${key}|${step}`: a new step starts at its top
let scrollTop = 0;

export function mount(app, main) {
  appRef = app;
  keepAwake(true);
  showWake();
  if (timers.length) startTicking();
  syncAlert();
  const root = main.querySelector('.cook[data-key]');
  if (!root) return;
  const stage = root.querySelector('[data-cook-scroll]');
  const screen = `${root.dataset.key}|${root.dataset.step}`;
  if (screen === lastScreen) stage.scrollTop = scrollTop;
  else { scrollTop = 0; lastScreen = screen; }
  stage.addEventListener('scroll', () => { scrollTop = stage.scrollTop; }, { passive: true });
  // Swipe left for the next step, right to go back (a sideways flick, not a scroll).
  let from = null;
  stage.addEventListener('touchstart', (ev) => { const p = ev.changedTouches[0]; from = ev.touches.length === 1 ? { x: p.clientX, y: p.clientY, at: Date.now() } : null; }, { passive: true });
  stage.addEventListener('touchend', (ev) => {
    if (!from) return;
    const p = ev.changedTouches[0];
    const dx = p.clientX - from.x;
    const dy = p.clientY - from.y;
    const quick = Date.now() - from.at < 800;
    from = null;
    if (!quick || Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 2) return;
    actions[dx < 0 ? 'cook:next' : 'cook:back'](app);
  }, { passive: true });
  // A remote or a keyboard has nothing to press until something has focus: start on "Next".
  // (Not on a touch screen, where a focus ring on a button nobody touched is only noise.)
  const touchOnly = !usedKeys && typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches;
  if (!touchOnly) {
    requestAnimationFrame(() => {
      const a = document.activeElement;
      if (!a || a === document.body || a.id === 'view') (document.getElementById('cook-next') || document.getElementById('cook-done') || document.getElementById('cook-home'))?.focus({ preventScroll: true });
    });
  }
  // "Picked up where you left off" has said its piece after a little while.
  if (resumedKey) setTimeout(() => { resumedKey = null; }, 20000);
}

// ---------------------------------------------------------------- actions

function here(app) {
  const t = target(app);
  if (!t.d) return null;
  const p = build(app, t);
  return { t, p, s: sessionFor(`cook:${t.d.id}`, p.n) };
}
function goTo(app, i) {
  const h = here(app);
  if (!h) return;
  const next = Math.max(-1, Math.min(h.p.n, i));
  if (next === h.s.i) return;
  h.s.i = next;
  resumedKey = null;
  saveSession();
  app.render();
}
function endSession(dinnerKey) {
  if (session?.key === dinnerKey) session = null;
  const s = read(LS.session, null);
  if (s?.key === dinnerKey) write(LS.session, null);
  timers = timers.filter((t) => !t.id.startsWith(`${dinnerKey}|`));
  saveTimers();
  syncAlert();
}

function startTimer(app, key, k, seconds, label) {
  const h = here(app);
  const step = h?.p.tl.steps.find((x) => x.key === key);
  if (!step) return;
  unlockAudio();
  const t0 = k === 'x' ? { seconds, label } : step.timers[Number(k)];
  if (!t0) return;
  const t = newTimer({ id: timerId(h.s, step, k), label: t0.label, seconds: t0.seconds, step: step.key, title: step.title, now: Date.now() });
  setTimer({ ...t, href: location.hash });
  app.render();
}

const PRESETS = [1, 2, 3, 5, 8, 10, 15, 20, 30, 45];

export const actions = {
  'cook:next': (app) => { const h = here(app); if (h) goTo(app, h.s.i + 1); },
  'cook:back': (app) => { const h = here(app); if (h) goTo(app, h.s.i - 1); },
  'cook:goto': (app, el) => { if (sheetOpen()) closeSheet(); goTo(app, Number(el.dataset.i)); },
  'cook:restart': (app) => {
    const h = here(app);
    if (!h) return;
    endSession(h.s.key);
    app.render();
  },
  'cook:gather': (app, el) => {
    const h = here(app);
    if (!h) return;
    h.s.gathered[el.dataset.id] = !h.s.gathered[el.dataset.id];
    saveSession();
    app.render();
  },
  'cook:order': (app, el) => {
    const h = here(app);
    const at = h && h.s.i >= 0 && h.s.i < h.p.n ? h.p.tl.steps[h.s.i].key : null;
    prefs.order = el.dataset.order === 'dish' ? 'dish' : 'together';
    write(LS.prefs, prefs);
    if (at) { const again = here(app); again.s.i = Math.max(0, again.p.tl.steps.findIndex((x) => x.key === at)); saveSession(); }
    app.render();
  },
  'cook:steps': (app) => {
    const h = here(app);
    if (!h) return;
    openSheet({
      id: 'cook:steps',
      size: 'tall',
      title: 'All the steps',
      subtitle: prefs.order === 'dish' ? 'One dish at a time. Tap a step to go to it.' : 'In the order to start them, so everything is ready together. Tap a step to go to it.',
      render: () => {
        const now = here(app) || h;
        return html`<ol class="cook-steps">${now.p.tl.steps.map((st, i) => {
          const done = i < now.s.i;
          return html`<li><button type="button" class="cook-step ${done ? 'is-done' : ''} ${i === now.s.i ? 'is-current' : ''} ${tone(st.track)}" data-action="cook:goto" data-i="${i}" ${i === now.s.i ? html`aria-current="step"` : ''}>
            <span class="cook-num" aria-hidden="true">${done ? ic('check', { size: 22 }) : i + 1}</span>
            <span class="cook-text"><small><span class="cook-dot" aria-hidden="true"></span>${st.title}${done ? ', done' : ''}</small>${st.text}</span>
          </button></li>`;
        })}</ol>`;
      },
    });
  },
  'cook:size': (app, el) => {
    // One button that steps through three sizes (gauntlet r2: −, Aa and + were three unlabeled icons).
    if (el.dataset.cycle) prefs.size = SIZES[(sizeStep() + 1) % SIZES.length];
    else prefs.size = Math.max(0.85, Math.min(1.6, Math.round((prefs.size + Number(el.dataset.delta)) * 100) / 100));
    write(LS.prefs, prefs);
    app.render();
  },
  'cook:sound': (app) => {
    prefs.sound = !prefs.sound;
    write(LS.prefs, prefs);
    if (prefs.sound) { unlockAudio(); beep(); }
    app.render();
  },
  'cook:timer': (app, el) => startTimer(app, el.dataset.key, el.dataset.k),
  'cook:timer-pick': (app, el) => {
    const key = el.dataset.key;
    openSheet({
      id: 'cook:timer',
      title: 'Set a timer',
      subtitle: 'It keeps counting while you move through the steps.',
      render: () => html`<div class="chip-grid cook-presets">${PRESETS.map((m) => html`<button type="button" class="chip chip-lg" data-action="cook:timer-new" data-key="${key}" data-minutes="${m}">${fmtMinutes(m)}</button>`)}</div>`,
    });
  },
  'cook:timer-new': (app, el) => {
    closeSheet();
    const m = Number(el.dataset.minutes) || 5;
    startTimer(app, el.dataset.key, 'x', m * 60, fmtMinutes(m));
  },
  'cook:timer-pause': (app, el) => { const t = timerById(el.dataset.id); if (t) { setTimer(pauseTimer(t, Date.now())); app.render(); } },
  'cook:timer-resume': (app, el) => { unlockAudio(); const t = timerById(el.dataset.id); if (t) { setTimer(resumeTimer(t, Date.now())); app.render(); } },
  'cook:timer-add': (app, el) => {
    unlockAudio();
    const t = timerById(el.dataset.id);
    if (!t) return;
    setTimer(addTime(t, Number(el.dataset.seconds) || 60, Date.now()));
    syncAlert();
    app.render();
  },
  'cook:timer-cancel': (app, el) => { dropTimer(el.dataset.id); app.render(); },
  // Answered: the timer is finished with (its step offers a fresh one, for the other side or the next batch).
  'cook:timer-ack': (app, el) => { dropTimer(el.dataset.id); app.render(); },
  'cook:timer-ack-all': (app) => {
    const now = Date.now();
    for (const t of timers.filter((x) => timerPhase(x, now) === 'done')) dropTimer(t.id);
    app.render();
  },
  /** Play / pause on a remote (or T): the step's first timer starts, pauses, or goes on. */
  'cook:timer-toggle': (app) => {
    const h = here(app);
    if (!h || h.s.i < 0 || h.s.i >= h.p.n) return;
    const step = h.p.tl.steps[h.s.i];
    if (!step.timers.length) return;
    const t = timerById(timerId(h.s, step, 0));
    const now = Date.now();
    if (!t || timerPhase(t, now) === 'done') { startTimer(app, step.key, 0); return; }
    setTimer(timerPhase(t, now) === 'paused' ? resumeTimer(t, now) : pauseTimer(t, now));
    app.render();
  },
  'cook:done': (app, el) => {
    // Stays on this screen: the leftovers question comes next.
    if (app.commit(markCookedOps(app.db, app.state, { date: el.dataset.date, who: app.who(), today: app.today() }))) app.render();
  },
  /** Leaving from the finish screen: the session is over, so next time starts at the top. */
  'cook:exit': (app, el) => {
    const h = here(app);
    if (h && h.s.i >= h.p.n) endSession(h.s.key);
    keepAwake(false);
    app.navigate(el.dataset.href || '#/tonight');
  },
};

/** Called when the leftovers question is answered from cook mode's finish screen. */
export function finishCooking(app) {
  const h = here(app);
  if (h) endSession(h.s.key);
  keepAwake(false);
}
