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
const evidenceDir = await createEvidenceDir("devexpert-undo-latest-score");
const server = createStaticServer();
const baseUrl = await listen(server);
let chrome;

async function createUndoGame(cdp, title, names) {
  await click(cdp, "[data-action='new-game']");
  await fill(cdp, "#game-title", title);
  for (let index = 2; index < names.length; index += 1) {
    await click(cdp, "[data-action='add-player']");
  }
  for (let index = 0; index < names.length; index += 1) {
    await fill(cdp, `#player-name-${index + 1}`, names[index]);
  }
  await click(cdp, "button[type='submit']");
  await waitForSelector(cdp, "#score-amount");
}

async function savePoints(cdp, value) {
  await fill(cdp, "#score-amount", value);
  await click(cdp, "[data-score-form] button[type='submit']");
}

async function clickPlayerRow(cdp, playerId) {
  await evaluate(cdp, (targetPlayerId) => {
    const button = document.querySelector(`[data-player-id="${targetPlayerId}"] .add-points-action`);
    if (!button) {
      throw new Error(`Missing row button for ${targetPlayerId}`);
    }
    button.click();
  }, playerId);
}

async function clickUndo(cdp) {
  await evaluate(cdp, () => {
    const button = document.querySelector("[data-action='undo-last-score']");
    if (!button) {
      throw new Error("Missing undo button");
    }
    button.click();
  });
}

async function readUndoState(cdp) {
  return evaluate(cdp, () => ({
    playerIds: [...document.querySelectorAll(".active-player")].map((row) => row.dataset.playerId),
    names: [...document.querySelectorAll(".active-player-name")].map((node) => node.textContent.trim()),
    totals: [...document.querySelectorAll(".active-player-total")].map((node) => node.textContent.trim()),
    ranks: [...document.querySelectorAll(".active-player-rank")].map((node) => node.textContent.trim()),
    totalLabels: [...document.querySelectorAll(".active-player-total")].map((node) => node.getAttribute("aria-label")),
    pressedStates: [...document.querySelectorAll(".add-points-action")].map((button) => button.getAttribute("aria-pressed")),
    selectedRowName: document.querySelector(".active-player.is-selected .active-player-name")?.textContent?.trim() ?? null,
    feedback: document.querySelector("#score-feedback")?.textContent?.trim() ?? "",
    infoPresent: Boolean(document.querySelector("#score-feedback .info-message")),
    errorPresent: Boolean(document.querySelector("#score-feedback .validation-message")),
    successPresent: Boolean(document.querySelector("#score-feedback .success-message")),
    inputValue: document.querySelector("#score-amount")?.value ?? null,
    focusedId: document.activeElement?.id ?? "",
    focusedAction: document.activeElement?.dataset?.action ?? "",
    localStorageLength: localStorage.length,
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
  }));
}

async function readInfoStyle(cdp) {
  return evaluate(cdp, () => {
    const message = document.querySelector("#score-feedback .info-message");
    if (!message) {
      throw new Error("Missing info message");
    }
    return {
      text: message.textContent.trim(),
      color: getComputedStyle(message).color,
      fontWeight: getComputedStyle(message).fontWeight
    };
  });
}

async function pressEnter(cdp) {
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
    text: "\r"
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13
  });
}

