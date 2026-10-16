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
const evidenceDir = await createEvidenceDir("devexpert-celebrate-podium");
const server = createStaticServer();
const baseUrl = await listen(server);

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

async function finishGame(cdp) {
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

async function readActiveState(cdp) {
  return evaluate(cdp, () => ({
    heading: document.querySelector("[data-active-heading]")?.textContent?.trim() ?? "",
    eyebrow: document.querySelector(".active-header .eyebrow")?.textContent?.trim() ?? "",
    names: [...document.querySelectorAll(".active-player-name")].map((node) => node.textContent.trim()),
    totals: [...document.querySelectorAll(".active-player-total")].map((node) => node.textContent.trim()),
    ranks: [...document.querySelectorAll(".active-player-rank")].map((node) => node.textContent.trim()),
    podiumDialogPresent: Boolean(document.querySelector("[data-podium-dialog]")),
    podiumOpen: Boolean(document.querySelector("[data-podium-dialog]")?.open),
    focusAction: document.activeElement?.dataset?.action ?? null,
    focusOnHeading: Boolean(document.activeElement?.hasAttribute?.("data-active-heading")),
    storageNoticePresent: Boolean(document.querySelector("[data-storage-notice]")),
    storageNoticeRole: document.querySelector("[data-storage-notice]")?.getAttribute("role") ?? null,
    storageNoticeText: document.querySelector("[data-storage-notice]")?.textContent?.trim() ?? "",
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
  }));
}

async function readPodiumState(cdp) {
  return evaluate(cdp, () => {
    const dialog = document.querySelector("[data-podium-dialog]");
    const groups = [...document.querySelectorAll(".podium-group")].map((group) => ({
      heading: group.querySelector(".podium-rank-heading")?.textContent?.trim() ?? "",
      names: [...group.querySelectorAll(".podium-player-name")].map((node) => node.textContent.trim()),
      ranks: [...group.querySelectorAll(".podium-player-rank")].map((node) => node.textContent.trim()),
      totals: [...group.querySelectorAll(".podium-player-total")].map((node) => node.textContent.trim()),
      totalLabels: [...group.querySelectorAll(".podium-player-total")].map((node) => node.getAttribute("aria-label"))
    }));
    const close = document.querySelector("[data-action='close-podium']");
    const layer = document.querySelector("[data-podium-confetti]");
    const pieces = [...document.querySelectorAll(".confetti-piece")];
    let keyframeEnd = null;

    for (const sheet of document.styleSheets) {
      let rules;

      try {
        rules = [...sheet.cssRules];
      } catch {
        continue;
      }

      for (const rule of rules) {
        if (rule instanceof CSSKeyframesRule && rule.name === "podium-fall") {
          const steps = [...rule.cssRules];
          keyframeEnd = steps[steps.length - 1]?.cssText ?? null;
        }
      }
    }

    const firstToken = document.querySelector(".podium-player .player-token");

    return {
      present: Boolean(dialog),
      open: Boolean(dialog?.open),
      labelledBy: dialog?.getAttribute("aria-labelledby") ?? null,
      describedBy: dialog?.getAttribute("aria-describedby") ?? null,
      titleText: document.getElementById("podium-title")?.textContent?.trim() ?? null,
      ledeText: document.getElementById("podium-lede")?.textContent?.trim() ?? null,
      groupHeadings: groups.map((group) => group.heading),
      groups,
      allPodiumNames: groups.flatMap((group) => group.names),
      allPodiumRanks: groups.flatMap((group) => group.ranks),
      closePresent: Boolean(close),
      closeLabel: close?.textContent?.trim() ?? null,
      closeHeight: close?.getBoundingClientRect().height ?? 0,
      closeWidth: close?.getBoundingClientRect().width ?? 0,
      focusOnClose: document.activeElement !== null && document.activeElement === close,
      focusAction: document.activeElement?.dataset?.action ?? null,
      focusInsideDialog: dialog !== null && document.activeElement !== null && dialog.contains(document.activeElement),
      focusOutlineStyle: document.activeElement ? getComputedStyle(document.activeElement).outlineStyle : null,
      firstTokenLabel: firstToken?.getAttribute("aria-label") ?? null,
      standingsNames: [...document.querySelectorAll(".active-player-name")].map((node) => node.textContent.trim()),
      standingsRanks: [...document.querySelectorAll(".active-player-rank")].map((node) => node.textContent.trim()),
      standingsTotals: [...document.querySelectorAll(".active-player-total")].map((node) => node.textContent.trim()),
      confettiAriaHidden: layer?.getAttribute("aria-hidden") ?? null,
      confettiDisplay: layer ? getComputedStyle(layer).display : null,
      confettiPointerEvents: layer ? getComputedStyle(layer).pointerEvents : null,
      confettiPieceCount: pieces.length,
      confettiAnimationNames: pieces.map((piece) => getComputedStyle(piece).animationName),
      confettiDurations: pieces.map((piece) => parseFloat(getComputedStyle(piece).animationDuration)),
      confettiIterationCounts: pieces.map((piece) => getComputedStyle(piece).animationIterationCount),
      confettiFillModes: pieces.map((piece) => getComputedStyle(piece).animationFillMode),
      confettiKeyframeEnd: keyframeEnd,
      dialogScroll: dialog ? { scrollHeight: dialog.scrollHeight, clientHeight: dialog.clientHeight } : null,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
}

// The Enter helper was removed with the extend-podium-actions walk rewrite:
// its only call site activated the single Close button in the old Tab walk,
// and Enter-activates-the-dismiss-control is now covered by the focused
// podium-actions suite.

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

// Scenarios 1, 3, 4: tie eligibility, exclusions, and the three dismissal paths.
async function runTiesAndDismissalsSession(cdp, { consoleProblems }) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  // Game 1: 12/12/8 -> podium ranks 1, 1, 3 with no fabricated rank-2 group.
  await createGame(cdp, "Trophy night", ["Alex", "Sam", "Jamie"]);
  await savePoints(cdp, "12");
  await click(cdp, "[data-player-id='active-game-player-2'] .add-points-action");
  await savePoints(cdp, "12");
  await click(cdp, "[data-player-id='active-game-player-3'] .add-points-action");
  await savePoints(cdp, "8");

  await finishGame(cdp);

  const podium = await readPodiumState(cdp);
  assert.equal(podium.present, true, "confirming finish must render the podium dialog");
  assert.equal(podium.open, true, "the podium dialog must be modal-open via showModal");
  assert.equal(podium.labelledBy, "podium-title", "the dialog must be labelled by its title");
  assert.equal(podium.describedBy, "podium-lede", "the dialog must be described by its lede");
  assert.equal(podium.titleText, "Final podium");
  assert.equal(podium.ledeText, "Congratulations to the top of the table.");
  assert.deepEqual(podium.groupHeadings, ["Rank 1", "Rank 3"],
    "an empty rank-2 group must be omitted entirely");
  assert.deepEqual(podium.groups[0].names, ["Alex", "Sam"], "both tied rank-1 players appear");
  assert.deepEqual(podium.groups[0].ranks, ["1", "1"], "ties are never collapsed");
  assert.deepEqual(podium.groups[0].totals, ["12", "12"]);
  assert.deepEqual(podium.groups[0].totalLabels, ["Alex: rank 1, total 12", "Sam: rank 1, total 12"],
    "podium totals must keep the accepted label convention");
  assert.deepEqual(podium.groups[1].names, ["Jamie"]);
  assert.deepEqual(podium.groups[1].totalLabels, ["Jamie: rank 3, total 8"]);
  // Superseded by show-player-numbers: token labels now speak the derived
  // setup-order badge ("Player {n}, {color}") instead of the MVP-era
  // "Player marker" wording; the frozen total labels below are untouched.
  assert.equal(podium.firstTokenLabel, "Player 1, Blue",
    "podium tokens must speak the setup-order number label convention");
  assert.equal(podium.closePresent, true);
  // Superseded by extend-podium-actions: the dismiss control's visible label
  // (and accessible name) is now "Close & view full standings"; the
  // close-podium hook and its accepted dismissal funnel are unchanged.
  assert.equal(podium.closeLabel, "Close & view full standings");
  assert.equal(podium.focusOnClose, true, "opening the podium must move focus to the Close button");
  assert.equal(podium.focusInsideDialog, true);
  assert.deepEqual(podium.standingsNames, ["Alex", "Sam", "Jamie"],
    "the full standings stay visible behind the modal");
  assert.deepEqual(podium.standingsRanks, ["1", "1", "3"]);
  assert.deepEqual(podium.standingsTotals, ["12", "12", "8"]);

  // Scenario 6 (normal motion): finite, single-iteration confetti that ends invisible.
  assert.equal(podium.confettiAriaHidden, "true", "the confetti layer must be aria-hidden");
  assert.equal(podium.confettiPieceCount, 14, "confetti must be exactly 14 deterministic pieces");
  assert.equal(podium.confettiPointerEvents, "none", "confetti must not intercept pointer events");
  assert.ok(podium.confettiAnimationNames.every((name) => name === "podium-fall"),
    "every piece uses the one shared keyframes rule");
  for (const duration of podium.confettiDurations) {
    assert.ok(duration <= 3.5, `each confetti piece must run at most 3.5s (saw ${duration}s)`);
  }
  for (const count of podium.confettiIterationCounts) {
    assert.equal(count, "1", "confetti must not loop");
  }
  for (const fillMode of podium.confettiFillModes) {
    assert.equal(fillMode, "forwards", "confetti must keep its final keyframe");
  }
  assert.ok(podium.confettiKeyframeEnd?.includes("opacity: 0"),
    "the confetti keyframes must end at opacity 0");
  const podiumScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-podium-ties.png"));

  // Scenario 5: the stored payload is byte-identical across open and dismiss.
  const rawPodiumOpen = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
  assert.equal((await readSavedGamesState(cdp, STORAGE_KEY)).keyCount, 1);

  // Dismissal path 1: the Close button.
  await click(cdp, "[data-action='close-podium']");
  await waitForAbsent(cdp, "[data-podium-dialog]");

  const afterClose = await readActiveState(cdp);
  assert.equal(afterClose.podiumDialogPresent, false, "the dismissed modal must be gone from the DOM");
  assert.equal(afterClose.focusOnHeading, true, "dismissing must return focus to the game heading");
  assert.deepEqual(afterClose.names, ["Alex", "Sam", "Jamie"], "standings must be unchanged after dismissal");
  assert.deepEqual(afterClose.ranks, ["1", "1", "3"]);
  const rawAfterClose = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
  assert.equal(rawAfterClose, rawPodiumOpen, "open/dismiss must not change the stored payload");

  // Reopen: no re-celebration.
  await goHome(cdp);
  await click(cdp, "[data-action='view-results']");
  await waitForSelector(cdp, "[data-finished-note]");
  const reopened = await readActiveState(cdp);
  assert.equal(reopened.podiumDialogPresent, false, "reopening a finished game must not re-open the podium");
  assert.equal(reopened.focusOnHeading, true);
  await goHome(cdp);

  // Game 2: 10/5/5/0/0 -> ranks 1, 2, 2, 4, 4. Only ranks 1-2 enter the modal.
  await createGame(cdp, "Podium cutoff", ["Ada", "Ben", "Cal", "Dee", "Eli"]);
  await savePoints(cdp, "10");
  await click(cdp, "[data-player-id='active-game-player-2'] .add-points-action");
  await savePoints(cdp, "5");
  await click(cdp, "[data-player-id='active-game-player-3'] .add-points-action");
  await savePoints(cdp, "5");

  await finishGame(cdp);

  const cutoffPodium = await readPodiumState(cdp);
  assert.deepEqual(cutoffPodium.groupHeadings, ["Rank 1", "Rank 2"]);
  assert.deepEqual(cutoffPodium.groups[0].names, ["Ada"]);
  assert.deepEqual(cutoffPodium.groups[1].names, ["Ben", "Cal"], "both rank-2 players appear");
  assert.deepEqual(cutoffPodium.allPodiumRanks, ["1", "2", "2"]);
  assert.ok(!cutoffPodium.allPodiumNames.includes("Dee") && !cutoffPodium.allPodiumNames.includes("Eli"),
    "rank-4 players must stay out of the modal");
  assert.deepEqual(cutoffPodium.standingsNames, ["Ada", "Ben", "Cal", "Dee", "Eli"],
    "rank-4 players remain visible in the full standings behind the modal");
  assert.deepEqual(cutoffPodium.standingsRanks, ["1", "2", "2", "4", "4"]);

  // Dismissal path 2: Escape (native cancel -> close).
  await pressEscape(cdp);
  await waitForAbsent(cdp, "[data-podium-dialog]");

  const afterEscape = await readActiveState(cdp);
  assert.equal(afterEscape.podiumDialogPresent, false, "Escape must dismiss the podium");
  assert.equal(afterEscape.focusOnHeading, true, "Escape must return focus to the game heading");
  assert.deepEqual(afterEscape.names, ["Ada", "Ben", "Cal", "Dee", "Eli"]);

  await goHome(cdp);
  await click(cdp, "[data-action='view-results']");
  await waitForSelector(cdp, "[data-finished-note]");
  const cutoffReopened = await readActiveState(cdp);
  assert.equal(cutoffReopened.podiumDialogPresent, false, "reopen must not re-celebrate");
  await goHome(cdp);

  // Game 3: dismissal path 3 — a real click on the ::backdrop.
  await createGame(cdp, "Backdrop farewell", ["Finn", "Gia"]);
  await finishGame(cdp);

  const backdropPodium = await readPodiumState(cdp);
  assert.equal(backdropPodium.open, true);
  assert.deepEqual(backdropPodium.groupHeadings, ["Rank 1"], "two tied players share one rank-1 group");
  assert.deepEqual(backdropPodium.groups[0].names, ["Finn", "Gia"]);

  await clickBackdrop(cdp, 8, 400);
  await waitForAbsent(cdp, "[data-podium-dialog]");

  const afterBackdrop = await readActiveState(cdp);
  assert.equal(afterBackdrop.podiumDialogPresent, false, "a backdrop click must dismiss the podium");
  assert.equal(afterBackdrop.focusOnHeading, true);
  assert.deepEqual(afterBackdrop.names, ["Finn", "Gia"]);

  // Game 4: Space activates the focused Close button.
  await goHome(cdp);
  await createGame(cdp, "Space farewell", ["Hana", "Ivan"]);
  await finishGame(cdp);
  await pressSpace(cdp);
  await waitForAbsent(cdp, "[data-podium-dialog]");

  const afterSpace = await readActiveState(cdp);
  assert.equal(afterSpace.podiumDialogPresent, false, "Space must activate Close and dismiss the podium");
  assert.equal(afterSpace.focusOnHeading, true);

  await goHome(cdp);
  const home = await evaluate(cdp, () => ({
    finishedCards: document.querySelectorAll("article[aria-labelledby='finished-title'] .saved-game").length,
    unfinishedCards: document.querySelectorAll("article[aria-labelledby='unfinished-title'] .saved-game").length
  }));
  assert.equal(home.finishedCards, 4, "all four finished games must be listed once");
  assert.equal(home.unfinishedCards, 0, "no phantom unfinished cards may appear");

  assert.deepEqual(consoleProblems, [], "the ties session must not produce uncaught console errors");
  return { podiumScreenshot };
}

// Scenario 2: all 20 tied players visible; the modal scrolls internally at both sizes.
async function runTwentyTiedSession(cdp, { consoleProblems }) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  await createGame(cdp, "All tied", Array.from({ length: 20 }, (_, index) => `Player ${index + 1}`));
  await finishGame(cdp);

  const desktopPodium = await readPodiumState(cdp);
  assert.equal(desktopPodium.open, true);
  assert.deepEqual(desktopPodium.groupHeadings, ["Rank 1"], "twenty tied players form one rank-1 group");
  assert.equal(desktopPodium.groups[0].names.length, 20, "none of the 20 tied players may be dropped");
  assert.ok(desktopPodium.groups[0].names.every((name, index) => name === `Player ${index + 1}`),
    "tied players keep creation order");
  assert.ok(desktopPodium.allPodiumRanks.every((rank) => rank === "1"), "every tied player shows rank 1");
  assert.ok(desktopPodium.dialogScroll.scrollHeight > desktopPodium.dialogScroll.clientHeight,
    "the 20-tied podium must scroll internally at 1280x800");
  assert.ok(desktopPodium.closeHeight >= 44, "the Close control needs a roughly 44px target");
  assert.equal(desktopPodium.horizontalOverflow, false);
  const desktopScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-podium-20-tied.png"));

  await setViewport(cdp, { width: 320, height: 720, mobile: true });

  const mobilePodium = await readPodiumState(cdp);
  assert.equal(mobilePodium.open, true, "narrowing the viewport must not dismiss the podium");
  assert.equal(mobilePodium.groups[0].names.length, 20);
  assert.ok(mobilePodium.dialogScroll.scrollHeight > mobilePodium.dialogScroll.clientHeight,
    "the 20-tied podium must scroll internally at 320x720");
  assert.equal(mobilePodium.horizontalOverflow, false,
    "the 20-tied podium must not cause page-level horizontal overflow at 320px");
  assert.ok(mobilePodium.closeHeight >= 44);
  const mobileScreenshot = await screenshot(cdp, path.join(evidenceDir, "mobile-podium-20-tied-320px.png"));

  await pressEscape(cdp);
  await waitForAbsent(cdp, "[data-podium-dialog]");

  const afterEscape = await readActiveState(cdp);
  assert.equal(afterEscape.podiumDialogPresent, false);
  assert.equal(afterEscape.focusOnHeading, true);
  assert.equal(afterEscape.names.length, 20, "all 20 players remain in the standings behind the modal");
  assert.equal(afterEscape.horizontalOverflow, false);

  await goHome(cdp);
  await click(cdp, "[data-action='view-results']");
  await waitForSelector(cdp, "[data-finished-note]");
  const reopened = await readActiveState(cdp);
  assert.equal(reopened.podiumDialogPresent, false, "reopen must not re-celebrate the 20-tied game");
  assert.equal(reopened.names.length, 20);

  // Scenario 7 at 320px: the native trap cycles Tab through the three podium
  // actions (extend-podium-actions) without ever reaching a background control,
  // and Escape dismisses to the heading from a cycled focus position.
  // Superseded by extend-podium-actions: the podium now has three focusable
  // actions in DOM order — Play again, Close & view full standings
  // (close-podium), Save & exit to Dashboard — so the single-focusable
  // `onClose || onBody` wrap assertion and the `recaptureState.onClose`
  // recapture assertion no longer describe this dialog. The honest guarantees
  // are: the no-wrap steps land exactly where DOM order says, the wrap from
  // the last action follows the same documented Chrome quirk the
  // single-focusable walk had to allow (first focusable or transient body
  // rest), focus never reaches a background control, the dialog stays open,
  // and the next Tab recaptures into the dialog. The Enter-on-Close step
  // becomes Escape because the recapture's landing button is not
  // deterministic; Enter-activates-the-dismiss-control at 320px stays covered
  // by the focused podium-actions suite.
  await goHome(cdp);
  await createGame(cdp, "Mobile keys", ["Finn", "Gia"]);
  await finishGame(cdp);

  const mobileKeysPodium = await readPodiumState(cdp);
  assert.equal(mobileKeysPodium.open, true);
  assert.equal(mobileKeysPodium.focusOnClose, true);

  const readTrapState = () => evaluate(cdp, () => {
    const dialog = document.querySelector("[data-podium-dialog]");
    const active = document.activeElement;
    const style = active ? getComputedStyle(active) : null;
    return {
      dialogOpen: Boolean(dialog?.open),
      focusAction: active?.dataset?.action ?? null,
      insideDialog: Boolean(dialog && active && dialog.contains(active)),
      onBody: active === document.body,
      backgroundControlFocused: Boolean(active && active !== document.body && !dialog.contains(active)),
      outlineStyle: style?.outlineStyle ?? null,
      outlineWidth: style?.outlineWidth ?? null
    };
  });

  // Initial focus sits on the second focusable (close-podium), so the first
  // Tab moves one step forward in DOM order with no wrap involved.
  await pressTab(cdp);
  const firstTabState = await readTrapState();
  assert.equal(firstTabState.dialogOpen, true, "Tab must keep the modal dialog open");
  assert.equal(firstTabState.backgroundControlFocused, false,
    "the native trap must never move focus to a control behind the dialog");
  assert.equal(firstTabState.insideDialog, true, "focus must stay inside the dialog");
  assert.equal(firstTabState.focusAction, "podium-exit-dashboard",
    "the first Tab must reach the third podium action in DOM order");

  // The second Tab wraps from the last focusable — the documented Chrome
  // quirk lets it reach the first action or transiently rest on body before
  // the next Tab recaptures into the dialog.
  await pressTab(cdp);
  const secondTabState = await readTrapState();
  assert.equal(secondTabState.dialogOpen, true);
  assert.equal(secondTabState.backgroundControlFocused, false);
  assert.ok(secondTabState.focusAction === "podium-play-again" || secondTabState.onBody,
    "wrapping from the last action must reach the primary one or transiently rest on body");

  await pressTab(cdp);
  const thirdTabState = await readTrapState();
  assert.equal(thirdTabState.dialogOpen, true, "the dialog must stay open across the focus cycle");
  assert.equal(thirdTabState.backgroundControlFocused, false);
  assert.equal(thirdTabState.insideDialog, true,
    "the next Tab must recapture focus into the dialog");
  assert.ok(thirdTabState.focusAction === "podium-play-again" || thirdTabState.focusAction === "close-podium",
    "the recapture must land on one of the dialog's actions");
  assert.notEqual(thirdTabState.outlineStyle, "none", "keyboard focus must show a visible outline");
  assert.notEqual(thirdTabState.outlineWidth, "0px");

  await pressEscape(cdp);
  await waitForAbsent(cdp, "[data-podium-dialog]");

  const afterEscapeCycle = await readActiveState(cdp);
  assert.equal(afterEscapeCycle.podiumDialogPresent, false, "Escape must dismiss the podium after the Tab cycle");
  assert.equal(afterEscapeCycle.focusOnHeading, true, "dismissal must return focus to the heading at 320px");
  assert.equal(afterEscapeCycle.horizontalOverflow, false);

  await goHome(cdp);
  await createGame(cdp, "Mobile escape", ["Hana", "Ivan"]);
  await finishGame(cdp);
  await pressEscape(cdp);
  await waitForAbsent(cdp, "[data-podium-dialog]");

  const afterEscape320 = await readActiveState(cdp);
  assert.equal(afterEscape320.podiumDialogPresent, false, "Escape must dismiss at 320px");
  assert.equal(afterEscape320.focusOnHeading, true);
  assert.equal(afterEscape320.horizontalOverflow, false);

  assert.deepEqual(consoleProblems, [], "the 20-tied session must not produce uncaught console errors");
  return { desktopScreenshot, mobileScreenshot };
}

// Scenario 6 (reduced motion): confetti fully suppressed while the modal stays operable.
async function runReducedMotionSession(cdp, { consoleProblems }) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");
  await cdp.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }]
  });

  await createGame(cdp, "Calm finish", ["Ada", "Bo"]);
  await finishGame(cdp);

  const podium = await readPodiumState(cdp);
  assert.equal(podium.open, true, "the podium must still open under reduced motion");
  assert.equal(podium.confettiDisplay, "none",
    "reduced motion must suppress the confetti layer with display: none");
  assert.equal(podium.confettiPieceCount, 14, "the markup still carries the (suppressed) pieces");
  assert.equal(podium.focusOnClose, true, "the modal must still be keyboard-operable under reduced motion");
  assert.equal(podium.labelledBy, "podium-title");
  const reducedScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-podium-reduced-motion.png"));

  await pressEscape(cdp);
  await waitForAbsent(cdp, "[data-podium-dialog]");

  const afterEscape = await readActiveState(cdp);
  assert.equal(afterEscape.podiumDialogPresent, false, "Escape must still dismiss under reduced motion");
  assert.equal(afterEscape.focusOnHeading, true);

  assert.deepEqual(consoleProblems, [], "the reduced-motion session must not produce uncaught console errors");
  return { reducedScreenshot };
}

