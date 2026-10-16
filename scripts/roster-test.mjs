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

console.log("Roster tests passed: limits, trimming, duplicate names/colors, IDs, and zero totals; blank, non-string, and missing titles store the empty string (no fallback substitution); playerNumbers derives positional 1..N badges with empty-Map guards, skipped corrupt entries, fresh Maps, and input immutability.");