async function runLatestRecipientScenario(cdp, url) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, url);
  await waitForSelector(cdp, "[data-action='new-game']");
  await createUndoGame(cdp, "Undo test", ["Alex", "Sam"]);

  const savedAfterStart = await readSavedGamesState(cdp, STORAGE_KEY);
  assert.equal(savedAfterStart.keyCount, 1);
  assert.equal(savedAfterStart.keyName, STORAGE_KEY);
  assert.equal(savedAfterStart.payloadVersion, 1);
  assert.equal(savedAfterStart.gameCount, 1, "starting the game saved its snapshot");

  const labels = await evaluate(cdp, () => {
    const saveButton = document.querySelector("[data-score-form] button[type='submit']");
    const undoButton = document.querySelector("[data-action='undo-last-score']");
    return {
      undoLabel: undoButton?.textContent?.trim(),
      undoType: undoButton?.getAttribute("type"),
      undoClass: undoButton?.className,
      undoFollowsSave: Boolean(saveButton && undoButton && saveButton.nextElementSibling === undoButton),
      undoInForm: Boolean(undoButton?.closest("[data-score-form]"))
    };
  });
  assert.equal(labels.undoLabel, "Undo last score");
  assert.equal(labels.undoType, "button", "undo must be type=button so it never submits the form");
  assert.equal(labels.undoInForm, true, "undo lives in the score-entry panel");
  assert.equal(labels.undoFollowsSave, true, "undo must come after Save points");
  assert.match(labels.undoClass, /secondary-action/);

  // Scenario 1: +10 Alex, +5 Sam -> undo restores only Sam.
  await savePoints(cdp, "10");
  let state = await readUndoState(cdp);
  assert.deepEqual(state.totals, ["10", "0"]);
  assert.equal(state.focusedAction, "", "a save does not focus the undo button");

  await clickPlayerRow(cdp, "active-game-player-2");
  await savePoints(cdp, "5");
  state = await readUndoState(cdp);
  assert.deepEqual(state.totals, ["10", "5"]);
  assert.deepEqual(state.ranks, ["1", "2"]);
  assert.deepEqual(state.pressedStates, ["false", "true"], "Sam must be selected before the undo");

  await clickUndo(cdp);
  state = await readUndoState(cdp);
  assert.deepEqual(state.totals, ["10", "0"], "only the latest recipient's total is restored");
  assert.deepEqual(state.ranks, ["1", "2"]);
  assert.deepEqual(state.pressedStates, ["false", "true"], "selection and aria-pressed must not change");
  assert.equal(state.selectedRowName, "Sam");
  assert.equal(state.successPresent, true);
  assert.equal(state.errorPresent, false);
  assert.equal(state.infoPresent, false);
  assert.match(state.feedback, /Undid 5 points for Sam\. New total: 0\. Rank: 2\./);
  assert.equal(state.focusedAction, "undo-last-score", "focus must move to the undo button after a successful undo");
  assert.equal(state.focusedId, "", "the undo button is not an id-target");
  assert.equal(state.inputValue, "", "the re-render clears the amount input");
  assert.equal(state.localStorageLength, 1, "the successful undo persists the shortened log under the single key");
  assert.equal(state.horizontalOverflow, false);

  const savedAfterUndo = await readSavedGamesState(cdp, STORAGE_KEY);
  assert.equal(savedAfterUndo.gameCount, 1, "undo updates the same saved snapshot instead of adding one");

  // The log had one entry left, so the next undo reverses Alex's +10.
  await clickUndo(cdp);
  state = await readUndoState(cdp);
  assert.deepEqual(state.totals, ["0", "0"], "the second undo must remove Alex's +10");
  assert.deepEqual(state.ranks, ["1", "1"]);
  assert.match(state.feedback, /Undid 10 points for Alex\. New total: 0\. Rank: 1\./);
  assert.equal(state.focusedAction, "undo-last-score");

  return screenshot(cdp, path.join(evidenceDir, "desktop-undo-latest.png"));
}

async function runNoChangeScenario(cdp, url) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, url);
  await waitForSelector(cdp, "[data-action='new-game']");
  await createUndoGame(cdp, "Empty log test", ["Alex", "Sam"]);

  const savedAfterSecondGame = await readSavedGamesState(cdp, STORAGE_KEY);
  assert.equal(savedAfterSecondGame.gameCount, 2, "the second game is a second saved snapshot");
  const rawBeforeNoOp = savedAfterSecondGame.raw;

  // Scenario 2: undo on a fresh game is an announced, non-error no-op.
  await evaluate(cdp, () => {
    document.querySelector(".active-player")?.setAttribute("data-sentinel", "kept");
    document.querySelector("#score-amount")?.focus();
  });

  await clickUndo(cdp);
  const state = await readUndoState(cdp);
  assert.equal(state.infoPresent, true, "the empty-log no-op must use the info kind");
  assert.equal(state.errorPresent, false, "the empty-log no-op must not be styled as an error");
  assert.equal(state.successPresent, false);
  assert.equal(state.feedback, "Nothing to undo yet.");
  assert.equal(state.focusedId, "score-amount", "the no-op must not move focus");
  assert.deepEqual(state.totals, ["0", "0"]);
  assert.deepEqual(state.ranks, ["1", "1"]);
  assert.equal(state.localStorageLength, 1);
  assert.equal(state.horizontalOverflow, false);

  const rawAfterNoOp = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
  assert.equal(rawAfterNoOp, rawBeforeNoOp, "the nothing-to-undo no-op must never write storage");

  const infoStyle = await readInfoStyle(cdp);
  assert.equal(infoStyle.text, "Nothing to undo yet.");
  assert.equal(infoStyle.color, "rgb(109, 101, 92)", "info feedback must use the muted token color");
  assert.notEqual(infoStyle.color, "rgb(159, 39, 30)", "info feedback must not use the error color");

  const sentinel = await evaluate(cdp, () => document.querySelector(".active-player")?.dataset.sentinel ?? null);
  assert.equal(sentinel, "kept", "the empty-log no-op must not re-render the view");

  // After a full drain the same no-op applies (covered fully by the walk-back scenario).
  return true;
}

