# 19. Design system, motion and the TV (v3)

Jeff asked for "AAA quality", "state of the art images and designs" and "beautiful transitions",
and the family now runs the app on the living-room Fire TV with the remote. This section is the
reference for everyone building screens: the tokens, the component classes, the motion rules, the
10-foot layout and what the tests hold us to.

Where things live:

| File | What |
| --- | --- |
| `styles/tokens.css` | Every color, size, radius, shadow, duration and curve. Light and dark. |
| `styles/app.css` | Base, shell, components, every existing screen. |
| `styles/parts/design.css` | Motion: view transitions, sheets, list changes, skeletons, focus extras, reduced motion. |
| `styles/parts/tv.css` | The 10-foot layout (`html.is-tv`). |
| `app/motion.js` | Page transitions, the travelling photo, sheet exit and drag-to-dismiss, re-render animation. |
| `app/tv.js` | TV detection, the "TV display" switch, remote / arrow-key navigation, focus across re-renders. |
| `app/ui.js` | `photo()`, sheets, toasts, `skeleton()`. |
| `tests/design.test.mjs`, `tests/tv.test.mjs` | Contrast, tokens, motion tokens, TV detection, spatial navigation. |
| `tests/e2e/run-e2e.mjs` | Screens at 390 / 1280 / TV in both themes, 44 px targets, remote control, motion, reduced motion, print. |
| `dev/shoot-design.mjs`, `dev/shoot-motion.mjs` | Review sheets: `node dev/shoot-design.mjs [390\|1280\|tv] [light\|dark] [screen]`. |

## 19.1 The idea

**The pass.** The surface is quiet — porcelain in light, seasoned steel in dark — so the food
photography carries the color. One brand color (pine), one small hot accent (the ember dot that
means "tonight"), butter for favorites and sales. Dinner names are set in **Big Shoulders**, the
sign-painter's face drawn for the City of Chicago: condensed, so "Apple-jelly glazed pork chops"
can run huge on a phone and be read from the sofa. Everything else is **Atkinson Hyperlegible
Next**, chosen for the same reason it was designed: it stays legible small, at a glance, at a distance.

The one bold move is the hero: tonight's photograph with the dinner's name set on it. Everything
around it stays plain.

Fonts are self-hosted (`fonts/big-shoulders-var.woff2`: the latin subset of Big Shoulders from
`@fontsource-variable/big-shoulders` 5.3.0, a variable font with weight and optical size, 58 KB,
OFL — license in `fonts/`; the four Atkinson files as before) and preloaded, so there is no flash and no request to
another origin. `index.html` has no CSP and names no other origin; `tests/design.test.mjs` keeps it so.
(Young Serif, named in older SPEC sections, is gone.)

## 19.2 Tokens

Every v2 custom property name still works. Use tokens, never raw values; a screen built only from
tokens and the component classes below re-themes itself, in both themes and on the TV.

