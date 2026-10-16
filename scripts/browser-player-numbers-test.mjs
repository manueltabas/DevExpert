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
const evidenceDir = await createEvidenceDir("devexpert-show-player-numbers");
const server = createStaticServer();
const baseUrl = await listen(server);

// Corrupt-marker seed (Scenario 5): a usable stored game whose first player
// carries `marker: "7"` and whose second player has no marker at all. Badges
// must derive positionally and never surface the stored marker (the previous
// renderer would have printed "7" and the literal text "undefined").
const CORRUPT_MARKER_SEED = `
  (() => {
    const game = {
      id: "seeded-marker-game",
      title: "Marker night",
      status: "active",
      createdAt: "2026-10-10T10:00:00.000Z",
      players: [
        { id: "seeded-player-1", name: "Corrupt One", color: "blue", marker: "7", order: 0, total: 3 },
        { id: "seeded-player-2", name: "No Marker", color: "red", order: 1, total: 0 },
        { id: "seeded-player-3", name: "Third Seat", color: "yellow", marker: "3", order: 2, total: 0 }
      ]
    };
    localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, JSON.stringify({ version: 1, games: [game] }));
  })();
`;

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

// `colors` overrides the draft defaults positionally (null keeps the default)
// so a session can stage duplicate names AND duplicate colors.
async function createGame(cdp, title, names, colors = []) {
  await click(cdp, "[data-action='nav-new-game']");
  await waitForSelector(cdp, "#game-title");
  if (title !== null) {
    await fill(cdp, "#game-title", title);
  }
  for (let index = 2; index < names.length; index += 1) {
    await click(cdp, "[data-action='add-player']");
    await waitForSelector(cdp, `#player-name-${index + 1}`);
  }
  for (let index = 0; index < names.length; index += 1) {
    await fill(cdp, `#player-name-${index + 1}`, names[index]);
  }
  for (let index = 0; index < colors.length; index += 1) {
    if (colors[index]) {
      await click(cdp, `input[name='color-${index + 1}'][value='${colors[index]}']`);
      await waitForSelector(cdp, `#player-name-${index + 1}`);
    }
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

async function finishGame(cdp) {
  await click(cdp, "[data-action='open-finish']");
  await waitForSelector(cdp, "[data-action='confirm-finish']");
  await click(cdp, "[data-action='confirm-finish']");
  await waitForSelector(cdp, "[data-podium-dialog]");
}

async function dismissPodium(cdp) {
  await click(cdp, "[data-action='close-podium']");
  await waitForSelector(cdp, "[data-action='play-again']");
}

async function readSetupRows(cdp) {
  return evaluate(cdp, () => ({
    legends: [...document.querySelectorAll(".player-row legend")].map((node) => node.textContent.trim()),
    tokens: [...document.querySelectorAll(".player-row .player-token")].map((node) => ({
      text: node.textContent.trim(),
      className: node.className
    })),
    nameValues: [...document.querySelectorAll(".player-row input[data-field='name']")].map((node) => node.value),
    removeLabels: [...document.querySelectorAll("[data-action='remove-player']")].map((node) => node.getAttribute("aria-label")),
    colorGroupLabels: [...document.querySelectorAll(".color-options")].map((node) => node.getAttribute("aria-label"))
  }));
}

async function readActiveRows(cdp) {
  return evaluate(cdp, () => [...document.querySelectorAll(".active-player")].map((row) => ({
    rank: row.querySelector(".active-player-rank")?.textContent.trim() ?? "",
    tokenText: row.querySelector(".player-token")?.textContent.trim() ?? "",
    tokenLabel: row.querySelector(".player-token")?.getAttribute("aria-label") ?? "",
    tokenClass: row.querySelector(".player-token")?.className ?? "",
    name: row.querySelector(".active-player-name")?.textContent.trim() ?? "",
    total: row.querySelector(".active-player-total")?.textContent.trim() ?? "",
    totalLabel: row.querySelector(".active-player-total")?.getAttribute("aria-label") ?? ""
  })));
}

async function readScoreCard(cdp) {
  return evaluate(cdp, () => {
    const card = document.querySelector(".score-selected");
    const token = card?.querySelector(".player-token");
    const name = card?.querySelector(".score-selected-name");
    const number = card?.querySelector(".score-selected-number");
    return {
      present: Boolean(card),
      tokenText: token?.textContent.trim() ?? null,
      tokenAriaHidden: token?.getAttribute("aria-hidden") ?? null,
      name: name?.textContent.trim() ?? null,
      numberText: number?.textContent.trim() ?? null,
      numberVisible: number ? Boolean(number.getClientRects().length) : false,
      numberColor: number ? getComputedStyle(number).color : null,
      numberFontSize: number ? getComputedStyle(number).fontSize : null,
      nameFontSize: name ? getComputedStyle(name).fontSize : null
    };
  });
}

async function readRecentRows(cdp) {
  return evaluate(cdp, () => [...document.querySelectorAll(".recent-entry")].map((row) => ({
    name: row.querySelector(".recent-entry-name")?.textContent.trim() ?? "",
    tokenText: row.querySelector(".player-token")?.textContent.trim() ?? "",
    tokenLabel: row.querySelector(".player-token")?.getAttribute("aria-label") ?? ""
  })));
}

async function readPodiumState(cdp) {
  return evaluate(cdp, () => {
    const dialog = document.querySelector("[data-podium-dialog]");
    const groups = [...(dialog?.querySelectorAll(".podium-group") ?? [])].map((group) => ({
      heading: group.querySelector(".podium-rank-heading")?.textContent.trim() ?? "",
      rows: [...group.querySelectorAll(".podium-player")].map((row) => ({
        rank: row.querySelector(".podium-player-rank")?.textContent.trim() ?? "",
        tokenText: row.querySelector(".player-token")?.textContent.trim() ?? "",
        tokenLabel: row.querySelector(".player-token")?.getAttribute("aria-label") ?? "",
        name: row.querySelector(".podium-player-name")?.textContent.trim() ?? "",
        totalLabel: row.querySelector(".podium-player-total")?.getAttribute("aria-label") ?? ""
      }))
    }));
    return {
      present: Boolean(dialog),
      open: Boolean(dialog?.open),
      groups
    };
  });
}

// Session A (Scenario 1): setup rows are positional — duplicate names and
// colors get distinct badges, removing a row renumbers the remaining draft
// immediately (tokens, legends, remove labels, radiogroup labels), and the
// started game renders badges 1..3 in setup order with the stored shape
// unchanged (markers still written exactly as accepted, no new fields).
async function runSetupSession(cdp, { consoleProblems }) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='nav-new-game']");

  await click(cdp, "[data-action='nav-new-game']");
  await waitForSelector(cdp, "#game-title");
  await fill(cdp, "#game-title", "Badge night");
  for (let index = 2; index < 4; index += 1) {
    await click(cdp, "[data-action='add-player']");
    await waitForSelector(cdp, `#player-name-${index + 1}`);
  }
  const names = ["Alex", "Alex", "Sam", "Sam"];
  for (let index = 0; index < names.length; index += 1) {
    await fill(cdp, `#player-name-${index + 1}`, names[index]);
  }
  await click(cdp, "input[name='color-2'][value='blue']");
  await waitForSelector(cdp, "#player-name-2");
  await click(cdp, "input[name='color-4'][value='yellow']");
  await waitForSelector(cdp, "#player-name-4");

  const fourRows = await readSetupRows(cdp);
  assert.deepEqual(fourRows.legends, ["Player 1", "Player 2", "Player 3", "Player 4"],
    "setup legends are positional");
  assert.deepEqual(fourRows.tokens.map((token) => token.text), ["1", "2", "3", "4"],
    "setup tokens show the row position");
  assert.deepEqual(fourRows.tokens.map((token) => token.className),
    ["player-token marker-blue", "player-token marker-blue", "player-token marker-yellow", "player-token marker-yellow"],
    "duplicate colors render identical token classes — the badge number disambiguates");
  assert.deepEqual(fourRows.nameValues, ["Alex", "Alex", "Sam", "Sam"],
    "duplicate names survive the color re-renders");
  assert.deepEqual(fourRows.removeLabels,
    ["Remove player 1", "Remove player 2", "Remove player 3", "Remove player 4"],
    "remove controls carry the accepted positional labels");
  assert.deepEqual(fourRows.colorGroupLabels,
    ["Color for player 1", "Color for player 2", "Color for player 3", "Color for player 4"],
    "color radiogroups carry the accepted positional labels");

  // Remove row 2: the remaining draft renumbers 1..3 immediately.
  await click(cdp, "[data-player-index='1'] [data-action='remove-player']");
  await waitForSelector(cdp, "#player-name-3");
  const threeRows = await readSetupRows(cdp);
  assert.deepEqual(threeRows.legends, ["Player 1", "Player 2", "Player 3"],
    "removing a row renumbers the legends immediately");
  assert.deepEqual(threeRows.tokens.map((token) => token.text), ["1", "2", "3"],
    "removing a row renumbers the setup tokens with no gaps");
  assert.deepEqual(threeRows.nameValues, ["Alex", "Sam", "Sam"]);
  assert.deepEqual(threeRows.removeLabels,
    ["Remove player 1", "Remove player 2", "Remove player 3"],
    "remove labels renumber with the draft");
  assert.deepEqual(threeRows.colorGroupLabels,
    ["Color for player 1", "Color for player 2", "Color for player 3"],
    "radiogroup labels renumber with the draft");

  // Start the game: badges 1..3 in setup order, duplicates distinguishable.
  await click(cdp, "[data-roster-form] button[type='submit']");
  await waitForSelector(cdp, "#score-amount");
  const active = await readActiveRows(cdp);
  assert.deepEqual(active.map((row) => [row.rank, row.tokenText, row.name]), [
    ["1", "1", "Alex"],
    ["1", "2", "Sam"],
    ["1", "3", "Sam"]
  ], "all-zero totals share rank 1 in creation order while badges follow setup order");
  assert.deepEqual(active.map((row) => row.tokenLabel),
    ["Player 1, Blue", "Player 2, Yellow", "Player 3, Yellow"],
    "token labels speak the setup-order number");
  assert.deepEqual(active.map((row) => row.totalLabel),
    ["Alex: rank 1, total 0", "Sam: rank 1, total 0", "Sam: rank 1, total 0"],
    "the frozen total aria-label format is untouched");

  // Storage shape: zero new persisted fields, markers still written as accepted.
  const stored = await readSavedGamesState(cdp, STORAGE_KEY);
  assert.equal(stored.payloadVersion, 1, "the envelope stays version 1");
  assert.equal(stored.gameCount, 1);
  const parsed = JSON.parse(stored.raw);
  assert.deepEqual(Object.keys(parsed.games[0]).sort(),
    ["createdAt", "id", "players", "status", "title", "updatedAt"],
    "the stored game gains no new fields");
  assert.deepEqual(parsed.games[0].players.map((player) => Object.keys(player).sort()),
    [
      ["color", "id", "marker", "name", "order", "total"],
      ["color", "id", "marker", "name", "order", "total"],
      ["color", "id", "marker", "name", "order", "total"]
    ],
    "the stored players gain no new fields");
  assert.deepEqual(parsed.games[0].players.map((player) => player.marker), ["1", "2", "3"],
    "createGame still writes the accepted marker field");

  const desktopScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-setup-badges.png"));
  assert.deepEqual(consoleProblems, [], "the setup session must not produce uncaught console errors");
  return { desktopScreenshot };
}

