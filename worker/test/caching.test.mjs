// docs/spec/23: cheaper Claude scans. The stable part of every prompt (instructions + the list of
// what the family buys) is marked for Anthropic's prompt cache, cache writes and reads are priced
// into the monthly spend, the response says whether the cache was hit, several photos of one scan
// share it, and recipe ideas know the kitchen (the PossibleCooker, lean dinners, timed steps).
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startWorker, familyKey, claudeReply, PNG_DATA_URL, jpegDataUrl } from "./helpers.mjs";
import {
  MODELS, costUsd, cachedSystem, systemText, usageOf, callClaude, validateIdeas, ideaBreaksRule, cleanStep, imageBlock,
  IDEAS_SYSTEM_PROMPT, IDEAS_FORMAT_PROMPT, ideasReference, ideasUserPrompt, IDEA_EQUIPMENT,
} from "../src/claude.js";

const TEST_KEY = "sk-ant-test-not-a-real-key";
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg || ""} expected ${b}, got ${a}`);
const KNOWN = [
  { id: "greenBeans", name: "Green beans [shelf-stable]", aliases: ["cut green beans"] },
  { id: "chicken", name: "Boneless skinless chicken breast [refrigerated]", aliases: ["chicken breast"] },
  { id: "custom-tj-rice", name: "TJ's Spanish rice", aliases: [] },
];
/** A reply whose usage says what the prompt cache did. */
const reply = (text, { input = 0, output = 0, written = 0, read = 0 } = {}) => ({
  ...claudeReply(text, { input, output }),
  usage: { input_tokens: input, output_tokens: output, cache_creation_input_tokens: written, cache_read_input_tokens: read, cache_creation: { ephemeral_5m_input_tokens: written, ephemeral_1h_input_tokens: 0 } },
});
const userText = (body) => body.messages[0].content.filter((b) => b.type === "text").map((b) => b.text).join("\n");

describe("claude.js: the price of a cached prompt", () => {
  test("cache prices per model: writes cost 1.25x input; reads 0.05x (Opus, Sonnet) or 0.1x (Haiku)", () => {
    assert.deepEqual(MODELS.map((m) => [m.id, m.inUsd, m.outUsd, m.cacheWriteUsd, m.cacheReadUsd]), [
      ["claude-opus-5-5", 4, 20, 5, 0.2],
      ["claude-sonnet-5-5", 2, 10, 2.5, 0.1],
      ["claude-haiku-5-5", 0.1, 0.5, 0.125, 0.01],
    ]);
  });

  test("costUsd: uncached input, cache writes, cache reads and output each at their own price", () => {
    // The first photo of a scan on Opus: 1,700 fresh tokens, 7,600 written to the cache, 800 out.
    near(costUsd("claude-opus-5-5", { input_tokens: 1700, cache_creation_input_tokens: 7600, output_tokens: 800 }), (1700 * 4 + 7600 * 5 + 800 * 20) / 1e6, "write");
    // The next photo: the same 7,600 read back.
    near(costUsd("claude-opus-5-5", { input_tokens: 1700, cache_read_input_tokens: 7600, output_tokens: 800 }), (1700 * 4 + 7600 * 0.2 + 800 * 20) / 1e6, "read");
    near(costUsd("claude-sonnet-5-5", { input_tokens: 1000, cache_creation_input_tokens: 1000, cache_read_input_tokens: 1000, output_tokens: 1000 }), (2000 + 2500 + 100 + 10000) / 1e6, "sonnet");
    near(costUsd("claude-haiku-5-5", { input_tokens: 1000, cache_creation_input_tokens: 1000, cache_read_input_tokens: 1000, output_tokens: 1000 }), (100 + 125 + 10 + 500) / 1e6, "haiku");
    // Haiku's long-prompt tier counts the whole prompt, cached or not: 60K + 30K + 20K = 110K > 100K.
    near(costUsd("claude-haiku-5-5", { input_tokens: 60_000, cache_creation_input_tokens: 30_000, cache_read_input_tokens: 20_000, output_tokens: 1000 }), (60_000 * 0.5 + 30_000 * 0.625 + 20_000 * 0.05 + 1000 * 2.5) / 1e6, "haiku long");
    // No cache fields: exactly as before.
    near(costUsd("claude-opus-5-5", { input_tokens: 1000, output_tokens: 500 }), 0.014, "plain");
    assert.deepEqual(usageOf({ input_tokens: 5, cache_read_input_tokens: "7", junk: 1 }), { input_tokens: 5, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 7 });
    assert.deepEqual(usageOf(null), { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 });
  });

  test("cachedSystem marks the stable blocks; callClaude sends them and reports the cache counts", async () => {
    const sys = cachedSystem(["rules", "", "catalog", "shelf items"]);
    assert.deepEqual(sys, [
      { type: "text", text: "rules", cache_control: { type: "ephemeral" } },
      { type: "text", text: "catalog", cache_control: { type: "ephemeral" } },
      { type: "text", text: "shelf items", cache_control: { type: "ephemeral" } },
    ]);
    assert.equal(cachedSystem(["a", "b", "c", "d", "e"]).filter((b) => b.cache_control).length, 3, "never more than the API's four breakpoints");
    assert.equal(cachedSystem(["a", "b"], { cache: false }), "a\n\nb");
    assert.equal(cachedSystem(["", "  "]), undefined);
    assert.equal(systemText(sys), "rules\n\ncatalog\n\nshelf items");
    assert.equal(systemText("plain"), "plain");

    let sent;
    const fetchImpl = async (url, init) => {
      sent = JSON.parse(init.body);
      return new Response(JSON.stringify(reply("ok", { input: 100, output: 20, written: 7000 })), { status: 200 });
    };
    const r = await callClaude({ ANTHROPIC_API_KEY: TEST_KEY }, { system: sys, content: "hi", fetchImpl });
    assert.deepEqual(sent.system, sys);
    assert.deepEqual(r.usage, { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 7000 });
    // A big photo isn't checked character by character a second time, but it must still look like one.
    const big = `data:image/jpeg;base64,${"QUJD".repeat(3000)}`;
    assert.equal(imageBlock(big).source.data.length, 12000);
    assert.throws(() => imageBlock(`data:image/jpeg;base64,${"QUJD".repeat(3000)}<script>`));
    assert.throws(() => imageBlock(`data:text/html;base64,${"QUJD".repeat(3000)}`));
  });
});

describe("the Worker: scans and receipts share a cached prompt", () => {
  const KEY = familyKey("claude kitchen");
  let w;
  const post = (path, body) => w.call(path, { method: "POST", key: KEY, body });
  const ai = async () => (await w.call("/api/ai", { key: KEY })).json;

  before(async () => {
    w = await startWorker({ anthropic: true, bindings: { ANTHROPIC_API_KEY: TEST_KEY } });
    assert.equal((await w.call("/api/setup", { method: "POST", body: { key: KEY } })).status, 201);
  });
  after(async () => {
    await w.dispose();
  });
  beforeEach(() => {
    w.claudeCalls.length = 0;
    w.calls.length = 0;
  });

  test("a scan: instructions and known items are cached system blocks; the user message is only the photo", async () => {
    w.setClaude(() => reply('{"items":[{"name":"Cut green beans, canned","matchId":"greenBeans","qty":2,"unit":"can","confidence":0.9}]}', { input: 1700, output: 800, written: 7600 }));
    const first = await post("/api/scan", { image: PNG_DATA_URL, known: KNOWN });
    assert.equal(first.status, 200, first.text);
    const body = w.claudeCalls[0].body;
    assert.ok(Array.isArray(body.system));
    assert.equal(body.system.length, 3);
    assert.ok(body.system.every((b) => b.type === "text" && b.cache_control && b.cache_control.type === "ephemeral"));
    assert.match(body.system[0].text, /kitchen-inventory assistant/);
    assert.match(body.system[0].text, /"box": where that product is in the photo/);
    assert.match(body.system[1].text, /^KNOWN ITEMS \(id = name\):\ngreenBeans = Green beans \[shelf-stable\] \(also: cut green beans\)\nchicken = /);
    assert.ok(!body.system[1].text.includes("custom-tj-rice"), "the recipe box's items are a block of their own");
    assert.match(body.system[2].text, /custom-tj-rice = TJ's Spanish rice/);
    assert.deepEqual(body.messages[0].content.map((b) => b.type), ["image", "text"]);
    assert.ok(!userText(body).includes("greenBeans"), "nothing that repeats from photo to photo is in the user message");
    assert.ok(userText(body).length < 300);

    // What it cost is in the answer: the first photo wrote the cache…
    assert.deepEqual(first.json.usage, { inputTokens: 9300, outputTokens: 800, cacheReadTokens: 0, cacheWriteTokens: 7600, usd: (1700 * 4 + 7600 * 5 + 800 * 20) / 1e6, cacheHit: false, calls: 1 });

    // …and the next photo, with the same known items, sends the same prefix and reads it back.
    w.setClaude(() => reply('{"items":[]}', { input: 1700, output: 300, read: 7600 }));
    const second = await post("/api/scan", { image: jpegDataUrl(900), known: KNOWN });
    assert.deepEqual(w.claudeCalls[1].body.system, body.system, "byte for byte the same system prompt, or the cache would miss");
    assert.equal(second.json.usage.cacheHit, true);
    assert.equal(second.json.usage.cacheReadTokens, 7600);
    near(second.json.usage.usd, (1700 * 4 + 7600 * 0.2 + 300 * 20) / 1e6);
  });

  test("the month's spend counts cache writes and reads at their prices, and knows what a photo really costs", async () => {
    const start = await ai();
    w.setClaude(() => reply('{"items":[]}', { input: 2000, output: 500, written: 6000 }));
    await post("/api/scan", { image: PNG_DATA_URL, known: KNOWN });
    w.setClaude(() => reply('{"items":[]}', { input: 2000, output: 500, read: 6000 }));
    await post("/api/scan", { image: PNG_DATA_URL, known: KNOWN });
    await post("/api/scan", { image: PNG_DATA_URL, known: KNOWN });
    const end = await ai();
    const write = (2000 * 4 + 6000 * 5 + 500 * 20) / 1e6; // 4.8¢
    const read = (2000 * 4 + 6000 * 0.2 + 500 * 20) / 1e6; // 1.92¢
    near(end.spentUsd - start.spentUsd, Math.round((write + 2 * read) * 1e6) / 1e6, "spend");
    assert.equal(end.inputTokens - start.inputTokens, 3 * 8000, "inputTokens is still the whole prompt");
    assert.equal(end.cacheWriteTokens - start.cacheWriteTokens, 6000);
    assert.equal(end.cacheReadTokens - start.cacheReadTokens, 12000);
    assert.equal(end.outputTokens - start.outputTokens, 1500);
    assert.equal(end.calls - start.calls, 3);
    assert.equal(end.scan.photos - start.scan.photos, 3);
    near(end.scan.usd - start.scan.usd, Math.round((write + 2 * read) * 1e6) / 1e6, "scan spend");
    assert.ok(end.scan.avgUsd > 0 && end.scan.avgUsd < write, "the measured average is under a cold photo's price");
    assert.deepEqual(end.models, MODELS);
  });

  test("several photos in one request: the first goes ahead and writes the cache, the rest read it; items say which photo", async () => {
    const order = [];
    w.setClaude(async (body, n) => {
      order.push(n);
      const which = body.messages[0].content[0].source.media_type;
      const items = which === "image/png" ? [{ name: "Ketchup", qty: 1, unit: "bottle", confidence: 0.9 }] : [{ name: "Cut green beans, canned", matchId: "greenBeans", qty: 3, unit: "can", confidence: 0.9 }];
      return reply(JSON.stringify({ items }), n === 1 ? { input: 1700, output: 400, written: 7600 } : { input: 1700, output: 400, read: 7600 });
    });
    const r = await post("/api/scan", { images: [PNG_DATA_URL, jpegDataUrl(700), jpegDataUrl(800)], known: KNOWN });
    assert.equal(r.status, 200, r.text);
    assert.equal(w.claudeCalls.length, 3);
    assert.equal(w.claudeCalls[0].body.messages[0].content[0].source.media_type, "image/png", "the first photo is the first call");
    assert.deepEqual(w.claudeCalls[1].body.system, w.claudeCalls[0].body.system);
    assert.deepEqual(w.claudeCalls[2].body.system, w.claudeCalls[0].body.system);
    assert.deepEqual(r.json.items.map((i) => [i.name, i.img]), [["Ketchup", 0], ["Cut green beans, canned", 1], ["Cut green beans, canned", 2]]);
    assert.equal(r.json.photos.length, 3);
    assert.deepEqual(r.json.photos.map((p) => p.items), [1, 1, 1]);
    assert.equal(r.json.engine, "claude");
    assert.equal(r.json.model, "claude-opus-5-5");
    assert.deepEqual({ ...r.json.usage, usd: 0 }, { inputTokens: 3 * 9300, outputTokens: 1200, cacheReadTokens: 15200, cacheWriteTokens: 7600, usd: 0, calls: 3, cacheHit: true });
    near(r.json.usage.usd, Math.round(((1700 * 4 + 7600 * 5 + 400 * 20) + 2 * (1700 * 4 + 7600 * 0.2 + 400 * 20))) / 1e6);

    // One unreadable photo doesn't lose the others (it falls back to the free scanner on its own).
    w.claudeCalls.length = 0;
    w.setClaude((body, n) => (body.messages[0].content[0].source.media_type === "image/png" ? reply("no idea") : reply('{"items":[{"name":"Rice","qty":1,"unit":"bag","confidence":0.8}]}', { input: 10, output: 10 })));
    w.setAI(() => ({ choices: [{ message: { content: '{"items":[{"name":"Ketchup","qty":1,"unit":"bottle","confidence":0.7}]}' } }] }));
    const mixed = await post("/api/scan", { images: [jpegDataUrl(700), PNG_DATA_URL], known: KNOWN });
    assert.equal(mixed.status, 200, mixed.text);
    assert.equal(mixed.json.engine, "mixed");
    assert.deepEqual(mixed.json.items.map((i) => [i.name, i.img]), [["Rice", 0], ["Ketchup", 1]]);
    assert.match(mixed.json.photos[1].claudeError, /no usable JSON/);

    for (const [body, status, re] of [
      [{ images: [], known: [] }, 400, /1–4 photos/],
      [{ images: Array(5).fill(PNG_DATA_URL), known: [] }, 400, /at most 4/],
      [{ images: [PNG_DATA_URL, "nope"], known: [] }, 400, /^Photo 2:/],
      [{ images: "x" }, 400],
    ]) {
      const bad = await post("/api/scan", body);
      assert.equal(bad.status, status, bad.text);
      if (re) assert.match(bad.json.error, re);
    }
    // One photo still has the 2 MB limit; four may add up to 4.5 MB.
    assert.equal((await post("/api/scan", { image: PNG_DATA_URL, known: [], padding: "x".repeat(2.1 * 1024 * 1024) })).status, 413);
  });

  test("a receipt's images share one cached system prompt; each user message is its image and one line", async () => {
    const page = (n) => ({ store: "sams", date: "2026-11-12", subtotal: null, tax: null, total: n === 2 ? 23.42 : null, savings: null, lines: [{ text: `ITEM ${n}`, product: `Item ${n}`, brand: null, size: null, qty: 1, unitPrice: 5 + n, lineTotal: 5 + n, discount: 0, matchId: null, confidence: 0.9 }] });
    w.setClaude((body, n) => reply(JSON.stringify(page(Number(/image (\d) of 2/.exec(userText(body))[1]))), n === 1 ? { input: 1500, output: 300, written: 7000 } : { input: 1500, output: 300, read: 7000 }));
    const r = await post("/api/receipt", { images: [jpegDataUrl(700), jpegDataUrl(800)], known: KNOWN, store: "sams" });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.lines.length, 2);
    const [a, b] = w.claudeCalls.map((c) => c.body);
    assert.deepEqual(a.system, b.system);
    assert.match(systemText(a.system), /UNTRUSTED/);
    assert.match(systemText(a.system), /Common receipt abbreviations/);
    assert.match(a.system[1].text, /^KNOWN ITEMS/);
    assert.ok(a.system.every((blk) => blk.cache_control));
    assert.match(userText(a), /^This is image 1 of 2 of ONE grocery receipt\. The family says it is from Sam's Club\./);
    assert.ok(!userText(a).includes("greenBeans"));
    assert.equal(r.json.usage.cacheHit, true);
    assert.equal(r.json.usage.calls, 2);
    near(r.json.usage.usd, Math.round((1500 * 4 + 7000 * 5 + 300 * 20) + (1500 * 4 + 7000 * 0.2 + 300 * 20)) / 1e6);
  });

  test("the free scanner still gets everything in one message, exactly as before", async () => {
    const w2 = await startWorker();
    try {
      assert.equal((await w2.call("/api/setup", { method: "POST", body: { key: KEY } })).status, 201);
      const r = await w2.call("/api/scan", { method: "POST", key: KEY, body: { image: PNG_DATA_URL, known: KNOWN } });
      assert.equal(r.status, 200, r.text);
      const text = w2.calls[0].inputs.messages[1].content[0].text;
      assert.match(text, /^List every distinct food or drink product you can see in this photo\./);
      assert.match(text, /\n\nKNOWN ITEMS \(id = name\):\ngreenBeans = Green beans \[shelf-stable\] \(also: cut green beans\)\nchicken = .*\ncustom-tj-rice = TJ's Spanish rice$/);
      assert.ok(!r.json.usage, "no Claude, no Claude usage");
    } finally {
      await w2.dispose();
    }
  });

  test("a runaway known-items list is cut off before it is paid for on every photo", async () => {
    w.setClaude(() => reply('{"items":[]}', { input: 10, output: 10 }));
    const huge = Array.from({ length: 600 }, (_, i) => ({ id: `item${i}`, name: `Item number ${i} ${"x".repeat(100)}`, aliases: Array(12).fill("y".repeat(80)) }));
    const r = await post("/api/scan", { image: PNG_DATA_URL, known: huge });
    assert.equal(r.status, 200, r.text);
    const chars = systemText(w.claudeCalls[0].body.system).length;
    assert.ok(chars < 64_000, `the prompt stays under about 18K tokens (${chars} characters)`);
    assert.ok(chars > 50_000);
  });

  test("a Claude error never carries a key or a link into the response", async () => {
    w.setClaude(() => new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: `invalid x-api-key sk-ant-api03-ABCDEFG1234567 for ${"a".repeat(64)} at https://x.example/mcp/${"b".repeat(32)}` } }), { status: 401 }));
    w.setAI(() => ({ choices: [{ message: { content: '{"items":[]}' } }] }));
    const r = await post("/api/scan", { image: PNG_DATA_URL, known: [] });
    assert.equal(r.status, 200, r.text);
    assert.match(r.json.claudeError, /\[api key\]/);
    assert.match(r.json.claudeError, /\[key\]/);
    assert.match(r.json.claudeError, /\/mcp\/\[link\]/);
    assert.ok(!r.text.includes("sk-ant-api03") && !r.text.includes("a".repeat(64)) && !r.text.includes("b".repeat(32)));
  });

  test("too many photos at once are slowed down before they reach Claude", async () => {
    const w2 = await startWorker({ anthropic: true, bindings: { ANTHROPIC_API_KEY: TEST_KEY, RATE_AI: "2" } });
    try {
      assert.equal((await w2.call("/api/setup", { method: "POST", body: { key: KEY } })).status, 201);
      const scan = () => w2.call("/api/scan", { method: "POST", key: KEY, body: { image: PNG_DATA_URL, known: [] } });
      assert.equal((await scan()).status, 200);
      assert.equal((await scan()).status, 200);
      const limited = await scan();
      assert.equal(limited.status, 429);
      assert.match(limited.json.error, /Too many photos and ideas at once/);
      assert.ok(limited.json.retryAfter > 0);
      assert.equal(w2.claudeCalls.length, 2);
      assert.equal((await w2.call("/api/ai", { key: KEY })).status, 200, "looking at the spend is never limited");
    } finally {
      await w2.dispose();
    }
  });
});

