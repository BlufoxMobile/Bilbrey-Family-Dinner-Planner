// RECIPE (SPEC §22.2): a page worth cooking from. The photo, why it's on the plan, how long it
// takes, the equipment and its settings, ingredients for five against the pantry, the whole plate
// timed together, detailed steps, each side's own method, tips, safe temperatures, leftovers and
// nutrition per plate. Then the family's signal (loved / not for us), and joining or rejoining the rotation.
import { html, ic, when, openSheet, tf } from '../ui.js';
import { addDays, datesBetween, relativeDay, shortDate, dayWord, dayAndDate, listJoin, money, hourIn } from '../util.js';
import { isSlowCooked } from '../health.js';
import { dinnerById, isRetired, isPromoted, isFavorite, findInPlan, implicitPromotions } from '../planner.js';
import { settingsOf } from '../state.js';
import { voteOps, restoreOps, promoteOps } from '../actions.js';
import { unitText } from '../shopping.js';
import {
  sidesFor, dinnerPhoto, sidePhoto, favoriteBadge, awayReason, nutri, showNutrition, lighterChip, thumbs, replacedNote,
  plate, leanMark, cic, equipIcon, equipLabel, whyList, timelineChart, plateGuide, isDismissed, costOf, costNote,
} from './common.js';
import { costLine } from '../cost.js';
import { entreeNutrition, sideNutrition, lighterSide, fmtKcal, LEAN_RULE } from '../nutrition.js';
import {
  recipeTimes, recipeTips, leftoversNote, fmtMinutes, stepDetails, equipmentSettings, safeTemps, plateRecipes, cookTracks, cookTimeline,
  stepIngredients, pantryCheck, whyThisDinner, plainName,
} from '../cooking.js';
import { place } from './sheets.js';
import { cookProgress } from './cook.js';

export const title = (app) => dinnerById(app.db, app.state, app.route.params[0])?.title || 'Recipe';

const PLATE_GUIDE_KEY = 'plate-guide';
const STORE_NAMES = { sams: 'Sam’s Club', jewel: 'Jewel-Osco' };
const upFirst = (t) => String(t || '').replace(/^./, (c) => c.toUpperCase());

/**
 * What the dinner costs, ingredient by ingredient (docs/spec/24 §24.7): the amount used times the
 * pack's price per unit, at the store the list would buy it from, dearest first. "est." marks a
 * price nobody has paid or checked yet. Bulk meat says how the Sam's pack is portioned.
 */
function costDetail(app, cost) {
  if (!cost || !(cost.total > 0)) return '';
  const bulk = cost.items.map((r) => ({ r, ing: app.db.ingredients[r.id] })).filter(({ ing }) => ing?.bulk?.note && ing.meat);
  return html`<details class="cost-detail" id="recipe-cost">
    <summary><span class="cost-sum"><b>What it costs</b><small>${costLine(cost)}</small></span></summary>
    <ul class="cost-items">${cost.items.map((r) => html`<li>
      <span class="ci-name">${upFirst(plainName(r.name))}<small>${unitText(r.qty, r.unit)}${STORE_NAMES[r.store] ? `, ${STORE_NAMES[r.store]}` : ''}</small></span>
      <span class="ci-cost">${r.cost == null ? html`<small>no price yet</small>` : html`${money(r.cost)}${r.estimated ? html`<small>est.</small>` : ''}`}</span>
    </li>`)}
      <li class="ci-total"><span class="ci-name">For five</span><span class="ci-cost">${money(cost.total)}</span></li>
    </ul>
    <p class="muted small">Each line is the amount this dinner uses, at that pack’s price: a 10-lb bag isn’t charged to one dinner.${cost.estimated ? ' Prices marked est. are estimates until a receipt or a price check replaces them.' : ''}</p>
    ${bulk.map(({ r, ing }) => html`<p class="cost-bulk">${ic('snow', { size: 18 })}<span><b>${upFirst(plainName(r.name))}</b> ${ing.bulk.freezes ? 'comes in a Sam’s bulk pack.' : 'comes in a big Sam’s pack.'} ${ing.bulk.note}</span></p>`)}
  </details>`;
}