// Session B (Scenarios 2 + 3): badges disambiguate across every roster
// surface, the score card shows the badge with its visible "Player {n}"
// subtitle, and rank stays independent of badge — 12/12/8 renders ranks
// 1,1,3 with badges 1,2,3, and a reordering save moves rows while badges
// follow players.
async function runActiveAndFinishSession(cdp, { consoleProblems }) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='nav-new-game']");

  await createGame(cdp, "Badge night", ["Alex", "Alex", "Sam"], [null, "blue", null]);
  await savePoints(cdp, "12");
  await selectPlayer(cdp, "active-game-player-2");
  await savePoints(cdp, "12");
  await selectPlayer(cdp, "active-game-player-3");
  await savePoints(cdp, "8");

  // 12/12/8: ranks 1,1,3 while badges read 1,2,3 in setup order.
  const ranked = await readActiveRows(cdp);
  assert.deepEqual(ranked.map((row) => [row.rank, row.tokenText, row.name, row.total]), [
    ["1", "1", "Alex", "12"],
    ["1", "2", "Alex", "12"],
    ["3", "3", "Sam", "8"]
  ], "ranks stay competition ranks while badges stay positional");
  assert.deepEqual(ranked.map((row) => row.tokenLabel),
    ["Player 1, Blue", "Player 2, Blue", "Player 3, Yellow"],
    "duplicate names and colors stay distinguishable by badge");
  assert.deepEqual(ranked.map((row) => row.totalLabel),
    ["Alex: rank 1, total 12", "Alex: rank 1, total 12", "Sam: rank 3, total 8"],
    "the frozen total label format carries rank, never the badge");

  // Score card: badge token, name, and the new visible "Player {n}" subtitle.
  const card = await readScoreCard(cdp);
  assert.equal(card.present, true);
  assert.equal(card.tokenText, "3", "the selected player's badge renders on the card");
  assert.equal(card.tokenAriaHidden, "true", "the card token stays aria-hidden");
  assert.equal(card.name, "Sam");
  assert.equal(card.numberText, "Player 3", "the mockup's Player {n} subtitle renders");
  assert.equal(card.numberVisible, true, "the subtitle is visible");
  await selectPlayer(cdp, "active-game-player-2");
  const switchedCard = await readScoreCard(cdp);
  assert.equal(switchedCard.tokenText, "2");
  assert.equal(switchedCard.numberText, "Player 2", "the subtitle follows the selection");

  // Recent entries keep the numbered token with the renamed label.
  const recent = await readRecentRows(cdp);
  assert.deepEqual(recent.map((row) => [row.name, row.tokenText, row.tokenLabel]), [
    ["Sam", "3", "Player 3, Yellow"],
    ["Alex", "2", "Player 2, Blue"],
    ["Alex", "1", "Player 1, Blue"]
  ], "recent entries render newest first with each player's setup badge");

  // A reordering save: badges follow players, ranks follow totals. The card
  // check above left player 2 selected, so reselect Sam (+20 -> 28, rank 1);
  // the tied 12s share competition rank 2 while their badges stay 1 and 2.
  await selectPlayer(cdp, "active-game-player-3");
  await savePoints(cdp, "20");
  const reordered = await readActiveRows(cdp);
  assert.deepEqual(reordered.map((row) => [row.rank, row.tokenText, row.name, row.total]), [
    ["1", "3", "Sam", "28"],
    ["2", "1", "Alex", "12"],
    ["2", "2", "Alex", "12"]
  ], "the leaderboard re-sorted while every badge stayed with its player");
  const recentAfterReorder = await readRecentRows(cdp);
  assert.equal(recentAfterReorder[0].tokenLabel, "Player 3, Yellow",
    "the newest entry still carries Sam's setup badge");

  // Finish: podium and finished standings keep rank + badge side by side
  // (the tied Alexes share rank 2 with badges 1 and 2 — ties never collapsed).
  await finishGame(cdp);
  const podium = await readPodiumState(cdp);
  assert.equal(podium.present, true);
  assert.equal(podium.open, true);
  assert.deepEqual(podium.groups.map((group) => group.heading), ["Rank 1", "Rank 2"]);
  assert.deepEqual(podium.groups.map((group) => group.rows.map((row) => [row.rank, row.tokenText, row.name])), [
    [["1", "3", "Sam"]],
    [["2", "1", "Alex"], ["2", "2", "Alex"]]
  ], "podium rows show rank and setup badge side by side");
  assert.deepEqual(podium.groups.flatMap((group) => group.rows.map((row) => row.tokenLabel)),
    ["Player 3, Yellow", "Player 1, Blue", "Player 2, Blue"]);
  assert.deepEqual(podium.groups.flatMap((group) => group.rows.map((row) => row.totalLabel)),
    ["Sam: rank 1, total 28", "Alex: rank 2, total 12", "Alex: rank 2, total 12"],
    "podium totals keep the frozen label convention");
  await dismissPodium(cdp);

  const finished = await readActiveRows(cdp);
  assert.deepEqual(finished.map((row) => [row.rank, row.tokenText, row.name, row.total]), [
    ["1", "3", "Sam", "28"],
    ["2", "1", "Alex", "12"],
    ["2", "2", "Alex", "12"]
  ], "finished standings render the same rank + badge treatment");
  assert.deepEqual(finished.map((row) => row.tokenLabel),
    ["Player 3, Yellow", "Player 1, Blue", "Player 2, Blue"]);

  const desktopScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-active-badges.png"));
  assert.deepEqual(consoleProblems, [], "the active/finish session must not produce uncaught console errors");
  return { desktopScreenshot };
}

