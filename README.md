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

## Next steps

The app has not been defined or bootstrapped yet. Begin with `$build-brief`, then use `$harness-starter` to derive project instructions, a verification script, progress notes, and a feature list. Run `$feature-flow` for one feature at a time afterward.

For training, the first feature can be run one role at a time to inspect each artifact before continuing. Product test commands will be documented after technical bootstrap.
