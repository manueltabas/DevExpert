import {
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  MAX_TITLE_LENGTH,
  MIN_PLAYERS,
  PLAYER_COLORS,
  colorForIndex,
  createGame,
  createSetupRow,
  createSetupRows,
  getColor,
  playerNumbers,
  validateRoster
} from "./roster.js";
import {
  MAX_SCORE_ABS,
  applyScoreChange,
  isPlainScoreDraft,
  parseScoreAmount,
  recentScoreChanges,
  undoLastScoreChange
} from "./score.js";
import { podiumRows, rankPlayers, scoreDistribution } from "./standings.js";
import { finishGame, displayGameTitle, formatRelativeTimestamp, renameGame, replayGame } from "./game.js";
import {
  loadSavedGames,
  orderSavedGamesForDisplay,
  saveGames,
  upsertSavedGame
} from "./storage.js";

const appRoot = document.querySelector("[data-app-root]");
const yearTarget = document.querySelector("[data-current-year]");
const state = {
  view: "home",
  title: "",
  rows: createSetupRows(),
  activeGame: null,
  selectedPlayerId: null,
  scoreFeedback: null,
  finishPromptOpen: false,
  podiumOpen: false,
  replayFeedback: null,
  titleEditOpen: false,
  titleDraft: "",
  titleEditFeedback: null,
  historyDialog: null,
  savedGames: [],
  storageReadError: null,
  storageDroppedCount: 0,
  lastSaveError: null,
  errors: [],
  limitMessage: "",
  nextRowNumber: MIN_PLAYERS + 1
};

// Dashboard preview cap (refine-ui-after-testing; modal since
// refine-podium-and-history-modal): each panel renders at most this many of its
// most recent saved games. Above the cap, a transient per-panel "View all (N)"
// opener opens a modal listing every game of that status. The full list stays
// in the persisted payload untouched.
const PANEL_PREVIEW_LIMIT = 5;

// The two history dialog variants share one renderer; the value stored in
// state.historyDialog is exactly one of these keys (or null when closed).
const HISTORY_DIALOGS = {
  active: {
    title: "All unfinished games",
    countNoun: "saved games",
    listId: "history-unfinished-list",
    openerAction: "view-all-unfinished"
  },
  finished: {
    title: "All finished games",
    countNoun: "saved games",
    listId: "history-finished-list",
    openerAction: "view-all-finished"
  }
};

// Quick tap presets (add-quick-score-entry): the mockup's seven signed
// amounts, locked as a local constant. Each tap stages the points draft
// (refine-ui-after-testing superseded immediate apply); Save points applies
// the combined draft as one ordinary score change.
const QUICK_SCORE_PRESETS = [1, 5, 10, 25, -1, -5, -10];

const SCORE_ERROR_MESSAGES = {
  "empty": "Enter an amount first.",
  "not-a-number": "Enter a whole number, like 10 or -3.",
  "not-integer": "Decimals are not allowed. Enter a whole number like 10 or -3.",
  "zero": "Zero adds no points. Enter a positive or negative amount.",
  "out-of-range": `Amounts must stay between ${-MAX_SCORE_ABS} and ${MAX_SCORE_ABS}.`,
  "unknown-player": "Select a player before saving points.",
  "not-safe": "That change would create an unsafe total. Try a smaller amount.",
  "nothing-to-undo": "Nothing to undo yet.",
  "missing-game": "No open game to finish.",
  "already-finished": "This game is already finished.",
  "not-finished": "Only finished games can be replayed.",
  "invalid-roster": "This game's saved players can't be replayed.",
  "invalid-title": "Enter the title as plain text.",
  "title-too-long": `Titles can be at most ${MAX_TITLE_LENGTH} characters.`
};

const SCORE_FEEDBACK_CLASS_NAMES = {
  "error": "validation-message",
  "success": "success-message",
  "info": "info-message"
};

const STORAGE_NOTICE_MESSAGES = {
  "invalid": "Saved game data couldn't be read, so saved games can't be shown and new changes won't be saved. Nothing was deleted. Reloading the page will try again.",
  "write": "Your latest change couldn't be saved. The game still works, and nothing already saved was lost — your next change will try again.",
  "unavailable": "Scores aren't being saved because browser storage is unavailable. The game still works, but changes will be lost when you leave this page.",
  "dropped": "Some saved data couldn't be read and was skipped. Other saved games still work."
};

const initialSavedState = loadSavedGames();
state.savedGames = initialSavedState.games;
state.storageReadError = initialSavedState.error;
state.storageDroppedCount = initialSavedState.droppedCount ?? 0;

if (initialSavedState.error) {
  console.warn("Saved game load failed:", initialSavedState.error);
}

if (yearTarget) {
  yearTarget.textContent = String(new Date().getFullYear());
}

render();
bindTopNav();
document.documentElement.dataset.appReady = "true";

function render() {
  if (!appRoot) {
    return;
  }

  if (state.view === "setup") {
    renderSetup();
  } else if (state.view === "active") {
    renderActiveGame();
  } else if (state.view === "active-empty") {
    renderActiveEmpty();
  } else {
    renderHome();
  }

  paintNav();
}

// The header is static markup in index.html, so its handlers bind exactly once.
// Nav items use distinct action ids (nav-*) so they can never collide with the
// in-view data-action values (new-game, back-home, ...) that suites and code target.
function bindTopNav() {
  document.querySelector("[data-action='nav-dashboard']")?.addEventListener("click", handleNavDashboard);
  document.querySelector("[data-action='nav-new-game']")?.addEventListener("click", handleNavNewGame);
  document.querySelector("[data-action='nav-active-game']")?.addEventListener("click", handleNavActiveGame);
}

function handleNavDashboard() {
  // Back-home semantics: leave the current view and clear transient setup errors.
  state.view = "home";
  state.errors = [];
  state.limitMessage = "";
  state.historyDialog = null;
  render();
  appRoot.querySelector("[data-home-heading]")?.focus();
}

function handleNavNewGame() {
  // Destination semantics: show setup as it was left — the scratchpad is not reset.
  state.view = "setup";
  render();
  appRoot.querySelector("[data-setup-heading]")?.focus();
}

function handleNavActiveGame() {
  // (1) A game is already in progress in memory: reopen it without a resume
  // round-trip and without writing (covers blocked-storage sessions too).
  if (state.activeGame && state.activeGame.status === "active") {
    const needsRender = state.view !== "active";
    state.view = "active";

    if (needsRender) {
      render();
    }

    appRoot.querySelector("[data-active-heading]")?.focus();
    return;
  }

  // (2) Otherwise resume the most recently updated saved active game, exactly
  // like the card's Resume button (a read-only restore; no storage write).
  const nextActiveGame = orderSavedGamesForDisplay(state.savedGames)
    .find((game) => game.status === "active") ?? null;

  if (nextActiveGame) {
    handleResume(nextActiveGame.id);

    if (state.view === "active" && state.activeGame?.id === nextActiveGame.id) {
      return;
    }
    // handleResume refused the saved entry (unusable players) — fall through.
  }

  // (3) Nothing in progress: the Active Game empty state.
  state.view = "active-empty";
  render();
  appRoot.querySelector("[data-active-empty-heading]")?.focus();
}

// aria-current is display/state only: it never writes storage and never mutates games.
function paintNav() {
  const dashboardButton = document.querySelector("[data-action='nav-dashboard']");
  const newGameButton = document.querySelector("[data-action='nav-new-game']");
  const activeGameButton = document.querySelector("[data-action='nav-active-game']");
  const viewingFinishedGame = state.view === "active" && state.activeGame?.status === "finished";
  const viewingActiveGame = state.view === "active" && state.activeGame?.status === "active";
  const currentButton = (state.view === "home" || viewingFinishedGame)
    ? dashboardButton
    : state.view === "setup"
      ? newGameButton
      : (state.view === "active-empty" || viewingActiveGame)
        ? activeGameButton
        : null;

  for (const button of [dashboardButton, newGameButton, activeGameButton]) {
    if (!button) {
      continue;
    }

    if (button === currentButton) {
      button.setAttribute("aria-current", "page");
    } else {
      button.removeAttribute("aria-current");
    }
  }
}

