# Domain model

## Concepts and relationships

A game contains players and an ordered sequence of score changes. Each player has an identity within that game, display name, color, marker, and initial total of zero. Each change references one player and contains a signed integer. Exact storage fields are an implementation decision.

Game identity must be independent of its display label. Player identity must be independent of name and color, because colors repeat and names may collide.

A game carries an optional **title** for display and a **last-activity timestamp** that updates whenever the game changes. When the title is blank, interfaces show an auto date-based label; the stored identity never changes either way.

Each player has a **player number** assigned in setup order (1–20). It is a stable, game-scoped display aid for repeated colors or names, not part of identity, and carries no scoring meaning.

The score-change sequence is authoritative. The **recent entries** view and the **undo** action both derive from it; neither introduces new state. **Score distribution** is derived data computed from current totals, never persisted.

## Lifecycle

- New-game setup collects the participants and an optional title before starting. Player numbers are assigned in setup order.
- An in-progress game accepts score changes and supports undo and resume. Its title and last-activity timestamp update with changes.
- Finish preserves the final standings and makes the game read-only: scores, roster, and title all freeze. Reopening for scoring is excluded.
- Play again creates a separate in-progress game from a finished game's player roster, copying display names/colors/markers with new game-scoped identities and zero totals. It does not copy scores, undo history, timestamps, or the original title.

## Scoring and standings

- Add a signed whole-number amount to one player; other totals do not change. Negative totals are valid. Quick tap counters and the stepper are input conveniences that stage the same pending draft; Save points applies the combined draft as one ordinary score change (one log entry, one save).
- Rank players by total descending. Rank equals one plus the number of players with a strictly higher total.
- Equal totals share rank: 12, 12, 8 gives ranks 1, 1, 3. Preserve a stable display order within ties without declaring a tie winner.
- Podium positions are ranks 1–3; include every tied player at those ranks. Some positions can be empty and some can contain multiple players. Players ranked above 3 remain in the podium's ranking-order "Rest of the table" list, and the full standings stay available.
- Undo reverses the most recent score change in the active game and recalculates standings, recent entries, and distribution. It does not undo finishing a game. Further undo depth is an implementation-time decision; only latest-change undo is promised.

## Persistence and boundaries

Persist games in the current browser. Loading an unfinished game restores its scores, roster, title, and timestamps; loading a finished game exposes read-only results. Changes must not mutate other games.

Maximum roster size is 20. Minimum size, name validation, score magnitude bounds, zero-entry handling, the auto-label format for blank titles, and the display treatment of the distribution bar when totals are negative or zero are documented as implementation-time decisions in risks-and-open-questions.md.
