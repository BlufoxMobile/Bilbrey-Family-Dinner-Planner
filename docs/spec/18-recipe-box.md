## 18. v3 — The recipe box: house rules, lighter dinners, the PossibleCooker, detailed recipes, the whole plate

> Jeff, 2026-11-15: "the best possible app … as smart as possible to really help me accomplish my mission of
> saving money on groceries, reducing spoilage, and helping me lose weight … healthy options and a detailed
> recipe." No calorie number: "just lean". The whole family eats healthier. Expose what we missed.

Owner files: `data/recipes.json`, `data/nutrition.json`, `data/catalog.json`, `data/lunches.json`,
`scripts/validate-data.mjs`, `app/data.js`, `app/nutrition.js`, `img/photos.json`, `dev/photo-jobs.json`,
`tests/recipes.test.mjs`.

### 18.1 House rules: what was wrong, and what stops it coming back

- **The two "tofu" dinners.** `sesame-tofu-noodles` and `orange-tofu-bowls` had been chicken dinners since v2,
  but they kept the prototype's ids, and an id shows wherever a link, a file name or the chat connector shows
  it. Two things let them through: the validator read titles, subtitles, steps and photo hints but **never the
  id**, and its reference rule ("every prototype id must still exist") **required** those two ids. Both dinners
  are gone, with their pictures.
- The validator now reads the id and **every string in a dish, whatever field it is in** (a field added later
  is covered without anyone remembering to add it), and the reference rule has one way out:
  `RETIRED_DINNERS`, a named list with the reason. A retired id can't be added back.
- **Lunches** are checked like dinners now (they were only scanned for the banned words). Two salad bowls that
  come with raw grape tomatoes are out of the library (`tf-blt-chicken-bowl`, `bonduelle-chicken-blt`; the
  catalog products stay, so receipts still match). The Cobb salad says to pick the tomato out.
- **Raw onion and tomato** are judged a sentence at a time: "diced onion" is fine in a sentence that cooks it.
  In a **picture** (photo descriptions and image prompts) an onion must be called cooked right there, a tomato
  must be a sauce, soup, salsa or cooked, and cucumbers and scallions never appear.
- Oven words now include baking sheets, sheet pans and roasting pans.
- Steps were rewritten so no raw onion or tomato is ever a topping (the breaded pork sandwich lost its onion,
  carnitas tacos their diced onion).

### 18.2 Lighter, for everyone

Every dinner and side was gone through. What changed, in general:

- **Leaner cuts**: pork Italian sausage → lean turkey Italian sausage (new catalog id `turkeySausage`); ground
  pork → 93/7 ground turkey in the egg-roll bowl; chicken breast where thighs weren't doing anything; the fat
  cap comes off pork loin; one rope of smoked sausage plus chicken instead of two ropes.
- **More vegetables**: a whole bag of slaw or spinach, more peppers, broccoli by the pound and a half, peas in
  the tikka masala and the lemon spaghetti, carrot grated into the meat sauce, lettuce or griddled onions or
  mushrooms on every burger.
- **Less added fat and sugar**: butter, oil, cheese, mayo, honey and brown sugar cut where the dish didn't need
  them (brown butter spaghetti keeps its brown butter: 5 tablespoons, not 8). Potatoes for burritos and
  breakfast tacos are microwaved, then browned in one spoon of oil, not fried.
- **Normal portions, not small ones**: about 2 to 2¼ lb of meat for five (6½ to 7 oz raw each), ¾ of a box of
  pasta, 1½ cups of rice. Burger nights are 2 lb of beef or six ⅓-lb patties, not 2½ lb or eight.
- **A vegetable or salad among every default pair of sides** (burger nights stay "burgers and fries", Jeff's
  rule, so the burger carries the vegetable). Sides were lightened too: one slice of garlic toast each, three
  naan cut in wedges, half the butter on most things.
- Comfort nights stay: burgers, personal pizzas, naan pizzas, pulled pork, Italian beef.

One plate (main + default sides ÷ 5) averaged 954 kcal before and about 790 now, with 58 g protein, 11 g fiber
and 3 vegetable servings. No plate is over 1,000 kcal (the old box reached 1,429) and none is under 500. The
validator holds those lines: a plate over 1,000 kcal, under 25 g protein or short of a vegetable is an error.

### 18.3 Ninja Foodi Everyday PossibleCooker Pro 6.5 qt (MC1101) — equipment id `possible cooker`

What the machine does, checked against Ninja's quick-start guide and FAQ for the MC1100 series, retailer
listings and the MC1101 quick guide (ninjakitchen.com itself refused the request):