function renderHome() {
  const activeGames = orderSavedGamesForDisplay(state.savedGames).filter((game) => game.status === "active");
  const finishedGames = orderSavedGamesForDisplay(state.savedGames).filter((game) => game.status === "finished");
  const suppressionActive = state.storageReadError === "invalid";

  appRoot.innerHTML = `
    <section class="hero-panel" aria-labelledby="home-title">
      <div class="hero-copy">
        <p class="eyebrow">Ready for the next table?</p>
        <h2 id="home-title" tabindex="-1" data-home-heading>Track scores while the game stays on the table.</h2>
        <p>Add the people playing, choose easy-to-spot colors, and start everyone at zero.</p>
      </div>
      <div class="hero-actions" aria-label="Game actions">
        <button type="button" class="primary-action" data-action="new-game">New game</button>
      </div>
    </section>

    <section class="dashboard-grid" aria-label="Game history">
      <article class="panel" aria-labelledby="unfinished-title">
        <div class="panel-heading">
          <span class="dice-card" aria-hidden="true"><span></span><span></span><span></span><span></span></span>
          <div>
            <p class="eyebrow">Home</p>
            <h2 id="unfinished-title">Unfinished games</h2>
          </div>
        </div>
        ${renderStorageNotice()}
        ${renderDroppedEntriesNote()}
        ${activeGames.length > 0 ? `
        ${renderSavedGameList(activeGames.slice(0, PANEL_PREVIEW_LIMIT), "unfinished-game-list")}
        ${renderHistoryOpener({
          action: "view-all-unfinished",
          total: activeGames.length,
          noun: "unfinished games"
        })}
        ` : `
        <div class="empty-state">
          ${suppressionActive ? `
          <p class="empty-title">Saved games can't be shown right now.</p>
          <p>Nothing was deleted — the saved data just couldn't be read.</p>
          ` : `
          <p class="empty-title">No saved games yet.</p>
          <p>Start a new game and it will be saved here so you can resume it later.</p>
          `}
        </div>`}
        <p class="retention-note">Saved only in this browser — clearing site data removes these games.</p>
      </article>

      <article class="panel" aria-labelledby="finished-title">
        <div class="panel-heading">
          <span class="token-stack" aria-hidden="true">
            <span class="marker marker-blue"></span>
            <span class="marker marker-orange"></span>
            <span class="marker marker-green"></span>
          </span>
          <div>
            <p class="eyebrow">History</p>
            <h2 id="finished-title">Finished games</h2>
          </div>
        </div>
        ${finishedGames.length > 0 ? `
        ${renderFinishedGameList(finishedGames.slice(0, PANEL_PREVIEW_LIMIT), "finished-game-list")}
        ${renderHistoryOpener({
          action: "view-all-finished",
          total: finishedGames.length,
          noun: "finished games"
        })}
        ` : `
        <div class="empty-state">
          <p class="empty-title">No finished games yet.</p>
          <p>Finish a game and its standings will appear here.</p>
        </div>`}
      </article>
    </section>
    ${state.historyDialog ? renderHistoryDialog(state.historyDialog) : ""}
  `;

  appRoot.querySelector("[data-action='new-game']")?.addEventListener("click", () => {
    resetSetup();
    state.view = "setup";
    render();
    appRoot.querySelector("#game-title")?.focus();
  });

  appRoot.querySelectorAll("[data-action='resume-game']").forEach((button) => {
    button.addEventListener("click", () => {
      handleResume(button.dataset.gameId);
    });
  });

  appRoot.querySelectorAll("[data-action='view-results']").forEach((button) => {
    button.addEventListener("click", () => {
      handleResume(button.dataset.gameId);
    });
  });

  // History modal openers (refine-podium-and-history-modal): each opener sets
  // the transient variant, re-renders home with the preview still behind the
  // modal, and bindHistoryEvents opens/focuses it. Nothing writes storage.
  appRoot.querySelector("[data-action='view-all-unfinished']")?.addEventListener("click", () => {
    openHistoryDialog("active");
  });

  appRoot.querySelector("[data-action='view-all-finished']")?.addEventListener("click", () => {
    openHistoryDialog("finished");
  });

  bindHistoryEvents();
}

function getStorageNotice() {
  if (state.storageReadError === "invalid") {
    return "invalid";
  }

  if (state.lastSaveError) {
    return state.lastSaveError;
  }

  if (state.storageReadError === "unavailable") {
    return "unavailable";
  }

  return null;
}

function renderStorageNotice() {
  const code = getStorageNotice();

  if (!code) {
    return "";
  }

  return `
    <div class="storage-notice" role="status" data-storage-notice>
      <p class="storage-notice-message">${escapeHtml(STORAGE_NOTICE_MESSAGES[code])}</p>
    </div>
  `;
}

function renderDroppedEntriesNote() {
  if (!(state.storageDroppedCount > 0)) {
    return "";
  }

  return `<p class="storage-notice storage-notice-info">${escapeHtml(STORAGE_NOTICE_MESSAGES.dropped)}</p>`;
}

function paintStorageNotice() {
  const region = appRoot.querySelector("[data-storage-notice]");

  if (!region) {
    return;
  }

  region.replaceChildren();

  const code = getStorageNotice();

  if (!code) {
    return;
  }

  const message = document.createElement("p");
  message.className = "storage-notice-message";
  message.textContent = STORAGE_NOTICE_MESSAGES[code];
  region.append(message);
}

function renderSavedGameList(games, listId = "unfinished-game-list", label = "Saved games") {
  return `
    <ol id="${listId}" class="saved-game-list" aria-label="${escapeAttribute(label)}">
      ${games.map((game) => renderSavedGameCard(game)).join("")}
    </ol>
  `;
}

// Per-panel "View all (N)" opener (refine-podium-and-history-modal superseded
// the refine-ui inline toggle). It renders only above the five-card preview and
// is a dialog opener: visible text is a substring of the accessible name, with
// aria-haspopup="dialog". No aria-expanded/aria-controls and no wrapper at ≤5.
function renderHistoryOpener({ action, total, noun }) {
  if (total <= PANEL_PREVIEW_LIMIT) {
    return "";
  }

  return `
    <div class="history-opener-row">
      <button type="button" class="secondary-action history-opener" data-action="${action}" aria-haspopup="dialog" aria-label="View all (${total}) ${noun}">View all (${total})</button>
    </div>
  `;
}

function renderSavedGameCard(game) {
  const players = Array.isArray(game.players) ? game.players : [];
  const names = players
    .map((player) => (player && typeof player.name === "string" ? escapeHtml(player.name) : ""))
    .filter((name) => name !== "")
    .join(", ");
  const markers = players
    .map((player) => `<span class="marker ${getColor(player?.color).cssClass}" aria-hidden="true"></span>`)
    .join("");
  const gameId = escapeAttribute(game.id ?? "");

  return `
    <li class="saved-game" data-saved-game-id="${gameId}">
      <div class="saved-game-info">
        <p class="saved-game-title">${escapeHtml(displayGameTitle(game))}</p>
        <p class="saved-game-meta">${players.length} players</p>
        <p class="saved-game-updated">${escapeHtml(formatSavedGameUpdated(game))}</p>
        ${names ? `<p class="saved-game-names">${names}</p>` : ""}
        ${markers ? `<div class="saved-game-markers">${markers}</div>` : ""}
      </div>
      <button type="button" class="secondary-action resume-action" data-action="resume-game" data-game-id="${gameId}" aria-label="Resume ${escapeAttribute(displayGameTitle(game))}">Resume</button>
    </li>
  `;
}

function renderFinishedGameList(games, listId = "finished-game-list", label = "Finished games") {
  return `
    <ol id="${listId}" class="saved-game-list" aria-label="${escapeAttribute(label)}">
      ${games.map((game) => renderFinishedGameCard(game)).join("")}
    </ol>
  `;
}

function renderFinishedGameCard(game) {
  const players = Array.isArray(game.players) ? game.players : [];
  const names = players
    .map((player) => (player && typeof player.name === "string" ? escapeHtml(player.name) : ""))
    .filter((name) => name !== "")
    .join(", ");
  const markers = players
    .map((player) => `<span class="marker ${getColor(player?.color).cssClass}" aria-hidden="true"></span>`)
    .join("");
  const gameId = escapeAttribute(game.id ?? "");

  return `
    <li class="saved-game saved-game-finished" data-saved-game-id="${gameId}">
      <div class="saved-game-info">
        <p class="saved-game-title">${escapeHtml(displayGameTitle(game))}</p>
        <p class="saved-game-meta">${players.length} players</p>
        <p class="saved-game-updated">${escapeHtml(formatSavedGameUpdated(game))}</p>
        ${names ? `<p class="saved-game-names">${names}</p>` : ""}
        ${markers ? `<div class="saved-game-markers">${markers}</div>` : ""}
      </div>
      <button type="button" class="secondary-action resume-action" data-action="view-results" data-game-id="${gameId}" aria-label="View results ${escapeAttribute(displayGameTitle(game))}">View results</button>
    </li>
  `;
}

// History modal (refine-podium-and-history-modal): one per panel variant,
// listing every saved game of that status in the accepted most-recent-first
// order using the unchanged card renderers. The five-card preview stays
// rendered behind the modal; opening and closing are display-only and never
// write storage. The list renderers are generalized with a dialog-scoped id
// and accessible label so the background preview keeps its accepted ids.
function renderHistoryDialog(kind) {
  const config = HISTORY_DIALOGS[kind];

  if (!config) {
    return "";
  }

  const games = orderSavedGamesForDisplay(state.savedGames)
    .filter((game) => game.status === (kind === "active" ? "active" : "finished"));
  const list = kind === "active"
    ? renderSavedGameList(games, config.listId, config.title)
    : renderFinishedGameList(games, config.listId, config.title);

  return `
    <dialog class="history-dialog" data-history-dialog aria-labelledby="history-dialog-title" aria-describedby="history-dialog-count">
      <div class="history-dialog-body">
        <div class="history-dialog-header">
          <div>
            <h2 id="history-dialog-title" class="history-dialog-title">${config.title}</h2>
            <p id="history-dialog-count" class="history-dialog-count">${games.length} ${config.countNoun}</p>
          </div>
          <button type="button" class="history-close" data-action="close-history" aria-label="Close game history">
            <svg class="icon-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>
          </button>
        </div>
        ${list}
      </div>
    </dialog>
  `;
}

