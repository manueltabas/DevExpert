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
const evidenceDir = await createEvidenceDir("devexpert-handle-storage-failure");
const server = createStaticServer();
const baseUrl = await listen(server);

const INVALID_NOTICE = "Saved game data couldn't be read, so saved games can't be shown and new changes won't be saved. Nothing was deleted. Reloading the page will try again.";
const WRITE_NOTICE = "Your latest change couldn't be saved. The game still works, and nothing already saved was lost — your next change will try again.";
const UNAVAILABLE_NOTICE = "Scores aren't being saved because browser storage is unavailable. The game still works, but changes will be lost when you leave this page.";
const DROPPED_NOTICE = "Some saved data couldn't be read and was skipped. Other saved games still work.";
const INVALID_EMPTY_TITLE = "Saved games can't be shown right now.";
const INVALID_EMPTY_BODY = "Nothing was deleted — the saved data just couldn't be read.";

function seedStorageSource(raw) {
  return `
    localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, ${JSON.stringify(raw)});
  `;
}

const THROWING_SET_ITEM_SOURCE = `
  Object.defineProperty(Storage.prototype, "setItem", {
    value: function setItem() {
      throw new Error("Storage is blocked in this test session.");
    },
    writable: true,
    configurable: true
  });
`;

const COUNTED_FAILURE_SOURCE = `
  (() => {
    let calls = 0;
    const original = Storage.prototype.setItem;
    Object.defineProperty(Storage.prototype, "setItem", {
      value: function setItem(key, value) {
        calls += 1;
        if (calls <= 2) {
          throw new Error("Simulated quota failure");
        }
        return original.call(this, key, value);
      },
      writable: true,
      configurable: true
    });
  })();
`;

const UNAVAILABLE_READ_SOURCE = `
  (() => {
    let reads = 0;
    const originalGet = Storage.prototype.getItem;
    Object.defineProperty(Storage.prototype, "getItem", {
      value: function getItem(key) {
        reads += 1;
        if (reads <= 1) {
          throw new Error("Simulated blocked read");
        }
        return originalGet.call(this, key);
      },
      writable: true,
      configurable: true
    });
    let writes = 0;
    const originalSet = Storage.prototype.setItem;
    Object.defineProperty(Storage.prototype, "setItem", {
      value: function setItem(key, value) {
        writes += 1;
        window.storageWriteAttempts = writes;
        return originalSet.call(this, key, value);
      },
      writable: true,
      configurable: true
    });
  })();
`;

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
    const result = await run(cdp, { consoleProblems, warnings });
    assert.deepEqual(consoleProblems, [], `${sessionName} must not produce uncaught console errors`);
    return result ?? {};
  } finally {
    launched.chrome.kill("SIGTERM");
  }
}

function assertCodeOnlyDiagnostics({ warnings, consoleProblems }, forbiddenPattern, sessionLabel) {
  for (const warning of warnings) {
    assert.doesNotMatch(warning, forbiddenPattern, `${sessionLabel} diagnostics must not include names, titles, or scores`);
  }
  assert.deepEqual(consoleProblems, [], `${sessionLabel} must not produce uncaught console errors`);
}

async function readHomeState(cdp) {
  return evaluate(cdp, () => ({
    cards: [...document.querySelectorAll(".saved-game")].map((card) => ({
      gameId: card.dataset.savedGameId ?? "",
      title: card.querySelector(".saved-game-title")?.textContent?.trim() ?? ""
    })),
    emptyStatePresent: Boolean(document.querySelector(".empty-state")),
    emptyTitle: document.querySelector(".empty-state .empty-title")?.textContent?.trim() ?? null,
    emptyBody: document.querySelector(".empty-state .empty-title + p")?.textContent?.trim() ?? null,
    noticePresent: Boolean(document.querySelector("[data-storage-notice]")),
    noticeRole: document.querySelector("[data-storage-notice]")?.getAttribute("role") ?? null,
    noticeText: document.querySelector("[data-storage-notice]")?.textContent?.trim() ?? "",
    droppedNotePresent: Boolean(document.querySelector(".storage-notice-info")),
    droppedNoteText: document.querySelector(".storage-notice-info")?.textContent?.trim() ?? "",
    retentionVisible: (() => {
      const node = document.querySelector(".retention-note");
      return Boolean(node && node.clientHeight > 0 && node.offsetParent !== null);
    })(),
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
  }));
}

