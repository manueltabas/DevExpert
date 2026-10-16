import assert from "node:assert/strict";
import { createGame } from "../src/roster.js";
import { applyScoreChange } from "../src/score.js";
import { podiumRows, rankPlayers, scoreDistribution } from "../src/standings.js";

// rankPlayers: null game and missing/empty player lists
assert.deepEqual(rankPlayers(null), []);
assert.deepEqual(rankPlayers(undefined), []);
assert.deepEqual(rankPlayers({}), []);
assert.deepEqual(rankPlayers({ players: [] }), []);

// rankPlayers: 12, 12, 8 share rank 1 and skip rank 2 (competition ranking)
const tieGame = {
  players: [
    { id: "tie-1", name: "Alex", order: 0, total: 12 },
    { id: "tie-2", name: "Sam", order: 1, total: 12 },
    { id: "tie-3", name: "Jamie", order: 2, total: 8 }
  ]
};
const tieRanked = rankPlayers(tieGame);
assert.deepEqual(
  tieRanked.map((row) => [row.player.id, row.rank]),
  [["tie-1", 1], ["tie-2", 1], ["tie-3", 3]]
);
assert.ok(!tieRanked.some((row) => row.rank === 2), "the position after a shared rank must skip");
assert.ok(tieRanked.every((row) => row.player === tieGame.players.find((player) => player.id === row.player.id)),
  "rows should reference the original player objects");

// rankPlayers: negative totals and a partial tie (5, -3, -3 -> 1, 2, 2)
const negativeGame = {
  players: [
    { id: "neg-1", name: "N1", order: 0, total: 5 },
    { id: "neg-2", name: "N2", order: 1, total: -3 },
    { id: "neg-3", name: "N3", order: 2, total: -3 }
  ]
};
assert.deepEqual(
  rankPlayers(negativeGame).map((row) => [row.player.id, row.rank]),
  [["neg-1", 1], ["neg-2", 2], ["neg-3", 2]]
);

// rankPlayers: an all-player tie keeps creation order and shares rank 1
const fresh = createGame({
  title: "Tie test",
  rows: [
    { id: "row-1", name: "Alex", color: "blue" },
    { id: "row-2", name: "Sam", color: "red" },
    { id: "row-3", name: "Jamie", color: "green" }
  ],
  now: new Date("2026-10-12T10:00:00.000Z"),
  idSeed: "standings"
});
const freshRanked = rankPlayers(fresh.game);
assert.deepEqual(freshRanked.map((row) => row.player.name), ["Alex", "Sam", "Jamie"]);
assert.deepEqual(freshRanked.map((row) => row.rank), [1, 1, 1]);

// rankPlayers: a mid-table tie skips the following position (10, 5, 5, 0 -> 1, 2, 2, 4)
const midTieGame = {
  players: [
    { id: "m-1", name: "M1", order: 0, total: 10 },
    { id: "m-2", name: "M2", order: 1, total: 5 },
    { id: "m-3", name: "M3", order: 2, total: 5 },
    { id: "m-4", name: "M4", order: 3, total: 0 }
  ]
};
assert.deepEqual(
  rankPlayers(midTieGame).map((row) => [row.player.id, row.rank]),
  [["m-1", 1], ["m-2", 2], ["m-3", 2], ["m-4", 4]]
);

// rankPlayers: player.order decides tied display order, not array position
const orderOverridesIndex = {
  players: [
    { id: "listed-second", name: "Second", order: 1, total: 9 },
    { id: "listed-first", name: "First", order: 0, total: 9 }
  ]
};
assert.deepEqual(
  rankPlayers(orderOverridesIndex).map((row) => row.player.id),
  ["listed-first", "listed-second"]
);

// rankPlayers: the tiebreak falls back to the original array index when order is absent
const noOrderGame = {
  players: [
    { id: "row-a", name: "A", total: 4 },
    { id: "row-b", name: "B", total: 4 },
    { id: "row-c", name: "C", total: 6 }
  ]
};
assert.deepEqual(
  rankPlayers(noOrderGame).map((row) => row.player.id),
  ["row-c", "row-a", "row-b"]
);
assert.deepEqual(
  rankPlayers(noOrderGame).map((row) => row.rank),
  [1, 2, 2]
);

