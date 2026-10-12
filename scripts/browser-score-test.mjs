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
const evidenceDir = await createEvidenceDir("devexpert-add-player-score");
const server = createStaticServer();
const baseUrl = await listen(server);
let chrome;

async function createScoreGame(cdp) {
  await click(cdp, "[data-action='new-game']");
  await fill(cdp, "#game-title", "Score test");
  await fill(cdp, "#player-name-1", "Alex");
  await fill(cdp, "#player-name-2", "Sam");
  await click(cdp, "button[type='submit']");
  await waitForSelector(cdp, "#score-amount");
}

async function savePoints(cdp, value) {
  await fill(cdp, "#score-amount", value);
  await click(cdp, "[data-score-form] button[type='submit']");
}

async function readScoreState(cdp) {
  return evaluate(cdp, () => ({
    totals: [...document.querySelectorAll(".active-player-total")].map((node) => node.textContent.trim()),
    feedback: document.querySelector("#score-feedback")?.textContent?.trim() ?? "",
    errorPresent: Boolean(document.querySelector("#score-feedback .validation-message")),
    successPresent: Boolean(document.querySelector("#score-feedback .success-message")),
    inputValue: document.querySelector("#score-amount")?.value ?? null,
    focusedId: document.activeElement?.id ?? "",
    pressedStates: [...document.querySelectorAll(".add-points-action")].map((button) => button.getAttribute("aria-pressed")),
    selectedRowName: document.querySelector(".active-player.is-selected .active-player-name")?.textContent?.trim() ?? null,
    localStorageLength: localStorage.length,
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
  }));
}