async function readActiveState(cdp) {
  return evaluate(cdp, () => ({
    heading: document.querySelector("[data-active-heading]")?.textContent?.trim() ?? "",
    totals: [...document.querySelectorAll(".active-player-total")].map((node) => node.textContent.trim()),
    ranks: [...document.querySelectorAll(".active-player-rank")].map((node) => node.textContent.trim()),
    feedback: document.querySelector("#score-feedback")?.textContent?.trim() ?? "",
    noticePresent: Boolean(document.querySelector("[data-storage-notice]")),
    noticeRole: document.querySelector("[data-storage-notice]")?.getAttribute("role") ?? null,
    noticeText: document.querySelector("[data-storage-notice]")?.textContent?.trim() ?? "",
    droppedNotePresent: Boolean(document.querySelector(".storage-notice-info")),
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
  }));
}

async function readNoticeAccessibility(cdp, selector) {
  return evaluate(cdp, (targetSelector) => {
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

    const notice = document.querySelector(targetSelector);
    if (!notice) {
      return { present: false };
    }

    const message = notice.querySelector(".storage-notice-message") ?? notice;
    const foreground = parseRgb(getComputedStyle(message).color);
    let effective = null;
    let node = notice;
    while (node instanceof Element) {
      const background = parseRgb(getComputedStyle(node).backgroundColor);
      if (background && background.a > 0) {
        effective = effective ? composite(effective, background) : background;
        if (effective.a >= 1) {
          break;
        }
      }
      node = node.parentElement;
    }

    const contrastRatio = foreground && effective
      ? (Math.max(luminance(foreground), luminance(effective)) + 0.05) /
        (Math.min(luminance(foreground), luminance(effective)) + 0.05)
      : null;
    const rect = notice.getBoundingClientRect();

    return {
      present: true,
      role: notice.getAttribute("role"),
      visible: rect.height > 0 && notice.offsetParent !== null,
      focusableCount: notice.querySelectorAll("a[href], button, input, select, textarea, [tabindex]").length,
      contrastRatio
    };
  }, selector);
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

// Scenario 1: blocked writes warn without false confirmation and lose nothing.
async function runBlockedWriteSession(url) {
  return runSession("chrome-profile-blocked-writes", async (cdp, diagnostics) => {
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: THROWING_SET_ITEM_SOURCE });

    await setViewport(cdp, { width: 1280, height: 800, mobile: false });
    await navigate(cdp, url);
    await waitForSelector(cdp, "[data-action='new-game']");

    const freshHome = await readHomeState(cdp);
    assert.equal(freshHome.noticePresent, false, "no notice before any write fails");
    assert.equal(freshHome.cards.length, 0);
    assert.equal(freshHome.emptyTitle, "No saved games yet.");

    await createGame(cdp, "Blocked write game", ["Alex", "Sam"]);
    await savePoints(cdp, "10");

    const blockedActive = await readActiveState(cdp);
    assert.deepEqual(blockedActive.totals, ["10", "0"], "in-memory totals keep working when writes fail");
    assert.deepEqual(blockedActive.ranks, ["1", "2"]);
    assert.equal(
      blockedActive.feedback,
      "Added 10 points to Alex. New total: 10. Rank: 1.",
      "success feedback must be unchanged when only persistence fails"
    );
    assert.equal(blockedActive.noticePresent, true, "the active view must show the write notice");
    assert.equal(blockedActive.noticeRole, "status");
    assert.equal(blockedActive.noticeText, WRITE_NOTICE);
    assert.equal(blockedActive.horizontalOverflow, false);

    const storageAfterBlockedSave = await readSavedGamesState(cdp, STORAGE_KEY);
    assert.equal(storageAfterBlockedSave.keyCount, 0, "a failed write must not create the storage key");

    await goHome(cdp);
    const blockedHome = await readHomeState(cdp);
    assert.equal(blockedHome.noticePresent, true, "home must show the write notice");
    assert.equal(blockedHome.noticeRole, "status");
    assert.equal(blockedHome.noticeText, WRITE_NOTICE);
    assert.equal(blockedHome.cards.length, 0, "a failed save must never render a phantom saved-game card");
    assert.equal(blockedHome.emptyStatePresent, true);
    assert.equal(blockedHome.emptyTitle, "No saved games yet.", "the write failure must not swap the empty-state copy");
    assert.equal(blockedHome.horizontalOverflow, false);

    const desktopNoticeScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-home-write-notice.png"));

    // Scenario 6 (write notice): 320px visibility, role=status, no interaction needed.
    await setViewport(cdp, { width: 320, height: 720, mobile: true });
    await navigate(cdp, url);
    await waitForSelector(cdp, "[data-action='new-game']");
    await createGame(cdp, "Mobile blocked write", ["Alex", "Sam"]);
    await savePoints(cdp, "3");

    const mobileActive = await readActiveState(cdp);
    assert.equal(mobileActive.noticePresent, true);
    assert.equal(mobileActive.noticeText, WRITE_NOTICE);

    const mobileA11y = await readNoticeAccessibility(cdp, "[data-storage-notice]");
    assert.equal(mobileA11y.present, true);
    assert.equal(mobileA11y.visible, true, "the write notice must stay visible at 320px");
    assert.equal(mobileA11y.role, "status", "the write notice must use role=status for polite announcement");
    assert.equal(mobileA11y.focusableCount, 0, "the notice must require no interaction");
    assert.ok(mobileA11y.contrastRatio >= 4.5, `notice contrast must meet AA (got ${mobileA11y.contrastRatio})`);
    assert.equal(mobileActive.horizontalOverflow, false, "the write notice must not overflow at 320px");

    const mobileNoticeScreenshot = await screenshot(cdp, path.join(evidenceDir, "mobile-write-notice-320px.png"));

    assert.ok(
      diagnostics.warnings.some((warning) => warning.includes("Game save failed")),
      "a blocked save must log the code-only diagnostic"
    );
    assertCodeOnlyDiagnostics(diagnostics, /Alex|Sam|Blocked write game|Mobile blocked write|total 10|points/, "blocked writes session");
    return { desktopNoticeScreenshot, mobileNoticeScreenshot };
  });
}