### Color (light / dark)

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--paper` | `#F3F5F0` | `#0E1311` | Page background |
| `--paper-2` | `#E7EAE2` | `#090D0B` | Wells: segmented controls, progress tracks, quiet tiles |
| `--card` | `#FFFFFF` | `#171E1A` | Cards, sheets, inputs |
| `--card-2` | `#F7F9F4` | `#1E2722` | A card inside a card |
| `--ink` / `--ink-2` / `--ink-3` | `#17211B` / `#414D45` / `#5A665E` | `#EEF2EB` / `#BEC8BF` / `#9AA69D` | Text: primary, secondary, muted (all AA on every surface above) |
| `--line` / `--line-2` | `#E0E4DA` / `#C3C9BC` | `#262F2A` / `#3A463F` | Hairlines; decorative borders |
| `--control-line` | `#7D887F` | `#6F7C73` | Borders of inputs, checkboxes, switch tracks (3:1) |
| `--pine` / `--pine-2` / `--pine-ink` | `#1C4A36` / `#27604A` / `#F6FAF4` | `#9CD9B2` / `#B7E8C8` / `#0B1D14` | Primary: links, primary buttons (fill `--pine`, text `--pine-ink`), "on" states |
| `--sage` / `--sage-tint` / `--on-sage` | `#45705A` / `#E1ECE3` / `#FFFFFF` | `#86BA9B` / `#1C2F25` / `#08170F` | Status text and icons; soft green panels; text on a sage fill |
| `--red` / `--red-tint` / `--on-red` | `#BC3A26` / `#FBE4DD` / `#FFFFFF` | `#FF8068` / `#3B1D17` / `#2A0B05` | Errors, thumbs-down, danger; text on a red fill |
| `--butter` / `--butter-tint` / `--on-butter` | `#DDA11F` / `#FAEEC8` / `#2A2005` | `#F1C45A` / `#3A2F13` / `#2A2005` | Favorites, sales, "use first" |
| `--ember` | `#E8552D` | `#FF6B3D` | The "tonight" dot, today's edge, cook progress. Never text. |
| `--dusk`, `--dusk-2`, `--dusk-ink`, `--dusk-text` | | | Nights away |
| `--feature`, `--feature-2`, `--feature-ink` | `#1C4A36` … | `#163426` … | A filled feature panel (scan the pantry): deep green in both themes |
| `--photo-ink`, `--photo-scrim` | | | White type on a photograph, and the gradient it must sit on |
| `--focus` | `#1553D9` | `#FFD466` | The focus ring |
| `--scrim` | | | Behind sheets |
| `--hover`, `--press` | | | Row and tile feedback |
| `--p-jeff` … `--p-knox` (+ `-ink`, `-line`) | | | People (unchanged; `tests/colors.test.mjs`) |

Do not write `color: #fff` on a colored fill: use `--pine-ink`, `--on-sage`, `--on-red`,
`--on-butter`, `--feature-ink`. In dark the fills are light and the text on them is dark.

### Type

`--font-display` (Big Shoulders) with `font-weight: var(--display-weight)` (750) and
`letter-spacing: var(--display-tracking)`. `--font-text` (Atkinson) at 400 / 600 / 700.

| Token | Size | Use |
| --- | --- | --- |
| `--t-xs` | 13 | Captions, tags |
| `--t-sm` | 15 | Secondary text, small buttons |
| `--t-md` | 17 | Body |
| `--t-lg` | 21 | Large body; the smallest display size |
| `--t-xl` | 26 | Section titles |
| `--t-2xl` | 34 | Sheet titles, store names |
| `--t-3xl` | 46 | Page titles (phone) |
| `--t-4xl` | 60 | Page titles (desktop), totals |

Rules: display type is for names and numbers at `--t-lg` and up, line-height 0.92–1.1, sentence
case. Small headings (17 px and under: `.sub-title`, `.sheet-h`) are Atkinson 700. No all-caps
labels. To get display type on a new element add the class **`.display`** (or write
`font-family: var(--font-display); font-weight: var(--display-weight)` — not `font-weight: 400`,
which renders the thin cut).

### Space, radius, elevation

`--s1`…`--s12` (4–48 px), `--gutter` (16 / 24 / 40), `--hit` (44 px; 52 on the TV).

Radii step with size: `--r-ctl` 12 (inputs, small tiles), `--r-thumb` 12 (small photos),
`--r-btn` 14, `--r-card` 18, `--r-index` 20, `--r-photo` 26, `--r-sheet` 28, `--r-pill`.

`--sh-1` resting card, `--sh-2` raised (hero, sticky, hover), `--sh-3` floating (sheet, toast).

Safe areas: `--safe-t`, `--safe-b`, `--safe-l`, `--safe-r`. The shell already pads for them.

### Motion tokens

| Token | Value | Use |
| --- | --- | --- |
| `--dur-press` | 110 ms | A control acknowledging a finger |
| `--dur-fast` | 180 ms | Checks, chips, switches, hovers |
| `--dur-base` | 280 ms | Things entering or leaving: toasts, rows, a sheet closing |
| `--dur-slow` | 420 ms | Pages, a sheet opening, a photo travelling |
| `--ease` | quick out, soft landing | Default |
| `--ease-out` / `--ease-in` | | Entrances / exits |
| `--ease-spring` | a real spring via `linear()`, with a cubic-bezier fallback | Sheets, the switch knob, pops |
| `--stagger` | 28 ms | Reserved; nothing staggers today |

