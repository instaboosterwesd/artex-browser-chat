#!/usr/bin/env node
/**
 * Front door:
 *   /api/*            → ARTEX :8787
 *   /browser-bridge/* → browser bridge :9223 (tabs + screenshots)
 *   everything else   → rebuilt static UI (web/out) if present, else ARTEX embed
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const httpProxy = require("http-proxy");
const { URL } = require("url");

const LISTEN = Number(process.env.ARTEX_GATEWAY_PORT || 8790);
const ARTEX = process.env.ARTEX_UPSTREAM || "http://127.0.0.1:8787";
const BRIDGE = process.env.BROWSER_BRIDGE_UPSTREAM || "http://127.0.0.1:9223";
const CONNECTOR = process.env.OPEN_CONNECTOR_UPSTREAM || "http://127.0.0.1:3000";
const STATIC_ROOT =
  process.env.ARTEX_STATIC_ROOT ||
  path.resolve(__dirname, "../web/out");

const proxy = httpProxy.createProxyServer({ ws: true, xfwd: true });
proxy.on("error", (err, _req, res) => {
  console.error("[gateway] proxy error:", err.message);
  if (res && !res.headersSent && typeof res.writeHead === "function") {
    res.writeHead(502, { "Content-Type": "text/plain" });
    res.end("Bad gateway: " + err.message);
  }
});

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

function safeJoin(root, reqPath) {
  const decoded = decodeURIComponent(reqPath.split("?")[0]);
  const cleaned = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const full = path.join(root, cleaned);
  if (!full.startsWith(root)) return null;
  return full;
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const ctype = MIME[ext] || "application/octet-stream";
  const body = fs.readFileSync(filePath);
  res.writeHead(200, { "Content-Type": ctype, "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=300" });
  res.end(body);
}

function tryStatic(req, res) {
  if (!fs.existsSync(STATIC_ROOT)) return false;
  let pathname = new URL(req.url || "/", "http://local").pathname;
  if (pathname === "/") pathname = "/index.html";

  // Next static export: /chat → /chat.html or /chat/index.html
  const candidates = [];
  const direct = safeJoin(STATIC_ROOT, pathname);
  if (direct) candidates.push(direct);
  if (!path.extname(pathname)) {
    const asHtml = safeJoin(STATIC_ROOT, pathname + ".html");
    const asIndex = safeJoin(STATIC_ROOT, path.join(pathname, "index.html"));
    if (asHtml) candidates.push(asHtml);
    if (asIndex) candidates.push(asIndex);
  }
  for (const c of candidates) {
    if (c && fs.existsSync(c) && fs.statSync(c).isFile()) {
      sendFile(res, c);
      return true;
    }
  }
  // App-route fallback for extensionless paths (Next client router).
  if (!path.extname(pathname) && !pathname.startsWith("/_next")) {
    const fallback = path.join(STATIC_ROOT, "404.html");
    const index = path.join(STATIC_ROOT, "index.html");
    if (fs.existsSync(fallback)) {
      sendFile(res, fallback);
      return true;
    }
    if (fs.existsSync(index)) {
      sendFile(res, index);
      return true;
    }
  }
  return false;
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (u.pathname === "/browser-bridge" || u.pathname.startsWith("/browser-bridge/")) {
    req.url = u.pathname.replace(/^\/browser-bridge/, "") + u.search || "/";
    if (!req.url.startsWith("/")) req.url = "/" + req.url;
    proxy.web(req, res, { target: BRIDGE });
    return;
  }

  // OpenConnector console + MCP + OpenAPI (oomol-lab/open-connector)
  if (u.pathname === "/open-connector" || u.pathname.startsWith("/open-connector/")) {
    let rest = u.pathname.replace(/^\/open-connector/, "") || "/";
    if (!rest.startsWith("/")) rest = "/" + rest;
    req.url = rest + u.search;
    proxy.web(req, res, { target: CONNECTOR });
    return;
  }

  if (u.pathname.startsWith("/api/") || u.pathname === "/api") {
    proxy.web(req, res, { target: ARTEX });
    return;
  }

  // Prefer rebuilt static UI when present.
  if (req.method === "GET" || req.method === "HEAD") {
    if (tryStatic(req, res)) return;
  }

  proxy.web(req, res, { target: ARTEX });
});

server.on("upgrade", (req, socket, head) => {
  const u = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (u.pathname.startsWith("/browser-bridge/")) {
    req.url = u.pathname.replace(/^\/browser-bridge/, "") + u.search;
    proxy.ws(req, socket, head, { target: BRIDGE });
    return;
  }
  proxy.ws(req, socket, head, { target: ARTEX });
});

server.listen(LISTEN, "0.0.0.0", () => {
  console.log(
    `[gateway] :${LISTEN}  static=${STATIC_ROOT}  artex=${ARTEX}  bridge=${BRIDGE}  connector=${CONNECTOR}`,
  );
});