// Scenarios 2 and 6 (invalid notice): corrupt payload is preserved and disclosed.
async function runCorruptPayloadSession(url) {
  return runSession("chrome-profile-corrupt-payload", async (cdp, diagnostics) => {
    const seededScript = await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: seedStorageSource("not-json{")
    });

    // 320px pass first: notice visibility, role, contrast, no keyboard trap.
    await setViewport(cdp, { width: 320, height: 720, mobile: true });
    await navigate(cdp, url);
    await waitForSelector(cdp, "[data-action='new-game']");

    const mobileHome = await readHomeState(cdp);
    assert.equal(mobileHome.noticePresent, true, "a corrupt stored payload must show the invalid notice at startup");
    assert.equal(mobileHome.noticeRole, "status");
    assert.equal(mobileHome.noticeText, INVALID_NOTICE);
    assert.equal(mobileHome.emptyStatePresent, true);
    assert.equal(mobileHome.emptyTitle, INVALID_EMPTY_TITLE, "the empty-state copy must swap under write suppression");
    assert.equal(mobileHome.emptyBody, INVALID_EMPTY_BODY);
    assert.equal(mobileHome.cards.length, 0, "an unreadable payload must not list any saved games");
    assert.equal(mobileHome.droppedNotePresent, false, "an envelope-level failure is not a dropped-entry case");
    assert.equal(mobileHome.retentionVisible, true);
    assert.equal(mobileHome.horizontalOverflow, false, "the invalid notice must not overflow at 320px");

    const mobileA11y = await readNoticeAccessibility(cdp, "[data-storage-notice]");
    assert.equal(mobileA11y.visible, true);
    assert.equal(mobileA11y.role, "status");
    assert.equal(mobileA11y.focusableCount, 0, "the notice must require no interaction and trap no focus");
    assert.ok(mobileA11y.contrastRatio >= 4.5, `notice contrast must meet AA (got ${mobileA11y.contrastRatio})`);

    const mobileNoticeScreenshot = await screenshot(cdp, path.join(evidenceDir, "mobile-home-invalid-320px.png"));

    const newGameButton = await evaluate(cdp, () => {
      const button = document.querySelector("[data-action='new-game']");
      button?.focus();
      return button ? button.getBoundingClientRect().height : 0;
    });
    assert.ok(newGameButton >= 44, "existing controls keep their 44px target beside the notice");
    await pressEnter(cdp);
    await waitForSelector(cdp, "#game-title");

    const mobileKeyboardScreenshot = await screenshot(cdp, path.join(evidenceDir, "mobile-invalid-setup-keyboard-320px.png"));

    // Desktop pass: suppression keeps every byte of the stored payload intact.
    await setViewport(cdp, { width: 1280, height: 800, mobile: false });
    await navigate(cdp, url);
    await waitForSelector(cdp, "[data-action='new-game']");

    const rawBefore = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
    assert.equal(rawBefore, "not-json{", "the corrupt payload must reach the app unchanged");

    const desktopHome = await readHomeState(cdp);
    assert.equal(desktopHome.noticePresent, true);
    assert.equal(desktopHome.noticeText, INVALID_NOTICE);
    assert.equal(desktopHome.emptyTitle, INVALID_EMPTY_TITLE);
    assert.equal(desktopHome.emptyBody, INVALID_EMPTY_BODY);
    assert.equal(desktopHome.cards.length, 0);

    const desktopHomeScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-home-invalid.png"));

    await createGame(cdp, "Corrupt payload game", ["Alex", "Sam"]);
    await savePoints(cdp, "10");

    const corruptActive = await readActiveState(cdp);
    assert.deepEqual(corruptActive.totals, ["10", "0"], "in-memory play keeps working on an unreadable payload");
    assert.deepEqual(corruptActive.ranks, ["1", "2"]);
    assert.equal(
      corruptActive.feedback,
      "Added 10 points to Alex. New total: 10. Rank: 1.",
      "success feedback must be unchanged while writes are suppressed"
    );
    assert.equal(corruptActive.noticePresent, true, "the active view carries the persistence warning");
    assert.equal(corruptActive.noticeText, INVALID_NOTICE);
    assert.equal(corruptActive.droppedNotePresent, false);

    const rawAfterSave = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
    assert.equal(rawAfterSave, rawBefore, "a suppressed save must leave the stored payload byte-identical");

    await click(cdp, "[data-action='undo-last-score']");
    const afterUndo = await readActiveState(cdp);    assert.match(afterUndo.feedback, /Undid 10 points for Alex\. New total: 0\. Rank: 1\./);
    assert.equal(afterUndo.noticeText, INVALID_NOTICE, "the invalid notice stays while suppression holds");

    const rawAfterUndo = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
    assert.equal(rawAfterUndo, rawBefore, "every suppressed mutation must leave the payload byte-identical");

    await goHome(cdp);
    const homeAfterSuppressedSaves = await readHomeState(cdp);
    assert.equal(homeAfterSuppressedSaves.cards.length, 0, "suppressed saves must not render phantom cards");
    assert.equal(homeAfterSuppressedSaves.noticePresent, true);
    assert.equal(homeAfterSuppressedSaves.noticeText, INVALID_NOTICE);

    const rawAfterHome = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
    assert.equal(rawAfterHome, rawBefore);

    // Reload without the seeding script: the real stored payload must survive the session.
    await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: seededScript.identifier });
    await navigate(cdp, url);
    await waitForSelector(cdp, "[data-action='new-game']");

    const rawAfterReload = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
    assert.equal(rawAfterReload, rawBefore, "reloading must re-read and still preserve the original bytes");
    const reloadedHome = await readHomeState(cdp);
    assert.equal(reloadedHome.noticePresent, true, "the invalid notice returns after a fresh read attempt");
    assert.equal(reloadedHome.noticeText, INVALID_NOTICE);
    assert.equal(reloadedHome.emptyTitle, INVALID_EMPTY_TITLE);
    assert.equal(reloadedHome.cards.length, 0);

    assert.ok(
      diagnostics.warnings.some((warning) => warning.includes("Saved game load failed")),
      "the failed startup read must log the code-only diagnostic"
    );
    assert.ok(
      diagnostics.warnings.some((warning) => warning.includes("Game save failed")),
      "each suppressed save must log the code-only diagnostic"
    );
    assertCodeOnlyDiagnostics(diagnostics, /Alex|Sam|Corrupt payload game|points/, "corrupt payload session");
    return { mobileNoticeScreenshot, mobileKeyboardScreenshot, desktopHomeScreenshot };
  });
}

