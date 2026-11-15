import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startWorker, familyKey } from "./helpers.mjs";

let w;
before(async () => {
  w = await startWorker();
});
after(async () => {
  await w.dispose();
});

const preflight = (origin, path = "/api/ops", reqHeaders = "content-type,x-family-key") =>
  w.call(path, {
    method: "OPTIONS",
    origin,
    headers: { "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": reqHeaders },
  });

for (const origin of ["https://blufoxmobile.github.io", "http://localhost:5173", "http://127.0.0.1:8080", "http://localhost"]) {
  test(`preflight from ${origin} is allowed`, async () => {
    const r = await preflight(origin);
    assert.equal(r.status, 204);
    assert.equal(r.headers.get("access-control-allow-origin"), origin);
    assert.match(r.headers.get("access-control-allow-methods"), /POST/);
    assert.match(r.headers.get("access-control-allow-methods"), /GET/);
    const allowed = r.headers.get("access-control-allow-headers").toLowerCase();
    assert.ok(allowed.includes("x-family-key"));
    assert.ok(allowed.includes("content-type"));
    assert.ok(Number(r.headers.get("access-control-max-age")) > 0);
    assert.match(r.headers.get("vary"), /Origin/);
    assert.equal(r.headers.get("access-control-allow-credentials"), null);
  });
}

for (const origin of [
  "https://evil.example",
  "http://blufoxmobile.github.io",
  "https://blufoxmobile.github.io.evil.example",
  "https://someone.github.io",
  "http://localhost.evil.example",
  "https://localhost:5173",
  "http://127.0.0.2:5173",
  "null",
]) {
  test(`origin ${origin} is rejected with no ACAO header`, async () => {
    const pre = await preflight(origin);
    assert.equal(pre.headers.get("access-control-allow-origin"), null);
    assert.notEqual(pre.status, 204);
    const get = await w.call("/api/health", { origin });
    assert.equal(get.status, 403);
    assert.equal(get.headers.get("access-control-allow-origin"), null);
    assert.equal(typeof get.json.error, "string");
  });
}

test("actual responses (success and error) carry CORS headers for allowed origins", async () => {
  const ok = await w.call("/api/health", { origin: "http://localhost:5173" });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("access-control-allow-origin"), "http://localhost:5173");
  assert.match(ok.headers.get("access-control-expose-headers"), /X-Revision/);
  assert.match(ok.headers.get("vary"), /Origin/);

  const err = await w.call("/api/state", { origin: "https://blufoxmobile.github.io", key: familyKey("x") });
  assert.equal(err.status, 401);
  assert.equal(err.headers.get("access-control-allow-origin"), "https://blufoxmobile.github.io");

  const nf = await w.call("/api/missing", { origin: "https://blufoxmobile.github.io" });
  assert.equal(nf.status, 404);
  assert.equal(nf.headers.get("access-control-allow-origin"), "https://blufoxmobile.github.io");
});

test("requests without an Origin (curl, smoke test) work but get no ACAO", async () => {
  const r = await w.call("/api/health", { origin: null });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("access-control-allow-origin"), null);
  const pre = await preflight(null);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), null);
});
