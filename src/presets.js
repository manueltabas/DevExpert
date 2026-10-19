// Game preset catalogue (game-presets): the one dependency-free source of
// setup data for the six approved setups. Custom is the universal fallback for
// missing, null, unknown, or legacy ids, so every consumer can resolve a preset
// without special cases. Nothing here is persisted; games store only the
// normalized non-custom id (see roster.createGame).

export const CUSTOM_PRESET_ID = "custom";

function freezeAction(action) {
  return Object.freeze(action);
}

function freezePreset(preset) {
  return Object.freeze({
    ...preset,
    quickActions: Object.freeze(preset.quickActions.map(freezeAction))
  });
}

export const GAME_PRESETS = Object.freeze([
  freezePreset({
    id: "custom",
    label: "Custom",
    minPlayers: 2,
    maxPlayers: 20,
    defaultPlayers: 2,
    defaultTitle: "",
    allowsNegative: true,
    quickActions: [
      { type: "add", amount: 1 },
      { type: "add", amount: 5 },
      { type: "add", amount: 10 },
      { type: "add", amount: 25 },
      { type: "add", amount: -1 },
      { type: "add", amount: -5 },
      { type: "add", amount: -10 }
    ],
    target: null,
    setupHint: null,
    scoreHint: null
  }),
  freezePreset({
    id: "flip-7",
    label: "Flip 7",
    minPlayers: 3,
    maxPlayers: 20,
    defaultPlayers: 3,
    defaultTitle: "Flip 7",
    allowsNegative: false,
    quickActions: [
      { type: "multiply", factor: 2 },
      { type: "add", amount: 5 },
      { type: "add", amount: 10 },
      { type: "add", amount: 15 },
      { type: "add", amount: 20 },
      { type: "add", amount: 25 },
      { type: "add", amount: 50 }
    ],
    target: "200 points",
    setupHint: null,
    scoreHint: "Enter the number-card sum, tap ×2, add the +15 bonus, then Save. Bust rounds add nothing."
  }),
  freezePreset({
    id: "catan",
    label: "Catan",
    minPlayers: 3,
    maxPlayers: 6,
    defaultPlayers: 4,
    defaultTitle: "Catan",
    allowsNegative: false,
    quickActions: [
      { type: "add", amount: 1 },
      { type: "add", amount: 2 },
      { type: "add", amount: 3 },
      { type: "add", amount: 4 },
      { type: "add", amount: 5 }
    ],
    target: "10 VP",
    setupHint: "Base game supports 3–4 players; the 5–6 player expansion supports 5–6.",
    scoreHint: null
  }),
  freezePreset({
    id: "ticket-to-ride",
    label: "Ticket to Ride",
    minPlayers: 2,
    maxPlayers: 5,
    defaultPlayers: 4,
    defaultTitle: "Ticket to Ride",
    allowsNegative: true,
    quickActions: [
      { type: "add", amount: 1 },
      { type: "add", amount: 5 },
      { type: "add", amount: 10 },
      { type: "add", amount: 15 },
      { type: "add", amount: 20 },
      { type: "add", amount: -5 },
      { type: "add", amount: -10 }
    ],
    target: null,
    setupHint: null,
    scoreHint: null
  }),
  freezePreset({
    id: "7-wonders",
    label: "7 Wonders",
    minPlayers: 3,
    maxPlayers: 7,
    defaultPlayers: 4,
    defaultTitle: "7 Wonders",
    allowsNegative: false,
    quickActions: [
      { type: "add", amount: 1 },
      { type: "add", amount: 3 },
      { type: "add", amount: 5 },
      { type: "add", amount: 10 },
      { type: "add", amount: 20 }
    ],
    target: null,
    setupHint: null,
    scoreHint: null
  }),
  freezePreset({
    id: "yahtzee",
    label: "Yahtzee",
    minPlayers: 2,
    maxPlayers: 20,
    defaultPlayers: 4,
    defaultTitle: "Yahtzee",
    allowsNegative: false,
    quickActions: [
      { type: "add", amount: 5 },
      { type: "add", amount: 10 },
      { type: "add", amount: 25 },
      { type: "add", amount: 30 },
      { type: "add", amount: 40 },
      { type: "add", amount: 50 }
    ],
    target: null,
    setupHint: null,
    scoreHint: "Zero categories add nothing."
  })
]);

const CUSTOM_PRESET = GAME_PRESETS[0];

// The universal safe fallback: undefined, null, "custom", and unknown ids all
// resolve to the frozen Custom record.
export function getPreset(presetId) {
  if (typeof presetId !== "string") {
    return CUSTOM_PRESET;
  }

  return GAME_PRESETS.find((preset) => preset.id === presetId) ?? CUSTOM_PRESET;
}

// Known non-custom ids only; Custom/unknown/missing resolve to null. Used to
// decide what a saved or replayed game stores.
export function normalizePresetId(presetId) {
  const preset = getPreset(presetId);
  return preset.id === CUSTOM_PRESET_ID ? null : preset.id;
}

export function allowsNegative(presetId) {
  return getPreset(presetId).allowsNegative;
}

// Untouched setups use the preset's default roster size; touched setups clamp
// the current row count into the preset's range. Non-numeric counts clamp from
// zero, and non-integers are truncated before clamping.
export function resolvePlayerCount({ presetId, currentCount = 0, touched = false } = {}) {
  const preset = getPreset(presetId);

  if (!touched) {
    return preset.defaultPlayers;
  }

  const numericCount = Number.isFinite(currentCount) ? Math.trunc(currentCount) : 0;
  return Math.min(preset.maxPlayers, Math.max(preset.minPlayers, numericCount));
}
