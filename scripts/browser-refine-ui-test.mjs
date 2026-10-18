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
const evidenceDir = await createEvidenceDir("devexpert-refine-ui-after-testing");
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
    const toggleFor = (action) => {
      const button = document.querySelector(`[data-action='${action}']`);
      return button ? {
        text: button.textContent.trim(),
        label: button.getAttribute("aria-label"),
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

    return {
      unfinishedTitles: titles(panelFor("unfinished")),
      finishedTitles: titles(panelFor("finished")),
      unfinishedToggle: toggleFor("toggle-unfinished-games"),
      finishedToggle: toggleFor("toggle-finished-games"),
      heroPillPresent: document.body.textContent.includes("Local to this browser"),
      retentionNote: document.querySelector(".retention-note")?.textContent?.trim() ?? null,
      columnGap: gridStyle?.columnGap ?? null,
      rowGap: gridStyle?.rowGap ?? null,
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
      return {
        rank: step.getAttribute("data-rank"),
        heading: step.querySelector(".podium-rank-heading")?.textContent?.trim() ?? "",
        names: [...step.querySelectorAll(".podium-player-name")].map((node) => node.textContent.trim()),
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height
      };
    });
    const rest = document.querySelector(".podium-rest");
    const actions = [...document.querySelectorAll(".podium-actions button")];
    const close = document.querySelector("[data-action='close-podium']");

    return {
      present: Boolean(dialog),
      open: Boolean(dialog?.open),
      labelledBy: dialog?.getAttribute("aria-labelledby") ?? null,
      describedBy: dialog?.getAttribute("aria-describedby") ?? null,
      groupsLabel: document.querySelector(".podium-groups")?.getAttribute("aria-label") ?? null,
      titleText: document.getElementById("podium-title")?.textContent?.trim() ?? null,
      ledeText: document.getElementById("podium-lede")?.textContent?.trim() ?? null,
      steps,
      restPresent: Boolean(rest),
      restTitle: document.getElementById("podium-rest-title")?.textContent?.trim() ?? null,
      restRows: [...document.querySelectorAll(".podium-rest-row")].map((row) => ({
        rank: row.querySelector(".podium-rest-rank")?.textContent?.trim() ?? "",
        name: row.querySelector(".podium-rest-name")?.textContent?.trim() ?? "",
        total: row.querySelector(".podium-rest-total")?.textContent?.trim() ?? "",
        totalLabel: row.querySelector(".podium-rest-total")?.getAttribute("aria-label") ?? null,
        tokenLabel: row.querySelector(".player-token")?.getAttribute("aria-label") ?? null
      })),
      restFocusableCount: rest
        ? rest.querySelectorAll("button, input, select, textarea, a[href], [tabindex]").length
        : 0,
      actionLabels: actions.map((button) => button.textContent.trim()),
      actionCount: actions.length,
      focusOnClose: document.activeElement !== null && document.activeElement === close,
      focusAction: document.activeElement?.dataset?.action ?? null,
      confettiPieceCount: document.querySelectorAll(".confetti-piece").length,
      dialogScroll: dialog ? { scrollHeight: dialog.scrollHeight, clientHeight: dialog.clientHeight } : null,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
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

// Session A (Scenario 1 + Scenario 2): both panels cap at five with a working
// per-panel disclosure, no storage writes, the pill removed, a 32px desktop
// gutter with no divider, and single-column 320px stacking.
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
  assert.equal(collapsed.gridBorderTopWidth, "0px", "no divider border is introduced");
  assert.equal(collapsed.beforeContent, "none", "no divider pseudo-element is introduced");
  assert.equal(collapsed.afterContent, "none");
  assert.equal(collapsed.horizontalOverflow, false);
  assert.deepEqual(collapsed.unfinishedTitles, ["Active 1", "Active 2", "Active 3", "Active 4", "Active 5"],
    "each panel shows its five most recent games in order");
  assert.deepEqual(collapsed.finishedTitles, ["Finished 1", "Finished 2", "Finished 3", "Finished 4", "Finished 5"]);
  assert.deepEqual(collapsed.unfinishedToggle, {
    text: "View all (7)",
    label: "View all (7) unfinished games",
    expanded: "false",
    controls: "unfinished-game-list",
    height: collapsed.unfinishedToggle.height,
    width: collapsed.unfinishedToggle.width,
    focused: false
  });
  assert.ok(collapsed.unfinishedToggle.height >= 44 && collapsed.unfinishedToggle.width >= 44,
    "the unfinished toggle is a >=44px focusable target");
  assert.deepEqual(collapsed.finishedToggle, {
    text: "View all (7)",
    label: "View all (7) finished games",
    expanded: "false",
    controls: "finished-game-list",
    height: collapsed.finishedToggle.height,
    width: collapsed.finishedToggle.width,
    focused: false
  });
  assert.ok(collapsed.finishedToggle.height >= 44 && collapsed.finishedToggle.width >= 44);
  const collapsedScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-dashboard-collapsed.png"));

  await click(cdp, "[data-action='toggle-unfinished-games']");
  const activeExpanded = await readDashboard(cdp);
  assert.equal(activeExpanded.unfinishedTitles.length, 7, "View all expands the unfinished panel");
  assert.deepEqual(activeExpanded.unfinishedTitles, activeGames.map((game) => game.title));
  assert.equal(activeExpanded.unfinishedToggle.text, "Show latest 5");
  assert.equal(activeExpanded.unfinishedToggle.label, "Show latest 5 unfinished games");
  assert.equal(activeExpanded.unfinishedToggle.expanded, "true");
  assert.equal(activeExpanded.unfinishedToggle.focused, true, "the freshly rendered toggle keeps focus");
  assert.equal((await readSavedGamesState(cdp, STORAGE_KEY)).raw, seededRaw,
    "expanding the preview never writes storage");

  await click(cdp, "[data-action='toggle-unfinished-games']");
  const activeCollapsedAgain = await readDashboard(cdp);
  assert.equal(activeCollapsedAgain.unfinishedTitles.length, 5, "collapsing restores the five-card preview");
  assert.equal(activeCollapsedAgain.unfinishedToggle.text, "View all (7)");
  assert.equal(activeCollapsedAgain.unfinishedToggle.focused, true);

  await click(cdp, "[data-action='toggle-finished-games']");
  const finishedExpanded = await readDashboard(cdp);
  assert.equal(finishedExpanded.finishedTitles.length, 7, "View all expands the finished panel");
  assert.equal(finishedExpanded.finishedToggle.text, "Show latest 5");
  assert.equal(finishedExpanded.finishedToggle.label, "Show latest 5 finished games");
  assert.equal(finishedExpanded.finishedToggle.expanded, "true");
  assert.equal(finishedExpanded.finishedToggle.focused, true);
  assert.equal((await readSavedGamesState(cdp, STORAGE_KEY)).raw, seededRaw,
    "expanding the finished preview never writes storage");
  const expandedScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-dashboard-expanded.png"));

  // ≤5 games in a panel means no toggle and no wrapper.
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
  assert.equal(small.unfinishedToggle, null, "≤5 unfinished games render no toggle");
  assert.equal(small.finishedToggle, null, "≤5 finished games render no toggle");
  assert.equal(await evaluate(cdp, () => Boolean(document.querySelector(".panel-toggle-row"))), false,
    "no toggle wrapper renders without a toggle");

  // 320px: the seeded 7+7 dashboard stacks single-column without overflow.
  await evaluate(cdp, ({ key, raw }) => localStorage.setItem(key, raw), { key: STORAGE_KEY, raw: seededRaw });
  await setViewport(cdp, { width: 320, height: 720, mobile: true });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");
  const mobile = await readDashboard(cdp);
  assert.equal(mobile.columns, 1, "the dashboard is single-column at 320px");
  assert.equal(mobile.stacked, true, "the panels stack at 320px");
  assert.equal(mobile.rowGap, "20px", "the stacked gutter returns to 20px");
  assert.equal(mobile.horizontalOverflow, false, "the dashboard must not overflow at 320px");
  assert.equal(mobile.unfinishedToggle.height >= 44, true);
  assert.equal(mobile.finishedToggle.height >= 44, true);
  const mobileScreenshot = await screenshot(cdp, path.join(evidenceDir, "mobile-dashboard-320px.png"));

  assert.deepEqual(consoleProblems, [], "the dashboard session must not produce uncaught console errors");
  return { collapsedScreenshot, expandedScreenshot, mobileScreenshot };
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

// Session D (Scenario 7): ordered steps (2-left / 1-center-tallest / 3-right)
// plus the ranking-order rest list, ties, a missing rank, and a 20-tied game.
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

  const distinct = await readPodiumState(cdp);
  assert.equal(distinct.labelledBy, "podium-title");
  assert.equal(distinct.describedBy, "podium-lede");
  assert.equal(distinct.titleText, "Final podium");
  assert.equal(distinct.ledeText, "Congratulations to the top of the table.");
  assert.equal(distinct.groupsLabel, "Podium steps");
  assert.deepEqual(distinct.steps.map((step) => step.rank), ["1", "2", "3"]);
  assert.deepEqual(distinct.steps.map((step) => step.heading), ["Rank 1", "Rank 2", "Rank 3"]);
  assert.deepEqual(distinct.steps.map((step) => step.names), [["Alex"], ["Sam"], ["Jamie"]]);
  assert.equal(distinct.restPresent, true, "rank >3 players open the rest section");
  assert.equal(distinct.restTitle, "Rest of the table");
  assert.deepEqual(
    distinct.restRows.map((row) => [row.rank, row.name, row.total, row.totalLabel]),
    [["4", "Taylor", "0", "Taylor: rank 4, total 0"]]
  );
  assert.equal(distinct.restRows[0].tokenLabel, "Player 4, Green");
  assert.equal(distinct.restFocusableCount, 0, "the rest list contains no focusable controls");

  const [rankOne, rankTwo, rankThree] = distinct.steps;
  assert.ok(rankTwo.left < rankOne.left && rankOne.left < rankThree.left,
    "rank 2 sits left, rank 1 center, rank 3 right");
  assert.ok(Math.abs(rankOne.bottom - rankTwo.bottom) <= 1 && Math.abs(rankOne.bottom - rankThree.bottom) <= 1,
    "the steps share a common bottom baseline");
  assert.ok(rankOne.height >= 240 && rankTwo.height >= 180 && rankThree.height >= 150);
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
  const stepsScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-podium-steps-rest.png"));

  // Distinct ranks at 320px: the steps stack in rank order (1 -> 2 -> 3) and
  // reset the desktop columns/heights without forcing page-level overflow.
  await setViewport(cdp, { width: 320, height: 720, mobile: true });
  const distinctMobile = await readPodiumState(cdp);
  assert.equal(distinctMobile.open, true, "the distinct-rank podium stays open at 320px");
  assert.deepEqual(distinctMobile.steps.map((step) => step.rank), ["1", "2", "3"],
    "the distinct-rank steps keep rank order at 320px");
  assert.ok(
    distinctMobile.steps[0].top < distinctMobile.steps[1].top &&
      distinctMobile.steps[1].top < distinctMobile.steps[2].top,
    "the 320px steps stack in rank order (1 -> 2 -> 3)"
  );
  assert.equal(distinctMobile.horizontalOverflow, false, "the 320px distinct-rank podium must not overflow");
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
  assert.deepEqual(missing.steps.map((step) => step.rank), ["1", "3"], "a missing rank renders no step");
  assert.deepEqual(missing.steps.map((step) => step.heading), ["Rank 1", "Rank 3"]);
  assert.deepEqual(missing.steps[0].names, ["Alex", "Sam"], "ties stay inside their step");
  assert.deepEqual(missing.steps[1].names, ["Jamie"]);
  assert.equal(missing.restPresent, false, "no rest section when every player ranks ≤3");
  assert.ok(!missing.steps.some((step) => step.rank === "2"), "no fabricated rank-2 step");
  const missingScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-podium-missing-rank.png"));
  await pressEscape(cdp);
  await waitForAbsent(cdp, "[data-podium-dialog]");

  // Twenty tied players: one rank-1 step, no rest list, internal scroll.
  await goHome(cdp);
  await createGame(cdp, "Twenty tied night", Array.from({ length: 20 }, (_, index) => `Player ${index + 1}`));
  await finishWithPodium(cdp);

  const twenty = await readPodiumState(cdp);
  assert.deepEqual(twenty.steps.map((step) => step.rank), ["1"]);
  assert.equal(twenty.steps[0].names.length, 20, "all 20 tied players stay in one step");
  assert.equal(twenty.restPresent, false);
  assert.ok(twenty.dialogScroll.scrollHeight > twenty.dialogScroll.clientHeight,
    "the 20-tied podium scrolls internally at desktop");
  assert.equal(twenty.horizontalOverflow, false);
  const desktopTwentyScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-podium-20-tied.png"));

  await setViewport(cdp, { width: 320, height: 720, mobile: true });
  const twentyMobile = await readPodiumState(cdp);
  assert.equal(twentyMobile.open, true);
  assert.equal(twentyMobile.steps.length, 1);
  assert.equal(twentyMobile.steps[0].names.length, 20);
  assert.equal(twentyMobile.restPresent, false);
  assert.ok(twentyMobile.dialogScroll.scrollHeight > twentyMobile.dialogScroll.clientHeight,
    "the 20-tied podium scrolls internally at 320px");
  assert.equal(twentyMobile.horizontalOverflow, false, "the 320px podium must not overflow");
  assert.equal(twentyMobile.actionCount, 3);
  const mobileTwentyScreenshot = await screenshot(cdp, path.join(evidenceDir, "mobile-podium-20-tied-320px.png"));

  await pressEscape(cdp);
  await waitForAbsent(cdp, "[data-podium-dialog]");

  assert.deepEqual(consoleProblems, [], "the podium session must not produce uncaught console errors");
  return { stepsScreenshot, missingScreenshot, desktopTwentyScreenshot, mobileTwentyScreenshot };
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

    console.log("Browser refine-ui test passed: the Dashboard removes the Local pill, keeps the retention note, uses a 32px desktop gutter with no divider, previews five games per panel behind a per-panel View all (N)/Show latest 5 toggle (aria-expanded/aria-controls, focus retained, byte-identical storage, no toggle at ≤5, 320px stacking); quick counters stage one clamped combined draft with no totals/ranks/feedback/recent/storage change and Save applies it as one change (the shared stepper contract remains covered by browser-quick-score); whole active rows select through the same path as Add points while finished rows stay inert; Finish game sits in the active header with the unchanged prompt below the header/above the leaderboard and all ids/copy/focus at desktop and 320px; Recent entries caps at five while the full log persists; the podium renders ordered 2-left/1-center-tallest/3-right steps plus a ranking-order Rest of the table list, preserves ties and missing ranks, stacks distinct ranks in order at 320px, and keeps the dialog shell/actions/confetti/focus behavior; finished standings use one full-width grid track with no empty score-panel column at 1280x800 and 320x720; zero uncaught console errors.");
    console.log(`Browser evidence screenshots: ${[
      dashboard.collapsedScreenshot,
      dashboard.expandedScreenshot,
      dashboard.mobileScreenshot,
      scoring.finishedScreenshot,
      finishHeader.desktopScreenshot,
      finishHeader.mobileScreenshot,
      podium.stepsScreenshot,
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
