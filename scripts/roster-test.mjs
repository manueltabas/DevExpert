import assert from "node:assert/strict";
import {
  MAX_PLAYERS,
  PLAYER_COLORS,
  createGame,
  createSetupRows,
  playerNumbers,
  validateRoster
} from "../src/roster.js";

const validRows = [
  { id: "row-1", name: "  Alex  ", color: "blue" },
  { id: "row-2", name: "Alex", color: "blue" }
];

const { game, validation } = createGame({
  title: "  Friday game  ",
  rows: validRows,
  now: new Date("2026-10-02T10:00:00.000Z"),
  idSeed: "test"
});

assert.equal(validation.valid, true);
assert.equal(game.title, "Friday game");
assert.equal(game.status, "active");
assert.equal(game.players.length, 2);
assert.equal(new Set(game.players.map((player) => player.id)).size, 2);
assert.deepEqual(game.players.map((player) => player.name), ["Alex", "Alex"]);
assert.deepEqual(game.players.map((player) => player.color), ["blue", "blue"]);
assert.deepEqual(game.players.map((player) => player.total), [0, 0]);

// Superseded by name-game-titles: blank titles store "" (no fallback
// substitution) — display surfaces derive the auto-label at render time.
const blankTitleGame = createGame({
  title: "   ",
  rows: validRows,
  now: new Date("2026-10-02T10:00:00.000Z"),
  idSeed: "blank-title"
}).game;
assert.equal(blankTitleGame.title, "");
assert.equal(blankTitleGame.status, "active");

const nonStringTitleGame = createGame({
  title: 42,
  rows: validRows,
  now: new Date("2026-10-02T10:01:00.000Z"),
  idSeed: "nonstring-title"
}).game;
assert.equal(nonStringTitleGame.title, "", "a non-string title must store the empty string");

const missingTitleGame = createGame({
  rows: validRows,
  now: new Date("2026-10-02T10:02:00.000Z"),
  idSeed: "missing-title"
}).game;
assert.equal(missingTitleGame.title, "");

assert.equal(validateRoster([{ name: "Alex", color: "blue" }]).valid, false);
assert.equal(validateRoster([{ name: "   ", color: "blue" }, { name: "Sam", color: "red" }]).valid, false);
assert.equal(validateRoster([{ name: "A".repeat(41), color: "blue" }, { name: "Sam", color: "red" }]).valid, false);
assert.equal(validateRoster([{ name: "Alex", color: "purple" }, { name: "Sam", color: "red" }]).valid, false);

const twentyRows = createSetupRows(MAX_PLAYERS).map((row, index) => ({
  ...row,
  name: `Player ${index + 1}`
}));
assert.equal(validateRoster(twentyRows).valid, true);
assert.equal(new Set(twentyRows.map((row) => row.color)).size, PLAYER_COLORS.length);
assert.equal(twentyRows[0].color, twentyRows[7].color);

const twentyOneRows = [...twentyRows, { id: "extra", name: "Extra", color: "blue" }];
assert.equal(validateRoster(twentyOneRows).valid, false);

// Preset-aware validation (game-presets): the resolved preset's min/max replace
// the Custom bounds while the name/color checks stay shared.
const twoNamedRows = [
  { id: "p-1", name: "Alex", color: "blue" },
  { id: "p-2", name: "Sam", color: "red" }
];
const threeNamedRows = [...twoNamedRows, { id: "p-3", name: "Jamie", color: "green" }];
const sixNamedRows = [...threeNamedRows, { id: "p-4", name: "Dee", color: "orange" }, { id: "p-5", name: "Eli", color: "white" }, { id: "p-6", name: "Fran", color: "black" }];
const sevenNamedRows = [...sixNamedRows, { id: "p-7", name: "Gus", color: "blue" }];

assert.equal(validateRoster(twoNamedRows, "flip-7").valid, false);
assert.deepEqual(validateRoster(twoNamedRows, "flip-7").errors, ["Add at least 3 players for Flip 7."]);
assert.equal(validateRoster(threeNamedRows, "flip-7").valid, true);
assert.equal(validateRoster(sevenNamedRows, "catan").valid, false);
assert.deepEqual(validateRoster(sevenNamedRows, "catan").errors, ["Keep the table to 6 players or fewer for Catan."]);
assert.equal(validateRoster(sixNamedRows, "catan").valid, true);
assert.deepEqual(validateRoster(twoNamedRows).errors, [], "Custom keeps the accepted 2–20 bounds");
assert.deepEqual(validateRoster([{ name: "Alex", color: "blue" }]).errors, ["Add at least 2 players."], "Custom minimum copy is unchanged");
assert.equal(validateRoster(twentyOneRows, "unknown-preset").valid, false, "unknown ids fall back to the Custom bounds");

