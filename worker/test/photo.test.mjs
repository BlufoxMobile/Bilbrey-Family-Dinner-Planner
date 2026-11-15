// v2.5.4: pantry photos live in the family's passcode-protected storage.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startWorker, familyKey } from "./helpers.mjs";

const KEY = familyKey("supper for five");
let w;
const webp = () => {
  const b = Buffer.alloc(900, 7);
  b.write("RIFF", 0, "ascii");
  b.write("WEBP", 8, "ascii");
  return new Uint8Array(b);
};

before(async () => {
  w = await startWorker();
  assert.equal((await w.call("/api/setup", { method: "POST", body: { key: KEY } })).status, 201);
});
after(async () => {
  await w.dispose();
});

test("a photo goes in with the family key and comes back byte for byte", async () => {
  const bytes = webp();
  const put = await w.call("/api/photo", { method: "POST", key: KEY, body: bytes, headers: { "Content-Type": "image/webp" } });
  assert.equal(put.status, 201);
  assert.match(put.json.id, /^[a-f0-9]{32}$/);
  assert.equal(put.json.bytes, bytes.byteLength);
  const get = await w.call(`/api/photo?id=${put.json.id}`, { key: KEY });
  assert.equal(get.status, 200);
  assert.equal(get.headers.get("content-type"), "image/webp");
  assert.match(get.headers.get("cache-control"), /private/);
  assert.equal(get.headers.get("access-control-allow-origin"), "https://blufoxmobile.github.io");
  assert.equal(get.text.length, bytes.byteLength);
});

test("no key, no photo; wrong type and empty bodies are refused", async () => {
  const put = await w.call("/api/photo", { method: "POST", key: KEY, body: webp(), headers: { "Content-Type": "image/webp" } });
  assert.equal((await w.call(`/api/photo?id=${put.json.id}`, {})).status, 401);
  assert.equal((await w.call("/api/photo", { method: "POST", body: webp(), headers: { "Content-Type": "image/webp" } })).status, 401);
  assert.equal((await w.call("/api/photo", { method: "POST", key: KEY, body: "hello", headers: { "Content-Type": "text/plain" } })).status, 415);
  assert.equal((await w.call("/api/photo", { method: "POST", key: KEY, body: new Uint8Array(0), headers: { "Content-Type": "image/jpeg" } })).status, 400);
  assert.equal((await w.call("/api/photo?id=nope", { key: KEY })).status, 400);
  assert.equal((await w.call(`/api/photo?id=${"0".repeat(32)}`, { key: KEY })).status, 404);
});

test("too large is refused; delete removes it", async () => {
  const big = new Uint8Array(401 * 1024);
  assert.equal((await w.call("/api/photo", { method: "POST", key: KEY, body: big, headers: { "Content-Type": "image/jpeg" } })).status, 413);
  const put = await w.call("/api/photo", { method: "POST", key: KEY, body: webp(), headers: { "Content-Type": "image/webp" } });
  assert.equal((await w.call("/api/photo/delete", { method: "POST", key: KEY, body: { id: put.json.id } })).status, 200);
  assert.equal((await w.call(`/api/photo?id=${put.json.id}`, { key: KEY })).status, 404);
});