// Scenario 5 (blocked writes): the celebration opens even when the save failed.
async function runBlockedWriteSession(cdp, { consoleProblems, warnings }) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  await createGame(cdp, "Blocked celebration", ["Alex", "Sam"]);
  await savePoints(cdp, "10");

  const beforeFinish = await readActiveState(cdp);
  assert.equal(beforeFinish.storageNoticePresent, true, "the accepted write notice must be visible before finishing");
  assert.equal(beforeFinish.storageNoticeRole, "status");
  assert.equal(beforeFinish.storageNoticeText, WRITE_NOTICE);

  await finishGame(cdp);

  const podium = await readPodiumState(cdp);
  assert.equal(podium.open, true, "the podium must open even when the finish save failed");
  assert.equal(podium.focusOnClose, true);
  const activeWhileOpen = await readActiveState(cdp);
  assert.equal(activeWhileOpen.storageNoticePresent, true, "the write notice stays while the podium is open");
  assert.equal(activeWhileOpen.storageNoticeRole, "status");
  assert.equal(activeWhileOpen.storageNoticeText, WRITE_NOTICE, "no new error path: the copy is unchanged");

  const storageWhileOpen = await readSavedGamesState(cdp, STORAGE_KEY);
  assert.equal(storageWhileOpen.keyCount, 0, "a blocked save must not create the storage key");

  await click(cdp, "[data-action='close-podium']");
  await waitForAbsent(cdp, "[data-podium-dialog]");

  const afterDismiss = await readActiveState(cdp);
  assert.equal(afterDismiss.podiumDialogPresent, false);
  assert.equal(afterDismiss.focusOnHeading, true);
  assert.equal(afterDismiss.storageNoticePresent, true, "the accepted notice stays visible after dismissal");
  assert.equal(afterDismiss.storageNoticeText, WRITE_NOTICE);

  await goHome(cdp);
  const home = await evaluate(cdp, () => ({
    finishedCards: document.querySelectorAll("article[aria-labelledby='finished-title'] .saved-game").length,
    unfinishedCards: document.querySelectorAll("article[aria-labelledby='unfinished-title'] .saved-game").length,
    noticeText: document.querySelector("[data-storage-notice]")?.textContent?.trim() ?? ""
  }));
  assert.equal(home.finishedCards, 0, "no phantom finished card may appear on home");
  assert.equal(home.unfinishedCards, 0);
  assert.equal(home.noticeText, WRITE_NOTICE);

  assert.ok(warnings.some((warning) => warning.includes("Game save failed")),
    "the failed finish save must log the code-only diagnostic");
  for (const warning of warnings) {
    assert.doesNotMatch(warning, /Alex|Sam|Blocked celebration|total 10|points/,
      "diagnostics must not include names, titles, or scores");
  }
  assert.deepEqual(consoleProblems, [], "the blocked-write session must not produce uncaught console errors");
}

