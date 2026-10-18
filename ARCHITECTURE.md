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
roster validation and game creation helpers plus the `playerNumbers(game)`
display derivation: a `Map` keyed by `player.id` → the player's 1-based
position in `game.players` (the setup order), with guards returning an empty
`Map` for non-object games and non-array players and non-object player
entries skipped without consuming a position. `src/score.js` contains pure
scoring helpers: signed integer parsing restricted to plain signed integer
text — `parseScoreAmount` runs a final plain-format gate after the
finite/integer/zero/range checks, so exact-integer non-plain text such as
`1e3`, `0x10`, or `10.` returns the existing `not-a-number` code instead of
saving — plus `applyScoreChange`, which updates
one player's total and appends `{ id, playerId, amount, at }` to the in-memory
`game.changes` log (each entry stamped `at: now.toISOString()` from the
injectable clock, so per-entry ages survive reloads), `undoLastScoreChange`,
which pops the newest log entry, restores that player's total, and returns a
new game object without mutating the input, and `recentScoreChanges`, the pure
view behind the Recent entries panel: the newest `RECENT_ENTRIES_LIMIT` (8)
changes as `{ change, player }` pairs, newest first, skipping entries whose
`playerId` resolves to no player, never mutating its input.
`src/standings.js` contains the pure ranking helpers
`rankPlayers(game)`, which derives competition ranks (`1 +` the count of
strictly higher totals, so ties share a rank) in descending total order with
creation-order ties, `podiumRows(game)`, which filters that ranking to
every row with rank ≤ 3 without collapsing ties or mutating its input, and
`scoreDistribution(game)`, the pure view behind the active leaderboard's score
distribution block: it returns `{ gameTotal, rows }` where `gameTotal` is the
signed sum of all finite player totals and `rows` lists one
`{ player, percent }` pair per positive-total player in `rankPlayers` display
order. Shares use the sum of positive totals as the denominator (never the
signed game total, so percentages cannot exceed 100 even in mixed-sign games)
and round by largest remainder (Hamilton) — floors first, then leftover units
handed to the biggest fractional remainders with ties topped up in display
order — so the displayed integers always sum to exactly 100. Zero and negative
totals are omitted; a positive-total player rounding to 0% keeps its row so
segments and legend stay 1:1; `rows` is empty whenever `gameTotal <= 0`;
guards return `{ gameTotal: 0, rows: [] }` for non-object games and
non-array players; the input is never mutated and each call returns a fresh
array.
`src/main.js` calls all three at render time only; no rank, share, or
distribution field is stored on players, games, or the change log.

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
successful game mutation (start, save points, undo, finish, rename, replay),
renders
the home "Unfinished games" list from the active saved games and the
"Finished games" list from the finished ones, and resumes a saved game by
restoring it as the active game — so undo works immediately after a reload,
undone changes never resurrect, and finished games reopen read-only. Ranks
stay render-time only and are never persisted.

