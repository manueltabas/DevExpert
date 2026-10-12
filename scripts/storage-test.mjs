import assert from "node:assert/strict";
import {
  SAVED_GAMES_VERSION,
  STORAGE_KEY,
  loadSavedGames,
  orderSavedGamesForDisplay,
  saveGames,
  upsertSavedGame
} from "../src/storage.js";
import { createGame } from "../src/roster.js";
import { applyScoreChange } from "../src/score.js";

assert.equal(STORAGE_KEY, "scorekeeper:games");
assert.equal(SAVED_GAMES_VERSION, 1);

function createMemoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    dump: () => Object.fromEntries(map.entries())
  };
}

function createThrowingStorage({ failGet = false, failSet = false } = {}) {
  return {
    getItem() {
      if (failGet) {
        throw new Error("getItem blocked");
      }
      return null;
    },
    setItem() {
      if (failSet) {
        throw new Error("setItem blocked");
      }
    }
  };
}

function captureWarnings(run) {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.map((arg) => String(arg)).join(" "));
  try {
    return { result: run(), warnings };
  } finally {
    console.warn = originalWarn;
  }
}

const { game } = createGame({
  title: "Storage test",
  rows: [
    { id: "row-1", name: "Alex", color: "blue" },
    { id: "row-2", name: "Sam", color: "red" }
  ],
  now: new Date("2026-10-12T10:00:00.000Z"),
  idSeed: "storage"
});
const scored = applyScoreChange({ game, playerId: game.players[0].id, amount: 10 });

// loadSavedGames: missing, inert, and throwing storage are "unavailable"
assert.deepEqual(loadSavedGames({ storage: null }), { games: [], error: "unavailable" });
assert.deepEqual(loadSavedGames({ storage: undefined }), { games: [], error: "unavailable" });
assert.deepEqual(loadSavedGames({ storage: {} }), { games: [], error: "unavailable" });
assert.deepEqual(loadSavedGames({ storage: { getItem: "not-a-function" } }), { games: [], error: "unavailable" });
assert.deepEqual(loadSavedGames({ storage: createThrowingStorage({ failGet: true }) }), { games: [], error: "unavailable" });

// loadSavedGames: empty storage is a clean empty list, not an error
assert.deepEqual(loadSavedGames({ storage: createMemoryStorage() }), { games: [], error: null });

// loadSavedGames: malformed payloads are "invalid" and the stored payload stays untouched
const invalidPayloads = [
  "not-json{",
  "null",
  "42",
  '"a string"',
  "[]",
  JSON.stringify({ version: 2, games: [] }),
  JSON.stringify({ games: [] }),
  JSON.stringify({ version: 1 }),
  JSON.stringify({ version: "1", games: [] }),
  JSON.stringify({ version: 1, games: "not-a-list" })
];

for (const raw of invalidPayloads) {
  const storage = createMemoryStorage({ [STORAGE_KEY]: raw });
  const { result, warnings } = captureWarnings(() => loadSavedGames({ storage }));
  assert.equal(result.error, "invalid", `payload ${raw} must be rejected`);
  assert.deepEqual(result.games, []);
  assert.deepEqual(warnings, [], "payload-level rejection must not emit entry warnings");
  assert.equal(storage.dump()[STORAGE_KEY], raw, "an invalid payload must be left untouched");
}

// loadSavedGames: usable entries are kept verbatim; malformed entries are dropped with a warning
const goodEntry = structuredClone(scored.game);
const mixedPayload = JSON.stringify({
  version: 1,
  games: [
    goodEntry,
    null,
    "a string",
    42,
    {},
    { id: 42, players: [] },
    { id: "", players: [] },
    { id: "no-players" },
    { id: "bad-players", players: "not-a-list" }
  ]
});
const mixedStorage = createMemoryStorage({ [STORAGE_KEY]: mixedPayload });
const mixedLoad = captureWarnings(() => loadSavedGames({ storage: mixedStorage }));
assert.equal(mixedLoad.result.error, null);
assert.deepEqual(mixedLoad.result.games, [goodEntry], "only usable entries survive the crash guard");
assert.equal(mixedLoad.warnings.length, 8, "every dropped entry warns once");
for (const warning of mixedLoad.warnings) {
  assert.doesNotMatch(warning, /Alex|Sam|Storage test|10/, "diagnostics must not include names, titles, or scores");
}
const originalMixed = JSON.parse(mixedStorage.dump()[STORAGE_KEY]);
assert.deepEqual(JSON.parse(mixedStorage.dump()[STORAGE_KEY]), originalMixed, "reading never rewrites the payload");

