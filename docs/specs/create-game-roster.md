# Feature Implementation Spec: Start a game with named players

## Source Feature

- `id`: `create-game-roster`
- `area`: `games`
- `depends_on`: [`bootstrap-web-shell`]
- `status`: `not_started` at planning time
- `source`: `feature_list.json`

## Goal

Let the scorekeeper start a new in-memory game from the home shell by entering player names and selecting player colors. The resulting active game must contain 2 to 20 distinct player records, each with a stable game-scoped identity, visible name, marker/color presentation, and total score of zero.

This slice should make the app feel like it has a real setup flow, but it must stop before scoring, persistence, resume/history, undo, finishing, or replay. Reloading may lose the active game until the persistence feature arrives.

## Non-Goals

- Do not add score entry, score changes, leaderboard sorting beyond initial zero totals, undo, finish, podium, play again, or localStorage persistence.
- Do not implement saved-games history or resume behavior.
- Do not add accounts, backend services, analytics, deployment, or framework migration.
- Do not require entering points for a round or any scoring data during setup.

## Job Story

When a group is ready to begin a board game,
I want to enter the players at the table and start an active game,
so everyone has a clear zero-score roster before scoring begins.

## Users And Permissions

- Scorekeeper: can create one active in-memory game on the current device/browser tab. No sign-in, sharing, or remote permission exists.
- Other players: represented only by the scorekeeper-entered display names, colors, and markers. They do not operate the app in this slice.

## Product Decisions Resolved For This Slice

- Minimum roster: 2 players. One-player games are not useful for the agreed group scorekeeper workflow; this also gives clear validation copy.
- Maximum roster: 20 players, matching the agreed project constraint.
- Initial setup rows: start with 2 blank player rows, then let the scorekeeper add up to 20.
- Player names: trim leading/trailing whitespace; reject blank names after trim; cap display names at 40 characters to keep rows readable on mobile.
- Duplicate names: allow them. Player identity must use internal IDs because names and colors may repeat.
- Colors: use only the seven agreed marker colors: blue, red, yellow, green, orange, white, black. Default new rows should cycle through these colors.
- Markers: include a small visual marker or token per player and do not rely on color alone. A simple marker label, shape, or row number is enough for this slice.
- Game title: provide a generated editable title, such as `Game night`, prefilled during setup. Starting a game should keep the trimmed title; if the title is blank, fall back to the generated title. Full saved-game labeling can evolve during persistence.

## Acceptance Scenarios

### Scenario 1: Start a valid game

Given the home shell is loaded over HTTP
When the scorekeeper chooses New game, enters `Alex` and `Sam`, and starts the game
Then the app shows an active in-memory game with both players, visible markers/colors, and total `0` for each player.

### Scenario 2: Create 20 players with repeated colors

Given the setup screen is open
When the scorekeeper adds player rows until there are 20 players, fills every name, and starts the game
Then the game starts with 20 distinct player IDs, repeated colors are allowed, all names remain visible, and every total is zero.

### Scenario 3: Reject a 21st player

Given setup already has 20 player rows
When the scorekeeper tries to add another player
Then no 21st row is added, the Add player control is disabled or shows an accessible limit message, and existing entered names/colors are preserved.

### Scenario 4: Reject invalid names

Given setup has at least two player rows
When a required player name is blank or whitespace-only
Then Start game is disabled or blocked with a visible validation message, focus remains in setup, and no active game is created.

### Scenario 5: Keyboard and narrow-screen setup work

Given the app is served at a 320px-wide viewport
When the scorekeeper tabs through setup, edits names, changes a color, removes an extra player row, and starts a valid game
Then every control is reachable and labeled, focus indicators are visible, touch targets remain usable, and there is no horizontal page overflow.

## Repository Research

### Files Inspected

- `AGENTS.md` - feature workflow, standard gate, and scope rules.
- `PROGRESS.md` - confirms `bootstrap-web-shell` is accepted and localhost binding needs permission in this sandbox.
- `feature_list.json` - source feature metadata and verification requirements.
- `docs/specs/bootstrap-web-shell.md` - previous feature contract and intended app foundation.
- `README.md` - current commands and shell-only scope.
- `ARCHITECTURE.md` - static app layout, command split, and HTTP server boundary.
- `CONSTRAINTS.md` - no backend/accounts, explicit public files only, `init.sh` non-blocking.
- `CONTEXT.md` - glossary for game, player, scorekeeper, and totals.
- `docs/build-brief.md` - agreed MVP and validation expectations.
- `docs/domain-model.md` - player/game identity requirements and zero initial totals.
- `docs/risks-and-open-questions.md` - roster minimum, title, and player-name choices to resolve here.
- `DESIGN.md` - accepted setup-screen and marker guidance.
- `index.html` - current static home shell with disabled New game.
- `src/main.js` - currently only sets footer year and `appReady`.
- `src/styles.css` - current design tokens, responsive shell layout, focus styles, and reduced-motion defaults.
- `scripts/smoke.mjs` - current HTTP smoke check; asserts New game is disabled and future behavior is absent.
- `scripts/static-server.mjs` - explicit public file allowlist.
- `scripts/serve.mjs` - local dev server.
- `init.sh` and `package.json` - current verification commands.
- `docs/specs/create-game-roster.md` - did not exist before this planner run.

