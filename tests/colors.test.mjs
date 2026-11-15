// Each person's color (styles/tokens.css + PERSON_COLORS in app/ui.js): Jeff and Candi share the
// green, Jackson is red, Jordan blue, Knox yellow, and the initials read (WCAG AA) in both themes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import { FAMILY } from '../app/config.js';
import { PERSON_COLORS, avatar, personStyle } from '../app/ui.js';

const css = readFileSync(path.join(ROOT, 'styles/tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const block = (selector) => {
  const at = css.indexOf(selector);
  assert.ok(at >= 0, `tokens.css has ${selector}`);
  const open = css.indexOf('{', at);
  return css.slice(open + 1, css.indexOf('}', open));
};
const decls = (body) => Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const LIGHT = decls(block(':root {'));
const DARK_MEDIA = decls(block(':root:not([data-theme="light"]) {'));
const DARK_ATTR = decls(block(':root[data-theme="dark"] {'));
const THEMES = { light: LIGHT, dark: { ...LIGHT, ...DARK_MEDIA } };

const resolve = (vars, value, depth = 0) => {
  assert.ok(depth < 10, `var() loop at ${value}`);
  const m = /^var\((--[\w-]+)\)$/.exec(value);
  return m ? resolve(vars, vars[m[1]], depth + 1) : value?.toUpperCase();
};
const colorsOf = (theme, id) => ({
  fill: resolve(THEMES[theme], `var(--p-${id})`),
  ink: resolve(THEMES[theme], `var(--p-${id}-ink)`),
  line: resolve(THEMES[theme], `var(--p-${id}-line)`),
});

const rgb = (h) => h.replace('#', '').match(/../g).map((x) => parseInt(x, 16) / 255);
const lum = (h) => { const [r, g, b] = rgb(h).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const hue = (h) => {
  const [r, g, b] = rgb(h); const max = Math.max(r, g, b); const d = max - Math.min(r, g, b);
  if (!d) return 0;
  const x = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (x * 60 + 360) % 360;
};

test('every family member has a fill, an ink and a line token, and avatar() uses both fill and ink', () => {
  assert.deepEqual(Object.keys(PERSON_COLORS).sort(), [...FAMILY].sort());
  for (const name of FAMILY) {
    const id = name.toLowerCase();
    assert.deepEqual(PERSON_COLORS[name], { fill: `var(--p-${id})`, ink: `var(--p-${id}-ink)`, line: `var(--p-${id}-line)` });
    const a = String(avatar(name));
    assert.match(a, new RegExp(`--av:var\\(--p-${id}\\);--av-ink:var\\(--p-${id}-ink\\)`), `${name}'s avatar sets fill and ink`);
    assert.equal(personStyle(name), `--pc:var(--p-${id});--pc-line:var(--p-${id}-line)`);
  }
  assert.doesNotMatch(String(avatar('')), /--av/, 'nobody picked yet: the neutral avatar');
  assert.equal(personStyle('constructor'), '', 'only family names get a color');
});

test('Jeff keeps his green, Candi shares it, Jackson is red, Jordan blue, Knox yellow', () => {
  assert.equal(colorsOf('light', 'jeff').fill, '#2F5D46', 'the current Jeff green (light)');
  assert.equal(colorsOf('dark', 'jeff').fill, '#7DB394', 'the current Jeff green (dark)');
  for (const theme of ['light', 'dark']) {
    assert.deepEqual(colorsOf(theme, 'candi'), colorsOf(theme, 'jeff'), `Candi = Jeff in ${theme}`);
    const h = (id) => hue(colorsOf(theme, id).fill);
    assert.ok(h('jeff') >= 120 && h('jeff') <= 170, `Jeff green in ${theme} (${h('jeff')})`);
    assert.ok(h('jackson') <= 12 || h('jackson') >= 348, `Jackson red in ${theme} (${h('jackson')})`);
    assert.ok(h('jordan') >= 200 && h('jordan') <= 230, `Jordan blue in ${theme} (${h('jordan')})`);
    assert.ok(h('knox') >= 40 && h('knox') <= 58, `Knox yellow in ${theme} (${h('knox')})`);
  }
  // Candi only ever points at Jeff, so the two can't drift apart in one theme.
  for (const k of ['--p-candi', '--p-candi-ink', '--p-candi-line']) {
    assert.ok(!(k in DARK_MEDIA) && !(k in DARK_ATTR), `${k} is not restated for dark`);
  }
});

test('initials pass AA on every color and the rings stand off the card, in both themes', () => {
  const card = { light: LIGHT['--card'].toUpperCase(), dark: DARK_MEDIA['--card'].toUpperCase() };
  for (const theme of ['light', 'dark']) {
    for (const name of FAMILY) {
      const c = colorsOf(theme, name.toLowerCase());
      for (const v of Object.values(c)) assert.match(v, /^#[0-9A-F]{6}$/, `${name} ${theme} resolves to a hex color`);
      assert.ok(contrast(c.fill, c.ink) >= 4.5, `${name} initials in ${theme}: ${contrast(c.fill, c.ink).toFixed(2)}`);
      assert.ok(contrast(c.line, card[theme]) >= 3, `${name} ring on the ${theme} card: ${contrast(c.line, card[theme]).toFixed(2)}`);
    }
  }
});

test('the system-dark and the chosen-dark themes carry the same person colors', () => {
  const people = (d) => Object.fromEntries(Object.entries(d).filter(([k]) => k.startsWith('--p-')));
  assert.deepEqual(people(DARK_ATTR), people(DARK_MEDIA));
  assert.ok(Object.keys(people(DARK_MEDIA)).length >= 8);
});
