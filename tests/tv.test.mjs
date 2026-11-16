// The parts of TV and keyboard navigation that are pure logic (app/tv.js): recognizing a
// television, deciding which control is "next" in a direction, and never stealing an arrow key
// from a text box. The browser behaviour is covered in tests/e2e/run-e2e.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTvUserAgent, looksLikeTv, pickInDirection, wantsArrow } from '../app/tv.js';

const UA = {
  fireStick4k: 'Mozilla/5.0 (Linux; Android 9; AFTKA) AppleWebKit/537.36 (KHTML, like Gecko) Silk/130.4.1 like Chrome/130.0.6723.102 Safari/537.36',
  fireTvCube: 'Mozilla/5.0 (Linux; Android 9; AFTR Build/PS7624) AppleWebKit/537.36 (KHTML, like Gecko) Silk/120.3.1 like Chrome/120.0.6099.230 Safari/537.36',
  fireTvWebView: 'Mozilla/5.0 (Linux; Android 11; AFTSSS Build/RS8136; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/118.0.5993.80 Mobile Safari/537.36',
  androidTv: 'Mozilla/5.0 (Linux; Android 12; BRAVIA 4K VH2 Build/STT2.230203.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/110.0 Safari/537.36',
  tizen: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.5) AppleWebKit/537.36 (KHTML, like Gecko) 85.0.4183.93/6.5 TV Safari/537.36',
  webos: 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.128 Safari/537.36 WebAppManager',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  fireTablet: 'Mozilla/5.0 (Linux; Android 11; KFTRWI) AppleWebKit/537.36 (KHTML, like Gecko) Silk/130.4.1 like Chrome/130.0 Safari/537.36',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
};

test('a Fire TV and other televisions are recognized by their user agent', () => {
  for (const k of ['fireStick4k', 'fireTvCube', 'fireTvWebView', 'androidTv', 'tizen', 'webos']) assert.equal(isTvUserAgent(UA[k]), true, k);
  for (const k of ['iphone', 'fireTablet', 'macChrome', 'ipad']) assert.equal(isTvUserAgent(UA[k]), false, k);
  assert.equal(isTvUserAgent(''), false);
});

test('a big screen with no touch and no pointer is a TV; phones, tablets and laptops are not', () => {
  assert.equal(looksLikeTv({ ua: UA.fireStick4k, touch: 0, width: 960 }), true);
  assert.equal(looksLikeTv({ ua: 'Mozilla/5.0 (X11; Linux armv7l) Silk/130.4.1 like Chrome/130.0 Safari/537.36', touch: 0, width: 960, pointerFine: false }), true, 'Silk with no touch on a big screen');
  assert.equal(looksLikeTv({ ua: 'SomeBrowser/1.0', touch: 0, width: 1920, pointerFine: false, anyFine: false, anyCoarse: false }), true, 'no pointer at all');
  assert.equal(looksLikeTv({ ua: UA.macChrome, touch: 0, width: 1440, pointerFine: true, anyFine: true }), false, 'a laptop has a mouse');
  assert.equal(looksLikeTv({ ua: UA.iphone, touch: 5, width: 390, anyCoarse: true }), false);
  assert.equal(looksLikeTv({ ua: UA.ipad, touch: 5, width: 1024, anyCoarse: true }), false, 'an iPad has touch');
  assert.equal(looksLikeTv({ ua: UA.fireTablet, touch: 10, width: 1280, anyCoarse: true }), false, 'a Fire tablet runs Silk but is touched');
  assert.equal(looksLikeTv({ ua: 'SomeBrowser/1.0', touch: 0, width: 600 }), false, 'a small screen is not a TV');
});

const r = (left, top, w, h) => ({ left, top, right: left + w, bottom: top + h });
const pick = (from, cands, key) => pickInDirection(from, Object.entries(cands).map(([id, rect]) => ({ id, rect })), key)?.id ?? null;

