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
const evidenceDir = await createEvidenceDir("devexpert-resume-saved-game");
const server = createStaticServer();
const baseUrl = await listen(server);
let chrome;

async function createGame(cdp, title, names) {
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

async function goHome(cdp) {
  await click(cdp, "[data-action='back-home']");
  await waitForSelector(cdp, "[data-action='new-game']");
}

async function resumeGame(cdp, gameId) {
  await click(cdp, `[data-action='resume-game'][data-game-id='${gameId}']`);
  await waitForSelector(cdp, "#score-amount");
}

async function readHomeState(cdp) {
  return evaluate(cdp, () => ({
    cards: [...document.querySelectorAll(".saved-game")].map((card) => ({
      gameId: card.dataset.savedGameId ?? "",
      title: card.querySelector(".saved-game-title")?.textContent?.trim() ?? "",
      meta: card.querySelector(".saved-game-meta")?.textContent?.trim() ?? "",
      updated: card.querySelector(".saved-game-updated")?.textContent?.trim() ?? "",
      names: card.querySelector(".saved-game-names")?.textContent?.trim() ?? "",
      markerClasses: [...card.querySelectorAll(".saved-game-markers .marker")].map((node) => node.className),
      resumeLabel: card.querySelector("[data-action='resume-game']")?.getAttribute("aria-label") ?? ""
    })),
    listLabel: document.querySelector(".saved-game-list")?.getAttribute("aria-label") ?? null,
    retentionText: document.querySelector(".retention-note")?.textContent?.trim() ?? null,
    retentionVisible: (() => {
      const node = document.querySelector(".retention-note");
      return Boolean(node && node.clientHeight > 0 && node.offsetParent !== null);
    })(),
    emptyStatePresent: Boolean(document.querySelector(".empty-state")),
    emptyTitle: document.querySelector(".empty-state .empty-title")?.textContent?.trim() ?? null,
    emptyBody: document.querySelector(".empty-state .empty-title + p")?.textContent?.trim() ?? null,
    storageNoticePresent: Boolean(document.querySelector("[data-storage-notice]")),
    storageNoticeRole: document.querySelector("[data-storage-notice]")?.getAttribute("role") ?? null,
    storageNoticeText: document.querySelector("[data-storage-notice]")?.textContent?.trim() ?? "",
    droppedNotePresent: Boolean(document.querySelector(".storage-notice-info")),
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
  }));
}

async function readActiveState(cdp) {
  return evaluate(cdp, () => ({
    heading: document.querySelector("[data-active-heading]")?.textContent?.trim() ?? "",
    names: [...document.querySelectorAll(".active-player-name")].map((node) => node.textContent.trim()),
    totals: [...document.querySelectorAll(".active-player-total")].map((node) => node.textContent.trim()),
    ranks: [...document.querySelectorAll(".active-player-rank")].map((node) => node.textContent.trim()),
    totalLabels: [...document.querySelectorAll(".active-player-total")].map((node) => node.getAttribute("aria-label")),
    tokenClasses: [...document.querySelectorAll(".active-player .player-token")].map((node) => node.className),
    tokenTexts: [...document.querySelectorAll(".active-player .player-token")].map((node) => node.textContent.trim()),
    pressedStates: [...document.querySelectorAll(".add-points-action")].map((button) => button.getAttribute("aria-pressed")),
    selectedRowName: document.querySelector(".active-player.is-selected .active-player-name")?.textContent?.trim() ?? null,
    feedback: document.querySelector("#score-feedback")?.textContent?.trim() ?? "",
    storageNoticePresent: Boolean(document.querySelector("[data-storage-notice]")),
    storageNoticeRole: document.querySelector("[data-storage-notice]")?.getAttribute("role") ?? null,
    storageNoticeText: document.querySelector("[data-storage-notice]")?.textContent?.trim() ?? "",
    focusOnHeading: Boolean(document.activeElement?.hasAttribute?.("data-active-heading")),
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
  }));
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

async function runHomeScenarios(cdp, url) {
  // Scenario 5: a fresh profile shows the empty state plus the retention line, and writes nothing.
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, url);
  await waitForSelector(cdp, "[data-action='new-game']");

  const emptyHome = await readHomeState(cdp);
  assert.equal(emptyHome.emptyStatePresent, true, "a fresh profile must show the unfinished empty state");
  assert.equal(emptyHome.emptyTitle, "No saved games yet.");
  assert.equal(emptyHome.cards.length, 0);
  assert.match(emptyHome.retentionText, /Saved only in this browser/);
  assert.match(emptyHome.retentionText, /clearing site data removes these games/);
  assert.equal(emptyHome.retentionVisible, true, "the retention line must be visible on an empty home");

  const freshStorage = await readSavedGamesState(cdp, STORAGE_KEY);
  assert.equal(freshStorage.keyCount, 0, "loading home must not write to storage");

  // Scenario 1 setup: create and score two independent games.
  await createGame(cdp, "Friday game night", ["Alex", "Sam"]);
  await savePoints(cdp, "10");

  const afterFirstSave = await readSavedGamesState(cdp, STORAGE_KEY);
  assert.equal(afterFirstSave.keyCount, 1);
  assert.equal(afterFirstSave.keyName, STORAGE_KEY);
  assert.equal(afterFirstSave.payloadVersion, 1);
  assert.equal(afterFirstSave.gameCount, 1);

  await goHome(cdp);
  await createGame(cdp, "Penalty rematch", ["Jamie", "Taylor", "Sam"]);
  await savePoints(cdp, "-3");

  const afterSecondGame = await readSavedGamesState(cdp, STORAGE_KEY);
  assert.equal(afterSecondGame.gameCount, 2, "the second game must be saved alongside the first");
  assert.deepEqual(
    [...new Set(afterSecondGame.savedIds)].length,
    2,
    "both saved games keep distinct ids"
  );

  await goHome(cdp);
  const homeWithBoth = await readHomeState(cdp);
  assert.equal(homeWithBoth.cards.length, 2);
  assert.deepEqual(
    homeWithBoth.cards.map((card) => card.title),
    ["Penalty rematch", "Friday game night"],
    "the most recently updated game must be listed first"
  );
  const desktopHomeScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-home-saved-games.png"));

  // Scenario 1: resume each game and verify independent, correct totals.
  const fridayCard = homeWithBoth.cards.find((card) => card.title === "Friday game night");
  await resumeGame(cdp, fridayCard.gameId);
  const friday = await readActiveState(cdp);
  assert.equal(friday.heading, "Friday game night");
  assert.equal(friday.focusOnHeading, true, "resume must move focus to the game heading");
  assert.deepEqual(friday.names, ["Alex", "Sam"]);
  assert.deepEqual(friday.totals, ["10", "0"]);
  assert.deepEqual(friday.ranks, ["1", "2"]);
  assert.deepEqual(friday.tokenTexts, ["1", "2"]);
  assert.match(friday.tokenClasses[0], /marker-blue/);
  assert.match(friday.tokenClasses[1], /marker-red/);
  assert.match(friday.totalLabels[0], /Alex: rank 1, total 10/);
  const resumedDesktopScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-resumed-friday.png"));

  await goHome(cdp);
  const homeAgain = await readHomeState(cdp);
  const penaltyCard = homeAgain.cards.find((card) => card.title === "Penalty rematch");
  await resumeGame(cdp, penaltyCard.gameId);
  const penalty = await readActiveState(cdp);
  assert.equal(penalty.heading, "Penalty rematch");
  assert.deepEqual(penalty.names, ["Taylor", "Sam", "Jamie"], "rows render in descending total order, so Jamie -3 sorts last");
  assert.deepEqual(penalty.totals, ["0", "0", "-3"], "the two games must resume with independent totals");
  assert.deepEqual(penalty.ranks, ["1", "1", "3"], "the two zero totals share rank 1");
  assert.deepEqual(penalty.pressedStates, ["false", "false", "true"], "resume selects the first roster player, Jamie");

  // Scenario 2: card content, accessible names, and recency ordering.
  await goHome(cdp);
  const listState = await readHomeState(cdp);
  assert.equal(listState.listLabel, "Saved games");
  assert.deepEqual(
    listState.cards.map((card) => card.title),
    ["Penalty rematch", "Friday game night"],
    "Penalty rematch was saved most recently"
  );

  const [penaltyListed, fridayListed] = listState.cards;
  assert.equal(penaltyListed.meta, "3 players");
  assert.match(penaltyListed.updated, /^Updated /);
  assert.equal(penaltyListed.names, "Jamie, Taylor, Sam");
  assert.equal(penaltyListed.markerClasses.length, 3);
  assert.match(penaltyListed.markerClasses[0], /marker-blue/);
  assert.match(penaltyListed.markerClasses[1], /marker-red/);
  assert.match(penaltyListed.markerClasses[2], /marker-yellow/);
  assert.equal(penaltyListed.resumeLabel, "Resume Penalty rematch");

  assert.equal(fridayListed.meta, "2 players");
  assert.match(fridayListed.updated, /^Updated /);
  assert.equal(fridayListed.names, "Alex, Sam");
  assert.equal(fridayListed.markerClasses.length, 2);
  assert.match(fridayListed.markerClasses[0], /marker-blue/);
  assert.match(fridayListed.markerClasses[1], /marker-red/);
  assert.equal(fridayListed.resumeLabel, "Resume Friday game night");

  // Saving another point in Friday must move it to the top.
  await resumeGame(cdp, fridayListed.gameId);
  await click(cdp, "[data-player-id='active-game-player-2'] .add-points-action");
  await savePoints(cdp, "5");
  await goHome(cdp);
  const reordered = await readHomeState(cdp);
  assert.deepEqual(
    reordered.cards.map((card) => card.title),
    ["Friday game night", "Penalty rematch"],
    "the freshly scored game must move to the top"
  );

  // Scenario 3: undo survives a reload and never resurrects after another reload.
  await navigate(cdp, url);
  await waitForSelector(cdp, "[data-action='new-game']");
  const reloadedHome = await readHomeState(cdp);
  const fridayId = reloadedHome.cards.find((card) => card.title === "Friday game night").gameId;
  await resumeGame(cdp, fridayId);
  const beforeUndo = await readActiveState(cdp);
  assert.deepEqual(beforeUndo.totals, ["10", "5"]);
  assert.deepEqual(beforeUndo.ranks, ["1", "2"]);

  await click(cdp, "[data-action='undo-last-score']");
  const afterUndo = await readActiveState(cdp);
  assert.deepEqual(afterUndo.totals, ["10", "0"], "undo after resume must restore the latest recipient");
  assert.match(afterUndo.feedback, /Undid 5 points for Sam\. New total: 0\. Rank: 2\./);

  await navigate(cdp, url);
  await waitForSelector(cdp, "[data-action='new-game']");
  const homeAfterUndo = await readHomeState(cdp);
  const fridayIdAfterUndo = homeAfterUndo.cards.find((card) => card.title === "Friday game night").gameId;
  await resumeGame(cdp, fridayIdAfterUndo);
  const afterSecondReload = await readActiveState(cdp);
  assert.deepEqual(
    afterSecondReload.totals,
    ["10", "0"],
    "undone changes must never reappear after a reload"
  );

  // Scenario 6: 320px layout, retention messaging, and keyboard resume.
  await setViewport(cdp, { width: 320, height: 720, mobile: true });
  await navigate(cdp, url);
  await waitForSelector(cdp, "[data-action='new-game']");

  const mobileHome = await readHomeState(cdp);
  assert.equal(mobileHome.cards.length, 2);
  assert.equal(mobileHome.horizontalOverflow, false, "two saved-game cards must not overflow at 320px");
  assert.equal(mobileHome.retentionVisible, true, "the retention line must stay visible at 320px");
  assert.equal(mobileHome.listLabel, "Saved games");
  for (const card of mobileHome.cards) {
    assert.match(card.resumeLabel, new RegExp(`^Resume ${card.title}$`));
  }

  const mobileLayout = await evaluate(cdp, () => {
    const cards = [...document.querySelectorAll(".saved-game")];
    const resumeButtons = [...document.querySelectorAll("[data-action='resume-game']")];
    const retention = document.querySelector(".retention-note");
    const firstButton = resumeButtons[0];
    firstButton?.focus();
    const style = firstButton ? getComputedStyle(firstButton) : null;

    return {
      stacked: cards.every((card, index) =>
        index === 0 || card.getBoundingClientRect().top >= cards[index - 1].getBoundingClientRect().bottom - 1),
      resumeHeights: resumeButtons.map((button) => button.getBoundingClientRect().height),
      focusOutline: style ? { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth } : null,
      retentionFontSize: retention ? getComputedStyle(retention).fontSize : null,
      retentionHeight: retention?.getBoundingClientRect().height ?? 0
    };
  });
  assert.equal(mobileLayout.stacked, true, "saved-game cards must stack single-column at 320px");
  assert.ok(
    mobileLayout.resumeHeights.every((height) => height >= 44),
    "every resume control needs a roughly 44px target"
  );
  assert.notEqual(mobileLayout.focusOutline.outlineStyle, "none", "resume controls need a visible focus style");
  assert.notEqual(mobileLayout.focusOutline.outlineWidth, "0px");
  assert.ok(Number.parseFloat(mobileLayout.retentionFontSize) > 0, "the retention line must stay readable");
  assert.ok(mobileLayout.retentionHeight > 0);

  const mobileHomeScreenshot = await screenshot(cdp, path.join(evidenceDir, "mobile-home-saved-games-320px.png"));

  await pressEnter(cdp);
  await waitForSelector(cdp, "#score-amount");
  const keyboardResumed = await readActiveState(cdp);
  assert.equal(
    keyboardResumed.heading,
    mobileHome.cards[0].title,
    "keyboard Enter on a resume control must reopen that game"
  );

  return { desktopHomeScreenshot, resumedDesktopScreenshot, mobileHomeScreenshot };
}

async function runStorageFailureScenario(url) {
  const userDataDir = path.join(evidenceDir, "chrome-profile-blocked");
  const launched = await launchChrome({ chromePath, userDataDir, url: "about:blank" });
  const blockedChrome = launched.chrome;

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
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `
        Object.defineProperty(Storage.prototype, "setItem", {
          value: function setItem() {
            throw new Error("Storage is blocked in this test session.");
          },
          writable: true,
          configurable: true
        });
      `
    });

    // Scenario 4: blocked writes are caught and non-fatal.
    await setViewport(cdp, { width: 1280, height: 800, mobile: false });
    await navigate(cdp, url);
    await waitForSelector(cdp, "[data-action='new-game']");

    const blockedHome = await readHomeState(cdp);
    assert.equal(blockedHome.emptyStatePresent, true, "home must render the empty state when storage starts unavailable");
    assert.equal(blockedHome.cards.length, 0);
    assert.equal(blockedHome.storageNoticePresent, false, "a successful startup read must not show a storage notice before any write fails");
    assert.equal(blockedHome.droppedNotePresent, false);

    const blockedStorage = await readSavedGamesState(cdp, STORAGE_KEY);
    assert.equal(blockedStorage.keyCount, 0, "blocked writes must not create the storage key");

    await createGame(cdp, "Blocked storage game", ["Alex", "Sam"]);
    await savePoints(cdp, "10");

    const blockedActive = await readActiveState(cdp);
    assert.deepEqual(blockedActive.totals, ["10", "0"], "in-memory totals must keep working when saves fail");
    assert.deepEqual(blockedActive.ranks, ["1", "2"]);
    assert.equal(
      blockedActive.feedback,
      "Added 10 points to Alex. New total: 10. Rank: 1.",
      "the success feedback must be unchanged when only persistence fails"
    );
    assert.equal(blockedActive.storageNoticePresent, true, "the active view must warn when the latest change did not save");
    assert.equal(blockedActive.storageNoticeRole, "status");
    assert.equal(
      blockedActive.storageNoticeText,
      "Your latest change couldn't be saved. The game still works, and nothing already saved was lost — your next change will try again."
    );
    assert.equal(blockedActive.horizontalOverflow, false);

    const afterBlockedSave = await readSavedGamesState(cdp, STORAGE_KEY);
    assert.equal(afterBlockedSave.keyCount, 0, "a failed save must not leave a partial payload");

    await goHome(cdp);
    const blockedHomeAgain = await readHomeState(cdp);
    assert.equal(blockedHomeAgain.emptyStatePresent, true, "home keeps working after failed saves");
    assert.equal(blockedHomeAgain.emptyTitle, "No saved games yet.", "the write failure must not swap the empty-state copy");
    assert.equal(blockedHomeAgain.cards.length, 0, "a failed save must never render a phantom saved-game card");
    assert.equal(blockedHomeAgain.storageNoticePresent, true, "home must warn that the latest change did not save");
    assert.equal(blockedHomeAgain.storageNoticeRole, "status");
    assert.equal(
      blockedHomeAgain.storageNoticeText,
      "Your latest change couldn't be saved. The game still works, and nothing already saved was lost — your next change will try again."
    );
    assert.equal(blockedHomeAgain.horizontalOverflow, false);

    assert.ok(
      warnings.some((warning) => warning.includes("Game save failed")),
      "a blocked save must log the code-only diagnostic"
    );
    for (const warning of warnings) {
      assert.doesNotMatch(warning, /Alex|Sam|Blocked storage game|total 10|points/, "diagnostics must not include names, titles, or scores");
    }
    assert.deepEqual(consoleProblems, [], "blocked storage must not produce uncaught console errors");
    return true;
  } finally {
    blockedChrome.kill("SIGTERM");
  }
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
    const screenshots = await runHomeScenarios(cdp, baseUrl);

    assert.deepEqual(consoleProblems, [], "browser console should not report errors");

    const blockedSessionPassed = await runStorageFailureScenario(baseUrl);
    assert.equal(blockedSessionPassed, true);

    console.log("Browser resume test passed: two scored games reload and resume with independent totals, cards show title/players/names/colors/Updated with recency ordering and title-bearing Resume names, undo works after resume and never resurrects after a reload, the empty state and retention line render at desktop and 320px, keyboard Enter resumes, and blocked storage keeps the app working with the role=status write notice on the active view and home, zero phantom saved-game cards after failed saves, unchanged success feedback, code-only warnings, and no console errors.");
    console.log(`Browser evidence screenshots: ${screenshots.desktopHomeScreenshot}, ${screenshots.resumedDesktopScreenshot}, ${screenshots.mobileHomeScreenshot}`);
  } finally {
    if (chrome) {
      chrome.kill("SIGTERM");
    }
    await closeServer(server);
  }
}

await main();
