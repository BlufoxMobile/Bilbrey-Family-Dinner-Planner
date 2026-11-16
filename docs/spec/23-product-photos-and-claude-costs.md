## 23. Store product pictures, cheaper Claude scans, a Worker that knows the kitchen, and the hardening pass

> Jeff (2026-11-15): "really good photos of each food item we buy from the Jewel site or Sam's Club
> site"; every scan costs about 5¢ on Opus; "expose the things we have missed."

Everything here is in `worker/` and in `app/photos.js`, `app/claude.js`, `app/views/list.js`,
`app/views/products.js`, `app/products.js`, the console door in `app/main.js`, and
`styles/parts/server.css`. Nothing needs setting up on Cloudflare: no new binding, secret or
migration (`worker/DEPLOY.md` has the short note).

### 23.1 Store product pictures

**What the family sees.** The shopping list, the item sheet, the pantry, the product chooser and
My products show a picture of the product: the family's own photo of it when they took one
(`state.itemPhotos`, §13.1), else the store's product picture. A list with no pictures looks exactly
as before; once one item has a picture every row keeps a square for one, so the names line up.

**State.** `state.storePhotos[itemId] = { photo, store, product, at }`: `photo` is a picture id in
the family's private storage (the same `photos` table as pantry pictures, never the public repo),
`store` is `sams` or `jewel`, `product` is the product's name. `app/photos.js`:
`itemPhoto(state, id)` = `ownPhoto` (the family's) `||` `storePhoto` (the store's), so every screen
that already calls `itemPhoto` gets the fallback. `app/views/pantry.js` saves a scan's crop when
there is no **own** photo (`ownPhoto`), so a store picture never blocks the family's own.

**`POST /api/photo/fetch`** (family key) `{ url, refresh? }` → `201 { ok, id, bytes, mime, host,
store, reused: false }`, or `200 { …, reused: true }` when the server already has the picture from
that address (nothing is downloaded; `refresh: true` fetches a new copy under a new id).

- The Worker downloads the picture itself. The family key is checked first: without it nothing is
  said about the link and no request leaves the Worker.
