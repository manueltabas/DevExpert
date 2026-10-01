#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$repo_root"
printf 'Repository: %s\n' "$repo_root"
for required in AGENTS.md PROGRESS.md feature_list.json CONTEXT.md docs/build-brief.md docs/domain-model.md docs/risks-and-open-questions.md DESIGN.md; do
  if [[ ! -s "$required" ]]; then
    printf 'Missing or empty harness input: %s\n' "$required" >&2
    exit 1
  fi
done
printf '%s\n' \
  'Harness status: pre-bootstrap' \
  'Required harness inputs are present. Success is intentional for this phase only.' \
  'The application is not initialized; no product tests were run.' \
  'Next feature: bootstrap-web-shell (planner).' \
  'Bootstrap must document the local HTTP server and test commands and replace this provisional gate with real checks.'
