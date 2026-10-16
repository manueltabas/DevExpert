# Feature Implementation Spec: Show score distribution under the leaderboard

## Source Feature

- `id`: `show-score-distribution`
- `area`: `scoring`
- `depends_on`: `refresh-design-system` (accepted and merged, PR #16); the branch base (`codex/show-score-distribution` off latest `origin/main`) also contains the merged `name-game-titles` (PR #17), `track-game-activity` (PR #18), `add-quick-score-entry` (PR #19), and `show-player-numbers` (PR #20)
- `status`: `not_started` at planning time
- `source`: `feature_list.json` (lines 422–437)

## Goal

The active game's leaderboard panel gains a **score distribution block** under the leaderboard rows: a stacked horizontal bar with one segment per player in their token color, ordered like the leaderboard, plus a real-text legend of `"{name} {percent}%"` entries, and a header row reading "Score distribution" with "{N} total game points". The bar gives the scorekeeper an at-a-glance read of who holds the points without mental math.

Distribution is **derived data computed from current totals at render time — never persisted** (docs/domain-model.md line 13). Every leaderboard render recomputes it; entries, undo, and reorders re-derive it for free. Zero new storage fields, zero new save triggers.

## Non-Goals

- No distribution in the **finished view, podium dialog, home cards, setup, or active-empty view** (Decision 6 — active view only).
- No persisted fields, no `src/storage.js` changes, no envelope/migration work, no new save trigger.
- No changes to rank/tie logic (`rankPlayers`/`podiumRows` untouched), undo semantics, score parsing, quick counters/stepper, recent entries, titles, or player-number badges.
- No interactivity in the block: no buttons, no focusables, no new live region, no tooltips/drill-down.
- No mockup decoration: the mockup's "Round active" subtitles and sample data are illustrative; mockup copy for this block is adopted only where Decision 4 locks it.
- **Must not change** (regression floor): `index.html`; `src/score.js`, `src/storage.js`, `src/roster.js`, `src/game.js` (0-line diffs); the **exactly six** `persistActiveGameSnapshot()` call sites; smoke strings; the design-system nav matrix, write-absence proofs, and frozen `--muted #6D655C`; all byte-identity proofs; the `[data-recent-entries]` display-only contract; frozen labels (`Add points for {name}`, `Points for {name}`, `{name}: rank {rank}, total {total}`, `Player {n}, {color}`, quick-counter names); the 720/480/360 breakpoints and reduced-motion rules; all 13 accepted MVP behaviors and the five merged v2 features' suites **byte-untouched** (expected honest pre-existing-suite updates: **zero** — see Repository Research).

## Job Story

When I glance at the leaderboard mid-game,
I want to see each player's share of the points as a labeled bar under the standings,
so I can tell who is ahead and by how much without subtracting totals in my head — including when penalties have put someone in the red.

## Users And Permissions

- Scorekeeper: the only actor. The block is a display-only derivation; no writes, permissions, or network behavior.

## Product Decisions Resolved For This Slice

These close the implementation-time decision documented in docs/risks-and-open-questions.md ("decide what the bar shows when the game total is negative or zero... must not imply a misleading 'leader' when penalties dominate") and docs/domain-model.md's derived-data rule.

### Decision 1 — Negative/zero-total treatment: caption always renders; the bar renders only when the game total is positive (option (a), refined)

- The block **always renders** in the active view with the header row (`Score distribution` / `{N} total game points`), so it never disappears silently.
- The bar + legend render **iff the game total (sum of all player totals, signed) is > 0**. When the total is <= 0 (fresh all-zero game, net 0, or net negative), the bar and legend are replaced by one muted line: **"No shares to show while the game total is zero or negative."** (locked copy).
- **Mixed-sign games with a positive total DO show the bar** (e.g. totals 10, −5, 3 → total 8): penalties mid-game are ordinary play (the −1/−5/−10 counters exist for exactly this), and hiding the whole bar whenever anyone is negative would blank a useful view. In such games only players with **positive totals** appear as segments/legend entries, and the share denominator is the **sum of positive totals** (not the signed game total) so displayed percentages always sum to exactly 100 and can never exceed it. The header still shows the signed net total ("8 total game points"), so nothing is hidden. The bar's implicit leader always equals the leaderboard's rank 1 whenever the bar renders (a positive game total implies the max total is positive), satisfying the risk doc's "no misleading leader" requirement.
- Candidates rejected: **(b)** absolute-value shares — visually promotes a penalized player into a "leader", exactly the failure the risk doc forbids, and needs a disclaimer caption that defeats the at-a-glance purpose; **(c)** positive shares plus negatives aggregated into a muted segment — a second math path (shares of what?), an extra visual treatment, and it still draws negatives inside a "share of total" bar, all for no additional honesty over (a)+positive-only. (a) is the simplest, fully testable treatment.

### Decision 2 — Share math: largest-remainder rounding to integers that sum to exactly 100

- Eligible rows = players with `Number.isFinite(total) && total > 0`, taken from `rankPlayers(game)` order (descending total, competition ties in display order). `gameTotal` = signed sum over all players (`Number.isFinite(total) ? total : 0`; non-object entries contribute 0 — the `playerNumbers` guard precedent).
- Raw share = `total / positiveSum * 100`. Rounding = **largest remainder (Hamilton)**: floor each raw share, then distribute the leftover units (`100 − Σ floors`) one each to the largest fractional remainders, ties broken by display order. Guarantees: displayed percents are integers 0–100, **Σ percent = exactly 100** whenever the bar renders, and the mockup example reproduces exactly (42/35/28/19 of 124 → floors 33/28/22/15 = 98, remainders .87/.23/.58/.32 top up Alex and Jamie → **34/28/23/15**). Naive per-row rounding has no sum guarantee (2/2/2/1/1/1 of 9 → naive 22/22/22/11/11/11 = 99; largest remainder → 23/22/22/11/11/11 = 100).
- **Zero-total players are omitted** from both bar and legend (a 0-width segment is invisible anyway; a "0%" legend row is noise). Their absence is truthful — they hold no points — and the leaderboard still shows them. A positive-total player whose rounded percent is 0 (tiny share in a big game) keeps a legend entry ("{name} 0%") and a 0-width segment, preserving the exact 1:1 segment↔legend correspondence.

### Decision 3 — Tiny-share handling: exact widths, legend carries the detail (no min-width, no aggregation)

- Segment width = `{percent}%` exactly (inline style; integer). No `min-width`: min-width would break the width↔percent correspondence the validator checks, and 20 × min-width segments could distort or overflow the 264px panel at 320px. Tiny shares are never lost because the legend lists every eligible player with name + percent as real text, and it wraps.

### Decision 4 — Composition, placement, and locked copy

| Element | Contract |
|---|---|
| Container | `<div class="score-distribution" data-score-distribution>` inside the active view's `.panel.roster-panel`, immediately after the `<ol class="active-roster">` (main.js:688–690). Not rendered in `renderFinishedGame`. |
| Header row | Eyebrow `Score distribution` (left) + `{N} total game points` (right, signed for negatives: "-4 total game points"), mirroring `.recent-entries-header`. Unconditional `{N}` phrasing even for N = 1 — locked, matches the mockup's "124 total game points"; no pluralization branch. |
| Bar | `<div class="score-distribution-bar" aria-hidden="true">`, one `<span class="score-distribution-segment {color.cssClass}" style="width:{percent}%">` per eligible row in display order. Color classes reuse the existing `marker-blue|red|yellow|green|orange|white|black` backgrounds (styles.css:231–258) so segment colors are the exact player token colors. Yellow/white segments get an additive visible outline (the established dark-outline pattern) so they never vanish on the track. |
| Legend | `<ul class="score-distribution-legend" aria-label="Score distribution">` with one `<li>` per eligible row, same order: aria-hidden color dot (`.marker` + color class) + real text `{name} {percent}%` (`escapeHtml` on names). Color is never the only signal. |
| Degenerate state | Header row stays; below it only `<p class="score-distribution-empty">No shares to show while the game total is zero or negative.</p>` (muted). No bar, no legend, no empty `<ul>`. |

### Decision 5 — Accessibility and liveness

- **Zero focusable elements** inside `[data-score-distribution]` — asserted with the `[data-recent-entries]` scoping precedent (browser-game-activity-test.mjs:286–310). Display-only; tab order untouched.
- The bar is `aria-hidden="true"` (decorative); the **legend is the accessible representation** as real text under the visible "Score distribution" header (labelled `<ul>`, the `aria-label="Recent entries"` precedent). This avoids a `role="img"` summary duplicating the legend announcement.
- No new live region: `#score-feedback` already announces saves/undoes; the block re-renders with the view (saves, undos, selection, reorder) without stealing focus — nothing in it is focusable.
- Contrast: legend text uses `--text` on the panel surface; the count line and degenerate line use `--muted` (suite-frozen `#6D655C`, established AA at 5.6:1). All asserted ≥ 4.5:1 in the new suite.

### Decision 6 — Derived-only wiring; finished-view exclusion

- New pure helper **`scoreDistribution(game)`** in `src/standings.js` (the `podiumRows` precedent) returning `{ gameTotal, rows }`; `rows` is `[]` when `gameTotal <= 0` or no positive totals, else `[{ player, percent }]` referencing the original player objects. Guards for null/undefined/non-object games and non-array/missing players → `{ gameTotal: 0, rows: [] }`. Never mutates the input (structuredClone-proven), returns a fresh array each call, writes no fields.
- `renderActiveGame` derives once per render (`const distribution = scoreDistribution(game);` beside the existing `playerNumbers(game)` call) and a private `renderScoreDistribution(distribution)` emits the block. Recomputed on every render of the active view — nothing cached, nothing persisted.
- **The finished view does NOT get the block** (nor podium/home/active-empty): the feature text and the mockup show it in the active game only; finished standings are a frozen read-only surface with heavy suite coverage (finish-game, podium, play-again, player-numbers) that this tight slice should not churn. The data stays derivable if a future feature wants it.

## Acceptance Scenarios

### Scenario 1: Happy-path bar matches totals (mockup parity)

Given an active game with totals 42, 35, 28, 19 (seeded or UI-scored)
When the leaderboard renders
Then the block shows "Score distribution" + "124 total game points", four segments in leaderboard order colored by each player's token, and legend entries exactly "Alex 34%", "Sam 28%", "Jamie 23%", "Taylor 15%"; every segment's rendered width matches its legend percent (±1px) and the percents sum to 100.

### Scenario 2: Live re-derivation on save, undo, and reorder

Given an active game scored through the real save path
When points are saved, undone, or a save reorders the leaderboard
Then the caption, segments, and legend recompute on the same render with no focus change and no extra announcement; legend order always matches leaderboard row order; selection changes and home→resume navigation re-derive without writing storage (raw payload byte-identical).

### Scenario 3: Zero and negative game totals degrade honestly

Given totals summing to 0 (all zeros; or 5 and −5) or negative (−5, −3)
When the block renders
Then the caption reads "0 total game points" / "-8 total game points" respectively, the bar and legend are absent, and the muted line "No shares to show while the game total is zero or negative." renders.

### Scenario 4: Mixed signs with a positive total never imply a false leader

Given totals 10, −5, 3 (game total 8)
When the block renders
Then the caption reads "8 total game points", the bar shows only the positive players (77% / 23%, sum 100), the negative player appears in neither bar nor legend, and the bar's first segment is the leaderboard's rank 1.

### Scenario 5: Zero-total players are omitted while others scored

Given totals 10, 0, 5 (game total 15)
When the block renders
Then the legend has exactly two entries ("Alex 67%", "Jamie 33%") and the bar has exactly two segments; the zero-total player is absent.

### Scenario 6: Rounding invariant holds on awkward splits

Given totals 2, 2, 2, 1, 1, 1 (game total 9) and 1, 1, 1 (game total 3)
When the block renders
Then percents are 23/22/22/11/11/11 and 34/33/33 respectively — integer legend values equal to segment widths and summing to exactly 100 in both cases (largest-remainder; equal remainders top up in display order).

### Scenario 7: Finished and other surfaces show nothing new

Given a finished game (via Finish game), the podium dialog, home cards, and the active-empty view
When each renders
Then no `[data-score-distribution]` element exists in any of them.

### Scenario 8: Responsive and accessibility baseline

Given 320×720 and 1280×800 viewports, including a seeded 20-player game with mixed signs
When the active view renders
Then there is no horizontal overflow, the legend wraps, widths still match percents, `[data-score-distribution]` contains zero focusable elements, the bar carries `aria-hidden="true"`, legend/count/empty text meets AA contrast, and there are zero uncaught console errors.

## Repository Research

### Files Inspected

- `feature_list.json` (422–437: this entry; verification requires the focused standings suites + gate), `PROGRESS.md` (show-score-distribution is next in list order), `AGENTS.md`, `docs/build-brief.md` (v2 bullet, line 35), `docs/domain-model.md` (line 13: derived, never persisted), `docs/risks-and-open-questions.md` (negative/zero semantics decision), `DESIGN.md` (active-game screen lists "distribution bar"; a11y baseline line 50: never color alone) + `docs/design/update-v2/active_game_scorekeeper/screen.png` (block under leaderboard rows: header pair, 4-segment bar, dot+name+percent legend) — scope and visual source of truth.
- `docs/specs/show-player-numbers.md` (latest accepted v2 spec) — conventions for decisions, regression floor, suite wiring, honest updates.
- `src/standings.js` (28 lines: `rankPlayers`, `podiumRows` — the module this feature extends), `src/roster.js` (`PLAYER_COLORS`/`getColor` with `cssClass`; `playerNumbers` guard precedent), `src/score.js` (exports used; untouched), `src/main.js` (1627 lines: `renderActiveGame` active branch 639–709 with the roster panel 677–691 and `<ol>` 688–690; `renderFinishedGame` 783–831; `renderRecentEntries` 1068–1096 as the display-only-block precedent; `playerNumbers(game)` derived once at 660; no changes needed in handlers/state/`persistActiveGameSnapshot`).
- `src/styles.css` — `.roster-panel` (809), `.active-roster` (813), `.marker` + `marker-*` color classes (222–258: background-only color classes reusable by segments), `.recent-entries*` block (1491–1604: header pair, muted empty state, ≤360px compaction, frozen `--muted`), 720/480/360 breakpoints.
- Test contracts: `scripts/standings-test.mjs` (additive-case convention, summary line), `browser-game-activity-test.mjs` (zero-focusable scoping at 286–310/371–402, seeded-game helpers, byte-identity via `readSavedGamesState`, local `contrastRatio`), `browser-rank-test.mjs` (64–65, 308: reads panel eyebrow/h3 and bounding rect only), `browser-score-test.mjs` (311), `browser-undo-test.mjs` (381), `browser-play-again-test.mjs` (176/189), `browser-design-system-test.mjs` (332) — **none asserts the roster panel's child structure**, so a block after the `<ol>` breaks nothing; `browser-test-utils.mjs` exports (byte-untouched), `package.json` (14-suite test chain), `init.sh` (26-entry `node --check` list → 27).

### Existing Patterns To Follow

- Pure display helpers land in `src` modules with unit tests (`podiumRows`, `playerNumbers`, `recentScoreChanges` precedents) — here `scoreDistribution` in `src/standings.js`.
- One new focused browser suite per feature wired as `npm run test:browser:score-distribution`, chained last into `npm run test`, added to `init.sh`'s `node --check` list; isolated headless-Chrome sessions at 1280×800 and 320×720 with `readSavedGamesState` byte-identity proofs.
- Additive-only CSS (no existing selector/token/breakpoint/motion modified); honest pre-existing-suite updates only with supersession comments — this feature expects **zero**.

### Current Gaps

- No distribution UI exists; `src/standings.js` has no share/percentage helper; the active leaderboard panel ends at the rows.

## Technical Approach

1. **`src/standings.js`**: add `scoreDistribution(game)` per Decisions 1–2 (guards, eligibility, largest-remainder rounding, derivation comment). `rankPlayers`/`podiumRows` untouched.
2. **`src/main.js`** (render-only): import `scoreDistribution`; derive once in the active branch of `renderActiveGame`; add private `renderScoreDistribution(distribution)` emitting Decision 4's markup (names via `escapeHtml`, widths as integer inline styles); insert the call after the active `<ol class="active-roster">`. No handler, state, focus, save-path, or finished-view changes.
3. **`src/styles.css`** (additive block near `.recent-entries`): `.score-distribution` (inset container on a surface token, `--radius-md`), `.score-distribution-header`, `.score-distribution-total` (`--muted`, tabular-nums), `.score-distribution-bar` (flex track, ~10px, radius-full), `.score-distribution-segment` (+ `marker-*` backgrounds work as-is; additive yellow/white outline rule), `.score-distribution-legend` (wrapping flex list), `.score-distribution-legend-item` (+ scoped small `.marker` dot), `.score-distribution-empty` (`--muted`). A scoped ≤360px compaction only if measured necessary (recent-entries precedent). No existing rule modified.
4. **Tests**: additive `scoreDistribution` cases in `scripts/standings-test.mjs` (Scenarios 1–6 math: mockup parity, largest-remainder-vs-naive case, tie top-up order, mixed-sign/zero omission, degenerates, guards, immutability, fresh arrays, no persisted fields; summary line updated). New `scripts/browser-score-distribution-test.mjs` (sessions below). Wire `package.json` + `init.sh`.
5. **Docs**: README (block behavior + new command + next steps), ARCHITECTURE (derivation boundary, render-only wiring, new suite), CONSTRAINTS (durable rules: derived-only/never persisted; caption always rendered; bar only at positive total with positive-only shares; percentages sum to 100; color never alone).

## Expected File Changes

- `src/standings.js` — modify: add `scoreDistribution(game)`.
- `src/main.js` — modify: import, derivation call, `renderScoreDistribution`, one insertion point in the active branch.
- `src/styles.css` — modify: additive distribution styles only.
- `scripts/standings-test.mjs` — modify: additive cases + summary line (no existing assertion touched).
- `scripts/browser-score-distribution-test.mjs` — new focused suite (4 isolated Chrome sessions: ① UI-scored happy path + live save/undo/reorder re-derivation + zero-focusable/aria-hidden; ② seeded rounding edges (42/35/28/19 → 34/28/23/15; 2/2/2/1/1/1 → 23/22/22/11/11/11; 1/1/1 → 34/33/33), mixed-sign 10/−5/3, zero-player 10/0/5, degenerates all-zero/5+−5/−5+−3 with exact caption copies, and byte-identical payload across renders/selection/home-resume; ③ finished/podium/home/active-empty exclusion; ④ 320×720 + 1280×800 with a seeded 20-player mixed game: overflow, legend wrap, width↔percent spot checks, AA contrast, zero console errors).
- `package.json` — add `test:browser:score-distribution`; chain into `test` (15 browser suites).
- `init.sh` — add the new script to the `node --check` list (27 entries).
- `README.md`, `ARCHITECTURE.md`, `CONSTRAINTS.md` — update per Technical Approach.
- `docs/specs/show-score-distribution.md` — this spec (belongs to this feature's PR).
- **Byte-untouched (verified via git diff)**: `index.html`; `src/score.js`, `src/storage.js`, `src/roster.js`, `src/game.js`; `scripts/smoke.mjs`, `scripts/static-server.mjs`, `scripts/browser-test-utils.mjs`; **every pre-existing suite** (unit suites other than standings-test's additive cases, and all fourteen browser suites — expected honest updates: zero). No new `src/*` module, so the static-server allowlist, smoke assets, and required-file list are unchanged; `src/standings.js` is already served.

## Visual Design Impact

- UI involved: yes — the active game's leaderboard panel only.
- Design source: `DESIGN.md` + `docs/design/update-v2/active_game_scorekeeper/screen.png` (distribution block under the leaderboard rows).
- Screens/states affected: active view at 1280×800 and 320×720, all data states (happy, tiny shares, mixed signs, zero/negative totals, 20 players), also under blocked storage (render-only, unaffected).
- New design artifact required: no — existing tokens cover it; the only delta is the additive block (mockup's inset-box look reproduced with surface tokens; decoration like "Round active" is excluded).

## Durable Documentation Impact

- `CONSTRAINTS.md`: update — durable rules: distribution is display-only derived data, never persisted; the caption always renders; the bar renders only at a positive game total with positive-only shares; displayed percentages sum to exactly 100; color is never the only signal (legend text).
- `ARCHITECTURE.md`: update — `scoreDistribution` derivation boundary in `src/standings.js`, render-only wiring, the new suite.
- `README.md`: update — user-visible distribution behavior + `npm run test:browser:score-distribution` + next steps.
- `AGENTS.md`: not needed — no workflow/startup change. `CONTEXT.md`/`docs/domain-model.md`/`docs/build-brief.md`: not needed — they already state the derived-data rule; this spec implements it. `docs/risks-and-open-questions.md`: not needed (precedent — the Decisions section above is the closure record).

## Implementation Plan

1. Land `scoreDistribution` in `src/standings.js` + additive unit cases; run `npm run test:standings`.
2. Land the `src/main.js` render wiring and additive styles; run `node --check src/main.js src/standings.js`; walk Scenarios 1–8 by hand in `npm run dev` at 1280×800 and 320×720.
3. Write the new suite, wire `package.json` + `init.sh`, run the full verification plan, confirm the byte-untouched floor via `git diff`, update docs, record evidence.

## Implementation Tasks

- [ ] `src/standings.js`: add `scoreDistribution(game)` with guards, eligibility, largest-remainder rounding, and a derivation comment (Decisions 1–2).
- [ ] `scripts/standings-test.mjs`: additive cases — mockup parity 42/35/28/19 → 34/28/23/15 of 124; 2/2/2/1/1/1 → 23/22/22/11/11/11 (naive rounding would give 99); 1/1/1 → 34/33/33 (tie top-up in display order); mixed 10/−5/3 → 77/23 with gameTotal 8; 10/0/5 → 67/33 with gameTotal 15; degenerates (all-zero, 5/−5, −5/−3, empty, null/undefined/{}) → `{ gameTotal: N, rows: [] }`; 20-player positive game sums to 100; structuredClone immutability + fresh-array returns + no fields written; summary line updated.
- [ ] `src/main.js`: import + derive in the active branch; `renderScoreDistribution` emitting Decision 4's markup with escaped names and integer widths; insert after the active `<ol>`. No other wiring.
- [ ] `src/styles.css`: additive distribution styles (Decision 4/Technical Approach 3), including the yellow/white segment outline; no existing selector modified.
- [ ] `scripts/browser-score-distribution-test.mjs`: Sessions ①–④ per Expected File Changes, using the game-activity suite's seeded-game/byte-identity/contrast patterns and the `[data-score-distribution]` scoping precedent.
- [ ] `package.json` + `init.sh`: wire the new suite.
- [ ] Update `README.md`, `ARCHITECTURE.md`, `CONSTRAINTS.md`.
- [ ] Run the verification plan; record evidence in `feature_list.json`/`PROGRESS.md` (implementer/validator step, not this planner).

## Verification Plan

- `node --check` on touched sources and the new suite (covered by `init.sh`).
- `npm run test:standings` — passes with the additive `scoreDistribution` cases and every pre-existing assertion unmodified.
- `npm run test:browser:score-distribution` (new, real headless Chrome, 1280×800 + 320×720): Sessions ①–④ with `readSavedGamesState` byte-identity proofs across non-mutating renders.
- `npm run test` — full chain (15 browser suites) with **all fourteen pre-existing browser suites green byte-untouched** (expected honest updates: zero) and the twelve other unit suites unmodified.
- `./init.sh` and `CI=true ./init.sh` — required files, all syntax checks (27 entries including the new suite), and the full `npm run test` chain pass; both exit without starting a server (a transient Chrome-launch timeout may be retried once, per the documented podium/launch flake).
- `npm run dev` probe — 200 for `/`, `/src/standings.js`, `/src/main.js`, `/src/styles.css`; 404 for `/AGENTS.md`.
- Screenshots (happy-path bar, mixed-sign, degenerate, 320px 20-player) into the evidence dir; programmatic assertions carry the proof as established.
- Disclosure: physical keyboards/touch cannot be exercised headless; the zero-focusable contract is asserted via DOM enumeration, consistent with prior features. `init.sh` executes the non-blocking standard gate only and must not start a long-running server.

## Evidence To Capture

- Exact commands and results for `test:standings`, the new browser suite, `npm run test`, both gate modes, and the dev probe.
- A statement that `index.html`, `src/score.js`, `src/storage.js`, `src/roster.js`, `src/game.js`, `scripts/smoke.mjs`, `scripts/static-server.mjs`, `scripts/browser-test-utils.mjs`, and all pre-existing suites are untouched (0-line diffs); the envelope version stayed `1`; `persistActiveGameSnapshot` still has exactly six call sites; no new persisted fields; `rankPlayers`/`podiumRows` unmodified.
- Screenshots + programmatic assertion summaries (rounding parity, mixed-sign, degenerate copy, width↔percent correspondence, zero focusables, AA contrast, 320px).
- Appended `feature_list.json` evidence entries and a `PROGRESS.md` session-log entry.

## Validator Checklist

- [ ] The block renders only in the active view's leaderboard panel (after the `<ol>`), per Decision 4's markup, copy, and order; finished/podium/home/active-empty show nothing (Scenario 7).
- [ ] Math matches Decisions 1–2: positive-total gate, positive-only shares over the positive-sum denominator, largest-remainder integers summing to exactly 100, zero-total players omitted; unit cases pin the mockup parity, the naive-rounding counterexample, and tie top-up order.
- [ ] Negative/zero treatment matches Decision 1: caption "N total game points" always renders (signed, unconditional phrasing); the locked degenerate line replaces bar+legend at total ≤ 0; no misleading leader is ever implied.
- [ ] Tiny shares follow Decision 3: exact integer widths (no min-width), legend carries every eligible player.
- [ ] Accessibility matches Decision 5: zero focusables in `[data-score-distribution]`, `aria-hidden` bar, real-text legend, `--text`/frozen `--muted` at AA, no new live region, no focus stealing.
- [ ] Derived-only: recomputed every active render; no persisted fields; `src/storage.js` 0-line diff; six save triggers; byte-identical payload across non-mutating renders.
- [ ] Regression floor holds: all pre-existing suites green byte-untouched (zero honest updates expected); smoke strings, nav matrix, `[data-recent-entries]` contract, rank/tie logic, frozen labels/tokens/breakpoints unchanged; no unrelated feature work (no podium actions, no finished-view distribution, no decoration).
- [ ] README/ARCHITECTURE/CONSTRAINTS updated; evidence recorded with real commands and results.
