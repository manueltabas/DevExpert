export const MAX_SCORE_ABS = 1_000_000;

export const SCORE_ERROR_CODES = [
  "empty",
  "not-a-number",
  "not-integer",
  "zero",
  "out-of-range",
  "unknown-player",
  "not-safe",
  "nothing-to-undo"
];

export function isPlainIntegerText(text) {
  return /^[+-]?\d+$/.test(String(text).trim());
}

export function isPlainScoreDraft(text) {
  return /^[+-]?\d*\.?\d*$/.test(String(text));
}

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

  // Plain-format gate, ordered after the finite/integer/zero/range checks so
  // every existing error mapping is preserved: only plain signed integer text
  // (e.g. "10", "-3", "+7") can save. Scientific notation ("1e3"), hex
  // ("0x10"), and trailing-dot forms ("10.") parse to valid in-range integers
  // but are no longer savable — the entry guard blocks them at the field, and
  // this gate rejects anything that reaches the parser by another path.
  if (!isPlainIntegerText(text)) {
    return { error: "not-a-number" };
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

export function undoLastScoreChange({ game }) {
  const changes = Array.isArray(game?.changes) ? game.changes : [];

  if (changes.length === 0) {
    return { game: null, undone: null, error: "nothing-to-undo" };
  }

  const undone = changes[changes.length - 1];
  const player = game.players?.find((candidate) => candidate.id === undone?.playerId) ?? null;

  if (!player) {
    return { game: null, undone: null, error: "unknown-player" };
  }

  const nextTotal = player.total - undone.amount;

  if (!Number.isSafeInteger(nextTotal)) {
    return { game: null, undone: null, error: "not-safe" };
  }

  const players = game.players.map((candidate) =>
    candidate.id === player.id ? { ...candidate, total: nextTotal } : candidate
  );

  return {
    game: { ...game, players, changes: changes.slice(0, -1) },
    undone,
    error: null
  };
}
