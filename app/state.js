// The family state document, the queue of pending ops, and sync with the Worker
// (SPEC §4/§5). The local view is always: last server state + pending ops applied
// in order, so offline changes show instantly and survive reloads.

import { clone, uid } from './util.js';

export const DEFAULT_SETTINGS = Object.freeze({
  planStore: 'both',
  brand: 'generic',
  monthlyTarget: 650,
  period: 'week',
  burgerNights: [0, 4], // Monday-based: 0 = Monday … 6 = Sunday → Mon + Fri
  pizzaPerMonth: 2,
  riceMaxPerWeek: 1,
  weekStartsOn: 1,
});

export function settingsOf(state) {
  const s = { ...DEFAULT_SETTINGS, ...(state?.settings || {}) };
  if (!['both', 'sams', 'jewel'].includes(s.planStore)) s.planStore = 'both';
  if (!['generic', 'name'].includes(s.brand)) s.brand = 'generic';
  if (!['week', 'two', 'three', 'month'].includes(s.period)) s.period = 'week';
  if (!Array.isArray(s.burgerNights)) s.burgerNights = [...DEFAULT_SETTINGS.burgerNights];
  s.monthlyTarget = Number.isFinite(Number(s.monthlyTarget)) && Number(s.monthlyTarget) > 0 ? Number(s.monthlyTarget) : 650;
  s.pizzaPerMonth = Math.max(0, Math.min(4, Number.isFinite(Number(s.pizzaPerMonth)) ? Number(s.pizzaPerMonth) : 2));
  s.riceMaxPerWeek = Math.max(0, Math.min(7, Number.isFinite(Number(s.riceMaxPerWeek)) ? Number(s.riceMaxPerWeek) : 1));
  s.weekStartsOn = [0, 1].includes(Number(s.weekStartsOn)) ? Number(s.weekStartsOn) : 1;
  return s;
}

/** Applies one op in place (same semantics as the Worker: create intermediates, last write wins). */
export function applyOpInPlace(state, op) {
  const p = op?.path;
  if (!Array.isArray(p) || p.length === 0) return state;
  let o = state;
  for (let i = 0; i < p.length - 1; i++) {
    const k = p[i];
    if (o[k] === null || typeof o[k] !== 'object') o[k] = {};
    o = o[k];
  }
  const last = p[p.length - 1];
  if (op.op === 'set') o[last] = clone(op.value);
  else if (op.op === 'del') {
    if (Array.isArray(o)) o.splice(Number(last), 1);
    else delete o[last];
  } else if (op.op === 'push') {
    if (!Array.isArray(o[last])) o[last] = [];
    o[last].push(clone(op.value));
  }
  return state;
}

/** Pure: returns a new state with the ops applied. */
export function applyOps(state, ops) {
  const s = clone(state || {}) || {};
  for (const op of ops || []) applyOpInPlace(s, op);
  return s;
}

export const set = (path, value) => ({ op: 'set', path, value });
export const del = (path) => ({ op: 'del', path });
export const push = (path, value) => ({ op: 'push', path, value });

