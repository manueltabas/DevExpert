import assert from "node:assert/strict";
import path from "node:path";
import { createStaticServer, listen } from "./static-server.mjs";
import { STORAGE_KEY } from "../src/storage.js";
import {
  CdpClient,
  click,
  closeServer,
  createEvidenceDir,
  DEFAULT_CHROME_PATH,
  evaluate,
  fill,
  launchChrome,
  navigate,
  readSavedGamesState,
  screenshot,
  setViewport,
  waitForSelector
} from "./browser-test-utils.mjs";

const chromePath = process.env.CHROME_BIN ?? DEFAULT_CHROME_PATH;
const evidenceDir = await createEvidenceDir("devexpert-game-presets");
const server = createStaticServer();
const baseUrl = await listen(server);

const NEGATIVE_MESSAGE = "This preset only adds points. Enter a positive amount.";
const CUSTOM_ZERO_MESSAGE = "Zero adds no points. Enter a positive or negative amount.";
const POSITIVE_ZERO_MESSAGE = "Zero adds no points. Enter a positive amount.";

const CATALOGUE = [
  {
    id: "custom",
    label: "Custom",
    min: 2,
    max: 20,
    defaultPlayers: 2,
    title: "",
    chips: ["+1", "+5", "+10", "+25", "-1", "-5", "-10"],
    target: null,
    allowsNegative: true
  },
  {
    id: "flip-7",
    label: "Flip 7",
    min: 3,
    max: 20,
    defaultPlayers: 3,
    title: "Flip 7",
    chips: ["×2", "+5", "+10", "+15", "+20", "+25", "+50"],
    target: "Target 200 points",
    allowsNegative: false
  },
  {
    id: "catan",
    label: "Catan",
    min: 3,
    max: 6,
    defaultPlayers: 4,
    title: "Catan",
    chips: ["+1", "+2", "+3", "+4", "+5"],
    target: "Target 10 VP",
    allowsNegative: false
  },
  {
    id: "ticket-to-ride",
    label: "Ticket to Ride",
    min: 2,
    max: 5,
    defaultPlayers: 4,
    title: "Ticket to Ride",
    chips: ["+1", "+5", "+10", "+15", "+20", "-5", "-10"],
    target: null,
    allowsNegative: true
  },
  {
    id: "7-wonders",
    label: "7 Wonders",
    min: 3,
    max: 7,
    defaultPlayers: 4,
    title: "7 Wonders",
    chips: ["+1", "+3", "+5", "+10", "+20"],
    target: null,
    allowsNegative: false
  },
  {
    id: "yahtzee",
    label: "Yahtzee",
    min: 2,
    max: 20,
    defaultPlayers: 4,
    title: "Yahtzee",
    chips: ["+5", "+10", "+25", "+30", "+40", "+50"],
    target: null,
    allowsNegative: false
  }
];

function presetById(id) {
  return CATALOGUE.find((preset) => preset.id === id);
}

async function runSession(sessionName, run, { setupSource = "" } = {}) {
  const userDataDir = path.join(evidenceDir, sessionName);
  const launched = await launchChrome({ chromePath, userDataDir, url: "about:blank" });

  try {
    const cdp = await CdpClient.connect(launched.webSocketUrl);
    const consoleProblems = [];
    const warnings = [];
    cdp.on("Runtime.exceptionThrown", (event) => {
      consoleProblems.push(event.exceptionDetails?.text ?? "Runtime exception");
    });
    cdp.on("Log.entryAdded", (event) => {
      if (event.entry?.level === "error") {
        consoleProblems.push(event.entry.text);
      }
    });
    cdp.on("Runtime.consoleAPICalled", (event) => {
      if (event.type === "warning") {
        warnings.push((event.args ?? []).map((arg) => arg.value ?? arg.description ?? "").join(" "));
      }
    });

    await cdp.send("Runtime.enable");
    await cdp.send("Log.enable");
    await cdp.send("Page.enable");
    if (setupSource) {
      await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: setupSource });
    }

    return await run(cdp, { consoleProblems, warnings });
  } finally {
    launched.chrome.kill("SIGTERM");
  }
}

async function selectPreset(cdp, presetId) {
  await click(cdp, `#game-preset-${presetId}`);
  await waitForSelector(cdp, `[data-preset-detail][data-preset-id='${presetId}']`);
}

async function resetToSetup(cdp) {
  const onHome = await evaluate(cdp, () => Boolean(document.querySelector("[data-action='new-game']")));
  if (!onHome) {
    await click(cdp, "[data-action='back-home']");
    await waitForSelector(cdp, "[data-action='new-game']");
  }
  await click(cdp, "[data-action='new-game']");
  await waitForSelector(cdp, "#game-preset-custom");
}

async function fillNames(cdp, names) {
  for (let index = 0; index < names.length; index += 1) {
    await fill(cdp, `#player-name-${index + 1}`, names[index]);
  }
}

async function startGame(cdp) {
  await click(cdp, "[data-roster-form] button[type='submit']");
  await waitForSelector(cdp, "#score-amount");
}

