import assert from "node:assert/strict";
import { createGame } from "../src/roster.js";
import { applyScoreChange } from "../src/score.js";
import { finishGame, replayGame, renameGame, displayGameTitle, formatRelativeTimestamp, GAME_ERROR_CODES } from "../src/game.js";

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

// replayGame guards: missing/invalid games report "missing-game" and never throw
assert.deepEqual(replayGame({ game: null }), { game: null, error: "missing-game" });
assert.deepEqual(replayGame({ game: undefined }), { game: null, error: "missing-game" });
assert.deepEqual(replayGame({}), { game: null, error: "missing-game" });
assert.deepEqual(replayGame(), { game: null, error: "missing-game" });
assert.deepEqual(replayGame({ game: "not-a-game" }), { game: null, error: "missing-game" });
assert.deepEqual(replayGame({ game: 42 }), { game: null, error: "missing-game" });
assert.deepEqual(replayGame({ game: [] }), { game: null, error: "missing-game" });
assert.deepEqual(replayGame({ game: { id: "no-players" } }), { game: null, error: "missing-game" });
assert.deepEqual(replayGame({ game: { id: "bad-players", players: "nope" } }), { game: null, error: "missing-game" });

// replayGame guards: only finished games can be replayed
assert.deepEqual(
  replayGame({ game: { id: "running", status: "active", players: [{ id: "p-1", name: "Alex", color: "blue" }] } }),
  { game: null, error: "not-finished" }
);
assert.deepEqual(
  replayGame({ game: { id: "statusless", players: [{ id: "p-1", name: "Alex", color: "blue" }] } }),
  { game: null, error: "not-finished" }
);
assert.deepEqual(
  replayGame({ game: { id: "odd", status: "something-else", players: [] } }),
  { game: null, error: "not-finished" }
);

// Superseded by name-game-titles: replays no longer copy the title — they
// always start untitled (title: "") so the dashboard shows the auto-label.
const replayNow = new Date("2026-10-12T20:00:00.000Z");
const replayResult = replayGame({ game: scoredResult.game, now: replayNow });
assert.equal(replayResult.error, null);
const replayed = replayResult.game;
assert.equal(replayed.status, "active", "the replay must be an active game");
assert.equal(replayed.title, "", "the replay must start untitled, never copying the original title");
assert.notEqual(replayed.id, scoredResult.game.id, "the replay needs a new game id");
assert.ok(replayed.id.startsWith("replay-game-"), "the replay id must come from the replay-game seed");
assert.ok(!("changes" in replayed), "the replay must not copy the change log");
assert.ok(!("updatedAt" in replayed), "the replay must not carry any updatedAt");
assert.equal(replayed.createdAt, replayNow.toISOString(), "the replay stamps its own fresh creation time");
assert.equal(replayed.players.length, 3);
assert.deepEqual(
  replayed.players.map((player) => player.id),
  ["replay-game-player-1", "replay-game-player-2", "replay-game-player-3"],
  "player ids must be structurally new via the replay-game seed"
);
assert.deepEqual(
  replayed.players.map((player) => player.total),
  [0, 0, 0],
  "every replay total must restart at zero"
);
assert.deepEqual(
  replayed.players.map((player) => player.name),
  ["Alex", "Sam", "Jamie"],
  "names must copy per row"
);
assert.deepEqual(
  replayed.players.map((player) => player.color),
  ["blue", "red", "green"],
  "colors must copy per row"
);
assert.deepEqual(
  replayed.players.map((player) => player.marker),
  ["1", "2", "3"],
  "markers must copy per row"
);
assert.deepEqual(
  replayed.players.map((player) => player.order),
  [0, 1, 2],
  "creation order must copy per row"
);

// replayGame never mutates the input finished game
const finishedSnapshot = structuredClone(scoredResult.game);
replayGame({ game: scoredResult.game, now: replayNow });
assert.deepEqual(scoredResult.game, finishedSnapshot, "replayGame must never mutate the input game");

