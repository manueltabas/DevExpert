# Feature Implementation Spec: Adopt the v2 visual system across all screens

## Source Feature

- `id`: `refresh-design-system`
- `area`: `design`
- `depends_on`: [] — the foundation feature of the seven-feature v2 set; `name-game-titles`, `track-game-activity`, `add-quick-score-entry`, `show-player-numbers`, `show-score-distribution`, and `extend-podium-actions` all depend on it
- `status`: `not_started` at planning time
- `source`: `feature_list.json` (first of the v2 features appended 2026-10-15)

## Goal

Every screen adopts the v2 design system: warm ivory canvas (`#FAF5EB`) with cool-tinted card surfaces, Plus Jakarta Sans typography with a system fallback, the translated token scale (color, type, radius, spacing), and a top navigation bar (Dashboard / New Game / Active Game) present on all screens.

This is a **restyle-only slice**. All 11 accepted behaviors (roster, scoring, ranking, undo, resume, storage-failure feedback, finish, podium, replay, entry restriction, shell) keep passing their existing suites **unmodified**. No accepted copy changes, no storage changes, no module-boundary changes. The only new user-visible surfaces are the top navigation itself and the Active Game destination's empty state.

## Non-Goals

- **No behavior change**: score math, ranking/ties, undo, finish, podium, replay, resume, save triggers, storage suppression/rollback, focus flows of existing controls, and all error/success/info messages stay exactly as accepted.
- **No copy change on existing surfaces**: headings, panel titles, empty-state copy, notices, feedback, labels, helper text stay verbatim. Mockup variants ("Keep score, stay in the game.", "Ongoing games", "History") are NOT adopted.
- **No mockup decoration** (build-brief non-goals): round/turn labels and timers ("Round 6", "Turn 6 · 48m"), dashboard statistics (win streaks, "Active Roster", "nights recorded"), named game presets, "Fill group" roster reuse, "Quick 4-player game".
- **No later-feature work**: game titles on cards/headers, activity timestamps ("Updated Xm ago"), recent-entries log, quick tap counters, signed stepper, player-number badges, score distribution bar, and the three podium exit actions are separate features. The shell must not preclude them (nav exists; layout stays flexible), but none are implemented here.
- **No Tailwind, no CDN scripts, no icon fonts** (Material Symbols rejected), no bundler, no runtime dependency. Mockup HTML is a fidelity reference, not code to copy.
- **No URL routing, hash, or History API** — the app stays a single-page `state.view` machine; nav items are buttons, not links.
- **No storage change**: same single `scorekeeper:games` key, same envelope, same save triggers. Navigation never writes.
- **No changes to** `src/roster.js`, `src/score.js`, `src/standings.js`, `src/storage.js`, `src/game.js`, `scripts/static-server.mjs`, `scripts/smoke.mjs`, or any existing test script. No font files in the repository.

## Job Story

When I open the scorekeeper on my phone or desktop,
I want every screen to feel like one warm, calm, tactile tabletop companion — cards on ivory, readable type, and always-visible Dashboard / New Game / Active Game navigation —
so I can move between starting a game and keeping score without relearning the app, and nothing about my saved games changes.

## Users And Permissions

- Scorekeeper: the only actor. No sign-in, sharing, or remote access. All changes remain local to the browser.

## Product Decisions Resolved For This Slice

These resolve the open items flagged in `docs/risks-and-open-questions.md` that fall inside this feature's scope.

### Decision 1 — The concrete token set lands in `src/styles.css`

Plain CSS custom properties translated from `docs/design/update-v2/warm_tactile_scorekeeper/DESIGN.md` (authoritative for values). Existing variable names are kept where the role is unchanged, to minimize churn:

