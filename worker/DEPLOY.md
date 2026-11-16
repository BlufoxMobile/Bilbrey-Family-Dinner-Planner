# Deploying `bilbrey-dinner-planner`

> **Since 2026-11-15: automatic deploys.** The Worker is connected to GitHub through Cloudflare
> Workers Builds (Worker → Settings → Builds): repo `BlufoxMobile/Bilbrey-Family-Dinner-Planner`,
> branch `main`, root directory `/worker`, deploy command `npx wrangler deploy`, build watch path
> `*` (every push). Every push to `main` deploys `src/index.js` with the bindings
> in `wrangler.toml` (KITCHEN Durable Object, Workers AI, observability). Migration `v1` is already
> applied, so wrangler skips it. After a push, run `node worker/smoke.mjs <worker URL>` and check
> `version=` in `/api/health`. The manual upload below is the fallback (the dashboard's firewall
> has blocked it for some code changes).
>
> **Since the Claude workstream (SPEC §14) the Worker is two source modules:** `src/index.js` imports
> `src/claude.js`. Workers Builds bundles them automatically. For a manual upload, bundle first with
> `npx wrangler deploy --dry-run --outdir dist` (from `worker/`) and upload `dist/index.js` as the
> single `index.js` part, and add `{ "type": "plain_text", "name": "AI_MONTHLY_CAP_USD", "text": "5" }`
> to `bindings`. The `ANTHROPIC_API_KEY` secret is kept across uploads.

> **Since the Claude chat connector (SPEC §15) the Worker is more than one file.** `src/index.js`
> imports `src/mcp.js`, which imports the app's own pure modules from `../app/*.js`. Workers Builds
> runs `npx wrangler deploy`, which bundles all of it (the build checks out the whole repo, so
> `../app` is there). For the manual-upload fallback below, upload the **bundle**, not
> `src/index.js`: run `npm run check` in `worker/` and upload `.wrangler/dry-run/index.js` as the
> `index.js` part (about 260 KB, 78 KB gzipped). Nothing else changes: no new bindings, no
> migration (the connector's token lives in a new `mcp_link` table the Durable Object creates
> itself). After a deploy, `GET /api/mcp/link` without a key answers 401 (404 means old code).


The Worker is ONE ES-module file, `worker/src/index.js` (v2.3.0, ~80 KB, no npm runtime
dependencies; its only import is the built-in `cloudflare:workers`). Deploy it with the Workers
Script Upload API as a `multipart/form-data` PUT. No wrangler and no build step are needed.

> **Live since 2026-11-14** at `https://bilbrey-dinner-planner.jeff-bilbrey-jb.workers.dev`.
> Migration `v1` has already run, so **every deploy from now on uses the REDEPLOY metadata** below,
> with no `migrations` key.

## 0. REDEPLOY metadata (use this now — v2.2 adds `POST /api/receipt`)

```json
{
  "main_module": "index.js",
  "compatibility_date": "2026-11-01",
  "bindings": [
    { "type": "durable_object_namespace", "name": "KITCHEN", "class_name": "Kitchen" },
    { "type": "ai", "name": "AI" }
  ]
}
```

Upload it exactly as section 1 describes: the same PUT, the same two parts (`metadata` and
`index.js` as `application/javascript+module`). The workers.dev route stays enabled, so there's no
need to POST `/subdomain` again. After the upload, run
`node worker/smoke.mjs https://bilbrey-dinner-planner.jeff-bilbrey-jb.workers.dev`. It should pass
20/20, and `version=2.2.0` confirms the new code is live. The check
"POST /api/receipt without a key → 401" fails with a 404 if the old code is still serving.

The family's data isn't touched: the Durable Object and its SQLite storage persist across code
uploads, and v2.2 adds no tables.

## 1. Upload the script

`PUT {API}/accounts/{account_id}/workers/scripts/bilbrey-dinner-planner`

- `{API}` is `https://api.cloudflare.com/client/v4` with an API token, or the dashboard's
  same-origin proxy base when the call runs from a logged-in `dash.cloudflare.com` tab.
