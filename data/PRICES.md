# Grocery price table

`data/prices.json` holds 198 grocery items in Canadian dollars, priced for
Waterloo, Ontario as of October 2026. Each row follows
`data/prices.schema.json`. The price is for one base unit (one gram, one ml,
one each, one slice or one tbsp), so a 170 g can of tuna at $1.78 is stored as
0.01047 per g. `typical_pack` keeps the pack size and pack price the unit price
came from, so a person can check the math.

Run `npx tsx scripts/check-prices.ts` after any edit. It checks the schema,
unique snake_case ids, positive prices, a per-unit ceiling ($0.10 per g or ml,
$10 per each, $2 per slice or tbsp) and aliases shared between two rows.
`test/c-prices.test.ts` runs the same checks under vitest.

All rows have `checked_on` 2026-10-07, the day the table was built.

## Where the prices came from

| Rows | Source |
| ---: | --- |
| 87 | Statistics Canada table 18-10-0245-01, Ontario average for August 2026 |
| 9 | No Frills Ontario flyer, 2026-10-01 to 2026-10-07 |
| 3 | Food Basics Ontario flyer, 2026-10-01 to 2026-10-07 |
| 2 | Food Basics Ontario flyer, 2026-09-03 to 2026-09-09 |
| 1 | Walmart.ca online price, October 2026 |
| 96 | estimate |

Source URLs:

- StatCan table 18-10-0245-01, full CSV download:
  https://www150.statcan.gc.ca/n1/tbl/csv/18100245-eng.zip
  (table page: https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1810024501,
  release note: https://www150.statcan.gc.ca/n1/daily-quotidien/260902/dq260902a-eng.htm)
- No Frills flyer Oct 1 to 7, 2026, as transcribed by a flyer aggregator:
  https://www.shopping-canada.com/flyers/no-frills/no-frills-weeklyflyer-from-october-1-to-october-7-2026
- Food Basics flyer Oct 1 to 7, 2026, same aggregator:
  https://www.shopping-canada.com/flyers/food-basics/food-basics-weekly-flyer-from-october-1-to-october-7-2026
- Food Basics flyer Sept 3 to 9, 2026, same aggregator:
  https://www.shopping-canada.com/flyers/food-basics/food-basics-weekly-flyer-from-september-3-to-september-9-2026
- Mr. Noodles at $0.48 a pack on walmart.ca, seen in search results for
  https://www.walmart.ca/en/c/brand/mr-noodles

## Method

1. The StatCan CSV was the main source. It gives a monthly average shelf
   price per province from store scanner data. I took the latest Ontario
   value (August 2026) for every product that a student would cook with and
   divided by the pack size StatCan names. StatCan is a regular-price average
   across the province, so it should be close to Waterloo prices and is not
   skewed by one week's sale.
2. Flyer prices were used only for items StatCan does not cover (Italian
   sausage, kielbasa, mozzarella, cream cheese, cheese slices, oats, maple
   syrup, vegetable broth, honey garlic sauce, barbecue sauce, Kraft Dinner,
   chicken wings, jasmine rice, Buldak ramen). These are sale prices, so they
   run lower than what a student pays most weeks.
3. Store websites (Zehrs, No Frills, Walmart.ca, Voila, Food Basics) all
   block automated reads, and T&T has no readable flyer page, so no Asian
   grocery price came from a live source. Asian pantry items, spices and the
   remaining extras are estimates from typical Ontario shelf prices.
4. Items that people count instead of weigh (onion, tomato, bell pepper,
   carrot, potato, banana, apple, orange, garlic clove, green onion stalk,
   celery stalk) are priced per each. The weight assumed for one piece is
   written in `typical_pack`, for example "per kg $4.41, about 150 g each".
5. Spices are priced per tbsp because a vision model names spices by the
   spoon, not the gram.
6. Canned beans and canned corn are labelled in ml on the can but stored per
   g, treating 1 ml as about 1 g of contents.

## What needs re-checking

- The flyer rows are sale prices read through an aggregator that transcribes
  flyers automatically. Check each of the 14 flyer rows against the store
  shelf or the Flipp app once. The pack sizes for mozzarella (907 g at
  $13.99), cheese slices (22 slices in 500 g) and maple syrup ($6.99 for
  500 ml) are the ones most likely to be misread.
- Jasmine rice ($14.88 for 8 kg) and Buldak ramen ($12.98 for a 5 pack) come
  from a September flyer that did not say the pack size. The sizes are my
  guess.
- Asian grocery rows are all estimates: kimchi, gochujang, frozen dumplings,
  udon, rice cakes, bok choy, napa cabbage, oyster sauce, hoisin, fish sauce,
  sesame oil, chili crisp, short grain rice, Korean ramen. A single visit to
  T&T on Westmount and one Korean grocery near campus would fix most of them.
- Frozen dumplings are priced per piece, assuming 45 pieces in a 908 g bag.
  Brands vary from 30 to 60 pieces per bag.
- Protein powder ($32.99 for 908 g) varies a lot by brand.
- Fresh produce bought per piece (apple, tomato, bell pepper) depends on the
  piece weight assumed in `typical_pack`. StatCan's apple price works out to
  $1.14 an apple, which is higher than a bag of apples at No Frills.
- StatCan publishes a new month around the start of each month. Refresh the
  87 StatCan rows by downloading the CSV again and taking the latest Ontario
  row for each product.
