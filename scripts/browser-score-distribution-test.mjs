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
const evidenceDir = await createEvidenceDir("devexpert-show-score-distribution");
const server = createStaticServer();
const baseUrl = await listen(server);

function seededPlayers(id, names, totals, colors) {
  return names.map((name, index) => ({
    id: `${id}-player-${index + 1}`,
    name,
    color: colors[index % colors.length],
    marker: String(index + 1),
    order: index,
    total: totals[index] ?? 0
  }));
}

function seededGame({ id, title = "", status = "active", createdAt, updatedAt, names, totals, colors = ["blue", "red", "green", "yellow"] }) {
  const game = {
    id,
    title,
    status,
    players: seededPlayers(id, names, totals, colors)
  };

  if (createdAt !== undefined) {
    game.createdAt = createdAt;
  }

  if (updatedAt !== undefined) {
    game.updatedAt = updatedAt;
  }

  return game;
}

function seedSource(games) {
  // Seed exactly once per tab: later navigations in the same session must
  // re-read the stored payload untouched (byte-identity proofs).
  return `
    if (!sessionStorage.getItem("score-distribution-seed-applied")) {
      sessionStorage.setItem("score-distribution-seed-applied", "1");
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
    cdp.on("Runtime.exceptionThrown", (event) => {
      consoleProblems.push(event.exceptionDetails?.text ?? "Runtime exception");
    });
    cdp.on("Log.entryAdded", (event) => {
      if (event.entry?.level === "error") {
        consoleProblems.push(event.entry.text);
      }
    });

    await cdp.send("Runtime.enable");
    await cdp.send("Log.enable");
    await cdp.send("Page.enable");
    if (setupSource) {
      await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: setupSource });
    }

    return await run(cdp, { consoleProblems });
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
  // The setup form starts with two rows; grow it to the roster size first.
  for (let index = 2; index < names.length; index += 1) {
    await click(cdp, "[data-action='add-player']");
    await waitForSelector(cdp, `#player-name-${index + 1}`);
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

// The seeded math session stores eight active games; the Dashboard preview
// (refine-ui-after-testing) shows only the five most recent until expanded.
async function expandUnfinishedPreview(cdp) {
  const togglePresent = await evaluate(cdp, () =>
    Boolean(document.querySelector("[data-action='toggle-unfinished-games']")));

  if (togglePresent) {
    await click(cdp, "[data-action='toggle-unfinished-games']");
  }
}

async function goHome(cdp) {
  await click(cdp, "[data-action='back-home']");
  await waitForSelector(cdp, "[data-action='new-game']");
}

// One read of the whole block: caption, segments (style widths + token color
// classes + rendered pixel widths), legend entries, aria strategy, focusable
// count, and its placement after the standings list.
async function readDistribution(cdp) {
  return evaluate(cdp, () => {
    const block = document.querySelector("[data-score-distribution]");

    if (!block) {
      return null;
    }

    const bar = block.querySelector(".score-distribution-bar");
    const legend = block.querySelector(".score-distribution-legend");
    const roster = block.parentElement?.querySelector(".active-roster");

    return {
      present: true,
      eyebrow: block.querySelector(".score-distribution-header .eyebrow")?.textContent?.trim() ?? null,
      total: block.querySelector(".score-distribution-total")?.textContent?.trim() ?? null,
      emptyText: block.querySelector(".score-distribution-empty")?.textContent?.trim() ?? null,
      barPresent: Boolean(bar),
      barAriaHidden: bar?.getAttribute("aria-hidden") ?? null,
      legendPresent: Boolean(legend),
      legendLabel: legend?.getAttribute("aria-label") ?? null,
      segments: [...(bar?.querySelectorAll(".score-distribution-segment") ?? [])].map((segment) => ({
        styleWidth: segment.getAttribute("style") ?? "",
        colorClasses: [...segment.classList].filter((name) => name !== "score-distribution-segment"),
        widthPx: segment.getBoundingClientRect().width
      })),
      barWidthPx: bar ? bar.getBoundingClientRect().width : null,
      legendEntries: [...(legend?.querySelectorAll(".score-distribution-legend-item") ?? [])].map((item) => ({
        text: item.querySelector(".score-distribution-legend-text")?.textContent?.trim() ?? "",
        dotColorClasses: [...(item.querySelector(".marker")?.classList ?? [])].filter((name) => name !== "marker"),
        dotAriaHidden: item.querySelector(".marker")?.getAttribute("aria-hidden") ?? null
      })),
      leaderboardNames: [...(roster?.querySelectorAll(".active-player-name") ?? [])].map((name) => name.textContent?.trim() ?? ""),
      focusableCount: block.querySelectorAll("button, input, select, textarea, a[href], [tabindex]").length,
      afterRosterList: Boolean(roster && (roster.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING)),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
}

// Width↔percent correspondence: every segment's rendered pixel width must be
// its integer percent of the track within ±1px (subpixel rounding).
function assertWidthsMatchPercents(distribution, percents, label) {
  assert.equal(distribution.segments.length, percents.length, `${label}: segment count`);
  distribution.segments.forEach((segment, index) => {
    assert.equal(segment.styleWidth, `width:${percents[index]}%`, `${label}: segment ${index + 1} inline width`);
    const expected = (distribution.barWidthPx * percents[index]) / 100;
    assert.ok(
      Math.abs(segment.widthPx - expected) <= 1,
      `${label}: segment ${index + 1} rendered ${segment.widthPx.toFixed(2)}px, expected ~${expected.toFixed(2)}px`
    );
  });
}

function parseLegendPercents(distribution) {
  return distribution.legendEntries.map((entry) => {
    const match = entry.text.match(/ (\d+)%$/);
    assert.ok(match, `legend entry "${entry.text}" must end with " {percent}%"`);
    return Number(match[1]);
  });
}

// Session 1 (Scenarios 1 + 2): the UI-scored happy path reproduces the mockup
// shares, undo and a reordering save re-derive the block on the same render,
// selection changes never write, and the block stays display-only.
async function runUiScoredDerivation(cdp, { consoleProblems }) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  await createGame(cdp, "Distribution night", ["Alex", "Sam", "Jamie", "Taylor"]);

  // A fresh all-zero game: caption renders, bar and legend do not.
  await waitForSelector(cdp, "[data-score-distribution]");
  const fresh = await readDistribution(cdp);
  assert.equal(fresh.eyebrow, "Score distribution");
  assert.equal(fresh.total, "0 total game points");
  assert.equal(fresh.emptyText, "No shares to show while the game total is zero or negative.");
  assert.equal(fresh.barPresent, false);
  assert.equal(fresh.legendPresent, false);
  assert.equal(fresh.focusableCount, 0, "the block is display-only and must add no focusable elements");
  assert.equal(fresh.afterRosterList, true, "the block sits immediately after the standings list");

  // +42 Alex (selected by default), +35 Sam, +28 Jamie, +19 Taylor.
  await savePoints(cdp, "42");
  await waitForSelector(cdp, ".score-distribution-segment");
  await selectPlayer(cdp, "active-game-player-2");
  await savePoints(cdp, "35");
  await selectPlayer(cdp, "active-game-player-3");
  await savePoints(cdp, "28");
  await selectPlayer(cdp, "active-game-player-4");
  await savePoints(cdp, "19");
  await waitForSelector(cdp, ".score-distribution-legend");

  const happy = await readDistribution(cdp);
  assert.equal(happy.total, "124 total game points");
  assert.equal(happy.barAriaHidden, "true", "the bar is decorative and aria-hidden");
  assert.equal(happy.legendLabel, "Score distribution");
  assert.deepEqual(happy.leaderboardNames, ["Alex", "Sam", "Jamie", "Taylor"]);
  assert.deepEqual(
    happy.legendEntries.map((entry) => entry.text),
    ["Alex 34%", "Sam 28%", "Jamie 23%", "Taylor 15%"],
    "the mockup totals render the largest-remainder shares in leaderboard order"
  );
  assert.deepEqual(
    happy.segments.map((segment) => segment.colorClasses),
    [["marker-blue"], ["marker-red"], ["marker-yellow"], ["marker-green"]],
    "segments reuse the exact player token colors (positional draft colors)"
  );
  assert.deepEqual(
    happy.legendEntries.map((entry) => entry.dotColorClasses),
    [["marker-blue"], ["marker-red"], ["marker-yellow"], ["marker-green"]],
    "legend dots carry the same token colors"
  );
  assert.ok(happy.legendEntries.every((entry) => entry.dotAriaHidden === "true"), "legend dots are aria-hidden");
  const happyPercents = parseLegendPercents(happy);
  assert.equal(happyPercents.reduce((sum, percent) => sum + percent, 0), 100, "displayed percents sum to exactly 100");
  assert.deepEqual(happyPercents, [34, 28, 23, 15]);
  assertWidthsMatchPercents(happy, happyPercents, "happy path");
  assert.equal(happy.segments.length, happy.legendEntries.length, "segments and legend stay 1:1");
  assert.equal(happy.focusableCount, 0);
  assert.equal(happy.horizontalOverflow, false);
  const desktopScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-happy-path.png"));

  // Undo pops Taylor's +19: the caption, segments, and legend re-derive on the
  // same render (42/35/28/0 of 105 -> 40/33/27, the zero-total player omitted).
  const storedBeforeUndo = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
  await click(cdp, "[data-action='undo-last-score']");
  await waitForSelector(cdp, ".score-distribution-legend");
  const afterUndo = await readDistribution(cdp);
  assert.equal(afterUndo.total, "105 total game points");
  assert.deepEqual(afterUndo.leaderboardNames, ["Alex", "Sam", "Jamie", "Taylor"]);
  assert.deepEqual(parseLegendPercents(afterUndo), [40, 33, 27]);
  assert.deepEqual(
    afterUndo.legendEntries.map((entry) => entry.text),
    ["Alex 40%", "Sam 33%", "Jamie 27%"],
    "the zero-total player disappears from the legend after undo"
  );
  assertWidthsMatchPercents(afterUndo, parseLegendPercents(afterUndo), "after undo");
  assert.equal(afterUndo.focusableCount, 0);
  const storedAfterUndo = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
  assert.notEqual(storedAfterUndo, storedBeforeUndo, "undo is a mutation and persists the shortened log");
  const parsedAfterUndo = JSON.parse(storedAfterUndo);
  assert.equal(parsedAfterUndo.version, 1, "the envelope stays version 1");
  assert.deepEqual(
    Object.keys(parsedAfterUndo.games[0].players[0]).sort(),
    ["color", "id", "marker", "name", "order", "total"],
    "players gain no persisted distribution fields"
  );

  // A reordering save: Taylor +50 takes rank 1 and the legend follows the
  // leaderboard order (50/42/35/28 of 155 -> 32/27/23/18).
  await selectPlayer(cdp, "active-game-player-4");
  await savePoints(cdp, "50");
  await waitForSelector(cdp, ".score-distribution-legend");
  const afterReorder = await readDistribution(cdp);
  assert.equal(afterReorder.total, "155 total game points");
  assert.deepEqual(afterReorder.leaderboardNames, ["Taylor", "Alex", "Sam", "Jamie"]);
  assert.deepEqual(
    afterReorder.legendEntries.map((entry) => entry.text),
    ["Taylor 32%", "Alex 27%", "Sam 23%", "Jamie 18%"],
    "legend order always matches the re-ranked leaderboard order"
  );
  assert.equal(parseLegendPercents(afterReorder).reduce((sum, percent) => sum + percent, 0), 100);
  assertWidthsMatchPercents(afterReorder, parseLegendPercents(afterReorder), "after reorder");

  // A selection change re-renders the block identically and never writes.
  const storedBeforeSelection = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
  await selectPlayer(cdp, "active-game-player-1");
  const afterSelection = await readDistribution(cdp);
  assert.deepEqual(afterSelection.legendEntries.map((entry) => entry.text),
    afterReorder.legendEntries.map((entry) => entry.text));
  assert.equal(afterSelection.total, afterReorder.total);
  const storedAfterSelection = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
  assert.equal(storedAfterSelection, storedBeforeSelection, "selection changes must be a byte-identical no-write");
  assert.equal(afterSelection.focusableCount, 0);
  assert.deepEqual(consoleProblems, [], "the UI-scored session must not produce uncaught console errors");
  return { desktopScreenshot };
}

// Session 2 (Scenarios 3-6 + the derived-only rule): seeded rounding edges,
// mixed-sign positive-only shares, zero-player omission, degenerate captions,
// and byte-identical payloads across renders, selection, and home→resume.
async function runSeededMathAndDegenerates(cdp, { consoleProblems }) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  const now = new Date().toISOString();

  const seeds = [
    seededGame({ id: "seed-mockup", title: "Mockup night", createdAt: now, names: ["Alex", "Sam", "Jamie", "Taylor"], totals: [42, 35, 28, 19] }),
    seededGame({ id: "seed-halves", title: "Halves night", createdAt: now, names: ["One", "Two", "Three", "Four", "Five", "Six"], totals: [2, 2, 2, 1, 1, 1] }),
    seededGame({ id: "seed-thirds", title: "Thirds night", createdAt: now, names: ["Ada", "Ben", "Cal"], totals: [1, 1, 1] }),
    seededGame({ id: "seed-mixed-sign", title: "Mixed signs night", createdAt: now, names: ["Lead", "Penalized", "Third"], totals: [10, -5, 3] }),
    seededGame({ id: "seed-zero-player", title: "Bench night", createdAt: now, names: ["Scorer", "Bench", "Also"], totals: [10, 0, 5] }),
    seededGame({ id: "seed-all-zero", title: "Fresh night", createdAt: now, names: ["Ada", "Ben", "Cal"], totals: [0, 0, 0] }),
    seededGame({ id: "seed-net-zero", title: "Washed out night", createdAt: now, names: ["Ada", "Ben"], totals: [5, -5] }),
    seededGame({ id: "seed-negative", title: "Penalties night", createdAt: now, names: ["Ada", "Ben"], totals: [-5, -3] })
  ];

  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: seedSource(seeds) });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  const seededRaw = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
  assert.equal(JSON.parse(seededRaw).version, 1);

  // Mockup parity from a seeded resume.
  await click(cdp, "[data-action='resume-game'][data-game-id='seed-mockup']");
  await waitForSelector(cdp, "[data-score-distribution]");
  const mockup = await readDistribution(cdp);
  assert.equal(mockup.total, "124 total game points");
  assert.deepEqual(parseLegendPercents(mockup), [34, 28, 23, 15]);
  assertWidthsMatchPercents(mockup, [34, 28, 23, 15], "seeded mockup");
  assert.equal(mockup.focusableCount, 0);

  // The pinned naive-rounding counterexample: 2/2/2/1/1/1 of 9 -> 23/22/22/11/11/11.
  await goHome(cdp);
  await expandUnfinishedPreview(cdp);
  await click(cdp, "[data-action='resume-game'][data-game-id='seed-halves']");
  await waitForSelector(cdp, "[data-score-distribution]");
  const halves = await readDistribution(cdp);
  assert.equal(halves.total, "9 total game points");
  assert.deepEqual(parseLegendPercents(halves), [23, 22, 22, 11, 11, 11],
    "naive per-row rounding would sum to 99; the rendered block must sum to 100");
  assertWidthsMatchPercents(halves, parseLegendPercents(halves), "halves");

  // Full tie 1/1/1 of 3 tops up in display order: 34/33/33.
  await goHome(cdp);
  await expandUnfinishedPreview(cdp);
  await click(cdp, "[data-action='resume-game'][data-game-id='seed-thirds']");
  await waitForSelector(cdp, "[data-score-distribution]");
  const thirds = await readDistribution(cdp);
  assert.equal(thirds.total, "3 total game points");
  assert.deepEqual(parseLegendPercents(thirds), [34, 33, 33]);
  assertWidthsMatchPercents(thirds, parseLegendPercents(thirds), "thirds");

  // Mixed signs with a positive total: only positive players share the bar,
  // the negative player appears nowhere, and the caption stays signed.
  await goHome(cdp);
  await expandUnfinishedPreview(cdp);
  await click(cdp, "[data-action='resume-game'][data-game-id='seed-mixed-sign']");
  await waitForSelector(cdp, "[data-score-distribution]");
  const mixed = await readDistribution(cdp);
  assert.equal(mixed.total, "8 total game points");
  assert.deepEqual(mixed.leaderboardNames, ["Lead", "Third", "Penalized"],
    "the leaderboard still ranks every player including the negative total");
  assert.deepEqual(
    mixed.legendEntries.map((entry) => entry.text),
    ["Lead 77%", "Third 23%"],
    "the negative-total player must not imply a share"
  );
  assert.equal(mixed.segments.length, 2);
  assert.equal(parseLegendPercents(mixed).reduce((sum, percent) => sum + percent, 0), 100);
  assertWidthsMatchPercents(mixed, parseLegendPercents(mixed), "mixed signs");
  const mixedScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-mixed-sign.png"));

  // A zero-total player among scorers: exactly two entries, the bench omitted.
  await goHome(cdp);
  await expandUnfinishedPreview(cdp);
  await click(cdp, "[data-action='resume-game'][data-game-id='seed-zero-player']");
  await waitForSelector(cdp, "[data-score-distribution]");
  const zeroPlayer = await readDistribution(cdp);
  assert.equal(zeroPlayer.total, "15 total game points");
  assert.deepEqual(
    zeroPlayer.legendEntries.map((entry) => entry.text),
    ["Scorer 67%", "Also 33%"]
  );
  assert.equal(zeroPlayer.segments.length, 2);

  // Degenerate totals: caption always renders, bar + legend never do.
  const degenerateExpectations = [
    { id: "seed-all-zero", total: "0 total game points" },
    { id: "seed-net-zero", total: "0 total game points" },
    { id: "seed-negative", total: "-8 total game points" }
  ];
  for (const expectation of degenerateExpectations) {
    await goHome(cdp);
    await expandUnfinishedPreview(cdp);
    await click(cdp, `[data-action='resume-game'][data-game-id='${expectation.id}']`);
    await waitForSelector(cdp, "[data-score-distribution]");
    const degenerate = await readDistribution(cdp);
    assert.equal(degenerate.total, expectation.total, `${expectation.id}: signed caption`);
    assert.equal(degenerate.emptyText, "No shares to show while the game total is zero or negative.",
      `${expectation.id}: locked degenerate copy`);
    assert.equal(degenerate.barPresent, false, `${expectation.id}: no bar`);
    assert.equal(degenerate.legendPresent, false, `${expectation.id}: no legend`);
    assert.equal(degenerate.focusableCount, 0);
  }
  const degenerateScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-degenerate.png"));

  // Derived-only across renders: navigation home, re-resume, and a selection
  // change must leave the stored payload byte-identical.
  await goHome(cdp);
  await expandUnfinishedPreview(cdp);
  await click(cdp, "[data-action='resume-game'][data-game-id='seed-mockup']");
  await waitForSelector(cdp, "[data-score-distribution]");
  await selectPlayer(cdp, "seed-mockup-player-2");
  const rawAfterTour = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
  assert.equal(rawAfterTour, seededRaw, "renders, resumes, and selection must never rewrite the payload");

  // Reload: still byte-identical, and the block re-derives from storage.
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");
  const rawAfterReload = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
  assert.equal(rawAfterReload, seededRaw, "loading never rewrites the payload");
  await expandUnfinishedPreview(cdp);
  await click(cdp, "[data-action='resume-game'][data-game-id='seed-mockup']");
  await waitForSelector(cdp, "[data-score-distribution]");
  assert.deepEqual(parseLegendPercents(await readDistribution(cdp)), [34, 28, 23, 15],
    "the block re-derives identically after a reload");
  assert.deepEqual(consoleProblems, [], "the seeded session must not produce uncaught console errors");
  return { mixedScreenshot, degenerateScreenshot };
}