// Session C (Scenario 4): badges survive reload/resume, and replay renumbers
// 1..N from the replay's setup order while the stored marker field stays
// written exactly as accepted.
async function runPersistenceSession(cdp, { consoleProblems }) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='nav-new-game']");

  // Resume stability: score, reload, resume — every badge matches the stored
  // roster order.
  await createGame(cdp, "Persist night", ["Alex", "Sam", "Jamie"]);
  await savePoints(cdp, "5");
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='resume-game']");
  await click(cdp, "[data-action='resume-game']");
  await waitForSelector(cdp, "#score-amount");
  const resumed = await readActiveRows(cdp);
  assert.deepEqual(resumed.map((row) => [row.rank, row.tokenText, row.name, row.total]), [
    ["1", "1", "Alex", "5"],
    ["2", "2", "Sam", "0"],
    ["2", "3", "Jamie", "0"]
  ], "resumed badges match the stored roster order (the zero pair shares rank 2)");

  // Replay renumbers 1..N from the replay's setup order with zero totals.
  await finishGame(cdp);
  await dismissPodium(cdp);
  await click(cdp, "[data-action='play-again']");
  await waitForSelector(cdp, "#score-amount");
  const replay = await readActiveRows(cdp);
  assert.deepEqual(replay.map((row) => [row.rank, row.tokenText, row.name, row.total]), [
    ["1", "1", "Alex", "0"],
    ["1", "2", "Sam", "0"],
    ["1", "3", "Jamie", "0"]
  ], "the replay renders badges 1..N in its setup order at zero totals");
  assert.deepEqual(replay.map((row) => row.tokenLabel),
    ["Player 1, Blue", "Player 2, Red", "Player 3, Yellow"]);
  const storedAfterReplay = JSON.parse((await readSavedGamesState(cdp, STORAGE_KEY)).raw);
  const replayEntry = storedAfterReplay.games.find((game) => game.id.startsWith("replay-game-"));
  assert.deepEqual(replayEntry.players.map((player) => player.marker), ["1", "2", "3"],
    "the stored marker field stays written exactly as accepted on replay");
  const originalEntry = storedAfterReplay.games.find((game) => game.title === "Persist night");
  assert.equal(originalEntry.status, "finished", "the finished original stays stored");
  assert.deepEqual(consoleProblems, [], "the persistence session must not produce uncaught console errors");
}

