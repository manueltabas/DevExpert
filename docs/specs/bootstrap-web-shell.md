# Feature Implementation Spec: Open the responsive app shell

## Source Feature

- `id`: `bootstrap-web-shell`
- `area`: `platform`
- `depends_on`: []
- `status`: `not_started` at planning time
- `source`: `feature_list.json`

## Goal

Create the first runnable product surface: a static, responsive board-game scorekeeper shell that loads from a local HTTP URL and establishes the accepted playful visual baseline. This shell is the foundation for later game creation, scoring, persistence, and finishing features.

Replace the provisional harness check with a real, non-blocking verification gate. `./init.sh` and `CI=true ./init.sh` must execute baseline checks, fail on errors, and exit without starting a long-running dev server. Document the separate command for running the local HTTP server.

## Non-Goals

- Do not implement game creation, player roster editing, scoring, leaderboard ranking, undo, persistence, finishing, podium celebration, or replay.
- Do not add accounts, a backend, database service, analytics, deployment, or hosting configuration.
- Do not choose future storage format or score validation rules beyond any placeholder structure needed for the static shell.
- Do not start a long-running server from `init.sh`.

## Job Story

When the repo owner begins product implementation,
I want a local URL that opens a responsive, visually aligned scorekeeper shell,
so later feature PRs can build on stable app structure, commands, and verification.

## Users And Permissions

- Scorekeeper: can view the shell on desktop or mobile-sized browsers. No authentication, saved data, or remote permissions exist in this slice.
- Developer: can run one command to verify baseline health and a separate command to serve the shell locally.

## Acceptance Scenarios

### Scenario 1: Local shell loads over HTTP

Given the repository has been bootstrapped by this feature
When a developer starts the documented local HTTP server command and opens the printed local URL
Then the app loads without console errors as a board-game scorekeeper shell with an obvious home view, new-game affordance, and saved-games placeholder copy or empty state.

### Scenario 2: Responsive layout has no horizontal overflow

Given the shell is served over HTTP
When it is checked at 320px-wide mobile and a desktop width
Then the page remains readable, touch targets stay usable, and no horizontal page scrolling is required.

### Scenario 3: Standard gate runs real checks and exits

Given the repository is in the bootstrapped state
When `./init.sh` or `CI=true ./init.sh` is run from the repo root
Then it executes the established baseline checks, reports the commands it ran, fails if any required check fails, and exits without leaving a dev server running.

### Scenario 4: No product behavior is implemented early

Given the shell is open
When the scorekeeper interacts with visible controls
Then controls may be disabled, placeholder, or route to static setup placeholders, but they must not create games, store data, calculate scores, or imply unsupported functionality already works.

## Repository Research

### Files Inspected

- `AGENTS.md` - repo workflow, product constraints, startup expectations, and one-feature-per-PR rules.
- `PROGRESS.md` - confirms discovery and harness are complete, bootstrap is next, and current checks are provisional.
- `feature_list.json` - source feature metadata, verification requirements, and later feature boundaries.
- `init.sh` - currently checks document presence only and prints pre-bootstrap guidance.
- `README.md` - PR workflow, harness provenance, and note that product commands will be defined after bootstrap.
- `CONTEXT.md` - glossary for game, player, scorekeeper, score change, leaderboard, finished game, and play again.
- `docs/build-brief.md` - agreed MVP, technical direction for simple HTML/CSS/JS modules, localStorage later, and no app backend.
- `docs/domain-model.md` - confirms no scoring or persistence behavior should be introduced in this slice.
- `docs/risks-and-open-questions.md` - bootstrap must choose test tooling and local server; other behavior choices remain later.
- `DESIGN.md` - accepted visual direction and responsive/accessibility baseline for UI work.
- `docs/specs/bootstrap-web-shell.md` - did not exist before this planner run.

### Existing Patterns To Follow

- Project uses a lightweight static direction: semantic HTML, responsive CSS, JavaScript modules, no framework required.
- `init.sh` is the standard verification entry point and should work both with and without `CI=true`.
- Product documentation is in English.
- Design should use the accepted warm tabletop look: ivory surfaces, charcoal text, colorful player markers, rounded cards, readable scores, visible focus, and no horizontal overflow at 320px.

### Current Gaps

- No application files exist yet.
- No package manifest, dependency manager, test runner, lint command, static server command, or E2E harness exists yet.
- `init.sh` does not run product checks.
- No persistent browser test command exists; bootstrap must introduce one or explicitly document the chosen lighter smoke strategy for this first shell.

## Technical Approach

Create a minimal static web app with clear file boundaries:

- An HTML entry point with semantic landmarks and a home shell for the scorekeeper.
- A CSS file containing responsive layout, design tokens, focus styles, and placeholder states aligned with `DESIGN.md`.
- A JavaScript module entry point that initializes only shell-level behavior needed for this slice, such as rendering current year/version text or guarding placeholder controls if desired. Avoid real game state.
- A lightweight local HTTP server command so the app is always tested via HTTP rather than `file://`.
- A smoke check that serves or reads the built static files and verifies the shell loads, required DOM landmarks exist, and mobile/desktop viewport overflow checks pass where supported by the selected tooling.

Prefer minimal tooling that keeps the repo simple. If using Node-based tooling, add `package.json` scripts for `dev`, `test` or `test:smoke`, and any required install command. If using only platform tools, document the exact commands and keep checks reproducible on the developer machine.

## Expected File Changes