// replayGame: atypical but valid stored marker/order values are restored
// literally; invalid values fall back to the regenerated ones
const atypicalGame = {
  id: "active-game-1728600000000",
  title: "Atypical stored data",
  status: "finished",
  createdAt: "2026-10-12T09:00:00.000Z",
  players: [
    { id: "active-game-player-1", name: "Ada", color: "blue", marker: "7", order: 3, total: 5 },
    { id: "active-game-player-2", name: "Bo", color: "red", marker: 9, order: "first", total: -2 }
  ],
  changes: [
    { id: "change-1", playerId: "active-game-player-1", amount: 5 },
    { id: "change-2", playerId: "active-game-player-2", amount: -2 }
  ]
};
const atypicalReplay = replayGame({ game: atypicalGame, now: replayNow });
assert.equal(atypicalReplay.error, null);
assert.equal(atypicalReplay.game.players[0].marker, "7", "a nonempty-string marker must be restored");
assert.equal(atypicalReplay.game.players[0].order, 3, "an integer order must be restored");
assert.equal(atypicalReplay.game.players[1].marker, "2", "a non-string marker falls back to the regenerated marker");
assert.equal(atypicalReplay.game.players[1].order, 1, "a non-integer order falls back to the regenerated order");
assert.deepEqual(atypicalReplay.game.players.map((player) => player.total), [0, 0]);

// replayGame: the stored title never influences the replay — a non-string
// title (or any title) is dropped and the replay starts untitled
const untitledReplay = replayGame({
  game: { id: "odd-title", status: "finished", title: 42, players: atypicalGame.players },
  now: replayNow
});
assert.equal(untitledReplay.error, null);
assert.equal(untitledReplay.game.title, "", "a non-string title must not reach the replayed game");
const titledReplaySource = { ...atypicalGame, title: "Original name" };
const titledReplay = replayGame({ game: titledReplaySource, now: replayNow });
assert.equal(titledReplay.error, null);
assert.equal(titledReplay.game.title, "", "a stored title must not be copied into the replay");

// replayGame guards: roster-validation failures report "invalid-roster"
const invalidRosterCases = [
  ["a blank name", [{ name: "", color: "blue" }, { name: "Bo", color: "red" }]],
  ["an overlong name", [{ name: "x".repeat(41), color: "blue" }, { name: "Bo", color: "red" }]],
  ["an unknown color", [{ name: "Ada", color: "chartreuse" }, { name: "Bo", color: "red" }]],
  ["a missing color", [{ name: "Ada" }, { name: "Bo", color: "red" }]],
  ["a non-string name", [{ name: 42, color: "blue" }, { name: "Bo", color: "red" }]],
  ["a null player entry", [null, { name: "Bo", color: "red" }]],
  ["a single player", [{ name: "Ada", color: "blue" }]],
  ["twenty-one players", Array.from({ length: 21 }, (_, index) => ({ name: `P${index + 1}`, color: "blue" }))]
];
for (const [label, players] of invalidRosterCases) {
  assert.deepEqual(
    replayGame({ game: { id: "corrupt", status: "finished", title: "Corrupt", players }, now: replayNow }),
    { game: null, error: "invalid-roster" },
    `replaying ${label} must be refused as invalid-roster`
  );
}

// replayGame: a 20-player scored game replays with the whole table copied
const twentyFinished = finishGame({ game: twentyCurrent });
const twentyReplay = replayGame({ game: twentyFinished.game, now: replayNow });
assert.equal(twentyReplay.error, null);
assert.equal(twentyReplay.game.players.length, 20);
assert.equal(twentyReplay.game.title, "", "the 20-player replay also starts untitled");
assert.notEqual(twentyReplay.game.id, twentyFinished.game.id);
assert.ok(twentyReplay.game.id.startsWith("replay-game-"));
assert.ok(!("changes" in twentyReplay.game), "the 20-player replay must not copy the change log");
assert.deepEqual(
  twentyReplay.game.players.map((player) => player.name),
  twentyFinished.game.players.map((player) => player.name),
  "all 20 names must copy in order"
);
assert.deepEqual(
  twentyReplay.game.players.map((player) => player.color),
  twentyFinished.game.players.map((player) => player.color),
  "all 20 colors must copy in order"
);
assert.ok(twentyReplay.game.players.every((player) => player.total === 0), "all 20 replay totals must be zero");
assert.ok(twentyReplay.game.players.every((player) => player.id.startsWith("replay-game-player-")));