// Session C part 2 (Scenario 5): a seeded corrupt marker ("7") and a missing
// marker degrade to truthful positional numbers, and the stored payload stays
// byte-identical across renders (badges are render-only and never save).
async function runCorruptMarkerSession(cdp, { consoleProblems }) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='resume-game']");

  const rawBefore = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
  assert.equal(JSON.parse(rawBefore).games[0].players[0].marker, "7",
    "the seeded record really carries the corrupt marker");

  await click(cdp, "[data-action='resume-game']");
  await waitForSelector(cdp, "#score-amount");
  const rows = await readActiveRows(cdp);
  assert.deepEqual(rows.map((row) => [row.rank, row.tokenText, row.name, row.total]), [
    ["1", "1", "Corrupt One", "3"],
    ["2", "2", "No Marker", "0"],
    ["2", "3", "Third Seat", "0"]
  ], "badges render the truthful positional numbers, never the stored marker");
  assert.deepEqual(rows.map((row) => row.tokenLabel),
    ["Player 1, Blue", "Player 2, Red", "Player 3, Yellow"],
    "the corrupt marker never surfaces in the accessible name either");
  assert.equal(
    rows.every((row) => !row.tokenText.includes("undefined") && !row.tokenLabel.includes("undefined")),
    true,
    "a missing marker never renders the text 'undefined'"
  );

  // Render-only proof: selection re-renders and still writes nothing.
  await selectPlayer(cdp, "seeded-player-3");
  const rawAfterSelection = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
  assert.equal(rawAfterSelection, rawBefore,
    "resuming, rendering badges, and changing selection never write storage");

  const desktopScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-corrupt-marker-badges.png"));
  assert.deepEqual(consoleProblems, [], "the corrupt-marker session must not produce uncaught console errors");
  return { desktopScreenshot };
}