| Custom property | Value | Token-file source / role |
|---|---|---|
| `--background` | `#FAF5EB` | `bg-base` — warm ivory canvas (unchanged) |
| `--surface` | `#FFFDF8` | `surface-card` — card surfaces (unchanged) |
| `--surface-strong` | `#F1F3FD` | `surface-container-low` — emphasized surfaces: selected row, notices, finish prompt (was warm `#FFF7DF`) |
| `--surface-container` | `#EBEEF7` | inner-card fills, hovers (replaces `rgba(250,245,235,.72)` fills) |
| `--surface-container-high` | `#E5E8F2` | pressed/subtle chips |
| `--text` | `#181C23` | `on-surface` (was `#20242B`) |
| `--muted` | `#6D655C` | **frozen** — see Decision 6; plays the on-surface-variant role |
| `--border` | `#DED6C9` | warm `border-subtle` (unchanged) |
| `--border-cool` | `#C1C6D5` | `outline-variant` — cool card borders |
| `--outline-strong` | `#727784` | `outline` — strong separators/badges |
| `--primary` | `#0868C9` | `primary-container` — action surface, white text (5.5:1 AA; unchanged) |
| `--primary-dark` | `#00509F` | `primary` — ghost/link text on light (was `#064D93`) |
| `--primary-tint` | `#E2EAFF` | `on-primary-container` — primary tints |
| `--primary-fixed` | `#D6E3FF` | `primary-fixed` — soft selection/badge tints |
| `--secondary` | `#635E53`, container `#E7DFD1`, on-container `#676258` | secondary warm neutrals — chips, brand accents |
| `--tertiary` | `#883A00`, container `#AE4C00`, tint `#FFE5D9` | burnt-orange accents — the Finish game action |
| `--error` | `#BA1A1A`, container `#FFDAD6` | replaces every hardcoded `#9f271e` (validation, storage notices, finish prompt) |
| `--success` | `#1E6E4E` | kept — success feedback (no v2 success token) |
| Player colors | `--blue #1479DE`, `--red #E5483B`, `--yellow #F5C518`, `--green #28956B`, `--orange #F28A2B`, `--white #FFFFFF`, `--black #202124` | identical to token-file `player-*` (unchanged) |
| `--shadow-sm/-md/-lg` | `0 1px 8px rgba(24,28,35,.05)` / `0 4px 16px rgba(24,28,35,.06)` / `0 8px 24px rgba(24,28,35,.10)` | soft cool shadows (replaces the heavy `--shadow`) |
| Radius | `--radius-md 12px`, `--radius`/`--radius-lg 16px`, `--radius-xl 24px`, `--radius-full 999px` | `rounded md/lg/xl/full` |
| Spacing | `--space-xs 4px`, `--space-sm 8px`, `--space-md 16px`, `--space-lg 24px`, `--space-xl 32px` | 8px rhythm; gutters `--space-md → lg → xl` by breakpoint |
| `--page-width` | `1120px` | kept (no requirement to widen) |

Type scale (all Plus Jakarta Sans via `--font-sans`):

| Token | Value | Applied to |
|---|---|---|
| `--font-sans` | `"Plus Jakarta Sans", ui-rounded, "SF Pro Rounded", "Segoe UI", system-ui, sans-serif` | everything |
| `--text-display` | clamp(2.5rem→3.5rem) w800, lh 1.07, ls −0.03em (56/40px) | defined in scale; **not** applied to row totals this slice (20-row × 56px totals would break 320px grids); reserved for later features |
| `--text-headline-lg` | clamp(1.625rem→2rem) w700 (26→32px) | hero heading |
| `--text-headline-md` | 1.375rem w700 (22px) | panel `h2`s |
| `--text-headline-sm` | 1.125rem w600 (18px) | card titles, `h3`s, empty-state titles |
| `--text-body-md` / `--text-body-sm` | 1rem/1.5 · 0.875rem/1.43 | body / meta lines |
| `--text-label-md` / `--text-label-sm` | 0.875rem w600 · 0.75rem w600 | buttons, chips; `.eyebrow` stays 12px w600 uppercase with letter-spacing (the "LEADERBOARD"-style small caps) |
| `--text-score` | 1.75rem w800 `tabular-nums` (1.35rem ≤360px) | rank numerals and totals — keeps the accepted ≤360px compaction |

