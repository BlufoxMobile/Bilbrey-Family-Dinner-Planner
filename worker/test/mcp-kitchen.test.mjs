// docs/spec/23: the Claude chat connector knows the kitchen. One shared family profile, the Ninja
// PossibleCooker, lean dinners with a vegetable; get_use_first (what to eat soon), get_health_summary
// (calories, protein, vegetables); and recipes with prep / cook times, timed steps and tips.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startWorker, familyKey } from "./helpers.mjs";
import { todayISO, addDays } from "../../app/util.js";
import { recipeProblems, TOOL_LIST, MCP_BY } from "../src/mcp.js";

const KEY = familyKey("supper for five");
const today = todayISO();
let w;
let mcpPath;
let nextId = 1;

const rpc = (method, params) => w.call(mcpPath, { method: "POST", origin: null, body: { jsonrpc: "2.0", id: nextId++, method, ...(params === undefined ? {} : { params }) } });
async function tool(name, args = {}) {
  const r = await rpc("tools/call", { name, arguments: args });
  assert.equal(r.status, 200, r.text);
  const res = r.json.result;
  const text = res.content[0].text;
  return { isError: res.isError === true, text, data: res.isError ? null : JSON.parse(text) };
}
const ops = (list) => w.call("/api/ops", { method: "POST", key: KEY, body: { ops: list, by: "Candi", clientId: "phone" } });
const state = async () => (await w.call("/api/state", { key: KEY })).json;

before(async () => {
  w = await startWorker();
  assert.equal((await w.call("/api/setup", { method: "POST", body: { key: KEY } })).status, 201);
  mcpPath = new URL((await w.call("/api/mcp/link", { key: KEY })).json.url).pathname;
});
after(async () => {
  await w.dispose();
});

test("the instructions and the profile: one shared family profile, the PossibleCooker, lean dinners with a vegetable", async () => {
  assert.equal(MCP_BY, "Family (Claude chat)");
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
  const text = init.json.result.instructions;
  for (const re of [/shares one profile/, /Family \(Claude chat\)/, /PossibleCooker Pro 6\.5 qt/, /"possible cooker"/, /slow cook, sear\/sauté, braise, steam, rice, keep warm/,
    /lean and high in protein with a vegetable/, /never set a calorie\s+target/, /never call a food good or bad/, /never the oven/, /get_use_first/]) assert.match(text, re);

  const p = (await tool("get_family_profile")).data;
  assert.match(p.profile, /One shared family profile/);
  assert.equal(p.people.length, 5);
  assert.equal(p.goals.length, 3);
  assert.match(p.goals.join(" "), /Save money.*Waste less.*Eat lighter/s);
  assert.ok(p.equipment.includes("NO oven"));
  assert.ok(p.equipment.some((e) => /PossibleCooker Pro, 6\.5 qt \(MC1101\)/.test(e)));
  assert.ok(p.equipmentIds.includes("possible cooker") && p.equipmentIds.includes("blackstone"));
  assert.deepEqual(p.possibleCooker.usedFor, ["slow cook", "sear/sauté", "braise", "steam", "rice", "keep warm"]);
  assert.ok(p.houseRules.some((r) => /Lean, high-protein dinners with a vegetable/.test(r)));
  assert.ok(p.houseRules.some((r) => /never set a calorie target/.test(r)));

  const names = TOOL_LIST.map((t) => t.name);
  assert.ok(names.includes("get_use_first") && names.includes("get_health_summary"));
  assert.ok(!names.includes("log_waste"), "no waste log in the family state yet, so no tool that writes one");
  const plan = TOOL_LIST.find((t) => t.name === "plan_dinner");
  assert.ok(plan.inputSchema.properties.recipe.properties.equipment.items.enum.includes("possible cooker"));
  assert.ok(plan.inputSchema.properties.recipe.properties.prepMinutes && plan.inputSchema.properties.recipe.properties.tips);
});

