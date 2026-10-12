# Feature Implementation Spec: Rank the live leaderboard

## Source Feature

- `id`: `rank-leaderboard`
- `area`: `scoring`
- `depends_on`: [`add-player-score`] (accepted and merged into `main`, PR #6, merge commit `8d74612` — verified: `main` is an ancestor of the working branch HEAD)
- `status`: `not_started` at planning time
- `source`: `feature_list.json`

## Goal

Make the active-game roster a real leaderboard: rows display in descending total order, each row shows its competition rank, and equal totals share a rank (12, 12, 8 → ranks 1, 1, 3). Re-rank happens immediately after every successful score save, tied players keep a stable display order, and the scorekeeper never loses keyboard focus or player selection because of a reorder.

Ranks are derived at render time from the existing in-memory game state. Nothing new is stored, persisted, or added to the change log.

## Non-Goals

- No undo UI or controls; `undo-latest-score` is a later feature.
- No persistence, saved-game history, or resume; reload still discards the game.
- No finish/lock behavior, podium, medals, or celebratory styling; `finish-game` and `celebrate-podium` own those.
- No lowest-score-wins mode, rank editing, drag-to-reorder, or tiebreak winner declaration.
- No stored/derived rank fields on player or game objects; ranks exist only while rendering.
- No framework, build step, backend, or new npm dependencies.

## Job Story

When several players are at the table and totals keep moving,
I want the list to always show who leads, with tied players sharing a rank,
so I can announce standings without counting rows myself.

## Users And Permissions

- Scorekeeper: the only actor. Sees the ranked active-game view and saves score changes as today. No sign-in, sharing, or remote access exists.

## Product Decisions Resolved For This Slice

These resolve the choices flagged in `feature_list.json` notes ("Use rank = 1 + count of strictly higher totals. Keep names/icons readable with 20 players.") and `docs/domain-model.md` ("Preserve a stable display order within ties without declaring a tie winner"):

- **Rank formula (competition ranking)**: each row shows `rank = 1 + (number of players with a strictly higher total)`. Consequence: ties share the same rank and the next position skips (1, 1, 3). Implemented as: sort descending by total, then walk positions assigning `position + 1` unless the total equals the previous row's total, in which case reuse the previous rank.
- **Tie display order**: within equal totals, rows keep player creation order. Tiebreak explicitly on the existing `player.order` field (falling back to the original array index if absent) so behavior is deterministic regardless of engine sort stability. No tie winner is declared or highlighted.
- **Rendering strategy — full re-render, not in-place reorder**: keep the established pattern (state change → `renderActiveGame()` rebuilds the view via `innerHTML` → explicit refocus). Rationale: every view in `src/main.js` already works this way, ≤20 rows make DOM-diffing pointless, and in-place `<li>` moves would add a second rendering path plus focus-management complexity. Focus retention is achieved the way scoring already does it: after a save-triggered re-render, explicitly refocus `#score-amount` (errors never re-render, so typed value and focus survive rejection exactly as today). Selection is keyed by `data-player-id` and `selectedPlayerId`, so it follows a player across reorders automatically.
- **Row layout**: each row gains a rank numeral as its first element — plain text (no `aria-label` on non-interactive spans), fixed-width column, `tabular-nums`, same typography as totals. Roster panel copy changes to eyebrow "Leaderboard" and heading "Highest total leads; ties share rank." so tie semantics are visible without reading ranks.
- **Feedback**: extend the success announcement to include the player's new rank, keeping the existing sentence intact for compatibility with current assertions: "Added {amount} points to {name}. New total: {total}. Rank: {rank}." Error messages are unchanged.
- **Selection default**: unchanged — defaults to the first creation-order player and follows `selectedPlayerId` across reorders; a save never changes which player is selected.

## Acceptance Scenarios

### Scenario 1: Descending order with shared ranks

Given an active game with three players whose totals are 12, 12, and 8 (the two 12s created earlier)
When the leaderboard renders
Then rows appear in descending total order, the two 12-total players both show rank `1` in creation order, the 8-total player shows rank `3`, and no row claims rank `2`.

### Scenario 2: Negative totals and an all-player tie

Given players with totals 5, −3, and −3
Then ranks are 1, 2, 2 in that order, negative totals render without errors.
Given a fresh game where every total is 0
Then every row shows rank `1` and rows stay in creation order.

### Scenario 3: Immediate reorder with retained focus and selection

Given Alex leads with 7 and Sam trails with 5, Sam selected, focus in the amount input
When the scorekeeper saves +5 for Sam
Then rows reorder immediately (Sam first), Sam's row keeps the selected style and `aria-pressed="true"`, success feedback announces the new rank, and focus is back in `#score-amount` with a cleared input.

### Scenario 4: Stable tied display across saves

Given two players tied at 12 in creation order
When any other player's score changes (or either tied player's total changes but they remain tied)
Then the tied rows keep their relative creation order after each re-render.