// renameGame guards: missing/invalid games report "missing-game" and never throw
assert.deepEqual(renameGame({ game: null, title: "Any" }), { game: null, error: "missing-game" });
assert.deepEqual(renameGame({ game: undefined, title: "Any" }), { game: null, error: "missing-game" });
assert.deepEqual(renameGame({}, {}), { game: null, error: "missing-game" });
assert.deepEqual(renameGame(), { game: null, error: "missing-game" });
assert.deepEqual(renameGame({ game: "not-a-game", title: "Any" }), { game: null, error: "missing-game" });
assert.deepEqual(renameGame({ game: 42, title: "Any" }), { game: null, error: "missing-game" });
assert.deepEqual(renameGame({ game: [], title: "Any" }), { game: null, error: "missing-game" });
assert.deepEqual(renameGame({ game: { id: "no-players" }, title: "Any" }), { game: null, error: "missing-game" });
assert.deepEqual(renameGame({ game: { id: "bad-players", players: "nope" }, title: "Any" }), { game: null, error: "missing-game" });

// renameGame guards: any non-active status freezes the title as
// "already-finished" — checked before the title itself is validated
assert.deepEqual(
  renameGame({ game: { id: "done", status: "finished", title: "Frozen", players: [{ id: "p-1" }] }, title: "New" }),
  { game: null, error: "already-finished" }
);
assert.deepEqual(
  renameGame({ game: { id: "statusless", players: [{ id: "p-1" }] }, title: "" }),
  { game: null, error: "already-finished" },
  "the status guard runs before the title validation"
);
assert.deepEqual(
  renameGame({ game: { id: "odd", status: "something-else", players: [] }, title: 42 }),
  { game: null, error: "already-finished" }
);

// renameGame guards: a non-string title reports "invalid-title"
assert.deepEqual(
  renameGame({ game: { id: "g", status: "active", players: [] }, title: 42 }),
  { game: null, error: "invalid-title" }
);
assert.deepEqual(
  renameGame({ game: { id: "g", status: "active", players: [] }, title: null }),
  { game: null, error: "invalid-title" }
);
assert.deepEqual(
  renameGame({ game: { id: "g", status: "active", players: [] } }),
  { game: null, error: "invalid-title" }
);

// renameGame guards: a trimmed title over MAX_TITLE_LENGTH reports
// "title-too-long" while exactly 60 characters rename successfully
assert.deepEqual(
  renameGame({ game: { id: "g", status: "active", players: [] }, title: "x".repeat(61) }),
  { game: null, error: "title-too-long" }
);
assert.deepEqual(
  renameGame({ game: { id: "g", status: "active", players: [] }, title: `  ${"x".repeat(60)}  ` }),
  { game: { id: "g", status: "active", title: "x".repeat(60), players: [] }, error: null },
  "exactly 60 characters after trimming must be accepted"
);

// renameGame success: the trimmed title lands in a new game object, blank
// after trim stores "", and interior whitespace/casing stay verbatim
const renameNow = { id: "g", status: "active", title: "Old name", createdAt: "2026-10-12T10:00:00.000Z", players: [{ id: "p-1" }] };
const renameResult = renameGame({ game: renameNow, title: "  Catan Friday  " });
assert.deepEqual(renameResult, { game: { ...renameNow, title: "Catan Friday" }, error: null });
const blankRename = renameGame({ game: renameNow, title: "   " });
assert.deepEqual(blankRename, { game: { ...renameNow, title: "" }, error: null }, "blank-after-trim stores the empty title");
const interiorRename = renameGame({ game: renameNow, title: "  Friday   night  " });
assert.equal(interiorRename.game.title, "Friday   night", "interior whitespace is preserved verbatim");

// renameGame never mutates the input game and changes nothing else
const renameSnapshot = structuredClone(renameNow);
renameGame({ game: renameNow, title: "Mutating name" });
assert.deepEqual(renameNow, renameSnapshot, "renameGame must never mutate the input game");

// displayGameTitle: stored titles render verbatim (never re-trimmed/rewritten)
assert.equal(displayGameTitle({ title: "Catan Friday", createdAt: "2026-10-12T21:08:00.000Z" }), "Catan Friday");
assert.equal(displayGameTitle({ title: "  Padded  ", createdAt: "2026-10-12T21:08:00.000Z" }), "  Padded  ", "stored titles are never re-trimmed");
assert.equal(displayGameTitle({ title: "Game — 12 Oct, 21:08", createdAt: "2026-10-13T08:00:00.000Z" }), "Game — 12 Oct, 21:08", "a user title that collides with the label shape still renders verbatim");