`src/game.js` contains the pure game-lifecycle transitions and the title
contract. `finishGame` is
the one-way `active → finished` change: it accepts only a `status: "active"`
game (guarding `missing-game` and `already-finished`), returns a new game
object with only `status` changed, never mutates its input, and stores no
ranks, timestamps, or other new fields. `replayGame` is the replay
transition: it accepts only a `status: "finished"` game (guarding
`missing-game`, `not-finished`, and roster validation through `invalid-roster`),
maps the finished roster back to roster rows, and calls `createGame` with the
`replay-game` id seed — so every game and player identity is structurally new
(`replay-game-*` ids can never collide with setup-created `active-game-*`
ids). It copies only presentation (names, colors, markers, and the
creation order, restoring atypical-but-valid stored values literally with
regenerated fallbacks) while every total restarts at zero and no change log,
`updatedAt`, or title carries over — replays always start untitled
(`title: ""`); the input game is never mutated. `renameGame` is the one pure
title mutation: it accepts only an active game (any other status reports
`already-finished` — finished titles are frozen), rejects non-string titles
(`invalid-title`) and trimmed titles over `MAX_TITLE_LENGTH` (60) characters
(`title-too-long`), and returns a new game object with the trimmed title
(`""` when blank after trimming) without mutating its input.
`displayGameTitle(game)` is the display helper every title surface calls: it
returns the stored title verbatim (never re-trimmed or rewritten) when it is
a string with non-whitespace content, otherwise the deterministic
`Game — {d MMM, HH:mm}` auto-label derived from `createdAt` in local time
(short English months, 24-hour clock, no locale-dependent formatting), or
plain `Game` when the timestamp is missing or unparseable — a render-time
value that is never stored. `formatRelativeTimestamp(value, now = new Date())`
is the one deterministic relative-time formatter for activity stamps: under a
minute (including future clock skew) renders `just now`, then floored
`{m}m ago` / `{h}h ago` / `{d}d ago` buckets up to seven days, then the same
absolute `d MMM, HH:mm` stamp the auto-label uses; non-string or unparseable
input returns `null` so callers pick their own fallback. `src/main.js`
uses it for the dashboard cards' `Updated {token}` recency label
(`updatedAt` → `createdAt` → the bare `Updated` fallback) and for the Recent
entries panel's time cells, which render the token with an initial capital or
a muted `—` when an entry predates the per-change `at` stamp. The panel
itself (`renderRecentEntries`) is a display-only block inside the active
view's score panel between the score form and the finish section: an eyebrow
header with the `Last: {name} {signedAmount}` undo-context line and an
`aria-label="Recent entries"` list of newest-first rows (player token,
escaped name, signed `{+|-}{amount} pts`, relative time). It has no
interactive controls and no live region of its own — undo derives for free
because the popped change stops rendering — and finished views render no
panel. `src/main.js`
renders a `status: "finished"` game as a read-only variant of the active view
— same header (eyebrow "Finished"), back control, storage notice, and full
render-time-ranked leaderboard, but with a polite `role="status"` note and
none of the score mutation controls (no Add points buttons, no score-entry
panel, no undo) — plus the finished view's only mutation control, a "Play
again" primary action below the standings with its own polite
`#replay-feedback` live region for guard messages. The unfinished active
header additionally offers **Edit title** beside the heading
(`data-action="open-title-edit"`, ≥44px): activating it swaps the heading and
the control for an inline labeled form (`.title-edit-form` with
`#active-title-input`, `maxlength=60`, prefilled with the raw stored title —
never the auto-label — and a polite `#title-edit-feedback` live region) where
Save title/Enter runs `renameGame` and Cancel/Escape closes without writing;
saving persists through `persistActiveGameSnapshot()`, so renaming is the
sixth successful-mutation save trigger under the storage-failure rules, guard
failures repaint the feedback region without re-rendering, and the edit
state resets exactly where the other transient flags reset. Confirming the inline
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
content at render time from `podiumRows(state.activeGame)`: a muted
`.podium-game-title` line showing `displayGameTitle(game)` as the first
content element (before the suite-frozen "Final podium" title), ascending "Rank 1"
to "Rank 3" groups with every tied player included and empty rank groups
omitted, tokens/rows/aria-labels reusing the accepted conventions, and a
decorative `aria-hidden` confetti layer of 14 deterministic pieces animated
by one CSS `@keyframes` rule (single iteration, ends invisible) that a
`prefers-reduced-motion: reduce` rule suppresses with `display: none`. The
dialog is labelled (`aria-labelledby`) and described (`aria-describedby`),
opens with focus on its dismiss control, and dismisses through that control
("Close & view full standings", `close-podium`), Escape (native `cancel`,
prevented and routed through the shared path), or a backdrop click
(`event.target === dialog`) — all funneling into one idempotent cleanup that
clears the flag, re-renders the finished view without the dialog, and returns
focus to the game heading. Because Chrome dispatches the dialog `close` event
as a queued task that can be delayed (and starved on hidden pages), dismissal
cleanup does not depend on that event alone; the `close` listener remains as
the idempotent fallback that ignores events delivered for a detached dialog.
Since `extend-podium-actions` the podium body ends in a three-action block
(`.podium-actions`): the full-width primary **Play again (same players, reset
scores)** (`podium-play-again`) above a `.podium-actions-row` grid of the two
secondary exits — the unchanged `close-podium` hook and `podium-exit-dashboard`
— which stack full width at ≤480px. The primary's wrapper guards on
`state.podiumOpen`, closes the live dialog, and delegates to the unchanged
`handlePlayAgain()` (its queued `close` event is ignored by the detached-dialog
guard once the replay re-render replaces the dialog — the Scenario 6
two-podium stale-close protection). `handlePodiumExitDashboard()` mirrors the
accepted active-view back-home reset verbatim and lands focus on
`[data-home-heading]`; it is pure navigation and never writes. The celebration
writes nothing: opening, dismissing, and exiting trigger no save, and the
stored payload stays byte-identical.

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
  design-system, game-title, game-activity, quick-score, player-number,
  score-distribution, and podium-actions flows.
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
  dismissible podium dialog with confetti, the inline active-header title
  edit form with its save trigger, the `beforeinput` entry guard
  that keeps the score field to plain signed-integer drafts, the quick tap
  counters and the signed stepper (a new UI entry into the existing score-save
  trigger, with the stepper staging the draft), the dashboard
   cards' deterministic `Updated {token}` recency label, the display-only
   Recent entries panel in the active score panel, the player-number
   badge wiring (each numbered surface derives `playerNumbers(game)` once per
   render and threads the numbers into its row/card renderers), and the
   score-distribution block (the active leaderboard derives
   `scoreDistribution(game)` once per render and emits the caption, bar, and
   legend after the standings rows), and the three podium exit actions
   (`podium-play-again` delegating to the unchanged `handlePlayAgain` after a
   guarded `dialog.close()`, the unchanged `close-podium` dismiss funnel, and
   `handlePodiumExitDashboard()` as a write-free back-home navigation).
