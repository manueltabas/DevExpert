# Feature Implementation Spec: Explain unavailable game storage

## Source Feature

- `id`: `handle-storage-failure`
- `area`: `reliability`
- `depends_on`: [`resume-saved-game`] (accepted and merged into `main`, PR #9, merge commit `02918a8` — verified: branch `codex/handle-storage-failure` is checked out with a clean tree at `3dc8722`, which equals `main` and `origin/main`)
- `status`: `not_started` at planning time
- `source`: `feature_list.json`

## Goal

Storage problems stop being silent. When a save fails (blocked or quota-limited storage), when the stored payload is unreadable or incompatible, or when individual saved entries are unusable, the scorekeeper says so in plain language at the moment and place it matters — in the active game and on the home screen — while play keeps working in memory. The app must never falsely present an unsaved change as saved, never overwrite or delete an unreadable stored payload, and never lose already-saved games because of a later failure.

## Non-Goals

- No cloud recovery, no export/import, no data-deletion feature, no "clear storage" or "delete corrupt data" button (feature notes; deletion stays out of scope per `docs/risks-and-open-questions.md`).
- No finished-game read-only behavior, no finish action, no podium, no replay — `finish-game`, `celebrate-podium`, and `play-again` own those.
- No changes to score parsing, ranking, roster rules, undo semantics, the storage format, or the save triggers (still exactly the three successful mutations).
- No cross-tab sync, `storage` events, offline/PWA support, analytics, or backend.
- No new recovery path for an in-memory game that was never saved (navigating home still abandons an unsaved active game — a pre-existing limitation, now at least disclosed by the notice).

## Job Story

When browser storage is blocked, full, or holds data my browser can't read,
I want the app to tell me exactly what still works and what didn't save,
so I can keep scoring without believing false "saved" feedback or silently losing games I already saved.

## Users And Permissions

- Scorekeeper: the only actor. All failures are local to the current browser profile; diagnostics stay local (code-only `console.warn`, never names/titles/scores). No accounts, no permissions.

## Product Decisions Resolved For This Slice

These resolve the feature notes ("Keep diagnostics local. No cloud recovery, export, or data-deletion feature; define the safe failure behavior in the spec."), the two documented simplifications inherited from `resume-saved-game`, and `docs/risks-and-open-questions.md` ("Detect unavailable storage and invalid saved data without silent loss"):

- **One feedback mechanism, two surfaces**: a single `role="status"` notice (`.storage-notice`, polite live region) rendered on home (top of the "Unfinished games" panel) and in the active game (top of the leaderboard column). It appears whenever storage health is degraded and disappears when a save succeeds again. No toasts, no modals, no dismiss button.
- **Copy per failure code** (exact strings, announced and visible):
  - `invalid` (stored payload unreadable/incompatible — write-suppression mode): "Saved game data couldn't be read, so saved games can't be shown and new changes won't be saved. Nothing was deleted. Reloading the page will try again."
  - `write` (setItem threw, e.g. quota): "Your latest change couldn't be saved. The game still works, and nothing already saved was lost — your next change will try again."
  - `unavailable` (storage missing/blocked, read or write): "Scores aren't being saved because browser storage is unavailable. The game still works, but changes will be lost when you leave this page."
  - `dropped` (home-only info note for skipped entries): "Some saved data couldn't be read and was skipped. Other saved games still work."
- **In-memory play always continues**: on any save failure the applied score/undo/new game stays live with unchanged success feedback ("Added 5 points … Rank: 1."); the notice carries the persistence warning. The game-feedback line never claims saving, so no false confirmation exists; the notice prevents false inference.
- **Write-safety rule (overwrite-on-read-failure simplification resolved)**: when the startup read returned `invalid` (unparseable, wrong version, or wrong-shape envelope — the payload may contain real games in a format this version can't parse), the app suppresses all writes for the session: `persistActiveGameSnapshot()` upserts nothing, calls no `saveGames`, sets the `invalid` notice, and logs the existing `console.warn("Game save failed:", code)` diagnostic. The stored payload is never rewritten, so it is preserved byte-for-byte. Suppression lifts only on reload (fresh read attempt). Writes after an `unavailable` read are attempted normally — nothing readable exists to destroy, and attempting yields truthful feedback.
- **Dropped entries are disclosed, not protected**: the envelope-level crash guard (per-entry drop) stays as accepted in `resume-saved-game`, but `loadSavedGames` now also returns `droppedCount` (entries skipped). Home shows the `dropped` note while `droppedCount > 0`. Saves still proceed and rewrite the envelope without the skipped fragments: skipped entries are provably not games (no string `id`/no `players` array), can never be resumed, and blocking all saves over them would let one hostile fragment hold real work hostage. The loss is disclosed by the note, not silent. Envelope-level `invalid` is different — there the payload may contain real games — hence suppression.
- **No false saved confirmation on home**: on a failed write, `persistActiveGameSnapshot()` rolls back the upsert (`state.savedGames` restored to the pre-upsert list), so home lists only games that are actually in storage. Research note: the existing blocked-storage scenario never asserted `cards.length === 0` after failed saves (its `emptyStatePresent` check is satisfied trivially by the finished-games placeholder), and today's code would render a phantom card — this slice fixes and then tests that.
- **Retry/acknowledge affordances — deliberately minimal** (per `DESIGN.md`): no retry button and no acknowledge button. Every subsequent game mutation automatically retries the save (three existing call sites), a successful save clears the notice, and reloading re-attempts the read. The copy names these paths ("your next change will try again", "Reloading the page will try again").
- **Startup notices**: a failed startup read (`unavailable`/`invalid`) sets the notice immediately, so home explains itself instead of silently rendering an empty list. Under `invalid` suppression the unfinished-panel empty state swaps its copy to "Saved games can't be shown right now." / "Nothing was deleted — the saved data just couldn't be read." so it doesn't contradict the notice.
- **Recovery semantics**: the first successful save clears `lastSaveError`; if the startup read had failed `unavailable` but a write then succeeds, the read error is also cleared (storage proved writable). An `invalid` read error is never cleared mid-session.

## Acceptance Scenarios

### Scenario 1: Blocked writes warn without false confirmation and lose nothing

Given a Chrome session where `Storage.prototype.setItem` throws
When the scorekeeper starts a game, saves +10 for a player, and returns home
Then in-memory totals and ranks keep working with the unchanged success feedback, the active view shows the `write` notice, home shows the notice with zero saved-game cards (no phantom card), no storage key exists, nothing already saved is lost, and console diagnostics remain code-only `console.warn` lines with no names, titles, or scores and no uncaught errors.

### Scenario 2: Corrupt saved payload is preserved and disclosed

Given storage seeded with an unparseable `scorekeeper:games` payload (e.g. `not-json{`)
When the app loads, the scorekeeper starts a game and saves points
Then home shows the `invalid` notice with the swapped empty-state copy and no cards, in-memory play keeps working in the active view with the notice present, the raw stored payload is byte-identical after every interaction (write suppression, never overwritten), a reload re-reads and still preserves it, and there are no console errors.

### Scenario 3: Incompatible saved payload behaves like corrupt data

Given storage seeded with a valid-JSON but incompatible envelope (e.g. `{ "version": 2, "games": [] }`)
When the app loads and the scorekeeper plays a game
Then the same `invalid` notice, empty-state swap, write suppression, and byte-identical payload preservation apply as in Scenario 2.

### Scenario 4: Writes recover when storage works again

Given a session where the first two `setItem` calls fail and later calls succeed (patched counter)
When the scorekeeper starts a game (save fails), saves a point (save fails), then saves another point (save succeeds)
Then the notice appears after each failure and disappears after the success, the storage key exists with the active game, home lists exactly that card with no notice, and the in-memory saved list matches storage (rollback never stranded a phantom).

### Scenario 5: Partially corrupted saved data is disclosed, readable games keep working

Given storage holding a valid envelope with one usable game and two unusable entries
When the app loads
Then home lists the usable game card plus the `dropped` info note, resume works normally, and after a successful save the payload contains exactly the usable games (the disclosed skip, `droppedCount` reported).

### Scenario 6: 320px layout and accessibility

Given any notice state (`invalid`, `write`, `unavailable`, `dropped`) at a 320px viewport
Then the notice stays visible with no horizontal page overflow, uses `role="status"` for polite announcement, requires no interaction (nothing to keyboard-activate, nothing traps focus), keeps the retention line and existing controls ≥44px and keyboard-operable, and readable text contrast is preserved.

## Repository Research

### Files Inspected

- `AGENTS.md`, `PROGRESS.md` — one-feature workflow; `resume-saved-game` accepted and merged (PR #9); `CI=true ./init.sh` gate last verified passing 2026-10-12 (planner did not rerun it).
- `feature_list.json` — source entry with its three verification items and the "keep diagnostics local / no cloud recovery, export, or deletion" notes.
- `CONTEXT.md`, `docs/build-brief.md`, `docs/domain-model.md` — "Surface failed saves and invalid stored data instead of silently presenting changes as saved"; diagnostics stay local; no silent loss when storage fails.
- `docs/risks-and-open-questions.md` — detect unavailable storage and invalid saved data without silent loss; deletion/export excluded.
- `DESIGN.md` — accessibility baseline (contrast, keyboard, visible focus) and minimal-controls guidance governing the notice design.
- `CONSTRAINTS.md` — storage helpers never throw; diagnostics log only error codes; "User-facing storage-failure UX … belong[s] to `handle-storage-failure`".
- `src/storage.js` — `loadSavedGames` returns `{ games, error }` (`unavailable`/`invalid`), drops unusable entries with code-only warnings, never rewrites the payload; `saveGames` returns `{ saved, error }` (`unavailable`/`write`); the result shapes are what this slice extends.
- `src/main.js` — `state.savedGames` from one startup `loadSavedGames()` (errors warn code-only, then render an empty list); `persistActiveGameSnapshot()` upserts **before** `saveGames`, so failed writes leave the game in `state.savedGames` (phantom-card risk); the three call sites (setup submit, `handleScoreSubmit`, `handleUndo`); `paintScoreFeedback()` replaceChildren pattern; `renderHome` empty state + retention note; full re-render + explicit refocus.
- `src/roster.js`, `src/score.js`, `src/standings.js` — untouched pure modules; game shape `{ id, title, status, createdAt, players, changes? }`.
- `src/styles.css` — tokens (`--muted`, `--border`, `--surface-strong`, error `#9f271e`), `.panel`, `.info-message`/`.validation-message`, 8px rhythm, ≤720px stacking, 44px targets, focus outline, reduced-motion block.
- `scripts/storage-test.mjs` — strict `assert.deepEqual` on whole `loadSavedGames` results (lines 66–73, 127) → adding a result field requires honest assertion updates; `createMemoryStorage`/`createThrowingStorage` stubs and the warning-capture helper are reusable.
- `scripts/browser-resume-test.mjs` — `Page.addScriptToEvaluateOnNewDocument` pattern for patching `setItem` (reusable for seeding payloads and counted failures); `readSavedGamesState(cdp, key)` returns the **raw** payload (byte-identical assertions); `readHomeState`/`readActiveState` helpers; its blocked-storage scenario asserts feedback, warnings, and empty home but never `cards.length === 0`.
- `scripts/browser-test-utils.mjs` — shared CDP helpers; seeding before app load is possible because injected scripts run before modules.
- `scripts/static-server.mjs`, `scripts/smoke.mjs` — no changes needed: no new `src` module, so the allowlist and asset checks already cover everything.
- `package.json`, `init.sh` — `test` chain and gate composition; new browser script must be registered in both.
- `index.html` — no changes (shell only).
- Git state: `codex/handle-storage-failure` clean at `3dc8722` (= `main` = `origin/main`); `docs/specs/` has no `handle-storage-failure.md` yet.

### Existing Patterns To Follow

- Never-throwing storage helpers with result codes; app-level policy decisions live in `src/main.js`.
- Feedback regions repainted via `replaceChildren` helpers (`paintScoreFeedback`) and included in render templates; `aria-live`/`role="status"` polite announcements; explicit refocus after actions.
- One focused CDP browser suite per feature with isolated Chrome profiles, no-console-error and no-horizontal-overflow assertions, 320px probes, screenshots into the OS temp evidence dir.
- Honest test updates: strengthen assertions to new reality, never weaken existing checks.

### Current Gaps

- Read failures render an empty list with only a console warning; a later successful save overwrites the unreadable payload (documented simplification now resolved by the write-safety rule).
- Failed writes leave the upserted game in `state.savedGames` → home renders a phantom saved-game card (false confirmation).
- No user-facing feedback exists for any storage failure; the `invalid` empty state would contradict reality ("No saved games yet.").
- Dropped entries are invisible to the user.

## Technical Approach

1. **`src/storage.js` — report skipped entries (no behavior change)**: `loadSavedGames` additionally returns `droppedCount` (number of entries rejected by `isUsableGameEntry`; `0` for clean reads and for `unavailable`/`invalid` results). `saveGames` and all other behavior stay exactly as accepted.
2. **`src/main.js` — storage-health state**: add `state.storageReadError` (`null | "unavailable" | "invalid"` from the startup load), `state.storageDroppedCount` (from the startup load), and `state.lastSaveError` (`null | "unavailable" | "write"`). Set the first two before the first `render()`.
3. **Notice derivation and rendering**: `getStorageNotice()` returns the first applicable of `invalid` (read error) → `lastSaveError` → `unavailable` (read error); otherwise null. `renderHome` and `renderActiveGame` embed the notice (`.storage-notice` with `role="status"` and the code's exact copy) when present; a `paintStorageNotice()` helper mirrors `paintScoreFeedback()` (replaceChildren + append) and is called after `render()` in the three mutation paths so the live region updates reliably. Home additionally renders the `dropped` info note when `storageDroppedCount > 0`. Under `invalid` suppression, swap the unfinished-panel empty-state copy to the strings in Product Decisions.
4. **Write-safety rule in `persistActiveGameSnapshot()`**: if `state.storageReadError === "invalid"` → log `console.warn("Game save failed:", "invalid")`, set the notice via state, and return without upserting or writing. Otherwise: capture `previous = state.savedGames`, upsert, call `saveGames`; on `result.error` restore `state.savedGames = previous`, set `state.lastSaveError = result.error`, keep the `console.warn("Game save failed:", result.error)` diagnostic; on success set `state.lastSaveError = null` and clear a prior `unavailable` read error.
5. **Styling in `src/styles.css`**: one `.storage-notice` warning style (rounded card, warm warning tint from existing tokens, bold lead, AA contrast, `overflow-wrap` safe) plus `.storage-notice-info` (muted, like `.info-message`) for the dropped note; no layout changes beyond stacking the block above the panel content; no overflow at 320px.
6. **Tests and wiring**: update the `deepEqual` result assertions in `scripts/storage-test.mjs` (add `droppedCount: 0`) and add dropped-count cases; strengthen the blocked-storage scenario in `scripts/browser-resume-test.mjs` (notice present, `cards.length === 0` after failed saves); add `scripts/browser-storage-failure-test.mjs` for Scenarios 1–6 using the seeding/patching patterns above and `readSavedGamesState(...).raw` for byte-identical checks; register the suite in `package.json` and `init.sh`.

This is one feedback/UI layer over the existing storage codes plus one app-level write-safety rule and a one-field reporting change — correctly sized for a single feature; no split needed.

## Expected File Changes

- `src/main.js` — modify; storage-health state, notice derivation/render/paint, startup notices, empty-state copy swap, suppression + rollback in `persistActiveGameSnapshot()`.
- `src/storage.js` — modify; `loadSavedGames` returns `droppedCount` only.
- `src/styles.css` — modify; `.storage-notice` (+ info variant) styles and 320px behavior.
- `scripts/storage-test.mjs` — modify; result-shape assertion updates (`droppedCount: 0`) + dropped-entry count cases + suppression-neutral storage behavior unchanged.
- `scripts/browser-resume-test.mjs` — modify; blocked-storage scenario asserts the notice, zero cards after failed saves, unchanged success feedback, and code-only warnings.
- `scripts/browser-storage-failure-test.mjs` — create; Scenarios 1–6 on headless Chrome (separate sessions: setItem-throws, corrupt payload, version-2 payload, counted-failure recovery, partial corruption; 320px/a11y checks).
- `package.json` — modify; add `test:browser:storage-failure` to the `test` chain.
- `init.sh` — modify; add `node --check scripts/browser-storage-failure-test.mjs`. Gate stays non-blocking and must not start a long-running server.
- `README.md` — update; storage-failure feedback sentence + new test command.
- `ARCHITECTURE.md` — update; storage boundary now includes user-facing failure feedback, the write-suppression rule, and rollback semantics.
- `CONSTRAINTS.md` — update; durable rules: never overwrite an unreadable stored payload (suppress writes while the startup read is `invalid`), roll back the in-memory saved list on failed writes so the UI never shows unsaved games as saved, notices announce politely and diagnostics stay code-only.
- `AGENTS.md` — not needed; workflow and commands unchanged.
- `index.html`, `src/roster.js`, `src/score.js`, `src/standings.js`, `scripts/static-server.mjs`, `scripts/smoke.mjs` — not needed; unchanged.
- `PROGRESS.md`, `feature_list.json` — updated with actual evidence during implementation/validation, not by this planner.

## Visual Design Impact

- UI involved: yes.
- Design source: `DESIGN.md` (accepted tokens, accessibility baseline) and existing `.panel`/feedback patterns; no new screens.
- Screens or states affected: home ("Unfinished games" panel notice + swapped empty state under suppression + dropped note) and active game (notice above the leaderboard). No motion, no new tokens required.
- New design artifact required: no — the notice reuses the accepted card language; exact tint is an implementation choice within the tokens, subject to the contrast check.

## Durable Documentation Impact

- `ARCHITECTURE.md`: update — the persistence boundary gains the failure-feedback layer and write-safety rule.
- `CONSTRAINTS.md`: update — three durable MUST rules listed under Expected File Changes.
- `AGENTS.md`: not needed — no workflow, command, or operating-rule changes.
- `README.md`: update — user-visible behavior and commands.
- Other docs: none — `docs/build-brief.md` already mandates surfacing failed saves; no source-of-truth change.

## Implementation Plan

1. Extend `scripts/storage-test.mjs` (result-shape updates + dropped-count cases) and add `droppedCount` to `src/storage.js`; keep every existing behavioral guarantee green.
2. Implement the main.js storage-health layer: state fields, startup notice, `getStorageNotice`, notice + dropped-note rendering, `paintStorageNotice`, empty-state swap, suppression + rollback in `persistActiveGameSnapshot()`.
3. Style `.storage-notice` in `src/styles.css`; verify contrast and 320px.
4. Strengthen the blocked-storage scenario in `scripts/browser-resume-test.mjs`; create `scripts/browser-storage-failure-test.mjs` for Scenarios 1–6; wire into `package.json` and `init.sh`.
5. Update `README.md`, `ARCHITECTURE.md`, `CONSTRAINTS.md`; run the full verification plan and record evidence.

## Implementation Tasks

- [ ] Add `droppedCount` to `loadSavedGames` (0 for error/clean reads; count of skipped entries otherwise) and update `scripts/storage-test.mjs` deepEqual assertions honestly plus new dropped-count cases; `npm run test:storage` green.
- [ ] Add `storageReadError`/`storageDroppedCount`/`lastSaveError` to `src/main.js` state; set from the startup load; derive and render the notice on home and in the active game with the exact per-code copy; add `paintStorageNotice()` and call it after `render()` in the three mutation paths.
- [ ] Implement the write-safety rule in `persistActiveGameSnapshot()`: suppress all storage writes and upserts while the startup read is `invalid` (log `Game save failed: invalid`), roll back the upsert on failed writes, clear `lastSaveError` (and an `unavailable` read error) on success.
- [ ] Swap the unfinished-panel empty-state copy while suppression is active; render the home `dropped` note when `storageDroppedCount > 0`.
- [ ] Style `.storage-notice`/`.storage-notice-info` in `src/styles.css` (AA contrast, 8px rhythm, no 320px overflow).
- [ ] Strengthen `scripts/browser-resume-test.mjs` blocked-storage assertions (notice present, `cards.length === 0` after failed saves, unchanged success feedback, code-only warnings, no key).
- [ ] Create `scripts/browser-storage-failure-test.mjs` covering Scenarios 1–6, including byte-identical raw payload checks, recovery, partial corruption, and 320px/`role="status"`/keyboard checks; wire `test:browser:storage-failure` into `package.json` and `node --check` into `init.sh`.
- [ ] Update `README.md`, `ARCHITECTURE.md`, `CONSTRAINTS.md`.

## Verification Plan

- `node --check src/storage.js src/main.js scripts/storage-test.mjs scripts/browser-resume-test.mjs scripts/browser-storage-failure-test.mjs` — expected: all pass.
- `npm run test:storage` — expected: updated result-shape assertions plus dropped-count cases green; every prior guarantee (payload untouched on invalid, never-throw, round-trip) still asserted.
- `npm run test:browser:resume` — expected: existing Scenarios 1–6 still pass; blocked-storage session additionally proves notice visibility and zero home cards after failed saves.
- `npm run test:browser:storage-failure` — expected: Scenarios 1–6 pass on headless Chrome, including raw-payload byte-identical preservation under suppression and no console errors.
- `npm run test` — expected: all unit suites, smoke, and all six browser suites pass.
- `./init.sh` and `CI=true ./init.sh` — expected: required-file checks, all `node --check` entries (including the new script), and the full `npm run test` chain pass; the gate exits without starting a long-running server and only prints the manual `npm run dev` follow-up.
- `npm run dev` + manual real-browser pass (1280×800 and 320×720): corrupt the key via DevTools, verify the home notice and preserved payload; use DevTools to overflow quota or block storage and verify the active-view notice and continued play; reload to confirm recovery paths.
- Feature-list verification mapping: "Simulate blocked/quota-failing writes; verify no false saved confirmation and no silent loss of prior data" → Scenarios 1/4; "Load malformed or incompatible saved data; verify an understandable error and preservation of the original payload" → Scenarios 2/3/5; `CI=true ./init.sh` → gate runs above.
- E2E note: no persistent E2E harness exists in this repo; the focused CDP browser suite is the established browser-flow coverage and is included. Unit + browser coverage is sufficient because the feature is local UI/storage behavior with no routing, auth, or API surface.
- Responsive and accessibility verification: Scenario 6 plus the manual 320px pass; `role="status"` live-region presence and polite announcement asserted in tests; no interactive elements introduced, so no new keyboard traps; contrast checked in the manual pass.

## Evidence To Capture

- Exact commands and results for `npm run test:storage`, `npm run test:browser:resume`, `npm run test:browser:storage-failure`, `npm run test`, `./init.sh`, and `CI=true ./init.sh`.
- Browser proof points: byte-identical raw payloads before/after suppressed saves (Scenario 2/3), `cards.length === 0` after failed saves (Scenario 1), notice disappearance after recovery (Scenario 4), `droppedCount` reporting (Scenario 5).
- Confirmation that console diagnostics remain code-only (no names, titles, or scores) and that no console errors appear in any failure session.
- Screenshot paths from the new suite (desktop + 320px), noting if they could not be opened for visual inspection.
- Update `feature_list.json` evidence and the `PROGRESS.md` session log with these results (implementer/validator step).

## Validator Checklist

- [ ] Implementation stays within `handle-storage-failure` scope: feedback layer + write-safety rule + dropped-entry disclosure only.
- [ ] No cloud recovery, export, deletion, finished-game behavior, replay, or changes to save triggers/storage format/score/undo/ranking semantics.
- [ ] Failed writes: in-memory play continues with unchanged success feedback, the correct notice appears on the active view and home, home shows no phantom card, and nothing already saved is lost.
- [ ] Invalid/incompatible stored payloads: understandable notice, empty-state copy swapped, all writes suppressed for the session, payload preserved byte-for-byte, reload re-attempts safely.
- [ ] Skipped entries are disclosed on home (`droppedCount`) while readable games keep working; the write-proceeds choice is implemented as specified.
- [ ] Notices use `role="status"`, exact spec copy, no dismiss/retry buttons, and clear automatically on a successful save.
- [ ] Diagnostics remain code-only `console.warn` (no names, titles, or scores); no uncaught console errors in failure sessions.
- [ ] `scripts/storage-test.mjs` assertions were updated honestly (not weakened) and `droppedCount` is covered; the resume suite's blocked-storage scenario is strengthened, not relaxed.
- [ ] 320px: notices visible, no horizontal overflow, ≥44px targets preserved, keyboard operability unchanged.
- [ ] `npm run test`, `./init.sh`, and `CI=true ./init.sh` pass with the new checks; `init.sh` did not start a server.
- [ ] `ARCHITECTURE.md`, `CONSTRAINTS.md`, `README.md` updated; `feature_list.json` evidence and `PROGRESS.md` record real checks.
- [ ] No unrelated product behavior or extra feature work was added.
