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
const evidenceDir = await createEvidenceDir("devexpert-finish-game");
const server = createStaticServer();
const baseUrl = await listen(server);

const FINISH_WARNING = "Finished games can't be reopened for scoring. Final standings stay saved in this browser.";
const FINISHED_NOTE = "Final standings — this game is finished and can't be scored.";
const WRITE_NOTICE = "Your latest change couldn't be saved. The game still works, and nothing already saved was lost — your next change will try again.";
const INVALID_NOTICE = "Saved game data couldn't be read, so saved games can't be shown and new changes won't be saved. Nothing was deleted. Reloading the page will try again.";

const THROWING_SET_ITEM_SOURCE = `
  Object.defineProperty(Storage.prototype, "setItem", {
    value: function setItem() {
      throw new Error("Storage is blocked in this test session.");
    },
    writable: true,
    configurable: true
  });
`;

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

async function readHomeState(cdp) {
  return evaluate(cdp, () => {
    const readPanel = (labelledBy) => document.querySelector(`article[aria-labelledby='${labelledBy}']`);
    const readCards = (root) => [...(root?.querySelectorAll(".saved-game") ?? [])].map((card) => ({
      gameId: card.dataset.savedGameId ?? "",
      title: card.querySelector(".saved-game-title")?.textContent?.trim() ?? "",
      meta: card.querySelector(".saved-game-meta")?.textContent?.trim() ?? "",
      updated: card.querySelector(".saved-game-updated")?.textContent?.trim() ?? "",
      names: card.querySelector(".saved-game-names")?.textContent?.trim() ?? "",
      actionLabel: card.querySelector("button")?.getAttribute("aria-label") ?? ""
    }));
    const unfinished = readPanel("unfinished-title");
    const finished = readPanel("finished-title");

    return {
      unfinishedCards: readCards(unfinished),
      finishedCards: readCards(finished),
      unfinishedListLabel: unfinished?.querySelector(".saved-game-list")?.getAttribute("aria-label") ?? null,
      finishedListLabel: finished?.querySelector(".saved-game-list")?.getAttribute("aria-label") ?? null,
      unfinishedEmptyTitle: unfinished?.querySelector(".empty-state .empty-title")?.textContent?.trim() ?? null,
      finishedEmptyTitle: finished?.querySelector(".empty-state .empty-title")?.textContent?.trim() ?? null,
      finishedEmptyBody: finished?.querySelector(".empty-state .empty-title + p")?.textContent?.trim() ?? null,
      storageNoticePresent: Boolean(document.querySelector("[data-storage-notice]")),
      storageNoticeRole: document.querySelector("[data-storage-notice]")?.getAttribute("role") ?? null,
      storageNoticeText: document.querySelector("[data-storage-notice]")?.textContent?.trim() ?? "",
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
    totalLabels: [...document.querySelectorAll(".active-player-total")].map((node) => node.getAttribute("aria-label")),
    addPointsCount: document.querySelectorAll(".add-points-action").length,
    ariaPressedCount: document.querySelectorAll("[aria-pressed]").length,
    scoreFormPresent: Boolean(document.querySelector("[data-score-form]")),
    savePointsPresent: Boolean(document.querySelector("[data-score-form] button[type='submit']")),
    undoPresent: Boolean(document.querySelector("[data-action='undo-last-score']")),
    scorePanelPresent: Boolean(document.querySelector(".score-panel")),
    finishSectionPresent: Boolean(document.querySelector("[data-finish-section]")),
    promptPresent: Boolean(document.querySelector(".finish-prompt")),
    selectedRowCount: document.querySelectorAll(".active-player.is-selected").length,
    finishedNote: document.querySelector("[data-finished-note]")?.textContent?.trim() ?? null,
    finishedNoteRole: document.querySelector("[data-finished-note]")?.getAttribute("role") ?? null,
    feedback: document.querySelector("#score-feedback")?.textContent?.trim() ?? "",
    storageNoticePresent: Boolean(document.querySelector("[data-storage-notice]")),
    storageNoticeRole: document.querySelector("[data-storage-notice]")?.getAttribute("role") ?? null,
    storageNoticeText: document.querySelector("[data-storage-notice]")?.textContent?.trim() ?? "",
    backHomePresent: Boolean(document.querySelector("[data-action='back-home']")),
    podiumDialogPresent: Boolean(document.querySelector("[data-podium-dialog]")),
    podiumOpen: Boolean(document.querySelector("[data-podium-dialog]")?.open),
    focusOnHeading: Boolean(document.activeElement?.hasAttribute?.("data-active-heading")),
    focusAction: document.activeElement?.dataset?.action ?? null,
    // refine-ui-after-testing: Finish game lives in the active header, never
    // in the score panel.
    finishSectionInHeader: Boolean(document.querySelector(".active-header [data-finish-section]")),
    finishSectionInScorePanel: Boolean(document.querySelector(".score-panel [data-finish-section]")),
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
  }));
}

