## 22. Tonight, the recipe page, cook mode and the recipe box (Jeff, 2026-11-15)

> "Healthy options and a detailed recipe." Help losing weight with no calorie number: "just lean".
> Calories and protein on everything. The app also runs on the kitchen and living-room TV with a remote.

Owner files: `app/cooking.js` (pure logic), `app/views/tonight.js`, `recipe.js`, `recipes.js`, `cook.js`,
`sheets.js`, `common.js`, the cooked and leftover parts of `app/actions.js`, `styles/parts/cook.css`.
Tests: `tests/cooking.test.mjs` (pure parts) and `tests/e2e/cook-e2e.mjs` (run it beside
`run-e2e.mjs`: `cd tests && node ./e2e/cook-e2e.mjs`; screenshots land in `dev/screenshots/cook-*.png`
at 390 px, 1280 px and 1920×1080).

### 22.1 Tonight, the home screen
Top to bottom (and in focus order for a remote):
1. **How was dinner?** for last night (existing, §9.2), and **Did you cook last night?** when yesterday's
   dinner is still marked planned: "Yes, mark it cooked" (the pantry drops), "No, move it to another
   night", or "We skipped it". Without this the pantry keeps counting food that's gone.
2. **Tonight's dinner**: photo, title, sides (tap one to substitute), time and equipment, calories and
   protein a plate with the Lean marker, then **Start cooking** (`#tonight-cook`; "Keep cooking: step 4
   of 9" when a session is under way) and "See the whole recipe". Under the buttons: up to three reasons
   it's on tonight (§22.2), the lighter-side idea, thumbs, and Swap / Not eating at home / Mark cooked.
   A leftover night (§22.5) and a night out each have their own card.
3. **Any leftovers?** once tonight's (or last night's) dinner is cooked and nobody has answered.
4. **Thaw and prep now**: the prep schedule for today and tomorrow (§12.5).
5. **Use first**: leftovers in the fridge (servings, good through which day; Ate one / Leftover night… /
   All gone), then perishables near their date (§13.4) with the planned dinner each one is going into.
6. **Today's lunches** (tomorrow's, "to pack tonight", when today has none), with calories and protein.
7. **This week's dinners**: an average plate's calories and protein, how many dinners have a vegetable
   or salad, nights cooking at home (and how many are cooked so far); lean dinners, leftover nights,
   nights out and open nights in one line. Facts only: no target, no score, no colour-coding.
8. The rest of the week (each row with calories, protein and Lean), and the grocery estimate.

**Kitchen display.** At 1700 px and wider (a TV) Tonight widens to the full screen: dinner on the left
with a shorter photo so Start cooking is on screen without scrolling, the cards in a second column and
the week in a third. `styles/parts/cook.css` also steps the type tokens up one size inside
`.page-tonight` and `.cook-v3` at that width; if the design system scales type on a TV itself, delete
those two token blocks and keep the layout.

### 22.2 The recipe page (`#/recipe/<id>`)
- Photo, category and protein, title, subtitle.
- **Why it's on the plan tonight** (or "…Thursday", or "Why make it"), from `whyThisDinner()`: the plan
  entry's own reasons first (`plan[date].why` or `.reasons`, strings, if the planner writes them), then
  "Uses up the romaine hearts from Nov 12 (best by tomorrow)" for anything on the use-first list, or
  "Uses the lean ground beef in the freezer from Nov 3" when the meat is already in the house; "Lean:
  49 g of protein for about 590 calories a plate" (now plateHealth's own sentence: "A lean plate: 640 cal
  with 50 g protein"); "Everything for it is already in the house"; "Chicken
  breast is on sale at Jewel-Osco through Wednesday" (a current price check, §12.3, on something still to
  buy); "A family favorite"; "On the table in about 25 min". Never more than three.
- **Times**: Prep / Cook / Total when the recipe has `prepMinutes` and `cookMinutes`, else "Start to
  finish"; plus "With the sides" when the plate takes longer than the dinner alone.