/** Ingredients for five, each with whether it's already in the house. */
export function ingredients(app, items, { check = true } = {}) {
  const lighter = settingsOf(app.state).meatScale !== 1;
  const rows = pantryCheck(app.db, app.state, items).rows;
  return html`<ul class="ingredients ${check ? 'ingredients-check' : ''}">${rows.map((r) => {
    const light = lighter && app.db.ingredients[r.id]?.meat;
    // Only what's missing gets words (gauntlet r1); what's in the house gets a quiet check.
    const state = r.status === 'have' ? 'In the pantry' : r.status === 'short' ? `Need ${unitText(r.short, r.unit)} more` : 'Need to buy';
    return html`<li class="ing ing-${r.status}">
      <span class="ing-amt">${r.amount}</span>
      <span class="ing-name">${r.name}${light ? html` <span class="tag">lighter</span>` : ''}</span>
      ${check ? html`<span class="ing-state">${r.status === 'have' ? html`${ic('check', { size: 16 })}<span class="sr-only">${state}</span>` : html`<span>${state}</span>`}</span>` : ''}
    </li>`;
  })}</ul>`;
}

function votes(app, d) {
  // One shared profile (docs/spec/20): one signal for the whole family — loved, fine (neither), or not for us.
  const mine = isRetired(app.state, d.id) ? -1 : isFavorite(app.state, d) ? 1 : 0;
  return html`<section class="votes" aria-labelledby="votes-h">
    <h2 id="votes-h" class="section-title">What the family thinks</h2>
    <div class="vote-mine" role="group" aria-label="What the family thinks of ${d.title}">
      <button type="button" class="btn vote-btn ${mine === 1 ? 'is-on' : ''}" aria-pressed="${tf(mine === 1)}" data-action="vote:dinner" data-id="${d.id}" data-value="1">${ic('up_vote', { size: 20 })}Loved</button>
      <button type="button" class="btn vote-btn vote-down ${mine === -1 ? 'is-on' : ''}" aria-pressed="${tf(mine === -1)}" data-action="vote:dinner" data-id="${d.id}" data-value="-1">${ic('down_vote', { size: 20 })}Not for us</button>
    </div>
    <p class="muted small">${mine === 1 ? 'A family favorite: it gets planned more often. Tap Loved again to go back to fine.'
      : mine === -1 ? 'Off the menu, and a dinner from the bench took its place. Tap “Not for us” again to bring this one back.'
        : 'Loved makes it a family favorite, planned more often. Not for us takes it off the menu and brings in a dinner from the bench; it waits in Recipes, Dropped, if you change your minds.'}</p>
  </section>`;
}

/** Prep, cook and total; or just the total when that's all the recipe knows. */
function timeStrip(d, tl) {
  const t = recipeTimes(d);
  const cells = [];
  if (t.prep) cells.push(['Prep', fmtMinutes(t.prep)]);
  if (t.cook) cells.push(['Cook', fmtMinutes(t.cook)]);
  if (t.total) cells.push([t.prep || t.cook ? 'Total' : 'Start to finish', fmtMinutes(t.total)]);
  if (tl.tracks.length > 1 && tl.total && tl.total !== t.total) cells.push(['With the sides', fmtMinutes(tl.total)]);
  if (!cells.length) return '';
  return html`<dl class="time-strip">${cells.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>`;
}

/** One numbered step: what to do, the heat, how long, and the amounts it uses. */
function stepItem(st, ings) {
  return html`<li class="step">
    <p class="step-text">${st.text}</p>
    ${when(st.setting || st.timers.length, () => html`<p class="step-chips">
      ${when(st.setting, () => html`<span class="step-chip step-chip-heat">${ic('flame', { size: 15 })}${st.setting}</span>`)}
      ${st.timers.map((t) => html`<span class="step-chip">${cic('timer', { size: 15 })}${t.label}</span>`)}
    </p>`)}
    ${when(ings?.length, () => html`<p class="step-ings"><span class="sr-only">Uses: </span>${ings.filter((x) => !x.again).map((x) => x.label).join(' · ')}</p>`)}
  </li>`;
}

