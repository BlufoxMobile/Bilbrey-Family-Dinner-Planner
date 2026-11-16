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
- No raw cucumbers anywhere (pickles only), and no raw onions or raw tomatoes (Candi eats tomatoes; the
  rest don't). Cooked onions and tomato sauces are fine. The validator enforces it for recipes, and the
  three cucumber sides are gone (Jeff, 2026-11-15).
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
- The place comes from the catalog unless the family moves it (`pantry[id].place`, set from the
  item's picture sheet); amount changes, Done shopping and receipts keep it.

### 13.3 Store hand-off
- Jewel-Osco: "Copy & open" copies plain lines for Jewel-Osco AI's "Shop my grocery list"
  ("2 Bonduelle Bistro Bowl, Chicken BLT", "Boar's Head Black Forest Ham, 1 lb"), split into parts
  that fit its 2,000-character box. The full list with pack sizes is still one tap away.
- jewelosco.com's iPhone link file only claims /home*, so web links open Safari. "Open the
  Jewel-Osco app" uses the store's AppsFlyer OneLink; a one-step iPhone Shortcut (Open App →
  Jewel-Osco), saved per phone, always opens the real app.
- Coupons from a price check can be marked `clipped` (already on the family's card) and carry `q`,
  the words that find them on Jewel's coupon page; unclipped ones get a "Clip it" link.
- "Find coupons for this list" (Jewel trips) opens a sheet with one coupon-page search per brand on
  the list (Boar's Head, BodyArmor…), each opening Jewel's coupon page already searched; on iPhone the
  pages can open in the Chrome app (`googlechromes://`, a per-phone choice). The family clips there.

### 13.5 Counting in packages
- Measured pantry items are counted in packages (jars, boxes, bags, loaves; quarters allowed). One
  package is the size of the product the family last bought (`myProducts`, from receipts), else the
  catalog's single-store pack; the amount is still kept in recipe units (`app/packages.js`). Items
  whose unit already counts packages (cans, bottles, bowls, pouches) show their own unit.

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

## 14. Claude in the app

The Worker can use Claude (Anthropic Messages API, `worker/src/claude.js`) for pantry-photo scans,
receipt scans and a new recipe-ideas endpoint. Workers AI (§9.3, §10.1) stays as the fallback.

### 14.1 Switching it on, the model, the cap
- **Key:** the Worker secret `ANTHROPIC_API_KEY` (Jeff adds it in the Cloudflare dashboard as a
  **Secret**; never in the repo, never sent to the app). Without it everything works as before on
  Workers AI, and `/api/ideas` answers 503.
- **Model:** the family setting `state.settings.aiModel` (set with an ordinary op, e.g.
  `{ op: "set", path: ["settings","aiModel"], value: "claude-sonnet-5-5" }`). Allowed:

  | id | label | USD per M input tokens | per M output tokens |
  |---|---|---|---|
  | `claude-opus-5-5` (default) | Claude Opus 5.5 | $4 | $20 |
  | `claude-sonnet-5-5` | Claude Sonnet 5.5 | $2 | $10 |
  | `claude-haiku-5-5` | Claude Haiku 5.5 | $0.10 | $0.50 |

  A missing or unknown value means Opus. (Haiku bills $0.50 / $2.50 when one prompt is over 100K
  tokens; the request limits keep every call far below that.)
- **Monthly cap:** `AI_MONTHLY_CAP_USD` (a `[vars]` entry in `worker/wrangler.toml`, default $5; `0`
  turns Claude off). After every Claude call that the API answered, its tokens and cost are added to
  the Durable Object table `ai_usage(month, input_tokens, output_tokens, usd)`, keyed by the
  **America/Chicago** calendar month (`"2026-11"`). A call that errors or times out isn't billed and
  isn't counted; an unreadable reply is billed and is counted. Before a Claude call, if this month's
  `usd ≥ cap` the request is **capped**: scans and receipts use Workers AI, ideas answer 402. A call
  that starts under the cap always finishes, so a month can end slightly over.

### 14.2 Endpoints (all need `X-Family-Key`, same 401/429 rules as §5)
| Method | Path | Body → Response |
|---|---|---|
| GET | `/api/ai` | → `{ keySet, engine: "claude"\|"workers-ai", model, models: [{ id, label, inUsd, outUsd }], month, spentUsd, capUsd, capped, inputTokens, outputTokens }` |
| POST | `/api/scan` | unchanged request; response gains `engine` (and `model` is the Claude id when Claude read it) |
| POST | `/api/receipt` | unchanged request; response gains `engine` |
| POST | `/api/ideas` | see 14.4 |

`engine` on `/api/ai` says what the next scan will use: `"claude"` when the key is set and the month
isn't capped, else `"workers-ai"`.

### 14.3 Scans and receipts
- Key set and not capped → Claude, with the **same prompts** as Workers AI (fields `name, brand, label,
  qty, unit, matchId` from `known`, `confidence`, `box` [left, top, right, bottom] in thousandths; the
  §9.3 receipt fields), the photo as a base64 image block, and the reply run through the **same**
  parsers and normalizers (`normalizeScanItems`, `cleanBox`, receipt merge, PII scrubbing, `matchId`
  checked against `known`). `engine: "claude"`, `model: "claude-…"`.
- Claude fails (API error, timeout, unreadable reply) → the existing Workers AI path for that
  request — for receipts, for that image only. The response then says `engine: "workers-ai"` (or
  `"mixed"` for a receipt where only some images fell back) and `claudeError: "<model>: <reason>"`
  (no key, no image data). If Workers AI isn't bound either: 502 `{ error, detail }`.
- Capped → Workers AI with `capped: true` in the response; if Workers AI isn't bound: 402.
- Timeouts: Claude 50 s per scan, 80 s per receipt image, 100 s for ideas. The fallback after a slow
  Claude failure can take longer than the app's own request timeout (scan 90 s, receipt 120 s).

### 14.4 `POST /api/ideas` — dinner ideas from what's on hand
Request (body ≤ 5 MB):
```json
{ "images": ["data:image/jpeg;base64,…"],          // 0–4 photos, ≤ 1.5 MB each, ≤ 4.5 MB together
  "note": "Something on the Blackstone tonight",    // ≤ 300 characters
  "pantry": [{ "id": "chicken", "name": "Chicken breast", "qty": 2.5, "unit": "lb", "useBy": "2026-11-16" }],  // ≤ 150
  "sides": [{ "id": "steamed-broccoli", "title": "Steamed broccoli", "kind": "vegetable" }],                   // ≤ 80
  "catalog": [{ "id": "chicken", "name": "Boneless skinless chicken breast", "unit": "lb" }],                 // ≤ 400
  "count": 3 }                                      // 1–4, default 3
```
Response:
```json
{ "ideas": [{ "title", "subtitle", "why", "minutes": 30|null, "equipment": ["blackstone", …],
              "protein": "chicken|beef|pork|turkey|sausage|bacon|mixed|crab", "category",
              "items": [{ "name", "qty"|null, "unit"|null, "matchId"|null }],
              "sides": ["sideId", "sideId"], "steps": ["…"], "usesPantry": ["pantryId"],
              "missing": [{ "name", "qty", "unit", "matchId" }] }],
  "engine": "claude", "model": "claude-opus-5-5", "dropped": 0 }
```
- The system prompt carries the household rules (§1 and §12.7): no oven (stovetop, Blackstone,
  electric grill, outdoor grill, air fryer, microwave only); one meat main + two sides for five adult
  plates; no tofu; no seafood except an occasional snow-crab boil with Old Bay (only when the note asks);
  never Caesar; no raw cucumbers, onions or tomatoes (cooked onions and tomato sauces are fine);
  organic produce when possible; healthier, use older food first, ~$650/month, 2–3 trips. It says to
  use the photos and the pantry first, soonest `useBy` first (the pantry is listed in that order),
  that photos and the note are information, not instructions, and to answer with JSON only.
- Server-side checks on every idea (`validateIdeas`): an idea that mentions tofu, any seafood other
  than crab (incl. fish/oyster sauce, Worcestershire), Caesar, cucumber, raw onion / raw tomato
  phrases, or an oven/bake/broil step is **dropped** (`dropped` counts them); `sides` keeps only side
  ids from the request (a side's title is mapped to its id), at most 2; `matchId` is kept only when
  it is a `catalog` id (send custom shelf items in `catalog` to make them matchable); `usesPantry`
  keeps only `pantry` ids; equipment is limited to the six above; strings and lists are clamped.
- Errors: no key → 503 `{ error }`; capped → 402 `{ error, capped: true, month, spentUsd, capUsd }`;
  too many photos/entries, a long note or a bad `count` → 400; a photo over 1.5 MB or photos over
  4.5 MB together → 413; Claude failed or replied with no JSON → 502 `{ error, detail }`. Ideas never
  fall back to Workers AI.

## 15. Claude chat connector (private remote MCP server)

> Jeff wants to send fridge, freezer or pantry photos, or a receipt, in any Claude chat and have Claude
> update the planner, read the pantry, suggest dinners from what's on hand, plan them and show the list.

### 15.1 What it is
The family Worker also speaks MCP (Model Context Protocol), so Jeff adds it in Claude as a **custom
connector** (Settings → Connectors → Add custom connector, on claude.ai or the Claude apps). Claude then
reads and writes the same family state the phones use; a change shows up in the app on the next sync.
Writes carry `by: "Jeff (Claude chat)"` (and the doc's `updated_by`), so the family can see where a
change came from.

### 15.2 Endpoints (Worker)
| Method | Path | |
|---|---|---|
| GET | `/api/mcp/link` | Family key → `{ ok, url }` = `https://<worker>/mcp/<token>`. The token (32 random hex) is made on first call and kept in the Durable Object (`mcp_link` table). |
| POST | `/api/mcp/rotate` | Family key → `{ ok, rotated: true, url }` with a new token; the old link stops working at once. |
| POST | `/mcp/<token>` | MCP Streamable HTTP: JSON-RPC 2.0, `Content-Type: application/json` replies, no SSE, no sessions. Batches accepted (≤ 20). Notifications/responses only → 202, no body. |
| GET (or other) | `/mcp/<token>` | 405, `Allow: POST`. |

Protocol versions `2025-06-18` and `2025-03-26` (initialize echoes the client's when it's one of these,
else answers `2025-06-18`; an unsupported `MCP-Protocol-Version` header → 400). Methods: `initialize`
(serverInfo `bilbrey-dinner-planner`, capabilities `{ tools }`, short `instructions` with the house
rules), `notifications/*`, `ping`, `tools/list`, `tools/call`; anything else → -32601; an unknown tool →
-32602. Tool failures come back as results with `isError: true` and a plain sentence Claude can act on.

### 15.3 Tools
All results are one text block of compact JSON. Every write is one atomic batch through the Durable
Object's normal op path (the same validation, 1 MB limit and revision bump as `POST /api/ops`).

| Tool | Input | Does |
|---|---|---|
| `get_family_profile` | — | People (and who packs lunch), stores, equipment (no oven), the house rules, this month's budget (receipts so far, still to buy, projected vs the target), settings. |
| `get_pantry` | `place?`, `includeEmpty?` | Every pantry item: id, name, place, kind, qty + unit, packages (`app/packages.js`), since / estimated use-by / days left (`app/freshness.js`), low, label; plus `useFirst` and `runningLow`. |
| `update_pantry` | `items: [{ id? \| name?, packages? \| qty?+unit?, mode: set\|add, place?, low?, label?, remove?, newItem? }]` (≤ 60) | Names match catalog ids/aliases (exact, or one clear best guess); an unclear name comes back unsaved with candidate ids; anything else becomes a shelf item (`customItemOps`). Packages convert with the package size (the family's product, else the catalog's pack); other units convert where they can. `setPantryOps` semantics (since, low cleared on restock). The description tells Claude to ask when a count from a photo is unclear. |
| `add_receipt` | `store: jewel\|sams, date, total, tax?, savings?, lines: [{ product, brand?, size?, qty?, unitPrice?, lineTotal?, discount?, matchId? }], addToPantry?, dryRun?` | Food and drink lines only. `importReceipts` (source `scan`, so dedupe by store + date + total and never counted twice in the Budget; the Budget line says "Added from a Claude chat"), then `receiptPantryOps` for receipts from the last 14 days. Unmatched lines are counted in the total only. `dryRun` previews the matches. |
| `list_recipes` | `query?`, `makeableNow?`, `id?`, `include?`, `includeDropped?` | Dinners (status rotation / bench / custom; sides as served; kcal and protein per plate) and sides. `makeableNow` checks each dinner + sides against the pantry (`onHand`, 95% rule), use-soon food first, plus near misses (≤ 2 items short). `id` → the full recipe. |
| `get_plan` | `from?`, `to?` (≤ 62 days; default today + 6) | Each night: dinner + effective sides, status (planned, cooked, away with reason, open), kcal per plate, who planned it, and packed lunches by person. |
| `plan_dinner` | `date` + `dinnerId`, or `recipe: { title, subtitle?, category, protein, minutes, equipment, items: [{ id?, name, qty, unit?, newItem? }], sides, steps, tags? }`; `sides?`, `saveToRecipeBox?` | Uses `placeDinnerOps` (moves/trades like the app; cooked nights refused; dropped dinners refused). A recipe is saved as `customDinners[custom-dinner-<slug>]` (normalizeDinner shape, `source: "claude"`), `rotation: "bench"` (a one-off: `inRotation` keeps it out of the generator) unless `saveToRecipeBox`; the same title updates it. Recipes breaking the house rules are refused (below). |
| `get_shopping_list` | `from?`, `to?`, `store?` | `buildList`: by store, each item's product, packs to buy, cost, need/have, why (dinners, lunches, extra, low), coupons; totals, sales savings, skipped, buy-on-the-day. No dates = what the app shows now (the active trip, else the current period). |

**House rules for new recipes** (the validator's bans, `scripts/validate-data.mjs`): no oven/broiler
words and equipment only from the six the family has; no fish/seafood words, tofu, Worcestershire or
Caesar (a **snow crab** boil is the one seafood exception); no cucumber/tzatziki; no raw onion or raw
tomato (a sentence that cooks them is fine); meat in every dinner; steps must state the safe temperature
for the meats they use (165°F chicken/turkey and reheated meats, 160°F ground meat/sausage, 145°F
pork + rest 3 minutes, 145°F whole-cut beef); two existing, not-dropped side ids (burgers one or two).
Rice in the dinner or its sides adds the `rice` tag; `Burgers` adds `burger`; a week with more rice
nights than `riceMaxPerWeek` gets a note.

### 15.4 Security model
- **The link is the credential.** The token is 128 random bits in the path, compared in constant time;
  a wrong or missing token is a plain 404 (same as an unknown path). Claude calls it server to server,
  so `/mcp/*` skips the browser Origin rules and sends no CORS headers. There are no cookies or other
  ambient credentials for a web page to borrow.
- **Only the family can see the link:** `/api/mcp/link` and `/api/mcp/rotate` need the family key (the
  usual 401/429 backoff applies). Jeff keeps the link private, like a password.
- **Rotate any time** (`POST /api/mcp/rotate`): the old link dies immediately; re-add the connector with
  the new one.
- The connector can change only the family state document through validated ops. It can't change the
  passcode, read or delete pantry photos, or call Workers AI.

### 15.5 How it's built
- `worker/src/mcp.js` holds the protocol and the tools; `worker/src/index.js` only adds the routes and
  the Durable Object's token methods. The tool code imports the app's pure modules (`../../app/data.js`,
  `shopping.js`, `planner.js`, `receipts.js`, `actions.js`, `coverage.js`, `freshness.js`,
  `packages.js`, `scanqty.js`, `lunch.js`, `nutrition.js`, `state.js`, `util.js`, `config.js`), so a
  receipt, a pantry count or a list from Claude is computed exactly as on the phones. Wrangler bundles
  them (`npm run check` shows the bundle); the tests load them as modules.
- The recipe box comes from the public Pages copy of `data/*.json` (catalog, recipes, prices, stores,
  lunches, nutrition, products; `DATA_BASE` var to override), cached in memory for 5 minutes; a failed
  refresh keeps the last copy.
- Each MCP request runs inside the Kitchen Durable Object: the data load is the only await, then the
  state is read, the ops built and committed synchronously, so a tool call is atomic.

## 16. Plan ahead, pantry first

> Open the app, pick how far ahead to plan (any day up to a month out), fill dinners and packed
> lunches from what's already in the pantry first, oldest and soonest-to-spoil food first (Jeff just
> threw out freezer-burnt steak and corn), see how far the pantry stretches, then shop only for what's
> missing over the rest of that time.

### 16.1 The sheet (Plan page, "Plan ahead")
- Plan through: 1 week, 2 weeks, 3 weeks or a month (to the day before the same date next month), or
  any day from tonight to 31 days out. It shows how many of those nights are still open.
- "Use what we have first" (on by default). Off, it plans the open nights exactly like "Plan open
  nights" does.
- Only open nights are filled. Cooked, away and already-planned nights (by hand or by the planner) are
  never touched.

### 16.2 How it plans (`app/planahead.js`, pure)
`planAheadOps(db, state, { start, end, who, today, at, pantryFirst = true })` → `{ ops, undo, message,
count, fromPantry: [date], lunchPicks: [{ date, name, slot, id, instead }], unfilled, start, end }`.
1. What's on the shelf is `coverage.js onHand` (salt, pepper and oil assumed; "running low" doesn't
   count; within 5% counts as enough). Food that already-planned nights are fully stocked for is set
   aside for them first.
2. Pantry nights: each open night, in date order, gets a dinner the shelf fully covers (main and
   sides for five), chosen with every planner rule (rotation, votes and dropped dinners, burger and
   pizza nights, the rice limit, the Asian cap, no repeats within two weeks, the plan-from store)
   through `generatePlan`'s hooks. Its food comes off the shelf before the next night, so one pack
   never covers two nights. A night with no covered dinner that keeps every rule is left for step 4.
3. Scoring adds 2.5 × the sum of each ingredient's urgency (meat counts 1.5×):
   - fridge and counter food by its estimated use-by (§13.4): past it by that night 6+ (use it now),
     due that night 4, within two days 3–2, within a week 1, later ¼;
   - freezer food by age: 60+ days is "use soon" (2, plus a point a month), younger is age ÷ 60, so
     the oldest always goes first; past its freezer use-by (4 months for meat, 6 otherwise) adds 4;
   - no came-home date, or shelf goods that keep for months: 0.
4. The rest: the usual planner (rules relax as they always do), counting every kept and pantry night's
   food first and favoring dinners with the fewest and cheapest things to buy (twice the usual cost
   weight, and 0.12 off for each item to buy).
5. Lunches: on each lunch day, a slot whose rotation item the shelf can't cover takes another item
   from that person's own list for the slot that it can (the one most in need of eating first, else
   the list's order), written as that day's pick. Picks and skips set by hand stay.

### 16.3 How far the pantry stretches
`pantryStretch(db, state, { start, end })` → `{ coveredThrough, firstGap, gapReason: 'short'|'open'|null,
dinnersCovered, dinners, lunchesCovered, lunches, nights: [{ date, covered, missing, dinnerMissing,
lunchMissing, dinner, title, lunches, open, away, cooked }], usesUp: [{ id, name, since, place, date }] }`.
Day by day, packed lunches then dinner take their food off the shelf. A day is covered when every
planned dinner and packed lunch is fully stocked; away and cooked nights need nothing; a night with
nothing planned ends the run (the plan stops there). `usesUp`: frozen or perishable food the plan eats,
oldest first.

### 16.4 After planning
- A card on the Plan page: "Your pantry covers N dinners and M packed lunches", "Without a trip to the
  store, it carries you through Thursday, Nov 19", a pip per day, "Uses up the boneless skinless chicken
  thighs from Sep 3…", the nights that still need groceries and what each needs, and **Make the
  shopping list**: `settings.trip = { start: today, end, store: 'both', by, at }` (a §12.1 trip list;
  a different trip's check-offs and skips are cleared, the same trip keeps them), then the List.
- Undo on the message takes the plan and the lunch picks back.
- The Pantry page's "What the pantry covers" adds "At this rate the pantry carries you through …"
  (", as far as the plan goes" when the run ends at an unplanned night or the end of the period).

## 17. Claude in settings and "What can I make?"

The family server can use Claude (an Anthropic API key on the Worker) for pantry scans, receipts and
dinner ideas, with a monthly spending cap; without the key, scans and receipts use the free Workers AI
scanner. The app side:

### 17.1 The Claude card (Family & settings)
- Status line from `GET /api/ai` (`{ keySet, engine, model, models: [{ id, label, inUsd, outUsd }],
  month, spentUsd, capUsd, capped }`): "Claude Opus 5.5 reads your photos" / "Using the free scanner —
  add the Claude key to turn Claude on" / "This month's $5 is used up; back on the 1st". The model named
  is the family's choice in settings (so a switch shows at once, before it syncs). Fetched when the page
  opens, at most once a minute; never stored.
- This month's spend: "$1.20 of $5.00" with a meter. It starts over on the 1st.
- Model picker (parents): Opus 5.5 (default) / Sonnet 5.5 / Haiku 5.5, written to the family setting
  `settings.aiModel` ∈ `claude-opus-5-5 | claude-sonnet-5-5 | claude-haiku-5-5` (`settingsOf` defaults
  and validates it; the Worker reads it). Each option shows "About N¢ a photo" from the server's prices
  (USD per million tokens) at an assumed 6,000 tokens in and 800 out per photo (`app/claude.js`
  `PHOTO_TOKENS`); with no prices it shows "Costs the most / less / the least".
- Connect your Claude chats (parents): "Get my connector link" fetches `GET /api/mcp/link` → `{ url }`
  and shows it with Copy and the steps: in Claude, Settings → Connectors → Add custom connector, name it
  "Bilbrey Dinner Planner", paste the link, Add; then turn it on from a chat's tools menu and say "Here's
  our fridge — update the pantry" or "What can we make with these?". "Make a new link" (after a
  confirmation) calls `POST /api/mcp/rotate` → `{ url }`; the old link stops working. The link lives only
  on screen.
- Scan and receipt review sheets say who read them: "Read by Claude Opus 5.5" when the response's
  `engine` is `claude` (or, from an older Worker, its `model` starts with `claude`), else "Read by the
  free scanner". Nothing when the response says neither.

### 17.2 What can I make?
- Entry points: a card under the pantry scan card and a button in the Plan page's action row. Needs the
  family server (a gate sheet points to Family & settings otherwise); warns up front when `/api/ai` says
  there's no key or the month is spent.
- The sheet: up to 4 photos (take or choose; resized like pantry scans, shrunk together under the
  receipts' 4.4 MB total), an optional note (≤ 300 characters), Get ideas. `POST /api/ideas` with
  `buildIdeasRequest()` (`app/ideas.js`): `images`, `note`, `pantry` (in-stock items: `{ id, name, qty
  (null for stocked staples), unit, useBy? }`, the use-by from `keepsDays` + the day it came home,
  use-it-first items first; a package label rides in the name), `sides` (not thumbs-downed: `{ id, title,
  kind }`), `catalog` (every ingredient and shelf item: `{ id, name, unit }`), `count: 3`.
- Response `{ ideas: [{ title, subtitle, why, minutes, equipment, protein, category, items: [{ name, qty,
  unit, matchId }], sides: [sideId, sideId], steps, usesPantry: [ids], missing: [{ name, qty, unit,
  matchId }] }], engine, model }`. `normalizeIdea()` keeps only known match ids, real sides that aren't
  dropped, known equipment, a category and protein from the recipe box's lists, and drops any idea with
  an oven/broiler/baking step, seafood, tofu or Caesar (house rules, even if the server slips).
- Idea cards: title, why, minutes and equipment, sides, "Uses from your pantry: …", "You'd need: …"
  with "about $X" (whole packs at the store the family buys each at, priced like the list; items with
  no price are named), steps, and Make it tonight / Put it on a night… (tonight and the next 30 nights) /
  Save to the recipe box. A night that has a dinner asks first: replace it, or move it to the next open
  night within two weeks; a cooked night is left alone; an away night asks "we're home?".
- Saving (`saveIdeaOps()`): the idea becomes `customDinners[id]` (`id` = slug of the title, `-2`, `-3`…
  when taken; the same title again reuses the saved dinner, never a duplicate) with `items` in catalog
  units by `matchId` (weights and spoons converted), unmatched ingredients as shelf items via
  `customItemOps` (aisle and place guessed from the name) so the list buys them, two sides (Claude's,
  then a vegetable if missing, then the side most served with that category), `source: 'claude'`,
  `why`, and the tag "from your pantry" when it uses the pantry. `rotation: 'bench'` for a one-off on a
  night; `'core'` when saved to the recipe box (saving a one-off later moves it to core). Family-made
  dinners on the bench are not in the rotation (`inRotation` no longer counts every custom dinner).
  Plan entries are `{ dinner, sides, status: 'planned', manual: true, by, at }`. Undo restores it all.
- Errors in plain words (`claudeErrorText`): 503 no Claude key yet, 402 the month's budget is spent
  (the card refreshes), offline, passcode, too large, busy, and Claude not answering.
- `dev/mock-api.mjs` mocks `/api/ai`, `/api/ideas` (ideas built from the request's pantry and side ids,
  plus one seafood idea the app must drop), `/api/mcp/link` and `/api/mcp/rotate`, and scans and
  receipts report `engine`/`model`.

## 18–24. Version 3 (2026-11-15)

Version 3 is specified in separate files under `docs/spec/`, one per workstream; `docs/MISSION.md` has the
brief they were built to. Where they differ from the sections above, they win.

- `docs/spec/18-recipe-box.md` — house-rule audit, lighter dinners, PossibleCooker recipes, detailed steps, nutrition (`plateHealth`, `LEAN_RULE`)
- `docs/spec/19-design.md` — design system tokens and components, motion, TV layout and remote navigation
- `docs/spec/20-shared-profile.md` — one shared family profile, family signal (loved / fine / not for us), lunch packers, Chicago dates
- `docs/spec/21-smarter-planning.md` — re-planning from the pantry, lean and busy nights, waste log, trips and yearly pace
- `docs/spec/22-recipes-and-cook-mode.md` — recipe page, cook mode, leftovers, nutrition on screens
- `docs/spec/23-product-photos-and-claude-costs.md` — store product photos, prompt caching, backups and server hardening
- `docs/spec/24-chicken-bulk-and-meal-cost.md` — chicken over turkey, Sam's bulk cuts, estimated cost per meal (`app/cost.js`)
