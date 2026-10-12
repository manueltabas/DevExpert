export const STORAGE_KEY = "scorekeeper:games";
export const SAVED_GAMES_VERSION = 1;

export function loadSavedGames({ storage = globalThis.localStorage ?? null } = {}) {
  if (!isReadableStorage(storage)) {
    return { games: [], error: "unavailable" };
  }

  let raw = null;

  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return { games: [], error: "unavailable" };
  }

  if (raw === null || raw === undefined) {
    return { games: [], error: null };
  }

  let payload = null;

  try {
    payload = JSON.parse(raw);
  } catch {
    return { games: [], error: "invalid" };
  }

  if (!isValidEnvelope(payload)) {
    return { games: [], error: "invalid" };
  }

  const games = [];

  for (const entry of payload.games) {
    if (isUsableGameEntry(entry)) {
      games.push(entry);
    } else {
      console.warn("Saved game entry skipped: invalid-entry");
    }
  }

  return { games, error: null };
}

export function saveGames({ games, storage = globalThis.localStorage ?? null } = {}) {
  if (!isWritableStorage(storage)) {
    return { saved: false, error: "unavailable" };
  }

  try {
    const payload = JSON.stringify({
      version: SAVED_GAMES_VERSION,
      games: Array.isArray(games) ? games : []
    });
    storage.setItem(STORAGE_KEY, payload);
    return { saved: true, error: null };
  } catch {
    return { saved: false, error: "write" };
  }
}

export function upsertSavedGame(games, game, { updatedAt = new Date().toISOString() } = {}) {
  const nextGames = Array.isArray(games) ? [...games] : [];

  if (!isUsableGameEntry(game)) {
    return nextGames;
  }

  const storedCopy = { ...game, updatedAt };
  const existingIndex = nextGames.findIndex((candidate) => candidate?.id === game.id);

  if (existingIndex === -1) {
    nextGames.push(storedCopy);
  } else {
    nextGames[existingIndex] = storedCopy;
  }

  return nextGames;
}

export function orderSavedGamesForDisplay(games) {
  const list = Array.isArray(games) ? [...games] : [];

  return list.sort((a, b) => compareSavedGamesForDisplay(a, b));
}

function compareSavedGamesForDisplay(a, b) {
  const aUpdated = displayTimestamp(a, "updatedAt") || displayTimestamp(a, "createdAt");
  const bUpdated = displayTimestamp(b, "updatedAt") || displayTimestamp(b, "createdAt");

  if (aUpdated !== bUpdated) {
    return aUpdated < bUpdated ? 1 : -1;
  }

  const aCreated = displayTimestamp(a, "createdAt");
  const bCreated = displayTimestamp(b, "createdAt");

  if (aCreated !== bCreated) {
    return aCreated < bCreated ? 1 : -1;
  }

  const aId = typeof a?.id === "string" ? a.id : "";
  const bId = typeof b?.id === "string" ? b.id : "";

  if (aId < bId) {
    return -1;
  }

  if (aId > bId) {
    return 1;
  }

  return 0;
}

function displayTimestamp(game, field) {
  const value = game?.[field];
  return typeof value === "string" && value.trim() !== "" ? value : "";
}

function isReadableStorage(storage) {
  return Boolean(storage && typeof storage.getItem === "function");
}

function isWritableStorage(storage) {
  return Boolean(storage && typeof storage.setItem === "function");
}

function isValidEnvelope(payload) {
  return Boolean(
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    payload.version === SAVED_GAMES_VERSION &&
    Array.isArray(payload.games)
  );
}

function isUsableGameEntry(entry) {
  return Boolean(
    entry &&
    typeof entry === "object" &&
    typeof entry.id === "string" &&
    entry.id !== "" &&
    Array.isArray(entry.players)
  );
}