function openHistoryDialog(kind) {
  if (!HISTORY_DIALOGS[kind]) {
    return;
  }

  state.historyDialog = kind;
  render();
}

// Close button, Escape, and backdrop click all funnel through one synchronous
// cleanup: close the live dialog, clear the transient variant, re-render home,
// and return focus to that panel's opener. A queued `close` event from a
// detached dialog is ignored (the accepted modal precedent).
function handleHistoryClose(kind) {
  if (state.historyDialog !== kind) {
    return;
  }

  state.historyDialog = null;
  render();
  appRoot.querySelector(`[data-action='${HISTORY_DIALOGS[kind].openerAction}']`)?.focus();
}

function bindHistoryEvents() {
  const dialog = appRoot.querySelector("[data-history-dialog]");
  const kind = state.historyDialog;

  if (!dialog || !HISTORY_DIALOGS[kind]) {
    return;
  }

  const dismissHistory = () => {
    if (dialog.open) {
      dialog.close();
    }
    handleHistoryClose(kind);
  };

  dialog.querySelector("[data-action='close-history']")?.addEventListener("click", dismissHistory);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      dismissHistory();
    }
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    dismissHistory();
  });
  dialog.addEventListener("close", () => {
    if (!dialog.isConnected) {
      return;
    }
    handleHistoryClose(kind);
  });

  if (!dialog.open) {
    dialog.showModal();
  }
  dialog.querySelector("[data-action='close-history']")?.focus();
}

// Card recency label (track-game-activity): the storage-owned `updatedAt`
// first, then `createdAt`, each rendered through the deterministic relative
// formatter ("Updated just now" / "Updated 10m ago" / "Updated 12 Oct, 21:08").
// When neither stamp parses, the bare "Updated" fallback stays, matching the
// accepted `/^Updated /` card contract.
function formatSavedGameUpdated(game) {
  for (const candidate of [game?.updatedAt, game?.createdAt]) {
    const token = formatRelativeTimestamp(candidate);

    if (token) {
      return `Updated ${token}`;
    }
  }

  return "Updated";
}

function handleResume(gameId) {
  const game = state.savedGames.find((candidate) => candidate?.id === gameId) ?? null;

  if (!game || !Array.isArray(game.players) || game.players.length === 0) {
    return;
  }

  state.activeGame = game;
  state.selectedPlayerId = game.players[0]?.id ?? null;
  state.scoreFeedback = null;
  state.finishPromptOpen = false;
  state.podiumOpen = false;
  state.replayFeedback = null;
  state.titleEditOpen = false;
  state.titleDraft = "";
  state.titleEditFeedback = null;
  state.historyDialog = null;
  state.view = "active";
  render();
  appRoot.querySelector("[data-active-heading]")?.focus();
}

function renderSetup() {
  const validation = validateRoster(state.rows);
  const atLimit = state.rows.length >= MAX_PLAYERS;
  const canRemove = state.rows.length > MIN_PLAYERS;

  appRoot.innerHTML = `
    <section class="setup-layout" aria-labelledby="setup-title">
      <div class="setup-panel">
        <div class="setup-heading">
          <div>
            <p class="eyebrow">New game</p>
            <h2 id="setup-title" tabindex="-1" data-setup-heading>Who is playing?</h2>
          </div>
          <span class="status-pill">${state.rows.length}/${MAX_PLAYERS} players</span>
        </div>

        <form class="roster-form" novalidate data-roster-form>
          <label class="field-label" for="game-title">Game title</label>
          <input id="game-title" class="text-field" name="title" maxlength="${MAX_TITLE_LENGTH}" value="${escapeAttribute(state.title)}" placeholder="Optional — e.g. Friday game night" autocomplete="off">

          <div class="player-list" aria-label="Players">
            ${state.rows.map((row, index) => renderSetupRow(row, index, canRemove)).join("")}
          </div>

          <div id="setup-feedback" class="form-feedback" aria-live="polite">
            ${state.errors.map((error) => `<p class="validation-message">${escapeHtml(error)}</p>`).join("")}
            ${state.limitMessage ? `<p class="limit-message">${escapeHtml(state.limitMessage)}</p>` : ""}
          </div>

          <div class="setup-actions">
            <button type="button" class="secondary-action" data-action="add-player" ${atLimit ? "disabled" : ""}>Add player</button>
            <button type="submit" class="primary-action" aria-describedby="setup-help setup-feedback">Start game</button>
            <button type="button" class="ghost-action" data-action="back-home">Back</button>
          </div>
          <p id="setup-help" class="assistive-text">Start with ${MIN_PLAYERS} to ${MAX_PLAYERS} players. Names can repeat, but blank names cannot start a game.</p>
        </form>
      </div>

      <aside class="panel setup-note" aria-labelledby="setup-note-title">
        <div class="panel-heading">
          <span class="token-stack" aria-hidden="true">
            <span class="marker marker-blue"></span>
            <span class="marker marker-yellow"></span>
            <span class="marker marker-black"></span>
          </span>
          <div>
            <p class="eyebrow">Table colors</p>
            <h2 id="setup-note-title">Easy to tell apart</h2>
          </div>
        </div>
        <p>Colors can repeat. Player numbers keep everyone distinct when names or colors match.</p>
      </aside>
    </section>
  `;

  bindSetupEvents();
}

function renderSetupRow(row, index, canRemove) {
  const playerNumber = index + 1;
  const selectedColor = getColor(row.color);

  return `
    <fieldset class="player-row" data-player-index="${index}">
      <legend>Player ${playerNumber}</legend>
      <div class="player-row-main">
        <span class="player-token ${selectedColor.cssClass}" aria-hidden="true">${playerNumber}</span>
        <div class="name-field">
          <label class="field-label" for="player-name-${playerNumber}">Player ${playerNumber} name</label>
          <input id="player-name-${playerNumber}" class="text-field" name="player-${playerNumber}" maxlength="${MAX_NAME_LENGTH}" value="${escapeAttribute(row.name)}" data-field="name" autocomplete="off">
        </div>
        <button type="button" class="icon-action" data-action="remove-player" ${canRemove ? "" : "disabled"} aria-label="Remove player ${playerNumber}">Remove</button>
      </div>
      <div class="color-options" role="radiogroup" aria-label="Color for player ${playerNumber}">
        ${PLAYER_COLORS.map((color) => `
          <label class="color-choice">
            <input type="radio" name="color-${playerNumber}" value="${color.id}" data-field="color" ${row.color === color.id ? "checked" : ""}>
            <span class="marker ${color.cssClass}" aria-hidden="true"></span>
            <span>${color.label}</span>
          </label>
        `).join("")}
      </div>
    </fieldset>
  `;
}

function bindSetupEvents() {
  const form = appRoot.querySelector("[data-roster-form]");

  appRoot.querySelector("#game-title")?.addEventListener("input", (event) => {
    state.title = event.target.value;
  });

  appRoot.querySelectorAll("[data-field='name']").forEach((input) => {
    input.addEventListener("input", (event) => {
      const row = event.target.closest("[data-player-index]");
      state.rows[Number(row.dataset.playerIndex)].name = event.target.value;
      state.errors = [];
    });
  });

  appRoot.querySelectorAll("[data-field='color']").forEach((input) => {
    input.addEventListener("change", (event) => {
      const row = event.target.closest("[data-player-index]");
      state.rows[Number(row.dataset.playerIndex)].color = event.target.value;
      state.errors = [];
      render();
    });
  });

  appRoot.querySelector("[data-action='add-player']")?.addEventListener("click", () => {
    if (state.rows.length >= MAX_PLAYERS) {
      state.limitMessage = `You can add up to ${MAX_PLAYERS} players.`;
      render();
      return;
    }

    state.rows.push({
      ...createSetupRow(state.nextRowNumber, state.rows.length),
      color: colorForIndex(state.rows.length)
    });
    state.nextRowNumber += 1;
    state.limitMessage = state.rows.length >= MAX_PLAYERS ? `You can add up to ${MAX_PLAYERS} players.` : "";
    state.errors = [];
    render();
    appRoot.querySelector(`[data-player-index="${state.rows.length - 1}"] input`)?.focus();
  });

  appRoot.querySelectorAll("[data-action='remove-player']").forEach((button) => {
    button.addEventListener("click", (event) => {
      const row = event.target.closest("[data-player-index]");
      if (state.rows.length <= MIN_PLAYERS) {
        return;
      }
      state.rows.splice(Number(row.dataset.playerIndex), 1);
      state.limitMessage = "";
      state.errors = [];
      render();
    });
  });

  appRoot.querySelector("[data-action='back-home']")?.addEventListener("click", () => {
    state.view = "home";
    state.errors = [];
    state.limitMessage = "";
    render();
    appRoot.querySelector("[data-action='new-game']")?.focus();
  });

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const { game, validation } = createGame({
      title: state.title,
      rows: state.rows,
      now: new Date(),
      idSeed: "active-game"
    });

    if (!validation.valid || !game) {
      state.errors = validation.errors;
      state.limitMessage = "";
      render();
      focusFirstInvalidName();
      return;
    }

    state.activeGame = game;
    state.selectedPlayerId = game.players[0]?.id ?? null;
    state.scoreFeedback = null;
    state.view = "active";
    state.errors = [];
    state.limitMessage = "";
    persistActiveGameSnapshot();
    render();
    paintStorageNotice();
    appRoot.querySelector("[data-active-heading]")?.focus();
  });
}

