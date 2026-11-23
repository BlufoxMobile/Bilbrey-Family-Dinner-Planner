// TONIGHT (SPEC §22.1, docs/spec/29): the home screen, with one job: tonight's dinner and how to
// start it. Below it, only what needs you today: a dinner nobody marked cooked, leftovers, what to
// thaw or pack, and the weekly check-in on its day. Everything else lives on its own tab.
// On a TV-size screen it lays out as a kitchen display.
import { html, ic, when } from '../ui.js';
import { addDays, dateRange, longDay, money, relativeDay, rangeLabel, fmtQty, listJoin, hourIn, weekdayName, shortDate, midSentence, byLabel } from '../util.js';
import { dinnerById, periodRange, itemsForNight } from '../planner.js';
import { buildList, plannedNights } from '../shopping.js';
import { generateOps, markCookedOps, awayBlock } from '../actions.js';
import {
  sidesFor, dinnerPhoto, equipment, favoriteBadge, awayReason, dayStamp, nutri, showNutrition, lighterChip, rateList, isDismissed, replacedText, prepCard,
  plate, leanMark, whyList, cic, isLeftoverNight, leftoversAskCard, leftoverRows, costOf, costNote,
} from './common.js';
import { dayNutrition, lighterSide, fmtKcal, lunchNutrition } from '../nutrition.js';
import { lunchPeople, lunchFor } from '../lunch.js';
import { useSoon } from '../freshness.js';
import { whyThisDinner, weekSummary, leftoversOnHand, servingsText, useByText, plainName, plateRecipes, pantryCheck } from '../cooking.js';
import { easyTonight } from '../easy.js';
import { unitText } from '../shopping.js';
import { openPick, openAway, openNight } from './sheets.js';
import { defaultAnchor, catchUpCard } from './plan.js';
import { cookProgress } from './cook.js';
import { thawLine } from './common.js';
export { thawLine };
import { thawNow } from '../prep.js';
import { checkinCard } from './checkin.js';

export const title = () => 'Tonight';

function leftoverHero(app, today, e, d) {
  const from = e.away?.from;
  const l = from ? leftoversOnHand(app.state, today).find((x) => x.date === from) : null;
  return html`<article class="hero hero-away hero-leftover">
    <div class="away-card away-card-hero">
      <span class="away-ic">${ic('bowl', { size: 34 })}</span>
      <p class="hero-kicker"><span class="dot" aria-hidden="true"></span>Tonight</p>
      <h1 class="hero-title">Leftover night</h1>
      <p class="hero-sub">${e.away?.note || 'Dinner is already in the fridge.'}${l ? ` ${servingsText(l.servings).replace(/^./, (c) => c.toUpperCase())}, ${useByText(l, today)}.` : ''} Reheat it until it’s steaming hot all the way through (165°F).</p>
      <div class="hero-actions">
        ${when(l, () => html`<button type="button" class="btn btn-on-dusk" data-action="leftovers:gone" data-date="${from}">${ic('checkCircle', { size: 20 })}We ate them</button>`)}
        <button type="button" class="btn btn-quiet btn-on-dusk-quiet" data-action="night:back" data-date="${today}">${d ? `Cook ${d.title} after all` : 'Cook something after all'}</button>
      </div>
    </div>
  </article>`;
}

