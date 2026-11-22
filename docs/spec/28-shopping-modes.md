# 28. Two ways to shop: in the store, or order online (v3.4.0)

Jeff, 2026-11-22: "this should have two options. One: a list that orders your groceries online...
and the other is an interactive grocery list with the products we would need from sam's or jewell and
hopefully a good picture of that product so we know what we are getting. It would be even cooler if it
showed which aisle it was on."

## 28.1 The switch
- The List page asks **How are you shopping?** right under the period/trip bar: **In the store** or
  **Order online** (`LIST_MODES`, `app/aisles.js`). The choice is per device (`bfdp.v2.listMode` in
  localStorage) because one person may order online while another walks the store. Default: In the store.
- Totals, coupons, the freezer panel, extras and Done shopping are the same in both.

## 28.2 In the store
- Every row has an 84 px picture of the exact product (the family's own photo, else the store's;
  §23), the product name, how many, and an **Aisle** chip when the aisle is known.
- Each store's items are walked as stops (`shopStops`): one stop per aisle, in aisle order (zone letter,
  then number: A1, A2, A10, B1; plain numbers in number order), then whatever has no aisle yet, by
  section in the usual order. The heading names the aisle and the sections in it ("Aisle M9 Meat").
- A line under the store's name says where the aisles came from (`aisleNote`). Jewel-Osco's website
  shows no aisles, so Jewel is walked by section until the family adds some.
- Copy & open is not shown here (it is for ordering).

## 28.3 Order online
- Every row has a picture, the product, the price, and **Open on Sam's / Open on Jewel**: the store's
  product page when `data/aisles.json` has the exact product (`storeProductUrl`), else the store's
  search for it (`findItUrl`). The planner never fills a cart; the family adds each item on the
  store's site and ticks it here ("added to the cart").
- Copy & open (and Copy for Jewel-Osco AI) stay at the top of each store.

## 28.4 Where aisles come from
- `data/aisles.json` → `db.aisles` (`normalizeAisles`): `stores.sams.items[itemId] = { aisle, product,
  url, near }`. Sam's codes were read off samsclub.com product pages with the Addison club (6487)
  selected and Pickup chosen, 2026-11-22 (26 of the 29 Sam's items on that week's list). `near`: the
  club doesn't list the family's exact product, so the code is the closest product's on the same shelf,
  and there is no product link. `jewel.items` is empty.
- The family: the item sheet has an **Aisle at <store>** box. Saving writes
  `state.aisles[store][itemId] = { aisle, by, at }` for everyone; the family's entry always wins
  (stores move things). Clearing it goes back to the store's code. `cleanAisle` accepts what's on the
  sign ("Aisle 12", "m 9") and refuses anything else.

## 28.5 Pictures
The same day, the store's own pictures for 35 items on the family's list were saved to the family
server with `bfdp.importStorePhotos` (§23.1), so 49 of the list's 52 items show the real package. The
three without: a hummus and a snack tray the club and store don't list, and a pizza whose flavor
isn't recorded.

## 28.6 Photos from the iPhone's photo library (v3.4.1)
Jeff, the same evening: "this doesn't let me upload pics from my iPhone photo gallery. It would only
let me upload from the files section." Every place that takes a photo (receipt scan, What can I make?,
the pantry scan, an item's picture) now has two buttons: **Photo library** first (`accept="image/*"`,
several at once where that makes sense) and **Take a photo** (`capture="environment"`, straight to the
camera). The file input itself covers its button (`.file-over`: absolutely placed, invisible), so the
tap lands on the phone's own control instead of being passed through a label to a 1 px hidden input;
on an iPhone that opens the system menu with Photo Library first.