function renderActiveGame() {
  const game = state.activeGame;

  if (!game) {
    state.view = "home";
    renderHome();
    return;
  }

  if (game.status === "finished") {
    renderFinishedGame(game);
    return;
  }

  if (!game.players.some((player) => player.id === state.selectedPlayerId)) {
    state.selectedPlayerId = game.players[0]?.id ?? null;
  }

  const selectedPlayer = game.players.find((player) => player.id === state.selectedPlayerId) ?? null;
  // Badge numbers derive once per surface render (show-player-numbers) and are
  // threaded into the row/card renderers; nothing here writes storage.
  const numbers = playerNumbers(game);
  // The distribution block derives once per render from the current totals
  // (show-score-distribution) — recomputed on every render of the active view,
  // so saves, undos, and reorders re-derive it for free. Nothing is cached and
  // nothing is persisted.
  const distribution = scoreDistribution(game);

  appRoot.innerHTML = `
    <section class="active-layout" aria-labelledby="active-title">
      <div class="active-board">
        <div class="active-header">
          <button type="button" class="ghost-action" data-action="back-home">All games</button>
          ${state.titleEditOpen ? renderTitleEditForm() : `
          <div>
            <p class="eyebrow">In progress</p>
            <h2 id="active-title" tabindex="-1" data-active-heading>${escapeHtml(displayGameTitle(game))}</h2>
          </div>
          <button type="button" class="title-edit-action" data-action="open-title-edit">Edit title</button>
          `}
          <span class="status-pill">${game.players.length} players</span>
          ${state.finishPromptOpen ? "" : renderFinishOpener()}
        </div>

        ${state.finishPromptOpen ? renderFinishPrompt() : ""}

        <div class="panel roster-panel">
          <div class="panel-heading">
            <span class="dice-card" aria-hidden="true"><span></span><span></span><span></span><span></span></span>
            <div>
              <p class="eyebrow">Leaderboard</p>
              <h3>Highest total leads; ties share rank.</h3>
            </div>
          </div>

          ${renderStorageNotice()}

          <ol class="active-roster" aria-label="Active game players">
            ${rankPlayers(game).map((row) => renderActivePlayer(row.player, row.rank, row.player.id === state.selectedPlayerId, numbers.get(row.player.id))).join("")}
          </ol>

          ${renderScoreDistribution(distribution)}
        </div>
      </div>

      <aside class="panel score-panel" aria-labelledby="score-panel-title">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Score entry</p>
            <h3 id="score-panel-title">Add points</h3>
          </div>
        </div>
        ${selectedPlayer ? renderScoreForm(selectedPlayer, numbers.get(selectedPlayer.id)) : ""}
        ${renderRecentEntries(game)}
      </aside>
    </section>
  `;

  bindActiveEvents();
}

// Inline title-edit form replacing the active heading and the Edit title
// control while state.titleEditOpen is set. The draft is the raw stored title
// (never the auto-label); the polite feedback region carries rename errors.
function renderTitleEditForm() {
  return `
    <form class="title-edit-form" novalidate data-title-edit-form>
      <p class="eyebrow">In progress</p>
      <label class="field-label" for="active-title-input">Game title</label>
      <input id="active-title-input" class="text-field" name="title" maxlength="${MAX_TITLE_LENGTH}" value="${escapeAttribute(state.titleDraft)}" autocomplete="off">
      <div id="title-edit-feedback" class="form-feedback" aria-live="polite">${renderTitleEditFeedback()}</div>
      <div class="title-edit-actions">
        <button type="submit" class="primary-action">Save title</button>
        <button type="button" class="secondary-action" data-action="cancel-title-edit">Cancel</button>
      </div>
    </form>
  `;
}

function renderTitleEditFeedback() {
  if (!state.titleEditFeedback) {
    return "";
  }

  return `<p class="${scoreFeedbackClassName(state.titleEditFeedback.kind)}">${escapeHtml(state.titleEditFeedback.message)}</p>`;
}

// Score distribution block (show-score-distribution): a display-only derivation
// rendered inside the active view's leaderboard panel, immediately after the
// standings rows. The header (eyebrow + signed "{N} total game points") always
// renders so the block never disappears silently; the bar and legend render
// only while the game total is positive, showing one segment and one legend
// entry per positive-total player (zero-total players hold no share). There
// are no interactive controls and no live region of its own — #score-feedback
// already announces saves and undoes, and the block re-renders with the view.
function renderScoreDistribution(distribution) {
  const totalLine = `${distribution.gameTotal} total game points`;

  if (distribution.rows.length === 0) {
    return `
      <div class="score-distribution" data-score-distribution>
        <div class="score-distribution-header">
          <p class="eyebrow">Score distribution</p>
          <p class="score-distribution-total">${escapeHtml(totalLine)}</p>
        </div>
        <p class="score-distribution-empty">No shares to show while the game total is zero or negative.</p>
      </div>
    `;
  }

  return `
    <div class="score-distribution" data-score-distribution>
      <div class="score-distribution-header">
        <p class="eyebrow">Score distribution</p>
        <p class="score-distribution-total">${escapeHtml(totalLine)}</p>
      </div>
      <div class="score-distribution-bar" aria-hidden="true">
        ${distribution.rows.map((row) => renderScoreDistributionSegment(row)).join("")}
      </div>
      <ul class="score-distribution-legend" aria-label="Score distribution">
        ${distribution.rows.map((row) => renderScoreDistributionLegendItem(row)).join("")}
      </ul>
    </div>
  `;
}

// Segment width is the integer percent exactly (no min-width), so the rendered
// geometry never disagrees with the legend numbers; the color classes reuse the
// marker backgrounds so every segment is the player's exact token color.
function renderScoreDistributionSegment(row) {
  const color = getColor(row.player.color);

  return `<span class="score-distribution-segment ${color.cssClass}" style="width:${row.percent}%"></span>`;
}

// The legend is the accessible representation: real text "{name} {percent}%"
// beside an aria-hidden color dot — color is never the only signal.
function renderScoreDistributionLegendItem(row) {
  const color = getColor(row.player.color);

  return `
    <li class="score-distribution-legend-item">
      <span class="marker ${color.cssClass}" aria-hidden="true"></span>
      <span class="score-distribution-legend-text">${escapeHtml(row.player.name)} ${row.percent}%</span>
    </li>
  `;
}

// New Active Game destination empty state (locked copy from the spec). It is
// only reached through the top navigation; the non-nav renderActiveGame
// `!game` redirect to home stays untouched. Navigation never writes storage.
function renderActiveEmpty() {
  appRoot.innerHTML = `
    <section class="active-empty" aria-labelledby="active-empty-title">
      <div class="empty-state">
        <p class="eyebrow">Active game</p>
        <h2 id="active-empty-title" class="empty-title" tabindex="-1" data-active-empty-heading>No game in progress</h2>
        <p>Start a new game to begin tracking scores. It will appear here until it's finished.</p>
        <button type="button" class="primary-action" data-action="new-game">New game</button>
      </div>
    </section>
  `;

  appRoot.querySelector("[data-action='new-game']")?.addEventListener("click", () => {
    resetSetup();
    state.view = "setup";
    render();
    appRoot.querySelector("#game-title")?.focus();
  });
}

// Finish game moved into the active header (refine-ui-after-testing): the
// opener sits in the header's final slot, and the unchanged confirmation
// renders below the header and above the leaderboard panel inside
// .active-board. Hooks, ids, copy, focus moves, and the confirm flow are
// preserved byte-for-byte.
function renderFinishOpener() {
  return `
    <div class="finish-opener" data-finish-section>
      <button type="button" class="finish-action" data-action="open-finish">Finish game</button>
    </div>
  `;
}

function renderFinishPrompt() {
  return `
    <div class="finish-section" data-finish-section>
      <div class="finish-prompt">
        <p class="finish-prompt-title">Finish this game?</p>
        <p id="finish-warning" class="finish-prompt-warning">Finished games can't be reopened for scoring. Final standings stay saved in this browser.</p>
        <div class="finish-prompt-actions">
          <button type="button" class="finish-action" data-action="confirm-finish" aria-describedby="finish-warning">Finish game</button>
          <button type="button" class="secondary-action" data-action="cancel-finish">Cancel</button>
        </div>
      </div>
    </div>
  `;
}

