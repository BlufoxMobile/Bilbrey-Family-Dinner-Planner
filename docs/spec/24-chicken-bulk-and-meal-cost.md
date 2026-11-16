## 24. Chicken over turkey, little pork, Sam's Club bulk, and what a meal costs

> Jeff, 2026-11-15, 10 pm: "We don't use much pork, but we prefer chicken over turkey generally. I eat turkey
> for lunch meat but they don't like it much. We will be having turkey on Thanksgiving but that's about it. For
> the BLT, we can do it minus the T for me lol. They will eat tomatoes occasionally. I prefer Wishbone ranch
> btw, I just bought the wrong bottle at the store. Also, can you show an individual estimated cost per meal
> when we are planning these? … I'm open to buying beef tips and cheaper steak cuts at Sam's along with any
> bulk meats or veggies we can use a lot of. I prefer to make the most with the bulk items from Sam's as much
> as possible." He also confirmed the Ninja PossibleCooker **has a STEAM setting**.

Owner files: `data/recipes.json`, `data/catalog.json`, `data/nutrition.json`, `data/lunches.json`,
`scripts/validate-data.mjs`, `img/**`, `img/photos.json`, `dev/photo-jobs.json`, `app/cost.js`,
`tests/recipes2.test.mjs`, `tests/cost.test.mjs`, one line in `sw.js`. Nothing in `app/views/**`, the planner,
the shopping list, the Worker or the CSS was touched: section 24.8 lists what the integrator wires up.

### 24.1 Chicken, not turkey

- No dinner and no side has turkey in it: not as an ingredient, not as a word, not in an id. Thirteen dinners
  changed. Ground turkey became **lean ground chicken** (`groundChicken`: Perdue, 3 lb at Sam's). Where a dish
  wants Italian sausage (the charred pepper penne, the sausage and broccoli penne, the minestrone, the breakfast
  tacos) the ground chicken is seasoned in the pan with Italian seasoning, garlic powder and red pepper, which
  is cheaper than buying chicken sausage and uses the Sam's pack. The hoagies need links, so they use fully
  cooked **Italian chicken sausage** (`chickenSausage`: al fresco, Jewel; reheated to 165°F).
- Three ids named the old meat and were replaced (the validator reads ids): `turkey-taco-salad` →
  `chicken-taco-salad`, `turkey-chili` → `chicken-bean-chili` (it never had black beans in it, so the title is
  "Chicken & bean chili" now), `cooker-turkey-meatballs` → `cooker-chicken-meatballs`. The old ids are in
  `RETIRED_DINNERS`, their pictures were renamed with them, and `recipes.json` carries
  `"renamed": { "old-id": "new-id" }` so a saved plan, rating or link can follow (24.8).
- `groundTurkey` and `turkeySausage` stay in the catalog, unused, the way `groundPork` and `italianSausage`
  already do, so an old receipt or a pack in the freezer still matches. The validator warns that they are unused.
- Turkey lunch meat is still Jeff's: the Boar's Head Salsalito sandwich stays in his rotation. A turkey lunch
  item in anyone else's default rotation is an error.
- `turkey` is no longer a `protein` value in the validator. Thanksgiving is not in the box.

### 24.2 Little pork

- At most `MAX_CORE_PORK = 4` dinners in the core rotation may be built on pork (`pork`, `porkLoin`,
  `groundPork`, `pulledPork`, `italianSausage`, `chorizo`, `smokedSausage`). There are four: BBQ pulled pork
  sandwiches (in the family's freezer; the validator requires it to stay core), honey mustard pork chops (a
  prototype id that has to stay core), the chorizo and nopalitos tacos (from their freezer) and the smoked
  sausage, chicken and Cajun potato skillet (a family usual). A fifth is an error.
- Pork fried rice became **steak & egg fried rice** (sirloin tip) and pork chow mein became **chicken &
  mushroom chow mein** (thighs); both are prototype ids, so they changed meat in place.
- The apple-jelly glazed pork chops and the braised pork loin with apples moved to the bench. Their place on
  grill night is taken by chicken versions: apple-jelly glazed chicken thighs and honey mustard chicken thighs.

### 24.3 The BLT bowl, minus the T, for Jeff

- `bonduelle-chicken-blt` is back in the lunch library as "Bonduelle Chicken BLT salad bowl, hold the
  tomatoes", with `"people": ["Jeff"]` and a prep line that says to leave the tomatoes out. Its picture shows
  none. It is not in anyone's default rotation (it wasn't before); Jeff adds it like any other lunch.