// Scenario 3: incompatible saved payload behaves like corrupt data.
async function runVersionTwoPayloadSession(url) {
  return runSession("chrome-profile-version-two-payload", async (cdp, diagnostics) => {
    const versionTwoPayload = JSON.stringify({ version: 2, games: [] });
    const seededScript = await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: seedStorageSource(versionTwoPayload)
    });

    await setViewport(cdp, { width: 1280, height: 800, mobile: false });
    await navigate(cdp, url);
    await waitForSelector(cdp, "[data-action='new-game']");

    const rawBefore = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
    assert.equal(rawBefore, versionTwoPayload);

    const home = await readHomeState(cdp);
    assert.equal(home.noticePresent, true, "an incompatible envelope must show the invalid notice");
    assert.equal(home.noticeRole, "status");
    assert.equal(home.noticeText, INVALID_NOTICE);
    assert.equal(home.emptyTitle, INVALID_EMPTY_TITLE);
    assert.equal(home.emptyBody, INVALID_EMPTY_BODY);
    assert.equal(home.cards.length, 0);
    assert.equal(home.horizontalOverflow, false);

    const desktopHomeScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-home-version-two-invalid.png"));

    await createGame(cdp, "Version two game", ["Alex", "Sam"]);
    await savePoints(cdp, "5");

    const active = await readActiveState(cdp);
    assert.deepEqual(active.totals, ["5", "0"]);
    assert.equal(active.noticePresent, true);
    assert.equal(active.noticeText, INVALID_NOTICE);

    const rawAfterSave = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
    assert.equal(rawAfterSave, rawBefore, "a suppressed save must leave the incompatible payload byte-identical");

    await goHome(cdp);
    const homeAgain = await readHomeState(cdp);
    assert.equal(homeAgain.cards.length, 0, "suppressed saves must not render phantom cards");
    assert.equal(homeAgain.noticeText, INVALID_NOTICE);

    const rawAfterHome = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
    assert.equal(rawAfterHome, rawBefore);

    await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: seededScript.identifier });
    await navigate(cdp, url);
    await waitForSelector(cdp, "[data-action='new-game']");

    const rawAfterReload = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
    assert.equal(rawAfterReload, rawBefore, "the incompatible payload must survive a reload byte-for-byte");
    const reloadedHome = await readHomeState(cdp);
    assert.equal(reloadedHome.noticePresent, true);
    assert.equal(reloadedHome.noticeText, INVALID_NOTICE);
    assert.equal(reloadedHome.cards.length, 0);

    assert.ok(
      diagnostics.warnings.every((warning) => warning.includes("invalid") || warning.includes("Game save failed")),
      "version-two session warnings must stay code-only"
    );
    assertCodeOnlyDiagnostics(diagnostics, /Alex|Sam|Version two game|points/, "version-two payload session");
    return { desktopHomeScreenshot };
  });
}