// rankPlayers: a 20-player mixed game ranks every row by 1 + count of strictly higher totals
const twentyGame = {
  players: Array.from({ length: 20 }, (_, index) => ({
    id: `p-${index + 1}`,
    name: `Player ${index + 1}`,
    order: index,
    total: ((index * 7) % 23) - 8
  }))
};
const twentyRanked = rankPlayers(twentyGame);
assert.equal(twentyRanked.length, 20);
const twentyTotals = twentyRanked.map((row) => row.player.total);
const sortedTwentyTotals = [...twentyTotals].sort((a, b) => b - a);
assert.deepEqual(twentyTotals, sortedTwentyTotals, "rows must be ordered by descending total");
assert.deepEqual(twentyRanked.map((row) => row.rank), Array.from({ length: 20 }, (_, index) => index + 1),
  "distinct totals produce a full rank sequence");

function assertCompetitionRanking(game, ranked) {
  ranked.forEach((row) => {
    const strictlyHigher = game.players.filter((candidate) => candidate.total > row.player.total).length;
    assert.equal(row.rank, strictlyHigher + 1, `rank for ${row.player.id} must equal 1 + strictly higher totals`);
  });
}

assertCompetitionRanking(twentyGame, twentyRanked);
assertCompetitionRanking(tieGame, tieRanked);
assertCompetitionRanking(negativeGame, rankPlayers(negativeGame));
assertCompetitionRanking(midTieGame, rankPlayers(midTieGame));

// rankPlayers: re-ranking after applyScoreChange lets the trailing player overtake
const { game: orderGame } = createGame({
  title: "Overtake test",
  rows: [
    { id: "row-1", name: "Alex", color: "blue" },
    { id: "row-2", name: "Sam", color: "red" }
  ],
  now: new Date("2026-10-12T11:00:00.000Z"),
  idSeed: "overtake"
});
const alexScored = applyScoreChange({ game: orderGame, playerId: orderGame.players[0].id, amount: 3 });
const alexLeads = rankPlayers(alexScored.game);
assert.deepEqual(alexLeads.map((row) => [row.player.name, row.rank]), [["Alex", 1], ["Sam", 2]]);

const samOvertakes = applyScoreChange({ game: alexScored.game, playerId: alexScored.game.players[1].id, amount: 10 });
const overtaken = rankPlayers(samOvertakes.game);
assert.deepEqual(overtaken.map((row) => row.player.name), ["Sam", "Alex"]);
assert.deepEqual(overtaken.map((row) => row.rank), [1, 2]);

// ranking is a read-only derivation: no rank fields, no change-log writes, input untouched
assert.equal(samOvertakes.game.changes.length, 2);
assert.ok(samOvertakes.game.players.every((player) => !("rank" in player)), "players must not gain rank fields");
assert.ok(!("rank" in samOvertakes.game), "the game must not gain a rank field");
assert.deepEqual(rankPlayers(samOvertakes.game), overtaken, "ranking the same game twice is stable");

const beforeRanking = structuredClone(orderGame);
rankPlayers(orderGame);
assert.deepEqual(orderGame, beforeRanking, "rankPlayers must never mutate the input game");

// rankPlayers: a single player ranks 1
assert.deepEqual(rankPlayers({ players: [{ id: "solo", name: "Solo", order: 0, total: -7 }] }),
  [{ player: { id: "solo", name: "Solo", order: 0, total: -7 }, rank: 1 }]);

// podiumRows: eligibility is every rank <= 3 row, with ties never collapsed (12/12/8 -> 1,1,3)
const podiumTieGame = {
  players: [
    { id: "pod-1", name: "Alex", order: 0, total: 12 },
    { id: "pod-2", name: "Sam", order: 1, total: 12 },
    { id: "pod-3", name: "Jamie", order: 2, total: 8 }
  ]
};
const podiumTie = podiumRows(podiumTieGame);
assert.deepEqual(
  podiumTie.map((row) => [row.player.id, row.rank]),
  [["pod-1", 1], ["pod-2", 1], ["pod-3", 3]],
  "12/12/8 must put three players on the podium as ranks 1,1,3"
);
assert.ok(!podiumTie.some((row) => row.rank === 2), "an empty rank-2 group must not be fabricated");
assert.ok(podiumTie.every((row) => row.player === podiumTieGame.players.find((player) => player.id === row.player.id)),
  "podium rows reference the original player objects");

