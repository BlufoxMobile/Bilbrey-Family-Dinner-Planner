// The Claude chat connector (SPEC §15): the private link, MCP over JSON-RPC at /mcp/<token>, and the
// eight tools against the real recipe box (data/*.json, served by the test harness in place of
// GitHub Pages).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startWorker, familyKey, BASE } from "./helpers.mjs";
import { buildDb } from "../../app/data.js";
import { packageOf } from "../../app/packages.js";
import { rotationList, allDinners } from "../../app/planner.js";
import { todayISO, addDays } from "../../app/util.js";

const KEY = familyKey("supper for five");
const DATA = ["catalog", "recipes", "prices", "stores", "lunches", "nutrition", "products"];
const db = buildDb(Object.fromEntries(DATA.map((n) => [n, JSON.parse(readFileSync(new URL(`../../data/${n}.json`, import.meta.url), "utf8"))])));
const today = todayISO();
const TOKEN_URL = new RegExp(`^${BASE.replace(/[.]/g, "\\.")}/mcp/[0-9a-f]{32}$`);

let w;
let mcpPath; // "/mcp/<token>"
let nextId = 1;

const link = (key = KEY) => w.call("/api/mcp/link", { key });
const rotate = (key = KEY) => w.call("/api/mcp/rotate", { method: "POST", key });
const getState = () => w.call("/api/state", { key: KEY });
const post = (path, body, headers = {}) => w.call(path, { method: "POST", body, origin: null, headers });
const rpc = (method, params, { path = mcpPath, headers } = {}) =>
  post(path, { jsonrpc: "2.0", id: nextId++, method, ...(params === undefined ? {} : { params }) }, headers);

async function tool(name, args = {}) {
  const r = await rpc("tools/call", { name, arguments: args });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.headers.get("content-type"), "application/json; charset=utf-8");
  const res = r.json.result;
  assert.ok(res && Array.isArray(res.content), r.text);
  assert.equal(res.content[0].type, "text");
  const text = res.content[0].text;
  return { isError: res.isError === true, text, data: res.isError ? null : JSON.parse(text) };
}

const revision = async () => (await getState()).json.revision;

before(async () => {
  w = await startWorker();
  assert.equal((await w.call("/api/setup", { method: "POST", body: { key: KEY } })).status, 201);
});
after(async () => {
  await w.dispose();
});

// ── the link ─────────────────────────────────────────────────────────────────────────────────
test("before a link exists every /mcp path is a 404", async () => {
  const r = await post(`/mcp/${"a".repeat(32)}`, { jsonrpc: "2.0", id: 1, method: "ping" });
  assert.equal(r.status, 404);
});

test("the link needs the family key and stays the same until rotated", async () => {
  assert.equal((await link(null)).status, 401);
  assert.equal((await w.call("/api/mcp/link")).status, 401);
  assert.equal((await link(familyKey("wrong passcode"))).status, 401);

  const a = await link();
  assert.equal(a.status, 200, a.text);
  assert.match(a.json.url, TOKEN_URL);
  assert.equal(a.headers.get("access-control-allow-origin"), "https://blufoxmobile.github.io");
  const b = await link();
  assert.equal(b.json.url, a.json.url);

  assert.equal((await rotate(null)).status, 401);
  assert.equal((await w.call("/api/mcp/rotate", { key: KEY })).status, 405);
  const c = await rotate();
  assert.equal(c.status, 200, c.text);
  assert.equal(c.json.rotated, true);
  assert.match(c.json.url, TOKEN_URL);
  assert.notEqual(c.json.url, a.json.url);
  assert.equal((await link()).json.url, c.json.url);

  const oldPath = new URL(a.json.url).pathname;
  mcpPath = new URL(c.json.url).pathname;
  assert.equal((await rpc("ping", undefined, { path: oldPath })).status, 404, "the old link stops working");
  assert.equal((await rpc("ping")).status, 200);
});

test("a wrong or missing token is a plain 404", async () => {
  const token = mcpPath.slice(5);
  for (const path of [`/mcp/${"0".repeat(32)}`, `/mcp/${token.slice(0, 31)}`, `/mcp/${token.toUpperCase()}`, `/mcp/${token}x`, `/mcp/${token}/more`, "/mcp", "/mcp/"]) {
    const r = await post(path, { jsonrpc: "2.0", id: 1, method: "ping" });
    assert.equal(r.status, 404, path);
    assert.equal(r.json.result, undefined);
  }
});

