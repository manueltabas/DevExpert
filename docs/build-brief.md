# Board-game scorekeeper brief

## Problem and users

Help a group of friends track board-game scores without manually adding totals. One scorekeeper operates a responsive web app on a phone or desktop. The existing scoring tool or workaround was not specified.

## Agreed MVP

- Homepage lists saved games and offers a new-game action.
- Create a game with named players, up to 20. Use blue, red, yellow, green, orange, white, and black markers; colors may repeat.
- Add positive or negative whole-number points to any player. Update their total and the leaderboard immediately; entering everyone's score or a zero is unnecessary.
- Highest total leads. Ties share rank, using competition ranking: 1, 1, 3.
- Undo the latest score change.
- Save locally and resume unfinished games.
- Finish a game to save read-only standings and show a podium modal with ranks 1–3 and confetti, accommodating tied players.
- From a finished game, start a new game with the same players and zero totals. Keep the original result.
- Follow the accepted playful mobile/desktop concept in ../DESIGN.md.

## Technical direction

The user requested a simple setup with no required framework. Use semantic HTML, responsive CSS, and JavaScript modules, with browser localStorage for this small dataset. No application server, database service, or account system is needed for the MVP. Development and test tooling will be selected during technical bootstrap.

Serve through a local HTTP server during development and a static HTTPS host for deployment. Browser storage is tied to the site's origin and persists across sessions; private browsing and clearing site data affect retention. Do not rely on opening HTML via file URLs. See [MDN localStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage).

## Access and operations

Anyone with access to the same browser profile can access these games. There are no invitations, remote permissions, account revocation, or app-managed expiry. Names and scores stay in the browser; cloud synchronization is excluded.

The repository owner operates the initial app. Hosting provider selection can wait until deployment. Surface failed saves and invalid stored data instead of silently presenting changes as saved. Keep initial diagnostics local and avoid logging player names or scores unnecessarily; no analytics service is needed.

## Non-goals

Accounts, device synchronization, live multiplayer, mandatory round entry, decimal scores, lowest-score-wins modes, editing finished results, board-game catalogs, and long-term player statistics. Offline installation, export/import, and shared-tab editing are deferred.

## Validation and success criteria

An end-to-end check creates a game, enters scores for selected players, applies a penalty, undoes it, reloads and resumes, finishes, reviews saved results, and plays again with zero totals while preserving the original game.

Automate score arithmetic, integer validation, ranking/ties, undo, finished-state restrictions, and replay isolation. Add browser coverage for persistence and the main flow. Check narrow mobile and desktop layouts, 20 players, long names, repeated colors, keyboard access, and reduced motion. Exercise failed storage access and corrupt saved data.

Success means the scorekeeper can complete a real game without manually calculating totals, lose no successfully saved changes on reload, and distinguish players on a small screen. Verification commands will be established after bootstrap; no product code or tests exist yet.
