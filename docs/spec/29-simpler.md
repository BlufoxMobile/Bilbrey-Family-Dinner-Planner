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

## 29.5 Tests

`tests/e2e/*.mjs` follow the new layout (rows tick, the › opens the item sheet, Plan's extra actions
are under More, "Not for us" confirms). Unit tests cover the retire rule (nights after tonight only).
