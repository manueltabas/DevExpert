import assert from "node:assert/strict";
import path from "node:path";
import { createStaticServer, listen } from "./static-server.mjs";
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
  screenshot,
  setViewport,
  waitForSelector
} from "./browser-test-utils.mjs";

const chromePath = process.env.CHROME_BIN ?? DEFAULT_CHROME_PATH;
const evidenceDir = await createEvidenceDir("devexpert-rank-leaderboard");
const server = createStaticServer();
const baseUrl = await listen(server);
let chrome;

async function createRankedGame(cdp, title, names) {
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

async function readRankState(cdp) {
  return evaluate(cdp, () => ({
    playerIds: [...document.querySelectorAll(".active-player")].map((row) => row.dataset.playerId),
    names: [...document.querySelectorAll(".active-player-name")].map((node) => node.textContent.trim()),
    totals: [...document.querySelectorAll(".active-player-total")].map((node) => node.textContent.trim()),
    ranks: [...document.querySelectorAll(".active-player-rank")].map((node) => node.textContent.trim()),
    totalLabels: [...document.querySelectorAll(".active-player-total")].map((node) => node.getAttribute("aria-label")),
    pressedStates: [...document.querySelectorAll(".add-points-action")].map((button) => button.getAttribute("aria-pressed")),
    selectedRowName: document.querySelector(".active-player.is-selected .active-player-name")?.textContent?.trim() ?? null,
    eyebrow: document.querySelector(".roster-panel .eyebrow")?.textContent?.trim() ?? "",
    panelHeading: document.querySelector(".roster-panel h3")?.textContent?.trim() ?? "",
    feedback: document.querySelector("#score-feedback")?.textContent?.trim() ?? "",
    errorPresent: Boolean(document.querySelector("#score-feedback .validation-message")),
    inputValue: document.querySelector("#score-amount")?.value ?? null,
    focusedId: document.activeElement?.id ?? "",
    localStorageLength: localStorage.length,
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
  }));
}

async function runTieScenario(cdp, url) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, url);
  await waitForSelector(cdp, "[data-action='new-game']");
  await createRankedGame(cdp, "Rank test", ["Alex", "Sam", "Jamie"]);

  // Fresh game: every total is 0, so every row shares rank 1 in creation order.
  const initial = await readRankState(cdp);
  assert.deepEqual(initial.names, ["Alex", "Sam", "Jamie"]);
  assert.deepEqual(initial.totals, ["0", "0", "0"]);
  assert.deepEqual(initial.ranks, ["1", "1", "1"]);
  assert.deepEqual(initial.pressedStates, ["true", "false", "false"]);
  assert.equal(initial.eyebrow, "Leaderboard");
  assert.equal(initial.panelHeading, "Highest total leads; ties share rank.");
  assert.equal(initial.horizontalOverflow, false);

  // Scenario 1: 12, 12, 8 -> ranks 1, 1, 3 with tied rows in creation order.
  await savePoints(cdp, "12");
  let state = await readRankState(cdp);
  assert.deepEqual(state.totals, ["12", "0", "0"]);
  assert.deepEqual(state.ranks, ["1", "2", "2"]);
  assert.match(state.feedback, /Added 12 points to Alex\. New total: 12\. Rank: 1\./);
  assert.equal(state.focusedId, "score-amount");
  assert.equal(state.inputValue, "");

  await clickPlayerRow(cdp, "active-game-player-2");
  state = await readRankState(cdp);
  assert.equal(state.selectedRowName, "Sam");
  assert.deepEqual(state.pressedStates, ["false", "true", "false"]);

  await savePoints(cdp, "12");
  state = await readRankState(cdp);
  assert.deepEqual(state.totals, ["12", "12", "0"]);
  assert.deepEqual(state.ranks, ["1", "1", "3"]);
  assert.match(state.feedback, /Added 12 points to Sam\. New total: 12\. Rank: 1\./);

  await clickPlayerRow(cdp, "active-game-player-3");
  await savePoints(cdp, "8");
  state = await readRankState(cdp);
  assert.deepEqual(state.names, ["Alex", "Sam", "Jamie"], "tied rows keep creation order");
  assert.deepEqual(state.totals, ["12", "12", "8"]);
  assert.deepEqual(state.ranks, ["1", "1", "3"]);
  assert.ok(!state.ranks.includes("2"), "no row may claim the skipped rank 2");
  assert.deepEqual(state.totalLabels, [
    "Alex: rank 1, total 12",
    "Sam: rank 1, total 12",
    "Jamie: rank 3, total 8"
  ]);

  // Scenario 4: another player's save re-renders, but the tied pair keeps creation order.
  await savePoints(cdp, "5");
  state = await readRankState(cdp);
  assert.deepEqual(state.names, ["Jamie", "Alex", "Sam"]);
  assert.deepEqual(state.playerIds, ["active-game-player-3", "active-game-player-1", "active-game-player-2"]);
  assert.deepEqual(state.totals, ["13", "12", "12"]);
  assert.deepEqual(state.ranks, ["1", "2", "2"]);
  assert.match(state.feedback, /Added 5 points to Jamie\. New total: 13\. Rank: 1\./);

  // Error entries repaint feedback without a re-render, so DOM order and markup survive.
  await evaluate(cdp, () => {
    document.querySelector(".active-player").dataset.sentinel = "kept";
  });
  await savePoints(cdp, "abc");
  state = await readRankState(cdp);
  assert.equal(state.errorPresent, true);
  assert.deepEqual(state.names, ["Jamie", "Alex", "Sam"]);
  assert.deepEqual(state.ranks, ["1", "2", "2"]);
  const sentinel = await evaluate(cdp, () => document.querySelector(".active-player")?.dataset.sentinel ?? null);
  assert.equal(sentinel, "kept", "an error entry must not re-render the roster");
  assert.equal(state.focusedId, "score-amount");
  assert.equal(state.localStorageLength, 0);
  assert.equal(state.horizontalOverflow, false);

  return screenshot(cdp, path.join(evidenceDir, "desktop-rank-ties.png"));
}

