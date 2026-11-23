# 29 — Simpler (v3.5.0)

Jeff, 2026-11-22: "Can you run a gauntlet loop on this app to make it simpler, easier to use, and more
intuitive." Five independent reviewers (a busy parent at 5:30 PM, a shopper in the aisle, a first-time
user, a product designer, an accessibility reviewer) scored the app, the fixes below went in, and they
scored it again. Round 1 averaged about 5 out of 10. The common verdict: every screen buried its one
job under several screenfuls of cards, the same prompts showed up on three tabs, and helper paragraphs
explained everything twice.

## 29.1 The rules this release follows

- **One job per screen, first on the screen.** Tonight opens on tonight's dinner and Start cooking.
  Plan opens on the week. The List opens on the checklist. Pantry opens on search and add.
- **One home per card.** "Did you cook it?" and the leftovers question live on Tonight only. "Use
  first" lives on the Pantry only. The thaw and prep schedule lives at the bottom of Plan, folded.
- **No helper text longer than a line on a main screen.** Details are one tap away, folded under a
  plainly worded summary ("How it's worked out", "More filters", "Fix the product, price or store").
- **The same words everywhere.** Change dinner, Change side, Move to another night. Plan (not
  Planner). On the menu / Maybe later / Not for us (not In rotation / Bench / Dropped). Away a few
  nights (not a "trip"). Nothing planned (not "Open").
- **Text floor.** Body text 15px, labels 13px; nothing smaller (tab labels, chart labels, price notes
  were 10–12px).

## 29.2 Screen by screen

- **Tonight:** the hero (photo at 4:3), the dinner's sides, time and appliance, then a one-line thaw
  reminder ("Still frozen? Thaw the 2 lb lean ground beef in cold water now, about 1 hr.") right above
  Start cooking. The quick buttons are Change dinner, Not eating at home, Mark cooked. The catch-up
  question is one line with Yes, cooked / Move it / We skipped it. Gone: the cost line, the "why"
  list, pre-cook thumbs, the rest of the week, groceries, use first and lunches.
- **Plan:** week arrows, then Plan ahead (one primary button) and More (What can I make?, Swap two
  nights, Pick new dinners for this week, Plan from, Planning for). The day cards show the photo, the
  name and "with" the sides in plain words; changing anything happens in the night sheet. A one-line
  summary ("7 dinners planned: about $3.85 a plate. $329.77 on the list.") and the folded "Thaw & prep
  for the week" close the page.
- **Night sheet:** labelled "Loved" / "Not for us" under the dinner, each side with a Change side
  button, then Start cooking, Make this tonight, Change dinner, Move to another night, Not eating at
  home, Mark cooked, Open the recipe, Clear this night, each with at most a few words of small print.
- **Not eating at home:** one tap does the usual thing ("Skip Wednesday"); "Or move it to [night]"
  is the second choice. Away a few nights, a reason and a note are folded, and no reason is picked for
  you.
- **"Not for us" asks first:** "Take Smoky paprika chicken off the menu for everyone?" Tonight stays
  as it is; only nights after tonight get the replacement. "Loved" just happens, with Undo.
- **List:** a slim sticky head per store ("19 left · 19 items, $196.81"), then rows of photo, the
  store's product name, the price and "× 2". Tapping a row ticks it; the › opens its sheet. Items with
  no aisle yet ride along with the nearest aisle of their section, marked "aisle?". A one-field "Add an
  item" (this list only). Cost, coupons and receipts fold into one row below the list. Done shopping
  sticks above the tab bar once anything is in the cart. The list keeps its scroll position.
- **Item sheet:** photo, product, quantity and price; We have it / Not this trip / Get it at the other
  store; the aisle; then "Fix the product, price or store", folded.
- **Pantry:** search and add, Photo library / Take a photo, Use first (five at most), one neutral
  coverage line, Running low, the shelves. Containers count in real words (milk by the jug, romaine by
  the heart).