function hero(app, today) {
  const e = app.state.plan?.[today];
  const d = e?.dinner ? dinnerById(app.db, app.state, e.dinner) : null;
  if (isLeftoverNight(e)) return leftoverHero(app, today, e, d);
  if (e?.status === 'away') {
    const r = awayReason(e);
    const trip = awayBlock(app.state, today).filter((x) => x >= today);
    return html`<article class="hero hero-away">
      <div class="away-card away-card-hero">
        <span class="away-ic">${ic('moon', { size: 34 })}</span>
        <p class="hero-kicker"><span class="dot" aria-hidden="true"></span>Tonight</p>
        <h1 class="hero-title">${r.label}</h1>
        <p class="hero-sub">${e.away?.note || r.note} No dinner to cook at home${d ? `, and ${d.title.toLowerCase()} is off the list` : ''}.</p>
        <div class="hero-actions">
          ${trip.length > 1
            ? html`<button type="button" class="btn btn-on-dusk" data-action="night:back-trip" data-date="${today}">${ic('home', { size: 20 })}We’re home: bring back all ${trip.length} nights</button>
              <button type="button" class="btn btn-quiet btn-on-dusk-quiet" data-action="night:back" data-date="${today}">Just tonight</button>`
            : html`<button type="button" class="btn btn-on-dusk" data-action="night:back" data-date="${today}">${ic('home', { size: 20 })}${d ? `Bring back ${d.title}` : 'We’re home after all'}</button>`}
        </div>
      </div>
    </article>`;
  }
  if (!d) {
    return html`<article class="hero hero-empty">
      <div class="index-card">
        <p class="hero-kicker"><span class="dot" aria-hidden="true"></span>Tonight</p>
        <h1 class="hero-title">Nothing planned yet</h1>
        <p class="hero-sub">Plan the week in one tap, or pick tonight’s dinner yourself. Either way you get the recipe, the timing and the shopping list.</p>
        <div class="hero-actions">
          <button type="button" class="btn btn-primary btn-lg" data-action="tonight:plan-week">${ic('sparkle', { size: 20 })}Plan this week</button>
          <button type="button" class="btn btn-secondary" data-action="night:pick" data-date="${today}">Pick tonight’s dinner</button>
          <button type="button" class="btn btn-quiet" id="easy-open" data-action="easy:open" data-date="${today}">The easiest dinner in the house</button>
        </div>
      </div>
    </article>`;
  }
  const sides = sidesFor(app, d.id, e);
  const cooked = e.status === 'cooked';
  const going = cooked ? null : cookProgress(d.id);
  const left = app.state.leftovers?.[today];
  return html`<article class="hero ${cooked ? 'is-cooked' : ''}">
    <a class="hero-photo" href="#/recipe/${d.id}" aria-label="Open the recipe for ${d.title}">${dinnerPhoto(app, d, { size: 'hero', eager: true, alt: d.title })}</a>
    <div class="index-card">
      <p class="hero-kicker"><span class="dot" aria-hidden="true"></span>Tonight${cooked ? html`<span class="kicker-done">${ic('check', { size: 16 })}Cooked</span>` : ''}</p>
      <h1 class="hero-title">${d.title}</h1>
      ${when(sides.length, () => html`<p class="hero-sides">with ${listJoin(sides.map((s) => midSentence(s.info?.title || '')))}</p>`)}
      ${sides.filter((x) => x.replaced).map((x) => html`<p class="hero-replaced">${x.info?.title}: ${replacedText(app, x).replace(/^In/, 'in')}.</p>`)}
      <div class="hero-meta">${equipment(d)}${favoriteBadge(app, d)}</div>
      ${when(showNutrition(app), () => html`<p class="hero-nutri">${nutri(app, plate(app, d.id, e), { suffix: 'a plate' })}</p>`)}
      ${when(!cooked, () => thawLine(app, today))}
      ${when(!cooked, () => haveLine(app, d, e).html)}
      <div class="hero-actions">
        ${cooked
          ? html`<p class="status-note status-cooked hero-done">${ic('checkCircle', { size: 18 })}<span>Cooked${byLabel(e.cookedBy) ? ` by ${byLabel(e.cookedBy)}` : ''}.${left ? (left.saved ? ` ${servingsText(left.saved)} of leftovers saved.` : ' No leftovers.') : ''}</span></p>
            <a class="btn btn-secondary" href="#/recipe/${d.id}">${ic('recipes', { size: 20 })}Open the recipe</a>`
          : !going && haveLine(app, d, e).blocker
            ? html`<button type="button" class="btn btn-primary btn-lg" data-action="night:pick" data-date="${today}">${ic('swap', { size: 20 })}Change dinner</button>
              <a class="btn btn-secondary" id="tonight-cook" href="#/cook/${today}">${ic('flame', { size: 20 })}Start cooking anyway</a>`
            : html`<a class="btn btn-primary btn-lg" id="tonight-cook" href="#/cook/${today}">${ic('flame', { size: 20 })}${going ? `Keep cooking: step ${going.step} of ${going.of}` : 'Start cooking'}</a>`}
      </div>
      ${cooked
        ? html`<p class="hero-undo"><button type="button" class="btn btn-quiet btn-small" data-action="night:uncook" data-date="${today}">${ic('undo', { size: 18 })}Not cooked after all</button></p>`
        : html`<div class="quick" role="group" aria-label="Tonight’s options">
        ${when(going || !haveLine(app, d, e).blocker, () => html`<button type="button" class="quick-btn" data-action="night:pick" data-date="${today}">${ic('swap')}<span>Change dinner</span></button>`)}
        <button type="button" class="quick-btn" data-action="night:away" data-date="${today}">${ic('away')}<span>Not eating at home</span></button>
        <button type="button" class="quick-btn" data-action="tonight:cooked" data-date="${today}">${ic('checkCircle')}<span>Mark cooked</span></button>
      </div>
      ${when(easyReady(app, today), () => html`<p class="easy-ask"><button type="button" class="link-btn" id="easy-open" data-action="easy:open" data-date="${today}">Low on energy? Easier dinners in the house</button></p>`)}`}
    </div>
  </article>`;
}