### Scenario 5: 20 players readable at 320px

Given a 20-player game viewed at a 320px-wide viewport with scored totals
Then rank numerals, markers, names, and totals all remain readable, every row keeps ≈44px touch targets, keyboard users can reach row buttons and the entry panel with visible focus, saving re-ranks without losing focus, and there is no horizontal page overflow.

## Repository Research

### Files Inspected

- `AGENTS.md`, `README.md` — workflow, commands, current app scope; `rank-leaderboard` named as next feature.
- `PROGRESS.md` — `add-player-score` accepted 2026-10-12; localhost binding may need permission outside the sandbox.
- `feature_list.json` — source entry and verification items: 12/12/8 → ranks 1,1,3; negative totals and all-player ties; reorder + stable ties + retained focus on save; `CI=true ./init.sh`.
- `CONTEXT.md`, `docs/build-brief.md`, `docs/domain-model.md` — leaderboard definition (descending, shared ranks), rank formula, stable tie order, podium only in a later slice.
- `docs/risks-and-open-questions.md` — 20-player readability risk (names visible, outlined markers, test long lists); no ranking decision left open for this slice.
- `DESIGN.md` — "ranked rows" concept, preserve focus when standings reorder, 320px no-overflow rule, tabular score numerals.
- `docs/specs/add-player-score.md` — prior contract that shaped the current active view (row buttons, `aria-pressed`, score panel, `aria-live`).
- `src/main.js` — `renderActiveGame` maps `game.players` in array order; `renderActivePlayer` renders token/name/total/button; save flow re-renders then refocuses `#score-amount`; errors use `paintScoreFeedback` without re-render; `.active-layout` two-column grid.
- `src/roster.js` — `createGame` gives players `{ id, name, color, marker, order, total }`; `MAX_PLAYERS = 20`.
- `src/score.js` — pure scoring helpers; totals are safe integers; input games never mutated.
- `src/styles.css` — `.active-player` grid `auto minmax(0,1fr) auto auto`; ≤480px two-row grid areas; ≤360px compaction; 44px targets; focus-visible outline.
- `scripts/static-server.mjs` — explicit allowlist (`index.html`, `src/main.js`, `src/roster.js`, `src/score.js`, `src/styles.css`); a new module 404s until added.
- `scripts/smoke.mjs` — asserts `src/*.js` serve 200; the negative `/leaderboard row/i` regex checks static `index.html` only, so dynamic markup in `main.js` is unaffected.
- `scripts/score-test.mjs` — pure Node unit pattern with `node:assert/strict`.
- `scripts/browser-score-test.mjs` — CDP scenarios; reads `.active-player-total` in DOM order; **assertions at lines ~122 and ~141 (`["7", "1005"]`) will break once rows sort by total** (Sam 1005 > Alex 7 puts Sam first) and must be updated to `["1005", "7"]`.
- `scripts/browser-roster-test.mjs` — asserts 20 fresh totals `Array(20).fill("0")` in DOM order; stays green because all-zero ties preserve creation order.
- `scripts/browser-test-utils.mjs` — shared CDP helpers (click, fill, evaluate, setViewport, screenshot…).
- `init.sh`, `package.json` — gate = required-file list + `node --check` per source/test script + `npm run test` chain; `test` chains roster/score/smoke/browser suites.
- Git state: branch `codex/rank-leaderboard` checked out, clean, HEAD = `main` (`8d74612`); dependency merged.

