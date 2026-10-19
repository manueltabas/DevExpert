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
const evidenceDir = await createEvidenceDir("devexpert-name-game-titles");
const server = createStaticServer();
const baseUrl = await listen(server);

const WRITE_NOTICE = "Your latest change couldn't be saved. The game still works, and nothing already saved was lost — your next change will try again.";
const SETUP_PLACEHOLDER = "Optional — e.g. Friday game night";

// The deterministic auto-label shape: `Game — {d MMM, HH:mm}` (24-hour,
// zero-padded minutes, short English months, day not zero-padded).
const AUTO_LABEL_PATTERN = /^Game — \d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec), \d{2}:\d{2}$/;
const TITLE_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function expectedAutoLabel(iso) {
  const date = new Date(iso);
  return `Game — ${date.getDate()} ${TITLE_MONTHS[date.getMonth()]}, ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function seedSource(games) {
  // Seed exactly once per tab: later reloads in the same session must re-read
  // the app-written payload (the edit-persists-across-reload proof), so the
  // document script is guarded by a sessionStorage marker.
  return `
    if (!sessionStorage.getItem("game-title-seed-applied")) {
      sessionStorage.setItem("game-title-seed-applied", "1");
      localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, ${JSON.stringify(JSON.stringify({ version: 1, games }))});
    }
  `;
}

const BLOCK_SET_ITEM_SOURCE = `
  (() => {
    Object.defineProperty(Storage.prototype, "setItem", {
      value: function setItem() {
        throw new Error("Storage is blocked in this test session.");
      },
      writable: true,
      configurable: true
    });
  })();