test("GET is 405 with Allow: POST; browser origins aren't blocked (the link is the credential)", async () => {
  const g = await w.call(mcpPath, { origin: null });
  assert.equal(g.status, 405);
  assert.equal(g.headers.get("allow"), "POST");
  const r = await w.call(mcpPath, { method: "POST", origin: "https://claude.ai", body: { jsonrpc: "2.0", id: 9, method: "ping" } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { jsonrpc: "2.0", id: 9, result: {} });
  assert.equal(r.headers.get("access-control-allow-origin"), null);
});

// ── JSON-RPC / MCP ───────────────────────────────────────────────────────────────────────────
test("initialize echoes a supported protocol version and describes the server", async () => {
  const a = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "claude-ai", version: "1" } });
  assert.equal(a.status, 200);
  assert.equal(a.json.jsonrpc, "2.0");
  const r = a.json.result;
  assert.equal(r.protocolVersion, "2025-03-26");
  assert.equal(r.serverInfo.name, "bilbrey-dinner-planner");
  assert.equal(typeof r.serverInfo.version, "string");
  assert.deepEqual(Object.keys(r.capabilities), ["tools"]);
  assert.match(r.instructions, /oven/);
  assert.match(r.instructions, /Caesar/);

  const b = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {} });
  assert.equal(b.json.result.protocolVersion, "2025-06-18");
  const c = await rpc("initialize", { protocolVersion: "2099-01-01", capabilities: {} });
  assert.equal(c.json.result.protocolVersion, "2025-06-18", "an unknown version gets the newest one this server speaks");
});