/**
 * Can tonight happen from what's in the house? (gauntlet r2: the counter is the wrong place to find
 * out.) "Everything's in the house", or what's missing, shortfalls included.
 */
function haveLine(app, d, e) {
  const miss = plateRecipes(app.db, app.state, d.id, e).flatMap((r) => pantryCheck(app.db, app.state, r.recipe.items).missing).filter((m) => !m.staple);
  const seen = new Set();
  const words = miss.filter((m) => !seen.has(m.id) && seen.add(m.id)).map((m) => (m.status === 'short' && m.short ? `${unitText(m.short, m.unit)} more ${plainName(m.name).toLowerCase()}` : plainName(m.name).toLowerCase()));
  if (!words.length) return { short: false, html: html`<p class="hero-have is-ok">${ic('checkCircle', { size: 18 })}<span>Everything’s in the house.</span></p>` };
  // The meat isn't there, or three things or more: changing dinner is the likelier next step (gauntlet r4).
  const blocker = miss.some((m) => app.db.ingredients[m.id]?.meat) || seen.size >= 3;
  return { short: true, blocker, html: html`<p class="hero-have is-short">${ic('cart', { size: 18 })}<span><b>Not in the house:</b> ${listJoin(words.slice(0, 4))}${words.length > 4 ? ` and ${words.length - 4} more` : ''}.</span></p>` };
}

/** Easy tonight is offered only when it has something real to show: a dinner that needs no store. */
function easyReady(app, today) {
  try { return easyTonight(app.db, app.state, today, { hour: hourIn(new Date()), limit: 12 }).picks.some((p) => p.ready); } catch { return false; }
}

/** "Still frozen? Thaw the 2 lb lean ground beef in cold water now, about 1 hr." Right above Start cooking. */
const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

/** "Lean ground beef: one 10¾ lb pack covers all 5 dinners, with 0.24 lb left over." */
export function freezerNote(f) {
  const n = f.packs > 0 ? (COUNT_WORDS[f.packs] || String(f.packs)) : '';
  const pack = f.packs > 0 ? `${n} ${f.packSize ? `${fmtQty(f.packSize)} ${f.unit} ` : ''}${f.packs === 1 ? 'pack' : 'packs'}` : '';
  const stash = f.have > 0 ? `${fmtQty(f.have)} ${f.unit} in the freezer` : '';
  if (!pack && !stash) return `${f.name} goes into ${f.dinners} dinners.`;
  const what = pack && stash ? `${pack} plus the ${stash}` : pack || `the ${stash}`;
  const verb = f.packs > 1 || (pack && stash) ? 'cover' : 'covers';
  const which = f.covers === f.dinners ? (f.dinners === 2 ? 'both dinners' : `all ${f.dinners} dinners`) : `${f.covers} of ${f.dinners} dinners`;
  return `${f.name}: ${what} ${verb} ${which}${f.leftover > 0 ? `, with ${fmtQty(f.leftover)} ${f.unit} left over` : ''}.`;
}