`;

function activeSeed({ id, title, createdAt, totals, withTitleField = true }) {
  return {
    id,
    ...(withTitleField ? { title } : {}),
    status: "active",
    createdAt,
    players: totals.map((total, index) => ({
      id: `${id}-player-${index + 1}`,
      name: `Player ${index + 1}`,
      color: "blue",
      marker: String(index + 1),
      order: index,
      total
    })),
    updatedAt: createdAt
  };
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

async function finishGame(cdp) {
  await click(cdp, "[data-action='open-finish']");
  await waitForSelector(cdp, "[data-action='confirm-finish']");
  await click(cdp, "[data-action='confirm-finish']");
  await waitForSelector(cdp, "[data-podium-dialog]");
}

async function readHomeState(cdp) {
  return evaluate(cdp, () => {
    const readCards = (panel) => [...(panel?.querySelectorAll(".saved-game") ?? [])].map((card) => ({
      gameId: card.dataset.savedGameId ?? "",
      title: card.querySelector(".saved-game-title")?.textContent?.trim() ?? "",
      actionLabel: card.querySelector("button")?.getAttribute("aria-label") ?? ""
    }));
    return {
      unfinishedCards: readCards(document.querySelector("article[aria-labelledby='unfinished-title']")),
      finishedCards: readCards(document.querySelector("article[aria-labelledby='finished-title']")),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
}

async function readActiveState(cdp) {
  return evaluate(cdp, () => ({
    heading: document.querySelector("[data-active-heading]")?.textContent?.trim() ?? null,
    headingPresent: Boolean(document.querySelector("[data-active-heading]")),
    editButton: (() => {
      const button = document.querySelector("[data-action='open-title-edit']");
      if (!button) {
        return null;
      }
      const rect = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      return {
        label: button.textContent.trim(),
        type: button.getAttribute("type"),
        height: rect.height,
        width: rect.width,
        visible: rect.height > 0 && button.offsetParent !== null
      };
    })(),
    editForm: (() => {
      const form = document.querySelector("[data-title-edit-form]");
      if (!form) {
        return null;
      }
      const input = document.querySelector("#active-title-input");
      const label = document.querySelector("label[for='active-title-input']");
      const feedback = document.querySelector("#title-edit-feedback");
      const save = form.querySelector("button[type='submit']");
      const cancel = form.querySelector("[data-action='cancel-title-edit']");
      const outlineTarget = input ?? save;
      return {
        present: true,
        labelFor: label?.textContent?.trim() ?? null,
        inputValue: input?.value ?? null,
        inputMaxLength: input?.getAttribute("maxlength"),
        inputAutocomplete: input?.getAttribute("autocomplete"),
        feedbackLive: feedback?.getAttribute("aria-live") ?? null,
        feedbackRole: feedback?.getAttribute("role") ?? null,
        feedbackText: feedback?.textContent?.trim() ?? "",
        saveLabel: save?.textContent?.trim() ?? null,
        cancelLabel: cancel?.textContent?.trim() ?? null,
        inputFocused: document.activeElement === input,
        inputHeight: input ? input.getBoundingClientRect().height : 0,
        saveHeight: save ? save.getBoundingClientRect().height : 0,
        cancelHeight: cancel ? cancel.getBoundingClientRect().height : 0,
        focusOutlineStyle: outlineTarget ? getComputedStyle(outlineTarget).outlineStyle : null
      };
    })(),
    focusOnHeading: Boolean(document.activeElement?.hasAttribute?.("data-active-heading")),
    storageNotice: (() => {
      const notice = document.querySelector("[data-storage-notice]");
      return notice ? { role: notice.getAttribute("role"), text: notice.textContent.trim() } : null;
    })(),
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
  }));
}

async function readPodiumState(cdp) {
  return evaluate(cdp, () => {
    const dialog = document.querySelector("[data-podium-dialog]");
    const gameTitle = document.querySelector(".podium-game-title");
    const h2 = document.querySelector("#podium-title");
    return {
      open: Boolean(dialog?.open),
      gameTitle: gameTitle?.textContent?.trim() ?? null,
      gameTitleBeforePodiumTitle: Boolean(gameTitle && h2 && (gameTitle.compareDocumentPosition(h2) & Node.DOCUMENT_POSITION_FOLLOWING)),
      gameTitleFirstContent: Boolean(gameTitle && gameTitle === document.querySelector(".podium-body > p")),
      podiumTitleText: h2?.textContent?.trim() ?? null,
      ledeText: document.querySelector("#podium-lede")?.textContent?.trim() ?? null,
      labelledBy: dialog?.getAttribute("aria-labelledby") ?? null,
      describedBy: dialog?.getAttribute("aria-describedby") ?? null
    };
  });
}

async function readSetupState(cdp) {
  return evaluate(cdp, () => {
    const input = document.querySelector("#game-title");
    return {
      value: input?.value ?? null,
      placeholder: input?.getAttribute("placeholder") ?? null,
      maxLength: input?.getAttribute("maxlength") ?? null,
      labelText: document.querySelector("label[for='game-title']")?.textContent?.trim() ?? null
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

// Session 1 (Scenarios 1 + 2 + the setup rules): a titled game end to end, a
// blank game with the auto-label everywhere, label stability across reload,
// and the setup field's empty-default/preserve/reset behavior.
async function runTitledAndBlank(cdp, { consoleProblems }) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  const stored = await readSavedGamesState(cdp, STORAGE_KEY);
  assert.equal(stored.keyCount, 0, "a fresh profile starts with no storage key");

  // The setup field starts empty with the accepted label, placeholder, and cap.
  await click(cdp, "[data-action='new-game']");
  await waitForSelector(cdp, "#game-title");
  const setup = await readSetupState(cdp);
  assert.equal(setup.value, "", "the setup title field must start empty");
  assert.equal(setup.labelText, "Game title");
  assert.equal(setup.placeholder, SETUP_PLACEHOLDER);
  assert.equal(setup.maxLength, "60");
  const setupScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-setup-empty-title.png"));

  // Nav New Game preserves the title scratchpad; the hero reset clears it.
  await fill(cdp, "#game-title", "Draft title");
  await click(cdp, "[data-action='nav-dashboard']");
  await waitForSelector(cdp, "[data-home-heading]");
  await click(cdp, "[data-action='nav-new-game']");
  await waitForSelector(cdp, "#game-title");
  assert.equal((await readSetupState(cdp)).value, "Draft title", "nav New Game must preserve the title scratchpad");
  await click(cdp, "[data-action='nav-dashboard']");
  await waitForSelector(cdp, "[data-home-heading]");
  await click(cdp, "[data-action='new-game']");
  await waitForSelector(cdp, "#game-title");
  assert.equal((await readSetupState(cdp)).value, "", "the hero New game must reset the title field");

  // Scenario 1: a titled game end to end (still on the reset setup view).
  for (let index = 0; index < 2; index += 1) {
    await fill(cdp, `#player-name-${index + 1}`, ["Alex", "Sam"][index]);
  }
  await fill(cdp, "#game-title", "Catan Friday");
  await click(cdp, "[data-roster-form] button[type='submit']");
  await waitForSelector(cdp, "#score-amount");
  const titledActive = await readActiveState(cdp);
  assert.equal(titledActive.heading, "Catan Friday");
  assert.equal(titledActive.editButton?.label, "Edit title", "the active header must offer Edit title");
  assert.equal(titledActive.editButton?.type, "button");
  assert.equal(titledActive.editButton?.visible, true);
  assert.ok(titledActive.editButton?.height >= 44, "Edit title needs a roughly 44px target");
  assert.ok(titledActive.editButton?.width >= 44);

  const storedTitled = await readSavedGamesState(cdp, STORAGE_KEY);
  assert.equal(storedTitled.gameCount, 1);
  const titledParsed = JSON.parse(storedTitled.raw);
  assert.equal(titledParsed.games[0].title, "Catan Friday", "the stored record carries the trimmed title");

  await finishGame(cdp);
  const titledPodium = await readPodiumState(cdp);
  assert.equal(titledPodium.open, true);
  assert.equal(titledPodium.gameTitle, "Catan Friday", "the podium must show the stored title in the new title line");
  assert.equal(titledPodium.gameTitleBeforePodiumTitle, true, "the title line must precede the suite-frozen podium title");
  assert.equal(titledPodium.gameTitleFirstContent, true);
  assert.equal(titledPodium.podiumTitleText, "Final podium", "podium-title copy is suite-frozen");
  assert.equal(titledPodium.ledeText, "Congratulations to the top of the table.", "podium-lede copy is suite-frozen");
  assert.equal(titledPodium.labelledBy, "podium-title");
  assert.equal(titledPodium.describedBy, "podium-lede");
  const titledPodiumScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-podium-titled.png"));

  await click(cdp, "[data-action='close-podium']");
  await waitForSelector(cdp, "[data-action='play-again']");
  const titledFinished = await readActiveState(cdp);
  assert.equal(titledFinished.heading, "Catan Friday", "the finished header shows the frozen title");
  assert.equal(titledFinished.editButton, null, "the finished view must not offer Edit title");
  assert.equal(titledFinished.editForm, null, "the finished view must not render the edit form");
  const titledEntryBefore = JSON.stringify(JSON.parse((await readSavedGamesState(cdp, STORAGE_KEY)).raw).games[0]);

  await goHome(cdp);
  const titledHome = await readHomeState(cdp);
  assert.equal(titledHome.finishedCards.length, 1);
  assert.equal(titledHome.finishedCards[0].title, "Catan Friday");
  assert.equal(titledHome.finishedCards[0].actionLabel, "View results Catan Friday");

  // Scenario 2: a blank title stores "" and renders the auto-label everywhere.
  await createGame(cdp, null, ["Ada", "Bo"]);
  const blankActive = await readActiveState(cdp);
  assert.ok(AUTO_LABEL_PATTERN.test(blankActive.heading ?? ""), `the blank game heading must be the auto-label, got: ${blankActive.heading}`);

  const storedBlank = await readSavedGamesState(cdp, STORAGE_KEY);
  assert.equal(storedBlank.gameCount, 2, "the blank game must be stored");
  const blankParsed = JSON.parse(storedBlank.raw);
  const blankEntry = blankParsed.games.find((game) => game.title === "");
  assert.ok(blankEntry, "the blank game must store title exactly as the empty string");
  assert.equal(blankActive.heading, expectedAutoLabel(blankEntry.createdAt), "the rendered label must match the deterministic format recomputed from createdAt");

  await finishGame(cdp);
  const blankPodium = await readPodiumState(cdp);
  assert.equal(blankPodium.gameTitle, blankActive.heading, "the podium shows the same auto-label");
  await click(cdp, "[data-action='close-podium']");
  await waitForSelector(cdp, "[data-action='play-again']");

  await goHome(cdp);
  const blankHome = await readHomeState(cdp);
  assert.equal(blankHome.finishedCards.length, 2);
  const blankCard = blankHome.finishedCards.find((card) => card.gameId === blankEntry.id);
  assert.equal(blankCard?.title, blankActive.heading, "the card shows the auto-label");
  assert.equal(blankCard?.actionLabel, `View results ${blankActive.heading}`, "the accessible name uses the display label");
  assert.equal(blankHome.horizontalOverflow, false);
  const homeScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-home-auto-label-card.png"));

  // Stability: the label derives from the stored createdAt, so a reload renders
  // the same label from byte-identical storage (never rewritten, never stored).
  const storedBeforeReload = await readSavedGamesState(cdp, STORAGE_KEY);
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");
  const reloadedHome = await readHomeState(cdp);
  const reloadedCard = reloadedHome.finishedCards.find((card) => card.gameId === blankEntry.id);
  assert.equal(reloadedCard?.title, blankActive.heading, "the auto-label must be stable across reload");
  const storedAfterReload = await readSavedGamesState(cdp, STORAGE_KEY);
  assert.equal(storedAfterReload.raw, storedBeforeReload.raw, "storage must stay byte-identical across the reload");
  const titledAfterReload = JSON.parse(storedAfterReload.raw).games.find((game) => game.title === "Catan Friday");
  assert.equal(JSON.stringify(titledAfterReload), titledEntryBefore, "the titled entry stays byte-identical too");

  assert.deepEqual(consoleProblems, [], "the titled/blank session must not produce uncaught console errors");
  return { setupScreenshot, titledPodiumScreenshot, homeScreenshot };
}