- Body: `multipart/form-data` with exactly two parts:

| Part name  | Filename   | Content-Type                     | Content                    |
|------------|------------|----------------------------------|----------------------------|
| `metadata` | none       | none (a plain string field)      | the JSON below             |
| `index.js` | `index.js` | `application/javascript+module`  | contents of `worker/src/index.js` |

Don't set the request's `Content-Type` header yourself. `fetch`/`FormData` (or `curl -F`) adds the
multipart boundary.

### `metadata` for the FIRST deploy (already done on 2026-11-14 — kept here for reference)

```json
{
  "main_module": "index.js",
  "compatibility_date": "2026-11-01",
  "bindings": [
    { "type": "durable_object_namespace", "name": "KITCHEN", "class_name": "Kitchen" },
    { "type": "ai", "name": "AI" }
  ],
  "migrations": { "new_tag": "v1", "new_sqlite_classes": ["Kitchen"] }
}
```

- No `compatibility_flags` are needed. The Worker doesn't use `nodejs_compat`.
- `new_sqlite_classes` is required. The Workers Free plan only allows SQLite-backed Durable Objects.
- Optional: add `"observability": { "enabled": true }` to get Workers Logs in the dashboard, which
  shows the `console.error` lines for failed pantry scans.

### `metadata` for LATER deploys (code updates)

Use the section 0 JSON. It is the first-deploy JSON **without the `migrations` key**, because
migration `v1` has already been applied. Sending it again is rejected: the class already exists, or
the tag precondition fails. Always send `bindings`, because an upload replaces the whole
configuration. If a class is ever renamed or added, send a new step
`{ "old_tag": "v1", "new_tag": "v2", ... }`.

### Browser snippet (run in a `dash.cloudflare.com` tab)

```js
const API = "<dashboard proxy base, e.g. /api/v4 — or https://api.cloudflare.com/client/v4 with a token>";
const ACCOUNT_ID = "<account id>";
const SCRIPT = "bilbrey-dinner-planner";
const code = "<the full text of worker/src/index.js>";   // see "Getting the file into the tab" below
const metadata = {
  main_module: "index.js",
  compatibility_date: "2026-11-01",
  bindings: [
    { type: "durable_object_namespace", name: "KITCHEN", class_name: "Kitchen" },
    { type: "ai", name: "AI" },
  ],
  // migrations: { new_tag: "v1", new_sqlite_classes: ["Kitchen"] }, // FIRST deploy only — already applied
};
const form = new FormData();
form.append("metadata", JSON.stringify(metadata));
form.append("index.js", new Blob([code], { type: "application/javascript+module" }), "index.js");
const up = await fetch(`${API}/accounts/${ACCOUNT_ID}/workers/scripts/${SCRIPT}`, {
  method: "PUT", body: form, credentials: "include",
});
const upJson = await up.json();
console.log(up.status, upJson.success, JSON.stringify(upJson.errors));
```

If the dashboard proxy needs the same extra request header the dashboard's own API calls send
(for example a CSRF token), copy it from one of those requests. Cloudflare's public docs don't
describe the proxy, so this part is **not verified**.

**Getting the file into the tab:** paste it, or fetch it after the commit is pushed. Two sources
work if the dashboard's CSP allows them: `https://raw.githubusercontent.com/BlufoxMobile/Bilbrey-Family-Dinner-Planner/main/worker/src/index.js`
(it sends `Access-Control-Allow-Origin: *`) and the Pages copy at
`https://blufoxmobile.github.io/Bilbrey-Family-Dinner-Planner/worker/src/index.js`.

### curl equivalent (API token with "Workers Scripts Write") — redeploy form

```sh
curl -X PUT "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/scripts/bilbrey-dinner-planner" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -F 'metadata={"main_module":"index.js","compatibility_date":"2026-11-01","bindings":[{"type":"durable_object_namespace","name":"KITCHEN","class_name":"Kitchen"},{"type":"ai","name":"AI"}]}' \
  -F 'index.js=@worker/src/index.js;type=application/javascript+module;filename=index.js'
```

