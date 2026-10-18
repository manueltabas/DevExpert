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
const evidenceDir = await createEvidenceDir("devexpert-podium-actions");
const server = createStaticServer();
const baseUrl = await listen(server);

// Superseded by name-game-titles: replays start untitled (stored title ""),
// so every replay surface shows the deterministic auto-label.
const AUTO_LABEL_PATTERN = /^Game — \d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec), \d{2}:\d{2}$/;

const PLAY_AGAIN_LABEL = "Play again (same players, reset scores)";
const CLOSE_LABEL = "Close & view full standings";
const EXIT_LABEL = "Save & exit to Dashboard";

// Decision 1/5 DOM order: primary full width, then the two secondaries.
const EXPECTED_ACTIONS = [
  { action: "podium-play-again", label: PLAY_AGAIN_LABEL, className: "primary-action" },
  { action: "close-podium", label: CLOSE_LABEL, className: "secondary-action" },
  { action: "podium-exit-dashboard", label: EXIT_LABEL, className: "secondary-action" }
];

async function createGame(cdp, title, names) {
  await click(cdp, "[data-action='new-game']");
  await fill(cdp, "#game-title", title);
  for (let index = 2; index < names.length; index += 1) {
    await click(cdp, "[data-action='add-player']");
  }
  for (let index = 0; index < names.length; index += 1) {
    await fill(cdp, `#player-name-${index + 1}`, names[index]);
  }
  await click(cdp, "[data-roster-form] button[type='submit']");
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

async function finishToPodium(cdp) {
  await click(cdp, "[data-action='open-finish']");
  await waitForSelector(cdp, "[data-action='confirm-finish']");
  await click(cdp, "[data-action='confirm-finish']");
  await waitForSelector(cdp, "[data-podium-dialog]");
}

async function waitForAbsent(cdp, selector) {
  const deadline = Date.now() + 5000;

  while (Date.now() < deadline) {
    const present = await evaluate(cdp, (targetSelector) =>
      Boolean(document.querySelector(targetSelector)), selector);
    if (!present) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
  }

  throw new Error(`Timed out waiting for removal: ${selector}`);
}

async function readPodiumActions(cdp) {
  return evaluate(cdp, () => {
    const dialog = document.querySelector("[data-podium-dialog]");
    const body = dialog?.querySelector(".podium-body");
    const buttons = body ? [...body.querySelectorAll("button")] : [];
    const actionsBlock = body?.querySelector(".podium-actions");
    const row = body?.querySelector(".podium-actions-row");
    const primary = body?.querySelector("[data-action='podium-play-again']");
    const close = body?.querySelector("[data-action='close-podium']");
    const exit = body?.querySelector("[data-action='podium-exit-dashboard']");
    const layer = body?.querySelector("[data-podium-confetti]");
    const pieces = body ? [...body.querySelectorAll(".confetti-piece")] : [];
    const firstToken = body?.querySelector(".podium-player .player-token");
    const gameTitleLine = body?.querySelector("p.podium-game-title");
    const titleHeading = document.getElementById("podium-title");
    const firstParagraph = body?.querySelector("p");

    const rect = (node) => {
      if (!node) {
        return null;
      }

      const box = node.getBoundingClientRect();
      return {
        top: box.top,
        bottom: box.bottom,
        left: box.left,
        right: box.right,
        width: box.width,
        height: box.height
      };
    };

    return {
      present: Boolean(dialog),
      open: Boolean(dialog?.open),
      buttonCount: buttons.length,
      actions: buttons.map((button) => ({
        action: button.dataset.action ?? null,
        label: button.textContent.trim(),
        type: button.getAttribute("type"),
        className: button.className,
        ariaLabel: button.getAttribute("aria-label"),
        rect: rect(button)
      })),
      actionsBlockRect: rect(actionsBlock),
      rowRect: rect(row),
      rowColumns: row ? getComputedStyle(row).gridTemplateColumns : null,
      rowDisplay: row ? getComputedStyle(row).display : null,
      dialogScroll: dialog
        ? {
            scrollWidth: dialog.scrollWidth,
            clientWidth: dialog.clientWidth,
            scrollHeight: dialog.scrollHeight,
            clientHeight: dialog.clientHeight
          }
        : null,
      focusAction: document.activeElement?.dataset?.action ?? null,
      focusOnClose: document.activeElement !== null && document.activeElement === close,
      focusInsideDialog: dialog !== null && document.activeElement !== null && dialog.contains(document.activeElement),
      focusOutlineStyle: document.activeElement ? getComputedStyle(document.activeElement).outlineStyle : null,
      focusOutlineWidth: document.activeElement ? getComputedStyle(document.activeElement).outlineWidth : null,
      titleText: titleHeading?.textContent?.trim() ?? null,
      ledeText: document.getElementById("podium-lede")?.textContent?.trim() ?? null,
      gameTitleLinePresent: Boolean(gameTitleLine),
      gameTitleLineIsFirstParagraph: Boolean(
        gameTitleLine && firstParagraph && gameTitleLine === firstParagraph
      ),
      gameTitleLineBeforeTitleHeading: Boolean(
        gameTitleLine && titleHeading &&
        (gameTitleLine.compareDocumentPosition(titleHeading) & Node.DOCUMENT_POSITION_FOLLOWING)
      ),
      gameTitleLineText: gameTitleLine?.textContent?.trim() ?? null,
      firstTokenLabel: firstToken?.getAttribute("aria-label") ?? null,
      confettiAriaHidden: layer?.getAttribute("aria-hidden") ?? null,
      confettiPointerEvents: layer ? getComputedStyle(layer).pointerEvents : null,
      confettiPieceCount: pieces.length,
      standingsNames: [...document.querySelectorAll(".active-player-name")].map((node) => node.textContent.trim()),
      standingsTotals: [...document.querySelectorAll(".active-player-total")].map((node) => node.textContent.trim()),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
}

async function readHomeState(cdp) {
  return evaluate(cdp, () => {
    const readPanel = (labelledBy) => document.querySelector(`article[aria-labelledby='${labelledBy}']`);
    const readCards = (root) => [...(root?.querySelectorAll(".saved-game") ?? [])].map((card) => ({
      gameId: card.dataset.savedGameId ?? "",
      title: card.querySelector(".saved-game-title")?.textContent?.trim() ?? "",
      actionLabel: card.querySelector("button")?.getAttribute("aria-label") ?? ""
    }));
    const unfinished = readPanel("unfinished-title");
    const finished = readPanel("finished-title");

    return {
      unfinishedCards: readCards(unfinished),
      finishedCards: readCards(finished),
      dashboardCurrent: document.querySelector("[data-action='nav-dashboard']")?.getAttribute("aria-current") ?? null,
      newGameCurrent: document.querySelector("[data-action='nav-new-game']")?.getAttribute("aria-current") ?? null,
      activeGameCurrent: document.querySelector("[data-action='nav-active-game']")?.getAttribute("aria-current") ?? null,
      focusOnHomeHeading: Boolean(document.activeElement?.hasAttribute?.("data-home-heading")),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
}

async function readActiveState(cdp) {
  return evaluate(cdp, () => ({
    heading: document.querySelector("[data-active-heading]")?.textContent?.trim() ?? "",
    eyebrow: document.querySelector(".active-header .eyebrow")?.textContent?.trim() ?? "",
    names: [...document.querySelectorAll(".active-player-name")].map((node) => node.textContent.trim()),
    totals: [...document.querySelectorAll(".active-player-total")].map((node) => node.textContent.trim()),
    ranks: [...document.querySelectorAll(".active-player-rank")].map((node) => node.textContent.trim()),
    tokens: [...document.querySelectorAll(".active-player .player-token")].map((node) => ({
      className: node.className,
      text: node.textContent.trim(),
      label: node.getAttribute("aria-label")
    })),
    addPointsCount: document.querySelectorAll(".add-points-action").length,
    selectedRowCount: document.querySelectorAll(".active-player.is-selected").length,
    scoreFormPresent: Boolean(document.querySelector("[data-score-form]")),
    replayFeedback: document.querySelector("#replay-feedback")?.textContent?.trim() ?? null,
    finishedNote: document.querySelector("[data-finished-note]")?.textContent?.trim() ?? null,
    podiumDialogPresent: Boolean(document.querySelector("[data-podium-dialog]")),
    podiumOpen: Boolean(document.querySelector("[data-podium-dialog]")?.open),
    focusOnHeading: Boolean(document.activeElement?.hasAttribute?.("data-active-heading")),
    focusAction: document.activeElement?.dataset?.action ?? null,
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

async function pressSpace(cdp) {
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: " ",
    code: "Space",
    windowsVirtualKeyCode: 32,
    nativeVirtualKeyCode: 32,
    text: " "
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: " ",
    code: "Space",
    windowsVirtualKeyCode: 32,
    nativeVirtualKeyCode: 32
  });
}

async function pressTab(cdp) {
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Tab",
    code: "Tab",
    windowsVirtualKeyCode: 9,
    nativeVirtualKeyCode: 9
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Tab",
    code: "Tab",
    windowsVirtualKeyCode: 9,
    nativeVirtualKeyCode: 9
  });
}

async function pressEscape(cdp) {
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27
  });
}

async function clickBackdrop(cdp, x, y) {
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    clickCount: 1
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    clickCount: 1
  });
}

async function runSession(sessionName, run) {
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

    return await run(cdp, { consoleProblems, warnings });
  } finally {
    launched.chrome.kill("SIGTERM");
  }
}

function assertOriginalEntryByteIdentical(raw, originalId, expectedString, label) {
  const parsed = JSON.parse(raw);
  const stored = parsed.games.find((game) => game.id === originalId);
  assert.ok(stored, `${label}: the finished original must stay stored`);
  assert.equal(
    JSON.stringify(stored),
    expectedString,
    `${label}: the finished original's stored entry must stay byte-identical`
  );
}

function assertActionContract(podium, widthLabel, { assertInitialFocus = true } = {}) {
  assert.equal(podium.present, true, `${widthLabel}: the podium dialog must render`);
  assert.equal(podium.open, true, `${widthLabel}: the podium must be modal-open via showModal`);
  assert.equal(podium.buttonCount, 3, `${widthLabel}: the podium must offer exactly three buttons`);
  assert.deepEqual(podium.actions.map((button) => button.action),
    EXPECTED_ACTIONS.map((expected) => expected.action),
    `${widthLabel}: the three actions must render in Decision 1 DOM order`);
  for (const [index, expected] of EXPECTED_ACTIONS.entries()) {
    const button = podium.actions[index];
    assert.equal(button.label, expected.label, `${widthLabel}: the ${expected.action} label must be exact`);
    assert.equal(button.ariaLabel, null,
      `${widthLabel}: ${expected.action} must keep the visible text as its accessible name (no aria-label override)`);
    assert.equal(button.type, "button", `${widthLabel}: ${expected.action} must be type="button"`);
    assert.ok(button.className.includes(expected.className),
      `${widthLabel}: ${expected.action} must carry the ${expected.className} styling class`);
    assert.ok(button.rect.height >= 44, `${widthLabel}: ${expected.action} needs a >=44px tall target`);
    assert.ok(button.rect.width >= 44, `${widthLabel}: ${expected.action} needs a >=44px wide target`);
  }

  // Initial focus belongs to the freshly opened dialog; a mid-dialog viewport
  // switch may legitimately drop element focus (emulation relayout), so the
  // 320px re-read asserts the structural contract only.
  if (assertInitialFocus) {
    assert.equal(podium.focusOnClose, true,
      `${widthLabel}: initial focus must stay on the dismiss control (close-podium)`);
    assert.equal(podium.focusInsideDialog, true, `${widthLabel}: focus must be inside the dialog`);
  }
  assert.equal(podium.titleText, "Final podium", `${widthLabel}: the frozen podium title holds`);
  assert.equal(podium.ledeText, "Congratulations to the top of the table.",
    `${widthLabel}: the frozen lede keeps its period (the mockup's exclamation is not adopted)`);
  assert.equal(podium.gameTitleLinePresent, true, `${widthLabel}: the game-title line renders`);
  assert.equal(podium.gameTitleLineIsFirstParagraph, true,
    `${widthLabel}: .podium-game-title stays the first content paragraph in .podium-body`);
  assert.equal(podium.gameTitleLineBeforeTitleHeading, true,
    `${widthLabel}: .podium-game-title must precede the frozen h2`);
  assert.equal(podium.firstTokenLabel, "Player 1, Blue",
    `${widthLabel}: podium tokens keep the Player {n}, {color} label convention`);
  assert.equal(podium.confettiAriaHidden, "true", `${widthLabel}: the confetti layer must stay aria-hidden`);
  assert.equal(podium.confettiPointerEvents, "none", `${widthLabel}: confetti must not intercept pointers`);
  assert.equal(podium.confettiPieceCount, 14, `${widthLabel}: the 14-piece confetti contract holds`);
}

// Session 1: the three-action contract at 1280x800 and 320x720 (Scenario 1).
async function runActionsContract(cdp, { consoleProblems }) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  await createGame(cdp, "Podium contract", ["Alex", "Sam", "Jamie"]);
  await savePoints(cdp, "10");
  await click(cdp, "[data-player-id='active-game-player-2'] .add-points-action");
  await savePoints(cdp, "5");

  await finishToPodium(cdp);

  const rawOpen = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
  assert.equal((await readSavedGamesState(cdp, STORAGE_KEY)).keyCount, 1);

  const desktopPodium = await readPodiumActions(cdp);
  assertActionContract(desktopPodium, "1280x800");
  assert.deepEqual(desktopPodium.standingsNames, ["Alex", "Sam", "Jamie"],
    "the full standings stay visible behind the modal");
  assert.deepEqual(desktopPodium.standingsTotals, ["10", "5", "0"]);

  // Desktop layout: the primary spans the actions block; the two secondaries
  // share one side-by-side row below it.
  const blockWidth = desktopPodium.actionsBlockRect.width;
  const primaryRect = desktopPodium.actions[0].rect;
  const closeRect = desktopPodium.actions[1].rect;
  const exitRect = desktopPodium.actions[2].rect;
  assert.ok(Math.abs(primaryRect.width - blockWidth) <= 1,
    "the primary action must be full width at 1280x800");
  assert.ok(primaryRect.bottom <= closeRect.top,
    "the primary action must sit above the secondary row");
  assert.ok(Math.abs(closeRect.top - exitRect.top) <= 2,
    "the two secondaries must share one row");
  assert.ok(closeRect.right <= exitRect.left,
    "Close & view full standings must sit left of Save & exit to Dashboard");
  const [closeColumn, exitColumn] = String(desktopPodium.rowColumns).split(" ").map(Number.parseFloat);
  assert.ok(closeColumn > 0 && exitColumn > 0 && Math.abs(closeColumn - exitColumn) <= 2,
    `the secondary row must use two equal columns, got: ${desktopPodium.rowColumns}`);
  const desktopScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-podium-actions.png"));

  // Nothing writes while the dialog is open, even after moving focus around.
  await pressTab(cdp);
  const afterTab = await readPodiumActions(cdp);
  assert.equal(afterTab.open, true, "Tab must keep the dialog open");
  assert.equal(afterTab.focusAction, "podium-exit-dashboard",
    "Tab from the dismiss control reaches the exit action in DOM order");
  assert.equal((await readSavedGamesState(cdp, STORAGE_KEY)).raw, rawOpen,
    "the stored payload stays byte-identical while the podium is open");

  // 320x720: the secondaries stack full width under the primary.
  await setViewport(cdp, { width: 320, height: 720, mobile: true });

  const mobilePodium = await readPodiumActions(cdp);
  assertActionContract(mobilePodium, "320x720", { assertInitialFocus: false });
  assert.equal(mobilePodium.horizontalOverflow, false,
    "the podium must not cause page-level horizontal overflow at 320px");
  assert.ok(mobilePodium.dialogScroll.scrollWidth <= mobilePodium.dialogScroll.clientWidth,
    "the dialog itself must not scroll horizontally at 320px");
  const mobileBlockWidth = mobilePodium.actionsBlockRect.width;
  const mobilePrimary = mobilePodium.actions[0].rect;
  const mobileClose = mobilePodium.actions[1].rect;
  const mobileExit = mobilePodium.actions[2].rect;
  assert.equal(String(mobilePodium.rowColumns).split(" ").length, 1,
    `the secondary row must stack to one column at 320px, got: ${mobilePodium.rowColumns}`);
  for (const [name, rect] of [["primary", mobilePrimary], ["close", mobileClose], ["exit", mobileExit]]) {
    assert.ok(Math.abs(rect.width - mobileBlockWidth) <= 1,
      `the ${name} action must be full width at 320px`);
  }
  assert.ok(mobileClose.top >= mobilePrimary.bottom - 1,
    "the secondaries must stack below the primary at 320px");
  assert.ok(mobileExit.top >= mobileClose.bottom - 1,
    "the two secondaries must stack on separate rows at 320px");
  const mobileScreenshot = await screenshot(cdp, path.join(evidenceDir, "mobile-podium-actions-320px.png"));

  assert.deepEqual(consoleProblems, [], "the actions-contract session must not produce uncaught console errors");
  return { desktopScreenshot, mobileScreenshot };
}

// Session 2: every close path still lands on the read-only standings with
// byte-identical storage (Scenario 2), including Enter on the initially
// focused dismiss control (the deterministic 320px proof the rewritten
// podium-suite walk no longer provides).
async function runClosePaths(cdp, { consoleProblems }) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  const closePathGames = [
    { title: "Close click", activate: async (cdpClient) => click(cdpClient, "[data-action='close-podium']") },
    { title: "Enter close", activate: async (cdpClient) => pressEnter(cdpClient) },
    { title: "Escape close", activate: async (cdpClient) => pressEscape(cdpClient) },
    { title: "Backdrop close", activate: async (cdpClient) => clickBackdrop(cdpClient, 8, 400) },
    { title: "Space close", activate: async (cdpClient) => pressSpace(cdpClient) }
  ];

  for (const [index, path] of closePathGames.entries()) {
    await createGame(cdp, path.title, ["Ada", "Bo"]);
    await savePoints(cdp, `${index + 1}`);
    await finishToPodium(cdp);

    const podium = await readPodiumActions(cdp);
    assert.equal(podium.focusOnClose, true, `${path.title}: the dismiss control must hold initial focus`);
    const rawOpen = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;

    await path.activate(cdp);
    await waitForAbsent(cdp, "[data-podium-dialog]");

    const after = await readActiveState(cdp);
    assert.equal(after.podiumDialogPresent, false, `${path.title}: the dialog must leave the DOM`);
    assert.equal(after.focusOnHeading, true, `${path.title}: focus must return to the game heading`);
    assert.equal(after.eyebrow, "Finished");
    assert.deepEqual(after.names, ["Ada", "Bo"], `${path.title}: standings unchanged after dismissal`);
    assert.equal((await readSavedGamesState(cdp, STORAGE_KEY)).raw, rawOpen,
      `${path.title}: open/dismiss must not change the stored payload`);

    await goHome(cdp);
  }

  const home = await readHomeState(cdp);
  assert.equal(home.finishedCards.length, 5, "all five finished games must be listed once");
  assert.equal(home.unfinishedCards.length, 0, "no phantom unfinished cards may appear");

  await click(cdp, `[data-action='view-results'][data-game-id='${home.finishedCards[0].gameId}']`);
  await waitForSelector(cdp, "[data-finished-note]");
  const reopened = await readActiveState(cdp);
  assert.equal(reopened.podiumDialogPresent, false, "reopening a finished game must not re-celebrate");
  assert.equal(reopened.focusOnHeading, true);

  const closeScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-close-paths-finished.png"));

  assert.deepEqual(consoleProblems, [], "the close-paths session must not produce uncaught console errors");
  return { closeScreenshot };
}