// loadSavedGames: empty games list is valid
const emptyEnvelopeStorage = createMemoryStorage({ [STORAGE_KEY]: JSON.stringify({ version: 1, games: [] }) });
assert.deepEqual(loadSavedGames({ storage: emptyEnvelopeStorage }), { games: [], error: null });

// saveGames: writing succeeds and round-trips through loadSavedGames
const roundTripStorage = createMemoryStorage();
const savedAt = "2026-10-12T11:00:00.000Z";
const roundTripGames = upsertSavedGame([], scored.game, { updatedAt: savedAt });
assert.deepEqual(saveGames({ games: roundTripGames, storage: roundTripStorage }), { saved: true, error: null });
const roundTrip = loadSavedGames({ storage: roundTripStorage });
assert.equal(roundTrip.error, null);
assert.deepEqual(roundTrip.games, roundTripGames);
assert.equal(roundTrip.games[0].updatedAt, savedAt);

// saveGames: the stored payload is the versioned envelope
const envelope = JSON.parse(roundTripStorage.dump()[STORAGE_KEY]);
assert.deepEqual(Object.keys(envelope).sort(), ["games", "version"]);
assert.equal(envelope.version, 1);
assert.equal(Array.isArray(envelope.games), true);
assert.ok(!("rank" in envelope.games[0].players[0]), "no rank fields are persisted");

// saveGames: unavailable and failing writes never throw
assert.deepEqual(saveGames({ games: [], storage: null }), { saved: false, error: "unavailable" });
assert.deepEqual(saveGames({ games: [], storage: undefined }), { saved: false, error: "unavailable" });
assert.deepEqual(saveGames({ games: [], storage: {} }), { saved: false, error: "unavailable" });
const failingWriteStorage = createThrowingStorage({ failSet: true });
assert.deepEqual(saveGames({ games: roundTripGames, storage: failingWriteStorage }), { saved: false, error: "write" });

// saveGames: a non-array games argument still writes a valid empty envelope
const defensiveStorage = createMemoryStorage();
assert.deepEqual(saveGames({ games: "oops", storage: defensiveStorage }), { saved: true, error: null });
assert.deepEqual(loadSavedGames({ storage: defensiveStorage }), { games: [], error: null });

// upsertSavedGame: appends new games and replaces by id in place
const appended = upsertSavedGame([], scored.game, { updatedAt: savedAt });
assert.equal(appended.length, 1);
assert.equal(appended[0].updatedAt, savedAt);

const secondGame = {
  ...game,
  id: "storage-game-2",
  players: game.players.map((player) => ({ ...player }))
};
const appendedAgain = upsertSavedGame(appended, secondGame, { updatedAt: "2026-10-12T12:00:00.000Z" });
assert.equal(appendedAgain.length, 2);
assert.equal(appendedAgain[0].id, scored.game.id);
assert.equal(appendedAgain[1].id, secondGame.id);

const rescored = applyScoreChange({ game: scored.game, playerId: game.players[1].id, amount: 5 });
const replaced = upsertSavedGame(appendedAgain, rescored.game, { updatedAt: "2026-10-12T13:00:00.000Z" });
assert.equal(replaced.length, 2, "upsert must replace by id, not append");
assert.equal(replaced[0].id, scored.game.id);
assert.equal(replaced[0].players[1].total, 5);
assert.equal(replaced[0].updatedAt, "2026-10-12T13:00:00.000Z");
assert.equal(replaced[1].id, secondGame.id);