test('arrows pick the nearest control in that direction, preferring the one that lines up', () => {
  // A 3 × 2 grid of cards and a button below.
  const grid = { a: r(0, 0, 100, 80), b: r(120, 0, 100, 80), c: r(240, 0, 100, 80), d: r(0, 100, 100, 80), e: r(120, 100, 100, 80), f: r(240, 100, 100, 80), btn: r(0, 220, 340, 48) };
  const others = (id) => Object.fromEntries(Object.entries(grid).filter(([k]) => k !== id));
  assert.equal(pick(grid.a, others('a'), 'ArrowRight'), 'b');
  assert.equal(pick(grid.b, others('b'), 'ArrowRight'), 'c');
  assert.equal(pick(grid.c, others('c'), 'ArrowRight'), null, 'nothing further right');
  assert.equal(pick(grid.b, others('b'), 'ArrowLeft'), 'a');
  assert.equal(pick(grid.b, others('b'), 'ArrowDown'), 'e', 'straight down, not diagonally');
  assert.equal(pick(grid.e, others('e'), 'ArrowUp'), 'b');
  assert.equal(pick(grid.f, others('f'), 'ArrowDown'), 'btn', 'a wide button below is reachable from any column');
  assert.equal(pick(grid.btn, others('btn'), 'ArrowUp'), 'e', 'and Up from it goes to the row above, to the card over its middle');
  assert.equal(pick(grid.a, others('a'), 'ArrowUp'), null);
  assert.equal(pick(grid.a, others('a'), 'ArrowLeft'), null);
});

test('a nearer control on the same line beats a closer one that is off to the side', () => {
  const from = r(0, 100, 100, 44);
  assert.equal(pick(from, { level: r(300, 100, 100, 44), above: r(110, 0, 100, 44) }, 'ArrowRight'), 'level');
  assert.equal(pick(from, { below: r(0, 400, 100, 44), aside: r(400, 150, 100, 44) }, 'ArrowDown'), 'below');
  // A rail on the left and content on the right: Right from a rail link lands on content level with it.
  assert.equal(pick(r(10, 200, 80, 44), { top: r(140, 20, 300, 48), level: r(140, 190, 300, 60), low: r(140, 420, 300, 48) }, 'ArrowRight'), 'level');
  // Overlapping neighbours (a card and the chip half over its corner) still resolve by where they start.
  assert.equal(pick(r(0, 0, 100, 100), { overlap: r(96, 10, 60, 40) }, 'ArrowRight'), 'overlap');
  assert.equal(pick(r(0, 0, 100, 100), { inside: r(20, 20, 40, 40) }, 'ArrowRight'), null, 'something inside the current control is not "to the right"');
});

const el = (tagName, attrs = {}) => ({ tagName, isContentEditable: false, getAttribute: (k) => (k in attrs ? attrs[k] : null), hasAttribute: (k) => k in attrs });

test('text boxes keep the arrow keys they need', () => {
  const ALL = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
  for (const k of ALL) assert.equal(wantsArrow(el('TEXTAREA'), k), true, `textarea ${k}`);
  for (const k of ALL) assert.equal(wantsArrow({ ...el('DIV'), isContentEditable: true }, k), true);
  for (const type of ['text', 'search', 'password', 'email', 'tel', 'url']) {
    assert.equal(wantsArrow(el('INPUT', { type }), 'ArrowLeft'), true, `${type}: Left moves the caret`);
    assert.equal(wantsArrow(el('INPUT', { type }), 'ArrowRight'), true);
    assert.equal(wantsArrow(el('INPUT', { type }), 'ArrowDown'), false, `${type}: Down is free to move focus`);
    assert.equal(wantsArrow(el('INPUT', { type }), 'ArrowUp'), false);
  }
  assert.equal(wantsArrow(el('INPUT'), 'ArrowLeft'), true, 'an input with no type is a text box');
  for (const type of ['number', 'date', 'time']) for (const k of ALL) assert.equal(wantsArrow(el('INPUT', { type }), k), true, `${type} uses ${k}`);
  for (const k of ALL) assert.equal(wantsArrow(el('INPUT', { type: 'range' }), k), true);
  assert.equal(wantsArrow(el('INPUT', { type: 'text', list: 'suggestions' }), 'ArrowDown'), true, 'a box with suggestions needs Down');
  assert.equal(wantsArrow(el('SELECT'), 'ArrowDown'), true, 'a select changes with Up/Down');
  assert.equal(wantsArrow(el('SELECT'), 'ArrowRight'), false);
});

test('buttons, links, checkboxes and radios give the arrows to navigation', () => {
  for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
    assert.equal(wantsArrow(el('BUTTON'), k), false);
    assert.equal(wantsArrow(el('A', { href: '#/plan' }), k), false);
    assert.equal(wantsArrow(el('INPUT', { type: 'checkbox' }), k), false);
    assert.equal(wantsArrow(el('INPUT', { type: 'radio' }), k), false);
    assert.equal(wantsArrow(el('INPUT', { type: 'file' }), k), false);
    assert.equal(wantsArrow(el('SUMMARY'), k), false);
    assert.equal(wantsArrow(null, k), false);
  }
});