async function runReorderScenario(cdp, url) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, url);
  await waitForSelector(cdp, "[data-action='new-game']");
  await createRankedGame(cdp, "Focus test", ["Alex", "Sam"]);

  await savePoints(cdp, "7");
  let state = await readRankState(cdp);
  assert.deepEqual(state.totals, ["7", "0"]);
  assert.deepEqual(state.ranks, ["1", "2"]);

  await clickPlayerRow(cdp, "active-game-player-2");
  state = await readRankState(cdp);
  assert.equal(state.selectedRowName, "Sam");
  assert.deepEqual(state.pressedStates, ["false", "true"]);

  await savePoints(cdp, "5");
  state = await readRankState(cdp);
  assert.deepEqual(state.totals, ["7", "5"]);
  assert.deepEqual(state.ranks, ["1", "2"]);
  assert.equal(state.selectedRowName, "Sam", "selection follows the player while rows keep their order");
  assert.deepEqual(state.pressedStates, ["false", "true"]);
  assert.match(state.feedback, /Added 5 points to Sam\. New total: 5\. Rank: 2\./);

  // Scenario 3: an overtaking save reorders rows immediately, keeps selection and focus.
  await savePoints(cdp, "5");
  state = await readRankState(cdp);
  assert.deepEqual(state.names, ["Sam", "Alex"], "the overtaking player must move to the first row");
  assert.deepEqual(state.totals, ["10", "7"]);
  assert.deepEqual(state.ranks, ["1", "2"]);
  assert.deepEqual(state.pressedStates, ["true", "false"], "aria-pressed must follow Sam across the reorder");
  assert.equal(state.selectedRowName, "Sam");
  assert.equal(state.totalLabels[0], "Sam: rank 1, total 10");
  assert.match(state.feedback, /Added 5 points to Sam\. New total: 10\. Rank: 1\./);
  assert.equal(state.focusedId, "score-amount", "focus must return to the amount input after the reorder");
  assert.equal(state.inputValue, "", "the input must be cleared after a successful save");
  assert.equal(state.localStorageLength, 0);
  assert.equal(state.horizontalOverflow, false);

  return screenshot(cdp, path.join(evidenceDir, "desktop-rank-reorder.png"));
}