test("get_use_first: the soonest food first, with the dinners that would use it", async () => {
  const empty = (await tool("get_use_first")).data;
  assert.equal(empty.count, 0);
  assert.match(empty.note, /Nothing at home needs using up/);

  assert.equal((await ops([
    { op: "set", path: ["pantry", "chicken"], value: { qty: 3, stocked: false, place: "fridge", since: addDays(today, -3), at: `${addDays(today, -3)}T18:00:00.000Z`, by: "Candi" } },
    { op: "set", path: ["pantry", "beef"], value: { qty: 2, stocked: false, place: "fridge", since: today, at: `${today}T12:00:00.000Z`, by: "Candi" } },
    { op: "set", path: ["pantry", "pork"], value: { qty: 4, stocked: false, place: "freezer", since: addDays(today, -100), at: `${addDays(today, -100)}T12:00:00.000Z`, by: "Jeff" } },
    { op: "set", path: ["pantry", "jasmine"], value: { qty: 10, stocked: false, since: addDays(today, -200), at: `${addDays(today, -200)}T12:00:00.000Z`, by: "Jeff" } },
  ])).status, 200);

  const d = (await tool("get_use_first")).data;
  assert.deepEqual(d.useFirst.map((u) => u.id), ["chicken", "beef", "pork"], "soonest first; rice keeps, so it isn't listed");
  const [chicken, beef, pork] = d.useFirst;
  assert.equal(chicken.daysLeft, -1);
  assert.match(chicken.when, /past its estimated use-by: check it before cooking/);
  assert.equal(chicken.place, "fridge");
  assert.match(chicken.amount, /^3 /);
  assert.equal(chicken.useBy, addDays(today, -1));
  assert.ok(chicken.dinners.length > 0 && chicken.dinners.length <= 6);
  for (const x of chicken.dinners) assert.deepEqual(Object.keys(x), ["id", "title", "minutes", "canCookNow"]);
  assert.equal(beef.daysLeft, 2);
  assert.equal(beef.when, "use within 2 days");
  assert.equal(pork.place, "freezer");
  assert.equal(pork.daysLeft, 20);
  assert.deepEqual(d.notInAnyPlannedDinner.sort(), [chicken.name, beef.name, pork.name].sort());

  // Plan a chicken dinner for tomorrow: the chicken is spoken for.
  const dinner = chicken.dinners[0].id;
  assert.equal((await tool("plan_dinner", { date: addDays(today, 1), dinnerId: dinner })).isError, false);
  const after = (await tool("get_use_first", { days: 1 })).data;
  assert.deepEqual(after.useFirst.find((u) => u.id === "chicken").plannedFor, [addDays(today, 1)]);
  assert.ok(!after.useFirst.some((u) => u.id === "beef"), "days: 1 looks one day ahead for the fridge");
  assert.ok(after.useFirst.some((u) => u.id === "pork"), "the freezer is always looked at a month ahead");
  assert.ok(!after.notInAnyPlannedDinner.includes(chicken.name));

  for (const bad of [{ days: -1 }, { days: 31 }, { days: 2.5 }, { days: "3" }]) assert.equal((await tool("get_use_first", bad)).isError, true);
});

