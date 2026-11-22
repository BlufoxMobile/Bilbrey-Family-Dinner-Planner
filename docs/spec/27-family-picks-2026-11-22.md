# 27. The family's picks, 30-minute replacements, and fried shrimp night (v3.3.0)

Sunday 2026-11-22, before the month's big shop, Jeff and Candi went through every dinner and side in a
picking page and marked 22 dinners and 7 sides **No**. Jeff: "Can you replace those with non pork
options. I would be good with a fried shrimp night with some sea pak fried shrimp. We usually eat two
packs when we cook that and we cook that with fries." Their note: "Sometimes we like french style green
beans, and other simple, easy canned goods as sides. The goal for replacement meals from the ones I
cancelled would be for you to think of 30 miniute or less meals if possible. Also, we don't do a lot of
pork either."

## 27.1 What left
- Dinners (retired by name in `RETIRED_DINNERS`, reason `NO_2026_11_22`): apple-glazed and honey-garlic
  pork chops, breaded pork sandwiches, chicken katsu, chicken pepper plates, chicken tostadas, the cooker
  beef stew, braised pork with apples, chicken cacciatore, Italian beef, lasagna soup, sausage minestrone,
  sesame-ginger chicken, hibachi chicken noodles, kung pao chicken, mustard pork with apples, peanut sweet
  potatoes, pork carnitas tacos, pork souvlaki plates, sausage and pepper hoagies, sweet potato tacos,
  sweet and sour pork.
- Sides (in `REMOVED_SIDES`): air-fryer veggies, applesauce cups, Asian slaw, lime slaw, spinach-apple
  salad, steamed mixed vegetables, sweet potatoes. Every dinner that served one now serves a side the
  family kept (Mexicorn on the Tex-Mex nights, French-style green beans on the comfort nights).
- Their pictures and photo jobs went with them.

## 27.2 What came in (22 core dinners)
Every one is 30 minutes or less start to finish, 15 minutes or less hands-on, no pork, main + 2 sides
for five, with its own picture.
- Beef: hamburger steaks & gravy, Philly cheesesteaks, steak fajitas, cheesy taco pasta, Mongolian beef,
  cheesy beef quesadillas, one-pot chili mac (freezes), French dip sandwiches, beef & potato skillet.
- Chicken: honey garlic chicken bites, lemon pepper chicken, smothered chicken, chicken ranch pasta,
  southwest chicken & rice, Hawaiian BBQ chicken, chicken tender night (Sam's frozen strips in the air
  fryer with three dips), chicken street tacos, garlic butter chicken & noodles, chicken & dumplings,
  garlic Parmesan chicken, cheesy chicken broccoli rice.
- **Fried shrimp night** (`seapak-shrimp-night`, tagged `family usual`): two 18 oz bags of SeaPak
  butterfly shrimp (36 oz) in the air fryer at 400°F to 145°F, with air-fryer fries and buttered corn,
  lemon and cocktail sauce. It runs over the usual per-meal cost cap and under the protein floor per
  person on the box's numbers; both are allowed for this one night because it is how the family already
  eats it.

## 27.3 Simple canned sides
- `canned-green-beans` is now **Buttered French-style green beans**.
- New: **Buttered Mexicorn** and **Buttered new potatoes** (canned whole new potatoes, browned in
  butter). Each is 12 minutes or less from a can.
- Cream-style corn was added and taken out the same day (v3.3.1). Jeff: "no cream style corn, only
  regular". Regular buttered corn (`canned-corn`) stays; `cream-corn` is in `REMOVED_SIDES`.

## 27.4 The seafood rule
The house rule stays: no seafood. The two exceptions are the occasional snow-crab boil and fried shrimp
night. `PROTEINS` gains `seafood` so the planner can label it; the validator (`SHRIMP_NIGHT`) lets the
words shrimp/seafood and the `seapakShrimp` item appear only in that dinner, and still refuses them
anywhere else. The family page, Claude's planning prompt and the MCP tools say the same.

## 27.5 Numbers
105 dinners, 42 sides. The bench minimum is now 10 (most of the bench was what the family said No to).
