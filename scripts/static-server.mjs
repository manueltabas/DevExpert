import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

const DEFAULT_PUBLIC_FILES = new Set([
  "index.html",
  "src/main.js",
  "src/roster.js",
  "src/score.js",
  "src/standings.js",
  "src/styles.css"
]);

export function createStaticServer({ root = process.cwd(), publicFiles = DEFAULT_PUBLIC_FILES } = {}) {
  const rootPath = path.resolve(root);
  const allowedFiles = new Set(publicFiles);

  return createServer(async (request, response) => {
    if (!request.url || !["GET", "HEAD"].includes(request.method ?? "")) {
      response.writeHead(405);
      response.end("Method not allowed");
      return;
    }

    const publicPath = getPublicPath(request.url);

    if (publicPath.status === 400) {
      response.writeHead(400);
      response.end("Bad request");
      return;
    }

    if (!allowedFiles.has(publicPath.relativePath)) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    const filePath = path.resolve(rootPath, publicPath.relativePath);

    if (!isWithinRoot(rootPath, filePath)) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    try {
      const realFilePath = await realpath(filePath);
      if (!isWithinRoot(rootPath, realFilePath)) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }

      const fileStats = await stat(filePath);
      if (!fileStats.isFile()) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }

      response.writeHead(200, {
        "content-length": fileStats.size,
        "content-type": MIME_TYPES[path.extname(filePath)] ?? "application/octet-stream"
      });

      if (request.method === "HEAD") {
        response.end();
        return;
      }

      createReadStream(filePath).pipe(response);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  });
}

function getPublicPath(requestUrl) {
  try {
    const requestedUrl = new URL(requestUrl, "http://localhost");
    const decodedPath = decodeURIComponent(requestedUrl.pathname);

    if (decodedPath.includes("\0")) {
      return { status: 400, relativePath: "" };
    }

    const relativePath = decodedPath === "/" ? "index.html" : decodedPath.slice(1);
    const normalizedPath = path.posix.normalize(relativePath);

    if (relativePath.startsWith("/") || normalizedPath.startsWith("../") || normalizedPath === "..") {
      return { status: 404, relativePath: "" };
    }

    return { status: 200, relativePath: normalizedPath };
  } catch {
    return { status: 400, relativePath: "" };
  }
}

function isWithinRoot(rootPath, filePath) {
  const relativePath = path.relative(rootPath, filePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

export function listen(server, { host = "127.0.0.1", port = 0 } = {}) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Server did not report a TCP address."));
        return;
      }
      resolve(`http://${address.address}:${address.port}/`);
    });
  });
}