function renderFinishedGame(game) {
  const podium = podiumRows(game);
  // Badge numbers derive once per surface render (show-player-numbers) and are
  // threaded into the standings rows; the podium dialog derives its own map
  // from the same game. Nothing here writes storage.
  const numbers = playerNumbers(game);

  appRoot.innerHTML = `
    <section class="active-layout is-finished" aria-labelledby="active-title">
      <div class="active-board">
        <div class="active-header">
          <button type="button" class="ghost-action" data-action="back-home">All games</button>
          <div>
            <p class="eyebrow">Finished</p>
            <h2 id="active-title" tabindex="-1" data-active-heading>${escapeHtml(displayGameTitle(game))}</h2>
          </div>
          <span class="status-pill">${game.players.length} players</span>
        </div>

        <div class="panel roster-panel">
          <div class="panel-heading">
            <span class="dice-card" aria-hidden="true"><span></span><span></span><span></span><span></span></span>
            <div>
              <p class="eyebrow">Leaderboard</p>
              <h3>Highest total leads; ties share rank.</h3>
            </div>
          </div>

          <p class="finished-note" role="status" data-finished-note>Final standings — this game is finished and can't be scored.</p>

          ${renderStorageNotice()}

          <ol class="active-roster" aria-label="Active game players">
            ${rankPlayers(game).map((row) => renderFinishedPlayer(row.player, row.rank, numbers.get(row.player.id))).join("")}
          </ol>

          <div class="replay-section">
            <button type="button" class="primary-action" data-action="play-again">Play again</button>
            <div id="replay-feedback" class="form-feedback" aria-live="polite">${renderReplayFeedback()}</div>
          </div>
        </div>
      </div>
    </section>
    ${state.podiumOpen && podium.length > 0 ? renderPodiumDialog(podium, game) : ""}
  `;

  bindActiveEvents();
  bindPodiumEvents();
}

function renderPodiumDialog(podium, game) {
  // Badge numbers derive once for the dialog from the same game
  // (show-player-numbers); positional numbers are immune to any stored marker.
  const numbers = playerNumbers(game);
  const groups = [1, 2, 3]
    .map((rank) => {
      const rows = podium.filter((row) => row.rank === rank);

      if (rows.length === 0) {
        return "";
      }

      return `
        <li class="podium-group podium-step${rank === 1 ? " is-rank-one" : ""}" data-rank="${rank}">
          <h3 class="podium-rank-heading">Rank ${rank}</h3>
          ${rank === 1 ? renderPodiumCrown() : ""}
          <ul class="podium-players">
            ${rows.map((row) => renderPodiumPlayer(row.player, row.rank, numbers.get(row.player.id))).join("")}
          </ul>
          ${renderPodiumPedestal(rank)}
        </li>
      `;
    })
    .join("");

  // Ranked summary (refine-podium-and-history-modal superseded the
  // refine-ui "Rest of the table" list): every player in ranking order, grouped
  // by competition rank, so the steps celebrate the top three while the cards
  // stay the scannable full table. Display-only, fresh derivation per render.
  const summaryGroups = [];
  for (const row of rankPlayers(game)) {
    const last = summaryGroups[summaryGroups.length - 1];

    if (last && last.rank === row.rank) {
      last.rows.push(row);
    } else {
      summaryGroups.push({ rank: row.rank, rows: [row] });
    }
  }
  const summary = summaryGroups.length > 0 ? `
        <section class="podium-summary" aria-label="Ranked summary">
          ${summaryGroups.map((group) => `
          <div class="podium-summary-group" data-rank="${group.rank}">
            <p class="podium-summary-rank-label">Rank ${group.rank}</p>
            <ul class="podium-summary-cards">
              ${group.rows.map((row) => renderPodiumSummaryCard(row, numbers.get(row.player.id))).join("")}
            </ul>
          </div>
          `).join("")}
        </section>
  ` : "";

  return `
    <dialog class="podium-dialog" data-podium-dialog aria-labelledby="podium-title" aria-describedby="podium-lede">
      <div class="podium-body">
        <div class="podium-confetti" data-podium-confetti aria-hidden="true">${renderPodiumConfetti()}</div>
        <div class="podium-topline">
          <span class="podium-pill">Game concluded</span>
          <button type="button" class="podium-corner-close" data-action="close-podium-corner" aria-label="Close podium">
            <svg class="icon-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>
          </button>
        </div>
        <p class="podium-game-title">${escapeHtml(displayGameTitle(game))}</p>
        <h2 id="podium-title" class="podium-title">Final podium</h2>
        <p id="podium-lede" class="podium-lede">Congratulations to the top of the table.</p>
        <ol class="podium-groups" aria-label="Podium steps">${groups}</ol>
        <p class="podium-tie-note">Ties share rank and step position automatically</p>
        ${summary}
        <div class="podium-actions">
          <button type="button" class="primary-action podium-play-again" data-action="podium-play-again">Play again (same players, reset scores)</button>
          <div class="podium-actions-row">
            <button type="button" class="secondary-action podium-close" data-action="close-podium">Close &amp; view full standings</button>
            <button type="button" class="secondary-action podium-exit-dashboard" data-action="podium-exit-dashboard">Save &amp; exit to Dashboard</button>
          </div>
        </div>
      </div>
    </dialog>
  `;
}

// Contestant card above the pedestal (Decision 1): token + a text column
// (name over {total} pts). Names get the remaining width and normal word
// wrapping; the total stays readable on its own line. The rank stays present
// for existing reads but is visually hidden (the pedestal carries it visibly).
function renderPodiumPlayer(player, rank, playerNumber) {
  const color = getColor(player.color);

  return `
    <li class="podium-player">
      <span class="podium-player-rank">${rank}</span>
      <span class="player-token ${color.cssClass}" aria-label="Player ${playerNumber}, ${color.label}">${playerNumber}</span>
      <span class="podium-player-text">
        <span class="podium-player-name">${escapeHtml(player.name)}</span>
        <span class="podium-player-points">
          <span class="podium-player-total" aria-label="${escapeAttribute(player.name)}: rank ${rank}, total ${player.total}">${String(player.total)}</span>
          <span class="podium-player-pts">pts</span>
        </span>
      </span>
    </li>
  `;
}

function renderPodiumCrown() {
  return `
    <span class="podium-crown" aria-hidden="true">
      <svg class="podium-crown-glyph" viewBox="0 0 24 24" focusable="false"><path d="M3 8l4.4 3.1L12 4l4.6 7.1L21 8l-1.7 10H4.7L3 8Z" fill="currentColor"></path></svg>
    </span>
  `;
}

// Rank-specific pedestal block below each step's contestants. Ranks 1/2/3 get
// Winner/Silver/Bronze labels; CSS supplies the tinted surfaces and the
// 144/96/72px height ladder so rank 1 is visibly tallest.
function renderPodiumPedestal(rank) {
  const labels = { 1: "Winner", 2: "Silver", 3: "Bronze" };

  return `
    <div class="podium-pedestal" data-pedestal-rank="${rank}">
      <span class="podium-pedestal-rank">${rank}</span>
      <span class="podium-pedestal-label">${labels[rank]}</span>
    </div>
  `;
}

// Ranked summary card: leading rank numeral, badge token, name, and total with
// its own visible pts label. Keeps the frozen total aria-label convention.
function renderPodiumSummaryCard({ player, rank }, playerNumber) {
  const color = getColor(player.color);

  return `
    <li class="podium-summary-card">
      <span class="podium-summary-card-rank">${rank}</span>
      <span class="player-token ${color.cssClass}" aria-label="Player ${playerNumber}, ${color.label}">${playerNumber}</span>
      <span class="podium-summary-name">${escapeHtml(player.name)}</span>
      <span class="podium-summary-points">
        <span class="podium-summary-total" aria-label="${escapeAttribute(player.name)}: rank ${rank}, total ${player.total}">${String(player.total)}</span>
        <span class="podium-summary-pts">pts</span>
      </span>
    </li>
  `;
}

function renderPodiumConfetti() {
  const confettiColors = ["--blue", "--red", "--yellow", "--green", "--orange"];
  const pieces = [];

  for (let index = 0; index < 14; index += 1) {
    const left = 3 + ((index * 7) % 94);
    const delay = ((index * 137) % 80) / 100;
    const duration = 1.6 + ((index * 29) % 80) / 100;
    const drift = ((index * 53) % 41) - 20;
    const spin = (index % 2 === 0 ? 1 : -1) * (240 + ((index * 37) % 200));
    const size = 8 + (index % 5);
    const color = confettiColors[index % confettiColors.length];

    pieces.push(
      `<span class="confetti-piece" style="--confetti-left:${left}%;--confetti-delay:${delay}s;--confetti-duration:${duration}s;--confetti-drift:${drift}px;--confetti-spin:${spin}deg;--confetti-size:${size}px;--confetti-color:var(${color})"></span>`
    );
  }

  return pieces.join("");
}

