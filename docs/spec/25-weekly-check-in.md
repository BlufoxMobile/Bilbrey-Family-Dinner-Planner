# 25. The weekly check-in, Easy tonight, and two plates (v3.1.0)

Jeff, 2026-11-16: "a weekly weight check in for both her and me", "a financial check in to ensure we
are on budget for groceries", and dinners that are "simple, easy, fun" so that Candi, who has been
stressed and not eating much, "will always feel like eating them", "with her eating more and me
eating less."

## 25.1 The week
- The family's week ends on the **check-in day** (`settings.checkinDay`, Monday = 0 … Sunday = 6;
  Sunday unless changed on the check-in page). `weekOf(date, day)` → `{ start, end }`.
- Tonight shows a **Weekly check-in** card on the check-in day and for two days after, until the week
  is marked checked or the card is waved off on that device (`checkin:<weekStart>`). The card carries
  the week's grocery total. It never carries a weight.
- The page is `#/checkin` (in the sidebar, linked from the Budget). It shows the week that is due,
  else the week in progress.

## 25.2 Money (`app/checkin.js` `moneyCheckin`)
- The week: receipts dated in it, store trips, the week before, and the last six weeks as bars
  against a week's share of the monthly target (target × 12 ÷ 52; $150 for $650).
- The month: spent so far, still to buy for what's planned, the open nights at the rotation's usual
  cost, and what it is heading for (the Budget's own `monthBudget`, so the two screens agree).
- A verdict: **on budget**, **close to the line** (the open nights would take it over) or **over**
  (what's bought and planned is already past the target), with up to three things to do: plan from
  the pantry, fewer trips, what was thrown out that week.
- "Looks right" saves `checkin.money[weekStart] = { end, spent, by, at }` for the whole family.

## 25.3 The weigh-in
Optional, per person, and private by design.
- A person chooses a **direction**, never a number: lose some, gain some back, stay about the same.
  There is no goal weight, no calorie target, no score, and no BMI.
- One point a week (the week's last weigh-in). The page says the change since last week, the change
  since the first weigh-in, and one plain sentence. A week up or down is called what it is: a week.
- It points to a doctor in three cases: someone gaining back who is down two weeks running; someone
  staying the same who is down three weeks running; someone losing faster than 2.5 lb a week over
  four weeks. The setup card says that weight dropping without trying is one for a doctor, and that
  a scale doesn't help everyone.
- **Where the numbers live is the person's choice.** "Only on this phone" (the default) keeps them in
  that device's own record (`device.weigh = { name, goal, keep: 'device', weights }`), never synced.
  "The family's private storage" keeps them in `checkin.weights[name][date]` and
  `checkin.people[name] = { goal }`: backed up, and visible to anyone with the family passcode on
  their phone or computer. Switching back takes them off the family's storage; "Stop, and erase"
  removes them everywhere.
- **Never on the TV.** With the TV display on, the page shows the groceries and a note; no weight,
  and no name, is rendered. Tonight's card never mentions a weigh-in on a TV.
- Weigh-ins are not sent to Claude and are not part of the chat connector.

## 25.4 Easy tonight (`app/easy.js`)
A link under tonight's dinner: "Low on energy tonight?" It opens up to three dinners that are the
least work (25 minutes of hands-on work or less, on the table within 45) and already in the house,
one of each kind, a loved dinner breaking ties; a slow-cooker dinner only before 11 am. When nothing
quick is covered, the quickest still show with what each needs. Under them, the no-cooking options:
leftovers in the fridge and ready-made meals on the shelf. Choosing one is the usual swap.

## 25.5 One dinner, two plates
The recipe page's plate guide now has both: a lighter plate (half vegetables, a palm of meat, a
cupped hand of starch) and a fuller plate (start with what sounds best, add something rich, a small
plate now and the rest later). Same pot, nothing to count.
