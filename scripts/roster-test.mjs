import assert from "node:assert/strict";
import {
  MAX_PLAYERS,
  PLAYER_COLORS,
  createGame,
  createSetupRows,
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

console.log("Roster tests passed: limits, trimming, duplicate names/colors, IDs, and zero totals; blank, non-string, and missing titles store the empty string (no fallback substitution).");
