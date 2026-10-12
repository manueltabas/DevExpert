export const MAX_SCORE_ABS = 1_000_000;

export const SCORE_ERROR_CODES = [
  "empty",
  "not-a-number",
  "not-integer",
  "zero",
  "out-of-range",
  "unknown-player",
  "not-safe"
];

export function parseScoreAmount(raw) {
  if (raw === null || raw === undefined) {
    return { error: "empty" };
  }

  const text = String(raw).trim();

  if (text === "") {
    return { error: "empty" };
  }

  const amount = Number(text);

  if (!Number.isFinite(amount)) {
    return { error: "not-a-number" };
  }

  if (!Number.isInteger(amount)) {
    return { error: "not-integer" };
  }

  if (amount === 0) {
    return { error: "zero" };
  }

  if (Math.abs(amount) > MAX_SCORE_ABS) {
    return { error: "out-of-range" };
  }

  return { amount };
}

export function applyScoreChange({ game, playerId, amount }) {
  const player = game?.players?.find((candidate) => candidate.id === playerId) ?? null;

  if (!player) {
    return { game: null, error: "unknown-player" };
  }

  if (!Number.isInteger(amount)) {
    return { game: null, error: "not-integer" };
  }

  if (amount === 0) {
    return { game: null, error: "zero" };
  }

  if (Math.abs(amount) > MAX_SCORE_ABS) {
    return { game: null, error: "out-of-range" };
  }

  const nextTotal = player.total + amount;

  if (!Number.isSafeInteger(nextTotal)) {
    return { game: null, error: "not-safe" };
  }

  const players = game.players.map((candidate) =>
    candidate.id === playerId ? { ...candidate, total: nextTotal } : candidate
  );
  const change = { id: createChangeId(), playerId, amount };
  const changes = [...(game.changes ?? []), change];

  return {
    game: { ...game, players, changes },
    error: null
  };
}

function createChangeId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `change-${Date.now()}-${Math.floor(Math.random() * 1_000_000_000)}`;
}
