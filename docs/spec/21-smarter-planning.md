## 21. Smarter planning: the pantry gets a say, lean by default, no waste, fewer trips

> Jeff, 2026-11-15: "as smart as possible to really help me accomplish my mission of saving money on
> groceries, reducing spoilage, and helping me lose weight", with two or three store trips a month
> "so we aren't spending $12,000 next year". He had just thrown out freezer-burnt steak and corn.

Files: `app/planner.js` (scoring), `app/planahead.js`, `app/health.js`, `app/freshness.js`,
`app/waste.js` (new), `app/prep.js`, `app/coverage.js`, `app/shopping.js` (trip and budget math),
`app/views/plan.js`, `pantry.js`, `budget.js`, `styles/parts/planner.css`. Tests:
`tests/smarter.test.mjs`, `tests/e2e/planner.e2e.mjs`.

This section changes two older rules: §16.1 "only open nights are filled" (see 21.1) and §13.4's
use-by, which used to fall back on the last time an amount was edited (see 21.3).

### 21.1 Plan ahead really uses the pantry
The app has usually planned weeks ahead already, so filling only open nights changed almost nothing.
- `planAheadOps(db, state, { start, end, today, who, at, pantryFirst = true, replan = pantryFirst,
  record = true })`. With `replan`, nights **the planner chose itself** (planned, not `manual`) are
  re-planned too, from tomorrow on. Never touched: tonight's dinner (it may be thawed or started),
  nights set by hand, cooked nights, away nights (a leftovers night is one).
- It only re-plans when that helps: the re-planned stretch must put more dinners fully on the pantry,
  or cost at least $3 less to shop for (`REPLAN_MIN_SAVING`), than filling the open nights alone.
  Otherwise the planner's nights stay exactly as they are. A night that comes out the same isn't
  written again, so pressing it twice changes nothing ("…the plan already makes the most of the pantry").
- Returns `{ ops, undo, message, count, fromPantry, replanned, lunchPicks, unfilled, start, end, replan,
  before, after }`. `before` and `after` are `aheadStats(db, state, { start, end })` →
  `{ dinners, fromPantry, groceries, open }`: planned dinners, how many are fully stocked (counted down
  night by night, lunches first), and the list's total for the stretch. `before` fills any open nights
  the usual way first (`hadOpen: true`), so the grocery numbers compare like with like.
- The sheet has two switches: "Use what we have first" and "Re-plan the planner's picks" (on whenever
  the first is on, until switched by hand), and says how many nights are open, the planner's, or staying.
- The result card: "**7 of 14** dinners now come from the pantry (it was: 3)", "**About $148** in
  groceries (down from $212)", one plain sentence, then §16.4's card. It is saved with the plan as
  `state.planAhead = { start, end, pantryFirst, replan, before, changed, by, at }`, so it survives a
  reload, shows on the family's other screens, and goes with Undo. Closing it deletes the record; it
  hides by itself once `end` has passed.

### 21.2 Lean by default
- `settings.lean` (on unless `false`), switched on the Plan page under "Planning for". No calorie
  target, no good/bad foods: the planner just leans toward lighter, high-protein plates.
- `health.plateLean(db, state, dinnerId, entry)` → `{ kcal, proteinG, vegServings, lean, heavy, fried,
  known, why }`. It uses `nutrition.plateHealth(db, state, dinnerId, entry)` → `{ kcal, proteinG,
  vegServings, lean, why }` (and its `heavy`, if given) when that function exists; until then a plate
  is lean at ≤ 750 kcal with ≥ 30 g protein, and heavy at ≥ 1,100 kcal or when the dinner is fried
  (tag `fried`/`heavy`/`indulgent`, or "fried" in the title: not air-fried, stir-fried, refried or
  fried rice). Never both.
- Scoring (`leanScore`): lean +0.8, heavy −0.8, in between down to −0.5 by calories; a vegetable or
  salad on the plate +0.2 (none −0.2); protein ≥ 30% of calories +0.1. For scale a family favorite is
  +1.0, so favorites and variety still win their share.
- At most `HEAVY_MAX_PER_WEEK` (2) fried or heavy dinners a week. Burger and pizza nights are the
  comfort nights: they keep their type and their sides, and count toward the two.
- A two-side dinner with no vegetable or salad trades one side for a vegetable (`withVegetable`): the
  bread goes first, then fruit, soup, the second starch. The vegetable is one already in the house,
  then one that kind of dinner is served with, then one the family likes. A dinner whose sides the
  family chose themselves is left alone.
- Busy nights: `settings.busyNights` (Monday = 0 … Sunday = 6, like `burgerNights`; chips on the Plan
  page; the app can't know them otherwise). On those nights `effortOf(d)` decides: `handsOff` (a slow
  cook in the Ninja PossibleCooker: equipment `possible cooker` with 2+ hours or ≤ 20 active minutes,
  or a `slow cooker` tag) +1.1, `quick` (≤ 30 minutes) +0.5, normal −0.3, `long` (over 45) −0.9. A
  slow-cooker dinner is no longer penalized as a "long cook" on weeknights.
- The prep schedule adds a morning job for a slow-cooker dinner: "Start tonight's … in the
  PossibleCooker by 10 AM. It cooks about 8 hours on its own."

### 21.3 Stop waste before it happens
**The waste log.** The trash can on a pantry row asks what happened (`removeItemOps`), for all of it
or the amount typed:
- *Used it up* and *Wrong count*: the amount drops or the row goes; nothing is logged.
- *Threw it out*: also `waste[key] = { id, name, qty, unit, cost, reason: 'tossed', date, since?,
  estimated?, by, at }`. `cost` is the amount × the unit price of the product the family buys (half a
  pack for a staple with no amount; a saved plate of leftovers carries its own value).
