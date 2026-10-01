# Progress

## Current verified state

- Phase: product bootstrap independently accepted after repair; PR review pending.
- Repository root: directory containing this file (`/Users/mtabas/Documents/DevExpert` in the current checkout).
- Standard startup/readiness path: `./init.sh`.
- Standard verification path: `CI=true ./init.sh`, which runs `node --check src/main.js` and `npm run test`.
- Local app command: `npm run dev`, serving `http://127.0.0.1:4173/` by default.
- Next ready feature after revalidation, PR, and merge: `create-game-roster`.
- Features: `bootstrap-web-shell` is `accepted`; remaining slices are `not_started`.
- Blockers: none for the feature. Localhost-binding commands need permission outside the restricted sandbox in this environment.
- Last verification: 2026-10-01.

## Session log

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