// Scenario 4: writes recover when storage works again (counted failures, no reload).
async function runCountedFailureSession(url) {
  return runSession("chrome-profile-counted-failure", async (cdp, diagnostics) => {
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: COUNTED_FAILURE_SOURCE });

    await setViewport(cdp, { width: 1280, height: 800, mobile: false });
    await navigate(cdp, url);
    await waitForSelector(cdp, "[data-action='new-game']");

    const freshHome = await readHomeState(cdp);
    assert.equal(freshHome.noticePresent, false, "no notice before any write fails");

    await createGame(cdp, "Recovery game", ["Alex", "Sam"]);
    const afterFailedStart = await readActiveState(cdp);
    assert.equal(afterFailedStart.noticePresent, true, "the notice appears after the first failed save");
    assert.equal(afterFailedStart.noticeText, WRITE_NOTICE);

    await savePoints(cdp, "10");
    const afterSecondFailure = await readActiveState(cdp);
    assert.deepEqual(afterSecondFailure.totals, ["10", "0"]);
    assert.equal(
      afterSecondFailure.feedback,
      "Added 10 points to Alex. New total: 10. Rank: 1."
    );
    assert.equal(afterSecondFailure.noticePresent, true, "the notice stays after the second failed save");
    assert.equal(afterSecondFailure.noticeText, WRITE_NOTICE);

    const storageBeforeRecovery = await readSavedGamesState(cdp, STORAGE_KEY);
    assert.equal(storageBeforeRecovery.keyCount, 0, "failed writes must not create the key");

    await savePoints(cdp, "5");
    const afterRecovery = await readActiveState(cdp);
    assert.deepEqual(afterRecovery.totals, ["15", "0"], "play continues through the recovery");
    assert.equal(
      afterRecovery.feedback,
      "Added 5 points to Alex. New total: 15. Rank: 1."
    );
    assert.equal(afterRecovery.noticePresent, false, "the first successful save must clear the notice");

    const storageAfterRecovery = await readSavedGamesState(cdp, STORAGE_KEY);
    assert.equal(storageAfterRecovery.keyCount, 1, "the recovery save must create the storage key");
    assert.equal(storageAfterRecovery.keyName, STORAGE_KEY);
    assert.equal(storageAfterRecovery.payloadVersion, 1);
    assert.equal(storageAfterRecovery.gameCount, 1, "the active game must be the only saved game");

    await goHome(cdp);
    const recoveredHome = await readHomeState(cdp);
    assert.equal(recoveredHome.cards.length, 1, "home must list exactly the recovered game");
    assert.equal(recoveredHome.cards[0].title, "Recovery game");
    assert.equal(recoveredHome.noticePresent, false, "no notice remains after recovery");
    assert.equal(recoveredHome.horizontalOverflow, false);

    const desktopScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-home-recovered.png"));

    const saveFailures = diagnostics.warnings.filter((warning) => warning.includes("Game save failed"));
    assert.equal(saveFailures.length, 2, "exactly the two failed saves warn");
    assertCodeOnlyDiagnostics(diagnostics, /Alex|Sam|Recovery game|points/, "counted-failure session");
    return { desktopScreenshot };
  });
}

