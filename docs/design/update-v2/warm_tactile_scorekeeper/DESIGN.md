---
name: Warm Tactile Scorekeeper
colors:
  surface: '#f9f9ff'
  surface-dim: '#d7dae3'
  surface-bright: '#f9f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f1f3fd'
  surface-container: '#ebeef7'
  surface-container-high: '#e5e8f2'
  surface-container-highest: '#dfe2ec'
  on-surface: '#181c23'
  on-surface-variant: '#414752'
  inverse-surface: '#2d3138'
  inverse-on-surface: '#eef0fa'
  outline: '#727784'
  outline-variant: '#c1c6d5'
  surface-tint: '#005db7'
  primary: '#00509f'
  on-primary: '#ffffff'
  primary-container: '#0868c9'
  on-primary-container: '#e2eaff'
  inverse-primary: '#a9c7ff'
  secondary: '#635e53'
  on-secondary: '#ffffff'
  secondary-container: '#e7dfd1'
  on-secondary-container: '#676258'
  tertiary: '#883a00'
  on-tertiary: '#ffffff'
  tertiary-container: '#ae4c00'
  on-tertiary-container: '#ffe5d9'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d6e3ff'
  primary-fixed-dim: '#a9c7ff'
  on-primary-fixed: '#001b3d'
  on-primary-fixed-variant: '#00468c'
  secondary-fixed: '#eae1d4'
  secondary-fixed-dim: '#cdc6b9'
  on-secondary-fixed: '#1f1b13'
  on-secondary-fixed-variant: '#4b463d'
  tertiary-fixed: '#ffdbca'
  tertiary-fixed-dim: '#ffb68f'
  on-tertiary-fixed: '#331100'
  on-tertiary-fixed-variant: '#773200'
  background: '#f9f9ff'
  on-background: '#181c23'
  surface-variant: '#dfe2ec'
  bg-base: '#FAF5EB'
  surface-card: '#FFFDF8'
  border-subtle: '#DED6C9'
  player-blue: '#1479DE'
  player-red: '#E5483B'
  player-yellow: '#F5C518'
  player-green: '#28956B'
  player-orange: '#F28A2B'
  player-white: '#FFFFFF'
  player-black: '#202124'
typography:
  display-score:
    fontFamily: Plus Jakarta Sans
    fontSize: 56px
    fontWeight: '800'
    lineHeight: 60px
    letterSpacing: -0.03em
  display-score-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 40px
    fontWeight: '800'
    lineHeight: 44px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
  headline-lg-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 26px
    fontWeight: '700'
    lineHeight: 32px
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 22px
    fontWeight: '700'
    lineHeight: 28px
  headline-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 26px
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 20px
  label-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 18px
  label-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-tablet: 1.5rem
  gutter-desktop: 2rem
  margin: 1rem
  margin-tablet: 1.5rem
  margin-desktop: 2.5rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2rem
---

# Scorekeeper design direction

## Status
Accepted visual direction: warm ivory surfaces, charcoal text, rounded cards, restrained paper texture, colorful pawn markers, and large score numerals.

## Initial design tokens
- Background: `#FAF5EB`; surface: `#FFFDF8`; text: `#20242B`; primary action: `#0868C9` with white text; border: `#DED6C9`.
- Player markers: blue `#1479DE`, red `#E5483B`, yellow `#F5C518`, green `#28956B`, orange `#F28A2B`, white `#FFFFFF`, black `#202124`.
- Typography: rounded system sans-serif stack, 16px baseline body text, bold headings and tabular score numerals.
- Spacing: 8px base rhythm; 16–24px card padding. Cards use ~16px corner radii and subtle soft shadows.

## Core screens
- Home / Dashboard: New game action, active/resumable games, finished game archive.
- New game setup: Compact player setup, name/color pickers up to 20 players.
- Active game: Responsive leaderboard with rankings, large touch-friendly point counters (+1, +5, +10, -1, custom input), undo action, and finish game button.
- Finished game & podium: Read-only standings, top-3 podium visualization, tie handling, and play again action.
