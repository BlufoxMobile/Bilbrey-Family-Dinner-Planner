// WEEKLY CHECK-IN (docs/spec/25): the week's groceries against the budget, the week's dinners, and
// a weigh-in for whoever wants one. The family does this together, in the open (Jeff, 2026-11-16):
// weigh-ins are shared with the family and shown on every screen, the TV included, unless a person
// keeps theirs on their own phone or the family turns the TV off for them.
import { html, ic, when, toast, segmented, confirmSheet, switchToggle } from '../ui.js';
import { money, shortDate, mediumDate, weekdayName, datesBetween, diffDays, cleanName } from '../util.js';
import { tvOn } from '../tv.js';
import { PARENTS } from '../config.js';
import { settingOps } from '../actions.js';
import { weekSummary } from '../cooking.js';
import { isDismissed } from './common.js';
import {
  shownWeek, dueWeek, moneyCheckin, moneyCheckedOps, moneyUncheckedOps, checkinDay, weekOf, weekSpend,
  WEIGH_GOALS, weighTrend, sharedWeighIns, weighOps, removeWeighOps, weighGoalOps, shareWeighOps, forgetWeighOps, parseLb, fmtLb, weighSeries,
  LB_MIN, LB_MAX,
} from '../checkin.js';

export const title = () => 'Weekly check-in';
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const weekLabel = (w) => `${shortDate(w.start)} to ${shortDate(w.end)}`;
/** Is this screen a TV? (`app.tvOn` lets a test say so.) */
const onTv = (app) => (typeof app.tvOn === 'function' ? app.tvOn() : tvOn());
/** Weigh-ins show on the TV unless the family turns that off (`settings.weighOnTv: false`). */
const weighOnTv = (app) => app.state?.settings?.weighOnTv !== false;
const hiddenHere = (app) => onTv(app) && !weighOnTv(app);
const possessive = (name) => `${name}’${/s$/i.test(name) ? '' : 's'}`;

// ---------------------------------------------------------------- charts (one series each, so no legend)

/** The last six weeks of groceries as bars, with the weekly share of the target as a line. */
function weekBars(history, share) {
  const W = 320; const H = 150; const base = 118; const top = 22; const left = 6; const right = 6;
  const max = Math.max(share, ...history.map((h) => h.total), 1) * 1.08;
  const y = (v) => base - ((base - top) * v) / max;
  const slot = (W - left - right) / history.length;
  const bw = Math.min(30, slot - 12);
  const bar = (h, i) => {
    const x = left + slot * i + (slot - bw) / 2;
    const yy = y(h.total);
    const r = Math.min(4, (base - yy) / 2);
    const now = i === history.length - 1;
    const tip = `${shortDate(h.start)} to ${shortDate(h.end)}: ${money(h.total)}${h.trips ? ` in ${h.trips} ${h.trips === 1 ? 'trip' : 'trips'}` : ', no receipts'}`;
    return html`<g class="ck-bar ${now ? 'is-now' : ''}">
      <title>${tip}</title>
      <rect class="ck-hit" x="${(left + slot * i).toFixed(1)}" y="${top}" width="${slot.toFixed(1)}" height="${base - top}"></rect>
      ${h.total > 0
    ? html`<path class="ck-fill" d="M${x.toFixed(1)},${base}V${(yy + r).toFixed(1)}Q${x.toFixed(1)},${yy.toFixed(1)} ${(x + r).toFixed(1)},${yy.toFixed(1)}H${(x + bw - r).toFixed(1)}Q${(x + bw).toFixed(1)},${yy.toFixed(1)} ${(x + bw).toFixed(1)},${(yy + r).toFixed(1)}V${base}Z"></path>`
    : html`<rect class="ck-none" x="${x.toFixed(1)}" y="${base - 2}" width="${bw.toFixed(1)}" height="2" rx="1"></rect>`}
      ${when(now && h.total > 0, () => html`<text class="ck-val" x="${(x + bw / 2).toFixed(1)}" y="${Math.max(12, yy - 6).toFixed(1)}" text-anchor="middle">${money(h.total, { whole: true })}</text>`)}
      <text class="ck-tick" x="${(x + bw / 2).toFixed(1)}" y="${base + 16}" text-anchor="middle">${shortDate(h.start)}</text>
    </g>`;
  };
  const ty = y(share);
  return html`<figure class="ck-chart">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Groceries for each of the last ${history.length} weeks. The line is ${money(share, { whole: true })}, a week’s share of the monthly target.">
      <line class="ck-base" x1="${left}" x2="${W - right}" y1="${base}" y2="${base}"></line>
      ${history.map(bar)}
      <line class="ck-target" x1="${left}" x2="${W - right}" y1="${ty.toFixed(1)}" y2="${ty.toFixed(1)}"></line>
      <text class="ck-target-label" x="${left + 2}" y="${(ty - 5).toFixed(1)}">${money(share, { whole: true })} a week</text>
    </svg>
    <figcaption class="muted small">Each bar is a week, labeled by its first day. The dashed line is a week’s share of the monthly target.</figcaption>
  </figure>`;
}

