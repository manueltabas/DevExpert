import { FALLBACK_TITLE, createGame } from "./roster.js";

export const GAME_ERROR_CODES = [
  "missing-game",
  "already-finished",
  "not-finished",
  "invalid-roster"
];

// The one-way game lifecycle transition: active -> finished. `now` is part of
// the transition signature but deliberately unused — no timestamp is stored
// beyond `status` (no `finishedAt`, no ranks, no other new fields).
export function finishGame({ game, now = new Date() } = {}) {
  if (!isLifecycleGame(game)) {
    return { game: null, error: "missing-game" };
  }

  if (game.status !== "active") {
    return { game: null, error: "already-finished" };
  }

  return {
    game: { ...game, status: "finished" },
    error: null
  };
}

// Replay: a finished game's roster becomes a brand-new active game through the
// roster path, so every identity is game-scoped and new (`replay-game-*` ids
// can never collide with setup-created `active-game-*` ids). Only presentation
// copies — title, names, colors, markers (and the creation order) — while all
// totals restart at zero and no scores, change log, or `updatedAt` carry over.
// The input game is never mutated; the finished original stays exactly as it
// was stored.
export function replayGame({ game, now = new Date() } = {}) {
  if (!isLifecycleGame(game)) {
    return { game: null, error: "missing-game" };
  }

  if (game.status !== "finished") {
    return { game: null, error: "not-finished" };
  }

  const rows = game.players.map((player) => ({
    name: typeof player?.name === "string" ? player.name : "",
    color: player?.color
  }));

  const result = createGame({
    title: typeof game.title === "string" ? game.title : FALLBACK_TITLE,
    rows,
    now,
    idSeed: "replay-game"
  });

  if (!result.game) {
    return { game: null, error: "invalid-roster" };
  }

  result.game.players.forEach((player, index) => {
    const original = game.players[index];
    const originalMarker = original?.marker;

    if (typeof originalMarker === "string" && originalMarker.trim() !== "") {
      player.marker = originalMarker;
    }

    const originalOrder = original?.order;

    if (Number.isInteger(originalOrder)) {
      player.order = originalOrder;
    }
  });

  return {
    game: result.game,
    error: null
  };
}

function isLifecycleGame(game) {
  return Boolean(
    game &&
    typeof game === "object" &&
    !Array.isArray(game) &&
    Array.isArray(game.players)
  );
}
