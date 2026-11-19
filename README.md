# chungi

chungi is a pet that rewards you for eating at home. you take a photo of a meal you cooked, the pet reacts, the app works out what it cost next to what you would have ordered, and the difference goes into a wallet that buys the pet things. it is for people who order takeout more than they want to. the backend and the landing page work and the landing page is live at https://chungi.ugmi.ca. the app screen is still a placeholder with a dev page at /dev. the landing page describes a newer plan, a monthly takeout budget where the money you don't spend becomes gift money for friends. the api does not have the budget or the gifts yet.

## what works now

- one node server (hono) with sqlite that serves the api and the built web app
- accounts tied to a browser cookie, no login, with a recovery key offered after the third meal
- meal photo upload. an openai vision model names the dish, lists the ingredients and writes the pet's reaction
- ingredient pricing against a table of 198 grocery items priced for waterloo, ontario (data/prices.json, sources in data/PRICES.md)
- savings wallet, cosmetics the pet can buy and wear, friend codes, a cooking timer and a daily check-in api
- daily photo limit and a daily spend cap on model calls
- a 1080 by 1920 share card png for each meal, with a placeholder layout
- meal photos deleted after 24 hours unless the user keeps them
- waitlist signup api with a rate limit and a csv export behind an admin token
- installable web app shell (manifest, icons, service worker) with a dev page at /dev to try the api
- static landing page in site/ with a waitlist form, how it works, phone mockups and a faq
- 89 tests with vitest

## run it locally

you need node 22 and python 3.

```
npm install
cp .env.example .env
```

put your openai key in `.env` as OPENAI_API_KEY. everything except photo analysis works without it.

```
set -a; . ./.env; set +a
npm run dev
```

the api runs on http://localhost:3090 and the web app on http://localhost:5173. open http://localhost:5173/dev to try it.

other commands:

- `npm test` runs the tests
- `npm run typecheck` checks types
- `npm run build` builds the web app into web/dist, then `npm start` serves it with the api
- `python3 site/build.py` builds the landing page into site/dist. its form posts to http://localhost:3090/api/signup unless you set CHUNGI_SIGNUP_API
- `npx tsx scripts/analyze.ts test/fixtures/*.jpg` runs the real model on the test photos (needs the key)
- `npx tsx scripts/check-prices.ts` checks the price table after an edit

analytics is off. it only turns on when you set the umami values in `.env`.

## help wanted

i stopped working on this because design and shipping take more time than i have. i want someone to take it to real users. i need help with:

- code: the real app screens. the api is done but the app only shows a placeholder and the /dev page. the first meal flow, the pet screen, the wallet and the shop need building in web/src.
- design: the pet screens, the share card (it uses a placeholder layout) and the cosmetics art. the pet drawings in assets/pet are the starting point.
- marketing: short videos and posts that get people onto the waitlist, and finding the first people who will log a week of home meals. most people only send code, so this is the part i need most.

## terms

- no ownership. the repo and the accounts stay with me.
- no revenue. you don't get paid, and you get no share of any money it makes.
- the code is MIT licensed, so you can still fork it and do what you want with your fork.
- "contributor" is the title for anyone whose code gets merged.
- if you run a launch or a release from start to finish, you can say you co-led the project.
- i am the reference for both titles. i will confirm what you did to a recruiter, a school or anyone else who asks.

## how to start

open an issue that says what you want to take on, or message me through github: https://github.com/EricJujianZou

## license

MIT. see LICENSE. the test photos and fonts keep their own licenses, see CREDITS.md.
