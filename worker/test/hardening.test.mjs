// docs/spec/23: the hardening pass. Backups (a copy a day, export, restore), what happens as the
// state document grows (tidy-up into an archive before the 1 MB wall), storage numbers, the Claude
// chat link when the passcode changes, and a lock-out that can't be turned against the family.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startWorker, familyKey } from "./helpers.mjs";
import { chicagoDate } from "../src/claude.js";

const KEY = familyKey("supper for five");
const WRONG = familyKey("not the passcode");

async function fresh(opts = undefined) {
  const w = await startWorker(opts);
  assert.equal((await w.call("/api/setup", { method: "POST", body: { key: KEY } })).status, 201);
  const ops = (list, extra = {}) => w.call("/api/ops", { method: "POST", key: KEY, body: { ops: list, by: "Jeff", clientId: "test", ...extra } });
  const get = (path, o = {}) => w.call(path, { key: KEY, ...o });
  const post = (path, body, o = {}) => w.call(path, { method: "POST", key: KEY, body, ...o });
  return { w, ops, get, post, state: async () => (await get("/api/state")).json };
}
const set = (path, value) => ({ op: "set", path, value });
const isoDaysAgo = (n) => new Date(Date.parse(`${chicagoDate()}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

/** A receipt-log entry of about `bytes` bytes. */
function receipt(date, bytes = 20_000) {
  const line = (k) => ({ product: `Member's Mark Boneless Skinless Chicken Breast number ${k}`, brand: "Member's Mark", size: "6.5 lb", qty: 1, unitPrice: 17.94, lineTotal: 17.94, matchId: "chicken" });
  const one = JSON.stringify(line(100)).length + 1;
  return { store: "sams", date, total: 212.4, savings: 3, by: "Jeff", at: `${date}T18:00:00.000Z`, source: "scan", lines: Array.from({ length: Math.max(1, Math.round(bytes / one)) }, (_, k) => line(100 + k)) };
}

test("backups: a copy of the state before each day's first change; listed, exported and restored with the family key", async () => {
  const { w, ops, get, post, state } = await fresh();
  try {
    assert.equal((await ops([set(["plan", "2026-11-16"], { dinner: "tacos", status: "planned" })])).status, 200); // revision 1: nothing to copy yet
    assert.deepEqual((await get("/api/backups")).json.backups, []);
    assert.equal((await ops([set(["pantry", "chicken"], { qty: 3 })])).status, 200); // revision 2: revision 1 is kept
    assert.equal((await ops([set(["pantry", "rice"], { qty: 10 })])).status, 200); // same day: no second copy
    const list = (await get("/api/backups")).json.backups;
    assert.equal(list.length, 1);
    assert.deepEqual({ reason: list[0].reason, revision: list[0].revision, day: list[0].day }, { reason: "daily", revision: 1, day: chicagoDate() });
    assert.ok(list[0].bytes > 10);

    for (const path of ["/api/backups", "/api/export", "/api/storage"]) {
      assert.equal((await w.call(path)).status, 401, path);
      assert.equal((await w.call(path, { key: WRONG })).status, 401, path);
    }
    assert.equal((await w.call("/api/restore", { method: "POST", body: { backup: list[0].id, confirm: "restore" } })).status, 401);
    assert.equal((await w.call("/api/compact", { method: "POST", body: {} })).status, 401);

    // The export: the whole state and the lists, never the passcode hash or a link.
    const exp = await get("/api/export");
    assert.equal(exp.status, 200, exp.text);
    assert.match(exp.headers.get("content-disposition"), /attachment; filename="family-dinner-planner-backup-\d{4}-\d{2}-\d{2}\.json"/);
    assert.equal(exp.headers.get("cache-control"), "no-store");
    assert.deepEqual(exp.json.state, (await state()).state);
    assert.equal(exp.json.revision, 3);
    assert.deepEqual(exp.json.archive, []);
    assert.equal(exp.json.backups.length, 1);
    assert.ok(Array.isArray(exp.json.photos) && Array.isArray(exp.json.aiUsage));
    assert.ok(!/salt|hash|sha256|token|mcp/i.test(exp.text.replace(/"state":.*$/s, "")), "no credentials in the export");
    const old = await get(`/api/export?backup=${list[0].id}`);
    assert.deepEqual(old.json.state, { plan: { "2026-11-16": { dinner: "tacos", status: "planned" } } });
    assert.equal((await get("/api/export?backup=999")).status, 404);
    assert.equal((await get("/api/export?backup=abc")).status, 400);

    // Restore that backup. It needs the confirm word; the state it replaces is kept.
    assert.equal((await post("/api/restore", { backup: list[0].id })).status, 400);
    assert.equal((await post("/api/restore", { backup: 999, confirm: "restore" })).status, 404);
    const before = await state();
    const r = await post("/api/restore", { backup: list[0].id, confirm: "restore", by: "Jeff" });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.revision, before.revision + 1);
    assert.equal(r.json.replacedRevision, before.revision);
    const after = await state();
    assert.deepEqual(after.state, { plan: { "2026-11-16": { dinner: "tacos", status: "planned" } } });
    assert.equal(after.updatedBy, "Restore (Jeff)");
    const kept = (await get("/api/backups")).json.backups.find((b) => b.reason === "restore");
    assert.equal(kept.revision, before.revision);
    // …so the restore can be undone, here from an export file sent back as it is.
    const file = (await get(`/api/export?backup=${kept.id}`)).json;
    const undo = await post("/api/restore", { ...file, confirm: "restore" });
    assert.equal(undo.status, 200, undo.text);
    assert.deepEqual((await state()).state, before.state);
    // Phones notice: the revision moved on, so their next sync pulls the restored state.
    assert.equal((await get(`/api/state?since=${before.revision}`)).json.unchanged, undefined);

    for (const bad of [{ state: "nope", confirm: "restore" }, { state: [1, 2], confirm: "restore" }, { state: { a: { __proto__x: 1, constructor: { y: 1 } } }, confirm: "restore" }, [1], { confirm: "restore" }]) {
      assert.equal((await post("/api/restore", bad)).status, 400, JSON.stringify(bad));
    }
    assert.equal((await post("/api/restore", { state: { big: "x".repeat(1024 * 1024 + 10) }, confirm: "restore" })).status, 413);
    assert.deepEqual((await state()).state, before.state, "a refused restore changes nothing");
  } finally {
    await w.dispose();
  }
});