// Session 2 (Scenario 3): the inline edit saves immediately, cancel and Escape
// close without writing, clearing to blank restores the auto-label, and the
// keyboard path (Enter saves, Escape cancels) works with real keys.
async function runEditMode(cdp, { consoleProblems }) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  await createGame(cdp, "Catan Friday", ["Alex", "Sam"]);
  const before = await readSavedGamesState(cdp, STORAGE_KEY);
  const beforeEntry = JSON.stringify(JSON.parse(before.raw).games[0]);
  const beforeUpdatedAt = JSON.parse(before.raw).games[0].updatedAt;

  // Open the edit form: labeled input prefilled with the raw stored title.
  await click(cdp, "[data-action='open-title-edit']");
  await waitForSelector(cdp, "#active-title-input");
  const openForm = await readActiveState(cdp);
  assert.equal(openForm.heading, null, "the heading is replaced while editing");
  assert.equal(openForm.editButton, null, "the Edit title control is replaced while editing");
  assert.equal(openForm.editForm?.labelFor, "Game title");
  assert.equal(openForm.editForm?.inputValue, "Catan Friday", "the draft starts from the stored title, never the auto-label");
  assert.equal(openForm.editForm?.inputMaxLength, "60");
  assert.equal(openForm.editForm?.inputAutocomplete, "off");
  assert.equal(openForm.editForm?.feedbackLive, "polite", "the feedback region must be a polite live region");
  assert.equal(openForm.editForm?.saveLabel, "Save title");
  assert.equal(openForm.editForm?.cancelLabel, "Cancel");
  assert.equal(openForm.editForm?.inputFocused, true, "opening the edit must focus the input");
  assert.equal(openForm.editForm?.inputHeight >= 44, true);
  assert.equal(openForm.editForm?.saveHeight >= 44, true);
  assert.equal(openForm.editForm?.cancelHeight >= 44, true);
  const editScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-active-edit-mode.png"));

  // Cancel: closes with a byte-identical payload and the draft discarded.
  await fill(cdp, "#active-title-input", "abandoned draft");
  await click(cdp, "[data-action='cancel-title-edit']");
  await waitForSelector(cdp, "[data-active-heading]");
  const afterCancel = await readActiveState(cdp);
  assert.equal(afterCancel.heading, "Catan Friday", "cancel must leave the title untouched");
  assert.equal(afterCancel.focusOnHeading, true, "cancel must return focus to the heading");
  const storedAfterCancel = await readSavedGamesState(cdp, STORAGE_KEY);
  assert.equal(storedAfterCancel.raw, before.raw, "cancel must never write storage");
  await click(cdp, "[data-action='open-title-edit']");
  await waitForSelector(cdp, "#active-title-input");
  assert.equal((await readActiveState(cdp)).editForm?.inputValue, "Catan Friday", "a reopened edit starts from the stored title, not the abandoned draft");
  await click(cdp, "[data-action='cancel-title-edit']");
  await waitForSelector(cdp, "[data-active-heading]");

  // Escape: same no-write contract through the keyboard.
  await click(cdp, "[data-action='open-title-edit']");
  await waitForSelector(cdp, "#active-title-input");
  await fill(cdp, "#active-title-input", "escape draft");
  await pressEscape(cdp);
  await waitForSelector(cdp, "[data-active-heading]");
  const afterEscape = await readActiveState(cdp);
  assert.equal(afterEscape.heading, "Catan Friday", "Escape must close the edit without saving");
  assert.equal(afterEscape.focusOnHeading, true);
  const storedAfterEscape = await readSavedGamesState(cdp, STORAGE_KEY);
  assert.equal(storedAfterEscape.raw, before.raw, "Escape must never write storage");

  // Save with a button: the heading updates, the payload gains the new title
  // with a fresh storage-owned updatedAt, and focus lands on the heading.
  await click(cdp, "[data-action='open-title-edit']");
  await waitForSelector(cdp, "#active-title-input");
  await fill(cdp, "#active-title-input", "  Friday rematch  ");
  await click(cdp, "[data-title-edit-form] button[type='submit']");
  await waitForSelector(cdp, "[data-active-heading]");
  const afterSave = await readActiveState(cdp);
  assert.equal(afterSave.heading, "Friday rematch", "the trimmed title must replace the stored one");
  assert.equal(afterSave.focusOnHeading, true, "saving must close the edit and focus the heading");
  assert.equal(afterSave.editForm, null, "the edit form must close after saving");
  const storedAfterSave = await readSavedGamesState(cdp, STORAGE_KEY);
  const savedParsed = JSON.parse(storedAfterSave.raw);
  assert.equal(savedParsed.games[0].title, "Friday rematch");
  assert.notEqual(savedParsed.games[0].updatedAt, beforeUpdatedAt, "the rename must stamp a fresh updatedAt");
  assert.equal(storedAfterSave.gameCount, 1);

  // Enter saves through the real keyboard path; Escape is asserted above.
  await click(cdp, "[data-action='open-title-edit']");
  await waitForSelector(cdp, "#active-title-input");
  await evaluate(cdp, () => {
    const input = document.querySelector("#active-title-input");
    input.setSelectionRange(input.value.length, input.value.length);
  });
  await cdp.send("Input.insertText", { text: " final" });
  await pressEnter(cdp);
  await waitForSelector(cdp, "[data-active-heading]");
  const afterEnter = await readActiveState(cdp);
  assert.equal(afterEnter.heading, "Friday rematch final", "Enter must submit the edit form");
  assert.equal(afterEnter.focusOnHeading, true);
  const entryAfterEnter = JSON.stringify(JSON.parse((await readSavedGamesState(cdp, STORAGE_KEY)).raw).games[0]);
  assert.notEqual(entryAfterEnter, beforeEntry, "the Enter save must persist the new title");

  // Clearing the text and saving stores "" so the auto-label returns.
  await click(cdp, "[data-action='open-title-edit']");
  await waitForSelector(cdp, "#active-title-input");
  await fill(cdp, "#active-title-input", "   ");
  await click(cdp, "[data-title-edit-form] button[type='submit']");
  await waitForSelector(cdp, "[data-active-heading]");
  const afterBlank = await readActiveState(cdp);
  assert.ok(AUTO_LABEL_PATTERN.test(afterBlank.heading ?? ""), `clearing the title must restore the auto-label, got: ${afterBlank.heading}`);
  const storedAfterBlank = await readSavedGamesState(cdp, STORAGE_KEY);
  assert.equal(JSON.parse(storedAfterBlank.raw).games[0].title, "", "a blank-after-trim save stores the empty title");

  // The draft input never receives the auto-label.
  await click(cdp, "[data-action='open-title-edit']");
  await waitForSelector(cdp, "#active-title-input");
  assert.equal((await readActiveState(cdp)).editForm?.inputValue, "", "the edit draft must show raw stored text, never the auto-label");
  await pressEscape(cdp);
  await waitForSelector(cdp, "[data-active-heading]");

  // A rename failure path is unreachable from valid text input, but the
  // maxlength cap is enforced by the field itself.
  assert.equal((await readActiveState(cdp)).editButton?.label, "Edit title");

  assert.deepEqual(consoleProblems, [], "the edit-mode session must not produce uncaught console errors");
  return { editScreenshot };
}

