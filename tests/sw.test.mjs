import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

test('service worker precaches every app file, and they all exist', () => {
  const sw = readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const list = JSON.parse(sw.slice(sw.indexOf('const SHELL_FILES = [') + 'const SHELL_FILES = '.length, sw.indexOf('];', sw.indexOf('const SHELL_FILES')) + 1).replace(/'/g, '"').replace(/,\s*\]/, ']'));
  const files = [
    ...readdirSync(path.join(ROOT, 'app')).filter((f) => f.endsWith('.js')).map((f) => `app/${f}`),
    ...readdirSync(path.join(ROOT, 'app/views')).filter((f) => f.endsWith('.js')).map((f) => `app/views/${f}`),
    ...readdirSync(path.join(ROOT, 'styles')).filter((f) => f.endsWith('.css')).map((f) => `styles/${f}`),
    ...readdirSync(path.join(ROOT, 'fonts')).filter((f) => f.endsWith('.woff2')).map((f) => `fonts/${f}`),
  ];
  for (const f of files) assert.ok(list.includes(f), `${f} is precached`);
  for (const f of list) if (f !== './') assert.ok(existsSync(path.join(ROOT, f)), `${f} exists`);
});

test('cache version matches the app version', () => {
  const sw = readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const cfg = readFileSync(path.join(ROOT, 'app/config.js'), 'utf8');
  const v1 = /CACHE_VERSION = 'v([\d.]+)'/.exec(sw)?.[1];
  const v2 = /VERSION = '([\d.]+)'/.exec(cfg)?.[1];
  assert.equal(v1, v2);
});

test('manifest has the names, icons and standalone display', () => {
  const m = JSON.parse(readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.name, 'The Bilbrey Family Dinner Planner');
  assert.equal(m.short_name, 'Bilbrey Dinners');
  assert.equal(m.display, 'standalone');
  for (const i of m.icons) assert.ok(existsSync(path.join(ROOT, i.src)), i.src);
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
});

test('no app file uses absolute URLs or CDNs', () => {
  const files = ['index.html', ...readdirSync(path.join(ROOT, 'app')).filter((f) => f.endsWith('.js')).map((f) => `app/${f}`), ...readdirSync(path.join(ROOT, 'app/views')).map((f) => `app/views/${f}`), 'styles/app.css', 'styles/tokens.css'];
  for (const f of files) {
    const src = readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(!/(src|href)="\/(?!\/)/.test(src), `${f} has no root-absolute src/href`);
    assert.ok(!/cdn\.|unpkg|googleapis|jsdelivr/.test(src), `${f} loads nothing from a CDN`);
  }
});
