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
const evidenceDir = await createEvidenceDir("devexpert-add-quick-score-entry");
const server = createStaticServer();
const baseUrl = await listen(server);

const WRITE_NOTICE = "Your latest change couldn't be saved. The game still works, and nothing already saved was lost — your next change will try again.";

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
  for (let index = 0; index < names.length; index += 1) {
    await fill(cdp, `#player-name-${index + 1}`, names[index]);
  }
  await click(cdp, "[data-roster-form] button[type='submit']");
  await waitForSelector(cdp, "#score-amount");
}

async function selectPlayer(cdp, playerId) {
  await click(cdp, `[data-player-id='${playerId}'] .add-points-action`);
  await waitForSelector(cdp, "#score-amount");
}

async function savePoints(cdp, amount) {
  await fill(cdp, "#score-amount", amount);
  await click(cdp, "[data-score-form] button[type='submit']");
  await waitForSelector(cdp, "#score-amount");
}

async function goHome(cdp) {
  await click(cdp, "[data-action='back-home']");
  await waitForSelector(cdp, "[data-action='new-game']");
}

async function clickCounter(cdp, amount) {
  await click(cdp, `[data-action='apply-quick-score'][data-amount='${amount}']`);
  await waitForSelector(cdp, "#score-amount");
}

async function pressStep(cdp, direction) {
  await click(cdp, `[data-action='step-score-${direction > 0 ? "up" : "down"}']`);
}

async function readQuickState(cdp) {
  return evaluate(cdp, () => ({
    inputValue: document.querySelector("#score-amount")?.value ?? null,
    feedback: document.querySelector("#score-feedback")?.textContent?.trim() ?? "",
    feedbackLive: document.querySelector("#score-feedback")?.getAttribute("aria-live") ?? null,
    totals: [...document.querySelectorAll(".active-player")].map((row) => ({
      total: row.querySelector(".active-player-total")?.textContent?.trim() ?? ""
    })),
    lastLine: document.querySelector(".recent-entries-last")?.textContent?.trim() ?? null,
    recentRows: [...document.querySelectorAll(".recent-entry")].map((row) => [
      row.querySelector(".recent-entry-name")?.textContent?.trim() ?? "",
      row.querySelector(".recent-entry-amount")?.textContent?.trim() ?? ""
    ]),
    focusedAmount: document.activeElement?.dataset?.amount ?? null,
    focusedId: document.activeElement?.id ?? null,
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
  }));
}

async function readPanelContract(cdp) {
  return evaluate(cdp, () => {
    const stepper = document.querySelector(".score-stepper");
    const down = document.querySelector("[data-action='step-score-down']");
    const input = document.querySelector("#score-amount");
    const up = document.querySelector("[data-action='step-score-up']");
    const group = document.querySelector(".quick-scores");
    const rows = [...document.querySelectorAll(".quick-scores-row")];
    const counters = [...document.querySelectorAll("[data-action='apply-quick-score']")];
    const saveButton = document.querySelector("[data-score-form] button[type='submit']");
    const undoButton = document.querySelector("[data-action='undo-last-score']");
    return {
      stepperRow: Boolean(
        stepper &&
        down?.nextElementSibling === input &&
        input?.nextElementSibling === up
      ),
      stepperTypes: [down?.getAttribute("type"), up?.getAttribute("type")],
      stepperNames: [down?.getAttribute("aria-label"), up?.getAttribute("aria-label")],
      stepperText: [down?.textContent?.trim(), up?.textContent?.trim()],
      groupRole: group?.getAttribute("role") ?? null,
      groupLabel: group?.getAttribute("aria-label") ?? null,
      eyebrow: group?.querySelector(".quick-scores-eyebrow")?.textContent?.trim() ?? null,
      rowAmounts: rows.map((row) => [...row.querySelectorAll("button")].map((button) => button.dataset.amount)),
      counters: counters.map((button) => ({
        amount: button.dataset.amount,
        type: button.getAttribute("type"),
        text: button.textContent?.trim(),
        isNegative: button.classList.contains("is-negative"),
        label: button.getAttribute("aria-label")
      })),
      counterCount: counters.length,
      undoFollowsSave: Boolean(saveButton && undoButton && saveButton.nextElementSibling === undoButton),
      newControlCount: document.querySelectorAll(
        "[data-action='apply-quick-score'], [data-action='step-score-up'], [data-action='step-score-down']"
      ).length
    };
  });
}

