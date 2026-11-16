// docs/spec/23: POST /api/photo/fetch. The Worker downloads a store's product picture itself, only
// from the stores' own image hosts, and keeps it with the family's pantry pictures. The outbound
// fetch is answered by this test (helpers.mjs setOutbound), so every request the Worker makes is seen.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startWorker, familyKey } from "./helpers.mjs";

const KEY = familyKey("supper for five");
const JEWEL = "https://images.albertsons-media.com/is/image/ABS/184070124";
const SAMS = "https://scene7.samsclub.com/is/image/samsclub/0007874235186_A";
const ASR = "https://i5.samsclubimages.com/asr/7d8a3a52-aaaa-bbbb-cccc-0123456789ab.e0f1.jpeg";

const jpeg = (size = 3000, fill = 0x41) => {
  const b = Buffer.alloc(size, fill);
  b.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01], 0);
  return new Uint8Array(b);
};
const webp = (size = 900) => {
  const b = Buffer.alloc(size, 7);
  b.write("RIFF", 0, "ascii");
  b.write("WEBP", 8, "ascii");
  return new Uint8Array(b);
};
const picture = (bytes = jpeg(), type = "image/jpeg", extra = {}) => new Response(bytes, { status: 200, headers: { "Content-Type": type, ...extra } });

let w;
let asked; // every outbound request: { url, headers }
const outbound = (fn) => w.setOutbound(async (url, request) => {
  asked.push({ url, headers: Object.fromEntries(request.headers) });
  return fn(url, request);
});
const fetchPhoto = (url, extra = {}, opts = {}) => w.call("/api/photo/fetch", { method: "POST", key: KEY, body: { url, ...extra }, ...opts });

before(async () => {
  w = await startWorker({ bindings: { PHOTO_CLEANUP_GRACE_HOURS: "0" } });
  assert.equal((await w.call("/api/setup", { method: "POST", body: { key: KEY } })).status, 201);
});
after(async () => {
  await w.dispose();
});
beforeEach(() => {
  asked = [];
  outbound(() => picture());
});

test("a Jewel-Osco picture: asked for at 480 px with the link's own query dropped, stored, served back, and reused", async () => {
  const bytes = jpeg(4321);
  outbound(() => picture(bytes));
  const r = await fetchPhoto(`${JEWEL}?$ng-ecom-pdp-desktop$&defaultImage=Not_Available`);
  assert.equal(r.status, 201, r.text);
  assert.match(r.json.id, /^[a-f0-9]{32}$/);
  assert.deepEqual({ ...r.json, id: "x" }, { ok: true, id: "x", bytes: 4321, reused: false, mime: "image/jpeg", host: "images.albertsons-media.com", store: "jewel" });
  assert.equal(asked.length, 1);
  assert.equal(asked[0].url, `${JEWEL}?wid=480&hei=480&fit=constrain&fmt=jpeg&qlt=85&defaultImage=`);
  assert.match(asked[0].headers.accept, /image\/jpeg/);
  assert.ok(!("x-family-key" in asked[0].headers), "the family key never leaves the Worker");
  assert.doesNotMatch(asked[0].headers["user-agent"] || "", /Mozilla|Chrome|Safari/, "it doesn't pretend to be a browser");

  const got = await w.call(`/api/photo?id=${r.json.id}`, { key: KEY });
  assert.equal(got.status, 200);
  assert.equal(got.headers.get("content-type"), "image/jpeg");
  assert.equal(got.text.length, 4321);

  // The same picture again (any query): no second download, the same id.
  const again = await fetchPhoto(`${JEWEL}?wid=1200`);
  assert.equal(again.status, 200, again.text);
  assert.equal(again.json.reused, true);
  assert.equal(again.json.id, r.json.id);
  assert.equal(asked.length, 1);

  // refresh: true fetches a new copy under a new id; the old one is gone.
  const fresh = await fetchPhoto(JEWEL, { refresh: true });
  assert.equal(fresh.status, 201);
  assert.notEqual(fresh.json.id, r.json.id);
  assert.equal(asked.length, 2);
  assert.equal((await w.call(`/api/photo?id=${r.json.id}`, { key: KEY })).status, 404);
  assert.equal((await fetchPhoto(JEWEL)).json.id, fresh.json.id);
});