### Existing Patterns To Follow

- Pure logic in a dedicated DOM-free ES module; rendering/events in `src/main.js`; Node tests import pure modules directly.
- New public app files must be added to the `scripts/static-server.mjs` allowlist and smoke check or the browser gets a 404.
- Full-view re-render + explicit refocus after state changes; error feedback repaints without re-render.
- `aria-live="polite"` feedback regions, labeled inputs, `aria-pressed` row selection, 44px targets, visible `:focus-visible` outlines.
- One focused browser test script per feature, isolated headless Chrome via CDP against the in-process server; no Playwright/persistent E2E harness exists — CDP scripts are this repo's browser-flow coverage.

### Current Gaps

- No ranking/sorting logic anywhere; rows render in `game.players` array order.
- No rank display, no leaderboard copy, no rank column in the row grid or its responsive breakpoints.
- No standings unit test or rank browser scenarios.

## Technical Approach

1. **Pure standings module** — create `src/standings.js` with `rankPlayers(game)`:
   - Input: the game object (or `null` → empty array). Reads only `game.players`.
   - Copy the players array (never mutate), decorate with a tiebreak key `player.order` (fallback: original array index), sort by `total` descending then tiebreak ascending. Totals are safe integers, so subtraction comparators are exact.
   - Walk the sorted rows: `rank = position + 1`, except when `total` equals the previous row's `total`, reuse the previous row's rank (equivalent to 1 + count of strictly higher totals; assert this property in tests).
   - Return `[{ player, rank }]`. DOM-free, framework-free.
2. **UI in `src/main.js`**:
   - In `renderActiveGame`, call `rankPlayers(game)` and map ranked rows instead of `game.players`; pass `rank` into `renderActivePlayer`.
   - `renderActivePlayer` prepends `<span class="active-player-rank">{rank}</span>` (plain text). Extend the total span's accessible label to include rank, e.g. `aria-label="{name}: rank {rank}, total {total}"`.
   - Update the roster panel heading copy to "Leaderboard" / "Highest total leads; ties share rank."
   - In `handleScoreSubmit`, extend the success message with the saved player's new rank (compute it from `rankPlayers(result.game)`); keep the existing "New total: {total}." sentence verbatim.
   - Keep the existing re-render + `#score-amount` refocus flow unchanged.
3. **Styling in `src/styles.css`**:
   - `.active-player` columns → `auto auto minmax(0, 1fr) auto auto` (rank, token, name, total, button); `.active-player-rank` fixed min-width, `tabular-nums`, bold, right-aligned with the existing numeral style; no color-coded meaning.
   - ≤480px grid areas gain `rank` (e.g. `"rank token name total"` / `"select select select select"`); ≤360px compaction keeps all five elements visible.
4. **Tests** — see Verification Plan; follow the existing unit and CDP script patterns.

## Expected File Changes