async function runDesktopScenario(cdp, url) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, url);
  await waitForSelector(cdp, "[data-action='new-game']");
  await createScoreGame(cdp);

  const initial = await readScoreState(cdp);
  assert.equal(initial.selectedRowName, "Alex", "the first player should be selected by default");
  assert.deepEqual(initial.pressedStates, ["true", "false"]);
  assert.deepEqual(initial.totals, ["0", "0"]);
  assert.equal(initial.localStorageLength, 1, "starting the game saved one storage key");
  assert.equal(initial.horizontalOverflow, false);

  const savedAfterStart = await readSavedGamesState(cdp, STORAGE_KEY);
  assert.equal(savedAfterStart.keyCount, 1);
  assert.equal(savedAfterStart.keyName, STORAGE_KEY);
  assert.equal(savedAfterStart.payloadVersion, 1);
  assert.equal(savedAfterStart.gameCount, 1);

  const labels = await evaluate(cdp, () => ({
    panelTitle: document.querySelector("#score-panel-title")?.textContent?.trim(),
    panelName: document.querySelector(".score-selected-name")?.textContent?.trim(),
    amountLabel: document.querySelector("label[for='score-amount']")?.textContent?.trim(),
    helper: document.querySelector("#score-help")?.textContent?.trim(),
    inputType: document.querySelector("#score-amount")?.getAttribute("type"),
    inputStep: document.querySelector("#score-amount")?.getAttribute("step"),
    inputMin: document.querySelector("#score-amount")?.getAttribute("min"),
    inputMax: document.querySelector("#score-amount")?.getAttribute("max"),
    saveLabel: document.querySelector("[data-score-form] button[type='submit']")?.textContent?.trim(),
    rowButtonLabels: [...document.querySelectorAll(".add-points-action")].map((button) => button.getAttribute("aria-label"))
  }));
  assert.equal(labels.panelTitle, "Add points");
  assert.equal(labels.panelName, "Alex");
  assert.equal(labels.amountLabel, "Points for Alex");
  assert.match(labels.helper, /Use negative points for penalties/);
  assert.equal(labels.inputType, "number");
  assert.equal(labels.inputStep, "1");
  assert.equal(labels.inputMin, "-1000000");
  assert.equal(labels.inputMax, "1000000");
  assert.equal(labels.saveLabel, "Save points");
  assert.deepEqual(labels.rowButtonLabels, ["Add points for Alex", "Add points for Sam"]);

  // Scenario 1: +10 then -3 lands on total 7.
  await savePoints(cdp, "10");
  let after = await readScoreState(cdp);
  assert.deepEqual(after.totals, ["10", "0"]);
  assert.equal(after.successPresent, true);
  assert.equal(after.errorPresent, false);
  assert.match(after.feedback, /Added 10 points to Alex\. New total: 10\./);
  assert.equal(after.inputValue, "", "the input should be cleared after a successful save");
  assert.equal(after.focusedId, "score-amount", "focus should stay in the input after a successful save");

  await savePoints(cdp, "-3");
  after = await readScoreState(cdp);
  assert.deepEqual(after.totals, ["7", "0"]);
  assert.match(after.feedback, /Added -3 points to Alex\. New total: 7\./);

  // Scenario 2: other players are unaffected.
  await evaluate(cdp, () => {
    [...document.querySelectorAll("[data-action='select-player']")][1].click();
  });
  after = await readScoreState(cdp);
  assert.equal(after.selectedRowName, "Sam");
  assert.deepEqual(after.pressedStates, ["false", "true"]);
  assert.deepEqual(after.totals, ["7", "0"]);

  await savePoints(cdp, "5");
  after = await readScoreState(cdp);
  assert.deepEqual(after.totals, ["7", "5"]);
  assert.match(after.feedback, /Added 5 points to Sam\. New total: 5\./);

  // Semantic parsing: number inputs accept exponent notation.
  await savePoints(cdp, "1e3");
  after = await readScoreState(cdp);
  assert.deepEqual(after.totals, ["1005", "7"], "rows render in descending total order, so Sam 1005 comes first");
  assert.match(after.feedback, /New total: 1005\./);

  // Scenario 3-4: invalid entries are rejected without altering totals.
  const invalidCases = [
    { value: "2.5", pattern: /Decimals are not allowed/i },
    { value: "abc", pattern: /Enter an amount first/i },
    { value: "", pattern: /Enter an amount first/i },
    { value: "1000001", pattern: /-1000000 and 1000000/ },
    { value: "-1000001", pattern: /-1000000 and 1000000/ },
    { value: "0", pattern: /Zero adds no points/i }
  ];

  for (const testCase of invalidCases) {
    await savePoints(cdp, testCase.value);
    after = await readScoreState(cdp);
    assert.equal(after.errorPresent, true, `expected an error for input ${JSON.stringify(testCase.value)}`);
    assert.match(after.feedback, testCase.pattern);
    assert.equal(after.successPresent, false);
    assert.deepEqual(after.totals, ["1005", "7"], `totals must not change for input ${JSON.stringify(testCase.value)}`);
    assert.equal(after.focusedId, "score-amount", "focus should stay in the input after a rejected entry");
    assert.equal(after.localStorageLength, 1, "rejected entries must not add storage writes");
    assert.equal(after.horizontalOverflow, false);
  }

  const savedAfterRejections = await readSavedGamesState(cdp, STORAGE_KEY);
  assert.equal(savedAfterRejections.gameCount, 1, "failed validations must not save or grow the saved list");

  // Scenario 5: negative totals are valid.
  await savePoints(cdp, "-1010");
  after = await readScoreState(cdp);
  assert.deepEqual(after.totals, ["7", "-5"]);
  assert.equal(after.errorPresent, false);
  assert.match(after.feedback, /Added -1010 points to Sam\. New total: -5\./);
  assert.equal(after.horizontalOverflow, false);

  const focusStyle = await evaluate(cdp, () => {
    const input = document.querySelector("#score-amount");
    input.focus();
    const style = getComputedStyle(input);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  });
  assert.notEqual(focusStyle.outlineStyle, "none");
  assert.notEqual(focusStyle.outlineWidth, "0px");

  const finalState = await readScoreState(cdp);
  assert.equal(finalState.localStorageLength, 1, "storage remains a single key after all saves");
  assert.equal(finalState.horizontalOverflow, false);
  return screenshot(cdp, path.join(evidenceDir, "desktop-score-entry.png"));
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

