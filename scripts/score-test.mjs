import assert from "node:assert/strict";
import { createGame } from "../src/roster.js";
import {
  MAX_SCORE_ABS,
  RECENT_ENTRIES_LIMIT,
  SCORE_ERROR_CODES,
  applyScoreChange,
  isPlainIntegerText,
  isPlainScoreDraft,
  parseScoreAmount,
  recentScoreChanges,
  undoLastScoreChange
} from "../src/score.js";

assert.equal(MAX_SCORE_ABS, 1_000_000);
assert.equal(RECENT_ENTRIES_LIMIT, 8);

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

// parseScoreAmount: accepted signed integers
// The plain-format gate (restrict-score-entry-input) supersedes the old
// semantic-parse decision: only plain signed integer text saves now.
assert.deepEqual(parseScoreAmount("10"), { amount: 10 });
assert.deepEqual(parseScoreAmount(" -3 "), { amount: -3 });
assert.deepEqual(parseScoreAmount("+7"), { amount: 7 });
assert.deepEqual(parseScoreAmount("+10"), { amount: 10 });
assert.deepEqual(parseScoreAmount("1000000"), { amount: 1000000 });
assert.deepEqual(parseScoreAmount("-1000000"), { amount: -1000000 });
assert.deepEqual(parseScoreAmount("1e3"), { error: "not-a-number" });

// parseScoreAmount: exact-integer text that is not plain still parses to an
// in-range nonzero integer, so the new final gate is what rejects it.
assert.deepEqual(parseScoreAmount("0x10"), { error: "not-a-number" });
assert.deepEqual(parseScoreAmount("10."), { error: "not-a-number" });

// isPlainIntegerText: the save-side plain-format contract
assert.equal(isPlainIntegerText("10"), true);
assert.equal(isPlainIntegerText("+7"), true);
assert.equal(isPlainIntegerText(" -3 "), true);
assert.equal(isPlainIntegerText("-0"), true);
assert.equal(isPlainIntegerText("0"), true);
assert.equal(isPlainIntegerText("1e3"), false);
assert.equal(isPlainIntegerText("1e-3"), false);
assert.equal(isPlainIntegerText("10."), false);
assert.equal(isPlainIntegerText("0x10"), false);
assert.equal(isPlainIntegerText(""), false);
assert.equal(isPlainIntegerText("-"), false);
assert.equal(isPlainIntegerText("abc"), false);
assert.equal(isPlainIntegerText("1 2"), false);
assert.equal(isPlainIntegerText("1,000"), false);

// isPlainScoreDraft: the entry-guard draft pattern — empty, a lone sign, and
// a transient decimal stay typable so the save-side errors still apply.
assert.equal(isPlainScoreDraft(""), true);
assert.equal(isPlainScoreDraft("-"), true);
assert.equal(isPlainScoreDraft("+"), true);
assert.equal(isPlainScoreDraft("12"), true);
assert.equal(isPlainScoreDraft("-12"), true);
assert.equal(isPlainScoreDraft("+10"), true);
assert.equal(isPlainScoreDraft("2.5"), true);
assert.equal(isPlainScoreDraft("12."), true);
assert.equal(isPlainScoreDraft(".5"), true);
assert.equal(isPlainScoreDraft("1e3"), false);
assert.equal(isPlainScoreDraft("1e"), false);
assert.equal(isPlainScoreDraft("abc"), false);
assert.equal(isPlainScoreDraft("1 2"), false);
assert.equal(isPlainScoreDraft("1,000"), false);
assert.equal(isPlainScoreDraft("--3"), false);

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

// applyScoreChange: the injectable clock stamps each new change with an `at`
// ISO string so per-entry relative times survive reloads (track-game-activity)
const stampedNow = new Date("2026-10-15T12:30:45.123Z");
const stamped = applyScoreChange({ game, playerId: game.players[0].id, amount: 4, now: stampedNow });
assert.equal(stamped.error, null);
assert.equal(stamped.game.changes[0].at, "2026-10-15T12:30:45.123Z");
assert.equal(typeof stamped.game.changes[0].at, "string");
assert.notEqual(new Date(stamped.game.changes[0].at).getTime(), Number.NaN, "`at` must parse as an instant");
// Two entries from the same injected `now` share that stamp; the default
// clock stamps approximately the current time.
const stampedTwice = applyScoreChange({ game: stamped.game, playerId: game.players[1].id, amount: 2, now: stampedNow });
assert.equal(stampedTwice.game.changes[1].at, "2026-10-15T12:30:45.123Z");
const defaultClock = applyScoreChange({ game: stampedTwice.game, playerId: game.players[0].id, amount: 1 });
assert.equal(Number.isNaN(new Date(defaultClock.game.changes[2].at).getTime()), false);
assert.ok(
  Math.abs(new Date(defaultClock.game.changes[2].at).getTime() - Date.now()) < 60_000,
  "the default clock must stamp approximately now"
);
// Rejected changes still create no entry (and so no `at`).
assert.equal(applyScoreChange({ game: stamped.game, playerId: game.players[0].id, amount: 0, now: stampedNow }).error, "zero");
assert.equal(stamped.game.changes.length, 1);

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

