export const GAME_ERROR_CODES = [
  "missing-game",
  "already-finished"
];

// The one-way game lifecycle transition: active -> finished. `now` is part of
// the transition signature but deliberately unused — no timestamp is stored
// beyond `status` (no `finishedAt`, no ranks, no other new fields).
export function finishGame({ game, now = new Date() } = {}) {
  if (!isFinishableGame(game)) {
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

function isFinishableGame(game) {
  return Boolean(
    game &&
    typeof game === "object" &&
    !Array.isArray(game) &&
    Array.isArray(game.players)
  );
}
