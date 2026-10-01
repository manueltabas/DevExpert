# Project agent instructions

Build a responsive board-game scorekeeper for one scorekeeper, up to 20 players, signed integer scores, and browser-local history. Use HTML, CSS, and JavaScript modules; no accounts or application backend.

## Read first

- `PROGRESS.md`: verified state and next step.
- `feature_list.json`: feature scope, dependencies, status, and evidence.
- `CONTEXT.md`, `docs/build-brief.md`, `docs/domain-model.md`: terminology and agreed behavior.
- `docs/risks-and-open-questions.md`: implementation-time choices and exclusions.
- `DESIGN.md`: accepted visual direction; read for UI work.
- `README.md`: PR workflow and upstream harness provenance.

## Start and verify

Confirm the repository with `pwd`, inspect `git status`, then run `./init.sh` (or `CI=true ./init.sh`). The gate runs the real baseline checks and exits without starting a long-running server. Use `npm run dev` separately when you need the local HTTP app.

## Feature workflow

- Work on one feature at a time. Resume active work first; otherwise select the first unfinished dependency-ready feature in list order.
- Dependencies must be independently accepted and their PRs merged into `main`. An unmerged acceptance is not readiness for dependent work.
- Start from current `origin/main` on `codex/<feature-id>`. Reuse the branch/PR when repairing the same feature and preserve unrelated changes.
- Use `$feature-flow` for sequential planner → implementer → validator work. Specs live in `docs/specs/<feature-id>.md`. Do not broaden a feature or implement before its spec exists.
- `not_started`, `in_progress`, `blocked`, `passing`, and `accepted` are the feature statuses. At most one feature is `in_progress`. `passing` requires actual self-verification evidence; only independent validator acceptance permits the orchestrator to persist `accepted`.
- Every feature runs the standard gate plus its focused checks. Include responsive and accessibility verification for changed UI. Do not silently weaken checks or report unavailable checks as passed.
- After acceptance, update feature evidence and `PROGRESS.md`, commit only related files, push the feature branch, and open/update its PR against `main`. This publication is authorized. Leave merging to the user; stop at the PR handoff.

## Scope and handoff

Keep scores whole-number, rank highest first with shared places, and keep finished games read-only. Preserve local data when replaying. Resolve documented implementation-time choices within the selected spec without treating assumptions as confirmed user requirements.

Record what changed, checks actually run, failures, and next action in durable files. Report the PR link and real local testing steps. English is the project document language.
