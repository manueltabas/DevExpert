# Architecture

## Runtime surface

The app is a static browser app served over HTTP. The current bootstrap has one
entry point, `index.html`, with `src/styles.css` for the responsive visual
system and `src/main.js` for home, roster setup, and active-game views. The
visual system is a plain-CSS token layer: `src/styles.css` translates the v2
token file (`docs/design/update-v2/warm_tactile_scorekeeper/DESIGN.md`) into
custom properties — warm ivory canvas, cool card surfaces, the Plus Jakarta
Sans type scale, radius/spacing/shadow tokens — and every screen renders from
those tokens. Plus Jakarta Sans is linked from Google Fonts in `index.html`
(preconnect + one stylesheet, weights 400/600/700/800, `display=swap`) with the
accepted system stack as the declared fallback; no font files are committed, no
Tailwind, no icon fonts, no build step. The one suite-frozen token value is
`--muted: #6D655C`, kept because the undo suite asserts the info-feedback
color `rgb(109, 101, 92)` exactly.
State lives in memory in the browser module. `src/roster.js` contains pure
roster validation and game creation helpers. `src/score.js` contains pure
scoring helpers: signed integer parsing restricted to plain signed integer
text — `parseScoreAmount` runs a final plain-format gate after the
finite/integer/zero/range checks, so exact-integer non-plain text such as
`1e3`, `0x10`, or `10.` returns the existing `not-a-number` code instead of
saving — plus `applyScoreChange`, which updates
one player's total and appends `{ id, playerId, amount }` to the in-memory
`game.changes` log, and `undoLastScoreChange`, which pops the newest log
entry, restores that player's total, and returns a new game object without
mutating the input. `src/standings.js` contains the pure ranking helpers
`rankPlayers(game)`, which derives competition ranks (`1 +` the count of
strictly higher totals, so ties share a rank) in descending total order with
creation-order ties, and `podiumRows(game)`, which filters that ranking to
every row with rank ≤ 3 without collapsing ties or mutating its input.
`src/main.js` calls both at render time only; no rank is stored on players,
games, or the change log.

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
successful game mutation (start, save points, undo, finish, replay), renders
the home "Unfinished games" list from the active saved games and the
"Finished games" list from the finished ones, and resumes a saved game by
restoring it as the active game — so undo works immediately after a reload,
undone changes never resurrect, and finished games reopen read-only. Ranks
stay render-time only and are never persisted.

`src/game.js` contains the pure game-lifecycle transitions. `finishGame` is
the one-way `active → finished` change: it accepts only a `status: "active"`
game (guarding `missing-game` and `already-finished`), returns a new game
object with only `status` changed, never mutates its input, and stores no
ranks, timestamps, or other new fields. `replayGame` is the replay
transition: it accepts only a `status: "finished"` game (guarding
`missing-game`, `not-finished`, and roster validation through `invalid-roster`),
maps the finished roster back to roster rows, and calls `createGame` with the
`replay-game` id seed — so every game and player identity is structurally new
(`replay-game-*` ids can never collide with setup-created `active-game-*`
ids). It copies only presentation (title, names, colors, markers, and the
creation order, restoring atypical-but-valid stored values literally with
regenerated fallbacks) while every total restarts at zero and no change log
or `updatedAt` carries over; the input game is never mutated. `src/main.js`
renders a `status: "finished"` game as a read-only variant of the active view
— same header (eyebrow "Finished"), back control, storage notice, and full
render-time-ranked leaderboard, but with a polite `role="status"` note and
none of the score mutation controls (no Add points buttons, no score-entry
panel, no undo) — plus the finished view's only mutation control, a "Play
again" primary action below the standings with its own polite
`#replay-feedback` live region for guard messages. Confirming the inline
finish prompt and activating Play again both call
`persistActiveGameSnapshot()`, so finishing and replaying are the fourth and
fifth successful-mutation save triggers, and the home screen additionally
renders the "Finished games" list from saved games filtered to
`status: "finished"` with View results controls that reopen the read-only
view through the same resume path.

