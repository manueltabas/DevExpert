# Feature Implementation Spec: Undo the latest score change

## Source Feature

- `id`: `undo-latest-score`
- `area`: `scoring`
- `depends_on`: [`rank-leaderboard`] (accepted and merged into `main`, PR #7, merge commit `8353be6` — verified: `codex/undo-latest-score` HEAD is `8353be6` with a clean tree)
- `status`: `not_started` at planning time
- `source`: `feature_list.json`

## Goal

Give the scorekeeper an "Undo last score" control in the active game that reverses the most recent score change: the affected player's total is restored, the change is removed from the in-memory `game.changes` log, and totals, row order, and ranks update immediately. Pressing undo repeatedly walks backward through the change history one change at a time; undoing past the start of history is a safe, announced no-op.

Everything stays in memory and render-time: no persistence, no rank storage, no interaction with finishing.

## Non-Goals

- No persistence or localStorage writes; reload still discards the game, so "undo after reload" is undefined here. `resume-saved-game` owns persistence and saved-log undo behavior.
- No interaction with finishing: undo never touches `game.status`, never "unfinishes" a game, and no finished-game UI exists yet. `finish-game` will gate score/undo controls later.
- No redo, no selective/arbitrary-history undo, no visible change-history list, no edit of a past change.
- No changes to score-entry validation, ranking semantics, or roster behavior.
- No stored rank fields; ranks remain render-time-only via `rankPlayers`.
- No framework, build step, backend, or new npm dependencies.

## Job Story

When I fat-finger a points entry or the table agrees a score was recorded for the wrong player,
I want to undo the latest score change with one control,
so the totals and leaderboard are corrected instantly without me remembering what the old numbers were.

## Users And Permissions

- Scorekeeper: the only actor. Can undo score changes in the active in-progress game from the same device. No sign-in, sharing, or remote access exists.

## Product Decisions Resolved For This Slice

These resolve the choices flagged in `feature_list.json` notes ("Resolve repeated-undo depth in the spec. Undo applies to scores, not finishing."), `docs/domain-model.md` ("Further undo depth is an implementation-time decision"), and `docs/risks-and-open-questions.md` ("define whether repeated presses walk backward and whether the latest undo survives reload"):

- **Repeated-undo depth — unlimited, one change per activation**: each activation removes the newest entry from `game.changes` and reverses exactly that amount on its recipient. Pressing repeatedly walks backward through history until the log is empty. Rationale: the control label is "Undo last score" (per `DESIGN.md`), which naturally means "the latest remaining change" every time; the ordered log from `add-player-score` already stores everything needed; and a one-shot-forever undo would be surprising once scores accumulate. Only latest-change undo is promised product behavior; the depth is an implementation choice made here.
- **Empty-log behavior — enabled button with informational feedback, not a disabled button**: the undo control stays enabled at all times. Activating it when `game.changes` is empty/missing changes nothing and announces "Nothing to undo yet." through the existing `#score-feedback` `aria-live="polite"` region without re-rendering. A disabled button was rejected because disabled controls drop keyboard focus, do not announce *why*, and would need re-render-driven toggling; a polite announcement is more accessible and matches the existing feedback pattern.
- **Feedback**: a successful undo announces "Undid {amount} points for {name}. New total: {total}. Rank: {rank}." where the rank is the affected player's rank after the undo, computed from `rankPlayers(result.game)`. The `{amount}` is the raw signed amount from the log, consistent with the save message ("Added -3 points…" is already the save pattern). Reuse the `#score-feedback` aria-live region. The empty-log no-op is informational, not an error: add a third feedback kind `info` rendered with a new `.info-message` class (muted `var(--muted)` text) so it does not read as a failure; existing `success`/`error` kinds are unchanged.
- **Selection — unchanged by undo**: undo is a correction action, not a selection action. `selectedPlayerId` and the row `aria-pressed` state stay exactly where they are; the feedback sentence names the affected player so the scorekeeper knows whose total moved. This mirrors the rank-leaderboard rule that saves never change selection.
- **Focus and typed input**: a successful undo follows the established full re-render model (`renderActiveGame()` rebuilds via `innerHTML`), then explicitly refocuses **the undo button itself** so repeated Enter/Space presses walk backward through history without re-navigating. The amount input is cleared by the re-render and typed drafts are not preserved — consistent with today's row-selection behavior, which also discards drafts on re-render. The empty-log no-op repaints feedback only (like the error path) and never moves focus.
- **Undo applies to scores, not finishing**: `undoLastScoreChange` operates purely on the change log and player totals and must never read or write `game.status`. Guarding against finished games is future work owned by `finish-game` (per `CONSTRAINTS.md`, do not implement future behavior speculatively).
- **Module placement — `src/score.js`, no new module**: the change log is owned by `src/score.js`, so `undoLastScoreChange` lives there. This means no new public file: `scripts/static-server.mjs` and `scripts/smoke.mjs` need no changes.

## Acceptance Scenarios

### Scenario 1: Undo restores only the latest recipient

Given an active game where Alex has +10 and Sam has +5 applied in that order (log: [+10 Alex, +5 Sam])
When the scorekeeper activates "Undo last score"
Then Sam's total returns to 0, Alex's total stays 10, the log has one entry remaining, the feedback announces "Undid 5 points for Sam. New total: 0. Rank: {Sam's new rank}.", the selected player and `aria-pressed` state are unchanged, and rows/ranks reflect the corrected totals.

### Scenario 2: Undo with no change is a safe no-op

Given a fresh game with no score changes (or a game whose log was fully undone)
When the scorekeeper activates "Undo last score"
Then totals, ranks, selection, and the change log are unchanged, the region announces "Nothing to undo yet." in the informational (non-error) style, and the view is not re-rendered.

### Scenario 3: Undo after a negative change

Given the latest change is −3 for Alex (total −3)
When the scorekeeper activates "Undo last score"
Then Alex's total returns to the prior value, the feedback announces the undone amount as "−3" (e.g. "Undid -3 points for Alex. New total: 0. Rank: …"), and no other total changes.

### Scenario 4: Repeated undo walks backward, then stops safely

Given changes +10 (Alex), +12 (Sam), +8 (Jamie) applied in that order
When the scorekeeper activates undo three times in a row (keyboard Enter is fine)
Then after each activation exactly one change is reversed (Jamie's 8 → 0, then Sam's 12 → 0, then Alex's 10 → 0), each activation leaves focus on the undo button, ranks and row order correct themselves each time, and a fourth activation produces the Scenario 2 no-op.

### Scenario 5: Undo corrects the leaderboard immediately

Given two players separated by a few points where the latest change caused an overtake
When the scorekeeper undoes that change
Then rows reorder immediately to the pre-change order, ranks display corrected competition ranks, and no rank field is stored anywhere.

### Scenario 6: 320px and keyboard accessibility

Given a 320px-wide viewport with a scored game
Then the undo control is visible in the score panel below "Save points", has a ≥44px touch target, a visible focus style, and is operable by keyboard (Enter/Space); there is no horizontal page overflow; the panel stacking behavior is unchanged.

## Repository Research

### Files Inspected

- `AGENTS.md`, `PROGRESS.md` — one-feature workflow; `rank-leaderboard` accepted 2026-10-12 and `undo-latest-score` named as next; localhost binding may need permission outside the sandbox.
- `feature_list.json` — source entry and its three verification items (two-player undo, no-change undo, negative-change undo, `CI=true ./init.sh`); notes directing depth resolution to this spec.
- `CONTEXT.md`, `docs/build-brief.md`, `docs/domain-model.md` — "Undo reverses the most recent score change… It does not undo finishing"; change log is an ordered sequence per game.
- `docs/risks-and-open-questions.md` — repeated-undo depth and reload survival are implementation-time decisions; reload survival is deferred to persistence here.
- `DESIGN.md` — active-game control list includes "Undo last score" as a small action near score entry; focus preservation and 320px rules.
- `CONSTRAINTS.md` — change-log rule (`{ id, playerId, amount }` appended per applied change); "do not implement future game behavior inside placeholder shell controls".
- `ARCHITECTURE.md` — boundaries currently say the app "does not offer undo"; must be revised.
- `src/score.js` — `MAX_SCORE_ABS`, `parseScoreAmount`, `applyScoreChange` (appends to `game.changes`, never mutates input, safe-integer guard). The undo helper must match these conventions. Note: fresh `createGame` games have **no `changes` property** (undefined), so the helper must treat missing/empty/non-array logs as "nothing to undo".
- `src/roster.js` — `createGame` player shape `{ id, name, color, marker, order, total }`; no status gating anywhere yet.
- `src/standings.js` — `rankPlayers(game)` render-time ranking; undo needs no changes here.
- `src/main.js` — active view: `renderActiveGame` (full re-render), `renderScoreForm` (panel with labeled input, `#score-feedback` aria-live, Save points submit), `handleScoreSubmit` (parse → apply → message with new total/rank → render → refocus `#score-amount`), `rejectScoreEntry`/`paintScoreFeedback` (feedback repaint without re-render), `state.scoreFeedback` kinds `success`/`error`, `SCORE_ERROR_MESSAGES` map.
- `src/styles.css` — tokens (`--muted`, `--success`, `--primary`…), `.score-form` grid, `.primary-action`/`.secondary-action`/`.ghost-action` buttons, `.validation-message`/`.success-message`, 44px target pattern, ≤720px single-column stack.
- `scripts/score-test.mjs` — pure unit pattern (`node:assert/strict`), covers change-log appends and immutability; the natural home for undo unit cases.
- `scripts/browser-rank-test.mjs`, `scripts/browser-score-test.mjs`, `scripts/browser-test-utils.mjs` — CDP scenario pattern: isolated headless Chrome, `readRankState`-style page snapshots, sentinel-DOM checks, `localStorage.length === 0`, no-console-error assertions, 320px layout probes.
- `scripts/static-server.mjs` / `scripts/smoke.mjs` — explicit allowlist already covers all `src/*.js`; **no changes needed** since no new module is created.
- `package.json`, `init.sh` — `test` chains roster/standings/score/smoke/browser suites; gate = required files + `node --check` per source/test script + `npm run test`; a new browser script must be added to both.
- Git state: branch `codex/undo-latest-score` checked out, clean, at `8353be6` (PR #7 merge) — dependency merged into `main`.

### Existing Patterns To Follow

- Pure logic in DOM-free ES modules; all rendering/events in `src/main.js`; Node unit tests import pure modules directly.
- Full-view re-render + explicit refocus after state changes; feedback repaints without re-render for non-mutating outcomes.
- `aria-live="polite"` feedback via `#score-feedback`; labeled controls; ≥44px targets; visible `:focus-visible` outlines.
- One focused browser test script per feature against the in-process static server; CDP scripts are this repo's browser-flow coverage (no Playwright/persistent E2E harness exists).

### Current Gaps

- No undo logic or control anywhere; `game.changes` is append-only and never read.
- No `info` feedback kind; only `success`/`error` exist in `state.scoreFeedback` and CSS.
- No undo unit or browser coverage; `ARCHITECTURE.md`/`CONSTRAINTS.md` describe undo as not yet implemented.

## Technical Approach

1. **Pure helper in `src/score.js`** — add `undoLastScoreChange({ game })`:
   - Read `game?.changes`; if it is not a non-empty array → `{ game: null, undone: null, error: "nothing-to-undo" }`.
   - Pop the last change `{ id, playerId, amount }`. Find the player by `playerId`; missing → `{ game: null, undone: null, error: "unknown-player" }` (defensive).
   - Compute `nextTotal = player.total - change.amount`; if not a safe integer → `{ game: null, undone: null, error: "not-safe" }` (defensive, mirrors `applyScoreChange`).
   - On success return `{ game, undone, error: null }` where `game` is a **new** object with that player's total restored and `changes = changes.slice(0, -1)`; `undone` is the popped change (main.js uses it for the message). Input game never mutated; `game.status`, `player.order`, and all other fields untouched; no rank writes.
   - Add `"nothing-to-undo"` to the exported `SCORE_ERROR_CODES`.
2. **UI in `src/main.js`**:
   - In `renderScoreForm`, after the "Save points" submit button add `<button type="button" class="secondary-action" data-action="undo-last-score">Undo last score</button>` (type `button` so it never submits the form).
   - Add `handleUndo()` wired in `bindActiveEvents`: call `undoLastScoreChange({ game: state.activeGame })`. On `nothing-to-undo`: set `state.scoreFeedback = { kind: "info", message: "Nothing to undo yet." }` and `paintScoreFeedback()` only — no re-render, no focus change. On other errors: reuse the existing error path. On success: build the message `Undid ${undone.amount} points for ${affectedPlayer.name}. New total: ${total}. Rank: ${rank}.` (rank from `rankPlayers(result.game)`), set `state.scoreFeedback` kind `success`, assign `state.activeGame = result.game`, `render()`, then `appRoot.querySelector("[data-action='undo-last-score']")?.focus()`.
   - Extend `renderScoreFeedback`/`paintScoreFeedback` to map kind `info` → new class `info-message`.
3. **Styling in `src/styles.css`**:
   - Add `.info-message` (muted `var(--muted)` text, same weight/size pattern as `.success-message`).
   - Ensure the undo button meets the ≥44px target inside `.score-form`'s grid (reuse existing button styles; no new layout columns; ≤720px stacking untouched).
4. **Tests** — see Verification Plan: extend `scripts/score-test.mjs`; add `scripts/browser-undo-test.mjs`; wire `test:browser:undo` into `package.json` and `init.sh`.

## Expected File Changes

- `src/score.js` — modify; add `undoLastScoreChange`, `nothing-to-undo` error code.
- `src/main.js` — modify; undo button in the score form, `handleUndo`, `info` feedback kind, success message with corrected total/rank, refocus undo button.
- `src/styles.css` — modify; `.info-message` style; confirm/keep 44px undo-button target.
- `scripts/score-test.mjs` — modify; unit cases for `undoLastScoreChange` (Scenarios 1–4 properties at the helper level: latest-only reversal, empty/missing log, negative amounts, repeated undos, immutability, no status writes, no rank writes).
- `scripts/browser-undo-test.mjs` — create; focused browser scenarios (Scenarios 1–6), following `browser-rank-test.mjs` patterns.
- `package.json` — modify; add `test:browser:undo` and chain it into `test`.
- `init.sh` — modify; add `node --check scripts/browser-undo-test.mjs`. No new required files (no new src module), so the required-file list is unchanged.
- `README.md` — update; usage mention (undo the latest change) and the new test command.
- `ARCHITECTURE.md` — update; scoring module description gains `undoLastScoreChange`; commands list gains `test:browser:undo`; revise the Boundaries sentence that says the app "does not offer undo".
- `CONSTRAINTS.md` — update; durable undo rule: undo pops the newest `{ id, playerId, amount }` entry, subtracts it from that player's total, an empty log is a no-op, it never mutates the input game, never touches `game.status`, and never stores ranks — so persistence/finish/replay slices inherit it.
- `AGENTS.md` — not needed; workflow, commands, and operating rules unchanged.
- `index.html`, `src/roster.js`, `src/standings.js`, `scripts/static-server.mjs`, `scripts/smoke.mjs`, existing browser tests — not needed; no changes required (allowlist already serves `src/score.js`).
- `PROGRESS.md`, `feature_list.json` — update with actual evidence during implementation/validation, not by this planner.

## Visual Design Impact

- UI involved: yes.
- Design source: `DESIGN.md` (active-game controls list includes "Undo last score" as a small action; concept mockup places it near the score-entry panel; preserve focus; no 320px overflow).
- Screens or states affected: active game only — one new button inside the existing score-entry panel and one new feedback message style. No new panels, pages, motion, or layout changes.
- New design artifact required: no.

Follow accepted tokens: undo uses an existing secondary button style (visibly weaker than the primary "Save points"), no color-only meaning, no animation introduced, reduced-motion rules untouched.

## Durable Documentation Impact

- `ARCHITECTURE.md`: update — scoring module gains the undo helper; boundaries sentence changes from "does not offer undo" to describing latest-change undo; new browser script listed.
- `CONSTRAINTS.md`: update — durable undo rule (newest-entry reversal, empty-log no-op, immutability, status untouched, no rank writes) so later slices inherit it.
- `AGENTS.md`: not needed — no workflow or command changes beyond the existing gate.
- `README.md`: update — usage and command list.
- Other docs: none — undo semantics already live in `docs/domain-model.md`; no source-of-truth change.

## Implementation Plan

1. Add `undoLastScoreChange` to `src/score.js` (with `nothing-to-undo` in `SCORE_ERROR_CODES`).
2. Extend `scripts/score-test.mjs` with undo unit cases; keep all existing cases green.
3. Wire the undo button, `handleUndo`, and the `info` feedback kind into `src/main.js`; add `.info-message` and button styling in `src/styles.css`.
4. Add `scripts/browser-undo-test.mjs`; wire `test:browser:undo` into `package.json` and the `init.sh` syntax-check list.
5. Update `README.md`, `ARCHITECTURE.md`, `CONSTRAINTS.md`.
6. Run the full gate and real browser checks at desktop and 320px; record evidence.

## Implementation Tasks

- [ ] Implement `undoLastScoreChange({ game })` in `src/score.js`: latest-entry pop, total restore, `{ game, undone, error }` result, `nothing-to-undo` for missing/empty/non-array logs, defensive `unknown-player`/`not-safe`, input never mutated, `game.status` untouched.
- [ ] Add `"nothing-to-undo"` to `SCORE_ERROR_CODES`.
- [ ] Extend `scripts/score-test.mjs`: undo restores only the latest recipient (+10 Alex, +5 Sam → undo → Sam 0, Alex 10, log length 1); undo after a negative change; repeated undos drain the log in reverse order then report `nothing-to-undo`; missing `changes` (fresh `createGame`) → `nothing-to-undo`; `structuredClone` snapshot proves input immutability; undone change equals the popped log entry; status/other fields unchanged.
- [ ] Update `src/main.js`: add the "Undo last score" `type="button"` (`data-action="undo-last-score"`, `secondary-action`) inside `.score-form` after "Save points"; add `handleUndo` with success re-render + refocus of the undo button; add `info` kind and the "Nothing to undo yet." message (repaint without re-render); extend feedback renderers for `info`.
- [ ] Update `src/styles.css`: `.info-message` (muted color); verify undo button ≥44px in desktop and stacked ≤720px layouts.
- [ ] Add `scripts/browser-undo-test.mjs` covering Scenarios 1–6: two-player undo (only latest recipient restored; feedback names Sam; selection/`aria-pressed` unchanged; focused element is the undo button after undo), no-change no-op (info message, DOM sentinel survives — no re-render, totals unchanged), negative-change undo, three-press walk-back then safe stop, overtake correction (row order/ranks revert), 320px checks (button visible, ≥44px, keyboard Enter activation, no horizontal overflow, visible focus), plus `localStorage.length === 0` and no console errors.
- [ ] Update `package.json` (`test:browser:undo`, chained into `test`) and `init.sh` (`node --check scripts/browser-undo-test.mjs`).
- [ ] Update `README.md`, `ARCHITECTURE.md`, `CONSTRAINTS.md`.

## Verification Plan

- `node --check src/score.js && node --check src/main.js && node --check scripts/score-test.mjs && node --check scripts/browser-undo-test.mjs` — expected: all pass.
- `npm run test:score` — expected: all pre-existing cases still pass plus the new undo cases (latest-only reversal, negative amounts, drain-then-nothing-to-undo, immutability, missing-log handling).
- `npm run test:browser:undo` — expected: all six browser scenarios pass on headless Chrome, including the no-re-render no-op assertion and the 320px/keyboard checks.
- `npm run test` — expected: roster, standings, score, smoke, and all browser suites pass with the new undo suite chained in.
- `./init.sh` and `CI=true ./init.sh` — expected: the standard gate runs every syntax check (including the new browser script) and the full `npm run test` chain, then exits without starting a long-running server. `init.sh` must keep executing the non-blocking checks and only print the manual `npm run dev` follow-up; no long-running processes.
- `npm run dev` + manual real-browser pass (desktop 1280×800 and 320×720): apply +10 to one player and +5 to another, press "Undo last score", confirm only the latest recipient's total reverts, ranks reorder if the undo changes ordering, feedback announces the undone change, repeated undo walks back, and undo on a fresh game announces "Nothing to undo yet." without error styling.
- Feature-list verification mapping: "Apply changes to two different players; undo the latest and verify only its recipient total is restored" → Scenarios 1/5; "Check undo when there is no change and after a negative change" → Scenarios 2/3; `CI=true ./init.sh` → gate runs above.
- E2E note: no persistent E2E harness exists in this repo; the focused CDP browser script is the established browser-flow coverage and is included above. Unit + browser coverage is sufficient because the feature is a local UI/log mutation with no routing, auth, or API surface.
- Responsive and accessibility verification: Scenario 6 in the browser test plus the manual 320px pass (≥44px target, visible focus, keyboard operable, no overflow, panel stacking unchanged); `aria-live` announcement asserted via `#score-feedback` text.

## Evidence To Capture

- Output summaries for `npm run test:score`, `npm run test:browser:undo`, `npm run test`, `./init.sh`, and `CI=true ./init.sh` (exact commands and results).
- Browser scenario results for Scenarios 1–6, including: only the latest recipient restored, the "Nothing to undo yet." info announcement with no re-render (sentinel survived), repeated-undo walk-back, and the undo-button refocus assertion.
- Screenshot paths from `scripts/browser-undo-test.mjs` (desktop and 320px), with a note if they could not be opened for visual inspection this session.
- Confirmation that undo writes no localStorage data, stores no rank fields, and leaves `game.status` untouched.
- Update `feature_list.json` evidence and the `PROGRESS.md` session log with these results (implementer/validator step).

## Validator Checklist

- [ ] Implementation stays within `undo-latest-score` scope: latest-change undo + corrected totals/ranks only.
- [ ] No persistence/localStorage writes, no redo/history UI, no finish/lock interaction, no changes to `game.status`, no stored rank fields.
- [ ] Repeated undo walks backward one change per activation; empty-log activation is an announced no-op that does not re-render.
- [ ] Undo restores only the latest change's recipient; other totals and the remaining log are untouched; the input game is never mutated.
- [ ] Feedback names the affected player with corrected total and render-time rank; selection and `aria-pressed` are unchanged by undo.
- [ ] Successful undo re-renders and refocuses the undo button; the button is keyboard operable with a visible focus style and a ≥44px target.
- [ ] 320px: undo control visible below "Save points", no horizontal overflow, keyboard activation works.
- [ ] `npm run test`, `./init.sh`, and `CI=true ./init.sh` pass with the new focused checks; `init.sh` did not start a server.
- [ ] `ARCHITECTURE.md`, `CONSTRAINTS.md`, `README.md` updated; `feature_list.json` evidence and `PROGRESS.md` record real checks.
- [ ] No unrelated product behavior or extra feature work was added.
