# Digiport

A fan-made, non-commercial deck builder for the Digimon Card Game, in the
browser. Every English-legal card, live filtering, deck validation against the
50 + 5 rules and the ban list, and import/export in the plain-text format the
rest of the community already uses.

A play client — a manual tabletop board with assists rather than a rules
engine — is the next phase. `PLAN.md` has the whole picture.

## Running it

```
cd web
npm install
npm run dev      # http://localhost:5180
npm run build    # type-checks, then writes web/dist
npm test         # vitest, over the real card payload
```

There is nothing to configure and no server: decks live in `localStorage`, and
sharing works by putting the whole deck list inside the URL.

## What is here

```
build_cards.py            digimondle's card record -> web/public/data/*.json
web/src/cards.ts          card index, filters, sorting, image-host fallback
web/src/deck.ts           deck model, copy limits, validation, stats, text I/O
web/src/share.ts          deck <-> compressed URL hash
web/src/components/       filters, card grid, hover detail, deck panel, import/export
wrangler.toml             Cloudflare Worker that serves web/dist
```

Pure logic lives in plain `.ts` files with tests beside them; the React
components stay thin on top of it.

## Refreshing the card data after a new set

The card pool comes from the sibling [digimondle](../digimondle) project, which
merges the TakaOtaku dataset (MIT) with digimoncard.io. Nothing in this repo
writes to it.

```
cd ../digimondle
python fetch_data.py
python build_dataset.py

cd ../digiport
python build_cards.py       # -> web/public/data/cards.json + meta.json
```

`build_cards.py` prints the card count and the ban/restriction totals, so a
successful refresh is visible at a glance. Commit the regenerated JSON.

## Card images

Art is hotlinked from digimoncard.app, with images.digimoncard.io and
world.digimoncard.com as fallbacks — `imageUrl(card, meta, attempt)` walks the
list on an `onError`, so a host going down degrades rather than breaks. If the
hosts ever object to the traffic, the fix is to mirror to R2 behind the worker
and change that one function.

## Deploying

Live at **https://galpartuk.github.io/digiport/**.

`git push` to `main` runs `.github/workflows/pages.yml`, which installs, runs
the vitest suite, builds, and publishes `web/dist` to GitHub Pages. A red suite
stops the deploy, so the live site is only ever a build that passed. No secrets
are involved — Pages publishes from the build artifact.

It serves from the `/digiport/` subpath because `web/vite.config.ts` sets
`base: './'` and `src/cards.ts` fetches through `import.meta.env.BASE_URL`, so
assets and both data files resolve relative to the served page. Changing that
`base` would break `data/cards.json` on the live site while leaving `npm run
dev` working, so leave it relative.

Cloudflare Workers is kept as a dormant alternative: `wrangler.toml` is still
correct and `.github/workflows/deploy.yml` still works, but it is
`workflow_dispatch` only — run it by hand from the Actions tab, with the
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets set.

## Disclaimer

Digiport is an unofficial fan project. It is not affiliated with, endorsed by
or sponsored by Bandai. Digimon and the Digimon Card Game are trademarks of
their respective owners; all card text and art belong to them. Nothing here is
sold, and the project will be taken down on request from the rights holders.