- The validator did not get looser. It gained a list of packaged bowls that come with raw tomato
  (`COMES_WITH_RAW_TOMATO`: the Bonduelle and Taylor Farms BLT bowls) and one named exception,
  `TOMATO_LEFT_OUT = { 'bonduelle-chicken-blt': ['Jeff'] }`. A lunch that uses one of those bowls is an error
  unless it is that lunch, its `people` are exactly the people named, and its own prep says to leave the
  tomatoes out. Change the words, widen the people, put it in Knox's rotation, or build a second lunch from the
  same bowl, and it fails. Its subtitle and photo are still read for raw tomato like every other dish.
- "They will eat tomatoes occasionally" changed nothing: raw tomato stays out of every dinner and side.
- New optional lunch field **`people`**: the only people an item is for (left off = anyone). The validator
  checks the names and the default rotations.

### 24.4 Wish-Bone ranch

- `ranch` is "Ranch dressing (Wish-Bone)", brand Wish-Bone, usual pack the 15 fl oz bottle at Jewel (30 tbsp,
  price estimated). `hidden valley ranch` stays an alias, so the bottle bought by mistake still matches a
  pantry scan or a receipt; `wish-bone ranch`, `wishbone ranch` and `wish bone ranch` were added. Sam's does not
  list Wish-Bone ranch, so its Sam's packs are still Member's Mark and Hidden Valley.
- No dish names Hidden Valley (the buffalo wraps said it). Naming it in a dinner, side or lunch is an error.
- **One thing is outside these files:** `data/prices.json` lays its own pack over the catalog's, label
  included, and its `ranch.jewel.name` is still "Hidden Valley Original Ranch, 16 fl oz", so that is what the
  list shows today. The validator warns about it by name until that entry is the Wish-Bone bottle (24.8).

### 24.5 Sam's Club bulk

New catalog ids. Prices marked **read** were read from samsclub.com on 2026-11-15 (the default online club;
they carry `"confidence": "listed"` and the page `url`, and the app treats them as known prices). Everything
else is an estimate and says so on its label, the way the file always has.

| id | Sam's pack | price | |
|---|---|---|---|
| `stewMeat` | Member's Mark USDA Choice Angus Beef Stew Meat, ~3.7 lb | $25.79 ($6.97/lb) | read |
| `sirloinTip` | Member's Mark USDA Choice Angus Boneless Sirloin Tip Roast, ~4.3 lb | $29.83 ($6.97/lb) | read |
| `chuckRoast` | Member's Mark USDA Choice Angus Boneless Chuck Roast, ~3.7 lb | $27.64 ($7.47/lb) | read |
| `groundChicken` | Perdue Ground Chicken, 3 lb | $11.76 ($3.92/lb) | read |
| `stirFryVeg` | Member's Mark Stir Fry Mix, frozen, 5 × 16 oz | $8.98 | pack size read, price estimated |
| `normandyVeg` | Member's Mark Broccoli Normandy, frozen, 4 lb | $7.48 | pack size read, price estimated |
| `chickenSausage` | (Jewel only) al fresco Sweet Italian Style, 11 oz | $5.99 | carried by Jewel, price estimated |

Pack weights for the meats are Sam's average pack price divided by its price per pound. Their Jewel packs are
estimates. Also read that day and already in `data/prices.json`: boneless skinless chicken thighs, $3.48/lb,
about 5.6 lb a tray. Top sirloin steaks were read at $9.97/lb and left out: not a cheaper cut.