// podiumRows: both rank-2 players qualify and the rank-4 pair is excluded (10/5/5/0/0 -> 1,2,2,4,4)
const podiumCutoffGame = {
  players: [
    { id: "cut-1", name: "Ada", order: 0, total: 10 },
    { id: "cut-2", name: "Ben", order: 1, total: 5 },
    { id: "cut-3", name: "Cal", order: 2, total: 5 },
    { id: "cut-4", name: "Dee", order: 3, total: 0 },
    { id: "cut-5", name: "Eli", order: 4, total: 0 }
  ]
};
assert.deepEqual(
  podiumRows(podiumCutoffGame).map((row) => [row.player.id, row.rank]),
  [["cut-1", 1], ["cut-2", 2], ["cut-3", 2]],
  "10/5/5/0/0 must include both rank-2 players and exclude the rank-4 pair"
);

// podiumRows: twenty tied players all share rank 1 and all stay eligible
const twentyTiedGame = {
  players: Array.from({ length: 20 }, (_, index) => ({
    id: `tied-${index + 1}`,
    name: `Player ${index + 1}`,
    order: index,
    total: 0
  }))
};
const twentyPodium = podiumRows(twentyTiedGame);
assert.equal(twentyPodium.length, 20, "all 20 tied players must be podium-eligible");
assert.ok(twentyPodium.every((row) => row.rank === 1), "twenty tied players share rank 1");

// podiumRows: guard cases return an empty list
assert.deepEqual(podiumRows(null), []);
assert.deepEqual(podiumRows(undefined), []);
assert.deepEqual(podiumRows({}), []);
assert.deepEqual(podiumRows({ players: [] }), []);

// podiumRows: read-only derivation returning a fresh array
const beforePodiumRows = structuredClone(podiumCutoffGame);
podiumRows(podiumCutoffGame);
assert.deepEqual(podiumCutoffGame, beforePodiumRows, "podiumRows must never mutate the input game");
assert.notEqual(podiumRows(podiumCutoffGame), podiumRows(podiumCutoffGame),
  "podiumRows must return a fresh array on every call");
assert.ok(!("rank" in podiumCutoffGame) && podiumCutoffGame.players.every((player) => !("rank" in player)),
  "podiumRows must not store rank fields");

// scoreDistribution: mockup parity — 42/35/28/19 of 124 rounds to 34/28/23/15
// (floors 33/28/22/15 = 98; remainders .87/.23/.58/.32 top up Alex and Jamie).
const mockupGame = {
  players: [
    { id: "mk-1", name: "Alex", order: 0, total: 42 },
    { id: "mk-2", name: "Sam", order: 1, total: 35 },
    { id: "mk-3", name: "Jamie", order: 2, total: 28 },
    { id: "mk-4", name: "Taylor", order: 3, total: 19 }
  ]
};
const mockupDistribution = scoreDistribution(mockupGame);
assert.equal(mockupDistribution.gameTotal, 124);
assert.deepEqual(
  mockupDistribution.rows.map((row) => [row.player.id, row.percent]),
  [["mk-1", 34], ["mk-2", 28], ["mk-3", 23], ["mk-4", 15]],
  "the mockup totals must reproduce the largest-remainder shares in leaderboard order"
);
assert.equal(mockupDistribution.rows.reduce((sum, row) => sum + row.percent, 0), 100);
assert.ok(mockupDistribution.rows.every((row) => row.player === mockupGame.players.find((player) => player.id === row.player.id)),
  "distribution rows reference the original player objects");