Error mapping: validation/inline error text `var(--error)` on the surface it sits on (≥6.3:1 on `--surface`); `.storage-notice` gets `#BA1A1A` on `--error-container #FFDAD6` (5.0:1); `.finish-action` gets `#883A00` on `#FFE5D9` (6.6:1) — all pass the ≥4.5 contrast the storage-failure suite computes.

### Decision 2 — Font loading and fallback stack

- `index.html` gains `preconnect` to `fonts.googleapis.com`/`fonts.gstatic.com` plus one stylesheet link: `Plus+Jakarta+Sans:wght@400;600;700;800&display=swap` — exactly the weights the token scale uses. No font files are committed; the static-server allowlist, MIME map, and smoke asset list stay untouched.
- Fallback stack is Decision 1's `--font-sans` (the current accepted system stack, retained after the web font name). `font-display: swap` keeps text visible during load and when fonts never load.
- Rationale: the build brief specifies fonts are "linked, not bundled"; a CDN link is the only option that requires zero changes to the deliberate public-file allowlist. Offline behavior (the required degradation case) is verified in the focused suite (Decision 7), not assumed.
- The offline/fallback render must keep hierarchy and contrast: headings still heavier/larger than body, `tabular-nums` still on numerals, no horizontal overflow. Tests must assert the *declared* stack and layout outcomes, never that the web font actually loaded (headless CI may be offline).

### Decision 3 — Icon strategy: labeled text first

- No icon font, ever (DESIGN.md do-nots). Every interactive control keeps a visible text label — this is already true for every control in the app, and the nav items are text buttons.
- Inline SVG is permitted **only** as `aria-hidden="true"` decorative accents (panel-heading badges, empty-state emblems) where the markup already has aria-hidden decoration (`dice-card`, `token-stack`). It is optional; a fully CSS-only restyle is acceptable.
- Any future icon-only control must carry an accessible label (durable rule recorded in CONSTRAINTS.md).

### Decision 4 — Top navigation behavior

- **Markup**: static header in `index.html`, outside `#app`, rendered on every screen: brand block (marker dots + "Game night" + the exact string "Board-game scorekeeper" — the smoke check regex is case-sensitive) and `<nav class="top-nav" aria-label="Primary">` with three `type="button"` buttons: `data-action="nav-dashboard"` → **Dashboard**, `nav-new-game` → **New Game**, `nav-active-game` → **Active Game**. Distinct action ids prevent any `querySelector` collision with existing `data-action` values (`new-game`, `back-home`, …) that suites and code target.
- **Handlers** (bound once at startup in `src/main.js`; the header is not re-rendered):
  - Dashboard → existing back-home semantics (`state.view = "home"`, transient setup errors cleared), then focus the home heading.
  - New Game → `state.view = "setup"` (same transition as the hero button; the setup scratchpad is left as-is), then focus the setup heading.
  - Active Game → resolve in this order: (1) `state.activeGame` is set and `status === "active"` → it already is the game in progress; ensure `state.view = "active"` and focus its heading (no re-resume, no write); (2) otherwise the first `status === "active"` game in `orderSavedGamesForDisplay(state.savedGames)` (updatedAt desc = most recent activity) → `handleResume(game.id)` exactly as the card button does (read-only restore; no storage write); (3) otherwise → the new Active Game empty state.
  - Order (1) before (2) also covers blocked-storage sessions where the in-memory game was never saved.
- **Empty state** (new view value, e.g. `"active-empty"`, rendered into `appRoot`; the existing `renderActiveGame` `!game` redirect to home stays untouched for non-nav paths): eyebrow "Active game", heading "No game in progress" (focusable, `tabindex="-1"`), body "Start a new game to begin tracking scores. It will appear here until it's finished.", and a `.primary-action` "New game" button (`data-action="new-game"`, bound by the new branch with the same transition as the hero button). Styled with the v2 empty-state treatment. No storage writes.
- **`aria-current="page"`** painted on every render: Dashboard while on home **and** while viewing a finished game (finished views are dashboard/history destinations); New Game on setup; Active Game while viewing an unfinished game or the empty state.
- **Focus rule**: every nav navigation moves focus to the destination view's primary heading. Home/setup/empty-state headings gain `tabindex="-1"` plus a data attribute (`data-home-heading` / `data-setup-heading`); active already has `[data-active-heading]`.
- **Layout**: ≥44px nav targets, visible `:focus-visible` outline, and at narrow widths the header stacks (brand row above nav row; nav wraps) so nothing overflows at 320px. Existing in-view controls ("All games", setup "Back", hero "New game") stay — the nav is additive.

