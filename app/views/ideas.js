// WHAT CAN I MAKE? (SPEC §17): snap up to four photos of food to use, add a note, and Claude
// suggests dinners from them and the pantry. Each idea can be made tonight, put on a night in
// the next month, or saved to the recipe box. Missing ingredients go on the shopping list.
import { html, ic, when, openSheet, renderSheet, toast, sheetId } from '../ui.js';
import { EQUIPMENT_LABELS } from '../config.js';
import { addDays, dayWord, shortDate, money, listJoin, midSentence, fmtQty } from '../util.js';
import { resizeImage, LIMITS } from '../images.js';
import { dinnerById } from '../planner.js';
import { nightName } from '../actions.js';
import { modelLabel, claudeErrorText } from '../claude.js';
import {
  MAX_IDEA_PHOTOS, NOTE_MAX, IDEA_NIGHTS, buildIdeasRequest, normalizeIdeas, missingCost, saveIdeaOps, savedIdeaId,
  openNightsAfter, pantryWords,
} from '../ideas.js';
import { fmtMinutes, timeLabel } from '../cooking.js';
import { awayReason } from './common.js';
import { loadAiInfo, aiInfo } from './family.js';

/** The sheet's state: the photos and note being sent, then Claude's ideas. Lives while the app is open. */
let st = null;
const fresh = () => ({ photos: [], note: '', phase: 'pick', ideas: [], model: '', error: '', busy: false });

const connected = (app) => !!app.store.device.key && !app.store.device.localOnly;

export function openIdeas(app, { keepResults = false } = {}) {
  if (!connected(app)) {
    openSheet({
      id: 'ideas-gate',
      title: 'Ideas need the family server',
      render: () => html`<p class="sheet-text">${app.store.device.localOnly ? 'This device is set to “this device only.”' : 'This device isn’t connected to the family yet.'} Claude reads the photos through the family’s server, so connect with the family passcode first.</p>
        <div class="sheet-actions"><a class="btn btn-primary btn-block" href="#/family">Family & settings</a></div>`,
    });
    return;
  }
  // Still thinking: show the progress. Otherwise a fresh start, unless asked for the last ideas.
  if (st?.phase !== 'busy' && !(keepResults && st?.phase === 'done')) {
    for (const p of st?.photos || []) URL.revokeObjectURL(p.preview);
    st = fresh();
  }
  show(app);
  // A heads-up before anyone takes photos: Claude isn't on yet, or this month's budget is spent.
  loadAiInfo(app).then(() => { if (sheetId() === 'ideas' && st?.phase === 'pick') renderSheet(); });
}

function show(app) {
  const done = st.phase === 'done';
  openSheet({
    id: 'ideas',
    size: 'tall',
    live: done,
    title: done ? (st.ideas.length === 1 ? 'One idea for dinner' : `${st.ideas.length || 'No'} ideas for dinner`) : 'What can I make?',
    subtitle: done ? '' : 'Snap the food you want to use. Claude suggests dinners from it and what’s in the pantry.',
    render: () => body(app),
  });
}

function body(app) {
  if (st.phase === 'busy') {
    return html`<div class="scan-progress" role="status"><span class="spinner" aria-hidden="true"></span>
      <p>Claude is looking at ${st.photos.length ? (st.photos.length === 1 ? 'your photo' : `your ${st.photos.length} photos`) : 'the pantry'}…</p>
      <p class="muted small">This takes about half a minute.</p></div>`;
  }
  if (st.phase === 'error') {
    return html`<p class="sheet-text" role="alert">${st.error}</p>
      <div class="sheet-actions">
        <button type="button" class="btn btn-primary btn-block" data-action="ideas:go">Try again</button>
        <button type="button" class="btn btn-quiet btn-block" data-action="ideas:back">Back to the photos</button>
      </div>`;
  }
  if (st.phase === 'done') return results(app);
  return pick(app);
}