// Session 3 (Scenario 3, blocked writes): a rename under failing writes keeps
// the in-memory edit, shows the accepted role=status notice with unchanged
// copy, and writes nothing.
async function runBlockedWriteRename(cdp, { consoleProblems, warnings }) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  await createGame(cdp, "Catan Friday", ["Alex", "Sam"]);
  const storedBefore = await readSavedGamesState(cdp, STORAGE_KEY);
  assert.equal(storedBefore.keyCount, 0, "blocked writes must never create the storage key");
  assert.equal((await readActiveState(cdp)).storageNotice?.role, "status", "the blocked game start already shows the accepted notice");

  await click(cdp, "[data-action='open-title-edit']");
  await waitForSelector(cdp, "#active-title-input");
  await fill(cdp, "#active-title-input", "In-memory rename");
  await click(cdp, "[data-title-edit-form] button[type='submit']");
  await waitForSelector(cdp, "[data-active-heading]");

  const afterRename = await readActiveState(cdp);
  assert.equal(afterRename.heading, "In-memory rename", "the rename must succeed in memory");
  assert.equal(afterRename.focusOnHeading, true, "the edit must close and focus the heading");
  assert.equal(afterRename.storageNotice?.role, "status");
  assert.equal(afterRename.storageNotice?.text, WRITE_NOTICE, "no new error path: the write notice copy is unchanged");

  // The in-memory edit survives a re-render (selection repaint).
  await click(cdp, "[data-player-id='active-game-player-2'] .add-points-action");
  await waitForSelector(cdp, "[data-action='open-title-edit']");
  assert.equal((await readActiveState(cdp)).heading, "In-memory rename", "the in-memory edit must survive re-renders");

  const storedAfter = await readSavedGamesState(cdp, STORAGE_KEY);
  assert.equal(storedAfter.keyCount, 0, "blocked writes must keep storage untouched");
  assert.ok(
    warnings.some((warning) => warning.includes("Game save failed: write")),
    "the blocked rename save must log the code-only diagnostic"
  );
  for (const warning of warnings) {
    assert.doesNotMatch(warning, /Catan|Alex|Sam|In-memory/i, "diagnostics must stay code-only");
  }
  assert.deepEqual(consoleProblems, [], "the blocked-write session must not produce uncaught console errors");
}