function bindPodiumEvents() {
  const dialog = appRoot.querySelector("[data-podium-dialog]");

  if (!dialog) {
    return;
  }

  // Chrome dispatches the dialog `close` event as a queued task that can be
  // delayed (and starved for hidden pages), so every dismissal path funnels
  // through one synchronous cleanup instead of waiting for that event. The
  // idempotent `close` listener below stays as a fallback for any other path.
  const dismissPodium = () => {
    if (dialog.open) {
      dialog.close();
    }
    handlePodiumClose();
  };

  appRoot.querySelector("[data-action='close-podium']")?.addEventListener("click", dismissPodium);
  // Corner X (refine-podium-and-history-modal): a second dismiss affordance,
  // not a fourth product action — it routes through the same funnel.
  appRoot.querySelector("[data-action='close-podium-corner']")?.addEventListener("click", dismissPodium);

  // Podium actions (extend-podium-actions). Replay delegates to the unchanged
  // handlePlayAgain after closing the live dialog; the queued `close` event
  // this triggers is ignored by the detached-dialog guard below once the
  // re-render replaces the dialog. Exit is pure navigation (no write).
  appRoot.querySelector("[data-action='podium-play-again']")?.addEventListener("click", () => {
    if (!state.podiumOpen) {
      return;
    }

    if (dialog.open) {
      dialog.close();
    }
    handlePlayAgain();
  });

  appRoot.querySelector("[data-action='podium-exit-dashboard']")?.addEventListener("click", () => {
    handlePodiumExitDashboard();
  });

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      dismissPodium();
    }
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    dismissPodium();
  });
  dialog.addEventListener("close", () => {
    // Chrome queues the dialog `close` event and can deliver it long after the
    // dialog has left the DOM (the documented hidden-page task starvation).
    // A close from a detached dialog is stale — two podiums in one document
    // lifetime (finish → dismiss → replay → finish again) would otherwise let
    // it clobber the new podium's open state and re-render without it. The
    // live dialog's dismissal paths already funnel through handlePodiumClose
    // synchronously; this listener stays a fallback for live-dialog closes.
    if (!dialog.isConnected) {
      return;
    }
    handlePodiumClose();
  });

  if (state.podiumOpen) {
    if (!dialog.open) {
      dialog.showModal();
    }
    // Focus stays on the locked footer dismiss control, but a native focus move
    // scrolls the dialog to its target. Reset the scroll position before and
    // after the prevented-scroll focus so the celebratory stage always opens at
    // the top (pill/title/crown first) instead of at the footer actions.
    dialog.scrollTop = 0;
    appRoot.querySelector("[data-action='close-podium']")?.focus({ preventScroll: true });
    dialog.scrollTop = 0;
  }
}

function handlePodiumClose() {
  if (!state.podiumOpen) {
    return;
  }

  state.podiumOpen = false;
  render();
  appRoot.querySelector("[data-active-heading]")?.focus();
}

// "Save & exit to Dashboard" (extend-podium-actions) is navigation only: the
// game is already persisted by finishing, so this never writes — it dismisses
// the live dialog and mirrors the accepted active-view back-home reset
// verbatim, landing focus on the Dashboard heading. The queued `close` event
// is ignored by the detached-dialog guard once render() replaces the dialog
// (and handlePodiumClose would no-op anyway: podiumOpen is already false).
function handlePodiumExitDashboard() {
  if (!state.podiumOpen) {
    return;
  }

  const dialog = appRoot.querySelector("[data-podium-dialog]");

  if (dialog?.open) {
    dialog.close();
  }

  state.view = "home";
  state.selectedPlayerId = null;
  state.scoreFeedback = null;
  state.finishPromptOpen = false;
  state.podiumOpen = false;
  state.replayFeedback = null;
  state.titleEditOpen = false;
  state.titleDraft = "";
  state.titleEditFeedback = null;
  state.historyDialog = null;
  render();
  appRoot.querySelector("[data-home-heading]")?.focus();
}

function renderFinishedPlayer(player, rank, playerNumber) {
  const color = getColor(player.color);

  return `
    <li class="active-player is-final" data-player-id="${escapeAttribute(player.id)}">
      <span class="active-player-rank">${rank}</span>
      <span class="player-token ${color.cssClass}" aria-label="Player ${playerNumber}, ${color.label}">${playerNumber}</span>
      <span class="active-player-name">${escapeHtml(player.name)}</span>
      <span class="active-player-total" aria-label="${escapeAttribute(player.name)}: rank ${rank}, total ${player.total}">${String(player.total)}</span>
    </li>
  `;
}

function renderActivePlayer(player, rank, isSelected, playerNumber) {
  const color = getColor(player.color);

  return `
    <li class="active-player${isSelected ? " is-selected" : ""}" data-player-id="${escapeAttribute(player.id)}">
      <span class="active-player-rank">${rank}</span>
      <span class="player-token ${color.cssClass}" aria-label="Player ${playerNumber}, ${color.label}">${playerNumber}</span>
      <span class="active-player-name">${escapeHtml(player.name)}</span>
      <span class="active-player-total" aria-label="${escapeAttribute(player.name)}: rank ${rank}, total ${player.total}">${String(player.total)}</span>
      <button type="button" class="add-points-action" data-action="select-player" aria-pressed="${isSelected ? "true" : "false"}" aria-label="Add points for ${escapeAttribute(player.name)}">Add points</button>
    </li>
  `;
}

function renderScoreForm(player, playerNumber) {
  const color = getColor(player.color);

  return `
    <form class="score-form" novalidate data-score-form>
      <p class="score-selected">
        <span class="player-token ${color.cssClass}" aria-hidden="true">${playerNumber}</span>
        <span class="score-selected-name">${escapeHtml(player.name)}</span>
        <span class="score-selected-number">Player ${playerNumber}</span>
      </p>

      <label class="field-label" for="score-amount">Points for ${escapeHtml(player.name)}</label>
      <div class="score-stepper">
        <button type="button" class="stepper-action" data-action="step-score-down" aria-label="Decrease points draft by 1 for ${escapeAttribute(player.name)}">-</button>
        <input id="score-amount" class="text-field score-amount-field" name="amount" type="number" step="1" min="${-MAX_SCORE_ABS}" max="${MAX_SCORE_ABS}" autocomplete="off" aria-describedby="score-help score-feedback">
        <button type="button" class="stepper-action" data-action="step-score-up" aria-label="Increase points draft by 1 for ${escapeAttribute(player.name)}">+</button>
      </div>

      <p id="score-help" class="assistive-text">Use negative points for penalties. Whole numbers from ${-MAX_SCORE_ABS} to ${MAX_SCORE_ABS}.</p>

      <div id="score-feedback" class="form-feedback" aria-live="polite">${renderScoreFeedback()}</div>

      ${renderQuickScores(player)}

      <button type="submit" class="primary-action">Save points</button>
      <button type="button" class="secondary-action" data-action="undo-last-score">Undo last score</button>
    </form>
  `;
}

// Quick tap counters (add-quick-score-entry): the mockup's seven presets as
// two rows (+ row then − row) inside one labelled group, rendered between the
// polite feedback region and Save points. Every control is type="button" so a
// tap can never submit the form; negative chips carry the soft-tint class.
function renderQuickScores(player) {
  const positiveRow = QUICK_SCORE_PRESETS.filter((amount) => amount > 0);
  const negativeRow = QUICK_SCORE_PRESETS.filter((amount) => amount < 0);

  return `
    <div class="quick-scores" role="group" aria-label="Quick tap counters">
      <p class="eyebrow quick-scores-eyebrow">Quick tap counters</p>
      <div class="quick-scores-row">
        ${positiveRow.map((amount) => renderQuickScoreButton(amount, player)).join("")}
      </div>
      <div class="quick-scores-row">
        ${negativeRow.map((amount) => renderQuickScoreButton(amount, player)).join("")}
      </div>
    </div>
  `;
}

function renderQuickScoreButton(amount, player) {
  // Accessible name carries the signed amount with correct pluralization for
  // |n| = 1 ("Add -1 point to the points draft for Alex") and says "draft"
  // (refine-ui-after-testing superseded immediate apply). The visible label
  // keeps the ASCII sign.
  const pointsWord = Math.abs(amount) === 1 ? "point" : "points";
  const visibleLabel = amount > 0 ? `+${amount}` : `-${Math.abs(amount)}`;

  return `
    <button type="button" class="quick-score-action${amount < 0 ? " is-negative" : ""}" data-action="apply-quick-score" data-amount="${amount}" aria-label="Add ${amount} ${pointsWord} to the points draft for ${escapeAttribute(player.name)}">${visibleLabel}</button>
  `;
}

function renderScoreFeedback() {
  if (!state.scoreFeedback) {
    return "";
  }

  return `<p class="${scoreFeedbackClassName(state.scoreFeedback.kind)}">${escapeHtml(state.scoreFeedback.message)}</p>`;
}