### Decision 5 — Empty states

- Ongoing and finished panel empty states keep their **exact accepted copy** — "No saved games yet." / "Start a new game and it will be saved here so you can resume it later." and "No finished games yet." / "Finish a game and its standings will appear here." — plus the suppression variant ("Saved games can't be shown right now." …) verbatim. They are restyled into the v2 treatment (centered `--surface-container` inner tray with dashed `--border-cool`, headline-sm title, body-sm muted body, generous padding, optional aria-hidden accent). No illustrations required (the mockup dice/trophy art is decoration).
- The Active Game empty state is the only new copy (Decision 4). "Launch scorekeeper" from the mockup is not adopted (new control semantics); the state reuses the existing "New game" transition instead.

### Decision 6 — Suite-frozen computed values (how "suites unmodified" survives a restyle)

Exact-value assertions found in existing suites that the restyle must preserve:

1. `scripts/browser-undo-test.mjs:223` asserts `.info-message` computed color `rgb(109, 101, 92)` → **`--muted` stays `#6D655C`** (a warm neutral, visually consistent with the v2 secondary family; contrast ≥4.5 on all surfaces it sits on). The token-file `on-surface-variant #414752` is therefore intentionally not adopted this slice. Line 224 (not the error color) keeps holding.
2. `scripts/browser-podium-test.mjs` asserts confetti `animationName` (all pieces), duration ≤ 3.5s, iteration-count 1, fill forwards, pointer-events none, and layer `display: none` under reduced motion → keep the `podium-fall` keyframes and per-piece animation shorthand; only colors/sizes may change.
3. Focus assertions (`outlineStyle !== "none"`, `outlineWidth !== "0px"`) → keep the 3px `:focus-visible` outline mechanism (color may move to `--primary`/`--primary-dark`).
4. Relational assertions (≥44px targets, AA contrast ≥ 4.5 on notices, stacked cards, visible rank nodes with non-zero font size) → preserved by keeping target sizes, the ≥4.5 mappings in Decision 1, and readable numerals.
5. `scripts/smoke.mjs` requires index.html to still contain `<main id="main-content"`, the exact string `Board-game scorekeeper`, and to NOT match `/localStorage|score change|leaderboard row/i` → the new header/nav markup respects all three.

The implementer must re-grep test scripts for any additional computed-style assertions before finalizing styles.

### Decision 7 — Focused verification is a new suite, existing suites untouched

Following the established per-feature pattern: one new `scripts/browser-design-system-test.mjs` wired as `npm run test:browser:design-system`, chained into `npm run test`, and added to `init.sh`'s `node --check` list. No existing suite file is edited. Details in the Verification Plan.

## Acceptance Scenarios

### Scenario 1: All screens carry the v2 system

Given the app served over local HTTP
When each view is rendered (home empty and populated, setup, active game, finished game, podium open, storage notices visible)
Then the canvas is `#FAF5EB`, cards use the cool surface scale, text uses the Plus Jakarta Sans stack, buttons/notices/podium use the mapped tokens, the top navigation is visible on every screen with the correct `aria-current`, and every accepted string is unchanged.

### Scenario 2: Top navigation moves between views

Given any view
When the scorekeeper activates Dashboard, New Game, or Active Game (mouse and keyboard)
Then the matching view renders, focus lands on the destination heading, `aria-current` updates, and no storage write occurs.

### Scenario 3: Active Game destination resolves correctly

Given (a) an in-progress game open in memory, (b) two saved active games and no open game, (c) only a finished game, and (d) no games at all
When the scorekeeper activates Active Game
Then (a) reopens the open game without a resume round-trip, (b) resumes the most recently updated active game (updatedAt desc), (c) resumes nothing and shows the empty state — the finished view is not revisited, (d) shows the empty state, whose "New game" opens setup.