async function runNegativeScenario(cdp, url) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, url);
  await waitForSelector(cdp, "[data-action='new-game']");
  await createRankedGame(cdp, "Negative test", ["Alex", "Sam", "Jamie"]);

  // Scenario 2: 5, -3, -3 -> ranks 1, 2, 2 with negative totals rendered.
  await savePoints(cdp, "5");
  let state = await readRankState(cdp);
  assert.deepEqual(state.totals, ["5", "0", "0"]);
  assert.deepEqual(state.ranks, ["1", "2", "2"]);

  await clickPlayerRow(cdp, "active-game-player-2");
  await savePoints(cdp, "-3");
  state = await readRankState(cdp);
  assert.deepEqual(state.names, ["Alex", "Jamie", "Sam"], "negative totals sort below zero");
  assert.deepEqual(state.totals, ["5", "0", "-3"]);
  assert.deepEqual(state.ranks, ["1", "2", "3"]);
  assert.match(state.feedback, /Added -3 points to Sam\. New total: -3\. Rank: 3\./);

  await clickPlayerRow(cdp, "active-game-player-3");
  await savePoints(cdp, "-3");
  state = await readRankState(cdp);
  assert.deepEqual(state.names, ["Alex", "Sam", "Jamie"]);
  assert.deepEqual(state.totals, ["5", "-3", "-3"]);
  assert.deepEqual(state.ranks, ["1", "2", "2"]);
  assert.equal(state.errorPresent, false);
  assert.equal(state.focusedId, "score-amount");
  assert.equal(state.localStorageLength, 0);
  assert.equal(state.horizontalOverflow, false);
  return true;
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

