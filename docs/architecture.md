# architecture

One Node 22 process (Hono) serves the API and the built Svelte app. SQLite via
node:sqlite in var/chungi.sqlite. Photos in var/photos. Port 3090 by default.
Secrets come from the environment, see .env.example. Never log them.

| Path | Job |
|---|---|
| server/index.ts, db.ts, config.ts, schema.sql, types.ts | shared setup, database, config and types |
| server/routes/account.ts, meals.ts, wallet.ts, server/retention.ts | accounts by cookie, onboarding price, meal log, wallet, photo cleanup |
| server/routes/cosmetics.ts, friends.ts, signup.ts, checkin.ts, timer.ts, data/cosmetics.json, data/copy.json | pet shell APIs, landing page signups and the scripted copy file |
| server/analysis/** | OpenAI vision call, pricing against the table, caps, logging |
| data/prices.json | the Waterloo grocery price table, see data/PRICES.md |
| server/sharecard/**, server/routes/card.ts, assets/fonts | story-size PNG share card |
| web/** | PWA shell, Vite and Svelte setup, dev harness at /dev |
| site/** | the static landing page and its build script |

Contracts between the parts are in server/types.ts. The meal routes call
`analyzeMeal(photoPath, ctx): Promise<AnalysisResult>` from
server/analysis/index.ts and `renderShareCard(input): Promise<Buffer>` from
server/sharecard/render.ts.

Schema changes go in server/migrations/NNN-name.sql, idempotent, never by
editing schema.sql.

Tests: vitest, files in test/, run with NODE_ENV=test and CHUNGI_VAR pointing
at a temp dir so no test touches var/.
