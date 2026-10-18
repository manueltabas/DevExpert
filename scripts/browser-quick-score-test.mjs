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
  const selector = `[data-action='apply-quick-score'][data-amount='${amount}']`;
  // Focus first like a real pointer activation, then click: staging never
  // re-renders, so the pressed counter keeps focus.
  await evaluate(cdp, (targetSelector) => document.querySelector(targetSelector)?.focus(), selector);
  await click(cdp, selector);
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

// Session A (Scenarios 1 + 2): counters stage the points draft — totals,
// ranks, feedback, recent entries, focus, and storage stay untouched — and
// Save points applies the combined draft as one ordinary change. Every preset
// accumulates, and undo reverses the combined change like any other change.
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
      "Add 1 point to the points draft for Alex",
      "Add 5 points to the points draft for Alex",
      "Add 10 points to the points draft for Alex",
      "Add 25 points to the points draft for Alex",
      "Add -1 point to the points draft for Alex",
      "Add -5 points to the points draft for Alex",
      "Add -10 points to the points draft for Alex"
    ],
    "counter accessible names use the signed amount, correct pluralization, and say draft"
  );
  assert.equal(panel.undoFollowsSave, true, "Save points and Undo last score stay adjacent siblings");

  const baseline = await readSavedGamesState(cdp, STORAGE_KEY);
  const before = await readQuickState(cdp);
  assert.equal(before.inputValue, "", "the amount field starts empty");
  assert.deepEqual(before.totals.map((row) => row.total), ["0", "0"]);

  // Scenario 1: +25 stages only the draft; nothing else changes and focus
  // stays on the pressed counter.
  await clickCounter(cdp, 25);
  const staged = await readQuickState(cdp);
  assert.equal(staged.inputValue, "25", "the counter stages its preset in the draft");
  assert.deepEqual(staged.totals.map((row) => row.total), ["0", "0"], "staging never changes totals");
  assert.equal(staged.feedback, "", "staging never paints feedback");
  assert.equal(staged.lastLine, null, "staging adds no recent entry");
  assert.deepEqual(staged.recentRows, []);
  assert.equal(staged.focusedAmount, "25", "focus stays on the pressed counter");
  let rawNow = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
  assert.equal(rawNow, baseline.raw, "a counter tap must not write storage");

  // Counters accumulate on the pending draft without saving.
  await clickCounter(cdp, 10);
  assert.equal((await readQuickState(cdp)).inputValue, "35");
  await clickCounter(cdp, -1);
  assert.equal((await readQuickState(cdp)).inputValue, "34");
  rawNow = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
  assert.equal(rawNow, baseline.raw, "repeated taps stay byte-identical to the pre-tap payload");

  // Save points applies the combined draft as one ordinary change.
  await click(cdp, "[data-score-form] button[type='submit']");
  await waitForSelector(cdp, "#score-amount");
  const savedState = await readQuickState(cdp);
  assert.equal(savedState.totals[0].total, "34", "Save applies the staged total, not each tap");
  assert.equal(savedState.feedback, "Added 34 points to Alex. New total: 34. Rank: 1.", "the exact accepted success message");
  assert.equal(savedState.feedbackLive, "polite", "no new live region: the existing polite region announces");
  assert.equal(savedState.inputValue, "", "the amount field clears after the save");
  assert.equal(savedState.lastLine, "Last: Alex +34", "recent entries derive for free");
  assert.deepEqual(savedState.recentRows, [["Alex", "+34 pts"]]);
  assert.equal(savedState.focusedId, "score-amount", "Save keeps the accepted typed-save focus contract");
  const storedAfterSave = await readSavedGamesState(cdp, STORAGE_KEY);
  assert.equal(storedAfterSave.payloadVersion, 1, "the envelope stays version 1");
  assert.equal(storedAfterSave.gameCount, 1, "counter-driven saves never grow the game list");
  const parsedFirst = JSON.parse(storedAfterSave.raw);
  assert.equal(parsedFirst.games[0].changes.length, 1, "one Save writes exactly one change");
  assert.deepEqual(
    Object.keys(parsedFirst.games[0].changes[0]).sort(),
    ["amount", "at", "id", "playerId"],
    "the combined change is stored with the exact typed-save shape"
  );
  assert.equal(parsedFirst.games[0].changes[0].amount, 34);
  const desktopScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-counter-draft.png"));

  // Every preset accumulates into the same draft (empty -> 41), with no save
  // until Save points.
  await selectPlayer(cdp, "active-game-player-2");
  const rawBeforeWalk = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
  const presetWalk = [
    [1, "1"],
    [5, "6"],
    [10, "16"],
    [25, "41"],
    [-1, "40"],
    [-5, "35"],
    [-10, "25"]
  ];
  for (const [amount, expected] of presetWalk) {
    await clickCounter(cdp, amount);
    const state = await readQuickState(cdp);
    assert.equal(state.inputValue, expected, `${amount} accumulates into the draft`);
    assert.deepEqual(state.totals.map((row) => row.total), ["34", "0"], `${amount} never changes totals`);
    assert.equal(state.feedback, "", `${amount} never paints feedback`);
    assert.equal(state.focusedAmount, String(amount), `focus stays on the ${amount} counter`);
  }
  assert.equal((await readSavedGamesState(cdp, STORAGE_KEY)).raw, rawBeforeWalk,
    "the full preset walk stays a byte-identical no-save");

  await click(cdp, "[data-score-form] button[type='submit']");
  await waitForSelector(cdp, "#score-amount");
  const samSaved = await readQuickState(cdp);
  assert.equal(samSaved.totals[1].total, "25", "the accumulated draft saves once");
  assert.equal(samSaved.feedback, "Added 25 points to Sam. New total: 25. Rank: 2.");
  const walkedStored = JSON.parse((await readSavedGamesState(cdp, STORAGE_KEY)).raw);
  assert.deepEqual(walkedStored.games[0].changes.map((change) => change.amount), [34, 25],
    "the game logs one change per Save");

  // Undo is ordinary: exactly the combined change reverses.
  await click(cdp, "[data-action='undo-last-score']");
  await waitForSelector(cdp, "#score-amount");
  const afterUndo = await readQuickState(cdp);
  assert.equal(afterUndo.feedback, "Undid 25 points for Sam. New total: 0. Rank: 2.");
  assert.deepEqual(afterUndo.totals.map((row) => row.total), ["34", "0"]);
  const undoneStored = JSON.parse((await readSavedGamesState(cdp, STORAGE_KEY)).raw);
  assert.deepEqual(undoneStored.games[0].changes.map((change) => change.amount), [34]);
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

