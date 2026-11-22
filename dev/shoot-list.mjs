// Dev-only: the shopping list's two modes (docs/spec/28) on a phone and a laptop.
// → dev/screenshots/list-*.png
import { chromium } from '../tests/node_modules/playwright/index.mjs';
import { startStatic } from './serve.mjs';
import { startMockApi } from './mock-api.mjs';

const NOW = new Date('2026-11-22T15:30:00-06:00');
const staticSrv = await startStatic({ port: 0, quiet: true });
const api = await startMockApi({ port: 0, quiet: true });
const base = `http://127.0.0.1:${staticSrv.address().port}/Bilbrey-Family-Dinner-Planner/`;
const apiBase = `http://127.0.0.1:${api.server.address().port}`;
const browser = await chromium.launch();
const out = (n) => new URL(`./screenshots/list-${n}.png`, import.meta.url).pathname;
const errors = [];

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
await p.clock.install({ time: NOW });
await p.goto(`${base}?api=${encodeURIComponent(apiBase)}`);
await p.waitForSelector('#pc-new');
await p.fill('#pc-new', 'tacos');
await p.fill('#pc-again', 'tacos');
await p.click('button[type=submit]');
await p.waitForSelector('.page-tonight');
await p.click('[data-action="tonight:plan-week"]');
await p.waitForSelector('.hero-photo');
const key = await p.evaluate(() => JSON.parse(localStorage.getItem('bfdp.v2.device')).key);
const ops = [{ op: 'set', path: ['aisles', 'jewel', 'garlic'], value: { aisle: '1', by: 'Jeff', at: '2026-11-22T21:00:00.000Z' } }];
await fetch(`${apiBase}/api/ops`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Family-Key': key }, body: JSON.stringify({ ops, by: 'Jeff', clientId: 'dev', batchId: 'dev-aisles' }) });
await p.goto(`${base}#/list`);
await p.waitForSelector('.page-list .list-mode');
await p.waitForTimeout(600);
await p.locator('.list-mode').scrollIntoViewIfNeeded();
await p.screenshot({ path: out('store-390') });
await p.evaluate(() => { const el = document.querySelector('.store-sams .aisle'); window.scrollTo(0, el.getBoundingClientRect().top + scrollY - 70); });
await p.waitForTimeout(300);
await p.screenshot({ path: out('store-rows-390') });
console.log('stops:', await p.$$eval('.store-sams .aisle-h', (h) => h.map((x) => x.textContent.trim()).join(' | ')));
console.log('jewel:', await p.$$eval('.store-jewel .aisle-h', (h) => h.map((x) => x.textContent.trim()).join(' | ')));
console.log('notes:', await p.$$eval('.aisle-note', (h) => h.map((x) => x.textContent.trim()).join(' || ')));
await p.click('[data-action="list:mode"][data-value="online"]');
await p.waitForSelector('.item.is-online');
await p.waitForTimeout(300);
await p.locator('.list-mode').scrollIntoViewIfNeeded();
await p.screenshot({ path: out('online-390') });
await p.evaluate(() => { const el = document.querySelector('.store-sams .store-handoff'); window.scrollTo(0, el.getBoundingClientRect().top + scrollY - 70); });
await p.waitForTimeout(300);
await p.screenshot({ path: out('online-rows-390') });
console.log('order links:', await p.$$eval('.order-it', (a) => a.slice(0, 4).map((x) => `${x.dataset.order} ${x.getAttribute('href')}`).join(' | ')));
console.log('overflow 390:', await p.evaluate(() => document.documentElement.scrollWidth > innerWidth));
// The item sheet's aisle box.
await p.click('[data-action="list:mode"][data-value="store"]');
await p.waitForSelector('.item.is-store');
await p.click('.store-sams .item.is-store .item-main');
await p.waitForSelector('.aisle-box');
await p.locator('.aisle-box').scrollIntoViewIfNeeded();
await p.waitForTimeout(400);
await p.screenshot({ path: out('sheet-aisle-390') });
await p.keyboard.press('Escape');

const d = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
await d.clock.install({ time: NOW });
await d.goto(`${base}?api=${encodeURIComponent(apiBase)}`);
await d.evaluate((k) => localStorage.setItem('bfdp.v2.device', JSON.stringify({ key: k, name: 'Jeff' })), key).catch(() => {});
await d.goto(`${base}#/list`);
await d.waitForSelector('.page-list').catch(() => {});
await d.waitForTimeout(800);
if (await d.$('.list-mode')) {
  await d.click('[data-action="list:mode"][data-value="online"]');
  await d.waitForTimeout(300);
  await d.evaluate(() => { const el = document.querySelector('.store-sams .store-handoff'); window.scrollTo(0, el.getBoundingClientRect().top + scrollY - 90); });
  await d.waitForTimeout(300);
  await d.screenshot({ path: out('online-1280') });
}
console.log('errors:', errors.length ? errors : 'none');
await browser.close(); staticSrv.close(); api.server.close();
