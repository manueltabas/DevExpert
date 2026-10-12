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
    describedBy: document.querySelector("#score-amount")?.getAttribute("aria-describedby"),
    feedbackLive: document.querySelector("#score-feedback")?.getAttribute("aria-live"),
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
  assert.equal(labels.describedBy, "score-help score-feedback", "the input keeps its helper + live-region description");
  assert.equal(labels.feedbackLive, "polite", "the feedback region stays a polite live region");
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

  // Plain 1000 save — restrict-score-entry-input supersedes the old
  // semantic-1e3 decision (exponent notation is no longer enterable or
  // savable), so this saves 1000 directly; Sam 5 -> 1005 keeps the ranked
  // totals below valid.
  await savePoints(cdp, "1000");
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

  // This slice: letters can never enter the score field through the real
  // input pipeline (the beforeinput guard), while digits, the leading sign,
  // and deletion still work. The discriminating case is "e" after a digit:
  // Chrome's number input alone inserts it (scientific notation), the guard
  // blocks it, so typing "1e3" yields "13" instead of 1000.
  await evaluate(cdp, () => {
    document.querySelector("#score-amount").focus();
  });
  await pressRealKey(cdp, "Backspace"); // clears the "0" kept by the last rejected case
  let typedState = await readScoreState(cdp);
  assert.equal(typedState.inputValue, "", "deletion is never blocked by the entry guard");
  const feedbackBeforeLetters = typedState.feedback;
  await pressRealKey(cdp, "1");
  typedState = await readScoreState(cdp);
  assert.equal(typedState.inputValue, "1", "digits still enter through the real input pipeline");
  await pressRealKey(cdp, "e");
  await pressRealKey(cdp, "E");
  await pressRealKey(cdp, "x");
  typedState = await readScoreState(cdp);
  assert.equal(typedState.inputValue, "1", "letters like e/E/x must never enter the score field");
  assert.equal(typedState.focusedId, "score-amount", "blocked letters are silent and never move focus");
  assert.equal(typedState.feedback, feedbackBeforeLetters, "blocked letters are silent: the feedback region is untouched");
  await pressRealKey(cdp, "3");
  typedState = await readScoreState(cdp);
  assert.equal(typedState.inputValue, "13", "typing 1e3 must yield 13, never 1000");
  await pressRealKey(cdp, "Backspace");
  await pressRealKey(cdp, "Backspace");
  typedState = await readScoreState(cdp);
  assert.equal(typedState.inputValue, "", "deletion keeps working after the blocked letters");

  await pressRealKey(cdp, "-");
  await pressRealKey(cdp, "3");
  typedState = await readScoreState(cdp);
  assert.equal(typedState.inputValue, "-3", "a leading sign and digits still enter through the real pipeline");
  await pressRealKey(cdp, "Backspace");
  await pressRealKey(cdp, "Backspace"); // raw "-" then empty; the field ends empty
  typedState = await readScoreState(cdp);
  assert.equal(typedState.inputValue, "", "the field ends empty without saving the typed draft");

  // Inserted (paste/IME path) "1e3" is blocked wholesale by the guard — no
  // silent "13" and no value change at all.
  await cdp.send("Input.insertText", { text: "1e3" });
  typedState = await readScoreState(cdp);
  assert.equal(typedState.inputValue, "", "inserted scientific notation must be blocked wholesale");

  // A programmatically set "1e3" bypasses beforeinput and is rejected at save
  // by the plain-format gate, leaving totals, focus, and storage untouched.
  const rawBeforeScientific = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
  await savePoints(cdp, "1e3");
  after = await readScoreState(cdp);
  assert.equal(after.errorPresent, true, "programmatic 1e3 must be rejected at save");
  assert.match(after.feedback, /Enter a whole number, like 10 or -3\./);
  assert.equal(after.successPresent, false);
  assert.deepEqual(after.totals, ["1005", "7"], "the rejected scientific notation must not change totals");
  assert.equal(after.focusedId, "score-amount", "focus stays in the input after the rejected save");
  assert.equal(after.localStorageLength, 1, "rejected scientific notation must not add storage writes");
  const savedAfterScientific = await readSavedGamesState(cdp, STORAGE_KEY);
  assert.equal(savedAfterScientific.gameCount, 1);
  assert.equal(savedAfterScientific.raw, rawBeforeScientific, "the stored payload must stay byte-identical across the rejected save");

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

