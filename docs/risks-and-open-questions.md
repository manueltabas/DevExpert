# Risks and open questions

## Blocking next phase

None. The v2 scope, visual source of truth, and stack approach are agreed; feature specs can be derived from `build-brief.md`, the domain model, and ../DESIGN.md.

## Resolved decisions

- Game identification (previously implementation-time): optional title set during setup, editable while in progress, frozen at finish; blank titles display an auto date-based label. Chosen with the v2 design.
- Tailwind: rejected. Tokens are translated to plain CSS custom properties; web fonts are linked, not bundled.
- Game presets (previously mockup decoration): approved as the fixed six-option `game-presets` catalogue (Custom, Flip 7, Catan, Ticket to Ride, 7 Wonders, Yahtzee) with preset ranges/defaults, ordered quick actions including Flip 7's draft-only ×2, sign policy, and informational targets. The optional `presetId` is stored only for known non-custom games; targets never auto-finish, zero stays invalid, and Custom remains the universal fallback. User-defined presets and a wider catalog stay out of scope.

## Implementation-time decisions

- Minimum roster: propose 2 players; the user confirmed only the maximum of 20.
- Player names: define blank/duplicate handling and a reasonable length limit while retaining independent player IDs.
- Scores: set safe integer bounds, reject decimals and non-numbers, and decide whether a zero entry is ignored. Totals can be negative.
- Undo: define whether repeated presses walk backward and whether the latest undo survives reload. At minimum, reverse the latest score change during active play.
- Prevent accidental finishing with a clear confirmation because finished games cannot reopen.
- Score distribution semantics: decide what the bar shows when the game total is negative or zero (e.g. hide, or show absolute shares with a caption). Must not imply a misleading "leader" when penalties dominate.
- Quick tap counters: confirm the final preset set from the mockup (+1, +5, +10, +25, −1, −5, −10) and whether tapping applies immediately or stages the draft amount before Save points.
- Relative timestamps: define "Updated Xm ago" formatting and thresholds, and whether a clock-less environment (corrupt/missing timestamps) degrades to absolute dates.
- "Active Game" navigation: define behavior when no game is in progress (empty state prompting New game) and which game it opens when several are active (most recent activity).
- Auto-label format for blank titles (e.g. date-based), keeping it distinct from editable titles.
- Font and icon fallbacks: system font stack metrics differ from Plus Jakarta Sans; define the fallback order and the small inline-SVG/labeled-text set that replaces icon-font glyphs when offline.
- English UI copy is confirmed (user chose English for documents and the app).

## Later / outside MVP

Choose a static hosting provider when deployment is requested. Offline/PWA support, export/import, deletion of saved games, and concurrent browser-tab editing are not part of the agreed initial scope. The mockup decoration items still called out in the brief's non-goals (rounds, timers, statistics, roster reuse, one-tap games) stay out of scope here too. User-defined presets, per-game action editing, and a wider board-game catalog are also out of scope; the approved fixed preset catalogue is in scope.

## Risks and responses

- Browser data can be cleared or unavailable, especially in private browsing. Explain local-only retention and surface save failures. No backup or cross-device recovery is promised.
- Repeated colors and up to 20 players can reduce readability. Keep names visible, use outlined markers, and add player-number badges; test long scrolling lists.
- Ties can place many players on one podium step. Use flexible groups and retain the full leaderboard.
- Celebration motion can be distracting. Keep confetti brief and respect reduced-motion settings.
- Linked web fonts and icon fonts fail offline or on flaky connections. System fallbacks must keep the layout usable; verify an offline render.
- The v2 mockups are denser than the current UI (distribution bar, entry log, chips). Verify contrast, focus order, and touch targets; written behavior takes precedence over decorative details.
- Selecting a smaller preset clamps a touched roster and removes its trailing rows, so names entered beyond the new maximum can be lost before the game starts. This is accepted pre-game behavior: the count/status pill makes the reduction visible, the retained rows keep names/colors, and no confirmation dialog is added.
- Preset sign/zero copy can contradict itself if handled statically: the zero message must follow the active preset (positive-only vs signed) while Ticket to Ride/Custom keep the accepted text, and `negative-not-allowed` must run only after the existing zero/range gates.
- Flip 7's ×2 and the non-negative draft floor are draft-only semantics; they must not create a second score pipeline, a new save trigger, or an auto-finish at the target.

## Research tasks

None currently. Font-fallback rendering and negative-total distribution behavior are verified during implementation rather than researched upfront.
