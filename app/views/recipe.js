// RECIPE: one dinner — photo, ingredients for five, sides, steps, family votes,
// make tonight / add to plan / start cooking, and retire/restore for Jeff and Candi.
import { html, ic, when, openSheet, avatar, personStyle, tf } from '../ui.js';
import { FAMILY, PARENTS } from '../config.js';
import { fmtQty, addDays, datesBetween, relativeDay, shortDate, dayWord, dayAndDate, listJoin } from '../util.js';
import { dinnerById, isRetired, isPromoted, isFavorite, voteInfo, findInPlan, inRotation, scaleItems, downVoters, implicitPromotions } from '../planner.js';
import { settingsOf } from '../state.js';
import { voteOps, retireOps, restoreOps, promoteOps } from '../actions.js';
import { itemMeta, unitText } from '../shopping.js';
import { sidesFor, dinnerPhoto, sidePhoto, equipment, favoriteBadge, awayReason, nutri, showNutrition, lighterChip, thumbs, replacedNote } from './common.js';
import { plateNutrition, entreeNutrition, sideNutrition, lighterSide, fmtKcal } from '../nutrition.js';
import { place, openWho } from './sheets.js';

export const title = (app) => dinnerById(app.db, app.state, app.route.params[0])?.title || 'Recipe';

function amount(qty, unit) {
  return unitText(qty, unit);
}

export function ingredients(app, items) {
  const lighter = settingsOf(app.state).meatScale !== 1;
  const scaled = scaleItems(app.db, app.state, items);
  return html`<ul class="ingredients">${Object.entries(scaled).map(([id, q]) => {
    const m = itemMeta(app.db, app.state, id);
    const light = lighter && app.db.ingredients[id]?.meat;
    return html`<li><span class="ing-amt">${amount(q, m.unit)}</span><span class="ing-name">${m.name}${light ? html` <span class="tag">lighter</span>` : ''}</span></li>`;
  })}</ul>`;
}

function votes(app, d) {
  // One shared profile (docs/spec/20): one signal for the whole family — loved, fine (neither), or not for us.
  const mine = isRetired(app.state, d.id) ? -1 : isFavorite(app.state, d) ? 1 : 0;
  return html`<section class="votes" aria-labelledby="votes-h">
    <h2 id="votes-h" class="section-title">What the family thinks</h2>
    <div class="vote-mine" role="group" aria-label="What the family thinks of ${d.title}">
      <button type="button" class="btn vote-btn ${mine === 1 ? 'is-on' : ''}" aria-pressed="${tf(mine === 1)}" data-action="rec:vote" data-dinner="${d.id}" data-value="1">${ic('up_vote', { size: 20 })}Loved</button>
      <button type="button" class="btn vote-btn vote-down ${mine === -1 ? 'is-on' : ''}" aria-pressed="${tf(mine === -1)}" data-action="rec:vote" data-dinner="${d.id}" data-value="-1">${ic('down_vote', { size: 20 })}Not for us</button>
    </div>
    <p class="muted small">${mine === 1 ? 'A family favorite: it gets planned more often. Tap Loved again to go back to fine.'
      : mine === -1 ? 'Off the menu, and a dinner from the bench took its place. Tap “Not for us” again to bring this one back.'
        : 'Loved makes it a family favorite, planned more often. Not for us takes it off the menu and brings in a dinner from the bench; it waits in Recipes, Dropped, if you change your minds.'}</p>
  </section>`;
}