async function readPodiumBrief(cdp) {
  return evaluate(cdp, () => {
    const dialog = document.querySelector("[data-podium-dialog]");
    const close = document.querySelector("[data-action='close-podium']");

    return {
      present: Boolean(dialog),
      open: Boolean(dialog?.open),
      labelledBy: dialog?.getAttribute("aria-labelledby") ?? null,
      describedBy: dialog?.getAttribute("aria-describedby") ?? null,
      titleText: document.getElementById("podium-title")?.textContent?.trim() ?? null,
      groupHeadings: [...document.querySelectorAll(".podium-rank-heading")].map((node) => node.textContent.trim()),
      podiumPlayerCount: document.querySelectorAll(".podium-player").length,
      focusOnClose: document.activeElement !== null && document.activeElement === close,
      focusInsideDialog: dialog !== null && document.activeElement !== null && dialog.contains(document.activeElement)
    };
  });
}

async function readFinishPrompt(cdp) {
  return evaluate(cdp, () => {
    const promptSection = document.querySelector(".active-board > [data-finish-section]");
    const header = document.querySelector(".active-header");
    const roster = document.querySelector(".roster-panel");

    return {
      present: Boolean(document.querySelector(".finish-prompt")),
      title: document.querySelector(".finish-prompt-title")?.textContent?.trim() ?? null,
      warning: document.querySelector(".finish-prompt-warning")?.textContent?.trim() ?? null,
      describedBy: document.querySelector("[data-action='confirm-finish']")?.getAttribute("aria-describedby") ?? null,
      openLabel: document.querySelector("[data-action='confirm-finish']")?.textContent?.trim() ?? null,
      cancelLabel: document.querySelector("[data-action='cancel-finish']")?.textContent?.trim() ?? null,
      focusOnConfirm: document.activeElement !== null &&
        document.activeElement === document.querySelector("[data-action='confirm-finish']"),
      openerGone: !document.querySelector("[data-action='open-finish']"),
      scoreFormPresent: Boolean(document.querySelector("[data-score-form]")),
      promptBelowHeader: Boolean(header && promptSection &&
        (header.compareDocumentPosition(promptSection) & Node.DOCUMENT_POSITION_FOLLOWING)),
      promptAboveLeaderboard: Boolean(promptSection && roster &&
        (promptSection.compareDocumentPosition(roster) & Node.DOCUMENT_POSITION_FOLLOWING)),
      promptInScorePanel: Boolean(document.querySelector(".score-panel [data-finish-section]"))
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

async function runSession(sessionName, run, { setupSource = "" } = {}) {
  const userDataDir = path.join(evidenceDir, sessionName);
  const launched = await launchChrome({ chromePath, userDataDir, url: "about:blank" });
  const sessionChrome = launched.chrome;

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
    sessionChrome.kill("SIGTERM");
  }
}

async function runMainFlow(cdp, { consoleProblems }) {
  // Fresh home: the finished panel shows the new empty state and no cards.
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  const freshHome = await readHomeState(cdp);
  assert.equal(freshHome.finishedCards.length, 0);
  assert.equal(freshHome.finishedEmptyTitle, "No finished games yet.");
  assert.equal(freshHome.finishedEmptyBody, "Finish a game and its standings will appear here.");
  assert.equal(freshHome.unfinishedCards.length, 0);

  // Build an active game with distinct totals: Alex 10, Sam 5, Jamie 0.
  await createGame(cdp, "Championship cup", ["Alex", "Sam", "Jamie"]);
  await savePoints(cdp, "10");
  await click(cdp, "[data-player-id='active-game-player-2'] .add-points-action");
  await savePoints(cdp, "5");

  const activeBefore = await readActiveState(cdp);
  assert.equal(activeBefore.eyebrow, "In progress");
  assert.deepEqual(activeBefore.totals, ["10", "5", "0"]);
  assert.equal(activeBefore.finishSectionPresent, true, "the active view must offer the Finish game action");
  assert.equal(activeBefore.finishSectionInHeader, true, "the Finish game opener lives in the active header");
  assert.equal(activeBefore.finishSectionInScorePanel, false, "the score panel no longer carries a finish section");
  const openerHeight = await evaluate(cdp, () =>
    document.querySelector("[data-action='open-finish']")?.getBoundingClientRect().height ?? 0);
  assert.ok(openerHeight >= 44, "the Finish game opener needs a roughly 44px target");

  // Scenario 1: opening the prompt shows the exact copy and focuses the confirm button.
  const payloadBeforePrompt = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
  await click(cdp, "[data-action='open-finish']");
  await waitForSelector(cdp, "[data-action='confirm-finish']");

  const prompt = await readFinishPrompt(cdp);
  assert.equal(prompt.present, true);
  assert.equal(prompt.title, "Finish this game?");
  assert.equal(prompt.warning, FINISH_WARNING);
  assert.equal(prompt.describedBy, "finish-warning", "the confirm button must point at the warning text");
  assert.equal(prompt.openLabel, "Finish game");
  assert.equal(prompt.cancelLabel, "Cancel");
  assert.equal(prompt.focusOnConfirm, true, "opening the prompt must move focus to the confirm button");
  assert.equal(prompt.openerGone, true, "the opener must swap to the prompt");
  assert.equal(prompt.scoreFormPresent, true, "the score form stays available while the prompt is open");
  assert.equal(prompt.promptBelowHeader, true, "the prompt renders below the active header");
  assert.equal(prompt.promptAboveLeaderboard, true, "the prompt renders above the leaderboard panel");
  assert.equal(prompt.promptInScorePanel, false, "the score panel must not host the finish prompt");
  const promptScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-finish-prompt.png"));

  await click(cdp, "[data-action='cancel-finish']");
  await waitForSelector(cdp, "[data-action='open-finish']");

  const afterCancel = await readActiveState(cdp);
  assert.equal(afterCancel.promptPresent, false, "cancel must close the prompt");
  assert.equal(afterCancel.focusAction, "open-finish", "cancel must return focus to the Finish game opener");
  assert.deepEqual(afterCancel.totals, ["10", "5", "0"], "cancel must not change totals");
  assert.deepEqual(afterCancel.ranks, ["1", "2", "3"], "cancel must not change ranks");
  assert.deepEqual(afterCancel.names, ["Alex", "Sam", "Jamie"]);
  const pressedAfterCancel = await evaluate(cdp, () =>
    [...document.querySelectorAll(".add-points-action")].map((button) => button.getAttribute("aria-pressed")));
  assert.deepEqual(pressedAfterCancel, ["false", "true", "false"], "cancel must not change selection");
  const payloadAfterCancel = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
  assert.equal(payloadAfterCancel, payloadBeforePrompt, "cancel must not change the stored payload");

  // Scoring still works after cancel: a save and an undo both succeed.
  await click(cdp, "[data-player-id='active-game-player-3'] .add-points-action");
  await savePoints(cdp, "7");
  const afterScore = await readActiveState(cdp);
  assert.equal(afterScore.feedback, "Added 7 points to Jamie. New total: 7. Rank: 2.",
    "scoring must work unchanged after cancel");
  assert.deepEqual(afterScore.totals, ["10", "7", "5"]);
  await click(cdp, "[data-action='undo-last-score']");
  const afterUndo = await readActiveState(cdp);
  assert.equal(afterUndo.feedback, "Undid 7 points for Jamie. New total: 0. Rank: 3.",
    "undo must still reverse the latest change after cancel");
  assert.deepEqual(afterUndo.totals, ["10", "5", "0"]);

  // Scenario 2: confirming locks the view into read-only final standings.
  await click(cdp, "[data-action='open-finish']");
  await waitForSelector(cdp, "[data-action='confirm-finish']");
  await pressEnter(cdp);
  await waitForSelector(cdp, "[data-finished-note]");

  const finished = await readActiveState(cdp);
  assert.equal(finished.eyebrow, "Finished", "the eyebrow must read Finished");
  assert.equal(finished.heading, "Championship cup");
  assert.equal(finished.finishedNote, FINISHED_NOTE);
  assert.equal(finished.finishedNoteRole, "status", "the read-only note must use role=status");
  assert.deepEqual(finished.names, ["Alex", "Sam", "Jamie"], "all players stay visible in final standings");
  assert.deepEqual(finished.totals, ["10", "5", "0"]);
  assert.deepEqual(finished.ranks, ["1", "2", "3"]);
  assert.deepEqual(finished.totalLabels, [
    "Alex: rank 1, total 10",
    "Sam: rank 2, total 5",
    "Jamie: rank 3, total 0"
  ], "aria-labels must be unchanged in the finished view");
  assert.equal(finished.addPointsCount, 0, "the finished view must have zero Add points buttons");
  assert.equal(finished.ariaPressedCount, 0, "the finished view must have no aria-pressed controls");
  assert.equal(finished.scoreFormPresent, false, "the score-entry panel must be gone");
  assert.equal(finished.savePointsPresent, false, "Save points must be gone");
  assert.equal(finished.undoPresent, false, "Undo last score must be gone");
  assert.equal(finished.scorePanelPresent, false, "the score panel must not render for a finished game");
  assert.equal(finished.finishSectionPresent, false, "no finish controls remain in the locked view");
  assert.equal(finished.selectedRowCount, 0, "no row may be selected in the finished view");
  assert.equal(finished.backHomePresent, true, "the All games control must remain");
  const podium = await readPodiumBrief(cdp);
  assert.equal(podium.present, true, "confirming must open the podium dialog");
  assert.equal(podium.open, true, "the podium dialog must be modal-open");
  assert.equal(podium.labelledBy, "podium-title", "the podium must be labelled by its title");
  assert.equal(podium.describedBy, "podium-lede", "the podium must be described by its lede");
  assert.equal(podium.titleText, "Final podium");
  assert.deepEqual(podium.groupHeadings, ["Rank 1", "Rank 2", "Rank 3"],
    "three distinct ranks put one player per podium group");
  assert.equal(podium.podiumPlayerCount, 3);
  assert.equal(podium.focusOnClose, true, "opening the podium must move focus to its Close button");
  assert.equal(finished.focusOnHeading, false, "the heading stays inert while the modal dialog is open");
  const podiumScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-podium-open.png"));
  await click(cdp, "[data-action='close-podium']");
  await waitForAbsent(cdp, "[data-podium-dialog]");

  const afterPodiumDismiss = await readActiveState(cdp);
  assert.equal(afterPodiumDismiss.podiumDialogPresent, false, "dismissing must remove the podium dialog");
  assert.equal(afterPodiumDismiss.focusOnHeading, true, "dismissing must move focus to the game heading");
  assert.deepEqual(afterPodiumDismiss.names, ["Alex", "Sam", "Jamie"],
    "final standings must be unchanged after dismissing the podium");
  assert.deepEqual(afterPodiumDismiss.totals, ["10", "5", "0"]);
  assert.deepEqual(afterPodiumDismiss.ranks, ["1", "2", "3"]);
  const finishedViewScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-finished-standings.png"));

  const storedFinished = await readSavedGamesState(cdp, STORAGE_KEY);
  const parsedFinished = JSON.parse(storedFinished.raw);
  assert.equal(parsedFinished.games.length, 1);
  assert.equal(parsedFinished.games[0].status, "finished", "the stored game must carry status finished");
  assert.equal(parsedFinished.games[0].title, "Championship cup");
  assert.ok(!("finishedAt" in parsedFinished.games[0]), "no finishedAt field may be persisted");
  assert.ok(parsedFinished.games[0].players.every((player) => !("rank" in player)), "no rank fields may be persisted");

  // Scenario 3: the finished game moves to the Finished games panel and stays there.
  await goHome(cdp);
  const homeAfterFinish = await readHomeState(cdp);
  assert.equal(homeAfterFinish.unfinishedCards.length, 0, "finished games must leave the Unfinished games panel");
  assert.equal(homeAfterFinish.unfinishedEmptyTitle, "No saved games yet.");
  assert.equal(homeAfterFinish.finishedCards.length, 1);
  assert.equal(homeAfterFinish.finishedListLabel, "Finished games");
  assert.equal(homeAfterFinish.finishedCards[0].title, "Championship cup");
  assert.equal(homeAfterFinish.finishedCards[0].actionLabel, "View results Championship cup");
  assert.equal(homeAfterFinish.finishedCards[0].meta, "3 players");
  assert.match(homeAfterFinish.finishedCards[0].updated, /^Updated /);
  const homeScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-home-finished-panel.png"));

  // A second, still-active game keeps its own card in the Unfinished panel.
  await createGame(cdp, "Friday rematch", ["Taylor", "Riley"]);
  await savePoints(cdp, "3");
  await goHome(cdp);
  const homeWithBoth = await readHomeState(cdp);
  assert.equal(homeWithBoth.unfinishedCards.length, 1, "active games stay in the Unfinished panel");
  assert.equal(homeWithBoth.unfinishedCards[0].title, "Friday rematch");
  assert.equal(homeWithBoth.unfinishedCards[0].actionLabel, "Resume Friday rematch");
  assert.equal(homeWithBoth.finishedCards.length, 1);
  const cupId = homeWithBoth.finishedCards[0].gameId;
  const rematchId = homeWithBoth.unfinishedCards[0].gameId;
  const storedBoth = JSON.parse((await readSavedGamesState(cdp, STORAGE_KEY)).raw);
  assert.deepEqual(
    storedBoth.games.map((game) => game.status).sort(),
    ["active", "finished"],
    "finishing one game must not change the other's status"
  );
  assert.equal(storedBoth.games.find((game) => game.id === cupId).status, "finished");
  assert.equal(storedBoth.games.find((game) => game.id === rematchId).status, "active");

  // Reload: the finished game is still listed under Finished games only.
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");
  const reloadedHome = await readHomeState(cdp);
  assert.equal(reloadedHome.finishedCards.length, 1);
  assert.equal(reloadedHome.unfinishedCards.length, 1);

  await click(cdp, `[data-action='view-results'][data-game-id='${cupId}']`);
  await waitForSelector(cdp, "[data-finished-note]");
  const reopened = await readActiveState(cdp);
  assert.equal(reopened.eyebrow, "Finished", "View results must reopen the read-only standings");
  assert.deepEqual(reopened.names, ["Alex", "Sam", "Jamie"]);
  assert.deepEqual(reopened.totals, ["10", "5", "0"]);
  assert.deepEqual(reopened.ranks, ["1", "2", "3"]);
  assert.equal(reopened.addPointsCount, 0);
  assert.equal(reopened.scoreFormPresent, false);
  assert.equal(reopened.focusOnHeading, true);
  assert.equal(reopened.podiumDialogPresent, false,
    "View results must reopen the standings without re-opening the podium");

  // Reload again and reopen: final ranks and totals are identical.
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");
  const homeAgain = await readHomeState(cdp);
  const cupIdAgain = homeAgain.finishedCards.find((card) => card.title === "Championship cup")?.gameId;
  assert.equal(cupIdAgain, cupId, "upsert by id must keep the same game identity");
  await click(cdp, `[data-action='view-results'][data-game-id='${cupIdAgain}']`);
  await waitForSelector(cdp, "[data-finished-note]");
  const reopenedAgain = await readActiveState(cdp);
  assert.deepEqual(reopenedAgain.totals, reopened.totals, "final totals must be identical after another reload");
  assert.deepEqual(reopenedAgain.ranks, reopened.ranks, "render-time ranks must be identical after another reload");
  assert.equal(reopenedAgain.podiumDialogPresent, false,
    "a reload plus reopen must not re-celebrate either");
  const storedAgain = JSON.parse((await readSavedGamesState(cdp, STORAGE_KEY)).raw);
  const storedCup = storedAgain.games.find((game) => game.id === cupId);
  assert.equal(storedCup.status, "finished");
  assert.ok(storedCup.players.every((player) => !("rank" in player)), "ranks stay render-time only");

  // Scenario 5: 320px layout, focus, and keyboard operability.
  await goHome(cdp);
  await setViewport(cdp, { width: 320, height: 720, mobile: true });
  const mobileHome = await readHomeState(cdp);
  assert.equal(mobileHome.horizontalOverflow, false, "the finished home panel must not overflow at 320px");
  assert.equal(mobileHome.finishedCards.length, 1);
  const viewResultsHeight = await evaluate(cdp, () =>
    document.querySelector("[data-action='view-results']")?.getBoundingClientRect().height ?? 0);
  assert.ok(viewResultsHeight >= 44, "View results needs a roughly 44px target");

  await click(cdp, "[data-action='new-game']");
  await fill(cdp, "#game-title", "Mobile finish");
  await fill(cdp, "#player-name-1", "Ada");
  await fill(cdp, "#player-name-2", "Bo");
  await click(cdp, "button[type='submit']");
  await waitForSelector(cdp, "#score-amount");

  await click(cdp, "[data-action='open-finish']");
  await waitForSelector(cdp, "[data-action='confirm-finish']");
  const mobilePrompt = await evaluate(cdp, () => ({
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    promptVisible: Boolean(document.querySelector(".finish-prompt")?.clientHeight > 0),
    buttonHeights: [...document.querySelectorAll("[data-finish-section] button")].map((button) => ({
      label: button.textContent.trim(),
      height: button.getBoundingClientRect().height
    }))
  }));
  assert.equal(mobilePrompt.horizontalOverflow, false, "the finish prompt must not overflow at 320px");
  assert.equal(mobilePrompt.promptVisible, true);
  for (const metric of mobilePrompt.buttonHeights) {
    assert.ok(metric.height >= 44, `${metric.label} must be at least 44px tall at 320px`);
  }
  const mobilePromptScreenshot = await screenshot(cdp, path.join(evidenceDir, "mobile-finish-prompt-320px.png"));

  // Keyboard walk with real keys: Tab reaches Cancel with visible focus, Enter
  // cancels back to the opener, Enter reopens, Enter confirms the finish.
  await pressTab(cdp);
  const tabState = await evaluate(cdp, () => {
    const style = getComputedStyle(document.activeElement);
    return {
      action: document.activeElement?.dataset?.action ?? "",
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth
    };
  });
  assert.equal(tabState.action, "cancel-finish", "Tab must reach the Cancel button from the confirm button");
  assert.notEqual(tabState.outlineStyle, "none", "keyboard focus must show a visible outline");
  assert.notEqual(tabState.outlineWidth, "0px");
  await pressEnter(cdp);
  await waitForSelector(cdp, "[data-action='open-finish']");
  const afterKeyboardCancel = await evaluate(cdp, () => {
    const style = getComputedStyle(document.activeElement);
    return {
      action: document.activeElement?.dataset?.action ?? "",
      outlineStyle: style.outlineStyle
    };
  });
  assert.equal(afterKeyboardCancel.action, "open-finish", "keyboard cancel must focus the opener");
  assert.notEqual(afterKeyboardCancel.outlineStyle, "none", "the keyboard-focused opener needs a visible outline");
  await pressEnter(cdp);
  await waitForSelector(cdp, "[data-action='confirm-finish']");
  await pressEnter(cdp);
  await waitForSelector(cdp, "[data-finished-note]");

  const mobilePodium = await readPodiumBrief(cdp);
  assert.equal(mobilePodium.present, true, "the real-key confirm must open the podium at 320px");
  assert.equal(mobilePodium.open, true);
  assert.equal(mobilePodium.focusOnClose, true, "the podium must focus its Close button at 320px");
  assert.equal(mobilePodium.focusInsideDialog, true, "focus must be inside the dialog at 320px");
  const mobilePodiumScreenshot = await screenshot(cdp, path.join(evidenceDir, "mobile-podium-320px.png"));
  await pressEscape(cdp);
  await waitForAbsent(cdp, "[data-podium-dialog]");

  const mobileFinished = await readActiveState(cdp);
  assert.equal(mobileFinished.finishedNoteRole, "status");
  assert.equal(mobileFinished.finishedNote, FINISHED_NOTE);
  assert.equal(mobileFinished.podiumDialogPresent, false, "Escape must dismiss the podium at 320px");
  assert.equal(mobileFinished.horizontalOverflow, false, "the finished view must not overflow at 320px");
  assert.equal(mobileFinished.addPointsCount, 0);
  assert.equal(mobileFinished.focusOnHeading, true, "dismissing via Escape must return focus to the heading");
  const mobileFinishedScreenshot = await screenshot(cdp, path.join(evidenceDir, "mobile-finished-320px.png"));

  assert.deepEqual(consoleProblems, [], "the main flow must not produce uncaught console errors");
  return {
    promptScreenshot,
    podiumScreenshot,
    finishedViewScreenshot,
    homeScreenshot,
    mobilePromptScreenshot,
    mobilePodiumScreenshot,
    mobileFinishedScreenshot
  };
}

async function runBlockedWriteSession(cdp, { consoleProblems, warnings }) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  await createGame(cdp, "Blocked finish", ["Alex", "Sam"]);
  await savePoints(cdp, "10");

  const beforeFinish = await readActiveState(cdp);
  assert.equal(beforeFinish.storageNoticePresent, true, "the accepted write notice must be visible before finishing");
  assert.equal(beforeFinish.storageNoticeRole, "status");
  assert.equal(beforeFinish.storageNoticeText, WRITE_NOTICE);

  await click(cdp, "[data-action='open-finish']");
  await waitForSelector(cdp, "[data-action='confirm-finish']");
  await click(cdp, "[data-action='confirm-finish']");
  await waitForSelector(cdp, "[data-finished-note]");

  const blockedPodium = await readPodiumBrief(cdp);
  assert.equal(blockedPodium.open, true, "the podium must open even when the finish save failed");
  assert.equal(blockedPodium.focusOnClose, true, "the blocked-save podium must focus its Close button");

  const finished = await readActiveState(cdp);
  assert.equal(finished.eyebrow, "Finished", "finishing must proceed in memory under broken storage");
  assert.equal(finished.finishedNote, FINISHED_NOTE);
  assert.equal(finished.finishedNoteRole, "status");
  assert.deepEqual(finished.totals, ["10", "0"], "in-memory standings stay correct");
  assert.equal(finished.addPointsCount, 0);
  assert.equal(finished.scoreFormPresent, false);
  assert.equal(finished.undoPresent, false);
  assert.equal(finished.storageNoticePresent, true, "the accepted notice must still explain the failed save");
  assert.equal(finished.storageNoticeRole, "status");
  assert.equal(finished.storageNoticeText, WRITE_NOTICE, "no new error path: the write notice copy is unchanged");

  const storage = await readSavedGamesState(cdp, STORAGE_KEY);
  assert.equal(storage.keyCount, 0, "a blocked save must not create the storage key");

  await click(cdp, "[data-action='close-podium']");
  await waitForAbsent(cdp, "[data-podium-dialog]");
  const afterBlockedDismiss = await readActiveState(cdp);
  assert.equal(afterBlockedDismiss.podiumDialogPresent, false, "the blocked-save podium must dismiss cleanly");
  assert.equal(afterBlockedDismiss.focusOnHeading, true, "dismissal must return focus to the heading");
  assert.equal(afterBlockedDismiss.storageNoticePresent, true, "the write notice stays after dismissal");

  await goHome(cdp);
  const home = await readHomeState(cdp);
  assert.equal(home.finishedCards.length, 0, "no phantom finished card may appear on home");
  assert.equal(home.unfinishedCards.length, 0, "no phantom unfinished card may appear on home");
  assert.equal(home.finishedEmptyTitle, "No finished games yet.");
  assert.equal(home.storageNoticePresent, true);
  assert.equal(home.storageNoticeText, WRITE_NOTICE);
  assert.equal(home.horizontalOverflow, false);

  assert.ok(
    warnings.some((warning) => warning.includes("Game save failed")),
    "the failed finish save must log the code-only diagnostic"
  );
  for (const warning of warnings) {
    assert.doesNotMatch(warning, /Alex|Sam|Blocked finish|total 10|points/, "diagnostics must not include names, titles, or scores");
  }
  assert.deepEqual(consoleProblems, [], "blocked storage must not produce uncaught console errors");
}

async function runSuppressedSession(cdp, { consoleProblems, warnings }) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  const rawBefore = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
  assert.equal(rawBefore, "not-json{", "the corrupt seeded payload must be intact before finishing");

  const suppressedHome = await readHomeState(cdp);
  assert.equal(suppressedHome.storageNoticeText, INVALID_NOTICE);
  assert.equal(suppressedHome.unfinishedEmptyTitle, "Saved games can't be shown right now.");

  await createGame(cdp, "Suppressed finish", ["Ada", "Bo"]);
  await savePoints(cdp, "4");

  await click(cdp, "[data-action='open-finish']");
  await waitForSelector(cdp, "[data-action='confirm-finish']");
  await click(cdp, "[data-action='confirm-finish']");
  await waitForSelector(cdp, "[data-finished-note]");

  const suppressedPodium = await readPodiumBrief(cdp);
  assert.equal(suppressedPodium.open, true, "the podium must open under invalid-read suppression");
  assert.equal(suppressedPodium.focusOnClose, true);

  const finished = await readActiveState(cdp);
  assert.equal(finished.eyebrow, "Finished", "finishing proceeds in memory under suppression");
  assert.equal(finished.finishedNote, FINISHED_NOTE);
  assert.equal(finished.addPointsCount, 0);
  assert.equal(finished.scoreFormPresent, false);
  assert.equal(finished.storageNoticeText, INVALID_NOTICE, "the invalid-read notice stays during suppression");

  const rawAfter = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
  assert.equal(rawAfter, rawBefore, "the stored payload must stay byte-identical after finishing under suppression");

  await click(cdp, "[data-action='close-podium']");
  await waitForAbsent(cdp, "[data-podium-dialog]");
  const afterSuppressedDismiss = await readActiveState(cdp);
  assert.equal(afterSuppressedDismiss.podiumDialogPresent, false, "the suppressed podium must dismiss cleanly");
  assert.equal(afterSuppressedDismiss.focusOnHeading, true, "dismissal must return focus to the heading");
  assert.equal(afterSuppressedDismiss.storageNoticePresent, true, "the invalid notice stays after dismissal");
  assert.equal(afterSuppressedDismiss.storageNoticeText, INVALID_NOTICE);

  await goHome(cdp);
  const home = await readHomeState(cdp);
  assert.equal(home.finishedCards.length, 0, "no phantom finished card under suppression");
  assert.equal(home.unfinishedCards.length, 0);
  assert.equal(home.finishedEmptyTitle, "No finished games yet.");
  assert.equal(home.unfinishedEmptyTitle, "Saved games can't be shown right now.");

  assert.ok(
    warnings.some((warning) => warning.includes("Game save failed: invalid")),
    "suppressed finishing must log the code-only invalid diagnostic"
  );
  assert.deepEqual(consoleProblems, [], "suppression must not produce uncaught console errors");
}

async function main() {
  try {
    const mainScreenshots = await runSession("main-flow", runMainFlow);
    assert.equal(typeof mainScreenshots.promptScreenshot, "string");

    await runSession("blocked-write", runBlockedWriteSession, { setupSource: THROWING_SET_ITEM_SOURCE });

    await runSession("suppressed-read", runSuppressedSession, {
      setupSource: `localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, "not-json{");`
    });

    console.log("Browser finish-game test passed: the Finish game opener lives in the active header and the unchanged confirmation renders below the header and above the leaderboard panel (the score panel carries no finish section); cancel keeps scoring and undo fully working with unchanged payload, confirming locks read-only final standings (Finished eyebrow, role=status note, zero Add points/aria-pressed/score panel/undo), opens the dismissible podium dialog focused on its Close button, and after dismissal returns focus to the heading with unchanged standings, the stored game carries status finished with no new fields, the game moves to the Finished games panel with View results reopening read-only (never re-celebrating) and identical ranks/totals after reloads while other games stay untouched, finishing under blocked writes and invalid-read suppression stays in-memory and honest with byte-identical payloads and code-only warnings (podium included and dismissed before navigation), and 320px/keyboard/focus checks pass with the podium opened and dismissed via a real Escape key, no horizontal overflow, and no uncaught console errors.");
    console.log(`Browser evidence screenshots: ${[
      mainScreenshots.promptScreenshot,
      mainScreenshots.podiumScreenshot,
      mainScreenshots.finishedViewScreenshot,
      mainScreenshots.homeScreenshot,
      mainScreenshots.mobilePromptScreenshot,
      mainScreenshots.mobilePodiumScreenshot,
      mainScreenshots.mobileFinishedScreenshot
    ].join(", ")}`);
  } finally {
    await closeServer(server);
  }
}

await main();
