import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export const DEFAULT_CHROME_PATH =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export async function createEvidenceDir(folderName) {
  const evidenceDir = path.join(tmpdir(), folderName);
  await rm(evidenceDir, { recursive: true, force: true });
  await mkdir(evidenceDir, { recursive: true });
  return evidenceDir;
}

export async function launchChrome({ chromePath, userDataDir, url }) {
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

export class CdpClient {
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

export async function setViewport(cdp, { width, height, mobile }) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    mobile,
    deviceScaleFactor: 1
  });
}

export async function navigate(cdp, url) {
  const loaded = cdp.waitFor("Page.loadEventFired");
  await cdp.send("Page.navigate", { url });
  await loaded;
}

export async function click(cdp, selector) {
  await evaluate(cdp, (targetSelector) => {
    const element = document.querySelector(targetSelector);
    if (!element) {
      throw new Error(`Missing selector: ${targetSelector}`);
    }
    element.click();
  }, selector);
}

export async function waitForSelector(cdp, selector) {
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

export async function fill(cdp, selector, value) {
  await evaluate(cdp, ({ targetSelector, nextValue }) => {
    const element = document.querySelector(targetSelector);
    if (!element) {
      throw new Error(`Missing selector: ${targetSelector}`);
    }
    element.value = nextValue;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, { targetSelector: selector, nextValue: value });
}

export async function evaluate(cdp, pageFunction, argument) {
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

export async function screenshot(cdp, filePath) {
  const result = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(filePath, Buffer.from(result.data, "base64"));
  return filePath;
}

export async function closeServer(serverToClose) {
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
