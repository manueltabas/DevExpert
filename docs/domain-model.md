# Domain model

## Concepts and relationships

A game contains players and an ordered sequence of score changes. Each player has an identity within that game, display name, color, marker, and initial total of zero. Each change references one player and contains a signed integer. Exact storage fields are an implementation decision.

Game identity must be independent of its display label. Player identity must be independent of name and color, because colors repeat and names may collide.

A game carries an optional **title** for display and a **last-activity timestamp** that updates whenever the game changes. When the title is blank, interfaces show an auto date-based label; the stored identity never changes either way.

A game may also carry an optional **game preset** — one of the fixed approved setups Custom, Flip 7, Catan, Ticket to Ride, 7 Wonders, or Yahtzee. The preset supplies setup defaults/bounds, a default title, quick-scoring actions, a sign policy, and informational target/hint text. Only known non-custom presets are stored (`presetId`); Custom and pre-feature games omit the field, and missing/unknown ids safely mean Custom. The preset is presentation and input policy, not scoring state: totals, ranks, the change log, and standings semantics are identical for every preset.

Each player has a **player number** assigned in setup order (1–20). It is a stable, game-scoped display aid for repeated colors or names, not part of identity, and carries no scoring meaning.

The score-change sequence is authoritative. The **recent entries** view and the **undo** action both derive from it; neither introduces new state. **Score distribution** is derived data computed from current totals, never persisted.

## Lifecycle

- New-game setup collects an optional preset, the participants, and an optional title before starting. A preset sets the roster default/range (untouched rosters take the default; edited rosters are clamped into range preserving retained names/colors) and may auto-fill a title only while the title is empty or still preset-written. Player numbers are assigned in setup order.
- An in-progress game accepts score changes and supports undo and resume. Its title and last-activity timestamp update with changes.
- Finish preserves the final standings and makes the game read-only: scores, roster, and title all freeze. Reopening for scoring is excluded.
- Play again creates a separate in-progress game from a finished game's player roster, copying display names/colors/markers with new game-scoped identities and zero totals. It does not copy scores, undo history, timestamps, or the original title. It copies a valid non-custom preset (so the rematch keeps that preset's scoring contract) and omits the field for Custom/old/unknown sources.

## Scoring and standings

- Add a signed whole-number amount to one player; other totals do not change. Negative totals are valid where the preset allows negatives. Non-negative presets (Flip 7, Catan, 7 Wonders, Yahtzee) reject negative saves and floor their stepper at 0; Custom and Ticket to Ride keep signed entry. Quick tap counters, the stepper, and Flip 7's ×2 are input conveniences that stage the same pending draft; Save points applies the combined draft as one ordinary score change (one log entry, one save). Zero is invalid for every preset and no zero action exists; skipped zero rounds (a Flip 7 bust, an empty Yahtzee category) are simply not entered. Preset targets (200 points, 10 VP) are informational hints only and never finish a game, disable scoring, or trigger the podium.
- Rank players by total descending. Rank equals one plus the number of players with a strictly higher total.
- Equal totals share rank: 12, 12, 8 gives ranks 1, 1, 3. Preserve a stable display order within ties without declaring a tie winner.
- Podium positions are ranks 1–3; include every tied player at those ranks. Some positions can be empty and some can contain multiple players. Podium steps show the top three; a ranked summary then lists every player, including ranks above 3, in competition-rank groups, and the full standings stay available.
- Undo reverses the most recent score change in the active game and recalculates standings, recent entries, and distribution. It does not undo finishing a game. Further undo depth is an implementation-time decision; only latest-change undo is promised.

## Persistence and boundaries

Persist games in the current browser. Loading an unfinished game restores its scores, roster, title, preset, and timestamps; loading a finished game exposes read-only results. The storage envelope stays version 1 and the only preset field is the optional non-custom `presetId`; Custom/old/unknown values omit or fall back to Custom without rewriting stored data. Changes must not mutate other games.

Maximum roster size is 20. The minimum size follows the selected preset (Custom stays 2). Minimum/maximum enforcement, name validation, score magnitude bounds, zero-entry handling, the auto-label format for blank titles, and the display treatment of the distribution bar when totals are negative or zero are documented in risks-and-open-questions.md.
