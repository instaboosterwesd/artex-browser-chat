#!/usr/bin/env node
/**
 * Shared headed Chrome for ARTEX chat:
 *  - Chrome with remote debugging on :9222 (Playwright MCP attaches via CDP)
 *  - HTTP API for the chat "Open Browser" panel (tabs + live screenshots)
 *  - Per-conversation tab mapping (new chat → new tab)
 */
const http = require("http");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const PORT = Number(process.env.BROWSER_BRIDGE_PORT || 9223);
const CDP_PORT = Number(process.env.CHROME_CDP_PORT || 9222);
const DISPLAY = process.env.DISPLAY || ":99";
const PROFILE =
  process.env.ARTEX_BROWSER_PROFILE ||
  path.join(process.env.HOME || "/tmp", ".artex-browser", "cdp-profile");
const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome-stable";
const REUSE_CDP = process.env.BROWSER_BRIDGE_REUSE_CDP !== "0";

/** @type {import('playwright').Browser|null} */
let browser = null;
/** @type {import('playwright').BrowserContext|null} */
let context = null;
/** chatId(string) -> page */
const chatPages = new Map();
/** page -> chatId */
const pageChat = new WeakMap();
let chromeProc = null;

function json(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Cache-Control": "no-store",
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForCDP(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      if (res.ok) return await res.json();
    } catch (_) {}
    await wait(300);
  }
  throw new Error("Chrome CDP not ready on :" + CDP_PORT);
}

async function cdpUp() {
  try {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
    return res.ok;
  } catch {
    return false;
  }
}

