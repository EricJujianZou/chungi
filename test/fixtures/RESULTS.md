# Live fixture results

Run 2026-10-07 on gpt-6-luna with the variety rules. Each photo is an independent call with no recent reactions, so the jokes still converge; in the app the last five reactions are passed in.

model: gpt-6-luna

| Photo | Dish | Ingredient total (CAD) | Reaction | Nutrition note | Tokens in/out | Cost (USD) |
|---|---|---|---|---|---|---|
| eggs-on-toast.jpg | scrambled eggs on toast | $1.77 (eggs $1.14, bread $0.45, butter $0.18) | scrambled eggs on toast looks ready for a proper breakfast, and Uber Eats missed its chance to charge you for the same comfort. you should share that plate on your story, it looks FIRE. | A homemade version can be lighter and less salty than the takeout alternative. | 1674/126 | $0.00023 |
| fried-rice.jpg | egg fried rice with peas | $2.89 (cooked rice $1.63, eggs $0.76, peas $0.32, soy sauce $0.10, vegetable oil $0.08) | that egg fried rice with peas is looking seriously satisfying, and your Uber Eats app missed its chance to charge you for this bowl. | Homemade egg fried rice can be lighter on oil and salt than the usual takeout version. | 1674/149 | $0.00024 |
| spaghetti-bolognese.jpg | spaghetti with ground beef and peas | $2.38 (spaghetti $0.45, ground beef $1.32, peas $0.26, tomato sauce $0.27, oil $0.08) | that spaghetti with ground beef and peas looks seriously satisfying, and Uber Eats didn’t even get a notification this time. | Likely lighter on salt and oil than a typical takeout pasta. | 1926/137 | $0.00026 |
| tuna-sandwich.jpg | chicken salad sandwich | $3.64 (ciabatta bread $0.15, cooked chicken $1.85, mayonnaise $0.14, celery $0.75~, parsley $0.75~) | that chicken salad sandwich looks packed and ready for its close-up, while Uber Eats misses another chance to collect your usual order. You should be proud of this lunch. | Likely fresher and lighter on sodium than a typical takeout sandwich. | 1674/150 | $0.00024 |

total spend: $0.00098  (~ marks an estimated line)

Commands:

set -a; . ./.env; set +a; npx tsx scripts/pick-model.ts
set -a; . ./.env; set +a; npx tsx scripts/analyze.ts test/fixtures/*.jpg