- **Only these hosts** (`STORE_IMAGE_HOSTS` in `app/photos.js`, shared by the app and the Worker):

  | Host | Store | Kind | Asked for as |
  |---|---|---|---|
  | `images.albertsons-media.com` | Jewel-Osco (Albertsons) | Adobe Scene7, path `/is/image/ABS/<id>` | `?wid=480&hei=480&fit=constrain&fmt=jpeg&qlt=85&defaultImage=` |
  | `scene7.samsclub.com` | Sam's Club | Adobe Scene7, path `/is/image/samsclub/<id>` | the same |
  | `i5.samsclubimages.com` | Sam's Club (its newer image CDN) | path `/asr/…` | `?odnWidth=480&odnHeight=480&odnBg=FFFFFF` |

  Checked from the build machine on 2026-11-15: both Scene7 hosts answered a 480 × 480 JPEG (13 KB
  and 36 KB) with no browser headers; `defaultImage=` (empty) turns Scene7's "no picture" placeholder
  into an error, so a missing picture is never stored as if it were one. `i5.walmartimages.com`
  (Sam's parent) is **not** on the list: it doesn't serve Sam's Club product pictures. Whether the
  three hosts answer Cloudflare's addresses the same way can only be seen from the deployed Worker.
- Only `https`, no user/password, no port; a Scene7 link must start `/is/image/`. The link's own
  query is dropped and replaced by the size request above, so a link can ask a host for nothing but
  that picture at about 480 px.
- Redirects are followed by hand, at most twice, and only to `https` on one of the three hosts.
- The answer must be `200` with `image/jpeg`, `image/png` or `image/webp`, the bytes must really be
  one of those (magic bytes; the stored type is what the bytes are), and at most 400 KB (checked on
  `Content-Length` and again while reading).
- **If a host refuses, the answer says so and nothing works around it:** `401/403/406/429/451/503`,
  or a web page where the picture should be → `502 { error, host, upstream, refused: true }`. No
  browser `User-Agent`, no retry with other headers. A missing picture → `404 { notFound: true }`;
  too large → `413 { tooLarge: true }`; a redirect off the list → `502 { redirected: true }`; the host
  can't be reached → `504 { unreachable: true }`.
- Limits: 600 downloads per 10 minutes (`RATE_PHOTOFETCH`), 1,200 store pictures of the 2,000 the
  storage holds (so the family's own always have room).

**Where a picture link comes from.** Product records may carry an optional `image` (an `https` link
on one of the three hosts): options in `data/products.json` (`normalizeProducts` keeps it),
`state.myProducts["<store>/<id>"].image` (set when the family picks an option that has one), and a
price check `state.deals["<store>/<id>"].image`. `missingStorePhotos(db, state)` lists items whose
product has a link and no stored picture of that product; `ensureStorePhotos(app)` fetches a few at
a time whenever the list or My products is on screen (and right after a pick), so a picked product,
a receipt match or a price check gets its picture without anyone asking. A failure waits six hours.

**The console door.** `window.bilbrey` (the same object as `window.bfdp`):

```js
await bilbrey.importStorePhotos([{ itemId, url, store, product }], { dryRun, refresh, concurrency })
// → { total, saved, unchanged, failed, skipped, refusedHosts, stopped, failures: [{ itemId, status, error }], results }
```

A bad entry (unknown item, a link that isn't on a store image host, listed twice) is skipped and
reported; a failed download never stops the rest; `429`, `500` and `504` are retried twice; a host
that refuses three times in a row is left alone for the rest of the run (`refusedHosts`); a missing
passcode or full storage stops the run (`stopped`) with what was fetched kept; progress is committed
every 20 pictures; and running it again is safe (a picture the server has comes back at once, an
item that already shows it is `unchanged`). Also on the door: `storage()`, `backups()`,
`exportBackup({ backup? })`, `restoreBackup(idOrFile)`, `cleanupPhotos({ dryRun })`.

**Clean-up.** `POST /api/photo/cleanup { dryRun? }` (family key) removes pictures nothing points to:
a picture is kept when its id appears anywhere in the state, or when it is under a day old (its op
may still be on a phone). The app never deleted a replaced pantry picture, so this is also how those
leave. A full storage runs it once by itself before refusing a new picture. Uploaded pantry pictures
are now checked to be the picture type they claim, and are read with a hard 400 KB cap even when the
upload doesn't declare its size.

### 23.2 Cheaper Claude scans

**The cost before.** A pantry photo sent ~1,600 tokens of picture, ~600 of instructions and the list
of everything the family buys: 182 items, 25,300 characters, about 7,000 tokens (measured from
`data/catalog.json`), all at the full input price every time: about 5–6¢ a photo on Opus.

**Prompt caching** (rules checked at platform.claude.com/docs/en/build-with-claude/prompt-caching,
2026-11-15). For Claude the instructions and the known items moved from the user message into the
system prompt, as text blocks marked `cache_control: { type: "ephemeral" }`:

1. the system line + the instructions (never change);
2. `KNOWN ITEMS`: the recipe box's items (change when the catalog does);
3. the family's own shelf items (`custom-…` ids), when there are any.

The user message is the photo and one sentence. Workers AI still gets everything in one message, word
for word as before. Receipts are built the same way (the per-image line stays in the user message);
ideas cache the rules + answer format and the sides + catalog. Prices, with the base prices in
`worker/src/claude.js` unchanged:

| | Input | 5-minute cache write (1.25 ×) | Cache read | Output |
|---|---|---|---|---|
| Opus 5.5 | $4 | $5 | $0.20 (0.05 ×) | $20 |
| Sonnet 5.5 | $2 | $2.50 | $0.10 (0.05 ×) | $10 |
| Haiku 5.5 | $0.10 | $0.125 | $0.01 (0.1 ×) | $0.50 |

(per million tokens; Haiku's over-100K-token tier is 5 × all of these and goes by the whole prompt,
cached or not). A read renews the five minutes for free; prompts under 512 tokens aren't cached.
`costUsd(model, usage)` prices `input_tokens` (the uncached part), `cache_creation_input_tokens`,
`cache_read_input_tokens` and `output_tokens` each at its own rate, and that is what the monthly cap
counts.

**What a photo costs now** (Opus, 1,700 fresh tokens, 7,600 cached, 800 out): the first photo of a
scan 6.1¢ (it stores the list), every photo in the next five minutes 2.4¢. Three photos: 10.9¢
instead of about 17¢. A single photo with no second one within five minutes costs about 0.8¢ more
than before; that is the trade.

**Several photos of one scan share the cache.** Photos sent one after another (as the pantry screen
does) already do. `POST /api/scan` also takes `{ images: [1–4 data URLs], known }` (5 MB, 4.5 MB of
photos): the first photo goes four seconds ahead and writes the cache, the rest run together and
read it. Response: `{ items: [{ …, img }], photos: [{ items, engine, model, usage } | { error }],
engine, model, usage }` (`img` = which photo, 0-based; one unreadable photo doesn't lose the others).
A receipt's images use the same head start.

**Cache hits in the response.** Scan, receipt and ideas answers that used Claude carry
`usage: { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, usd, cacheHit, calls }`
(`inputTokens` is the whole prompt). `GET /api/ai` adds `cacheWriteTokens`, `cacheReadTokens`,
`calls`, and `scan: { photos, usd, avgUsd }`: what pantry photos really cost this month. Each model
in `models` has `cacheWriteUsd` and `cacheReadUsd`.

**The hint in the app** (`app/claude.js`): `photoCostHint(m)` is the arithmetic above: "About 2–6¢ a
photo" (Opus), "About 1–3¢" (Sonnet), "Under 1¢" (Haiku). `photoCostDetail(m)` says it in a sentence;
once three photos have been read in a month the status line says what they really cost ("Claude Opus
5.5 reads your photos, about 3¢ each this month").

**Image size.** The 5.5 models read images up to 2,576 px on the long side at one token per 28 × 28
px patch. The phone sends pantry photos at 1,280 px: 46 × 35 patches, about 1,600 tokens (0.6¢ on
Opus), and Claude does not shrink them further. Sending more pixels (1,568 px → 2,350 tokens) would
add about 0.3¢ a photo; fewer would cost label legibility on a crowded shelf. So 1,280 px stays, and
receipts stay at 1,600 px because their print is small. Product pictures are stored at 480 px: they
are shown at 52–220 px.

**Other savings.** The known-items list is cut off at 60,000 characters (a runaway list would be paid
for on every photo); 60 Claude requests per 10 minutes (`RATE_AI`), so a stuck phone can't run
through the month's budget.

### 23.3 Claude knows the kitchen

- **Ideas** (`POST /api/ideas`): the system prompt adds the Ninja 10-in-1 Everyday PossibleCooker Pro
  6.5 qt (equipment id `possible cooker`: slow cook, sear/sauté, braise, steam, rice, keep warm) and
  how the family wants to eat: lean, high-protein dinners with a vegetable or a salad, less frying,
  full portions, no calorie targets, no good/bad labels. Each idea now also has `prepMinutes`,
  `cookMinutes`, `tips` (≤ 5) and `stepDetails: [{ text, minutes?, setting? }]`. Claude may write a
  step as a sentence or as `{ text, minutes, setting }`; **`steps` stays a list of sentences**, so
  apps from before today keep working, and `stepDetails` carries the same steps with their times and
  settings. `minutes` is capped at 240 as before unless the request says `detail: true` (then 720: a
  slow cook can take all day). "No oven needed" in a tip is not the oven; the oven in a tip or a
  setting still drops the idea. `slow cooker`, `crockpot`, `Ninja…` map to `possible cooker`.
- **The connector** (`worker/src/mcp.js`): writes are stamped `Family (Claude chat)` (one shared
  profile). The instructions, `get_family_profile` (`profile`, `goals`, `equipmentIds`,
  `possibleCooker`) and the house rules say the same things as the ideas prompt. `plan_dinner`
  recipes accept `possible cooker`, `prepMinutes`, `cookMinutes`, `tips`, timed steps, and up to 720
  minutes; the saved dinner keeps `steps` as sentences plus `stepDetails`, `prepMinutes`,
  `cookMinutes`, `tips`. Two starches for sides, or deep-frying, get a note (never a refusal).
- **New tools:** `get_use_first { days? }` (from `app/freshness.js`: what to eat soon, soonest
  first, with amounts, where it is, the nights it is already planned for and the dinners that would
  use it) and `get_health_summary { from?, to? }` (from `app/nutrition.js` and `app/health.js`:
  calories and protein per plate, averages, the lightest and heaviest nights, dinners with no
  vegetable and the side to swap). **`log_waste` is not built:** there is no `state.waste` in the
  repo yet; it should be added when that shape exists.

### 23.4 Hardening

**Backups.** There was none. Now the Durable Object keeps a whole copy of the state before each
day's first change (14 days) and before every restore or tidy-up (the last 6).
`GET /api/backups` lists them; `GET /api/export[?backup=<id>]` downloads everything needed to start
over as one JSON file (state, archive, the list of pictures, Claude usage; never the passcode hash,
the Claude key or the chat link); `POST /api/restore { backup: <id> | state: {…}, confirm:
"restore" }` puts a copy back (an export file can be sent as it is). The state it replaces is kept
first, so a restore can be undone. All need the family key.

**The state document growing.** It is one JSON document capped at 1 MB, and at the cap every change
was refused (and the phone then dropped it). A receipt is 5–30 KB, so two years of trips plus an
imported purchase history would get there. Now, past 85% (or when a change would cross 1 MB) the
server tidies up, nothing thrown away (a backup first; what leaves goes to an `archive` table that
the export includes):

- receipts older than 180 days keep store, date, totals and a line count (`lines: []`, `lineCount`,
  `archived: true`); the products and prices they taught are untouched;
- dinner-plan nights older than 400 days leave;
- check-offs and skips of lists that ended over 60 days ago leave;
- if that isn't enough, receipts are trimmed at 90 and then 45 days.

`POST /api/compact { dryRun? }` runs it on request; `GET /api/storage` shows the document's size by
section, the pictures, the archive and the backups.

**Fixed.**

| What | Before | Now |
|---|---|---|
| Passcode change and the chat link | The link kept working, so anyone who had the old passcode kept full access through it | Changing the passcode retires the link (`mcpLinkReset: true`) |
| The everyone-lock | 40 wrong passcodes from anywhere locked out everyone for 10 minutes, the family included, for as long as someone kept guessing | An address that showed the right key in the last 30 days isn't caught by it (its own typos still count) |
| The chat link in logs | Every request's URL, link included, went to Workers Logs | The per-request log is off (`wrangler.toml`); the Worker's own log lines stay |
| `/mcp/<junk>` | Body read and storage touched before the 404 | Turned away at the door; replies carry `no-store`, `no-referrer`, `noindex` |
| Photo upload size | Trusted `Content-Length`; a body without one was read whole | Read with a hard cap |
| Error text | A Claude error message was passed on as it came | Keys, 64-hex keys and chat links are blanked in errors, `detail` and logs |
| Request rates | Only wrong keys were limited | Claude requests, picture downloads and chat calls each have a limit per 10 minutes |
| The recipe box for the chat | 600 KB downloaded, parsed and rebuilt every five minutes (about 11 ms cold, measured) | Re-checked with ETags: nothing is downloaded, parsed or rebuilt while it hasn't changed |

**Still open, most serious first.**

1. **CPU on the Free plan.** The Worker's own entry gets 10 ms of CPU a request there (the Durable
   Object gets 30 s). Parsing a 1.5 MB scan body, checking the photo and building the Claude request
   measured about 5 ms in Node on the build machine (not in the Workers runtime); a four-image
   receipt is over three times the bytes, so by the same arithmetic about 15 ms, over the limit. One
   pass over each photo was removed here, but the real fix is the Workers Paid plan (30 s) or smaller
   receipt photos. The automated tests can't see CPU limits: watch for error 1102 on receipts.
2. **The family key is an unsalted SHA-256 of the passcode on the phone.** The server salts and
   hashes it again, and guessing online is limited, but a short passcode is the real strength. A long
   passphrase is the fix that costs nothing.
3. **`/api/health` and wrong chat links are free to call.** Anyone can use up the Free plan's
   100,000 requests a day; nothing in code prevents that. Cloudflare's rate-limiting rules would.
4. **Pictures are not in the export.** It lists them; each is fetched with `GET /api/photo?id=`.
5. **The dev mock** (`dev/mock-api.mjs`) has no `/api/photo/fetch`, `/api/storage` or backup routes
   and still has last week's model prices, so the browser tests don't cover them.
6. **An archived receipt shows no lines** in the receipts screen (it has `lineCount` and `archived`
   to say so; the screen doesn't yet).
