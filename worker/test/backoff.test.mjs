import { test } from "node:test";
import assert from "node:assert/strict";
import { startWorker, familyKey } from "./helpers.mjs";

const KEY = familyKey("1234");
const WRONG = familyKey("4321");

async function freshWithPasscode() {
  const w = await startWorker();
  const r = await w.call("/api/setup", { method: "POST", body: { key: KEY } });
  assert.equal(r.status, 201);
  return w;
}

test("5 wrong keys in 10 minutes → 429 with Retry-After, even for the right key", async () => {
  const w = await freshWithPasscode();
  try {
    for (let i = 1; i <= 5; i++) {
      const r = await w.call("/api/state", { key: WRONG, ip: "203.0.113.7" });
      assert.equal(r.status, 401, `attempt ${i} should be 401`);
      if (i === 5) {
        assert.equal(r.json.locked, true);
        assert.ok(Number(r.headers.get("retry-after")) > 0);
      } else {
        assert.equal(r.json.locked, undefined);
      }
    }
    const locked = await w.call("/api/state", { key: KEY, ip: "203.0.113.7" });
    assert.equal(locked.status, 429);
    assert.equal(typeof locked.json.error, "string");
    const retry = Number(locked.headers.get("retry-after"));
    assert.ok(retry > 500 && retry <= 600, `Retry-After ${retry}s should be ~10 minutes`);
    assert.equal(locked.json.retryAfter, retry);
    assert.match(locked.headers.get("access-control-expose-headers"), /Retry-After/);

    // Every key-checked endpoint honours the lock.
    const ops = await w.call("/api/ops", { method: "POST", key: KEY, ip: "203.0.113.7", body: { ops: [{ op: "set", path: ["a"], value: 1 }] } });
    assert.equal(ops.status, 429);
    const rotate = await w.call("/api/key", { method: "POST", key: KEY, ip: "203.0.113.7", body: { newKey: WRONG } });
    assert.equal(rotate.status, 429);
    const scan = await w.call("/api/scan", { method: "POST", key: KEY, ip: "203.0.113.7", body: { image: "x" } });
    assert.equal(scan.status, 429);

    // Health stays open and cheap.
    const health = await w.call("/api/health", { ip: "203.0.113.7" });
    assert.equal(health.status, 200);

    // Another device/network is not locked out by one client's typos.
    const other = await w.call("/api/state", { key: KEY, ip: "198.51.100.20" });
    assert.equal(other.status, 200);
  } finally {
    await w.dispose();
  }
});

test("a correct key resets that client's counter", async () => {
  const w = await freshWithPasscode();
  try {
    for (let i = 0; i < 4; i++) assert.equal((await w.call("/api/state", { key: WRONG, ip: "192.0.2.1" })).status, 401);
    assert.equal((await w.call("/api/state", { key: KEY, ip: "192.0.2.1" })).status, 200);
    for (let i = 0; i < 4; i++) assert.equal((await w.call("/api/state", { key: WRONG, ip: "192.0.2.1" })).status, 401);
    assert.equal((await w.call("/api/state", { key: KEY, ip: "192.0.2.1" })).status, 200);
  } finally {
    await w.dispose();
  }
});

test("a missing key header is a 401 but does not count toward the lockout", async () => {
  const w = await freshWithPasscode();
  try {
    for (let i = 0; i < 8; i++) assert.equal((await w.call("/api/state", { ip: "192.0.2.9" })).status, 401);
    assert.equal((await w.call("/api/state", { key: KEY, ip: "192.0.2.9" })).status, 200);
  } finally {
    await w.dispose();
  }
});

test("40 wrong keys from many addresses trigger a global cool-down", async () => {
  const w = await freshWithPasscode();
  try {
    for (let i = 0; i < 40; i++) {
      const r = await w.call("/api/state", { key: WRONG, ip: `10.0.${Math.floor(i / 200)}.${i % 200}` });
      assert.equal(r.status, 401);
    }
    const r = await w.call("/api/state", { key: KEY, ip: "172.16.0.1" });
    assert.equal(r.status, 429);
    assert.ok(Number(r.headers.get("retry-after")) > 0);
  } finally {
    await w.dispose();
  }
});
