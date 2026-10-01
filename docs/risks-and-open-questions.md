# Risks and open questions

## Blocking next phase

None for preparing the minimal repository harness. The core workflow and visual direction are agreed.

## Implementation-time decisions

- Minimum roster: propose 2 players; the user confirmed only the maximum of 20.
- Game identification: provide a simple editable title or a generated date-based label. The title shown in the mockup is illustrative.
- Player names: define blank/duplicate handling and a reasonable length limit while retaining independent player IDs.
- Scores: set safe integer bounds, reject decimals and non-numbers, and decide whether a zero entry is ignored. Totals can be negative.
- Undo: define whether repeated presses walk backward and whether the latest undo survives reload. At minimum, reverse the latest score change during active play.
- Prevent accidental finishing with a clear confirmation because finished games cannot reopen.
- Storage format remains a later persistence decision. Bootstrap chose dependency-free Node scripts for the local HTTP server and smoke check. Detect unavailable storage and invalid saved data without silent loss when persistence is added.
- English UI copy is a working assumption, consistent with the conversation and the chosen document language; the user explicitly chose English for documents.

## Later / outside MVP

Choose a static hosting provider when deployment is requested. Offline/PWA support, export/import, deletion of saved games, and concurrent browser-tab editing are not part of the agreed initial scope.

## Risks and responses

- Browser data can be cleared or unavailable, especially in private browsing. Explain local-only retention and surface save failures. No backup or cross-device recovery is promised.
- Repeated colors and up to 20 players can reduce readability. Keep names visible, use outlined markers, and test long scrolling lists.
- Ties can place many players on one podium step. Use flexible groups and retain the full leaderboard.
- Celebration motion can be distracting. Keep confetti brief and respect reduced-motion settings.
- A generated mockup is a direction reference. Written behavior and accessible responsive controls take precedence over decorative details.
