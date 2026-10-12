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
const evidenceDir = await createEvidenceDir("devexpert-create-game-roster");
const server = createStaticServer();
const baseUrl = await listen(server);
let chrome;

async function runDesktopScenario(cdp, url) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, url);
  await waitForSelector(cdp, "[data-action='new-game']");
  await click(cdp, "[data-action='new-game']");
  await fill(cdp, "#game-title", "Friday game");
  await fill(cdp, "#player-name-1", "  Alex  ");
  await fill(cdp, "#player-name-2", "Alex");
  await click(cdp, "input[name='color-2'][value='blue']");
  await click(cdp, "button[type='submit']");

  const result = await evaluate(cdp, () => {
    const players = [...document.querySelectorAll(".active-player")].map((row) => ({
      id: row.dataset.playerId,
      name: row.querySelector(".active-player-name")?.textContent?.trim(),
      total: row.querySelector(".active-player-total")?.textContent?.trim(),
      marker: row.querySelector(".player-token")?.textContent?.trim()
    }));

    return {
      heading: document.querySelector("#active-title")?.textContent?.trim(),
      players,
      uniqueIds: new Set(players.map((player) => player.id)).size,
      localStorageLength: localStorage.length,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });

  assert.equal(result.heading, "Friday game");
  assert.deepEqual(result.players.map((player) => player.name), ["Alex", "Alex"]);
  assert.deepEqual(result.players.map((player) => player.total), ["0", "0"]);
  assert.equal(result.uniqueIds, 2);
  assert.equal(result.localStorageLength, 0);
  assert.equal(result.horizontalOverflow, false);
}

async function runMobileScenario(cdp, url) {
  await setViewport(cdp, { width: 320, height: 720, mobile: true });
  await navigate(cdp, url);
  await waitForSelector(cdp, "[data-action='new-game']");
  await click(cdp, "[data-action='new-game']");
  await click(cdp, "button[type='submit']");

  const invalidResult = await evaluate(cdp, () => ({
    validationText: document.querySelector("#setup-feedback")?.textContent ?? "",
    activeGameCreated: Boolean(document.querySelector(".active-player"))
  }));
  assert.match(invalidResult.validationText, /Player 1 needs a name/);
  assert.equal(invalidResult.activeGameCreated, false);

  for (let index = 0; index < 18; index += 1) {
    await click(cdp, "[data-action='add-player']");
  }

  const names = Array.from({ length: 20 }, (_, index) => `Player ${index + 1}`);
  names[0] = "Sam";
  names[1] = "Sam";
  for (let index = 0; index < names.length; index += 1) {
    await fill(cdp, `#player-name-${index + 1}`, names[index]);
  }

  const setupResult = await evaluate(cdp, () => {
    const addButton = document.querySelector("[data-action='add-player']");
    addButton.click();
    const firstInput = document.querySelector("#player-name-1");
    firstInput.focus();
    const firstInputStyle = getComputedStyle(firstInput);
    const rows = [...document.querySelectorAll(".player-row")];
    const colors = rows.map((row) => row.querySelector("input[data-field='color']:checked")?.value);

    return {
      rowCount: rows.length,
      addDisabled: addButton.disabled,
      limitText: document.querySelector("#setup-feedback")?.textContent ?? "",
      firstTwoNames: [...document.querySelectorAll("[data-field='name']")].slice(0, 2).map((input) => input.value),
      colorCount: new Set(colors).size,
      firstColor: colors[0],
      eighthColor: colors[7],
      labels: [...document.querySelectorAll("label[for^='player-name-']")].length,
      focusedOutline: firstInputStyle.outlineStyle,
      focusedOutlineWidth: firstInputStyle.outlineWidth,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });

  assert.equal(setupResult.rowCount, 20);
  assert.equal(setupResult.addDisabled, true);
  assert.deepEqual(setupResult.firstTwoNames, ["Sam", "Sam"]);
  assert.equal(setupResult.colorCount, 7);
  assert.equal(setupResult.firstColor, setupResult.eighthColor);
  assert.equal(setupResult.labels, 20);
  assert.notEqual(setupResult.focusedOutline, "none");
  assert.notEqual(setupResult.focusedOutlineWidth, "0px");
  assert.equal(setupResult.horizontalOverflow, false);

  const mobileSetupScreenshot = await screenshot(cdp, path.join(evidenceDir, "mobile-20-player-setup.png"));
  await click(cdp, "button[type='submit']");
  const activeResult = await evaluate(cdp, () => ({
    playerCount: document.querySelectorAll(".active-player").length,
    totals: [...document.querySelectorAll(".active-player-total")].map((node) => node.textContent.trim()),
    names: [...document.querySelectorAll(".active-player-name")].map((node) => node.textContent.trim()),
    uniqueIds: new Set([...document.querySelectorAll(".active-player")].map((row) => row.dataset.playerId)).size,
    localStorageLength: localStorage.length,
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
  }));

  assert.equal(activeResult.playerCount, 20);
  assert.equal(activeResult.uniqueIds, 20);
  assert.deepEqual(activeResult.totals, Array(20).fill("0"));
  assert.deepEqual(activeResult.names.slice(0, 2), ["Sam", "Sam"]);
  assert.equal(activeResult.localStorageLength, 0);
  assert.equal(activeResult.horizontalOverflow, false);
  return mobileSetupScreenshot;
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
    await runDesktopScenario(cdp, baseUrl);
    const desktopScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-active-game.png"));

    const mobileSetupScreenshot = await runMobileScenario(cdp, baseUrl);
    const mobileActiveScreenshot = await screenshot(cdp, path.join(evidenceDir, "mobile-20-player-active-game.png"));

    assert.deepEqual(consoleProblems, [], "browser console should not report errors");

    console.log("Browser roster test passed: desktop valid game, mobile 20-player cap, invalid names, duplicate names/colors, zero totals, no persistence, and no horizontal overflow.");
    console.log(`Browser evidence screenshots: ${desktopScreenshot}, ${mobileSetupScreenshot}, ${mobileActiveScreenshot}`);
  } finally {
    if (chrome) {
      chrome.kill("SIGTERM");
    }
    await closeServer(server);
  }
}

await main();