// Scenario 5: partially corrupted saved data is disclosed; readable games keep working.
async function runPartialCorruptionSession(url) {
  const usableGame = {
    id: "seed-partial-game",
    title: "Partial seed game",
    status: "active",
    createdAt: "2026-10-12T09:00:00.000Z",
    players: [
      { id: "seed-partial-player-1", name: "Alex", color: "blue", marker: "1", order: 0, total: 4 },
      { id: "seed-partial-player-2", name: "Sam", color: "red", marker: "2", order: 1, total: 0 }
    ]
  };
  const partialPayload = JSON.stringify({
    version: 1,
    games: [usableGame, "junk-string-entry", { id: 42, players: [] }]
  });

  return runSession("chrome-profile-partial-corruption", async (cdp, diagnostics) => {
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: seedStorageSource(partialPayload)
    });

    // 320px pass: the dropped note is visible, readable, and needs no interaction.
    await setViewport(cdp, { width: 320, height: 720, mobile: true });
    await navigate(cdp, url);
    await waitForSelector(cdp, "[data-action='new-game']");

    const mobileHome = await readHomeState(cdp);
    assert.equal(mobileHome.cards.length, 1, "the usable game must be listed");
    assert.equal(mobileHome.cards[0].title, "Partial seed game");
    assert.equal(mobileHome.droppedNotePresent, true, "the dropped note must appear on home");
    assert.equal(mobileHome.droppedNoteText, DROPPED_NOTICE);
    assert.equal(mobileHome.noticePresent, false, "a clean envelope read must not show the warning notice");
    assert.equal(mobileHome.horizontalOverflow, false);

    const mobileInfoA11y = await readNoticeAccessibility(cdp, ".storage-notice-info");
    assert.equal(mobileInfoA11y.present, true);
    assert.equal(mobileInfoA11y.visible, true, "the dropped note must stay visible at 320px");
    assert.equal(mobileInfoA11y.focusableCount, 0);
    assert.ok(mobileInfoA11y.contrastRatio >= 4.5, `dropped-note contrast must meet AA (got ${mobileInfoA11y.contrastRatio})`);

    const resumeHeights = await evaluate(cdp, () => {
      return [...document.querySelectorAll("[data-action='resume-game']")].map(
        (button) => button.getBoundingClientRect().height
      );
    });
    assert.ok(resumeHeights.every((height) => height >= 44), "resume controls keep their 44px target beside the note");

    const mobileDroppedScreenshot = await screenshot(cdp, path.join(evidenceDir, "mobile-home-dropped-320px.png"));

    // Desktop: resume works normally and a successful save rewrites only the usable games.
    await setViewport(cdp, { width: 1280, height: 800, mobile: false });
    await navigate(cdp, url);
    await waitForSelector(cdp, "[data-action='new-game']");

    const home = await readHomeState(cdp);
    assert.equal(home.cards.length, 1);
    assert.equal(home.droppedNotePresent, true);
    assert.equal(home.noticePresent, false);

    await click(cdp, "[data-action='resume-game'][data-game-id='seed-partial-game']");
    await waitForSelector(cdp, "#score-amount");

    const resumed = await readActiveState(cdp);
    assert.equal(resumed.heading, "Partial seed game", "resume must work normally for the usable game");
    assert.deepEqual(resumed.totals, ["4", "0"]);
    assert.deepEqual(resumed.ranks, ["1", "2"]);
    assert.equal(resumed.noticePresent, false, "the dropped note is home-only");
    assert.equal(resumed.droppedNotePresent, false);

    await savePoints(cdp, "5");
    const afterSave = await readActiveState(cdp);
    assert.equal(
      afterSave.feedback,
      "Added 5 points to Alex. New total: 9. Rank: 1."
    );
    assert.equal(afterSave.noticePresent, false, "the successful save must not raise a notice");

    const savedState = await readSavedGamesState(cdp, STORAGE_KEY);
    assert.equal(savedState.keyCount, 1);
    assert.equal(savedState.payloadVersion, 1);
    assert.equal(savedState.gameCount, 1, "the rewritten envelope must contain exactly the usable games");
    assert.deepEqual(savedState.savedIds, ["seed-partial-game"]);
    const storedTotals = await evaluate(cdp, () => {
      const payload = JSON.parse(localStorage.getItem("scorekeeper:games"));
      return payload.games.map((game) => game.players.map((player) => player.total));
    });
    assert.deepEqual(storedTotals, [[9, 0]], "the successful save must rewrite the usable game only");

    await goHome(cdp);
    const homeAfterSave = await readHomeState(cdp);
    assert.equal(homeAfterSave.cards.length, 1);
    assert.equal(homeAfterSave.droppedNotePresent, true, "the disclosed skip stays visible for the session");
    assert.equal(homeAfterSave.noticePresent, false);

    const desktopDroppedScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-home-dropped.png"));

    // Two full app loads (320px pass + desktop pass), each dropping the same two entries.
    assert.equal(diagnostics.warnings.length, 4, "each load warns once per skipped entry");
    for (const warning of diagnostics.warnings) {
      assert.ok(warning.includes("Saved game entry skipped"), "skip warnings must stay code-only");
    }
    assertCodeOnlyDiagnostics(diagnostics, /Alex|Sam|Partial seed game|junk/, "partial-corruption session");
    return { mobileDroppedScreenshot, desktopDroppedScreenshot };
  });
}

