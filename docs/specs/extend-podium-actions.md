# Feature Implementation Spec: Add three podium exit actions

## Source Feature

- `id`: `extend-podium-actions`
- `area`: `game`
- `depends_on`: `refresh-design-system` (accepted and merged, PR #16); the branch base (`codex/extend-podium-actions` off latest `origin/main`) also contains the merged `name-game-titles` (PR #17), `track-game-activity` (PR #18), `add-quick-score-entry` (PR #19), `show-player-numbers` (PR #20), and `show-score-distribution` (PR #21)
- `status`: `not_started` at planning time
- `source`: `feature_list.json` (lines 450–465)

## Goal

The finish podium dialog gains the mockup's three exit actions in place of today's single "Close" button: a full-width primary **"Play again (same players, reset scores)"** and two side-by-side secondaries, **"Close & view full standings"** and **"Save & exit to Dashboard"**. All three act on the already-persisted, read-only finished game: replay routes through the accepted `handlePlayAgain` flow (separate untitled game, zero scores, original byte-identical), close dismisses to the full standings exactly as today, and exit is a pure navigation to the Dashboard. Nothing new is saved by any action; no new persisted fields, no new save trigger, no storage-module change.

## Non-Goals

- No change to the finish flow itself (`finishGame`, the confirm prompt, the finish-time `persistActiveGameSnapshot()` call), to read-only finished rendering, or to replay logic (`replayGame`, `handlePlayAgain`).
- No "Save" semantics: nothing is written by any podium action — the game is already persisted by finish. "Save & exit" is product phrasing from the mockup, not a save operation.
- No mockup decoration: the "Game concluded" pill, the X icon button, podium steps/WINNER/SILVER/BRONZE art, and the "Ties share rank…" caption stay unimplemented (per the show-player-numbers spec's decoration note and DESIGN.md).
- The mockup lede "Congratulations to the top of the table!" (exclamation mark) is **not** adopted — the suite-frozen lede keeps its period.
- No changes to `index.html`, `src/score.js`, `src/storage.js`, `src/roster.js`, `src/game.js`, `src/standings.js`, `scripts/smoke.mjs`, `scripts/static-server.mjs`, `scripts/browser-test-utils.mjs` (0-line diffs); no new `src/*` module, so the server allowlist, smoke assets, and required-file list are unchanged.
- **Must not change** (regression floor): the exactly six `persistActiveGameSnapshot()` call sites; envelope version 1; smoke strings; the design-system nav matrix and write-absence proofs; frozen copy (`Final podium`, `Congratulations to the top of the table.`, `.podium-game-title` as the first content element in `.podium-body`, `{name}: rank {rank}, total {total}`, `Player {n}, {color}`); the 14-piece confetti contract and reduced-motion suppression; the 720/480/360 breakpoints and both reduced-motion rules; all 13 accepted behaviors and the six merged v2 features except where explicitly updated below.

## Job Story

When the finish celebration opens,
I want to replay, review the full standings, or head back to the Dashboard right from the podium,
so I don't have to dismiss the modal first to find those actions.

## Users And Permissions

- Scorekeeper: the only actor. All three actions operate on the already-saved finished game in the current browser; no network, no accounts.

## Product Decisions Resolved For This Slice

### Decision 1 — Action set, labels, and accessible names (locked)

Exactly three `type="button"` controls replace the current `.podium-close` button, after the groups `<ol>` inside `.podium-body`:

| # | Visible label (= accessible name) | `data-action` | Styling |
|---|---|---|---|
| 1 | `Play again (same players, reset scores)` | `podium-play-again` | `primary-action`, full width |
| 2 | `Close & view full standings` | `close-podium` (unchanged hook) | `secondary-action` |
| 3 | `Save & exit to Dashboard` | `podium-exit-dashboard` | `secondary-action` |

- The parenthetical lives in **both** the visible label and the accessible name — they are the same string, no `aria-label` override. This matches the mockup exactly, keeps the repo's visible-text-as-name convention (browser-play-again-test.mjs:396 asserts it on the finished-view button), makes all three names self-explanatory, and trivially satisfies label-in-name.
- `close-podium` is deliberately **kept** on "Close & view full standings": nine pre-existing suites dismiss the podium through `[data-action='close-podium']`, so the identical behavior under the same hook keeps them green. The finished view's own "Play again" button keeps `data-action="play-again"`; the podium primary uses a distinct id (`podium-play-again`, the `nav-*` no-collision precedent) because `bindActiveEvents` binds `play-again` via `querySelector` (first match in DOM order).
- Button copy containing `&` is written as the `&amp;` entity in the template; `textContent` reads `Close & view full standings` / `Save & exit to Dashboard`.

### Decision 2 — "Close & view full standings": the accepted close path, unchanged

Same handler funnel as today (main.js:983–988, 1022–1030): guarded `dialog.close()` → `handlePodiumClose()` (clear `podiumOpen`, `render()`, focus `[data-active-heading]`). The full standings stay visible behind the modal during and after dismissal; the stored payload is byte-identical across open/dismiss. Escape, real backdrop click, and Space/Enter on the focused control all still dismiss to the standings view. The detached-dialog `close` guard (main.js:1000–1012, from add-quick-score-entry) stays exactly as accepted.

### Decision 3 — "Save & exit to Dashboard": navigation only, never writes

A new `handlePodiumExitDashboard()`: guard on `state.podiumOpen` (no-op when false), dismiss the live dialog if open, then mirror the accepted active-view back-home reset (main.js:1210–1221) — `view = "home"`, clear `selectedPlayerId`/`scoreFeedback`/`finishPromptOpen`/`podiumOpen`/`replayFeedback`/`titleEditOpen`/`titleDraft`/`titleEditFeedback` — then `render()` and focus `[data-home-heading]` (the established nav focus pattern). `paintNav()` marks `nav-dashboard` with `aria-current="page"` because the view is home. The finished game stays in `state.activeGame` and in storage; no `persistActiveGameSnapshot()` call, so the payload is byte-identical across the exit (a write-absence proof the new suite pins). From home the game lists under Finished games; View results reopens read-only and never re-celebrates.

### Decision 4 — Play again from the podium: delegate, no new logic

A small wrapper in `bindPodiumEvents`: `if (!state.podiumOpen) return;` → `if (dialog.open) dialog.close();` → call the **unchanged** `handlePlayAgain()`. On success the re-render replaces the finished view (and the dialog) with the scorable replay: untitled (auto-label), zero totals at shared rank 1, first player selected, focus `[data-active-heading]`, no podium; the replay upsert appends by its new id so the original finished entry stays byte-identical across the replay and after scoring the replay. On a guard failure (reachable only via hand-corrupted stored rosters, never for an in-session finish) the unchanged visible-guard path paints `#replay-feedback` politely with the podium dismissed; no re-render occurs on that path, so nothing re-opens the dialog.

### Decision 5 — Layout, order, and targets

DOM order = mockup visual order: primary full-width on top; below it `.podium-actions-row` with the two secondaries side-by-side (`grid-template-columns: 1fr 1fr`), stacking full-width at ≤480px (the finished-view/resume-card stacking precedent), so 320px wraps without overflow. All three ≥44px tall and wide. Tab order follows DOM: Play again → Close & view full standings → Save & exit to Dashboard, cycling inside the dialog. `focus-visible` outlines inherit.

### Decision 6 — Initial focus and unchanged modal contract

Opening the podium still focuses **"Close & view full standings"** (`data-action='close-podium'`) — the least-destructive action, preserving the accepted `focusOnClose` contract asserted by browser-podium-test.mjs (339, 525, 605, 638, 690) and browser-finish-game-test.mjs (`readPodiumBrief`). Everything else about the modal is untouched: `aria-labelledby="podium-title"` / `aria-describedby="podium-lede"`, the groups markup, confetti (14 aria-hidden pieces, pointer-events none, reduced-motion `display:none`), backdrop/cancel handling, and `::backdrop` styling.

## Acceptance Scenarios

### Scenario 1: The podium offers exactly three actions

Given a finished game whose podium is open
When the dialog renders
Then exactly three buttons exist inside it with the Decision 1 labels as visible text and accessible names, all `type="button"`, the primary full-width above two side-by-side secondaries, every target ≥44px, initial focus on "Close & view full standings", and the frozen title/lede/game-title line, groups, confetti contract, and visible standings behind the modal are unchanged.

### Scenario 2: Close & view full standings (and Escape/backdrop) dismiss to the standings

Given the open podium over a finished game
When the scorekeeper clicks "Close & view full standings", presses Escape, clicks the backdrop, or presses Space/Enter on the focused control
Then the dialog leaves the DOM, the read-only finished standings remain with focus on `[data-active-heading]`, and the stored payload is byte-identical across open and dismiss.

### Scenario 3: Save & exit to Dashboard navigates without writing

Given the open podium over a finished game listed in storage
When the scorekeeper activates "Save & exit to Dashboard"
Then the dialog is dismissed, the Dashboard (home) renders with focus on `[data-home-heading]` and `aria-current="page"` on `nav-dashboard`, the finished game appears under Finished games with its `View results {label}` card, the stored payload is byte-identical across the exit, and no phantom cards appear; View results then reopens the read-only standings with no re-celebration.

### Scenario 4: Play again from the podium replays exactly like the accepted action

Given the open podium over a finished game
When the scorekeeper activates "Play again (same players, reset scores)"
Then a separate active game opens: untitled with the auto-label, copied names/colors/numbers, zero totals at shared rank 1, first player selected, focus on the heading, no podium; storage holds two distinct games; the original finished entry stays byte-identical across the replay and after scoring the replay; after a reload the original lists under Finished games and the replay under Unfinished games.

### Scenario 5: Keyboard operability at 320px

Given a 320×720 viewport with the podium open
When the scorekeeper Tabs from the initial focus
Then focus moves through the three buttons in Decision 5 order, stays inside the dialog (never reaching background controls) while the dialog stays open, and Escape dismisses to the standings with focus on the heading; Enter on "Save & exit to Dashboard" navigates home with visible focus on the Dashboard heading.

### Scenario 6: The stale-close guard survives the new bindings

Given two podiums in one document lifetime (finish → dismiss → replay → finish again)
When the second podium opens
Then it opens and dismisses normally — a queued `close` from the first, detached dialog never clobbers the second (the detached-dialog guard keeps working with the new action bindings present).

## Repository Research

### Files Inspected

- `feature_list.json` (450–465: this entry — focused finish/podium/play-again suites + gate), `PROGRESS.md` (all six v2 features merged; this is the last v2 feature), `AGENTS.md`, `docs/build-brief.md` (line 37: podium actions bullet), `docs/domain-model.md` (finish freezes everything; replay creates a separate untitled zero-score game; read-only finished games), `docs/risks-and-open-questions.md` (no open item blocks this slice), `DESIGN.md` (line 46: podium modal with three actions) + `docs/design/update-v2/end_of_game_podium_summary/screen.png` (action layout: primary full-width, two secondaries side-by-side; decoration excluded above) — scope and visual source of truth.
- `src/main.js`: `renderFinishedGame` (851–899) renders the dialog when `podiumOpen && podium.length > 0`; `renderPodiumDialog` (901–936) emits confetti → `.podium-game-title` (first `<p>`) → `h2#podium-title` → `#podium-lede` → groups `<ol>` → single `.podium-close` Close button; `bindPodiumEvents` (972–1020) with the `dismissPodium` funnel and detached-dialog guard; `handlePodiumClose` (1022–1030); `handleFinishGame` (1344–1370, podium opens after the unchanged persist); `handlePlayAgain` (1372–1398); the active back-home reset (1210–1221) and `handleNavDashboard` (135–142, focus `[data-home-heading]`); `paintNav` (187–212, finished→Dashboard mapping); `resetSetup`/`handleResume` podium-flag resets.
- `src/styles.css`: `.podium-*` block (1139–1317) including the full-width `.podium-close` rule (1291–1294), ≤360px compaction, reduced-motion rule.
- `index.html` (static nav; no change needed), `package.json` (15-browser-suite chain), `init.sh` (27-entry `node --check` list).
- Test contracts: `scripts/browser-podium-test.mjs` (frozen `closeLabel === "Close"` at 338; `focusOnClose` at 339/525/605/638/690; the single-focusable Tab-trap walk 517–571; Space/Enter dismissal 444–453, 565; byte-identity and blocked/suppressed sessions), `browser-finish-game-test.mjs` (`readPodiumBrief` 126–143: `focusOnClose`), `browser-play-again-test.mjs` (finished-view button label 396; close-podium dismissals 377/529/565), `browser-design-system-test.mjs` (`INTERACTIVE_SELECTORS` 200–215 includes `close-podium`; podium target sweep 465; nav matrix `finished → ["nav-dashboard"]` 469), `browser-game-title-test.mjs` (`.podium-body > p` first-content assertion 190), plus close-podium usage in game-activity (665), quick-score (683), player-numbers (120), score-distribution (471) — none counts podium buttons or asserts footer copy beyond the two items named above.

### Existing Patterns To Follow

- One focused browser suite per feature wired as `npm run test:browser:podium-actions`, chained into `npm run test`, added to `init.sh`'s `node --check` list; isolated headless-Chrome sessions at 1280×800 and 320×720 with `readSavedGamesState` byte-identity proofs and CDP real-key walks.
- Distinct `data-action` ids for new controls (the `nav-*` precedent) so suites' `querySelector` hooks never collide.
- Honest pre-existing-suite updates only, with supersession comments and an updated summary line.

### Current Gaps

- The podium has a single Close control; no Dashboard exit and no replay exist inside the modal. The Tab-trap assertions in browser-podium-test.mjs encode the one-focusable Chrome quirk and cannot survive a three-button dialog.

## Technical Approach

1. **`src/main.js` — markup**: in `renderPodiumDialog`, replace the `.podium-close` button with Decision 1/5's actions block (buttons escaped-entity copy; no new game/state derivation).
2. **`src/main.js` — bindings**: in `bindPodiumEvents`, keep the `close-podium` binding exactly; add two wrappers per Decisions 3–4 (`podium-play-again` → guarded close + `handlePlayAgain()`; `podium-exit-dashboard` → guarded close + new `handlePodiumExitDashboard()`). The dialog `click`/`cancel`/`close` listeners and the detached-dialog guard stay byte-identical. `handlePodiumExitDashboard()` mirrors the back-home reset (Decision 3).
3. **`src/styles.css`**: replace the `.podium-close` rule with an additive `.podium-actions` block (Decision 5; verified no suite references the class). No other selector, token, breakpoint, or motion rule touched.
4. **Tests**: the two honest updates in `scripts/browser-podium-test.mjs` (below); new `scripts/browser-podium-actions-test.mjs`; wire `package.json` + `init.sh`.
5. **Docs**: README, ARCHITECTURE.md, CONSTRAINTS.md per Durable Documentation Impact.

## Expected File Changes

- `src/main.js` — modify: `renderPodiumDialog` actions block; two `bindPodiumEvents` wrappers; `handlePodiumExitDashboard()`. No other handler/state/focus/save-path change.
- `src/styles.css` — modify: `.podium-close` rule replaced by `.podium-actions`/`.podium-actions-row` block + ≤480px stacking; everything else untouched.
- `scripts/browser-podium-test.mjs` — modify (the only pre-existing suite touched): ① line 338 `closeLabel` `"Close"` → `"Close & view full standings"` with a supersession comment; ② the mobile-keys Tab-trap walk (517–571) honestly rewritten for three focusables — assert focus stays inside the open dialog cycling the three buttons and never reaches background controls (the `onClose || onBody` and `recaptureState.onClose` single-focusable assertions are superseded with comments), and the Enter-on-Close step becomes Escape (or a Tab-cycle back to Close then Enter); summary line updated. Everything else in the suite (ties, 20-tied, byte-identity, reduced-motion, blocked/suppressed, Space/Enter dismissal from the initial focus) holds unchanged.
- `scripts/browser-podium-actions-test.mjs` — new focused suite, four isolated Chrome sessions: ① actions contract (exactly 3 buttons, exact labels/names/types/order, primary full-width over side-by-side secondaries at 1280×800, stacked at 320×720, all ≥44px, initial focus on close-podium, frozen copy/`Player {n}` tokens/14 confetti pieces, standings visible, payload byte-identical while open); ② close paths (close-podium click, Escape, real backdrop click, Space — each to the finished standings with heading focus and byte-identical payload); ③ Save & exit (home view, `[data-home-heading]` focus, `aria-current` Dashboard, Finished-games card, byte-identical payload write-absence proof, View results reopens read-only without re-celebration; 320px real-key Tab/Enter walk landing on the Dashboard heading); ④ podium Play again (replay contract per Scenario 4 including byte-identical original across replay + replay scoring, reload separation, and the Scenario 6 two-podium stale-close guard proof).
- `package.json` — add `test:browser:podium-actions`; chain into `test` (16 browser suites).
- `init.sh` — add the new suite to the `node --check` list (28 entries).
- `README.md`, `ARCHITECTURE.md`, `CONSTRAINTS.md` — update; `docs/specs/extend-podium-actions.md` — this spec (belongs to this feature's PR).
- **Byte-untouched (verify via git diff)**: `index.html`; `src/score.js`, `src/storage.js`, `src/roster.js`, `src/game.js`, `src/standings.js`; `scripts/smoke.mjs`, `scripts/static-server.mjs`, `scripts/browser-test-utils.mjs`; every pre-existing suite except `browser-podium-test.mjs` (expected honest pre-existing-suite updates: exactly the two named above — finish-game, play-again, design-system, game-title, game-activity, quick-score, player-numbers, and score-distribution all dismiss via `close-podium`, whose behavior and hook are unchanged).

## Visual Design Impact

- UI involved: yes — the podium dialog's action area only.
- Design source: `DESIGN.md` + `docs/design/update-v2/end_of_game_podium_summary/screen.png` (three bottom actions).
- Screens/states affected: the podium dialog at 1280×800 and 320×720, in normal, reduced-motion, blocked-write, and suppressed-read sessions (all covered by pre-existing suites except the new assertions).
- New design artifact required: no — existing tokens cover it (primary/secondary actions already exist; the mockup's X icon and "Game concluded" pill are excluded decoration).

## Durable Documentation Impact

- `CONSTRAINTS.md`: update — durable rules: the podium offers exactly the three locked actions; close/Escape/backdrop always land on the read-only standings; Dashboard exit is navigation-only and never writes; podium replay delegates to the unchanged `handlePlayAgain`; initial focus stays on the dismiss control.
- `ARCHITECTURE.md`: update — the podium action wiring (wrappers + `handlePodiumExitDashboard`), the replaced `.podium-close` rule, the new suite.
- `README.md`: update — podium actions behavior + `npm run test:browser:podium-actions` + next steps (v2 set complete).
- `AGENTS.md`: not needed — no workflow/startup change. `CONTEXT.md`/`docs/domain-model.md`/`docs/build-brief.md`: not needed — they already state the behavior; this spec implements it.

## Implementation Plan

1. Land the `src/main.js` markup + bindings + `handlePodiumExitDashboard()` and the `src/styles.css` action block; `node --check src/main.js`; walk Scenarios 1–6 by hand in `npm run dev` at 1280×800 and 320×720.
2. Apply the two honest `browser-podium-test.mjs` updates and run `npm run test:browser:podium`.
3. Write `scripts/browser-podium-actions-test.mjs`, wire `package.json` + `init.sh`, run the full verification plan, confirm the byte-untouched floor via `git diff`, update docs, record evidence.

## Implementation Tasks

- [ ] `src/main.js`: replace the podium Close button with the three-action block (Decision 1 markup); add the two `bindPodiumEvents` wrappers and `handlePodiumExitDashboard()` (Decisions 3–4); keep the dismissal funnel and detached-dialog guard byte-identical.
- [ ] `src/styles.css`: replace `.podium-close` with the `.podium-actions` block + ≤480px stacking (Decision 5); nothing else touched.
- [ ] `scripts/browser-podium-test.mjs`: the two honest updates (closeLabel; Tab-trap walk rewrite) with supersession comments and an updated summary line.
- [ ] `scripts/browser-podium-actions-test.mjs`: sessions ①–④ per Expected File Changes, reusing the podium/play-again suites' helpers (`readSavedGamesState`, real-key walks, real backdrop clicks).
- [ ] `package.json` + `init.sh`: wire the new suite (16 browser suites; 28 `node --check` entries).
- [ ] Update `README.md`, `ARCHITECTURE.md`, `CONSTRAINTS.md`.
- [ ] Run the verification plan; record evidence in `feature_list.json`/`PROGRESS.md` (implementer/validator step, not this planner).

## Verification Plan

- `node --check` on touched sources and the new suite (covered by `init.sh`).
- `npm run test:browser:podium` — passes with exactly the two honest updates and every other assertion unmodified.
- `npm run test:browser:podium-actions` (new, real headless Chrome, 1280×800 + 320×720): sessions ①–④ with byte-identity proofs.
- `npm run test` — full chain (16 browser suites) with all fifteen pre-existing browser suites green and byte-untouched except `browser-podium-test.mjs`; all unit suites unmodified.
- `./init.sh` and `CI=true ./init.sh` — required files, all syntax checks (28 entries), and the full `npm run test` chain pass; both exit without starting a server (a transient Chrome-launch timeout may be retried once, per the documented podium/launch flake).
- `npm run dev` probe — 200 for `/`, `/src/main.js`, `/src/styles.css`; 404 for `/AGENTS.md`.
- Screenshots (desktop podium with the three actions, 320px stacked actions, post-exit Dashboard, post-replay active view) into the evidence dir; programmatic assertions carry the proof as established.
- Disclosure: physical keyboards/touch cannot be exercised headless; the keyboard contract is verified via CDP real-key walks, consistent with prior features. `init.sh` executes the non-blocking standard gate only and must not start a long-running server.

## Evidence To Capture

- Exact commands and results for `test:browser:podium`, the new suite, `npm run test`, both gate modes, and the dev probe.
- A statement that `index.html`, `src/score.js`, `src/storage.js`, `src/roster.js`, `src/game.js`, `src/standings.js`, `scripts/smoke.mjs`, `scripts/static-server.mjs`, `scripts/browser-test-utils.mjs`, and all pre-existing suites except `browser-podium-test.mjs` are untouched (0-line diffs); the envelope version stayed `1`; `persistActiveGameSnapshot` still has exactly six call sites; no new persisted fields; `podiumRows`/`rankPlayers`/`replayGame`/`finishGame` unmodified.
- Screenshots + assertion summaries (three-button contract, focus management, exit navigation + `aria-current`, replay byte-identity, stale-close guard, 320px layout).

## Validator Checklist

- [ ] The podium shows exactly the three Decision 1 actions with locked labels/names, `type="button"`, and the Decision 5 layout/order; no X icon, pill, or steps art was added.
- [ ] "Close & view full standings" keeps `data-action='close-podium'` and the accepted dismissal funnel (click/Escape/backdrop/Space/Enter → read-only standings, heading focus); the detached-dialog guard is byte-identical (Scenario 6).
- [ ] "Save & exit to Dashboard" is navigation-only: home view, `[data-home-heading]` focus, `aria-current` Dashboard, zero writes (byte-identity proof), no phantom cards, no re-celebration on reopen (Scenario 3).
- [ ] Podium "Play again" delegates to the unchanged `handlePlayAgain` with the accepted replay contract and byte-identical original (Scenario 4).
- [ ] Initial focus stays on the dismiss control; Tab cycles the three buttons inside the dialog without reaching background controls; Escape works at both widths (Scenario 5).
- [ ] Regression floor holds: only `browser-podium-test.mjs` changed (the two honest updates), frozen copy/labels/confetti/nav matrix/smoke strings unchanged, six save triggers, envelope version 1.
- [ ] README/ARCHITECTURE/CONSTRAINTS updated; evidence recorded with real commands and results.
