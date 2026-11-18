// Local preview server (serves docs/, exactly what GitHub Pages serves) plus a stub of the Apps Script web app. For local checks only; never deployed.
//
//   node scripts/serve.mjs [--port 4788] [--endpoint stub|none|<url>]
//
// The site is served on --port. The stub runs on port + 1 at /exec and executes the real
// apps-script/Code.gs against an in-memory sheet, so the honeypot, validation and formula guard
// tested here are the same code Jonathan deploys.
//
// --endpoint stub (default) rewrites the CONFIG line in waitlist.js to point at the stub, as if
// the web app URL had been pasted in. --endpoint none serves the file untouched (empty config).
// POST /__endpoint with a body of stub, none or a URL changes it while running (tests use this).
// GET http://127.0.0.1:<port+1>/rows returns the stub sheet; POST /reset clears it.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = path.join(ROOT, "docs"); // the folder GitHub Pages serves

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

export function startServers({ port = 4788, endpoint = "stub" } = {}) {
  const stubPort = port + 1;
  const stubUrl = `http://127.0.0.1:${stubPort}/exec`;
  let mode = endpoint;

  // ---- Stub Apps Script runtime ----
  const sheetRows = [];
  const sandbox = {
    console,
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (n) => (n === "EzBiz Waitlist" ? sheet : null),
        insertSheet: () => sheet,
      }),
    },
    ContentService: {
      MimeType: { JSON: "application/json", TEXT: "text/plain" },
      createTextOutput: (text) => {
        const out = { text, mime: "text/plain", setMimeType(m) { out.mime = m; return out; } };
        return out;
      },
    },
  };
  const sheet = {
    getLastRow: () => sheetRows.length,
    appendRow: (r) => sheetRows.push(r.map((v) => (v && typeof v.toISOString === "function" ? v.toISOString() : v))),
    setFrozenRows: () => {},
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "apps-script/Code.gs"), "utf8"), sandbox, { filename: "Code.gs" });

  const stub = http.createServer((req, res) => {
    const cors = { "Access-Control-Allow-Origin": "*" };
    if (req.method === "GET" && req.url === "/rows") {
      res.writeHead(200, { ...cors, "Content-Type": "application/json" });
      return res.end(JSON.stringify(sheetRows));
    }
    if (req.method === "POST" && req.url === "/reset") {
      sheetRows.length = 0;
      res.writeHead(204, cors);
      return res.end();
    }
    if (req.method === "POST" && req.url.startsWith("/exec")) {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const type = (req.headers["content-type"] || "").split(";")[0].trim();
        const parameter = {};
        if (type === "application/x-www-form-urlencoded") {
          for (const [k, v] of new URLSearchParams(body)) if (!(k in parameter)) parameter[k] = v;
        }
        const out = sandbox.doPost({ parameter, postData: { type, contents: body } });
        res.writeHead(200, { ...cors, "Content-Type": out.mime });
        res.end(out.text);
      });
      return;
    }
    if (req.method === "GET" && req.url.startsWith("/exec")) {
      const out = sandbox.doGet();
      res.writeHead(200, { ...cors, "Content-Type": out.mime });
      return res.end(out.text);
    }
    res.writeHead(404, cors);
    res.end();
  });

  // ---- Static site ----
  const types = {
    ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2",
    ".txt": "text/plain; charset=utf-8", ".xml": "application/xml", ".webmanifest": "application/manifest+json",
  };
  const site = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "POST" && url.pathname === "/__endpoint") {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => { mode = b.trim() || "stub"; res.writeHead(204); res.end(); });
      return;
    }
    let p = decodeURIComponent(url.pathname);
    if (p.endsWith("/")) p += "index.html";
    const file = path.join(SITE, path.normalize(p));
    const blocked = !file.startsWith(SITE + path.sep);
    if (blocked || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { "Content-Type": types[".html"] });
      return res.end(fs.readFileSync(path.join(SITE, "404.html")));
    }
    let data = fs.readFileSync(file);
    if (p === "/assets/js/waitlist.js" && mode !== "none") {
      const target = mode === "stub" ? stubUrl : mode;
      const src = data.toString("utf8");
      const out = src.replace(/var WAITLIST_ENDPOINT = "[^"]*";/, `var WAITLIST_ENDPOINT = ${JSON.stringify(target)};`);
      if (out === src) throw new Error("CONFIG line not found in waitlist.js");
      data = Buffer.from(out);
    }
    const headers = { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" };
    res.writeHead(200, headers);
    res.end(data);
  });

  return new Promise((resolve) => {
    stub.listen(stubPort, "127.0.0.1", () =>
      site.listen(port, "127.0.0.1", () =>
        resolve({
          siteUrl: `http://127.0.0.1:${port}`,
          stubUrl,
          stubBase: `http://127.0.0.1:${stubPort}`,
          close: () => Promise.all([new Promise((r) => site.close(r)), new Promise((r) => stub.close(r))]),
        })
      )
    );
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(arg("port", 4788));
  const s = await startServers({ port, endpoint: arg("endpoint", "stub") });
  console.log(`Site: ${s.siteUrl}   Stub web app: ${s.stubUrl}   Stub rows: ${s.stubBase}/rows`);
}
