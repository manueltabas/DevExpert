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
- `npm run test`: run roster, standings, score, game, and storage unit checks, HTTP smoke checks, and desktop/mobile browser tests for the roster, scoring, leaderboard, undo, save/resume, storage-failure, finish-game, podium, and replay flows.
- `npm run test:browser`: run only the Chrome roster interaction checks.
- `npm run test:browser:score`: run only the Chrome scoring interaction checks.
- `npm run test:browser:rank`: run only the Chrome leaderboard ranking interaction checks.
- `npm run test:browser:undo`: run only the Chrome undo interaction checks.
- `npm run test:browser:resume`: run only the Chrome save/resume interaction checks.
- `npm run test:browser:storage-failure`: run only the Chrome storage-failure feedback checks.
- `npm run test:browser:finish-game`: run only the Chrome finish/read-only standings checks.
- `npm run test:browser:podium`: run only the Chrome podium celebration checks.
- `npm run test:browser:play-again`: run only the Chrome replay interaction checks.
- `npm run test:standings`: run only the ranking unit checks.
- `npm run test:game`: run only the game-lifecycle (finishGame/replayGame) unit checks.
- `npm run test:storage`: run only the storage unit checks.
- `./init.sh`: run the standard repository gate without starting a long-running
  server.
- `CI=true ./init.sh`: run the same gate in CI-style mode.

Choose **New game**, enter a title and 2–20 player names, select colors, then
choose **Start game**. The leaderboard shows rows in descending total order:
the highest total leads, equal totals share a competition rank (12, 12, 8 →
ranks 1, 1, 3), and tied players keep their creation order. Pick a player with
its row's **Add points** button, type a signed whole-number amount
(−1,000,000 to 1,000,000), and choose **Save points** to see the leaderboard
re-rank immediately; the confirmation names the player's new rank. The score
field accepts plain signed integers only — letter characters such as `e`
(scientific notation) are rejected as you type and can never be saved. Zero,
decimals, out-of-range amounts, and non-plain forms like `1e3` are rejected
with a clear message. Choose
**Undo last score** to reverse the most recent change: the affected player's
total is restored, ranks correct themselves, and repeated presses walk backward
through the history one change at a time; undoing with an empty history
announces "Nothing to undo yet." without changing anything. Names and
colors can repeat; numbered markers distinguish players.

Every successful game mutation — starting a game, saving points, a
successful undo, and confirming **Finish game** — is saved to this browser's
local storage, so reloading the page never loses a game in progress. The home
screen's **Unfinished games** panel lists each saved game with its title,
player count, player names and color markers, and an "Updated" timestamp,
most recently updated first; each card's **Resume** control reopens the game
with its roster, totals, and change log intact, so undo works immediately
after resuming and undone changes never reappear after a reload. Games are
saved only in this browser — clearing site data removes them. Ranks stay
render-time only and are never stored.

Ending a game is deliberate and irreversible. The score-entry panel's
**Finish game** action opens an inline confirmation — "Finish this game?"
with the warning "Finished games can't be reopened for scoring. Final
standings stay saved in this browser." — where **Cancel** returns to scoring
with everything unchanged. Confirming locks the game: the leaderboard becomes
read-only final standings under a "Finished" badge with every player's final
rank and total, and all score controls (Add points, the score-entry panel,
Save points, Undo last score) disappear; a status line reads "Final standings
— this game is finished and can't be scored." Finished games move to the
home screen's **Finished games** panel, whose **View results** controls
reopen the same read-only standings — unchanged after any reload — while
unfinished games keep their Resume controls.

Confirming the finish also celebrates once: a dismissible **Final podium**
modal opens over the read-only standings, listing "Rank 1" / "Rank 2" /
"Rank 3" groups for every player whose final competition rank is 1–3 — ties
are never collapsed (12, 12, 8 puts two players on the top step with no
"Rank 2" group, and twenty tied players all appear in one scrolling group),
while players outside the top three stay visible in the full standings
behind the modal. A brief CSS confetti animation plays and is fully
suppressed when the system prefers reduced motion. Dismiss with the **Close**
button, **Escape**, or a click on the backdrop; focus returns to the game
heading, the standings remain unchanged, and the celebration never repeats
when the finished game is reopened or reloaded. The celebration is display
only — it writes nothing and the saved game gains no new fields.

One more round is one click away: the finished view's **Play again** button,
below the standings, creates a separate new active game from the finished
game's roster — the same title and the same names, colors, and numbered
markers, but brand-new game and player identities, every total at zero, and
no scores or undo history carried over (undoing right away announces
"Nothing to undo yet."). The rematch opens straight into scoring with the
first player selected and is saved immediately like every other mutation, so
it appears under **Unfinished games** while the finished original stays saved
and read-only under **Finished games** — after any reload, both games are
listed independently with their own totals, history, and timestamps. Guard
failures stay visible: an unusable stored roster shows "This game's saved
players can't be replayed." in a polite status region instead of silently
doing nothing, and blocked storage keeps the replay working in memory with
the usual write notice.

Storage problems are never silent. When a save fails (blocked or full
storage), when the stored data is unreadable or incompatible, or when
individual saved entries are unusable, a polite status notice explains it in
plain language at the top of the **Unfinished games** panel and above the
leaderboard in the active game, while play keeps working in memory with
unchanged success feedback. Nothing is falsely presented as saved: a failed
save never leaves a card on the home screen, and when the stored payload
cannot be read at startup, no new changes are written for that session so the
original data is preserved untouched — reloading the page tries again. Skipped
entries are disclosed with an info note, and every successful save clears the
notice automatically; there are no retry or dismiss buttons.

## Next steps

Run `$feature-flow` one feature at a time. Every listed feature is
implemented; `restrict-score-entry-input` is the final slice, awaiting
independent validation and merge.