// Unavailable storage: startup read failure warns immediately; writes are still attempted and recovery clears the error.
async function runUnavailableStorageSession(url) {
  return runSession("chrome-profile-unavailable-read", async (cdp, diagnostics) => {
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: UNAVAILABLE_READ_SOURCE });

    await setViewport(cdp, { width: 320, height: 720, mobile: true });
    await navigate(cdp, url);
    await waitForSelector(cdp, "[data-action='new-game']");

    const mobileHome = await readHomeState(cdp);
    assert.equal(mobileHome.noticePresent, true, "a failed startup read must set the notice immediately");
    assert.equal(mobileHome.noticeRole, "status");
    assert.equal(mobileHome.noticeText, UNAVAILABLE_NOTICE);
    assert.equal(mobileHome.cards.length, 0);
    assert.equal(mobileHome.emptyStatePresent, true);
    assert.equal(mobileHome.emptyTitle, "No saved games yet.", "an unavailable read is not write suppression");
    assert.equal(mobileHome.horizontalOverflow, false);

    const mobileA11y = await readNoticeAccessibility(cdp, "[data-storage-notice]");
    assert.equal(mobileA11y.visible, true);
    assert.equal(mobileA11y.role, "status");
    assert.equal(mobileA11y.focusableCount, 0);
    assert.ok(mobileA11y.contrastRatio >= 4.5, `notice contrast must meet AA (got ${mobileA11y.contrastRatio})`);

    const mobileUnavailableScreenshot = await screenshot(cdp, path.join(evidenceDir, "mobile-unavailable-320px.png"));

    await setViewport(cdp, { width: 1280, height: 800, mobile: false });
    await navigate(cdp, url);
    await waitForSelector(cdp, "[data-action='new-game']");

    const desktopHome = await readHomeState(cdp);
    assert.equal(desktopHome.noticePresent, true);
    assert.equal(desktopHome.noticeText, UNAVAILABLE_NOTICE);

    await createGame(cdp, "Unavailable read game", ["Alex", "Sam"]);
    const writeAttempts = await evaluate(cdp, () => window.storageWriteAttempts ?? 0);
    assert.ok(writeAttempts >= 1, "writes must still be attempted after an unavailable read");

    const afterStart = await readActiveState(cdp);
    assert.equal(afterStart.noticePresent, false, "a successful write must clear the unavailable read error");

    await savePoints(cdp, "10");
    const afterSave = await readActiveState(cdp);
    assert.deepEqual(afterSave.totals, ["10", "0"], "in-memory play keeps working");
    assert.equal(
      afterSave.feedback,
      "Added 10 points to Alex. New total: 10. Rank: 1."
    );
    assert.equal(afterSave.noticePresent, false);

    const storageAfterSave = await readSavedGamesState(cdp, STORAGE_KEY);
    assert.equal(storageAfterSave.keyCount, 1, "the attempted write must have stored the game");
    assert.equal(storageAfterSave.gameCount, 1);

    await goHome(cdp);
    const homeAfterRecovery = await readHomeState(cdp);
    assert.equal(homeAfterRecovery.cards.length, 1);
    assert.equal(homeAfterRecovery.noticePresent, false, "no notice remains once storage proved writable");
    assert.equal(homeAfterRecovery.horizontalOverflow, false);

    assert.ok(
      diagnostics.warnings.some((warning) => warning.includes("Saved game load failed")),
      "the unavailable startup read must log the code-only diagnostic"
    );
    assertCodeOnlyDiagnostics(diagnostics, /Alex|Sam|Unavailable read game|points/, "unavailable storage session");
    return { mobileUnavailableScreenshot };
  });
}