test("tidy-up: old receipts keep their totals, old nights and old check-offs leave, and all of it stays in the archive", async () => {
  const { w, ops, get, post, state } = await fresh();
  try {
    const oldDate = isoDaysAgo(300);
    const recentDate = isoDaysAgo(20);
    const longAgoNight = isoDaysAgo(500);
    const lastMonthNight = isoDaysAgo(30);
    assert.equal((await ops([
      set(["receiptLog", "old1"], receipt(oldDate, 4000)),
      set(["receiptLog", "recent1"], receipt(recentDate, 4000)),
      set(["plan", longAgoNight], { dinner: "smashburgers", status: "cooked", by: "Candi" }),
      set(["plan", lastMonthNight], { dinner: "chicken-tacos", status: "cooked", by: "Jeff" }),
      set(["checked", `${isoDaysAgo(200)}+7`], { chicken: true }),
      set(["checked", `trip:${isoDaysAgo(100)}:${isoDaysAgo(95)}:jewel`], { rice: true }),
      set(["checked", `${isoDaysAgo(3)}+7`], { beef: true }),
      set(["skips", `${isoDaysAgo(120)}+14`], { butter: { reason: "stretch" } }),
      set(["myProducts", "sams/chicken"], { name: "Member's Mark Chicken", price: 17.94 }),
    ])).status, 200);
    const before = await state();

    const dry = await post("/api/compact", { dryRun: true });
    assert.equal(dry.status, 200, dry.text);
    assert.deepEqual({ r: dry.json.receiptsTrimmed, n: dry.json.nightsArchived, l: dry.json.listsCleared, dryRun: dry.json.dryRun }, { r: 1, n: 1, l: 3, dryRun: true });
    assert.ok(dry.json.afterBytes < dry.json.beforeBytes);
    assert.deepEqual((await state()).state, before.state, "a dry run changes nothing");

    const real = await post("/api/compact", {});
    assert.equal(real.status, 200, real.text);
    assert.equal(real.json.changed, true);
    const s = (await state()).state;
    const lines = before.state.receiptLog.old1.lines.length;
    assert.deepEqual(s.receiptLog.old1, { ...before.state.receiptLog.old1, lines: [], lineCount: lines, archived: true }, "store, date and totals stay; the lines move out");
    assert.deepEqual(s.receiptLog.recent1, before.state.receiptLog.recent1, "a recent receipt is untouched");
    assert.deepEqual(Object.keys(s.plan), [lastMonthNight]);
    assert.deepEqual(Object.keys(s.checked), [`${isoDaysAgo(3)}+7`]);
    assert.deepEqual(s.skips, {});
    assert.deepEqual(s.myProducts, before.state.myProducts, "what the receipts taught (products, prices) is not touched");
    assert.equal((await state()).updatedBy, "Planner tidy-up");

    // Nothing was thrown away: the archive has it, and so does the backup made just before.
    const exp = (await get("/api/export")).json;
    assert.deepEqual(exp.archive.map((a) => [a.kind, a.key]).sort(), [["plan", longAgoNight], ["receipt", "old1"]].sort());
    assert.deepEqual(exp.archive.find((a) => a.kind === "receipt").value, before.state.receiptLog.old1);
    assert.deepEqual(exp.archive.find((a) => a.kind === "plan").value, before.state.plan[longAgoNight]);
    const backup = exp.backups.find((b) => b.reason === "tidy-up");
    assert.deepEqual((await get(`/api/export?backup=${backup.id}`)).json.state, before.state);

    const again = await post("/api/compact", {});
    assert.equal(again.json.changed, false, "nothing left to tidy");
    const st = (await get("/api/storage")).json;
    assert.equal(st.archive.entries, 2);
    assert.equal(st.state.limitBytes, 1024 * 1024);
    assert.ok(st.state.bytes > 0 && st.state.pct >= 0 && st.state.sections.receiptLog > 0);
    assert.ok(st.backups.length >= 1);
  } finally {
    await w.dispose();
  }
});

