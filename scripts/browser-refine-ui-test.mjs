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
const evidenceDir = await createEvidenceDir("devexpert-refine-podium-and-history-modal");
const server = createStaticServer();
const baseUrl = await listen(server);

const PLAYER_COLORS = ["blue", "red", "yellow", "green", "orange", "white", "black"];

function seededPlayers(id, names, totals) {
  return names.map((name, index) => ({
    id: `${id}-player-${index + 1}`,
    name,
    color: PLAYER_COLORS[index % PLAYER_COLORS.length],
    marker: String(index + 1),
    order: index,
    total: totals[index] ?? 0
  }));
}

function seededGame({ id, title, status = "active", createdAt, updatedAt, names, totals, changes = [] }) {
  return {
    id,
    title,
    status,
    createdAt,
    updatedAt,
    players: seededPlayers(id, names, totals),
    changes
  };
}

function seedSource(games) {
  return `
    if (!sessionStorage.getItem("refine-ui-seed-applied")) {
      sessionStorage.setItem("refine-ui-seed-applied", "1");
      localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, ${JSON.stringify(JSON.stringify({ version: 1, games }))});
    }
  `;
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

async function createGame(cdp, title, names) {
  await click(cdp, "[data-action='new-game']");
  await waitForSelector(cdp, "#game-title");
  if (title !== null) {
    await fill(cdp, "#game-title", title);
  }
  for (let index = 2; index < names.length; index += 1) {
    await click(cdp, "[data-action='add-player']");
  }
  for (let index = 0; index < names.length; index += 1) {
    await fill(cdp, `#player-name-${index + 1}`, names[index]);
  }
  await click(cdp, "[data-roster-form] button[type='submit']");
  await waitForSelector(cdp, "#score-amount");
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

async function clickCounter(cdp, amount) {
  const selector = `[data-action='apply-quick-score'][data-amount='${amount}']`;
  // Focus first like a real pointer activation; staging never re-renders.
  await evaluate(cdp, (targetSelector) => document.querySelector(targetSelector)?.focus(), selector);
  await click(cdp, selector);
}

async function finishWithPodium(cdp) {
  await click(cdp, "[data-action='open-finish']");
  await waitForSelector(cdp, "[data-action='confirm-finish']");
  await click(cdp, "[data-action='confirm-finish']");
  await waitForSelector(cdp, "[data-podium-dialog]");
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

async function readHistoryDialog(cdp) {
  return evaluate(cdp, () => {
    const dialog = document.querySelector("[data-history-dialog]");
    const list = dialog?.querySelector(".saved-game-list");
    const cards = [...(dialog?.querySelectorAll(".saved-game") ?? [])];
    const close = dialog?.querySelector("[data-action='close-history']");
    const cardRects = cards.map((card) => card.getBoundingClientRect());

    return {
      present: Boolean(dialog),
      open: Boolean(dialog?.open),
      labelledBy: dialog?.getAttribute("aria-labelledby") ?? null,
      describedBy: dialog?.getAttribute("aria-describedby") ?? null,
      title: dialog?.querySelector("#history-dialog-title")?.textContent?.trim() ?? null,
      count: dialog?.querySelector("#history-dialog-count")?.textContent?.trim() ?? null,
      listLabel: list?.getAttribute("aria-label") ?? null,
      listId: list?.id ?? null,
      cardTitles: cards.map((card) => card.querySelector(".saved-game-title")?.textContent?.trim() ?? ""),
      cardIds: cards.map((card) => card.dataset.savedGameId ?? ""),
      resumeLabels: [...(dialog?.querySelectorAll("[data-action='resume-game']") ?? [])]
        .map((button) => button.getAttribute("aria-label")),
      resultLabels: [...(dialog?.querySelectorAll("[data-action='view-results']") ?? [])]
        .map((button) => button.getAttribute("aria-label")),
      closeLabel: close?.getAttribute("aria-label") ?? null,
      closeHeight: close?.getBoundingClientRect().height ?? 0,
      closeWidth: close?.getBoundingClientRect().width ?? 0,
      focusOnClose: document.activeElement !== null && document.activeElement === close,
      focusInsideDialog: Boolean(dialog && document.activeElement && dialog.contains(document.activeElement)),
      dialogScroll: dialog ? { scrollHeight: dialog.scrollHeight, clientHeight: dialog.clientHeight } : null,
      cardColumns: cards[0] ? getComputedStyle(cards[0]).gridTemplateColumns.split(" ").length : 0,
      cardWidths: cardRects.map((rect) => Math.round(rect.width)),
      bodyWidth: Math.round(dialog?.querySelector(".history-dialog-body")?.getBoundingClientRect().width ?? 0),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
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

async function waitForAbsent(cdp, selector) {
  const deadline = Date.now() + 5000;

  while (Date.now() < deadline) {
    const present = await evaluate(cdp, (targetSelector) => Boolean(document.querySelector(targetSelector)), selector);
    if (!present) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
  }

  throw new Error(`Timed out waiting for removal: ${selector}`);
}

async function readDashboard(cdp) {
  return evaluate(cdp, () => {
    const panelFor = (id) => document.querySelector(`article[aria-labelledby='${id}-title']`);
    const titles = (root) => [...(root?.querySelectorAll(".saved-game-title") ?? [])].map((node) => node.textContent.trim());
    const openerFor = (action) => {
      const button = document.querySelector(`[data-action='${action}']`);
      return button ? {
        text: button.textContent.trim(),
        label: button.getAttribute("aria-label"),
        haspopup: button.getAttribute("aria-haspopup"),
        expanded: button.getAttribute("aria-expanded"),
        controls: button.getAttribute("aria-controls"),
        height: button.getBoundingClientRect().height,
        width: button.getBoundingClientRect().width,
        focused: document.activeElement === button
      } : null;
    };
    const grid = document.querySelector(".dashboard-grid");
    const gridStyle = grid ? getComputedStyle(grid) : null;
    const before = grid ? getComputedStyle(grid, "::before") : null;
    const after = grid ? getComputedStyle(grid, "::after") : null;
    const first = grid?.children[0]?.getBoundingClientRect() ?? null;
    const second = grid?.children[1]?.getBoundingClientRect() ?? null;
    const hero = document.querySelector(".hero-panel");
    const heroRect = hero?.getBoundingClientRect() ?? null;
    const gridRect = grid?.getBoundingClientRect() ?? null;
    const appRoot = document.querySelector("[data-app-root]");
    const appRootStyle = appRoot ? getComputedStyle(appRoot) : null;

    return {
      unfinishedTitles: titles(panelFor("unfinished")),
      finishedTitles: titles(panelFor("finished")),
      unfinishedOpener: openerFor("view-all-unfinished"),
      finishedOpener: openerFor("view-all-finished"),
      heroPillPresent: document.body.textContent.includes("Local to this browser"),
      retentionNote: document.querySelector(".retention-note")?.textContent?.trim() ?? null,
      columnGap: gridStyle?.columnGap ?? null,
      rowGap: gridStyle?.rowGap ?? null,
      topGap: appRootStyle?.rowGap ?? null,
      heroToDashboardGap: heroRect && gridRect ? Math.round(gridRect.top - heroRect.bottom) : null,
      gridBorderTopWidth: gridStyle?.borderTopWidth ?? null,
      beforeContent: before?.content ?? null,
      afterContent: after?.content ?? null,
      columns: gridStyle ? gridStyle.gridTemplateColumns.split(" ").length : 0,
      stacked: Boolean(first && second && second.top >= first.bottom),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
}

async function readActiveState(cdp) {
  return evaluate(cdp, () => ({
    selectedName: document.querySelector(".active-player.is-selected .active-player-name")?.textContent?.trim() ?? null,
    pressed: [...document.querySelectorAll(".add-points-action")].map((button) => button.getAttribute("aria-pressed")),
    focusId: document.activeElement?.id ?? null,
    focusAction: document.activeElement?.dataset?.action ?? null,
    focusAmount: document.activeElement?.dataset?.amount ?? null,
    inputValue: document.querySelector("#score-amount")?.value ?? null,
    totals: [...document.querySelectorAll(".active-player")].map((row) => row.querySelector(".active-player-total")?.textContent?.trim() ?? ""),
    feedback: document.querySelector("#score-feedback")?.textContent?.trim() ?? "",
    scoreCardName: document.querySelector(".score-selected-name")?.textContent?.trim() ?? null,
    lastLine: document.querySelector(".recent-entries-last")?.textContent?.trim() ?? null,
    recentRows: [...document.querySelectorAll(".recent-entry")].map((row) => [
      row.querySelector(".recent-entry-name")?.textContent?.trim() ?? "",
      row.querySelector(".recent-entry-amount")?.textContent?.trim() ?? ""
    ]),
    finishInHeader: Boolean(document.querySelector(".active-header [data-finish-section]")),
    finishInScorePanel: Boolean(document.querySelector(".score-panel [data-finish-section]")),
    recentIsLastInScorePanel: (() => {
      const entries = document.querySelector("[data-recent-entries]");
      return Boolean(entries && entries.parentElement?.lastElementChild === entries);
    })(),
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
  }));
}

async function readPodiumState(cdp) {
  return evaluate(cdp, () => {
    const dialog = document.querySelector("[data-podium-dialog]");
    const steps = [...document.querySelectorAll(".podium-step")].map((step) => {
      const rect = step.getBoundingClientRect();
      const pedestal = step.querySelector(".podium-pedestal");
      const pedestalRect = pedestal?.getBoundingClientRect() ?? null;
      const names = [...step.querySelectorAll(".podium-player-name")];

      return {
        rank: step.getAttribute("data-rank"),
        heading: step.querySelector(".podium-rank-heading")?.textContent?.trim() ?? "",
        names: names.map((node) => node.textContent.trim()),
        nameLineHeights: names.map((node) => {
          const style = getComputedStyle(node);
          return { height: node.getBoundingClientRect().height, lineHeight: parseFloat(style.lineHeight) || 0 };
        }),
        ranks: [...step.querySelectorAll(".podium-player-rank")].map((node) => node.textContent.trim()),
        totals: [...step.querySelectorAll(".podium-player-total")].map((node) => node.textContent.trim()),
        totalLabels: [...step.querySelectorAll(".podium-player-total")].map((node) => node.getAttribute("aria-label")),
        ptsLabels: [...step.querySelectorAll(".podium-player-pts")].map((node) => node.textContent.trim()),
        pedestalRank: pedestal?.querySelector(".podium-pedestal-rank")?.textContent?.trim() ?? "",
        pedestalLabel: pedestal?.querySelector(".podium-pedestal-label")?.textContent?.trim() ?? "",
        pedestalHeight: pedestalRect?.height ?? 0,
        crownCount: step.querySelectorAll(".podium-crown[aria-hidden='true']").length,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height
      };
    });
    const summaryGroups = [...document.querySelectorAll(".podium-summary-group")].map((group) => ({
      rank: group.getAttribute("data-rank"),
      label: group.querySelector(".podium-summary-rank-label")?.textContent?.trim() ?? "",
      cards: [...group.querySelectorAll(".podium-summary-card")].map((card) => ({
        rank: card.querySelector(".podium-summary-card-rank")?.textContent?.trim() ?? "",
        name: card.querySelector(".podium-summary-name")?.textContent?.trim() ?? "",
        total: card.querySelector(".podium-summary-total")?.textContent?.trim() ?? "",
        totalLabel: card.querySelector(".podium-summary-total")?.getAttribute("aria-label") ?? null,
        tokenLabel: card.querySelector(".player-token")?.getAttribute("aria-label") ?? null,
        pts: card.querySelector(".podium-summary-pts")?.textContent?.trim() ?? null
      }))
    }));
    const actions = [...document.querySelectorAll(".podium-actions button")];
    const close = document.querySelector("[data-action='close-podium']");
    const corner = document.querySelector("[data-action='close-podium-corner']");
    const dialogRect = dialog?.getBoundingClientRect() ?? null;
    const rankOneStep = document.querySelector(".podium-step[data-rank='1']");
    const viewportState = (node) => {
      if (!node || !dialogRect) {
        return { present: false, top: null, bottom: null, intersects: false, fullyVisible: false };
      }
      const rect = node.getBoundingClientRect();

      return {
        present: true,
        top: rect.top,
        bottom: rect.bottom,
        intersects: rect.bottom > dialogRect.top && rect.top < dialogRect.bottom,
        fullyVisible: rect.top >= dialogRect.top - 1 && rect.bottom <= dialogRect.bottom + 1
      };
    };

    return {
      present: Boolean(dialog),
      open: Boolean(dialog?.open),
      labelledBy: dialog?.getAttribute("aria-labelledby") ?? null,
      describedBy: dialog?.getAttribute("aria-describedby") ?? null,
      groupsLabel: document.querySelector(".podium-groups")?.getAttribute("aria-label") ?? null,
      titleText: document.getElementById("podium-title")?.textContent?.trim() ?? null,
      ledeText: document.getElementById("podium-lede")?.textContent?.trim() ?? null,
      pillText: document.querySelector(".podium-pill")?.textContent?.trim() ?? null,
      cornerPresent: Boolean(corner),
      cornerLabel: corner?.getAttribute("aria-label") ?? null,
      cornerHeight: corner?.getBoundingClientRect().height ?? 0,
      cornerWidth: corner?.getBoundingClientRect().width ?? 0,
      steps,
      summaryLabel: document.querySelector(".podium-summary")?.getAttribute("aria-label") ?? null,
      summaryGroups,
      summaryPresent: Boolean(document.querySelector(".podium-summary")),
      restPresent: Boolean(document.querySelector(".podium-rest")),
      tieNote: document.querySelector(".podium-tie-note")?.textContent?.trim() ?? null,
      actionLabels: actions.map((button) => button.textContent.trim()),
      actionCount: actions.length,
      focusOnClose: document.activeElement !== null && document.activeElement === close,
      focusAction: document.activeElement?.dataset?.action ?? null,
      confettiPieceCount: document.querySelectorAll(".confetti-piece").length,
      dialogScroll: dialog ? { scrollHeight: dialog.scrollHeight, clientHeight: dialog.clientHeight } : null,
      dialogScrollTop: dialog?.scrollTop ?? null,
      dialogViewport: dialogRect ? { top: dialogRect.top, bottom: dialogRect.bottom, height: dialogRect.height } : null,
      titleViewport: viewportState(document.getElementById("podium-title")),
      pillViewport: viewportState(document.querySelector(".podium-pill")),
      rankOneCrownViewport: viewportState(rankOneStep?.querySelector(".podium-crown") ?? null),
      rankOneStepViewport: viewportState(rankOneStep),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
}

// The podium must open at the top (validator repair F1): the locked initial
// focus on close-podium previously scrolled the dialog to the footer, hiding
// the pill/title/crown. These assertions pin the visible top of the stage.
function assertPodiumOpensAtTop(state, label) {
  assert.equal(state.dialogScrollTop, 0, `${label}: the dialog opens at the top (scrollTop 0)`);
  assert.equal(state.titleViewport.fullyVisible, true,
    `${label}: #podium-title is inside the dialog viewport`);
  assert.equal(state.pillViewport.fullyVisible, true,
    `${label}: .podium-pill is inside the dialog viewport`);
  assert.equal(state.rankOneCrownViewport.fullyVisible, true,
    `${label}: the rank-1 crown is inside the dialog viewport`);
  assert.equal(state.rankOneStepViewport.intersects, true,
    `${label}: the rank-1 step is inside the dialog viewport`);
  assert.ok(
    state.rankOneStepViewport.top >= state.dialogViewport.top - 1 &&
      state.rankOneStepViewport.top < state.dialogViewport.bottom,
    `${label}: the rank-1 step starts inside the dialog viewport (top ${state.rankOneStepViewport.top} vs ${state.dialogViewport.top}..${state.dialogViewport.bottom})`
  );
}

async function readFinishPrompt(cdp) {
  return evaluate(cdp, () => {
    const section = document.querySelector(".active-board > [data-finish-section]");
    const header = document.querySelector(".active-header");
    const roster = document.querySelector(".roster-panel");
    const confirm = document.querySelector("[data-action='confirm-finish']");
    const cancel = document.querySelector("[data-action='cancel-finish']");

    return {
      present: Boolean(section?.querySelector(".finish-prompt")),
      inActiveBoard: Boolean(section && section.parentElement?.classList.contains("active-board")),
      belowHeader: Boolean(header && section && (header.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING)),
      aboveLeaderboard: Boolean(section && roster && (section.compareDocumentPosition(roster) & Node.DOCUMENT_POSITION_FOLLOWING)),
      headerOpenerAbsent: !document.querySelector(".active-header [data-finish-section]"),
      scorePanelFinishAbsent: !document.querySelector(".score-panel [data-finish-section]"),
      title: document.querySelector(".finish-prompt-title")?.textContent?.trim() ?? null,
      warning: document.querySelector(".finish-prompt-warning")?.textContent?.trim() ?? null,
      warningId: document.querySelector(".finish-prompt-warning")?.id ?? null,
      describedBy: confirm?.getAttribute("aria-describedby") ?? null,
      confirmLabel: confirm?.textContent?.trim() ?? null,
      cancelLabel: cancel?.textContent?.trim() ?? null,
      confirmHeight: confirm?.getBoundingClientRect().height ?? 0,
      cancelHeight: cancel?.getBoundingClientRect().height ?? 0,
      focusOnConfirm: document.activeElement !== null && document.activeElement === confirm,
      scoreFormPresent: Boolean(document.querySelector("[data-score-form]")),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
}

// Session A (Scenarios 5 + 6): both panels preview five cards, the per-panel
// View all (N) opener opens a history dialog listing every game of that status
// in order, close/Escape/backdrop return focus to that opener, no interaction
// writes storage, ≤5 games render no opener, and 320px stays overflow-free.
async function runDashboardSession(cdp, { consoleProblems }) {
  const seedNow = Date.now();
  const activeGames = Array.from({ length: 7 }, (_, index) => seededGame({
    id: `dash-active-${index + 1}`,
    title: `Active ${index + 1}`,
    createdAt: new Date(seedNow - (index + 10) * 60_000).toISOString(),
    updatedAt: new Date(seedNow - (index + 1) * 60_000).toISOString(),
    names: ["Alex", "Sam"],
    totals: [index + 1, 0]
  }));
  const finishedGames = Array.from({ length: 7 }, (_, index) => seededGame({
    id: `dash-finished-${index + 1}`,
    title: `Finished ${index + 1}`,
    status: "finished",
    createdAt: new Date(seedNow - (index + 10) * 60_000).toISOString(),
    updatedAt: new Date(seedNow - (index + 1) * 60_000).toISOString(),
    names: ["Alex", "Sam"],
    totals: [index + 2, 0]
  }));

  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: seedSource([...activeGames, ...finishedGames])
  });
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  const seededRaw = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
  const collapsed = await readDashboard(cdp);
  assert.equal(collapsed.heroPillPresent, false, "the Local to this browser pill is gone");
  assert.equal(collapsed.retentionNote, "Saved only in this browser — clearing site data removes these games.",
    "the retention note stays");
  assert.equal(collapsed.columnGap, "32px", "the desktop dashboard gutter is 32px");
  assert.equal(collapsed.rowGap, "32px");
  assert.equal(collapsed.topGap, "32px", "the desktop top separator uses the same 32px gap");
  assert.equal(collapsed.heroToDashboardGap, 32, "the hero and dashboard are separated by 32px");
  assert.equal(collapsed.gridBorderTopWidth, "0px", "no divider border is introduced");
  assert.equal(collapsed.beforeContent, "none", "no divider pseudo-element is introduced");
  assert.equal(collapsed.afterContent, "none");
  assert.equal(collapsed.horizontalOverflow, false);
  assert.deepEqual(collapsed.unfinishedTitles, ["Active 1", "Active 2", "Active 3", "Active 4", "Active 5"],
    "each panel shows its five most recent games in order");
  assert.deepEqual(collapsed.finishedTitles, ["Finished 1", "Finished 2", "Finished 3", "Finished 4", "Finished 5"]);
  assert.deepEqual(collapsed.unfinishedOpener, {
    text: "View all (7)",
    label: "View all (7) unfinished games",
    haspopup: "dialog",
    expanded: null,
    controls: null,
    height: collapsed.unfinishedOpener.height,
    width: collapsed.unfinishedOpener.width,
    focused: false
  });
  assert.ok(collapsed.unfinishedOpener.height >= 44 && collapsed.unfinishedOpener.width >= 44,
    "the unfinished opener is a >=44px focusable target");
  assert.deepEqual(collapsed.finishedOpener, {
    text: "View all (7)",
    label: "View all (7) finished games",
    haspopup: "dialog",
    expanded: null,
    controls: null,
    height: collapsed.finishedOpener.height,
    width: collapsed.finishedOpener.width,
    focused: false
  });
  assert.ok(collapsed.finishedOpener.height >= 44 && collapsed.finishedOpener.width >= 44);
  assert.equal(await evaluate(cdp, () => document.body.textContent.includes("Show latest 5")), false,
    "no inline Show latest 5 expansion remains");
  const collapsedScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-dashboard-preview.png"));

  // Unfinished dialog: every game in most-recent-first order, preview behind.
  await click(cdp, "[data-action='view-all-unfinished']");
  await waitForSelector(cdp, "[data-history-dialog]");
  const activeDialog = await readHistoryDialog(cdp);
  assert.equal(activeDialog.open, true, "the unfinished opener opens a modal dialog");
  assert.equal(activeDialog.labelledBy, "history-dialog-title");
  assert.equal(activeDialog.describedBy, "history-dialog-count");
  assert.equal(activeDialog.title, "All unfinished games");
  assert.equal(activeDialog.count, "7 saved games");
  assert.equal(activeDialog.listLabel, "All unfinished games");
  assert.equal(activeDialog.listId, "history-unfinished-list");
  assert.equal(activeDialog.cardTitles.length, 7, "the dialog lists every unfinished game");
  assert.deepEqual(activeDialog.cardTitles, activeGames.map((game) => game.title),
    "the dialog keeps the accepted most-recent-first order");
  assert.deepEqual(activeDialog.resumeLabels, activeGames.map((game) => `Resume ${game.title}`));
  assert.equal(activeDialog.resultLabels.length, 0);
  assert.equal(activeDialog.focusOnClose, true, "opening focuses the close control");
  assert.equal(activeDialog.closeLabel, "Close game history");
  assert.ok(activeDialog.closeHeight >= 44 && activeDialog.closeWidth >= 44);
  assert.equal((await readSavedGamesState(cdp, STORAGE_KEY)).raw, seededRaw,
    "opening the history dialog never writes storage");
  const activeDialogScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-history-unfinished.png"));

  await click(cdp, "[data-action='close-history']");
  await waitForAbsent(cdp, "[data-history-dialog]");
  const afterClose = await readDashboard(cdp);
  assert.deepEqual(afterClose.unfinishedTitles.length, 5, "the preview stays capped at five after close");
  assert.equal(afterClose.unfinishedOpener.focused, true, "closing returns focus to the unfinished opener");
  assert.equal((await readSavedGamesState(cdp, STORAGE_KEY)).raw, seededRaw);

  // Escape and backdrop are the other two close paths.
  await click(cdp, "[data-action='view-all-unfinished']");
  await waitForSelector(cdp, "[data-history-dialog]");
  await pressEscape(cdp);
  await waitForAbsent(cdp, "[data-history-dialog]");
  assert.equal((await readDashboard(cdp)).unfinishedOpener.focused, true,
    "Escape returns focus to the unfinished opener");
  assert.equal((await readSavedGamesState(cdp, STORAGE_KEY)).raw, seededRaw,
    "Escape never writes storage");

  await click(cdp, "[data-action='view-all-unfinished']");
  await waitForSelector(cdp, "[data-history-dialog]");
  await clickBackdrop(cdp, 8, 400);
  await waitForAbsent(cdp, "[data-history-dialog]");
  assert.equal((await readDashboard(cdp)).unfinishedOpener.focused, true,
    "a backdrop click returns focus to the unfinished opener");
  assert.equal((await readSavedGamesState(cdp, STORAGE_KEY)).raw, seededRaw,
    "backdrop dismissal never writes storage");

  // Finished dialog: same contract with View results controls.
  await click(cdp, "[data-action='view-all-finished']");
  await waitForSelector(cdp, "[data-history-dialog]");
  const finishedDialog = await readHistoryDialog(cdp);
  assert.equal(finishedDialog.open, true);
  assert.equal(finishedDialog.title, "All finished games");
  assert.equal(finishedDialog.count, "7 saved games");
  assert.equal(finishedDialog.listLabel, "All finished games");
  assert.equal(finishedDialog.listId, "history-finished-list");
  assert.deepEqual(finishedDialog.cardTitles, finishedGames.map((game) => game.title));
  assert.deepEqual(finishedDialog.resultLabels, finishedGames.map((game) => `View results ${game.title}`));
  assert.equal(finishedDialog.resumeLabels.length, 0);
  assert.equal(finishedDialog.focusOnClose, true);
  assert.equal((await readSavedGamesState(cdp, STORAGE_KEY)).raw, seededRaw);
  const finishedDialogScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-history-finished.png"));
  await click(cdp, "[data-action='close-history']");
  await waitForAbsent(cdp, "[data-history-dialog]");
  assert.equal((await readDashboard(cdp)).finishedOpener.focused, true,
    "closing returns focus to the finished opener");

  // ≤5 games in a panel means no opener and no wrapper.
  const smallGames = [
    seededGame({ id: "small-active-1", title: "Small active 1", createdAt: new Date(seedNow - 60_000).toISOString(), updatedAt: new Date(seedNow - 60_000).toISOString(), names: ["Alex", "Sam"], totals: [1, 0] }),
    seededGame({ id: "small-active-2", title: "Small active 2", createdAt: new Date(seedNow - 120_000).toISOString(), updatedAt: new Date(seedNow - 120_000).toISOString(), names: ["Alex", "Sam"], totals: [2, 0] }),
    seededGame({ id: "small-active-3", title: "Small active 3", createdAt: new Date(seedNow - 180_000).toISOString(), updatedAt: new Date(seedNow - 180_000).toISOString(), names: ["Alex", "Sam"], totals: [3, 0] }),
    seededGame({ id: "small-finished-1", title: "Small finished 1", status: "finished", createdAt: new Date(seedNow - 240_000).toISOString(), updatedAt: new Date(seedNow - 240_000).toISOString(), names: ["Alex", "Sam"], totals: [4, 0] }),
    seededGame({ id: "small-finished-2", title: "Small finished 2", status: "finished", createdAt: new Date(seedNow - 300_000).toISOString(), updatedAt: new Date(seedNow - 300_000).toISOString(), names: ["Alex", "Sam"], totals: [5, 0] })
  ];
  await evaluate(cdp, ({ key, raw }) => localStorage.setItem(key, raw), {
    key: STORAGE_KEY,
    raw: JSON.stringify({ version: 1, games: smallGames })
  });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");
  const small = await readDashboard(cdp);
  assert.equal(small.unfinishedTitles.length, 3);
  assert.equal(small.finishedTitles.length, 2);
  assert.equal(small.unfinishedOpener, null, "≤5 unfinished games render no opener");
  assert.equal(small.finishedOpener, null, "≤5 finished games render no opener");
  assert.equal(await evaluate(cdp, () => Boolean(document.querySelector(".history-opener-row"))), false,
    "no opener wrapper renders without an opener");
  assert.equal(await evaluate(cdp, () => Boolean(document.querySelector("[data-history-dialog]"))), false,
    "no historical list renders without an opener");

  // 320px: the seeded 7+7 dashboard stacks, the dialog scrolls internally,
  // stacks cards single-column, keeps 44px controls, and never overflows.
  await evaluate(cdp, ({ key, raw }) => localStorage.setItem(key, raw), { key: STORAGE_KEY, raw: seededRaw });
  await setViewport(cdp, { width: 320, height: 720, mobile: true });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");
  const mobile = await readDashboard(cdp);
  assert.equal(mobile.columns, 1, "the dashboard is single-column at 320px");
  assert.equal(mobile.stacked, true, "the panels stack at 320px");
  assert.equal(mobile.rowGap, "20px", "the stacked gutter returns to 20px");
  assert.equal(mobile.topGap, "20px", "the top separator returns to 20px when stacked");
  assert.equal(mobile.heroToDashboardGap, 20, "the hero and dashboard keep a 20px mobile gap");
  assert.equal(mobile.horizontalOverflow, false, "the dashboard must not overflow at 320px");
  assert.equal(mobile.unfinishedOpener.height >= 44, true);
  assert.equal(mobile.finishedOpener.height >= 44, true);
  await click(cdp, "[data-action='view-all-unfinished']");
  await waitForSelector(cdp, "[data-history-dialog]");
  const mobileDialog = await readHistoryDialog(cdp);
  assert.equal(mobileDialog.open, true);
  assert.equal(mobileDialog.cardTitles.length, 7);
  assert.ok(mobileDialog.dialogScroll.scrollHeight > mobileDialog.dialogScroll.clientHeight,
    "the 320px history dialog scrolls internally");
  assert.equal(mobileDialog.cardColumns, 1, "history cards stack single-column at 320px");
  assert.ok(mobileDialog.cardWidths.every((width) => width <= mobileDialog.bodyWidth),
    "history cards stay inside the dialog body at 320px");
  assert.equal(mobileDialog.closeHeight >= 44, true);
  assert.equal(mobileDialog.horizontalOverflow, false, "the 320px history dialog must not overflow");
  const mobileScreenshot = await screenshot(cdp, path.join(evidenceDir, "mobile-history-320px.png"));
  await pressEscape(cdp);
  await waitForAbsent(cdp, "[data-history-dialog]");

  assert.deepEqual(consoleProblems, [], "the dashboard session must not produce uncaught console errors");
  return { collapsedScreenshot, activeDialogScreenshot, finishedDialogScreenshot, mobileScreenshot };
}

// Session B (Scenarios 3 + 4): counters stage a combined draft and Save
// applies one change; whole active rows select; finished rows stay inert.
async function runScoringAndRowsSession(cdp, { consoleProblems }) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  await createGame(cdp, "Row night", ["Alex", "Sam", "Jamie"]);
  const rawAfterCreate = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;

  const initial = await readActiveState(cdp);
  assert.equal(initial.selectedName, "Alex", "the first player starts selected");

  // Click the second row away from its Add points button.
  await evaluate(cdp, () => {
    document.querySelectorAll(".active-player")[1]?.querySelector(".active-player-name")?.click();
  });
  await waitForSelector(cdp, "#score-amount");
  const afterRowClick = await readActiveState(cdp);
  assert.equal(afterRowClick.selectedName, "Sam", "clicking a row selects that player");
  assert.deepEqual(afterRowClick.pressed, ["false", "true", "false"], "its Add points button carries aria-pressed");
  assert.equal(afterRowClick.scoreCardName, "Sam", "the score card names the selected player");
  assert.equal(afterRowClick.focusId, "score-amount", "row selection focuses the score field");
  assert.equal((await readSavedGamesState(cdp, STORAGE_KEY)).raw, rawAfterCreate,
    "row selection never writes storage");

  await click(cdp, "[data-player-id='active-game-player-1'] .add-points-action");
  const afterButtonClick = await readActiveState(cdp);
  assert.equal(afterButtonClick.selectedName, "Alex", "the Add points button keeps its selection handler");
  assert.deepEqual(afterButtonClick.pressed, ["true", "false", "false"]);
  assert.equal(afterButtonClick.focusId, "score-amount");

  // Staged draft: 12 typed + 5 + 10 - 1 = 26, with no save.
  await fill(cdp, "#score-amount", "12");
  await clickCounter(cdp, 5);
  await clickCounter(cdp, 10);
  await clickCounter(cdp, -1);
  const staged = await readActiveState(cdp);
  assert.equal(staged.inputValue, "26", "counters add to the typed draft");
  assert.deepEqual(staged.totals, ["0", "0", "0"], "staging never changes totals");
  assert.equal(staged.feedback, "", "staging never paints feedback");
  assert.equal(staged.lastLine, null, "staging adds no recent entry");
  assert.deepEqual(staged.recentRows, []);
  assert.equal(staged.focusAmount, "-1", "focus stays on the last pressed counter");
  assert.equal((await readSavedGamesState(cdp, STORAGE_KEY)).raw, rawAfterCreate,
    "counter staging never writes storage");

  await click(cdp, "[data-score-form] button[type='submit']");
  await waitForSelector(cdp, "#score-amount");
  const saved = await readActiveState(cdp);
  assert.deepEqual(saved.totals, ["26", "0", "0"], "Save applies the combined draft once");
  assert.equal(saved.feedback, "Added 26 points to Alex. New total: 26. Rank: 1.");
  assert.equal(saved.lastLine, "Last: Alex +26");
  assert.deepEqual(saved.recentRows, [["Alex", "+26 pts"]]);
  const rawAfterSave = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
  const stored = JSON.parse(rawAfterSave);
  assert.deepEqual(stored.games[0].changes.map((change) => change.amount), [26],
    "one Save writes exactly one change");

  await fill(cdp, "#score-amount", "");
  await clickCounter(cdp, -10);
  const negativeDraft = await readActiveState(cdp);
  assert.equal(negativeDraft.inputValue, "-10", "an empty draft starts at the preset");
  assert.equal((await readSavedGamesState(cdp, STORAGE_KEY)).raw, rawAfterSave,
    "staging the negative draft writes nothing");

  await fill(cdp, "#score-amount", "999999");
  await clickCounter(cdp, 25);
  const clamped = await readActiveState(cdp);
  assert.equal(clamped.inputValue, "1000000", "counter additions clamp at +1,000,000");
  assert.equal((await readSavedGamesState(cdp, STORAGE_KEY)).raw, rawAfterSave,
    "the clamped draft stays unsaved");

  // Finish, then prove finished rows are inert.
  await finishWithPodium(cdp);
  const rawAfterFinish = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
  await click(cdp, "[data-action='close-podium']");
  await waitForSelector(cdp, "[data-action='play-again']");
  const finishedBeforeClick = await evaluate(cdp, () => ({
    focusId: document.activeElement?.id ?? null,
    cursor: getComputedStyle(document.querySelector(".active-player.is-final")).cursor
  }));
  await evaluate(cdp, () => {
    document.querySelector(".active-player.is-final .active-player-name")?.click();
  });
  const finishedAfterClick = await evaluate(cdp, () => ({
    selectedCount: document.querySelectorAll(".active-player.is-selected").length,
    pressedCount: document.querySelectorAll("[aria-pressed]").length,
    focusId: document.activeElement?.id ?? null,
    cursor: getComputedStyle(document.querySelector(".active-player.is-final")).cursor
  }));
  assert.equal(finishedBeforeClick.cursor, "auto", "finished rows carry no pointer affordance");
  assert.equal(finishedAfterClick.selectedCount, 0, "clicking a finished row selects nothing");
  assert.equal(finishedAfterClick.pressedCount, 0, "finished views expose no aria-pressed controls");
  assert.notEqual(finishedAfterClick.focusId, "score-amount", "finished rows never focus the score field");
  assert.equal(finishedAfterClick.cursor, "auto");
  assert.equal((await readSavedGamesState(cdp, STORAGE_KEY)).raw, rawAfterFinish,
    "clicking a finished row never writes");
  const finishedScreenshot = await screenshot(cdp, path.join(evidenceDir, "finished-row-inert.png"));

  assert.deepEqual(consoleProblems, [], "the scoring/rows session must not produce uncaught console errors");
  return { finishedScreenshot };
}

// Session C (Scenario 5): Finish game lives in the active header; the prompt
// renders below the header/above the leaderboard with all ids/copy/focus; the
// score panel has no finish control; 320px stays overflow-free.
async function runFinishHeaderSession(cdp, { consoleProblems }) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  await createGame(cdp, "Header finish", ["Alex", "Sam"]);
  const beforeOpen = await readActiveState(cdp);
  assert.equal(beforeOpen.finishInHeader, true, "the opener is inside .active-header");
  assert.equal(beforeOpen.finishInScorePanel, false, "the score panel has no finish section");
  assert.equal(beforeOpen.recentIsLastInScorePanel, true, "recent entries remain the score panel's last block");
  const rawBefore = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;

  await click(cdp, "[data-action='open-finish']");
  await waitForSelector(cdp, "[data-action='confirm-finish']");
  const prompt = await readFinishPrompt(cdp);
  assert.equal(prompt.present, true);
  assert.equal(prompt.inActiveBoard, true, "the prompt lives inside .active-board");
  assert.equal(prompt.belowHeader, true, "the prompt renders below the active header");
  assert.equal(prompt.aboveLeaderboard, true, "the prompt renders above the leaderboard panel");
  assert.equal(prompt.headerOpenerAbsent, true, "the header opener is absent while the prompt is open");
  assert.equal(prompt.scorePanelFinishAbsent, true);
  assert.equal(prompt.title, "Finish this game?");
  assert.equal(prompt.warning, "Finished games can't be reopened for scoring. Final standings stay saved in this browser.");
  assert.equal(prompt.warningId, "finish-warning");
  assert.equal(prompt.describedBy, "finish-warning", "the confirm button keeps its aria-describedby hook");
  assert.equal(prompt.confirmLabel, "Finish game");
  assert.equal(prompt.cancelLabel, "Cancel");
  assert.equal(prompt.focusOnConfirm, true, "opening focuses the confirm button");
  assert.equal(prompt.scoreFormPresent, true, "the score form stays usable while the prompt is open");
  const desktopScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-finish-header-prompt.png"));

  await click(cdp, "[data-action='cancel-finish']");
  await waitForSelector(cdp, "[data-action='open-finish']");
  const afterCancel = await readActiveState(cdp);
  assert.equal(afterCancel.finishInHeader, true);
  assert.equal(afterCancel.focusAction, "open-finish", "Cancel returns focus to the header opener");
  assert.equal((await readSavedGamesState(cdp, STORAGE_KEY)).raw, rawBefore, "Cancel never writes");

  // 320px: the header/prompt stay overflow-free and keyboard-operable.
  await setViewport(cdp, { width: 320, height: 720, mobile: true });
  await click(cdp, "[data-action='open-finish']");
  await waitForSelector(cdp, "[data-action='confirm-finish']");
  const mobilePrompt = await readFinishPrompt(cdp);
  assert.equal(mobilePrompt.present, true);
  assert.equal(mobilePrompt.belowHeader, true);
  assert.equal(mobilePrompt.aboveLeaderboard, true);
  assert.equal(mobilePrompt.headerOpenerAbsent, true);
  assert.equal(mobilePrompt.focusOnConfirm, true);
  assert.equal(mobilePrompt.horizontalOverflow, false, "the 320px header/prompt must not overflow");
  assert.ok(mobilePrompt.confirmHeight >= 44 && mobilePrompt.cancelHeight >= 44,
    "confirm/cancel keep >=44px targets at 320px");
  const mobileScreenshot = await screenshot(cdp, path.join(evidenceDir, "mobile-finish-header-prompt-320px.png"));

  await click(cdp, "[data-action='confirm-finish']");
  await waitForSelector(cdp, "[data-podium-dialog]");
  const podium = await readPodiumState(cdp);
  assert.equal(podium.open, true, "confirm follows the accepted finish/podium path");
  assert.equal(podium.focusOnClose, true);
  await pressEscape(cdp);
  await waitForAbsent(cdp, "[data-podium-dialog]");
  const finished = await readActiveState(cdp);
  assert.equal(finished.finishInHeader, false, "finished views render no finish control");
  assert.equal(finished.finishInScorePanel, false);
  assert.equal(finished.horizontalOverflow, false);
  assert.equal(finished.focusId, "active-title", "dismissal returns focus to the heading");

  assert.deepEqual(consoleProblems, [], "the finish-header session must not produce uncaught console errors");
  return { desktopScreenshot, mobileScreenshot };
}

// Session D (Scenarios 1–4): tactile steps (2-left / 1-center-tallest /
// 3-right with Winner/Silver/Bronze pedestals, crown, pill, corner X, tie
// note) plus ranked summary cards for every player; ties, missing ranks, and
// a 20-tied game scroll internally; the corner X dismisses through the same
// funnel and the three locked actions keep their contract.
async function runPodiumSession(cdp, { consoleProblems }) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  // Distinct ranks 1–4.
  await createGame(cdp, "Steps night", ["Alex", "Sam", "Jamie", "Taylor"]);
  await savePoints(cdp, "10");
  await click(cdp, "[data-player-id='active-game-player-2'] .add-points-action");
  await savePoints(cdp, "5");
  await click(cdp, "[data-player-id='active-game-player-3'] .add-points-action");
  await savePoints(cdp, "4");
  await finishWithPodium(cdp);
  const rawAfterFinish = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;

  const distinct = await readPodiumState(cdp);
  assertPodiumOpensAtTop(distinct, "desktop distinct ranks");
  assert.equal(distinct.labelledBy, "podium-title");
  assert.equal(distinct.describedBy, "podium-lede");
  assert.equal(distinct.titleText, "Final podium");
  assert.equal(distinct.ledeText, "Congratulations to the top of the table.");
  assert.equal(distinct.groupsLabel, "Podium steps");
  assert.equal(distinct.pillText, "Game concluded", "the Game concluded pill renders");
  assert.equal(distinct.cornerPresent, true, "the corner X renders");
  assert.equal(distinct.cornerLabel, "Close podium");
  assert.ok(distinct.cornerHeight >= 44 && distinct.cornerWidth >= 44,
    "the corner X is a >=44px target");
  assert.deepEqual(distinct.steps.map((step) => step.rank), ["1", "2", "3"],
    "the steps keep rank 1 → 2 → 3 DOM order");
  assert.deepEqual(distinct.steps.map((step) => step.heading), ["Rank 1", "Rank 2", "Rank 3"]);
  assert.deepEqual(distinct.steps.map((step) => step.names), [["Alex"], ["Sam"], ["Jamie"]]);
  assert.deepEqual(distinct.steps.map((step) => step.pedestalRank), ["1", "2", "3"]);
  assert.deepEqual(distinct.steps.map((step) => step.pedestalLabel), ["Winner", "Silver", "Bronze"]);
  assert.deepEqual(distinct.steps.map((step) => step.crownCount), [1, 0, 0],
    "only rank 1 carries the aria-hidden crown");
  assert.equal(distinct.tieNote, "Ties share rank and step position automatically");
  assert.equal(distinct.restPresent, false, "the superseded Rest of the table section is gone");
  assert.equal(await evaluate(cdp, () => document.body.textContent.includes("Rest of the table")), false);

  // Readable contestants: readable raw totals with their own pts label and
  // short names on one line (height within one line's line-height).
  for (const step of distinct.steps) {
    assert.deepEqual(step.ptsLabels, ["pts"]);
    assert.ok(step.nameLineHeights.every(({ height, lineHeight }) => height <= lineHeight * 1.5),
      `short names render on one line (${step.nameLineHeights.map(({ height, lineHeight }) => `${height}/${lineHeight}`).join(", ")})`);
  }
  assert.deepEqual(distinct.steps.map((step) => step.totalLabels), [
    ["Alex: rank 1, total 10"],
    ["Sam: rank 2, total 5"],
    ["Jamie: rank 3, total 4"]
  ]);

  // Ranked summary for all players, grouped by competition rank.
  assert.equal(distinct.summaryLabel, "Ranked summary");
  assert.deepEqual(distinct.summaryGroups.map((group) => group.rank), ["1", "2", "3", "4"]);
  assert.deepEqual(distinct.summaryGroups.map((group) => group.label), ["Rank 1", "Rank 2", "Rank 3", "Rank 4"]);
  assert.deepEqual(distinct.summaryGroups.flatMap((group) => group.cards.map((card) => card.name)),
    ["Alex", "Sam", "Jamie", "Taylor"], "every player appears in the ranked summary");
  assert.deepEqual(distinct.summaryGroups.flatMap((group) => group.cards.map((card) => [card.rank, card.total, card.totalLabel])), [
    ["1", "10", "Alex: rank 1, total 10"],
    ["2", "5", "Sam: rank 2, total 5"],
    ["3", "4", "Jamie: rank 3, total 4"],
    ["4", "0", "Taylor: rank 4, total 0"]
  ]);
  assert.ok(distinct.summaryGroups.flatMap((group) => group.cards).every((card) => card.pts === "pts"));
  assert.equal(distinct.summaryGroups[0].cards[0].tokenLabel, "Player 1, Blue");

  const [rankOne, rankTwo, rankThree] = distinct.steps;
  assert.ok(rankTwo.left < rankOne.left && rankOne.left < rankThree.left,
    "rank 2 sits left, rank 1 center, rank 3 right");
  assert.ok(Math.abs(rankOne.bottom - rankTwo.bottom) <= 1 && Math.abs(rankOne.bottom - rankThree.bottom) <= 1,
    "the steps share a common bottom baseline");
  assert.ok(rankOne.pedestalHeight > rankTwo.pedestalHeight && rankTwo.pedestalHeight > rankThree.pedestalHeight,
    `the pedestal ladder is 1 > 2 > 3 (${rankOne.pedestalHeight}/${rankTwo.pedestalHeight}/${rankThree.pedestalHeight})`);
  assert.ok(rankOne.height > rankTwo.height && rankOne.height > rankThree.height,
    `the rank-1 silhouette is the tallest (${rankOne.height}/${rankTwo.height}/${rankThree.height})`);
  assert.deepEqual(distinct.actionLabels, [
    "Play again (same players, reset scores)",
    "Close & view full standings",
    "Save & exit to Dashboard"
  ], "the three locked actions keep their DOM order");
  assert.equal(distinct.actionCount, 3);
  assert.equal(distinct.focusOnClose, true, "initial focus stays on the dismiss control");
  assert.equal(distinct.confettiPieceCount, 14);
  const stepsScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-podium-tactile.png"));

  // Scenario 4: the corner X is a second dismiss affordance through the same
  // funnel — heading focus, unchanged standings, byte-identical storage.
  await click(cdp, "[data-action='close-podium-corner']");
  await waitForAbsent(cdp, "[data-podium-dialog]");
  const afterCorner = await evaluate(cdp, () => ({
    focusId: document.activeElement?.id ?? null,
    podiumPresent: Boolean(document.querySelector("[data-podium-dialog]")),
    totals: [...document.querySelectorAll(".active-player-total")].map((node) => node.textContent.trim())
  }));
  assert.equal(afterCorner.podiumPresent, false, "the corner X dismisses the podium");
  assert.equal(afterCorner.focusId, "active-title", "the corner X returns focus to the game heading");
  assert.deepEqual(afterCorner.totals, ["10", "5", "4", "0"], "the standings stay unchanged");
  assert.equal((await readSavedGamesState(cdp, STORAGE_KEY)).raw, rawAfterFinish,
    "the corner X never writes storage");

  // Distinct ranks at 320px: the steps stack in rank order (1 -> 2 -> 3) and
  // compact their pedestals without forcing page-level overflow.
  await goHome(cdp);
  await createGame(cdp, "Pocket ranks", ["Alex", "Sam", "Jamie"]);
  await savePoints(cdp, "9");
  await click(cdp, "[data-player-id='active-game-player-2'] .add-points-action");
  await savePoints(cdp, "6");
  await click(cdp, "[data-player-id='active-game-player-3'] .add-points-action");
  await savePoints(cdp, "3");
  // Open the podium while already at 320x720 so the narrow open-at-top
  // contract is a genuine open, not a resize of the desktop dialog.
  await setViewport(cdp, { width: 320, height: 720, mobile: true });
  await finishWithPodium(cdp);
  const distinctMobile = await readPodiumState(cdp);
  assertPodiumOpensAtTop(distinctMobile, "320px distinct ranks");
  assert.equal(distinctMobile.open, true, "the distinct-rank podium stays open at 320px");
  assert.deepEqual(distinctMobile.steps.map((step) => step.rank), ["1", "2", "3"],
    "the distinct-rank steps keep rank order at 320px");
  assert.ok(
    distinctMobile.steps[0].top < distinctMobile.steps[1].top &&
      distinctMobile.steps[1].top < distinctMobile.steps[2].top,
    "the 320px steps stack in rank order (1 -> 2 -> 3)"
  );
  assert.ok(distinctMobile.steps[0].pedestalHeight > distinctMobile.steps[1].pedestalHeight &&
    distinctMobile.steps[1].pedestalHeight > distinctMobile.steps[2].pedestalHeight,
    `the compact 320px pedestals keep the 1 > 2 > 3 ladder (${distinctMobile.steps.map((step) => step.pedestalHeight).join("/")})`);
  assert.equal(distinctMobile.horizontalOverflow, false, "the 320px distinct-rank podium must not overflow");
  const mobileDistinctScreenshot = await screenshot(cdp, path.join(evidenceDir, "mobile-podium-tactile-320px.png"));
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await pressEscape(cdp);
  await waitForAbsent(cdp, "[data-podium-dialog]");

  // Missing rank: 12/12/8 -> steps 1 and 3 only, all ties inside rank 1.
  await goHome(cdp);
  await createGame(cdp, "Missing rank night", ["Alex", "Sam", "Jamie"]);
  await savePoints(cdp, "12");
  await click(cdp, "[data-player-id='active-game-player-2'] .add-points-action");
  await savePoints(cdp, "12");
  await click(cdp, "[data-player-id='active-game-player-3'] .add-points-action");
  await savePoints(cdp, "8");
  await finishWithPodium(cdp);

  const missing = await readPodiumState(cdp);
  assertPodiumOpensAtTop(missing, "desktop ties/missing rank");
  assert.deepEqual(missing.steps.map((step) => step.rank), ["1", "3"], "a missing rank renders no step");
  assert.deepEqual(missing.steps.map((step) => step.heading), ["Rank 1", "Rank 3"]);
  assert.deepEqual(missing.steps[0].names, ["Alex", "Sam"], "ties stay inside their step");
  assert.deepEqual(missing.steps[1].names, ["Jamie"]);
  assert.deepEqual(missing.steps.map((step) => step.pedestalLabel), ["Winner", "Bronze"]);
  assert.ok(!missing.steps.some((step) => step.rank === "2"), "no fabricated rank-2 step");
  assert.deepEqual(missing.summaryGroups.map((group) => group.rank), ["1", "3"],
    "the summary groups shared ranks and skips the empty rank 2");
  assert.deepEqual(missing.summaryGroups.flatMap((group) => group.cards.map((card) => card.name)),
    ["Alex", "Sam", "Jamie"], "all players remain in the ranked summary");
  const missingScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-podium-ties.png"));
  await pressEscape(cdp);
  await waitForAbsent(cdp, "[data-podium-dialog]");

  // Twenty tied players: one rank-1 step, twenty summary cards, internal scroll.
  await goHome(cdp);
  await createGame(cdp, "Twenty tied night", Array.from({ length: 20 }, (_, index) => `Player ${index + 1}`));
  await finishWithPodium(cdp);

  const twenty = await readPodiumState(cdp);
  assertPodiumOpensAtTop(twenty, "desktop 20-tied");
  assert.deepEqual(twenty.steps.map((step) => step.rank), ["1"]);
  assert.equal(twenty.steps[0].names.length, 20, "all 20 tied players stay in one step");
  assert.equal(twenty.summaryGroups.length, 1);
  assert.equal(twenty.summaryGroups[0].cards.length, 20, "all 20 tied players get summary cards");
  assert.ok(twenty.dialogScroll.scrollHeight > twenty.dialogScroll.clientHeight,
    "the 20-tied podium scrolls internally at desktop");
  assert.equal(twenty.horizontalOverflow, false);
  const desktopTwentyScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-podium-20-tied.png"));

  // Replay the same 20 players and open the podium at 320x720 so the narrow
  // 20-tied open-at-top contract is also a genuine open.
  await click(cdp, "[data-action='podium-play-again']");
  await waitForSelector(cdp, "#score-amount");
  await setViewport(cdp, { width: 320, height: 720, mobile: true });
  await finishWithPodium(cdp);
  const twentyMobile = await readPodiumState(cdp);
  assertPodiumOpensAtTop(twentyMobile, "320px 20-tied");
  assert.equal(twentyMobile.open, true);
  assert.equal(twentyMobile.steps.length, 1);
  assert.equal(twentyMobile.steps[0].names.length, 20);
  assert.equal(twentyMobile.summaryGroups[0].cards.length, 20);
  assert.ok(twentyMobile.dialogScroll.scrollHeight > twentyMobile.dialogScroll.clientHeight,
    "the 20-tied podium scrolls internally at 320px");
  assert.equal(twentyMobile.horizontalOverflow, false, "the 320px podium must not overflow");
  assert.equal(twentyMobile.actionCount, 3);
  const mobileTwentyScreenshot = await screenshot(cdp, path.join(evidenceDir, "mobile-podium-20-tied-320px.png"));

  await pressEscape(cdp);
  await waitForAbsent(cdp, "[data-podium-dialog]");

  assert.deepEqual(consoleProblems, [], "the podium session must not produce uncaught console errors");
  return { stepsScreenshot, mobileDistinctScreenshot, missingScreenshot, desktopTwentyScreenshot, mobileTwentyScreenshot };
}

// Session E (Scenario 6 + Scenario 8): Recent entries caps at five, and the
// finished layout uses one full-width grid track at desktop and 320px.
async function runFinishedAndRecentSession(cdp, { consoleProblems }) {
  const seedNow = Date.now();
  const changes = Array.from({ length: 7 }, (_, index) => ({
    id: `recent-${index + 1}`,
    playerId: "seed-recent-player-1",
    amount: index + 1,
    at: new Date(seedNow - (7 - index) * 60_000).toISOString()
  }));
  const active = seededGame({
    id: "seed-recent",
    title: "Recent caps night",
    createdAt: new Date(seedNow - 600_000).toISOString(),
    updatedAt: new Date(seedNow - 60_000).toISOString(),
    names: ["Alex", "Sam"],
    totals: [28, 0],
    changes
  });
  const finished = seededGame({
    id: "seed-finished-width",
    title: "Wide finish night",
    status: "finished",
    createdAt: new Date(seedNow - 900_000).toISOString(),
    updatedAt: new Date(seedNow - 900_000).toISOString(),
    names: ["Alex", "Sam", "Jamie", "Taylor"],
    totals: [10, 5, 4, 0]
  });

  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: seedSource([active, finished])
  });
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  const seededRaw = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
  await click(cdp, "[data-action='resume-game'][data-game-id='seed-recent']");
  await waitForSelector(cdp, "[data-recent-entries]");
  const recent = await evaluate(cdp, () => ({
    count: document.querySelectorAll(".recent-entry").length,
    amounts: [...document.querySelectorAll(".recent-entry-amount")].map((node) => node.textContent.trim()),
    lastLine: document.querySelector(".recent-entries-last")?.textContent?.trim() ?? null,
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
  }));
  assert.equal(recent.count, 5, "the Recent entries panel caps at five rows");
  assert.deepEqual(recent.amounts, ["+7 pts", "+6 pts", "+5 pts", "+4 pts", "+3 pts"],
    "the five newest changes render newest first");
  assert.equal(recent.lastLine, "Last: Alex +7");
  assert.equal(recent.horizontalOverflow, false);
  const storedAfterResume = JSON.parse((await readSavedGamesState(cdp, STORAGE_KEY)).raw);
  assert.equal(storedAfterResume.games.find((game) => game.id === "seed-recent").changes.length, 7,
    "the full change log stays persisted");
  assert.equal((await readSavedGamesState(cdp, STORAGE_KEY)).raw, seededRaw,
    "resuming never writes storage");
  const recentScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-recent-cap-five.png"));

  await goHome(cdp);
  await click(cdp, "[data-action='view-results'][data-game-id='seed-finished-width']");
  await waitForSelector(cdp, "[data-finished-note]");
  const finishedDesktop = await evaluate(cdp, () => {
    const layout = document.querySelector(".active-layout");
    const board = document.querySelector(".active-board");
    const roster = document.querySelector(".roster-panel");
    const style = layout ? getComputedStyle(layout) : null;
    const boardRect = board?.getBoundingClientRect() ?? null;
    const rosterRect = roster?.getBoundingClientRect() ?? null;
    return {
      isFinished: layout?.classList.contains("is-finished") ?? false,
      columns: style ? style.gridTemplateColumns.split(" ").length : 0,
      scorePanelPresent: Boolean(document.querySelector(".score-panel")),
      layoutChildren: layout?.children.length ?? 0,
      boardWidth: boardRect?.width ?? 0,
      rosterWidth: rosterRect?.width ?? 0,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
  assert.equal(finishedDesktop.isFinished, true, "the finished view carries the is-finished modifier");
  assert.equal(finishedDesktop.columns, 1, "the finished layout uses one grid track");
  assert.equal(finishedDesktop.scorePanelPresent, false, "no score panel renders");
  assert.equal(finishedDesktop.layoutChildren, 1, "no empty right column is reserved");
  assert.ok(Math.abs(finishedDesktop.boardWidth - finishedDesktop.rosterWidth) <= 1,
    "the standings panel fills the content width");
  assert.equal(finishedDesktop.horizontalOverflow, false);
  const finishedScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-finished-full-width.png"));

  await setViewport(cdp, { width: 320, height: 720, mobile: true });
  const finishedMobile = await evaluate(cdp, () => ({
    columns: getComputedStyle(document.querySelector(".active-layout")).gridTemplateColumns.split(" ").length,
    scorePanelPresent: Boolean(document.querySelector(".score-panel")),
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
  }));
  assert.equal(finishedMobile.columns, 1);
  assert.equal(finishedMobile.scorePanelPresent, false);
  assert.equal(finishedMobile.horizontalOverflow, false, "the 320px finished view must not overflow");
  const mobileScreenshot = await screenshot(cdp, path.join(evidenceDir, "mobile-finished-full-width-320px.png"));

  assert.deepEqual(consoleProblems, [], "the finished/recent session must not produce uncaught console errors");
  return { recentScreenshot, finishedScreenshot, mobileScreenshot };
}

async function main() {
  try {
    const dashboard = await runSession("dashboard", runDashboardSession);
    assert.equal(typeof dashboard.collapsedScreenshot, "string");

    const scoring = await runSession("scoring-and-rows", runScoringAndRowsSession);
    assert.equal(typeof scoring.finishedScreenshot, "string");

    const finishHeader = await runSession("finish-header", runFinishHeaderSession);
    assert.equal(typeof finishHeader.desktopScreenshot, "string");

    const podium = await runSession("podium", runPodiumSession);
    assert.equal(typeof podium.stepsScreenshot, "string");

    const finished = await runSession("finished-and-recent", runFinishedAndRecentSession);
    assert.equal(typeof finished.recentScreenshot, "string");

    console.log("Browser refine-ui test passed: the Dashboard removes the Local pill, keeps the retention note, uses a 32px desktop gutter and top separator with no divider, previews five games per panel, and above five renders a View all (N) opener (aria-haspopup=dialog, no aria-expanded/aria-controls, no Show latest 5) that opens a scrollable history dialog listing every game of that status in most-recent-first order with the unchanged cards and Resume/View results controls; the close button, Escape, and a real backdrop click each return focus to that panel's opener and leave storage byte-identical; ≤5 games render no opener and no dialog, and 320px stacks single-column with internal dialog scrolling and 44px controls; quick counters stage one clamped combined draft with no totals/ranks/feedback/recent/storage change and Save applies it as one change (the shared stepper contract remains covered by browser-quick-score); whole active rows select through the same path as Add points while finished rows stay inert; Finish game sits in the active header with the unchanged prompt below the header/above the leaderboard and all ids/copy/focus at desktop and 320px; Recent entries caps at five while the full log persists; the podium renders tactile 2-left/1-center-tallest/3-right steps with readable contestant cards, Winner/Silver/Bronze pedestals, a rank-1 crown, the Game concluded pill, a 44px corner X, the exact tie note, and ranked summary cards for every player; ties and missing ranks preserve competition ranks, the 20-tied game scrolls internally, the corner X dismisses to the heading with byte-identical storage, the three locked actions/focus/confetti stay intact, and the podium opens at scrollTop 0 with the pill, title, rank-1 crown, and rank-1 step start inside the dialog viewport at 1280x800 and 320x720 (including the 20-tied game); 320px stacks the steps in rank order; finished standings use one full-width grid track with no empty score-panel column; zero uncaught console errors.");
    console.log(`Browser evidence screenshots: ${[
      dashboard.collapsedScreenshot,
      dashboard.activeDialogScreenshot,
      dashboard.finishedDialogScreenshot,
      dashboard.mobileScreenshot,
      scoring.finishedScreenshot,
      finishHeader.desktopScreenshot,
      finishHeader.mobileScreenshot,
      podium.stepsScreenshot,
      podium.mobileDistinctScreenshot,
      podium.missingScreenshot,
      podium.desktopTwentyScreenshot,
      podium.mobileTwentyScreenshot,
      finished.recentScreenshot,
      finished.finishedScreenshot,
      finished.mobileScreenshot
    ].join(", ")}`);
  } finally {
    await closeServer(server);
  }
}

await main();