async function readTargets(cdp) {
  return evaluate(cdp, () => {
    const selectors = [
      "[data-action='step-score-down']",
      "[data-action='step-score-up']",
      "[data-action='apply-quick-score']"
    ];
    const nodes = selectors.flatMap((selector) => [...document.querySelectorAll(selector)]);
    return {
      count: nodes.length,
      minWidth: Math.min(...nodes.map((node) => node.getBoundingClientRect().width)),
      minHeight: Math.min(...nodes.map((node) => node.getBoundingClientRect().height))
    };
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

async function readFocusedStop(cdp) {
  return evaluate(cdp, () => {
    const element = document.activeElement;
    return {
      id: element?.id ?? null,
      action: element?.dataset?.action ?? null,
      amount: element?.dataset?.amount ?? null,
      text: element?.textContent?.trim() ?? "",
      outlineStyle: element ? getComputedStyle(element).outlineStyle : null
    };
  });
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

// Session A (Scenarios 1 + 2): a counter behaves exactly like a typed save —
// immediate apply through the ordinary path, exact accepted feedback, cleared
// input, `Last:` context, envelope version 1, focus back on the pressed
// counter — every preset works, and undo walks counter changes back like any
// other change with a byte-identical no-op at the end.
async function runDesktopCounters(cdp, { consoleProblems }) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  await createGame(cdp, "Counter night", ["Alex", "Sam"]);

  // The panel contract: stepper row − / input / +, counters group with two
  // ordered rows, type=button everywhere, Save → Undo adjacency preserved.
  const panel = await readPanelContract(cdp);
  assert.equal(panel.stepperRow, true, "the stepper must flank the input: − / #score-amount / +");
  assert.deepEqual(panel.stepperTypes, ["button", "button"], "stepper controls can never submit the form");
  assert.deepEqual(panel.stepperText, ["-", "+"], "stepper visible labels are ASCII - and +");
  assert.equal(panel.groupRole, "group");
  assert.equal(panel.groupLabel, "Quick tap counters");
  assert.equal(panel.eyebrow, "Quick tap counters", "the group carries its visible eyebrow");
  assert.deepEqual(panel.rowAmounts, [["1", "5", "10", "25"], ["-1", "-5", "-10"]], "the mockup's seven presets in two ordered rows");
  assert.equal(panel.counterCount, 7);
  for (const counter of panel.counters) {
    assert.equal(counter.type, "button", "counters can never submit the form");
  }
  assert.deepEqual(
    panel.counters.map((counter) => counter.text),
    ["+1", "+5", "+10", "+25", "-1", "-5", "-10"],
    "visible labels carry the ASCII sign"
  );
  assert.deepEqual(
    panel.counters.filter((counter) => Number(counter.amount) < 0).every((counter) => counter.isNegative),
    true,
    "negative chips carry the tint class"
  );
  assert.deepEqual(
    panel.counters.map((counter) => counter.label),
    [
      "Add 1 point to Alex",
      "Add 5 points to Alex",
      "Add 10 points to Alex",
      "Add 25 points to Alex",
      "Add -1 point to Alex",
      "Add -5 points to Alex",
      "Add -10 points to Alex"
    ],
    "counter accessible names use the signed amount with correct pluralization"
  );
  assert.equal(panel.undoFollowsSave, true, "Save points and Undo last score stay adjacent siblings");

  // Scenario 1: +25 from an empty field on the selected player.
  const before = await readQuickState(cdp);
  assert.equal(before.inputValue, "", "the amount field starts empty");
  await clickCounter(cdp, 25);
  const afterFirst = await readQuickState(cdp);
  assert.equal(afterFirst.totals[0].total, "25", "the counter applies immediately");
  assert.equal(afterFirst.feedback, "Added 25 points to Alex. New total: 25. Rank: 1.", "the exact accepted success message");
  assert.equal(afterFirst.feedbackLive, "polite", "no new live region: the existing polite region announces");
  assert.equal(afterFirst.inputValue, "", "the amount field clears after the counter applies");
  assert.equal(afterFirst.lastLine, "Last: Alex +25", "recent entries derive for free");
  assert.deepEqual(afterFirst.recentRows, [["Alex", "+25 pts"]]);
  assert.equal(afterFirst.focusedAmount, "25", "focus returns to the pressed counter");
  const storedAfterFirst = await readSavedGamesState(cdp, STORAGE_KEY);
  assert.equal(storedAfterFirst.payloadVersion, 1, "the envelope stays version 1");
  assert.equal(storedAfterFirst.gameCount, 1, "counter saves never grow the game list");
  const parsedFirst = JSON.parse(storedAfterFirst.raw);
  assert.equal(parsedFirst.games[0].changes.length, 1);
  assert.deepEqual(
    Object.keys(parsedFirst.games[0].changes[0]).sort(),
    ["amount", "at", "id", "playerId"],
    "a counter change is stored with the exact typed-save shape"
  );
  assert.equal(parsedFirst.games[0].changes[0].amount, 25);
  const desktopScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-counter-tap.png"));

  // Scenario 2: every preset on a fresh game, negatives included.
  await goHome(cdp);
  await createGame(cdp, "Preset walk night", ["Alex", "Sam"]);
  const savedAfterSecondGame = await readSavedGamesState(cdp, STORAGE_KEY);
  assert.equal(savedAfterSecondGame.gameCount, 2, "only game creation grows the saved list");

  const presetWalk = [
    [1, "Added 1 points to Alex. New total: 1. Rank: 1.", "1"],
    [5, "Added 5 points to Alex. New total: 6. Rank: 1.", "6"],
    [10, "Added 10 points to Alex. New total: 16. Rank: 1.", "16"],
    [25, "Added 25 points to Alex. New total: 41. Rank: 1.", "41"]
  ];
  for (const [amount, message, total] of presetWalk) {
    await clickCounter(cdp, amount);
    const state = await readQuickState(cdp);
    assert.equal(state.totals[0].total, total, `+${amount} lands like a typed save`);
    assert.equal(state.feedback, message, `+${amount} announces the exact accepted message`);
    assert.equal(state.inputValue, "", `the draft clears after +${amount}`);
    assert.equal(state.focusedAmount, String(amount), `focus returns to the +${amount} counter`);
  }

  await selectPlayer(cdp, "active-game-player-2");
  const negativeWalk = [
    [-1, "Added -1 points to Sam. New total: -1. Rank: 2.", "-1"],
    [-5, "Added -5 points to Sam. New total: -6. Rank: 2.", "-6"],
    [-10, "Added -10 points to Sam. New total: -16. Rank: 2.", "-16"]
  ];
  for (const [amount, message, total] of negativeWalk) {
    await clickCounter(cdp, amount);
    const state = await readQuickState(cdp);
    assert.equal(state.totals[1].total, total, `${amount} lands like a typed save`);
    assert.equal(state.feedback, message, `${amount} announces the exact accepted message`);
    assert.equal(state.focusedAmount, String(amount), `focus returns to the ${amount} counter`);
  }
  const walkedState = await readQuickState(cdp);
  assert.equal(walkedState.lastLine, "Last: Sam -10", "`Last:` recomputes from the newest counter change");
  const walkedStored = JSON.parse((await readSavedGamesState(cdp, STORAGE_KEY)).raw);
  const walkedGame = walkedStored.games.find((game) => game.title === "Preset walk night");
  assert.equal(walkedGame.changes.length, 7, "the counter taps logged exactly seven changes");
  const storedAfterFirstGame = walkedStored.games.find((game) => game.title === "Counter night");
  assert.equal(storedAfterFirstGame.changes.length, 1, "the earlier game's log is untouched");

  // Undo is ordinary: exactly the latest counter change reverses, entries
  // disappear, repeated undos drain the log, and the final no-op is a
  // byte-identical no-write.
  const undoWalk = [
    "Undid -10 points for Sam. New total: -6. Rank: 2.",
    "Undid -5 points for Sam. New total: -1. Rank: 2.",
    "Undid -1 points for Sam. New total: 0. Rank: 2.",
    "Undid 25 points for Alex. New total: 16. Rank: 1.",
    "Undid 10 points for Alex. New total: 6. Rank: 1.",
    "Undid 5 points for Alex. New total: 1. Rank: 1.",
    "Undid 1 points for Alex. New total: 0. Rank: 1."
  ];
  for (const message of undoWalk) {
    await click(cdp, "[data-action='undo-last-score']");
    await waitForSelector(cdp, "#score-amount");
    const state = await readQuickState(cdp);
    assert.equal(state.feedback, message, "undo walks counter changes back like any other change");
  }
  const drainedStored = JSON.parse((await readSavedGamesState(cdp, STORAGE_KEY)).raw);
  assert.equal(drainedStored.games.find((game) => game.title === "Preset walk night").changes.length, 0, "the log drains to empty");
  const rawBeforeNoop = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
  await click(cdp, "[data-action='undo-last-score']");
  await waitForSelector(cdp, "#score-amount");
  const noopState = await readQuickState(cdp);
  assert.equal(noopState.feedback, "Nothing to undo yet.", "the accepted no-op copy is unchanged");
  const rawAfterNoop = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
  assert.equal(rawAfterNoop, rawBeforeNoop, "the no-op undo stays a byte-identical no-write");
  assert.deepEqual(consoleProblems, [], "the desktop counters session must not produce uncaught console errors");
  return { desktopScreenshot };
}

// Session B (Scenario 3): the stepper stages the draft and never saves —
// byte-identical payload, unchanged feedback/totals, no re-render — while the
// 0 baseline, clamping, and the ordinary save of a stepped draft all hold.
async function runStepperStages(cdp, { consoleProblems }) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  await createGame(cdp, "Step night", ["Alex", "Sam"]);
  const baseline = await readSavedGamesState(cdp, STORAGE_KEY);
  assert.equal(baseline.gameCount, 1);

  // Re-render proof: a DOM sentinel on the leaderboard must survive stepping.
  await evaluate(cdp, () => {
    document.querySelector(".active-player").dataset.stepperProbe = "1";
  });

  // +1 → 0 → 0 → −1 with a 0 baseline for the empty draft.
  await pressStep(cdp, 1);
  let value = await evaluate(cdp, () => document.querySelector("#score-amount").value);
  assert.equal(value, "1", "an empty draft steps from the 0 baseline to plain '1'");
  await pressStep(cdp, -1);
  value = await evaluate(cdp, () => document.querySelector("#score-amount").value);
  assert.equal(value, "0", "stepping down reaches plain '0'");
  await pressStep(cdp, -1);
  value = await evaluate(cdp, () => document.querySelector("#score-amount").value);
  assert.equal(value, "-1", "stepping below zero goes negative");

  await fill(cdp, "#score-amount", "5");
  await pressStep(cdp, 1);
  value = await evaluate(cdp, () => document.querySelector("#score-amount").value);
  assert.equal(value, "6", "stepping builds on the present draft");

  await fill(cdp, "#score-amount", "1000000");
  await pressStep(cdp, 1);
  value = await evaluate(cdp, () => document.querySelector("#score-amount").value);
  assert.equal(value, "1000000", "stepping clamps at the upper bound");
  await fill(cdp, "#score-amount", "-1000000");
  await pressStep(cdp, -1);
  value = await evaluate(cdp, () => document.querySelector("#score-amount").value);
  assert.equal(value, "-1000000", "stepping clamps at the lower bound");

  // Chrome sanitizes a number input's value: transient shapes like "12." and
  // a lone sign can never persist in .value (both sanitize to ""), so the
  // observable behavior is the 0-baseline path. Unparseable drafts are pinned
  // at 0 exactly as decided.
  await fill(cdp, "#score-amount", "12.");
  value = await evaluate(cdp, () => document.querySelector("#score-amount").value);
  assert.equal(value, "", "the number input sanitizes a trailing-dot draft to ''");
  await pressStep(cdp, 1);
  value = await evaluate(cdp, () => document.querySelector("#score-amount").value);
  assert.equal(value, "1", "a sanitized transient draft steps from the 0 baseline");
  await fill(cdp, "#score-amount", "+");
  value = await evaluate(cdp, () => document.querySelector("#score-amount").value);
  assert.equal(value, "", "the number input sanitizes a lone sign to ''");
  await pressStep(cdp, -1);
  value = await evaluate(cdp, () => document.querySelector("#score-amount").value);
  assert.equal(value, "-1", "a sanitized lone-sign draft steps from the 0 baseline");

  const afterSteps = await readQuickState(cdp);
  assert.deepEqual(afterSteps.totals.map((row) => row.total), ["0", "0"], "stepping never changes totals");
  assert.equal(afterSteps.feedback, "", "stepping never paints feedback");
  const sentinels = await evaluate(cdp, () => document.querySelectorAll("[data-stepper-probe]").length);
  assert.equal(sentinels, 1, "stepping never re-renders the view");
  const rawAfterSteps = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
  assert.equal(rawAfterSteps, baseline.raw, "stepping must be a byte-identical no-save across every step");

  // A stepped draft saves as one ordinary score change; a 0 draft keeps the
  // exact accepted zero message and writes nothing.
  await fill(cdp, "#score-amount", "-1");
  await click(cdp, "[data-score-form] button[type='submit']");
  await waitForSelector(cdp, "#score-amount");
  const savedState = await readQuickState(cdp);
  assert.deepEqual(savedState.totals.map((row) => row.total), ["0", "-1"], "the stepped draft saves ordinarily (the leaderboard re-sorts: Sam 0 first, Alex -1 second)");
  assert.equal(savedState.feedback, "Added -1 points to Alex. New total: -1. Rank: 2.");
  assert.equal(savedState.focusedId, "score-amount", "typed saves keep the accepted focus contract");
  const rawAfterSave = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
  assert.notEqual(rawAfterSave, baseline.raw, "the stepped-draft save is a real write");
  assert.equal(JSON.parse(rawAfterSave).games[0].changes.length, 1);

  await savePoints(cdp, "0");
  const zeroState = await readQuickState(cdp);
  assert.equal(zeroState.feedback, "Zero adds no points. Enter a positive or negative amount.", "the exact accepted zero message");
  const rawAfterZero = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
  assert.equal(rawAfterZero, rawAfterSave, "the rejected zero draft must not write");
  assert.deepEqual(consoleProblems, [], "the stepper session must not produce uncaught console errors");
}

// Session C (Scenario 4): a counter discards a typed draft — never sums — and
// a subsequent typed save applies ordinarily.
async function runDraftInteraction(cdp, { consoleProblems }) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  await createGame(cdp, "Draft night", ["Alex", "Sam"]);

  await fill(cdp, "#score-amount", "12");
  await clickCounter(cdp, 5);
  let state = await readQuickState(cdp);
  assert.equal(state.totals[0].total, "5", "the counter applies exactly its preset (not 17)");
  assert.equal(state.feedback, "Added 5 points to Alex. New total: 5. Rank: 1.");
  assert.equal(state.inputValue, "", "the typed draft is discarded, not applied");

  await fill(cdp, "#score-amount", "12");
  await clickCounter(cdp, -10);
  state = await readQuickState(cdp);
  assert.equal(state.totals[1].total, "-5", "a negative counter also discards the draft (5 - 10 = -5, re-ranked below Sam's 0)");
  assert.equal(state.feedback, "Added -10 points to Alex. New total: -5. Rank: 2.");

  // A lone-sign draft is the sanitized empty draft: the counter still applies
  // exactly its preset.
  await fill(cdp, "#score-amount", "+");
  await clickCounter(cdp, 25);
  state = await readQuickState(cdp);
  assert.equal(state.totals[0].total, "20", "-5 + 25 = 20 with the sanitized draft discarded");
  assert.equal(state.feedback, "Added 25 points to Alex. New total: 20. Rank: 1.");

  await savePoints(cdp, "12");
  state = await readQuickState(cdp);
  assert.equal(state.totals[0].total, "32", "a subsequent typed save applies ordinarily");
  assert.equal(state.feedback, "Added 12 points to Alex. New total: 32. Rank: 1.");
  const stored = JSON.parse((await readSavedGamesState(cdp, STORAGE_KEY)).raw);
  assert.deepEqual(
    stored.games[0].changes.map((change) => change.amount),
    [5, -10, 25, 12],
    "the log carries each change in order"
  );
  assert.deepEqual(consoleProblems, [], "the draft-interaction session must not produce uncaught console errors");
}

// Session D (Scenario 5): targets, names, group label, real-key walk with the
// repeat-press focus contract, no overflow, zero console errors — at 320×720
// and 1280×800.
async function runResponsiveA11y(cdp, { consoleProblems }) {
  await setViewport(cdp, { width: 320, height: 720, mobile: true });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  await createGame(cdp, "Tap night", ["Alex", "Sam"]);

  const namesFor = (name) => [
    "Add 1 point to " + name,
    "Add 5 points to " + name,
    "Add 10 points to " + name,
    "Add 25 points to " + name,
    "Add -1 point to " + name,
    "Add -5 points to " + name,
    "Add -10 points to " + name
  ];

  const assertPanelBaseline = async (label) => {
    const targets = await readTargets(cdp);
    assert.equal(targets.count, 9, `${label}: nine new controls render`);
    assert.ok(targets.minHeight >= 44, `${label}: every new control needs a >=44px height (got ${targets.minHeight})`);
    assert.ok(targets.minWidth >= 44, `${label}: every new control needs a >=44px width (got ${targets.minWidth})`);
    const panel = await readPanelContract(cdp);
    assert.deepEqual(panel.stepperNames, [
      "Decrease points draft by 1 for Alex",
      "Increase points draft by 1 for Alex"
    ], `${label}: stepper names say "draft" for the selected player`);
    assert.deepEqual(
      panel.counters.map((counter) => counter.label),
      namesFor("Alex"),
      `${label}: counter names carry the signed amount and the player's name`
    );
    assert.equal(panel.groupLabel, "Quick tap counters", `${label}: the group stays labelled`);
    const overflow = await evaluate(cdp, () => ({
      document: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      body: document.body.scrollWidth > document.body.clientWidth
    }));
    assert.equal(overflow.document, false, `${label}: no horizontal overflow (documentElement)`);
    assert.equal(overflow.body, false, `${label}: no horizontal overflow (body)`);
  };

  await assertPanelBaseline("320px");
  const mobileScreenshot = await screenshot(cdp, path.join(evidenceDir, "mobile-quick-scores-320px.png"));

  // Real-key walk from the active heading: the panel's inner tab order is
  // − → input → + → +1 → +5 → +10 → +25 → −1 → −5 → −10 → Save → Undo.
  assert.equal((await readFocusedStop(cdp)).id, "active-title", "the walk starts from the focused heading");
  const stopsBeforePlusFive = [
    { action: "open-title-edit" },
    { action: "select-player" },
    { action: "select-player" },
    { action: "step-score-down" },
    { id: "score-amount" },
    { action: "step-score-up" },
    { action: "apply-quick-score", amount: "1" },
    { action: "apply-quick-score", amount: "5" }
  ];
  for (const expected of stopsBeforePlusFive) {
    await pressTab(cdp);
    const stop = await readFocusedStop(cdp);
    if (expected.id) {
      assert.equal(stop.id, expected.id, `tab order reaches ${expected.id}`);
    }
    if (expected.action) {
      assert.equal(stop.action, expected.action, `tab order reaches ${expected.action}`);
    }
    if (expected.amount !== undefined) {
      assert.equal(stop.amount, expected.amount, `tab order reaches the ${expected.amount} counter`);
    }
  }

  // Repeat-press contract: a real Enter on the tab-reached +5 applies, focus
  // returns to +5, and a second Enter applies again. Keyboard focus shows the
  // visible outline.
  const stopOnPlusFive = await readFocusedStop(cdp);
  assert.equal(stopOnPlusFive.amount, "5", "the walk sits on the +5 counter for the Enter proof");
  assert.notEqual(stopOnPlusFive.outlineStyle, "none", "keyboard focus must show a visible outline");
  await pressEnter(cdp);
  await waitForSelector(cdp, "#score-amount");
  let stop = await readFocusedStop(cdp);
  assert.equal(stop.amount, "5", "focus returns to +5 after the apply");
  let quick = await readQuickState(cdp);
  assert.equal(quick.totals[0].total, "5", "the first Enter applies +5");
  assert.equal(quick.feedback, "Added 5 points to Alex. New total: 5. Rank: 1.");
  await pressEnter(cdp);
  await waitForSelector(cdp, "#score-amount");
  stop = await readFocusedStop(cdp);
  assert.equal(stop.amount, "5", "focus stays on +5 for repeated presses");
  assert.notEqual(stop.outlineStyle, "none", "the re-focused counter keeps a visible outline");
  quick = await readQuickState(cdp);
  assert.equal(quick.totals[0].total, "10", "the second Enter applies +5 again");
  assert.equal(quick.feedback, "Added 5 points to Alex. New total: 10. Rank: 1.");

  // The walk resumes from the rebuilt +5 button: the rest of the Decision 6
  // order is asserted with the same real keys.
  const stopsAfterPlusFive = [
    { action: "apply-quick-score", amount: "10" },
    { action: "apply-quick-score", amount: "25" },
    { action: "apply-quick-score", amount: "-1" },
    { action: "apply-quick-score", amount: "-5" },
    { action: "apply-quick-score", amount: "-10" },
    { text: "Save points" },
    { action: "undo-last-score" }
  ];
  for (const expected of stopsAfterPlusFive) {
    await pressTab(cdp);
    const walkStop = await readFocusedStop(cdp);
    if (expected.action) {
      assert.equal(walkStop.action, expected.action, `tab order reaches ${expected.action}`);
    }
    if (expected.amount !== undefined) {
      assert.equal(walkStop.amount, expected.amount, `tab order reaches the ${expected.amount} counter`);
    }
    if (expected.text) {
      assert.equal(walkStop.text, expected.text, `tab order reaches ${expected.text}`);
    }
  }

  // Desktop width: the same guarantees hold.
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await assertPanelBaseline("1280px");
  const desktopScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-quick-scores.png"));
  assert.deepEqual(consoleProblems, [], "the responsive session must not produce uncaught console errors");
  return { mobileScreenshot, desktopScreenshot };
}

// Session E (Scenario 6): under blocked writes a counter still applies in
// memory with the unchanged notice and code-only warnings and no storage key;
// finished and active-empty views expose zero counters or stepper.
async function runBlockedWriteAndBoundaries(cdp, { consoleProblems, warnings }) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  await createGame(cdp, "Blocked taps", ["Alex", "Sam"]);
  assert.equal((await readSavedGamesState(cdp, STORAGE_KEY)).keyCount, 0, "blocked writes must never create the storage key");

  await clickCounter(cdp, 25);
  const state = await readQuickState(cdp);
  assert.equal(state.totals[0].total, "25", "the counter still applies in memory");
  assert.equal(state.feedback, "Added 25 points to Alex. New total: 25. Rank: 1.", "the success feedback is unchanged");
  const notice = await evaluate(cdp, () => {
    const region = document.querySelector("[data-storage-notice]");
    return {
      present: Boolean(region),
      role: region?.getAttribute("role") ?? null,
      text: region?.textContent?.trim() ?? ""
    };
  });
  assert.equal(notice.present, true, "the write notice renders");
  assert.equal(notice.role, "status");
  assert.equal(notice.text, WRITE_NOTICE, "the accepted notice copy is unchanged");
  assert.equal((await readSavedGamesState(cdp, STORAGE_KEY)).keyCount, 0, "no storage key exists after the counter tap");
  assert.ok(
    warnings.some((warning) => warning.includes("Game save failed: write")),
    "the blocked save logs the code-only diagnostic"
  );

  // Finish the game in memory: the finished view must expose no counters or
  // stepper anywhere in the DOM.
  await click(cdp, "[data-action='open-finish']");
  await waitForSelector(cdp, "[data-action='confirm-finish']");
  await click(cdp, "[data-action='confirm-finish']");
  await waitForSelector(cdp, "[data-podium-dialog]");
  await click(cdp, "[data-action='close-podium']");
  await waitForSelector(cdp, "[data-action='play-again']");
  let newControls = await evaluate(cdp, () => document.querySelectorAll(
    "[data-action='apply-quick-score'], [data-action='step-score-up'], [data-action='step-score-down']"
  ).length);
  assert.equal(newControls, 0, "the finished view renders no counters or stepper");

  // With blocked writes there are no saved cards, so the nav's Active Game
  // lands on the empty state — which must also expose no counters/stepper.
  await goHome(cdp);
  await click(cdp, "[data-action='nav-active-game']");
  await waitForSelector(cdp, "[data-active-empty-heading]");
  newControls = await evaluate(cdp, () => document.querySelectorAll(
    "[data-action='apply-quick-score'], [data-action='step-score-up'], [data-action='step-score-down']"
  ).length);
  assert.equal(newControls, 0, "the active-empty view renders no counters or stepper");

  for (const warning of warnings) {
    assert.doesNotMatch(warning, /Alex|Sam|Blocked taps/i, "diagnostics must stay code-only");
  }
  assert.deepEqual(consoleProblems, [], "the blocked-write session must not produce uncaught console errors");
}