- **Budget and the weekly check-in:** the same one number, where the month is heading (receipts + the
  list + open nights at the usual cost): "$813.28 — where November is heading · target $650", then
  "About $163 over." The check-in says the same. Trips, waste, the year and how it's worked out fold
  away. Meat per dinner moved to Family. Log a total by hand is folded. Chart labels are there from the
  first frame and at least 12.5px.
- **Recipe page:** Start cooking is the one primary button (and the sticky bar); Make this tonight
  hides when it can't be on the table by about 7:45 ("Too long for tonight"). Only missing ingredients
  get words; what's in the house gets a quiet check. The plate guide card is a link now.
- **Cook mode:** Get ready ends with "Step 1 →"; it shows the thaw reminder too. One step counter
  (the header). Timers under 30 seconds aren't offered. Timed together is the order; the switch is gone.
- **Recipes:** search, then Can make now / Favorites / 30 min or less, then More filters (appliance,
  time, protein, category, lean, sort). Cards say "All in the house" only when it's true.
- **Family & settings:** house rules first, then shopping, lunches, display, stores. Sync (when it's
  fine), Claude and this device's data wait under Advanced.
- **Header:** Budget and Family are labelled. "Synced" isn't shown when everything is synced; any other
  state shows an icon and a word.
- **Undo:** a toast with a button stays 15 seconds and waits while a finger, the mouse or keyboard
  focus is on it.
- **First run:** Look around first; "Use on this device only" and Larger text are under More options.
- **Lunch:** after 2 PM tomorrow's lunch comes first ("Pack it tonight"). Swap ideas live in the
  editor.
- **Easy tonight:** only dinners that need no store trip.

## 29.3 Round 2 (all five reviewers at 7)

- **List rows** lead with the plain item in bold ("Honey"), the store's product small under it on one line,
  then the amount and price ("2 packs total $38.26"); names wrap to three lines. No "aisle?" or "Lunch"
  chips on rows; the picture ticks too. "Add an item" (one field, with suggestions) sits at the top; repeating
  extras and the Dinners/Lunches filter live under "Cost, coupons & more". Done is one line and sticks only
  once half the list is ticked. The trip bar is one line. Order online: a compact Open per row; Sam's has no
  whole-list copy; Jewel's copy sheet is three steps with the rest folded.
- **Tonight** says whether dinner can happen from the house: "Everything's in the house" or "Not in the house:
  sliced cheese and frozen fries" (shortfalls included). "Low on energy?" shows only when an easier dinner is
  really there. After cooking: one question at a time (leftovers, then how it was) and "Not cooked after all".
  Leftovers: "Use them…" opens one sheet (a serving, a leftover night, a lunch, the freezer). Thaw & prep on
  Tonight is today only; the check-in reminder is one line.
- **Plan**: how much to show (1 week to Month) is in More, so Plan ahead's range is the only one on the page;
  Plan ahead is primary only with empty nights. Day cards keep the per-serving cost (the family asked for the
  cost per meal) and drop calories. Plan ahead's result leads with "Planned through Sun, Nov 29 · about $535 to
  buy"; its toast is one line.
- **Night sheet**: short cost line, no Lighter idea chip; "Not for us" names the night the replacement takes.
  A night already gone by moves only into an empty night ahead.
- **Budget** leads with the answer ("About $163 over / the $650 target"), then the amount; breakdown, trips,
  waste, the year and the target are folded. **Check-in**: verdict, the month folded, one tip, "Looks right".
- **Pantry** search finds what you have first; amounts read 1¼, not 1.25; one row of controls.
- **Cook mode**: labelled Steps, Sound and one text-size button; Get ready gives the timing in sentences.
- **Receipt check**: sure lines are one read-only row each. **Header**: a status pill hides the wordmark text so
  Budget and Family never fall off. Toasts from another screen go away when the screen changes.

## 29.4 Round 3 (all five reviewers at 8)

- **Tonight**: only Start cooking sits under the dinner ("See the whole recipe" is gone; Change dinner is in the
  quick row); an after-dinner question comes before the catch-up card, one card at a time. The weekly snack-bag job reads
  "Bag the Doritos into 5 snack bags, about 1½ oz each, for Knox's lunches."
