# Progress

## Current verified state

- Phase: all 11 MVP features are `accepted` and merged to `main`. The v2 foundation feature `refresh-design-system` is independently validated, `accepted`, and merged to `main` (PR #16).
- The first dependent v2 feature `name-game-titles` is independently validated and `accepted` on `codex/name-game-titles` (PR pending merge): optional "Game title" setup field (empty default, `MAX_TITLE_LENGTH = 60`, trim-once, placeholder), the render-time auto-label `Game — {d MMM, HH:mm}` (never stored; plain `Game` fallback), pure `renameGame` with the six-code `GAME_ERROR_CODES`, `displayGameTitle` on all six display surfaces plus the new `.podium-game-title` podium line, and the inline active-header Edit title form persisting as the sixth save trigger. Replays start untitled; `FALLBACK_TITLE` is removed; storage envelope untouched (version 1, `src/storage.js`/`index.html` unchanged).
- Next step: merge the `name-game-titles` PR (user reviews). Remaining v2 features (`track-game-activity`, `add-quick-score-entry`, `show-player-numbers`, `show-score-distribution`, `extend-podium-actions`) stay `not_started`; `track-game-activity` is next in list order.
- Repository root: directory containing this file (`/Users/mtabas/Documents/DevExpert` in the current checkout).
- Standard startup/readiness path: `./init.sh`.
- Standard verification path: `CI=true ./init.sh`, which runs syntax (including the game-title suite), roster/standings/score/game/storage units, HTTP smoke, and Chrome browser checks (roster, scoring, ranking, undo, save/resume, storage-failure feedback, finish/read-only standings, the podium celebration, replay, the v2 design-system suite, and the game-title suite).
- Local app command: `npm run dev`, serving `http://127.0.0.1:4173/` by default.
- Blockers: none.
- Last verification: 2026-10-15 (name-game-titles implementation; both gate modes and the full test chain green).

## Session log

### 2026-10-15 — Game-titles implementation (name-game-titles)

- Landed the pure layer first. `src/roster.js`: added `MAX_TITLE_LENGTH = 60`, removed `FALLBACK_TITLE`, and `createGame` now stores the trimmed optional title (`typeof title === "string" ? title.trim() : ""` — blank/non-string store `""`, no fallback substitution). `src/game.js`: removed the `FALLBACK_TITLE` import; `replayGame` passes `title: ""` so replays always start untitled (supersedes the accepted copy-the-title behavior per the spec); added pure `renameGame({ game, title })` with the guard order missing-game → already-finished (checked before title validation, so finished titles are frozen and statusless games can't be renamed) → invalid-title → title-too-long (trimmed length > 60) and a success shape of `{ game: { ...game, title: trimmedTitle }, error: null }` without mutating the input; added `displayGameTitle(game)` with the private deterministic `formatTitleStamp` (`Game — {d MMM, HH:mm}` from `createdAt` in local time — unpadded day, short English months, zero-padded 24-hour time, no locale formatting — or plain `Game` for missing/non-string/unparseable stamps; stored titles render verbatim, never re-trimmed); `GAME_ERROR_CODES` is now exactly `["missing-game", "already-finished", "not-finished", "invalid-roster", "invalid-title", "title-too-long"]`. One test-authoring fix during self-verification: displayGameTitle parses stamps in local time, so unit assertions use local-anchored ISO strings (a raw `…Z` string correctly renders that instant in the viewer's timezone).
- Wired the display layer in `src/main.js`: `state.title` defaults to `""` and `resetSetup` resets it; the setup input gained `placeholder="Optional — e.g. Friday game night"` and `maxlength="${MAX_TITLE_LENGTH}"`; all six title render points now use `displayGameTitle` (ongoing/finished card titles, Resume/View results aria-labels, active + finished headers — replacing `game.title ?? "Untitled game"`/`"this game"`); `renderPodiumDialog(podium, game)` renders the muted `.podium-game-title` line as the first content element in `.podium-body` before the suite-frozen `h2#podium-title`; the raw stored title (never the auto-label) feeds setup and edit inputs.
- Added the header edit affordance: `state.titleEditOpen`/`state.titleDraft`/`state.titleEditFeedback` reset exactly where `finishPromptOpen` resets (resetSetup, handleResume, the active back-home handler, handlePlayAgain) plus the finish success path. Display mode renders the heading plus a `type="button"` `title-edit-action` "Edit title" (`data-action="open-title-edit"`) beside it; edit mode replaces both with the inline `.title-edit-form` (eyebrow kept, `label[for]` "Game title", `#active-title-input` maxlength 60 prefilled with the raw stored title, polite `#title-edit-feedback` live region, primary "Save title" submit + secondary "Cancel"). Opening focuses the input; Enter submits natively; Escape cancels via a form keydown listener; Save/Cancel return focus to `[data-active-heading]`; the draft tracks input events so re-renders (e.g. a score save during edit) keep the form open with the draft. `handleTitleSave` calls `renameGame`, on success persists through the unchanged `persistActiveGameSnapshot()` — the sixth successful-mutation save trigger — then closes, re-renders, repaints the storage notice, and focuses the heading; guard failures paint the mapped message (`invalid-title`/`title-too-long` joined `SCORE_ERROR_MESSAGES`) plus `console.warn("Game rename failed:", code)` without re-render. The finished view renders no edit control.
- Styled `src/styles.css` additively: `.title-edit-action` (pill on the `.add-points-action` precedent, ≥44px), `.title-edit-form` (grid; `min-width: 0` and a `min-width: 0` on its text field so it can shrink as a flex item), `.podium-game-title` (muted eyebrow-style using the suite-frozen `--muted`), plus two scoped media rules inside the existing breakpoints: at ≤720px `.active-header:has(.title-edit-action)/:has(.title-edit-form)` gains `flex-wrap: wrap` and the form takes a full row (`flex: 1 1 100%; order: 4`), and at ≤360px the edit action goes full width like the other actions. The wrap rule is a documented implementation-time necessity: measured in headless Chrome, the header's fixed items (All games 95px + players pill 94px + gaps) already need 221px of the 264px available at 320px, so a labeled ≥44px Edit title control geometrically cannot share the row; scoping via `:has()` keeps every view without the new control pixel-identical (finished header layout unchanged, verified). No existing selector, token, breakpoint, or motion rule was modified.
- Tests: honest spec-mandated updates only — `scripts/roster-test.mjs` (blank/non-string/missing titles store `""` with the supersession comment; summary line updated), `scripts/game-test.mjs` (replay title assertions flipped to untitled with supersession comments; new renameGame/displayGameTitle/GAME_ERROR_CODES cases; `FALLBACK_TITLE` import dropped; summary line updated), `scripts/browser-design-system-test.mjs` (nav-matrix session fills `#game-title` with "Matrix night" before submit so its exact heading assertion holds — the session tests reopen semantics, not labels), and `scripts/browser-play-again-test.mjs` (replay heading/cards/accessible-name assertions now prove the auto-label pattern and inequality with the original, the stored replay entry asserts `title: ""`, summary line updated). New `scripts/browser-game-title-test.mjs` (six isolated Chrome sessions covering Scenarios 1–6 with `readSavedGamesState` byte-identity proofs, in-page recomputation of the deterministic label, blocked-write rename with the unchanged notice copy and code-only warnings, verbatim pre-feature records, and the real-keyboard rename walk) wired as `npm run test:browser:game-title`, chained into `npm run test`, and added to `init.sh`'s `node --check` list. Fixed during self-verification: two suite-authoring bugs (byte-identity baselines captured before the finish write — a legitimate save; the legacy-records seed script re-seeding on every navigation and wiping the persisted rename — now guarded by a once-per-tab sessionStorage marker) plus a Tab-walk start-point fix (the hero New game already focuses the title field, so the walk starts from the nav path that focuses the setup heading).
- Verification: `node --check` on all touched sources and the new suite passed; `npm run test:roster`, `npm run test:game`, and `npm run test:storage` (unmodified) passed; `npm run test:browser:play-again` and `npm run test:browser:design-system` passed with the honest updates; `npm run test:browser:game-title` passed on real headless Chrome across all six sessions (titled end-to-end, blank auto-label with in-page format recomputation and reload stability, edit save/cancel/Escape/Enter/clear-to-blank with byte-identical cancel payloads, blocked-write rename with the role=status notice, finish-freeze + untitled replay with a byte-identical original, verbatim legacy records with a persisting rename, and 320px/1280px overflow/target/focus/keyboard checks with zero uncaught console errors); `npm run test` passed end to end (exit 0) with all eleven browser suites chained and the ten pre-existing suites green; `./init.sh` and `CI=true ./init.sh` both passed (exit 0, 23 node --check entries, no Chrome-launch timeout) and exited without starting a server; the `npm run dev` probe returned 200 for `/`, `/src/game.js`, `/src/roster.js`, `/src/main.js`, and `/src/styles.css` and 404 for `/AGENTS.md`. Screenshots under `/var/folders/24/yg25x7ld6mv2yb2xdznvmh680000gn/T/devexpert-name-game-titles/` (7 files) were generated but not visually openable this session; layout, overflow, targets, focus, and computed styles were asserted programmatically. Disclosure: physical keyboards/IMEs cannot be exercised headless; the keyboard contract is verified via CDP real-key walks, consistent with prior features.
- `src/storage.js` and `index.html` are untouched (git diff: 0 lines); the envelope version stayed 1; no migration was needed (`isUsableGameEntry` still ignores `title`); smoke strings and the design-system suite's byte-identical write-absence proofs and nav matrix hold.
- Updated README (optional title + auto-label + inline-edit behavior, replay starting untitled, the save-trigger list, the new command, next steps), ARCHITECTURE.md (renameGame/displayGameTitle/replay-untitled boundaries, header edit form with the sixth save trigger, podium title line, new suite, title boundary paragraph), and CONSTRAINTS.md (durable title rules: display-only identity, trim-once storage, guard order, frozen finished titles, render-time auto-label never stored or rewritten, sixth save trigger, untitled replays).
- Next: run independent `$feature-validator` for `name-game-titles`; after acceptance, commit, push `codex/name-game-titles`, and open the PR (the untracked spec file `docs/specs/name-game-titles.md` belongs to this feature's PR).
- Independent validation: the validator reran `CI=true ./init.sh`, `npm run test`, and the focused suite (all exit 0), confirmed `src/storage.js`/`index.html` at a 0-line diff, verified both supersessions were the only pre-existing-suite changes (all honestly commented), checked every title sink for escaping, and returned **accept** with no security findings and two low non-blocking notes (unreachable `missing-game` message reuse; `:has()` browser support consistent with the Chrome-based harness). Status persisted as `accepted` in `feature_list.json`.

### 2026-10-15 — v2 design-system implementation (refresh-design-system)

- Restyled the app onto the v2 token system as a restyle-only slice. `src/styles.css` was rewritten around the Decision 1 token layer (ivory `#FAF5EB` canvas, cool surfaces `#F1F3FD`/`#EBEEF7`/`#E5E8F2`, `--border-cool #C1C6D5`, primary `#0868C9` + `--primary-dark #00509F`, tertiary `#883A00` on `#FFE5D9` for the Finish family, error `#BA1A1A` on `--error-container #FFDAD6` for storage notices, soft shadow/radius/spacing scales, Plus Jakarta Sans type scale with tabular 28px score numerals compacting to 1.35rem ≤360px). Every hardcoded `#9f271e` was replaced by the token mappings. `--muted` stayed `#6D655C` (suite-frozen by `browser-undo-test.mjs`). All class/id/grid-area contracts, the 720/480/360 breakpoints, both reduced-motion rules, and the `podium-fall` confetti contract are unchanged. Implementation choice recorded in evidence: the selected leaderboard row uses `--primary-fixed #D6E3FF` (the token file's soft-selection role).
- `index.html` gained the Google Fonts preconnect pair plus the Plus Jakarta Sans stylesheet (`wght@400;600;700;800`, `display=swap`; no font files committed, static-server/smoke untouched) and the static v2 app bar: brand block (eyebrow "Board-game scorekeeper" + "Game night" + marker strip) and `<nav aria-label="Primary">` with three buttons `nav-dashboard` / `nav-new-game` / `nav-active-game` (distinct ids; no collision with existing `data-action` values).
- Extended `src/main.js`: one-time nav binding (Dashboard = back-home semantics + `[data-home-heading]` focus; New Game = destination view preserving the setup scratchpad + `[data-setup-heading]` focus; Active Game resolving in-memory game → newest saved active via unchanged `handleResume` → the new `active-empty` view), `paintNav()` in `render()` for `aria-current` (Dashboard on home and finished views, New Game on setup, Active Game on unfinished/empty), focusable home/setup/empty-state headings (`tabindex="-1"` + data attributes), and the `active-empty` view with the locked copy and a New game button reusing the accepted hero transition. Navigation never writes storage; no handler logic, copy, or focus targets elsewhere changed.
- Added `scripts/browser-design-system-test.mjs` (five isolated Chrome sessions: offline font fallback via `Network.setBlockedURLs`, per-view token/layout checks at 1280×800 and 320×720, the nav behavior matrix with byte-identical-payload write-absence proofs, reduced-motion + skip-link, and storage-notice regression) wired as `npm run test:browser:design-system`, chained into `npm run test`, and added to `init.sh`'s `node --check` list. Fixed during self-verification: Chrome reports inspector-blocked requests with `blockedReason` and an empty `errorText`, so the blocked-font probe matches both shapes (caught by the suite's own guard, fixed with a minimal CDP probe).
- Updated README (v2 look, nav behavior, offline fallback, new command, next steps), ARCHITECTURE.md (token layer + font boundary, static nav with resolution order, `active-empty`, `paintNav`, new suite, boundaries), and CONSTRAINTS.md (durable rules: token-translation-only restyles; no Tailwind/CDN scripts/icon fonts with labeled-text or `aria-hidden`-SVG icons; suite-frozen `--muted`; nav is display/state-only, never writes, focus-to-heading).
- Verification: `node --check` on `src/main.js` and the new suite passed; `npm run test:browser:design-system` passed on real headless Chrome across all five sessions (tokens, offline fallback hierarchy/tabular numerals/no overflow, nav matrix with `aria-current` per view including finished → Dashboard, Active Game resolution order, byte-identical storage across every navigation, ≥44px targets, visible focus, skip link first, reduced-motion suppression, exact notice copy/role/contrast; zero uncaught console errors); `npm run test` passed end to end (exit 0) with all ten browser suites chained and the nine pre-existing suites unmodified and green; `./init.sh` and `CI=true ./init.sh` both passed (exit 0, no Chrome-launch timeout) and exited without starting a server; the `npm run dev` probe returned 200 for `/`, `/src/styles.css`, and `/src/main.js` and 404 for `/AGENTS.md`. Screenshots under `/var/folders/24/yg25x7ld6mv2yb2xdznvmh680000gn/T/devexpert-refresh-design-system/` (8 files) were generated but not visually openable this session; tokens, layout, overflow, targets, focus, nav state, and fallback hierarchy were asserted programmatically.
- Independent validation: the validator reran `CI=true ./init.sh`, `npm run test`, and the focused suite (all exit 0), re-probed the server boundary (200/404/400), confirmed no pre-existing suite changed and the frozen `--muted` contract held, and returned **accept** with no Critical/High/Medium findings and no security issues. Status persisted as `accepted` in `feature_list.json`.
- Next: run independent `$feature-validator` for `refresh-design-system`; after acceptance, commit, push `codex/refresh-design-system`, and open the PR (the untracked spec file `docs/specs/refresh-design-system.md` belongs to this feature's PR).

### 2026-10-15 — v2 design-update discovery and feature planning

- Reviewed the five-screen v2 design set and token file with the user; adopted them as the visual source of truth and moved the assets from the untracked `Design update/` folder into `docs/design/update-v2/`.
- Updated `CONTEXT.md` (four new glossary terms plus a decoration warning), `docs/build-brief.md` (delivered-MVP status, v2 scope, extended non-goals and validation), `docs/domain-model.md` (game titles, activity timestamps, player numbers, derived views), `docs/risks-and-open-questions.md` (game identification resolved; new implementation-time decisions), and `DESIGN.md` (new visual source of truth; mockup decoration marked do-not-implement).
- Agreed scope: visual refresh plus bounded additions (titles, activity timestamps + recent entries, quick tap counters, player numbers, distribution bar, podium actions). Explicitly out of scope: rounds/timers, dashboard statistics, presets, roster reuse, one-tap games; Tailwind rejected in favor of plain CSS with linked fonts and fallbacks.
- Appended the seven v2 features to `feature_list.json` as `not_started` with `depends_on: ["refresh-design-system"]` except the foundation feature itself.

### 2026-10-12 — Score-entry restriction implementation (restrict-score-entry-input)

- Completed the interrupted implementer run (the tree already held partial
  uncommitted work on the same branch; it was verified against the spec and
  kept — nothing was reverted or redone). `src/score.js` gained the exported
  predicates `isPlainIntegerText` (`/^[+-]?\d+$/` on the trimmed text) and
  `isPlainScoreDraft` (`/^[+-]?\d*\.?\d*$/`, the entry/draft pattern that
  allows empty, a lone sign, and a transient decimal), plus one final
  plain-format gate in `parseScoreAmount` ordered after the existing
  finite/integer/zero/range checks: exact-integer text that is not plain
  (`1e3`, `0x10`, `10.`) returns the existing `{ error: "not-a-number" }`, so
  every prior error mapping is preserved bit-for-bit (`1e-3` → not-integer,
  `0.0` → zero, `1e30` → out-of-range). This supersedes the documented
  add-player-score `1e3` semantic-parse decision; no value is ever silently
  rewritten.
- Extended `src/main.js`: `bindActiveEvents` attaches a `beforeinput`
  listener (`guardScoreEntryInput`) to `#score-amount`. For insertion input
  types with string `data` it builds the prospective value (selection
  replaced by the data, falling back to the data alone when the selection API
  is unavailable — number inputs expose none) and calls `preventDefault()`
  when it fails `isPlainScoreDraft`. Deletion/undo/history types and
  data-less insertions (e.g. some autofill replacements) are never blocked;
  blocked characters are silent, matching how `type="number"` already
  ignores `a`/`x`. `.` stays typable so the typed-decimals save path still
  reaches "Decimals are not allowed." exactly as accepted. No markup, style,
  copy, or focus change; `type="number"` and all attributes stay (signed
  mobile keypad preserved; `inputmode`/`pattern`/type change rejected per
  spec).
- Tests: `scripts/score-test.mjs` honestly flips the `1e3` assertion to
  `{ error: "not-a-number" }` with the supersession comment and adds `+10`,
  `0x10`/`10.`, 14 `isPlainIntegerText`, and 15 `isPlainScoreDraft` cases
  (the `1e-3`/`0.0`/`1e30` neighbors untouched and green).
  `scripts/browser-score-test.mjs` replaces the semantic-`1e3` save with
  `savePoints(cdp, "1000")` (Sam 5 → 1005 keeps the downstream totals
  `["1005","7"]` and `["7","-5"]` valid), adds real-key `e`/`E`/`x` blocking
  via a new `pressRealKey` helper (`Input.dispatchKeyEvent`, since `fill()`
  sets `value` directly and bypasses `beforeinput`) with digits/sign/
  deletion still entering and typing `1e3` yielding `13`, `Input.insertText`
  `"1e3"` blocked wholesale, programmatic `fill("1e3")` rejected at save with
  the not-a-number message and a byte-identical stored payload, a11y
  attributes (type/step/min/max, label, helper, `aria-describedby`,
  `aria-live`) asserted unchanged, and the same real-key letter block at
  320×720; summary line updated. No new files, npm commands, or
  `init.sh`/`package.json` changes.
- Updated README (plain-signed-integers-only usage sentence + final-slice
  next-steps pointer), ARCHITECTURE.md (entry/parse contract on both
  `src/score.js` and `src/main.js` descriptions plus a dedicated guarded
  entry/save paragraph), and CONSTRAINTS.md (durable MUST: two-layer
  plain-integer-only rule with the gate ordered after the existing checks).
- Verification: `node --check` on the four touched files passed;
  `npm run test:score` passed; `npm run test:browser:score` passed on real
  headless Chrome (letter blocking, wholesale insert block, programmatic
  rejection with unchanged totals/focus/storage, all accepted saves and
  rejections, 320px, a11y attributes, zero console errors);
  `npm run test` passed end to end with all nine browser suites chained and
  the other eight unmodified; `./init.sh` and `CI=true ./init.sh` passed
  (exit 0) and exited without starting a server; the `npm run dev` probe
  returned 200 for `/`, `/src/score.js`, and `/src/main.js` and 404 for
  `/AGENTS.md`. Screenshots at
  `/var/folders/24/yg25x7ld6mv2yb2xdznvmh680000gn/T/devexpert-add-player-score/`
  (desktop + 320px) were generated but not visually openable this session;
  layout, targets, focus, and overflow were asserted programmatically. No
  transient Chrome-launch timeout occurred this session.
- Known limitation: a physical mobile keypad cannot be exercised headless;
  the signed keypad contract is preserved by construction (`type="number"`
  kept, no `inputmode`), same disclosure as add-player-score. A physical
  device pass remains available for any manual verification.
- Next: run independent `$feature-validator` for `restrict-score-entry-input`; after
  acceptance, commit `feat: complete restrict-score-entry-input`, push
  `codex/restrict-score-entry-input`, and open the PR (the untracked spec
  file `docs/specs/restrict-score-entry-input.md` belongs to this feature's
  PR).
- Independent validator verdict: `accept`. Reran the score suites, both gate
  modes, an in-process raw HTTP boundary probe, and an independent browser
  probe (typed 2.5 reaches the exact decimals message, insertText
  rejections, silent comma/space blocking, number-input attributes asserted
  live); confirmed no value rewriting, parse gate ordering, and that the
  interrupted-run tree is consistent; no security findings.

### 2026-10-12 — Replay implementation (play-again)

- Added `src/game.js`: pure `replayGame({ game, now = new Date() })` alongside
  `finishGame` (it imports `createGame`/`FALLBACK_TITLE` from `./roster.js` —
  a new edge to the leaf roster module). Guards: missing/invalid game or
  non-array players → `{ game: null, error: "missing-game" }`; any
  non-`"finished"` status → `not-finished`; roster validation failures from
  `createGame` (blank/overlong names, unknown/missing colors, non-string
  names, null entries, <2 or >20 players — reachable only via hand-corrupted
  stored data) → `invalid-roster` without throwing. Success maps the finished
  players to rows and calls `createGame({ title, rows, now, idSeed:
  "replay-game" })`, so ids are `replay-game-<timestamp>` and players
  `replay-game-player-N` — structurally new and unable to collide with
  `active-game-*`. The helper restores each new player's `marker` (nonempty
  string) and `order` (integer) from the original at the same index with the
  regenerated values as fallbacks; non-string titles fall back to
  `FALLBACK_TITLE`; the result has `status: "active"`, zero totals, and no
  `changes`/`updatedAt`; the input is never mutated. `GAME_ERROR_CODES` is
  now exactly `["missing-game", "already-finished", "not-finished",
  "invalid-roster"]`.
- Extended `src/main.js`: `state.replayFeedback` (reset wherever the other
  transient flags reset — `handleResume`, back-home, `resetSetup` — and in
  the handler); `renderFinishedGame` renders a `.replay-section` below the
  standings `<ol>` inside the roster panel with one `type="button"`
  `primary-action` "Play again" (`data-action="play-again"`, visible text as
  the accessible name) and the `#replay-feedback` `aria-live="polite"` region
  (inline-rendered like `#score-feedback`); `handlePlayAgain()` guards
  visibly (message + `console.warn("Game replay failed:", code)` +
  `paintReplayFeedback()` without re-render), and on success mirrors
  `handleResume`: slot replacement, transient resets (`selectedPlayerId` =
  first new player, `scoreFeedback`/`finishPromptOpen`/`podiumOpen`/
  `replayFeedback` = null), the unchanged `persistActiveGameSnapshot()` —
  the fifth successful-mutation save trigger — then `render()`,
  `paintStorageNotice()`, and focus on `[data-active-heading]`.
  `SCORE_ERROR_MESSAGES` gained `not-finished` ("Only finished games can be
  replayed.") and `invalid-roster` ("This game's saved players can't be
  replayed."); `paintReplayFeedback()` mirrors `paintScoreFeedback`; the
  optional-chained `play-again` listener in `bindActiveEvents` leaves the
  active view, home cards, and podium dialog untouched.
- Styled `src/styles.css`: `.replay-section` only (top-border separation and
  16px rhythm mirroring `.finish-section`); the button reuses
  `.primary-action` (≥44px) as-is; no new tokens or motion.
- Tests: extended `scripts/game-test.mjs` with the `replayGame` guard,
  copy-contract, marker/order-restoration-with-fallbacks, non-string-title,
  invalid-roster (8 corrupted shapes), immutability, and 20-player cases plus
  the one honest `GAME_ERROR_CODES` exact-list update; new
  `scripts/browser-play-again-test.mjs` with four isolated Chrome sessions —
  A desktop full MVP flow through replay with byte-identical
  original-entry checks across replay AND replay-game scoring, B
  reopen-and-repeated replays (3 distinct stored games listed once each, no
  re-celebration), C seeded corrupted + valid finished games under blocked
  writes (visible `invalid-roster` refusal, in-memory replay/scoring/undo,
  accepted role=status write notice, byte-identical payload, no phantom
  cards, code-only warnings), and D the 320×720 full loop with real-key
  Tab/Space activation, visible focus, ≥44px target, role=status regions, no
  overflow, and post-reload separation. Wired `test:browser:play-again` into
  `package.json`'s `test` chain and added the new script to `init.sh`'s
  `node --check` list. No new `src/*` module, so the static-server allowlist,
  smoke assets, and required-file list are unchanged.
- Fixed during self-verification: two test-authoring bugs (the 20-player
  unit assertion expected a wrong title; the mobile Tab walk assumed
  `back-home` precedes the heading in Tab order — it precedes it in DOM, so
  forward Tab from the heading reaches Play again first); the corrupted
  roster's rendered name order follows rank (Lonely 3 before the blank-name
  0), so that assertion was corrected to DOM order. No product-code failures
  were found by the suites.
- Verification: `node --check` on all sources and test scripts passed;
  `npm run test:game` passed with the replay cases; `npm run
  test:browser:play-again` passed on real headless Chrome across all four
  sessions (presentation copies token-by-token, zero totals at shared rank 1,
  "Nothing to undo yet.", distinct `replay-game-*`/`active-game-*` ids,
  byte-identical finished original across replay and replay-game scoring,
  independent home listings after reload, repeated replays, the polite
  corrupted-roster refusal, blocked-write honesty with unchanged notice copy
  and code-only warnings, 320px/keyboard/focus checks, zero uncaught console
  errors); `npm run test` passed end to end with all nine browser suites
  chained and the eight existing suites unmodified; `./init.sh` and
  `CI=true ./init.sh` passed (exit 0) and exited without starting a server —
  one CI-mode attempt failed transiently with "Timed out waiting for Chrome
  DevTools endpoint." launching Chrome for the podium suite (a 30s launch
  timeout, no assertion failure involved); the immediate rerun passed fully.
  The `npm run dev` probe returned 200 for `/`, `/src/game.js`,
  `/src/main.js`, and `/src/styles.css` and 404 for `/AGENTS.md`.
  Screenshots under
  `/var/folders/24/yg25x7ld6mv2yb2xdznvmh680000gn/T/devexpert-play-again/`
  (6 files) could not be opened for visual inspection this session because
  temp-directory reads are permission-blocked; layout, visibility, overflow,
  target sizes, focus outlines, and live-region roles were asserted
  programmatically. The manual real-browser pass is covered by the four
  automated real-Chrome sessions at 1280×800 and 320×720 with real-key
  Tab/Space/Escape walks.
- Updated README (replay behavior + new command + next-feature pointer),
  ARCHITECTURE.md (replayGame boundary, finished-view control and feedback
  region, fifth save trigger, home outcomes, new suite), and CONSTRAINTS.md
  (durable rules: replay only via `replayGame` with presentation-only
  copying and a byte-identical stored original, the fifth save trigger under
  the storage-failure rules, control placement, and visible guards).
- Next: run independent `$feature-validator` for `play-again`; after
  acceptance, commit `feat: complete play-again`, push `codex/play-again`,
  and open the PR (the untracked spec file `docs/specs/play-again.md`
  belongs to this feature's PR).
- Independent validator verdict: `accept`. Reran the game and play-again
  suites, two clean CI gate runs (flake did not reproduce; launch timeout,
  not an assertion), HTTP boundary probes, and a full-diff conformance review
  confirming core modules untouched; no security findings.

### 2026-10-12 — Podium celebration implementation (celebrate-podium)

- Added `src/standings.js`: pure `podiumRows(game)` =
  `rankPlayers(game).filter((row) => row.rank <= 3)` — a fresh array per call,
  input never mutated, no rank stored; ties never collapsed. Extended
  `scripts/standings-test.mjs` with the 1,1,3 / 1,2,2-with-rank-4-exclusion /
  20-tied cases, guard cases, immutability, and freshness assertions.
- Extended `src/main.js`: `state.podiumOpen` (default `false`, reset exactly
  where `finishPromptOpen` resets — `resetSetup`, `handleResume`, and the
  back-home handler). The `handleFinishGame` success path keeps the accepted
  `persistActiveGameSnapshot()` unchanged, then sets
  `podiumOpen = podiumRows(result.game).length > 0` and makes the heading
  focus conditional (only when no podium opened). `renderFinishedGame`
  renders the app's first `<dialog>` (`.podium-dialog`,
  `aria-labelledby="podium-title"`, `aria-describedby="podium-lede"`) only
  when the flag is set and rows exist, calls `showModal()` behind an
  `!dialog.open` guard, and focuses the Close button. Markup: `.podium-body`
  (padding + `position: relative`) with the `aria-hidden` confetti layer
  (14 deterministic pieces, inline custom properties for left/delay/duration/
  drift/spin/size/color from the marker tokens), "Final podium" title, lede,
  an `aria-label="Podium players"` `<ol>` of ascending rank groups with empty
  groups omitted, and the `podium-close` Close button. Podium rows reuse
  `.player-token` spans and the `"{name}: rank {rank}, total {total}"` label
  convention. Dismissal funnels through one synchronous idempotent cleanup
  (`handlePodiumClose`: clear flag → `render()` without the dialog → focus
  `[data-active-heading]`).
- Styled `src/styles.css`: `.podium-dialog` (`width: min(calc(100vw - 24px),
  560px)`, `max-height: calc(100svh - 24px)`, `overflow: auto`, surface/
  border/radius/shadow tokens, `::backdrop` scrim), `.podium-body`,
  `.podium-confetti` (absolute inset, hidden overflow, pointer-events none),
  `.confetti-piece` + one `@keyframes podium-fall` (durations 1.6–2.39s,
  delays 0–0.79s, iteration-count 1, forwards, ends at opacity 0, animated
  top/transform), `.podium-title`/`.podium-lede`/`.podium-groups`/
  `.podium-group.is-rank-one` (surface-strong emphasis)/`.podium-rank-heading`
  /`.podium-player*` (four-column grid mirroring `.is-final`, ≤360px
  compaction), full-width `.podium-close` (≥44px via `.primary-action`), an
  explicit `@media (prefers-reduced-motion: reduce) { .podium-confetti {
  display: none; } }`, and no changes to existing rules.
- Tests: new `scripts/browser-podium-test.mjs` (five isolated Chrome sessions
  covering Scenarios 1–7, with local `pressEscape`/`pressSpace`/`pressTab`
  real-key helpers, real backdrop clicks via CDP mouse events, and
  `Emulation.setEmulatedMedia` reduced-motion emulation) and honest updates to
  `scripts/browser-finish-game-test.mjs` (podium-open/focus assertions after
  confirm, dismiss-before-goHome, Escape in the 320px walk, no-podium-on-
  reopen at both reopen points, podium assertions in the blocked-write and
  suppression sessions, two new screenshots). Wired `test:browser:podium`
  into `package.json`'s `test` chain and added the new script to `init.sh`'s
  `node --check` list. No new `src/*` module, so the static-server allowlist,
  smoke assets, and required-file list are unchanged.
- Fixed during self-verification: two test-flow bugs (missing `goHome` calls
  between games) and two real platform findings confirmed with minimal-page
  repros and recorded in the spec — (1) Chrome 154 dispatches the dialog
  `close` event as a queued task that can be delayed for seconds or starved
  indefinitely on hidden pages, so dismissal cleanup cannot rely on it alone;
  the implementation funnels Close/backdrop/Escape (native `cancel` with
  `preventDefault`) through the same synchronous cleanup, keeping the
  `close` listener as an idempotent fallback; (2) with a dialog whose only
  focusable is its Close button, the native modal trap alternates between
  wrapping to that control and transiently resting on `body` before
  recapturing on the next Tab — focus never reaches background controls and
  the dialog stays open, so the suite asserts that guarantee honestly instead
  of a strictly always-inside cycle.
- Verification: `node --check` on all sources and test scripts passed;
  `npm run test:standings` passed with the podiumRows cases;
  `npm run test:browser:podium` passed on real headless Chrome across all
  five sessions (ties 1,1,3 with no fabricated rank-2 group; rank-4
  exclusion; 20-tied single scrolling rank-1 group with internal scroll at
  1280×800 and 320×720 and no page overflow; Close/Escape/backdrop/Space/
  Enter dismissals returning focus to the heading; no re-celebration on
  reopen; byte-identical payloads across open/dismiss including blocked-write
  and invalid-read suppression with code-only warnings; reduced-motion
  confetti `display: none`; ≥44px Close; visible focus; zero uncaught console
  errors); `npm run test:browser:finish-game` passed with the honest updates;
  `npm run test` passed end to end with all eight browser suites chained and
  the six suites other than finish-game unmodified; `./init.sh` and
  `CI=true ./init.sh` passed and exited without starting a server; the
  `npm run dev` probe returned 200 for `/`, `/src/standings.js`,
  `/src/main.js`, and `/src/styles.css` and 404 for `/AGENTS.md`.
  Screenshots under
  `/var/folders/24/yg25x7ld6mv2yb2xdznvmh680000gn/T/devexpert-celebrate-podium/`
  (4 files) plus the finish-game suite's two podium captures could not be
  opened for visual inspection this session because temp-directory reads are
  permission-blocked; layout, visibility, overflow, scroll, target sizes, and
  computed styles were asserted programmatically. The manual real-browser
  pass is covered by the automated real-Chrome sessions at 1280×800 and
  320×720 with real-key and real-mouse dismissal walks.
- Updated README (podium behavior + new command), ARCHITECTURE.md
  (podiumRows, podium display layer, first `<dialog>` modal, dismissal
  funnel), and CONSTRAINTS.md (durable rules: display-only celebration with
  ties never collapsed, zero writes/persisted fields, never re-celebrate on
  revisit, synchronous modal dismissal cleanup, and reduced-motion
  suppression).
- Next: run independent `$feature-validator` for `celebrate-podium`; after
  acceptance, commit `feat: complete celebrate-podium`, push
  `codex/celebrate-podium`, and open the PR (the untracked spec file
  `docs/specs/celebrate-podium.md` belongs to this feature's PR).
- Independent validator verdict: `accept`. Reran both gate modes,
  standings/podium/finish-game suites, HTTP boundary probes, and a static
  spec-conformance review of the full diff; no security findings; the honest
  finish-game suite updates and the two documented Chrome platform findings
  were confirmed.

### 2026-10-12 — Finish-game implementation (finish-game)

- Added `src/game.js`: pure `finishGame({ game, now = new Date() })` — the
  one-way `active → finished` transition. Guards: missing/invalid game
  (non-object, array, or players not an array) → `{ game: null, error:
  "missing-game" }`; any non-active `status` → `{ game: null, error:
  "already-finished" }`. Success returns `{ game: { ...game, status:
  "finished" }, error: null }` — a new object; input never mutated; players,
  totals, changes, and `player.order` untouched; no fields beyond `status`
  (no `finishedAt`, no ranks; the `now` parameter is part of the signature
  but deliberately stores nothing). Error codes live in the local
  `GAME_ERROR_CODES` list, separate from `SCORE_ERROR_CODES`.
- Extended `src/main.js`: `state.finishPromptOpen` (default `false`) renders
  an inline finish section in the score-entry panel below the score form
  (outside the form element): opener "Finish game" swaps to the prompt —
  "Finish this game?" plus the warning "Finished games can't be reopened for
  scoring. Final standings stay saved in this browser." — with a confirm
  "Finish game" button (`aria-describedby` pointing at the warning) and
  "Cancel". No `window.confirm`, no `<dialog>`. Explicit focus moves: open →
  confirm button, cancel → opener, finish → `[data-active-heading]`.
  `renderActiveGame` branches on `game.status === "finished"` to
  `renderFinishedGame`: same header (eyebrow "Finished"), "All games" back
  control, storage notice, and full `rankPlayers(game)` leaderboard with
  unchanged aria-labels, but a polite `role="status"` line reading "Final
  standings — this game is finished and can't be scored." and zero mutation
  controls (no Add points buttons, no `aria-pressed`/`.is-selected`, no score
  panel, no Save points, no undo) via `.active-player.is-final` rows.
  Confirming calls `finishGame`, sets `state.activeGame`, then the unchanged
  `persistActiveGameSnapshot()` — the fourth successful-mutation save trigger
  — so suppression/rollback/notice behavior applies as accepted. Error codes
  `missing-game`/`already-finished` joined `SCORE_ERROR_MESSAGES` and repaint
  `#score-feedback` without re-render. The prompt flag resets in
  `resetSetup`, `handleResume`, and the active back-home handler.
  `renderHome` replaces the finished-games placeholder with an `<ol
  aria-label="Finished games">` built from `orderSavedGamesForDisplay`
  filtered to `status === "finished"`; cards reuse the `.saved-game`
  structure with a "View results" button (`data-action="view-results"`,
  `aria-label="View results {title}"`) wired through the existing
  `handleResume`, so reopening is read-only via the status branch. New empty
  state: "No finished games yet." / "Finish a game and its standings will
  appear here."
- Styled `src/styles.css`: `.finish-section` (top-border separation),
  `.finish-action` (≥44px, #9f271e on `--surface-strong`, 7.05:1 AA,
  distinct from Save/Undo), `.finish-prompt`/`.finish-prompt-title`/
  `.finish-prompt-warning`/`.finish-prompt-actions`, `.finished-note`
  (role=status card), and `.active-player.is-final` four-column grid variants
  (desktop and ≤480px areas without the button row). No new tokens; 8px
  rhythm; focus outline inherited.
- Tests: new `scripts/game-test.mjs` (guards, immutability via
  structuredClone, key equality with no new fields, preserved change
  log/order, double-finish rejection, fresh and 20-player games, local error
  code list) and `scripts/browser-finish-game-test.mjs` (three isolated
  Chrome sessions covering spec Scenarios 1–5: cancel→score→undo with
  byte-identical payload, locked view assertions, stored `status: "finished"`,
  reload/reopen with identical ranks/totals plus an untouched active game,
  blocked-write and invalid-suppression finishes with code-only warnings and
  byte-identical raw payload, 320px overflow/target checks, real-keyboard
  Tab/Enter walk with visible focus, `role="status"`, and zero uncaught
  console errors). Wired `test:game` and `test:browser:finish-game` into
  `package.json`'s `test` chain; added `src/game.js` to the
  `scripts/static-server.mjs` allowlist and `scripts/smoke.mjs` asset check;
  added `src/game.js` to the required-file list and the two new scripts to
  the `node --check` list in `init.sh`. Existing suites ran unmodified.
- Updated README (finishing behavior + new commands), ARCHITECTURE.md (game
  lifecycle boundary, finished variant, Finished list, fourth save trigger),
  and CONSTRAINTS.md (durable rules: one-way finish via `finishGame`, no
  un-finish, explicit confirmation, read-only finished rendering, fourth save
  trigger obeying storage-failure rules).
- Verification: `node --check` on all sources and test scripts passed;
  `npm run test:game` passed; `npm run test:browser:finish-game` passed on
  real headless Chrome across all three sessions with zero uncaught console
  errors and code-only warnings; `npm run test` passed end to end with all
  seven browser suites chained; `./init.sh` and `CI=true ./init.sh` passed
  and exited without starting a server; `npm run dev` probe returned 200 for
  `/`, `/src/game.js`, `/src/main.js`, and `/src/styles.css` and 404 for
  `/AGENTS.md`. Screenshots under
  `/var/folders/24/yg25x7ld6mv2yb2xdznvmh680000gn/T/devexpert-finish-game/`
  (5 files, desktop + 320px) could not be opened for visual inspection this
  session because temp-directory reads are permission-blocked; layout,
  visibility, contrast tokens, ≥44px targets, and 320px overflow were
  asserted programmatically. The manual real-browser pass is covered by the
  three automated real-Chrome sessions.
- Fixed during self-verification: the 20-player unit loop initially used
  `amount: index - 5`, which hits the rejected zero amount at index 5;
  corrected to nonzero amounts. The new suite's session runner initially
  dropped the callbacks' screenshot paths and the keyboard-focus check read
  the computed outline after synthetic clicks, where `:focus-visible` does
  not match; fixed by returning the callback result and asserting the
  visible outline on genuinely keyboard-focused elements after a real Tab.
- Next: run independent `$feature-validator` for `finish-game`; after
  acceptance, commit `feat: complete finish-game`, push the branch, and open
  the PR (the untracked spec file `docs/specs/finish-game.md` belongs to this
  feature's PR).
- Independent validator verdict: `accept`. Reran both gate modes, game and
  finish-game suites, HTTP boundary probes, and an independent browser probe
  (confirm outside the score form, real Space/Enter flows, payload gains
  nothing beyond status, shared ranks 1,2,2 in final standings); no security
  findings; six existing browser suites untouched and green.

### 2026-10-12 — Storage-failure feedback implementation (handle-storage-failure)

- Extended `src/storage.js` with one reporting field: `loadSavedGames` now
  returns `droppedCount` (entries rejected by `isUsableGameEntry`; `0` for
  clean and `unavailable`/`invalid` reads). `saveGames`, the envelope shape,
  and every other behavior stay exactly as accepted.
- Extended `src/main.js` with the storage-health layer: `state.storageReadError`
  (`null | "unavailable" | "invalid"`), `state.storageDroppedCount`, and
  `state.lastSaveError` (`null | "unavailable" | "write"`), set from the
  startup load before the first render so a failed read explains itself
  immediately instead of silently rendering an empty list.
  `getStorageNotice()` derives the first applicable of `invalid` (read error)
  → `lastSaveError` → `unavailable` (read error); `renderHome` and
  `renderActiveGame` embed one `.storage-notice` with `role="status"` and the
  exact per-code copy (top of the Unfinished panel; above the leaderboard
  rows), plus a home-only `.storage-notice-info` note when
  `storageDroppedCount > 0`; `paintStorageNotice()` (replaceChildren +
  append, mirroring `paintScoreFeedback`) runs after `render()` in the three
  mutation paths so the live region updates reliably. Under `invalid`
  suppression the unfinished-panel empty state swaps to "Saved games can't be
  shown right now." / "Nothing was deleted — the saved data just couldn't be
  read."
- Write-safety rule in `persistActiveGameSnapshot()`: while the startup read
  is `invalid` it logs `console.warn("Game save failed:", "invalid")` and
  returns without upserting or calling `saveGames`, so the unreadable payload
  is preserved byte-for-byte and suppression lifts only on reload. Otherwise
  it captures `previous = state.savedGames`, upserts, writes, and on a failed
  write rolls the upsert back, sets `lastSaveError`, and keeps the code-only
  warning — home never renders a phantom card. On success it clears
  `lastSaveError` and a prior `unavailable` read error. There are no retry
  or dismiss controls: every subsequent mutation auto-retries and a
  successful save clears the notice.
- Styled `src/styles.css`: `.storage-notice` warning card (#9f271e on
  `--surface-strong`, 7.05:1 AA contrast, `overflow-wrap: anywhere`,
  8px-rhythm margins) and `.storage-notice-info` muted variant (~5.4:1); no
  layout changes beyond stacking the block above panel content; no overflow
  at 320px.
- Tests: `scripts/storage-test.mjs` deepEqual results updated honestly to
  `{ games, error, droppedCount }` plus dropped-count cases; the
  `browser-resume-test.mjs` blocked-storage scenario now asserts the write
  notice (exact copy, `role="status"`), `cards.length === 0` after failed
  saves, the unchanged success feedback including `Rank: 1.`, and no
  pre-failure notice; new `scripts/browser-storage-failure-test.mjs` covers
  spec Scenarios 1–6 in six isolated Chrome sessions (setItem-throws, corrupt
  `not-json{`, `{ version: 2 }` envelope, counted setItem failures within one
  document, partial corruption with a seeded usable game, unavailable read
  with an instrumented write counter), byte-identical `raw` payload checks —
  including reloads with the seeding script removed so the real stored bytes
  are re-read — and 320px/`role="status"`/contrast/keyboard checks for all
  four notice states. Wired `test:browser:storage-failure` into
  `package.json`'s `test` chain and `init.sh` syntax checks.
- Updated README (user-facing behavior + new test command),
  ARCHITECTURE.md (failure-feedback layer, suppression, rollback, new script),
  and CONSTRAINTS.md (three durable MUST rules: suppress all writes while the
  startup read is invalid, roll back failed-write upserts so nothing unsaved
  is shown as saved, polite single live-region notices with code-only
  diagnostics).
- Verification: `node --check` on all sources and test scripts passed;
  `npm run test:storage` passed; `npm run test:browser:resume` passed with the
  strengthened blocked-storage session; `npm run test:browser:storage-failure`
  passed on real headless Chrome across all six sessions with zero uncaught
  console errors and code-only warnings; `npm run test` passed end to end with
  all six browser suites chained; `./init.sh` and `CI=true ./init.sh` passed
  and exited without starting a server; `npm run dev` probe returned 200 for
  `/`, `/src/main.js`, `/src/styles.css`, and `/src/storage.js` and 404 for
  `/AGENTS.md`. Screenshots under
  `/var/folders/24/yg25x7ld6mv2yb2xdznvmh680000gn/T/devexpert-handle-storage-failure/`
  (10 files, desktop + 320px) could not be opened for visual inspection in
  this session because temp-directory reads are permission-blocked; notice
  visibility, computed AA contrast (>= 4.5), 320px overflow, and >=44px
  targets were asserted programmatically. The manual real-browser pass is
  covered by the six automated real-Chrome sessions (DevTools-equivalent
  storage seeding, key corruption, counted quota failures, blocked writes).
- Fixed during self-verification: the new suite's session runner initially
  returned diagnostics instead of the callbacks' screenshot paths, so the
  summary printed captured warnings; fixed by returning the callback result
  and asserting zero console problems inside the runner.
- Next: run independent `$feature-validator` for `handle-storage-failure`;
  after acceptance, commit and open the PR (the untracked spec file
  `docs/specs/handle-storage-failure.md` belongs to this feature's PR).
- Independent validator verdict: `accept`. Reran both gate modes, storage/
  resume/storage-failure suites, HTTP boundary probes, and an independent
  32-assertion browser probe (hostile payload shapes proving byte-for-byte
  preservation, zero phantom cards, escaped hostile titles); no security
  findings. Two Low non-blocking notes: the dropped disclosure is an info note
  without role=status (functionally inert startup content; role=status is
  asserted for the invalid/write/unavailable notice states), and the dropped
  note persisting after a successful save matches the spec's recovery list.

### 2026-10-12 — Save and resume implementation (resume-saved-game)

- Added `src/storage.js`: single versioned key `scorekeeper:games` holding
  `{ version: 1, games: [...] }`. `loadSavedGames({ storage })` guards
  missing/throwing storage (`unavailable`), `JSON.parse`s and validates the
  envelope plus a per-entry crash guard (string `id`, array `players`;
  unusable entries dropped with a code-only warning) returning
  `{ games, error: null | "unavailable" | "invalid" }` — it never throws and
  never rewrites the payload. `saveGames({ games, storage })` stringifies the
  envelope inside try/catch and returns `{ saved, error: null | "unavailable"
  | "write" }`. `upsertSavedGame(games, game, { updatedAt })` returns a new
  array replacing by id or appending, stamping `updatedAt` only on the stored
  copy; `orderSavedGamesForDisplay(games)` returns a sorted copy
  (updatedAt desc → createdAt desc → id asc). Storage backend is injectable;
  the default probes `globalThis.localStorage`.
- Extended `src/main.js`: `state.savedGames` loaded once at startup before the
  first render (load failures log `console.warn("Saved game load failed:",
  code)`); one `persistActiveGameSnapshot()` helper upserts the active game
  with a fresh `updatedAt`, writes through `saveGames`, and on failure logs
  `console.warn("Game save failed:", error)` with no names/scores. It is
  called exactly in the three success paths: setup submit after
  `state.activeGame = game`, `handleScoreSubmit` after
  `state.activeGame = result.game`, and `handleUndo` after the same. Failed
  validations, selection changes, feedback repaints, and the nothing-to-undo
  no-op never save. `renderHome` now builds the "Unfinished games" panel from
  `orderSavedGamesForDisplay(state.savedGames)` filtered to `status:
  "active"`: each card shows the title, "{N} players", an "Updated {date}"
  label, roster-order names, one `marker-*` color chip per player, and a
  `Resume` button with `aria-label="Resume {title}"`; the retention line
  "Saved only in this browser — clearing site data removes these games." is
  always present; the empty state and finished-games panel keep their roles.
  `handleResume(gameId)` restores the saved game verbatim as
  `state.activeGame`, selects the first player, clears feedback, renders, and
  focuses `[data-active-heading]` — so undo works immediately after resume
  and its success persists the shortened log.
- Styled `src/styles.css`: `.saved-game-list`/`.saved-game` cards within the
  panel rhythm (info block + right-aligned ≥44px `.resume-action`), marker
  strip, and muted `.retention-note`; ≤480px cards stack single-column with a
  full-width resume control.
- Added `scripts/storage-test.mjs` (in-memory storage stubs; round-trip,
  upsert/append/replace/immutability, ordering ties, invalid payloads,
  entry crash guard with name-free warnings, unavailable/throwing storage,
  write failures) and `scripts/browser-resume-test.mjs` (Scenarios 1–6 plus a
  separate Chrome session where `Page.addScriptToEvaluateOnNewDocument`
  patches `Storage.prototype.setItem` to throw). Added the shared
  `readSavedGamesState(cdp, storageKey)` helper (key count/name, payload
  version, game count, saved ids, raw payload) to
  `scripts/browser-test-utils.mjs` and updated the four existing browser
  suites' `localStorage.length === 0` assertions honestly: 0 keys before any
  game exists, exactly 1 key `scorekeeper:games` after the first save,
  gameCount growing only on successful mutations, and byte-identical raw
  payloads proving failed validations and no-op undos never write.
- Wired `test:storage` and `test:browser:resume` into `package.json`'s `test`
  chain; added `src/storage.js` to the `scripts/static-server.mjs` allowlist
  and `scripts/smoke.mjs` asset check; added `src/storage.js` to the
  required-file list and the three new files to the `node --check` list in
  `init.sh`.
- Verification: `node --check` on all sources and test scripts passed;
  `npm run test:storage` passed; `npm run test:browser:resume` passed on real
  headless Chrome covering Scenarios 1–6 (two games created+scored, reload,
  resume each with correct independent totals, card content/ordering with
  title-bearing Resume names, undo-after-resume plus a second reload proving
  no resurrection, 320px stacking/keyboard/retention checks, and the
  blocked-storage session where saves fail with code-only warnings, no
  console errors, and nothing written); `npm run test` passed end to end with
  all five browser suites chained; `./init.sh` and `CI=true ./init.sh` passed
  and exited without starting a server; `npm run dev` probe returned 200 for
  `/`, `/src/storage.js`, and `/src/main.js` and 404 for `/AGENTS.md`.
  Screenshots: `/var/folders/24/yg25x7ld6mv2yb2xdznvmh680000gn/T/devexpert-resume-saved-game/desktop-home-saved-games.png`,
  `desktop-resumed-friday.png`, and `mobile-home-saved-games-320px.png`
  (generated but not visually openable this session; readability asserted
  programmatically).
- Fixed during self-verification: the resume suite initially expected
  resumed rows in roster order with wrong ranks — rows render in descending
  total order (Taylor/Sam/Jamie with tied zeros sharing ranks 1,1,3), so the
  assertions were corrected to the ranked order; a console-warning listener
  initially read `event.params?.args` where the shared CDP client dispatches
  params directly (`event.args`), so blocked-storage warnings were not
  captured until fixed.
- Updated README, ARCHITECTURE.md (storage module and persistence boundary
  replacing "reloading clears everything"), CONSTRAINTS.md (durable
  persistence and never-throwing storage rules), and feature evidence.
- Next: run independent `$feature-validator` for `resume-saved-game`; after
  acceptance, commit `feat: complete resume-saved-game`, push the branch, and
  open the PR.
- Independent validator verdict: `accept`. Reran both gate modes, storage and
  resume suites, HTTP boundary probes, and an independent browser probe with
  hostile XSS payloads (persisted verbatim, rendered escaped, zero injected
  elements) plus byte-level payload checks (exact envelope shape, no rank
  fields); no security findings.

### 2026-10-12 — Latest-change undo implementation (undo-latest-score)

- Added `undoLastScoreChange({ game })` to `src/score.js` (no new module): it
  treats a missing, empty, or non-array `game.changes` (fresh `createGame`
  games have no `changes` property) as `{ game: null, undone: null, error:
  "nothing-to-undo" }`; otherwise it pops the newest `{ id, playerId, amount }`
  entry, finds the recipient (defensive `unknown-player`), computes
  `player.total - change.amount` under a safe-integer guard (`not-safe`), and
  returns a new game object with the restored total and
  `changes.slice(0, -1)`. The input game is never mutated; `game.status`,
  `player.order`, and all other fields are untouched; no rank is stored.
  `"nothing-to-undo"` joined `SCORE_ERROR_CODES`.
- Extended `src/main.js`: a `type="button"` `secondary-action` control labeled
  "Undo last score" (`data-action="undo-last-score"`) sits in the score-entry
  form directly after "Save points"; `handleUndo` announces
  "Undid {amount} points for {name}. New total: {total}. Rank: {rank}." on
  success (raw signed amount, rank from `rankPlayers(result.game)`), re-renders,
  and refocuses the undo button so repeated Enter/Space presses walk backward.
  An empty-log activation sets a new third feedback kind `info` with
  "Nothing to undo yet." and repaints `#score-feedback` only — no re-render and
  no focus change; other errors reuse the existing error repaint. Selection
  (`selectedPlayerId`) and row `aria-pressed` are never changed by undo.
- Styled `src/styles.css`: new `.info-message` in muted `var(--muted)` so the
  no-op does not read as a failure; the undo button reuses `.secondary-action`
  (min-height 44px) with no layout changes.
- Added `scripts/browser-undo-test.mjs` (CDP, following the rank-test pattern)
  and undo unit cases in `scripts/score-test.mjs`; wired `test:browser:undo`
  into `package.json`'s `test` chain and added the new script to `init.sh`
  syntax checks. No static-server/smoke/allowlist changes: `src/score.js` was
  already public.
- Verification: `node --check` on all sources and test scripts passed;
  `npm run test:score` passed (existing cases plus latest-only reversal,
  negative-amount undo, drain-then-nothing-to-undo, missing/empty/non-array
  logs, immutability snapshots, status/other-field preservation, and no rank
  writes); `npm run test` passed end to end with the new undo suite chained;
  `./init.sh` and `CI=true ./init.sh` passed and exited without starting a
  server; `npm run dev` probe returned 200 for `/`, `/src/score.js`, and
  `/src/main.js` and 404 for `/AGENTS.md`. Browser scenarios covered Scenarios
  1–6: latest-recipient-only restore with unchanged selection/`aria-pressed`
  and undo-button refocus, info no-op with sentinel-DOM proof of no re-render
  and muted (non-error) styling, negative-amount undo with the raw signed
  amount announced, three keyboard-Enter undos walking back then stopping
  safely, overtake order/rank reversion, and 320px checks (button visible
  below Save points, ≥44px target, visible focus, keyboard operable, no
  overflow). `localStorage.length === 0` and no console errors throughout.
  Screenshots: `/var/folders/24/yg25x7ld6mv2yb2xdznvmh680000gn/T/devexpert-undo-latest-score/desktop-undo-latest.png`
  and `mobile-undo-320px.png` (generated but not visually openable this
  session; readability asserted programmatically).
- Fixed during self-verification: the first browser run expected the negative
  scenario's totals in player order instead of DOM order (rows sort descending,
  so Sam 0 renders before Alex −3); corrected the assertion to DOM order.
- Updated README, ARCHITECTURE.md (undo boundary sentence revised),
  CONSTRAINTS.md (durable undo rule), and feature evidence.
- Next: run independent `$feature-validator` for `undo-latest-score`; after
  acceptance, commit and open the PR.
- Independent validator verdict: `accept`. Reran both gate modes, the score and
  browser-undo suites, HTTP boundary probes, and 10 extra edge-case probe
  groups (drain-to-empty, deep immutability, status/order preservation, rank
  interop); no security findings; evidence claims reproduced exactly.

### 2026-10-12 — Leaderboard ranking implementation (rank-leaderboard)

- Added `src/standings.js`: pure `rankPlayers(game)` returning `[{ player, rank }]`.
  It copies and decorates the players array with a `player.order` tiebreak
  (falling back to the original array index), sorts by total descending, and
  walks positions assigning `position + 1` while reusing the previous rank on
  equal totals — competition ranking (12, 12, 8 → 1, 1, 3). `rankPlayers(null)`
  and missing/empty player lists return `[]`; the input game is never mutated
  and no rank is stored anywhere.
- Extended `src/main.js`: `renderActiveGame` maps ranked rows instead of
  `game.players`; `renderActivePlayer` prepends a plain-text
  `.active-player-rank` numeral and labels totals `"{name}: rank {rank}, total
  {total}"`; roster panel copy is now "Leaderboard" / "Highest total leads;
  ties share rank."; successful saves append `Rank: {rank}` to the existing
  sentence ("Added {amount} points to {name}. New total: {total}. Rank: {rank}.")
  computed from `rankPlayers(result.game)`. Full re-render plus explicit
  `#score-amount` refocus is unchanged; errors still repaint without re-render.
- Styled `src/styles.css`: `.active-player` is now a five-column grid (rank,
  token, name, total, button) with `.active-player-rank` fixed-width,
  `tabular-nums`, bold, right-aligned like totals; ≤480px areas gained `rank`
  (`"rank token name total"` / `"select select select select"`); ≤360px keeps
  all five elements visible with 8px gaps and compacted numerals.
- Added `scripts/standings-test.mjs` and `scripts/browser-rank-test.mjs`; wired
  `test:standings` and `test:browser:rank` into `package.json` and the `test`
  chain; updated `scripts/browser-score-test.mjs` DOM-order totals to
  `["1005", "7"]` at the two ranked-order assertions (Sam 1005 now sorts before
  Alex 7); added `src/standings.js` to the `scripts/static-server.mjs`
  allowlist and `scripts/smoke.mjs` asset check; added the three new files to
  `init.sh` required-file and `node --check` lists.
- Verification: `node --check` on all sources and test scripts passed;
  `npm run test:standings` passed (including rank = 1 + strictly-higher count
  asserted per row on a 20-player mixed game and an applyScoreChange overtake);
  `npm run test` passed end to end; `./init.sh` and `CI=true ./init.sh` passed;
  `npm run dev` probe returned 200 for `/` and `/src/standings.js`, 404 for
  `/AGENTS.md`. Browser scenarios covered 12/12/8 → 1,1,3 with stable creation-
  order ties, 5/−3/−3 → 1,2,2, all-zero fresh game at rank 1, save-driven
  reorder with `aria-pressed` following the player and focus returning to
  `#score-amount`, error repaint without re-render (DOM sentinel survived),
  320px 20-player leaderboard with no overflow, ≥44px targets, visible focus,
  keyboard row activation, and a re-ranking save that kept focus; no
  localStorage writes and no console errors. Screenshots:
  `/var/folders/24/yg25x7ld6mv2yb2xdznvmh680000gn/T/devexpert-rank-leaderboard/desktop-rank-ties.png`,
  `desktop-rank-reorder.png`, and `mobile-20-player-leaderboard.png` (generated
  but not visually openable in this sandbox session; readability asserted
  programmatically instead).
- Fixed during self-verification: initial `rankPlayers` reused a rank field
  from the pre-decorated sort array and returned `undefined` for tied rows —
  caught by the unit test and rewritten to track previous rank/total while
  walking positions.
- Updated README, ARCHITECTURE.md, CONSTRAINTS.md (durable ranking rule), and
  feature evidence.
- Next: run independent `$feature-validator` for `rank-leaderboard`.
- Independent validator verdict: `accept`. Reran both gate modes, focused
  standings/browser-rank checks, HTTP boundary probes, and extra edge-case
  probes (triple tie, order fallbacks, immutability); confirmed render-time-only
  ranks with no stored fields; no security findings.
- Next: commit `feat: complete rank-leaderboard`, push the branch, and open the
  PR for user review.

### 2026-10-12 — Score entry implementation (add-player-score)

- Implemented `src/score.js`: `MAX_SCORE_ABS = 1_000_000`, `parseScoreAmount`
  with error codes `empty`/`not-a-number`/`not-integer`/`zero`/`out-of-range`
  (semantic parsing, so `1e3` saves as 1000), and `applyScoreChange` returning a
  new game with the player's updated total and an appended
  `{ id, playerId, amount }` change in `game.changes`, guarded by a
  `Number.isSafeInteger` invariant. Zero entries are rejected; totals may go
  negative; input game objects are never mutated.
- Extended the active view in `src/main.js`: per-row "Add points" buttons with
  `aria-pressed` and `aria-label="Add points for {name}"`, first player selected
  by default, a score-entry panel with labeled `type="number" step="1"`
  input (min/max ±1,000,000), helper text, `#score-feedback` `aria-live="polite"`
  region, and "Save points". Success announces "Added {amount} points to {name}.
  New total: {total}." and keeps focus in the cleared input; errors keep the
  typed value and focus. Live totals replace the hardcoded `0`.
- Styled `src/styles.css`: two-column active layout with the score panel beside
  the roster on desktop, single column at ≤720px, selected-row highlight, full
  width row buttons at ≤480px, ≥44px touch targets, and a `--success` token for
  success feedback.
- Added `scripts/score-test.mjs` and `scripts/browser-score-test.mjs`; extracted
  the shared CDP helpers into `scripts/browser-test-utils.mjs` and refactored
  `scripts/browser-roster-test.mjs` to import them with no behavior change.
- Wired `test:score` and `test:browser:score` into `package.json` and added the
  new modules to the `scripts/static-server.mjs` allowlist, smoke asset check,
  and `init.sh` syntax checks.
- Verification: `node --check` on all sources and test scripts passed;
  `npm run test:score`, `npm run test:roster`, and `npm run test:smoke` passed;
  `npm run test:browser` and `npm run test:browser:score` passed on headless
  Chrome; `npm run test`, `./init.sh`, and `CI=true ./init.sh` all passed;
  `npm run dev` probe returned 200 for `/` and `/src/score.js` and 404 for
  `/AGENTS.md`. Browser scenarios covered +10/−3 → 7 with others at 0, rejected
  2.5/abc/empty/±1000001/0 with unchanged totals, negative totals, 320px stacked
  panel with keyboard entry, no localStorage writes, no horizontal overflow, and
  no console errors. Screenshots:
  `/var/folders/24/yg25x7ld6mv2yb2xdznvmh680000gn/T/devexpert-add-player-score/desktop-score-entry.png`
  and `.../mobile-score-entry.png`.
- Updated README, ARCHITECTURE.md, CONSTRAINTS.md, and feature evidence.
- Next: run independent `$feature-validator` for `add-player-score`; after
  acceptance, commit, push `codex/add-player-score`, and open the PR.
- Independent validator verdict: `accept` with zero discrepancies. Reran
  `CI=true ./init.sh`, `./init.sh`, focused score and browser-score checks, live
  HTTP boundary probes (public 200, repository 404, malformed 400), and a spec
  code review; no security findings.
- Next: commit `feat: complete add-player-score`, push the branch, and open the
  PR for user review.

### 2026-10-02 — Roster verification and handoff repair

- Added home → setup → active-game flow, 2–20 named players, repeatable colors,
  numbered markers, distinct IDs, and zero totals. State remains in memory.
- Independent validator ran `CI=true ./init.sh` successfully with localhost permission:
  syntax checks, roster tests, HTTP smoke, and Chrome interaction checks passed.
- Browser coverage: desktop creation, 320px layout, 20-player cap, invalid names,
  duplicate names/colors, zero totals, no localStorage writes, and no console errors/overflow.
- Validator requested documentation repair only. Updated README, architecture,
  constraints, progress, and feature evidence to match the tested implementation.
- Final independent verdict: `accept` after documentation repair, reusing passing
  runtime/browser evidence because application code and tests were unchanged.
- Next: publish the roster PR and wait for user review. Plan `add-player-score` after merge when requested.

### 2026-10-01 — Minimal startup harness

- Created `AGENTS.md`, executable `init.sh`, `PROGRESS.md`, and `feature_list.json` from the merged discovery documents.
- Preserved one-feature-per-PR workflow, independent acceptance, and merged-dependency requirements.
- Feature slicing covers runnable shell, roster creation, score entry, ranking, undo, persistence/resume, storage errors, finishing, podium, and replay. Responsive behavior and accessibility belong in each relevant slice.
- Verification: JSON schema fields/statuses checked; dependency IDs and acyclic ordering checked; shell syntax and provisional script execution checked from the root and an external directory; executable mode and diff whitespace checked. No product tests ran.
- Next: review/merge the harness PR, then run `$feature-flow` for `bootstrap-web-shell`. Technical bootstrap must replace the provisional gate with real checks and document how to launch the app separately.

### 2026-10-01 — Bootstrap web shell implementation

- Created the first runnable static app shell: `index.html`, `src/styles.css`, and `src/main.js`.
- Added dependency-free Node tooling: `npm run dev` starts the local HTTP server, and `npm run test` runs a smoke check against the served shell.
- Replaced the provisional `init.sh` with the real non-blocking gate. It verifies required files, runs `node --check src/main.js`, runs `npm run test`, then prints the manual server command.
- Added `ARCHITECTURE.md` and `CONSTRAINTS.md` to capture the static app boundary, command split, and rules future feature slices must respect.
- Updated `README.md` and `AGENTS.md` with the current app commands and verification path.
- Browser evidence: `npm run dev` served `http://127.0.0.1:4173/`; real browser checks at 320x720 and 1280x800 found no horizontal overflow, no console errors, `appReady=true`, and a disabled New game control.
- Verification: `./init.sh` passed; `CI=true ./init.sh` passed. Both commands required localhost binding permission outside the restricted sandbox for the HTTP smoke server.
- Next: run independent `$feature-validator` for `bootstrap-web-shell`. If accepted, commit related files, push `codex/bootstrap-web-shell`, and open the PR.

### 2026-10-01 — Bootstrap web shell validation

- Initial verdict: `accept`, later superseded by independent revalidation.
- Revalidation found the local static server exposed repository files from the project root and crashed on malformed percent-encoded paths.
- Next: repair the server boundary and rerun implementation checks before another validator pass.

### 2026-10-01 — Bootstrap web shell repair

- Restricted `scripts/static-server.mjs` to explicit public shell files only: `/`, `/index.html`, `/src/styles.css`, and `/src/main.js`.
- Malformed URL paths now return `400 Bad request` instead of crashing the Node process.
- Added smoke-test regressions that verify `/AGENTS.md`, `/feature_list.json`, and `/.git/config` are not public, malformed `/%E0%A4%A` returns `400`, and a healthy GET still works afterward.
- Updated `ARCHITECTURE.md` and `CONSTRAINTS.md` to record the HTTP serving boundary.
- Verification: `npm test` passed; `./init.sh` passed; `CI=true ./init.sh` passed. Each smoke run served the shell over HTTP, blocked repository files, returned `400` for malformed URL encoding, and verified a healthy GET afterward.
- Next: send this back for independent revalidation.

### 2026-10-01 — Independent repair acceptance

- Validator verdict: `accept`. Both standard gates passed independently.
- Independent HTTP probes returned 200 for public app assets, 404 for repository files, 400 for malformed encoding, and 200 for a subsequent healthy request.
- The previous 320x720 and 1280x800 browser checks cover the unchanged UI. Browser automation was unavailable during this repaired pass.
- Next: review and merge the bootstrap PR, then plan `create-game-roster` on updated main when requested.