// scoreDistribution: the pinned naive-rounding counterexample — 2/2/2/1/1/1 of
// 9 naively rounds to 99; largest remainder tops the tied .22 remainders in
// display order and sums to exactly 100 (23/22/22/11/11/11).
const halvesGame = {
  players: [
    { id: "h-1", name: "P1", order: 0, total: 2 },
    { id: "h-2", name: "P2", order: 1, total: 2 },
    { id: "h-3", name: "P3", order: 2, total: 2 },
    { id: "h-4", name: "P4", order: 3, total: 1 },
    { id: "h-5", name: "P5", order: 4, total: 1 },
    { id: "h-6", name: "P6", order: 5, total: 1 }
  ]
};
const halvesDistribution = scoreDistribution(halvesGame);
assert.equal(halvesDistribution.gameTotal, 9);
assert.deepEqual(
  halvesDistribution.rows.map((row) => row.percent),
  [23, 22, 22, 11, 11, 11],
  "naive per-row rounding would give 99; the largest-remainder top-up must fix it"
);
assert.equal(halvesDistribution.rows.reduce((sum, row) => sum + row.percent, 0), 100);

// scoreDistribution: full tie 1/1/1 of 3 tops the shared remainder up in
// display order (34/33/33, never 33/34/33 or 33/33/34).
const thirdsGame = {
  players: [
    { id: "t-1", name: "P1", order: 0, total: 1 },
    { id: "t-2", name: "P2", order: 1, total: 1 },
    { id: "t-3", name: "P3", order: 2, total: 1 }
  ]
};
const thirdsDistribution = scoreDistribution(thirdsGame);
assert.equal(thirdsDistribution.gameTotal, 3);
assert.deepEqual(thirdsDistribution.rows.map((row) => row.percent), [34, 33, 33]);
assert.equal(thirdsDistribution.rows.reduce((sum, row) => sum + row.percent, 0), 100);

// scoreDistribution: mixed signs with a positive total — the negative player
// is omitted, the denominator is the positive sum (13, not the signed total 8),
// and the gameTotal stays signed for the honest caption.
const mixedSignGame = {
  players: [
    { id: "ms-1", name: "Lead", order: 0, total: 10 },
    { id: "ms-2", name: "Penalized", order: 1, total: -5 },
    { id: "ms-3", name: "Third", order: 2, total: 3 }
  ]
};
const mixedSignDistribution = scoreDistribution(mixedSignGame);
assert.equal(mixedSignDistribution.gameTotal, 8);
assert.deepEqual(
  mixedSignDistribution.rows.map((row) => [row.player.id, row.percent]),
  [["ms-1", 77], ["ms-3", 23]],
  "only positive totals share the bar; 10/13 and 3/13 round to 77/23"
);
assert.equal(mixedSignDistribution.rows.reduce((sum, row) => sum + row.percent, 0), 100);

// scoreDistribution: zero-total players are omitted while others scored
// (10/0/5 of 15 -> 67/33, the zero player absent).
const zeroPlayerGame = {
  players: [
    { id: "zp-1", name: "Scorer", order: 0, total: 10 },
    { id: "zp-2", name: "Bench", order: 1, total: 0 },
    { id: "zp-3", name: "Also", order: 2, total: 5 }
  ]
};
const zeroPlayerDistribution = scoreDistribution(zeroPlayerGame);
assert.equal(zeroPlayerDistribution.gameTotal, 15);
assert.deepEqual(
  zeroPlayerDistribution.rows.map((row) => [row.player.id, row.percent]),
  [["zp-1", 67], ["zp-3", 33]],
  "a zero-total player holds no share and is omitted"
);

// scoreDistribution: a positive-total player rounding to 0% keeps its row so
// segments and legend stay 1:1 (1000/1 of 1001 -> 100 and 0).
const tinyShareGame = {
  players: [
    { id: "ts-1", name: "Whale", order: 0, total: 1000 },
    { id: "ts-2", name: "Minnow", order: 1, total: 1 }
  ]
};
const tinyShareDistribution = scoreDistribution(tinyShareGame);
assert.deepEqual(
  tinyShareDistribution.rows.map((row) => [row.player.id, row.percent]),
  [["ts-1", 100], ["ts-2", 0]],
  "a positive-total player with a 0% share keeps its legend row and 0-width segment"
);
assert.equal(tinyShareDistribution.rows.reduce((sum, row) => sum + row.percent, 0), 100);

