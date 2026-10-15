# Feature Implementation Spec: Add optional editable game titles

## Source Feature

- `id`: `name-game-titles`
- `area`: `game`
- `depends_on`: `refresh-design-system` (accepted and merged to `main`)
- `status`: `not_started` at planning time
- `source`: `feature_list.json`

## Goal

A game carries a display title the scorekeeper controls: setup offers an optional "Game title" field; a blank title renders an auto date-based label everywhere the title appears (dashboard cards, Resume/View results accessible names, active header, finished header, podium); the title can be edited inline in the active header while the game is in progress (saving immediately under the accepted storage rules); finishing freezes it; Play again starts the new game untitled. Game identity (`id`) is never derived from the title, and user-entered title text is never silently rewritten.

## Non-Goals

- No rename affordance on finished games, home cards, or the podium dialog — the active (unfinished) header is the only edit point.
- No title history, per-game slug/URL, search, or sorting by title.
- No changes to the storage envelope: `scorekeeper:games` stays `{ version: 1, games }`; no migration, no new storage key.
- No timestamps work: `updatedAt` display, "Updated Xm ago", and the recent-entries log belong to `track-game-activity`.
- No mockup decoration (rounds, timers, statistics, presets, fill group, quick game).
- **Must not change** (regression floor): smoke strings in `index.html` (`Board-game scorekeeper` exact casing, `<main id="main-content"`, no `localStorage|score change|leaderboard row` in static markup); the design-system suite's nav matrix, byte-identical write-absence proofs, and active-empty view (except the one honest update listed below); the accepted behavior of roster, scoring, ranking, undo, resume, storage-failure feedback, finish, podium, replay (one deliberate supersession below), and entry restriction; `persistActiveGameSnapshot()` semantics (suppression while the startup read is invalid, rollback on write failure, code-only warnings, notice clearing); breakpoints, reduced-motion rules, focus contracts, and the suite-frozen `--muted`; `index.html` (untouched); `src/storage.js`, `src/score.js`, `src/standings.js` (untouched).

## Job Story

When I run several game nights in one browser,
I want to name each table (or let untitled games show a date-based label), fix a typo while we play, and trust that finished names stay frozen,
so I can tell my saved games apart on the dashboard without inventing conventions like "game 2".

## Users And Permissions

- Scorekeeper: the only actor. Titles live in the same browser-local storage as the rest of the game; no accounts, sharing, or remote access.

## Product Decisions Resolved For This Slice

These close the `docs/risks-and-open-questions.md` item "Auto-label format for blank titles" and the related implementation-time choices inside this feature's scope.

### Decision 1 — Auto-label format

`displayGameTitle(game)` returns:

- the stored title **verbatim** when `game.title` is a string with non-whitespace content (never re-trimmed, never rewritten); otherwise
- **`Game — {d MMM, HH:mm}`** derived from `game.createdAt` in local time — e.g. `Game — 12 Oct, 21:08` (24-hour, zero-padded minutes, short English months `Jan…Dec`, no locale-dependent formatting); otherwise
- **`Game`** when `createdAt` is missing, non-string, or unparseable.

Justification: the "Game" prefix clearly marks a generated label (distinct from user text like "Friday game night"); `createdAt` is already stored and immutable, so the label is stable across reloads and re-renders; the `d MMM, HH:mm` shape matches the mockup dashboard's timestamp rendering ("12 Oct, 21:08") for v2 coherence. Known, accepted limitation: a user who literally types `Game — 12 Oct, 21:08` is displayed verbatim — the label is distinct by construction, not by collision-proofing. The auto-label is render-time only and is **never stored**.

### Decision 2 — Storage shape and backward compatibility

- The title lives in the existing `game.title` string field. `createGame` now stores the trimmed user title, **possibly `""`** (it no longer substitutes `FALLBACK_TITLE`); non-string input is stored as `""`.
- Envelope `version` stays `1`; `isUsableGameEntry` deliberately does not validate `title`, so no migration is needed. Existing saved games (stored `title: "Game night"` or any string) display that string verbatim as a user title; saved games missing `title` (hand-corrupted but usable) render the auto-label. Nothing is rewritten on load.
- `FALLBACK_TITLE` is removed from `src/roster.js` (its last consumers — the setup pre-fill and `replayGame` — are both replaced by this feature). The old fallback concept is superseded by the auto-label.