// undoLastScoreChange: error code is registered
assert.ok(SCORE_ERROR_CODES.includes("nothing-to-undo"));

// undoLastScoreChange: nothing to undo for missing/empty/non-array logs
assert.deepEqual(undoLastScoreChange({ game: null }), { game: null, undone: null, error: "nothing-to-undo" });
assert.deepEqual(undoLastScoreChange({ game: undefined }), { game: null, undone: null, error: "nothing-to-undo" });
assert.deepEqual(undoLastScoreChange({ game }), { game: null, undone: null, error: "nothing-to-undo" });
assert.deepEqual(undoLastScoreChange({ game: { ...game, changes: [] } }), { game: null, undone: null, error: "nothing-to-undo" });
assert.deepEqual(undoLastScoreChange({ game: { ...game, changes: "not-a-list" } }), { game: null, undone: null, error: "nothing-to-undo" });

// undoLastScoreChange: reverses only the latest change and its recipient
// samScored.game: log [+10 Alex, -3 Alex, +5 Sam], totals Alex 7, Sam 5
const undoSnapshot = structuredClone(samScored.game);
const undoLatest = undoLastScoreChange({ game: samScored.game });
assert.equal(undoLatest.error, null);
assert.deepEqual(undoLatest.undone, samScored.game.changes[samScored.game.changes.length - 1]);
assert.equal(undoLatest.undone.playerId, game.players[1].id);
assert.equal(undoLatest.undone.amount, 5);
assert.equal(undoLatest.game.players[1].total, 0, "the latest recipient's total must be restored");
assert.equal(undoLatest.game.players[0].total, 7, "earlier recipients must be untouched");
assert.equal(undoLatest.game.changes.length, 2);
assert.deepEqual(undoLatest.game.changes, samScored.game.changes.slice(0, -1));
assert.equal(undoLatest.game.status, "active", "undo must not touch game.status");
assert.deepEqual(Object.keys(undoLatest.game).sort(), Object.keys(samScored.game).sort());
assert.deepEqual(samScored.game, undoSnapshot, "the input game must never be mutated");

// undoLastScoreChange: no rank fields are written anywhere
assert.ok(undoLatest.game.players.every((player) => !("rank" in player)));
for (const change of undoLatest.game.changes) {
  // Superseded by track-game-activity: new change entries carry an `at` ISO
  // stamp from the injectable clock, so the persisted key list gains "at".
  assert.deepEqual(Object.keys(change).sort(), ["amount", "at", "id", "playerId"]);
}

// undoLastScoreChange: repeated undo drains the log in reverse order, then reports nothing-to-undo
const undoTwo = undoLastScoreChange({ game: undoLatest.game });
assert.equal(undoTwo.error, null);
assert.equal(undoTwo.undone.amount, -3);
assert.equal(undoTwo.undone.playerId, game.players[0].id);
assert.equal(undoTwo.game.players[0].total, 10, "undoing -3 restores Alex to 10");
assert.equal(undoTwo.game.players[1].total, 0);
assert.equal(undoTwo.game.changes.length, 1);

const undoThree = undoLastScoreChange({ game: undoTwo.game });
assert.equal(undoThree.error, null);
assert.equal(undoThree.undone.amount, 10);
assert.equal(undoThree.game.players[0].total, 0, "draining the log returns Alex to 0");
assert.equal(undoThree.game.changes.length, 0);

const undoDrained = undoLastScoreChange({ game: undoThree.game });
assert.deepEqual(undoDrained, { game: null, undone: null, error: "nothing-to-undo" });
assert.equal(undoThree.game.changes.length, 0);

// undoLastScoreChange: a negative change is reversed by subtracting its amount
// negativeTotal.game: Sam at -10 with [+10, -3, +5, -5, -10] logged
const undoNegative = undoLastScoreChange({ game: negativeTotal.game });
assert.equal(undoNegative.error, null);
assert.equal(undoNegative.undone.amount, -10);
assert.equal(undoNegative.game.players[1].total, 0, "undoing -10 restores Sam to the prior total 0");
assert.equal(undoNegative.game.players[0].total, 7);

// undoLastScoreChange: unknown playerId in the log is rejected defensively
const unknownChange = { id: "change-x", playerId: "ghost-player", amount: 5 };
const unknownLogGame = { ...game, changes: [unknownChange] };
assert.equal(undoLastScoreChange({ game: unknownLogGame }).error, "unknown-player");
assert.deepEqual(unknownLogGame.changes, [unknownChange]);

