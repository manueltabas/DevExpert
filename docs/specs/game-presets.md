# Feature Implementation Spec: Pre-prepared game setups with preset scoring

## Source Feature

- `id`: `game-presets`
- `area`: `ui`
- `depends_on`: `refine-podium-and-history-modal` (accepted and merged to `main` in PR #24)
- `status`: `not_started` at planning time
- `source`: `feature_list.json`
- `sizing`: one fixed data catalogue plus one setup flow and one active-scoring flow; no split needed.

## Goal

New Game gains a radio-card picker above the title that offers six approved setups: Custom (default), Flip 7, Catan, Ticket to Ride, 7 Wonders, and Yahtzee. The selected preset supplies player bounds/defaults, a title default, a quick-action set (including Flip 7's ×2 multiplier), sign policy, and informational hints. Setup clamps or resizes the roster safely, auto-fills only an empty/auto-filled title, and carries the preset into the active game; the active score panel uses the same preset for quick actions, negative-input rejection, stepper floor, and target hints.

The optional `presetId` is stored only for non-custom games. Custom and pre-feature games omit it and behave exactly as today; the storage envelope stays version 1. Preset games survive resume/reload, and Play again copies a valid preset while still starting untitled. Targets are hints only and never finish a game automatically.

## Non-Goals

- No user-defined/personalized presets, per-game quick-action editing, or a full board-game catalog.
- No auto-finish, target enforcement, win detection, round/turn tracking, or target-driven podium.
- No preset badges/labels on Dashboard cards or history modals.
- No changes to ranking, undo, score-distribution, finish/podium, history-dialog, title-edit, or replay-untitled semantics.
- No new storage field for custom games, migration, envelope-version change, save trigger, or ranking/change-log field.
- No changes to the visual style outside the picker, selected detail, preset hint, and multiplier chip.
- No roster reuse, "Fill group", one-tap default games, or other mockup decoration.

## Job Story

When our table is about to play a known game,
I want the setup and score buttons to already match that game's player count, scoring direction, and target,
so I can start recording the round faster without mentally translating a generic scorepad.

## Users And Permissions

- Scorekeeper: the only actor. Preset selection is local, browser-only setup state until Start game; it uses the existing localStorage rules and adds no permissions, accounts, network calls, or analytics.

## Product Decisions Locked For This Slice

### Decision 1 — Catalogue and exact setup data

| id | label | Players (min–max, default) | Quick actions (in order) | Negative scores | Target/hint |
|---|---|---|---|---|---|
| `custom` | Custom | 2–20, default 2 | +1, +5, +10, +25, −1, −5, −10 | allowed | none |
| `flip-7` | Flip 7 | 3–20, default 3 | ×2, then +5, +10, +15, +20, +25, +50 | rejected | 200 points |
| `catan` | Catan | 3–6, default 4 | +1, +2, +3, +4, +5 | rejected | 10 VP; base 3–4, 5–6 expansion |
| `ticket-to-ride` | Ticket to Ride | 2–5, default 4 | +1, +5, +10, +15, +20, −5, −10 | allowed | none |
| `7-wonders` | 7 Wonders | 3–7, default 4 | +1, +3, +5, +10, +20 | rejected | none |
| `yahtzee` | Yahtzee | 2–20, default 4 | +5, +10, +25, +30, +40, +50 | rejected | none |

- Picker order is the table order. Default titles are the preset labels (`Flip 7`, `Catan`, `Ticket to Ride`, `7 Wonders`, `Yahtzee`); Custom's default title is empty.
- Flip 7 hint order is locked: enter the number-card sum, tap ×2, add the +15 bonus, then Save. Bust rounds add nothing. Yahtzee zero categories add nothing. Both are covered by "zero remains invalid" — the scorekeeper simply does not enter/tap anything for that round.
- Targets are informational only: no automatic finish, no disabling of further scoring, no win state.
- Zero is invalid for every preset and Custom, and no zero quick action exists.

### Decision 2 — `src/presets.js` is the single catalogue

Create a dependency-free leaf module exporting:

- `CUSTOM_PRESET_ID = "custom"` and `GAME_PRESETS` (frozen array in picker order).
- `getPreset(presetId)`: returns the matching preset; `undefined`, `null`, `"custom"`, or an unknown id returns the Custom preset. This is the universal safe fallback.
- `normalizePresetId(presetId)`: returns the known non-custom id, or `null` for Custom/unknown. Used when deciding what to store and replay.
- `allowsNegative(presetId)`: boolean from the resolved preset.
- `resolvePlayerCount({ presetId, currentCount = 0, touched = false })`: untouched roster → `defaultPlayers`; touched roster → clamp `currentCount` between the preset's min and max.

Each preset record contains `id`, `label`, `minPlayers`, `maxPlayers`, `defaultPlayers`, `defaultTitle`, `allowsNegative`, `quickActions`, `target` (or `null`), `setupHint`, and `scoreHint` (or `null`). Quick actions are data objects: `{ type: "add", amount }` or `{ type: "multiply", factor: 2 }`. No preset logic may be duplicated in `main.js`.

### Decision 3 — Preset-aware roster creation and validation

- `validateRoster(rows, presetId = CUSTOM_PRESET_ID)` resolves the preset and enforces its min/max while keeping the existing name/color checks. Custom retains today's exact messages; preset failures read `Add at least {min} players for {label}.` / `Keep the table to {max} players or fewer for {label}.`
- `createGame({ title, rows, now, idSeed, presetId })` validates against the resolved preset. It stores `presetId` only when the resolved preset is non-custom; Custom/unknown input omits the field. Invalid roster returns the existing `{ game: null, validation }` shape. No other game fields change.
- `MIN_PLAYERS`/`MAX_PLAYERS` remain the Custom constants used by the existing default setup.
- `finishGame` and `renameGame` preserve `presetId` by spreading the game; they gain no preset-specific logic.
- `replayGame` passes the original `presetId` through `createGame` (so a valid non-custom preset is copied and unknown/custom is omitted), still passes `title: ""`, and still copies only presentation. A preset replay therefore opens untitled with the same preset quick actions/sign rules.

### Decision 4 — Setup picker, selected detail, and title auto-fill

- Add `state.presetId`, `state.rosterTouched`, and `state.titleAutoFilled`. `resetSetup()` resets them to `custom`, `false`, and `false`; nav New Game preserves the scratchpad; hero/empty-state New game use the existing full reset.
- DOM order inside the setup panel: heading → **preset picker fieldset** (legend `Game preset`, six native radio cards in catalogue order) → **selected detail** (`aria-live="polite"`, shows range, target/hint, and a non-interactive preview of quick actions) → title → roster. The picker is above the title as approved.
- Selecting a preset:
  1. resolves the preset and sets `state.presetId`;
  2. if `state.rosterTouched` is false, replaces the roster with `createSetupRows(defaultPlayers)` and sets `nextRowNumber = defaultPlayers + 1`;
  3. if touched, resizes to `resolvePlayerCount(...)`, truncating only trailing rows when above the max and appending blank rows (new unique ids, positional colors) when below the min; retained rows keep names/colors/order literally;
  4. if `state.title.trim() === "" || state.titleAutoFilled` is true, writes the preset's `defaultTitle` (empty for Custom) and sets `titleAutoFilled` to whether a default title was written; otherwise a user title is never overwritten;
  5. clears setup errors/limit text, re-renders, and returns focus to the selected radio.
- Any title input event sets `state.titleAutoFilled = false`. Any name input, color change, Add player, or Remove player sets `state.rosterTouched = true`. Preset-driven resizing never sets `rosterTouched`.
- Status pill, Add/Remove disabled states, helper text, and `limitMessage` all use the resolved preset's max/min (e.g. `4/6 players`, `Start with 3 to 6 players...`). Custom keeps its current visible behavior.
- On submit, call `createGame({ ..., presetId: state.presetId })`; the active game then owns the preset. No setup interaction writes storage.
- Focus/tab contract: hero and active-empty New game focus the checked preset radio (`#game-preset-custom` after reset); nav New Game focuses the setup heading and its next Tab enters the checked radio; a second Tab reaches `#game-title`. Native radio arrow keys change selection. This supersedes the old direct title focus/Tab assumption and requires honest test updates.
- A touched roster reduced below/above a preset's range is clamped visibly by the player count/status pill. Truncating trailing rows is accepted pre-game behavior; no confirmation dialog is added.

### Decision 5 — Active game preset behavior

- The active view resolves `getPreset(state.activeGame?.presetId)`. Missing, Custom, old, or unknown ids all render the Custom signed actions and allow negatives.
- The selected preset drives the quick-action list, the stepper floor, the input `min` attribute, the helper text, and an optional visible `.preset-hint` in the score panel. The hint is included in the score input's `aria-describedby` when present.
- Add actions stage the shared draft exactly as today (no render, feedback, rank, recent entry, or save). Negative add actions are rendered only for Custom/Ticket to Ride.
- Flip 7 renders one non-negative multiplier action with visible label `×2` (`data-action="multiply-score-draft"`, accessible name `Double the points draft for {name}`) before its six positive add actions. It doubles the current draft (`12 → 24`), clamps to `MAX_SCORE_ABS`, writes plain integer text, never adds to a total, never saves, and keeps focus on the ×2 control. The locked example is `12 → ×2 → 24 → +15 → 39 → Save`, producing one ordinary change of 39.
- For non-negative presets the input uses `min="0"`, the stepper/draft helper clamps the draft to `[0, MAX_SCORE_ABS]` (a typed negative baseline is treated as 0 for the next step/action), and typed/pasted negative text is rejected at Save with `This preset only adds points. Enter a positive amount.` The text is not silently rewritten in the field.
- Add `negative-not-allowed` to `SCORE_ERROR_CODES`; `applyScoreChange` rejects a negative amount when `getPreset(game?.presetId).allowsNegative` is false, after the existing player/integer/zero/range checks. Zero continues to return the `zero` code for every preset; its visible copy stays the existing `Zero adds no points. Enter a positive or negative amount.` for Custom/Ticket to Ride and reads `Zero adds no points. Enter a positive amount.` for non-negative presets. No zero action exists.
- Targets are rendered only as hints (`Target 200 points`, `Target 10 VP`) and do not invoke `finishGame`, alter status, disable scoring, or open the podium.

### Decision 6 — Persistence, fallback, and replay

- Saved games carry `presetId` only for valid non-custom presets. Custom and pre-feature records omit it; unknown stored ids fall back to Custom behavior without a load-time rewrite. The envelope remains `{ version: 1, games: [...] }`; `src/storage.js` is unchanged.
- Resume/reload restore the saved preset for quick actions, sign rules, and hints. Finish/rename preserve it. Play again copies a valid preset id but remains untitled (`title: ""`); Custom/unknown replays omit the field. The finished original stays byte-identical.

## Acceptance Scenarios

### Scenario 1: Six-option picker and Custom default

Given a fresh browser profile on New game
When setup renders
Then the picker is above the title and contains exactly Custom, Flip 7, Catan, Ticket to Ride, 7 Wonders, Yahtzee in that order; Custom is checked; the detail shows 2–20 players, the signed Custom quick actions, and no target; the title is empty; two blank rows render; and no storage key was written.

### Scenario 2: Each preset supplies its default roster, limits, title, actions, and hint

Given an untouched setup with an empty title
When the scorekeeper selects each preset in turn
Then rows/title/status/helper/limits become: Flip 7 3 rows, title `Flip 7`, 3/20, remove disabled, ×2 then +5/+10/+15/+20/+25/+50, target 200 and the locked hint order; Catan 4 rows, title `Catan`, 4/6, +1..+5 only, target 10 VP with the 3–4 base / 5–6 expansion note; Ticket to Ride 4 rows, title `Ticket to Ride`, 4/5, the signed seven-action set; 7 Wonders 4 rows, title `7 Wonders`, 4/7, +1/+3/+5/+10/+20; Yahtzee 4 rows, title `Yahtzee`, 4/20, +5/+10/+25/+30/+40/+50 and the zero-category note; and Custom returns to 2 rows, an empty title, 2/20, and the signed Custom set.

### Scenario 3: Title auto-fill never overwrites a user title

Given a preset auto-fills `Catan` and the user then types `Friday night`
When the scorekeeper switches to Ticket to Ride
Then the title stays `Friday night`. Given the title is empty or still the previous preset's auto title, switching to another preset replaces it with that preset's default title; switching to Custom clears an auto-filled title to empty. Any manual title input disables further auto-fill until the title is blanked again. Auto-filled titles are ordinary stored titles at Start game; no auto-fill flag is persisted.

### Scenario 4: Roster defaults, minimums, maximums, and preserved names/colors

Given an untouched roster, selecting Flip 7 creates exactly 3 blank rows; selecting Catan creates exactly 4.
Given a touched roster of 2 named players, selecting Flip 7 appends one blank row, preserves both names/colors, and disables Remove at the 3-player minimum.
Given a touched roster of 10 named players, selecting Catan keeps the first 6 rows with their names/colors, removes only the trailing 4, and disables Add at the 6-player maximum. Adding/removing within range, the status pill, helper text, and limit messages all follow the active preset. Start game with a blank appended name fails validation; a full reset returns to Custom with two empty rows.

### Scenario 5: Every preset starts and persists with its own scoring contract

Given valid names within each preset's range
When a game is started for each of the six setups
Then Custom stores no `presetId`; the five named presets store their ids in a version-1 envelope; the active score panel renders exactly that preset's quick actions, helper/sign text, input `min`, and target hint. Save/undo, ranking, recent entries, distribution, finish, and podium behavior remain the accepted shared behavior. Resume and reload preserve the preset and its active controls.

### Scenario 6: Flip 7 ×2 and informational targets

Given a Flip 7 game with Alex selected
When the scorekeeper enters `12`, activates ×2 (draft `24`, totals/storage unchanged, focus remains on ×2), adds `+15` (draft `39`), and chooses Save points
Then one ordinary change of 39 is written and the accepted success feedback appears. A ×2 from an empty/zero draft shows `0` (saving it still reports the exact zero error). Further scoring can carry a total past 200; the game stays active, the finish control remains available, and no podium or auto-finish occurs — the target is a hint only.

### Scenario 7: Non-negative sign enforcement and skipped zero rounds

Given Catan, Flip 7, 7 Wonders, or Yahtzee
When the scorekeeper types a negative amount and saves
Then `This preset only adds points. Enter a positive amount.` appears in the polite feedback region, totals/storage stay unchanged, and no change is logged. The stepper cannot go below 0 (pressing − at 0 stays 0), the input exposes `min="0"`, and no negative quick action renders. Ticket to Ride and Custom still accept signed negatives through their negative quick actions and the Save path. Saving `0` (including a Yahtzee zero category) still returns the zero error and writes nothing; its message stays `Zero adds no points. Enter a positive or negative amount.` for Custom/Ticket to Ride and reads `Zero adds no points. Enter a positive amount.` for non-negative presets. No quick action with amount 0 exists.

### Scenario 8: Scratchpad, back-compatibility, and replay

Given setup with Flip 7 selected, a user title, and named rows
When the scorekeeper visits Dashboard and returns through nav New Game
Then the preset, title, and roster are preserved with no storage write; hero/active-empty New game resets to Custom/empty/two rows. Given a pre-feature or Custom saved game, it renders Custom signed actions and omits `presetId`; an unknown stored id also falls back to Custom. Given a finished preset game, Play again creates a new active untitled game with the same valid `presetId`, while the original's stored entry stays byte-identical. Given a finished old/custom game, Play again omits `presetId`.

### Scenario 9: 320px, keyboard, and full gate

Given 320×720 and 1280×800 viewports
Then six picker cards are ≥44px with a visible focus ring, two columns at 320px, no horizontal overflow; arrow keys move the radio selection; the detail and title update; the score panel's add/multiply controls are ≥44px and wrap without overflow; and there are zero uncaught console errors. The full gate passes: `npm run test:presets`, updated unit suites, `npm run test:browser:presets`, `npm run test`, `./init.sh`, and `CI=true ./init.sh`, exiting without starting a server.

## Repository Research

### Files Inspected

- `AGENTS.md`, `PROGRESS.md`, `feature_list.json` (`game-presets`, status `not_started`; dependency `refine-podium-and-history-modal` accepted/merged PR #24), `CONTEXT.md`, `docs/build-brief.md`, `docs/domain-model.md`, `docs/risks-and-open-questions.md`, `DESIGN.md` and the five v2 mockups.
- `src/roster.js` — `MIN_PLAYERS`/`MAX_PLAYERS`, `createSetupRows`, `createSetupRow`, `colorForIndex`, `validateRoster` (fixed 2–20), `createGame` (title/status/players, no preset).
- `src/game.js` — `finishGame` spreads only `status`; `replayGame` maps rows and calls `createGame` with `title: ""`; `renameGame`; exact `GAME_ERROR_CODES`.
- `src/score.js` — ordered `parseScoreAmount` gates, `applyScoreChange` zero/range/safe guards, `undoLastScoreChange`, recent entries.
- `src/storage.js` — envelope version 1 and per-entry guard (no change needed; optional fields pass through).
- `src/main.js` — `state` scratchpad, `renderSetup`/`renderSetupRow`/`bindSetupEvents`, hard-coded `QUICK_SCORE_PRESETS`, `renderActiveGame`, `renderScoreForm`, `renderQuickScores`, `applyDraftDelta`, `handleScoreSubmit`, `handleUndo`, `handleResume`, `handlePlayAgain`, `resetSetup`, setup focus calls.
- `src/styles.css` — setup panel/status/player-row/color-picker, score panel/stepper/quick-counter styles, 720/480/360 breakpoints, focus and reduced-motion rules.
- `scripts/static-server.mjs` — **explicit public-file allowlist**; `src/presets.js` must be added or the app cannot load.
- `scripts/smoke.mjs` — asserts the served module set; add `/src/presets.js`.
- Tests: `scripts/roster-test.mjs`, `game-test.mjs`, `score-test.mjs`, `storage-test.mjs`, `browser-roster-test.mjs`, `browser-design-system-test.mjs` (interactive-target survey and New game focus), `browser-game-title-test.mjs` (setup Tab walk), `browser-quick-score-test.mjs` (Custom two-row contract), `browser-play-again-test.mjs` (Custom replay storage shape), `browser-test-utils.mjs`, `package.json`, `init.sh`.
- Git: `/Users/mtabas/Documents/DevExpert` on `codex/game-presets`; `feature_list.json` contains the new uncommitted `not_started` entry; no `docs/specs/game-presets.md` existed before this spec.

### Existing Patterns To Follow

- Pure leaf modules (`roster`, `score`, `standings`, `game`, `storage`) with focused unit scripts; UI-only derivation in `main.js`; additive CSS using existing tokens.
- One focused CDP browser suite per feature, isolated Chrome profiles, 1280×800 + 320×720, byte-identical `readSavedGamesState` proofs, real-key walks, ≥44px/overflow/console checks, temp-dir screenshots.
- Per-render bindings, native form controls, focus-follows-the-action, polite live regions, and honest supersession comments when an accepted assertion must change.
- `static-server`/`smoke`/`init.sh`/`package.json` are the wiring points for a new module and test suite.

### Current Gaps

- No preset module or picker; quick actions and 2–20 limits are hard-coded in `main.js`/`roster.js`; score entry cannot reject negatives by setup; saved/replayed games carry no preset; the static server allowlist and smoke test do not include a presets module.

## Technical Approach

1. **`src/presets.js`** — define the frozen six-record catalogue and the helpers in Decision 2. Keep it import-free so `roster.js`, `score.js`, and `main.js` can all depend on it without cycles.
2. **`src/roster.js`** — import `CUSTOM_PRESET_ID`/`getPreset`; make `validateRoster(rows, presetId)` use the resolved min/max; make `createGame` accept `presetId`, validate against it, and store it only when non-custom. Keep `MIN_PLAYERS`/`MAX_PLAYERS` for the Custom path.
3. **`src/score.js`** — import `getPreset`; append `negative-not-allowed` to `SCORE_ERROR_CODES` and add the negative guard in `applyScoreChange` after existing guards. No parse, undo, or recent-entry changes.
4. **`src/game.js`** — pass `presetId: game.presetId` in `replayGame`; no other lifecycle change (createGame normalizes/copies/omits).
5. **`src/main.js` setup** — add the three state fields; render the picker/detail above the title; implement `selectPreset` with untouched-default vs touched-clamp roster handling, title auto-fill, disabled Add/Remove, dynamic status/helper, and focus return; pass `presetId` to `createGame`; reset the three fields in `resetSetup`; set `rosterTouched` from existing setup interactions; update full-reset focus to the checked radio.
6. **`src/main.js` active** — resolve `const preset = getPreset(game.presetId)`; render quick actions from `preset.quickActions` (multiplier row first, then positive/negative rows, empty rows omitted); render the hint; make the input min/helper preset-aware; make `applyDraftDelta` clamp to the preset floor; add `handleMultiplyDraft(factor)`; map `negative-not-allowed` and the preset-aware zero copy in the rejection path. Keep the existing Custom labels/selectors and the single save path.
7. **`src/styles.css`** — additive `.preset-picker`, `.preset-options`, `.preset-card` (selected/focus-within), `.preset-detail`, `.preset-chip`, `.preset-hint`, and `.quick-score-action.is-multiply`; flex-wrap quick rows so ×2 + six additions fits 320px. No existing selector/token/breakpoint changed.
8. **Wiring and tests** — add `src/presets.js` to the static-server allowlist and smoke assertions; add `scripts/presets-test.mjs` and `scripts/browser-presets-test.mjs`; update the named existing suites honestly; add npm scripts and `init.sh` required/node-check entries.
9. **Docs** — update README, ARCHITECTURE, CONSTRAINTS, DESIGN, build-brief, domain-model, risks, and the CONTEXT glossary as listed below.

## Implementation Risks

- Selecting a smaller preset truncates trailing rows from a touched roster, so a scorekeeper can lose names entered beyond the new maximum. This is accepted pre-game behavior; the count/status pill must make the reduction visible, and the new suite must prove retained rows keep names/colors.
- Setup is shared by many accepted suites. Adding focusables above the title intentionally changes the full-reset focus target and the setup Tab order; the honest updates are limited to the design-system and game-title suites, with Custom-path regressions rerun.
- `src/presets.js` is a new public module: forgetting the static-server allowlist, smoke assertion, or `init.sh` required/`node --check` entries would break the app or the gate even if unit tests pass.
- Sign and zero copy can contradict each other if handled statically; the rejection path must select the non-negative zero copy and the `negative-not-allowed` copy from the active preset while keeping the Custom/Ticket to Ride text unchanged.
- Auto-title ownership is not persisted; the in-memory flag and blank-title rule must be tested across preset switches, manual edits, scratchpad navigation, and full reset so a user title is never overwritten.
- Unknown or legacy `presetId` values must degrade safely to Custom in scoring, setup fallback, and replay without rewriting stored data.
- Flip 7 ×2 and non-negative draft floors are draft-only semantics; they must not be mistaken for an additional score change or a new save trigger.
- A target hint must never be read as a finish rule; the suite must prove scoring past 200/10 keeps the game active and the finish control available.
- Six picker cards and up to seven quick actions must fit 320px with ≥44px targets; flex-wrap and reduced columns are required, not optional polish.

## Expected File Changes

- `src/presets.js` — create; frozen catalogue and pure helpers.
- `src/roster.js` — modify; preset-aware `validateRoster`/`createGame`, optional stored `presetId`.
- `src/score.js` — modify; `negative-not-allowed` code and `applyScoreChange` guard.
- `src/game.js` — modify; replay passes `presetId`.
- `src/main.js` — modify; setup picker/detail/title/roster/focus, active quick actions/hint/sign floor/multiplier, reset.
- `src/styles.css` — modify additively; picker/detail/hint/multiplier/wrap.
- `scripts/static-server.mjs` — modify; expose `src/presets.js`.
- `scripts/smoke.mjs` — modify; assert `src/presets.js` is served.
- `scripts/presets-test.mjs` — create; catalogue/helper unit coverage.
- `scripts/browser-presets-test.mjs` — create; Scenarios 1–9 across isolated Chrome sessions.
- `scripts/roster-test.mjs` — honest update; preset bounds, stored/omitted `presetId`, fallback.
- `scripts/score-test.mjs` — honest update; negative-not-allowed precedence and zero preservation.
- `scripts/game-test.mjs` — honest update; replay copies a valid preset and omits custom/unknown.
- `scripts/browser-design-system-test.mjs` — honest update; add preset cards to the ≥44px survey and expect full-reset focus on the checked preset radio.
- `scripts/browser-game-title-test.mjs` — honest update; the 320px Tab walk is heading → checked preset radio → `#game-title`.
- `scripts/browser-play-again-test.mjs` — honest update; assert the Custom replay omits `presetId` (preset replay coverage lives in the new suite).
- `scripts/browser-roster-test.mjs` / `browser-quick-score-test.mjs` / `browser-score-test.mjs` — expected byte-untouched Custom-path regressions; rerun and confirm green. If a structural assertion genuinely breaks, update it with a supersession comment, never weaken it.
- `package.json` — add `test:presets`, `test:browser:presets`, and chain both into `test`.
- `init.sh` — require `src/presets.js`; add `node --check` for the new module and both new suites.
- `README.md`, `ARCHITECTURE.md`, `CONSTRAINTS.md`, `DESIGN.md`, `docs/build-brief.md`, `docs/domain-model.md`, `docs/risks-and-open-questions.md`, `CONTEXT.md` — update per Durable Documentation Impact.
- Unchanged: `index.html`, `src/storage.js`, `src/standings.js`, `scripts/browser-test-utils.mjs`, and the existing envelope/change shapes.

## Visual Design Impact

- UI involved: yes.
- Design source: `DESIGN.md` and existing setup/active patterns; the mockups do not contain a preset picker, so this adds a token-based control rather than copying mockup decoration.
- Screens/states affected: setup (picker, selected detail, dynamic title/roster/limits/focus), active preset score panel (actions, ×2, helper, hint, input min), and the reused finished/replay flow (no new visual controls).
- New design artifact required: no. Use the existing card/surface, primary-fixed selection, border-cool, radius, and 44px target language; selected state must not rely on color alone (label + native radio state).

## Durable Documentation Impact

- `ARCHITECTURE.md`: update — `src/presets.js` leaf catalogue, preset-aware roster/score/replay boundaries, setup picker state/focus, active action/hint wiring, static-server allowlist, and the new suites.
- `CONSTRAINTS.md`: update — fixed six-preset catalogue; optional non-custom `presetId` only; no auto-finish/target enforcement; zero still invalid; non-negative save rejection and stepper floor; catalogued quick actions/multiplier; title auto-fill rule; untouched-vs-touched roster behavior; replay copies preset but stays untitled; unknown/custom fallback.
- `README.md`: update — user-visible preset behavior, commands `test:presets`/`test:browser:presets`, and remove presets from the future-scope sentence.
- `AGENTS.md`: not needed — no workflow, startup, or operating-rule change.
- `DESIGN.md`: update — add the preset picker/selected-detail states and remove named presets from "Mockup decoration — do not implement".
- `docs/build-brief.md`: update — add the approved preset behavior to v2 scope and remove named presets from the decoration/non-goal list (supersession; user-defined presets/catalog stay out).
- `docs/domain-model.md`: update — Game preset concept, optional `presetId`, setup/active/persistence/replay rules, sign/target/zero rules.
- `docs/risks-and-open-questions.md`: update — move presets out of "later/outside", record the resolved decisions and the trailing-row clamp risk.
- `CONTEXT.md`: update — add a short **Game preset** glossary entry.
- `PROGRESS.md` / `feature_list.json`: updated by the implementer/validator with real evidence, not by this planner.

## Implementation Plan

1. Create `src/presets.js`; make `roster.js`, `score.js`, and `game.js` preset-aware; add/update the unit suites and run `test:presets`, `test:roster`, `test:score`, `test:game`.
2. Wire the setup picker/detail/title/roster/limits/focus in `main.js` and the active quick actions/hint/sign floor/multiplier; add the CSS; walk Scenarios 1–8 manually at 1280×800 and 320×720.
3. Update the static server/smoke allowlist; create the focused browser suite; make the honest design-system/game-title/play-again updates; wire `package.json` and `init.sh`.
4. Update the durable docs, run the full verification plan, capture evidence, and hand off for independent validation.

## Implementation Tasks

- [ ] Create `src/presets.js` with the exact catalogue (ids, labels, ranges, defaults, titles, sign policy, ordered quick actions, targets/hints) and the four helpers.
- [ ] Update `src/roster.js` for optional preset-aware validation/creation and stored-only-non-custom `presetId`.
- [ ] Update `src/score.js` with `negative-not-allowed` and the preset-aware negative guard; preserve zero/range/parse behavior.
- [ ] Update `src/game.js` so `replayGame` carries a valid `presetId` while remaining untitled.
- [ ] Add setup state, picker/detail markup, preset selection/resizing/title auto-fill, dynamic limits/status/helper, focus behavior, and the initial full-reset focus change in `src/main.js`.
- [ ] Add active preset quick actions (including ×2), dynamic input min/helper/hint, draft floor/clamp, multiplier handler, and the preset-aware negative/zero rejection copy in `src/main.js`.
- [ ] Add the picker/detail/hint/multiplier/wrap CSS without changing existing selectors or tokens.
- [ ] Update `scripts/static-server.mjs` and `scripts/smoke.mjs` to serve/verify `src/presets.js`.
- [ ] Add `scripts/presets-test.mjs`; update `scripts/roster-test.mjs`, `score-test.mjs`, `game-test.mjs`, `browser-design-system-test.mjs`, `browser-game-title-test.mjs`, and `browser-play-again-test.mjs` honestly.
- [ ] Add `scripts/browser-presets-test.mjs` covering Scenarios 1–9 (all six presets, title auto-fill, bounds, ×2 math, sign/zero, persistence/replay/back-compat, 320px/a11y).
- [ ] Wire `package.json` (`test:presets`, `test:browser:presets`, `test` chain) and `init.sh` (required file + node checks).
- [ ] Update README, ARCHITECTURE, CONSTRAINTS, DESIGN, build-brief, domain-model, risks, and CONTEXT; run the full verification plan and record evidence.

## Verification Plan

- `node --check` on all touched sources and suites (covered by `init.sh`).
- `npm run test:presets` — new catalogue/helper suite passes.
- `npm run test:roster`, `npm run test:score`, `npm run test:game` — updated suites pass; `npm run test:storage` passes unmodified (optional field/version compatibility).
- `npm run test:browser:presets` — new suite passes on real headless Chrome at 1280×800 and 320×720, including all six presets, auto-title preservation, bounds/clamping, ×2 arithmetic, negative rejection, zero, target non-auto-finish, resume/reload, old/unknown fallback, replay, and no-overflow/console checks.
- `npm run test:browser:design-system`, `npm run test:browser:game-title`, `npm run test:browser:play-again`, and the Custom quick-score/roster/score suites — green with only the disclosed honest updates.
- `npm run test` — full unit/smoke/browser chain green (expected: existing 17 browser suites plus the new preset suite; existing suites otherwise untouched).
- `./init.sh` and `CI=true ./init.sh` — required files (including `src/presets.js`), all `node --check` entries (expected 32 after adding the module and two suites), and the full test chain pass; the gate exits without starting a server and only prints the manual `npm run dev` follow-up.
- `npm run dev` probe — 200 for `/`, `/src/main.js`, `/src/presets.js`, `/src/roster.js`, `/src/score.js`, `/src/game.js`, `/src/styles.css`; 404 for `/AGENTS.md` and `/feature_list.json`.
- Manual spot check in a real browser at both sizes: switch all six presets, verify title/rows/limits, score Flip 7 12→×2→24→+15→39, reject a Catan negative, save a Ticket to Ride negative, reload/resume a preset, finish/replay one.
- E2E note: this repo has no persistent external E2E harness; the established CDP browser suites are the browser-flow coverage and are included. Unit coverage covers pure preset/roster/score/replay rules.
- `init.sh` must execute the non-blocking gate, must not start long-running servers, and may print the manual dev command.

## Evidence To Capture

- Exact commands/results for the three updated unit suites, `test:presets`, the new browser suite, both gate modes, and the dev probe.
- Raw storage proof: Custom/old/unknown games omit `presetId`; each non-custom game stores its id; envelope version stays `1`; preset replays copy the id and store `title: ""`; originals stay byte-identical.
- Programmatic proof for setup bounds/title auto-fill, all six quick-action lists, ×2 math/no-save/focus, negative-not-allowed/zero messages, target non-auto-finish, 320px overflow/targets/focus, and zero uncaught console errors.
- Screenshots (desktop Catan/Flip 7 setup, 320px picker, Flip 7 active with hint, negative rejection, preset replay) in the evidence dir.
- Appended `feature_list.json` evidence and a `PROGRESS.md` session-log entry with the actual results (implementer/validator step).
- Disclosure: physical keyboards/touch cannot be exercised headless; the keyboard contract is verified with CDP real-key walks, consistent with prior features. Screenshots may be recorded without visual inspection if the environment cannot open them; assertions carry the proof.

## Validator Checklist

- [ ] Picker has exactly the six approved options in order, above the title, with Custom checked by default and the documented range/default/title/actions/hint for each.
- [ ] Title auto-fill only replaces empty/auto-filled titles; user titles survive preset switches; the flag is never persisted; full reset clears it and returns to Custom.
- [ ] Untouched rosters use the preset default; touched rosters clamp to min/max preserving retained names/colors; Add/Remove disabled states, status pill, helper, and validation all use the preset range.
- [ ] `createGame` stores `presetId` only for valid non-custom presets; Custom/old/unknown omit/fallback; envelope version stays 1; storage.js untouched.
- [ ] Active quick actions match the catalogue exactly; adds stage the shared draft; ×2 doubles (not adds), clamps, does not save, and keeps focus; the locked 12→24→39→Save example works.
- [ ] Non-negative presets reject typed negatives with the documented message and no write/change; stepper floor/input min are 0; signed presets/Custom still accept negatives; zero remains invalid with no zero action.
- [ ] Targets render as hints only; scoring past target does not finish, disable scoring, or open the podium.
- [ ] Replay copies a valid preset but stays untitled; finished originals stay byte-identical; old/custom replays omit the field.
- [ ] Resume/reload preserves the preset and its behavior.
- [ ] 320px and desktop checks pass (no overflow, ≥44px targets, visible focus, radio arrow keys, Tab order, zero console errors).
- [ ] Static server/smoke expose `src/presets.js`; `package.json`/`init.sh` wiring is complete; the full gate passes.
- [ ] Honest test updates are limited to the listed files with supersession comments; existing suites are not weakened; no unrelated product behavior (user-defined presets, card badges, auto-finish, round tracking, roster reuse) was added.
- [ ] README/ARCHITECTURE/CONSTRAINTS/DESIGN/build-brief/domain-model/risks/CONTEXT are updated; evidence is recorded with real commands/results.