### Scenario 4: Accepted behavior is unchanged

Given the full existing test suite
When `CI=true ./init.sh` runs
Then all five unit suites, the HTTP smoke, and all nine browser suites pass **unmodified** — including the `rgb(109, 101, 92)` info color, confetti contract, contrast floors, 44px targets, and every exact message string.

### Scenario 5: Responsive layout holds

Given 320×720 and 1280×800 viewports on every view (including the new nav, empty states, and podium)
Then there is no horizontal overflow, every interactive control (nav buttons, hero/empty-state New game, Resume, View results, Add points, Save points, Undo, Finish, Cancel, Play again, Close) is ≥44px, focus outlines are visible, and narrow widths stack per the accepted breakpoints (nav stacks above content; panels single-column).

### Scenario 6: Font fallback renders acceptably offline

Given a session with requests to `fonts.googleapis.com` and `fonts.gstatic.com` blocked (CDP `Network.setBlockedURLs`)
When any view renders
Then text renders with the system fallback stack, the declared `font-family` still names Plus Jakarta Sans first, hierarchy (heading vs body size/weight) and contrast hold, and there is no horizontal overflow at 320px or desktop width.

### Scenario 7: Motion and notices respect the accepted rules

Given reduced-motion emulation and blocked/quota-failing storage
Then confetti stays suppressed (`display: none`), podium dismissal still funnels synchronously, storage notices keep their exact copy and role, and the restyle introduces no new motion (the global reduced-motion clamp stays).

## Repository Research

### Files Inspected

- `AGENTS.md`, `PROGRESS.md`, `feature_list.json` — workflow; this feature's verification items and notes; the six dependents.
- `docs/build-brief.md` — v2 scope, non-goals (decoration list), "Tailwind rejected… plain CSS with linked web fonts and graceful fallbacks".
- `docs/domain-model.md`, `CONTEXT.md` — titles/timestamps/numbers/distribution belong to later features; round/turn labels are decoration.
- `docs/risks-and-open-questions.md` — the implementation-time items this spec resolves (nav behavior, font/icon fallbacks, empty states).
- `DESIGN.md` (root) — v2 working subset; "Do's and don'ts" (no Tailwind/icon-font hard dependency).
- `docs/design/update-v2/warm_tactile_scorekeeper/DESIGN.md` — full token YAML (authoritative values).
- Five mockups (`scorekeeper_dashboard`, `dashboard_empty_state`, `new_game_setup`, `active_game_scorekeeper`, `end_of_game_podium_summary`) — header/nav pattern (`h-20` bar, brand + segmented nav), hero card, two-panel dashboard, card anatomy, empty-state treatment (inner tray, centered text), radius/spacing/shadow usage.
- Existing specs (`restrict-score-entry-input.md`, `bootstrap-web-shell.md`) — structure/style conventions.
- `index.html` — shell: header (eyebrow + `h1` "Game night" + `marker-strip`), `main#main-content` with `#app`, footer; no stylesheet/font links beyond `src/styles.css`.
- `src/styles.css` (1215 lines) — v1 warm palette, hardcoded `#9f271e`, rgba warm fills, `--surface-strong #FFF7DF`, clamp-based type, accepted breakpoints (720/480/360), reduced-motion clamps, podium/confetti rules.
- `src/main.js` (1178 lines) — `state.view ∈ {home, setup, active}`, render tree (`renderHome`/`renderSetup`/`renderActiveGame` → `renderFinishedGame`/podium dialog), `bindSetupEvents`/`bindActiveEvents` back-home transitions and focus targets, `[data-active-heading]` pattern, `orderSavedGamesForDisplay` import for card ordering.
- `src/roster.js`, `score.js`, `standings.js`, `storage.js`, `game.js` — untouched; `orderSavedGamesForDisplay` (updatedAt desc → createdAt desc → id asc) is the "most recent activity" order.
- `scripts/static-server.mjs` / `smoke.mjs` — public-file allowlist + MIME map (no `.woff2`; reason for CDN fonts), smoke string constraints on index.html.
- `init.sh`, `package.json` — gate shape: required files, `node --check` list, `npm run test` chain (all nine browser suites).
- All nine browser suites + `browser-test-utils.mjs` — the computed-style assertions listed in Decision 6; reusable helpers (`setViewport`, `navigate`, `click`, `evaluate`, `screenshot`, `readSavedGamesState`, `createEvidenceDir`).

