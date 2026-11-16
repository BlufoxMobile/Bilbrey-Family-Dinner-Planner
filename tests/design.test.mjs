// The design system's promises that can be checked without a browser (docs/spec/19-design.md):
// WCAG AA contrast for every text/surface pair the components use, in both themes; both dark
// blocks identical; every v2 token name still defined; motion tokens centralized; reduced motion
// and print still covered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const tokens = read('styles/tokens.css').replace(/\/\*[\s\S]*?\*\//g, '');
const block = (selector) => {
  const at = tokens.indexOf(selector);
  assert.ok(at >= 0, `tokens.css has ${selector}`);
  const open = tokens.indexOf('{', at);
  return tokens.slice(open + 1, tokens.indexOf('}', open));
};
const decls = (body) => Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const LIGHT = decls(block(':root {'));
const DARK_MEDIA = decls(block(':root:not([data-theme="light"]) {'));
const DARK_ATTR = decls(block(':root[data-theme="dark"] {'));
const THEMES = { light: LIGHT, dark: { ...LIGHT, ...DARK_MEDIA } };

const hex = (vars, name, depth = 0) => {
  const v = vars[name];
  assert.ok(v, `${name} is defined`);
  const m = /^var\((--[\w-]+)\)$/.exec(v);
  if (m && depth < 8) return hex(vars, m[1], depth + 1);
  assert.match(v, /^#[0-9a-fA-F]{6}$/, `${name} is a plain hex color (${v})`);
  return v;
};
const rgb = (h) => h.replace('#', '').match(/../g).map((x) => parseInt(x, 16) / 255);
const lum = (h) => { const [r, g, b] = rgb(h).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
/** `pct`% of a over b, the way color-mix(in srgb) does it. */
const mix = (a, b, pct) => { const A = rgb(a); const B = rgb(b); return `#${A.map((c, i) => Math.round((c * pct + B[i] * (100 - pct)) / 100 * 255).toString(16).padStart(2, '0')).join('')}`; };

// [text token, surface token, minimum ratio, where it's used]
const TEXT_PAIRS = [
  ['--ink', '--paper', 7, 'body text'], ['--ink', '--card', 7, 'text on cards'], ['--ink', '--paper-2', 7, 'text in wells'], ['--ink', '--card-2', 7, 'idea cards'],
  ['--ink-2', '--paper', 4.5, 'secondary text'], ['--ink-2', '--card', 4.5, 'secondary on cards'], ['--ink-2', '--paper-2', 4.5, 'segmented labels'],
  ['--ink-3', '--paper', 4.5, 'muted text'], ['--ink-3', '--card', 4.5, 'muted on cards'], ['--ink-3', '--paper-2', 4.5, 'muted in wells'], ['--ink-3', '--card-2', 4.5, 'muted on idea cards'],
  ['--pine', '--paper', 4.5, 'links, quiet buttons'], ['--pine', '--card', 4.5, 'secondary buttons'], ['--pine', '--sage-tint', 4.5, 'tags, badges, hovers'],
  ['--pine-ink', '--pine', 4.5, 'primary buttons, chips that are on'], ['--pine-ink', '--pine-2', 4.5, 'primary button hover'],
  ['--sage', '--paper', 4.5, 'status text'], ['--sage', '--card', 4.5, 'status text on cards'],
  ['--on-sage', '--sage', 4.5, 'thumbs-up fill'], ['--red', '--paper', 4.5, 'errors, today'], ['--red', '--card', 4.5, 'errors on cards'],
  ['--red', '--red-tint', 4.5, 'dropped badge'], ['--on-red', '--red', 4.5, 'danger buttons, thumbs-down fill'],
  ['--ink', '--sage-tint', 7, 'hints'], ['--ink-2', '--sage-tint', 4.5, 'hint details'], ['--ink', '--butter-tint', 7, 'sale tags, use-first'], ['--ink-2', '--butter-tint', 4.5, 'use-first details'],
  ['--ink', '--red-tint', 7, 'coupon tag'], ['--on-butter', '--butter', 4.5, 'text on butter'],
  ['--dusk-ink', '--dusk', 4.5, 'away card'], ['--dusk-ink', '--dusk-2', 4.5, 'away card highlight'], ['--dusk-text', '--paper', 4.5, 'away labels'], ['--dusk-text', '--card', 4.5, 'away labels on cards'],
  ['--paper', '--ink', 7, 'toast'], ['--feature-ink', '--feature', 7, 'scan card'], ['--feature-ink', '--feature-2', 4.5, 'scan card highlight'], ['--feature', '--feature-ink', 7, 'scan button'],
];
// Non-text: borders of controls and the focus ring need 3:1 against what they sit on (WCAG 1.4.11).
const UI_PAIRS = [
  ['--control-line', '--card', 3, 'input borders'], ['--control-line', '--paper', 3, 'input borders on paper'],
  ['--focus', '--paper', 3, 'focus ring'], ['--focus', '--card', 3, 'focus ring on cards'], ['--focus', '--paper-2', 3, 'focus ring in wells'],
  ['--pine', '--paper', 3, 'switch that is on'], ['--sage', '--paper-2', 3, 'progress bars'], ['--butter', '--card', 1.6, 'favorite stars (decorative, always labelled)'],
];

test('text and surfaces pass WCAG AA in both themes', () => {
  for (const theme of ['light', 'dark']) {
    const v = THEMES[theme];
    for (const [fg, bg, min, what] of [...TEXT_PAIRS, ...UI_PAIRS]) {
      const c = contrast(hex(v, fg), hex(v, bg));
      assert.ok(c >= min, `${theme}: ${fg} on ${bg} (${what}) is ${c.toFixed(2)}, needs ${min}`);
    }
  }
});

test('the tinted panels the views mix (color-mix) still carry their text', () => {
  for (const theme of ['light', 'dark']) {
    const v = THEMES[theme];
    const panels = [
      mix(hex(v, '--sage-tint'), hex(v, '--card'), 70), mix(hex(v, '--butter-tint'), hex(v, '--card'), 75), mix(hex(v, '--dusk'), hex(v, '--card'), 10),
      mix(hex(v, '--sage-tint'), hex(v, '--card'), 55), mix(hex(v, '--butter-tint'), hex(v, '--card'), 55),
    ];
    for (const p of panels) {
      assert.ok(contrast(hex(v, '--ink'), p) >= 7, `${theme}: ink on ${p}`);
      assert.ok(contrast(hex(v, '--ink-2'), p) >= 4.5, `${theme}: ink-2 on ${p}`);
      assert.ok(contrast(hex(v, '--ink-3'), p) >= 4.5, `${theme}: ink-3 on ${p} is ${contrast(hex(v, '--ink-3'), p).toFixed(2)}`);
      assert.ok(contrast(hex(v, '--pine'), p) >= 4.5, `${theme}: pine on ${p}`);
    }
  }
});

test('white type on a photograph always sits on the scrim', () => {
  // The darkest stop of --photo-scrim over a pure white photo must still carry white text.
  const m = /--photo-scrim:[^;]*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)\s*0%/.exec(tokens);
  assert.ok(m, '--photo-scrim starts with an rgba() stop at 0%');
  const a = Number(m[4]);
  const under = `#${[m[1], m[2], m[3]].map((c) => Math.round(Number(c) * a + 255 * (1 - a)).toString(16).padStart(2, '0')).join('')}`;
  assert.ok(contrast('#FFFFFF', under) >= 7, `white on the scrim over white: ${contrast('#FFFFFF', under).toFixed(2)}`);
});

test('the system-dark and chosen-dark blocks are the same theme', () => {
  assert.deepEqual(DARK_ATTR, DARK_MEDIA);
});

test('every v2 token name is still defined, so older screens keep working', () => {
  const V2 = ['--paper', '--paper-2', '--card', '--card-2', '--ink', '--ink-2', '--ink-3', '--line', '--line-2', '--pine', '--pine-2', '--pine-ink', '--sage', '--sage-tint',
    '--red', '--red-tint', '--butter', '--butter-tint', '--dusk', '--dusk-2', '--dusk-ink', '--dusk-text', '--rule-blue', '--focus', '--scrim', '--sh-1', '--sh-2', '--sh-3',
    '--font-display', '--font-text', '--t-xs', '--t-sm', '--t-md', '--t-lg', '--t-xl', '--t-2xl', '--t-3xl', '--t-4xl', '--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s8', '--s10', '--s12',
    '--r-index', '--r-btn', '--r-card', '--r-photo', '--r-sheet', '--gutter', '--tabbar-h', '--header-h', '--safe-b', '--safe-t', '--ease'];
  for (const k of V2) assert.ok(k in LIGHT, `${k} is defined`);
  for (const k of ['--paper', '--card', '--ink', '--ink-2', '--ink-3', '--line', '--line-2', '--pine', '--pine-ink', '--sage', '--sage-tint', '--red', '--butter', '--focus', '--scrim', '--sh-1', '--sh-2', '--sh-3']) {
    assert.ok(k in DARK_MEDIA, `${k} is restated for dark`);
  }
});

// Every stylesheet in styles/parts: the design system's own two, and one per feature team.
const PARTS = readdirSync(path.join(ROOT, 'styles/parts')).filter((f) => f.endsWith('.css')).sort().map((f) => `styles/parts/${f}`);

test('every feature stylesheet is on the design system (docs/spec/19 §19.8)', () => {
  const html = read('index.html');
  const sw = read('sw.js');
  const tvAt = html.indexOf('href="styles/parts/tv.css"');
  for (const f of PARTS) {
    const css = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(html.includes(`href="${f}"`), `index.html links ${f}`);
    assert.ok(sw.includes(`'${f}'`), `${f} is precached`);
    if (!/parts\/(design|tv)\.css$/.test(f)) assert.ok(html.indexOf(`href="${f}"`) > tvAt, `${f} comes after tv.css`);
    // Text on a colored fill uses the fill's own ink token; white is only ever a product photo's mat.
    assert.deepEqual([...css.matchAll(/(?<![-\w])color\s*:\s*(#fff(?:fff)?|white)\b[^;]*/gi)].map((m) => m[0]).filter(() => !/parts\/tv\.css$/.test(f)), [], `${f}: no white text; use --pine-ink, --on-red, --on-sage, --on-butter, --photo-ink`);
    // The display face is never set at weight 400 (that is its thin cut).
    for (const rule of css.match(/[^{}]*\{[^{}]*font-family:\s*var\(--font-display\)[^{}]*\}/g) || []) {
      assert.ok(!/font-weight:\s*(400|normal)\b/.test(rule), `${f}: display type at weight 400 in ${rule.trim().slice(0, 60)}`);
      assert.ok(/font-weight:\s*var\(--display-weight\)/.test(rule), `${f}: display type without --display-weight in ${rule.trim().slice(0, 60)}`);
    }
    assert.ok(!/text-transform:\s*uppercase/.test(css), `${f}: no all-caps labels`);
    // On the TV canvas viewport units are multiplied by the zoom.
    for (const rule of css.match(/html\.is-tv[^{}]*\{[^{}]*\}/g) || []) if (!/^html\.is-tv\s*\{/.test(rule.trim())) assert.ok(!/\b100(dvh|vh|vw)\b/.test(rule), `${f}: viewport units in a TV rule: ${rule.trim().slice(0, 70)}`);
  }
  // A screen that fills the viewport with 100dvh says how tall it is on the TV canvas too.
  const cook = read('styles/parts/cook.css');
  assert.match(cook, /html\.is-tv \.cook-v3 \{ height: var\(--tv-vh\); \}/);
  // Wide-window layouts are media queries, and a media query sees the unzoomed width: each is kept off the TV canvas.
  for (const block of cook.match(/@media \(min-width: 1[17]00px\) \{[\s\S]*?\n\}/g) || []) {
    for (const line of block.split('\n').slice(1, -1).map((l) => l.trim()).filter((l) => l && !l.startsWith('/*'))) assert.ok(line.startsWith('html:not(.is-tv) '), `cook.css wide rule reaches the TV: ${line.slice(0, 70)}`);
  }
});

test('motion is centralized: durations and curves are tokens, and stylesheets use them', () => {
  for (const k of ['--dur-press', '--dur-fast', '--dur-base', '--dur-slow', '--ease', '--ease-out', '--ease-in', '--ease-spring', '--stagger']) assert.ok(k in LIGHT, `${k} is a token`);
  for (const f of ['styles/app.css', ...PARTS]) {
    const css = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
    const loose = [...css.matchAll(/(?:transition|animation)(?:-duration)?\s*:[^;{}]*?(?<![\w-])(\d*\.?\d+)(ms|s)\b[^;{}]*/g)]
      .map((m) => m[0]).filter((d) => !/var\(--(dur|stagger)|0\.01ms|\b0s\b/.test(d));
    assert.deepEqual(loose, [], `${f}: every transition/animation takes its duration from a --dur-* token`);
  }
});

test('reduced motion, print, and the TV sheet are all wired in', () => {
  const design = read('styles/parts/design.css');
  assert.match(design, /@media \(prefers-reduced-motion: reduce\)/, 'design.css honors reduced motion');
  assert.match(design, /::view-transition/, 'design.css styles the view transitions');
  const html = read('index.html');
  for (const f of ['styles/tokens.css', 'styles/app.css', 'styles/parts/design.css', 'styles/parts/tv.css', 'styles/print.css']) {
    assert.ok(html.includes(`href="${f}"`), `index.html links ${f}`);
    assert.ok(existsSync(path.join(ROOT, f)), `${f} exists`);
  }
  assert.ok(html.indexOf('styles/parts/design.css') > html.indexOf('styles/app.css'), 'design.css comes after app.css');
  assert.match(read('styles/print.css'), /\.tabbar/, 'print styles still hide the chrome');
  const sw = read('sw.js');
  for (const f of ['styles/parts/design.css', 'styles/parts/tv.css', 'app/motion.js', 'app/tv.js', 'fonts/big-shoulders-var.woff2']) assert.ok(sw.includes(`'${f}'`), `${f} is precached`);
  assert.ok(!/young-serif/.test(sw + html + read('styles/tokens.css')), 'the old display face is gone everywhere');
});

test('fonts are self-hosted and nothing loads from another origin', () => {
  const html = read('index.html');
  assert.ok(!/https?:\/\//.test(html.replace(/<!--[\s\S]*?-->/g, '')), 'index.html names no other origin');
  const urls = [...tokens.matchAll(/url\(['"]?([^'")]+)['"]?\)/g)].map((m) => m[1]);
  assert.ok(urls.length >= 5);
  for (const u of urls) {
    assert.match(u, /^\.\.\/fonts\/[\w.-]+\.woff2$/, `${u} is a local font`);
    assert.ok(existsSync(path.join(ROOT, 'styles', u)), `${u} exists`);
  }
});