// Recent entries panel (track-game-activity): a display-only view over the
// stored change sequence, rendered as the active view score panel's last
// block (Finish game now lives in the active header). Newest first, capped by
// recentScoreChanges, with the `Last: {name} {signedAmount}` header as undo
// context. There are no interactive controls and no live region of its own —
// #score-feedback already announces saves and undoes. Undo derives for free:
// the popped change simply stops rendering and the header recomputes.
function renderRecentEntries(game) {
  const entries = recentScoreChanges({ game });
  // Badge numbers derive once per surface render (show-player-numbers) from
  // the same game; entries hold original player references, so the id-keyed
  // map resolves each row's number.
  const numbers = playerNumbers(game);

  if (entries.length === 0) {
    return `
      <div class="recent-entries" data-recent-entries>
        <p class="recent-entries-empty">No score changes yet.</p>
      </div>
    `;
  }

  const latest = entries[0];

  return `
    <div class="recent-entries" data-recent-entries>
      <div class="recent-entries-header">
        <p class="eyebrow">Recent entries</p>
        <p class="recent-entries-last">Last: ${escapeHtml(latest.player.name)} ${escapeHtml(signedScoreAmount(latest.change.amount))}</p>
      </div>
      <ul class="recent-entries-list" aria-label="Recent entries">
        ${entries.map((entry) => renderRecentEntry(entry, numbers.get(entry.player.id))).join("")}
      </ul>
    </div>
  `;
}

function renderRecentEntry({ change, player }, playerNumber) {
  const color = getColor(player.color);
  const timeToken = formatRelativeTimestamp(change?.at);

  return `
    <li class="recent-entry">
      <span class="player-token ${color.cssClass}" aria-label="Player ${playerNumber}, ${color.label}">${playerNumber}</span>
      <span class="recent-entry-name">${escapeHtml(player.name)}</span>
      <span class="recent-entry-amount ${change.amount > 0 ? "is-positive" : "is-negative"}">${escapeHtml(signedScoreAmount(change.amount))} pts</span>
      <span class="recent-entry-time">${escapeHtml(recentEntryTimeText(timeToken))}</span>
    </li>
  `;
}

// Display helper: positive amounts carry an explicit `+` (zero is impossible —
// parseScoreAmount rejects it — but a plain "0" keeps the helper total).
function signedScoreAmount(amount) {
  return amount > 0 ? `+${amount}` : String(amount);
}

// Entry time cells use the relative token with an initial capital
// ("Just now"); entries without a parseable `at` (pre-feature or corrupt)
// degrade to a muted em dash instead of dropping the row.
function recentEntryTimeText(timeToken) {
  if (!timeToken) {
    return "—";
  }

  return `${timeToken.charAt(0).toUpperCase()}${timeToken.slice(1)}`;
}

function renderReplayFeedback() {
  if (!state.replayFeedback) {
    return "";
  }

  return `<p class="${scoreFeedbackClassName(state.replayFeedback.kind)}">${escapeHtml(state.replayFeedback.message)}</p>`;
}

function scoreFeedbackClassName(kind) {
  return SCORE_FEEDBACK_CLASS_NAMES[kind] ?? SCORE_FEEDBACK_CLASS_NAMES.success;
}

// One selection path for the row click and the Add points button: unchanged
// selectedPlayerId/scoreFeedback/render/focus semantics.
function selectPlayer(playerId) {
  state.selectedPlayerId = playerId;
  state.scoreFeedback = null;
  render();
  appRoot.querySelector("#score-amount")?.focus();
}

function bindActiveEvents() {
  appRoot.querySelector("[data-action='back-home']")?.addEventListener("click", () => {
    state.view = "home";
    state.selectedPlayerId = null;
    state.scoreFeedback = null;
    state.finishPromptOpen = false;
    state.podiumOpen = false;
    state.replayFeedback = null;
    state.titleEditOpen = false;
    state.titleDraft = "";
    state.titleEditFeedback = null;
    state.historyDialog = null;
    render();
    appRoot.querySelector("[data-action='new-game']")?.focus();
  });

  appRoot.querySelector("[data-action='open-title-edit']")?.addEventListener("click", () => {
    openTitleEdit();
  });

  appRoot.querySelector("[data-title-edit-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    handleTitleSave();
  });

  appRoot.querySelector("[data-action='cancel-title-edit']")?.addEventListener("click", () => {
    cancelTitleEdit();
  });

  // Escape cancels the edit without touching anything (Enter submits natively
  // through the form).
  appRoot.querySelector("[data-title-edit-form]")?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      cancelTitleEdit();
    }
  });

  appRoot.querySelector("#active-title-input")?.addEventListener("input", (event) => {
    state.titleDraft = event.target.value;
  });

  appRoot.querySelectorAll("[data-action='select-player']").forEach((button) => {
    button.addEventListener("click", (event) => {
      const row = event.target.closest("[data-player-id]");

      if (!row) {
        return;
      }

      selectPlayer(row.dataset.playerId);
    });
  });

  // Whole-row selection (refine-ui-after-testing): clicking anywhere in an
  // active leaderboard row away from a button runs the same selection path as
  // the Add points control. The button stays the keyboard/aria-pressed target;
  // finished rows carry no Add points button and are never bound.
  appRoot.querySelectorAll(".active-player[data-player-id]").forEach((row) => {
    if (!row.querySelector(".add-points-action")) {
      return;
    }

    row.addEventListener("click", (event) => {
      if (event.target.closest("button")) {
        return;
      }

      selectPlayer(row.dataset.playerId);
    });
  });

  appRoot.querySelector("[data-score-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    handleScoreSubmit();
  });

  // Quick-entry controls (add-quick-score-entry), bound per render like
  // select-player: counters carry their signed amount, the stepper nudges ±1.
  appRoot.querySelectorAll("[data-action='apply-quick-score']").forEach((button) => {
    button.addEventListener("click", () => {
      handleQuickScore(Number(button.dataset.amount));
    });
  });

  appRoot.querySelector("[data-action='step-score-up']")?.addEventListener("click", () => {
    stepScoreDraft(1);
  });

  appRoot.querySelector("[data-action='step-score-down']")?.addEventListener("click", () => {
    stepScoreDraft(-1);
  });

  appRoot.querySelector("#score-amount")?.addEventListener("beforeinput", guardScoreEntryInput);

  appRoot.querySelector("[data-action='undo-last-score']")?.addEventListener("click", () => {
    handleUndo();
  });

  appRoot.querySelector("[data-action='open-finish']")?.addEventListener("click", () => {
    state.finishPromptOpen = true;
    render();
    appRoot.querySelector("[data-action='confirm-finish']")?.focus();
  });

  appRoot.querySelector("[data-action='cancel-finish']")?.addEventListener("click", () => {
    state.finishPromptOpen = false;
    state.scoreFeedback = null;
    render();
    appRoot.querySelector("[data-action='open-finish']")?.focus();
  });

  appRoot.querySelector("[data-action='confirm-finish']")?.addEventListener("click", () => {
    handleFinishGame();
  });

  appRoot.querySelector("[data-action='play-again']")?.addEventListener("click", () => {
    handlePlayAgain();
  });
}

function guardScoreEntryInput(event) {
  // Entry guard for the score field: only plain signed-integer drafts may be
  // inserted (letters like "e" can never enter or be pasted). Deletion and
  // undo/redo/history input types are never blocked, and insertion types
  // without string data (e.g. some autofill replacements) are left to the
  // save-side plain-format gate in parseScoreAmount.
  if (typeof event.inputType === "string" && !event.inputType.startsWith("insert")) {
    return;
  }

  if (typeof event.data !== "string") {
    return;
  }

  const input = event.target;
  const value = typeof input.value === "string" ? input.value : "";
  const start = typeof input.selectionStart === "number" ? input.selectionStart : null;
  const end = typeof input.selectionEnd === "number" ? input.selectionEnd : null;

  // Number inputs expose no selection API, so fall back to evaluating the
  // inserted data alone; either way the save gate still validates the final
  // value, so nothing unsavable is silently rewritten here.
  const prospective = start === null || end === null
    ? event.data
    : `${value.slice(0, start)}${event.data}${value.slice(end)}`;

  if (!isPlainScoreDraft(prospective)) {
    event.preventDefault();
  }
}

function handleFinishGame() {
  const result = finishGame({ game: state.activeGame });

  if (result.error || !result.game) {
    state.scoreFeedback = {
      kind: "error",
      message: SCORE_ERROR_MESSAGES[result.error] ?? SCORE_ERROR_MESSAGES["missing-game"]
    };
    paintScoreFeedback();
    return;
  }

  state.activeGame = result.game;
  state.finishPromptOpen = false;
  state.scoreFeedback = null;
  state.titleEditOpen = false;
  state.titleDraft = "";
  state.titleEditFeedback = null;
  persistActiveGameSnapshot();
  state.podiumOpen = podiumRows(result.game).length > 0;
  render();
  paintStorageNotice();

  if (!state.podiumOpen) {
    appRoot.querySelector("[data-active-heading]")?.focus();
  }
}

function handlePlayAgain() {
  const result = replayGame({ game: state.activeGame });

  if (result.error || !result.game) {
    state.replayFeedback = {
      kind: "error",
      message: SCORE_ERROR_MESSAGES[result.error] ?? SCORE_ERROR_MESSAGES["not-finished"]
    };
    console.warn("Game replay failed:", result.error);
    paintReplayFeedback();
    return;
  }

  state.activeGame = result.game;
  state.selectedPlayerId = result.game.players[0]?.id ?? null;
  state.scoreFeedback = null;
  state.finishPromptOpen = false;
  state.podiumOpen = false;
  state.replayFeedback = null;
  state.titleEditOpen = false;
  state.titleDraft = "";
  state.titleEditFeedback = null;
  state.historyDialog = null;
  persistActiveGameSnapshot();
  render();
  paintStorageNotice();
  appRoot.querySelector("[data-active-heading]")?.focus();
}

