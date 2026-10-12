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
const evidenceDir = await createEvidenceDir("devexpert-play-again");
const server = createStaticServer();
const baseUrl = await listen(server);

const FINISHED_NOTE = "Final standings — this game is finished and can't be scored.";
const WRITE_NOTICE = "Your latest change couldn't be saved. The game still works, and nothing already saved was lost — your next change will try again.";
const NOTHING_TO_UNDO = "Nothing to undo yet.";
const NOT_FINISHED_MESSAGE = "Only finished games can be replayed.";
const INVALID_ROSTER_MESSAGE = "This game's saved players can't be replayed.";

// Scenario 5 session: seed two finished games through the original setItem
// (a valid one and one with a corrupted roster for Scenario 4), then patch
// Storage.prototype.setItem to throw for every later write.
const VALID_FINISHED_SEED = {
  id: "active-game-1728700000000",
  title: "Seeded finals",
  status: "finished",
  createdAt: "2026-10-12T10:00:00.000Z",
  players: [
    { id: "active-game-player-1", name: "Rae", color: "blue", marker: "1", order: 0, total: 12 },
    { id: "active-game-player-2", name: "Lou", color: "red", marker: "2", order: 1, total: -4 }
  ],
  changes: [
    { id: "change-1", playerId: "active-game-player-1", amount: 12 },
    { id: "change-2", playerId: "active-game-player-2", amount: -4 }
  ],
  updatedAt: "2026-10-12T11:00:00.000Z"
};

const CORRUPT_FINISHED_SEED = {
  id: "active-game-1728700100000",
  title: "Corrupt roster",
  status: "finished",
  createdAt: "2026-10-12T10:30:00.000Z",
  players: [
    { id: "seed-player-1", name: "", color: "blue", marker: "1", order: 0, total: 0 },
    { id: "seed-player-2", name: "Lonely", color: "red", marker: "2", order: 1, total: 3 }
  ],
  changes: [],
  updatedAt: "2026-10-12T10:40:00.000Z"
};

const SEEDED_RAW = JSON.stringify({
  version: 1,
  games: [VALID_FINISHED_SEED, CORRUPT_FINISHED_SEED]
});