// Session 3 (Scenario 7): home, setup, active-empty, the podium dialog, and
// the finished view render no distribution block.
async function runSurfaceExclusion(cdp, { consoleProblems }) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  // Home and the Active Game empty state (no games in this tab yet).
  assert.equal(await readDistribution(cdp), null, "home renders no distribution block");
  await click(cdp, "[data-action='nav-active-game']");
  await waitForSelector(cdp, "[data-active-empty-heading]");
  assert.equal(await readDistribution(cdp), null, "the active-empty view renders no distribution block");

  // Setup view.
  await click(cdp, "[data-action='new-game']");
  await waitForSelector(cdp, "#game-title");
  assert.equal(await readDistribution(cdp), null, "the setup view renders no distribution block");

  // Score an active game, finish it, and check the podium + finished views.
  await fill(cdp, "#player-name-1", "Ada");
  await fill(cdp, "#player-name-2", "Ben");
  await click(cdp, "[data-roster-form] button[type='submit']");
  await waitForSelector(cdp, "#score-amount");
  assert.ok(await readDistribution(cdp), "the active view renders the block before finishing");
  await savePoints(cdp, "7");
  await waitForSelector(cdp, ".score-distribution-segment");

  await click(cdp, "[data-action='open-finish']");
  await waitForSelector(cdp, "[data-action='confirm-finish']");
  await click(cdp, "[data-action='confirm-finish']");
  await waitForSelector(cdp, "[data-podium-dialog]");
  assert.equal(await readDistribution(cdp), null, "the podium dialog renders no distribution block");
  await click(cdp, "[data-action='close-podium']");
  await waitForSelector(cdp, "[data-action='play-again']");
  assert.equal(await readDistribution(cdp), null, "the finished view renders no distribution block");

  await goHome(cdp);
  assert.equal(await readDistribution(cdp), null, "home with a finished game renders no distribution block");
  await click(cdp, "[data-action='view-results']");
  await waitForSelector(cdp, "[data-action='play-again']");
  assert.equal(await readDistribution(cdp), null, "a resumed finished view renders no distribution block");
  assert.deepEqual(consoleProblems, [], "the exclusion session must not produce uncaught console errors");
}

