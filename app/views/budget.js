// BUDGET: the monthly target, this month's projection from the plan, logged receipts,
// and savings against the old $1,000 month.
import { html, ic, when, toast } from '../ui.js';
import { BASELINE_MONTHLY } from '../config.js';
import { money, monthOnly, mediumDate, shortDate, round2, isISODate } from '../util.js';
import { monthBudget } from '../shopping.js';
import { addReceiptOps, removeReceiptOps, settingOps } from '../actions.js';

export const title = () => 'Budget';
const NAMES = { sams: "Sam's Club", jewel: 'Jewel-Osco', other: 'Other' };

export function render(app) {
  const today = app.today();
  const b = monthBudget(app.db, app.state, today, { baseline: BASELINE_MONTHLY });
  const scale = Math.max(b.target, b.projected, b.ifPlanned, 1) * 1.08;
  const pct = (n) => `${Math.max(0, Math.min(100, (n / scale) * 100)).toFixed(2)}%`;
  const over = b.projected > b.target;
  const month = monthOnly(today);
  return html`<div class="page page-budget">
    <header class="page-head"><h1 class="page-title">Budget</h1></header>
    <section class="budget-card" aria-labelledby="bud-h">
      <h2 id="bud-h" class="budget-month">${month} groceries</h2>
      <p class="budget-big"><span class="budget-num">${money(b.projected)}</span><span class="budget-of">projected of ${money(b.target)}</span></p>
      <div class="meter" role="img" aria-label="${money(b.spent)} spent, ${money(b.stillToBuy)} still to buy, target ${money(b.target)}">
        <span class="meter-spent" style="width:${pct(b.spent)}"></span>
        <span class="meter-plan" style="left:${pct(b.spent)};width:${pct(b.stillToBuy)}"></span>
        ${when(b.unplanned && b.ifPlanned > b.projected, () => html`<span class="meter-maybe" style="left:${pct(b.projected)};width:${pct(b.ifPlanned - b.projected)}"></span>`)}
        <span class="meter-target" style="left:${pct(b.target)}"><span>Target</span></span>
      </div>
      <ul class="legend">
        <li><span class="key key-spent"></span>Spent so far<b>${money(b.spent)}</b></li>
        <li><span class="key key-plan"></span>Still to buy for ${b.plannedRemaining} planned ${b.plannedRemaining === 1 ? 'dinner' : 'dinners'}<b>${money(b.stillToBuy)}</b></li>
        ${when(b.unplanned, () => html`<li><span class="key key-maybe"></span>${b.unplanned} ${b.unplanned === 1 ? 'night' : 'nights'} not planned yet${b.perDinner ? `, at ${money(b.perDinner)} a dinner` : ''}<b>${b.perDinner ? `+${money(round2(b.ifPlanned - b.projected))}` : '—'}</b></li>`)}
      </ul>
      <p class="budget-verdict ${over ? 'is-over' : 'is-under'}">${over ? `${money(b.projected - b.target)} over the target so far.` : `${money(b.left)} left under the target.`}</p>
      ${when(b.savings > 0, () => html`<p class="budget-save">${ic('leaf', { size: 20 })}<span>${money(b.savings)} less than the old ${money(b.baseline, { whole: true })} month.</span></p>`)}
      <p class="muted small">Projected = receipts logged this month + the shopping list for the rest of ${month} (today through ${shortDate(b.end)}), at ${app.db.pricesUpdated ? `prices estimated as of ${mediumDate(app.db.pricesUpdated)}` : 'estimated prices'}. ${b.receipts.length ? '' : 'Log receipts after each trip so “spent so far” is real.'}</p>
    </section>

    <section class="target" aria-labelledby="t-h">
      <h2 id="t-h" class="section-title">Monthly target</h2>
      <form class="form form-row" data-submit="bud:target">
        <label class="field field-money"><span class="sr-only">Monthly target in dollars</span><span class="prefix" aria-hidden="true">$</span><input class="input" name="target" type="number" inputmode="decimal" min="50" step="10" value="${b.target}"></label>
        <button type="submit" class="btn btn-secondary">Save target</button>
      </form>
    </section>

    <section class="receipts" aria-labelledby="r-h">
      <h2 id="r-h" class="section-title">Receipts this month</h2>
      <form class="form form-inline-card" data-submit="bud:receipt">
        <div class="field-row">
          <label class="field"><span class="field-label">Date</span><input class="input" type="date" name="date" value="${today}" max="${today}" required></label>
          <label class="field field-money"><span class="field-label">Total</span><span class="prefix" aria-hidden="true">$</span><input class="input" type="number" name="amount" inputmode="decimal" min="0.01" step="0.01" placeholder="0.00" required></label>
        </div>
        <fieldset class="field"><legend class="field-label">Store</legend><div class="chip-grid">
          ${['sams', 'jewel', 'other'].map((s, i) => html`<label class="chip chip-radio"><input type="radio" name="store" value="${s}" ${i === 1 ? 'checked' : ''}>${NAMES[s]}</label>`)}
        </div></fieldset>
        <label class="field"><span class="field-label">Note <small>(optional)</small></span><input class="input" name="note" maxlength="60" placeholder="Big Sam’s run"></label>
        <button type="submit" class="btn btn-primary btn-block">${ic('receipt', { size: 20 })}Log receipt</button>
      </form>
      ${b.receipts.length ? html`<ul class="receipt-list">${b.receipts.map((r) => html`<li class="receipt-row">
          <span><b>${NAMES[r.store] || r.store}</b><small>${shortDate(r.date)}${r.note ? `, ${r.note}` : ''}${r.by ? `, by ${r.by}` : ''}</small></span>
          <span class="receipt-amt">${money(Number(r.amount))}</span>
          ${when(r.id, () => html`<button type="button" class="icon-btn" data-action="bud:remove" data-id="${r.id}" aria-label="Remove receipt">${ic('trash', { size: 20 })}</button>`)}
        </li>`)}</ul>`
        : html`<p class="muted small">No receipts logged for ${month} yet.</p>`}
    </section>
  </div>`;
}

export const actions = {
  'bud:target': (app, form) => {
    const v = Number(new FormData(form).get('target'));
    if (!(v >= 50 && v <= 5000)) { toast('Enter a target between $50 and $5,000.'); return; }
    app.commit({ ...settingOps(app.state, 'monthlyTarget', Math.round(v)), message: `Monthly target set to ${money(Math.round(v), { whole: true })}.` });
  },
  'bud:receipt': (app, form) => {
    const f = new FormData(form);
    const date = String(f.get('date') || '');
    const amount = Number(f.get('amount'));
    if (!isISODate(date) || !(amount > 0)) { toast('Enter the date and the receipt total.'); return; }
    app.commit({ ...addReceiptOps(app.state, { date, store: String(f.get('store') || 'jewel'), amount, note: String(f.get('note') || '').trim(), who: app.who() }), message: `Logged ${money(amount)}.` });
  },
  'bud:remove': (app, el) => app.commit(removeReceiptOps(app.state, { id: el.dataset.id })),
};