// Title editing is only offered while a game is active (the finished view has
// no edit control, and renameGame refuses non-active games). The draft starts
// from the raw stored title — never the auto-label.
function openTitleEdit() {
  if (!state.activeGame || state.activeGame.status !== "active") {
    return;
  }

  state.titleDraft = typeof state.activeGame.title === "string" ? state.activeGame.title : "";
  state.titleEditOpen = true;
  state.titleEditFeedback = null;
  render();
  appRoot.querySelector("#active-title-input")?.focus();
}

// Cancel closes the edit without writing anything: the stored payload stays
// byte-identical and the display label returns untouched.
function cancelTitleEdit() {
  state.titleEditOpen = false;
  state.titleDraft = "";
  state.titleEditFeedback = null;
  render();
  appRoot.querySelector("[data-active-heading]")?.focus();
}

// Saving runs the pure renameGame and persists through the unchanged
// persistActiveGameSnapshot() — the sixth successful-mutation save trigger —
// so the edit is saved immediately under the accepted storage rules. Guard
// failures repaint the polite feedback region without re-rendering.
function handleTitleSave() {
  const result = renameGame({ game: state.activeGame, title: state.titleDraft });

  if (result.error || !result.game) {
    state.titleEditFeedback = {
      kind: "error",
      message: SCORE_ERROR_MESSAGES[result.error] ?? SCORE_ERROR_MESSAGES["invalid-title"]
    };
    console.warn("Game rename failed:", result.error);
    paintTitleEditFeedback();
    return;
  }

  state.activeGame = result.game;
  state.titleEditOpen = false;
  state.titleDraft = "";
  state.titleEditFeedback = null;
  persistActiveGameSnapshot();
  render();
  paintStorageNotice();
  appRoot.querySelector("[data-active-heading]")?.focus();
}

// Save points applies the pending draft through the unchanged path. The
// returned boolean reports success/failure for callers that need it; the
// typed-save focus contract is untouched.
function handleScoreSubmit() {
  const input = appRoot.querySelector("#score-amount");

  if (!input) {
    return false;
  }

  const parsed = parseScoreAmount(input.value);

  if (parsed.error) {
    rejectScoreEntry(SCORE_ERROR_MESSAGES[parsed.error] ?? SCORE_ERROR_MESSAGES["not-a-number"]);
    return false;
  }

  const targetPlayer = state.activeGame?.players.find((player) => player.id === state.selectedPlayerId);
  const result = applyScoreChange({
    game: state.activeGame,
    playerId: state.selectedPlayerId,
    amount: parsed.amount
  });

  if (result.error || !result.game || !targetPlayer) {
    rejectScoreEntry(SCORE_ERROR_MESSAGES[result.error] ?? SCORE_ERROR_MESSAGES["unknown-player"]);
    return false;
  }

  const updatedPlayer = result.game.players.find((player) => player.id === state.selectedPlayerId);
  const updatedTotal = updatedPlayer?.total;
  const updatedRank = rankPlayers(result.game).find((row) => row.player.id === state.selectedPlayerId)?.rank ?? null;
  state.activeGame = result.game;
  persistActiveGameSnapshot();
  state.scoreFeedback = {
    kind: "success",
    message: `Added ${parsed.amount} points to ${targetPlayer.name}. New total: ${updatedTotal}. Rank: ${updatedRank}.`
  };
  render();
  paintStorageNotice();
  appRoot.querySelector("#score-amount")?.focus();
  return true;
}

// Quick counter tap (refine-ui-after-testing superseded immediate apply): the
// preset adds to the pending points draft exactly like the stepper. Nothing
// renders, paints feedback, re-ranks, or saves, so focus stays on the pressed
// counter and repeated Enter keeps accumulating. Save points applies the
// combined draft as one ordinary score change through handleScoreSubmit.
function handleQuickScore(amount) {
  applyDraftDelta(amount);
}

// Shared draft helper for the stepper and the quick counters: read the
// trimmed draft with parseInt, start from 0 for empty/unparseable text, add
// the delta, clamp to ±MAX_SCORE_ABS, and write plain integer text. It never
// renders, paints feedback, or saves.
function applyDraftDelta(delta) {
  const input = appRoot.querySelector("#score-amount");

  if (!input) {
    return;
  }

  const parsed = Number.parseInt(String(input.value).trim(), 10);
  const baseline = Number.isFinite(parsed) ? parsed : 0;
  const next = Math.max(-MAX_SCORE_ABS, Math.min(MAX_SCORE_ABS, baseline + delta));
  input.value = String(next);
}

function stepScoreDraft(direction) {
  applyDraftDelta(direction);
}

function handleUndo() {
  const result = undoLastScoreChange({ game: state.activeGame });

  if (result.error === "nothing-to-undo") {
    state.scoreFeedback = { kind: "info", message: SCORE_ERROR_MESSAGES["nothing-to-undo"] };
    paintScoreFeedback();
    return;
  }

  const affectedPlayer = result.game?.players.find((player) => player.id === result.undone?.playerId) ?? null;

  if (result.error || !result.game || !result.undone || !affectedPlayer) {
    state.scoreFeedback = {
      kind: "error",
      message: SCORE_ERROR_MESSAGES[result.error] ?? SCORE_ERROR_MESSAGES["not-safe"]
    };
    paintScoreFeedback();
    return;
  }

  const restoredRank = rankPlayers(result.game).find((row) => row.player.id === affectedPlayer.id)?.rank ?? null;
  state.activeGame = result.game;
  persistActiveGameSnapshot();
  state.scoreFeedback = {
    kind: "success",
    message: `Undid ${result.undone.amount} points for ${affectedPlayer.name}. New total: ${affectedPlayer.total}. Rank: ${restoredRank}.`
  };
  render();
  paintStorageNotice();
  appRoot.querySelector("[data-action='undo-last-score']")?.focus();
}

function persistActiveGameSnapshot() {
  if (!state.activeGame) {
    return;
  }

  if (state.storageReadError === "invalid") {
    console.warn("Game save failed:", "invalid");
    return;
  }

  const previousSavedGames = state.savedGames;
  state.savedGames = upsertSavedGame(state.savedGames, state.activeGame, {
    updatedAt: new Date().toISOString()
  });
  const result = saveGames({ games: state.savedGames });

  if (result.error) {
    state.savedGames = previousSavedGames;
    state.lastSaveError = result.error;
    console.warn("Game save failed:", result.error);
    return;
  }

  state.lastSaveError = null;

  if (state.storageReadError === "unavailable") {
    state.storageReadError = null;
  }
}

function rejectScoreEntry(message) {
  state.scoreFeedback = { kind: "error", message };
  paintScoreFeedback();
  appRoot.querySelector("#score-amount")?.focus();
}

function paintScoreFeedback() {
  const region = appRoot.querySelector("#score-feedback");

  if (!region) {
    return;
  }

  region.replaceChildren();

  if (!state.scoreFeedback) {
    return;
  }

  const message = document.createElement("p");
  message.className = scoreFeedbackClassName(state.scoreFeedback.kind);
  message.textContent = state.scoreFeedback.message;
  region.append(message);
}

function paintReplayFeedback() {
  const region = appRoot.querySelector("#replay-feedback");

  if (!region) {
    return;
  }

  region.replaceChildren();

  if (!state.replayFeedback) {
    return;
  }

  const message = document.createElement("p");
  message.className = scoreFeedbackClassName(state.replayFeedback.kind);
  message.textContent = state.replayFeedback.message;
  region.append(message);
}

function paintTitleEditFeedback() {
  const region = appRoot.querySelector("#title-edit-feedback");

  if (!region) {
    return;
  }

  region.replaceChildren();

  if (!state.titleEditFeedback) {
    return;
  }

  const message = document.createElement("p");
  message.className = scoreFeedbackClassName(state.titleEditFeedback.kind);
  message.textContent = state.titleEditFeedback.message;
  region.append(message);
}

function resetSetup() {
  state.title = "";
  state.rows = createSetupRows();
  state.activeGame = null;
  state.selectedPlayerId = null;
  state.scoreFeedback = null;
  state.finishPromptOpen = false;
  state.podiumOpen = false;
  state.replayFeedback = null;
  state.titleEditOpen = false;
  state.titleDraft = "";
  state.titleEditFeedback = null;
  state.historyDialog = null;
  state.errors = [];
  state.limitMessage = "";
  state.nextRowNumber = MIN_PLAYERS + 1;
}

function focusFirstInvalidName() {
  const invalidIndex = state.rows.findIndex((row) => !row.name.trim() || row.name.trim().length > MAX_NAME_LENGTH);
  const fallbackIndex = invalidIndex >= 0 ? invalidIndex : 0;
  appRoot.querySelector(`[data-player-index="${fallbackIndex}"] input[data-field="name"]`)?.focus();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
