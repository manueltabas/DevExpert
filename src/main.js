import {
  FALLBACK_TITLE,
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PLAYER_COLORS,
  colorForIndex,
  createGame,
  createSetupRow,
  createSetupRows,
  getColor,
  validateRoster
} from "./roster.js";

const appRoot = document.querySelector("[data-app-root]");
const yearTarget = document.querySelector("[data-current-year]");
const state = {
  view: "home",
  title: FALLBACK_TITLE,
  rows: createSetupRows(),
  activeGame: null,
  errors: [],
  limitMessage: "",
  nextRowNumber: MIN_PLAYERS + 1
};

if (yearTarget) {
  yearTarget.textContent = String(new Date().getFullYear());
}

render();
document.documentElement.dataset.appReady = "true";

function render() {
  if (!appRoot) {
    return;
  }

  if (state.view === "setup") {
    renderSetup();
    return;
  }

  if (state.view === "active") {
    renderActiveGame();
    return;
  }

  renderHome();
}

function renderHome() {
  appRoot.innerHTML = `
    <section class="hero-panel" aria-labelledby="home-title">
      <div class="hero-copy">
        <p class="eyebrow">Ready for the next table?</p>
        <h2 id="home-title">Track scores while the game stays on the table.</h2>
        <p>Add the people playing, choose easy-to-spot colors, and start everyone at zero.</p>
      </div>
      <div class="hero-actions" aria-label="Game actions">
        <button type="button" class="primary-action" data-action="new-game">New game</button>
        <span class="status-pill">Local to this browser</span>
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
        <div class="empty-state">
          <p class="empty-title">No saved games yet.</p>
          <p>Games will appear here once browser history is added.</p>
        </div>
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
        <div class="empty-state">
          <p class="empty-title">Podiums will live here.</p>
          <p>Finished games will appear here once results are added.</p>
        </div>
      </article>
    </section>
  `;

  appRoot.querySelector("[data-action='new-game']")?.addEventListener("click", () => {
    resetSetup();
    state.view = "setup";
    render();
    appRoot.querySelector("#game-title")?.focus();
  });
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
            <h2 id="setup-title">Who is playing?</h2>
          </div>
          <span class="status-pill">${state.rows.length}/${MAX_PLAYERS} players</span>
        </div>

        <form class="roster-form" novalidate data-roster-form>
          <label class="field-label" for="game-title">Game title</label>
          <input id="game-title" class="text-field" name="title" maxlength="60" value="${escapeAttribute(state.title)}" autocomplete="off">

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
    state.view = "active";
    state.errors = [];
    state.limitMessage = "";
    render();
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

  appRoot.innerHTML = `
    <section class="active-layout" aria-labelledby="active-title">
      <div class="active-header">
        <button type="button" class="ghost-action" data-action="back-home">All games</button>
        <div>
          <p class="eyebrow">In progress</p>
          <h2 id="active-title" tabindex="-1" data-active-heading>${escapeHtml(game.title)}</h2>
        </div>
        <span class="status-pill">${game.players.length} players</span>
      </div>

      <div class="panel roster-panel">
        <div class="panel-heading">
          <span class="dice-card" aria-hidden="true"><span></span><span></span><span></span><span></span></span>
          <div>
            <p class="eyebrow">Starting totals</p>
            <h3>Everyone begins at zero</h3>
          </div>
        </div>

        <ol class="active-roster" aria-label="Active game players">
          ${game.players.map((player) => renderActivePlayer(player)).join("")}
        </ol>
      </div>
    </section>
  `;

  appRoot.querySelector("[data-action='back-home']")?.addEventListener("click", () => {
    state.view = "home";
    render();
    appRoot.querySelector("[data-action='new-game']")?.focus();
  });
}

function renderActivePlayer(player) {
  const color = getColor(player.color);

  return `
    <li class="active-player" data-player-id="${escapeAttribute(player.id)}">
      <span class="player-token ${color.cssClass}" aria-label="Player marker ${player.marker}, ${color.label}">${escapeHtml(player.marker)}</span>
      <span class="active-player-name">${escapeHtml(player.name)}</span>
      <span class="active-player-total" aria-label="${escapeAttribute(player.name)} total">0</span>
    </li>
  `;
}

function resetSetup() {
  state.title = FALLBACK_TITLE;
  state.rows = createSetupRows();
  state.activeGame = null;
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
