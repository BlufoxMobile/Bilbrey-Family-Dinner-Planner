/**
 * Claude chat connector (SPEC §15): a private remote MCP server for the family planner.
 *
 * Jeff adds `https://<worker>/mcp/<token>` as a custom connector in Claude. From any chat he can
 * send fridge or pantry photos or a receipt and Claude reads and updates the same family state the
 * phones use: the pantry, receipts, the recipe box, the dinner plan and the shopping list.
 *
 * Transport: MCP Streamable HTTP with JSON responses only (no SSE, no sessions): JSON-RPC 2.0
 * over POST, batches accepted. The token in the path is the only credential, so the Kitchen
 * Durable Object checks it (constant time) before anything here runs, and every write goes
 * through the Durable Object's normal op path.
 *
 * The planner logic is the app's own pure modules (../../app/*.js), bundled into the Worker by
 * wrangler. The recipe box, catalog, prices and stores come from the public GitHub Pages copy of
 * data/*.json, cached in memory for a few minutes.
 *
 * Everything after the data load is synchronous: state is read, ops are built and committed with
 * no await in between, so each tool call is atomic inside the Durable Object.
 */
import { buildDb } from "../../app/data.js";
import { settingsOf, set, del } from "../../app/state.js";
import { todayISO, addDays, diffDays, datesBetween, isISODate, weekdayName, round2, fmtQty, slugify, startOfWeek } from "../../app/util.js";
import { CATEGORIES, PROTEINS, EQUIPMENT_LABELS } from "../../app/config.js";
import { buildList, itemMeta, formatPackQty, unitText, productName, monthBudget } from "../../app/shopping.js";
import {
  allDinners, dinnerById, inRotation, isRetired, downVoters, isSideDropped, effectiveSides, sideInfo, itemsForNight,
  isFavorite, periodRange, defaultAnchor, listKeyFor, isPromoted, nightIsRice, scaleItems,
} from "../../app/planner.js";
import { lunchesIn, lunchPackers } from "../../app/lunch.js";
import { importReceipts, receiptPantryAdds, receiptPantryOps, parseSize, convertSize, PANTRY_SYNC_DAYS } from "../../app/receipts.js";
import { customItemOps, setPantryOps, placeDinnerOps, promoteOps } from "../../app/actions.js";
import { onHand, ENOUGH } from "../../app/coverage.js";
import { kindOfItem, placeOf, keepsDays, sinceOf, useSoon, KINDS, PLACES } from "../../app/freshness.js";
import { packageOf, packagesFor, plural as packWord } from "../../app/packages.js";
import { normUnit, scanQtyIn } from "../../app/scanqty.js";
import { plateNutrition, plateHealth, LEAN_RULE } from "../../app/nutrition.js";
import { veggieCheck } from "../../app/health.js";
import { cleanStep, POSSIBLE_COOKER_SETTINGS, NOT_THE_OVEN } from "./claude.js";

export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26"];
export const MCP_SERVER_NAME = "bilbrey-dinner-planner";
/** Who the family app shows as having made a change from a Claude chat. */
export const MCP_BY = "Family (Claude chat)";
const FAMILY_NAMES = ["Jeff", "Candi", "Knox", "Jordan", "Jackson"];

const DEFAULT_DATA_BASE = "https://blufoxmobile.github.io/Bilbrey-Family-Dinner-Planner/";
const DATA_FILES = [
  ["catalog", true], ["recipes", true], ["prices", false], ["stores", false],
  ["lunches", false], ["nutrition", false], ["products", false],
];
const DATA_TTL_MS = 5 * 60 * 1000;
const MAX_BATCH = 20;
const MAX_PLAN_DAYS = 62;
const TOKEN_RE = /^[0-9a-f]{32}$/;
// The family's Ninja PossibleCooker is `possible cooker` (app/config.js).
const EQUIPMENT = Object.keys(EQUIPMENT_LABELS);
const PLACE_IDS = PLACES.map((p) => p.id);

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Token helpers (the Kitchen Durable Object stores the token)
// ═════════════════════════════════════════════════════════════════════════════════════════════
export function newMcpToken() {
  let s = "";
  for (const b of crypto.getRandomValues(new Uint8Array(16))) s += b.toString(16).padStart(2, "0");
  return s;
}

