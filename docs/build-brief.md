# Board-game scorekeeper brief

## Problem and users

Help a group of friends track board-game scores without manually adding totals. One scorekeeper operates a responsive web app on a phone or desktop. The existing scoring tool or workaround was not specified.

## Status

The 11-feature MVP (bootstrap, roster, scoring, ranking, undo, resume, storage-failure handling, finish, podium, play again, score-entry restriction) is implemented and accepted. This brief now covers the **v2 design update**: adopt the new visual system in ../DESIGN.md and add a bounded set of low-cost behaviors. It is not a rewrite; existing accepted behavior is preserved.

## Agreed MVP (delivered)

- Homepage lists saved games and offers a new-game action.
- Create a game with named players, up to 20. Use blue, red, yellow, green, orange, white, and black markers; colors may repeat.
- Add positive or negative whole-number points to any player. Update their total and the leaderboard immediately; entering everyone's score or a zero is unnecessary.
- Highest total leads. Ties share rank, using competition ranking: 1, 1, 3.
- Undo the latest score change.
- Save locally and resume unfinished games.
- Finish a game to save read-only standings and show a podium modal with ranks 1–3 and confetti, accommodating tied players.
- From a finished game, start a new game with the same players and zero totals. Keep the original result.
- Restrict score entry to plain signed integers within safe bounds.

## v2 update scope

Visual refresh: cool-tinted card surfaces over the warm ivory canvas, Plus Jakarta Sans typography, icon system, top navigation (Dashboard / New Game / Active Game), and the five screens in `design/update-v2/`. Implemented in plain CSS with linked web fonts and graceful fallbacks; no framework.

Behavioral additions, chosen because they are cheap and fit the existing data:

- **Game titles**: optional title set during setup, editable while the game is in progress, frozen when finished. Blank titles display an auto date-based label.
- **Quick tap counters**: preset signed amounts (+1, +5, +10, +25, −1, −5, −10) alongside the signed stepper and custom input. Counters and the stepper stage the same pending draft; Save points applies the combined draft as one ordinary score change, and undo semantics are unchanged.
- **Recent entries**: show the active game's score-change log newest first with relative timestamps, including the latest entry's effect for undo context.
- **Player numbers**: numbered badges in setup order so repeated colors or names stay distinguishable.
- **Finished-game cards**: show the winner (rank 1, handling ties) and top score; ongoing cards show player count and last-activity recency.
- **Updated timestamps**: store and display last-activity time per game ("Updated 10m ago").
- **Score distribution**: a stacked bar of each player's share of total points under the leaderboard.
- **Empty states**: purposeful empty states for ongoing and finished panels, and for the Active Game destination when nothing is in progress.
- **Podium actions**: Play again, Close & view full standings, and Save & exit to Dashboard.
- **Podium steps and rest list**: ordered rank-2/rank-1/rank-3 steps with a taller center, ties preserved, missing ranks omitted, and a ranking-order "Rest of the table" list for every player ranked above 3.

## Technical direction

Unchanged: semantic HTML, responsive CSS, and JavaScript modules with browser localStorage; no application server, database service, or account system. The v2 visual system is implemented as CSS custom properties translated from the token file; web fonts are linked with system fallbacks and icons degrade to labeled text or inline SVG. Tailwind was considered and rejected to keep the dependency-free direction. Serve through a local HTTP server during development and a static HTTPS host for deployment. See [MDN localStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage).

## Access and operations

Anyone with access to the same browser profile can access these games. There are no invitations, remote permissions, account revocation, or app-managed expiry. Names and scores stay in the browser; cloud synchronization is excluded.

The repository owner operates the initial app. Hosting provider selection can wait until deployment. Surface failed saves and invalid stored data instead of silently presenting changes as saved. Keep initial diagnostics local and avoid logging player names or scores unnecessarily; no analytics service is needed.

## Non-goals

Accounts, device synchronization, live multiplayer, mandatory round entry, decimal scores, lowest-score-wins modes, editing finished results, board-game catalogs, and long-term player statistics. Offline installation, export/import, and shared-tab editing are deferred.

From the v2 mockups, explicitly decoration and out of scope: round/turn tracking and elapsed-time timers ("Round 6", "Turn 6 · 48m"), dashboard statistics such as win streaks, active-roster counts, and "nights recorded" totals, named game presets (Catan/Duel/Wingspan), cross-game roster reuse ("Fill group"), and one-tap default games ("Quick 4-player game").

## Validation and success criteria

The delivered MVP's end-to-end check still holds: create a game, enter scores for selected players, apply a penalty, undo it, reload and resume, finish, review saved results, and play again with zero totals while preserving the original game.

v2 extends verification: edit a title and confirm it freezes at finish; apply quick-counter and stepper entries and confirm they behave as ordinary score changes; confirm the recent-entries log reflects entries and undo; confirm timestamps update on activity; confirm the distribution bar matches standings and handles edge totals; confirm player numbers disambiguate repeated colors; check both empty states; confirm all three podium actions; verify the font fallback renders acceptably offline. Keep existing coverage: score arithmetic, integer validation, ranking/ties, undo, finished-state restrictions, replay isolation, failed storage access, corrupt saved data, 20 players, long names, keyboard access, reduced motion, and 320px layouts.

Success means the scorekeeper can complete a real game without manually calculating totals, lose no successfully saved changes on reload, distinguish players on a small screen, and match the v2 visual direction without regressing any accepted feature.