### Existing Patterns To Follow

- Keep the app static with HTML, CSS, and JavaScript modules.
- Keep tooling dependency-free unless a focused need justifies a small dev dependency.
- `npm run test` is the focused smoke gate called by `./init.sh`.
- `./init.sh` must remain non-blocking and must not start `npm run dev`.
- UI should keep the warm tabletop visual direction, visible focus, and 320px no-overflow behavior.
- The static server only serves explicit public app files. Any new public app asset must be added intentionally to `scripts/static-server.mjs`.

### Current Gaps

- No roster data model or setup state exists.
- The New game button is disabled and the home shell says game creation will arrive later.
- The smoke check currently expects the New game control to be inert, so tests must be updated for this feature.
- There is no persistent browser automation command. Real interaction verification must be added if practical, or captured as a manual browser check alongside expanded Node smoke/unit checks.

## Technical Approach

Refactor the shell into a small state-driven browser app without introducing a framework. Keep state in memory inside JavaScript modules:

- `home` view: shows New game and existing empty history placeholders. New game opens setup.
- `setup` view: editable game title, player rows, add/remove player controls, name inputs, color selectors or buttons, marker previews, validation messages, and roster count.
- `active` view: displays the created game title and all players with totals fixed at zero. Scoring controls should be absent or clearly unavailable until the scoring feature.

Represent an active game as a plain object with at least `id`, `title`, `status: "active"`, `players`, and `createdAt`. Each player should have a game-scoped `id`, `name`, `color`, `marker`, `total: 0`, and an insertion/order field if helpful. Use deterministic ID generation in tests or expose pure functions so validation can verify distinct identities without relying on random output.

Prefer splitting pure roster helpers into a module such as `src/game.js` or `src/roster.js` so Node tests can cover validation, color cycling, limits, duplicate names, and zero totals without a browser DOM. `src/main.js` can import those helpers and manage DOM rendering/events.

Keep all data in memory for this slice. Do not read or write `localStorage`.

## Expected File Changes

- `index.html` - modify; replace shell-only messaging/disabled New game with mount points or markup needed for home/setup/active views.
- `src/main.js` - modify; add view state, event handling, rendering, validation wiring, and active game creation.
- `src/game.js` or `src/roster.js` - create; pure roster constants and helpers for validation, color cycling, and game/player creation.
- `src/styles.css` - modify; setup form, player rows, color controls, validation, active-game roster, mobile layout, and focus states.
- `scripts/smoke.mjs` - update; assert current HTTP assets and app markup reflect real game creation instead of inert controls.
- Optional `scripts/roster-test.mjs` or similar - create if pure helper coverage is clearer outside the HTTP smoke check.
- `package.json` - update scripts only if adding a separate focused test command.
- `scripts/static-server.mjs` - update only if new public app files are added outside the current allowlist.
- `README.md` - update only if commands or visible current-slice scope need adjustment.
- `ARCHITECTURE.md` - update if source modules or in-memory state boundaries are established.
- `CONSTRAINTS.md` - update only if durable roster rules need to be carried forward.
- `PROGRESS.md` and `feature_list.json` - update after implementation with actual evidence.

## Visual Design Impact

- UI involved: yes.
- Design source: `DESIGN.md` and `docs/design/concepts/scorekeeper-desktop-mobile-v1.png`.
- Screens or states affected: home New game action, new-game setup, active zero-score roster.
- New design artifact required: no.

The setup screen should use compact, touch-friendly player rows with visible names, marker previews, color choices, and a clear count up to 20. White and yellow markers need dark outlines. Do not rely on color alone: include marker labels, row numbers, shapes, or accessible names. At 20 players, the list may scroll vertically, but the page must not scroll horizontally at 320px.

## Durable Documentation Impact