- **Night sheet** follows the night: tonight leads with Start cooking; a night ahead leads with Change dinner,
  Move, Not eating at home, Make this tonight (no Start cooking or Mark cooked); a night gone by leads with
  Mark cooked.
- **Plan ahead**: the two switches fold under "Options"; the night-count sentence is gone. The result says
  "about $28 less than the old plan", names at most two things it uses up, and its button is "See the shopping
  list". Cost reads "a serving" everywhere (Plan's summary and the cost line too).
- **Check-in**: the dinners are one sentence; the verdict is worded like Budget ("About $163 over the $650
  target. The month is heading for $813.28."); the slogan is gone; chart labels are 14px; the weigh-in offer
  waits in the settings fold ("Check-in day, the TV and a weigh-in"); headings say "weekly weigh-in".
- **Recipe page**: "Ingredients (for five)"; a quiet check or a small cart on each row instead of "Need to buy"
  (the summary above says it in words); "PossibleCooker (slow cooker)" under Equipment; no side timing repeated
  under the side when the plate's timing is shown; when it's too late for tonight, "Add to plan on…" is the
  primary button and there's no sticky bar.
- **List**: the store head is one line ("19 left · $196.81"); the add field picks the store you're in, else the
  one with more to get; the checkbox is described by the product, amount and price; one-off adds aren't listed
  under "On every list"; a toast rides above the sticky Done bar; the how-to line goes once anything is ticked;
  "End trip"; "Cost & coupons"; online, Open sits under the name; rows riding along with a nearby aisle say
  "near here". Item sheet: the product is body text, amounts are written one way ("about 11 oz left over").
- **Leftovers sheet**: after 2 PM the lunch choices start tomorrow; one "Freeze 3 plates" button.
- **Budget**: all four folds look the same. **Family**: "Burger nights (with fries)", "Show a day's calories on
  Tonight". **Lunch**: swap ideas are one line; the footnote is one sentence. **Header**: the status pill keeps
  its word at Large text (icon only below 360px).
- **Plan cards at 1280**: two clean lines of sides, no sliver of a third. **Cook mode, Get ready**: the timing
  is in the summary card, a line per side; "Get everything out" comes right after it; safe temperatures close
  the screen. **Pantry**: search hits use shelf words ("6 packs, freezer"); rows wrap their controls at 320px.

## 29.5 Round 4 (final: shopper 9, accessibility 9, parent 8, first-timer 8, designer 8)

Fixed after the last round, before shipping:
- **Leftovers sheet after 2 PM**: leftovers from an earlier night offered no lunch at all (the choices stopped
  at today's lunch, which the sheet then hid). Choices now start tomorrow (`leftoverLunchChoices({ after })`),
  and an empty "For a lunch" section isn't shown.
- **Tonight**: when the meat or three or more things aren't in the house, "Change dinner" is the big button
  and "Start cooking anyway" the quiet one. Sides read mid-sentence ("with air-fryer fries").
- **Change side** from a night is for that night ("Just tonight" / "Every time"); it's written to the night's
  `sides` (`nightSideOps`). The recipe page and remembered or added sides stay "every time".
- **Pantry**: each row is stepper · Running low · ›; the › sheet (picture, where it's kept) has "Take it off the
  shelf". Undated freezer meat is asked about inside Use first, not again at the bottom; that line says
  "freezer, not sure when". Chips are 44px.
- **List**: "Add an item" adds to the store of the last item ticked (else the first store with something left)
  and its toast names the store; "near here" and the how-to line are gone; online, Open sits at the end of the
  price line. Item sheet: "1 bottle · $5.98", the three buttons, then what it's for.
- **Check-in**: "$48.75 spent that week", then one quiet line "This month: about $163 over…", then Looks right and
  A receipt is missing side by side; the record, the month and the tip share one "Details" fold; "1 of 2 planned
  dinners". Dinners sit in the right column on wide screens.
- **Plan ahead** starts on the range the Plan page shows; "Let it replace dinners it picked before"; the result
  reads "About $535 to buy, $28 less". **Catch-up**: Cooked / Move / Skipped on one row. **Budget**: "This trip
  covers 5 days. 5 more (about $109) skips the next store run." **Family**: "Packing for Jeff and Knox."; the target
  links to Budget. **Lunch editor**: swap ideas under the items. Toasts from another screen clear after 0.6 s.

Not done (named honestly): Thaw & prep jobs can't be ticked off yet; "See the shopping list" still starts a trip;
Pantry steppers can still show part-packages (1¾ packs); the recipe page is still long (about 8 phone screens);
cook-mode timing cues are worded by step number; Tonight-at-a-glance lunch packing still lives on the Lunch tab.

## 29.6 Round 5 (all five reviewers at 9: parent, shopper, first-timer, designer, accessibility)

v3.6.0 shipped what round 4 named as not done:
- **Thaw & prep** jobs tick off for the whole family (`prepDoneOps`, `state.prepDone[date][prepKey]`, pruned
  after 7 days), with Undo and a quiet "1 job done" line. After a tick, focus moves to the next job's box,
  or to the "done" line after the last one. The folded Thaw & prep on Plan stays open while you tick.
- **Lunch** opens on one "Tomorrow's lunches · Pack them tonight" card: each person's short item names
  ("Ham sandwich · Doritos · Oreo Minis · Yoo-hoo", the `short` field in data/lunches.json), no calories.
  Below it, each person's tab folds that day into "Change tomorrow's lunch" instead of repeating it.
- **Recipe page**: Timing, each side's method, Tips and Nutrition fold. Timing cues count back from dinner
  ("Start it about 15 min before dinner is ready"). "Done and safe" names the dinner's own meat; a braised
  roast is "done when it pulls apart with a fork, well past this", never "Pork chops and steaks".
- **Plan ahead**: two quick choices (1 week, 2 weeks), the rest folded. It opens on the first stretch that
  has an empty night. When nothing is left to plan it says so, and Plan it waits. A press that changes
  nothing shows one line, with no Undo and no result card. "See the shopping list" opens the plain list for
  the nights it planned (tonight through its last night, with "Just this week" to go back), never a trip.
- **List rows** say what goes in the cart, then what's inside: "4 cans", "3 packs", "1 bag (10 lb)",
  "1 box (40 packs)", "1 bulb (10 cloves)", "2 × 3.1 lb", "1 bottle" (never "190 tbsp"; `shelfQty`). The
  price is glued to the amount, so a wrap never starts with "·". Long items get short names on rows (the
  catalog's `short`). On a phone the trip bar is one line ("Jewel · through Fri · Change · End").
  The Add-an-item store follows the last tick: a `<select>` no longer snaps back on redraw (`snapshotForms`).
- **Pantry** steppers count whole packages; a container that's been opened reads "1 full + 1 open · about
  8 cups" (never for meat). Fridge / Freezer / Pantry / Counter are one fitted row. Use first shows three
  things (past its use-by, then meat nobody dated, then the rest) with "N more"; every "when did it come
  home?" question lives there, once.
- **Tonight**: short on the meat, it says so once ("Only ¾ lb of the 2 lb lean ground beef is here, and
  it's frozen. Also missing: …"). Tonight's dinner picker puts what can be made now first, labels every row
  ("All in the house", "Needs: sliced cheese", "Chicken thighs are frozen (about 1 hr to thaw)"), then this
  week's planned dinners, and offers the leftovers in the fridge as a night with nothing to cook.
- **Receipt check**: store, date and total are one line with Edit; an unsure line is its best guess in
  words ("Probably flour tortillas · 20 tortillas") with Fix; only a line with no guess is a form.
- **Smaller**: Change side's "every time" is one switch (off: just this night). Check-in says "Missing a
  receipt". Tick boxes use the 3:1 control line. Large text on a 320px phone keeps Plan cards inside the
  screen. The four heat-and-serve Sam's dinners joined the recipe box.

### Round 6 (all five at 9 again)

- **Tonight's dinner picker** opens with nothing focused but the first row (no keyboard), groups rows
  under "Leftovers", "Ready now", "This week's dinners (they trade places)" and "Everything else", fewest
  things missing first, and keeps each row to three lines: the name; "All in the house", "Chicken thighs
  are frozen (about 1 hr to thaw)" or "Needs chicken thighs and 3 more"; then time · night · cost.
  Leftovers short of five servings say so.
- **A side that can't be made** gets "Change the air-fryer fries" right on Tonight. The side picker lists
  what the house can make first, each labeled, with "Use it every time" as one switch under the list.
- **Cart words** never take a package from a brand ("Boar's Head" read "1 head"): deli meat by weight is
  "1 lb, sliced", multipacks "1 pack (6 cans)", and tub, canister, carton, piece and tray where they
  belong, checked over every catalog pack. Online, Open is its own narrow column beside the ›. A store
  picked by hand in Add an item holds until a tick at the other store. The item sheet's title is the
  row's short name. Lunch day cards use short names, with the day's calories once.
- **Recipe page**: one rating card for the dinner and its sides; "One dinner, two plates" is a row;
  "Beef roast: done when it pulls apart with a fork (well past 145°F)".
- **Plan ahead**: its card carries Undo (no toast repeats it), a dry run disables Plan it when nothing
  would change, and the card says "$28 less than before".
- **Accessibility**: Tonight fits 320px with Large text; focus stays on "All done for today." through
  later redraws (redraws restore a tabindex −1 line by its id); switch names start with their words;
  switches and day chips have 44px targets.

### Cook from what you have (Jeff, after round 6)

Jeff asked for receipts to fill the pantry and for dinners from the food actually in the house. A saved
receipt that stocks the pantry opens "Cook from what you have": tonight's picker (ready now first), with
"Plan the week from the pantry" (Plan ahead with the pantry first) and "New ideas from Claude" above it.
The Pantry page opens the same sheet ("What can we make with what we have?"), and the recipe box's
"What we have first" sort says what each dinner still needs. In Claude chats, the connector's
`add_receipt`, `list_recipes` (makeableNow) and `plan_dinner` already do the same from a receipt photo,
screenshot or PDF.

### Round 7 (all five at 9; the reviews agreed most on Cook from what you have)

- **One readiness count.** `readiness()` lives in `app/coverage.js` and serves Tonight's picker, the
  Cook sheet, the side picker and the recipe box's "Can make now". A staple (oil, soy sauce, paprika…)
  is in the house unless it's switched off or marked low, the rule Tonight already used.
- **Cook from what we have** (renamed from "you"): Leftovers, Ready now, "Uses what you just bought"
  right after a receipt, then closest first. When nothing is ready, it says so. The two buttons sit
  under the list, and there's no subtitle. Picking a dinner that's still short asks first, and either
  way you land on Tonight. Plan ahead opened from it is titled "Plan from the pantry". "New ideas from
  Claude" is the one name for the ideas sheet. The recipe box's extra sort is gone.
- **Pickers**: real `<h3>` group headings. The sheet opens at its top: the native `autofocus` made
  `showModal()` scroll, so the first row now has `[data-autofocus]` and is focused with
  `preventScroll`. A favorite is a star. The meta line is one line: "30 min · on Sat · ≈ $2.67 a
  serving". Proper names keep their capitals mid-sentence.
- **Plan ahead**: "Undo this plan" sits under the card. After Plan it, `closeSheet({ focusTo })` lands
  focus on the card heading, and a polite live region (`announce()`) reads the result.
- **Undo everywhere** refocuses the control the change came from, found by its signature, or else the
  page title.
- **List / Check-in**: Open sits under the amount below 375px, and words never split. Counted packs
  keep the pantry's word ("1 bag (8 buns)"). The Check-in buttons stack below 420px, and the day chips
  are a real 44px.

## 29.7 Tests

`tests/e2e/*.mjs` follow the new layout (rows tick, the › opens the item sheet, Plan's extra actions
are under More, "Not for us" confirms). Unit tests cover the retire rule (nights after tonight only).