- **Equipment** with the settings its steps call for ("Blackstone: Medium-high", "Air fryer: 400°F",
  "PossibleCooker: SLOW COOK on LO"). The recipe box names the appliance in each step's setting
  ("Stovetop, medium-low, lid on", §18.4), so `settingOwner()` puts a setting under the appliance it names,
  without repeating the name; a family-saved dinner's settings are still read from its sentences and go
  by what the step mentions. Never an oven. The PossibleCooker (`possible cooker`, label "PossibleCooker"
  in `EQUIPMENT_LABELS`, the `cooker` icon in `app/icons.js`) has no local fallback any more.
- **A dinner that mostly cooks on its own** (a slow cook or a braise: an hour or more that isn't hands-on)
  says both times wherever a dinner's time is shown on a card or a row (`timeLabel()`: Tonight, the night
  sheet, the dinner picker, the recipe box, ideas): "20 min hands-on, 6 hr 20 min in all". Times are always
  `fmtMinutes` ("8 hr 40 min", never "520 min"). The recipe box's time filter and "Quickest" go by the total.
- **For five, all adult plates**: every ingredient of the dinner and each side, each marked "In the
  pantry", "Need ½ lb more" or "Not in the pantry" (the same 95% rule as §12.5; salt, pepper and oil
  are assumed unless marked running low), with a summary and a link to the list.
- **Timing the whole plate**: a bar per dish, lined up to finish together, and one cue per side
  ("Start it about 20 min in, around step 3 of the dinner. It needs 10 min.").
- **Steps**, numbered, each with its heat setting, its wait ("2–3 min per side") and the amounts for
  five that the step uses.
- **The sides**, open by default, each with time, equipment, calories a plate, its cue and its own
  numbered method. A side's thumbs stay beside it.
- **Tips** (`tips`), **Done and safe** (safe internal temperatures from the steps, or by protein:
  chicken and turkey 165°F, ground meat and sausage 160°F, chops and steaks 145°F then rest 3 minutes),
  and **Leftovers** (`leftovers`, or the general rule: fridge within 2 hours, 3–4 days, reheat to 165°F).
- **Nutrition, one plate**: calories and protein (and carbs, fat and fibre when `plateHealth` gives
  them), the Lean marker with its reason, and a table: the dinner and each side.
- **A lighter plate, if you want one**, shown once per device (until "Got it"; a link under Nutrition
  brings it back): half the plate vegetables or salad, a palm of the meat, a cupped hand of rice, pasta,
  potatoes or bread. General guidance for a grown-up: no calorie targets, no good or bad foods, nothing
  about the kids' plates, and "the recipe still makes five full plates".
- **What the family thinks**: two buttons, Loved and Not for us (§20.2: one signal for the whole family, no
  names). "Not for us" is what retiring a dinner was, so there is no separate "Retire from the rotation"
  button; a bench dinner has "Add to the rotation" and a dropped one "Bring back into the rotation", on every
  device (no parent-only tools). On a phone a "Start cooking" bar stays at the bottom once
  the page's own button has scrolled away.

**New recipe fields** (all optional; `app/data.js` must pass them through `normalizeDinner` and
`normalizeSide`): `prepMinutes`, `cookMinutes`, `tips` (array or string), `leftovers` (string),
`stepDetail: [{ text, minutes, setting }]` beside `steps`. `stepDetails(recipe)` uses `stepDetail` when
present and otherwise reads the plain `steps` strings, which is all a family-saved dinner has:
- waits: "2–3 minutes", "30 seconds a side", "12 to 18 minutes per batch", "4 hours". The timer is set to
  the low end of a range (check early); asides aren't waits ("(6–8 if your grill closes…)", "up to 2
  hours", "the last 2 minutes", "1 minute less than the box says").
- settings: "over medium-high" → "Medium-high heat"; "at 400°F" → "400°F". A doneness temperature
  ("reads 165°F") is never a setting.
- `stepDetail[i].minutes` is how long the step takes. A step whose text has no wait gets a timer of
  that length only when it's a waiting step (cook, simmer, rest, slow cook…), not for chopping.