test("Sam's Club: both of its image hosts, each with its own size parameters; WebP and PNG are fine too", async () => {
  outbound(() => picture(webp(), "image/webp"));
  const a = await fetchPhoto(`${SAMS}?$DT_PDP_BB$`);
  assert.equal(a.status, 201, a.text);
  assert.equal(a.json.store, "sams");
  assert.equal(a.json.mime, "image/webp");
  assert.equal(asked[0].url, `${SAMS}?wid=480&hei=480&fit=constrain&fmt=jpeg&qlt=85&defaultImage=`);

  const b = await fetchPhoto(`${ASR}?odnHeight=2000&odnWidth=2000&odnBg=FFFFFF`);
  assert.equal(b.status, 201, b.text);
  assert.equal(asked[1].url, `${ASR}?odnWidth=480&odnHeight=480&odnBg=FFFFFF`);
  assert.equal(b.json.host, "i5.samsclubimages.com");

  // The type stored is what the bytes are, whatever the header claimed.
  outbound(() => picture(jpeg(), "image/png"));
  const c = await fetchPhoto(`${SAMS}2`);
  assert.equal(c.json.mime, "image/jpeg");
});

test("the family key comes first: without it nothing is said about the link and nothing is fetched", async () => {
  assert.equal((await w.call("/api/photo/fetch", { method: "POST", body: { url: JEWEL } })).status, 401);
  assert.equal((await w.call("/api/photo/fetch", { method: "POST", key: familyKey("wrong"), body: { url: "https://example.com/x.jpg" } })).status, 401);
  assert.equal((await w.call("/api/photo/fetch", { method: "GET", key: KEY })).status, 405);
  assert.equal(asked.length, 0);
});

test("only https links on the stores' own image hosts are fetched", async () => {
  const refused = [
    "http://images.albertsons-media.com/is/image/ABS/1",
    "https://example.com/picture.jpg",
    "https://images.albertsons-media.com.attacker.example/is/image/ABS/1",
    "https://user:pw@scene7.samsclub.com/is/image/samsclub/1",
    "https://scene7.samsclub.com:444/is/image/samsclub/1",
    "https://images.albertsons-media.com/is/content/ABS/statement.pdf",
    "https://i5.walmartimages.com/asr/abc.jpeg",
    "https://www.samsclub.com/ip/prod123",
    "https://169.254.169.254/latest/meta-data",
    "https://localhost/x.jpg",
    "file:///etc/passwd",
    "",
  ];
  for (const url of refused) {
    const r = await fetchPhoto(url);
    assert.equal(r.status, 400, `${url} → ${r.text}`);
    assert.ok(r.json.error.length > 5);
  }
  assert.equal((await w.call("/api/photo/fetch", { method: "POST", key: KEY, body: [JEWEL] })).status, 400);
  assert.equal((await w.call("/api/photo/fetch", { method: "POST", key: KEY, body: { url: 42 } })).status, 400);
  assert.equal(asked.length, 0, "none of them left the Worker");
});

test("redirects are followed only to https on an allowlisted host, and only twice", async () => {
  outbound((url) => (url.startsWith(`${SAMS}r`) ? new Response(null, { status: 302, headers: { Location: `${ASR}?moved=1` } }) : picture()));
  const ok = await fetchPhoto(`${SAMS}r`);
  assert.equal(ok.status, 201, ok.text);
  assert.deepEqual(asked.map((a) => new URL(a.url).hostname), ["scene7.samsclub.com", "i5.samsclubimages.com"]);

  for (const where of ["https://cdn.example.com/steal.jpg", "http://scene7.samsclub.com/is/image/samsclub/x", "https://169.254.169.254/x"]) {
    asked = [];
    outbound(() => new Response(null, { status: 301, headers: { Location: where } }));
    const r = await fetchPhoto(`${SAMS}off${where.length}`);
    assert.equal(r.status, 502, r.text);
    assert.equal(r.json.redirected, true);
    assert.equal(asked.length, 1, "the redirect was not followed");
  }

  asked = [];
  outbound((url) => new Response(null, { status: 302, headers: { Location: `${url.split("?")[0]}x` } }));
  const loop = await fetchPhoto(`${SAMS}loop`);
  assert.equal(loop.status, 502);
  assert.match(loop.json.error, /keeps redirecting/);
  assert.equal(asked.length, 3, "the first request and two hops");
});

