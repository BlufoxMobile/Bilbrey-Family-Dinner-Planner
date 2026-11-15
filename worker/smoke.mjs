#!/usr/bin/env node
// Post-deploy smoke test for the bilbrey-dinner-planner Worker.
//
//   node worker/smoke.mjs https://bilbrey-dinner-planner.jeff-bilbrey-jb.workers.dev
//
// Read-only and safe to run any time: it checks /api/health, the CORS rules (preflight + actual
// responses for the GitHub Pages and localhost origins, and rejection of a foreign origin), and that
// key-protected endpoints refuse a request with no key. It never calls /api/setup, never sends a
// family key (so it can't trip the wrong-key backoff), and never triggers an AI call.
// Exit code 0 = all checks passed, 1 = something failed.

const base = (process.argv[2] || process.env.BASE_URL || "").replace(/\/+$/, "");
if (!/^https?:\/\/[^/]+$/.test(base)) {
  console.error("Usage: node smoke.mjs <BASE_URL>   e.g. https://bilbrey-dinner-planner.<subdomain>.workers.dev");
  process.exit(2);
}

const PAGES = "https://blufoxmobile.github.io";
const LOCAL = "http://localhost:5173";
const FOREIGN = "https://evil.example";
const results = [];

function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

async function req(path, { method = "GET", origin, headers = {}, body } = {}) {
  const h = { ...headers };
  if (origin) h.Origin = origin;
  const res = await fetch(base + path, { method, headers: h, body, redirect: "manual" });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  return { status: res.status, headers: res.headers, text, json };
}

async function main() {
  // 1. Health (no Origin, like curl)
  const h = await req("/api/health");
  check("GET /api/health → 200 JSON", h.status === 200 && h.json && h.json.ok === true, `status ${h.status}`);
  if (h.json) {
    check("health.hasPasscode is a boolean", typeof h.json.hasPasscode === "boolean", `hasPasscode=${h.json.hasPasscode}`);
    check("health.ai is true (Workers AI binding attached)", h.json.ai === true, `ai=${h.json.ai}, scanModel=${h.json.scanModel}`);
    check("health.revision is a number", Number.isInteger(h.json.revision), `revision=${h.json.revision}`);
  }
  check("health is not cached", (h.headers.get("cache-control") || "").includes("no-store"));

  // 2. Actual CORS response for the GitHub Pages origin
  const hp = await req("/api/health", { origin: PAGES });
  check(`GET /api/health from ${PAGES} → ACAO`, hp.status === 200 && hp.headers.get("access-control-allow-origin") === PAGES,
    `status ${hp.status}, ACAO=${hp.headers.get("access-control-allow-origin")}`);
  check("Vary: Origin", /origin/i.test(hp.headers.get("vary") || ""));
  check("Access-Control-Expose-Headers lists X-Revision and Retry-After",
    /x-revision/i.test(hp.headers.get("access-control-expose-headers") || "") &&
      /retry-after/i.test(hp.headers.get("access-control-expose-headers") || ""),
    hp.headers.get("access-control-expose-headers") || "(missing)");

  // 3. Preflights
  for (const origin of [PAGES, LOCAL]) {
    const p = await req("/api/ops", {
      method: "OPTIONS",
      origin,
      headers: { "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,x-family-key" },
    });
    const allowHeaders = (p.headers.get("access-control-allow-headers") || "").toLowerCase();
    check(`OPTIONS preflight from ${origin} → 204 + ACAO`,
      p.status === 204 && p.headers.get("access-control-allow-origin") === origin,
      `status ${p.status}, ACAO=${p.headers.get("access-control-allow-origin")}`);
    check(`  preflight allows X-Family-Key + Content-Type, GET/POST`,
      allowHeaders.includes("x-family-key") && allowHeaders.includes("content-type") &&
        /POST/.test(p.headers.get("access-control-allow-methods") || "") &&
        /GET/.test(p.headers.get("access-control-allow-methods") || ""),
      `headers="${allowHeaders}" methods="${p.headers.get("access-control-allow-methods")}"`);
  }

  // 4. A foreign origin gets no ACAO
  const fp = await req("/api/ops", {
    method: "OPTIONS",
    origin: FOREIGN,
    headers: { "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "x-family-key" },
  });
  check(`OPTIONS from ${FOREIGN} → no ACAO`, !fp.headers.get("access-control-allow-origin"), `status ${fp.status}`);
  const fg = await req("/api/health", { origin: FOREIGN });
  check(`GET from ${FOREIGN} → 403, no ACAO`, fg.status === 403 && !fg.headers.get("access-control-allow-origin"), `status ${fg.status}`);

  // 5. Key-protected endpoints refuse a request with no key (doesn't count toward backoff, no AI call)
  const s = await req("/api/state", { origin: PAGES });
  check("GET /api/state without a key → 401 JSON { error }", s.status === 401 && s.json && typeof s.json.error === "string",
    `status ${s.status}${s.json && s.json.needsSetup ? " (needsSetup: no passcode yet)" : ""}`);
  check("  401 still carries ACAO (so the app can read the error)", s.headers.get("access-control-allow-origin") === PAGES);
  const sc = await req("/api/scan", { method: "POST", origin: PAGES, headers: { "Content-Type": "application/json" }, body: "{}" });
  check("POST /api/scan without a key → 401", sc.status === 401, `status ${sc.status}`);
  const op = await req("/api/ops", { method: "POST", origin: PAGES, headers: { "Content-Type": "application/json" }, body: '{"ops":[]}' });
  check("POST /api/ops without a key → 401", op.status === 401, `status ${op.status}`);

  // 6. Unknown route
  const nf = await req("/api/does-not-exist", { origin: PAGES });
  check("unknown route → 404 JSON", nf.status === 404 && nf.json && typeof nf.json.error === "string", `status ${nf.status}`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed against ${base}`);
  if (h.json) {
    console.log(`hasPasscode=${h.json.hasPasscode}  revision=${h.json.revision}  ai=${h.json.ai}  scanModel=${h.json.scanModel}  version=${h.json.version}`);
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error("Smoke test crashed:", err && err.cause ? `${err.message} (${err.cause.code || err.cause.message})` : err);
  console.error("If you are behind an HTTPS proxy, run with NODE_USE_ENV_PROXY=1 (and NODE_EXTRA_CA_CERTS if needed).");
  process.exit(1);
});
