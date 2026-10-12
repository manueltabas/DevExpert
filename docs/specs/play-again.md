# Feature Implementation Spec: Replay with the same players

## Source Feature

- `id`: `play-again`
- `area`: `games`
- `depends_on`: [`celebrate-podium`] (accepted and merged into `main` — PR #13, merge commit `dd557f0`; verified: branch `codex/play-again` is checked out with a clean tree at `dd557f0`, which is contained in `main` and `origin/main`)
- `status`: `not_started` at planning time
- `source`: `feature_list.json`

## Goal

The scorekeeper can start the next round without retyping the table: a finished game's read-only view gains a "Play again" control that creates a **separate** new active game. The new game copies player presentation — names, colors, and markers (plus the game title) — but every identity is new (new game id, new player ids), all totals start at zero, and nothing else carries over: no scores, no change log (so no undo history), no `updatedAt`. The original finished game stays in storage exactly as it was, read-only, and after replaying, home lists the finished original under "Finished games" and the new game under "Unfinished games" independently. This completes the MVP loop (create → score → undo → save/resume → finish → podium → replay).

## Non-Goals

- No copying of totals, the `{ id, playerId, amount }` change log, or `updatedAt` into the replay — the replay starts at zero with no history (feature notes).
- No changes to the finished original: no editing finished results, no un-finish, no reopening a finished game for scoring, no deletion of saved games.
- No "Play again" on home cards or inside the podium dialog — the control lives only on the finished view (see Product Decisions). The podium stays display-only per `CONSTRAINTS.md`.
- No changes to `src/roster.js` (the replay reuses `createGame` as-is), `src/score.js`, `src/standings.js`, `src/storage.js`, the storage format, or score/undo/rank semantics.
- No new storage-failure paths: replay persists through the existing `persistActiveGameSnapshot()` and accepted notice/suppression/rollback behavior.
- No title editing, no rematch naming schemes (e.g. "(rematch)" suffixes), no replay count limits, no cross-tab coordination.

## Job Story

When our game ends and someone says "one more round with the same people",
I want to hit Play again from the final standings,
so I can start scoring the rematch immediately with the same names and colors — while last game's result stays saved for the record.

## Users And Permissions

- Scorekeeper: the only actor, one local browser profile, no accounts. Replay is a local action that creates one new saved game and leaves all existing saved games untouched; diagnostics stay code-only.

## Product Decisions Resolved For This Slice

These resolve the feature notes ("New game-scoped identities; copy no scores or undo state. Verify the full MVP flow through replay at mobile and desktop sizes.") and `docs/risks-and-open-questions.md`:

- **Control placement — finished view only.** `DESIGN.md` core screens: "Finished game: read-only full standings and Play again." One `type="button"` `primary-action` labeled "Play again" (`data-action="play-again"`, visible text is the accessible name — the game heading gives context) rendered in `renderFinishedGame` below the standings `<ol>`, inside the roster panel. Not in the podium dialog (celebration is display-only and must never trigger mutations per `CONSTRAINTS.md`), not on home cards (`DESIGN.md` assigns home cards only Resume/View results).
- **Creation mechanism — one pure lifecycle helper reusing the roster path.** New `replayGame({ game, now = new Date() })` in `src/game.js` (the lifecycle module that owns `finishGame`; it imports `createGame` from `./roster.js` — a clean new edge to a leaf module). It guards `missing-game` (missing/invalid game, non-array players) and `not-finished` (any non-`"finished"` status; new `GAME_ERROR_CODES` entry), then maps `game.players` to roster rows `{ name, color }` and calls `createGame({ title, rows, now, idSeed: "replay-game" })`. Because `createGame` derives the game id (`replay-game-<timestamp>`) and player ids (`replay-game-player-N`) from the seed, identities are structurally new and can never collide with setup-created `active-game-*` ids; two consecutive replays get distinct timestamps at human click speed (the same-millisecond theoretical collision is the accepted pre-existing `createGame` behavior). Roster validation failures (blank/overlong name, unknown color, fewer than 2 or more than 20 players — reachable only via hand-corrupted stored data) return `invalid-roster` (new code). `createGame` output already satisfies the copy contract in the accepted flow (markers are `String(index+1)`, `order` is the array index); the helper additionally restores each new player's `marker` (when the original's is a nonempty string) and `order` (when an integer) from the original at the same index, with the regenerated values as fallbacks, so presentation copies literally even for atypical stored data. `title` is copied verbatim (defensively normalized: non-string → `FALLBACK_TITLE`, since `createGame` calls `title.trim()`). The input game is never mutated; the result has `status: "active"`, `total: 0` everywhere, and **no `changes` property** (fresh `createGame` shape).
- **Active-slot behavior — last snapshot wins, mirroring resume.** `state.activeGame` is a single slot. `handlePlayAgain()` replaces it with the new game exactly like `handleResume` replaces it with a stored game: the previously viewed finished game leaves the slot but stays stored, and any other active game in storage is untouched (its Resume card remains on home). No replacement prompt — nothing can be lost because every successful mutation is already persisted. Transient state resets in the handler: `selectedPlayerId` = first new player, `scoreFeedback = null`, `finishPromptOpen = false`, `podiumOpen = false`, `replayFeedback = null` (new, see below).
- **Save/persistence — fifth successful-mutation save trigger via the existing helper.** On success the handler sets `state.activeGame`, calls the unchanged `persistActiveGameSnapshot()` (making replay the fifth trigger after start/save-points/undo/finish), then renders and calls `paintStorageNotice()`. `upsertSavedGame` keys on the **new** game id, so it appends; the original finished entry — including its `updatedAt` — is never re-persisted and stays byte-identical. The finished original is never reachable by a save trigger while viewed (the finished view has zero mutation controls), so it cannot be rewritten with a fresh `updatedAt`. `state.view` stays `"active"`; `renderActiveGame` branches on the new game's `status` and lands the scorekeeper in the fresh scoring view with focus on `[data-active-heading]`.
- **Home list outcomes — automatic.** The finished original remains under "Finished games" (View results) and the replay appears under "Unfinished games" (Resume), both through the existing `orderSavedGamesForDisplay` filters — the replay's fresh `updatedAt` sorts it near the top. No panel changes needed.
- **Guard feedback — visible, polite, no dead clicks.** The finished view gains a `#replay-feedback` container (`aria-live="polite"`) next to the Play again button, painted by a `paintReplayFeedback()` mirror of `paintScoreFeedback`. Guard failures show one honest message each: `not-finished` → "Only finished games can be replayed.", `invalid-roster` → "This game's saved players can't be replayed.", plus a code-only `console.warn("Game replay failed:", code)`. No silent no-ops (unlike `handleResume`'s guard, which silently ignores unusable ids — replay refuses visibly because the user clicked).
- **Sizing:** one control + one pure creation path + wiring; correctly sized for a single feature — no split needed.

## Acceptance Scenarios

### Scenario 1: Replay copies presentation and resets scores and history

Given a finished game with scored players (e.g. Alex 10, Sam −3, Jamie 0 with a populated change log)
When the scorekeeper clicks "Play again" on the finished view
Then a new active game opens: same title, same names/colors/markers per row, every total 0 (ranks shared at 1 in creation order), first player selected, focus on the game heading, no podium, and pressing "Undo last score" announces "Nothing to undo yet." (no history copied).

### Scenario 2: The replay is a separate game and the original stays unchanged

Given the new replayed game
When the scorekeeper saves points to it (e.g. +5) and reloads the page
Then home lists the finished original under "Finished games" with its final totals/ranks unchanged and its stored entry (totals, change log, `updatedAt`) byte-identical to before the replay, and the replay under "Unfinished games" with its own totals and change log; resuming/View-results each shows the correct independent data, and the storage payload holds two distinct game ids.

### Scenario 3: Replay from a reopened finished game and repeated replays

Given a previously finished game reopened via "View results" (no podium)
When the scorekeeper clicks "Play again", finishes that replay, and clicks "Play again" again
Then each replay creates another independent game (distinct game ids in storage), all presentation copies hold, and home shows every game exactly once in the correct panel (e.g. 1 unfinished + 2 finished after two finish/replay rounds).

### Scenario 4: Guards refuse impossible replays honestly

Given a stored finished game with corrupted roster data (blank name, unknown color, or out-of-range count) reachable via "View results"
When the scorekeeper clicks "Play again"
Then no game is created, a polite `role="status"` feedback line explains the refusal, console diagnostics stay code-only, storage is untouched, and the finished view remains intact.

### Scenario 5: Replay under broken storage stays honest

Given a session with `Storage.prototype.setItem` patched to throw and a seeded valid payload containing a finished game
When the scorekeeper views results and clicks "Play again"
Then the in-memory replay still works (scoring, ranking, undo), the accepted `role="status"` write notice appears with unchanged copy, warnings stay code-only with no uncaught console errors, the stored payload is byte-identical, and home shows no phantom cards.

### Scenario 6: Full MVP flow through replay at mobile and desktop sizes

Given a fresh browser profile
When the scorekeeper walks the whole loop — create game, add signed points, undo, finish (podium opens/dismisses), Play again — at 1280×800 and again at 320×720
Then every step works at both sizes: no horizontal overflow, the Play again control is ≥44px with visible focus and keyboard operability (Enter/Space), focus lands on the new game's heading, `role="status"` regions are used for the read-only note and replay feedback, and no uncaught console errors appear.

## Repository Research

### Files Inspected

- `AGENTS.md`, `PROGRESS.md` — one-feature workflow; all nine prior features accepted; `CI=true ./init.sh` gate last verified passing 2026-10-12 (planner did not rerun it).
- `feature_list.json` — `play-again` entry: three verification items, notes, `depends_on: ["celebrate-podium"]` (`accepted`); `restrict-score-entry-input` depends on this feature.
- `CONTEXT.md`, `docs/build-brief.md`, `docs/domain-model.md` — "Play again creates a separate in-progress game from a finished game's player roster, copying display names/colors/markers with new game-scoped identities and zero totals. It does not copy scores or undo history."; build-brief success criteria include "plays again with zero totals while preserving the original game".
- `DESIGN.md` — finished screen = "read-only full standings and Play again"; accessibility baseline (44px targets, visible focus, labels, reduced motion); mockup decorative details are illustrative.
- `docs/risks-and-open-questions.md` — no blocking items; implementation-time choices (roster bounds, identity) already resolved in earlier slices.
- `CONSTRAINTS.md` — save-trigger list ("exactly on successful game mutations"); finished games read-only; podium display-only; storage notice/suppression rules; "finishing, and replay slices must keep these rules".
- `ARCHITECTURE.md` — module boundaries; "Replay and saved-game deletion remain separate features."
- `src/main.js` — `state` shape; `renderFinishedGame` (read-only variant: header, `finished-note`, ranked rows via `renderFinishedPlayer`, podium dialog, `bindActiveEvents`); `handleResume` (slot replacement + transient-flag resets + heading focus — the pattern `handlePlayAgain` mirrors); `persistActiveGameSnapshot` (suppression/rollback/notice-clear semantics — reused unchanged); `handleFinishGame` (fifth-trigger precedent for wiring a new trigger); `renderScoreForm`/`#score-feedback`/`paintScoreFeedback` (feedback-region pattern to mirror); `escapeHtml`/`escapeAttribute` on every interpolated stored string.
- `src/roster.js` — `createGame({ title, rows, now, idSeed })`: id `${idSeed}-${now.getTime()}`, players `{ id: ${idSeed}-player-N, name, color, marker: String(N), order: N−1, total: 0 }`, `status: "active"`, no `changes` key; `validateRoster` (2–20 players, trimmed nonblank names ≤40, known colors).
- `src/game.js` — `finishGame` and local `GAME_ERROR_CODES` (`["missing-game", "already-finished"]`); the natural home for `replayGame`.
- `src/score.js`, `src/standings.js`, `src/storage.js` — untouched; `upsertSavedGame` keys on game id (append for the new id), `loadSavedGames` per-entry guard accepts shape-valid entries regardless of roster validity (hence Scenario 4).
- `src/styles.css` — `.primary-action` (≥44px), `.finish-section` top-border pattern, `.form-feedback`/`.validation-message`, 8px rhythm, 320px grid variants.
- `scripts/game-test.mjs` — unit pattern incl. structuredClone immutability and the exact `GAME_ERROR_CODES` list assertion (needs an honest update when codes are added).
- `scripts/browser-finish-game-test.mjs` / `browser-podium-test.mjs` — `runSession` isolated-Chrome pattern, real-key helpers, `readSavedGamesState(cdp, key)` raw-payload checks; `browser-storage-failure-test.mjs` `seedStorageSource` + `setItem`-patching pattern for Scenario 5.
- `scripts/static-server.mjs`, `scripts/smoke.mjs`, `init.sh`, `package.json` — wiring points; `src/game.js` is already public/allowlisted/required/checked, so only the new browser script needs registering.
- Git state: `codex/play-again` clean at `dd557f0` (= `main` = `origin/main`); no `docs/specs/play-again.md` existed before this spec.

### Existing Patterns To Follow

- Pure, non-mutating helpers per concern in `src/*.js` with focused unit cases in the module's existing test script; one CDP browser suite per feature with isolated Chrome profiles, no-console-error and no-overflow assertions, 320px probes, temp-dir screenshots.
- New save trigger wired exactly like finishing (`handleFinishGame`): mutate `state.activeGame` → `persistActiveGameSnapshot()` → `render()` → `paintStorageNotice()` → explicit focus.
- Full re-render + explicit refocus; `role="status"` polite regions; honest test updates (never weaken existing suites).

### Current Gaps

- No "Play again" control exists anywhere; nothing creates a game from a finished game's roster; no `replayGame` helper, replay feedback region, or replay tests exist.

## Technical Approach

1. **`src/game.js` — `replayGame({ game, now = new Date() })`** — guard missing/invalid game or non-array players → `{ game: null, error: "missing-game" }`; any `status !== "finished"` → `{ game: null, error: "not-finished" }`; map players to rows `{ name, color }` and call `createGame({ title: typeof game.title === "string" ? game.title : FALLBACK_TITLE, rows, now, idSeed: "replay-game" })` (import `createGame`/`FALLBACK_TITLE` from `./roster.js`); roster validation failure → `{ game: null, error: "invalid-roster" }`; success restores original `marker`/`order` per player where valid and returns `{ game, error: null }`. Never mutate the input. Extend `GAME_ERROR_CODES` to exactly `["missing-game", "already-finished", "not-finished", "invalid-roster"]`.
2. **`src/main.js` — control and handler** — in `renderFinishedGame`, after the standings `<ol>`, render a `.replay-section` with the "Play again" button and the `#replay-feedback` `aria-live="polite"` container; add `state.replayFeedback = null`; `bindActiveEvents` gains the `play-again` listener (optional-chained, so the active variant is unaffected); `handlePlayAgain()` follows the Product Decisions (guards → visible feedback + code-only warn; success → slot replacement, flag resets, `persistActiveGameSnapshot()`, `render()`, `paintStorageNotice()`, focus `[data-active-heading]`); add `SCORE_ERROR_MESSAGES` entries for `not-finished`/`invalid-roster`; `paintReplayFeedback()` mirrors `paintScoreFeedback`.
3. **`src/styles.css`** — `.replay-section` only (top-border separation like `.finish-section`, 8px-rhythm margins); the button reuses `.primary-action` as-is; no new tokens, no motion.
4. **Unit tests** — extend `scripts/game-test.mjs` with `replayGame` cases (happy path with id/player-id/zero-total/no-changes/title/`status` assertions; all guards; marker/order restoration and fallbacks; non-string title fallback; structuredClone immutability; 20-player replay) and update the exact `GAME_ERROR_CODES` assertion honestly to the four-code list.
5. **Browser tests** — new `scripts/browser-play-again-test.mjs` with four isolated sessions (A: full MVP flow + separation per Scenarios 1–2 and 6 at desktop; B: reopen-and-replay + repeated replays per Scenario 3; C: blocked-write honesty per Scenario 5; D: 320px mobile full flow per Scenario 6), reusing `runSession`/`readSavedGamesState`/seeding patterns from the finish-game and storage-failure suites.
6. **Wiring** — `package.json`: add `test:browser:play-again` and append it to the `test` chain; `init.sh`: add `node --check scripts/browser-play-again-test.mjs`. No static-server/smoke/required-file changes (`src/game.js` already registered). Keep the gate non-blocking.
7. **Docs** — README (behavior + new command), ARCHITECTURE (replay boundary, control, fifth trigger), CONSTRAINTS (durable rules below); record evidence.

## Expected File Changes

- `src/game.js` — modify; add `replayGame`, two new error codes, import from `./roster.js`.
- `src/main.js` — modify; finished-view Play again control, `#replay-feedback` region, `state.replayFeedback`, `handlePlayAgain`, `paintReplayFeedback`, message entries.
- `src/styles.css` — modify; `.replay-section` wrapper (minimal).
- `scripts/game-test.mjs` — modify; `replayGame` cases + honest `GAME_ERROR_CODES` list update.
- `scripts/browser-play-again-test.mjs` — create; Scenarios 1–6 across four isolated Chrome sessions.
- `package.json` — modify; add `test:browser:play-again` to scripts and the `test` chain.
- `init.sh` — modify; `node --check` for the new browser script. Must not start a long-running server.
- `README.md`, `ARCHITECTURE.md`, `CONSTRAINTS.md` — update (see Durable Documentation Impact).
- Not needed: `index.html`, `src/roster.js`, `src/score.js`, `src/standings.js`, `src/storage.js`, `scripts/static-server.mjs`, `scripts/smoke.mjs` (`src/game.js` already public/allowlisted/required), all existing browser suites (must pass unmodified except `game-test.mjs`'s code-list assertion).
- `PROGRESS.md`, `feature_list.json` — updated with actual evidence during implementation/validation, not by this planner.

## Visual Design Impact

- UI involved: yes.
- Design source: `DESIGN.md` (finished screen explicitly includes Play again; accepted tokens; accessibility baseline) and existing panel/button patterns; no new screens.
- Screens or states affected: finished view only (new control + feedback region below the standings; the replay lands in the existing active view). No changes to home, setup, active scoring, or the podium dialog.
- New design artifact required: no — one reused `primary-action` within accepted tokens, subject to ≥44px/contrast/focus checks.

## Durable Documentation Impact

- `ARCHITECTURE.md`: update — `replayGame` in the game-lifecycle boundary, the finished-view Play again control, the fifth save trigger, and home outcomes (finished original + replay listed independently).
- `CONSTRAINTS.md`: update — durable MUST rules: replay goes through `replayGame` (new game-scoped ids via the `createGame` path), copies only presentation (names/colors/markers/title) and never totals/change-log/`updatedAt`, never mutates or re-persists the finished original, and persists through `persistActiveGameSnapshot()` as a successful-mutation save trigger (extend the save-trigger list to five) under the accepted suppression/rollback/notice rules.
- `AGENTS.md`: not needed — no workflow, startup, or operating-rule changes.
- `README.md`: update — replay behavior in the feature walkthrough and the new `test:browser:play-again` command.
- Other docs: none — `CONTEXT.md`/`docs/domain-model.md` already define play-again; no source-of-truth change.

## Implementation Plan

1. Add `replayGame` to `src/game.js` with its guards and `GAME_ERROR_CODES` extension; extend `scripts/game-test.mjs`; run `npm run test:game`.
2. Wire the finished view in `src/main.js`: render the control + feedback region, implement `handlePlayAgain` with slot replacement, flag resets, persistence, and focus; add the two message strings; style `.replay-section`.
3. Create `scripts/browser-play-again-test.mjs` (four sessions); wire `test:browser:play-again` into `package.json` and `init.sh`; keep every existing suite green (only the honest `GAME_ERROR_CODES` unit update).
4. Update `README.md`, `ARCHITECTURE.md`, `CONSTRAINTS.md`; run the full verification plan and record evidence.

## Implementation Tasks

- [ ] Add `replayGame({ game, now })` to `src/game.js`: `missing-game`/`not-finished`/`invalid-roster` guards, `createGame` reuse with `idSeed: "replay-game"` and defensive title normalization, marker/order restoration, input immutability, no `changes` key; extend `GAME_ERROR_CODES` to the four-code list.
- [ ] Extend `scripts/game-test.mjs` with the replay cases listed above (including the honest exact-list update) and make `npm run test:game` pass.
- [ ] Add the "Play again" button and `#replay-feedback` region to `renderFinishedGame`; add `state.replayFeedback`, `handlePlayAgain`, `paintReplayFeedback`, the `play-again` listener in `bindActiveEvents`, and `SCORE_ERROR_MESSAGES` entries for `not-finished`/`invalid-roster`.
- [ ] Add `.replay-section` styles to `src/styles.css`; verify ≥44px target, AA contrast, visible focus, and no 320px overflow.
- [ ] Create `scripts/browser-play-again-test.mjs` covering Scenarios 1–6 (desktop full-MVP + separation with raw-payload original-untouched checks; reopen/repeat replays; blocked-write honesty with byte-identical payload; 320px keyboard/focus/overflow) and wire `test:browser:play-again` into `package.json` and `init.sh`.
- [ ] Update `README.md`, `ARCHITECTURE.md`, `CONSTRAINTS.md`.

## Verification Plan

- `node --check src/game.js src/main.js scripts/game-test.mjs scripts/browser-play-again-test.mjs` — expected: all pass.
- `npm run test:game` — expected: existing `finishGame` cases plus the new `replayGame` cases green.
- `npm run test:browser:play-again` — expected: all four sessions pass on real headless Chrome, including two distinct game ids after replay, byte-identical stored entry for the finished original across replay and replay-game scoring, "Nothing to undo yet." in the replay, code-only warnings with byte-identical payload under blocked writes, and 320px/keyboard/focus checks with zero uncaught console errors.
- `npm run test` — expected: all unit suites, smoke, and all nine browser suites (eight existing + new) pass; existing suites unmodified except the honest `GAME_ERROR_CODES` assertion in `game-test.mjs`.
- `./init.sh` and `CI=true ./init.sh` — expected: required-file checks, all `node --check` entries (including the new script), and the full `npm run test` chain pass; the gate exits without starting a long-running server and only prints the manual `npm run dev` follow-up.
- `npm run dev` + manual real-browser pass (1280×800 and 320×720): full MVP loop through replay; verify names/colors/markers match, totals reset, both games listed separately after reload, original results unchanged.
- Feature-list verification mapping: "Finish a game, replay, and verify names/colors/markers match while totals and undo history reset" → Scenario 1 (unit + browser session A/D); "Score the new game and reload; verify both games remain separate and the original results are unchanged" → Scenario 2 (browser session A); `CI=true ./init.sh` → gate runs the above.
- E2E note: no persistent E2E harness exists in this repo; the focused CDP browser suite is the established browser-flow coverage and is included. Unit + browser coverage is sufficient because the feature is local UI/storage behavior with no routing, auth, or API surface.
- Responsive and accessibility verification: Scenario 6 at both sizes; ≥44px targets, visible focus, keyboard operability, `role="status"` usage, and no-overflow asserted in the suite and re-checked in the manual pass.

For `init.sh`, be explicit:

- `./init.sh` executes the non-blocking standard gate (required files, `node --check` list including the new browser script, full `npm run test`).
- It must not start long-running processes such as `npm run dev`; it may print the manual server command after checks pass.

## Evidence To Capture

- Exact commands and results for `npm run test:game`, `npm run test:browser:play-again`, `npm run test`, `./init.sh`, and `CI=true ./init.sh`.
- Browser proof points: replayed row names/colors/markers equal the original's; zero totals and shared rank 1; undo announces "Nothing to undo yet."; two distinct game ids in the payload after replay; the finished original's stored entry (totals, change log, `updatedAt`) byte-identical across replay and replay-game scoring; home panel membership correct after reload; repeated replays produce distinct games; blocked-write session shows the accepted notice with byte-identical payload and code-only warnings.
- Confirmation that console diagnostics stay code-only and no uncaught console errors appear in any session.
- Screenshot paths from the new suite (desktop + 320px), noting if they could not be opened for visual inspection.
- Update `feature_list.json` evidence and the `PROGRESS.md` session log with these results (implementer/validator step).

## Validator Checklist

- [ ] Implementation stays within `play-again` scope: finished-view control + `replayGame` + persistence/focus wiring only.
- [ ] The replay is a separate game: new game id and new player ids (via `createGame` with a replay seed), totals 0, no `changes` log, `status: "active"`, title/names/colors/markers copied; `updatedAt` is fresh storage-owned data on the new entry only.
- [ ] The finished original is untouched: stored entry byte-identical after replay and after scoring the replay; it stays read-only and listed under "Finished games".
- [ ] The replay persists through `persistActiveGameSnapshot()` with suppression/rollback/notice behavior unchanged; no phantom cards; diagnostics code-only.
- [ ] Guards (`missing-game`, `not-finished`, `invalid-roster`) refuse visibly via a polite feedback region without creating or mutating anything.
- [ ] No podium changes (no Play again inside the dialog, no re-celebration), no home-card changes, no changes to score/undo/rank semantics, `src/roster.js`/`src/score.js`/`src/standings.js`/`src/storage.js`, storage format, or the static-server boundary.
- [ ] Focus management matches spec (replay → new game heading); button ≥44px, keyboard operable, visible focus; no 320px horizontal overflow.
- [ ] `npm run test`, `./init.sh`, and `CI=true ./init.sh` pass with the new checks; existing suites pass unmodified (only the honest `GAME_ERROR_CODES` unit update).
- [ ] `README.md`, `ARCHITECTURE.md`, `CONSTRAINTS.md` updated; `feature_list.json` evidence and `PROGRESS.md` record real checks.
- [ ] No unrelated product behavior or extra feature work was added (in particular, none of `restrict-score-entry-input`).