The podium celebration is the app's display-only modal layer. A successful
confirm-finish sets a transient `state.podiumOpen` flag (reset wherever the
finish prompt resets, so reopening, View results, or reloading never
re-celebrates), and `renderFinishedGame` then renders the app's only `<dialog>`
— a `.podium-dialog` opened with `showModal()` (guarded) that derives its
content at render time from `podiumRows(state.activeGame)`: ascending "Rank 1"
to "Rank 3" groups with every tied player included and empty rank groups
omitted, tokens/rows/aria-labels reusing the accepted conventions, and a
decorative `aria-hidden` confetti layer of 14 deterministic pieces animated
by one CSS `@keyframes` rule (single iteration, ends invisible) that a
`prefers-reduced-motion: reduce` rule suppresses with `display: none`. The
dialog is labelled (`aria-labelledby`) and described (`aria-describedby`),
opens with focus on its Close button, and dismisses through the Close button,
Escape (native `cancel`, prevented and routed through the shared path), or a
backdrop click (`event.target === dialog`) — all funneling into one
idempotent cleanup that clears the flag, re-renders the finished view without
the dialog, and returns focus to the game heading. Because Chrome dispatches
the dialog `close` event as a queued task that can be delayed (and starved on
hidden pages), dismissal cleanup does not depend on that event alone; the
`close` listener remains as the idempotent fallback. The celebration writes
nothing: opening and dismissing trigger no save, and the stored payload stays
byte-identical.