// Session 3: Save & exit to Dashboard is pure navigation (Scenario 3) with a
// 320px real-key walk (Scenario 5).
async function runExitDashboard(cdp, { consoleProblems }) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  await createGame(cdp, "Exit lane", ["Ada", "Bo"]);
  await savePoints(cdp, "8");
  await finishToPodium(cdp);

  const rawOpen = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;

  await click(cdp, "[data-action='podium-exit-dashboard']");
  await waitForAbsent(cdp, "[data-podium-dialog]");

  const home = await readHomeState(cdp);
  assert.equal(home.focusOnHomeHeading, true, "the exit must land focus on the Dashboard heading");
  assert.equal(home.dashboardCurrent, "page", "Dashboard must be aria-current after the exit");
  assert.equal(home.newGameCurrent, null);
  assert.equal(home.activeGameCurrent, null);
  assert.equal(home.finishedCards.length, 1, "the finished game must appear under Finished games");
  assert.equal(home.finishedCards[0].title, "Exit lane");
  assert.equal(home.finishedCards[0].actionLabel, "View results Exit lane");
  assert.equal(home.unfinishedCards.length, 0, "no phantom unfinished cards may appear");
  assert.equal(home.horizontalOverflow, false);
  assert.equal((await readSavedGamesState(cdp, STORAGE_KEY)).raw, rawOpen,
    "the exit must not write: the stored payload stays byte-identical");
  const exitScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-exit-home.png"));

  // View results reopens read-only without re-celebration.
  await click(cdp, `[data-action='view-results'][data-game-id='${home.finishedCards[0].gameId}']`);
  await waitForSelector(cdp, "[data-finished-note]");
  const reopened = await readActiveState(cdp);
  assert.equal(reopened.finishedNote, "Final standings — this game is finished and can't be scored.");
  assert.equal(reopened.podiumDialogPresent, false, "View results must not re-celebrate");
  assert.equal(reopened.focusOnHeading, true);

  // 320x720 real-key walk: Tab reaches the exit action, Enter navigates home.
  await setViewport(cdp, { width: 320, height: 720, mobile: true });
  await goHome(cdp);
  await createGame(cdp, "Pocket exit", ["Rae", "Lou"]);
  await savePoints(cdp, "3");
  await finishToPodium(cdp);

  const rawMobileOpen = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
  const podium = await readPodiumActions(cdp);
  assert.equal(podium.focusOnClose, true, "initial focus stays on the dismiss control at 320px");

  await pressTab(cdp);
  const tabState = await evaluate(cdp, () => {
    const dialog = document.querySelector("[data-podium-dialog]");
    return {
      open: Boolean(dialog?.open),
      action: document.activeElement?.dataset?.action ?? null,
      inside: Boolean(dialog && document.activeElement && dialog.contains(document.activeElement))
    };
  });
  assert.equal(tabState.open, true, "Tab must keep the dialog open at 320px");
  assert.equal(tabState.action, "podium-exit-dashboard",
    "the first Tab must reach the exit action (no wrap involved from the dismiss control)");
  assert.equal(tabState.inside, true, "focus must stay inside the dialog");

  await pressEnter(cdp);
  await waitForAbsent(cdp, "[data-podium-dialog]");

  const mobileHome = await readHomeState(cdp);
  assert.equal(mobileHome.focusOnHomeHeading, true,
    "Enter on the exit action must land focus on the Dashboard heading at 320px");
  assert.equal(mobileHome.dashboardCurrent, "page");
  assert.equal(mobileHome.finishedCards.length, 2, "both finished games list after the mobile exit");
  assert.ok(mobileHome.finishedCards.some((card) => card.title === "Pocket exit"),
    "the exited game must be listed under Finished games");
  assert.equal(mobileHome.unfinishedCards.length, 0);
  assert.equal(mobileHome.horizontalOverflow, false, "the home view must not overflow at 320px");
  assert.equal((await readSavedGamesState(cdp, STORAGE_KEY)).raw, rawMobileOpen,
    "the mobile exit must not write: the stored payload stays byte-identical");
  const mobileExitScreenshot = await screenshot(cdp, path.join(evidenceDir, "mobile-exit-home-320px.png"));

  assert.deepEqual(consoleProblems, [], "the exit-dashboard session must not produce uncaught console errors");
  return { exitScreenshot, mobileExitScreenshot };
}

