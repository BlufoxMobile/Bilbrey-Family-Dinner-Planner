// TONIGHT: tonight's dinner on its index card, quick actions, then the week ahead.
import { html, ic, when, emptyState } from '../ui.js';
import { addDays, dateRange, longDay, money, relativeDay, rangeLabel, fmtQty, listJoin, hourIn, weekdayName } from '../util.js';
import { dinnerById, periodRange } from '../planner.js';
import { buildList } from '../shopping.js';
import { generateOps, markCookedOps, awayBlock } from '../actions.js';
import { sidesFor, dinnerPhoto, equipment, favoriteBadge, awayReason, dayStamp, nutri, showNutrition, lighterChip, rateList, isDismissed, replacedText } from './common.js';
import { plateNutrition, dayNutrition, lighterSide, fmtKcal } from '../nutrition.js';
import { openPick, openAway, openNight } from './sheets.js';
import { defaultAnchor } from './plan.js';

export const title = () => 'Tonight';

function hero(app, today) {
  const e = app.state.plan?.[today];
  const d = e?.dinner ? dinnerById(app.db, app.state, e.dinner) : null;
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
        <p class="hero-sub">Plan the week in one tap, or pick tonight’s dinner yourself.</p>
        <div class="hero-actions">
          <button type="button" class="btn btn-primary btn-lg" data-action="tonight:plan-week">${ic('sparkle', { size: 20 })}Plan this week</button>
          <button type="button" class="btn btn-secondary" data-action="night:pick" data-date="${today}">Pick tonight’s dinner</button>
        </div>
      </div>
    </article>`;
  }
  const sides = sidesFor(app, d.id, e);
  const cooked = e.status === 'cooked';
  return html`<article class="hero ${cooked ? 'is-cooked' : ''}">
    <a class="hero-photo" href="#/recipe/${d.id}" aria-label="Open the recipe for ${d.title}">${dinnerPhoto(app, d, { size: 'hero', eager: true, alt: d.title })}</a>
    <div class="index-card">
      <p class="hero-kicker"><span class="dot" aria-hidden="true"></span>Tonight${cooked ? html`<span class="kicker-done">${ic('check', { size: 16 })}Cooked</span>` : ''}</p>
      <h1 class="hero-title">${d.title}</h1>
      ${when(d.subtitle, () => html`<p class="hero-sub">${d.subtitle}</p>`)}
      ${when(sides.length, () => html`<p class="hero-sides">with ${sides.map((s, i) => html`${i ? (i === sides.length - 1 ? ' and ' : ', ') : ''}<button type="button" class="link-side" data-action="side:sub" data-date="${today}" data-dinner="${d.id}" data-slot="${s.slot}" aria-label="${s.info?.title}. Substitute this side">${s.info?.title}</button>`)}</p>`)}
      ${sides.filter((x) => x.replaced).map((x) => html`<p class="hero-replaced">${x.info?.title}: ${replacedText(app, x).replace(/^In/, 'in')}.</p>`)}
      <div class="hero-meta">${equipment(d)}${favoriteBadge(app, d)}</div>
      ${when(showNutrition(app), () => html`<p class="hero-nutri">${nutri(app, plateNutrition(app.db, app.state, d.id, e), { suffix: 'a plate' })}</p>`)}
      ${when(!cooked, () => {
        const idea = lighterSide(app.db, app.state, d.id, e);
        return idea ? lighterChip(app, {
          key: `side:${d.id}:${idea.slot}:${idea.to.id}`,
          text: `${idea.to.title} instead of ${idea.from.title}.`,
          why: showNutrition(app) ? `About ${fmtKcal(idea.saves)} fewer calories a plate, and it’s remembered for ${d.title}.` : `It’s remembered for ${d.title}.`,
          action: 'lighter:side', data: { dinner: d.id, slot: idea.slot, ref: idea.to.id }, label: 'Swap it',
        }) : '';
      })}
      <div class="hero-actions">
        <a class="btn btn-primary btn-lg" href="#/cook/${today}">${ic('flame', { size: 20 })}Start cooking</a>
      </div>
      ${when(!(cooked && howWasDate(app) === today), () => html`<div class="hero-rate">
        <p class="rate-h">Thumbs up keeps it coming. One thumbs down from anyone takes it off the menu.</p>
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
        return html`<li><button type="button" class="menu-row ${away ? 'is-away' : ''} ${!d && !away ? 'is-open' : ''}" data-action="night:open" data-date="${date}">
          ${dayStamp(date, today)}
          <span class="menu-main">
            ${away ? html`<b>${awayReason(e).label}</b><small>${e.away?.note || 'Not eating at home'}</small>`
              : d ? html`<b>${d.title}</b><small>${listJoin(sidesFor(app, d.id, e).map((s) => s.info?.title))}</small>`
                : html`<b>Nothing planned</b><small>Tap to pick a dinner</small>`}
          </span>
          ${away ? html`<span class="menu-ic">${ic('moon', { size: 22 })}</span>` : d ? dinnerPhoto(app, d, { size: 'thumb' }) : html`<span class="menu-ic">${ic('plus', { size: 22 })}</span>`}
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
  const who = app.who();
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
        <p class="muted small">${d.title}, ${date === today ? 'tonight' : `last night (${weekdayName(date)})`}. Thumbs up keeps it coming; one thumbs down and it’s off the menu.</p></div>
    </div>
    ${rateList(app, d, sides)}
    <div class="howwas-actions"><button type="button" class="btn btn-secondary btn-small" data-action="lighter:dismiss" data-key="howwas:${date}">Done</button></div>
  </section>`;
}

export function render(app) {
  const today = app.today();
  return html`<div class="page page-tonight">
    <p class="dateline">${longDay(today)}</p>
    ${when(howWasDate(app) !== today, () => howWas(app, today))}
    ${todayLine(app, today)}
    <div class="tonight-grid">
      <div class="tonight-main">${hero(app, today)}${when(howWasDate(app) === today, () => howWas(app, today))}</div>
      <div class="tonight-side">${weekAhead(app, today)}${glance(app)}</div>
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