test("a host that refuses the family server is reported as that, not worked around", async () => {
  outbound(() => new Response("Access Denied", { status: 403, headers: { "Content-Type": "text/html" } }));
  const denied = await fetchPhoto(`${SAMS}denied`);
  assert.equal(denied.status, 502, denied.text);
  assert.deepEqual({ refused: denied.json.refused, upstream: denied.json.upstream, host: denied.json.host }, { refused: true, upstream: 403, host: "scene7.samsclub.com" });
  assert.match(denied.json.error, /refused the family server \(HTTP 403\)/);
  assert.equal(asked.length, 1, "one try: no retry with other headers");

  // A web page where the picture should be (a robot check) is a refusal too.
  outbound(() => new Response("<html>Let us know you're not a robot</html>", { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }));
  const page = await fetchPhoto(`${SAMS}robot`);
  assert.equal(page.status, 502);
  assert.equal(page.json.refused, true);
  assert.match(page.json.error, /didn't send a picture \(it sent text\/html\)/);

  outbound(() => new Response("slow down", { status: 429 }));
  assert.equal((await fetchPhoto(`${SAMS}429`)).json.refused, true);

  // Scene7's own "no such picture" (a 403 that says so) and a plain 404 are "not there", not a refusal.
  outbound(() => new Response("Unable to find image", { status: 403, headers: { "Content-Type": "text/plain" } }));
  const gone = await fetchPhoto(`${SAMS}gone`);
  assert.equal(gone.status, 404, gone.text);
  assert.equal(gone.json.notFound, true);
  assert.ok(!gone.json.refused);
  outbound(() => new Response(jpeg(), { status: 404, headers: { "Content-Type": "image/jpeg" } }));
  assert.equal((await fetchPhoto(`${ASR}404`)).status, 404, "a placeholder sent with a 404 is not stored");

  // A host having a bad moment: said plainly (502), and not a refusal.
  outbound(() => new Response("oops", { status: 500 }));
  const down = await fetchPhoto(`${SAMS}500`);
  assert.equal(down.status, 502);
  assert.equal(down.json.upstream, 500);
  assert.ok(!down.json.refused);
});

test("only real JPEG, PNG or WebP bytes up to 400 KB are stored", async () => {
  const count = async () => (await w.call("/api/storage", { key: KEY })).json.photos.count;
  const before = await count();

  outbound(() => picture(jpeg(401 * 1024), "image/jpeg", { "Content-Length": String(401 * 1024) }));
  const declared = await fetchPhoto(`${SAMS}big1`);
  assert.equal(declared.status, 413, declared.text);
  assert.equal(declared.json.tooLarge, true);

  // No Content-Length (a stream): cut off at the limit.
  outbound(() => new Response(new ReadableStream({
    start(c) {
      c.enqueue(jpeg(300 * 1024));
      c.enqueue(new Uint8Array(200 * 1024));
      c.close();
    },
  }), { headers: { "Content-Type": "image/jpeg" } }));
  assert.equal((await fetchPhoto(`${SAMS}big2`)).status, 413);

  outbound(() => picture(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"), "image/svg+xml"));
  assert.equal((await fetchPhoto(`${SAMS}svg`)).status, 502, "SVG can carry script: never stored");
  outbound(() => picture(new TextEncoder().encode("<html>not a picture at all</html>"), "image/jpeg"));
  const fake = await fetchPhoto(`${SAMS}fake`);
  assert.equal(fake.status, 502);
  assert.match(fake.json.error, /isn't a JPEG, PNG or WebP picture/);
  outbound(() => picture(new TextEncoder().encode("GIF89a" + "x".repeat(200)), "image/gif"));
  assert.equal((await fetchPhoto(`${SAMS}gif`)).status, 502);
  outbound(() => picture(new Uint8Array(0)));
  assert.equal((await fetchPhoto(`${SAMS}empty`)).status, 502);

  assert.equal(await count(), before, "nothing was stored");
});

test("an uploaded pantry photo must be the picture it says it is", async () => {
  const bad = await w.call("/api/photo", { method: "POST", key: KEY, body: new TextEncoder().encode("<html>hello there, not a picture</html>"), headers: { "Content-Type": "image/jpeg" } });
  assert.equal(bad.status, 415);
  const ok = await w.call("/api/photo", { method: "POST", key: KEY, body: jpeg(500), headers: { "Content-Type": "image/webp" } });
  assert.equal(ok.status, 201);
  assert.equal((await w.call(`/api/photo?id=${ok.json.id}`, { key: KEY })).headers.get("content-type"), "image/jpeg", "stored as what the bytes are");
  await w.call("/api/photo/delete", { method: "POST", key: KEY, body: { id: ok.json.id } });
});

test("cleanup removes pictures nothing in the family state points to, and only those", async () => {
  const ops = (list) => w.call("/api/ops", { method: "POST", key: KEY, body: { ops: list, by: "Jeff", clientId: "t" } });
  const kept = await fetchPhoto(`${JEWEL}kept`);
  const orphan = await fetchPhoto(`${JEWEL}orphan`);
  const own = await w.call("/api/photo", { method: "POST", key: KEY, body: webp(), headers: { "Content-Type": "image/webp" } });
  const ownOrphan = await w.call("/api/photo", { method: "POST", key: KEY, body: webp(700), headers: { "Content-Type": "image/webp" } });
  assert.equal((await ops([
    { op: "set", path: ["storePhotos", "chicken"], value: { photo: kept.json.id, store: "jewel", product: "Chicken", at: "2026-11-15" } },
    { op: "set", path: ["itemPhotos", "marinara"], value: { photo: own.json.id, at: "2026-11-15", by: "Candi" } },
  ])).status, 200);

  assert.equal((await w.call("/api/photo/cleanup", { method: "POST", body: {} })).status, 401);
  const dry = await w.call("/api/photo/cleanup", { method: "POST", key: KEY, body: { dryRun: true } });
  assert.equal(dry.status, 200, dry.text);
  assert.equal(dry.json.dryRun, true);
  assert.ok(dry.json.removed >= 2);
  assert.equal((await w.call(`/api/photo?id=${orphan.json.id}`, { key: KEY })).status, 200, "a dry run removes nothing");

  const real = await w.call("/api/photo/cleanup", { method: "POST", key: KEY });
  assert.equal(real.status, 200, real.text);
  assert.equal(real.json.removed, dry.json.removed);
  assert.ok(real.json.bytesFreed > 0);
  assert.equal(real.json.kept, 2);
  for (const [id, status] of [[kept.json.id, 200], [own.json.id, 200], [orphan.json.id, 404], [ownOrphan.json.id, 404]]) {
    assert.equal((await w.call(`/api/photo?id=${id}`, { key: KEY })).status, status);
  }
  const s = (await w.call("/api/storage", { key: KEY })).json.photos;
  assert.deepEqual({ count: s.count, store: s.store, own: s.own, unused: s.unused }, { count: 2, store: 1, own: 1, unused: 0 });
});

test("too many picture fetches at once are slowed down (429), but pictures already here still answer", async () => {
  const w2 = await startWorker({ bindings: { RATE_PHOTOFETCH: "3" } });
  try {
    w2.setOutbound(() => picture());
    assert.equal((await w2.call("/api/setup", { method: "POST", body: { key: KEY } })).status, 201);
    const go = (n) => w2.call("/api/photo/fetch", { method: "POST", key: KEY, body: { url: `${JEWEL}${n}` } });
    for (const n of [1, 2, 3]) assert.equal((await go(n)).status, 201);
    const limited = await go(4);
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
    assert.equal((await go(1)).status, 200, "a picture the server already has doesn't count: re-running an import is free");
  } finally {
    await w2.dispose();
  }
});