test("get_health_summary: calories and protein per plate, and which dinners have no vegetable", async () => {
  const recipes = (await tool("list_recipes", { include: "dinners" })).data.dinners.filter((x) => x.status === "rotation" && x.perPlate);
  assert.ok(recipes.length >= 3);
  const [a, b, c] = recipes;
  assert.equal((await ops([
    { op: "set", path: ["plan", addDays(today, 2)], value: { dinner: a.id, status: "planned", by: "Candi", at: "x" } },
    { op: "set", path: ["plan", addDays(today, 3)], value: { dinner: b.id, status: "planned", by: "Candi", at: "x" } },
    { op: "set", path: ["plan", addDays(today, -2)], value: { dinner: c.id, status: "cooked", by: "Candi", at: "x" } },
    { op: "set", path: ["plan", addDays(today, 4)], value: { status: "away", away: { reason: "Date night" } } },
  ])).status, 200);
  const h = (await tool("get_health_summary")).data;
  assert.equal(h.from, addDays(today, -7));
  assert.equal(h.to, addDays(today, 7));
  assert.equal(h.dinners, 4, "three set here and the chicken dinner planned above; the night out isn't a dinner");
  const night = h.nights.find((n) => n.date === addDays(today, 2));
  assert.deepEqual({ dinner: night.dinner, status: night.status, kcal: night.kcal, proteinG: night.proteinG }, { dinner: a.title, status: "planned", kcal: a.perPlate.kcal, proteinG: a.perPlate.proteinG });
  assert.equal(h.nights.find((n) => n.date === addDays(today, -2)).status, "cooked");
  assert.ok(h.perPlate.averageKcal > 100 && h.perPlate.averageProteinG > 5);
  assert.equal(h.perPlate.countedDinners, h.nights.filter((n) => typeof n.kcal === "number").length);
  assert.ok(h.lightest.kcal <= h.heaviest.kcal);
  assert.ok(h.mostProtein.proteinG >= h.lightest.proteinG);
  assert.equal(h.vegetables.plannedDinners, h.vegetables.withAVegetableOrSalad + h.vegetables.without.length);
  // One lean rule everywhere: the app's (750 calories or less with 35 g of protein or more).
  assert.match(h.leanMeans, /750 calories or less with at least 35 g of protein/);
  for (const n of h.nights.filter((x) => typeof x.kcal === "number")) {
    if (n.lean) assert.ok(n.kcal <= 750 && n.proteinG >= 35, `${n.dinner}: ${n.kcal} kcal, ${n.proteinG} g`);
    assert.ok(typeof n.vegetableServings === "number");
  }
  assert.equal(h.perPlate.leanDinners, h.nights.filter((x) => x.lean).length);
  for (const g of h.vegetables.without) assert.match(g.suggestion, /vegetable/);
  assert.match(h.note, /no calorie targets/);
  assert.doesNotMatch(JSON.stringify(h), /\b(bad|unhealthy|junk|guilt|cheat|diet)\b/i, "numbers and facts, no labels");

  const one = (await tool("get_health_summary", { from: addDays(today, 2), to: addDays(today, 2) })).data;
  assert.equal(one.dinners, 1);
  assert.equal(one.lightest, undefined, "nothing to compare with one dinner");
  assert.equal((await tool("get_health_summary", { from: "soon" })).isError, true);
});