The top navigation is the app's display/state-only shell layer. `index.html`
renders a static app bar on every screen — brand block (marker dots, "Game
night", the accepted eyebrow string) plus a `<nav aria-label="Primary">` of
three `type="button"` items with distinct action ids (`nav-dashboard`,
`nav-new-game`, `nav-active-game`) so they can never collide with the in-view
`data-action` values that code and suites target. `src/main.js` binds those
handlers exactly once at startup: Dashboard reuses the accepted back-home
semantics (view home, transient setup errors cleared) and focuses the home
heading; New Game shows setup as it was left (the scratchpad is not reset) and
focuses the setup heading; Active Game resolves in order (1) an in-memory
`status: "active"` game reopened without a resume round-trip, (2) otherwise
the first `status: "active"` game in `orderSavedGamesForDisplay` order resumed
through the unchanged `handleResume`, (3) otherwise the new `active-empty`
view — the Active Game empty state with its locked copy and a New game button
that reuses the accepted hero transition. `paintNav()` runs inside `render()`
and paints `aria-current="page"` per view (Dashboard on home and on finished
views, New Game on setup, Active Game on an unfinished game or the empty
state). Navigation never writes: no `saveGames` call, no saved-game mutation,
no save trigger; every action moves focus to the destination heading (home,
setup, and empty-state headings carry `tabindex="-1"` plus
`data-home-heading`/`data-setup-heading`/`data-active-empty-heading`).

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
- `npm run test`: runs roster, standings, score, game, and storage unit checks, HTTP
  smoke checks, and Chrome browser interaction checks for the roster, scoring,
  leaderboard, undo, save/resume, storage-failure, finish-game, podium, replay,
  and design-system flows.
- `./init.sh` and `CI=true ./init.sh`: run the standard non-blocking gate and
  exit without starting the development server.

## Source layout

- `index.html`: semantic shell (static app bar with the primary navigation,
  font links) and app mount point.
- `src/main.js`: renders home/setup/active views (with the read-only finished
  variant, its Play again control, the podium celebration modal, and the
  `active-empty` Active Game destination empty state), binds the one-time top
  navigation handlers and paints `aria-current` per view, handles
  form events, and wires score entry, selection, live totals, feedback, the
  undo-last-score control, the finish-game confirmation, the home Finished
  games list, the storage-health notices with the write-safety rule, the
  dismissible podium dialog with confetti, and the `beforeinput` entry guard
  that keeps the score field to plain signed-integer drafts.
- `src/roster.js`: roster limits, colors, validation, identities, and zero-score game creation.
- `src/score.js`: score-change bounds, plain signed integer parsing (the
  `isPlainScoreDraft` entry pattern and the final plain-format gate in
  `parseScoreAmount`), safe-integer guarded application, latest-change undo,
  and the in-memory change log.
- `src/standings.js`: pure leaderboard ranking: descending totals, shared
  competition ranks, and deterministic creation-order ties via `player.order`,
  plus the podium-eligibility filter `podiumRows` (every rank ≤ 3 row, ties
  never collapsed).
- `src/game.js`: pure game lifecycle: the one-way `finishGame` transition from
  `active` to `finished` with `missing-game`/`already-finished` guards and no
  mutation or extra fields, and the `replayGame` transition that turns a
  finished game into a brand-new active game through the roster path with
  `missing-game`/`not-finished`/`invalid-roster` guards and presentation-only
  copying.
- `src/storage.js`: pure single-key local-storage persistence: versioned
  envelope load/save with injectable storage, result-code errors, per-entry
  crash guard with `droppedCount` reporting, upsert by id, and
  most-recently-updated display ordering.
- `src/styles.css`: v2 design-token layer (colors, type scale, radius, spacing,
  shadows translated from the token file), layout, responsive rules, focus
  styles, and reduced-motion defaults.
- `scripts/static-server.mjs`: small Node HTTP static-file server shared by the
  dev server and smoke check. It serves only the explicit public shell files
  needed by the app and does not expose repository documents, metadata, dotfiles,
  or arbitrary paths under the project root.
- `scripts/serve.mjs`: long-running local server for manual browser use.
- `scripts/smoke.mjs`: non-blocking HTTP smoke check for the baseline shell.
- `scripts/roster-test.mjs`: pure roster behavior checks.
- `scripts/standings-test.mjs`: pure leaderboard ranking checks.
- `scripts/score-test.mjs`: pure scoring behavior checks.
- `scripts/game-test.mjs`: pure game-lifecycle (finishGame and replayGame) checks.
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
- `scripts/browser-finish-game-test.mjs`: desktop/mobile finishing checks —
  the cancel/confirm prompt with focus moves, the locked read-only standings,
  the podium opening on confirm and dismissing back to the heading, no
  re-celebration on reopen, persistence and reload/reopen with identical final
  ranks and totals, the home Finished games panel, finishing under blocked
  writes and invalid-read suppression, and 320px/keyboard checks — using
  isolated headless Chrome.
- `scripts/browser-podium-test.mjs`: desktop/mobile podium celebration checks —
  tie eligibility (1,1,3 and 20 tied players in one scrolling group), rank-4
  exclusion, the Close/Escape/backdrop/Space/Enter dismissal paths with focus
  return and no re-celebration on reopen, byte-identical payloads across
  open/dismiss including under blocked writes and invalid-read suppression,
  reduced-motion confetti suppression via emulated media, and 320px overflow,
  target, and keyboard checks — using isolated headless Chrome.
- `scripts/browser-play-again-test.mjs`: desktop/mobile replay checks — the
  full MVP loop through replay with presentation-only copying and zero
  totals/no undo history, separate stored games with distinct
  `replay-game-*` ids and a byte-identical finished original across replay
  and replay-game scoring, independent home listings after reload, repeated
  replays from reopened finished games, the polite invalid-roster refusal,
  blocked-write honesty with the accepted notice, and 320px/keyboard/focus
  checks — using isolated headless Chrome.
- `scripts/browser-design-system-test.mjs`: desktop/mobile visual-system
  checks — blocked-font fallback with the declared stack, hierarchy, and
  tabular numerals; per-view token and layout assertions at 1280×800 and
  320×720 (ivory canvas, cool cards, primary/tertiary/error mappings, panel
  stacking, zero overflow); the nav behavior matrix (labels, `aria-current`
  per view, focus-to-heading, the Active Game resolution order, byte-identical
  storage across navigation); ≥44px targets; the skip link; and reduced-motion
  plus storage-notice regressions — using isolated headless Chrome.

## Boundaries

The app creates an active game with named players and zero totals. It accepts
signed integer score changes on one player, records an in-memory change log,
renders a live leaderboard with descending totals, shared competition ranks,
and creation-order ties, and reverses the latest change on demand: each undo
pops the newest log entry, restores that recipient's total, and lets ranks
re-derive at render time. Ranks exist only while rendering; no rank is
stored or logged. Repeated undo walks backward until the log is empty; an
empty log is an announced no-op. Undo never touches `game.status`.

Score entry is guarded at both layers so only plain signed integers can be
entered and saved. A `beforeinput` listener on `#score-amount` computes the
prospective value of every insertion (falling back to the inserted data alone
on inputs without a selection API) and cancels anything that is not a plain
signed-integer draft — letters such as `e` never enter the field by typing,
paste, drop, or IME, while deletions, undo/redo insertions, and data-less
insertions are never blocked and blocked characters stay silent. The same
contract is enforced at save: `parseScoreAmount`'s plain-format gate rejects
scientific notation and other exact-integer non-plain text with the existing
`not-a-number` message, so `1e3` (and equivalents) are unsavable through any
path. No value is ever silently rewritten; a transient decimal such as `2.5`
still reaches the save-side decimals message exactly as accepted.

Every successful game mutation (starting a game, saving points, a successful
undo, confirming Finish game, and replaying a finished game) persists the
active game — players, totals, and the full change log — under the single
versioned `scorekeeper:games` key,
and the home screen lists saved games most-recently-updated first: active
games with Resume controls under "Unfinished games", finished games with View
results controls under "Finished games". Reloads therefore keep unfinished
games and their undo history; a successful undo persists the shortened log,
so undone changes never reappear. Storage read/write failures never throw and
log code-only diagnostics; user-facing failure feedback is a polite status
notice on home and in the active game, failed writes roll back the in-memory
upsert so no unsaved game is shown as saved, and an unreadable stored payload
suppresses all writes for the session so it is never overwritten.

Finishing is the one-way lifecycle boundary. `finishGame` is the only code
that sets `status: "finished"`; it accepts only active games, returns a new
object without touching players, totals, the change log, or any field beyond
`status`, and there is no un-finish. A finished game renders as the read-only
variant of the active view — full final standings with render-time ranks, a
`role="status"` explanation, and zero score mutation controls — and reopening
one from home restores exactly those guarantees. Storage-suppression
interplay is unchanged: finishing still proceeds in memory when writes are
suppressed or fail, and no phantom finished card can appear on home. The
podium celebration sits on top of that finished view as a display-only modal:
it opens only on a successful confirm-finish (including under storage
failures), shows every rank ≤ 3 player with ties never collapsed, dismisses
back to the heading without changing anything, and never reopens on a mere
revisit.

Replay closes the loop: the finished view's "Play again" control calls
`replayGame`, which builds a brand-new active game through the roster path
with game-scoped `replay-game-*` identities and copies only presentation —
title, names, colors, markers, and creation order — while totals restart at
zero and no change log or `updatedAt` carries over. The handler mirrors the
resume pattern (slot replacement with transient-flag resets, then
`persistActiveGameSnapshot()` as the fifth save trigger, then a render that
lands in the scoring view with focus on the heading), leaves the finished
original stored byte-identically and listed under "Finished games", and shows
the replay under "Unfinished games". Guard failures
(`missing-game`/`not-finished`/`invalid-roster`) create nothing and surface
through the polite `#replay-feedback` region with code-only console
diagnostics instead of silent no-ops, and the control lives only on the
finished view — never inside the podium dialog or on home cards. Saved-game
deletion remains a separate feature.

The top navigation sits above all of this as a pure view layer: it changes
`state.view`, repaints `aria-current`, and moves focus — nothing else. Its
Active Game destination reuses the existing resume path rather than adding a
second one, and its empty state is a new render branch (`active-empty`) that
renders no game data and writes nothing. The visual system is paint-only by
contract: selectors, ids, `data-*` attributes, grid areas, copy, and the
storage envelope are stable across the restyle, which is what lets every
pre-existing suite pass unmodified.
