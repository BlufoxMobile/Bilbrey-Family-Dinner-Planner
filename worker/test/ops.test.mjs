import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startWorker, familyKey } from "./helpers.mjs";

const KEY = familyKey("supper for five");
let w;

const ops = (list, extra = {}) =>
  w.call("/api/ops", { method: "POST", key: KEY, body: { ops: list, by: "Candi", clientId: "phone-candi", ...extra } });
const getState = (since) => w.call(`/api/state${since === undefined ? "" : `?since=${since}`}`, { key: KEY });

before(async () => {
  w = await startWorker();
  assert.equal((await w.call("/api/setup", { method: "POST", body: { key: KEY } })).status, 201);
});
after(async () => {
  await w.dispose();
});

test("set creates intermediate objects; the response is the full state", async () => {
  const r = await ops([{ op: "set", path: ["votes", "smashburgers", "Knox"], value: 1 }]);
  assert.equal(r.status, 200);
  assert.equal(r.json.revision, 1);
  assert.equal(r.json.updatedBy, "Candi");
  assert.ok(!Number.isNaN(Date.parse(r.json.updatedAt)));
  assert.deepEqual(r.json.state, { votes: { smashburgers: { Knox: 1 } } });
  assert.equal(r.headers.get("x-revision"), "1");
});

test("a multi-op request applies in order and bumps revision exactly once", async () => {
  const r = await ops([
    { op: "set", path: ["votes", "smashburgers", "Jeff"], value: 1 },
    { op: "set", path: ["votes", "smashburgers", "Knox"], value: -1 },
    { op: "set", path: ["plan", "2026-11-21"], value: { dinner: "brown-butter-spaghetti", sides: ["buttered-peas"], status: "planned" } },
    { op: "set", path: ["plan", "2026-11-22"], value: { dinner: "orange-chicken", status: "planned" } },
    { op: "del", path: ["plan", "2026-11-22"] },
    { op: "set", path: ["settings", "planStore"], value: "jewel" },
  ]);
  assert.equal(r.status, 200);
  assert.equal(r.json.revision, 2);
  assert.deepEqual(r.json.state.votes.smashburgers, { Knox: -1, Jeff: 1 });
  assert.deepEqual(Object.keys(r.json.state.plan), ["2026-11-21"]);
  assert.equal(r.json.state.settings.planStore, "jewel");
});

test("push creates a missing array, then appends", async () => {
  const a = await ops([{ op: "push", path: ["receipts"], value: { date: "2026-11-14", store: "sams", amount: 212.4, by: "Jeff" } }]);
  assert.equal(a.status, 200);
  assert.equal(a.json.state.receipts.length, 1);
  const b = await ops([
    { op: "push", path: ["receipts"], value: { date: "2026-11-15", store: "jewel", amount: 38.11, by: "Candi" } },
    { op: "set", path: ["receipts", "0", "note"], value: "Big bulk run" },
  ]);
  assert.equal(b.json.revision, 4);
  assert.equal(b.json.state.receipts.length, 2);
  assert.equal(b.json.state.receipts[1].store, "jewel");
  assert.equal(b.json.state.receipts[0].note, "Big bulk run");
});

test("del of something that isn't there is a harmless no-op; numeric keys are accepted", async () => {
  const r = await ops([
    { op: "del", path: ["plan", "1999-01-01"] },
    { op: "del", path: ["nothing", "here", "at", "all"] },
    { op: "set", path: ["substitutions", "orange-chicken", 0], value: "custom:canned-green-beans" },
  ]);
  assert.equal(r.status, 200);
  assert.equal(r.json.state.nothing, undefined);
  assert.deepEqual(r.json.state.substitutions, { "orange-chicken": { "0": "custom:canned-green-beans" } });
});

test("GET /api/state?since=N answers unchanged when nothing moved", async () => {
  const full = await getState();
  assert.equal(full.status, 200);
  const rev = full.json.revision;
  assert.equal(rev, 5);
  assert.ok(full.json.state.votes);

  const same = await getState(rev);
  assert.equal(same.status, 200);
  assert.deepEqual(same.json, { revision: rev, unchanged: true });

  const older = await getState(rev - 1);
  assert.equal(older.json.revision, rev);
  assert.deepEqual(older.json.state, full.json.state);

  const junk = await w.call("/api/state?since=abc", { key: KEY });
  assert.ok(junk.json.state, "an unparseable since returns the full state");
});

test("prototype-pollution keys are rejected anywhere in a path or value", async () => {
  const before = (await getState()).json;
  const bad = [
    [{ op: "set", path: ["__proto__", "polluted"], value: true }],
    [{ op: "set", path: ["votes", "constructor", "prototype"], value: 1 }],
    [{ op: "push", path: ["prototype"], value: 1 }],
    [{ op: "del", path: ["plan", "__proto__"] }],
  ];
  for (const list of bad) {
    const r = await ops(list);
    assert.equal(r.status, 400, JSON.stringify(list));
    assert.match(r.json.error, /forbidden key/);
  }
  // A value smuggling __proto__ as an own JSON key (as JSON.parse produces it).
  const raw = '{"ops":[{"op":"set","path":["pantry","rice"],"value":{"qty":2,"__proto__":{"polluted":true}}}]}';
  const r = await w.call("/api/ops", { method: "POST", key: KEY, body: raw });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /forbidden key "__proto__"/);
  const nested = await ops([{ op: "set", path: ["custom", "x"], value: { a: [{ b: { constructor: 1 } }] } }]);
  assert.equal(nested.status, 400);

  const after = (await getState()).json;
  assert.equal(after.revision, before.revision, "nothing was applied");
  assert.equal({}.polluted, undefined);
});