`tests/design.test.mjs` fails if a `transition` or `animation` in `styles/app.css`,
`styles/parts/design.css` or `styles/parts/tv.css` uses a raw duration. Please do the same in your
own `styles/parts/*.css`.

## 19.3 Components

Existing class names, ids and `data-action` values are unchanged. New screens should reach for
these before inventing a box.

**Surfaces.** `.card` (white, `--r-card`, `--sh-1`, padded). Tinted panels for advice and status:
`.panel` / `.panel-sage`, `.panel-butter`, `.panel-plain` (dashed). `.hint` for a one-line note with
an icon.

**Buttons.** `.btn` + `.btn-primary` (one per view), `.btn-secondary`, `.btn-quiet`, `.btn-danger`,
`.btn-danger-quiet`; sizes `.btn-lg`, `.btn-small`; `.btn-block`. `.icon-btn` (44 × 44). All press
with a small scale; hover styles only where there is a hover.

**Choices.** `.chip` (`.is-on` or `aria-pressed`), `.chip-radio` around a radio, `.chip-grid`;
`segmented()` → `.seg` / `.seg-opt`; `switchToggle()` → `.switch`; `stepper()` → `.stepper`;
`.tabs` / `.tab-opt`; `.thumbs` / `.thumb`.

**Forms.** `.form`, `.field`, `.field-label`, `.input` (also on `select` and `textarea`),
`.input-chip`, `.search`, `.radio-row`, `.form-error`.

**Rows.** One pattern for every tappable row: `.action-row` (icon, title, note), `.pick-row`
(photo, text, trailing), `.menu-row` (day stamp, text, photo), `.move-row`. Static rows: `.kv`,
`.rate-row`, `.shelf-row`. Rows get `--hover` / `--press` feedback for free.

**Labels.** `.badge` (`.badge-fav`, `.badge-out`, `.badge-plan`), `.tag` (`.tag-sale`,
`.tag-coupon`, `.tag-organic`, `.tag-lunch`), `.facts` (time, equipment), `.nutri`.

**Photos.** Always through `photo()` / `dinnerPhoto()` / `sidePhoto()`. A `.photo` is a fixed-shape
frame (`.photo-hero` 4:3, `.photo-card` 4:3, `.photo-thumb` 56 px), so nothing shifts: the category
tone and glyph underneath, a shimmer while the image is on its way, then the image fades in.
Images carry `width`/`height`, `loading="lazy"` (the hero: `fetchpriority="high"`) and
`decoding="async"`. A picture already shown this session comes back with no second fade
(`.is-instant`). Text on a photograph must sit on `--photo-scrim` and use `--photo-ink`.

**The hero** (`.hero`, Tonight). `.index-card` uses `display: contents` so `.hero-kicker` and
`.hero-title` sit on the photograph and the rest follows on the page. Anything added inside
`.index-card` flows underneath in source order. `.hero-empty` and `.hero-away` keep a real card.

**Sheets.** `openSheet()` as before. New: a spring on the way up, an exit on the way out, drag the
grip or header down to dismiss (phones), and a sheet opened from a card with a photo gets that
photo flying into it. `closeSheet({ instant: true })` skips the exit.

**Toasts, empty states, skeletons.** `toast()`, `emptyState()` unchanged. `skeleton({ rows, hero })`
returns shimmer placeholders; the raw classes are `.sk` + `.sk-line` / `.sk-short` / `.sk-title` /
`.sk-block` / `.sk-hero` / `.sk-circle` / `.sk-row`. `index.html` shows a skeleton of Tonight while
the recipes load.

**Icons.** `ic(name)` as before. Added: `cooker` (the PossibleCooker; `EQUIPMENT_ICON['possible cooker']`
is mapped), `tv`, `heart`, `chart`, `timer`, `bin`.

**Details.** Every `<details><summary>` gets a chevron that turns, a pointer and no list marker.

## 19.4 Motion

Rules: transform and opacity only; durations and curves from tokens; motion answers an action
(opening, checking, moving) and never decorates; `prefers-reduced-motion` turns all of it off
(the global rule in `styles/parts/design.css`, plus `motion.reduced()` guarding every JS animation).

