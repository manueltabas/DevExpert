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
const evidenceDir = await createEvidenceDir("devexpert-refresh-design-system");
const server = createStaticServer();
const baseUrl = await listen(server);

const EMPTY_EYEBROW = "Active game";
const EMPTY_HEADING = "No game in progress";
const EMPTY_BODY = "Start a new game to begin tracking scores. It will appear here until it's finished.";
const NAV_LABELS = ["Dashboard", "New Game", "Active Game"];
const INVALID_NOTICE = "Saved game data couldn't be read, so saved games can't be shown and new changes won't be saved. Nothing was deleted. Reloading the page will try again.";

const FONT_NOISE_PATTERNS = ["fonts.googleapis.com", "fonts.gstatic.com", "ERR_BLOCKED", "Failed to load resource"];

function isBlockedFontNoise(text) {
  return typeof text === "string" && FONT_NOISE_PATTERNS.some((pattern) => text.includes(pattern));
}

async function runSession(sessionName, run, { setupSource = "", allowBlockedFontNoise = false } = {}) {
  const userDataDir = path.join(evidenceDir, sessionName);
  const launched = await launchChrome({ chromePath, userDataDir, url: "about:blank" });

  try {
    const cdp = await CdpClient.connect(launched.webSocketUrl);
    const consoleProblems = [];
    cdp.on("Runtime.exceptionThrown", (event) => {
      consoleProblems.push(event.exceptionDetails?.text ?? "Runtime exception");
    });
    cdp.on("Log.entryAdded", (event) => {
      if (event.entry?.level !== "error") {
        return;
      }
      const text = event.entry.text ?? "";
      // The offline session deliberately blocks the font hosts; the resulting
      // resource-load log lines are the expected degradation path, not failures.
      if (allowBlockedFontNoise && isBlockedFontNoise(text)) {
        return;
      }
      consoleProblems.push(text);
    });

    await cdp.send("Runtime.enable");
    await cdp.send("Log.enable");
    await cdp.send("Page.enable");

    if (setupSource) {
      await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: setupSource });
    }

    const result = await run(cdp, { consoleProblems });
    assert.deepEqual(consoleProblems, [], `${sessionName} must not produce uncaught console errors`);
    return result ?? {};
  } finally {
    launched.chrome.kill("SIGTERM");
  }
}

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