// upsertSavedGame: inputs are never mutated
const beforeUpsert = structuredClone(appendedAgain);
const beforeGame = structuredClone(rescored.game);
upsertSavedGame(appendedAgain, rescored.game, { updatedAt: "2026-10-12T14:00:00.000Z" });
assert.deepEqual(appendedAgain, beforeUpsert, "the input array must never be mutated");
assert.deepEqual(rescored.game, beforeGame, "the input game must never be mutated");
assert.equal(beforeGame.updatedAt, undefined, "updatedAt is stamped only on the stored copy");
assert.equal("updatedAt" in scored.game, false);

// upsertSavedGame: unusable games are ignored defensively
assert.deepEqual(upsertSavedGame(appendedAgain, null, { updatedAt: savedAt }), [...appendedAgain]);
assert.deepEqual(upsertSavedGame(appendedAgain, { players: [] }, { updatedAt: savedAt }), [...appendedAgain]);
assert.deepEqual(upsertSavedGame(null, scored.game, { updatedAt: savedAt }).length, 1);

// orderSavedGamesForDisplay: most recently updated first, deterministic tie-breaks
const base = { id: "tie-b", createdAt: "2026-10-01T09:00:00.000Z", players: [] };
const unordered = [
  { id: "old", createdAt: "2026-10-01T09:00:00.000Z", updatedAt: "2026-10-02T09:00:00.000Z", players: [] },
  { ...base },
  { id: "tie-a", createdAt: "2026-10-01T09:00:00.000Z", players: [] },
  { id: "newest", createdAt: "2026-10-05T09:00:00.000Z", updatedAt: "2026-10-10T09:00:00.000Z", players: [] },
  { id: "no-timestamps", players: [] }
];
const unorderedSnapshot = structuredClone(unordered);
const ordered = orderSavedGamesForDisplay(unordered);
assert.deepEqual(
  ordered.map((entry) => entry.id),
  ["newest", "old", "tie-a", "tie-b", "no-timestamps"],
  "updatedAt desc, createdAt fallback, then createdAt desc, then id asc"
);
assert.deepEqual(unordered, unorderedSnapshot, "ordering must not mutate the input list");
assert.notEqual(ordered, unordered, "ordering must return a new array");

// orderSavedGamesForDisplay: equal updatedAt falls back to createdAt desc, then id asc
const sameUpdated = [
  { id: "b", createdAt: "2026-10-02T09:00:00.000Z", updatedAt: "2026-10-12T09:00:00.000Z", players: [] },
  { id: "a", createdAt: "2026-10-02T09:00:00.000Z", updatedAt: "2026-10-12T09:00:00.000Z", players: [] },
  { id: "z", createdAt: "2026-10-03T09:00:00.000Z", updatedAt: "2026-10-12T09:00:00.000Z", players: [] }
];
assert.deepEqual(
  orderSavedGamesForDisplay(sameUpdated).map((entry) => entry.id),
  ["z", "a", "b"]
);

// orderSavedGamesForDisplay: non-array input is safe
assert.deepEqual(orderSavedGamesForDisplay(null), []);
assert.deepEqual(orderSavedGamesForDisplay(undefined), []);

// Full round trip: save, load, and resume-shaped data (roster, totals, change log) survives
const resumeStorage = createMemoryStorage();
const logged = applyScoreChange({ game: scored.game, playerId: game.players[1].id, amount: -3 });
saveGames({ games: upsertSavedGame([], logged.game, { updatedAt: savedAt }), storage: resumeStorage });
const reloaded = loadSavedGames({ storage: resumeStorage });
assert.equal(reloaded.error, null);
assert.deepEqual(reloaded.games[0].players.map((player) => player.total), [10, -3]);
assert.deepEqual(
  reloaded.games[0].changes.map((change) => change.amount),
  [10, -3],
  "the change log must persist so undo works after a reload"
);
assert.deepEqual(Object.keys(reloaded.games[0].changes[0]).sort(), ["amount", "id", "playerId"]);
assert.equal(reloaded.games[0].status, "active");

console.log("Storage tests passed: single versioned key, round-trip save/load, upsert/append/immutability, deterministic ordering, invalid-payload rejection, entry crash guard, unavailable/throwing storage, and write failures.");