/** Weekly weigh-ins as a line (the last twelve), first and last labeled. */
function weighLine(weeks, name) {
  const pts = weeks.slice(-12);
  if (!pts.length) return '';
  const W = 320; const H = 120; const left = 26; const right = 30; const top = 22; const bottom = 92;
  const lo = Math.min(...pts.map((p) => p.lb)); const hi = Math.max(...pts.map((p) => p.lb));
  const pad = Math.max(1.5, (hi - lo) * 0.25);
  const span = Math.max(1, diffDays(pts[pts.length - 1].week, pts[0].week));
  const x = (p) => (pts.length === 1 ? W / 2 : left + ((W - left - right) * diffDays(p.week, pts[0].week)) / span);
  const y = (p) => bottom - ((bottom - top) * (p.lb - (lo - pad))) / (hi - lo + pad * 2);
  const first = pts[0]; const last = pts[pts.length - 1];
  return html`<figure class="ck-chart ck-chart-weigh">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${possessive(name)} weekly weigh-ins, ${shortDate(first.date)} to ${shortDate(last.date)}: ${fmtLb(first.lb)} to ${fmtLb(last.lb)}.">
      <line class="ck-base" x1="8" x2="${W - 8}" y1="${bottom + 10}" y2="${bottom + 10}"></line>
      ${when(pts.length > 1, () => html`<polyline class="ck-line" points="${pts.map((p) => `${x(p).toFixed(1)},${y(p).toFixed(1)}`).join(' ')}"></polyline>`)}
      ${pts.map((p) => html`<g class="ck-pt"><title>${shortDate(p.date)}: ${fmtLb(p.lb)}</title><circle class="ck-hit" cx="${x(p).toFixed(1)}" cy="${y(p).toFixed(1)}" r="12"></circle><circle class="ck-dot" cx="${x(p).toFixed(1)}" cy="${y(p).toFixed(1)}" r="4.5"></circle></g>`)}
      ${when(pts.length > 1, () => html`<text class="ck-val" x="${x(first).toFixed(1)}" y="${(y(first) - 10).toFixed(1)}" text-anchor="middle">${fmtLb(first.lb).replace(' lb', '')}</text>`)}
      <text class="ck-val" x="${x(last).toFixed(1)}" y="${(y(last) - 10).toFixed(1)}" text-anchor="middle">${fmtLb(last.lb).replace(' lb', '')}</text>
      ${when(pts.length > 1, () => html`<text class="ck-tick" x="${x(first).toFixed(1)}" y="${H - 4}" text-anchor="middle">${shortDate(first.date)}</text>`)}
      <text class="ck-tick" x="${x(last).toFixed(1)}" y="${H - 4}" text-anchor="middle">${shortDate(last.date)}</text>
    </svg>
  </figure>`;
}

// ---------------------------------------------------------------- money