test("the state never hits the 1 MB wall while there is old detail to archive", async () => {
  const { w, ops, get, state } = await fresh();
  try {
    // Four years of receipts, 25 KB each: 30 old ones (750 KB) and a few recent ones.
    for (let k = 0; k < 30; k += 6) {
      const r = await ops(Array.from({ length: 6 }, (_, j) => set(["receiptLog", `old${k + j}`], receipt(isoDaysAgo(200 + (k + j) * 30), 25_000))));
      assert.equal(r.status, 200, r.text);
    }
    let st = (await get("/api/storage")).json.state;
    assert.ok(st.bytes > 700_000 && st.bytes < 850_000, `still under the tidy-up line (${st.bytes})`);
    assert.equal((await get("/api/storage")).json.archive.entries, 0);

    // One more big import would cross 1 MB: instead of a refusal, old receipts are trimmed and it fits.
    const big = await ops(Array.from({ length: 12 }, (_, j) => set(["receiptLog", `new${j}`], receipt(isoDaysAgo(j + 1), 25_000))));
    assert.equal(big.status, 200, big.text);
    const s = (await state()).state;
    assert.equal(Object.keys(s.receiptLog).length, 42, "every receipt is still listed");
    assert.ok(s.receiptLog.new0.lines.length > 50, "the new receipts are whole");
    assert.deepEqual(s.receiptLog.old0.lines, []);
    assert.equal(s.receiptLog.old0.archived, true);
    assert.equal(s.receiptLog.old0.total, 212.4);
    st = (await get("/api/storage")).json;
    assert.ok(st.state.bytes < 400_000, `plenty of room again (${st.state.bytes})`);
    assert.equal(st.archive.entries, 30);
    assert.ok(st.backups.some((b) => b.reason === "tidy-up"));

    // Getting close (over 85%) tidies up right after the change that got it there.
    const { w: w2, ops: ops2, get: get2 } = await fresh();
    try {
      for (let k = 0; k < 4; k++) {
        assert.equal((await ops2(Array.from({ length: 9 }, (_, j) => set(["receiptLog", `r${k * 9 + j}`], receipt(isoDaysAgo(250 + k * 9 + j), 25_000))))).status, 200);
      }
      const after = (await get2("/api/storage")).json;
      assert.ok(after.state.bytes < 100_000, `tidied (${after.state.bytes})`);
      assert.equal(after.archive.entries, 36);
    } finally {
      await w2.dispose();
    }

    // When everything is recent there is nothing to archive, and the wall still holds (413, nothing saved).
    const full = await ops([set(["notes"], "x".repeat(900_000))]);
    assert.equal(full.status, 413, full.text);
    assert.match(full.json.error, /limit is 1 MB\. Nothing was saved/);
  } finally {
    await w.dispose();
  }
});

