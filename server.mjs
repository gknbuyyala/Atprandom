#!/usr/bin/env node
// Static server for the Ask The Professor shuffle player, with automatic
// episode-list refresh. Intended to run in a container (e.g. on a QNAP NAS):
// it serves index.html + episodes.json over HTTP, regenerates episodes.json
// on startup, and optionally refreshes it on a schedule.
//
// No external dependencies — Node 18+ only.
//
// Env vars:
//   PORT                  HTTP port to listen on            (default 8080)
//   REGEN_ON_START        regenerate episodes.json at boot  (default "true")
//   REGEN_INTERVAL_HOURS  re-run the generator every N hrs  (default 0 = off)
//   WEB_ROOT              directory to serve                (default ".")

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const PORT = parseInt(process.env.PORT || "8080", 10);
const WEB_ROOT = resolve(process.env.WEB_ROOT || ".");
const REGEN_ON_START = (process.env.REGEN_ON_START || "true").toLowerCase() !== "false";
const REGEN_INTERVAL_HOURS = parseFloat(process.env.REGEN_INTERVAL_HOURS || "0");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

function log(...a) { console.log(new Date().toISOString(), ...a); }

// Run generate-episodes.mjs as a child process. It only overwrites
// episodes.json on success, so a network failure leaves the old list intact.
function regenerate() {
  return new Promise((res) => {
    log("Refreshing episode list…");
    const child = spawn(process.execPath, [join(WEB_ROOT, "generate-episodes.mjs")], {
      cwd: WEB_ROOT,
      stdio: "inherit",
      env: process.env,
    });
    child.on("close", (code) => {
      log(code === 0 ? "Episode list refreshed." : `Generator exited with code ${code} (kept existing list).`);
      res(code);
    });
    child.on("error", (e) => { log("Could not run generator:", e.message); res(1); });
  });
}

// --- Static file serving --------------------------------------------------
async function serveFile(req, res) {
  let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";

  // Resolve within WEB_ROOT and block path traversal.
  const filePath = normalize(join(WEB_ROOT, urlPath));
  if (!filePath.startsWith(WEB_ROOT)) {
    res.writeHead(403); res.end("Forbidden"); return;
  }

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) { res.writeHead(403); res.end("Forbidden"); return; }
    const body = await readFile(filePath);
    const type = MIME[extname(filePath).toLowerCase()] || "application/octet-stream";
    // Don't cache the episode list (it changes); allow caching the app shell.
    const cache = filePath.endsWith("episodes.json") ? "no-store" : "public, max-age=300";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": cache });
    res.end(body);
  } catch (e) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
}

const server = createServer((req, res) => {
  if (req.method === "GET" && (req.url === "/healthz")) {
    res.writeHead(200, { "Content-Type": "text/plain" }); res.end("ok"); return;
  }
  // Manual refresh endpoint (handy for a QNAP scheduled task / curl).
  if (req.method === "POST" && req.url === "/refresh") {
    regenerate();
    res.writeHead(202, { "Content-Type": "text/plain" }); res.end("refreshing"); return;
  }
  serveFile(req, res);
});

async function main() {
  if (REGEN_ON_START) await regenerate();

  if (REGEN_INTERVAL_HOURS > 0) {
    const ms = REGEN_INTERVAL_HOURS * 3600 * 1000;
    setInterval(regenerate, ms);
    log(`Scheduled refresh every ${REGEN_INTERVAL_HOURS} h.`);
  }

  server.listen(PORT, () => {
    log(`Ask The Professor shuffle player serving on http://0.0.0.0:${PORT}`);
    log(`Web root: ${WEB_ROOT}`);
  });
}

process.on("SIGTERM", () => { log("SIGTERM — shutting down."); server.close(() => process.exit(0)); });
process.on("SIGINT", () => { log("SIGINT — shutting down."); server.close(() => process.exit(0)); });

main();
