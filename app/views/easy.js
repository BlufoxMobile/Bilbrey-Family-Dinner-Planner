// EASY TONIGHT (docs/spec/25 §25.4): for the night nobody feels like cooking. Up to three dinners
// that are the least work and already in the house, then the no-cooking options. Choosing one uses
// the same swap as "Swap": the dinner it replaces is offered another night.
import { html, ic, when, openSheet } from '../ui.js';
import { hourIn, listJoin } from '../util.js';
import { fmtMinutes } from '../data.js';
import { easyTonight } from '../easy.js';
import { dinnerPhoto, costOf, costNote } from './common.js';

function body(app, date) {
  const e = easyTonight(app.db, app.state, date, { hour: hourIn(new Date()) });
  const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);
  return html`
    <p class="sheet-text">The least work that’s still a real dinner, from what’s already in the house.</p>
    ${e.picks.length ? html`<ul class="pick-list easy-list">${e.picks.map((p) => html`<li><button type="button" class="pick-row" data-action="pick:choose" data-date="${date}" data-dinner="${p.dinner.id}">
        ${dinnerPhoto(app, p.dinner, { size: 'thumb' })}
        <span class="pick-main"><b>${p.dinner.title}</b>
          <small>${p.cooker ? `${fmtMinutes(p.work)} to load the PossibleCooker, then it cooks itself` : `${fmtMinutes(p.work)} of work, on the table in ${fmtMinutes(p.total)}`}${p.loved ? ', a family favorite' : ''}</small>
          <small class="${p.ready ? 'easy-ready' : 'easy-short'}">${p.ready ? 'Everything is in the house' : `Needs ${listJoin([...p.missing.slice(0, 3).map(lower), ...(p.missing.length > 3 ? [`${p.missing.length - 3} more`] : [])])} from the store`}${p.thaw.length ? `. If the ${listJoin(p.thaw.map(lower))} ${p.thaw.length === 1 ? 'is' : 'are'} still frozen, thaw in cold water first: about 30 minutes a pound` : ''}.</small>
          ${costNote(costOf(app, p.dinner.id, null), { short: true, tag: 'small', cls: 'pick-cost' })}</span>
      </button></li>`)}</ul>`
    : html`<p class="hint">${ic('info', { size: 18 })}<span>No quick dinners are in the rotation right now. Pick any dinner, or bring some back from Recipes.</span></p>`}
    ${when(e.picks.length && !e.picks.some((p) => p.ready), () => html`<p class="muted small">Nothing quick is fully covered by what the pantry lists. If the pantry is out of date, a photo on the Pantry page fixes that.</p>`)}
    ${when(e.leftovers.length || e.backups.length, () => html`<h3 class="easy-sub">Or no cooking at all</h3>
      <ul class="easy-none">
        ${e.leftovers.map((l) => html`<li>${ic('bowl', { size: 18 })}<span><b>${l.title}</b>: ${l.servings} ${l.servings === 1 ? 'serving' : 'servings'} of leftovers in the fridge.</span>
          <button type="button" class="btn btn-small btn-secondary" data-action="leftovers:night" data-date="${l.date}">Make it dinner</button></li>`)}
        ${e.backups.map((b) => html`<li>${ic(b.storage === 'freezer' ? 'snow' : 'pantry', { size: 18 })}<span><b>${b.name}</b> is in the ${b.storage === 'freezer' ? 'freezer' : 'pantry'}.</span></li>`)}
      </ul>`)}
    <div class="sheet-actions">
      <button type="button" class="btn btn-quiet btn-block" data-action="night:pick" data-date="${date}">See every dinner</button>
    </div>`;
}

export function openEasy(app, date) {
  openSheet({ id: `easy:${date}`, size: 'tall', title: 'Easy tonight', render: () => body(app, date) });
}

export const actions = {
  'easy:open': (app, el) => openEasy(app, el.dataset.date || app.today()),
};