- `src/roster.js`: roster limits, colors, validation, identities, and
  zero-score game creation with the trimmed optional title (`""` when blank
  or non-string) and the `MAX_TITLE_LENGTH` cap, plus the `playerNumbers`
  positional badge derivation (pure, id-keyed, render-time only).
- `src/score.js`: score-change bounds, plain signed integer parsing (the
  `isPlainScoreDraft` entry pattern and the final plain-format gate in
  `parseScoreAmount`), safe-integer guarded application, per-change `at`
  stamps from the injectable clock, latest-change undo, the in-memory change
  log, and the `recentScoreChanges` panel view with `RECENT_ENTRIES_LIMIT`.
- `src/standings.js`: pure leaderboard ranking: descending totals, shared
  competition ranks, and deterministic creation-order ties via `player.order`,
  the podium-eligibility filter `podiumRows` (every rank ≤ 3 row, ties
  never collapsed), and the score-distribution derivation `scoreDistribution`
  (positive-total rows in display order, largest-remainder integer percents
  over the positive-total sum, signed `gameTotal`, guards, no mutation).
- `src/game.js`: pure game lifecycle: the one-way `finishGame` transition from
  `active` to `finished` with `missing-game`/`already-finished` guards and no
  mutation or extra fields, the `replayGame` transition that turns a finished
  game into a brand-new untitled active game through the roster path with
  `missing-game`/`not-finished`/`invalid-roster` guards and presentation-only
  copying, the `renameGame` title mutation with
  `missing-game`/`already-finished`/`invalid-title`/`title-too-long` guards,
  and the `displayGameTitle` render-time label helper (verbatim stored title,
  deterministic `Game — {d MMM, HH:mm}` auto-label, plain `Game` fallback)
  plus the `formatRelativeTimestamp` relative-time formatter used by the
  activity surfaces (locked thresholds, absolute branch shared with the
  auto-label).
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
  exclusion, the Close/Escape/backdrop/Space dismissal paths with focus
  return and no re-celebration on reopen, byte-identical payloads across
  open/dismiss including under blocked writes and invalid-read suppression,
  reduced-motion confetti suppression via emulated media, and 320px overflow,
  target, and keyboard checks (the Tab walk updated by extend-podium-actions
  for the three focusable actions) — using isolated headless Chrome.
- `scripts/browser-podium-actions-test.mjs`: desktop/mobile podium exit-action
  checks — the three-action contract (exact labels as accessible names,
  `type="button"`, DOM order, full-width primary over a side-by-side
  secondary row that stacks at 320px, ≥44px targets, initial focus on the
  dismiss control, frozen copy/tokens/confetti, byte-identical payload while
  open); the close hook (click, Enter, Escape, real backdrop click, Space)
  landing on the read-only standings with heading focus and byte-identical
  storage; Save & exit as pure navigation (home heading focus, `aria-current`
  Dashboard, Finished-games listing, write-absence byte-identity, no phantom
  cards, no re-celebration on reopen, 320px Tab+Enter real-key walk); podium
  Play again delegating to the unchanged replay flow (untitled zero-score
  `replay-game-*` entry, byte-identical original across replay and scoring,
  reload listing separation) plus the two-podium stale-close guard; zero
  uncaught console errors — using isolated headless Chrome.
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
- `scripts/browser-game-title-test.mjs`: desktop/mobile game-title checks —
  the empty-default setup field with its label/placeholder/cap and
  preserve/reset transitions, titled and blank games end to end (verbatim
  labels on headers/cards/accessible names/podium, stored `""` for blanks,
  deterministic auto-label format and reload stability with byte-identical
  storage), the inline edit form (open/focus, Enter/Save persistence with a
  fresh `updatedAt`, Cancel/Escape byte-identity, clear-to-blank), blocked
  writes with the unchanged notice and in-memory rename, frozen finished
  titles with no edit control, untitled replays with a byte-identical
  original, verbatim pre-feature records, and the 320px/keyboard baseline —
  using isolated headless Chrome.
