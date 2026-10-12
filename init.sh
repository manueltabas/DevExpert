#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$repo_root"
printf 'Repository: %s\n' "$repo_root"

for required in AGENTS.md PROGRESS.md feature_list.json CONTEXT.md docs/build-brief.md docs/domain-model.md docs/risks-and-open-questions.md DESIGN.md index.html src/main.js src/roster.js src/score.js src/standings.js src/styles.css package.json scripts/smoke.mjs scripts/serve.mjs; do
  if [[ ! -s "$required" ]]; then
    printf 'Missing or empty required file: %s\n' "$required" >&2
    exit 1
  fi
done

printf '%s\n' 'Running baseline checks: node --check src/main.js'
node --check src/main.js

printf '%s\n' 'Running baseline checks: node --check src/roster.js'
node --check src/roster.js

printf '%s\n' 'Running baseline checks: node --check src/score.js'
node --check src/score.js

printf '%s\n' 'Running baseline checks: node --check src/standings.js'
node --check src/standings.js

printf '%s\n' 'Running baseline checks: node --check scripts/roster-test.mjs'
node --check scripts/roster-test.mjs

printf '%s\n' 'Running baseline checks: node --check scripts/standings-test.mjs'
node --check scripts/standings-test.mjs

printf '%s\n' 'Running baseline checks: node --check scripts/score-test.mjs'
node --check scripts/score-test.mjs

printf '%s\n' 'Running baseline checks: node --check scripts/browser-roster-test.mjs'
node --check scripts/browser-roster-test.mjs

printf '%s\n' 'Running baseline checks: node --check scripts/browser-rank-test.mjs'
node --check scripts/browser-rank-test.mjs

printf '%s\n' 'Running baseline checks: node --check scripts/browser-score-test.mjs'
node --check scripts/browser-score-test.mjs

printf '%s\n' 'Running baseline checks: node --check scripts/browser-undo-test.mjs'
node --check scripts/browser-undo-test.mjs

printf '%s\n' 'Running baseline checks: node --check scripts/browser-test-utils.mjs'
node --check scripts/browser-test-utils.mjs

printf '%s\n' 'Running baseline checks: npm run test'
npm run test

printf '%s\n' \
  'Baseline checks passed.' \
  'To serve the app locally, run: npm run dev' \
  'The verification gate does not start a long-running server.'