function moneyCard(app, m, week) {
  const w = m.week;
  const mo = m.month;
  const tone = m.status === 'over' ? 'is-over' : m.status === 'tight' ? 'is-tight' : 'is-under';
  return html`<section class="ck-card ck-money" id="ck-money" aria-labelledby="ckm-h">
    <h2 id="ckm-h" class="section-title">${ic('budget', { size: 22 })}Groceries</h2>
    <p class="trips-big"><b>${money(w.total)}</b><span>${w.done ? 'spent that week' : 'spent so far this week'}<small>${w.trips ? `${w.trips} store ${w.trips === 1 ? 'trip' : 'trips'}` : 'no receipts logged'}${m.last.total ? `, ${money(m.last.total)} the week before` : ''}</small></span></p>
    ${weekBars(m.history, w.share)}
    <details class="cover-more"><summary>The numbers, week by week</summary>
      <table class="ck-table"><thead><tr><th scope="col">Week</th><th scope="col">Trips</th><th scope="col">Spent</th></tr></thead>
        <tbody>${m.history.map((h) => html`<tr><th scope="row">${shortDate(h.start)} to ${shortDate(h.end)}</th><td>${h.trips}</td><td>${money(h.total)}</td></tr>`)}</tbody></table>
    </details>
    <h3 class="ck-sub">The month so far</h3>
    <ul class="legend">
      <li><span class="key key-spent"></span>Spent so far<b>${money(mo.spent)}</b></li>
      <li><span class="key key-plan"></span>Still to buy for what’s planned<b>${money(mo.stillToBuy)}</b></li>
      ${when(mo.unplanned, () => html`<li><span class="key key-maybe"></span>${mo.unplanned} ${mo.unplanned === 1 ? 'night' : 'nights'} not planned yet, at the usual cost<b>+${money(mo.ifPlanned - mo.projected)}</b></li>`)}
      <li><span class="key key-spent"></span><strong>Heading for</strong><b>${money(mo.ifPlanned)} of ${money(mo.target, { whole: true })}</b></li>
    </ul>
    <p class="budget-verdict ${tone}" id="ck-verdict">${m.verdict}</p>
    ${when(mo.perWeekLeft > 0, () => html`<p class="small">That leaves about <b>${money(mo.perWeekLeft, { whole: true })} ${mo.daysLeft > 7 ? 'a week' : ''}</b> for the ${mo.daysLeft} ${mo.daysLeft === 1 ? 'day' : 'days'} left${mo.tripsLeft ? `, in ${mo.tripsLeft} more store ${mo.tripsLeft === 1 ? 'trip' : 'trips'}` : ''}.</p>`)}
    <ul class="ck-tips">${m.tips.map((t) => html`<li class="hint ${m.status === 'on' ? '' : 'hint-warn'}">${ic('leaf', { size: 18 })}<span>${t.text}${t.href ? html` <a class="text-link" href="${t.href}">${t.label}</a>` : ''}</span></li>`)}</ul>
    <p class="muted small">At this rate the year comes to about ${money(m.year.year, { whole: true })}; the target is ${money(m.year.yearTarget, { whole: true })}. ${m.year.overYear > 0 ? `That’s ${money(m.year.overYear / 12, { whole: true })} a month to find.` : `That’s ${money(-m.year.overYear, { whole: true })} under.`}</p>
    <div class="ck-actions">
      ${m.checked
    ? html`<p class="status-note status-cooked">${ic('checkCircle', { size: 18 })}<span>Checked${m.checked.at ? ` on ${shortDate(String(m.checked.at).slice(0, 10))}` : ''}.</span></p>
          <button type="button" class="btn btn-quiet btn-small" data-action="checkin:undone" data-start="${week.start}" data-end="${week.end}">Reopen</button>`
    : html`<button type="button" class="btn btn-primary" id="ck-done" data-action="checkin:done" data-start="${week.start}" data-end="${week.end}">${ic('checkCircle', { size: 20 })}Looks right: mark this week checked</button>
          <a class="btn btn-secondary" href="#/budget">${ic('receipt', { size: 20 })}A receipt is missing</a>`}
    </div>
  </section>`;
}

function dinnersCard(app, week) {
  const s = weekSummary(app.db, app.state, datesBetween(week.start, week.end));
  if (!s.home && !s.away && !s.leftoverNights) return '';
  const tiles = [
    [`${s.cooked} of ${s.home}`, `${s.home === 1 ? 'dinner' : 'dinners'} cooked at home`],
    [`${s.withVeg} of ${s.home}`, 'had a vegetable or salad'],
  ];
  if (s.counted) tiles.push([String(s.lean), `lean ${s.lean === 1 ? 'plate' : 'plates'}`]);
  tiles.push([String(s.away + s.leftoverNights), 'nights out or on leftovers']);
  return html`<section class="ck-card" aria-labelledby="ckd-h">
    <h2 id="ckd-h" class="section-title">${ic('leaf', { size: 22 })}Dinners</h2>
    <dl class="week-stats">${tiles.map(([v, k]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>
    <p class="muted small">Every dinner eaten at home is one that wasn’t bought twice. <a href="#/plan">Open the planner</a></p>
  </section>`;
}

