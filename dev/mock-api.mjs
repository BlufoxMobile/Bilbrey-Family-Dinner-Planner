// Dev-only in-memory implementation of the Worker API (SPEC §5), no dependencies.
//   node dev/mock-api.mjs [--port 8788] [--no-ai] [--passcode tacos]
// Extra test-only endpoints: GET /__mock/state, POST /__mock/reset {passcode?}
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const keyFor = (pass) => createHash('sha256').update('bilbrey-dinner-planner:' + pass.trim().toLowerCase()).digest('hex');

export function applyOpServer(state, op) {
  const p = op.path || [];
  if (!Array.isArray(p) || !p.length) return;
  let o = state;
  for (let i = 0; i < p.length - 1; i++) {
    const k = p[i];
    if (o[k] === null || typeof o[k] !== 'object') o[k] = {};
    o = o[k];
  }
  const last = p[p.length - 1];
  if (op.op === 'set') o[last] = op.value;
  else if (op.op === 'del') { if (Array.isArray(o)) o.splice(Number(last), 1); else delete o[last]; }
  else if (op.op === 'push') { if (!Array.isArray(o[last])) o[last] = []; o[last].push(op.value); }
}

export function startMockApi({ port = 8788, ai = true, passcode = null, quiet = false, latency = 0 } = {}) {
  const db = { salt: null, hash: null, revision: 0, updatedAt: null, state: {}, fails: 0, lastFail: 0, batches: new Map(), opsRequests: 0 };
  const setKey = (key) => { db.salt = randomBytes(8).toString('hex'); db.hash = createHash('sha256').update(db.salt + key).digest('hex'); };
  const reset = (pc) => { db.salt = db.hash = null; db.revision = 0; db.updatedAt = null; db.state = {}; db.fails = 0; db.batches = new Map(); db.opsRequests = 0; if (pc) setKey(keyFor(pc)); };
  reset(passcode);

  const cors = (req) => {
    const origin = req.headers.origin || '';
    const ok = /^https:\/\/blufoxmobile\.github\.io$/.test(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    return ok ? {
      'Access-Control-Allow-Origin': origin, 'Vary': 'Origin',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Family-Key',
      'Access-Control-Max-Age': '600',
    } : {};
  };
  const photos = new Map();
  const send = (res, req, code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json', ...cors(req) });
    res.end(JSON.stringify(body));
  };
  const readBody = (req) => new Promise((resolve) => {
    let s = ''; req.on('data', (c) => { s += c; }); req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { resolve(null); } });
  });
  const authed = (req) => {
    const k = req.headers['x-family-key'];
    return !!(k && db.hash && createHash('sha256').update(db.salt + k).digest('hex') === db.hash);
  };

  const server = http.createServer(async (req, res) => {
    if (latency) await new Promise((r) => setTimeout(r, latency));
    const url = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') { res.writeHead(204, cors(req)); return res.end(); }
    const p = url.pathname;
    if (p === '/__mock/state') return send(res, req, 200, { revision: db.revision, state: db.state, hasPasscode: !!db.hash, opsRequests: db.opsRequests, receiptCalls: db.receiptCalls || 0, lastReceipt: db.lastReceipt || null });
    if (p === '/__mock/reset' && req.method === 'POST') { const b = await readBody(req); reset(b?.passcode || null); return send(res, req, 200, { ok: true }); }
    if (p === '/api/health') return send(res, req, 200, { ok: true, hasPasscode: !!db.hash, ai, revision: db.revision });
    if (p === '/api/setup' && req.method === 'POST') {
      const b = await readBody(req);
      if (!b || typeof b.key !== 'string' || !/^[0-9a-f]{64}$/.test(b.key)) return send(res, req, 400, { error: 'key must be a 64-character hex string' });
      if (db.hash) return send(res, req, 409, { error: 'A family passcode already exists' });
      setKey(b.key);
      return send(res, req, 201, { ok: true });
    }
    // Everything below needs the family key.
    if (!db.hash) return send(res, req, 401, { error: "The family passcode hasn't been set up yet.", needsSetup: true });
    if (!authed(req)) {
      const now = Date.now();
      if (now - db.lastFail < 60000) db.fails++; else db.fails = 1;
      db.lastFail = now;
      if (db.fails > 8) { res.setHeader('Retry-After', '60'); return send(res, req, 429, { error: 'Too many wrong passcodes. Try again in 1 minute.', retryAfter: 60 }); }
      return send(res, req, 401, { error: 'Wrong family passcode' });
    }
    db.fails = 0;
    if (p === '/api/key' && req.method === 'POST') {
      const b = await readBody(req);
      if (!b || !/^[0-9a-f]{64}$/.test(b.newKey || '')) return send(res, req, 400, { error: 'newKey must be a 64-character hex string' });
      setKey(b.newKey);
      return send(res, req, 200, { ok: true });
    }
    if (p === '/api/state' && req.method === 'GET') {
      const since = Number(url.searchParams.get('since'));
      if (url.searchParams.has('since') && since === db.revision) return send(res, req, 200, { revision: db.revision, unchanged: true });
      return send(res, req, 200, { revision: db.revision, updatedAt: db.updatedAt, state: db.state });
    }
    if (p === '/api/ops' && req.method === 'POST') {
      const b = await readBody(req);
      db.opsRequests++;
      if (!b || !Array.isArray(b.ops) || !b.ops.length) return send(res, req, 400, { error: 'ops must be a non-empty array' });
      if (b.ops.length > 200) return send(res, req, 400, { error: 'At most 200 ops per request' });
      const bad = b.ops.findIndex((op) => !op || !['set', 'del', 'push'].includes(op.op) || !Array.isArray(op.path) || !op.path.length || (op.op !== 'del' && op.value === undefined));
      if (bad >= 0) return send(res, req, 400, { error: `ops[${bad}] is not a valid op` });
      const bk = b.clientId && b.batchId ? `${b.clientId}/${b.batchId}` : null;
      if (bk && db.batches.has(bk)) return send(res, req, 200, { revision: db.revision, updatedAt: db.updatedAt, state: db.state, duplicate: true });
      const before = JSON.stringify(db.state);
      for (const op of b.ops) applyOpServer(db.state, op);
      if (JSON.stringify(db.state).length > 1_000_000) { db.state = JSON.parse(before); return send(res, req, 413, { error: 'State is over 1 MB' }); }
      if (bk) db.batches.set(bk, db.revision + 1);
      db.revision++; db.updatedAt = new Date().toISOString();
      return send(res, req, 200, { revision: db.revision, updatedAt: db.updatedAt, state: db.state });
    }
    // Pantry item pictures (SPEC §13), kept in memory like the worker's photos table.
    if (p === '/api/photo' && req.method === 'POST') {
      const chunks = []; for await (const c of req) chunks.push(c);
      const data = Buffer.concat(chunks);
      if (!data.length || data.length > 400 * 1024) return send(res, req, data.length ? 413 : 400, { error: 'A picture is 1 byte to 400 KB' });
      const id = randomBytes(16).toString('hex');
      photos.set(id, { mime: req.headers['content-type'] || 'image/jpeg', data });
      return send(res, req, 201, { ok: true, id });
    }
    if (p === '/api/photo' && req.method === 'GET') {
      const ph = photos.get(url.searchParams.get('id') || '');
      if (!ph) return send(res, req, 404, { error: 'No such picture' });
      res.writeHead(200, { 'Content-Type': ph.mime, 'Cache-Control': 'private, max-age=31536000, immutable', ...cors(req) });
      return res.end(ph.data);
    }
    if (p === '/api/scan' && req.method === 'POST') {
      const b = await readBody(req);
      if (!b || typeof b.image !== 'string' || !b.image.startsWith('data:image/')) return send(res, req, 400, { error: 'image must be a data URL' });
      if (b.image.length > 1.5 * 1024 * 1024 * 1.37) return send(res, req, 413, { error: 'Image is over 1.5 MB' });
      if (!ai) return send(res, req, 503, { error: 'Pantry scanning is not available right now' });
      const known = Array.isArray(b.known) ? b.known : [];
      const seen = [
        { name: 'Canned green beans', qty: 4, unit: 'cans', confidence: 0.93 },
        { name: 'Spaghetti', qty: 32, unit: 'oz', confidence: 0.86 },
        { name: 'Table salt', qty: null, unit: null, confidence: 0.81 },
        { name: 'Rotel original', qty: 2, unit: 'cans', confidence: 0.64 },
        { name: 'Marinara sauce, jarred', brand: "Rao's", label: 'Homemade Marinara Sauce', qty: 1, unit: 'jar', confidence: 0.95 },
      ];
      const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
      const items = seen.map((s) => {
        const n = norm(s.name);
        let best = null;
        for (const k of known) {
          for (const a of [k.name, ...(k.aliases || [])]) {
            const an = norm(a);
            if (!an) continue;
            const score = an === n ? 1000 : n.includes(an) ? an.length : 0;
            if (score && (!best || score > best.score)) best = { id: k.id, score };
          }
        }
        return { ...s, matchId: best ? best.id : null };
      });
      return send(res, req, 200, { items, model: 'mock-vision' });
    }
    if (p === '/api/receipt' && req.method === 'POST') {
      // SPEC §9.3: { images: [dataURL ≤1.5 MB, …≤4], store?, known } → a read receipt.
      const b = await readBody(req);
      const imgs = Array.isArray(b?.images) ? b.images : [];
      if (!imgs.length || imgs.length > 4 || !imgs.every((x) => typeof x === 'string' && x.startsWith('data:image/'))) return send(res, req, 400, { error: 'images must be 1–4 data URLs' });
      if (imgs.some((x) => x.length > 1.5 * 1024 * 1024) || imgs.reduce((t, x) => t + x.length, 0) > 4.5 * 1024 * 1024) return send(res, req, 413, { error: 'Images are too large' });
      if (!ai) return send(res, req, 503, { error: 'Receipt reading is not available right now' });
      db.receiptCalls = (db.receiptCalls || 0) + 1;
      db.lastReceipt = { images: imgs.length, store: b.store || null, known: Array.isArray(b.known) ? b.known.length : 0 };
      const known = new Set((Array.isArray(b.known) ? b.known : []).map((k) => k.id));
      const m = (id) => (known.has(id) ? id : null);
      const lines = [
        { text: 'MM CHKN BRST BNLS', product: "Member's Mark Boneless Skinless Chicken Breasts", brand: "Member's Mark", size: '6.5 lb', qty: 1, unitPrice: 19.43, lineTotal: 19.43, discount: 0, matchId: m('chicken'), confidence: 0.94 },
        { text: 'MM SHRD MLD CHDR', product: "Member's Mark Shredded Mild Cheddar", brand: "Member's Mark", size: '2 lb', qty: 2, unitPrice: 8.48, lineTotal: 16.96, discount: 2, matchId: m('cheese'), confidence: 0.9 },
        { text: 'MSN FLR TORT 40CT', product: 'Mission Medium Flour Tortillas', brand: 'Mission', size: '40 ct', qty: 1, unitPrice: 7.98, lineTotal: 7.98, discount: 0, matchId: null, confidence: 0.7 },
        { text: 'MM PAPER TWL 12RL', product: "Member's Mark Paper Towels", brand: "Member's Mark", size: '12 rolls', qty: 1, unitPrice: 22.98, lineTotal: 22.98, discount: 0, matchId: null, confidence: 0.92 },
      ];
      // Tests can add lines (e.g. for an item they know is on this week's list).
      for (const l of db.receiptExtraLines || []) lines.push({ discount: 0, confidence: 0.9, ...l });
      const subtotal = Math.round(lines.reduce((t, l) => t + l.lineTotal - l.discount, 0) * 100) / 100;
      const tax = 1.84;
      return send(res, req, 200, {
        store: b.store === 'jewel' ? 'jewel' : 'sams', date: '2026-11-15', subtotal, tax, total: Math.round((subtotal + tax) * 100) / 100, savings: 2,
        lines, model: 'mock-vision',
      });
    }
    send(res, req, 404, { error: 'Not found' });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
    if (!quiet) console.log(`Mock API: http://127.0.0.1:${server.address().port} (ai=${ai}, passcode=${passcode ? 'set' : 'none'})`);
    resolve({ server, db, reset });
  }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const a = process.argv.slice(2);
  const port = Number(a[a.indexOf('--port') + 1]) || 8788;
  const pi = a.indexOf('--passcode');
  startMockApi({ port, ai: !a.includes('--no-ai'), passcode: pi >= 0 ? a[pi + 1] : null });
}
