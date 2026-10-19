import assert from "node:assert/strict";
import {
  CUSTOM_PRESET_ID,
  GAME_PRESETS,
  allowsNegative,
  getPreset,
  normalizePresetId,
  resolvePlayerCount
} from "../src/presets.js";

// Catalogue order, ids, labels, ranges, defaults, titles, sign policy, and
// quick actions are the fixed approved data set (Decision 1).
const expected = [
  {
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
    target: null
  },
  {
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
    target: "200 points"
  },
  {
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
    target: "10 VP"
  },
  {
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
    target: null
  },
  {
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
    target: null
  },
  {
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
    target: null
  }
];

assert.equal(CUSTOM_PRESET_ID, "custom");
assert.deepEqual(
  GAME_PRESETS.map((preset) => preset.id),
  expected.map((preset) => preset.id),
  "the picker order is the approved catalogue order"
);

for (const [index, wanted] of expected.entries()) {
  const preset = GAME_PRESETS[index];
  assert.equal(preset.id, wanted.id);
  assert.equal(preset.label, wanted.label);
  assert.equal(preset.minPlayers, wanted.minPlayers);
  assert.equal(preset.maxPlayers, wanted.maxPlayers);
  assert.equal(preset.defaultPlayers, wanted.defaultPlayers);
  assert.equal(preset.defaultTitle, wanted.defaultTitle);
  assert.equal(preset.allowsNegative, wanted.allowsNegative);
  assert.deepEqual(preset.quickActions, wanted.quickActions, `${preset.id} quick actions match the catalogue`);
  assert.equal(preset.target, wanted.target);
  assert.ok(Object.hasOwn(preset, "setupHint"), "every record carries setupHint (possibly null)");
  assert.ok(Object.hasOwn(preset, "scoreHint"), "every record carries scoreHint (possibly null)");
}

// Exact locked hints.
assert.equal(
  getPreset("flip-7").scoreHint,
  "Enter the number-card sum, tap ×2, add the +15 bonus, then Save. Bust rounds add nothing."
);
assert.match(getPreset("catan").setupHint, /Base game supports 3–4 players/);
assert.match(getPreset("catan").setupHint, /5–6 player expansion/);
assert.equal(getPreset("yahtzee").scoreHint, "Zero categories add nothing.");

// No zero quick action exists in any preset.
for (const preset of GAME_PRESETS) {
  assert.ok(
    preset.quickActions.every((action) => action.type !== "add" || action.amount !== 0),
    `${preset.id} must not offer a zero action`
  );
  for (const action of preset.quickActions) {
    assert.ok(action.type === "add" || action.type === "multiply", "only add/multiply actions exist");
  }
}

// Frozen catalogue and records (deeply frozen actions).
assert.ok(Object.isFrozen(GAME_PRESETS));
for (const preset of GAME_PRESETS) {
  assert.ok(Object.isFrozen(preset), `${preset.id} is frozen`);
  assert.ok(Object.isFrozen(preset.quickActions), `${preset.id} quick actions are frozen`);
  assert.ok(preset.quickActions.every((action) => Object.isFrozen(action)), `${preset.id} actions are frozen`);
}
assert.throws(() => {
  GAME_PRESETS.push({});
}, /frozen|read only|not extensible/i);

// getPreset: the universal safe fallback for missing/null/unknown values.
for (const fallback of [undefined, null, "", "custom", "not-a-preset", 42, {}, []]) {
  assert.equal(getPreset(fallback).id, CUSTOM_PRESET_ID, `getPreset(${JSON.stringify(fallback)}) falls back to Custom`);
}
assert.equal(getPreset("catan").id, "catan");

// normalizePresetId: known non-custom ids only.
assert.equal(normalizePresetId("flip-7"), "flip-7");
assert.equal(normalizePresetId("ticket-to-ride"), "ticket-to-ride");
for (const customish of [undefined, null, "", "custom", "unknown-preset", 42, {}]) {
  assert.equal(normalizePresetId(customish), null, "Custom/unknown/missing normalize to null");
}

// allowsNegative resolves through the same fallback.
assert.equal(allowsNegative("custom"), true);
assert.equal(allowsNegative("ticket-to-ride"), true);
assert.equal(allowsNegative(undefined), true);
assert.equal(allowsNegative("unknown"), true);
for (const negativePreset of ["flip-7", "catan", "7-wonders", "yahtzee"]) {
  assert.equal(allowsNegative(negativePreset), false);
}

// resolvePlayerCount: untouched rosters use the default; touched rosters clamp.
assert.equal(resolvePlayerCount({ presetId: "custom", currentCount: 9, touched: false }), 2);
assert.equal(resolvePlayerCount({ presetId: "flip-7", currentCount: 20, touched: false }), 3);
assert.equal(resolvePlayerCount({ presetId: "catan", currentCount: 0, touched: false }), 4);
assert.equal(resolvePlayerCount({ presetId: undefined, currentCount: 7, touched: false }), 2);

assert.equal(resolvePlayerCount({ presetId: "flip-7", currentCount: 2, touched: true }), 3);
assert.equal(resolvePlayerCount({ presetId: "flip-7", currentCount: 10, touched: true }), 10);
assert.equal(resolvePlayerCount({ presetId: "flip-7", currentCount: 30, touched: true }), 20);
assert.equal(resolvePlayerCount({ presetId: "catan", currentCount: 10, touched: true }), 6);
assert.equal(resolvePlayerCount({ presetId: "catan", currentCount: 1, touched: true }), 3);
assert.equal(resolvePlayerCount({ presetId: "ticket-to-ride", currentCount: 9, touched: true }), 5);
assert.equal(resolvePlayerCount({ presetId: "7-wonders", currentCount: 2, touched: true }), 3);
assert.equal(resolvePlayerCount({ presetId: "yahtzee", currentCount: 25, touched: true }), 20);
assert.equal(resolvePlayerCount({ presetId: "unknown", currentCount: 7, touched: true }), 7, "unknown ids fall back to Custom bounds");
assert.equal(resolvePlayerCount({ presetId: "flip-7", currentCount: 4.9, touched: true }), 4, "non-integers truncate");
assert.equal(resolvePlayerCount({ presetId: "flip-7", currentCount: "7", touched: true }), 3, "non-numeric counts clamp from zero");
assert.equal(resolvePlayerCount(), 2, "a missing argument resolves to the Custom default");

console.log("Presets tests passed: the frozen six-record catalogue in picker order (ids, labels, ranges, defaults, titles, sign policy, ordered quick actions, targets, and locked hints), the universal getPreset Custom fallback, normalizePresetId's non-custom-only ids, allowsNegative resolution, and resolvePlayerCount untouched-default/touched-clamp behavior.");
