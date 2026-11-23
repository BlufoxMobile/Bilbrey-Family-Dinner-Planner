# 30. Plan with Claude (v3.7.0)

Jeff, Nov 23: “I would also like for the app to utilize claude to help me smart plan recipes for
each day instead of just being random. I would love for Claude to plan out each meal for me based
on what I have, cost, and healthy eating.”

The planner's own pass (SPEC §16, §21) scores dinners and breaks ties with a seeded shuffle. It
uses the pantry well, but it can't weigh a week as a whole or say why it chose a night. Plan with
Claude hands the choice to Claude, inside the family's recipe box and house rules, and keeps every
reason.

## 30.1 Where it is

The **Plan ahead** sheet, when this device is connected and the Claude key is set (and the month's
$5 isn't spent):

- **Plan it with Claude** is the primary button, with one line under it: Claude picks each night
  from what's in the house, the cost and lighter plates, says why, and uses a few cents of the
  month's budget.
- **Plan it the quick way** is the old planner, one quiet tap away.
- Without Claude the sheet is exactly as before (one **Plan it** button).

The stretch (1 week, 2 weeks, longer or a date) and the two options apply to both ways:

- *Use what we have first*: when off, Claude weighs cost, health and variety ahead of the pantry.
- *Let it replace dinners the app picked*: Claude may change the planner's (or its own) earlier
  picks. Never tonight's dinner, never one the family chose, never a cooked or away night.
- *Let Claude rethink dinners you chose* (only with Claude, only when the stretch has some; off by
  default): the family's own picks become Claude's to reconsider too. Claude is told the family
  picked them and keeps the ones that still fit. Never tonight's. When everything else is planned,
  the sheet points to this switch instead of saying there's nothing to do.

While Claude works (about half a minute) the sheet says so; it can be closed, and the plan is still
saved when the answer comes, with a toast. On failure the sheet says what happened in plain words
and offers **Try again**, **Plan it the quick way** and **Back**.

## 30.2 What Claude is told (app/smartplan.js → POST /api/plan)

`smartPlanRequest()` builds one compact JSON (about 30 KB for 94 dinners):

| Field | What it holds |
|---|---|
| `nights` | Each date: `open` (empty), `change` (the app's pick, or the family's when asked), or `keep` (tonight, cooked, away, the family's pick) with the current dinner and a note, busy nights marked |
| `dinners` | Every dinner in the rotation: minutes, protein, cost a serving, what the next trip costs for it, kcal / protein / lean / heavy, and what the pantry says: `all`, `thaw` (with minutes), `side` (a side is missing) or `short` (what's missing); food that spoils soon it uses; when it was last eaten; favorites |
| (which dinners) | The rotation, plus the family's usual dinners kept off it (deli trays and kits, `bought: true`) while their main is in the house, plus every dinner already on a night in the stretch so Claude can keep it (v3.7.1: a Rana lasagna best by tomorrow wasn't offered, so Claude dropped it) |
| `useSoon` | What spoils first and where it is |
| `freezer` | The meat and ready-made mains on hand, with the date each came home |
| `recent` | What was cooked in the last 21 days |
| `budget` | The month's target, what's spent, days left |

The Worker's prompt (`PLAN_SYSTEM_PROMPT`, cached) gives the order to choose in: what's in the
house (spoiling food and the oldest meat first), then cost, then healthy eating (mostly lean, at
most two heavy dinners a week, proteins mixed, beef two or three times a week at most), then
variety (no repeats, nothing from the last ten days), then effort (busy nights 30 minutes or less,
tonight quick). A ready-made main in the house that spoils within the stretch gets a dinner night before its last
good day, ahead of cost, the heavy-dinner limit and variety; lunches are planned separately, so
Claude never counts on them to use it up. It answers JSON only: a dinner id and one plain sentence per night, and a one- or
two-sentence summary. It never calls a food good or bad, sets calorie targets, or mentions dieting.

## 30.3 How the answer is checked and saved

Twice: the Worker (`validatePlan`) and the app (`smartPlanOps`) each keep only nights Claude may
plan and dinner ids from the box, one per night, never a dinner twice in the stretch (a kept
night's dinner counts). The app checks against the plan **as it is when the answer arrives**, so a
night the family filled while Claude thought stays theirs.

- A changed night is saved as `{ dinner, sides, status: 'planned', manual: false, by: 'Claude', why }`.
- A night Claude kept only gains its `why`.
- Any open night Claude left out, and the packed lunches, are then planned the quick way, so nothing
  in the stretch is left empty.
- `state.planAhead` gets `claude: { summary, model, filled, nights: [{ date, dinner, why, changed }] }`.
- One Undo takes back all of it, the result card included.

## 30.4 What the family sees

- The result card: **Claude planned through Sunday, Nov 29**, Claude's summary, the money line
  (against the quick way when there were open nights), what it uses up, and **Why these dinners**:
  each night still ahead with the dinner and Claude's reason (open right after planning).
- The night sheet and Tonight's hero show the reason under the dinner, marked for screen readers
  as “Why Claude picked it”.

## 30.5 Cost and limits

About 10 K tokens in and 1–2 K out with Claude Opus 5.5: roughly 5–10¢ a plan, counted against the
$5 monthly cap like everything else Claude does. The Worker refuses more than 40 nights or 400
dinners, a body over 200 KB, or a stretch with nothing to plan (400); no key is a 503, a spent month
a 402, and a Claude failure or an answer that fits nothing a 502. `dev/mock-api.mjs` answers
`/api/plan` with a deterministic week (tests can script `db.planReply`).

Tests: `tests/smartplan.test.mjs`, the `/api/plan` cases in `worker/test/claude.test.mjs`, and the
last test in `tests/e2e/planner.e2e.mjs`.