function pick(app) {
  const info = aiInfo();
  const warn = info && !info.keySet ? 'Claude isn’t turned on yet. Once Jeff adds the Claude key to the family server, this works.'
    : info?.capped ? 'This month’s Claude budget is used up. It’s back on the 1st.' : '';
  const room = MAX_IDEA_PHOTOS - st.photos.length;
  return html`
    ${when(warn, () => html`<p class="hint hint-warn">${ic('info', { size: 18 })}<span>${warn}</span></p>`)}
    <div class="rcpt-pick">
      <label class="btn btn-secondary rcpt-file ${room ? '' : 'is-off'}">${ic('camera', { size: 20 })}Take a photo<input type="file" accept="image/*" capture="environment" data-change="ideas:files" class="sr-only" ${room ? '' : 'disabled'}></label>
      <label class="btn btn-secondary rcpt-file ${room ? '' : 'is-off'}">${ic('plus', { size: 20 })}Add photos<input type="file" accept="image/*" multiple data-change="ideas:files" class="sr-only" data-testid="ideas-files" ${room ? '' : 'disabled'}></label>
    </div>
    ${when(st.photos.length, () => html`<ul class="rcpt-thumbs idea-thumbs">${st.photos.map((p, k) => html`<li><img src="${p.preview}" alt="Photo ${k + 1}"><button type="button" class="icon-btn" data-action="ideas:unpick" data-k="${k}" aria-label="Remove photo ${k + 1}">${ic('close', { size: 18 })}</button></li>`)}</ul>`)}
    <label class="field idea-note-field"><span class="field-label">Anything to use up or skip? <small>Optional</small></span>
      <textarea class="input idea-note" id="idea-note" maxlength="${NOTE_MAX}" rows="2" data-input="ideas:note" placeholder="Use the chicken thighs">${st.note}</textarea></label>
    <button type="button" class="btn btn-primary btn-block" data-action="ideas:go" ${st.busy ? 'disabled' : ''}>${ic('sparkle', { size: 20 })}Get ideas</button>
    <p class="muted small">Up to ${MAX_IDEA_PHOTOS} photos: the fridge, the counter, a pack of chicken. No photos? Claude works from the pantry list.</p>`;
}

// ---------------------------------------------------------------- the ideas

/** Live from the family state, so Undo (or another phone) shows right away. */
function ideaStatus(app, idea) {
  const id = savedIdeaId(app.state, idea);
  if (!id) return null;
  const today = app.today();
  const nights = Object.entries(app.state.plan || {}).filter(([d, e]) => d >= today && e?.dinner === id && e.status !== 'away').map(([d]) => d).sort();
  return { id, inBox: app.state.customDinners?.[id]?.rotation !== 'bench', nights };
}

/** "30 min", or "20 min hands-on, 6 hr 20 min in all" when most of it cooks on its own (a slow cook). */
const timeText = (idea) => timeLabel(idea) || fmtMinutes(idea.minutes);

/** "Stovetop and air fryer"; brand names keep their capitals ("Stovetop and PossibleCooker"). */
const BRAND_GEAR = ['blackstone', 'possible cooker'];
const equipmentText = (list) => listJoin(list.map((e, i) => { const t = EQUIPMENT_LABELS[e] || e; return i && !BRAND_GEAR.includes(e) ? t.toLowerCase() : t; }));

/** "2 lemons", "1 bunch fresh basil", "1½ lb ground beef": the unit only when the name doesn't say it. */
function lineText(m) {
  const name = midSentence(m.name);
  if (!(m.qty > 0)) return name;
  const u = String(m.unit || '').toLowerCase().trim();
  const stem = u.replace(/(es|s)$/, '');
  const unit = u && !/^(each|whole|count|pieces?)$/.test(u) && !(stem.length > 2 && name.toLowerCase().includes(stem)) ? ` ${m.unit}` : '';
  return `${fmtQty(m.qty)}${unit} ${name}`;
}