test("changing the passcode retires the Claude chat link too", async () => {
  const { w, get, post } = await fresh();
  try {
    const NEW = familyKey("a brand new passcode");
    const plain = await post("/api/key", { newKey: KEY });
    assert.deepEqual(plain.json, { ok: true }, "no link yet: nothing to retire");
    const link = new URL((await get("/api/mcp/link")).json.url).pathname;
    const ping = (path) => w.call(path, { method: "POST", origin: null, body: { jsonrpc: "2.0", id: 1, method: "ping" } });
    assert.equal((await ping(link)).status, 200);
    const rotated = await post("/api/key", { newKey: NEW });
    assert.deepEqual(rotated.json, { ok: true, mcpLinkReset: true });
    assert.equal((await ping(link)).status, 404, "whoever had the old passcode may have copied the link: it's dead");
    const fresh2 = new URL((await w.call("/api/mcp/link", { key: NEW })).json.url).pathname;
    assert.notEqual(fresh2, link);
    assert.equal((await ping(fresh2)).status, 200);
  } finally {
    await w.dispose();
  }
});

test("the Claude chat link: junk is turned away before anything is read, and replies ask not to be cached, indexed or referred", async () => {
  const { w, get } = await fresh();
  try {
    const link = new URL((await get("/api/mcp/link")).json.url).pathname;
    for (const path of ["/mcp", "/mcp/", "/mcp/short", `/mcp/${"A".repeat(32)}`, `/mcp/${"a".repeat(33)}`, `/mcp/${"a".repeat(32)}/extra`]) {
      const r = await w.call(path, { method: "POST", origin: null, body: "x".repeat(600 * 1024) });
      assert.equal(r.status, 404, path);
    }
    const ok = await w.call(link, { method: "POST", origin: null, body: { jsonrpc: "2.0", id: 1, method: "ping" } });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("cache-control"), "no-store");
    assert.equal(ok.headers.get("referrer-policy"), "no-referrer");
    assert.equal(ok.headers.get("x-robots-tag"), "noindex");
    assert.equal(ok.headers.get("access-control-allow-origin"), null);
    assert.equal((await w.call(link, { method: "POST", origin: null, body: "x".repeat(600 * 1024) })).status, 413);
  } finally {
    await w.dispose();
  }
});