function todayLine(app, today) {
  const who = app.todayFor?.(); // one shared profile: this device's pick in Family & settings, or nobody
  if (!who || !showNutrition(app)) return '';
  const n = dayNutrition(app.db, app.state, who, today);
  if (!n) return '';
  const from = n.lunch && n.dinner ? 'lunch and dinner' : n.lunch ? 'lunch' : 'dinner';
  return html`<p class="today-nutri">Today for ${who}: about <b>${fmtKcal(n.kcal)}</b> calories and <b>${Math.round(n.protein)} g</b> protein from ${from}.<small>Breakfast and snacks aren’t counted.${n.complete ? '' : ' A few ingredients have no calorie data yet.'}</small></p>`;
}

/**
 * "How was dinner?" (SPEC §9.2): the evening a night is marked cooked, and the next morning,
 * for the phone's person, until they wave it off. → the date it's about, or null.
 */
export function howWasDate(app, now = new Date()) {
  const who = app.who();
  if (!who) return null;
  const today = app.today();
  const plan = app.state.plan || {};
  const yesterday = addDays(today, -1);
  const pick = plan[today]?.status === 'cooked' ? today : plan[yesterday]?.status === 'cooked' && hourIn(now) < 12 ? yesterday : null;
  if (!pick || !plan[pick]?.dinner || !dinnerById(app.db, app.state, plan[pick].dinner)) return null;
  return isDismissed(app, `howwas:${pick}`) ? null : pick;
}

function howWas(app, today) {
  const date = howWasDate(app);
  if (!date) return '';
  const e = app.state.plan[date];
  const d = dinnerById(app.db, app.state, e.dinner);
  const sides = sidesFor(app, d.id, e);
  return html`<section class="howwas" aria-labelledby="hw-h">
    <div class="howwas-head">
      ${dinnerPhoto(app, d, { size: 'thumb' })}
      <div><h2 id="hw-h" class="section-title">How was dinner?</h2>
        <p class="muted small">${d.title}, ${date === today ? 'tonight' : `last night (${weekdayName(date)})`}.</p></div>
    </div>
    ${rateList(app, d, sides)}
    <div class="howwas-actions"><button type="button" class="btn btn-secondary btn-small" data-action="lighter:dismiss" data-key="howwas:${date}">Done</button></div>
  </section>`;
}

export function render(app) {
  const today = app.today();
  const left = leftoverRows(app);
  return html`<div class="page page-tonight">
    <p class="dateline">${longDay(today)}</p>
    <div class="tonight-grid">
      <div class="tonight-main">
        ${hero(app, today)}
        ${(() => { const ask = leftoversAskCard(app) || (howWasDate(app) ? howWas(app, today) : ''); return ask || catchUpCard(app, { compact: true }); })()}
        ${when(left, () => html`<section class="tcard left-fridge" aria-labelledby="left-h"><h2 id="left-h" class="section-title">${ic('bowl', { size: 22 })}<span>Leftovers in the fridge</span></h2>${left}</section>`)}
      </div>
      <div class="tonight-side">
        ${prepCard(app, { days: 1, title: 'Thaw & prep', empty: false, skip: ['use'], skipTonightThaw: true })}
        ${checkinCard(app)}
        ${todayLine(app, today)}
      </div>
    </div>
  </div>`;
}

export const actions = {
  'tonight:plan-week': (app) => {
    const today = app.today();
    const range = periodRange(today, 'week', app.settings.weekStartsOn);
    const dates = range.dates.filter((d) => d >= today);
    if (dates.length < 4) dates.push(...periodRange(addDays(range.start, 7), 'week', app.settings.weekStartsOn).dates);
    app.commit(generateOps(app.db, app.state, { dates, who: app.who(), today, seedKey: range.start }));
  },
  'tonight:plan-ahead': (app) => {
    const today = app.today();
    const dates = dateRange(today, 7);
    app.commit(generateOps(app.db, app.state, { dates, who: app.who(), today, seedKey: periodRange(today, 'week', app.settings.weekStartsOn).start }));
  },
  'tonight:cooked': (app, el) => app.commit(markCookedOps(app.db, app.state, { date: el.dataset.date, who: app.who(), today: app.today() })),
};

export { openPick, openAway, openNight, relativeDay };