async function runTwentyPlayerScenario(cdp, url) {
  await setViewport(cdp, { width: 320, height: 720, mobile: true });
  await navigate(cdp, url);
  await waitForSelector(cdp, "[data-action='new-game']");
  await click(cdp, "[data-action='new-game']");
  await fill(cdp, "#game-title", "Crowded table");
  for (let index = 0; index < 18; index += 1) {
    await click(cdp, "[data-action='add-player']");
  }
  for (let index = 0; index < 20; index += 1) {
    await fill(cdp, `#player-name-${index + 1}`, `Player ${index + 1}`);
  }
  await click(cdp, "button[type='submit']");
  await waitForSelector(cdp, "#score-amount");

  // Score five players so ranks mix ties, positives, zero, and a negative.
  const scores = [
    { playerId: "active-game-player-1", amount: "21" },
    { playerId: "active-game-player-2", amount: "21" },
    { playerId: "active-game-player-3", amount: "13" },
    { playerId: "active-game-player-4", amount: "7" },
    { playerId: "active-game-player-5", amount: "-5" }
  ];
  for (const entry of scores) {
    await clickPlayerRow(cdp, entry.playerId);
    await savePoints(cdp, entry.amount);
  }

  const expectedNames = ["Player 1", "Player 2", "Player 3", "Player 4"];
  for (let player = 6; player <= 20; player += 1) {
    expectedNames.push(`Player ${player}`);
  }
  expectedNames.push("Player 5");
  const expectedTotals = ["21", "21", "13", "7", ...Array(15).fill("0"), "-5"];
  const expectedRanks = ["1", "1", "3", "4", ...Array(15).fill("5"), "20"];

  let state = await readRankState(cdp);
  assert.equal(state.names.length, 20);
  assert.deepEqual(state.names, expectedNames, "20 rows must render in descending total order");
  assert.deepEqual(state.totals, expectedTotals);
  assert.deepEqual(state.ranks, expectedRanks, "ties share rank 1 and the fifteen zero-total players share rank 5");
  assert.equal(state.ranks.length, 20, "every row must show a rank numeral");
  assert.equal(state.localStorageLength, 0);
  assert.equal(state.horizontalOverflow, false, "a scored 20-player leaderboard must not overflow at 320px");

  const layout = await evaluate(cdp, () => {
    const roster = document.querySelector(".roster-panel")?.getBoundingClientRect();
    const panel = document.querySelector(".score-panel")?.getBoundingClientRect();
    const rankNodes = [...document.querySelectorAll(".active-player-rank")];
    const rowButton = document.querySelector(".add-points-action");
    const saveButton = document.querySelector("[data-score-form] button[type='submit']");
    const amountInput = document.querySelector("#score-amount");

    return {
      stacked: Boolean(roster && panel && panel.top >= roster.bottom),
      rankNodesVisible: rankNodes.every((node) => node.clientHeight > 0 && node.offsetParent !== null),
      rankFontSize: getComputedStyle(rankNodes[0]).fontSize,
      rowButtonHeight: rowButton?.getBoundingClientRect().height ?? 0,
      saveButtonHeight: saveButton?.getBoundingClientRect().height ?? 0,
      inputHeight: amountInput?.getBoundingClientRect().height ?? 0
    };
  });
  assert.equal(layout.stacked, true, "the score panel should stack below the leaderboard at 320px");
  assert.equal(layout.rankNodesVisible, true, "all 20 rank numerals must be visible");
  assert.notEqual(Number.parseFloat(layout.rankFontSize), 0, "rank numerals must keep a readable size");
  assert.ok(layout.rowButtonHeight >= 44, "row buttons need roughly 44px touch targets");
  assert.ok(layout.saveButtonHeight >= 44, "the save button needs roughly 44px touch targets");
  assert.ok(layout.inputHeight >= 44, "the amount input needs roughly 44px touch targets");

  const focusStyle = await evaluate(cdp, () => {
    const input = document.querySelector("#score-amount");
    input.focus();
    const style = getComputedStyle(input);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  });
  assert.notEqual(focusStyle.outlineStyle, "none", "the amount input needs a visible focus style");
  assert.notEqual(focusStyle.outlineWidth, "0px");

  // Keyboard users can reach a row button; Enter selects that player.
  await evaluate(cdp, () => {
    document.querySelector("[data-player-id='active-game-player-20'] .add-points-action")?.focus();
  });
  await pressEnter(cdp);
  state = await readRankState(cdp);
  assert.equal(state.focusedId, "score-amount", "activating a row button must move focus to the amount input");
  assert.equal(state.selectedRowName, "Player 20");

  // A save at 320px re-ranks without losing focus; the save also splits the zero tie.
  await savePoints(cdp, "30");
  state = await readRankState(cdp);
  assert.deepEqual(state.names.slice(0, 3), ["Player 20", "Player 1", "Player 2"]);
  assert.deepEqual(state.totals.slice(0, 3), ["30", "21", "21"]);
  assert.deepEqual(state.ranks.slice(0, 3), ["1", "2", "2"]);
  assert.equal(state.pressedStates[0], "true", "the selected row must stay pressed after the reorder");
  assert.equal(state.focusedId, "score-amount", "focus must stay in the input after a re-ranking save");
  assert.equal(state.inputValue, "");
  assert.equal(state.localStorageLength, 0);
  assert.equal(state.horizontalOverflow, false);
  return screenshot(cdp, path.join(evidenceDir, "mobile-20-player-leaderboard.png"));
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
    const desktopTiesScreenshot = await runTieScenario(cdp, baseUrl);
    const desktopReorderScreenshot = await runReorderScenario(cdp, baseUrl);
    await runNegativeScenario(cdp, baseUrl);
    const mobileScreenshot = await runTwentyPlayerScenario(cdp, baseUrl);

    assert.deepEqual(consoleProblems, [], "browser console should not report errors");

    console.log("Browser rank test passed: 12/12/8 -> ranks 1,1,3 with stable tied order, negative totals 5/-3/-3 -> 1,2,2, all-tied fresh game at rank 1, save-driven reorder with retained focus and selection, error repaint without re-render, 320px 20-player readability with no overflow, and no persistence or console errors.");
    console.log(`Browser evidence screenshots: ${desktopTiesScreenshot}, ${desktopReorderScreenshot}, ${mobileScreenshot}`);
  } finally {
    if (chrome) {
      chrome.kill("SIGTERM");
    }
    await closeServer(server);
  }
}

await main();
