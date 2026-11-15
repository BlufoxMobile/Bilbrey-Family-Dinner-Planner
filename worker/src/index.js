/**
 * The Bilbrey Family Dinner Planner — backend Worker (`bilbrey-dinner-planner`).
 *
 * One ES-module file, no runtime dependencies (only the built-in `cloudflare:workers`).
 * Contract: SPEC.md §4 (shared state + ops) and §5 (endpoints, family key, CORS, limits).
 *
 *   GET  /api/health           → { ok, hasPasscode, ai, revision, ... }              (no auth, no AI call)
 *   POST /api/setup  {key}     → 201 { ok }  only while no passcode exists, else 409   (no auth)
 *   POST /api/key    {newKey}  → { ok }       rotate the family key (X-Family-Key = current key)
 *   GET  /api/state?since=N    → { revision, updatedAt, state } | { revision, unchanged: true }
 *   POST /api/ops    {ops,by,clientId[,batchId]} → { revision, updatedAt, state }
 *   POST /api/scan   {image,known}               → { items:[{name,matchId,qty,unit,confidence}], model }
 *
 * State lives in ONE SQLite-backed Durable Object (`Kitchen`, idFromName("bilbrey")), so every
 * read and write is strongly consistent and ops batches apply atomically, in arrival order.
 * The only Workers AI call is POST /api/scan. Nothing runs on a schedule.
 */
import { DurableObject } from "cloudflare:workers";

const SERVICE = "bilbrey-dinner-planner";
const VERSION = "2.0.0";
const KITCHEN_NAME = "bilbrey";

// ── CORS (SPEC §5) ────────────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = new Set(["https://blufoxmobile.github.io"]);
const LOCAL_ORIGIN_RE = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/;
const ALLOW_METHODS = "GET, POST, OPTIONS";
const ALLOW_HEADERS = "Content-Type, X-Family-Key, X-Client-Id";
const EXPOSE_HEADERS = "X-Revision, Retry-After";

// ── Limits (SPEC §5) ──────────────────────────────────────────────────────────────────────────
const MB = 1024 * 1024;
const LIMITS = {
  maxOps: 200, // ops per POST /api/ops
  maxStateBytes: 1 * MB, // UTF-8 bytes of the stored state JSON
  maxImageChars: Math.floor(1.5 * MB), // length of the image data URL
  maxOpsBody: 2 * MB, // request body bytes for /api/ops
  maxScanBody: 2 * MB, // request body bytes for /api/scan (image + known list)
  maxSmallBody: 16 * 1024, // /api/setup and /api/key
  maxPathDepth: 32,
  maxSegmentLength: 200,
  maxValueDepth: 48,
  maxKnown: 600,
  maxScanItems: 60,
};

// ── Family-key backoff ────────────────────────────────────────────────────────────────────────
// 5 wrong keys from one client (IP) inside 10 minutes → that client gets 429 for 10 minutes.
// 40 wrong keys from anywhere inside 10 minutes → everyone gets 429 for 10 minutes (slows a
// distributed guesser). A correct key clears that client's counter.
const BACKOFF = {
  windowMs: 10 * 60 * 1000,
  perClient: 5,
  global: 40,
  lockMs: 10 * 60 * 1000,
};
const GLOBAL_CLIENT = "*";

// ── Pantry scan models (Workers AI) ───────────────────────────────────────────────────────────
// Primary: Gemma 4 26B A4B — vision + OCR-strong, JSON-schema output, thinking can be switched off,
// cheapest vision model on the Free plan (9,091 neurons / M input tokens, 27,273 / M output).
// Fallback (only if the primary errors or returns nothing parseable): Llama 4 Scout 17B 16E.
// Either can be overridden with plain-text vars SCAN_MODEL / SCAN_FALLBACK_MODEL.
const SCAN_MODEL = "@cf/google/gemma-4-26b-a4b-it";
const SCAN_FALLBACK_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";
const SCAN_TIMEOUT_MS = 45_000;
const SCAN_MAX_TOKENS = 2500;

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const KEY_RE = /^[0-9a-f]{64}$/;

class HttpError extends Error {
  constructor(status, message, extra = undefined, headers = undefined) {
    super(message);
    this.status = status;
    this.extra = extra;
    this.headers = headers;
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Worker entry
// ═════════════════════════════════════════════════════════════════════════════════════════════
export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin");
    try {
      return await route(request, env, origin);
    } catch (err) {
      if (err instanceof HttpError) {
        return json(err.status, { error: err.message, ...(err.extra || {}) }, origin, err.headers);
      }
      console.error("Unhandled error:", err && err.stack ? err.stack : err);
      return json(500, { error: "Something went wrong on the server. Please try again." }, origin);
    }
  },
};

const ROUTES = {
  "/api/health": { GET: handleHealth },
  "/api/setup": { POST: handleSetup },
  "/api/key": { POST: handleRotateKey },
  "/api/state": { GET: handleGetState },
  "/api/ops": { POST: handleOps },
  "/api/scan": { POST: handleScan },
};

