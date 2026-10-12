# Feature Implementation Spec: Restrict the score field to plain signed integers

## Source Feature

- `id`: `restrict-score-entry-input`
- `area`: `scoring`
- `depends_on`: [`play-again`] — `accepted` and merged into `main` (merge commit `a454941`, PR #14; verified: `origin/main` HEAD is `a454941` and branch `codex/restrict-score-entry-input` exists, clean, on top of it)
- `status`: `not_started` at planning time
- `source`: `feature_list.json` (last feature, added from a user report during resume-saved-game review)

## Goal

The score input is `<input type="number">`, and browsers accept `e`/`E` (plus `.` and signs) in number fields for scientific notation — so the scorekeeper can type the letter `e` and even save `1e3` as `1000`. This slice makes the score field reject letter characters at entry so only plain signed integers can be entered and saved, while preserving every accepted ergonomics and behavior around it: the mobile numeric keypad (with minus), the existing error paths (zero / decimals / out-of-range / non-number), focus behavior, live feedback, and persistence rules.

The fix is two coordinated layers: an entry guard on the input and a plain-format gate in the shared parser, so the pure module and the UI agree on one contract.

## Non-Goals

- No change to score bounds (±1,000,000), zero rejection, negative totals, `applyScoreChange`/`undoLastScoreChange` semantics, the change log, ranks, or anything in `src/storage.js`.
- No persistence changes: what may be saved changes only in that scientific notation no longer saves; save triggers, suppression, rollback, and notices are untouched.
- No type change away from `type="number"`, no `inputmode`/`pattern` attributes, no new CSS, no helper-copy redesign, no new dependencies, no new test files or npm commands.
- No changes to roster/setup inputs, the finish prompt, podium, replay, or any other view.
- No entry-time error announcements for blocked characters (see decision 5) and no paste-confirmation UI.

## Job Story

When I am entering points quickly at the table,
I want the score field to refuse anything that is not a plain signed integer (letters like `e`),
so I can trust that what is in the field is exactly what will be saved.

## Users And Permissions

- Scorekeeper: the only actor. Types or pastes signed integer points for the selected player. No sign-in, sharing, or remote access exists.

## Product Decisions Resolved For This Slice

These resolve the open items flagged in the `feature_list.json` notes (fix mechanism, `inputmode`/`pattern`/type change, and interplay with the documented `1e3` semantic-parse decision from `docs/specs/add-player-score.md`):

1. **Fix mechanism — keep `type="number"` + a `beforeinput` entry guard + a plain-format gate in `parseScoreAmount`.**
   - Keeping `type="number"` preserves the accepted mobile keypad *including the minus sign* (the reason add-player-score chose it), the existing spinbutton/number semantics for screen readers, and the current markup/tests.
   - `beforeinput` is the only single hook that covers typing, paste, drag-drop insertion, and IME insertions at one cancelable point. A `keydown` guard would miss paste/drop/autofill; an `input`-event sanitizer mutates content after insertion (cursor jumps, silent rewrites such as `1e3` → `13`); a `type="text"` switch would lose the signed keypad (`inputmode="numeric"` shows digits only on iOS, no minus) and still need JS validation; `pattern` does not apply to number inputs; `inputmode` on a number input is a no-op. All rejected.
2. **Entry-guard contract**: compute the prospective value (current value with the selection replaced by `event.data`) and allow the insertion only if it matches `/^[+-]?\d*\.?\d*$/`; otherwise `preventDefault()`. Consequences:
   - Letters (`e`, `E`, `a`, `x`, …), a second or misplaced sign, spaces, and commas can never be entered or pasted.
   - `.` stays typable and pastable (e.g. `2.5`) so the existing *typed* decimals path still reaches the save-side "Decimals are not allowed." message exactly as today — blocking `.` at entry would silently turn `2.5` into `2` or `25`.
   - Typing `1e3` therefore yields `13` (the `e` keystroke is dropped). This partial-application hazard is inherent to blocking `e` at entry and is accepted; scientific notation can no longer mean 1000 anywhere (decision 3).
   - Deletion input types and undo/redo types are never blocked; insertion types with `event.data === null` (e.g. some `insertReplacementText` autofill) are allowed and left to the save-side gate, so the guard never blocks what it cannot evaluate.
   - Blocked characters are rejected silently. This matches how `type="number"` already silently ignores keys like `a` today; no new feedback region or message is added.
3. **The `1e3` decision — the input restriction supersedes the documented semantic-parse decision.** The add-player-score spec's "Input mechanics" bullet ("Semantic parsing is used … so `1e3` is accepted as `1000`") was an artifact of `type="number"`'s scientific-notation support — the exact behavior the user reported. Scientific notation can no longer be saved by any path: typed `e` never enters the field; a pasted `1e3` is blocked wholesale by the guard (no silent `13`); a programmatically set `1e3` is rejected at save. `parseScoreAmount` gains one final gate after all existing checks: if the trimmed raw text is a finite in-range nonzero integer but does **not** match `/^[+-]?\d+$/`, return `{ error: "not-a-number" }` (existing message "Enter a whole number, like 10 or -3." — no new code or copy). Because the gate is ordered *after* the finite/integer/zero/range checks, every existing error mapping is preserved bit-for-bit (verified below).
4. **Paste/programmatic paths keep the accepted error paths**: programmatic or pasted `0` → zero message; `2.5` → decimals message; `±1000001` → out-of-range message; `abc` → "Enter an amount first." (browser sanitizes letters out of number inputs). Only exact-integer non-plain strings (`1e3`, `0x10`, `10.`) newly reject with the not-a-number message.
5. **Mobile keypad, accessibility, copy**: `type="number"` and all attributes stay, so the numeric keypad and screen-reader role/name/description are unchanged; the input keeps `aria-describedby="score-help score-feedback"`, and helper text "Use negative points for penalties. Whole numbers from -1000000 to 1000000." stays accurate — no copy change. Keyboard behavior is otherwise unchanged (digits and one leading sign type normally; focus and announcement behavior untouched).

## Acceptance Scenarios

### Scenario 1: Letters cannot be typed into the score field

Given an active game with the score panel open and focus in `#score-amount`
When the scorekeeper presses `e`, `E`, and other letters (real input pipeline, e.g. CDP key events), alone or after digits
Then the input value never contains a letter (unchanged for isolated letters), digits and one leading `+`/`-` still enter normally, and no error or console noise appears.

### Scenario 2: Plain signed integers still save

Given an active game with at least two players at zero
When the scorekeeper saves `+10` then `-3`
Then the totals update exactly as accepted (total 7, others 0), the input clears, focus stays in the input, and the success announcement is unchanged.

### Scenario 3: Existing rejections still work

Given an active game
When the scorekeeper enters (typed where typable, pasted or programmatic otherwise) `2.5`, `abc`, empty, `1000001`, `-1000001`, and `0` and saves
Then the exact accepted messages appear (decimals / "Enter an amount first." / out-of-range / zero), totals do not change, focus stays in the input, and no storage write happens.

### Scenario 4: Scientific notation can never be saved

Given an active game
When the scorekeeper types `1e3` (the `e` is dropped), pastes/inserts `1e3` into the field, or sets `1e3` programmatically and saves
Then the typed/pasted attempts never place `1e3` in the field, and the programmatic save is rejected with "Enter a whole number, like 10 or -3.", leaving totals and storage unchanged.

### Scenario 5: Mobile-size entry stays intact

Given a 320×720 viewport with the score panel stacked below the roster
When the scorekeeper enters scores and attempts letters via the real input pipeline
Then `type="number"` is still on the input (same mobile keypad contract), letters still cannot enter, ≥44px targets, visible focus, and no horizontal overflow are preserved, and the label/helper markup is unchanged.

## Repository Research

### Files Inspected

- `AGENTS.md`, `PROGRESS.md`, `feature_list.json` — workflow; this feature is the only remaining slice; its notes and verification items; play-again accepted.
- `CONTEXT.md`, `docs/build-brief.md`, `docs/domain-model.md` — score change = signed whole number; decimals excluded by the MVP brief.
- `docs/risks-and-open-questions.md` — bounds/decisions already resolved by add-player-score.
- `DESIGN.md` — active-game screen with signed whole-number score input; no visual change needed here.
- `CONSTRAINTS.md` — scoring bullet ("signed whole numbers with magnitude at most 1,000,000…") that this feature extends.
- `docs/specs/add-player-score.md` — documents the superseded `1e3` semantic-parse decision ("Input mechanics" bullet).
- `src/score.js` — `MAX_SCORE_ABS`, `parseScoreAmount` (trim → `Number()` → finite → integer → zero → range → success), `applyScoreChange`, `undoLastScoreChange`.
- `src/main.js` — `renderScoreForm` (the only `#score-amount`; `type="number" step="1"` min/max, `novalidate` form), `handleScoreSubmit` (`parseScoreAmount(input.value)` → `rejectScoreEntry` keeps focus/value), `bindActiveEvents` (re-bound on every render), `SCORE_ERROR_MESSAGES`, `escapeHtml`/`escapeAttribute`.
- `scripts/score-test.mjs` — the `1e3` unit assertion (line 46) and its neighbors: `"1e-3"` → `not-integer` (line 28), `"0.0"` → `zero` (line 33), `"1e30"` → `out-of-range` (line 38) — all remain valid under the ordered gate.
- `scripts/browser-score-test.mjs` — the semantic-1e3 block (lines 127–131, load-bearing for totals `["1005","7"]` used downstream), `fill()`-based `savePoints`, and the summary log (line 281).
- `scripts/browser-test-utils.mjs` — `fill()` sets `element.value` directly (no beforeinput), while `Input.dispatchKeyEvent` (used by suites' real-key helpers) and `Input.insertText` go through the real input pipeline where `beforeinput` is cancelable; `readSavedGamesState` for no-write assertions.
- `init.sh`, `package.json` — `node --check` list and `npm run test` chain already cover all files this feature touches; no new files planned.

### Existing Patterns To Follow

- Pure, DOM-free logic lives in `src/score.js` and is unit-tested in Node; DOM wiring lives in `src/main.js` (`bindActiveEvents`).
- Browser tests assert observable outcomes (values, feedback, totals, storage, overflow) via CDP on real headless Chrome; real-key helpers use `Input.dispatchKeyEvent`.
- Honest test updates only: changed behavior updates assertions with explanatory comments; historical evidence strings in `feature_list.json` are never rewritten (new evidence is appended).
- `./init.sh` stays a non-blocking gate: syntax checks + full `npm run test`, never starting `npm run dev`.

### Current Gaps

- No entry-time character restriction exists; `parseScoreAmount` accepts any `Number()`-parseable integer, including `1e3`.
- No real-key (non-Enter) typing helper exists in the score suite; the guard tests need one (podium/play-again suites already demonstrate the pattern).

## Technical Approach

1. **`src/score.js` — parser gate + exportable predicates** (pure, Node-testable):
   - Add `isPlainIntegerText(text)`: `true` iff `String(text).trim()` matches `/^[+-]?\d+$/`.
   - Add `isPlainScoreDraft(text)`: `true` iff `String(text)` matches `/^[+-]?\d*\.?\d*$/` (the entry/draft pattern; allows empty, a lone sign, and a transient decimal that can never save).
   - In `parseScoreAmount`, after the existing range check and before returning `{ amount }`: if `!isPlainIntegerText(text)` return `{ error: "not-a-number" }`. No other code or message changes.
2. **`src/main.js` — entry guard**: in `bindActiveEvents`, attach a `beforeinput` listener to `#score-amount` when present. For insertion input types with a string `event.data`: read `selectionStart`/`selectionEnd` (defensively: if unavailable, evaluate `event.data` alone), build the prospective value, and `event.preventDefault()` when `!isPlainScoreDraft(prospective)`. Never block deletion/undo types; allow insertion types with null `data`. No markup, style, or feedback changes.
3. **Honest test updates** (exact existing assertions):
   - `scripts/score-test.mjs` line 40 comment ("including semantic forms") and line 46 `assert.deepEqual(parseScoreAmount("1e3"), { amount: 1000 })` → `1e3` now expects `{ error: "not-a-number" }`; add `0x10`/`10.` → `not-a-number`, `+10`/`-0`-style confirmations, and `isPlainScoreDraft` cases. Lines 28/33/38 must remain untouched and green.
   - `scripts/browser-score-test.mjs` lines 127–131: replace `savePoints(cdp, "1e3")` with `savePoints(cdp, "1000")` (Sam 5 → 1005, so the downstream totals `["1005","7"]` at lines 130/149 and `["7","-5"]` at line 161 stay valid), then add: real-key `e`/`E`/`x` blocked (value unchanged), `Input.insertText` "1e3" blocked, and programmatic `fill` "1e3" → save rejected with the not-a-number message, totals unchanged, no storage write. Update the summary log (line 281) and the desktop/mobile evidence.
   - `feature_list.json` evidence entries for add-player-score stay as history; the implementer appends new entries for this feature.

## Expected File Changes

- `src/score.js` — modify; add `isPlainIntegerText`/`isPlainScoreDraft` and the parse gate.
- `src/main.js` — modify; `beforeinput` guard bound to `#score-amount` in `bindActiveEvents`.
- `scripts/score-test.mjs` — modify; honest `1e3` update + new gate/draft cases.
- `scripts/browser-score-test.mjs` — modify; replace the semantic-1e3 save, add letter-blocking/scientific-notation-rejection scenarios (desktop + 320px), update summary.
- `README.md` — modify; one usage sentence: the score field accepts plain signed integers only (letters like `e` are rejected).
- `ARCHITECTURE.md` — modify; `src/score.js` and `src/main.js` descriptions gain the entry-guard/plain-format contract.
- `CONSTRAINTS.md` — modify; extend the scoring bullet: the score field must reject non-plain-integer characters at entry and `parseScoreAmount` must accept only plain signed integer text.
- No changes: `index.html`, `src/styles.css`, `src/roster.js`, `src/standings.js`, `src/game.js`, `src/storage.js`, `scripts/static-server.mjs`, `scripts/smoke.mjs`, `init.sh`, `package.json` (all already cover these files; no new modules or commands).

## Visual Design Impact

- UI involved: yes (an existing control's behavior only).
- Design source: `DESIGN.md`.
- Screens or states affected: the score-entry input in the active view. No visual, layout, token, focus-style, or copy change; the rejected characters simply never appear.
- New design artifact required: no.

## Durable Documentation Impact

- `ARCHITECTURE.md`: update — the scoring helper description gains the plain-integer entry/parse contract.
- `CONSTRAINTS.md`: update — durable MUST so future slices keep the field plain-integer-only and the parser gate ordered after the existing checks.
- `AGENTS.md`: not needed — no workflow, command, or repo-rule change.
- `README.md`: update — user-facing usage sentence.
- Other docs: `docs/specs/add-player-score.md` — not rewritten (it is a historical planning artifact; this spec is the new source of truth for the input contract). `CONTEXT.md`/`docs/domain-model.md` — not needed (a score change is already a signed whole number).

## Implementation Plan

1. Add the two predicates and the parse gate to `src/score.js`; update `scripts/score-test.mjs` honestly (green first at the unit level).
2. Add the `beforeinput` guard in `src/main.js`; verify by hand in `npm run dev` that `e` cannot be typed while `+10`/`-3` still save.
3. Update `scripts/browser-score-test.mjs` (desktop + mobile), then README/ARCHITECTURE/CONSTRAINTS; run the full gate and record evidence.

## Implementation Tasks

- [ ] `src/score.js`: export `isPlainIntegerText` and `isPlainScoreDraft`; add the final plain-format gate to `parseScoreAmount` (after finite/integer/zero/range checks) returning `not-a-number`.
- [ ] `scripts/score-test.mjs`: change line 46 to expect `{ error: "not-a-number" }` for `1e3`; add `0x10`, `10.`, and draft-pattern cases; keep lines 28/33/38 and all other assertions untouched.
- [ ] `src/main.js`: bind the `beforeinput` guard (prospective value + `isPlainScoreDraft`, insertion types only, defensive null selection/data handling) in `bindActiveEvents`.
- [ ] `scripts/browser-score-test.mjs`: swap `1e3` → `1000` save with updated comment; add real-key letter blocking (e/E/x), `Input.insertText` "1e3" blocked, programmatic "1e3" rejection (message, totals, storage, focus); mirror a letter check in the 320px session; update the summary log.
- [ ] Update `README.md`, `ARCHITECTURE.md`, `CONSTRAINTS.md`.
- [ ] Run the verification plan and record evidence in `feature_list.json`/`PROGRESS.md` (implementer/validator step).

## Verification Plan

- `node --check src/score.js src/main.js scripts/score-test.mjs scripts/browser-score-test.mjs` — all pass.
- `npm run test:score` — all pre-existing cases green unchanged except the honest `1e3` update; new gate/draft cases pass.
- `npm run test:browser:score` — real headless Chrome: `e`/`E`/`x` real-key attempts leave the value unchanged; `+10`/`-3` → 7; rejections (2.5/abc/empty/±1000001/0) unchanged; programmatic `1e3` rejected with "Enter a whole number, like 10 or -3." and no storage write; `Input.insertText` "1e3" blocked; 320px checks pass; no console errors.
- `npm run test` — full chain (units, smoke, all nine browser suites) passes with only the score suites changed.
- `./init.sh` and `CI=true ./init.sh` — standard gate passes and exits without starting a server; `init.sh` must keep running the non-blocking checks and only print the manual `npm run dev` follow-up. (A transient Chrome-launch timeout has occurred before; rerun once before investigating.)
- `npm run dev` probe — 200 for `/`, `/src/score.js`, `/src/main.js`; 404 for `/AGENTS.md`.
- Responsive/mobile: the automated 320×720 session covers stacking, targets, focus, overflow, and the letter-block. A physical mobile keypad cannot be exercised headless; keypad behavior is preserved by construction (`type="number"` kept, no `inputmode`), to be observed in any manual device pass — same disclosure as add-player-score.
- Accessibility: assert in the suite that the label (`Points for {name}`), helper text, `aria-describedby`, focus retention, and live-region behavior are unchanged; letters-blocked is silent (no announcement required).

## Evidence To Capture

- Exact commands and results for `npm run test:score`, `npm run test:browser:score`, `npm run test`, `./init.sh`, `CI=true ./init.sh`, and the `npm run dev` probe.
- Browser output/screenshots from the updated score suite (desktop + 320px), including the letter-block and `1e3`-rejection assertions.
- A statement that `parseScoreAmount` now rejects non-plain-integer scientific notation and that no other module, storage rule, or save trigger changed.
- Appended evidence entries in `feature_list.json` and a `PROGRESS.md` session-log entry (implementer/validator step, not this planner).

## Validator Checklist

- [ ] Implementation stays within scope: input guard + parse gate + honest test/doc updates only; no storage, save-trigger, bounds, or visual changes.
- [ ] Letters (`e`, `E`, others) cannot be typed, pasted/inserted, or saved via the score field; no letter ever reaches a saved amount.
- [ ] `+10`/`-3` still save (total 7); decimals, zero, out-of-range, and non-number rejections keep their exact accepted messages and no-write behavior.
- [ ] `1e3` (and equivalents like `0x10`, `10.`) is rejected with `not-a-number`; the existing `"1e-3"` → `not-integer`, `"0.0"` → `zero`, `"1e30"` → `out-of-range` unit cases are untouched and green.
- [ ] `type="number"`, label, helper text, `aria-describedby`, focus behavior, and 320px layout are unchanged and asserted.
- [ ] `scripts/browser-score-test.mjs` and `scripts/score-test.mjs` updates are honest (no weakened assertions; downstream totals still verified).
- [ ] `README.md`, `ARCHITECTURE.md`, `CONSTRAINTS.md` updated; `feature_list.json` evidence and `PROGRESS.md` record real checks; no unrelated behavior added.