A successful upload returns `{"success": true, "result": { "id": "bilbrey-dinner-planner", ... }}`.

## 2. Turn on the workers.dev URL

`POST {API}/accounts/{account_id}/workers/scripts/bilbrey-dinner-planner/subdomain`
with `Content-Type: application/json` and this body:

```json
{ "enabled": true }
```

`previews_enabled` is optional; leave it out. In the browser:

```js
const sub = await fetch(`${API}/accounts/${ACCOUNT_ID}/workers/scripts/${SCRIPT}/subdomain`, {
  method: "POST", credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ enabled: true }),
});
console.log(sub.status, await sub.json());
```

To confirm the URL, call `GET {API}/accounts/{account_id}/workers/subdomain`. It returns
`result.subdomain`, and the URL is `https://bilbrey-dinner-planner.<subdomain>.workers.dev`
(expected: `https://bilbrey-dinner-planner.jeff-bilbrey-jb.workers.dev`). Put that URL in
`app/config.js` as `API_BASE`. A brand-new workers.dev hostname can take a minute or two to start
resolving.

Workers AI needs no extra setup. The `ai` binding is all it takes, on the Free plan as well.

## 3. Smoke test (read-only)

```sh
node worker/smoke.mjs https://bilbrey-dinner-planner.jeff-bilbrey-jb.workers.dev
```

It checks `/api/health` (`ok`, `hasPasscode`, `ai: true`, `revision`), CORS preflight and actual
responses for `https://blufoxmobile.github.io` and `http://localhost:5173`, rejection of a foreign
origin (no `Access-Control-Allow-Origin`), and that `/api/state`, `/api/ops`, `/api/scan`,
`/api/receipt`, `/api/ai` and `/api/ideas` return 401 without a key. That makes 22 checks, and it prints `version` at the end. It never calls `/api/setup` and never sends a family key, so it can't trip the backoff.
It never triggers an AI call either. It exits 1 on any failure. Behind an HTTPS proxy, run it with
`NODE_USE_ENV_PROXY=1` (and `NODE_EXTRA_CA_CERTS=<ca bundle>`).

After a good smoke test, **Jeff should open the app right away and set the family passcode**. The
first `POST /api/setup` wins, and every later one gets 409. Health shows `hasPasscode: false` until he
does.

## 4. Operating notes

- **Scan model:** `@cf/google/gemma-4-26b-a4b-it` is the default, with the JSON-schema
  `response_format` and thinking off. If it errors or returns nothing usable, the Worker makes one
  fallback call to `@cf/meta/llama-4-scout-17b-16e-instruct`, with a plain prompt and tolerant
  parsing. To change either model without a code edit, add plain-text bindings
  `{ "type": "plain_text", "name": "SCAN_MODEL", "text": "@cf/..." }` and/or `SCAN_FALLBACK_MODEL`.
- **Cost:** the pantry scan and the receipt scan are the only AI calls. Nothing runs on a schedule. The free allocation is
  10,000 neurons/day, and Gemma 4 is billed at 9,091 neurons per million input tokens and 27,273 per
  million output tokens. A scan with ~70 known items costs very roughly 30–60 neurons, which comes to
  well over 100 scans a day. The fallback costs about 2–3× more, and only when it runs.
- **Receipts (`POST /api/receipt`, v2.2):**
  - Each image (up to 4) gets its own call to the same model with the same fallback, run in
    parallel. Calls use JSON-schema output with `max_completion_tokens` 6000; the fallback uses
    `max_tokens` 6000.
  - The Worker then merges the pages and removes the lines that overlapping screenshots both show.
    It attaches discount lines to their item, fixes qty × unitPrice = lineTotal, expands any
    abbreviations the model left, and validates `matchId` against `known`.
  - It drops or scrubs card, membership/rewards and phone numbers, emails, names and addresses,
    whatever the model returned.
  - Cost is roughly 30–150 neurons per image, so a 4-screenshot receipt comes to about
    150–500 neurons.
  - The response is §9.3 plus `images` (count) and `warnings` (an array of strings, e.g.
    "Image 2 couldn't be read …").
  - If one image fails, the scan still returns 200 with that warning. If every image fails, it
    returns 502 `{ error, detail }`.
