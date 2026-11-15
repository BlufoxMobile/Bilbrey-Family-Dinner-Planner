import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startWorker, familyKey } from "./helpers.mjs";

const KEY = familyKey("Tacos Tuesday");
const NEW_KEY = familyKey("brown butter spaghetti");
const WRONG = familyKey("not it");

let w;
before(async () => {
  w = await startWorker();
});
after(async () => {
  await w.dispose();
});

test("state is refused with needsSetup before any passcode exists", async () => {
  const r = await w.call("/api/state", { key: KEY });
  assert.equal(r.status, 401);
  assert.equal(r.json.needsSetup, true);
});

test("setup rejects a raw passcode / malformed key", async () => {
  for (const key of ["tacos", "", 42, KEY.slice(0, 63), KEY + "0", "g".repeat(64)]) {
    const r = await w.call("/api/setup", { method: "POST", body: { key } });
    assert.equal(r.status, 400, `key ${JSON.stringify(key)} should be rejected`);
    assert.equal(typeof r.json.error, "string");
  }
  const bad = await w.call("/api/setup", { method: "POST", body: "{not json" });
  assert.equal(bad.status, 400);
  const health = await w.call("/api/health");
  assert.equal(health.json.hasPasscode, false);
});

test("setup works once (201), then 409", async () => {
  const first = await w.call("/api/setup", { method: "POST", body: { key: KEY.toUpperCase() } });
  assert.equal(first.status, 201);
  assert.deepEqual(first.json, { ok: true });

  const again = await w.call("/api/setup", { method: "POST", body: { key: NEW_KEY } });
  assert.equal(again.status, 409);
  assert.equal(typeof again.json.error, "string");

  const health = await w.call("/api/health");
  assert.equal(health.json.hasPasscode, true);
});

test("missing key → 401, wrong key → 401, right key → 200", async () => {
  const missing = await w.call("/api/state");
  assert.equal(missing.status, 401);
  assert.match(missing.json.error, /X-Family-Key/);

  const wrong = await w.call("/api/state", { key: WRONG });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.json.error, "Wrong family passcode.");

  const garbage = await w.call("/api/state", { key: "letmein" });
  assert.equal(garbage.status, 401);

  const ok = await w.call("/api/state", { key: KEY });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.revision, 0);
  assert.deepEqual(ok.json.state, {});
});

test("ops and scan also require the family key", async () => {
  const ops = await w.call("/api/ops", { method: "POST", key: WRONG, body: { ops: [{ op: "set", path: ["a"], value: 1 }] } });
  assert.equal(ops.status, 401);
  const scan = await w.call("/api/scan", { method: "POST", key: WRONG, body: { image: "x", known: [] } });
  assert.equal(scan.status, 401);
  assert.equal(w.calls.length, 0, "a rejected scan must not spend AI neurons");
  const state = await w.call("/api/state", { key: KEY });
  assert.equal(state.json.revision, 0, "rejected ops must not change anything");
});

test("POST /api/key rotates the family key", async () => {
  const wrongCurrent = await w.call("/api/key", { method: "POST", key: WRONG, body: { newKey: NEW_KEY } });
  assert.equal(wrongCurrent.status, 401);

  const badNew = await w.call("/api/key", { method: "POST", key: KEY, body: { newKey: "tacos" } });
  assert.equal(badNew.status, 400);

  const rotated = await w.call("/api/key", { method: "POST", key: KEY, body: { newKey: NEW_KEY } });
  assert.equal(rotated.status, 200);
  assert.deepEqual(rotated.json, { ok: true });

  const old = await w.call("/api/state", { key: KEY });
  assert.equal(old.status, 401);
  const fresh = await w.call("/api/state", { key: NEW_KEY });
  assert.equal(fresh.status, 200);
});