- `scripts/browser-game-activity-test.mjs`: desktop/mobile activity-timestamp
  and recent-entries checks — UI-scored entries rendering newest first with
  the `Last:` header and per-entry `at` stamps, reload/resume persistence with
  byte-identical storage, seeded-stamp sessions asserting exact
  `Just now`/`10m ago`/`3h ago`/`2d ago`/absolute tokens and the
  `Updated {token}` card chain (createdAt fallback, bare `Updated`), the cap
  at 8 rows with skipped ghost entries, legacy no-`at` rows degrading to
  muted `—`, undo derivation with fresh `updatedAt` and byte-identical no-op
  undos, blocked-write undo with the unchanged notice, frozen finished stamps
  with no finished panel and a byte-identical replay original, and the
   320×720/1280×800 overflow, focusable-count, frozen `--muted`, AA contrast,
   and zero-console-error baseline — using isolated headless Chrome.
- `scripts/browser-quick-score-test.mjs`: desktop/mobile quick-entry checks —
   every preset counter applying immediately through the ordinary save path
   with the exact accepted messages, cleared drafts, `Last:` context, envelope
   version 1, and focus returned to the pressed counter; undo walking counter
   changes back like any other change with a byte-identical no-op; the stepper
   staging from a 0 baseline with plain-integer clamped output and
   byte-identical no-save proof plus an ordinary stepped-draft save and the
   exact zero message; counters discarding typed drafts without summing; the
   ≥44px targets, Decision 6 accessible names, group label, Decision 6 tab
   order, and real-key Enter repeat-press walk at 320×720 and 1280×800; and
   blocked-write in-memory applies with the unchanged notice plus zero
   counters/stepper in finished and active-empty views — using isolated
   headless Chrome.
- `scripts/browser-player-numbers-test.mjs`: desktop/mobile player-number
   badge checks — positional setup rows that renumber on removal with the
   accepted positional labels; badges 1..N in setup order on the leaderboard,
   score card (token, name, and the visible muted `Player {n}` subtitle),
   recent entries, podium, and finished standings; rank/badge independence
   (12/12/8 → ranks 1,1,3 with badges 1,2,3, and a reordering save moving rows
   while badges follow players); reload/resume stability and 1..N replay
   renumbering with the stored marker field still written exactly as
   accepted; a seeded `marker: "7"` record and a missing marker degrading to
   truthful positional numbers with a byte-identical payload; and the
   320×720/1280×800 label/visibility/target/focus/overflow baseline — using
   isolated headless Chrome.
- `scripts/browser-score-distribution-test.mjs`: desktop/mobile score-distribution
   checks — the UI-scored happy path reproducing the mockup shares (42/35/28/19
   → 34/28/23/15 of 124) with segment widths equal to legend percents (±1px) in
   exact token colors, live re-derivation on save/undo/reorder/selection with
   byte-identical payloads and unchanged stored player keys; seeded rounding
   edges (2/2/2/1/1/1 → 23/22/22/11/11/11, 1/1/1 → 34/33/33), mixed-sign
   positive-only shares (10/−5/3 → 77/23 under the signed "8" caption),
   zero-player omission, and the degenerate all-zero/net-zero/negative captions
   with the locked empty line; finished/podium/home/setup/active-empty
   exclusion; and the 320×720/1280×800 overflow, legend-wrap, width↔percent,
   zero-focusable, aria-hidden-bar, frozen-`--muted` AA-contrast, and
   zero-console-error baseline — using isolated headless Chrome.

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

