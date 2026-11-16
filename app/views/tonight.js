// TONIGHT (SPEC §22.1): the home screen. Tonight's dinner with one big "Start cooking", what to
// thaw or prep now, what needs using first (leftovers too), today's lunches, the week's dinners at
// a glance, and the rest of the week. On a TV-size screen it lays out as a kitchen display.
import { html, ic, when } from '../ui.js';
import { addDays, dateRange, longDay, money, relativeDay, rangeLabel, fmtQty, listJoin, hourIn, weekdayName, shortDate, midSentence, byLabel } from '../util.js';
import { dinnerById, periodRange, itemsForNight } from '../planner.js';
import { buildList, plannedNights } from '../shopping.js';
import { generateOps, markCookedOps, awayBlock } from '../actions.js';
import {
  sidesFor, dinnerPhoto, equipment, favoriteBadge, awayReason, dayStamp, nutri, showNutrition, lighterChip, rateList, isDismissed, replacedText, prepCard,
  plate, leanMark, whyList, cic, leftoversQuestion, isLeftoverNight,
} from './common.js';
import { dayNutrition, lighterSide, fmtKcal, lunchNutrition } from '../nutrition.js';
import { lunchPeople, lunchFor } from '../lunch.js';
import { useSoon } from '../freshness.js';
import { whyThisDinner, weekSummary, leftoversOnHand, leftoversToAsk, servingsText, useByText, leftoverNightChoices, plainName } from '../cooking.js';
import { openPick, openAway, openNight } from './sheets.js';
import { defaultAnchor } from './plan.js';
import { cookProgress } from './cook.js';

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
        </div>
      </div>
    </article>`;
  }
  const sides = sidesFor(app, d.id, e);
  const cooked = e.status === 'cooked';
  const why = cooked ? [] : whyThisDinner(app.db, app.state, d.id, e, { today });
  const going = cooked ? null : cookProgress(d.id);
  const left = app.state.leftovers?.[today];
  return html`<article class="hero ${cooked ? 'is-cooked' : ''}">
    <a class="hero-photo" href="#/recipe/${d.id}" aria-label="Open the recipe for ${d.title}">${dinnerPhoto(app, d, { size: 'hero', eager: true, alt: d.title })}</a>
    <div class="index-card">
      <p class="hero-kicker"><span class="dot" aria-hidden="true"></span>Tonight${cooked ? html`<span class="kicker-done">${ic('check', { size: 16 })}Cooked</span>` : ''}</p>
      <h1 class="hero-title">${d.title}</h1>
      ${when(d.subtitle, () => html`<p class="hero-sub">${d.subtitle}</p>`)}
      ${when(sides.length, () => html`<p class="hero-sides">with ${sides.map((s, i) => html`${i ? (i === sides.length - 1 ? ' and ' : ', ') : ''}<button type="button" class="link-side" data-action="side:sub" data-date="${today}" data-dinner="${d.id}" data-slot="${s.slot}" aria-label="${s.info?.title}. Substitute this side">${s.info?.title}</button>`)}</p>`)}
      ${sides.filter((x) => x.replaced).map((x) => html`<p class="hero-replaced">${x.info?.title}: ${replacedText(app, x).replace(/^In/, 'in')}.</p>`)}
      <div class="hero-meta">${equipment(d)}${favoriteBadge(app, d)}</div>
      ${when(showNutrition(app), () => html`<p class="hero-nutri">${nutri(app, plate(app, d.id, e), { suffix: 'a plate' })}</p>`)}
      <div class="hero-actions">
        ${cooked
          ? html`<p class="status-note status-cooked hero-done">${ic('checkCircle', { size: 18 })}<span>Cooked${byLabel(e.cookedBy) ? ` by ${byLabel(e.cookedBy)}` : ''}.${left ? (left.saved ? ` ${servingsText(left.saved)} of leftovers saved.` : ' No leftovers.') : ''}</span></p>
            <a class="btn btn-secondary" href="#/recipe/${d.id}">${ic('recipes', { size: 20 })}Open the recipe</a>`
          : html`<a class="btn btn-primary btn-lg" id="tonight-cook" href="#/cook/${today}">${ic('flame', { size: 20 })}${going ? `Keep cooking: step ${going.step} of ${going.of}` : 'Start cooking'}</a>
            <a class="btn btn-secondary" href="#/recipe/${d.id}">${ic('recipes', { size: 20 })}See the whole recipe</a>`}
      </div>
      ${whyList(why)}
      ${when(!cooked, () => {
        const idea = lighterSide(app.db, app.state, d.id, e);
        return idea ? lighterChip(app, {
          key: `side:${d.id}:${idea.slot}:${idea.to.id}`,
          text: `${idea.to.title} instead of ${idea.from.title}.`,
          why: showNutrition(app) ? `About ${fmtKcal(idea.saves)} fewer calories a plate, and it’s remembered for ${d.title}.` : `It’s remembered for ${d.title}.`,
          action: 'lighter:side', data: { dinner: d.id, slot: idea.slot, ref: idea.to.id }, label: 'Swap it',
        }) : '';
      })}
      ${when(!(cooked && howWasDate(app) === today), () => html`<div class="hero-rate">
        <p class="rate-h">Thumbs up: loved, a family favorite. Thumbs down: not for us, and it’s off the menu.</p>
        ${rateList(app, d, sides)}
      </div>`)}
      <div class="quick" role="group" aria-label="Tonight’s options">
        <button type="button" class="quick-btn" data-action="night:pick" data-date="${today}" ${cooked ? 'disabled' : ''}>${ic('swap')}<span>Swap</span></button>
        <button type="button" class="quick-btn" data-action="night:away" data-date="${today}" ${cooked ? 'disabled' : ''}>${ic('away')}<span>Not eating at home</span></button>
        ${cooked
          ? html`<button type="button" class="quick-btn" data-action="night:uncook" data-date="${today}">${ic('undo')}<span>Not cooked</span></button>`
          : html`<button type="button" class="quick-btn" data-action="tonight:cooked" data-date="${today}">${ic('checkCircle')}<span>Mark cooked</span></button>`}
      </div>
    </div>
  </article>`;
}

function weekAhead(app, today) {
  const dates = dateRange(addDays(today, 1), 6);
  const openCount = dates.filter((d) => !app.state.plan?.[d]?.dinner && app.state.plan?.[d]?.status !== 'away').length;
  return html`<section class="ahead" aria-labelledby="ahead-h">
    <div class="section-head">
      <h2 id="ahead-h" class="section-title">The rest of the week</h2>
      <a class="text-link" href="#/plan">Planner</a>
    </div>
    <ol class="menu-list">
      ${dates.map((date) => {
        const e = app.state.plan?.[date];
        const d = e?.dinner ? dinnerById(app.db, app.state, e.dinner) : null;
        const away = e?.status === 'away';
        const facts = d && !away && showNutrition(app) ? plate(app, d.id, e) : null;
        return html`<li><button type="button" class="menu-row ${away ? 'is-away' : ''} ${!d && !away ? 'is-open' : ''}" data-action="night:open" data-date="${date}">
          ${dayStamp(date, today)}
          <span class="menu-main">
            ${away ? html`<b>${awayReason(e).label}</b><small>${e.away?.note || 'Not eating at home'}</small>`
              : d ? html`<b>${d.title}</b><small>${listJoin(sidesFor(app, d.id, e).map((s) => s.info?.title))}</small>${facts ? html`<small class="menu-nutri">≈ ${fmtKcal(facts.kcal)} cal, ${Math.round(facts.protein)} g protein${leanMark(facts, { compact: true })}</small>` : ''}`
                : html`<b>Nothing planned</b><small>Tap to pick a dinner</small>`}
          </span>
          ${away ? html`<span class="menu-ic">${ic(isLeftoverNight(e) ? 'bowl' : 'moon', { size: 22 })}</span>` : d ? dinnerPhoto(app, d, { size: 'thumb' }) : html`<span class="menu-ic">${ic('plus', { size: 22 })}</span>`}
        </button></li>`;
      })}
    </ol>
    ${when(openCount >= 3, () => html`<button type="button" class="btn btn-secondary btn-block" data-action="tonight:plan-ahead">${ic('sparkle', { size: 20 })}Plan the open nights</button>`)}
  </section>`;
}

function glance(app) {
  const anchor = app.ui.anchor || defaultAnchor(app);
  const range = periodRange(anchor, app.settings.period, app.settings.weekStartsOn);
  const list = buildList(app.db, app.state, { dates: range.dates });
  if (!list.nights.length) return '';
  const big = list.freezer.filter((f) => f.dinners >= 2).slice(0, 2);
  return html`<section class="glance" aria-label="Groceries">
    <a class="glance-card" href="#/list">
      <span class="glance-ic">${ic('cart', { size: 24 })}</span>
      <span class="glance-main"><b>${money(list.total)}</b><small>estimated groceries for ${list.nights.length} ${list.nights.length === 1 ? 'dinner' : 'dinners'}, ${rangeLabel(range.start, range.end)}</small></span>
      ${ic('right', { size: 20 })}
    </a>
    ${big.map((f) => html`<p class="glance-note">${ic('snow', { size: 18 })}<span>${freezerNote(f)}</span></p>`)}
  </section>`;
}

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

// ---------------------------------------------------------------- use first: leftovers, then what's close to its date

/** The first planned dinner (next seven nights) that uses an ingredient. → "Wednesday’s chicken fajitas" | '' */
function plannedUse(app, id, today) {
  for (const n of plannedNights(app.db, app.state, dateRange(today, 7)).sort((a, b) => a.date.localeCompare(b.date))) {
    if (n.entry.status === 'cooked') continue;
    if (itemsForNight(app.db, app.state, n.entry.dinner, n.entry)[id]) {
      const t = dinnerById(app.db, app.state, n.entry.dinner)?.title || 'dinner';
      return `${n.date === today ? 'tonight’s' : n.date === addDays(today, 1) ? 'tomorrow’s' : `${weekdayName(n.date)}’s`} ${t}`;
    }
  }
  return '';
}

function useFirst(app, today) {
  const left = leftoversOnHand(app.state, today);
  const soon = useSoon(app.db, app.state, today).slice(0, 5);
  const more = useSoon(app.db, app.state, today).length - soon.length;
  return html`<section class="tcard use-first" aria-labelledby="use-h">
    <div class="section-head"><h2 id="use-h" class="section-title">${cic('box', { size: 22 })}Use first</h2><a class="text-link" href="#/pantry">Pantry</a></div>
    ${when(left.length, () => html`<ul class="lo-list">${left.map((l) => {
      const nights = l.night ? [] : leftoverNightChoices(app.state, l, today);
      return html`<li class="lo-row ${l.daysLeft < 0 ? 'is-late' : l.daysLeft <= 0 ? 'is-due' : ''}">
        <span class="lo-main"><b>${l.title}</b><small>Leftovers: ${servingsText(l.servings)}, ${useByText(l, today)}${l.night ? `. Set for ${l.night === today ? 'tonight' : weekdayName(l.night)}’s leftover night` : ''}.</small></span>
        <span class="lo-acts">
          ${when(l.daysLeft >= 0, () => html`<button type="button" class="btn btn-small btn-secondary" data-action="leftovers:ate" data-date="${l.date}" aria-label="Someone ate one serving of the ${l.title} leftovers">Ate one</button>`)}
          ${when(l.daysLeft >= 0 && l.servings >= 3 && nights.length, () => html`<button type="button" class="btn btn-small btn-secondary" data-action="leftovers:night" data-date="${l.date}">Leftover night…</button>`)}
          <button type="button" class="btn btn-small btn-quiet" data-action="leftovers:gone" data-date="${l.date}" aria-label="The ${l.title} leftovers are all gone">${l.daysLeft < 0 ? 'Tossed' : 'All gone'}</button>
        </span>
      </li>`;
    })}</ul>`)}
    ${soon.length ? html`<ul class="soon-list">${soon.map((u) => {
      const use = plannedUse(app, u.id, today);
      const by = u.daysLeft < 0 ? 'past its best' : u.daysLeft === 0 ? 'best today' : u.daysLeft === 1 ? 'best by tomorrow' : `best by ${weekdayName(u.useBy)}${u.daysLeft > 6 ? `, ${shortDate(u.useBy)}` : ''}`;
      return html`<li class="soon-row ${u.daysLeft < 0 ? 'is-late' : u.daysLeft <= 1 ? 'is-due' : ''}">
        <span class="soon-ic" aria-hidden="true">${ic(u.place === 'freezer' ? 'snow' : 'clock', { size: 18 })}</span>
        <span class="soon-main"><b>${plainName(u.name).replace(/^./, (c) => c.toUpperCase())}</b><small>In the ${u.place}, ${by}${use ? `. Going into ${use}` : '. Nothing planned uses it yet'}.</small></span>
      </li>`;
    })}</ul>${when(more > 0, () => html`<p class="muted small">And ${more} more in the <a href="#/pantry">pantry</a>.</p>`)}`
      : when(!left.length, () => html`<p class="muted small">Nothing in the fridge is close to its date, and there are no leftovers waiting. Estimates start the day groceries come home.</p>`)}
  </section>`;
}

// ---------------------------------------------------------------- today's lunches

function lunches(app, today) {
  if (!app.db.lunch?.available) return '';
  const people = lunchPeople(app.db, app.state).filter((p) => p.cfg.enabled);
  if (!people.length) return '';
  let date = today;
  let rows = people.map((p) => lunchFor(app.db, app.state, p.name, date)).filter(Boolean);
  // No lunches today (a weekend): show what gets packed tonight for tomorrow.
  if (!rows.length) { date = addDays(today, 1); rows = people.map((p) => lunchFor(app.db, app.state, p.name, date)).filter(Boolean); }
  if (!rows.length) return '';
  return html`<section class="tcard lunch-today" aria-labelledby="lt-h">
    <div class="section-head"><h2 id="lt-h" class="section-title">${ic('lunch', { size: 22 })}${date === today ? 'Today’s lunches' : 'Tomorrow’s lunches, to pack tonight'}</h2><a class="text-link" href="#/lunch">Lunch</a></div>
    <ul class="lt-list">${rows.map((l) => {
      const n = l.skip || l.empty ? null : lunchNutrition(app.db, l);
      const what = listJoin(l.slots.filter((s) => s.item).map((s, i) => (i ? midSentence(s.item.title) : s.item.title)));
      return html`<li class="lt-row">
        <b>${l.name}</b>
        <span class="lt-what">${l.skip ? `${l.reason || 'No packed lunch'} (nothing to pack)` : l.empty ? 'Nothing picked yet' : what}</span>
        ${when(n && showNutrition(app), () => html`<small class="lt-nutri">≈ ${fmtKcal(n.kcal)} cal, ${Math.round(n.protein)} g protein</small>`)}
      </li>`;
    })}</ul>
  </section>`;
}

// ---------------------------------------------------------------- the week's dinners, calmly

function weekCard(app, today) {
  const range = periodRange(today, 'week', app.settings.weekStartsOn);
  const w = weekSummary(app.db, app.state, range.dates);
  if (!w.home && !w.leftoverNights) return '';
  const show = showNutrition(app) && w.counted > 0;
  const tiles = [];
  if (show) tiles.push([`≈ ${fmtKcal(w.avgKcal)}`, 'calories, an average dinner plate']);
  if (show) tiles.push([`${Math.round(w.avgProtein)} g`, 'protein, an average plate']);
  tiles.push([`${w.withVeg} of ${w.home}`, `${w.home === 1 ? 'dinner has' : 'dinners have'} a vegetable or salad`]);
  tiles.push([String(w.home), `${w.home === 1 ? 'night' : 'nights'} cooking at home${w.cooked ? `, ${w.cooked} cooked so far` : ''}`]);
  const notes = [];
  if (show && w.lean) notes.push(`${w.lean} lean ${w.lean === 1 ? 'dinner' : 'dinners'}`);
  if (w.leftoverNights) notes.push(`${w.leftoverNights} leftover ${w.leftoverNights === 1 ? 'night' : 'nights'}`);
  if (w.away) notes.push(`${w.away} ${w.away === 1 ? 'night' : 'nights'} out`);
  if (w.open) notes.push(`${w.open} ${w.open === 1 ? 'night' : 'nights'} still open`);
  return html`<section class="tcard week-card" aria-labelledby="wk-h">
    <div class="section-head"><h2 id="wk-h" class="section-title">${ic('leaf', { size: 22 })}This week’s dinners</h2><span class="muted small">${rangeLabel(range.start, range.end)}</span></div>
    <dl class="week-stats">${tiles.map(([v, k]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>
    ${when(notes.length, () => html`<p class="muted small">${listJoin(notes).replace(/^./, (c) => c.toUpperCase())}.</p>`)}
    ${when(w.withVeg < w.home, () => html`<p class="muted small"><a href="#/plan">Add a vegetable to the ${w.home - w.withVeg === 1 ? 'one' : w.home - w.withVeg} without, on the Plan.</a></p>`)}
  </section>`;
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
        <p class="muted small">${d.title}, ${date === today ? 'tonight' : `last night (${weekdayName(date)})`}. Thumbs up for loved; thumbs down for not for us, and it’s off the menu.</p></div>
    </div>
    ${rateList(app, d, sides)}
    <div class="howwas-actions"><button type="button" class="btn btn-secondary btn-small" data-action="lighter:dismiss" data-key="howwas:${date}">Done</button></div>
  </section>`;
}

/** After a dinner is cooked (tonight, or last night): how many servings are left? Asked once. */
function leftoversAsk(app, today) {
  const date = leftoversToAsk(app.state, today);
  if (!date || isDismissed(app, `leftovers:${date}`)) return '';
  const d = dinnerById(app.db, app.state, app.state.plan[date].dinner);
  return html`<section class="tcard lo-card">
    ${leftoversQuestion(app, date, { heading: date === today ? 'Any leftovers tonight?' : 'Any leftovers from last night?', dish: d?.title || '' })}
    <button type="button" class="btn btn-small btn-quiet" data-action="lighter:dismiss" data-key="leftovers:${date}">Don’t ask</button>
  </section>`;
}

/**
 * Last night's dinner is still marked planned: was it cooked? Until someone says, the pantry
 * still counts food that's gone, and the list buys less than the week needs.
 */
function forgotCard(app, today) {
  const date = addDays(today, -1);
  const e = app.state.plan?.[date];
  const d = e?.status === 'planned' && e.dinner ? dinnerById(app.db, app.state, e.dinner) : null;
  if (!d || isDismissed(app, `forgot:${date}`)) return '';
  return html`<section class="tcard forgot-card" aria-labelledby="forgot-h">
    <h2 id="forgot-h" class="section-title">Did you cook last night?</h2>
    <p class="muted small"><b>${d.title}</b> was on the plan for ${weekdayName(date)} and isn’t marked cooked. Marking it takes what it used out of the pantry, so the shopping list stays right.</p>
    <div class="forgot-acts">
      <button type="button" class="btn btn-small btn-primary" data-action="night:cooked" data-date="${date}">${ic('checkCircle', { size: 18 })}Yes, mark it cooked</button>
      <button type="button" class="btn btn-small btn-secondary" data-action="night:move" data-date="${date}">No, move it to another night</button>
      <button type="button" class="btn btn-small btn-quiet" data-action="lighter:dismiss" data-key="forgot:${date}">We skipped it</button>
    </div>
  </section>`;
}

export function render(app) {
  const today = app.today();
  return html`<div class="page page-tonight">
    <p class="dateline">${longDay(today)}</p>
    ${when(howWasDate(app) !== today, () => howWas(app, today))}
    ${forgotCard(app, today)}
    ${todayLine(app, today)}
    <div class="tonight-grid">
      <div class="tonight-main">${hero(app, today)}${leftoversAsk(app, today)}${when(howWasDate(app) === today, () => howWas(app, today))}</div>
      <div class="tonight-side">
        ${prepCard(app, { days: 2, title: 'Thaw and prep now', empty: true, emptyText: 'Nothing to thaw or pack for tonight or tomorrow.' })}
        ${useFirst(app, today)}
        ${lunches(app, today)}
        ${weekCard(app, today)}
        ${weekAhead(app, today)}
        ${glance(app)}
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