test("notifications get 202 with no body; ping; unknown methods; parse errors; batches", async () => {
  const n = await post(mcpPath, { jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(n.status, 202);
  assert.equal(n.text, "");

  assert.deepEqual((await rpc("ping")).json.result, {});

  const u = await rpc("resources/list");
  assert.equal(u.status, 200);
  assert.equal(u.json.error.code, -32601);

  const p = await post(mcpPath, "{not json");
  assert.equal(p.status, 400);
  assert.equal(p.json.error.code, -32700);
  assert.equal(p.json.id, null);

  const bad = await post(mcpPath, { id: 3, method: "ping" });
  assert.equal(bad.json.error.code, -32600);

  const batch = await post(mcpPath, [
    { jsonrpc: "2.0", id: "a", method: "ping" },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: "b", method: "tools/list" },
  ]);
  assert.equal(batch.status, 200);
  assert.ok(Array.isArray(batch.json));
  assert.deepEqual(batch.json.map((m) => m.id), ["a", "b"]);
  assert.equal(batch.json[1].result.tools.length, 10);

  const onlyNotes = await post(mcpPath, [{ jsonrpc: "2.0", method: "notifications/initialized" }]);
  assert.equal(onlyNotes.status, 202);
  const empty = await post(mcpPath, []);
  assert.equal(empty.status, 400);
  assert.equal(empty.json.error.code, -32600);
});

test("an unsupported MCP-Protocol-Version header is a 400", async () => {
  const r = await rpc("ping", undefined, { headers: { "MCP-Protocol-Version": "1999-01-01" } });
  assert.equal(r.status, 400);
  const ok = await rpc("ping", undefined, { headers: { "MCP-Protocol-Version": "2025-06-18" } });
  assert.equal(ok.status, 200);
});

test("tools/list: ten tools with JSON Schemas; unknown tools and bad arguments", async () => {
  const r = await rpc("tools/list");
  const names = r.json.result.tools.map((t) => t.name);
  assert.deepEqual(names.sort(), ["add_receipt", "get_family_profile", "get_health_summary", "get_pantry", "get_plan", "get_shopping_list", "get_use_first", "list_recipes", "plan_dinner", "update_pantry"]);
  for (const t of r.json.result.tools) {
    assert.equal(t.inputSchema.type, "object", t.name);
    assert.ok(t.description.length > 80, t.name);
    assert.equal(typeof t.annotations.readOnlyHint, "boolean", t.name);
  }
  const unknown = await rpc("tools/call", { name: "order_groceries", arguments: {} });
  assert.equal(unknown.json.error.code, -32602);
  const badArgs = await tool("get_plan", { from: "next tuesday" });
  assert.equal(badArgs.isError, true);
  assert.match(badArgs.text, /YYYY-MM-DD/);
});

test("the recipe box is fetched from GitHub Pages once and cached", async () => {
  await tool("get_family_profile");
  await tool("get_pantry");
  const catalogs = w.fetches.filter((u) => u.endsWith("/data/catalog.json"));
  assert.equal(catalogs.length, 1);
  assert.ok(w.fetches.every((u) => u.startsWith("https://blufoxmobile.github.io/Bilbrey-Family-Dinner-Planner/data/")));
});

// ── tools ────────────────────────────────────────────────────────────────────────────────────
test("get_family_profile: people, stores, house rules and budget", async () => {
  const { data, isError } = await tool("get_family_profile");
  assert.equal(isError, false);
  assert.deepEqual(data.people.map((p) => p.name), ["Jeff", "Candi", "Knox", "Jordan", "Jackson"]);
  assert.equal(data.today, today);
  assert.match(data.stores.jewel.address, /Roosevelt/);
  assert.match(data.stores.sams.address, /Addison/);
  const rules = data.houseRules.join(" ");
  for (const word of ["oven", "tofu", "snow crab", "Caesar", "cucumbers", "organic", "Cool Ranch Doritos"]) assert.ok(rules.includes(word), word);
  assert.equal(data.budget.monthlyTarget, 650);
  assert.ok(data.equipment.includes("NO oven"));
});

test("update_pantry counts packages with the package size; get_pantry reads them back", async () => {
  const rev0 = await revision();
  const per = packageOf(db, {}, "marinara").per;
  const r = await tool("update_pantry", {
    items: [
      { name: "Rao's Homemade Marinara Sauce jar", packages: 2, place: "pantry", label: "Rao's Homemade Marinara Sauce" },
      { id: "chicken", qty: 3, unit: "lb", place: "freezer" },
      { name: "spaghetti", packages: 1.5 },
      { name: "green beans", packages: 3 },
      { name: "table salt", low: true },
      { id: "no-such-thing", packages: 1 },
    ],
  });
  assert.equal(r.isError, false, r.text);
  const byId = Object.fromEntries(r.data.saved.map((s) => [s.id, s]));
  assert.equal(byId.marinara.qty, 2 * per);
  assert.equal(byId.marinara.matchedBy, "guess");
  assert.match(byId.marinara.packages, /^2 jars?$/);
  assert.equal(byId.chicken.qty, 3);
  assert.equal(byId.spaghetti.qty, 1.5 * packageOf(db, {}, "spaghetti").per);
  assert.equal(byId.salt.low, true);
  assert.equal(r.data.notSaved.length, 2);
  const beans = r.data.notSaved.find((x) => x.item === "green beans");
  assert.deepEqual(beans.candidates.map((c) => c.id).sort(), ["freshGreenBeans", "greenBeans"]);
  assert.equal(r.data.revision, rev0 + 1, "one atomic write for the whole batch");

  const s = (await getState()).json;
  assert.equal(s.updatedBy, "Family (Claude chat)");
  assert.equal(s.state.pantry.marinara.qty, 2 * per);
  assert.equal(s.state.pantry.marinara.place, "pantry");
  assert.equal(s.state.pantry.marinara.label, "Rao's Homemade Marinara Sauce");
  assert.equal(s.state.pantry.marinara.by, "Family (Claude chat)");
  assert.equal(s.state.pantry.chicken.place, "freezer");
  assert.equal(s.state.pantry.salt.low, true);

  // add more, pick the right green beans, make a new shelf item, and use something up
  const r2 = await tool("update_pantry", {
    items: [
      { id: "marinara", packages: 1, mode: "add" },
      { id: "greenBeans", packages: 3 },
      { name: "Trader Joe's Mandarin Orange Chicken", packages: 2, unit: "bags", place: "freezer", newItem: true },
      { id: "spaghetti", remove: true },
    ],
  });
  assert.equal(r2.isError, false, r2.text);
  const s2 = (await getState()).json.state;
  assert.equal(s2.pantry.marinara.qty, 3 * per);
  assert.equal(s2.pantry.greenBeans.qty, 3);
  assert.equal(s2.pantry.spaghetti, undefined);
  const tj = Object.entries(s2.custom).find(([, c]) => c.name === "Trader Joe's Mandarin Orange Chicken");
  assert.ok(tj, "a new shelf item");
  assert.equal(tj[1].unit, "bags");
  assert.equal(tj[1].storage, "freezer");
  assert.equal(s2.pantry[tj[0]].qty, 2);

  const p = await tool("get_pantry");
  const rows = Object.fromEntries(p.data.items.map((x) => [x.id, x]));
  assert.equal(rows.marinara.qty, 3 * per);
  assert.equal(rows.marinara.unit, "oz");
  assert.match(rows.marinara.packages, /^3 jars/);
  assert.equal(rows.marinara.place, "pantry");
  assert.equal(rows.chicken.place, "freezer");
  assert.equal(rows.chicken.kind, "Meat & protein");
  assert.ok(rows.chicken.useBy && Number.isInteger(rows.chicken.daysLeft));
  assert.equal(rows.salt.low, true);
  assert.ok(p.data.runningLow.includes("Table salt"));
  assert.equal(rows.spaghetti, undefined);
  assert.equal(rows[tj[0]].shelfItem, true);

  const fridge = await tool("get_pantry", { place: "freezer" });
  assert.ok(fridge.data.items.every((x) => x.place === "freezer"));
});

test("update_pantry refuses amounts it can't convert and saves nothing for them", async () => {
  const rev0 = await revision();
  const r = await tool("update_pantry", { items: [{ id: "chicken", qty: 2, unit: "cups" }] });
  assert.equal(r.isError, false);
  assert.equal(r.data.saved.length, 0);
  assert.match(r.data.notSaved[0].reason, /lb/);
  assert.equal(await revision(), rev0);
});

test("add_receipt imports like the app, fills the pantry, and never saves the same receipt twice", async () => {
  const before = (await getState()).json;
  const marinaraBefore = before.state.pantry.marinara.qty;
  const receipt = {
    store: "jewel",
    date: addDays(today, -1),
    total: 29.46,
    lines: [
      { product: "Rao's Homemade Marinara Sauce", size: "24 oz", qty: 2, lineTotal: 15.98, discount: 2 },
      { product: "Signature Farms Boneless Skinless Chicken Breast", size: "2.5 lb", lineTotal: 9.49 },
      { product: "Jewel bakery cookies", lineTotal: 3.99 },
    ],
  };
  const dry = await tool("add_receipt", { ...receipt, dryRun: true });
  assert.equal(dry.isError, false, dry.text);
  assert.equal(dry.data.saved, false);
  assert.deepEqual(dry.data.matched.map((m) => m.matchId), ["marinara", "chicken"]);
  assert.deepEqual(dry.data.unmatched.map((m) => m.product), ["Jewel bakery cookies"]);
  assert.equal(await revision(), before.revision, "a dry run saves nothing");

  const r = await tool("add_receipt", receipt);
  assert.equal(r.isError, false, r.text);
  assert.equal(r.data.saved, true);
  assert.equal(r.data.countedInBudget, true);
  assert.equal(r.data.pricesLearned, 2);
  const s = (await getState()).json;
  const id = r.data.receiptId;
  assert.equal(s.state.receiptLog[id].store, "jewel");
  assert.equal(s.state.receiptLog[id].lines.length, 3);
  assert.equal(s.state.receiptLog[id].by, "Family (Claude chat)");
  assert.ok(s.state.receiptLog[id].pantry, "the receipt is marked as synced to the pantry");
  const budget = s.state.receipts.filter((x) => x.receiptId === id);
  assert.equal(budget.length, 1);
  assert.equal(budget[0].amount, 29.46);
  assert.equal(budget[0].note, "Added from a Claude chat");
  assert.equal(s.state.myProducts["jewel/marinara"].price, 6.99);
  assert.equal(s.state.myProducts["jewel/marinara"].packSize, 24);
  assert.equal(s.state.pantry.marinara.qty, marinaraBefore + 48);
  assert.equal(s.state.pantry.marinara.place, "pantry", "the pantry keeps where it's kept");

  const again = await tool("add_receipt", receipt);
  assert.equal(again.isError, false);
  assert.equal(again.data.duplicate, true);
  assert.equal(again.data.saved, false);
  assert.equal(await revision(), s.revision, "a duplicate changes nothing");

  const bad = await tool("add_receipt", { ...receipt, store: "costco" });
  assert.equal(bad.isError, true);
  const badId = await tool("add_receipt", { ...receipt, total: 1.23, lines: [{ product: "Milk", lineTotal: 1.23, matchId: "not-an-id" }] });
  assert.equal(badId.isError, true);
  assert.match(badId.text, /not-an-id/);
});

test("list_recipes: the box, a query, one recipe in full, and what's makeable now", async () => {
  const all = await tool("list_recipes");
  assert.equal(all.isError, false);
  assert.ok(all.data.dinners.length >= 80);
  assert.ok(all.data.sides.length >= 30);
  const bbs = all.data.dinners.find((d) => d.id === "brown-butter-spaghetti");
  assert.equal(bbs.status, "rotation");
  assert.equal(bbs.sides.length, 2);
  assert.ok(bbs.perPlate.kcal > 0);

  const q = await tool("list_recipes", { query: "spaghetti", include: "dinners" });
  const ids = q.data.dinners.map((d) => d.id);
  assert.ok(ids.includes("brown-butter-spaghetti") && ids.includes("classic-spaghetti"), ids.join());
  assert.ok(!ids.includes("smashburgers"));
  assert.ok(q.data.dinners.every((d) => d.subtitle), "short lists keep the subtitles");
  assert.equal(q.data.sides, undefined);

  const one = await tool("list_recipes", { id: "brown-butter-spaghetti" });
  assert.equal(one.data.dinner.id, "brown-butter-spaghetti");
  assert.ok(one.data.dinner.ingredients.some((i) => i.id === "spaghetti" && i.unit === "oz"));
  assert.ok(one.data.dinner.steps.length > 2);
  assert.equal(one.data.dinner.sideDetails.length, 2);
  const side = await tool("list_recipes", { id: "steamed-broccoli" });
  assert.equal(side.data.side.id, "steamed-broccoli");
  assert.equal((await tool("list_recipes", { id: "nope" })).isError, true);

  // Stock everything one dinner needs, and it shows up as makeable tonight.
  const target = db.dinners["brown-butter-spaghetti"];
  const needs = { ...target.items };
  for (const sid of target.sides) for (const [id, q2] of Object.entries(db.sides[sid].items)) needs[id] = (needs[id] || 0) + q2;
  const items = Object.entries(needs).map(([id, qty]) => (db.ingredients[id].kind === "staple" ? { id, packages: 1 } : { id, qty: qty * 2 }));
  const up = await tool("update_pantry", { items });
  assert.equal(up.data.notSaved.length, 0, JSON.stringify(up.data.notSaved));
  const m = await tool("list_recipes", { makeableNow: true });
  assert.ok(m.data.makeableNow.some((d) => d.id === "brown-butter-spaghetti"), JSON.stringify(m.data.makeableNow.map((d) => d.id)));
  assert.ok(Array.isArray(m.data.almost));
  assert.ok(m.data.almost.every((d) => d.missing.length >= 1 && d.missing.length <= 2));
});

test("plan_dinner puts a recipe-box dinner on a night; get_plan shows it", async () => {
  const date = addDays(today, 2);
  const r = await tool("plan_dinner", { date, dinnerId: "brown-butter-spaghetti" });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.data.dinner.id, "brown-butter-spaghetti");
  const s = (await getState()).json.state;
  assert.equal(s.plan[date].dinner, "brown-butter-spaghetti");
  assert.equal(s.plan[date].status, "planned");
  assert.equal(s.plan[date].manual, true);
  assert.equal(s.plan[date].by, "Family (Claude chat)");

  const plan = await tool("get_plan", { from: today, to: addDays(today, 6) });
  assert.equal(plan.data.nights.length, 7);
  const night = plan.data.nights.find((n) => n.date === date);
  assert.equal(night.status, "planned");
  assert.equal(night.dinner.title, db.dinners["brown-butter-spaghetti"].title);
  assert.equal(night.sides.length, 2);
  assert.ok(!plan.data.openNights.includes(date));
  assert.equal((await tool("get_plan", { from: today, to: addDays(today, 100) })).isError, true);

  const missing = await tool("plan_dinner", { date, dinnerId: "not-a-dinner" });
  assert.equal(missing.isError, true);
  const both = await tool("plan_dinner", { date });
  assert.equal(both.isError, true);
});