function nutritionSection(app, d, entry, sides, facts) {
  if (!showNutrition(app)) return '';
  const main = entreeNutrition(app.db, app.state, d.id);
  const rows = [['The dinner', main], ...sides.map((s) => [s.info?.title || 'Side', sideNutrition(app.db, app.state, s.parsed)])];
  const more = facts ? [['Carbs', facts.carbsG], ['Fat', facts.fatG], ['Fiber', facts.fiberG]].filter(([, v]) => Number.isFinite(v)) : [];
  return html`<section class="recipe-nutrition" aria-labelledby="nutri-h">
    <h2 id="nutri-h" class="section-title">Nutrition, one plate</h2>
    ${facts ? html`<p class="nutri-big"><span><b>≈ ${fmtKcal(facts.kcal)}</b> calories</span><span><b>${Math.round(facts.protein)} g</b> protein</span>${more.map(([k, v]) => html`<span><b>${Math.round(v)} g</b> ${k.toLowerCase()}</span>`)}${leanMark(facts)}</p>`
      : html`<p class="muted">No calorie data for this one yet.</p>`}
    ${when(facts?.lean, () => html`<p class="muted small">Why it’s marked lean: a plate is ${fmtKcal(LEAN_RULE.maxKcal)} calories or less with at least ${LEAN_RULE.minProteinG} g of protein.</p>`)}
    <table class="nutri-table">
      <thead><tr><th scope="col">On the plate</th><th scope="col">Calories</th><th scope="col">Protein</th></tr></thead>
      <tbody>${rows.map(([name, n]) => html`<tr><th scope="row">${name}</th><td>${n ? fmtKcal(n.kcal) : '—'}</td><td>${n ? `${Math.round(n.protein)} g` : '—'}</td></tr>`)}</tbody>
    </table>
    <p class="muted small">One of five equal, adult-size plates, worked out from the ingredients (USDA figures). Real plates vary, and that’s fine.${facts && facts.complete === false ? ' A few ingredients have no data yet and aren’t counted.' : ''}</p>
  </section>`;
}