async function runNegativeChangeScenario(cdp, url) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, url);
  await waitForSelector(cdp, "[data-action='new-game']");
  await createUndoGame(cdp, "Negative undo test", ["Alex", "Sam"]);

  const savedAfterThirdGame = await readSavedGamesState(cdp, STORAGE_KEY);
  assert.equal(savedAfterThirdGame.gameCount, 3, "the third game is a third saved snapshot");

  // Scenario 3: undo after a negative change.
  await savePoints(cdp, "-3");
  let state = await readUndoState(cdp);
  assert.deepEqual(state.names, ["Sam", "Alex"], "negative totals sort below zero");
  assert.deepEqual(state.totals, ["0", "-3"]);
  assert.deepEqual(state.ranks, ["1", "2"]);

  await clickUndo(cdp);
  state = await readUndoState(cdp);
  assert.deepEqual(state.totals, ["0", "0"], "undoing -3 restores Alex's prior total");
  assert.deepEqual(state.ranks, ["1", "1"]);
  assert.match(state.feedback, /Undid -3 points for Alex\. New total: 0\. Rank: 1\./, "the raw signed amount is announced");
  assert.equal(state.focusedAction, "undo-last-score");
  assert.equal(state.localStorageLength, 1, "the negative-change undo persists under the single key");
  assert.equal(state.horizontalOverflow, false);
  return true;
}

async function runWalkBackScenario(cdp, url) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, url);
  await waitForSelector(cdp, "[data-action='new-game']");
  await createUndoGame(cdp, "Walk-back test", ["Alex", "Sam", "Jamie"]);

  const savedAfterFourthGame = await readSavedGamesState(cdp, STORAGE_KEY);
  assert.equal(savedAfterFourthGame.gameCount, 4, "the fourth game is a fourth saved snapshot");

  // Scenario 4: +10 Alex, +12 Sam, +8 Jamie applied in that order.
  await savePoints(cdp, "10");
  await clickPlayerRow(cdp, "active-game-player-2");
  await savePoints(cdp, "12");
  await clickPlayerRow(cdp, "active-game-player-3");
  await savePoints(cdp, "8");
  let state = await readUndoState(cdp);
  assert.deepEqual(state.names, ["Sam", "Alex", "Jamie"]);
  assert.deepEqual(state.totals, ["12", "10", "8"]);
  assert.deepEqual(state.ranks, ["1", "2", "3"]);

  await evaluate(cdp, () => {
    document.querySelector("[data-action='undo-last-score']")?.focus();
  });

  await pressEnter(cdp);
  state = await readUndoState(cdp);
  assert.deepEqual(state.names, ["Sam", "Alex", "Jamie"], "Jamie's 8 is gone, Sam still leads");
  assert.deepEqual(state.totals, ["12", "10", "0"]);
  assert.deepEqual(state.ranks, ["1", "2", "3"]);
  assert.match(state.feedback, /Undid 8 points for Jamie\. New total: 0\. Rank: 3\./);
  assert.equal(state.focusedAction, "undo-last-score", "focus must stay on the undo button between presses");

  await pressEnter(cdp);
  state = await readUndoState(cdp);
  assert.deepEqual(state.names, ["Alex", "Sam", "Jamie"], "Sam's 12 is gone, Alex leads again");
  assert.deepEqual(state.totals, ["10", "0", "0"]);
  assert.deepEqual(state.ranks, ["1", "2", "2"]);
  assert.match(state.feedback, /Undid 12 points for Sam\. New total: 0\. Rank: 2\./);
  assert.equal(state.focusedAction, "undo-last-score");

  await pressEnter(cdp);
  state = await readUndoState(cdp);
  assert.deepEqual(state.totals, ["0", "0", "0"], "Alex's 10 is gone; the log is drained");
  assert.deepEqual(state.ranks, ["1", "1", "1"]);
  assert.match(state.feedback, /Undid 10 points for Alex\. New total: 0\. Rank: 1\./);
  assert.equal(state.focusedAction, "undo-last-score");

  // The fourth press is the safe no-op.
  await evaluate(cdp, () => {
    document.querySelector(".active-player")?.setAttribute("data-sentinel", "kept");
  });
  await pressEnter(cdp);
  state = await readUndoState(cdp);
  assert.equal(state.infoPresent, true);
  assert.equal(state.errorPresent, false);
  assert.equal(state.feedback, "Nothing to undo yet.");
  assert.deepEqual(state.totals, ["0", "0", "0"]);
  assert.equal(state.focusedAction, "undo-last-score", "the no-op must not move focus from the undo button");
  assert.equal(state.localStorageLength, 1);
  assert.equal(state.horizontalOverflow, false);

  const savedAfterDrain = await readSavedGamesState(cdp, STORAGE_KEY);
  assert.equal(savedAfterDrain.gameCount, 4, "draining the log through no-op undos must not grow the saved list");

  const sentinel = await evaluate(cdp, () => document.querySelector(".active-player")?.dataset.sentinel ?? null);
  assert.equal(sentinel, "kept", "the drained-log no-op must not re-render the view");
  return true;
}