function ideaCard(app, idea, k) {
  const today = app.today();
  const s = ideaStatus(app, idea);
  const uses = pantryWords(app.db, app.state, idea.usesPantry);
  const cost = idea.missing.length ? missingCost(app.db, app.state, idea) : null;
  const sides = (s ? dinnerById(app.db, app.state, s.id)?.sides : idea.sides) || [];
  const sideNames = sides.map((id) => app.db.sides[id]?.title).filter(Boolean).map(midSentence);
  return html`<article class="idea-card" data-k="${k}">
    <h3 class="idea-title">${idea.title}</h3>
    ${when(idea.subtitle, () => html`<p class="idea-sub">${idea.subtitle}</p>`)}
    ${when(idea.why, () => html`<p class="idea-why">${idea.why}</p>`)}
    <p class="idea-meta">${ic('clock', { size: 16 })}<span>${timeText(idea)} · ${equipmentText(idea.equipment)}</span></p>
    ${when(sideNames.length, () => html`<p class="idea-line"><b>Sides:</b> ${listJoin(sideNames)}</p>`)}
    ${when(uses.length, () => html`<p class="idea-line"><b>Uses from your pantry:</b> ${listJoin(uses)}</p>`)}
    ${idea.missing.length
      ? html`<p class="idea-line idea-need"><b>You’d need:</b> ${listJoin(idea.missing.map(lineText))}${cost?.priced ? html`<span class="idea-cost">, about ${money(cost.cost)}${cost.unpriced.length ? ` (not counting ${listJoin(cost.unpriced.map((n) => midSentence(n)))})` : ''}</span>` : ''}</p>`
      : html`<p class="idea-line idea-ready">${ic('checkCircle', { size: 16 })}<span>Everything it needs is in the pantry.</span></p>`}
    ${when(s, () => html`<p class="badges idea-badges">
      ${s.nights.map((d) => html`<span class="badge badge-plan">${ic('plan', { size: 14 })}On for ${d === today ? 'tonight' : `${dayWord(d, today).toLowerCase() === 'tomorrow' ? 'tomorrow' : dayWord(d, today)}, ${shortDate(d)}`}</span>`)}
      ${when(s.inBox, () => html`<span class="badge badge-fav">${ic('recipes', { size: 14 })}In the recipe box</span>`)}
      <a class="link-btn idea-open" href="#/recipe/${s.id}">Open the recipe</a></p>`)}
    <details class="idea-steps"><summary>How to make it</summary><ol class="steps-small">${idea.steps.map((t) => html`<li>${t}</li>`)}</ol></details>
    <div class="idea-acts">
      <button type="button" class="btn btn-primary" data-action="ideas:tonight" data-k="${k}" ${s?.nights.includes(today) ? 'disabled' : ''}>${ic('flame', { size: 20 })}${s?.nights.includes(today) ? 'On for tonight' : 'Make it tonight'}</button>
      <button type="button" class="btn btn-secondary" data-action="ideas:night" data-k="${k}">${ic('plan', { size: 20 })}Put it on a night…</button>
      <button type="button" class="btn btn-quiet" data-action="ideas:box" data-k="${k}" ${s?.inBox ? 'disabled' : ''}>${ic('recipes', { size: 20 })}${s?.inBox ? 'In the recipe box' : 'Save to the recipe box'}</button>
    </div>
  </article>`;
}

function results(app) {
  const by = st.model ? modelLabel(st.model) : 'Claude';
  return html`
    <p class="read-by">${ic('sparkle', { size: 16 })}Ideas from ${by}${st.sent ? `, from ${st.sent}` : ''}</p>
    ${st.ideas.length ? st.ideas.map((idea, k) => ideaCard(app, idea, k))
      : html`<p class="sheet-text">Claude didn’t come up with a dinner that fits the house rules this time. Try another photo, or a note like “use the ground beef”.</p>`}
    <div class="sheet-actions"><button type="button" class="btn btn-quiet btn-block" data-action="ideas:back">${ic('camera', { size: 20 })}Try other photos</button></div>`;
}