// Session 4 (Scenario 4): finishing freezes the title with no edit control and
// a replay starts untitled while the finished original stays byte-identical.
async function runFinishFreezeAndReplay(cdp, { consoleProblems }) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  await createGame(cdp, "Championship cup", ["Alex", "Sam"]);
  await evaluate(cdp, () => {
    document.querySelector("#score-amount").value = "10";
    document.querySelector("#score-amount").dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector("[data-score-form] button[type='submit']").click();
  });
  await click(cdp, "[data-action='open-finish']");
  await waitForSelector(cdp, "[data-action='confirm-finish']");
  await click(cdp, "[data-action='confirm-finish']");
  await waitForSelector(cdp, "[data-podium-dialog]");

  const finished = await readActiveState(cdp);
  assert.equal(finished.heading, "Championship cup");
  assert.equal(finished.editButton, null, "finished games expose no edit control");
  assert.equal(finished.editForm, null);

  await click(cdp, "[data-action='close-podium']");
  await waitForSelector(cdp, "[data-action='play-again']");
  const storedBeforeReplay = await readSavedGamesState(cdp, STORAGE_KEY);
  const parsedBefore = JSON.parse(storedBeforeReplay.raw);
  assert.equal(parsedBefore.games.length, 1);
  const originalId = parsedBefore.games[0].id;
  const originalEntry = JSON.stringify(parsedBefore.games[0]);
  assert.equal(parsedBefore.games[0].title, "Championship cup", "the finished title stays frozen in storage");

  await click(cdp, "[data-action='play-again']");
  await waitForSelector(cdp, "#score-amount");
  const replay = await readActiveState(cdp);
  assert.ok(AUTO_LABEL_PATTERN.test(replay.heading ?? ""), `the replay must open with the auto-label, got: ${replay.heading}`);
  assert.notEqual(replay.heading, "Championship cup", "the replay must never copy the original title");

  const storedAfterReplay = await readSavedGamesState(cdp, STORAGE_KEY);
  const parsedAfter = JSON.parse(storedAfterReplay.raw);
  assert.equal(parsedAfter.games.length, 2);
  const replayEntry = parsedAfter.games.find((game) => game.id !== originalId);
  assert.equal(replayEntry.title, "", "the stored replay starts untitled");
  const storedOriginal = parsedAfter.games.find((game) => game.id === originalId);
  assert.equal(JSON.stringify(storedOriginal), originalEntry, "the finished original must stay byte-identical across the replay");

  assert.deepEqual(consoleProblems, [], "the finish-freeze session must not produce uncaught console errors");
}