| What | How |
| --- | --- |
| Page to page | `motion.page(render, { dir })` from the `hashchange` handler, only when someone tapped, clicked or pressed a key in the last 1.2 s — a route that changes on its own (address bar, the phone's swipe-back, which animates itself) just changes. View Transitions API: the old screen fades, the new one rises (sideways for going deeper or back: `html[data-nav]`), the top bar / tab bar / rail hold still, `.nav-mark` slides to the new section. Fallback (no API, or TV): `.view.is-entering` rises in. |
| Shared element | The photo that was tapped (or the big photo being left) and the matching photo on the new screen both get `view-transition-name: shared-photo` for the length of the transition. Works for Tonight ↔ recipe, recipe grid ↔ recipe, planner ↔ recipe. Matching is by image `src`. |
| Sheet | `sheet-up` on `--ease-spring`; `sheet-down` on close (`.sheet.is-closing`); a replacing sheet cross-fades its contents; `.photo-ghost` flies the tapped photo in. |
| Drag to dismiss | `motion.dragToDismiss()`: past a third of the height or a flick, it goes; otherwise it springs back. |
| Lists | `render()` and `renderSheet()` call `motion.snapshot()` before and `motion.play()` after — only when the redraw follows something the person did on this screen in the last 1.5 s; a redraw caused by another phone's changes arriving (or anything after a change of screen) lands quietly, so nothing slides under a waiting finger. Rows that moved glide (FLIP), new rows arrive (`.flip-in`), removed rows let the rest close up. Planner photos that trade nights fly past each other. |
| Checked off | A box, thumb or cook step that just turned on gets `.pop` (and its row `.just-checked`). |
| Numbers | A total that changed gets `.num-tick` (rolls up or down). The text itself is final at once — safe to read in tests. |
| Bars | Progress bars grow from their old length. |
| Toasts | Spring up, ease away. |
| Loading | Shimmer on photos and `.sk`. |
| Pressed | Buttons, chips, cards and rows scale or tint on `:active`. |

**Joining in from a new screen.** Rows: add `data-flip="<stable key>"` to each row (or give it an
`id`, `data-key`, `data-date` or `data-id`). Numbers: add `data-num` (the element must not be
`display: inline`). Things that switch on: `data-pop` plus `.is-on`. Photos: use `photo()` and the
shared-element transition finds them. Nothing else to call.

`motion.idle()` resolves when nothing is mid-flight; while something is, `<html>` has `.is-vt` or
`.is-moving`. The e2e helpers `go()` and `shot()` wait for that, so screenshots never land mid-transition.

## 19.5 The TV

**When.** `app/tv.js` turns the TV layout on when the user agent is a television (Fire TV `AFT…`
models, Android TV, Tizen, webOS, …), or the screen is 900 px or wider with no touch and no pointer
at all, or the **TV display** switch in Family & settings is on. The switch is stored on the device
(`localStorage` key `bfdp.v2.display`: `on` / `off` / `auto`), never in the family's state.
`?tv=1`, `?tv=0`, `?tv=auto` on the address set it too. `index.html` applies it before first paint.

**Canvas.** A Fire TV reports 960 × 540 CSS px at 2×. `html.is-tv` sets `zoom: var(--tv-zoom)`
(= viewport width ÷ 960), so every TV — and a 1920 × 1080 desktop window with the switch on — lays
out on the same 960-wide canvas. **Design TV screens for 960 × 540.** Under zoom, viewport units
are multiplied too: in TV rules use `var(--tv-vh)` / `var(--tv-vw)`, not `100dvh` / `100vw`.
Overscan-safe margins: `--tv-safe-x` 48, `--tv-safe-y` 27 (5 %). Body text is ~19 px on the canvas
(~38 px on a 1080p panel); targets are at least 52 px. A TV left on "Match" is dark.

**Shell.** A slim icon rail on the left; no top bar or tab bar.

**Tonight is the kitchen display.** Left: tonight's photograph, full height, with the dinner's name,
its sides, time and equipment set on it. Right, one column of compact cards (§22.2's Tonight cards
in the TV's sizes): "Thaw and prep now" (thaw jobs emphasized), "Use first", tomorrow's lunches,
then the rest of the week. The date line carries a clock. The buttons are one press of Down away.
A missed dinner is asked about in one tight band above the two columns (its explanation is cut to
one line there; Plan and Pantry show the whole card). The wide-window Tonight (three columns from
1700 px, §22.2) is a different layout for a monitor: every rule of it is written
`html:not(.is-tv) …`, because a media query still sees the panel's real width.

**Cook mode on the TV** (`styles/parts/cook.css`, "the TV"): `height: var(--tv-vh)`, the step text
at 1.5rem × the cook's own text-size control, the step card in two columns (the step on the left;
setting, ingredients and timers on the right), Back and Next on the bottom edge inside the safe
margin. Next has focus when a step opens, so Enter walks the recipe; Left / Right step back and
forward, except while focus is in the top bar, where they walk its buttons (`app/views/cook.js`).
Back closes the open sheet, then leaves cook mode. A long step scrolls with Up / Down.

**Remote.** Arrow keys move focus to the nearest control in that direction (`pickInDirection()`:
distance along the direction, a heavy penalty for not lining up). Focus stays in the navigation or
in the page while there is somewhere to go, then crosses over; crossing into the navigation lands
on the current section. Enter activates (native for buttons and links; `tv.js` clicks radios and
checkboxes). Back (`GoBack`, `BrowserBack`, key codes 4 / 461 / 10009, and Escape or Backspace on a
TV) closes the open sheet, or leaves a text box, or goes back one screen; on Tonight it is left to
the TV so the family can leave the app. Focus is trapped in an open sheet (`<dialog>` + scoped
navigation) and returns to what opened it. Whatever takes focus is scrolled into view.

**Focus you can see.** `--focus` ring, 4 px on the TV, plus a small step forward for cards and
buttons. `:focus`, not `:focus-visible`, on the TV.

**Keyboards on a computer.** The same arrow-key navigation switches on once someone presses Tab
and off again at the next click or scroll, so mouse users keep arrow-key scrolling.

**Text boxes keep their arrows** (`wantsArrow()`): Left / Right always; Up / Down for textareas,
numbers, dates, selects and boxes with suggestions.

**Focus across re-renders.** `tv.captureFocus(root)` / `tv.restoreFocus(root, snap)` around every
`render()` and `renderSheet()`: the same control (matched by id, or by tag + `href` + `name` +
`data-*`) gets focus back, with its caret; if it is gone, the nearest control does (TV / keyboard).
After a route change made with the remote or the keyboard, focus stays on the navigation link that
was used; otherwise it goes to the new screen (its first control on the TV or for keyboard users;
`<main>`, as before, for touch and screen readers). A view can mark where a remote should start with
`data-tv-focus`.

**For a settings page.** `tv.tvSettingRow()` returns the switch row (`.tv-row`,
`data-action="tv:toggle"`). Family & settings places it itself, in "Display on this device" between
Appearance and Text size (`app/views/family.js`); `main.js` only injects it if a page has not.
**Text size** (§20.5) and the TV: on the TV layout "Large" is one small step (121.875 % instead of
the TV's 112.5 %), so the 960 × 540 screens still fit.

**The passcode screen** is two columns on the TV (what the planner is on the left, the passcode on
the right) so the box and its button are on screen: `html.is-tv .gate-card` in
`styles/parts/profile.css`, because the wide-and-short media query that does this for a small
laptop cannot see the TV's canvas.

## 19.6 Quality bar (and what checks it)

- WCAG AA: every text/surface pair the components use, both themes, including the tinted panels
  views build with `color-mix()` — `tests/design.test.mjs`. Control borders and the focus ring 3:1.
- Visible focus everywhere; 44 px targets (e2e measures every control on six screens at 390 px).
- No horizontal scroll at 320, 360, 390, 768, 1024, 1280, 1920 and on the TV canvas (e2e).
- Safe-area insets on the top bar, tab bar, rail, view, sheets and toasts.
- Print: the shopping list prints black on white with no chrome (e2e, `styles/print.css`).
- Photos: fixed frames, `width`/`height`, lazy unless hero (e2e).
- Reduced motion: no view transition, no flying photo, no exit, no shimmer, transitions 0 (e2e).

## 19.7 Found and fixed along the way

- `#app` kept `aria-busy="true"` forever. Removed on first render.
- `:focus-visible` forced `border-radius: 6px` onto whatever was focused (a pill became a rectangle
  while focused). Gone; the outline follows the element's own shape.
- Photos faded in again on every re-render (each sync, each tap), because the markup is rebuilt.
  Already-seen photos now come back instantly.
- Past and cooked nights were dimmed with `opacity`, which pushed their text under AA. They now
  mute the photo and step the text down one ink level.
- Input and checkbox borders were under 3:1. `--control-line`.
- White text on `--sage` / `--red` fills failed AA in dark. `--on-sage`, `--on-red`.
- Focus was dropped to `<body>` after most re-renders (only elements with an `id` kept it).
- The theme-color (browser chrome) ignored a manually chosen theme.
- The planner's seven columns overflowed their cards between 960 and ~1150 px. Columns now auto-fit.
- A toast shown while a sheet was closing would have been trapped inside the closed dialog.
- The wordmark link was 32 px tall. 44 now.
- All-caps labels (`.pan-kind`, prep "when" labels) are sentence case.

## 19.8 For the other engineers and the lead

- Use tokens and the classes above; put your CSS in `styles/parts/<name>.css` linked **after**
  `styles/parts/tv.css`. If a rule needs a TV variant, prefix it `html.is-tv`.
- Replace any `color: #fff` on fills, raw `transition: … .2s`, `100dvh` in TV rules, and
  `font-family: var(--font-display); font-weight: 400`.
- `app/views/pantry.js` renders family photo `<img>`s without `width`/`height` (CSS fixes their box,
  so nothing shifts; add the attributes when that file is next touched).
- The settings page can call `tv.tvSettingRow()` itself; injection steps aside when `.tv-row` exists.
- Not verified on a physical Fire TV. Detection, the 960 canvas and the remote keys follow Amazon's
  documented behaviour and are exercised in Chromium with a Fire TV user agent; if the Back button
  on the family's stick does not reach the page, the on-screen close buttons and Left-to-rail still work.
- View transitions are off on the TV on purpose (a plain rise-in is kinder to a TV stick).

## 19.9 After the merge (the feature stylesheets on the system)

`styles/parts/cook.css`, `server.css`, `profile.css` and `planner.css` are linked after `tv.css`
(and precached). `tests/design.test.mjs` ("every feature stylesheet is on the design system")
holds every file in `styles/parts/` to the same rules: no white text on a fill (`--on-red`,
`--on-butter`, `--pine-ink`), display type through `--display-weight`, no uppercase labels, no raw
durations, no viewport units in a TV rule, and **every rule inside a `min-width` media query of
1100 px or more starts `html:not(.is-tv)`**.

What changed in the merge:

- Cook's two blocks that bumped the type tokens from 1700 px are gone: with the TV layout they
  scaled twice. A monitor that wide keeps cook's three-column Tonight and bigger cook-mode
  controls; the TV gets its own rules (§19.5).
- One `cooker` icon and one name, `PossibleCooker` (`EQUIPMENT_LABELS`, `EQUIPMENT_ICON`).
- No avatar in the shell (§20.1); the dead `.who-*` / `.rail-who` rules are removed.
- The recipe page's Prep / Cook / Total strip never cuts a time: a cell is as wide as its text
  and the third wraps under the first two in a narrow column.
- Leftover rows stack (text, then buttons) on the TV; "Planning for" sits on the store control's
  line on wide screens and the store control keeps its height when the panel opens.
- Photos: `photo()` declares the real widths (`640w`, `1200w`) and the hero asks for the full
  picture from 1500 px wide, so the TV's hero (about 840 device px on a 1080p panel) is sharp.
  Sides and lunch items are a single 640 × 640 file.
- `dev/shoot-review.mjs` shoots every long screen one screenful at a time with a family that has
  leftovers, a missed dinner, old freezer food, receipts and a logged toss, at 390 px (tiled), and
  at 1280, the 1080p TV and the Fire TV canvas, plus the sheets
  (`node dev/shoot-review.mjs [light|dark] [screen|sheets] [1280|tv|firetv]`).