test("a flood of wrong passcodes from strangers can't lock the family out of their own planner", async () => {
  const { w } = await fresh();
  try {
    const home = "203.0.113.50";
    assert.equal((await w.call("/api/state", { key: KEY, ip: home })).status, 200); // the family's phone, at home
    // 40 wrong keys from 40 addresses: the everyone-lock comes on.
    for (let i = 0; i < 40; i++) assert.equal((await w.call("/api/state", { key: WRONG, ip: `198.51.100.${i + 1}` })).status, 401);
    const stranger = await w.call("/api/state", { key: KEY, ip: "192.0.2.77" });
    assert.equal(stranger.status, 429, "an address the planner has never seen waits, right key or not");
    assert.equal((await w.call("/api/state", { key: KEY, ip: home })).status, 200, "the family's own address keeps working");
    assert.equal((await w.call("/api/ops", { method: "POST", key: KEY, ip: home, body: { ops: [set(["a"], 1)] } })).status, 200);
    // Its own typos still count against it, like anyone's.
    for (let i = 0; i < 5; i++) await w.call("/api/state", { key: WRONG, ip: home });
    assert.equal((await w.call("/api/state", { key: KEY, ip: home })).status, 429);
  } finally {
    await w.dispose();
  }
});

test("a chat that runs away is slowed down", async () => {
  const { w, get } = await fresh({ bindings: { RATE_MCP: "3" } });
  try {
    const link = new URL((await get("/api/mcp/link")).json.url).pathname;
    const ping = () => w.call(link, { method: "POST", origin: null, body: { jsonrpc: "2.0", id: 1, method: "ping" } });
    for (let i = 0; i < 3; i++) assert.equal((await ping()).status, 200);
    const limited = await ping();
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
    assert.equal((await get("/api/state")).status, 200, "the app itself is not affected");
  } finally {
    await w.dispose();
  }
});

test("every route that touches the family's data needs the family key", async () => {
  const { w } = await fresh();
  try {
    const routes = [
      ["GET", "/api/state"], ["POST", "/api/ops"], ["POST", "/api/key"], ["POST", "/api/scan"], ["POST", "/api/receipt"], ["POST", "/api/ideas"],
      ["GET", "/api/ai"], ["GET", "/api/photo?id=" + "a".repeat(32)], ["POST", "/api/photo"], ["POST", "/api/photo/delete"], ["POST", "/api/photo/fetch"],
      ["POST", "/api/photo/cleanup"], ["GET", "/api/mcp/link"], ["POST", "/api/mcp/rotate"], ["GET", "/api/storage"], ["GET", "/api/export"],
      ["GET", "/api/backups"], ["POST", "/api/restore"], ["POST", "/api/compact"],
    ];
    for (const [method, path] of routes) {
      const headers = path === "/api/photo" ? { "Content-Type": "image/jpeg" } : {};
      const body = method === "POST" ? (path === "/api/photo" ? new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]) : { id: "a".repeat(32), url: "https://scene7.samsclub.com/is/image/samsclub/x", image: "x", ops: [set(["a"], 1)], confirm: "restore", state: {} }) : undefined;
      const none = await w.call(path, { method, body, headers, ip: "192.0.2.10" });
      assert.equal(none.status, 401, `${method} ${path} without a key → ${none.status} ${none.text}`);
      const wrong = await w.call(path, { method, body, headers, key: WRONG, ip: `192.0.2.${20 + routes.indexOf(routes.find((r) => r[1] === path))}` });
      assert.equal(wrong.status, 401, `${method} ${path} with a wrong key → ${wrong.status}`);
      assert.ok(!/[0-9a-f]{64}/.test(none.text + wrong.text), "no key is ever echoed");
    }
    // A site that isn't the planner can't call any of them from a browser.
    assert.equal((await w.call("/api/export", { key: KEY, origin: "https://evil.example" })).status, 403);
    assert.equal((await w.call("/api/photo/fetch", { method: "POST", key: KEY, origin: "https://evil.example", body: { url: "x" } })).status, 403);
  } finally {
    await w.dispose();
  }
});