// Session 5 (Scenario 5): pre-feature records render their stored titles
// verbatim, blank/missing titles render the auto-label, and an edit on a
// resumed game persists across reload without touching the other entries.
async function runLegacyRecords(cdp, { consoleProblems }) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  const legacyCreatedAt = "2026-10-01T10:00:00.000Z";
  const seeds = [
    activeSeed({ id: "legacy-titled", title: "Game night", createdAt: legacyCreatedAt, totals: [3, 0] }),
    activeSeed({ id: "legacy-blank", title: "", createdAt: "2026-10-02T11:30:00.000Z", totals: [1, 0] }),
    activeSeed({ id: "legacy-missing", title: "", createdAt: "2026-10-03T08:15:00.000Z", totals: [0, 0], withTitleField: false })
  ];
  await runWithSeeds(cdp, seeds);

  await waitForSelector(cdp, "[data-action='new-game']");
  const home = await readHomeState(cdp);
  assert.equal(home.unfinishedCards.length, 3, "all three usable seeded games must load");
  const titledCard = home.unfinishedCards.find((card) => card.gameId === "legacy-titled");
  const blankCard = home.unfinishedCards.find((card) => card.gameId === "legacy-blank");
  const missingCard = home.unfinishedCards.find((card) => card.gameId === "legacy-missing");
  assert.equal(titledCard?.title, "Game night", "a pre-feature stored title renders verbatim, not as the auto-label");
  assert.equal(titledCard?.actionLabel, "Resume Game night");
  assert.ok(AUTO_LABEL_PATTERN.test(blankCard?.title ?? ""), `a blank stored title must render the auto-label, got: ${blankCard?.title}`);
  assert.equal(blankCard?.title, expectedAutoLabel("2026-10-02T11:30:00.000Z"), "the missing-title label must match the deterministic format");
  assert.ok(AUTO_LABEL_PATTERN.test(missingCard?.title ?? ""), "a game without a title field renders the auto-label");

  // Resume the pre-feature game, rename it, and prove the edit persists.
  await click(cdp, "[data-action='resume-game'][data-game-id='legacy-titled']");
  await waitForSelector(cdp, "[data-action='open-title-edit']");
  const resumed = await readActiveState(cdp);
  assert.equal(resumed.heading, "Game night", "the resumed header shows the stored title verbatim");
  assert.equal(resumed.editButton?.label, "Edit title", "Edit title is available on a resumed active game");

  await click(cdp, "[data-action='open-title-edit']");
  await waitForSelector(cdp, "#active-title-input");
  await fill(cdp, "#active-title-input", "Renamed night");
  await click(cdp, "[data-title-edit-form] button[type='submit']");
  await waitForSelector(cdp, "[data-active-heading]");
  assert.equal((await readActiveState(cdp)).heading, "Renamed night");

  const storedAfterRename = await readSavedGamesState(cdp, STORAGE_KEY);
  const parsedAfterRename = JSON.parse(storedAfterRename.raw);
  const renamed = parsedAfterRename.games.find((game) => game.id === "legacy-titled");
  assert.equal(renamed.title, "Renamed night", "the rename must persist");
  assert.equal(renamed.createdAt, legacyCreatedAt, "the rename must not touch timestamps");

  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");
  const reloadedHome = await readHomeState(cdp);
  assert.equal(reloadedHome.unfinishedCards.find((card) => card.gameId === "legacy-titled")?.title, "Renamed night", "the edit must persist across reload");
  const blankReloaded = reloadedHome.unfinishedCards.find((card) => card.gameId === "legacy-blank");
  assert.ok(AUTO_LABEL_PATTERN.test(blankReloaded?.title ?? ""), "the blank game keeps its auto-label after the rename session");

  await click(cdp, "[data-action='resume-game'][data-game-id='legacy-titled']");
  await waitForSelector(cdp, "[data-action='open-title-edit']");
  assert.equal((await readActiveState(cdp)).heading, "Renamed night", "the resumed header shows the persisted edit");

  assert.deepEqual(consoleProblems, [], "the legacy-records session must not produce uncaught console errors");
}

