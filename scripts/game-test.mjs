import assert from "node:assert/strict";
import { createGame } from "../src/roster.js";
import { applyScoreChange } from "../src/score.js";
import { finishGame, GAME_ERROR_CODES } from "../src/game.js";

// finishGame guards: missing/invalid games report "missing-game" and never throw
assert.deepEqual(finishGame({ game: null }), { game: null, error: "missing-game" });
assert.deepEqual(finishGame({ game: undefined }), { game: null, error: "missing-game" });
assert.deepEqual(finishGame({}), { game: null, error: "missing-game" });
assert.deepEqual(finishGame(), { game: null, error: "missing-game" });
assert.deepEqual(finishGame({ game: "not-a-game" }), { game: null, error: "missing-game" });
assert.deepEqual(finishGame({ game: 42 }), { game: null, error: "missing-game" });
assert.deepEqual(finishGame({ game: [] }), { game: null, error: "missing-game" });
assert.deepEqual(finishGame({ game: { id: "no-players" } }), { game: null, error: "missing-game" });
assert.deepEqual(finishGame({ game: { id: "bad-players", players: "nope" } }), { game: null, error: "missing-game" });

// finishGame guards: any non-active status reports "already-finished"
assert.deepEqual(
  finishGame({ game: { id: "done", status: "finished", players: [{ id: "p-1" }] } }),
  { game: null, error: "already-finished" }
);
assert.deepEqual(
  finishGame({ game: { id: "odd", status: "something-else", players: [] } }),
  { game: null, error: "already-finished" }
);
assert.deepEqual(
  finishGame({ game: { id: "statusless", players: [] } }),
  { game: null, error: "already-finished" }
);

// finishGame: a fresh zero-score game finishes with only the status changed
const { game: freshGame } = createGame({
  title: "Fresh finish",
  rows: [
    { id: "row-1", name: "Alex", color: "blue" },
    { id: "row-2", name: "Sam", color: "red" }
  ],
  now: new Date("2026-10-12T10:00:00.000Z"),
  idSeed: "finish-fresh"
});
const freshResult = finishGame({ game: freshGame });
assert.equal(freshResult.error, null);
assert.equal(freshResult.game.status, "finished");
assert.equal(freshResult.game.id, freshGame.id);
assert.equal(freshResult.game.title, "Fresh finish");
assert.equal(freshResult.game.createdAt, freshGame.createdAt);
assert.deepEqual(freshResult.game.players, freshGame.players);

// finishGame never mutates the input and adds no fields (no finishedAt, no ranks)
const freshSnapshot = structuredClone(freshGame);
finishGame({ game: freshGame, now: new Date("2026-10-12T23:59:00.000Z") });
assert.deepEqual(freshGame, freshSnapshot, "finishGame must never mutate the input game");

const finishedKeys = Object.keys(freshResult.game).sort();
const originalKeys = Object.keys(freshGame).sort();
assert.deepEqual(finishedKeys, originalKeys, "finishing must not add or remove game fields");
assert.ok(!("finishedAt" in freshResult.game), "no finishedAt field may be stored");
assert.ok(freshResult.game.players.every((player) => !("rank" in player)), "no rank fields may be stored");
assert.ok(!("rank" in freshResult.game), "the game must not gain a rank field");

// finishGame preserves players, totals, and the full change log of a scored game
const { game: scoredGame } = createGame({
  title: "Scored finish",
  rows: [
    { id: "row-1", name: "Alex", color: "blue" },
    { id: "row-2", name: "Sam", color: "red" },
    { id: "row-3", name: "Jamie", color: "green" }
  ],
  now: new Date("2026-10-12T11:00:00.000Z"),
  idSeed: "finish-scored"
});
const firstChange = applyScoreChange({ game: scoredGame, playerId: scoredGame.players[0].id, amount: 10 });
const secondChange = applyScoreChange({ game: firstChange.game, playerId: firstChange.game.players[1].id, amount: -3 });
const scoredResult = finishGame({ game: secondChange.game });
assert.equal(scoredResult.error, null);
assert.equal(scoredResult.game.status, "finished");
assert.deepEqual(scoredResult.game.players, secondChange.game.players, "totals and roster must be untouched");
assert.deepEqual(scoredResult.game.changes, secondChange.game.changes, "the change log must be preserved");
assert.equal(scoredResult.game.changes.length, 2);
assert.deepEqual(
  scoredResult.game.players.map((player) => player.order),
  [0, 1, 2],
  "player order must be untouched"
);

const scoredSnapshot = structuredClone(secondChange.game);
finishGame({ game: secondChange.game });
assert.deepEqual(secondChange.game, scoredSnapshot, "a scored game must never be mutated by finishGame");

// finishGame: double-finish is rejected as already-finished
const doubleFinish = finishGame({ game: scoredResult.game });
assert.deepEqual(doubleFinish, { game: null, error: "already-finished" });

// finishGame: a 20-player scored game finishes with every player preserved
const twentyRows = Array.from({ length: 20 }, (_, index) => ({
  id: `row-${index + 1}`,
  name: `Player ${index + 1}`,
  color: ["blue", "red", "yellow", "green", "orange", "white", "black"][index % 7]
}));
const { game: twentyGame } = createGame({
  title: "Big table finish",
  rows: twentyRows,
  now: new Date("2026-10-12T12:00:00.000Z"),
  idSeed: "finish-twenty"
});
let twentyCurrent = twentyGame;
for (let index = 0; index < 20; index += 1) {
  const applied = applyScoreChange({ game: twentyCurrent, playerId: twentyCurrent.players[index].id, amount: index + 1 });
  twentyCurrent = applied.game;
}
const twentyResult = finishGame({ game: twentyCurrent });
assert.equal(twentyResult.error, null);
assert.equal(twentyResult.game.status, "finished");
assert.equal(twentyResult.game.players.length, 20);
assert.deepEqual(twentyResult.game.players, twentyCurrent.players, "all 20 players must survive finishing unchanged");
assert.equal(twentyResult.game.changes.length, 20);

// the error codes live in a local list, separate from SCORE_ERROR_CODES
assert.deepEqual(GAME_ERROR_CODES, ["missing-game", "already-finished"]);

console.log("Game tests passed: finishGame guards (missing-game/already-finished), non-mutating transition, status-only change with no new fields, preserved players/change log/order, double-finish rejection, fresh and 20-player games, and a local error-code list.");