// Session D (Scenario 6): the a11y + responsive baseline at 320x720 and
// 1280x800 — token labels "Player {n}, {color}", visible names beside every
// badge, the visible muted subtitle, no overflow, held targets and focus
// contracts, and zero console errors.
async function runResponsiveA11ySession(cdp, { consoleProblems }) {
  const assertBaseline = async (label, expectedTokenLabels) => {
    const rows = await readActiveRows(cdp);
    assert.equal(rows.length, 3, `${label}: three roster rows render`);
    assert.deepEqual(rows.map((row) => row.tokenLabel), expectedTokenLabels,
      `${label}: token labels speak the setup-order number`);
    const visibility = await evaluate(cdp, () => ({
      names: [...document.querySelectorAll(".active-player-name")].map((node) => ({
        text: node.textContent.trim(),
        visible: Boolean(node.getClientRects().length)
      })),
      subtitle: (() => {
        const node = document.querySelector(".score-selected-number");
        return node ? {
          text: node.textContent.trim(),
          visible: Boolean(node.getClientRects().length),
          color: getComputedStyle(node).color,
          fontSize: getComputedStyle(node).fontSize
        } : null;
      })(),
      nameFontSize: document.querySelector(".score-selected-name")
        ? getComputedStyle(document.querySelector(".score-selected-name")).fontSize
        : null,
      focusableBadges: [...document.querySelectorAll(".player-token, .score-selected-number")]
        .filter((node) => node.tabIndex >= 0).length,
      overflowDocument: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      overflowBody: document.body.scrollWidth > document.body.clientWidth
    }));
    assert.equal(visibility.names.every((name) => name.text && name.visible), true,
      `${label}: names stay visible beside every badge`);
    assert.equal(visibility.subtitle?.text, "Player 1", `${label}: the subtitle renders`);
    assert.equal(visibility.subtitle?.visible, true, `${label}: the subtitle is visible`);
    assert.equal(visibility.subtitle?.color, "rgb(109, 101, 92)",
      `${label}: the subtitle uses the suite-frozen --muted token`);
    assert.ok(
      parseFloat(visibility.subtitle?.fontSize ?? "0") < parseFloat(visibility.nameFontSize ?? "999"),
      `${label}: the subtitle is smaller than the name`
    );
    assert.equal(visibility.focusableBadges, 0,
      `${label}: badges and the subtitle add no focusable elements`);
    assert.equal(visibility.overflowDocument, false, `${label}: no horizontal overflow (documentElement)`);
    assert.equal(visibility.overflowBody, false, `${label}: no horizontal overflow (body)`);
    const targets = await evaluate(cdp, () => {
      const nodes = [...document.querySelectorAll(".add-points-action, [data-score-form] button[type='submit']")];
      return {
        count: nodes.length,
        minHeight: Math.min(...nodes.map((node) => node.getBoundingClientRect().height))
      };
    });
    assert.equal(targets.count, 4, `${label}: three row buttons plus Save points`);
    assert.ok(targets.minHeight >= 44, `${label}: targets stay >=44px tall (got ${targets.minHeight})`);
  };

  await setViewport(cdp, { width: 320, height: 720, mobile: true });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='nav-new-game']");
  await createGame(cdp, "Mobile badges", ["Alex", "Alex", "Sam"], [null, "blue", null]);
  await savePoints(cdp, "7");

  // After the +7 save the DOM order is Alex(7) rank 1, then the tied zeros in
  // creation order — Alex2 rank 2 badge 2 before Sam rank 2 badge 3.
  await assertBaseline("320px", ["Player 1, Blue", "Player 2, Blue", "Player 3, Yellow"]);
  const mobileScreenshot = await screenshot(cdp, path.join(evidenceDir, "mobile-badges-320px.png"));

  // Focus contract: a real Tab from the focused heading reaches a real control
  // with a visible outline (the feature adds no interactive controls).
  const focus = await evaluate(cdp, () => {
    document.querySelector("[data-active-heading]")?.focus();
    return document.activeElement?.id ?? null;
  });
  assert.equal(focus, "active-title", "the walk starts from the focused heading");
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9
  });
  const stop = await evaluate(cdp, () => ({
    action: document.activeElement?.dataset?.action ?? null,
    outline: getComputedStyle(document.activeElement).outlineStyle
  }));
  assert.equal(stop.action, "open-title-edit", "tab order is unchanged by the feature");
  assert.notEqual(stop.outline, "none", "keyboard focus shows a visible outline");

  // Desktop width: the same guarantees hold.
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await assertBaseline("1280px", ["Player 1, Blue", "Player 2, Blue", "Player 3, Yellow"]);
  const desktopScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-badges-1280px.png"));
  assert.deepEqual(consoleProblems, [], "the responsive session must not produce uncaught console errors");
  return { mobileScreenshot, desktopScreenshot };
}