async function runWithSeeds(cdp, games) {
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: seedSource(games)
  });
  await navigate(cdp, baseUrl);
}

// Session 6 (Scenario 6): the responsive and keyboard baseline at 320x720 and
// 1280x800 — no overflow, >=44px targets, the real-keyboard rename walk, and
// the setup field's Tab-order reachability.
async function runResponsiveKeyboard(cdp, { consoleProblems }) {
  await setViewport(cdp, { width: 320, height: 720, mobile: true });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  // Superseded by game-presets: the nav's New Game lands focus on the setup
  // heading, the next Tab enters the checked preset radio, and a second Tab
  // reaches the title field (the picker sits above the title).
  await click(cdp, "[data-action='nav-new-game']");
  await waitForSelector(cdp, "#game-title");
  await pressTab(cdp);
  const reachedRadio = await evaluate(cdp, () => document.activeElement?.id ?? document.activeElement?.className ?? "");
  assert.equal(reachedRadio, "game-preset-custom", "Tab must enter the checked preset radio from the setup heading");
  await pressTab(cdp);
  const reached = await evaluate(cdp, () => document.activeElement?.id ?? document.activeElement?.className ?? "");
  assert.equal(reached, "game-title", "a second Tab must reach the setup title field");
  const mobileSetup = await readSetupState(cdp);
  assert.equal(mobileSetup.value, "");
  assert.equal((await readHomeOverflow(cdp)), false, "setup must not overflow at 320px");

  await fill(cdp, "#player-name-1", "Ada");
  await fill(cdp, "#player-name-2", "Bo");
  await click(cdp, "[data-roster-form] button[type='submit']");
  await waitForSelector(cdp, "#score-amount");

  const display = await readActiveState(cdp);
  assert.equal(display.horizontalOverflow, false, "the active display header must not overflow at 320px");
  assert.ok(AUTO_LABEL_PATTERN.test(display.heading ?? ""), "the blank game auto-labels at 320px");
  assert.ok(display.editButton?.height >= 44 && display.editButton?.width >= 44, "Edit title needs a 44px target at 320px");
  const displayScreenshot = await screenshot(cdp, path.join(evidenceDir, "mobile-active-display-320px.png"));

  // Real-keyboard walk: Tab to Edit title, Enter opens the form (input
  // focused), type the new title, Enter saves.
  await pressTab(cdp);
  const tabState = await evaluate(cdp, () => {
    const style = getComputedStyle(document.activeElement);
    return {
      action: document.activeElement?.dataset?.action ?? "",
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth
    };
  });
  assert.equal(tabState.action, "open-title-edit", "Tab must reach Edit title from the page start");
  assert.notEqual(tabState.outlineStyle, "none", "keyboard focus must show a visible outline");
  assert.notEqual(tabState.outlineWidth, "0px");

  await pressEnter(cdp);
  await waitForSelector(cdp, "#active-title-input");
  assert.equal((await readActiveState(cdp)).editForm?.inputFocused, true, "Enter must open the edit with the input focused");
  const editOpenScreenshot = await screenshot(cdp, path.join(evidenceDir, "mobile-active-edit-320px.png"));

  await cdp.send("Input.insertText", { text: "Mobile renamed" });
  await pressEnter(cdp);
  await waitForSelector(cdp, "[data-active-heading]");
  const renamed = await readActiveState(cdp);
  assert.equal(renamed.heading, "Mobile renamed", "the real-keyboard walk must rename the game");
  assert.equal(renamed.focusOnHeading, true, "saving must return focus to the heading");
  assert.equal(renamed.horizontalOverflow, false, "the renamed header must not overflow at 320px");
  const storedRenamed = await readSavedGamesState(cdp, STORAGE_KEY);
  assert.equal(JSON.parse(storedRenamed.raw).games[0].title, "Mobile renamed", "the keyboard rename must persist");

  // Escape cancels at 320px too.
  await click(cdp, "[data-action='open-title-edit']");
  await waitForSelector(cdp, "#active-title-input");
  await pressEscape(cdp);
  await waitForSelector(cdp, "[data-active-heading]");
  assert.equal((await readActiveState(cdp)).heading, "Mobile renamed");

  // Finish at 320px: the podium line and the frozen read-only header.
  await finishGame(cdp);
  const mobilePodium = await readPodiumState(cdp);
  assert.equal(mobilePodium.open, true);
  assert.equal(mobilePodium.gameTitle, "Mobile renamed");
  assert.equal(mobilePodium.podiumTitleText, "Final podium");
  assert.equal(mobilePodium.ledeText, "Congratulations to the top of the table.");
  await click(cdp, "[data-action='close-podium']");
  await waitForSelector(cdp, "[data-action='play-again']");
  const mobileFinished = await readActiveState(cdp);
  assert.equal(mobileFinished.heading, "Mobile renamed");
  assert.equal(mobileFinished.editButton, null, "the finished view has no edit control at 320px");
  assert.equal(mobileFinished.horizontalOverflow, false);
  const mobileFinishedScreenshot = await screenshot(cdp, path.join(evidenceDir, "mobile-finished-320px.png"));

  // Desktop width: the same surfaces stay overflow-free with the row layout.
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  assert.equal((await readActiveState(cdp)).horizontalOverflow, false, "the finished header must not overflow at 1280px");

  assert.deepEqual(consoleProblems, [], "the responsive/keyboard session must not produce uncaught console errors");
  return { displayScreenshot, editOpenScreenshot, mobileFinishedScreenshot };
}