### Decision 3 — Setup field

- The setup "Game title" input stays where it is (label exactly `Game title`, above the roster, matching the mockup) but starts **empty**: `state.title` initializes to `""` and `resetSetup()` resets it to `""` (hero New game and empty-state New game keep the full accepted reset transition; nav New Game preserves the whole scratchpad including the title, per the accepted design-system decision). The input gains `placeholder="Optional — e.g. Friday game night"` and `maxlength` bound to the new `MAX_TITLE_LENGTH = 60` exported from `src/roster.js` (the value already shipped in the input; titles may be longer than the 40-char player-name cap because they are single heading strings).
- Trim rule: leading/trailing whitespace is trimmed once at create/rename; blank-after-trim means "no title"; interior whitespace and casing are preserved verbatim. The auto-label is kept distinct by never being written into the field or the record.

### Decision 4 — Active-header inline edit

- Display mode (unfinished view only): the heading shows `displayGameTitle(game)`; a text-labeled `type="button"` control **"Edit title"** (`data-action="open-title-edit"`, ≥44px, visible focus) sits beside the heading inside `.active-header`.
- Edit mode: a new `state.titleEditOpen`/`state.titleDraft` pair. The heading and the Edit button are replaced by an inline form: `label[for]` "Game title", a text input (`id="active-title-input"`, `maxlength=60`, `value=state.titleDraft`, `autocomplete="off"`), a polite `#title-edit-feedback` live region, **Save title** (submit, primary) and **Cancel** (secondary). Opening focuses the input; Enter submits (native form); Escape cancels; Save/Cancel return focus to `[data-active-heading]`.
- Save calls the new pure `renameGame({ game, title })` in `src/game.js`: invalid game → `missing-game`; non-active status → `already-finished` (finished titles are frozen); non-string title → `invalid-title`; trimmed length > 60 → `title-too-long`; success returns `{ game: { ...game, title: trimmedTitle }, error: null }` without mutating the input. On success the handler sets `state.activeGame`, calls the **unchanged** `persistActiveGameSnapshot()` — the sixth successful-mutation save trigger, so the edit is saved immediately and the edit closes, re-renders, repaints the storage notice, and focuses the heading. On failure the mapped message paints `#title-edit-feedback` (plus code-only `console.warn("Game rename failed:", code)`) without re-render. `GAME_ERROR_CODES` becomes exactly `["missing-game", "already-finished", "not-finished", "invalid-roster", "invalid-title", "title-too-long"]`.
- `state.titleEditOpen`/`state.titleDraft` reset exactly where `finishPromptOpen` resets (`resetSetup`, `handleResume`, the active back-home handler, `handlePlayAgain`) plus the finish success path. During edit, re-renders (e.g. a score save) keep the form open with the draft preserved.

### Decision 5 — Display points

| Surface | Treatment |
|---|---|
| Ongoing card `.saved-game-title` | `displayGameTitle(game)` (auto-label for blanks) |
| Finished card `.saved-game-title` | same |
| `Resume` / `View results` `aria-label`s | `Resume {label}` / `View results {label}` using the display label (replaces `game.title ?? "Untitled game"` and `?? "this game"` fallbacks) |
| Active header `#active-title` / `[data-active-heading]` | display label (auto-label for blanks) |
| Finished view header (same heading ids) | display label; **no** Edit control |
| Podium dialog | new muted `.podium-game-title` line showing the display label as the first content element in `.podium-body` (before `h2#podium-title`); `podium-title` ("Final podium") and `podium-lede` ("Congratulations to the top of the table.") are untouched — both are suite-frozen |
| Setup and edit inputs | raw draft/stored text only — never the auto-label |

## Acceptance Scenarios

### Scenario 1: Titled game end to end

Given the setup view with the title field empty
When the scorekeeper types `Catan Friday` and starts a game with a valid roster
Then the active header reads `Catan Friday`, the stored record has `title: "Catan Friday"`, the dashboard card and `Resume Catan Friday` accessible name show it, and the podium shows it in the new title line.