- `ARCHITECTURE.md`: update - describe the new in-memory app state, roster helper module, and home/setup/active view boundary if implemented.
- `CONSTRAINTS.md`: update - add durable roster rules: 2-20 players, seven allowed colors, duplicate names/colors allowed, player IDs independent of names/colors, no persistence until the persistence slice.
- `AGENTS.md`: not needed - workflow and standard commands do not change unless implementation changes them.
- `README.md`: update only if command list or current product-slice description changes.
- Other docs: not needed unless implementation intentionally changes a resolved product decision.

## Implementation Plan

1. Add pure roster constants and helper functions for default rows, validation, color cycling, and creating an in-memory active game.
2. Replace the disabled New game shell with a simple routed/rendered flow for home, setup, and active game views.
3. Style setup and active roster states using existing tokens and responsive patterns.
4. Update smoke/unit tests for roster rules and HTTP shell expectations.
5. Run standard gates and perform real browser interaction checks on mobile and desktop widths.
6. Update durable docs and feature evidence with the exact checks run.

## Implementation Tasks

- [ ] Define allowed colors and marker metadata in a reusable JavaScript module.
- [ ] Implement roster validation for minimum 2, maximum 20, trimmed nonblank names, 40-character limit, and allowed colors.
- [ ] Implement active game creation with stable internal player IDs and zero totals.
- [ ] Build home -> setup -> active game interaction without persistence.
- [ ] Add add-player, remove-player, name editing, color selection, and title editing controls.
- [ ] Keep duplicate names/colors valid while preserving distinct player identities.
- [ ] Update CSS for setup rows, active roster, validation messages, and narrow-screen behavior.
- [ ] Update tests/smoke checks so `npm run test`, `./init.sh`, and `CI=true ./init.sh` cover the new roster behavior.
- [ ] Perform and record real interaction checks in a served browser at 320px and desktop widths.
- [ ] Update `ARCHITECTURE.md`, `CONSTRAINTS.md`, `PROGRESS.md`, and `feature_list.json` with actual decisions and evidence.

## Verification Plan

- Run `node --check src/main.js` and any new JavaScript modules; expected result: syntax passes.
- Run `npm run test`; expected result: roster helpers and HTTP smoke checks pass.
- Run `./init.sh`; expected result: standard gate passes and exits without a long-running server.
- Run `CI=true ./init.sh`; expected result: same standard gate passes.
- Start `npm run dev`; expected result: app is served at the documented local HTTP URL.
- Real interaction check at desktop width:
  - Click New game.
  - Enter a title and at least two names.
  - Start the game.
  - Verify the active game shows distinct players, their selected colors/markers, and total `0` for each.
- Real interaction check at 320px width:
  - Add rows up to 20.
  - Verify repeated colors are allowed, the 21st row cannot be added, all controls remain keyboard reachable, labels are present, focus is visible, and there is no horizontal overflow.
- Invalid-input check:
  - Attempt to start with a blank/whitespace name and with fewer than 2 valid players.
  - Verify visible validation and no active game is created.
- Confirm no persistence:
  - Reload after creating an active game.
  - Verify there is no claim that the game was saved, and no localStorage write is required for this slice.

Because the repository does not yet have a persistent browser automation command, implementation should either add a focused interaction test using minimal tooling or record a real served-browser manual/automation check. Static HTML-only assertions are not enough evidence for this UI feature.

For `init.sh`:

- `./init.sh` must continue to run the non-blocking standard gate.
- `./init.sh` must not start `npm run dev` or any other long-running server.
- It may print manual follow-up commands after checks pass.

## Evidence To Capture

- Exact output or summary for `npm run test`.
- Exact output or summary for `./init.sh`.
- Exact output or summary for `CI=true ./init.sh`.
- Local HTTP URL used for real interaction checks.
- Desktop interaction result for starting a valid game.
- 320px interaction result for 20 players, repeated colors, no 21st player, keyboard/focus, and no horizontal overflow.
- Invalid-name validation result.
- Confirmation that no localStorage persistence was introduced.

## Validator Checklist

- [ ] Implementation stays within `create-game-roster` scope and does not add scoring, storage, undo, finish, podium, or replay behavior.
- [ ] Home New game opens setup and a valid setup creates an in-memory active game.
- [ ] Active game contains 2-20 players with distinct internal identities and zero totals.
- [ ] Duplicate names and repeated colors are allowed; blank/whitespace names are rejected.
- [ ] The 21st player cannot be added and existing entered data is preserved.
- [ ] Setup and active roster work at 320px and desktop widths without horizontal overflow.
- [ ] Controls are keyboard reachable, labeled, and have visible focus.
- [ ] `npm run test`, `./init.sh`, and `CI=true ./init.sh` pass with real focused checks.
- [ ] Real served-browser interaction evidence is present.
- [ ] Durable docs and feature evidence are updated accurately.