// ---------------------------------------------------------------- the weigh-in

const myWeights = (app, me) => (me.keep === 'family' ? app.state.checkin?.weights?.[me.name] || {} : me.weights || {});

function trendBlock(t) {
  return html`<p class="ck-headline">${t.headline}</p>
    ${when(t.note, () => html`<p class="small ck-note">${t.note}</p>`)}
    ${when(t.doctor, () => html`<p class="hint hint-warn ck-doctor">${ic('info', { size: 18 })}<span>${t.doctor}</span></p>`)}`;
}

function setupForm(app, shared) {
  const taken = new Set(shared.map((s) => s.name));
  return html`<form class="form ck-setup" data-submit="weigh:setup" autocomplete="off">
    <fieldset class="field"><legend class="field-label">Who is this for?</legend><div class="chip-grid">
      ${PARENTS.map((n, i) => html`<label class="chip chip-radio"><input type="radio" name="who" value="${n}" ${i === 0 ? 'checked' : ''}>${n}${taken.has(n) ? ' (already set up)' : ''}</label>`)}
      <label class="chip chip-radio"><input type="radio" name="who" value="">Someone else</label>
    </div>
    <label class="field ck-other"><span class="field-label">Their name <small>(only for “Someone else”)</small></span><input class="input" name="other" maxlength="24" autocomplete="off"></label></fieldset>
    <fieldset class="field"><legend class="field-label">What are you working toward?</legend><div class="chip-grid">
      ${WEIGH_GOALS.map((g, i) => html`<label class="chip chip-radio"><input type="radio" name="goal" value="${g.id}" ${i === 0 ? 'checked' : ''}>${g.label}</label>`)}
    </div><p class="muted small">Only a direction. There’s no goal weight and nothing to hit.</p></fieldset>
    <fieldset class="field"><legend class="field-label">Where should the numbers be kept?</legend><div class="chip-grid">
      <label class="chip chip-radio"><input type="radio" name="keep" value="family" checked>With the family</label>
      <label class="chip chip-radio"><input type="radio" name="keep" value="device">Only on this phone</label>
    </div><p class="muted small">“With the family” backs them up and shows them on the family’s phones, computers and the TV, so you can cheer each other on. “Only on this phone” keeps them to yourself; they’re gone if this phone’s browser data is cleared.</p></fieldset>
    <label class="field ck-lb"><span class="field-label">Today’s weight, in pounds</span><input class="input" name="lb" type="number" inputmode="decimal" min="${LB_MIN}" max="${LB_MAX}" step="0.1" required></label>
    <button type="submit" class="btn btn-primary btn-block">Start my weekly weigh-in</button>
    <button type="button" class="btn btn-quiet btn-block" data-action="weigh:cancel-setup">Not now</button>
  </form>`;
}