### Scenario 2: Blank title auto-label

Given the setup view with the title left blank
When the game starts
Then the record stores `title: ""`, the active header, card, accessible names, and podium render `Game — {d MMM, HH:mm}` derived from `createdAt` (or `Game` for unusable timestamps), the label is stable across reload, and it is never written into storage.

### Scenario 3: Edit while in progress saves immediately

Given an active game whose header shows a title
When the scorekeeper activates Edit title, changes the text, and saves (Enter or button)
Then the heading updates, the stored payload reflects the new title with a fresh `updatedAt`, the edit form closes with focus on the heading, and a blocked/quota-failing write surfaces the accepted role=status notice with the in-memory edit intact; Cancel and Escape close the form with a byte-identical payload; clearing the text and saving stores `""` so the auto-label returns.

### Scenario 4: Finish freezes, replay does not copy

Given an active titled game
When it is finished
Then the finished view and its card show the frozen title with no edit control, and further rename attempts are impossible from the UI (the `already-finished` guard covers direct calls); when Play again runs
Then the replay opens with the **auto-label** (stored `title: ""`), never the original title, and the finished original's stored entry stays byte-identical.

### Scenario 5: Resume keeps editing; old records keep their titles

Given (a) an unfinished saved game and (b) a pre-feature saved game with `title: "Game night"`
When (a) is resumed the header shows its title with Edit title available and an edit persists across reload; when (b) is resumed or listed its stored title renders verbatim with no auto-label and no migration or corruption of the payload.

### Scenario 6: Responsive and keyboard baseline

Given 320×720 and 1280×800 viewports on the setup, active (display and edit modes), finished, and podium surfaces
Then there is no horizontal overflow, Edit title / Save title / Cancel are ≥44px with visible focus, a real-keyboard walk (Tab to Edit title → Enter → type → Enter) renames the game, and the setup field is reachable in the accepted Tab order.

## Repository Research

### Files Inspected