async function createGameWithPreset(cdp, { presetId, title, names }) {
  await resetToSetup(cdp);

  if (presetId !== "custom") {
    await selectPreset(cdp, presetId);
  }

  if (title !== undefined && title !== null) {
    await fill(cdp, "#game-title", title);
  }

  await fillNames(cdp, names);
  await startGame(cdp);
}

async function goHome(cdp) {
  await click(cdp, "[data-action='back-home']");
  await waitForSelector(cdp, "[data-action='new-game']");
}

async function savePoints(cdp, amount) {
  await fill(cdp, "#score-amount", amount);
  await click(cdp, "[data-score-form] button[type='submit']");
  await waitForSelector(cdp, "#score-amount");
}

async function readSetupContract(cdp) {
  return evaluate(cdp, () => {
    const cards = [...document.querySelectorAll(".preset-card")];
    const detail = document.querySelector("[data-preset-detail]");
    const picker = document.querySelector("[data-preset-picker]");
    const title = document.querySelector("#game-title");
    const rows = [...document.querySelectorAll("[data-player-index]")];
    const checked = cards.find((card) => card.querySelector("input")?.checked)?.querySelector("input");
    return {
      labels: cards.map((card) => card.querySelector(".preset-card-label")?.textContent?.trim() ?? ""),
      values: cards.map((card) => card.querySelector("input")?.value ?? ""),
      checked: checked?.value ?? null,
      pickerBeforeTitle: Boolean(picker && title && picker.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING),
      detailId: detail?.dataset.presetId ?? null,
      range: detail?.querySelector("[data-preset-range]")?.textContent?.trim() ?? null,
      target: detail?.querySelector("[data-preset-target]")?.textContent?.trim() ?? null,
      hints: [...(detail?.querySelectorAll(".preset-detail-hint") ?? [])].map((node) => node.textContent.trim()),
      chips: [...(detail?.querySelectorAll(".preset-chip") ?? [])].map((node) => node.textContent.trim()),
      title: title?.value ?? null,
      rowCount: rows.length,
      names: rows.map((row) => row.querySelector("input[data-field='name']")?.value ?? ""),
      colors: rows.map((row) => row.querySelector("input[data-field='color']:checked")?.value ?? ""),
      status: document.querySelector(".status-pill")?.textContent?.trim() ?? null,
      helper: document.querySelector("#setup-help")?.textContent?.trim() ?? null,
      addDisabled: document.querySelector("[data-action='add-player']")?.disabled ?? null,
      removeDisabled: document.querySelector("[data-action='remove-player']")?.disabled ?? null,
      focusId: document.activeElement?.id ?? null,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
}

async function readScoreContract(cdp) {
  return evaluate(cdp, () => {
    const group = document.querySelector(".quick-scores");
    const buttons = [...(group?.querySelectorAll("button") ?? [])];
    const rows = [...(group?.querySelectorAll(".quick-scores-row") ?? [])];
    const input = document.querySelector("#score-amount");
    return {
      presetId: group?.dataset.presetId ?? null,
      rows: rows.map((row) => [...row.querySelectorAll("button")].map((button) => button.textContent.trim())),
      actions: buttons.map((button) => ({
        action: button.dataset.action,
        amount: button.dataset.amount ?? null,
        factor: button.dataset.factor ?? null,
        text: button.textContent.trim(),
        isNegative: button.classList.contains("is-negative"),
        isMultiply: button.classList.contains("is-multiply"),
        label: button.getAttribute("aria-label")
      })),
      helper: document.querySelector("#score-help")?.textContent?.trim() ?? null,
      describedBy: input?.getAttribute("aria-describedby") ?? null,
      min: input?.getAttribute("min") ?? null,
      max: input?.getAttribute("max") ?? null,
      hint: document.querySelector("[data-preset-hint]")?.textContent?.trim() ?? null,
      finishOpener: Boolean(document.querySelector("[data-action='open-finish']")),
      podium: Boolean(document.querySelector("[data-podium-dialog]")),
      scoreForm: Boolean(document.querySelector("[data-score-form]")),
      heading: document.querySelector("[data-active-heading]")?.textContent?.trim() ?? null,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
}

async function readStoredGames(cdp) {
  const state = await readSavedGamesState(cdp, STORAGE_KEY);
  const payload = state.raw ? JSON.parse(state.raw) : { version: null, games: [] };
  return { state, payload };
}

function assertCatalogueSetup(setup, preset, { untouched = true } = {}) {
  assert.equal(setup.checked, preset.id);
  assert.equal(setup.detailId, preset.id);
  assert.equal(setup.range, `${preset.min}–${preset.max} players`);
  assert.equal(setup.target, preset.target);
  assert.deepEqual(setup.chips, preset.chips);
  assert.equal(setup.title, untouched ? preset.title : setup.title);
  assert.equal(setup.status, `${untouched ? preset.defaultPlayers : setup.rowCount}/${preset.max} players`);
  assert.equal(setup.helper, `Start with ${preset.min} to ${preset.max} players. Names can repeat, but blank names cannot start a game.`);
  assert.equal(setup.horizontalOverflow, false);
}

function assertScoreActions(contract, preset) {
  const texts = preset.chips;
  assert.equal(contract.presetId, preset.id);
  assert.deepEqual(contract.actions.map((action) => action.text), texts);
  assert.equal(contract.min, preset.allowsNegative ? "-1000000" : "0");
  assert.equal(contract.max, "1000000");
  assert.equal(contract.horizontalOverflow, false);
}

// Session 1 (Scenarios 1 + 2): the Custom default and all six presets.
async function runCatalogueSession(cdp, { consoleProblems }) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");
  assert.equal((await readSavedGamesState(cdp, STORAGE_KEY)).keyCount, 0);

  await click(cdp, "[data-action='new-game']");
  await waitForSelector(cdp, "#game-preset-custom");

  let setup = await readSetupContract(cdp);
  assert.deepEqual(setup.values, CATALOGUE.map((preset) => preset.id), "exactly the six approved options in catalogue order");
  assert.deepEqual(setup.labels, CATALOGUE.map((preset) => preset.label));
  assert.equal(setup.pickerBeforeTitle, true, "the picker renders above the title");
  assert.equal(setup.focusId, "game-preset-custom", "a full reset focuses the checked Custom radio");
  assertCatalogueSetup(setup, presetById("custom"));
  assert.equal(setup.rowCount, 2);
  assert.deepEqual(setup.names, ["", ""]);
  assert.equal(setup.addDisabled, false);
  assert.equal(setup.removeDisabled, true, "Custom disables Remove at the 2-player minimum");
  assert.equal((await readSavedGamesState(cdp, STORAGE_KEY)).keyCount, 0, "switching presets never writes storage");

  for (const preset of CATALOGUE.slice(1)) {
    await selectPreset(cdp, preset.id);
    setup = await readSetupContract(cdp);
    assertCatalogueSetup(setup, preset);
    assert.equal(setup.rowCount, preset.defaultPlayers, `${preset.label} uses its default roster`);
    assert.equal(setup.focusId, `game-preset-${preset.id}`, "selection returns focus to the chosen radio");
    assert.equal(setup.addDisabled, preset.defaultPlayers >= preset.max);
    assert.equal(setup.removeDisabled, preset.defaultPlayers <= preset.min);
    assert.equal((await readSavedGamesState(cdp, STORAGE_KEY)).keyCount, 0);
  }

  await selectPreset(cdp, "catan");
  const catanScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-catan-setup.png"));
  await selectPreset(cdp, "flip-7");
  const flipSetup = await readSetupContract(cdp);
  assert.match(flipSetup.hints.join(" "), /Enter the number-card sum, tap ×2, add the \+15 bonus, then Save\. Bust rounds add nothing\./);
  const flipScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-flip7-setup.png"));

  await selectPreset(cdp, "custom");
  setup = await readSetupContract(cdp);
  assertCatalogueSetup(setup, presetById("custom"));
  assert.equal(setup.title, "", "Custom clears an auto-filled title");
  assert.equal(setup.rowCount, 2);

  assert.deepEqual(consoleProblems, [], "the catalogue session must not produce uncaught console errors");
  return { catanScreenshot, flipScreenshot };
}

// Session 2 (Scenarios 3 + 4): title ownership and touched-roster clamping.
async function runTitleAndRosterSession(cdp, { consoleProblems }) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");
  await resetToSetup(cdp);

  // Auto-fill ownership.
  await selectPreset(cdp, "catan");
  assert.equal((await readSetupContract(cdp)).title, "Catan");
  await fill(cdp, "#game-title", "Friday night");
  await selectPreset(cdp, "ticket-to-ride");
  let setup = await readSetupContract(cdp);
  assert.equal(setup.title, "Friday night", "a user title survives a preset switch");
  await fill(cdp, "#game-title", "");
  await selectPreset(cdp, "7-wonders");
  assert.equal((await readSetupContract(cdp)).title, "7 Wonders", "an empty title takes the new default");
  await selectPreset(cdp, "custom");
  assert.equal((await readSetupContract(cdp)).title, "", "Custom clears an auto-filled title");

  // Touched roster: append up to the minimum and preserve names/colors.
  await resetToSetup(cdp);
  await fillNames(cdp, ["Alex", "Sam"]);
  await selectPreset(cdp, "flip-7");
  setup = await readSetupContract(cdp);
  assert.equal(setup.rowCount, 3, "a touched roster below the minimum appends a blank row");
  assert.deepEqual(setup.names, ["Alex", "Sam", ""], "retained names keep their text");
  assert.deepEqual(setup.colors, ["blue", "red", "yellow"], "appended rows use positional colors");
  assert.equal(setup.removeDisabled, true, "Remove disables at the preset minimum");
  await click(cdp, "[data-roster-form] button[type='submit']");
  await evaluate(cdp, () => {
    const errors = [...document.querySelectorAll("#setup-feedback .validation-message")].map((node) => node.textContent.trim());
    if (!errors.includes("Player 3 needs a name.")) {
      throw new Error(`expected the blank appended name to fail validation, got: ${errors.join(" | ")}`);
    }
  });
  assert.ok(await evaluate(cdp, () => Boolean(document.querySelector("#game-preset-flip-7"))), "a failed start stays in setup");

  // Touched roster above the maximum truncates only trailing rows.
  await resetToSetup(cdp);
  for (let count = 2; count < 10; count += 1) {
    await click(cdp, "[data-action='add-player']");
  }
  await fillNames(cdp, Array.from({ length: 10 }, (_, index) => `Player ${index + 1}`));
  const before = await readSetupContract(cdp);
  assert.equal(before.rowCount, 10);
  await selectPreset(cdp, "catan");
  setup = await readSetupContract(cdp);
  assert.equal(setup.rowCount, 6, "Catan keeps only the first six rows");
  assert.deepEqual(setup.names, before.names.slice(0, 6), "retained rows keep their names");
  assert.deepEqual(setup.colors, before.colors.slice(0, 6), "retained rows keep their colors");
  assert.equal(setup.addDisabled, true, "Add disables at the preset maximum");
  assert.equal(setup.status, "6/6 players");

  // Full reset returns to Custom with two empty rows.
  await goHome(cdp);
  await click(cdp, "[data-action='new-game']");
  await waitForSelector(cdp, "#game-preset-custom");
  setup = await readSetupContract(cdp);
  assertCatalogueSetup(setup, presetById("custom"));
  assert.equal(setup.rowCount, 2);
  assert.deepEqual(setup.names, ["", ""]);
  assert.equal(setup.focusId, "game-preset-custom");
  assert.equal((await readSavedGamesState(cdp, STORAGE_KEY)).keyCount, 0);

  assert.deepEqual(consoleProblems, [], "the title/roster session must not produce uncaught console errors");
}

// Session 3 (Scenario 5): every preset starts, persists, and resumes with its
// own scoring contract.
async function runPersistenceSession(cdp, { consoleProblems }) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  const order = ["custom", "catan", "ticket-to-ride", "7-wonders", "yahtzee", "flip-7"];
  let flip7GameId = null;

  for (const presetId of order) {
    const preset = presetById(presetId);
    const names = Array.from({ length: preset.defaultPlayers }, (_, index) => `${preset.label} ${index + 1}`);
    await createGameWithPreset(cdp, { presetId, title: null, names });
    const contract = await readScoreContract(cdp);
    assertScoreActions(contract, preset);
    assert.equal(contract.helper, preset.allowsNegative
      ? "Use negative points for penalties. Whole numbers from -1000000 to 1000000."
      : "This preset only adds points. Whole numbers from 0 to 1000000.");

    if (presetId === "flip-7") {
      assert.match(contract.hint, /^Target 200 points\. Enter the number-card sum, tap ×2, add the \+15 bonus, then Save\. Bust rounds add nothing\.$/);
      assert.equal(contract.describedBy, "score-help preset-hint score-feedback");
      assert.equal(contract.actions[0].action, "multiply-score-draft");
      assert.equal(contract.actions[0].text, "×2");
      assert.equal(contract.actions[0].label, `Double the points draft for ${names[0]}`);
      assert.equal(contract.actions[0].isMultiply, true);
      const flipActiveScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-flip7-active-hint.png"));
      flip7GameId = (await readStoredGames(cdp)).payload.games.find((game) => game.players?.some((player) => player.name === names[0]))?.id ?? null;
      assert.ok(flip7GameId, "the Flip 7 game is stored");
      assert.equal(typeof flipActiveScreenshot, "string");
    } else if (presetId === "catan") {
      assert.equal(contract.hint, "Target 10 VP.");
      assert.equal(contract.describedBy, "score-help preset-hint score-feedback");
    } else if (presetId === "yahtzee") {
      assert.equal(contract.hint, "Zero categories add nothing.");
    } else {
      assert.equal(contract.hint, null, `${preset.label} shows no target/hint`);
      assert.equal(contract.describedBy, "score-help score-feedback");
    }

    const { state, payload } = await readStoredGames(cdp);
    assert.equal(state.payloadVersion, 1, "the envelope version stays 1");
    const stored = payload.games.find((game) => game.players?.some((player) => player.name === names[0]));
    assert.ok(stored, `${preset.label} is persisted`);
    if (presetId === "custom") {
      assert.equal("presetId" in stored, false, "Custom stores no presetId");
    } else {
      assert.equal(stored.presetId, presetId, `${preset.label} stores its preset id`);
    }
    assert.equal(stored.title, preset.title, `${preset.label} stores its auto-filled title`);

    await goHome(cdp);
  }

  // Reload and resume the Flip 7 game: the preset and its controls survive.
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");
  await click(cdp, `[data-action='resume-game'][data-game-id='${flip7GameId}']`);
  await waitForSelector(cdp, "#score-amount");
  const resumed = await readScoreContract(cdp);
  assertScoreActions(resumed, presetById("flip-7"));
  assert.match(resumed.hint, /Target 200 points/);
  assert.equal(resumed.helper, "This preset only adds points. Whole numbers from 0 to 1000000.");

  assert.deepEqual(consoleProblems, [], "the persistence session must not produce uncaught console errors");
}

// Session 4 (Scenarios 6 + 7): Flip 7 ×2 math, target hints, and sign rules.
async function runFlip7Session(cdp, { consoleProblems }) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");
  await createGameWithPreset(cdp, { presetId: "flip-7", title: null, names: ["Alex", "Sam", "Jamie"] });

  const startRaw = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
  const multiply = "[data-action='multiply-score-draft']";

  // Empty ×2 stages 0 and keeps focus; no totals or storage change.
  await evaluate(cdp, (selector) => document.querySelector(selector)?.focus(), multiply);
  await click(cdp, multiply);
  let state = await evaluate(cdp, () => ({
    value: document.querySelector("#score-amount")?.value ?? null,
    focusAction: document.activeElement?.dataset?.action ?? null,
    totals: [...document.querySelectorAll(".active-player-total")].map((node) => node.textContent.trim())
  }));
  assert.equal(state.value, "0", "×2 from an empty draft shows 0");
  assert.equal(state.focusAction, "multiply-score-draft", "focus stays on ×2");
  assert.deepEqual(state.totals, ["0", "0", "0"]);
  assert.equal((await readSavedGamesState(cdp, STORAGE_KEY)).raw, startRaw, "×2 never saves");

  // Locked example: 12 → ×2 → 24 → +15 → 39 → Save.
  await fill(cdp, "#score-amount", "12");
  await click(cdp, multiply);
  state = await evaluate(cdp, () => ({
    value: document.querySelector("#score-amount")?.value ?? null,
    focusAction: document.activeElement?.dataset?.action ?? null
  }));
  assert.equal(state.value, "24", "×2 doubles the draft");
  assert.equal(state.focusAction, "multiply-score-draft", "×2 keeps focus");
  await click(cdp, "[data-action='apply-quick-score'][data-amount='15']");
  state = await evaluate(cdp, () => ({
    value: document.querySelector("#score-amount")?.value ?? null,
    totals: [...document.querySelectorAll(".active-player-total")].map((node) => node.textContent.trim())
  }));
  assert.equal(state.value, "39");
  assert.deepEqual(state.totals, ["0", "0", "0"], "draft staging never changes totals");
  assert.equal((await readSavedGamesState(cdp, STORAGE_KEY)).raw, startRaw, "the full draft walk is a no-save");
  await click(cdp, "[data-score-form] button[type='submit']");
  await waitForSelector(cdp, "#score-amount");
  const saved = await evaluate(cdp, () => ({
    feedback: document.querySelector("#score-feedback")?.textContent?.trim() ?? "",
    total: document.querySelector(".active-player-total")?.textContent?.trim() ?? null
  }));
  assert.equal(saved.feedback, "Added 39 points to Alex. New total: 39. Rank: 1.", "Save writes one ordinary change of 39");
  assert.equal(saved.total, "39");
  const storedAfterSave = (await readStoredGames(cdp)).payload.games[0];
  assert.equal(storedAfterSave.changes.length, 1);
  assert.equal(storedAfterSave.changes[0].amount, 39);

  // The target is a hint only: scoring past 200 keeps the game active.
  await savePoints(cdp, "200");
  const pastTarget = await readScoreContract(cdp);
  assert.equal(pastTarget.finishOpener, true, "the finish control stays available past the target");
  assert.equal(pastTarget.podium, false, "the target never opens the podium");
  assert.equal(pastTarget.scoreForm, true, "scoring stays available past the target");
  const pastTargetTotal = await evaluate(cdp, () => document.querySelector(".active-player-total")?.textContent?.trim() ?? null);
  assert.equal(pastTargetTotal, "239");

  // Typed negatives are rejected with the documented message and no write.
  const rawBeforeNegative = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
  await fill(cdp, "#score-amount", "-5");
  await click(cdp, "[data-score-form] button[type='submit']");
  const negative = await evaluate(cdp, () => ({
    feedback: document.querySelector("#score-feedback")?.textContent?.trim() ?? "",
    total: document.querySelector(".active-player-total")?.textContent?.trim() ?? null
  }));
  assert.equal(negative.feedback, NEGATIVE_MESSAGE);
  assert.equal(negative.total, "239", "a rejected negative changes no total");
  assert.equal((await readSavedGamesState(cdp, STORAGE_KEY)).raw, rawBeforeNegative, "a rejected negative writes nothing");
  const negativeScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-flip7-negative-rejection.png"));

  // Stepper floor and zero handling.
  await fill(cdp, "#score-amount", "0");
  await click(cdp, "[data-action='step-score-down']");
  assert.equal(await evaluate(cdp, () => document.querySelector("#score-amount")?.value), "0", "the stepper cannot go below 0");
  await fill(cdp, "#score-amount", "-5");
  await click(cdp, "[data-action='step-score-up']");
  assert.equal(await evaluate(cdp, () => document.querySelector("#score-amount")?.value), "1", "a typed negative baseline is treated as 0 for the next step");
  await fill(cdp, "#score-amount", "0");
  await click(cdp, "[data-score-form] button[type='submit']");
  const zero = await evaluate(cdp, () => ({
    feedback: document.querySelector("#score-feedback")?.textContent?.trim() ?? "",
    total: document.querySelector(".active-player-total")?.textContent?.trim() ?? null
  }));
  assert.equal(zero.feedback, POSITIVE_ZERO_MESSAGE);
  assert.equal(zero.total, "239");
  const negatives = await evaluate(cdp, () => document.querySelectorAll("[data-action='apply-quick-score'].is-negative").length);
  assert.equal(negatives, 0, "a non-negative preset renders no negative quick action");

  assert.deepEqual(consoleProblems, [], "the Flip 7 session must not produce uncaught console errors");
  return { negativeScreenshot };
}

// Session 5 (Scenario 8): back-compatibility, unknown fallback, replay, and
// scratchpad preservation/reset.
async function runBackCompatSession(cdp, { consoleProblems }) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  const players = (names, totals) => names.map((name, index) => ({
    id: `seed-player-${index + 1}`,
    name,
    color: ["blue", "red", "green"][index % 3],
    marker: String(index + 1),
    order: index,
    total: totals[index]
  }));
  const seed = {
    version: 1,
    games: [
      {
        id: "old-active-1",
        title: "Old game",
        status: "active",
        createdAt: "2026-10-01T10:00:00.000Z",
        updatedAt: "2026-10-01T10:05:00.000Z",
        players: players(["Old Alex", "Old Sam"], [3, 0]),
        changes: []
      },
      {
        id: "unknown-active-1",
        title: "Mystery preset",
        status: "active",
        presetId: "retired-preset",
        createdAt: "2026-10-01T10:01:00.000Z",
        updatedAt: "2026-10-01T10:04:00.000Z",
        players: players(["Mystery Alex", "Mystery Sam"], [5, 2]),
        changes: []
      },
      {
        id: "finished-preset-1",
        title: "Flip 7 final",
        status: "finished",
        presetId: "flip-7",
        createdAt: "2026-10-01T10:02:00.000Z",
        updatedAt: "2026-10-01T10:03:00.000Z",
        players: players(["Flip Alex", "Flip Sam", "Flip Jamie"], [12, 12, 8]),
        changes: []
      },
      {
        id: "finished-custom-1",
        title: "Old final",
        status: "finished",
        createdAt: "2026-10-01T09:00:00.000Z",
        updatedAt: "2026-10-01T09:30:00.000Z",
        players: players(["Old Final Alex", "Old Final Sam"], [5, 3]),
        changes: []
      }
    ]
  };
  await evaluate(cdp, (payload) => {
    localStorage.setItem("scorekeeper:games", JSON.stringify(payload));
  }, seed);
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  // A pre-feature active game behaves exactly like Custom.
  await click(cdp, "[data-action='resume-game'][data-game-id='old-active-1']");
  await waitForSelector(cdp, "#score-amount");
  let contract = await readScoreContract(cdp);
  assertScoreActions(contract, presetById("custom"));
  assert.equal(contract.hint, null);
  await goHome(cdp);

  // An unknown stored id also falls back to Custom without a load-time rewrite.
  await click(cdp, "[data-action='resume-game'][data-game-id='unknown-active-1']");
  await waitForSelector(cdp, "#score-amount");
  contract = await readScoreContract(cdp);
  assertScoreActions(contract, presetById("custom"));
  assert.equal(contract.hint, null);
  const unknownStored = (await readStoredGames(cdp)).payload.games.find((game) => game.id === "unknown-active-1");
  assert.equal(unknownStored.presetId, "retired-preset", "unknown ids are preserved verbatim in storage");
  await goHome(cdp);

  // Preset replay copies the valid preset but starts untitled; originals stay
  // byte-identical.
  const before = (await readStoredGames(cdp)).payload;
  const beforePreset = JSON.stringify(before.games.find((game) => game.id === "finished-preset-1"));
  const beforeCustom = JSON.stringify(before.games.find((game) => game.id === "finished-custom-1"));
  await click(cdp, "[data-action='view-results'][data-game-id='finished-preset-1']");
  await waitForSelector(cdp, "[data-action='play-again']");
  await click(cdp, "[data-action='play-again']");
  await waitForSelector(cdp, "#score-amount");
  contract = await readScoreContract(cdp);
  assertScoreActions(contract, presetById("flip-7"));
  assert.notEqual(contract.heading, "Flip 7 final", "a preset replay still starts untitled");
  const replayScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-preset-replay.png"));
  let { payload } = await readStoredGames(cdp);
  const presetReplay = payload.games.find((game) => game.id.startsWith("replay-game-") && game.presetId === "flip-7");
  assert.ok(presetReplay, "the preset replay stores its valid preset id");
  assert.equal(presetReplay.title, "", "the preset replay title is empty");
  assert.equal(presetReplay.players.length, 3);
  await goHome(cdp);

  await click(cdp, "[data-action='view-results'][data-game-id='finished-custom-1']");
  await waitForSelector(cdp, "[data-action='play-again']");
  await click(cdp, "[data-action='play-again']");
  await waitForSelector(cdp, "#score-amount");
  contract = await readScoreContract(cdp);
  assertScoreActions(contract, presetById("custom"));
  ({ payload } = await readStoredGames(cdp));
  const customReplay = payload.games.find(
    (game) => game.id.startsWith("replay-game-") && game.players?.some((player) => player.name === "Old Final Alex")
  );
  assert.ok(customReplay, "the Custom replay is stored");
  assert.equal("presetId" in customReplay, false, "a Custom replay omits presetId");
  assert.equal(customReplay.title, "");
  assert.equal(
    JSON.stringify(payload.games.find((game) => game.id === "finished-preset-1")),
    beforePreset,
    "the finished preset original stays byte-identical"
  );
  assert.equal(
    JSON.stringify(payload.games.find((game) => game.id === "finished-custom-1")),
    beforeCustom,
    "the finished custom original stays byte-identical"
  );

  // Scratchpad: nav New Game preserves preset/title/roster without writing, and
  // the hero New game resets to Custom/two empty rows.
  await goHome(cdp);
  await click(cdp, "[data-action='new-game']");
  await waitForSelector(cdp, "#game-preset-custom");
  await selectPreset(cdp, "flip-7");
  await fill(cdp, "#game-title", "Friday Flip");
  await fillNames(cdp, ["Scratch A", "Scratch B", "Scratch C"]);
  const keyCountBeforeNav = (await readSavedGamesState(cdp, STORAGE_KEY)).keyCount;
  await click(cdp, "[data-action='nav-dashboard']");
  await waitForSelector(cdp, "[data-home-heading]");
  await click(cdp, "[data-action='nav-new-game']");
  await waitForSelector(cdp, "#game-preset-flip-7");
  const scratch = await readSetupContract(cdp);
  assert.equal(scratch.checked, "flip-7", "nav New Game preserves the selected preset");
  assert.equal(scratch.title, "Friday Flip");
  assert.deepEqual(scratch.names, ["Scratch A", "Scratch B", "Scratch C"]);
  assert.equal(scratch.focusId, "setup-title", "nav New Game focuses the setup heading, not the radio");
  assert.equal((await readSavedGamesState(cdp, STORAGE_KEY)).keyCount, keyCountBeforeNav, "scratchpad navigation writes nothing");

  await click(cdp, "[data-action='nav-dashboard']");
  await waitForSelector(cdp, "[data-home-heading]");
  await click(cdp, "[data-action='new-game']");
  await waitForSelector(cdp, "#game-preset-custom");
  const reset = await readSetupContract(cdp);
  assertCatalogueSetup(reset, presetById("custom"));
  assert.equal(reset.title, "");
  assert.equal(reset.rowCount, 2);
  assert.deepEqual(reset.names, ["", ""]);
  assert.equal(reset.focusId, "game-preset-custom");

  assert.deepEqual(consoleProblems, [], "the back-compat session must not produce uncaught console errors");
  return { replayScreenshot };
}

async function pressKey(cdp, { key, code, windowsVirtualKeyCode, nativeVirtualKeyCode }) {
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key,
    code,
    windowsVirtualKeyCode,
    nativeVirtualKeyCode
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key,
    code,
    windowsVirtualKeyCode,
    nativeVirtualKeyCode
  });
}