async function main() {
  try {
    const blocked = await runBlockedWriteSession(baseUrl);
    const corrupt = await runCorruptPayloadSession(baseUrl);
    const versionTwo = await runVersionTwoPayloadSession(baseUrl);
    const counted = await runCountedFailureSession(baseUrl);
    const partial = await runPartialCorruptionSession(baseUrl);
    const unavailable = await runUnavailableStorageSession(baseUrl);

    console.log("Browser storage-failure test passed: blocked writes show the role=status write notice on the active view and home with zero phantom cards and no storage key; corrupt and version-two payloads show the invalid notice with the swapped empty state, keep every stored byte identical across suppressed saves and a reload, and never render phantom cards; counted failures recover on the first successful save and clear the notice; partial corruption lists the usable game with the home-only dropped note and rewrites the envelope without the skipped entries; unavailable reads warn at startup, still attempt writes, and clear after a successful save; all notice states pass the 320px visibility, role=status, contrast, and no-interaction checks with code-only diagnostics and no console errors.");
    console.log(`Browser evidence screenshots: ${[
      ...Object.values(blocked),
      ...Object.values(corrupt),
      ...Object.values(versionTwo),
      ...Object.values(counted),
      ...Object.values(partial),
      ...Object.values(unavailable)
    ].join(", ")}`);
  } finally {
    await closeServer(server);
  }
}

await main();