- `AGENTS.md`, `PROGRESS.md`, `feature_list.json` (`name-game-titles` entry, lines 307–322) — workflow, scope, verification items.
- `docs/build-brief.md`, `docs/domain-model.md`, `docs/risks-and-open-questions.md` — v2 titles bullet; display-only title editable in progress and frozen at finish, replay not copying it; auto-label format open decision.
- `DESIGN.md` + mockups `new_game_setup/screen.png` (Game title field above the roster), `scorekeeper_dashboard/screen.png` (titles leading cards; "12 Oct, 21:08" timestamp style), `active_game_scorekeeper/screen.png` (title as the header heading beside "All games"), `end_of_game_podium_summary/screen.png` (podium header block; no title shown — placement is this spec's call).
- `docs/specs/refresh-design-system.md` — structure/style convention; accepted nav/scratchpad decisions.
- `src/roster.js` — `FALLBACK_TITLE`, `MAX_NAME_LENGTH`, `createGame` (`title.trim() || FALLBACK_TITLE`).
- `src/game.js` — `finishGame`, `replayGame` (copies the title via `createGame`), `GAME_ERROR_CODES`, `isLifecycleGame`.
- `src/storage.js` — envelope/entry validation (`isUsableGameEntry` ignores `title`), upsert/display helpers; **needs no changes**.
- `src/main.js` (1290 lines) — `state.title` pre-filled with `FALLBACK_TITLE`; setup form (`#game-title`, `maxlength="60"`); six title render points (two cards, two aria-labels, active + finished headings); `persistActiveGameSnapshot()`; transient-flag reset sites; podium dialog (`podium-title`/`podium-lede`).
- `index.html` — static shell only; every title surface renders via `appRoot`, so it is untouched here.
- `scripts/smoke.mjs` — static-markup constraints on `index.html` (unaffected).
- Tests: `roster-test.mjs` (blank → `"Game night"`), `game-test.mjs` (replay copies title verbatim, non-string → fallback, exact `GAME_ERROR_CODES` list), `browser-design-system-test.mjs` (nav-matrix session creates a game **without** filling `#game-title` and asserts heading `"Game night"`), `browser-play-again-test.mjs` (asserts `replay.heading === "Championship cup"` and stored `replayEntry.title === "Championship cup"`), `browser-podium-test.mjs` (lede text frozen), plus resume/finish/storage-failure/rank/undo/score suites (all create explicitly titled games — unaffected).
- `package.json`, `init.sh` — test chain and `node --check` wiring convention.

### Existing Patterns To Follow

- One new focused browser suite per feature, wired as an npm script, chained into `npm run test`, and added to `init.sh`'s `node --check` list; no new `src/*` module means no static-server/smoke/allowlist changes.
- Honest, spec-driven updates to existing suites are acceptable (precedent: finish-game, podium, play-again) — never silent weakening; summary log lines are updated too.
- Pure lifecycle logic lives in `src/game.js` with unit coverage in `scripts/game-test.mjs`; display composition lives in `src/main.js`; the browser suites use CDP on real headless Chrome at 1280×800 and 320×720 with `readSavedGamesState` byte-identity proofs.

### Current Gaps

- Blank titles are impossible from the UI (the field pre-fills "Game night"), no auto-label exists, the active header has no edit affordance, and `replayGame` copies the original title (contradicting `docs/domain-model.md`).

## Technical Approach

1. **`src/roster.js`**: add `export const MAX_TITLE_LENGTH = 60`; remove `FALLBACK_TITLE`; `createGame` stores `typeof title === "string" ? title.trim() : ""`.
2. **`src/game.js`**: remove the `FALLBACK_TITLE` import; `replayGame` calls `createGame` with `title: ""` (replays start untitled); add `renameGame` per Decision 4 (reusing `isLifecycleGame`; input never mutated; extend `GAME_ERROR_CODES`); add `export function displayGameTitle(game)` with a private deterministic `formatTitleStamp` (Decision 1).
3. **`src/main.js`**: `state.title` default `""` and `resetSetup` resets it; setup input gets `placeholder` + `maxlength="${MAX_TITLE_LENGTH}"`; replace all six title render points with `displayGameTitle` (pass `game` into `renderPodiumDialog` and add the `.podium-game-title` line); add `state.titleEditOpen`/`state.titleDraft` with the Decision 4 markup, handlers (`open-title-edit`, form submit, `cancel-title-edit`, Escape), `SCORE_ERROR_MESSAGES` entries for `invalid-title`/`title-too-long`, resets at the accepted sites, and the finish-success close.
4. **`src/styles.css`**: additive classes only — `.title-edit-action`, `.title-edit-form` (reusing `text-field`/`primary-action`/`secondary-action`/`form-feedback`), and `.podium-game-title` (muted eyebrow-style); no changes to existing selectors, tokens, breakpoints, or motion rules.
5. **Tests**: honest updates (below) + new `scripts/browser-game-title-test.mjs` with isolated Chrome sessions covering Scenarios 1–6, including `readSavedGamesState` proofs (stored `title: ""` for auto-label games, byte-identical payload across cancel/reopen/replay, blocked-write notice with unchanged copy).
6. **Docs**: README (title behavior + new command), ARCHITECTURE (`renameGame`, `displayGameTitle`, sixth save trigger, header edit form), CONSTRAINTS (title durability rules).

## Expected File Changes

- `src/roster.js` — modify: `MAX_TITLE_LENGTH`; remove `FALLBACK_TITLE`; blank-title storage.
- `src/game.js` — modify: `renameGame`, `displayGameTitle`, `GAME_ERROR_CODES`, replay no longer copies the title.
- `src/main.js` — modify: setup default/placeholder, six display points, header edit form and handlers, transient resets, error messages, podium title line.
- `src/styles.css` — modify: the three additive classes only.
- `scripts/roster-test.mjs` — modify (honest): blank title now stores `""`; update summary line.
- `scripts/game-test.mjs` — modify (honest): replay title assertions flip to not-copied/`""`; new `renameGame` guard/success/immutability cases; exact `GAME_ERROR_CODES` list; drop the unused import; update summary line.
- `scripts/browser-design-system-test.mjs` — modify (honest): the nav-matrix session fills `#game-title` with an explicit title before submit so its exact heading assertion holds (the session tests reopen semantics, not labels); no other session changes.
- `scripts/browser-play-again-test.mjs` — modify (honest): replay heading asserts the auto-label pattern and inequality with the original title; stored replay entry asserts `title: ""`; update summary line.
- `scripts/browser-game-title-test.mjs` — new focused suite.
- `package.json` — add `test:browser:game-title` and chain it into `test`.
- `init.sh` — add the new script to the `node --check` list.
- `README.md`, `ARCHITECTURE.md`, `CONSTRAINTS.md` — document per Technical Approach.
- `docs/specs/name-game-titles.md` — this spec (belongs to this feature's PR).
- Unchanged: `index.html`, `src/storage.js`, `src/score.js`, `src/standings.js`, `scripts/static-server.mjs`, `scripts/smoke.mjs`, `scripts/browser-resume-test.mjs`, `browser-roster-test.mjs`, `browser-score-test.mjs`, `browser-rank-test.mjs`, `browser-undo-test.mjs`, `browser-storage-failure-test.mjs`, `browser-finish-game-test.mjs`, `browser-podium-test.mjs`, `browser-test-utils.mjs`, and `feature_list.json` behavior fields (evidence appended later by implementer/validator).

## Visual Design Impact

- UI involved: yes — setup field, active header (display + edit), finished header, cards, podium.
- Design source: `DESIGN.md` + `docs/design/update-v2/` mockups; the edit control and podium title line have no mockup (implementation-time treatment per Decisions 4–5, using existing tokens).
- Screens/states affected: setup, active (display/edit), finished, home cards, podium dialog.
- New design artifact required: no — existing token system covers the additions; no new motion.

## Durable Documentation Impact

- `CONSTRAINTS.md`: update — durable rules: titles are display-only (identity is `id`); editable only while active; frozen at finish; replay never copies the title; the auto-label is render-time only and never stored; user title text is never rewritten; rename is the sixth save trigger under the storage-failure rules.
- `ARCHITECTURE.md`: update — `renameGame` boundary, `displayGameTitle` display helper, header edit form, sixth save trigger, new suite.
- `README.md`: update — user-visible title behavior + `npm run test:browser:game-title`.
- `AGENTS.md`: not needed — no workflow or startup change. `CONTEXT.md`/`docs/domain-model.md`/`docs/build-brief.md`: not needed — they already state these rules; this spec implements them.

## Implementation Plan

1. Land the pure layer first: `roster.js` constants/trim, `game.js` `renameGame`/`displayGameTitle`/replay change; update `roster-test.mjs` and `game-test.mjs` honestly and run `npm run test:roster` + `npm run test:game`.
2. Wire the display layer in `main.js` (setup default/placeholder, six display points, podium line) and verify in `npm run dev` that blank games auto-label and old records render verbatim.
3. Add the header edit affordance (state, markup, handlers, focus, sixth save trigger) and the three CSS classes; walk Scenario 3 and 6 by hand at both widths.
4. Update the two affected browser suites honestly; write `scripts/browser-game-title-test.mjs`; wire `package.json` + `init.sh`.
5. Run the full verification plan; update README/ARCHITECTURE/CONSTRAINTS; record evidence.

## Implementation Tasks

- [ ] `src/roster.js`: `MAX_TITLE_LENGTH = 60`; delete `FALLBACK_TITLE`; `createGame` stores the trimmed title (`""` for blank/non-string).
- [ ] `src/game.js`: `replayGame` passes `title: ""`; add `renameGame` with the Decision 4 guard order and non-mutation; add `displayGameTitle` + private stamp formatter; extend `GAME_ERROR_CODES`.
- [ ] `scripts/roster-test.mjs` + `scripts/game-test.mjs`: honest updates (blank title, replay title, rename cases, exact codes list, summary lines).
- [ ] `src/main.js`: setup `state.title` default/reset to `""`, placeholder + constant `maxlength`; `displayGameTitle` at cards, aria-labels, active/finished headings; `.podium-game-title` line; `titleEditOpen`/`titleDraft` state, form markup, open/save/cancel/Escape handlers, feedback region, resets, finish-success close; `invalid-title`/`title-too-long` messages.
- [ ] `src/styles.css`: `.title-edit-action`, `.title-edit-form`, `.podium-game-title` (additive only).
- [ ] `scripts/browser-design-system-test.mjs`: nav-matrix session fills the title field (honest update, nothing else).
- [ ] `scripts/browser-play-again-test.mjs`: auto-label replay assertions (honest update).
- [ ] `scripts/browser-game-title-test.mjs`: new suite covering Scenarios 1–6 with storage byte-identity proofs and blocked-write/notice coverage.
- [ ] `package.json` + `init.sh`: wire the new suite.
- [ ] Update `README.md`, `ARCHITECTURE.md`, `CONSTRAINTS.md`.
- [ ] Run the verification plan; record evidence in `feature_list.json`/`PROGRESS.md` (implementer/validator step, not this planner).

## Verification Plan

- `node --check` on all touched sources and test scripts (covered by `init.sh`).
- `npm run test:roster`, `npm run test:game` — updated unit suites pass; `npm run test:storage` passes **unmodified** (proves storage compatibility).
- `npm run test:browser:game-title` (new, real headless Chrome, 1280×800 + 320×720): Scenarios 1–6 as isolated sessions, including the stored `title: ""` raw check, auto-label stability across reload, byte-identical payloads across cancel/reopen/replay, the role=status write notice with unchanged copy under blocked writes, and the real-keyboard rename walk.
- `CI=true ./init.sh` and `./init.sh` — required files, all syntax checks (including the new suite), and the full `npm run test` chain pass; exit without starting a server. All pre-existing suites run green; the only modified pre-existing suites are the four honest updates listed above (a transient Chrome-launch timeout may be retried once).
- `npm run dev` probe — 200 for `/`, `/src/game.js`, `/src/roster.js`, `/src/main.js`; 404 for `/AGENTS.md`.
- Screenshots (setup with empty title field, active header display + edit modes, finished header, card with auto-label, podium) into the evidence dir; programmatic assertions carry the proof as established.
- Disclosure: real-device keyboards/IMEs cannot be exercised headless; the keyboard contract is verified via CDP real-key walks, consistent with prior features.

## Evidence To Capture

- Exact commands and results for the unit suites, the new browser suite, `npm run test`, both gate modes, and the dev probe.
- A statement that `src/storage.js`/`index.html` are untouched, the envelope version stayed `1`, all pre-existing suites ran green, and the only honest updates were the four listed in Expected File Changes (with reasons).
- Screenshots + programmatic assertion summaries (auto-label format, edit focus/keyboard flow, 320px, ≥44px targets, byte-identity proofs).
- Appended `feature_list.json` evidence entries and a `PROGRESS.md` session-log entry.

## Validator Checklist

- [ ] Auto-label matches Decision 1 exactly (format, `createdAt` basis, `Game` fallback) and is never stored or written into inputs.
- [ ] Storage: envelope/version unchanged, no migration; pre-feature records render verbatim; blank/missing titles never corrupt or drop entries (`test:storage` unmodified and green).
- [ ] Setup: empty default, `placeholder`, `maxlength=60`, trim-once rule; hero/empty-state New game reset the title, nav New Game preserves it.
- [ ] Edit affordance matches Decision 4 (markup ids, focus moves, Escape/Enter, feedback region, sixth save trigger with unchanged suppression/rollback/notice semantics).
- [ ] Display points match Decision 5; finished views and cards show no edit control; podium `podium-title`/`podium-lede` copy unchanged.
- [ ] Replay starts untitled; the finished original stays byte-identical; `GAME_ERROR_CODES` list matches exactly.
- [ ] The four honest suite updates are spec-driven and nothing else in the pre-existing suites changed; smoke strings and design-system contracts hold.
- [ ] 320px/desktop checks pass; ≥44px targets; visible focus; keyboard rename works; no new motion or tokens.
- [ ] README/ARCHITECTURE/CONSTRAINTS updated; evidence recorded with real commands and results; no unrelated feature work (timestamps, counters, numbers, distribution, podium actions absent).