const SEED_THEN_BLOCK_SET_ITEM_SOURCE = `
  (() => {
    const original = Storage.prototype.setItem;
    original.call(localStorage, ${JSON.stringify(STORAGE_KEY)}, ${JSON.stringify(SEEDED_RAW)});
    Object.defineProperty(Storage.prototype, "setItem", {
      value: function setItem() {
        throw new Error("Storage is blocked in this test session.");
      },
      writable: true,
      configurable: true
    });
  })();
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
      unfinishedEmptyTitle: unfinished?.querySelector(".empty-state .empty-title")?.textContent?.trim() ?? null,
      retentionVisible: (() => {
        const node = document.querySelector(".retention-note");
        return Boolean(node && node.clientHeight > 0 && node.offsetParent !== null);
      })(),
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
    tokens: [...document.querySelectorAll(".active-player .player-token")].map((node) => ({
      className: node.className,
      text: node.textContent.trim(),
      label: node.getAttribute("aria-label")
    })),
    addPointsCount: document.querySelectorAll(".add-points-action").length,
    selectedRowCount: document.querySelectorAll(".active-player.is-selected").length,
    selectedRowAriaPressed: [...document.querySelectorAll(".add-points-action")].map((button) => button.getAttribute("aria-pressed")),
    scoreFormPresent: Boolean(document.querySelector("[data-score-form]")),
    undoPresent: Boolean(document.querySelector("[data-action='undo-last-score']")),
    finishSectionPresent: Boolean(document.querySelector("[data-finish-section]")),
    playAgainPresent: Boolean(document.querySelector("[data-action='play-again']")),
    feedback: document.querySelector("#score-feedback")?.textContent?.trim() ?? "",
    replayFeedback: document.querySelector("#replay-feedback")?.textContent?.trim() ?? null,
    replayFeedbackLive: document.querySelector("#replay-feedback")?.getAttribute("aria-live") ?? null,
    finishedNote: document.querySelector("[data-finished-note]")?.textContent?.trim() ?? null,
    finishedNoteRole: document.querySelector("[data-finished-note]")?.getAttribute("role") ?? null,
    storageNoticePresent: Boolean(document.querySelector("[data-storage-notice]")),
    storageNoticeRole: document.querySelector("[data-storage-notice]")?.getAttribute("role") ?? null,
    storageNoticeText: document.querySelector("[data-storage-notice]")?.textContent?.trim() ?? "",
    podiumDialogPresent: Boolean(document.querySelector("[data-podium-dialog]")),
    podiumOpen: Boolean(document.querySelector("[data-podium-dialog]")?.open),
    focusOnHeading: Boolean(document.activeElement?.hasAttribute?.("data-active-heading")),
    focusAction: document.activeElement?.dataset?.action ?? null,
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
  }));
}

async function readPlayAgainButton(cdp) {
  return evaluate(cdp, () => {
    const button = document.querySelector("[data-action='play-again']");
    const section = document.querySelector(".replay-section");
    const standings = document.querySelector(".active-roster");

    if (!button || !section) {
      return { present: false };
    }

    const rect = button.getBoundingClientRect();

    return {
      present: true,
      label: button.textContent.trim(),
      type: button.getAttribute("type"),
      className: button.className,
      inRosterPanel: Boolean(section.closest(".roster-panel")),
      afterStandings: Boolean(
        standings && (standings.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING)
      ),
      height: rect.height,
      width: rect.width,
      visible: rect.height > 0 && button.offsetParent !== null
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

function assertCodeOnlyDiagnostics({ warnings, consoleProblems }, sessionLabel) {
  for (const warning of warnings) {
    assert.doesNotMatch(
      warning,
      /Alex|Sam|Jamie|Ada|Bo|Rae|Lou|Championship|League|Pocket|Seeded finals|Corrupt roster|total|points/i,
      `${sessionLabel} diagnostics must stay code-only`
    );
  }
  assert.deepEqual(consoleProblems, [], `${sessionLabel} must not produce uncaught console errors`);
}

// Sessions A: the full MVP flow through replay at desktop size (Scenarios 1,
// 2, and the desktop half of 6) plus separation with byte-identical payload
// checks (Scenario 2).
async function runDesktopFullFlow(cdp, { consoleProblems }) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  const freshHome = await readHomeState(cdp);
  assert.equal(freshHome.unfinishedCards.length, 0);
  assert.equal(freshHome.finishedCards.length, 0);
  assert.equal(freshHome.horizontalOverflow, false);

  // The MVP loop: create, score signed points, undo, finish, podium, replay.
  await createGame(cdp, "Championship cup", ["Alex", "Sam", "Jamie"]);
  await savePoints(cdp, "10");
  await click(cdp, "[data-player-id='active-game-player-2'] .add-points-action");
  await savePoints(cdp, "5");
  await click(cdp, "[data-player-id='active-game-player-3'] .add-points-action");
  await savePoints(cdp, "7");
  await click(cdp, "[data-action='undo-last-score']");
  await waitForSelector(cdp, "[data-action='undo-last-score']");
  const activeBeforeFinish = await readActiveState(cdp);
  assert.equal(activeBeforeFinish.feedback, "Undid 7 points for Jamie. New total: 0. Rank: 3.");
  assert.deepEqual(activeBeforeFinish.totals, ["10", "5", "0"]);

  await click(cdp, "[data-action='open-finish']");
  await waitForSelector(cdp, "[data-action='confirm-finish']");
  await click(cdp, "[data-action='confirm-finish']");
  await waitForSelector(cdp, "[data-finished-note]");
  const podium = await readActiveState(cdp);
  assert.equal(podium.podiumOpen, true, "confirming the finish must open the podium once");
  await click(cdp, "[data-action='close-podium']");
  await waitForAbsent(cdp, "[data-podium-dialog]");

  const finishedView = await readActiveState(cdp);
  assert.equal(finishedView.eyebrow, "Finished");
  assert.equal(finishedView.finishedNote, FINISHED_NOTE);
  assert.equal(finishedView.finishedNoteRole, "status");
  assert.deepEqual(finishedView.totals, ["10", "5", "0"]);
  assert.deepEqual(finishedView.ranks, ["1", "2", "3"]);
  assert.equal(finishedView.playAgainPresent, true, "the finished view must offer Play again");
  assert.equal(finishedView.addPointsCount, 0);
  assert.equal(finishedView.scoreFormPresent, false);
  assert.equal(finishedView.undoPresent, false);
  assert.equal(finishedView.finishSectionPresent, false);
  assert.equal(finishedView.replayFeedbackLive, "polite", "the replay feedback region must be a polite live region");
  assert.equal(finishedView.replayFeedback, "", "the replay feedback region must start empty");

  const playAgainButton = await readPlayAgainButton(cdp);
  assert.equal(playAgainButton.present, true);
  assert.equal(playAgainButton.label, "Play again", "the visible text must be the accessible name");
  assert.equal(playAgainButton.type, "button");
  assert.equal(playAgainButton.inRosterPanel, true, "Play again must live inside the roster panel");
  assert.equal(playAgainButton.afterStandings, true, "Play again must sit below the standings list");
  assert.ok(playAgainButton.height >= 44, "Play again needs a roughly 44px target");
  assert.ok(playAgainButton.width >= 44);
  assert.equal(playAgainButton.visible, true);

  const storedBefore = await readSavedGamesState(cdp, STORAGE_KEY);
  const parsedBefore = JSON.parse(storedBefore.raw);
  assert.equal(parsedBefore.games.length, 1, "only the finished game exists before replay");
  const originalId = parsedBefore.games[0].id;
  assert.ok(originalId.startsWith("active-game-"));
  const originalEntryBefore = JSON.stringify(parsedBefore.games[0]);

  // Scenario 1: Play again copies presentation and resets scores and history.
  await click(cdp, "[data-action='play-again']");
  await waitForSelector(cdp, "#score-amount");

  const replay = await readActiveState(cdp);
  assert.equal(replay.eyebrow, "In progress", "the replay must open as a scorable active game");
  assert.equal(replay.heading, "Championship cup", "the title must copy verbatim");
  assert.deepEqual(replay.names, ["Alex", "Sam", "Jamie"]);
  assert.deepEqual(replay.totals, ["0", "0", "0"], "every replay total must restart at zero");
  assert.deepEqual(replay.ranks, ["1", "1", "1"], "zero totals share rank 1 in creation order");
  assert.deepEqual(replay.tokens, finishedView.tokens, "marker classes, numerals, and labels must copy literally");
  assert.equal(replay.addPointsCount, 3);
  assert.equal(replay.selectedRowCount, 1, "the first player must be selected");
  assert.equal(replay.selectedRowAriaPressed[0], "true");
  assert.equal(replay.scoreFormPresent, true);
  assert.equal(replay.undoPresent, true);
  assert.equal(replay.finishSectionPresent, true);
  assert.equal(replay.playAgainPresent, false, "the active scoring view must not offer Play again");
  assert.equal(replay.podiumDialogPresent, false, "the replay must not celebrate");
  assert.equal(replay.focusOnHeading, true, "focus must land on the new game's heading");
  assert.equal(replay.horizontalOverflow, false);
  const replayScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-replay-active.png"));

  await click(cdp, "[data-action='undo-last-score']");
  const afterReplayUndo = await readActiveState(cdp);
  assert.equal(afterReplayUndo.feedback, NOTHING_TO_UNDO, "the replay must not copy undo history");
  assert.deepEqual(afterReplayUndo.totals, ["0", "0", "0"]);

  // Scenario 2: the replay is a separate game and the original stays unchanged.
  const storedAfterReplay = await readSavedGamesState(cdp, STORAGE_KEY);
  assert.equal(storedAfterReplay.gameCount, 2, "the replay must append a second stored game");
  const replayId = storedAfterReplay.savedIds.find((id) => id !== originalId);
  assert.ok(replayId, "the replay must have its own id");
  assert.ok(replayId.startsWith("replay-game-"), "replay ids must come from the replay-game seed");
  assert.deepEqual(storedAfterReplay.savedIds.sort(), [originalId, replayId].sort());
  const parsedAfterReplay = JSON.parse(storedAfterReplay.raw);
  const replayEntry = parsedAfterReplay.games.find((game) => game.id === replayId);
  assert.equal(replayEntry.status, "active");
  assert.equal(replayEntry.title, "Championship cup");
  assert.ok(!("changes" in replayEntry), "the stored replay must not carry a change log");
  assert.ok(replayEntry.players.every((player) => player.total === 0));
  assert.deepEqual(
    replayEntry.players.map((player) => [player.name, player.color, player.marker, player.order]),
    parsedBefore.games[0].players.map((player) => [player.name, player.color, player.marker, player.order]),
    "the stored replay must copy the presentation of the original's roster"
  );
  assert.equal(typeof replayEntry.updatedAt, "string", "the replay entry gets its own storage-owned updatedAt");
  assertOriginalEntryByteIdentical(storedAfterReplay.raw, originalId, originalEntryBefore, "after replay");

  await savePoints(cdp, "5");
  const afterReplayScore = await readActiveState(cdp);
  assert.equal(afterReplayScore.feedback, "Added 5 points to Alex. New total: 5. Rank: 1.");
  assert.deepEqual(afterReplayScore.totals, ["5", "0", "0"]);

  const storedAfterScore = await readSavedGamesState(cdp, STORAGE_KEY);
  assertOriginalEntryByteIdentical(storedAfterScore.raw, originalId, originalEntryBefore, "after scoring the replay");
  const parsedAfterScore = JSON.parse(storedAfterScore.raw);
  const scoredReplayEntry = parsedAfterScore.games.find((game) => game.id === replayId);
  assert.equal(scoredReplayEntry.changes.length, 1, "the replay writes its own change log");
  assert.equal(scoredReplayEntry.changes[0].amount, 5);

  // Reload: home lists the finished original and the replay independently.
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");
  const homeAfterReplay = await readHomeState(cdp);
  assert.equal(homeAfterReplay.finishedCards.length, 1);
  assert.equal(homeAfterReplay.finishedCards[0].gameId, originalId);
  assert.equal(homeAfterReplay.finishedCards[0].actionLabel, "View results Championship cup");
  assert.equal(homeAfterReplay.unfinishedCards.length, 1);
  assert.equal(homeAfterReplay.unfinishedCards[0].gameId, replayId);
  assert.equal(homeAfterReplay.unfinishedCards[0].actionLabel, "Resume Championship cup");
  assert.equal(homeAfterReplay.horizontalOverflow, false);
  const homeScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-home-after-replay.png"));

  await click(cdp, `[data-action='view-results'][data-game-id='${originalId}']`);
  await waitForSelector(cdp, "[data-finished-note]");
  const reopenedOriginal = await readActiveState(cdp);
  assert.deepEqual(reopenedOriginal.totals, ["10", "5", "0"], "the original's final totals must be unchanged");
  assert.deepEqual(reopenedOriginal.ranks, ["1", "2", "3"]);
  assert.equal(reopenedOriginal.finishedNote, FINISHED_NOTE);
  assert.equal(reopenedOriginal.podiumDialogPresent, false, "View results must not re-celebrate");

  await goHome(cdp);
  await click(cdp, `[data-action='resume-game'][data-game-id='${replayId}']`);
  await waitForSelector(cdp, "#score-amount");
  const resumedReplay = await readActiveState(cdp);
  assert.deepEqual(resumedReplay.totals, ["5", "0", "0"], "the replay keeps its own totals");
  assert.deepEqual(resumedReplay.ranks, ["1", "2", "2"], "the tied zero totals share rank 2");

  assert.deepEqual(consoleProblems, [], "the desktop full flow must not produce uncaught console errors");
  return { replayScreenshot, homeScreenshot };
}

// Session B: replay from a reopened finished game and repeated replays
// (Scenario 3).
async function runRepeatedReplays(cdp, { consoleProblems }) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  await createGame(cdp, "League night", ["Ada", "Bo"]);
  await savePoints(cdp, "4");

  await click(cdp, "[data-action='open-finish']");
  await waitForSelector(cdp, "[data-action='confirm-finish']");
  await click(cdp, "[data-action='confirm-finish']");
  await waitForSelector(cdp, "[data-finished-note]");
  await click(cdp, "[data-action='close-podium']");
  await waitForAbsent(cdp, "[data-podium-dialog]");
  await goHome(cdp);

  const homeBefore = await readHomeState(cdp);
  const originalId = homeBefore.finishedCards[0].gameId;

  // Reopen the finished game via View results: no podium, and Play again works.
  await click(cdp, `[data-action='view-results'][data-game-id='${originalId}']`);
  await waitForSelector(cdp, "[data-finished-note]");
  const reopened = await readActiveState(cdp);
  assert.equal(reopened.podiumDialogPresent, false, "reopening a finished game must never re-celebrate");
  assert.equal(reopened.playAgainPresent, true);

  await click(cdp, "[data-action='play-again']");
  await waitForSelector(cdp, "#score-amount");
  const firstReplay = await readActiveState(cdp);
  assert.equal(firstReplay.heading, "League night");
  assert.deepEqual(firstReplay.names, ["Ada", "Bo"]);
  assert.deepEqual(firstReplay.totals, ["0", "0"]);
  assert.equal(firstReplay.podiumDialogPresent, false);

  await savePoints(cdp, "2");
  const storedAfterFirstReplay = await readSavedGamesState(cdp, STORAGE_KEY);
  const firstReplayId = storedAfterFirstReplay.savedIds.find((id) => id !== originalId);
  assert.ok(firstReplayId?.startsWith("replay-game-"), "the first replay needs its own replay-game id");

  // Finish the first replay and replay again from its finished view.
  await click(cdp, "[data-action='open-finish']");
  await waitForSelector(cdp, "[data-action='confirm-finish']");
  await click(cdp, "[data-action='confirm-finish']");
  await waitForSelector(cdp, "[data-finished-note]");
  await click(cdp, "[data-action='close-podium']");
  await waitForAbsent(cdp, "[data-podium-dialog]");

  await click(cdp, "[data-action='play-again']");
  await waitForSelector(cdp, "#score-amount");
  const secondReplay = await readActiveState(cdp);
  assert.equal(secondReplay.heading, "League night");
  assert.deepEqual(secondReplay.names, ["Ada", "Bo"]);
  assert.deepEqual(secondReplay.totals, ["0", "0"]);
  assert.deepEqual(secondReplay.ranks, ["1", "1"]);
  assert.equal(secondReplay.focusOnHeading, true);

  await goHome(cdp);
  const homeAfter = await readHomeState(cdp);
  assert.equal(homeAfter.unfinishedCards.length, 1, "the second replay stays unfinished");
  assert.equal(homeAfter.finishedCards.length, 2, "the original and the first replay are finished");
  const secondReplayId = homeAfter.unfinishedCards[0].gameId;
  const finishedIds = homeAfter.finishedCards.map((card) => card.gameId).sort();
  assert.deepEqual(finishedIds, [originalId, firstReplayId].sort());
  const allIds = new Set([originalId, firstReplayId, secondReplayId]);
  assert.equal(allIds.size, 3, "every replay must create an independent game id");
  assert.ok(firstReplayId !== secondReplayId, "repeated replays must not collide");

  const stored = await readSavedGamesState(cdp, STORAGE_KEY);
  assert.equal(stored.gameCount, 3);
  assert.equal(new Set(stored.savedIds).size, 3, "each game must be stored exactly once");
  const parsed = JSON.parse(stored.raw);
  for (const entry of parsed.games) {
    assert.deepEqual(
      entry.players.map((player) => [player.name, player.color, player.marker]),
      [["Ada", "blue", "1"], ["Bo", "red", "2"]],
      "every presentation copy must hold"
    );
  }
  const finishedEntries = parsed.games.filter((game) => game.status === "finished");
  assert.equal(finishedEntries.length, 2);
  assert.ok(finishedEntries.every((entry) => entry.changes.length > 0), "finished games keep their own logs");
  const unfinishedEntry = parsed.games.find((game) => game.id === secondReplayId);
  assert.ok(!("changes" in unfinishedEntry), "the fresh replay carries no change log");

  // Each home card opens the right game: View results and Resume once each.
  await click(cdp, `[data-action='view-results'][data-game-id='${firstReplayId}']`);
  await waitForSelector(cdp, "[data-finished-note]");
  const reopenedFirstReplay = await readActiveState(cdp);
  assert.deepEqual(reopenedFirstReplay.totals, ["2", "0"], "the first replay keeps its own scored totals");

  await goHome(cdp);
  await click(cdp, `[data-action='resume-game'][data-game-id='${secondReplayId}']`);
  await waitForSelector(cdp, "#score-amount");
  const resumedSecondReplay = await readActiveState(cdp);
  assert.deepEqual(resumedSecondReplay.totals, ["0", "0"]);
  const homeScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-repeated-replays-home.png"));

  assert.deepEqual(consoleProblems, [], "the repeated-replays session must not produce uncaught console errors");
  return { homeScreenshot };
}

// Session C: replay under blocked writes stays honest (Scenario 5) and a
// corrupted stored roster is refused visibly (Scenario 4).
async function runBlockedWriteAndGuards(cdp, { consoleProblems, warnings }) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  const home = await readHomeState(cdp);
  assert.equal(home.finishedCards.length, 2, "both seeded finished games must load");
  assert.equal(home.unfinishedCards.length, 0);
  assert.equal(home.storageNoticePresent, false, "a clean read shows no notice");
  const corruptCard = home.finishedCards.find((card) => card.title === "Corrupt roster");
  const validCard = home.finishedCards.find((card) => card.title === "Seeded finals");
  assert.ok(corruptCard && validCard);

  // Scenario 4: a corrupted roster is refused honestly, with nothing touched.
  await click(cdp, `[data-action='view-results'][data-game-id='${corruptCard.gameId}']`);
  await waitForSelector(cdp, "[data-finished-note]");
  const corruptView = await readActiveState(cdp);
  assert.equal(corruptView.heading, "Corrupt roster");
  assert.deepEqual(corruptView.names, ["Lonely", ""], "the stored corrupt roster renders as-is in rank order");

  await click(cdp, "[data-action='play-again']");
  await waitForSelector(cdp, "#replay-feedback");
  const corruptRefusal = await readActiveState(cdp);
  assert.equal(corruptRefusal.replayFeedback, INVALID_ROSTER_MESSAGE, "the refusal must be explained politely");
  assert.equal(corruptRefusal.replayFeedbackLive, "polite");
  assert.equal(corruptRefusal.heading, "Corrupt roster", "the finished view must stay intact");
  assert.equal(corruptRefusal.names.length, 2, "the finished standings must remain visible");
  assert.equal(corruptRefusal.playAgainPresent, true, "the control stays available for a fixed game");
  assert.equal(corruptRefusal.storageNoticePresent, false, "a refused replay must not fabricate a storage failure");

  const storedAfterRefusal = await readSavedGamesState(cdp, STORAGE_KEY);
  assert.equal(storedAfterRefusal.raw, SEEDED_RAW, "storage must stay byte-identical after the refusal");
  assert.ok(
    warnings.some((warning) => warning.includes("Game replay failed: invalid-roster")),
    "the refused replay must log the code-only diagnostic"
  );

  // Scenario 5: the valid seeded finished game replays in memory while every
  // write fails; the notice appears and the payload stays byte-identical.
  await goHome(cdp);
  await click(cdp, `[data-action='view-results'][data-game-id='${validCard.gameId}']`);
  await waitForSelector(cdp, "[data-finished-note]");
  await click(cdp, "[data-action='play-again']");
  await waitForSelector(cdp, "#score-amount");

  const inMemoryReplay = await readActiveState(cdp);
  assert.equal(inMemoryReplay.heading, "Seeded finals");
  assert.deepEqual(inMemoryReplay.names, ["Rae", "Lou"]);
  assert.deepEqual(inMemoryReplay.totals, ["0", "0"]);
  assert.equal(inMemoryReplay.storageNoticePresent, true, "the failed replay save must show the accepted notice");
  assert.equal(inMemoryReplay.storageNoticeRole, "status");
  assert.equal(inMemoryReplay.storageNoticeText, WRITE_NOTICE, "no new error path: the write notice copy is unchanged");

  await savePoints(cdp, "5");
  const scoredInMemory = await readActiveState(cdp);
  assert.equal(scoredInMemory.feedback, "Added 5 points to Rae. New total: 5. Rank: 1.",
    "scoring the replay must keep working in memory");
  assert.deepEqual(scoredInMemory.totals, ["5", "0"]);
  assert.equal(scoredInMemory.storageNoticeText, WRITE_NOTICE);

  await click(cdp, "[data-action='undo-last-score']");
  const undoneInMemory = await readActiveState(cdp);
  assert.equal(undoneInMemory.feedback, "Undid 5 points for Rae. New total: 0. Rank: 1.",
    "undo must keep working in memory");
  assert.deepEqual(undoneInMemory.totals, ["0", "0"]);

  const storedAfterBlocked = await readSavedGamesState(cdp, STORAGE_KEY);
  assert.equal(storedAfterBlocked.raw, SEEDED_RAW, "blocked writes must leave the stored payload byte-identical");
  assert.equal(storedAfterBlocked.gameCount, 2);

  await goHome(cdp);
  const homeAfterBlocked = await readHomeState(cdp);
  assert.equal(homeAfterBlocked.unfinishedCards.length, 0, "no phantom unfinished card may appear");
  assert.equal(homeAfterBlocked.finishedCards.length, 2, "the seeded finished games stay listed");
  assert.equal(homeAfterBlocked.storageNoticePresent, true);
  assert.equal(homeAfterBlocked.storageNoticeText, WRITE_NOTICE);
  assert.equal(homeAfterBlocked.horizontalOverflow, false);
  const noticeScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-blocked-write-replay-notice.png"));

  assert.ok(
    warnings.some((warning) => warning.includes("Game save failed: write")),
    "the blocked replay save must log the code-only diagnostic"
  );
  assertCodeOnlyDiagnostics({ warnings, consoleProblems }, "blocked-write replay");
  return { noticeScreenshot };
}

// Session D: the full MVP flow through replay at 320px with real keys
// (Scenario 6).
async function runMobileFullFlow(cdp, { consoleProblems }) {
  await setViewport(cdp, { width: 320, height: 720, mobile: true });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  const freshHome = await readHomeState(cdp);
  assert.equal(freshHome.horizontalOverflow, false);
  assert.equal(freshHome.retentionVisible, true);

  await createGame(cdp, "Pocket rematch", ["Ada", "Bo"]);
  await savePoints(cdp, "3");
  await click(cdp, "[data-action='undo-last-score']");
  const afterUndo = await readActiveState(cdp);
  assert.equal(afterUndo.feedback, "Undid 3 points for Ada. New total: 0. Rank: 1.");
  assert.deepEqual(afterUndo.totals, ["0", "0"]);
  await savePoints(cdp, "3");

  await click(cdp, "[data-action='open-finish']");
  await waitForSelector(cdp, "[data-action='confirm-finish']");
  await click(cdp, "[data-action='confirm-finish']");
  await waitForSelector(cdp, "[data-finished-note]");
  const mobilePodium = await readActiveState(cdp);
  assert.equal(mobilePodium.podiumOpen, true, "the podium must open at 320px");
  await pressEscape(cdp);
  await waitForAbsent(cdp, "[data-podium-dialog]");

  const mobileFinished = await readActiveState(cdp);
  assert.equal(mobileFinished.eyebrow, "Finished");
  assert.equal(mobileFinished.finishedNoteRole, "status");
  assert.equal(mobileFinished.finishedNote, FINISHED_NOTE);
  assert.equal(mobileFinished.playAgainPresent, true);
  assert.equal(mobileFinished.horizontalOverflow, false, "the finished view must not overflow at 320px");

  const button = await readPlayAgainButton(cdp);
  assert.ok(button.height >= 44, "Play again needs a roughly 44px target at 320px");
  assert.ok(button.width >= 44);
  assert.equal(button.visible, true);

  // Real-keyboard walk: Tab from the heading reaches Play again with visible
  // focus, then Space activates it (Enter/Space keyboard operability). The
  // All games control precedes the heading in DOM order, so forward Tab from
  // the heading reaches the replay control next.
  await pressTab(cdp);
  const tabState = await evaluate(cdp, () => {
    const style = getComputedStyle(document.activeElement);
    return {
      action: document.activeElement?.dataset?.action ?? "",
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth
    };
  });
  assert.equal(tabState.action, "play-again", "Tab must reach Play again from the heading");
  assert.notEqual(tabState.outlineStyle, "none", "keyboard focus must show a visible outline");
  assert.notEqual(tabState.outlineWidth, "0px");

  await pressSpace(cdp);
  await waitForSelector(cdp, "#score-amount");
  const mobileReplay = await readActiveState(cdp);
  assert.equal(mobileReplay.heading, "Pocket rematch");
  assert.equal(mobileReplay.eyebrow, "In progress");
  assert.deepEqual(mobileReplay.names, ["Ada", "Bo"]);
  assert.deepEqual(mobileReplay.totals, ["0", "0"]);
  assert.deepEqual(mobileReplay.ranks, ["1", "1"]);
  assert.equal(mobileReplay.focusOnHeading, true, "the Space activation must land focus on the new heading");
  assert.equal(mobileReplay.podiumDialogPresent, false);
  assert.equal(mobileReplay.horizontalOverflow, false, "the replay view must not overflow at 320px");
  const mobileReplayScreenshot = await screenshot(cdp, path.join(evidenceDir, "mobile-replay-320px.png"));

  // Reload at 320px: both games are listed separately on home.
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");
  const mobileHome = await readHomeState(cdp);
  assert.equal(mobileHome.finishedCards.length, 1);
  assert.equal(mobileHome.unfinishedCards.length, 1);
  assert.notEqual(mobileHome.finishedCards[0].gameId, mobileHome.unfinishedCards[0].gameId);
  assert.equal(mobileHome.horizontalOverflow, false);
  assert.equal(mobileHome.retentionVisible, true);
  const mobileHomeScreenshot = await screenshot(cdp, path.join(evidenceDir, "mobile-home-after-replay-320px.png"));

  await click(cdp, `[data-action='resume-game'][data-game-id='${mobileHome.unfinishedCards[0].gameId}']`);
  await waitForSelector(cdp, "#score-amount");
  const resumedMobile = await readActiveState(cdp);
  assert.deepEqual(resumedMobile.totals, ["0", "0"]);

  assert.deepEqual(consoleProblems, [], "the mobile flow must not produce uncaught console errors");
  return { mobileReplayScreenshot, mobileHomeScreenshot };
}

async function main() {
  try {
    const desktop = await runSession("desktop-full-flow", runDesktopFullFlow);
    assert.equal(typeof desktop.replayScreenshot, "string");

    const repeated = await runSession("repeated-replays", runRepeatedReplays);

    const blocked = await runSession("blocked-write-and-guards", runBlockedWriteAndGuards, {
      setupSource: SEED_THEN_BLOCK_SET_ITEM_SOURCE
    });

    const mobile = await runSession("mobile-full-flow", runMobileFullFlow);

    console.log("Browser play-again test passed: the full MVP loop (create, signed scoring, undo, finish, podium, Play again) works at 1280x800 and 320x720 with the replay opening as a scorable active game that copies the title, names, colors, and markers literally while every total restarts at zero with shared rank 1 and no undo history ('Nothing to undo yet.'); the replay is a separate game with distinct replay-game-* ids whose stored entry has its own updatedAt and no change log, while the finished original's stored entry stays byte-identical across replay and replay-game scoring and home lists both games independently after reload; reopening a finished game never re-celebrates and repeated replays create distinct games (1 unfinished + 2 finished listed exactly once each); a corrupted stored roster is refused with the polite 'This game's saved players can't be replayed.' live-region message and byte-identical storage; and under blocked writes the replay, scoring, and undo keep working in memory with the accepted role=status write notice, code-only 'Game save failed: write'/'Game replay failed: invalid-roster' warnings, no phantom cards, and no uncaught console errors.");
    console.log(`Browser evidence screenshots: ${[
      desktop.replayScreenshot,
      desktop.homeScreenshot,
      repeated.homeScreenshot,
      blocked.noticeScreenshot,
      mobile.mobileReplayScreenshot,
      mobile.mobileHomeScreenshot
    ].join(", ")}`);
  } finally {
    await closeServer(server);
  }
}

await main();