/** SPEC §5 key derivation; the raw passcode never leaves the phone. */
export async function deriveKey(passcode) {
  const text = 'bilbrey-dinner-planner:' + String(passcode).trim().toLowerCase();
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function makeStorage(ls = globalThis.localStorage) {
  const mem = new Map();
  return {
    get(k) {
      try { const v = ls?.getItem(k); if (v != null) return JSON.parse(v); } catch { /* fall through */ }
      return mem.has(k) ? clone(mem.get(k)) : null;
    },
    set(k, v) {
      mem.set(k, clone(v));
      try { ls?.setItem(k, JSON.stringify(v)); } catch { /* quota or private mode: memory copy still works */ }
    },
    remove(k) {
      mem.delete(k);
      try { ls?.removeItem(k); } catch { /* ignore */ }
    },
  };
}

const K = { server: 'bfdp.v2.server', pending: 'bfdp.v2.pending', device: 'bfdp.v2.device' };

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/**
 * status: 'local' (this phone only) | 'synced' | 'syncing' | 'offline' |
 *         'needs-setup' (no family passcode yet) | 'needs-passcode' | 'error'
 */
export class Store {
  constructor({ storage = makeStorage(), fetchFn = globalThis.fetch?.bind(globalThis), apiBase = '', timeoutMs = 10000, autoSync = true } = {}) {
    this.storage = storage;
    this.fetchFn = fetchFn;
    this.apiBase = apiBase.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
    this.autoSync = autoSync;
    this.listeners = new Set();
    const dev = storage.get(K.device) || {};
    this.device = { who: dev.who || null, key: dev.key || null, localOnly: !!dev.localOnly, clientId: dev.clientId || uid('c'), dismissedGate: !!dev.dismissedGate, theme: dev.theme || 'auto' };
    const srv = storage.get(K.server);
    this.server = srv && typeof srv === 'object' ? { revision: Number(srv.revision) || 0, state: srv.state || {}, updatedAt: srv.updatedAt || null } : { revision: 0, state: {}, updatedAt: null };
    this.pending = Array.isArray(storage.get(K.pending)) ? storage.get(K.pending) : [];
    this.status = this.device.localOnly ? 'local' : 'offline';
    this.statusDetail = '';
    this.health = null;
    this.lastSyncAt = null;
    this.syncing = false;
    this.again = false;
    this.retryMs = 0;
    this.retryTimer = null;
    this.pushTimer = null;
    this.recompute();
    this.saveDevice();
  }

  recompute() {
    this.state = applyOps(this.server.state, this.pending);
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(kind = 'state') { for (const fn of this.listeners) { try { fn(kind, this); } catch (e) { console.error(e); } } }

  saveDevice() { this.storage.set(K.device, this.device); }
  saveData() {
    this.storage.set(K.server, this.server);
    this.storage.set(K.pending, this.pending);
  }

  setDevice(patch) {
    Object.assign(this.device, patch);
    this.saveDevice();
    this.emit('device');
  }

  setStatus(status, detail = '') {
    if (this.status === status && this.statusDetail === detail) return;
    this.status = status;
    this.statusDetail = detail;
    this.emit('status');
  }

  /** Apply ops locally right away, queue them for the server. */
  commit(ops) {
    const list = (ops || []).filter(Boolean);
    if (!list.length) return;
    for (const op of list) this.pending.push({ ...clone(op), _id: uid('o') });
    this.recompute();
    this.saveData();
    this.emit('state');
    if (this.autoSync) this.schedulePush();
  }

  schedulePush(ms = 350) {
    if (this.device.localOnly || !this.device.key) return;
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => this.sync(), ms);
  }

  async api(method, path, body, { auth = true, timeoutMs = this.timeoutMs } = {}) {
    if (!this.fetchFn || !this.apiBase) throw new ApiError(0, 'No connection');
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    let res;
    try {
      res = await this.fetchFn(this.apiBase + path, {
        method,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(auth && this.device.key ? { 'X-Family-Key': this.device.key } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl?.signal,
        cache: 'no-store',
      });
    } catch (e) {
      throw new ApiError(0, e?.name === 'AbortError' ? 'The connection timed out' : 'No connection');
    } finally {
      if (t) clearTimeout(t);
    }
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) throw new ApiError(res.status, data?.error || `Request failed (${res.status})`);
    return data;
  }

  /** Checks the Worker. Returns health or null when unreachable. */
  async checkHealth() {
    try {
      this.health = await this.api('GET', '/api/health', null, { auth: false, timeoutMs: 6000 });
      return this.health;
    } catch {
      this.health = null;
      return null;
    }
  }

  /** Decides the sync status from health + device and syncs if possible. */
  async connect() {
    if (this.device.localOnly) { this.setStatus('local'); return this.status; }
    const h = await this.checkHealth();
    if (!h) { this.setStatus('offline'); this.scheduleRetry(); return this.status; }
    if (!h.hasPasscode) { this.setStatus('needs-setup'); return this.status; }
    if (!this.device.key) { this.setStatus('needs-passcode'); return this.status; }
    await this.sync();
    return this.status;
  }

  async createPasscode(passcode) {
    const key = await deriveKey(passcode);
    try {
      await this.api('POST', '/api/setup', { key }, { auth: false });
    } catch (e) {
      if (e.status === 409) throw new ApiError(409, 'The family passcode was already created. Enter it instead.');
      throw e;
    }
    this.setDevice({ key, localOnly: false });
    await this.sync();
    return true;
  }

  async enterPasscode(passcode) {
    const key = await deriveKey(passcode);
    const prev = this.device.key;
    this.device.key = key;
    try {
      const r = await this.api('GET', '/api/state');
      this.acceptServer(r);
    } catch (e) {
      this.device.key = prev;
      if (e.status === 401) throw new ApiError(401, "That passcode doesn't match. Check with Jeff or Candi.");
      if (e.status === 429) throw new ApiError(429, 'Too many tries. Wait a minute, then try again.');
      throw e;
    }
    this.setDevice({ key, localOnly: false });
    await this.sync();
    return true;
  }

  async changePasscode(passcode) {
    const newKey = await deriveKey(passcode);
    await this.api('POST', '/api/key', { newKey });
    this.setDevice({ key: newKey });
    return true;
  }

  acceptServer(r) {
    if (!r || r.unchanged) return;
    this.server = { revision: Number(r.revision) || 0, state: r.state || {}, updatedAt: r.updatedAt || null };
    this.recompute();
    this.saveData();
    this.emit('state');
  }

  scheduleRetry() {
    if (this.device.localOnly) return;
    clearTimeout(this.retryTimer);
    this.retryMs = Math.min(60000, this.retryMs ? this.retryMs * 2 : 5000);
    this.retryTimer = setTimeout(() => (this.device.key ? this.sync() : this.connect()), this.retryMs);
  }

  /** Push pending ops (≤200 per request), then pull. Safe to call any time. */
  async sync() {
    if (this.device.localOnly) { this.setStatus('local'); return; }
    if (!this.device.key) return;
    if (this.syncing) { this.again = true; return; }
    this.syncing = true;
    try {
      while (this.pending.length) {
        this.setStatus('syncing');
        const batch = this.pending.slice(0, 200);
        const ids = new Set(batch.map((o) => o._id));
        const r = await this.api('POST', '/api/ops', {
          ops: batch.map(({ _id, ...op }) => op),
          by: this.device.who || 'Family',
          clientId: this.device.clientId,
        });
        this.pending = this.pending.filter((o) => !ids.has(o._id));
        this.server = { revision: Number(r.revision) || 0, state: r.state || {}, updatedAt: r.updatedAt || null };
        this.recompute();
        this.saveData();
        this.emit('state');
      }
      const r = await this.api('GET', `/api/state?since=${this.server.revision}`);
      this.acceptServer(r);
      this.retryMs = 0;
      this.lastSyncAt = Date.now();
      this.setStatus('synced');
    } catch (e) {
      if (e.status === 401) this.setStatus('needs-passcode', 'The family passcode changed. Enter the new one to keep syncing.');
      else if (e.status === 429) { this.setStatus('error', 'Too many tries. Syncing will try again shortly.'); this.scheduleRetry(); }
      else if (e.status >= 400 && e.status < 500 && e.status !== 408) this.setStatus('error', e.message);
      else { this.setStatus('offline'); this.scheduleRetry(); }
    } finally {
      this.syncing = false;
      if (this.again) { this.again = false; if (this.pending.length) this.sync(); }
    }
  }

  useLocalOnly() {
    clearTimeout(this.retryTimer);
    this.setDevice({ localOnly: true });
    this.setStatus('local');
  }

  async useFamilySync() {
    this.setDevice({ localOnly: false });
    return this.connect();
  }

  /** Clears everything stored on this phone (the family's server copy is untouched). */
  resetLocal({ keepDevice = false } = {}) {
    this.storage.remove(K.server);
    this.storage.remove(K.pending);
    this.server = { revision: 0, state: {}, updatedAt: null };
    this.pending = [];
    if (!keepDevice) {
      this.storage.remove(K.device);
      this.device = { who: null, key: null, localOnly: false, clientId: uid('c'), dismissedGate: false, theme: 'auto' };
      this.saveDevice();
    }
    this.recompute();
    this.emit('state');
  }
}