async function finishGame(cdp) {
  await click(cdp, "[data-action='open-finish']");
  await waitForSelector(cdp, "[data-action='confirm-finish']");
  await click(cdp, "[data-action='confirm-finish']");
  await waitForSelector(cdp, "[data-finished-note]");
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

// Shared readers -------------------------------------------------------------

async function readNavState(cdp) {
  return evaluate(cdp, () => {
    const buttons = [...document.querySelectorAll(".top-nav .nav-item")];
    const nav = document.querySelector(".top-nav");
    const brand = document.querySelector(".brand-block");
    const navRect = nav?.getBoundingClientRect() ?? null;
    const brandRect = brand?.getBoundingClientRect() ?? null;
    return {
      count: buttons.length,
      labels: buttons.map((button) => button.textContent.trim()),
      current: buttons
        .filter((button) => button.getAttribute("aria-current") === "page")
        .map((button) => button.dataset.action),
      exactlyOneCurrent: buttons.filter((button) => button.getAttribute("aria-current") !== null).length === 1,
      heights: buttons.map((button) => button.getBoundingClientRect().height),
      navVisible: Boolean(nav && navRect.height > 0 && nav.offsetParent !== null),
      navBelowBrand: Boolean(navRect && brandRect && navRect.top >= brandRect.bottom),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
}

async function readActiveEmptyState(cdp) {
  return evaluate(cdp, () => {
    const heading = document.querySelector(".active-empty h2");
    const button = document.querySelector(".active-empty [data-action='new-game']");
    return {
      present: Boolean(document.querySelector(".active-empty")),
      eyebrow: document.querySelector(".active-empty .eyebrow")?.textContent?.trim() ?? null,
      heading: heading?.textContent?.trim() ?? null,
      headingTabbable: heading?.getAttribute("tabindex") ?? null,
      headingMarked: heading?.hasAttribute("data-active-empty-heading") ?? false,
      body: heading?.nextElementSibling?.textContent?.trim() ?? null,
      buttonLabel: button?.textContent?.trim() ?? null,
      buttonHeight: button?.getBoundingClientRect().height ?? 0,
      activeHeadingPresent: Boolean(document.querySelector("[data-active-heading]")),
      focusOnEmptyHeading: Boolean(document.activeElement && document.activeElement.hasAttribute("data-active-empty-heading")),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
}

async function readFocusState(cdp, attribute) {
  return evaluate(cdp, (focusAttribute) => {
    const active = document.activeElement;
    const style = active ? getComputedStyle(active) : null;
    return {
      action: active?.dataset?.action ?? null,
      marked: focusAttribute ? Boolean(active?.hasAttribute?.(focusAttribute)) : null,
      isSkipLink: Boolean(active?.classList?.contains("skip-link")),
      outlineStyle: style?.outlineStyle ?? null,
      outlineWidth: style?.outlineWidth ?? null
    };
  }, attribute);
}

async function readTokenState(cdp) {
  return evaluate(cdp, () => {
    const primary = document.querySelector(".primary-action");
    const currentNav = document.querySelector(".nav-item[aria-current='page']");
    const panel = document.querySelector(".panel");
    const eyebrow = document.querySelector(".eyebrow");
    const styleOf = (element) => (element ? getComputedStyle(element) : null);
    return {
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      bodyFontFamily: getComputedStyle(document.body).fontFamily,
      bodyFontSize: getComputedStyle(document.body).fontSize,
      bodyFontWeight: getComputedStyle(document.body).fontWeight,
      primaryBackground: primary ? styleOf(primary).backgroundColor : null,
      primaryColor: primary ? styleOf(primary).color : null,
      currentNavBackground: currentNav ? styleOf(currentNav).backgroundColor : null,
      currentNavColor: currentNav ? styleOf(currentNav).color : null,
      panelBorderColor: panel ? styleOf(panel).borderTopColor : null,
      eyebrowTransform: eyebrow ? styleOf(eyebrow).textTransform : null
    };
  });
}

// Every control the spec's Scenario 5 lists, measured wherever it renders.
const INTERACTIVE_SELECTORS = [
  ["nav items", ".top-nav .nav-item"],
  ["hero or empty-state New game", "[data-action='new-game']"],
  ["Resume card control", "[data-action='resume-game']"],
  ["View results card control", "[data-action='view-results']"],
  ["Add points row control", ".add-points-action"],
  ["Save points", "[data-score-form] button[type='submit']"],
  ["Undo last score", "[data-action='undo-last-score']"],
  ["Finish opener", "[data-action='open-finish']"],
  ["Finish confirm", "[data-action='confirm-finish']"],
  ["Cancel finish", "[data-action='cancel-finish']"],
  ["Play again", "[data-action='play-again']"],
  ["Close podium", "[data-action='close-podium']"],
  ["All games back control", "[data-action='back-home']"],
  ["Add player", "[data-action='add-player']"]
];

async function assertInteractiveTargets(cdp, label) {
  const metrics = await evaluate(cdp, (selectors) => {
    return selectors.map(([name, selector]) => {
      const nodes = [...document.querySelectorAll(selector)];
      return {
        name,
        count: nodes.length,
        minWidth: nodes.length ? Math.min(...nodes.map((node) => node.getBoundingClientRect().width)) : null,
        minHeight: nodes.length ? Math.min(...nodes.map((node) => node.getBoundingClientRect().height)) : null
      };
    });
  }, INTERACTIVE_SELECTORS);

  for (const metric of metrics) {
    if (metric.count === 0) {
      continue; // controls that belong to other views are simply absent here
    }
    assert.ok(
      metric.minHeight >= 44 && metric.minWidth >= 44,
      `${label}: ${metric.name} needs a >=44px target (got ${metric.minWidth}x${metric.minHeight})`
    );
  }
}

async function assertNoHorizontalOverflow(cdp, label) {
  const overflow = await evaluate(cdp, () => ({
    document: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    body: document.body.scrollWidth > document.body.clientWidth
  }));
  assert.equal(overflow.document, false, `${label} must not overflow horizontally (documentElement)`);
  assert.equal(overflow.body, false, `${label} must not overflow horizontally (body)`);
}

function buildSeededGame({ id, title, status, createdAt, updatedAt, totals }) {
  const game = {
    id,
    title,
    status,
    createdAt,
    changes: [],
    players: ["Alex", "Sam", "Jamie"].map((name, index) => ({
      id: `${id}-player-${index + 1}`,
      name,
      color: ["blue", "red", "green"][index],
      marker: String(index + 1),
      order: index,
      total: totals[index] ?? 0
    }))
  };

  if (updatedAt) {
    game.updatedAt = updatedAt;
  }

  return game;
}

function buildSeededEnvelope(games) {
  return JSON.stringify({ version: 1, games });
}

// Session 1 (Scenario 6): the font hosts are blocked at the network level and the
// declared stack, hierarchy, tabular numerals, and layout must all degrade intact.
async function runOfflineFontSession(cdp, { consoleProblems }) {
  await cdp.send("Network.enable");
  await cdp.send("Network.setBlockedURLs", {
    urls: ["*fonts.googleapis.com*", "*fonts.gstatic.com*"]
  });

  const blockedRequests = [];
  cdp.on("Network.loadingFailed", (event) => {
    // Chrome reports inspector-blocked requests with a blockedReason and an
    // empty errorText, so both shapes are matched here.
    if ((event.errorText ?? "").includes("BLOCKED") || event.blockedReason) {
      blockedRequests.push(event.blockedReason ?? event.errorText ?? "blocked");
    }
  });

  // Desktop home, fonts blocked.
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");
  assert.ok(blockedRequests.length > 0, "the offline session must actually block the font hosts");

  const desktopTokens = await readTokenState(cdp);
  assert.ok(
    desktopTokens.bodyFontFamily.startsWith('"Plus Jakarta Sans"'),
    `the declared stack must name Plus Jakarta Sans first (got ${desktopTokens.bodyFontFamily})`
  );
  assert.ok(desktopTokens.bodyFontFamily.includes("ui-rounded"), "the rounded system fallback must follow");
  assert.ok(desktopTokens.bodyFontFamily.includes("system-ui"), "the generic system fallback must follow");

  const hierarchy = await evaluate(cdp, () => {
    const body = getComputedStyle(document.body);
    const heroHeading = document.querySelector(".hero-copy h2");
    const panelHeading = document.querySelector(".panel h2");
    return {
      bodySize: Number.parseFloat(body.fontSize),
      bodyWeight: Number.parseInt(body.fontWeight, 10),
      heroSize: heroHeading ? Number.parseFloat(getComputedStyle(heroHeading).fontSize) : null,
      heroWeight: heroHeading ? Number.parseInt(getComputedStyle(heroHeading).fontWeight, 10) : null,
      panelSize: panelHeading ? Number.parseFloat(getComputedStyle(panelHeading).fontSize) : null
    };
  });
  assert.ok(hierarchy.heroSize > hierarchy.bodySize, "headings must stay larger than body with the fallback font");
  assert.ok(hierarchy.heroWeight > hierarchy.bodyWeight, "headings must stay bolder than body with the fallback font");
  assert.ok(hierarchy.panelSize > hierarchy.bodySize, "panel headings must stay larger than body");
  assert.equal(desktopTokens.eyebrowTransform, "uppercase", "the small-caps eyebrow treatment must survive offline");
  await assertNoHorizontalOverflow(cdp, "offline desktop home");

  // Active view with the fallback font: numerals stay tabular and readable.
  await createGame(cdp, "Offline fonts", ["Alex", "Sam"]);
  const offlineActive = await evaluate(cdp, () => {
    const total = document.querySelector(".active-player-total");
    const rank = document.querySelector(".active-player-rank");
    const cardHeading = document.querySelector(".roster-panel h3");
    return {
      totalVariant: getComputedStyle(total).fontVariantNumeric,
      totalSize: Number.parseFloat(getComputedStyle(total).fontSize),
      rankVisible: rank.clientHeight > 0 && Number.parseFloat(getComputedStyle(rank).fontSize) > 0,
      cardHeadingSize: cardHeading ? Number.parseFloat(getComputedStyle(cardHeading).fontSize) : null
    };
  });
  assert.ok(
    offlineActive.totalVariant.includes("tabular-nums"),
    "totals must keep tabular numerals with the fallback font"
  );
  assert.ok(offlineActive.totalSize >= 20, "score numerals must stay large with the fallback font");
  assert.equal(offlineActive.rankVisible, true);
  assert.ok(offlineActive.cardHeadingSize > 16, "card headings keep their hierarchy step offline");
  await assertNoHorizontalOverflow(cdp, "offline desktop active view");

  // 320px: the fallback layout must not overflow on any view.
  await setViewport(cdp, { width: 320, height: 720, mobile: true });
  await assertNoHorizontalOverflow(cdp, "offline 320px active view");
  const offlineNav = await readNavState(cdp);
  assert.equal(offlineNav.navVisible, true, "the nav stays visible offline at 320px");
  assert.equal(offlineNav.navBelowBrand, true, "the nav row must stack below the brand row at 320px");

  await click(cdp, "[data-action='back-home']");
  await waitForSelector(cdp, "[data-home-heading]");
  await assertNoHorizontalOverflow(cdp, "offline 320px home");
  await click(cdp, "[data-action='nav-new-game']");
  await waitForSelector(cdp, "#setup-title");
  await assertNoHorizontalOverflow(cdp, "offline 320px setup");

  const offline320Screenshot = await screenshot(cdp, path.join(evidenceDir, "offline-fonts-setup-320px.png"));

  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  const offlineDesktopScreenshot = await screenshot(cdp, path.join(evidenceDir, "offline-fonts-home-desktop.png"));

  // Whatever reached consoleProblems here is already filtered to non-font noise
  // by the session runner; assert it empty again for a local, readable failure.
  assert.deepEqual(consoleProblems, [], "blocking the web fonts must not produce JavaScript errors");

  return { offlineDesktopScreenshot, offline320Screenshot };
}

// Session 2 (Scenarios 1 + 5): the token layer and per-view layout at both widths.
async function runTokensAndLayoutSession(cdp) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  const desktopTokens = await readTokenState(cdp);
  assert.equal(desktopTokens.bodyBackground, "rgb(250, 245, 235)", "the canvas must be the warm ivory token");
  assert.equal(desktopTokens.primaryBackground, "rgb(8, 104, 201)", "the primary action uses the primary-container token");
  assert.equal(desktopTokens.primaryColor, "rgb(255, 255, 255)", "the primary action keeps white text");
  assert.equal(desktopTokens.currentNavBackground, "rgb(8, 104, 201)", "the current nav segment uses the primary surface");
  assert.equal(desktopTokens.currentNavColor, "rgb(255, 255, 255)");
  assert.equal(desktopTokens.panelBorderColor, "rgb(193, 198, 213)", "cards use the cool outline token");
  assert.equal(desktopTokens.eyebrowTransform, "uppercase");
  assert.ok(desktopTokens.bodyFontFamily.startsWith('"Plus Jakarta Sans"'));

  const navDesktop = await readNavState(cdp);
  assert.equal(navDesktop.count, 3);
  assert.deepEqual(navDesktop.labels, NAV_LABELS);
  assert.deepEqual(navDesktop.current, ["nav-dashboard"], "home marks Dashboard current");
  assert.equal(navDesktop.exactlyOneCurrent, true);
  assert.equal(navDesktop.navVisible, true, "the top navigation must be visible on home");
  assert.ok(Math.min(...navDesktop.heights) >= 44, "nav items need >=44px targets");
  await assertInteractiveTargets(cdp, "desktop home");
  await assertNoHorizontalOverflow(cdp, "desktop home");
  const desktopHomeScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-home-v2.png"));

  // Active view tokens.
  await createGame(cdp, "Token tour", ["Alex", "Sam"]);
  const activeTokens = await evaluate(cdp, () => {
    const selected = document.querySelector(".active-player.is-selected");
    const rank = document.querySelector(".active-player-rank");
    const total = document.querySelector(".active-player-total");
    const rankStyle = getComputedStyle(rank);
    const totalStyle = getComputedStyle(total);
    return {
      selectedBackground: selected ? getComputedStyle(selected).backgroundColor : null,
      rankSize: rankStyle.fontSize,
      totalSize: totalStyle.fontSize,
      rankWeight: rankStyle.fontWeight,
      totalVariant: totalStyle.fontVariantNumeric
    };
  });
  assert.equal(activeTokens.selectedBackground, "rgb(214, 227, 255)", "the selected row uses the soft primary tint");
  assert.equal(activeTokens.rankSize, "28px", "rank numerals use the score type token at desktop");
  assert.equal(activeTokens.totalSize, "28px");
  assert.equal(activeTokens.rankWeight, "800");
  assert.ok(activeTokens.totalVariant.includes("tabular-nums"));
  await assertInteractiveTargets(cdp, "desktop active view");
  await assertNoHorizontalOverflow(cdp, "desktop active view");

  // The finish prompt maps the tertiary accent family.
  await click(cdp, "[data-action='open-finish']");
  await waitForSelector(cdp, "[data-action='confirm-finish']");
  const finishTokens = await evaluate(cdp, () => {
    const action = getComputedStyle(document.querySelector(".finish-action"));
    const prompt = getComputedStyle(document.querySelector(".finish-prompt"));
    const warning = getComputedStyle(document.querySelector(".finish-prompt-warning"));
    return {
      actionColor: action.color,
      actionBackground: action.backgroundColor,
      promptBackground: prompt.backgroundColor,
      warningColor: warning.color
    };
  });
  assert.equal(finishTokens.actionColor, "rgb(136, 58, 0)", "the finish action uses the tertiary on-tint text");
  assert.equal(finishTokens.actionBackground, "rgb(255, 229, 217)");
  assert.equal(finishTokens.promptBackground, "rgb(255, 229, 217)");
  assert.equal(finishTokens.warningColor, "rgb(136, 58, 0)");
  await assertInteractiveTargets(cdp, "desktop finish prompt");

  // Info feedback keeps the suite-frozen muted token (Decision 6).
  await click(cdp, "[data-action='cancel-finish']");
  await waitForSelector(cdp, "[data-action='open-finish']");
  await click(cdp, "[data-action='undo-last-score']");
  await evaluate(cdp, () => {
    if (!document.querySelector("#score-feedback .info-message")) {
      throw new Error("the nothing-to-undo info message did not render");
    }
  });
  const infoColor = await evaluate(cdp, () => getComputedStyle(document.querySelector("#score-feedback .info-message")).color);
  assert.equal(infoColor, "rgb(109, 101, 92)", "info feedback must keep the frozen muted token color");

  // Finish so the podium, finished view, and Play again are all measurable.
  await finishGame(cdp);
  await evaluate(cdp, () => {
    if (!document.querySelector("[data-action='close-podium']")) {
      throw new Error("the podium dialog did not open after finishing");
    }
  });
  await assertInteractiveTargets(cdp, "desktop podium");
  await click(cdp, "[data-action='close-podium']");
  await waitForSelector(cdp, "[data-action='play-again']");
  const finishedNav = await readNavState(cdp);
  assert.deepEqual(finishedNav.current, ["nav-dashboard"], "a finished view marks Dashboard current");
  await assertInteractiveTargets(cdp, "desktop finished view");
  const desktopFinishedScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-finished-v2.png"));

  // 320px: stacking, targets, and the empty state on the same profile.
  await setViewport(cdp, { width: 320, height: 720, mobile: true });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");
  const navMobile = await readNavState(cdp);
  assert.equal(navMobile.navBelowBrand, true, "the nav must stack below the brand at 320px");
  assert.equal(navMobile.horizontalOverflow, false);
  await assertInteractiveTargets(cdp, "320px home");

  const dashboardStacking = await evaluate(cdp, () => {
    const grid = document.querySelector(".dashboard-grid");
    const columns = grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").length : 0;
    const first = document.querySelectorAll(".dashboard-grid > .panel")[0]?.getBoundingClientRect() ?? null;
    const second = document.querySelectorAll(".dashboard-grid > .panel")[1]?.getBoundingClientRect() ?? null;
    return { columns, stacked: Boolean(first && second && second.top >= first.bottom) };
  });
  assert.equal(dashboardStacking.columns, 1, "the dashboard must be single-column at 320px");
  assert.equal(dashboardStacking.stacked, true, "dashboard panels must stack at 320px");

  await click(cdp, "[data-action='nav-new-game']");
  await waitForSelector(cdp, "#setup-title");
  await assertInteractiveTargets(cdp, "320px setup");
  await assertNoHorizontalOverflow(cdp, "320px setup");

  await click(cdp, "[data-action='nav-dashboard']");
  await waitForSelector(cdp, "[data-home-heading]");
  await click(cdp, "[data-action='nav-active-game']");
  await waitForSelector(cdp, "[data-active-empty-heading]");
  const emptyMobile = await readActiveEmptyState(cdp);
  assert.equal(emptyMobile.present, true);
  assert.ok(emptyMobile.buttonHeight >= 44, "the empty-state New game needs a 44px target at 320px");
  await assertNoHorizontalOverflow(cdp, "320px empty state");
  const mobileEmptyScreenshot = await screenshot(cdp, path.join(evidenceDir, "mobile-empty-active-320px.png"));

  return { desktopHomeScreenshot, desktopFinishedScreenshot, mobileEmptyScreenshot };
}

// Session 3 (Scenarios 2 + 3): the nav behavior matrix, including the
// Active Game resolution order and the storage-write absence proof.
async function runNavMatrixSession(cdp) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  let storageState = await readSavedGamesState(cdp, STORAGE_KEY);
  assert.equal(storageState.keyCount, 0, "a fresh profile starts with no storage key");
  let nav = await readNavState(cdp);
  assert.deepEqual(nav.current, ["nav-dashboard"]);

  // (d) No games at all: Active Game shows the locked empty state and writes nothing.
  await click(cdp, "[data-action='nav-active-game']");
  await waitForSelector(cdp, "[data-active-empty-heading]");
  let empty = await readActiveEmptyState(cdp);
  assert.equal(empty.present, true);
  assert.equal(empty.eyebrow, EMPTY_EYEBROW);
  assert.equal(empty.heading, EMPTY_HEADING);
  assert.equal(empty.body, EMPTY_BODY);
  assert.equal(empty.buttonLabel, "New game");
  assert.equal(empty.headingTabbable, "-1", "the empty-state heading must be focusable");
  assert.equal(empty.headingMarked, true);
  assert.equal(empty.activeHeadingPresent, false, "no game view may render here");
  assert.equal(empty.focusOnEmptyHeading, true, "nav must land focus on the empty-state heading");
  nav = await readNavState(cdp);
  assert.deepEqual(nav.current, ["nav-active-game"]);
  storageState = await readSavedGamesState(cdp, STORAGE_KEY);
  assert.equal(storageState.keyCount, 0, "the empty-state navigation must not write storage");

  // The empty-state New game reuses the accepted hero transition.
  await click(cdp, "[data-action='new-game']");
  await waitForSelector(cdp, "#game-title");
  const focusedAfterEmptyNewGame = await evaluate(cdp, () => document.activeElement?.id ?? "");
  assert.equal(focusedAfterEmptyNewGame, "game-title", "the empty-state New game focuses the title field like the hero");
  nav = await readNavState(cdp);
  assert.deepEqual(nav.current, ["nav-new-game"]);

  // Nav New Game is a destination: the setup scratchpad is left as-is.
  await fill(cdp, "#player-name-1", "Alex");
  await click(cdp, "[data-action='nav-dashboard']");
  await waitForSelector(cdp, "[data-home-heading]");
  const homeFocus = await readFocusState(cdp, "data-home-heading");
  assert.equal(homeFocus.marked, true, "Dashboard must focus the home heading");
  nav = await readNavState(cdp);
  assert.deepEqual(nav.current, ["nav-dashboard"]);

  await click(cdp, "[data-action='nav-new-game']");
  await waitForSelector(cdp, "#setup-title");
  const scratchpad = await evaluate(cdp, () => document.querySelector("#player-name-1")?.value ?? null);
  assert.equal(scratchpad, "Alex", "nav New Game must preserve the setup scratchpad");
  const setupFocus = await readFocusState(cdp, "data-setup-heading");
  assert.equal(setupFocus.marked, true, "nav New Game must focus the setup heading");

  // Dashboard clears transient setup errors (back-home semantics).
  await fill(cdp, "#player-name-1", "");
  await click(cdp, "[data-roster-form] button[type='submit']");
  await evaluate(cdp, () => {
    if (document.querySelectorAll("#setup-feedback .validation-message").length === 0) {
      throw new Error("submitting a blank roster must show validation errors");
    }
  });
  await click(cdp, "[data-action='nav-dashboard']");
  await waitForSelector(cdp, "[data-home-heading]");
  await click(cdp, "[data-action='nav-new-game']");
  await waitForSelector(cdp, "#setup-title");
  const errorsAfterNav = await evaluate(cdp, () => document.querySelectorAll("#setup-feedback .validation-message").length);
  assert.equal(errorsAfterNav, 0, "nav Dashboard must clear transient setup errors");

  // (a) A game in progress: Active Game reopens it without a resume round-trip.
  // Superseded by name-game-titles: the setup title field starts empty, so this
  // session fills an explicit title to keep its exact heading assertion (the
  // session tests reopen semantics, not title labels).
  await fill(cdp, "#game-title", "Matrix night");
  await fill(cdp, "#player-name-1", "Alex");
  await fill(cdp, "#player-name-2", "Sam");
  await click(cdp, "[data-roster-form] button[type='submit']");
  await waitForSelector(cdp, "#score-amount");
  await savePoints(cdp, "7");
  nav = await readNavState(cdp);
  assert.deepEqual(nav.current, ["nav-active-game"], "an unfinished game marks Active Game current");
  const rawWithOpenGame = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;

  await click(cdp, "[data-action='nav-dashboard']");
  await waitForSelector(cdp, "[data-home-heading]");
  await click(cdp, "[data-action='nav-active-game']");
  await waitForSelector(cdp, "[data-active-heading]");
  const reopened = await evaluate(cdp, () => ({
    heading: document.querySelector("[data-active-heading]")?.textContent?.trim() ?? "",
    totals: [...document.querySelectorAll(".active-player-total")].map((node) => node.textContent.trim()),
    focusOnHeading: Boolean(document.activeElement?.hasAttribute?.("data-active-heading"))
  }));
  assert.equal(reopened.heading, "Matrix night", "the in-memory game must reopen untouched");
  assert.deepEqual(reopened.totals, ["7", "0"]);
  assert.equal(reopened.focusOnHeading, true, "Active Game must focus the game heading");
  const rawAfterReopen = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
  assert.equal(rawAfterReopen, rawWithOpenGame, "reopening the in-memory game must not write storage");

  await click(cdp, "[data-action='nav-dashboard']");
  await waitForSelector(cdp, "[data-home-heading]");
  const cardCountFromMemory = await evaluate(cdp, () => document.querySelectorAll(".saved-game").length);
  assert.equal(cardCountFromMemory, 1, "the saved game is listed on home");

  // (b) Two saved active games and no open game: the most recently updated resumes.
  const olderStamp = "2026-10-14T10:00:00.000Z";
  const newerStamp = "2026-10-15T09:30:00.000Z";
  const seededTwo = buildSeededEnvelope([
    buildSeededGame({ id: "seed-older", title: "Older night", status: "active", createdAt: olderStamp, updatedAt: olderStamp, totals: [1, 2, 0] }),
    buildSeededGame({ id: "seed-newer", title: "Newer night", status: "active", createdAt: newerStamp, updatedAt: newerStamp, totals: [5, 0, 0] })
  ]);
  await evaluate(cdp, (raw) => {
    localStorage.setItem("scorekeeper:games", raw);
  }, seededTwo);
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");
  const seededCards = await evaluate(cdp, () => [...document.querySelectorAll(".saved-game-title")].map((node) => node.textContent.trim()));
  assert.deepEqual(seededCards, ["Newer night", "Older night"], "the seeded games must list newest first");
  const seededRaw = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;

  await click(cdp, "[data-action='nav-active-game']");
  await waitForSelector(cdp, "[data-active-heading]");
  const resumed = await evaluate(cdp, () => ({
    heading: document.querySelector("[data-active-heading]")?.textContent?.trim() ?? "",
    totals: [...document.querySelectorAll(".active-player-total")].map((node) => node.textContent.trim())
  }));
  assert.equal(resumed.heading, "Newer night", "Active Game must resume the most recently updated active game");
  assert.deepEqual(resumed.totals, ["5", "0", "0"]);
  const rawAfterResume = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
  assert.equal(rawAfterResume, seededRaw, "resuming from the nav must not write storage");

  // (c) Only a finished game: nothing resumes and the finished view is not revisited.
  const seededFinished = buildSeededEnvelope([
    buildSeededGame({ id: "seed-finished", title: "Ended night", status: "finished", createdAt: olderStamp, updatedAt: newerStamp, totals: [9, 3, 1] })
  ]);
  await evaluate(cdp, (raw) => {
    localStorage.setItem("scorekeeper:games", raw);
  }, seededFinished);
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  // A finished view marks Dashboard current (Decision 4).
  await click(cdp, "[data-action='view-results']");
  await waitForSelector(cdp, "[data-active-heading]");
  nav = await readNavState(cdp);
  assert.deepEqual(nav.current, ["nav-dashboard"], "a finished view marks Dashboard current");

  await click(cdp, "[data-action='nav-dashboard']");
  await waitForSelector(cdp, "[data-home-heading]");
  await click(cdp, "[data-action='nav-active-game']");
  await waitForSelector(cdp, "[data-active-empty-heading]");
  empty = await readActiveEmptyState(cdp);
  assert.equal(empty.present, true, "with only a finished game, Active Game shows the empty state");
  assert.equal(empty.activeHeadingPresent, false, "the finished view must not be revisited");
  nav = await readNavState(cdp);
  assert.deepEqual(nav.current, ["nav-active-game"]);
  const rawAfterFinished = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
  assert.equal(rawAfterFinished, seededFinished, "the empty-state navigation must not touch the stored payload");

  const navMatrixScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-nav-empty-state.png"));
  return { navMatrixScreenshot };
}

// Session 4 (Scenario 7, part 1): reduced motion and the skip link contract.
async function runReducedMotionSession(cdp) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  // The skip link is still the first Tab stop with the new header present.
  await pressTab(cdp);
  const skipFocus = await readFocusState(cdp, null);
  assert.equal(skipFocus.isSkipLink, true, "the skip link must remain the first Tab stop");
  assert.notEqual(skipFocus.outlineStyle, "none", "keyboard focus must show a visible outline");
  assert.notEqual(skipFocus.outlineWidth, "0px");

  await cdp.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }]
  });

  await createGame(cdp, "Calm finish", ["Ada", "Bo"]);
  await savePoints(cdp, "5");
  await finishGame(cdp);

  const podium = await evaluate(cdp, () => {
    const dialog = document.querySelector("[data-podium-dialog]");
    const layer = document.querySelector("[data-podium-confetti]");
    const pieces = document.querySelectorAll(".confetti-piece");
    return {
      open: Boolean(dialog?.open),
      confettiDisplay: layer ? getComputedStyle(layer).display : null,
      confettiPieceCount: pieces.length,
      pieceAnimations: [...pieces].map((piece) => getComputedStyle(piece).animationName)
    };
  });
  assert.equal(podium.open, true, "the podium must still open under reduced motion");
  assert.equal(podium.confettiDisplay, "none", "reduced motion must suppress the confetti layer");
  assert.equal(podium.confettiPieceCount, 14, "the confetti markup contract stays");
  assert.ok(
    podium.pieceAnimations.every((name) => name === "podium-fall"),
    "the podium-fall keyframes contract stays"
  );

  await click(cdp, "[data-action='close-podium']");
  await waitForSelector(cdp, "[data-action='play-again']");
  const reducedScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-reduced-motion-podium-dismissed.png"));
  return { reducedScreenshot };
}

