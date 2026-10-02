import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createStaticServer, listen } from "./static-server.mjs";

const chromePath =
  process.env.CHROME_BIN ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const evidenceDir = path.join(tmpdir(), "devexpert-create-game-roster");
const server = createStaticServer();
const baseUrl = await listen(server);
let chrome;

async function runDesktopScenario(cdp, url) {
  await setViewport(cdp, { width: 1280, height: 800, mobile: false });
  await navigate(cdp, url);
  await waitForSelector(cdp, "[data-action='new-game']");
  await click(cdp, "[data-action='new-game']");
  await fill(cdp, "#game-title", "Friday game");
  await fill(cdp, "#player-name-1", "  Alex  ");
  await fill(cdp, "#player-name-2", "Alex");
  await click(cdp, "input[name='color-2'][value='blue']");
  await click(cdp, "button[type='submit']");

  const result = await evaluate(cdp, () => {
    const players = [...document.querySelectorAll(".active-player")].map((row) => ({
      id: row.dataset.playerId,
      name: row.querySelector(".active-player-name")?.textContent?.trim(),
      total: row.querySelector(".active-player-total")?.textContent?.trim(),
      marker: row.querySelector(".player-token")?.textContent?.trim()
    }));

    return {
      heading: document.querySelector("#active-title")?.textContent?.trim(),
      players,
      uniqueIds: new Set(players.map((player) => player.id)).size,
      localStorageLength: localStorage.length,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });

  assert.equal(result.heading, "Friday game");
  assert.deepEqual(result.players.map((player) => player.name), ["Alex", "Alex"]);
  assert.deepEqual(result.players.map((player) => player.total), ["0", "0"]);
  assert.equal(result.uniqueIds, 2);
  assert.equal(result.localStorageLength, 0);
  assert.equal(result.horizontalOverflow, false);
}

async function runMobileScenario(cdp, url) {
  await setViewport(cdp, { width: 320, height: 720, mobile: true });
  await navigate(cdp, url);
  await waitForSelector(cdp, "[data-action='new-game']");
  await click(cdp, "[data-action='new-game']");
  await click(cdp, "button[type='submit']");

  const invalidResult = await evaluate(cdp, () => ({
    validationText: document.querySelector("#setup-feedback")?.textContent ?? "",
    activeGameCreated: Boolean(document.querySelector(".active-player"))
  }));
  assert.match(invalidResult.validationText, /Player 1 needs a name/);
  assert.equal(invalidResult.activeGameCreated, false);

  for (let index = 0; index < 18; index += 1) {
    await click(cdp, "[data-action='add-player']");
  }

  const names = Array.from({ length: 20 }, (_, index) => `Player ${index + 1}`);
  names[0] = "Sam";
  names[1] = "Sam";
  for (let index = 0; index < names.length; index += 1) {
    await fill(cdp, `#player-name-${index + 1}`, names[index]);
  }

  const setupResult = await evaluate(cdp, () => {
    const addButton = document.querySelector("[data-action='add-player']");
    addButton.click();
    const firstInput = document.querySelector("#player-name-1");
    firstInput.focus();
    const firstInputStyle = getComputedStyle(firstInput);
    const rows = [...document.querySelectorAll(".player-row")];
    const colors = rows.map((row) => row.querySelector("input[data-field='color']:checked")?.value);

    return {
      rowCount: rows.length,
      addDisabled: addButton.disabled,
      limitText: document.querySelector("#setup-feedback")?.textContent ?? "",
      firstTwoNames: [...document.querySelectorAll("[data-field='name']")].slice(0, 2).map((input) => input.value),
      colorCount: new Set(colors).size,
      firstColor: colors[0],
      eighthColor: colors[7],
      labels: [...document.querySelectorAll("label[for^='player-name-']")].length,
      focusedOutline: firstInputStyle.outlineStyle,
      focusedOutlineWidth: firstInputStyle.outlineWidth,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });

  assert.equal(setupResult.rowCount, 20);
  assert.equal(setupResult.addDisabled, true);
  assert.deepEqual(setupResult.firstTwoNames, ["Sam", "Sam"]);
  assert.equal(setupResult.colorCount, 7);
  assert.equal(setupResult.firstColor, setupResult.eighthColor);
  assert.equal(setupResult.labels, 20);
  assert.notEqual(setupResult.focusedOutline, "none");
  assert.notEqual(setupResult.focusedOutlineWidth, "0px");
  assert.equal(setupResult.horizontalOverflow, false);

  const mobileSetupScreenshot = await screenshot(cdp, path.join(evidenceDir, "mobile-20-player-setup.png"));
  await click(cdp, "button[type='submit']");
  const activeResult = await evaluate(cdp, () => ({
    playerCount: document.querySelectorAll(".active-player").length,
    totals: [...document.querySelectorAll(".active-player-total")].map((node) => node.textContent.trim()),
    names: [...document.querySelectorAll(".active-player-name")].map((node) => node.textContent.trim()),
    uniqueIds: new Set([...document.querySelectorAll(".active-player")].map((row) => row.dataset.playerId)).size,
    localStorageLength: localStorage.length,
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
  }));

  assert.equal(activeResult.playerCount, 20);
  assert.equal(activeResult.uniqueIds, 20);
  assert.deepEqual(activeResult.totals, Array(20).fill("0"));
  assert.deepEqual(activeResult.names.slice(0, 2), ["Sam", "Sam"]);
  assert.equal(activeResult.localStorageLength, 0);
  assert.equal(activeResult.horizontalOverflow, false);
  return mobileSetupScreenshot;
}

async function launchChrome({ chromePath, userDataDir, url }) {
  return new Promise((resolve, reject) => {
    const args = [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-port=0",
      `--user-data-dir=${userDataDir}`,
      url
    ];
    const child = spawn(chromePath, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Timed out waiting for Chrome DevTools endpoint."));
    }, 30000);

    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match && !settled) {
        settled = true;
        clearTimeout(timeout);
        const remotePort = new URL(match[1]).port;
        pollPageWebSocket(remotePort, url)
          .then((webSocketUrl) => resolve({ chrome: child, webSocketUrl }))
          .catch((error) => {
            child.kill("SIGTERM");
            reject(error);
          });
      }
    });
  });
}