function myWeighCard(app, me, today) {
  const weights = myWeights(app, me);
  const t = weighTrend(weights, { today, goal: me.goal, day: checkinDay(app.state) });
  const all = weighSeries(weights).reverse();
  const thisWeek = t.doneThisWeek ? t.latest : null;
  return html`<section class="ck-card ck-weigh" id="ck-weigh" aria-labelledby="ckw-h">
    <div class="section-head"><h2 id="ckw-h" class="section-title">${ic('chart', { size: 22 })}${possessive(me.name)} weigh-in</h2>
      <span class="ck-where">${ic(me.keep === 'family' ? 'cloud' : 'lock', { size: 16 })}${me.keep === 'family' ? 'Shared with the family' : 'Only on this phone'}</span></div>
    ${trendBlock(t)}
    ${weighLine(t.weeks, me.name)}
    <form class="form form-row ck-entry" data-submit="weigh:save" autocomplete="off">
      <label class="field ck-lb"><span class="field-label">${thisWeek ? 'Change this week’s weight' : 'This week’s weight'} <small>(lb)</small></span><input class="input" id="ck-lb" name="lb" type="number" inputmode="decimal" min="${LB_MIN}" max="${LB_MAX}" step="0.1" value="${thisWeek ? thisWeek.lb : ''}" required></label>
      <input type="hidden" name="date" value="${thisWeek ? thisWeek.date : today}">
      <button type="submit" class="btn btn-primary">${thisWeek ? 'Update' : 'Save'}</button>
    </form>
    <p class="muted small">Once a week is plenty: same day, same time of day, same scale. Skipping a week is fine.</p>
    ${when(all.length, () => html`<details class="cover-more"><summary>Every weigh-in (${all.length})</summary>
      <ul class="receipt-list">${all.map((p) => html`<li class="receipt-row"><span><b>${fmtLb(p.lb)}</b><small>${weekdayName(p.date)}, ${mediumDate(p.date)}</small></span><span></span>
        <button type="button" class="icon-btn" data-action="weigh:remove" data-date="${p.date}" aria-label="Remove the weigh-in from ${shortDate(p.date)}">${ic('trash', { size: 20 })}</button></li>`)}</ul></details>`)}
    <details class="cover-more ck-settings"><summary>Weigh-in settings</summary>
      <div class="opt"><span class="opt-label">Working toward</span>${segmented('weighGoal', WEIGH_GOALS, me.goal, { label: 'Working toward', action: 'weigh:goal', small: true })}</div>
      <div class="opt"><span class="opt-label">Kept</span>${segmented('weighKeep', [{ id: 'family', label: 'With the family' }, { id: 'device', label: 'Only on this phone' }], me.keep, { label: 'Where the weigh-ins are kept', action: 'weigh:keep', small: true })}</div>
      <button type="button" class="btn btn-danger-quiet btn-small" data-action="weigh:forget">Stop, and erase my weigh-ins</button>
    </details>
  </section>`;
}

function sharedCard(app, s, today, canClaim) {
  const t = weighTrend(s.weights, { today, goal: s.goal, day: checkinDay(app.state) });
  return html`<section class="ck-card ck-weigh ck-shared" aria-label="${possessive(s.name)} weigh-in">
    <div class="section-head"><h2 class="section-title">${ic('chart', { size: 22 })}${possessive(s.name)} weigh-in</h2><span class="ck-where">${ic('cloud', { size: 16 })}Shared by ${s.name}</span></div>
    ${trendBlock({ ...t, doctor: '' })}
    ${weighLine(t.weeks, s.name)}
    ${when(canClaim, () => html`<button type="button" class="btn btn-secondary btn-small" data-action="weigh:claim" data-name="${s.name}">This is me: weigh in from this phone</button>`)}
  </section>`;
}

function weighSection(app, today) {
  if (hiddenHere(app)) {
    return html`<section class="ck-card ck-weigh ck-tv" aria-labelledby="ckw-h"><h2 id="ckw-h" class="section-title">${ic('chart', { size: 22 })}Weigh-in</h2>
      <p class="small">Weigh-ins are turned off for the TV. Open the planner on a phone to add or see them.</p></section>`;
  }
  const me = app.store.device.weigh;
  const shared = sharedWeighIns(app.state).filter((s) => !(me && me.keep === 'family' && s.name === me.name));
  return html`
    ${me ? myWeighCard(app, me, today)
    : html`<section class="ck-card ck-weigh" id="ck-weigh" aria-labelledby="ckw-h">
        <h2 id="ckw-h" class="section-title">${ic('chart', { size: 22 })}A weekly weigh-in, if you want one</h2>
        <p class="small">Optional, and done together. One number a week and a plain trend: no goal weight, no calorie count, no score.</p>
        <p class="muted small">A scale doesn’t help everyone. If weighing in adds stress, leave this off: the dinners work the same without it. And weight that’s dropping without trying is one for your doctor, not for an app.</p>
        ${app.ui.weighSetup ? setupForm(app, shared) : html`<button type="button" class="btn btn-secondary" data-action="weigh:open-setup">Set up my weigh-in</button>`}
      </section>`}
    ${shared.map((s) => sharedCard(app, s, today, !me))}`;
}

// ---------------------------------------------------------------- the page

