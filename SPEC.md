# The Bilbrey Family Dinner Planner — Build Spec (v2)

Owner: Jeff Bilbrey. This replaces a ChatGPT-built prototype ("Supper for Five" →
"The Bilbrey Family Dinner Planner") that lived on a private chatgpt.site. We are
rebuilding it to be **excellent**, publishing it on GitHub Pages so the whole family
can use it from their phones, with a small Cloudflare backend for shared family data.

Live URL (target): `https://blufoxmobile.github.io/Bilbrey-Family-Dinner-Planner/`
Repo: `BlufoxMobile/Bilbrey-Family-Dinner-Planner` (cloned at `/home/claude/bilbrey-family-dinner-planner`)
Reference data from the prototype: `reference/chatgpt-v1-data.json` (50 dinners, 24 sides,
67 ingredients with Sam's/Jewel pack sizes + prices, name-brand multipliers, shared steps).

---------------------------------------------------------------------------------------
## 1. The family and the end game (read this — it drives every decision)

- **Household of five, all eat adult portions:** Jeff, Candi (wife), Knox, Jordan, Jackson.
  Every dinner feeds 5 full adult plates ("at least a plate full each").
- **Goal:** cut groceries from **$1,000+/month to $600–700/month** (prototype target: $650),
  and stop running back to Jewel-Osco every few days. Buy **in bulk at Sam's Club** (e.g. a 10 lb
  pack of chicken or beef spread across several dinners), fill gaps (seasonings, small items,
  fresh odds and ends) at **Jewel-Osco**.
- **Stores:** Jewel-Osco, 599 E. Roosevelt Road, Glen Ellyn, IL. Sam's Club, Addison, IL.
  They live in Glen Ellyn, IL (Central time, America/Chicago).
- **Dinner only** (no lunches/breakfasts planned) — but the shopping list should let them add
  everyday extras so ONE list covers the trip.

### Food rules (hard constraints)
- Every dinner = **one meat entrée + two sides**. Exception: **burger nights default to one side —
  a bag of Jewel-Osco frozen fries** — with an option to add a second side.
- **Meat in every dinner** (chicken, beef, pork, turkey, sausage, bacon…). No vegetarian-only
  dinners. Salads are welcome (Jeff loves them) but must have meat on them.
- **No seafood. Ever. No tofu.**
- Family favorites: brown butter spaghetti, regular spaghetti, frozen pizza (1–2×/month),
  chicken tikka masala, fried rice, orange chicken, hamburgers (~2×/week; Jeff has a Blackstone),
  Asian food in general ("we really love Asian food").
- Rice: Candi doesn't love rice — a rice meal only every so often (max 1 per week). She likes
  basmati and jasmine.
- Try to eat a bit healthier where possible.

### Kitchen equipment
- **Gas stovetop burners: YES (Jeff confirmed 2026-11-14).** Boil pasta, cook rice, simmer sauces.
- **Oven: NEVER.** (It leaks propane. Never write a step that uses the oven/broiler.)
- Blackstone griddle (outdoor), indoor electric grill, outdoor grill, air fryer, microwave.
- Storage: one large fridge, one small freezer, one outdoor freezer, a full pantry (canned goods).
  So bulk buying is easy to store.

### Everything Jeff asked for (all must work in v2)
1. ~50 dinner recipes built in, with recipes/steps. Week planner and month planner.
2. Family voting: anyone can thumbs-up (keep in rotation) or thumbs-down; disliked dinners get
   replaced by a new menu item from the bench.