// Session C (Scenario 3): a typed draft and counter taps combine into one
// staged value; Save points applies exactly that value as one change. Empty
// drafts start from the preset and additions clamp at ±1,000,000.
async function runDraftInteraction(cdp, { consoleProblems }) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  await createGame(cdp, "Draft night", ["Alex", "Sam"]);
  const baseline = await readSavedGamesState(cdp, STORAGE_KEY);

  // 12 typed + +5 + +10 + −1 = 26 in the draft; nothing saves until Save points.
  await fill(cdp, "#score-amount", "12");
  await clickCounter(cdp, 5);
  assert.equal((await readQuickState(cdp)).inputValue, "17", "a counter adds to the typed draft");
  await clickCounter(cdp, 10);
  assert.equal((await readQuickState(cdp)).inputValue, "27");
  await clickCounter(cdp, -1);
  let state = await readQuickState(cdp);
  assert.equal(state.inputValue, "26", "positive and negative counters combine with the typed draft");
  assert.deepEqual(state.totals.map((row) => row.total), ["0", "0"], "the combined draft never touches totals");
  assert.equal(state.feedback, "", "the combined draft never paints feedback");
  assert.equal((await readSavedGamesState(cdp, STORAGE_KEY)).raw, baseline.raw,
    "staging the combined draft never writes storage");

  await click(cdp, "[data-score-form] button[type='submit']");
  await waitForSelector(cdp, "#score-amount");
  state = await readQuickState(cdp);
  assert.equal(state.totals[0].total, "26", "Save applies the combined draft");
  assert.equal(state.feedback, "Added 26 points to Alex. New total: 26. Rank: 1.");
  const storedOnce = JSON.parse((await readSavedGamesState(cdp, STORAGE_KEY)).raw);
  assert.deepEqual(storedOnce.games[0].changes.map((change) => change.amount), [26],
    "the combined draft writes exactly one change-log entry");

  // Empty + −10 starts at the preset, then saves ordinarily.
  await fill(cdp, "#score-amount", "");
  await clickCounter(cdp, -10);
  state = await readQuickState(cdp);
  assert.equal(state.inputValue, "-10", "an empty draft stages the preset itself");
  assert.deepEqual(state.totals.map((row) => row.total), ["26", "0"], "staging still changes no totals");
  await click(cdp, "[data-score-form] button[type='submit']");
  await waitForSelector(cdp, "#score-amount");
  state = await readQuickState(cdp);
  assert.equal(state.totals[0].total, "16", "the negative draft saves ordinarily");
  assert.equal(state.feedback, "Added -10 points to Alex. New total: 16. Rank: 1.");

  // Additions clamp at the upper bound and stay staged.
  await fill(cdp, "#score-amount", "999999");
  await clickCounter(cdp, 25);
  state = await readQuickState(cdp);
  assert.equal(state.inputValue, "1000000", "counter additions clamp at +1,000,000");
  assert.deepEqual(state.totals.map((row) => row.total), ["16", "0"], "the clamp stays a draft-only edit");
  assert.equal((await readQuickState(cdp)).focusedAmount, "25", "focus stays on the clamped counter");

  const storedFinal = JSON.parse((await readSavedGamesState(cdp, STORAGE_KEY)).raw);
  assert.deepEqual(storedFinal.games[0].changes.map((change) => change.amount), [26, -10],
    "only the two Save presses wrote changes");
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
    "Add 1 point to the points draft for " + name,
    "Add 5 points to the points draft for " + name,
    "Add 10 points to the points draft for " + name,
    "Add 25 points to the points draft for " + name,
    "Add -1 point to the points draft for " + name,
    "Add -5 points to the points draft for " + name,
    "Add -10 points to the points draft for " + name
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
    { action: "open-finish" },
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

  // Repeat-press contract: a real Enter on the tab-reached +5 stages +5,
  // focus stays on +5 (nothing re-renders), and a second Enter accumulates.
  // Keyboard focus shows the visible outline.
  const stopOnPlusFive = await readFocusedStop(cdp);
  assert.equal(stopOnPlusFive.amount, "5", "the walk sits on the +5 counter for the Enter proof");
  assert.notEqual(stopOnPlusFive.outlineStyle, "none", "keyboard focus must show a visible outline");
  await pressEnter(cdp);
  let stop = await readFocusedStop(cdp);
  assert.equal(stop.amount, "5", "focus stays on +5 after staging");
  let quick = await readQuickState(cdp);
  assert.equal(quick.inputValue, "5", "the first Enter stages +5 in the draft");
  assert.deepEqual(quick.totals.map((row) => row.total), ["0", "0"], "the staged Enter changes no totals");
  assert.equal(quick.feedback, "", "the staged Enter paints no feedback");
  await pressEnter(cdp);
  stop = await readFocusedStop(cdp);
  assert.equal(stop.amount, "5", "focus stays on +5 for repeated presses");
  assert.notEqual(stop.outlineStyle, "none", "the still-focused counter keeps a visible outline");
  quick = await readQuickState(cdp);
  assert.equal(quick.inputValue, "10", "the second Enter accumulates another +5 in the draft");
  assert.deepEqual(quick.totals.map((row) => row.total), ["0", "0"], "repeated Enter still saves nothing");

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