- `src/standings.js` — create; pure `rankPlayers` helper.
- `src/main.js` — modify; ranked rendering, rank in rows and success feedback, leaderboard copy.
- `src/styles.css` — modify; rank column and responsive grid areas.
- `scripts/standings-test.mjs` — create; ranking unit checks.
- `scripts/browser-rank-test.mjs` — create; focused browser scenarios (Scenarios 1–5).
- `scripts/browser-score-test.mjs` — modify; update DOM-order total expectations that legitimately change with ranked rows (≈lines 122/141 → `["1005", "7"]`); no other behavior change.
- `scripts/static-server.mjs` — modify; add `src/standings.js` to the allowlist.
- `scripts/smoke.mjs` — modify; assert `src/standings.js` serves 200 (keep negative checks).
- `package.json` — modify; add `test:standings` and `test:browser:rank`, chain both into `test`.
- `init.sh` — modify; add required-file and `node --check` entries for `src/standings.js`, `scripts/standings-test.mjs`, `scripts/browser-rank-test.mjs`.
- `README.md` — update; usage (leaderboard order, shared ranks) and new test commands.
- `ARCHITECTURE.md` — update; add `src/standings.js`, new scripts, and revise the Boundaries sentence that says the app "does not rank standings, sort rows".
- `CONSTRAINTS.md` — update; durable ranking rule (competition ranking, shared ranks, stable creation-order ties, ranks derived at render and never stored).
- `AGENTS.md` — not needed; workflow, commands, and operating rules unchanged.
- `index.html`, `src/roster.js`, `src/score.js` — not needed; no changes required.
- `PROGRESS.md`, `feature_list.json` — update with actual evidence during implementation/validation, not by this planner.

## Visual Design Impact

- UI involved: yes.
- Design source: `DESIGN.md` (ranked rows concept; "preserve focus when standings reorder"; no horizontal overflow at 320px).
- Screens or states affected: active game only — roster rows gain a rank numeral; roster panel heading copy changes; no new panels, controls, or motion.
- New design artifact required: no.

Follow the accepted tokens: rank numerals share the tabular bold style of totals; no leader highlight, medals, or color-only rank meaning; reduced-motion rules are untouched (no animation is introduced).

## Durable Documentation Impact

- `ARCHITECTURE.md`: update — new pure standings module and test scripts; boundaries now include ranking as an implemented behavior.
- `CONSTRAINTS.md`: update — durable ranking rule so undo, persistence, finish, and podium slices inherit it.
- `AGENTS.md`: not needed — no workflow or command changes.
- `README.md`: update — usage paragraph and command list change slightly.
- Other docs: none — ranking semantics already live in `docs/domain-model.md`; no source-of-truth change.

## Implementation Plan

1. Create `src/standings.js` with `rankPlayers`; add it to the static-server allowlist and smoke check.
2. Add `scripts/standings-test.mjs`; wire `test:standings` into `package.json`.
3. Extend `src/main.js` ranked rendering, rank feedback, and leaderboard copy; add the rank column styles and responsive areas in `src/styles.css`.
4. Add `scripts/browser-rank-test.mjs`; wire `test:browser:rank` into `test`; update the ranked-order expectations in `scripts/browser-score-test.mjs`.
5. Update `init.sh` checks, README, ARCHITECTURE.md, CONSTRAINTS.md.
6. Run the full gate and real browser checks; record evidence.

## Implementation Tasks

- [ ] Implement `src/standings.js` (`rankPlayers` returning `[{ player, rank }]`, immutable input, deterministic creation-order ties).
- [ ] Add `src/standings.js` to `scripts/static-server.mjs` allowlist and `scripts/smoke.mjs` asset checks.
- [ ] Add `scripts/standings-test.mjs`: 12/12/8 → ranks 1,1,3; 5/−3/−3 → 1,2,2; all-zero tie → all rank 1 in creation order; 20-player mixed game; re-rank after `applyScoreChange` (trailing player overtakes); rank = 1 + count strictly higher property; input game never mutated; tiebreak falls back to array index when `order` is absent. Wire `test:standings`.
- [ ] Update `src/main.js`: ranked rows, rank numeral per row, rank-aware total labels, leaderboard panel copy, success message with new rank.
- [ ] Update `src/styles.css`: rank column on desktop grid, ≤480px and ≤360px grid areas, 44px targets preserved.
- [ ] Update `scripts/browser-score-test.mjs` DOM-order expectations for ranked rows (`["1005", "7"]` at the affected assertions) and rerun it green.
- [ ] Add `scripts/browser-rank-test.mjs`: desktop 12/12/8 ranks with stable ties; save-driven immediate reorder with `focusedId === "score-amount"`, selection preserved (`aria-pressed` follows the player); negative totals; all-tied fresh game; 320px 20-player readability/overflow/keyboard checks; `localStorage.length === 0`; no console errors. Wire `test:browser:rank`.
- [ ] Update `init.sh` (required files + `node --check` list), `package.json`, `README.md`, `ARCHITECTURE.md`, `CONSTRAINTS.md`.