// undoLastScoreChange: unsafe restored totals are rejected defensively
const unsafeUndoGame = {
  ...samScored.game,
  changes: [{ id: "change-unsafe", playerId: game.players[0].id, amount: -1 }],
  players: game.players.map((player) =>
    player.id === game.players[0].id ? { ...player, total: Number.MAX_SAFE_INTEGER } : player
  )
};
assert.equal(undoLastScoreChange({ game: unsafeUndoGame }).error, "not-safe");

// recentScoreChanges: newest-first { change, player } pairs over the stored log
// (track-game-activity). Player ids come from the seeded createGame above.
const alexId = game.players[0].id;
const samId = game.players[1].id;
const recentLogGame = {
  ...game,
  changes: [
    { id: "c-1", playerId: alexId, amount: 1, at: "2026-10-01T10:00:00.000Z" },
    { id: "c-2", playerId: samId, amount: -2, at: "2026-10-02T10:00:00.000Z" },
    { id: "c-3", playerId: "ghost-player", amount: 9, at: "2026-10-03T10:00:00.000Z" },
    { id: "c-4", playerId: alexId, amount: 3, at: "2026-10-04T10:00:00.000Z" }
  ]
};
const recentLogSnapshot = structuredClone(recentLogGame);
const recent = recentScoreChanges({ game: recentLogGame });
assert.deepEqual(
  recent.map((entry) => entry.change.id),
  ["c-4", "c-2", "c-1"],
  "entries render newest first and unresolvable players are skipped"
);
assert.deepEqual(
  recent.map((entry) => entry.player.id),
  [alexId, samId, alexId],
  "each entry carries its resolved player"
);
assert.equal(recent[0].change.amount, 3);
assert.deepEqual(recentLogGame, recentLogSnapshot, "the input game must never be mutated");
assert.notEqual(recent, recentLogGame.changes, "the returned list must be a fresh array");

// recentScoreChanges: the cap keeps the newest entries and skips do not count
// toward it; the limit is overridable.
const capLog = Array.from({ length: 12 }, (_, index) => ({
  id: `cap-${index + 1}`,
  playerId: alexId,
  amount: index + 1,
  at: `2026-10-${String((index % 28) + 1).padStart(2, "0")}T10:00:00.000Z`
}));
const cappedGame = { ...game, changes: [...capLog, { id: "cap-ghost", playerId: "ghost", amount: 5 }] };
const capped = recentScoreChanges({ game: cappedGame });
assert.equal(capped.length, RECENT_ENTRIES_LIMIT);
assert.deepEqual(capped.map((entry) => entry.change.id), capLog.slice(4).map((change) => change.id).reverse());
const smaller = recentScoreChanges({ game: cappedGame, limit: 2 });
assert.deepEqual(smaller.map((entry) => entry.change.id), ["cap-12", "cap-11"]);
const skipDoesNotConsumeCap = recentScoreChanges({ game: recentLogGame, limit: 3 });
assert.equal(skipDoesNotConsumeCap.length, 3, "a skipped ghost entry must not consume a cap slot");

// recentScoreChanges: empty guards
assert.deepEqual(recentScoreChanges({ game: null }), []);
assert.deepEqual(recentScoreChanges({ game: undefined }), []);
assert.deepEqual(recentScoreChanges({}), []);
assert.deepEqual(recentScoreChanges({ game }), [], "a fresh game has no change log");
assert.deepEqual(recentScoreChanges({ game: { ...game, changes: [] } }), []);
assert.deepEqual(recentScoreChanges({ game: { ...game, changes: "not-a-list" } }), []);
assert.deepEqual(recentScoreChanges({ game: { ...game, changes: [], players: "nope" } }), []);

// recentScoreChanges: entries produced by applyScoreChange resolve naturally,
// including the per-change `at` stamps
const appliedRecent = applyScoreChange({
  game: stampedTwice.game,
  playerId: samId,
  amount: 7,
  now: new Date("2026-10-15T14:00:00.000Z")
});
const appliedRecentEntries = recentScoreChanges({ game: appliedRecent.game });
assert.equal(appliedRecentEntries.length, appliedRecent.game.changes.length);
assert.equal(appliedRecentEntries[0].change.amount, 7);
assert.equal(appliedRecentEntries[0].player.id, samId);
assert.equal(appliedRecentEntries[0].change.at, "2026-10-15T14:00:00.000Z");

console.log("Score tests passed: parse error codes, plain-integer-only gate (1e3/0x10/10. rejected), draft-pattern predicates, signed bounds, zero rejection, per-change `at` ISO stamps from the injectable clock, change log, safe-integer guard, immutability, latest-change undo, and recentScoreChanges (newest-first pairs, cap 8, player resolution, empty guards).");