// Session 4: podium Play again delegates to the unchanged handlePlayAgain
// (Scenario 4) and the detached-dialog close guard survives two podiums in one
// document lifetime (Scenario 6).
async function runPodiumReplay(cdp, { consoleProblems }) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  await createGame(cdp, "Rematch lane", ["Alex", "Sam", "Jamie"]);
  await savePoints(cdp, "10");
  await click(cdp, "[data-player-id='active-game-player-2'] .add-points-action");
  await savePoints(cdp, "5");
  await click(cdp, "[data-player-id='active-game-player-3'] .add-points-action");
  await savePoints(cdp, "7");

  await finishToPodium(cdp);

  const storedBefore = await readSavedGamesState(cdp, STORAGE_KEY);
  const parsedBefore = JSON.parse(storedBefore.raw);
  assert.equal(parsedBefore.games.length, 1, "only the finished original exists before the podium replay");
  const originalId = parsedBefore.games[0].id;
  const originalEntry = JSON.stringify(parsedBefore.games[0]);

  const podium = await readPodiumActions(cdp);
  assert.equal(podium.focusOnClose, true, "the replay podium keeps initial focus on the dismiss control");

  await click(cdp, "[data-action='podium-play-again']");
  await waitForSelector(cdp, "#score-amount");

  const replay = await readActiveState(cdp);
  assert.equal(replay.eyebrow, "In progress", "the podium replay must open as a scorable active game");
  assert.ok(
    AUTO_LABEL_PATTERN.test(replay.heading),
    `the replay heading must be the auto-label, got: ${replay.heading}`
  );
  assert.notEqual(replay.heading, "Rematch lane", "the original title must not be copied");
  assert.deepEqual(replay.names, ["Alex", "Sam", "Jamie"]);
  assert.deepEqual(replay.totals, ["0", "0", "0"], "every replay total must restart at zero");
  assert.deepEqual(replay.ranks, ["1", "1", "1"], "zero totals share rank 1 in creation order");
  assert.equal(replay.selectedRowCount, 1, "the first player must be selected");
  assert.equal(replay.scoreFormPresent, true);
  assert.equal(replay.podiumDialogPresent, false, "the replay must not celebrate");
  assert.equal(replay.focusOnHeading, true, "focus must land on the new game's heading");
  assert.equal(replay.replayFeedback, null,
    "the replay feedback region only renders on finished views — none on the scorable replay");
  const replayScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-podium-replay-active.png"));

  const storedAfterReplay = await readSavedGamesState(cdp, STORAGE_KEY);
  assert.equal(storedAfterReplay.gameCount, 2, "the replay must append a second stored game");
  const replayId = storedAfterReplay.savedIds.find((id) => id !== originalId);
  assert.ok(replayId?.startsWith("replay-game-"), "replay ids must come from the replay-game seed");
  const parsedAfterReplay = JSON.parse(storedAfterReplay.raw);
  const replayEntry = parsedAfterReplay.games.find((game) => game.id === replayId);
  assert.equal(replayEntry.status, "active");
  assert.equal(replayEntry.title, "", "the stored replay starts untitled");
  assert.ok(!("changes" in replayEntry), "the stored replay must not carry a change log");
  assert.deepEqual(
    replayEntry.players.map((player) => [player.name, player.color, player.marker, player.order]),
    parsedBefore.games[0].players.map((player) => [player.name, player.color, player.marker, player.order]),
    "the stored replay must copy the presentation of the original's roster"
  );
  assertOriginalEntryByteIdentical(storedAfterReplay.raw, originalId, originalEntry, "after the podium replay");

  await savePoints(cdp, "5");
  assertOriginalEntryByteIdentical(
    (await readSavedGamesState(cdp, STORAGE_KEY)).raw,
    originalId,
    originalEntry,
    "after scoring the replay"
  );

  // Scenario 6: a second podium in the same document lifetime. The queued
  // close from the first, now-detached dialog (closed by the play-again
  // wrapper) must never clobber this one.
  await finishToPodium(cdp);

  const secondPodium = await readPodiumActions(cdp);
  assert.equal(secondPodium.open, true, "the second podium must open normally");
  assert.equal(secondPodium.focusOnClose, true, "the second podium must hold initial focus");

  await new Promise((resolve) => {
    setTimeout(resolve, 400);
  });
  const secondPodiumLater = await readPodiumActions(cdp);
  assert.equal(secondPodiumLater.open, true,
    "a stale close from the detached first dialog must never dismiss the second podium");

  await click(cdp, "[data-action='close-podium']");
  await waitForAbsent(cdp, "[data-podium-dialog]");
  const afterSecondDismiss = await readActiveState(cdp);
  assert.equal(afterSecondDismiss.focusOnHeading, true, "the second dismissal returns focus to the heading");

  assertOriginalEntryByteIdentical(
    (await readSavedGamesState(cdp, STORAGE_KEY)).raw,
    originalId,
    originalEntry,
    "after the two-podium cycle"
  );

  // Reload: the finished original and its finished replay list independently.
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");
  const homeAfter = await readHomeState(cdp);
  assert.equal(homeAfter.finishedCards.length, 2, "both finished games list after reload");
  assert.equal(homeAfter.unfinishedCards.length, 0);
  const rematchCard = homeAfter.finishedCards.find((card) => card.title === "Rematch lane");
  assert.ok(rematchCard, "the original must list under Finished games");
  assert.equal(rematchCard.gameId, originalId);
  assert.equal(rematchCard.actionLabel, "View results Rematch lane");
  assert.ok(
    homeAfter.finishedCards.some((card) => AUTO_LABEL_PATTERN.test(card.title)),
    "the finished replay lists under its auto-label"
  );
  assertOriginalEntryByteIdentical(
    (await readSavedGamesState(cdp, STORAGE_KEY)).raw,
    originalId,
    originalEntry,
    "after reload"
  );
  const homeScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-home-after-podium-replay.png"));

  // Scenario 4's reload separation: a replay left unfinished lists under
  // Unfinished games while its finished original stays under Finished games.
  await createGame(cdp, "Second lane", ["Rae", "Lou"]);
  await savePoints(cdp, "4");
  await finishToPodium(cdp);

  const secondRaw = await readSavedGamesState(cdp, STORAGE_KEY);
  const secondParsed = JSON.parse(secondRaw.raw);
  const secondOriginal = secondParsed.games.find((game) => game.title === "Second lane");
  assert.ok(secondOriginal, "the Second lane original must be stored");
  const secondOriginalEntry = JSON.stringify(secondOriginal);

  await click(cdp, "[data-action='podium-play-again']");
  await waitForSelector(cdp, "#score-amount");
  const secondReplay = await readActiveState(cdp);
  assert.ok(
    AUTO_LABEL_PATTERN.test(secondReplay.heading),
    `the second replay heading must be the auto-label, got: ${secondReplay.heading}`
  );
  assert.deepEqual(secondReplay.totals, ["0", "0"]);

  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");
  const homeSecond = await readHomeState(cdp);
  assert.equal(homeSecond.finishedCards.length, 3, "the three finished games list after reload");
  assert.equal(homeSecond.unfinishedCards.length, 1, "the unfinished replay lists under Unfinished games");
  assert.equal(homeSecond.unfinishedCards[0].gameId.startsWith("replay-game-"), true);
  assert.ok(
    homeSecond.unfinishedCards[0].actionLabel.startsWith("Resume Game — "),
    `the unfinished replay card must use the auto-label, got: ${homeSecond.unfinishedCards[0].actionLabel}`
  );
  assertOriginalEntryByteIdentical(
    (await readSavedGamesState(cdp, STORAGE_KEY)).raw,
    secondOriginal.id,
    secondOriginalEntry,
    "Second lane original after its unfinished replay"
  );

  assert.deepEqual(consoleProblems, [], "the podium-replay session must not produce uncaught console errors");
  return { replayScreenshot, homeScreenshot };
}

