import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startWorker, familyKey, PNG_DATA_URL, jpegDataUrl } from "./helpers.mjs";

const KEY = familyKey("pantry");
const PRIMARY = "@cf/google/gemma-4-26b-a4b-it";
const FALLBACK = "@cf/meta/llama-4-scout-17b-16e-instruct";

const KNOWN = [
  { id: "greenBeans", name: "Green beans", aliases: ["green beans", "cut green beans"] },
  { id: "spaghetti", name: "Spaghetti", aliases: ["spaghetti noodles"] },
  { id: "chicken", name: "Boneless skinless chicken breast", aliases: ["chicken breast", "chicken breasts"] },
  { id: "jasmine-rice", name: "Jasmine rice", aliases: [] },
  { id: "salt", name: "Kosher salt", aliases: ["salt"] },
];

let w;
const scan = (body, extra = {}) => w.call("/api/scan", { method: "POST", key: KEY, body, ...extra });

before(async () => {
  w = await startWorker();
  assert.equal((await w.call("/api/setup", { method: "POST", body: { key: KEY } })).status, 201);
});
after(async () => {
  await w.dispose();
});
beforeEach(() => {
  w.calls.length = 0;
});

const MESSY = [
  "Sure! Here's everything I can see on the shelf:",
  "```json",
  "{",
  '  "items": [',
  '    {"name": "Cut green beans, canned", "matchId": "greenBeans", "qty": 4, "unit": "Cans", "confidence": 0.93},',
  '    {"name": "Spaghetti, dry pasta", "matchId": "spaghetti-pasta-1lb", "qty": "2 boxes", "unit": "box", "confidence": 85},',
  '    {"name": "Cream of mushroom soup, canned", "matchId": "not-a-real-id", "qty": 3, "unit": "can", "confidence": 0.7},',
  '    {"name": "Jasmine rice", "matchId": null, "qty": null, "unit": "bag", "confidence": "high"},',
  '    {"name": "Cut green beans, canned", "matchId": "greenBeans", "qty": 2, "unit": "cans", "confidence": 0.8},',
  '    {"name": "Chicken breast, frozen", "matchId": "Chicken Breasts", "qty": 2.5, "unit": "lbs", "confidence": 1.04},',
  '    {"name": "Peanut butter", "matchId": "none", "qty": "1", "unit": "Jars.", "confidence": null},',
  "  ],",
  "}",
  "```",
  "Let me know if you want me to look again!",
].join("\n");

