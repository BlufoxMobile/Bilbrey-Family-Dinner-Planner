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
  pantry. Copy it straight into each store's app.
- **Pantry** — snap photos of the shelves; the app reads the labels so you don't buy what you have.
  Swap any side for something already on the shelf, and the app remembers it.
- **Recipes** — vote 👍 or 👎. Three thumbs-down and a dinner leaves the rotation; a new one takes
  its place.

Prices are researched estimates — fix any price in the app and everyone's totals update.
Neither store lets outside apps fill your cart, so checkout still happens in the store's own app.

## How it's built

- Static site on GitHub Pages: `index.html`, `app/` (vanilla JS modules), `styles/`, `fonts/`.
  No build step, no outside CDNs.
- Data: `data/recipes.json` (dinners + sides), `data/catalog.json` (ingredients, pack sizes),
  `data/prices.json` (researched Sam's/Jewel prices), `data/stores.json`.
- Photos: `img/` — generated with Higgsfield.
- Family sync + pantry photo recognition: a Cloudflare Worker in `worker/` (Durable Object for the
  shared family state, Workers AI for reading pantry photos). If it's unreachable, the app keeps
  working on each phone and syncs later.
- `SPEC.md` holds the full requirements; `reference/` holds the data from the original ChatGPT
  prototype this replaced.