async function route(request, env, origin) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method.toUpperCase();

  // A browser on any other site gets a plain 403 with no Access-Control-Allow-Origin, so it can
  // neither read responses nor spend AI neurons. Requests with no Origin (curl, smoke tests) pass.
  if (origin !== null && !isAllowedOrigin(origin)) {
    return json(403, { error: "This origin is not allowed to use the Bilbrey Family Dinner Planner API." }, null);
  }

  if (method === "OPTIONS") return preflight(origin);

  const handlers = Object.prototype.hasOwnProperty.call(ROUTES, path) ? ROUTES[path] : null;
  if (!handlers) {
    if (path === "/") {
      return json(200, { ok: true, service: SERVICE, version: VERSION, health: "/api/health" }, origin);
    }
    throw new HttpError(404, `Not found: ${path}`);
  }
  const handler = Object.prototype.hasOwnProperty.call(handlers, method) ? handlers[method] : null;
  if (!handler) {
    const allow = Object.keys(handlers).concat("OPTIONS").join(", ");
    throw new HttpError(405, `Use ${Object.keys(handlers).join(" or ")} for ${path}`, undefined, { Allow: allow });
  }
  return handler(request, env, url, origin);
}

// ── Handlers ──────────────────────────────────────────────────────────────────────────────────
async function handleHealth(request, env, url, origin) {
  const ai = hasAI(env);
  try {
    const info = await kitchen(env).info();
    return json(200, {
      ok: true,
      hasPasscode: info.hasPasscode,
      ai,
      revision: info.revision,
      updatedAt: info.updatedAt,
      service: SERVICE,
      version: VERSION,
      scanModel: ai ? scanModels(env)[0] : null,
    }, origin);
  } catch (err) {
    console.error("Health check failed:", err && err.stack ? err.stack : err);
    return json(503, { ok: false, error: "Storage is unavailable right now.", ai, service: SERVICE, version: VERSION }, origin);
  }
}

async function handleSetup(request, env, url, origin) {
  const body = parseJson(await readBodyText(request, LIMITS.maxSmallBody));
  const key = normalizeKey(isPlainObject(body) ? body.key : undefined);
  if (!key) throw new HttpError(400, "key must be the 64-character hex SHA-256 family key (never the raw passcode).");
  return fromResult(await kitchen(env).setup(key), origin);
}

async function handleRotateKey(request, env, url, origin) {
  const text = await readBodyText(request, LIMITS.maxSmallBody);
  return fromResult(await kitchen(env).rotateKey(familyKey(request), clientOf(request), text), origin);
}

async function handleGetState(request, env, url, origin) {
  const raw = url.searchParams.get("since");
  const since = raw !== null && /^\d{1,15}$/.test(raw.trim()) ? Number(raw.trim()) : null;
  return fromResult(await kitchen(env).getState(familyKey(request), clientOf(request), since), origin);
}

async function handleOps(request, env, url, origin) {
  const text = await readBodyText(request, LIMITS.maxOpsBody);
  return fromResult(await kitchen(env).applyOps(familyKey(request), clientOf(request), text), origin);
}

