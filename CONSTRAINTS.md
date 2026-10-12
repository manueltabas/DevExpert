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
  points, a successful undo); failed validations, selection changes,
  feedback-only repaints, and no-op undos never write. Never persist rank
  fields, and never remove saved games in a slice that has no delete feature.
  Resume restores the saved game verbatim as the active game, so undo works
  immediately and a successful undo persists the shortened log — undone
  changes must never reappear after a reload.
- Storage helpers (`src/storage.js`) must never throw: reads return
  `{ games, error }` with codes `unavailable` (missing/throwing storage) and
  `invalid` (unparseable, wrong-version, or wrong-shape payload; unusable
  entries are dropped with a warning), writes return `{ saved, error }` with
  codes `unavailable` and `write`. Diagnostics log only error codes — never
  player names, titles, or scores. User-facing storage-failure UX and deep
  malformed-data recovery belong to `handle-storage-failure`.
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
- Undo always reverses the newest `{ id, playerId, amount }` entry in
  `game.changes`: subtract that change's amount from its recipient's total and
  drop the entry, one change per activation, with no depth limit. A missing,
  empty, or non-array log is a safe no-op that never mutates state. Undo never
  mutates the input game, never touches `game.status` or `player.order`, and
  never stores ranks. Undo survives reloads through the persisted change log;
  finishing, and replay slices must keep these rules.