export function render(app) {
  const today = app.today();
  const week = shownWeek(app.state, today);
  const m = moneyCheckin(app.db, app.state, today, week);
  const day = checkinDay(app.state);
  return html`<div class="page page-checkin">
    <header class="page-head"><div><h1 class="page-title">Weekly check-in</h1>
      <p class="muted ck-week">${m.week.done ? 'The week of' : 'This week so far,'} ${weekLabel(week)}</p></div></header>
    <div class="ck-grid">
      <div class="ck-col">${moneyCard(app, m, week)}${dinnersCard(app, week)}</div>
      <div class="ck-col">${weighSection(app, today)}
        <section class="ck-card ck-day" aria-labelledby="ckday-h">
          <h2 id="ckday-h" class="section-title">Check-in day</h2>
          <div class="chip-grid" role="radiogroup" aria-label="Check-in day">${DAYS.map((d, i) => html`<button type="button" role="radio" aria-checked="${i === day ? 'true' : 'false'}" class="chip ${i === day ? 'is-on' : ''}" data-action="checkin:day" data-value="${i}" aria-label="${DAY_NAMES[i]}">${d}</button>`)}</div>
          <p class="muted small">The week ends on ${DAY_NAMES[day]}, and Tonight offers the check-in that day.</p>
          <div class="set-row ck-tv-row"><span class="set-label">Show weigh-ins on the TV<small>Off hides them on the TV only; phones still show them.</small></span>${switchToggle({ on: weighOnTv(app), action: 'checkin:tv', label: 'Show weigh-ins on the TV' })}</div>
        </section>
      </div>
    </div>
  </div>`;
}

/**
 * Tonight's reminder (shown on the check-in day and a couple of days after, until it's done or waved
 * off). It carries the week's grocery total and never a weight.
 */
export function checkinCard(app) {
  const today = app.today();
  const due = dueWeek(app.state, today);
  const me = hiddenHere(app) ? null : app.store.device?.weigh;
  const day = checkinDay(app.state);
  const cur = weekOf(today, day);
  const weighDue = !!me && (!!due || cur.end === today) && !weighTrend(myWeights(app, me), { today, goal: me.goal, day }).doneThisWeek;
  if (!due && !weighDue) return '';
  const key = `checkin:${(due || cur).start}`;
  if (isDismissed(app, key)) return '';
  const s = due ? weekSpend(app.state, due) : null;
  return html`<section class="tcard checkin-card" id="checkin-card" aria-labelledby="ckc-h">
    <div class="section-head"><h2 id="ckc-h" class="section-title">${ic('chart', { size: 22 })}Weekly check-in</h2></div>
    <p class="small">${s ? html`${weekLabel(due)}: <b>${money(s.total)}</b> on groceries${s.trips ? ` in ${s.trips} ${s.trips === 1 ? 'trip' : 'trips'}` : ''}. Two minutes to see where the month stands.` : ''}${weighDue ? ' Your weigh-in is ready too.' : ''}</p>
    <div class="ck-card-actions">
      <a class="btn btn-secondary btn-small" href="#/checkin">Open the check-in</a>
      <button type="button" class="btn btn-quiet btn-small" data-action="lighter:dismiss" data-key="${key}">Not now</button>
    </div>
  </section>`;
}

// ---------------------------------------------------------------- actions

const saveMine = (app, weigh) => app.store.setDevice({ weigh });