async function main() {
  try {
    const setup = await runSession("setup-badges", runSetupSession);
    assert.equal(typeof setup.desktopScreenshot, "string");

    await runSession("active-finish-badges", runActiveAndFinishSession);
    await runSession("persistence-badges", runPersistenceSession);

    const corrupt = await runSession("corrupt-marker-badges", runCorruptMarkerSession, {
      setupSource: CORRUPT_MARKER_SEED
    });
    assert.equal(typeof corrupt.desktopScreenshot, "string");

    const responsive = await runSession("responsive-a11y-badges", runResponsiveA11ySession);
    assert.equal(typeof responsive.mobileScreenshot, "string");

    console.log("Browser player-numbers test passed: setup rows renumber positionally on removal and duplicate names/colors stay distinguishable; started games render badges 1..N in setup order on the leaderboard, score card (with the visible 'Player {n}' subtitle), recent entries, podium, and finished standings; rank digits and the frozen '{name}: rank {rank}, total {total}' labels stay independent of badges (12/12/8 -> ranks 1,1,3 with badges 1,2,3, and a reordering save moves rows while badges follow players); badges survive reload/resume, replays renumber 1..N with the stored marker field still written exactly as accepted, and a seeded marker:'7' plus a missing marker degrade to truthful positional numbers with a byte-identical payload; token aria-labels read 'Player {n}, {color}' at all four numbered sites with names visible beside every badge, zero focusable badge elements, the suite-frozen --muted subtitle, held >=44px targets and visible focus at 320x720 and 1280x800, and zero uncaught console errors.");
    console.log(`Browser evidence screenshots: ${[setup.desktopScreenshot, corrupt.desktopScreenshot, responsive.mobileScreenshot, responsive.desktopScreenshot].join(", ")}`);
  } finally {
    await closeServer(server);
  }
}

await main();