## Verification Plan

- `node --check src/standings.js && node --check scripts/standings-test.mjs && node --check scripts/browser-rank-test.mjs && node --check src/main.js` — expected: all pass.
- `npm run test:standings` — expected: every unit case above passes, including the 12/12/8 → 1,1,3 and 5/−3/−3 → 1,2,2 examples.
- `npm run test` — expected: roster unit, standings unit, score unit, HTTP smoke (including `src/standings.js` 200 and repo-file 404s), roster browser test, updated score browser test, and new rank browser test all pass.
- `./init.sh` and `CI=true ./init.sh` — expected: the standard gate executes all syntax checks and the full `npm run test` chain and exits without starting a long-running server. `init.sh` must keep running the non-blocking checks and only print the manual `npm run dev` follow-up; it must gain the new files in its required-file and `node --check` lists.
- `npm run dev` + real browser checks (desktop 1280×800):
  - Scenario 1: score three players to 12, 12, 8 → ranks 1, 1, 3 displayed, tied rows in creation order.
  - Scenario 3: overtaking save reorders rows immediately; feedback announces the new rank; focus returns to `#score-amount`; `aria-pressed` follows the selected player.
  - Scenario 2: negative totals rank below zero; a fresh game shows all rank 1.
- Real browser check at 320×720 with a 20-player game (Scenario 5): ranks/names/markers/totals readable, no horizontal overflow, ≈44px targets, Tab reaches row buttons and the input with visible focus, a save re-ranks while focus stays in the input. Headless CDP sets input values directly; keypad behavior is observed only in manual device checks.
- Confirm no persistence: `localStorage.length === 0` asserted in browser tests; reload discards the game and ranks.

## Evidence To Capture

- Output summaries for `npm run test`, `./init.sh`, `CI=true ./init.sh` (exact commands and results).
- `npm run test:standings` and `npm run test:browser:rank` output summaries plus screenshot paths from the rank browser test (desktop and 320×20-player).
- Recorded results for Scenarios 1–5, including the 1,1,3 tie example and the focus-retention assertion after a reordering save.
- Confirmation that ranks are computed at render time only: no rank fields written to game/player objects, `game.changes` unchanged by ranking, no localStorage API used.
- Update `feature_list.json` evidence and `PROGRESS.md` session log with these results (implementer/validator step).

## Validator Checklist

- [ ] Implementation stays within `rank-leaderboard` scope: ranked display + shared ranks + re-rank on save only.
- [ ] No undo UI, no persistence, no finish/lock/podium behavior, no stored rank fields, no change-log writes from ranking.
- [ ] Totals 12, 12, 8 display ranks 1, 1, 3 with tied rows in creation order; next position skips (no rank 2).
- [ ] Negative totals and all-player ties produce correct, stable displays.
- [ ] A save reorders rows immediately; tied display stays stable across saves; keyboard focus returns to `#score-amount` and selection follows the player.
- [ ] Rank semantics match `rank = 1 + count of strictly higher totals` (unit-asserted).
- [ ] 20-player game at 320px: readable rows, no horizontal overflow, ≈44px targets, keyboard reachable with visible focus.
- [ ] `src/standings.js` is served by the static server (allowlist + smoke check).
- [ ] Existing suite stays green: roster browser test unchanged in behavior; score browser test updated only where ranked DOM order legitimately changed.
- [ ] `npm run test`, `./init.sh`, and `CI=true ./init.sh` pass with the new focused checks; `init.sh` did not start a server.
- [ ] `ARCHITECTURE.md`, `CONSTRAINTS.md`, `README.md` updated; `feature_list.json` evidence and `PROGRESS.md` record real checks.