- Budget shows dollars thrown out this month and last, what goes most often in the last 90 days, and
  every entry (removable). The Pantry page carries the month's total.
- The planner learns (`tossCounts`, the last 120 days): each toss raises that food's urgency by half
  (at least 1.5 while it's a perishable on the shelf), so it's planned sooner; a new pack of it counts
  for more waste when the planner weighs a dinner; and after two tosses the list buys it wherever the
  pack leaves the least unused (`storeWhy: 'wasted'`), unless the family chose its store.

**No came-home date.** `sinceOf(p)` is now `pantry[id].since` only. The last-edited time (`at`) is
not a came-home date: marking a dinner cooked used to make September's chicken look new. Perishables
with no `since` (`undated`) are listed on the Pantry page under "About when did these go in?" with
*This week* / *This month* / *Older* (3, 20 and 90 days back; `sinceAbout` records it was a guess).
Until answered, undated meat counts as old (urgency 3) and other perishables get a small nudge (½).

**The freezer.** `freezerWatch` lists everything in the freezer 60+ days, past its keep time (4 months
for meat, 6 otherwise, 3 for leftovers), or meat nobody dated. It shows on the Plan page with the
night that uses each one (or a button to plan ahead), in the Pantry's "Use these first", and as one of
today's prep jobs. The everyday planner (not only plan ahead) now adds 0.6 × the urgency of on-hand
food a dinner uses (capped at 8), so the oldest gets cooked first.

**Cooked, then leftovers.** Marking cooked takes exactly what the recipe used off the shelf, never
below zero, never a staple, and keeps each item's came-home date; unmarking puts it back (tested).
A cooked dinner then asks "any left?" (tonight and the next morning: Plan, Pantry, and the prep card
on Tonight). `leftoversOps` records `plan[date].leftovers = { use, … }`:
- *lunch*: the next packed lunch is skipped (reason "Leftover …"), so its groceries leave the list;
- *night*: one of the next three nights becomes a leftovers night (`status: 'away'`, `away.leftovers`,
  `manual`), never a cooked, away or hand-set one; nothing to cook or buy;
- *fridge* / *freezer*: a shelf item "Leftover …" counted in plates with today's date, so it has a
  use-by (4 days cold, 3 months frozen), shows under quick backups, and is logged if it's thrown out;
- *none*.

**Catching the pantry up.** Two ways the pantry drifted from the kitchen, both now caught:
- A past night (last 7 days) still marked planned: "Did these get cooked?" Yes runs the usual
  deduction; No opens the night and leaves the food.
- Packed lunches never took their food off the shelf. For past lunch days since 2026-11-16, not
  skipped, "They were packed" takes the food off once (`lunchUsed[date][name]`), "They weren't"
  settles them without it. Markers older than three weeks are cleared.
Measured items at zero move to a "Used up" list with one "Clear all".

### 21.4 Fewer trips, a visible goal
- `tripsIn(state, month)`: each day with a receipt is one trip (Sam's and Jewel the same day count
  once). `tripGoal` compares them with `settings.tripGoal` (2, 3 or 4; default 3) and says how many
  days each remaining trip has to cover. Budget shows it with a pip per trip.
- `yearPace(state, today, rate)`: "At this rate, about $X this year. Your target is $7,800 ($650 a
  month). The last 3 months averaged $Y." The rate is this month's receipts plus what the plan still
  needs; the average uses only months with receipts, and says so.
- `tripAdvice(db, state, { today })`: a trip list under `TRIP_MIN_DAYS` (10) says how many more days
  of food would skip the next run, what they add today, and offers **Extend the trip**
  (`extendTripOps`): the trip's end moves, its check-offs and skips come along, and open nights in the
  extra days are planned pantry first. Shown on Budget and Plan (and the List, once it calls
  `tripAdviceCard`).
- A two-store trip splits sensibly (`buildList({ split })`, the default for a list keyed
  `trip:…:both`): fresh, non-freezable food moves to the smaller pack when the usual one would leave
  over 40% unused and the smaller costs at most 15% more; food that keeps (freezer, shelf, raw meat)
  moves only when the other store is cheaper for what's needed and no dearer by the unit; and a store
  left with one or two things under $15 is dropped when the other carries them for at most $5 more.
  A store the family chose for an item is never changed. `list.split = { on, moved: [{ id, name, from,
  to, why, saves }], saved }`; items carry `storeWhy`.

### 21.5 State added
```
settings: { lean?: false, busyNights?: [0..6], tripGoal?: 2|3|4 }
planAhead: { start, end, pantryFirst, replan, before: { dinners, fromPantry, groceries, open, hadOpen }, changed, by, at }
waste: { "<key>": { id, name, qty, unit, cost, reason: "tossed", date, since?, estimated?, by, at } }
lunchUsed: { "YYYY-MM-DD": { Jeff: { at, by, took: { id: qty } } | { at, by, skipped: true } } }
plan[date].leftovers: { use: "none"|"lunch"|"night"|"fridge"|"freezer", to?, name?, plates?, item?, by, at }
plan[date].away.leftovers: { from: date, dinner: id }        // a leftovers night
pantry[id].sinceAbout: "week"|"month"|"older"                // `since` was a rough answer
custom["custom-leftover-…"]: { name, unit: "plates", aisle, kind, storage, each }   // each = a plate's food cost
```
