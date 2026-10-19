import { MAX_TITLE_LENGTH, createGame } from "./roster.js";

export const GAME_ERROR_CODES = [
  "missing-game",
  "already-finished",
  "not-finished",
  "invalid-roster",
  "invalid-title",
  "title-too-long"
];

const TITLE_STAMP_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

// Deterministic `d MMM, HH:mm` stamp (24-hour, zero-padded minutes, short
// English months) in local time — no locale-dependent formatting, so the
// auto-label for a stored createdAt is stable across reloads and re-renders.
function formatTitleStamp(createdAt) {
  if (typeof createdAt !== "string") {
    return null;
  }

  const date = new Date(createdAt);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const day = String(date.getDate());
  const month = TITLE_STAMP_MONTHS[date.getMonth()];
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${day} ${month}, ${hours}:${minutes}`;
}

// Display label for any surface that shows a game's title: the stored title
// verbatim when it is a string with non-whitespace content (never re-trimmed
// or rewritten), otherwise the render-time auto-label `Game — {d MMM, HH:mm}`
// derived from createdAt, otherwise plain "Game". The label is never stored.
export function displayGameTitle(game) {
  const title = game?.title;

  if (typeof title === "string" && title.trim() !== "") {
    return title;
  }

  const stamp = formatTitleStamp(game?.createdAt);

  return stamp ? `Game — ${stamp}` : "Game";
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

// Deterministic relative-time token for activity stamps (track-game-activity),
// anchored to an injectable `now` so tests can seed exact ages: < 1 minute
// ("just now", covering clock skew where the stamp lies in the future), then
// floored minutes/hours/days up to a week, then the same absolute
// `d MMM, HH:mm` local-time stamp the title auto-label uses. Non-string and
// unparseable input returns null so callers pick their own fallback. No
// locale-dependent formatting anywhere — minutes-based Date math is
// timezone-independent and the absolute branch reuses formatTitleStamp.
export function formatRelativeTimestamp(value, now = new Date()) {
  if (typeof value !== "string") {
    return null;
  }

  const stamp = new Date(value);

  if (Number.isNaN(stamp.getTime())) {
    return null;
  }

  const diff = now.getTime() - stamp.getTime();

  if (diff < MINUTE_MS) {
    return "just now";
  }

  if (diff < HOUR_MS) {
    return `${Math.floor(diff / MINUTE_MS)}m ago`;
  }

  if (diff < DAY_MS) {
    return `${Math.floor(diff / HOUR_MS)}h ago`;
  }

  if (diff < WEEK_MS) {
    return `${Math.floor(diff / DAY_MS)}d ago`;
  }

  return formatTitleStamp(value);
}

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
// copies — names, colors, markers (and the creation order) — while all totals
// restart at zero and no scores, change log, `updatedAt`, or title carry over:
// replays always start untitled (title: "") and display the auto-label until
// the scorekeeper names them. The input game is never mutated; the finished
// original stays exactly as it was stored.
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
    title: "",
    rows,
    now,
    idSeed: "replay-game",
    presetId: game.presetId
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

// Rename: the one pure title mutation, allowed only while a game is active —
// finished titles are frozen (any non-active status reports
// "already-finished", checked before the title itself is validated). The
// trimmed title replaces the stored one in a new game object (blank after
// trim means "no title" and stores ""), the input game is never mutated, and
// a title longer than MAX_TITLE_LENGTH reports "title-too-long".
export function renameGame({ game, title } = {}) {
  if (!isLifecycleGame(game)) {
    return { game: null, error: "missing-game" };
  }

  if (game.status !== "active") {
    return { game: null, error: "already-finished" };
  }

  if (typeof title !== "string") {
    return { game: null, error: "invalid-title" };
  }

  const trimmedTitle = title.trim();

  if (trimmedTitle.length > MAX_TITLE_LENGTH) {
    return { game: null, error: "title-too-long" };
  }

  return {
    game: { ...game, title: trimmedTitle },
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