### Existing Patterns To Follow

- Each feature adds one focused suite (new file + npm script + chain + `init.sh` syntax entry) and never edits other suites except honest, spec-driven updates — here: none.
- Browser tests assert observable outcomes via CDP on real headless Chrome at 1280×800 and 320×720; screenshots are generated even when not visually openable, with programmatic assertions carrying the proof.
- Restyles stay inside `src/styles.css` + markup strings in `src/main.js`/`index.html`; no new `src/*` module has ever been needed for view work, so the server allowlist/smoke stay untouched.
- `./init.sh` stays a non-blocking gate; transient Chrome-launch timeouts are rerun once before investigation.

### Current Gaps

- No web font link and no v2 tokens; warm v1 palette throughout; hardcoded `#9f271e` in six rules.
- No top navigation and no "most recent active game" entry point from the header; no Active Game destination empty state.
- Hero/panel/card/empty-state styles are bespoke v1 treatments to be remapped onto tokens.

## Technical Approach

1. **`src/styles.css` — token layer + restyle pass.** Replace `:root` with the Decision 1 token set (keeping the variable names the rest of the file uses; add the new cool/border/type tokens). Then re-map components onto tokens without changing DOM contracts (class names, ids, `data-*`, grid areas, and the aria structure stay): shell/header/footer, hero, panels, saved-game and finished cards, setup rows/color pickers, active leaderboard rows, score form, finish prompt/actions, storage notices, finished view, podium dialog + confetti colors, empty states, nav. Keep the 720/480/360 breakpoints and both reduced-motion rules (global clamp + explicit confetti suppression). Replace every `#9f271e` with `var(--error)` (or the tertiary/error-container mapping from Decision 1). Keep `overflow-x` guards and `tabular-nums`.
2. **`index.html` — fonts + static header nav.** Add the two `preconnect` links and the Plus Jakarta Sans stylesheet (Decision 2). Restyle the header into the v2 app bar: brand block (restyled `marker-strip` + "Game night" + eyebrow "Board-game scorekeeper", exact casing kept) and the three-button nav (Decision 4 markup). Keep `<main id="main-content">`, `#app`, the skip link, and the footer (restyled).
3. **`src/main.js` — nav wiring + empty state.** Add a one-time nav binding (Decision 4 handlers; resolve Active Game per the 3-step order, reusing `handleResume` and the existing home/setup transitions), a `paintNav()` call inside `render()` that sets `aria-current`, `tabindex="-1"` + heading data attributes on the home/setup headings, and the new `active-empty` view rendering the Decision 4 empty state (bound "New game" button, focusable heading). No storage calls; no changes to existing handlers' logic, copy, or focus targets.
4. **`scripts/browser-design-system-test.mjs` — new focused suite** (Decision 7; isolated Chrome sessions): font-fallback offline simulation (Scenario 6), per-view layout/token checks at both widths (Scenarios 1/5), nav behavior matrix (Scenarios 2/3, including storage-write absence via `readSavedGamesState`), and reduced-motion/storage-notice regression probes (Scenario 7).
5. **Docs**: README (visual-system + nav sentences, new command), ARCHITECTURE.md (nav wiring, empty-state view, token layer), CONSTRAINTS.md (durable rules: token translation only, no Tailwind/icon fonts, labeled-text icon rule, nav-never-writes, frozen `--muted`).

## Expected File Changes

