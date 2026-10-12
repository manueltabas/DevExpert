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
- `npm run test`: run roster, standings, and score unit checks, HTTP smoke checks, and desktop/mobile browser tests for the roster, scoring, and leaderboard flows.
- `npm run test:browser`: run only the Chrome roster interaction checks.
- `npm run test:browser:score`: run only the Chrome scoring interaction checks.
- `npm run test:browser:rank`: run only the Chrome leaderboard ranking interaction checks.
- `npm run test:standings`: run only the ranking unit checks.
- `./init.sh`: run the standard repository gate without starting a long-running
  server.
- `CI=true ./init.sh`: run the same gate in CI-style mode.

Choose **New game**, enter a title and 2–20 player names, select colors, then
choose **Start game**. The leaderboard shows rows in descending total order:
the highest total leads, equal totals share a competition rank (12, 12, 8 →
ranks 1, 1, 3), and tied players keep their creation order. Pick a player with
its row's **Add points** button, type a signed whole-number amount
(−1,000,000 to 1,000,000), and choose **Save points** to see the leaderboard
re-rank immediately; the confirmation names the player's new rank. Zero,
decimals, and out-of-range amounts are rejected with a clear message. Names and
colors can repeat; numbered markers distinguish players. Ranks are derived at
render time only — the game and its change log stay in memory and disappear on
reload. Saved history arrives in a later PR.

## Next steps

Run `$feature-flow` one feature at a time. After `rank-leaderboard` is
accepted and merged, the next feature is `undo-latest-score`.
