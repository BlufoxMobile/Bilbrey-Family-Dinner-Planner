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
  known, why }`. It is `nutrition.plateHealth(db, state, dinnerId, entry)` (§18.5) plus what only the
  planner asks. **There is one lean rule in the app**, `LEAN_RULE` in `app/nutrition.js` (750 calories or
  less with at least 35 g of protein a plate): the recipe page, Tonight, the recipe box (§22.6), the
  planner and the chat connector's health summary all read it. A plate is heavy at ≥ 1,100 kcal or when
  the dinner is fried (tag `fried`/`heavy`/`indulgent`, or "fried" in the title: not air-fried,
  stir-fried, refried or fried rice). Never both. With no nutrition data nothing is known and the
  vegetable count falls back to the sides on the plate.
- Scoring (`leanScore`): lean +0.8, heavy −0.8, in between down to −0.5 by calories; a vegetable or
  salad on the plate (one 80 g serving or more, `VEG_ON_PLATE`) +0.2 (less −0.2); protein ≥ 30% of calories +0.1. For scale a family favorite is
  +1.0, so favorites and variety still win their share.
- At most `HEAVY_MAX_PER_WEEK` (2) fried or heavy dinners a week. Burger and pizza nights are the
  comfort nights: they keep their type and their sides, and count toward the two.
- A two-side dinner with no vegetable or salad trades one side for a vegetable (`withVegetable`): the
  bread goes first, then fruit, soup, the second starch. The vegetable is one already in the house,
  then one that kind of dinner is served with, then one the family likes. A dinner whose sides the
  family chose themselves is left alone.
- Busy nights: `settings.busyNights` (Monday = 0 … Sunday = 6, like `burgerNights`; chips on the Plan
  page; the app can't know them otherwise). On those nights `effortOf(d)` decides, by **hands-on time**
  (`handsOnMinutes(d)` in `app/data.js`: the recipe's `prepMinutes` when it has one, else its whole
  time): `handsOff` (a slow cook in the Ninja PossibleCooker: equipment `possible cooker` with 2+ hours
  in all or ≤ 20 hands-on minutes, or a `slow cooker` tag) +1.1, `quick` (≤ 30 minutes of work) +0.5,
  normal −0.3, `long` (over 45) −0.9. The same `effortOf(d) === 'long'` is the everyday weeknight
  penalty, so neither a slow-cooker dinner nor a long simmer with little work is punished as a long cook.
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

Leftovers are **one model**, §22.5's `state.leftovers[cookedDate]` (this section first had a second one,
`plan[date].leftovers` with its own sheet; that is gone, with nothing saved in it). A cooked dinner is
asked about **once** ("Any leftovers?", how many servings), on one card that shows on Tonight, Plan and
Pantry and is gone everywhere once answered. What this section adds are two more places a batch in the
fridge can go, from "Lunch or freezer…" on its row (Tonight's Use first, and "Leftovers in the fridge" on
Plan and Pantry):
- *a lunch* (`leftoverLunchOps`): one serving goes in a packed lunch, for whoever packs (§20.3's
  `packingNames`, never a fixed list of names): each packer's next packed lunch up to the use-by day is
  offered. That lunch is skipped (reason "Leftover …"), so its groceries leave the list; the batch
  counts down one and remembers `lunches: [{ name, date }]`;
- *the freezer* (`freezeLeftoversOps`): some or all servings leave the fridge count and become a shelf
  item "Leftover …" counted in plates, in the freezer, dated today (plates already frozen keep the older
  date), so it has a use-by (about 3 months), shows under quick backups and on the freezer watch, and is
  logged through the pantry's waste flow if it's thrown out. The batch remembers `frozen` and `item`;
- *thrown out* (`tossLeftoversOps`, the "Tossed" button once a batch is past its best): the batch is
  done and the waste log gets `{ id: "leftover:<dinner>", name: "Leftover …", qty, unit: "servings",
  cost }`, the cost being those servings' share of the dinner's food. "All gone" (eaten) logs nothing.
A leftover night is §22.5's (`plan[night].away.reason: "Leftovers"`, `from`); a serving in the fridge
is the batch itself (use-by 3 days), not a shelf item.

**Catching the pantry up.** Two ways the pantry drifted from the kitchen, both now caught by **one
prompt** (`catchUpCard`, on Tonight, Plan and Pantry; §22.1's "Did you cook last night?" is this card):
- A past night (last 7 days) still marked planned. One missed dinner is asked about on the card
  itself: "Yes, mark it cooked" (the usual deduction, once), "No, move it to another night", or "We
  skipped it" (the night opens and the food stays). More than one, or lunches too, open the catch-up
  sheet ("Did these get cooked?" Yes / No per night).
- Packed lunches never took their food off the shelf. For past lunch days since 2026-11-16, not
  skipped (a lunch that was leftovers is skipped, so it is never taken off twice), for whoever packs
  (`packingNames`): "They were packed" takes the food off once (`lunchUsed[date][name]`), "They
  weren't" settles them without it. Markers older than three weeks are cleared.
Neither is repeated as a prep job. Measured items at zero move to a "Used up" list with one "Clear all".

**Pantry edits.** `setPantryOps` keeps every field already on an entry (`sinceAbout`, `place`,
`bought`, anything newer) and changes only the amount, the stocked switch, "running low" and the stamp.
`since` is set when food arrives on an empty shelf (a new item, one that had run out or was running
low, a staple back in stock); more of something already there keeps the older date, and undated stock
stays undated so the pantry asks. `sinceOf(p)` still corrects a `since` saved as the UTC day by an
older version (§20.4), reading the entry's own stamp only for that.

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
leftovers["<cooked date>"]: { …§22.5, lunches?: [{ name, date }], frozen?: n, item?: "<shelf item id>" }
pantry[id].sinceAbout: "week"|"month"|"older"                // `since` was a rough answer
custom["custom-leftover-…"]: { name, unit: "plates", aisle, kind, storage: "freezer", each }   // each = a plate's food cost
```
