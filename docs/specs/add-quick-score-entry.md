# Feature Implementation Spec: Add quick tap counters and a signed stepper

## Source Feature

- `id`: `add-quick-score-entry`
- `area`: `scoring`
- `depends_on`: `refresh-design-system` (accepted and merged, PR #16); the branch base also contains the merged `name-game-titles` (PR #17) and `track-game-activity` (PR #18)
- `status`: `not_started` at planning time
- `source`: `feature_list.json`

## Goal

The active game's score-entry panel gains two input conveniences beside the existing custom input: seven preset **quick tap counters** (+1, +5, +10, +25, −1, −5, −10) and a signed **stepper** (− / +) flanking the amount field. Tapping a counter applies that signed amount to the currently selected player **immediately** as an ordinary score change — same parse gate, same save trigger, same accepted feedback message, same undo semantics, same recent-entries derivation, same storage behavior. The stepper nudges the draft in the existing `#score-amount` field by ±1 without saving. No new state, no new storage fields, no new save-trigger call sites.

## Non-Goals

- No changes to `parseScoreAmount`, the `beforeinput` guard (`guardScoreEntryInput`), the `type="number"` attributes, bounds (±1,000,000), zero handling, or any exact accepted message.
- No "Current Total {n} pts" card in the score panel (mockup element; the leaderboard already shows the selected player's total — keeping `.score-selected` as-is avoids new scope).
- No draft-matching counter highlight (the mockup's highlighted "+5" illustrates the sample draft state, not a behavior), no long-press/repeat acceleration, no configurable or remembered presets, no stepper auto-save.
- No player-number badges, distribution bar, or podium actions (owned by `show-player-numbers`, `show-score-distribution`, `extend-podium-actions`); no mockup decoration (Turn 6 · 48m, Round active, header add-player icon).
- No changes to finished views (they render no score panel, so no counters/stepper there), the recent-entries block, or the finish section.
- **Must not change** (regression floor): `index.html`; `src/score.js`, `src/storage.js`, `src/standings.js`, `src/roster.js`, `src/game.js` (all untouched — the presets live as a local constant in `src/main.js`); `persistActiveGameSnapshot()` semantics and its **exactly six** call sites (a counter is a new UI entry into the existing score-save trigger, not a seventh trigger); the recent-entries block stays display-only (`[data-recent-entries]` gains zero focusables); the design-system suite's nav matrix, byte-identical write-absence proofs, and fixed ≥44px survey list; all byte-identity proofs in the undo/resume/finish/podium/play-again/game-title/activity suites; every pre-existing test suite byte-untouched (expected honest updates: **zero**); breakpoints, reduced-motion rules, focus contracts, suite-frozen `--muted`; the 13 accepted features' behavior.

## Job Story

When I am scoring turns quickly at the table,
I want to tap +5 for the player whose turn it is (or step the amount field up and down) without typing,
so each entry still lands as a normal, undoable score change and a mis-tap is one tap on Undo last score.

## Users And Permissions

- Scorekeeper: the only actor. Counters/stepper write through the same browser-local storage rules as manual saves; no new permissions, accounts, or network behavior.

## Product Decisions Resolved For This Slice

These close the `docs/risks-and-open-questions.md` item "Quick tap counters: confirm the final preset set … and whether tapping applies immediately or stages the draft amount" and the related implementation-time choices.

### Decision 1 — Counters apply immediately; the stepper stages the draft

- **Quick counters apply immediately** (no Save needed). Rationale: the build brief defines them as preset signed amounts where "each is an ordinary score change; undo semantics are unchanged"; the product story is "miss-tapped? one-tap undo"; a staged counter would be a two-step keyboard and need new (non-frozen) feedback copy. Immediate application reuses the exact accepted success/undo/recent-entries behavior with zero new copy.
- **The stepper stages**: − / + adjust the draft awaiting Save points; it never saves by itself. This keeps the two controls distinct, exactly as the mockup draws them (stepper around the draft value; counters as a tap row).

### Decision 2 — Mechanism: counters ride the existing save path

`handleScoreSubmit` keeps its logic unchanged and gains only a returned success boolean (`true` on success, `false` on each early rejection return). `handleQuickScore(amount)` then:

1. sets `#score-amount`'s `value` to `String(amount)` (discarding any typed draft — Decision 4),
2. calls `handleScoreSubmit()` — so the counter passes through the identical `parseScoreAmount` gate (plain-format gate included), `applyScoreChange` guards, `persistActiveGameSnapshot()` (the unchanged second trigger; call sites stay six), exact success message `Added {amount} points to {name}. New total: {t}. Rank: {r}.`, re-render, recent-entries refresh, and storage rules (suppression/rollback/notice), and
3. on success, moves focus to the pressed counter button in the fresh DOM (Decision 6); on rejection it leaves the accepted rejection focus behavior (input) untouched.

Programmatic value assignment does not fire `beforeinput`; that is correct — the guard is a typing guard and the save-side plain-format gate still runs. No value is silently rewritten: the applied amount is the preset itself.

### Decision 3 — Target player and the no-selection case

Counters target `state.selectedPlayerId` — the same player the form's "Points for {name}" label names. The active view has **no unselected state**: `renderActiveGame` re-points selection to the first player and `renderScoreForm(player)` renders only when a player is selected, so counters exist only with a target. The counters therefore need **no disabled state**; the theoretically unreachable `unknown-player` guard (corrupted state) paints the accepted "Select a player before saving points." through the shared rejection path.

### Decision 4 — Interaction with a typed draft

- **Counter over a non-empty draft**: the draft is **discarded, not summed** — tapping +5 with `12` in the field applies exactly +5 and the field clears on re-render. One control = one intent; the stepper exists for adjusting a draft; undo recovers mistakes; drafts are already transient (any successful save clears them). Disclosed here so the suite can pin it.
- **Stepper over a non-empty draft**: steps from the draft's numeric reading; empty or unparseable drafts (e.g. a lone sign) use a **0 baseline**. Output is always plain integer text (`"6"`, `"-3"`, `"0"`) clamped to ±`MAX_SCORE_ABS`, so a stepped draft can never trip the plain-format gate or bounds at save. Stepping from `"12."` normalizes the transient decimal draft to `"13"` — an explicit, visible user edit, not a rewrite by the save path.

### Decision 5 — Presets, layout, and visual treatment

- Preset set locked to the mockup's seven: **+1, +5, +10, +25** (row 1) and **−1, −5, −10** (row 2), as a local `QUICK_SCORE_PRESETS = [1, 5, 10, 25, -1, -5, -10]` constant in `src/main.js`.
- DOM inside `renderScoreForm` (form order): selected-player line, label, **stepper row** [− button, `#score-amount`, + button], helper text, `#score-feedback`, **quick-counters group** (`role="group" aria-label="Quick tap counters"` with a visible eyebrow "Quick tap counters", then the two rows), Save points, Undo last score. Counters sit between the live region and Save, matching the mockup's visual flow; they are `type="button"` so they can never submit or match the suites' `[data-score-form] button[type='submit']` selector.
- New `data-action` values (`apply-quick-score`, `step-score-up`, `step-score-down`) — verified distinct from every existing action id. Counter buttons carry `data-amount="{n}"`.
- ≥44px targets everywhere. Counter chips: `border: 1px solid var(--border-cool)` on `var(--surface)`, `border-radius: var(--radius-md)`, `flex: 1` within their row, label-md weight 600–700 with tabular numerals; **negative chips tinted** `var(--primary-fixed)` (`#D6E3FF`, the token file's soft-tint role used by the selected row) so the sign-carrying label plus the tint distinguishes them — never color alone (labels always show `+`/`-`). Stepper buttons: 44×44 square-ish secondary-styled controls. Visible labels use ASCII `+`/`-` (consistent with recent-entries amounts).

### Decision 6 — Accessible names and focus/keyboard contract

- Counter accessible name: **`Add {n} {point|points} to {name}`** using the signed amount and correct pluralization for |n| = 1 — e.g. `Add 5 points to Alex`, `Add -1 point to Alex`. Single verb/pattern mirroring the stored amount (negative amounts are announced as "minus n", consistent with the helper's "Use negative points for penalties" framing). The accepted feedback copy ("Added 1 points …" idiom included) stays frozen and untouched.
- Stepper accessible names: **`Increase points draft by 1 for {name}`** / **`Decrease points draft by 1 for {name}`** — "draft" makes explicit that they edit the pending amount, not the total.
- Focus after a successful counter apply returns to **the same counter button** (matched by `data-action` + `data-amount`), mirroring the undo precedent (`handleUndo` focuses the undo button) so repeated keyboard Enter keeps tapping the same counter. `#score-feedback` (existing polite region) announces the save; no new live region. Stepper presses cause no re-render, so focus stays on the stepper button naturally. Typed saves keep the accepted "focus stays in `#score-amount`" contract unchanged.
- Tab order within the panel: − → input → + → +1 → +5 → +10 → +25 → −1 → −5 → −10 → Save points → Undo last score.

### Decision 7 — What does not change

Undo needs no special-casing: a counter-applied change is popped like any other ("Undid 25 points for Alex. New total: 16. Rank: 2."), `Last:` recomputes, and a no-op undo stays a byte-identical no-write. Recent entries derive for free. The six save triggers, storage envelope (version 1), blocked-write behavior, and all accepted messages are inherited through the shared path.

## Acceptance Scenarios

### Scenario 1: A counter behaves exactly like a typed save

Given an active game with Alex selected and an empty amount field
When the scorekeeper taps +25
Then Alex's total increases by 25, the leaderboard re-ranks, `#score-feedback` shows exactly `Added 25 points to Alex. New total: 25. Rank: 1.`, the amount field is cleared, the recent-entries header reads `Last: Alex +25`, a new storage entry is written with the same shape as a typed save (envelope version 1), and focus sits on the +25 button.

### Scenario 2: Every preset works, negatives included, and undo is ordinary

Given Alex selected
When the scorekeeper taps +1, +5, +10, +25 (totals 1, 6, 16, 41), then selects Sam and taps −1, −5, −10 (total −16)
Then each tap produces its accepted feedback message and storage write; activating Undo last score reverses exactly the latest counter change (`Undid -10 points for Sam. New total: -6. Rank: …`), the entry disappears from recent entries, and repeated undos walk back through counter and typed changes identically.

### Scenario 3: The stepper stages and never saves

Given Alex selected with an empty amount field and a saved payload snapshot
When the scorekeeper presses + (field shows `1`), then − twice (field shows `0`, then `-1`), steps from `5` to `6`, fills the field to `1000000` and presses + (stays `1000000`), and presses − from `-1000000` (stays)
Then totals, feedback, and the stored payload are **byte-identical** (no save, no re-render, no feedback change) throughout, and pressing Save points afterwards applies the stepped draft as one ordinary score change (a `0` draft still gets the exact `Zero adds no points. Enter a positive or negative amount.` message).

### Scenario 4: A counter discards a typed draft

Given `12` typed into the amount field (not saved)
When the scorekeeper taps +5
Then exactly +5 is applied (not 17), the draft is gone, and a subsequent typed save of `12` applies ordinarily; tapping a counter while the draft holds a lone sign (`+`) behaves the same.

### Scenario 5: Accessibility and keyboard contract

Given 320×720 and 1280×800 viewports
Then all seven counters and both stepper buttons are ≥44px with visible focus, each exposes its Decision 6 accessible name, the group is labelled `Quick tap counters`, a real-key walk (Tab into the panel, Enter on +5) applies the change and returns focus to +5 so a second Enter applies again, there is no horizontal overflow at either width, and there are zero uncaught console errors.

### Scenario 6: Storage rules and view boundaries hold

Given blocked storage (`setItem` throws) and, separately, a finished game
When a counter is tapped under blocked writes
Then the total still updates in memory, the accepted role=status write notice appears with unchanged copy, warnings stay code-only, and no storage key is created; when a finished (or replayed/active-empty) view renders, no counters or stepper exist anywhere in the DOM.

## Repository Research

### Files Inspected

- `feature_list.json` (`add-quick-score-entry`, lines 366–381), `PROGRESS.md`, `AGENTS.md` — scope, status, workflow.
- `docs/build-brief.md` (v2 bullet: preset signed amounts alongside the stepper and custom input; ordinary score changes), `docs/domain-model.md` line 24 ("input conveniences that produce ordinary score changes"), `docs/risks-and-open-questions.md` line 20 (the decision this spec closes), `DESIGN.md` (active-game panel bullet) + `docs/design/update-v2/active_game_scorekeeper/screen.png` (SCORE ENTRY panel: stepper around the draft `+5`, helper text, "Quick tap counters" rows +1/+5/+10/+25 then −1/−5/−10, Save points, Undo last score).
- `docs/specs/track-game-activity.md`, `name-game-titles.md` — convention for decisions, regression floors, honest updates (none expected here), and suite wiring.
- `src/score.js` — `MAX_SCORE_ABS`, `parseScoreAmount` ordered gates (plain-format gate last), `applyScoreChange` guards (`zero`/`out-of-range`/`not-safe`), `recentScoreChanges`. **Untouched by this feature.**
- `src/main.js` (1496 lines) — `renderScoreForm` (input attributes, `aria-describedby="score-help score-feedback"`, feedback region, Save/Undo), `handleScoreSubmit` (parse → apply → persist → exact success message → render → focus input), `guardScoreEntryInput` (beforeinput), `bindActiveEvents` (per-render rebinding, `select-player` focus pattern), `handleUndo` (focus-follows-the-action precedent), `persistActiveGameSnapshot` (six call sites), `signedScoreAmount`.
- `src/styles.css` — `.score-form` grid, `.text-field` (`width: 100%`, min-height 44), `.primary/secondary/finish-action` ≥44px language, 720/480/360 breakpoints, additive-only styling convention (`.recent-entries*`, `.title-edit-*` precedents).
- Test contracts: `scripts/browser-score-test.mjs` (`savePoints` clicks `[data-score-form] button[type='submit']`; `rowButtonLabels` deep-equals scoped to `.add-points-action`; input type/step/min/max + label + helper + describedby + live asserted; focus-in-input after typed saves; real-key guard walk at 320px), `browser-rank-test.mjs` (focus retained in `#score-amount` after saves/reorders), `browser-undo-test.mjs` (undo focus precedent; `"a save does not focus the undo button"`; no-op byte-identity), `browser-game-activity-test.mjs` (`focusableCount === 0` scoped to `[data-recent-entries]`; same `savePoints` helper), `browser-design-system-test.mjs` (fixed `INTERACTIVE_SELECTORS` survey — new controls are simply not surveyed; do not reuse surveyed classes/actions), `browser-game-title/finish-game/podium/play-again-test.mjs` (real-key Tab walks start from headings/header/dialog — none traverse the score form's inner order), `browser-test-utils.mjs` (`fill` sets `value` directly, bypassing `beforeinput`), `scripts/score-test.mjs` (exact error mappings).
- `package.json` (test chain), `init.sh` (required files + `node --check` list — no new `src/*` module, so only the new suite is appended).

### Existing Patterns To Follow

- One new focused browser suite per feature (`scripts/browser-quick-score-test.mjs`) wired as `npm run test:browser:quick-score`, chained into `npm run test`, added to `init.sh`'s `node --check` list; isolated Chrome sessions at 1280×800 and 320×720 with `readSavedGamesState` byte-identity proofs where writes must not happen.
- Additive-only CSS with scoped classes; per-render event rebinding in `bindActiveEvents`; focus-follows-the-action after mutations; zero honest updates to pre-existing suites when behavior is purely additive (the design-system restyle achieved this).

### Current Gaps

- The score form has no preset counters and no stepper; quick scoring requires typing plus Save.

## Technical Approach

1. **`src/main.js` markup**: add the local `QUICK_SCORE_PRESETS` constant; inside `renderScoreForm` wrap `#score-amount` in a `.score-stepper` div with the − / + `type="button"` controls (Decision 5 order/attributes), and render the `.quick-scores` group between `#score-feedback` and the Save button. No other render function changes; finished/empty views naturally expose nothing.
2. **`src/main.js` handlers**: `stepScoreDraft(direction)` — pure DOM write per Decision 4 (numeric reading of the trimmed draft, 0 baseline for empty/unparseable, clamp to ±`MAX_SCORE_ABS`, write `String(next)`; no render, no feedback, no storage); `handleQuickScore(amount)` per Decision 2; `handleScoreSubmit` gains returned booleans only; bind the three actions in `bindActiveEvents` like `select-player`.
3. **`src/styles.css`**: additive classes only — `.score-stepper` (flex row; a scoped `.score-stepper .score-amount-field { flex: 1; min-width: 0; }` so the 100%-width text field shares the row), `.stepper-action`, `.quick-scores`, `.quick-scores-row`, `.quick-score-action` (+ `.is-negative` tint). No existing selector, token, breakpoint, or motion rule modified.
4. **Tests**: new `scripts/browser-quick-score-test.mjs`; wire `package.json` + `init.sh`. **No pre-existing suite changes.**
5. **Docs**: README (panel behavior + new command + next steps), ARCHITECTURE (counter/stepper wiring as a new UI entry into the existing score-save trigger; six call sites preserved; new suite), CONSTRAINTS (durable rules: counters/stepper are input conveniences through the ordinary change path; stepper never saves; counter focus contract; preset set locked to the mockup's seven).

## Expected File Changes

- `src/main.js` — modify: `QUICK_SCORE_PRESETS`; stepper wrapper + counters group in `renderScoreForm`; `stepScoreDraft`/`handleQuickScore`; success booleans on `handleScoreSubmit`; bindings in `bindActiveEvents`.
- `src/styles.css` — modify: the additive classes above (plus any scoped ≤360px tightening if measurement shows a need; no existing rule touched).
- `scripts/browser-quick-score-test.mjs` — new focused suite (Sessions A–E below).
- `package.json` — add `test:browser:quick-score` and chain it into `test`.
- `init.sh` — add the new script to the `node --check` list.
- `README.md`, `ARCHITECTURE.md`, `CONSTRAINTS.md` — document per Technical Approach.
- `docs/specs/add-quick-score-entry.md` — this spec (belongs to this feature's PR).
- **Byte-untouched (verified via git diff)**: `index.html`; `src/score.js`, `src/storage.js`, `src/standings.js`, `src/roster.js`, `src/game.js`; `scripts/smoke.mjs`, `scripts/static-server.mjs`, `scripts/browser-test-utils.mjs`; all twelve pre-existing browser suites (`roster`, `score`, `rank`, `undo`, `resume`, `storage-failure`, `finish-game`, `podium`, `play-again`, `design-system`, `game-title`, `game-activity`) and all five unit suites. Expected honest updates: **zero**. (The selector scopes above were checked against every suite; if self-verification still proves a structural conflict, an honest update with a supersession comment is the fallback — not the expectation.)

## Visual Design Impact

- UI involved: yes — the active view's score panel only.
- Design source: `DESIGN.md` + `docs/design/update-v2/active_game_scorekeeper/screen.png` (SCORE ENTRY panel); the panel's "Current Total" card, distribution bar, and header decoration are excluded (Non-Goals).
- Screens/states affected: active game score panel (desktop and 320px stacked layout; also renders under storage suppression).
- New design artifact required: no — existing tokens cover the additions; no new motion.

## Durable Documentation Impact

- `CONSTRAINTS.md`: update — durable rules: counters/stepper are input conveniences producing ordinary score changes through the existing path; stepper stages and never saves; counter taps apply immediately and discard typed drafts; preset set locked (+1/+5/+10/+25/−1/−5/−10); counter focus returns to the pressed control; no new state/storage and no seventh persist call site.
- `ARCHITECTURE.md`: update — the new UI entry into the score-save trigger, stepper draft semantics, new suite.
- `README.md`: update — user-visible quick-entry behavior + `npm run test:browser:quick-score`.
- `AGENTS.md`: not needed — no workflow or startup change. `CONTEXT.md`/`docs/domain-model.md`/`docs/build-brief.md`: not needed — they already state the rule; this spec implements it. `docs/risks-and-open-questions.md`: not needed (precedent — the Product Decisions section above is the closure record; earlier accepted v2 features did not edit that file).

## Implementation Plan

1. Land the wiring in `src/main.js` (constant, markup, handlers, bindings) with additive CSS; run `node --check src/main.js` and walk Scenarios 1–4 by hand in `npm run dev` at 1280×800 and 320×720.
2. Write `scripts/browser-quick-score-test.mjs` (Sessions A–E); wire `package.json` + `init.sh`; run the focused suite.
3. Run the full verification plan, confirm the byte-untouched floor via `git diff`, update README/ARCHITECTURE/CONSTRAINTS, record evidence.

## Implementation Tasks

- [ ] `src/main.js`: add `QUICK_SCORE_PRESETS = [1, 5, 10, 25, -1, -5, -10]`; render the `.score-stepper` wrapper (− / `#score-amount` / +, Decision 5 attributes) and the `.quick-scores` group (Decision 5 markup, Decision 6 names) inside `renderScoreForm`.
- [ ] `src/main.js`: implement `stepScoreDraft(direction)` and `handleQuickScore(amount)` per Decisions 2 and 4; add the success-false/true returns to `handleScoreSubmit`; bind `apply-quick-score` (per button), `step-score-up`, `step-score-down` in `bindActiveEvents`.
- [ ] `src/styles.css`: add `.score-stepper` (+ scoped `.score-amount-field` flex rule), `.stepper-action`, `.quick-scores*`, `.quick-score-action` (+ `.is-negative`); ≥44px; nothing existing modified.
- [ ] `scripts/browser-quick-score-test.mjs` — Session A (desktop counters): each of the seven presets on both players, exact accepted feedback per tap, totals/ranks, input cleared, `Last:` recomputes, focus on the pressed counter, envelope version 1 and gameCount growth only on counter saves; undo after a counter reverses exactly it and a second undo no-ops byte-identically. Session B (stepper): empty-baseline ±1, stepping from `5`/`-3`, clamps at ±1000000, byte-identical payload and unchanged feedback/totals across steps, stepped draft saves ordinarily, `0` draft keeps the exact zero message. Session C (draft interaction): typed `12` + +5 applies 5 and discards the draft; lone-sign draft; subsequent typed save works. Session D (320×720 + 1280×800): ≥44px targets, visible focus, accessible names for all nine new controls, group label, real-key Tab/Enter walk with repeat-press focus, no overflow, zero console errors. Session E (blocked write + boundaries): counter under `setItem`-throws updates in memory with the unchanged write notice and code-only warnings, no storage key; finished/replay views expose zero counters/stepper.
- [ ] `package.json` + `init.sh`: wire the new suite.
- [ ] Update `README.md`, `ARCHITECTURE.md`, `CONSTRAINTS.md`.
- [ ] Run the verification plan; record evidence in `feature_list.json`/`PROGRESS.md` (implementer/validator step, not this planner).

## Verification Plan

- `node --check` on touched sources and the new suite (covered by `init.sh`).
- `npm run test:score` — passes **unmodified** (proves `src/score.js` and the parse contracts are untouched).
- `npm run test:browser:quick-score` (new, real headless Chrome, 1280×800 + 320×720): Sessions A–E with `readSavedGamesState` proofs (byte-identity for stepper-only interactions and the undo no-op; no key under blocked writes).
- `CI=true ./init.sh` and `./init.sh` — required files, all syntax checks (including the new suite), and the full `npm run test` chain pass; exit without starting a server. All twelve pre-existing browser suites run green **byte-untouched** (a transient Chrome-launch timeout may be retried once).
- `npm run dev` probe — 200 for `/`, `/src/main.js`, `/src/styles.css`; 404 for `/AGENTS.md`.
- Screenshots (desktop panel with counters, 320px panel, post-counter feedback/recent entries) into the evidence dir; programmatic assertions carry the proof as established.
- Disclosure: physical keyboards/touch cannot be exercised headless; the keyboard contract is verified via CDP real-key walks, consistent with prior features.

## Evidence To Capture

- Exact commands and results for `test:score`, the new browser suite, `npm run test`, both gate modes, and the dev probe.
- A statement that `index.html`, `src/score.js`, `src/storage.js`, `src/standings.js`, `src/roster.js`, `src/game.js`, `scripts/smoke.mjs`, `scripts/static-server.mjs`, `scripts/browser-test-utils.mjs`, and all pre-existing suites are untouched (0-line diffs), the envelope version stayed `1`, and `persistActiveGameSnapshot` still has exactly six call sites.
- Screenshots + programmatic assertion summaries (exact accepted messages per counter, stepper byte-identity, draft-discard behavior, 320px targets/focus, accessible-name list).
- Appended `feature_list.json` evidence entries and a `PROGRESS.md` session-log entry.

## Validator Checklist

- [ ] Counters apply immediately through the unchanged save path (Decision 2): same parse gate, same `persistActiveGameSnapshot()` (still exactly six call sites), exact accepted success/rejection messages, no new copy, no new state or storage fields, envelope version 1.
- [ ] Preset set, order, and grouping match Decision 5 (+1/+5/+10/+25 then −1/−5/−10); negative chips tinted with the sign always visible; all nine new controls ≥44px.
- [ ] Stepper matches Decisions 1/4: stages the draft, 0 baseline for empty/unparseable, plain-integer output clamped to ±1,000,000, never saves (byte-identical payload across steps), save-side gate untouched.
- [ ] Counter-over-draft discards the draft (Decision 4); no summing; the typed-save flow and its focus contract are unchanged.
- [ ] Accessible names and focus match Decision 6 (counter names include the signed amount and selected player's name with correct pluralization; stepper names say "draft"; focus returns to the pressed counter on success; no new live region).
- [ ] Undo and recent entries treat counter changes identically (no special-casing); no-op undo stays byte-identical.
- [ ] Finished/replay/empty views expose no counters or stepper; `[data-recent-entries]` still has zero focusables; blocked-write behavior matches the accepted notice/copy with code-only warnings.
- [ ] All pre-existing suites are byte-untouched and green; `test:score` unmodified; smoke strings and design-system contracts hold; no unrelated feature work (no Current-Total card, no badges, no distribution, no podium actions, no decoration).
- [ ] README/ARCHITECTURE/CONSTRAINTS updated; evidence recorded with real commands and results.