async function runMobileScenario(cdp, url) {
  await setViewport(cdp, { width: 320, height: 720, mobile: true });
  await navigate(cdp, url);
  await waitForSelector(cdp, "[data-action='new-game']");
  await createScoreGame(cdp);

  const layout = await evaluate(cdp, () => {
    const roster = document.querySelector(".roster-panel")?.getBoundingClientRect();
    const panel = document.querySelector(".score-panel")?.getBoundingClientRect();
    const rowButton = document.querySelector(".add-points-action");
    const saveButton = document.querySelector("[data-score-form] button[type='submit']");
    const amountInput = document.querySelector("#score-amount");

    return {
      stacked: Boolean(roster && panel && panel.top >= roster.bottom),
      rowButtonHeight: rowButton?.getBoundingClientRect().height ?? 0,
      saveButtonHeight: saveButton?.getBoundingClientRect().height ?? 0,
      inputHeight: amountInput?.getBoundingClientRect().height ?? 0,
      rowButtonLabels: [...document.querySelectorAll(".add-points-action")].map((button) => button.getAttribute("aria-label")),
      amountLabel: document.querySelector("label[for='score-amount']")?.textContent?.trim(),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
  assert.equal(layout.stacked, true, "the score panel should stack below the roster at 320px");
  assert.ok(layout.rowButtonHeight >= 44, "row buttons need roughly 44px touch targets");
  assert.ok(layout.saveButtonHeight >= 44, "the save button needs roughly 44px touch targets");
  assert.ok(layout.inputHeight >= 44, "the amount input needs roughly 44px touch targets");
  assert.deepEqual(layout.rowButtonLabels, ["Add points for Alex", "Add points for Sam"]);
  assert.equal(layout.amountLabel, "Points for Alex");
  assert.equal(layout.horizontalOverflow, false);

  // Scenario 6: keyboard through a row button into the entry panel.
  const focusedLabel = await evaluate(cdp, () => {
    const rowButtons = [...document.querySelectorAll(".add-points-action")];
    rowButtons[1].focus();
    return document.activeElement?.getAttribute("aria-label");
  });
  assert.equal(focusedLabel, "Add points for Sam");
  await pressEnter(cdp);

  const selected = await readScoreState(cdp);
  assert.equal(selected.focusedId, "score-amount", "activating a row button should move focus to the amount input");
  assert.equal(selected.selectedRowName, "Sam");
  assert.deepEqual(selected.pressedStates, ["false", "true"]);

  await savePoints(cdp, "-3");
  const after = await readScoreState(cdp);
  assert.deepEqual(after.totals, ["0", "-3"]);
  assert.equal(after.errorPresent, false);
  assert.match(after.feedback, /Added -3 points to Sam\. New total: -3\./);
  assert.equal(after.focusedId, "score-amount");
  assert.equal(after.localStorageLength, 1, "the mobile save keeps storage at one key");
  assert.equal(after.horizontalOverflow, false);
  return screenshot(cdp, path.join(evidenceDir, "mobile-score-entry.png"));
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
    const desktopScreenshot = await runDesktopScenario(cdp, baseUrl);
    const mobileScreenshot = await runMobileScenario(cdp, baseUrl);

    assert.deepEqual(consoleProblems, [], "browser console should not report errors");

    console.log("Browser score test passed: +10/-3 -> 7 with others at 0, rejected decimal/non-number/empty/out-of-range/zero entries without saving, negative totals, semantic 1e3 parsing, 320px stacked panel with keyboard entry, single-key persistence (1 key after the game start, unchanged by rejected entries), no overflow, and no console errors.");
    console.log(`Browser evidence screenshots: ${desktopScreenshot}, ${mobileScreenshot}`);
  } finally {
    if (chrome) {
      chrome.kill("SIGTERM");
    }
    await closeServer(server);
  }
}

await main();