**`bulk`** is a new optional catalog field for an item the family buys as a Sam's Club bulk pack:

```json
"bulk": { "freezes": true, "portionLb": 2.25, "note": "Split the pack into 2¼-lb freezer bags the day you buy it…" }
```

- `freezes`: true when it lives in the freezer; false for the sacks that keep on a shelf or in the crisper.
- `portionLb`: the meal-size freezer bag, for items sold by the pound that freeze (required for bulk meat by
  the pound; never more than the Sam's pack). 2¼ lb is one dinner for five; ground meat is bagged by the pound.
- `note`: one or two sentences on how to portion or keep it.
- It needs a Sam's pack. Nineteen items carry it: the new four meats and two vegetable blends, and the packs the
  family already buys (chicken breasts, chicken thighs, 93/7 ground beef, eye of round, pork chops, whole pork
  loin, frozen patties, frozen broccoli and mixed vegetables, and the 10-lb potatoes, onions, carrots and the
  25-lb jasmine rice, which say how they keep).

**Tag `bulk`**: a dinner whose raw meat comes from a Sam's bulk pack (a catalog item with `bulk`). The
validator enforces it both ways. It is true of 99 of the 105 dinners, which is the finding: the box is already
built on Sam's bulk meat, and the six without the tag are the heat-and-serve and Jewel-only ones. So `bulk` is
not worth a chip on every card; it is useful as the exception ("not from a Sam's bulk pack"), for the chat
connector, and for the planner. **Tag `freezer friendly`** now requires `leftovers` to say how to freeze it.

Ten dinners were built on the bulk buys, all core, none in an oven, each with detailed steps, timers, settings,
tips, leftovers and a vegetable or salad among its sides:

| dinner | built on | equipment | plate | about |
|---|---|---|---|---|
| Beef tips & gravy (`cooker-beef-tips-gravy`) | beef tips | PossibleCooker | 609 kcal, 55 g | $5.11 |
| Air-fryer garlic steak bites & mushrooms (`air-fryer-steak-bites`) | sirloin tip | air fryer | 608, 56 g | $5.17 |
| Pepper steak (`pepper-steak`) | sirloin tip | stovetop | 635, 50 g | $4.53 |
| Slow-cooker pot roast with carrots & potatoes (`cooker-pot-roast`) | chuck roast, potatoes, carrots, onions | PossibleCooker | 772, 49 g | $5.41 |
| Blackstone steaks with mushrooms & onions (`griddle-steaks-mushrooms`) | sirloin tip, Normandy blend | Blackstone | 616, 54 g | $5.28 |
| Honey mustard chicken thighs (`honey-mustard-chicken-thighs`) | chicken thighs | electric grill | 636, 45 g | $3.26 |
| Chicken & vegetable stir-fry (`chicken-vegetable-stir-fry`) | chicken breasts, stir-fry mix | Blackstone | 723, 66 g | $2.96 |
| Chunky slow-cooker beef chili (`cooker-chunky-beef-chili`) | beef tips | PossibleCooker | 748, 58 g | $5.39 |
| Apple-jelly glazed chicken thighs (`apple-glazed-chicken-thighs`) | chicken thighs | electric grill | 674, 44 g | $3.35 |
| Slow-cooker garlic-herb chicken with potatoes & carrots (`cooker-chicken-potatoes-carrots`) | chicken thighs, potatoes, carrots, onions | PossibleCooker | 683, 46 g | $3.51 |

Nine of the ten are lean plates by `LEAN_RULE`. What the cost column says plainly: even the cheaper steak cuts
at $6.97 a pound make a dinner that costs about $9 more than a chicken thigh dinner at $3.48 a pound. That is
the number 24.7 puts on every card. One new side: steamed broccoli, cauliflower & carrots
(`steamed-normandy-vegetables`).

### 24.6 STEAM

Jeff confirmed the button, which section 18.3 could not. The steamed sides made in the cooker (steamed carrots,
steamed green beans with lemon, the new Normandy vegetables) now say: 1 cup of water, the vegetables, lid on,
select STEAM, set the time, START/STOP; the cooker brings the water to a boil first and then counts down. The
"if your panel has a STEAM button" tips are gone. A cooker dish with "steamed" in its title must have a `STEAM`
step, and a step that steams on SEAR/SAUTÉ is an error. Steamed broccoli and steamed mixed vegetables stay on
the stove, because they are the default side of many dinners that already have the cooker busy; each gained a
tip that the cooker's STEAM does it hands-off when it is free. Not verified: the exact words on the display
while it preheats, so the steps describe what happens and do not quote the screen.

### 24.7 What a meal costs — `app/cost.js`

Pure (no DOM, no clock). It reads prices the way the shopping list does, with the list's own helpers: the store
the list would buy the item at (`canBuyAt`, `storeFor`, the trip's store), the pack `packFor` resolves (the
family's own product, their usual pack, the researched option, the catalog) and a current price check from
`activeDeal`. For every dinner in the box its `total` equals `dinnerFoodCost` to the cent, and a plan's
`toBuy` equals `buildList(...).total` for the same nights (both are tested).

```js
dinnerCost(db, state, dinnerId, entry?, { today?, store?, servings? })
// → { total, perServing, servings, items: [{ id, name, qty, unit, cost, store, unitPrice, label, source, estimated, have, packs, buy }],
//     pantryValue, toBuy, estimated, estimatedCost, unpriced }      or null when the dinner isn't there
lunchCost(db, state, itemIdOrItem, opts?)     // same shape, servings 1, perServing = total
planCost(db, state, dates, opts?)
// → { total, perDinner, perServing, dinners, servings, nights: [{ date, dinner, title, total, perServing, estimated }],
//     pantryValue, toBuy, estimated, estimatedCost, unpriced }
itemsCost(db, state, { id: amount }, opts?)   // the engine: any bag of ingredients
cheapestFirst(db, state, dinners, opts?)      // → [{ dinner, cost }], cheapest plate first, unpriceable last
costLine(cost, { short? })                    // "about $3.26 a serving · $16.30 for five"
pricedPack(db, state, id, { today?, store? }) // → { store, pack }: the pack the list would buy
```

- `total`: the food that goes into the dinner and its sides as they will be served (the night's sides,
  remembered swaps, the meat setting): amount used × the pack's price per unit. A 10-lb bag is not charged to
  one dinner. `perServing` = `total` ÷ 5 (`PLATES`).
- `pantryValue`: the part of `total` already in the house (a pantry item marked low counts as none; a staple
  marked stocked counts in full).
- `toBuy`: what this dinner alone adds to the next trip, in whole packs, given what's in the house. For a plan
  it is worked out once for all the nights, because nights share packs and the pantry.
- `estimated`: true when any price on the plate is an estimate (a catalog or prices.json estimate, or no price
  at all). Paid, typed, family-corrected, listed and checked prices are not estimates. Today 102 of the 105
  dinners are estimated, because every Jewel shelf price in `prices.json` is; `estimatedCost` says how many of
  the dollars rest on estimates (for beef tips, $4.30 of $25.54), and `items[].estimated` says which.
- `opts.today` honors a price check's dates and sale end; `opts.store` prices a one-store trip.

**How to show it** (the integrator's screens):

| where | what | call |
|---|---|---|
| Plan cards (Tonight, the week) | "about $3.26 a serving · $16.30 for five" under the plate's calories; when the pantry covers part of it, "$6.10 of it is already in the house" | `costLine(dinnerCost(db, state, e.dinner, e, { today }))`, `.pantryValue` |
| Dinner picker | the short line on every option, so a $2.96 stir-fry and a $5.41 pot roast can be told apart before choosing | `costLine(c, { short: true })` |
| Recipe page | per serving and total at the top; under the ingredients, the `items` list (name, amount, cost, store) with "est." beside estimated prices and a line "prices marked est. are estimates until a receipt or a price check replaces them" | `dinnerCost(...).items` |
| Recipe box | the short line on each card, and a **"Cheapest first"** sort beside the others | `cheapestFirst(db, state, allDinners(db, state))` |
| Plan-ahead result | "These 10 dinners: about $182 of food, $18.20 a dinner, $3.64 a plate. $41 of it is already in the house; the trip for them comes to about $164." | `planCost(db, state, dates, { today })` → `total`, `perDinner`, `perServing`, `pantryValue`, `toBuy` |
| Lunch cards | "about $4.99 a lunch" | `costLine(lunchCost(db, state, id))` |

- Say "about" whenever `estimated` is true (`costLine` does). Never show `toBuy` for a single dinner without
  the word "trip": on a bare pantry it includes a whole bottle of oil and a whole bag of chicken, which is what
  the trip costs, not what the dinner costs.
- For a list of many dinners, compute once per render: `cheapestFirst` returns each dinner's cost with it.
- These are food costs for five. Nothing here sets a budget or judges a dinner; it is a number beside the
  calories so the family can choose.

### 24.8 What the integrator wires up (outside these files)

1. **Cost on the screens**, as in 24.7. `app/cost.js` is in the `sw.js` precache list.
2. **`data/prices.json`**: change `prices.ranch.jewel.name` to the Wish-Bone bottle
   (`{ "size": 30, "price": 3.99, "label": "Wish-Bone Ranch Dressing, 15 fl oz (= 30 tbsp) (the family's ranch; price est.)", "confidence": "estimated" }`).
   Until then the list still shows Hidden Valley and the validator warns.
3. **Renamed ids**: `recipes.renamed` maps the three old turkey ids to the new ones. A night planned, rated,
   retired or substituted under an old id is otherwise an unknown dinner (the app already treats that safely,
   it just shows nothing). Resolve it in `dinnerById` or migrate the state once.
4. **`app/data.js`**: pass the catalog's `bulk` through `normalizeIngredient` and a lunch item's `people`
   through `normalizeLunchItem` (both are dropped today). Then the pantry, list and recipe page can show the
   portioning note, and the lunch picker can offer the BLT bowl to Jeff only.
5. **`app/config.js`**: `PROTEINS` still lists `turkey`, so the recipe box's protein filter offers an empty
   choice. Add nothing for `bulk`.
6. **Worker** (`worker/src/mcp.js`, `worker/src/claude.js`): the safe-temperature table copied from the
   validator needs `groundChicken` (165°F), `chickenSausage` (165°F, fully cooked) and `sirloinTip`,
   `stewMeat`, `chuckRoast` (145°F); the house-rules text for ideas and the chat connector still suggests
   ground turkey and lists turkey as a protein. It should say chicken over turkey, little pork, Wish-Bone
   ranch, and that Sam's bulk cuts are welcome.

### 24.10 Wired up (the integrator, 2026-11-15 night)

Everything in 24.8 is done on `v3`.

1. **Cost on the screens** (`app/views/common.js` `costOf(app, id, entry)` memoizes `dinnerCost` per
   change to the family's data; `costNote(cost, { short, house })` is the line, the plate's price in
   bold; `styles/parts/cost.css`):
   - **Tonight**: under the plate's calories, "about $4.68 a serving · $23.40 for five. $15.68 of it is
     already in the house."; the short line on each row of the rest of the week (hidden in the TV's
     compact week column).
   - **Plan**: the short line on every night's card; the summary under the week reads "7 dinners
     planned: about $17.45 a dinner, $3.49 a plate. About $349.65 in groceries on the list." (the food
     on the plates is not what the trip costs: the list buys whole packs, lunches and extras). The
     night sheet carries the full line.
   - **Dinner picker**: the short line on every option.
   - **Recipe box**: the short line on each card and **Sort: Cheapest first** (`cheapestFirst` once per
     change; its order is kept on the card facts as `cheapRank`).
   - **Recipe page**: the full line under the calories, and under the ingredients a folded
     "What it costs" list (`#recipe-cost`): each ingredient, the amount, the store, its cost, "est."
     beside an estimated price, the total for five, the estimates sentence, and for bulk meat how the
     Sam's pack is portioned (`bulk.note`).
   - **Plan-ahead result** (`#ahead-cost`): "These 14 dinners: about $294 of food, $21.03 a dinner,
     $4.21 a plate. $96 of it is already in the house; the trip for them comes to about $400."
     `toBuy` is never shown without the word "trip".
   - Lunch cards are not done: the Lunch page already says what the week's lunches cost in all.
2. **`data/prices.json`**: `ranch.jewel.name` is the Wish-Bone 15 fl oz bottle; the validator's warning is gone.
3. **Renamed ids**: `buildDb` keeps `db.renamed` (old → new, only where the new dinner exists).
   `dinnerById` follows it, so a link, a planned night, the list and cook mode find the successor.
   `followRenames(db, state)` (`app/planner.js`) is what every screen reads through (`app.state`):
   a night planned under an old id reads as the new one, and **"loved" follows the dish**. "Not for
   us", retire and promote records do **not** follow: the meat is what changed, so the chicken
   version gets a fresh start. Nothing saved is rewritten (an older copy of the app still open keeps
   finding its ids); changing the signal on the new dinner deletes the old vote record too.
4. **`app/data.js`**: `bulk` on the ingredient, `people` on the lunch item. `lunchLibrary(db, state,
   slot, forName)` leaves out items that are only for someone else, so only Jeff's editor and day
   picker offer the BLT bowl. The shopping list's item sheet shows the bulk note for a Sam's pack.
5. **`PROTEINS`** no longer lists `turkey` (an idea that comes back as turkey is filed under `mixed`).
6. **Worker**: `TEMP_RULES` has `groundChicken`, `chickenSausage` (165°F) and `sirloinTip`, `stewMeat`,
   `chuckRoast` (145°F; the 3-minute rest is asked for in the tool's words but not enforced, as in the
   validator: beef tips, chili and pot roast cook far past it). The house rules for the chat
   connector and the ideas prompt say chicken over turkey, little pork, Sam's bulk cuts, Wish-Bone.
   Not deployed: `v3` only.
7. **The planner makes the most of bulk packs** (`bulkScore`, `BULK_NUDGE` in `app/planner.js`): a
   nudge on a candidate's score, read from the ingredient's `bulk`, never from the dinner tag.
   +0.5 × the share of the meat a dinner needs that is left from a pack this plan already bought for
   another night; +0.3 × the share that is already in the freezer; +0.15 for the big bags that are
   not meat; capped at 0.8. It sits on top of the money math that was already there (using what is
   on hand, not opening a pack for a little) and under the variety rules: the repeat windows, the
   rice and Asian limits and the category and protein penalties are untouched. `tests/bulk.test.mjs`:
   with a tray bought for Monday, the other thigh dinner joins the next two nights in 60 of 60 plans
   (43 of 60 without the nudge), and no week repeats a dinner or a category two nights running.
   There is no dinner-level chip or filter for `bulk`.

### 24.9 Pictures

Thirteen pictures, made exactly like the last pass (Higgsfield `gpt_image_2_6`, quality high, 2k, then
1200×800 + 640×427 for dinners and 640×640 for the side and the lunch): the ten new dinners, steak fried rice
(the meat visibly changed), the Normandy vegetables and the BLT bowl without tomatoes. Each was looked at:
none shows cucumber, raw tomato, raw onion, scallions, seafood or a creamy Parmesan romaine. The dishes that
went from turkey to chicken kept their pictures (crumbles and meatballs look the same), as did the chow mein.
`dev/photo-jobs.json` holds the 13 prompts with `"done": "2026-11-15"`.
