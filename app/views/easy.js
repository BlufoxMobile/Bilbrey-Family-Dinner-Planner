// EASY TONIGHT (docs/spec/25 §25.4): for the night nobody feels like cooking. Up to three dinners
// that are the least work and already in the house, then the no-cooking options. Choosing one uses
// the same swap as "Swap": the dinner it replaces is offered another night.
import { html, ic, when, openSheet } from '../ui.js';
import { hourIn, listJoin } from '../util.js';
import { fmtMinutes } from '../data.js';
import { easyTonight } from '../easy.js';
import { dinnerPhoto } from './common.js';

function body(app, date) {
  const e = easyTonight(app.db, app.state, date, { hour: hourIn(new Date()), limit: 12 });
  // "BBQ sauce" stays "BBQ sauce" mid-sentence (gauntlet r1 caught "bBQ").
  const lower = (s) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
  // Only dinners that need no store trip (docs/spec/29): "easy" that starts with a drive isn't easy.
  const picks = e.picks.filter((p) => p.ready).slice(0, 3);
  return html`
    ${picks.length ? html`<ul class="pick-list easy-list">${picks.map((p) => html`<li><button type="button" class="pick-row" data-action="pick:choose" data-date="${date}" data-dinner="${p.dinner.id}">
        ${dinnerPhoto(app, p.dinner, { size: 'thumb' })}
        <span class="pick-main"><b>${p.dinner.title}</b>
          <small>${p.cooker ? `${fmtMinutes(p.work)} to load the slow cooker` : `${fmtMinutes(p.work)} of work, ready in ${fmtMinutes(p.total)}`}${p.loved ? ', a favorite' : ''}</small>
          ${when(p.sideOut.length || p.thaw.length, () => html`<small class="easy-short">${[p.sideOut.length ? `Out of ${listJoin(p.sideOut.slice(0, 2).map(lower))}: swap the side` : '', p.thaw.length ? `Thaw the ${listJoin(p.thaw.map(lower))} in cold water first` : ''].filter(Boolean).join('. ')}.</small>`)}
        </span>
      </button></li>`)}</ul>`
    : html`<p class="sheet-text">Nothing quick is all in the house tonight.</p>`}
    ${when(e.leftovers.length || e.backups.length, () => html`<h3 class="easy-sub">Or no cooking at all</h3>
      <ul class="easy-none">
        ${e.leftovers.map((l) => html`<li>${ic('bowl', { size: 18 })}<span><b>${l.title}</b>: ${l.servings} ${l.servings === 1 ? 'serving' : 'servings'} of leftovers.</span>
          <button type="button" class="btn btn-small btn-secondary" data-action="leftovers:night" data-date="${l.date}">Make it dinner</button></li>`)}
        ${e.backups.map((b) => html`<li>${ic(b.storage === 'freezer' ? 'snow' : 'pantry', { size: 18 })}<span><b>${b.name}</b> is in the ${b.storage === 'freezer' ? 'freezer' : 'pantry'}.</span></li>`)}
      </ul>`)}
    <div class="sheet-actions">
      <button type="button" class="btn btn-quiet btn-block" data-action="night:pick" data-date="${date}">Change dinner</button>
    </div>`;
}

export function openEasy(app, date) {
  openSheet({ id: `easy:${date}`, size: 'tall', title: 'Easy tonight', subtitle: 'Already in the house, least work first.', render: () => body(app, date) });
}

export const actions = {
  'easy:open': (app, el) => openEasy(app, el.dataset.date || app.today()),
};
