# 26. Cinematic motion and the progress record (v3.2.0)

Jeff, 2026-11-16: "This should keep a record of weigh ins and whatnot so that we can track weekly
progress", and "a sick motion graphic upgrade". The motion is the app's own work, in the cinematic
style that sites like motionsites.ai showcase; nothing was copied from there.

## 26.1 The record (app/checkin.js)
- **Weigh-ins**: every card has "Week by week": one row a week, newest first, with the weight, the
  change that week and the change since the first weigh-in (`weighProgress`). The chart shows up to
  26 weeks. Nothing is ever dropped from the record unless the person removes it.
- **Progress so far**: when two or more people weigh in, a card puts them side by side in one line
  each ("Down 3.6 lb in 3 weeks", "Up 1.8 lb in 3 weeks": `progressLine`).
- **Groceries**: "The record" lists the last twelve weeks (trips, spent, against the weekly share,
  and a check mark on the weeks the family checked in), with the average since the first receipt.

## 26.2 Easy tonight, from the family's real pantry
- A dinner eaten in the last three nights isn't offered.
- A dinner whose main is all in the house is still offered when only a side is short; it says which
  side to swap.

## 26.3 Motion (app/fx.js, styles/parts/fx.css)
A layer over `app/motion.js`. Transform and opacity only; durations are tokens (`--dur-scene`,
`--dur-drift`).
- **The launch**: the mark lands, a ring opens, the name rises, and it lifts away (about 1.5 s, once
  a visit). The first screen's entrance waits for it.
- **A new screen**: the headline rises word by word out of a mask; the dinner photo settles from a
  slight zoom while a band of light crosses it; the rest of the hero follows in; big numbers count
  up; chart bars grow, the weigh-in line draws itself and its points pop; budget meters fill.
- **Scrolling**: cards below the fold rise in as they arrive (with a timeout, so nothing can stay
  hidden).
- **Depth**: with a mouse, the dinner photo leans toward the pointer; cards lift on hover.
- **Aurora**: three slow, blurred lights in the app's own colors drift behind everything.
- Only a new screen plays an entrance; a re-render (a sync, another phone's change) never replays it.
- **The TV** gets the entrance only: no aurora, no scroll reveals, nothing that loops.
- **Reduced motion** (the device setting) turns all of it off. Cook mode has no aurora.
- Automated browsers skip the launch, the count-up and the scroll reveals (they read a screen the
  moment it draws); `?fx=all` forces them for `dev/shoot-fx.mjs`.
