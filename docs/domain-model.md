# Domain model

## Concepts and relationships

A game contains players and an ordered sequence of score changes. Each player has an identity within that game, display name, color, marker, and initial total of zero. Each change references one player and contains a signed integer. Exact storage fields are an implementation decision.

Game identity must be independent of its display label. Player identity must be independent of name and color, because colors repeat and names may collide.

## Lifecycle

- New-game setup collects the participants before starting.
- An in-progress game accepts score changes and supports undo and resume.
- Finish preserves the final standings and makes the game read-only. Reopening for scoring is excluded.
- Play again creates a separate in-progress game from a finished game's player roster, copying display names/colors/markers with new game-scoped identities and zero totals. It does not copy scores or undo history.

## Scoring and standings

- Add a signed whole-number amount to one player; other totals do not change. Negative totals are valid.
- Rank players by total descending. Rank equals one plus the number of players with a strictly higher total.
- Equal totals share rank: 12, 12, 8 gives ranks 1, 1, 3. Preserve a stable display order within ties without declaring a tie winner.
- Podium positions are ranks 1–3; include every tied player at those ranks. Some positions can be empty and some can contain multiple players. Keep full standings available.
- Undo reverses the most recent score change in the active game and recalculates standings. It does not undo finishing a game. Further undo depth is an implementation-time decision; only latest-change undo is promised.

## Persistence and boundaries

Persist games in the current browser. Loading an unfinished game restores its scores and roster; loading a finished game exposes read-only results. Changes must not mutate other games.

Maximum roster size is 20. Minimum size, name validation, score magnitude bounds, and zero-entry handling are documented as implementation-time decisions in risks-and-open-questions.md.
