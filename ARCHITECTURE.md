# Architecture

## Runtime surface

The app is a static browser app served over HTTP. The current bootstrap has one
entry point, `index.html`, with `src/styles.css` for the responsive visual
system and `src/main.js` for home, roster setup, and active-game views.
State lives in memory in the browser module. `src/roster.js` contains pure
roster validation and game creation helpers. Reloading clears the active game.

There is no backend, account service, database, build step, or deployment
configuration in this repository. Later features should keep product behavior in
browser JavaScript modules and persist MVP data in the current browser when the
persistence slice is implemented.

## Commands

- `npm run dev`: starts the local static HTTP server at `http://127.0.0.1:4173/`
  unless `HOST` or `PORT` is set.
- `npm run test`: runs roster unit checks, HTTP smoke checks, and Chrome browser interaction checks.
- `./init.sh` and `CI=true ./init.sh`: run the standard non-blocking gate and
  exit without starting the development server.

## Source layout

- `index.html`: semantic shell and app mount point.
- `src/main.js`: renders home/setup/active views and handles form events.
- `src/roster.js`: roster limits, colors, validation, identities, and zero-score game creation.
- `src/styles.css`: design tokens, layout, responsive rules, focus styles, and
  reduced-motion defaults.
- `scripts/static-server.mjs`: small Node HTTP static-file server shared by the
  dev server and smoke check. It serves only the explicit public shell files
  needed by the app and does not expose repository documents, metadata, dotfiles,
  or arbitrary paths under the project root.
- `scripts/serve.mjs`: long-running local server for manual browser use.
- `scripts/smoke.mjs`: non-blocking HTTP smoke check for the baseline shell.
- `scripts/roster-test.mjs`: pure roster behavior checks.
- `scripts/browser-roster-test.mjs`: desktop/mobile interaction checks using isolated headless Chrome.

## Boundaries

The app creates an active game with named players and zero totals. It does not
score players, rank standings, or persist data yet. History, scoring, and
finished-game behavior remain separate features.
