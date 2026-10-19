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
- Game titles are display-only: game identity is the game `id`, never the
  title. `createGame` stores the trimmed optional title verbatim (possibly
  `""`; non-string input stores `""`) and never substitutes a fallback title.
  `renameGame` in `src/game.js` is the only title mutation: it accepts only
  games whose `status` is `active` (any non-active status reports
  `already-finished` before the title itself is validated — finished titles
  are frozen), reports `invalid-title` for non-string titles and
  `title-too-long` for trimmed titles over 60 characters, returns a new game
  object without mutating its input, and the unfinished active header is the
  only edit point (no edit control on finished views, home cards, or the
  podium). The auto-label (`Game — {d MMM, HH:mm}` derived from `createdAt`
  in local time with short English months and a 24-hour clock, or plain
  `Game` when the timestamp is missing or unparseable) is derived at render
  time by `displayGameTitle`, is never stored, never written into any input,
  and never rewritten: stored title text renders verbatim without
  re-trimming, and renaming persists through `persistActiveGameSnapshot()`
  as the sixth successful-mutation save trigger under the storage-failure
  rules. Replays always start untitled (`title: ""`) — the original title is
  never copied.
- Use blue, red, yellow, green, orange, white, or black markers. Duplicate names
  and colors are allowed; player IDs must be independent of both.