// Session 5 (Scenario 7, part 2): storage notices keep their accepted copy and role.
async function runNoticesSession(cdp, { consoleProblems }) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  const notice = await evaluate(cdp, () => {
    const parseRgb = (value) => {
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (!match) {
        return null;
      }
      const parts = match[1].split(",").map((part) => Number.parseFloat(part));
      return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
    };
    const composite = (top, bottom) => ({
      r: top.a * top.r + (1 - top.a) * bottom.r,
      g: top.a * top.g + (1 - top.a) * bottom.g,
      b: top.a * top.b + (1 - top.a) * bottom.b,
      a: top.a + bottom.a * (1 - top.a)
    });
    const luminance = ({ r, g, b }) => {
      const channel = (value) => {
        const scaled = value / 255;
        return scaled <= 0.03928 ? scaled / 12.92 : Math.pow((scaled + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };

    const node = document.querySelector("[data-storage-notice]");
    if (!node) {
      return { present: false };
    }
    const message = node.querySelector(".storage-notice-message") ?? node;
    const foreground = parseRgb(getComputedStyle(message).color);
    let effective = null;
    let walker = node;
    while (walker instanceof Element) {
      const background = parseRgb(getComputedStyle(walker).backgroundColor);
      if (background && background.a > 0) {
        effective = effective ? composite(effective, background) : background;
        if (effective.a >= 1) {
          break;
        }
      }
      walker = walker.parentElement;
    }
    const contrastRatio = foreground && effective
      ? (Math.max(luminance(foreground), luminance(effective)) + 0.05) /
        (Math.min(luminance(foreground), luminance(effective)) + 0.05)
      : null;

    return {
      present: true,
      role: node.getAttribute("role"),
      text: node.textContent.trim(),
      color: getComputedStyle(message).color,
      background: getComputedStyle(node).backgroundColor,
      focusableCount: node.querySelectorAll("a[href], button, input, select, textarea, [tabindex]").length,
      contrastRatio
    };
  });

  assert.equal(notice.present, true, "the corrupt-payload session must show the startup notice");
  assert.equal(notice.role, "status");
  assert.equal(notice.text, INVALID_NOTICE, "the invalid-storage notice copy must stay exactly as accepted");
  assert.equal(notice.color, "rgb(186, 26, 26)", "the notice maps to the v2 error token");
  assert.equal(notice.background, "rgb(255, 218, 214)", "the notice maps to the error container token");
  assert.equal(notice.focusableCount, 0);
  assert.ok(notice.contrastRatio >= 4.5, `the notice must keep AA contrast (got ${notice.contrastRatio})`);

  // Navigation stays display-only with a suppressed read: the payload is untouched.
  await click(cdp, "[data-action='nav-active-game']");
  await waitForSelector(cdp, "[data-active-empty-heading]");
  const empty = await readActiveEmptyState(cdp);
  assert.equal(empty.present, true, "with an unreadable payload, Active Game shows the empty state");
  const payload = await readSavedGamesState(cdp, STORAGE_KEY);
  assert.equal(payload.raw, "not-json{", "navigation must leave the stored bytes untouched");
  assert.equal(payload.keyCount, 1);

  const noticesScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-notice-v2.png"));
  assert.deepEqual(consoleProblems, [], "the notices session must not produce uncaught console errors");
  return { noticesScreenshot };
}

async function main() {
  try {
    const offline = await runSession("fonts-offline", runOfflineFontSession, { allowBlockedFontNoise: true });
    const tokens = await runSession("tokens-and-layout", runTokensAndLayoutSession);
    const navMatrix = await runSession("nav-matrix", runNavMatrixSession);
    const reduced = await runSession("reduced-motion", runReducedMotionSession);
    const notices = await runSession("notices-suppressed", runNoticesSession, {
      setupSource: "localStorage.setItem('scorekeeper:games', 'not-json{');"
    });

    console.log("Browser design system test passed: v2 tokens on every view (ivory canvas, cool cards, primary/tertiary/error mappings, frozen muted info color), Plus Jakarta Sans declared first with a blocked-font fallback that keeps hierarchy/tabular numerals/no overflow at 1280x800 and 320x720, the top nav matrix (labels, aria-current per view including finished -> Dashboard, focus-to-heading, Active Game resolution order in-memory -> newest saved -> locked empty state, byte-identical storage across every navigation, scratchpad-preserving New Game, error-clearing Dashboard, locked empty-state copy), >=44px targets everywhere, visible keyboard focus with the skip link first, and reduced-motion confetti suppression with accepted notice copy/role/contrast.");
    console.log(`Browser evidence screenshots: ${[offline.offlineDesktopScreenshot, offline.offline320Screenshot, tokens.desktopHomeScreenshot, tokens.desktopFinishedScreenshot, tokens.mobileEmptyScreenshot, navMatrix.navMatrixScreenshot, reduced.reducedScreenshot, notices.noticesScreenshot].join(", ")}`);
  } finally {
    await closeServer(server);
  }
}

await main();
