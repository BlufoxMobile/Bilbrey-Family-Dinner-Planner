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

## 29.3 Tests

`tests/e2e/*.mjs` follow the new layout (rows tick, the › opens the item sheet, Plan's extra actions
are under More, "Not for us" confirms). Unit tests cover the retire rule (nights after tonight only).