describe("recipe ideas know the kitchen", () => {
  test("the prompt: the PossibleCooker and its settings, lean high-protein dinners with a vegetable, full portions", () => {
    const sys = `${IDEAS_SYSTEM_PROMPT}\n\n${IDEAS_FORMAT_PROMPT}`;
    for (const re of [
      /Ninja 10-in-1 Everyday PossibleCooker Pro, 6\.5 quart/, /"possible cooker"/, /slow cook, sear\/sauté, braise, steam, cook rice and keep warm/,
      /Lean, high-protein dinners/, /A vegetable or a salad with every dinner/, /less frying/, /Lighter never means small/, /never set calorie targets/,
      /NO OVEN/, /No tofu/, /snow-crab boil/, /Caesar/, /raw cucumbers/,
      /"prepMinutes"/, /"cookMinutes"/, /"tips"/, /\{ "text", "minutes", "setting" \}/, /JSON only/,
    ]) assert.match(sys, re);
    assert.ok(IDEA_EQUIPMENT.includes("possible cooker"));
    assert.equal(ideaBreaksRule({ prose: [sys.replace(/NO OVEN[^\n]*/g, "")], items: [], head: [] }) === "oven", false);
    const ref = ideasReference({ sides: [{ id: "broccoli", title: "Steamed broccoli", kind: "vegetable" }], catalog: [{ id: "eggs", name: "Eggs", unit: "each" }] });
    assert.equal(ref, "SIDES (id = title [kind]):\nbroccoli = Steamed broccoli [vegetable]\n\nCATALOG (id = name (unit)):\neggs = Eggs (each)");
    const user = ideasUserPrompt({ pantry: [{ id: "chicken", name: "Chicken", qty: 3, unit: "lb", useBy: "2026-11-16" }], count: 2, today: "2026-11-15", sides: [{ id: "x", title: "X" }], catalog: [{ id: "y", name: "Y" }] });
    assert.ok(!user.includes("CATALOG (id") && !user.includes("x = X"), "sides and catalog live in the cached system prompt now");
    assert.match(user, /chicken = Chicken — 3 lb \(use by 2026-11-16\)/);
  });

  test("steps as objects or strings, prep and cook minutes, tips, and the slow cooker's long hours", () => {
    assert.deepEqual(cleanStep("3) Shred the chicken."), { text: "Shred the chicken." });
    assert.deepEqual(cleanStep({ text: "Slow cook until tender.", minutes: "240 min", setting: "Slow cook, low" }), { text: "Slow cook until tender.", minutes: 240, setting: "Slow cook, low" });
    assert.deepEqual(cleanStep({ step: "Sear.", minutes: 0, setting: "none" }), { text: "Sear." });
    for (const junk of [42, null, [], {}, { text: 7 }, { minutes: 5 }, ""]) assert.equal(cleanStep(junk), null);

    const parsed = { ideas: [{
      title: "Slow-cooked salsa chicken",
      protein: "chicken",
      minutes: 495, prepMinutes: 15, cookMinutes: 480,
      equipment: ["Slow cooker", "ninja possiblecooker", "stove"],
      steps: [
        { text: "Sear the chicken in the PossibleCooker.", minutes: 6, setting: "sear/sauté, high" },
        "Pour in the salsa.",
        { text: "Slow cook until it reaches 165°F.", minutes: 480, setting: "slow cook, low" },
        { minutes: 5 },
      ],
      tips: ["No oven needed: it all happens in one pot.", "Start it by 9 am.", "", 7, "a", "b", "c", "d"],
    }, {
      title: "Quick pork chops", protein: "pork", prepMinutes: 10, cookMinutes: 12, steps: ["Sear the chops to 145°F, then rest 3 minutes."],
    }, {
      title: "Chicken bake", protein: "chicken", tips: ["Finish it under the broiler."],
    }] };
    const old = validateIdeas(parsed, { count: 3 });
    assert.deepEqual(old.dropped, [{ title: "Chicken bake", rule: "oven" }], "a tip that uses the broiler drops the idea; \"No oven needed\" doesn't");
    const [slow, chops] = old.ideas;
    assert.deepEqual(slow.equipment, ["possible cooker", "stovetop"]);
    assert.deepEqual(slow.steps, ["Sear the chicken in the PossibleCooker.", "Pour in the salsa.", "Slow cook until it reaches 165°F."], "older apps get plain sentences");
    assert.deepEqual(slow.stepDetails, [
      { text: "Sear the chicken in the PossibleCooker.", minutes: 6, setting: "sear/sauté, high" },
      { text: "Pour in the salsa." },
      { text: "Slow cook until it reaches 165°F.", minutes: 480, setting: "slow cook, low" },
    ]);
    assert.deepEqual(slow.tips, ["No oven needed: it all happens in one pot.", "Start it by 9 am.", "a", "b", "c"]);
    assert.deepEqual([slow.prepMinutes, slow.cookMinutes], [15, 480]);
    assert.equal(slow.minutes, 240, "an app that doesn't ask for detail keeps the 4-hour ceiling it expects");
    assert.equal(validateIdeas(parsed, { count: 3, detail: true }).ideas[0].minutes, 495);
    assert.deepEqual([chops.minutes, chops.prepMinutes, chops.cookMinutes], [22, 10, 12], "no total given: prep + cook");
    assert.deepEqual(chops.tips, []);
  });

  test("POST /api/ideas: rules + format and sides + catalog are cached blocks; the answer carries the new fields", async () => {
    const KEY = familyKey("claude kitchen");
    const w = await startWorker({ anthropic: true, bindings: { ANTHROPIC_API_KEY: TEST_KEY } });
    try {
      assert.equal((await w.call("/api/setup", { method: "POST", body: { key: KEY } })).status, 201);
      w.setClaude(() => reply(JSON.stringify({ ideas: [{
        title: "Braised chicken thighs with green beans", subtitle: "One pot.", why: "Uses the thighs.", prepMinutes: 15, cookMinutes: 300, minutes: 315,
        equipment: ["possible cooker"], protein: "chicken", category: "Comfort", items: [{ name: "Chicken thighs", qty: 3, unit: "lb", matchId: "chicken" }],
        sides: ["broccoli"], steps: [{ text: "Braise until 165°F.", minutes: 300, setting: "braise" }], tips: ["Keep warm until dinner."], usesPantry: ["chicken"],
      }] }), { input: 900, output: 700, read: 3000 }));
      const body = {
        note: "Something for the PossibleCooker",
        pantry: [{ id: "chicken", name: "Chicken thighs", qty: 3, unit: "lb", useBy: "2026-11-17" }],
        sides: [{ id: "broccoli", title: "Steamed broccoli", kind: "vegetable" }],
        catalog: [{ id: "chicken", name: "Chicken thighs", unit: "lb" }],
        count: 1,
      };
      const r = await w.call("/api/ideas", { method: "POST", key: KEY, body: { ...body, detail: true } });
      assert.equal(r.status, 200, r.text);
      const idea = r.json.ideas[0];
      assert.deepEqual([idea.minutes, idea.prepMinutes, idea.cookMinutes], [315, 15, 300]);
      assert.deepEqual(idea.steps, ["Braise until 165°F."]);
      assert.deepEqual(idea.stepDetails, [{ text: "Braise until 165°F.", minutes: 300, setting: "braise" }]);
      assert.deepEqual(idea.tips, ["Keep warm until dinner."]);
      assert.deepEqual(idea.equipment, ["possible cooker"]);
      assert.equal(r.json.usage.cacheHit, true);
      near(r.json.usage.usd, Math.round(900 * 4 + 3000 * 0.2 + 700 * 20) / 1e6);

      const sent = w.claudeCalls[0].body;
      assert.equal(sent.system.length, 2);
      assert.ok(sent.system.every((b) => b.cache_control && b.cache_control.type === "ephemeral"));
      assert.match(sent.system[0].text, /PossibleCooker/);
      assert.match(sent.system[0].text, /FOR EACH IDEA RETURN/);
      assert.equal(sent.system[1].text, ideasReference(body));
      const user = sent.messages[0].content.at(-1).text;
      assert.match(user, /Something for the PossibleCooker/);
      assert.match(user, /chicken = Chicken thighs — 3 lb \(use by 2026-11-17\)/);
      assert.ok(!user.includes("SIDES (id"));

      // The same request without detail (an app from before today): the long cook is capped, nothing else changes.
      const plain = await w.call("/api/ideas", { method: "POST", key: KEY, body });
      assert.equal(plain.json.ideas[0].minutes, 240);
      assert.deepEqual(plain.json.ideas[0].steps, ["Braise until 165°F."]);
      assert.deepEqual(w.claudeCalls[1].body.system, sent.system, "the second request reads the first one's cache");
    } finally {
      await w.dispose();
    }
  });
});
