// Dev-only static server that mimics GitHub Pages: serves the repo root under
// /Bilbrey-Family-Dinner-Planner/. If data/catalog.json or data/recipes.json don't
// exist yet (the recipes agent is still writing them), serves the v1→v2 adapter
// output instead so the app can be built and tested against the contract.
//   node dev/serve.mjs [--port 8080] [--no-adapter]
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAdapted } from './adapter-v1.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PREFIX = '/Bilbrey-Family-Dinner-Planner';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

export function startStatic({ port = 8080, adapter = true, quiet = false } = {}) {
  let adapted = null;
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      let p = decodeURIComponent(url.pathname);
      if (p === '/' || p === PREFIX) { res.writeHead(302, { Location: PREFIX + '/' }); return res.end(); }
      if (!p.startsWith(PREFIX + '/')) { res.writeHead(404); return res.end('Not under ' + PREFIX); }
      p = p.slice(PREFIX.length);
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT) || /node_modules|\/\.git\//.test(file)) { res.writeHead(403); return res.end(); }
      if (adapter && (p === '/data/catalog.json' || p === '/data/recipes.json') && !existsSync(file)) {
        adapted ||= loadAdapted();
        const body = JSON.stringify(p.endsWith('catalog.json') ? adapted.catalog : adapted.recipes);
        res.writeHead(200, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store', 'X-Dev-Adapter': 'v1' });
        return res.end(body);
      }
      const st = await stat(file).catch(() => null);
      if (!st || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
      const body = await readFile(file);
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
        ...(p === '/sw.js' ? { 'Service-Worker-Allowed': PREFIX + '/' } : {}),
      });
      res.end(body);
    } catch (e) {
      res.writeHead(500); res.end(String(e));
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
    if (!quiet) console.log(`Static: http://127.0.0.1:${server.address().port}${PREFIX}/`);
    resolve(server);
  }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const port = Number(args[args.indexOf('--port') + 1]) || 8080;
  startStatic({ port, adapter: !args.includes('--no-adapter') });
}
