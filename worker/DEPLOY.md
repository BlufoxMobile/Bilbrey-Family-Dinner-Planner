# Deploying `bilbrey-dinner-planner`

The Worker is ONE ES-module file, `worker/src/index.js` (~49 KB, no npm runtime dependencies; its
only import is the built-in `cloudflare:workers`). Deploy it with the Workers Script Upload API as a
`multipart/form-data` PUT. No wrangler and no build step are needed.

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

### `metadata` for the FIRST deploy (this creates the SQLite Durable Object namespace)

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

Use the same JSON **without the `migrations` key**, because migration `v1` has already been applied.
Sending it again is rejected: the class already exists, or the tag precondition fails. Always send
`bindings`, because an upload replaces the whole configuration. If a class is ever renamed or added,
send a new step `{ "old_tag": "v1", "new_tag": "v2", ... }`.

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
  migrations: { new_tag: "v1", new_sqlite_classes: ["Kitchen"] }, // FIRST deploy only
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

### curl equivalent (API token with "Workers Scripts Write")

```sh
curl -X PUT "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/scripts/bilbrey-dinner-planner" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -F 'metadata={"main_module":"index.js","compatibility_date":"2026-11-01","bindings":[{"type":"durable_object_namespace","name":"KITCHEN","class_name":"Kitchen"},{"type":"ai","name":"AI"}],"migrations":{"new_tag":"v1","new_sqlite_classes":["Kitchen"]}}' \
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
origin (no `Access-Control-Allow-Origin`), and that `/api/state`, `/api/ops` and `/api/scan` return 401
without a key. It never calls `/api/setup` and never sends a family key, so it can't trip the backoff.
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
- **Cost:** the scan is the only AI call. Nothing runs on a schedule. The free allocation is
  10,000 neurons/day, and Gemma 4 is billed at 9,091 neurons per million input tokens and 27,273 per
  million output tokens. A scan with ~70 known items costs very roughly 30–60 neurons, which comes to
  well over 100 scans a day. The fallback costs about 2–3× more, and only when it runs.
- **Limits enforced:** 200 ops per request (400 if more), state 1 MB (413), image data URL 1.5 MB
  (413), request bodies 2 MB (413).
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
