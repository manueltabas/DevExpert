# Architecture

## Runtime surface

The app is a static browser app served over HTTP. The current bootstrap has one
entry point, `index.html`, with `src/styles.css` for the responsive visual
system and `src/main.js` for home, roster setup, and active-game views.
State lives in memory in the browser module. `src/roster.js` contains pure
roster validation and game creation helpers. `src/score.js` contains pure
scoring helpers: signed integer parsing and `applyScoreChange`, which updates
one player's total and appends `{ id, playerId, amount }` to the in-memory
`game.changes` log. `src/standings.js` contains the pure ranking helper
`rankPlayers(game)`, which derives competition ranks (`1 +` the count of
strictly higher totals, so ties share a rank) in descending total order with
creation-order ties. `src/main.js` calls it at render time only; no rank is
stored on players, games, or the change log. Reloading clears the active game
and its change log.

There is no backend, account service, database, build step, or deployment
configuration in this repository. Later features should keep product behavior in
browser JavaScript modules and persist MVP data in the current browser when the
persistence slice is implemented.

## Commands

- `npm run dev`: starts the local static HTTP server at `http://127.0.0.1:4173/`
  unless `HOST` or `PORT` is set.
- `npm run test`: runs roster, standings, and score unit checks, HTTP smoke
  checks, and Chrome browser interaction checks for the roster, scoring, and
  leaderboard flows.
- `./init.sh` and `CI=true ./init.sh`: run the standard non-blocking gate and
  exit without starting the development server.

## Source layout

- `index.html`: semantic shell and app mount point.
- `src/main.js`: renders home/setup/active views, handles form events, and wires
  score entry, selection, live totals, and feedback.
- `src/roster.js`: roster limits, colors, validation, identities, and zero-score game creation.
- `src/score.js`: score-change bounds, signed integer parsing, safe-integer
  guarded application, and the in-memory change log.
- `src/standings.js`: pure leaderboard ranking: descending totals, shared
  competition ranks, and deterministic creation-order ties via `player.order`.
- `src/styles.css`: design tokens, layout, responsive rules, focus styles, and
  reduced-motion defaults.
- `scripts/static-server.mjs`: small Node HTTP static-file server shared by the
  dev server and smoke check. It serves only the explicit public shell files
  needed by the app and does not expose repository documents, metadata, dotfiles,
  or arbitrary paths under the project root.
- `scripts/serve.mjs`: long-running local server for manual browser use.
- `scripts/smoke.mjs`: non-blocking HTTP smoke check for the baseline shell.
- `scripts/roster-test.mjs`: pure roster behavior checks.
- `scripts/standings-test.mjs`: pure leaderboard ranking checks.
- `scripts/score-test.mjs`: pure scoring behavior checks.
- `scripts/browser-test-utils.mjs`: shared headless-Chrome CDP helpers used by
  the browser test scripts.
- `scripts/browser-roster-test.mjs`: desktop/mobile roster interaction checks using isolated headless Chrome.
- `scripts/browser-score-test.mjs`: desktop/mobile scoring interaction checks using isolated headless Chrome.
- `scripts/browser-rank-test.mjs`: desktop/mobile leaderboard ranking interaction checks using isolated headless Chrome.

## Boundaries

The app creates an active game with named players and zero totals. It accepts
signed integer score changes on one player, records an in-memory change log,
and renders a live leaderboard with descending totals, shared competition
ranks, and creation-order ties. Ranks exist only while rendering; no rank is
stored or logged. It does not offer undo, persist data, or lock finished games
yet. Undo, history, and finalization remain separate features.