test("happy path: messy, text-wrapped JSON from the model is parsed and cleaned up", async () => {
  w.setAI(() => ({ choices: [{ index: 0, message: { role: "assistant", content: MESSY }, finish_reason: "stop" }] }));
  const r = await scan({ image: PNG_DATA_URL, known: KNOWN });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.model, PRIMARY);
  const items = r.json.items;
  assert.equal(items.length, 6, JSON.stringify(items));
  assert.deepEqual(
    items.map((i) => i.name),
    ["Cut green beans, canned", "Spaghetti, dry pasta", "Cream of mushroom soup, canned", "Jasmine rice", "Chicken breast, frozen", "Peanut butter"],
    "model order is kept and the duplicate green-bean entry is merged",
  );

  const beans = items[0];
  assert.deepEqual(beans, { name: "Cut green beans, canned", matchId: "greenBeans", qty: 6, unit: "can", confidence: 0.93 });

  const soup = items[2];
  assert.equal(soup.matchId, null, "an id the client didn't send is never passed through");
  assert.deepEqual(soup, { name: "Cream of mushroom soup, canned", matchId: null, qty: 3, unit: "can", confidence: 0.7 });

  const pasta = items[1];
  assert.equal(pasta.matchId, "spaghetti", "an unknown id falls back to an exact match on the product name");
  assert.equal(pasta.qty, 2);
  assert.equal(pasta.unit, "box");
  assert.equal(pasta.confidence, 0.85, "85 is read as 85%");

  const rice = items[3];
  assert.equal(rice.matchId, "jasmine-rice", "an exact name match maps to the catalog id");
  assert.equal(rice.qty, null);
  assert.equal(rice.unit, null);
  assert.equal(rice.confidence, 0.9);

  const chicken = items[4];
  assert.deepEqual(chicken, { name: "Chicken breast, frozen", matchId: "chicken", qty: 2.5, unit: "lb", confidence: 1 });

  const pb = items[5];
  assert.deepEqual(pb, { name: "Peanut butter", matchId: null, qty: 1, unit: "jar", confidence: 0.5 });

  for (const it of items) {
    assert.deepEqual(Object.keys(it).sort(), ["confidence", "matchId", "name", "qty", "unit"]);
    assert.ok(it.confidence >= 0 && it.confidence <= 1);
  }

  // What the Worker sent to Workers AI.
  assert.equal(w.calls.length, 1);
  const { model, inputs } = w.calls[0];
  assert.equal(model, PRIMARY);
  assert.equal(inputs.messages[0].role, "system");
  const user = inputs.messages[1];
  assert.equal(user.role, "user");
  const text = user.content.find((p) => p.type === "text").text;
  const img = user.content.find((p) => p.type === "image_url");
  assert.equal(img.image_url.url, PNG_DATA_URL);
  assert.equal(img.image_url.detail, "high");
  for (const k of KNOWN) assert.ok(text.includes(`${k.id} = ${k.name}`), `prompt lists ${k.id}`);
  assert.ok(text.includes("cut green beans"), "aliases are in the prompt");
  assert.equal(inputs.response_format.type, "json_schema");
  assert.equal(inputs.response_format.json_schema.name, "pantry_scan");
  assert.deepEqual(inputs.response_format.json_schema.schema.required, ["items"]);
  assert.deepEqual(inputs.chat_template_kwargs, { enable_thinking: false });
  assert.ok(inputs.max_completion_tokens > 0);
});

test("legacy Workers AI shape { response: <object> } (JSON mode) is accepted", async () => {
  w.setAI(() => ({ response: { items: [{ name: "Kosher salt", matchId: "salt", qty: 1, unit: "box", confidence: 0.95 }] } }));
  const r = await scan({ image: jpegDataUrl(), known: KNOWN });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.items, [{ name: "Kosher salt", matchId: "salt", qty: 1, unit: "box", confidence: 0.95 }]);
});

test("an empty shelf is a valid answer", async () => {
  w.setAI(() => ({ response: '{"items": []}' }));
  const r = await scan({ image: PNG_DATA_URL, known: [] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { items: [], model: PRIMARY, engine: "workers-ai" });
  assert.equal(w.calls.length, 1);
});

test("output cut off by the token limit still yields the complete items", async () => {
  w.setAI(() => ({
    choices: [{ message: { content: '{"items":[{"name":"Chicken breasts, frozen","matchId":"chicken","qty":3,"unit":"lb","confidence":0.8},{"name":"Spaghetti","matchId":"spag' } }],
  }));
  const r = await scan({ image: PNG_DATA_URL, known: KNOWN });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.items, [{ name: "Chicken breasts, frozen", matchId: "chicken", qty: 3, unit: "lb", confidence: 0.8 }]);
});

test("if the primary model errors, the fallback model answers (one retry, no JSON mode)", async () => {
  w.setAI((model) => {
    if (model === PRIMARY) throw new Error("5007: No such model or capacity exceeded");
    return { response: 'Items:\n[{"name":"Spaghetti, dry pasta","matchId":"spaghetti","qty":2,"unit":"box","confidence":0.9}]' };
  });
  const r = await scan({ image: PNG_DATA_URL, known: KNOWN });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.model, FALLBACK);
  assert.deepEqual(r.json.items, [{ name: "Spaghetti, dry pasta", matchId: "spaghetti", qty: 2, unit: "box", confidence: 0.9 }]);
  assert.equal(w.calls.length, 2);
  const fb = w.calls[1].inputs;
  assert.equal(fb.response_format, undefined);
  assert.equal(fb.chat_template_kwargs, undefined);
  assert.ok(fb.max_tokens > 0);
  assert.equal(fb.messages[1].content.find((p) => p.type === "image_url").image_url.url, PNG_DATA_URL);
});