| Function | Settings | What the recipes rely on |
|---|---|---|
| SLOW COOK | HI or LO; LO runs 6–12 hours, HI 2–12 hours; lid on | Ninja's chart: boneless chicken 6–7 h LO / 3–4 h HI; top round 9–10 h LO |
| SEAR/SAUTÉ | HI, MED, LO; lid off to preheat (about 5 minutes, then it beeps); the timer counts up | Brown first in the same pot, and bring a soup to a boil at the end |
| BRAISE | Picks its own temperature (about 210°F, a gentle bubble); you set the time; lid on | Pork loin 45 min, meatballs 40 min, chicken thighs 35 min |
| WHITE RICE / BROWN RICE / OATS / PASTA | Set their own time, then KEEP WARM | 1 cup white rice to 1½ cups water; up to 4 cups of rice or 1 lb of pasta |
| KEEP WARM | Counts up; a finished program drops into it | Dinner holds if someone is late |
| STEAM | 1 cup of water, lid on, set a time (Ninja's steam chart: broccoli, carrots, green beans 5–10 min) | Steamed carrots and green beans |

Honest limits: the US booklet prints HIGH / MEDIUM / LOW where the recipes say HI / MED / LO. STEAM is a
named button on some MC1101 panels but only a chart in the US quick-start guide, which lists eight functions
without it, so the steamed sides were first written with SEAR/SAUTÉ on HI under a lid. **Jeff confirmed on
2026-11-15 that his cooker has STEAM**, and the sides that steam in the pot (steamed carrots, steamed
green beans with lemon, and §24's steamed broccoli, cauliflower & carrots) use it: the step's `setting` is
`STEAM`, with the cup of water, the lid on, a time to set (9, 7 and 7 minutes) and one wording for what the
machine does ("The cooker brings the water to a boil first, then counts the time down and beeps"), followed
by the doneness cue. Steamed broccoli and steamed mixed vegetables stay on the stove (the cooker is usually
busy with the main dish) with a tip that STEAM does them hands-off when it is free (§24.6). No dinner steams
in the pot. The Worker's kitchen text for Claude (ideas
and the chat connector) says the STEAM function is there. The pot is nonstick (wooden or silicone tools). The white-rice program's
length isn't published; the rice side says "about 25 minutes" and lets the cooker finish on its own.

- `possible cooker` is in `EQUIPMENT_LABELS` ("PossibleCooker") and `EQUIPMENT_ICON` (a new `cooker` icon) in
  the app, in the validator, in the ideas equipment lists (app and Worker) and in the chat connector's house
  rules and profile.
- **14 new dinners**: chicken tortilla soup, white chicken chili, beef stew, BBQ pulled chicken sandwiches,
  salsa chicken tacos, braised pork loin with apples & onions, chicken noodle soup, turkey meatballs in
  marinara, turkey sausage minestrone, sesame-ginger chicken, beef & broccoli, one-pot lasagna soup, chicken
  cacciatore, Italian beef. Twelve are core, two bench. **6 new sides**: steamed carrots, steamed green beans
  with lemon, PossibleCooker jasmine rice, lighter mashed potatoes (all in the cooker), steamed mixed
  vegetables and a spinach & apple salad.
- Built for two or three trips a month: frozen chicken, beef and vegetables, canned beans and tomatoes, cartons
  of stock, pasta, onions, carrots and potatoes. Eleven of the fourteen are tagged `freezer friendly`, six are soups.
- A step that uses the cooker carries its setting exactly: `SLOW COOK on LO`, `SLOW COOK on HI`,
  `SEAR/SAUTÉ on HI|MED|LO`, `BRAISE`, `STEAM`, `WHITE RICE`, `BROWN RICE`, `OATS`, `PASTA`, `KEEP WARM`. The
  validator refuses any other spelling, a LO slow cook outside 6–12 hours, a cooker setting on a dinner that
  doesn't list the cooker, and a cooker dinner with no setting at all. It warns when a dinner and its default
  side both need the pot.
- New catalog ids (packs and prices are estimates, marked `(est.)` the way the file already does):
  `whiteBeans`, `celery`, `turkeySausage`, `greenChiles`, `beefBroth`.
- New tags: `soup`, `freezer friendly`.

### 18.4 Detailed recipes — the data contract

`data/recipes.json`, each dinner (all optional for a dinner the family saved themselves; required for built-in ones):

```json
{
  "minutes": 375,                      // still the total, start to plate = prepMinutes + cookMinutes
  "prepMinutes": 15,                   // hands-on
  "cookMinutes": 360,                  // the heat does the work
  "steps": [
    "A plain sentence is still a step.",
    { "text": "Put the lid on. Select SLOW COOK, set it to LO…", "minutes": 360, "setting": "SLOW COOK on LO" }
  ],
  "tips": ["Up to four short sentences."],
  "leftovers": "One sentence: how to store it or use it again."
}
```

- A step is a string or `{ text, minutes?, setting? }`. `minutes` is a timer worth setting; `setting` is the
  appliance setting ("Air fryer, 400°F", "Stovetop, medium-low, lid on", "SLOW COOK on LO"). `minutes: 0`
  means "no timer here". Sides take the same steps and may have `tips`.
- After `app/data.js`:
  - `dinner.steps` is **always an array of strings** (every existing screen, the Worker and the chat connector
    keep working untouched), and `dinner.stepDetail` is `[{ text, minutes, setting }]`, same length and order,
    `minutes` a whole number or `null`, `setting` a string or `null`.
  - When a step gives no `minutes`, it is read from the words (`stepMinutes(text)`): "about 10 minutes" → 10;
    a range starts at its early end ("6–8 minutes" → 6) so the cook checks in time; hours count ("6 to 7
    hours" → 360); with several times in one step the longest is the cook time; seconds are no timer.
  - `dinner.prepMinutes`, `dinner.cookMinutes` (numbers or `null`), `dinner.tips` (array, maybe empty),
    `dinner.leftovers` (string, maybe empty). Sides get `stepDetail` and `tips` too.
  - `handsOnMinutes(dinner)` (prep when known, else the total) and `fmtMinutes(n)` ("25 min", "7 hr 20 min").
    A slow-cooker dinner's `minutes` is 6–8 hours: use `handsOnMinutes` for "is this a weeknight dinner" and
    `fmtMinutes` to show it.
- Every built-in dinner was rewritten for a nervous cook: amounts for five named in the step, the heat, what
  done looks like, the safe temperature (chicken and turkey 165°F, ground beef and patties 160°F, pork and
  whole beef 145°F with a rest), and what to do while something else cooks. The validator requires at least
  three steps, a timer, a tip, leftovers and `prepMinutes + cookMinutes = minutes`.

### 18.5 The whole plate — `app/nutrition.js`

`data/nutrition.json` now gives, per ONE catalog unit: `kcal`, `protein`, and estimated `carbs`, `fat`, `fiber`
(grams), plus `veg` (vegetable servings) where the item is a vegetable or beans. The file says so:
`macrosEstimated: true`, `vegServingGrams: 80`. The macros come from the same sources as the calories (USDA
FoodData Central reference values, package labels) and each row is checked: 4 × protein + 4 × (carbs − fiber)
+ 2 × fiber + 9 × fat must land within 15% of its calories. Every id a dinner, side or lunch uses must have
all five numbers (an error, not a warning).

```js
plateHealth(db, state, dinnerId, entry)
// → { kcal, proteinG, carbsG?, fatG?, fiberG?, vegServings, lean, why }   or null
```

- One plate of five: the main plus the sides as they'll be served that night (`entry.sides`, remembered
  substitutions, the meat setting). Same plate as `plateNutrition`. `null` when the dinner is unknown or there
  is no nutrition file.
- `kcal`, `proteinG`, `carbsG`, `fatG`, `fiberG` are whole numbers. The three optional ones are left off when
  any ingredient on the plate has no number for them. Nothing is guessed.
- `vegServings`: to one decimal; one serving is 80 g of vegetables or beans (about ½ cup cooked). Potatoes,
  sweet potatoes and fries are the starch; fruit isn't counted.
- `lean`: `kcal <= LEAN_RULE.maxKcal && proteinG >= LEAN_RULE.minProteinG`, with
  `LEAN_RULE = { maxKcal: 750, minProteinG: 35 }`. False when an ingredient has no calorie data (the total
  would be short). 37 of the 95 dinners are lean with their default sides.
- `why`: one plain sentence for a card: "A lean plate: 640 cal with 50 g protein.", "A heartier plate: 890 cal
  with 52 g protein.", "Lighter on protein: 24 g a plate, 330 cal." It describes the plate, never the person:
  no targets, no good or bad.
- Also exported: `itemsMacros(db, items, divide)`, `lunchMacros(db, lunch)`, `LEAN_RULE`, `VEG_SERVING_GRAMS`.

### 18.6 Pictures

- A dish's `photo` is its description for the image model. Changed and new dishes were rewritten, and no
  description mentions cucumber, raw tomato, raw onion or scallions.
- A dish with no entry in `img/photos.json` shows the warm placeholder (no `<img>` is rendered), so a new
  dish never shows a broken image. `photos.json` only lists files that exist; the validator checks the disk.
- `dev/photo-jobs.json` is the queue for whoever makes the pictures:
  `[{ kind: 'dinner'|'side'|'lunch', id, file, prompt, why }]`, in priority order. `file` is where the picture
  goes (`img/dinners/<id>.webp` plus the usual `-640.webp`, `img/sides/<id>.webp`, `img/lunch/<id>.webp`).
  **When a new dish's picture lands, add `"<id>": "<file>"` to `img/photos.json`** and take the job off the
  list; pictures that replace an existing file need no change. The validator warns for each dish that is
  queued and errors for a dish with neither a picture nor a job.
- Looking at every picture (contact sheets of `img/`) turned up far more than the four known ones: 17 dinner
  pictures show cucumber (the old cucumber sides were photographed on the plate), others raw tomato or raw
  onion, five have a scallion garnish, and seven lunch items never had a picture at all. 58 jobs are queued:
  24 that break a house rule, 27 with no picture (the new dishes and those lunches), 2 whose dish changed, and
  the 5 scallion garnishes last.
- Lunch copy that states calories or protein has to match what the app works out from the items (the
  Salsalito sandwich said 550 and adds up to about 610); the validator checks it.