// Real-key definitions for typing through the actual input pipeline (the same
// Input.dispatchKeyEvent path the other suites use for Enter/Tab/Escape), so
// the beforeinput entry guard is exercised — fill() sets element.value
// directly and bypasses beforeinput entirely.
const REAL_KEYS = {
  "1": { code: "Digit1", keyCode: 49, text: "1" },
  "3": { code: "Digit3", keyCode: 51, text: "3" },
  "-": { code: "Minus", keyCode: 189, text: "-" },
  "e": { code: "KeyE", keyCode: 69, text: "e" },
  "E": { code: "KeyE", keyCode: 69, text: "E", modifiers: 8 },
  "x": { code: "KeyX", keyCode: 88, text: "x" },
  "Backspace": { code: "Backspace", keyCode: 8 }
};

async function pressRealKey(cdp, key) {
  const definition = REAL_KEYS[key];

  if (!definition) {
    throw new Error(`No real-key definition for ${JSON.stringify(key)}`);
  }

  const { code, keyCode, text, modifiers = 0 } = definition;
  const base = {
    key,
    code,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
    modifiers
  };

  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    ...base,
    ...(text === undefined ? {} : { text })
  });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
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
      inputType: amountInput?.getAttribute("type"),
      inputStep: amountInput?.getAttribute("step"),
      describedBy: amountInput?.getAttribute("aria-describedby"),
      helper: document.querySelector("#score-help")?.textContent?.trim(),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
  assert.equal(layout.stacked, true, "the score panel should stack below the roster at 320px");
  assert.ok(layout.rowButtonHeight >= 44, "row buttons need roughly 44px touch targets");
  assert.ok(layout.saveButtonHeight >= 44, "the save button needs roughly 44px touch targets");
  assert.ok(layout.inputHeight >= 44, "the amount input needs roughly 44px touch targets");
  assert.deepEqual(layout.rowButtonLabels, ["Add points for Alex", "Add points for Sam"]);
  assert.equal(layout.amountLabel, "Points for Alex");
  assert.equal(layout.inputType, "number", "type=number stays on the input so the signed mobile keypad contract is unchanged");
  assert.equal(layout.inputStep, "1");
  assert.equal(layout.describedBy, "score-help score-feedback", "the input keeps its helper + live-region description at 320px");
  assert.match(layout.helper, /Use negative points for penalties/);
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

  // Letters cannot enter the score field at 320px either (same guard, real
  // input pipeline), while digits and deletion still work.
  await evaluate(cdp, () => {
    document.querySelector("#score-amount").focus();
  });
  await pressRealKey(cdp, "1");
  let mobileTyped = await readScoreState(cdp);
  assert.equal(mobileTyped.inputValue, "1", "digits still enter at 320px through the real input pipeline");
  const mobileFeedbackBeforeLetters = mobileTyped.feedback;
  await pressRealKey(cdp, "e");
  await pressRealKey(cdp, "E");
  mobileTyped = await readScoreState(cdp);
  assert.equal(mobileTyped.inputValue, "1", "letters like e/E must never enter the score field at 320px");
  assert.equal(mobileTyped.focusedId, "score-amount", "blocked letters are silent and never move focus at 320px");
  assert.equal(mobileTyped.feedback, mobileFeedbackBeforeLetters, "blocked letters are silent at 320px: the feedback region is untouched");
  assert.equal(mobileTyped.errorPresent, false, "blocked letters produce no error announcement at 320px");
  await pressRealKey(cdp, "Backspace");
  mobileTyped = await readScoreState(cdp);
  assert.equal(mobileTyped.inputValue, "", "deletion still works at 320px");
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

    console.log("Browser score test passed: +10/-3 -> 7 with others at 0, real-key letters e/E/x blocked at entry while digits/leading sign/deletion still work (typing 1e3 yields 13, never 1000), inserted 1e3 blocked wholesale, programmatic 1e3 rejected at save with the not-a-number message and no totals/storage change, rejected decimal/non-number/empty/out-of-range/zero entries without saving, negative totals, 320px stacked panel with keyboard entry and the same letter block, type=number/label/helper/aria-describedby unchanged, single-key persistence, no overflow, and no console errors.");
    console.log(`Browser evidence screenshots: ${desktopScreenshot}, ${mobileScreenshot}`);
  } finally {
    if (chrome) {
      chrome.kill("SIGTERM");
    }
    await closeServer(server);
  }
}

await main();