Quick entry is two input conveniences over the same path, never a second
pipeline. The seven quick tap counters (a locked local preset list) overwrite
the draft with their signed amount and call the unchanged `handleScoreSubmit`
— which only gained a returned success boolean — so a tap passes the identical
parse gate, persists through `persistActiveGameSnapshot()` (still exactly six
call sites: a counter is a new UI entry into the score-save trigger, not a
seventh trigger), and inherits every accepted message, the undo semantics, the
recent-entries derivation, and the storage rules verbatim; on success focus
returns to the pressed counter, on rejection the accepted input focus stays.
The − / + stepper is a pure draft edit: it reads the numeric draft (0 baseline
for empty or unparseable drafts — a `type="number"` input sanitizes transient
shapes like `12.` or a lone sign to `""`), writes plain integer text clamped to
±`MAX_SCORE_ABS`, and never saves, re-renders, or paints feedback, so the
stored payload stays byte-identical across any number of steps; the stepped
draft then saves as one ordinary change.

Every successful game mutation (starting a game, saving points, a successful
undo, confirming Finish game, renaming the active game, and replaying a
finished game) persists the
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
revisit. The `close`-event fallback listener ignores events delivered for a
dialog that has already left the DOM: Chrome queues `close` as a task that can
arrive late on hidden pages, and a stale event from a dismissed podium must
never clobber a later podium's open state (finish → dismiss → replay → finish
again).

Replay closes the loop: the finished view's "Play again" control calls
`replayGame`, which builds a brand-new active game through the roster path
with game-scoped `replay-game-*` identities and copies only presentation —
names, colors, markers, and creation order — while totals restart at
zero, no change log or `updatedAt` carries over, and the title is never
copied (the rematch starts untitled and displays the auto-label until it is
renamed). The handler mirrors the
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

Titles are a display-only layer over the same game objects: the game `id`
never derives from the title, stored title text renders verbatim (never
re-trimmed or rewritten), the auto-label is computed at render time and never
stored or written into any input, `renameGame` is the only title mutation
(active games only, frozen once finished), the unfinished active header is
the only edit point, and the setup/edit fields always carry raw user text.

Activity is a view over already-stored data with no parallel state.
Last-activity is the storage-owned `updatedAt` stamped by
`upsertSavedGame` on every successful mutation persist, so the six save
triggers (start, score save, undo, finish, rename, replay) are exactly the
activity set — navigation, resume, prompt open/cancel, selection, and failed
writes never refresh it, and a finished game's stamp freezes at its finish
persist (replay never re-persists the original). Per-change `at` ISO stamps
from `applyScoreChange`'s injectable clock are the only new stored shape:
they date individual entries so relative times survive reloads, while legacy
entries without `at` keep working and render a muted `—`. All recency
rendering funnels through `formatRelativeTimestamp` (no locale APIs), and
the Recent entries panel is pure display over `recentScoreChanges` — capped,
newest first, zero interactive controls, no extra live region.

Player numbers are a pure display derivation, never identity or a scoring
input. `playerNumbers(game)` maps each `player.id` to the player's 1-based
position in `game.players` (the setup order — stable for the game's life,
since no accepted code path reorders the roster after game start), and every
numbered surface derives the map once per render and threads numbers into
its renderers: leaderboard rows, the finished standings, the podium, the
recent-entries rows, and the score-entry card (which additionally shows the
visible muted `Player {n}` subtitle beside the name). Badges never replace
rank digits, and the frozen `{name}: rank {rank}, total {total}` labels are
untouched. The stored `marker` field stays written exactly as accepted
(`createGame` and `replayGame` are untouched) but renderers no longer read
it, so corrupt or missing stored markers degrade to the truthful positional
number instead of surfacing "7" or "undefined"; nothing about the badge
writes storage.

Score distribution is a derived-only view over the same totals, never a
stored shape. `scoreDistribution(game)` recomputes `{ gameTotal, rows }` on
every render of the active leaderboard — saves, undoes, reorders, selection,
resume, and reloads re-derive it for free with zero new save triggers, zero
persisted fields, and byte-identical payloads across non-mutating renders —
and only the active view's roster panel renders the block (finished games,
the podium, home, setup, and the active-empty state render nothing). The
caption ("Score distribution" + the signed "{N} total game points") always
renders; the bar and legend render only while the game total is positive,
sharing out the positive totals so the displayed integers always sum to
exactly 100 and the bar's implicit leader is always the leaderboard's rank 1
(never a penalized player promoted by absolute values). Segment widths are
the integer percents exactly, legend text carries every eligible player's
name and percent as real text beside an aria-hidden color dot, the bar is
`aria-hidden`, and the block contains no focusable elements and no live
region of its own — `#score-feedback` remains the sole announcer for saves
and undoes.