// Session E (Scenario 6): under blocked writes counters still stage in memory
// and Save points applies the draft with the unchanged notice and code-only
// warnings and no storage key; finished and active-empty views expose zero
// counters or stepper.
async function runBlockedWriteAndBoundaries(cdp, { consoleProblems, warnings }) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  await createGame(cdp, "Blocked taps", ["Alex", "Sam"]);
  assert.equal((await readSavedGamesState(cdp, STORAGE_KEY)).keyCount, 0, "blocked writes must never create the storage key");

  await clickCounter(cdp, 25);
  let state = await readQuickState(cdp);
  assert.equal(state.inputValue, "25", "the counter still stages in memory");
  assert.deepEqual(state.totals.map((row) => row.total), ["0", "0"], "staging under blocked writes changes no totals");

  await click(cdp, "[data-score-form] button[type='submit']");
  await waitForSelector(cdp, "#score-amount");
  state = await readQuickState(cdp);
  assert.equal(state.totals[0].total, "25", "Save applies the draft in memory");
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

    console.log("Browser quick-score test passed: the seven quick tap counters (+1/+5/+10/+25/-1/-5/-10) and the -/+ stepper share one draft helper that adds to the pending points draft from a 0 baseline, clamps to +/-1000000 as plain integer text, and never renders, paints feedback, or saves (byte-identical payloads, unchanged totals/ranks/recent entries, focus retained on the pressed control); Save points applies the combined draft as exactly one ordinary change with the exact accepted message and focus contract; the draft-specific accessible names ('Add {n} point(s) to the points draft for {name}') and 'Quick tap counters' group label hold; at 320x720 and 1280x800 all nine new controls are >=44px with visible focus, the Decision 6 tab order, and a real-key Enter repeat-press walk that accumulates the draft; blocked writes keep staging and saving in memory with the unchanged notice, code-only warnings, and no storage key; finished and active-empty views expose zero counters or stepper; zero uncaught console errors.");
    console.log(`Browser evidence screenshots: ${[counters.desktopScreenshot, responsive.mobileScreenshot, responsive.desktopScreenshot].join(", ")}`);
  } finally {
    await closeServer(server);
  }
}

await main();