const RECIPE = {
  title: "Air fryer ranch chicken bites",
  subtitle: "Crispy bite-size chicken with a ranch kick.",
  category: "Comfort",
  protein: "chicken",
  minutes: 30,
  equipment: ["air fryer"],
  items: [
    { id: "chicken", name: "Boneless chicken breast", qty: 2.5, unit: "lb" },
    { name: "Hidden Valley ranch seasoning packet", qty: 1, unit: "packet", newItem: true },
  ],
  sides: ["steamed-broccoli", "apple-slices"],
  steps: [
    "Cut the chicken into 1-inch bites and toss with the ranch seasoning and a little oil.",
    "Air fry at 400°F for 12–14 minutes, shaking halfway, until the chicken reaches 165°F.",
  ],
};

test("plan_dinner saves a new recipe as a one-off custom dinner and plans it", async () => {
  const date = addDays(today, 3);
  const r = await tool("plan_dinner", { date, recipe: RECIPE });
  assert.equal(r.isError, false, r.text);
  const id = r.data.recipe.id;
  assert.equal(id, "custom-dinner-air-fryer-ranch-chicken-bites");
  assert.equal(r.data.recipe.rotation, "one-off");
  assert.deepEqual(r.data.sides, [db.sides["steamed-broccoli"].title, db.sides["apple-slices"].title]);

  const state = (await getState()).json.state;
  const c = state.customDinners[id];
  assert.equal(c.title, RECIPE.title);
  assert.equal(c.rotation, "bench");
  assert.equal(c.items.chicken, 2.5);
  assert.deepEqual(c.sides, RECIPE.sides);
  assert.equal(c.sideSlots, 2);
  const seasoning = Object.keys(c.items).find((k) => k.startsWith("custom-"));
  assert.equal(state.custom[seasoning].name, "Hidden Valley ranch seasoning packet");
  assert.deepEqual(
    { dinner: state.plan[date].dinner, status: state.plan[date].status, manual: state.plan[date].manual, by: state.plan[date].by },
    { dinner: id, status: "planned", manual: true, by: "Family (Claude chat)" },
  );
  // The app reads it like any dinner, but a one-off stays out of the automatic rotation.
  assert.ok(allDinners(db, state).some((d) => d.id === id && d.custom));
  assert.ok(!rotationList(db, state).some((d) => d.id === id));

  const keep = await tool("plan_dinner", { date: addDays(today, 10), recipe: RECIPE, saveToRecipeBox: true });
  assert.equal(keep.isError, false, keep.text);
  assert.equal(keep.data.recipe.id, id, "the same title updates the custom dinner");
  assert.equal(keep.data.recipe.updated, true);
  const state2 = (await getState()).json.state;
  assert.equal(state2.customDinners[id].rotation, "core");
  assert.ok(rotationList(db, state2).some((d) => d.id === id));
  // It was already planned on another night, so (as in the app) it moves to the new night.
  assert.equal(state2.plan[addDays(today, 10)].dinner, id);
  assert.equal(state2.plan[date], undefined);
});