export function render(app) {
  const id = app.route.params[0];
  const d = dinnerById(app.db, app.state, id);
  if (!d) {
    return html`<div class="page"><a class="back" href="#/recipes">${ic('left', { size: 20 })}Recipes</a>
      <div class="empty"><h1 class="empty-title">That recipe isn’t in the box</h1><p class="empty-body">It may have been renamed or removed. Browse the recipe box instead.</p><div class="empty-actions"><a class="btn btn-primary" href="#/recipes">Open recipes</a></div></div></div>`;
  }
  const today = app.today();
  const retired = isRetired(app.state, d.id);
  const bench = d.rotation === 'bench' && !isPromoted(app.state, d.id) && !retired && !implicitPromotions(app.db, app.state).has(d.id);
  const where = findInPlan(app.state, d.id, { from: today });
  // The night it's next planned decides the sides (a one-night swap shows here too).
  const nightOf = where[0] || null;
  const entry = nightOf ? app.state.plan[nightOf] : null;
  const isTonight = nightOf === today;
  const cookedTonight = isTonight && entry?.status === 'cooked';
  const sides = sidesFor(app, d.id, entry);
  const facts = showNutrition(app) ? plate(app, d.id, entry) : null;
  const cost = costOf(app, d.id, entry);
  const recs = plateRecipes(app.db, app.state, d.id, entry);
  const tl = cookTimeline(cookTracks(recs));
  const steps = stepDetails(d);
  const stepIngs = stepIngredients(app.db, app.state, d.items, steps);
  const gear = equipmentSettings(d);
  const temps = safeTemps(d);
  const tips = recipeTips(d);
  const need = recs.map((r) => pantryCheck(app.db, app.state, r.recipe.items));
  const total = need.reduce((n, c) => n + c.total, 0);
  const missing = need.flatMap((c) => c.missing);
  const going = cookProgress(d.id);
  const cookHref = isTonight ? `#/cook/${today}` : `#/cook/d/${d.id}`;
  const cookLabel = going ? `Keep cooking: step ${going.step} of ${going.of}` : 'Start cooking';
  // Can it still be on the table by about 7:45 tonight? A slow-cooker dinner needs the morning.
  const nowMin = hourIn(new Date()) * 60 + new Date().getMinutes();
  const late = !isTonight && (isSlowCooked(d) ? hourIn(new Date()) >= 11 : nowMin + (Number(d.minutes) || 0) > 19 * 60 + 45);
  return html`<div class="page page-recipe">
    <a class="back" href="#/recipes">${ic('left', { size: 20 })}Recipes</a>
    <div class="recipe-top">
      <div class="recipe-photo">${dinnerPhoto(app, d, { size: 'hero', eager: true, alt: d.title })}</div>
      <div class="recipe-head">
        <p class="recipe-kicker">${d.category}${d.protein && d.protein !== 'mixed' ? `, ${d.protein}` : ''}${d.custom ? ', a family recipe' : ''}</p>
        <h1 class="recipe-title">${d.title}</h1>
        ${when(d.subtitle, () => html`<p class="recipe-sub">${d.subtitle}</p>`)}
        ${timeStrip(d, tl)}
        ${when(showNutrition(app), () => html`<p class="recipe-nutri">${nutri(app, facts, { suffix: sides.length ? `a plate with ${sides.length === 1 ? 'its side' : 'both sides'}` : 'a plate' })}</p>`)}
        ${costNote(cost, { house: true, cls: 'recipe-cost' })}
        ${(() => {
          const idea = lighterSide(app.db, app.state, d.id, entry);
          return idea ? lighterChip(app, {
            key: `side:${d.id}:${idea.slot}:${idea.to.id}`,
            text: `${idea.to.title} instead of ${idea.from.title}.`,
            why: showNutrition(app) ? `About ${fmtKcal(idea.saves)} fewer calories a plate, remembered for this dinner.` : 'Remembered for this dinner.',
            action: 'lighter:side', data: { dinner: d.id, slot: idea.slot, ref: idea.to.id }, label: 'Swap it',
          }) : '';
        })()}
        <div class="badges">
          ${favoriteBadge(app, d)}
          ${when(retired, () => html`<span class="badge badge-out">${ic('down_vote', { size: 14 })}Not for us</span>`)}
          ${when(bench, () => html`<span class="badge">Maybe later</span>`)}
          ${when(where.length, () => html`<span class="badge badge-plan">${ic('plan', { size: 14 })}Planned ${where.slice(0, 2).map((w) => (w === today ? 'tonight' : relativeDay(w, today))).join(' and ')}</span>`)}
        </div>
        <div class="recipe-actions">
          ${when(!cookedTonight, () => html`<a class="btn btn-primary" id="rec-cook" href="${cookHref}">${ic('flame', { size: 20 })}${cookLabel}</a>`)}
          ${when(cookedTonight, () => html`<p class="status-note status-cooked">${ic('checkCircle', { size: 18 })}Cooked tonight.</p>`)}
          ${when(!isTonight && !late, () => html`<button type="button" class="btn btn-secondary" data-action="rec:tonight" data-dinner="${d.id}">${ic('tonight', { size: 20 })}Make this tonight</button>`)}
          <button type="button" class="btn btn-secondary" data-action="rec:addplan" data-dinner="${d.id}">${ic('plan', { size: 20 })}${isTonight ? 'Move or plan again…' : 'Add to plan on…'}</button>
        </div>
        ${when(!isTonight && late, () => html`<p class="muted small">Too long for tonight: it takes ${fmtMinutes(Number(d.minutes) || 0)}.</p>`)}
      </div>
    </div>


    <div class="recipe-cols">
      <div class="recipe-need">
        ${when(gear.length, () => html`<section aria-labelledby="gear-h" class="recipe-gear">
          <h2 id="gear-h" class="section-title">Equipment</h2>
          <ul class="gear">${gear.map((g) => html`<li>${equipIcon(g.id, { size: 22 })}<span><b>${equipLabel(g.id)}</b>${g.settings.length ? html`<small>${g.settings.join(', ')}</small>` : ''}</span></li>`)}</ul>
          <p class="muted small">No oven needed, ever.</p>
        </section>`)}
        <section class="recipe-ings" aria-labelledby="ing-h">
          <h2 id="ing-h" class="section-title">For five, all adult plates</h2>
          ${when(total, () => html`<p class="pantry-sum ${missing.length ? '' : 'is-ready'}">${missing.length
            ? html`${cic('pantry', { size: 18 })}<span><b>${total - missing.length} of ${total}</b> ingredients are in the pantry. Missing: ${listJoin(missing.slice(0, 5).map((m) => plainName(m.name)))}${missing.length > 5 ? `, and ${missing.length - 5} more` : ''}. ${where.length ? html`<a href="#/list">They’re on the list.</a>` : 'Plan it and they go on the list.'}</span>`
            : html`${ic('checkCircle', { size: 18 })}<span><b>Everything is in the pantry.</b> Nothing to buy.</span>`}</p>`)}
          <h3 class="sub-title">${d.title}</h3>
          ${ingredients(app, d.items)}
          ${sides.map((s) => html`<h3 class="sub-title">${s.info?.title}</h3>${ingredients(app, s.info?.items || {})}`)}
          ${costDetail(app, cost)}
        </section>
      </div>

      <div class="recipe-method">
        ${when(tl.tracks.length > 1, () => html`<section class="recipe-timing" aria-labelledby="timing-h">
          <h2 id="timing-h" class="section-title">Timing the whole plate</h2>
          ${when(tl.tracks.every((t) => t.minutes / tl.total >= 0.08), () => timelineChart(tl))}
          <ul class="cook-cues">${tl.cues.map((c) => html`<li><b>${c.title}.</b> ${c.text}</li>`)}</ul>
        </section>`)}

        <section class="recipe-steps" aria-labelledby="steps-h">
          <h2 id="steps-h" class="section-title">Steps</h2>
          ${steps.length
            ? html`<ol class="steps steps-detail">${steps.map((st, i) => stepItem(st, stepIngs[i]))}</ol>`
            : html`<p class="muted">This recipe has no steps written down yet. Its ingredients are on the left; cook it the way the family likes it.</p>`}
        </section>

        <section class="recipe-sides" aria-labelledby="sides-h">
          <h2 id="sides-h" class="section-title">${sides.length === 1 ? 'The side' : 'The sides'}</h2>
          ${sides.length ? sides.map((s, i) => {
            const rec = recs.find((r) => r.id === `side${i}`);
            const sSteps = rec ? stepDetails(rec.recipe) : [];
            const cue = tl.cues.find((c) => c.id === `side${i}`);
            const sn = showNutrition(app) ? sideNutrition(app.db, app.state, s.parsed) : null;
            const sGear = rec ? equipmentSettings(rec.recipe) : [];
            return html`<div class="side-block"><details class="side-detail" open>
              <summary>${sidePhoto(app, s, { size: 'thumb' })}<span><b>${s.info?.title}</b>${replacedNote(app, s)}${when(s.remembered && !s.replaced, () => html`<small>Remembered substitute</small>`)}
                <small class="side-kcal">${[s.info?.minutes ? fmtMinutes(s.info.minutes) : '', ...sGear.map((g) => `${equipLabel(g.id)}${g.settings.length ? ` (${g.settings.join(', ')})` : ''}`), showNutrition(app) ? (sn ? `${fmtKcal(sn.kcal)} cal a plate` : 'no calorie data') : ''].filter(Boolean).join(' · ')}</small></span></summary>
              ${when(cue, () => html`<p class="side-cue">${ic('clock', { size: 16 })}<span>${cue.text}</span></p>`)}
              <ol class="steps steps-small steps-side">${sSteps.map((st) => html`<li>${st.text}${st.timers.length ? html` <span class="step-chip">${cic('timer', { size: 14 })}${st.timers.map((t) => t.label).join(', ')}</span>` : ''}</li>`)}</ol>
            </details>${when(s.parsed.type === 'side' && app.db.sides[s.parsed.id], () => html`<div class="side-rate">${thumbs(app, { kind: 'side', id: s.parsed.id, label: s.info?.title || 'this side', compact: true, labels: true })}</div>`)}</div>`;
          }) : html`<p class="muted">No sides with this one.</p>`}
        </section>

        ${when(tips.length, () => html`<section class="recipe-tips" aria-labelledby="tips-h">
          <h2 id="tips-h" class="section-title">Tips</h2>
          <ul class="tips">${tips.map((t) => html`<li>${t}</li>`)}</ul>
        </section>`)}

        <section class="recipe-safe" aria-labelledby="safe-h">
          <h2 id="safe-h" class="section-title">Done and safe</h2>
          <ul class="temps">${temps.map((x) => html`<li>${cic('thermo', { size: 20 })}<span><b>${x.temp}°F</b> ${x.food}, ${x.note}</span></li>`)}
            ${when(!temps.length, () => html`<li>${cic('thermo', { size: 20 })}<span>Cook meat until a thermometer in the thickest part reads <b>165°F</b> for chicken and turkey, <b>160°F</b> for ground meat, <b>145°F</b> for chops and steaks.</span></li>`)}</ul>
          <h3 class="sub-title">Leftovers</h3>
          <p class="recipe-leftovers">${leftoversNote(d)}</p>
        </section>
      </div>
    </div>

    ${nutritionSection(app, d, entry, sides, facts)}
    ${when(showNutrition(app), () => html`<p class="pg-again"><button type="button" class="link-btn" data-action="rec:plate-guide">One dinner, two plates: a lighter one and a fuller one</button></p>`)}
    ${votes(app, d)}
    ${when(retired || bench, () => html`<section class="parent-tools">
      <h2 class="section-title">${retired ? 'Not for us' : 'Maybe later'}</h2>
      ${retired ? html`<button type="button" class="btn btn-secondary" data-action="rec:restore" data-dinner="${d.id}">${ic('undo', { size: 20 })}Put it back on the menu</button>`
        : html`<button type="button" class="btn btn-secondary" data-action="rec:promote" data-dinner="${d.id}">${ic('plus', { size: 20 })}Put it on the menu</button>`}
    </section>`)}
    ${when(!cookedTonight, () => html`<div class="recipe-bar is-hidden"><a class="btn btn-primary btn-lg btn-block" href="${cookHref}">${ic('flame', { size: 22 })}${cookLabel}</a></div>`)}
  </div>`;
}

