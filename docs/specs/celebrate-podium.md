# Feature Implementation Spec: Celebrate the final podium

## Source Feature

- `id`: `celebrate-podium`
- `area`: `results`
- `depends_on`: [`finish-game`] (accepted and merged into `main`, PR #12, merge commit `4c3cb99` — verified: branch `codex/celebrate-podium` is checked out with a clean tree at `4c3cb99`, which is the merge commit of PR #12)
- `status`: `not_started` at planning time
- `source`: `feature_list.json`

## Goal

Immediately after the scorekeeper confirms finishing, the app celebrates the result once: a dismissible podium modal opens over the read-only finished view, showing every player whose final competition rank is 1, 2, or 3 (ties included — ranks 1,1,3 put two players on the top step; 20 tied players all appear), with a brief CSS-only confetti animation. Dismissing (Close button, Escape, or backdrop click) returns focus to the finished view, whose full final standings remain unchanged. The celebration is pure display: it adds no persisted fields, triggers no writes, and never reopens when a finished game is merely reopened from home.

## Non-Goals

- No "Play again" control anywhere (including inside the modal) — `play-again` owns that.
- No changes to the finish prompt/confirm flow, `finishGame` semantics, scoring, undo, ranking (`rankPlayers` behavior), roster rules, or `src/storage.js` / the storage format.
- No new persisted state: no podium flag, rank, or celebration field in localStorage; no fifth save trigger; open/dismiss never calls `persistActiveGameSnapshot()`.
- No celebration when merely resuming or viewing a finished game from home, after a reload, or on the active-game path.
- No confetti/animation library and no new dependencies (dependency-free CSS keyframes only).
- No duplication of the full standings inside the modal; the full leaderboard stays in the finished view behind it.
- No page-scroll locking beyond native `<dialog>` modal inertness, no routing/history changes, no changes to the storage-failure notice behavior.

## Job Story

When the table agrees the game is over and I confirm finishing,
I want a brief, dismissible celebration that puts everyone who placed in the top three in the spotlight,
so the result feels special in the moment — without changing what was saved and without blocking me from reviewing the full standings.

## Users And Permissions

- Scorekeeper: the only actor, one local browser profile, no accounts. The podium is a transient, local, display-only overlay on that browser's finished view.

## Product Decisions Resolved For This Slice

These resolve the feature notes ("Do not force three distinct winners. Celebration must not affect saved standings.") and `docs/risks-and-open-questions.md` ("Ties can place many players on one podium step. Use flexible groups and retain the full leaderboard." / "Celebration motion can be distracting. Keep confetti brief and respect reduced-motion settings."):

- **Modal mechanism — native `<dialog>` with `showModal()`**: the app's first modal (the finish-game spec deliberately deferred it to this slice; `DESIGN.md`: "Dialogs need keyboard focus management and a clear close control"). `showModal()` provides the focus trap, native Escape handling (`cancel` → `close` events), inert background, and the `::backdrop` pseudo-element; no manual trap code. This fits the dependency-free rule and the app's modern-browser baseline (it already uses `:has()`). No fallback needed. **Implementation finding (verified during implementation, Chrome 154, minimal page repro)**: with a dialog whose only focusable control is its Close button, the native trap alternates between wrapping focus to that control and transiently resting focus on `body` before recapturing on the next Tab — focus never reaches controls behind the modal, which stays open. The browser's behavior is accepted as-is (no manual trap code); the browser suite asserts the guarantee (no background focus, dialog stays open, focus recaptured) rather than a strictly always-inside cycle.
- **Eligibility — every player with rank ≤ 3**: new pure helper `podiumRows(game)` in `src/standings.js`, returning `rankPlayers(game).filter((row) => row.rank <= 3)` (a fresh array; input never mutated; no rank stored). Ties are never collapsed: 12/12/8 → 3 podium players (ranks 1,1,3; no rank-2 group); 10/5/5/0/0 → ranks 1,2,2 only (both rank-2 players, rank-4 pair excluded); 20 tied players → all 20 at rank 1. Rank groups render in ascending order (1, 2, 3); empty rank groups are omitted entirely — no placeholder steps. If `podiumRows` is empty (defensive; unreachable via normal flow because resume requires ≥ 1 player), the modal is not opened.
- **Open trigger — successful confirm-finish only**: in the `handleFinishGame` success path, set `state.podiumOpen = true` (new state field, default `false`) when `podiumRows(result.game)` is non-empty, after the accepted in-memory finish and `persistActiveGameSnapshot()` — the celebration reacts to the in-memory finish and opens regardless of the storage outcome (under blocked writes or invalid-read suppression the podium still opens; the accepted notice behavior and copy are unchanged and stay visible after dismissal). `renderFinishedGame` renders the `<dialog>` markup only when `state.podiumOpen` is true and, after setting `innerHTML`, calls `showModal()` (guarded with `!dialog.open`) and focuses the Close button. `state.podiumOpen` resets to `false` in `resetSetup`, `handleResume`, and the active back-home handler (mirroring `finishPromptOpen`), so reopening/`View results`/reload never re-celebrates.
- **Dismissal — three paths, one cleanup**: a visible `Close` button (`data-action="close-podium"`) calls `dialog.close()`; Escape relies on the native cancel → close; a click listener on the dialog closes when `event.target === dialog` (this is how `::backdrop` clicks surface). A single idempotent `close` handler does the cleanup: set `state.podiumOpen = false`, `render()` (the finished view renders without the dialog), and move focus to `[data-active-heading]`. Result: after dismissal the finished standings remain, identical. **Implementation finding (verified during implementation, Chrome 154)**: the browser dispatches the dialog `close` event as a queued task that can be delayed by hundreds of milliseconds and starved indefinitely on hidden pages (headless), so cleanup cannot rely on that event alone. The shipped dismissal funnels all three paths through the same synchronous cleanup — Close button and backdrop click call `dialog.close()` then the idempotent cleanup handler directly, and a `cancel` listener (`event.preventDefault()` + the same path) handles Escape synchronously — while the `close` listener remains as the idempotent fallback. User-visible behavior is unchanged: Escape still closes the dialog natively.
- **Focus model**: open → `showModal()` then explicit focus on the Close button (deterministic; `document.activeElement` inside the dialog); while open, native modal focus trap cycles Tab within the dialog; close → focus returns to `[data-active-heading]`. The existing unconditional heading-focus line in `handleFinishGame` must become conditional (only when the podium is not open) because the heading is inert while the modal is up.
- **Confetti — CSS-only, brief, reduced-motion-suppressed**: a decorative `aria-hidden="true"` layer (`data-podium-confetti`) inside the dialog with 14 deterministic pieces (no randomness, no JS timers), colored from the existing marker tokens (`--blue --red --yellow --green --orange`), animated by one `@keyframes` fall/drift/rotate, per-piece duration ≤ 3.2s and delay ≤ 0.8s (total ≤ 4s), `animation-iteration-count: 1`, ending at `opacity: 0` (`forwards`), `pointer-events: none`. Reduced motion: an explicit `@media (prefers-reduced-motion: reduce) { .podium-confetti { display: none; } }` suppresses the layer entirely (the existing global reduced-motion clamp in `src/styles.css` stays as a second net). The dialog itself needs no entrance animation.
- **Announcement — standard modal pattern, no new live region**: the dialog carries `aria-labelledby="podium-title"` and `aria-describedby="podium-lede"`; `showModal()` moving focus inside makes assistive tech announce the dialog's role/name/description. No new `aria-live` region is added; the accepted `role="status"` finished note remains the finished-state announcement. Confetti is `aria-hidden="true"`. Podium rows keep the existing label conventions (`aria-label="Player marker {marker}, {color}"` on tokens, `aria-label="{name}: rank {rank}, total {total}"` on totals).
- **Storage neutrality (explicit)**: the podium derives everything at render time from `podiumRows(state.activeGame)`; opening/dismissing triggers no writes; no code path may call `persistActiveGameSnapshot()`, `saveGames`, or mutate `state.savedGames`. The stored payload must be byte-identical across open and dismiss.
- **Narrow screens**: the dialog is `width: min(calc(100vw - 24px), 560px)` with `max-height: calc(100svh - 24px)` and internal scrolling (`overflow: auto`; content padding on an inner `.podium-body` so backdrop clicks still hit the dialog element), stacking rank groups in one column — the 20-tied case scrolls inside the modal with no page-level horizontal overflow at 320px.
- **Sizing**: one pure helper + one modal component + one CSS animation + wiring into the finish confirm path. Correctly sized for a single feature; no split needed.

## Acceptance Scenarios

### Scenario 1: Confirming finish opens the podium with ties honored

Given an active game whose totals produce final ranks 1, 1, 3 (e.g. 12/12/8)
When the scorekeeper confirms finishing
Then the read-only finished view renders exactly as accepted, and a modal `<dialog>` opens on top showing a "Rank 1" group with both tied players and a "Rank 3" group with the third player (no "Rank 2" group, no empty placeholder steps); each podium row shows the player's marker (color + numeral), name, rank, and total; focus is on the modal's Close button; the full standings (all players) remain in the finished view behind the modal.

### Scenario 2: All 20 players tied are all visible and the modal scrolls

Given a 20-player game where every total is equal
When the scorekeeper confirms finishing
Then the modal shows one "Rank 1" group containing all 20 players (none dropped); the modal content scrolls internally (`scrollHeight > clientHeight`) at both 1280×800 and 320×720; there is no page-level horizontal overflow at 320px and the Close control is ≥ 44px.

### Scenario 3: Players outside the podium stay out of the modal

Given a game with totals producing ranks 1, 2, 2, 4, 4 (e.g. 10/5/5/0/0)
When the scorekeeper confirms finishing
Then the modal shows the rank-1 player and both rank-2 players only; the rank-4 players appear exclusively in the full standings behind the modal; unit coverage of `podiumRows` asserts the same eligibility for 1,1,3 and 20-tied inputs.

### Scenario 4: Dismissal, focus return, and reopen behavior

Given the podium is open
When the scorekeeper dismisses it via the Close button, via Escape, or by clicking the backdrop
Then in each case the dialog closes, focus returns to `[data-active-heading]`, the finished standings remain visible and unchanged, and the dismissed modal is gone from the DOM; reopening the game later (View results from home, or after a reload) shows the read-only standings with no podium modal.

### Scenario 5: Celebration never touches saved data

Given the podium open over a just-finished game (including under `setItem`-throws and under invalid-read suppression)
When the scorekeeper opens and dismisses the modal
Then the stored payload under `scorekeeper:games` is byte-identical before and after, no new fields or keys exist, the accepted storage notice copy/`role="status"` behavior is unchanged (visible after dismissal), and console diagnostics stay code-only with no uncaught errors; no phantom finished card appears on home.

### Scenario 6: Confetti is brief and suppressed under reduced motion

Given the podium modal open
When the page runs with normal motion preferences
Then the decorative confetti layer is `aria-hidden`, animates a finite fall (computed `animation-iteration-count: 1`, duration ≤ 3.5s per piece) and becomes invisible when done; when `prefers-reduced-motion: reduce` is emulated, the confetti layer computes to `display: none` (fully suppressed) while the modal itself still opens, is keyboard-operable, and dismisses normally.

### Scenario 7: 320px layout, keyboard, and accessibility

Given the podium open at a 320px viewport
Then nothing overflows horizontally; the Close button is ≥ 44px and shows a visible focus outline; real-keyboard Tab cycles within the dialog (native trap), Enter/Space activate Close, and Escape dismisses with focus back on the heading; the dialog is labelled (`aria-labelledby`) and described (`aria-describedby`); the finished view beneath is unchanged.

## Repository Research

### Files Inspected

- `AGENTS.md`, `PROGRESS.md`, `feature_list.json` — one-feature workflow; `finish-game` accepted (PR #12 merged at `4c3cb99`); `celebrate-podium` is the first dependency-ready unfinished feature; `CI=true ./init.sh` last verified passing 2026-10-12 (planner did not rerun it).
- `CONTEXT.md`, `docs/build-brief.md`, `docs/domain-model.md` — "Podium positions are ranks 1–3; include every tied player at those ranks. Some positions can be empty and some can contain multiple players. Keep full standings available."; brief: "show a podium modal with ranks 1–3 and confetti, accommodating tied players."
- `docs/risks-and-open-questions.md` — flexible podium groups for many tied players; brief confetti honoring reduced motion.
- `DESIGN.md` — "The finish podium shows all players in ranks 1–3, supporting tied groups; celebration is brief and dismissible."; dialogs need focus management and a clear close control; honor reduced motion by suppressing confetti; token/responsive baseline.
- `CONSTRAINTS.md` — saves happen exactly on the four accepted mutations; never persist ranks; read-only finished rendering rules; storage notice/diagnostic rules the podium must not disturb.
- `ARCHITECTURE.md` — module boundaries; "The podium celebration, replay, and saved-game deletion remain separate features."
- `docs/specs/finish-game.md` — the accepted slice that deliberately deferred the first modal and the podium to this feature.
- `src/main.js` (full) — `state` shape; full re-render + explicit refocus; `renderFinishedGame`/`renderFinishedPlayer` (read-only rows, `.is-final` four-column grid); `handleFinishGame` (finish → persist → render → `paintStorageNotice()` → focus heading — the exact wiring point); `renderStorageNotice`/`paintStorageNotice` (`replaceChildren` painters that do not touch a dialog); `handleResume`/`resetSetup`/back-home flag resets; `escapeHtml`/`escapeAttribute`; `bindActiveEvents` (called by `renderFinishedGame`, the binding point for podium events).
- `src/standings.js` (full) — `rankPlayers` competition ranking with `player.order` ties; the base for `podiumRows`.
- `src/game.js` (full) — `finishGame` returns `{ ...game, status: "finished" }`; untouched by this feature.
- `src/roster.js` (full), `src/storage.js` + `src/score.js` (export surfaces verified via grep; behavior per CONSTRAINTS/PROGRESS) — `getColor(player.color).cssClass`, marker conventions, `STORAGE_KEY`; all untouched.
- `src/styles.css` (full) — tokens, `.finish-*`, `.active-player` grids, `prefers-reduced-motion` global clamp, breakpoints (720/480/360px), focus-visible outline.
- `scripts/browser-test-utils.mjs` (full) — CDP helpers (`launchChrome`, `evaluate`, `click`, `fill`, `setViewport`, `screenshot`, `readSavedGamesState`); no reduced-motion emulation helper yet (gap).
- `scripts/browser-finish-game-test.mjs` — session runner (`runSession` with console/warning capture), `pressEnter`/`pressTab` real-key helpers, and the post-confirm assertions the podium legitimately changes (see Current Gaps).
- `scripts/static-server.mjs`, `scripts/smoke.mjs`, `init.sh`, `package.json` — wiring points; no new `src/*` module means no allowlist/smoke/required-file changes; only a new `node --check` entry and a new npm script.
- Git state: `codex/celebrate-podium` clean at `4c3cb99` (PR #12 merge); no `docs/specs/celebrate-podium.md` existed before this spec.

### Existing Patterns To Follow

- Pure, non-mutating helpers per concern in `src/*.js` with focused unit tests; render-time derivation only (ranks are never stored).
- Full re-render + explicit refocus; `replaceChildren` painters for live regions; `role="status"` polite announcements; contextual `aria-label`s; `escapeHtml`/`escapeAttribute` for every interpolated value.
- One CDP browser suite per feature: isolated Chrome profiles, real-key Enter/Tab walks, 320px probes, ≥44px target and visible-focus assertions, `readSavedGamesState` byte-identical payload checks, zero-uncaught-console-error assertions, temp-dir screenshots, honest updates to existing suites instead of weakened assertions (precedent: the resume slice updated four suites).
- Honest test updates: never weaken existing suites; new behavior gets new assertions.

### Current Gaps

- No modal exists anywhere in the app; no `<dialog>`, no podium markup, no confetti CSS, no `podiumRows` helper, no `state.podiumOpen`.
- `scripts/browser-test-utils.mjs` has no reduced-motion emulation helper; the new suite adds it locally via `Emulation.setEmulatedMedia({ features: [{ name: "prefers-reduced-motion", value: "reduce" }] })` (no shared-utils change required).
- `scripts/browser-finish-game-test.mjs` assertions the podium legitimately changes (all require honest updates, enumerated here so the implementer does not discover them by failure):
  - Main flow after confirm: `assert.equal(finished.focusOnHeading, true, "finishing must move focus to the game heading")` — now focus lands inside the open podium; replace with podium-open + focus-on-Close assertions, dismiss via the Close button, then assert `focusOnHeading === true` and unchanged standings (covers the dismiss-return contract).
  - Main flow `goHome` directly after confirm — dismiss the podium first (the background is inert while a modal dialog is open).
  - View-results reopen assertions — add an explicit "no podium dialog present" assertion.
  - 320px keyboard walk — after the real-key Enter confirm, assert the podium is open with focus inside; add a real-key `pressEscape` helper, dismiss, then assert focus back on the heading; keep all overflow/target checks; capture the podium screenshot as new evidence.
  - Blocked-write and suppression sessions — dismiss the podium before `goHome`; optionally assert the podium still opened despite the failed save (celebration is honest about the in-memory result) and that byte-identical payload/no-phantom-card checks still hold.

## Technical Approach

1. **`src/standings.js` — `podiumRows(game)`** (new export): `rankPlayers(game).filter((row) => row.rank <= 3)`; returns a fresh array, never mutates input, no stored ranks. Extend `scripts/standings-test.mjs` with: 12/12/8 → 3 rows ranks 1,1,3; 10/5/5/0/0 → 3 rows ranks 1,2,2 (rank-4 pair excluded); 20 zeros → 20 rows all rank 1; `podiumRows(null)` → `[]`; structuredClone snapshot proving no mutation.
2. **`src/main.js` — state and trigger**: add `state.podiumOpen = false`; reset it wherever `finishPromptOpen` resets (`resetSetup`, `handleResume`, back-home). In `handleFinishGame` success: `state.podiumOpen = podiumRows(result.game).length > 0`; keep `persistActiveGameSnapshot()` and `paintStorageNotice()` exactly as accepted; replace the unconditional heading focus with focus-on-Close-when-podium (handled in `renderFinishedGame`) and heading focus only when no podium opened.
3. **`src/main.js` — podium rendering**: in `renderFinishedGame`, after `innerHTML`, when `state.podiumOpen` and the dialog exists and is not open: `showModal()` then focus `[data-action='close-podium']`. Markup (all interpolated values escaped; `podiumRows` groups rendered for ranks 1→3, omitting empty groups):
   `<dialog class="podium-dialog" data-podium-dialog aria-labelledby="podium-title" aria-describedby="podium-lede">` containing a `.podium-body` (carries padding, `position: relative`) with: the confetti layer `<div class="podium-confetti" data-podium-confetti aria-hidden="true">` (14 `<span class="confetti-piece">` children with inline custom properties for position/delay/duration/color); `<h2 id="podium-title" class="podium-title">Final podium</h2>`; `<p id="podium-lede" class="podium-lede">Congratulations to the top of the table.</p>`; an `<ol class="podium-groups" aria-label="Podium players">` whose items are `<li class="podium-group">` with `<h3 class="podium-rank-heading">Rank {n}</h3>` and a player `<ul>` — each row reusing `.player-token {marker}.{color}` spans and the `"{name}: rank {rank}, total {total}"` label convention; then `<button type="button" class="primary-action podium-close" data-action="close-podium">Close</button>`.
4. **`src/main.js` — dismissal bindings** (inside the `renderFinishedGame`/`bindActiveEvents` path): Close button click → `dialog.close()` + the idempotent cleanup; dialog `click` → `if (event.target === dialog) dialog.close()` + the idempotent cleanup (backdrop clicks surface this way); dialog `cancel` (Escape) → `event.preventDefault()` then the same path, because the queued `close` event is not prompt enough to rely on; dialog `close` → idempotent cleanup fallback (`if (!state.podiumOpen) return; state.podiumOpen = false; render(); focus [data-active-heading]`). No other listeners.
5. **`src/styles.css`**: `.podium-dialog` (`width: min(calc(100vw - 24px), 560px)`, `max-height: calc(100svh - 24px)`, `padding: 0`, surface/border/radius/shadow tokens, `overflow: auto`); `.podium-body` (padding via 8px rhythm, `position: relative`); `.podium-confetti` (`position: absolute; inset: 0; overflow: hidden; pointer-events: none`); `.confetti-piece` (8–12px rounded pieces, per-piece `@keyframes podium-fall` fall/drift/rotate, duration 1.6–2.4s + delay 0–0.8s via inline custom properties, `iteration-count: 1`, `forwards`, ending `opacity: 0`); `.podium-title`/`.podium-lede`/`.podium-group`/`.podium-rank-heading`/`.podium-player` (row grid mirroring `.active-player` without buttons; rank-1 group may use `--surface-strong` emphasis); `.podium-close` (≥44px, reuses `.primary-action`); explicit `@media (prefers-reduced-motion: reduce) { .podium-confetti { display: none; } }`; verify 320px (≤480px stacking keeps all four row elements visible) and contrast within existing tokens.
6. **Tests and wiring**: new `scripts/browser-podium-test.mjs` (isolated sessions per the finish-game suite's `runSession` pattern; add a local `pressEscape` helper and a reduced-motion emulation block) covering Scenarios 1–7; extend `scripts/standings-test.mjs` for `podiumRows`; register `test:browser:podium` in `package.json`'s `test` chain; add the new script to `init.sh`'s `node --check` list. No `src/*` module is new, so `scripts/static-server.mjs`, `scripts/smoke.mjs`, and the required-file list are unchanged. Update `scripts/browser-finish-game-test.mjs` per the honest-update list above (no assertion weakened).
7. **Docs**: README (behavior + new command), ARCHITECTURE (podium layer, first modal, reduced-motion suppression), CONSTRAINTS (durable rules below); record evidence.

## Expected File Changes

- `src/standings.js` — modify; add pure `podiumRows(game)` export.
- `scripts/standings-test.mjs` — modify; `podiumRows` tie/exclusion/immutability cases.
- `src/main.js` — modify; `state.podiumOpen`, finish-trigger wiring, podium `<dialog>` rendering + `showModal()`/focus, dismissal bindings, flag resets.
- `src/styles.css` — modify; podium dialog/body/groups/rows, confetti layer + keyframes, reduced-motion suppression, 320px rules.
- `scripts/browser-podium-test.mjs` — create; Scenarios 1–7 on real headless Chrome (evidence dir `devexpert-celebrate-podium`).
- `scripts/browser-finish-game-test.mjs` — modify; honest updates listed under Current Gaps.
- `package.json` — modify; add `test:browser:podium` and include it in the `test` chain.
- `init.sh` — modify; add `node --check scripts/browser-podium-test.mjs`. Must not start a long-running server.
- `README.md` — update; podium behavior and the new test command.
- `ARCHITECTURE.md` — update; podium display layer, first `<dialog>` modal, `podiumRows`, confetti/reduced-motion rule.
- `CONSTRAINTS.md` — update; durable rules: the podium is display-only (render-time `podiumRows`, zero writes, no persisted fields), every player with rank ≤ 3 must be shown with ties never collapsed, confetti must be CSS-only and fully suppressed under reduced motion, and the podium must never open when merely reopening a finished game.
- `AGENTS.md` — not needed; no workflow, startup, or operating-rule changes.
- `index.html`, `src/game.js`, `src/score.js`, `src/storage.js`, `src/roster.js`, `scripts/static-server.mjs`, `scripts/smoke.mjs`, `scripts/browser-test-utils.mjs`, other browser suites — not needed; unchanged (existing suites other than finish-game must pass unmodified).
- `PROGRESS.md`, `feature_list.json` — updated with actual evidence during implementation/validation, not by this planner.

## Visual Design Impact

- UI involved: yes.
- Design source: `DESIGN.md` (accepted tokens, finished-screen description, accessibility baseline, "celebration is brief and dismissible") plus existing panel/row patterns.
- Screens or states affected: the finished view gains a podium overlay (`<dialog>`) with confetti; the active game and home are untouched; no new screens.
- New design artifact required: no — exact podium layout is an implementation choice within the accepted tokens (stacked rank groups instead of a literal three-step podium, so tied groups and 20-player cases work; the mockup is inspiration, written behavior is authoritative). Subject to 44px/contrast/320px checks.

## Durable Documentation Impact

- `ARCHITECTURE.md`: update — podium display layer in `src/main.js`, `podiumRows` in `src/standings.js`, the app's first `<dialog>` modal, reduced-motion suppression boundary.
- `CONSTRAINTS.md`: update — durable MUST rules listed under Expected File Changes.
- `AGENTS.md`: not needed — no agent-workflow or operating-rule change.
- `README.md`: update — user-visible behavior and test commands.
- Other docs: none — `CONTEXT.md`/`docs/domain-model.md` already define podium ranks 1–3 semantics correctly; no source-of-truth change.

## Implementation Plan

1. Add `podiumRows` to `src/standings.js` with its unit cases; keep every existing suite green.
2. Implement `state.podiumOpen`, the finish-trigger wiring, podium rendering + focus, and dismissal bindings in `src/main.js`.
3. Style the dialog, groups, rows, confetti, and reduced-motion suppression in `src/styles.css`; verify 320px and contrast.
4. Create `scripts/browser-podium-test.mjs` (Scenarios 1–7) and update `scripts/browser-finish-game-test.mjs` honestly; wire into `package.json` and `init.sh`.
5. Update `README.md`, `ARCHITECTURE.md`, `CONSTRAINTS.md`; run the full verification plan and record evidence.

## Implementation Tasks

- [ ] Add `podiumRows(game)` to `src/standings.js` and its cases to `scripts/standings-test.mjs`; `npm run test:standings` green.
- [ ] Add `state.podiumOpen` (default/reset points) and the finish-trigger wiring in `handleFinishGame` (set from `podiumRows(result.game)`, after persist, before render; conditional heading focus).
- [ ] Render the podium `<dialog>` in `renderFinishedGame` when `state.podiumOpen`, with `showModal()` guard + Close-button focus, labelled/described groups, escaped content, and the three dismissal paths bound to one idempotent close handler returning focus to `[data-active-heading]`.
- [ ] Style `.podium-*` and confetti in `src/styles.css` (internal scroll, ≥44px Close, visible focus, reduced-motion `display: none`, no 320px overflow).
- [ ] Create `scripts/browser-podium-test.mjs` covering Scenarios 1–7 (ties 1,1,3; 20-tied with internal scroll; exclusion; three dismissals + reopen; byte-identical payload incl. blocked-write/suppression; reduced-motion emulation; 320px/keyboard); wire `test:browser:podium` into `package.json` and `init.sh`.
- [ ] Update `scripts/browser-finish-game-test.mjs` per the honest-update list (podium-open assertions after confirm, dismiss before navigation, Escape in the 320px walk, no-podium-on-reopen).
- [ ] Update `README.md`, `ARCHITECTURE.md`, `CONSTRAINTS.md`.

## Verification Plan

- `node --check src/standings.js src/main.js src/styles.css scripts/standings-test.mjs scripts/browser-podium-test.mjs scripts/browser-finish-game-test.mjs` — expected: all pass.
- `npm run test:standings` — expected: pre-existing cases plus `podiumRows` tie/exclusion/immutability cases green.
- `npm run test:browser:podium` — expected: Scenarios 1–7 pass on real headless Chrome, including all-20-visible with internal modal scroll, three dismissal paths with heading focus return, byte-identical payload across open/dismiss (plus blocked-write and suppression sessions), and reduced-motion `display: none` via emulated media.
- `npm run test:browser:finish-game` — expected: passes with the honest updates; reopen assertions now also prove no podium appears.
- `npm run test` — expected: all unit suites, smoke, and all eight browser suites (seven existing + new) pass; existing suites other than finish-game unmodified.
- `./init.sh` and `CI=true ./init.sh` — expected: required-file checks, all `node --check` entries (including the new test script), and the full `npm run test` chain pass; the gate exits without starting a long-running server and only prints the manual `npm run dev` follow-up.
- `npm run dev` + manual real-browser pass (1280×800 and 320×720): finish a game, watch the podium open with confetti, dismiss via Close/Escape/backdrop, verify standings remain; reopen from home to verify no re-celebration.
- Feature-list verification mapping: "Finish tied games including ranks 1, 1, 3 and all 20 players tied; ensure all eligible players are visible" → Scenarios 1–3; "Check modal focus, keyboard dismissal, narrow-screen scrolling, and suppressed confetti under reduced motion" → Scenarios 4–7; `CI=true ./init.sh` → gate runs above.
- E2E note: no persistent E2E harness exists in this repo; the focused CDP browser suite is the established browser-flow coverage and is included. Unit + browser coverage is sufficient because the feature is local display-only UI with no routing, auth, or API surface.
- Responsive and accessibility verification: Scenarios 2, 6, 7 plus the manual 320px pass; focus trap, Escape, backdrop, and reduced-motion asserted in tests; contrast checked against existing tokens.

For `init.sh`, be explicit:

- `./init.sh` executes the non-blocking standard gate (required files, the full `node --check` list including `scripts/browser-podium-test.mjs`, and the full `npm run test` chain).
- It must not start long-running processes such as `npm run dev`; it may print the manual server command after checks pass.

## Evidence To Capture

- Exact commands and results for `npm run test:standings`, `npm run test:browser:podium`, `npm run test:browser:finish-game`, `npm run test`, `./init.sh`, and `CI=true ./init.sh`.
- Browser proof points: podium opens only on confirm-finish; 1,1,3 and 20-tied eligibility (all eligible players present, none forced apart, none dropped); three dismissal paths each returning focus to the heading; reopen shows no modal; stored payload byte-identical across open/dismiss including under blocked-write and suppression; reduced-motion emulation computes confetti `display: none`; normal motion shows a finite (≤ 3.5s) animation.
- Confirmation that console diagnostics stay code-only with zero uncaught console errors in every session, and that the storage notice behavior/copy is unchanged.
- Screenshot paths from the new suite (desktop + 320px, podium open), noting if they could not be opened for visual inspection.
- Update `feature_list.json` evidence and the `PROGRESS.md` session log with these results (implementer/validator step).

## Validator Checklist

- [ ] Implementation stays within `celebrate-podium` scope: podium helper + modal + confetti + finish-trigger wiring only.
- [ ] No Play again, no changes to `finishGame`/scoring/undo/ranking semantics, storage format, `src/storage.js`, the finish prompt, or `index.html`; no new dependencies.
- [ ] Eligibility honors ties: rank ≤ 3 players all appear (1,1,3 → three players; 20 tied → twenty), empty rank groups omitted, rank ≥ 4 players excluded from the modal but visible in the standings.
- [ ] Podium opens only on successful confirm-finish (including under storage failure); never on resume/View results/reload; dismissal leaves the finished view unchanged with focus on the heading.
- [ ] Modal mechanism is `<dialog>` + `showModal()` with native trap/Escape; Close/Escape/backdrop all work; open → focus inside (Close button); `aria-labelledby`/`aria-describedby` set; confetti `aria-hidden`.
- [ ] Confetti is CSS-only, brief, finite, and fully suppressed (`display: none`) under `prefers-reduced-motion: reduce`; the global clamp is untouched.
- [ ] Saved data is untouched: byte-identical payload across open/dismiss, no new fields/keys, no writes from podium code, accepted storage-notice behavior preserved, code-only diagnostics, zero uncaught console errors.
- [ ] 320px: no horizontal overflow, internal modal scrolling with 20 tied players, ≥44px Close target, visible focus, keyboard operable.
- [ ] `scripts/browser-finish-game-test.mjs` updates are honest (no weakened assertions); other existing suites pass unmodified.
- [ ] `npm run test`, `./init.sh`, and `CI=true ./init.sh` pass with the new checks; `init.sh` did not start a server.
- [ ] `README.md`, `ARCHITECTURE.md`, `CONSTRAINTS.md` updated; `feature_list.json` evidence and `PROGRESS.md` record real checks.
- [ ] No unrelated product behavior or extra feature work was added.