### 22.3 Cook mode (`#/cook/<date>` for a planned night, `#/cook/d/<id>` for a recipe)
Full screen (`.cook-v3` is exactly one screen tall; only the step area scrolls).
- **Get ready**: the plate's total time, each appliance and its setting, the safe temperature, the
  timeline with its cues, "Timed together" or "One dish at a time", and a tap-to-tick list of everything
  to get out, by dish, with a note on anything the pantry doesn't show.
- **One step at a time**, in type sized for across the kitchen (about 25 px on a phone, 42 px at 1280,
  54 px on a 1080p TV; the − A + control scales it 0.85–1.6× and is remembered). Each step shows its dish
  (colour and name, "step 2 of 3"), the heat setting, the amounts it uses (ones already out are
  outlined), its timers, and a preview of the next step. At 1100 px and wider the step sits on the left
  and what it needs on the right.
- **Next and back**: the two big buttons (`#cook-next`, `#cook-back`), a sideways swipe, the arrow keys
  and Page Up/Down, and a TV remote's left/right, rewind/fast-forward and next/previous-track keys.
  Play/Pause (or T) starts, pauses or resumes the step's first timer. Escape answers a ringing timer.
  Up and down are left alone for focus navigation; the screen carries `data-arrow-keys="steps"` so a
  focus-navigation layer knows left and right are taken here (cook mode listens on `window`, capture
  phase, and skips events already `defaultPrevented`). Focus starts on Next and stays there from step to
  step (on a touch-only screen nothing is focused until a key is pressed).
- **The order**: `cookTimeline()` lines every dish up to finish when the longest one does and lists the
  steps in the order to start them; "One dish at a time" lists the dinner's steps, then each side's.
  A step that doesn't say how long it takes gets a share of its recipe's time (never more than 6
  minutes); time the recipe's total has left over is getting ready, and goes on the first step.
- **Timers**: one per wait in the step, plus "Set a timer" (1–45 min) on any step. Each is a clock
  time (`endsAt`), so it keeps counting across steps, on other screens and through a reload. Timers from
  other steps sit in a strip above the buttons; tap one to go back to its step. When one finishes: three
  beeps (repeating for two minutes), a vibration, a red banner over whatever screen is open ("Timer
  done. Air-fryer fries: 12–18 min per batch", with Got it, +1 min and, outside cook mode, Back to
  cooking), and the step's own timer turns to Done with Got it / Again / +1 min. The bell in the top
  bar turns sound off. Browsers only allow sound after a tap, so every timer button unlocks it.
- **The screen stays on** through the Screen Wake Lock (re-requested when the tab comes back). The Get
  ready card says so only when the lock is actually held; otherwise it says the screen may dim.
- **Resume**: the step, the ticked ingredients and the timers are kept on the device
  (`localStorage` `bfdp.cook.session`, `.timers`, `.prefs`) for 18 hours. Opening cook mode again goes
  back to that step with "Picked up where you left off. Start over". Tonight and the recipe page say
  "Keep cooking: step 4 of 9".
- **All the steps**: a sheet from the list button with every step, done ones ticked; tap to jump.
- **Finish**: "Dinner's ready", the safe temperature once more, and **Mark cooked** with what it takes
  out of the pantry spelled out. Then the leftovers question (§22.5); answering goes to Tonight and ends
  the session. A recipe that isn't on tonight's plan offers "Make it tonight's dinner" instead.
- No dinner that night, a night out or a leftover night each get a plain screen with the way out.

### 22.4 Marked cooked
`markCookedOps` (unchanged in shape) sets `plan[date]` to cooked with `cookedAt`, `cookedBy` and
`deducted`, and takes each measured ingredient out of the pantry. `unmarkCookedOps` puts those amounts
back and now also removes `leftovers[date]` and brings back a leftover night that was set from it.
The night sheet stays open after "Mark cooked" and asks about leftovers.

### 22.5 Leftovers
```
state.leftovers["YYYY-MM-DD" (the night it was cooked)] = {
  dinner,            // dinner id
  title,             // its title that night (kept in case the recipe is renamed)
  servings,          // left now
  saved,             // how many went in the fridge that night (0 = asked, and there were none)
  useBy,             // "YYYY-MM-DD": the cooked day + 3 (USDA says 3–4 days; the careful end)
  by, at,
  night?             // "YYYY-MM-DD" when set aside for a leftover night
}
```
- The question is asked wherever a dinner gets marked cooked: cook mode's last screen, the night sheet,
  and a card on Tonight that evening and the next day. Buttons None, 1 … 5, 6+. One answer, with Undo.
