// Shared test harness: runs the real Worker + SQLite Durable Object in workerd via Miniflare,
// with the Workers AI binding replaced by a scriptable mock implemented in this Node process.
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

// Keep the test runtime on the same compatibility date as wrangler.toml / DEPLOY.md.
const COMPAT_DATE = /compatibility_date\s*=\s*"([^"]+)"/.exec(readFileSync(here("../wrangler.toml"), "utf8"))[1];

export const ORIGIN = "https://blufoxmobile.github.io";
export const BASE = "https://bilbrey-dinner-planner.example.workers.dev";

/** The client-side derivation from SPEC §5. */
export function familyKey(passcode) {
  return createHash("sha256").update("bilbrey-dinner-planner:" + passcode.trim().toLowerCase()).digest("hex");
}

/**
 * Starts a fresh Worker with empty storage.
 * @param {{ ai?: boolean }} [opts]  ai:false starts it with no AI binding at all.
 */
export async function startWorker({ ai = true } = {}) {
  const calls = [];
  let aiHandler = () => ({ choices: [{ message: { content: '{"items":[]}' } }] });

  const options = {
    modules: [
      { type: "ESModule", path: here("./fixtures/entry.mjs") },
      { type: "ESModule", path: here("../src/index.js") },
    ],
    modulesRoot: here(".."),
    compatibilityDate: COMPAT_DATE,
    durableObjects: { KITCHEN: { className: "Kitchen", useSQLite: true } },
  };
  if (ai) {
    options.serviceBindings = {
      AI_BACKEND: async (request) => {
        const { model, inputs } = await request.json();
        calls.push({ model, inputs });
        try {
          const out = await aiHandler(model, inputs, calls.length);
          return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
        } catch (err) {
          return new Response(String(err && err.message ? err.message : err), { status: 500 });
        }
      },
    };
  }
  const mf = new Miniflare(convertV4MiniflareOptions(options));
  await mf.ready;

  async function call(path, { method = "GET", body, headers = {}, origin = ORIGIN, key, ip } = {}) {
    const h = { ...headers };
    if (origin) h.Origin = origin;
    if (key !== undefined) h["X-Family-Key"] = key;
    if (ip) h["CF-Connecting-IP"] = ip;
    let payload;
    if (body !== undefined) {
      payload = typeof body === "string" ? body : JSON.stringify(body);
      h["Content-Type"] = h["Content-Type"] || "application/json";
    }
    const res = await mf.dispatchFetch(BASE + path, { method, headers: h, body: payload });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {}
    return { status: res.status, headers: res.headers, text, json };
  }

  return {
    call,
    calls,
    /** Script the mock model: fn(model, inputs, callNumber) → response object (throw = AI error). */
    setAI(fn) {
      aiHandler = fn;
    },
    dispose: () => mf.dispose(),
  };
}

/** A tiny but genuine 1×1 PNG as a data URL. */
export const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/** Bytes that start like a JPEG (SOI + APP0) — enough for the Worker's signature check. */
export function jpegDataUrl(size = 600) {
  const buf = Buffer.alloc(size, 0x41);
  buf.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01], 0);
  return "data:image/jpeg;base64," + buf.toString("base64");
}
