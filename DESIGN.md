# Scorekeeper design direction

## Status

Accepted visual direction: the user approved the generated mobile/desktop concept. Project documents use English. The initial tokens below translate the concept into implementation guidance.

## Generated concept

- Image: [Desktop and mobile scorekeeper](docs/design/concepts/scorekeeper-desktop-mobile-v1.png)
- Role: active game screen, showing responsive leaderboard and individual score entry.
- Status: inspiration, accepted direction. Generated with the built-in imagegen tool.
- Generated text, decorative details, and exact spacing are not implementation requirements. Game titles shown in the image are illustrative.

## Visual direction

- Warm ivory surfaces, charcoal text, rounded cards, restrained paper texture, colorful pawn markers, and large score numerals.
- Desktop: leaderboard beside score entry. Mobile: compact player rows with touch-friendly score controls. Support scrolling for up to 20 players.
- Player colors: blue, red, yellow, green, orange, white, black; colors may repeat. Keep names visible and outline white markers. Do not rely on color alone.
- Accessibility baseline: readable contrast, keyboard-operable controls, visible focus, and reduced-motion support for celebration effects.

## Confirmed behavior that design must preserve

- One scorekeeper, no account; game history stays in the current browser.
- Add positive or negative points to individual players. Others remain unchanged. Highest total leads; ties share rank (1, 1, 3).
- Undo the latest score change.
- Resume unfinished games. Finish saves read-only standings and opens a top-three podium modal with confetti; ties must be accommodated.
- Play again copies the players into a new game with zero scores.

## Initial design tokens

- Background: `#FAF5EB`; surface: `#FFFDF8`; text: `#20242B`; primary action: `#0868C9` with white text; border: `#DED6C9`.
- Player markers: blue `#1479DE`, red `#E5483B`, yellow `#F5C518`, green `#28956B`, orange `#F28A2B`, white `#FFFFFF`, black `#202124`. These are marker colors, not automatic text backgrounds.
- Typography: rounded system sans-serif stack, 16px baseline body text, bold headings and tabular score numerals. Choose any display-font dependency during implementation.
- Spacing: 8px base rhythm; 16–24px card padding. Cards use approximately 16px corner radii and subtle shadows.

## Core screens and controls

- Home: obvious New game action, empty-state guidance, and cards separating resumable games from finished results.
- New game: compact name/color rows with add-player controls and a clear count up to 20.
- Active game: ranked rows, persistent names and totals, signed whole-number score input, Save points, Undo last score, and a distinct Finish game action.
- Finished game: read-only full standings and Play again. The finish podium shows all players in ranks 1–3, supporting tied groups; celebration is brief and dismissible.

## Responsive and accessibility guidance

Use content-driven breakpoints: stack panels on narrow screens, place them side by side when space allows. Avoid horizontal page scrolling at a 320px viewport. Keep touch targets approximately 44px, preserve focus when standings reorder, and label every input. White/yellow markers need dark outlines; text contrast must be checked during implementation. Dialogs need keyboard focus management and a clear close control. Honor reduced motion by suppressing confetti.

Decorations should frame the controls without crowding the leaderboard. Written product behavior is authoritative; exact mockup spacing and generated text are illustrative.

## Generation prompt

Use case: ui-mockup. Create one high-fidelity design concept board showing matching desktop and mobile responsive web-app scorekeeper screens side by side. Playful board-game aesthetic, warm ivory background, charcoal text, rounded cards, subtle paper texture, colorful small pawn/token icons, polished usable interface, ample whitespace, large readable numbers. Working title 'Game night'. Desktop main view: back link 'All games', title 'Friday game night', 'In progress' badge, 'Finish game' button. Leaderboard rows in descending order: blue token Alex 42, red token Sam 35, green token Jamie 28, yellow token Taylor 19. Each row has clear name, rank, total and 'Add points' button. Adjacent compact score-entry panel 'Add points' with selected player Alex, signed numeric input '+5', helper 'Use negative points for penalties', button 'Save points'. Small 'Undo last score' action. Mobile screen repeats same game and standings in compact readable stacked rows with touch-friendly controls, prominent Add points control. Colors available to players: blue, red, yellow, green, orange, white, black; white tokens have dark outlines. Names/icons distinguish repeated colors. Design must scale to a scrollable list of 20 players. No sign-in, account avatar, shared multiplayer, charts, round-completion buttons or unrelated features. Flat front-facing UI mockups, not perspective device photography. Label desktop and mobile outside the screens. This is a visual direction reference, not production code.