// Scenario 5 (invalid-read suppression): podium over a suppressed session keeps the payload byte-identical.
async function runSuppressedSession(cdp, { consoleProblems, warnings }) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  const rawBefore = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
  assert.equal(rawBefore, "not-json{", "the corrupt seeded payload must be intact before finishing");

  await createGame(cdp, "Suppressed celebration", ["Ada", "Bo"]);
  await savePoints(cdp, "4");
  await finishGame(cdp);

  const podium = await readPodiumState(cdp);
  assert.equal(podium.open, true, "the podium must open under invalid-read suppression");
  assert.equal(podium.focusOnClose, true);
  const activeWhileOpen = await readActiveState(cdp);
  assert.equal(activeWhileOpen.storageNoticeText, INVALID_NOTICE, "the invalid notice stays while the podium is open");
  assert.equal((await readSavedGamesState(cdp, STORAGE_KEY)).raw, "not-json{",
    "finishing under suppression must not write");

  await pressEscape(cdp);
  await waitForAbsent(cdp, "[data-podium-dialog]");

  const afterDismiss = await readActiveState(cdp);
  assert.equal(afterDismiss.podiumDialogPresent, false);
  assert.equal(afterDismiss.focusOnHeading, true);
  assert.equal(afterDismiss.storageNoticePresent, true, "the invalid notice stays visible after dismissal");
  assert.equal(afterDismiss.storageNoticeText, INVALID_NOTICE);
  assert.equal((await readSavedGamesState(cdp, STORAGE_KEY)).raw, rawBefore,
    "the stored payload must stay byte-identical across open and dismiss under suppression");

  await goHome(cdp);
  const home = await evaluate(cdp, () => ({
    finishedCards: document.querySelectorAll("article[aria-labelledby='finished-title'] .saved-game").length,
    unfinishedCards: document.querySelectorAll("article[aria-labelledby='unfinished-title'] .saved-game").length,
    unfinishedEmptyTitle: document.querySelector("article[aria-labelledby='unfinished-title'] .empty-title")?.textContent?.trim() ?? ""
  }));
  assert.equal(home.finishedCards, 0, "no phantom finished card under suppression");
  assert.equal(home.unfinishedCards, 0);
  assert.equal(home.unfinishedEmptyTitle, "Saved games can't be shown right now.");

  assert.ok(warnings.some((warning) => warning.includes("Game save failed: invalid")),
    "suppressed finishing must log the code-only invalid diagnostic");
  assert.deepEqual(consoleProblems, [], "the suppressed session must not produce uncaught console errors");
}