test("plan_dinner: a PossibleCooker recipe with prep and cook times, timed steps and tips", async () => {
  const sides = (await tool("list_recipes", { include: "sides" })).data.sides;
  const veg = sides.find((s) => s.kind === "vegetable").id;
  const starches = sides.filter((s) => s.kind === "starch").map((s) => s.id);
  const date = addDays(today, 5);
  const recipe = {
    title: "Slow-cooked salsa chicken",
    subtitle: "Pulled chicken breast in jarred salsa.",
    category: "Tex-Mex",
    protein: "chicken",
    minutes: 495,
    prepMinutes: 15,
    cookMinutes: 480,
    equipment: ["possible cooker"],
    items: [{ id: "chicken", name: "Chicken breast", qty: 3, unit: "lb" }],
    sides: [veg, starches[0]],
    steps: [
      { text: "Sear the chicken in the PossibleCooker until golden.", minutes: 6, setting: "sear/sauté, high" },
      { text: "Pour the salsa over the chicken, cover, and slow cook until it reaches 165°F and pulls apart.", minutes: 480, setting: "slow cook, low" },
      "Shred the chicken with two forks and stir it back into the sauce.",
    ],
    tips: ["No oven needed: it all happens in one pot.", "Start it by 9 am for a 5:30 dinner; it holds on keep warm."],
  };
  const r = await tool("plan_dinner", { date, recipe });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.data.notes, undefined, "a vegetable side and no frying: nothing to mention");
  const saved = (await state()).state.customDinners[r.data.recipe.id];
  assert.equal(saved.by, "Family (Claude chat)");
  assert.deepEqual(saved.equipment, ["possible cooker"]);
  assert.deepEqual([saved.minutes, saved.prepMinutes, saved.cookMinutes], [495, 15, 480]);
  assert.deepEqual(saved.steps, recipe.steps.map((s) => (typeof s === "string" ? s : s.text)), "steps stay plain sentences for the app's recipe pages");
  assert.deepEqual(saved.stepDetails, [recipe.steps[0], recipe.steps[1], { text: recipe.steps[2] }]);
  assert.deepEqual(saved.tips, recipe.tips);
  assert.equal((await state()).state.plan[date].by, "Family (Claude chat)");
  assert.equal((await state()).updatedBy, "Family (Claude chat)");
  // The full recipe reads back through list_recipes.
  const back = (await tool("list_recipes", { id: r.data.recipe.id })).data.dinner;
  assert.deepEqual(back.equipment, ["possible cooker"]);
  assert.equal(back.minutes, 495);

  // How the family wants to eat is said, not enforced: two starches and deep-frying get a note each.
  const fried = await tool("plan_dinner", { date: addDays(today, 6), recipe: { ...recipe, title: "Fried chicken strips", equipment: ["stovetop"], minutes: 40, prepMinutes: undefined, cookMinutes: undefined, sides: starches.slice(0, 2), tips: [],
    steps: ["Deep-fry the chicken strips in batches until they reach 165°F.", "Drain them on a rack and serve hot."] } });
  assert.equal(fried.isError, false, fried.text);
  assert.equal(fried.data.notes.length, 2);
  assert.match(fried.data.notes.join(" "), /Neither side is a vegetable or a salad/);
  assert.match(fried.data.notes.join(" "), /cutting back on frying/);

  // The house rules still refuse: the oven in a tip or a setting, an oven as equipment, too long a cook.
  for (const [change, re] of [
    [{ tips: ["Finish it under the broiler for a crisp top."] }, /the broiler/],
    [{ steps: [{ text: "Cook the chicken until it reaches 165°F all the way through.", setting: "bake in the oven at 400°F" }] }, /oven/],
    [{ equipment: ["oven"] }, /can't cook with oven/],
    [{ equipment: ["slow cooker"] }, /Equipment must be from:.*possible cooker/],
    [{ minutes: 900 }, /at most 720/],
    [{ prepMinutes: -5 }, /prepMinutes/],
    [{ steps: [{ minutes: 10 }] }, /recipe\.steps/],
  ]) {
    const bad = await tool("plan_dinner", { date: addDays(today, 7), recipe: { ...recipe, title: "Another chicken dinner", ...change } });
    assert.equal(bad.isError, true, JSON.stringify(change));
    assert.match(bad.text, re);
  }
  assert.equal((await state()).state.plan[addDays(today, 7)], undefined, "nothing was saved for the refused ones");
});

test("recipeProblems: \"no oven needed\" is not the oven; the oven is", () => {
  const base = { title: "Chicken", steps: ["Cook the chicken to 165°F in the PossibleCooker."], itemIds: ["chicken"], itemNames: ["Chicken"], meat: true };
  assert.deepEqual(recipeProblems({ ...base, steps: [...base.steps, "No oven needed.", "Use the air fryer instead of the oven."] }), []);
  assert.deepEqual(recipeProblems({ ...base, steps: [...base.steps, "Then bake in the oven."] }), ["it uses the oven", "it uses baking in an oven"]);
});