function startChrome() {
  fs.mkdirSync(PROFILE, { recursive: true });
  const args = [
    `--remote-debugging-port=${CDP_PORT}`,
    `--remote-debugging-address=127.0.0.1`,
    `--user-data-dir=${PROFILE}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--disable-background-networking",
    "--disable-features=TranslateUI",
    "--disable-session-crashed-bubble",
    "--hide-crash-restore-bubble",
    "--no-sandbox",
    "--disable-gpu",
    "--window-size=1280,800",
    "--window-position=0,0",
    "about:blank",
  ];
  chromeProc = spawn(CHROME, args, {
    env: { ...process.env, DISPLAY, HOME: process.env.HOME },
    stdio: "ignore",
    detached: true,
  });
  chromeProc.unref();
  console.log(`[bridge] chrome pid=${chromeProc.pid} DISPLAY=${DISPLAY} cdp=${CDP_PORT}`);
}

async function connect() {
  const ver = await waitForCDP();
  const ws = ver.webSocketDebuggerUrl;
  console.log("[bridge] connecting playwright to", ws);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  context = browser.contexts()[0] || (await browser.newContext());
  // Keep at least one page.
  if (context.pages().length === 0) await context.newPage();
  context.on("page", (page) => {
    page.on("close", () => {
      const chatId = pageChat.get(page);
      if (chatId && chatPages.get(chatId) === page) chatPages.delete(chatId);
    });
  });
  console.log("[bridge] connected pages=", context.pages().length);
}

function tabTitle(page) {
  try {
    return page.url() === "about:blank" ? "New Tab" : page.url();
  } catch {
    return "Tab";
  }
}

async function listTabs() {
  if (!context) return [];
  const pages = context.pages().filter((p) => !p.isClosed());
  const out = [];
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    let title = "Tab";
    let url = "about:blank";
    try {
      url = p.url();
      title = (await p.title()) || tabTitle(p);
    } catch (_) {
      title = tabTitle(p);
    }
    const chatId = [...chatPages.entries()].find(([, pg]) => pg === p)?.[0] || null;
    out.push({
      id: String(i),
      index: i,
      title: title.slice(0, 80),
      url,
      chatId,
      active: i === pages.length - 1 ? undefined : undefined,
    });
  }
  return out;
}

async function ensureChatPage(chatId, { url } = {}) {
  if (!context) throw new Error("browser not ready");
  chatId = String(chatId || "default");
  let page = chatPages.get(chatId);
  if (page && !page.isClosed()) {
    await page.bringToFront().catch(() => {});
    if (url && page.url() !== url) await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    return page;
  }
  page = await context.newPage();
  chatPages.set(chatId, page);
  pageChat.set(page, chatId);
  await page.bringToFront().catch(() => {});
  if (url) await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  else await page.goto("about:blank").catch(() => {});
  return page;
}

async function pageByIndex(index) {
  const pages = context.pages().filter((p) => !p.isClosed());
  const page = pages[Number(index)];
  if (!page) throw new Error("tab not found");
  return page;
}

let activePageIndex = 0;

async function resolvePage({ chatId, index, preferIndex = false }) {
  if (!context) throw new Error("browser not ready");
  if (preferIndex && index != null && index !== "") {
    const page = await pageByIndex(index);
    await page.bringToFront().catch(() => {});
    activePageIndex = Number(index);
    return page;
  }
  if (index != null && index !== "") {
    const page = await pageByIndex(index);
    await page.bringToFront().catch(() => {});
    activePageIndex = Number(index);
    return page;
  }
  if (chatId) {
    const page = await ensureChatPage(String(chatId));
    const pages = context.pages().filter((p) => !p.isClosed());
    activePageIndex = Math.max(0, pages.indexOf(page));
    return page;
  }
  const pages = context.pages().filter((p) => !p.isClosed());
  const page = pages[activePageIndex] || pages[pages.length - 1];
  if (!page) throw new Error("no tab");
  await page.bringToFront().catch(() => {});
  return page;
}

async function screenshotFor(chatId, index) {
  // Index wins when provided so tab clicks show the selected tab (not chat-bound page).
  const page = await resolvePage({
    chatId,
    index,
    preferIndex: index != null && index !== "",
  });
  const buf = await page.screenshot({ type: "jpeg", quality: 60, fullPage: false });
  return { buf, page };
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    });
    return res.end();
  }

  try {
    if (u.pathname === "/health") {
      return json(res, 200, {
        ok: true,
        cdp: `http://127.0.0.1:${CDP_PORT}`,
        pages: context ? context.pages().filter((p) => !p.isClosed()).length : 0,
      });
    }

    if (u.pathname === "/tabs" && req.method === "GET") {
      const tabs = await listTabs();
      const pages = context.pages().filter((p) => !p.isClosed());
      if (activePageIndex >= pages.length) activePageIndex = Math.max(0, pages.length - 1);
      tabs.forEach((t) => {
        t.active = t.index === activePageIndex;
      });
      // Optional hint: if client asks for chatId and has not selected a tab yet.
      const forceChat = u.searchParams.get("forceChat");
      const chatId = u.searchParams.get("chatId");
      if (forceChat === "1" && chatId && chatPages.has(chatId)) {
        const idx = pages.indexOf(chatPages.get(chatId));
        if (idx >= 0) {
          activePageIndex = idx;
          tabs.forEach((t) => {
            t.active = t.index === idx;
          });
        }
      }
      return json(res, 200, {
        tabs,
        activeIndex: activePageIndex,
        cdpEndpoint: `http://127.0.0.1:${CDP_PORT}`,
      });
    }

    if (u.pathname === "/tabs/open" && req.method === "POST") {
      const body = await readBody(req);
      const chatId = String(body.chatId || "default");
      const page = await ensureChatPage(chatId, { url: body.url || undefined });
      const pages = context.pages().filter((p) => !p.isClosed());
      activePageIndex = pages.indexOf(page);
      return json(res, 200, {
        ok: true,
        index: activePageIndex,
        url: page.url(),
        chatId,
      });
    }

    if (u.pathname === "/tabs/activate" && req.method === "POST") {
      const body = await readBody(req);
      const page = await resolvePage({
        chatId: body.chatId,
        index: body.index,
        preferIndex: body.index != null,
      });
      await page.bringToFront();
      return json(res, 200, { ok: true, url: page.url(), index: activePageIndex });
    }

    if (u.pathname === "/tabs/close" && req.method === "POST") {
      const body = await readBody(req);
      const pages = context.pages().filter((p) => !p.isClosed());
      if (pages.length <= 1) return json(res, 400, { error: "cannot close the last tab" });
      const page = await pageByIndex(body.index);
      const chatId = [...chatPages.entries()].find(([, pg]) => pg === page)?.[0];
      if (chatId) chatPages.delete(chatId);
      await page.close({ runBeforeUnload: false }).catch(() => {});
      const left = context.pages().filter((p) => !p.isClosed());
      activePageIndex = Math.min(activePageIndex, Math.max(0, left.length - 1));
      if (left[activePageIndex]) await left[activePageIndex].bringToFront().catch(() => {});
      return json(res, 200, { ok: true, activeIndex: activePageIndex, tabsLeft: left.length });
    }

    if (u.pathname === "/tabs/navigate" && req.method === "POST") {
      const body = await readBody(req);
      if (!body.url) return json(res, 400, { error: "url required" });
      const page = await resolvePage({
        chatId: body.chatId,
        index: body.index,
        preferIndex: body.index != null,
      });
      await page.goto(String(body.url), { waitUntil: "domcontentloaded", timeout: 60000 });
      return json(res, 200, { ok: true, url: page.url(), title: await page.title().catch(() => "") });
    }

    // Click / type / scroll on the visible tab (coords are CSS pixels in the viewport).
    if (u.pathname === "/input/click" && req.method === "POST") {
      const body = await readBody(req);
      const page = await resolvePage({
        chatId: body.chatId,
        index: body.index,
        preferIndex: body.index != null,
      });
      const x = Number(body.x);
      const y = Number(body.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return json(res, 400, { error: "x,y required" });
      await page.mouse.click(x, y, { button: body.button || "left", clickCount: body.clickCount || 1 });
      await wait(150);
      return json(res, 200, { ok: true, url: page.url(), index: activePageIndex });
    }

    if (u.pathname === "/input/type" && req.method === "POST") {
      const body = await readBody(req);
      const page = await resolvePage({
        chatId: body.chatId,
        index: body.index,
        preferIndex: body.index != null,
      });
      if (body.text != null) await page.keyboard.type(String(body.text), { delay: body.delay || 20 });
      if (body.key) await page.keyboard.press(String(body.key));
      return json(res, 200, { ok: true });
    }

    if (u.pathname === "/input/scroll" && req.method === "POST") {
      const body = await readBody(req);
      const page = await resolvePage({
        chatId: body.chatId,
        index: body.index,
        preferIndex: body.index != null,
      });
      const dy = Number(body.dy || 0);
      const dx = Number(body.dx || 0);
      await page.mouse.wheel(dx, dy);
      return json(res, 200, { ok: true });
    }

    if (u.pathname === "/screenshot" && req.method === "GET") {
      const chatId = u.searchParams.get("chatId");
      const index = u.searchParams.get("index");
      const { buf, page } = await screenshotFor(chatId, index);
      const vp = page.viewportSize() || { width: 1280, height: 800 };
      res.writeHead(200, {
        "Content-Type": "image/jpeg",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
        "X-Viewport-Width": String(vp.width),
        "X-Viewport-Height": String(vp.height),
      });
      return res.end(buf);
    }

    json(res, 404, { error: "not found" });
  } catch (e) {
    console.error("[bridge]", e);
    json(res, 500, { error: String(e.message || e) });
  }
});

async function main() {
  if (REUSE_CDP && (await cdpUp())) {
    console.log(`[bridge] reusing existing Chrome CDP on :${CDP_PORT}`);
  } else {
    startChrome();
  }
  await connect();
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`[bridge] api http://127.0.0.1:${PORT}  cdp http://127.0.0.1:${CDP_PORT}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
