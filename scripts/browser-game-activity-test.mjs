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
const evidenceDir = await createEvidenceDir("devexpert-track-game-activity");
const server = createStaticServer();
const baseUrl = await listen(server);

const WRITE_NOTICE = "Your latest change couldn't be saved. The game still works, and nothing already saved was lost — your next change will try again.";

// The absolute branch of the relative formatter: `{d MMM, HH:mm}` — the same
// deterministic shape as the title auto-label (short English months, 24-hour
// zero-padded time, local time). Computed on the Node side exactly like the
// in-page render (both share the machine timezone).
const TITLE_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function expectedAbsoluteStamp(iso) {
  const date = new Date(iso);
  return `${date.getDate()} ${TITLE_MONTHS[date.getMonth()]}, ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const iso = (ms) => new Date(ms).toISOString();

// Seeded ages carry a 5-second safety margin so floor math stays stable for
// the whole session (now − 10 min − 5 s asserts "10m ago", etc.).
const AGE_TEN_MINUTES = 10 * MINUTE_MS + 5_000;
const AGE_THIRTY_MINUTES = 30 * MINUTE_MS + 5_000;
const AGE_ONE_HOUR = HOUR_MS + 5_000;
const AGE_THREE_HOURS = 3 * HOUR_MS + 5_000;
const AGE_TWO_DAYS = 2 * DAY_MS + 5_000;
const AGE_EIGHT_DAYS = 8 * DAY_MS;

function seededPlayers(id, names, totals) {
  return names.map((name, index) => ({
    id: `${id}-player-${index + 1}`,
    name,
    color: ["blue", "red", "green"][index % 3],
    marker: String(index + 1),
    order: index,
    total: totals[index] ?? 0
  }));
}

function seededGame({ id, title = "", status = "active", createdAt, updatedAt, names, totals, changes }) {
  const game = {
    id,
    title,
    status,
    changes,
    players: seededPlayers(id, names, totals)
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
    if (!sessionStorage.getItem("game-activity-seed-applied")) {
      sessionStorage.setItem("game-activity-seed-applied", "1");
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

// The seed set shared by the deterministic-ages and responsive sessions.
function buildSeedSet(seedNow) {
  const mixedId = "seed-mixed";
  const mixedCreatedAt = iso(seedNow - AGE_TEN_MINUTES);
  const eightDaysAgo = iso(seedNow - AGE_EIGHT_DAYS);

  const mixed = seededGame({
    id: mixedId,
    title: "Mixed ages night",
    createdAt: mixedCreatedAt,
    updatedAt: mixedCreatedAt,
    names: ["Alex", "Sam", "Jamie"],
    totals: [4, -2, 7],
    // Stored oldest → newest; the panel renders newest first.
    changes: [
      { id: "m-old", playerId: `${mixedId}-player-1`, amount: 1, at: eightDaysAgo },
      { id: "m-two-days", playerId: `${mixedId}-player-3`, amount: 7, at: iso(seedNow - AGE_TWO_DAYS) },
      { id: "m-three-hours", playerId: `${mixedId}-player-2`, amount: -2, at: iso(seedNow - AGE_THREE_HOURS) },
      { id: "m-newest", playerId: `${mixedId}-player-1`, amount: 3, at: iso(seedNow - AGE_TEN_MINUTES) }
    ]
  });

  const cappedId = "seed-capped";
  const cappedCreatedAt = iso(seedNow - AGE_ONE_HOUR);
  const cappedChanges = [];
  for (let index = 0; index < 12; index += 1) {
    if (index === 6) {
      // A ghost entry the panel must skip without consuming a cap slot.
      cappedChanges.push({ id: "cap-ghost", playerId: "ghost-player", amount: 9, at: iso(seedNow - (13 - index) * MINUTE_MS) });
    }
    cappedChanges.push({
      id: `cap-${index + 1}`,
      playerId: `${cappedId}-player-${index % 2 === 0 ? 1 : 2}`,
      amount: index + 1,
      at: iso(seedNow - (13 - index) * MINUTE_MS)
    });
  }
  const capped = seededGame({
    id: cappedId,
    title: "Capped log night",
    createdAt: cappedCreatedAt,
    updatedAt: iso(seedNow - MINUTE_MS - 5_000),
    names: ["Ada", "Bo"],
    totals: [36, 42],
    changes: cappedChanges
  });

  const legacyId = "seed-legacy";
  const legacyCreatedAt = iso(seedNow - AGE_ONE_HOUR);
  const legacy = seededGame({
    id: legacyId,
    title: "Legacy night",
    createdAt: legacyCreatedAt,
    updatedAt: legacyCreatedAt,
    names: ["Ada", "Bo"],
    totals: [5, -1],
    // Pre-feature records: no `at` on change entries.
    changes: [
      { id: "legacy-1", playerId: `${legacyId}-player-1`, amount: 5 },
      { id: "legacy-2", playerId: `${legacyId}-player-2`, amount: -1 }
    ]
  });

  const wideId = "seed-wide";
  const wideCreatedAt = iso(seedNow - 2 * MINUTE_MS);
  const wide = seededGame({
    id: wideId,
    title: "Wide amount night",
    createdAt: wideCreatedAt,
    updatedAt: iso(seedNow - MINUTE_MS - 5_000),
    names: ["Maximilian Vanderbilt", "Bo"],
    totals: [1000000, 0],
    changes: [
      { id: "wide-1", playerId: `${wideId}-player-1`, amount: 1000000, at: iso(seedNow - MINUTE_MS - 5_000) }
    ]
  });

  const finishedId = "seed-frozen";
  const finishedCreatedAt = iso(seedNow - AGE_TWO_DAYS);
  const finished = seededGame({
    id: finishedId,
    title: "Frozen night",
    status: "finished",
    createdAt: finishedCreatedAt,
    updatedAt: iso(seedNow - AGE_TWO_DAYS),
    names: ["Ada", "Bo"],
    totals: [4, 0],
    changes: [
      { id: "frozen-1", playerId: `${finishedId}-player-1`, amount: 4, at: iso(seedNow - AGE_TWO_DAYS) }
    ]
  });

  const createdOnly = seededGame({
    id: "seed-created-only",
    title: "Created only night",
    createdAt: iso(seedNow - AGE_THIRTY_MINUTES),
    updatedAt: "not-a-date",
    names: ["Ada", "Bo"],
    totals: [0, 0],
    changes: []
  });

  const noStamps = seededGame({
    id: "seed-no-stamps",
    title: "No stamps night",
    names: ["Ada", "Bo"],
    totals: [0, 0],
    changes: []
  });

  return { mixed, capped, legacy, wide, finished, createdOnly, noStamps };
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

async function readRecentEntries(cdp) {
  return evaluate(cdp, () => {
    const panel = document.querySelector("[data-recent-entries]");

    if (!panel) {
      return null;
    }

    const header = panel.querySelector(".recent-entries-header");
    const list = panel.querySelector(".recent-entries-list");

    return {
      present: true,
      eyebrow: header?.querySelector(".eyebrow")?.textContent?.trim() ?? null,
      lastLine: header?.querySelector(".recent-entries-last")?.textContent?.trim() ?? null,
      listLabel: list?.getAttribute("aria-label") ?? null,
      emptyText: panel.querySelector(".recent-entries-empty")?.textContent?.trim() ?? null,
      rows: [...panel.querySelectorAll(".recent-entry")].map((row) => ({
        name: row.querySelector(".recent-entry-name")?.textContent?.trim() ?? "",
        amount: row.querySelector(".recent-entry-amount")?.textContent?.trim() ?? "",
        amountIsPositive: row.querySelector(".recent-entry-amount")?.classList.contains("is-positive") ?? false,
        amountIsNegative: row.querySelector(".recent-entry-amount")?.classList.contains("is-negative") ?? false,
        time: row.querySelector(".recent-entry-time")?.textContent?.trim() ?? "",
        tokenText: row.querySelector(".player-token")?.textContent?.trim() ?? "",
        tokenLabel: row.querySelector(".player-token")?.getAttribute("aria-label") ?? ""
      })),
      focusableCount: panel.querySelectorAll("button, input, select, textarea, a[href], [tabindex]").length
    };
  });
}

async function readPlacement(cdp) {
  return evaluate(cdp, () => {
    const form = document.querySelector("[data-score-form]");
    const panel = document.querySelector("[data-recent-entries]");
    const finish = document.querySelector("[data-finish-section]");

    if (!panel || !finish) {
      return { present: false };
    }

    // Superseded by refine-ui-after-testing: Finish game moved from the score
    // panel into the active header. Recent entries remain the score panel's
    // last block (the old before-finish check no longer describes the view).
    return {
      present: true,
      afterScoreForm: Boolean(form && (form.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING)),
      recentEntriesLastInScorePanel: panel.parentElement?.lastElementChild === panel,
      finishSectionInHeader: Boolean(document.querySelector(".active-header [data-finish-section]")),
      finishSectionInScorePanel: Boolean(document.querySelector(".score-panel [data-finish-section]"))
    };
  });
}

async function readHomeCards(cdp) {
  return evaluate(cdp, () => {
    const readCards = (list) => [...(list?.querySelectorAll(".saved-game") ?? [])].map((card) => ({
      gameId: card.dataset.savedGameId ?? "",
      title: card.querySelector(".saved-game-title")?.textContent?.trim() ?? "",
      updated: card.querySelector(".saved-game-updated")?.textContent?.trim() ?? ""
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
    totals: [...document.querySelectorAll(".active-player")].map((row) => ({
      total: row.querySelector(".active-player-total")?.textContent?.trim() ?? ""
    })),
    feedback: document.querySelector("#score-feedback")?.textContent?.trim() ?? "",
    feedbackRole: document.querySelector("#score-feedback")?.getAttribute("aria-live") ?? null,
    recentEntriesInFinishedView: Boolean(document.querySelector(".finished-note")) && Boolean(document.querySelector("[data-recent-entries]")),
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
  }));
}

// Session 1 (Scenarios 1 + 2): UI-scored entries appear newest first with
// `Last:` undo context, persist across a reload/resume round trip, and the
// card gains its deterministic "Updated just now" recency label.
async function runEntriesOrderAndLast(cdp, { consoleProblems }) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  await createGame(cdp, "Score night", ["Alex", "Sam"]);

  // A fresh game starts with the empty state and no `Last:` header.
  await waitForSelector(cdp, "[data-recent-entries]");
  const emptyPanel = await readRecentEntries(cdp);
  assert.equal(emptyPanel.eyebrow, null, "the empty state must not render the entries header");
  assert.equal(emptyPanel.lastLine, null);
  assert.equal(emptyPanel.emptyText, "No score changes yet.");
  assert.equal(emptyPanel.rows.length, 0);
  assert.equal(emptyPanel.focusableCount, 0, "the panel is display-only and must add no focusable elements");

  // +5 for Alex (selected by default), then +10 for Sam.
  await savePoints(cdp, "5");
  await waitForSelector(cdp, ".recent-entry");
  await selectPlayer(cdp, "active-game-player-2");
  await savePoints(cdp, "10");
  await waitForSelector(cdp, ".recent-entry");

  const scoredPanel = await readRecentEntries(cdp);
  assert.equal(scoredPanel.eyebrow, "Recent entries");
  assert.equal(scoredPanel.lastLine, "Last: Sam +10", "the header must name the newest change without 'pts'");
  assert.equal(scoredPanel.listLabel, "Recent entries");
  assert.deepEqual(
    scoredPanel.rows.map((row) => [row.name, row.amount, row.time]),
    [
      ["Sam", "+10 pts", "Just now"],
      ["Alex", "+5 pts", "Just now"]
    ],
    "entries render newest first with signed amounts and relative times"
  );
  assert.equal(scoredPanel.rows[0].amountIsPositive, true);
  // Superseded by show-player-numbers: the token label now carries the derived
  // setup-order badge ("Player 1, Blue") instead of the "Player marker" wording.
  assert.equal(scoredPanel.rows[1].tokenLabel, "Player 1, Blue", "tokens reuse the accepted numbered-token aria-label convention");
  assert.equal(scoredPanel.focusableCount, 0);

  const placement = await readPlacement(cdp);
  assert.equal(placement.present, true);
  assert.equal(placement.afterScoreForm, true, "the panel sits after the score form");
  assert.equal(placement.recentEntriesLastInScorePanel, true, "recent entries remain the score panel's last block");
  assert.equal(placement.finishSectionInHeader, true, "Finish game moved to the active header");
  assert.equal(placement.finishSectionInScorePanel, false);

  const active = await readActiveState(cdp);
  assert.deepEqual(active.totals.map((row) => row.total), ["10", "5"], "the leaderboard behaves exactly as accepted");
  assert.equal(active.feedback, "Added 10 points to Sam. New total: 10. Rank: 1.");
  assert.equal(active.feedbackRole, "polite", "no new live region: #score-feedback still announces saves");

  const stored = await readSavedGamesState(cdp, STORAGE_KEY);
  assert.equal(stored.payloadVersion, 1, "the envelope stays version 1");
  assert.equal(stored.gameCount, 1);
  const parsed = JSON.parse(stored.raw);
  assert.equal(parsed.games[0].changes.length, 2);
  for (const change of parsed.games[0].changes) {
    assert.equal(typeof change.at, "string", "every new change carries an `at` ISO stamp");
    assert.ok(Math.abs(new Date(change.at).getTime() - Date.now()) < 60_000, "`at` stamps the save time");
  }
  const desktopScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-entries-panel.png"));

  // Reload: the card shows the recency label and resume restores the log.
  await goHome(cdp);
  const home = await readHomeCards(cdp);
  assert.equal(home.unfinishedCards.length, 1);
  assert.equal(home.unfinishedCards[0].updated, "Updated just now", "the card renders the deterministic relative token");
  const rawBeforeReload = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;

  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");
  const reloadedHome = await readHomeCards(cdp);
  assert.match(reloadedHome.unfinishedCards[0].updated, /^Updated /);
  const rawAfterReload = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
  assert.equal(rawAfterReload, rawBeforeReload, "the reload must not rewrite storage");

  await click(cdp, "[data-action='resume-game']");
  await waitForSelector(cdp, "[data-recent-entries]");
  const resumedPanel = await readRecentEntries(cdp);
  assert.deepEqual(
    resumedPanel.rows.map((row) => [row.name, row.amount, row.time]),
    [
      ["Sam", "+10 pts", "Just now"],
      ["Alex", "+5 pts", "Just now"]
    ],
    "per-entry times survive reload from the stored `at` stamps"
  );
  assert.equal(resumedPanel.lastLine, "Last: Sam +10");
  const rawAfterResume = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
  assert.equal(rawAfterResume, rawBeforeReload, "resuming is read-only: storage stays byte-identical");
  assert.deepEqual(consoleProblems, [], "the entries-order session must not produce uncaught console errors");
  return { desktopScreenshot };
}

// Session 2 (Scenarios 2 + 5 + the cap): seeded stamps render exact relative
// tokens, legacy no-`at` rows degrade to `—`, corrupt/missing card stamps fall
// back through createdAt to bare "Updated", the log caps at the five newest
// rows, and nothing writes. The six active seeds also exercise the Dashboard's
// five-card preview + "View all (6)" disclosure.
async function runSeededAges(cdp, { consoleProblems }) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  const seedNow = Date.now();
  const seeds = buildSeedSet(seedNow);
  const eightDaysAgo = iso(seedNow - AGE_EIGHT_DAYS);

  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: seedSource([seeds.mixed, seeds.capped, seeds.legacy, seeds.wide, seeds.finished, seeds.createdOnly, seeds.noStamps])
  });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  const seededRaw = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
  assert.equal(JSON.parse(seededRaw).version, 1);

  // Six active seeds exceed the five-card preview, so the panel collapses to
  // the five most recent and shows the per-panel toggle.
  const previewHome = await readHomeCards(cdp);
  assert.equal(previewHome.unfinishedCards.length, 5, "six seeds show a five-card preview");
  const toggle = await evaluate(cdp, () => {
    const button = document.querySelector("[data-action='toggle-unfinished-games']");
    return {
      present: Boolean(button),
      text: button?.textContent?.trim() ?? null,
      expanded: button?.getAttribute("aria-expanded") ?? null,
      controls: button?.getAttribute("aria-controls") ?? null,
      label: button?.getAttribute("aria-label") ?? null,
      listPresent: Boolean(document.querySelector("#unfinished-game-list")),
      height: button?.getBoundingClientRect().height ?? 0
    };
  });
  assert.equal(toggle.present, true, "more than five unfinished games exposes the toggle");
  assert.equal(toggle.text, "View all (6)");
  assert.equal(toggle.expanded, "false");
  assert.equal(toggle.controls, "unfinished-game-list");
  assert.equal(toggle.label, "View all (6) unfinished games");
  assert.equal(toggle.listPresent, true, "aria-controls targets the rendered list id");
  assert.ok(toggle.height >= 44, "the disclosure toggle needs a >=44px target");
  assert.equal((await readSavedGamesState(cdp, STORAGE_KEY)).raw, seededRaw,
    "rendering the collapsed preview never writes");

  await click(cdp, "[data-action='toggle-unfinished-games']");
  const expandedHome = await readHomeCards(cdp);
  assert.equal(expandedHome.unfinishedCards.length, 6, "View all expands to every unfinished game");
  const expandedToggle = await evaluate(cdp, () => {
    const button = document.querySelector("[data-action='toggle-unfinished-games']");
    return {
      text: button?.textContent?.trim() ?? null,
      expanded: button?.getAttribute("aria-expanded") ?? null,
      label: button?.getAttribute("aria-label") ?? null,
      focused: document.activeElement === button
    };
  });
  assert.equal(expandedToggle.text, "Show latest 5");
  assert.equal(expandedToggle.expanded, "true");
  assert.equal(expandedToggle.label, "Show latest 5 unfinished games");
  assert.equal(expandedToggle.focused, true, "the freshly rendered toggle keeps focus");
  assert.equal((await readSavedGamesState(cdp, STORAGE_KEY)).raw, seededRaw,
    "expanding the preview never writes");

  const home = expandedHome;
  const cardById = new Map([...home.unfinishedCards, ...home.finishedCards].map((card) => [card.gameId, card]));
  assert.equal(cardById.get("seed-mixed")?.updated, "Updated 10m ago", "the card ages from the storage-owned updatedAt");
  assert.equal(cardById.get("seed-legacy")?.updated, "Updated 1h ago");
  assert.equal(cardById.get("seed-capped")?.updated, "Updated 1m ago");
  assert.equal(cardById.get("seed-wide")?.updated, "Updated 1m ago");
  assert.equal(cardById.get("seed-frozen")?.updated, "Updated 2d ago", "the finished card ages from its frozen finish-time stamp");
  assert.equal(cardById.get("seed-created-only")?.updated, "Updated 30m ago", "an unparseable updatedAt falls back to a usable createdAt");
  assert.equal(cardById.get("seed-no-stamps")?.updated, "Updated", "neither stamp parses: the bare Updated fallback stays");
  assert.equal(home.horizontalOverflow, false);

  // The mixed-ages game: newest first with exact floor-math tokens.
  await click(cdp, "[data-action='resume-game'][data-game-id='seed-mixed']");
  await waitForSelector(cdp, "[data-recent-entries]");
  const mixedPanel = await readRecentEntries(cdp);
  assert.equal(mixedPanel.lastLine, "Last: Alex +3", "the newest seeded change provides undo context");
  assert.deepEqual(
    mixedPanel.rows.map((row) => [row.name, row.amount, row.time]),
    [
      ["Alex", "+3 pts", "10m ago"],
      ["Sam", "-2 pts", "3h ago"],
      ["Jamie", "+7 pts", "2d ago"],
      ["Alex", "+1 pts", expectedAbsoluteStamp(eightDaysAgo)]
    ],
    "seeded ages render exact relative tokens and the ≥7-day absolute stamp"
  );
  assert.equal(mixedPanel.rows[1].amountIsNegative, true, "negative amounts carry the error token color");
  let rawNow = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
  assert.equal(rawNow, seededRaw, "resuming must not write storage");

  // The capped log: exactly 5 newest rows, ghost entries skipped for free.
  // Superseded by refine-ui-after-testing: RECENT_ENTRIES_LIMIT moved 8 -> 5.
  await goHome(cdp);
  await click(cdp, "[data-action='resume-game'][data-game-id='seed-capped']");
  await waitForSelector(cdp, "[data-recent-entries]");
  const cappedPanel = await readRecentEntries(cdp);
  assert.equal(cappedPanel.rows.length, 5, "the panel caps at RECENT_ENTRIES_LIMIT");
  assert.equal(cappedPanel.rows[0].name, "Bo", "the newest of 12 logged changes renders first");
  assert.equal(cappedPanel.rows[0].amount, "+12 pts");
  assert.deepEqual(
    cappedPanel.rows.map((row) => row.name),
    ["Bo", "Ada", "Bo", "Ada", "Bo"],
    "newest-first ordering across the five-row capped window"
  );

  // The legacy game: pre-feature rows keep working with muted `—` time cells.
  await goHome(cdp);
  await click(cdp, "[data-action='resume-game'][data-game-id='seed-legacy']");
  await waitForSelector(cdp, "[data-recent-entries]");
  const legacyPanel = await readRecentEntries(cdp);
  assert.equal(legacyPanel.rows.length, 2, "legacy entries are never dropped");
  assert.deepEqual(
    legacyPanel.rows.map((row) => [row.name, row.amount, row.time]),
    [["Bo", "-1 pts", "—"], ["Ada", "+5 pts", "—"]],
    "entries without a parseable `at` render the muted em-dash cell"
  );
  assert.equal(legacyPanel.lastLine, "Last: Bo -1");

  // The finished game: read-only view with no entries panel.
  await goHome(cdp);
  await click(cdp, "[data-action='view-results'][data-game-id='seed-frozen']");
  await waitForSelector(cdp, "[data-finished-note]");
  const finishedView = await readActiveState(cdp);
  assert.equal(finishedView.recentEntriesInFinishedView, false, "finished views show no Recent entries panel");
  await goHome(cdp);

  // Reload: the seeded payload is never rewritten.
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");
  const rawAfterReload = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
  assert.equal(rawAfterReload, seededRaw, "loading, resuming, and navigation never rewrite the payload");
  assert.deepEqual(consoleProblems, [], "the seeded-ages session must not produce uncaught console errors");
}

// Session 3 (Scenario 3): undo removes the newest entry, `Last:` recomputes,
// totals and ranks restore exactly as accepted, and a no-op undo is a
// byte-identical no-write.
async function runUndoDerivation(cdp, { consoleProblems }) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  await createGame(cdp, "Undo night", ["Alex", "Sam"]);
  await savePoints(cdp, "10");
  await waitForSelector(cdp, ".recent-entry");
  await selectPlayer(cdp, "active-game-player-2");
  await savePoints(cdp, "5");
  await waitForSelector(cdp, ".recent-entry");

  const beforeUndo = await readRecentEntries(cdp);
  assert.equal(beforeUndo.lastLine, "Last: Sam +5");
  const storedBeforeUndo = await readSavedGamesState(cdp, STORAGE_KEY);
  const updatedAtBefore = JSON.parse(storedBeforeUndo.raw).games[0].updatedAt;

  await click(cdp, "[data-action='undo-last-score']");
  await waitForSelector(cdp, ".recent-entry");

  const afterUndo = await readRecentEntries(cdp);
  assert.deepEqual(
    afterUndo.rows.map((row) => [row.name, row.amount]),
    [["Alex", "+10 pts"]],
    "undo must remove the newest entry from the panel"
  );
  assert.equal(afterUndo.lastLine, "Last: Alex +10", "`Last:` shows the post-undo latest");
  const activeAfterUndo = await readActiveState(cdp);
  assert.deepEqual(activeAfterUndo.totals.map((row) => row.total), ["10", "0"], "totals restore exactly as accepted");
  assert.equal(activeAfterUndo.feedback, "Undid 5 points for Sam. New total: 0. Rank: 2.");

  const storedAfterUndo = await readSavedGamesState(cdp, STORAGE_KEY);
  const parsedAfterUndo = JSON.parse(storedAfterUndo.raw);
  assert.equal(parsedAfterUndo.games[0].changes.length, 1, "the stored log reflects the shortened sequence");
  assert.notEqual(parsedAfterUndo.games[0].updatedAt, updatedAtBefore, "undo is a mutation: updatedAt refreshes");
  const undoScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-undo-context.png"));

  // Drain the log: the panel falls back to the empty state.
  await click(cdp, "[data-action='undo-last-score']");
  await waitForSelector(cdp, "[data-recent-entries]");
  const afterDrain = await readRecentEntries(cdp);
  assert.equal(afterDrain.rows.length, 0);
  assert.equal(afterDrain.emptyText, "No score changes yet.");
  assert.equal(afterDrain.lastLine, null, "the `Last:` header only renders when an entry renders");
  const activeAfterDrain = await readActiveState(cdp);
  assert.equal(activeAfterDrain.feedback, "Undid 10 points for Alex. New total: 0. Rank: 1.");
  const storedAfterDrain = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;

  // A no-op undo never writes: the payload stays byte-identical.
  await click(cdp, "[data-action='undo-last-score']");
  await waitForSelector(cdp, "#score-feedback");
  const activeAfterNoop = await readActiveState(cdp);
  assert.equal(activeAfterNoop.feedback, "Nothing to undo yet.", "the accepted no-op copy is unchanged");
  const storedAfterNoop = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
  assert.equal(storedAfterNoop, storedAfterDrain, "a no-op undo must be a byte-identical no-write");
  assert.deepEqual(consoleProblems, [], "the undo session must not produce uncaught console errors");
  return { undoScreenshot };
}

// Session 4 (Scenario 3 under blocked writes): undo keeps working in memory,
// the accepted notice copy holds, storage is never created, and diagnostics
// stay code-only.
async function runBlockedWriteUndo(cdp, { consoleProblems, warnings }) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  await createGame(cdp, "Blocked night", ["Alex", "Sam"]);
  const storedAtStart = await readSavedGamesState(cdp, STORAGE_KEY);
  assert.equal(storedAtStart.keyCount, 0, "blocked writes must never create the storage key");

  await savePoints(cdp, "5");
  await waitForSelector(cdp, ".recent-entry");
  const panelBefore = await readRecentEntries(cdp);
  assert.deepEqual(panelBefore.rows.map((row) => [row.name, row.amount]), [["Alex", "+5 pts"]]);
  assert.equal(panelBefore.lastLine, "Last: Alex +5");

  await click(cdp, "[data-action='undo-last-score']");
  await waitForSelector(cdp, "[data-recent-entries]");
  const panelAfter = await readRecentEntries(cdp);
  assert.equal(panelAfter.rows.length, 0, "undo works in memory under blocked writes");
  assert.equal(panelAfter.emptyText, "No score changes yet.");
  const activeAfter = await readActiveState(cdp);
  assert.equal(activeAfter.feedback, "Undid 5 points for Alex. New total: 0. Rank: 1.", "success feedback is unchanged");

  const storedAtEnd = await readSavedGamesState(cdp, STORAGE_KEY);
  assert.equal(storedAtEnd.keyCount, 0, "blocked writes must keep storage untouched");
  assert.ok(
    warnings.some((warning) => warning.includes("Game save failed: write")),
    "the blocked saves must log the code-only diagnostic"
  );
  for (const warning of warnings) {
    assert.doesNotMatch(warning, /Alex|Sam|Blocked/i, "diagnostics must stay code-only");
  }
  assert.deepEqual(consoleProblems, [], "the blocked-write session must not produce uncaught console errors");
}

// Session 5 (Scenario 4): finishing freezes the stamp, finished views show no
// panel, and Play again starts a clean log while the original stays
// byte-identical.
async function runFinishFreezeAndReplay(cdp, { consoleProblems }) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  await createGame(cdp, "Freeze night", ["Alex", "Sam"]);
  await savePoints(cdp, "5");
  await waitForSelector(cdp, ".recent-entry");

  await click(cdp, "[data-action='open-finish']");
  await waitForSelector(cdp, "[data-action='confirm-finish']");
  await click(cdp, "[data-action='confirm-finish']");
  await waitForSelector(cdp, "[data-podium-dialog]");
  await click(cdp, "[data-action='close-podium']");
  await waitForSelector(cdp, "[data-action='play-again']");

  const finishedView = await readActiveState(cdp);
  assert.equal(finishedView.recentEntriesInFinishedView, false, "the finished view renders no entries panel");

  await goHome(cdp);
  const home = await readHomeCards(cdp);
  assert.equal(home.finishedCards[0].updated, "Updated just now", "the finished card ages from its frozen stamp");
  const storedBeforeReplay = await readSavedGamesState(cdp, STORAGE_KEY);
  const parsedBefore = JSON.parse(storedBeforeReplay.raw);
  assert.equal(parsedBefore.games.length, 1);
  const originalId = parsedBefore.games[0].id;
  const originalEntry = JSON.stringify(parsedBefore.games[0]);

  await click(cdp, "[data-action='view-results']");
  await waitForSelector(cdp, "[data-action='play-again']");
  assert.equal((await readActiveState(cdp)).recentEntriesInFinishedView, false);
  await click(cdp, "[data-action='play-again']");
  await waitForSelector(cdp, "#score-amount");

  const replayPanel = await readRecentEntries(cdp);
  assert.equal(replayPanel.emptyText, "No score changes yet.", "the replay starts with a clean log");

  const storedAfterReplay = await readSavedGamesState(cdp, STORAGE_KEY);
  const parsedAfter = JSON.parse(storedAfterReplay.raw);
  assert.equal(parsedAfter.games.length, 2);
  const replayEntry = parsedAfter.games.find((game) => game.id !== originalId);
  assert.ok(!("changes" in replayEntry), "the replay carries no change log");
  const storedOriginal = parsedAfter.games.find((game) => game.id === originalId);
  assert.equal(JSON.stringify(storedOriginal), originalEntry, "the finished original stays byte-identical across the replay");

  // An immediate undo on the fresh replay is the accepted no-op.
  await click(cdp, "[data-action='undo-last-score']");
  await waitForSelector(cdp, "#score-feedback");
  assert.equal((await readActiveState(cdp)).feedback, "Nothing to undo yet.");
  const storedAfterNoop = (await readSavedGamesState(cdp, STORAGE_KEY)).raw;
  assert.equal(storedAfterNoop, storedAfterReplay.raw, "the no-op undo writes nothing");
  assert.deepEqual(consoleProblems, [], "the finish-freeze session must not produce uncaught console errors");
}

// Session 6 (Scenario 6): the responsive and console baseline at 320x720 and
// 1280x800 — no overflow with wide amounts and long names, no focusable
// elements, suite-frozen muted tokens at AA contrast.
async function runResponsiveConsole(cdp, { consoleProblems }) {
  const seedNow = Date.now();
  const seeds = buildSeedSet(seedNow);

  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: seedSource([seeds.mixed, seeds.wide, seeds.finished, seeds.noStamps])
  });

  await setViewport(cdp, { width: 320, height: 720, mobile: true });
  await navigate(cdp, baseUrl);
  await waitForSelector(cdp, "[data-action='new-game']");

  const home = await readHomeCards(cdp);
  assert.equal(home.horizontalOverflow, false, "both card lists must not overflow at 320px");
  assert.ok(home.unfinishedCards.length >= 2);
  assert.equal(home.finishedCards.length, 1);
  const mobileHomeScreenshot = await screenshot(cdp, path.join(evidenceDir, "mobile-home-320px.png"));

  // The empty state (a replay-shaped log) renders its muted line at 320px.
  await click(cdp, "[data-action='resume-game'][data-game-id='seed-no-stamps']");
  await waitForSelector(cdp, "[data-recent-entries]");
  const emptyPanel = await readRecentEntries(cdp);
  assert.equal(emptyPanel.emptyText, "No score changes yet.");
  assert.equal(emptyPanel.focusableCount, 0);
  const emptyColor = await evaluate(cdp, () => {
    const node = document.querySelector(".recent-entries-empty");
    const match = node ? getComputedStyle(node).color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/) : null;
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
  });
  assert.ok(emptyColor, "the empty state must render for its contrast check");
  const emptyBackground = await evaluate(cdp, () => {
    const panel = document.querySelector(".score-panel");
    const match = panel ? getComputedStyle(panel).backgroundColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/) : null;
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
  });
  const emptyValue = contrastRatio(emptyColor, emptyBackground);
  assert.ok(emptyValue >= 4.5, `empty-state text must meet AA contrast (got ${emptyValue.toFixed(2)})`);

  // The mixed-ages game carries both amount signs plus time cells, so the
  // contrast set is read from its panel.
  await goHome(cdp);
  await click(cdp, "[data-action='resume-game'][data-game-id='seed-mixed']");
  await waitForSelector(cdp, "[data-recent-entries]");

  const contrast = await evaluate(cdp, () => {
    const parseRgb = (value) => {
      const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
    };
    const background = parseRgb(getComputedStyle(document.querySelector(".score-panel")).backgroundColor);
    const read = (selector) => {
      const node = document.querySelector(selector);
      return node ? parseRgb(getComputedStyle(node).color) : null;
    };
    return {
      background,
      time: read(".recent-entry-time"),
      positive: read(".recent-entry-amount.is-positive"),
      negative: read(".recent-entry-amount.is-negative"),
      mutedToken: getComputedStyle(document.querySelector(".recent-entry-time")).color
    };
  });
  assert.equal(contrast.mutedToken, "rgb(109, 101, 92)", "muted time cells use the suite-frozen --muted token");
  for (const [label, color] of [["time", contrast.time], ["positive", contrast.positive], ["negative", contrast.negative]]) {
    assert.ok(color, `${label} cell must render`);
    const value = contrastRatio(color, contrast.background);
    assert.ok(value >= 4.5, `${label} text must meet AA contrast (got ${value.toFixed(2)})`);
  }

  // The widest amount and a long name must still render without overflow.
  await goHome(cdp);
  await click(cdp, "[data-action='resume-game'][data-game-id='seed-wide']");
  await waitForSelector(cdp, "[data-recent-entries]");
  const widePanel = await readRecentEntries(cdp);
  assert.deepEqual(
    widePanel.rows.map((row) => [row.name, row.amount, row.time]),
    [["Maximilian Vanderbilt", "+1000000 pts", "1m ago"]],
    "the widest amount and a long name still render"
  );
  const wideActive = await readActiveState(cdp);
  assert.equal(wideActive.horizontalOverflow, false, "the entries panel must not overflow at 320px");
  assert.equal(widePanel.focusableCount, 0, "the panel introduces no focusable elements at 320px");
  const mobileActiveScreenshot = await screenshot(cdp, path.join(evidenceDir, "mobile-entries-320px.png"));

  // Desktop width: the same surfaces stay overflow-free.
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  assert.equal((await readActiveState(cdp)).horizontalOverflow, false, "the entries panel must not overflow at 1280px");
  await goHome(cdp);
  assert.equal((await readHomeCards(cdp)).horizontalOverflow, false, "home must not overflow at 1280px");
  const desktopEntriesScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-entries-seeded.png"));

  assert.deepEqual(consoleProblems, [], "the responsive session must not produce uncaught console errors");
  return { mobileHomeScreenshot, mobileActiveScreenshot, desktopEntriesScreenshot };
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
    const entries = await runSession("entries-order-last", runEntriesOrderAndLast);
    assert.equal(typeof entries.desktopScreenshot, "string");

    await runSession("seeded-ages", runSeededAges);
    const undo = await runSession("undo-derivation", runUndoDerivation);
    assert.equal(typeof undo.undoScreenshot, "string");

    await runSession("blocked-write-undo", runBlockedWriteUndo, {
      setupSource: BLOCK_SET_ITEM_SOURCE
    });

    await runSession("finish-freeze-replay", runFinishFreezeAndReplay);

    const responsive = await runSession("responsive-console", runResponsiveConsole);
    assert.equal(typeof responsive.mobileActiveScreenshot, "string");

    console.log("Browser game-activity test passed: the six active seeds exercise the Dashboard five-card preview and View all (6) toggle before all card ages are read; score changes stamp per-entry `at` times and render newest first in the Recent entries panel (cap 5, `Last: {name} {signedAmount}` header, signed '+5 pts'/'-2 pts' amounts, 'Just now'/'10m ago'/'3h ago'/'2d ago' and the absolute '{d MMM, HH:mm}' token from seeded stamps with floor-math margins); cards render 'Updated {token}' from updatedAt → createdAt → bare 'Updated'; per-entry times survive reload/resume byte-identically; undo removes the newest entry, recomputes `Last:`, refreshes updatedAt, and a no-op undo is a byte-identical no-write; blocked writes keep undo working in memory with the unchanged notice and code-only warnings; finished views show no panel and freeze their stamp while Play again starts clean with the original byte-identical; legacy no-`at` rows degrade to muted '—'; 320x720 and 1280x800 stay overflow-free with zero focusable panel elements, the frozen --muted token, AA contrast, and zero uncaught console errors.");
    console.log(`Browser evidence screenshots: ${[
      entries.desktopScreenshot,
      undo.undoScreenshot,
      responsive.mobileHomeScreenshot,
      responsive.mobileActiveScreenshot,
      responsive.desktopEntriesScreenshot
    ].join(", ")}`);
  } finally {
    await closeServer(server);
  }
}

await main();
