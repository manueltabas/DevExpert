# Constraints

- Serve and test the app over HTTP. Do not rely on opening `index.html` through
  a `file://` URL because browser storage and module behavior are origin-bound.
- Keep `./init.sh` as a non-blocking verification gate. It may print the local
  server command after checks pass, but it must not start a long-running server.
- Keep the MVP static and browser-local: no accounts, application backend,
  database service, analytics service, or remote synchronization unless a later
  approved feature changes the product direction.
- The local static server must serve only explicit public app files and assets.
  Repository documents, harness metadata, dotfiles, Git internals, and malformed
  URL paths must not be exposed through HTTP.
- Do not implement future game behavior inside placeholder shell controls.
  Scoring, ranking, undo, persistence, finishing, podium, and
  replay each need their own feature evidence.
- Games must contain 2–20 players with trimmed, nonblank names of at most 40 characters.
- Use blue, red, yellow, green, orange, white, or black markers. Duplicate names
  and colors are allowed; player IDs must be independent of both.
- Every new player starts at zero.
- Game mutations persist to the browser's local storage under the single
  versioned key `scorekeeper:games` as a `{ version: 1, games: [...] }`
  envelope. Each saved game is the in-memory game object verbatim — roster,
  totals, and the full `{ id, playerId, amount }` change log — plus one
  storage-owned `updatedAt` ISO stamp written only on the stored copy. Saves
  happen exactly on successful game mutations (starting a game, saving
  points, a successful undo, and confirming Finish game); failed
  validations, selection changes, feedback-only repaints, and no-op undos
  never write. Never persist rank fields, and never remove saved games in a
  slice that has no delete feature. Resume restores the saved game verbatim
  as the active game, so undo works immediately and a successful undo
  persists the shortened log — undone changes must never reappear after a
  reload.
- Storage helpers (`src/storage.js`) must never throw: reads return
  `{ games, error, droppedCount }` with codes `unavailable` (missing/throwing
  storage) and `invalid` (unparseable, wrong-version, or wrong-shape payload;
  unusable entries are dropped with a warning and counted in `droppedCount`,
  which is 0 for clean and failed reads), writes return `{ saved, error }`
  with codes `unavailable` and `write`. Diagnostics log only error codes —
  never player names, titles, or scores.
- Storage failures must never be silent, and stored data must never be
  silently lost or overwritten:
  - While the startup read is `invalid`, every write is suppressed for the
    session — no `upsertSavedGame` mutation and no `saveGames` call — so an
    unreadable stored payload is preserved byte-for-byte; suppression lifts
    only on reload. Writes after an `unavailable` read are still attempted.
  - A failed write must roll back the in-memory `upsertSavedGame` mutation so
    the UI never presents an unsaved game as saved, and no save may claim
    success it did not have; the first successful save clears the failure
    notice (and a prior `unavailable` read error).
  - Storage-failure feedback is a single polite live region
    (`role="status"`, `.storage-notice`) on home and in the active game plus
    a home-only info note for skipped entries; notices carry no retry or
    dismiss buttons — every subsequent mutation auto-retries the save — and
    diagnostics stay code-only.
- Score changes are signed whole numbers with magnitude at most 1,000,000.
  Zero entries are rejected and create no change-log entry; decimals,
  non-numbers, and out-of-range amounts are rejected without changing totals.
  Totals may be negative, and each applied change appends
  `{ id, playerId, amount }` to the in-memory `game.changes` log.
- Leaderboard ranks are competition ranks derived at render time from player
  totals: `rank = 1 +` the number of strictly higher totals, so equal totals
  share a rank and the next position skips (12, 12, 8 → 1, 1, 3). Tied players
  keep creation order via `player.order` (falling back to the original array
  index). Never store rank fields on players or games, never write ranking to
  the change log, and never persist ranks.
- Finishing a game is the one-way lifecycle transition: `finishGame` in
  `src/game.js` is the only code that sets `status: "finished"`, it accepts
  only a game whose `status` is `active` (anything else is a
  `missing-game`/`already-finished` guard result), it returns a new game
  object without mutating the input or touching players, totals, the change
  log, or `player.order`, and it stores no fields beyond `status` — no
  `finishedAt`, no ranks. There is no un-finish: a finished game can never
  reopen for scoring, and score/undo changes never alter `game.status`.
  Confirming Finish must run through an explicit confirmation (no
  `window.confirm`), and finishing persists through
  `persistActiveGameSnapshot()` as the fourth successful-mutation save
  trigger, so it obeys the storage-failure rules above: under suppression or
  a failed write the finish still proceeds in memory, no phantom finished
  card may appear on home, and no new failure path may be added.
- A game with `status: "finished"` must render read-only: the full final
  standings stay visible with render-time competition ranks and unchanged
  aria-labels, but every score mutation control is absent (no Add points
  buttons, no `aria-pressed` selection, no score-entry panel, no Save points,
  no undo), the read-only explanation is a polite `role="status"` line, and
  reopening a finished game from the home Finished games panel must restore
  exactly the same read-only guarantees. Finished games are listed only in
  the Finished games panel with View results controls; the Unfinished panel
  filter stays `status === "active"`.
- Undo always reverses the newest `{ id, playerId, amount }` entry in
  `game.changes`: subtract that change's amount from its recipient's total and
  drop the entry, one change per activation, with no depth limit. A missing,
  empty, or non-array log is a safe no-op that never mutates state. Undo never
  mutates the input game, never touches `game.status` or `player.order`, and
  never stores ranks. Undo survives reloads through the persisted change log;
  finishing, and replay slices must keep these rules.