// ---------------------------------------------------------------- asking Claude

async function photosFor(files) {
  let images = [];
  for (const f of files) images.push(await resizeImage(f, LIMITS.pantry));
  // Together they must fit the server's limit, like a receipt's images.
  if (images.reduce((t, x) => t + x.length, 0) > LIMITS.receiptTotalChars) {
    const each = Math.floor(LIMITS.receiptTotalChars / images.length);
    images = [];
    for (const f of files) images.push(await resizeImage(f, { ...LIMITS.pantry, max: 1100, maxChars: each }));
  }
  return images;
}

async function getIdeas(app) {
  if (!st || st.busy) return;
  if (navigator.onLine === false) { st.phase = 'error'; st.error = claudeErrorText({ status: 0 }); show(app); return; }
  st.busy = true;
  st.phase = 'busy';
  show(app);
  let images;
  try {
    images = await photosFor(st.photos.map((p) => p.file));
  } catch {
    st.busy = false; st.phase = 'error'; st.error = 'One of those photos couldn’t be opened. Try taking it again.';
    if (sheetId() === 'ideas') show(app);
    return;
  }
  try {
    const req = buildIdeasRequest(app.db, app.state, { images, note: st.note });
    const r = await app.store.api('POST', '/api/ideas', req, { timeoutMs: 150000 });
    st.ideas = normalizeIdeas(app.db, app.state, r);
    st.model = String(r?.model || '');
    st.sent = images.length ? (images.length === 1 ? 'your photo and the pantry' : `your ${images.length} photos and the pantry`) : 'the pantry';
    st.phase = 'done';
  } catch (e) {
    st.phase = 'error';
    st.error = claudeErrorText(e);
    if (e?.status === 402 || e?.status === 503) loadAiInfo(app, { force: true });
  } finally {
    st.busy = false;
  }
  if (sheetId() === 'ideas') show(app);
  else if (st.phase === 'done' && st.ideas.length) toast(`Claude has ${st.ideas.length === 1 ? 'a dinner idea' : `${st.ideas.length} dinner ideas`} ready.`, { action: { label: 'See them', fn: () => openIdeas(app, { keepResults: true }) }, duration: 15000 });
}

// ---------------------------------------------------------------- putting an idea on a night

function commitIdea(app, idea, opts) {
  const res = saveIdeaOps(app.db, app.state, idea, { ...opts, who: app.who(), today: app.today() });
  if (res.error || !res.ops.length) { toast(res.message); return false; }
  app.commit(res);
  return true;
}

/** Puts an idea on `date`, asking first when the night already has a dinner (or the family is out). */
function placeOn(app, k, date) {
  const idea = st?.ideas[k];
  if (!idea) return;
  const today = app.today();
  const e = app.state.plan?.[date];
  const back = () => (sheetId() === 'ideas' ? renderSheet() : show(app)); // stay put on the ideas when they're open
  const savedId = savedIdeaId(app.state, idea);
  if (e?.status === 'cooked') { toast(`${nightName(date, today).replace(/^./, (c) => c.toUpperCase())} is already cooked. Pick another night.`); return; }
  const other = e?.dinner && e.status === 'planned' && e.dinner !== savedId ? dinnerById(app.db, app.state, e.dinner) : null;
  if (!other && e?.status !== 'away') { if (commitIdea(app, idea, { to: 'night', date })) back(); return; }
  const night = nightName(date, today).replace(/^./, (c) => c.toUpperCase());
  const open = other ? openNightsAfter(app.state, date, { days: 14, limit: 1 })[0] : null;
  openSheet({
    id: 'ideas-replace',
    title: other ? `${night} already has ${other.title}` : `${night} is marked ${awayReason(e).label.toLowerCase()}`,
    render: () => html`
      <p class="sheet-text">${other ? `Make ${idea.title} instead?` : `Cook ${idea.title} at home that night instead?`}</p>
      <div class="sheet-actions">
        ${when(open, () => html`<button type="button" class="btn btn-primary btn-block" data-action="ideas:replace" data-k="${k}" data-date="${date}" data-move="${open}">Yes, and move it to ${nightName(open, today)}</button>`)}
        <button type="button" class="btn ${open ? 'btn-secondary' : 'btn-primary'} btn-block" data-action="ideas:replace" data-k="${k}" data-date="${date}">${other ? 'Yes, replace it' : 'Yes, we’re home'}</button>
        <button type="button" class="btn btn-quiet btn-block" data-action="ideas:results">Back to the ideas</button>
      </div>`,
  });
}