export const actions = {
  'checkin:done': (app, el) => {
    const week = { start: el.dataset.start, end: el.dataset.end };
    app.commit(moneyCheckedOps(app.state, { week, spent: weekSpend(app.state, week).total, who: app.who() }));
  },
  'checkin:undone': (app, el) => app.commit(moneyUncheckedOps(app.state, { week: { start: el.dataset.start, end: el.dataset.end } })),
  'checkin:day': (app, el) => {
    const n = Number(el.dataset.value);
    if (!Number.isInteger(n) || n < 0 || n > 6) return;
    app.commit({ ...settingOps(app.state, 'checkinDay', n), message: `The check-in is on ${DAY_NAMES[n]}s now.` });
  },
  'checkin:tv': (app) => {
    const on = !weighOnTv(app);
    app.commit({ ...settingOps(app.state, 'weighOnTv', on), message: on ? 'Weigh-ins show on the TV.' : 'Weigh-ins are hidden on the TV.' });
  },
  'weigh:open-setup': (app) => { app.ui.weighSetup = true; app.render(); },
  'weigh:cancel-setup': (app) => { app.ui.weighSetup = false; app.render(); },
  'weigh:setup': (app, form) => {
    const f = new FormData(form);
    const name = cleanName(String(f.get('who') || '') || String(f.get('other') || ''));
    const lb = parseLb(f.get('lb'));
    delete form.dataset.submitted;
    if (!name) { toast('Type a name for “Someone else”.'); return; }
    if (lb == null) { toast(`Enter a weight between ${LB_MIN} and ${LB_MAX} lb.`); return; }
    const goal = String(f.get('goal') || 'steady');
    const keep = f.get('keep') === 'family' ? 'family' : 'device';
    const today = app.today();
    if (keep === 'family') app.commit(weighOps(app.state, { name, date: today, lb, goal }), { quiet: true });
    app.ui.weighSetup = false;
    saveMine(app, { name, goal, keep, weights: keep === 'family' ? {} : { [today]: lb } });
    toast(`Saved. Next weigh-in: ${DAY_NAMES[checkinDay(app.state)]}.`);
  },
  'weigh:save': (app, form) => {
    const me = app.store.device.weigh;
    if (!me) return;
    const f = new FormData(form);
    const lb = parseLb(f.get('lb'));
    const date = String(f.get('date') || app.today());
    if (lb == null) { delete form.dataset.submitted; toast(`Enter a weight between ${LB_MIN} and ${LB_MAX} lb.`); return; }
    if (me.keep === 'family') app.commit(weighOps(app.state, { name: me.name, date, lb, goal: me.goal }));
    else { saveMine(app, { ...me, weights: { ...me.weights, [date]: lb } }); toast(`Saved ${fmtLb(lb)}.`); }
  },
  'weigh:remove': (app, el) => {
    const me = app.store.device.weigh;
    if (!me) return;
    const date = el.dataset.date;
    if (me.keep === 'family') { app.commit(removeWeighOps(app.state, { name: me.name, date })); return; }
    const was = me.weights[date];
    const weights = { ...me.weights };
    delete weights[date];
    saveMine(app, { ...me, weights });
    toast('Weigh-in removed.', { undo: () => { const now = app.store.device.weigh; if (now) saveMine(app, { ...now, weights: { ...now.weights, [date]: was } }); } });
  },
  'weigh:goal': (app, el) => {
    const me = app.store.device.weigh;
    if (!me || !WEIGH_GOALS.some((g) => g.id === el.dataset.value)) return;
    saveMine(app, { ...me, goal: el.dataset.value });
    if (me.keep === 'family') app.commit(weighGoalOps(app.state, { name: me.name, goal: el.dataset.value }), { quiet: true });
  },
  'weigh:keep': async (app, el) => {
    const me = app.store.device.weigh;
    const to = el.dataset.value === 'family' ? 'family' : 'device';
    if (!me || me.keep === to) return;
    if (to === 'family') {
      app.commit(shareWeighOps(app.state, { name: me.name, goal: me.goal, weights: me.weights }), { quiet: true });
      saveMine(app, { ...me, keep: 'family', weights: {} });
      toast('Your weigh-ins are shared with the family now.');
    } else {
      const weights = Object.fromEntries(weighSeries(app.state.checkin?.weights?.[me.name]).map((p) => [p.date, p.lb]));
      saveMine(app, { ...me, keep: 'device', weights });
      app.commit(forgetWeighOps(app.state, { name: me.name }), { quiet: true });
      toast('Your weigh-ins are only on this phone now.');
    }
  },
  'weigh:forget': async (app) => {
    const me = app.store.device.weigh;
    if (!me) return;
    const ok = await confirmSheet({ title: 'Erase your weigh-ins?', body: me.keep === 'family' ? 'Every weigh-in is removed from this phone and from the family’s storage. This can’t be undone.' : 'Every weigh-in is removed from this phone. This can’t be undone.', confirm: 'Erase them', danger: true });
    if (!ok) return;
    if (me.keep === 'family') app.commit(forgetWeighOps(app.state, { name: me.name }), { quiet: true });
    saveMine(app, null);
    toast('Erased. The weigh-in is off.');
  },
  'weigh:claim': (app, el) => {
    const s = sharedWeighIns(app.state).find((x) => x.name === el.dataset.name);
    if (!s) return;
    saveMine(app, { name: s.name, goal: s.goal, keep: 'family', weights: {} });
  },
};
