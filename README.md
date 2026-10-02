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
required. Use Node 22 or newer and npm. The browser test also requires Google
Chrome (the default path is the standard macOS installation); set `CHROME_BIN`
to the browser executable when installed elsewhere.

- `npm run dev`: serve the app locally at `http://127.0.0.1:4173/`.
- `npm run test`: run roster unit checks, HTTP smoke checks, and desktop/mobile browser tests.
- `npm run test:browser`: run only the Chrome roster interaction checks.
- `./init.sh`: run the standard repository gate without starting a long-running
  server.
- `CI=true ./init.sh`: run the same gate in CI-style mode.

Choose **New game**, enter a title and 2–20 player names, select colors, then
choose **Start game**. The active roster shows every player at zero. Names and
colors can repeat; numbered markers distinguish players. The game is held in
memory and disappears on reload. Scoring and saved history arrive in later PRs.

## Next steps

Run `$feature-flow` one feature at a time. After `create-game-roster` is
accepted and merged, the next feature is `add-player-score`.