async function main() {
  try {
    const contract = await runSession("actions-contract", runActionsContract);
    assert.equal(typeof contract.desktopScreenshot, "string");

    await runSession("close-paths", runClosePaths);
    await runSession("exit-dashboard", runExitDashboard);
    await runSession("podium-replay", runPodiumReplay);

    console.log("Browser podium-actions test passed: the finish podium offers exactly three type=button actions in DOM order — the full-width primary 'Play again (same players, reset scores)' (podium-play-again) above the side-by-side secondaries 'Close & view full standings' (the unchanged close-podium hook) and 'Save & exit to Dashboard' (podium-exit-dashboard), stacked full width at 320x720, all targets >=44px, every visible label doubling as the accessible name with no aria-label override, initial focus on the dismiss control, and the frozen title/lede/game-title line, Player {n} tokens, 14-piece aria-hidden confetti, visible standings, and byte-identical payload while open; the close hook (click, Enter, Escape, real backdrop click, and Space) still lands on the read-only standings with heading focus and byte-identical storage and no re-celebration on reopen; Save & exit dismisses and navigates home with focus on the Dashboard heading, aria-current on nav-dashboard, the finished card listed, zero writes (byte-identity proof) and no phantom cards, including a 320px Tab+Enter real-key walk; podium Play again delegates to the unchanged handlePlayAgain (separate untitled zero-score replay-game-* entry, original byte-identical across the replay and its scoring, reload listing both games correctly) and the detached-dialog close guard keeps a second podium in the same document lifetime open and dismissable; no uncaught console errors in any session.");
    console.log(`Browser evidence screenshots: ${[
      contract.desktopScreenshot,
      contract.mobileScreenshot,
      path.join(evidenceDir, "desktop-close-paths-finished.png"),
      path.join(evidenceDir, "desktop-exit-home.png"),
      path.join(evidenceDir, "mobile-exit-home-320px.png"),
      path.join(evidenceDir, "desktop-podium-replay-active.png"),
      path.join(evidenceDir, "desktop-home-after-podium-replay.png")
    ].join(", ")}`);
  } finally {
    await closeServer(server);
  }
}

await main();
