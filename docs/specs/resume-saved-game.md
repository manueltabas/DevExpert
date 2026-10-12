# Feature Implementation Spec: Resume a saved game

## Source Feature

- `id`: `resume-saved-game`
- `area`: `history`
- `depends_on`: [`undo-latest-score`] (accepted and merged into `main`, PR #8, merge commit `6029ffc` — verified: branch `codex/resume-saved-game` is checked out with a clean tree at `6029ffc`)
- `status`: `not_started` at planning time
- `source`: `feature_list.json`

## Goal

Make the scorekeeper survive a reload. Every successful game mutation is persisted in the browser's localStorage, the homepage's "Unfinished games" panel lists the saved games (title, players, colors, last-updated order), and choosing "Resume" on one reopens it as the active game with its roster, totals, and change log intact — so undo works immediately after a resume and undone changes never resurrect after a reload.

## Non-Goals

- No user-facing storage-failure UX (blocked storage, quota errors, malformed-data recovery messaging or payload preservation guarantees). `handle-storage-failure` owns that; this slice only ensures storage access is caught and never crashes scoring.
- No finished-game handling: no read-only reopening, no finish action, no change to the "Finished games" placeholder panel. `finish-game` owns that.
- No replay ("Play again") — `play-again` owns that.
- No delete/remove action for saved games (excluded from the agreed initial scope per `docs/risks-and-open-questions.md`), no export/import, no cross-tab sync or `storage` event handling, no offline/PWA support.
- No changes to score parsing, ranking semantics, roster rules, or undo depth; no stored rank fields (ranks stay render-time-only).
- No new npm dependencies, no build step, no backend.

## Job Story

When my game night got interrupted (or I accidentally reloaded the tab),
I want my game with its players, scores, and history to still be there when I come back,
so I can continue scoring instead of starting over and re-entering everything.

## Users And Permissions

- Scorekeeper: the only actor. Games are saved in and loaded from the current browser profile on the same origin. Anyone with access to the same browser profile sees the same saved games (per `docs/build-brief.md`); no accounts or permissions exist.

## Product Decisions Resolved For This Slice

These resolve the choices flagged in the feature notes ("Persist successful game mutations in localStorage. Define saved-data format and undo-after-reload behavior; catch save errors from the start."), `docs/risks-and-open-questions.md` ("Storage format remains a later persistence decision…"), and `docs/domain-model.md` ("Exact storage fields are an implementation decision"):

- **One storage key, versioned envelope**: single key `scorekeeper:games` holding `JSON.stringify({ version: 1, games: [...] })`. A stable key with an in-payload `version` was chosen over per-game keys (less code: no index, no orphans) and over versioned key names (a future migration reads the payload version instead of hunting old keys). This dataset is tiny (≤20 players plus a small change log), so rewriting the whole list per save is fine.
- **Saved game shape — the existing game object plus `updatedAt`**: each entry is exactly the in-memory game object produced by `createGame`/`applyScoreChange`/`undoLastScoreChange` — `{ id, title, status, createdAt, players: [{ id, name, color, marker, order, total }], changes: [{ id, playerId, amount }] }` — plus one storage-owned `updatedAt` ISO timestamp stamped on the persisted copy at each save. Persisting the full object (including `changes`) is what makes resume-with-undo work with zero transformation. No rank fields are ever persisted. `createGame` in `src/roster.js` is not modified; `updatedAt` exists only on stored copies (the in-memory active game ignores it; restoring it on resume is harmless and re-stamped at the next save).
- **Save triggers — successful game mutations only**: (1) "Start game" after `createGame` succeeds (so a roster-only game is resumable before its first score), (2) after `applyScoreChange` succeeds, (3) after `undoLastScoreChange` succeeds (so the shortened log persists). Selection changes, feedback-only repaints, setup typing, failed validations, and the "nothing to undo" no-op never save. View navigation does not save because every successful mutation already did.
- **List ordering — most recently updated first**: cards sort by `updatedAt` descending (fallback `createdAt`), tie-broken by `createdAt` descending then `id` ascending for determinism. The game you just scored sits at the top. Sorting is a pure, render-time helper (same philosophy as ranking).
- **List content**: each card shows the game title, "{N} players", the player names in roster order (comma-separated), one color marker per player in roster order (existing `.marker-*` classes, `aria-hidden`), an "Updated {date}" label, and a "Resume" button whose accessible name includes the title (e.g. `Resume Friday game night`) so duplicate titles stay distinguishable. Only games with `status: "active"` are listed.
- **Undo after reload**: works, because the persisted `changes` log is restored with the game on resume; undo then pops the newest logged change and a successful undo persists the shortened log, so a further reload can never resurrect undone changes. No new undo semantics are introduced.
- **Active-game slot vs multiple saved games**: storage holds many active games (nothing is removed in this slice); the in-memory `state.activeGame` slot stays single, exactly as today. Starting a game B after playing game A leaves A's last-saved snapshot in storage and listed at home; resuming replaces the in-memory slot. No unsaved in-memory state can be lost because every successful mutation already saved.
- **Save errors — minimal but real**: `src/storage.js` functions never throw; they return result objects (`{ games, error }` / `{ saved, error }`) with codes `unavailable` (missing/throwing storage access) and `invalid` (unparseable/wrong-version payload). `src/main.js` logs a `console.warn` carrying only the error code (never player names or scores, per `docs/build-brief.md`) and the app keeps working in memory. There is no save-confirmation UI in this slice, so nothing can falsely claim "saved". On a read error the app renders an empty list and leaves the stored payload untouched; a later successful save may overwrite an unreadable payload with valid data — a documented simplification whose durable behavior (understandable errors, payload preservation) belongs to `handle-storage-failure`.
- **Read-path validation — envelope plus a crash guard**: payload must be an object with `version === 1` and an array `games`; per entry, keep only objects with a string `id` and an array `players` (drop others with a console warning). The entry guard exists only so one malformed entry cannot crash the home render or resume; deep per-field validation and recovery are the next feature's scope.
- **No deletion UI**: per `docs/risks-and-open-questions.md`, deleting saved games is outside the initial scope; games accumulate in the list for now.
- **Same-millisecond id collision**: `createGame` ids are `active-game-<created-ms>`, so two games created in the same millisecond would share an id. Accepted as a theoretical, human-scale limitation for this slice (tests interact through real UI timing); documented rather than patched by changing accepted `src/roster.js` code.

## Acceptance Scenarios

### Scenario 1: Two saved games resume with independent totals

Given a fresh browser profile where the scorekeeper starts "Friday game night" (Alex, Sam), saves +10 for Alex, returns home, then starts "Penalty rematch" (Jamie, Taylor, Sam) and saves −3 for Jamie
When the page is reloaded and each game is resumed from home
Then the unfinished panel lists both games with "Penalty rematch" first; resuming "Friday game night" shows Alex 10 and Sam 0 with correct ranks, names, colors, and markers; returning home and resuming "Penalty rematch" shows Jamie −3 and the other players 0 — the two totals are independent and correct.

### Scenario 2: Saved list shows labels, names, colors, and recency order

Given two saved games where game 2 was saved most recently
When the homepage renders
Then each card shows the title, "{N} players", the saved player names, one marker per player using the saved colors, an "Updated" time label, and a "Resume" control with an accessible name containing the title; cards are ordered most-recently-updated first, and after saving another point in game 1 and returning home, game 1 moves to the top.

### Scenario 3: Undo survives reload

Given a saved game with changes [+10 Alex, +5 Sam] that was reloaded and resumed from home
When "Undo last score" is activated
Then Sam returns to 0, the announced feedback names Sam, and after navigating home and reloading again, resuming shows Sam 0 with Alex 10 — undone changes never reappear after any reload.

### Scenario 4: Storage failure is caught and non-fatal

Given a session where `localStorage.setItem` throws (or storage is unavailable)
When the scorekeeper starts a game and saves points
Then the app does not crash, no uncaught console errors appear (a `console.warn` diagnostic is allowed), in-memory totals and ranks keep working, and the rest of the flow continues; with storage unavailable at startup the home view renders the empty state instead of failing.

### Scenario 5: Empty profile shows the empty state with retention messaging

Given a fresh profile with no saved games
When the homepage loads
Then the "Unfinished games" panel shows its empty state plus a visible local-only retention line (games are saved only in this browser; clearing site data removes them), and nothing has been written to storage.

### Scenario 6: 320px and keyboard accessibility

Given a 320px-wide viewport with two saved games
Then the saved-game cards stack single-column with no horizontal page overflow, each "Resume" control has a ≥44px target and a visible focus style, keyboard Enter activates resume, the retention line is readable, and screen readers announce the list through labeled controls (list region label, per-card accessible names).

## Repository Research

### Files Inspected

- `AGENTS.md`, `PROGRESS.md` — one-feature workflow; `undo-latest-score` accepted and merged (PR #8, `6029ffc`); `resume-saved-game` named as next; `CI=true ./init.sh` is the standard gate.
- `feature_list.json` — source entry, its three verification items, and the notes directing format/undo-after-reload/save-error decisions here.
- `CONTEXT.md`, `docs/build-brief.md`, `docs/domain-model.md` — persistence is browser-local; "Save locally and resume unfinished games"; loading an unfinished game restores scores and roster; homepage lists saved games.
- `docs/risks-and-open-questions.md` — storage format is an implementation decision; detect unavailable storage without silent loss; deletion of saved games and concurrent-tab editing excluded from initial scope.
- `DESIGN.md` — home screen: "obvious New game action, empty-state guidance, and cards separating resumable games from finished results"; 320px no-overflow, 44px targets, visible focus.
- `CONSTRAINTS.md` — undo/persistence invariants this slice must keep (no rank storage, change-log shape, non-blocking `init.sh`, allowlisted static server).
- `ARCHITECTURE.md` — boundaries currently state "Reloading clears the active game and its change log" and "does not persist data" — both must be revised.
- `src/main.js` — in-memory `state` (`view`, `activeGame`, `selectedPlayerId`, …); `renderHome` with the hardcoded "No saved games yet." empty state and "Local to this browser" pill; success paths in the setup submit, `handleScoreSubmit`, and `handleUndo` are the three save-hook call sites; full re-render + explicit refocus pattern.
- `src/roster.js` — `createGame` shape `{ id: "active-game-<ms>", title, status: "active", createdAt, players }`; not modified by this slice.
- `src/score.js` — `applyScoreChange` appends `{ id, playerId, amount }` to `game.changes`; `undoLastScoreChange` pops the newest entry. Fresh games have no `changes` property; the persisted copy must tolerate that.
- `src/standings.js` — render-time ranking; untouched.
- `src/styles.css` — `.panel`, `.panel-heading`, `.empty-state`, `.status-pill`, `.marker-*`, `.dashboard-grid` (two columns, stacked at ≤720px), 44px target and focus patterns, reduced-motion block.
- `scripts/static-server.mjs` — explicit `DEFAULT_PUBLIC_FILES` allowlist; `src/storage.js` must be added.
- `scripts/smoke.mjs` — asserts each `src/*.js` is served and repository files are 404; add the storage module. (Its "no localStorage in static markup" check reads only `index.html`, which does not change.)
- `scripts/browser-test-utils.mjs` — CDP helpers (`launchChrome`, `navigate`, `fill`, `click`, `evaluate`, `screenshot`, `setViewport`); `navigate` re-entering the URL with the same profile is the reload mechanism, and a per-script temp `--user-data-dir` persists localStorage across navigations.
- `scripts/browser-{roster,score,rank,undo}-test.mjs` — 18 assertions of `localStorage.length === 0` that persistence will invalidate (see Expected File Changes).
- `scripts/{roster,standings,score}-test.mjs` — Node unit pattern with `node:assert/strict`; the natural model for `scripts/storage-test.mjs`.
- `package.json`, `init.sh` — `test` chain and gate composition (required-file list, `node --check` per script, `npm run test`); new files must be registered in both.
- Git state: `codex/resume-saved-game` clean at `6029ffc`; `docs/specs/` has no `resume-saved-game.md` yet.

### Existing Patterns To Follow

- Pure logic in DOM-free ES modules; all rendering/events in `src/main.js`; Node unit tests import pure modules directly; inject parameters instead of touching globals (storage backend is injectable for tests).
- Full-view re-render plus explicit refocus after state changes; `aria-live="polite"` feedback region; labeled controls with `aria-label`s built through `escapeAttribute`.
- One focused CDP browser script per feature; screenshots into a temp evidence dir; no-console-error and no-horizontal-overflow assertions; 320px viewport probes.
- Derive at render time (ranks, list ordering); never store derived data.

### Current Gaps

- No storage module, no saved list, no resume path; home empty states are hardcoded; reload discards everything.
- Existing browser tests hard-assert zero localStorage writes — they must be updated as part of this feature (an honest, content-aware replacement, not a weakening).

## Technical Approach

1. **New storage module `src/storage.js`** (pure, DOM-free, injectable backend):
   - Exports `STORAGE_KEY = "scorekeeper:games"`, `SAVED_GAMES_VERSION = 1`, `loadSavedGames({ storage = globalThis.localStorage ?? null } = {})`, `saveGames({ games, storage } = {})`, and the pure helpers `upsertSavedGame(games, game, { updatedAt })` and `orderSavedGamesForDisplay(games)`.
   - `loadSavedGames` returns `{ games: Game[], error: null | "unavailable" | "invalid" }`: guard missing/throwing storage (`unavailable`); `JSON.parse` + envelope check (`version === 1`, array `games`) and the per-entry crash guard (string `id`, array `players`) → `invalid`/drop-with-warning; never mutate the stored payload; never throw.
   - `saveGames` returns `{ saved: boolean, error: null | "unavailable" | "write" }`: `JSON.stringify({ version, games })` into `setItem` inside try/catch; never throws.
   - `upsertSavedGame` returns a new array with the game replaced by `id` or appended, stored copy being `{ ...game, updatedAt }`; input array and game never mutated. `orderSavedGamesForDisplay` returns a sorted copy (updatedAt desc → createdAt desc → id asc) without mutating input.
2. **Save hooks in `src/main.js`**: one `persistActiveGameSnapshot()` helper that upserts `state.activeGame` into `state.savedGames` (stamping `updatedAt`), calls `saveGames`, and on failure logs `console.warn("Game save failed:", error)` with no names/scores. Called exactly in the three success paths (setup submit after `state.activeGame = game`; `handleScoreSubmit` and `handleUndo` after `state.activeGame = result.game`). State gains `savedGames`, initialized from `loadSavedGames()` before the first `render()`.
3. **Home list and resume in `src/main.js`**: `renderHome` replaces the unfinished panel's hardcoded empty state with either the saved-game cards (built from `orderSavedGamesForDisplay(state.savedGames)` filtered to `status: "active"`) or the empty state; a retention line ("Saved only in this browser — clearing site data removes these games.") is always present in the panel; the finished-games panel is untouched. Resume buttons (`data-action="resume-game"` + `data-game-id`) call a handler that finds the game, sets `state.activeGame`, defaults `selectedPlayerId` to the first player, clears `scoreFeedback`, switches to the active view, renders, and focuses `[data-active-heading]` — mirroring the start-game flow.
4. **Styling in `src/styles.css`**: saved-game card/row styles within the existing panel and 8px rhythm (title, meta line, names line, marker strip, resume button ≥44px, visible focus), stacking at ≤720px and no overflow at 320px; muted retention-line style reusing `--muted`.
5. **Test ripple and wiring**: shared assertion helper in `scripts/browser-test-utils.mjs` (read the single storage key and parse the payload); update the four existing browser suites' `localStorage.length` assertions to key-aware expectations (home-before-any-save stays 0; after the first successful save exactly 1 key named `scorekeeper:games`); add `scripts/storage-test.mjs` and `scripts/browser-resume-test.mjs`; register everything in `package.json`, `init.sh`, `scripts/static-server.mjs`, and `scripts/smoke.mjs`.

If the implementer wants to stage the work, keep this exact order: storage module + unit tests → save hooks → home list + resume → browser coverage, docs, and the assertion ripple. No split into a separate feature is needed: this is one data model plus one user flow, within the 100–250-line spec target.

## Expected File Changes

- `src/storage.js` — create; storage module per the technical approach (new public file, hence the server/smoke/gate ripple below).
- `src/main.js` — modify; `savedGames` state + initial load, `persistActiveGameSnapshot` and its three call sites, saved-list rendering with resume actions, retention line, empty-state copy refresh.
- `src/styles.css` — modify; saved-game card styles, retention line, responsive behavior at ≤720px/320px.
- `scripts/storage-test.mjs` — create; unit coverage with in-memory storage stubs: round-trip save/load, upsert replace/append + immutability, ordering helper ties, envelope/entry validation (`invalid`, dropped entries), `unavailable` storage (undefined and throwing), `saveGames` write failure, version mismatch.
- `scripts/browser-resume-test.mjs` — create; Scenarios 1–6 on headless Chrome (two games, reload, independent resume, list content/order, undo-after-reload, 320px/keyboard/retention messaging, empty state); plus Scenario 4 in a separate Chrome session using `Page.addScriptToEvaluateOnNewDocument` to make `setItem` throw.
- `scripts/browser-test-utils.mjs` — modify; shared `readSavedGamesState(cdp)` helper (key count, key name, parsed payload version/game count) used by all browser suites.
- `scripts/browser-roster-test.mjs`, `scripts/browser-score-test.mjs`, `scripts/browser-rank-test.mjs`, `scripts/browser-undo-test.mjs` — modify; replace each `localStorage.length === 0` assertion with the key-aware expectation for that step (0 before any game exists; exactly 1 key `scorekeeper:games` after the first save). No behavior in these flows changes.
- `scripts/static-server.mjs` — modify; add `src/storage.js` to `DEFAULT_PUBLIC_FILES`.
- `scripts/smoke.mjs` — modify; assert `src/storage.js` is served (200).
- `package.json` — modify; add `test:storage` and `test:browser:resume`, chained into `test`.
- `init.sh` — modify; add `src/storage.js` to required files; add `node --check` for `src/storage.js`, `scripts/storage-test.mjs`, `scripts/browser-resume-test.mjs`. Gate stays non-blocking.
- `README.md` — update; saved/resume usage, local-only retention note, new test commands.
- `ARCHITECTURE.md` — update; describe the storage module and persistence boundary; replace "Reloading clears the active game…" with the persistence reality (undo survives reload via the persisted log).
- `CONSTRAINTS.md` — update; durable persistence rule: single versioned key, save on successful game mutations only, full change log persisted so undo survives reload, never persist ranks, storage helpers never throw and diagnostics never include names/scores, finished/read-only behavior stays out until `finish-game`.
- `AGENTS.md` — not needed; workflow, commands, and operating rules unchanged.
- `index.html`, `src/roster.js`, `src/score.js`, `src/standings.js` — not needed; unchanged accepted modules.
- `PROGRESS.md`, `feature_list.json` — updated with actual evidence during implementation/validation, not by this planner.

## Visual Design Impact

- UI involved: yes.
- Design source: `DESIGN.md` — home screen calls for "cards separating resumable games from finished results" and empty-state guidance; existing tokens and card patterns.
- Screens or states affected: homepage only (unfinished-games panel: list cards, refreshed empty state, retention line) plus the existing active view gained via resume (no visual change there). No new screens, motion, or tokens.
- New design artifact required: no — cards reuse `.panel`/`.marker`/button patterns; exact card layout is an implementation choice within the accepted direction.

## Durable Documentation Impact

- `ARCHITECTURE.md`: update — new storage module in the source layout, persistence boundary in Runtime surface/Boundaries, new commands and scripts.
- `CONSTRAINTS.md`: update — durable localStorage rules future slices (storage failure, finish, replay) must inherit.
- `AGENTS.md`: not needed — no workflow or command changes beyond the existing gate.
- `README.md`: update — usage and command list.
- Other docs: none — `docs/domain-model.md` already describes persistence intent; no source-of-truth change.

## Implementation Plan

1. Create `src/storage.js` with the versioned single-key format, injectable backend, never-throwing load/save, upsert and display-order helpers; extend `scripts/storage-test.mjs` until green.
2. Wire `persistActiveGameSnapshot()` into the three success paths in `src/main.js` (start, save points, undo) and initialize `state.savedGames` at startup.
3. Build the homepage saved list (content, ordering, retention line, empty state) and the resume handler with the established focus/aria patterns; style the cards in `src/styles.css`.
4. Add `scripts/browser-resume-test.mjs` (Scenarios 1–6 plus the separate-session storage-failure check) and the shared storage-read helper; update the four existing browser suites' localStorage assertions.
5. Register all new files in `scripts/static-server.mjs`, `scripts/smoke.mjs`, `package.json`, and `init.sh`; update `README.md`, `ARCHITECTURE.md`, `CONSTRAINTS.md`.
6. Run the full gate and real browser checks at desktop and 320px; record evidence.

## Implementation Tasks

- [ ] Create `src/storage.js`: `STORAGE_KEY`, `SAVED_GAMES_VERSION`, `loadSavedGames`, `saveGames`, `upsertSavedGame`, `orderSavedGamesForDisplay`; injectable storage, never throws, `unavailable`/`invalid`/`write` error codes, per-entry crash guard, `updatedAt` stamped only on stored copies.
- [ ] Add `scripts/storage-test.mjs` covering round-trip, upsert/append/immutability, ordering ties, invalid payloads (non-JSON, wrong version, wrong shape, bad entries), unavailable/throwing storage, write failure; wire `test:storage` into `package.json`.
- [ ] Extend `src/main.js`: `savedGames` state, load at startup, `persistActiveGameSnapshot()` called after successful `createGame`, `applyScoreChange`, and `undoLastScoreChange`; console diagnostics without names/scores.
- [ ] Rework `renderHome`: saved-game cards (title, "N players", names, marker strip, Updated label, Resume button with title-bearing accessible name), most-recently-updated order, always-visible retention line, refreshed empty state; resume handler restoring roster/totals/changes with first-player selection and heading focus.
- [ ] Style the cards and retention line in `src/styles.css` for desktop, ≤720px stacking, and 320px (no overflow, ≥44px targets, visible focus).
- [ ] Add `scripts/browser-resume-test.mjs` covering Scenarios 1–6, reload via `navigate`, and the separate-session `setItem`-throws scenario; wire `test:browser:resume` into `package.json`.
- [ ] Add the shared saved-storage read helper to `scripts/browser-test-utils.mjs`; update `localStorage.length === 0` assertions in the four existing browser suites to key-aware expectations (0 before any save; exactly 1 key `scorekeeper:games` after the first save).
- [ ] Add `src/storage.js` to `scripts/static-server.mjs` allowlist and `scripts/smoke.mjs`; add required-file and `node --check` entries to `init.sh` for `src/storage.js`, `scripts/storage-test.mjs`, `scripts/browser-resume-test.mjs`.
- [ ] Update `README.md`, `ARCHITECTURE.md`, `CONSTRAINTS.md`.

## Verification Plan

- `node --check src/storage.js src/main.js scripts/storage-test.mjs scripts/browser-resume-test.mjs` (and the rest of the gate's list) — expected: all pass.
- `npm run test:storage` — expected: round-trip, upsert/immutability, ordering, invalid/unavailable handling all green.
- `npm run test:browser:resume` — expected: Scenarios 1–6 pass on headless Chrome, including reload-and-resume with independent totals, undo-after-reload, list content/ordering, 320px/keyboard/retention checks, and the storage-failure non-crash scenario.
- `npm run test` — expected: roster, standings, score, smoke, and all five browser suites pass with the updated assertions and new suites chained.
- `./init.sh` and `CI=true ./init.sh` — expected: the gate runs required-file checks (including `src/storage.js`), every syntax check (including the two new scripts), and the full `npm run test` chain, then exits without starting a long-running server. `init.sh` keeps executing non-blocking checks and only prints the manual `npm run dev` follow-up.
- `npm run dev` + manual real-browser pass (desktop 1280×800 and 320×720): create and score two games, reload, resume each from home with correct independent totals; verify saved names, colors, labels, ordering, and the local-only retention messaging; undo after resuming; confirm a reload never resurrects undone changes.
- Feature-list verification mapping: "Create and score two games, reload the browser page, then resume each from home with correct independent totals" → Scenarios 1/3; "Check saved names, colors, game labels, ordering, and local-only retention messaging on mobile" → Scenarios 2/5/6; `CI=true ./init.sh` → gate runs above.
- E2E note: no persistent E2E harness exists in this repo; the focused CDP browser script is the established browser-flow coverage and is included above. Unit + browser coverage is sufficient because the feature is local UI/data persistence with no routing, auth, or API surface.
- Responsive and accessibility verification: Scenario 6 in the browser test plus the manual 320px pass (cards stack, ≥44px resume targets, visible focus, keyboard activation, no horizontal overflow, retention line readable); screen-reader paths via the labeled list region and title-bearing accessible names asserted in the test.

## Evidence To Capture

- Output summaries for `npm run test:storage`, `npm run test:browser:resume`, `npm run test`, `./init.sh`, and `CI=true ./init.sh` (exact commands and results).
- Browser scenario results for Scenarios 1–6: the two-game/reload/resume totals, the undo-after-reload walk (including no resurrection after a second reload), card content/order assertions, and the storage-failure non-crash session.
- Screenshot paths from `scripts/browser-resume-test.mjs` (desktop and 320px), noting if they could not be opened for visual inspection this session.
- Confirmation that no rank fields are persisted, storage payloads are only written on successful game mutations, and diagnostics contain no player names or scores.
- Update `feature_list.json` evidence and the `PROGRESS.md` session log with these results (implementer/validator step).

## Validator Checklist

- [ ] Implementation stays within `resume-saved-game` scope: persistence + saved list + resume only.
- [ ] No storage-failure UX, no malformed-data recovery UI, no finished-game/read-only behavior, no replay, no delete action, no cross-tab sync, no stored rank fields.
- [ ] Saved format is the versioned single-key envelope with the full game object (players + change log) plus `updatedAt`; resume restores roster, totals, and log.
- [ ] Saves happen exactly on successful game mutations (start, save points, undo); nothing-to-undo, selection, and failed validations never save.
- [ ] Undo after reload reverses the newest persisted change; undone changes never reappear after a reload.
- [ ] Saved list shows title, player count, names, colors, Updated label, and recency ordering; Resume controls have title-bearing accessible names and keyboard operability.
- [ ] Storage errors are caught: the app keeps working in memory, logs code-only diagnostics, and never throws from load/save paths.
- [ ] Local-only retention messaging is visible on the homepage including at 320px.
- [ ] Existing browser suites' localStorage assertions were updated honestly (0 before any save; 1 key after) without weakening other checks.
- [ ] 320px: cards stack, no horizontal overflow, ≥44px targets, visible focus, keyboard activation.
- [ ] `npm run test`, `./init.sh`, and `CI=true ./init.sh` pass with the new focused checks; `init.sh` did not start a server.
- [ ] `ARCHITECTURE.md`, `CONSTRAINTS.md`, `README.md` updated; `feature_list.json` evidence and `PROGRESS.md` record real checks.
- [ ] No unrelated product behavior or extra feature work was added.
