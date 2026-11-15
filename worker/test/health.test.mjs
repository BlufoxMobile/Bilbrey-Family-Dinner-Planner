import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startWorker } from "./helpers.mjs";

let w;
let noAi;
before(async () => {
  w = await startWorker();
  noAi = await startWorker({ ai: false });
});
after(async () => {
  await w.dispose();
  await noAi.dispose();
});

test("GET /api/health reports a fresh, unconfigured backend", async () => {
  const r = await w.call("/api/health");
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.hasPasscode, false);
  assert.equal(r.json.ai, true);
  assert.equal(r.json.revision, 0);
  assert.equal(r.json.scanModel, "@cf/google/gemma-4-26b-a4b-it");
  assert.match(r.headers.get("content-type"), /application\/json/);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.equal(w.calls.length, 0, "health must never call the AI model");
});

test("health says ai:false when the AI binding is missing", async () => {
  const r = await noAi.call("/api/health");
  assert.equal(r.status, 200);
  assert.equal(r.json.ai, false);
  assert.equal(r.json.scanModel, null);
});

test("unknown paths and wrong methods return JSON errors", async () => {
  const nf = await w.call("/api/nope");
  assert.equal(nf.status, 404);
  assert.equal(typeof nf.json.error, "string");

  const wrong = await w.call("/api/ops", { method: "GET" });
  assert.equal(wrong.status, 405);
  assert.equal(typeof wrong.json.error, "string");
  assert.match(wrong.headers.get("allow"), /POST/);

  const root = await w.call("/");
  assert.equal(root.status, 200);
  assert.equal(root.json.service, "bilbrey-dinner-planner");
});

test("trailing slash is tolerated", async () => {
  const r = await w.call("/api/health/");
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
});