// displayGameTitle: blank titles derive the deterministic auto-label from
// createdAt in local time (`Game — {d MMM, HH:mm}`, never stored)
assert.equal(
  displayGameTitle({ title: "", createdAt: new Date(2026, 9, 12, 21, 8).toISOString() }),
  "Game — 12 Oct, 21:08"
);
assert.equal(
  displayGameTitle({ title: "   ", createdAt: new Date(2026, 0, 3, 5, 7).toISOString() }),
  "Game — 3 Jan, 05:07",
  "single-digit days stay unpadded while hours and minutes are zero-padded"
);
assert.equal(
  displayGameTitle({ title: "", createdAt: new Date(2026, 11, 31, 0, 0).toISOString() }),
  "Game — 31 Dec, 00:00",
  "midnight uses the 24-hour 00:00 form"
);
assert.equal(
  displayGameTitle({ title: "Game night", createdAt: "not a date" }),
  "Game night",
  "a usable stored title wins over an unusable timestamp"
);

// displayGameTitle: unusable timestamps degrade to plain "Game"
assert.equal(displayGameTitle({ title: "", createdAt: "not a date" }), "Game");
assert.equal(displayGameTitle({ title: "", createdAt: 42 }), "Game");
assert.equal(displayGameTitle({ title: "", createdAt: null }), "Game");
assert.equal(displayGameTitle({ title: "" }), "Game");
assert.equal(displayGameTitle({}), "Game");
assert.equal(displayGameTitle(null), "Game");
assert.equal(displayGameTitle(undefined), "Game");
assert.equal(displayGameTitle({ title: 42, createdAt: new Date(2026, 9, 12, 21, 8).toISOString() }), "Game — 12 Oct, 21:08", "a non-string title is not a user title");

// displayGameTitle is stable and pure: same input, same output, no mutation
const labelGame = { title: "", createdAt: new Date(2026, 9, 12, 21, 8).toISOString() };
assert.equal(displayGameTitle(labelGame), displayGameTitle(labelGame));
assert.deepEqual(labelGame, { title: "", createdAt: new Date(2026, 9, 12, 21, 8).toISOString() });

// the error codes live in a local list, separate from SCORE_ERROR_CODES
assert.deepEqual(GAME_ERROR_CODES, ["missing-game", "already-finished", "not-finished", "invalid-roster", "invalid-title", "title-too-long"]);

// formatRelativeTimestamp: deterministic relative buckets anchored to an
// injectable `now` (track-game-activity). Stamps are built at exact offsets
// from `now`, so the assertions are timezone-independent.
const relativeNow = new Date("2026-10-15T12:00:00.000Z");
const stampAgo = (ms) => new Date(relativeNow.getTime() - ms).toISOString();
const stampAhead = (ms) => new Date(relativeNow.getTime() + ms).toISOString();

// < 1 minute — including exact-equality neighbors and clock skew
assert.equal(formatRelativeTimestamp(stampAgo(0), relativeNow), "just now");
assert.equal(formatRelativeTimestamp(stampAgo(1), relativeNow), "just now");
assert.equal(formatRelativeTimestamp(stampAgo(59_999), relativeNow), "just now", "59 999 ms is still inside the minute bucket");
assert.equal(formatRelativeTimestamp(stampAhead(1), relativeNow), "just now", "a future stamp (clock skew) is just now");
assert.equal(formatRelativeTimestamp(stampAhead(3_600_000), relativeNow), "just now", "any future skew stays just now");

// minutes: exactly 60 000 ms crosses into the minute bucket (floored)
assert.equal(formatRelativeTimestamp(stampAgo(60_000), relativeNow), "1m ago", "exactly 60 000 ms is 1m ago");
assert.equal(formatRelativeTimestamp(stampAgo(61_000), relativeNow), "1m ago");
assert.equal(formatRelativeTimestamp(stampAgo(10 * 60_000 + 5_000), relativeNow), "10m ago", "floored minutes with a safety margin");
assert.equal(formatRelativeTimestamp(stampAgo(59 * 60_000), relativeNow), "59m ago");
assert.equal(formatRelativeTimestamp(stampAgo(3_599_999), relativeNow), "59m ago", "the last millisecond under an hour stays minutes");

// hours
assert.equal(formatRelativeTimestamp(stampAgo(3_600_000), relativeNow), "1h ago", "exactly one hour");
assert.equal(formatRelativeTimestamp(stampAgo(2 * 3_600_000 + 30 * 60_000 + 5_000), relativeNow), "2h ago", "floored hours");
assert.equal(formatRelativeTimestamp(stampAgo(23 * 3_600_000 + 59 * 60_000 + 59_999), relativeNow), "23h ago");
assert.equal(formatRelativeTimestamp(stampAgo(86_399_999), relativeNow), "23h ago", "the last millisecond under a day stays hours");

