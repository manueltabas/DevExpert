# DevExpert

Training project for building an app with a coding harness.

## Harness source

Copied from [devexpert-io/ai-expert](https://github.com/devexpert-io/ai-expert/tree/main/harness), commit `6f0f412242bb78dddd2787ded40043d099a01226`.

- `.agents/skills/`: discovery, repository preparation, feature planning, implementation, validation, and coordination.
- `.codex/`: Codex planner, implementer, and validator configurations.
- `.opencode/`: corresponding OpenCode agent configurations.

The local `feature-flow` skill is adapted for one feature per pull request.

## Pull request workflow

1. Start each change from current `origin/main` on a `codex/<feature-id>` branch.
2. Keep one feature per PR, including its spec, implementation, tests, and verification evidence.
3. Use the planner, implementer, and independent validator sequentially for each feature.
4. After acceptance, commit and push the feature branch and open a PR against `main`. This is authorized as part of the project workflow.
5. Leave the PR open for human review and merge. Do not merge automatically or push changes directly to `main`.
6. Start dependent work after its prerequisite PRs are merged. Reuse the same PR for repairs; do not stack PRs unless requested.

`passing` means implementation checks passed. `accepted` means independent validation passed; merge state is tracked separately by GitHub.

## App commands

The product is a static HTML/CSS/JavaScript app. No dependency installation is
required for the current bootstrap beyond having Node and npm available.

- `npm run dev`: serve the app locally at `http://127.0.0.1:4173/`.
- `npm run test`: run the baseline smoke check.
- `./init.sh`: run the standard repository gate without starting a long-running
  server.
- `CI=true ./init.sh`: run the same gate in CI-style mode.

The current product slice is a responsive home shell only. Game creation,
scoring, history, finishing, podium, and replay are intentionally left for later
feature PRs.

## Next steps

Run `$feature-flow` one feature at a time. After `bootstrap-web-shell` is
accepted and merged, the next feature is `create-game-roster`.
