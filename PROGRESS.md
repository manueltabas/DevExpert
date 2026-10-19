# Progress

## Current verified state

- Phase: all 11 MVP features, all seven v2 features, `refine-ui-after-testing`, `refine-podium-and-history-modal`, and `game-presets` are independently `accepted`; `refine-podium-and-history-modal` is merged to `main` (PR #24). `game-presets` is ready for commit/push/PR.
- `game-presets` adds a fixed six-option catalogue (`Custom` default, Flip 7, Catan, Ticket to Ride, 7 Wonders, Yahtzee) in new `src/presets.js`; the setup picker/detail/resizing/title auto-fill and the active preset quick actions/sign floor/×2/hints live in `main.js`; roster creation/validation and replay are preset-aware, score saves add `negative-not-allowed`, and only known non-custom games store an optional `presetId` inside the unchanged version-1 envelope. Custom and pre-feature behavior, ranking, undo, distribution, finish/podium, title, and replay-untitled semantics are unchanged.
- Next step: commit/push `codex/game-presets` and open its PR against `main` (merging remains with the user).
- Latest validation: the independent validator reran the preset unit/smoke/focused suites, the three revised existing suites, and `CI=true ./init.sh` (exit 0; 32 `node --check` entries; all 18 browser suites), independently probed Ticket signed saves, finish/rename preservation, replay copied-but-untitled, Catan negative rejection, zero/positive copies, and the stepper floor, and returned **accept** with no blocking/required findings. Two non-blocking notes: the browser suite leans on the independent probe for Ticket-signed/Catan-rejection coverage (unit policy covers every preset), and `.preset-chips` lacked a role. Pre-commit polish: added `role="group"`; `npm run test:browser:presets` reran exit 0. Status persisted as `accepted`.
- Repository root: directory containing this file (`/Users/mtabas/Documents/DevExpert` in the current checkout).
- Standard startup/readiness path: `./init.sh`.
- Standard verification path: `CI=true ./init.sh`, which runs 32 `node --check` entries (including `src/presets.js`, `scripts/presets-test.mjs`, and `scripts/browser-presets-test.mjs`), roster/standings/score/game/storage/preset units, HTTP smoke (including `/src/presets.js`), and 18 Chrome browser suites (the existing roster, scoring, ranking, undo, save/resume, storage-failure, finish-game, podium, replay, design-system, game-title, game-activity, quick-score, player-number, score-distribution, podium-actions, and refine-ui suites plus presets).
- Local app command: `npm run dev`, serving `http://127.0.0.1:4173/` by default.
- Blockers: none.
- Last verification: 2026-10-18 (`game-presets` independent acceptance — validator reran the preset unit/smoke/focused suites, the three revised suites, and `CI=true ./init.sh` green; 18 browser suites; 32 `node --check` entries; independent probes for signed saves, preset rename/finish/replay, negative rejection, zero copy, and stepper floor; `npm run test:browser:presets` reran green after the `role="group"` polish; 7 screenshots sips-verified at 1280×800/320×720). Earlier implementation verification: `npm run test`, `./init.sh`, and `CI=true ./init.sh` all exited 0; dev probe 200 for the app modules and 404 for `/AGENTS.md` and `/feature_list.json`. Transient environment-only notes: one earlier 15-minute shell timeout during the pre-existing storage-failure suite (no assertion) and one `ERR_CONNECTION_RESET` console entry in the pre-existing player-numbers suite; both passed standalone immediately and in the subsequent fully green gate runs.

## Session log

### 2026-10-18 — Game preset setup and scoring implementation (game-presets)

- `src/presets.js` (new): frozen six-record catalogue in picker order with exact ids/labels/ranges/defaults/titles/sign policy/ordered quick actions/targets/hints, plus `getPreset` (universal Custom fallback for missing/null/Custom/unknown), `normalizePresetId` (known non-custom ids only), `allowsNegative`, and `resolvePlayerCount` (untouched default; touched clamp with truncation for non-integers). Records and action objects are frozen; no preset data is duplicated in `main.js`.
- `src/roster.js`: `validateRoster(rows, presetId)` resolves the range and keeps Custom's accepted 2–20 messages while preset failures read `Add at least {min} players for {label}.` / `Keep the table to {max} players or fewer for {label}.`; `createGame({ ..., presetId })` validates against the resolved preset and stores `presetId` only when `normalizePresetId` returns a known non-custom id. `MIN_PLAYERS`/`MAX_PLAYERS` remain the Custom constants.
- `src/score.js`: `SCORE_ERROR_CODES` gains `negative-not-allowed`; `applyScoreChange` rejects negative amounts for non-negative presets after the accepted player/integer/zero/range gates, so zero keeps the `zero` code and unknown ids keep signed Custom behavior. `src/game.js`: `replayGame` passes `game.presetId` into `createGame` (valid non-custom copied, Custom/unknown omitted) while still passing `title: ""`; `finishGame`/`renameGame` preserve the field through their spreads.
- `src/main.js` setup: added `state.presetId`/`rosterTouched`/`titleAutoFilled`, reset by `resetSetup`, preserved by nav New Game. `renderSetup` now emits heading → six-radio `Game preset` fieldset → polite selected detail (range, target, hints, non-interactive action chips) → title → roster. `selectPreset` replaces an untouched roster with `createSetupRows(defaultPlayers)` or clamps a touched roster (`resolvePlayerCount`, truncate only trailing rows, append blank rows with fresh ids/positional colors), auto-fills only empty/auto-filled titles, clears feedback, re-renders, and focuses the selected radio. Name/color/Add/Remove set `rosterTouched`; title input clears `titleAutoFilled`. Status pill, Add/Remove disabled states, helper text, `limitMessage`, and submit-time validation use the resolved range; `createGame` receives `state.presetId`. Hero and active-empty New game now focus `#game-preset-custom`; nav New Game still focuses the setup heading (next Tab → checked radio → title).
- `src/main.js` active: `renderActiveGame` resolves `getPreset(game.presetId)` and passes it to the score form. The form's `min` is `0` for non-negative presets and the helper/swatch copy plus optional `.preset-hint` (target + score hint) follow the preset; the hint joins `aria-describedby`. Quick actions render from the catalogue in multiplier → positive → negative order with empty rows omitted; Flip 7's `×2` (`multiply-score-draft`, `Double the points draft for {name}`) doubles only the draft, clamps, never saves/renders, and keeps focus. `applyDraftDelta` applies the preset floor (typed negatives treated as 0) while `handleMultiplyDraft` multiplies the draft; Save points remains the single ordinary save path. `scoreErrorMessage("zero")` picks the positive-only copy for non-negative presets; `negative-not-allowed` maps to `This preset only adds points. Enter a positive amount.` No target ever finishes a game.
- `src/styles.css` additive only: `.preset-picker`/`.preset-options`/`.preset-card` (selected/focus-within, 44px cards, two columns at ≤480px), `.preset-detail*`/`.preset-chips`/`.preset-chip`, `.preset-hint`, `.quick-score-action.is-multiply`, plus `flex-wrap`/44px flex-basis on preset quick rows so ×2 + six adds fit 320px. No existing selector, token, breakpoint, or motion rule was changed.
- Wiring: `scripts/static-server.mjs` allowlists `src/presets.js`; `scripts/smoke.mjs` asserts it is served; `package.json` adds `test:presets`/`test:browser:presets` and chains both into `test`; `init.sh` requires `src/presets.js` and adds three `node --check` entries (32 total).
- Tests: new `scripts/presets-test.mjs` (catalogue/metadata/frozen records/fallback/normalization/sign/player-count) and `scripts/browser-presets-test.mjs` (six isolated Chrome sessions covering Scenarios 1–9). Honest updates only: `browser-design-system-test.mjs` adds preset cards to the ≥44px survey and expects full-reset focus on `#game-preset-custom`; `browser-game-title-test.mjs` changes the 320px setup Tab walk to heading → checked radio → title; `browser-play-again-test.mjs` asserts Custom replay/original omit `presetId`. `roster-test.mjs`/`score-test.mjs`/`game-test.mjs` gained the preset cases above. The Custom-path roster/score/rank/undo/resume/storage-failure/finish-game/podium/quick-score/player-number/score-distribution/podium-actions/refine-ui suites are byte-untouched and green.
- Verification: `npm run test:browser:presets`, `npm run test:browser:design-system`, `npm run test:browser:game-title`, `npm run test:browser:play-again`, and the Custom-path regressions passed on real headless Chrome; `npm run test` passed end to end with all 18 browser suites; `./init.sh` and `CI=true ./init.sh` both exited 0 (32 node --check entries) without starting a server; the dev probe returned 200 for `/`, `/src/main.js`, `/src/presets.js`, `/src/roster.js`, `/src/score.js`, `/src/game.js`, `/src/styles.css` and 404 for `/AGENTS.md`/`/feature_list.json`. Seven screenshots under `/var/folders/24/yg25x7ld6mv2yb2xdznvmh680000gn/T/devexpert-game-presets/` (desktop Catan/Flip 7 setup, Flip 7 active hint, negative rejection, preset replay, 320px picker, 320px Flip 7 active) were sips-verified as genuine 1280×800/320×720 sizes.
- Disclosure: physical keyboards/touch cannot be exercised headless; the radio arrow-key and Tab contracts use CDP real-key events. Native radio arrow-key selection after a preset-driven re-render focuses the new checked input, which the suite asserts. Transient environment-only failures while self-verifying: an earlier `./init.sh` exceeded a 15-minute shell timeout during the pre-existing storage-failure suite with no assertion, and a retry produced one `ERR_CONNECTION_RESET` console entry in the pre-existing player-numbers suite; that suite passed standalone immediately (12.8s) and both gate modes then ran fully green.
- Independent validation (2026-10-18): the validator reran `test:presets`, roster/score/game/storage/smoke, `test:browser:presets`, the three revised browser suites, and `CI=true ./init.sh` (exit 0; 32 `node --check` entries; all 18 browser suites), independently probed Ticket to Ride signed quick/typed saves, rename/finish preset preservation, replay copied-but-untitled, Catan negative rejection with exact copy/no write, positive-only zero copy, stepper floor, and positive quick actions, and visually spot-checked the Catan desktop setup and 320px picker. Verdict: **accept** with no blocking/required findings. Non-blocking notes: Ticket-signed/Catan-rejection browser coverage lives in the independent probe while unit policy covers every preset; `.preset-chips` had an `aria-label` without a role. Pre-commit polish added `role="group"`; `npm run test:browser:presets` reran exit 0. Status persisted as `accepted`.
- Next: commit and push `codex/game-presets`, then open the PR against `main` (the spec, `src/presets.js`, and both new suites belong to this feature's PR); merging remains with the user.

### 2026-10-18 — Tactile podium and Dashboard history modal implementation (refine-podium-and-history-modal)

- Podium (`src/main.js`, `src/styles.css`): rebuilt `renderPodiumDialog` into a tactile stage. `.podium-topline` carries the non-paragraph `Game concluded` pill and a 44px corner X (`close-podium-corner`, `aria-label="Close podium"`, aria-hidden inline SVG) that routes through the existing `dismissPodium` funnel without joining the three locked product actions. The DOM keeps rank 1→2→3 steps; CSS places rank 2 left, rank 1 center, rank 3 right on a common bottom baseline. Each `.podium-step[data-rank]` now renders a visually hidden `Rank N` heading, a rank-1 aria-hidden crown, contestant cards (hidden rank, numbered token, normal-wrapped name, raw total plus a visible `pts` label and the frozen total aria-label), and a `.podium-pedestal` with the large rank and exactly `Winner`/`Silver`/`Bronze`; the pedestal ladder is 144/96/72px on desktop and 88/72/56px compacted at ≤600px. The exact tie note renders below the steps, then `.podium-summary` (`aria-label="Ranked summary"`) built from `rankPlayers` lists every player in competition-rank groups. `podiumRestRows` and all `.podium-rest*` / `.panel-toggle*` rules are gone; the three action labels/order/semantics, initial focus on `close-podium`, the duplicate-funnel guard, 14-piece confetti, and reduced-motion suppression are unchanged.
- Dashboard modal (`src/main.js`, `src/styles.css`): replaced `showAllActiveGames`/`showAllFinishedGames` with the transient `state.historyDialog` string (`null | "active" | "finished"`, reset in `resetSetup`, `handleResume`, `handlePlayAgain`, the active back-home handler, `handleNavDashboard`, and `handlePodiumExitDashboard`). Panels keep the five-card preview; above five they render a `View all (N)` opener (`aria-haspopup="dialog"`, no `aria-expanded`/`aria-controls`, no wrapper at ≤5) that opens a `.history-dialog` labelled by `history-dialog-title` and described by the `{N} saved games` count line. The dialog lists every game of that status in `orderSavedGamesForDisplay` order using the unchanged card renderers and resume/view-results handlers; the close button, Escape, and backdrop click funnel through one synchronous cleanup and return focus to that panel's opener. Resuming/viewing results re-renders the destination and resets the flag. Opening/closing never writes storage; the preview stays behind the modal.
- `src/standings.js`: removed the now-unused `podiumRestRows`; `rankPlayers`, `podiumRows`, and `scoreDistribution` are unchanged.
- Tests (honest supersessions, no weakened assertions): `scripts/browser-refine-ui-test.mjs` Session A rewritten for the history modal (7+7 seeds, previews, openers, full dialog lists/order, close/Escape/backdrop focus return, byte identity, ≤5, 320px internal scroll/single-column/44px) and Session D rewritten for the tactile podium (pill, corner X, pedestals, crown, tie note, all-player summary, readable one-line short names, corner-X dismissal, 320px rank-order stack and 88/72/56px ladder, ties/missing rank/20-tied scroll); `scripts/browser-podium-test.mjs` replaces the rest-list reads with summary reads and an explicit corner-X dismissal path, and allows the extra corner focusable in the native Tab wrap/recapture while still never reaching a background control; `scripts/browser-podium-actions-test.mjs` distinguishes four buttons (three product actions + corner X), adds a corner close path, and reads the six finished games through the preview + finished history dialog; `scripts/browser-game-activity-test.mjs` and `scripts/browser-score-distribution-test.mjs` open the unfinished history dialog before reading/resuming older seeds; `scripts/standings-test.mjs` drops the `podiumRestRows` import/coverage.
- Verification: `npm run test:standings` exit 0; `npm run test:browser:refine-ui`, `npm run test:browser:podium`, `npm run test:browser:podium-actions`, `npm run test:browser:game-activity`, and `npm run test:browser:score-distribution` exit 0 on real headless Chrome; `npm run test` exit 0 with all 17 browser suites chained and every unnamed pre-existing suite green byte-untouched; `./init.sh` and `CI=true ./init.sh` exit 0 (29 node --check entries, full test chain, no long-running server); the standard static/dev server probe returned 200 for `/`, `/src/main.js`, `/src/standings.js`, and `/src/styles.css` and 404 for `/AGENTS.md` and `/feature_list.json`. Screenshots under `/var/folders/24/yg25x7ld6mv2yb2xdznvmh680000gn/T/devexpert-refine-podium-and-history-modal/` (15 files; sips-verified 1280×800 desktop and 320×720 mobile, including both history dialogs and the tactile/tie/20-tied podium).
- Regression floor: `index.html`, `src/storage.js`, `src/roster.js`, `src/game.js`, `src/score.js`, `scripts/smoke.mjs`, `scripts/static-server.mjs`, `scripts/browser-test-utils.mjs`, `package.json`, and `init.sh` are untouched; envelope version 1; no persisted fields; `persistActiveGameSnapshot` still has exactly six call sites (801/1711/1744/1796/1835/1898); no new dependency or `src` module.
- Docs: updated README (history dialog; tactile podium with pill/corner X/pedestals/crown/tie note/ranked summary), ARCHITECTURE.md (`state.historyDialog` modal boundary, generalized card list renderers, podium stage/pedestal/summary and `podiumRestRows` removal, updated suite descriptions), CONSTRAINTS.md (modal dashboard rule replacing the inline toggle; steps + all-player ranked summary replacing the rest list; corner X outside the three locked actions), DESIGN.md, docs/build-brief.md, and docs/domain-model.md.
- Disclosure: physical keyboards/touch cannot be exercised headless; keyboard/focus contracts use CDP real-key walks. Chrome's native Tab recapture can land on the dialog element itself with no focused action (documented behavior), so the walk asserts focus never reaches a background control and stays inside the dialog. Implementation-time choice: the ≤600px pedestal ladder is compacted to 88/72/56px (content exceeds the smaller minimums otherwise); the suite asserts the genuine 1>2>3 ladder at 320px.
- Validator repair F1 (2026-10-18): the independent validator found the podium opened scrolled to the bottom — `bindPodiumEvents` called `showModal()` then focused the footer `close-podium`, and native focus scrolling moved the dialog to the footer (`dialog.scrollTop` measured 329 at 1280×800 and 460 at 320×720), hiding the pill, title, corner X, crown, and most/all tactile steps. `src/main.js` now keeps the locked initial focus on `close-podium` but focuses it with `{ preventScroll: true }` and resets `dialog.scrollTop = 0` before and after, so the stage opens at the top; the three locked action labels/order, dismissal funnel, detached-dialog guard, and corner X behavior are unchanged. `scripts/browser-refine-ui-test.mjs` now reads `dialogScrollTop` and dialog-relative viewport state for `#podium-title`, `.podium-pill`, the rank-1 crown, and the rank-1 step, asserting `scrollTop === 0` and top-of-stage visibility at 1280×800 and 320×720 for distinct ranks, ties/missing rank, and the 20-tied game; the 320px distinct-rank and 20-tied opens now genuinely open at 320×720 (the 20-tied case via Play again replay), and the summary line states the top-on-open contract. Repair verdict: `npm run test:browser:refine-ui` exit 0; `npm run test:browser:podium` exit 0; `npm run test:browser:podium-actions` exit 0; `npm run test` exit 0 with all 17 browser suites; `CI=true ./init.sh` exit 0 (29 node --check entries, full test chain, no server). Regenerated screenshots under `/var/folders/24/yg25x7ld6mv2yb2xdznvmh680000gn/T/devexpert-refine-podium-and-history-modal/` were sips-verified at 1280×800/320×720; the desktop tactile podium and 20-tied captures visibly show the Game concluded pill, Final podium title, crown, and rank-1 step at the top. ARCHITECTURE.md/CONSTRAINTS.md now record the open-at-top focus rule, and feature_list.json carries the repair evidence while remaining `passing`.
- Independent re-validation (2026-10-18): round 2 returned **accept**. The validator's independent CDP probe measured `dialog.scrollTop = 0` and in-viewport `#podium-title`, pill, corner X, crown, and rank-1 step at both 1280×800 and 320×720 (title tops 107/99, pill tops 37/37, crown tops 201, step top 192), with the dialog still taller than the viewport so the assertion is non-vacuous; it confirmed the new `assertPodiumOpensAtTop` clauses would fail against the pre-repair state, verified the repair diff was scoped to `bindPodiumEvents` plus tests/docs, and reconfirmed the history modal's focus/order/no-write/320px behavior. It reran `npm run test:browser:refine-ui` and `CI=true ./init.sh` green (17 browser suites, 29 node --check entries) and confirmed all 15 screenshots are genuine sizes. Status persisted as `accepted` in `feature_list.json`.
- Next: commit/push `codex/refine-podium-and-history-modal` and open the PR against `main`; merging remains with the user. No non-blocking findings remain.

### 2026-10-18 — Post-playtest UI refinements implementation (refine-ui-after-testing)

- Landed the approved refinement slice in `src/main.js`, `src/styles.css`, `src/score.js`, and `src/standings.js` with no persisted-shape or save-trigger change. Dashboard: removed the hero "Local to this browser" pill (retention note kept); `.dashboard-grid` uses the 32px `--space-xl` desktop gap, with the existing ≤720px rule resetting to 20px; each panel renders five games from its existing `orderSavedGamesForDisplay` list behind a transient per-panel `View all (N)` / `Show latest 5` toggle (`PANEL_PREVIEW_LIMIT = 5`, `showAllActiveGames`/`showAllFinishedGames` reset at every Dashboard arrival, stable list ids, `aria-expanded`/`aria-controls`/aria-label, focus retained, no toggle or wrapper at ≤5, zero writes). Active scoring: extracted `applyDraftDelta(delta)` (trimmed `parseInt`, 0 baseline, ±1,000,000 clamp, plain integer text, no render/feedback/save) and routed both `stepScoreDraft` and `handleQuickScore` through it; counters no longer call `handleScoreSubmit`, so a tap changes only the draft and keeps focus, while Save applies the combined draft as one ordinary change; counter accessible names now say "to the points draft for {name}". Whole-row selection uses one `selectPlayer()` path shared with Add points (button remains the keyboard/`aria-pressed` control; finished rows are unbound and keep the default cursor). Finish game moved into `.active-header` (`renderFinishOpener`) with the unchanged prompt (`renderFinishPrompt`) below the header and above the leaderboard inside `.active-board`; the score panel no longer carries a finish section, and every existing hook/id/copy/focus move is preserved. `RECENT_ENTRIES_LIMIT` is now 5. Podium: appended pure `podiumRestRows(game)` and rebuilt the dialog as ordered `.podium-step` items with `data-rank` plus a ranking-order "Rest of the table" section (distinct `.podium-rest-row` classes, zero focusables); CSS places rank 2 left, rank 1 center/tallest, rank 3 right on a common baseline (240/180/150px minimums) and stacks rank order at ≤600px. Finished views gained `.active-layout.is-finished` with one grid track for full-width standings.
- Tests: updated `scripts/score-test.mjs` (cap 5) and `scripts/standings-test.mjs` (`podiumRestRows` cutoff/ties/guards/fresh-array coverage); rewrote the material counter sessions in `scripts/browser-quick-score-test.mjs` for staged combined drafts and draft-specific names; updated `scripts/browser-game-activity-test.mjs` (cap 5 and expanding the seeded six-active-game preview before reading all ages) and its placement check for the relocated finish section with supersession comments; updated `scripts/browser-podium-test.mjs` (steps/`data-rank`, rest-row reading, the rank-4 assertion superseded to the rest list, summaries); updated `scripts/browser-finish-game-test.mjs` (header/prompt placement assertions); made one honest structural update in `scripts/browser-score-distribution-test.mjs` to expand the Dashboard preview before resuming seeds outside the five-card window (disclosed; no assertions weakened). Added `scripts/browser-refine-ui-test.mjs` (Sessions A–E covering the dashboard preview/toggle/byte-identity/gutter/320px, staged counters + row selection + inert finished rows, header finish/prompt, podium geometry/ties/missing rank/20-tied/actions/focus, recent cap 5, and the one-track finished layout), wired as `npm run test:browser:refine-ui`, chained into `npm run test`, and added to `init.sh` (29 node --check entries).
- Verification: `npm run test:score` and `npm run test:standings` passed; the four updated focused browser suites plus the new refine-ui suite passed on real headless Chrome; `npm run test` exited 0 with all seventeen browser suites chained; `./init.sh` and `CI=true ./init.sh` both exited 0 (29 node --check entries) without starting a long-running server; the `npm run dev` probe returned 200 for `/`, `/src/main.js`, `/src/score.js`, `/src/standings.js`, and `/src/styles.css` and 404 for `/AGENTS.md`. Screenshots under `/var/folders/24/yg25x7ld6mv2yb2xdznvmh680000gn/T/devexpert-refine-ui-after-testing/` (13 files, 320px captures sips-verified 320×720) plus the staged-draft capture in the quick-score evidence dir; the rank-1 step is asserted strictly taller than both other steps plus the 240/180/150px minimums because real rank-3 content can exceed its minimum at the 560px dialog width.
- `index.html`, `src/storage.js`, `src/roster.js`, `src/game.js`, `scripts/smoke.mjs`, `scripts/static-server.mjs`, and `scripts/browser-test-utils.mjs` are untouched (git diff: 0 lines); no new `src` module; the envelope version stayed 1; no persisted fields changed; `persistActiveGameSnapshot` still has exactly six call sites; unnamed suites are byte-untouched except the disclosed score-distribution preview-expansion update.
- Updated README (five-game preview/toggle, pill removal, staged counters, row selection, header finish, recent cap 5, podium steps/rest, full width, new command), ARCHITECTURE.md (preview/transient state, shared draft helper, finish placement, `podiumRestRows`/steps/rest, single-track finished layout, new suite), CONSTRAINTS.md (staged-counter replacement, cap 5, dashboard preview/toggle rules, row selection/inert finished rows, finish header/ID preservation, podium steps/rest, finished full width), DESIGN.md, docs/build-brief.md, and docs/domain-model.md.
- Independent validation: the validator reran `npm run test:score`, `npm run test:standings`, `node --check` on all touched files, `npm run test:browser:refine-ui`, the four updated browser suites plus `browser-score-distribution`, `./init.sh`, and `CI=true ./init.sh` (all exit 0; 17 browser suites; 13 screenshots sips-verified as genuine sizes, including 320×720); confirmed the disclosure for the score-distribution preview expansion, the quick-counter staging semantics, the podium rank-4 rest list, and the dashboard toggle byte-identity; returned **accept** with three Low findings only. Pre-commit repairs: corrected the Session B evidence attribution (the new suite covers counters; `browser-quick-score` owns the shared stepper contract), refreshed the stale Recent entries placement comments in `src/main.js`/`src/styles.css`, and added a distinct-rank 320px podium stacking assertion (rank order 1→2→3, no overflow); `npm run test:browser:refine-ui` reran exit 0. Status persisted as `accepted` in `feature_list.json`.
- Post-acceptance user-found repair (2026-10-18): the requested separator was the vertical space between the hero (top element) and the dashboard panels, not only the side-by-side panel gutter. `[data-app-root]` is now a grid with a 32px desktop gap (20px stacked), because the old `.home-layout` gap only wrapped the single `#app` child and never separated the hero from the dashboard. The dashboard gutter stays 32px; the focused suite now measures both the app-root row gap and the actual hero-bottom → dashboard-top distance. `npm run test:browser:refine-ui` reran exit 0.
- Next: commit/push the repair to `codex/refine-ui-after-testing` (updating PR #23), then leave it for user review/merge.

### 2026-10-16 — Podium exit actions implementation (extend-podium-actions)

- Landed the three-action block in `src/main.js` render markup only where the podium is concerned: `renderPodiumDialog` now emits, after the groups `<ol>`, a `.podium-actions` container with the full-width primary `podium-play-again` "Play again (same players, reset scores)" above a `.podium-actions-row` holding the `close-podium` control relabeled "Close & view full standings" and the new `podium-exit-dashboard` "Save & exit to Dashboard" — all `type="button"`, copy written with `&amp;` entities so `textContent` reads the exact Decision 1 labels, no aria-label overrides, no new state derivation. `bindPodiumEvents` keeps the `close-podium` funnel, the dialog click/cancel listeners, and the detached-dialog close guard byte-identical, and adds two wrappers: the primary guards on `state.podiumOpen`, closes the live dialog, and calls the unchanged `handlePlayAgain()` (its queued `close` is ignored by the detached-dialog guard once the replay re-render replaces the dialog — the Scenario 6 protection), and the exit wrapper calls the new `handlePodiumExitDashboard()`, which mirrors the accepted active-view back-home reset verbatim (view home + the nine transient clears) and focuses `[data-home-heading]`; it is pure navigation and never writes. Opening the podium still focuses `close-podium`.
- Styled `src/styles.css` by replacing only the `.podium-close` rule: additive `.podium-actions` (grid, gap 10px, `--space-md` top margin) and `.podium-actions-row` (1fr 1fr) plus a scoped `white-space: normal`/`min-width: 0` so the longer labels wrap instead of forcing the dialog wider, and a ≤480px media rule stacking the secondaries full width; no existing selector, token, breakpoint, or motion rule touched. No X icon, pill, or podium-steps art was added and the mockup's exclamation-mark lede was not adopted.
- Tests: the two spec-mandated honest updates only in `scripts/browser-podium-test.mjs` — the `closeLabel` assertion ("Close & view full standings" with a supersession comment) and the 320px Tab-trap walk rewritten for three focusables (supersession comments for `onClose || onBody` and `recaptureState.onClose`; the no-wrap first Tab deterministically reaches `podium-exit-dashboard`; the wrap from the last action honestly allows the documented Chrome first-focusable-or-transient-body quirk, verified with a standalone repro before writing the assertions; the next Tab recaptures into the open dialog without ever focusing a background control; the final step is Escape because the recapture landing is not deterministic) — plus the summary line and removal of the now-dead `pressEnter` helper whose only call site was the replaced step (Enter-activates-the-dismiss-control moved to the new suite's close-path session). Every other pre-existing suite is byte-untouched. New `scripts/browser-podium-actions-test.mjs` (four isolated Chrome sessions covering Scenarios 1–6: the three-action contract with layout/stacking/targets/frozen copy/tokens/confetti and byte-identity while open at 1280×800 and 320×720; all five close paths with heading focus and byte-identical payloads; the navigation-only exit with aria-current and write-absence proof plus a 320px Tab+Enter walk; the podium replay contract with byte-identical original across replay and scoring, reload listing separation, and the two-podium stale-close guard) wired as `npm run test:browser:podium-actions`, chained into `npm run test`, and added to `init.sh`'s `node --check` list (28 entries). Fixed during self-verification: three suite-authoring bugs in the new suite only (initial focus asserted on the freshly opened dialog since a mid-dialog viewport switch legitimately drops element focus; `goHome` between close-path iterations; `#replay-feedback` is absent on the scorable replay view). No product-code failures were found by the suites.
- Verification: `node --check` on touched sources and the new suite passed; `npm run test:browser:podium` and `npm run test:browser:podium-actions` passed on real headless Chrome; `npm run test` passed end to end (exit 0) with all sixteen browser suites chained and the fifteen pre-existing suites green byte-untouched except the two podium-test updates; `./init.sh` and `CI=true ./init.sh` both passed (exit 0, 28 node --check entries) and exited without starting a server; the `npm run dev` probe returned 200 for `/`, `/src/main.js`, and `/src/styles.css` and 404 for `/AGENTS.md`. Screenshots under `/var/folders/24/yg25x7ld6mv2yb2xdznvmh680000gn/T/devexpert-podium-actions/` (7 files) were generated but not visually openable this session; the action contract, layout, targets, focus, exit navigation, replay byte-identity, and overflow were asserted programmatically. Disclosure: physical keyboards/touch cannot be exercised headless; the keyboard contract is verified via CDP real-key walks, consistent with prior features.
- `index.html`, `src/score.js`, `src/storage.js`, `src/roster.js`, `src/game.js`, `src/standings.js`, `scripts/smoke.mjs`, `scripts/static-server.mjs`, `scripts/browser-test-utils.mjs`, and all pre-existing suites except `scripts/browser-podium-test.mjs` are untouched (git diff: 0 lines); the envelope version stayed 1; `persistActiveGameSnapshot` still has exactly six call sites (632/1418/1450/1502/1541/1614); no new persisted fields; `podiumRows`/`rankPlayers`/`replayGame`/`finishGame` unmodified.
- Updated README (three podium actions behavior, the new command, next steps — v2 set complete), ARCHITECTURE.md (podium three-action wiring, exit navigation-only boundary, the replaced `.podium-close` rule, the new suite, the updated podium-suite description), and CONSTRAINTS.md (durable podium-action rules).
- Validator repair (2026-10-16): added the missing `await setViewport(cdp, { width: 320, height: 720, mobile: true });` immediately before the `goHome` call that precedes the "Pocket exit" creation in `runExitDashboard` (scripts/browser-podium-actions-test.mjs), so the session-3 second podium and its Tab+Enter real-key walk genuinely run at 320×720 (validator finding F1); the fresh-open focusOnClose assertion became genuinely 320px with no change needed and the walk is viewport-independent by design, so F2 (the previously 1280×800 `mobile-exit-home-320px.png` capture) is resolved by the same one-line fix. No assertion was weakened and no other file changed. Rerun commands and exact results: `npm run test:browser:podium-actions` exit 0, then `CI=true ./init.sh` exit 0 (28 node --check entries, all sixteen browser suites with the touched suite included, no server started). Verified with sips that `mobile-exit-home-320px.png` and `mobile-podium-actions-320px.png` are genuinely 320×720; the "320px real-key walk" sentences in feature_list.json, PROGRESS.md, and ARCHITECTURE.md (line 349) were verified true as written — nothing shifted, so no evidence text was rewritten.
- Next: run independent `$feature-validator` for `extend-podium-actions`; after acceptance, commit, push `codex/extend-podium-actions`, and open the PR (the untracked spec file `docs/specs/extend-podium-actions.md` and the new suite belong to this feature's PR).

### 2026-10-16 — Score distribution block implementation (show-score-distribution)

- Landed the pure layer first. `src/standings.js`: added `scoreDistribution(game)` (appended; `rankPlayers`/`podiumRows` untouched) returning `{ gameTotal, rows }` — `gameTotal` is the signed sum of finite totals with non-object entries contributing 0 (the `playerNumbers` guard precedent), rows are the positive-total players in `rankPlayers` display order, the share denominator is the sum of positive totals (never the signed total, so percents can never exceed 100), rounding is largest-remainder (Hamilton) with tied remainders topped up in display order, zero/negative totals are omitted while a positive-total player rounding to 0% keeps its row (exact 1:1 segment↔legend correspondence), `rows` is `[]` whenever `gameTotal <= 0`, guards return `{ gameTotal: 0, rows: [] }`, the input is never mutated, and each call returns a fresh array referencing the original player objects. `scripts/standings-test.mjs` gained only additive cases (mockup parity, the pinned naive-rounding counterexample, tie top-up, mixed-sign, zero-player, 0%-retention, degenerates, guards, a 20-player sum-100 case, immutability/fresh-array/no-written-fields) and an updated summary line — the diff touches only the import and summary lines besides the additions.
- Wired the display layer in `src/main.js` render-only — no handler, state, focus, or save-path change: `renderActiveGame` derives `const distribution = scoreDistribution(game);` beside the existing `playerNumbers(game)` call, and a private `renderScoreDistribution(distribution)` (plus `renderScoreDistributionSegment`/`renderScoreDistributionLegendItem`) emits the block immediately after the active `<ol class="active-roster">` inside `.panel.roster-panel`: header eyebrow "Score distribution" + right-aligned signed "{N} total game points" (mirroring `.recent-entries-header`, unconditional phrasing), an `aria-hidden` `.score-distribution-bar` of one `width:{percent}%` segment per eligible row reusing the `marker-*` token colors (yellow/white get an additive inside outline so they never vanish on the track), and an `aria-label="Score distribution"` legend of aria-hidden color dots + real text "{name} {percent}%" (`escapeHtml` on names). The degenerate state keeps the header and renders only the muted locked line "No shares to show while the game total is zero or negative." — no bar, no legend, no empty `<ul>`. Finished views, podium, home, setup, and active-empty render nothing.
- Styled `src/styles.css` additively only (0 removed lines): `.score-distribution` (inset surface-container card with `--radius-md`), `.score-distribution-header`/`.score-distribution-total` (frozen `--muted`, tabular-nums), `.score-distribution-bar` (10px flex track, radius-full, overflow hidden), `.score-distribution-segment` (+ the scoped yellow/white outline rule), `.score-distribution-legend`/`.score-distribution-legend-item` (+ scoped 14px dot)/`.score-distribution-legend-text` (`--text`, tabular-nums, overflow-wrap anywhere), and `.score-distribution-empty` (`--muted`). No existing selector, token, breakpoint, or motion rule was modified, and no ≤360px compaction was needed (the wrapping legend measured overflow-free at 320px).
- Tests: new `scripts/browser-score-distribution-test.mjs` (four isolated Chrome sessions covering Scenarios 1–8: the UI-scored happy path with mockup parity 42/35/28/19 → 34/28/23/15 of 124, exact token colors, ±1px width↔percent correspondence, sum-100, zero focusables, aria strategy, and after-`<ol>` placement; undo re-derivation to 40/33/27 of 105 with the zero-total player omitted and a reordering +50 save to 32/27/23/18 of 155 with legend order following the re-ranked rows plus a byte-identical selection no-write and unchanged stored player keys; seeded rounding edges 2/2/2/1/1/1 → 23/22/22/11/11/11 and 1/1/1 → 34/33/33, mixed-sign 10/−5/3 → 77/23 under the signed "8 total game points" caption, bench omission, the three degenerate captions with the exact locked line, and byte-identical payloads across resume/selection/home/re-resume/reload; finished/podium/home/setup/active-empty exclusion; and a 20-player mixed-sign game at 320×720/1280×800 with no overflow, a wrapping legend, width↔percent checks, AA contrast for legend text and the frozen `rgb(109, 101, 92)` muted lines, and zero console errors) wired as `npm run test:browser:score-distribution`, chained last into `npm run test`, and added to `init.sh`'s `node --check` list (27 entries). Fixed during self-verification: two suite-authoring bugs in the new suite only (the setup form needed `add-player` row growth for rosters over 2, and draft colors follow the positional blue/red/yellow/green order). No product-code failures were found by the suites.
- Verification: `node --check` on touched sources and the new suite passed; `npm run test:standings` passed additive-only; `npm run test:browser:score-distribution` passed on real headless Chrome across all four sessions; `npm run test` passed end to end (exit 0) with all fifteen browser suites chained and every pre-existing suite green byte-untouched (expected honest pre-existing-suite updates: zero, achieved); `./init.sh` and `CI=true ./init.sh` both passed (exit 0, 27 node --check entries) and exited without starting a server; the `npm run dev` probe returned 200 for `/`, `/src/standings.js`, `/src/main.js`, and `/src/styles.css` and 404 for `/AGENTS.md`. Screenshots under `/var/folders/24/yg25x7ld6mv2yb2xdznvmh680000gn/T/devexpert-show-score-distribution/` (5 files) were generated but not visually openable this session; layout, order, widths, wrapping, contrast, focusables, and overflow were asserted programmatically. Disclosure: physical keyboards/touch cannot be exercised headless; the zero-focusable contract is asserted via DOM enumeration, consistent with prior features.
- `index.html`, `src/score.js`, `src/storage.js`, `src/roster.js`, `src/game.js`, `scripts/smoke.mjs`, `scripts/static-server.mjs`, `scripts/browser-test-utils.mjs`, and all pre-existing suites are untouched (git diff: 0 lines); the envelope version stayed 1; `persistActiveGameSnapshot` still has exactly six call sites; no new persisted fields; `src/main.js` changed render-only and `src/standings.js`/`src/styles.css` have 0 removed lines.
- Updated README (distribution-block behavior, the new command, the chained test description, next steps), ARCHITECTURE.md (the `scoreDistribution` derivation boundary, render-only wiring, the new suite, a score-distribution boundaries paragraph), and CONSTRAINTS.md (durable distribution rules).
- Next: run independent `$feature-validator` for `show-score-distribution`; after acceptance, commit, push `codex/show-score-distribution`, and open the PR (the untracked spec file `docs/specs/show-score-distribution.md` and the new suite belong to this feature's PR).
- Independent validation: the validator reran `CI=true ./init.sh` (15 browser suites), `npm run test`, and the focused suite (all exit 0), hand-re-derived the Hamilton math (mockup parity, the pinned naive-rounding counterexample, mixed-sign denominator of positive totals, the structural sum-100 bound at 20 players), confirmed the 0-line regression floor across `index.html`, score/storage/roster/game.js, harness scripts, and all pre-existing suites, verified six `persistActiveGameSnapshot` call sites, envelope version 1, escaped legend names, bounded percent widths, and no security findings. One cosmetic README feature-count nit corrected pre-commit. Status persisted as `accepted` in `feature_list.json`.

### 2026-10-16 — Setup-order player number badges implementation (show-player-numbers)

- Landed the pure layer first. `src/roster.js`: added `playerNumbers(game)` — a `Map` keyed by `player.id` → the player's 1-based position in `game.players` (the setup order), with empty-`Map` guards for non-object games and non-array players and non-object entries skipped without consuming a position; the input is never mutated and each call returns a fresh Map. The badge number is therefore derived at render time and never persisted anew; `createGame` still writes `marker: String(index + 1)` exactly as accepted (src/game.js untouched). `scripts/roster-test.mjs` gained only additive cases (1..N mapping, replay-shaped rosters, guards, corrupt-entry skipping, fresh Maps, structuredClone immutability) and an updated summary line.
- Wired the display layer in `src/main.js` render-only — no handler, state, or save-path change: `renderActiveGame`/`renderFinishedGame`/`renderPodiumDialog`/`renderRecentEntries` each build `playerNumbers(game)` once and thread numbers into `renderActivePlayer`/`renderFinishedPlayer`/`renderPodiumPlayer`/`renderRecentEntry`/`renderScoreForm` (new parameter). The five token sites now render the derived number instead of `player.marker` (zero `player.marker` reads remain); the four numbered non-hidden token aria-labels are renamed `Player {n}, {color.label}` (active row, finished row, podium, recent entry); the score-entry card gained the visible `<span class="score-selected-number">Player {n}</span>` subtitle beside the name (a sibling of `.score-selected-name`, whose suite-frozen `panelName` text read stays byte-identical). Setup rows keep their existing positional numbering.
- Styled `src/styles.css` additively only: one new `.score-selected-number` rule (muted `var(--muted)` — the suite-frozen `#6D655C` at 5.6:1 AA on the panel surface — `--text-label-md`, weight 600, `overflow-wrap: anywhere`) following the panel label rhythm; no existing selector, token, breakpoint, or motion rule was modified, and the `.player-token` system with its white/yellow dark-outline rules is unchanged.
- Tests: the two spec-mandated honest one-line updates only — `scripts/browser-podium-test.mjs:332` and `scripts/browser-game-activity-test.mjs:399` assert `Player 1, Blue` with supersession comments; every other pre-existing suite is byte-untouched. New `scripts/browser-player-numbers-test.mjs` (five isolated Chrome sessions, 1280×800 and 320×720: setup renumber-on-remove with duplicate names/colors and the accepted positional labels; rank/badge independence with 12/12/8 → ranks 1,1,3 and a reordering +20 save whose tied 12s share rank 2 while badges follow players; the score-card subtitle; recent-entries/podium/finished badges; reload-resume stability and 1..N replay renumbering with the stored marker field still written; a seeded `marker: "7"` + missing-marker record degrading to truthful positions with a byte-identical payload across renders and selection; the storage shape unchanged (game keys [createdAt,id,players,status,title,updatedAt], player keys [color,id,marker,name,order,total], envelope version 1); and the a11y/responsive baseline — `Player {n}, {color}` labels, visible names, the muted subtitle, zero focusable badge elements, ≥44px targets, visible focus, no overflow, zero console errors) wired as `npm run test:browser:player-numbers`, chained into `npm run test`, and added to `init.sh`'s `node --check` list (26 entries). Fixed during self-verification: three suite-authoring expectation errors in the new suite only (competition ranks with tied totals are 1,2,2 — not 1,2,3 — and the creation-order tiebreak puts player 2 before player 3); one flow bug (the reorder save needed an explicit player-3 reselection after the score-card check). No product-code failures were found by the suites.
- Verification: `node --check` on touched sources and the new suite passed; `npm run test:roster` passed additive-only; `npm run test:browser:player-numbers` passed on real headless Chrome across all five sessions; `npm run test:browser:podium` and `npm run test:browser:game-activity` passed with exactly the one honest line each; `npm run test` passed end to end (exit 0) with all fourteen browser suites chained and the twelve other pre-existing suites green byte-untouched; `./init.sh` and `CI=true ./init.sh` both passed (exit 0, 26 node --check entries) and exited without starting a server; the `npm run dev` probe returned 200 for `/`, `/src/roster.js`, `/src/main.js`, and `/src/styles.css` and 404 for `/AGENTS.md`. Screenshots under `/var/folders/24/yg25x7ld6mv2yb2xdznvmh680000gn/T/devexpert-show-player-numbers/` (5 files) were generated but not visually openable this session; layout, visibility, contrast, targets, focus, and overflow were asserted programmatically. Disclosure: physical keyboards/touch cannot be exercised headless; the keyboard contract is verified via CDP real-key walks, consistent with prior features.
- `index.html`, `src/score.js`, `src/storage.js`, `src/standings.js`, `src/game.js`, `scripts/smoke.mjs`, `scripts/static-server.mjs`, `scripts/browser-test-utils.mjs`, and all pre-existing suites except the two named one-line updates are untouched (git diff: 0 lines); the envelope version stayed 1; `persistActiveGameSnapshot` still has exactly six call sites; no new persisted fields.
- Updated README (badge behavior, the new command, next steps), ARCHITECTURE.md (the `playerNumbers` derivation boundary, render-only wiring, the new suite, a player-number boundaries paragraph), and CONSTRAINTS.md (durable badge rules).
- Next: run independent `$feature-validator` for `show-player-numbers`; after acceptance, commit, push `codex/show-player-numbers`, and open the PR (the untracked spec file `docs/specs/show-player-numbers.md` and the new suite belong to this feature's PR).
- Independent validation: the validator reran `CI=true ./init.sh`, `npm run test` (14 browser suites), and the focused suite (all exit 0); confirmed exactly the two honest one-line label updates with everything else byte-untouched (including `src/storage.js` and `index.html`), the marker-written-not-read boundary with corrupt/missing markers degrading to truthful positions at byte-identical payloads, rank-vs-badge independence on ties, replay renumbering, and the six `persistActiveGameSnapshot` call sites; no security findings. One cosmetic prose count nit corrected in evidence during acceptance. Status persisted as `accepted` in `feature_list.json`.

### 2026-10-16 — Quick tap counters and signed stepper implementation (add-quick-score-entry)

- Wired the input conveniences in `src/main.js` additive-only: local `QUICK_SCORE_PRESETS = [1, 5, 10, 25, -1, -5, -10]`; `renderScoreForm` wraps `#score-amount` in a `.score-stepper` row (− button, input, + button, all `type="button"`, Decision 6 "draft" aria-labels) and renders the `.quick-scores` group (role=group `aria-label="Quick tap counters"`, visible eyebrow, two ordered rows, per-button `data-amount`, `Add {n} point(s) to {name}` accessible names with signed amount and |n|=1 pluralization, `.is-negative` tint on negative chips) between `#score-feedback` and Save points — Save→Undo sibling adjacency preserved. Handlers: `handleQuickScore(amount)` overwrites the draft with `String(amount)` (discard, never sum) and calls `handleScoreSubmit()`, refocusing the pressed counter (matched by `data-action` + `data-amount`) only on success; `stepScoreDraft(direction)` reads the numeric draft (0 baseline for empty/unparseable — a `type="number"` input sanitizes `12.` and a lone sign to `""`, so the spec's `12.`→`13` normalization is unreachable through the real input and the observable 0-baseline path is pinned in the suite), clamps to ±`MAX_SCORE_ABS`, writes plain integer text, and never saves/re-renders/paints feedback; `handleScoreSubmit` gained only returned success booleans (typed-save focus contract untouched); the three actions bind per render in `bindActiveEvents` like `select-player`.
- Styled `src/styles.css` additively only: `.score-stepper` (+ scoped flex rule so the 100%-width field shares the row), `.stepper-action` (44×44 secondary-styled), `.quick-scores`/`.quick-scores-eyebrow`/`.quick-scores-row`, `.quick-score-action` (+ `.is-negative` using the selected-row token `--primary-fixed`; visible `+`/`-` signs so color is never the only signal), all ≥44px with tabular numerals; no existing selector, token, breakpoint, or motion rule modified; no ≤360px compaction was needed (flex chips measured overflow-free at 320px).
- Tests: new `scripts/browser-quick-score-test.mjs` (five isolated Chrome sessions covering Scenarios 1–6: the desktop counters contract + every preset + seven-undo drain with a byte-identical no-op, stepper staging with byte-identity/no-re-render/0-baseline/clamp proofs plus ordinary stepped-draft save and the exact zero message, draft discard without summing, 320×720/1280×800 targets/names/group-label/tab-order/real-key Enter repeat-press with no overflow, blocked-write in-memory apply with unchanged notice copy and code-only warnings plus zero counters/stepper in finished and active-empty views) wired as `npm run test:browser:quick-score`, chained into `npm run test`, and added to `init.sh`'s `node --check` list. Fixed during self-verification: three suite-authoring bugs (a wrong-game payload lookup, leaderboard re-sort row-index expectations after negative applies, and the real-key walk restructured so the Enter proof sits on the genuinely tab-reached +5). No product-code failures were found by the new suite.
- Pre-existing flake found and fixed: one `CI=true ./init.sh` run failed in the play-again suite (`Missing selector: [data-action='close-podium']` in the repeated-replays session). Root cause: the documented Chrome queued dialog-`close` behavior — a stale close from an already-dismissed podium delivered after a later podium opened in the same document and clobbered `state.podiumOpen`, re-rendering without the dialog. Reproduced standalone 3/9 with the feature changes and 1/16 on the untouched baseline (git stash), proving it pre-existing. Fixed with a minimal hardening in `src/main.js`'s close fallback (`if (!dialog.isConnected) return;` before `handlePodiumClose()`) — no suite changed, no accepted behavior changed; play-then passed 8/8 standalone, podium/finish-game/quick-score suites green, and both gate modes passed afterward.
- Verification: `node --check` on touched sources and the new suite passed; `npm run test:score` passed unmodified; `npm run test:browser:quick-score` passed on real headless Chrome across all five sessions; `npm run test` passed end to end (exit 0, twice) with all thirteen browser suites chained and the twelve pre-existing suites green byte-untouched; `./init.sh` and `CI=true ./init.sh` both passed (exit 0, 25 node --check entries) and exited without starting a server; the `npm run dev` probe returned 200 for `/`, `/src/main.js`, and `/src/styles.css` and 404 for `/AGENTS.md`. Screenshots under `/var/folders/24/yg25x7ld6mv2yb2xdznvmh680000gn/T/devexpert-add-quick-score-entry/` (3 files) were generated but not visually openable this session; layout, targets, focus, overflow, and names were asserted programmatically. Disclosure: physical keyboards/touch cannot be exercised headless; the keyboard contract is verified via CDP real-key walks, consistent with prior features.
- `index.html`, `src/score.js`, `src/storage.js`, `src/standings.js`, `src/roster.js`, `src/game.js`, `scripts/smoke.mjs`, `scripts/static-server.mjs`, `scripts/browser-test-utils.mjs`, and all twelve pre-existing browser suites are untouched (git diff: 0 lines); the envelope version stayed 1; `persistActiveGameSnapshot` still has exactly six call sites.
- Updated README (quick-entry behavior, the new command, next steps), ARCHITECTURE.md (counter/stepper wiring as a new UI entry into the existing score-save trigger, stepper draft semantics, the new suite, the podium stale-close hardening note, boundaries paragraph), and CONSTRAINTS.md (durable quick-entry rules and the detached-dialog close-fallback rule).
- Next: run independent `$feature-validator` for `add-quick-score-entry`; after acceptance, commit, push `codex/add-quick-score-entry`, and open the PR (the untracked spec file `docs/specs/add-quick-score-entry.md` and the new suite belong to this feature's PR).
- Independent validation: the validator reran `CI=true ./init.sh`, `npm run test` (13 browser suites), and the focused suite (all exit 0), ran the play-again suite three more times standalone (flake fix holds, 5/5 green on the day), verified the six `persistActiveGameSnapshot` call sites and the 0-line diff across `index.html`, `src/score.js`, storage/game/standings/roster.js, all harness scripts, and all twelve pre-existing suites, assessed the detached-dialog podium guard analytically (live dialogs unaffected; only stale queued close events are skipped) and confirmed it belongs in this PR, and returned **accept** with no security findings. Two low notes resolved: a cosmetic `ARCHITECTURE.md` whitespace slip (fixed pre-commit) and a spec example made unreachable by `type=number` sanitization (normative 0-baseline rule implemented, pinned in the suite, disclosed). Status persisted as `accepted` in `feature_list.json`.

### 2026-10-15 — Activity timestamps and recent entries implementation (track-game-activity)

- Landed the pure layer first. `src/score.js`: `applyScoreChange` gained the injectable `now = new Date()` parameter (same precedent as `finishGame`/`replayGame`) and stamps each new change entry with `at: now.toISOString()` — entries are now `{ id, playerId, amount, at }` so per-entry relative times survive reload (the game-level `updatedAt` alone cannot date older entries); exported `RECENT_ENTRIES_LIMIT = 8` and pure `recentScoreChanges({ game, limit = RECENT_ENTRIES_LIMIT })` returning the newest renderable changes as `{ change, player }` pairs, newest first, skipping entries whose `playerId` resolves to no player (skips do not consume cap slots), never mutating its input, with empty guards for null/missing/non-array logs. `src/game.js`: exported `formatRelativeTimestamp(value, now = new Date())` — `< 1m` (including future skew) → `just now`, then floored `{m}m ago`/`{h}h ago`/`{d}d ago` buckets, then ≥ 7 days reusing the private `formatTitleStamp` for the identical `{d MMM, HH:mm}` absolute stamp; non-string/unparseable input returns `null`; no locale APIs anywhere.
- Wired the display layer in `src/main.js` with no handler, save-trigger, focus, or copy changes: `formatSavedGameUpdated` was rewritten from the `toLocaleString` label to the deterministic walk `updatedAt` → `createdAt` → bare `Updated` fallback, rendering `Updated {token}` through `formatRelativeTimestamp` (every accepted `/^Updated /` card assertion holds); `renderRecentEntries(game)` renders the display-only `.recent-entries` block in the score panel between the score form and the finish section (`${renderScoreForm(...)}${renderRecentEntries(game)}${renderFinishSection()}`) — eyebrow `Recent entries` beside the right-aligned `Last: {name} {signedAmount}` context line (no "pts" in the header, rendered only when an entry renders), an `aria-label="Recent entries"` list of token/name/`{+|-}{amount} pts`/relative-time rows reusing the `.player-token` marker-label convention, the muted "No score changes yet." empty state (distinct from the undo info message), muted `—` time cells for entries without a parseable `at`, and a private `signedScoreAmount` helper (explicit `+` for positives). Finished views render no panel. Undo derives for free: the popped change stops rendering and `Last:` recomputes — no new live region (#score-feedback already announces saves/undoes).
- Styled `src/styles.css` additively only: `.recent-entries`/`.recent-entries-empty`/`.recent-entries-header`/`.recent-entries-last`/`.recent-entries-list`/`.recent-entry` (token/name/amount/time grid) with `.is-positive`/`.is-negative` amount token colors (sign always visible) and a scoped ≤360px compaction (smaller token, label-sm fonts) so amount and time never collide; no existing selector, token, breakpoint, or motion rule was modified.
- Tests: the two spec-mandated honest updates only — `scripts/score-test.mjs` (the undo key-list gains "at" with a supersession comment; new injected-`now` `at`-stamp and `recentScoreChanges` cap/order/skip/immutability/empty cases; summary line updated) and `scripts/storage-test.mjs` (the round-trip key list gains "at" with a supersession comment; nothing else; summary line updated); `scripts/game-test.mjs` gained the spec'd new `formatRelativeTimestamp` bucket/boundary/skew/purity/null cases, an absolute-branch equality check against the auto-label format, and an `applyScoreChange` injected-`now` case with all existing assertions holding unchanged. New `scripts/browser-game-activity-test.mjs` (six isolated Chrome sessions covering Scenarios 1–6: UI-scored order/`Last:`/feedback/placement with reload-resume persistence, seeded-stamp exact tokens incl. absolute + corrupt/missing card fallbacks + cap-8-with-ghost + legacy `—` rows + finished no-panel, undo derivation with fresh `updatedAt` and byte-identical no-op, blocked-write undo with unchanged notice copy and code-only warnings, finish-freeze/replay-clean with byte-identical original, and the 320×720/1280×800 overflow/focusable/frozen-`--muted`/AA-contrast/zero-console baseline) wired as `npm run test:browser:game-activity`, chained into `npm run test`, and added to `init.sh`'s `node --check` list. Fixed during self-verification: three suite-authoring bugs (an inverted `compareDocumentPosition` placement check; two contrast reads aimed at cells absent from the currently resumed game — the empty state is read on the no-stamps game and the signed-amount contrast set on the mixed game). No product-code failures were found by the suites.
- Verification: `node --check` on all touched sources and test scripts passed; `npm run test:score`, `npm run test:storage`, and `npm run test:game` passed with the honest updates; `npm run test:browser:game-activity` passed on real headless Chrome across all six sessions; `npm run test` passed end to end (exit 0) with all twelve browser suites chained and the eleven pre-existing suites green and byte-untouched (only score-test/storage-test/game-test changed, exactly the spec'd honest deltas — verified via git diff removed-lines review); `./init.sh` and `CI=true ./init.sh` both passed (exit 0, 24 node --check entries, no Chrome-launch timeout) and exited without starting a server; the `npm run dev` probe returned 200 for `/`, `/src/score.js`, `/src/game.js`, `/src/main.js`, and `/src/styles.css` and 404 for `/AGENTS.md`. Screenshots under `/var/folders/24/yg25x7ld6mv2yb2xdznvmh680000gn/T/devexpert-track-game-activity/` (5 files) were generated but not visually openable this session; layout, overflow, contrast, focusability, and tokens were asserted programmatically. Disclosure: real-device clocks/timezones cannot be varied headless; determinism is verified via seeded stamps with floor-math margins and the injectable `now`, consistent with the `displayGameTitle` precedent.
- `src/storage.js` and `index.html` are untouched (git diff: 0 lines) as are `src/standings.js`, `src/roster.js`, `scripts/smoke.mjs`, `scripts/static-server.mjs`, `scripts/browser-test-utils.mjs`, and all eleven pre-existing browser suites; the envelope version stayed 1; the six save triggers stayed exactly six (`updatedAt` remains the sole last-activity source; navigation/resume/selection/prompt open-cancel/failed writes write nothing); smoke strings, the nav matrix, write-absence proofs, and the suite-frozen `--muted` hold.
- Updated README (relative `Updated` labels on both card lists, the Recent entries panel with `Last:` context and undo/legacy/replay behavior, the new command, next steps), ARCHITECTURE.md (`at` stamps, `recentScoreChanges`/`RECENT_ENTRIES_LIMIT`, `formatRelativeTimestamp` thresholds, the entries display block, the card recency chain, the new suite, an activity boundaries paragraph), and CONSTRAINTS.md (durable activity rules: stored-data-only derivation, required per-change `at`, deterministic no-locale formatting with locked thresholds and null fallbacks, graceful degradation, frozen finished stamps never re-persisted by replay, display-only panel with visible sign characters).
- Next: run independent `$feature-validator` for `track-game-activity`; after acceptance, commit, push `codex/track-game-activity`, and open the PR (the untracked spec file `docs/specs/track-game-activity.md` and the new suite belong to this feature's PR).
- Independent validation: the validator reran `CI=true ./init.sh`, `npm run test`, and the focused suite (all exit 0), confirmed `src/storage.js`/`index.html` and all eleven pre-existing browser suites byte-untouched with exactly the spec-mandated unit deltas, spot-checked seeded-stamp tokens, cap-8 ghost handling, fallbacks, undo byte-identity, finish-freeze/replay, and AA contrast, and returned **accept** with no security findings and one low note resolved pre-commit by rewording an overstated notice-copy evidence clause (suite unchanged). Status persisted as `accepted` in `feature_list.json`.

### 2026-10-15 — Game-titles implementation (name-game-titles)

- Landed the pure layer first. `src/roster.js`: added `MAX_TITLE_LENGTH = 60`, removed `FALLBACK_TITLE`, and `createGame` now stores the trimmed optional title (`typeof title === "string" ? title.trim() : ""` — blank/non-string store `""`, no fallback substitution). `src/game.js`: removed the `FALLBACK_TITLE` import; `replayGame` passes `title: ""` so replays always start untitled (supersedes the accepted copy-the-title behavior per the spec); added pure `renameGame({ game, title })` with the guard order missing-game → already-finished (checked before title validation, so finished titles are frozen and statusless games can't be renamed) → invalid-title → title-too-long (trimmed length > 60) and a success shape of `{ game: { ...game, title: trimmedTitle }, error: null }` without mutating the input; added `displayGameTitle(game)` with the private deterministic `formatTitleStamp` (`Game — {d MMM, HH:mm}` from `createdAt` in local time — unpadded day, short English months, zero-padded 24-hour time, no locale formatting — or plain `Game` for missing/non-string/unparseable stamps; stored titles render verbatim, never re-trimmed); `GAME_ERROR_CODES` is now exactly `["missing-game", "already-finished", "not-finished", "invalid-roster", "invalid-title", "title-too-long"]`. One test-authoring fix during self-verification: displayGameTitle parses stamps in local time, so unit assertions use local-anchored ISO strings (a raw `…Z` string correctly renders that instant in the viewer's timezone).
- Wired the display layer in `src/main.js`: `state.title` defaults to `""` and `resetSetup` resets it; the setup input gained `placeholder="Optional — e.g. Friday game night"` and `maxlength="${MAX_TITLE_LENGTH}"`; all six title render points now use `displayGameTitle` (ongoing/finished card titles, Resume/View results aria-labels, active + finished headers — replacing `game.title ?? "Untitled game"`/`"this game"`); `renderPodiumDialog(podium, game)` renders the muted `.podium-game-title` line as the first content element in `.podium-body` before the suite-frozen `h2#podium-title`; the raw stored title (never the auto-label) feeds setup and edit inputs.
- Added the header edit affordance: `state.titleEditOpen`/`state.titleDraft`/`state.titleEditFeedback` reset exactly where `finishPromptOpen` resets (resetSetup, handleResume, the active back-home handler, handlePlayAgain) plus the finish success path. Display mode renders the heading plus a `type="button"` `title-edit-action` "Edit title" (`data-action="open-title-edit"`) beside it; edit mode replaces both with the inline `.title-edit-form` (eyebrow kept, `label[for]` "Game title", `#active-title-input` maxlength 60 prefilled with the raw stored title, polite `#title-edit-feedback` live region, primary "Save title" submit + secondary "Cancel"). Opening focuses the input; Enter submits natively; Escape cancels via a form keydown listener; Save/Cancel return focus to `[data-active-heading]`; the draft tracks input events so re-renders (e.g. a score save during edit) keep the form open with the draft. `handleTitleSave` calls `renameGame`, on success persists through the unchanged `persistActiveGameSnapshot()` — the sixth successful-mutation save trigger — then closes, re-renders, repaints the storage notice, and focuses the heading; guard failures paint the mapped message (`invalid-title`/`title-too-long` joined `SCORE_ERROR_MESSAGES`) plus `console.warn("Game rename failed:", code)` without re-render. The finished view renders no edit control.
- Styled `src/styles.css` additively: `.title-edit-action` (pill on the `.add-points-action` precedent, ≥44px), `.title-edit-form` (grid; `min-width: 0` and a `min-width: 0` on its text field so it can shrink as a flex item), `.podium-game-title` (muted eyebrow-style using the suite-frozen `--muted`), plus two scoped media rules inside the existing breakpoints: at ≤720px `.active-header:has(.title-edit-action)/:has(.title-edit-form)` gains `flex-wrap: wrap` and the form takes a full row (`flex: 1 1 100%; order: 4`), and at ≤360px the edit action goes full width like the other actions. The wrap rule is a documented implementation-time necessity: measured in headless Chrome, the header's fixed items (All games 95px + players pill 94px + gaps) already need 221px of the 264px available at 320px, so a labeled ≥44px Edit title control geometrically cannot share the row; scoping via `:has()` keeps every view without the new control pixel-identical (finished header layout unchanged, verified). No existing selector, token, breakpoint, or motion rule was modified.
- Tests: honest spec-mandated updates only — `scripts/roster-test.mjs` (blank/non-string/missing titles store `""` with the supersession comment; summary line updated), `scripts/game-test.mjs` (replay title assertions flipped to untitled with supersession comments; new renameGame/displayGameTitle/GAME_ERROR_CODES cases; `FALLBACK_TITLE` import dropped; summary line updated), `scripts/browser-design-system-test.mjs` (nav-matrix session fills `#game-title` with "Matrix night" before submit so its exact heading assertion holds — the session tests reopen semantics, not labels), and `scripts/browser-play-again-test.mjs` (replay heading/cards/accessible-name assertions now prove the auto-label pattern and inequality with the original, the stored replay entry asserts `title: ""`, summary line updated). New `scripts/browser-game-title-test.mjs` (six isolated Chrome sessions covering Scenarios 1–6 with `readSavedGamesState` byte-identity proofs, in-page recomputation of the deterministic label, blocked-write rename with the unchanged notice copy and code-only warnings, verbatim pre-feature records, and the real-keyboard rename walk) wired as `npm run test:browser:game-title`, chained into `npm run test`, and added to `init.sh`'s `node --check` list. Fixed during self-verification: two suite-authoring bugs (byte-identity baselines captured before the finish write — a legitimate save; the legacy-records seed script re-seeding on every navigation and wiping the persisted rename — now guarded by a once-per-tab sessionStorage marker) plus a Tab-walk start-point fix (the hero New game already focuses the title field, so the walk starts from the nav path that focuses the setup heading).
- Verification: `node --check` on all touched sources and the new suite passed; `npm run test:roster`, `npm run test:game`, and `npm run test:storage` (unmodified) passed; `npm run test:browser:play-again` and `npm run test:browser:design-system` passed with the honest updates; `npm run test:browser:game-title` passed on real headless Chrome across all six sessions (titled end-to-end, blank auto-label with in-page format recomputation and reload stability, edit save/cancel/Escape/Enter/clear-to-blank with byte-identical cancel payloads, blocked-write rename with the role=status notice, finish-freeze + untitled replay with a byte-identical original, verbatim legacy records with a persisting rename, and 320px/1280px overflow/target/focus/keyboard checks with zero uncaught console errors); `npm run test` passed end to end (exit 0) with all eleven browser suites chained and the ten pre-existing suites green; `./init.sh` and `CI=true ./init.sh` both passed (exit 0, 23 node --check entries, no Chrome-launch timeout) and exited without starting a server; the `npm run dev` probe returned 200 for `/`, `/src/game.js`, `/src/roster.js`, `/src/main.js`, and `/src/styles.css` and 404 for `/AGENTS.md`. Screenshots under `/var/folders/24/yg25x7ld6mv2yb2xdznvmh680000gn/T/devexpert-name-game-titles/` (7 files) were generated but not visually openable this session; layout, overflow, targets, focus, and computed styles were asserted programmatically. Disclosure: physical keyboards/IMEs cannot be exercised headless; the keyboard contract is verified via CDP real-key walks, consistent with prior features.
- `src/storage.js` and `index.html` are untouched (git diff: 0 lines); the envelope version stayed 1; no migration was needed (`isUsableGameEntry` still ignores `title`); smoke strings and the design-system suite's byte-identical write-absence proofs and nav matrix hold.
- Updated README (optional title + auto-label + inline-edit behavior, replay starting untitled, the save-trigger list, the new command, next steps), ARCHITECTURE.md (renameGame/displayGameTitle/replay-untitled boundaries, header edit form with the sixth save trigger, podium title line, new suite, title boundary paragraph), and CONSTRAINTS.md (durable title rules: display-only identity, trim-once storage, guard order, frozen finished titles, render-time auto-label never stored or rewritten, sixth save trigger, untitled replays).
- Next: run independent `$feature-validator` for `name-game-titles`; after acceptance, commit, push `codex/name-game-titles`, and open the PR (the untracked spec file `docs/specs/name-game-titles.md` belongs to this feature's PR).
- Independent validation: the validator reran `CI=true ./init.sh`, `npm run test`, and the focused suite (all exit 0), confirmed `src/storage.js`/`index.html` at a 0-line diff, verified both supersessions were the only pre-existing-suite changes (all honestly commented), checked every title sink for escaping, and returned **accept** with no security findings and two low non-blocking notes (unreachable `missing-game` message reuse; `:has()` browser support consistent with the Chrome-based harness). Status persisted as `accepted` in `feature_list.json`.

### 2026-10-15 — v2 design-system implementation (refresh-design-system)

- Restyled the app onto the v2 token system as a restyle-only slice. `src/styles.css` was rewritten around the Decision 1 token layer (ivory `#FAF5EB` canvas, cool surfaces `#F1F3FD`/`#EBEEF7`/`#E5E8F2`, `--border-cool #C1C6D5`, primary `#0868C9` + `--primary-dark #00509F`, tertiary `#883A00` on `#FFE5D9` for the Finish family, error `#BA1A1A` on `--error-container #FFDAD6` for storage notices, soft shadow/radius/spacing scales, Plus Jakarta Sans type scale with tabular 28px score numerals compacting to 1.35rem ≤360px). Every hardcoded `#9f271e` was replaced by the token mappings. `--muted` stayed `#6D655C` (suite-frozen by `browser-undo-test.mjs`). All class/id/grid-area contracts, the 720/480/360 breakpoints, both reduced-motion rules, and the `podium-fall` confetti contract are unchanged. Implementation choice recorded in evidence: the selected leaderboard row uses `--primary-fixed #D6E3FF` (the token file's soft-selection role).
- `index.html` gained the Google Fonts preconnect pair plus the Plus Jakarta Sans stylesheet (`wght@400;600;700;800`, `display=swap`; no font files committed, static-server/smoke untouched) and the static v2 app bar: brand block (eyebrow "Board-game scorekeeper" + "Game night" + marker strip) and `<nav aria-label="Primary">` with three buttons `nav-dashboard` / `nav-new-game` / `nav-active-game` (distinct ids; no collision with existing `data-action` values).
- Extended `src/main.js`: one-time nav binding (Dashboard = back-home semantics + `[data-home-heading]` focus; New Game = destination view preserving the setup scratchpad + `[data-setup-heading]` focus; Active Game resolving in-memory game → newest saved active via unchanged `handleResume` → the new `active-empty` view), `paintNav()` in `render()` for `aria-current` (Dashboard on home and finished views, New Game on setup, Active Game on unfinished/empty), focusable home/setup/empty-state headings (`tabindex="-1"` + data attributes), and the `active-empty` view with the locked copy and a New game button reusing the accepted hero transition. Navigation never writes storage; no handler logic, copy, or focus targets elsewhere changed.
- Added `scripts/browser-design-system-test.mjs` (five isolated Chrome sessions: offline font fallback via `Network.setBlockedURLs`, per-view token/layout checks at 1280×800 and 320×720, the nav behavior matrix with byte-identical-payload write-absence proofs, reduced-motion + skip-link, and storage-notice regression) wired as `npm run test:browser:design-system`, chained into `npm run test`, and added to `init.sh`'s `node --check` list. Fixed during self-verification: Chrome reports inspector-blocked requests with `blockedReason` and an empty `errorText`, so the blocked-font probe matches both shapes (caught by the suite's own guard, fixed with a minimal CDP probe).
- Updated README (v2 look, nav behavior, offline fallback, new command, next steps), ARCHITECTURE.md (token layer + font boundary, static nav with resolution order, `active-empty`, `paintNav`, new suite, boundaries), and CONSTRAINTS.md (durable rules: token-translation-only restyles; no Tailwind/CDN scripts/icon fonts with labeled-text or `aria-hidden`-SVG icons; suite-frozen `--muted`; nav is display/state-only, never writes, focus-to-heading).
- Verification: `node --check` on `src/main.js` and the new suite passed; `npm run test:browser:design-system` passed on real headless Chrome across all five sessions (tokens, offline fallback hierarchy/tabular numerals/no overflow, nav matrix with `aria-current` per view including finished → Dashboard, Active Game resolution order, byte-identical storage across every navigation, ≥44px targets, visible focus, skip link first, reduced-motion suppression, exact notice copy/role/contrast; zero uncaught console errors); `npm run test` passed end to end (exit 0) with all ten browser suites chained and the nine pre-existing suites unmodified and green; `./init.sh` and `CI=true ./init.sh` both passed (exit 0, no Chrome-launch timeout) and exited without starting a server; the `npm run dev` probe returned 200 for `/`, `/src/styles.css`, and `/src/main.js` and 404 for `/AGENTS.md`. Screenshots under `/var/folders/24/yg25x7ld6mv2yb2xdznvmh680000gn/T/devexpert-refresh-design-system/` (8 files) were generated but not visually openable this session; tokens, layout, overflow, targets, focus, nav state, and fallback hierarchy were asserted programmatically.
- Independent validation: the validator reran `CI=true ./init.sh`, `npm run test`, and the focused suite (all exit 0), re-probed the server boundary (200/404/400), confirmed no pre-existing suite changed and the frozen `--muted` contract held, and returned **accept** with no Critical/High/Medium findings and no security issues. Status persisted as `accepted` in `feature_list.json`.
- Next: run independent `$feature-validator` for `refresh-design-system`; after acceptance, commit, push `codex/refresh-design-system`, and open the PR (the untracked spec file `docs/specs/refresh-design-system.md` belongs to this feature's PR).

### 2026-10-15 — v2 design-update discovery and feature planning

- Reviewed the five-screen v2 design set and token file with the user; adopted them as the visual source of truth and moved the assets from the untracked `Design update/` folder into `docs/design/update-v2/`.
- Updated `CONTEXT.md` (four new glossary terms plus a decoration warning), `docs/build-brief.md` (delivered-MVP status, v2 scope, extended non-goals and validation), `docs/domain-model.md` (game titles, activity timestamps, player numbers, derived views), `docs/risks-and-open-questions.md` (game identification resolved; new implementation-time decisions), and `DESIGN.md` (new visual source of truth; mockup decoration marked do-not-implement).
- Agreed scope: visual refresh plus bounded additions (titles, activity timestamps + recent entries, quick tap counters, player numbers, distribution bar, podium actions). Explicitly out of scope: rounds/timers, dashboard statistics, presets, roster reuse, one-tap games; Tailwind rejected in favor of plain CSS with linked fonts and fallbacks.
- Appended the seven v2 features to `feature_list.json` as `not_started` with `depends_on: ["refresh-design-system"]` except the foundation feature itself.

### 2026-10-12 — Score-entry restriction implementation (restrict-score-entry-input)

- Completed the interrupted implementer run (the tree already held partial
  uncommitted work on the same branch; it was verified against the spec and
  kept — nothing was reverted or redone). `src/score.js` gained the exported
  predicates `isPlainIntegerText` (`/^[+-]?\d+$/` on the trimmed text) and
  `isPlainScoreDraft` (`/^[+-]?\d*\.?\d*$/`, the entry/draft pattern that
  allows empty, a lone sign, and a transient decimal), plus one final
  plain-format gate in `parseScoreAmount` ordered after the existing
  finite/integer/zero/range checks: exact-integer text that is not plain
  (`1e3`, `0x10`, `10.`) returns the existing `{ error: "not-a-number" }`, so
  every prior error mapping is preserved bit-for-bit (`1e-3` → not-integer,
  `0.0` → zero, `1e30` → out-of-range). This supersedes the documented
  add-player-score `1e3` semantic-parse decision; no value is ever silently
  rewritten.
- Extended `src/main.js`: `bindActiveEvents` attaches a `beforeinput`
  listener (`guardScoreEntryInput`) to `#score-amount`. For insertion input
  types with string `data` it builds the prospective value (selection
  replaced by the data, falling back to the data alone when the selection API
  is unavailable — number inputs expose none) and calls `preventDefault()`
  when it fails `isPlainScoreDraft`. Deletion/undo/history types and
  data-less insertions (e.g. some autofill replacements) are never blocked;
  blocked characters are silent, matching how `type="number"` already
  ignores `a`/`x`. `.` stays typable so the typed-decimals save path still
  reaches "Decimals are not allowed." exactly as accepted. No markup, style,
  copy, or focus change; `type="number"` and all attributes stay (signed
  mobile keypad preserved; `inputmode`/`pattern`/type change rejected per
  spec).
- Tests: `scripts/score-test.mjs` honestly flips the `1e3` assertion to
  `{ error: "not-a-number" }` with the supersession comment and adds `+10`,
  `0x10`/`10.`, 14 `isPlainIntegerText`, and 15 `isPlainScoreDraft` cases
  (the `1e-3`/`0.0`/`1e30` neighbors untouched and green).
  `scripts/browser-score-test.mjs` replaces the semantic-`1e3` save with
  `savePoints(cdp, "1000")` (Sam 5 → 1005 keeps the downstream totals
  `["1005","7"]` and `["7","-5"]` valid), adds real-key `e`/`E`/`x` blocking
  via a new `pressRealKey` helper (`Input.dispatchKeyEvent`, since `fill()`
  sets `value` directly and bypasses `beforeinput`) with digits/sign/
  deletion still entering and typing `1e3` yielding `13`, `Input.insertText`
  `"1e3"` blocked wholesale, programmatic `fill("1e3")` rejected at save with
  the not-a-number message and a byte-identical stored payload, a11y
  attributes (type/step/min/max, label, helper, `aria-describedby`,
  `aria-live`) asserted unchanged, and the same real-key letter block at
  320×720; summary line updated. No new files, npm commands, or
  `init.sh`/`package.json` changes.
- Updated README (plain-signed-integers-only usage sentence + final-slice
  next-steps pointer), ARCHITECTURE.md (entry/parse contract on both
  `src/score.js` and `src/main.js` descriptions plus a dedicated guarded
  entry/save paragraph), and CONSTRAINTS.md (durable MUST: two-layer
  plain-integer-only rule with the gate ordered after the existing checks).
- Verification: `node --check` on the four touched files passed;
  `npm run test:score` passed; `npm run test:browser:score` passed on real
  headless Chrome (letter blocking, wholesale insert block, programmatic
  rejection with unchanged totals/focus/storage, all accepted saves and
  rejections, 320px, a11y attributes, zero console errors);
  `npm run test` passed end to end with all nine browser suites chained and
  the other eight unmodified; `./init.sh` and `CI=true ./init.sh` passed
  (exit 0) and exited without starting a server; the `npm run dev` probe
  returned 200 for `/`, `/src/score.js`, and `/src/main.js` and 404 for
  `/AGENTS.md`. Screenshots at
  `/var/folders/24/yg25x7ld6mv2yb2xdznvmh680000gn/T/devexpert-add-player-score/`
  (desktop + 320px) were generated but not visually openable this session;
  layout, targets, focus, and overflow were asserted programmatically. No
  transient Chrome-launch timeout occurred this session.
- Known limitation: a physical mobile keypad cannot be exercised headless;
  the signed keypad contract is preserved by construction (`type="number"`
  kept, no `inputmode`), same disclosure as add-player-score. A physical
  device pass remains available for any manual verification.
- Next: run independent `$feature-validator` for `restrict-score-entry-input`; after
  acceptance, commit `feat: complete restrict-score-entry-input`, push
  `codex/restrict-score-entry-input`, and open the PR (the untracked spec
  file `docs/specs/restrict-score-entry-input.md` belongs to this feature's
  PR).
- Independent validator verdict: `accept`. Reran the score suites, both gate
  modes, an in-process raw HTTP boundary probe, and an independent browser
  probe (typed 2.5 reaches the exact decimals message, insertText
  rejections, silent comma/space blocking, number-input attributes asserted
  live); confirmed no value rewriting, parse gate ordering, and that the
  interrupted-run tree is consistent; no security findings.

### 2026-10-12 — Replay implementation (play-again)

- Added `src/game.js`: pure `replayGame({ game, now = new Date() })` alongside
  `finishGame` (it imports `createGame`/`FALLBACK_TITLE` from `./roster.js` —
  a new edge to the leaf roster module). Guards: missing/invalid game or
  non-array players → `{ game: null, error: "missing-game" }`; any
  non-`"finished"` status → `not-finished`; roster validation failures from
  `createGame` (blank/overlong names, unknown/missing colors, non-string
  names, null entries, <2 or >20 players — reachable only via hand-corrupted
  stored data) → `invalid-roster` without throwing. Success maps the finished
  players to rows and calls `createGame({ title, rows, now, idSeed:
  "replay-game" })`, so ids are `replay-game-<timestamp>` and players
  `replay-game-player-N` — structurally new and unable to collide with
  `active-game-*`. The helper restores each new player's `marker` (nonempty
  string) and `order` (integer) from the original at the same index with the
  regenerated values as fallbacks; non-string titles fall back to
  `FALLBACK_TITLE`; the result has `status: "active"`, zero totals, and no
  `changes`/`updatedAt`; the input is never mutated. `GAME_ERROR_CODES` is
  now exactly `["missing-game", "already-finished", "not-finished",
  "invalid-roster"]`.
- Extended `src/main.js`: `state.replayFeedback` (reset wherever the other
  transient flags reset — `handleResume`, back-home, `resetSetup` — and in
  the handler); `renderFinishedGame` renders a `.replay-section` below the
  standings `<ol>` inside the roster panel with one `type="button"`
  `primary-action` "Play again" (`data-action="play-again"`, visible text as
  the accessible name) and the `#replay-feedback` `aria-live="polite"` region
  (inline-rendered like `#score-feedback`); `handlePlayAgain()` guards
  visibly (message + `console.warn("Game replay failed:", code)` +
  `paintReplayFeedback()` without re-render), and on success mirrors
  `handleResume`: slot replacement, transient resets (`selectedPlayerId` =
  first new player, `scoreFeedback`/`finishPromptOpen`/`podiumOpen`/
  `replayFeedback` = null), the unchanged `persistActiveGameSnapshot()` —
  the fifth successful-mutation save trigger — then `render()`,
  `paintStorageNotice()`, and focus on `[data-active-heading]`.
  `SCORE_ERROR_MESSAGES` gained `not-finished` ("Only finished games can be
  replayed.") and `invalid-roster` ("This game's saved players can't be
  replayed."); `paintReplayFeedback()` mirrors `paintScoreFeedback`; the
  optional-chained `play-again` listener in `bindActiveEvents` leaves the
  active view, home cards, and podium dialog untouched.
- Styled `src/styles.css`: `.replay-section` only (top-border separation and
  16px rhythm mirroring `.finish-section`); the button reuses
  `.primary-action` (≥44px) as-is; no new tokens or motion.
- Tests: extended `scripts/game-test.mjs` with the `replayGame` guard,
  copy-contract, marker/order-restoration-with-fallbacks, non-string-title,
  invalid-roster (8 corrupted shapes), immutability, and 20-player cases plus
  the one honest `GAME_ERROR_CODES` exact-list update; new
  `scripts/browser-play-again-test.mjs` with four isolated Chrome sessions —
  A desktop full MVP flow through replay with byte-identical
  original-entry checks across replay AND replay-game scoring, B
  reopen-and-repeated replays (3 distinct stored games listed once each, no
  re-celebration), C seeded corrupted + valid finished games under blocked
  writes (visible `invalid-roster` refusal, in-memory replay/scoring/undo,
  accepted role=status write notice, byte-identical payload, no phantom
  cards, code-only warnings), and D the 320×720 full loop with real-key
  Tab/Space activation, visible focus, ≥44px target, role=status regions, no
  overflow, and post-reload separation. Wired `test:browser:play-again` into
  `package.json`'s `test` chain and added the new script to `init.sh`'s
  `node --check` list. No new `src/*` module, so the static-server allowlist,
  smoke assets, and required-file list are unchanged.
- Fixed during self-verification: two test-authoring bugs (the 20-player
  unit assertion expected a wrong title; the mobile Tab walk assumed
  `back-home` precedes the heading in Tab order — it precedes it in DOM, so
  forward Tab from the heading reaches Play again first); the corrupted
  roster's rendered name order follows rank (Lonely 3 before the blank-name
  0), so that assertion was corrected to DOM order. No product-code failures
  were found by the suites.
- Verification: `node --check` on all sources and test scripts passed;
  `npm run test:game` passed with the replay cases; `npm run
  test:browser:play-again` passed on real headless Chrome across all four
  sessions (presentation copies token-by-token, zero totals at shared rank 1,
  "Nothing to undo yet.", distinct `replay-game-*`/`active-game-*` ids,
  byte-identical finished original across replay and replay-game scoring,
  independent home listings after reload, repeated replays, the polite
  corrupted-roster refusal, blocked-write honesty with unchanged notice copy
  and code-only warnings, 320px/keyboard/focus checks, zero uncaught console
  errors); `npm run test` passed end to end with all nine browser suites
  chained and the eight existing suites unmodified; `./init.sh` and
  `CI=true ./init.sh` passed (exit 0) and exited without starting a server —
  one CI-mode attempt failed transiently with "Timed out waiting for Chrome
  DevTools endpoint." launching Chrome for the podium suite (a 30s launch
  timeout, no assertion failure involved); the immediate rerun passed fully.
  The `npm run dev` probe returned 200 for `/`, `/src/game.js`,
  `/src/main.js`, and `/src/styles.css` and 404 for `/AGENTS.md`.
  Screenshots under
  `/var/folders/24/yg25x7ld6mv2yb2xdznvmh680000gn/T/devexpert-play-again/`
  (6 files) could not be opened for visual inspection this session because
  temp-directory reads are permission-blocked; layout, visibility, overflow,
  target sizes, focus outlines, and live-region roles were asserted
  programmatically. The manual real-browser pass is covered by the four
  automated real-Chrome sessions at 1280×800 and 320×720 with real-key
  Tab/Space/Escape walks.
- Updated README (replay behavior + new command + next-feature pointer),
  ARCHITECTURE.md (replayGame boundary, finished-view control and feedback
  region, fifth save trigger, home outcomes, new suite), and CONSTRAINTS.md
  (durable rules: replay only via `replayGame` with presentation-only
  copying and a byte-identical stored original, the fifth save trigger under
  the storage-failure rules, control placement, and visible guards).
- Next: run independent `$feature-validator` for `play-again`; after
  acceptance, commit `feat: complete play-again`, push `codex/play-again`,
  and open the PR (the untracked spec file `docs/specs/play-again.md`
  belongs to this feature's PR).
- Independent validator verdict: `accept`. Reran the game and play-again
  suites, two clean CI gate runs (flake did not reproduce; launch timeout,
  not an assertion), HTTP boundary probes, and a full-diff conformance review
  confirming core modules untouched; no security findings.

### 2026-10-12 — Podium celebration implementation (celebrate-podium)

- Added `src/standings.js`: pure `podiumRows(game)` =
  `rankPlayers(game).filter((row) => row.rank <= 3)` — a fresh array per call,
  input never mutated, no rank stored; ties never collapsed. Extended
  `scripts/standings-test.mjs` with the 1,1,3 / 1,2,2-with-rank-4-exclusion /
  20-tied cases, guard cases, immutability, and freshness assertions.
- Extended `src/main.js`: `state.podiumOpen` (default `false`, reset exactly
  where `finishPromptOpen` resets — `resetSetup`, `handleResume`, and the
  back-home handler). The `handleFinishGame` success path keeps the accepted
  `persistActiveGameSnapshot()` unchanged, then sets
  `podiumOpen = podiumRows(result.game).length > 0` and makes the heading
  focus conditional (only when no podium opened). `renderFinishedGame`
  renders the app's first `<dialog>` (`.podium-dialog`,
  `aria-labelledby="podium-title"`, `aria-describedby="podium-lede"`) only
  when the flag is set and rows exist, calls `showModal()` behind an
  `!dialog.open` guard, and focuses the Close button. Markup: `.podium-body`
  (padding + `position: relative`) with the `aria-hidden` confetti layer
  (14 deterministic pieces, inline custom properties for left/delay/duration/
  drift/spin/size/color from the marker tokens), "Final podium" title, lede,
  an `aria-label="Podium players"` `<ol>` of ascending rank groups with empty
  groups omitted, and the `podium-close` Close button. Podium rows reuse
  `.player-token` spans and the `"{name}: rank {rank}, total {total}"` label
  convention. Dismissal funnels through one synchronous idempotent cleanup
  (`handlePodiumClose`: clear flag → `render()` without the dialog → focus
  `[data-active-heading]`).
- Styled `src/styles.css`: `.podium-dialog` (`width: min(calc(100vw - 24px),
  560px)`, `max-height: calc(100svh - 24px)`, `overflow: auto`, surface/
  border/radius/shadow tokens, `::backdrop` scrim), `.podium-body`,
  `.podium-confetti` (absolute inset, hidden overflow, pointer-events none),
  `.confetti-piece` + one `@keyframes podium-fall` (durations 1.6–2.39s,
  delays 0–0.79s, iteration-count 1, forwards, ends at opacity 0, animated
  top/transform), `.podium-title`/`.podium-lede`/`.podium-groups`/
  `.podium-group.is-rank-one` (surface-strong emphasis)/`.podium-rank-heading`
  /`.podium-player*` (four-column grid mirroring `.is-final`, ≤360px
  compaction), full-width `.podium-close` (≥44px via `.primary-action`), an
  explicit `@media (prefers-reduced-motion: reduce) { .podium-confetti {
  display: none; } }`, and no changes to existing rules.
- Tests: new `scripts/browser-podium-test.mjs` (five isolated Chrome sessions
  covering Scenarios 1–7, with local `pressEscape`/`pressSpace`/`pressTab`
  real-key helpers, real backdrop clicks via CDP mouse events, and
  `Emulation.setEmulatedMedia` reduced-motion emulation) and honest updates to
  `scripts/browser-finish-game-test.mjs` (podium-open/focus assertions after
  confirm, dismiss-before-goHome, Escape in the 320px walk, no-podium-on-
  reopen at both reopen points, podium assertions in the blocked-write and
  suppression sessions, two new screenshots). Wired `test:browser:podium`
  into `package.json`'s `test` chain and added the new script to `init.sh`'s
  `node --check` list. No new `src/*` module, so the static-server allowlist,
  smoke assets, and required-file list are unchanged.
- Fixed during self-verification: two test-flow bugs (missing `goHome` calls
  between games) and two real platform findings confirmed with minimal-page
  repros and recorded in the spec — (1) Chrome 154 dispatches the dialog
  `close` event as a queued task that can be delayed for seconds or starved
  indefinitely on hidden pages, so dismissal cleanup cannot rely on it alone;
  the implementation funnels Close/backdrop/Escape (native `cancel` with
  `preventDefault`) through the same synchronous cleanup, keeping the
  `close` listener as an idempotent fallback; (2) with a dialog whose only
  focusable is its Close button, the native modal trap alternates between
  wrapping to that control and transiently resting on `body` before
  recapturing on the next Tab — focus never reaches background controls and
  the dialog stays open, so the suite asserts that guarantee honestly instead
  of a strictly always-inside cycle.
- Verification: `node --check` on all sources and test scripts passed;
  `npm run test:standings` passed with the podiumRows cases;
  `npm run test:browser:podium` passed on real headless Chrome across all
  five sessions (ties 1,1,3 with no fabricated rank-2 group; rank-4
  exclusion; 20-tied single scrolling rank-1 group with internal scroll at
  1280×800 and 320×720 and no page overflow; Close/Escape/backdrop/Space/
  Enter dismissals returning focus to the heading; no re-celebration on
  reopen; byte-identical payloads across open/dismiss including blocked-write
  and invalid-read suppression with code-only warnings; reduced-motion
  confetti `display: none`; ≥44px Close; visible focus; zero uncaught console
  errors); `npm run test:browser:finish-game` passed with the honest updates;
  `npm run test` passed end to end with all eight browser suites chained and
  the six suites other than finish-game unmodified; `./init.sh` and
  `CI=true ./init.sh` passed and exited without starting a server; the
  `npm run dev` probe returned 200 for `/`, `/src/standings.js`,
  `/src/main.js`, and `/src/styles.css` and 404 for `/AGENTS.md`.
  Screenshots under
  `/var/folders/24/yg25x7ld6mv2yb2xdznvmh680000gn/T/devexpert-celebrate-podium/`
  (4 files) plus the finish-game suite's two podium captures could not be
  opened for visual inspection this session because temp-directory reads are
  permission-blocked; layout, visibility, overflow, scroll, target sizes, and
  computed styles were asserted programmatically. The manual real-browser
  pass is covered by the automated real-Chrome sessions at 1280×800 and
  320×720 with real-key and real-mouse dismissal walks.
- Updated README (podium behavior + new command), ARCHITECTURE.md
  (podiumRows, podium display layer, first `<dialog>` modal, dismissal
  funnel), and CONSTRAINTS.md (durable rules: display-only celebration with
  ties never collapsed, zero writes/persisted fields, never re-celebrate on
  revisit, synchronous modal dismissal cleanup, and reduced-motion
  suppression).
- Next: run independent `$feature-validator` for `celebrate-podium`; after
  acceptance, commit `feat: complete celebrate-podium`, push
  `codex/celebrate-podium`, and open the PR (the untracked spec file
  `docs/specs/celebrate-podium.md` belongs to this feature's PR).
- Independent validator verdict: `accept`. Reran both gate modes,
  standings/podium/finish-game suites, HTTP boundary probes, and a static
  spec-conformance review of the full diff; no security findings; the honest
  finish-game suite updates and the two documented Chrome platform findings
  were confirmed.

### 2026-10-12 — Finish-game implementation (finish-game)

- Added `src/game.js`: pure `finishGame({ game, now = new Date() })` — the
  one-way `active → finished` transition. Guards: missing/invalid game
  (non-object, array, or players not an array) → `{ game: null, error:
  "missing-game" }`; any non-active `status` → `{ game: null, error:
  "already-finished" }`. Success returns `{ game: { ...game, status:
  "finished" }, error: null }` — a new object; input never mutated; players,
  totals, changes, and `player.order` untouched; no fields beyond `status`
  (no `finishedAt`, no ranks; the `now` parameter is part of the signature
  but deliberately stores nothing). Error codes live in the local
  `GAME_ERROR_CODES` list, separate from `SCORE_ERROR_CODES`.
- Extended `src/main.js`: `state.finishPromptOpen` (default `false`) renders
  an inline finish section in the score-entry panel below the score form
  (outside the form element): opener "Finish game" swaps to the prompt —
  "Finish this game?" plus the warning "Finished games can't be reopened for
  scoring. Final standings stay saved in this browser." — with a confirm
  "Finish game" button (`aria-describedby` pointing at the warning) and
  "Cancel". No `window.confirm`, no `<dialog>`. Explicit focus moves: open →
  confirm button, cancel → opener, finish → `[data-active-heading]`.
  `renderActiveGame` branches on `game.status === "finished"` to
  `renderFinishedGame`: same header (eyebrow "Finished"), "All games" back
  control, storage notice, and full `rankPlayers(game)` leaderboard with
  unchanged aria-labels, but a polite `role="status"` line reading "Final
  standings — this game is finished and can't be scored." and zero mutation
  controls (no Add points buttons, no `aria-pressed`/`.is-selected`, no score
  panel, no Save points, no undo) via `.active-player.is-final` rows.
  Confirming calls `finishGame`, sets `state.activeGame`, then the unchanged
  `persistActiveGameSnapshot()` — the fourth successful-mutation save trigger
  — so suppression/rollback/notice behavior applies as accepted. Error codes
  `missing-game`/`already-finished` joined `SCORE_ERROR_MESSAGES` and repaint
  `#score-feedback` without re-render. The prompt flag resets in
  `resetSetup`, `handleResume`, and the active back-home handler.
  `renderHome` replaces the finished-games placeholder with an `<ol
  aria-label="Finished games">` built from `orderSavedGamesForDisplay`
  filtered to `status === "finished"`; cards reuse the `.saved-game`
  structure with a "View results" button (`data-action="view-results"`,
  `aria-label="View results {title}"`) wired through the existing
  `handleResume`, so reopening is read-only via the status branch. New empty
  state: "No finished games yet." / "Finish a game and its standings will
  appear here."
- Styled `src/styles.css`: `.finish-section` (top-border separation),
  `.finish-action` (≥44px, #9f271e on `--surface-strong`, 7.05:1 AA,
  distinct from Save/Undo), `.finish-prompt`/`.finish-prompt-title`/
  `.finish-prompt-warning`/`.finish-prompt-actions`, `.finished-note`
  (role=status card), and `.active-player.is-final` four-column grid variants
  (desktop and ≤480px areas without the button row). No new tokens; 8px
  rhythm; focus outline inherited.
- Tests: new `scripts/game-test.mjs` (guards, immutability via
  structuredClone, key equality with no new fields, preserved change
  log/order, double-finish rejection, fresh and 20-player games, local error
  code list) and `scripts/browser-finish-game-test.mjs` (three isolated
  Chrome sessions covering spec Scenarios 1–5: cancel→score→undo with
  byte-identical payload, locked view assertions, stored `status: "finished"`,
  reload/reopen with identical ranks/totals plus an untouched active game,
  blocked-write and invalid-suppression finishes with code-only warnings and
  byte-identical raw payload, 320px overflow/target checks, real-keyboard
  Tab/Enter walk with visible focus, `role="status"`, and zero uncaught
  console errors). Wired `test:game` and `test:browser:finish-game` into
  `package.json`'s `test` chain; added `src/game.js` to the
  `scripts/static-server.mjs` allowlist and `scripts/smoke.mjs` asset check;
  added `src/game.js` to the required-file list and the two new scripts to
  the `node --check` list in `init.sh`. Existing suites ran unmodified.
- Updated README (finishing behavior + new commands), ARCHITECTURE.md (game
  lifecycle boundary, finished variant, Finished list, fourth save trigger),
  and CONSTRAINTS.md (durable rules: one-way finish via `finishGame`, no
  un-finish, explicit confirmation, read-only finished rendering, fourth save
  trigger obeying storage-failure rules).
- Verification: `node --check` on all sources and test scripts passed;
  `npm run test:game` passed; `npm run test:browser:finish-game` passed on
  real headless Chrome across all three sessions with zero uncaught console
  errors and code-only warnings; `npm run test` passed end to end with all
  seven browser suites chained; `./init.sh` and `CI=true ./init.sh` passed
  and exited without starting a server; `npm run dev` probe returned 200 for
  `/`, `/src/game.js`, `/src/main.js`, and `/src/styles.css` and 404 for
  `/AGENTS.md`. Screenshots under
  `/var/folders/24/yg25x7ld6mv2yb2xdznvmh680000gn/T/devexpert-finish-game/`
  (5 files, desktop + 320px) could not be opened for visual inspection this
  session because temp-directory reads are permission-blocked; layout,
  visibility, contrast tokens, ≥44px targets, and 320px overflow were
  asserted programmatically. The manual real-browser pass is covered by the
  three automated real-Chrome sessions.
- Fixed during self-verification: the 20-player unit loop initially used
  `amount: index - 5`, which hits the rejected zero amount at index 5;
  corrected to nonzero amounts. The new suite's session runner initially
  dropped the callbacks' screenshot paths and the keyboard-focus check read
  the computed outline after synthetic clicks, where `:focus-visible` does
  not match; fixed by returning the callback result and asserting the
  visible outline on genuinely keyboard-focused elements after a real Tab.
- Next: run independent `$feature-validator` for `finish-game`; after
  acceptance, commit `feat: complete finish-game`, push the branch, and open
  the PR (the untracked spec file `docs/specs/finish-game.md` belongs to this
  feature's PR).
- Independent validator verdict: `accept`. Reran both gate modes, game and
  finish-game suites, HTTP boundary probes, and an independent browser probe
  (confirm outside the score form, real Space/Enter flows, payload gains
  nothing beyond status, shared ranks 1,2,2 in final standings); no security
  findings; six existing browser suites untouched and green.

### 2026-10-12 — Storage-failure feedback implementation (handle-storage-failure)

- Extended `src/storage.js` with one reporting field: `loadSavedGames` now
  returns `droppedCount` (entries rejected by `isUsableGameEntry`; `0` for
  clean and `unavailable`/`invalid` reads). `saveGames`, the envelope shape,
  and every other behavior stay exactly as accepted.
- Extended `src/main.js` with the storage-health layer: `state.storageReadError`
  (`null | "unavailable" | "invalid"`), `state.storageDroppedCount`, and
  `state.lastSaveError` (`null | "unavailable" | "write"`), set from the
  startup load before the first render so a failed read explains itself
  immediately instead of silently rendering an empty list.
  `getStorageNotice()` derives the first applicable of `invalid` (read error)
  → `lastSaveError` → `unavailable` (read error); `renderHome` and
  `renderActiveGame` embed one `.storage-notice` with `role="status"` and the
  exact per-code copy (top of the Unfinished panel; above the leaderboard
  rows), plus a home-only `.storage-notice-info` note when
  `storageDroppedCount > 0`; `paintStorageNotice()` (replaceChildren +
  append, mirroring `paintScoreFeedback`) runs after `render()` in the three
  mutation paths so the live region updates reliably. Under `invalid`
  suppression the unfinished-panel empty state swaps to "Saved games can't be
  shown right now." / "Nothing was deleted — the saved data just couldn't be
  read."
- Write-safety rule in `persistActiveGameSnapshot()`: while the startup read
  is `invalid` it logs `console.warn("Game save failed:", "invalid")` and
  returns without upserting or calling `saveGames`, so the unreadable payload
  is preserved byte-for-byte and suppression lifts only on reload. Otherwise
  it captures `previous = state.savedGames`, upserts, writes, and on a failed
  write rolls the upsert back, sets `lastSaveError`, and keeps the code-only
  warning — home never renders a phantom card. On success it clears
  `lastSaveError` and a prior `unavailable` read error. There are no retry
  or dismiss controls: every subsequent mutation auto-retries and a
  successful save clears the notice.
- Styled `src/styles.css`: `.storage-notice` warning card (#9f271e on
  `--surface-strong`, 7.05:1 AA contrast, `overflow-wrap: anywhere`,
  8px-rhythm margins) and `.storage-notice-info` muted variant (~5.4:1); no
  layout changes beyond stacking the block above panel content; no overflow
  at 320px.
- Tests: `scripts/storage-test.mjs` deepEqual results updated honestly to
  `{ games, error, droppedCount }` plus dropped-count cases; the
  `browser-resume-test.mjs` blocked-storage scenario now asserts the write
  notice (exact copy, `role="status"`), `cards.length === 0` after failed
  saves, the unchanged success feedback including `Rank: 1.`, and no
  pre-failure notice; new `scripts/browser-storage-failure-test.mjs` covers
  spec Scenarios 1–6 in six isolated Chrome sessions (setItem-throws, corrupt
  `not-json{`, `{ version: 2 }` envelope, counted setItem failures within one
  document, partial corruption with a seeded usable game, unavailable read
  with an instrumented write counter), byte-identical `raw` payload checks —
  including reloads with the seeding script removed so the real stored bytes
  are re-read — and 320px/`role="status"`/contrast/keyboard checks for all
  four notice states. Wired `test:browser:storage-failure` into
  `package.json`'s `test` chain and `init.sh` syntax checks.
- Updated README (user-facing behavior + new test command),
  ARCHITECTURE.md (failure-feedback layer, suppression, rollback, new script),
  and CONSTRAINTS.md (three durable MUST rules: suppress all writes while the
  startup read is invalid, roll back failed-write upserts so nothing unsaved
  is shown as saved, polite single live-region notices with code-only
  diagnostics).
- Verification: `node --check` on all sources and test scripts passed;
  `npm run test:storage` passed; `npm run test:browser:resume` passed with the
  strengthened blocked-storage session; `npm run test:browser:storage-failure`
  passed on real headless Chrome across all six sessions with zero uncaught
  console errors and code-only warnings; `npm run test` passed end to end with
  all six browser suites chained; `./init.sh` and `CI=true ./init.sh` passed
  and exited without starting a server; `npm run dev` probe returned 200 for
  `/`, `/src/main.js`, `/src/styles.css`, and `/src/storage.js` and 404 for
  `/AGENTS.md`. Screenshots under
  `/var/folders/24/yg25x7ld6mv2yb2xdznvmh680000gn/T/devexpert-handle-storage-failure/`
  (10 files, desktop + 320px) could not be opened for visual inspection in
  this session because temp-directory reads are permission-blocked; notice
  visibility, computed AA contrast (>= 4.5), 320px overflow, and >=44px
  targets were asserted programmatically. The manual real-browser pass is
  covered by the six automated real-Chrome sessions (DevTools-equivalent
  storage seeding, key corruption, counted quota failures, blocked writes).
- Fixed during self-verification: the new suite's session runner initially
  returned diagnostics instead of the callbacks' screenshot paths, so the
  summary printed captured warnings; fixed by returning the callback result
  and asserting zero console problems inside the runner.
- Next: run independent `$feature-validator` for `handle-storage-failure`;
  after acceptance, commit and open the PR (the untracked spec file
  `docs/specs/handle-storage-failure.md` belongs to this feature's PR).
- Independent validator verdict: `accept`. Reran both gate modes, storage/
  resume/storage-failure suites, HTTP boundary probes, and an independent
  32-assertion browser probe (hostile payload shapes proving byte-for-byte
  preservation, zero phantom cards, escaped hostile titles); no security
  findings. Two Low non-blocking notes: the dropped disclosure is an info note
  without role=status (functionally inert startup content; role=status is
  asserted for the invalid/write/unavailable notice states), and the dropped
  note persisting after a successful save matches the spec's recovery list.

### 2026-10-12 — Save and resume implementation (resume-saved-game)

- Added `src/storage.js`: single versioned key `scorekeeper:games` holding
  `{ version: 1, games: [...] }`. `loadSavedGames({ storage })` guards
  missing/throwing storage (`unavailable`), `JSON.parse`s and validates the
  envelope plus a per-entry crash guard (string `id`, array `players`;
  unusable entries dropped with a code-only warning) returning
  `{ games, error: null | "unavailable" | "invalid" }` — it never throws and
  never rewrites the payload. `saveGames({ games, storage })` stringifies the
  envelope inside try/catch and returns `{ saved, error: null | "unavailable"
  | "write" }`. `upsertSavedGame(games, game, { updatedAt })` returns a new
  array replacing by id or appending, stamping `updatedAt` only on the stored
  copy; `orderSavedGamesForDisplay(games)` returns a sorted copy
  (updatedAt desc → createdAt desc → id asc). Storage backend is injectable;
  the default probes `globalThis.localStorage`.
- Extended `src/main.js`: `state.savedGames` loaded once at startup before the
  first render (load failures log `console.warn("Saved game load failed:",
  code)`); one `persistActiveGameSnapshot()` helper upserts the active game
  with a fresh `updatedAt`, writes through `saveGames`, and on failure logs
  `console.warn("Game save failed:", error)` with no names/scores. It is
  called exactly in the three success paths: setup submit after
  `state.activeGame = game`, `handleScoreSubmit` after
  `state.activeGame = result.game`, and `handleUndo` after the same. Failed
  validations, selection changes, feedback repaints, and the nothing-to-undo
  no-op never save. `renderHome` now builds the "Unfinished games" panel from
  `orderSavedGamesForDisplay(state.savedGames)` filtered to `status:
  "active"`: each card shows the title, "{N} players", an "Updated {date}"
  label, roster-order names, one `marker-*` color chip per player, and a
  `Resume` button with `aria-label="Resume {title}"`; the retention line
  "Saved only in this browser — clearing site data removes these games." is
  always present; the empty state and finished-games panel keep their roles.
  `handleResume(gameId)` restores the saved game verbatim as
  `state.activeGame`, selects the first player, clears feedback, renders, and
  focuses `[data-active-heading]` — so undo works immediately after resume
  and its success persists the shortened log.
- Styled `src/styles.css`: `.saved-game-list`/`.saved-game` cards within the
  panel rhythm (info block + right-aligned ≥44px `.resume-action`), marker
  strip, and muted `.retention-note`; ≤480px cards stack single-column with a
  full-width resume control.
- Added `scripts/storage-test.mjs` (in-memory storage stubs; round-trip,
  upsert/append/replace/immutability, ordering ties, invalid payloads,
  entry crash guard with name-free warnings, unavailable/throwing storage,
  write failures) and `scripts/browser-resume-test.mjs` (Scenarios 1–6 plus a
  separate Chrome session where `Page.addScriptToEvaluateOnNewDocument`
  patches `Storage.prototype.setItem` to throw). Added the shared
  `readSavedGamesState(cdp, storageKey)` helper (key count/name, payload
  version, game count, saved ids, raw payload) to
  `scripts/browser-test-utils.mjs` and updated the four existing browser
  suites' `localStorage.length === 0` assertions honestly: 0 keys before any
  game exists, exactly 1 key `scorekeeper:games` after the first save,
  gameCount growing only on successful mutations, and byte-identical raw
  payloads proving failed validations and no-op undos never write.
- Wired `test:storage` and `test:browser:resume` into `package.json`'s `test`
  chain; added `src/storage.js` to the `scripts/static-server.mjs` allowlist
  and `scripts/smoke.mjs` asset check; added `src/storage.js` to the
  required-file list and the three new files to the `node --check` list in
  `init.sh`.
- Verification: `node --check` on all sources and test scripts passed;
  `npm run test:storage` passed; `npm run test:browser:resume` passed on real
  headless Chrome covering Scenarios 1–6 (two games created+scored, reload,
  resume each with correct independent totals, card content/ordering with
  title-bearing Resume names, undo-after-resume plus a second reload proving
  no resurrection, 320px stacking/keyboard/retention checks, and the
  blocked-storage session where saves fail with code-only warnings, no
  console errors, and nothing written); `npm run test` passed end to end with
  all five browser suites chained; `./init.sh` and `CI=true ./init.sh` passed
  and exited without starting a server; `npm run dev` probe returned 200 for
  `/`, `/src/storage.js`, and `/src/main.js` and 404 for `/AGENTS.md`.
  Screenshots: `/var/folders/24/yg25x7ld6mv2yb2xdznvmh680000gn/T/devexpert-resume-saved-game/desktop-home-saved-games.png`,
  `desktop-resumed-friday.png`, and `mobile-home-saved-games-320px.png`
  (generated but not visually openable this session; readability asserted
  programmatically).
- Fixed during self-verification: the resume suite initially expected
  resumed rows in roster order with wrong ranks — rows render in descending
  total order (Taylor/Sam/Jamie with tied zeros sharing ranks 1,1,3), so the
  assertions were corrected to the ranked order; a console-warning listener
  initially read `event.params?.args` where the shared CDP client dispatches
  params directly (`event.args`), so blocked-storage warnings were not
  captured until fixed.
- Updated README, ARCHITECTURE.md (storage module and persistence boundary
  replacing "reloading clears everything"), CONSTRAINTS.md (durable
  persistence and never-throwing storage rules), and feature evidence.
- Next: run independent `$feature-validator` for `resume-saved-game`; after
  acceptance, commit `feat: complete resume-saved-game`, push the branch, and
  open the PR.
- Independent validator verdict: `accept`. Reran both gate modes, storage and
  resume suites, HTTP boundary probes, and an independent browser probe with
  hostile XSS payloads (persisted verbatim, rendered escaped, zero injected
  elements) plus byte-level payload checks (exact envelope shape, no rank
  fields); no security findings.

### 2026-10-12 — Latest-change undo implementation (undo-latest-score)

- Added `undoLastScoreChange({ game })` to `src/score.js` (no new module): it
  treats a missing, empty, or non-array `game.changes` (fresh `createGame`
  games have no `changes` property) as `{ game: null, undone: null, error:
  "nothing-to-undo" }`; otherwise it pops the newest `{ id, playerId, amount }`
  entry, finds the recipient (defensive `unknown-player`), computes
  `player.total - change.amount` under a safe-integer guard (`not-safe`), and
  returns a new game object with the restored total and
  `changes.slice(0, -1)`. The input game is never mutated; `game.status`,
  `player.order`, and all other fields are untouched; no rank is stored.
  `"nothing-to-undo"` joined `SCORE_ERROR_CODES`.
- Extended `src/main.js`: a `type="button"` `secondary-action` control labeled
  "Undo last score" (`data-action="undo-last-score"`) sits in the score-entry
  form directly after "Save points"; `handleUndo` announces
  "Undid {amount} points for {name}. New total: {total}. Rank: {rank}." on
  success (raw signed amount, rank from `rankPlayers(result.game)`), re-renders,
  and refocuses the undo button so repeated Enter/Space presses walk backward.
  An empty-log activation sets a new third feedback kind `info` with
  "Nothing to undo yet." and repaints `#score-feedback` only — no re-render and
  no focus change; other errors reuse the existing error repaint. Selection
  (`selectedPlayerId`) and row `aria-pressed` are never changed by undo.
- Styled `src/styles.css`: new `.info-message` in muted `var(--muted)` so the
  no-op does not read as a failure; the undo button reuses `.secondary-action`
  (min-height 44px) with no layout changes.
- Added `scripts/browser-undo-test.mjs` (CDP, following the rank-test pattern)
  and undo unit cases in `scripts/score-test.mjs`; wired `test:browser:undo`
  into `package.json`'s `test` chain and added the new script to `init.sh`
  syntax checks. No static-server/smoke/allowlist changes: `src/score.js` was
  already public.
- Verification: `node --check` on all sources and test scripts passed;
  `npm run test:score` passed (existing cases plus latest-only reversal,
  negative-amount undo, drain-then-nothing-to-undo, missing/empty/non-array
  logs, immutability snapshots, status/other-field preservation, and no rank
  writes); `npm run test` passed end to end with the new undo suite chained;
  `./init.sh` and `CI=true ./init.sh` passed and exited without starting a
  server; `npm run dev` probe returned 200 for `/`, `/src/score.js`, and
  `/src/main.js` and 404 for `/AGENTS.md`. Browser scenarios covered Scenarios
  1–6: latest-recipient-only restore with unchanged selection/`aria-pressed`
  and undo-button refocus, info no-op with sentinel-DOM proof of no re-render
  and muted (non-error) styling, negative-amount undo with the raw signed
  amount announced, three keyboard-Enter undos walking back then stopping
  safely, overtake order/rank reversion, and 320px checks (button visible
  below Save points, ≥44px target, visible focus, keyboard operable, no
  overflow). `localStorage.length === 0` and no console errors throughout.
  Screenshots: `/var/folders/24/yg25x7ld6mv2yb2xdznvmh680000gn/T/devexpert-undo-latest-score/desktop-undo-latest.png`
  and `mobile-undo-320px.png` (generated but not visually openable this
  session; readability asserted programmatically).
- Fixed during self-verification: the first browser run expected the negative
  scenario's totals in player order instead of DOM order (rows sort descending,
  so Sam 0 renders before Alex −3); corrected the assertion to DOM order.
- Updated README, ARCHITECTURE.md (undo boundary sentence revised),
  CONSTRAINTS.md (durable undo rule), and feature evidence.
- Next: run independent `$feature-validator` for `undo-latest-score`; after
  acceptance, commit and open the PR.
- Independent validator verdict: `accept`. Reran both gate modes, the score and
  browser-undo suites, HTTP boundary probes, and 10 extra edge-case probe
  groups (drain-to-empty, deep immutability, status/order preservation, rank
  interop); no security findings; evidence claims reproduced exactly.

### 2026-10-12 — Leaderboard ranking implementation (rank-leaderboard)

- Added `src/standings.js`: pure `rankPlayers(game)` returning `[{ player, rank }]`.
  It copies and decorates the players array with a `player.order` tiebreak
  (falling back to the original array index), sorts by total descending, and
  walks positions assigning `position + 1` while reusing the previous rank on
  equal totals — competition ranking (12, 12, 8 → 1, 1, 3). `rankPlayers(null)`
  and missing/empty player lists return `[]`; the input game is never mutated
  and no rank is stored anywhere.
- Extended `src/main.js`: `renderActiveGame` maps ranked rows instead of
  `game.players`; `renderActivePlayer` prepends a plain-text
  `.active-player-rank` numeral and labels totals `"{name}: rank {rank}, total
  {total}"`; roster panel copy is now "Leaderboard" / "Highest total leads;
  ties share rank."; successful saves append `Rank: {rank}` to the existing
  sentence ("Added {amount} points to {name}. New total: {total}. Rank: {rank}.")
  computed from `rankPlayers(result.game)`. Full re-render plus explicit
  `#score-amount` refocus is unchanged; errors still repaint without re-render.
- Styled `src/styles.css`: `.active-player` is now a five-column grid (rank,
  token, name, total, button) with `.active-player-rank` fixed-width,
  `tabular-nums`, bold, right-aligned like totals; ≤480px areas gained `rank`
  (`"rank token name total"` / `"select select select select"`); ≤360px keeps
  all five elements visible with 8px gaps and compacted numerals.
- Added `scripts/standings-test.mjs` and `scripts/browser-rank-test.mjs`; wired
  `test:standings` and `test:browser:rank` into `package.json` and the `test`
  chain; updated `scripts/browser-score-test.mjs` DOM-order totals to
  `["1005", "7"]` at the two ranked-order assertions (Sam 1005 now sorts before
  Alex 7); added `src/standings.js` to the `scripts/static-server.mjs`
  allowlist and `scripts/smoke.mjs` asset check; added the three new files to
  `init.sh` required-file and `node --check` lists.
- Verification: `node --check` on all sources and test scripts passed;
  `npm run test:standings` passed (including rank = 1 + strictly-higher count
  asserted per row on a 20-player mixed game and an applyScoreChange overtake);
  `npm run test` passed end to end; `./init.sh` and `CI=true ./init.sh` passed;
  `npm run dev` probe returned 200 for `/` and `/src/standings.js`, 404 for
  `/AGENTS.md`. Browser scenarios covered 12/12/8 → 1,1,3 with stable creation-
  order ties, 5/−3/−3 → 1,2,2, all-zero fresh game at rank 1, save-driven
  reorder with `aria-pressed` following the player and focus returning to
  `#score-amount`, error repaint without re-render (DOM sentinel survived),
  320px 20-player leaderboard with no overflow, ≥44px targets, visible focus,
  keyboard row activation, and a re-ranking save that kept focus; no
  localStorage writes and no console errors. Screenshots:
  `/var/folders/24/yg25x7ld6mv2yb2xdznvmh680000gn/T/devexpert-rank-leaderboard/desktop-rank-ties.png`,
  `desktop-rank-reorder.png`, and `mobile-20-player-leaderboard.png` (generated
  but not visually openable in this sandbox session; readability asserted
  programmatically instead).
- Fixed during self-verification: initial `rankPlayers` reused a rank field
  from the pre-decorated sort array and returned `undefined` for tied rows —
  caught by the unit test and rewritten to track previous rank/total while
  walking positions.
- Updated README, ARCHITECTURE.md, CONSTRAINTS.md (durable ranking rule), and
  feature evidence.
- Next: run independent `$feature-validator` for `rank-leaderboard`.
- Independent validator verdict: `accept`. Reran both gate modes, focused
  standings/browser-rank checks, HTTP boundary probes, and extra edge-case
  probes (triple tie, order fallbacks, immutability); confirmed render-time-only
  ranks with no stored fields; no security findings.
- Next: commit `feat: complete rank-leaderboard`, push the branch, and open the
  PR for user review.

### 2026-10-12 — Score entry implementation (add-player-score)

- Implemented `src/score.js`: `MAX_SCORE_ABS = 1_000_000`, `parseScoreAmount`
  with error codes `empty`/`not-a-number`/`not-integer`/`zero`/`out-of-range`
  (semantic parsing, so `1e3` saves as 1000), and `applyScoreChange` returning a
  new game with the player's updated total and an appended
  `{ id, playerId, amount }` change in `game.changes`, guarded by a
  `Number.isSafeInteger` invariant. Zero entries are rejected; totals may go
  negative; input game objects are never mutated.
- Extended the active view in `src/main.js`: per-row "Add points" buttons with
  `aria-pressed` and `aria-label="Add points for {name}"`, first player selected
  by default, a score-entry panel with labeled `type="number" step="1"`
  input (min/max ±1,000,000), helper text, `#score-feedback` `aria-live="polite"`
  region, and "Save points". Success announces "Added {amount} points to {name}.
  New total: {total}." and keeps focus in the cleared input; errors keep the
  typed value and focus. Live totals replace the hardcoded `0`.
- Styled `src/styles.css`: two-column active layout with the score panel beside
  the roster on desktop, single column at ≤720px, selected-row highlight, full
  width row buttons at ≤480px, ≥44px touch targets, and a `--success` token for
  success feedback.
- Added `scripts/score-test.mjs` and `scripts/browser-score-test.mjs`; extracted
  the shared CDP helpers into `scripts/browser-test-utils.mjs` and refactored
  `scripts/browser-roster-test.mjs` to import them with no behavior change.
- Wired `test:score` and `test:browser:score` into `package.json` and added the
  new modules to the `scripts/static-server.mjs` allowlist, smoke asset check,
  and `init.sh` syntax checks.
- Verification: `node --check` on all sources and test scripts passed;
  `npm run test:score`, `npm run test:roster`, and `npm run test:smoke` passed;
  `npm run test:browser` and `npm run test:browser:score` passed on headless
  Chrome; `npm run test`, `./init.sh`, and `CI=true ./init.sh` all passed;
  `npm run dev` probe returned 200 for `/` and `/src/score.js` and 404 for
  `/AGENTS.md`. Browser scenarios covered +10/−3 → 7 with others at 0, rejected
  2.5/abc/empty/±1000001/0 with unchanged totals, negative totals, 320px stacked
  panel with keyboard entry, no localStorage writes, no horizontal overflow, and
  no console errors. Screenshots:
  `/var/folders/24/yg25x7ld6mv2yb2xdznvmh680000gn/T/devexpert-add-player-score/desktop-score-entry.png`
  and `.../mobile-score-entry.png`.
- Updated README, ARCHITECTURE.md, CONSTRAINTS.md, and feature evidence.
- Next: run independent `$feature-validator` for `add-player-score`; after
  acceptance, commit, push `codex/add-player-score`, and open the PR.
- Independent validator verdict: `accept` with zero discrepancies. Reran
  `CI=true ./init.sh`, `./init.sh`, focused score and browser-score checks, live
  HTTP boundary probes (public 200, repository 404, malformed 400), and a spec
  code review; no security findings.
- Next: commit `feat: complete add-player-score`, push the branch, and open the
  PR for user review.

### 2026-10-02 — Roster verification and handoff repair

- Added home → setup → active-game flow, 2–20 named players, repeatable colors,
  numbered markers, distinct IDs, and zero totals. State remains in memory.
- Independent validator ran `CI=true ./init.sh` successfully with localhost permission:
  syntax checks, roster tests, HTTP smoke, and Chrome interaction checks passed.
- Browser coverage: desktop creation, 320px layout, 20-player cap, invalid names,
  duplicate names/colors, zero totals, no localStorage writes, and no console errors/overflow.
- Validator requested documentation repair only. Updated README, architecture,
  constraints, progress, and feature evidence to match the tested implementation.
- Final independent verdict: `accept` after documentation repair, reusing passing
  runtime/browser evidence because application code and tests were unchanged.
- Next: publish the roster PR and wait for user review. Plan `add-player-score` after merge when requested.

### 2026-10-01 — Minimal startup harness

- Created `AGENTS.md`, executable `init.sh`, `PROGRESS.md`, and `feature_list.json` from the merged discovery documents.
- Preserved one-feature-per-PR workflow, independent acceptance, and merged-dependency requirements.
- Feature slicing covers runnable shell, roster creation, score entry, ranking, undo, persistence/resume, storage errors, finishing, podium, and replay. Responsive behavior and accessibility belong in each relevant slice.
- Verification: JSON schema fields/statuses checked; dependency IDs and acyclic ordering checked; shell syntax and provisional script execution checked from the root and an external directory; executable mode and diff whitespace checked. No product tests ran.
- Next: review/merge the harness PR, then run `$feature-flow` for `bootstrap-web-shell`. Technical bootstrap must replace the provisional gate with real checks and document how to launch the app separately.

### 2026-10-01 — Bootstrap web shell implementation

- Created the first runnable static app shell: `index.html`, `src/styles.css`, and `src/main.js`.
- Added dependency-free Node tooling: `npm run dev` starts the local HTTP server, and `npm run test` runs a smoke check against the served shell.
- Replaced the provisional `init.sh` with the real non-blocking gate. It verifies required files, runs `node --check src/main.js`, runs `npm run test`, then prints the manual server command.
- Added `ARCHITECTURE.md` and `CONSTRAINTS.md` to capture the static app boundary, command split, and rules future feature slices must respect.
- Updated `README.md` and `AGENTS.md` with the current app commands and verification path.
- Browser evidence: `npm run dev` served `http://127.0.0.1:4173/`; real browser checks at 320x720 and 1280x800 found no horizontal overflow, no console errors, `appReady=true`, and a disabled New game control.
- Verification: `./init.sh` passed; `CI=true ./init.sh` passed. Both commands required localhost binding permission outside the restricted sandbox for the HTTP smoke server.
- Next: run independent `$feature-validator` for `bootstrap-web-shell`. If accepted, commit related files, push `codex/bootstrap-web-shell`, and open the PR.

### 2026-10-01 — Bootstrap web shell validation

- Initial verdict: `accept`, later superseded by independent revalidation.
- Revalidation found the local static server exposed repository files from the project root and crashed on malformed percent-encoded paths.
- Next: repair the server boundary and rerun implementation checks before another validator pass.

### 2026-10-01 — Bootstrap web shell repair

- Restricted `scripts/static-server.mjs` to explicit public shell files only: `/`, `/index.html`, `/src/styles.css`, and `/src/main.js`.
- Malformed URL paths now return `400 Bad request` instead of crashing the Node process.
- Added smoke-test regressions that verify `/AGENTS.md`, `/feature_list.json`, and `/.git/config` are not public, malformed `/%E0%A4%A` returns `400`, and a healthy GET still works afterward.
- Updated `ARCHITECTURE.md` and `CONSTRAINTS.md` to record the HTTP serving boundary.
- Verification: `npm test` passed; `./init.sh` passed; `CI=true ./init.sh` passed. Each smoke run served the shell over HTTP, blocked repository files, returned `400` for malformed URL encoding, and verified a healthy GET afterward.
- Next: send this back for independent revalidation.

### 2026-10-01 — Independent repair acceptance

- Validator verdict: `accept`. Both standard gates passed independently.
- Independent HTTP probes returned 200 for public app assets, 404 for repository files, 400 for malformed encoding, and 200 for a subsequent healthy request.
- The previous 320x720 and 1280x800 browser checks cover the unchanged UI. Browser automation was unavailable during this repaired pass.
- Next: review and merge the bootstrap PR, then plan `create-game-roster` on updated main when requested.