- `index.html` - create; static app entry point served over HTTP.
- `src/main.js` or similar - create; JavaScript module entry point with shell-only initialization.
- `src/styles.css` or similar - create; responsive visual baseline and accessibility styles.
- `package.json` and lockfile, if Node tooling is chosen - create; scripts for serving and verification.
- `tests/` or `scripts/` smoke file, if needed - create; executable baseline check for the served shell.
- `init.sh` - update; run real non-blocking checks and print manual dev-server guidance after checks pass.
- `README.md` - update; document setup, local server URL command, standard verification command, and the first-slice scope.
- `ARCHITECTURE.md` - create; record static app structure and command boundaries established by bootstrap.
- `CONSTRAINTS.md` - create; record durable rules such as no backend/accounts, HTTP serving requirement, and `init.sh` behavior.
- `PROGRESS.md` and `feature_list.json` - update during implementation handoff only with actual verification evidence and status.

Paths are expected but can be adjusted if the implementer chooses an equally simple static structure and documents it.

## Visual Design Impact

- UI involved: yes.
- Design source: `DESIGN.md` and `docs/design/concepts/scorekeeper-desktop-mobile-v1.png`.
- Screens or states affected: initial home shell, empty saved-games area, static new-game affordance, responsive desktop/mobile layout.
- New design artifact required: no. The accepted concept image is enough for this slice.

The shell should make the product feel like a playful board-game scorekeeper from the first load. Use the accepted color tokens, warm surface treatment, compact cards or sections, and player-marker accents. Do not add fake interactive scoring rows that could be mistaken for working game behavior.

## Durable Documentation Impact

- `ARCHITECTURE.md`: create - this feature establishes runtime surface, source layout, local server command, verification command, and static-app boundaries.
- `CONSTRAINTS.md`: create - this feature turns product and workflow rules into durable implementation constraints for later agents.
- `AGENTS.md`: update only if the startup or verification instructions need changed wording after the real commands exist.
- `README.md`: update - document how to install dependencies if any, run the local server, run the standard gate, and understand the current shell-only scope.
- `PROGRESS.md`: update after implementation - record actual checks run, failures if any, and next feature.
- `feature_list.json`: update after implementation - record actual evidence and status according to feature workflow.

## Implementation Plan

1. Choose the smallest local server and smoke-check setup that can verify a static HTML/CSS/JS module app over HTTP.
2. Create the static app shell and visual baseline using semantic HTML, responsive CSS, and a small JavaScript module.
3. Add automated smoke checks that cover load success, core landmarks/content, and mobile/desktop overflow behavior where supported.
4. Replace the provisional `init.sh` body with real checks that exit cleanly and print the dev-server command.
5. Update durable docs to record commands, architecture, constraints, and verification evidence.

## Implementation Tasks

- [ ] Add the static app entry files and ensure they load via a local HTTP server.
- [ ] Apply the accepted tabletop visual tokens and responsive layout with no horizontal overflow at 320px.
- [ ] Provide placeholder home content for old games and starting a game without implementing those workflows.
- [ ] Add focused smoke verification for served page load and responsive baseline.
- [ ] Update `init.sh` so `./init.sh` and `CI=true ./init.sh` run the real checks and exit.
- [ ] Document `dev` and verification commands in `README.md`.
- [ ] Create `ARCHITECTURE.md` and `CONSTRAINTS.md` with the durable bootstrap decisions.
- [ ] Record actual verification evidence in `feature_list.json` and `PROGRESS.md` during implementation completion.

## Verification Plan

- Run the selected dependency installation command if tooling requires dependencies.
- Run `./init.sh`; expected result: all baseline checks pass and the script exits without a running server.
- Run `CI=true ./init.sh`; expected result: same real baseline checks pass in CI mode and the script exits.
- Start the documented local server command separately; expected result: a local HTTP URL serves the app.
- Open or test the served shell at 320px and desktop widths; expected result: no horizontal overflow, readable content, visible focus styles, and no console errors.
- If a browser automation tool is added, include the focused responsive smoke check in the standard gate. If a lighter tool is used instead, record the limitation and keep the manual viewport check explicit.

For `init.sh`:

- `./init.sh` must execute the non-blocking standard gate for the current repo state.
- `./init.sh` must not start long-running processes such as a dev server.
- It may print manual follow-up commands after the non-blocking checks pass.

## Evidence To Capture

- Exact output or summary for `./init.sh`.
- Exact output or summary for `CI=true ./init.sh`.
- The local server command and URL used for manual inspection.
- Mobile 320px and desktop responsive check results, including how overflow was checked.
- Any browser automation report, screenshot path, or console-error result if the selected tooling produces one.

## Validator Checklist

- [ ] Implementation stays within `bootstrap-web-shell` scope and does not implement roster, scoring, storage, or finished-game behavior.
- [ ] Shell loads through HTTP using the documented command.
- [ ] The responsive shell matches the accepted visual direction closely enough for later feature work.
- [ ] 320px and desktop checks pass without horizontal page overflow.
- [ ] `./init.sh` and `CI=true ./init.sh` run real checks, fail on errors, and exit without long-running processes.
- [ ] README documents setup, local server, and verification commands.
- [ ] `ARCHITECTURE.md` and `CONSTRAINTS.md` exist and capture durable bootstrap decisions without duplicating all product discovery.
- [ ] `feature_list.json` and `PROGRESS.md` contain actual implementation evidence before final acceptance.
- [ ] No unrelated product behavior or extra feature work was added.
