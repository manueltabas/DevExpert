# Scorekeeper design direction

## Status

Accepted visual direction (v2): the warm ivory canvas gains cool-tinted card surfaces, Plus Jakarta Sans typography, and a Material-style token system. The five-screen mockup set under `docs/design/update-v2/` is the visual source of truth. Project documents use English.

## Existing design assets

- Screens (PNG + reference HTML), authority: **source of truth for visual direction**:
  - [Dashboard with games](docs/design/update-v2/scorekeeper_dashboard/screen.png) — home with ongoing/history panels, hero, top navigation.
  - [Dashboard empty state](docs/design/update-v2/dashboard_empty_state/screen.png) — first-run hero and both empty panels.
  - [New game setup](docs/design/update-v2/new_game_setup/screen.png) — roster rows, token color pickers, game title, setup sidebar.
  - [Active game](docs/design/update-v2/active_game_scorekeeper/screen.png) — leaderboard plus score-entry panel with quick counters, recent entries, distribution bar.
  - [Final podium](docs/design/update-v2/end_of_game_podium_summary/screen.png) — podium modal with three exit actions.
- Token file: [warm_tactile_scorekeeper/DESIGN.md](docs/design/update-v2/warm_tactile_scorekeeper/DESIGN.md) — full YAML token scale (colors, type, radii, spacing). Authoritative for values; the summary below is the working subset.
- Reference HTML uses Tailwind CDN and icon fonts; implementation stays plain CSS with linked fonts and fallbacks (decided; see build brief). Mockup HTML is a fidelity reference, not code to copy.
- Superseded: [scorekeeper-desktop-mobile-v1.png](docs/design/concepts/scorekeeper-desktop-mobile-v1.png) — the original generated concept; kept for history only.

## Mockup decoration — do not implement

Round/turn labels and timers ("Round 6", "Turn 6 · 48m", "Round active"), dashboard statistics (win streaks, "Active Roster", "nights recorded"), named game presets, "Fill group" roster reuse, and "Quick 4-player game" are decoration in the mockups and are excluded in the build brief's non-goals. Sample data in mockups ("tst. asa", scores) is illustrative.

## Product feel

Warm, tactile tabletop companion: a warm ivory page canvas with cool lavender-white cards floating on it, generous rounded corners, soft shadows, charcoal text, one confident blue primary action, playful pawn/token color dots as the only strong chroma. Dense but calm: chips, badges, and small caps labels organize information without clutter.

## Colors (working subset)

- Canvas `#FAF5EB`; card surfaces `#FFFFFF` / `#F1F3FD` / `#EBEEF7` (low→high); text `#181C23` with variant `#414752`.
- Primary `#005DB7` / container `#0868C9` on-white text `#FFFFFF`; primary container tints `#E2EAFF`, `#D6E3FF`.
- Secondary (warm neutrals) `#635E53` / container `#E7DFD1`; tertiary (burnt orange accents, e.g. Finish game) `#883A00` / container `#AE4C00` / tint `#FFE5D9`; error `#BA1A1A` / container `#FFDAD6`.
- Outlines `#727784` (strong) and `#C1C6D5` (subtle); legacy warm border `#DED6C9`.
- Player tokens: blue `#1479DE`, red `#E5483B`, yellow `#F5C518`, green `#28956B`, orange `#F28A2B`, white `#FFFFFF`, black `#202124`. Colors may repeat; white/yellow markers need dark outlines. Player-number badges disambiguate repeats.

## Typography

Plus Jakarta Sans (linked, system-stack fallback): display score 56/40px w800 (desktop/mobile), headline-lg 32/26px w700, headline-md 22px w700, body 16–18px w400, labels 12–16px w600 with letter-spaced small caps for section labels (LEADERBOARD, SCORE ENTRY). Score numerals are large, bold, and tabular. Icons use Material Symbols with inline-SVG or labeled-text fallback.

## Layout and core screens

Top app bar on all screens: brand "Game night — Board-game scorekeeper" with token-color dots, segmented nav Dashboard / New Game / Active Game. Content-driven breakpoints; panels stack on narrow screens, sit side by side on wide. No horizontal scroll at 320px; touch targets ~44px.

- **Dashboard**: hero ("Keep score, stay in the game." + New game; no local-only pill), two panels — Ongoing games (name, player count, updated recency, Resume) and Finished games (winner with rank, top score, View results) — with a 32px desktop gutter and a 32px separator below the hero. Each panel previews its five most recent games; above five, a **View all (N)** / **Show latest 5** disclosure expands it transiently. Purposeful empty states for both; the Active Game destination shows an empty state when nothing is in progress.
- **New game**: "Who is playing?" with optional game title, player-count chip (n/20), numbered player rows with name input, Remove, and token-color pickers; Add player, Start game, Back. Sidebar explains table colors and shows setup helpers that exist in scope only (Reset list); rules: 2–20 players, names may repeat, blank names cannot start.
- **Active game**: back link and header with title, In-progress badge, Edit title, and **Finish game**; the finish confirmation renders between the header and leaderboard. Leaderboard rows select on click (rank, number badge, token, name, total, Add points) plus distribution bar. Score-entry panel with selected player, signed stepper, helper text, quick tap counters (+1/+5/+10/+25/−1/−5/−10) that stage the same draft as the stepper, Save points, Undo last score, and the five newest recent entries (player, signed amount, relative time).
- **Finished game**: read-only full-width standings (no empty right column), Play again. The podium is ordered steps (rank 2 left, rank 1 center and tallest, rank 3 right; missing ranks omitted) with tied players preserved, a **Rest of the table** list for every rank >3 player, brief dismissible confetti, and three actions: Play again, Close & view full standings, Save & exit to Dashboard.

## Accessibility baseline

Readable contrast on tinted surfaces; every icon-only control has a label; distribution bar never encodes meaning by color alone (pair with names/percentages); focus visible and preserved when the leaderboard reorders; dialogs manage focus with a clear close control; reduced motion suppresses confetti; the font-fallback stack keeps hierarchy and contrast intact offline.

## Do's and don'ts

- Do keep written behavior authoritative; mockup spacing, sample names, and decoration are illustrative.
- Do treat quick counters, recent entries, and the distribution bar as views over existing score-change data — no parallel state.
- Don't introduce Tailwind, an icon-font hard dependency, or any runtime beyond the static app.
- Don't implement anything listed under "Mockup decoration — do not implement".