/** The bar at the bottom appears once the page's own "Start cooking" has scrolled out of sight. */
export function mount(app, main) {
  const bar = main.querySelector('.recipe-bar');
  const top = main.querySelector('.recipe-actions');
  if (!bar) return;
  if (!top || typeof IntersectionObserver === 'undefined') { bar.classList.remove('is-hidden'); return; }
  // Only once the page's own button has scrolled up out of sight (gauntlet r2: both showed at once).
  new IntersectionObserver((entries) => {
    const e = entries[entries.length - 1];
    if (bar.isConnected) bar.classList.toggle('is-hidden', e.isIntersecting || e.boundingClientRect.top > 0);
  }).observe(top);
}

function openAddToPlan(app, dinnerId) {
  const today = app.today();
  const d = dinnerById(app.db, app.state, dinnerId);
  const nights = datesBetween(today, addDays(today, 27));
  const from = findInPlan(app.state, dinnerId, { from: today })[0];
  openSheet({
    id: `addplan:${dinnerId}`,
    size: 'tall',
    title: `Add ${d.title} to the plan`,
    subtitle: from ? `It’s already on ${from === today ? 'tonight' : dayAndDate(from, today)}. Picking a night with a dinner trades them.` : 'Picking a night that has a dinner replaces it; you can move that one.',
    render: () => html`<ul class="move-list">${nights.map((x) => {
      const t = app.state.plan?.[x];
      const td = t?.dinner ? dinnerById(app.db, app.state, t.dinner) : null;
      const cooked = t?.status === 'cooked';
      const same = t?.dinner === dinnerId && t.status === 'planned';
      const what = same ? 'Already planned' : t?.status === 'away' ? `Away: ${awayReason(t).label}` : td ? (cooked ? `${td.title} (cooked)` : td.title) : 'Open';
      return html`<li><button type="button" class="move-row ${td ? '' : 'is-open'}" data-action="rec:place" data-dinner="${dinnerId}" data-to="${x}" ${cooked || same ? 'disabled' : ''}>
        <span class="move-day"><b>${dayWord(x, today)}</b><small>${shortDate(x)}</small></span><span class="move-what">${what}</span>${ic('right', { size: 18 })}
      </button></li>`;
    })}</ul>`,
  });
}

export const actions = {
  'rec:vote': (app, el) => app.commit(voteOps(app.db, app.state, { dinnerId: el.dataset.dinner, who: app.who(), value: Number(el.dataset.value), today: app.today() })),
  'rec:tonight': (app, el) => place(app, { dinnerId: el.dataset.dinner, date: app.today() }),
  'rec:addplan': (app, el) => openAddToPlan(app, el.dataset.dinner),
  'rec:place': (app, el) => place(app, { dinnerId: el.dataset.dinner, date: el.dataset.to }),
  'rec:restore': (app, el) => app.commit(restoreOps(app.db, app.state, { dinnerId: el.dataset.dinner })),
  'rec:promote': (app, el) => app.commit(promoteOps(app.db, app.state, { dinnerId: el.dataset.dinner })),
  'rec:plate-guide': () => openSheet({ id: 'plate-guide', title: 'One dinner, two plates', render: () => plateGuide() }),
};

export { isFavorite };