// days
assert.equal(formatRelativeTimestamp(stampAgo(86_400_000), relativeNow), "1d ago", "exactly one day");
assert.equal(formatRelativeTimestamp(stampAgo(2 * 86_400_000 + 5_000), relativeNow), "2d ago", "floored days");
assert.equal(formatRelativeTimestamp(stampAgo(6 * 86_400_000 + 23 * 3_600_000 + 59 * 60_000 + 59_999), relativeNow), "6d ago");
assert.equal(formatRelativeTimestamp(stampAgo(7 * 86_400_000 - 1), relativeNow), "6d ago", "the last millisecond under a week stays days");

// ≥ 7 days — the absolute branch, identical to the title auto-label format
const STAMP_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function expectedAbsoluteStamp(iso) {
  const date = new Date(iso);
  return `${date.getDate()} ${STAMP_MONTHS[date.getMonth()]}, ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
const weekStamp = stampAgo(7 * 86_400_000);
assert.equal(formatRelativeTimestamp(weekStamp, relativeNow), expectedAbsoluteStamp(weekStamp), "exactly 7 days renders the absolute stamp");
const monthStamp = "2026-09-03T08:07:00.000Z";
assert.equal(formatRelativeTimestamp(monthStamp, relativeNow), expectedAbsoluteStamp(monthStamp), "a month-old stamp renders the absolute stamp");
assert.equal(
  formatRelativeTimestamp(monthStamp, relativeNow),
  displayGameTitle({ title: "", createdAt: monthStamp }).replace("Game — ", ""),
  "the absolute branch must equal the deterministic auto-label format"
);

// formatRelativeTimestamp: unusable input degrades to null so callers pick
// their own fallback
assert.equal(formatRelativeTimestamp(42, relativeNow), null);
assert.equal(formatRelativeTimestamp(null, relativeNow), null);
assert.equal(formatRelativeTimestamp(undefined, relativeNow), null);
assert.equal(formatRelativeTimestamp({}, relativeNow), null);
assert.equal(formatRelativeTimestamp("not a date", relativeNow), null);
assert.equal(formatRelativeTimestamp("", relativeNow), null);
assert.equal(formatRelativeTimestamp("2026-13-45T99:99:99Z", relativeNow), null);

// formatRelativeTimestamp is pure: same input, same output, no mutation
assert.equal(formatRelativeTimestamp(stampAgo(120_000), relativeNow), "2m ago");
assert.equal(formatRelativeTimestamp(stampAgo(120_000), relativeNow), "2m ago");

// applyScoreChange stamps entries with the injected clock so change entries
// are datable without any game-level timestamp (track-game-activity)
const { game: datableGame } = createGame({
  title: "Datable changes",
  rows: [
    { id: "row-1", name: "Alex", color: "blue" },
    { id: "row-2", name: "Sam", color: "red" }
  ],
  now: new Date("2026-10-12T10:00:00.000Z"),
  idSeed: "datable"
});
const datableApplied = applyScoreChange({
  game: datableGame,
  playerId: datableGame.players[0].id,
  amount: 5,
  now: new Date("2026-10-15T09:30:00.000Z")
});
assert.equal(datableApplied.error, null);
assert.deepEqual(
  datableApplied.game.changes.map((change) => change.at),
  ["2026-10-15T09:30:00.000Z"],
  "the change entry carries the injected clock's ISO stamp"
);
assert.ok(!("at" in datableGame), "the input game must never gain change fields");

console.log("Game tests passed: finishGame guards (missing-game/already-finished), non-mutating transition, status-only change with no new fields, preserved players/change log/order, double-finish rejection, fresh and 20-player games, replayGame guards (missing-game/not-finished/invalid-roster), replayed games with new game-scoped identities via the replay-game seed that start untitled (the original title is never copied) with copied names/colors/markers/order, literal restoration and regenerated fallbacks, zero totals with no change log or updatedAt, non-mutating replay input, renameGame guards (missing-game/already-finished/invalid-title/title-too-long) with trim-once success and no input mutation, displayGameTitle verbatim/auto-label/Game fallback formatting, formatRelativeTimestamp deterministic buckets (just now / minutes / hours / days / absolute ≥ 7 days) with skew, boundary, purity, and null fallbacks, per-change `at` stamps from the injectable clock, and a local error-code list.");