- `saveLeftoversOps`, `useLeftoverOps` (Ate one), `clearLeftoversOps` (All gone / Tossed),
  `leftoverNightOps`. `leftoversOnHand(state, today)` lists what's still good (and for two days after,
  marked "past its best: toss it").
- **Leftover night**: offered at 3 or more servings, for any night from tonight to the use-by day that
  isn't cooked or away. It is saved as a not-cooking night with its own reason, so the list drops that
  night's groceries with no change to shopping or the planner:
  `plan[night] = { dinner (the one it replaced, kept), sides, status: 'away', away: { reason: 'Leftovers',
  note: "<title>, from <weekday>", from: "<cooked date>" }, manual: true, by, at }`.
  `awayReason()` in `views/common.js` shows it as "Leftover night"; "Cook … after all" is the ordinary
  bring-back. Tonight shows a leftover-night card with "We ate them".
- **For lunch**: "Ate one" counts a serving down. Lunch planning can read `state.leftovers` to offer a
  serving as someone's lunch main; nothing writes to `state.lunch` from here.

### 22.6 Calories, protein and Lean, calmly
- `plateFacts(db, state, dinnerId, entry)` is the one source for a plate on every screen: it is
  `nutrition.plateHealth(db, state, dinnerId, entry)` (§18.5) → `{ kcal, proteinG, carbsG?, fatG?, fiberG?,
  vegServings, lean, why }` plus `protein` (= `proteinG`) and `complete`. There is **one lean rule**,
  `LEAN_RULE` in `app/nutrition.js` (750 calories or less with at least 35 g of protein a plate); the
  earlier local rule (800 calories, 27% from protein) is gone. A plate "has a vegetable" in the week's
  summary at one 80 g serving or more (`VEG_ON_PLATE`), which is the validator's line for a default plate,
  so a burger-and-fries night doesn't count.
- Shown on: Tonight's dinner and the week list, the recipe page (header and its own section), the recipe
  box cards, the dinner picker, the night sheet, the substitute list (each side's calories), today's
  lunches, the week's summary; Plan and Lunch already show them.
- **Lean** is a small leaf and the word, with the reason as its tooltip and in the recipe's nutrition
  section. Nothing is ever marked as not lean.
- The per-device "Show calories and protein" switch (§8) hides all of it, the Lean filter and the plate
  guide included.

### 22.7 The recipe box
- Tabs as before (In rotation / Bench / Dropped). Cards have the photo, time and category, calories and
  protein with Lean, and "7 of 11 ingredients on hand" or "Everything's in the pantry".
- Search reads the title, subtitle, category, protein, tags, appliance names and ingredient names; every
  word has to match.
- Filters: **Can make now** (the dinner and its usual sides are all in the pantry), **Lean**,
  Favorites, **appliance** (every appliance a recipe uses, and always the PossibleCooker), **time**
  (20 / 30 / 45 minutes or less), **protein**, category. Sort: A to Z, quickest, most protein,
  lightest, closest to ready.
- When nothing matches, the page says which filter emptied it and offers "Clear search and filters".
- The facts behind the filters are worked out once per change to the family's data, so typing stays
  instant.

### 22.8 Honest limits
- Step timings read from plain sentences are estimates, good for ordering the plate and for timers;
  recipes with `stepDetail` are exact. Every built-in dinner and side has `stepDetail` from `app/data.js`
  (§18.4). A dinner saved from Claude (the app's ideas or the chat connector) keeps `steps` as sentences
  and the timed version beside them as `stepDetails`; `normalizeDinner` reads that list when it lines up.
- "Timed together" assumes one cook. With two, "One dish at a time" on two devices works better.
- A TV browser may refuse the wake lock or the sound; the banner and the on-screen clock don't depend on
  either.
