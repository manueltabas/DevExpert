# Feature Implementation Spec: Refine dashboard, scoring, and results after playtesting

## Source Feature

- `id`: `refine-ui-after-testing`
- `area`: `ui`
- `depends_on`: `extend-podium-actions` (accepted, merged into `main` via PR #22)
- `status`: `not_started` at planning time
- `source`: `feature_list.json`
- `base`: `origin/main` at `db44b38` (`Merge pull request #22`); working branch `codex/refine-ui-after-testing`

## Goal

Apply the user-approved post-playtest refinement batch as one bounded UI slice: remove the Dashboard's "Local to this browser" pill, widen the desktop panel gutter, cap both Dashboard panels at five games behind a transient per-panel "View all (N)"/"Show latest 5" toggle, make quick counters stage the points draft instead of saving immediately, make whole active leaderboard rows clickable, move Finish game into the active header, cap recent entries at five, rebuild the podium as ordered steps plus a "Rest of the table" list, and let finished standings use the full content width. Nothing about the persisted game shape, save triggers, ranking, or finish/replay lifecycle changes.

## Non-Goals

- No persisted-shape change, no new save trigger, no `src/storage.js` change, no new `src/*` module, no server/smoke allowlist change.
- No change to score parsing/bounds, undo semantics, `finishGame`/`replayGame`/`renameGame`, read-only guarantees, or the six existing `persistActiveGameSnapshot()` call sites.
- No podium action/title/lede/confetti/focus-trap/dismissal change; the three locked actions stay byte-identical.
- No Dashboard statistics, presets, roster reuse, or other `DESIGN.md` decoration.
- No new Tailwind/CDN/font/icon dependency; no restyle beyond the named changes.
- No change to the retention note (`Saved only in this browser — clearing site data removes these games.`) — only the pill above it is removed.
- No change to mobile panel stacking behavior beyond the desktop gutter and the finish/header/podium rules described here.

## Job Story

When I review past games and score at the table after real playtesting,
I want the dashboard and active controls to match how I actually use them,
so recent games, staged points, and final results stay quick to scan and act on.

## Users And Permissions

- Scorekeeper: the only actor. All changes are browser-local UI behavior; no accounts, permissions, network, or storage-format changes.

## Product Decisions Resolved For This Slice

### Decision 1 — Dashboard: pill, gutter, five-game preview, toggle

- **Pill**: delete only the `<span class="status-pill">Local to this browser</span>` from the hero's `.hero-actions`. Keep the `.status-pill` CSS (setup and game headers still use it) and keep `.retention-note`.
- **Gutter**: `.dashboard-grid` uses `gap: var(--space-xl)` (32px) at desktop; the ≤720px single-column rule keeps the current 20px gap. No divider line, border, or pseudo-element between panels.
- **Preview cap**: `const PANEL_PREVIEW_LIMIT = 5` in `src/main.js`. Each panel renders the first five games of its existing `orderSavedGamesForDisplay(...)` list (`status === "active"` / `"finished"`), preserving the accepted most-recent-first order. The full list is never persisted differently; it is only sliced at render time.
- **Toggle**: render only when the panel has more than five games. Markup after the list (Unfinished: before the retention note):
  - `<div class="panel-toggle-row"><button type="button" class="secondary-action panel-toggle" data-action="toggle-unfinished-games" aria-expanded="false" aria-controls="unfinished-game-list" aria-label="View all (N) unfinished games">View all (N)</button></div>` — every toggle is a ≥44px focusable secondary action.
  - `N` is the panel total. Collapsed text is exactly `View all (N)`; expanded text is exactly `Show latest 5`, with `aria-expanded="true"` and `aria-label="Show latest 5 unfinished games"` (the finished variant says `finished games`). Visible text is a substring of the accessible name.
  - Give the lists stable ids `unfinished-game-list` / `finished-game-list`; the toggle's `aria-controls` targets its own list. No toggle, no wrapper, and no empty list when the panel has ≤5 games.
- **State/focus**: two transient booleans, `state.showAllActiveGames` and `state.showAllFinishedGames`, default `false`. The toggle handler flips its boolean, calls `render()`, and focuses the freshly rendered toggle. No re-render writes storage and no `updatedAt` changes. Reset both booleans in `resetSetup`, `handleResume`, `handlePlayAgain`, the active-view back-home handler, `handlePodiumExitDashboard`, and `handleNavDashboard`, so each arrival at the Dashboard starts collapsed.

### Decision 2 — Quick counters stage the draft (supersedes immediate apply)

- Extract one shared draft helper, `applyDraftDelta(delta)`, from today's stepper math: read `#score-amount` with `Number.parseInt(String(value).trim(), 10)`, use **0** for empty/unparseable drafts, add the delta, clamp to `±MAX_SCORE_ABS`, and write plain integer text (`String(next)`). It never renders, paints feedback, or saves.
- `stepScoreDraft(direction)` calls `applyDraftDelta(direction)`. `handleQuickScore(amount)` calls `applyDraftDelta(amount)` and does **not** call `handleScoreSubmit()`. A tap therefore changes only the pending draft: totals, ranks, feedback, recent entries, focus target, and stored payload are unchanged; no write or re-rank occurs. Focus stays on the pressed counter because nothing re-renders. Repeated Enter keeps accumulating.
- Save points applies the combined draft as **one** ordinary score change (one change-log entry, one save), using the unchanged `handleScoreSubmit` path and exact accepted messages. Examples: `12` typed + `+5` counter → draft `17`; `+1/+5/+10/+25` taps → draft `41`; empty + `-10` → draft `-10`; `999999` + `+25` → draft `1000000`.
- Counter accessible names become draft-specific: `Add {n} {point|points} to the points draft for {name}` (signed `n`, correct pluralization for `|n| = 1`). Visible `+1 … -10` labels, the two rows, the `Quick tap counters` group/eyebrow, and `data-action="apply-quick-score"`/`data-amount` stay unchanged. No new live region.

### Decision 3 — Whole active leaderboard row selects

- In `bindActiveEvents`, bind a click listener to each **active** row (`.active-player[data-player-id]` with an Add points button) that selects that player when the click target is not a button. Clicking the Add points button keeps using its existing handler. Both routes call one private selection function with the unchanged selection semantics: set `state.selectedPlayerId`, clear `state.scoreFeedback`, `render()`, focus `#score-amount`.
- The Add points button remains the keyboard control and the only `aria-pressed` target. Rows gain no `tabindex`, role, or duplicate button; selection is never announced by the row itself.
- Active rows get `cursor: pointer`; finished rows (`.active-player.is-final`) stay inert: no listener, no pointer cursor, no selection/highlight change on click.
- Keep the existing `.is-selected` highlight rule and aria-pressed behavior byte-identical.

### Decision 4 — Finish game moves to the active header

- The unfinished active header renders the Finish game opener (`.finish-action`, `data-action="open-finish"`, label `Finish game`) inside a `data-finish-section` wrapper (`.finish-opener`) after the players pill. When `state.finishPromptOpen` is true, the header opener is absent and the existing confirmation block renders **below the active header and above the leaderboard panel** inside `.active-board`; the prompt wrapper also keeps `data-finish-section`.
- Preserve every existing hook and id: `data-action="open-finish"`, `open-finish`, `confirm-finish`, `cancel-finish`, `id="finish-warning"`, `data-finish-section`, the exact copy (`Finish this game?`, the warning, `Cancel`), `aria-describedby="finish-warning"`, open→confirm focus, cancel→opener focus, confirm→finish/podium flow, and the score form remaining usable while the prompt is open.
- Remove the Finish section from the score panel only (`renderActiveGame`); recent entries stay the score panel's last block. Finished views still render no finish control.
- Header layout: at ≤720px the active header wraps when it hosts the finish opener (`:has(.finish-opener)`), and at ≤360px `.finish-opener`/`.finish-action` takes a full row like the other header controls. No horizontal overflow at 320px; the prompt remains keyboard-operable with the same Tab/Enter/Cancel behavior.

### Decision 5 — Recent entries cap five

Change `RECENT_ENTRIES_LIMIT` in `src/score.js` from `8` to `5`. `recentScoreChanges` semantics are otherwise unchanged (newest first, unresolvable players skipped without consuming the cap, no mutation). No storage shape change; the full change log stays persisted.

### Decision 6 — Podium: ordered steps plus the rest of the table

- Add a pure `podiumRestRows(game)` export in `src/standings.js`: `rankPlayers(game).filter((row) => row.rank > 3)`, in ranking order, fresh array, no mutation, guards inherited from `rankPlayers`. Keep `podiumRows` (rank ≤ 3) as the steps helper.
- Rebuild `renderPodiumDialog` content as:
  - `.podium-groups` (`ol`, `aria-label="Podium steps"`) whose present rank steps are `.podium-group.podium-step` items with `data-rank="1|2|3"`, the existing `.podium-rank-heading` (`Rank N`), and the existing `.podium-players` list of `.podium-player` rows (rank, token, name, total). Ties render every tied player in that step; a missing rank renders no step (no empty heading, no fabricated rank).
  - A `.podium-rest` section after the steps and before the actions, rendered only when `podiumRestRows(game).length > 0`: `h3#podium-rest-title` text `Rest of the table`, then `.podium-rest-list` rows in ranking order, each with `.podium-rest-rank`, the existing `.player-token`/`Player {n}, {color}` label, escaped name, and `.podium-rest-total` (visible total plus the frozen `{name}: rank {rank}, total {total}` aria-label). Use distinct `.podium-rest-row` classes, not `.podium-player`, so step counts stay unambiguous.
- Desktop layout: three-column grid with the 2nd step in column 1, the 1st in column 2, the 3rd in column 3, a common bottom baseline, and an elevated/taller rank-1 silhouette (e.g. rank-specific min-heights such as 240/180/150px with `align-items: end`); missing ranks simply leave their column empty. At ≤600px stack the steps in rank order (1→2→3) full-width and reset the min-heights/columns; the dialog keeps its internal scroll and 320px overflow-free behavior.
- Preserve the dialog shell exactly: `data-podium-dialog`, `aria-labelledby="podium-title"`, `aria-describedby="podium-lede"`, `.podium-game-title` as the first paragraph, title/lede copy, 14-piece confetti + reduced-motion rule, initial focus on `close-podium`, dismiss funnel, and the three locked action buttons in DOM order. The rest list contains no focusable controls, so the focus trap still cycles only the three actions.

### Decision 7 — Finished standings span the full content width

Add an `is-finished` modifier to the finished view's `.active-layout` section and `grid-template-columns: minmax(0, 1fr)` for `.active-layout.is-finished`, so the single leaderboard panel fills the content width with no empty right score-panel column. The finished view continues to render no `.score-panel`; 320px stacking is unchanged.

## Acceptance Scenarios

### Scenario 1: Dashboard preview and toggle

Given seven unfinished and seven finished saved games
When the Dashboard renders at 1280×800
Then each panel shows its five most recent games, each shows `View all (7)` with `aria-expanded="false"` and `aria-controls` pointing at its list, and clicking `View all (7)` expands to all seven, changes the label to `Show latest 5` with `aria-expanded="true"`, keeps the toggle focused, and leaves the stored payload byte-identical; collapsing restores five. With ≤5 games in a panel no toggle exists.

### Scenario 2: Dashboard chrome

Given the Dashboard at desktop and 320px
When it renders
Then the text `Local to this browser` is absent while the retention note remains visible, the desktop panel gutter is 32px with no divider line, and at 320px the panels still stack single-column with no horizontal overflow.

### Scenario 3: Counters stage a combined draft

Given an active game with Alex selected and a typed draft of `12`
When the scorekeeper taps `+5`, then `+10`, then `-1`
Then the field shows `26`, totals/ranks/feedback/recent entries and the stored payload are unchanged, focus stays on the last counter, and pressing Save points writes exactly one change of `26` and announces the ordinary success message. A counter tap from an empty field starts at its preset; additions clamp at ±1,000,000; the stepper and counters share the same plain-integer/clamped draft math.

### Scenario 4: Whole-row selection

Given an active game with several players
When the scorekeeper clicks a row away from its Add points button
Then that row highlights, its Add points button has `aria-pressed="true"`, the score card names the player, and focus moves to `#score-amount`; clicking Add points or pressing Enter on it does the same. On a finished view, rows are inert and clicking does not select or highlight anything.

### Scenario 5: Finish game in the header

Given an active game
When it renders
Then the Finish game opener is inside `.active-header`; opening it removes the opener and renders the unchanged confirmation below the header and above the leaderboard with all existing ids/copy; Cancel returns focus to the header opener without writing, Confirm follows the accepted finish/podium path, and at 320px the header/prompt stay overflow-free and keyboard-operable.

### Scenario 6: Recent entries cap

Given a game with more than five logged changes
When the active view renders
Then exactly the five newest renderable changes show newest first with the `Last:` line, and a game with five or fewer renders all of them.

### Scenario 7: Podium steps and rest list

Given a finished game with ranks 1, 2, 3, and 4
When the podium opens at desktop
Then the rank-2 step is left, rank-1 center and visually tallest, rank-3 right, every tied player stays inside its step, and a `Rest of the table` list below the steps shows every rank >3 player in ranking order with rank, token, name, and total. A 12/12/8 game shows rank 1 and rank 3 steps only (no rank 2), a 20-tied game shows one rank-1 step with all 20, and no rest section renders when every player ranks ≤3. Title/lede, confetti, focus trap, dismiss paths, and three actions are unchanged; at 320px the steps stack and nothing overflows.

### Scenario 8: Finished full width

Given a finished game reopened from the Dashboard
When it renders at 1280×800 and 320×720
Then the finished layout has one grid track, the roster panel spans the content width with no empty right column, no `.score-panel` exists, and no horizontal overflow occurs.

## Repository Research

### Files Inspected

- `feature_list.json` (`refine-ui-after-testing`, 480–496), `PROGRESS.md`, `AGENTS.md`, `docs/risks-and-open-questions.md`, `DESIGN.md`.
- `src/main.js`: `state`, `renderHome` (hero pill at 228, panels at 232–274), `renderSavedGameList`/cards, `handleNavDashboard`, transient resets, `renderActiveGame` header/score panel (667–713), `renderFinishSection` (828–849), `renderFinishedGame` (851–899), `renderPodiumDialog` (901–955), `bindPodiumEvents` (978–1046), `renderActivePlayer` (1101–1113), `renderQuickScores`/`handleQuickScore`/`stepScoreDraft` (1149–1189, 1552–1590), `handleScoreSubmit`, `bindActiveEvents` (1265–1367), `renderRecentEntries`.
- `src/score.js`: `RECENT_ENTRIES_LIMIT` (line 6), `recentScoreChanges`.
- `src/standings.js`: `rankPlayers`, `podiumRows`; no rest helper yet.
- `src/styles.css`: `.status-pill` (397), `.dashboard-grid` (404), `.active-layout`/`.active-header` (609–649), `.active-player`/`.add-points-action` (821–866), `.score-panel` (918), `.finish-section`/`.finish-action` (1080–1105), podium block (1139–1339), breakpoints (1341–1511), recent entries (1516–1627).
- Tests: `scripts/browser-quick-score-test.mjs` (counter immediate-apply expectations throughout), `browser-game-activity-test.mjs` (cap 8 at 506–518), `browser-podium-test.mjs` (`readPodiumState` groups 105–175; rank-4 exclusion 390–399), `browser-finish-game-test.mjs` (finish-section/opener 106–157, 284–306), `browser-podium-actions-test.mjs` (`firstToken` 101), `browser-design-system-test.mjs` (`INTERACTIVE_SELECTORS` 200–215, dashboard stacking 482–490), `scripts/standings-test.mjs`, `scripts/score-test.mjs` (cap 8 at 16), `scripts/browser-test-utils.mjs`.
- `package.json` (23 scripts; 16 browser suites), `init.sh` (28 `node --check` entries).

### Existing Patterns To Follow

- One focused browser suite per feature, isolated headless-Chrome sessions at 1280×800 and 320×720, `readSavedGamesState` byte-identity proofs for no-write interactions, CDP real-key walks, and screenshots into the evidence dir.
- Additive-only CSS with scoped classes/modifiers; no existing selector, token, breakpoint, or motion rule silently weakened.
- Honest pre-existing-suite updates only, each with a supersession comment and an updated summary line.
- Distinct `data-action` names (the `nav-*` precedent) and existing hooks preserved where tests depend on them.

### Current Gaps

- The dashboard always renders every saved game and has no per-panel disclosure; the hero still carries the pill; the desktop gutter is 20px.
- Quick counters save immediately; the spec supersedes that behavior.
- The podium renders three rank groups rather than steps and excludes rank >3 players entirely.
- Finished views reserve the empty right score-panel column.
- `podiumRestRows` does not exist and `RECENT_ENTRIES_LIMIT` is 8.

## Technical Approach

1. **`src/main.js` dashboard**: add `PANEL_PREVIEW_LIMIT`, the two expansion booleans and reset points, slice each ordered panel list, render the toggle wrapper after the list, and bind both toggles in `renderHome` (flip state, render, refocus the toggle). Remove the hero pill line.
2. **`src/main.js` scoring**: extract `applyDraftDelta(delta)`; route `stepScoreDraft` and `handleQuickScore` through it; remove the quick-counter save call, re-render, and focus-restore logic; update counter accessible names. Add the row click listener in `bindActiveEvents` with the button-target skip and a shared selection helper.
3. **`src/main.js` finish**: move the opener into `renderActiveGame`'s `.active-header` with the preserved `data-finish-section` wrapper; render the unchanged prompt between `.active-header` and `.roster-panel`; remove the finish section from the score panel; add the header wrap/full-width CSS.
4. **`src/score.js`**: set `RECENT_ENTRIES_LIMIT = 5`.
5. **`src/standings.js` + `src/main.js` podium**: add `podiumRestRows`; render present steps with `data-rank`, the rest section/list, and the new CSS grid/stack rules; keep the dialog shell, actions, confetti, focus, and dismissal untouched.
6. **`src/styles.css`**: 32px desktop dashboard gap; `.panel-toggle*`; pointer cursor for active rows only; header finish/full-width rules; completed layout modifier; podium step/rest layout and ≤600px stack. Keep tokens and existing breakpoints.
7. **Tests/docs**: update the suites below, add `scripts/browser-refine-ui-test.mjs`, wire `package.json`/`init.sh`, and update README/ARCHITECTURE/CONSTRAINTS/DESIGN.

## Expected File Changes

- `src/main.js` — modify: dashboard preview/toggle + hero pill removal; draft helper/counters; row click; finish relocation; podium steps/rest/finished modifier.
- `src/score.js` — modify: `RECENT_ENTRIES_LIMIT` 8 → 5.
- `src/standings.js` — modify: append `podiumRestRows` (no change to `rankPlayers`/`podiumRows`/`scoreDistribution`).
- `src/styles.css` — modify: dashboard gutter, toggle, row cursor, finish header/prompt, finished layout, podium steps/rest/stack rules; additive/scoped elsewhere.
- `scripts/browser-refine-ui-test.mjs` — new focused suite (Sessions A–E below).
- `scripts/browser-quick-score-test.mjs` — modify materially (counter sessions A/C/D/E rewritten for staging; summary).
- `scripts/browser-game-activity-test.mjs` — modify: cap 8 → 5 and the five-name window (supersession comment); the deterministic-ages session seeds **six** active games, so it must assert the five-card preview + `View all (6)` and expand before reading all six card ages (summary).
- `scripts/browser-podium-test.mjs` — modify: add rest-row reading/assertions; supersede the rank-4 exclusion assertion (rest list now shows them); step-order assertions; summary.
- `scripts/browser-finish-game-test.mjs` — modify: opener placement assertions (header + prompt above leaderboard), same ids/copy/focus (summary).
- `scripts/score-test.mjs` — modify: `RECENT_ENTRIES_LIMIT` 8 → 5 and summary.
- `scripts/standings-test.mjs` — modify: import and cover `podiumRestRows` (cutoff/ties/empty/guards/fresh arrays); summary.
- `package.json` — add `test:browser:refine-ui` and chain it into `test` (17 browser suites).
- `init.sh` — add the new suite to `node --check` (29 entries).
- `README.md`, `ARCHITECTURE.md`, `CONSTRAINTS.md`, `DESIGN.md` — document the changed behavior per Durable Documentation Impact.
- `docs/build-brief.md` — update: the quick-counter bullet now stages a draft and Save applies the combined change; the podium bullet includes the rest-of-the-table list.
- `docs/domain-model.md` — update: quick counters/stepper stage a draft and Save applies one combined change.
- `docs/specs/refine-ui-after-testing.md` — this spec (belongs to this feature's PR).
- **Expected untouched**: `index.html`; `src/storage.js`, `src/roster.js`, `src/game.js`; `scripts/smoke.mjs`, `scripts/static-server.mjs`, `scripts/browser-test-utils.mjs`; all suites not named above (verify with `git diff`; update honestly only if self-verification proves a structural conflict).

## Visual Design Impact

- UI involved: yes — Dashboard hero/panels, active header/row/score panel, recent entries, finished layout, podium dialog.
- Design source: `DESIGN.md` + `docs/design/update-v2/` mockups; existing tokens only.
- Screens/states affected: home (with/without games and expanded), active game (desktop/320px, prompt open/closed), finished game (desktop/320px), podium (distinct ranks, ties, missing ranks, rest list, 320px).
- New design artifact required: no — no new palette/motion; the podium steps use existing surfaces/outlines and no separator line is introduced on the Dashboard.

## Durable Documentation Impact

- `README.md`: update — Dashboard five-game preview + per-panel toggle (transient), pill removal, staged quick counters + combined Save, row-click selection, Finish in header, recent cap five, podium steps + Rest of the table, finished full width, new test command, next steps.
- `ARCHITECTURE.md`: update — dashboard preview/toggle state and no-write boundary; shared draft helper and superseded immediate-apply behavior; row-click wiring; Finish placement preserving hooks; `RECENT_ENTRIES_LIMIT` 5; `podiumRestRows`/step layout; finished single-column; new suite.
- `CONSTRAINTS.md`: update — replace the immediate-counter rule with staging; cap recent entries at 5; add dashboard preview/toggle rules (transient, focus, no writes, no toggle ≤5), whole-row selection/inert finished rows, finish header/ID preservation, podium steps/rest/helper, finished full width.
- `DESIGN.md`: update — Dashboard preview/toggle, quick counters stage drafts, Finish in the active header, podium steps + rest list, finished full width. Keep the existing podium three-action and decoration notes.
- `docs/build-brief.md`: update — the quick-counter bullet and podium bullet no longer match the agreed behavior. `docs/domain-model.md`: update — clarify that counters/stepper stage the draft and Save applies one combined change.
- `AGENTS.md`: not needed — no workflow/startup change. `CONTEXT.md`/`docs/risks-and-open-questions.md`: not needed — no additional source-of-truth change beyond the updated build brief/domain model.

## Implementation Plan

1. Land dashboard changes (pill, gutter, cap/toggle state + markup + handlers) and verify at 1280/320.
2. Land the draft helper/counter change, row-click selection, recent cap, and finish relocation; verify the accepted parse/save/focus/undo paths by hand.
3. Land `podiumRestRows`, the step/rest markup and CSS, and the finished single-column modifier; verify distinct-rank, tie, missing-rank, and 20-tied games.
4. Update the named existing suites, add the focused suite, wire `package.json`/`init.sh`.
5. Run the full verification plan, confirm the regression floor via `git diff`, update docs, record evidence.

## Implementation Tasks

- [ ] `src/main.js`: remove the hero pill; add `PANEL_PREVIEW_LIMIT`, `showAllActiveGames`/`showAllFinishedGames`, list slicing, list ids, toggle markup/aria/handlers/focus, and reset points.
- [ ] `src/styles.css`: `.dashboard-grid` 32px desktop gap + 20px stacked gap; `.panel-toggle-row`/`.panel-toggle` ≥44px styling; no divider.
- [ ] `src/main.js`: `applyDraftDelta`, route stepper/counters through it, remove immediate counter saves, update counter names; add whole-row click selection and active-only cursor; leave finished rows inert.
- [ ] `src/main.js` + `src/styles.css`: move Finish game to `.active-header` (preserve `data-finish-section`, ids, copy, focus), render the prompt below the header/above the leaderboard, remove the score-panel finish section, and add the ≤720/≤360 header rules.
- [ ] `src/score.js`: `RECENT_ENTRIES_LIMIT = 5`.
- [ ] `src/standings.js`: append `podiumRestRows(game)`; `src/main.js`: render ordered steps with `data-rank`, the `Rest of the table` section/rows, and preserve the dialog shell/actions; `src/styles.css`: step grid (2 left/1 center/3 right, tallest rank 1, missing columns empty), rest list, ≤600px stack.
- [ ] `src/main.js` + `src/styles.css`: `is-finished` single-column finished layout.
- [ ] `scripts/standings-test.mjs` + `scripts/score-test.mjs`: add `podiumRestRows` coverage and change the cap assertion to 5.
- [ ] Update `browser-quick-score-test.mjs`, `browser-game-activity-test.mjs`, `browser-podium-test.mjs`, `browser-finish-game-test.mjs` honestly with supersession comments/summaries.
- [ ] Add `scripts/browser-refine-ui-test.mjs`: A dashboard (seeded 7+7, cap/toggle/aria/focus/byte-identity/pill/gutter/320); B counters + row click (staged combined save, row selection, finished inert); C finish header/prompt (ids, placement, focus, 320); D podium (1/2/3/4 geometry + rest; ties; missing rank; 20-tied; actions/focus/dismiss); E finished full width + recent cap 5 (1280/320, no overflow).
- [ ] Wire `package.json` + `init.sh`; update README/ARCHITECTURE/CONSTRAINTS/DESIGN and the build-brief/domain-model quick-counter and podium wording.
- [ ] Run the verification plan; record evidence in `feature_list.json`/`PROGRESS.md` (implementer/validator step, not this planner).

## Verification Plan

- `node --check` on touched sources and the new suite (covered by `init.sh`).
- `npm run test:standings` and `npm run test:score` — pass with only the documented additive/limit updates.
- `npm run test:browser:quick-score`, `npm run test:browser:game-activity`, `npm run test:browser:podium`, `npm run test:browser:finish-game` — pass with exactly the honest updates above.
- `npm run test:browser:refine-ui` (new, real headless Chrome, 1280×800 + 320×720): Sessions A–E with storage byte-identity proofs for toggles/counter staging/row selection and the 5-row recent cap.
- `npm run test` — full chain (17 browser suites) green; every unnamed pre-existing suite byte-untouched (or honestly updated only where self-verification proves a structural conflict).
- `./init.sh` and `CI=true ./init.sh` — required files, all syntax checks (29 entries), full test chain; both exit without starting a long-running server (a transient Chrome-launch timeout may be retried once).
- `npm run dev` probe — 200 for `/`, `/src/main.js`, `/src/score.js`, `/src/standings.js`, `/src/styles.css`; 404 for `/AGENTS.md`.
- Screenshots into the evidence dir: desktop Dashboard collapsed/expanded, 320px Dashboard, active counter draft, header finish prompt, podium steps + rest (distinct ranks and tied/missing rank), 320px podium, finished full width.
- Disclosure: physical keyboards/touch cannot be exercised headless; the keyboard/focus contracts are verified via CDP real-key walks, consistent with prior features. `init.sh` executes the non-blocking gate only and must not start a server.

## Evidence To Capture

- Exact commands/results for the unit suites, the four updated browser suites, the new suite, `npm run test`, both gate modes, and the dev probe.
- A `git diff` statement proving `index.html`, `src/storage.js`, `src/roster.js`, `src/game.js`, the harness scripts, and unnamed suites are untouched; envelope version stays 1; `persistActiveGameSnapshot` still has exactly six call sites; no persisted fields change; `podiumRows`/`rankPlayers`/`scoreDistribution`/`replayGame`/`finishGame` otherwise unmodified.
- Assertion summaries for: five-game cap + toggle labels/aria/focus/no writes; staged counter drafts + one combined save; row-click/aria-pressed/inert finished rows; finish header/prompt ids/focus; recent cap 5; podium step geometry/ties/missing ranks/rest rows; finished single-track width; 320px overflow/targets/console errors.
- Appended `feature_list.json` evidence entries and a `PROGRESS.md` session-log entry.

## Validator Checklist

- [ ] Dashboard: pill gone, retention note present, 32px desktop gutter with no divider, both panels cap at five, toggles appear only above five, labels/`aria-expanded`/`aria-controls` correct per panel, expansion shows all in order, focus returns to the toggle, toggling never writes, 320px still stacks.
- [ ] Quick counters stage drafts through the shared clamped plain-integer helper; no totals/rank/feedback/recent/storage change on tap; Save applies the combined draft as one change; stepper behavior unchanged; accessible names say draft.
- [ ] Whole active row clicks select/highlight with the Add points button still the keyboard/`aria-pressed` control; finished rows are inert.
- [ ] Finish game lives in the active header; the unchanged confirmation renders below the header/above the leaderboard; all existing ids/copy/focus/cancel/confirm/320px behavior survives; score panel no longer contains it.
- [ ] `RECENT_ENTRIES_LIMIT` is 5 and the panel shows at most five newest entries.
- [ ] Podium uses ordered 2-left/1-center-tallest/3-right steps with ties preserved and missing ranks omitted, plus a ranking-order `Rest of the table` list for rank >3 with rank/token/name/total; `podiumRestRows` is pure with unit coverage; title/lede/confetti/focus trap/dismissals/three actions are unchanged.
- [ ] Finished standings use one grid track and full content width at desktop; no empty score-panel column; 320px unaffected.
- [ ] Regression floor: only the named files/suites changed, six save triggers, envelope version 1, no new dependencies or persisted fields, no unrelated feature work.
- [ ] README/ARCHITECTURE/CONSTRAINTS/DESIGN/build-brief/domain-model updated; evidence recorded with real commands and results.

## Implementation Findings

- `scripts/browser-score-distribution-test.mjs` also needed an honest structural update: its seeded session stores eight active games and resumes seeds outside the new five-card preview, so it now expands the Dashboard "View all" toggle before each seeded resume. No assertion was weakened and the share math coverage is unchanged.
- The rank-1 podium step is strictly taller than both other steps and meets the 240/180/150px minimums, but real rank-3 content can exceed its 150px minimum at the 560px dialog width. The focused suite therefore asserts rank 1 is strictly tallest plus the minimum heights, rather than a strict rank-2 > rank-3 content height.
- The updated `browser-quick-score-test.mjs` focuses a counter before its programmatic click so the "focus stays on the pressed control" contract is exercised honestly without a re-render.