async function runOvertakeScenario(cdp, url) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, url);
  await waitForSelector(cdp, "[data-action='new-game']");
  await createUndoGame(cdp, "Overtake undo test", ["Alex", "Sam"]);

  const savedAfterFifthGame = await readSavedGamesState(cdp, STORAGE_KEY);
  assert.equal(savedAfterFifthGame.gameCount, 5, "the fifth game is a fifth saved snapshot");

  await savePoints(cdp, "7");
  await clickPlayerRow(cdp, "active-game-player-2");
  await savePoints(cdp, "5");
  let state = await readUndoState(cdp);
  assert.deepEqual(state.names, ["Alex", "Sam"]);
  assert.deepEqual(state.totals, ["7", "5"]);
  assert.deepEqual(state.ranks, ["1", "2"]);

  // Scenario 5: the latest change overtakes; undo must revert the order and ranks.
  await savePoints(cdp, "5");
  state = await readUndoState(cdp);
  assert.deepEqual(state.names, ["Sam", "Alex"], "Sam 10 overtakes Alex 7");
  assert.deepEqual(state.totals, ["10", "7"]);
  assert.deepEqual(state.ranks, ["1", "2"]);

  await clickUndo(cdp);
  state = await readUndoState(cdp);
  assert.deepEqual(state.names, ["Alex", "Sam"], "rows must revert to the pre-change order");
  assert.deepEqual(state.totals, ["7", "5"]);
  assert.deepEqual(state.ranks, ["1", "2"]);
  assert.deepEqual(state.totalLabels, ["Alex: rank 1, total 7", "Sam: rank 2, total 5"]);
  assert.deepEqual(state.pressedStates, ["false", "true"], "aria-pressed must follow Sam across the reorder");
  assert.equal(state.selectedRowName, "Sam");
  assert.match(state.feedback, /Undid 5 points for Sam\. New total: 5\. Rank: 2\./);
  assert.equal(state.focusedAction, "undo-last-score");
  assert.equal(state.localStorageLength, 1, "the revert persists under the single key");
  assert.equal(state.horizontalOverflow, false);
  return true;
}