function openNightPicker(app, k) {
  const idea = st?.ideas[k];
  if (!idea) return;
  const today = app.today();
  const nights = Array.from({ length: IDEA_NIGHTS }, (_, i) => addDays(today, i));
  openSheet({
    id: 'ideas-night',
    size: 'tall',
    title: `Put ${idea.title} on a night`,
    subtitle: 'The next month. A night that has a dinner asks before replacing it.',
    render: () => html`<ul class="move-list">${nights.map((d) => {
      const e = app.state.plan?.[d];
      const dd = e?.dinner ? dinnerById(app.db, app.state, e.dinner) : null;
      const cooked = e?.status === 'cooked';
      const what = e?.status === 'away' ? `Away: ${awayReason(e).label}` : dd ? (cooked ? `${dd.title} (cooked)` : `Has ${dd.title}`) : 'Open';
      return html`<li><button type="button" class="move-row ${!dd && e?.status !== 'away' ? 'is-open' : ''}" data-action="ideas:pick-night" data-k="${k}" data-date="${d}" ${cooked ? 'disabled' : ''}>
        <span class="move-day"><b>${dayWord(d, today)}</b><small>${shortDate(d)}</small></span><span class="move-what">${what}</span>${ic('right', { size: 18 })}
      </button></li>`;
    })}</ul>
    <div class="sheet-actions"><button type="button" class="btn btn-quiet btn-block" data-action="ideas:results">Back to the ideas</button></div>`,
  });
}

export const actions = {
  'ideas:open': (app) => openIdeas(app),
  'ideas:files': (app, el) => {
    if (!st) return;
    const files = [...(el.files || [])].filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|heic|heif|webp)$/i.test(f.name));
    const room = MAX_IDEA_PHOTOS - st.photos.length;
    if (files.length > room) toast(`Up to ${MAX_IDEA_PHOTOS} photos at a time.`);
    for (const f of files.slice(0, Math.max(0, room))) st.photos.push({ file: f, preview: URL.createObjectURL(f) });
    el.value = '';
    renderSheet();
  },
  'ideas:unpick': (app, el) => {
    const [p] = st?.photos.splice(Number(el.dataset.k), 1) || [];
    if (p) URL.revokeObjectURL(p.preview);
    renderSheet();
  },
  'ideas:note': (app, el) => { if (st) st.note = el.value.slice(0, NOTE_MAX); },
  'ideas:go': (app) => getIdeas(app),
  'ideas:back': (app) => { if (!st) return; st.phase = 'pick'; st.error = ''; show(app); },
  'ideas:results': (app) => { if (st?.phase === 'done') show(app); },
  'ideas:tonight': (app, el) => placeOn(app, Number(el.dataset.k), app.today()),
  'ideas:night': (app, el) => openNightPicker(app, Number(el.dataset.k)),
  'ideas:pick-night': (app, el) => placeOn(app, Number(el.dataset.k), el.dataset.date),
  'ideas:replace': (app, el) => {
    const idea = st?.ideas[Number(el.dataset.k)];
    if (idea && commitIdea(app, idea, { to: 'night', date: el.dataset.date, moveTo: el.dataset.move || null })) show(app);
  },
  'ideas:box': (app, el) => {
    const idea = st?.ideas[Number(el.dataset.k)];
    if (idea && commitIdea(app, idea, { to: 'box' })) renderSheet();
  },
};
