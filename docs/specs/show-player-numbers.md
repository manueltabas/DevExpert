# Feature Implementation Spec: Show setup-order player number badges

## Source Feature

- `id`: `show-player-numbers`
- `area`: `roster`
- `depends_on`: `refresh-design-system` (accepted and merged, PR #16); the branch base also contains the merged `name-game-titles` (PR #17), `track-game-activity` (PR #18), and `add-quick-score-entry` (PR #19)
- `status`: `not_started` at planning time
- `source`: `feature_list.json`

## Goal

Every player carries a visible **number badge (1–N)** assigned by setup order so repeated colors or duplicate names stay distinguishable on every roster surface: setup rows, active leaderboard, score-entry selected-player card, recent entries, podium, and finished standings. The number is a stable, game-scoped display aid — never identity, never a scoring input, never a rank replacement.

The codebase already renders numbered colored tokens on all these surfaces from the stored `player.marker` field (`createGame` stores `marker: String(index + 1)`). This slice makes the domain rule ("assigned in setup order, stable for the game's life") true **by construction**: the badge number is derived at render time from the player's position in `game.players`, the score-entry card gains the mockup's visible "Player {n}" subtitle, and the token aria-labels speak the domain language ("Player 1, Blue" instead of "Player marker 1, Blue"). **Zero new persisted fields; zero storage changes.**

## Non-Goals

- No editing, reassignment, or manual control of numbers; no persistent "player profile" concept across games.
- No changes to player identity (`player.id` rules), color/marker assignment, or `createGame`/`replayGame` behavior (`src/game.js` untouched; the stored `marker` field stays written exactly as accepted).
- No numbers on home cards (they render aria-hidden plain color dots per the dashboard mockup), nav, headers, or the title-edit form.
- No rank changes: `rankPlayers`/`podiumRows` untouched; badges never replace or reposition rank digits.
- No mockup decoration (podium steps/WINNER art, "Round active" subtitles, "Game concluded" pill, podium exit actions — owned by `extend-podium-actions`).
- **Must not change** (regression floor): `index.html`; `src/score.js`, `src/storage.js`, `src/standings.js`, `src/game.js` (all 0-line diffs); the storage envelope (version 1) and the **exactly six** `persistActiveGameSnapshot()` call sites (badges are render-only and never save); every exact accepted aria-label and message frozen by suites (`Add points for {name}`, `Points for {name}`, `{name}: rank {rank}, total {total}`, `Remove player {n}`, `Color for player {n}`, validation copy `Player {n} needs a name`); smoke strings; the design-system nav matrix and write-absence proofs; all byte-identity proofs; breakpoints, reduced-motion rules, suite-frozen `--muted`.

## Job Story

When two players share a name or a token color,
I want a visible number (1, 2, 3…) that stays with each player for the whole game,
so I can score the right "Alex" at a glance and announce unambiguous labels on the leaderboard, podium, and score panel.

## Users And Permissions

- Scorekeeper: the only actor. Badges are display-only derivations from stored data; no new writes, permissions, or network behavior.

## Product Decisions Resolved For This Slice

These close the domain-model rule ("player number assigned in setup order 1–20, stable, game-scoped, not identity, no scoring meaning") as concrete implementation choices.

### Decision 1 — Numbers derive from roster array position at render; zero new persisted fields

- The badge number of a player is `index + 1` where index is the player's position in `game.players` (the setup order). A new pure helper `playerNumbers(game)` in `src/roster.js` returns a `Map` keyed by `player.id` → 1-based position (guards: non-object game or non-array players → empty `Map`), built once per surface render and passed down. Keying by id is required because `rankPlayers` rows are spread copies while `recentScoreChanges` returns original references.
- **Stability proof**: after game start no accepted code path reorders, splices, or filters `game.players` — `applyScoreChange`/`undoLastScoreChange` map-replace in place, `finishGame`/`renameGame` spread, `replayGame` builds a new array in the original's order, storage round-trips verbatim, `rankPlayers` sorts a copy. Position therefore equals setup order and stays stable for the game's life, across resume and reload.
- **Pre-start removal renumbers — accepted.** Setup rows are a mutable draft of a not-yet-existing game: the number is the row's current position (the mockup labels rows "PLAYER 1..4" positionally; validation copy already says "Player {index + 1} needs a name"). Nothing persisted or referenced depends on pre-start numbering, and the alternative (stable pre-start numbers) would leave gaps (1, 2, 4) that contradict the 1–N badge contract.
- **Replay renumbers from setup order by construction** (the feature's verification bullet): the replay's players array is the original's order, so badges render 1..N regardless of any stored marker values.
- **The stored `marker` field stays exactly as accepted** — written by `createGame`, copied by `replayGame` (its `game-test.mjs` assertions hold untouched), never migrated, envelope version 1 — but renderers stop reading it for the badge. Graceful win: a hand-corrupted record (seeded `marker: "7"`, or a missing marker that would render the text "undefined" today) displays its truthful positional number.
- Storage impact statement: **zero new persisted fields, `src/storage.js` 0-line diff, envelope version stays 1.**

### Decision 2 — Display surfaces

| Surface | Badge treatment |
|---|---|
| Setup rows (`renderSetupRow`) | Numbered colored token beside the name input — **already positional, no change**; renumber-on-remove behavior pinned by the new suite |
| Active leaderboard rows | Rank digit + numbered colored token — **already renders both; only the number source and token aria-label change** |
| Score-entry selected card | Numbered token + name + **new visible `Player {n}` subtitle** (mockup: "Alex / Player 1"); token stays `aria-hidden` |
| Recent entries rows | Numbered token kept (a deliberate superset of the mockup's plain dots, established by track-game-activity); aria-label renamed |
| Podium rows | Rank + numbered token + name + total — **already matches the podium mockup; aria-label renamed** |
| Finished standings rows | Same treatment as active rows; aria-label renamed |
| Home cards | **No numbers** — aria-hidden plain color dots stay as-is |
| Finished/active-empty views, nav, headers | No badges beyond the above |

### Decision 3 — Badge visual

Reuse the existing `.player-token` system unchanged: circle, `color` = the player's token color class, white numeral, dark outline for yellow/white (`.player-token.marker-yellow/.marker-white`, per `DESIGN.md`), sizes already tuned per surface (42px rows/setup, 36px score card, 32px recent entries). The only CSS addition is the muted `.score-selected-number` subtitle style. No new tokens, breakpoints, or motion.

### Decision 4 — Accessibility strategy

- Token aria-label becomes **`Player {n}, {color.label}`** (e.g. `Player 1, Blue`) at the four numbered non-hidden token sites (active row, finished row, podium, recent entry) — the number joins the accessible name, replacing the MVP-era "Player marker" wording.
- All suite-frozen labels stay byte-identical; names remain visible text beside every badge, so the number is never the only differentiator. The visible `Player {n}` subtitle makes the score card's number available to sighted and AT users alike.
- Rank digits stay plain text with the frozen total aria-label carrying rank; badge ≠ rank is communicated by position (rank column precedes the token), matching the accepted mockup.

### Decision 5 — Rank/ties interplay

Competition ranking is untouched: 12/12/8 still renders ranks 1, 1, 3 while the badges show the players' setup numbers (e.g. 1, 2, 3) regardless of rank order. A player's badge never changes when totals change; only rank does.

## Acceptance Scenarios

### Scenario 1: Setup numbers are positional and renumber on removal

Given the setup form with 4 rows
When the scorekeeper removes row 2 and starts the game
Then rows renumber 1, 2, 3 immediately (tokens, legends, input labels), the created game's badges are 1, 2, 3 in setup order, and duplicate names/colors remain distinguishable by badge.

### Scenario 2: Badges disambiguate across all roster surfaces

Given an active game where two players share the name "Alex" and a color
When the scorekeeper views the leaderboard, score card, recent entries, then finishes the game
Then every row shows its setup-order badge; the score card shows the selected player's badge with the `Player {n}` subtitle; podium and finished standings keep the same badge per player next to (never instead of) their rank.

### Scenario 3: Rank and badge stay independent

Given totals 12, 12, 8 from players numbered 1, 2, 3
When the leaderboard renders
Then ranks read 1, 1, 3 (frozen aria-labels `{name}: rank {rank}, total {total}`) while badges read 1, 2, 3; after a save reorders rows, badges follow players, ranks follow totals.

### Scenario 4: Numbers persist across resume and replay renumbers

Given a saved active game with badges 1..N
When the scorekeeper reloads and resumes it
Then every badge matches the stored roster order; after finishing and using Play again, the replayed game renders badges 1..N in the replay's setup order with zero totals.

### Scenario 5: Corrupt stored markers degrade to positional numbers

Given a seeded stored game whose first player carries `marker: "7"`
When the game is resumed
Then the badge shows the positional number 1 with label `Player 1, Blue` — the stored marker never surfaces as the badge, and storage stays byte-identical across the render.

### Scenario 6: Accessibility and responsive baseline

Given 320×720 and 1280×800 viewports
Then tokens expose `Player {n}, {color}` labels, names stay visible beside every badge, the score-card subtitle renders, there is no horizontal overflow, existing ≥44px targets and focus contracts hold, and there are zero uncaught console errors.

## Repository Research

### Files Inspected

- `feature_list.json` (`show-player-numbers`, lines 395–409), `PROGRESS.md`, `AGENTS.md` — scope, status, workflow.
- `docs/domain-model.md` (line 11: player number rule; line 17: assigned in setup order), `docs/build-brief.md` (v2 bullet), `docs/risks-and-open-questions.md` (risk: repeated colors + 20 players → badges), `DESIGN.md` (tokens, white/yellow outlines) + mockups `new_game_setup/screen.png` (numbered colored circles beside name inputs), `active_game_scorekeeper/screen.png` (rank digit + numbered token per row; score card "Alex / Player 1"; plain dots in recent entries), `end_of_game_podium_summary/screen.png` (rank + numbered token rows).
- `docs/specs/add-quick-score-entry.md`, `track-game-activity.md`, `name-game-titles.md`, `refresh-design-system.md` — convention for decisions, regression floors, honest updates, suite wiring.
- `src/roster.js` — `createGame` stores `marker: String(index + 1)`; setup helpers are positional. `src/game.js` — `replayGame` copies markers/orders (stored-record assertions in `scripts/game-test.mjs` stay valid). `src/score.js` — `recentScoreChanges` returns original player references; `applyScoreChange`/undo map-replace players in place. `src/standings.js` — `rankPlayers` spreads row copies (hence id-keyed lookup). `src/storage.js` — verbatim envelope, version 1 (untouched).
- `src/main.js` (1611 lines) — the five token render sites reading `player.marker`: `renderPodiumPlayer` (:865), `renderFinishedPlayer` (:959), `renderActivePlayer` (:972), `renderRecentEntry` (:1088, aria-labelled) and `renderScoreForm` (:986, `aria-hidden`); `renderSetupRow` (:517) already positional; `renderScoreForm` called only from `renderActiveGame` (:697); per-surface render entry points all hold `game`.
- `src/styles.css` — `.player-token` (+ yellow/white outline rules :720–722), `.score-selected .player-token` (:934), `.recent-entry .player-token` (:1532), ≤360px compactions.
- Test contracts: `browser-roster-test.mjs` (setup token text collected, duplicate-name flow, validation copy), `browser-resume-test.mjs` (`tokenTexts` deep-equal `["1","2"]`, card marker classes), `browser-score-test.mjs` (`panelName` = name text; frozen row-button/amount labels), `browser-podium-test.mjs:332` and `browser-game-activity-test.mjs:399` (the only two "Player marker 1, Blue" string assertions), `browser-play-again-test.mjs:144/427` (replay tokens deep-equal finished tokens — holds under uniform derivation), `browser-game-title-test.mjs:73`/`browser-design-system-test.mjs:261`/`browser-storage-failure-test.mjs:602` (seeds use `marker: String(index + 1)` — consistent with derivation), `scripts/roster-test.mjs`, `package.json`, `init.sh` (25-entry `node --check` list).

### Existing Patterns To Follow

- Pure display helpers land in `src` modules with unit tests (the `displayGameTitle`/`formatRelativeTimestamp` precedents) — here `playerNumbers` in `src/roster.js` + additive `scripts/roster-test.mjs` cases.
- One new focused browser suite per feature wired as `npm run test:browser:player-numbers`, chained into `npm run test`, added to `init.sh`'s `node --check` list; isolated Chrome sessions at 1280×800 and 320×720 with `readSavedGamesState` byte-identity proofs.
- Additive-only CSS; honest pre-existing-suite updates only with supersession comments (the track-game-activity precedent: two exactly-scoped key-list updates).

### Current Gaps

- Badge numbers render from the stored `marker` (diverges from setup order for corrupt data; `escapeHtml(player.marker)` prints "undefined" when marker is missing); the score card has no "Player {n}" subtitle; token aria-labels use marker vocabulary.

## Technical Approach

1. **`src/roster.js`**: export `playerNumbers(game)` — returns `Map` of `player.id` → 1-based array position; guards return an empty `Map` for non-object games/non-array players; never mutates input.
2. **`src/main.js`** (render-only; no handler, state, or save-path change): in `renderActiveGame`, `renderFinishedGame`, `renderPodiumDialog`, `renderRecentEntries`, build `playerNumbers(game)` once; thread the number into `renderActivePlayer`, `renderFinishedPlayer`, `renderPodiumPlayer`, `renderRecentEntry`, `renderScoreForm` (new parameter). Replace `player.marker` with the derived number in all five token sites; rename the four aria-labels to `Player {n}, {color.label}`; add the `<span class="score-selected-number">Player {n}</span>` subtitle in `.score-selected`. Setup rendering stays as-is.
3. **`src/styles.css`**: additive `.score-selected-number` only (muted, small, `overflow-wrap: anywhere`; reuse the panel label rhythm). No existing selector, token, breakpoint, or motion rule modified.
4. **Tests**: additive `playerNumbers` cases in `scripts/roster-test.mjs` (well-formed 1..N map, guards, immutability); exactly two honest one-line updates with supersession comments — `scripts/browser-podium-test.mjs:332` and `scripts/browser-game-activity-test.mjs:399` → `Player 1, Blue`; new `scripts/browser-player-numbers-test.mjs` (Sessions A–D below).
5. **Docs**: README (badge behavior + new command + next steps), ARCHITECTURE (render-time derivation boundary, `playerNumbers`, new suite), CONSTRAINTS (durable rules: numbers derive from setup-order position, never stored anew; badge never replaces rank; marker field stays stored but presentation-unused).

## Expected File Changes

- `src/roster.js` — modify: add `playerNumbers(game)`.
- `src/main.js` — modify: derivation threading + token sources + aria-labels + score-card subtitle (render-only).
- `src/styles.css` — modify: additive `.score-selected-number`.
- `scripts/roster-test.mjs` — modify: additive `playerNumbers` cases (no existing assertion touched).
- `scripts/browser-podium-test.mjs` — modify: one honest label assertion + supersession comment.
- `scripts/browser-game-activity-test.mjs` — modify: one honest label assertion + supersession comment.
- `scripts/browser-player-numbers-test.mjs` — new focused suite.
- `package.json` — add `test:browser:player-numbers`; chain into `test`.
- `init.sh` — add the new script to the `node --check` list.
- `README.md`, `ARCHITECTURE.md`, `CONSTRAINTS.md` — document per Technical Approach.
- `docs/specs/show-player-numbers.md` — this spec (belongs to this feature's PR).
- **Byte-untouched (verified via git diff)**: `index.html`; `src/score.js`, `src/storage.js`, `src/standings.js`, `src/game.js`; `scripts/smoke.mjs`, `scripts/static-server.mjs`, `scripts/browser-test-utils.mjs`; all pre-existing suites except the two named one-line updates (roster, score, rank, undo, resume, storage-failure, finish-game, play-again, design-system, game-title, quick-score browser suites and all unit suites except roster-test's additive cases). No new `src/*` module, so the static-server allowlist, smoke assets, and required-file list are unchanged.

## Visual Design Impact

- UI involved: yes — setup (unchanged, pinned), active view (leaderboard, score card, recent entries), finished view, podium dialog.
- Design source: `DESIGN.md` + `docs/design/update-v2/new_game_setup/screen.png`, `active_game_scorekeeper/screen.png`, `end_of_game_podium_summary/screen.png`.
- Screens/states affected: active and finished games at 1280×800 and 320×720 (also render under storage suppression).
- New design artifact required: no — existing tokens cover everything; the only visual delta is the small muted subtitle.

## Durable Documentation Impact

- `CONSTRAINTS.md`: update — durable rules: badge numbers derive from setup-order array position at render and are never persisted anew; the stored `marker` field stays written but presentation-unused; badges never replace rank; numbers are a display aid, never identity or scoring input.
- `ARCHITECTURE.md`: update — `playerNumbers` derivation boundary, the render-only wiring, the new suite.
- `README.md`: update — user-visible badge behavior + `npm run test:browser:player-numbers`.
- `AGENTS.md`: not needed — no workflow/startup change. `CONTEXT.md`/`docs/domain-model.md`/`docs/build-brief.md`: not needed — they already state the rule; this spec implements it. `docs/risks-and-open-questions.md`: not needed (precedent — the Decisions section above is the closure record).

## Implementation Plan

1. Land `playerNumbers` in `src/roster.js` + additive unit cases; run `npm run test:roster`.
2. Land the `src/main.js` render wiring and the `.score-selected-number` style; run `node --check src/main.js src/roster.js`; walk Scenarios 1–5 by hand in `npm run dev` at 1280×800 and 320×720.
3. Apply the two honest suite updates; write `scripts/browser-player-numbers-test.mjs`; wire `package.json` + `init.sh`; run the full verification plan, confirm the byte-untouched floor via `git diff`, update docs, record evidence.

## Implementation Tasks

- [ ] `src/roster.js`: add `playerNumbers(game)` with guards and a derivation comment (Decision 1).
- [ ] `scripts/roster-test.mjs`: additive cases — 1..N mapping, guard emptiness, input immutability, replay-shaped arrays; summary line updated.
- [ ] `src/main.js`: thread `playerNumbers` through `renderActiveGame`/`renderFinishedGame`/`renderPodiumDialog`/`renderRecentEntries`; switch the five token sites to the derived number; rename the four aria-labels to `Player {n}, {color.label}`; add the score-card `Player {n}` subtitle. No handler/state/save-path changes.
- [ ] `src/styles.css`: add `.score-selected-number` (additive only).
- [ ] Honest updates: `scripts/browser-podium-test.mjs:332` and `scripts/browser-game-activity-test.mjs:399` → `Player 1, Blue` with supersession comments.
- [ ] `scripts/browser-player-numbers-test.mjs` — Session A (setup): duplicate names/colors, remove-row renumber, start → badges 1..3 in setup order, storage shape unchanged. Session B (active/finish): score-card badge + `Player {n}` subtitle, leaderboard rank-vs-badge with 12/12/8 and a reordering save, recent-entries badge, finish → podium + finished standings badges. Session C (persistence/derivation): reload-resume badge stability; replay renumbers 1..N; seeded `marker: "7"` record renders badge 1 / label `Player 1, Blue` with a byte-identical payload. Session D (a11y/responsive): token labels `Player {n}, {color}` everywhere, names visible, 320×720 + 1280×800 overflow/target/focus checks, zero console errors.
- [ ] `package.json` + `init.sh`: wire the new suite.
- [ ] Update `README.md`, `ARCHITECTURE.md`, `CONSTRAINTS.md`.
- [ ] Run the verification plan; record evidence in `feature_list.json`/`PROGRESS.md` (implementer/validator step, not this planner).

## Verification Plan

- `node --check` on touched sources and the new suite (covered by `init.sh`).
- `npm run test:roster` — passes with the additive `playerNumbers` cases and every pre-existing assertion unmodified.
- `npm run test:browser:player-numbers` (new, real headless Chrome, 1280×800 + 320×720): Sessions A–D with `readSavedGamesState` proofs (byte-identical payload across badge renders and the corrupt-marker session).
- `npm run test:browser:podium` and `npm run test:browser:game-activity` — pass with exactly the one honest line each; every other pre-existing suite runs green **byte-untouched**.
- `CI=true ./init.sh` and `./init.sh` — required files, all syntax checks (including the new suite), and the full `npm run test` chain pass; exit without starting a server (a transient Chrome-launch timeout may be retried once).
- `npm run dev` probe — 200 for `/`, `/src/roster.js`, `/src/main.js`, `/src/styles.css`; 404 for `/AGENTS.md`.
- Screenshots (setup badges, active leaderboard + score card, podium) into the evidence dir; programmatic assertions carry the proof as established.
- Disclosure: physical keyboards/touch cannot be exercised headless; keyboard contracts are verified via CDP real-key walks, consistent with prior features. `init.sh` executes the non-blocking standard gate only and must not start a long-running server.

## Evidence To Capture

- Exact commands and results for `test:roster`, the new browser suite, the two honestly-updated suites, `npm run test`, both gate modes, and the dev probe.
- A statement that `index.html`, `src/score.js`, `src/storage.js`, `src/standings.js`, `src/game.js`, `scripts/smoke.mjs`, `scripts/static-server.mjs`, `scripts/browser-test-utils.mjs`, and all pre-existing suites except the two named one-line updates are untouched (0-line diffs); the envelope version stayed `1`; `persistActiveGameSnapshot` still has exactly six call sites; no new persisted fields.
- Screenshots + programmatic assertion summaries (setup renumber, rank-vs-badge, subtitle, corrupt-marker degradation, aria-label list, 320px checks).
- Appended `feature_list.json` evidence entries and a `PROGRESS.md` session-log entry.

## Validator Checklist

- [ ] Badge numbers derive from setup-order array position via `playerNumbers` (Decision 1): stable across resume, renumber-on-remove pre-start, replay renumbers 1..N, corrupt markers degrade positionally; zero new persisted fields; `src/storage.js` 0-line diff; envelope version 1; the stored `marker` field still written exactly as accepted (`src/game.js` untouched, `game-test.mjs` unmodified).
- [ ] Surface treatment matches Decision 2 (setup pinned, leaderboard rank+badge, score-card subtitle, recent entries, podium, finished standings, home cards unnumbered, no badges elsewhere).
- [ ] Visual matches Decision 3 (existing token system, player color, white/yellow outlines, additive subtitle style only).
- [ ] Accessibility matches Decision 4: `Player {n}, {color}` labels at the four token sites; all frozen labels byte-identical (`Add points for {name}`, `Points for {name}`, `{name}: rank {rank}, total {total}`, `Remove player {n}`, `Color for player {n}`); names always visible beside badges.
- [ ] Rank interplay matches Decision 5 (12/12/8 → ranks 1, 1, 3 with setup-order badges; badges invariant under score changes).
- [ ] Exactly two honest pre-existing-suite updates (podium, game-activity) with supersession comments; `test:roster` changes are additive only; every other suite byte-untouched and green; smoke strings and design-system contracts hold; no unrelated feature work (no podium actions, no distribution bar, no decoration).
- [ ] README/ARCHITECTURE/CONSTRAINTS updated; evidence recorded with real commands and results.