async function handleScan(request, env, url, origin) {
  const auth = await kitchen(env).authorize(familyKey(request), clientOf(request));
  if (auth.status !== 200) return fromResult(auth, origin);
  if (!hasAI(env)) {
    throw new HttpError(503, "Pantry scan isn't available: the Workers AI binding (AI) is not configured on this Worker.");
  }
  const body = parseJson(await readBodyText(request, LIMITS.maxScanBody));
  if (!isPlainObject(body)) throw new HttpError(400, "Body must be a JSON object like { image, known }.");
  const image = validateImage(body.image);
  const known = cleanKnown(body.known);
  const result = await runScan(env, image, known);
  return json(200, result, origin);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Durable Object: the family kitchen (state document + family key + backoff counters)
// ═════════════════════════════════════════════════════════════════════════════════════════════
export class Kitchen extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS doc (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      state TEXT NOT NULL,
      revision INTEGER NOT NULL,
      updated_at TEXT,
      updated_by TEXT,
      client_id TEXT
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS auth (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      alg TEXT NOT NULL,
      salt TEXT NOT NULL,
      hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      rotated_at TEXT
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS auth_failures (
      client TEXT PRIMARY KEY,
      fails INTEGER NOT NULL,
      window_start INTEGER NOT NULL,
      locked_until INTEGER NOT NULL DEFAULT 0
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS batches (
      client_id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      at INTEGER NOT NULL
    )`);
    this.doc = null; // in-memory cache of the doc row (this object is the only writer)
    this.authRow = undefined; // undefined = not loaded, null = no passcode yet
  }

  // ── RPC methods (called by the Worker) ──
  async info() {
    const d = this.#doc();
    return { hasPasscode: Boolean(this.#auth()), revision: d.revision, updatedAt: d.updatedAt };
  }

  async setup(key) {
    if (!KEY_RE.test(String(key || ""))) {
      return failure(400, "key must be the 64-character hex SHA-256 family key (never the raw passcode).");
    }
    if (this.#auth()) return failure(409, "The family passcode is already set up. Ask Jeff for it.");
    const rec = await hashKey(key);
    this.authRow = undefined;
    if (this.#auth()) return failure(409, "The family passcode is already set up. Ask Jeff for it.");
    this.sql.exec(
      "INSERT INTO auth (id, alg, salt, hash, created_at) VALUES (1, ?, ?, ?, ?)",
      rec.alg, rec.salt, rec.hash, new Date().toISOString(),
    );
    this.authRow = undefined;
    return { status: 201, body: { ok: true } };
  }

  async rotateKey(key, client, bodyText) {
    const denied = await this.#check(key, client);
    if (denied) return denied;
    let body;
    try {
      body = parseJson(bodyText);
    } catch (err) {
      return asFailure(err);
    }
    const newKey = normalizeKey(isPlainObject(body) ? body.newKey : undefined);
    if (!newKey) return failure(400, "newKey must be the 64-character hex SHA-256 family key (never the raw passcode).");
    const rec = await hashKey(newKey);
    this.sql.exec(
      "UPDATE auth SET alg = ?, salt = ?, hash = ?, rotated_at = ? WHERE id = 1",
      rec.alg, rec.salt, rec.hash, new Date().toISOString(),
    );
    this.authRow = undefined;
    this.sql.exec("DELETE FROM auth_failures");
    return { status: 200, body: { ok: true } };
  }

  async authorize(key, client) {
    const denied = await this.#check(key, client);
    return denied || { status: 200, body: { ok: true } };
  }

  async getState(key, client, since) {
    const denied = await this.#check(key, client);
    if (denied) return denied;
    const d = this.#doc();
    const headers = { "X-Revision": String(d.revision) };
    if (since !== null && since === d.revision) {
      return { status: 200, body: { revision: d.revision, unchanged: true }, headers };
    }
    return { status: 200, body: stateBody(d), headers };
  }

  async applyOps(key, client, bodyText) {
    const denied = await this.#check(key, client);
    if (denied) return denied;

    // Everything below is synchronous, so no other request can interleave: the batch is atomic.
    let req;
    try {
      req = validateOpsRequest(parseJson(bodyText));
    } catch (err) {
      return asFailure(err);
    }
    const d = this.#doc();

    if (req.clientId && req.batchId) {
      const prev = this.sql.exec("SELECT batch_id FROM batches WHERE client_id = ?", req.clientId).toArray()[0];
      if (prev && prev.batch_id === req.batchId) {
        // A retried batch the server already applied (the first response was lost): don't re-apply.
        return { status: 200, body: stateBody(d, { duplicate: true }), headers: { "X-Revision": String(d.revision) } };
      }
    }

    let state = JSON.parse(d.json);
    if (!isPlainObject(state)) state = {};
    try {
      req.ops.forEach((op, i) => applyOp(state, op, i));
    } catch (err) {
      return asFailure(err);
    }

    const stateJson = JSON.stringify(state);
    const bytes = utf8Bytes(stateJson);
    if (bytes > LIMITS.maxStateBytes) {
      return failure(413, `That change would make the family data ${formatBytes(bytes)}; the limit is 1 MB. Nothing was saved.`);
    }

    const revision = d.revision + 1;
    const updatedAt = new Date().toISOString();
    this.sql.exec(
      `INSERT INTO doc (id, state, revision, updated_at, updated_by, client_id) VALUES (1, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET state = excluded.state, revision = excluded.revision,
         updated_at = excluded.updated_at, updated_by = excluded.updated_by, client_id = excluded.client_id`,
      stateJson, revision, updatedAt, req.by, req.clientId,
    );
    if (req.clientId && req.batchId) {
      this.sql.exec(
        `INSERT INTO batches (client_id, batch_id, revision, at) VALUES (?, ?, ?, ?)
         ON CONFLICT(client_id) DO UPDATE SET batch_id = excluded.batch_id, revision = excluded.revision, at = excluded.at`,
        req.clientId, req.batchId, revision, Date.now(),
      );
      this.sql.exec(
        "DELETE FROM batches WHERE client_id NOT IN (SELECT client_id FROM batches ORDER BY at DESC LIMIT 200)",
      );
    }
    this.doc = { json: stateJson, revision, updatedAt, updatedBy: req.by };
    return { status: 200, body: stateBody(this.doc), headers: { "X-Revision": String(revision) } };
  }

  // ── internals ──
  #doc() {
    if (this.doc) return this.doc;
    const row = this.sql.exec("SELECT state, revision, updated_at, updated_by FROM doc WHERE id = 1").toArray()[0];
    this.doc = row
      ? { json: row.state, revision: Number(row.revision), updatedAt: row.updated_at, updatedBy: row.updated_by }
      : { json: "{}", revision: 0, updatedAt: null, updatedBy: null };
    return this.doc;
  }

  #auth() {
    if (this.authRow === undefined) {
      this.authRow = this.sql.exec("SELECT alg, salt, hash FROM auth WHERE id = 1").toArray()[0] || null;
    }
    return this.authRow;
  }

  /** Returns null when the key is right, otherwise a failure result (401 / 429). */
  async #check(rawKey, client) {
    const now = Date.now();
    const lockedFor = this.#lockedFor(client, now);
    if (lockedFor > 0) return tooMany(lockedFor);

    const auth = this.#auth();
    if (!auth) {
      return failure(401, "The family passcode hasn't been set up yet.", { needsSetup: true });
    }
    if (rawKey === null || rawKey === undefined || String(rawKey).trim() === "") {
      return failure(401, "Missing X-Family-Key header. Enter the family passcode.");
    }
    const key = normalizeKey(rawKey);
    const ok = key !== null && (await verifyKey(auth, key));
    if (!ok) {
      const lockMs = this.#recordFailure(client, Date.now());
      if (lockMs > 0) {
        const retryAfter = Math.ceil(lockMs / 1000);
        return failure(401, "Wrong family passcode.", { locked: true, retryAfter }, { "Retry-After": String(retryAfter) });
      }
      return failure(401, "Wrong family passcode.");
    }
    this.sql.exec("DELETE FROM auth_failures WHERE client = ?", client);
    return null;
  }

  #lockedFor(client, now) {
    const rows = this.sql
      .exec("SELECT locked_until FROM auth_failures WHERE client IN (?, ?)", client, GLOBAL_CLIENT)
      .toArray();
    let until = 0;
    for (const r of rows) until = Math.max(until, Number(r.locked_until) || 0);
    return until > now ? until - now : 0;
  }

  /** Counts one wrong key; returns how long THIS client is now locked out for (0 = not locked). */
  #recordFailure(client, now) {
    let clientLock = 0;
    for (const [who, limit] of [[client, BACKOFF.perClient], [GLOBAL_CLIENT, BACKOFF.global]]) {
      const row = this.sql
        .exec("SELECT fails, window_start, locked_until FROM auth_failures WHERE client = ?", who)
        .toArray()[0];
      let fails = 1;
      let windowStart = now;
      let lockedUntil = row ? Number(row.locked_until) || 0 : 0;
      if (row && now - Number(row.window_start) < BACKOFF.windowMs) {
        fails = Number(row.fails) + 1;
        windowStart = Number(row.window_start);
      }
      if (fails >= limit) {
        lockedUntil = now + BACKOFF.lockMs;
        fails = 0;
        windowStart = now;
      }
      if (lockedUntil > now) clientLock = Math.max(clientLock, lockedUntil - now);
      this.sql.exec(
        `INSERT INTO auth_failures (client, fails, window_start, locked_until) VALUES (?, ?, ?, ?)
         ON CONFLICT(client) DO UPDATE SET fails = excluded.fails, window_start = excluded.window_start,
           locked_until = excluded.locked_until`,
        who, fails, windowStart, lockedUntil,
      );
    }
    // Housekeeping: forget stale counters so the table stays tiny.
    this.sql.exec(
      "DELETE FROM auth_failures WHERE window_start < ? AND locked_until < ?",
      now - BACKOFF.windowMs, now,
    );
    return clientLock;
  }
}

function stateBody(d, extra = undefined) {
  // Build the JSON by hand so the (up to 1 MB) state string is never re-parsed or re-stringified.
  let s = `{"revision":${d.revision},"updatedAt":${JSON.stringify(d.updatedAt)},"updatedBy":${JSON.stringify(d.updatedBy ?? null)}`;
  if (extra) for (const [k, v] of Object.entries(extra)) s += `,${JSON.stringify(k)}:${JSON.stringify(v)}`;
  return `${s},"state":${d.json}}`;
}

function failure(status, error, extra = undefined, headers = undefined) {
  return { status, body: { error, ...(extra || {}) }, headers };
}

function asFailure(err) {
  if (err instanceof HttpError) return failure(err.status, err.message, err.extra, err.headers);
  throw err;
}

function tooMany(ms) {
  const retryAfter = Math.max(1, Math.ceil(ms / 1000));
  const minutes = Math.max(1, Math.ceil(retryAfter / 60));
  return failure(
    429,
    `Too many wrong passcodes. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    { retryAfter },
    { "Retry-After": String(retryAfter) },
  );
}

// ── Family key hashing ────────────────────────────────────────────────────────────────────────
// The client sends key = hex(SHA-256("bilbrey-dinner-planner:" + passcode)). We store a random
// 16-byte salt and SHA-256(salt ‖ key) — never the key itself — and compare in constant time.
async function hashKey(key) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const digest = await saltedDigest(salt, key);
  return { alg: "sha256-salted-v1", salt: toHex(salt), hash: toHex(digest) };
}

async function verifyKey(auth, key) {
  if (auth.alg !== "sha256-salted-v1") return false;
  const salt = fromHex(auth.salt);
  const expected = fromHex(auth.hash);
  const actual = await saltedDigest(salt, key);
  return timingSafeEqual(actual, expected);
}

async function saltedDigest(salt, key) {
  const keyBytes = new TextEncoder().encode(key);
  const buf = new Uint8Array(salt.length + keyBytes.length);
  buf.set(salt, 0);
  buf.set(keyBytes, salt.length);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
}

function timingSafeEqual(a, b) {
  if (a.byteLength !== b.byteLength) return false;
  if (typeof crypto.subtle.timingSafeEqual === "function") return crypto.subtle.timingSafeEqual(a, b);
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function normalizeKey(value) {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase();
  return KEY_RE.test(key) ? key : null;
}

function toHex(bytes) {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

function fromHex(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Ops: set / del / push on a path of string keys (SPEC §4)
// ═════════════════════════════════════════════════════════════════════════════════════════════
const MISSING = Symbol("missing");

function validateOpsRequest(body) {
  if (!isPlainObject(body)) throw new HttpError(400, "Body must be a JSON object like { ops: [...], by, clientId }.");
  const { ops } = body;
  if (!Array.isArray(ops) || ops.length === 0) throw new HttpError(400, "ops must be a non-empty array.");
  if (ops.length > LIMITS.maxOps) {
    throw new HttpError(400, `Too many ops in one request (${ops.length}); send at most ${LIMITS.maxOps} at a time.`);
  }
  return {
    ops: ops.map(validateOp),
    by: cleanText(body.by, 40) || null,
    clientId: cleanId(body.clientId),
    batchId: cleanId(body.batchId),
  };
}

function validateOp(op, i) {
  if (!isPlainObject(op)) throw new HttpError(400, `ops[${i}] must be an object like { op, path, value }.`);
  const kind = op.op;
  if (kind !== "set" && kind !== "del" && kind !== "push") {
    throw new HttpError(400, `ops[${i}].op must be "set", "del" or "push".`);
  }
  if (!Array.isArray(op.path) || op.path.length === 0) {
    throw new HttpError(400, `ops[${i}].path must be a non-empty array of keys.`);
  }
  if (op.path.length > LIMITS.maxPathDepth) {
    throw new HttpError(400, `ops[${i}].path is too deep (max ${LIMITS.maxPathDepth} keys).`);
  }
  const path = op.path.map((seg) => {
    if (typeof seg === "number" && Number.isInteger(seg) && seg >= 0) seg = String(seg);
    if (typeof seg !== "string" || seg.length === 0 || seg.length > LIMITS.maxSegmentLength) {
      throw new HttpError(400, `ops[${i}].path keys must be non-empty strings of at most ${LIMITS.maxSegmentLength} characters.`);
    }
    if (FORBIDDEN_KEYS.has(seg)) throw new HttpError(400, `ops[${i}].path uses a forbidden key "${seg}".`);
    return seg;
  });
  if (kind === "del") return { op: kind, path };
  if (!Object.prototype.hasOwnProperty.call(op, "value") || op.value === undefined) {
    throw new HttpError(400, `ops[${i}] (${kind}) needs a value.`);
  }
  checkValue(op.value, i, 0);
  return { op: kind, path, value: op.value };
}

function checkValue(value, i, depth) {
  if (value === null || typeof value !== "object") return;
  if (depth > LIMITS.maxValueDepth) throw new HttpError(400, `ops[${i}].value is nested too deeply.`);
  if (Array.isArray(value)) {
    for (const v of value) checkValue(v, i, depth + 1);
    return;
  }
  for (const k of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(k)) throw new HttpError(400, `ops[${i}].value uses a forbidden key "${k}".`);
    checkValue(value[k], i, depth + 1);
  }
}

function applyOp(root, op, i) {
  const { path } = op;
  let node = root;
  for (let d = 0; d < path.length - 1; d++) {
    let child = getChild(node, path[d]);
    if (child === MISSING || child === null || typeof child !== "object") {
      if (op.op === "del") return; // nothing there to delete
      if (Array.isArray(node) && child === MISSING) {
        throw new HttpError(400, `ops[${i}]: "${path[d]}" is not a valid position in the list at ${fmtPath(path.slice(0, d))}.`);
      }
      child = {}; // create (or replace a plain value with) an intermediate object — last write wins
      setChild(node, path[d], child, i, path.slice(0, d));
    }
    node = child;
  }
  const last = path[path.length - 1];
  if (op.op === "set") {
    setChild(node, last, op.value, i, path.slice(0, -1));
  } else if (op.op === "del") {
    delChild(node, last);
  } else {
    const current = getChild(node, last);
    if (current === MISSING || current === null) setChild(node, last, [op.value], i, path.slice(0, -1));
    else if (Array.isArray(current)) current.push(op.value);
    else throw new HttpError(400, `ops[${i}]: can't push onto ${fmtPath(path)} because it isn't a list.`);
  }
}

function arrayIndex(seg, length, allowEnd) {
  if (!/^(?:0|[1-9]\d{0,8})$/.test(seg)) return -1;
  const n = Number(seg);
  return n < length || (allowEnd && n === length) ? n : -1;
}

function getChild(node, seg) {
  if (Array.isArray(node)) {
    const idx = arrayIndex(seg, node.length, false);
    return idx === -1 ? MISSING : node[idx];
  }
  return Object.prototype.hasOwnProperty.call(node, seg) ? node[seg] : MISSING;
}

function setChild(node, seg, value, i, parentPath) {
  if (Array.isArray(node)) {
    const idx = arrayIndex(seg, node.length, true);
    if (idx === -1) {
      throw new HttpError(400, `ops[${i}]: "${seg}" is not a valid position in the list at ${fmtPath(parentPath)}.`);
    }
    node[idx] = value;
    return;
  }
  node[seg] = value; // seg is never __proto__/constructor/prototype (validated)
}

function delChild(node, seg) {
  if (Array.isArray(node)) {
    const idx = arrayIndex(seg, node.length, false);
    if (idx !== -1) node.splice(idx, 1);
    return;
  }
  if (Object.prototype.hasOwnProperty.call(node, seg)) delete node[seg];
}

function fmtPath(path) {
  return path.length ? path.join(".") : "the top level";
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Pantry photo scan (Workers AI)
// ═════════════════════════════════════════════════════════════════════════════════════════════
const DATA_URL_RE = /^data:image\/(jpeg|jpg|png|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/;

function validateImage(image) {
  if (typeof image !== "string" || image.length === 0) {
    throw new HttpError(400, "image must be a photo as a data URL, like data:image/jpeg;base64,…");
  }
  if (image.length > LIMITS.maxImageChars) {
    throw new HttpError(
      413,
      `That photo is too large (${formatBytes(image.length)}). Resize it to about 1280px JPEG; the limit is 1.5 MB.`,
    );
  }
  const m = DATA_URL_RE.exec(image);
  if (!m) throw new HttpError(400, "image must be a base64 data URL of a JPEG, PNG, WebP or GIF photo.");
  const b64 = m[2];
  if (b64.length < 64 || b64.length % 4 !== 0) throw new HttpError(400, "The photo data is empty or cut off.");
  let head;
  try {
    head = atob(b64.slice(0, 24));
  } catch {
    throw new HttpError(400, "The photo data isn't valid base64.");
  }
  const kind = sniffImage(head);
  if (!kind) throw new HttpError(400, "That file isn't a JPEG, PNG, WebP or GIF photo.");
  return `data:image/${kind};base64,${b64}`;
}

function sniffImage(head) {
  const b = (i) => head.charCodeAt(i);
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return "jpeg";
  if (head.startsWith("\x89PNG\r\n\x1a\n")) return "png";
  if (head.startsWith("RIFF") && head.slice(8, 12) === "WEBP") return "webp";
  if (head.startsWith("GIF87a") || head.startsWith("GIF89a")) return "gif";
  return null;
}

function cleanKnown(list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw new HttpError(400, "known must be an array of { id, name, aliases }.");
  const out = [];
  const seen = new Set();
  for (const entry of list.slice(0, LIMITS.maxKnown)) {
    if (!isPlainObject(entry)) continue;
    const id = typeof entry.id === "string" ? entry.id.trim().slice(0, 80) : "";
    if (!id || seen.has(id) || /[\r\n]/.test(id)) continue;
    seen.add(id);
    const aliases = Array.isArray(entry.aliases)
      ? entry.aliases.map((a) => cleanText(a, 80)).filter(Boolean).slice(0, 12)
      : [];
    out.push({ id, name: cleanText(entry.name, 120) || id, aliases });
  }
  return out;
}

const SCAN_SYSTEM_PROMPT =
  "You are a careful kitchen-inventory assistant for a family of five. You look at a photo of a pantry " +
  "shelf, fridge, freezer or counter and list the food products in it, reading package labels when they " +
  "are legible. You answer with JSON only — no prose, no markdown.";

function scanUserPrompt(known) {
  const lines = known.map((k) => {
    const aka = k.aliases.length ? ` (also: ${k.aliases.join(", ")})` : "";
    return `${k.id} = ${k.name}${aka}`;
  });
  return [
    "List every distinct food or drink product you can see in this photo.",
    "",
    "For each product return:",
    '- "name": what a shopper would call it — the food first, then the form after a comma — e.g. "Cut green beans, canned", "Spaghetti, dry pasta", "Chicken breasts, frozen", "Jasmine rice", "Ketchup". No brand names unless that is the only way to describe it.',
    '- "matchId": the id from KNOWN ITEMS below when the product clearly IS that item; otherwise null. Never invent an id. When unsure, use null.',
    '- "qty": how many you can see (cans, boxes, bags, jars, bottles, packages); if there is a single large package whose label shows its weight, you may give that weight instead. null if you can\'t tell.',
    '- "unit": the unit for qty, e.g. "can", "box", "bag", "jar", "bottle", "package", "lb", "oz". null when qty is null.',
    '- "confidence": a number from 0 to 1 for how sure you are of what the product is.',
    "",
    "Rules:",
    "- One entry per distinct product: 4 identical cans are ONE entry with qty 4.",
    "- Include foods that are not in KNOWN ITEMS too, with matchId null.",
    "- Skip things that are not food or drink (cleaning supplies, dishes, appliances, containers).",
    "- Don't guess at items you can't actually see. If there is no food in the photo, return {\"items\": []}.",
    "",
    'Answer with exactly one JSON object: {"items":[{"name":"Cut green beans, canned","matchId":null,"qty":3,"unit":"can","confidence":0.9}]}',
    "",
    "KNOWN ITEMS (id = name):",
    lines.length ? lines.join("\n") : "(none)",
  ].join("\n");
}

const SCAN_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          matchId: { type: ["string", "null"] },
          qty: { type: ["number", "null"] },
          unit: { type: ["string", "null"] },
          confidence: { type: "number" },
        },
        required: ["name", "matchId", "qty", "unit", "confidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

function scanModels(env) {
  const primary = cleanModelId(env.SCAN_MODEL) || SCAN_MODEL;
  const fallback = cleanModelId(env.SCAN_FALLBACK_MODEL) || SCAN_FALLBACK_MODEL;
  return fallback === primary ? [primary] : [primary, fallback];
}

function cleanModelId(v) {
  return typeof v === "string" && /^@(cf|hf)\/[\w.\-/]+$/.test(v.trim()) ? v.trim() : null;
}

/** Inputs in the shape each model family documents on developers.cloudflare.com/workers-ai/models/. */
function scanInputs(model, jsonMode, image, known) {
  const isGemma4 = /gemma-4/i.test(model);
  const imagePart = isGemma4
    ? { type: "image_url", image_url: { url: image, detail: "high" } }
    : { type: "image_url", image_url: { url: image } };
  const inputs = {
    messages: [
      { role: "system", content: SCAN_SYSTEM_PROMPT },
      { role: "user", content: [{ type: "text", text: scanUserPrompt(known) }, imagePart] },
    ],
    temperature: 0.1,
  };
  if (isGemma4) {
    // OpenAI-compatible chat-completions schema; thinking off = faster and fewer output neurons.
    inputs.max_completion_tokens = SCAN_MAX_TOKENS;
    inputs.chat_template_kwargs = { enable_thinking: false };
    if (jsonMode) {
      inputs.response_format = {
        type: "json_schema",
        json_schema: { name: "pantry_scan", schema: SCAN_SCHEMA, strict: true },
      };
    }
  } else {
    inputs.max_tokens = SCAN_MAX_TOKENS;
    if (jsonMode) inputs.response_format = { type: "json_schema", json_schema: SCAN_SCHEMA };
  }
  return inputs;
}

async function runScan(env, image, known) {
  const models = scanModels(env);
  // Attempt 1: primary model with JSON-schema output. Attempt 2 (only if attempt 1 throws, times out
  // or returns nothing usable): fallback model, plain prompt + tolerant parsing — so a JSON-mode
  // problem and a model outage are both covered, and a scan never costs more than two calls.
  const attempts = [{ model: models[0], jsonMode: true }];
  attempts.push({ model: models[1] || models[0], jsonMode: false });

  const problems = [];
  for (const attempt of attempts) {
    let raw;
    try {
      raw = await withTimeout(
        env.AI.run(attempt.model, scanInputs(attempt.model, attempt.jsonMode, image, known)),
        SCAN_TIMEOUT_MS,
        `${attempt.model} took longer than ${SCAN_TIMEOUT_MS / 1000}s`,
      );
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      console.error(`Scan attempt failed (${attempt.model}):`, msg);
      problems.push(`${attempt.model}: ${msg}`);
      continue;
    }
    const items = parseScanItems(raw);
    if (items) return { items: normalizeScanItems(items, known), model: attempt.model };
    console.error(`Scan attempt returned no usable JSON (${attempt.model}):`, preview(raw));
    problems.push(`${attempt.model}: no usable JSON in the reply`);
  }
  throw new HttpError(
    502,
    "The pantry scan didn't work this time. Try again, or add the items by hand.",
    { detail: problems.join(" | ").slice(0, 500) },
  );
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

function preview(v) {
  try {
    return (typeof v === "string" ? v : JSON.stringify(v)).slice(0, 300);
  } catch {
    return String(v).slice(0, 300);
  }
}

/** Pulls the model's answer out of whichever response shape came back (string or object). */
function aiAnswer(res) {
  if (res === null || res === undefined) return null;
  if (typeof res === "string") return res;
  if (typeof res !== "object") return String(res);
  if (Array.isArray(res)) return res;
  if (res.success === false || (Array.isArray(res.errors) && res.errors.length && !res.response && !res.choices)) {
    return null;
  }
  if (res.response !== undefined && res.response !== null) return res.response;
  const choice = Array.isArray(res.choices) ? res.choices[0] : null;
  if (choice) {
    const content = choice.message ? choice.message.content : choice.text;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) return content.map((p) => (typeof p === "string" ? p : (p && p.text) || "")).join("");
    if (content && typeof content === "object") return content;
  }
  if (res.result !== undefined) return aiAnswer(res.result);
  if (typeof res.output_text === "string") return res.output_text;
  if (Array.isArray(res.items)) return res;
  return null;
}

/** Returns the raw item array, or null if nothing usable could be found. */
function parseScanItems(res) {
  const answer = aiAnswer(res);
  if (answer === null) return null;
  if (typeof answer === "object") return itemsFrom(answer);
  const parsed = extractJson(answer);
  const items = parsed === undefined ? null : itemsFrom(parsed);
  if (items) return items;
  return salvageObjects(answer); // e.g. output cut off by the token limit
}

function itemsFrom(v) {
  if (Array.isArray(v)) return v;
  if (isPlainObject(v)) {
    for (const k of ["items", "products", "foods", "pantry", "results", "data"]) {
      if (Array.isArray(v[k])) return v[k];
      if (isPlainObject(v[k])) {
        const inner = itemsFrom(v[k]);
        if (inner) return inner;
      }
    }
    if (typeof v.name === "string") return [v];
  }
  return null;
}

function extractJson(text) {
  const t = String(text).replace(/^﻿/, "").trim();
  const candidates = [];
  for (const m of t.matchAll(/```[a-zA-Z]*\s*([\s\S]*?)```/g)) candidates.push(m[1]);
  candidates.push(t);
  for (const c of candidates) {
    const direct = tryParse(c);
    if (direct !== undefined) return direct;
    let tries = 0;
    for (let i = 0; i < c.length && tries < 25; i++) {
      const ch = c[i];
      if (ch !== "{" && ch !== "[") continue;
      tries++;
      const seg = balancedSlice(c, i);
      if (!seg) continue;
      const v = tryParse(seg);
      if (v !== undefined && itemsFrom(v)) return v;
      if (v !== undefined) i += seg.length - 1;
    }
  }
  return undefined;
}

function tryParse(s) {
  try {
    return JSON.parse(s);
  } catch {}
  try {
    return JSON.parse(repairJson(s));
  } catch {}
  return undefined;
}

function repairJson(s) {
  return s
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\/\/[^\n"]*$/gm, "")
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/:\s*None\b/g, ": null")
    .replace(/:\s*True\b/g, ": true")
    .replace(/:\s*False\b/g, ": false")
    .replace(/:\s*NaN\b/g, ": null");
}

/** The shortest balanced {...} or [...] starting at `start`, respecting strings; null if unbalanced. */
function balancedSlice(s, start) {
  const stack = [];
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") {
      if (stack.pop() !== ch) return null;
      if (stack.length === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

function salvageObjects(text) {
  const found = [];
  for (const m of String(text).matchAll(/\{[^{}]*\}/g)) {
    const v = tryParse(m[0]);
    if (isPlainObject(v) && (typeof v.name === "string" || typeof v.product === "string")) found.push(v);
  }
  return found.length ? found : null;
}

function normKey(s) {
  const n = String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "");
  return n.length > 3 && n.endsWith("s") ? n.slice(0, -1) : n;
}

function normalizeScanItems(rawItems, known) {
  const ids = new Set(known.map((k) => k.id));
  const byKey = new Map(); // normalized id / name / alias → id (first wins)
  const add = (k, id) => {
    const nk = normKey(k);
    if (nk && !byKey.has(nk)) byKey.set(nk, id);
  };
  for (const k of known) add(k.id, k.id);
  for (const k of known) add(k.name, k.id);
  for (const k of known) for (const a of k.aliases) add(a, k.id);

  const out = [];
  const index = new Map();
  for (const raw of rawItems) {
    if (out.length >= LIMITS.maxScanItems) break;
    if (!isPlainObject(raw)) continue;
    const name = cleanText(raw.name ?? raw.product ?? raw.item ?? raw.title, 120);
    if (!name) continue;

    let matchId = null;
    const claimed = raw.matchId ?? raw.match_id ?? raw.matchID ?? raw.id ?? raw.match ?? null;
    if (typeof claimed === "string" && claimed.trim()) {
      const c = claimed.trim();
      if (ids.has(c)) matchId = c;
      else if (!/^(null|none|n\/a|unknown)$/i.test(c)) matchId = byKey.get(normKey(c)) || null;
    }
    if (!matchId) {
      // Only an exact name/alias match counts as "clearly the same item".
      matchId = byKey.get(normKey(name)) || byKey.get(normKey(name.split(",")[0])) || null;
    }

    let qty = toNumber(raw.qty ?? raw.quantity ?? raw.count ?? raw.amount);
    qty = qty !== null && qty > 0 ? Math.min(Math.round(qty * 100) / 100, 9999) : null;
    const unit = qty === null ? null : normalizeUnit(raw.unit ?? raw.units);
    const confidence = toConfidence(raw.confidence ?? raw.score ?? raw.probability ?? raw.certainty);

    const key = `${matchId ? `id:${matchId}` : `name:${normKey(name)}`}|${unit || ""}`;
    const prev = index.get(key);
    if (prev) {
      if (prev.qty !== null && qty !== null) prev.qty = Math.round((prev.qty + qty) * 100) / 100;
      else if (prev.qty === null) {
        prev.qty = qty;
        prev.unit = unit;
      }
      prev.confidence = Math.max(prev.confidence, confidence);
      continue;
    }
    const item = { name, matchId, qty, unit, confidence };
    index.set(key, item);
    out.push(item);
  }
  return out;
}

function toNumber(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const m = /-?\d+(?:\.\d+)?/.exec(v.replace(",", "."));
    return m ? Number(m[0]) : null;
  }
  return null;
}

function toConfidence(v) {
  if (typeof v === "string") {
    const word = v.trim().toLowerCase();
    if (word === "high") return 0.9;
    if (word === "medium") return 0.6;
    if (word === "low") return 0.3;
  }
  let n = toNumber(v);
  if (n === null) return 0.5;
  if (n > 1.5 && n <= 100) n /= 100; // "85" means 85%
  return Math.round(Math.min(1, Math.max(0, n)) * 100) / 100;
}

const UNIT_ALIASES = {
  can: "can", cans: "can", tin: "can", tins: "can",
  box: "box", boxes: "box",
  bag: "bag", bags: "bag",
  jar: "jar", jars: "jar",
  bottle: "bottle", bottles: "bottle",
  package: "package", packages: "package", pkg: "package", pkgs: "package", pack: "package", packs: "package", packet: "package", packets: "package",
  carton: "carton", cartons: "carton",
  container: "container", containers: "container", tub: "container", tubs: "container",
  loaf: "loaf", loaves: "loaf",
  lb: "lb", lbs: "lb", pound: "lb", pounds: "lb",
  oz: "oz", ounce: "oz", ounces: "oz",
  gallon: "gallon", gallons: "gallon", gal: "gallon",
  each: "each", ea: "each", item: "each", items: "each", count: "each", ct: "each", piece: "each", pieces: "each",
};

function normalizeUnit(v) {
  const u = cleanText(v, 24).toLowerCase().replace(/\.$/, "");
  if (!u) return null;
  return Object.prototype.hasOwnProperty.call(UNIT_ALIASES, u) ? UNIT_ALIASES[u] : u;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// HTTP helpers
// ═════════════════════════════════════════════════════════════════════════════════════════════
function isAllowedOrigin(origin) {
  return ALLOWED_ORIGINS.has(origin) || LOCAL_ORIGIN_RE.test(origin);
}

function corsHeaders(origin) {
  const h = { Vary: "Origin" };
  if (origin && isAllowedOrigin(origin)) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Expose-Headers"] = EXPOSE_HEADERS;
  }
  return h;
}

function preflight(origin) {
  const headers = {
    Allow: ALLOW_METHODS,
    "Access-Control-Allow-Methods": ALLOW_METHODS,
    "Access-Control-Allow-Headers": ALLOW_HEADERS,
    "Access-Control-Max-Age": "86400",
    Vary: "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
  };
  if (origin) headers["Access-Control-Allow-Origin"] = origin; // already checked against the allow-list
  return new Response(null, { status: 204, headers });
}

function json(status, body, origin, extraHeaders = undefined) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...corsHeaders(origin),
      ...(extraHeaders || {}),
    },
  });
}

function fromResult(result, origin) {
  return json(result.status, result.body, origin, result.headers);
}

function kitchen(env) {
  if (!env.KITCHEN) throw new HttpError(500, "The KITCHEN Durable Object binding is not configured.");
  return env.KITCHEN.get(env.KITCHEN.idFromName(KITCHEN_NAME));
}

function hasAI(env) {
  return Boolean(env.AI && typeof env.AI.run === "function");
}

function familyKey(request) {
  return request.headers.get("X-Family-Key");
}

function clientOf(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "";
  return ip.trim().slice(0, 64) || "unknown";
}

async function readBodyText(request, limit) {
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > limit) {
    throw new HttpError(413, `Request body is too large (limit ${formatBytes(limit)}).`);
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      try {
        await reader.cancel();
      } catch {}
      throw new HttpError(413, `Request body is too large (limit ${formatBytes(limit)}).`);
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(buf);
}

function parseJson(text) {
  if (typeof text !== "string" || text.trim() === "") throw new HttpError(400, "Request body must be JSON.");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Request body is not valid JSON.");
  }
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function cleanText(v, max) {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanId(v) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s && s.length <= 100 && /^[\w.:\-]+$/.test(s) ? s : null;
}

function utf8Bytes(s) {
  return new TextEncoder().encode(s).byteLength;
}

function formatBytes(n) {
  return n >= MB ? `${(n / MB).toFixed(2)} MB` : `${Math.ceil(n / 1024)} KB`;
}
