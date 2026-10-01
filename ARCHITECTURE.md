# Architecture

## Runtime surface

The app is a static browser app served over HTTP. The current bootstrap has one
entry point, `index.html`, with `src/styles.css` for the responsive visual
system and `src/main.js` for shell-only initialization.

There is no backend, account service, database, build step, or deployment
configuration in this repository. Later features should keep product behavior in
browser JavaScript modules and persist MVP data in the current browser when the
persistence slice is implemented.

## Commands

- `npm run dev`: starts the local static HTTP server at `http://127.0.0.1:4173/`
  unless `HOST` or `PORT` is set.
- `npm run test`: runs the smoke check.
- `./init.sh` and `CI=true ./init.sh`: run the standard non-blocking gate and
  exit without starting the development server.

## Source layout

- `index.html`: semantic home shell and inert placeholders.
- `src/main.js`: shell initialization only.
- `src/styles.css`: design tokens, layout, responsive rules, focus styles, and
  reduced-motion defaults.
- `scripts/static-server.mjs`: small Node HTTP static-file server shared by the
  dev server and smoke check. It serves only the explicit public shell files
  needed by the app and does not expose repository documents, metadata, dotfiles,
  or arbitrary paths under the project root.
- `scripts/serve.mjs`: long-running local server for manual browser use.
- `scripts/smoke.mjs`: non-blocking HTTP smoke check for the baseline shell.

## Boundaries

The bootstrap shell deliberately does not create games, score players, rank
standings, use localStorage, or write any user data. Those behaviors belong to
later feature slices and should arrive with focused tests and updated evidence.