async function main() {
  try {
    const tieScreenshots = await runSession("ties-and-dismissals", runTiesAndDismissalsSession);
    assert.equal(typeof tieScreenshots.podiumScreenshot, "string");

    await runSession("twenty-tied", runTwentyTiedSession);
    await runSession("reduced-motion", runReducedMotionSession);
    await runSession("blocked-write", runBlockedWriteSession, { setupSource: THROWING_SET_ITEM_SOURCE });
    await runSession("suppressed-read", runSuppressedSession, {
      setupSource: `localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, "not-json{");`
    });

    console.log("Browser podium test passed: confirming finish opens a native dialog podium (aria-labelledby/aria-describedby) focused on the dismiss control — labeled 'Close & view full standings' since extend-podium-actions, which also added the Play-again primary and the Save-&-exit secondary around it; ranks 1,1,3 put both tied players on one step with no fabricated rank-2 group, both rank-2 players outrank the excluded rank-4 pair, and 20 tied players all appear in one scrolling rank-1 group at 1280x800 and 320x720 with no page-level overflow; the native trap walks the three podium actions without ever reaching background controls (the no-wrap steps land in DOM order, the wrap from the last action follows the documented Chrome first-focusable-or-transient-body quirk, and the next Tab recaptures into the dialog), and the dismiss control (click or Space), Escape (from the initial focus and after the Tab cycle), and backdrop click each dismiss back to the heading with unchanged standings and no re-celebration on reopen; confetti is 14 deterministic aria-hidden pieces animating once (<=3.5s, forwards, ends at opacity 0) and computes display:none under emulated prefers-reduced-motion; the celebration opens under blocked writes and invalid-read suppression while stored payloads stay byte-identical with zero phantom cards, code-only warnings, and no uncaught console errors.");
    console.log(`Browser evidence screenshots: ${[
      tieScreenshots.podiumScreenshot,
      path.join(evidenceDir, "desktop-podium-20-tied.png"),
      path.join(evidenceDir, "mobile-podium-20-tied-320px.png"),
      path.join(evidenceDir, "desktop-podium-reduced-motion.png")
    ].join(", ")}`);
  } finally {
    await closeServer(server);
  }
}

await main();