test("plan_dinner refuses recipes that break the house rules, and saves nothing", async () => {
  const rev0 = await revision();
  const date = addDays(today, 4);
  const cases = [
    [{ steps: ["Preheat the oven to 400°F and bake the chicken until it reaches 165°F."] }, /oven/],
    [{ title: "Shrimp and chicken skewers" }, /shrimp/],
    [{ title: "Chicken Caesar wraps" }, /Caesar/],
    [{ items: [...RECIPE.items, { name: "Firm tofu", qty: 1, unit: "lb", newItem: true }] }, /tofu/],
    [{ steps: [...RECIPE.steps, "Top with diced red onion and sliced tomatoes."] }, /raw onion.*raw tomato/],
    [{ items: [...RECIPE.items, { name: "English cucumber", qty: 1, unit: "each", newItem: true }] }, /cucumber/],
    [{ steps: ["Air fry the chicken bites until crisp and golden."] }, /165°F/],
    [{ equipment: ["oven"] }, /oven/],
    [{ items: [{ name: "Spaghetti squash", qty: 2, unit: "each", newItem: true }], protein: "mixed", title: "Spaghetti squash bowls" }, /meat/],
    [{ sides: ["steamed-broccoli"] }, /two different sides/],
    [{ sides: ["steamed-broccoli", "no-such-side"] }, /no-such-side/],
  ];
  for (const [change, why] of cases) {
    const r = await tool("plan_dinner", { date, recipe: { ...RECIPE, title: `Test ${nextId}`, ...change } });
    assert.equal(r.isError, true, `${JSON.stringify(change)} → ${r.text}`);
    assert.match(r.text, why, r.text);
  }
  assert.equal(await revision(), rev0, "nothing was saved");

  // Cooked onions are fine; the one seafood exception is a snow crab boil.
  const onions = await tool("plan_dinner", {
    date, recipe: { ...RECIPE, title: "Ranch chicken with onions", steps: [...RECIPE.steps, "Sauté the diced onion in butter until soft and golden, then spoon over."] },
  });
  assert.equal(onions.isError, false, onions.text);
  const crab = await tool("plan_dinner", {
    date: addDays(today, 5),
    recipe: {
      title: "Snow crab boil", category: "Comfort", protein: "sausage", minutes: 40, equipment: ["stovetop"],
      items: [{ name: "snow crab legs", qty: 3, unit: "lb" }, { id: "smokedSausage", name: "Smoked sausage", qty: 1, unit: "lb" }, { id: "oldBay", name: "Old Bay", qty: 3, unit: "tbsp" }],
      sides: ["corn-on-the-cob", "garlic-toast"],
      steps: ["Boil a big pot of water with the Old Bay and simmer the sliced sausage until hot, 165°F.", "Add the snow crab legs and boil 5 minutes until heated through."],
    },
  });
  assert.equal(crab.isError, false, crab.text);
});