// createGame stores presetId only for a known non-custom preset; Custom,
// missing, and unknown ids are omitted from the game object.
const presetGame = createGame({
  title: "Flip 7 Friday",
  rows: threeNamedRows,
  now: new Date("2026-10-18T10:00:00.000Z"),
  idSeed: "preset",
  presetId: "flip-7"
}).game;
assert.equal(presetGame.presetId, "flip-7");
assert.equal(presetGame.title, "Flip 7 Friday");
assert.deepEqual(presetGame.players.map((player) => player.name), ["Alex", "Sam", "Jamie"]);

const customPresetGame = createGame({
  rows: twoNamedRows,
  now: new Date("2026-10-18T10:01:00.000Z"),
  idSeed: "custom-preset",
  presetId: "custom"
}).game;
assert.equal("presetId" in customPresetGame, false, "Custom omits presetId");
assert.equal("presetId" in game, false, "a missing presetId is omitted");
const unknownPresetGame = createGame({
  rows: twoNamedRows,
  now: new Date("2026-10-18T10:02:00.000Z"),
  idSeed: "unknown-preset",
  presetId: "not-a-preset"
}).game;
assert.equal("presetId" in unknownPresetGame, false, "unknown preset ids fall back to Custom and are omitted");
const invalidPresetGame = createGame({
  rows: twoNamedRows,
  now: new Date("2026-10-18T10:03:00.000Z"),
  idSeed: "invalid-preset",
  presetId: "flip-7"
});
assert.equal(invalidPresetGame.game, null, "preset minimums apply during creation");
assert.deepEqual(invalidPresetGame.validation.errors, ["Add at least 3 players for Flip 7."]);

// playerNumbers (show-player-numbers): badge numbers derive from the roster's
// setup order at render time — a pure display map keyed by player.id, never
// persisted anew and never a rank.
assert.deepEqual(
  [...playerNumbers(game)],
  [["test-player-1", 1], ["test-player-2", 2]],
  "badge numbers map each player id to its 1-based setup position"
);
assert.deepEqual(
  [...playerNumbers({ players: Array.from({ length: 20 }, (_, index) => ({ id: `p-${index + 1}` })) })],
  Array.from({ length: 20 }, (_, index) => [`p-${index + 1}`, index + 1]),
  "a full roster maps 1..N in array order"
);
// Replay-shaped arrays (replayGame rebuilds players in the original's order):
// the map is positional, so replays renumber 1..N from setup order.
assert.deepEqual(
  [...playerNumbers({ players: [{ id: "replay-game-player-1" }, { id: "replay-game-player-2" }, { id: "replay-game-player-3" }] })],
  [["replay-game-player-1", 1], ["replay-game-player-2", 2], ["replay-game-player-3", 3]],
  "replay-shaped rosters renumber 1..N in array order"
);
for (const invalidGame of [null, undefined, "game", 42, {}, { players: null }, { players: "nope" }, { players: {} }]) {
  assert.equal(playerNumbers(invalidGame).size, 0, "guards return an empty Map");
}
// Corrupt rosters degrade to truthful positions: unusable entries never crash
// the derivation and never consume a position.
assert.deepEqual(
  [...playerNumbers({ players: [null, { id: "a" }, undefined, { id: "b" }] })],
  [["a", 2], ["b", 4]],
  "non-object player entries are skipped without consuming a position"
);
const numbersInput = { players: [{ id: "x" }, { id: "y" }] };
const numbersSnapshot = structuredClone(numbersInput);
const firstNumbers = playerNumbers(numbersInput);
const secondNumbers = playerNumbers(numbersInput);
assert.notEqual(firstNumbers, secondNumbers, "each call returns a fresh Map");
firstNumbers.set("x", 99);
assert.equal(playerNumbers(numbersInput).get("x"), 1, "mutating a returned Map never affects later derivations");
assert.deepEqual(numbersInput, numbersSnapshot, "the input game is never mutated");

console.log("Roster tests passed: limits, trimming, duplicate names/colors, IDs, and zero totals; preset-aware min/max validation with the exact preset messages and Custom/unknown fallback; createGame stores presetId only for known non-custom presets and rejects out-of-range preset rosters; blank, non-string, and missing titles store the empty string (no fallback substitution); playerNumbers derives positional 1..N badges with empty-Map guards, skipped corrupt entries, fresh Maps, and input immutability.");