test("unparseable output from the primary also falls back", async () => {
  w.setAI((model) =>
    model === PRIMARY
      ? { choices: [{ message: { content: "I'm sorry, I can't help with that." } }] }
      : { response: '{"items":[{"name":"Ketchup","matchId":null,"qty":1,"unit":"bottle","confidence":0.6}]}' },
  );
  const r = await scan({ image: PNG_DATA_URL, known: KNOWN });
  assert.equal(r.status, 200);
  assert.equal(r.json.model, FALLBACK);
  assert.equal(r.json.items[0].name, "Ketchup");
});

test("when every model fails the client gets 502 { error } and the Worker keeps working", async () => {
  w.setAI(() => {
    throw new Error("InferenceUpstreamError: 3040 out of capacity");
  });
  const r = await scan({ image: PNG_DATA_URL, known: KNOWN });
  assert.equal(r.status, 502);
  assert.equal(typeof r.json.error, "string");
  assert.match(r.json.detail, /out of capacity/);
  assert.equal(w.calls.length, 2, "never more than two AI calls per scan");
  assert.equal(r.headers.get("access-control-allow-origin"), "https://blufoxmobile.github.io");

  w.setAI(() => ({ weird: true }));
  const r2 = await scan({ image: PNG_DATA_URL, known: KNOWN });
  assert.equal(r2.status, 502);

  const health = await w.call("/api/health");
  assert.equal(health.status, 200);
});

test("bad images are rejected with 400 before any AI call", async () => {
  const bad = [
    undefined,
    "",
    42,
    "https://example.com/pantry.jpg",
    "data:text/plain;base64,SGVsbG8gd29ybGQhIEhlbGxvIHdvcmxkISBIZWxsbyB3b3JsZCEgSGVsbG8gd29ybGQhIEhlbGxvIHdvcmxkIQ==",
    "data:image/jpeg;base64,not*base64!",
    "data:image/jpeg;base64,QUJD", // far too small
    "data:image/png;base64," + Buffer.alloc(300, 7).toString("base64"), // right label, not an image
    "data:image/jpeg;base64," + Buffer.from("%PDF-1.7 " + "x".repeat(200)).toString("base64"),
  ];
  for (const image of bad) {
    const r = await scan({ image, known: KNOWN });
    assert.equal(r.status, 400, `image ${String(image).slice(0, 40)} → ${r.status} ${r.text}`);
    assert.equal(typeof r.json.error, "string");
  }
  const notJson = await scan("this is not json");
  assert.equal(notJson.status, 400);
  const badKnown = await scan({ image: PNG_DATA_URL, known: "chicken" });
  assert.equal(badKnown.status, 400);
  assert.equal(w.calls.length, 0);
});

test("images over 1.5 MB are refused (413)", async () => {
  const big = jpegDataUrl(1.2 * 1024 * 1024); // ~1.6 MB once base64-encoded
  assert.ok(big.length > 1.5 * 1024 * 1024);
  const r = await scan({ image: big, known: KNOWN });
  assert.equal(r.status, 413);
  assert.match(r.json.error, /1\.5 MB/);
  assert.equal(w.calls.length, 0);

  const justUnder = jpegDataUrl(1.1 * 1024 * 1024);
  assert.ok(justUnder.length < 1.5 * 1024 * 1024);
  w.setAI(() => ({ response: '{"items":[]}' }));
  const ok = await scan({ image: justUnder, known: KNOWN });
  assert.equal(ok.status, 200);
});

test("scan without an AI binding is a clear 503", async () => {
  const noAi = await startWorker({ ai: false });
  try {
    await noAi.call("/api/setup", { method: "POST", body: { key: KEY } });
    const r = await noAi.call("/api/scan", { method: "POST", key: KEY, body: { image: PNG_DATA_URL, known: [] } });
    assert.equal(r.status, 503);
    assert.equal(typeof r.json.error, "string");
  } finally {
    await noAi.dispose();
  }
});

