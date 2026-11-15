# The Bilbrey Family Dinner Planner

Dinner for five, planned a week (or a month) at a time — bulk at Sam's Club, small stuff at
Jewel-Osco, and a grocery bill that lands near **$650 a month** instead of $1,000+.

**Open it:** https://blufoxmobile.github.io/Bilbrey-Family-Dinner-Planner/

## For the family

1. Open the link on your phone and pick who you are (Jeff, Candi, Knox, Jordan or Jackson).
2. Enter the family passcode (ask Jeff).
3. Add it to your home screen: **Share → Add to Home Screen** in Safari. It works like an app,
   even offline.

What you can do:

- **Tonight** — what's for dinner, with step-by-step cooking mode.
- **Plan** — 1, 2 or 3 weeks or a whole month. Swap any dinner to tonight, or mark a night
  **Not eating at home** (date night, out of town, big lunch) and its groceries drop off the list.
- **List** — everything to buy, split by Sam's Club and Jewel-Osco, minus what's already in the
  pantry. Each item names the exact product we buy (Rao's, Kerrygold, Artesano…) with a
  **Find it** link to that store's search. Copy it straight into each store's app.
- **Lunches** — pick your name and plan Mon–Fri lunches; they go on the same list.
- **Pantry** — snap photos of the shelves; the app reads the labels so you don't buy what you have.
  Swap any side for something already on the shelf, and the app remembers it.
- **Recipes** — vote 👍 or 👎 on dinners and on sides. One 👎 from anyone and it leaves the
  rotation; 👍 keeps it coming back.
- **Scan a receipt** — photograph a Sam's or Jewel receipt and the app learns what we paid and
  which product we bought, so the next list's prices are real.

Prices are what we actually paid where a receipt shows it, and researched estimates otherwise —
fix any price in the app and everyone's totals update. Receipts and purchase details stay in the
family's private, passcode-protected data, never in this repository.
Neither store lets outside apps fill your cart or clip coupons, so checkout (and the Jewel
coupon "Clip" buttons) still happen in the store's own app.

## How it's built

- Static site on GitHub Pages: `index.html`, `app/` (vanilla JS modules), `styles/`, `fonts/`.
  No build step, no outside CDNs.
- Data: `data/recipes.json` (dinners + sides, built around the brands we buy),
  `data/catalog.json` (ingredients, pack sizes, our usual product), `data/products.json` (real
  product choices per store), `data/prices.json` (Sam's/Jewel prices), `data/lunches.json`,
  `data/nutrition.json`, `data/stores.json`.
- Photos: `img/` — generated with Higgsfield.
- Family sync + pantry photo recognition: a Cloudflare Worker in `worker/` (Durable Object for the
  shared family state, Workers AI for reading pantry photos and receipts). If it's unreachable, the app keeps
  working on each phone and syncs later.
- `SPEC.md` holds the full requirements; `reference/` holds the data from the original ChatGPT
  prototype this replaced.