// Session 4 (Scenario 8): 20-player mixed-sign game at 320×720 and 1280×800 —
// no overflow, wrapping legend, width↔percent correspondence, AA contrast,
// zero focusables, zero console errors.
async function runResponsiveAndA11y(cdp, { consoleProblems }) {
  const now = new Date().toISOString();
  const names = Array.from({ length: 20 }, (_, index) =>
    index % 2 === 0 ? `Player ${index + 1}` : `Maximilian Vanderbilt the ${index + 1}th`);
  // Even rows positive (30..48), odd rows negative (-1..-19): game total 290,
  // ten eligible players, long names on every negative row.
  const totals = Array.from({ length: 20 }, (_, index) => (index % 2 === 0 ? 30 + index : -index));
  const seed = seededGame({
    id: "seed-twenty",
    title: "Crowded table night",
    createdAt: now,
    names,
    totals,
    colors: ["blue", "red", "yellow", "green", "orange", "white", "black"]
  });
  const degenerateSeed = seededGame({ id: "seed-empty", title: "Empty night", createdAt: now, names: ["Ada", "Ben"], totals: [0, 0] });

  // Both seeds go in before the first navigation: the seed guard runs once per
  // tab, so later addScriptToEvaluateOnNewDocument calls would never apply.
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: seedSource([seed, degenerateSeed]) });

  // Shares over the eligible totals in leaderboard display order (descending,
  // rankPlayers order) with the same largest-remainder top-up.
  const expectedPositiveTotals = totals.filter((total) => total > 0).sort((a, b) => b - a);
  const expectedShares = (() => {
    const sum = expectedPositiveTotals.reduce((a, b) => a + b, 0);
    const shares = expectedPositiveTotals.map((total) => {
      const raw = (total / sum) * 100;
      return { percent: Math.floor(raw), remainder: raw - Math.floor(raw) };
    });
    const leftover = 100 - shares.reduce((a, share) => a + share.percent, 0);
    const order = shares.map((share, index) => ({ index, remainder: share.remainder }))
      .sort((a, b) => (b.remainder - a.remainder) || (a.index - b.index));
    for (let unit = 0; unit < leftover; unit += 1) {
      shares[order[unit].index].percent += 1;
    }
    return shares.map((share) => share.percent);
  })();
  assert.equal(expectedShares.length, 10);
  assert.equal(expectedShares.reduce((a, b) => a + b, 0), 100);

  await setViewport(cdp, { width: 320, height: 720, mobile: true });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");
  await click(cdp, "[data-action='resume-game'][data-game-id='seed-twenty']");
  await waitForSelector(cdp, "[data-score-distribution]");

  const mobile = await readDistribution(cdp);
  assert.equal(mobile.total, "290 total game points");
  assert.equal(mobile.horizontalOverflow, false, "the 20-player block must not overflow at 320px");
  assert.deepEqual(parseLegendPercents(mobile), expectedShares);
  assertWidthsMatchPercents(mobile, expectedShares, "320px 20-player");
  assert.equal(mobile.focusableCount, 0);
  assert.equal(mobile.barAriaHidden, "true");
  const mobileLegendRows = await evaluate(cdp, () => {
    const items = [...document.querySelectorAll(".score-distribution-legend-item")];
    return new Set(items.map((item) => Math.round(item.getBoundingClientRect().top))).size;
  });
  assert.ok(mobileLegendRows >= 2, `the legend must wrap at 320px (got ${mobileLegendRows} rows)`);
  const mobileScreenshot = await screenshot(cdp, path.join(evidenceDir, "mobile-20-players-320px.png"));

  // Contrast: legend text is --text on the inset surface; the count line is
  // the suite-frozen --muted. Both must meet AA.
  const contrast = await evaluate(cdp, () => {
    const parseRgb = (value) => {
      const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
    };
    const block = document.querySelector("[data-score-distribution]");
    return {
      background: parseRgb(getComputedStyle(block).backgroundColor),
      legendText: parseRgb(getComputedStyle(document.querySelector(".score-distribution-legend-text")).color),
      totalText: parseRgb(getComputedStyle(document.querySelector(".score-distribution-total")).color),
      totalRawColor: getComputedStyle(document.querySelector(".score-distribution-total")).color
    };
  });
  const legendContrast = contrastRatio(contrast.legendText, contrast.background);
  assert.ok(legendContrast >= 4.5, `legend text must meet AA contrast (got ${legendContrast.toFixed(2)})`);
  assert.equal(contrast.totalRawColor, "rgb(109, 101, 92)", "the count line uses the suite-frozen --muted token");
  const totalContrast = contrastRatio(contrast.totalText, contrast.background);
  assert.ok(totalContrast >= 4.5, `count line must meet AA contrast (got ${totalContrast.toFixed(2)})`);

  // The degenerate line's contrast, read from a zero-total game at 320px.
  await goHome(cdp);
  await click(cdp, "[data-action='resume-game'][data-game-id='seed-empty']");
  await waitForSelector(cdp, "[data-score-distribution]");
  const emptyContrast = await evaluate(cdp, () => {
    const parseRgb = (value) => {
      const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
    };
    const block = document.querySelector("[data-score-distribution]");
    return {
      background: parseRgb(getComputedStyle(block).backgroundColor),
      emptyText: parseRgb(getComputedStyle(document.querySelector(".score-distribution-empty")).color),
      emptyRawColor: getComputedStyle(document.querySelector(".score-distribution-empty")).color,
      focusableCount: block.querySelectorAll("button, input, select, textarea, a[href], [tabindex]").length
    };
  });
  assert.equal(emptyContrast.emptyRawColor, "rgb(109, 101, 92)", "the degenerate line uses the suite-frozen --muted token");
  const emptyRatio = contrastRatio(emptyContrast.emptyText, emptyContrast.background);
  assert.ok(emptyRatio >= 4.5, `degenerate line must meet AA contrast (got ${emptyRatio.toFixed(2)})`);
  assert.equal(emptyContrast.focusableCount, 0);

  // Desktop width: the same seeded game stays overflow-free and truthful.
  await goHome(cdp);
  await click(cdp, "[data-action='resume-game'][data-game-id='seed-twenty']");
  await waitForSelector(cdp, "[data-score-distribution]");
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  const desktop = await readDistribution(cdp);
  assert.equal(desktop.horizontalOverflow, false, "the 20-player block must not overflow at 1280px");
  assert.deepEqual(parseLegendPercents(desktop), expectedShares);
  assertWidthsMatchPercents(desktop, expectedShares, "1280px 20-player");
  assert.equal(desktop.focusableCount, 0);
  const desktopScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-20-players.png"));

  assert.deepEqual(consoleProblems, [], "the responsive session must not produce uncaught console errors");
  return { mobileScreenshot, desktopScreenshot };
}