- `src/styles.css` — modify: token layer + full restyle pass (no selector/class renames that markup or suites depend on).
- `index.html` — modify: font links, v2 header + nav markup, restyled footer hooks.
- `src/main.js` — modify: nav binding/`aria-current` painting, heading focus attributes, Active Game empty-state view.
- `scripts/browser-design-system-test.mjs` — new focused suite.
- `package.json` — add `test:browser:design-system` and chain it into `test`.
- `init.sh` — add the new script to the `node --check` list.
- `README.md`, `ARCHITECTURE.md`, `CONSTRAINTS.md` — document the visual system, nav, and durable rules.
- `docs/specs/refresh-design-system.md` — this spec (belongs to this feature's PR).
- Unchanged: all `src/*.js` modules except `main.js`, all existing test scripts, `scripts/static-server.mjs`, `scripts/smoke.mjs`, `scripts/serve.mjs`, `feature_list.json` behavior fields (evidence appended later by implementer/validator), `DESIGN.md` (already the source of truth).

## Visual Design Impact

- UI involved: yes — every screen.
- Design source: `DESIGN.md` (root) + `docs/design/update-v2/` mockups and token file.
- Screens/states affected: home (empty + populated), setup, active game, finished game, podium dialog, storage-notice states, Active Game empty state (new), header/nav (new), footer.
- New design artifact required: no — the v2 assets are accepted; this feature translates them.

## Durable Documentation Impact

- `CONSTRAINTS.md`: new durable rules — the app renders from translated v2 tokens only; no Tailwind/CDP scripts/icon fonts; icons degrade to labeled text or aria-hidden inline SVG; nav is display/state-only and never writes storage; `--muted` is frozen at `#6D655C` by the undo suite (change requires an honest suite update first).
- `ARCHITECTURE.md`: header/nav wiring, `active-empty` view, token layer, font-loading boundary (CDN + fallback, no bundling).
- `README.md`: user-visible notes (new look, nav behavior, fallback when offline) + the new test command.
- `CONTEXT.md` / `docs/domain-model.md` / `docs/build-brief.md`: not needed (no terminology or model change).

## Implementation Plan

1. Translate the token block into `src/styles.css` first and restyle the shell (body, header, footer) — verify in `npm run dev` that the baseline still renders and the smoke-required strings are intact.
2. Add the header nav markup + `main.js` wiring (handlers, `aria-current`, focus attributes, empty-state view) — walk Scenarios 2/3 by hand at 320px and desktop.
3. Restyle remaining screens onto tokens (home/cards, setup, active, finished, podium, notices, empty states), then the responsive passes (720/480/360) and reduced-motion re-check.
4. Write `scripts/browser-design-system-test.mjs`; wire `package.json` + `init.sh`.
5. Run the full verification plan; update README/ARCHITECTURE/CONSTRAINTS; record evidence.

## Implementation Tasks

- [ ] `src/styles.css`: replace `:root` with the Decision 1 token set; restyle all components per screen mapping; remove hardcoded `#9f271e`; keep class/id/grid-area contracts, breakpoints, and both reduced-motion rules; keep the podium confetti animation contract.
- [ ] `index.html`: add `preconnect` + Plus Jakarta Sans stylesheet link (`wght@400;600;700;800`, `display=swap`); restyle header into brand + 3-button nav (`nav-dashboard` / `nav-new-game` / `nav-active-game`, `aria-label="Primary"`); keep `main#main-content`, `#app`, skip link, and the exact "Board-game scorekeeper" string.
- [ ] `src/main.js`: one-time nav binding with the Decision 4 resolution order (reuse `handleResume`; no writes); `paintNav()` for `aria-current` in `render()`; `tabindex="-1"` + `data-home-heading`/`data-setup-heading` (and the empty-state heading); new `active-empty` view rendering the locked empty-state copy with a bound `data-action="new-game"` button.
- [ ] `scripts/browser-design-system-test.mjs`: offline font-fallback session; per-view 320px/desktop layout + token assertions; nav matrix (aria-current, focus, resolution order, no-storage-write); reduced-motion + notice probes.
- [ ] `package.json`: add and chain `test:browser:design-system`. `init.sh`: add the new script to `node --check`.
- [ ] Update `README.md`, `ARCHITECTURE.md`, `CONSTRAINTS.md`.
- [ ] Run the verification plan and record evidence in `feature_list.json`/`PROGRESS.md` (implementer/validator step, not this planner).

## Verification Plan

- `node --check` on `src/main.js` and all touched test scripts (covered by `init.sh`).
- `CI=true ./init.sh` and `./init.sh` — required files, all syntax checks (now including the new suite), and the full `npm run test` chain pass; exits without starting a server. All **pre-existing** suites run **unmodified** and green (a transient Chrome-launch timeout may be retried once).
- `npm run test:browser:design-system` (focused, real headless Chrome, 1280×800 + 320×720):
  - **Font fallback**: `Network.setBlockedURLs: ["*fonts.googleapis.com*", "*fonts.gstatic.com*"]`; assert body computed `font-family` declares `"Plus Jakarta Sans"` followed by fallback names, headings render larger/bolder than body, `tabular-nums` still resolvable on totals, no console errors from the blocked font, no horizontal overflow on every view.
  - **Tokens/layout**: computed body background `rgb(250, 245, 235)`; primary action background `rgb(8, 104, 201)`; notice/finish mappings present; zero horizontal overflow per view; ≥44px on nav buttons and every interactive control; visible `:focus-visible` outlines; 320px stacking for nav, panels, cards.
  - **Nav matrix**: `aria-current` per view (incl. finished view → Dashboard); Dashboard/New Game transitions with heading focus; Active Game steps (1)–(3) of Decision 4 (seed storage with two active games of differing `updatedAt`; assert the newer resumes); empty state copy + New game → setup; `localStorage` key count unchanged across all nav actions.
  - **Regressions**: reduced-motion confetti suppression; storage notices keep exact copy/`role="status"`; skip link still first Tab stop.
- `npm run dev` probe — 200 for `/`, `/src/styles.css`, `/src/main.js`; 404 for `/AGENTS.md`.
- Screenshots per view at both widths into the evidence dir (programmatically asserted as established; visual openness not guaranteed in this environment).
- Disclosure: a physical mobile keypad and real-device font rendering cannot be exercised headless; the fallback contract is verified by the blocked-font session, consistent with prior features' disclosures.

## Evidence To Capture

- Exact commands and results for `npm run test:browser:design-system`, `npm run test`, `./init.sh`, `CI=true ./init.sh`, and the `npm run dev` probe.
- A statement that all 11 accepted features' suites ran unmodified and green, and that no storage shape, save trigger, or accepted copy changed.
- Screenshots + programmatic assertion summaries (tokens, overflow, targets, focus, nav matrix, offline fallback).
- Appended `feature_list.json` evidence entries and a `PROGRESS.md` session-log entry (implementer/validator step).

## Validator Checklist

- [ ] Restyle-only: no accepted behavior, copy, storage, or module-boundary change; the only new surfaces are the header nav and the Active Game empty state with the locked copy.
- [ ] All pre-existing suites pass unmodified; only the new suite + npm/init.sh wiring were added.
- [ ] Token set matches Decision 1 (values from the token file; `--muted` frozen; `#9f271e` fully replaced; error/tertiary mappings meet ≥4.5 contrast).
- [ ] Fonts linked per Decision 2; no font files in repo; fallback stack declared; offline simulation passes with hierarchy and no overflow.
- [ ] No Tailwind, CDN scripts, or icon fonts; every interactive control has a visible text label; any inline SVG is `aria-hidden` decoration.
- [ ] Nav behavior matches Decision 4 exactly (resolution order, `aria-current` mapping, focus-to-heading, no writes); empty state matches Decision 5.
- [ ] Mockup decoration absent: no rounds/timers/statistics/presets/fill-group/quick-game; later-feature work (titles, timestamps, counters, numbers, distribution, podium actions) absent but not precluded.
- [ ] 320px and desktop checks pass on every view; reduced motion and notice contracts intact; smoke string constraints on `index.html` hold.
- [ ] README/ARCHITECTURE/CONSTRAINTS updated; evidence recorded with real commands and results.