- Player number badges are a render-time display aid, never identity, never a
  scoring input, and never persisted anew: `playerNumbers(game)` in
  `src/roster.js` derives each badge from the player's 1-based position in
  `game.players` (the setup order, stable for the game's life) as an
  id-keyed `Map` built once per surface render, and no code path may store a
  badge number, reorder the roster to change badges, or add a save trigger.
  Badges must never replace or reposition rank digits, and the frozen
  `{name}: rank {rank}, total {total}` total labels stay rank-bearing. The
  stored `marker` field stays written exactly as accepted (by `createGame`
  and `replayGame`) but is presentation-unused: renderers must derive badges
  positionally so corrupt or missing stored markers degrade to the truthful
  number. Setup rows stay positional (removal renumbers the remaining
  draft), and every numbered token's accessible name reads
  `Player {n}, {color}` with the visible name kept beside the badge; home
  cards keep their unnumbered aria-hidden color dots.
- Every new player starts at zero.
- Game mutations persist to the browser's local storage under the single
  versioned key `scorekeeper:games` as a `{ version: 1, games: [...] }`
  envelope. Each saved game is the in-memory game object verbatim — roster,
  totals, and the full `{ id, playerId, amount }` change log — plus one
  storage-owned `updatedAt` ISO stamp written only on the stored copy. Saves
  happen exactly on successful game mutations (starting a game, saving
  points, a successful undo, confirming Finish game, replaying a finished
  game, and renaming the active game); failed validations, selection changes,
  feedback-only repaints, and no-op undos never write. Never persist rank
  fields, and never remove saved games in a slice that has no delete feature.
  Resume restores the saved game verbatim as the active game, so undo works
  immediately and a successful undo persists the shortened log — undone
  changes must never reappear after a reload.
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
  `{ id, playerId, amount, at }` to the in-memory `game.changes` log.
- Game activity must derive only from already-stored data — no parallel
  state: last-activity is the storage-owned `updatedAt` (the six save
  triggers are exactly the activity set; navigation, resume, prompt
  open/cancel, player selection, and failed writes never write), and each new
  change entry must carry an `at` ISO string from `applyScoreChange`'s
  injectable `now` so per-entry ages survive reloads. Relative-time rendering
  must stay deterministic with no locale APIs: `formatRelativeTimestamp`
  locks the thresholds (`just now` under a minute including future skew,
  floored `m`/`h`/`d` buckets, then the shared `d MMM, HH:mm` absolute
  stamp ≥ 7 days) and returns `null` for unusable input. Missing or corrupt
  stamps degrade instead of failing: cards walk `updatedAt` → `createdAt` →
  the bare `Updated` fallback, legacy entries without `at` render a muted
  `—` time cell, and nothing rewrites the stored payload on load. Finished
  stamps freeze at the finish persist; replay must never re-persist the
  original. The Recent entries panel is display-only over
  `recentScoreChanges` (cap `RECENT_ENTRIES_LIMIT = 5`, newest first,
  unresolvable players skipped, no interactive controls, no new live
  region), renders only in the active view's score panel as its last block,
  and its header `Last: {name} {signedAmount}` must always show the sign
  character (never color alone). The full change log stays persisted.
- The score field must accept only plain signed-integer text, guarded at both
  layers: a `beforeinput` guard on `#score-amount` must cancel every insertion
  whose prospective value is not a plain signed-integer draft (letters such as
  `e` can never be typed, pasted, dropped, or IME-inserted), must never block
  deletion/undo/redo types or data-less insertions, must stay silent about
  blocked characters, and must never rewrite the value — a transient decimal
  like `2.5` stays typable so the save-side decimals message still applies.
  `parseScoreAmount` must accept only plain signed integer text: its
  plain-format gate runs after the finite/integer/zero/range checks so every
  existing error mapping is preserved (`1e-3` → not-integer, `0.0` → zero,
  `1e30` → out-of-range), and scientific notation such as `1e3` — superseding
  the documented add-player-score semantic-parse decision — is unsavable
  through any path.
- Quick entry controls (the mocked-up refinement supersedes immediate counter
  apply) stage one shared points draft, never a second pipeline and never new
  state or storage. Custom keeps the mockup's seven (+1, +5, +10, +25, −1, −5,
  −10); preset games render their fixed `game-presets` catalogue actions
  instead (Flip 7 adds a draft-only ×2; Catan, 7 Wonders, and Yahtzee render
  positive-only sets; Ticket to Ride keeps the signed seven minus the ±1
  pair per its catalogue). Both adds and the − / + stepper call one
  `applyDraftDelta(delta)` helper that reads `#score-amount` with
  `parseInt` (0 baseline for empty/unparseable drafts), applies the preset
  floor (0 for non-negative presets, so a typed negative baseline is treated as
  0 for the next step/action), adds the delta, clamps, and writes plain
  integer text. `handleMultiplyDraft(factor)` only multiplies the current draft
  (same read/floor/clamp rules), never adds to a total, renders, saves, or
  moves focus. A tap, step, or ×2 must never render, paint feedback, re-rank,
  log a recent entry, or save; focus must stay on the pressed control. Save
  points then applies the combined draft through the unchanged
  `handleScoreSubmit` as exactly one ordinary change (one change-log entry,
  one `persistActiveGameSnapshot()` save — still exactly six call sites),
  inheriting the accepted messages, undo semantics, and storage rules. Counter
  controls must never submit the form (`type="button"`) and must expose
  `Add {n} point(s) to the points draft for {name}` (signed amount, correct
  pluralization); visible `+1 … -10` labels stay unchanged, and the multiplier
  is labeled `×2` with accessible name
  `Double the points draft for {name}`.
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
  `window.confirm`). The opener lives in the active header; opening it removes
  the header opener and renders the unchanged confirmation below the header
  and above the leaderboard panel inside `.active-board`, preserving
  `data-action="open-finish"`, `confirm-finish`, `cancel-finish`,
  `id="finish-warning"`, `data-finish-section`, the exact copy,
  `aria-describedby="finish-warning"`, open→confirm focus, cancel→opener
  focus, and a usable score form while open. The score panel must contain no
  finish section, and finished views render no finish control. Finishing
  persists through `persistActiveGameSnapshot()` as the fourth
  successful-mutation save trigger, so it obeys the storage-failure rules
  above: under suppression or a failed write the finish still proceeds in
  memory, no phantom finished card may appear on home, and no new failure
  path may be added.
- A game with `status: "finished"` must render read-only: the full final
  standings stay visible with render-time competition ranks and unchanged
  aria-labels, but every score mutation control is absent (no Add points
  buttons, no `aria-pressed` selection, no score-entry panel, no Save points,
  no undo), the read-only explanation is a polite `role="status"` line, and
  reopening a finished game from the home Finished games panel must restore
  exactly the same read-only guarantees. Finished games are listed only in
  the Finished games panel with View results controls; the Unfinished panel
  filter stays `status === "active"`. The finished layout uses the
  `is-finished` single grid track so the standings fill the content width —
  no empty right score-panel column — and finished rows stay inert on click
  (no selection listener, no pointer cursor, no highlight).
