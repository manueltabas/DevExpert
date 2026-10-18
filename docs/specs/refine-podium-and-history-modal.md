# Feature Implementation Spec: Fix the podium visual and move View all into a modal

## Source Feature

- `id`: `refine-podium-and-history-modal`
- `area`: `ui`
- `depends_on`: `refine-ui-after-testing` (accepted and merged, PR #23)
- `status`: `not_started` at planning time
- `source`: `feature_list.json`
- `base`: `origin/main` at `869379d` (`Merge pull request #23`); working branch `codex/refine-podium-and-history-modal`

## Goal

Repair the final podium so the tactile three-tier celebration from
`docs/design/update-v2/end_of_game_podium_summary/code.html` renders legibly:
contestants sit above real pedestals, names/points never collapse into
one-character columns, pedestals carry the large rank plus Winner/Silver/Bronze
labels, rank 1 gets a crown accent, a tie note explains shared steps, and a
ranked-summary card list follows the steps. At the same time, replace the
Dashboard's inline `View all (N)` expansion with a modal `<dialog>` per panel:
both panels keep the accepted five-game preview, and each opener lists every
saved game of that status in the existing most-recent-first order using the
same cards. Nothing about the persisted shape, save triggers, ranking, finish
lifecycle, or the three locked podium actions changes.

## Non-Goals

- No persisted-shape change, no new save trigger, no `src/storage.js` change, no new `src/*` module, no server/smoke allowlist change.
- No new dependencies, frameworks, Tailwind/CDN scripts, icon fonts, or build step. Icons are `aria-hidden` inline SVG/labeled text.
- No change to `finishGame`/`replayGame`/`renameGame`, the finish prompt, read-only standings, full-width finished layout, or the six `persistActiveGameSnapshot()` call sites.
- No change to the podium dismissal funnel, the detached-dialog guard, the 14-piece confetti contract, reduced-motion suppression, title/lede copy, or the three locked action labels/semantics.
- No new "View podium" trigger on the finished view; the celebration still opens only on confirm-finish and never re-celebrates.
- No dashboard search, filter, sort control, pagination, or statistics; the modal lists exactly the same saved games in the same order. No inline expansion and no `Show latest 5` label remains.
- No mockup decoration outside the podium modal (top banner actions, export, quick-game metadata, round breakdowns).
- Do not change the `View all` preview from five cards; do not change card content, accessible names, or ordering.

## Job Story

When a game ends at the table and I later review my history,
I want a readable, celebratory podium and a roomy full-history dialog from the Dashboard,
so I can read names and final points at a glance and browse every saved game without the panel turning into a long inline list.

## Users And Permissions

- Scorekeeper: the only actor. Everything is browser-local display behavior; no accounts, permissions, network, or storage-format changes.

## Product Decisions Resolved For This Slice

### Decision 1 — Podium structure (supersedes the step-card layout)

The `<dialog>` shell stays: `data-podium-dialog`, `aria-labelledby="podium-title"`, `aria-describedby="podium-lede"`, `.podium-game-title` as the first direct `<p>` in `.podium-body`, title `Final podium`, lede `Congratulations to the top of the table.`, confetti layer, dismissal funnel, and the three locked actions.

Inside `.podium-body`, render in this order:

1. A top line containing the `Game concluded` pill (a non-`<p>` element so `.podium-game-title` stays the first paragraph) and a top-right 44×44 `type="button"` close X with `data-action="close-podium-corner"` and accessible label `Close podium` (inline-SVG X is `aria-hidden`).
2. `.podium-game-title`, then `h2#podium-title`, then `#podium-lede`.
3. `.podium-groups` (`ol`, `aria-label="Podium steps"`) with the present rank steps. Keep DOM order **rank 1 → rank 2 → rank 3** and use CSS grid to place rank 2 left, rank 1 center, rank 3 right. Each `.podium-group.podium-step[data-rank]` contains:
   - a visually hidden `<h3 class="podium-rank-heading">Rank N</h3>` (preserves the heading convention and the player-number suite's read);
   - `.podium-players` with one `.podium-player` contestant card per tied player: a visually hidden `.podium-player-rank` (the rank is already in the pedestal and total aria-label), the existing `.player-token` with `aria-label="Player {n}, {color}"`, `.podium-player-name`, and `.podium-player-total` (visible raw total, e.g. `47`, plus a separate visible `pts` label) keeping the frozen `{name}: rank {rank}, total {total}` aria-label;
   - a `.podium-pedestal` below the contestants with `.podium-pedestal-rank` (large numeral) and `.podium-pedestal-label` reading exactly `Winner` / `Silver` / `Bronze`. Rank 1 also carries a decorative `aria-hidden` crown SVG above the contestants.
4. A centered `.podium-tie-note` with exactly `Ties share rank and step position automatically`.
5. `.podium-summary` (`aria-label="Ranked summary"`) with groups in rank order. Each `.podium-summary-group[data-rank]` shows a visible `Rank N` label and one `.podium-summary-card` per player: leading rank numeral, `.player-token`, name, and total (raw total + `pts`) with the frozen total aria-label. **Decision:** the summary lists **all players**, not only rank >3. The mockup shows ranks 1–4 and the ranked cards replace the superseded `Rest of the table`; duplicating the top three is intentional because steps are the celebration and cards are the scannable full table. Ties share one `Rank N` group with multiple cards.
6. The unchanged `.podium-actions` block (three locked actions in the accepted DOM order).

The top-right X is **not** a fourth product action: it is a second dismiss affordance that routes through the same `dismissPodium` funnel. The three action labels, accessible names, order, and semantics remain unchanged, and initial focus stays on `close-podium`.

### Decision 2 — Podium layout, readable contestants, and ties

- Each contestant card is a two-column card (`token | name`) with the total in the text column, not a four-column row inside a narrow track. `.podium-player-name` gets the remaining width with `overflow-wrap: break-word` (normal word wrapping, never the one-character squeeze) and a tabular total on its own line. Short names must render on one line at desktop and 320px.
- Steps share a common bottom baseline; the three pedestals use rank-specific heights (~144/96/72px) so rank 1 is clearly tallest. Rank 1 uses the warm gold tint (`--tertiary-tint`/`--tertiary`), rank 2 a cool silver surface, rank 3 the warm bronze/secondary surface. Missing ranks leave their column empty and render no fabricated step. Ties stack multiple contestant cards above the same pedestal.
- At ≤600px the steps stack in rank order 1 → 2 → 3 at full width, pedestal heights compact, and the dialog keeps its internal scroll. Twenty tied players remain one rank-1 step plus twenty summary cards and scroll inside the dialog at 1280×800 and 320×720 with no page-level horizontal overflow.

### Decision 3 — Dashboard `View all` modal

Replace the two inline-expansion booleans with one transient string `state.historyDialog` (`null | "active" | "finished"`). Reset it wherever the old booleans reset (`resetSetup`, `handleResume`, `handlePlayAgain`, the active back-home handler, `handlePodiumExitDashboard`, `handleNavDashboard`).

- Both panels keep the accepted five-card preview and most-recent-first order.
- Above five games, render the opener below the list: visible `View all (N)`, accessible name `View all (N) unfinished games` / `View all (N) finished games`, `aria-haspopup="dialog"`, `data-action="view-all-unfinished"` / `data-action="view-all-finished"`, ≥44px. No `aria-expanded`, no `aria-controls`, no wrapper when ≤5 games.
- Activating an opener sets `state.historyDialog`, renders home (preview stays visible behind the modal), calls `showModal()` on `[data-history-dialog]`, and focuses `[data-action="close-history"]`.
- The dialog: `aria-labelledby="history-dialog-title"`, `aria-describedby="history-dialog-count"`; `<h2>` text `All unfinished games` / `All finished games`; count line `{N} saved games`; an `aria-label`ed list with the same full `renderSavedGameCard` / `renderFinishedGameCard` markup and the same `resume-game` / `view-results` handlers, ordered by `orderSavedGamesForDisplay`. A header `type="button"` close control (`data-action="close-history"`, accessible label `Close game history`, 44px, inline-SVG X `aria-hidden`) sits beside the title.
- Close button, Escape (native `cancel`, prevented), and backdrop click funnel through one synchronous cleanup: close the live dialog, clear `state.historyDialog`, re-render home, and focus the opener for that panel. Keep a `close` fallback that ignores a detached dialog (the accepted modal precedent). Resuming or viewing results from inside the dialog re-renders the destination view and resets the flag; focus lands on the destination heading.
- Opening, closing, dismissing, and moving focus never write storage, change `updatedAt`, or alter the persisted payload. The modal scrolls internally; at 320px cards stack with no horizontal overflow.

## Acceptance Scenarios

### Scenario 1: Tactile podium with distinct ranks

Given a finished game with ranks 1, 2, 3, and 4
When the podium opens at 1280×800
Then rank 2 is left, rank 1 center and tallest, rank 3 right on a common baseline; each contestant shows its numbered token, a normally wrapped name, and its points above its pedestal; the pedestals show large `1`/`2`/`3` plus `Winner`/`Silver`/`Bronze`; rank 1 carries an aria-hidden crown; the `Game concluded` pill and top-right `Close podium` X exist; the exact tie note renders; and the ranked summary shows rank groups for all four players in ranking order.

### Scenario 2: Ties and missing ranks

Given finished games scored 12/12/8 and 10/5/5/0/0
When the podium opens
Then 12/12/8 renders one rank-1 step with both players and one rank-3 step (no rank-2 step), and 10/5/5/0/0 renders one rank-1 step and one rank-2 step with both tied players; every player appears in the ranked summary with its competition rank; no `Rest of the table` section exists; and every short name renders without one-character wrapping.

### Scenario 3: Twenty tied players and narrow screens

Given twenty players tied at rank 1
When the podium opens at 1280×800 and then 320×720
Then all twenty contestants remain in the single rank-1 step and all twenty summary cards render; the dialog scrolls internally at both sizes; at 320px the steps stack in rank order and there is no page-level horizontal overflow; close controls and actions remain ≥44px.

### Scenario 4: Podium dismissal and actions are unchanged

Given an open podium
When the scorekeeper uses the footer `Close & view full standings`, the new corner X, Escape, or a backdrop click
Then each path leaves the dialog, returns focus to the game heading, keeps the read-only standings unchanged, and leaves the stored payload byte-identical. The three locked actions keep their labels, order, and behavior; the corner X does not alter them; initial focus remains on `close-podium`.

### Scenario 5: Dashboard history modal

Given seven unfinished and seven finished saved games
When the Dashboard renders and `View all (7)` is activated on each panel
Then each panel still previews five cards; the unfinished opener opens `All unfinished games` listing all seven in most-recent-first order with working Resume controls, and the finished opener does the same for `All finished games` with working View results; opening moves focus to the close control, and the close button, Escape, and backdrop each return focus to that panel's opener with the preview unchanged; every open/close is byte-identical in storage; no `Show latest 5` text or `aria-expanded` remains.

### Scenario 6: Small panels and 320px

Given a panel with five or fewer games
When the Dashboard renders
Then that panel has no opener and no historical list. At 320px, an opened history dialog scrolls internally, stacks cards single-column, has no horizontal overflow, and all controls remain ≥44px and keyboard-operable.

## Repository Research

### Files Inspected

- `feature_list.json` (`refine-podium-and-history-modal`), `PROGRESS.md`, `AGENTS.md`, `DESIGN.md`, `CONSTRAINTS.md`, `ARCHITECTURE.md`, `README.md`, `docs/build-brief.md`, `docs/domain-model.md`, `docs/design/update-v2/end_of_game_podium_summary/code.html` and `screen.png`.
- `src/main.js`: state and reset sites (40–50, 143–150, 320–336, 510–517, 1176–1180, 1378–1385, 1570–1576, 1838–1847); `renderHome`/`renderSavedGameList`/`renderPanelToggle`/cards (224–470); `renderFinishedGame`/`renderPodiumDialog`/`renderPodiumPlayer`/`renderPodiumRestRow` (921–1050); `bindPodiumEvents`/`handlePodiumClose`/`handlePodiumExitDashboard` (1072–1180); `handleResume` (479–517); `handlePlayAgain` (1565–1585).
- `src/styles.css`: dashboard gutter/preview (414, 536–605); podium block (1178–1490) including step grid, player rows, rest list, actions, breakpoints, and reduced motion.
- `src/standings.js`: `rankPlayers`, `podiumRows`, `podiumRestRows` (currently used only by the rest list).
- Tests: `scripts/browser-refine-ui-test.mjs` (Session A dashboard 330–460; Session D podium 620–765), `scripts/browser-game-activity-test.mjs` (seeded preview 468–530; `readHomeCards` 338–349), `scripts/browser-score-distribution-test.mjs` (`expandUnfinishedPreview` 125–132), `scripts/browser-podium-test.mjs` (`readPodiumState` 105–190; rank-4 cutoff 401–435; Tab walk 517–620), `scripts/browser-podium-actions-test.mjs` (`readPodiumActions` 89–170; `assertActionContract` 351–397; close paths 474–520), `scripts/standings-test.mjs` (podium rest cases 224–262), `scripts/browser-player-numbers-test.mjs` (podium reads 179–197), `scripts/browser-game-title-test.mjs` (`.podium-body > p` check 160–200).
- `package.json` (17 browser suites), `init.sh` (29 `node --check` entries).

### Existing Patterns To Follow

- One focused browser suite per feature; isolated headless-Chrome sessions at 1280×800 and 320×720; `readSavedGamesState` byte-identity proofs for no-write interactions; CDP real-key walks; screenshots into the evidence dir.
- Additive/scoped CSS with the existing token layer; no new hardcoded palette values where a token exists; no new dependency.
- Honest pre-existing-suite updates with supersession comments and updated summary lines; keep unnamed suites byte-untouched.
- Native `<dialog>` + `showModal()`, labelled/described modal, synchronous dismissal funnel, detached-dialog `close` guard, focus return to the invoking control (podium precedent).
- Distinct `data-action` ids for new controls.

### Current Gaps

- The podium step columns cram a four-column `.podium-player` row into a narrow grid track, causing clipped totals and one-character name wrapping; pedestals/labels/crown/tie note/ranked cards do not exist.
- `podiumRestRows` and `.podium-rest` implement the superseded `Rest of the table` list.
- The Dashboard expands inline through `showAllActiveGames`/`showAllFinishedGames`; there is no history dialog.
- No corner X or `Game concluded` pill exists.

## Technical Approach

1. **Podium markup (`src/main.js`)**: rebuild `renderPodiumDialog` and the step/contestant renderers per Decision 1. Keep `.podium-group`, `.podium-rank-heading`, `.podium-player`, `.podium-player-rank`, `.podium-player-name`, `.podium-player-total`, `.player-token`, total aria-labels, and the three actions so player-number/action tests keep their hooks where behavior is unchanged. Add top line/pill, crown, pedestal, tie note, and `.podium-summary` groups built from `rankPlayers(game)` (all players). Add the corner-close binding through the existing `dismissPodium` funnel. Remove `podiumRestRows` from the import; delete its now-unused helper and unit coverage.
2. **Podium CSS (`src/styles.css`)**: replace the step-card rules with the stage/pedestal/contestant/summary system described above; keep the dialog shell, confetti, actions, reduced-motion, and ≤480px action stacking. Remove `.podium-rest*` rules. Widen the dialog to `min(calc(100vw - 24px), 640px)` (design `max-w-2xl` proximity) while retaining internal scroll.
3. **Dashboard modal (`src/main.js`)**: replace the two expansion booleans with `state.historyDialog`; add openers (rendered only above five), `renderHistoryDialog`, open/close handlers, and bindings. Generalize the saved/finished list renderers to accept a list id/label for the dialog. Keep previews and card renderers unchanged.
4. **Dashboard CSS (`src/styles.css`)**: add `.history-dialog`/body/header/count/close styles mirroring the podium dialog, with internal scroll and the existing card breakpoints. Remove `.panel-toggle*` rules.
5. **Tests/docs**: update the named suites honestly, keep the regression floor, update README/ARCHITECTURE/CONSTRAINTS/DESIGN plus build-brief/domain-model wording.

## Expected File Changes

- `src/main.js` — modify: podium markup/summary/corner X/pill/crown; `historyDialog` state, openers, dialog render/bindings/resets; remove inline expansion handlers; drop `podiumRestRows` import.
- `src/styles.css` — modify: podium stage/pedestal/contestant/summary/corner-close/pill styles and breakpoints; history dialog styles; remove `.podium-rest*` and `.panel-toggle*` rules.
- `src/standings.js` — modify: remove the unused `podiumRestRows` helper (keep `rankPlayers`, `podiumRows`, `scoreDistribution` unchanged).
- `scripts/browser-refine-ui-test.mjs` — modify: Session A rewritten for the history modal (open/close paths, all cards, focus return, byte identity, ≤5, 320px); Session D read/assertions updated for pedestals, pill, crown, tie note, ranked summary all players, and name-line checks; summary line.
- `scripts/browser-game-activity-test.mjs` — modify: open the unfinished history dialog to read the six seeded cards, then close; replace toggle/aria-expanded expectations; summary.
- `scripts/browser-score-distribution-test.mjs` — modify: `expandUnfinishedPreview` becomes opening the history dialog before seeded resumes; comment/summary.
- `scripts/browser-podium-test.mjs` — modify: rank-4 expectations now ranked summary cards; add pedestal/pill/crown/tie-note/summary reads; Tab walk updated for the additional corner close; summary.
- `scripts/browser-podium-actions-test.mjs` — modify: action contract distinguishes the three locked actions from the corner dismiss; button count 4; add X to close paths; wrap expectations include the corner close; summary.
- `scripts/standings-test.mjs` — modify: remove `podiumRestRows` import/coverage; update summary.
- `README.md`, `ARCHITECTURE.md`, `CONSTRAINTS.md`, `DESIGN.md` — update per Durable Documentation Impact.
- `docs/build-brief.md`, `docs/domain-model.md` — update the superseded podium rest-list wording.
- `docs/specs/refine-podium-and-history-modal.md` — this spec (belongs to this feature's PR).
- **Expected untouched**: `index.html`; `src/storage.js`, `src/roster.js`, `src/game.js`, `src/score.js`; `scripts/smoke.mjs`, `scripts/static-server.mjs`, `scripts/browser-test-utils.mjs`, `package.json`, `init.sh`; all other suites (verify with `git diff`; update honestly only if self-verification proves a structural conflict).

## Visual Design Impact

- UI involved: yes — podium dialog and Dashboard history modal.
- Design source: `DESIGN.md` + `docs/design/update-v2/end_of_game_podium_summary/code.html` / `screen.png`; existing token layer only.
- Screens/states affected: podium (distinct ranks, ties, missing rank, 20 tied, reduced motion, 320px), Dashboard (five-card preview, open/closed unfinished and finished dialogs, ≤5, 320px).
- New design artifact required: no — the mockup dialog is the visual reference; no new palette/motion. Do not add the mockup's top banner, statistics, export, or quick-game cards.

## Durable Documentation Impact

- `README.md`: update — Dashboard `View all` opens a scrollable history dialog (five-card preview, no inline expansion/`Show latest 5`); podium now has tactile steps with pedestals/labels/crown/tie note/ranked summary cards, plus the `Game concluded` pill and corner close X; three actions and dismissal behavior unchanged.
- `ARCHITECTURE.md`: update — `historyDialog` state/modal boundary and focus/return/no-write rules; generalized list renderers; podium stage/pedestal/summary structure; removal of `podiumRestRows`; updated refine-ui/podium/podium-actions suite descriptions.
- `CONSTRAINTS.md`: update — replace the inline dashboard preview/toggle rule with the modal rule (five-card preview, opener only >5, accessible title, close button/Escape/backdrop, focus to opener, no writes); replace the podium rest-list rule with steps + ranked summary cards for all players; document the corner close X as a dismiss affordance outside the three locked actions.
- `DESIGN.md`: update — Dashboard history modal; podium tactile layout, pill, corner X, tie note, summary cards; keep the three-action and reduced-motion notes.
- `docs/build-brief.md`, `docs/domain-model.md`: update — `Rest of the table` is superseded by ranked summary cards covering every player.
- `AGENTS.md`: not needed — no workflow/startup change. `docs/risks-and-open-questions.md`: not needed.

## Implementation Plan

1. Rebuild the podium markup and CSS; verify distinct ranks, ties, missing rank, 20 tied, 320px, focus/actions/confetti.
2. Add the corner close and pill; ensure the three-action contract and dismissal funnel are unchanged.
3. Replace dashboard inline expansion with `state.historyDialog`, openers, dialog rendering/bindings, and resets; verify preview/order/focus/no-write/320px.
4. Update the named suites honestly; remove `podiumRestRows` and its unit coverage if confirmed unused.
5. Run the full verification plan, confirm the regression floor via `git diff`, update docs, record evidence.

## Implementation Tasks

- [ ] `src/main.js`: rebuild `renderPodiumDialog` (top line/pill/X, game title, title/lede, steps with contestants + pedestals + crown, tie note, ranked summary, actions).
- [ ] `src/main.js`: keep `.podium-group`/`.podium-rank-heading`/`.podium-player*`/total-label/`Player {n}, {color}` hooks; add hidden rank elements and `pts` labels; summary uses `rankPlayers`.
- [ ] `src/main.js`: bind `close-podium-corner` through `dismissPodium`; keep initial focus on `close-podium` and the three action bindings unchanged.
- [ ] `src/styles.css`: replace step-card styling with stage/pedestal/contestant/summary/pill/corner-close rules; 2-left/1-center/3-right; tallest winner; ≤600px rank-order stack; remove `.podium-rest*`.
- [ ] `src/main.js`: replace `showAllActiveGames`/`showAllFinishedGames` with `historyDialog`; add openers, `renderHistoryDialog`, open/close handlers, bindings, resets; generalize list renderers.
- [ ] `src/styles.css`: add history dialog/header/count/close styles and internal scrolling; remove `.panel-toggle*`.
- [ ] `src/standings.js`: remove `podiumRestRows`; update `scripts/standings-test.mjs`.
- [ ] Update `browser-refine-ui-test.mjs` Session A/Session D honestly; update `browser-game-activity-test.mjs`, `browser-score-distribution-test.mjs`, `browser-podium-test.mjs`, `browser-podium-actions-test.mjs` per the named deltas (supersession comments + summary lines).
- [ ] Update README/ARCHITECTURE/CONSTRAINTS/DESIGN and build-brief/domain-model wording.
- [ ] Run the verification plan; record evidence in `feature_list.json`/`PROGRESS.md` (implementer/validator step, not this planner).

## Verification Plan

- `node --check` on touched sources and suites (covered by `init.sh`).
- `npm run test:standings` — pass with the `podiumRestRows` coverage removed and `rankPlayers`/`podiumRows`/`scoreDistribution` unchanged.
- `npm run test:browser:refine-ui` — Session A history modal and Session D podium geometry/summary; real headless Chrome at 1280×800 and 320×720; byte-identity for open/close; name-line checks; no overflow.
- `npm run test:browser:podium`, `npm run test:browser:podium-actions`, `npm run test:browser:game-activity`, `npm run test:browser:score-distribution` — pass with exactly the honest updates above.
- `npm run test` — full chain (17 browser suites) green; every unnamed pre-existing suite byte-untouched (or honestly updated only where self-verification proves a structural conflict).
- `./init.sh` and `CI=true ./init.sh` — required files, syntax checks, full test chain; both exit without starting a long-running server (a transient Chrome-launch timeout may be retried once).
- `npm run dev` probe — 200 for `/`, `/src/main.js`, `/src/standings.js`, `/src/styles.css`; 404 for `/AGENTS.md`.
- Screenshots: desktop podium distinct ranks (pedestals/labels/crown/summary), desktop ties/missing rank, desktop and 320px 20-tied, desktop Dashboard with history dialog open (both panels), 320px history dialog.
- Disclosure: physical keyboards/touch cannot be exercised headless; keyboard/focus contracts are verified via CDP real-key walks, consistent with prior features. `init.sh` executes the non-blocking gate only and must not start a server.

## Evidence To Capture

- Exact commands/results for the unit suite, the five updated browser suites, `npm run test`, both gate modes, and the dev probe.
- A `git diff` statement proving `index.html`, `src/storage.js`, `src/roster.js`, `src/game.js`, `src/score.js`, harness scripts, `package.json`/`init.sh`, and unnamed suites are untouched; envelope version 1; six save triggers; no persisted fields.
- Assertion summaries for: pedestal labels/crown/pill/tie note; all-player ranked summary; name-line counts and readable totals; ties/missing rank/20-tied scroll; three actions + corner X focus; history modal title/order/all cards/focus return/close paths/no writes; five-card preview; ≤5 no opener; 320px overflow/targets; zero console errors.
- Appended `feature_list.json` evidence and a `PROGRESS.md` session-log entry.

## Validator Checklist

- [ ] Podium steps place rank 2 left, rank 1 center/tallest, rank 3 right with common baseline; missing ranks leave empty columns; contestant cards show tokens, readable names, and totals above pedestals with Winner/Silver/Bronze labels and a rank-1 crown.
- [ ] Ties stay in one step and the tie note renders; 20 tied players scroll internally at desktop and 320px without overflow.
- [ ] `Game concluded` pill and corner X render; initial focus stays on `close-podium`; the X/Escape/backdrop/footer close all dismiss to the heading with byte-identical storage; the three locked actions keep their labels/order/semantics.
- [ ] Ranked summary lists every player in rank groups, including rank >3; no `Rest of the table`/`podiumRestRows` remains.
- [ ] Dashboard previews five cards and opens a correctly titled dialog listing every game of that status in order; Resume/View results work; close/escape/backdrop return focus to the opener; opening/closing writes nothing; ≤5 has no opener; no `Show latest 5`/`aria-expanded` inline expansion remains.
- [ ] `podiumRestRows` removal is complete (source, tests, docs) and `rankPlayers`/`podiumRows`/`scoreDistribution` are unchanged.
- [ ] Regression floor: only named files/suites changed; six save triggers; envelope version 1; no new dependencies, saved fields, or unrelated feature work.
- [ ] README/ARCHITECTURE/CONSTRAINTS/DESIGN/build-brief/domain-model updated; evidence recorded with real commands and results.