// scoreDistribution: degenerate totals keep the (signed) caption but no rows.
assert.deepEqual(scoreDistribution({ players: [{ id: "z1", name: "A", order: 0, total: 0 }, { id: "z2", name: "B", order: 1, total: 0 }] }),
  { gameTotal: 0, rows: [] }, "an all-zero game has no shares to show");
assert.deepEqual(scoreDistribution({ players: [{ id: "nz1", name: "A", order: 0, total: 5 }, { id: "nz2", name: "B", order: 1, total: -5 }] }),
  { gameTotal: 0, rows: [] }, "a net-zero game has no shares to show");
assert.deepEqual(scoreDistribution({ players: [{ id: "nn1", name: "A", order: 0, total: -5 }, { id: "nn2", name: "B", order: 1, total: -3 }] }),
  { gameTotal: -8, rows: [] }, "a net-negative game keeps its signed caption with no rows");
assert.deepEqual(scoreDistribution({ players: [] }), { gameTotal: 0, rows: [] });

// scoreDistribution: guards mirror the playerNumbers precedent
assert.deepEqual(scoreDistribution(null), { gameTotal: 0, rows: [] });
assert.deepEqual(scoreDistribution(undefined), { gameTotal: 0, rows: [] });
assert.deepEqual(scoreDistribution({}), { gameTotal: 0, rows: [] });
assert.deepEqual(scoreDistribution({ players: "not-an-array" }), { gameTotal: 0, rows: [] });
assert.deepEqual(
  scoreDistribution({ players: [null, { id: "ok", name: "Ok", order: 1, total: 7 }] }),
  { gameTotal: 7, rows: [{ player: { id: "ok", name: "Ok", order: 1, total: 7 }, percent: 100 }] },
  "non-object player entries contribute 0 to the total and never join the shares"
);

// scoreDistribution: a 20-player positive game sums to exactly 100 in
// leaderboard order with no lost player.
const twentyPositiveGame = {
  players: Array.from({ length: 20 }, (_, index) => ({
    id: `dist-${index + 1}`,
    name: `Player ${index + 1}`,
    order: index,
    total: 20 - index
  }))
};
const twentyDistribution = scoreDistribution(twentyPositiveGame);
assert.equal(twentyDistribution.gameTotal, 210);
assert.equal(twentyDistribution.rows.length, 20);
assert.equal(twentyDistribution.rows.reduce((sum, row) => sum + row.percent, 0), 100,
  "the 20 displayed percentages must sum to exactly 100");
const twentyPercents = twentyDistribution.rows.map((row) => row.percent);
assert.deepEqual(twentyPercents, [...twentyPercents].sort((a, b) => b - a),
  "shares follow descending-total order");
assert.ok(twentyPercents.every((percent) => Number.isInteger(percent) && percent >= 0 && percent <= 100));

// scoreDistribution: read-only derivation with fresh arrays and no written fields
const beforeDistribution = structuredClone(mockupGame);
scoreDistribution(mockupGame);
assert.deepEqual(mockupGame, beforeDistribution, "scoreDistribution must never mutate the input game");
assert.ok(mockupGame.players.every((player) => !("percent" in player) && !("share" in player)),
  "players must not gain share fields");
assert.ok(!("gameTotal" in mockupGame) && !("distribution" in mockupGame),
  "the game must not gain distribution fields");
assert.notEqual(scoreDistribution(mockupGame), scoreDistribution(mockupGame),
  "scoreDistribution must return a fresh object on every call");
assert.notEqual(scoreDistribution(mockupGame).rows, scoreDistribution(mockupGame).rows,
  "the rows array must be fresh on every call");

console.log("Standings tests passed: competition ranking with shared ranks, creation-order ties, descending totals, 20-player games, re-rank after applyScoreChange, podiumRows eligibility (ties never collapsed, rank-4 excluded), scoreDistribution largest-remainder shares (mockup 34/28/23/15, naive-rounding counterexample 23/22/22/11/11/11, tie top-up 34/33/33, mixed-sign positive-only shares, zero-total omission, 0% retention, degenerate/guard cases, sum-100 invariants), and read-only input handling.");
