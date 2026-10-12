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
- Every new player starts at zero. Keep game state in memory until persistence
  is implemented; do not imply the current game survives a reload.
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