function luminanceOf(rgb) {
  const channel = (raw) => {
    const value = raw / 255;
    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

function contrastRatio(foreground, background) {
  const l1 = luminanceOf(foreground);
  const l2 = luminanceOf(background);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

async function main() {
  try {
    const ui = await runSession("ui-scored-derivation", runUiScoredDerivation);
    assert.equal(typeof ui.desktopScreenshot, "string");

    const seeded = await runSession("seeded-math-and-degenerates", runSeededMathAndDegenerates);
    assert.equal(typeof seeded.mixedScreenshot, "string");

    await runSession("surface-exclusion", runSurfaceExclusion);

    const responsive = await runSession("responsive-a11y", runResponsiveAndA11y);
    assert.equal(typeof responsive.mobileScreenshot, "string");

    console.log("Browser score-distribution test passed: the active leaderboard panel renders a Score distribution block after the standings rows (header 'Score distribution' + signed '{N} total game points' always; bar + legend only at a positive game total with the locked degenerate line otherwise); shares are largest-remainder integers over the positive-total sum (mockup 42/35/28/19 -> 34/28/23/15, 2/2/2/1/1/1 -> 23/22/22/11/11/11, 1/1/1 -> 34/33/33) summing to exactly 100 with segment widths equal to the legend percents (±1px) in the exact token colors; zero-total players are omitted, mixed-sign games share only positive totals (10/-5/3 -> 77/23 of the signed 8 caption), saves/undoes/reorders/selection/resume/reload re-derive the block with byte-identical payloads and no persisted fields (envelope version 1, unchanged player keys); finished, podium, home, setup, and active-empty surfaces render nothing; and 320x720/1280x800 stay overflow-free with a wrapping legend, aria-hidden bar, aria-labelled real-text legend, zero focusable elements, the frozen --muted token at AA contrast, and zero uncaught console errors.");
    console.log(`Browser evidence screenshots: ${[
      ui.desktopScreenshot,
      seeded.mixedScreenshot,
      seeded.degenerateScreenshot,
      responsive.mobileScreenshot,
      responsive.desktopScreenshot
    ].join(", ")}`);
  } finally {
    await closeServer(server);
  }
}

await main();