- Replaying a finished game must go through `replayGame` in `src/game.js`,
  which builds the rematch through the `createGame` roster path with
  game-scoped identities (the `replay-game` id seed, so replay ids can never
  collide with setup-created `active-game-*` ids) and copies only
  presentation — names, colors, markers, and creation order — never
  totals, the change log, `updatedAt`, or the title (replays start untitled
  with `title: ""`). The input finished game must never
  be mutated, and its stored entry must never be re-persisted: it stays
  byte-identical across the replay and every later mutation of the replay,
  because `upsertSavedGame` keys on the new id. Replay persists through
  `persistActiveGameSnapshot()` as the fifth successful-mutation save
  trigger (starting a game, saving points, a successful undo, confirming
  Finish game, and replaying) and obeys the storage-failure rules above: no
  new failure paths, no phantom cards, code-only diagnostics. The "Play
  again" control lives only on the finished view below the standings —
  never inside the podium dialog or on home cards — replaces the single
  active-game slot exactly like resume (previously viewed games stay stored),
  lands focus on the new game's heading, and guard failures
  (`missing-game`/`not-finished`/`invalid-roster`) create nothing, touch no
  storage, and surface through a polite feedback region instead of silent
  no-ops.
- The podium celebration is display only and must never touch saved data: it
  is derived at render time from `podiumRows` for the ordered steps (every
  player whose competition rank is ≤ 3, ties never collapsed, empty rank
  steps omitted) and from `rankPlayers` for a `.podium-summary` of *every*
  player in ranking order, grouped by competition rank (the ranked cards
  superseded the Rest of the table list; the steps remain the celebration and
  the cards are the full scannable table). Each step renders a visually hidden
  `Rank N` heading, a crown for rank 1, contestant cards with token, readable
  name, raw total and a visible `pts` label, and a pedestal carrying the large
  rank plus exactly `Winner`/`Silver`/`Bronze`. Desktop steps place rank 2
  left, rank 1 center and tallest, rank 3 right on a common bottom baseline
  with 144/96/72px pedestals; at ≤600px they stack in rank order with compact
  pedestals. The exact note "Ties share rank and step position automatically"
  renders between the steps and the summary.
  The dialog opens only on a successful confirm-finish — including under
  storage failure or invalid-read suppression — and never opens when a
  finished game is merely resumed, viewed, or reloaded. Opening and
  dismissing must trigger no write: no `persistActiveGameSnapshot()`, no
  `saveGames` call, no mutation of `state.savedGames`, and no persisted
  podium/celebration fields; the stored payload must stay byte-identical
  across open and dismiss.
- The podium offers exactly three locked product actions after the steps and
  ranked summary, and every action's visible label is its accessible name (no
  `aria-label` override): the full-width primary `podium-play-again` "Play
  again (same players, reset scores)", the `close-podium` dismiss control
  "Close & view full standings" (kept as the dismissal hook), and
  `podium-exit-dashboard` "Save & exit to Dashboard"; all are `type="button"`,
  the two secondaries share one side-by-side row that stacks full width at
  ≤480px, every target is ≥44px, and opening the podium always focuses the
  footer dismiss control without scrolling the dialog away from the top:
  reset `dialog.scrollTop = 0` before and after
  `focus({ preventScroll: true })` so the pill, title, crown, and rank-1 step
  start are visible on open at desktop and narrow sizes. The `Game concluded`
  pill and the 44px corner X
  (`close-podium-corner`, accessible name "Close podium") are not product
  actions: the X is a second dismiss affordance routed through the same
  funnel. The dismiss control, the corner X, Escape, and backdrop clicks
  always land on the read-only standings with focus on the game heading.
  "Save & exit to Dashboard" is
  navigation only — it mirrors the accepted back-home reset and focuses the
  Dashboard heading without ever writing storage — and the podium replay
  action must delegate to the unchanged `handlePlayAgain` (guarded close,
  then replay; the detached-dialog `close` guard keeps a queued close from a
  dismissed podium from clobbering a later one); no podium action may add a
  save trigger or persist a new field.
