// Claude (Anthropic Messages API) in the Worker — SPEC §14.
// Unit tests import src/claude.js directly; the rest run the real Worker in Miniflare with the
// Worker's outbound fetch to api.anthropic.com answered by a scriptable mock (test/helpers.mjs).
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startWorker, familyKey, claudeReply, PNG_DATA_URL, jpegDataUrl } from "./helpers.mjs";
import {
  MODELS, costUsd, pickModel, chicagoMonth, chicagoDate, extractJsonObject, imageBlock, callClaude, ClaudeError,
  validateIdeas, ideaBreaksRule, monthlyCap, ideasUserPrompt, systemText, cachedSystem, cleanStep, ideasReference, IDEAS_FORMAT_PROMPT, usageOf,
  PLAN_SYSTEM_PROMPT, planUserPrompt, validatePlan,
} from "../src/claude.js";

const TEST_KEY = "sk-ant-test-not-a-real-key";
const PRIMARY = "@cf/google/gemma-4-26b-a4b-it";
const KNOWN = [
  { id: "greenBeans", name: "Green beans", aliases: ["green beans", "cut green beans"] },
  { id: "spaghetti", name: "Spaghetti", aliases: [] },
  { id: "chicken", name: "Boneless skinless chicken breast", aliases: ["chicken breast", "chicken breasts"] },
];
// Everything Claude is told in words: the system prompt (now cached blocks) and the user message.
const claudeText = (body) => [systemText(body.system), ...body.messages[0].content.filter((b) => b.type === "text").map((b) => b.text)].join("\n");
const claudeImages = (body) => body.messages[0].content.filter((b) => b.type === "image");
// A plan request like app/smartplan.js builds: tonight kept, two open nights, one Claude may change.
const PLAN_REQ = {
  today: "2026-11-23", start: "2026-11-23", end: "2026-11-26", pantryFirst: true, lean: true,
  budget: { target: 650, spent: 554.6, daysLeft: 7 },
  nights: [
    { date: "2026-11-23", day: "Mon", plan: "keep", current: "tacos", note: "tonight" },
    { date: "2026-11-24", day: "Tue", plan: "open", current: null, busy: true },
    { date: "2026-11-25", day: "Wed", plan: "change", current: "chili", note: "planned before" },
    { date: "2026-11-26", day: "Thu", plan: "open", current: null },
  ],
  dinners: [
    { id: "tacos", title: "Chicken tacos", min: 25, protein: "chicken", cost: 2.1, toBuy: 0, kcal: 560, proteinG: 42, lean: true, heavy: false, ready: "all" },
    { id: "chili", title: "Beef chili", min: 45, protein: "beef", cost: 2.6, toBuy: 4.5, kcal: 640, proteinG: 38, lean: false, heavy: false, ready: "side", needs: ["Cornbread mix"] },
    { id: "stirfry", title: "Chicken stir-fry", min: 25, protein: "chicken", cost: 1.9, toBuy: 0, kcal: 520, proteinG: 45, lean: true, heavy: false, ready: "thaw", thawMin: 60, usesSoon: ["Broccoli"] },
    { id: "alfredo", title: "Deli chicken alfredo", min: 15, protein: "chicken", cost: 2.4, toBuy: 0, kcal: 720, proteinG: 36, lean: false, heavy: true, ready: "all", usesSoon: ["Chicken alfredo"], fav: true },
  ],
  useSoon: [{ name: "Broccoli", daysLeft: 2, where: "fridge" }],
  freezer: [{ name: "Chicken breast", qty: 6.2, unit: "lb", where: "freezer", since: "2026-11-22" }],
  recent: [{ date: "2026-11-20", id: "chili" }],
};
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg || ""} expected ${b}, got ${a}`);

// ═════════════════════════════════════════════════════════════════════════════════════════════
// src/claude.js on its own
// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("claude.js", () => {
  test("MODELS, pickModel and the default", () => {
    assert.deepEqual(MODELS.map((m) => [m.id, m.inUsd, m.outUsd]), [
      ["claude-opus-5-5", 4, 20],
      ["claude-sonnet-5-5", 2, 10],
      ["claude-haiku-5-5", 0.1, 0.5],
    ]);
    for (const m of MODELS) assert.equal(typeof m.label, "string");
    assert.equal(pickModel("claude-sonnet-5-5"), "claude-sonnet-5-5");
    assert.equal(pickModel(" claude-haiku-5-5 "), "claude-haiku-5-5");
    for (const bad of [undefined, null, "", "gpt-4o", "claude-opus-4-1", 42, {}]) assert.equal(pickModel(bad), "claude-opus-5-5");
  });

  test("usage accounting math: USD per million tokens, per model", () => {
    near(costUsd("claude-opus-5-5", { input_tokens: 1000, output_tokens: 500 }), 0.014, "opus 1k/500");
    near(costUsd("claude-sonnet-5-5", { input_tokens: 2_000_000, output_tokens: 1_000_000 }), 14, "sonnet 2M/1M");
    near(costUsd("claude-haiku-5-5", { input_tokens: 100_000, output_tokens: 1_000_000 }), 0.51, "haiku 100k/1M");
    near(costUsd("claude-haiku-5-5", { input_tokens: 100_001, output_tokens: 1000 }), (100_001 * 0.5 + 1000 * 2.5) / 1e6, "haiku prompt over 100K tokens: $0.50 / $2.50");
    near(costUsd("not-a-model", { input_tokens: 1000, output_tokens: 1000 }), 0.024, "unknown → opus prices");
    assert.equal(costUsd("claude-opus-5-5", {}), 0);
    assert.equal(costUsd("claude-opus-5-5", { input_tokens: -5, output_tokens: "x" }), 0);
  });

  test("monthlyCap: AI_MONTHLY_CAP_USD, default $5, 0 allowed, junk ignored", () => {
    assert.equal(monthlyCap({}), 5);
    assert.equal(monthlyCap({ AI_MONTHLY_CAP_USD: "12.5" }), 12.5);
    assert.equal(monthlyCap({ AI_MONTHLY_CAP_USD: 0 }), 0);
    assert.equal(monthlyCap({ AI_MONTHLY_CAP_USD: "lots" }), 5);
    assert.equal(monthlyCap({ AI_MONTHLY_CAP_USD: "-3" }), 5);
  });

  test("months are America/Chicago calendar months (CST and CDT edges)", () => {
    assert.equal(chicagoMonth(new Date("2026-12-01T05:59:00Z")), "2026-11", "11:59 PM Nov 30 in Glen Ellyn (CST)");
    assert.equal(chicagoMonth(new Date("2026-12-01T06:00:00Z")), "2026-12");
    assert.equal(chicagoMonth(new Date("2026-07-01T04:59:00Z")), "2026-06", "11:59 PM Jun 30 (CDT)");
    assert.equal(chicagoMonth(new Date("2026-07-01T05:00:00Z")), "2026-07");
    assert.equal(chicagoMonth(new Date("2027-01-01T05:30:00Z")), "2026-12", "New Year's Eve evening is still December");
    assert.equal(chicagoDate(new Date("2026-11-16T03:00:00Z")), "2026-11-15");
  });

  test("extractJsonObject: fences, prose, bare arrays, trailing commas, nothing", () => {
    assert.deepEqual(extractJsonObject('{"a":1}'), { a: 1 });
    assert.deepEqual(extractJsonObject('Here you go:\n```json\n{"ideas":[{"title":"X"}]}\n```\nEnjoy!'), { ideas: [{ title: "X" }] });
    assert.deepEqual(extractJsonObject('Sure! {"items":[{"name":"a"},{"name":"b"}]} Let me know.'), { items: [{ name: "a" }, { name: "b" }] });
    assert.deepEqual(extractJsonObject('[{"name":"a"},{"name":"b"}]'), [{ name: "a" }, { name: "b" }], "a bare array stays whole");
    assert.deepEqual(extractJsonObject('[Note] the answer: {"x":"a } in a string"}'), { x: "a } in a string" });
    assert.deepEqual(extractJsonObject('```\n{"a":[1,2,],}\n```'), { a: [1, 2] });
    assert.equal(extractJsonObject("I can't help with that."), undefined);
    assert.equal(extractJsonObject(""), undefined);
    assert.equal(extractJsonObject("42"), undefined);
  });

  test("imageBlock turns the app's data URLs into base64 image blocks", () => {
    const b = imageBlock(PNG_DATA_URL);
    assert.deepEqual(b, { type: "image", source: { type: "base64", media_type: "image/png", data: PNG_DATA_URL.split(",")[1] } });
    assert.equal(imageBlock("data:image/jpg;base64,QUJD").source.media_type, "image/jpeg");
    assert.throws(() => imageBlock("https://example.com/x.jpg"), ClaudeError);
  });

  test("callClaude: request shape, reply parsing, upstream errors, timeout, missing key", async () => {
    let seen;
    const ok = async (url, init) => {
      seen = { url, init, body: JSON.parse(init.body) };
      return new Response(JSON.stringify(claudeReply("hello", { input: 12, output: 3 })), { status: 200 });
    };
    const env = { ANTHROPIC_API_KEY: TEST_KEY };
    const r = await callClaude(env, { model: "claude-sonnet-5-5", system: "sys", content: [imageBlock(PNG_DATA_URL), { type: "text", text: "hi" }], maxTokens: 123, fetchImpl: ok });
    assert.deepEqual(r, { text: "hello", usage: { input_tokens: 12, output_tokens: 3 }, model: "claude-sonnet-5-5", stopReason: "end_turn" });
    assert.equal(seen.url, "https://api.anthropic.com/v1/messages");
    assert.equal(seen.init.method, "POST");
    assert.equal(seen.init.headers["x-api-key"], TEST_KEY);
    assert.equal(seen.init.headers["anthropic-version"], "2023-06-01");
    assert.equal(seen.init.headers["content-type"], "application/json");
    assert.deepEqual(Object.keys(seen.body).sort(), ["max_tokens", "messages", "model", "system"]);
    assert.equal(seen.body.model, "claude-sonnet-5-5");
    assert.equal(seen.body.max_tokens, 123);
    assert.equal(seen.body.system, "sys");
    assert.equal(seen.body.messages[0].role, "user");
    assert.equal(seen.body.messages[0].content[0].type, "image");

    const overloaded = async () => new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }), { status: 529 });
    await assert.rejects(callClaude(env, { content: "hi", fetchImpl: overloaded }), (e) => {
      assert.ok(e instanceof ClaudeError);
      assert.equal(e.status, 502);
      assert.equal(e.upstream, 529);
      assert.match(e.message, /529 overloaded_error: Overloaded/);
      assert.ok(!e.message.includes(TEST_KEY));
      return true;
    });

    const hang = (url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    await assert.rejects(callClaude(env, { content: "hi", timeoutMs: 30, fetchImpl: hang }), (e) => e instanceof ClaudeError && e.status === 502 && e.type === "timeout" && /longer than/.test(e.message));

    const offline = async () => {
      throw new TypeError("fetch failed");
    };
    await assert.rejects(callClaude(env, { content: "hi", fetchImpl: offline }), (e) => e instanceof ClaudeError && e.status === 502 && e.type === "network");

    const garbage = async () => new Response("<html>gateway</html>", { status: 200 });
    await assert.rejects(callClaude(env, { content: "hi", fetchImpl: garbage }), (e) => e instanceof ClaudeError && e.status === 502);

    await assert.rejects(callClaude({}, { content: "hi", fetchImpl: ok }), (e) => e instanceof ClaudeError && e.status === 503);
  });

  test("house rules: what an idea may and may not say", () => {
    const breaks = (parts) => ideaBreaksRule(parts);
    assert.equal(breaks({ prose: ["Crispy tofu stir-fry"] }), "tofu");
    assert.equal(breaks({ items: ["Shrimp"] }), "seafood");
    assert.equal(breaks({ prose: ["Season with fish sauce"] }), "seafood");
    assert.equal(breaks({ items: ["Worcestershire sauce"] }), "seafood");
    assert.equal(breaks({ prose: ["Grilled chicken Caesar wraps"] }), "Caesar");
    assert.equal(breaks({ items: ["English cucumber"] }), "raw cucumber");
    assert.equal(breaks({ prose: ["Top with diced red onion and cilantro."] }), "raw onion");
    assert.equal(breaks({ prose: ["Serve with pico de gallo."] }), "raw onion");
    assert.equal(breaks({ items: ["Cherry tomatoes"] }), "raw tomato");
    assert.equal(breaks({ prose: ["Add sliced tomato to each burger."] }), "raw tomato");
    assert.equal(breaks({ prose: ["Bake at 400°F for 20 minutes."] }), "oven");
    assert.equal(breaks({ prose: ["Preheat the oven."] }), "oven");
    assert.equal(breaks({ prose: ["Broil until bubbly."] }), "oven");
    assert.equal(breaks({ head: ["Bean bowls", "vegetarian"] }), "no meat");
    // Allowed
    assert.equal(breaks({ prose: ["Snow crab boil with Old Bay"], items: ["Snow crab clusters", "Old Bay seasoning"] }), null, "the occasional crab boil is fine");
    assert.equal(breaks({ prose: ["Saute the diced onion until soft."], items: ["Diced onion"] }), null, "cooked onion is fine");
    assert.equal(breaks({ prose: ["Simmer in crushed tomatoes and tomato sauce."], items: ["Diced tomatoes, canned"] }), null);
    assert.equal(breaks({ items: ["Dill pickle chips", "Baked beans", "Baking powder"], prose: ["Air fry the wings at 400°F."] }), null);
  });

  test("validateIdeas: drops rule-breakers, filters ids, clamps everything", () => {
    const sides = [
      { id: "steamed-broccoli", title: "Steamed broccoli", kind: "vegetable" },
      { id: "jasmine-rice-side", title: "Jasmine rice", kind: "starch" },
      { id: "corn", title: "Buttered sweet corn", kind: "vegetable" },
    ];
    const catalog = [{ id: "chicken", name: "Chicken breast", unit: "lb" }, { id: "soy", name: "Soy sauce", unit: "tbsp" }];
    const pantry = [{ id: "chicken", name: "Chicken breast", qty: 3, unit: "lb" }, { id: "custom-tj-rice", name: "TJ's Spanish rice", qty: 2, unit: "bag" }];
    const parsed = {
      ideas: [
        { title: "Shrimp fried rice", items: [{ name: "Shrimp", qty: 1, unit: "lb" }], sides: ["corn"], steps: ["Cook."] },
        {
          title: "  Teriyaki chicken   bowls  ",
          subtitle: "x".repeat(500),
          why: "Uses the chicken first.",
          minutes: 1000,
          equipment: ["Stovetop", "griddle", "microwave", "spaceship", "stove"],
          protein: "Chicken thighs",
          category: "Asian-inspired",
          items: [
            { name: "Chicken breast", qty: 2.256, unit: "lb", matchId: "chicken" },
            { name: "Soy sauce", qty: "3", unit: "tbsp", matchId: "soy-sauce-made-up" },
            "Garlic",
          ],
          sides: ["jasmine-rice-side", "made-up-side", "Steamed Broccoli", "corn"],
          steps: ["1. Slice the chicken.", "2) Cook on the stovetop to 165°F.", "", 42],
          usesPantry: ["chicken", "not-in-pantry", "chicken"],
          missing: [{ name: "Green onions", qty: 1, unit: "bunch", matchId: "nope" }],
        },
        { title: "Oven-baked ziti", protein: "beef", steps: ["Bake 30 minutes."] },
        { title: "Chicken Caesar salad", protein: "chicken" },
        { title: "Snow crab boil", protein: "crab", items: [{ name: "Snow crab clusters", qty: 4, unit: "lb" }], sides: [{ id: "corn" }] },
        { title: "Smash burgers", protein: "beef" },
        { title: "One too many", protein: "pork" },
      ],
    };
    const { ideas, dropped } = validateIdeas(parsed, { count: 3, sides, catalog, pantry });
    assert.deepEqual(ideas.map((i) => i.title), ["Teriyaki chicken bowls", "Snow crab boil", "Smash burgers"]);
    assert.deepEqual(dropped.map((d) => d.rule), ["seafood", "oven", "Caesar"]);
    const t = ideas[0];
    assert.equal(t.subtitle.length, 160);
    assert.equal(t.minutes, 240);
    assert.deepEqual(t.equipment, ["stovetop", "blackstone", "microwave"], "known equipment only, aliases mapped, no repeats");
    assert.equal(t.protein, "chicken");
    assert.deepEqual(t.items, [
      { name: "Chicken breast", qty: 2.26, unit: "lb", matchId: "chicken" },
      { name: "Soy sauce", qty: 3, unit: "tbsp", matchId: null },
      { name: "Garlic", qty: null, unit: null, matchId: null },
    ]);
    assert.deepEqual(t.sides, ["jasmine-rice-side", "steamed-broccoli"], "only the family's side ids, at most two, titles mapped to ids");
    assert.deepEqual(t.steps, ["Slice the chicken.", "Cook on the stovetop to 165°F."], "numbering stripped; empty and non-text steps dropped");
    assert.deepEqual(t.usesPantry, ["chicken"]);
    assert.deepEqual(t.missing, [{ name: "Green onions", qty: 1, unit: "bunch", matchId: null }]);
    assert.deepEqual(ideas[1].sides, ["corn"]);
    assert.equal(ideas[1].protein, "crab");
    assert.equal(ideas[2].minutes, null);
    assert.deepEqual(Object.keys(t), ["title", "subtitle", "why", "minutes", "prepMinutes", "cookMinutes", "equipment", "protein", "category", "items", "sides", "steps", "stepDetails", "tips", "usesPantry", "missing"]);
    assert.deepEqual(validateIdeas("nonsense", { count: 3 }), { ideas: [], dropped: [] });
    assert.equal(validateIdeas([{ title: "Pork chops", protein: "pork" }], { count: 1 }).ideas.length, 1, "a bare array works");
  });

  test("an idea that lists an oven in its equipment is dropped", () => {
    const { ideas, dropped } = validateIdeas({ ideas: [{ title: "Chicken thighs", equipment: ["oven"] }] }, { count: 3 });
    assert.equal(ideas.length, 0);
    assert.deepEqual(dropped, [{ title: "Chicken thighs", rule: "oven" }]);
  });

  test("ideasUserPrompt lists the pantry soonest use-by first", () => {
    const text = ideasUserPrompt({
      pantry: [
        { id: "rice", name: "Rice", qty: 5, unit: "lb", useBy: null },
        { id: "beef", name: "Ground beef", qty: 2, unit: "lb", useBy: "2026-11-20" },
        { id: "chicken", name: "Chicken", qty: 3, unit: "lb", useBy: "2026-11-16" },
      ],
      note: "Something quick",
      count: 2,
      today: "2026-11-15",
    });
    assert.ok(text.indexOf("chicken = Chicken") < text.indexOf("beef = Ground beef"));
    assert.ok(text.indexOf("beef = Ground beef") < text.indexOf("rice = Rice"));
    assert.match(text, /use by 2026-11-16/);
    assert.match(text, /Suggest 2 different dinner ideas/);
    assert.match(text, /Something quick/);
    assert.match(text, /Today is 2026-11-15/);
  });
  test("validatePlan: only open or change nights, only sent ids, no repeats (kept nights count), reasons clamped", () => {
    const r = validatePlan({
      nights: [
        { date: "2026-11-26", dinner: "stirfry", why: "Uses the broccoli before it turns.\nCheap too." },
        { date: "2026-11-23", dinner: "alfredo", why: "Tonight is kept." },
        { date: "2026-11-24", dinner: "tacos", why: "Tacos are already tonight's." },
        { date: "2026-11-24", dinner: "alfredo", why: "The deli tray needs eating. " + "x".repeat(300) },
        { date: "2026-11-25", dinner: "lasagna", why: "Not in the box." },
        { date: "2026-11-25", dinner: "stirfry", why: "Twice." },
        { date: "2026-11-29", dinner: "chili", why: "Outside the stretch." },
        { date: "2026-11-24", dinner: "chili", why: "Second answer for a night." },
      ],
      summary: "  Uses the chicken and the deli tray first.  ",
    }, PLAN_REQ);
    assert.deepEqual(r.nights.map((n) => [n.date, n.dinner]), [["2026-11-24", "alfredo"], ["2026-11-26", "stirfry"]], "date order");
    assert.equal(r.dropped, 6);
    assert.equal(r.nights[1].why, "Uses the broccoli before it turns. Cheap too.");
    assert.ok(r.nights[0].why.length <= 160);
    assert.equal(r.summary, "Uses the chicken and the deli tray first.");
    // A bare list and { id, reason } are read too; junk is empty.
    assert.deepEqual(validatePlan([{ date: "2026-11-25T00:00", id: "chili", reason: "Keep it." }], PLAN_REQ).nights, [{ date: "2026-11-25", dinner: "chili", why: "Keep it." }]);
    assert.deepEqual(validatePlan("nope", PLAN_REQ), { nights: [], summary: "", dropped: 0 });
    assert.deepEqual(validatePlan({ nights: [{ date: "2026-11-24", dinner: "tacos" }] }, { nights: [], dinners: [] }).nights, []);
  });

  test("PLAN_SYSTEM_PROMPT: the order to choose in, the house rules for health talk, JSON only", () => {
    for (const re of [/Bilbrey family of five/, /\$650 a month/, /What's in the house/, /2\. Cost/, /3\. Healthy eating/, /4\. Variety/, /5\. Effort/, /busy gets a dinner of 30 minutes or less/,
      /beef no more than two or three times a week/, /at most two heavy/, /"keep" night stays as it is/, /JSON only/, /never set calorie targets/, /never mention dieting/]) assert.match(PLAN_SYSTEM_PROMPT, re);
    const u = planUserPrompt(PLAN_REQ);
    assert.match(u, /^Plan these nights\. The family's data:\n\{/);
    assert.deepEqual(JSON.parse(u.slice(u.indexOf("{"))), PLAN_REQ);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// The Worker with a Claude key
// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("Worker with ANTHROPIC_API_KEY", () => {
  const KEY = familyKey("claude kitchen");
  let w;
  const post = (path, body, extra = {}) => w.call(path, { method: "POST", key: KEY, body, ...extra });
  const setModel = (value) =>
    post("/api/ops", { ops: [{ op: "set", path: ["settings", "aiModel"], value }], by: "Jeff", clientId: "test-client" });

  before(async () => {
    w = await startWorker({ anthropic: true, bindings: { ANTHROPIC_API_KEY: TEST_KEY } });
    assert.equal((await w.call("/api/setup", { method: "POST", body: { key: KEY } })).status, 201);
  });
  after(async () => {
    await w.dispose();
  });
  beforeEach(() => {
    w.calls.length = 0;
    w.claudeCalls.length = 0;
  });

  test("GET /api/ai: key set, Claude engine, default model, nothing spent yet; family key required", async () => {
    const r = await w.call("/api/ai", { key: KEY });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.keySet, true);
    assert.equal(r.json.engine, "claude");
    assert.equal(r.json.model, "claude-opus-5-5");
    assert.deepEqual(r.json.models, MODELS);
    assert.equal(r.json.month, chicagoMonth());
    assert.equal(r.json.spentUsd, 0);
    assert.equal(r.json.capUsd, 5);
    assert.equal(r.json.capped, false);
    assert.ok(!r.text.includes(TEST_KEY), "the key is never echoed");
    assert.equal(r.headers.get("access-control-allow-origin"), "https://blufoxmobile.github.io");

    assert.equal((await w.call("/api/ai")).status, 401);
    assert.equal((await w.call("/api/ai", { key: familyKey("wrong") })).status, 401);
    assert.equal((await w.call("/api/ai", { method: "POST", key: KEY, body: {} })).status, 405);
    assert.equal(w.claudeCalls.length, 0);
  });

  test("POST /api/scan uses Claude: same prompt, image block, same clean-up; engine + model in the reply", async () => {
    const before = (await w.call("/api/ai", { key: KEY })).json.spentUsd;
    w.setClaude(() => claudeReply(
      "Here's what I see:\n```json\n" +
        JSON.stringify({ items: [
          { name: "Cut green beans, canned", brand: "Del Monte", label: "Cut Green Beans", matchId: "greenBeans", qty: 4, unit: "Cans", confidence: 0.93, box: [120, 340, 410, 620] },
          { name: "Mystery sauce", brand: null, label: null, matchId: "made-up-id", qty: 1, unit: "jar", confidence: 85, box: null },
        ] }) +
        "\n```",
      { input: 1000, output: 500 },
    ));
    const r = await post("/api/scan", { image: PNG_DATA_URL, known: KNOWN });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.engine, "claude");
    assert.equal(r.json.model, "claude-opus-5-5");
    assert.deepEqual(r.json.items, [
      { name: "Cut green beans, canned", matchId: "greenBeans", qty: 4, unit: "can", confidence: 0.93, brand: "Del Monte", label: "Cut Green Beans", box: [120, 340, 410, 620] },
      { name: "Mystery sauce", matchId: null, qty: 1, unit: "jar", confidence: 0.85 },
    ]);
    assert.equal(w.calls.length, 0, "Workers AI is not used");
    assert.equal(w.claudeCalls.length, 1);
    const { headers, body } = w.claudeCalls[0];
    assert.equal(headers["x-api-key"], TEST_KEY);
    assert.equal(headers["anthropic-version"], "2023-06-01");
    assert.equal(body.model, "claude-opus-5-5");
    assert.equal(body.max_tokens, 4000);
    assert.match(systemText(body.system), /kitchen-inventory assistant/);
    const [img] = claudeImages(body);
    assert.deepEqual(img.source, { type: "base64", media_type: "image/png", data: PNG_DATA_URL.split(",")[1] });
    const text = claudeText(body);
    for (const k of KNOWN) assert.ok(text.includes(`${k.id} = ${k.name}`));
    assert.match(text, /"box": where that product is in the photo/);
    assert.ok(!r.text.includes(TEST_KEY));

    const after = (await w.call("/api/ai", { key: KEY })).json;
    near(after.spentUsd - before, 0.014, "1000 in + 500 out on Opus");
  });

  test("POST /api/receipt uses Claude per image; a page Claude can't read falls back on its own", async () => {
    const page = (n) => ({
      store: "sams", date: n === 1 ? "2026-11-12" : null, subtotal: n === 2 ? 23.42 : null, tax: null, total: n === 2 ? 23.65 : null, savings: null,
      lines: n === 1
        ? [{ text: "MM CHKN BRST 6.5LB", product: "Member's Mark Chicken Breast", brand: "Member's Mark", size: "6.5 lb", qty: 1, unitPrice: 17.94, lineTotal: 17.94, discount: 0, matchId: "chicken", confidence: 0.9 }]
        : [{ text: "MM SPAG 4PK", product: "Member's Mark Spaghetti", brand: "Member's Mark", size: null, qty: 1, unitPrice: 5.48, lineTotal: 5.48, discount: 0, matchId: "spaghetti", confidence: 0.9 }],
    });
    w.setClaude((body) => claudeReply(page(Number(/image (\d) of 2/.exec(claudeText(body))[1]))));
    const r = await post("/api/receipt", { images: [jpegDataUrl(700), jpegDataUrl(800)], known: KNOWN, store: "sams" });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.engine, "claude");
    assert.equal(r.json.model, "claude-opus-5-5");
    assert.deepEqual(r.json.lines.map((l) => [l.text, l.matchId]), [["MM CHKN BRST 6.5LB", "chicken"], ["MM SPAG 4PK", "spaghetti"]]);
    assert.equal(r.json.total, 23.65);
    assert.equal(r.json.date, "2026-11-12");
    assert.equal(w.claudeCalls.length, 2);
    assert.equal(w.calls.length, 0);
    assert.match(systemText(w.claudeCalls[0].body.system), /UNTRUSTED/);
    assert.equal(w.claudeCalls[0].body.max_tokens, 6000);
    assert.equal(claudeImages(w.claudeCalls[0].body)[0].source.media_type, "image/jpeg");

    // Image 2: Claude is overloaded → that page alone goes to Workers AI.
    w.claudeCalls.length = 0;
    w.setClaude((body) => {
      const n = Number(/image (\d) of 2/.exec(claudeText(body))[1]);
      if (n === 2) return new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }), { status: 529 });
      return claudeReply(page(1));
    });
    w.setAI(() => ({ choices: [{ message: { content: JSON.stringify(page(2)) } }] }));
    const mixed = await post("/api/receipt", { images: [jpegDataUrl(700), jpegDataUrl(800)], known: KNOWN });
    assert.equal(mixed.status, 200, mixed.text);
    assert.equal(mixed.json.engine, "mixed");
    assert.equal(mixed.json.model, `claude-opus-5-5 + ${PRIMARY}`);
    assert.match(mixed.json.claudeError, /529 overloaded_error/);
    assert.equal(mixed.json.lines.length, 2);
    assert.equal(w.calls.length, 1, "only the failed page used Workers AI");
  });

  test("the family's model setting is honored; an unknown value falls back to Opus", async () => {
    assert.equal((await setModel("claude-haiku-5-5")).status, 200);
    w.setClaude(() => claudeReply('{"items":[]}', { input: 2000, output: 100 }));
    const r = await post("/api/scan", { image: PNG_DATA_URL, known: [] });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.model, "claude-haiku-5-5");
    assert.equal(w.claudeCalls[0].body.model, "claude-haiku-5-5");
    assert.equal((await w.call("/api/ai", { key: KEY })).json.model, "claude-haiku-5-5");

    assert.equal((await setModel("claude-sonnet-5-5")).status, 200);
    await post("/api/scan", { image: PNG_DATA_URL, known: [] });
    assert.equal(w.claudeCalls[1].body.model, "claude-sonnet-5-5");

    assert.equal((await setModel("gpt-5")).status, 200);
    const r3 = await post("/api/scan", { image: PNG_DATA_URL, known: [] });
    assert.equal(r3.json.model, "claude-opus-5-5");
    assert.equal(w.claudeCalls[2].body.model, "claude-opus-5-5");
    assert.equal((await w.call("/api/ai", { key: KEY })).json.model, "claude-opus-5-5");
    await setModel("claude-opus-5-5");
  });

  test("usage accounting: every call's tokens and cost add up in this month's row", async () => {
    const start = (await w.call("/api/ai", { key: KEY })).json;
    await setModel("claude-opus-5-5");
    w.setClaude(() => claudeReply('{"items":[]}', { input: 3000, output: 1000 })); // 0.012 + 0.02 = 0.032
    await post("/api/scan", { image: PNG_DATA_URL, known: [] });
    await setModel("claude-sonnet-5-5");
    w.setClaude(() => claudeReply('{"items":[]}', { input: 10_000, output: 2000 })); // 0.02 + 0.02 = 0.04
    await post("/api/scan", { image: PNG_DATA_URL, known: [] });
    await setModel("claude-haiku-5-5");
    w.setClaude(() => claudeReply("not JSON at all", { input: 50_000, output: 4000 })); // 0.005 + 0.002 = 0.007, billed even though unusable
    const fell = await post("/api/scan", { image: PNG_DATA_URL, known: [] });
    assert.equal(fell.json.engine, "workers-ai", "unusable reply → Workers AI");
    assert.match(fell.json.claudeError, /no usable JSON/);
    await setModel("claude-opus-5-5");

    const end = (await w.call("/api/ai", { key: KEY })).json;
    near(end.spentUsd - start.spentUsd, 0.032 + 0.04 + 0.007, "spend");
    assert.equal(end.inputTokens - start.inputTokens, 63_000);
    assert.equal(end.outputTokens - start.outputTokens, 7000);
  });

  test("Claude errors fall back to Workers AI and cost nothing", async () => {
    const start = (await w.call("/api/ai", { key: KEY })).json.spentUsd;
    w.setClaude(() => new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }), { status: 401 }));
    w.setAI(() => ({ response: { items: [{ name: "Spaghetti, dry pasta", matchId: "spaghetti", qty: 2, unit: "box", confidence: 0.9 }] } }));
    const r = await post("/api/scan", { image: PNG_DATA_URL, known: KNOWN });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.engine, "workers-ai");
    assert.equal(r.json.model, PRIMARY);
    assert.match(r.json.claudeError, /^claude-opus-5-5: Claude API 401 authentication_error/);
    assert.ok(!r.text.includes(TEST_KEY));
    assert.deepEqual(r.json.items, [{ name: "Spaghetti, dry pasta", matchId: "spaghetti", qty: 2, unit: "box", confidence: 0.9 }]);
    assert.equal(w.claudeCalls.length, 1);
    assert.equal(w.calls.length, 1);
    assert.equal((await w.call("/api/ai", { key: KEY })).json.spentUsd, start, "a failed call is not billed");

    // Everything fails → 502 whose detail names both engines.
    w.setAI(() => {
      throw new Error("3040 out of capacity");
    });
    const bad = await post("/api/scan", { image: PNG_DATA_URL, known: KNOWN });
    assert.equal(bad.status, 502);
    assert.match(bad.json.detail, /authentication_error/);
    assert.match(bad.json.detail, /out of capacity/);
  });

  test("POST /api/ideas: house-rule breakers dropped, ids filtered, prompt carries the rules and the pantry", async () => {
    const reply = {
      ideas: [
        { title: "Crispy tofu stir-fry", protein: "tofu", items: [{ name: "Extra-firm tofu", qty: 2, unit: "block" }], sides: ["broccoli", "rice"], steps: ["Fry."] },
        { title: "Garlic shrimp pasta", protein: "shrimp", items: [{ name: "Shrimp", qty: 2, unit: "lb" }], sides: ["broccoli"], steps: ["Cook."] },
        { title: "Chicken Caesar wraps", protein: "chicken", items: [], sides: [], steps: [] },
        { title: "Greek chicken with cucumber salad", protein: "chicken", items: [{ name: "Cucumber", qty: 1, unit: "each" }], sides: [], steps: [] },
        { title: "Sheet-pan sausage", protein: "sausage", items: [], sides: [], steps: ["Preheat the oven to 425°F."] },
        {
          title: "Blackstone chicken fried rice",
          subtitle: "Day-old rice and the chicken that needs using.",
          why: "The chicken is due Monday.",
          minutes: 30,
          equipment: ["blackstone"],
          protein: "chicken",
          category: "Asian-inspired",
          items: [{ name: "Chicken breast", qty: 2.5, unit: "lb", matchId: "chicken" }, { name: "Peas and carrots", qty: 1, unit: "bag", matchId: "fake-id" }],
          sides: ["broccoli", "not-a-side", "salad"],
          steps: ["Dice the chicken.", "Cook on the griddle to 165°F."],
          usesPantry: ["chicken", "ghost"],
          missing: [{ name: "Eggs", qty: 6, unit: "each", matchId: "eggs" }],
        },
        { title: "Smoky beef chili", protein: "beef", items: [{ name: "Ground beef", qty: 2.5, unit: "lb", matchId: "groundBeef" }], sides: ["cornbread"], steps: ["Brown the beef."], usesPantry: ["groundBeef"] },
      ],
    };
    w.setClaude(() => claudeReply("```json\n" + JSON.stringify(reply) + "\n```", { input: 4000, output: 2000 }));
    const body = {
      images: [jpegDataUrl(700), PNG_DATA_URL],
      note: "Something on the Blackstone tonight",
      pantry: [
        { id: "rice", name: "Jasmine rice", qty: 10, unit: "lb" },
        { id: "groundBeef", name: "Ground beef", qty: 3, unit: "lb", useBy: "2026-11-20" },
        { id: "chicken", name: "Chicken breast", qty: 2.5, unit: "lb", useBy: "2026-11-16" },
      ],
      sides: [
        { id: "broccoli", title: "Steamed broccoli", kind: "vegetable" },
        { id: "salad", title: "Romaine salad", kind: "salad" },
        { id: "cornbread", title: "Skillet cornbread", kind: "bread" },
      ],
      catalog: [
        { id: "chicken", name: "Chicken breast", unit: "lb" },
        { id: "groundBeef", name: "Ground beef", unit: "lb" },
        { id: "eggs", name: "Eggs", unit: "each" },
      ],
      count: 3,
    };
    const r = await post("/api/ideas", body);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.engine, "claude");
    assert.equal(r.json.model, "claude-opus-5-5");
    assert.equal(r.json.dropped, 5);
    assert.deepEqual(r.json.ideas.map((i) => i.title), ["Blackstone chicken fried rice", "Smoky beef chili"]);
    const [rice, chili] = r.json.ideas;
    assert.deepEqual(rice.sides, ["broccoli", "salad"]);
    assert.deepEqual(rice.items.map((i) => i.matchId), ["chicken", null]);
    assert.deepEqual(rice.usesPantry, ["chicken"]);
    assert.deepEqual(rice.missing, [{ name: "Eggs", qty: 6, unit: "each", matchId: "eggs" }]);
    assert.deepEqual(rice.equipment, ["blackstone"]);
    assert.deepEqual(chili.sides, ["cornbread"]);
    assert.deepEqual(chili.usesPantry, ["groundBeef"]);

    assert.equal(w.claudeCalls.length, 1);
    const sent = w.claudeCalls[0].body;
    const sys = systemText(sent.system);
    for (const rule of [/NO OVEN/, /No tofu/, /seafood/, /snow-crab boil/, /Caesar/, /raw cucumbers/, /raw onions/, /raw tomatoes/, /five/, /Organic/, /JSON only/, /blackstone/, /air fryer/]) assert.match(sys, rule);
    const content = sent.messages[0].content;
    assert.deepEqual(content.map((b) => b.type), ["image", "image", "text"], "photos first, then the request");
    assert.equal(content[1].source.media_type, "image/png");
    const text = content[2].text;
    assert.match(text, /Suggest 3 different dinner ideas/);
    assert.match(text, /Something on the Blackstone tonight/);
    assert.ok(text.indexOf("chicken = Chicken breast") < text.indexOf("groundBeef = Ground beef") && text.indexOf("groundBeef = Ground beef") < text.indexOf("rice = Jasmine rice"), "soonest use-by first");
    assert.match(sys, /broccoli = Steamed broccoli \[vegetable\]/);
    assert.match(sys, /eggs = Eggs \(each\)/);
    assert.match(text, /Today is \d{4}-\d{2}-\d{2}/);
    assert.equal(sent.max_tokens, 6000);
  });

  test("POST /api/ideas: limits and bad input are refused before Claude is called", async () => {
    const cases = [
      [{ images: Array(5).fill(PNG_DATA_URL) }, 400, /at most 4/],
      [{ images: "data:image/png;base64,abc" }, 400],
      [{ images: [PNG_DATA_URL, "https://example.com/x.jpg"] }, 400, /^Photo 2:/],
      [{ images: [jpegDataUrl(1.2 * 1024 * 1024)] }, 413, /1\.5 MB/],
      [{ note: "x".repeat(301) }, 400, /300 characters/],
      [{ note: 42 }, 400],
      [{ pantry: Array.from({ length: 151 }, (_, i) => ({ id: `p${i}`, name: "x" })) }, 400, /at most 150/],
      [{ sides: Array.from({ length: 81 }, (_, i) => ({ id: `s${i}`, title: "x" })) }, 400, /at most 80/],
      [{ catalog: Array.from({ length: 401 }, (_, i) => ({ id: `c${i}`, name: "x" })) }, 400, /at most 400/],
      [{ pantry: "chicken" }, 400],
      [{ count: 5 }, 400, /1 to 4/],
      [{ count: 0 }, 400],
      [{ count: 2.5 }, 400],
      [[1, 2, 3], 400],
    ];
    for (const [body, status, re] of cases) {
      const r = await post("/api/ideas", body);
      assert.equal(r.status, status, `${JSON.stringify(body).slice(0, 80)} → ${r.status} ${r.text}`);
      assert.equal(typeof r.json.error, "string");
      if (re) assert.match(r.json.error, re);
    }
    const big = jpegDataUrl(0.85 * 1024 * 1024);
    const tooMuch = await post("/api/ideas", { images: [big, big, big, big] });
    assert.equal(tooMuch.status, 413);
    assert.match(tooMuch.json.error, /4\.5 MB/);
    assert.equal((await post("/api/ideas", "{nope")).status, 400);
    assert.equal(w.claudeCalls.length, 0, "nothing invalid reaches Claude");

    // The edges are fine: 300-character note, 150 pantry items, count 1, no photos.
    w.setClaude(() => claudeReply({ ideas: [{ title: "Pork chops", protein: "pork" }] }));
    const ok = await post("/api/ideas", {
      note: "y".repeat(300),
      pantry: Array.from({ length: 150 }, (_, i) => ({ id: `p${i}`, name: `Item ${i}` })),
      count: 1,
    });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.ideas.length, 1);
    assert.deepEqual(w.claudeCalls[0].body.messages[0].content.map((b) => b.type), ["text"]);
  });

  test("POST /api/ideas: Claude failures are a 502, never a Workers AI call", async () => {
    w.setClaude(() => new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }), { status: 529 }));
    const r = await post("/api/ideas", { count: 2 });
    assert.equal(r.status, 502);
    assert.equal(typeof r.json.error, "string");
    assert.match(r.json.detail, /529/);
    w.setClaude(() => claudeReply("Sorry, I can't think of anything."));
    const r2 = await post("/api/ideas", {});
    assert.equal(r2.status, 502);
    assert.match(r2.json.detail, /no usable JSON/);
    assert.equal(w.calls.length, 0);
    const wrong = await w.call("/api/ideas", { method: "POST", key: familyKey("nope"), body: {} });
    assert.equal(wrong.status, 401);
  });

  test("POST /api/plan: Claude plans the open and change nights from the box; tonight and kept dinners stay; the prompt is cached", async () => {
    const reply = {
      nights: [
        { date: "2026-11-24", dinner: "alfredo", why: "The deli tray needs eating, and it's ready in 15 minutes." },
        { date: "2026-11-25", dinner: "chili", why: "Keeps the chili you planned; only cornbread to buy." },
        { date: "2026-11-26", dinner: "stirfry", why: "Uses the broccoli and the chicken from Saturday." },
        { date: "2026-11-23", dinner: "stirfry", why: "Tonight is kept." },
        { date: "2026-11-26", dinner: "ghost", why: "Not in the box." },
      ],
      summary: "Uses the deli tray and the broccoli first; about $5 left to buy.",
    };
    w.setClaude(() => claudeReply(JSON.stringify(reply), { input: 6000, output: 600 }));
    const r = await post("/api/plan", { ...PLAN_REQ, extra: "ignored", nights: [...PLAN_REQ.nights, { date: "nope", plan: "open" }] });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.engine, "claude");
    assert.equal(r.json.model, "claude-opus-5-5");
    assert.deepEqual(r.json.nights.map((n) => [n.date, n.dinner]), [["2026-11-24", "alfredo"], ["2026-11-25", "chili"], ["2026-11-26", "stirfry"]]);
    assert.equal(r.json.dropped, 2);
    assert.match(r.json.summary, /deli tray/);
    assert.equal(typeof r.json.usage.usd, "number");

    assert.equal(w.claudeCalls.length, 1);
    const sent = w.claudeCalls[0].body;
    assert.equal(systemText(sent.system), PLAN_SYSTEM_PROMPT);
    assert.deepEqual(sent.system.at(-1).cache_control, { type: "ephemeral" }, "the same prompt every time, cached");
    assert.equal(sent.max_tokens, 5000);
    const text = sent.messages[0].content.map((b) => b.text).join("");
    const data = JSON.parse(text.slice(text.indexOf("{")));
    assert.equal(data.extra, undefined, "only the fields the prompt uses");
    assert.equal(data.nights.length, 4, "a night without a date is dropped");
    assert.equal(data.nights[1].busy, true);
    assert.deepEqual(data.dinners.find((d) => d.id === "stirfry").usesSoon, ["Broccoli"]);
    assert.deepEqual(data.freezer, PLAN_REQ.freezer);
    assert.deepEqual(data.budget, PLAN_REQ.budget);

    const ai = (await w.call("/api/ai", { key: KEY })).json;
    assert.ok(ai.spentUsd > 0, "planning counts toward the month");
  });

  test("POST /api/plan: bad requests are refused before Claude is called", async () => {
    const cases = [
      [{ ...PLAN_REQ, today: "Monday" }, 400, /today/],
      [{ ...PLAN_REQ, nights: [] }, 400, /nights/],
      [{ ...PLAN_REQ, nights: Array.from({ length: 41 }, (_, i) => ({ date: `2026-12-${String((i % 28) + 1).padStart(2, "0")}`, plan: "open" })) }, 400, /at most 40/],
      [{ ...PLAN_REQ, dinners: [] }, 400, /dinners/],
      [{ ...PLAN_REQ, nights: PLAN_REQ.nights.map((n) => ({ ...n, plan: "keep" })) }, 400, /no night to plan/],
      [[1, 2], 400],
    ];
    for (const [body, status, re] of cases) {
      const r = await post("/api/plan", body);
      assert.equal(r.status, status, `${JSON.stringify(body).slice(0, 80)} → ${r.status} ${r.text}`);
      assert.equal(typeof r.json.error, "string");
      if (re) assert.match(r.json.error, re);
    }
    assert.equal((await post("/api/plan", "{nope")).status, 400);
    assert.equal(w.claudeCalls.length, 0, "nothing invalid reaches Claude");
    const wrong = await w.call("/api/plan", { method: "POST", key: familyKey("nope"), body: PLAN_REQ });
    assert.equal(wrong.status, 401);
  });

  test("POST /api/plan: Claude failing, unreadable or off the box is a 502", async () => {
    w.setClaude(() => new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }), { status: 529 }));
    const r1 = await post("/api/plan", PLAN_REQ);
    assert.equal(r1.status, 502);
    assert.match(r1.json.error, /couldn't plan/);
    assert.match(r1.json.detail, /529/);
    w.setClaude(() => claudeReply("Here's a lovely week!"));
    const r2 = await post("/api/plan", PLAN_REQ);
    assert.equal(r2.status, 502);
    assert.match(r2.json.detail, /no usable JSON/);
    w.setClaude(() => claudeReply({ nights: [{ date: "2026-11-24", dinner: "lasagna", why: "?" }] }));
    const r3 = await post("/api/plan", PLAN_REQ);
    assert.equal(r3.status, 502);
    assert.match(r3.json.error, /didn't fit the recipe box/);
    assert.equal(w.calls.length, 0, "never Workers AI");
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// The monthly cap
// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("monthly cap (AI_MONTHLY_CAP_USD)", () => {
  const KEY = familyKey("cap test");
  let w;
  before(async () => {
    w = await startWorker({ anthropic: true, bindings: { ANTHROPIC_API_KEY: TEST_KEY, AI_MONTHLY_CAP_USD: "0.03" } });
    assert.equal((await w.call("/api/setup", { method: "POST", body: { key: KEY } })).status, 201);
  });
  after(async () => {
    await w.dispose();
  });

  test("under the cap → Claude; at or over it → Workers AI for scans and receipts, 402 for ideas", async () => {
    w.setClaude(() => claudeReply('{"items":[{"name":"Ketchup","matchId":null,"qty":1,"unit":"bottle","confidence":0.9}]}', { input: 1000, output: 1000 })); // $0.024
    w.setAI(() => ({ response: { items: [{ name: "Mustard", matchId: null, qty: 1, unit: "bottle", confidence: 0.8 }] } }));

    const s1 = await w.call("/api/scan", { method: "POST", key: KEY, body: { image: PNG_DATA_URL, known: [] } });
    assert.equal(s1.json.engine, "claude");
    let ai = (await w.call("/api/ai", { key: KEY })).json;
    assert.equal(ai.capUsd, 0.03);
    near(ai.spentUsd, 0.024);
    assert.equal(ai.capped, false, "$0.024 < $0.03");

    const s2 = await w.call("/api/scan", { method: "POST", key: KEY, body: { image: PNG_DATA_URL, known: [] } });
    assert.equal(s2.json.engine, "claude", "still under the cap when the call starts");
    ai = (await w.call("/api/ai", { key: KEY })).json;
    near(ai.spentUsd, 0.048);
    assert.equal(ai.capped, true);
    assert.equal(ai.engine, "workers-ai");
    assert.equal(ai.keySet, true);

    w.claudeCalls.length = 0;
    w.calls.length = 0;
    const s3 = await w.call("/api/scan", { method: "POST", key: KEY, body: { image: PNG_DATA_URL, known: [] } });
    assert.equal(s3.status, 200);
    assert.equal(s3.json.engine, "workers-ai");
    assert.equal(s3.json.capped, true);
    assert.equal(s3.json.items[0].name, "Mustard");
    assert.equal(s3.json.claudeError, undefined);

    w.setAI(() => ({ response: { store: "jewel", date: "2026-11-14", total: 1.29, lines: [{ text: "SIG SEL SPAG", product: "Signature Select Spaghetti", qty: 1, unitPrice: 1.29, lineTotal: 1.29 }] } }));
    const rc = await w.call("/api/receipt", { method: "POST", key: KEY, body: { images: [PNG_DATA_URL], known: [] } });
    assert.equal(rc.status, 200, rc.text);
    assert.equal(rc.json.engine, "workers-ai");
    assert.equal(rc.json.capped, true);

    const ideas = await w.call("/api/ideas", { method: "POST", key: KEY, body: { count: 2 } });
    assert.equal(ideas.status, 402);
    assert.equal(ideas.json.capped, true);
    assert.equal(typeof ideas.json.error, "string");
    const plan = await w.call("/api/plan", { method: "POST", key: KEY, body: PLAN_REQ });
    assert.equal(plan.status, 402);
    assert.equal(plan.json.capped, true);
    assert.equal(w.claudeCalls.length, 0, "no Claude call once capped");
    near((await w.call("/api/ai", { key: KEY })).json.spentUsd, 0.048, "nothing more was spent");
  });

  test("AI_MONTHLY_CAP_USD=0 turns Claude off; with no Workers AI binding a capped scan is a 402", async () => {
    const off = await startWorker({ ai: false, anthropic: true, bindings: { ANTHROPIC_API_KEY: TEST_KEY, AI_MONTHLY_CAP_USD: "0" } });
    try {
      await off.call("/api/setup", { method: "POST", body: { key: KEY } });
      const ai = (await off.call("/api/ai", { key: KEY })).json;
      assert.equal(ai.capped, true);
      assert.equal(ai.engine, "workers-ai");
      const s = await off.call("/api/scan", { method: "POST", key: KEY, body: { image: PNG_DATA_URL, known: [] } });
      assert.equal(s.status, 402);
      assert.equal(s.json.capped, true);
      assert.equal(off.claudeCalls.length, 0);
    } finally {
      await off.dispose();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// No key, and Claude without Workers AI
// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("without ANTHROPIC_API_KEY", () => {
  const KEY = familyKey("no claude");
  let w;
  before(async () => {
    w = await startWorker({ anthropic: true });
    assert.equal((await w.call("/api/setup", { method: "POST", body: { key: KEY } })).status, 201);
  });
  after(async () => {
    await w.dispose();
  });

  test("GET /api/ai says keySet:false and engine workers-ai", async () => {
    const r = await w.call("/api/ai", { key: KEY });
    assert.equal(r.status, 200);
    assert.equal(r.json.keySet, false);
    assert.equal(r.json.engine, "workers-ai");
    assert.equal(r.json.model, "claude-opus-5-5");
    assert.equal(r.json.capped, false);
    assert.equal(r.json.spentUsd, 0);
  });

  test("scans stay on Workers AI, and POST /api/ideas and /api/plan are a 503", async () => {
    w.setAI(() => ({ response: '{"items":[]}' }));
    const s = await w.call("/api/scan", { method: "POST", key: KEY, body: { image: PNG_DATA_URL, known: [] } });
    assert.equal(s.status, 200);
    assert.deepEqual(s.json, { items: [], model: PRIMARY, engine: "workers-ai" });
    const r = await w.call("/api/ideas", { method: "POST", key: KEY, body: { count: 3 } });
    assert.equal(r.status, 503);
    assert.equal(typeof r.json.error, "string");
    const p = await w.call("/api/plan", { method: "POST", key: KEY, body: PLAN_REQ });
    assert.equal(p.status, 503);
    assert.match(p.json.error, /Claude key/);
    assert.equal(w.claudeCalls.length, 0);
  });
});

test("Claude works without a Workers AI binding; if it fails there is nothing to fall back to (502)", async () => {
  const KEY = familyKey("claude only");
  const w = await startWorker({ ai: false, anthropic: true, bindings: { ANTHROPIC_API_KEY: TEST_KEY } });
  try {
    await w.call("/api/setup", { method: "POST", body: { key: KEY } });
    w.setClaude(() => claudeReply({ items: [{ name: "Spaghetti, dry pasta", matchId: "spaghetti", qty: 2, unit: "box", confidence: 0.9 }] }));
    const ok = await w.call("/api/scan", { method: "POST", key: KEY, body: { image: PNG_DATA_URL, known: KNOWN } });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.engine, "claude");
    assert.equal(ok.json.items[0].matchId, "spaghetti");

    w.setClaude(() => new Response("upstream down", { status: 503 }));
    const bad = await w.call("/api/scan", { method: "POST", key: KEY, body: { image: PNG_DATA_URL, known: KNOWN } });
    assert.equal(bad.status, 502);
    assert.match(bad.json.detail, /Claude API 503/);
    const rc = await w.call("/api/receipt", { method: "POST", key: KEY, body: { images: [PNG_DATA_URL], known: KNOWN } });
    assert.equal(rc.status, 502);
    assert.match(rc.json.detail, /Claude API 503/);
  } finally {
    await w.dispose();
  }
});