- **Claude (SPEC §14):**
  - Jeff adds the Anthropic API key himself: Worker → Settings → Variables and Secrets → Add →
    type **Secret**, name `ANTHROPIC_API_KEY`. It must be a Secret, not Text: deploys from GitHub
    replace plain-text variables with `wrangler.toml`'s `[vars]`, but keep secrets.
  - With the key set, scans and receipts go to Claude first (the family's `settings.aiModel`, default
    `claude-opus-5-5`) and fall back to Workers AI if Claude fails or this month's spend has reached
    `AI_MONTHLY_CAP_USD` (in `wrangler.toml`, $5; `"0"` turns Claude off). `POST /api/ideas` is
    Claude-only. Spend is kept per America/Chicago month in the Durable Object's `ai_usage` table;
    `GET /api/ai` shows it.
  - A wrong or revoked key doesn't break scans (they fall back), but every scan then carries
    `claudeError: "… Claude API 401 authentication_error …"`; check that field after adding the key.
- **Limits enforced:**
  - Ops: 200 per request; more is a 400.
  - State: 1 MB; over is a 413.
  - Scan image: data URL up to 1.5 MB; over is a 413.
  - Receipt images: 1.5 MB each and 4.5 MB together; over is a 413. More than 4 images is a 400.
  - Request bodies: 2 MB, or 5 MB for receipts; over is a 413.
- **Backoff:** 5 wrong keys from one IP within 10 minutes locks that IP out for 10 minutes. 40 wrong
  keys from anywhere within 10 minutes locks everyone out for 10 minutes. A lockout returns 429 with
  `Retry-After`. A request with a missing key header gets 401 and doesn't count toward the lockout.
  Rotating the key clears all counters.

## 5. Local development and tests

```sh
cd worker
npm install          # devDependencies only: wrangler 4.156.1, miniflare 5.20261101.0-beta
npm test             # node:test + Miniflare (real workerd, SQLite DO, mocked AI binding)
npm run dev          # wrangler dev --local on http://localhost:8787 (state works; scan → 502, AI is remote-only)
npm run check        # wrangler deploy --dry-run (validates wrangler.toml + bundle)
```

`wrangler.toml` mirrors the metadata above. Keep `compatibility_date` and the bindings in sync with
section 1.

## Sources checked (2026-11-14)

- Script upload: `PUT /accounts/{account_id}/workers/scripts/{script_name}`. ES modules go up as
  `multipart/form-data` with a JSON `metadata` part whose `main_module` names the entry file. Module
  parts use `application/javascript+module`. The docs show `metadata.migrations` as a
  `SingleStepMigration { new_tag, old_tag, new_sqlite_classes, ... }` or `{ old_tag, new_tag, steps }`,
  bindings `{ type: "durable_object_namespace", name, class_name }` and `{ type: "ai", name }`, and
  `observability { enabled }`. https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/
- Metadata attributes (`main_module` required, `compatibility_date`, `compatibility_flags`,
  `migrations` on the Script Upload API, binding examples):
  https://developers.cloudflare.com/workers/configuration/multipart-upload-metadata/
- workers.dev toggle: `POST /accounts/{account_id}/workers/scripts/{script_name}/subdomain` with
  body `{ enabled: boolean, previews_enabled?: boolean }`:
  https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/subdomain/methods/create/
- Account subdomain: `GET /accounts/{account_id}/workers/subdomain` returns `result.subdomain`:
  https://developers.cloudflare.com/api/resources/workers/subresources/subdomains/methods/get/
- Model pages for image input format, `response_format`, and pricing:
  https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/ ,
  https://developers.cloudflare.com/workers-ai/models/llama-4-scout-17b-16e-instruct/ ,
  https://developers.cloudflare.com/workers-ai/platform/pricing/
