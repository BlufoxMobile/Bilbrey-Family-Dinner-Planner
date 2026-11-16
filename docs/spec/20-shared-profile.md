## 20. One shared profile (Jeff, 2026-11-15)

Jeff: "You can remove the different family members profiles, we can all share the same profile. I
installed this on our tv too and we can all share it." Lunches are still planned for **Jeff and
Knox**, with "the option to add another person later."

This section replaces the per-person parts of §4 (`by: "Jeff"`), §8.5 (person chips "the phone's
own person first", "never on kids' items unless their parent opens the editor"), §9.1/§9.2
(per-person votes, "one thumbs-down from anyone", "≥2 thumbs-up = favorite") and the "who's using
this phone" step everywhere. Nothing in the family's saved data is migrated or rewritten: old data
is read as it is.

### 20.1 Devices: no "who"

- A device (phone, computer, TV) needs only the **family passcode**. There is no "who's using this
  phone" step, no person switcher, no avatar in the app shell, and no parent/kid difference in what
  can be changed (retire/restore/promote, the Claude model and connector link, and changing the
  passcode are open to every connected device).
- `app.who()` always returns `SHARED_PROFILE` (`'Family'`, `app/util.js`). Every change the app
  makes is stamped `by: 'Family'`, and `/api/ops` is sent with `by: 'Family'`. Callers that are not
  a person at a screen keep their own stamp (the Claude chat connector: `"Jeff (Claude chat)"`).
- The device record in `localStorage` (`bfdp.v2.device`, `normalizeDevice()` in `app/state.js`):
  `{ key, localOnly, clientId, dismissedGate, theme, textSize: 'regular'|'large', hideNutrition,
  dismissed[], todayFor, who }`. `who` is only kept so an older copy of the app still open finds
  what it saved; nothing reads it. A device set up as "Candi's phone" keeps working untouched.
- Old stamps (`by: "Jeff"`, `cookedBy`, `retired.by`) stay in the data. `byLabel(by)` (`util.js`)
  is what a screen should print: `''` for a person's name or `Family`, the source for anything else
  (`"Jeff (Claude chat)"` → `Claude chat`). "Updated by …" lines are not shown for people any more.
- The one per-device choice that names a person is display-only: **Today's total on Tonight**
  (`device.todayFor`, Family & settings → Display). Off on a new device; a device that used to be
  one person's keeps showing theirs. Options are the lunch packers.

### 20.2 The family's signal (replaces per-person votes)

One signal per dinner and per side: **loved**, **fine** (the default) or **not for us**.

- Stored where the votes were, under one name: `votes[dinnerId] = { Family: 1 | 0 | -1 }` and
  `sideVotes[sideId] = { Family: 1 | -1 }`. Plain "fine" saves nothing (the record is deleted);
  `0` is an explicit "fine", written only to turn down the recipe box's own `family favorite` tag.
- **Reading old data** (`signalOfVotes`, `app/planner.js`): any `-1` in the record → `no` (that
  was already the rule); otherwise any `1` → `loved`; otherwise `fine`. So a dinner one person
  thumbed up is now a family favorite, and nothing anyone told the app is lost.
- **Writing** replaces the whole record (one `set`, or one `del`), so thumbs left over from five
  profiles can never outvote what the family just said. Undo restores the exact old record.
- `dinnerSignal(state, dinner)`: `no` when `retired[id]` or the record says so; `loved` when the
  record says so, or the dinner carries the `family favorite` tag and the family hasn't said
  otherwise. `isFavorite` ⇔ `loved`. `sideSignal(state, id)`; `isSideDropped` ⇔ `no`.
- "Not for us" on a dinner **is** retiring it: `retired[id] = { by, at }`, the best bench dinner is
  promoted and takes its planned nights (as before). Moving off "not for us" deletes `retired[id]`
  (the dinner that came in stays). `retireOps` = signal `no`; `restoreOps` (Dropped list) deletes
  the record: a fresh start, and a bench dinner joins the rotation as before.
- Kept exports and their meaning now: `voteOps` / `sideVoteOps` (the two thumbs: value `1` toggles
  loved ⇄ fine, `-1` toggles not for us ⇄ fine; `who` is ignored; `signal:` sets one directly),
  `voteInfo` / `sideVoteInfo` (`up` and `down` are 0 or 1, plus `signal`), `FAVORITE_UPS` (1),
  `downVoters` (always `[]`: nobody is named), `hasDownVote`, `isRetired`. New: `rateDinnerOps`,
  `rateSideOps`, `dinnerSignal`, `sideSignal`, `signalOfVotes`, `votesForSignal`, `SIGNALS`.
- The planner is unchanged: it scores with `isFavorite` and `voteInfo().up/down`.
- UI: the same two thumbs everywhere (`data-action="vote:dinner|side"`, `data-value="1|-1"`,
  `.thumb-up/.thumb-down.is-on`), labelled Loved / Not for us; neither pressed = fine. The rate
  rows say "Dinner · Loved". The recipe page has two buttons (Loved, Not for us) instead of five
  avatars. The Dropped list says "Not for us", with no names.
- Lunch items keep per-person thumbs (`lunchVotes[itemId][name]`): the person is a lunch packer.

### 20.3 Lunches for whoever packs

- The only people the app knows are the ones who pack a lunch: `lunchPackers(db, state)`
  (`app/lunch.js`) → `[{ name, cfg, paused, isDefault }]`. Jeff and Knox come from
  `lunches.json` `defaults` (the entries with `enabled: true`); anyone else comes from
  `state.lunch.people[name]`.
- `state.lunch.people[name] = { enabled, days, slots, added?: "YYYY-MM-DD", paused?: true,
  removed?: true, ideas?: boolean }`.
  - **Listed** = not `removed`, and (a default packer, or `enabled === true`, or `paused === true`).
    An old `{ enabled: false }` record for Candi/Jordan/Jackson lists nobody and buys nothing; an
    old `{ enabled: true }` record is listed and packed for (never bought for silently); Knox
    switched off in the old editor is listed as paused.
  - **Add a person** (`addLunchPersonOps`): a name (letters, numbers, spaces, `.'-`, ≤ 24
    characters, case-insensitively unique), the days, the spots they pack and their items from the
    lunch list. Every spot is written (empty ones too).
  - **Pause** (`pauseLunchPersonOps`, also the editor's "Pack lunches for …" switch): `enabled:
    false, paused: true`; picks are kept, nothing is packed or bought. Resume flips it back.
  - **Remove** (`removeLunchPersonOps`): the record becomes `{ enabled: false, removed: true }`
    (so an older app sees "off"); picks are forgotten; adding the name again starts clean. Undo is
    on the message.
  - **Lighter swap ideas** (`ideas`): on by default for Jeff and Candi, off for anyone else, a
    switch in each person's editor. Replaces "only when a parent opens the editor".
- `lunchesIn` / `lunchNeeds` / the plan-ahead pantry math iterate `packingNames(db, state)`, so the
  shopping list, budget and "how far does the pantry stretch" follow who packs. Per-day "Skip this
  day", per-day swaps and the editor are unchanged.
- The Lunch page lists every packer (paused ones marked) plus "Add a person", and says in words
  who lunch groceries are bought for ("for Jeff and Knox only"). Family & settings → Packed
  lunches shows the same list.

### 20.4 Dates are Chicago days

Every calendar day the app saves or compares is the family's day in `America/Chicago`:
`chicagoDay(when)` / `chicagoMonth(when)` / `todayISO()` in `app/util.js`. `when` is a Date, a ms
timestamp or an ISO stamp. **Never** `new Date().toISOString().slice(0, 10)`: that is the UTC day,
already tomorrow from 6 pm Central (7 pm in summer). `fromDate()` is only for the UTC-midnight
dates `toDate()` makes. A unit test scans `app/`, `dev/mock-api.mjs` and `sw.js` for the pattern.

Fixed: `pantry[id].since` (pantry edits, done shopping, pantry scans, receipts → pantry),
`pantry[id].bought.on`, the fallback date of a receipt with no readable date, the comparison date
of a learned product without one, `lunch.people[name].added`, and the mock API's Claude month.
`sinceOf()` (`app/freshness.js`) also heals what older versions saved: when `since` equals the UTC
date of the entry's own `at` stamp and the Chicago day of that stamp is the day before, the Chicago
day is used (nothing is rewritten). Timestamps (`at`, `cookedAt`) stay ISO/UTC.

### 20.5 First open, the TV, offline, a wrong passcode

- First open goes straight to the passcode screen (`app/views/onboarding.js`), which says what the
  planner is in three lines. Four states: `checking` ("Looking for the family's plan…" until the
  server answers), `create`, `enter`, `offline` ("Can't reach the family's plan": Try again, Look
  around first, Use on this device only). The app connects on every open; quiet background retries
  never swap the screen.
- Typing with a remote: one field to enter; `autocapitalize="none"`, no autocorrect or spellcheck,
  `enterkeyhint="go"`; **Show the passcode** (and then no "type it again" when creating or
  changing); every control has an id and a redraw keeps focus where it was; on a wide, short
  screen (a TV at 960×540) the explanation and the form sit side by side so the box and Join are
  on screen; a hint about the on-screen keyboard shows on TV browsers (`isTV()`).
- A wrong passcode: the message sits by the field (`role="alert"`, `aria-invalid`,
  `aria-describedby`), focus returns to the field, and what was typed is kept. The key being tried
  is only stored once the server accepts it (it used to be set first, which flashed the app behind
  the screen and wiped the field).
- A device that was changed before it ever joined ("Look around first", then someone planned a
  week on it) is asked when it joins: **Start from the family's plan** (its own changes are left
  behind, and only once the passcode is accepted: `enterPasscode(pass, { dropPending: true })`) or
  **Send my changes too** (what joining always did).
- A connected device whose passcode stops working (it was changed elsewhere) says so with a
  message and an "Enter it" button, instead of only a "Connect" pill: the TV on the wall would
  otherwise show an old plan. A page left open all day (the TV) also looks for an app update once
  an hour, not only when it comes back to the foreground.
- Display options are per device: appearance, **text size** (Regular / Large, for a TV across the
  room; applied before first paint), show calories and protein, today's total on Tonight.

### 20.6 Family & settings

One shared page, in this order: Family sync (status, "Add another phone or the TV", change the
passcode) · Planner rules · Shopping and budget (monthly target, plan from, organic, meat per
dinner) · Stores (cards, My products, Receipts) · Packed lunches (the only people on the page) ·
Claude · Display on this device · Good to know · This device's data.