test("a batch with one bad op applies nothing (atomic)", async () => {
  const before = (await getState()).json;
  const r = await ops([
    { op: "set", path: ["settings", "brand"], value: "name" },
    { op: "push", path: ["settings", "planStore"], value: "sams" }, // planStore is a string, not a list
  ]);
  assert.equal(r.status, 400);
  assert.match(r.json.error, /isn't a list/);
  const after = (await getState()).json;
  assert.equal(after.revision, before.revision);
  assert.equal(after.state.settings.brand, undefined);
});

test("malformed requests get clear 400s", async () => {
  const cases = [
    { body: { ops: [] } },
    { body: { ops: "set" } },
    { body: [] },
    { body: { ops: [{ op: "merge", path: ["a"], value: 1 }] } },
    { body: { ops: [{ op: "set", path: [], value: 1 }] } },
    { body: { ops: [{ op: "set", path: "votes.x", value: 1 }] } },
    { body: { ops: [{ op: "set", path: ["a", ""], value: 1 }] } },
    { body: { ops: [{ op: "set", path: ["a", { k: 1 }], value: 1 }] } },
    { body: { ops: [{ op: "set", path: ["a"] }] } },
    { body: { ops: [{ op: "set", path: ["receipts", "9"], value: 1 }] } }, // past the end of a list
    { body: "{ops:" },
  ];
  for (const c of cases) {
    const r = await w.call("/api/ops", { method: "POST", key: KEY, body: c.body });
    assert.equal(r.status, 400, JSON.stringify(c.body));
    assert.equal(typeof r.json.error, "string");
  }
});

test("at most 200 ops per request", async () => {
  const many = Array.from({ length: 201 }, (_, i) => ({ op: "set", path: ["bulk", `k${i}`], value: i }));
  const tooMany = await ops(many);
  assert.equal(tooMany.status, 400);
  assert.match(tooMany.json.error, /200/);
  const ok = await ops(many.slice(0, 200));
  assert.equal(ok.status, 200);
  assert.equal(Object.keys(ok.json.state.bulk).length, 200);
  await ops([{ op: "del", path: ["bulk"] }]);
});

test("a change that would push the state over 1 MB is refused and nothing is saved", async () => {
  const before = (await getState()).json;
  const big = "x".repeat(700 * 1024);
  const first = await ops([{ op: "set", path: ["blobs", "a"], value: big }]);
  assert.equal(first.status, 200);
  const second = await ops([{ op: "set", path: ["blobs", "b"], value: big }]);
  assert.equal(second.status, 413);
  assert.match(second.json.error, /1 MB/);
  const after = (await getState()).json;
  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.state.blobs.b, undefined);
  // Multi-byte characters count as UTF-8 bytes, not string length.
  const emoji = "🍝".repeat(100 * 1024); // 200K UTF-16 units, 400 KB of UTF-8
  const third = await ops([{ op: "set", path: ["blobs", "c"], value: emoji }]);
  assert.equal(third.status, 413);
  const cleared = await ops([{ op: "del", path: ["blobs"] }]);
  assert.equal(cleared.status, 200);
});

test("a retried batch (same clientId + batchId) is not applied twice", async () => {
  const body = { ops: [{ op: "push", path: ["receipts"], value: { amount: 9.99 } }], by: "Jordan", clientId: "phone-jordan", batchId: "b-0001" };
  const a = await w.call("/api/ops", { method: "POST", key: KEY, body });
  assert.equal(a.status, 200);
  const b = await w.call("/api/ops", { method: "POST", key: KEY, body });
  assert.equal(b.status, 200);
  assert.equal(b.json.duplicate, true);
  assert.equal(b.json.revision, a.json.revision);
  assert.equal(b.json.state.receipts.length, a.json.state.receipts.length);
  const c = await w.call("/api/ops", { method: "POST", key: KEY, body: { ...body, batchId: "b-0002" } });
  assert.equal(c.json.revision, a.json.revision + 1);
  assert.equal(c.json.state.receipts.length, a.json.state.receipts.length + 1);
});

test("state survives across requests in order (strong consistency)", async () => {
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) => ops([{ op: "push", path: ["log"], value: i }])),
  );
  const revisions = results.map((r) => r.json.revision).sort((a, b) => a - b);
  for (let i = 1; i < revisions.length; i++) assert.equal(revisions[i], revisions[i - 1] + 1);
  const final = (await getState()).json;
  assert.equal(final.state.log.length, 10);
  assert.deepEqual([...final.state.log].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});
