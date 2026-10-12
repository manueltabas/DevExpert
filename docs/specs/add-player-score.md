# Feature Implementation Spec: Apply a signed score change

## Source Feature

- `id`: `add-player-score`
- `area`: `scoring`
- `depends_on`: [`create-game-roster`] (accepted and merged into `main`, PR #5)
- `status`: `not_started` at planning time
- `source`: `feature_list.json`

## Goal

Let the scorekeeper add a positive or negative whole-number amount to one player in the active in-memory game and see that player's total update immediately, without changing any other player's total. The active game records an ordered log of applied score changes so later slices (ranking, undo) can build on it, but this slice ships only entry and display.

The current active-game view renders every player with a hardcoded `0`. This slice replaces that with live totals plus a score-entry control, following the accepted design concept: leaderboard-style roster rows with an "Add points" action and an adjacent compact entry panel.

## Non-Goals

- No undo UI or undo controls; `undo-latest-score` is a later feature. This slice only records the change log it will consume.
- No leaderboard sorting, rank numbers, or reordering; `rank-leaderboard` owns that. Roster rows stay in creation order.
- No localStorage persistence, saved-game history, or resume; the game stays in memory and reload still discards it.
- No finish/lock behavior, podium, play again, round tracking, or editing/deleting past score changes.
- No requirement to enter scores for every player, no per-round entry, no mandatory zero entries.
- No framework, build step, backend, accounts, or new npm dependencies.

## Job Story

When a player scores or takes a penalty at the table,
I want to pick that player, type signed points, and save,
so their total is correct immediately and nobody else's total moves.

## Users And Permissions

- Scorekeeper: the only actor. Can select any player in the active game and apply one signed integer score change at a time. No sign-in, sharing, or remote access exists.

## Product Decisions Resolved For This Slice

These resolve the open items flagged in `feature_list.json` notes and `docs/risks-and-open-questions.md` ("Scores: set safe integer bounds, reject decimals and non-numbers, and decide whether a zero entry is ignored"):

- **Safe bounds**: a score change must be an integer with magnitude at most `1,000,000` (`MAX_SCORE_ABS = 1_000_000`, so allowed range is −1,000,000…1,000,000). Rationale: far beyond any real board game, keeps large tabular numerals readable, and even 20 players accumulating many max entries stay far below `Number.MAX_SAFE_INTEGER` (≈9.007e15). Defensive invariant: reject any change whose resulting total would not be a safe integer (a one-line guard; practically unreachable but makes "unsafe amounts" impossible).
- **Zero handling**: a zero entry is rejected with a gentle validation message. No total changes and no change-log entry is created. Rationale: `CONTEXT.md` defines a score change as an amount *added* to a total; recording zeros would pollute the future undo history with no-op steps.
- **Entry UI**: each roster row gains an "Add points" button that selects that player (per the accepted design concept). A score-entry panel shows the selected player's marker and name, a labeled signed integer input, helper text "Use negative points for penalties", and a "Save points" button. Desktop places the panel beside the roster; at ≤720px it stacks below. Default selection: the first player.
- **Input mechanics**: use `<input type="number" step="1" min="-1000000" max="1000000">` with an associated label; `type="number"` exposes a mobile keypad including the minus sign. Validation is still done in JavaScript on the parsed value (number inputs can receive `.`/`e`/pasted text). Semantic parsing is used: any value `Number()` parses to an in-range nonzero integer is accepted (so `"1e3"` is accepted as `1000`).
- **Feedback**: success clears the input, keeps focus in the input for rapid entry, and announces via an `aria-live="polite"` region, e.g. "Added 10 points to Alex. New total: 42." Errors are announced in the same region with focus staying in the input.
- **Change log**: each applied change appends `{ id, playerId, amount }` to `game.changes` (ordered, in-memory), per `docs/domain-model.md` ("a game contains players and an ordered sequence of score changes"). Timestamps optional. No persistence.

## Acceptance Scenarios

### Scenario 1: Apply +10 then −3 to one player

Given an active game with at least two players, all totals at zero
When the scorekeeper selects a player, enters `10`, and saves, then enters `-3` and saves
Then that player's total shows `7` immediately after each save, every other player still shows `0`, and the input is cleared and ready for the next entry.

### Scenario 2: Other players are unaffected

Given a game where Alex has total `10`
When the scorekeeper selects Sam and saves `5`
Then Sam shows `5`, Alex still shows `10`, and totals of all other players are unchanged.

### Scenario 3: Invalid entries are rejected without altering totals

Given an active game with at least one scored player
When the scorekeeper enters a decimal (`2.5`), a non-number (`abc`), an empty value, or an out-of-range amount (`1000001` or `-1000001`) and saves
Then a clear validation message is shown and announced, no total changes, and no change-log entry is created.

### Scenario 4: Zero entry is rejected

Given an active game
When the scorekeeper enters `0` and saves
Then a gentle message explains zero adds no points, no total changes, and no change-log entry is created.

### Scenario 5: Negative totals are valid

Given a player at total `0`
When the scorekeeper saves `-5`
Then the player's total shows `-5` with no error.

### Scenario 6: Keyboard and narrow-screen entry

Given the app is served at a 320px-wide viewport with a 20-player game
When the scorekeeper tabs to a row's "Add points" button, activates it, enters `-3` via the numeric input, and saves
Then every control is keyboard reachable and labeled, focus indicators are visible, the entry panel stacks below the roster, the signed amount applies correctly, touch targets remain ≈44px, and there is no horizontal page overflow.

## Repository Research

### Files Inspected

- `AGENTS.md`, `README.md` — workflow, commands, and current app scope (roster accepted; scoring is next).
- `PROGRESS.md` — roster accepted 2026-10-02; next feature is `add-player-score`; localhost binding needs permission in this sandbox.
- `feature_list.json` — source metadata; verification items: +10/−3 → 7 with others at 0; reject decimals/non-numbers/unsafe amounts; signed input on mobile; `CI=true ./init.sh`.
- `CONTEXT.md`, `docs/build-brief.md`, `docs/domain-model.md` — score change, total, and change-log model; negative totals valid; no rounds.
- `docs/risks-and-open-questions.md` — bounds and zero-handling decisions assigned to this spec (resolved above).
- `DESIGN.md` — active-game concept: ranked rows with per-row "Add points", adjacent entry panel with signed input, helper, "Save points".
- `docs/specs/create-game-roster.md` — prior contract that established the current game/player shape.
- `src/roster.js` — pure helpers; `createGame` returns `{ id, title, status, createdAt, players[{ id, name, color, marker, order, total }] }`.
- `src/main.js` — view state (`home`/`setup`/`active`), `renderActiveGame`/`renderActivePlayer` (total hardcoded to `0`), `escapeHtml` helpers, feedback region pattern (`#setup-feedback` with `aria-live="polite"`).
- `src/styles.css` — tokens, `.active-layout` grid (`minmax(0,1fr) minmax(260px,340px)` on desktop; single column ≤720px), `.active-player` row grid, 44px min-height fields, focus outline and reduced-motion rules.
- `index.html` — static shell; app markup is rendered into `[data-app-root]` by `src/main.js`.
- `scripts/static-server.mjs` — explicit public-file allowlist: `index.html`, `src/main.js`, `src/roster.js`, `src/styles.css`. A new module is 404 until added here.
- `scripts/smoke.mjs` — asserts `src/*.js` serve 200 and that static `index.html` does not match `/localStorage|score change|leaderboard row/i` (dynamic UI in `main.js` is unaffected).
- `scripts/roster-test.mjs` — pure Node unit-check pattern with `node:assert/strict`.
- `scripts/browser-roster-test.mjs` — self-contained CDP client (launch Chrome, `click`, `fill`, `evaluate`, `screenshot`, viewport overrides, console-error capture); asserts `localStorage.length === 0` and no horizontal overflow.
- `init.sh`, `package.json` — gate runs `node --check` on sources and test scripts, then `npm run test` = `test:roster && test:smoke && test:browser`.
- Git state: branch `codex/add-player-score` exists, clean tree, includes merged `main` (`39c4d3d`).

### Existing Patterns To Follow

- Pure logic in a dedicated ES module; DOM/render/event code in `src/main.js`; Node tests import pure modules directly.
- Every new public app file must be added to the `scripts/static-server.mjs` allowlist (and smoke check) or the browser gets a 404.
- Feedback regions use `aria-live="polite"`; inputs have explicit labels; focus is managed after view changes.
- `init.sh` stays non-blocking: `node --check` lines plus `npm run test`; never starts `npm run dev`.
- Browser tests run isolated headless Chrome via CDP against the in-process static server; no Playwright/persistent E2E harness exists — the CDP checks are this repo's browser-flow coverage.

### Current Gaps

- No score data model, entry UI, or live totals exist; `.active-player-total` is hardcoded to `0`.
- No scoring module, no score unit test, no browser score scenarios.
- CDP helpers live inline in `browser-roster-test.mjs`; a score browser test needs them extracted or duplicated.

## Technical Approach

1. **Pure scoring module** — create `src/score.js`:
   - `MAX_SCORE_ABS = 1_000_000`.
   - `parseScoreAmount(raw)` → `{ amount }` or `{ error }` with error codes `empty`, `not-a-number`, `not-integer`, `zero`, `out-of-range` (trim; empty check before `Number()`; `Number.isInteger`; nonzero; `Math.abs ≤ MAX_SCORE_ABS`).
   - `applyScoreChange({ game, playerId, amount })` → `{ game, error }`. Rejects unknown players, non-integer/out-of-range/zero amounts, and any change whose resulting `total + amount` is not a safe integer. On success returns a new game object with the player's `total` updated and `{ id, playerId, amount }` appended to `game.changes` (initialize `changes: []` if absent). Keep it framework-free and DOM-free so Node tests cover it.
2. **UI in `src/main.js`** — extend the active view:
   - Add `selectedPlayerId` to state; each `.active-player` row gains an "Add points" button (`aria-label="Add points for {name}"`, `aria-pressed` reflects selection) that sets the selection, re-renders, and focuses the amount input.
   - Render a score-entry panel (`.score-panel`): "Add points" heading, selected player's marker + name, labeled number input (`#score-amount`, `step="1"`, `min`/`max` per bounds, `autocomplete="off"`), helper text, `#score-feedback` `aria-live="polite"` region, and a "Save points" submit button.
   - On submit: `parseScoreAmount`, then `applyScoreChange`. Success → replace `state.activeGame`, re-render totals, clear input, keep focus in input, announce "Added {amount} points to {name}. New total: {total}." Failure → show/announce the mapped message, totals untouched, focus stays in the input.
   - Render `player.total` (replacing the hardcoded `0`) in `.active-player-total`.
3. **Styling in `src/styles.css`** — panel card, selected-row state, number input reusing `.text-field`, ≥44px touch targets, desktop two-column placement and ≤720px single-column stacking, visible focus states.
4. **Tests** — see Verification Plan; extract CDP helpers into a shared module to avoid duplication.

## Expected File Changes

- `src/score.js` — create; pure scoring constants, parsing, and `applyScoreChange`.
- `src/main.js` — modify; scoring UI, selection state, live totals, feedback wiring.
- `src/styles.css` — modify; score panel, selected-row state, responsive stacking, focus styles.
- `scripts/score-test.mjs` — create; Node unit checks for `src/score.js`.
- `scripts/browser-test-utils.mjs` — create; CDP helpers extracted from `browser-roster-test.mjs` (pure move).
- `scripts/browser-score-test.mjs` — create; focused browser scenarios for scoring at desktop and 320px.
- `scripts/browser-roster-test.mjs` — modify; import the extracted helpers; no behavior change.
- `scripts/smoke.mjs` — modify; assert `src/score.js` serves 200 (keep existing negative checks).
- `scripts/static-server.mjs` — modify; add `src/score.js` to the public-file allowlist.
- `package.json` — modify; add `test:score` and `test:browser:score`, chain both into `test`.
- `init.sh` — modify; add `node --check` for `src/score.js`, `scripts/score-test.mjs`, `scripts/browser-score-test.mjs`, `scripts/browser-test-utils.mjs`.
- `README.md` — update; describe score entry in the usage paragraph and new test commands.
- `ARCHITECTURE.md` — update; add `src/score.js`, score boundary, and new test scripts to source layout/commands.
- `CONSTRAINTS.md` — update; durable scoring rule (signed integers, |amount| ≤ 1,000,000, zero rejected, totals may be negative, no persistence yet).
- `AGENTS.md` — not needed; workflow and commands unchanged.
- `PROGRESS.md`, `feature_list.json` — update with actual evidence during implementation/validation, not by this planner.

## Visual Design Impact

- UI involved: yes.
- Design source: `DESIGN.md` and `docs/design/concepts/scorekeeper-desktop-mobile-v1.png`.
- Screens or states affected: active game only — roster rows (Add points buttons, selected state, live totals), new score-entry panel, error/success feedback states.
- New design artifact required: no.

Follow the accepted tokens: ivory surfaces, charcoal text, primary blue "Save points" button, large tabular numerals for totals. Keep names visible with numbered markers; selection must not rely on color alone (use `aria-pressed` and a visible style). No confetti/motion is introduced, so reduced-motion defaults are untouched.

## Durable Documentation Impact

- `ARCHITECTURE.md`: update — new scoring module and boundary ("app accepts signed score changes on one player and records an in-memory change log; no persistence").
- `CONSTRAINTS.md`: update — durable rule for score bounds/zero handling so future slices (undo, persistence, finish) inherit it.
- `AGENTS.md`: not needed — no workflow, startup, or command changes.
- `README.md`: update — usage and commands change slightly.
- Other docs: `docs/risks-and-open-questions.md` scores bullet is resolved by this spec; updating it is optional and left to the implementer if desired.

## Implementation Plan

1. Create `src/score.js` with constants, `parseScoreAmount`, and `applyScoreChange`; add it to the static-server allowlist and smoke check.
2. Add `scripts/score-test.mjs`; wire `test:score` into `package.json`.
3. Extend `src/main.js` active view with selection, entry panel, validation, live totals, and announcements; style in `src/styles.css`.
4. Extract CDP helpers to `scripts/browser-test-utils.mjs`; add `scripts/browser-score-test.mjs`; wire `test:browser:score` into `test`.
5. Update `init.sh` `node --check` list, README, ARCHITECTURE.md, CONSTRAINTS.md.
6. Run the full gate and real browser checks; record evidence.

## Implementation Tasks

- [ ] Implement `src/score.js` (`MAX_SCORE_ABS`, `parseScoreAmount`, `applyScoreChange` with safe-integer guard and change log).
- [ ] Add `src/score.js` to `scripts/static-server.mjs` allowlist and `scripts/smoke.mjs` asset checks.
- [ ] Add `scripts/score-test.mjs` covering every parse error code, apply success/failure, change-log append, and totals of other players; wire `test:score`.
- [ ] Extend the active view: row "Add points" buttons with `aria-pressed`, entry panel with labeled number input/helper/feedback, submit validation, live totals, success/error announcements.
- [ ] Update `src/styles.css`: score panel, selected-row state, ≤720px stacking, ≥44px targets, visible focus.
- [ ] Extract CDP helpers into `scripts/browser-test-utils.mjs` and keep `browser-roster-test.mjs` green.
- [ ] Add `scripts/browser-score-test.mjs` (desktop +10/−3 → 7 with others at 0; invalid and zero entries leave totals unchanged; 320px signed input; no localStorage writes; no overflow; no console errors); wire `test:browser:score`.
- [ ] Update `init.sh`, `package.json`, `README.md`, `ARCHITECTURE.md`, `CONSTRAINTS.md`.

## Verification Plan

- `node --check src/main.js && node --check src/score.js && node --check scripts/score-test.mjs && node --check scripts/browser-score-test.mjs && node --check scripts/browser-test-utils.mjs` — expected: all pass.
- `npm run test:score` — expected: parse errors (`empty`, `not-a-number`, `not-integer`, `zero`, `out-of-range`), apply success (+10 then −3 → total 7, others 0), negative totals, change-log appends, rejected input leaves the game object unchanged.
- `npm run test` — expected: roster unit, score unit, HTTP smoke (including `src/score.js` 200 and repo-file 404s), roster browser test, and score browser test all pass.
- `./init.sh` and `CI=true ./init.sh` — expected: standard gate passes, executes all checks, and exits without starting a long-running server. `init.sh` must keep running the non-blocking checks and only print the manual `npm run dev` follow-up.
- `npm run dev` + real browser checks (desktop 1280×800):
  - Create a game, apply +10 then −3 to one player → total shows 7 immediately; others stay 0 (Scenario 1–2).
  - Enter `2.5`, `abc`, empty, `1000001`, and `0` → visible + announced error each time; totals unchanged (Scenarios 3–4).
  - Apply −5 → total −5 shown (Scenario 5).
- Real browser check at 320×720: keyboard through row buttons and the entry panel, visible focus, signed `-3` applies, panel stacked below roster, no horizontal overflow, touch targets ≈44px (Scenario 6). Note: headless CDP cannot exercise a physical mobile keypad; set the value directly and verify rendering. Keypad minus-key availability comes from `type="number"`; observe it during any manual device check.
- Confirm no persistence: `localStorage.length === 0` asserted in browser tests; reload still discards the game.

## Evidence To Capture

- Output summaries for `npm run test`, `./init.sh`, `CI=true ./init.sh` (exact commands and results).
- Browser test output plus screenshot paths from `scripts/browser-score-test.mjs` (desktop and 320px).
- Manual/automated results for Scenarios 1–6, including the +10/−3 → 7 check and the rejected-input list.
- Confirmation that `game.changes` exists in memory and no localStorage API is used.
- Update `feature_list.json` evidence and `PROGRESS.md` session log with these results (implementer/validator step).

## Validator Checklist

- [ ] Implementation stays within `add-player-score` scope: entry + immediate totals + in-memory change log only.
- [ ] No undo UI, no sorting/ranks, no persistence, no finish/lock behavior added.
- [ ] +10 then −3 yields total 7 with all other players at 0; other totals never change on a save.
- [ ] Decimals, non-numbers, empty input, out-of-range amounts, and zero are rejected with clear feedback and no state change; negative totals display correctly.
- [ ] Roster rows remain in creation order; every row button and the entry input are keyboard reachable, labeled, with visible focus and `aria-live` feedback.
- [ ] Score entry works at 320px and desktop with no horizontal overflow.
- [ ] `src/score.js` is served by the static server (allowlist + smoke check) or does not exist as a separate file.
- [ ] `npm run test`, `./init.sh`, and `CI=true ./init.sh` pass with the new focused checks; `init.sh` did not start a server.
- [ ] `ARCHITECTURE.md`, `CONSTRAINTS.md`, `README.md` updated; `feature_list.json` evidence and `PROGRESS.md` record real checks.