async function readHomeOverflow(cdp) {
  return evaluate(cdp, () => document.documentElement.scrollWidth > document.documentElement.clientWidth);
}

async function main() {
  try {
    const titled = await runSession("titled-and-blank", runTitledAndBlank);
    assert.equal(typeof titled.setupScreenshot, "string");

    const edit = await runSession("edit-mode", runEditMode);
    assert.equal(typeof edit.editScreenshot, "string");

    await runSession("blocked-write-rename", runBlockedWriteRename, {
      setupSource: BLOCK_SET_ITEM_SOURCE
    });

    await runSession("finish-freeze-replay", runFinishFreezeAndReplay);

    await runSession("legacy-records", runLegacyRecords);

    const responsive = await runSession("responsive-keyboard", runResponsiveKeyboard);
    assert.equal(typeof responsive.displayScreenshot, "string");

    console.log("Browser game-title test passed: the setup title field starts empty (label 'Game title', optional placeholder, maxlength 60) with nav New Game preserving the draft and hero/empty-state New game resetting it; a titled game renders the stored title verbatim on the active header, cards, accessible names, and the new muted podium title line (podium-title/podium-lede copy untouched), while blank, whitespace-only, and missing titles store \"\"/nothing and render the deterministic 'Game — {d MMM, HH:mm}' auto-label derived from createdAt (plain 'Game' for unusable stamps) that is stable across reloads and never written to storage; Edit title opens an inline labeled form focused on the input (Save title/Cancel >=44px, polite feedback region) where Save/Enter persist the trimmed title with a fresh updatedAt through the unchanged snapshot save (focus back on the heading), Cancel and Escape close with byte-identical storage, clearing to blank restores the auto-label, blocked writes keep the in-memory rename with the accepted role=status notice and code-only warnings, finished views freeze the title with no edit control, replays start untitled with the finished original byte-identical, pre-feature records render stored titles verbatim, and at 1280x800 and 320x720 nothing overflows while the setup Tab order is heading → checked preset radio → title and a real-keyboard Tab/Enter/type/Enter walk renames the game with visible focus.");
    console.log(`Browser evidence screenshots: ${[
      titled.setupScreenshot,
      titled.titledPodiumScreenshot,
      titled.homeScreenshot,
      edit.editScreenshot,
      responsive.displayScreenshot,
      responsive.editOpenScreenshot,
      responsive.mobileFinishedScreenshot
    ].join(", ")}`);
  } finally {
    await closeServer(server);
  }
}

await main();