test("brand and label pass through; a form tag keeps canned items off fresh or frozen catalog items", async () => {
  const known = [
    { id: "mushrooms", name: "Sliced mushrooms [refrigerated]", aliases: ["mushrooms", "sliced mushrooms"] },
    { id: "peas", name: "Frozen peas [frozen]", aliases: ["peas", "sweet peas"] },
    { id: "marinara", name: "Marinara sauce (Rao's Homemade) [shelf-stable]", aliases: ["marinara", "marinara sauce"] },
    { id: "chicken", name: "Chicken breasts [frozen]", aliases: ["chicken breasts"] },
  ];
  const items = [
    { name: "Sliced mushrooms, canned", brand: "Green Giant", label: "Pieces & Stems Mushrooms", matchId: "mushrooms", qty: 6, unit: "can", confidence: 0.9 },
    { name: "Sweet peas, canned", brand: "Del Monte", label: "Sweet Peas", matchId: null, qty: 2, unit: "can", confidence: 0.9 },
    { name: "Marinara sauce, jarred", brand: "Rao's", label: "Homemade Marinara Sauce", matchId: "marinara", qty: 1, unit: "jar", confidence: 0.95 },
    { name: "Chicken breasts, frozen", brand: "null", label: "N/A", matchId: "chicken", qty: 3, unit: "lb", confidence: 0.8 },
  ];
  w.setAI(() => ({ choices: [{ message: { content: JSON.stringify({ items }) } }] }));
  const r = await scan({ image: PNG_DATA_URL, known });
  assert.equal(r.status, 200, r.text);
  const [mush, peas, sauce, chicken] = r.json.items;
  assert.equal(mush.matchId, null, "canned mushrooms are not the fresh ones, even when the model says so");
  assert.equal(mush.brand, "Green Giant");
  assert.equal(mush.label, "Pieces & Stems Mushrooms");
  assert.equal(peas.matchId, null, "the name fallback doesn't match canned peas to frozen peas");
  assert.equal(sauce.matchId, "marinara");
  assert.equal(sauce.brand, "Rao's");
  assert.equal(sauce.label, "Homemade Marinara Sauce");
  assert.equal(chicken.matchId, "chicken", "frozen matches frozen");
  assert.equal(chicken.brand, undefined, '"null" and "N/A" are not brands');
  assert.equal(chicken.label, undefined);
  const text = w.calls[0].inputs.messages[1].content.find((p) => p.type === "text").text;
  assert.ok(text.includes('"brand"') && text.includes('"label"'), "the prompt asks for brand and label");
  assert.deepEqual(w.calls[0].inputs.response_format.json_schema.schema.properties.items.items.required, ["name", "brand", "label", "matchId", "qty", "unit", "confidence", "box"]);
});

test("a scanned product's box comes back in thousandths, and nonsense boxes are dropped", async () => {
  w.setAI(() => ({ response: { items: [
    { name: "Cut green beans, canned", matchId: "greenBeans", qty: 2, unit: "can", confidence: 0.9, box: [120, 340, 410, 620] },
    { name: "Spaghetti, dry pasta", matchId: "spaghetti", qty: 1, unit: "box", confidence: 0.9, box: [0.1, 0.2, 0.5, 0.9] },
    { name: "Jasmine rice", matchId: "jasmine-rice", qty: 1, unit: "bag", confidence: 0.9, box: [400, 300, 410, 900] },
    { name: "Kosher salt", matchId: "salt", qty: 1, unit: "box", confidence: 0.9, box: [500, 300, 100, 900] },
  ] } }));
  const r = await scan({ image: PNG_DATA_URL, known: KNOWN });
  assert.equal(r.status, 200);
  const by = Object.fromEntries(r.json.items.map((i) => [i.matchId, i.box ?? null]));
  assert.deepEqual(by.greenBeans, [120, 340, 410, 620]);
  assert.deepEqual(by.spaghetti, [100, 200, 500, 900], "fractions scale up");
  assert.equal(by["jasmine-rice"], null, "too thin");
  assert.equal(by.salt, null, "out of order");
});
