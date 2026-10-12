# Feature Implementation Spec: Finish a game with locked standings

## Source Feature

- `id`: `finish-game`
- `area`: `games`
- `depends_on`: [`handle-storage-failure`] (accepted and merged into `main`, PR #11, merge commit `415e481` — verified: branch `codex/finish-game` is checked out with a clean tree at `415e481`, which equals `main` and `origin/main`)
- `status`: `not_started` at planning time
- `source`: `feature_list.json`

## Goal

The scorekeeper can end a game deliberately: a distinct "Finish game" action opens a clear confirmation (finished games cannot reopen for scoring), and confirming locks the game. The finished game shows its complete final standings — every player with competition ranks and totals — with all score mutations gone (no Add points buttons, no score-entry panel, no undo), and it persists through the existing storage path with `status: "finished"`. On home it moves from "Unfinished games" to the "Finished games" panel; reopening it from there shows the same read-only standings, unchanged after reload.

## Non-Goals

- No podium modal, confetti, or celebration — `celebrate-podium` is the next slice (feature notes).
- No "Play again" from a finished game — `play-again` owns that.
- No un-finish, no reopening a finished game for scoring, no editing finished results, no deleting saved games (MVP irreversibility; deletion is outside MVP scope).
- No changes to score parsing, `applyScoreChange`/`undoLastScoreChange` semantics, ranking, roster rules, the storage format, or `src/storage.js`. The only data change is the existing `game.status` value becoming `"finished"`; no new persisted fields (no `finishedAt`, still no stored ranks).
- No new storage-failure paths: finishing reuses `persistActiveGameSnapshot()` and the accepted notice/suppression/rollback behavior as-is.
- No changes to resume behavior for active games, save triggers other than adding finishing, routing, or the static-server boundary (beyond allowlisting the one new module).

## Job Story

When the table agrees the game is over,
I want to confirm finishing and then see locked final standings I can revisit from home,
so I can trust the result is preserved exactly and nobody can accidentally change it, while I never lose a game to a misclick.

## Users And Permissions

- Scorekeeper: the only actor, one local browser profile, no accounts. Finishing is a local, irreversible state change to that browser's saved game; diagnostics stay code-only.

## Product Decisions Resolved For This Slice

These resolve the feature notes ("Finalization is irreversible in the MVP. Keep the complete standings available; celebratory modal is the next slice.") and `docs/risks-and-open-questions.md` ("Prevent accidental finishing with a clear confirmation because finished games cannot reopen"):

- **Confirmation mechanism — inline two-step confirm, no modal** (per `DESIGN.md`: "a distinct Finish game action"; dialogs need focus management, and the podium slice owns the first modal). Clicking "Finish game" swaps a dedicated finish section in the score-entry panel to an inline prompt: text "Finish this game?" plus warning "Finished games can't be reopened for scoring. Final standings stay saved in this browser." with two buttons: "Finish game" (confirm; `aria-describedby` pointing at the warning text) and "Cancel". No `window.confirm()`, no `<dialog>`, no focus trap needed.
- **Focus management**: opening the prompt moves focus to the confirm button; Cancel closes it and returns focus to the "Finish game" opener; confirming renders the read-only view and moves focus to `[data-active-heading]`.
- **Placement**: the finish section sits in the score-entry panel below the score form, visually separated. The mockup shows it near the header, but `DESIGN.md` says written behavior is authoritative ("a distinct Finish game action"); co-locating with scoring controls keeps the header stable at 320px.
- **The transition is one pure helper**: new `src/game.js` exporting `finishGame({ game, now = new Date() })` → `{ game: { ...game, status: "finished" }, error: null }`; guards: missing/invalid game → `{ game: null, error: "missing-game" }`, non-active `game.status` → `{ game: null, error: "already-finished" }`. Never mutates the input, never touches players/changes/order, stores no ranks or timestamps beyond `status`. Error codes join a local list in `src/game.js` (not `SCORE_ERROR_CODES`); copy lives in `src/main.js`.
- **Read-only rendering scope**: `renderActiveGame` branches on `game.status === "finished"` (after the null-game guard) to a finished variant that keeps the header (title, `[data-active-heading]`, players pill; eyebrow "Finished" instead of "In progress"), the "All games" back control, and the full leaderboard — same ranked rows, same `aria-label="{name}: rank {rank}, total {total}"` — but with no `Add points` buttons, no `aria-pressed`/`.is-selected` state, no score-entry panel, and no undo control. A polite `role="status"` line reads exactly "Final standings — this game is finished and can't be scored." Ranks stay render-time via `rankPlayers(game)`.
- **Persistence of the status change**: confirming calls `finishGame`, sets `state.activeGame` to the result, then calls the existing `persistActiveGameSnapshot()` — making finishing the fourth successful-mutation save trigger. The stored entry is the game object verbatim with `status: "finished"` (change log preserved; `updatedAt` stamped on the stored copy only, as accepted).
- **Storage-suppression interplay (explicit)**: finishing proceeds in memory even when writes fail. Under `invalid`-read suppression or a failed write, the in-memory game still becomes finished and renders read-only; `persistActiveGameSnapshot()` behaves exactly as accepted (code-only `console.warn`, no upsert under suppression; rollback + notice on write failure), so no phantom finished card can appear on home and no new error path exists. The accepted copy already explains the consequence honestly: after a reload the stored game may still be `active` until a save succeeds — the view stays read-only for the current session either way.
- **Home "Finished games" panel**: the placeholder is replaced by an `<ol aria-label="Finished games">` built from `orderSavedGamesForDisplay(state.savedGames)` filtered to `status === "finished"` (most recently finished first). Cards reuse the existing `.saved-game` card structure (title, "{N} players", "Updated {date}", names, markers) but with a `View results` button (`data-action="view-results"`, `aria-label="View results {title}"`) wired to the existing `handleResume(gameId)` — it restores the game verbatim as `state.activeGame`; the view branches on status, so reopening is read-only. Unfinished cards keep `data-action="resume-game"`. Empty state copy becomes "No finished games yet." / "Finish a game and its standings will appear here." Finished games never render in the "Unfinished games" panel (its `status === "active"` filter already excludes them).
- **Prompt lifecycle**: `state.finishPromptOpen` (default `false`) renders only in the active view for a `status: "active"` game; it is cleared on cancel, on confirm, and wherever `scoreFeedback` is cleared on view changes (`resetSetup`, `handleResume`).
- **Sizing**: one confirmation flow + one read-only view variant + one home section — correctly sized for a single feature; no split needed.

## Acceptance Scenarios

### Scenario 1: Cancel leaves scoring fully working

Given an active game with at least one saved score
When the scorekeeper clicks "Finish game", sees the confirmation, and clicks "Cancel"
Then the prompt closes, focus returns to the "Finish game" opener, no state changed (totals, ranks, selection, `aria-pressed`, storage payload unchanged), and scoring still works: a new score saves with the unchanged success feedback and undo still reverses it.

### Scenario 2: Confirming locks the view

Given the same confirmation prompt
When the scorekeeper clicks the confirm "Finish game" button
Then the view re-renders read-only: eyebrow "Finished", a `role="status"` line "Final standings — this game is finished and can't be scored.", every player visible with final competition ranks and totals, zero `Add points` buttons, no score-entry panel, no `Save points`, no `Undo last score`; focus moves to the game heading, and the stored payload contains the game with `status: "finished"`.

### Scenario 3: Finished game persists and reopens read-only after reload

Given a just-finished game
When the scorekeeper reloads the page and inspects home
Then the game is listed under "Finished games" (not under "Unfinished games") with a "View results" control; opening it shows the read-only standings; and after another reload the final ranks and totals are identical (ranks derived at render time from stored totals; no rank fields persisted). Other saved games are untouched (upsert by id).

### Scenario 4: Finishing under broken storage stays honest

Given a session with `Storage.prototype.setItem` patched to throw (or a corrupt seeded payload causing `invalid`-read suppression)
When the scorekeeper confirms finishing
Then the in-memory view still becomes finished and read-only, the accepted storage notice explains the failure (no new error path), console diagnostics stay code-only with no uncaught errors, and no phantom finished card appears on home; under suppression the raw stored payload is byte-identical after finishing.

### Scenario 5: 320px layout and accessibility

Given the confirmation prompt and the finished view at a 320px viewport
Then nothing overflows horizontally; "Finish game", confirm, and Cancel are ≥44px, keyboard-operable (Enter/Space), and show visible focus; focus moves as specified (open → confirm button; cancel → opener; finish → heading); the read-only note uses `role="status"`; labels/contrast follow `DESIGN.md`.

## Repository Research

### Files Inspected

- `AGENTS.md`, `PROGRESS.md` — one-feature workflow; `handle-storage-failure` accepted (PR #11 merged at `415e481`); `CI=true ./init.sh` gate last verified passing 2026-10-12 (planner did not rerun it).
- `feature_list.json` — source entry with its three verification items and the irreversibility/complete-standings/next-slice notes.
- `CONTEXT.md`, `docs/build-brief.md`, `docs/domain-model.md` — "Finish preserves the final standings and makes the game read-only. Reopening for scoring is excluded."; finished games are "saved, read-only"; keep full standings; undo does not undo finishing.
- `docs/risks-and-open-questions.md` — clear confirmation required; finished games cannot reopen.
- `DESIGN.md` — distinct Finish game action; finished view shows read-only standings (+ Play again, out of scope); accessibility baseline and minimal-controls guidance; mockup placement is illustrative.
- `CONSTRAINTS.md` — saves happen exactly on successful game mutations (must gain the fourth trigger); undo never touches `game.status`; never persist ranks; storage notices/diagnostics rules.
- `ARCHITECTURE.md` — module boundaries, "Finishing, read-only final standings, replay, and saved-game deletion remain separate features."
- `src/main.js` — `state` shape; `render()` dispatch and full re-render + explicit refocus pattern; `renderHome` unfinished list (`status === "active"` filter) and the "Finished games" placeholder panel; `renderSavedGameCard`/`formatSavedGameUpdated` (reusable card markup); `handleResume` (restores verbatim, focuses heading — reusable for View results); `renderActiveGame`/`renderActivePlayer` (five-column grid rows with `Add points` + `aria-pressed`); `renderScoreForm` (Save points + Undo); `bindActiveEvents`; `persistActiveGameSnapshot` (suppression/rollback/clear semantics — reused unchanged); `paintStorageNotice`/`paintScoreFeedback` `replaceChildren` pattern; `escapeHtml`/`escapeAttribute`.
- `src/roster.js` — `createGame` sets `status: "active"`; game shape `{ id, title, status, createdAt, players }`.
- `src/score.js`, `src/standings.js`, `src/storage.js` — untouched: undo ignores status and never mutates it; `rankPlayers` derives render-time ranks; storage envelope/upsert/order helpers need no changes.
- `src/styles.css` — `.active-player` five-column grid with ≤480px/≤360px variants (finished rows need a buttonless variant), `.saved-game*` card styles (reusable for finished cards), `.storage-notice`, 8px rhythm, 44px targets, focus outline, `prefers-reduced-motion` block.
- `scripts/browser-resume-test.mjs` — session structure, `createGame`/`savePoints`/`goHome`/`resumeGame` helpers, `readHomeState`/`readActiveState` (extend patterns for the new suite); its scenarios never finish a game, so its `cards`/empty-state assertions stay valid.
- `scripts/browser-test-utils.mjs` — shared CDP helpers; `Page.addScriptToEvaluateOnNewDocument` for patching `setItem`; `readSavedGamesState` returns the raw payload for status/byte-identical checks.
- `scripts/static-server.mjs` (public-file set), `scripts/smoke.mjs` (asset checks), `init.sh` (required-file + `node --check` lists), `package.json` (`test` chain) — the wiring points a new `src/game.js` module and new test scripts must be added to (same precedent as `src/standings.js`/`src/storage.js`).
- Git state: `codex/finish-game` clean at `415e481` (= `main` = `origin/main`); `docs/specs/` has no `finish-game.md` yet.

### Existing Patterns To Follow

- Pure, non-mutating helpers per concern in `src/*.js`, each with a focused unit script wired into `package.json`/`init.sh`, plus one CDP browser suite per feature with isolated Chrome profiles, no-console-error and no-overflow assertions, 320px probes, and temp-dir screenshots.
- Full re-render + explicit refocus; feedback/live regions via `replaceChildren` painters; `role="status"` polite announcements; `aria-label`s on contextual controls ("Resume {title}" → "View results {title}").
- Honest test updates: never weaken existing suites; new behavior gets new assertions.

### Current Gaps

- No finish control exists anywhere; nothing sets `status: "finished"`; the active view has no read-only variant.
- Home's "Finished games" panel is a static placeholder ("Podiums will live here.").
- `finishGame` logic, the prompt, the finished card button, and their tests do not exist.

## Technical Approach

1. **`src/game.js` (new)** — pure `finishGame({ game, now = new Date() })` per Product Decisions (guards `missing-game`/`already-finished`, returns a new object with `status: "finished"`, never mutates input, no rank/`finishedAt` fields). Unit-tested in a new `scripts/game-test.mjs` (guards; immutability via structuredClone snapshot; players/changes/order untouched; double-finish rejected; works for a fresh zero-score game and a 20-player scored game).
2. **`src/main.js` — confirmation flow** — add `state.finishPromptOpen`; render a finish section in the score panel below the score form (outside the form element): opener "Finish game" (type `button`, distinct styling) swaps to the prompt (warning text + confirm "Finish game" with `aria-describedby` + "Cancel"). Handlers: open → set flag, render, focus confirm button; cancel → clear flag, render, focus opener; confirm → `finishGame`, on error set the appropriate score-style feedback (reuse `#score-feedback` region via `paintScoreFeedback`; add messages for `missing-game`/`already-finished` to `SCORE_ERROR_MESSAGES`), on success set `state.activeGame`, `state.finishPromptOpen = false`, call `persistActiveGameSnapshot()`, render (the finished branch renders), focus `[data-active-heading]`. Reset `finishPromptOpen` in `resetSetup` and `handleResume`.
3. **`src/main.js` — read-only finished view** — branch in `renderActiveGame` on `game.status === "finished"`: header (title/`[data-active-heading]`, players pill, eyebrow "Finished"), "All games" back control, `role="status"` read-only note, and the leaderboard reusing `rankPlayers(game)` rows rendered without the `Add points` button/`aria-pressed`/selection state (row/container variant class, e.g. `.is-final`, so the grid drops its button column).
4. **`src/main.js` — home Finished panel** — replace the placeholder: ordered list `aria-label="Finished games"` from `orderSavedGamesForDisplay` filtered to `status === "finished"`, cards mirroring `renderSavedGameCard` with a `View results` button bound to `handleResume(gameId)`; empty state with the new copy; unfinished panel and its filter unchanged.
5. **`src/styles.css`** — `.finish-action` (distinct from Save/Undo, 44px, AA contrast), prompt styles, `.is-final` grid variants (desktop five→four columns; ≤480px/≤360px areas without the button), `.finished-*` card reuse (mostly inherits `.saved-game`), 320px checks.
6. **Tests and wiring** — new `scripts/browser-finish-game-test.mjs` covering Scenarios 1–5 (reuse `browser-resume-test.mjs` helper patterns; a setItem-throws session for Scenario 4; optionally a corrupt-payload session asserting byte-identical `raw`). Register `src/game.js` in `scripts/static-server.mjs` + `scripts/smoke.mjs`; add `test:game` and `test:browser:finish-game` to `package.json`'s `test` chain; add `src/game.js` to `init.sh` required files and `node --check` for the module and both new scripts. Gate stays non-blocking.
7. **Docs** — README (behavior + commands), ARCHITECTURE (game lifecycle boundary, new module/script, fourth save trigger), CONSTRAINTS (durable rules below); record evidence.

## Expected File Changes

- `src/game.js` — create; pure `finishGame` transition.
- `src/main.js` — modify; finish prompt state/render/handlers, finished read-only branch, home Finished section, focus management, reset hooks.
- `src/styles.css` — modify; finish action, prompt, finished row/grid variants, finished cards.
- `scripts/game-test.mjs` — create; pure transition checks.
- `scripts/browser-finish-game-test.mjs` — create; Scenarios 1–5 on headless Chrome.
- `scripts/static-server.mjs` — modify; allowlist `src/game.js`.
- `scripts/smoke.mjs` — modify; asset check for `src/game.js`.
- `package.json` — modify; add `test:game` and `test:browser:finish-game` to the chain.
- `init.sh` — modify; required-file check for `src/game.js`; `node --check` for `src/game.js`, `scripts/game-test.mjs`, `scripts/browser-finish-game-test.mjs`. Must not start a long-running server.
- `README.md` — update; finishing/read-only/finished-section behavior + new commands.
- `ARCHITECTURE.md` — update; `src/game.js` boundary, finished-view variant, home Finished list, fourth save trigger.
- `CONSTRAINTS.md` — update; durable rules: finishing is the one-way `active → finished` transition via `finishGame` (no un-finish); a `status: "finished"` game renders read-only (no score/undo controls) and reopening never restores mutations; finishing persists through `persistActiveGameSnapshot()` as the fourth successful-mutation save trigger; ranks still never persisted.
- `AGENTS.md` — not needed; workflow and commands unchanged.
- `index.html`, `src/roster.js`, `src/score.js`, `src/standings.js`, `src/storage.js`, `scripts/browser-*.mjs` (existing suites) — not needed; unchanged (existing suites must still pass without modification).
- `PROGRESS.md`, `feature_list.json` — updated with actual evidence during implementation/validation, not by this planner.

## Visual Design Impact

- UI involved: yes.
- Design source: `DESIGN.md` (accepted tokens, active/finished screen descriptions, accessibility baseline) and existing panel/card/button patterns; no new screens.
- Screens or states affected: active game (new finish section + inline prompt; new finished read-only variant with "Finished" eyebrow and status note) and home ("Finished games" panel gains real cards + new empty state). No motion; no new tokens required.
- New design artifact required: no — exact finish-action styling is an implementation choice within the accepted tokens, subject to the 44px/contrast checks. Placement deviation from the mockup (score panel vs. header) is documented above as deliberate.

## Durable Documentation Impact

- `ARCHITECTURE.md`: update — new module boundary, finished rendering variant, home finished list, fourth save trigger.
- `CONSTRAINTS.md`: update — durable MUST rules listed under Expected File Changes (one-way finish, read-only finished rendering, fourth save trigger, never persist ranks).
- `AGENTS.md`: not needed — no workflow, startup, or operating-rule changes.
- `README.md`: update — user-visible behavior and test commands.
- Other docs: none — `CONTEXT.md`/`docs/domain-model.md` already state the lifecycle; no source-of-truth change.

## Implementation Plan

1. Add `src/game.js` with `finishGame` and `scripts/game-test.mjs`; wire `test:game`, `init.sh` checks, server allowlist, and smoke asset check; keep every existing suite green.
2. Implement the confirmation flow and finished read-only branch in `src/main.js` (state, render branches, handlers, focus management, feedback error codes).
3. Replace the home Finished placeholder with the finished list, cards, and empty state; wire View results through `handleResume`.
4. Style the finish action, prompt, finished rows/cards in `src/styles.css`; verify contrast and 320px.
5. Create `scripts/browser-finish-game-test.mjs` for Scenarios 1–5; wire into `package.json` and `init.sh`.
6. Update `README.md`, `ARCHITECTURE.md`, `CONSTRAINTS.md`; run the full verification plan and record evidence.

## Implementation Tasks

- [ ] Create `src/game.js` (`finishGame` with `missing-game`/`already-finished` guards, immutability, no extra fields) and `scripts/game-test.mjs`; wire `test:game` into `package.json`, the module into `scripts/static-server.mjs`/`scripts/smoke.mjs`, and both files into `init.sh`; `npm run test:game` green.
- [ ] Add `state.finishPromptOpen` and the finish section (opener → prompt with confirm/cancel) to the score panel in `src/main.js`, with focus management (open → confirm button, cancel → opener) and `SCORE_ERROR_MESSAGES` entries for the new codes.
- [ ] Implement confirm: `finishGame` → `state.activeGame` → `persistActiveGameSnapshot()` → render → focus heading; clear the prompt flag; keep suppression/rollback behavior untouched.
- [ ] Add the finished read-only branch of the active view (eyebrow "Finished", `role="status"` note, full ranked standings without Add points/aria-pressed/score panel/undo, back control).
- [ ] Replace the home "Finished games" placeholder with the finished ordered list ("View results" cards via `handleResume`) and the new empty-state copy; leave the unfinished panel untouched.
- [ ] Style the new controls/variants in `src/styles.css` (≥44px targets, AA contrast, visible focus, no 320px overflow).
- [ ] Create `scripts/browser-finish-game-test.mjs` covering Scenarios 1–5 (cancel-then-score-then-undo, locked view assertions, reload/reopen with identical ranks/totals, setItem-throws finish with code-only warnings, 320px/keyboard/`role="status"` checks, no console errors); wire `test:browser:finish-game` into `package.json` and `init.sh`.
- [ ] Update `README.md`, `ARCHITECTURE.md`, `CONSTRAINTS.md`.

## Verification Plan

- `node --check src/game.js src/main.js scripts/game-test.mjs scripts/browser-finish-game-test.mjs` — expected: all pass.
- `npm run test:game` — expected: guards, immutability, field preservation, double-finish rejection green.
- `npm run test:browser:finish-game` — expected: Scenarios 1–5 pass on real headless Chrome, including stored `status: "finished"`, unchanged ranks/totals after reload/reopen, and byte-identical payload under suppression.
- `npm run test` — expected: all unit suites, smoke, and all seven browser suites (six existing + new) pass; existing suites unmodified.
- `./init.sh` and `CI=true ./init.sh` — expected: required-file checks, all `node --check` entries (including the new module and scripts), and the full `npm run test` chain pass; the gate exits without starting a long-running server and only prints the manual `npm run dev` follow-up.
- `npm run dev` + manual real-browser pass (1280×800 and 320×720): finish a game, cancel, re-finish, verify the locked view and home sections; reload and reopen to confirm standings.
- Feature-list verification mapping: "Cancel finishing and confirm scoring still works; then finish and verify score/undo mutations are unavailable" → Scenarios 1–2; "Reload and reopen the finished game; verify final ranks and totals remain unchanged" → Scenario 3; `CI=true ./init.sh` → gate runs above.
- E2E note: no persistent E2E harness exists in this repo; the focused CDP browser suite is the established browser-flow coverage and is included. Unit + browser coverage is sufficient because the feature is local UI/storage behavior with no routing, auth, or API surface.
- Responsive and accessibility verification: Scenario 5 plus the manual 320px pass; focus management and `role="status"` asserted in tests; keyboard operability (Enter/Space on all new buttons) asserted; contrast checked in the manual pass.

For `init.sh`, be explicit:

- `./init.sh` executes the non-blocking standard gate (required files, `node --check` list including the new files, full `npm run test`).
- It must not start long-running processes such as `npm run dev`; it may print the manual server command after checks pass.

## Evidence To Capture

- Exact commands and results for `npm run test:game`, `npm run test:browser:finish-game`, `npm run test`, `./init.sh`, and `CI=true ./init.sh`.
- Browser proof points: cancel → scoring/undo still work; confirm → zero `Add points` buttons and no score/undo controls; stored payload `status: "finished"`; reload/reopen → identical final ranks/totals; under blocked/suppressed writes → read-only in-memory finish, code-only warnings, byte-identical raw payload, no phantom card.
- Confirmation that console diagnostics remain code-only and that no uncaught console errors appear in any session.
- Screenshot paths from the new suite (desktop + 320px), noting if they could not be opened for visual inspection.
- Update `feature_list.json` evidence and the `PROGRESS.md` session log with these results (implementer/validator step).

## Validator Checklist

- [ ] Implementation stays within `finish-game` scope: confirmation flow + read-only finished view + home Finished section only.
- [ ] No podium/confetti/modal, no Play again, no un-finish/reopen-for-scoring, no deletion, no changes to score/undo/rank semantics, storage format, or `src/storage.js`.
- [ ] Cancel restores scoring fully (save + undo verified); confirm renders the locked view with all players, final ranks, and totals, and no mutation controls.
- [ ] Finishing persists via the existing storage path; the stored entry is the game verbatim with `status: "finished"`; no ranks or new fields persisted; other saved games untouched.
- [ ] Home lists finished games under "Finished games" only, with "View results" reopening read-only standings; unfinished panel behavior unchanged.
- [ ] Storage-suppression interplay matches accepted behavior: in-memory finish stays read-only, no phantom card, byte-identical payload under `invalid` suppression, code-only diagnostics.
- [ ] Focus management matches spec (open → confirm, cancel → opener, finish → heading); prompt copy matches spec; read-only note uses `role="status"`.
- [ ] 320px: no horizontal overflow, ≥44px targets, visible focus, keyboard operability; no uncaught console errors anywhere.
- [ ] `npm run test`, `./init.sh`, and `CI=true ./init.sh` pass with the new checks; `init.sh` did not start a server.
- [ ] `README.md`, `ARCHITECTURE.md`, `CONSTRAINTS.md` updated; `feature_list.json` evidence and `PROGRESS.md` record real checks.
- [ ] No unrelated product behavior or extra feature work was added.
