import assert from "node:assert/strict";
import { createGame } from "../src/roster.js";
import { MAX_SCORE_ABS, applyScoreChange, parseScoreAmount } from "../src/score.js";

assert.equal(MAX_SCORE_ABS, 1_000_000);

// parseScoreAmount: empty values
assert.deepEqual(parseScoreAmount(""), { error: "empty" });
assert.deepEqual(parseScoreAmount("   "), { error: "empty" });
assert.deepEqual(parseScoreAmount(null), { error: "empty" });
assert.deepEqual(parseScoreAmount(undefined), { error: "empty" });

// parseScoreAmount: non-numbers
assert.deepEqual(parseScoreAmount("abc"), { error: "not-a-number" });
assert.deepEqual(parseScoreAmount("1_000"), { error: "not-a-number" });
assert.deepEqual(parseScoreAmount("Infinity"), { error: "not-a-number" });
assert.deepEqual(parseScoreAmount("NaN"), { error: "not-a-number" });

// parseScoreAmount: decimals
assert.deepEqual(parseScoreAmount("2.5"), { error: "not-integer" });
assert.deepEqual(parseScoreAmount("-0.5"), { error: "not-integer" });
assert.deepEqual(parseScoreAmount("1e-3"), { error: "not-integer" });

// parseScoreAmount: zero entries
assert.deepEqual(parseScoreAmount("0"), { error: "zero" });
assert.deepEqual(parseScoreAmount("-0"), { error: "zero" });
assert.deepEqual(parseScoreAmount("0.0"), { error: "zero" });

// parseScoreAmount: out-of-range magnitudes
assert.deepEqual(parseScoreAmount("1000001"), { error: "out-of-range" });
assert.deepEqual(parseScoreAmount("-1000001"), { error: "out-of-range" });
assert.deepEqual(parseScoreAmount("1e30"), { error: "out-of-range" });

// parseScoreAmount: accepted signed integers, including semantic forms
assert.deepEqual(parseScoreAmount("10"), { amount: 10 });
assert.deepEqual(parseScoreAmount(" -3 "), { amount: -3 });
assert.deepEqual(parseScoreAmount("+7"), { amount: 7 });
assert.deepEqual(parseScoreAmount("1000000"), { amount: 1000000 });
assert.deepEqual(parseScoreAmount("-1000000"), { amount: -1000000 });
assert.deepEqual(parseScoreAmount("1e3"), { amount: 1000 });

const { game } = createGame({
  title: "Score test",
  rows: [
    { id: "row-1", name: "Alex", color: "blue" },
    { id: "row-2", name: "Sam", color: "red" }
  ],
  now: new Date("2026-10-12T10:00:00.000Z"),
  idSeed: "score"
});
assert.equal(game.players[0].total, 0);
assert.equal(game.changes, undefined);

// applyScoreChange: success appends to the change log and updates one total
const first = applyScoreChange({ game, playerId: game.players[0].id, amount: 10 });
assert.equal(first.error, null);
assert.equal(first.game.players[0].total, 10);
assert.equal(first.game.players[1].total, 0);
assert.equal(first.game.changes.length, 1);
assert.equal(first.game.changes[0].playerId, game.players[0].id);
assert.equal(first.game.changes[0].amount, 10);
assert.equal(typeof first.game.changes[0].id, "string");
assert.notEqual(first.game.changes[0].id, "");

// applyScoreChange never mutates the input game object
assert.equal(game.players[0].total, 0);
assert.equal(game.changes, undefined);

// applyScoreChange: +10 then -3 lands on total 7
const second = applyScoreChange({ game: first.game, playerId: game.players[0].id, amount: -3 });
assert.equal(second.error, null);
assert.equal(second.game.players[0].total, 7);
assert.equal(second.game.changes.length, 2);

// applyScoreChange: other players are unaffected
const samScored = applyScoreChange({ game: second.game, playerId: game.players[1].id, amount: 5 });
assert.equal(samScored.game.players[1].total, 5);
assert.equal(samScored.game.players[0].total, 7);
assert.equal(samScored.game.changes.length, 3);

// applyScoreChange: change ids stay unique across entries
assert.equal(new Set(samScored.game.changes.map((change) => change.id)).size, 3);

// applyScoreChange: negative totals are valid
const backToZero = applyScoreChange({ game: samScored.game, playerId: game.players[1].id, amount: -5 });
assert.equal(backToZero.game.players[1].total, 0);
const negativeTotal = applyScoreChange({ game: backToZero.game, playerId: game.players[1].id, amount: -10 });
assert.equal(negativeTotal.error, null);
assert.equal(negativeTotal.game.players[1].total, -10);

// applyScoreChange: boundary amounts are accepted
const maxBoundary = applyScoreChange({ game, playerId: game.players[1].id, amount: MAX_SCORE_ABS });
assert.equal(maxBoundary.error, null);
assert.equal(maxBoundary.game.players[1].total, 1000000);
const minBoundary = applyScoreChange({ game: maxBoundary.game, playerId: game.players[1].id, amount: -MAX_SCORE_ABS });
assert.equal(minBoundary.error, null);
assert.equal(minBoundary.game.players[1].total, 0);

// applyScoreChange: rejected changes
assert.equal(applyScoreChange({ game, playerId: "missing-player", amount: 5 }).error, "unknown-player");
assert.equal(applyScoreChange({ game: null, playerId: game.players[0].id, amount: 5 }).error, "unknown-player");
assert.equal(applyScoreChange({ game, playerId: game.players[0].id, amount: 2.5 }).error, "not-integer");
assert.equal(applyScoreChange({ game, playerId: game.players[0].id, amount: Number.NaN }).error, "not-integer");
assert.equal(applyScoreChange({ game, playerId: game.players[0].id, amount: 0 }).error, "zero");
assert.equal(applyScoreChange({ game, playerId: game.players[0].id, amount: 1000001 }).error, "out-of-range");
assert.equal(applyScoreChange({ game, playerId: game.players[0].id, amount: -1000001 }).error, "out-of-range");

// applyScoreChange: defensive safe-integer guard
const unsafeGame = {
  ...game,
  players: game.players.map((player) =>
    player.id === game.players[0].id ? { ...player, total: Number.MAX_SAFE_INTEGER } : player
  )
};
assert.equal(applyScoreChange({ game: unsafeGame, playerId: game.players[0].id, amount: 1 }).error, "not-safe");
const safeBoundaryGame = {
  ...game,
  players: game.players.map((player) =>
    player.id === game.players[0].id ? { ...player, total: Number.MAX_SAFE_INTEGER - 5 } : player
  )
};
const safeBoundary = applyScoreChange({ game: safeBoundaryGame, playerId: game.players[0].id, amount: 5 });
assert.equal(safeBoundary.error, null);
assert.equal(safeBoundary.game.players[0].total, Number.MAX_SAFE_INTEGER);

// applyScoreChange: rejected input leaves the game object unchanged
const snapshot = structuredClone(second.game);
const rejected = applyScoreChange({ game: second.game, playerId: game.players[0].id, amount: 0 });
assert.equal(rejected.game, null);
assert.deepEqual(second.game, snapshot);

console.log("Score tests passed: parse error codes, signed bounds, zero rejection, change log, safe-integer guard, and immutability.");
