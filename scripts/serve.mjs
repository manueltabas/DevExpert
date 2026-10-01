import { createStaticServer, listen } from "./static-server.mjs";

const requestedPort = Number.parseInt(process.env.PORT ?? "4173", 10);
const port = Number.isFinite(requestedPort) ? requestedPort : 4173;
const host = process.env.HOST ?? "127.0.0.1";
const server = createStaticServer();
const url = await listen(server, { host, port });

console.log(`Serving Game Night Scorekeeper at ${url}`);
console.log("Press Ctrl+C to stop.");