test("get_family_profile: lunch packers are whoever the family lists (docs/spec/20), not a fixed five", async () => {
  let p = (await tool("get_family_profile")).data;
  assert.deepEqual(p.lunchPackers.map((x) => x.name), ["Jeff", "Knox"]);
  assert.deepEqual(p.people.filter((x) => x.packsLunch).map((x) => x.name), ["Jeff", "Knox"]);
  assert.ok(p.lunchPackers.every((x) => x.lunchDays.length > 0 && !x.paused));

  // Someone new is added on the Lunch page, Knox is paused, and an old "off" record lists nobody.
  const r = await ops([
    { op: "set", path: ["lunch", "people", "Grandma"], value: { enabled: true, added: today, days: [1, 3], slots: {} } },
    { op: "set", path: ["lunch", "people", "Knox"], value: { enabled: false, paused: true } },
    { op: "set", path: ["lunch", "people", "Jordan"], value: { enabled: false } },
  ]);
  assert.equal(r.status, 200, r.text);
  p = (await tool("get_family_profile")).data;
  assert.deepEqual(p.lunchPackers.map((x) => x.name).sort(), ["Grandma", "Jeff", "Knox"]);
  assert.deepEqual(p.lunchPackers.find((x) => x.name === "Grandma").lunchDays, ["Monday", "Wednesday"]);
  assert.equal(p.lunchPackers.find((x) => x.name === "Knox").paused, true);
  assert.equal(p.people.length, 5, "the five who eat dinner are still the five");
  assert.equal(p.people.find((x) => x.name === "Knox").packsLunch, false);
  assert.equal(p.people.find((x) => x.name === "Jordan").packsLunch, false);
});

// docs/spec/24 §24.8: chicken over turkey, little pork, Sam's bulk cuts, and their safe temperatures.
test("recipeProblems: the new Sam's bulk meats must state their safe temperature", () => {
  const r = (ids, step) => recipeProblems({ title: "Dinner", steps: [step], itemIds: ids, itemNames: ids, meat: true });
  assert.deepEqual(r(["groundChicken"], "Brown the ground chicken to 165°F."), []);
  assert.match(r(["groundChicken"], "Brown the ground chicken until done.").join(" "), /165°F/);
  assert.deepEqual(r(["chickenSausage"], "Heat the chicken sausage through to 165°F."), []);
  assert.match(r(["chickenSausage"], "Warm the sausage.").join(" "), /165°F/);
  for (const id of ["sirloinTip", "stewMeat", "chuckRoast"]) {
    assert.deepEqual(r([id], "Sear the beef and cook to at least 145°F."), [], `${id}: 145°F is enough to pass`);
    assert.match(r([id], "Sear the beef until browned.").join(" "), /145°F/, `${id}: the temperature is required`);
  }
  // Beef tips and pot roast cook far past 145°F and never rest, so the rest is not demanded of whole-cut beef.
  assert.ok(!r(["stewMeat"], "Slow cook the beef tips until they fall apart, well past 145°F.").some((p) => /rest/.test(p)));
});

test("the house rules Claude is given: chicken over turkey, little pork, Sam's bulk cuts, Wish-Bone", async () => {
  const p = (await tool("get_family_profile")).data;
  const rules = JSON.stringify(p);
  for (const re of [/Chicken, not turkey/, /ground chicken where a recipe would use ground turkey/, /little pork/, /Sam's Club bulk packs/, /beef tips/, /sirloin tip and chuck roast/, /Ranch is Wish-Bone/]) assert.match(rules, re);
  assert.doesNotMatch(rules, /chicken, beef, pork, turkey/);
  const { IDEAS_SYSTEM_PROMPT, IDEAS_FORMAT_PROMPT } = await import("../src/claude.js");
  const sys = `${IDEAS_SYSTEM_PROMPT}\n${typeof IDEAS_FORMAT_PROMPT === "string" ? IDEAS_FORMAT_PROMPT : ""}`;
  for (const re of [/Chicken over turkey/, /never suggest a turkey dinner/, /little pork/, /Sam's Club bulk packs/, /beef tips \(stew meat\), sirloin tip and chuck roast/]) assert.match(sys, re);
  assert.doesNotMatch(sys, /ground turkey\)/);
  const plan = TOOL_LIST.find((t) => t.name === "plan_dinner");
  assert.match(plan.description, /prefers chicken to turkey and eats little pork/);
});
