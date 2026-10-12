# Architecture

## Runtime surface

The app is a static browser app served over HTTP. The current bootstrap has one
entry point, `index.html`, with `src/styles.css` for the responsive visual
system and `src/main.js` for home, roster setup, and active-game views.
State lives in memory in the browser module. `src/roster.js` contains pure
roster validation and game creation helpers. `src/score.js` contains pure
scoring helpers: signed integer parsing, `applyScoreChange`, which updates
one player's total and appends `{ id, playerId, amount }` to the in-memory
`game.changes` log, and `undoLastScoreChange`, which pops the newest log
entry, restores that player's total, and returns a new game object without
mutating the input. `src/standings.js` contains the pure ranking helper
`rankPlayers(game)`, which derives competition ranks (`1 +` the count of
strictly higher totals, so ties share a rank) in descending total order with
creation-order ties. `src/main.js` calls it at render time only; no rank is
stored on players, games, or the change log.

`src/storage.js` contains the pure persistence helpers behind the single
versioned storage key `scorekeeper:games`, which holds a
`{ version: 1, games: [...] }` envelope. Each saved game is the in-memory
game object verbatim (players, totals, and the full change log) plus one
storage-owned `updatedAt` stamp. `loadSavedGames` and `saveGames` take an
injectable storage backend, validate the envelope and each entry on read,
and never throw: they return result codes (`unavailable`/`invalid` for reads,
`unavailable`/`write` for writes) while diagnostics log only those codes, and
`loadSavedGames` additionally reports `droppedCount`, the number of unusable
entries skipped by the per-entry crash guard (0 for clean and failed reads).
`upsertSavedGame` replaces a saved game by id or appends it, and
`orderSavedGamesForDisplay` sorts copies most-recently-updated first with
deterministic tie-breaks. `src/main.js` persists the active game after every
successful game mutation (start, save points, undo), renders the home
"Unfinished games" list from the saved games, and resumes a saved game by
restoring it as the active game — so undo works immediately after a reload
and undone changes never resurrect. Ranks stay render-time only and are never
persisted.

Storage failures are surfaced, never silent. `src/main.js` tracks the startup
read result (`storageReadError`, `storageDroppedCount`) and the latest write
result (`lastSaveError`) and derives one polite `role="status"` notice
(`.storage-notice`) that renders at the top of the home "Unfinished games"
panel and above the active-game leaderboard, plus a home-only info note for
skipped entries. While the startup read is `invalid`, all writes are
suppressed for the session — `persistActiveGameSnapshot()` upserts nothing
and calls no `saveGames`, so an unreadable stored payload is preserved
byte-for-byte; suppression lifts only on reload. On any other failed write
the in-memory upsert is rolled back so home never renders a game that is not
actually in storage, and the first successful save clears the notice (and a
prior `unavailable` read error). In-memory play always continues with
unchanged success feedback; diagnostics stay code-only.

There is no backend, account service, database, build step, or deployment
configuration in this repository. Later features should keep product behavior in
browser JavaScript modules and persist MVP data in the current browser when the
persistence slice is implemented.

## Commands

- `npm run dev`: starts the local static HTTP server at `http://127.0.0.1:4173/`
  unless `HOST` or `PORT` is set.
- `npm run test`: runs roster, standings, score, and storage unit checks, HTTP
  smoke checks, and Chrome browser interaction checks for the roster, scoring,
  leaderboard, undo, save/resume, and storage-failure flows.
- `./init.sh` and `CI=true ./init.sh`: run the standard non-blocking gate and
  exit without starting the development server.

## Source layout

- `index.html`: semantic shell and app mount point.
- `src/main.js`: renders home/setup/active views, handles form events, and wires
  score entry, selection, live totals, feedback, the undo-last-score control,
  and the storage-health notices with the write-safety rule.
- `src/roster.js`: roster limits, colors, validation, identities, and zero-score game creation.
- `src/score.js`: score-change bounds, signed integer parsing, safe-integer
  guarded application, latest-change undo, and the in-memory change log.
- `src/standings.js`: pure leaderboard ranking: descending totals, shared
  competition ranks, and deterministic creation-order ties via `player.order`.
- `src/storage.js`: pure single-key local-storage persistence: versioned
  envelope load/save with injectable storage, result-code errors, per-entry
  crash guard with `droppedCount` reporting, upsert by id, and
  most-recently-updated display ordering.
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
- `scripts/storage-test.mjs`: pure storage persistence checks with in-memory
  storage stubs.
- `scripts/browser-test-utils.mjs`: shared headless-Chrome CDP helpers used by
  the browser test scripts.
- `scripts/browser-roster-test.mjs`: desktop/mobile roster interaction checks using isolated headless Chrome.
- `scripts/browser-score-test.mjs`: desktop/mobile scoring interaction checks using isolated headless Chrome.
- `scripts/browser-rank-test.mjs`: desktop/mobile leaderboard ranking interaction checks using isolated headless Chrome.
- `scripts/browser-undo-test.mjs`: desktop/mobile undo interaction checks using isolated headless Chrome.
- `scripts/browser-resume-test.mjs`: desktop/mobile save, resume, ordering,
  undo-after-reload, and blocked-storage checks (including the write notice and
  zero phantom cards) using isolated headless Chrome.
- `scripts/browser-storage-failure-test.mjs`: desktop/mobile storage-failure
  feedback checks — blocked writes, corrupt and incompatible payloads with
  byte-identical preservation, counted-failure recovery, partial corruption,
  unavailable reads, and 320px/accessibility notice checks — using isolated
  headless Chrome.

## Boundaries

The app creates an active game with named players and zero totals. It accepts
signed integer score changes on one player, records an in-memory change log,
renders a live leaderboard with descending totals, shared competition ranks,
and creation-order ties, and reverses the latest change on demand: each undo
pops the newest log entry, restores that recipient's total, and lets ranks
re-derive at render time. Ranks exist only while rendering; no rank is
stored or logged. Repeated undo walks backward until the log is empty; an
empty log is an announced no-op. Undo never touches `game.status`.

Every successful game mutation (starting a game, saving points, a successful
undo) persists the active game — players, totals, and the full change log —
under the single versioned `scorekeeper:games` key, and the home screen lists
saved games most-recently-updated first with a Resume control that restores
the game as active. Reloads therefore keep unfinished games and their undo
history; a successful undo persists the shortened log, so undone changes
never reappear. Storage read/write failures never throw and log code-only
diagnostics; user-facing failure feedback is a polite status notice on home
and in the active game, failed writes roll back the in-memory upsert so no
unsaved game is shown as saved, and an unreadable stored payload suppresses
all writes for the session so it is never overwritten. Finishing, read-only
final standings, replay, and saved-game deletion remain separate features.