3. Bulk reuse: plan dinners so a 10 lb Sam's pack is used across several meals; show
   "from the freezer" (how far bulk packs go, and what's left over).
4. Pantry photo scan before ordering: take photos of the pantry; the app detects what's there
   (including foods not in the recipe list) and removes it from the shopping list. Long-lasting
   staples (salt, pepper, spices) can be marked "stocked until low" so they stay off lists.
   Measured items (chicken, pasta) take a quantity so only the shortfall is bought.
5. **Substitute** any side with something already on the shelf (e.g. canned green beans). The
   substitution is **remembered for that dinner going forward** and the grocery list updates.
6. Generic vs name brand: household default + per-item override (to cut costs).
7. Ballpark cost per store, as live as possible (see §6 — retailers have no public APIs).
8. Plan **1 week, 2 weeks, 3 weeks, or a month** at a time (buy small or buy big).
9. Plan from **Sam's Club only, Jewel-Osco only, or both** — "I might only want to do a week of
   food I can buy at Jewel" — then the plan uses only items available at that store (+ pantry).
10. One-tap ordering handoff to each store (copy the list in the store's format + open the store).
11. **"Not Eating at Home"** nights (date night, out of town, big lunch / not hungry, eating out):
    clearing a night removes that dinner AND its groceries from the list. Multi-night ranges for
    trips. (Unfinished in the prototype — top priority for v2.)
12. **Switch meals anytime:** "If I want brown butter spaghetti tonight, I can opt for that and it
    switches — the current meal moves to the day brown butter spaghetti was on, and vice versa."
    (Unfinished in the prototype — top priority for v2.)
13. Shareable with the family on their phones; everyone sees the same plan, votes, pantry.

---------------------------------------------------------------------------------------
## 2. Architecture

- **Frontend:** static site on GitHub Pages. No build step. Vanilla JS ES modules, hand-written
  CSS, self-hosted fonts (no CDNs — Jeff prefers no external dependencies). Installable PWA with a
  service worker (works offline; queues changes). Phone-first (iPhone), great on desktop too.
- **Backend:** one Cloudflare Worker (`bilbrey-dinner-planner`) on Jeff's existing Cloudflare
  account, with a **SQLite-backed Durable Object** holding the family state document (strong
  consistency, free plan) and the **Workers AI** binding for pantry photo recognition.
  Expected URL: `https://bilbrey-dinner-planner.jeff-bilbrey-jb.workers.dev` (put it in
  `app/config.js` as `API_BASE`; the deploy step confirms it).
- **The app must still work if the Worker is unreachable** (offline / not yet deployed): it runs
  from local storage and syncs when it can.

### Repo layout and ownership (each agent writes ONLY its own paths; nobody runs git)
| Path | Owner |
|---|---|
| `data/recipes.json`, `data/catalog.json`, `scripts/validate-data.mjs` | Recipes agent |
| `data/prices.json`, `data/stores.json` | Pricing agent |
| `img/dinners/<dinnerId>.webp`, `img/sides/<sideId>.webp`, `img/photos.json` | Photos agent |
| `worker/**` | Backend agent |
| `index.html`, `app/**`, `styles/**`, `fonts/**`, `icons/**`, `manifest.webmanifest`, `sw.js`, `tests/**`, `dev/**` | Frontend agent |
| `SPEC.md`, `README.md`, `reference/**`, commits/pushes | Coordinator (main session) |

Never `git add/commit/push`. Never edit another agent's paths. If you need a change in another
agent's file, say so in your final report.

---------------------------------------------------------------------------------------
## 3. Data contracts

### 3.1 `data/catalog.json` — ingredients
```json
{
  "version": 2,
  "units": { "lb": "lb", "oz": "oz", "cups": "cups", "...": "..." },
  "ingredients": {
    "chicken": {
      "name": "Boneless skinless chicken breast",
      "unit": "lb",                      // the ONE unit recipes, pantry and packs use for this id
      "aisle": "Meat",                   // Meat | Produce | Frozen | Dairy & Eggs | Bakery | Pasta & Grains | Canned & Jarred | Condiments & Sauces | Spices & Baking | Snacks & Extras
      "storage": "freezer",              // freezer | fridge | pantry | counter
      "kind": "measured",                // measured (track a quantity) | staple (stocked-until-low: spices, oil, condiments)
      "defaultStore": "sams",            // sams | jewel  (bulk → sams)
      "aliases": ["chicken breast", "chicken breasts"],   // used to match pantry scans
      "packs": {                         // ESTIMATES; data/prices.json overrides when present
        "sams":  { "generic": { "size": 10, "price": 29.90, "label": "Member's Mark boneless skinless chicken breasts, ~10 lb" },
                   "name":    { "size": 6,  "price": 24.98, "label": "…" } },
        "jewel": { "generic": { "size": 3,  "price": 11.97, "label": "Signature Farms …" },
                   "name":    { "size": 2.5, "price": 12.49, "label": "…" } }
      }
    }
  }
}
```
- **Keep every existing ingredient id AND its unit from `reference/chatgpt-v1-data.json`.**
  Add new ids freely (camelCase or kebab, but stable).
- A store may be missing from `packs` if it truly doesn't carry it.

### 3.2 `data/recipes.json` — dinners and sides
```json
{
  "version": 2,
  "dinners": [{
    "id": "brown-butter-spaghetti",      // KEEP all 50 existing ids from the reference data
    "title": "Brown butter spaghetti with grilled chicken",
    "subtitle": "One short appetizing sentence.",
    "category": "Pasta",                 // Burgers | Asian-inspired | Pasta | Tex-Mex | Grill | Comfort | Salads
    "protein": "chicken",                // chicken | beef | pork | turkey | sausage | mixed
    "minutes": 40,
    "equipment": ["stovetop", "electric grill"],   // stovetop | blackstone | electric grill | outdoor grill | air fryer | microwave
    "tags": ["family favorite"],         // known tags: burger, pizza, rice, family favorite, noodle night, taco night, grill night, salad, healthier, sandwiches, wraps
    "rotation": "core",                  // core (the ~50 in rotation) | bench (waiting to replace a voted-out dinner)
    "items": { "chicken": 2.25, "spaghetti": 16 },   // ENTRÉE ingredients for 5 adult portions, catalog units
    "steps": ["Plain, numbered-in-UI steps. Safe internal temps (chicken 165°F, ground beef 160°F, pork 145°F + rest)."],
    "sides": ["buttered-peas", "romaine-salad"],     // default sides (2; burgers: ["jewel-fries"])
    "sideSlots": 2,                      // 2 normally; 1 for burgers (UI offers "add a side")
    "photo": "Food-photo prompt hint: what the plated entrée looks like."
  }],
  "sides": [{
    "id": "steamed-broccoli", "title": "Steamed broccoli",
    "kind": "vegetable",                 // vegetable | starch | salad | fruit | bread | soup
    "minutes": 8, "equipment": ["microwave"],
    "items": { "broccoli": 1.25 }, "steps": ["…"],
    "photo": "prompt hint"
  }]
}
```
- Item quantities are per dinner for all five people.
- Custom (pantry-only) items are NOT in the catalog; the app stores them in state (§4).

### 3.3 `data/prices.json` — researched prices (overrides catalog `packs`)
```json
{
  "updated": "2026-11-14",
  "notes": "How these were gathered; what is estimated vs. seen on the retailer site.",
  "prices": {
    "chicken": {
      "sams":  { "generic": { "size": 10, "price": 29.90, "label": "…", "url": "https://…", "confidence": "listed|estimated" },
                 "name":    { … } },
      "jewel": { "generic": { … }, "name": { … } }
    }
  }
}
```
`size` is ALWAYS in the catalog unit for that ingredient id.

### 3.4 `data/stores.json`
Store names, addresses, phone, hours, website + app/deep links, and the exact handoff method for
each (Jewel-Osco: paste list into the Jewel-Osco app's AI list import / shopping list; Sam's Club:
Reorder / Sparky list reading / shopping list). Researched by the pricing agent.

### 3.5 `img/photos.json`
`{ "dinners": { "<id>": "img/dinners/<id>.webp" }, "sides": { … }, "generated": "date", "model": "…" }`
The app uses a photo when listed, else a tasteful generated placeholder (never a broken image).

---------------------------------------------------------------------------------------
## 4. Shared family state (synced through the Worker)

One JSON document. The client changes it by sending **ops**; the server applies them in order,
creating intermediate objects as needed (last write wins per path).

Ops:
- `{ "op": "set", "path": ["votes","smashburgers","Knox"], "value": 1 }`
- `{ "op": "del", "path": ["plan","2026-11-21"] }`
- `{ "op": "push", "path": ["receipts"], "value": { … } }` (append to array, create if missing)

State shape (owned by the frontend; the backend is schema-agnostic):
```
{
  settings: { planStore: "both"|"sams"|"jewel", brand: "generic"|"name", monthlyTarget: 650,
              period: "week"|"two"|"three"|"month", burgerNights: [0,4], pizzaPerMonth: 2,
              riceMaxPerWeek: 1, weekStartsOn: 1 },
  plan: { "YYYY-MM-DD": { dinner: id, sides: [id|"custom:<id>"], status: "planned"|"away"|"cooked",
                          away?: { reason: "Date night"|"Out of town"|"Big lunch"|"Eating out"|"Other", note? },
                          by: "Jeff", at: iso } },
  votes: { dinnerId: { Jeff: 1|-1, Candi: 1|-1, ... } },
  retired: { dinnerId: { by, at } },          // voted out → bench dinner promoted
  promoted: { benchId: { replaced: dinnerId, at } },
  substitutions: { dinnerId: { "0": "sideId" | "custom:<id>", "1": … } },   // remembered per dinner
  pantry: { ingredientIdOrCustom: { qty: number|null, stocked: bool, low?: bool, at, by } },
  custom: { "custom-<slug>": { name, unit, aisle, kind } },               // shelf items not in catalog
  brands: { ingredientId: "generic"|"name" },
  storeFor: { ingredientId: "sams"|"jewel" },
  prices: { "sams/generic/chicken": { size, price, at, by } },           // family's own price corrections
  availability: { "jewel/chicken": true|false },
  extras: { id: { name, qty, unit, store, every: "trip"|"week" } },       // everyday non-dinner items
  checked: { "<listKey>": { ingredientId: true } },                       // shopping check-off
  receipts: [ { date, store, amount, note, by } ],
  customDinners: { id: <dinner object> }
}
```

---------------------------------------------------------------------------------------
## 5. Backend API (Worker) — contract shared by backend + frontend

All JSON. CORS: allow `https://blufoxmobile.github.io` and any `http://localhost:*` /
`http://127.0.0.1:*` origin. Auth header `X-Family-Key` on everything except health/setup.

**Family key:** the client derives `key = hex(SHA-256("bilbrey-dinner-planner:" + passcode.trim().toLowerCase()))`
and never sends the raw passcode. The server stores a salted hash of `key` (never `key` itself).
First person to open the app with no passcode configured creates it (Jeff, right after launch).

| Method | Path | Body → Response |
|---|---|---|
| GET | `/api/health` | → `{ ok, hasPasscode, ai: true|false, revision }` |
| POST | `/api/setup` | `{ key }` → 201 `{ ok }` only if no passcode yet; else 409 |
| POST | `/api/key` | `{ newKey }` (auth with current key) → `{ ok }` |
| GET | `/api/state?since=N` | → `{ revision, updatedAt, state }` or `{ revision, unchanged: true }` |
| POST | `/api/ops` | `{ ops: [...], by: "Candi", clientId }` → `{ revision, updatedAt, state }` |
| POST | `/api/scan` | `{ image: "data:image/jpeg;base64,…", known: [{ id, name, aliases }] }` → `{ items: [{ name, matchId|null, qty|null, unit|null, confidence: 0..1 }], model }` |

Limits: ≤200 ops/request, state ≤ 1 MB, image ≤ 1.5 MB (client resizes to ~1280px JPEG first).
Wrong key → 401. Repeated wrong keys → simple backoff (429). Errors: `{ error: "message" }`.

---------------------------------------------------------------------------------------
## 6. Honest limits (state these in the UI where relevant; never pretend otherwise)
- Neither Sam's Club nor Jewel-Osco offers a public API to read live prices/stock or fill a cart.
  "Order" = copy a store-formatted list + open the store's app/site; the family confirms checkout.
- Prices are researched estimates (date-stamped) the family can correct in-app; corrections sync.
- Pantry scan is AI-assisted: the family always confirms items and amounts.

---------------------------------------------------------------------------------------
## 7. Quality bar
- Jeff wants it "absolutely perfect". Phone-first, fast, beautiful, warm. Real food photos.
- No dead buttons, no lorem ipsum, no "coming soon".
- Every number on screen must be traceable to data + math (no invented figures).
- Accessible: ≥44px tap targets, good contrast, works with large text, keyboard friendly.

---------------------------------------------------------------------------------------
## 8. v2.1 — Lunches, coupons, calories (Jeff's asks, 2026-11-14 evening)

### 8.1 What Jeff asked for (his words, paraphrased closely)
- "Add a lunch option. Select a person's name and plan lunches for the week." Lunches are
  **optional for every family member** (Jeff, Candi, Knox, Jordan, Jackson); **each person
  customizes their own**. Jeff will add the others' options later — so ship Knox's and Jeff's
  pre-set, and the others OFF by default with an easy, healthy library to pick from.
- **Weekdays only (Mon–Fri)** by default (per-person day toggles in the app).
- "For lunches we should do healthy options."
- **Knox:** Boar's Head **Black Forest ham** from Jewel (deli) and the Boar's Head **Italian
  blend with salami and cheese**; a bag of **Cool Ranch Doritos** from the Sam's ~30-count pack
  ("in whatever fashion we can get the best deal, even a mixed/variety pack"); a snack like
  **Oreos in the individual packs** from Sam's "with whatever other snacks come in the multipack";
  drinks **alternate daily between a Yoo-hoo pack and Capri Sun Fruit Punch**.
- **Jeff:** a **healthy prepackaged salad** from Sam's or Jewel — **ranch dressing only, nothing
  else**; and an **Orange Mango BodyArmor every day**.
- "Help me lose weight and get in better shape — I want to be healthier." Jeff chose:
  **calories & protein shown** (every lunch and dinner, plus a daily estimate for each person) and
  **lighter-swap suggestions** (e.g. BodyArmor Lyte, light ranch, adding chicken to a salad). He did
  NOT want weight tracking or movement goals.
- **Coupons:** "automatically clip all coupons." Not possible from the app (no store API, and the
  app must never hold a store password). Jeff chose **a Coupons button**: open Jewel-Osco's
  digital-coupon page (for U) so someone taps Clip All / clips before shopping, and explain that
  Sam's Club Instant Savings apply automatically at checkout for members (link to the current
  Instant Savings page).

### 8.2 `data/lunches.json` (new)
```json
{
  "version": 1,
  "updated": "2026-11-14",
  "slots": [
    { "id": "main",  "label": "Main" },
    { "id": "side",  "label": "Side" },
    { "id": "snack", "label": "Snack" },
    { "id": "drink", "label": "Drink" }
  ],
  "items": [{
    "id": "bh-black-forest-ham-sandwich",
    "slot": "main",
    "title": "Boar's Head Black Forest ham sandwich",
    "subtitle": "Short appetizing line.",
    "items": { "bhBlackForestHam": 0.19, "bread": 2 },   // catalog ids, quantity PER LUNCH, catalog units
    "tags": ["kid favorite"],                            // e.g. healthy, kid favorite, high protein, no-prep
    "prep": "One plain sentence: how to pack it.",
    "photo": "Food-photo prompt hint (no brands/logos/text)."
  }],
  "defaults": {                                          // what each person starts with
    "Knox":  { "enabled": true,  "days": [1,2,3,4,5],
               "slots": { "main": ["bh-black-forest-ham-sandwich", "bh-italian-…"], "side": ["…doritos…"],
                          "snack": ["…cookie-multipack…"], "drink": ["yoohoo…", "capri-sun-fruit-punch…"] } },
    "Jeff":  { "enabled": true,  "days": [1,2,3,4,5], "slots": { "main": ["…salad-ranch…"], "drink": ["…bodyarmor-orange-mango…"] } },
    "Candi": { "enabled": false, "days": [1,2,3,4,5], "slots": {} },
    "Jordan":{ "enabled": false, "days": [1,2,3,4,5], "slots": {} },
    "Jackson":{"enabled": false, "days": [1,2,3,4,5], "slots": {} }
  },
  "swaps": [                                             // lighter swaps the app can suggest
    { "from": "<lunch item id>", "to": "<lunch item id>", "why": "Same flavor, ~70 fewer calories a day." }
  ]
}
```
- A slot's list is a **rotation**: day N of the person's lunches uses `list[N % list.length]`
  (so Yoo-hoo / Capri Sun alternate daily). Empty/missing slot = not packed.
- Lunch products are ordinary catalog ingredients (new ids appended to `data/catalog.json`, with
  Sam's/Jewel packs and `"lunch": true`) so the shopping list's pack math, store/brand toggles,
  pantry and prices all just work (e.g. one 30-ct chip variety pack covers 30 lunches; leftovers
  carry forward).
- The library should include ~25–35 lunch items: Knox's and Jeff's picks, plus healthy choices for
  the rest of the family (turkey/ham wraps, chicken salad kits, Greek yogurt, fruit cups, apples,
  baby carrots + ranch cups, string cheese, hummus snack packs, protein bars, sparkling water,
  milk boxes, etc.) — real products the two stores sell, priced.

### 8.3 `data/nutrition.json` (new)
```json
{ "updated": "2026-11-14", "notes": "Sources and method.",
  "per": { "chicken": { "kcal": 545, "protein": 102, "unit": "lb", "basis": "raw, per 1 lb", "source": "USDA FDC #…" } } }
```
`kcal`/`protein` (grams) are per ONE catalog unit of that ingredient (the catalog's `unit`).
Dinner per plate = (entrée items + effective sides) ÷ 5, after the meat scale; lunch = sum of its items.

### 8.4 State additions (§4)
```
lunch: {
  people: { "Knox": { enabled, days: [1..5], slots: { main: [ids], side: [ids], snack: [ids], drink: [ids] } } },
  days:   { "YYYY-MM-DD": { "Knox": { skip?: true, reason?: "Buying lunch"|"No school"|"Other", picks?: { slot: id|null } } } },
  custom: { "<id>": <lunch item object> }            // family-added lunch items
}
health: { showNutrition: true }                        // per-device preferences go in localStorage, not here
```

### 8.5 UI expectations
- A **Lunch** section reachable from the main nav (phone: replace or join the tab bar sensibly —
  keep ≤5 bottom tabs; e.g. Tonight / Plan / Lunch / List / Pantry with Recipes moved into Plan or a menu).
- Person chips at the top (only enabled people + "Add a person"); the phone's own person first.
- Week view Mon–Fri: each day's packed lunch (main/side/snack/drink) with photos, calories and
  protein; tap to swap an item for that day, or skip the day (reason). "Edit Knox's lunches" sheet:
  choose items per slot (multi-select = rotation order), days, enable/disable.
- Lunch groceries join the shopping list and budget (with a "Lunches" tag/filter), respecting the
  planner period. Calories/protein on recipe pages, Tonight, plan cards and lunch cards ("≈ 720 cal ·
  48 g protein per plate"), and a "Today for Jeff ≈ 1,350 cal (lunch + dinner)" line on Tonight.
- Lighter swaps: a small, kind "Lighter idea" chip where a swap exists (lunch swaps from
  lunches.json; dinner sides: a lower-calorie side of the same kind), one tap to apply, remembered.
  Never preachy; never on Knox/kids' items unless their parent opens the editor.
- Coupons: a "Clip Jewel coupons" button (and Sam's Instant Savings link) in the List screen and in
  the store handoff sheet, using URLs in data/stores.json (`coupons` field per store).

---------------------------------------------------------------------------------------
## 9. v2.2 — Thumbs everywhere, receipts, "My products" (Jeff's asks, 2026-11-15 morning)

### 9.1 What Jeff asked for
- "A thumbs up or thumbs down on each menu item. Thumbs down = we don't like it and don't want
  that again. Thumbs up = keep it in rotation. I also want to downvote side dishes."
  Jeff chose: **ONE thumbs-down from anyone drops it** (dinner or side) — out of rotation for good,
  restorable from a "Dropped" list. (Replaces the old 3-thumbs-down rule. Existing state.votes
  with a -1 therefore retires that dinner on upgrade — do it lazily in the planner/UI, never with a
  mass write.) Thumbs-up = keep in rotation (weighted up; ≥2 thumbs-up or the existing tag = favorite).
- "Sync to receipts on the apps to determine the price of items purchased so next time I can
  predict cost." Store apps have no API. Jeff chose: **scan receipts in the app** (photo of a paper
  receipt, or screenshot(s) of the digital receipt in the Sam's Club / Jewel-Osco app — multiple
  images per receipt) **and** a one-time import of his past purchases (the coordinator reads his
  purchase history in his signed-in Chrome and feeds it through the same import path).
- "Search for those specific brands so I purchase the specific product I want. I don't buy all
  generic or all name brand — I like different products for each type of food."
  → **My products**: per ingredient, per store, the exact product the family buys (brand, name,
  size, price, optional link). Shown on the list and in the Copy & open text; one-tap "Find it" search
  for that exact product in the store's site/app. Learned automatically from receipts.

### 9.2 Votes (state)
- `votes[dinnerId][person] = 1|-1` (unchanged), NEW `sideVotes[sideId][person] = 1|-1`.
- A dinner with any -1 is dropped (treat like `retired`; promote a bench dinner as today, same
  friendly note: "Candi gave it a thumbs down, so … is off the menu. … takes its place."). A side
  with any -1 is dropped: never used as a default or suggestion; every dinner whose default side is
  dropped gets the best same-kind replacement side automatically (deterministic, not written to
  substitutions); an existing remembered substitution to a dropped side falls back the same way.
- "Dropped" list in Recipes (dinners + sides) with Restore (clears that item's -1 votes).
- Thumbs on: Tonight (entrée + each side), plan day cards (compact), recipe page, side rows, and a
  "How was dinner?" card on Tonight the evening a night is marked cooked and the next morning
  (entrée + both sides, per the phone's person; dismissible). Lunch items get thumbs too
  (`lunchVotes[itemId][person]`; a -1 removes it from THAT person's rotation only).

### 9.3 Receipts — Worker `POST /api/receipt`
Body `{ images: ["data:image/jpeg;base64,…", …≤4], store?: "sams"|"jewel", known: [{id,name,aliases}] }`
(≤1.5 MB each, ≤4.5 MB total). Response:
```json
{ "store": "sams|jewel|unknown", "date": "YYYY-MM-DD|null", "total": 123.45, "subtotal": …, "tax": …,
  "savings": 12.34,
  "lines": [{ "text": "MM CHKN BRST 6.5LB", "product": "Member's Mark Boneless Skinless Chicken Breast",
              "brand": "Member's Mark", "size": "6.5 lb", "qty": 1, "unitPrice": 17.94, "lineTotal": 17.94,
              "discount": 0, "matchId": "chicken"|null, "confidence": 0.0-1.0 }],
  "model": "…" }
```
Receipt abbreviations must be expanded into readable product names. Same model/fallback policy as
/api/scan. Image text is untrusted input: the model is told to only transcribe.

### 9.4 Receipts & products — state additions
```
receiptLog: { "<id>": { store, date, total, savings, by, at, source: "scan"|"import",
                        lines: [{ product, brand, size, qty, unitPrice, lineTotal, matchId }] } }
myProducts: { "<store>/<ingredientId>": { name, brand, size, packSize, unit, price, url?, at, by,
                                          source: "receipt"|"pick"|"typed" } }
priceHistory: { "<store>/<ingredientId>": [ { price, packSize, date } ] }   // newest last, ≤ 12
```
- `packSize` is in the catalog unit for that ingredient (convert the receipt size; if it can't be
  converted, ask in the review screen with a sensible default).
- Price used for estimates, in order: family price correction (`prices`) → `myProducts` price →
  prices.json → catalog. The estimate for an item = the most recent paid price for that store's
  product (show "paid $X on Nov 12" vs "est.").
- Receipt review screen: every line with its suggested match (editable, or "not a grocery item /
  skip"); on Save: write receiptLog, update myProducts + priceHistory for matched lines, add the
  receipt total to the Budget's receipts (existing `receipts` array) — never double-count the same
  receipt (dedupe by store+date+total).
- Exported pure function `importReceipt(state, receipt, { by, source })` → ops (the coordinator calls
  it from the browser console for the purchase-history import, then the app syncs as usual).

### 9.5 My products UI
> 2026-11-15 (Jeff): "Remove the name brand vs generic and just use the actual products we buy." There are no brand tiers in the UI. Each item has ONE product per store: myProducts → catalog `usual` → first products.json option → catalog pack. `state.brands` / `settings.brand` are legacy and ignored. Recipes are built around the family's real brands (Rao's, Maya Kaimal, Cholula, La Preferida, Member's Mark patties, Ball Park, Kerrygold…).

- On each list item: the chosen product name ("Member's Mark Boneless Skinless Chicken, 6.5 lb")
  with a "Change" action → picker: products learned from receipts, the options in
  `data/products.json`, or "Type my own" (name, size, price, link). Choosing one sets
  `myProducts[store/id]` and the brand toggle becomes informational.
- "Find it" → opens the store search for that exact product (URL templates in data/stores.json
  `search`), or the saved product URL when there is one.
- Copy & open text uses exact product names.

### 9.6 `data/products.json` (new, researched)
`{ "updated", "products": { "<ingredientId>": { "sams": [ {name, brand, size, packSize, price, url, tier:"store"|"name"} ], "jewel": [ … ] } } }`
2–4 real options per store for the ~50 highest-spend ingredients (meats, cheese, pasta, rice, frozen
veg, fries, buns, tortillas, sauces, lunch staples); `packSize` in the catalog unit.

## 10. v2.3 — Pantry photos (Jeff's asks, 2026-11-15 late morning)

> "Analyze these pictures and ensure that we have the right product to match with the Sam's Club
> and Jewel-Osco app. I have a few things from other stores, so you could exclude those items. I also
> would like for you to look at my seasonings and whatnot to put with recipes."

### 10.1 Pantry scans
- A scanned count ("1 jar", "2 boxes", "1 loaf") is converted into the item's catalog unit
  (`app/scanqty.js`): one container = catalog `container.size` when set, else the single-store
  (Jewel) pack size, else the Sam's pack; scanned weights convert by the pack label's net weight.
  The review sheet says "Saw 1 jar, about 24 oz." (Before v2.3 a jar of Rao's was saved as 1 oz.)
- The scanner is told each catalog item's form (`[frozen]`, `[refrigerated]`, `[shelf-stable]`,
  `[fresh]`) and the Worker refuses cross-form matches (canned peas ≠ frozen peas, canned mushrooms
  ≠ fresh). Worker 2.3.0 also returns `brand` and `label` read off the package; the pantry keeps
  `label` on the entry and shows it, and new shelf items are named by it and get a guessed aisle.
- Other-store products (Trader Joe's, Walmart Great Value, Best Choice…) can sit in the pantry and
  count for cooking, but are never written to "My products" — that list only holds what the family
  buys at Sam's Club or Jewel-Osco.

### 10.2 Their seasonings in the recipes
Catalog additions from the photos: Slap Ya Mama Cajun seasoning, Old Bay, Badia mango pepper,
turmeric, cinnamon, Crystal hot sauce, Buffalo Wild Wings mango habanero sauce, Buona hot
giardiniera, apple jelly, French's crispy fried onions, deli roast beef. Soy is Kikkoman and ranch is
Hidden Valley (the bottles in the fridge door). Five new core dinners tagged "from your pantry"
(blackened Cajun chicken, mango habanero chicken thighs, Chicago-style Italian beef, buffalo chicken
ranch wraps, apple-jelly glazed pork chops) and five sides (Cajun skillet potatoes, golden turmeric
rice, Old Bay fries, Cajun fries, green beans with crispy onions); tikka masala now comes with
turmeric rice, the sausage skillet gets Slap Ya Mama, the sausage hoagies get giardiniera, and the
sweet potatoes get cinnamon.

## 11. v2.4 — The week from the freezer (Jeff, 2026-11-15 afternoon)

> "Here are the rest of our groceries. Can you add these in and then help me get a menu together for
> this week? … I will be getting paid on Friday, which is when I plan on using this app full time …
> Also, can you color code each person's profile? Jeff and Candi are the current green, Jackson is
> red, Jordan is blue and Knox is yellow."

- Freezer photos → pantry: Member's Mark 93/7 ground beef (3 × 1 lb), ⅓ lb sirloin patties, two large
  chicken breasts, eye of round steaks, a 42 oz pork chorizo pack, a bag of BBQ pork, jarred
  nopalitos, 4 ears of sweet corn; shelf items for Trader Joe's frozen rice, Philly Gourmet smashed
  patties, El Monterey burritos and other freezer snacks. The 2024 tilapia is ignored (seafood-free).
- New core dinners tagged "from your pantry": Cajun butter steak bites (eye of round), chorizo &
  nopalitos street tacos, smoky beef & bean chili; new side: La Preferida charro beans.
- Week of Nov 15–20 (Sunday through payday Friday) planned from what's on hand, using shelf-item
  sides where the pantry has them (canned sweet peas, Idahoan au gratin, Trader Joe's Spanish rice,
  Cracker Barrel mac, canned mixed vegetables). The regular plan resumes Saturday Nov 21.
- Side titles read naturally mid-sentence ("buttered sweet corn and mixed vegetables"); brand names
  keep their capitals.
- Profile colors: Jeff and Candi green, Jackson red, Jordan blue, Knox yellow, carried on avatars and
  on selected person chips.

## 12. v2.5 — Trip lists, healthier and cheaper (Jeff, 2026-11-15 evening)

> "For my lunches each week, I would variate between spicy chicken sandwiches from the jewel deli and
> the salads … I want to know how many full meals I currently have groceries for … make smart
> schedules for my meal prep … sync our pantry with recent jewel receipts … clear the current list
> and let's see if you can get me right for today's Jewel trip … Anytime we are buying fruits or
> veggies, I want to buy only organic if possible … let me know an estimated price after coupons …
> The goal here is saving money and eating healthier."

### 12.1 Trip lists
- "Shopping today? Make a list for just this trip" picks a store (Jewel, Sam's or both) and the last
  day the trip shops for (default: this Friday, payday). The list then covers today through that day,
  everything the store carries is bought there, and it starts fresh: nothing checked, nothing skipped
  (`settings.trip = { start, end, store }`; check-offs and skips are keyed `trip:start:end:store`).
- "Back to the week/month" ends the trip. A trip also ends by itself after its last day.

### 12.2 Skips
- Any item can be skipped for this trip: "we'll make do" (stretch what's at home) or "check at home
  first". Skipped items leave the cart and the total and are listed under "Not buying this trip" with
  a note and "Put back" (`skips[listKey][id] = { reason, note, by, at }`).
- Items bought fresh the day they're eaten (the Jewel hot-deli chicken sandwich, `buyOnDay`) are never
  in a trip's cart; they're listed under "Buy fresh on the day" with their cost.

### 12.3 Price checks, sales and coupons
- Jewel-Osco and Sam's Club don't let apps read prices or coupons, so a price check (Claude reading
  the store's own site) writes `deals["store/id"] = { label, size, price, was, ends, coupon: { price,
  text, expires }, checked }`. While current (sale until `ends`, coupon until `expires`, the whole
  check for 14 days) the list uses that exact product and price, shows Sale / Clip coupon tags and
  "reg $X", totals "after sales and coupons", says how much the sales save, and lists the coupons to
  clip before going. Coupons are never clipped for the family: they clip them in their own account.

### 12.4 Organic produce
- Family setting "Organic fruits and vegetables". When on, produce uses the store's organic version
  (catalog `organic: { jewel, sams }`, Jewel prices read Nov 15) where one exists; a receipt product
  that's already organic stays. Items with no organic version keep the regular one.

### 12.5 What the pantry covers, and the prep schedule
- Pantry, top: planned dinners from today to the end of the period, in date order, each taking its
  ingredients (main and sides, for five) from the shelf. "N of M planned dinners are fully stocked",
  night by night with what each short one needs, what the list buys to finish the rest, dinners the
  leftovers could also make, and ready-made backups on the shelf (burritos, soups, smashed patties).
- Prep schedule (Plan page; "Prep today and tomorrow" on Tonight): thaw meat the evening before
  (only what's in the freezer; a cold-water thaw if it's too late), cook-once for ground beef on two
  nights within three days (thawed together), once-a-week lunch jobs (split the party bag, bag the
  Ritz), packing the next day's lunches each evening, and a morning reminder for anything bought fresh.

### 12.6 Receipts → pantry
- Saving a scanned receipt (a paper photo or a screenshot from the store's app) can add its matched
  groceries to the pantry (on by default; receipts from the last 14 days). The Pantry page lists
  recent saved receipts not yet synced, with "Add to pantry". A receipt syncs once
  (`receiptLog[id].pantry`).

### 12.7 Lunches
- Jeff alternates prepackaged store salads (ranch preferred: Bonduelle Chicken BLT with buttermilk
  ranch, Chef with turkey & ham with creamy ranch, Kickin' BBQ chicken with BBQ ranch) and a Boar's
  Head Blazing Buffalo chicken sandwich he makes himself, with dill pickle chips, Buona hot
  giardiniera and Miss Vickie's chips, and a BODYARMOR Orange Mango every day. No hot-deli
  sandwiches ("very poor quality food"). Never Caesar anything: the validator rejects the word in
  recipes and lunches, and the Caesar-style side is gone.
- Seafood stays off the menu, apart from an occasional (every few months) snow crab boil with Old Bay;
  soups now and then. Knox's snacks can be Ritz from the
  pantry box; party-bag chips are split into snack bags once a week.

## 13. v2.5.4 — Pantry pictures and sections, store hand-off, five extras (Jeff, 2026-11-15)

### 13.1 Pantry pictures
- Each pantry item can have a picture: `state.itemPhotos[itemId] = { photo, at, by }`. The picture
  itself lives in the family's passcode-protected worker storage (`POST /api/photo` raw image
  ≤ 400 KB → `{ id }`; `GET /api/photo?id=`; Durable Object `photos` table, 2,000 pictures /
  200 MB at most), never in the public site. Phones keep pictures they've seen in Cache Storage.
- A pantry scan returns a box for each item (thousandths of the photo); confirming the review saves a
  square crop of each new item (items that already have a picture keep it). A row's square opens a
  sheet to take, replace or remove the picture.

### 13.2 Pantry sections
- Shelves are grouped by place (in the fridge, freezer, pantry, on the counter; jump chips at the
  top) and then by kind: meat & protein, dairy & eggs, fruits & vegetables, frozen meals & sides,
  bread, drinks, canned & jarred, pasta/rice/grains, sauces, spices & baking, snacks & sweets.

### 13.3 Store hand-off
- Jewel-Osco: "Copy & open" copies plain lines for Jewel-Osco AI's "Shop my grocery list"
  ("2 Bonduelle Bistro Bowl, Chicken BLT", "Boar's Head Black Forest Ham, 1 lb"), split into parts
  that fit its 2,000-character box. The full list with pack sizes is still one tap away.
- jewelosco.com's iPhone link file only claims /home*, so web links open Safari. "Open the
  Jewel-Osco app" uses the store's AppsFlyer OneLink; a one-step iPhone Shortcut (Open App →
  Jewel-Osco), saved per phone, always opens the real app.
- Coupons from a price check can be marked `clipped` (already on the family's card) and carry `q`,
  the words that find them on Jewel's coupon page; unclipped ones get a "Clip it" link.

### 13.4 Five extras (Claude's picks for "save money, eat healthier")
1. Use it first: perishables get an estimated use-by from the day they came home (`pantry[id].since`,
   set when stock is added by hand, scan, Done shopping or a receipt). The package date wins.
2. Vegetable check: Plan shows dinners whose sides have no vegetable or salad, with one tap to add
   or swap one in.
3. Budget pace: a trip list shows this month's receipts + this trip against the monthly target.
4. Portion and freeze: 2 lb or more of fresh raw meat (`pantry[id].bought`) gets a prep job the day
   it comes home: keep what the next two days need, freeze the rest in meal-size bags.
5. After the trip: once a receipt from the trip is saved, the trip list shows what it bought that the
   list didn't ask for.
