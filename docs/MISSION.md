# The mission (Jeff, 2026-11-15) — read this before touching anything

Jeff's words: make this "the best possible app", "AAA quality with state of the art images and designs",
"beautiful transitions", "as smart as possible to really help me accomplish my mission of **saving money
on groceries, reducing spoilage, and helping me lose weight**", "healthy options and a detailed recipe",
"a well constructed app". "Expose the things we have missed." The family installed it on their TV too.

## The family and the house rules (never break these)
- Five people (Jeff, Candi, Knox, Jordan, Jackson), Glen Ellyn IL. Stores: Sam's Club (Addison) and
  Jewel-Osco (599 E Roosevelt Rd). Grocery target about $650 a month; they want 2–3 store trips a month,
  not a trip every few days ("so we aren't spending $12,000 next year").
- **No oven.** Equipment: Blackstone griddle, air fryer, stovetop, electric grill, microwave, and now a
  **Ninja 10-in-1 Everyday PossibleCooker Pro 6.5 qt (MC1101)** — slow cook, sear/sauté, braise, steam,
  rice, keep warm and more. Use the equipment id `possible cooker`.
- Dinners are a main + 2 sides for 5. **No tofu. No seafood** except **fried shrimp night** (Jeff, 2026-11-22:
  two 18 oz bags of SeaPak butterfly shrimp with fries) and an occasional snow-crab boil with Old Bay; occasional soups. **Never anything Caesar.** **No raw cucumbers** (pickles are fine), **no
  raw onions, no raw tomatoes** (cooked onions and tomato sauces are fine).
- Organic fruit and vegetables when possible. Knox only eats Cool Ranch Doritos. Jeff's lunches: a Boar's
  Head deli sandwich (pickles, hot giardiniera) and/or a store-made salad bowl, with an Orange Mango
  BodyArmor; no hot-deli food.
- **Weight loss (Jeff's answers tonight):** no calorie number — "just lean": favor lighter, high-protein
  meals and show calories and protein on everything. **The whole family eats healthier**: leaner cuts,
  more vegetables, less frying. Lighter does not mean tiny portions (three growing kids eat these
  dinners), and never label foods good/bad or set calorie targets for anyone.
- **One shared profile** from now on ("we can all share the same profile"); packed lunches are still
  planned for Jeff and Knox, with a way to add another person later.
- Purchases, receipts, pantry photos and store product photos live only in the family's private,
  passcode-protected server storage, never in this public repo.

## How the app is built
- Static PWA, vanilla ES modules, no build step. Pure logic in `app/*.js`; screens in `app/views/*.js`
  using the `html` tag from `app/ui.js`, `actions` maps, and `app.commit({ ops, undo, message })`.
  Styles in `styles/`. Data in `data/*.json` (validated by `scripts/validate-data.mjs`). The family
  server is a Cloudflare Worker + SQLite Durable Object in `worker/`. `SPEC.md` describes everything;
  read the sections for your area.
- Tests: `node --test tests/*.test.mjs` · `node scripts/validate-data.mjs` · e2e
  `cd tests && timeout 360 node ./e2e/run-e2e.mjs` (Playwright against `dev/mock-api.mjs`; screenshots
  in `dev/screenshots/` — LOOK at yours at 390 px and 1280 px) · worker `cd worker && npm test`.
  In a git worktree, symlink `tests/node_modules`, `dev/node_modules` and `worker/node_modules` to the
  main checkout's copies to run them, and remove the symlinks before committing.

## Rules for parallel work (several engineers are working at the same time)
- Stay inside the files your brief gives you. If something outside them needs changing, make the smallest
  possible edit, or leave it and say so in your report.
- Keep existing `data-action` names, ids and class names that tests or other screens use.
- New CSS goes in your own file `styles/parts/<your-name>.css`, linked from `index.html` right before
  `</head>` and added to the `sw.js` precache list. Use the existing CSS custom properties (colors,
  spacing, radii, type sizes) so the new design system restyles your screens automatically. Do not edit
  `styles/app.css` unless your brief says you own it.
- Do not edit `SPEC.md`: write your section as `docs/spec/<number>-<name>.md`.
- Do not bump `app/config.js` VERSION, `sw.js` CACHE_VERSION or the worker VERSION. Do add every new app
  file to the `sw.js` precache list (a test checks it).
- Do not push. Commit on your worktree branch; end the commit message with:
  `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01NWwwps5rNXrzpfQ31pnmej`
- Part of your job is to **find what was missed** in your area: check it against the mission above,
  fix what you find inside your files, and list in your report anything you found but couldn't fix.
- Your report: branch and commit, files changed, what you built, what you found and fixed, test counts,
  screenshot paths, and anything the lead must do when merging.