- Modal dialogs must dismiss reliably without depending on the queued dialog
  `close` event alone: Chrome dispatches `close` asynchronously and can delay
  or starve it on hidden pages, so dismissal paths (Close control, Escape's
  `cancel`, backdrop click) must funnel through one synchronous idempotent
  cleanup — with the `close` listener kept as a fallback that must ignore
  events delivered for a dialog that has already left the DOM (a stale close
  from a dismissed dialog must never clobber a later dialog's open state) —
  that restores the underlying view and returns focus to it. Modal dialogs
  must be labelled and
  described (`aria-labelledby`/`aria-describedby`), open with focus inside,
  keep decorative layers `aria-hidden` and `pointer-events: none`, and any
  celebration animation must be CSS-only, finite (at most ~3.5s per piece),
  and fully suppressed with `display: none` under
  `prefers-reduced-motion: reduce`.
- Undo always reverses the newest `{ id, playerId, amount }` entry in
  `game.changes`: subtract that change's amount from its recipient's total and
  drop the entry, one change per activation, with no depth limit. A missing,
  empty, or non-array log is a safe no-op that never mutates state. Undo never
  mutates the input game, never touches `game.status` or `player.order`, and
  never stores ranks. Undo survives reloads through the persisted change log;
  finishing, and replay slices must keep these rules.
- Score distribution is display-only derived data, never persisted:
  `scoreDistribution(game)` in `src/standings.js` computes shares from current
  totals at render time (no persisted fields, no new save trigger, no
  `src/storage.js` change), the block renders only in the active view's
  leaderboard panel after the standings rows (never in finished views, the
  podium, home, setup, or the active-empty state), and the caption
  (`Score distribution` + the signed `{N} total game points`) must always
  render so the block never disappears silently. The bar and legend render
  only when the signed game total is positive; at zero or below they are
  replaced by the locked line "No shares to show while the game total is zero
  or negative." Shares belong to positive-total players only, with the sum of
  positive totals as the denominator (never the signed game total, never
  absolute values), rounded by largest remainder to integers that sum to
  exactly 100; zero-total players are omitted while a positive-total player
  rounding to 0% keeps its row so segments and legend stay exactly 1:1.
  Segment widths are the integer percents exactly (no min-width), the legend
  lists `{name} {percent}%` as real text so color is never the only signal,
  the bar is `aria-hidden`, and the block must contain zero focusable
  elements and no new live region.
- The UI renders from the translated v2 token layer in `src/styles.css` only:
  screens are built with plain CSS custom properties (colors, type, radius,
  spacing, shadows) mapped from `docs/design/update-v2/warm_tactile_scorekeeper/DESIGN.md`,
  and no restyle may reintroduce hardcoded palette values that already have a
  token (the error family in particular must come from `var(--error)` /
  `var(--error-container)` / the tertiary mapping). Tailwind, CDN scripts, icon
  fonts, and any build step or runtime dependency are rejected; icons degrade
  to labeled text or `aria-hidden` inline SVG, and every icon-only control
  must carry an accessible text label.
- `--muted` is suite-frozen at `#6D655C` (`rgb(109, 101, 92)`): the undo suite
  asserts the info feedback color exactly. Changing that token requires an
  honest update to `scripts/browser-undo-test.mjs` first, never a silent restyle.
- The top navigation is display/state only: it renders static markup on every
  screen, paints `aria-current="page"` per view, and resolves its Active Game
  destination (in-memory game → most recently updated saved active game → the
  Active Game empty state) without ever writing storage — navigation calls no
  `saveGames`, mutates no saved games, and adds no save trigger. Every nav
  action moves focus to the destination view's primary heading.
- The Dashboard previews five games per panel (`PANEL_PREVIEW_LIMIT`) from the
  existing `orderSavedGamesForDisplay` list. Above five, each panel renders one
  `View all (N)` opener below its list with `aria-haspopup="dialog"`, no
  `aria-expanded`/`aria-controls`, a ≥44px target, and a visible label that is
  a substring of the accessible name. The opener sets the one transient string
  `state.historyDialog` (`null | "active" | "finished"`, reset at every
  Dashboard arrival) and opens a `.history-dialog` listing every game of that
  status in the accepted most-recent-first order with the same cards and
  Resume/View results handlers, labelled by `history-dialog-title` and
  described by an `{N} saved games` count line. Closing via the 44px close
  control, Escape, or a backdrop click funnels through one synchronous cleanup
  and returns focus to that panel's opener; the preview stays visible behind
  the modal. Opening, closing, navigating, and focus movement must never write
  storage, change `updatedAt`, or alter the persisted payload. At ≤5 games
  there is no opener, no wrapper, and no dialog. The hero must not render the
  old "Local to this browser" pill; the retention note stays. The gap between
  the hero and the dashboard is 32px at desktop and 20px when stacked, using
  the `[data-app-root]` grid gap (the `.home-layout` gap alone is inert because
  the hero and dashboard share the `#app` parent).
- Active leaderboard rows are click-to-select: a click on any non-button part
  of an active row runs the same selection path as its Add points control
  (`selectedPlayerId`, cleared feedback, re-render, focus `#score-amount`).
  The Add points button remains the keyboard control and the only
  `aria-pressed` target; rows gain no `tabindex` or role. Finished rows are
  inert: no listener, no pointer cursor, no selection or highlight change.
  The `.is-selected` treatment stays byte-identical.
- Game presets are a fixed catalogue, not a user-defined system:
  `src/presets.js` is the only source (`custom`, `flip-7`, `catan`,
  `ticket-to-ride`, `7-wonders`, `yahtzee` in picker order) and every consumer
  resolves through `getPreset`, whose universal fallback maps missing, null,
  `"custom"`, and unknown ids to Custom. `normalizePresetId` returns only known
  non-custom ids (else `null`). Do not duplicate preset data in `main.js`, add
  presets, allow per-game action editing, or add a wider catalog without a new
  agreed feature.
- The optional stored `presetId` is the only new persisted field: `createGame`
  stores a known non-custom id and omits it for Custom/unknown/missing input.
  `finishGame`/`renameGame` preserve it through their spreads; `storage.js`
  and the version-1 envelope stay unchanged; pre-feature records and unknown
  ids never get a load-time rewrite. Replay passes `presetId` through
  `createGame` (valid non-custom copied, Custom/unknown omitted) while still
  storing `title: ""`; finished originals stay byte-identical.
- Setup preset behavior: untouched rosters (`state.rosterTouched === false`)
  are replaced with the preset's `defaultPlayers`; touched rosters clamp into
  `[minPlayers, maxPlayers]` by truncating only trailing rows or appending
  blank rows with fresh ids and positional colors, preserving retained
  names/colors literally. Only name input, color change, Add player, and
  Remove player set `rosterTouched`; preset-driven resizing must never set it.
  A full reset returns to Custom with two empty rows and focuses
  `#game-preset-custom`; nav New Game preserves the scratchpad and focuses the
  setup heading, whose next Tab enters the checked radio and then the title.
  Preset selection clears setup feedback, re-renders, and returns focus to the
  selected radio. Status pill, Add/Remove disabled states, helper text,
  `limitMessage`, and `validateRoster` all use the resolved range; Custom keeps
  the accepted 2–20 copy and messages.
- Title auto-fill must never overwrite a user title: a preset switch writes
  the default title only when the field is empty/whitespace or still holds a
  preset-written title (`state.titleAutoFilled`); any title input clears that
  flag until the field is blanked again. The flag is scratchpad-only and never
  persisted.
- Non-negative presets (Flip 7, Catan, 7 Wonders, Yahtzee) reject saves with
  `negative-not-allowed` and the copy
  `This preset only adds points. Enter a positive amount.` only after the
  accepted player/integer/zero/range gates; zero keeps the `zero` code for
  every preset (positive-only copy for non-negative presets, the accepted
  positive-or-negative copy for Custom/Ticket to Ride). Their input exposes
  `min="0"`, the stepper/draft floor is 0, and no negative quick action
  renders. Custom/Ticket to Ride keep signed behavior. No zero quick action
  may exist, and targets (`Target 200 points`, `Target 10 VP`) are hints only:
  they must never finish a game, disable scoring, or open the podium.