async function pollPageWebSocket(remotePort, expectedUrl) {
  const listUrl = `http://127.0.0.1:${remotePort}/json/list`;
  const deadline = Date.now() + 10000;

  while (Date.now() < deadline) {
    const response = await fetch(listUrl);
    const targets = await response.json();
    const page = targets.find((target) => target.type === "page" && target.url === expectedUrl) ??
      targets.find((target) => target.type === "page");

    if (page?.webSocketDebuggerUrl) {
      return page.webSocketDebuggerUrl;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
  }

  throw new Error("Timed out waiting for Chrome page target.");
}

class CdpClient {
  static async connect(webSocketUrl) {
    const socket = new WebSocket(webSocketUrl);
    const client = new CdpClient(socket);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    return client;
  }

  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener("message", (message) => this.handleMessage(message));
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  waitFor(method) {
    return new Promise((resolve) => {
      const listener = (event) => {
        const listeners = this.listeners.get(method) ?? [];
        this.listeners.set(method, listeners.filter((item) => item !== listener));
        resolve(event);
      };
      this.on(method, listener);
    });
  }

  handleMessage(message) {
    const data = JSON.parse(message.data);
    if (data.id && this.pending.has(data.id)) {
      const pending = this.pending.get(data.id);
      this.pending.delete(data.id);
      if (data.error) {
        pending.reject(new Error(data.error.message));
        return;
      }
      pending.resolve(data.result);
      return;
    }

    if (data.method && this.listeners.has(data.method)) {
      for (const listener of this.listeners.get(data.method)) {
        listener(data.params);
      }
    }
  }
}

async function setViewport(cdp, { width, height, mobile }) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    mobile,
    deviceScaleFactor: 1
  });
}

async function navigate(cdp, url) {
  const loaded = cdp.waitFor("Page.loadEventFired");
  await cdp.send("Page.navigate", { url });
  await loaded;
}

async function click(cdp, selector) {
  await evaluate(cdp, (targetSelector) => {
    const element = document.querySelector(targetSelector);
    if (!element) {
      throw new Error(`Missing selector: ${targetSelector}`);
    }
    element.click();
  }, selector);
}

async function waitForSelector(cdp, selector) {
  const deadline = Date.now() + 5000;

  while (Date.now() < deadline) {
    const found = await evaluate(cdp, (targetSelector) => ({
      ready: document.documentElement.dataset.appReady === "true",
      found: Boolean(document.querySelector(targetSelector))
    }), selector);

    if (found.ready && found.found) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
  }

  throw new Error(`Timed out waiting for selector: ${selector}`);
}

async function fill(cdp, selector, value) {
  await evaluate(cdp, ({ targetSelector, nextValue }) => {
    const element = document.querySelector(targetSelector);
    if (!element) {
      throw new Error(`Missing selector: ${targetSelector}`);
    }
    element.value = nextValue;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, { targetSelector: selector, nextValue: value });
}

async function evaluate(cdp, pageFunction, argument) {
  const expression = `(${pageFunction})(${JSON.stringify(argument)})`;
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    const description = result.exceptionDetails.exception?.description ??
      result.exceptionDetails.exception?.value ??
      result.exceptionDetails.text ??
      "Browser evaluation failed";
    throw new Error(description);
  }
  return result.result.value;
}

async function screenshot(cdp, filePath) {
  const result = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(filePath, Buffer.from(result.data, "base64"));
  return filePath;
}

async function closeServer(serverToClose) {
  await new Promise((resolve, reject) => {
    serverToClose.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function main() {
  try {
    await rm(evidenceDir, { recursive: true, force: true });
    await mkdir(evidenceDir, { recursive: true });
    const userDataDir = path.join(evidenceDir, "chrome-profile");

    const launched = await launchChrome({ chromePath, userDataDir, url: baseUrl });
    chrome = launched.chrome;
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
    await runDesktopScenario(cdp, baseUrl);
    const desktopScreenshot = await screenshot(cdp, path.join(evidenceDir, "desktop-active-game.png"));

    const mobileSetupScreenshot = await runMobileScenario(cdp, baseUrl);
    const mobileActiveScreenshot = await screenshot(cdp, path.join(evidenceDir, "mobile-20-player-active-game.png"));

    assert.deepEqual(consoleProblems, [], "browser console should not report errors");

    console.log("Browser roster test passed: desktop valid game, mobile 20-player cap, invalid names, duplicate names/colors, zero totals, no persistence, and no horizontal overflow.");
    console.log(`Browser evidence screenshots: ${desktopScreenshot}, ${mobileSetupScreenshot}, ${mobileActiveScreenshot}`);
  } finally {
    if (chrome) {
      chrome.kill("SIGTERM");
    }
    await closeServer(server);
  }
}

await main();