// Session 6 (Scenario 9): 320px layout, arrow-key selection, and target sizes.
async function runResponsiveSession(cdp, { consoleProblems }) {
  await setViewport(cdp, { width: 320, height: 720, mobile: true });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");
  await click(cdp, "[data-action='new-game']");
  await waitForSelector(cdp, "#game-preset-custom");

  const mobilePicker = await evaluate(cdp, () => {
    const options = document.querySelector(".preset-options");
    const cards = [...document.querySelectorAll(".preset-card")];
    const checked = cards.find((card) => card.querySelector("input")?.checked);
    const rects = cards.map((card) => card.getBoundingClientRect());
    return {
      columns: options ? getComputedStyle(options).gridTemplateColumns.split(" ").length : 0,
      minWidth: Math.min(...rects.map((rect) => rect.width)),
      minHeight: Math.min(...rects.map((rect) => rect.height)),
      checkedPresent: Boolean(checked),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
  assert.equal(mobilePicker.columns, 2, "the picker uses two columns at 320px");
  assert.ok(mobilePicker.minWidth >= 44 && mobilePicker.minHeight >= 44, "every preset card is at least 44px");
  assert.equal(mobilePicker.checkedPresent, true);
  assert.equal(mobilePicker.overflow, false);
  const pickerScreenshot = await screenshot(cdp, path.join(evidenceDir, "mobile-320-preset-picker.png"));

  // Native arrow keys move the radio selection, re-render the detail, and keep
  // focus on the selected radio.
  await evaluate(cdp, () => document.querySelector("#game-preset-custom")?.focus());
  await pressKey(cdp, { key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 });
  await waitForSelector(cdp, "[data-preset-detail][data-preset-id='flip-7']");
  const arrowed = await readSetupContract(cdp);
  assert.equal(arrowed.checked, "flip-7", "ArrowRight moves the radio selection");
  assert.equal(arrowed.title, "Flip 7", "the detail and title update together");
  assert.equal(arrowed.focusId, "game-preset-flip-7", "focus returns to the selected radio");
  const arrowRing = await evaluate(cdp, () => {
    const label = document.querySelector("#game-preset-flip-7")?.closest(".preset-card");
    const style = label ? getComputedStyle(label) : null;
    return { outlineStyle: style?.outlineStyle ?? null, outlineWidth: style?.outlineWidth ?? null };
  });
  assert.notEqual(arrowRing.outlineStyle, "none", "keyboard-selected preset cards show a visible ring");
  assert.notEqual(arrowRing.outlineWidth, "0px");

  await fillNames(cdp, ["Alex", "Sam", "Jamie"]);
  await startGame(cdp);
  const controls = await evaluate(cdp, () => {
    const buttons = [...document.querySelectorAll(".quick-score-action")];
    const rects = buttons.map((button) => button.getBoundingClientRect());
    const rows = [...document.querySelectorAll(".quick-scores-row")];
    return {
      count: buttons.length,
      minWidth: Math.min(...rects.map((rect) => rect.width)),
      minHeight: Math.min(...rects.map((rect) => rect.height)),
      rowCount: rows.length,
      rowCounts: rows.map((row) => row.querySelectorAll("button").length),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      hintPresent: Boolean(document.querySelector("[data-preset-hint]"))
    };
  });
  assert.equal(controls.count, 7, "Flip 7 renders ×2 plus six additions");
  assert.ok(controls.minWidth >= 44 && controls.minHeight >= 44, "all quick actions keep 44px targets at 320px");
  assert.equal(controls.overflow, false);
  assert.equal(controls.hintPresent, true);
  assert.ok(controls.rowCounts.every((count) => count > 0));
  const activeScreenshot = await screenshot(cdp, path.join(evidenceDir, "mobile-320-flip7-active.png"));

  assert.deepEqual(consoleProblems, [], "the responsive session must not produce uncaught console errors");
  return { pickerScreenshot, activeScreenshot };
}

async function main() {
  try {
    const catalogue = await runSession("catalogue", runCatalogueSession);
    assert.equal(typeof catalogue.catanScreenshot, "string");
    assert.equal(typeof catalogue.flipScreenshot, "string");

    await runSession("title-and-roster", runTitleAndRosterSession);
    await runSession("persistence", runPersistenceSession);
    const flip = await runSession("flip7", runFlip7Session);
    assert.equal(typeof flip.negativeScreenshot, "string");
    const backCompat = await runSession("back-compat", runBackCompatSession);
    assert.equal(typeof backCompat.replayScreenshot, "string");
    const responsive = await runSession("responsive", runResponsiveSession);
    assert.equal(typeof responsive.pickerScreenshot, "string");
    assert.equal(typeof responsive.activeScreenshot, "string");

    console.log("Browser presets test passed: New game renders exactly Custom, Flip 7, Catan, Ticket to Ride, 7 Wonders, Yahtzee above the title with Custom checked by default, two blank rows, the signed Custom quick-action preview, no target, and zero storage writes; each preset supplies its approved default roster, title, status/helper/limits, target/hint, and ordered quick actions (Flip 7's ×2 first, Catan's +1..+5, Ticket to Ride's signed seven, 7 Wonders' +1/+3/+5/+10/+20, Yahtzee's +5..+50 with the zero-category note); title auto-fill only replaces empty/auto-filled titles and manual titles survive switches; untouched rosters use presets' defaults while touched rosters append blank rows at the minimum and truncate only trailing rows at the maximum with retained names/colors; every preset starts and persists with the version-1 envelope storing presetId only for non-custom games, resumes with the same controls, and Flip 7's locked 12→×2→24→+15→39→Save writes one ordinary change while targets stay hints (239 still active with the finish control); non-negative presets reject typed negatives with the documented message and no write, the stepper floors at 0, zero keeps the zero error with the positive-only copy, and no negative quick action renders; pre-feature and unknown stored ids fall back to Custom behavior without rewriting storage, preset replay copies the valid preset but stays untitled while Custom replays omit the field and originals stay byte-identical, and the scratchpad preserves preset/title/roster across nav without writing while the hero New game resets to Custom; at 320×720 the six cards are two columns at least 44px with a visible focus ring, arrow keys move the selection and update detail/title, and all seven Flip 7 controls keep 44px targets with no overflow; zero uncaught console errors in every session.");
    console.log(`Browser evidence screenshots: ${[
      catalogue.catanScreenshot,
      catalogue.flipScreenshot,
      flip.negativeScreenshot,
      backCompat.replayScreenshot,
      responsive.pickerScreenshot,
      responsive.activeScreenshot
    ].join(", ")}`);
  } finally {
    await closeServer(server);
  }
}

await main();