async function main() {
  try {
    const counters = await runSession("desktop-counters", runDesktopCounters);
    assert.equal(typeof counters.desktopScreenshot, "string");

    await runSession("stepper-stages", runStepperStages);
    await runSession("draft-interaction", runDraftInteraction);

    const responsive = await runSession("responsive-a11y", runResponsiveA11y);
    assert.equal(typeof responsive.mobileScreenshot, "string");

    await runSession("blocked-write-boundaries", runBlockedWriteAndBoundaries, {
      setupSource: BLOCK_SET_ITEM_SOURCE
    });

    console.log("Browser quick-score test passed: the seven quick tap counters (+1/+5/+10/+25/-1/-5/-10) apply immediately through the unchanged score-save path with the exact accepted messages, cleared drafts, `Last:` context, envelope version 1, and focus returned to the pressed counter; undo treats counter changes like any other change with a byte-identical no-op at the end; the -/+ stepper stages the draft from a 0 baseline, clamps to +/-1000000 as plain integer text, never saves (byte-identical payload, no re-render, no feedback), and a stepped draft saves ordinarily while a 0 draft keeps the exact zero message; counters discard typed drafts without summing; at 320x720 and 1280x800 all nine new controls are >=44px with visible focus, the Decision 6 accessible names, the 'Quick tap counters' group label, the Decision 6 tab order, and a real-key Enter repeat-press walk; blocked writes keep counters working in memory with the unchanged notice, code-only warnings, and no storage key; finished and active-empty views expose zero counters or stepper; zero uncaught console errors.");
    console.log(`Browser evidence screenshots: ${[counters.desktopScreenshot, responsive.mobileScreenshot, responsive.desktopScreenshot].join(", ")}`);
  } finally {
    await closeServer(server);
  }
}

await main();