/** Constant-time comparison of the token from the URL with the stored one. */
export function mcpTokenMatches(given, stored) {
  if (typeof given !== "string" || typeof stored !== "string" || !TOKEN_RE.test(given) || !TOKEN_RE.test(stored)) return false;
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(stored);
  if (typeof crypto.subtle.timingSafeEqual === "function") return crypto.subtle.timingSafeEqual(a, b);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// The recipe box, catalog and prices: data/*.json from GitHub Pages, cached in memory
// ═════════════════════════════════════════════════════════════════════════════════════════════
class ToolError extends Error {}

let dbCache = null; // { base, at, db }: a plain object, safe to share between requests

function dataBase(env) {
  const b = typeof env?.DATA_BASE === "string" && /^https?:\/\/\S+$/.test(env.DATA_BASE.trim()) ? env.DATA_BASE.trim() : DEFAULT_DATA_BASE;
  return b.endsWith("/") ? b : `${b}/`;
}

/**
 * The normalized db (app/data.js buildDb), checked against the website at most every five minutes.
 * Parsing the seven files (about 600 KB) and building the db is the connector's biggest CPU cost
 * (about 11 ms on a cold start, measured), so a re-check sends each file's ETag: while the website
 * answers "not modified" nothing is downloaded, parsed or rebuilt. A file that fails to load keeps
 * its last copy.
 */
export async function loadFamilyDb(env, now = Date.now()) {
  const base = dataBase(env);
  const prev = dbCache && dbCache.base === base ? dbCache : null;
  if (prev && now - prev.at < DATA_TTL_MS) return prev.db;
  try {
    const files = {};
    let changed = !prev;
    await Promise.all(DATA_FILES.map(async ([name, required]) => {
      const had = prev ? prev.files[name] : null;
      try {
        const headers = { Accept: "application/json" };
        if (had && had.etag) headers["If-None-Match"] = had.etag;
        const res = await fetch(`${base}data/${name}.json`, { headers });
        if (res.status === 304 && had) {
          files[name] = had;
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        files[name] = { etag: res.headers.get("ETag"), value: await res.json() };
        changed = true;
      } catch (err) {
        if (had && had.value !== null) files[name] = had; // stale beats nothing
        else if (required) throw new Error(`data/${name}.json: ${err && err.message ? err.message : err}`);
        else files[name] = { etag: null, value: null };
      }
    }));
    const db = changed ? buildDb(Object.fromEntries(DATA_FILES.map(([name]) => [name, files[name].value]))) : prev.db;
    dbCache = { base, at: now, db, files };
    return db;
  } catch (err) {
    console.error("MCP data load failed:", err && err.message ? err.message : err);
    if (dbCache && dbCache.base === base) return dbCache.db; // stale beats nothing
    throw new ToolError("The planner couldn't load the family recipe box from the website just now. Try again in a minute.");
  }
}

/** Tests only: forget the cached recipe box. */
export function resetMcpCache() {
  dbCache = null;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// JSON-RPC 2.0 / MCP
// ═════════════════════════════════════════════════════════════════════════════════════════════
const INSTRUCTIONS = [
  "This is the Bilbrey family's own dinner planner (Jeff, Candi, Knox, Jordan, Jackson; Glen Ellyn, IL, Central time).",
  "Changes you make here show up right away in the family's planner app on everyone's phone.",
  "The whole family shares one profile, so whoever is chatting speaks for the household; what you save is marked \"Family (Claude chat)\".",
  "Start with get_family_profile. Their three goals: spend less on groceries, waste less food, and eat lighter.",
  "House rules for anything you suggest: dinner is one meat main plus two sides for five full adult plates;",
  "never the oven or broiler. They cook on a Blackstone griddle, air fryer, gas stovetop, electric or outdoor grill, microwave, and a",
  "Ninja 10-in-1 PossibleCooker Pro 6.5 qt (equipment id \"possible cooker\": slow cook, sear/sauté, braise, steam, rice, keep warm).",
  "No tofu; no seafood except an occasional snow crab boil with Old Bay; soups now and then; nothing Caesar; no raw cucumbers (pickles",
  "are fine), raw onions or raw tomatoes; organic fruits and vegetables when possible; Knox only eats Cool Ranch Doritos.",
  "Dinners should be lean and high in protein with a vegetable or a salad: leaner cuts, more vegetables, less frying. Lighter never means",
  "small portions (three growing kids eat these dinners). Show calories and protein per plate when you have them, but never set a calorie",
  "target for anyone and never call a food good or bad. Budget about $650 a month in 2–3 store trips (Sam's Club in Addison, Jewel-Osco",
  "on Roosevelt Rd in Glen Ellyn). Use older food first: get_use_first lists what to eat soon.",
  "From photos: record only what you can actually see, and ask the user when a count or a label is unclear before saving.",
].join(" ");

/**
 * Handles one HTTP POST body. → { status, body: string|null, headers }
 * host: { version, env, state(): object, commit(ops, by): { ok: true, revision } | { ok: false, status, error } }
 */
export async function handleMcpRequest(bodyText, host, { protocolVersion = null } = {}) {
  if (protocolVersion && !MCP_PROTOCOL_VERSIONS.includes(String(protocolVersion).trim())) {
    return rpcHttp(400, rpcError(null, -32600, `Unsupported MCP-Protocol-Version "${String(protocolVersion).slice(0, 40)}". This server speaks ${MCP_PROTOCOL_VERSIONS.join(" and ")}.`));
  }
  let msg;
  try {
    msg = JSON.parse(bodyText);
  } catch {
    return rpcHttp(400, rpcError(null, -32700, "Parse error: send one JSON-RPC 2.0 message (or a batch) as JSON."));
  }
  const batch = Array.isArray(msg);
  const list = batch ? msg : [msg];
  if (batch && list.length === 0) return rpcHttp(400, rpcError(null, -32600, "Invalid Request: the batch is empty."));
  if (list.length > MAX_BATCH) return rpcHttp(400, rpcError(null, -32600, `Invalid Request: at most ${MAX_BATCH} messages per batch.`));
  const out = [];
  for (const m of list) {
    const r = await handleMessage(m, host);
    if (r) out.push(r);
  }
  if (!out.length) return { status: 202, body: null, headers: {} }; // only notifications / responses
  return rpcHttp(200, batch ? out : out[0]);
}

function rpcHttp(status, payload) {
  return { status, body: JSON.stringify(payload), headers: { "Content-Type": "application/json; charset=utf-8" } };
}

const rpcResult = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id: id === undefined ? null : id, error: { code, message } });
const validId = (id) => (typeof id === "string" && id.length <= 200) || (typeof id === "number" && Number.isFinite(id));
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

async function handleMessage(m, host) {
  if (!isObj(m)) return rpcError(null, -32600, "Invalid Request: each message must be a JSON-RPC 2.0 object.");
  const idOrNull = has(m, "id") && validId(m.id) ? m.id : null;
  if (m.jsonrpc !== "2.0") return rpcError(idOrNull, -32600, 'Invalid Request: "jsonrpc" must be "2.0".');
  if (typeof m.method !== "string") {
    // A response from the client (this server never sends requests, so there's nothing to match).
    if (has(m, "id") && (has(m, "result") || has(m, "error"))) return null;
    return rpcError(idOrNull, -32600, 'Invalid Request: "method" is missing.');
  }
  if (!has(m, "id")) return null; // a notification (initialized, cancelled, …): no reply
  if (!validId(m.id)) return rpcError(null, -32600, "Invalid Request: id must be a string or a number.");
  const params = m.params === undefined || m.params === null ? {} : m.params;
  if (!isObj(params)) return rpcError(m.id, -32602, "Invalid params: params must be an object.");
  switch (m.method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : null;
      return rpcResult(m.id, {
        protocolVersion: asked && MCP_PROTOCOL_VERSIONS.includes(asked) ? asked : MCP_PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: MCP_SERVER_NAME, title: "Bilbrey Family Dinner Planner", version: String(host.version || "0") },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return rpcResult(m.id, {});
    case "tools/list":
      return rpcResult(m.id, { tools: TOOL_LIST });
    case "tools/call":
      return callTool(m.id, params, host);
    default:
      return rpcError(m.id, -32601, `Method not found: ${m.method}`);
  }
}

async function callTool(id, params, host) {
  const name = params.name;
  const tool = typeof name === "string" && has(TOOLS, name) ? TOOLS[name] : null;
  if (!tool) return rpcError(id, -32602, `Unknown tool: ${typeof name === "string" ? name.slice(0, 80) : "(no name)"}`);
  const args = params.arguments === undefined || params.arguments === null ? {} : params.arguments;
  if (!isObj(args)) return rpcResult(id, toolError("The arguments must be a JSON object."));
  try {
    const db = await loadFamilyDb(host.env);
    // From here on everything is synchronous: read, decide, write.
    const ctx = {
      db,
      state: stateOf(host.state()),
      today: todayISO(),
      at: new Date().toISOString(),
      by: MCP_BY,
      commit(ops) {
        if (!ops.length) return null;
        const r = host.commit(ops, MCP_BY);
        if (!r || !r.ok) throw new ToolError(`Nothing was saved: ${r && r.error ? r.error : "the planner couldn't save the change."}`);
        return r.revision;
      },
    };
    return rpcResult(id, toolText(tool.run(args, ctx)));
  } catch (err) {
    if (err instanceof ToolError) return rpcResult(id, toolError(err.message));
    console.error(`MCP tool ${name} failed:`, err && err.stack ? err.stack : err);
    return rpcResult(id, toolError(`Something went wrong in the planner (${err && err.message ? err.message : err}). Nothing was saved.`));
  }
}

const toolText = (value) => ({ content: [{ type: "text", text: JSON.stringify(value) }], isError: false });
const toolError = (message) => ({ content: [{ type: "text", text: message }], isError: true });

function stateOf(s) {
  return isObj(s) ? s : {};
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Tool definitions (what Claude sees)
// ═════════════════════════════════════════════════════════════════════════════════════════════
const DATE = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "A date as YYYY-MM-DD (Central time)." };
const STORE3 = { type: "string", enum: ["jewel", "sams", "both"] };

const TOOL_DEFS = [
  {
    name: "get_family_profile",
    title: "Family profile and house rules",
    description:
      "Who the Bilbrey family is and the house rules for their food: the five people (all eat adult portions; one shared family profile) " +
      "and who packs a lunch (lunchPackers: Jeff and Knox unless the family adds someone), their goals (spend less, waste less, eat lighter: lean, high-protein dinners with a vegetable), " +
      "their two stores (Sam's Club in Addison, Jewel-Osco at 599 E Roosevelt Rd, Glen Ellyn), the kitchen equipment (never an oven; " +
      "a Ninja PossibleCooker for slow cooking, searing, braising, steaming and rice), " +
      "what they never eat, the monthly grocery budget with this month's spending so far, and the planner's settings. " +
      "Call this first in a new chat, before suggesting meals or shopping.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "get_pantry",
    title: "What's in the pantry",
    description:
      "Everything the family has at home now, from the shared pantry in the planner app. Each item has its id (use it with update_pantry), " +
      "name, where it's kept (fridge, freezer, pantry, counter), kind (meat, dairy, produce, canned…), the amount in the recipe box's unit " +
      "and in packages (jars, boxes, bags, cans…), the day it came home and an estimated use-by for perishables (cook the soonest first), " +
      "and running-low flags. Staples (spices, oil, condiments) are 'stocked' instead of counted. useFirst lists what to use up soon.",
    inputSchema: {
      type: "object",
      properties: {
        place: { type: "string", enum: PLACE_IDS, description: "Only items kept here." },
        includeEmpty: { type: "boolean", description: "Also list items recorded at zero (used up). Default false." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "update_pantry",
    title: "Update the pantry",
    description:
      "Change what's on hand in the family pantry: after the user sends a photo of the fridge, freezer, pantry or counter, or says what " +
      "they have, used up or bought. For each item give its id (from get_pantry) or a name; names are matched to the recipe box's items and " +
      "their aliases, and something that isn't in the recipe box becomes a shelf item of its own. Then give either packages (how many jars, " +
      "boxes, bags, cans, loaves, bottles… are there; quarters are fine, 0.5 = half a jar; the planner converts with the size of the product " +
      "the family buys) or qty with a unit (lb, oz, cups, slices…). The amount REPLACES what's recorded (a count of what's there now); use " +
      "mode 'add' for groceries just brought home. Optional: place (where it's kept), low (true = running low, goes on the shopping list; " +
      "false = restocked), label (brand and product as printed on the package), remove (it's all gone; deletes the entry). Count carefully " +
      "from photos and never record items you can't see: if you can't tell how many there are or how full something is, ask the user " +
      "before calling this. Items whose name could be several things come back unsaved with candidate ids: call again with the right id " +
      "(or newItem: true for a separate shelf item).",
    inputSchema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          minItems: 1,
          maxItems: 60,
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Pantry or recipe-box item id (from get_pantry, list_recipes or an earlier reply)." },
              name: { type: "string", description: "What it is, e.g. \"Rao's marinara\" or \"frozen chicken breasts\", when you don't have the id." },
              packages: { type: "number", minimum: 0, description: "How many packages (jars, boxes, bags, cans, loaves…)." },
              qty: { type: "number", minimum: 0, description: "An amount in `unit` instead of packages." },
              unit: { type: "string", description: "Unit for qty (lb, oz, cups, slices, cans…). For a new shelf item with packages, what one package is (bags, boxes, cans…)." },
              mode: { type: "string", enum: ["set", "add"], description: "set (default): this is how much there is now. add: this much more just came home." },
              place: { type: "string", enum: PLACE_IDS },
              low: { type: "boolean" },
              label: { type: "string", description: "Brand and product as printed, e.g. \"Rao's Homemade Marinara Sauce\"." },
              remove: { type: "boolean", description: "True when it's all gone." },
              newItem: { type: "boolean", description: "Create a separate shelf item even though similar recipe-box items exist." },
            },
            additionalProperties: false,
          },
        },
      },
      required: ["items"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "add_receipt",
    title: "Save a grocery receipt",
    description:
      "Save a Sam's Club or Jewel-Osco receipt (a photo of the paper receipt or a screenshot from the store's app) exactly as the planner " +
      "app does: it logs the trip in the month's budget (never twice: the same store, date and total is recognized as already saved), " +
      "learns the exact products and prices the family pays, and adds the groceries to the pantry (receipts from the last 14 days). " +
      "Send FOOD AND DRINK lines only: leave out household, paper, cleaning, pet, health and beauty items, bags, deposits, tax and payment " +
      "lines, and fold each coupon or instant-savings line into the discount of the item above it. Expand receipt abbreviations into " +
      "readable product names, brand first ('MM CHKN BRST 6.5LB' → \"Member's Mark Boneless Skinless Chicken Breast\", size '6.5 lb'). " +
      "total is the receipt's printed total. matchId is optional (an item id you're sure of); otherwise the planner matches names itself " +
      "and reports what it matched. Use dryRun: true to check the matches first. If a line or the total is hard to read, ask the user.",
    inputSchema: {
      type: "object",
      properties: {
        store: { type: "string", enum: ["jewel", "sams"] },
        date: DATE,
        total: { type: "number", exclusiveMinimum: 0, description: "The receipt's printed total in dollars." },
        tax: { type: "number", minimum: 0 },
        savings: { type: "number", minimum: 0, description: "Total savings printed on the receipt, if any." },
        lines: {
          type: "array",
          minItems: 1,
          maxItems: 200,
          items: {
            type: "object",
            properties: {
              product: { type: "string", description: "Readable product name, brand first." },
              brand: { type: "string" },
              size: { type: "string", description: "Package size as printed, e.g. '6.5 lb', '24 oz', '2 x 32 oz', '18 ct'." },
              qty: { type: "number", exclusiveMinimum: 0, description: "How many (or pounds for items sold by weight). Default 1." },
              unitPrice: { type: "number", minimum: 0 },
              lineTotal: { type: "number", minimum: 0, description: "The line's amount before any discount." },
              discount: { type: "number", minimum: 0, description: "Coupon / instant savings on this line, as a positive number." },
              matchId: { type: "string", description: "Recipe-box or pantry item id, only when you're sure." },
            },
            required: ["product"],
            additionalProperties: false,
          },
        },
        addToPantry: { type: "boolean", description: "Put the matched groceries in the pantry (default true; only for receipts from the last 14 days)." },
        dryRun: { type: "boolean", description: "Show what would be saved and matched without saving anything." },
      },
      required: ["store", "date", "total", "lines"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "list_recipes",
    title: "Recipe box",
    description:
      "The family's recipe box: dinners (a meat main with default sides, for five) and sides, including the family's own custom dinners. " +
      "Each dinner lists its id, category, protein, minutes, equipment, sides as served, calories and protein per plate, and status " +
      "(rotation, bench = waiting to come in, custom). Filter with query (words in the title, category, protein, sides or ingredients). " +
      "makeableNow: true checks each dinner (with its sides) against the pantry, each on its own, and returns the ones the family can cook " +
      "without shopping (those using food that needs using soon first) plus near misses with what's missing: use it for ideas from what's " +
      "on hand. Pass id to get one dinner or side in full: ingredients with amounts, steps and its sides.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        makeableNow: { type: "boolean" },
        id: { type: "string", description: "One dinner or side id for the full recipe." },
        include: { type: "string", enum: ["dinners", "sides", "all"], description: "Default all." },
        includeDropped: { type: "boolean", description: "Also list dinners and sides the family voted off the menu." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "get_plan",
    title: "Dinner plan",
    description:
      "The dinner plan and packed lunches for a range of dates: for each night the dinner with its sides as they'll be served " +
      "(remembered substitutions and dropped sides applied), calories per plate, nights the family is eating out, cooked nights, and who " +
      "packs which lunch. Defaults to today and the next 6 days (at most 62 days). openNights lists nights with nothing planned.",
    inputSchema: { type: "object", properties: { from: DATE, to: DATE }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "plan_dinner",
    title: "Plan a dinner",
    description:
      "Put a dinner on a night in the family plan (it appears in their app right away). Either pick a dinner from the recipe box with " +
      "dinnerId (from list_recipes), or write a new one with recipe: a meat main for five adult plates with side ids from list_recipes " +
      "(two sides, at least one a vegetable or a salad; burgers get one, usually 'jewel-fries'). Keep it lean and high in protein: leaner " +
      "cuts, more vegetables, air-fry, grill, griddle, braise or slow cook instead of frying; full portions all the same. New recipes must " +
      "follow the house rules or they're refused: no oven or broiler " +
      "ever (Blackstone griddle, air fryer, stovetop, electric or outdoor grill, microwave, and the Ninja PossibleCooker: equipment " +
      "'possible cooker', for slow cook, sear/sauté, braise, steam, rice and keep warm), no tofu, no seafood (the one exception is an " +
      "occasional snow crab boil with Old Bay), nothing Caesar, no raw cucumbers, raw onions or raw tomatoes (cooked onions and tomato " +
      "sauces are fine), meat in every dinner, and steps that state safe temperatures (chicken and turkey 165°F, ground beef and sausage " +
      "160°F, pork chops 145°F then rest 3 minutes). Recipe items should use recipe-box ingredient ids (from list_recipes with id) where " +
      "they exist; names are matched too, and anything else becomes a shelf item so it lands on the shopping list. A new recipe is a " +
      "one-off (kept out of the automatic rotation) unless saveToRecipeBox is true. As in the app, a dinner already planned on another " +
      "night moves to this one (trading places with this night's dinner, if any), a dinner already on the night is replaced, and a night " +
      "marked cooked can't change. Confirm the night and the dinner with the user first.",
    inputSchema: {
      type: "object",
      properties: {
        date: DATE,
        dinnerId: { type: "string" },
        sides: { type: "array", items: { type: "string" }, maxItems: 3, description: "Side ids to serve that night instead of the recipe's defaults." },
        recipe: {
          type: "object",
          properties: {
            title: { type: "string" },
            subtitle: { type: "string", description: "One short appetizing sentence." },
            category: { type: "string", enum: CATEGORIES },
            protein: { type: "string", enum: PROTEINS },
            minutes: { type: "number", exclusiveMinimum: 0, description: "Total time, start to table (a slow cook can be hours)." },
            prepMinutes: { type: "number", minimum: 0, description: "Hands-on time." },
            cookMinutes: { type: "number", minimum: 0, description: "Time it cooks on its own." },
            equipment: { type: "array", items: { type: "string", enum: EQUIPMENT }, minItems: 1 },
            items: {
              type: "array",
              minItems: 1,
              maxItems: 30,
              description: "Main-dish ingredients for five adults (not the sides).",
              items: {
                type: "object",
                properties: {
                  id: { type: "string", description: "Recipe-box ingredient id when there is one." },
                  name: { type: "string" },
                  qty: { type: "number", exclusiveMinimum: 0 },
                  unit: { type: "string", description: "The ingredient's unit (for recipe-box items, its own unit: lb, oz, cups, tbsp…)." },
                  newItem: { type: "boolean", description: "Not a recipe-box item: add it as a new shelf item even if similar ones exist." },
                },
                required: ["name", "qty"],
                additionalProperties: false,
              },
            },
            sides: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 2 },
            steps: {
              type: "array",
              minItems: 1,
              maxItems: 20,
              description: "Plain sentences, or { text, minutes, setting } for a step with a time or a setting worth showing.",
              items: {
                anyOf: [
                  { type: "string" },
                  {
                    type: "object",
                    properties: {
                      text: { type: "string" },
                      minutes: { type: "number", exclusiveMinimum: 0 },
                      setting: { type: "string", description: `What the equipment is set to: for the possible cooker ${POSSIBLE_COOKER_SETTINGS.join(", ")} (plus low or high); a heat level or temperature for the others.` },
                    },
                    required: ["text"],
                    additionalProperties: false,
                  },
                ],
              },
            },
            tips: { type: "array", items: { type: "string" }, maxItems: 5, description: "Short practical tips: when to start a slow cook, what to prep ahead, how to keep it lean." },
            tags: { type: "array", items: { type: "string" } },
          },
          required: ["title", "category", "protein", "minutes", "equipment", "items", "sides", "steps"],
          additionalProperties: false,
        },
        saveToRecipeBox: { type: "boolean", description: "Keep the dinner in the regular rotation (new recipes) or bring a bench dinner into it." },
      },
      required: ["date"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "get_shopping_list",
    title: "Shopping list",
    description:
      "The grocery list the planner builds from the planned dinners and packed lunches minus what's in the pantry, rounded up to the real " +
      "packs at Sam's Club and Jewel-Osco, with the exact product the family buys, prices (their own receipts first, then researched " +
      "prices; sales and coupons from recent price checks) and totals per store. With no dates it's the list the app shows now: the current " +
      "shopping trip if one is set, else the planner's current period. store limits it to one store (everything that store carries is " +
      "bought there).",
    inputSchema: { type: "object", properties: { from: DATE, to: DATE, store: STORE3 }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "get_use_first",
    title: "What to eat soon",
    description:
      "The food at home that should be used first so nothing is thrown away: perishables whose estimated use-by is near or past, soonest " +
      "first, with how much there is, where it's kept, and the recipe-box dinners that would use it (those the family could cook tonight " +
      "without shopping are marked). Use-by dates are estimates from the day each item came home; the date on the package wins. " +
      "Call this before suggesting or planning dinners, and plan the soonest food first.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "integer", minimum: 0, maximum: 30, description: "How far ahead to look for fridge and counter food (default 4 days). Freezer food is always looked at 30 days ahead." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "get_health_summary",
    title: "How the dinners add up",
    description:
      "Calories and protein per plate for the dinners in a range of dates (planned and cooked), their averages, the leanest and the " +
      "heaviest nights, and which planned dinners have no vegetable or salad among their sides, with the side that could be swapped for " +
      "one. Defaults to the last 7 days and the next 7. The numbers come from the recipe box's nutrition data (per adult plate, main plus " +
      "sides as served); a night with ingredients the data doesn't cover says so. The family wants lean, high-protein dinners with a " +
      "vegetable, in full portions: there are no calorie targets, so don't set one, and don't call a dinner good or bad.",
    inputSchema: { type: "object", properties: { from: DATE, to: DATE }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

export const TOOL_LIST = TOOL_DEFS.map((t) => ({ ...t, annotations: { title: t.title, ...t.annotations } }));

const TOOLS = {
  get_family_profile: { run: getFamilyProfile },
  get_pantry: { run: getPantry },
  update_pantry: { run: updatePantry },
  add_receipt: { run: addReceipt },
  list_recipes: { run: listRecipes },
  get_plan: { run: getPlan },
  plan_dinner: { run: planDinner },
  get_shopping_list: { run: getShoppingList },
  get_use_first: { run: getUseFirst },
  get_health_summary: { run: getHealthSummary },
};

// ═════════════════════════════════════════════════════════════════════════════════════════════
// get_family_profile
// ═════════════════════════════════════════════════════════════════════════════════════════════
const HOUSE_RULES = [
  "Every dinner is one meat main plus two sides, for five full adult plates (Jeff, Candi, Knox, Jordan, Jackson). Burger nights default to one side, a bag of Jewel-Osco frozen fries, with an optional second side.",
  "Meat in every dinner (chicken, beef, pork, turkey, sausage, bacon…). Salads are welcome as long as they have meat on them.",
  "Never the oven or broiler (it leaks propane). Cook on the Blackstone griddle, air fryer, gas stovetop, indoor electric grill, outdoor grill, microwave or the Ninja PossibleCooker (slow cook, sear/sauté, braise, steam, rice, keep warm).",
  "Lean, high-protein dinners with a vegetable or a salad, for the whole family: leaner cuts, more vegetables, less frying. Lighter never means small portions: three growing kids eat these dinners.",
  "Show calories and protein per plate, but never set a calorie target for anyone and never call a food good or bad.",
  "No tofu. No seafood, apart from an occasional (every few months) snow crab boil with Old Bay. Soups now and then are welcome.",
  "Never anything Caesar.",
  "No raw cucumbers (pickles are fine), no raw onions and no raw tomatoes. Cooked onions and tomato sauces are fine; only Candi eats raw tomato.",
  "Buy organic fruits and vegetables when the store has them.",
  "Knox only likes Cool Ranch Doritos.",
  "Rice at most about once a week (Candi isn't big on rice; she likes basmati and jasmine).",
  "Family favorites: brown butter spaghetti, regular spaghetti, frozen pizza 1–2 times a month, chicken tikka masala, fried rice, orange chicken, burgers about twice a week, Asian food in general.",
  "Goals: eat healthier, use older food first, keep groceries near the monthly target, and shop in 2–3 store trips a month (bulk at Sam's Club, gaps at Jewel-Osco).",
];
const MONDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function getFamilyProfile(args, { db, state, today }) {
  const st = settingsOf(state);
  const stores = {};
  for (const id of ["sams", "jewel"]) {
    const s = db.stores?.[id] || {};
    stores[id] = compact({ name: s.name, address: s.address, phone: s.phone, hours: s.hours, website: s.website, coupons: s.coupons?.note });
  }
  let budget = null;
  try {
    const b = monthBudget(db, state, today);
    budget = {
      month: b.month, monthlyTarget: b.target, spentSoFar: b.spent, receiptsThisMonth: b.receipts.length,
      stillToBuyForPlannedMeals: b.stillToBuy, projected: b.projected, leftAfterProjected: b.left, unplannedNightsLeft: b.unplanned,
    };
  } catch (err) {
    console.error("MCP budget failed:", err && err.message ? err.message : err);
    budget = { monthlyTarget: st.monthlyTarget };
  }
  // Who packs a lunch is whoever the family lists on the Lunch page (Jeff and Knox, plus anyone
  // they add later), not a fixed set of names (docs/spec/20-shared-profile.md §20.3).
  const lunchDays = (cfg) => (cfg.days || []).map((d) => weekdayName(addDays("2026-01-04", d)));
  const packers = lunchPackers(db, state);
  const people = FAMILY_NAMES.map((name) => {
    const p = packers.find((x) => x.name === name);
    const packs = !!p && !p.paused;
    return { name, packsLunch: packs, ...(packs ? { lunchDays: lunchDays(p.cfg) } : {}) };
  });
  return {
    today, weekday: weekdayName(today), home: "Glen Ellyn, IL (Central time)",
    profile: "One shared family profile: all five use the same planner, and anything saved from a Claude chat is marked \"Family (Claude chat)\".",
    people,
    lunchPackers: packers.map((p) => ({ name: p.name, lunchDays: lunchDays(p.cfg), ...(p.paused ? { paused: true, note: "Paused: nothing is packed or bought for them right now." } : {}) })),
    goals: [
      "Save money on groceries: about the monthly target, in 2–3 store trips a month rather than a trip every few days.",
      "Waste less food: cook what's oldest first (get_use_first).",
      "Eat lighter: lean, high-protein dinners with a vegetable, less frying, full portions. No calorie targets; calories and protein are shown for information.",
    ],
    stores,
    equipment: [
      "Blackstone griddle (outdoor)", "air fryer", "gas stovetop", "indoor electric grill", "outdoor grill", "microwave",
      "Ninja 10-in-1 Everyday PossibleCooker Pro, 6.5 qt (MC1101)", "NO oven",
    ],
    equipmentIds: EQUIPMENT,
    possibleCooker: {
      id: "possible cooker",
      name: "Ninja 10-in-1 Everyday PossibleCooker Pro, 6.5 qt (MC1101)",
      usedFor: POSSIBLE_COOKER_SETTINGS,
      goodFor: "Sear then slow cook or braise in the same pot: chili, stews, soups, pulled chicken or pork, braised lean cuts, and rice for five. It replaces a slow cooker and a Dutch oven; it is never put in an oven.",
    },
    storage: "One large fridge, a small freezer, an outdoor freezer and a full pantry, so bulk buying is easy to store.",
    houseRules: HOUSE_RULES,
    budget,
    settings: {
      planFrom: st.planStore, period: st.period, burgerNights: (st.burgerNights || []).map((i) => MONDAY_NAMES[i]).filter(Boolean),
      pizzaPerMonth: st.pizzaPerMonth, riceMaxPerWeek: st.riceMaxPerWeek, meatPortion: st.meatScale === 1 ? "hearty" : "lighter",
      organicProduce: st.organic, shoppingTrip: st.trip,
    },
    recipeBox: { dinners: allDinners(db, state).length, sides: db.sideList.length, pricesUpdated: db.pricesUpdated },
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// get_pantry
// ═════════════════════════════════════════════════════════════════════════════════════════════
const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.id, k.label]));

function pantryRow(db, state, id, today) {
  const p = state.pantry?.[id];
  const m = itemMeta(db, state, id);
  const staple = m.kind === "staple";
  const row = { id, name: m.name, place: placeOf(db, state, id), kind: KIND_LABEL[kindOfItem(db, state, id)] || "Other" };
  if (p?.label) row.label = p.label;
  if (staple || (p?.stocked && p?.qty == null)) row.stocked = !!p?.stocked && !p?.low;
  else {
    row.qty = typeof p?.qty === "number" ? p.qty : null;
    row.unit = m.unit;
    const pk = packageOf(db, state, id);
    if (pk && row.qty != null) {
      const n = pk.counted ? row.qty : packagesFor(row.qty, pk.per);
      if (n != null) row.packages = `${fmtQty(n)} ${packWord(pk.word, n)}${pk.counted ? "" : ` (${fmtQty(pk.per)} ${m.unit} each)`}`;
    }
  }
  if (p?.low) row.low = true;
  const since = sinceOf(p);
  if (since) row.since = since;
  const days = keepsDays(db, state, id);
  if (since && days != null) {
    row.useBy = addDays(since, days);
    row.daysLeft = diffDays(row.useBy, today);
  }
  if (m.custom) row.shelfItem = true;
  return row;
}

function getPantry(args, { db, state, today }) {
  const place = args.place;
  if (place !== undefined && !PLACE_IDS.includes(place)) throw new ToolError(`place must be one of ${PLACE_IDS.join(", ")}.`);
  const rows = [];
  for (const [id, p] of Object.entries(state.pantry || {})) {
    if (!p || typeof p !== "object") continue;
    const row = pantryRow(db, state, id, today);
    if (place && row.place !== place) continue;
    const empty = !row.low && (row.stocked !== undefined ? !row.stocked : !(row.qty > 0));
    if (empty && !args.includeEmpty) continue;
    rows.push(row);
  }
  const order = Object.fromEntries(PLACE_IDS.map((p, i) => [p, i]));
  rows.sort((a, b) => (order[a.place] ?? 9) - (order[b.place] ?? 9) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  const first = useSoon(db, state, today).map((u) => ({ id: u.id, name: u.name, useBy: u.useBy, daysLeft: u.daysLeft, place: u.place }));
  return {
    today,
    count: rows.length,
    useFirst: first,
    runningLow: rows.filter((r) => r.low).map((r) => r.name),
    items: rows,
    note: "Amounts are what the family last recorded; use-by dates are estimates from the day each item came home (the package date wins).",
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Matching names to the recipe box (catalog ids, aliases and the family's shelf items)
// ═════════════════════════════════════════════════════════════════════════════════════════════
const STOP = new Set(["the", "and", "with", "for", "of", "a", "an", "mm", "members", "member", "mark", "signature", "select", "ct", "oz", "lb", "lbs",
  "pk", "fl", "each", "ea", "value", "pack", "count", "fresh", "original", "family", "size", "jar", "bag", "box", "can", "bottle", "package",
  "carton", "container", "tub", "loaf", "loaves", "pouch", "sleeve", "jug", "half", "full", "some", "my", "our", "packet"].map((w) => stemWord(w)));
/** Words that say what form a food is in: a guess must have them too (ranch seasoning isn't ranch dressing). */
const FORM_WORDS = new Set(["seasoning", "dressing", "sauce", "mix", "powder", "soup", "broth", "stock", "chip", "cookie", "cracker", "juice",
  "drink", "bar", "cereal", "dip", "spread", "paste", "oil", "vinegar", "syrup", "jelly", "jam", "salsa", "frozen", "canned", "dried",
  "instant", "kit", "bowl", "salad", "sandwich", "wrap", "pizza", "burrito", "nugget", "tender", "patty", "meatball", "noodle", "rice", "cheese",
  "yogurt", "milk", "cream", "bread", "bun", "tortilla", "pasta", "bean", "pepper", "candy", "snack"].map(stemWord));

function normText(s) {
  return String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/** Singular, the same way for both spellings: cookies/cookie → cooki, berries/berry → berri, sauces → sauce. */
function stemWord(w) {
  if (w.length <= 3) return w;
  let s = w;
  if (s.endsWith("ies")) s = `${s.slice(0, -3)}i`;
  else if (s.endsWith("oes")) s = s.slice(0, -2);
  else if (/(ches|shes|xes|sses)$/.test(s)) s = s.slice(0, -2);
  else if (s.endsWith("s") && !s.endsWith("ss")) s = s.slice(0, -1);
  if (s.endsWith("ie")) s = s.slice(0, -1);
  else if (s.length > 3 && s.endsWith("y")) s = `${s.slice(0, -1)}i`;
  return s;
}

/** The whole phrase, normalized and singular, for exact matches. */
const phraseKey = (s) => normText(s).split(" ").filter(Boolean).map(stemWord).join(" ");
/** The meaningful words, for scoring. */
const wordSet = (s) => [...new Set(normText(s).split(" ").filter((w) => w.length > 1 && !/^\d/.test(w)).map(stemWord).filter((w) => !STOP.has(w)))];
const readable = (id) => String(id).replace(/^custom-/, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[-_]+/g, " ");

function phrasesFor(name, aliases, id) {
  const base = String(name || "");
  const out = [base, base.replace(/\s*\([^)]*\)\s*/g, " "), base.split(",")[0], readable(id), ...(aliases || [])];
  return [...new Set(out.map((s) => s.trim()).filter(Boolean))];
}

const indexCache = new WeakMap();
function catalogIndex(db) {
  let idx = indexCache.get(db);
  if (idx) return idx;
  idx = { exact: new Map(), entries: [] };
  for (const ing of Object.values(db.ingredients)) addToIndex(idx, ing.id, ing.name, ing.aliases);
  indexCache.set(db, idx);
  return idx;
}

function addToIndex(idx, id, name, aliases) {
  const phrases = phrasesFor(name, aliases, id);
  for (const p of phrases) {
    const k = phraseKey(p);
    if (!k) continue;
    if (!idx.exact.has(k)) idx.exact.set(k, new Set());
    idx.exact.get(k).add(id);
  }
  const sets = phrases.map(wordSet).filter((w) => w.length);
  idx.entries.push({ id, name, sets, words: new Set(sets.flat()) });
}

function familyIndex(db, state) {
  const base = catalogIndex(db);
  const custom = Object.entries(state.custom || {}).filter(([, c]) => c && c.name);
  if (!custom.length) return base;
  const idx = { exact: new Map([...base.exact].map(([k, v]) => [k, new Set(v)])), entries: [...base.entries] };
  for (const [id, c] of custom) addToIndex(idx, id, c.name, []);
  return idx;
}

/**
 * What a name refers to. → { id, how: 'exact'|'guess' } | { candidates: [{ id, name, unit }] } | { none: true }
 * A guess needs one item whose name or alias is fully in the text and covers most of it, clearly
 * ahead of the next ("Rao's Homemade Marinara Sauce" → marinara, but "Mandarin orange chicken" is
 * neither oranges nor chicken breasts).
 */
export function matchName(db, state, name) {
  const idx = familyIndex(db, state);
  const meta = (id) => { const m = itemMeta(db, state, id); return { id, name: m.name, unit: m.unit }; };
  const exact = idx.exact.get(phraseKey(name));
  if (exact && exact.size === 1) return { id: [...exact][0], how: "exact" };
  if (exact && exact.size > 1) return { candidates: [...exact].map(meta) };
  const words = wordSet(name);
  if (!words.length) return { none: true };
  const scored = [];
  for (const e of idx.entries) {
    let best = 0;
    for (const set of e.sets) {
      const hit = set.filter((w) => words.includes(w)).length;
      if (!hit) continue;
      const a = hit / set.length;
      const b = hit / words.length;
      const s = a === 1 ? 1 + b : a * b;
      if (s > best) best = s;
    }
    if (best > 0) scored.push({ id: e.id, s: best, e });
  }
  scored.sort((x, y) => y.s - x.s);
  const [top, second] = scored;
  const forms = words.filter((w) => FORM_WORDS.has(w));
  if (top && top.s >= 1.6 && (!second || top.s - second.s >= 0.15) && forms.every((w) => top.e.words.has(w))) return { id: top.id, how: "guess" };
  const cands = scored.filter((x) => x.s >= 0.5).slice(0, 5).map((x) => meta(x.id));
  return cands.length ? { candidates: cands } : { none: true };
}

const knownId = (db, state, id) => typeof id === "string" && (has(db.ingredients, id) || has(state.custom || {}, id));

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Units
// ═════════════════════════════════════════════════════════════════════════════════════════════
const PACKAGE_WORDS = new Set(["jar", "can", "bottle", "box", "bag", "package", "pack", "carton", "container", "tub", "loaf", "pouch", "tin",
  "packet", "canister", "jug", "sleeve", "case", "each", "item", "unit", "piece", "bunch", "head"]);

const UNIT_WORDS = { tablespoon: "tbsp", tablespoons: "tbsp", tbs: "tbsp", tbls: "tbsp", teaspoon: "tsp", teaspoons: "tsp", "fluid ounces": "fl oz", "fluid ounce": "fl oz" };
const WEIGHT_UNITS = new Set(["lb", "oz", "g", "kg"]);

/** An amount in an item's own unit. → { qty } or { error } */
function toItemUnit(db, state, id, qty, unitIn) {
  const m = itemMeta(db, state, id);
  const raw = typeof unitIn === "string" ? unitIn.trim().toLowerCase() : "";
  const unit = UNIT_WORDS[raw] || raw;
  const cu = normUnit(m.unit);
  const u = unit ? normUnit(unit) : null;
  if (!u || u === cu) return { qty: round2(qty) };
  if (PACKAGE_WORDS.has(u)) {
    const pk = packageOf(db, state, id);
    if (pk) return { qty: round2(qty * pk.per) };
    return { error: `${m.name} is counted in ${m.unit}; say how many ${m.unit} rather than ${unitIn}.` };
  }
  const converted = convertSize(parseSize(`${qty} ${unit}`), m.unit);
  if (converted > 0) return { qty: round2(converted) };
  // A weight into a cooking unit (2 lb of rice → cups), by the catalog pack's printed weight.
  const ing = db.ingredients[id];
  if (ing && WEIGHT_UNITS.has(u)) {
    const s = scanQtyIn(ing, qty, u);
    if (s.qty != null) return { qty: s.qty };
  }
  return { error: `Couldn't convert ${fmtQty(qty)} ${unitIn} of ${m.name} into ${m.unit} (its unit in the recipe box). Give packages, or qty in ${m.unit}.` };
}

function packagesText(db, state, id, qty) {
  const pk = packageOf(db, state, id);
  if (!pk || typeof qty !== "number") return undefined;
  const n = pk.counted ? qty : packagesFor(qty, pk.per);
  return n == null ? undefined : `${fmtQty(n)} ${packWord(pk.word, n)}`;
}

/** Copy-on-write ops on a state (structural sharing; nothing is cloned or mutated). */
function overlay(state, ops) {
  let root = state;
  for (const op of ops) root = cow(root, op.path, op);
  return root;
}

function cow(node, path, op) {
  const [k, ...rest] = path;
  const copy = Array.isArray(node) ? node.slice() : isObj(node) ? { ...node } : {};
  if (!rest.length) {
    if (op.op === "set") copy[k] = op.value;
    else if (op.op === "del") {
      if (Array.isArray(copy)) copy.splice(Number(k), 1);
      else delete copy[k];
    } else if (op.op === "push") copy[k] = [...(Array.isArray(copy[k]) ? copy[k] : []), op.value];
    return copy;
  }
  copy[k] = cow(copy[k], rest, op);
  return copy;
}

/** A best guess at the aisle for a new shelf item (same rules as the app's pantry screen). */
function guessAisle(name) {
  const n = String(name || "").toLowerCase();
  if (/season|spice|pepper,? ground|ground (cinnamon|cumin|ginger|turmeric|red pepper)|turmeric|cinnamon|paprika|oregano|basil|thyme|rosemary|poppy|old bay|cajun|rub\b|bouillon|extract|baking|flour|sugar|cooking spray|pam\b|crumbs/.test(n)) return "Spices & Baking";
  if (/sauce|dressing|ketchup|mustard|mayo|salsa|vinegar|hot sauce|syrup/.test(n)) return "Condiments & Sauces";
  if (/chips|stix|crackers?|cookies|cereal|snack|candy|popcorn|pretzel|granola|bars?\b|nuts\b|tea\b|chamomile|coffee/.test(n)) return "Snacks & Extras";
  if (/pasta|noodle|rice|macaroni|spaghetti|ramen|potato bake|au gratin|stuffing/.test(n)) return "Pasta & Grains";
  if (/chicken|beef|pork|turkey|sausage|bacon|steak|ham\b|chorizo/.test(n)) return "Meat";
  if (/milk|cheese|yogurt|butter|cream|eggs?\b/.test(n)) return "Dairy & Eggs";
  if (/frozen|ice cream|fries|burrito|pizza/.test(n)) return "Frozen";
  return "Canned & Jarred";
}

/** A unit for a new shelf item, in the app's words. */
function shelfUnit(unit) {
  const u = normUnit(unit);
  if (!u) return "each";
  const map = { can: "cans", jar: "jars", bottle: "bottles", bag: "bags", box: "boxes", package: "packs", pack: "packs", pouch: "pouches", carton: "cartons", loaf: "loaves", each: "each", item: "each", piece: "pieces" };
  if (map[u]) return map[u];
  if (["lb", "oz", "cups", "cup", "tbsp", "tsp", "slice", "gallon"].includes(u)) return u === "cup" ? "cups" : u === "slice" ? "slices" : u;
  return String(unit).trim().toLowerCase().slice(0, 20) || "each";
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// update_pantry
// ═════════════════════════════════════════════════════════════════════════════════════════════
function updatePantry(args, ctx) {
  const { db, today, at, by } = ctx;
  if (!Array.isArray(args.items) || !args.items.length) throw new ToolError("items must be a list of 1–60 pantry changes.");
  if (args.items.length > 60) throw new ToolError("At most 60 items at a time.");
  let state = ctx.state;
  const ops = [];
  const saved = [];
  const notSaved = [];
  args.items.forEach((raw, i) => {
    const label = `items[${i}]`;
    try {
      if (!isObj(raw)) throw new ToolError("each item must be an object");
      const r = pantryItemOps(db, state, raw, { at, by, today });
      if (r.unsaved) {
        notSaved.push({ item: raw.name || raw.id || label, ...r.unsaved });
        return;
      }
      state = overlay(state, r.ops);
      ops.push(...r.ops);
      saved.push(r.result);
    } catch (err) {
      if (!(err instanceof ToolError)) throw err;
      notSaved.push({ item: (isObj(raw) && (raw.name || raw.id)) || label, reason: err.message });
    }
  });
  const revision = ctx.commit(ops);
  const parts = [];
  if (saved.length) parts.push(`Updated ${saved.length} pantry ${saved.length === 1 ? "item" : "items"}.`);
  if (notSaved.length) parts.push(`${notSaved.length} not saved (see notSaved).`);
  if (!saved.length && !notSaved.length) parts.push("Nothing to change.");
  return { message: parts.join(" "), saved, notSaved, ...(revision ? { revision } : {}) };
}

function pantryItemOps(db, state, it, { at, by }) {
  let id = typeof it.id === "string" && it.id.trim() ? it.id.trim() : null;
  const name = typeof it.name === "string" ? it.name.trim().slice(0, 120) : "";
  const ops = [];
  let how = "id";
  let created = false;
  if (id) {
    if (!knownId(db, state, id)) {
      if (!name) throw new ToolError(`There's no pantry or recipe-box item with id "${id.slice(0, 60)}". Use an id from get_pantry, or give a name.`);
      id = null;
    }
  }
  if (!id) {
    if (!name) throw new ToolError("Give an id or a name.");
    const m = it.newItem ? { none: true } : matchName(db, state, name);
    if (m.id) {
      id = m.id;
      how = m.how;
    } else if (m.candidates) {
      return { unsaved: { reason: `"${name}" could be several things. Call again with one of these ids, or newItem: true for a separate shelf item.`, candidates: m.candidates } };
    } else {
      if (it.remove) throw new ToolError(`"${name}" isn't in the pantry.`);
      const c = customItemOps(state, { name, unit: shelfUnit(it.unit), aisle: guessAisle(name), kind: "measured", storage: PLACE_IDS.includes(it.place) ? it.place : "pantry" });
      id = c.id;
      how = c.ops.length ? "new" : "exact";
      created = c.ops.length > 0;
      ops.push(...c.ops);
      state = overlay(state, c.ops);
    }
  }
  const m = itemMeta(db, state, id);
  const prev = state.pantry?.[id];
  const base = { id, name: m.name, matchedBy: how, ...(created ? { created: true } : {}) };

  if (it.remove) {
    if (!prev) return { ops, result: { ...base, removed: false, note: "It wasn't in the pantry." } };
    ops.push(del(["pantry", id]));
    return { ops, result: { ...base, removed: true } };
  }
  if (it.place !== undefined && !PLACE_IDS.includes(it.place)) throw new ToolError(`place must be one of ${PLACE_IDS.join(", ")}.`);
  const num = (v, what) => {
    if (v === undefined || v === null) return undefined;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw new ToolError(`${what} must be a number of 0 or more.`);
    return v;
  };
  const packages = num(it.packages, "packages");
  const qtyIn = num(it.qty, "qty");
  if (packages !== undefined && qtyIn !== undefined) throw new ToolError("Give packages or qty, not both.");
  const mode = it.mode === "add" ? "add" : "set";
  if (it.mode !== undefined && it.mode !== "set" && it.mode !== "add") throw new ToolError('mode must be "set" or "add".');
  const staple = m.kind === "staple";

  // The amount, in the item's own unit.
  let amount;
  if (packages !== undefined) {
    if (staple) amount = packages;
    else {
      const pk = packageOf(db, state, id);
      if (!pk) throw new ToolError(`${m.name} has no package size on record; give qty in ${m.unit} instead.`);
      amount = round2(packages * pk.per);
    }
  } else if (qtyIn !== undefined) {
    if (staple) amount = qtyIn;
    else {
      const c = toItemUnit(db, state, id, qtyIn, it.unit);
      if (c.error) throw new ToolError(c.error);
      amount = c.qty;
    }
  }

  const low = typeof it.low === "boolean" ? it.low : undefined;
  let change;
  if (staple) {
    // Staples are stocked-until-low, never counted.
    const stocked = amount !== undefined ? amount > 0 : low === false ? true : prev ? undefined : true;
    change = { stocked, low };
    if (stocked !== undefined) change.qty = null;
  } else {
    if (amount === undefined && !prev && low === undefined) {
      throw new ToolError(`How much ${m.name} is there? Give packages or qty${created ? "" : ` (in ${m.unit})`}.`);
    }
    let qty;
    if (amount !== undefined) {
      const had = prev && typeof prev.qty === "number" && !prev.low ? prev.qty : 0;
      qty = mode === "add" ? round2(had + amount) : amount;
    } else if (!prev) qty = 0; // only marking a new item as running low
    change = { qty, low };
  }
  const res = setPantryOps(db, state, { id, ...change, who: by, at });
  const op = res.ops[0];
  const value = { ...op.value };
  if (PLACE_IDS.includes(it.place)) value.place = it.place;
  if (typeof it.label === "string" && it.label.trim()) value.label = it.label.trim().slice(0, 120);
  ops.push(set(["pantry", id], value));
  const result = { ...base, place: value.place || placeOf(db, overlay(state, ops), id) };
  if (staple) result.stocked = !!value.stocked && !value.low;
  else {
    result.qty = value.qty;
    result.unit = m.unit;
    const pt = packagesText(db, overlay(state, ops), id, value.qty);
    if (pt) result.packages = pt;
  }
  if (value.low) result.low = true;
  return { ops, result };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// add_receipt
// ═════════════════════════════════════════════════════════════════════════════════════════════
function addReceipt(args, ctx) {
  const { db, state, today, at, by } = ctx;
  if (args.store !== "jewel" && args.store !== "sams") throw new ToolError('store must be "jewel" (Jewel-Osco) or "sams" (Sam\'s Club).');
  if (!isISODate(args.date)) throw new ToolError("date must be the purchase date as YYYY-MM-DD.");
  if (args.date > addDays(today, 1)) throw new ToolError(`The date ${args.date} is in the future. Check the receipt's date.`);
  if (typeof args.total !== "number" || !(args.total > 0) || args.total > 5000) throw new ToolError("total must be the receipt's printed total in dollars.");
  if (!Array.isArray(args.lines) || !args.lines.length) throw new ToolError("lines must list the food and drink items on the receipt.");
  if (args.lines.length > 200) throw new ToolError("At most 200 lines per receipt.");
  const money = (v, what, i) => {
    if (v === undefined || v === null) return undefined;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw new ToolError(`lines[${i}].${what} must be a dollar amount.`);
    return v;
  };
  const matches = [];
  const lines = args.lines.map((l, i) => {
    if (!isObj(l)) throw new ToolError(`lines[${i}] must be an object.`);
    const product = typeof l.product === "string" ? l.product.trim().slice(0, 120) : "";
    if (!product) throw new ToolError(`lines[${i}].product is missing.`);
    const lineTotal = money(l.lineTotal, "lineTotal", i);
    const unitPrice = money(l.unitPrice, "unitPrice", i);
    if (lineTotal === undefined && unitPrice === undefined) throw new ToolError(`lines[${i}] (${product}) needs lineTotal or unitPrice.`);
    const qty = l.qty === undefined ? 1 : l.qty;
    if (typeof qty !== "number" || !(qty > 0)) throw new ToolError(`lines[${i}].qty must be more than 0.`);
    let matchId = null;
    let how = null;
    let candidates;
    if (typeof l.matchId === "string" && l.matchId.trim()) {
      if (!knownId(db, state, l.matchId.trim())) throw new ToolError(`lines[${i}].matchId "${l.matchId.slice(0, 60)}" isn't a recipe-box or pantry item id. Leave it out to let the planner match "${product}".`);
      matchId = l.matchId.trim();
      how = "given";
    } else {
      const m = matchName(db, state, [l.brand && !product.toLowerCase().startsWith(String(l.brand).toLowerCase()) ? l.brand : "", product].join(" "));
      if (m.id) {
        matchId = m.id;
        how = m.how;
      } else if (m.candidates) candidates = m.candidates;
    }
    matches.push({ product, ...(matchId ? { matchId, item: itemMeta(db, state, matchId).name, matchedBy: how } : { matchId: null, ...(candidates ? { candidates } : {}) }) });
    return {
      product, brand: typeof l.brand === "string" ? l.brand.slice(0, 60) : "", size: typeof l.size === "string" ? l.size.slice(0, 40) : "",
      qty, ...(unitPrice !== undefined ? { unitPrice } : {}), ...(lineTotal !== undefined ? { lineTotal } : {}),
      discount: money(l.discount, "discount", i) || 0, matchId,
    };
  });
  const receipt = { store: args.store, date: args.date, total: args.total, lines };
  if (typeof args.tax === "number" && args.tax >= 0) receipt.tax = args.tax;
  if (typeof args.savings === "number" && args.savings > 0) receipt.savings = args.savings;

  const { ops, results, state: after } = importReceipts(state, [receipt], { db, by, source: "scan", at, today });
  const r = results[0];
  if (r.error) throw new ToolError(r.error);
  const storeName = args.store === "sams" ? "Sam's Club" : "Jewel-Osco";
  if (r.duplicate) {
    return { saved: false, duplicate: true, receiptId: r.id, message: `This ${storeName} receipt from ${args.date} for $${args.total.toFixed(2)} is already saved, so nothing changed.` };
  }
  // The Budget line reads "Added from a Claude chat" instead of "Scanned receipt".
  const allOps = ops.map((op) => (op.op === "push" && op.path[0] === "receipts" ? { ...op, value: { ...op.value, note: "Added from a Claude chat" } } : op));

  const recent = diffDays(today, args.date) <= PANTRY_SYNC_DAYS;
  const toPantry = args.addToPantry !== false && recent;
  const pantry = [];
  if (toPantry) {
    allOps.push(...receiptPantryOps(db, after, r.id, { who: by, at }));
    for (const a of receiptPantryAdds(db, after, after.receiptLog?.[r.id])) {
      const m = itemMeta(db, after, a.id);
      pantry.push(a.staple ? { id: a.id, name: m.name, stocked: true } : { id: a.id, name: m.name, added: `${fmtQty(a.add)} ${m.unit}` });
    }
  }
  const unmatched = matches.filter((x) => !x.matchId);
  const summary = {
    receiptId: r.id,
    store: storeName,
    date: args.date,
    total: round2(args.total),
    lines: lines.length,
    matched: matches.filter((x) => x.matchId),
    unmatched: unmatched.map((x) => ({ product: x.product, ...(x.candidates ? { candidates: x.candidates } : {}) })),
    pricesLearned: r.learned,
    countedInBudget: r.counted,
    pantry: toPantry ? pantry : [],
    ...(args.addToPantry !== false && !recent ? { pantryNote: `Older than ${PANTRY_SYNC_DAYS} days, so the groceries weren't added to the pantry.` } : {}),
  };
  if (args.dryRun) return { dryRun: true, saved: false, ...summary, message: "Nothing saved yet. Call again without dryRun to save it." };
  const revision = ctx.commit(allOps);
  const bits = [`Saved $${args.total.toFixed(2)} from ${storeName}, ${args.date}.`];
  if (!r.counted) bits.push("It was already in the budget, so it isn't counted twice.");
  if (r.learned) bits.push(`Learned ${r.learned} ${r.learned === 1 ? "price" : "prices"} for next time.`);
  if (pantry.length) bits.push(`${pantry.length} ${pantry.length === 1 ? "item is" : "items are"} in the pantry now.`);
  if (unmatched.length) bits.push(`${unmatched.length} ${unmatched.length === 1 ? "line isn't" : "lines aren't"} a recipe-box item (counted in the total only).`);
  return { saved: true, ...summary, message: bits.join(" "), revision };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// list_recipes
// ═════════════════════════════════════════════════════════════════════════════════════════════
function perPlate(db, state, id, entry) {
  const n = plateNutrition(db, state, id, entry);
  return n ? { kcal: Math.round(n.kcal), proteinG: Math.round(n.protein) } : undefined;
}

function dinnerStatus(db, state, d) {
  if (isRetired(state, d.id)) return "dropped";
  if (d.custom) return d.rotation === "bench" ? "custom (one-off)" : "custom (in rotation)";
  return inRotation(state, d, db) ? "rotation" : "bench";
}

function sidesServed(db, state, dinnerId, entry) {
  return effectiveSides(db, state, dinnerId, entry).map((s) => {
    const info = sideInfo(db, state, s.parsed);
    return { id: s.parsed.type === "side" ? s.parsed.id : s.ref, title: info?.title || "Side" };
  });
}

function dinnerSummary(db, state, d) {
  const out = {
    id: d.id, title: d.title, ...(d.subtitle ? { subtitle: d.subtitle } : {}), category: d.category, protein: d.protein, minutes: d.minutes,
    equipment: d.equipment, ...(d.tags.length ? { tags: d.tags } : {}), status: dinnerStatus(db, state, d),
    sides: sidesServed(db, state, d.id, null).map((s) => s.title),
  };
  if (isFavorite(state, d)) out.favorite = true;
  const n = perPlate(db, state, d.id, null);
  if (n) out.perPlate = n;
  if (out.status === "dropped") out.droppedBy = downVoters(state, d.id);
  return out;
}

function itemsList(db, state, items) {
  return Object.entries(items).map(([id, qty]) => {
    const m = itemMeta(db, state, id);
    return { id, name: m.name, qty: round2(qty), unit: m.unit };
  });
}

function sideSummary(db, state, s) {
  const out = { id: s.id, title: s.title, kind: s.kind, minutes: s.minutes, equipment: s.equipment, ...(s.tags.length ? { tags: s.tags } : {}) };
  if (isSideDropped(state, s.id)) out.dropped = true;
  return out;
}

function shortfall(db, state, rem, items) {
  const missing = [];
  for (const [id, need] of Object.entries(items)) {
    const have = rem[id] ?? 0;
    if (have === Infinity || have + 1e-9 >= need * ENOUGH) continue;
    const m = itemMeta(db, state, id);
    missing.push(`${m.name}: need ${unitText(round2(need), m.unit)}, have ${unitText(round2(have), m.unit)}`);
  }
  return missing;
}

function listRecipes(args, { db, state, today }) {
  const include = args.include === undefined ? "all" : args.include;
  if (!["dinners", "sides", "all"].includes(include)) throw new ToolError('include must be "dinners", "sides" or "all".');
  if (args.id !== undefined) {
    const id = String(args.id).trim();
    const d = dinnerById(db, state, id);
    if (d) {
      return {
        dinner: {
          ...dinnerSummary(db, state, d),
          serves: "5 adult plates",
          ingredients: itemsList(db, state, scaleItems(db, state, d.items)),
          steps: d.steps,
          sideDetails: effectiveSides(db, state, d.id, null).map((s) => {
            const info = sideInfo(db, state, s.parsed);
            return { id: s.parsed.type === "side" ? s.parsed.id : s.ref, title: info.title, minutes: info.minutes, equipment: info.equipment, ingredients: itemsList(db, state, scaleItems(db, state, info.items || {})), steps: info.steps };
          }),
        },
      };
    }
    const s = db.sides[id];
    if (s) return { side: { ...sideSummary(db, state, s), ingredients: itemsList(db, state, scaleItems(db, state, s.items)), steps: s.steps } };
    throw new ToolError(`There's no dinner or side with id "${id.slice(0, 60)}". Call list_recipes without id to see them.`);
  }
  const words = typeof args.query === "string" ? normText(args.query).split(" ").filter(Boolean) : [];
  const matchesQuery = (text) => words.every((w) => text.includes(w) || text.includes(stemWord(w)));
  const out = {};
  if (include !== "sides") {
    let dinners = allDinners(db, state).filter((d) => args.includeDropped || !isRetired(state, d.id));
    if (words.length) {
      dinners = dinners.filter((d) => matchesQuery(normText([
        d.title, d.subtitle, d.category, d.protein, d.tags.join(" "), d.custom ? "custom" : "",
        sidesServed(db, state, d.id, null).map((s) => s.title).join(" "),
        Object.keys(itemsForNight(db, state, d.id, null)).map((id) => itemMeta(db, state, id).name).join(" "),
      ].join(" "))));
    }
    if (args.makeableNow) {
      const rem = onHand(db, state);
      const soon = new Set(useSoon(db, state, today, { soon: 3 }).map((u) => u.id));
      const ready = [];
      const almost = [];
      for (const d of dinners) {
        const items = itemsForNight(db, state, d.id, null);
        const missing = shortfall(db, state, rem, items);
        const usesFirst = Object.keys(items).filter((id) => soon.has(id)).map((id) => itemMeta(db, state, id).name);
        const row = { ...dinnerSummary(db, state, d), ...(usesFirst.length ? { usesFoodToUseSoon: usesFirst } : {}) };
        if (!missing.length) ready.push(row);
        else if (missing.length <= 2) almost.push({ ...row, missing });
      }
      const bySoon = (a, b) => (b.usesFoodToUseSoon?.length || 0) - (a.usesFoodToUseSoon?.length || 0) || a.title.localeCompare(b.title);
      out.makeableNow = ready.sort(bySoon);
      out.almost = almost.sort((a, b) => a.missing.length - b.missing.length || bySoon(a, b));
      out.note = "Each dinner (main plus its usual sides, for five) is checked on its own against the whole pantry; salt, pepper and oil are assumed. Two dinners may need the same food.";
    } else {
      // The whole box is long: subtitles only when the list is short (query results, one recipe).
      out.dinners = dinners.map((d) => {
        const s = dinnerSummary(db, state, d);
        if (dinners.length > 25) delete s.subtitle;
        return s;
      });
    }
  }
  if (include !== "dinners") {
    let sides = db.sideList.filter((s) => args.includeDropped || !isSideDropped(state, s.id));
    if (words.length) sides = sides.filter((s) => matchesQuery(normText([s.title, s.kind, s.tags.join(" "), Object.keys(s.items).map((id) => itemMeta(db, state, id).name).join(" ")].join(" "))));
    if (args.makeableNow) {
      const rem = onHand(db, state);
      out.sidesOnHand = sides.filter((s) => !shortfall(db, state, rem, scaleItems(db, state, s.items)).length).map((s) => sideSummary(db, state, s));
    } else out.sides = sides.map((s) => sideSummary(db, state, s));
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// get_plan
// ═════════════════════════════════════════════════════════════════════════════════════════════
function rangeArgs(args, today, { defaultDays = 7 } = {}) {
  const from = args.from === undefined ? today : args.from;
  if (!isISODate(from)) throw new ToolError("from must be a date as YYYY-MM-DD.");
  const to = args.to === undefined ? addDays(from, defaultDays - 1) : args.to;
  if (!isISODate(to)) throw new ToolError("to must be a date as YYYY-MM-DD.");
  if (to < from) throw new ToolError("to must be on or after from.");
  if (diffDays(to, from) + 1 > MAX_PLAN_DAYS) throw new ToolError(`At most ${MAX_PLAN_DAYS} days at a time.`);
  return { from, to, dates: datesBetween(from, to) };
}

function getPlan(args, { db, state, today }) {
  const { from, to, dates } = rangeArgs(args, today);
  const lunches = lunchesIn(db, state, dates);
  const nights = dates.map((date) => {
    const e = state.plan?.[date];
    const night = { date, day: weekdayName(date) };
    if (e?.status === "away") {
      night.status = "away";
      night.away = compact({ reason: e.away?.reason || "Not eating at home", note: e.away?.note });
    } else if (e?.dinner && dinnerById(db, state, e.dinner)) {
      const d = dinnerById(db, state, e.dinner);
      night.status = e.status === "cooked" ? "cooked" : "planned";
      night.dinner = { id: d.id, title: d.title, minutes: d.minutes, equipment: d.equipment };
      night.sides = sidesServed(db, state, d.id, e);
      const n = perPlate(db, state, d.id, e);
      if (n) night.perPlate = n;
      if (e.by) night.by = e.by;
    } else night.status = "open";
    const l = lunches.filter((x) => x.date === date);
    if (l.length) night.lunches = l.map((x) => ({ person: x.name, packed: x.slots.filter((s) => s.item).map((s) => `${s.label}: ${s.item.title}`) }));
    return night;
  });
  return { from, to, today, nights, openNights: nights.filter((n) => n.status === "open").map((n) => n.date) };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// plan_dinner (+ the house-rule check for new recipes)
// ═════════════════════════════════════════════════════════════════════════════════════════════
// The validator's bans (scripts/validate-data.mjs) for whole-text checks, case-insensitive.
const BANNED = [
  [/\bovens?\b/i, "the oven"], [/broil/i, "the broiler"], [/\bbake in\b/i, "baking in an oven"], [/preheat the oven/i, "the oven"],
  [/fish/i, "fish"], [/salmon/i, "salmon"], [/shrimp/i, "shrimp"], [/\btuna\b/i, "tuna"], [/tilapia/i, "tilapia"],
  [/\bcod\b/i, "cod"], [/\bcrabs?\b/i, "crab", "crab"], [/lobster/i, "lobster"], [/scallop/i, "scallops"], [/oyster/i, "oysters"],
  [/anchov/i, "anchovies"], [/seafood(?!-free)/i, "seafood", "crab"], [/tofu/i, "tofu"],
  [/worcestershire(?!-free)/i, "Worcestershire (it has anchovies)"], [/\bclams?\b/i, "clams"], [/mussel/i, "mussels"], [/prawn/i, "prawns"],
  [/\bsquid\b/i, "squid"], [/calamari/i, "calamari"], [/sardine/i, "sardines"],
  [/caesar/i, "Caesar"],
];
const CUCUMBER = /cucumber|tzatziki/i;
const RAW_ONION = /\b(raw|red|thin(ly)?[- ]sliced|sliced|diced|chopped|minced) onions?\b/i;
const RAW_TOMATO = /\b(sliced|fresh|cherry|grape|roma|quartered|diced|chopped) tomato(es)?\b|\btomato slices\b/i;
const SHELF_TOMATO = /\b(canned|cans?|sauce|paste|crushed|rotel|salsa|soup|stewed|fire[- ]roasted)\b/i;
/** A sentence that cooks what it mentions ("Sauté the diced onion until soft"). */
const COOKED = /\b(cook|cooks|cooked|cooking|brown|saut|soft|caramel|griddle|grill|skillet|simmer|fry|fried|frying|stir|roast|char|blister|translucent|tender|wilt|boil|stew|melt|sear|air[- ]fr|microwave|heat|warm|reduce|pan)/i;
const sentences = (t) => String(t || "").split(/(?<=[.!?;])\s+/);
const rawMention = (texts, re) => texts.some((t) => sentences(t).some((s) => re.test(s) && !COOKED.test(s)));
const SNOW_CRAB = /snow\s*crab/i;
const MEAT_WORDS = /\b(chicken|beef|steaks?|sirloin|chuck|brisket|pork|ham|bacon|turkey|sausages?|kielbasa|brats?|bratwurst|chorizo|pepperoni|salami|meatballs?|ribs?|lamb|veal|hot dogs?|franks?|carnitas|barbacoa|prosciutto|pastrami|roast beef|tenderloin|patty|patties)\b/i;
// Safe temperatures (same as the validator): a recipe with these ids must state the temperature.
const TEMP_RULES = [
  { ids: ["chicken", "chickenThighs", "fajitaChicken"], temp: "165°F", what: "chicken" },
  { ids: ["groundTurkey", "turkeySausage"], temp: "165°F", what: "ground turkey or turkey sausage" },
  { ids: ["beef", "beefPatties", "groundPork", "italianSausage", "chorizo"], temp: "160°F", what: "ground meat, sausage or patties" },
  { ids: ["eyeRoundSteak"], temp: "145°F", what: "whole-cut beef" },
  { ids: ["pulledPork", "pulledChicken", "smokedSausage", "chickenAlfredoDeli", "roastBeef"], temp: "165°F", what: "fully cooked meat (reheat)" },
  { ids: ["pork", "porkLoin"], temp: "145°F", what: "pork chops or loin", rest: true },
];
const RICE_IDS = ["jasmine", "basmati"];

/**
 * Every house rule a recipe breaks (an empty list = fine). The validator's bans, with one change:
 * onions and tomatoes are only "raw" in a sentence that doesn't cook them.
 */
export function recipeProblems({ title = "", subtitle = "", steps = [], itemIds = [], itemNames = [], meat = false } = {}) {
  const problems = [];
  const text = [title, subtitle, ...steps];
  // "No oven needed" and "instead of the oven" say the oven isn't used.
  const all = [...text, ...itemNames].join(" \n ").replace(NOT_THE_OVEN, " ");
  const crabBoil = SNOW_CRAB.test(all);
  for (const [re, word, exceptFor] of BANNED) {
    if (exceptFor === "crab" && crabBoil) continue;
    if (re.test(all)) problems.push(`it uses ${word}`);
  }
  if (CUCUMBER.test(all) || itemIds.includes("cucumber")) problems.push("it has raw cucumber (pickles are fine)");
  if (rawMention(text, RAW_ONION)) problems.push("it has raw onion (cook the onions, or leave them out)");
  const tomatoCooked = steps.some((s) => sentences(s).some((x) => /tomato/i.test(x) && COOKED.test(x)));
  const freshTomato = itemIds.includes("tomato") || itemNames.some((n) => RAW_TOMATO.test(n) && !SHELF_TOMATO.test(n));
  if (rawMention(text, RAW_TOMATO) || (freshTomato && !tomatoCooked)) problems.push("it has raw tomato (only Candi eats it; cooked tomatoes and sauces are fine)");
  if (!meat && !crabBoil) problems.push("it has no meat (every dinner needs meat)");
  const stepText = steps.join(" ");
  for (const rule of TEMP_RULES) {
    if (!rule.ids.some((id) => itemIds.includes(id))) continue;
    if (!stepText.includes(rule.temp)) problems.push(`the steps never say to cook the ${rule.what} to ${rule.temp}`);
    if (rule.rest && !/rest[^.]*3 minutes|3 minutes[^.]*rest/i.test(stepText)) problems.push("the steps never say to rest the pork 3 minutes after 145°F");
  }
  return [...new Set(problems)];
}

function planDinner(args, ctx) {
  const { db, today, at, by } = ctx;
  let state = ctx.state;
  const date = args.date;
  if (!isISODate(date)) throw new ToolError("date must be the night as YYYY-MM-DD.");
  if (diffDays(date, today) < -14 || diffDays(date, today) > 180) throw new ToolError(`${date} is too far from today (${today}). Plan within the next six months.`);
  const hasRecipe = args.recipe !== undefined && args.recipe !== null;
  if (hasRecipe === (typeof args.dinnerId === "string" && args.dinnerId.trim() !== "")) throw new ToolError("Give either dinnerId (a recipe-box dinner) or recipe (a new one), not both.");
  const ops = [];
  const notes = [];
  let dinnerId;
  let createdRecipe = null;

  if (hasRecipe) {
    const built = buildCustomDinner(db, state, args.recipe, { saveToRecipeBox: args.saveToRecipeBox === true, at, by });
    ops.push(...built.ops);
    state = overlay(state, built.ops);
    dinnerId = built.id;
    notes.push(...built.notes);
    createdRecipe = { id: built.id, updated: built.updated, newShelfItems: built.newShelfItems, rotation: built.rotation };
  } else {
    dinnerId = args.dinnerId.trim();
    const d = dinnerById(db, state, dinnerId);
    if (!d) throw new ToolError(`There's no dinner with id "${dinnerId.slice(0, 60)}". Use an id from list_recipes, or write a recipe.`);
    if (isRetired(state, d.id)) {
      const who = downVoters(state, d.id);
      throw new ToolError(`${d.title} is off the menu${who.length ? ` (${who.join(" and ")} gave it a thumbs-down)` : ""}. It can be restored from the Dropped list in the app first.`);
    }
    if (args.saveToRecipeBox === true) {
      if (d.custom && d.rotation === "bench") ops.push(set(["customDinners", d.id, "rotation"], "core"));
      else if (d.rotation === "bench" && !isPromoted(state, d.id)) ops.push(...promoteOps(db, state, { dinnerId: d.id, at }).ops);
      state = overlay(state, ops);
    }
  }

  // Sides to serve that night, when asked for.
  let sides = null;
  if (args.sides !== undefined) {
    if (!Array.isArray(args.sides) || args.sides.length > 3) throw new ToolError("sides must be a list of up to 3 side ids.");
    sides = args.sides.map((s) => checkSide(db, state, s));
  }

  const placed = placeDinnerOps(db, state, { dinnerId, date, who: by, at, today });
  if (placed.error) throw new ToolError(placed.message);
  let placeOps = placed.ops;
  if (sides) {
    if (placeOps.some((o) => o.op === "set" && o.path.length === 2 && o.path[1] === date)) {
      placeOps = placeOps.map((o) => (o.op === "set" && o.path.length === 2 && o.path[1] === date ? { ...o, value: { ...o.value, sides } } : o));
    } else placeOps = [...placeOps, set(["plan", date, "sides"], sides)];
  }
  ops.push(...placeOps);
  const after = overlay(state, placeOps);
  const d = dinnerById(db, after, dinnerId);
  const entry = after.plan?.[date];
  const served = sidesServed(db, after, dinnerId, entry);
  if (sides && served.some((s, i) => sides[i] && s.id !== sides[i])) notes.push("A side the family chose to remember for this dinner is served instead of the one asked for (change it in the app).");

  // Rice: about once a week.
  const week = datesBetween(startOfWeek(date, settingsOf(after).weekStartsOn), addDays(startOfWeek(date, settingsOf(after).weekStartsOn), 6));
  const rice = week.filter((x) => after.plan?.[x]?.status === "planned" && after.plan[x].dinner && nightIsRice(db, after, after.plan[x].dinner, after.plan[x]));
  if (rice.length > settingsOf(after).riceMaxPerWeek && rice.includes(date)) notes.push(`That week now has ${rice.length} rice nights (${rice.map(weekdayName).join(", ")}); the family keeps rice to about ${settingsOf(after).riceMaxPerWeek} a week.`);

  const revision = ctx.commit(ops);
  const n = perPlate(db, after, dinnerId, entry);
  return {
    message: placed.message || `${d.title} is on for ${date}.`,
    date,
    dinner: { id: d.id, title: d.title, minutes: d.minutes, equipment: d.equipment, ...(n ? { perPlate: n } : {}) },
    sides: served.map((s) => s.title),
    ...(placed.kind === "swap" || placed.kind === "move" ? { alsoChanged: placed.other } : {}),
    ...(placed.displaced ? { replaced: dinnerById(db, state, placed.displaced.dinner)?.title } : {}),
    ...(createdRecipe ? { recipe: createdRecipe } : {}),
    ...(notes.length ? { notes } : {}),
    ...(revision ? { revision } : {}),
  };
}

function checkSide(db, state, ref) {
  const id = typeof ref === "string" ? ref.trim() : "";
  if (!id || !db.sides[id]) throw new ToolError(`There's no side with id "${String(ref).slice(0, 60)}". Use side ids from list_recipes.`);
  if (isSideDropped(state, id)) throw new ToolError(`${db.sides[id].title} was voted off the menu; pick another side.`);
  return id;
}

function buildCustomDinner(db, state, recipe, { saveToRecipeBox, at, by }) {
  if (!isObj(recipe)) throw new ToolError("recipe must be an object.");
  const str = (v, max) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
  const title = str(recipe.title, 80);
  if (!title) throw new ToolError("recipe.title is missing.");
  const subtitle = str(recipe.subtitle, 160);
  if (!CATEGORIES.includes(recipe.category)) throw new ToolError(`recipe.category must be one of: ${CATEGORIES.join(", ")}.`);
  if (!PROTEINS.includes(recipe.protein)) throw new ToolError(`recipe.protein must be one of: ${PROTEINS.join(", ")}.`);
  const minutes = Number(recipe.minutes);
  // Up to 12 hours: a dinner can slow cook all afternoon in the PossibleCooker.
  if (!(minutes > 0 && minutes <= 720)) throw new ToolError("recipe.minutes must be the total time in minutes, start to table (at most 720).");
  const optMinutes = (v, what, max) => {
    if (v === undefined || v === null) return null;
    const n = Number(v);
    if (!(n >= 0 && n <= max)) throw new ToolError(`recipe.${what} must be minutes from 0 to ${max}.`);
    return Math.round(n);
  };
  const prepMinutes = optMinutes(recipe.prepMinutes, "prepMinutes", 240);
  const cookMinutes = optMinutes(recipe.cookMinutes, "cookMinutes", 720);
  if (!Array.isArray(recipe.equipment) || !recipe.equipment.length) throw new ToolError(`recipe.equipment must list what it's cooked on: ${EQUIPMENT.join(", ")}.`);
  const badEq = recipe.equipment.filter((e) => !EQUIPMENT.includes(e));
  if (badEq.length) throw new ToolError(`The family can't cook with ${badEq.join(", ")}. Equipment must be from: ${EQUIPMENT.join(", ")} (never an oven).`);
  // A step is a sentence or { text, minutes?, setting? }. The app's recipe pages read `steps` as
  // sentences, so that stays a list of strings; the timed version is kept beside it as stepDetails.
  const stepDetails = Array.isArray(recipe.steps) ? recipe.steps.map(cleanStep).filter(Boolean) : [];
  const steps = stepDetails.map((s) => s.text);
  if (!steps.length || steps.length > 20 || steps.some((s) => s.length < 10)) throw new ToolError("recipe.steps must be 1–20 plain sentences (or { text, minutes, setting } objects).");
  const tips = Array.isArray(recipe.tips) ? recipe.tips.map((t) => str(t, 240)).filter(Boolean).slice(0, 5) : [];
  const burger = recipe.category === "Burgers";
  if (!Array.isArray(recipe.sides) || !recipe.sides.length) throw new ToolError("recipe.sides must list the side ids it's served with (two; burgers one).");
  const sides = [...new Set(recipe.sides.map((s) => checkSide(db, state, s)))];
  if (!burger && sides.length !== 2) throw new ToolError("A dinner comes with two different sides (side ids from list_recipes).");
  if (burger && sides.length > 2) throw new ToolError("Burgers come with one side (usually jewel-fries), two at most.");
  if (!Array.isArray(recipe.items) || !recipe.items.length || recipe.items.length > 30) throw new ToolError("recipe.items must list the main dish's ingredients (1–30).");

  // Ingredients → recipe-box ids (or new shelf items), in each item's own unit.
  const ops = [];
  let local = state;
  const items = {};
  const names = [];
  const problems = [];
  const newShelfItems = [];
  recipe.items.forEach((it, i) => {
    if (!isObj(it)) { problems.push(`items[${i}] must be an object`); return; }
    const name = str(it.name, 120) || (typeof it.id === "string" ? readable(it.id) : "");
    const qty = Number(it.qty);
    if (!name) { problems.push(`items[${i}] needs a name`); return; }
    if (!(qty > 0)) { problems.push(`${name}: qty must be more than 0`); return; }
    names.push(name);
    let id = typeof it.id === "string" && knownId(db, local, it.id.trim()) ? it.id.trim() : null;
    if (!id) {
      const m = it.newItem === true ? { none: true } : matchName(db, local, name);
      if (m.id) id = m.id;
      else if (m.candidates) {
        problems.push(`"${name}" could be ${m.candidates.map((c) => `${c.id} (${c.name}, in ${c.unit})`).join(" or ")}: pass its id, or newItem: true if it's none of these`);
        return;
      } else {
        const c = customItemOps(local, { name, unit: shelfUnit(it.unit), aisle: guessAisle(name), kind: "measured", storage: "pantry" });
        ops.push(...c.ops);
        local = overlay(local, c.ops);
        id = c.id;
        if (c.ops.length) newShelfItems.push({ id, name, unit: local.custom[id].unit });
      }
    }
    const c = toItemUnit(db, local, id, qty, it.unit);
    if (c.error) { problems.push(c.error); return; }
    items[id] = round2((items[id] || 0) + c.qty);
  });
  if (problems.length) throw new ToolError(`The recipe wasn't saved: ${problems.join("; ")}.`);

  const itemIds = Object.keys(items);
  const meat = itemIds.some((id) => db.ingredients[id]?.meat || (local.custom?.[id] && MEAT_WORDS.test(local.custom[id].name))) || MEAT_WORDS.test(title);
  const broken = recipeProblems({ title, subtitle, steps: [...steps, ...stepDetails.map((s) => s.setting || "").filter(Boolean), ...tips], itemIds, itemNames: names, meat });
  if (broken.length) throw new ToolError(`That recipe breaks the house rules, so it wasn't saved: ${broken.join("; ")}. Change it and try again.`);

  // How the family wants to eat: said, never enforced (the dinner is theirs to choose).
  const notes = [];
  const vegSide = sides.some((s) => ["vegetable", "salad"].includes(db.sides[s]?.kind));
  if (!vegSide && !burger) notes.push("Neither side is a vegetable or a salad; the family wants one with every dinner. list_recipes with include: \"sides\" shows them.");
  if (/\bdeep[- ]?fr(y|ied|ying)\b|\bfry(ing)? in (\d+ )?(inch(es)? of |cups? of )?oil\b/i.test(steps.join(" "))) notes.push("The family is cutting back on frying: the air fryer, the griddle or the PossibleCooker would keep this one lighter.");

  const tags = Array.isArray(recipe.tags) ? recipe.tags.map((t) => String(t).toLowerCase().trim().slice(0, 30)).filter(Boolean).slice(0, 8) : [];
  if (burger && !tags.includes("burger")) tags.push("burger");
  const sideRice = sides.some((s) => RICE_IDS.some((r) => db.sides[s]?.items?.[r]));
  if ((RICE_IDS.some((r) => items[r]) || sideRice) && !tags.includes("rice")) tags.push("rice");

  // The same title again updates that custom dinner instead of making a copy.
  const existing = Object.entries(state.customDinners || {}).find(([, c]) => c && String(c.title || "").toLowerCase() === title.toLowerCase());
  let id = existing ? existing[0] : null;
  if (!id) {
    const base = `custom-dinner-${slugify(title)}`;
    id = base;
    for (let n = 2; db.dinners[id] || state.customDinners?.[id]; n++) id = `${base}-${n}`;
  }
  const keepCore = existing && existing[1].rotation !== "bench";
  const rotation = saveToRecipeBox || keepCore ? "core" : "bench";
  const value = {
    title, ...(subtitle ? { subtitle } : {}), category: recipe.category, protein: recipe.protein, minutes, equipment: [...new Set(recipe.equipment)],
    tags, rotation, items, steps, sides, sideSlots: burger ? 1 : 2, source: "claude", by, at,
    ...(prepMinutes !== null ? { prepMinutes } : {}), ...(cookMinutes !== null ? { cookMinutes } : {}),
    ...(stepDetails.some((s) => s.minutes || s.setting) ? { stepDetails } : {}), ...(tips.length ? { tips } : {}),
  };
  ops.push(set(["customDinners", id], value));
  return { ops, id, updated: !!existing, newShelfItems, rotation: rotation === "core" ? "rotation" : "one-off", notes };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// get_shopping_list
// ═════════════════════════════════════════════════════════════════════════════════════════════
const STORE_NAMES = { sams: "Sam's Club", jewel: "Jewel-Osco" };

function listItem(i) {
  const out = { id: i.id, name: i.name };
  const product = productName(i);
  if (product && product !== i.name) out.product = product;
  out.buy = formatPackQty(i);
  out.cost = i.cost;
  if (i.need > 0) out.needed = unitText(round2(i.need), i.unit);
  if (i.have > 0) out.have = unitText(round2(i.have), i.unit);
  out.for = i.reasons;
  if (i.checked) out.checked = true;
  if (i.coupon) out.coupon = i.coupon.text || "coupon";
  if (i.regularCost != null && i.cost != null && i.regularCost > i.cost) out.regularCost = i.regularCost;
  if (i.organic) out.organic = true;
  if (i.storeFallback) out.note = `Not sold at the other store, so it's bought here.`;
  return out;
}

function getShoppingList(args, { db, state, today }) {
  const st = settingsOf(state);
  if (args.store !== undefined && !["jewel", "sams", "both"].includes(args.store)) throw new ToolError('store must be "jewel", "sams" or "both".');
  let range;
  let listKey;
  let store = args.store === "jewel" || args.store === "sams" ? args.store : null;
  let trip = null;
  if (args.from === undefined && args.to === undefined) {
    const t = st.trip && st.trip.end >= today ? st.trip : null;
    if (t) {
      const start = t.start > today ? t.start : today;
      range = { from: start, to: t.end, dates: datesBetween(start, t.end) };
      listKey = `trip:${t.start}:${t.end}:${t.store}`;
      if (args.store === undefined) store = t.store === "both" ? null : t.store;
      trip = { store: t.store, through: t.end };
    } else {
      const r = periodRange(defaultAnchor(today, st.period, st.weekStartsOn), st.period, st.weekStartsOn);
      range = { from: r.start, to: r.end, dates: r.dates };
      listKey = listKeyFor(r);
    }
  } else {
    range = rangeArgs(args, today);
    listKey = `${range.from}+${range.dates.length}`;
  }
  const list = buildList(db, state, { dates: range.dates, listKey, store, today });
  const stores = {};
  for (const s of ["jewel", "sams"]) {
    const part = list.stores[s];
    if (!part.items.length) continue;
    stores[s] = { store: STORE_NAMES[s], subtotal: part.subtotal, items: part.items.map(listItem), ...(part.unpriced ? { unpriced: part.unpriced } : {}) };
  }
  return {
    from: range.from, to: range.to, ...(trip ? { trip } : {}),
    planFrom: store || st.planStore,
    dinners: list.nights.length,
    packedLunches: list.lunches.length,
    total: list.total,
    ...(list.savings > 0 ? { savingsFromSalesAndCoupons: list.savings, regularTotal: list.regularTotal } : {}),
    perDinner: list.perDinner,
    stores,
    ...(list.coupons.length ? { couponsToClip: list.coupons.filter((c) => !c.clipped).map((c) => `${STORE_NAMES[c.store]}: ${c.name} — ${c.text}`) } : {}),
    ...(list.skipped.length ? { skippedThisTrip: list.skipped.map((i) => i.name) } : {}),
    ...(list.onDay.length ? { buyFreshOnTheDay: list.onDay.map((i) => ({ name: i.name, cost: i.cost })) } : {}),
    alreadyHave: list.covered.length,
    pricesUpdated: list.pricesUpdated,
    note: "Prices are the family's last paid prices or researched estimates; the stores don't publish live prices. Packs are rounded up, so some food is left over for later.",
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// get_use_first (app/freshness.js): what to eat soon, and the dinners that would use it
// ═════════════════════════════════════════════════════════════════════════════════════════════
function getUseFirst(args, { db, state, today }) {
  const days = args.days === undefined ? 4 : args.days;
  if (!Number.isInteger(days) || days < 0 || days > 30) throw new ToolError("days must be a whole number from 0 to 30.");
  const soon = useSoon(db, state, today, { soon: days, freezerSoon: 30 });
  const ids = new Set(soon.map((u) => u.id));
  const uses = new Map();
  if (ids.size) {
    const rem = onHand(db, state);
    for (const d of allDinners(db, state)) {
      if (isRetired(state, d.id)) continue;
      const items = itemsForNight(db, state, d.id, null);
      const hit = Object.keys(items).filter((id) => ids.has(id));
      if (!hit.length) continue;
      const row = { id: d.id, title: d.title, minutes: d.minutes, canCookNow: !shortfall(db, state, rem, items).length };
      for (const id of hit) uses.set(id, [...(uses.get(id) || []), row]);
    }
  }
  // Nights already planned (the next two weeks) that will use each item.
  const plannedFor = new Map();
  for (const date of datesBetween(today, addDays(today, 13))) {
    const e = state.plan?.[date];
    if (!e?.dinner || e.status !== "planned" || !dinnerById(db, state, e.dinner)) continue;
    for (const id of Object.keys(itemsForNight(db, state, e.dinner, e))) if (ids.has(id)) plannedFor.set(id, [...(plannedFor.get(id) || []), date]);
  }
  const useFirst = soon.map((u) => {
    const row = pantryRow(db, state, u.id, today);
    const dinners = (uses.get(u.id) || []).sort((a, b) => b.canCookNow - a.canCookNow || a.minutes - b.minutes || a.title.localeCompare(b.title));
    return compact({
      id: u.id, name: u.name, place: u.place, kind: row.kind,
      amount: row.qty != null ? unitText(row.qty, row.unit) : undefined, packages: row.packages,
      since: row.since, useBy: u.useBy, daysLeft: u.daysLeft,
      when: u.daysLeft < 0 ? "past its estimated use-by: check it before cooking (the package date wins)" : u.daysLeft === 0 ? "use today" : u.daysLeft === 1 ? "use by tomorrow" : `use within ${u.daysLeft} days`,
      plannedFor: plannedFor.get(u.id),
      dinners: dinners.length ? dinners.slice(0, 6) : undefined,
    });
  });
  const unplanned = useFirst.filter((u) => !u.plannedFor);
  return {
    today,
    lookingAhead: { fridgeAndCounterDays: days, freezerDays: 30 },
    count: useFirst.length,
    useFirst,
    notInAnyPlannedDinner: unplanned.map((u) => u.name),
    note: useFirst.length
      ? "Use-by dates are estimates from the day each item came home; the date on the package wins. Plan the soonest food first; freezer food keeps, so fridge and counter food comes first."
      : "Nothing at home needs using up in that time.",
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// get_health_summary (app/nutrition.js + app/health.js): calories, protein and vegetables
// ═════════════════════════════════════════════════════════════════════════════════════════════
function getHealthSummary(args, { db, state, today }) {
  const range = args.from === undefined && args.to === undefined
    ? { from: addDays(today, -7), to: addDays(today, 7), dates: datesBetween(addDays(today, -7), addDays(today, 7)) }
    : rangeArgs(args, today);
  const nights = [];
  for (const date of range.dates) {
    const e = state.plan?.[date];
    if (!e?.dinner || e.status === "away") continue;
    const d = dinnerById(db, state, e.dinner);
    if (!d) continue;
    const n = plateNutrition(db, state, d.id, e);
    const night = { date, day: weekdayName(date), status: e.status === "cooked" ? "cooked" : "planned", dinner: d.title, sides: sidesServed(db, state, d.id, e).map((s) => s.title) };
    if (n) {
      night.kcal = Math.round(n.kcal);
      night.proteinG = Math.round(n.protein);
      if (!n.complete) night.notCounted = n.missing.map((id) => itemMeta(db, state, id).name);
      // The same plate the app shows, and its one lean rule (app/nutrition.js LEAN_RULE).
      const h = plateHealth(db, state, d.id, e);
      if (h) {
        night.vegetableServings = h.vegServings;
        if (h.lean) night.lean = true;
      }
    } else night.noData = true;
    nights.push(night);
  }
  const counted = nights.filter((n) => typeof n.kcal === "number");
  const avg = (k) => (counted.length ? Math.round(counted.reduce((t, n) => t + n[k], 0) / counted.length) : null);
  const byKcal = [...counted].sort((a, b) => a.kcal - b.kcal);
  const pick = (n) => (n ? { date: n.date, dinner: n.dinner, kcal: n.kcal, proteinG: n.proteinG } : undefined);
  const veg = veggieCheck(db, state, range.dates);
  return compact({
    from: range.from, to: range.to, today,
    dinners: nights.length,
    perPlate: counted.length ? { averageKcal: avg("kcal"), averageProteinG: avg("proteinG"), countedDinners: counted.length, leanDinners: counted.filter((n) => n.lean).length } : undefined,
    leanMeans: `A lean plate is ${LEAN_RULE.maxKcal} calories or less with at least ${LEAN_RULE.minProteinG} g of protein (the main plus its sides, one of five). It describes a plate, never a person: nobody has a calorie target.`,
    lightest: byKcal.length > 1 ? pick(byKcal[0]) : undefined,
    heaviest: byKcal.length > 1 ? pick(byKcal[byKcal.length - 1]) : undefined,
    mostProtein: counted.length > 1 ? pick([...counted].sort((a, b) => b.proteinG - a.proteinG)[0]) : undefined,
    vegetables: {
      plannedDinners: veg.total,
      withAVegetableOrSalad: veg.withVeg,
      without: veg.gaps.map((g) => ({ date: g.date, dinner: g.dinner.title, sides: g.sides, suggestion: g.add ? "add a vegetable as the second side" : `swap ${g.sides[g.slot] || "a side"} for a vegetable or a salad` })),
    },
    nights,
    note: "Per adult plate: the main plus its sides as served, from the recipe box's nutrition data (estimates). The family wants lean, high-protein dinners with a vegetable in full portions; there are no calorie targets.",
  });
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// small helpers
// ═════════════════════════════════════════════════════════════════════════════════════════════
function isObj(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function compact(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") out[k] = v;
  return out;
}
