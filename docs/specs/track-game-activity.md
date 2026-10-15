# Feature Implementation Spec: Track activity timestamps and show recent entries

## Source Feature

- `id`: `track-game-activity`
- `area`: `game`
- `depends_on`: `refresh-design-system` (accepted and merged, PR #16); `name-game-titles` (accepted and merged, PR #17 — the branch's base already contains it)
- `status`: `not_started` at planning time
- `source`: `feature_list.json`

## Goal

Games surface when they last changed and what changed recently, entirely as views over already-stored data: dashboard cards show "Updated just now / 10m ago / 3h ago / 2d ago" (deterministic absolute `{d MMM, HH:mm}` beyond 7 days), and the active game gains a "Recent entries" panel in the score-entry sidebar showing the score-change log newest first — each row with the player token, name, signed amount (`+5 pts` / `-2 pts`), and a relative time — with a `Last: {name} {signedAmount}` header (e.g. `Last: Alex +5`) providing undo context. Recent entries derive from the stored change sequence and last-activity is the storage-owned `updatedAt`; neither introduces new game-level state.

## Non-Goals

- No winner/top-score line on finished cards (mockup content with no feature owner).
- No quick tap counters / signed stepper (belongs to `add-quick-score-entry`); no player-number badges, distribution bar, or podium actions.
- No live-refresh ticker: relative labels recompute only on re-render (every mutation already re-renders); a stale open tab ages its labels on the next interaction.
- No per-entry editing, filtering, pagination, or jump-to-undo control; the panel is display-only with zero interactive controls.
- No timestamp migration, no new storage key, no envelope change; `isUsableGameEntry` keeps ignoring timestamps.
- No changes to score bounds, validation, error messages, undo depth (latest-only), or any of the accepted behaviors.
- **Must not change** (regression floor): smoke strings and `index.html` (untouched); `src/storage.js`, `src/standings.js`, `src/roster.js` (untouched); `persistActiveGameSnapshot()` semantics (suppression/rollback/notice/clearing — and its six triggers stay exactly six); the design-system suite's nav matrix and byte-identical write-absence proofs; the byte-identity proofs in the undo/resume/finish/podium/play-again/game-title suites; all exact accepted copy (including the card `/^Updated /` prefix assertions); breakpoints, reduced-motion rules, focus contracts, suite-frozen `--muted`; the 11+2 accepted features' behavior.

## Job Story

When I come back to the table after a break (or reopen the app the next day),
I want to see how fresh each saved game is and what the last few score changes were,
so I can trust the totals before I add the next points or undo a mistake.

## Users And Permissions

- Scorekeeper: the only actor. All data stays in the same browser-local storage; no new permissions, accounts, or network behavior.

## Product Decisions Resolved For This Slice

These close the `docs/risks-and-open-questions.md` item "Relative timestamps" and the in-scope implementation-time choices.

### Decision 1 — What counts as activity, and where last-activity lives

- **Last-activity is the existing storage-owned `updatedAt`** stamped by `upsertSavedGame` on every successful mutation persist. The six save triggers (start, score save, undo, finish, play again, title rename) are exactly the activity set; **no new trigger and no new game-level field**. This satisfies the domain rule "no parallel state".
- Activity means: score change, undo, finish, rename, game start, replay creation (the new game's own first persist). **Not** activity: navigation (Dashboard/New Game/Active Game), resume (read-only restore), opening/canceling the finish prompt or title edit, podium open/dismiss, player selection, failed writes (rollback restores the previous `savedGames`).
- **Undo updates last-activity** — it is a mutation and persists, so `updatedAt` refreshes.
- Finished games freeze: the finish persist is their last write, so their `updatedAt` stops advancing. Play again never re-persists the original (existing byte-identical proof), so the original's stamp is untouched.

### Decision 2 — Per-entry timestamps and storage shape

- `applyScoreChange` gains an injectable clock — signature `applyScoreChange({ game, playerId, amount, now = new Date() })` (same `now = new Date()` precedent as `finishGame`/`replayGame`) — and stamps each new change entry with **`at: now.toISOString()`**. Change entries become `{ id, playerId, amount, at }`.
- ISO strings match `createdAt`/`updatedAt` typing and keep JSON stable; per-change `at` is required because per-entry relative times must survive reload (game-level `updatedAt` alone cannot date older entries).
- Envelope `version` stays `1`; `src/storage.js` is untouched; no migration. Legacy/hand-seeded changes without `at` remain usable entries and render a muted `—` in the time cell.

### Decision 3 — Relative-time scheme (one deterministic formatter)

New export `formatRelativeTimestamp(value, now = new Date())` in `src/game.js`, reusing the private `formatTitleStamp` month-array for the absolute branch — no `toLocaleString`, no locale drift:

| Age of the stamp (relative to `now`) | Returned token |
|---|---|
| non-string / unparseable | `null` (callers pick their fallback) |
| < 1 minute (including clock skew, diff ≤ 0) | `just now` |
| < 1 hour | `{m}m ago` (floored minutes) |
| < 24 hours | `{h}h ago` (floored hours) |
| < 7 days | `{d}d ago` (floored days) |
| ≥ 7 days | `{d MMM, HH:mm}` (identical to the title auto-label format, local time) |

Justification: minutes-based `Date` math is timezone-independent; the single absolute branch mirrors the accepted `displayGameTitle` precedent (`12 Oct, 21:08`), which the dashboard mockup itself uses for older games. Thresholds are simple, testable boundaries (59 999 ms → `just now`, exactly 60 000 ms → `1m ago`).

- **Cards** (`formatSavedGameUpdated` rewrite in `src/main.js`): try `updatedAt`, then `createdAt`; first parseable stamp renders `Updated {token}` — e.g. `Updated just now`, `Updated 10m ago`, `Updated 12 Oct, 21:08`; if none parse, keep the existing bare `Updated` fallback. The existing `toLocaleString` implementation is replaced.
- **Entry time cells**: the token with an initial capital — `Just now`, `2m ago`, `5m ago`, `12 Oct, 21:08`. Entries lacking a parseable `at` render `—` (muted).
- **Finished-card treatment**: finished cards use the same `Updated {token}` scheme; because their stamp is frozen, the label simply ages (`Updated 2h ago` → later `Updated 3d ago`). Chosen over an absolute-only finished treatment: one code path, matches the mockup's majority pattern (four of its five finished cards read "Updated …"), and the agreed behavior text is "Updated Xm ago" on cards. The mockup's one-off `Finished yesterday` variant is decoration.

### Decision 4 — Recent entries panel

- New pure helper in `src/score.js`: `recentScoreChanges({ game, limit = RECENT_ENTRIES_LIMIT })` with **`RECENT_ENTRIES_LIMIT = 8`** — returns the newest `limit` changes as `{ change, player }` pairs, **newest first**, skipping changes whose `playerId` resolves to no player; input never mutated (`slice`/`reverse` on copies). Cap justification: games can log 30+ changes; 8 keeps the sidebar scannable without pagination (the mockup's 3 rows are illustrative).
- Placement: inside the score panel of the **active view only**, between the score form and the finish section (`${renderScoreForm(...)}${renderRecentEntries(game)}${renderFinishSection()}`). Finished views show no panel (read-only); replays start with the empty state.
- Markup: a `.recent-entries` block — header row with the eyebrow `Recent entries` and the right-aligned context line **`Last: {name} {signedAmount}`** (e.g. `Last: Alex +5`, no "pts" in the header), then a list (`aria-label="Recent entries"`) of rows: player token (existing `.player-token` classes + `Player marker {marker}, {color}` aria-label convention), escaped name, signed amount `{+|-}{amount} pts` (zero is impossible — `parseScoreAmount` rejects it), relative time right-aligned.
- Empty state (no renderable changes): a single muted line, **"No score changes yet."** — deliberately distinct from the undo info message "Nothing to undo yet."; the `Last:` header renders only when at least one entry renders.
- Undo interaction: purely derived — undo pops the newest change and re-renders, so the entry disappears and `Last:` shows the post-undo latest automatically. No new live region: `#score-feedback` already announces saves/undoes ("Added 5 points to Alex…", "Undid …"), and a second region would double-announce. Amounts may optionally use the success/error token colors provided the sign character is always visible (never color alone) and AA contrast holds.
- Signed-amount formatting is a small display helper in `src/main.js` (positive amounts get an explicit `+`).

### Decision 5 — What does not change

Card DOM structure stays as-is (only the `.saved-game-updated` text changes — the mockup's single-line "4 players · Updated 10m ago" layout is not restructured, keeping every card assertion and the visual rhythm intact). No new focusable controls exist, so no target-size or focus-order work is needed for the panel.

## Acceptance Scenarios

### Scenario 1: Score entries appear newest first with undo context

Given an active game with at least one scored change
When the scorekeeper saves +5 for Alex and then +10 for Sam
Then the Recent entries panel lists Sam +10 pts above Alex +5 pts, each with a relative time (`Just now` for the newest), and the header reads `Last: Sam +10`; the leaderboard, feedback region, and save flow behave exactly as accepted.

### Scenario 2: Timestamps persist and survive reload

Given a game scored earlier (seeded stamps for determinism)
When the scorekeeper reloads and resumes it
Then each entry keeps its relative time computed from its stored `at`, the dashboard card shows `Updated Xm ago`, and a further score change refreshes the card recency and prepends the new entry — with no storage migration and the envelope still `{ version: 1, games }`.

### Scenario 3: Undo removes the newest entry and updates activity

Given two entries (Alex +10, Sam +5) with `Last: Sam +5`
When the scorekeeper activates Undo last score
Then the Sam entry disappears, `Last:` shows the post-undo latest (`Last: Alex +10`), Sam's total and ranks are restored exactly as accepted, the stored payload reflects the shortened log with a fresh `updatedAt`, and a no-op undo ("Nothing to undo yet.") leaves storage byte-identical.

### Scenario 4: Finished games freeze; replays start clean

Given a finished game
When its card and the home lists render
Then the card shows `Updated {token}` from the frozen finish-time stamp, the finished view shows no Recent entries panel, and Play again opens a game whose panel reads "No score changes yet." while the finished original's stored entry stays byte-identical.

### Scenario 5: Corrupt and legacy timestamps degrade gracefully

Given (a) a seeded game whose change entries predate this feature (no `at`) and (b) a seeded game with a missing or unparseable `updatedAt` but a usable `createdAt` (and a variant with neither)
When they are listed and resumed
Then (a) renders every row with a muted `—` time cell and a working panel, and (b) renders `Updated {token}` from `createdAt` or the bare `Updated` fallback — no dropped entries, no corruption, no rewrite of the stored payload on load.

### Scenario 6: Responsive, keyboard, and console baseline

Given 320×720 and 1280×800 viewports on the home (both card lists) and the active view with entries
Then there is no horizontal overflow, the panel introduces no focusable elements (Tab order unchanged), muted text meets AA contrast via existing tokens, and there are zero uncaught console errors.

## Repository Research

### Files Inspected

- `AGENTS.md`, `PROGRESS.md`, `feature_list.json` (`track-game-activity` entry, lines 337–352) — workflow, scope, verification items.
- `docs/build-brief.md` (v2 bullets: recent entries newest first + relative times; "Updated Xm ago"), `docs/domain-model.md` (last-activity timestamp; recent entries/undo derive from the change sequence — no parallel state; finished games read-only; replay copies no timestamps), `docs/risks-and-open-questions.md` (relative formatting + corrupt-timestamp degradation are the open decisions this spec resolves).
- `DESIGN.md` + mockups `docs/design/update-v2/active_game_scorekeeper/screen.png` (RECENT ENTRIES header with `Last: Alex +5`; rows token/name/`+5 pts`/`Just now`·`2m ago`·`5m ago`; panel between Undo and Finish) and `scorekeeper_dashboard/screen.png` (`Updated 10m ago` recent, `Updated 12 Oct, 21:08` older, both card types).
- `docs/specs/name-game-titles.md` and `refresh-design-system.md` — structure/style convention; deterministic-formatter and honest-update precedents.
- `src/roster.js` — `createGame` stamps `createdAt` (ISO string); games start with no `changes` property. Untouched by this feature.
- `src/score.js` — `applyScoreChange` builds `{ id, playerId, amount }` via `createChangeId()`; `undoLastScoreChange` pops the last entry. Both gain behavior here.
- `src/game.js` — `finishGame`/`replayGame` (`now = new Date()` injectable-clock precedent), `renameGame`, `displayGameTitle` + private `formatTitleStamp`/`TITLE_STAMP_MONTHS` (reused by the new formatter).
- `src/storage.js` — envelope v1, `upsertSavedGame` stamps `updatedAt` on the stored copy, `isUsableGameEntry` ignores unknown fields, `orderSavedGamesForDisplay` orders by updatedAt desc. **Untouched.**
- `src/main.js` (1436 lines) — `formatSavedGameUpdated` (lines 415–436, the `toLocaleString` label this feature replaces); `renderSavedGameCard`/`renderFinishedGameCard` (`.saved-game-updated` consumers); `renderActiveGame`'s score-panel composition; `handleScoreSubmit`/`handleUndo` (already persist + re-render — no handler changes needed); the six-save-trigger `persistActiveGameSnapshot()`.
- `scripts/smoke.mjs` — static-markup restrictions (`index.html` untouched here, so they hold).
- Test contracts: `scripts/score-test.mjs` (line 211: exact change-key list `["amount", "id", "playerId"]`), `scripts/storage-test.mjs` (line 262: same list after a round trip), `scripts/game-test.mjs` (finished-keys equality — no game fields added, holds), `scripts/browser-resume-test.mjs` + `browser-finish-game-test.mjs` (card labels asserted as `/^Updated /` regex — hold), `browser-play-again-test.mjs` (`.changes` property/length assertions — hold), `browser-undo-test.mjs` (within-session byte-identity — holds), `browser-design-system-test.mjs` (`buildSeededGame` seeds `changes: []` and explicit stamps; nav-matrix write-absence proofs unaffected), `browser-storage-failure-test.mjs` (seeded corrupt payloads; within-session byte-identity — holds).
- `package.json` (test chain), `init.sh` (required files + `node --check` list — no new `src/*` module, so only the new suite is appended).

### Existing Patterns To Follow

- One new focused browser suite per feature (`scripts/browser-game-activity-test.mjs`), wired as an npm script, chained into `npm run test`, and added to `init.sh`'s `node --check` list; no new `src/*` module means no static-server/smoke/allowlist/required-file changes.
- Deterministic rendering with an injectable clock and no locale APIs (`displayGameTitle` precedent); unit tests anchor ISO strings and pass fixed `now` values.
- Seeded-storage browser sessions (design-system `buildSeededGame` shape) for timestamp determinism; seed relative stamps with a safety margin (e.g. `now − 10 min − 5 s` asserts `10m ago`) so floor math stays stable during the run.
- Honest, spec-driven suite updates with supersession comments and updated summary lines — never silent weakening.

### Current Gaps

- Change entries carry no timestamp, so per-entry ages cannot survive reload; cards render an absolute locale-formatted label instead of recency; no recent-entries view exists.

## Technical Approach

1. **`src/score.js`**: add `now = new Date()` to `applyScoreChange` and stamp `at: now.toISOString()` on the created change; export `RECENT_ENTRIES_LIMIT = 8` and pure `recentScoreChanges({ game, limit = RECENT_ENTRIES_LIMIT })` (newest-first `{ change, player }` pairs, unresolvable players skipped, input untouched).
2. **`src/game.js`**: export `formatRelativeTimestamp(value, now = new Date())` implementing Decision 3, with the ≥7-day branch reusing `formatTitleStamp`.
3. **`src/main.js`**: rewrite `formatSavedGameUpdated` to the `updatedAt → createdAt → bare "Updated"` walk with `Updated {token}`; add `renderRecentEntries(game)` (Decision 4 markup + a private signed-amount helper) inserted between the score form and the finish section. **No handler, save-trigger, focus, or copy changes anywhere else** — saves and undos already re-render.
4. **`src/styles.css`**: additive `.recent-entries*` classes only (header row, list rows as a token/name/amount/time grid, muted time cells using the suite-frozen `--muted`); a scoped ≤360px compaction so amount and time never collide; no changes to existing selectors, tokens, breakpoints, or motion rules.
5. **Tests**: the two honest key-list updates plus new unit cases; new `scripts/browser-game-activity-test.mjs` (Decision-marked sessions below); wire `package.json` + `init.sh`.
6. **Docs**: README (recency labels, entries panel, new command), ARCHITECTURE (formatter/`recentScoreChanges` boundaries, per-entry `at`, entries display block), CONSTRAINTS (durable rules: `updatedAt` is the sole last-activity source, per-change `at` required for new entries, deterministic no-locale formatting, `—`/`—`-style graceful degradation, finished stamps freeze).

## Expected File Changes

- `src/score.js` — modify: `now` param + `at` stamp; `recentScoreChanges`; `RECENT_ENTRIES_LIMIT`.
- `src/game.js` — modify: export `formatRelativeTimestamp`.
- `src/main.js` — modify: `formatSavedGameUpdated` rewrite; `renderRecentEntries` + signed-amount helper; one composition line in `renderActiveGame`.
- `src/styles.css` — modify: additive `.recent-entries*` classes (and their ≤360px compaction) only.
- `scripts/score-test.mjs` — modify (honest): key list `["amount", "id", "playerId"]` → `["amount", "at", "id", "playerId"]` with a supersession comment; new `applyScoreChange` `at`-stamp and `recentScoreChanges` cases; summary line updated.
- `scripts/storage-test.mjs` — modify (honest): the round-trip key list at line 262 gains `"at"` with a supersession comment; nothing else; summary line updated. (Unlike name-game-titles, `test:storage` is **not** untouched this time — this is the only storage-suite delta and it asserts shape, not behavior.)
- `scripts/game-test.mjs` — modify: new `formatRelativeTimestamp` bucket/boundary/fallback cases and an `applyScoreChange` injected-`now` case; existing assertions (finished-keys equality, undo deep-equals, replay no-log) hold unchanged; summary line updated.
- `scripts/browser-game-activity-test.mjs` — new focused suite.
- `package.json` — add `test:browser:game-activity` and chain it into `test`.
- `init.sh` — add the new script to the `node --check` list.
- `README.md`, `ARCHITECTURE.md`, `CONSTRAINTS.md` — document per Technical Approach.
- `docs/specs/track-game-activity.md` — this spec (belongs to this feature's PR).
- **Unchanged (byte-untouched)**: `index.html`, `src/storage.js`, `src/standings.js`, `src/roster.js`, `scripts/smoke.mjs`, `scripts/static-server.mjs`, `scripts/browser-test-utils.mjs`, and all pre-existing browser suites (`browser-roster/rank/score/undo/resume/storage-failure/finish-game/podium/play-again/design-system/game-title-test.mjs` — verified: their card assertions are `/^Updated /` regexes, their `.changes` checks are property accesses, their byte-identity proofs are within-session, and the design-system seeds carry `changes: []`).

## Visual Design Impact

- UI involved: yes — both dashboard card lists (time text only) and the active view's score panel (new Recent entries block).
- Design source: `DESIGN.md` + `docs/design/update-v2/` mockups; the empty state, `—` fallback cell, and exact thresholds have no mockup (implementation-time treatment per Decisions 3–4, existing tokens only).
- Screens/states affected: home (ongoing + finished cards), active game (entries panel; also renders under storage suppression with in-memory data).
- New design artifact required: no — token system covers it; no new motion.

## Durable Documentation Impact

- `CONSTRAINTS.md`: update — durable rules: last-activity is storage-owned `updatedAt` (no parallel state; the six save triggers are the activity set); new change entries must carry `at`; relative formatting must stay deterministic (no locale APIs) with the locked thresholds; missing/corrupt stamps degrade (`createdAt` fallback → bare `Updated`; `—` entry cells); finished stamps freeze and are never re-persisted by replay.
- `ARCHITECTURE.md`: update — `formatRelativeTimestamp` and `recentScoreChanges` boundaries, per-change `at`, the entries display block in the score panel, new suite.
- `README.md`: update — user-visible recency + entries behavior and `npm run test:browser:game-activity`.
- `AGENTS.md`: not needed — no workflow or startup change. `CONTEXT.md`/`docs/domain-model.md`/`docs/build-brief.md`: not needed — they already state these rules; this spec implements them.

## Implementation Plan

1. Land the pure layer: `score.js` (`at` stamp + `recentScoreChanges`) and `game.js` (`formatRelativeTimestamp`); update `score-test.mjs`/`storage-test.mjs` honestly and extend `game-test.mjs`; run `npm run test:score`, `npm run test:game`, `npm run test:storage`.
2. Wire the display layer in `main.js` (`formatSavedGameUpdated` rewrite, `renderRecentEntries` insertion) and the additive CSS; walk Scenarios 1–5 by hand in `npm run dev` at both widths, including a seeded legacy no-`at` record.
3. Write `scripts/browser-game-activity-test.mjs` (seeded-stamp sessions per the scenarios, byte-identity proofs for no-op undo and blocked writes); wire `package.json` + `init.sh`.
4. Run the full verification plan; update README/ARCHITECTURE/CONSTRAINTS; record evidence.

## Implementation Tasks

- [ ] `src/score.js`: `applyScoreChange({ game, playerId, amount, now = new Date() })` stamps `at: now.toISOString()`; export `RECENT_ENTRIES_LIMIT = 8` and `recentScoreChanges` (newest first, player-resolved, skipping unresolvable players, non-mutating).
- [ ] `src/game.js`: export `formatRelativeTimestamp(value, now = new Date())` with the Decision 3 table (absolute branch reuses `formatTitleStamp`).
- [ ] `scripts/score-test.mjs`: honest key-list supersession; injected-`now` `at` assertions; `recentScoreChanges` cases (cap/order/skip/immutability/empty guards); summary line.
- [ ] `scripts/storage-test.mjs`: honest key-list supersession on the round-trip assertion; summary line.
- [ ] `scripts/game-test.mjs`: `formatRelativeTimestamp` buckets/boundaries (59 999 ms → `just now`, 60 000 ms → `1m ago`, hour/day/week edges, ≥7 d absolute equality with the auto-label format, future skew → `just now`, unusable input → `null`); summary line.
- [ ] `src/main.js`: `formatSavedGameUpdated` → deterministic `Updated {token}` with `createdAt` fallback and bare `Updated` fallback; `renderRecentEntries` (Decision 4 markup, `aria-label="Recent entries"`, empty state, `—` cells) inserted between the score form and finish section; private signed-amount helper.
- [ ] `src/styles.css`: additive `.recent-entries*` classes + ≤360px compaction; nothing existing modified.
- [ ] `scripts/browser-game-activity-test.mjs`: isolated Chrome sessions covering Scenarios 1–6 — seeded stamps with floor-math margins, exact relative labels, undo/`Last:` derivation with byte-identical no-op proof, finished freeze + untouched replay original, legacy no-`at` rows and corrupt-stamp cards, blocked-write notice with unchanged copy and code-only warnings, 320×720/1280×800 overflow + zero console errors.
- [ ] `package.json` + `init.sh`: wire the new suite.
- [ ] Update `README.md`, `ARCHITECTURE.md`, `CONSTRAINTS.md`.
- [ ] Run the verification plan; record evidence in `feature_list.json`/`PROGRESS.md` (implementer/validator step, not this planner).

## Verification Plan

- `node --check` on all touched sources and test scripts (covered by `init.sh`).
- `npm run test:score`, `npm run test:game` — updated/new unit cases pass. `npm run test:storage` — passes with exactly the one honest key-list update (envelope version, entry validation, and save/load behavior unchanged).
- `npm run test:browser:game-activity` (new, real headless Chrome, 1280×800 + 320×720): Scenarios 1–6 as isolated seeded sessions with `readSavedGamesState` byte-identity proofs (no-op undo, cancel-free surfaces, replay original) and the blocked-write/notice regression.
- `CI=true ./init.sh` and `./init.sh` — required files, all syntax checks (including the new suite), and the full `npm run test` chain pass; exit without starting a server. All pre-existing suites run green; the only modified pre-existing suites are `score-test.mjs` and `storage-test.mjs` (both spec-mandated honest updates listed above); every other pre-existing suite is byte-untouched (a transient Chrome-launch timeout may be retried once).
- `npm run dev` probe — 200 for `/`, `/src/score.js`, `/src/game.js`, `/src/main.js`; 404 for `/AGENTS.md`.
- Screenshots (home cards with relative + absolute stamps, active view with the entries panel at both widths, undo context after an undo) into the evidence dir; programmatic assertions carry the proof as established.
- Disclosure: real-device clocks/timezones cannot be varied headless; determinism is verified via seeded stamps and the injectable `now`, consistent with the `displayGameTitle` precedent.

## Evidence To Capture

- Exact commands and results for the unit suites, the new browser suite, `npm run test`, both gate modes, and the dev probe.
- A statement that `index.html`/`src/storage.js`/`src/standings.js`/`src/roster.js` are untouched (0-line diffs), the envelope version stayed `1`, and the only pre-existing-suite changes were the two honest key-list updates with supersession comments.
- Screenshots + programmatic assertion summaries (exact relative labels from seeded stamps, entries order/`Last:` derivation, `—` fallback rows, 320px, byte-identity proofs).
- Appended `feature_list.json` evidence entries and a `PROGRESS.md` session-log entry.

## Validator Checklist

- [ ] Last-activity is the untouched storage-owned `updatedAt`; no new game-level field, no seventh save trigger, no parallel state; navigation/resume write nothing.
- [ ] New change entries carry `at` (ISO string, injectable `now`); undo pops and persists; no-op undo and all navigation keep byte-identical payloads; the replay original stays byte-identical.
- [ ] `formatRelativeTimestamp` matches Decision 3 exactly (thresholds, floor math, `just now` for skew, `null` fallback, absolute branch equal to the auto-label format) with no `toLocaleString` anywhere on these surfaces.
- [ ] Cards: `updatedAt → createdAt → bare "Updated"` fallback chain; `/^Updated /` prefix assertions still hold; finished cards age from the frozen stamp; no card DOM restructuring.
- [ ] Entries panel matches Decision 4 (placement, header `Last: {name} {signedAmount}`, newest-first rows with token/name/`{sign}{amount} pts`/relative time, cap 8, skip rule, empty-state copy distinct from "Nothing to undo yet.", `—` cells, no focusable controls, no new live region); finished views show no panel.
- [ ] The two honest suite updates are spec-driven and nothing else in the pre-existing suites changed; smoke strings, nav matrix, write-absence proofs, `--muted`, breakpoints, and the 11+2 accepted behaviors hold.
- [ ] 320px/desktop checks pass; no horizontal overflow; zero uncaught console errors; README/ARCHITECTURE/CONSTRAINTS updated; no unrelated feature work (no counters, no winner/top-score line, no badges, no distribution, no podium actions).