test("get_shopping_list: items by store with packs, prices and totals", async () => {
  const r = await tool("get_shopping_list", { from: today, to: addDays(today, 6) });
  assert.equal(r.isError, false, r.text);
  const d = r.data;
  assert.equal(d.from, today);
  assert.equal(d.to, addDays(today, 6));
  assert.ok(d.dinners >= 3);
  assert.equal(typeof d.total, "number");
  const stores = Object.keys(d.stores);
  assert.ok(stores.length >= 1 && stores.every((s) => s === "jewel" || s === "sams"));
  let sum = 0;
  for (const s of stores) {
    const part = d.stores[s];
    assert.equal(typeof part.subtotal, "number");
    for (const it of part.items) {
      assert.equal(typeof it.name, "string");
      assert.equal(typeof it.buy, "string");
      assert.ok(Array.isArray(it.for));
    }
    sum += part.subtotal;
  }
  assert.equal(Math.round(sum * 100), Math.round(d.total * 100));
  // The snow crab legs are a new shelf item, so they're on the list (unpriced until a receipt).
  assert.ok(Object.values(d.stores).some((p) => p.items.some((i) => i.name === "snow crab legs")));

  const jewel = await tool("get_shopping_list", { from: today, to: addDays(today, 6), store: "jewel" });
  assert.equal(jewel.data.planFrom, "jewel");
  const now = await tool("get_shopping_list");
  assert.equal(now.isError, false);
  assert.ok(now.data.from && now.data.to);
});

test("a recipe box that can't be loaded is a tool error, not a crash", async () => {
  const w2 = await startWorker({ ai: false });
  try {
    w2.setOutbound(() => new Response("down", { status: 503 }));
    assert.equal((await w2.call("/api/setup", { method: "POST", body: { key: KEY } })).status, 201);
    const path = new URL((await w2.call("/api/mcp/link", { key: KEY })).json.url).pathname;
    const r = await w2.call(path, { method: "POST", origin: null, body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_pantry", arguments: {} } } });
    assert.equal(r.status, 200);
    assert.equal(r.json.result.isError, true);
    assert.match(r.json.result.content[0].text, /couldn't load/);
    // initialize and tools/list don't need the data at all
    const i = await w2.call(path, { method: "POST", origin: null, body: { jsonrpc: "2.0", id: 2, method: "tools/list" } });
    assert.equal(i.json.result.tools.length, 10);
  } finally {
    await w2.dispose();
  }
});