export function render(app) {
  const id = app.route.params[0];
  const d = dinnerById(app.db, app.state, id);
  if (!d) {
    return html`<div class="page"><a class="back" href="#/recipes">${ic('left', { size: 20 })}Recipes</a>
      <div class="empty"><h3 class="empty-title">That recipe isn’t in the box</h3><p class="empty-body">It may have been renamed. Browse the recipe box instead.</p><div class="empty-actions"><a class="btn btn-primary" href="#/recipes">Open recipes</a></div></div></div>`;
  }
  const today = app.today();
  const sides = sidesFor(app, d.id, null);
  const retired = isRetired(app.state, d.id);
  const bench = d.rotation === 'bench' && !isPromoted(app.state, d.id) && !retired && !implicitPromotions(app.db, app.state).has(d.id);
  const parent = true; // one shared profile (docs/spec/20): no parent or kid difference in what can be changed
  const where = findInPlan(app.state, d.id, { from: today });
  const replaced = app.state.promoted?.[d.id]?.replaced || implicitPromotions(app.db, app.state).get(d.id);
  return html`<div class="page page-recipe">
    <a class="back" href="#/recipes">${ic('left', { size: 20 })}Recipes</a>
    <div class="recipe-top">
      <div class="recipe-photo">${dinnerPhoto(app, d, { size: 'hero', eager: true, alt: d.title })}</div>
      <div class="recipe-head">
        <h1 class="recipe-title">${d.title}</h1>
        ${when(d.subtitle, () => html`<p class="recipe-sub">${d.subtitle}</p>`)}
        ${equipment(d)}
        ${when(showNutrition(app), () => html`<p class="recipe-nutri">${nutri(app, plateNutrition(app.db, app.state, d.id, null), { suffix: 'a plate with both sides' })}</p>`)}
        ${(() => {
          const idea = lighterSide(app.db, app.state, d.id, null);
          return idea ? lighterChip(app, {
            key: `side:${d.id}:${idea.slot}:${idea.to.id}`,
            text: `${idea.to.title} instead of ${idea.from.title}.`,
            why: showNutrition(app) ? `About ${fmtKcal(idea.saves)} fewer calories a plate, remembered for this dinner.` : 'Remembered for this dinner.',
            action: 'lighter:side', data: { dinner: d.id, slot: idea.slot, ref: idea.to.id }, label: 'Swap it',
          }) : '';
        })()}
        <div class="badges">
          ${favoriteBadge(app, d)}
          ${when(retired, () => html`<span class="badge badge-out">${ic('down_vote', { size: 14 })}Dropped${downVoters(app.state, d.id).length ? `: thumbs down from ${listJoin(downVoters(app.state, d.id))}` : ''}</span>`)}
          ${when(bench, () => html`<span class="badge">On the bench</span>`)}
          ${when(replaced, () => html`<span class="badge">Joined the rotation, replacing ${dinnerById(app.db, app.state, replaced)?.title || 'a dropped dinner'}</span>`)}
          ${when(where.length, () => html`<span class="badge badge-plan">${ic('plan', { size: 14 })}Planned ${where.slice(0, 2).map((w) => (w === today ? 'tonight' : relativeDay(w, today))).join(' and ')}</span>`)}
        </div>
        <div class="recipe-actions">
          <button type="button" class="btn btn-primary" data-action="rec:tonight" data-dinner="${d.id}">${ic('tonight', { size: 20 })}Make this tonight</button>
          <button type="button" class="btn btn-secondary" data-action="rec:addplan" data-dinner="${d.id}">${ic('plan', { size: 20 })}Add to plan on…</button>
          <a class="btn btn-secondary" href="#/cook/d/${d.id}">${ic('flame', { size: 20 })}Start cooking</a>
        </div>
        ${when(where.includes(today) === false && findInPlan(app.state, d.id, { from: today }).length, () => html`<p class="muted small">Making it tonight swaps it with tonight’s dinner.</p>`)}
      </div>
    </div>
    <div class="recipe-cols">
      <section class="recipe-ings" aria-labelledby="ing-h">
        <h2 id="ing-h" class="section-title">For five, all adult plates</h2>
        ${ingredients(app, d.items)}
        <h3 class="sub-title">Sides</h3>
        ${sides.length ? sides.map((s) => html`<div class="side-block"><details class="side-detail">
          <summary>${sidePhoto(app, s, { size: 'thumb' })}<span><b>${s.info?.title}</b>${replacedNote(app, s)}${when(s.remembered && !s.replaced, () => html`<small>Remembered substitute</small>`)}${when(showNutrition(app), () => { const sn = sideNutrition(app.db, app.state, s.parsed); return html`<small class="side-kcal">${sn ? `${fmtKcal(sn.kcal)} cal a plate` : '—'}</small>`; })}</span></summary>
          ${ingredients(app, s.info?.items || {})}
          <ol class="steps steps-small">${(s.info?.steps || []).map((t) => html`<li>${t}</li>`)}</ol>
        </details>${when(s.parsed.type === 'side' && app.db.sides[s.parsed.id], () => thumbs(app, { kind: 'side', id: s.parsed.id, label: s.info?.title || 'this side', compact: true }))}</div>`) : html`<p class="muted">No sides.</p>`}
      </section>
      <section class="recipe-steps" aria-labelledby="steps-h">
        <h2 id="steps-h" class="section-title">Steps</h2>
        <ol class="steps">${d.steps.map((t) => html`<li>${t}</li>`)}</ol>
      </section>
    </div>
    ${votes(app, d)}
    ${when(parent, () => html`<section class="parent-tools">
      <h2 class="section-title">The rotation</h2>
      ${retired ? html`<button type="button" class="btn btn-secondary" data-action="rec:restore" data-dinner="${d.id}">${ic('undo', { size: 20 })}Bring back into the rotation</button>`
        : bench ? html`<button type="button" class="btn btn-secondary" data-action="rec:promote" data-dinner="${d.id}">${ic('plus', { size: 20 })}Add to the rotation</button>`
          : inRotation(app.state, d, app.db) ? html`<button type="button" class="btn btn-quiet" data-action="rec:retire" data-dinner="${d.id}">${ic('trash', { size: 20 })}Retire from the rotation</button>` : ''}
    </section>`)}
  </div>`;
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
  'rec:vote': (app, el) => {
    if (!app.who()) { openWho(app); return; }
    app.commit(voteOps(app.db, app.state, { dinnerId: el.dataset.dinner, who: app.who(), value: Number(el.dataset.value), today: app.today() }));
  },
  'rec:tonight': (app, el) => place(app, { dinnerId: el.dataset.dinner, date: app.today() }),
  'rec:addplan': (app, el) => openAddToPlan(app, el.dataset.dinner),
  'rec:place': (app, el) => place(app, { dinnerId: el.dataset.dinner, date: el.dataset.to }),
  'rec:retire': (app, el) => app.commit(retireOps(app.db, app.state, { dinnerId: el.dataset.dinner, who: app.who(), today: app.today() })),
  'rec:restore': (app, el) => app.commit(restoreOps(app.db, app.state, { dinnerId: el.dataset.dinner })),
  'rec:promote': (app, el) => app.commit(promoteOps(app.db, app.state, { dinnerId: el.dataset.dinner })),
};

export { isFavorite };