async function runMobileScenario(cdp, url) {
  // Scenario 6: 320px layout and keyboard accessibility.
  await setViewport(cdp, { width: 320, height: 720, mobile: true });
  await navigate(cdp, url);
  await waitForSelector(cdp, "[data-action='new-game']");
  await createUndoGame(cdp, "Mobile undo test", ["Alex", "Sam"]);

  const savedAfterSixthGame = await readSavedGamesState(cdp, STORAGE_KEY);
  assert.equal(savedAfterSixthGame.gameCount, 6, "the sixth game is a sixth saved snapshot");

  await savePoints(cdp, "10");

  const layout = await evaluate(cdp, () => {
    const roster = document.querySelector(".roster-panel")?.getBoundingClientRect();
    const panel = document.querySelector(".score-panel")?.getBoundingClientRect();
    const saveButton = document.querySelector("[data-score-form] button[type='submit']");
    const undoButton = document.querySelector("[data-action='undo-last-score']");
    const saveRect = saveButton?.getBoundingClientRect();
    const undoRect = undoButton?.getBoundingClientRect();

    return {
      stacked: Boolean(roster && panel && panel.top >= roster.bottom),
      undoVisible: Boolean(undoButton && undoButton.clientHeight > 0 && undoButton.offsetParent !== null),
      undoHeight: undoRect?.height ?? 0,
      undoWidth: undoRect?.width ?? 0,
      undoBelowSave: Boolean(saveRect && undoRect && undoRect.top >= saveRect.bottom),
      focusOutline: (() => {
        undoButton?.focus();
        const style = getComputedStyle(undoButton);
        return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
      })(),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
  assert.equal(layout.stacked, true, "the score panel should stack below the roster at 320px");
  assert.equal(layout.undoVisible, true, "the undo button must be visible at 320px");
  assert.ok(layout.undoHeight >= 44, "the undo button needs a roughly 44px touch target");
  assert.ok(layout.undoWidth >= 44, "the undo button needs a roughly 44px touch target");
  assert.equal(layout.undoBelowSave, true, "the undo button must sit below Save points");
  assert.notEqual(layout.focusOutline.outlineStyle, "none", "the undo button needs a visible focus style");
  assert.notEqual(layout.focusOutline.outlineWidth, "0px");
  assert.equal(layout.horizontalOverflow, false, "a scored game must not overflow at 320px");

  // Keyboard-only undo: Enter on the focused button walks the history back.
  await evaluate(cdp, () => {
    document.querySelector("[data-action='undo-last-score']")?.focus();
  });
  await pressEnter(cdp);
  let state = await readUndoState(cdp);
  assert.deepEqual(state.totals, ["0", "0"], "keyboard undo must restore Alex's total");
  assert.match(state.feedback, /Undid 10 points for Alex\. New total: 0\. Rank: 1\./);
  assert.equal(state.focusedAction, "undo-last-score", "focus must stay on the undo button for repeated presses");

  await pressEnter(cdp);
  state = await readUndoState(cdp);
  assert.equal(state.infoPresent, true);
  assert.equal(state.errorPresent, false);
  assert.equal(state.feedback, "Nothing to undo yet.");
  assert.equal(state.focusedAction, "undo-last-score");
  assert.equal(state.localStorageLength, 1);
  assert.equal(state.horizontalOverflow, false);
  return screenshot(cdp, path.join(evidenceDir, "mobile-undo-320px.png"));
}

async function main() {
  try {
    const userDataDir = path.join(evidenceDir, "chrome-profile");

    const launched = await launchChrome({ chromePath, userDataDir, url: baseUrl });
    chrome = launched.chrome;
    const cdp = await CdpClient.connect(launched.webSocketUrl);

    const consoleProblems = [];
    cdp.on("Runtime.exceptionThrown", (event) => {
      consoleProblems.push(event.exceptionDetails?.text ?? "Runtime exception");
    });
    cdp.on("Log.entryAdded", (event) => {
      if (event.entry?.level === "error") {
        consoleProblems.push(event.entry.text);
      }
    });

    await cdp.send("Runtime.enable");
    await cdp.send("Log.enable");
    await cdp.send("Page.enable");
    const desktopUndoScreenshot = await runLatestRecipientScenario(cdp, baseUrl);
    await runNoChangeScenario(cdp, baseUrl);
    await runNegativeChangeScenario(cdp, baseUrl);
    await runWalkBackScenario(cdp, baseUrl);
    await runOvertakeScenario(cdp, baseUrl);
    const mobileUndoScreenshot = await runMobileScenario(cdp, baseUrl);

    assert.deepEqual(consoleProblems, [], "browser console should not report errors");

    console.log("Browser undo test passed: only the latest recipient is restored, the empty-log no-op announces info without re-render or storage writes, negative changes undo with signed amounts, three keyboard undos walk back and then stop safely, an overtaken leaderboard reverts order and ranks, and the 320px panel keeps a >=44px keyboard-operable undo button with visible focus; single-key persistence across six games and no console errors.");
    console.log(`Browser evidence screenshots: ${desktopUndoScreenshot}, ${mobileUndoScreenshot}`);
  } finally {
    if (chrome) {
      chrome.kill("SIGTERM");
    }
    await closeServer(server);
  }
}

await main();
