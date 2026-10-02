import assert from "node:assert/strict";
import { createStaticServer, listen } from "./static-server.mjs";

const server = createStaticServer();
const baseUrl = await listen(server);

try {
  const response = await fetch(baseUrl);
  assert.equal(response.status, 200, "index.html should load over HTTP");
  assert.match(
    response.headers.get("content-type") ?? "",
    /text\/html/,
    "index.html should be served as HTML"
  );

  const html = await response.text();
  assert.match(html, /<main id="main-content"/, "main landmark should be present");
  assert.match(html, /Board-game scorekeeper/, "app shell title should be present");
  assert.match(html, /data-app-root/, "app mount should be present");
  assert.doesNotMatch(html, /localStorage|score change|leaderboard row/i, "future behavior should not be implemented in static markup");

  await assertOk(`${baseUrl}src/styles.css`, "CSS should load over HTTP");
  await assertOk(`${baseUrl}src/main.js`, "JavaScript module should load over HTTP");
  await assertOk(`${baseUrl}src/roster.js`, "Roster module should load over HTTP");
  await assertStatus(`${baseUrl}AGENTS.md`, 404, "repository instructions should not be public");
  await assertStatus(`${baseUrl}feature_list.json`, 404, "feature metadata should not be public");
  await assertStatus(`${baseUrl}.git/config`, 404, "git config should not be public");
  await assertStatus(`${baseUrl}%E0%A4%A`, 400, "malformed encoded paths should return 400");
  await assertOk(baseUrl, "server should stay alive after a malformed request");

  console.log("Smoke check passed: app shell loads over HTTP, serves intended modules, and blocks repository files.");
} finally {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function assertOk(url, message) {
  const response = await fetch(url);
  assert.equal(response.status, 200, message);
}

async function assertStatus(url, expectedStatus, message) {
  const response = await fetch(url);
  assert.equal(response.status, expectedStatus, message);
}
